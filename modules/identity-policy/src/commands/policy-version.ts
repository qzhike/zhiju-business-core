// IM-06 (#186): the IdentityPolicy-owned PolicyVersion fact handlers.
//
// `identity.record_policy_version@1.0` binds one Policy version key
// (`VersionedRef<Policy>`) to exactly one committed, immutable scoped fact and
// optionally declares the unique supersede edge to an earlier version of the
// same policy identity; `identity.resolve_policy@1.0` returns the exact
// observation (ref, canonical document, content hash, Scope, lifecycle) of a
// version key without resolving latest/current.
//
// Every entry revalidates the AuthorizationDecision the trusted transaction
// context pins: exact hash, command type/version, scope, purpose, request
// payload hash, expiry and the *current* covering grant, so a revoked grant or
// a Decision issued for another purpose cannot pass an owning handler. A
// failed resolution writes the same masked, in-scope Audit as the write side
// instead of leaking the existence of another Scope's fact.

import { newUuidV7, type CanonicalJsonObject, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import { POLICY_PROFILE_REGISTRY_VERSION, type CanonicalJson, type Common } from '@zhiju/contracts';
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

/** Shared API reason codes reused by the owning authorization boundary. */
export const AUTHORIZATION_DECISION_INVALID = 'AUTHORIZATION_DECISION_INVALID';
export const AUTHORIZATION_EXPIRED = 'AUTHORIZATION_EXPIRED';
export const AUTHORIZATION_REVOKED = 'AUTHORIZATION_REVOKED';
export const DEPENDENCY_UNAVAILABLE = 'DEPENDENCY_UNAVAILABLE';

/** Exact registered identities of the two operations (Spec 001 §13.3). */
export const RECORD_POLICY_VERSION_COMMAND = 'identity.record_policy_version';
export const RESOLVE_POLICY_COMMAND = 'identity.resolve_policy';
export const RECORD_POLICY_VERSION_PURPOSE = 'identity.policy.record_policy_version';
export const RESOLVE_POLICY_PURPOSE = 'identity.policy.resolve_policy';
export const POLICY_OBJECT_TYPE = 'zhiju.identity.policy';
export const POLICY_VERSION_OBJECT_TYPE = 'zhiju.identity.policy_version';

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const canonicalInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

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
 * `{enterpriseId, projectId?}` Scope. Anything else is not a version key and
 * is reported with the caller's failure code.
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
  const scope = (candidate as { scope?: unknown }).scope as
    { enterpriseId?: unknown; projectId?: unknown } | null | undefined;
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

/**
 * The canonical payload form of the Policy version key. Canonical JSON has no
 * index signature for the typed reference interfaces, so the payload members
 * are built as plain JSON values here and stay byte-identical to the request
 * the caller hashes into its AuthorizationDecision intent.
 */
function canonicalVersionKey(key: PolicyVersionKey): CanonicalJsonObject {
  return {
    kind: 'VERSIONED',
    objectType: POLICY_OBJECT_TYPE,
    objectId: key.objectId,
    versionId: key.versionId,
    scope:
      key.projectId === undefined
        ? { enterpriseId: key.enterpriseId }
        : { enterpriseId: key.enterpriseId, projectId: key.projectId },
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
 * precision (`YYYY-MM-DDTHH:mm:ss[.SSS]Z`, ≤ 24 code points). Sub-millisecond
 * input is rejected, never truncated or silently rounded.
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
              errorCode: IDENTITY_POLICY_SNAPSHOT_INVALID,
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
  /** Envelope targetRef objectId: the new fact identity, never regenerated. */
  policyVersionFactId: string;
  policyRef: unknown;
  policySetVersion: unknown;
  policySchemaRefs: unknown;
  policyDocument: unknown;
  effectiveFrom: unknown;
  supersedesRef?: unknown;
  idempotencyKey: string;
}

/**
 * `identity.record_policy_version@1.0`: one immutable scoped version fact per
 * version key, with the shared Receipt/Audit in the same owning transaction.
 * Replaying the same idempotency key and payload returns the original result;
 * the same key with a different payload is the shared idempotency conflict.
 */
export async function recordPolicyVersion(
  deps: IdentityCommandDeps,
  input: RecordPolicyVersionInput,
): Promise<CommandResult> {
  const key = readPolicyVersionKey(input.policyRef);
  if (key === null) {
    return rejected(
      IDENTITY_POLICY_SNAPSHOT_INVALID,
      'policyRef must be a canonical scoped Policy version key',
    );
  }
  const effectiveFromInstant = typeof input.effectiveFrom === 'string' ? input.effectiveFrom : '';
  const effectiveFrom = parseCanonicalInstant(effectiveFromInstant);
  if (effectiveFrom === null) {
    return rejected(
      IDENTITY_POLICY_SNAPSHOT_INVALID,
      'effectiveFrom must be a canonical UTC instant with at most millisecond precision',
    );
  }
  const policySetVersion = typeof input.policySetVersion === 'string' ? input.policySetVersion : '';
  if (policySetVersion.trim() === '') {
    return rejected(IDENTITY_POLICY_SNAPSHOT_INVALID, 'policySetVersion must not be empty');
  }
  if (!uuidV7Pattern.test(input.policyVersionFactId)) {
    return rejected(
      IDENTITY_POLICY_SNAPSHOT_INVALID,
      'policyVersionFactId must be a UuidV7 fact identity',
    );
  }
  if (
    !Array.isArray(input.policySchemaRefs) ||
    input.policySchemaRefs.length === 0 ||
    !input.policySchemaRefs.every(
      (schemaRef) =>
        registeredPolicySchemaKey(POLICY_PROFILE_REGISTRY_VERSION, schemaRef) !== undefined,
    )
  ) {
    return rejected(
      IDENTITY_POLICY_VERSION_UNKNOWN,
      `policySchemaRefs must be registered canonical entries of ${POLICY_PROFILE_REGISTRY_VERSION}`,
    );
  }
  const supersedes =
    input.supersedesRef === undefined ? null : readPolicyVersionKey(input.supersedesRef);
  if (input.supersedesRef !== undefined && supersedes === null) {
    return rejected(
      IDENTITY_POLICY_SUPERSEDE_INVALID,
      'supersedesRef must be a canonical scoped Policy version key',
    );
  }
  if (
    supersedes !== null &&
    (supersedes.objectId !== key.objectId ||
      supersedes.scopeKind !== key.scopeKind ||
      supersedes.enterpriseId !== key.enterpriseId ||
      supersedes.projectId !== key.projectId ||
      supersedes.versionId === key.versionId)
  ) {
    return rejected(
      IDENTITY_POLICY_SUPERSEDE_INVALID,
      'supersedesRef must reference another version of the same Policy identity and Scope',
    );
  }

  const policySchemaRefs = (
    Array.isArray(input.policySchemaRefs) ? input.policySchemaRefs : []
  ) as CanonicalJsonValue[];
  const requestPayload: CanonicalJsonObject = {
    policyRef: canonicalVersionKey(key),
    policySetVersion,
    policySchemaRefs,
    policyDocument: input.policyDocument as CanonicalJsonValue,
    effectiveFrom: effectiveFromInstant,
    ...(supersedes === null ? {} : { supersedesRef: canonicalVersionKey(supersedes) }),
  };
  const requestHash = digestCanonicalPayload(requestPayload).hash;
  const commandId = newUuidV7();
  // An unverified Project never enters the Command envelope or the RLS write
  // Scope: the owning handler rejects the request scope before any write.
  const projectId =
    key.projectId !== undefined && deps.context.allowedProjectIds.includes(key.projectId)
      ? key.projectId
      : undefined;

  try {
    return await executeIdentityCommand(
      deps.db,
      deps.context,
      {
        commandId,
        commandType: RECORD_POLICY_VERSION_COMMAND,
        commandVersion: '1.0',
        idempotencyScope: 'identity_policy:record_policy_version',
        idempotencyKey: input.idempotencyKey,
        requestPayload,
        platform: false,
        enterpriseId: deps.context.enterpriseId,
        ...(projectId === undefined ? {} : { projectId }),
        targetType: 'PolicyVersion',
        targetId: input.policyVersionFactId,
        correlationId: deps.context.correlationId,
        principalId: deps.context.principalId,
        actorSnapshotId: deps.context.actorSnapshotId,
        authorizationDecisionId: deps.context.authorizationDecisionId,
      },
      async (execution) => {
        // Scope containment precedes every write: an out-of-authorization
        // Scope collapses to the shared unavailable code, and the receipt /
        // audit only record the trusted Context Scope.
        if (!scopeWithinContext(key, deps.context)) {
          return {
            kind: 'REJECTED',
            errorCode: IDENTITY_POLICY_VERSION_UNKNOWN,
            safeSummary: 'policy version scope is not in the authorized scope',
          };
        }
        const authorizationError = await currentAuthorizationError(deps, execution.trx, {
          commandType: RECORD_POLICY_VERSION_COMMAND,
          purpose: RECORD_POLICY_VERSION_PURPOSE,
          key,
          payloadHash: requestHash,
          now: new Date(),
        });
        if (authorizationError !== null) {
          return {
            kind: 'REJECTED',
            errorCode: authorizationError,
            safeSummary: 'the pinned authorization decision does not cover this command',
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
            policyVersionFactId: input.policyVersionFactId,
            policyObjectId: key.objectId,
            policyKeyVersionId: key.versionId,
            scopeKind: key.scopeKind,
            enterpriseId: key.enterpriseId,
            ...(key.projectId === undefined ? {} : { projectId: key.projectId }),
            ...(supersedes === null
              ? {}
              : { supersedes: { objectId: supersedes.objectId, versionId: supersedes.versionId } }),
            payload: requestPayload,
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
        return {
          kind: 'COMMITTED',
          resultPayload: {
            policyVersionRef: canonicalVersionFactReference(
              input.policyVersionFactId,
              key,
              inserted.digest.hash,
            ),
          },
        };
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
  policyRef: unknown;
  /** Trusted server time used for the lifecycle observation. */
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
 * Masked, in-scope audit for a failed resolution: the external result stays
 * the unified unavailable code while the internal classification (unknown
 * identity/version, not bound, scope mismatch, integrity) is only visible
 * here, together with hashes and no document content.
 */
async function appendResolutionAudit(
  deps: IdentityCommandDeps,
  trx: IdentityTransaction,
  input: {
    errorCode: string;
    internalReason: string;
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
      command_type: RESOLVE_POLICY_COMMAND,
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

/**
 * `identity.resolve_policy@1.0`: authoritative read of one exact version key.
 * Returns the committed observation, the canonical document and its content
 * hash; never resolves latest/current and never falls back to another version
 * of the same objectId. Storage failure fails closed instead of returning an
 * empty or default policy.
 */
export async function resolvePolicy(
  deps: IdentityCommandDeps,
  input: ResolvePolicyInput,
): Promise<PolicyVersionResolutionView> {
  const key = readPolicyVersionKey(input.policyRef);
  if (key === null || !(input.asOf instanceof Date) || Number.isNaN(input.asOf.getTime())) {
    throw new SnapshotBoundaryError(
      IDENTITY_POLICY_VERSION_UNKNOWN,
      'policy version key is not resolvable',
    );
  }
  const requestHash = digestCanonicalPayload({ policyRef: canonicalVersionKey(key) }).hash;
  const inScope = scopeWithinContext(key, deps.context);
  try {
    const outcome = await withIdentityTransaction(deps.db, deps.context, async (trx) => {
      const failure = async (
        errorCode: string,
        internalReason: string,
        targetId: string | null,
      ) => {
        await appendResolutionAudit(deps, trx, {
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
      const payload = row.canonical_payload as CanonicalJsonObject;
      const storedSchemaRefs = Array.isArray(payload.policySchemaRefs)
        ? payload.policySchemaRefs
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
        policyDocument: payload.policyDocument as CanonicalJson,
        contentHash: hash,
        scopeRef: scope,
        effectiveFrom: row.effective_from.toISOString(),
        ...(successor === undefined
          ? {}
          : { supersededAt: successor.effective_from.toISOString() }),
        useStatus,
        checkedAt: input.asOf.toISOString(),
      };
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
