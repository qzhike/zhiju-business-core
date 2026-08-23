// IM-02 WI-09 (issue #37): controlled ActorSnapshot creation/validation and
// the identity.authorize_command@1.0 Decision Port — the single place an
// immutable AuthorizationDecision is produced. actingFor is metadata: the
// actor principal kind comes from the principal table and can never be
// upgraded by the acting_for reference.

import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import {
  digestCanonicalPayload,
  withIdentityTransaction,
  type IdentityPolicyDb,
  type IdentityTransactionContext,
} from '../persistence/identity-db.js';
import type { IdentityPolicyRepository } from '../persistence/identity-policy-repository.js';
import type { IdentityCryptoPorts } from '../persistence/ports.js';
import { isHumanOnlyCapability } from './static-registry.js';

export const DECISION_DEFAULT_TTL_SECONDS = 300;

export const IDENTITY_ACTOR_SNAPSHOT_INVALID = 'IDENTITY_ACTOR_SNAPSHOT_INVALID';
export const IDENTITY_DECISION_INPUT_INVALID = 'IDENTITY_DECISION_INPUT_INVALID';

export interface IdentityCommandDeps {
  readonly db: Kysely<IdentityPolicyDb>;
  readonly repo: IdentityPolicyRepository;
  readonly crypto: IdentityCryptoPorts;
  readonly context: IdentityTransactionContext;
}

export type PrincipalKind = 'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY';

export interface CreateActorSnapshotInput {
  actorSnapshotId: string;
  principalId: string;
  /** Must equal the authoritative principal kind from the principal table. */
  declaredPrincipalKind: PrincipalKind;
  actingForPrincipalId?: string | undefined;
  actingForKind?: PrincipalKind | undefined;
  channelCode?: string | undefined;
  runtimeSource?: string | undefined;
  authenticationContextHash: Buffer;
  enterpriseId: string;
  projectId?: string | undefined;
}

export interface ActorSnapshotRef {
  snapshotType: 'ActorSnapshot';
  snapshotId: string;
  payloadHash: Buffer;
  payloadHashAlgorithm: string;
  canonicalizationVersion: string;
}

/**
 * Controlled creation boundary for ActorSnapshot: the declared kind is
 * validated against the principal table (the only authority), the actingFor
 * pair must be complete, and the snapshot is enterprise-scoped through the
 * RLS context. The immutable row carries the canonical payload and hash.
 */
export async function createActorSnapshot(
  deps: IdentityCommandDeps,
  input: CreateActorSnapshotInput,
): Promise<ActorSnapshotRef> {
  if (input.enterpriseId !== deps.context.enterpriseId) {
    throw new SnapshotBoundaryError(
      IDENTITY_ACTOR_SNAPSHOT_INVALID,
      'actor snapshot scope must match the transaction context',
    );
  }
  if ((input.actingForPrincipalId === undefined) !== (input.actingForKind === undefined)) {
    throw new SnapshotBoundaryError(IDENTITY_ACTOR_SNAPSHOT_INVALID, 'actingFor must be complete');
  }
  const snapshot = await withIdentityTransaction(deps.db, deps.context, async (trx) => {
    const principal = await deps.repo.getPrincipalById(trx, input.principalId);
    if (!principal) {
      throw new SnapshotBoundaryError(
        IDENTITY_ACTOR_SNAPSHOT_INVALID,
        'principal does not resolve',
      );
    }
    if (principal.principal_kind !== input.declaredPrincipalKind) {
      throw new SnapshotBoundaryError(
        IDENTITY_ACTOR_SNAPSHOT_INVALID,
        'declared kind does not match the authoritative principal kind',
      );
    }
    if (input.actingForPrincipalId !== undefined && input.actingForKind !== undefined) {
      const actingFor = await deps.repo.getPrincipalById(trx, input.actingForPrincipalId);
      if (actingFor?.principal_kind !== input.actingForKind) {
        throw new SnapshotBoundaryError(
          IDENTITY_ACTOR_SNAPSHOT_INVALID,
          'actingFor kind does not match the authoritative principal kind',
        );
      }
    }
    await deps.repo.insertActorSnapshot(trx, {
      actorSnapshotId: input.actorSnapshotId,
      principalId: input.principalId,
      principalKind: principal.principal_kind,
      actingForPrincipalId: input.actingForPrincipalId,
      actingForKind: input.actingForKind,
      channelCode: input.channelCode,
      runtimeSource: input.runtimeSource,
      authenticationContextHash: input.authenticationContextHash,
      enterpriseId: input.enterpriseId,
      projectId: input.projectId,
      contractVersion: '1.0',
      snapshotPayload: {
        note: 'wi09 actor snapshot',
        principalKind: principal.principal_kind,
        enterpriseId: input.enterpriseId,
      },
      createdByPrincipalId: deps.context.principalId,
      sourceCommandId: newUuidV7(),
    });
    return deps.repo.getActorSnapshotByIdAndHash(trx, input.actorSnapshotId, Buffer.alloc(0));
  });
  // Re-read with the real hash for the returned precise ref.
  const row = await withIdentityTransaction(deps.db, deps.context, async (trx) => {
    const found = await trx
      .selectFrom('identity_policy.actor_snapshot')
      .selectAll()
      .where('actor_snapshot_id', '=', input.actorSnapshotId)
      .executeTakeFirst();
    return found;
  });
  void snapshot;
  if (!row) {
    throw new SnapshotBoundaryError(IDENTITY_ACTOR_SNAPSHOT_INVALID, 'snapshot creation failed');
  }
  return {
    snapshotType: 'ActorSnapshot',
    snapshotId: row.actor_snapshot_id,
    payloadHash: row.payload_hash,
    payloadHashAlgorithm: row.payload_hash_algorithm,
    canonicalizationVersion: row.canonicalization_version,
  };
}

export class SnapshotBoundaryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SnapshotBoundaryError';
  }
}

export interface CommandIntent {
  commandType: string;
  commandVersion: string;
  scopeKind: 'ENTERPRISE' | 'PROJECT';
  enterpriseId: string;
  projectId?: string | undefined;
  purpose: string;
  requestedCapability: string;
  commandPayloadHash: Buffer;
  requestedAt: Date;
  highRiskAction: boolean;
}

export interface AuthorizeCommandInput {
  actorSnapshotRef: ActorSnapshotRef;
  intent: CommandIntent;
  authenticationContextHash: Buffer;
  policySnapshotRef: { snapshotType: 'PolicySnapshot'; snapshotId: string; payloadHash: Buffer };
  ttlSeconds?: number | undefined;
}

export interface AuthorizationDecisionView {
  authorizationDecisionRef: {
    decisionId: string;
    payloadHash: Buffer;
    payloadHashAlgorithm: string;
    canonicalizationVersion: string;
  };
  outcome: 'ALLOW' | 'DENY';
  reasons: string[];
  policySnapshotRef: { snapshotType: 'PolicySnapshot'; snapshotId: string; payloadHash: Buffer };
  effectiveScopeRef: {
    scopeKind: 'ENTERPRISE' | 'PROJECT';
    enterpriseId: string;
    projectId?: string | undefined;
  };
  expiresAt: Date;
}

/**
 * The unique Decision Port. Every call persists an immutable
 * AuthorizationDecision (ALLOW or DENY) bound to the exact actor snapshot,
 * authentication context, command intent, scope/purpose, payload hash and
 * policy snapshot. ALLOW is short-lived; it is never a long-term token.
 */
export async function authorizeCommand(
  deps: IdentityCommandDeps,
  input: AuthorizeCommandInput,
): Promise<AuthorizationDecisionView> {
  if (input.intent.enterpriseId !== deps.context.enterpriseId) {
    throw new SnapshotBoundaryError(
      IDENTITY_DECISION_INPUT_INVALID,
      'intent scope must match the transaction context',
    );
  }
  const decisionId = newUuidV7();
  const expiresAt = new Date(
    Date.now() + (input.ttlSeconds ?? DECISION_DEFAULT_TTL_SECONDS) * 1000,
  );

  const view = await withIdentityTransaction(deps.db, deps.context, async (trx) => {
    // Exact actor snapshot ref: id + payload hash must both match.
    const actor = await deps.repo.getActorSnapshotByIdAndHash(
      trx,
      input.actorSnapshotRef.snapshotId,
      input.actorSnapshotRef.payloadHash,
    );
    if (!actor?.hashMatched) {
      throw new SnapshotBoundaryError(
        IDENTITY_ACTOR_SNAPSHOT_INVALID,
        'actor snapshot ref does not match',
      );
    }
    if (!actor.row.authentication_context_hash.equals(input.authenticationContextHash)) {
      throw new SnapshotBoundaryError(
        IDENTITY_DECISION_INPUT_INVALID,
        'authentication context mismatch',
      );
    }
    const policy = await deps.repo.getPolicySnapshotByIdAndHash(
      trx,
      input.policySnapshotRef.snapshotId,
      input.policySnapshotRef.payloadHash,
    );
    if (!policy?.hashMatched) {
      throw new SnapshotBoundaryError(
        IDENTITY_DECISION_INPUT_INVALID,
        'policy snapshot ref does not match',
      );
    }

    const principal = await deps.repo.getPrincipalById(trx, actor.row.principal_id);
    const reasons: string[] = [];
    let outcome: 'ALLOW' | 'DENY' = 'ALLOW';

    if (principal?.status !== 'ACTIVE') {
      outcome = 'DENY';
      reasons.push('PRINCIPAL_NOT_ACTIVE');
    } else if (
      isHumanOnlyCapability(input.intent.requestedCapability) &&
      principal.principal_kind !== 'HUMAN'
    ) {
      // actingFor is metadata only: the kind stays the actor's real kind.
      outcome = 'DENY';
      reasons.push('CAPABILITY_HUMAN_ONLY');
    } else {
      const grants = await deps.repo.listActiveCapabilityGrants(
        trx,
        actor.row.principal_id,
        input.intent.enterpriseId,
        input.intent.requestedAt,
      );
      const covering = grants.some(
        (grant) =>
          grant.capability_code === input.intent.requestedCapability &&
          (grant.scope_kind === 'ENTERPRISE' || grant.project_id === input.intent.projectId),
      );
      if (!covering) {
        outcome = 'DENY';
        reasons.push('NO_ACTIVE_GRANT');
      } else {
        reasons.push('ALLOWED_BY_GRANT');
      }
    }

    const decisionPayload: CanonicalJsonObject = {
      outcome,
      enterpriseId: input.intent.enterpriseId,
      commandType: input.intent.commandType,
      principalKind: principal?.principal_kind ?? actor.row.principal_kind,
      reasons,
    };
    await deps.repo.insertAuthorizationDecision(trx, {
      authorizationDecisionId: decisionId,
      actorSnapshotId: actor.row.actor_snapshot_id,
      principalId: actor.row.principal_id,
      principalKind: principal?.principal_kind ?? actor.row.principal_kind,
      outcome,
      reasonCodes: reasons,
      commandType: input.intent.commandType,
      commandVersion: input.intent.commandVersion,
      scopeKind: input.intent.scopeKind,
      enterpriseId: input.intent.enterpriseId,
      projectId: input.intent.projectId,
      purpose: input.intent.purpose,
      requestedCapability: input.intent.requestedCapability,
      commandPayloadHash: input.intent.commandPayloadHash,
      policySnapshotId: input.policySnapshotRef.snapshotId,
      policySnapshotPayloadHash: input.policySnapshotRef.payloadHash,
      authenticationContextHash: input.authenticationContextHash,
      expiresAt,
      contractVersion: '1.0',
      decisionPayload,
      createdByPrincipalId: deps.context.principalId,
      sourceCommandId: newUuidV7(),
    });
    return { outcome, reasons };
  });

  const digest = digestCanonicalPayload({
    outcome: view.outcome,
    enterpriseId: input.intent.enterpriseId,
    commandType: input.intent.commandType,
    reasons: view.reasons,
  });
  // The stored canonical payload is authoritative; re-read the exact hash.
  const stored = await withIdentityTransaction(deps.db, deps.context, async (trx) => {
    const found = await trx
      .selectFrom('identity_policy.authorization_decision')
      .selectAll()
      .where('authorization_decision_id', '=', decisionId)
      .executeTakeFirst();
    return found;
  });
  if (!stored) {
    throw new SnapshotBoundaryError(IDENTITY_DECISION_INPUT_INVALID, 'decision persistence failed');
  }
  void digest;
  return {
    authorizationDecisionRef: {
      decisionId,
      payloadHash: stored.payload_hash,
      payloadHashAlgorithm: stored.payload_hash_algorithm,
      canonicalizationVersion: stored.canonicalization_version,
    },
    outcome: view.outcome,
    reasons: view.reasons,
    policySnapshotRef: input.policySnapshotRef,
    effectiveScopeRef: {
      scopeKind: input.intent.scopeKind,
      enterpriseId: input.intent.enterpriseId,
      projectId: input.intent.projectId,
    },
    expiresAt,
  };
}

export interface DecisionValidationInput {
  decisionRef: { decisionId: string; payloadHash: Buffer };
  expectedCommandType: string;
  expectedCommandVersion: string;
  expectedScope: {
    scopeKind: 'ENTERPRISE' | 'PROJECT';
    enterpriseId: string;
    projectId?: string | undefined;
  };
  expectedPurpose: string;
  expectedCommandPayloadHash: Buffer;
  expectedAuthenticationContextHash: Buffer;
  now: Date;
}

export interface DecisionValidationResult {
  valid: boolean;
  reason?:
    | 'NOT_FOUND'
    | 'HASH_MISMATCH'
    | 'COMMAND_TYPE_MISMATCH'
    | 'COMMAND_VERSION_MISMATCH'
    | 'SCOPE_MISMATCH'
    | 'PURPOSE_MISMATCH'
    | 'PAYLOAD_HASH_MISMATCH'
    | 'AUTH_CONTEXT_MISMATCH'
    | 'EXPIRED';
  outcome?: 'ALLOW' | 'DENY';
}

/**
 * Validation every downstream business handler must run against a presented
 * AuthorizationDecision: exact hash, command type/version, scope, purpose,
 * command payload hash, authentication context and expiry. Any mismatch
 * rejects; an ALLOW is never accepted beyond its expiresAt.
 */
export async function validateAuthorizationDecision(
  deps: IdentityCommandDeps,
  input: DecisionValidationInput,
): Promise<DecisionValidationResult> {
  return withIdentityTransaction(deps.db, deps.context, async (trx) => {
    const found = await deps.repo.getAuthorizationDecisionByIdAndHash(
      trx,
      input.decisionRef.decisionId,
      input.decisionRef.payloadHash,
    );
    if (!found) {
      return { valid: false, reason: 'NOT_FOUND' };
    }
    if (!found.hashMatched) {
      return { valid: false, reason: 'HASH_MISMATCH' };
    }
    const row = found.row;
    if (row.command_type !== input.expectedCommandType) {
      return { valid: false, reason: 'COMMAND_TYPE_MISMATCH', outcome: row.outcome };
    }
    if (row.command_version !== input.expectedCommandVersion) {
      return { valid: false, reason: 'COMMAND_VERSION_MISMATCH', outcome: row.outcome };
    }
    if (
      row.scope_kind !== input.expectedScope.scopeKind ||
      row.enterprise_id !== input.expectedScope.enterpriseId ||
      row.project_id !== (input.expectedScope.projectId ?? null)
    ) {
      return { valid: false, reason: 'SCOPE_MISMATCH', outcome: row.outcome };
    }
    if (row.purpose !== input.expectedPurpose) {
      return { valid: false, reason: 'PURPOSE_MISMATCH', outcome: row.outcome };
    }
    if (!row.command_payload_hash.equals(input.expectedCommandPayloadHash)) {
      return { valid: false, reason: 'PAYLOAD_HASH_MISMATCH', outcome: row.outcome };
    }
    if (!row.authentication_context_hash.equals(input.expectedAuthenticationContextHash)) {
      return { valid: false, reason: 'AUTH_CONTEXT_MISMATCH', outcome: row.outcome };
    }
    if (row.expires_at <= input.now) {
      return { valid: false, reason: 'EXPIRED', outcome: row.outcome };
    }
    return { valid: true, outcome: row.outcome };
  });
}
