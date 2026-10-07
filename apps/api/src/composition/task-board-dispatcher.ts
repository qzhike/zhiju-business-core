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
  AUTHORIZATION_REVOKED,
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
  readTaskBoardRecoveryTarget,
  retireTaskBoardExport,
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
  /**
   * Signs one own Decision for this exact step payload and immediately proves
   * it is still current, returning the transaction Context bound to that
   * Decision. A swapped export/manifest/fence/operation cannot reuse another
   * step's Decision because the closed payload is part of the binding.
   */
  readonly authorize: (
    boundary: TaskBoardTechnicalBoundary,
    projectRef: CanonicalJsonObject,
    payload: CanonicalJsonObject,
  ) => Promise<TaskExecutionTransactionContext>;
  /** Resolves the current fixed Board Policy of the Project. */
  readonly resolvePolicy: () => Promise<TaskBoardPolicyResolution>;
}

export interface TaskBoardDispatcherProject {
  readonly projectRef: CanonicalJsonObject;
  readonly scope: { readonly enterpriseId: string; readonly projectId: string };
  /** Service principal whose Decision context publishes the generation. */
  readonly publishPrincipalId: string;
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
  const policy = await ports.resolvePolicy();
  const claimContext = await ports.authorize('taskBoardDispatchManageV1', project.projectRef, {
    projectRef: project.projectRef,
    operation: 'CLAIM',
    owner: config.workerOwner,
    leaseSeconds: policy.rules.workerLeaseSeconds,
  });
  const lease = await claimTaskBoardLease(config.taskExecutionDb, claimContext, {
    enterpriseId: project.scope.enterpriseId,
    projectId: project.scope.projectId,
    owner: config.workerOwner,
    leaseSeconds: policy.rules.workerLeaseSeconds,
    now,
  });
  if (lease === undefined) return undefined;

  // Recovery: an export that was published but never acknowledged only owes
  // its confirmation, and one that was never published is replayed as it was
  // persisted (or retired when its Policy is no longer current).
  const recovery = await readTaskBoardRecoveryTarget(
    config.taskExecutionDb,
    claimContext,
    project.scope,
  );
  const recoveryGenerationId = recovery?.generationId ?? null;
  const recoveryPublishSequence = recovery?.publishSequence ?? null;
  if (recovery !== undefined && recoveryGenerationId !== null && recoveryPublishSequence !== null) {
    const exportId = recovery.exportId;
    const manifestHash = recovery.manifestHash.toString('hex');
    const generationId = recoveryGenerationId;
    const publishSequence = recoveryPublishSequence;
    const confirmContext = await ports.authorize('taskBoardDispatchManageV1', project.projectRef, {
      projectRef: project.projectRef,
      operation: 'CONFIRM',
      exportId,
      manifestHash,
      generationId,
      publishSequence,
      leaseToken: lease.leaseToken,
      coveredDirtyIds: [...recovery.coveredDirtyIds],
    });
    await recordTaskBoardPublication(config.taskExecutionDb, confirmContext, {
      enterpriseId: project.scope.enterpriseId,
      projectId: project.scope.projectId,
      exportId,
      manifestHash: recovery.manifestHash,
      generationId,
      publishSequence,
      leaseToken: lease.leaseToken,
    });
    await confirmTaskBoardExport(config.taskExecutionDb, confirmContext, {
      enterpriseId: project.scope.enterpriseId,
      projectId: project.scope.projectId,
      exportId,
      manifestHash: recovery.manifestHash,
      generationId,
      publishSequence,
      dirtyIds: recovery.coveredDirtyIds,
    });
    return { exportId, publishSequence, replayed: true };
  }

  let reuse = recovery;
  if (reuse !== undefined && reuse.policyObservation.contentHash !== policy.policyContentHash) {
    // The persisted export belongs to an obsolete Policy: retire it so a fresh
    // export under the current Policy can replace it instead of being blocked
    // forever by the same pending row.
    await retireTaskBoardExport(config.taskExecutionDb, claimContext, {
      enterpriseId: project.scope.enterpriseId,
      projectId: project.scope.projectId,
      exportId: reuse.exportId,
      reasonCode: 'POLICY_SUPERSEDED',
      leaseToken: lease.leaseToken,
    });
    reuse = undefined;
  }

  let manifest: TaskBoardSnapshotManifest;
  let manifestHash: string;
  let rowsHash: string;
  let sourceFingerprint: string;
  let coveredDirtyIds: readonly string[];
  let exportId: string;
  if (reuse !== undefined) {
    manifest = reuse.manifest as unknown as TaskBoardSnapshotManifest;
    exportId = reuse.exportId;
    manifestHash = reuse.manifestHash.toString('hex');
    rowsHash = reuse.rowsHash.toString('hex');
    sourceFingerprint = reuse.sourceFingerprint.toString('hex');
    coveredDirtyIds = [...reuse.coveredDirtyIds];
  } else {
    exportId = newUuidV7();
    const sourceContext = await ports.authorize('taskBoardSourceReadV1', project.projectRef, {
      projectRef: project.projectRef,
      exportId,
      policyRef: policy.policyRef,
    });
    const snapshot = await withTaskExecutionSnapshotTransaction(
      config.taskExecutionDb,
      sourceContext,
      async (trx, snapshotAt) => ({
        ...(await assembleTaskBoardRows(trx, project.scope, project.projectRef)),
        snapshotAt,
        dirty: await selectTaskBoardDirtyMarkers(trx, project.scope),
      }),
    );
    rowsHash = taskBoardRowsHash(snapshot.rows);
    sourceFingerprint = snapshot.sourceFingerprint;
    coveredDirtyIds = snapshot.dirty.map((marker) => marker.markerId);
    manifest = {
      exportId,
      projectRef: project.projectRef,
      snapshotAt: snapshot.snapshotAt.toISOString(),
      policyRef: policy.policyRef,
      policyObservation: policy.policyObservation,
      rows: snapshot.rows,
      rowCount: snapshot.rows.length,
      rowsHash,
      sourceFingerprint,
      coveredDirtyIds,
    };
    if (
      manifest.rowCount > policy.rules.maxSnapshotRows ||
      taskBoardManifestBytes(manifest) > policy.rules.maxSnapshotBytes
    ) {
      await recordTaskBoardProjectionFailure(config.taskExecutionDb, claimContext, {
        enterpriseId: project.scope.enterpriseId,
        projectId: project.scope.projectId,
        exportId: null,
        failureCode: 'TASK_BOARD_EXPORT_BUDGET_EXCEEDED',
        safeSummary: 'the complete Board export exceeded the declared Policy budget',
        now,
      });
      return undefined;
    }
    manifestHash = taskBoardManifestHash(manifest);
    const manifestContext = await ports.authorize('taskBoardDispatchManageV1', project.projectRef, {
      projectRef: project.projectRef,
      operation: 'MANIFEST',
      exportId,
      manifestHash,
      rowCount: manifest.rowCount,
      coveredDirtyIds: [...coveredDirtyIds],
    });
    await recordTaskBoardManifest(config.taskExecutionDb, manifestContext, {
      enterpriseId: project.scope.enterpriseId,
      projectId: project.scope.projectId,
      exportId,
      manifest,
      manifestHash: Buffer.from(manifestHash, 'hex'),
      snapshotAt: new Date(manifest.snapshotAt),
      policyObservation: policy.policyObservation,
      rowCount: manifest.rowCount,
      rowsHash: Buffer.from(rowsHash, 'hex'),
      sourceFingerprint: Buffer.from(sourceFingerprint, 'hex'),
      coveredDirtyIds,
    });
  }

  // The protected publish boundary re-resolves the Policy: a Policy Grant
  // revoked or a Policy superseded after the source read stops the publication
  // instead of publishing and confirming an obsolete manifest.
  const currentPolicy = await ports.resolvePolicy();
  if (currentPolicy.policyContentHash !== policy.policyContentHash) {
    await recordTaskBoardProjectionFailure(config.taskExecutionDb, claimContext, {
      enterpriseId: project.scope.enterpriseId,
      projectId: project.scope.projectId,
      exportId,
      failureCode: 'TASK_BOARD_POLICY_STALE',
      safeSummary: 'the Board Policy changed before this export could be published',
      now,
    });
    return undefined;
  }
  // The publish Decision binds this step's actual fields, including the exact
  // fence the caller is about to use.
  const publishContext = await ports.authorize('taskBoardProjectionPublishV1', project.projectRef, {
    projectRef: project.projectRef,
    exportId,
    manifestHash,
    policyRef: policy.policyRef,
    retentionSeconds: policy.rules.cursorTtlSeconds,
    fenceToken: lease.leaseToken,
    fenceOwnerPrincipalId: project.publishPrincipalId,
    fenceLeaseUntil: lease.leaseUntil.toISOString(),
  });
  const control = await readTaskBoardDispatch(config.taskExecutionDb, claimContext, project.scope);
  const leaseIsCurrent =
    control?.leaseToken === lease.leaseToken &&
    control.leaseOwner === config.workerOwner &&
    control.leaseUntil?.getTime() === lease.leaseUntil.getTime();
  if (!leaseIsCurrent)
    throw new TaskBoardDispatcherError(
      'TASK_BOARD_FENCE_REJECTED',
      'the export lease is no longer current',
    );
  const published = await publishTaskBoardGeneration(config.taskExecutionDb, publishContext, {
    enterpriseId: project.scope.enterpriseId,
    projectId: project.scope.projectId,
    projectRef: project.projectRef,
    exportId,
    manifest,
    manifestHash,
    rowsHash,
    sourceFingerprint,
    policyObservation: policy.policyObservation,
    snapshotAt: new Date(manifest.snapshotAt),
    retentionSeconds: policy.rules.cursorTtlSeconds,
    fence: {
      token: lease.leaseToken,
      ownerPrincipalId: project.publishPrincipalId,
      leaseUntil: lease.leaseUntil,
    },
    now,
  });
  const confirmContext = await ports.authorize('taskBoardDispatchManageV1', project.projectRef, {
    projectRef: project.projectRef,
    operation: 'CONFIRM',
    exportId,
    manifestHash,
    generationId: published.generationId,
    publishSequence: published.publishSequence,
    leaseToken: lease.leaseToken,
    coveredDirtyIds: [...coveredDirtyIds],
  });
  await recordTaskBoardPublication(config.taskExecutionDb, confirmContext, {
    enterpriseId: project.scope.enterpriseId,
    projectId: project.scope.projectId,
    exportId,
    manifestHash: Buffer.from(manifestHash, 'hex'),
    generationId: published.generationId,
    publishSequence: published.publishSequence,
    leaseToken: lease.leaseToken,
  });
  await confirmTaskBoardExport(config.taskExecutionDb, confirmContext, {
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
  const now = new Date();
  await ports.resolvePolicy();
  const maintainContext = await ports.authorize(
    'taskBoardProjectionMaintainV1',
    project.projectRef,
    { projectRef: project.projectRef, cutoff: now.toISOString() },
  );
  const result = await cleanupTaskBoardGenerations(config.taskExecutionDb, maintainContext, {
    enterpriseId: project.scope.enterpriseId,
    projectId: project.scope.projectId,
    now,
  });
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
    const configuredPolicy = config.boardPolicyRef(projectId);
    if (configuredPolicy === undefined)
      entryError('DEPENDENCY_UNAVAILABLE', 'no Board Policy is configured for this Project');
    /**
     * Each step resolves/re-proves under its own Decision whose closed payload
     * carries that step's actual fields, so a swapped export/manifest/fence or
     * another step's authority cannot satisfy it.
     */
    const resolveCurrentPolicy = async (): Promise<TaskBoardPolicyResolution> => {
      const issued = await auth.authorize(serviceDeps, 'taskBoardPolicyReadV1', {
        actorSnapshotRef: target.serviceSession.resolutionActorSnapshotRef,
        commandType: 'identity.resolve_policy',
        commandVersion: '1.0',
        commandPayloadHash: payloadHashOf({ policyRef: configuredPolicy }),
        authenticationContextHash: serviceSessionHash,
        targetRef: configuredPolicy,
      });
      if (issued.outcome !== 'ALLOW')
        entryError(AUTHORIZATION_REVOKED, 'Board Policy read was denied');
      return resolveTaskBoardPolicy({
        deps: serviceDeps,
        row: bootstrap,
        policyRef: configuredPolicy,
        actorSnapshotRef: target.serviceSession.resolutionActorSnapshotRef,
        authenticationContextHash: serviceSessionHash,
        policyDecisionRef: issued.authorizationDecisionRef,
        now,
      });
    };
    const ports: TaskBoardDispatcherPorts = {
      authorize: async (key, ref, payload) => {
        const stepHash = payloadHashOf(payload);
        const issued = await auth.authorize(serviceDeps, key, {
          actorSnapshotRef: target.serviceSession.resolutionActorSnapshotRef,
          commandType: BOUNDARY_OPERATION[key],
          commandVersion: '1.0',
          commandPayloadHash: stepHash,
          authenticationContextHash: serviceSessionHash,
          targetRef: ref as unknown as Common.ObjectRef,
        });
        if (issued.outcome !== 'ALLOW')
          entryError('AUTHORIZATION_REVOKED', `Board ${key} was denied`);
        const context = serviceContext(bootstrap, {
          id: issued.authorizationDecisionRef.objectId,
          hash: Buffer.from(issued.authorizationDecisionRef.contentHash.digest, 'hex'),
          expiresAt: new Date(issued.expiresAt),
        });
        // Prove the freshly signed Decision still covers this exact step
        // before it is used for the protected read/write.
        const proof = await auth.revalidate(serviceDeps, key, {
          decisionRef: issued.authorizationDecisionRef,
          expectedCommandType: BOUNDARY_OPERATION[key],
          expectedCommandVersion: '1.0',
          expectedCommandPayloadHash: stepHash,
          expectedAuthenticationContextHash: serviceSessionHash,
          expectedTargetRef: ref as unknown as Common.ObjectRef,
        });
        if (!proof.valid)
          entryError('AUTHORIZATION_REVOKED', `Board ${key} authority is no longer current`);
        return context;
      },
      resolvePolicy: resolveCurrentPolicy,
    };
    return {
      projectRef,
      scope: { enterpriseId, projectId },
      publishPrincipalId: bootstrap.principal_id,
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
