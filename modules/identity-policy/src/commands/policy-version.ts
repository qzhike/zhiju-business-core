// IM-06 (#186): the IdentityPolicy-owned PolicyVersion fact handlers.
//
// `identity.record_policy_version@1.0` binds one Policy version key
// (`VersionedRef<Policy>`) to exactly one committed, immutable scoped fact and
// optionally declares the unique supersede edge to an earlier version of the
// same policy identity; `identity.resolve_policy@1.0` returns the exact
// observation (ref, canonical document, content hash, Scope, lifecycle) of a
// version key without resolving latest/current.
//
// Both owning entries take the complete registered Envelope and run the
// registered contract first (schema + PayloadGuard, shared API §5.3 step 1),
// then revalidate the AuthorizationDecision the trusted transaction context
// pins (step 3: exact ref/hash, command type/version, Scope, Purpose, request
// payload hash, actor binding, expiry and the *current* covering grant) before
// any idempotent result can be returned, so a revoked grant or a Decision
// issued for another purpose cannot pass an owning handler and a historical
// Receipt never restores execution eligibility. Result payloads are checked
// against the registered result contract inside the owning transaction, so a
// failed check rolls back the fact instead of committing a success Receipt.
// Every authorization failure writes a masked, in-scope Audit instead of
// leaking the existence of another Scope's fact.

import { newUuidV7, type CanonicalJsonObject, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import {
  ContractRegistry,
  POLICY_PROFILE_REGISTRY_VERSION,
  type CanonicalJson,
  type Common,
} from '@zhiju/contracts';
import { sql } from 'kysely';
import {
  digestCanonicalPayload,
  withIdentityTransaction,
  type IdentityTransaction,
  type IdentityTransactionContext,
} from '../persistence/identity-db.js';
import {
  executeIdentityCommand,
  CommandExecutionError,
  type CommandResult,
} from '../persistence/command-runner.js';
import { policyVersionIntegrityHolds } from '../persistence/identity-policy-repository.js';
import { SnapshotBoundaryError, type IdentityCommandDeps } from './actor-snapshot.js';
import {
  IDENTITY_POLICY_SNAPSHOT_INVALID,
  IDENTITY_POLICY_VERSION_UNKNOWN,
} from './role-capability-handlers.js';
import { registeredPolicySchemaKey } from './static-registry.js';

export const IDENTITY_POLICY_VERSION_ALREADY_BOUND = 'IDENTITY_POLICY_VERSION_ALREADY_BOUND';
export const IDENTITY_POLICY_SUPERSEDE_INVALID = 'IDENTITY_POLICY_SUPERSEDE_INVALID';
export const IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED =
  'IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED';

/** Shared API reason codes reused by the owning contract and authorization boundary. */
export const AUTHORIZATION_DECISION_INVALID = 'AUTHORIZATION_DECISION_INVALID';
export const AUTHORIZATION_EXPIRED = 'AUTHORIZATION_EXPIRED';
export const AUTHORIZATION_REVOKED = 'AUTHORIZATION_REVOKED';
export const DEPENDENCY_UNAVAILABLE = 'DEPENDENCY_UNAVAILABLE';
export const API_PAYLOAD_LIMIT_EXCEEDED = 'API_PAYLOAD_LIMIT_EXCEEDED';
export const API_VALUE_INVALID = 'API_VALUE_INVALID';
export const API_CONTRACT_TYPE_UNKNOWN = 'API_CONTRACT_TYPE_UNKNOWN';
export const API_PAYLOAD_HASH_MISMATCH = 'API_PAYLOAD_HASH_MISMATCH';
export const SCOPE_MISMATCH = 'SCOPE_MISMATCH';
export const INTERNAL_CONTRACT_VIOLATION = 'INTERNAL_CONTRACT_VIOLATION';

/** Exact registered identities of the two operations (Spec 001 §13.3). */
export const RECORD_POLICY_VERSION_COMMAND = 'identity.record_policy_version';
export const RESOLVE_POLICY_COMMAND = 'identity.resolve_policy';
export const RECORD_POLICY_VERSION_PURPOSE = 'identity.policy.record_policy_version';
export const RESOLVE_POLICY_PURPOSE = 'identity.policy.resolve_policy';
export const POLICY_OBJECT_TYPE = 'zhiju.identity.policy';
export const POLICY_VERSION_OBJECT_TYPE = 'zhiju.identity.policy_version';

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

// ---------------------------------------------------------------------------
// Registered contract boundary. Both owning entries validate the complete
// public Envelope (structure and the registered finite PayloadGuard budget);
// nothing below may run before that check, and the write result is validated
// against the registered result schema before the owning transaction commits.
// ---------------------------------------------------------------------------

let sharedContractRegistry: ContractRegistry | undefined;

/**
 * The registered contract implementation used by these owning entries: the
 * wiring-level dependency when supplied, otherwise the shared build-time
 * registry. Both call sites keep the same validation order and error shape.
 */
function contractRegistry(deps?: IdentityCommandDeps): ContractRegistry {
  sharedContractRegistry ??= new ContractRegistry();
  return deps?.contracts ?? sharedContractRegistry;
}

/**
 * Stable reason code of a request that does not satisfy its registered
 * operation contract, or `null` when it does. The Guard runs before the
 * structural schema (same order as the shared registry), so a request over the
 * approved budget short-circuits before any structure walk or database access.
 */
function requestContractViolation(
  registry: ContractRegistry,
  type: string,
  input: unknown,
): string | null {
  const validation = registry.validateOperation(type, '1.0', input);
  if (validation.valid) {
    return null;
  }
  if (validation.errors.some((error) => error.keyword === 'operationRegistry')) {
    return API_CONTRACT_TYPE_UNKNOWN;
  }
  if (validation.errors.some((error) => error.keyword === 'payloadGuard')) {
    return API_PAYLOAD_LIMIT_EXCEEDED;
  }
  return API_VALUE_INVALID;
}

function resultContractViolation(
  registry: ContractRegistry,
  type: string,
  input: unknown,
): string | null {
  const validation = registry.validateOperationResult(type, '1.0', input);
  if (validation.valid) {
    return null;
  }
  if (validation.errors.some((error) => error.keyword === 'payloadGuard')) {
    return API_PAYLOAD_LIMIT_EXCEEDED;
  }
  return INTERNAL_CONTRACT_VIOLATION;
}

interface RegisteredReference {
  readonly kind?: unknown;
  readonly objectType?: unknown;
  readonly objectId?: unknown;
  readonly snapshotId?: unknown;
  readonly scope?: unknown;
  readonly contentHash?: unknown;
}

/**
 * Closed allow-list of the authorization reference namespaces accepted on the
 * presented Envelope. Both the module's canonical identity namespace and the
 * `zhiju.`-prefixed namespace registered by #183 fixtures are legal; every
 * other object type is refused.
 */
const AUTHORIZATION_DECISION_OBJECT_TYPES: ReadonlySet<string> = new Set([
  'identity.authorization_decision',
  'zhiju.identity.authorization_decision',
]);
const PRINCIPAL_OBJECT_TYPES: ReadonlySet<string> = new Set([
  'identity.principal',
  'zhiju.identity.principal',
]);
const ACTOR_SNAPSHOT_OBJECT_TYPES: ReadonlySet<string> = new Set([
  'identity.actor_snapshot',
  'zhiju.identity.actor_snapshot',
]);

interface RegisteredScope {
  readonly enterpriseId?: unknown;
  readonly projectId?: unknown;
}

interface RegisteredCommandEnvelope {
  readonly commandId?: unknown;
  readonly scopeRef?: RegisteredScope;
  readonly targetRef?: RegisteredReference & { readonly scope?: RegisteredScope };
  readonly actor?: RegisteredReference;
  readonly authorizationDecisionRef?: RegisteredReference;
  readonly idempotencyKey?: unknown;
  readonly correlationId?: unknown;
  readonly payload?: unknown;
  readonly integrity?: { readonly payloadHash?: unknown };
}

interface RegisteredQueryEnvelope {
  readonly queryId?: unknown;
  readonly scopeRef?: RegisteredScope;
  readonly requester?: RegisteredReference;
  readonly authorizationDecisionRef?: RegisteredReference;
  readonly correlationId?: unknown;
  readonly payload?: unknown;
}

function contentHashDigest(value: unknown): string | null {
  const candidate = value as { algorithm?: unknown; digest?: unknown } | null | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate !== 'object' ||
    candidate.algorithm !== 'SHA-256' ||
    typeof candidate.digest !== 'string'
  ) {
    return null;
  }
  return candidate.digest;
}

function sameScope(
  left: RegisteredScope | undefined,
  right: { readonly enterpriseId?: string | undefined; readonly projectId?: string | undefined },
): boolean {
  return (
    left?.enterpriseId === right.enterpriseId &&
    (left?.projectId ?? null) === (right.projectId ?? null)
  );
}

/**
 * Validates the complete presented authorization references, not only their
 * ids: the Decision reference must carry an allowed object type, the exact
 * trusted id/hash and the request Scope; the actor reference must be either
 * the trusted principal's ObjectRef or an ActorSnapshot SnapshotRef whose
 * exact objectId, snapshotId, Scope and stored content hash all match the
 * trusted Context. Returns the stable failure code, or `null` when both
 * references are exact.
 */
async function presentedReferenceError(
  deps: IdentityCommandDeps,
  trx: IdentityTransaction,
  input: {
    decisionRef: RegisteredReference | undefined;
    actorRef: RegisteredReference | undefined;
    scope: Common.ScopeRef;
  },
): Promise<string | null> {
  const decision = input.decisionRef;
  if (
    decision?.kind !== 'CONTENT_ADDRESSED' ||
    typeof decision.objectType !== 'string' ||
    !AUTHORIZATION_DECISION_OBJECT_TYPES.has(decision.objectType) ||
    decision.objectId !== deps.context.authorizationDecisionId ||
    contentHashDigest(decision.contentHash) !==
      deps.context.authorizationDecisionHash.toString('hex') ||
    !sameScope(decision.scope as RegisteredScope | undefined, input.scope)
  ) {
    return AUTHORIZATION_DECISION_INVALID;
  }
  const actor = input.actorRef;
  if (
    actor === undefined ||
    typeof actor.objectType !== 'string' ||
    !sameScope(actor.scope as RegisteredScope | undefined, input.scope)
  ) {
    return AUTHORIZATION_DECISION_INVALID;
  }
  if (actor.kind === 'OBJECT') {
    return PRINCIPAL_OBJECT_TYPES.has(actor.objectType) &&
      actor.objectId === deps.context.principalId
      ? null
      : AUTHORIZATION_DECISION_INVALID;
  }
  if (actor.kind !== 'SNAPSHOT' || !ACTOR_SNAPSHOT_OBJECT_TYPES.has(actor.objectType)) {
    return AUTHORIZATION_DECISION_INVALID;
  }
  if (
    actor.objectId !== deps.context.actorSnapshotId ||
    actor.snapshotId !== deps.context.actorSnapshotId
  ) {
    return AUTHORIZATION_DECISION_INVALID;
  }
  const digest = contentHashDigest(actor.contentHash);
  if (digest === null) {
    return AUTHORIZATION_DECISION_INVALID;
  }
  const resolved = await deps.repo.getActorSnapshotByIdAndHash(
    trx,
    deps.context.actorSnapshotId,
    Buffer.from(digest, 'hex'),
  );
  return resolved?.hashMatched === true ? null : AUTHORIZATION_DECISION_INVALID;
}

interface PolicyVersionKey {
  objectId: string;
  versionId: string;
  scopeKind: 'ENTERPRISE' | 'PROJECT';
  enterpriseId: string;
  projectId?: string | undefined;
}

/**
 * Reads the canonical `VersionedRef<Policy>` version key: VERSIONED kind, the
 * pinned `zhiju.identity.policy` objectType, UuidV7 ids, and the closed
 * `{enterpriseId, projectId?}` Scope. The registered payload schema enforces
 * the same shape; this reader keeps the owning boundary fail-closed without
 * assuming it.
 */
function readPolicyVersionKey(value: unknown): PolicyVersionKey | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const candidate = value as {
    kind?: unknown;
    objectType?: unknown;
    objectId?: unknown;
    versionId?: unknown;
  };
  const scope = (candidate as { scope?: unknown }).scope as RegisteredScope | null | undefined;
  if (scope === null || scope === undefined || typeof scope !== 'object') {
    return null;
  }
  if (
    candidate.kind !== 'VERSIONED' ||
    candidate.objectType !== POLICY_OBJECT_TYPE ||
    typeof candidate.objectId !== 'string' ||
    !uuidV7Pattern.test(candidate.objectId) ||
    typeof candidate.versionId !== 'string' ||
    !uuidV7Pattern.test(candidate.versionId) ||
    typeof scope.enterpriseId !== 'string' ||
    !uuidV7Pattern.test(scope.enterpriseId) ||
    Object.keys(scope).some((key) => key !== 'enterpriseId' && key !== 'projectId')
  ) {
    return null;
  }
  if (scope.projectId === undefined) {
    return {
      objectId: candidate.objectId,
      versionId: candidate.versionId,
      scopeKind: 'ENTERPRISE',
      enterpriseId: scope.enterpriseId,
    };
  }
  if (typeof scope.projectId !== 'string' || !uuidV7Pattern.test(scope.projectId)) {
    return null;
  }
  return {
    objectId: candidate.objectId,
    versionId: candidate.versionId,
    scopeKind: 'PROJECT',
    enterpriseId: scope.enterpriseId,
    projectId: scope.projectId,
  };
}

function versionKeyScope(key: PolicyVersionKey): Common.ScopeRef {
  return key.scopeKind === 'PROJECT' && key.projectId !== undefined
    ? { enterpriseId: key.enterpriseId, projectId: key.projectId }
    : { enterpriseId: key.enterpriseId };
}

function versionKeyReference(key: PolicyVersionKey): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: POLICY_OBJECT_TYPE,
    objectId: key.objectId,
    versionId: key.versionId,
    scope: versionKeyScope(key),
  };
}

/** The canonical payload form of the committed version fact reference. */
function canonicalVersionFactReference(
  policyVersionFactId: string,
  key: PolicyVersionKey,
  payloadHash: Buffer,
): CanonicalJsonObject {
  return {
    kind: 'SNAPSHOT',
    objectType: POLICY_VERSION_OBJECT_TYPE,
    objectId: policyVersionFactId,
    snapshotId: policyVersionFactId,
    scope:
      key.projectId === undefined
        ? { enterpriseId: key.enterpriseId }
        : { enterpriseId: key.enterpriseId, projectId: key.projectId },
    contentHash: {
      algorithm: 'SHA-256',
      digest: payloadHash.toString('hex'),
      canonicalizationVersion: '1',
    },
  };
}

/** The request Scope must lie inside the caller's current authorization Scope. */
function scopeWithinContext(key: PolicyVersionKey, context: IdentityTransactionContext): boolean {
  if (key.enterpriseId !== context.enterpriseId) {
    return false;
  }
  return (
    key.scopeKind === 'ENTERPRISE' ||
    (key.projectId !== undefined && context.allowedProjectIds.includes(key.projectId))
  );
}

/**
 * SD-181-1 write boundary: canonical UTC instants at most millisecond
 * precision (`YYYY-MM-DDTHH:mm:ss[.SSS]Z`, ≤ 24 code points). The registered
 * schema enforces the same bound; this reader never truncates or silently
 * rounds.
 */
function parseCanonicalInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length > 24 || !canonicalInstantPattern.test(value)) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const roundTrip = value.includes('.') ? value : value.replace('Z', '.000Z');
  return parsed.toISOString() === roundTrip ? parsed : null;
}

function contentHash(value: Buffer): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: value.toString('hex'),
    canonicalizationVersion: '1',
  };
}

/**
 * Revalidates the pinned Decision against this operation at the owning entry.
 * Returns the stable failure code, or `null` when the Decision currently
 * authorizes exactly this command type/version, scope, purpose and payload
 * hash with an unrevoked covering grant.
 */
async function currentAuthorizationError(
  deps: IdentityCommandDeps,
  trx: IdentityTransaction,
  expected: {
    commandType: string;
    purpose: string;
    key: PolicyVersionKey;
    payloadHash: Buffer;
    now: Date;
  },
): Promise<string | null> {
  const found = await deps.repo.getAuthorizationDecisionByIdAndHash(
    trx,
    deps.context.authorizationDecisionId,
    deps.context.authorizationDecisionHash,
  );
  if (!found?.hashMatched) {
    return AUTHORIZATION_DECISION_INVALID;
  }
  const decision = found.row;
  if (
    decision.outcome !== 'ALLOW' ||
    decision.command_type !== expected.commandType ||
    decision.command_version !== '1.0' ||
    decision.purpose !== expected.purpose ||
    decision.scope_kind !== expected.key.scopeKind ||
    decision.enterprise_id !== expected.key.enterpriseId ||
    decision.project_id !== (expected.key.projectId ?? null) ||
    decision.principal_id !== deps.context.principalId ||
    decision.actor_snapshot_id !== deps.context.actorSnapshotId ||
    !decision.command_payload_hash.equals(expected.payloadHash)
  ) {
    return AUTHORIZATION_DECISION_INVALID;
  }
  if (decision.expires_at <= expected.now) {
    return AUTHORIZATION_EXPIRED;
  }
  // Current-grant revalidation: an already-issued ALLOW stops covering the
  // request as soon as its exact-scope capability grant is revoked.
  const grants = await deps.repo.listActiveCapabilityGrants(
    trx,
    decision.principal_id,
    decision.enterprise_id,
    expected.now,
  );
  const covering = grants.some(
    (grant) =>
      grant.capability_code === decision.requested_capability &&
      grant.scope_kind === decision.scope_kind &&
      grant.enterprise_id === decision.enterprise_id &&
      grant.project_id === decision.project_id,
  );
  return covering ? null : AUTHORIZATION_REVOKED;
}

/**
 * Masked, in-scope audit for a denied request: the external result stays a
 * stable code while the internal classification (scope mismatch, authorization
 * state, integrity) is only visible here, together with hashes and never any
 * document content.
 */
async function appendDeniedAudit(
  deps: IdentityCommandDeps,
  trx: IdentityTransaction,
  input: {
    commandType: string;
    errorCode: string;
    internalReason: string;
    /** Verified Project of the request, or null when it is not authorized. */
    projectId: string | null;
    requestHash: Buffer;
    targetId: string | null;
  },
): Promise<void> {
  await trx
    .insertInto('identity_policy.audit_record')
    .values({
      audit_id: newUuidV7(),
      enterprise_id: deps.context.enterpriseId,
      project_id: input.projectId,
      principal_id: deps.context.principalId,
      actor_snapshot_id: deps.context.actorSnapshotId,
      authorization_decision_id: deps.context.authorizationDecisionId,
      command_id: newUuidV7(),
      command_type: input.commandType,
      outcome: 'DENIED',
      error_code: input.errorCode,
      request_payload_hash: input.requestHash,
      result_payload_hash: null,
      target_type: 'PolicyVersion',
      target_id: input.targetId,
      correlation_id: deps.context.correlationId,
      safe_summary: input.internalReason,
      retention_class: 'REGULATED_AUDIT',
    })
    .execute();
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === '23505' && candidate.constraint === constraint;
}

function isDependencyUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code } = error as { code?: unknown };
  if (typeof code !== 'string') {
    return false;
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
    return true;
  }
  return code.startsWith('08') || code.startsWith('57') || code === '3D000';
}

function rejected(errorCode: string, safeSummary: string): CommandResult {
  return { status: 'REJECTED', errorCode, safeSummary, currentAggregateVersion: null };
}

/**
 * Inserts one fact behind a savepoint: a PostgreSQL unique violation aborts
 * the enclosing transaction, so the expected race loser is rolled back to the
 * savepoint and the transaction stays usable for the rejection receipt and
 * audit. Constraint names map to stable module errors; `23505` never escapes.
 */
async function insertPolicyVersionGuarded(
  trx: IdentityTransaction,
  insert: (trx: IdentityTransaction) => Promise<{ hash: Buffer }>,
): Promise<{ digest: { hash: Buffer } } | { errorCode: string; safeSummary: string }> {
  await sql.raw('SAVEPOINT policy_version_insert').execute(trx);
  try {
    const digest = await insert(trx);
    await sql.raw('RELEASE SAVEPOINT policy_version_insert').execute(trx);
    return { digest };
  } catch (error) {
    const conflict = isUniqueViolation(error, 'policy_version_binding_unique')
      ? {
          errorCode: IDENTITY_POLICY_VERSION_ALREADY_BOUND,
          safeSummary: 'the policy version key is already bound to a committed fact',
        }
      : isUniqueViolation(error, 'policy_version_supersede_unique')
        ? {
            errorCode: IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED,
            safeSummary: 'the superseded version already has a committed successor',
          }
        : isUniqueViolation(error, 'policy_version_pkey')
          ? {
              errorCode: API_VALUE_INVALID,
              safeSummary: 'policyVersionFactId is already used by a committed fact',
            }
          : null;
    if (conflict === null) {
      throw error;
    }
    await sql.raw('ROLLBACK TO SAVEPOINT policy_version_insert').execute(trx);
    await sql.raw('RELEASE SAVEPOINT policy_version_insert').execute(trx);
    return conflict;
  }
}

export interface RecordPolicyVersionInput {
  /** Complete registered `identity.record_policy_version@1.0` Command Envelope. */
  envelope: unknown;
}

/**
 * `identity.record_policy_version@1.0`: one immutable scoped version fact per
 * version key, with the shared Receipt/Audit in the same owning transaction.
 * The registered contract and the current authorization are checked before the
 * idempotency claim, so an unauthorized request is rejected without claiming a
 * key and a historical Receipt can never restore execution eligibility.
 * Replaying the same idempotency key and payload under valid authorization
 * returns the original result; the same key with a different payload is the
 * shared idempotency conflict.
 */
export async function recordPolicyVersion(
  deps: IdentityCommandDeps,
  input: RecordPolicyVersionInput,
): Promise<CommandResult> {
  const envelope = (input.envelope ?? {}) as RegisteredCommandEnvelope;
  const contracts = contractRegistry(deps);
  const contractViolation = requestContractViolation(
    contracts,
    RECORD_POLICY_VERSION_COMMAND,
    input.envelope,
  );
  if (contractViolation !== null) {
    throw new CommandExecutionError(
      contractViolation,
      'record_policy_version request does not satisfy its registered contract',
    );
  }
  const payload = envelope.payload as CanonicalJsonObject;
  const requestHash = digestCanonicalPayload(payload).hash;
  if (contentHashDigest(envelope.integrity?.payloadHash) !== requestHash.toString('hex')) {
    throw new CommandExecutionError(
      API_PAYLOAD_HASH_MISMATCH,
      'declared request integrity hash does not match the canonical payload',
    );
  }
  const key = readPolicyVersionKey(payload.policyRef);
  if (key === null) {
    throw new CommandExecutionError(
      API_VALUE_INVALID,
      'policyRef must be a canonical scoped Policy version key',
    );
  }
  const effectiveFrom = parseCanonicalInstant(payload.effectiveFrom);
  if (effectiveFrom === null) {
    throw new CommandExecutionError(
      API_VALUE_INVALID,
      'effectiveFrom must be a canonical UTC instant with at most millisecond precision',
    );
  }
  const policySetVersion =
    typeof payload.policySetVersion === 'string' ? payload.policySetVersion : '';
  if (policySetVersion.trim() === '') {
    throw new CommandExecutionError(API_VALUE_INVALID, 'policySetVersion must not be empty');
  }
  const versionScope = versionKeyScope(key);
  if (
    !sameScope(envelope.scopeRef, versionScope) ||
    !sameScope(envelope.targetRef?.scope, versionScope)
  ) {
    throw new CommandExecutionError(
      SCOPE_MISMATCH,
      'envelope scopeRef and targetRef must carry the exact Scope of payload.policyRef',
    );
  }
  const policySchemaRefs = (
    Array.isArray(payload.policySchemaRefs) ? payload.policySchemaRefs : []
  ) as CanonicalJsonValue[];
  const supersedes =
    payload.supersedesRef === undefined ? null : readPolicyVersionKey(payload.supersedesRef);
  if (payload.supersedesRef !== undefined && supersedes === null) {
    throw new CommandExecutionError(
      IDENTITY_POLICY_SUPERSEDE_INVALID,
      'supersedesRef must be a canonical scoped Policy version key',
    );
  }
  const policyVersionFactId =
    typeof envelope.targetRef?.objectId === 'string' ? envelope.targetRef.objectId : '';
  const commandId = typeof envelope.commandId === 'string' ? envelope.commandId : '';
  const idempotencyKey = typeof envelope.idempotencyKey === 'string' ? envelope.idempotencyKey : '';
  const correlationId = typeof envelope.correlationId === 'string' ? envelope.correlationId : '';

  try {
    // Contract, Scope and current authorization precede the idempotency claim
    // (shared API §5.3 steps 1-3): an unauthorized request must not claim the
    // key, and an existing Receipt must never bypass the current check.
    const authorizationError = await withIdentityTransaction(deps.db, deps.context, async (trx) => {
      if (!scopeWithinContext(key, deps.context)) {
        await appendDeniedAudit(deps, trx, {
          commandType: RECORD_POLICY_VERSION_COMMAND,
          errorCode: IDENTITY_POLICY_VERSION_UNKNOWN,
          internalReason: 'scope-mismatch',
          projectId: null,
          requestHash,
          targetId: policyVersionFactId,
        });
        return IDENTITY_POLICY_VERSION_UNKNOWN;
      }
      const referenceError = await presentedReferenceError(deps, trx, {
        decisionRef: envelope.authorizationDecisionRef,
        actorRef: envelope.actor,
        scope: versionScope,
      });
      if (referenceError !== null) {
        await appendDeniedAudit(deps, trx, {
          commandType: RECORD_POLICY_VERSION_COMMAND,
          errorCode: referenceError,
          internalReason: 'reference-binding',
          projectId: key.projectId ?? null,
          requestHash,
          targetId: policyVersionFactId,
        });
        return referenceError;
      }
      const failure = await currentAuthorizationError(deps, trx, {
        commandType: RECORD_POLICY_VERSION_COMMAND,
        purpose: RECORD_POLICY_VERSION_PURPOSE,
        key,
        payloadHash: requestHash,
        now: new Date(),
      });
      if (failure === null) {
        return null;
      }
      await appendDeniedAudit(deps, trx, {
        commandType: RECORD_POLICY_VERSION_COMMAND,
        errorCode: failure,
        internalReason: 'authorization',
        projectId: key.projectId ?? null,
        requestHash,
        targetId: policyVersionFactId,
      });
      return failure;
    });
    if (authorizationError !== null) {
      return rejected(
        authorizationError,
        authorizationError === IDENTITY_POLICY_VERSION_UNKNOWN
          ? 'policy version scope is not in the authorized scope'
          : 'the pinned authorization decision does not cover this command',
      );
    }
    return await executeIdentityCommand(
      deps.db,
      deps.context,
      {
        commandId,
        commandType: RECORD_POLICY_VERSION_COMMAND,
        commandVersion: '1.0',
        idempotencyScope: 'identity_policy:record_policy_version',
        idempotencyKey,
        requestPayload: payload,
        platform: false,
        enterpriseId: key.enterpriseId,
        ...(key.projectId === undefined ? {} : { projectId: key.projectId }),
        targetType: 'PolicyVersion',
        targetId: policyVersionFactId,
        correlationId,
        principalId: deps.context.principalId,
        actorSnapshotId: deps.context.actorSnapshotId,
        authorizationDecisionId: deps.context.authorizationDecisionId,
      },
      async (execution) => {
        // Defense in depth for the write itself: the fact is only appended
        // while the exact Decision and its covering grant are still current.
        const stale = await currentAuthorizationError(deps, execution.trx, {
          commandType: RECORD_POLICY_VERSION_COMMAND,
          purpose: RECORD_POLICY_VERSION_PURPOSE,
          key,
          payloadHash: requestHash,
          now: new Date(),
        });
        if (stale !== null) {
          return {
            kind: 'REJECTED',
            errorCode: stale,
            safeSummary: 'the pinned authorization decision does not cover this command',
          };
        }
        if (
          supersedes !== null &&
          (supersedes.objectId !== key.objectId ||
            supersedes.scopeKind !== key.scopeKind ||
            supersedes.enterpriseId !== key.enterpriseId ||
            supersedes.projectId !== key.projectId ||
            supersedes.versionId === key.versionId)
        ) {
          return {
            kind: 'REJECTED',
            errorCode: IDENTITY_POLICY_SUPERSEDE_INVALID,
            safeSummary:
              'supersedesRef must reference another version of the same Policy identity and Scope',
          };
        }
        if (
          policySchemaRefs.length === 0 ||
          !policySchemaRefs.every(
            (schemaRef) =>
              registeredPolicySchemaKey(POLICY_PROFILE_REGISTRY_VERSION, schemaRef) !== undefined,
          )
        ) {
          return {
            kind: 'REJECTED',
            errorCode: IDENTITY_POLICY_VERSION_UNKNOWN,
            safeSummary: `policySchemaRefs must be registered canonical entries of ${POLICY_PROFILE_REGISTRY_VERSION}`,
          };
        }
        const existing = await deps.repo.getPolicyVersionByKey(execution.trx, {
          policyObjectId: key.objectId,
          policyKeyVersionId: key.versionId,
          enterpriseId: key.enterpriseId,
          projectId: key.projectId ?? null,
        });
        if (existing) {
          return {
            kind: 'REJECTED',
            errorCode: IDENTITY_POLICY_VERSION_ALREADY_BOUND,
            safeSummary: 'the policy version key is already bound to a committed fact',
          };
        }
        if (supersedes !== null) {
          const predecessor = await deps.repo.getPolicyVersionByKey(execution.trx, {
            policyObjectId: supersedes.objectId,
            policyKeyVersionId: supersedes.versionId,
            enterpriseId: supersedes.enterpriseId,
            projectId: supersedes.projectId ?? null,
          });
          if (predecessor === undefined) {
            return {
              kind: 'REJECTED',
              errorCode: IDENTITY_POLICY_SUPERSEDE_INVALID,
              safeSummary: 'superseded version is not a committed version of the same policy',
            };
          }
          if (predecessor.effective_from.getTime() >= effectiveFrom.getTime()) {
            return {
              kind: 'REJECTED',
              errorCode: IDENTITY_POLICY_SUPERSEDE_INVALID,
              safeSummary: 'superseded version must be effective strictly earlier',
            };
          }
          const successor = await deps.repo.getPolicyVersionSuccessor(execution.trx, {
            supersedesObjectId: predecessor.policy_object_id,
            supersedesVersionId: predecessor.policy_key_version_id,
            enterpriseId: predecessor.enterprise_id,
            projectId: predecessor.project_id ?? null,
          });
          if (successor) {
            return {
              kind: 'REJECTED',
              errorCode: IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED,
              safeSummary: 'the superseded version already has a committed successor',
            };
          }
        }
        const inserted = await insertPolicyVersionGuarded(execution.trx, (trx) =>
          deps.repo.insertPolicyVersion(trx, {
            policyVersionFactId,
            policyObjectId: key.objectId,
            policyKeyVersionId: key.versionId,
            scopeKind: key.scopeKind,
            enterpriseId: key.enterpriseId,
            ...(key.projectId === undefined ? {} : { projectId: key.projectId }),
            ...(supersedes === null
              ? {}
              : { supersedes: { objectId: supersedes.objectId, versionId: supersedes.versionId } }),
            payload,
            policySetVersion,
            policySchemaRefs,
            effectiveFrom,
            schemaRegistryVersion: POLICY_PROFILE_REGISTRY_VERSION,
            contractVersion: '1.0',
            createdByPrincipalId: deps.context.principalId,
            actorSnapshotId: deps.context.actorSnapshotId,
            sourceCommandId: commandId,
            dataClassification: 'INTERNAL',
          }),
        );
        if ('errorCode' in inserted) {
          return {
            kind: 'REJECTED',
            errorCode: inserted.errorCode,
            safeSummary: inserted.safeSummary,
          };
        }
        const resultPayload: CanonicalJsonObject = {
          policyVersionRef: canonicalVersionFactReference(
            policyVersionFactId,
            key,
            inserted.digest.hash,
          ),
        };
        // Result validation happens before the owning transaction commits: a
        // failed check must roll back the fact instead of leaving a success
        // Receipt for a result the registered contract rejects.
        const resultViolation = resultContractViolation(
          contracts,
          RECORD_POLICY_VERSION_COMMAND,
          resultPayload,
        );
        if (resultViolation !== null) {
          throw new CommandExecutionError(
            resultViolation,
            'record_policy_version result does not satisfy its registered contract',
          );
        }
        return { kind: 'COMMITTED', resultPayload };
      },
    );
  } catch (error) {
    if (error instanceof CommandExecutionError || !isDependencyUnavailable(error)) {
      throw error;
    }
    throw new CommandExecutionError(
      DEPENDENCY_UNAVAILABLE,
      'policy version storage is unavailable',
    );
  }
}

export interface ResolvePolicyInput {
  /** Complete registered `identity.resolve_policy@1.0` Query Envelope. */
  envelope: unknown;
  /**
   * Trusted server time used for the lifecycle observation. The Envelope's
   * optional caller-provided `asOf` is never used as trusted time.
   */
  asOf: Date;
}

export interface PolicyVersionResolutionView {
  policyRef: Common.VersionedRef;
  policyVersionRef: Common.SnapshotRef;
  policySetVersion: string;
  policySchemaRefs: Common.TypedReference[];
  policyDocument: CanonicalJson;
  contentHash: Common.ContentHash;
  scopeRef: Common.ScopeRef;
  effectiveFrom: Common.UtcInstant;
  supersededAt?: Common.UtcInstant;
  useStatus: 'USABLE' | 'NOT_YET_EFFECTIVE' | 'SUPERSEDED' | 'REVOKED';
  checkedAt: Common.UtcInstant;
}

/**
 * `identity.resolve_policy@1.0`: authoritative read of one exact version key.
 * Returns the committed observation, the canonical document and its content
 * hash, checked against the registered result contract; never resolves
 * latest/current and never falls back to another version of the same
 * objectId. Storage failure fails closed instead of returning an empty or
 * default policy.
 */
export async function resolvePolicy(
  deps: IdentityCommandDeps,
  input: ResolvePolicyInput,
): Promise<PolicyVersionResolutionView> {
  const envelope = (input.envelope ?? {}) as RegisteredQueryEnvelope;
  const contracts = contractRegistry(deps);
  const contractViolation = requestContractViolation(
    contracts,
    RESOLVE_POLICY_COMMAND,
    input.envelope,
  );
  if (contractViolation !== null) {
    throw new SnapshotBoundaryError(
      contractViolation,
      'resolve_policy request does not satisfy its registered contract',
    );
  }
  if (!(input.asOf instanceof Date) || Number.isNaN(input.asOf.getTime())) {
    throw new SnapshotBoundaryError(API_VALUE_INVALID, 'resolution time is invalid');
  }
  const payload = envelope.payload as CanonicalJsonObject;
  const requestHash = digestCanonicalPayload(payload).hash;
  const key = readPolicyVersionKey(payload.policyRef);
  if (key === null) {
    throw new SnapshotBoundaryError(
      IDENTITY_POLICY_VERSION_UNKNOWN,
      'policy version key is not resolvable',
    );
  }
  if (!sameScope(envelope.scopeRef, versionKeyScope(key))) {
    throw new SnapshotBoundaryError(
      SCOPE_MISMATCH,
      'envelope scopeRef must carry the exact Scope of payload.policyRef',
    );
  }
  const inScope = scopeWithinContext(key, deps.context);
  try {
    const outcome = await withIdentityTransaction(deps.db, deps.context, async (trx) => {
      const failure = async (
        errorCode: string,
        internalReason: string,
        targetId: string | null,
      ) => {
        await appendDeniedAudit(deps, trx, {
          commandType: RESOLVE_POLICY_COMMAND,
          errorCode,
          internalReason,
          projectId: inScope ? (key.projectId ?? null) : null,
          requestHash,
          targetId,
        });
        return { kind: 'FAILED' as const, errorCode };
      };
      if (!inScope) {
        return failure(IDENTITY_POLICY_VERSION_UNKNOWN, 'scope-mismatch', null);
      }
      const referenceError = await presentedReferenceError(deps, trx, {
        decisionRef: envelope.authorizationDecisionRef,
        actorRef: envelope.requester,
        scope: versionKeyScope(key),
      });
      if (referenceError !== null) {
        return failure(referenceError, 'reference-binding', null);
      }
      const authorizationError = await currentAuthorizationError(deps, trx, {
        commandType: RESOLVE_POLICY_COMMAND,
        purpose: RESOLVE_POLICY_PURPOSE,
        key,
        payloadHash: requestHash,
        now: input.asOf,
      });
      if (authorizationError !== null) {
        return failure(authorizationError, 'authorization', null);
      }
      const row = await deps.repo.getPolicyVersionByKey(trx, {
        policyObjectId: key.objectId,
        policyKeyVersionId: key.versionId,
        enterpriseId: key.enterpriseId,
        projectId: key.projectId ?? null,
      });
      if (row === undefined) {
        return failure(IDENTITY_POLICY_VERSION_UNKNOWN, 'unknown-or-unbound-version', null);
      }
      if (!policyVersionIntegrityHolds(row)) {
        return failure(IDENTITY_POLICY_SNAPSHOT_INVALID, 'integrity', row.policy_version_fact_id);
      }
      const storedPayload = row.canonical_payload as CanonicalJsonObject;
      const storedSchemaRefs = Array.isArray(storedPayload.policySchemaRefs)
        ? storedPayload.policySchemaRefs
        : [];
      if (
        storedSchemaRefs.length === 0 ||
        !storedSchemaRefs.every(
          (schemaRef) =>
            registeredPolicySchemaKey(row.schema_registry_version, schemaRef) !== undefined,
        )
      ) {
        return failure(IDENTITY_POLICY_SNAPSHOT_INVALID, 'integrity', row.policy_version_fact_id);
      }
      const successor = await deps.repo.getPolicyVersionSuccessor(trx, {
        supersedesObjectId: row.policy_object_id,
        supersedesVersionId: row.policy_key_version_id,
        enterpriseId: row.enterprise_id,
        projectId: row.project_id ?? null,
      });
      const scope = versionKeyScope(key);
      const hash = contentHash(row.payload_hash);
      const useStatus =
        row.effective_from > input.asOf
          ? ('NOT_YET_EFFECTIVE' as const)
          : successor !== undefined && successor.effective_from <= input.asOf
            ? ('SUPERSEDED' as const)
            : ('USABLE' as const);
      const view: PolicyVersionResolutionView = {
        policyRef: versionKeyReference(key),
        policyVersionRef: {
          kind: 'SNAPSHOT',
          objectType: POLICY_VERSION_OBJECT_TYPE,
          objectId: row.policy_version_fact_id,
          snapshotId: row.policy_version_fact_id,
          scope,
          contentHash: hash,
        },
        policySetVersion: row.policy_set_version,
        policySchemaRefs: storedSchemaRefs as Common.TypedReference[],
        policyDocument: storedPayload.policyDocument as CanonicalJson,
        contentHash: hash,
        scopeRef: scope,
        effectiveFrom: row.effective_from.toISOString(),
        ...(successor === undefined
          ? {}
          : { supersededAt: successor.effective_from.toISOString() }),
        useStatus,
        checkedAt: input.asOf.toISOString(),
      };
      const resultViolation = resultContractViolation(contracts, RESOLVE_POLICY_COMMAND, view);
      if (resultViolation !== null) {
        return failure(resultViolation, 'result-contract', row.policy_version_fact_id);
      }
      return { kind: 'RESOLVED' as const, view };
    });
    if (outcome.kind === 'FAILED') {
      throw new SnapshotBoundaryError(outcome.errorCode, 'policy version is not resolvable');
    }
    return outcome.view;
  } catch (error) {
    if (error instanceof SnapshotBoundaryError || !isDependencyUnavailable(error)) {
      throw error;
    }
    throw new SnapshotBoundaryError(
      DEPENDENCY_UNAVAILABLE,
      'policy version storage is unavailable',
    );
  }
}
