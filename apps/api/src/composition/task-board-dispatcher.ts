// IM-06 TD-05 (#248): the trusted Task Board export/publish pass.
//
// One pass per Project: take the TE export lease, assemble and persist the
// complete manifest of one new `exportId`, publish the generation through the
// Projection fence, then confirm exactly the dirty identities the manifest
// covered. A failure records a safe Projection failure and leaves the previous
// alias in place; the pass is finite and safe to replay.

import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  assembleTaskBoardRows,
  claimTaskBoardLease,
  cleanupTaskBoardGenerations,
  confirmTaskBoardExport,
  publishTaskBoardGeneration,
  recordTaskBoardManifest,
  recordTaskBoardProjectionFailure,
  selectTaskBoardDirtyMarkers,
  taskBoardManifestBytes,
  taskBoardManifestHash,
  taskBoardRowsHash,
  withTaskExecutionSnapshotTransaction,
  type TaskBoardPolicyResolution,
  type TaskBoardSnapshotManifest,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
import type { Kysely } from 'kysely';

export interface TaskBoardDispatcherProject {
  readonly projectRef: CanonicalJsonObject;
  readonly scope: { readonly enterpriseId: string; readonly projectId: string };
  /** SERVICE context of `execution.task_board.dispatch.manage.v1`. */
  readonly dispatchContext: TaskExecutionTransactionContext;
  /** SERVICE context of `execution.task_board.source.read.v1`. */
  readonly sourceContext: TaskExecutionTransactionContext;
  /** SERVICE context of `execution.task_board.projection.publish.v1`. */
  readonly publishContext: TaskExecutionTransactionContext;
  /** SERVICE context of `execution.task_board.projection.maintain.v1`. */
  readonly maintainContext: TaskExecutionTransactionContext;
  /** The already-resolved, still-current Board Policy of this Project. */
  readonly policy: TaskBoardPolicyResolution;
}

export interface TaskBoardDispatcherConfig {
  readonly taskExecutionDb: Kysely<TaskExecutionDb>;
  readonly workerOwner: string;
  readonly now?: (() => Date) | undefined;
}

export interface TaskBoardExportResult {
  readonly exportId: string;
  readonly publishSequence: number;
  readonly replayed: boolean;
}

/**
 * Run one finite export/publish pass. Returns `undefined` when the lease is
 * still held by another live owner, or when the complete export exceeded a
 * declared Policy resource bound (a safe failure is recorded instead).
 */
export async function runTaskBoardExportPass(
  config: TaskBoardDispatcherConfig,
  project: TaskBoardDispatcherProject,
): Promise<TaskBoardExportResult | undefined> {
  const now = (config.now ?? ((): Date => new Date()))();
  const lease = await claimTaskBoardLease(config.taskExecutionDb, project.dispatchContext, {
    enterpriseId: project.scope.enterpriseId,
    projectId: project.scope.projectId,
    owner: config.workerOwner,
    leaseSeconds: project.policy.rules.workerLeaseSeconds,
    now,
  });
  if (lease === undefined) return undefined;
  const snapshot = await withTaskExecutionSnapshotTransaction(
    config.taskExecutionDb,
    project.sourceContext,
    async (trx, snapshotAt) => ({
      ...(await assembleTaskBoardRows(trx, project.scope, project.projectRef)),
      snapshotAt,
      dirty: await selectTaskBoardDirtyMarkers(trx, project.scope),
    }),
  );
  const exportId = newUuidV7();
  const rowsHash = taskBoardRowsHash(snapshot.rows);
  const coveredDirtyIds = snapshot.dirty.map((marker) => marker.markerId);
  const manifest: TaskBoardSnapshotManifest = {
    exportId,
    projectRef: project.projectRef,
    snapshotAt: snapshot.snapshotAt.toISOString(),
    policyRef: project.policy.policyRef,
    policyObservation: project.policy.policyObservation,
    rows: snapshot.rows,
    rowCount: snapshot.rows.length,
    rowsHash,
    sourceFingerprint: snapshot.sourceFingerprint,
    coveredDirtyIds,
  };
  if (
    manifest.rowCount > project.policy.rules.maxSnapshotRows ||
    taskBoardManifestBytes(manifest) > project.policy.rules.maxSnapshotBytes
  ) {
    await recordTaskBoardProjectionFailure(config.taskExecutionDb, project.publishContext, {
      enterpriseId: project.scope.enterpriseId,
      projectId: project.scope.projectId,
      exportId: null,
      failureCode: 'TASK_BOARD_EXPORT_BUDGET_EXCEEDED',
      safeSummary: 'the complete Board export exceeded the declared Policy budget',
      now,
    });
    return undefined;
  }
  const manifestHash = taskBoardManifestHash(manifest);
  await recordTaskBoardManifest(config.taskExecutionDb, project.dispatchContext, {
    enterpriseId: project.scope.enterpriseId,
    projectId: project.scope.projectId,
    exportId,
    manifest,
    manifestHash: Buffer.from(manifestHash, 'hex'),
    snapshotAt: snapshot.snapshotAt,
    policyObservation: project.policy.policyObservation,
    rowCount: manifest.rowCount,
    rowsHash: Buffer.from(rowsHash, 'hex'),
    sourceFingerprint: Buffer.from(snapshot.sourceFingerprint, 'hex'),
    coveredDirtyIds,
  });
  const published = await publishTaskBoardGeneration(
    config.taskExecutionDb,
    project.publishContext,
    {
      enterpriseId: project.scope.enterpriseId,
      projectId: project.scope.projectId,
      projectRef: project.projectRef,
      exportId,
      manifest,
      manifestHash,
      rowsHash,
      sourceFingerprint: snapshot.sourceFingerprint,
      policyObservation: project.policy.policyObservation,
      snapshotAt: snapshot.snapshotAt,
      retentionSeconds: project.policy.rules.cursorTtlSeconds,
      fence: {
        token: lease.leaseToken,
        ownerPrincipalId: project.publishContext.principalId,
        leaseUntil: lease.leaseUntil,
      },
      now,
    },
  );
  await confirmTaskBoardExport(config.taskExecutionDb, project.dispatchContext, {
    enterpriseId: project.scope.enterpriseId,
    projectId: project.scope.projectId,
    exportId,
    manifestHash: Buffer.from(manifestHash, 'hex'),
    publishSequence: published.publishSequence,
    dirtyIds: coveredDirtyIds,
  });
  return { exportId, publishSequence: published.publishSequence, replayed: published.replayed };
}

/** Run one finite retention-maintenance pass; keeps the current alias. */
export async function runTaskBoardMaintenancePass(
  config: TaskBoardDispatcherConfig,
  project: TaskBoardDispatcherProject,
): Promise<number> {
  const now = (config.now ?? ((): Date => new Date()))();
  const result = await cleanupTaskBoardGenerations(
    config.taskExecutionDb,
    project.maintainContext,
    {
      enterpriseId: project.scope.enterpriseId,
      projectId: project.scope.projectId,
      now,
    },
  );
  return result.removedGenerations;
}
