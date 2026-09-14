// IM-06 (#188) composition entry for the Context Source Slice boundary.
//
// EnterpriseProject owns the Slice facts; IdentityPolicy owns Decisions,
// ActorSnapshots, capability grants and Policy version resolution. Neither
// module may read the other's schema, so this composition layer is the only
// place that turns an authenticated transport request into the trusted
// transaction context the owning handlers consume:
//
//   * the complete registered Envelope is validated against the public
//     Contract Registry (structure + PayloadGuard) before anything else;
//   * the presented AuthorizationDecision is proven through the owning
//     IdentityPolicy ports against the *actual* operation, payload hash,
//     ActorSnapshot/Principal and Scope, and the current covering capability
//     grant is re-evaluated for the caller at the request instant;
//   * the trusted EnterpriseProject context is derived from the validated
//     Decision row (principal, kind, actor snapshot, Decision id/hash, expiry,
//     Policy snapshot, registered purpose) instead of caller-declared values;
//   * the capture Policy is consumed through the IdentityPolicy-owned
//     `identity.resolve_policy@1.0` entry with its own
//     `identity.policy.resolve_policy` Decision minted for the same principal.
//
// A revoked grant, an expired Decision, a Decision issued for another
// operation, payload, session or actor, and a Service principal without the
// registered capability all fail here, before any Slice fact is touched.

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
  digestCanonicalPayload,
  handleCaptureContextSourceSlice,
  handleGetContextSourceSlice,
  type CapturePolicyResolution,
  type CapturePolicyResolutionPort,
  type CommandEnvelope,
  type CommandResult,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import type { IdentityPolicyRepository } from '@zhiju/identity-policy';
import {
  API_CONTRACT_TYPE_UNKNOWN,
  API_PAYLOAD_HASH_MISMATCH,
  API_PAYLOAD_LIMIT_EXCEEDED,
  API_VALUE_INVALID,
  AUTHORIZATION_DECISION_INVALID,
  AUTHORIZATION_EXPIRED,
  AUTHORIZATION_REVOKED,
  DEPENDENCY_UNAVAILABLE,
  SCOPE_MISMATCH,
  SnapshotBoundaryError,
  authorizeCommand,
  checkProjectAccess,
  resolvePolicy,
  validateAuthorizationDecision,
  withIdentityTransaction,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

/** Registered Policy resolution entry used by the capture Policy Port. */
export const RESOLVE_POLICY_COMMAND = 'identity.resolve_policy';
export const RESOLVE_POLICY_PURPOSE = 'identity.policy.resolve_policy';
/** Object name returned by the owning `identity.authorize_command`/ActorSnapshot Port. */
const ACTOR_SNAPSHOT_OBJECT_TYPE = 'identity.actor_snapshot';
const AUTHORIZATION_DECISION_OBJECT_TYPE = 'identity.authorization_decision';
const POLICY_SNAPSHOT_OBJECT_TYPE = 'identity.policy_snapshot';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
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
const SHA256_DIGEST = /^[0-9a-f]{64}$/u;

/** Stable entry failure; never carries request payloads or Decision contents. */
export class ContextSourceSliceEntryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ContextSourceSliceEntryError';
  }
}

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

/**
 * The AuthorizationDecision facts this entry relies on. Structural subset of
 * the owning table row: the composition layer never writes Decisions and never
 * interprets fields the owning module has not already validated.
 */
interface DecisionRow {
  readonly authorization_decision_id: string;
  readonly actor_snapshot_id: string;
  readonly actor_snapshot_payload_hash: Buffer;
  readonly principal_id: string;
  readonly principal_kind: string;
  readonly outcome: 'ALLOW' | 'DENY';
  readonly command_type: string;
  readonly scope_kind: 'ENTERPRISE' | 'PROJECT';
  readonly enterprise_id: string;
  readonly project_id: string | null;
  readonly purpose: string;
  readonly policy_snapshot_id: string;
  readonly policy_snapshot_payload_hash: Buffer;
  readonly authentication_context_hash: Buffer;
  readonly expires_at: Date;
  readonly payload_hash: Buffer;
}

interface RequestScope {
  readonly scopeKind: 'PROJECT';
  readonly enterpriseId: string;
  readonly projectId: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function entryError(code: string, message: string): never {
  throw new ContextSourceSliceEntryError(code, message);
}

function uuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_V7.test(value) ? value : undefined;
}

function digest(value: unknown): string | undefined {
  const hash = record(value);
  return hash.algorithm === 'SHA-256' &&
    hash.canonicalizationVersion === '1' &&
    typeof hash.digest === 'string' &&
    SHA256_DIGEST.test(hash.digest)
    ? hash.digest
    : undefined;
}

function contentHash(digestHex: string): Common.ContentHash {
  return { algorithm: 'SHA-256', digest: digestHex, canonicalizationVersion: '1' };
}

function contractViolation(
  registry: ContractRegistry,
  type: string,
  envelope: unknown,
): string | null {
  const validation = registry.validateOperation(type, '1.0', envelope);
  if (validation.valid) return null;
  if (validation.errors.some((error) => error.keyword === 'operationRegistry')) {
    return API_CONTRACT_TYPE_UNKNOWN;
  }
  if (validation.errors.some((error) => error.keyword === 'payloadGuard')) {
    return API_PAYLOAD_LIMIT_EXCEEDED;
  }
  return API_VALUE_INVALID;
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

function payloadHashOf(payload: unknown): Buffer {
  return digestCanonicalPayload(payload as CanonicalJsonObject).hash;
}

function assertIntegrity(integrity: unknown, expected: Buffer): void {
  const declared = record(integrity);
  if (
    declared.canonicalizationVersion !== '1' ||
    digest(declared.payloadHash) !== expected.toString('hex')
  ) {
    entryError(
      API_PAYLOAD_HASH_MISMATCH,
      'integrity.payloadHash must equal the canonical payload hash',
    );
  }
}

function decisionReference(value: unknown): Common.ContentAddressedRef {
  const ref = record(value);
  const scope = record(ref.scope);
  const objectId = uuid(ref.objectId);
  const hash = digest(ref.contentHash);
  if (
    ref.kind !== 'CONTENT_ADDRESSED' ||
    ref.objectType !== AUTHORIZATION_DECISION_OBJECT_TYPE ||
    objectId === undefined ||
    hash === undefined ||
    (scope.enterpriseId !== undefined && uuid(scope.enterpriseId) === undefined) ||
    (scope.projectId !== undefined && uuid(scope.projectId) === undefined)
  ) {
    entryError(
      AUTHORIZATION_DECISION_INVALID,
      'authorizationDecisionRef must be an exact Decision reference',
    );
  }
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: AUTHORIZATION_DECISION_OBJECT_TYPE,
    objectId,
    scope:
      scope.projectId === undefined
        ? { enterpriseId: scope.enterpriseId as string }
        : { enterpriseId: scope.enterpriseId as string, projectId: scope.projectId as string },
    contentHash: contentHash(hash),
  };
}

function policySnapshotReference(row: DecisionRow): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType: POLICY_SNAPSHOT_OBJECT_TYPE,
    objectId: row.policy_snapshot_id,
    snapshotId: row.policy_snapshot_id,
    scope: {},
    contentHash: contentHash(row.policy_snapshot_payload_hash.toString('hex')),
  };
}

/**
 * The presented Actor must be the exact principal or ActorSnapshot the
 * Decision was issued for, in the Decision's own Scope. A caller that presents
 * another actor's reference — or another Scope — is refused.
 */
function assertActorBinding(actorRef: unknown, row: DecisionRow): void {
  const ref = record(actorRef);
  const scope = record(ref.scope);
  const decisionScope =
    row.project_id === null
      ? { enterpriseId: row.enterprise_id }
      : { enterpriseId: row.enterprise_id, projectId: row.project_id };
  const scopeMatches =
    scope.enterpriseId === decisionScope.enterpriseId &&
    (decisionScope.projectId === undefined
      ? scope.projectId === undefined
      : scope.projectId === decisionScope.projectId);
  if (!scopeMatches) {
    entryError(AUTHORIZATION_DECISION_INVALID, 'the presented actor is not in the Decision scope');
  }
  if (ref.kind === 'SNAPSHOT' && ref.objectType === ACTOR_SNAPSHOT_OBJECT_TYPE) {
    if (
      ref.objectId !== row.actor_snapshot_id ||
      ref.snapshotId !== row.actor_snapshot_id ||
      digest(ref.contentHash) !== row.actor_snapshot_payload_hash.toString('hex')
    ) {
      entryError(
        AUTHORIZATION_DECISION_INVALID,
        'the presented actor snapshot is not the Decision actor snapshot',
      );
    }
    return;
  }
  if (
    ref.kind === 'OBJECT' &&
    (ref.objectType === 'Principal' || ref.objectType === 'zhiju.identity.principal')
  ) {
    if (ref.objectId !== row.principal_id) {
      entryError(
        AUTHORIZATION_DECISION_INVALID,
        'the presented principal is not the Decision principal',
      );
    }
    return;
  }
  entryError(AUTHORIZATION_DECISION_INVALID, 'the presented actor reference is not supported');
}

export function createContextSourceSliceEntry(
  config: ContextSourceSliceEntryConfig,
): ContextSourceSliceEntry {
  const registry = new ContractRegistry();
  const now = config.now ?? ((): Date => new Date());

  function identityDeps(context: IdentityTransactionContext): IdentityCommandDeps {
    return {
      db: config.identity.db,
      repo: config.identity.repo,
      crypto: config.identity.crypto,
      context,
    };
  }

  /** A Slice Decision is always Project-scoped; an Enterprise-only one is refused. */
  function decisionScope(row: DecisionRow): RequestScope {
    if (row.scope_kind !== 'PROJECT' || row.project_id === null) {
      entryError(SCOPE_MISMATCH, 'the Decision must be scoped to the requested Project');
    }
    return { scopeKind: 'PROJECT', enterpriseId: row.enterprise_id, projectId: row.project_id };
  }

  /**
   * Proves one presented Decision through the owning IdentityPolicy ports: the
   * Decision row is read in its own Scope, the complete binding supplied by the
   * transport is validated by the owning validator, and the current covering
   * capability grant is re-evaluated for this principal and purpose.
   */
  async function validatedDecision(input: {
    readonly decisionRef: Common.ContentAddressedRef;
    readonly commandType: string;
    readonly purpose: string;
    readonly capability: string;
    readonly scope: RequestScope;
    readonly payloadHash: Buffer;
    readonly authenticationContextHash: Buffer;
    readonly actorRef: unknown;
  }): Promise<DecisionRow> {
    if (
      !Buffer.isBuffer(input.authenticationContextHash) ||
      input.authenticationContextHash.length !== 32
    ) {
      entryError(
        AUTHORIZATION_DECISION_INVALID,
        'the session authentication context is not a SHA-256 digest',
      );
    }
    const bootstrapContext: IdentityTransactionContext = {
      kind: 'REQUEST',
      principalId: input.decisionRef.objectId,
      actorSnapshotId: input.decisionRef.objectId,
      authorizationDecisionId: input.decisionRef.objectId,
      authorizationDecisionHash: Buffer.from(input.decisionRef.contentHash.digest, 'hex'),
      authorizationDecisionExpiresAt: new Date(now().getTime() + 60_000),
      enterpriseId: input.scope.enterpriseId,
      allowedProjectIds: [input.scope.projectId],
      correlationId: input.decisionRef.objectId,
    };
    const found = await withIdentityTransaction(config.identity.db, bootstrapContext, (trx) =>
      config.identity.repo.getAuthorizationDecisionByIdAndHash(
        trx,
        input.decisionRef.objectId,
        Buffer.from(input.decisionRef.contentHash.digest, 'hex'),
      ),
    ).catch(() => entryError(DEPENDENCY_UNAVAILABLE, 'authorization storage is unavailable'));
    if (!found?.hashMatched) {
      entryError(AUTHORIZATION_DECISION_INVALID, 'the presented Decision is not resolvable');
    }
    const row = found.row;
    const scope = decisionScope(row);
    if (scope.projectId !== input.scope.projectId) {
      entryError(SCOPE_MISMATCH, 'the Decision Scope is not the requested Project');
    }
    const scopedContext: IdentityTransactionContext = {
      kind: 'REQUEST',
      principalId: row.principal_id,
      actorSnapshotId: row.actor_snapshot_id,
      authorizationDecisionId: row.authorization_decision_id,
      authorizationDecisionHash: row.payload_hash,
      authorizationDecisionExpiresAt: row.expires_at,
      enterpriseId: row.enterprise_id,
      allowedProjectIds: row.project_id === null ? [] : [row.project_id],
      correlationId: input.decisionRef.objectId,
    };
    const validation = await validateAuthorizationDecision(identityDeps(scopedContext), {
      decisionRef: input.decisionRef,
      expectedCommandType: input.commandType,
      expectedCommandVersion: '1.0',
      expectedScope: scope,
      expectedPurpose: input.purpose,
      expectedCommandPayloadHash: input.payloadHash,
      expectedAuthenticationContextHash: input.authenticationContextHash,
      now: now(),
    });
    if (!validation.valid || validation.outcome !== 'ALLOW') {
      entryError(
        validation.reason === 'EXPIRED' ? AUTHORIZATION_EXPIRED : AUTHORIZATION_DECISION_INVALID,
        'the presented Decision does not cover this exact request',
      );
    }
    assertActorBinding(input.actorRef, row);
    const access = await checkProjectAccess(identityDeps(scopedContext), {
      principalId: row.principal_id,
      scopeKind: 'PROJECT',
      enterpriseId: row.enterprise_id,
      projectId: scope.projectId,
      action: input.capability,
      purpose: input.purpose,
      asOf: now(),
      authenticationContextHash: input.authenticationContextHash,
      policySnapshotRef: policySnapshotReference(row),
    });
    if (access.outcome !== 'ALLOW') {
      entryError(
        AUTHORIZATION_REVOKED,
        'the current capability grant does not cover this operation',
      );
    }
    return row;
  }

  function enterpriseProjectContext(
    row: DecisionRow,
    scope: RequestScope,
    correlationId: string,
  ): EnterpriseProjectTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: row.principal_id,
      principalKind: row.principal_kind as EnterpriseProjectTransactionContext['principalKind'],
      actorSnapshotId: row.actor_snapshot_id,
      authorizationDecisionId: row.authorization_decision_id,
      authorizationDecisionHash: row.payload_hash,
      authorizationDecisionExpiresAt: row.expires_at,
      policySnapshotId: row.policy_snapshot_id,
      enterpriseId: scope.enterpriseId,
      allowedProjectIds: [scope.projectId],
      correlationId,
      authorizationPurposes: [row.purpose],
    };
  }

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
          authorized = await authorizeCommand(identityDeps(resolveContextBase), {
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
            authenticationContextHash: row.authentication_context_hash,
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
            contentHash: contentHash(row.authentication_context_hash.toString('hex')),
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
          const view = await resolvePolicy(identityDeps(resolveContext), {
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
      const decision = await validatedDecision({
        decisionRef: decisionReference(command.authorizationDecisionRef),
        commandType: CAPTURE_CONTEXT_SOURCE_SLICE_COMMAND,
        purpose: CAPTURE_CONTEXT_SOURCE_SLICE_PURPOSE,
        capability: config.capabilities.capture,
        scope,
        payloadHash,
        authenticationContextHash: session.authenticationContextHash,
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
        enterpriseProjectContext(decision, scope, command.correlationId as string),
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
      const authenticationContext = record(query.authenticationContextRef);
      const authenticationContextHash = digest(authenticationContext.contentHash);
      if (authenticationContextHash === undefined) {
        entryError(AUTHORIZATION_DECISION_INVALID, 'the Query must pin an authentication context');
      }
      const decision = await validatedDecision({
        decisionRef: decisionReference(query.authorizationDecisionRef),
        commandType: GET_CONTEXT_SOURCE_SLICE_QUERY,
        purpose: GET_CONTEXT_SOURCE_SLICE_PURPOSE,
        capability: config.capabilities.read,
        scope,
        payloadHash: payloadHashOf(payload),
        authenticationContextHash: Buffer.from(authenticationContextHash, 'hex'),
        actorRef: query.requester,
      });
      return handleGetContextSourceSlice(
        config.enterpriseProjectDb,
        enterpriseProjectContext(decision, scope, query.correlationId as string),
        { sourceSliceRef: sliceRef } as EnterpriseProject.ProjectGetContextSourceSlicePayload,
        {
          policyResolution: policyResolutionPort(decision, session),
          ...(config.now === undefined ? {} : { now: config.now }),
        },
      );
    },
  };
}
