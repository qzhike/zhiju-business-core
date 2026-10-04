// IM-06 TD-05 (#248): the trusted Task Board export/publish and maintenance
// passes.
//
// One export pass per Project: prove the current `taskBoardDispatchManageV1`
// authority, take the TE export lease, prove `taskBoardSourceReadV1`, assemble
// and persist the complete manifest of one new `exportId` under the current
// fixed Board Policy, prove `taskBoardProjectionPublishV1`, re-read the TE
// control (so a takeover during the export fails the publish), publish the
// generation through the Projection fence, record the publication proof and
// confirm exactly the dirty identities the manifest covered.
//
// Every protected step revalidates its own mapping first, so a still-valid
// Context can never be swapped for another step's protected read/write and a
// revoked Grant or superseded Policy fails the step instead of being ignored.

import type { Common } from '@zhiju/contracts';
import {
  createTaskBoardAuthorizationPort,
  type IdentityTransactionContext,
  type TaskBoardCapabilityCodes,
} from '@zhiju/identity-policy';
import {
  assembleTaskBoardRows,
  claimTaskBoardLease,
  cleanupTaskBoardGenerations,
  confirmTaskBoardExport,
  publishTaskBoardGeneration,
  readTaskBoardDispatch,
  recordTaskBoardManifest,
  recordTaskBoardPublication,
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
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import {
  assertActorBinding,
  createDecisionBoundary,
  decisionReference,
  entryError,
  payloadHashOf,
  record,
  sessionAuthenticationContextHash,
  type DecisionRow,
  type IdentityBoundaryConfig,
} from './decision-boundary.js';
import { resolveTaskBoardPolicy } from './task-board-policy.js';

/** Stable failure of one finite export/publish pass. */
export class TaskBoardDispatcherError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TaskBoardDispatcherError';
  }
}

const DISPATCH_OPERATION = 'execution.task_board.dispatch.manage.v1';
const SOURCE_OPERATION = 'execution.task_board.source.read.v1';
const PUBLISH_OPERATION = 'execution.task_board.projection.publish.v1';
const MAINTAIN_OPERATION = 'execution.task_board.projection.maintain.v1';

export type TaskBoardTechnicalBoundary =
  | 'taskBoardDispatchManageV1'
  | 'taskBoardSourceReadV1'
  | 'taskBoardProjectionPublishV1'
  | 'taskBoardProjectionMaintainV1';

/** The owning operation of each technical boundary. */
const BOUNDARY_OPERATION: Readonly<Record<TaskBoardTechnicalBoundary, string>> = {
  taskBoardDispatchManageV1: DISPATCH_OPERATION,
  taskBoardSourceReadV1: SOURCE_OPERATION,
  taskBoardProjectionPublishV1: PUBLISH_OPERATION,
  taskBoardProjectionMaintainV1: MAINTAIN_OPERATION,
};

export interface TaskBoardDispatcherPorts {
  /** Re-proves the current authority of one technical boundary. */
  readonly authorize: (
    boundary: TaskBoardTechnicalBoundary,
    projectRef: CanonicalJsonObject,
  ) => Promise<void>;
  /** Resolves the current fixed Board Policy of the Project. */
  readonly resolvePolicy: () => Promise<TaskBoardPolicyResolution>;
}

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
}

export interface TaskBoardDispatcherConfig {
  readonly taskExecutionDb: Kysely<TaskExecutionDb>;
  readonly workerOwner: string;
}

/** A prepared Project plus the authorization ports of its technical passes. */
export interface PreparedTaskBoardProject extends TaskBoardDispatcherProject {
  readonly ports: TaskBoardDispatcherPorts;
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
  ports: TaskBoardDispatcherPorts,
): Promise<TaskBoardExportResult | undefined> {
  const now = new Date();
  await ports.authorize('taskBoardDispatchManageV1', project.projectRef);
  const policy = await ports.resolvePolicy();
  const lease = await claimTaskBoardLease(config.taskExecutionDb, project.dispatchContext, {
    enterpriseId: project.scope.enterpriseId,
    projectId: project.scope.projectId,
    owner: config.workerOwner,
    leaseSeconds: policy.rules.workerLeaseSeconds,
    now,
  });
  if (lease === undefined) return undefined;

  await ports.authorize('taskBoardSourceReadV1', project.projectRef);
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
    policyRef: policy.policyRef,
    policyObservation: policy.policyObservation,
    rows: snapshot.rows,
    rowCount: snapshot.rows.length,
    rowsHash,
    sourceFingerprint: snapshot.sourceFingerprint,
    coveredDirtyIds,
  };
  if (
    manifest.rowCount > policy.rules.maxSnapshotRows ||
    taskBoardManifestBytes(manifest) > policy.rules.maxSnapshotBytes
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
    policyObservation: policy.policyObservation,
    rowCount: manifest.rowCount,
    rowsHash: Buffer.from(rowsHash, 'hex'),
    sourceFingerprint: Buffer.from(snapshot.sourceFingerprint, 'hex'),
    coveredDirtyIds,
  });

  await ports.authorize('taskBoardProjectionPublishV1', project.projectRef);
  // The publication boundary re-reads the current TE control and refuses a
  // lease that was taken over (or expired) while the export was assembled, so
  // an old worker can never publish through the takeover window.
  const control = await readTaskBoardDispatch(
    config.taskExecutionDb,
    project.dispatchContext,
    project.scope,
  );
  const leaseIsCurrent =
    control?.leaseToken === lease.leaseToken &&
    control.leaseOwner === config.workerOwner &&
    control.leaseUntil?.getTime() === lease.leaseUntil.getTime();
  if (!leaseIsCurrent)
    throw new TaskBoardDispatcherError(
      'TASK_BOARD_FENCE_REJECTED',
      'the export lease is no longer current',
    );
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
      policyObservation: policy.policyObservation,
      snapshotAt: snapshot.snapshotAt,
      retentionSeconds: policy.rules.cursorTtlSeconds,
      fence: {
        token: lease.leaseToken,
        ownerPrincipalId: project.publishContext.principalId,
        leaseUntil: lease.leaseUntil,
      },
      now,
    },
  );
  // The publication proof is recorded under the same live lease before any
  // dirty identity is acknowledged.
  await ports.authorize('taskBoardDispatchManageV1', project.projectRef);
  await recordTaskBoardPublication(config.taskExecutionDb, project.dispatchContext, {
    enterpriseId: project.scope.enterpriseId,
    projectId: project.scope.projectId,
    exportId,
    manifestHash: Buffer.from(manifestHash, 'hex'),
    generationId: published.generationId,
    publishSequence: published.publishSequence,
    leaseToken: lease.leaseToken,
  });
  await confirmTaskBoardExport(config.taskExecutionDb, project.dispatchContext, {
    enterpriseId: project.scope.enterpriseId,
    projectId: project.scope.projectId,
    exportId,
    manifestHash: Buffer.from(manifestHash, 'hex'),
    generationId: published.generationId,
    publishSequence: published.publishSequence,
    dirtyIds: coveredDirtyIds,
  });
  return { exportId, publishSequence: published.publishSequence, replayed: published.replayed };
}

/** Run one finite retention-maintenance pass; keeps the current alias. */
export async function runTaskBoardMaintenancePass(
  config: TaskBoardDispatcherConfig,
  project: TaskBoardDispatcherProject,
  ports: TaskBoardDispatcherPorts,
): Promise<number> {
  await ports.authorize('taskBoardProjectionMaintainV1', project.projectRef);
  const result = await cleanupTaskBoardGenerations(
    config.taskExecutionDb,
    project.maintainContext,
    {
      enterpriseId: project.scope.enterpriseId,
      projectId: project.scope.projectId,
      now: new Date(),
    },
  );
  return result.removedGenerations;
}

/** A trusted SERVICE bootstrap of one Project's technical passes. */
export interface TaskBoardDispatcherTarget {
  readonly projectRef: CanonicalJsonObject;
  readonly scope: { readonly enterpriseId: string; readonly projectId: string };
  readonly serviceSession: {
    readonly authenticationContextHash: Buffer;
    readonly resolutionActorSnapshotRef: Common.SnapshotRef;
    readonly bootstrapDecisionRef: Common.ContentAddressedRef;
  };
}

export interface TaskBoardDispatcherFactoryConfig extends IdentityBoundaryConfig {
  readonly taskExecutionDb: Kysely<TaskExecutionDb>;
  readonly capabilityCodes: TaskBoardCapabilityCodes;
  readonly capabilityCodeResolvePolicy: string;
  readonly workerOwner: string;
  readonly boardPolicyRef: (projectId: string) => Common.VersionedRef | undefined;
  readonly targets: readonly TaskBoardDispatcherTarget[];
}

/**
 * Wire the owning IdentityPolicy mappings and the fixed Board Policy into the
 * finite passes, so each protected step proves its own current authority and
 * the current Policy rather than trusting a caller-supplied Context.
 */
export function createTaskBoardDispatcher(config: TaskBoardDispatcherFactoryConfig) {
  const boundary = createDecisionBoundary(config);
  const auth = createTaskBoardAuthorizationPort({
    capabilityCodes: config.capabilityCodes,
    ...(config.now === undefined ? {} : { now: config.now }),
  });
  const now = config.now ?? ((): Date => new Date());

  function serviceContext(
    row: DecisionRow,
    decision: { readonly id: string; readonly hash: Buffer; readonly expiresAt: Date },
  ): TaskExecutionTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: row.principal_id,
      principalKind: 'SERVICE',
      actorSnapshotId: row.actor_snapshot_id,
      authorizationDecisionId: decision.id,
      authorizationDecisionHash: decision.hash,
      authorizationDecisionExpiresAt: decision.expiresAt,
      policySnapshotId: row.policy_snapshot_id,
      enterpriseId: row.enterprise_id,
      allowedProjectIds: row.project_id === null ? [] : [row.project_id],
      correlationId: decision.id,
    };
  }

  function identityContext(
    row: DecisionRow,
    actorSnapshotId?: string,
    decision?: { readonly id: string; readonly hash: Buffer; readonly expiresAt: Date },
  ): IdentityTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: row.principal_id,
      actorSnapshotId: actorSnapshotId ?? row.actor_snapshot_id,
      authorizationDecisionId: decision?.id ?? row.authorization_decision_id,
      authorizationDecisionHash: decision?.hash ?? row.payload_hash,
      authorizationDecisionExpiresAt: decision?.expiresAt ?? row.expires_at,
      enterpriseId: row.enterprise_id,
      allowedProjectIds: row.project_id === null ? [] : [row.project_id],
      correlationId: decision?.id ?? row.authorization_decision_id,
    };
  }

  async function prepare(target: TaskBoardDispatcherTarget): Promise<PreparedTaskBoardProject> {
    const projectRef = target.projectRef;
    const scopeRecord = record(projectRef.scope);
    const enterpriseId = String(scopeRecord.enterpriseId);
    const projectId = String(scopeRecord.projectId);
    const serviceSessionHash = sessionAuthenticationContextHash(target.serviceSession);
    const bootstrapRef = decisionReference(target.serviceSession.bootstrapDecisionRef);
    const bootstrap = await boundary.readDecisionRow(bootstrapRef, {
      scopeKind: 'PROJECT',
      enterpriseId,
      projectId,
    });
    if (bootstrap.principal_kind !== 'SERVICE')
      entryError('AUTHORIZATION_REVOKED', 'Board technical passes require a Service principal');
    assertActorBinding(target.serviceSession.resolutionActorSnapshotRef, bootstrap);
    const serviceDeps = boundary.identityDeps(identityContext(bootstrap));
    const payloadHash = payloadHashOf({ projectRef });
    const boundaryContexts: Record<TaskBoardTechnicalBoundary, TaskExecutionTransactionContext> = {
      taskBoardDispatchManageV1: serviceContext(bootstrap, {
        id: bootstrap.authorization_decision_id,
        hash: bootstrap.payload_hash,
        expiresAt: bootstrap.expires_at,
      }),
      taskBoardSourceReadV1: serviceContext(bootstrap, {
        id: bootstrap.authorization_decision_id,
        hash: bootstrap.payload_hash,
        expiresAt: bootstrap.expires_at,
      }),
      taskBoardProjectionPublishV1: serviceContext(bootstrap, {
        id: bootstrap.authorization_decision_id,
        hash: bootstrap.payload_hash,
        expiresAt: bootstrap.expires_at,
      }),
      taskBoardProjectionMaintainV1: serviceContext(bootstrap, {
        id: bootstrap.authorization_decision_id,
        hash: bootstrap.payload_hash,
        expiresAt: bootstrap.expires_at,
      }),
    };
    // Mint and prove one independent Decision per technical boundary from the
    // trusted bootstrap; each step re-proves its own mapping afterwards.
    for (const key of Object.keys(boundaryContexts) as TaskBoardTechnicalBoundary[]) {
      const issued = await auth.authorize(serviceDeps, key, {
        actorSnapshotRef: target.serviceSession.resolutionActorSnapshotRef,
        commandType: BOUNDARY_OPERATION[key],
        commandVersion: '1.0',
        commandPayloadHash: payloadHash,
        authenticationContextHash: serviceSessionHash,
        targetRef: projectRef as unknown as Common.ObjectRef,
      });
      if (issued.outcome !== 'ALLOW')
        entryError('AUTHORIZATION_REVOKED', `Board ${key} was denied`);
      boundaryContexts[key] = serviceContext(bootstrap, {
        id: issued.authorizationDecisionRef.objectId,
        hash: Buffer.from(issued.authorizationDecisionRef.contentHash.digest, 'hex'),
        expiresAt: new Date(issued.expiresAt),
      });
    }
    const configuredPolicy = config.boardPolicyRef(projectId);
    if (configuredPolicy === undefined)
      entryError('DEPENDENCY_UNAVAILABLE', 'no Board Policy is configured for this Project');
    const policyInput = {
      deps: serviceDeps,
      row: bootstrap,
      policyRef: configuredPolicy,
      actorSnapshotRef: target.serviceSession.resolutionActorSnapshotRef,
      authenticationContextHash: serviceSessionHash,
      capabilityCode: config.capabilityCodeResolvePolicy,
      now,
    };
    const ports: TaskBoardDispatcherPorts = {
      authorize: async (key, ref) => {
        const result = await auth.revalidate(serviceDeps, key, {
          decisionRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'identity.authorization_decision',
            objectId: boundaryContexts[key].authorizationDecisionId,
            scope: { enterpriseId, projectId },
            contentHash: {
              algorithm: 'SHA-256',
              canonicalizationVersion: '1',
              digest: boundaryContexts[key].authorizationDecisionHash.toString('hex'),
            },
          },
          expectedCommandType: BOUNDARY_OPERATION[key],
          expectedCommandVersion: '1.0',
          expectedCommandPayloadHash: payloadHash,
          expectedAuthenticationContextHash: serviceSessionHash,
          expectedTargetRef: ref as unknown as Common.ObjectRef,
        });
        if (!result.valid)
          entryError('AUTHORIZATION_REVOKED', `Board ${key} authority is no longer current`);
      },
      resolvePolicy: () => resolveTaskBoardPolicy(policyInput),
    };
    return {
      projectRef,
      scope: { enterpriseId, projectId },
      dispatchContext: boundaryContexts.taskBoardDispatchManageV1,
      sourceContext: boundaryContexts.taskBoardSourceReadV1,
      publishContext: boundaryContexts.taskBoardProjectionPublishV1,
      maintainContext: boundaryContexts.taskBoardProjectionMaintainV1,
      ports,
    };
  }

  return {
    /** Prepare the trusted Contexts and ports of one target Project. */
    prepare,
    async runExportPass(
      target: TaskBoardDispatcherTarget,
    ): Promise<TaskBoardExportResult | undefined> {
      const prepared = await prepare(target);
      return runTaskBoardExportPass(
        { taskExecutionDb: config.taskExecutionDb, workerOwner: config.workerOwner },
        prepared,
        prepared.ports,
      );
    },
    async runMaintenancePass(target: TaskBoardDispatcherTarget): Promise<number> {
      const prepared = await prepare(target);
      return runTaskBoardMaintenancePass(
        { taskExecutionDb: config.taskExecutionDb, workerOwner: config.workerOwner },
        prepared,
        prepared.ports,
      );
    },
  };
}
