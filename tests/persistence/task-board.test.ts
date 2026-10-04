// IM-06 TD-05 (#248): the Task Board export dispatch and Projection store over
// real PostgreSQL.
//
// The cases drive the owning dispatch functions and the Projection writer
// directly with a synthetic SERVICE context, so the lease/fence, the INSERT
// integrity guard, the canonical hash/mirror verification, the idempotent
// replay, the publication-gated dirty confirmation and the retention cleanup
// are exercised against the real V7014/V7015 objects (RLS, guards, sequences)
// rather than an in-memory stand-in.

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  claimTaskBoardLease,
  cleanupTaskBoardGenerations,
  confirmTaskBoardExport,
  createTaskExecutionDatabase,
  publishTaskBoardGeneration,
  readTaskBoardGenerationById,
  readTaskBoardProjection,
  recordTaskBoardManifest,
  recordTaskBoardPublication,
  taskBoardManifestHash,
  taskBoardRowsHash,
  type TaskBoardPolicyObservation,
  type TaskBoardSnapshotManifest,
  type TaskBoardSnapshotRow,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { postgresImageReference } from '../../tools/persistence/baseline.mjs';
import { runFlyway } from '../../tools/persistence/flyway.mjs';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);
const PROBE_ROLE = 'im06_board_probe';
const PROBE_PASSWORD = 'im06-board-probe';

const container: StartedPostgreSqlContainer | undefined = gateEnabled
  ? await new PostgreSqlContainer(postgresImageReference())
      .withDatabase('zhiju_core')
      .withUsername('postgres')
      .withPassword('zhiju-gate-test')
      .withStartupTimeout(120_000)
      .start()
  : undefined;

beforeAll(async () => {
  await runFlyway(container?.getId() ?? '', {
    command: 'migrate',
    database: 'zhiju_core',
    username: 'postgres',
    password: 'zhiju-gate-test',
  });
}, 600_000);

afterAll(async () => {
  await container?.stop();
}, 120_000);

const enterpriseId = '0199b600-0000-7000-8000-000000000701';
const projectId = '0199b600-0000-7000-8000-000000000702';
const scope = { enterpriseId, projectId };
const policyRef: CanonicalJsonObject = {
  kind: 'VERSIONED',
  objectType: 'zhiju.identity.policy',
  objectId: '0199b600-0000-7000-8000-000000000703',
  versionId: '0199b600-0000-7000-8000-000000000704',
  scope,
};
const policyVersionRef: CanonicalJsonObject = {
  kind: 'SNAPSHOT',
  objectType: 'zhiju.identity.policy_version',
  objectId: '0199b600-0000-7000-8000-000000000705',
  snapshotId: '0199b600-0000-7000-8000-000000000706',
  scope,
};
const policyObservation: TaskBoardPolicyObservation = {
  policyRef,
  policyVersionRef,
  contentHash: 'a'.repeat(64),
  effectiveFrom: '2026-10-04T00:00:00.000Z',
};

function contextFor(target: { readonly projectId: string }): TaskExecutionTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: newUuidV7(),
    principalKind: 'SERVICE',
    actorSnapshotId: newUuidV7(),
    authorizationDecisionId: newUuidV7(),
    authorizationDecisionHash: Buffer.alloc(32, 5),
    authorizationDecisionExpiresAt: new Date(Date.now() + 3_600_000),
    policySnapshotId: newUuidV7(),
    enterpriseId,
    allowedProjectIds: [target.projectId],
    correlationId: newUuidV7(),
  };
}

function scopeFor(targetProjectId: string): {
  readonly enterpriseId: string;
  readonly projectId: string;
} {
  return { enterpriseId, projectId: targetProjectId };
}

function projectRefFor(targetProjectId: string): CanonicalJsonObject {
  return {
    kind: 'OBJECT',
    objectType: 'zhiju.project.project',
    objectId: targetProjectId,
    scope: scopeFor(targetProjectId),
  };
}

function row(taskId: string, targetProjectId: string): TaskBoardSnapshotRow {
  return {
    item: {
      taskRef: {
        kind: 'OBJECT',
        objectType: 'zhiju.execution.task',
        objectId: taskId,
        scope: scopeFor(targetProjectId),
      },
      aggregateVersion: 1,
      title: `Task ${taskId.slice(-4)}`,
      status: 'READY',
      blockerRefs: [],
      activeWorkOrderRefs: [],
    },
    filterKeys: {},
  };
}

function manifest(
  exportId: string,
  coveredDirtyIds: readonly string[],
  targetProjectId: string = projectId,
): TaskBoardSnapshotManifest {
  const rows = [row('0199b600-0000-7000-8000-000000000801', targetProjectId)];
  return {
    exportId,
    projectRef: projectRefFor(targetProjectId),
    snapshotAt: new Date().toISOString(),
    policyRef,
    policyObservation,
    rows,
    rowCount: rows.length,
    rowsHash: taskBoardRowsHash(rows),
    sourceFingerprint: 'c'.repeat(64),
    coveredDirtyIds,
  };
}

function publishInput(
  value: TaskBoardSnapshotManifest,
  fence: { readonly token: number; readonly ownerPrincipalId: string; readonly leaseUntil: Date },
  now: Date,
  retentionSeconds = 3600,
  targetProjectId: string = projectId,
) {
  return {
    ...scopeFor(targetProjectId),
    projectRef: projectRefFor(targetProjectId),
    exportId: value.exportId,
    manifest: value,
    manifestHash: taskBoardManifestHash(value),
    rowsHash: value.rowsHash,
    sourceFingerprint: value.sourceFingerprint,
    policyObservation,
    snapshotAt: new Date(value.snapshotAt),
    retentionSeconds,
    fence,
    now,
  };
}

describe.skipIf(!gateEnabled)('Task Board export/dispatch and Projection (real PostgreSQL)', () => {
  // A monotonic trusted clock that stays behind the real clock: each pass
  // advances far enough that the previous Project lease has expired, so
  // takeover is deterministic without waiting, and a zero-length retention
  // still produces an already-expired generation for the cleanup case.
  let booking = Date.now();
  let admin: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createTaskExecutionDatabase>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `DO $do$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
           CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${PROBE_PASSWORD}'
             NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
         END IF;
       END $do$`,
    );
    await admin.query(
      `GRANT platform_context_establisher, task_execution_app, projection_app TO ${PROBE_ROLE}`,
    );
    const url = new URL(databaseUrl ?? '');
    url.username = PROBE_ROLE;
    url.password = PROBE_PASSWORD;
    pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
    db = createTaskExecutionDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  it('leases per Project, rejects a live owner, and allows takeover after expiry', async () => {
    const now = new Date(booking + 60_000);
    const first = await claimTaskBoardLease(db, contextFor(scope), {
      ...scope,
      owner: 'worker-a',
      leaseSeconds: 30,
      now,
    });
    expect(first?.leaseToken).toBe(1);
    const busy = await claimTaskBoardLease(db, contextFor(scope), {
      ...scope,
      owner: 'worker-b',
      leaseSeconds: 30,
      now,
    });
    expect(busy).toBeUndefined();
    const takeover = await claimTaskBoardLease(db, contextFor(scope), {
      ...scope,
      owner: 'worker-b',
      leaseSeconds: 30,
      now: new Date(now.getTime() + 31_000),
    });
    expect(takeover?.leaseToken).toBe(2);
  });

  it('publishes a verified generation, replays it idempotently and rejects stale fences', async () => {
    const publishContext = contextFor(scope);
    const now = new Date((booking += 600_000));
    const lease = await claimTaskBoardLease(db, publishContext, {
      ...scope,
      owner: 'worker-c',
      leaseSeconds: 60,
      now,
    });
    if (lease === undefined) throw new Error('the export lease was not taken');
    const exportId = newUuidV7();
    const first = manifest(exportId, []);
    await recordTaskBoardManifest(db, publishContext, {
      ...scope,
      exportId,
      manifest: first,
      manifestHash: Buffer.from(taskBoardManifestHash(first), 'hex'),
      snapshotAt: new Date(first.snapshotAt),
      policyObservation,
      rowCount: first.rowCount,
      rowsHash: Buffer.from(first.rowsHash, 'hex'),
      sourceFingerprint: Buffer.from(first.sourceFingerprint, 'hex'),
      coveredDirtyIds: [],
    });
    const published = await publishTaskBoardGeneration(
      db,
      publishContext,
      publishInput(
        first,
        {
          token: lease.leaseToken,
          ownerPrincipalId: publishContext.principalId,
          leaseUntil: lease.leaseUntil,
        },
        now,
      ),
    );
    expect(published.publishSequence).toBe(1);
    expect(published.replayed).toBe(false);

    const replay = await publishTaskBoardGeneration(
      db,
      publishContext,
      publishInput(
        first,
        {
          token: lease.leaseToken,
          ownerPrincipalId: publishContext.principalId,
          leaseUntil: lease.leaseUntil,
        },
        now,
      ),
    );
    expect(replay.generationId).toBe(published.generationId);
    expect(replay.replayed).toBe(true);

    const state = await readTaskBoardProjection(db, publishContext, scope);
    expect(state.alias?.generationId).toBe(published.generationId);
    expect(state.rows).toHaveLength(1);
    expect(state.checkpoint?.lastPublishSequence).toBe(1);

    // A damaged row hash is refused before anything is persisted and the alias
    // stays on the previously published generation.
    const damaged = manifest(newUuidV7(), []);
    await expect(
      publishTaskBoardGeneration(db, publishContext, {
        ...publishInput(
          damaged,
          {
            token: lease.leaseToken,
            ownerPrincipalId: publishContext.principalId,
            leaseUntil: lease.leaseUntil,
          },
          now,
        ),
        rowsHash: '0'.repeat(64),
        manifestHash: '1'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'TASK_BOARD_MANIFEST_CONFLICT' });
    const afterDamage = await readTaskBoardProjection(db, publishContext, scope);
    expect(afterDamage.alias?.generationId).toBe(published.generationId);

    // A stale token is rejected by the Projection fence.
    await expect(
      publishTaskBoardGeneration(db, publishContext, {
        ...publishInput(
          manifest(newUuidV7(), []),
          {
            token: Math.max(0, lease.leaseToken - 1),
            ownerPrincipalId: publishContext.principalId,
            leaseUntil: lease.leaseUntil,
          },
          now,
        ),
      }),
    ).rejects.toMatchObject({ code: 'TASK_BOARD_FENCE_REJECTED' });

    // An already-expired lease can never publish, whatever the caller's clock.
    await expect(
      publishTaskBoardGeneration(db, publishContext, {
        ...publishInput(
          manifest(newUuidV7(), []),
          {
            token: lease.leaseToken,
            ownerPrincipalId: publishContext.principalId,
            leaseUntil: new Date(Date.now() - 60_000),
          },
          now,
        ),
      }),
    ).rejects.toMatchObject({ code: 'TASK_BOARD_FENCE_REJECTED' });
  });

  it('refuses to acknowledge a manifest that was never published', async () => {
    const dispatchContext = contextFor(scope);
    const now = new Date((booking += 600_000));
    const lease = await claimTaskBoardLease(db, dispatchContext, {
      ...scope,
      owner: 'worker-d',
      leaseSeconds: 120,
      now,
    });
    if (lease === undefined) throw new Error('the export lease was not taken');
    const early = newUuidV7();
    const late = newUuidV7();
    await admin.query(
      `INSERT INTO task_execution.task_board_dirty
         (marker_id, enterprise_id, project_id, source_type, source_id)
       VALUES ($1,$2,$3,'task',$4), ($5,$2,$3,'task',$4)`,
      [early, enterpriseId, projectId, newUuidV7(), late],
    );
    const exportId = newUuidV7();
    const value = manifest(exportId, [early, late]);
    const manifestHash = Buffer.from(taskBoardManifestHash(value), 'hex');
    await recordTaskBoardManifest(db, dispatchContext, {
      ...scope,
      exportId,
      manifest: value,
      manifestHash,
      snapshotAt: new Date(value.snapshotAt),
      policyObservation,
      rowCount: value.rowCount,
      rowsHash: Buffer.from(value.rowsHash, 'hex'),
      sourceFingerprint: Buffer.from(value.sourceFingerprint, 'hex'),
      coveredDirtyIds: [early, late],
    });

    // Recorded but never published: the confirmation and the marker deletion
    // are refused.
    await expect(
      confirmTaskBoardExport(db, dispatchContext, {
        ...scope,
        exportId,
        manifestHash,
        generationId: newUuidV7(),
        publishSequence: 1,
        dirtyIds: [early, late],
      }),
    ).rejects.toMatchObject({ code: 'TASK_BOARD_NOT_PUBLISHED' });
    const untouched = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM task_execution.task_board_dirty WHERE project_id = $1`,
      [projectId],
    );
    expect(untouched.rows[0]?.count).toBe('2');

    // A publication recorded under a dead lease is refused.
    await expect(
      recordTaskBoardPublication(db, dispatchContext, {
        ...scope,
        exportId,
        manifestHash,
        generationId: newUuidV7(),
        publishSequence: 1,
        leaseToken: lease.leaseToken + 10,
      }),
    ).rejects.toMatchObject({ code: 'TASK_BOARD_LEASE_NOT_CURRENT' });

    const published = await publishTaskBoardGeneration(
      db,
      dispatchContext,
      publishInput(
        value,
        {
          token: lease.leaseToken,
          ownerPrincipalId: dispatchContext.principalId,
          leaseUntil: lease.leaseUntil,
        },
        now,
      ),
    );
    await recordTaskBoardPublication(db, dispatchContext, {
      ...scope,
      exportId,
      manifestHash,
      generationId: published.generationId,
      publishSequence: published.publishSequence,
      leaseToken: lease.leaseToken,
    });
    // A publication proof for another generation or sequence is still refused.
    await expect(
      confirmTaskBoardExport(db, dispatchContext, {
        ...scope,
        exportId,
        manifestHash,
        generationId: published.generationId,
        publishSequence: published.publishSequence + 1,
        dirtyIds: [early, late],
      }),
    ).rejects.toMatchObject({ code: 'TASK_BOARD_NOT_PUBLISHED' });
    await confirmTaskBoardExport(db, dispatchContext, {
      ...scope,
      exportId,
      manifestHash,
      generationId: published.generationId,
      publishSequence: published.publishSequence,
      dirtyIds: [early, late],
    });
    const remaining = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM task_execution.task_board_dirty WHERE project_id = $1`,
      [projectId],
    );
    expect(remaining.rows[0]?.count).toBe('0');
  });

  it('cleans up only expired non-alias generations and keeps the publication proof', async () => {
    // A dedicated Project keeps the alias switch order independent from the
    // other cases, so an already-expired generation can be produced without
    // moving the alias switch time backwards.
    const cleanupProjectId = '0199b600-0000-7000-8000-000000000799';
    const cleanupScope = scopeFor(cleanupProjectId);
    const dispatchContext = contextFor(cleanupScope);
    const claimedAt = new Date(Date.now() - 300_000);
    const lease = await claimTaskBoardLease(db, dispatchContext, {
      ...cleanupScope,
      owner: 'worker-e',
      leaseSeconds: 86_400,
      now: claimedAt,
    });
    if (lease === undefined) throw new Error('the export lease was not taken');
    const fence = {
      token: lease.leaseToken,
      ownerPrincipalId: dispatchContext.principalId,
      leaseUntil: lease.leaseUntil,
    };
    const expiring = manifest(newUuidV7(), [], cleanupProjectId);
    const shortLived = await publishTaskBoardGeneration(
      db,
      dispatchContext,
      publishInput(expiring, fence, new Date(Date.now() - 120_000), 0, cleanupProjectId),
    );
    const current = manifest(newUuidV7(), [], cleanupProjectId);
    const replacement = await publishTaskBoardGeneration(
      db,
      dispatchContext,
      publishInput(current, fence, new Date(Date.now() - 60_000), 3600, cleanupProjectId),
    );
    expect(replacement.publishSequence).toBeGreaterThan(shortLived.publishSequence);
    const cleanup = await cleanupTaskBoardGenerations(db, dispatchContext, {
      ...cleanupScope,
      now: new Date(),
    });
    expect(cleanup.removedGenerations).toBe(1);
    const kept = await readTaskBoardGenerationById(
      db,
      dispatchContext,
      cleanupScope,
      replacement.generationId,
    );
    expect(kept.generation?.generationId).toBe(replacement.generationId);
    const gone = await readTaskBoardGenerationById(
      db,
      dispatchContext,
      cleanupScope,
      shortLived.generationId,
    );
    expect(gone.generation).toBeUndefined();
    const outcome = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM projection.task_board_publication_outcome WHERE export_id = $1`,
      [expiring.exportId],
    );
    expect(outcome.rows[0]?.count).toBe('1');
  });
});
