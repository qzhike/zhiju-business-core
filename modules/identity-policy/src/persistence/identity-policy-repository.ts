// IM-02 WI-05 (issue #33): low-level IdentityPolicy repository. Pure
// persistence boundary — no business rules, no HTTP, no migration logic.
// Business command handlers (WI-07+) build on these primitives inside the
// owning-module transaction. Sensitive external identifiers enter only
// through the crypto ports and leave only as keyed hashes / ciphertext
// metadata; raw values never appear in rows, results or error messages.

import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import { digestCanonicalPayload, type IdentityTransaction } from './identity-db.js';
import type { IdentityCryptoPorts } from './ports.js';

/** Stable error codes surfaced by the repository (safe, no raw payloads). */
export const IDENTITY_EXTERNAL_LINK_CONFLICT = 'IDENTITY_EXTERNAL_LINK_CONFLICT';
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
  displayHint?: string;
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
  projectId?: string;
  validFrom: Date;
  validTo?: Date;
  justification: string;
  createdByPrincipalId: string;
  createdByActorSnapshotId: string;
}

export interface RevocationInsert {
  revocationId: string;
  targetId: string;
  enterpriseId: string;
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

export interface ActorSnapshotInsert {
  actorSnapshotId: string;
  principalId: string;
  principalKind: 'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY';
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
  async insertExternalIdentityLink(trx: IdentityTransaction, input: ExternalIdentityInput) {
    const provider = input.providerCode.trim().toLowerCase();
    const accountHash = this.crypto.lookupHash.computeKeyedLookupHash(
      `${provider}:${input.accountExternalId.trim().toLowerCase()}`,
    );
    const subjectHash = this.crypto.lookupHash.computeKeyedLookupHash(
      `${provider}:${input.subjectExternalId.trim().toLowerCase()}`,
    );
    const accountCipher = this.crypto.fieldEncryption.encryptField(input.accountExternalId);
    const subjectCipher = this.crypto.fieldEncryption.encryptField(input.subjectExternalId);
    try {
      await trx
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
        .returning('id')
        .executeTakeFirstOrThrow();
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        // Never include the raw identifiers or hashes in the message.
        throw new IdentityPersistenceError(
          IDENTITY_EXTERNAL_LINK_CONFLICT,
          'external identity is already linked to another principal; the existing mapping is kept',
        );
      }
      throw error;
    }
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
        enterprise_id: insert.enterpriseId,
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
      maxUses?: number;
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
  ) {
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
        enterprise_id: insert.enterpriseId,
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

  async getPolicySnapshotById(trx: IdentityTransaction, id: string) {
    return trx
      .selectFrom('identity_policy.policy_snapshot')
      .selectAll()
      .where('policy_snapshot_id', '=', id)
      .executeTakeFirst();
  }

  // -- actor snapshot --------------------------------------------------------

  async insertActorSnapshot(trx: IdentityTransaction, insert: ActorSnapshotInsert) {
    const payload: Record<string, CanonicalJsonObject[string]> = {
      principalId: insert.principalId,
      principalKind: insert.principalKind,
      enterpriseId: insert.enterpriseId,
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
    validatePromotedMirror(payload, {
      principalKind: insert.principalKind,
      enterpriseId: insert.enterpriseId,
    });
    const digest = digestCanonicalPayload(payload);
    await trx
      .insertInto('identity_policy.actor_snapshot')
      .values({
        actor_snapshot_id: insert.actorSnapshotId,
        principal_id: insert.principalId,
        principal_kind: insert.principalKind,
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
    const payload: CanonicalJsonObject = {
      authorizationDecisionId: insert.authorizationDecisionId,
      actorSnapshotId: insert.actorSnapshotId,
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
    validatePromotedMirror(payload, {
      outcome: insert.outcome,
      enterpriseId: insert.enterpriseId,
      commandType: insert.commandType,
    });
    const digest = digestCanonicalPayload(payload);
    await trx
      .insertInto('identity_policy.authorization_decision')
      .values({
        authorization_decision_id: insert.authorizationDecisionId,
        actor_snapshot_id: insert.actorSnapshotId,
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
