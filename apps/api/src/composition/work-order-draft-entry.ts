// IM-06 (#212) composition entry for the WorkOrder DRAFT creation boundary and
// the exact DRAFT read.
//
// TaskExecution owns the WorkOrder Root and its immutable
// WorkOrderDraftSnapshot; IdentityPolicy owns Decisions, ActorSnapshots,
// capability grants and Policy versions. Neither business module may read
// another's schema, so this entry is the `execution.create_work_order` /
// `execution.get_work_order_draft` specific part of the shared composition
// boundary (`decision-boundary.ts`):
//
//   1. the complete registered Envelope is validated for its exact version:
//      `execution.get_work_order_draft@1.0` stays registered but has no handler
//      and no satisfiable IM-06 input (§18.2), so it is never routed;
//   2. the presented Decision row is read in the requested Project scope and
//      bound to the presented actor;
//   3. the IdentityPolicy-owned creation/read Port revalidates that this same
//      Decision still covers this exact operation/version/Purpose, payload,
//      authentication context, Project scope and target *now* — before
//      TaskExecution claims idempotency or returns a historical Receipt, and
//      before the read returns any fact;
//   4. the owning TaskExecution handler runs inside one owning transaction and
//      consumes the IdentityPolicy-owned capability-classification Port after
//      the claim and before its first business write.
//
// The WorkOrder creation writes zero Outbox rows and publishes no event
// (§18.10), and the read path writes nothing at all: the success result of the
// read is the owning handler's own result payload.

import type { Kysely } from 'kysely';
import { ContractRegistry, type Common } from '@zhiju/contracts';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  API_CONTRACT_TYPE_UNKNOWN,
  API_PAYLOAD_LIMIT_EXCEEDED,
  API_VALUE_INVALID,
  AUTHORIZATION_DECISION_INVALID,
  AUTHORIZATION_EXPIRED,
  AUTHORIZATION_REVOKED,
  DEPENDENCY_UNAVAILABLE,
  IDENTITY_ACTOR_SNAPSHOT_INVALID,
  IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED,
  IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID,
  IDENTITY_CREATION_TARGET_INVALID,
  IDENTITY_DECISION_INPUT_INVALID,
  IDENTITY_WORK_ORDER_DRAFT_READ_CAPABILITY_CONFIG_INVALID,
  IDENTITY_WORK_ORDER_DRAFT_READ_TARGET_INVALID,
  IDENTITY_WORK_ORDER_DRAFT_READ_UNSUPPORTED,
  SnapshotBoundaryError,
  TASK_EXECUTION_CREATION_BINDINGS,
  createTaskExecutionCreationAuthorizationPort,
  createTaskExecutionCreationCapabilityBoundaryPort,
  createWorkOrderDraftReadAuthorizationPort,
  WORK_ORDER_DRAFT_READ_BINDINGS as WORK_ORDER_DRAFT_READ_AUTHORIZATION_BINDINGS,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityPolicyRepository,
  type IdentityTransactionContext,
  type TaskExecutionCreationCapabilityCodes,
  type TaskExecutionCreationRevalidationFailure,
  type TaskExecutionCreationRevalidationResult,
  type WorkOrderDraftReadCapabilityCodes,
  type WorkOrderDraftReadRevalidationFailure,
  type WorkOrderDraftReadRevalidationResult,
} from '@zhiju/identity-policy';
import {
  CREATE_WORK_ORDER_COMMAND,
  EXECUTION_WORK_ORDER_REF_INVALID,
  GET_WORK_ORDER_DRAFT_QUERY,
  WORK_ORDER_DRAFT_CREATION_BINDINGS,
  WORK_ORDER_DRAFT_READ_BINDINGS,
  createWorkOrderIdempotencyScope,
  digestCanonicalPayload,
  handleCreateWorkOrder,
  handleGetWorkOrderDraft,
  type CommandEnvelope,
  type CommandResult,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
  type WorkOrderDraftCreationPorts,
} from '@zhiju/task-execution';
import {
  assertActorBinding,
  assertIntegrity,
  createDecisionBoundary,
  decisionReference,
  digest,
  entryError,
  payloadHashOf,
  record,
  sessionAuthenticationContextHash,
  uuid,
  type DecisionBoundary,
  type DecisionRow,
  type RequestScope,
} from './decision-boundary.js';

/** Creation boundary codes the IdentityPolicy Port owns and may surface. */
const CREATION_BOUNDARY_CODES: Readonly<Record<string, true>> = {
  [IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED]: true,
  [IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID]: true,
  [IDENTITY_CREATION_TARGET_INVALID]: true,
  [IDENTITY_DECISION_INPUT_INVALID]: true,
  [IDENTITY_ACTOR_SNAPSHOT_INVALID]: true,
};

/** Read boundary codes the IdentityPolicy Port owns and may surface. */
const READ_BOUNDARY_CODES: Readonly<Record<string, true>> = {
  [IDENTITY_WORK_ORDER_DRAFT_READ_UNSUPPORTED]: true,
  [IDENTITY_WORK_ORDER_DRAFT_READ_CAPABILITY_CONFIG_INVALID]: true,
  // A target outside the read version's closed spelling set is a WorkOrder
  // reference failure, not an unavailable dependency: the read path's own
  // stable exterior must survive, exactly as the readiness entry keeps its
  // Task-reference code for the same reason.
  [IDENTITY_WORK_ORDER_DRAFT_READ_TARGET_INVALID]: true,
  [IDENTITY_DECISION_INPUT_INVALID]: true,
  [IDENTITY_ACTOR_SNAPSHOT_INVALID]: true,
};

/** Revocation-shaped creation failures: the covering Grant is gone. */
const REVOKED_CREATION_REASONS: Readonly<
  Partial<Record<TaskExecutionCreationRevalidationFailure, true>>
> = {
  NOT_ALLOW: true,
  GRANT_NOT_CURRENT: true,
  POLICY_NOT_CURRENT: true,
  POLICY_INTEGRITY_MISMATCH: true,
  CONFIGURATION_CHANGED: true,
  PRINCIPAL_NOT_ACTIVE: true,
};

/** Revocation-shaped read failures: the covering Grant is gone. */
const REVOKED_READ_REASONS: Readonly<Partial<Record<WorkOrderDraftReadRevalidationFailure, true>>> =
  {
    NOT_ALLOW: true,
    GRANT_NOT_CURRENT: true,
    POLICY_NOT_CURRENT: true,
    POLICY_INTEGRITY_MISMATCH: true,
    CONFIGURATION_CHANGED: true,
    PRINCIPAL_NOT_ACTIVE: true,
  };

export interface WorkOrderDraftEntryConfig {
  /** Owning TaskExecution database handle over an application-owned pool. */
  readonly taskExecutionDb: Kysely<TaskExecutionDb>;
  /** Owning IdentityPolicy dependencies; the Decision/authorization Ports live here. */
  readonly identity: {
    readonly db: Kysely<IdentityPolicyDb>;
    readonly repo: IdentityPolicyRepository;
    readonly crypto: IdentityCryptoPorts;
  };
  /**
   * Trusted capability codes per approved WorkOrder creation version. The
   * layer never falls back to a wildcard or to "the caller is a Service", and
   * the two creation versions never share a value by construction of the
   * owning Port.
   */
  readonly capabilityCodes: TaskExecutionCreationCapabilityCodes;
  /**
   * Trusted capability codes per approved DRAFT read version. Neither read
   * version inherits the other's value.
   */
  readonly readCapabilityCodes: WorkOrderDraftReadCapabilityCodes;
  /** Trusted server clock. */
  readonly now?: (() => Date) | undefined;
}

export interface WorkOrderDraftSession {
  /**
   * Authentication-context hash pinned by the transport for this caller
   * session. The presented Decision must have been issued for exactly this
   * authentication context.
   */
  readonly authenticationContextHash: Buffer;
}

export interface WorkOrderDraftEntry {
  /** `execution.create_work_order@1.0` / `@1.1` through the trusted boundary. */
  create(envelope: unknown, session: WorkOrderDraftSession): Promise<CommandResult>;
  /** `execution.get_work_order_draft@1.1` / `@2.0` through the trusted boundary. */
  read(envelope: unknown, session: WorkOrderDraftSession): Promise<CommandResult>;
}

function registeredViolation(
  registry: ContractRegistry,
  commandType: string,
  commandVersion: string,
  envelope: unknown,
): string | null {
  const validation = registry.validateOperation(commandType, commandVersion, envelope);
  if (validation.valid) return null;
  if (validation.errors.some((error) => error.keyword === 'operationRegistry')) {
    return API_CONTRACT_TYPE_UNKNOWN;
  }
  if (validation.errors.some((error) => error.keyword === 'payloadGuard')) {
    return API_PAYLOAD_LIMIT_EXCEEDED;
  }
  return API_VALUE_INVALID;
}

/**
 * The requested Project scope. The registered Schema already constrains both
 * ids to UuidV7; the trusted comparison against the Decision row happens
 * afterwards, so this never widens the scope a caller may ask for.
 */
function requestedProjectScope(scopeRef: unknown): RequestScope {
  const scope = record(scopeRef);
  const enterpriseId = uuid(scope.enterpriseId);
  const projectId = uuid(scope.projectId);
  if (enterpriseId === undefined || projectId === undefined) {
    entryError(API_VALUE_INVALID, 'scopeRef must carry the exact Enterprise/Project scope');
  }
  return { scopeKind: 'PROJECT', enterpriseId, projectId };
}

/**
 * The exact WorkOrder identity of one read request: `kind`, id, Project Scope
 * and the read version's own binding spelling, compared character by
 * character. §18.2 rules 2-3: the other version's spelling, a bare local name
 * and a missing, foreign or non-Project Scope all fail as the read path's
 * `EXECUTION_WORK_ORDER_REF_INVALID`, which never distinguishes its internal
 * reason and never reveals another Scope's existence.
 */
function workOrderDraftReadTarget(
  payloadRef: unknown,
  envelopeScope: RequestScope,
  spelling: string,
): Common.ObjectRef {
  const ref = record(payloadRef);
  const refScope = record(ref.scope);
  const objectId = uuid(ref.objectId);
  if (
    ref.kind !== 'OBJECT' ||
    ref.objectType !== spelling ||
    objectId === undefined ||
    refScope.enterpriseId !== envelopeScope.enterpriseId ||
    refScope.projectId !== envelopeScope.projectId
  ) {
    entryError(
      EXECUTION_WORK_ORDER_REF_INVALID,
      'workOrderRef must be this read version WorkOrder identity in the requested Project',
    );
  }
  return {
    kind: 'OBJECT',
    objectType: spelling,
    objectId,
    scope: { enterpriseId: envelopeScope.enterpriseId, projectId: envelopeScope.projectId },
  };
}

/**
 * The creation revalidation failure reduced to its stable public error: expiry
 * keeps `AUTHORIZATION_EXPIRED`, a revoked/replaced covering Grant or Policy
 * keeps `AUTHORIZATION_REVOKED`, and every binding mismatch stays an invalid
 * Decision. The owning reason itself never leaves this boundary.
 */
function creationRevalidationErrorCode(reason: TaskExecutionCreationRevalidationFailure): string {
  if (reason === 'EXPIRED') return AUTHORIZATION_EXPIRED;
  if (REVOKED_CREATION_REASONS[reason] === true) return AUTHORIZATION_REVOKED;
  return AUTHORIZATION_DECISION_INVALID;
}

/**
 * The read revalidation failure reduced to its stable public error, with the
 * same reduction as the creation side: an unproven Decision is never an empty
 * or partial read, and a Decision for another operation, session, payload or
 * target stays an invalid Decision.
 */
function readRevalidationErrorCode(reason: WorkOrderDraftReadRevalidationFailure): string {
  if (reason === 'EXPIRED') return AUTHORIZATION_EXPIRED;
  if (REVOKED_READ_REASONS[reason] === true) return AUTHORIZATION_REVOKED;
  return AUTHORIZATION_DECISION_INVALID;
}

export function createWorkOrderDraftEntry(config: WorkOrderDraftEntryConfig): WorkOrderDraftEntry {
  const registry = new ContractRegistry();
  const boundary: DecisionBoundary = createDecisionBoundary(config);
  const creation = createTaskExecutionCreationAuthorizationPort({
    capabilityCodes: config.capabilityCodes,
    ...(config.now === undefined ? {} : { now: config.now }),
  });
  const draftRead = createWorkOrderDraftReadAuthorizationPort({
    capabilityCodes: config.readCapabilityCodes,
    ...(config.now === undefined ? {} : { now: config.now }),
  });

  /** The trusted facts of the presented Decision, expressed for IdentityPolicy. */
  function decisionContext(row: DecisionRow): IdentityTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: row.principal_id,
      actorSnapshotId: row.actor_snapshot_id,
      authorizationDecisionId: row.authorization_decision_id,
      authorizationDecisionHash: row.payload_hash,
      authorizationDecisionExpiresAt: row.expires_at,
      enterpriseId: row.enterprise_id,
      allowedProjectIds: row.project_id === null ? [] : [row.project_id],
      correlationId: row.authorization_decision_id,
    };
  }

  /** The same trusted facts, expressed for the owning TaskExecution transaction. */
  function taskExecutionContext(
    row: DecisionRow,
    scope: RequestScope,
    correlationId: string,
  ): TaskExecutionTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: row.principal_id,
      principalKind: row.principal_kind as TaskExecutionTransactionContext['principalKind'],
      actorSnapshotId: row.actor_snapshot_id,
      authorizationDecisionId: row.authorization_decision_id,
      authorizationDecisionHash: row.payload_hash,
      authorizationDecisionExpiresAt: row.expires_at,
      policySnapshotId: row.policy_snapshot_id,
      enterpriseId: scope.enterpriseId,
      allowedProjectIds: [scope.projectId],
      correlationId,
    };
  }

  return {
    async create(envelope, session) {
      const command = record(envelope);
      const commandType = command.commandType;
      const commandVersion = command.commandVersion;
      if (
        typeof commandType !== 'string' ||
        typeof commandVersion !== 'string' ||
        commandType !== CREATE_WORK_ORDER_COMMAND
      ) {
        entryError(
          API_CONTRACT_TYPE_UNKNOWN,
          'the creation Envelope is not one of the registered WorkOrder creation versions',
        );
      }
      // The owning module binding fixes this version's WorkOrder spelling and
      // the IdentityPolicy binding fixes its approved authorization entry;
      // neither table has an alias, a prefix, a case variant or an implicit
      // default, so a version outside both has no approved creation at all.
      const binding = WORK_ORDER_DRAFT_CREATION_BINDINGS.find(
        (candidate) => candidate.commandVersion === commandVersion,
      );
      const authorizationBinding = TASK_EXECUTION_CREATION_BINDINGS.find(
        (candidate) =>
          candidate.commandType === CREATE_WORK_ORDER_COMMAND &&
          candidate.commandVersion === commandVersion,
      );
      if (binding === undefined || authorizationBinding === undefined) {
        entryError(
          API_CONTRACT_TYPE_UNKNOWN,
          'the creation Envelope is not one of the registered WorkOrder creation versions',
        );
      }
      const violation = registeredViolation(
        registry,
        CREATE_WORK_ORDER_COMMAND,
        commandVersion,
        envelope,
      );
      if (violation !== null) {
        entryError(violation, 'the creation Envelope does not satisfy its registered contract');
      }
      const payload = record(command.payload) as unknown as CanonicalJsonObject;
      const payloadHash = payloadHashOf(payload);
      assertIntegrity(command.integrity, payloadHash);
      const scope = requestedProjectScope(command.scopeRef);
      const targetRef = command.targetRef;
      const sessionHash = sessionAuthenticationContextHash(session);
      const decisionRef = decisionReference(command.authorizationDecisionRef);
      const row = await boundary.readDecisionRow(decisionRef, scope);
      assertActorBinding(command.actor, row);

      // §18.9 step 1: the Decision must still cover this exact creation now,
      // before TaskExecution claims idempotency or returns a historical
      // Receipt. A revoked Grant, an expired Decision, a drifted trusted
      // configuration, a substituted target/version and an unavailable
      // IdentityPolicy all fail closed here.
      let revalidation: TaskExecutionCreationRevalidationResult;
      try {
        revalidation = await creation.revalidateCreation(
          boundary.identityDeps(decisionContext(row)),
          {
            decisionRef,
            expectedCommandType: authorizationBinding.commandType,
            expectedCommandVersion: authorizationBinding.commandVersion,
            expectedCommandPayloadHash: payloadHash,
            expectedAuthenticationContextHash: sessionHash,
            expectedTargetRef: targetRef as Common.ObjectRef,
          },
        );
      } catch (error) {
        if (
          error instanceof SnapshotBoundaryError &&
          CREATION_BOUNDARY_CODES[error.code] === true
        ) {
          entryError(error.code, 'the creation Decision cannot be revalidated for this request');
        }
        entryError(DEPENDENCY_UNAVAILABLE, 'creation authorization is unavailable');
      }
      if (!revalidation.valid) {
        entryError(
          creationRevalidationErrorCode(revalidation.reason),
          'the presented Decision no longer covers this creation request',
        );
      }

      const correlationId = command.correlationId as string;
      const internalEnvelope: CommandEnvelope = {
        commandId: command.commandId as string,
        commandType: CREATE_WORK_ORDER_COMMAND,
        commandVersion: binding.commandVersion,
        idempotencyScope: createWorkOrderIdempotencyScope(
          CREATE_WORK_ORDER_COMMAND,
          binding.commandVersion,
          scope.enterpriseId,
          scope.projectId,
        ),
        idempotencyKey: command.idempotencyKey as string,
        requestPayload: payload,
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
        targetType: binding.workOrderObjectType,
        targetId: record(targetRef).objectId as string,
        correlationId,
        ...(command.causationId === undefined
          ? {}
          : { causationId: command.causationId as string }),
        principalId: row.principal_id,
        principalKind: row.principal_kind as CommandEnvelope['principalKind'],
        actorSnapshotId: row.actor_snapshot_id,
        authorizationDecisionId: row.authorization_decision_id,
        policySnapshotId: row.policy_snapshot_id,
      };
      const ports: WorkOrderDraftCreationPorts = {
        // The IdentityPolicy-owned classification boundary is wired in as-is:
        // the handler already fills the exact request it expects from the
        // trusted context, the boundary reads the authoritative principal kind
        // from its own row and records its own masked audit, and the handler
        // converges `INVALID` onto `HUMAN_ONLY_CAPABILITY` and a boundary
        // failure onto `DEPENDENCY_UNAVAILABLE`. An unavailable boundary is
        // therefore never an empty or accepting answer.
        capabilityBoundary: createTaskExecutionCreationCapabilityBoundaryPort({
          db: config.identity.db,
          context: decisionContext(row),
          commandId: internalEnvelope.commandId,
        }),
        // The owning handler samples the same trusted clock the two
        // authorization Ports above already use for its classification instant
        // and its commit-time `expiresAt` re-check, so this entry never leaves
        // two clocks disagreeing about one request.
        ...(config.now === undefined ? {} : { now: config.now }),
      };
      return handleCreateWorkOrder(
        config.taskExecutionDb,
        taskExecutionContext(row, scope, correlationId),
        internalEnvelope,
        ports,
      );
    },

    async read(envelope, session) {
      const query = record(envelope);
      const queryType = query.queryType;
      const queryVersion = query.queryVersion;
      if (
        typeof queryType !== 'string' ||
        typeof queryVersion !== 'string' ||
        queryType !== GET_WORK_ORDER_DRAFT_QUERY
      ) {
        entryError(
          API_CONTRACT_TYPE_UNKNOWN,
          'the read Envelope is not one of the satisfiable WorkOrder DRAFT read versions',
        );
      }
      // The owning module binding fixes the read version's one accepted
      // WorkOrder spelling and the draft shape it returns; the IdentityPolicy
      // binding fixes the authorization entry of the same `(type, version)`
      // pair. Neither table is interpolated: `execution.get_work_order_draft@1.0`
      // is absent from both and is refused here, before any Decision is read.
      const binding = WORK_ORDER_DRAFT_READ_BINDINGS.find(
        (candidate) => candidate.commandVersion === queryVersion,
      );
      const authorizationBinding = WORK_ORDER_DRAFT_READ_AUTHORIZATION_BINDINGS.find(
        (candidate) =>
          candidate.commandType === GET_WORK_ORDER_DRAFT_QUERY &&
          candidate.commandVersion === queryVersion,
      );
      if (binding === undefined || authorizationBinding === undefined) {
        entryError(
          API_CONTRACT_TYPE_UNKNOWN,
          'the read Envelope is not one of the satisfiable WorkOrder DRAFT read versions',
        );
      }
      const violation = registeredViolation(
        registry,
        GET_WORK_ORDER_DRAFT_QUERY,
        binding.commandVersion,
        envelope,
      );
      if (violation !== null) {
        entryError(violation, 'the read Envelope does not satisfy its registered contract');
      }
      if (query.consistencyRequirement !== 'AUTHORITATIVE') {
        entryError(API_VALUE_INVALID, 'the draft read Query must be AUTHORITATIVE');
      }
      const scope = requestedProjectScope(query.scopeRef);
      const payload = record(query.payload) as unknown as CanonicalJsonObject;
      const payloadHash = payloadHashOf(payload);
      const targetRef = workOrderDraftReadTarget(
        payload.workOrderRef,
        scope,
        binding.workOrderObjectType,
      );
      // The trusted session is the only accepted source of the authentication
      // context: the Envelope reference and the Decision must both belong to
      // exactly this session, so a Decision issued for another session can
      // never be replayed through this entry.
      const sessionHash = sessionAuthenticationContextHash(session);
      const authenticationContext = record(query.authenticationContextRef);
      const envelopeAuthenticationContextHash = digest(authenticationContext.contentHash);
      if (envelopeAuthenticationContextHash === undefined) {
        entryError(AUTHORIZATION_DECISION_INVALID, 'the Query must pin an authentication context');
      }
      if (envelopeAuthenticationContextHash !== sessionHash.toString('hex')) {
        entryError(
          AUTHORIZATION_DECISION_INVALID,
          'the Query authentication context is not the trusted session',
        );
      }
      const decisionRef = decisionReference(query.authorizationDecisionRef);
      const row = await boundary.readDecisionRow(decisionRef, scope);
      assertActorBinding(query.requester, row);

      // §18.8: before any read fact — including a historical one — is
      // returned, the presented Decision must still cover this exact read now:
      // the exact id/hash, the actual principal, the authentication context,
      // the operation/version/Purpose, the payload hash, the exact target and
      // Project Scope, ALLOW and expiry, plus a fresh read of the single
      // covering Grant and its Policy Snapshot. A revoked Grant, an expired
      // Decision, a drifted trusted configuration, a substituted target or
      // version and an unavailable IdentityPolicy all fail closed here.
      let revalidation: WorkOrderDraftReadRevalidationResult;
      try {
        revalidation = await draftRead.revalidateWorkOrderDraftRead(
          boundary.identityDeps(decisionContext(row)),
          {
            decisionRef,
            expectedCommandType: authorizationBinding.commandType,
            expectedCommandVersion: authorizationBinding.commandVersion,
            expectedCommandPayloadHash: payloadHash,
            expectedAuthenticationContextHash: sessionHash,
            expectedTargetRef: targetRef,
          },
        );
      } catch (error) {
        if (error instanceof SnapshotBoundaryError && READ_BOUNDARY_CODES[error.code] === true) {
          entryError(
            error.code === IDENTITY_WORK_ORDER_DRAFT_READ_TARGET_INVALID
              ? EXECUTION_WORK_ORDER_REF_INVALID
              : error.code,
            'the draft read Decision cannot be revalidated for this request',
          );
        }
        entryError(DEPENDENCY_UNAVAILABLE, 'draft read authorization is unavailable');
      }
      if (!revalidation.valid) {
        entryError(
          readRevalidationErrorCode(revalidation.reason),
          'the presented Decision no longer covers this draft read',
        );
      }

      const correlationId = query.correlationId as string;
      const result = await handleGetWorkOrderDraft(
        config.taskExecutionDb,
        taskExecutionContext(row, scope, correlationId),
        { commandVersion: binding.commandVersion, payload },
      );
      if (result.status === 'REJECTED') {
        return {
          status: 'REJECTED',
          errorCode: result.errorCode,
          safeSummary: result.safeSummary,
          currentAggregateVersion: null,
        };
      }
      return {
        status: 'COMMITTED',
        resultPayload: result.resultPayload,
        resultPayloadHash: digestCanonicalPayload(result.resultPayload).hash,
      };
    },
  };
}
