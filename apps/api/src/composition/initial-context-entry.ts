// IM-06 (#216) composition entry for the initial Context Snapshot build and
// the authoritative Context Snapshot read.
//
// TaskExecution owns the Context Snapshot facts and the build; IdentityPolicy
// owns Decisions, ActorSnapshots, capability grants and Policy versions;
// EnterpriseProject owns the ContextSourceSlice facts. Neither business module
// may read another's schema, so this entry is the
// `execution.build_initial_context_snapshot` / `execution.get_context_snapshot`
// specific part of the shared composition boundary (`decision-boundary.ts`):
//
//   1. the complete registered Envelope is validated for its exact version:
//      `execution.build_initial_context_snapshot@1.0` stays registered but has
//      no approved authorization binding (Spec 003 §19.2), so it is refused
//      here — before any Decision read, Receipt claim or fact write;
//   2. the presented Decision row is read in the requested Project scope and
//      bound to the presented actor;
//   3. the IdentityPolicy-owned Context Snapshot Port revalidates that this
//      same Decision still covers this exact operation/version/Purpose,
//      payload, authentication context, Project scope and target *now*;
//   4. the IdentityPolicy-owned DRAFT dependency-read Port
//      (`contextSnapshotDraftReadV11`, Spec 001 §15.9) then signs one fresh
//      Decision for the request's *complete* `draftSnapshotRef` and
//      immediately revalidates that exact Decision — never the build Decision,
//      never a historical `workOrderDraftReadV11` Decision, and with no
//      fallback when the trusted configuration key is missing;
//   5. only then does the owning TaskExecution handler run, with the
//      revalidated proof as `ports.draftRead`: inside one owning transaction
//      it performs the DRAFT fact read/lock, the Policy resolution and the
//      Source Slice reads re-enter through their own owning entries under
//      fresh Decisions, and the idempotency claim follows — while the read
//      path writes nothing at all: the success result of the read is the
//      owning handler's own result payload.
//
// The §15.9(3) ordering — build Decision revalidation, then the DRAFT
// dependency Decision issue + immediate revalidation, then the handler — keeps
// every TaskExecution DRAFT row untouched until both authorizations have
// closed. The composition layer can name the DRAFT dependency target because
// the build payload carries the complete ContentAddressedRef (snapshot id,
// Project scope and content hash); the DRAFT *fact* read itself stays inside
// the owning handler's transaction.

import type { Kysely } from 'kysely';
import { ContractRegistry, type Common, type EnterpriseProject } from '@zhiju/contracts';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  EnterpriseBusinessError,
  GET_CONTEXT_SOURCE_SLICE_PURPOSE,
  GET_CONTEXT_SOURCE_SLICE_QUERY,
  PROJECT_QUERY_NOT_FOUND,
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
  IDENTITY_ACTOR_SNAPSHOT_INVALID,
  IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED,
  IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID,
  IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID,
  IDENTITY_DECISION_INPUT_INVALID,
  SnapshotBoundaryError,
  TASK_EXECUTION_CONTEXT_SNAPSHOT_BINDINGS,
  authorizeCommand,
  createContextSnapshotDraftReadAuthorizationPort,
  createTaskExecutionContextSnapshotAuthorizationPort,
  resolvePolicy,
  type AuthorizationDecisionView,
  type ContextSnapshotDraftReadCapabilityCodes,
  type ContextSnapshotDraftReadRevalidationFailure,
  type ContextSnapshotDraftReadRevalidationResult,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityPolicyRepository,
  type IdentityTransactionContext,
  type PolicyVersionResolutionView,
  type TaskExecutionContextSnapshotCapabilityCodes,
  type TaskExecutionContextSnapshotRevalidationFailure,
  type TaskExecutionContextSnapshotRevalidationResult,
} from '@zhiju/identity-policy';
import {
  BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND,
  CONTEXT_SNAPSHOT_OBJECT_TYPE,
  GET_CONTEXT_SNAPSHOT_QUERY,
  REFERENCE_INVALID,
  buildInitialContextIdempotencyScope,
  digestCanonicalPayload,
  handleBuildInitialContext,
  handleGetContextSnapshot,
  type CommandEnvelope,
  type CommandResult,
  type ContextBuilderPolicyPort,
  type ContextSourceSliceReadPort,
  type InitialContextBuildPorts,
  type InitialContextDraftReadDecision,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
import {
  AUTHORIZATION_DECISION_OBJECT_TYPE,
  assertActorBinding,
  assertIntegrity,
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

/** Object name of the Project-scoped ContextSourceSlice the build may consume. */
const CONTEXT_SOURCE_SLICE_OBJECT_TYPE = 'zhiju.project.context_source_slice';
const PRINCIPAL_OBJECT_TYPE = 'zhiju.identity.principal';

/** Boundary codes the IdentityPolicy Context Snapshot Port owns and may surface. */
const CONTEXT_SNAPSHOT_BOUNDARY_CODES: Readonly<Record<string, true>> = {
  [IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED]: true,
  [IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID]: true,
  // A target outside the read version's closed spelling set is a Snapshot
  // reference failure, not an unavailable dependency: the read path's own
  // stable exterior must survive, exactly as the draft read entry keeps its
  // WorkOrder-reference code for the same reason.
  [IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID]: true,
  [IDENTITY_DECISION_INPUT_INVALID]: true,
  [IDENTITY_ACTOR_SNAPSHOT_INVALID]: true,
};

/** Revocation-shaped revalidation failures: the covering Grant is gone. */
const REVOKED_REVALIDATION_REASONS: Readonly<Record<string, true>> = {
  NOT_ALLOW: true,
  GRANT_NOT_CURRENT: true,
  POLICY_NOT_CURRENT: true,
  POLICY_INTEGRITY_MISMATCH: true,
  CONFIGURATION_CHANGED: true,
  PRINCIPAL_NOT_ACTIVE: true,
};

/**
 * Trusted capability codes of this entry: the two Context Snapshot
 * authorization entries of Spec 001 §15.8 plus the single approved DRAFT
 * dependency-read entry of §15.9. The layer never falls back to a wildcard or
 * to "the caller is a Service", no two entries ever share a value by
 * construction of the owning Ports, and a missing DRAFT key fails closed
 * inside the owning Port (`IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID`)
 * instead of falling back to the build capability or a historical Decision.
 */
export type InitialContextCapabilityCodes = TaskExecutionContextSnapshotCapabilityCodes &
  ContextSnapshotDraftReadCapabilityCodes;

export interface InitialContextEntryConfig {
  /** Owning TaskExecution database handle over an application-owned pool. */
  readonly taskExecutionDb: Kysely<TaskExecutionDb>;
  /** Owning EnterpriseProject database handle for the Source Slice read. */
  readonly enterpriseProjectDb: Kysely<EnterpriseProjectDb>;
  /** Owning IdentityPolicy dependencies; the Decision/authorization Ports live here. */
  readonly identity: {
    readonly db: Kysely<IdentityPolicyDb>;
    readonly repo: IdentityPolicyRepository;
    readonly crypto: IdentityCryptoPorts;
  };
  /**
   * Trusted capability codes of the Context Snapshot authorization entries of
   * Spec 001 §15.8 and the DRAFT dependency-read entry of §15.9.
   */
  readonly capabilityCodes: InitialContextCapabilityCodes;
  /** Capability codes the transport evaluates for the two owning reads. */
  readonly capabilities: {
    readonly resolvePolicy: string;
    readonly readContextSourceSlice: string;
  };
  /** Trusted server clock. */
  readonly now?: (() => Date) | undefined;
}

export interface InitialContextSession {
  /**
   * Authentication-context hash pinned by the transport for this caller
   * session. The presented Decision must have been issued for exactly this
   * authentication context.
   */
  readonly authenticationContextHash: Buffer;
  /**
   * ActorSnapshot of the same authenticated principal used to authorize the
   * Policy resolution and the Slice reads of one build. The owning entries
   * reject a snapshot of another principal or Scope, so a build fails closed
   * instead of resolving under other grants.
   */
  readonly resolutionActorSnapshotRef: Common.SnapshotRef;
}

export interface InitialContextEntry {
  /** `execution.build_initial_context_snapshot@1.1` through the trusted boundary. */
  build(envelope: unknown, session: InitialContextSession): Promise<CommandResult>;
  /** `execution.get_context_snapshot@1.0` through the trusted boundary. */
  read(envelope: unknown, session: InitialContextSession): Promise<CommandResult>;
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
 * The exact Snapshot identity of one read request: object name, id and Project
 * Scope, compared character by character. A missing, foreign or non-Project
 * Scope fails as the read path's `REFERENCE_INVALID`, which never
 * distinguishes its internal reason and never reveals another Scope's
 * existence. The presented spelling itself is *not* pre-judged here: the
 * IdentityPolicy binding owns the closed spelling set (the canonical identity
 * and the Core v1.0 historical read-back identity, which are not aliases), and
 * the owning handler refuses the historical spelling as its own
 * `REFERENCE_INVALID`.
 */
function contextSnapshotReadTarget(
  payloadRef: unknown,
  envelopeScope: RequestScope,
): Common.ObjectRef {
  const ref = record(payloadRef);
  const refScope = record(ref.scope);
  const objectType = ref.objectType;
  const objectId = uuid(ref.objectId);
  if (
    typeof objectType !== 'string' ||
    objectId === undefined ||
    refScope.enterpriseId !== envelopeScope.enterpriseId ||
    refScope.projectId !== envelopeScope.projectId
  ) {
    entryError(
      REFERENCE_INVALID,
      'contextSnapshotRef must be a Snapshot identity in the requested Project',
    );
  }
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: { enterpriseId: envelopeScope.enterpriseId, projectId: envelopeScope.projectId },
  };
}

/**
 * The revalidation failure reduced to its stable public error: expiry keeps
 * `AUTHORIZATION_EXPIRED`, a revoked/replaced covering Grant or Policy keeps
 * `AUTHORIZATION_REVOKED`, and every binding mismatch stays an invalid
 * Decision. The owning reason itself never leaves this boundary.
 */
function revalidationErrorCode(
  reason:
    TaskExecutionContextSnapshotRevalidationFailure | ContextSnapshotDraftReadRevalidationFailure,
): string {
  if (reason === 'EXPIRED') return AUTHORIZATION_EXPIRED;
  if (REVOKED_REVALIDATION_REASONS[reason] === true) return AUTHORIZATION_REVOKED;
  return AUTHORIZATION_DECISION_INVALID;
}

export function createInitialContextEntry(config: InitialContextEntryConfig): InitialContextEntry {
  const registry = new ContractRegistry();
  const boundary: DecisionBoundary = createDecisionBoundary(config);
  const authorization = createTaskExecutionContextSnapshotAuthorizationPort({
    capabilityCodes: config.capabilityCodes,
    ...(config.now === undefined ? {} : { now: config.now }),
  });
  // The §15.9 DRAFT dependency-read Port of this build: it reads only its own
  // `contextSnapshotDraftReadV11` key of the same trusted configuration, so a
  // missing or drifted value fails closed inside the Port and never falls back
  // to the build capability.
  const draftReadAuthorization = createContextSnapshotDraftReadAuthorizationPort({
    capabilityCodes: config.capabilityCodes,
    ...(config.now === undefined ? {} : { now: config.now }),
  });
  const now: () => Date = config.now ?? ((): Date => new Date());

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

  /**
   * The §15.9(3) DRAFT dependency-read authorization of one build: one fresh
   * Decision signed for the request's complete `draftSnapshotRef` under this
   * entry's own capability, immediately revalidated, then reduced to the
   * proof the owning handler requires. Every negative path fails closed here —
   * before the handler, and with it any TaskExecution DRAFT row read or lock,
   * the idempotency claim and any historical Receipt return, is reached.
   */
  async function draftReadProof(
    row: DecisionRow,
    request: {
      readonly commandVersion: string;
      readonly draftSnapshotRef: unknown;
      readonly payloadHash: Buffer;
      readonly authenticationContextHash: Buffer;
      readonly actorSnapshotRef: unknown;
    },
  ): Promise<InitialContextDraftReadDecision> {
    const deps = boundary.identityDeps(decisionContext(row));
    const draftSnapshotRef = request.draftSnapshotRef as Common.ContentAddressedRef;
    let issued: Awaited<
      ReturnType<typeof draftReadAuthorization.authorizeContextSnapshotDraftRead>
    >;
    try {
      issued = await draftReadAuthorization.authorizeContextSnapshotDraftRead(deps, {
        actorSnapshotRef: request.actorSnapshotRef as Common.SnapshotRef,
        commandType: BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND,
        commandVersion: request.commandVersion,
        draftSnapshotRef,
        commandPayloadHash: request.payloadHash,
        authenticationContextHash: request.authenticationContextHash,
      });
    } catch (error) {
      if (
        error instanceof SnapshotBoundaryError &&
        CONTEXT_SNAPSHOT_BOUNDARY_CODES[error.code] === true
      ) {
        entryError(
          error.code,
          'the DRAFT dependency-read Decision cannot be issued for this build',
        );
      }
      entryError(DEPENDENCY_UNAVAILABLE, 'draft dependency-read authorization is unavailable');
    }
    if (
      issued.outcome !== 'ALLOW' ||
      issued.authorizationDecisionRef === undefined ||
      issued.expiresAt === undefined
    ) {
      // The owning Port's masked denial: no single Grant covers this read.
      entryError(
        AUTHORIZATION_REVOKED,
        'the current capability grant does not cover the DRAFT dependency read',
      );
    }
    let proof: ContextSnapshotDraftReadRevalidationResult;
    try {
      proof = await draftReadAuthorization.revalidateContextSnapshotDraftRead(deps, {
        decisionRef: issued.authorizationDecisionRef,
        expectedCommandType: BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND,
        expectedCommandVersion: request.commandVersion,
        expectedCommandPayloadHash: request.payloadHash,
        expectedAuthenticationContextHash: request.authenticationContextHash,
        expectedDraftSnapshotRef: draftSnapshotRef,
      });
    } catch (error) {
      if (
        error instanceof SnapshotBoundaryError &&
        CONTEXT_SNAPSHOT_BOUNDARY_CODES[error.code] === true
      ) {
        entryError(
          error.code,
          'the DRAFT dependency-read Decision cannot be revalidated for this build',
        );
      }
      entryError(DEPENDENCY_UNAVAILABLE, 'draft dependency-read authorization is unavailable');
    }
    if (!proof.valid) {
      entryError(
        revalidationErrorCode(proof.reason),
        'the DRAFT dependency-read Decision no longer covers this build request',
      );
    }
    return {
      draftSnapshotRef: proof.draftSnapshotRef as unknown as CanonicalJsonObject,
      authorizationDecisionRef: proof.authorizationDecisionRef as unknown as CanonicalJsonObject,
      expiresAt: proof.expiresAt,
    };
  }

  /**
   * Mints one Decision for an owning read with the caller's own actor snapshot
   * and then runs the read under that Decision. Every read this entry performs —
   * the Policy resolution and each Slice dereference — gets its own authorization;
   * none of them inherits the build Decision, and an unavailable entry throws
   * instead of degrading into a default answer.
   */
  async function authorizedRead<T>(
    row: DecisionRow,
    session: InitialContextSession,
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
   * entry, under a Decision minted for this read. The builder Policy Port and
   * the capture-Policy Port of the owning Slice read both need exactly this,
   * and neither inherits the build Decision: the resolution carries its own
   * purpose, capability and current grant.
   */
  function resolvePolicyView(
    row: DecisionRow,
    session: InitialContextSession,
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
   * The builder Policy Port of §19.4 item 3: the only source of a Policy
   * observation is the owning `identity.resolve_policy@1.0` entry and the
   * fields are mapped one by one. A caller-supplied or fixture-derived
   * observation never enters here.
   */
  function builderPolicyPort(
    row: DecisionRow,
    session: InitialContextSession,
  ): ContextBuilderPolicyPort {
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
          policyRef: view.policyRef as unknown as CanonicalJsonObject,
          contentHash: view.contentHash.digest,
          effectiveFrom: view.effectiveFrom,
          supersededAt: view.supersededAt ?? null,
          policyDocument: view.policyDocument,
          policySchemaRefs: view.policySchemaRefs,
        };
      },
    };
  }

  /** The capture-Policy Port the owning Slice read expects for its own re-check. */
  function sliceCapturePolicyPort(
    row: DecisionRow,
    session: InitialContextSession,
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
   * The Source Slice read of §19.3 item 3. The reference is dereferenced
   * through the owning AUTHORITATIVE `project.get_context_source_slice@1.0`
   * read, which re-checks the reference, Scope, purpose, audience and the
   * capture Policy lifecycle under its own Decision minted for this read; the
   * build only learns the owning observation. A missing committed Slice is the
   * Port's own `undefined` answer — the owning handler, not this entry,
   * decides that a missing or unusable Slice rejects the build — while an
   * unavailable read boundary fails closed as `DEPENDENCY_UNAVAILABLE`.
   */
  function sliceReadPort(
    row: DecisionRow,
    session: InitialContextSession,
  ): ContextSourceSliceReadPort {
    return {
      async getContextSourceSlice(request) {
        const ref = record(request.sourceSliceRef);
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
          throw new SnapshotBoundaryError(
            API_VALUE_INVALID,
            'the source slice reference is not a Slice content address',
          );
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
          if (error instanceof EnterpriseBusinessError && error.code === PROJECT_QUERY_NOT_FOUND) {
            return undefined;
          }
          if (error instanceof SnapshotBoundaryError) {
            throw new SnapshotBoundaryError(
              DEPENDENCY_UNAVAILABLE,
              'the source slice read is unavailable',
            );
          }
          throw error;
        }
        return {
          slice: result.slice as unknown as CanonicalJsonObject,
          useStatus: result.useStatus,
          checkedAt: result.checkedAt,
        };
      },
    };
  }

  return {
    async build(envelope, session) {
      const command = record(envelope);
      const commandType = command.commandType;
      const commandVersion = command.commandVersion;
      if (
        typeof commandType !== 'string' ||
        typeof commandVersion !== 'string' ||
        commandType !== BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND
      ) {
        entryError(
          API_CONTRACT_TYPE_UNKNOWN,
          'the build Envelope is not the registered initial Context Snapshot build version',
        );
      }
      // The IdentityPolicy binding fixes the one approved authorization entry
      // of this operation: the table has no alias, no prefix, no case variant
      // and no implicit default, and the registered `...@1.0` build is absent
      // from it, so it is refused here — before any Decision is read and
      // before TaskExecution claims idempotency (TE-P210-020).
      const binding = TASK_EXECUTION_CONTEXT_SNAPSHOT_BINDINGS.find(
        (candidate) =>
          candidate.commandType === BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND &&
          candidate.commandVersion === commandVersion,
      );
      if (binding === undefined) {
        entryError(
          API_CONTRACT_TYPE_UNKNOWN,
          'the build Envelope is not the registered initial Context Snapshot build version',
        );
      }
      const violation = registeredViolation(
        registry,
        BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND,
        binding.commandVersion,
        envelope,
      );
      if (violation !== null) {
        entryError(violation, 'the build Envelope does not satisfy its registered contract');
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

      // §19.2: the Decision must still cover this exact build now, before
      // TaskExecution claims idempotency or returns a historical Receipt. A
      // revoked Grant, an expired Decision, a drifted trusted configuration, a
      // substituted target/version and an unavailable IdentityPolicy all fail
      // closed here.
      let revalidation: TaskExecutionContextSnapshotRevalidationResult;
      try {
        revalidation = await authorization.revalidateContextSnapshot(
          boundary.identityDeps(decisionContext(row)),
          {
            decisionRef,
            expectedCommandType: binding.commandType,
            expectedCommandVersion: binding.commandVersion,
            expectedCommandPayloadHash: payloadHash,
            expectedAuthenticationContextHash: sessionHash,
            expectedTargetRef: targetRef as Common.ObjectRef,
          },
        );
      } catch (error) {
        if (
          error instanceof SnapshotBoundaryError &&
          CONTEXT_SNAPSHOT_BOUNDARY_CODES[error.code] === true
        ) {
          entryError(error.code, 'the build Decision cannot be revalidated for this request');
        }
        entryError(DEPENDENCY_UNAVAILABLE, 'context snapshot authorization is unavailable');
      }
      if (!revalidation.valid) {
        entryError(
          revalidationErrorCode(revalidation.reason),
          'the presented Decision no longer covers this build request',
        );
      }

      // §15.9(3): the DRAFT dependency read is authorized now — after the
      // build Decision revalidation and before the owning handler touches any
      // TaskExecution DRAFT row, claims idempotency or returns a historical
      // Receipt. The Decision is minted for the request's complete
      // `draftSnapshotRef` under this entry's own capability and immediately
      // revalidated; every negative path fails closed here.
      const draftRead = await draftReadProof(row, {
        commandVersion: binding.commandVersion,
        draftSnapshotRef: record(payload.request).draftSnapshotRef,
        payloadHash,
        authenticationContextHash: sessionHash,
        actorSnapshotRef: command.actor,
      });

      const correlationId = command.correlationId as string;
      const internalEnvelope: CommandEnvelope = {
        commandId: command.commandId as string,
        commandType: binding.commandType,
        commandVersion: binding.commandVersion,
        idempotencyScope: buildInitialContextIdempotencyScope(
          binding.commandType,
          binding.commandVersion,
          scope.enterpriseId,
          scope.projectId,
        ),
        idempotencyKey: command.idempotencyKey as string,
        requestPayload: payload,
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
        targetType: CONTEXT_SNAPSHOT_OBJECT_TYPE,
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
      const ports: InitialContextBuildPorts = {
        slices: sliceReadPort(row, session),
        policy: builderPolicyPort(row, session),
        draftRead,
        // The owning handler samples the same trusted clock the authorization
        // Port and the owning reads above already use, so this entry never
        // leaves two clocks disagreeing about one request.
        now,
      };
      return handleBuildInitialContext(
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
        queryType !== GET_CONTEXT_SNAPSHOT_QUERY
      ) {
        entryError(
          API_CONTRACT_TYPE_UNKNOWN,
          'the read Envelope is not the registered Context Snapshot read version',
        );
      }
      // The IdentityPolicy binding fixes the authorization entry of this exact
      // `(type, version)` pair and owns the closed target spelling set. The
      // table is not interpolated: a version outside it has no approved read
      // at all and is refused here, before any Decision is read.
      const binding = TASK_EXECUTION_CONTEXT_SNAPSHOT_BINDINGS.find(
        (candidate) =>
          candidate.commandType === GET_CONTEXT_SNAPSHOT_QUERY &&
          candidate.commandVersion === queryVersion,
      );
      if (binding === undefined) {
        entryError(
          API_CONTRACT_TYPE_UNKNOWN,
          'the read Envelope is not the registered Context Snapshot read version',
        );
      }
      const violation = registeredViolation(
        registry,
        GET_CONTEXT_SNAPSHOT_QUERY,
        binding.commandVersion,
        envelope,
      );
      if (violation !== null) {
        entryError(violation, 'the read Envelope does not satisfy its registered contract');
      }
      if (query.consistencyRequirement !== 'AUTHORITATIVE') {
        entryError(API_VALUE_INVALID, 'the snapshot read Query must be AUTHORITATIVE');
      }
      const scope = requestedProjectScope(query.scopeRef);
      const payload = record(query.payload) as unknown as CanonicalJsonObject;
      const payloadHash = payloadHashOf(payload);
      const targetRef = contextSnapshotReadTarget(payload.contextSnapshotRef, scope);
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

      // §19.2: before any read fact — including a historical one — is
      // returned, the presented Decision must still cover this exact read now:
      // the exact id/hash, the actual principal, the authentication context,
      // the operation/version/Purpose, the payload hash, the exact target and
      // Project Scope, ALLOW and expiry, plus a fresh read of the single
      // covering Grant and its Policy Snapshot. A revoked Grant, an expired
      // Decision, a drifted trusted configuration, a substituted target or
      // version and an unavailable IdentityPolicy all fail closed here.
      let revalidation: TaskExecutionContextSnapshotRevalidationResult;
      try {
        revalidation = await authorization.revalidateContextSnapshot(
          boundary.identityDeps(decisionContext(row)),
          {
            decisionRef,
            expectedCommandType: binding.commandType,
            expectedCommandVersion: binding.commandVersion,
            expectedCommandPayloadHash: payloadHash,
            expectedAuthenticationContextHash: sessionHash,
            expectedTargetRef: targetRef,
          },
        );
      } catch (error) {
        if (
          error instanceof SnapshotBoundaryError &&
          CONTEXT_SNAPSHOT_BOUNDARY_CODES[error.code] === true
        ) {
          entryError(
            error.code === IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID
              ? REFERENCE_INVALID
              : error.code,
            'the snapshot read Decision cannot be revalidated for this request',
          );
        }
        entryError(DEPENDENCY_UNAVAILABLE, 'snapshot read authorization is unavailable');
      }
      if (!revalidation.valid) {
        entryError(
          revalidationErrorCode(revalidation.reason),
          'the presented Decision no longer covers this snapshot read',
        );
      }

      const correlationId = query.correlationId as string;
      const result = await handleGetContextSnapshot(
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
