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
  SnapshotBoundaryError,
  authorizeCommand,
  createTaskBoardAuthorizationPort,
  resolvePolicy,
  taskBoardAuthorizationSourceHash,
  validateAuthorizationDecision,
  type IdentityCommandDeps,
  type IdentityTransactionContext,
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
  validateTaskBoardPolicy,
  withTaskExecutionSnapshotTransaction,
  type TaskBoardConsistency,
  type TaskBoardPolicyResolution,
  type TaskBoardReadPorts,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
import { newUuidV7, sha256CanonicalJson, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import {
  AUTHORIZATION_DECISION_OBJECT_TYPE,
  assertActorBinding,
  contentHash,
  createDecisionBoundary,
  decisionReference,
  entryError,
  payloadHashOf,
  policySnapshotReference,
  record,
  sessionAuthenticationContextHash,
  type DecisionRow,
  type IdentityBoundaryConfig,
} from './decision-boundary.js';
import type { InitialContextSession } from './initial-context-entry.js';

/** Trusted handles plus one capability code per approved Board boundary. */
export interface TaskBoardEntryConfig extends IdentityBoundaryConfig {
  readonly taskExecutionDb: Kysely<TaskExecutionDb>;
  readonly capabilityCodes: TaskBoardCapabilityCodes;
  /** Trusted server cursor secret; never a Decision hash. */
  readonly cursorKey: { readonly keyId: string; readonly secret: Buffer };
  /** Trusted fixed Project-scoped Board Policy selector of one Project. */
  readonly boardPolicyRef: (projectId: string) => Common.VersionedRef | undefined;
  readonly capabilityCodeResolvePolicy: string;
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
): TaskBoardAuthorizationSourceEntry {
  return {
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

  async function resolveBoardPolicy(
    policyRef: Common.VersionedRef,
    row: DecisionRow,
    session: TaskBoardSession,
    serviceSessionHash: Buffer,
    deps: IdentityCommandDeps,
  ): Promise<TaskBoardPolicyResolution> {
    const scopeValue = record(policyRef.scope);
    const authorized = await authorizeCommand(deps, {
      actorSnapshotRef: session.serviceSession.resolutionActorSnapshotRef,
      intent: {
        commandType: RESOLVE_POLICY_COMMAND,
        commandVersion: '1.0',
        scopeKind: 'PROJECT',
        enterpriseId: row.enterprise_id,
        ...(row.project_id === null ? {} : { projectId: row.project_id }),
        purpose: RESOLVE_POLICY_PURPOSE,
        requestedCapability: config.capabilityCodeResolvePolicy,
        commandPayloadHash: payloadHashOf({ policyRef }),
        requestedAt: now(),
        highRiskAction: false,
      },
      authenticationContextHash: serviceSessionHash,
      policySnapshotRef: policySnapshotReference(row),
    });
    if (authorized.outcome !== 'ALLOW')
      entryError(AUTHORIZATION_REVOKED, 'Board Policy resolution was denied');
    const resolveContext: IdentityTransactionContext = {
      ...identityContext(row, session.serviceSession.resolutionActorSnapshotRef.snapshotId),
      authorizationDecisionId: authorized.authorizationDecisionRef.objectId,
      authorizationDecisionHash: Buffer.from(
        authorized.authorizationDecisionRef.contentHash.digest,
        'hex',
      ),
      authorizationDecisionExpiresAt: new Date(authorized.expiresAt),
    };
    const envelope = {
      queryId: newUuidV7(),
      queryType: RESOLVE_POLICY_COMMAND,
      queryVersion: '1.0',
      scopeRef: scopeValue,
      requester: {
        kind: 'OBJECT',
        objectType: 'zhiju.identity.principal',
        objectId: row.principal_id,
        scope: scopeValue,
      },
      authenticationContextRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.identity.authentication_context',
        objectId: row.actor_snapshot_id,
        scope: scopeValue,
        contentHash: contentHash(serviceSessionHash.toString('hex')),
      },
      authorizationDecisionRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: AUTHORIZATION_DECISION_OBJECT_TYPE,
        objectId: authorized.authorizationDecisionRef.objectId,
        scope: scopeValue,
        contentHash: authorized.authorizationDecisionRef
          .contentHash as unknown as CanonicalJsonObject,
      },
      consistencyRequirement: 'AUTHORITATIVE',
      correlationId: row.authorization_decision_id,
      requestedAt: now().toISOString(),
      payload: { policyRef },
    } as unknown as CanonicalJsonObject;
    let view: Awaited<ReturnType<typeof resolvePolicy>>;
    try {
      view = await resolvePolicy(boundary.identityDeps(resolveContext), {
        envelope,
        asOf: now(),
      });
    } catch (error) {
      if (error instanceof SnapshotBoundaryError)
        entryError('DEPENDENCY_UNAVAILABLE', 'Board Policy resolution is unavailable');
      throw error;
    }
    if (view.useStatus !== 'USABLE')
      entryError(AUTHORIZATION_REVOKED, 'the Board Policy is not currently usable');
    if (
      view.policyRef.objectId !== policyRef.objectId ||
      view.policyRef.versionId !== policyRef.versionId ||
      view.scopeRef.enterpriseId !== row.enterprise_id ||
      view.scopeRef.projectId !== (row.project_id ?? undefined)
    )
      entryError('SCOPE_MISMATCH', 'the resolved Board Policy is not the configured one');
    const validated = validateTaskBoardPolicy({
      policySchemaRefs: view.policySchemaRefs,
      policyDocument: view.policyDocument,
    });
    if (!validated.valid)
      entryError('EXECUTION_CRITERION_UNSUPPORTED', 'the Board Policy profile is not supported');
    const observationPolicyRef = view.policyRef as unknown as CanonicalJsonObject;
    const observationVersionRef = view.policyVersionRef as unknown as CanonicalJsonObject;
    return {
      policyRef: observationPolicyRef,
      policyVersionRef: observationVersionRef,
      policyContentHash: view.contentHash.digest,
      policyObservation: {
        policyRef: observationPolicyRef,
        policyVersionRef: observationVersionRef,
        contentHash: view.contentHash.digest,
        effectiveFrom: view.effectiveFrom,
        ...(view.supersededAt === undefined ? {} : { supersededAt: view.supersededAt }),
      },
      rules: validated.rules,
    };
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
      const validateHuman = async (): Promise<void> => {
        const validation = await validateAuthorizationDecision(humanDeps, {
          decisionRef: humanDecisionRef,
          expectedCommandType: QUERY,
          expectedCommandVersion: QUERY_VERSION,
          expectedScope: { scopeKind: 'PROJECT', enterpriseId, projectId },
          expectedPurpose: QUERY_PURPOSE,
          expectedCommandPayloadHash: payloadHash,
          expectedAuthenticationContextHash: humanSessionHash,
          now: now(),
        });
        if (!validation.valid || validation.outcome !== 'ALLOW')
          entryError(AUTHORIZATION_REVOKED, 'Human Board read authority is no longer current');
      };
      await validateHuman();

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

      const proofInput = (
        decisionRef: Common.ContentAddressedRef,
        key: TaskBoardCapabilityKey,
      ) => ({
        decisionRef,
        expectedCommandType: key === 'taskBoardHealthReadV1' ? HEALTH_OPERATION : SOURCE_OPERATION,
        expectedCommandVersion: QUERY_VERSION,
        expectedCommandPayloadHash: payloadHashOf({ projectRef }),
        expectedAuthenticationContextHash: serviceSessionHash,
        expectedTargetRef: projectRef as unknown as Common.ObjectRef,
      });
      const revalidateDependency = async (
        decisionRef: Common.ContentAddressedRef,
        key: 'taskBoardSourceReadV1' | 'taskBoardHealthReadV1',
      ): Promise<void> => {
        const result = await auth.revalidate(serviceDeps, key, proofInput(decisionRef, key));
        if (!result.valid)
          entryError(AUTHORIZATION_REVOKED, 'Board dependency read authority is no longer current');
      };
      await revalidateDependency(sourceDecisionRef, 'taskBoardSourceReadV1');

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
      const healthRef = healthDecision.authorizationDecisionRef;

      const policyResolution = await resolveBoardPolicy(
        configuredPolicy,
        sourceRow,
        session,
        serviceSessionHash,
        serviceDeps,
      );

      const correlationId = String(envelope.correlationId);
      const projectionContext = serviceContext(sourceRow, correlationId, {
        id: sourceRow.authorization_decision_id,
        hash: sourceRow.payload_hash,
        expiresAt: sourceRow.expires_at,
      });
      const healthContext = serviceContext(sourceRow, correlationId, {
        id: healthRef.objectId,
        hash: Buffer.from(healthRef.contentHash.digest, 'hex'),
        expiresAt: new Date(healthDecision.expiresAt),
      });
      const revalidateAll = async (): Promise<void> => {
        await validateHuman();
        await revalidateDependency(sourceDecisionRef, 'taskBoardSourceReadV1');
        await revalidateDependency(healthRef, 'taskBoardHealthReadV1');
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
            ),
            authorizationEntry(
              'taskBoardSourceReadV1',
              config.capabilityCodes.taskBoardSourceReadV1,
              SOURCE_OPERATION,
              SOURCE_OPERATION,
              sourceRow,
            ),
            authorizationEntry(
              'taskBoardHealthReadV1',
              config.capabilityCodes.taskBoardHealthReadV1,
              HEALTH_OPERATION,
              HEALTH_OPERATION,
              sourceRow,
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
