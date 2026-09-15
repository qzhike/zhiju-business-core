// IM-02 WI-05 (issue #33): low-level IdentityPolicy repository. Pure
// persistence boundary — no business rules, no HTTP, no migration logic.
// Business command handlers (WI-07+) build on these primitives inside the
// owning-module transaction. Sensitive external identifiers enter only
// through the crypto ports and leave only as keyed hashes / ciphertext
// metadata; raw values never appear in rows, results or error messages.

import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Selectable } from 'kysely';
import {
  digestCanonicalPayload,
  type AuthorizationDecisionTable,
  type IdentityTransaction,
  type PolicyVersionTable,
  type SelectedCapabilityGrant,
  type SelectedPolicySnapshot,
} from './identity-db.js';
import type { IdentityCryptoPorts } from './ports.js';

/** Stable error codes surfaced by the repository (safe, no raw payloads). */
export const IDENTITY_EXTERNAL_LINK_CONFLICT = 'IDENTITY_EXTERNAL_LINK_CONFLICT';
export const IDENTITY_SENSITIVE_EXTERNAL_IDENTIFIER_FORBIDDEN =
  'IDENTITY_SENSITIVE_EXTERNAL_IDENTIFIER_FORBIDDEN';
export const IDENTITY_PAYLOAD_HASH_MISMATCH = 'IDENTITY_PAYLOAD_HASH_MISMATCH';
export const IDENTITY_PROMOTED_MIRROR_MISMATCH = 'IDENTITY_PROMOTED_MIRROR_MISMATCH';

export class IdentityPersistenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IdentityPersistenceError';
  }
}

export interface PrincipalInsert {
  id: string;
  principalKind: 'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY';
  displayName: string;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
}

export interface PrincipalStateTransitionInsert {
  transitionId: string;
  principalId: string;
  fromStatus: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'ARCHIVED';
  toStatus: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'ARCHIVED';
  reasonCode: string;
  actorSnapshotId: string;
  sourceCommandId: string;
}

export interface ExternalIdentityInput {
  id: string;
  providerCode: string;
  /** Sensitive: raw account / subject external identifiers, never persisted. */
  accountExternalId: string;
  subjectExternalId: string;
  displayHint?: string | undefined;
  principalId: string;
  verifiedAt: Date;
  verificationMethod: string;
  evidenceRefs: CanonicalJsonObject;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
}

/** The safe view of a stored external identity link. */
export interface ExternalIdentityLinkView {
  id: string;
  providerCode: string;
  accountLookupHash: Buffer;
  externalIdLookupHash: Buffer;
  lookupHashAlgorithm: string;
  lookupKeyVersion: number;
  accountCiphertextKeyVersion: number;
  subjectCiphertextKeyVersion: number;
  encryptionAlgorithm: string;
  displayHint: string | null;
  principalId: string;
  status: 'ACTIVE' | 'REVOKED';
}

export interface ScopedAssignmentInsert {
  id: string;
  principalId: string;
  code: string;
  scopeKind: 'ENTERPRISE' | 'PROJECT';
  enterpriseId: string;
  projectId?: string | undefined;
  validFrom: Date;
  validTo?: Date | undefined;
  justification: string;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
}

export interface RevocationInsert {
  revocationId: string;
  targetId: string;
  scopeKind: 'ENTERPRISE' | 'PROJECT';
  enterpriseId: string;
  projectId?: string | undefined;
  revokedByPrincipalId: string;
  reasonCode: string;
  effectiveAt: Date;
  actorSnapshotId: string;
  sourceCommandId: string;
}

export interface PolicySnapshotInsert {
  policySnapshotId: string;
  policySetVersion: string;
  policySchemaRefs: string[];
  effectiveFrom: Date;
  contractVersion: string;
  schemaRegistryVersion: string;
  /** The canonical policy document; must embed policySetVersion/effectiveFrom. */
  policyDocument: CanonicalJsonObject;
  createdByPrincipalId: string;
  actorSnapshotId: string;
  sourceCommandId: string;
  dataClassification: string;
}

export interface PolicyVersionInsert {
  policyVersionFactId: string;
  policyObjectId: string;
  policyKeyVersionId: string;
  scopeKind: 'ENTERPRISE' | 'PROJECT';
  enterpriseId: string;
  projectId?: string | undefined;
  /** Present only for a real supersede edge to an earlier committed version. */
  supersedes?: { objectId: string; versionId: string } | undefined;
  /** Exact payload of `identity.record_policy_version@1.0`. */
  payload: CanonicalJsonObject;
  policySetVersion: string;
  policySchemaRefs: unknown[];
  effectiveFrom: Date;
  schemaRegistryVersion: string;
  contractVersion: string;
  createdByPrincipalId: string;
  actorSnapshotId: string;
  sourceCommandId: string;
  dataClassification: string;
}

export interface ActorSnapshotInsert {
  actorSnapshotId: string;
  principalId: string;
  principalKind: 'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY';
  scopeKind: 'ENTERPRISE' | 'PROJECT';
  actingForPrincipalId?: string;
  actingForKind?: 'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY';
  channelCode?: string;
  runtimeSource?: string;
  authenticationContextHash: Buffer;
  enterpriseId: string;
  projectId?: string;
  contractVersion: string;
  /** Snapshot body; must embed principalKind / enterpriseId. */
  snapshotPayload: CanonicalJsonObject;
  createdByPrincipalId: string;
  sourceCommandId: string;
}

export interface AuthorizationDecisionInsert {
  authorizationDecisionId: string;
  actorSnapshotId: string;
  actorSnapshotPayloadHash: Buffer;
  principalId: string;
  principalKind: 'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY';
  outcome: 'ALLOW' | 'DENY';
  reasonCodes: string[];
  commandType: string;
  commandVersion: string;
  scopeKind: 'ENTERPRISE' | 'PROJECT';
  enterpriseId: string;
  projectId?: string;
  purpose: string;
  requestedCapability: string;
  commandPayloadHash: Buffer;
  policySnapshotId: string;
  policySnapshotPayloadHash: Buffer;
  authenticationContextHash: Buffer;
  expiresAt: Date;
  contractVersion: string;
  /** Decision body; must embed outcome / enterpriseId / commandType. */
  decisionPayload: CanonicalJsonObject;
  /**
   * IM-06 (#200) exact CREATE target of a version-bound creation decision.
   * When present the canonical payload carries `targetRef` with the same
   * object type/id and the decision's own Project Scope, and the promoted
   * `target_object_type` / `target_object_id` columns mirror it.
   */
  targetRef?: { readonly objectType: string; readonly objectId: string } | undefined;
  createdByPrincipalId: string;
  sourceCommandId: string;
}

function expectString(value: unknown, field: string): string {
  return typeof value === 'string' ? value : throwMirrorMismatch(field);
}

function throwMirrorMismatch(field: string): never {
  throw new IdentityPersistenceError(
    IDENTITY_PROMOTED_MIRROR_MISMATCH,
    `canonical payload is missing promoted field ${field}`,
  );
}

/**
 * Repository-level promoted-mirror validation. The database additionally
 * guards the same mirrors with triggers; the repository check keeps the
 * failure inside the owning transaction with a stable code and no partial
 * writes.
 */
export function validatePromotedMirror(
  payload: CanonicalJsonObject,
  promoted: Readonly<Record<string, unknown>>,
): void {
  for (const [field, expected] of Object.entries(promoted)) {
    const actual = payload[field];
    if (expected instanceof Date) {
      if (new Date(expectString(actual, field)).getTime() !== expected.getTime()) {
        throw new IdentityPersistenceError(
          IDENTITY_PROMOTED_MIRROR_MISMATCH,
          `canonical payload ${field} does not match promoted column`,
        );
      }
      continue;
    }
    const actualText = expectString(actual, field);
    if (actualText !== String(expected)) {
      throw new IdentityPersistenceError(
        IDENTITY_PROMOTED_MIRROR_MISMATCH,
        `canonical payload ${field} does not match promoted column`,
      );
    }
  }
}

/** Rejects a caller-declared hash that disagrees with the canonical bytes. */
export function assertHashMatches(
  digest: { hash: Buffer; canonicalJson: string },
  expectedHash?: Buffer,
): void {
  if (expectedHash !== undefined && !digest.hash.equals(expectedHash)) {
    throw new IdentityPersistenceError(
      IDENTITY_PAYLOAD_HASH_MISMATCH,
      'declared payload hash does not match the canonical payload',
    );
  }
}

function payloadMember(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return throwMirrorMismatch(field);
  }
  return value as Record<string, unknown>;
}

/** Structural JSON equality; object members compare without key order. */
function jsonMembersEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => jsonMembersEqual(item, right[index]))
    );
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  const leftMembers = left as Record<string, unknown>;
  const rightMembers = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftMembers);
  return (
    leftKeys.length === Object.keys(rightMembers).length &&
    leftKeys.every(
      (key) => key in rightMembers && jsonMembersEqual(leftMembers[key], rightMembers[key]),
    )
  );
}

/**
 * Promoted-mirror validation for the scoped PolicyVersion fact (#186): every
 * promoted column must be present in the canonical payload with the same
 * value. The database trigger re-checks the same mirrors; this check keeps the
 * failure inside the owning transaction with a stable error and no partial
 * write.
 */
function validatePolicyVersionMirror(
  payload: CanonicalJsonObject,
  promoted: {
    policyObjectId: string;
    policyKeyVersionId: string;
    enterpriseId: string;
    projectId: string | null;
    supersedes?: { objectId: string; versionId: string } | undefined;
    policySetVersion: string;
    policySchemaRefs: unknown[];
    effectiveFrom: Date;
  },
): void {
  const policyRef = payloadMember(payload.policyRef, 'policyRef.objectId');
  const scope = payloadMember(policyRef.scope, 'policyRef.scope.enterpriseId');
  if (policyRef.objectId !== promoted.policyObjectId) {
    throwMirrorMismatch('policyRef.objectId');
  }
  if (policyRef.versionId !== promoted.policyKeyVersionId) {
    throwMirrorMismatch('policyRef.versionId');
  }
  if (scope.enterpriseId !== promoted.enterpriseId) {
    throwMirrorMismatch('policyRef.scope.enterpriseId');
  }
  if ((scope.projectId ?? null) !== promoted.projectId) {
    throwMirrorMismatch('policyRef.scope.projectId');
  }
  if (promoted.supersedes === undefined) {
    if (payload.supersedesRef !== undefined) {
      throwMirrorMismatch('supersedesRef');
    }
  } else {
    const edge = payloadMember(payload.supersedesRef, 'supersedesRef.objectId');
    if (edge.objectId !== promoted.supersedes.objectId) {
      throwMirrorMismatch('supersedesRef.objectId');
    }
    if (edge.versionId !== promoted.supersedes.versionId) {
      throwMirrorMismatch('supersedesRef.versionId');
    }
  }
  if (payload.policySetVersion !== promoted.policySetVersion) {
    throwMirrorMismatch('policySetVersion');
  }
  if (!jsonMembersEqual(payload.policySchemaRefs, promoted.policySchemaRefs)) {
    throwMirrorMismatch('policySchemaRefs');
  }
  const effectiveFrom = payload.effectiveFrom;
  if (
    typeof effectiveFrom !== 'string' ||
    new Date(effectiveFrom).getTime() !== promoted.effectiveFrom.getTime()
  ) {
    throwMirrorMismatch('effectiveFrom');
  }
}

/**
 * Promoted-mirror validation for one AuthorizationDecision payload (read
 * side). It mirrors what the owning write path and the database guard
 * enforce at insert time, plus the IM-06 target binding: a payload without
 * `targetRef` requires both target columns to be NULL, and a payload with
 * `targetRef` requires both columns set to exactly the payload object
 * type/id and the Decision's own Scope.
 */
function validateAuthorizationDecisionMirror(
  payload: CanonicalJsonObject,
  promoted: {
    outcome: string;
    enterpriseId: string;
    commandType: string;
    actorSnapshotId: string;
    actorSnapshotPayloadHash: string;
    policySnapshotId: string;
    policySnapshotPayloadHash: string;
    principalId: string;
    principalKind: string;
    commandVersion: string;
    scopeKind: string;
    projectId: string | null;
    purpose: string;
    requestedCapability: string;
    commandPayloadHash: string;
    authenticationContextHash: string;
    expiresAt: Date;
    targetObjectType: string | null;
    targetObjectId: string | null;
  },
): void {
  for (const [field, expected] of [
    ['outcome', promoted.outcome],
    ['enterpriseId', promoted.enterpriseId],
    ['commandType', promoted.commandType],
    ['actorSnapshotId', promoted.actorSnapshotId],
    ['actorSnapshotPayloadHash', promoted.actorSnapshotPayloadHash],
    ['policySnapshotId', promoted.policySnapshotId],
    ['policySnapshotPayloadHash', promoted.policySnapshotPayloadHash],
    ['principalId', promoted.principalId],
    ['principalKind', promoted.principalKind],
    ['commandVersion', promoted.commandVersion],
    ['scopeKind', promoted.scopeKind],
    ['purpose', promoted.purpose],
    ['requestedCapability', promoted.requestedCapability],
    ['commandPayloadHash', promoted.commandPayloadHash],
    ['authenticationContextHash', promoted.authenticationContextHash],
  ] as const) {
    if (payload[field] !== expected) {
      throwMirrorMismatch(field);
    }
  }
  if ((payload.projectId ?? null) !== promoted.projectId) {
    throwMirrorMismatch('projectId');
  }
  const expiresAt = payload.expiresAt;
  if (
    typeof expiresAt !== 'string' ||
    new Date(expiresAt).getTime() !== promoted.expiresAt.getTime()
  ) {
    throwMirrorMismatch('expiresAt');
  }
  if (promoted.targetObjectType === null || promoted.targetObjectId === null) {
    if (promoted.targetObjectType !== null || promoted.targetObjectId !== null) {
      throwMirrorMismatch('targetRef');
    }
    if (payload.targetRef !== undefined) {
      throwMirrorMismatch('targetRef');
    }
    return;
  }
  const target = payloadMember(payload.targetRef, 'targetRef.objectType');
  const scope = payloadMember(target.scope, 'targetRef.scope.enterpriseId');
  if (
    target.objectType !== promoted.targetObjectType ||
    target.objectId !== promoted.targetObjectId ||
    scope.enterpriseId !== promoted.enterpriseId ||
    (scope.projectId ?? null) !== promoted.projectId
  ) {
    throwMirrorMismatch('targetRef');
  }
}

/**
 * Read-side integrity boundary for a committed AuthorizationDecision: the
 * canonical payload must still hash to the stored payload hash, algorithm,
 * canonicalization version and size, and the promoted columns — including the
 * IM-06 target binding — must mirror it. A row rewritten outside the owning
 * boundary, for example an owner statement that moves `target_object_id`
 * together with `canonical_payload.targetRef` while keeping the old hash,
 * fails here instead of being served as a Decision.
 */
export function authorizationDecisionIntegrityHolds(
  row: Selectable<AuthorizationDecisionTable>,
): boolean {
  const payload = row.canonical_payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const digest = digestCanonicalPayload(payload as CanonicalJsonObject);
  if (
    !digest.hash.equals(row.payload_hash) ||
    digest.hashAlgorithm !== row.payload_hash_algorithm ||
    digest.canonicalizationVersion !== row.canonicalization_version ||
    digest.sizeBytes !== Number(row.payload_size_bytes)
  ) {
    return false;
  }
  try {
    validateAuthorizationDecisionMirror(payload as CanonicalJsonObject, {
      outcome: row.outcome,
      enterpriseId: row.enterprise_id,
      commandType: row.command_type,
      actorSnapshotId: row.actor_snapshot_id,
      actorSnapshotPayloadHash: row.actor_snapshot_payload_hash.toString('hex'),
      policySnapshotId: row.policy_snapshot_id,
      policySnapshotPayloadHash: row.policy_snapshot_payload_hash.toString('hex'),
      principalId: row.principal_id,
      principalKind: row.principal_kind,
      commandVersion: row.command_version,
      scopeKind: row.scope_kind,
      projectId: row.project_id,
      purpose: row.purpose,
      requestedCapability: row.requested_capability,
      commandPayloadHash: row.command_payload_hash.toString('hex'),
      authenticationContextHash: row.authentication_context_hash.toString('hex'),
      expiresAt: row.expires_at,
      targetObjectType: row.target_object_type,
      targetObjectId: row.target_object_id,
    });
  } catch {
    return false;
  }
  return true;
}

/**
 * Read-side integrity boundary for a committed PolicySnapshot: the canonical
 * payload must still hash to the stored payload hash, algorithm,
 * canonicalization version and size, and the mirrored policy identity columns
 * must match it. The owning write path and the database guard keep these
 * consistent, so a Snapshot whose document was rewritten outside the owning
 * boundary is refused instead of authorizing a Grant.
 */
export function policySnapshotIntegrityHolds(row: SelectedPolicySnapshot): boolean {
  const payload = row.canonical_payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const digest = digestCanonicalPayload(payload as CanonicalJsonObject);
  if (
    !digest.hash.equals(row.payload_hash) ||
    digest.hashAlgorithm !== row.payload_hash_algorithm ||
    digest.canonicalizationVersion !== row.canonicalization_version ||
    digest.sizeBytes !== Number(row.payload_size_bytes)
  ) {
    return false;
  }
  const document = payload as CanonicalJsonObject;
  if (document.policySetVersion !== row.policy_set_version) {
    return false;
  }
  const effectiveFrom = document.effectiveFrom;
  if (
    typeof effectiveFrom !== 'string' ||
    new Date(effectiveFrom).getTime() !== row.effective_from.getTime()
  ) {
    return false;
  }
  return jsonMembersEqual(document.policySchemaRefs, row.policy_schema_refs);
}

/**
 * Read-side integrity boundary for a committed PolicyVersion fact: the
 * canonical payload must still hash to the stored payload hash, the promoted
 * columns must mirror it, and the Scope shape must be well formed. A row
 * rewritten outside the owning handler (direct SQL) fails here instead of
 * being served as a version fact.
 */
export function policyVersionIntegrityHolds(row: Selectable<PolicyVersionTable>): boolean {
  const payload = row.canonical_payload;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const digest = digestCanonicalPayload(payload as CanonicalJsonObject);
  if (
    !digest.hash.equals(row.payload_hash) ||
    digest.hashAlgorithm !== row.payload_hash_algorithm ||
    digest.canonicalizationVersion !== row.canonicalization_version
  ) {
    return false;
  }
  const projectId = row.project_id ?? null;
  if (
    (row.scope_kind === 'ENTERPRISE' && projectId !== null) ||
    (row.scope_kind === 'PROJECT' && projectId === null)
  ) {
    return false;
  }
  try {
    validatePolicyVersionMirror(payload as CanonicalJsonObject, {
      policyObjectId: row.policy_object_id,
      policyKeyVersionId: row.policy_key_version_id,
      enterpriseId: row.enterprise_id,
      projectId,
      ...(row.supersedes_object_id === null || row.supersedes_version_id === null
        ? {}
        : {
            supersedes: {
              objectId: row.supersedes_object_id,
              versionId: row.supersedes_version_id,
            },
          }),
      policySetVersion: row.policy_set_version,
      policySchemaRefs: Array.isArray(row.policy_schema_refs) ? row.policy_schema_refs : [],
      effectiveFrom: row.effective_from,
    });
  } catch {
    return false;
  }
  return true;
}

export class IdentityPolicyRepository {
  constructor(private readonly crypto: IdentityCryptoPorts) {}

  // -- principal -----------------------------------------------------------

  async insertPrincipal(trx: IdentityTransaction, insert: PrincipalInsert) {
    await trx
      .insertInto('identity_policy.principal')
      .values({
        id: insert.id,
        principal_kind: insert.principalKind,
        status: 'ACTIVE',
        display_name: insert.displayName,
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
      })
      .execute();
  }

  async getPrincipalById(trx: IdentityTransaction, id: string) {
    return trx
      .selectFrom('identity_policy.principal')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async insertPrincipalStateTransition(
    trx: IdentityTransaction,
    insert: PrincipalStateTransitionInsert,
  ) {
    await trx
      .insertInto('identity_policy.principal_state_transition')
      .values({
        transition_id: insert.transitionId,
        principal_id: insert.principalId,
        from_status: insert.fromStatus,
        to_status: insert.toStatus,
        reason_code: insert.reasonCode,
        actor_snapshot_id: insert.actorSnapshotId,
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  // -- external identity link ----------------------------------------------

  /**
   * Persists one external identity link. Lookup hashes are keyed via
   * LookupHashPort; the raw account/subject values are envelope-encrypted
   * via FieldEncryptionPort and never stored, returned or logged in clear.
   */
  async insertExternalIdentityLink(
    trx: IdentityTransaction,
    input: ExternalIdentityInput,
  ): Promise<boolean> {
    assertExternalIdentityMetadataSafe(input);
    const provider = input.providerCode.trim().toLowerCase();
    const accountHash = this.crypto.lookupHash.computeKeyedLookupHash(
      `${provider}:${input.accountExternalId.trim().toLowerCase()}`,
    );
    const subjectHash = this.crypto.lookupHash.computeKeyedLookupHash(
      `${provider}:${input.subjectExternalId.trim().toLowerCase()}`,
    );
    const accountCipher = this.crypto.fieldEncryption.encryptField(input.accountExternalId);
    const subjectCipher = this.crypto.fieldEncryption.encryptField(input.subjectExternalId);
    const inserted = await trx
      .insertInto('identity_policy.external_identity_link')
      .values({
        id: input.id,
        provider_code: provider,
        account_lookup_hash: accountHash.hash,
        external_id_lookup_hash: subjectHash.hash,
        lookup_hash_algorithm: accountHash.algorithm,
        lookup_key_version: accountHash.keyVersion,
        account_ciphertext: accountCipher.ciphertext,
        account_ciphertext_algorithm: accountCipher.algorithm,
        account_ciphertext_key_version: accountCipher.keyVersion,
        subject_ciphertext: subjectCipher.ciphertext,
        subject_ciphertext_algorithm: subjectCipher.algorithm,
        subject_ciphertext_key_version: subjectCipher.keyVersion,
        display_hint: input.displayHint ?? null,
        principal_id: input.principalId,
        verified_at: input.verifiedAt,
        verification_method: input.verificationMethod,
        evidence_refs: JSON.stringify(input.evidenceRefs),
        created_by_principal_id: input.createdByPrincipalId,
        created_by_actor_snapshot_id: input.createdByActorSnapshotId,
      })
      .onConflict((conflict) => conflict.constraint('external_link_lookup_unique').doNothing())
      .returning('id')
      .executeTakeFirst();

    // ON CONFLICT DO NOTHING keeps the transaction live so the command
    // runner can persist the stable conflict receipt and audit row.
    return inserted !== undefined;
  }

  /** Resolves the active link for provider+account+subject keyed hashes. */
  async findExternalIdentityLinkByLookup(
    trx: IdentityTransaction,
    providerCode: string,
    accountExternalId: string,
    subjectExternalId: string,
  ): Promise<ExternalIdentityLinkView | undefined> {
    const provider = providerCode.trim().toLowerCase();
    const accountHash = this.crypto.lookupHash.computeKeyedLookupHash(
      `${provider}:${accountExternalId.trim().toLowerCase()}`,
    );
    const subjectHash = this.crypto.lookupHash.computeKeyedLookupHash(
      `${provider}:${subjectExternalId.trim().toLowerCase()}`,
    );
    const row = await trx
      .selectFrom('identity_policy.external_identity_link')
      .selectAll()
      .where('provider_code', '=', provider)
      .where('account_lookup_hash', '=', accountHash.hash)
      .where('external_id_lookup_hash', '=', subjectHash.hash)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    return row ? toExternalLinkView(row) : undefined;
  }

  // -- role assignment / revocation -----------------------------------------

  async insertRoleAssignment(trx: IdentityTransaction, insert: ScopedAssignmentInsert) {
    await trx
      .insertInto('identity_policy.role_assignment')
      .values({
        id: insert.id,
        principal_id: insert.principalId,
        role_code: insert.code,
        scope_kind: insert.scopeKind,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId ?? null,
        valid_from: insert.validFrom,
        valid_to: insert.validTo ?? null,
        justification: insert.justification,
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
      })
      .execute();
  }

  async listActiveRoleAssignments(
    trx: IdentityTransaction,
    principalId: string,
    enterpriseId: string,
    asOf: Date,
  ) {
    return trx
      .selectFrom('identity_policy.role_assignment')
      .selectAll()
      .where('principal_id', '=', principalId)
      .where('enterprise_id', '=', enterpriseId)
      .where('status', '=', 'ACTIVE')
      .where('valid_from', '<=', asOf)
      .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', asOf)]))
      .execute();
  }

  async getRoleAssignmentById(trx: IdentityTransaction, id: string) {
    return trx
      .selectFrom('identity_policy.role_assignment')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async markRoleAssignmentRevoked(trx: IdentityTransaction, id: string, sourceCommandId: string) {
    await trx
      .updateTable('identity_policy.role_assignment')
      .set({ status: 'REVOKED', updated_at: new Date(), last_command_id: sourceCommandId })
      .where('id', '=', id)
      .execute();
  }

  async insertRoleRevocation(trx: IdentityTransaction, insert: RevocationInsert) {
    await trx
      .insertInto('identity_policy.role_revocation')
      .values({
        revocation_id: insert.revocationId,
        role_assignment_id: insert.targetId,
        scope_kind: insert.scopeKind,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId ?? null,
        revoked_by_principal_id: insert.revokedByPrincipalId,
        reason_code: insert.reasonCode,
        effective_at: insert.effectiveAt,
        actor_snapshot_id: insert.actorSnapshotId,
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  // -- capability grant / revocation ----------------------------------------

  async insertCapabilityGrant(
    trx: IdentityTransaction,
    insert: ScopedAssignmentInsert & {
      resourceSelectors: CanonicalJsonObject[];
      actions: string[];
      maxUses?: number | undefined;
      grantPolicySnapshotId: string;
      grantPolicySnapshotHash: Buffer;
    },
  ) {
    await trx
      .insertInto('identity_policy.capability_grant')
      .values({
        id: insert.id,
        principal_id: insert.principalId,
        capability_code: insert.code,
        scope_kind: insert.scopeKind,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId ?? null,
        resource_selectors: JSON.stringify(insert.resourceSelectors),
        actions: insert.actions,
        valid_from: insert.validFrom,
        valid_to: insert.validTo ?? null,
        max_uses: insert.maxUses ?? null,
        grant_policy_snapshot_id: insert.grantPolicySnapshotId,
        grant_policy_snapshot_hash: insert.grantPolicySnapshotHash,
        justification: insert.justification,
        created_by_principal_id: insert.createdByPrincipalId,
        created_by_actor_snapshot_id: insert.createdByActorSnapshotId,
      })
      .execute();
  }

  async listActiveCapabilityGrants(
    trx: IdentityTransaction,
    principalId: string,
    enterpriseId: string,
    asOf: Date,
  ): Promise<SelectedCapabilityGrant[]> {
    return trx
      .selectFrom('identity_policy.capability_grant')
      .selectAll()
      .where('principal_id', '=', principalId)
      .where('enterprise_id', '=', enterpriseId)
      .where('status', '=', 'ACTIVE')
      .where('valid_from', '<=', asOf)
      .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', asOf)]))
      .execute();
  }

  async getCapabilityGrantById(trx: IdentityTransaction, id: string) {
    return trx
      .selectFrom('identity_policy.capability_grant')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async markCapabilityGrantRevoked(trx: IdentityTransaction, id: string, sourceCommandId: string) {
    await trx
      .updateTable('identity_policy.capability_grant')
      .set({ status: 'REVOKED', updated_at: new Date(), last_command_id: sourceCommandId })
      .where('id', '=', id)
      .execute();
  }

  async insertCapabilityRevocation(trx: IdentityTransaction, insert: RevocationInsert) {
    await trx
      .insertInto('identity_policy.capability_revocation')
      .values({
        revocation_id: insert.revocationId,
        capability_grant_id: insert.targetId,
        scope_kind: insert.scopeKind,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId ?? null,
        revoked_by_principal_id: insert.revokedByPrincipalId,
        reason_code: insert.reasonCode,
        effective_at: insert.effectiveAt,
        actor_snapshot_id: insert.actorSnapshotId,
        source_command_id: insert.sourceCommandId,
      })
      .execute();
  }

  // -- policy snapshot -------------------------------------------------------

  async insertPolicySnapshot(trx: IdentityTransaction, insert: PolicySnapshotInsert) {
    const payload: CanonicalJsonObject = {
      policySetVersion: insert.policySetVersion,
      effectiveFrom: insert.effectiveFrom.toISOString(),
      policySchemaRefs: insert.policySchemaRefs,
      policyDocument: insert.policyDocument,
    };
    validatePromotedMirror(payload, {
      policySetVersion: insert.policySetVersion,
      effectiveFrom: insert.effectiveFrom,
    });
    const digest = digestCanonicalPayload(payload);
    await trx
      .insertInto('identity_policy.policy_snapshot')
      .values({
        policy_snapshot_id: insert.policySnapshotId,
        policy_set_version: insert.policySetVersion,
        policy_schema_refs: JSON.stringify(insert.policySchemaRefs),
        effective_from: insert.effectiveFrom,
        contract_type: 'identity.PolicySnapshot',
        contract_version: insert.contractVersion,
        schema_registry_version: insert.schemaRegistryVersion,
        canonicalization_version: digest.canonicalizationVersion,
        payload_hash_algorithm: digest.hashAlgorithm,
        payload_hash: digest.hash,
        payload_size_bytes: digest.sizeBytes,
        canonical_payload: digest.canonicalJson,
        created_by_principal_id: insert.createdByPrincipalId,
        actor_snapshot_id: insert.actorSnapshotId,
        source_command_id: insert.sourceCommandId,
        data_classification: insert.dataClassification,
        retention_class: 'REGULATED_AUDIT',
      })
      .execute();
  }

  async getPolicySnapshotByIdAndHash(
    trx: IdentityTransaction,
    id: string,
    expectedHash: Buffer,
  ): Promise<
    | {
        row: Awaited<ReturnType<IdentityPolicyRepository['getPolicySnapshotById']>>;
        hashMatched: boolean;
      }
    | undefined
  > {
    const row = await this.getPolicySnapshotById(trx, id);
    if (!row) {
      return undefined;
    }
    return { row, hashMatched: row.payload_hash.equals(expectedHash) };
  }

  async getPolicySnapshotById(
    trx: IdentityTransaction,
    id: string,
  ): Promise<SelectedPolicySnapshot | undefined> {
    return trx
      .selectFrom('identity_policy.policy_snapshot')
      .selectAll()
      .where('policy_snapshot_id', '=', id)
      .executeTakeFirst();
  }

  // -- policy version (#186) -------------------------------------------------

  /**
   * Appends one immutable scoped PolicyVersion fact. The promoted columns must
   * mirror the canonical payload exactly; the database trigger re-checks the
   * same mirrors. Version-binding and supersede-edge uniqueness is adjudicated
   * by the database (`policy_version_binding_unique` /
   * `policy_version_supersede_unique`); the handler converts those conflicts
   * into stable module errors instead of leaking `23505`.
   */
  async insertPolicyVersion(trx: IdentityTransaction, insert: PolicyVersionInsert) {
    const projectId = insert.projectId ?? null;
    validatePolicyVersionMirror(insert.payload, {
      policyObjectId: insert.policyObjectId,
      policyKeyVersionId: insert.policyKeyVersionId,
      enterpriseId: insert.enterpriseId,
      projectId,
      supersedes: insert.supersedes,
      policySetVersion: insert.policySetVersion,
      policySchemaRefs: insert.policySchemaRefs,
      effectiveFrom: insert.effectiveFrom,
    });
    const digest = digestCanonicalPayload(insert.payload);
    await trx
      .insertInto('identity_policy.policy_version')
      .values({
        policy_version_fact_id: insert.policyVersionFactId,
        policy_object_id: insert.policyObjectId,
        policy_key_version_id: insert.policyKeyVersionId,
        scope_kind: insert.scopeKind,
        enterprise_id: insert.enterpriseId,
        project_id: projectId,
        supersedes_object_id: insert.supersedes?.objectId ?? null,
        supersedes_version_id: insert.supersedes?.versionId ?? null,
        policy_set_version: insert.policySetVersion,
        policy_schema_refs: JSON.stringify(insert.policySchemaRefs),
        effective_from: insert.effectiveFrom,
        contract_type: 'identity.PolicyVersion',
        contract_version: insert.contractVersion,
        schema_registry_version: insert.schemaRegistryVersion,
        canonicalization_version: digest.canonicalizationVersion,
        payload_hash_algorithm: digest.hashAlgorithm,
        payload_hash: digest.hash,
        payload_size_bytes: digest.sizeBytes,
        canonical_payload: digest.canonicalJson,
        created_by_principal_id: insert.createdByPrincipalId,
        actor_snapshot_id: insert.actorSnapshotId,
        source_command_id: insert.sourceCommandId,
        data_classification: insert.dataClassification,
        retention_class: 'CUSTOMER_RECORD',
      })
      .execute();
    return digest;
  }

  /** The committed version fact bound to one Policy version key, if any. */
  async getPolicyVersionByKey(
    trx: IdentityTransaction,
    key: {
      policyObjectId: string;
      policyKeyVersionId: string;
      enterpriseId: string;
      projectId: string | null;
    },
  ) {
    return trx
      .selectFrom('identity_policy.policy_version')
      .selectAll()
      .where('policy_object_id', '=', key.policyObjectId)
      .where('policy_key_version_id', '=', key.policyKeyVersionId)
      .where('enterprise_id', '=', key.enterpriseId)
      .where((eb) =>
        key.projectId === null
          ? eb('project_id', 'is', null)
          : eb('project_id', '=', key.projectId),
      )
      .executeTakeFirst();
  }

  /**
   * The successor fact of a predecessor version, read through the unique
   * supersede edge. Its `effective_from` is the only source of the
   * predecessor's derived `supersededAt`.
   */
  async getPolicyVersionSuccessor(
    trx: IdentityTransaction,
    edge: {
      supersedesObjectId: string;
      supersedesVersionId: string;
      enterpriseId: string;
      projectId: string | null;
    },
  ) {
    return trx
      .selectFrom('identity_policy.policy_version')
      .selectAll()
      .where('supersedes_object_id', '=', edge.supersedesObjectId)
      .where('supersedes_version_id', '=', edge.supersedesVersionId)
      .where('enterprise_id', '=', edge.enterpriseId)
      .where((eb) =>
        edge.projectId === null
          ? eb('project_id', 'is', null)
          : eb('project_id', '=', edge.projectId),
      )
      .executeTakeFirst();
  }

  // -- actor snapshot --------------------------------------------------------

  async insertActorSnapshot(trx: IdentityTransaction, insert: ActorSnapshotInsert) {
    validatePromotedMirror(insert.snapshotPayload, {
      principalKind: insert.principalKind,
      enterpriseId: insert.enterpriseId,
    });
    const payload: Record<string, CanonicalJsonObject[string]> = {
      ...insert.snapshotPayload,
      principalId: insert.principalId,
      principalKind: insert.principalKind,
      scopeKind: insert.scopeKind,
      enterpriseId: insert.enterpriseId,
      authenticationContextHash: insert.authenticationContextHash.toString('hex'),
    };
    if (insert.projectId !== undefined) {
      payload.projectId = insert.projectId;
    }
    if (insert.actingForPrincipalId !== undefined && insert.actingForKind !== undefined) {
      payload.actingFor = {
        principalId: insert.actingForPrincipalId,
        principalKind: insert.actingForKind,
      };
    }
    if (insert.channelCode !== undefined) {
      payload.channelCode = insert.channelCode;
    }
    if (insert.runtimeSource !== undefined) {
      payload.runtimeSource = insert.runtimeSource;
    }
    const digest = digestCanonicalPayload(payload);
    await trx
      .insertInto('identity_policy.actor_snapshot')
      .values({
        actor_snapshot_id: insert.actorSnapshotId,
        principal_id: insert.principalId,
        principal_kind: insert.principalKind,
        scope_kind: insert.scopeKind,
        acting_for_principal_id: insert.actingForPrincipalId ?? null,
        acting_for_kind: insert.actingForKind ?? null,
        channel_code: insert.channelCode ?? null,
        runtime_source: insert.runtimeSource ?? null,
        authentication_context_hash: insert.authenticationContextHash,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId ?? null,
        contract_type: 'identity.ActorSnapshot',
        contract_version: insert.contractVersion,
        canonicalization_version: digest.canonicalizationVersion,
        payload_hash_algorithm: digest.hashAlgorithm,
        payload_hash: digest.hash,
        payload_size_bytes: digest.sizeBytes,
        canonical_payload: digest.canonicalJson,
        created_by_principal_id: insert.createdByPrincipalId,
        source_command_id: insert.sourceCommandId,
        retention_class: 'REGULATED_AUDIT',
      })
      .execute();
  }

  async getActorSnapshotByIdAndHash(trx: IdentityTransaction, id: string, expectedHash: Buffer) {
    const row = await trx
      .selectFrom('identity_policy.actor_snapshot')
      .selectAll()
      .where('actor_snapshot_id', '=', id)
      .executeTakeFirst();
    if (!row) {
      return undefined;
    }
    return { row, hashMatched: row.payload_hash.equals(expectedHash) };
  }

  // -- authorization decision -------------------------------------------------

  async insertAuthorizationDecision(trx: IdentityTransaction, insert: AuthorizationDecisionInsert) {
    validatePromotedMirror(insert.decisionPayload, {
      outcome: insert.outcome,
      enterpriseId: insert.enterpriseId,
      commandType: insert.commandType,
    });
    const targetRef = insert.targetRef;
    if (targetRef !== undefined) {
      const payload = insert.decisionPayload.targetRef as
        { objectType?: unknown; objectId?: unknown; scope?: unknown } | null | undefined;
      const scope = payload?.scope as
        { enterpriseId?: unknown; projectId?: unknown } | null | undefined;
      if (
        payload?.objectType !== targetRef.objectType ||
        payload.objectId !== targetRef.objectId ||
        scope?.enterpriseId !== insert.enterpriseId ||
        scope.projectId !== insert.projectId
      ) {
        throw new IdentityPersistenceError(
          IDENTITY_PROMOTED_MIRROR_MISMATCH,
          'canonical payload targetRef does not match the promoted target columns',
        );
      }
    }
    const payload: CanonicalJsonObject = {
      ...insert.decisionPayload,
      authorizationDecisionId: insert.authorizationDecisionId,
      actorSnapshotId: insert.actorSnapshotId,
      actorSnapshotPayloadHash: insert.actorSnapshotPayloadHash.toString('hex'),
      principalId: insert.principalId,
      principalKind: insert.principalKind,
      outcome: insert.outcome,
      reasonCodes: insert.reasonCodes,
      commandType: insert.commandType,
      commandVersion: insert.commandVersion,
      scopeKind: insert.scopeKind,
      enterpriseId: insert.enterpriseId,
      ...(insert.projectId !== undefined ? { projectId: insert.projectId } : {}),
      purpose: insert.purpose,
      requestedCapability: insert.requestedCapability,
      commandPayloadHash: insert.commandPayloadHash.toString('hex'),
      policySnapshotId: insert.policySnapshotId,
      policySnapshotPayloadHash: insert.policySnapshotPayloadHash.toString('hex'),
      authenticationContextHash: insert.authenticationContextHash.toString('hex'),
      expiresAt: insert.expiresAt.toISOString(),
    };
    const digest = digestCanonicalPayload(payload);
    await trx
      .insertInto('identity_policy.authorization_decision')
      .values({
        authorization_decision_id: insert.authorizationDecisionId,
        actor_snapshot_id: insert.actorSnapshotId,
        actor_snapshot_payload_hash: insert.actorSnapshotPayloadHash,
        principal_id: insert.principalId,
        principal_kind: insert.principalKind,
        outcome: insert.outcome,
        reason_codes: insert.reasonCodes,
        command_type: insert.commandType,
        command_version: insert.commandVersion,
        scope_kind: insert.scopeKind,
        enterprise_id: insert.enterpriseId,
        project_id: insert.projectId ?? null,
        purpose: insert.purpose,
        requested_capability: insert.requestedCapability,
        command_payload_hash: insert.commandPayloadHash,
        policy_snapshot_id: insert.policySnapshotId,
        policy_snapshot_payload_hash: insert.policySnapshotPayloadHash,
        authentication_context_hash: insert.authenticationContextHash,
        expires_at: insert.expiresAt,
        target_object_type: targetRef?.objectType ?? null,
        target_object_id: targetRef?.objectId ?? null,
        contract_type: 'identity.AuthorizationDecision',
        contract_version: insert.contractVersion,
        canonicalization_version: digest.canonicalizationVersion,
        payload_hash_algorithm: digest.hashAlgorithm,
        payload_hash: digest.hash,
        payload_size_bytes: digest.sizeBytes,
        canonical_payload: digest.canonicalJson,
        created_by_principal_id: insert.createdByPrincipalId,
        source_command_id: insert.sourceCommandId,
        retention_class: 'REGULATED_AUDIT',
      })
      .execute();
  }

  async getAuthorizationDecisionByIdAndHash(
    trx: IdentityTransaction,
    id: string,
    expectedHash: Buffer,
  ) {
    const row = await trx
      .selectFrom('identity_policy.authorization_decision')
      .selectAll()
      .where('authorization_decision_id', '=', id)
      .executeTakeFirst();
    if (!row) {
      return undefined;
    }
    return { row, hashMatched: row.payload_hash.equals(expectedHash) };
  }
}

function assertExternalIdentityMetadataSafe(input: ExternalIdentityInput): void {
  const account = input.accountExternalId.trim().toLowerCase();
  const subject = input.subjectExternalId.trim().toLowerCase();
  const metadata = JSON.stringify({
    displayHint: input.displayHint ?? null,
    verificationMethod: input.verificationMethod,
    evidenceRefs: input.evidenceRefs,
  }).toLowerCase();
  if (
    account.length === 0 ||
    subject.length === 0 ||
    metadata.includes(account) ||
    metadata.includes(subject)
  ) {
    throw new IdentityPersistenceError(
      IDENTITY_SENSITIVE_EXTERNAL_IDENTIFIER_FORBIDDEN,
      'external identity metadata must not contain raw identifiers',
    );
  }
}

function toExternalLinkView(row: {
  id: string;
  provider_code: string;
  account_lookup_hash: Buffer;
  external_id_lookup_hash: Buffer;
  lookup_hash_algorithm: string;
  lookup_key_version: number;
  account_ciphertext_key_version: number;
  subject_ciphertext_key_version: number;
  account_ciphertext_algorithm: string;
  display_hint: string | null;
  principal_id: string;
  status: 'ACTIVE' | 'REVOKED';
}): ExternalIdentityLinkView {
  return {
    id: row.id,
    providerCode: row.provider_code,
    accountLookupHash: row.account_lookup_hash,
    externalIdLookupHash: row.external_id_lookup_hash,
    lookupHashAlgorithm: row.lookup_hash_algorithm,
    lookupKeyVersion: row.lookup_key_version,
    accountCiphertextKeyVersion: row.account_ciphertext_key_version,
    subjectCiphertextKeyVersion: row.subject_ciphertext_key_version,
    encryptionAlgorithm: row.account_ciphertext_algorithm,
    displayHint: row.display_hint,
    principalId: row.principal_id,
    status: row.status,
  };
}
