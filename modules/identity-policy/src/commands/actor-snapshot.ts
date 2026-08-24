// IM-02 WI-09 (issue #37): controlled ActorSnapshot creation/validation and
// the identity.authorize_command@1.0 Decision Port — the single place an
// immutable AuthorizationDecision is produced. actingFor is metadata: the
// actor principal kind comes from the principal table and can never be
// upgraded by the acting_for reference.

import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Common } from '@zhiju/contracts';
import type { Kysely } from 'kysely';
import {
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
export type ScopeKind = 'ENTERPRISE' | 'PROJECT';

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
  scopeKind: ScopeKind;
  enterpriseId: string;
  projectId?: string | undefined;
}

export type ActorSnapshotRef = Common.SnapshotRef;

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
  validateHash(
    input.authenticationContextHash,
    IDENTITY_ACTOR_SNAPSHOT_INVALID,
    'authentication context hash',
  );
  validateScope(
    input.scopeKind,
    input.enterpriseId,
    input.projectId,
    deps.context,
    IDENTITY_ACTOR_SNAPSHOT_INVALID,
    'actor snapshot',
  );
  if ((input.actingForPrincipalId === undefined) !== (input.actingForKind === undefined)) {
    throw new SnapshotBoundaryError(IDENTITY_ACTOR_SNAPSHOT_INVALID, 'actingFor must be complete');
  }
  await withIdentityTransaction(deps.db, deps.context, async (trx) => {
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
      ...(input.actingForPrincipalId !== undefined && input.actingForKind !== undefined
        ? {
            actingForPrincipalId: input.actingForPrincipalId,
            actingForKind: input.actingForKind,
          }
        : {}),
      ...(input.channelCode !== undefined ? { channelCode: input.channelCode } : {}),
      ...(input.runtimeSource !== undefined ? { runtimeSource: input.runtimeSource } : {}),
      authenticationContextHash: input.authenticationContextHash,
      enterpriseId: input.enterpriseId,
      scopeKind: input.scopeKind,
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      contractVersion: '1.0',
      snapshotPayload: {
        note: 'wi09 actor snapshot',
        principalId: input.principalId,
        principalKind: principal.principal_kind,
        scopeKind: input.scopeKind,
        enterpriseId: input.enterpriseId,
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        authenticationContextHash: input.authenticationContextHash.toString('hex'),
        ...(input.actingForPrincipalId !== undefined && input.actingForKind !== undefined
          ? {
              actingFor: {
                principalId: input.actingForPrincipalId,
                principalKind: input.actingForKind,
              },
            }
          : {}),
        ...(input.channelCode !== undefined ? { channelCode: input.channelCode } : {}),
        ...(input.runtimeSource !== undefined ? { runtimeSource: input.runtimeSource } : {}),
      },
      createdByPrincipalId: deps.context.principalId,
      sourceCommandId: newUuidV7(),
    });
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
  if (!row) {
    throw new SnapshotBoundaryError(IDENTITY_ACTOR_SNAPSHOT_INVALID, 'snapshot creation failed');
  }
  return {
    kind: 'SNAPSHOT',
    objectType: 'identity.actor_snapshot',
    objectId: row.actor_snapshot_id,
    snapshotId: row.actor_snapshot_id,
    scope: scopeRef(row.scope_kind, row.enterprise_id, row.project_id ?? undefined),
    contentHash: contentHash(row.payload_hash),
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
  scopeKind: ScopeKind;
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
  policySnapshotRef: Common.SnapshotRef;
  ttlSeconds?: number | undefined;
}

export interface AuthorizationDecisionView {
  authorizationDecisionRef: Common.ContentAddressedRef;
  outcome: 'ALLOW' | 'DENY';
  reasons: string[];
  policySnapshotRef: Common.SnapshotRef;
  effectiveScopeRef: Common.ScopeRef;
  expiresAt: Common.UtcInstant;
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
  assertSnapshotReference(
    input.actorSnapshotRef,
    'identity.actor_snapshot',
    IDENTITY_ACTOR_SNAPSHOT_INVALID,
    'actor snapshot',
  );
  assertSnapshotReference(
    input.policySnapshotRef,
    'identity.policy_snapshot',
    IDENTITY_DECISION_INPUT_INVALID,
    'policy snapshot',
  );
  if (Object.keys(input.policySnapshotRef.scope).length !== 0) {
    throw new SnapshotBoundaryError(
      IDENTITY_DECISION_INPUT_INVALID,
      'policy snapshot scope must be empty',
    );
  }
  const actorSnapshotPayloadHash = contentHashToBuffer(
    input.actorSnapshotRef.contentHash,
    IDENTITY_ACTOR_SNAPSHOT_INVALID,
    'actor snapshot payload hash',
  );
  const policySnapshotPayloadHash = contentHashToBuffer(
    input.policySnapshotRef.contentHash,
    IDENTITY_DECISION_INPUT_INVALID,
    'policy snapshot payload hash',
  );
  validateHash(
    input.authenticationContextHash,
    IDENTITY_DECISION_INPUT_INVALID,
    'authentication context hash',
  );
  validateHash(
    input.intent.commandPayloadHash,
    IDENTITY_DECISION_INPUT_INVALID,
    'command payload hash',
  );
  validateScope(
    input.intent.scopeKind,
    input.intent.enterpriseId,
    input.intent.projectId,
    deps.context,
    IDENTITY_DECISION_INPUT_INVALID,
    'command intent',
  );
  if (
    !(input.intent.requestedAt instanceof Date) ||
    !Number.isFinite(input.intent.requestedAt.getTime())
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_DECISION_INPUT_INVALID,
      'command intent requestedAt is invalid',
    );
  }
  if (input.intent.commandVersion !== '1.0') {
    throw new SnapshotBoundaryError(
      IDENTITY_DECISION_INPUT_INVALID,
      'command intent version must be 1.0',
    );
  }
  const ttlSeconds = input.ttlSeconds ?? DECISION_DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new SnapshotBoundaryError(
      IDENTITY_DECISION_INPUT_INVALID,
      'decision ttl must be positive',
    );
  }
  const decisionId = newUuidV7();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const view = await withIdentityTransaction(deps.db, deps.context, async (trx) => {
    // Exact actor snapshot ref: id + payload hash must both match.
    const actor = await deps.repo.getActorSnapshotByIdAndHash(
      trx,
      input.actorSnapshotRef.snapshotId,
      actorSnapshotPayloadHash,
    );
    if (!actor?.hashMatched) {
      throw new SnapshotBoundaryError(
        IDENTITY_ACTOR_SNAPSHOT_INVALID,
        'actor snapshot ref does not match',
      );
    }
    if (
      actor.row.scope_kind !== input.intent.scopeKind ||
      actor.row.enterprise_id !== input.intent.enterpriseId ||
      actor.row.project_id !== (input.intent.projectId ?? null)
    ) {
      throw new SnapshotBoundaryError(
        IDENTITY_DECISION_INPUT_INVALID,
        'actor snapshot scope must match the command intent scope',
      );
    }
    if (
      !sameScope(
        input.actorSnapshotRef.scope,
        scopeRef(actor.row.scope_kind, actor.row.enterprise_id, actor.row.project_id ?? undefined),
      )
    ) {
      throw new SnapshotBoundaryError(
        IDENTITY_ACTOR_SNAPSHOT_INVALID,
        'actor snapshot reference scope does not match the stored snapshot',
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
      policySnapshotPayloadHash,
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
      actorSnapshotId: actor.row.actor_snapshot_id,
      actorSnapshotPayloadHash: actor.row.payload_hash.toString('hex'),
      authenticationContextHash: input.authenticationContextHash.toString('hex'),
      outcome,
      enterpriseId: input.intent.enterpriseId,
      ...(input.intent.projectId !== undefined ? { projectId: input.intent.projectId } : {}),
      scopeKind: input.intent.scopeKind,
      commandType: input.intent.commandType,
      commandVersion: input.intent.commandVersion,
      purpose: input.intent.purpose,
      requestedCapability: input.intent.requestedCapability,
      commandPayloadHash: input.intent.commandPayloadHash.toString('hex'),
      requestedAt: input.intent.requestedAt.toISOString(),
      highRiskAction: input.intent.highRiskAction,
      policySnapshotId: input.policySnapshotRef.snapshotId,
      policySnapshotPayloadHash: policySnapshotPayloadHash.toString('hex'),
      principalKind: principal?.principal_kind ?? actor.row.principal_kind,
      reasons,
    };
    await deps.repo.insertAuthorizationDecision(trx, {
      authorizationDecisionId: decisionId,
      actorSnapshotId: actor.row.actor_snapshot_id,
      actorSnapshotPayloadHash: actor.row.payload_hash,
      principalId: actor.row.principal_id,
      principalKind: principal?.principal_kind ?? actor.row.principal_kind,
      outcome,
      reasonCodes: reasons,
      commandType: input.intent.commandType,
      commandVersion: input.intent.commandVersion,
      scopeKind: input.intent.scopeKind,
      enterpriseId: input.intent.enterpriseId,
      ...(input.intent.projectId !== undefined ? { projectId: input.intent.projectId } : {}),
      purpose: input.intent.purpose,
      requestedCapability: input.intent.requestedCapability,
      commandPayloadHash: input.intent.commandPayloadHash,
      policySnapshotId: input.policySnapshotRef.snapshotId,
      policySnapshotPayloadHash,
      authenticationContextHash: input.authenticationContextHash,
      expiresAt,
      contractVersion: '1.0',
      decisionPayload,
      createdByPrincipalId: deps.context.principalId,
      sourceCommandId: newUuidV7(),
    });
    return { outcome, reasons };
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
  return {
    authorizationDecisionRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'identity.authorization_decision',
      objectId: stored.authorization_decision_id,
      scope: scopeRef(input.intent.scopeKind, input.intent.enterpriseId, input.intent.projectId),
      contentHash: contentHash(stored.payload_hash),
    },
    outcome: view.outcome,
    reasons: view.reasons,
    policySnapshotRef: input.policySnapshotRef,
    effectiveScopeRef: scopeRef(
      input.intent.scopeKind,
      input.intent.enterpriseId,
      input.intent.projectId,
    ),
    expiresAt: expiresAt.toISOString(),
  };
}

export interface DecisionValidationInput {
  decisionRef: Common.ContentAddressedRef;
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
  if (!isContentAddressedDecisionReference(input.decisionRef)) {
    return { valid: false, reason: 'HASH_MISMATCH' };
  }
  const decisionPayloadHash = contentHashToBuffer(
    input.decisionRef.contentHash,
    IDENTITY_DECISION_INPUT_INVALID,
    'decision payload hash',
  );
  validateHash(
    input.expectedCommandPayloadHash,
    IDENTITY_DECISION_INPUT_INVALID,
    'expected command payload hash',
  );
  validateHash(
    input.expectedAuthenticationContextHash,
    IDENTITY_DECISION_INPUT_INVALID,
    'expected authentication context hash',
  );
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new SnapshotBoundaryError(
      IDENTITY_DECISION_INPUT_INVALID,
      'decision validation time is invalid',
    );
  }
  return withIdentityTransaction(deps.db, deps.context, async (trx) => {
    const found = await deps.repo.getAuthorizationDecisionByIdAndHash(
      trx,
      input.decisionRef.objectId,
      decisionPayloadHash,
    );
    if (!found) {
      return { valid: false, reason: 'NOT_FOUND' };
    }
    if (!found.hashMatched) {
      return { valid: false, reason: 'HASH_MISMATCH' };
    }
    const row = found.row;
    if (
      !sameScope(
        input.decisionRef.scope,
        scopeRef(row.scope_kind, row.enterprise_id, row.project_id ?? undefined),
      )
    ) {
      return { valid: false, reason: 'SCOPE_MISMATCH', outcome: row.outcome };
    }
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

function validateHash(value: Buffer, code: string, field: string): void {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    throw new SnapshotBoundaryError(code, `${field} must be a SHA-256 digest`);
  }
}

function contentHash(value: Buffer): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: value.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function contentHashToBuffer(value: unknown, code: string, field: string): Buffer {
  const candidate = value as
    | {
        algorithm?: unknown;
        canonicalizationVersion?: unknown;
        digest?: unknown;
      }
    | null
    | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate !== 'object' ||
    candidate.algorithm !== 'SHA-256' ||
    candidate.canonicalizationVersion !== '1' ||
    typeof candidate.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(candidate.digest)
  ) {
    throw new SnapshotBoundaryError(code, `${field} must be a SHA-256 digest`);
  }
  return Buffer.from(candidate.digest, 'hex');
}

function isContentAddressedDecisionReference(value: unknown): value is Common.ContentAddressedRef {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as {
    kind?: unknown;
    objectType?: unknown;
    objectId?: unknown;
    scope?: unknown;
  };
  return (
    candidate.kind === 'CONTENT_ADDRESSED' &&
    candidate.objectType === 'identity.authorization_decision' &&
    typeof candidate.objectId === 'string' &&
    isScope(candidate.scope)
  );
}

export function assertSnapshotReference(
  ref: Common.SnapshotRef,
  expectedObjectType: string,
  code: string,
  subject: string,
): void {
  const candidate = ref as unknown as
    | {
        kind?: unknown;
        objectType?: unknown;
        objectId?: unknown;
        snapshotId?: unknown;
        scope?: unknown;
      }
    | null
    | undefined;
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    candidate.kind !== 'SNAPSHOT' ||
    candidate.objectType !== expectedObjectType ||
    typeof candidate.objectId !== 'string' ||
    candidate.objectId !== candidate.snapshotId ||
    !isScope(candidate.scope)
  ) {
    throw new SnapshotBoundaryError(code, `${subject} reference metadata is invalid`);
  }
}

function isScope(value: unknown): value is Common.ScopeRef {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { enterpriseId?: unknown; projectId?: unknown };
  return (
    Object.keys(candidate).every((key) => key === 'enterpriseId' || key === 'projectId') &&
    (candidate.enterpriseId === undefined || typeof candidate.enterpriseId === 'string') &&
    (candidate.projectId === undefined || typeof candidate.projectId === 'string') &&
    (candidate.projectId === undefined || candidate.enterpriseId !== undefined)
  );
}

function sameScope(left: unknown, right: unknown): boolean {
  if (!isScope(left) || !isScope(right)) return false;
  return left.enterpriseId === right.enterpriseId && left.projectId === right.projectId;
}

function scopeRef(
  scopeKind: ScopeKind,
  enterpriseId: string,
  projectId: string | undefined,
): Common.ScopeRef {
  if (scopeKind === 'PROJECT' && projectId !== undefined) {
    return { enterpriseId, projectId };
  }
  return { enterpriseId };
}

function validateScope(
  scopeKind: ScopeKind,
  enterpriseId: string,
  projectId: string | undefined,
  context: IdentityTransactionContext,
  code: string,
  subject: string,
): void {
  const candidateScopeKind: string = scopeKind;
  if (enterpriseId !== context.enterpriseId) {
    throw new SnapshotBoundaryError(
      code,
      `${subject} enterprise scope must match the transaction context`,
    );
  }
  if (scopeKind === 'ENTERPRISE') {
    if (projectId !== undefined) {
      throw new SnapshotBoundaryError(code, `${subject} enterprise scope must not carry a project`);
    }
    return;
  }
  if (
    candidateScopeKind !== 'PROJECT' ||
    projectId === undefined ||
    !context.allowedProjectIds.includes(projectId)
  ) {
    throw new SnapshotBoundaryError(code, `${subject} project scope must carry an allowed project`);
  }
}
