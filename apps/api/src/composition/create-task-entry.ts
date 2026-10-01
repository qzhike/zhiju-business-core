// IM-06 (#204) composition entry for the Task DRAFT creation boundary.
//
// TaskExecution owns the Task Root and its immutable TaskDefinitionSnapshot;
// EnterpriseProject owns the Project/DeliveryItem proof; IdentityPolicy owns
// Decisions, ActorSnapshots, capability grants and Policy versions. Neither
// business module may read another's schema, so this entry is the
// `execution.create_task` specific part of the shared composition boundary
// (`decision-boundary.ts`):
//
//   1. the complete registered Envelope is validated for its exact version;
//   2. the presented Decision row is read in the requested Project scope and
//      bound to the presented actor;
//   3. the IdentityPolicy-owned creation Port revalidates that this same
//      Decision still covers this exact operation/version/Purpose, payload,
//      authentication context and CREATE target *now* — before TaskExecution
//      claims idempotency or returns a historical Receipt;
//   4. the owning TaskExecution handler runs the creation inside one owning
//      transaction and consumes the EnterpriseProject-owned Project scope Port
//      after the claim and before its first business write.

import type { Kysely } from 'kysely';
import { getContractRegistry, type ContractRegistry, type Common } from '@zhiju/contracts';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  createTaskExecutionCreationProjectScopePort,
  type EnterpriseProjectDb,
} from '@zhiju/enterprise-project';
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
  SnapshotBoundaryError,
  TASK_EXECUTION_CREATION_BINDINGS,
  createTaskExecutionCreationAuthorizationPort,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityPolicyRepository,
  type TaskExecutionCreationCapabilityCodes,
  type TaskExecutionCreationRevalidationFailure,
  type TaskExecutionCreationRevalidationResult,
} from '@zhiju/identity-policy';
import {
  createTaskIdempotencyScope,
  handleCreateTask,
  type CommandEnvelope,
  type CommandResult,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
import {
  assertActorBinding,
  assertIntegrity,
  createDecisionBoundary,
  decisionReference,
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

/** Revocation-shaped revalidation failures: the covering Grant is gone. */
const REVOKED_REVALIDATION_REASONS: Readonly<
  Partial<Record<TaskExecutionCreationRevalidationFailure, true>>
> = {
  NOT_ALLOW: true,
  GRANT_NOT_CURRENT: true,
  POLICY_NOT_CURRENT: true,
  POLICY_INTEGRITY_MISMATCH: true,
  CONFIGURATION_CHANGED: true,
  PRINCIPAL_NOT_ACTIVE: true,
};

export interface CreateTaskEntryConfig {
  /** Owning TaskExecution database handle over an application-owned pool. */
  readonly taskExecutionDb: Kysely<TaskExecutionDb>;
  /** Owning EnterpriseProject database handle for the Project scope Port. */
  readonly enterpriseProjectDb: Kysely<EnterpriseProjectDb>;
  /** Owning IdentityPolicy dependencies; the Decision/creation Ports live here. */
  readonly identity: {
    readonly db: Kysely<IdentityPolicyDb>;
    readonly repo: IdentityPolicyRepository;
    readonly crypto: IdentityCryptoPorts;
  };
  /**
   * Trusted capability codes per approved creation version. The layer never
   * falls back to a wildcard or to "the caller is a Service".
   */
  readonly capabilityCodes: TaskExecutionCreationCapabilityCodes;
  /** Trusted server clock. */
  readonly now?: (() => Date) | undefined;
}

export interface CreateTaskSession {
  /**
   * Authentication-context hash pinned by the transport for this caller
   * session. The presented Decision must have been issued for exactly this
   * authentication context.
   */
  readonly authenticationContextHash: Buffer;
}

export interface CreateTaskEntry {
  /** `execution.create_task@1.0` / `@2.0` through the trusted boundary. */
  create(envelope: unknown, session: CreateTaskSession): Promise<CommandResult>;
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
 * The revalidation failure reduced to its stable public error: expiry keeps
 * `AUTHORIZATION_EXPIRED`, a revoked/replaced covering Grant or Policy keeps
 * `AUTHORIZATION_REVOKED`, and every binding mismatch stays an invalid
 * Decision. The owning reason itself never leaves this boundary.
 */
function revalidationErrorCode(reason: TaskExecutionCreationRevalidationFailure): string {
  if (reason === 'EXPIRED') return AUTHORIZATION_EXPIRED;
  if (REVOKED_REVALIDATION_REASONS[reason] === true) return AUTHORIZATION_REVOKED;
  return AUTHORIZATION_DECISION_INVALID;
}

export function createCreateTaskEntry(config: CreateTaskEntryConfig): CreateTaskEntry {
  const registry = getContractRegistry();
  const boundary: DecisionBoundary = createDecisionBoundary(config);
  const authorization = createTaskExecutionCreationAuthorizationPort({
    capabilityCodes: config.capabilityCodes,
    ...(config.now === undefined ? {} : { now: config.now }),
  });

  /** The same trusted facts, expressed for the two owning transaction contexts. */
  function decisionDeps(row: DecisionRow): IdentityCommandDeps {
    return boundary.identityDeps({
      kind: 'REQUEST',
      principalId: row.principal_id,
      actorSnapshotId: row.actor_snapshot_id,
      authorizationDecisionId: row.authorization_decision_id,
      authorizationDecisionHash: row.payload_hash,
      authorizationDecisionExpiresAt: row.expires_at,
      enterpriseId: row.enterprise_id,
      allowedProjectIds: row.project_id === null ? [] : [row.project_id],
      correlationId: row.authorization_decision_id,
    });
  }

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
      const binding =
        typeof commandType === 'string' && typeof commandVersion === 'string'
          ? TASK_EXECUTION_CREATION_BINDINGS.find(
              (candidate) =>
                candidate.commandType === commandType &&
                candidate.commandVersion === commandVersion,
            )
          : undefined;
      if (
        binding === undefined ||
        typeof commandType !== 'string' ||
        typeof commandVersion !== 'string'
      ) {
        entryError(
          API_CONTRACT_TYPE_UNKNOWN,
          'the creation Envelope is not one of the registered creation versions',
        );
      }
      const violation = registeredViolation(registry, commandType, commandVersion, envelope);
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

      // §16.6 step 3: the Decision must still cover this exact request now,
      // before TaskExecution claims idempotency or returns a historical
      // Receipt. A revoked Grant, an expired Decision, a drifted trusted
      // configuration, a substituted target/version and an unavailable
      // IdentityPolicy all fail closed here.
      let revalidation: TaskExecutionCreationRevalidationResult;
      try {
        revalidation = await authorization.revalidateCreation(decisionDeps(row), {
          decisionRef,
          expectedCommandType: binding.commandType,
          expectedCommandVersion: binding.commandVersion,
          expectedCommandPayloadHash: payloadHash,
          expectedAuthenticationContextHash: sessionHash,
          expectedTargetRef: targetRef as Common.ObjectRef,
        });
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
          revalidationErrorCode(revalidation.reason),
          'the presented Decision no longer covers this creation request',
        );
      }

      const correlationId = command.correlationId as string;
      const internalEnvelope: CommandEnvelope = {
        commandId: command.commandId as string,
        commandType: binding.commandType,
        commandVersion: binding.commandVersion,
        idempotencyScope: createTaskIdempotencyScope(
          binding.commandType,
          binding.commandVersion,
          scope.enterpriseId,
          scope.projectId,
        ),
        idempotencyKey: command.idempotencyKey as string,
        requestPayload: payload,
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
        targetType: binding.targetObjectType,
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
      const projectScope = createTaskExecutionCreationProjectScopePort({
        db: config.enterpriseProjectDb,
        context: boundary.enterpriseProjectContext(row, scope, correlationId),
        commandId: internalEnvelope.commandId,
      });
      return handleCreateTask(
        config.taskExecutionDb,
        taskExecutionContext(row, scope, correlationId),
        internalEnvelope,
        { projectScope },
      );
    },
  };
}
