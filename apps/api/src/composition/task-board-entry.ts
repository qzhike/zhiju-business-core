// IM-06 TD-05 (#248): the trusted composition entry of
// `execution.get_task_board_slice@1.0` (Spec 003 §12, Spec 001 §15.19, shared
// API IM06-BOARD).
//
// The transport presents the Human Query Envelope together with a trusted
// Board session. This entry:
//
//   1. validates the registered Envelope, its exact Project reference and the
//      Human Decision (`taskBoardReadHumanV1`);
//   2. proves the independent SERVICE source Decision (`taskBoardSourceReadV1`)
//      that covers the same Project Root, then mints the SERVICE health and
//      Policy-resolution Decisions from that bootstrap;
//   3. resolves the fixed Project-scoped Board Policy through the owning
//      `identity.resolve_policy@1.0` entry and validates the closed profile;
//   4. runs the owning Board handler over the Projection or the authoritative
//      owning snapshot, then revalidates Human + service Decisions before the
//      complete QueryResult Envelope leaves the entry.
//
// The entry starts no publication and writes no business fact. Its only
// technical writes are the IdentityPolicy Decisions it signs and the platform
// transaction Context housekeeping of the owning reads.

import { getContractRegistry, type Common } from '@zhiju/contracts';
import {
  AUTHORIZATION_REVOKED,
  createTaskBoardAuthorizationPort,
  taskBoardAuthorizationSourceHash,
  type IdentityCommandDeps,
  type IdentityTransactionContext,
  type SelectedAuthorizationGrant,
  type TaskBoardAuthorizationSourceEntry,
  type TaskBoardCapabilityCodes,
  type TaskBoardCapabilityKey,
} from '@zhiju/identity-policy';
import {
  assembleTaskBoardRows,
  findTaskBoardGenerationBySnapshotAt,
  handleGetTaskBoardSlice,
  readLatestTaskBoardFailure,
  readTaskBoardGenerationById,
  readTaskBoardHealth,
  readTaskBoardProjection,
  withTaskExecutionSnapshotTransaction,
  type TaskBoardConsistency,
  type TaskBoardPolicyResolution,
  type TaskBoardReadPorts,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
import { sha256CanonicalJson, type CanonicalJsonObject } from '@zhiju/shared-kernel';
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
import type { InitialContextSession } from './initial-context-entry.js';

/** Trusted handles plus one capability code per approved Board boundary. */
export interface TaskBoardEntryConfig extends IdentityBoundaryConfig {
  readonly taskExecutionDb: Kysely<TaskExecutionDb>;
  readonly capabilityCodes: TaskBoardCapabilityCodes;
  /** Trusted server cursor secret; never a Decision hash. */
  readonly cursorKey: { readonly keyId: number; readonly secret: Buffer };
  /** Trusted fixed Project-scoped Board Policy selector of one Project. */
  readonly boardPolicyRef: (projectId: string) => Common.VersionedRef | undefined;
}

/** The trusted Board session: one Human session plus its SERVICE bootstrap. */
export interface TaskBoardSession extends InitialContextSession {
  readonly serviceSession: {
    readonly authenticationContextHash: Buffer;
    readonly resolutionActorSnapshotRef: Common.SnapshotRef;
    readonly sourceDecisionRef: Common.ContentAddressedRef;
  };
}

const QUERY = 'execution.get_task_board_slice';
const QUERY_VERSION = '1.0';
const QUERY_PURPOSE = 'task.execution.get_task_board_slice';
const SOURCE_OPERATION = 'execution.task_board.source.read.v1';
const HEALTH_OPERATION = 'execution.task_board.health.read.v1';
const RESOLVE_POLICY_COMMAND = 'identity.resolve_policy';
const RESOLVE_POLICY_PURPOSE = 'identity.policy.resolve_policy';

/** Exact owning operation of every Board mapping (Spec 001 §15.19). */
const BOARD_OPERATIONS: Readonly<Record<TaskBoardCapabilityKey, string>> = {
  taskBoardReadHumanV1: QUERY,
  taskBoardSourceReadV1: SOURCE_OPERATION,
  taskBoardHealthReadV1: HEALTH_OPERATION,
  taskBoardDispatchManageV1: 'execution.task_board.dispatch.manage.v1',
  taskBoardProjectionPublishV1: 'execution.task_board.projection.publish.v1',
  taskBoardProjectionMaintainV1: 'execution.task_board.projection.maintain.v1',
  taskBoardPolicyReadV1: RESOLVE_POLICY_COMMAND,
};

const CONSISTENCY_VALUES: Readonly<Record<string, TaskBoardConsistency>> = {
  AUTHORITATIVE: 'AUTHORITATIVE',
  SNAPSHOT_AT_LEAST: 'SNAPSHOT_AT_LEAST',
  PROJECTION_OK: 'PROJECTION_OK',
};

function serviceContext(
  row: DecisionRow,
  correlationId: string,
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
    correlationId,
  };
}

function authorizationEntry(
  configKey: string,
  capabilityCode: string,
  commandType: string,
  purpose: string,
  row: DecisionRow,
  grant: SelectedAuthorizationGrant | undefined,
): TaskBoardAuthorizationSourceEntry {
  if (grant === undefined)
    entryError(AUTHORIZATION_REVOKED, 'the Board authorization source has no selected Grant');
  return {
    grant,
    capabilityConfigKey: configKey,
    capabilityCode,
    commandType,
    commandVersion: QUERY_VERSION,
    purpose,
    principalId: row.principal_id,
    principalKind: row.principal_kind,
    actorSnapshotId: row.actor_snapshot_id,
    actorSnapshotPayloadHash: row.actor_snapshot_payload_hash.toString('hex'),
    enterpriseId: row.enterprise_id,
    projectId: row.project_id,
    policySnapshotId: row.policy_snapshot_id,
    policySnapshotPayloadHash: row.policy_snapshot_payload_hash.toString('hex'),
  };
}

export function createTaskBoardEntry(config: TaskBoardEntryConfig) {
  const registry = getContractRegistry();
  const boundary = createDecisionBoundary(config);
  const auth = createTaskBoardAuthorizationPort({
    capabilityCodes: config.capabilityCodes,
    ...(config.now === undefined ? {} : { now: config.now }),
  });
  const now = config.now ?? ((): Date => new Date());

  function identityContext(row: DecisionRow, actorSnapshotId?: string): IdentityTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: row.principal_id,
      actorSnapshotId: actorSnapshotId ?? row.actor_snapshot_id,
      authorizationDecisionId: row.authorization_decision_id,
      authorizationDecisionHash: row.payload_hash,
      authorizationDecisionExpiresAt: row.expires_at,
      enterpriseId: row.enterprise_id,
      allowedProjectIds: row.project_id === null ? [] : [row.project_id],
      correlationId: row.authorization_decision_id,
    };
  }

  /**
   * Mint the owning `taskBoardPolicyReadV1` Decision for the exact VERSIONED
   * Policy target under the SERVICE bootstrap, then resolve the Policy through
   * the owning entry with that Decision.
   */
  async function resolveBoardPolicy(
    policyRef: Common.VersionedRef,
    row: DecisionRow,
    session: TaskBoardSession,
    serviceSessionHash: Buffer,
    deps: IdentityCommandDeps,
  ): Promise<{
    readonly resolution: TaskBoardPolicyResolution;
    readonly decisionRef: Common.ContentAddressedRef;
  }> {
    const issued = await auth.authorize(deps, 'taskBoardPolicyReadV1', {
      actorSnapshotRef: session.serviceSession.resolutionActorSnapshotRef,
      commandType: RESOLVE_POLICY_COMMAND,
      commandVersion: '1.0',
      commandPayloadHash: payloadHashOf({ policyRef }),
      authenticationContextHash: serviceSessionHash,
      targetRef: policyRef,
    });
    if (issued.outcome !== 'ALLOW')
      entryError(AUTHORIZATION_REVOKED, 'Board Policy read was denied');
    const resolution = await resolveTaskBoardPolicy({
      deps,
      row,
      policyRef,
      actorSnapshotRef: session.serviceSession.resolutionActorSnapshotRef,
      authenticationContextHash: serviceSessionHash,
      policyDecisionRef: issued.authorizationDecisionRef,
      now,
    });
    return { resolution, decisionRef: issued.authorizationDecisionRef };
  }

  return {
    async getTaskBoardSlice(value: unknown, session: TaskBoardSession) {
      const envelope = record(structuredClone(value));
      if (envelope.queryType !== QUERY || envelope.queryVersion !== QUERY_VERSION)
        entryError('API_CONTRACT_TYPE_UNKNOWN', 'unsupported Task Board query');
      if (!registry.validateOperation(QUERY, QUERY_VERSION, envelope).valid)
        entryError('API_VALUE_INVALID', 'invalid Task Board envelope');
      const consistency = CONSISTENCY_VALUES[String(envelope.consistencyRequirement)];
      if (consistency === undefined)
        entryError('API_VALUE_INVALID', 'unsupported Board consistency requirement');
      const payload = record(envelope.payload) as CanonicalJsonObject;
      const projectRef = record(payload.projectRef) as CanonicalJsonObject;
      const projectScope = record(projectRef.scope);
      const enterpriseId = projectScope.enterpriseId;
      const projectId = projectScope.projectId;
      if (typeof enterpriseId !== 'string' || typeof projectId !== 'string')
        entryError('SCOPE_MISMATCH', 'Project scope required');
      const queryScope = record(envelope.scopeRef);
      if (queryScope.enterpriseId !== enterpriseId || queryScope.projectId !== projectId)
        entryError('SCOPE_MISMATCH', 'the Board Project reference is outside the query scope');
      const configuredPolicy = config.boardPolicyRef(projectId);
      if (configuredPolicy === undefined)
        entryError('DEPENDENCY_UNAVAILABLE', 'no Board Policy is configured for this Project');

      const payloadHash = payloadHashOf(payload);
      const humanSessionHash = sessionAuthenticationContextHash(session);
      if (
        record(record(envelope.authenticationContextRef).contentHash).digest !==
        humanSessionHash.toString('hex')
      )
        entryError('AUTHORIZATION_DECISION_INVALID', 'query authentication mismatch');
      const humanDecisionRef = decisionReference(envelope.authorizationDecisionRef);
      const humanRow = await boundary.readDecisionRow(humanDecisionRef, {
        scopeKind: 'PROJECT',
        enterpriseId,
        projectId,
      });
      assertActorBinding(envelope.requester, humanRow);
      assertActorBinding(session.resolutionActorSnapshotRef, humanRow);
      const humanDeps = boundary.identityDeps(identityContext(humanRow));
      // The owning mapping revalidation proves the *current* covering Grant of
      // the exact Board entry (config code, required action, HUMAN +
      // forbidActingFor, complete Project target), not just the stored
      // Decision, so a revoked Grant can never be honoured by an unexpired
      // Decision.
      const revalidateBoardDecision = async (
        key: TaskBoardCapabilityKey,
        deps: IdentityCommandDeps,
        decisionRef: Common.ContentAddressedRef,
        authenticationContextHash: Buffer,
        commandPayloadHash: Buffer,
        targetRef: CanonicalJsonObject,
      ): Promise<SelectedAuthorizationGrant | undefined> => {
        const result = await auth.revalidate(deps, key, {
          decisionRef,
          expectedCommandType: BOARD_OPERATIONS[key],
          expectedCommandVersion: QUERY_VERSION,
          expectedCommandPayloadHash: commandPayloadHash,
          expectedAuthenticationContextHash: authenticationContextHash,
          expectedTargetRef: targetRef as unknown as Common.ObjectRef,
        });
        if (!result.valid)
          entryError(AUTHORIZATION_REVOKED, 'Board authority is no longer current');
        return result.selectedGrant;
      };
      const validateHuman = (): Promise<SelectedAuthorizationGrant | undefined> =>
        revalidateBoardDecision(
          'taskBoardReadHumanV1',
          humanDeps,
          humanDecisionRef,
          humanSessionHash,
          payloadHash,
          projectRef,
        );
      const humanGrant = await validateHuman();

      const serviceSessionHash = sessionAuthenticationContextHash(session.serviceSession);
      const sourceDecisionRef = decisionReference(session.serviceSession.sourceDecisionRef);
      const sourceRow = await boundary.readDecisionRow(sourceDecisionRef, {
        scopeKind: 'PROJECT',
        enterpriseId,
        projectId,
      });
      if (sourceRow.principal_kind !== 'SERVICE')
        entryError(AUTHORIZATION_REVOKED, 'Board source read requires a Service principal');
      assertActorBinding(session.serviceSession.resolutionActorSnapshotRef, sourceRow);
      const serviceDeps = boundary.identityDeps(identityContext(sourceRow));

      const dependencyPayloadHash = payloadHashOf({ projectRef });
      const revalidateDependency = (
        decisionRef: Common.ContentAddressedRef,
        key: 'taskBoardSourceReadV1' | 'taskBoardHealthReadV1',
      ): Promise<SelectedAuthorizationGrant | undefined> =>
        revalidateBoardDecision(
          key,
          serviceDeps,
          decisionRef,
          serviceSessionHash,
          dependencyPayloadHash,
          projectRef,
        );
      const sourceGrant = await revalidateDependency(sourceDecisionRef, 'taskBoardSourceReadV1');

      // Source health is only read by the Projection-based branches, so an
      // AUTHORITATIVE read neither needs nor binds the health mapping
      // (Spec 001 §15.19 keeps the AUTH path free of Projection/health
      // authority).
      const usesSourceHealth = consistency !== 'AUTHORITATIVE';
      let healthRef: Common.ContentAddressedRef | undefined;
      let healthExpiresAt = '';
      let healthGrant: SelectedAuthorizationGrant | undefined;
      if (usesSourceHealth) {
        const healthDecision = await auth.authorize(serviceDeps, 'taskBoardHealthReadV1', {
          actorSnapshotRef: session.serviceSession.resolutionActorSnapshotRef,
          commandType: HEALTH_OPERATION,
          commandVersion: QUERY_VERSION,
          commandPayloadHash: payloadHashOf({ projectRef }),
          authenticationContextHash: serviceSessionHash,
          targetRef: projectRef as unknown as Common.ObjectRef,
        });
        if (healthDecision.outcome !== 'ALLOW')
          entryError(AUTHORIZATION_REVOKED, 'Board health read was denied');
        healthRef = healthDecision.authorizationDecisionRef;
        healthExpiresAt = healthDecision.expiresAt;
        healthGrant = await revalidateDependency(healthRef, 'taskBoardHealthReadV1');
      }

      const policyRead = await resolveBoardPolicy(
        configuredPolicy,
        sourceRow,
        session,
        serviceSessionHash,
        serviceDeps,
      );
      const policyResolution = policyRead.resolution;
      // The Policy read revalidates at the same boundary, so its selected
      // Grant also enters the authorization source fingerprint.
      const policyGrant = await revalidateBoardDecision(
        'taskBoardPolicyReadV1',
        serviceDeps,
        policyRead.decisionRef,
        serviceSessionHash,
        payloadHashOf({ policyRef: configuredPolicy }),
        configuredPolicy as unknown as CanonicalJsonObject,
      );

      const correlationId = String(envelope.correlationId);
      const projectionContext = serviceContext(sourceRow, correlationId, {
        id: sourceRow.authorization_decision_id,
        hash: sourceRow.payload_hash,
        expiresAt: sourceRow.expires_at,
      });
      // The health context is only needed when a Projection branch actually
      // reads source health.
      const healthContext =
        healthRef === undefined
          ? projectionContext
          : serviceContext(sourceRow, correlationId, {
              id: healthRef.objectId,
              hash: Buffer.from(healthRef.contentHash.digest, 'hex'),
              expiresAt: new Date(healthExpiresAt),
            });
      const revalidateAll = async (): Promise<void> => {
        await validateHuman();
        await revalidateDependency(sourceDecisionRef, 'taskBoardSourceReadV1');
        if (healthRef !== undefined) await revalidateDependency(healthRef, 'taskBoardHealthReadV1');
        // The Policy read is a protected read too: a Grant revoked after the
        // owning source read must fail the whole query instead of returning
        // data under a stale Policy.
        await revalidateBoardDecision(
          'taskBoardPolicyReadV1',
          serviceDeps,
          policyRead.decisionRef,
          serviceSessionHash,
          payloadHashOf({ policyRef: configuredPolicy }),
          configuredPolicy as unknown as CanonicalJsonObject,
        );
      };
      const ports: TaskBoardReadPorts = {
        now,
        cursorKey: config.cursorKey,
        authorizationSourceHash: taskBoardAuthorizationSourceHash({
          entries: [
            authorizationEntry(
              'taskBoardReadHumanV1',
              config.capabilityCodes.taskBoardReadHumanV1,
              QUERY,
              QUERY_PURPOSE,
              humanRow,
              humanGrant,
            ),
            authorizationEntry(
              'taskBoardSourceReadV1',
              config.capabilityCodes.taskBoardSourceReadV1,
              SOURCE_OPERATION,
              SOURCE_OPERATION,
              sourceRow,
              sourceGrant,
            ),
            ...(usesSourceHealth
              ? [
                  authorizationEntry(
                    'taskBoardHealthReadV1',
                    config.capabilityCodes.taskBoardHealthReadV1,
                    HEALTH_OPERATION,
                    HEALTH_OPERATION,
                    sourceRow,
                    healthGrant,
                  ),
                ]
              : []),
            authorizationEntry(
              'taskBoardPolicyReadV1',
              config.capabilityCodes.taskBoardPolicyReadV1,
              RESOLVE_POLICY_COMMAND,
              RESOLVE_POLICY_PURPOSE,
              sourceRow,
              policyGrant,
            ),
          ],
          boardPolicyRef: policyResolution.policyRef,
          boardPolicyContentHash: policyResolution.policyContentHash,
        }),
        resolveBoardPolicy: () => Promise.resolve(policyResolution),
        readProjection: (project) =>
          readTaskBoardProjection(config.taskExecutionDb, projectionContext, project),
        readGeneration: (project, generationId) =>
          readTaskBoardGenerationById(
            config.taskExecutionDb,
            projectionContext,
            project,
            generationId,
          ),
        findGenerationBySnapshotAt: (project, snapshotAt) =>
          findTaskBoardGenerationBySnapshotAt(
            config.taskExecutionDb,
            projectionContext,
            project,
            snapshotAt,
          ),
        readLatestFailure: (project) =>
          readLatestTaskBoardFailure(config.taskExecutionDb, projectionContext, project),
        readSourceHealth: (project) =>
          readTaskBoardHealth(config.taskExecutionDb, healthContext, project),
        readAuthoritativeRows: (project, reference) =>
          withTaskExecutionSnapshotTransaction(
            config.taskExecutionDb,
            projectionContext,
            async (trx, snapshotAt) => ({
              ...(await assembleTaskBoardRows(trx, project, reference)),
              snapshotAt,
            }),
          ),
        revalidateAuthorization: revalidateAll,
      };
      const result = await handleGetTaskBoardSlice(
        {
          queryId: String(envelope.queryId),
          consistency,
          ...(typeof envelope.asOf === 'string' ? { asOf: envelope.asOf } : {}),
          ...(envelope.minimumWatermark === undefined
            ? {}
            : { minimumWatermark: Number(envelope.minimumWatermark) }),
          payload,
        },
        ports,
      );
      verifyBoardResult(result);
      await revalidateAll();
      return result;
    },
  };
}

/**
 * Closed shape and metadata check of the composed QueryResult Envelope. The
 * registry validates only the registered `data`; this check proves the
 * Envelope-level fields, the status/data/staleness combination and the
 * Page/Envelope metadata equality, then the result hash of the exact bytes.
 */
export function verifyBoardResult(result: CanonicalJsonObject): void {
  const allowedKeys: Readonly<Record<string, true>> = {
    queryId: true,
    status: true,
    data: true,
    snapshotAt: true,
    sourceWatermarks: true,
    stalenessStatus: true,
    redactions: true,
    nextCursor: true,
    resultHash: true,
  };
  for (const key of Object.keys(result)) {
    if (allowedKeys[key] !== true)
      entryError('INTERNAL_CONTRACT_VIOLATION', 'unknown envelope field');
  }
  const status = typeof result.status === 'string' ? result.status : '';
  const staleness = typeof result.stalenessStatus === 'string' ? result.stalenessStatus : '';
  const data = result.data;
  if (
    typeof result.queryId !== 'string' ||
    !['OK', 'STALE', 'ERROR', 'NOT_FOUND', 'FORBIDDEN'].includes(status) ||
    !['FRESH', 'STALE', 'REBUILDING', 'FAILED'].includes(staleness) ||
    !Array.isArray(result.redactions) ||
    !Array.isArray(result.sourceWatermarks) ||
    typeof result.snapshotAt !== 'string'
  )
    entryError('INTERNAL_CONTRACT_VIOLATION', 'malformed Board QueryResult Envelope');
  if (staleness === 'FRESH' && status !== 'OK')
    entryError('INTERNAL_CONTRACT_VIOLATION', 'a FRESH observation must be OK');
  if (data === undefined) {
    if (result.nextCursor !== undefined)
      entryError('INTERNAL_CONTRACT_VIOLATION', 'a data-less result cannot carry a cursor');
    if (staleness === 'FRESH')
      entryError('INTERNAL_CONTRACT_VIOLATION', 'a data-less result can never be FRESH');
  } else {
    const page = record(data);
    if (
      !Array.isArray(page.items) ||
      page.snapshotAt !== result.snapshotAt ||
      sha256CanonicalJson(page.sourceWatermarks as never) !==
        sha256CanonicalJson(result.sourceWatermarks as never)
    )
      entryError('INTERNAL_CONTRACT_VIOLATION', 'Page metadata does not match the Envelope');
    if (page.nextCursor !== result.nextCursor)
      entryError('INTERNAL_CONTRACT_VIOLATION', 'Page cursor does not match the Envelope');
    if (!registryResultValid(data))
      entryError(
        'INTERNAL_CONTRACT_VIOLATION',
        'Board data does not satisfy its registered schema',
      );
  }
  const { resultHash, ...withoutHash } = result;
  const hash = record(resultHash);
  if (hash.digest !== sha256CanonicalJson(withoutHash))
    entryError('INTERNAL_CONTRACT_VIOLATION', 'Board result hash does not match the Envelope');
}

function registryResultValid(data: unknown): boolean {
  return getContractRegistry().validateOperationResult(
    'execution.get_task_board_slice',
    '1.0',
    data,
  ).valid;
}
