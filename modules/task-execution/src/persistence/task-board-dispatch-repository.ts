// IM-06 TD-05 (#248): the TaskExecution-owned Board export/dispatch boundary.
//
// Every call runs inside a `task_execution_app` transaction and goes through
// the V7014 owning SECURITY DEFINER functions, so the dispatch lease, the
// immutable manifest record and the exact dirty confirmation can never be
// synthesized by a caller that only presents rows. The repository returns
// plain values; it writes no business fact.

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  withTaskExecutionTransaction,
  type TaskExecutionDb,
  type TaskExecutionTransaction,
  type TaskExecutionTransactionContext,
} from './task-execution-db.js';
import { CommandExecutionError } from './command-runner.js';
import type {
  TaskBoardPolicyObservation,
  TaskBoardSnapshotManifest,
} from '../business/task-board-types.js';

export interface TaskBoardDispatchLease {
  readonly leaseToken: number;
  readonly leaseUntil: Date;
  readonly version: number;
}

export interface TaskBoardDispatchState {
  readonly leaseToken: number;
  readonly leaseOwner: string | null;
  readonly leaseUntil: Date | null;
  readonly version: number;
  readonly lastExportId: string | null;
  readonly lastManifestHash: Buffer | null;
  readonly lastPublishSequence: number | null;
}

export interface TaskBoardDirtyMarker {
  readonly markerId: string;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceVersion: number | null;
  readonly sourceHash: Buffer | null;
}

export interface TaskBoardHealth {
  readonly pendingDirtyCount: number;
  readonly leaseToken: number;
  readonly leaseUntil: Date | null;
}

export interface TaskBoardManifestRecord {
  readonly exportId: string;
  readonly manifestHash: Buffer;
  readonly snapshotAt: Date;
  readonly policyObservation: CanonicalJsonObject;
  readonly rowCount: number;
  readonly rowsHash: Buffer;
  readonly sourceFingerprint: Buffer;
  readonly coveredDirtyIds: readonly string[];
}

const DISPATCH_DOMAIN_CODES = [
  'TASK_BOARD_LEASE_INVALID',
  'TASK_BOARD_LEASE_NOT_CURRENT',
  'TASK_BOARD_PUBLICATION_CONFLICT',
  'TASK_BOARD_NOT_PUBLISHED',
  'TASK_BOARD_MANIFEST_CONFLICT',
  'TASK_BOARD_DIRTY_NOT_COVERED',
  'TASK_BOARD_DISPATCH_MISSING',
] as const;

/**
 * Surface the owning function's stable domain code instead of the raw
 * SQLSTATE: the V7014 helpers raise `RAISE EXCEPTION '<CODE>' USING
 * ERRCODE='23514'`, so the code is the message and never a payload.
 */
function mapDispatchError(error: unknown): never {
  if (error instanceof Error) {
    const code = DISPATCH_DOMAIN_CODES.find((candidate) => error.message.includes(candidate));
    if (code !== undefined) throw new CommandExecutionError(code, code);
  }
  throw error;
}

function safeNumber(value: string | number | bigint | null, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed))
    throw new CommandExecutionError(
      'INTERNAL_CONTRACT_VIOLATION',
      `${field} is not a safe integer`,
    );
  return parsed;
}

/** Take or renew the per-Project export lease; `undefined` means busy. */
export async function claimTaskBoardLease(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  input: {
    readonly enterpriseId: string;
    readonly projectId: string;
    readonly owner: string;
    readonly leaseSeconds: number;
    readonly now: Date;
  },
): Promise<TaskBoardDispatchLease | undefined> {
  return withTaskExecutionTransaction(db, context, async (trx) => {
    const result = (
      await sql<{
        lease_token: string;
        lease_until: Date;
        version: string;
      }>`SELECT lease_token,lease_until,version FROM task_execution.task_board_dispatch_claim(${input.enterpriseId}::uuid,${input.projectId}::uuid,${input.owner},${input.leaseSeconds},${input.now})`.execute(
        trx,
      )
    ).rows[0];
    if (result === undefined) return undefined;
    return {
      leaseToken: safeNumber(result.lease_token, 'lease_token'),
      leaseUntil: result.lease_until,
      version: safeNumber(result.version, 'version'),
    };
  }).catch(mapDispatchError);
}

/** Read the current dispatch control row of one Project. */
export async function readTaskBoardDispatch(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  project: { readonly enterpriseId: string; readonly projectId: string },
): Promise<TaskBoardDispatchState | undefined> {
  return withTaskExecutionTransaction(db, context, async (trx) => {
    const row = (
      await sql<{
        lease_token: string;
        lease_owner: string | null;
        lease_until: Date | null;
        version: string;
        last_export_id: string | null;
        last_manifest_hash: Buffer | null;
        last_publish_sequence: string | null;
      }>`SELECT lease_token,lease_owner,lease_until,version,last_export_id,last_manifest_hash,last_publish_sequence FROM task_execution.task_board_dispatch_state(${project.enterpriseId}::uuid,${project.projectId}::uuid)`.execute(
        trx,
      )
    ).rows[0];
    if (row === undefined) return undefined;
    return {
      leaseToken: safeNumber(row.lease_token, 'lease_token'),
      leaseOwner: row.lease_owner,
      leaseUntil: row.lease_until,
      version: safeNumber(row.version, 'version'),
      lastExportId: row.last_export_id,
      lastManifestHash: row.last_manifest_hash,
      lastPublishSequence:
        row.last_publish_sequence === null
          ? null
          : safeNumber(row.last_publish_sequence, 'last_publish_sequence'),
    };
  });
}

/** Persist the complete immutable manifest of one pre-allocated export. */
export async function recordTaskBoardManifest(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  input: {
    readonly enterpriseId: string;
    readonly projectId: string;
    readonly exportId: string;
    readonly manifest: CanonicalJsonObject | TaskBoardSnapshotManifest;
    readonly manifestHash: Buffer;
    readonly snapshotAt: Date;
    readonly policyObservation: CanonicalJsonObject | TaskBoardPolicyObservation;
    readonly rowCount: number;
    readonly rowsHash: Buffer;
    readonly sourceFingerprint: Buffer;
    readonly coveredDirtyIds: readonly string[];
  },
): Promise<void> {
  try {
    await withTaskExecutionTransaction(db, context, async (trx) => {
      await sql`SELECT task_execution.task_board_manifest_record(${input.exportId}::uuid,${input.enterpriseId}::uuid,${input.projectId}::uuid,${JSON.stringify(input.manifest)}::jsonb,${input.manifestHash},${input.snapshotAt},${JSON.stringify(input.policyObservation)}::jsonb,${input.rowCount},${input.rowsHash},${input.sourceFingerprint},${[...input.coveredDirtyIds]}::uuid[],${context.principalId}::uuid)`.execute(
        trx,
      );
    });
  } catch (error) {
    mapDispatchError(error);
  }
}

/** Read the exact persisted manifest of one export id. */
export async function readTaskBoardManifest(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  project: { readonly enterpriseId: string; readonly projectId: string },
  exportId: string,
): Promise<TaskBoardManifestRecord | undefined> {
  return withTaskExecutionTransaction(db, context, async (trx) => {
    const row = (
      await sql<{
        export_id: string;
        manifest_hash: Buffer;
        snapshot_at: Date;
        policy_observation: CanonicalJsonObject;
        row_count: number;
        rows_hash: Buffer;
        source_fingerprint: Buffer;
        covered_dirty_ids: string[];
      }>`SELECT export_id,manifest_hash,snapshot_at,policy_observation,row_count,rows_hash,source_fingerprint,covered_dirty_ids FROM task_execution.task_board_manifest_read(${exportId}::uuid,${project.enterpriseId}::uuid,${project.projectId}::uuid)`.execute(
        trx,
      )
    ).rows[0];
    if (row === undefined) return undefined;
    return {
      exportId: row.export_id,
      manifestHash: row.manifest_hash,
      snapshotAt: row.snapshot_at,
      policyObservation: row.policy_observation,
      rowCount: row.row_count,
      rowsHash: row.rows_hash,
      sourceFingerprint: row.source_fingerprint,
      coveredDirtyIds: row.covered_dirty_ids,
    };
  }).catch(mapDispatchError);
}

/** Confirm exactly the dirty identities the published manifest covered. */
export async function confirmTaskBoardExport(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  input: {
    readonly enterpriseId: string;
    readonly projectId: string;
    readonly exportId: string;
    readonly manifestHash: Buffer;
    readonly generationId: string;
    readonly publishSequence: number;
    readonly dirtyIds: readonly string[];
  },
): Promise<void> {
  try {
    await withTaskExecutionTransaction(db, context, async (trx) => {
      await sql`SELECT task_execution.task_board_dispatch_confirm(${input.exportId}::uuid,${input.enterpriseId}::uuid,${input.projectId}::uuid,${input.manifestHash},${input.generationId}::uuid,${input.publishSequence},${[...input.dirtyIds]}::uuid[],${context.principalId}::uuid)`.execute(
        trx,
      );
    });
  } catch (error) {
    mapDispatchError(error);
  }
}

/**
 * Read the newest persisted manifest of one Project that has no committed
 * publication proof yet, so an interrupted export is replayed as it was
 * persisted instead of being replaced by a fresh export.
 */
export async function readPendingTaskBoardManifest(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  project: { readonly enterpriseId: string; readonly projectId: string },
): Promise<(TaskBoardManifestRecord & { readonly manifest: CanonicalJsonObject }) | undefined> {
  return withTaskExecutionTransaction(db, context, async (trx) => {
    const row = (
      await sql<{
        export_id: string;
        manifest: CanonicalJsonObject;
        manifest_hash: Buffer;
        snapshot_at: Date;
        policy_observation: CanonicalJsonObject;
        row_count: number;
        rows_hash: Buffer;
        source_fingerprint: Buffer;
        covered_dirty_ids: string[];
      }>`SELECT export_id,manifest,manifest_hash,snapshot_at,policy_observation,row_count,rows_hash,source_fingerprint,covered_dirty_ids FROM task_execution.task_board_manifest_pending(${project.enterpriseId}::uuid,${project.projectId}::uuid)`.execute(
        trx,
      )
    ).rows[0];
    if (row === undefined) return undefined;
    return {
      exportId: row.export_id,
      manifest: row.manifest,
      manifestHash: row.manifest_hash,
      snapshotAt: row.snapshot_at,
      policyObservation: row.policy_observation,
      rowCount: row.row_count,
      rowsHash: row.rows_hash,
      sourceFingerprint: row.source_fingerprint,
      coveredDirtyIds: row.covered_dirty_ids,
    };
  }).catch(mapDispatchError);
}

/**
 * Record the immutable publication proof of one manifest under the live
 * export lease. Confirmation requires this exact record, so an export that was
 * never published can never acknowledge its dirty identities.
 */
export async function recordTaskBoardPublication(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  input: {
    readonly enterpriseId: string;
    readonly projectId: string;
    readonly exportId: string;
    readonly manifestHash: Buffer;
    readonly generationId: string;
    readonly publishSequence: number;
    readonly leaseToken: number;
  },
): Promise<void> {
  try {
    await withTaskExecutionTransaction(db, context, async (trx) => {
      await sql`SELECT task_execution.task_board_dispatch_record_publication(${input.exportId}::uuid,${input.enterpriseId}::uuid,${input.projectId}::uuid,${input.manifestHash},${input.generationId}::uuid,${input.publishSequence},${input.leaseToken})`.execute(
        trx,
      );
    });
  } catch (error) {
    mapDispatchError(error);
  }
}

/** Read the pending dirty markers of one Project. */
export async function readTaskBoardDirtyMarkers(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  project: { readonly enterpriseId: string; readonly projectId: string },
): Promise<readonly TaskBoardDirtyMarker[]> {
  return withTaskExecutionTransaction(db, context, (trx) =>
    selectTaskBoardDirtyMarkers(trx, project),
  );
}

/**
 * Read the dirty markers visible inside an already-open owning snapshot, so a
 * full export covers exactly the identities committed before it.
 */
export async function selectTaskBoardDirtyMarkers(
  trx: TaskExecutionTransaction,
  project: { readonly enterpriseId: string; readonly projectId: string },
): Promise<readonly TaskBoardDirtyMarker[]> {
  const rows = await trx
    .selectFrom('task_execution.task_board_dirty')
    .selectAll()
    .where('enterprise_id', '=', project.enterpriseId)
    .where('project_id', '=', project.projectId)
    .orderBy('created_at')
    .orderBy('marker_id')
    .execute();
  return rows.map((row) => ({
    markerId: row.marker_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceVersion:
      row.source_version === null ? null : safeNumber(row.source_version, 'source_version'),
    sourceHash: row.source_hash,
  }));
}

/** Read the source-health observation (dirty count + current lease). */
export async function readTaskBoardHealth(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  project: { readonly enterpriseId: string; readonly projectId: string },
): Promise<TaskBoardHealth | undefined> {
  return withTaskExecutionTransaction(db, context, async (trx) => {
    const row = (
      await sql<{
        pending_dirty_count: string;
        lease_token: string;
        lease_until: Date | null;
      }>`SELECT pending_dirty_count,lease_token,lease_until FROM task_execution.task_board_health(${project.enterpriseId}::uuid,${project.projectId}::uuid)`.execute(
        trx,
      )
    ).rows[0];
    if (row === undefined) return undefined;
    return {
      pendingDirtyCount: safeNumber(row.pending_dirty_count, 'pending_dirty_count'),
      leaseToken: safeNumber(row.lease_token, 'lease_token'),
      leaseUntil: row.lease_until,
    };
  });
}
