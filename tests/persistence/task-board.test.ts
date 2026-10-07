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
  readTaskBoardRecoveryTarget,
  retireTaskBoardExport,
  readTaskBoardGenerationById,
  type TaskExecutionDb,
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
import {
  Kysely,
  PostgresDialect,
  type PluginTransformQueryArgs,
  type PluginTransformResultArgs,
} from 'kysely';
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

    // The persisted manifest is the recovery出口: it stays pending until a
    // publication proof exists.
    const pendingBefore = await readTaskBoardRecoveryTarget(db, dispatchContext, scope);
    expect(pendingBefore?.exportId).toBe(exportId);
    expect(pendingBefore?.generationId).toBeNull();
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
    // Once published, the same export is no longer a pending recovery target.
    const pendingAfter = await readTaskBoardRecoveryTarget(db, dispatchContext, scope);
    expect(pendingAfter?.exportId).not.toBe(exportId);
  });

  it('rejects a forged publication proof for an export that was never published', async () => {
    const dispatchContext = contextFor(scope);
    const now = new Date((booking += 600_000));
    const lease = await claimTaskBoardLease(db, dispatchContext, {
      ...scope,
      owner: 'worker-f',
      leaseSeconds: 120,
      now,
    });
    if (lease === undefined) throw new Error('the export lease was not taken');
    const exportId = newUuidV7();
    const value = manifest(exportId, []);
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
      coveredDirtyIds: [],
    });
    // A live lease is not enough: the publication must already be committed by
    // the Projection owner with this exact generation and sequence.
    await expect(
      recordTaskBoardPublication(db, dispatchContext, {
        ...scope,
        exportId,
        manifestHash,
        generationId: newUuidV7(),
        publishSequence: 1,
        leaseToken: lease.leaseToken,
      }),
    ).rejects.toMatchObject({ code: 'TASK_BOARD_NOT_PUBLISHED' });
  });

  it('rejects SQL-level generation and row tampering that bypasses the application', async () => {
    const publishContext = contextFor(scope);
    const now = new Date((booking += 600_000));
    const lease = await claimTaskBoardLease(db, publishContext, {
      ...scope,
      owner: 'worker-g',
      leaseSeconds: 300,
      now,
    });
    if (lease === undefined) throw new Error('the export lease was not taken');
    const value = manifest(newUuidV7(), []);
    const manifestHash = taskBoardManifestHash(value);
    const published = await publishTaskBoardGeneration(
      db,
      publishContext,
      publishInput(
        value,
        {
          token: lease.leaseToken,
          ownerPrincipalId: publishContext.principalId,
          leaseUntil: lease.leaseUntil,
        },
        now,
      ),
    );
    const generationRow = (
      await admin.query<Record<string, unknown>>(
        `SELECT * FROM projection.task_board_generation WHERE generation_id = $1`,
        [published.generationId],
      )
    ).rows[0];
    if (generationRow === undefined) throw new Error('the generation was not stored');
    const insertGeneration = (overrides: Record<string, unknown>): Promise<unknown> => {
      const columns = { ...generationRow, ...overrides };
      const names = Object.keys(columns);
      return admin.query(
        `INSERT INTO projection.task_board_generation (${names.join(',')})
         VALUES (${names.map((_, index) => `$${index + 1}`).join(',')})`,
        names.map((name) => columns[name]),
      );
    };
    // A manifest that is internally intact but bound to another manifest hash
    // is refused by the SQL guard, even though the application was bypassed.
    await expect(
      insertGeneration({
        generation_id: newUuidV7(),
        export_id: newUuidV7(),
        publish_sequence: '9001',
        manifest_hash: Buffer.alloc(32, 9),
      }),
    ).rejects.toMatchObject({ code: '23514' });
    // A row whose promoted identity does not mirror its stored row is refused.
    await expect(
      admin.query(
        `INSERT INTO projection.task_board_row
           (generation_id, task_id, enterprise_id, project_id, row, delivery_item_ref)
         VALUES ($1,$2,$3,$4,$5::jsonb,NULL)`,
        [
          published.generationId,
          newUuidV7(),
          enterpriseId,
          projectId,
          JSON.stringify(value.rows[0]),
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    void manifestHash;
  });

  it('rejects application filter-key hash and row-count conflicts without changing the alias', async () => {
    const publishContext = contextFor(scope);
    const now = new Date((booking += 600_000));
    const lease = await claimTaskBoardLease(db, publishContext, {
      ...scope,
      owner: 'worker-integrity',
      leaseSeconds: 300,
      now,
    });
    if (lease === undefined) throw new Error('the export lease was not taken');
    const original = manifest(newUuidV7(), []);
    const deliveryItemRef: CanonicalJsonObject = {
      kind: 'VERSIONED',
      objectType: 'zhiju.project.delivery_item',
      objectId: newUuidV7(),
      versionId: newUuidV7(),
      scope,
    };
    const source = original.rows[0];
    if (source === undefined) throw new Error('missing baseline row');
    const rows = [{ ...source, filterKeys: { deliveryItemRef } }];
    const value = { ...original, rows, rowsHash: taskBoardRowsHash(rows) };
    const fence = {
      token: lease.leaseToken,
      ownerPrincipalId: publishContext.principalId,
      leaseUntil: lease.leaseUntil,
    };
    const published = await publishTaskBoardGeneration(
      db,
      publishContext,
      publishInput(value, fence, now),
    );
    expect(
      (
        await readTaskBoardGenerationById(db, publishContext, scope, published.generationId)
      ).rows.map((row) => row.row),
    ).toEqual(rows);
    const before = await readTaskBoardProjection(db, publishContext, scope);
    const changed = {
      ...value,
      exportId: newUuidV7(),
      rows: [
        {
          ...source,
          filterKeys: {
            deliveryItemRef: { ...deliveryItemRef, versionId: newUuidV7() },
          },
        },
      ],
    };
    // Only the private version binding changes; its retained rowsHash is now
    // wrong. The enclosing manifest hash is recomputed and otherwise valid.
    expect(taskBoardRowsHash(changed.rows)).not.toBe(value.rowsHash);
    await expect(
      publishTaskBoardGeneration(db, publishContext, publishInput(changed, fence, now)),
    ).rejects.toMatchObject({
      code: 'TASK_BOARD_MANIFEST_CONFLICT',
      message: 'rows hash does not match the canonical rows',
    });
    const wrongCount = { ...value, exportId: newUuidV7(), rowCount: value.rowCount + 1 };
    await expect(
      publishTaskBoardGeneration(db, publishContext, publishInput(wrongCount, fence, now)),
    ).rejects.toMatchObject({
      code: 'TASK_BOARD_MANIFEST_CONFLICT',
      message: 'manifest row count does not match its rows',
    });
    expect(await readTaskBoardProjection(db, publishContext, scope)).toEqual(before);
    expect(
      (
        await admin.query(
          'SELECT export_id FROM projection.task_board_generation WHERE export_id=ANY($1::uuid[])',
          [[changed.exportId, wrongCount.exportId]],
        )
      ).rows,
    ).toEqual([]);
  });

  it('rejects independent SQL filter mirrors and counts against an otherwise-valid INSERT baseline', async () => {
    const template = (
      await admin.query<Record<string, unknown>>(
        'SELECT * FROM projection.task_board_generation WHERE enterprise_id=$1 AND project_id=$2 ORDER BY publish_sequence DESC LIMIT 1',
        [enterpriseId, projectId],
      )
    ).rows[0];
    if (template === undefined) throw new Error('missing valid generation template');
    const value = manifest(newUuidV7(), []);
    const source = value.rows[0];
    if (source === undefined) throw new Error('missing baseline row');
    const deliveryItemRef: CanonicalJsonObject = {
      kind: 'VERSIONED',
      objectType: 'zhiju.project.delivery_item',
      objectId: newUuidV7(),
      versionId: newUuidV7(),
      scope,
    };
    const baselineRow = { ...source, filterKeys: { deliveryItemRef } };
    const rows = [baselineRow];
    const complete = { ...value, rows, rowsHash: taskBoardRowsHash(rows) };
    const generationId = newUuidV7();
    const baseline = {
      ...template,
      generation_id: generationId,
      export_id: complete.exportId,
      manifest: JSON.stringify(complete),
      manifest_hash: Buffer.from(taskBoardManifestHash(complete), 'hex'),
      rows_hash: Buffer.from(complete.rowsHash, 'hex'),
      row_count: complete.rowCount,
      snapshot_at: new Date(complete.snapshotAt),
      publish_sequence: '900000',
    };
    const insertGeneration = async (overrides: Record<string, unknown> = {}) => {
      const columns: Record<string, unknown> = { ...baseline, ...overrides };
      const names = Object.keys(columns);
      await admin.query(
        `INSERT INTO projection.task_board_generation (${names.join(',')})
        VALUES (${names.map((_, index) => `$${index + 1}`).join(',')})`,
        names.map((name) => columns[name]),
      );
    };
    const insertRow = (stored = baselineRow, mirror = deliveryItemRef) =>
      admin.query(
        `INSERT INTO projection.task_board_row (generation_id,task_id,enterprise_id,project_id,row,delivery_item_ref)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
        [
          generationId,
          (source.item.taskRef as CanonicalJsonObject).objectId,
          enterpriseId,
          projectId,
          JSON.stringify(stored),
          JSON.stringify(mirror),
        ],
      );
    const rollback = async (run: () => Promise<void>) => {
      await admin.query('BEGIN');
      try {
        await run();
      } finally {
        await admin.query('ROLLBACK');
      }
    };
    // Every probe uses the very same unused identities and coherent hashes.
    // Rollback lets the legal baseline and each isolated mutation stand alone.
    await rollback(async () => {
      await insertGeneration();
      await insertRow();
      expect(
        (
          await admin.query(
            'SELECT count(*)::int AS n FROM projection.task_board_row WHERE generation_id=$1',
            [generationId],
          )
        ).rows,
      ).toEqual([{ n: 1 }]);
    });
    const changedRef = { ...deliveryItemRef, versionId: newUuidV7() };
    await rollback(async () => {
      await insertGeneration();
      await expect(insertRow(baselineRow, changedRef)).rejects.toMatchObject({
        code: '23514',
        message: 'task_board_row identity mirror mismatch',
      });
    });
    await rollback(async () => {
      await insertGeneration();
      await expect(
        insertRow({ ...baselineRow, filterKeys: { deliveryItemRef: changedRef } }),
      ).rejects.toMatchObject({
        code: '23514',
        message: 'task_board_row identity mirror mismatch',
      });
    });
    await rollback(async () => {
      await insertGeneration();
      await expect(
        insertRow({ ...baselineRow, filterKeys: { deliveryItemRef: changedRef } }, changedRef),
      ).rejects.toMatchObject({
        code: '23514',
        message: 'task_board_row is not part of its generation manifest',
      });
    });
    await rollback(async () => {
      await expect(insertGeneration({ row_count: complete.rowCount + 1 })).rejects.toMatchObject({
        code: '23514',
        message: 'task_board_generation manifest mirror mismatch',
      });
    });
    await rollback(async () => {
      const wrongCount = { ...complete, rowCount: complete.rowCount + 1 };
      await expect(
        insertGeneration({
          manifest: JSON.stringify(wrongCount),
          manifest_hash: Buffer.from(taskBoardManifestHash(wrongCount), 'hex'),
          row_count: wrongCount.rowCount,
        }),
      ).rejects.toMatchObject({
        code: '23514',
        message: 'task_board_generation manifest mirror mismatch',
      });
    });
    expect(
      (
        await admin.query(
          'SELECT generation_id FROM projection.task_board_generation WHERE generation_id=$1',
          [generationId],
        )
      ).rows,
    ).toEqual([]);
  });

  it('rejects a publisher whose lease expires while it waits on the fence lock', async () => {
    // A dedicated Project keeps this barrier independent from the booked clock
    // of the other cases, so the lease can really elapse during the wait.
    const barrierProjectId = '0199b600-0000-7000-8000-000000000798';
    const barrierScope = scopeFor(barrierProjectId);
    const publishContext = contextFor(barrierScope);
    const warmup = new Date();
    const warmupLease = await claimTaskBoardLease(db, publishContext, {
      ...barrierScope,
      owner: 'worker-h',
      leaseSeconds: 300,
      now: warmup,
    });
    if (warmupLease === undefined) throw new Error('the warm-up lease was not taken');
    // The first publication creates the Project's fence row the holder locks.
    await publishTaskBoardGeneration(
      db,
      publishContext,
      publishInput(
        manifest(newUuidV7(), [], barrierProjectId),
        {
          token: warmupLease.leaseToken,
          ownerPrincipalId: publishContext.principalId,
          leaseUntil: warmupLease.leaseUntil,
        },
        warmup,
        3600,
        barrierProjectId,
      ),
    );
    const now = new Date();
    const lease = await claimTaskBoardLease(db, publishContext, {
      ...barrierScope,
      owner: 'worker-h',
      leaseSeconds: 1,
      now,
    });
    if (lease === undefined) throw new Error('the export lease was not taken');
    const holder = new pg.Client({ connectionString: databaseUrl });
    await holder.connect();
    // A reached signal replaces a blind sleep: the probe resolves the moment
    // the publisher issues its fence lock statement.
    const reached = Promise.withResolvers<boolean>();
    let signalled = false;
    const probeDb = new Kysely<TaskExecutionDb>({
      dialect: new PostgresDialect({ pool }),
      plugins: [
        {
          transformQuery(args: PluginTransformQueryArgs) {
            if (!signalled && JSON.stringify(args.node).includes('task_board_fence')) {
              signalled = true;
              reached.resolve(true);
            }
            return args.node;
          },
          transformResult(args: PluginTransformResultArgs) {
            return Promise.resolve(args.result);
          },
        },
      ],
    });
    let publishing: Promise<unknown> | undefined;
    try {
      await holder.query('BEGIN');
      const locked = await holder.query(
        `SELECT token FROM projection.task_board_fence
          WHERE enterprise_id = $1 AND project_id = $2 FOR UPDATE`,
        [enterpriseId, barrierProjectId],
      );
      expect(locked.rowCount).toBe(1);
      const value = manifest(newUuidV7(), [], barrierProjectId);
      publishing = publishTaskBoardGeneration(
        probeDb,
        publishContext,
        publishInput(
          value,
          {
            token: lease.leaseToken,
            ownerPrincipalId: publishContext.principalId,
            leaseUntil: lease.leaseUntil,
          },
          now,
          3600,
          barrierProjectId,
        ),
      );
      // Only release the lock once the publisher has actually reached the
      // fence step *and* the lease deadline has passed on the platform clock.
      await reached.promise;
      const deadline = lease.leaseUntil.getTime() + 100;
      let remaining = deadline - Date.now();
      while (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
        remaining = deadline - Date.now();
      }
      expect(signalled).toBe(true);
      await holder.query('COMMIT');
      await expect(publishing).rejects.toMatchObject({ code: 'TASK_BOARD_FENCE_REJECTED' });
    } finally {
      await holder.end().catch(() => undefined);
      void publishing;
    }
  });

  it('recovers an export that was published but not yet acknowledged', async () => {
    const dispatchContext = contextFor(scope);
    const now = new Date((booking += 600_000));
    const lease = await claimTaskBoardLease(db, dispatchContext, {
      ...scope,
      owner: 'worker-i',
      leaseSeconds: 300,
      now,
    });
    if (lease === undefined) throw new Error('the export lease was not taken');
    const exportId = newUuidV7();
    const value = manifest(exportId, []);
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
      coveredDirtyIds: [],
    });
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
    // The crash window: the proof is committed, the acknowledgement is not.
    await recordTaskBoardPublication(db, dispatchContext, {
      ...scope,
      exportId,
      manifestHash,
      generationId: published.generationId,
      publishSequence: published.publishSequence,
      leaseToken: lease.leaseToken,
    });
    const target = await readTaskBoardRecoveryTarget(db, dispatchContext, scope);
    expect(target?.exportId).toBe(exportId);
    expect(target?.generationId).toBe(published.generationId);
    expect(target?.publishSequence).toBe(published.publishSequence);
    await confirmTaskBoardExport(db, dispatchContext, {
      ...scope,
      exportId,
      manifestHash,
      generationId: published.generationId,
      publishSequence: published.publishSequence,
      dirtyIds: [],
    });
    const after = await readTaskBoardRecoveryTarget(db, dispatchContext, scope);
    expect(after?.exportId).not.toBe(exportId);
  });

  it('recovers the committed Projection outcome even without a TE publication proof', async () => {
    const dispatchContext = contextFor(scope);
    const now = new Date((booking += 600_000));
    const lease = await claimTaskBoardLease(db, dispatchContext, {
      ...scope,
      owner: 'worker-l',
      leaseSeconds: 300,
      now,
    });
    if (lease === undefined) throw new Error('the export lease was not taken');
    const exportId = newUuidV7();
    const value = manifest(exportId, []);
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
      coveredDirtyIds: [],
    });
    // Crash window: the Projection commit happened, the TE proof did not.
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
    const target = await readTaskBoardRecoveryTarget(db, dispatchContext, scope);
    expect(target?.exportId).toBe(exportId);
    // The owning outcome supplies the exact generation/sequence, so the
    // recovery path can finish the acknowledgement instead of retiring.
    expect(target?.generationId).toBe(published.generationId);
    expect(target?.publishSequence).toBe(published.publishSequence);
    await recordTaskBoardPublication(db, dispatchContext, {
      ...scope,
      exportId,
      manifestHash,
      generationId: published.generationId,
      publishSequence: published.publishSequence,
      leaseToken: lease.leaseToken,
    });
    await confirmTaskBoardExport(db, dispatchContext, {
      ...scope,
      exportId,
      manifestHash,
      generationId: published.generationId,
      publishSequence: published.publishSequence,
      dirtyIds: [],
    });
    const after = await readTaskBoardRecoveryTarget(db, dispatchContext, scope);
    expect(after?.exportId).not.toBe(exportId);
  });

  it('retires an obsolete unpublished export and refuses to retire a published one', async () => {
    const dispatchContext = contextFor(scope);
    const now = new Date((booking += 600_000));
    const lease = await claimTaskBoardLease(db, dispatchContext, {
      ...scope,
      owner: 'worker-j',
      leaseSeconds: 300,
      now,
    });
    if (lease === undefined) throw new Error('the export lease was not taken');
    const obsolete = newUuidV7();
    const value = manifest(obsolete, []);
    const manifestHash = Buffer.from(taskBoardManifestHash(value), 'hex');
    await recordTaskBoardManifest(db, dispatchContext, {
      ...scope,
      exportId: obsolete,
      manifest: value,
      manifestHash,
      snapshotAt: new Date(value.snapshotAt),
      policyObservation,
      rowCount: value.rowCount,
      rowsHash: Buffer.from(value.rowsHash, 'hex'),
      sourceFingerprint: Buffer.from(value.sourceFingerprint, 'hex'),
      coveredDirtyIds: [],
    });
    await retireTaskBoardExport(db, dispatchContext, {
      ...scope,
      exportId: obsolete,
      reasonCode: 'POLICY_SUPERSEDED',
      leaseToken: lease.leaseToken,
    });
    const retired = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM task_execution.task_board_export_retirement WHERE export_id = $1`,
      [obsolete],
    );
    expect(retired.rows[0]?.count).toBe('1');
    const publishedValue = manifest(newUuidV7(), []);
    const publishedHash = Buffer.from(taskBoardManifestHash(publishedValue), 'hex');
    await recordTaskBoardManifest(db, dispatchContext, {
      ...scope,
      exportId: publishedValue.exportId,
      manifest: publishedValue,
      manifestHash: publishedHash,
      snapshotAt: new Date(publishedValue.snapshotAt),
      policyObservation,
      rowCount: publishedValue.rowCount,
      rowsHash: Buffer.from(publishedValue.rowsHash, 'hex'),
      sourceFingerprint: Buffer.from(publishedValue.sourceFingerprint, 'hex'),
      coveredDirtyIds: [],
    });
    await publishTaskBoardGeneration(
      db,
      dispatchContext,
      publishInput(
        publishedValue,
        {
          token: lease.leaseToken,
          ownerPrincipalId: dispatchContext.principalId,
          leaseUntil: lease.leaseUntil,
        },
        now,
      ),
    );
    await expect(
      retireTaskBoardExport(db, dispatchContext, {
        ...scope,
        exportId: publishedValue.exportId,
        reasonCode: 'POLICY_SUPERSEDED',
        leaseToken: lease.leaseToken,
      }),
    ).rejects.toMatchObject({ code: 'TASK_BOARD_EXPORT_ALREADY_PUBLISHED' });
  });

  it('rejects a row whose stored item drops a required field', async () => {
    const publishContext = contextFor(scope);
    const now = new Date((booking += 600_000));
    const lease = await claimTaskBoardLease(db, publishContext, {
      ...scope,
      owner: 'worker-k',
      leaseSeconds: 300,
      now,
    });
    if (lease === undefined) throw new Error('the export lease was not taken');
    const value = manifest(newUuidV7(), []);
    const published = await publishTaskBoardGeneration(
      db,
      publishContext,
      publishInput(
        value,
        {
          token: lease.leaseToken,
          ownerPrincipalId: publishContext.principalId,
          leaseUntil: lease.leaseUntil,
        },
        now,
      ),
    );
    const source = value.rows[0];
    if (source === undefined) throw new Error('the manifest lost its row');
    const trimmed = structuredClone(source) as unknown as { item: Record<string, unknown> };
    delete trimmed.item.title;
    await expect(
      admin.query(
        `INSERT INTO projection.task_board_row
           (generation_id, task_id, enterprise_id, project_id, row, delivery_item_ref)
         VALUES ($1,$2,$3,$4,$5::jsonb,NULL)`,
        [
          published.generationId,
          (source.item.taskRef as Record<string, unknown>).objectId,
          enterpriseId,
          projectId,
          JSON.stringify(trimmed),
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });
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
