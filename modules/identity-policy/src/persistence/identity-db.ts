// IM-02 WI-05 (issue #33): hand-written Kysely types for the identity_policy
// schema (V1000/V1001). Kysely is a SQL builder only — it never owns the
// schema, migrations or domain semantics (Technology-Baseline §3).

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import {
  Kysely,
  PostgresDialect,
  sql,
  type ColumnType,
  type Generated,
  type Selectable,
  type Transaction,
} from 'kysely';
import { canonicalize, type CanonicalJsonObject } from '@zhiju/shared-kernel';

// pg returns int8 as string and jsonb as parsed objects; inserts pass
// JSON strings for jsonb and string|number for bigint. ColumnType keeps
// the runtime truth visible instead of lying to the type system.
type Int8 = ColumnType<string, string | number, string | number>;
// DB-defaulted int8 columns: value optional on insert/update, string on read.
type Int8Default = ColumnType<string, string | number | undefined, string | number | undefined>;
type Json = ColumnType<unknown, string>;

export interface PrincipalTable {
  id: string;
  principal_kind: 'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY';
  status: Generated<'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'ARCHIVED'>;
  aggregate_version: Int8Default;
  display_name: string;
  created_at: Generated<Date>;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  updated_at: Generated<Date>;
  last_command_id?: string | null;
  retention_class: Generated<string>;
}

export interface PrincipalStateTransitionTable {
  transition_id: string;
  principal_id: string;
  from_status: string;
  to_status: string;
  reason_code: string;
  actor_snapshot_id: string;
  source_command_id: string;
  recorded_at: Generated<Date>;
}

export interface ExternalIdentityLinkTable {
  id: string;
  provider_code: string;
  account_lookup_hash: Buffer;
  external_id_lookup_hash: Buffer;
  lookup_hash_algorithm: string;
  lookup_key_version: number;
  account_ciphertext: Buffer;
  account_ciphertext_algorithm: string;
  account_ciphertext_key_version: number;
  subject_ciphertext: Buffer;
  subject_ciphertext_algorithm: string;
  subject_ciphertext_key_version: number;
  display_hint: string | null;
  principal_id: string;
  verified_at: Date;
  verification_method: string;
  evidence_refs: Json;
  status: Generated<'ACTIVE' | 'REVOKED'>;
  aggregate_version: Int8Default;
  created_at: Generated<Date>;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  updated_at: Generated<Date>;
  last_command_id?: string | null;
  retention_class: Generated<string>;
}

export interface RoleAssignmentTable {
  id: string;
  principal_id: string;
  role_code: string;
  scope_kind: 'ENTERPRISE' | 'PROJECT';
  enterprise_id: string;
  project_id: string | null;
  valid_from: Date;
  valid_to: Date | null;
  constraints: Generated<Json>;
  justification: string;
  status: Generated<'ACTIVE' | 'REVOKED'>;
  aggregate_version: Int8Default;
  created_at: Generated<Date>;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  updated_at: Generated<Date>;
  last_command_id?: string | null;
  retention_class: Generated<string>;
}

export interface RoleRevocationTable {
  revocation_id: string;
  role_assignment_id: string;
  scope_kind: 'ENTERPRISE' | 'PROJECT';
  enterprise_id: string;
  project_id: string | null;
  revoked_by_principal_id: string;
  reason_code: string;
  effective_at: Date;
  actor_snapshot_id: string;
  source_command_id: string;
  recorded_at: Generated<Date>;
}

export interface CapabilityGrantTable {
  id: string;
  principal_id: string;
  capability_code: string;
  scope_kind: 'ENTERPRISE' | 'PROJECT';
  enterprise_id: string;
  project_id: string | null;
  resource_selectors: Json;
  actions: string[];
  constraints: Generated<Json>;
  valid_from: Date;
  valid_to: Date | null;
  max_uses: number | null;
  grant_policy_snapshot_id: string;
  grant_policy_snapshot_hash: Buffer;
  justification: string;
  status: Generated<'ACTIVE' | 'REVOKED'>;
  aggregate_version: Int8Default;
  created_at: Generated<Date>;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  updated_at: Generated<Date>;
  last_command_id?: string | null;
  retention_class: Generated<string>;
}

/** One committed capability grant row, as the read paths select it. */
export type SelectedCapabilityGrant = Selectable<CapabilityGrantTable>;

export interface CapabilityRevocationTable {
  revocation_id: string;
  capability_grant_id: string;
  scope_kind: 'ENTERPRISE' | 'PROJECT';
  enterprise_id: string;
  project_id: string | null;
  revoked_by_principal_id: string;
  reason_code: string;
  effective_at: Date;
  actor_snapshot_id: string;
  source_command_id: string;
  recorded_at: Generated<Date>;
}

export interface PolicySnapshotTable {
  policy_snapshot_id: string;
  policy_set_version: string;
  policy_schema_refs: Json;
  effective_from: Date;
  superseded_at?: Date | null;
  contract_type: string;
  contract_version: string;
  schema_registry_version: string;
  canonicalization_version: string;
  payload_hash_algorithm: string;
  payload_hash: Buffer;
  payload_size_bytes: Int8;
  canonical_payload: Json;
  created_at: Generated<Date>;
  created_by_principal_id: string;
  actor_snapshot_id: string;
  source_command_id: string;
  data_classification: string;
  retention_class: string;
}

/** One committed policy snapshot row, as the read paths select it. */
export type SelectedPolicySnapshot = Selectable<PolicySnapshotTable>;

export interface PolicyVersionTable {
  policy_version_fact_id: string;
  policy_object_id: string;
  policy_key_version_id: string;
  scope_kind: 'ENTERPRISE' | 'PROJECT';
  enterprise_id: string;
  project_id: string | null;
  supersedes_object_id: string | null;
  supersedes_version_id: string | null;
  policy_set_version: string;
  policy_schema_refs: Json;
  effective_from: Date;
  contract_type: string;
  contract_version: string;
  schema_registry_version: string;
  canonicalization_version: string;
  payload_hash_algorithm: string;
  payload_hash: Buffer;
  payload_size_bytes: Int8;
  canonical_payload: Json;
  created_at: Generated<Date>;
  created_by_principal_id: string;
  actor_snapshot_id: string;
  source_command_id: string;
  data_classification: string;
  retention_class: string;
}

export interface ActorSnapshotTable {
  actor_snapshot_id: string;
  principal_id: string;
  principal_kind: 'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY';
  scope_kind: 'ENTERPRISE' | 'PROJECT';
  acting_for_principal_id: string | null;
  acting_for_kind: string | null;
  channel_code: string | null;
  runtime_source: string | null;
  authentication_context_hash: Buffer;
  enterprise_id: string;
  project_id: string | null;
  contract_type: string;
  contract_version: string;
  canonicalization_version: string;
  payload_hash_algorithm: string;
  payload_hash: Buffer;
  payload_size_bytes: Int8;
  canonical_payload: Json;
  created_at: Generated<Date>;
  created_by_principal_id: string;
  source_command_id: string;
  retention_class: string;
}

export interface AuthorizationDecisionTable {
  authorization_decision_id: string;
  actor_snapshot_id: string;
  actor_snapshot_payload_hash: Buffer;
  principal_id: string;
  principal_kind: string;
  outcome: 'ALLOW' | 'DENY';
  reason_codes: string[];
  command_type: string;
  command_version: string;
  scope_kind: 'ENTERPRISE' | 'PROJECT';
  enterprise_id: string;
  project_id: string | null;
  purpose: string;
  requested_capability: string;
  command_payload_hash: Buffer;
  policy_snapshot_id: string;
  policy_snapshot_payload_hash: Buffer;
  authentication_context_hash: Buffer;
  expires_at: Date;
  /**
   * IM-06 (#200) target binding mirrors: NULL for history and for decisions
   * issued by the generic port, non-NULL for the four version-bound creation
   * versions, always equal to `canonical_payload.targetRef`.
   */
  target_object_type: string | null;
  target_object_id: string | null;
  contract_type: string;
  contract_version: string;
  canonicalization_version: string;
  payload_hash_algorithm: string;
  payload_hash: Buffer;
  payload_size_bytes: Int8;
  canonical_payload: Json;
  created_at: Generated<Date>;
  created_by_principal_id: string;
  source_command_id: string;
  retention_class: string;
}

export interface CommandReceiptTable {
  command_id: string;
  command_type: string;
  command_version: string;
  idempotency_scope: string;
  idempotency_key: string;
  request_payload_hash: Buffer;
  enterprise_id: string;
  project_id?: string | null;
  target_type: string;
  target_id: string;
  expected_aggregate_version?: string | null;
  outcome: 'PENDING' | 'COMMITTED' | 'REJECTED' | 'DUPLICATE';
  result_payload?: Json;
  result_payload_hash?: Buffer | null;
  first_seen_at: Generated<Date>;
  completed_at?: Date | null;
  correlation_id: string;
  causation_id?: string | null;
  created_by_principal_id: string;
  actor_snapshot_id: string;
  authorization_decision_id: string;
}

export interface OutboxEventTable {
  event_id: string;
  event_type: string;
  event_version: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: string;
  enterprise_id: string;
  project_id?: string | null;
  correlation_id: string;
  causation_id?: string | null;
  payload: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  occurred_at: Date;
  recorded_at: Generated<Date>;
  delivery_state: Generated<'PENDING' | 'LEASED' | 'PUBLISHED' | 'UNKNOWN' | 'DEAD'>;
  available_at: Generated<Date>;
  attempt_count: Generated<number>;
  lease_owner?: string | null;
  lease_until?: Date | null;
  lease_token?: ColumnType<string, string | number> | null;
  last_error_code?: string | null;
  published_at?: Date | null;
  created_by_principal_id: string;
  source_command_id: string;
}

export interface AuditRecordTable {
  audit_id: string;
  enterprise_id: string;
  project_id?: string | null;
  principal_id: string;
  actor_snapshot_id: string;
  authorization_decision_id: string;
  command_id?: string | null;
  command_type?: string | null;
  outcome: 'ALLOWED' | 'DENIED' | 'COMMITTED' | 'REJECTED' | 'INFO';
  error_code?: string | null;
  request_payload_hash?: Buffer | null;
  result_payload_hash?: Buffer | null;
  target_type?: string | null;
  target_id?: string | null;
  target_aggregate_version?: string | null;
  correlation_id: string;
  causation_id?: string | null;
  channel_ref?: Json;
  runtime_ref?: Json;
  break_glass_reason?: string | null;
  approval_ref?: Json;
  safe_summary?: string | null;
  recorded_at: Generated<Date>;
  retention_class: string;
}

export interface ReferenceEdgeTable {
  owner_object_type: string;
  owner_object_id: string;
  owner_version_id?: string | null;
  owner_payload_hash?: Buffer | null;
  reference_path: string;
  target_module: string;
  target_object_type: string;
  target_object_id: string;
  target_version_id?: string | null;
  target_payload_hash?: Buffer | null;
  reference_purpose: string;
  enterprise_id: string;
  project_id?: string | null;
  created_at: Generated<Date>;
  source_command_id: string;
}

export interface PlatformCommandReceiptTable {
  command_id: string;
  command_type: string;
  command_version: string;
  idempotency_scope: string;
  idempotency_key: string;
  request_payload_hash: Buffer;
  target_type: string;
  target_id: string;
  expected_aggregate_version?: string | null;
  outcome: 'PENDING' | 'COMMITTED' | 'REJECTED' | 'DUPLICATE';
  result_payload?: Json;
  result_payload_hash?: Buffer | null;
  first_seen_at: Generated<Date>;
  completed_at?: Date | null;
  correlation_id: string;
  causation_id?: string | null;
  created_by_principal_id: string;
  actor_snapshot_id: string;
  authorization_decision_id: string;
}

export interface PlatformOutboxEventTable {
  event_id: string;
  event_type: string;
  event_version: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: string;
  correlation_id: string;
  causation_id?: string | null;
  payload: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  occurred_at: Date;
  recorded_at: Generated<Date>;
  delivery_state: Generated<'PENDING' | 'LEASED' | 'PUBLISHED' | 'UNKNOWN' | 'DEAD'>;
  available_at: Generated<Date>;
  attempt_count: Generated<number>;
  lease_owner?: string | null;
  lease_until?: Date | null;
  lease_token?: ColumnType<string, string | number> | null;
  last_error_code?: string | null;
  published_at?: Date | null;
  created_by_principal_id: string;
  source_command_id: string;
}

export interface PlatformAuditRecordTable {
  audit_id: string;
  principal_id: string;
  actor_snapshot_id: string;
  authorization_decision_id: string;
  command_id?: string | null;
  command_type?: string | null;
  outcome: 'ALLOWED' | 'DENIED' | 'COMMITTED' | 'REJECTED' | 'INFO';
  error_code?: string | null;
  request_payload_hash?: Buffer | null;
  result_payload_hash?: Buffer | null;
  target_type?: string | null;
  target_id?: string | null;
  correlation_id: string;
  causation_id?: string | null;
  safe_summary?: string | null;
  recorded_at: Generated<Date>;
  retention_class: string;
}

export interface BootstrapClaimTable {
  claim_id: string;
  purpose: string;
  operator_description: string;
  operator_actor_snapshot_id: string;
  operator_authorization_decision_id: string;
  reason: string;
  evidence_refs: Json;
  expires_at: Date;
  consumed_at?: Date | null;
  consumed_by_command_id?: string | null;
  consumed_result?: Json;
  closed_at?: Date | null;
  closed_reason?: string | null;
  created_at: Generated<Date>;
}

export interface InboxMessageTable {
  consumer_name: string;
  event_id: string;
  event_type: string;
  event_version: string;
  payload_hash: Buffer;
  source_module: string;
  enterprise_id: string;
  project_id?: string | null;
  status: 'PENDING' | 'PROCESSED' | 'QUARANTINED' | 'FAILED';
  first_seen_at: Generated<Date>;
  processed_at?: Date | null;
  result_command_id?: string | null;
  failure_code?: string | null;
  safe_error_summary?: string | null;
  correlation_id: string;
  created_by_principal_id: string;
}

export interface ContractViolationTable {
  violation_id: string;
  violation_kind: string;
  contract_type?: string | null;
  contract_version?: string | null;
  enterprise_id: string;
  project_id?: string | null;
  observed_payload_hash?: Buffer | null;
  schema_error_path?: string | null;
  safe_summary?: string | null;
  source_event_id?: string | null;
  consumer_name?: string | null;
  correlation_id?: string | null;
  recorded_at: Generated<Date>;
  created_by_principal_id: string;
}

export interface IdentityPolicyDb {
  'identity_policy.principal': PrincipalTable;
  'identity_policy.principal_state_transition': PrincipalStateTransitionTable;
  'identity_policy.external_identity_link': ExternalIdentityLinkTable;
  'identity_policy.role_assignment': RoleAssignmentTable;
  'identity_policy.role_revocation': RoleRevocationTable;
  'identity_policy.capability_grant': CapabilityGrantTable;
  'identity_policy.capability_revocation': CapabilityRevocationTable;
  'identity_policy.policy_snapshot': PolicySnapshotTable;
  'identity_policy.policy_version': PolicyVersionTable;
  'identity_policy.actor_snapshot': ActorSnapshotTable;
  'identity_policy.authorization_decision': AuthorizationDecisionTable;
  'identity_policy.command_receipt': CommandReceiptTable;
  'identity_policy.outbox_event': OutboxEventTable;
  'identity_policy.audit_record': AuditRecordTable;
  'identity_policy.reference_edge': ReferenceEdgeTable;
  'identity_policy.platform_command_receipt': PlatformCommandReceiptTable;
  'identity_policy.platform_outbox_event': PlatformOutboxEventTable;
  'identity_policy.platform_audit_record': PlatformAuditRecordTable;
  'identity_policy.bootstrap_claim': BootstrapClaimTable;
  'identity_policy.inbox_message': InboxMessageTable;
  'identity_policy.contract_violation': ContractViolationTable;
}

export const CANONICALIZATION_VERSION = '1';
export const PAYLOAD_HASH_ALGORITHM = 'SHA-256';

export interface CanonicalPayloadDigest {
  readonly canonicalJson: string;
  readonly hash: Buffer;
  readonly sizeBytes: number;
  readonly canonicalizationVersion: string;
  readonly hashAlgorithm: string;
}

/** SHA-256 over the shared-kernel canonical JSON (canonicalization v1). */
export function digestCanonicalPayload(payload: CanonicalJsonObject): CanonicalPayloadDigest {
  const canonicalJson = canonicalize(payload);
  return {
    canonicalJson,
    hash: createHash('sha256').update(canonicalJson, 'utf8').digest(),
    sizeBytes: Buffer.byteLength(canonicalJson, 'utf8'),
    canonicalizationVersion: CANONICALIZATION_VERSION,
    hashAlgorithm: PAYLOAD_HASH_ALGORITHM,
  };
}

/**
 * The transaction-scoped RLS context from WI-03, established by the trusted
 * application path right after BEGIN inside the same transaction.
 */
export interface IdentityTransactionContext {
  readonly kind: 'REQUEST' | 'EVENT_CONSUMER';
  readonly principalId: string;
  readonly actorSnapshotId: string;
  readonly authorizationDecisionId: string;
  readonly authorizationDecisionHash: Buffer;
  readonly authorizationDecisionExpiresAt: Date;
  readonly enterpriseId: string;
  readonly allowedProjectIds: readonly string[];
  readonly correlationId: string;
  readonly sourceEventId?: string;
}

export type IdentityTransaction = Transaction<IdentityPolicyDb>;

/** Creates the Kysely SQL builder over an application-owned pg pool. */
export function createIdentityPolicyDatabase(pool: Pool): Kysely<IdentityPolicyDb> {
  return new Kysely<IdentityPolicyDb>({ dialect: new PostgresDialect({ pool }) });
}

/**
 * Runs `fn` in one transaction on a single connection, establishing the
 * WI-03 RLS context first. The context lives and dies with the transaction:
 * commit, rollback or an error leaves nothing for the pooled connection's
 * next borrower.
 */
export async function withIdentityTransaction<T>(
  db: Kysely<IdentityPolicyDb>,
  context: IdentityTransactionContext,
  fn: (trx: IdentityTransaction) => Promise<T>,
): Promise<T> {
  return db.connection().execute(async (connection) =>
    connection.transaction().execute(async (trx) => {
      await sql.raw('SET LOCAL ROLE platform_context_establisher').execute(trx);
      await sql`SELECT platform_security.establish_transaction_context(
          ${context.kind},
          ${context.principalId},
          ${context.actorSnapshotId},
          ${context.authorizationDecisionId},
          ${context.authorizationDecisionHash},
          ${context.authorizationDecisionExpiresAt},
          ${context.enterpriseId},
          ${[...context.allowedProjectIds]},
          ${context.correlationId},
          ${context.sourceEventId ?? null})`.execute(trx);
      await sql.raw('SET LOCAL ROLE identity_policy_app').execute(trx);
      return fn(trx);
    }),
  );
}
