// IM-06 TD-05 (#248): the Task Board export dispatch and Projection store over
// real PostgreSQL.
//
// The cases drive the owning dispatch functions and the Projection writer
// directly with a synthetic SERVICE context, so the lease/fence, the
// INSERT-only generation, the idempotent replay, the exact dirty confirmation
// and the retention cleanup are exercised against the real V7014/V7015 objects
// (RLS, guards, sequences) rather than an in-memory stand-in.

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
const projectRef: CanonicalJsonObject = {
  kind: 'OBJECT',
  objectType: 'zhiju.project.project',
  objectId: projectId,
  scope,
};
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

function context(): TaskExecutionTransactionContext {
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
    allowedProjectIds: [projectId],
    correlationId: newUuidV7(),
  };
}

function row(taskId: string): TaskBoardSnapshotRow {
  return {
    item: {
      taskRef: { kind: 'OBJECT', objectType: 'zhiju.execution.task', objectId: taskId, scope },
      aggregateVersion: 1,
      title: `Task ${taskId.slice(-4)}`,
      status: 'READY',
      blockerRefs: [],
      activeWorkOrderRefs: [],
    },
    filterKeys: {},
  };
}

function manifest(exportId: string, coveredDirtyIds: readonly string[]): TaskBoardSnapshotManifest {
  const rows = [row('0199b600-0000-7000-8000-000000000801')];
  return {
    exportId,
    projectRef,
    snapshotAt: new Date().toISOString(),
    policyRef,
    policyObservation,
    rows,
    rowCount: rows.length,
    rowsHash: 'b'.repeat(64),
    sourceFingerprint: 'c'.repeat(64),
    coveredDirtyIds,
  };
}

describe.skipIf(!gateEnabled)('Task Board export/dispatch and Projection (real PostgreSQL)', () => {
  // A monotonic trusted clock that stays behind the real clock: each pass
  // advances far enough that the previous Project lease has expired, so
  // takeover is deterministic without waiting, and a zero-length retention
  // still produces an already-expired generation for the cleanup case.
  let clock = Date.now() - 600_000;
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
    const now = new Date((clock += 120_000));
    const first = await claimTaskBoardLease(db, context(), {
      ...scope,
      owner: 'worker-a',
      leaseSeconds: 30,
      now,
    });
    expect(first?.leaseToken).toBe(1);
    const busy = await claimTaskBoardLease(db, context(), {
      ...scope,
      owner: 'worker-b',
      leaseSeconds: 30,
      now,
    });
    expect(busy).toBeUndefined();
    const takeover = await claimTaskBoardLease(db, context(), {
      ...scope,
      owner: 'worker-b',
      leaseSeconds: 30,
      now: new Date(now.getTime() + 31_000),
    });
    expect(takeover?.leaseToken).toBe(2);
  });

  it('publishes a generation, replays it idempotently and rejects a stale fence', async () => {
    const publishContext = context();
    const now = new Date((clock += 120_000));
    const lease = await claimTaskBoardLease(db, publishContext, {
      ...scope,
      owner: 'worker-c',
      leaseSeconds: 60,
      now,
    });
    expect(lease).toBeDefined();
    if (lease === undefined) throw new Error('the export lease was not taken');
    const token = lease.leaseToken;
    const exportId = newUuidV7();
    const first = manifest(exportId, []);
    await recordTaskBoardManifest(db, publishContext, {
      ...scope,
      exportId,
      manifest: first,
      manifestHash: Buffer.from(first.rowsHash, 'hex'),
      snapshotAt: new Date(first.snapshotAt),
      policyObservation,
      rowCount: first.rowCount,
      rowsHash: Buffer.from(first.rowsHash, 'hex'),
      sourceFingerprint: Buffer.from(first.sourceFingerprint, 'hex'),
      coveredDirtyIds: [],
    });
    const published = await publishTaskBoardGeneration(db, publishContext, {
      ...scope,
      projectRef,
      exportId,
      manifest: first,
      manifestHash: first.rowsHash,
      rowsHash: first.rowsHash,
      sourceFingerprint: first.sourceFingerprint,
      policyObservation,
      snapshotAt: new Date(first.snapshotAt),
      retentionSeconds: 3600,
      fence: { token, ownerPrincipalId: publishContext.principalId, leaseUntil: lease.leaseUntil },
      now,
    });
    expect(published.publishSequence).toBe(1);
    expect(published.replayed).toBe(false);

    const replay = await publishTaskBoardGeneration(db, publishContext, {
      ...scope,
      projectRef,
      exportId,
      manifest: first,
      manifestHash: first.rowsHash,
      rowsHash: first.rowsHash,
      sourceFingerprint: first.sourceFingerprint,
      policyObservation,
      snapshotAt: new Date(first.snapshotAt),
      retentionSeconds: 3600,
      fence: { token, ownerPrincipalId: publishContext.principalId, leaseUntil: lease.leaseUntil },
      now,
    });
    expect(replay.generationId).toBe(published.generationId);
    expect(replay.publishSequence).toBe(1);
    expect(replay.replayed).toBe(true);

    const state = await readTaskBoardProjection(db, publishContext, scope);
    expect(state.alias?.generationId).toBe(published.generationId);
    expect(state.alias?.publishSequence).toBe(1);
    expect(state.rows).toHaveLength(1);
    expect(state.checkpoint?.lastPublishSequence).toBe(1);

    await expect(
      publishTaskBoardGeneration(db, publishContext, {
        ...scope,
        projectRef,
        exportId: newUuidV7(),
        manifest: manifest(newUuidV7(), []),
        manifestHash: 'd'.repeat(64),
        rowsHash: 'd'.repeat(64),
        sourceFingerprint: 'e'.repeat(64),
        policyObservation,
        snapshotAt: new Date(),
        retentionSeconds: 3600,
        fence: {
          token: Math.max(0, token - 1),
          ownerPrincipalId: publishContext.principalId,
          leaseUntil: lease.leaseUntil,
        },
        now,
      }),
    ).rejects.toMatchObject({ code: 'TASK_BOARD_FENCE_REJECTED' });
  });

  it('confirms exactly the covered dirty identities and cleans up only expired non-alias generations', async () => {
    const dispatchContext = context();
    const now = new Date((clock += 120_000));
    const lease = await claimTaskBoardLease(db, dispatchContext, {
      ...scope,
      owner: 'worker-d',
      leaseSeconds: 300,
      now,
    });
    if (lease === undefined) throw new Error('the export lease was not taken');
    const token = lease.leaseToken;
    const leaseUntil = lease.leaseUntil;
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
    await recordTaskBoardManifest(db, dispatchContext, {
      ...scope,
      exportId,
      manifest: value,
      manifestHash: Buffer.from(value.rowsHash, 'hex'),
      snapshotAt: new Date(),
      policyObservation,
      rowCount: value.rowCount,
      rowsHash: Buffer.from(value.rowsHash, 'hex'),
      sourceFingerprint: Buffer.from(value.sourceFingerprint, 'hex'),
      coveredDirtyIds: [early, late],
    });
    await expect(
      confirmTaskBoardExport(db, dispatchContext, {
        ...scope,
        exportId,
        manifestHash: Buffer.from(value.rowsHash, 'hex'),
        publishSequence: 2,
        dirtyIds: [newUuidV7()],
      }),
    ).rejects.toMatchObject({ code: 'TASK_BOARD_DIRTY_NOT_COVERED' });
    await confirmTaskBoardExport(db, dispatchContext, {
      ...scope,
      exportId,
      manifestHash: Buffer.from(value.rowsHash, 'hex'),
      publishSequence: 2,
      dirtyIds: [early, late],
    });
    const remaining = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM task_execution.task_board_dirty WHERE project_id = $1`,
      [projectId],
    );
    expect(remaining.rows[0]?.count).toBe('0');

    // One short-retention generation becomes the alias, a second one replaces
    // it; only the expired non-alias generation may be cleaned up.
    const expiring = newUuidV7();
    const expiringManifest = manifest(expiring, []);
    await recordTaskBoardManifest(db, dispatchContext, {
      ...scope,
      exportId: expiring,
      manifest: expiringManifest,
      manifestHash: Buffer.from('f'.repeat(64), 'hex'),
      snapshotAt: new Date(),
      policyObservation,
      rowCount: expiringManifest.rowCount,
      rowsHash: Buffer.from(expiringManifest.rowsHash, 'hex'),
      sourceFingerprint: Buffer.from(expiringManifest.sourceFingerprint, 'hex'),
      coveredDirtyIds: [],
    });
    // A past `published_at` with a zero-length retention makes this generation
    // immediately expired without depending on a real-clock delay.
    const shortLived = await publishTaskBoardGeneration(db, dispatchContext, {
      ...scope,
      projectRef,
      exportId: expiring,
      manifest: expiringManifest,
      manifestHash: 'f'.repeat(64),
      rowsHash: expiringManifest.rowsHash,
      sourceFingerprint: expiringManifest.sourceFingerprint,
      policyObservation,
      snapshotAt: new Date(),
      retentionSeconds: 0,
      fence: { token, ownerPrincipalId: dispatchContext.principalId, leaseUntil },
      now,
    });
    const current = newUuidV7();
    const currentManifest = manifest(current, []);
    await recordTaskBoardManifest(db, dispatchContext, {
      ...scope,
      exportId: current,
      manifest: currentManifest,
      manifestHash: Buffer.from('a'.repeat(64), 'hex'),
      snapshotAt: new Date(),
      policyObservation,
      rowCount: currentManifest.rowCount,
      rowsHash: Buffer.from(currentManifest.rowsHash, 'hex'),
      sourceFingerprint: Buffer.from(currentManifest.sourceFingerprint, 'hex'),
      coveredDirtyIds: [],
    });
    const replacement = await publishTaskBoardGeneration(db, dispatchContext, {
      ...scope,
      projectRef,
      exportId: current,
      manifest: currentManifest,
      manifestHash: 'a'.repeat(64),
      rowsHash: currentManifest.rowsHash,
      sourceFingerprint: currentManifest.sourceFingerprint,
      policyObservation,
      snapshotAt: new Date(),
      retentionSeconds: 3600,
      fence: { token, ownerPrincipalId: dispatchContext.principalId, leaseUntil },
      now,
    });
    expect(replacement.publishSequence).toBeGreaterThan(shortLived.publishSequence);
    const cleanup = await cleanupTaskBoardGenerations(db, dispatchContext, {
      ...scope,
      now: new Date(),
    });
    expect(cleanup.removedGenerations).toBe(1);
    const kept = await readTaskBoardGenerationById(
      db,
      dispatchContext,
      scope,
      replacement.generationId,
    );
    expect(kept.generation?.generationId).toBe(replacement.generationId);
    const gone = await readTaskBoardGenerationById(
      db,
      dispatchContext,
      scope,
      shortLived.generationId,
    );
    expect(gone.generation).toBeUndefined();
    const outcome = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM projection.task_board_publication_outcome WHERE export_id = $1`,
      [expiring],
    );
    expect(outcome.rows[0]?.count).toBe('1');
    expect(token).toBeGreaterThan(0);
  });
});
