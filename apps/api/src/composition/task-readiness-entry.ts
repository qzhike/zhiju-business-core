import {
  createFormalCompletionDependencyPorts,
  type FormalCompletionEntryConfig,
} from './formal-completion-entry.js';
import type { DependencyCompletionPort } from '@zhiju/task-execution';
// IM-06 (#208) composition entries for the Task Readiness production and the
// `DRAFT` → `READY` transition.
//
// TaskExecution owns the Task Root, its immutable definition and the readiness
// judgment; IdentityPolicy owns Decisions, ActorSnapshots, capability grants and
// Policy version resolution; EnterpriseProject owns the ContextSourceSlice facts.
// Neither business module may read another's schema, so this entry is the
// `execution.build_task_readiness` / `execution.mark_task_ready` specific part of
// the shared composition boundary (`decision-boundary.ts`):
//
//   1. the complete registered Envelope is validated for its exact version;
//   2. the presented Decision row is read in the requested Project scope and
//      bound to the presented actor;
//   3. the IdentityPolicy-owned readiness Port revalidates the *entry of this
//      operation* — producer or consumer, never the other one — before
//      TaskExecution claims idempotency or returns a historical Receipt;
//   4. the owning TaskExecution handler runs inside one owning transaction, and
//      the writes it performs re-read the Policy and the input references through
//      their own owning entries, each with its own Decision.

import type { Kysely } from 'kysely';
import { ContractRegistry, type Common, type EnterpriseProject } from '@zhiju/contracts';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  GET_CONTEXT_SOURCE_SLICE_PURPOSE,
  GET_CONTEXT_SOURCE_SLICE_QUERY,
  handleGetContextSourceSlice,
  type CapturePolicyResolution,
  type CapturePolicyResolutionPort,
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
  IDENTITY_READINESS_AUTHORIZATION_UNSUPPORTED,
  IDENTITY_READINESS_CAPABILITY_CONFIG_INVALID,
  IDENTITY_READINESS_TARGET_INVALID,
  IDENTITY_ACTOR_SNAPSHOT_INVALID,
  IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID,
  IDENTITY_DECISION_INPUT_INVALID,
  SnapshotBoundaryError,
  authorizeCommand,
  createTaskExecutionReadinessAuthorizationPort,
  resolvePolicy,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityPolicyRepository,
  type AuthorizationDecisionView,
  type IdentityTransactionContext,
  type PolicyVersionResolutionView,
  type TaskExecutionReadinessCapabilityCodes,
  type TaskExecutionReadinessRevalidationFailure,
  type TaskExecutionReadinessRevalidationResult,
} from '@zhiju/identity-policy';
import {
  BUILD_TASK_READINESS_COMMAND,
  EXECUTION_TASK_REF_INVALID,
  MARK_TASK_READY_COMMAND,
  buildTaskReadinessIdempotencyScope,
  handleBuildTaskReadiness,
  handleMarkTaskReady,
  type CommandEnvelope,
  type CommandResult,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
  type TaskReadinessInputRefPort,
  type TaskReadinessPolicyPort,
} from '@zhiju/task-execution';
import {
  AUTHORIZATION_DECISION_OBJECT_TYPE,
  assertIntegrity,
  assertActorBinding,
  contentHash,
  createDecisionBoundary,
  decisionReference,
  digest,
  entryError,
  payloadHashOf,
  policySnapshotReference,
  record,
  sessionAuthenticationContextHash,
  uuid,
  type DecisionBoundary,
  type DecisionRow,
  type RequestScope,
} from './decision-boundary.js';
import { RESOLVE_POLICY_COMMAND, RESOLVE_POLICY_PURPOSE } from './context-source-slice-entry.js';

/** Object name of the Project-scoped ContextSourceSlice the producer may consume. */
const CONTEXT_SOURCE_SLICE_OBJECT_TYPE = 'zhiju.project.context_source_slice';
const PRINCIPAL_OBJECT_TYPE = 'zhiju.identity.principal';

/** Readiness boundary codes the IdentityPolicy Port owns and may surface. */
const READINESS_BOUNDARY_CODES: Readonly<Record<string, true>> = {
  [IDENTITY_READINESS_AUTHORIZATION_UNSUPPORTED]: true,
  // A target outside this entry's closed target identity is a Task/readiness
  // reference failure, not an unavailable dependency: without this entry the
  // closed target gate would surface as DEPENDENCY_UNAVAILABLE and lose the
  // stable exterior the design fixes for it.
  [IDENTITY_READINESS_TARGET_INVALID]: true,
  [IDENTITY_READINESS_CAPABILITY_CONFIG_INVALID]: true,
  [IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID]: true,
  [IDENTITY_DECISION_INPUT_INVALID]: true,
  [IDENTITY_ACTOR_SNAPSHOT_INVALID]: true,
};

/** Revocation-shaped revalidation failures: the covering Grant is gone. */
const REVOKED_REVALIDATION_REASONS: Readonly<
  Partial<Record<TaskExecutionReadinessRevalidationFailure, true>>
> = {
  NOT_ALLOW: true,
  GRANT_NOT_CURRENT: true,
  POLICY_NOT_CURRENT: true,
  POLICY_INTEGRITY_MISMATCH: true,
  CONFIGURATION_CHANGED: true,
  PRINCIPAL_NOT_ACTIVE: true,
};

export interface TaskReadinessEntryConfig {
  readonly formalCompletion?: FormalCompletionEntryConfig;
  readonly completion?: (
    row: DecisionRow,
    session: TaskReadinessSession,
    consumer: 'readiness_build' | 'readiness_consume',
  ) => DependencyCompletionPort;
  /** Owning TaskExecution database handle over an application-owned pool. */
  readonly taskExecutionDb: Kysely<TaskExecutionDb>;
  /** Owning EnterpriseProject database handle for the input-reference read. */
  readonly enterpriseProjectDb: Kysely<EnterpriseProjectDb>;
  /** Owning IdentityPolicy dependencies; the Decision/readiness Ports live here. */
  readonly identity: {
    readonly db: Kysely<IdentityPolicyDb>;
    readonly repo: IdentityPolicyRepository;
    readonly crypto: IdentityCryptoPorts;
  };
  /**
   * Trusted capability codes of the two readiness authorization entries of
   * Spec 001 §15.5. The layer never falls back to a wildcard or to "the caller
   * is a Service", and the two entries never share a value by construction of
   * the owning Port.
   */
  readonly capabilityCodes: TaskExecutionReadinessCapabilityCodes;
  /** Capability codes the transport evaluates for the two owning reads. */
  readonly capabilities: {
    readonly resolvePolicy: string;
    readonly readContextSourceSlice: string;
  };
  /** Trusted server clock. */
  readonly now?: (() => Date) | undefined;
}

export interface TaskReadinessSession {
  /**
   * Authentication-context hash pinned by the transport for this caller
   * session. The presented Decision must have been issued for exactly this
   * authentication context.
   */
  readonly authenticationContextHash: Buffer;
  /**
   * ActorSnapshot of the same authenticated principal used to authorize the
   * Policy resolution and the Slice read. The owning entries reject a snapshot
   * of another principal or Scope, so a readiness request fails closed instead
   * of resolving under other grants.
   */
  readonly resolutionActorSnapshotRef: Common.SnapshotRef;
}

export interface TaskReadinessEntry {
  /** `execution.build_task_readiness@1.0` through the trusted boundary. */
  build(envelope: unknown, session: TaskReadinessSession): Promise<CommandResult>;
  /** `execution.mark_task_ready@1.0` through the trusted boundary. */
  markReady(envelope: unknown, session: TaskReadinessSession): Promise<CommandResult>;
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

/** The requested Project scope; the registered Schema already pins both ids. */
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
function revalidationErrorCode(reason: TaskExecutionReadinessRevalidationFailure): string {
  if (reason === 'EXPIRED') return AUTHORIZATION_EXPIRED;
  if (REVOKED_REVALIDATION_REASONS[reason] === true) return AUTHORIZATION_REVOKED;
  return AUTHORIZATION_DECISION_INVALID;
}

export function createTaskReadinessEntry(config: TaskReadinessEntryConfig): TaskReadinessEntry {
  const registry = new ContractRegistry();
  const boundary: DecisionBoundary = createDecisionBoundary(config);
  const authorization = createTaskExecutionReadinessAuthorizationPort({
    capabilityCodes: config.capabilityCodes,
    ...(config.now === undefined ? {} : { now: config.now }),
  });
  const now: () => Date = config.now ?? ((): Date => new Date());

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

  /**
   * Mints one Decision for an owning read with the caller's own actor snapshot
   * and then runs the read under that Decision. Every read this entry performs —
   * the Policy resolution and the Slice dereference — gets its own authorization;
   * none of them inherits the readiness Decision, and an unavailable entry throws
   * instead of degrading into a default answer.
   */
  async function authorizedRead<T>(
    row: DecisionRow,
    session: TaskReadinessSession,
    request: {
      readonly commandType: string;
      readonly commandVersion: string;
      readonly purpose: string;
      readonly capability: string;
      readonly scopeValue: CanonicalJsonObject;
      readonly scopeKind: 'ENTERPRISE' | 'PROJECT';
      readonly projectId?: string | undefined;
      readonly payloadHash: Buffer;
      readonly correlationId: string;
    },
    read: (deps: IdentityCommandDeps) => Promise<T>,
  ): Promise<T> {
    const baseContext: IdentityTransactionContext = {
      kind: 'REQUEST',
      principalId: row.principal_id,
      actorSnapshotId: session.resolutionActorSnapshotRef.snapshotId,
      authorizationDecisionId: row.authorization_decision_id,
      authorizationDecisionHash: row.payload_hash,
      authorizationDecisionExpiresAt: row.expires_at,
      enterpriseId: row.enterprise_id,
      allowedProjectIds: request.projectId === undefined ? [] : [request.projectId],
      correlationId: request.correlationId,
    };
    let authorized: AuthorizationDecisionView;
    try {
      authorized = await authorizeCommand(boundary.identityDeps(baseContext), {
        actorSnapshotRef: session.resolutionActorSnapshotRef,
        intent: {
          commandType: request.commandType,
          commandVersion: request.commandVersion,
          scopeKind: request.scopeKind,
          enterpriseId: row.enterprise_id,
          ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
          purpose: request.purpose,
          requestedCapability: request.capability,
          commandPayloadHash: request.payloadHash,
          requestedAt: now(),
          highRiskAction: false,
        },
        authenticationContextHash: sessionAuthenticationContextHash(session),
        policySnapshotRef: policySnapshotReference(row),
      });
    } catch (error) {
      if (error instanceof SnapshotBoundaryError) {
        throw new SnapshotBoundaryError(DEPENDENCY_UNAVAILABLE, 'owning read authorization failed');
      }
      throw error;
    }
    if (authorized.outcome !== 'ALLOW') {
      throw new SnapshotBoundaryError(
        AUTHORIZATION_REVOKED,
        'the current capability grant does not cover this owning read',
      );
    }
    return read(
      boundary.identityDeps({
        ...baseContext,
        authorizationDecisionId: authorized.authorizationDecisionRef.objectId,
        authorizationDecisionHash: Buffer.from(
          authorized.authorizationDecisionRef.contentHash.digest,
          'hex',
        ),
        authorizationDecisionExpiresAt: new Date(authorized.expiresAt),
      }),
    );
  }

  /**
   * One Policy resolution through the owning `identity.resolve_policy@1.0`
   * entry, under a Decision minted for this read. The producer's Policy Port and
   * the capture-Policy Port of the owning Slice read both need exactly this, and
   * neither inherits the readiness Decision: the resolution carries its own
   * purpose, capability and current grant.
   */
  function resolvePolicyView(
    row: DecisionRow,
    session: TaskReadinessSession,
    request: {
      readonly policyRef: Common.VersionedRef;
      readonly asOf: Date;
      readonly correlationId: string;
    },
  ): Promise<PolicyVersionResolutionView> {
    const policyScope = record(request.policyRef).scope;
    const projectId = uuid(record(policyScope).projectId);
    return authorizedRead(
      row,
      session,
      {
        commandType: RESOLVE_POLICY_COMMAND,
        commandVersion: '1.0',
        purpose: RESOLVE_POLICY_PURPOSE,
        capability: config.capabilities.resolvePolicy,
        scopeValue: policyScope as CanonicalJsonObject,
        scopeKind: projectId === undefined ? 'ENTERPRISE' : 'PROJECT',
        ...(projectId === undefined ? {} : { projectId }),
        payloadHash: payloadHashOf({ policyRef: request.policyRef }),
        correlationId: request.correlationId,
      },
      (deps) =>
        resolvePolicy(deps, {
          envelope: {
            queryId: newUuidV7(),
            queryType: RESOLVE_POLICY_COMMAND,
            queryVersion: '1.0',
            scopeRef: policyScope,
            requester: {
              kind: 'OBJECT',
              objectType: PRINCIPAL_OBJECT_TYPE,
              objectId: row.principal_id,
              scope: policyScope,
            },
            authenticationContextRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'zhiju.identity.authentication_context',
              objectId: row.actor_snapshot_id,
              scope: policyScope,
              contentHash: contentHash(sessionAuthenticationContextHash(session).toString('hex')),
            },
            authorizationDecisionRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: AUTHORIZATION_DECISION_OBJECT_TYPE,
              objectId: deps.context.authorizationDecisionId,
              scope: policyScope,
              contentHash: contentHash(deps.context.authorizationDecisionHash.toString('hex')),
            },
            consistencyRequirement: 'AUTHORITATIVE',
            correlationId: request.correlationId,
            requestedAt: request.asOf.toISOString(),
            payload: { policyRef: request.policyRef },
          },
          asOf: request.asOf,
        }),
    );
  }

  /**
   * The Policy Port of §17.6: the only source of a Policy observation is the
   * owning `identity.resolve_policy@1.0` entry and the fields are mapped one by
   * one. A caller-supplied or fixture-derived observation never enters here.
   */
  function policyPort(row: DecisionRow, session: TaskReadinessSession): TaskReadinessPolicyPort {
    return {
      async resolvePolicy(request) {
        let view: PolicyVersionResolutionView;
        try {
          view = await resolvePolicyView(row, session, {
            policyRef: request.policyRef as unknown as Common.VersionedRef,
            asOf: now(),
            correlationId: row.authorization_decision_id,
          });
        } catch (error) {
          if (error instanceof SnapshotBoundaryError) {
            throw new SnapshotBoundaryError(
              DEPENDENCY_UNAVAILABLE,
              'policy resolution is unavailable',
            );
          }
          throw error;
        }
        if (view.useStatus !== 'USABLE') return { status: view.useStatus };
        return {
          status: 'USABLE',
          policyVersionRef: view.policyVersionRef as unknown as CanonicalJsonObject,
          contentHash: view.contentHash.digest,
          effectiveFrom: view.effectiveFrom,
          supersededAt: view.supersededAt ?? null,
          policyDocument: view.policyDocument,
          policySchemaRefs: view.policySchemaRefs,
          scopeRef: view.scopeRef as unknown as CanonicalJsonObject,
        };
      },
    };
  }

  /** The capture-Policy Port the owning Slice read expects for its own re-check. */
  function sliceCapturePolicyPort(
    row: DecisionRow,
    session: TaskReadinessSession,
  ): CapturePolicyResolutionPort {
    return {
      async resolveCapturePolicy(request): Promise<CapturePolicyResolution> {
        try {
          const view = await resolvePolicyView(row, session, request);
          return {
            kind: 'RESOLVED',
            observation: {
              policyRef: view.policyRef,
              policyVersionRef: view.policyVersionRef,
              policySetVersion: view.policySetVersion,
              policySchemaRefs: view.policySchemaRefs,
              policyDocument: view.policyDocument,
              contentHash: view.contentHash,
              scopeRef: view.scopeRef,
              effectiveFrom: view.effectiveFrom,
              ...(view.supersededAt === undefined ? {} : { supersededAt: view.supersededAt }),
              useStatus: view.useStatus,
              checkedAt: view.checkedAt,
            },
          };
        } catch (error) {
          if (error instanceof SnapshotBoundaryError) return { kind: 'UNAVAILABLE' };
          throw error;
        }
      },
    };
  }

  /**
   * The one supported input kind of §17.5 step 5. The reference is dereferenced
   * through the owning AUTHORITATIVE `project.get_context_source_slice@1.0` read,
   * which re-checks the reference, Scope, purpose, audience and the capture
   * Policy lifecycle under its own Decision; the producer only learns the
   * owning `useStatus`.
   */
  function inputRefPort(
    row: DecisionRow,
    session: TaskReadinessSession,
  ): TaskReadinessInputRefPort {
    return {
      async resolveInputRef(request) {
        const ref = record(request.inputRef);
        const refScope = record(ref.scope);
        const enterpriseId = uuid(refScope.enterpriseId);
        const projectId = uuid(refScope.projectId);
        const sliceId = uuid(ref.objectId);
        const contentHashHex = digest(ref.contentHash);
        if (
          ref.kind !== 'CONTENT_ADDRESSED' ||
          ref.objectType !== CONTEXT_SOURCE_SLICE_OBJECT_TYPE ||
          sliceId === undefined ||
          enterpriseId === undefined ||
          projectId === undefined ||
          contentHashHex === undefined
        ) {
          entryError(API_VALUE_INVALID, 'the input reference is not a Slice content address');
        }
        const payload: EnterpriseProject.ProjectGetContextSourceSlicePayload = {
          sourceSliceRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
            objectId: sliceId,
            scope: { enterpriseId, projectId },
            contentHash: contentHash(contentHashHex),
          },
        };
        let result: EnterpriseProject.ProjectGetContextSourceSliceResult;
        try {
          result = await authorizedRead(
            row,
            session,
            {
              commandType: GET_CONTEXT_SOURCE_SLICE_QUERY,
              commandVersion: '1.0',
              purpose: GET_CONTEXT_SOURCE_SLICE_PURPOSE,
              capability: config.capabilities.readContextSourceSlice,
              scopeValue: { enterpriseId, projectId },
              scopeKind: 'PROJECT',
              projectId,
              payloadHash: payloadHashOf(payload),
              correlationId: row.authorization_decision_id,
            },
            () =>
              handleGetContextSourceSlice(
                config.enterpriseProjectDb,
                boundary.enterpriseProjectContext(
                  { ...row, purpose: GET_CONTEXT_SOURCE_SLICE_PURPOSE },
                  { scopeKind: 'PROJECT', enterpriseId, projectId },
                  row.authorization_decision_id,
                ),
                payload,
                {
                  policyResolution: sliceCapturePolicyPort(row, session),
                  now,
                },
              ),
          );
        } catch (error) {
          if (error instanceof SnapshotBoundaryError) {
            throw new SnapshotBoundaryError(
              DEPENDENCY_UNAVAILABLE,
              'the input reference read is unavailable',
            );
          }
          throw error;
        }
        if (result.useStatus === 'USABLE') {
          return {
            status: 'USABLE',
            validUntil:
              typeof result.slice.validUntil === 'string' ? result.slice.validUntil : null,
          };
        }
        return { status: result.useStatus === 'EXPIRED' ? 'EXPIRED' : 'REVOKED' };
      },
    };
  }

  /** The shared prologue of both entries: validate, bind, revalidate. */
  async function authorizedCommand(
    entry: { readonly commandType: string; readonly commandVersion: string },
    envelope: unknown,
    session: TaskReadinessSession,
    expectedTarget: (payload: CanonicalJsonObject, targetRef: unknown) => Common.ObjectRef,
    targetErrorCode: string,
  ): Promise<{
    readonly row: DecisionRow;
    readonly scope: RequestScope;
    readonly payload: CanonicalJsonObject;
    readonly payloadHash: Buffer;
    readonly targetRef: Common.ObjectRef;
    readonly correlationId: string;
    readonly revalidate: () => Promise<void>;
  }> {
    const violation = registeredViolation(
      registry,
      entry.commandType,
      entry.commandVersion,
      envelope,
    );
    if (violation !== null) {
      entryError(violation, 'the readiness Envelope does not satisfy its registered contract');
    }
    const command = record(envelope);
    const payload = record(command.payload) as unknown as CanonicalJsonObject;
    const payloadHash = payloadHashOf(payload);
    assertIntegrity(command.integrity, payloadHash);
    const scope = requestedProjectScope(command.scopeRef);
    const targetRef = expectedTarget(payload, command.targetRef);
    const sessionHash = sessionAuthenticationContextHash(session);
    const decisionRef = decisionReference(command.authorizationDecisionRef);
    const row = await boundary.readDecisionRow(decisionRef, scope);
    assertActorBinding(command.actor, row);

    // The entry of *this* operation is revalidated before TaskExecution claims
    // idempotency or returns a historical Receipt. A revoked Grant, an expired
    // Decision, a drifted trusted configuration, a substituted target and an
    // unavailable IdentityPolicy all fail closed here, and the producer entry
    // never authorizes the consumer (or the reverse).
    const revalidate = async () => {
      let revalidation: TaskExecutionReadinessRevalidationResult;
      try {
        revalidation = await authorization.revalidateReadiness(decisionDeps(row), {
          decisionRef,
          expectedCommandType: entry.commandType,
          expectedCommandVersion: entry.commandVersion,
          expectedCommandPayloadHash: payloadHash,
          expectedAuthenticationContextHash: sessionHash,
          expectedTargetRef: targetRef,
        });
      } catch (error) {
        if (
          error instanceof SnapshotBoundaryError &&
          READINESS_BOUNDARY_CODES[error.code] === true
        ) {
          entryError(
            error.code === IDENTITY_READINESS_TARGET_INVALID ? targetErrorCode : error.code,
            'the readiness Decision cannot be revalidated for this request',
          );
        }
        entryError(DEPENDENCY_UNAVAILABLE, 'readiness authorization is unavailable');
      }
      if (!revalidation.valid) {
        entryError(
          revalidationErrorCode(revalidation.reason),
          'the presented Decision no longer covers this readiness request',
        );
      }
    };
    await revalidate();
    return {
      row,
      scope,
      payload,
      payloadHash,
      targetRef,
      correlationId: command.correlationId as string,
      revalidate,
    };
  }

  return {
    async build(envelope, session) {
      const bound = await authorizedCommand(
        { commandType: BUILD_TASK_READINESS_COMMAND, commandVersion: '1.0' },
        envelope,
        session,
        (_payload, targetRef) => targetRef as Common.ObjectRef,
        API_VALUE_INVALID,
      );
      const internalEnvelope: CommandEnvelope = {
        commandId: record(envelope).commandId as string,
        commandType: BUILD_TASK_READINESS_COMMAND,
        commandVersion: '1.0',
        idempotencyScope: buildTaskReadinessIdempotencyScope(
          BUILD_TASK_READINESS_COMMAND,
          '1.0',
          bound.scope.enterpriseId,
          bound.scope.projectId,
        ),
        idempotencyKey: record(envelope).idempotencyKey as string,
        requestPayload: bound.payload,
        enterpriseId: bound.scope.enterpriseId,
        projectId: bound.scope.projectId,
        targetType: 'zhiju.execution.task_readiness',
        targetId: record(bound.targetRef).objectId as string,
        correlationId: bound.correlationId,
        ...(record(envelope).causationId === undefined
          ? {}
          : { causationId: record(envelope).causationId as string }),
        principalId: bound.row.principal_id,
        principalKind: bound.row.principal_kind as CommandEnvelope['principalKind'],
        actorSnapshotId: bound.row.actor_snapshot_id,
        authorizationDecisionId: bound.row.authorization_decision_id,
        policySnapshotId: bound.row.policy_snapshot_id,
      };
      const completion = config.formalCompletion
        ? createFormalCompletionDependencyPorts(
            config.formalCompletion,
            bound.row,
            session,
            'readiness_build',
            bound.revalidate,
          ).completion
        : config.completion?.(bound.row, session, 'readiness_build');
      return handleBuildTaskReadiness(
        config.taskExecutionDb,
        taskExecutionContext(bound.row, bound.scope, bound.correlationId),
        internalEnvelope,
        {
          policy: policyPort(bound.row, session),
          inputRefs: inputRefPort(bound.row, session),
          ...(completion ? { completion } : {}),
          revalidateAuthorization: async () => {
            await bound.revalidate();
            await completion?.revalidate?.();
          },
          now,
        },
      );
    },

    async markReady(envelope, session) {
      const bound = await authorizedCommand(
        { commandType: MARK_TASK_READY_COMMAND, commandVersion: '1.0' },
        envelope,
        session,
        (_payload, targetRef) => targetRef as Common.ObjectRef,
        EXECUTION_TASK_REF_INVALID,
      );
      const declared = record(envelope);
      const internalEnvelope: CommandEnvelope = {
        commandId: declared.commandId as string,
        commandType: MARK_TASK_READY_COMMAND,
        commandVersion: '1.0',
        idempotencyScope: `${MARK_TASK_READY_COMMAND}@1.0:${bound.scope.enterpriseId}:${bound.scope.projectId}`,
        idempotencyKey: declared.idempotencyKey as string,
        requestPayload: bound.payload,
        enterpriseId: bound.scope.enterpriseId,
        projectId: bound.scope.projectId,
        targetType: record(bound.targetRef).objectType as string,
        targetId: record(bound.targetRef).objectId as string,
        // The registered Schema already pins a non-negative integer; the
        // owning handler still compares it as the Task's exact version string.
        expectedAggregateVersion:
          typeof declared.expectedAggregateVersion === 'string'
            ? declared.expectedAggregateVersion
            : typeof declared.expectedAggregateVersion === 'number'
              ? String(declared.expectedAggregateVersion)
              : undefined,
        correlationId: bound.correlationId,
        ...(declared.causationId === undefined
          ? {}
          : { causationId: declared.causationId as string }),
        principalId: bound.row.principal_id,
        principalKind: bound.row.principal_kind as CommandEnvelope['principalKind'],
        actorSnapshotId: bound.row.actor_snapshot_id,
        authorizationDecisionId: bound.row.authorization_decision_id,
        policySnapshotId: bound.row.policy_snapshot_id,
      };
      const completion = config.formalCompletion
        ? createFormalCompletionDependencyPorts(
            config.formalCompletion,
            bound.row,
            session,
            'readiness_consume',
            bound.revalidate,
          ).completion
        : config.completion?.(bound.row, session, 'readiness_consume');
      return handleMarkTaskReady(
        config.taskExecutionDb,
        taskExecutionContext(bound.row, bound.scope, bound.correlationId),
        internalEnvelope,
        {
          policy: policyPort(bound.row, session),
          inputRefs: inputRefPort(bound.row, session),
          ...(completion ? { completion } : {}),
          revalidateAuthorization: async () => {
            await bound.revalidate();
            await completion?.revalidate?.();
          },
          now,
        },
      );
    },
  };
}
