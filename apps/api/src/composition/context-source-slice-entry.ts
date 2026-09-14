// IM-06 (#188) composition entry for the Context Source Slice boundary.
//
// EnterpriseProject owns the Slice facts; IdentityPolicy owns Decisions,
// ActorSnapshots, capability grants and Policy version resolution. Neither
// module may read the other's schema, so this entry is the Context Source
// Slice specific part of the shared composition boundary
// (`decision-boundary.ts`): it validates the registered Envelope, proves the
// presented Decision through the owning IdentityPolicy ports with the shared
// boundary, derives the trusted EnterpriseProject context from that Decision,
// and consumes the capture Policy through the IdentityPolicy-owned
// `identity.resolve_policy@1.0` entry with its own
// `identity.policy.resolve_policy` Decision minted for the same principal.

import type { Kysely } from 'kysely';
import { ContractRegistry, type Common, type EnterpriseProject } from '@zhiju/contracts';
import {
  CAPTURE_CONTEXT_SOURCE_SLICE_COMMAND,
  CAPTURE_CONTEXT_SOURCE_SLICE_IDEMPOTENCY_SCOPE,
  CAPTURE_CONTEXT_SOURCE_SLICE_PURPOSE,
  CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
  CONTEXT_SOURCE_SLICE_TARGET,
  GET_CONTEXT_SOURCE_SLICE_PURPOSE,
  GET_CONTEXT_SOURCE_SLICE_QUERY,
  handleCaptureContextSourceSlice,
  handleGetContextSourceSlice,
  type CapturePolicyResolution,
  type CapturePolicyResolutionPort,
  type CommandEnvelope,
  type CommandResult,
  type EnterpriseProjectDb,
} from '@zhiju/enterprise-project';
import {
  API_VALUE_INVALID,
  AUTHORIZATION_DECISION_INVALID,
  DEPENDENCY_UNAVAILABLE,
  SCOPE_MISMATCH,
  SnapshotBoundaryError,
  authorizeCommand,
  resolvePolicy,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityPolicyRepository,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  AUTHORIZATION_DECISION_OBJECT_TYPE,
  assertIntegrity,
  contentHash,
  contractViolation,
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

/** Registered Policy resolution entry used by the capture Policy Port. */
export const RESOLVE_POLICY_COMMAND = 'identity.resolve_policy';
export const RESOLVE_POLICY_PURPOSE = 'identity.policy.resolve_policy';
/**
 * Registered `requestedKinds` vocabulary (the canonical Source Slice kinds of
 * the capture Envelope) mapped onto the owning assembly's kind identifiers.
 * Unknown kinds are refused instead of being normalized or ignored.
 */
const SOURCE_KIND_BY_REQUESTED_KIND: Readonly<Record<string, string>> = {
  project: 'PROJECT',
  enterprise_profile: 'ENTERPRISE_PROFILE',
  qms_configuration: 'QMS_CONFIGURATION',
  product_scope: 'PRODUCT_SCOPE',
  active_baselines: 'ACTIVE_BASELINES',
  enterprise_facts: 'ENTERPRISE_FACTS',
};

export interface ContextSourceSliceEntryConfig {
  /** Owning EnterpriseProject database handle over an application-owned pool. */
  readonly enterpriseProjectDb: Kysely<EnterpriseProjectDb>;
  /** Owning IdentityPolicy dependencies; the Decision/Policy ports live here. */
  readonly identity: {
    readonly db: Kysely<IdentityPolicyDb>;
    readonly repo: IdentityPolicyRepository;
    readonly crypto: IdentityCryptoPorts;
  };
  /**
   * Capability codes the transport evaluates for the registered purposes. The
   * layer never falls back to a wildcard or to "the caller is a Service".
   */
  readonly capabilities: {
    readonly capture: string;
    readonly read: string;
    readonly resolve: string;
  };
  /** Trusted server clock. */
  readonly now?: (() => Date) | undefined;
}

export interface ContextSourceSliceSession {
  /**
   * Authentication-context hash pinned by the transport for this caller
   * session. The presented Decision must have been issued for exactly this
   * authentication context.
   */
  readonly authenticationContextHash: Buffer;
  /**
   * ActorSnapshot of the same authenticated principal used to authorize the
   * capture Policy resolution. Its Scope shape selects the resolution Scope,
   * and the owning `identity.resolve_policy@1.0` entry rejects it whenever it
   * belongs to another principal or does not cover the Policy version key, so
   * the capture fails closed instead of resolving under other grants.
   */
  readonly policyResolutionActorSnapshotRef: Common.SnapshotRef;
}

export interface ContextSourceSliceEntry {
  /** `project.capture_context_source_slice@1.0` through the trusted boundary. */
  capture(envelope: unknown, session: ContextSourceSliceSession): Promise<CommandResult>;
  /** `project.get_context_source_slice@1.0` through the trusted boundary. */
  read(
    envelope: unknown,
    session: ContextSourceSliceSession,
  ): Promise<EnterpriseProject.ProjectGetContextSourceSliceResult>;
}

function owningRequestedKinds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    entryError(API_VALUE_INVALID, 'requestedKinds must be an array of registered kinds');
  }
  return value.map((kind) => {
    const owning = typeof kind === 'string' ? SOURCE_KIND_BY_REQUESTED_KIND[kind] : undefined;
    if (owning === undefined) {
      entryError(API_VALUE_INVALID, 'requestedKinds contains an unregistered kind');
    }
    return owning;
  });
}

/** The Project Scope must be exact in both the payload reference and the Envelope. */
function projectScope(payloadRef: unknown, envelopeScope: unknown): RequestScope {
  const ref = record(payloadRef);
  const refScope = record(ref.scope);
  const scope = record(envelopeScope);
  const projectId = uuid(ref.objectId);
  if (
    ref.kind !== 'OBJECT' ||
    ref.objectType !== 'zhiju.project.project' ||
    projectId === undefined ||
    refScope.enterpriseId !== scope.enterpriseId ||
    refScope.projectId !== projectId ||
    scope.projectId !== projectId
  ) {
    entryError(SCOPE_MISMATCH, 'projectRef and scopeRef must carry the same exact Project scope');
  }
  return { scopeKind: 'PROJECT', enterpriseId: scope.enterpriseId as string, projectId };
}

/**
 * The registered capture command is a `ContextSourceSlice / CREATE`: the
 * Envelope's `targetRef` is the pre-allocated Slice identity that the owning
 * handler must keep, and a CREATE command never carries an expected aggregate
 * version.
 */
function captureSliceIdentity(
  targetRef: unknown,
  scope: RequestScope,
  expectedAggregateVersion: unknown,
): string {
  const ref = record(targetRef);
  const refScope = record(ref.scope);
  const sliceId = uuid(ref.objectId);
  if (
    ref.kind !== 'OBJECT' ||
    ref.objectType !== CONTEXT_SOURCE_SLICE_OBJECT_TYPE ||
    sliceId === undefined ||
    refScope.enterpriseId !== scope.enterpriseId ||
    refScope.projectId !== scope.projectId
  ) {
    entryError(API_VALUE_INVALID, 'targetRef must be the pre-allocated ContextSourceSlice');
  }
  if (expectedAggregateVersion !== undefined) {
    entryError(API_VALUE_INVALID, 'ContextSourceSlice CREATE must omit expectedAggregateVersion');
  }
  return sliceId;
}

function sliceReference(value: unknown): Common.ContentAddressedRef {
  const ref = record(value);
  const scope = record(ref.scope);
  const sliceId = uuid(ref.objectId);
  const enterpriseId = uuid(scope.enterpriseId);
  const projectId = uuid(scope.projectId);
  const hash = digest(ref.contentHash);
  if (
    ref.kind !== 'CONTENT_ADDRESSED' ||
    ref.objectType !== CONTEXT_SOURCE_SLICE_OBJECT_TYPE ||
    sliceId === undefined ||
    enterpriseId === undefined ||
    projectId === undefined ||
    hash === undefined
  ) {
    entryError(API_VALUE_INVALID, 'sourceSliceRef must be an exact Slice content address');
  }
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
    objectId: sliceId,
    scope: { enterpriseId, projectId },
    contentHash: contentHash(hash),
  };
}

export function createContextSourceSliceEntry(
  config: ContextSourceSliceEntryConfig,
): ContextSourceSliceEntry {
  const registry = new ContractRegistry();
  const boundary: DecisionBoundary = createDecisionBoundary(config);

  /**
   * The capture Policy Port: every resolution mints its own
   * `identity.policy.resolve_policy` Decision for the same principal and
   * resolves the exact version key through the owning entry. An
   * unauthenticated or unresolvable Policy fails closed.
   */
  function policyResolutionPort(
    row: DecisionRow,
    session: ContextSourceSliceSession,
  ): CapturePolicyResolutionPort {
    return {
      async resolveCapturePolicy(request): Promise<CapturePolicyResolution> {
        // The presented principal always stays the Decision principal: a
        // session snapshot of another principal or Scope is rejected by the
        // owning resolution entry, which fails the capture closed instead of
        // resolving under other grants.
        const resolutionScope = record(session.policyResolutionActorSnapshotRef.scope);
        const resolveContextBase: IdentityTransactionContext = {
          kind: 'REQUEST',
          principalId: row.principal_id,
          actorSnapshotId: session.policyResolutionActorSnapshotRef.snapshotId,
          authorizationDecisionId: row.authorization_decision_id,
          authorizationDecisionHash: row.payload_hash,
          authorizationDecisionExpiresAt: row.expires_at,
          enterpriseId: row.enterprise_id,
          allowedProjectIds:
            resolutionScope.projectId === undefined ? [] : [resolutionScope.projectId as string],
          correlationId: row.authorization_decision_id,
        };
        let authorized: Awaited<ReturnType<typeof authorizeCommand>>;
        try {
          authorized = await authorizeCommand(boundary.identityDeps(resolveContextBase), {
            actorSnapshotRef: session.policyResolutionActorSnapshotRef,
            intent: {
              commandType: RESOLVE_POLICY_COMMAND,
              commandVersion: '1.0',
              scopeKind: resolutionScope.projectId === undefined ? 'ENTERPRISE' : 'PROJECT',
              enterpriseId: row.enterprise_id,
              ...(resolutionScope.projectId === undefined
                ? {}
                : { projectId: resolutionScope.projectId as string }),
              purpose: RESOLVE_POLICY_PURPOSE,
              requestedCapability: config.capabilities.resolve,
              commandPayloadHash: payloadHashOf({ policyRef: request.policyRef }),
              requestedAt: request.asOf,
              highRiskAction: false,
            },
            authenticationContextHash: sessionAuthenticationContextHash(session),
            policySnapshotRef: policySnapshotReference(row),
          });
        } catch (error) {
          if (error instanceof SnapshotBoundaryError) return { kind: 'UNAVAILABLE' };
          throw error;
        }
        if (authorized.outcome !== 'ALLOW') return { kind: 'UNRESOLVED' };
        const resolveContext: IdentityTransactionContext = {
          ...resolveContextBase,
          authorizationDecisionId: authorized.authorizationDecisionRef.objectId,
          authorizationDecisionHash: Buffer.from(
            authorized.authorizationDecisionRef.contentHash.digest,
            'hex',
          ),
          authorizationDecisionExpiresAt: new Date(authorized.expiresAt),
        };
        const scopeValue = request.policyRef.scope as unknown as CanonicalJsonObject;
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
            contentHash: contentHash(sessionAuthenticationContextHash(session).toString('hex')),
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
          requestedAt: request.asOf.toISOString(),
          payload: { policyRef: request.policyRef },
        } as unknown as CanonicalJsonObject;
        try {
          const view = await resolvePolicy(boundary.identityDeps(resolveContext), {
            envelope,
            asOf: request.asOf,
          });
          return { kind: 'RESOLVED', observation: view };
        } catch (error) {
          if (error instanceof SnapshotBoundaryError) {
            return error.code === DEPENDENCY_UNAVAILABLE
              ? { kind: 'UNAVAILABLE' }
              : { kind: 'UNRESOLVED' };
          }
          throw error;
        }
      },
    };
  }

  return {
    async capture(envelope, session) {
      const violation = contractViolation(registry, CAPTURE_CONTEXT_SOURCE_SLICE_COMMAND, envelope);
      if (violation !== null) {
        entryError(violation, 'the capture Envelope does not satisfy its registered contract');
      }
      const command = record(envelope);
      const payload = record(command.payload);
      const payloadHash = payloadHashOf(payload);
      assertIntegrity(command.integrity, payloadHash);
      const scope = projectScope(payload.projectRef, command.scopeRef);
      const owningPayload = {
        ...payload,
        requestedKinds: owningRequestedKinds(payload.requestedKinds),
      } as unknown as CanonicalJsonObject;
      const sliceId = captureSliceIdentity(
        command.targetRef,
        scope,
        command.expectedAggregateVersion,
      );
      const sessionHash = sessionAuthenticationContextHash(session);
      const decision = await boundary.validatedDecision({
        decisionRef: decisionReference(command.authorizationDecisionRef),
        commandType: CAPTURE_CONTEXT_SOURCE_SLICE_COMMAND,
        purpose: CAPTURE_CONTEXT_SOURCE_SLICE_PURPOSE,
        capability: config.capabilities.capture,
        scope,
        payloadHash,
        authenticationContextHash: sessionHash,
        actorRef: command.actor,
      });
      const internalEnvelope: CommandEnvelope = {
        commandId: command.commandId as string,
        commandType: CAPTURE_CONTEXT_SOURCE_SLICE_COMMAND,
        commandVersion: '1.0',
        idempotencyScope: CAPTURE_CONTEXT_SOURCE_SLICE_IDEMPOTENCY_SCOPE,
        idempotencyKey: command.idempotencyKey as string,
        requestPayload: owningPayload,
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
        targetType: CONTEXT_SOURCE_SLICE_TARGET,
        targetId: sliceId,
        correlationId: command.correlationId as string,
        ...(command.causationId === undefined
          ? {}
          : { causationId: command.causationId as string }),
        principalId: decision.principal_id,
        principalKind: decision.principal_kind as CommandEnvelope['principalKind'],
        actorSnapshotId: decision.actor_snapshot_id,
        authorizationDecisionId: decision.authorization_decision_id,
        policySnapshotId: decision.policy_snapshot_id,
      };
      return handleCaptureContextSourceSlice(
        config.enterpriseProjectDb,
        boundary.enterpriseProjectContext(decision, scope, command.correlationId as string),
        { ...internalEnvelope, payload: owningPayload as never },
        {
          policyResolution: policyResolutionPort(decision, session),
          ...(config.now === undefined ? {} : { now: config.now }),
        },
      );
    },

    async read(envelope, session) {
      const violation = contractViolation(registry, GET_CONTEXT_SOURCE_SLICE_QUERY, envelope);
      if (violation !== null) {
        entryError(violation, 'the read Envelope does not satisfy its registered contract');
      }
      const query = record(envelope);
      if (query.consistencyRequirement !== 'AUTHORITATIVE') {
        entryError(API_VALUE_INVALID, 'the read Query must be AUTHORITATIVE');
      }
      const payload = record(query.payload);
      const sliceRef = sliceReference(payload.sourceSliceRef);
      const requestedScope = record(sliceRef.scope);
      const scope: RequestScope = {
        scopeKind: 'PROJECT',
        enterpriseId: requestedScope.enterpriseId as string,
        projectId: requestedScope.projectId as string,
      };
      const envelopeScope = record(query.scopeRef);
      if (
        envelopeScope.enterpriseId !== scope.enterpriseId ||
        envelopeScope.projectId !== scope.projectId
      ) {
        entryError(SCOPE_MISMATCH, 'scopeRef must carry the requested Slice Project scope');
      }
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
      const decision = await boundary.validatedDecision({
        decisionRef: decisionReference(query.authorizationDecisionRef),
        commandType: GET_CONTEXT_SOURCE_SLICE_QUERY,
        purpose: GET_CONTEXT_SOURCE_SLICE_PURPOSE,
        capability: config.capabilities.read,
        scope,
        payloadHash: payloadHashOf(payload),
        authenticationContextHash: sessionHash,
        actorRef: query.requester,
      });
      return handleGetContextSourceSlice(
        config.enterpriseProjectDb,
        boundary.enterpriseProjectContext(decision, scope, query.correlationId as string),
        { sourceSliceRef: sliceRef } as EnterpriseProject.ProjectGetContextSourceSlicePayload,
        {
          policyResolution: policyResolutionPort(decision, session),
          ...(config.now === undefined ? {} : { now: config.now }),
        },
      );
    },
  };
}
