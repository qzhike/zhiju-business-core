// IM-06 TD-05 (#248): the Task Board Projection store.
//
// The store lives in the shared `projection` schema and is reached only through
// `withTaskBoardProjectionTransaction`, i.e. as `projection_app`, which holds no
// `task_execution` privilege. A generation and its rows are INSERT-only; the
// single generated `publish_sequence` of a Project is allocated here, the alias
// and checkpoint move in the same transaction, and the local fence registration
// (monotonic token, owner and lease) is the only authority that lets a
// publication proceed. A replayed `exportId`/`manifestHash` reuses the original
// generation and sequence and never re-switches the alias.

import type { Kysely } from 'kysely';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  withTaskBoardProjectionTransaction,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
  type TaskBoardProjectionTransaction,
} from './task-execution-db.js';
import { CommandExecutionError } from './command-runner.js';
import { sql } from 'kysely';
import { object, textValue } from '../business/work-order-validation-plan.js';
import {
  taskBoardManifestHash,
  taskBoardRowsHash,
  type TaskBoardPolicyObservation,
  type TaskBoardSnapshotManifest,
  type TaskBoardSnapshotRow,
} from '../business/task-board-types.js';

export interface TaskBoardFenceRegistration {
  readonly token: number;
  readonly ownerPrincipalId: string;
  readonly leaseUntil: Date;
}

export interface PublishTaskBoardGenerationInput {
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly projectRef: CanonicalJsonObject;
  readonly exportId: string;
  readonly manifest: TaskBoardSnapshotManifest;
  readonly manifestHash: string;
  readonly rowsHash: string;
  readonly sourceFingerprint: string;
  readonly policyObservation: TaskBoardPolicyObservation;
  readonly snapshotAt: Date;
  readonly retentionSeconds: number;
  readonly fence: TaskBoardFenceRegistration;
  readonly now: Date;
}

export interface PublishTaskBoardGenerationResult {
  readonly generationId: string;
  readonly publishSequence: number;
  readonly replayed: boolean;
}

export interface TaskBoardProjectionRow {
  readonly taskId: string;
  readonly row: TaskBoardSnapshotRow;
}

export interface TaskBoardProjectionState {
  readonly alias?: {
    readonly generationId: string;
    readonly publishSequence: number;
    readonly switchedAt: Date;
  };
  readonly checkpoint?: {
    readonly lastGenerationId: string;
    readonly lastPublishSequence: number;
    readonly lastExportId: string;
  };
  readonly fence?: {
    readonly token: number;
    readonly ownerPrincipalId: string | null;
    readonly leaseUntil: Date | null;
    readonly version: number;
  };
  readonly generation?: {
    readonly generationId: string;
    readonly manifestHash: Buffer;
    readonly sourceFingerprint: Buffer;
    readonly rowsHash: Buffer;
    readonly rowCount: number;
    readonly publishSequence: number;
    readonly publishedAt: Date;
    readonly retentionUntil: Date;
    readonly policyObservation: CanonicalJsonObject;
    readonly snapshotAt: Date;
  };
  readonly rows: readonly TaskBoardProjectionRow[];
  readonly publication?: { readonly generationId: string; readonly publishSequence: number };
}

function projectionError(code: string, message: string): never {
  throw new CommandExecutionError(code, message);
}

function hex(value: string): Buffer {
  return Buffer.from(value, 'hex');
}

/**
 * Reverify the stored row mirror against the generation before any row is
 * returned, so a damaged stored generation cannot be read as a valid one.
 */
function assertStoredRows(
  generation: { readonly rows_hash: Buffer; readonly row_count: number },
  rows: readonly { readonly row: unknown }[],
): void {
  const combined = taskBoardRowsHash(rows.map((record) => record.row as TaskBoardSnapshotRow));
  if (combined !== generation.rows_hash.toString('hex') || rows.length !== generation.row_count)
    projectionError(
      'INTERNAL_CONTRACT_VIOLATION',
      'stored Board generation rows do not match its rows hash or count',
    );
}

async function readFence(
  trx: TaskBoardProjectionTransaction,
  enterpriseId: string,
  projectId: string,
): Promise<{ token: string; owner: string | null; leaseUntil: Date | null; version: string }> {
  const existing = await trx
    .selectFrom('projection.task_board_fence')
    .selectAll()
    .where('enterprise_id', '=', enterpriseId)
    .where('project_id', '=', projectId)
    .forUpdate()
    .executeTakeFirst();
  if (existing !== undefined)
    return {
      token: existing.token,
      owner: existing.owner_principal_id,
      leaseUntil: existing.lease_until,
      version: existing.version,
    };
  await trx
    .insertInto('projection.task_board_fence')
    .values({
      enterprise_id: enterpriseId,
      project_id: projectId,
      token: '0',
      owner_principal_id: null,
      lease_until: null,
      version: '0',
    })
    .execute();
  return { token: '0', owner: null, leaseUntil: null, version: '0' };
}

/**
 * Register the projection-owned fence for this publication and prove the
 * caller's claim is still current. Only a strictly higher token, or the same
 * token/owner extending its own lease, is accepted.
 */
/**
 * Verify the complete manifest mirrors before anything is persisted: the
 * canonical row and manifest hashes, the row count, the export identity and
 * the Project Scope are recomputed from the rows themselves, so a single
 * damaged field, mirror or row can never be published as a successful
 * generation.
 */
function verifyManifestMirrors(input: PublishTaskBoardGenerationInput): void {
  const manifest = input.manifest;
  if (manifest.exportId !== input.exportId)
    projectionError(
      'TASK_BOARD_MANIFEST_CONFLICT',
      'manifest export id does not match the request',
    );
  if (manifest.rowCount !== manifest.rows.length)
    projectionError('TASK_BOARD_MANIFEST_CONFLICT', 'manifest row count does not match its rows');
  if (taskBoardRowsHash(manifest.rows) !== input.rowsHash)
    projectionError('TASK_BOARD_MANIFEST_CONFLICT', 'rows hash does not match the canonical rows');
  if (taskBoardManifestHash(manifest) !== input.manifestHash)
    projectionError(
      'TASK_BOARD_MANIFEST_CONFLICT',
      'manifest hash does not match the canonical manifest',
    );
  if (Date.parse(manifest.snapshotAt) !== input.snapshotAt.getTime())
    projectionError('TASK_BOARD_MANIFEST_CONFLICT', 'manifest snapshot time does not match');
  const projectRef = object(manifest.projectRef);
  const scope = object(projectRef.scope);
  if (
    projectRef.kind !== 'OBJECT' ||
    projectRef.objectId !== input.projectId ||
    scope.enterpriseId !== input.enterpriseId ||
    scope.projectId !== input.projectId
  )
    projectionError('TASK_BOARD_MANIFEST_CONFLICT', 'manifest Project reference is out of scope');
  const seen = new Set<string>();
  for (const row of manifest.rows) {
    const taskRef = object(object(row.item).taskRef);
    const taskScope = object(taskRef.scope);
    const taskId = typeof taskRef.objectId === 'string' ? taskRef.objectId : '';
    if (
      taskRef.kind !== 'OBJECT' ||
      typeof taskRef.objectType !== 'string' ||
      taskRef.objectType.length === 0 ||
      taskId.length === 0 ||
      taskScope.enterpriseId !== input.enterpriseId ||
      taskScope.projectId !== input.projectId ||
      seen.has(taskId)
    )
      projectionError(
        'TASK_BOARD_MANIFEST_CONFLICT',
        'manifest row identity is invalid or duplicated',
      );
    seen.add(taskId);
  }
}

/** The database clock read inside the current transaction. */
async function trustedDatabaseNow(trx: TaskBoardProjectionTransaction): Promise<Date> {
  const stamp = await sql<{ readonly now: Date }>`SELECT clock_timestamp() AS now`.execute(trx);
  const now = stamp.rows[0]?.now;
  if (!(now instanceof Date))
    projectionError('DEPENDENCY_UNAVAILABLE', 'projection clock unavailable');
  return now;
}

async function registerFence(
  trx: TaskBoardProjectionTransaction,
  input: PublishTaskBoardGenerationInput,
): Promise<void> {
  // The fence row lock serializes every publication of this Project, so the
  // trusted clock must be read *after* taking it: a transaction that waited
  // past the lease end while another owner held the lock must not be allowed
  // to publish with a pre-wait timestamp.
  const current = await readFence(trx, input.enterpriseId, input.projectId);
  const trustedNow = await trustedDatabaseNow(trx);
  const token = Number(current.token);
  const monotonic =
    input.fence.token > token ||
    (input.fence.token === token &&
      current.owner === input.fence.ownerPrincipalId &&
      input.fence.leaseUntil.getTime() >= (current.leaseUntil?.getTime() ?? 0));
  if (!monotonic)
    projectionError('TASK_BOARD_FENCE_REJECTED', 'projection fence token is not current');
  if (input.fence.leaseUntil.getTime() <= trustedNow.getTime())
    projectionError('TASK_BOARD_FENCE_REJECTED', 'projection lease has already expired');
  await trx
    .updateTable('projection.task_board_fence')
    .set({
      token: String(input.fence.token),
      owner_principal_id: input.fence.ownerPrincipalId,
      lease_until: input.fence.leaseUntil,
      version: String(Number(current.version) + 1),
    })
    .where('enterprise_id', '=', input.enterpriseId)
    .where('project_id', '=', input.projectId)
    .execute();
}

async function nextPublishSequence(
  trx: TaskBoardProjectionTransaction,
  enterpriseId: string,
  projectId: string,
): Promise<number> {
  const row = await trx
    .selectFrom('projection.task_board_generation')
    .select((expression) => expression.fn.max('publish_sequence').as('max_sequence'))
    .where('enterprise_id', '=', enterpriseId)
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  const max = Number(row?.max_sequence ?? 0);
  if (!Number.isSafeInteger(max))
    projectionError('INTERNAL_CONTRACT_VIOLATION', 'publish sequence is not a safe integer');
  return max + 1;
}

/**
 * Publish one complete manifest as a new generation, or replay the original
 * result when the same `exportId`/`manifestHash` was already published.
 */
export async function publishTaskBoardGeneration(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  input: PublishTaskBoardGenerationInput,
): Promise<PublishTaskBoardGenerationResult> {
  return withTaskBoardProjectionTransaction(db, context, async (trx) => {
    verifyManifestMirrors(input);
    await registerFence(trx, input);
    const manifestHash = hex(input.manifestHash);
    const existing = await trx
      .selectFrom('projection.task_board_publication_outcome')
      .selectAll()
      .where('export_id', '=', input.exportId)
      .where('manifest_hash', '=', manifestHash)
      .executeTakeFirst();
    if (existing !== undefined)
      return {
        generationId: existing.generation_id,
        publishSequence: Number(existing.publish_sequence),
        replayed: true,
      };
    const conflicting = await trx
      .selectFrom('projection.task_board_generation')
      .selectAll()
      .where('export_id', '=', input.exportId)
      .executeTakeFirst();
    if (conflicting !== undefined)
      projectionError(
        'TASK_BOARD_MANIFEST_CONFLICT',
        'export id is already published with another manifest',
      );

    const generationId = newUuidV7();
    const publishSequence = await nextPublishSequence(trx, input.enterpriseId, input.projectId);
    const retentionUntil = new Date(input.now.getTime() + input.retentionSeconds * 1000);
    await trx
      .insertInto('projection.task_board_generation')
      .values({
        generation_id: generationId,
        export_id: input.exportId,
        enterprise_id: input.enterpriseId,
        project_id: input.projectId,
        project_ref: JSON.stringify(input.projectRef),
        manifest: JSON.stringify(input.manifest),
        manifest_hash: manifestHash,
        rows_hash: hex(input.rowsHash),
        row_count: input.manifest.rowCount,
        source_fingerprint: hex(input.sourceFingerprint),
        policy_observation: JSON.stringify(input.policyObservation),
        snapshot_at: input.snapshotAt,
        publish_sequence: String(publishSequence),
        published_at: input.now,
        retention_until: retentionUntil,
        created_by_principal_id: context.principalId,
      })
      .execute();
    if (input.manifest.rows.length > 0)
      await trx
        .insertInto('projection.task_board_row')
        .values(
          input.manifest.rows.map((row) => ({
            generation_id: generationId,
            task_id: textValue(object(row.item.taskRef).objectId),
            enterprise_id: input.enterpriseId,
            project_id: input.projectId,
            row: JSON.stringify(row),
            delivery_item_ref:
              row.filterKeys.deliveryItemRef === undefined
                ? null
                : JSON.stringify(row.filterKeys.deliveryItemRef),
          })),
        )
        .execute();
    // Re-check the lease immediately before the alias switch: the lock is
    // held for the whole transaction, so this is the actual publication
    // boundary.
    const boundaryNow = await trustedDatabaseNow(trx);
    if (input.fence.leaseUntil.getTime() <= boundaryNow.getTime())
      projectionError('TASK_BOARD_FENCE_REJECTED', 'projection lease has already expired');
    await trx
      .insertInto('projection.task_board_alias')
      .values({
        enterprise_id: input.enterpriseId,
        project_id: input.projectId,
        generation_id: generationId,
        publish_sequence: String(publishSequence),
        switched_at: input.now,
        switched_by_principal_id: context.principalId,
      })
      .onConflict((conflict) =>
        conflict.columns(['enterprise_id', 'project_id']).doUpdateSet({
          generation_id: generationId,
          publish_sequence: String(publishSequence),
          switched_at: input.now,
          switched_by_principal_id: context.principalId,
        }),
      )
      .execute();
    await trx
      .insertInto('projection.task_board_checkpoint')
      .values({
        enterprise_id: input.enterpriseId,
        project_id: input.projectId,
        last_generation_id: generationId,
        last_publish_sequence: String(publishSequence),
        last_export_id: input.exportId,
        updated_at: input.now,
      })
      .onConflict((conflict) =>
        conflict.columns(['enterprise_id', 'project_id']).doUpdateSet({
          last_generation_id: generationId,
          last_publish_sequence: String(publishSequence),
          last_export_id: input.exportId,
          updated_at: input.now,
        }),
      )
      .execute();
    await trx
      .insertInto('projection.task_board_publication_outcome')
      .values({
        export_id: input.exportId,
        manifest_hash: manifestHash,
        enterprise_id: input.enterpriseId,
        project_id: input.projectId,
        generation_id: generationId,
        publish_sequence: String(publishSequence),
        recorded_at: input.now,
      })
      .execute();
    return { generationId, publishSequence, replayed: false };
  });
}

/** Read one exact generation (and its rows) by id, independent of the alias. */
export async function readTaskBoardGenerationById(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  project: { readonly enterpriseId: string; readonly projectId: string },
  generationId: string,
): Promise<TaskBoardProjectionState> {
  return withTaskBoardProjectionTransaction(db, context, async (trx) => {
    const generation = await trx
      .selectFrom('projection.task_board_generation')
      .selectAll()
      .where('generation_id', '=', generationId)
      .where('enterprise_id', '=', project.enterpriseId)
      .where('project_id', '=', project.projectId)
      .executeTakeFirst();
    if (generation === undefined) return { rows: [] };
    const rows = await trx
      .selectFrom('projection.task_board_row')
      .selectAll()
      .where('generation_id', '=', generationId)
      .orderBy('task_id')
      .execute();
    assertStoredRows(generation, rows);
    const alias = await trx
      .selectFrom('projection.task_board_alias')
      .selectAll()
      .where('enterprise_id', '=', project.enterpriseId)
      .where('project_id', '=', project.projectId)
      .executeTakeFirst();
    const checkpoint = await trx
      .selectFrom('projection.task_board_checkpoint')
      .selectAll()
      .where('enterprise_id', '=', project.enterpriseId)
      .where('project_id', '=', project.projectId)
      .executeTakeFirst();
    return {
      ...(alias === undefined
        ? {}
        : {
            alias: {
              generationId: alias.generation_id,
              publishSequence: Number(alias.publish_sequence),
              switchedAt: alias.switched_at,
            },
          }),
      ...(checkpoint === undefined
        ? {}
        : {
            checkpoint: {
              lastGenerationId: checkpoint.last_generation_id,
              lastPublishSequence: Number(checkpoint.last_publish_sequence),
              lastExportId: checkpoint.last_export_id,
            },
          }),
      generation: {
        generationId: generation.generation_id,
        manifestHash: generation.manifest_hash,
        sourceFingerprint: generation.source_fingerprint,
        rowsHash: generation.rows_hash,
        rowCount: generation.row_count,
        publishSequence: Number(generation.publish_sequence),
        publishedAt: generation.published_at,
        retentionUntil: generation.retention_until,
        policyObservation: generation.policy_observation as CanonicalJsonObject,
        snapshotAt: generation.snapshot_at,
      },
      rows: rows.map((record) => ({
        taskId: record.task_id,
        row: record.row as TaskBoardSnapshotRow,
      })),
    };
  });
}

/** Find the retained generation with an exact `snapshotAt`, highest sequence. */
export async function findTaskBoardGenerationBySnapshotAt(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  project: { readonly enterpriseId: string; readonly projectId: string },
  snapshotAt: string,
): Promise<TaskBoardProjectionState | undefined> {
  return withTaskBoardProjectionTransaction(db, context, async (trx) => {
    const row = await trx
      .selectFrom('projection.task_board_generation')
      .select('generation_id')
      .where('enterprise_id', '=', project.enterpriseId)
      .where('project_id', '=', project.projectId)
      .where('snapshot_at', '=', new Date(snapshotAt))
      .orderBy('publish_sequence', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    return readTaskBoardGenerationById(db, context, project, row.generation_id);
  });
}

/** Read the most recent safe publication failure of one Project, if any. */
export async function readLatestTaskBoardFailure(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  project: { readonly enterpriseId: string; readonly projectId: string },
): Promise<{ readonly failureCode: string; readonly recordedAt: Date } | undefined> {
  return withTaskBoardProjectionTransaction(db, context, async (trx) => {
    const row = await trx
      .selectFrom('projection.task_board_failure')
      .select(['failure_code', 'recorded_at'])
      .where('enterprise_id', '=', project.enterpriseId)
      .where('project_id', '=', project.projectId)
      .orderBy('recorded_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : { failureCode: row.failure_code, recordedAt: row.recorded_at };
  });
}

/** Read the alias, checkpoint, fence, current generation and its rows. */
export async function readTaskBoardProjection(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  project: { readonly enterpriseId: string; readonly projectId: string },
): Promise<TaskBoardProjectionState> {
  return withTaskBoardProjectionTransaction(db, context, async (trx) => {
    const fence = await trx
      .selectFrom('projection.task_board_fence')
      .selectAll()
      .where('enterprise_id', '=', project.enterpriseId)
      .where('project_id', '=', project.projectId)
      .executeTakeFirst();
    const alias = await trx
      .selectFrom('projection.task_board_alias')
      .selectAll()
      .where('enterprise_id', '=', project.enterpriseId)
      .where('project_id', '=', project.projectId)
      .executeTakeFirst();
    const checkpoint = await trx
      .selectFrom('projection.task_board_checkpoint')
      .selectAll()
      .where('enterprise_id', '=', project.enterpriseId)
      .where('project_id', '=', project.projectId)
      .executeTakeFirst();
    const generation =
      alias === undefined
        ? undefined
        : await trx
            .selectFrom('projection.task_board_generation')
            .selectAll()
            .where('generation_id', '=', alias.generation_id)
            .executeTakeFirst();
    const rowRecords =
      generation === undefined
        ? []
        : await trx
            .selectFrom('projection.task_board_row')
            .selectAll()
            .where('generation_id', '=', generation.generation_id)
            .orderBy('task_id')
            .execute();
    if (generation !== undefined) assertStoredRows(generation, rowRecords);
    return {
      ...(alias === undefined
        ? {}
        : {
            alias: {
              generationId: alias.generation_id,
              publishSequence: Number(alias.publish_sequence),
              switchedAt: alias.switched_at,
            },
          }),
      ...(checkpoint === undefined
        ? {}
        : {
            checkpoint: {
              lastGenerationId: checkpoint.last_generation_id,
              lastPublishSequence: Number(checkpoint.last_publish_sequence),
              lastExportId: checkpoint.last_export_id,
            },
          }),
      ...(fence === undefined
        ? {}
        : {
            fence: {
              token: Number(fence.token),
              ownerPrincipalId: fence.owner_principal_id,
              leaseUntil: fence.lease_until,
              version: Number(fence.version),
            },
          }),
      ...(generation === undefined
        ? {}
        : {
            generation: {
              generationId: generation.generation_id,
              manifestHash: generation.manifest_hash,
              sourceFingerprint: generation.source_fingerprint,
              rowsHash: generation.rows_hash,
              rowCount: generation.row_count,
              publishSequence: Number(generation.publish_sequence),
              publishedAt: generation.published_at,
              retentionUntil: generation.retention_until,
              policyObservation: generation.policy_observation as CanonicalJsonObject,
              snapshotAt: generation.snapshot_at,
            },
          }),
      rows: rowRecords.map((record) => ({
        taskId: record.task_id,
        row: record.row as TaskBoardSnapshotRow,
      })),
    };
  });
}

/** Record one safe publication failure; never a body, secret or source row. */
export async function recordTaskBoardProjectionFailure(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  input: {
    readonly enterpriseId: string;
    readonly projectId: string;
    readonly exportId: string | null;
    readonly failureCode: string;
    readonly safeSummary: string;
    readonly now: Date;
  },
): Promise<void> {
  await withTaskBoardProjectionTransaction(db, context, async (trx) => {
    await trx
      .insertInto('projection.task_board_failure')
      .values({
        failure_id: newUuidV7(),
        enterprise_id: input.enterpriseId,
        project_id: input.projectId,
        export_id: input.exportId,
        failure_code: input.failureCode,
        safe_summary: input.safeSummary,
        recorded_at: input.now,
        recorded_by_principal_id: context.principalId,
      })
      .execute();
  });
}

/**
 * Clean up only expired generations that are not the current alias, keeping
 * the publication outcome (the idempotency proof) and every business fact.
 */
export async function cleanupTaskBoardGenerations(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  input: { readonly enterpriseId: string; readonly projectId: string; readonly now: Date },
): Promise<{ readonly removedGenerations: number }> {
  return withTaskBoardProjectionTransaction(db, context, async (trx) => {
    const alias = await trx
      .selectFrom('projection.task_board_alias')
      .selectAll()
      .where('enterprise_id', '=', input.enterpriseId)
      .where('project_id', '=', input.projectId)
      .executeTakeFirst();
    const expired = await trx
      .selectFrom('projection.task_board_generation')
      .select('generation_id')
      .where('enterprise_id', '=', input.enterpriseId)
      .where('project_id', '=', input.projectId)
      .where('retention_until', '<=', input.now)
      .where('generation_id', '!=', alias?.generation_id ?? '00000000-0000-7000-8000-000000000000')
      .execute();
    if (expired.length === 0) return { removedGenerations: 0 };
    const ids = expired.map((row) => row.generation_id);
    await trx.deleteFrom('projection.task_board_row').where('generation_id', 'in', ids).execute();
    await trx
      .deleteFrom('projection.task_board_generation')
      .where('generation_id', 'in', ids)
      .execute();
    return { removedGenerations: ids.length };
  });
}
