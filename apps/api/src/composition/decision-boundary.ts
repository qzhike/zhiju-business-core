// Shared composition boundary for runtime entries of the owning modules.
//
// Each module owns its business facts; IdentityPolicy owns Decisions,
// ActorSnapshots and capability grants. Neither module may read the other's
// schema, so this module is the only place that turns an authenticated
// transport request into the trusted transaction context an owning handler
// consumes:
//
//   * the complete registered Envelope is validated against the public
//     Contract Registry (structure + PayloadGuard) before anything else;
//   * the presented AuthorizationDecision is proven through the owning
//     IdentityPolicy ports against the *actual* operation, payload hash,
//     ActorSnapshot/Principal and Scope, and the current covering capability
//     grant is re-evaluated for the caller at the request instant;
//   * the trusted EnterpriseProject context is derived from the validated
//     Decision row (principal, kind, actor snapshot, Decision id/hash, expiry,
//     Policy snapshot, registered purpose) instead of caller-declared values.
//
// A revoked grant, an expired Decision, a Decision issued for another
// operation, payload, session or actor, and a principal without the registered
// capability all fail here, before any owning fact is touched.

import type { Kysely } from 'kysely';
import type { Common } from '@zhiju/contracts';
import type { ContractRegistry } from '@zhiju/contracts';
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
  checkProjectAccess,
  validateAuthorizationDecision,
  withIdentityTransaction,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityPolicyRepository,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  digestCanonicalPayload,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import type { QualityTransactionContext } from '@zhiju/quality-governance';

/** Object name returned by the owning ActorSnapshot Port. */
export const ACTOR_SNAPSHOT_OBJECT_TYPE = 'identity.actor_snapshot';
export const AUTHORIZATION_DECISION_OBJECT_TYPE = 'identity.authorization_decision';
export const POLICY_SNAPSHOT_OBJECT_TYPE = 'identity.policy_snapshot';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_DIGEST = /^[0-9a-f]{64}$/u;

/** Stable entry failure; never carries request payloads or Decision contents. */
export class CompositionBoundaryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CompositionBoundaryError';
  }
}

export interface IdentityBoundaryConfig {
  /** Owning IdentityPolicy dependencies; the Decision ports live here. */
  readonly identity: {
    readonly db: Kysely<IdentityPolicyDb>;
    readonly repo: IdentityPolicyRepository;
    readonly crypto: IdentityCryptoPorts;
  };
  /** Trusted server clock. */
  readonly now?: (() => Date) | undefined;
}

/**
 * The AuthorizationDecision facts this boundary relies on. Structural subset
 * of the owning table row: the composition layer never writes Decisions and
 * never interprets fields the owning module has not already validated.
 */
export interface DecisionRow {
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

export interface RequestScope {
  readonly scopeKind: 'PROJECT';
  readonly enterpriseId: string;
  readonly projectId: string;
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function entryError(code: string, message: string): never {
  throw new CompositionBoundaryError(code, message);
}

export function uuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_V7.test(value) ? value : undefined;
}

export function digest(value: unknown): string | undefined {
  const hash = record(value);
  return hash.algorithm === 'SHA-256' &&
    hash.canonicalizationVersion === '1' &&
    typeof hash.digest === 'string' &&
    SHA256_DIGEST.test(hash.digest)
    ? hash.digest
    : undefined;
}

export function contentHash(digestHex: string): Common.ContentHash {
  return { algorithm: 'SHA-256', digest: digestHex, canonicalizationVersion: '1' };
}

export function contractViolation(
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

/**
 * The trusted session's authentication context hash. It is the single accepted
 * source for Decision validation, so a caller cannot present a Decision issued
 * for another session.
 */
export function sessionAuthenticationContextHash(session: {
  readonly authenticationContextHash: Buffer;
}): Buffer {
  const hash = session.authenticationContextHash;
  if (!Buffer.isBuffer(hash) || hash.length !== 32) {
    entryError(
      AUTHORIZATION_DECISION_INVALID,
      'the session authentication context is not a SHA-256 digest',
    );
  }
  return hash;
}

export function payloadHashOf(payload: unknown): Buffer {
  return digestCanonicalPayload(payload as CanonicalJsonObject).hash;
}

export function assertIntegrity(integrity: unknown, expected: Buffer): void {
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

export function decisionReference(value: unknown): Common.ContentAddressedRef {
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

export function policySnapshotReference(row: DecisionRow): Common.SnapshotRef {
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
export function assertActorBinding(actorRef: unknown, row: DecisionRow): void {
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

export interface DecisionBoundary {
  /** Owning IdentityPolicy command dependencies for the trusted context. */
  identityDeps(context: IdentityTransactionContext): IdentityCommandDeps;
  /** A Decision is always Project-scoped; an Enterprise-only one is refused. */
  decisionScope(row: DecisionRow): RequestScope;
  validatedDecision(input: {
    readonly decisionRef: Common.ContentAddressedRef;
    readonly commandType: string;
    readonly purpose: string;
    readonly capability: string;
    readonly scope: RequestScope;
    readonly payloadHash: Buffer;
    readonly authenticationContextHash: Buffer;
    readonly actorRef: unknown;
  }): Promise<DecisionRow>;
  enterpriseProjectContext(
    row: DecisionRow,
    scope: RequestScope,
    correlationId: string,
  ): EnterpriseProjectTransactionContext;
  /**
   * The trusted QualityGovernance context for the same proved Decision. The
   * Decision's registered Purpose is pinned on the context, so an owning
   * Query that requires an exact Purpose refuses a Decision issued for
   * another operation instead of trusting a caller-declared one.
   */
  qualityGovernanceContext(
    row: DecisionRow,
    scope: RequestScope,
    correlationId: string,
  ): QualityTransactionContext;
}

export function createDecisionBoundary(config: IdentityBoundaryConfig): DecisionBoundary {
  const now = config.now ?? ((): Date => new Date());

  function identityDeps(context: IdentityTransactionContext): IdentityCommandDeps {
    return {
      db: config.identity.db,
      repo: config.identity.repo,
      crypto: config.identity.crypto,
      context,
    };
  }

  function decisionScope(row: DecisionRow): RequestScope {
    if (row.scope_kind !== 'PROJECT' || row.project_id === null) {
      entryError(SCOPE_MISMATCH, 'the Decision must be scoped to the requested Project');
    }
    return { scopeKind: 'PROJECT', enterpriseId: row.enterprise_id, projectId: row.project_id };
  }

  return {
    identityDeps,
    decisionScope,

    /**
     * Proves one presented Decision through the owning IdentityPolicy ports:
     * the Decision row is read in its own Scope, the complete binding supplied
     * by the transport is validated by the owning validator, and the current
     * covering capability grant is re-evaluated for this principal and purpose.
     */
    async validatedDecision(input) {
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
    },

    enterpriseProjectContext(row, scope, correlationId) {
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
    },

    qualityGovernanceContext(row, scope, correlationId) {
      return {
        kind: 'REQUEST',
        principalId: row.principal_id,
        principalKind: row.principal_kind as QualityTransactionContext['principalKind'],
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
    },
  };
}
