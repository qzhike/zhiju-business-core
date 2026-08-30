// IM-05 WI-06 (issue #126): ReleasePublication-owned business and technical
// table types. Cross-module facts remain public typed references in JSON.

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import {
  Kysely,
  PostgresDialect,
  sql,
  type ColumnType,
  type Generated,
  type Transaction,
} from 'kysely';
import { canonicalize, type CanonicalJsonObject } from '@zhiju/shared-kernel';

type Int8 = ColumnType<string, string | number, string | number>;
type Int8Default = ColumnType<string, string | number | undefined, string | number | undefined>;
type Json = ColumnType<unknown, string, string>;

export interface CommandReceiptTable {
  command_id: string;
  command_type: string;
  command_version: string;
  idempotency_scope: string;
  idempotency_key: string;
  request_payload_hash: Buffer;
  enterprise_id: string;
  project_id: string | null;
  target_type: string;
  target_id: string;
  expected_aggregate_version: string | null;
  outcome: 'PENDING' | 'COMMITTED' | 'REJECTED' | 'DUPLICATE';
  result_payload: Json | null;
  result_payload_hash: Buffer | null;
  first_seen_at: Generated<Date>;
  completed_at: Date | null;
  correlation_id: string;
  causation_id: string | null;
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
  aggregate_version: Int8;
  enterprise_id: string;
  project_id: string | null;
  correlation_id: string;
  causation_id: string | null;
  payload: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  occurred_at: Date;
  recorded_at: Generated<Date>;
  delivery_state: Generated<'PENDING' | 'LEASED' | 'PUBLISHED' | 'UNKNOWN' | 'DEAD'>;
  available_at: Generated<Date>;
  attempt_count: Generated<number>;
  lease_owner: string | null;
  lease_until: Date | null;
  lease_token: Int8 | null;
  last_error_code: string | null;
  published_at: Date | null;
  created_by_principal_id: string;
  source_command_id: string;
}

export interface InboxMessageTable {
  consumer_name: string;
  event_id: string;
  event_type: string;
  event_version: string;
  payload_hash: Buffer;
  source_module: string;
  enterprise_id: string;
  project_id: string | null;
  status: 'PENDING' | 'PROCESSED' | 'QUARANTINED' | 'FAILED';
  first_seen_at: Generated<Date>;
  processed_at: Date | null;
  result_command_id: string | null;
  failure_code: string | null;
  safe_error_summary: string | null;
  correlation_id: string;
  created_by_principal_id: string;
}

export interface ProcessInstanceTable {
  process_id: string;
  process_type: string;
  process_version: string;
  correlation_key: string;
  enterprise_id: string;
  project_id: string | null;
  state: 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'SUSPENDED';
  aggregate_version: Int8Default;
  next_action_at: Date | null;
  retry_count: Generated<number>;
  last_consumed_event_id: string | null;
  blocked_reason_code: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by_principal_id: string;
}

export interface ProcessStepTable {
  process_step_id: string;
  process_id: string;
  step_no: number;
  enterprise_id: string;
  project_id: string | null;
  input_event_id: string | null;
  input_event_type: string | null;
  issued_command_id: string | null;
  issued_command_type: string | null;
  outcome: 'STARTED' | 'COMPLETED' | 'FAILED' | 'AWAITING_HUMAN' | 'SKIPPED';
  failure_code: string | null;
  human_intervention: string | null;
  recorded_at: Generated<Date>;
  created_by_principal_id: string;
}

export interface AuditRecordTable {
  audit_id: string;
  enterprise_id: string;
  project_id: string | null;
  principal_id: string;
  actor_snapshot_id: string;
  authorization_decision_id: string;
  command_id: string | null;
  command_type: string | null;
  outcome: 'ALLOWED' | 'DENIED' | 'COMMITTED' | 'REJECTED' | 'INFO';
  error_code: string | null;
  request_payload_hash: Buffer | null;
  result_payload_hash: Buffer | null;
  target_type: string | null;
  target_id: string | null;
  target_aggregate_version: string | null;
  correlation_id: string;
  causation_id: string | null;
  channel_ref: Json | null;
  runtime_ref: Json | null;
  break_glass_reason: string | null;
  approval_ref: Json | null;
  safe_summary: string | null;
  recorded_at: Generated<Date>;
  retention_class: string;
}

export interface ReferenceEdgeTable {
  owner_object_type: string;
  owner_object_id: string;
  owner_version_id: string | null;
  owner_payload_hash: Buffer | null;
  reference_path: string;
  target_module: string;
  target_object_type: string;
  target_object_id: string;
  target_version_id: string | null;
  target_payload_hash: Buffer | null;
  reference_purpose: string;
  enterprise_id: string;
  project_id: string | null;
  created_at: Generated<Date>;
  source_command_id: string;
}

export interface ContractViolationTable {
  violation_id: string;
  violation_kind: string;
  contract_type: string | null;
  contract_version: string | null;
  enterprise_id: string;
  project_id: string | null;
  observed_payload_hash: Buffer | null;
  schema_error_path: string | null;
  safe_summary: string | null;
  source_event_id: string | null;
  consumer_name: string | null;
  correlation_id: string | null;
  recorded_at: Generated<Date>;
  created_by_principal_id: string;
}

export interface ReleaseRecordTable {
  release_id: string;
  enterprise_id: string;
  project_id: string | null;
  artifact_ref: unknown;
  revision_ref: unknown;
  revision_content_hash: Buffer;
  release_number: string;
  purpose: string;
  requested_effective_at: Date | null;
  quality_profile_ref: unknown;
  revision_acceptance_snapshot_ref: unknown;
  approval_bundle_snapshot_ref: unknown;
  supersedes_release_ref: unknown;
  representation_selections: unknown;
  representation_selection_reason: unknown;
  destination_definitions: unknown;
  recipient_scope_snapshot_ref: unknown;
  status: 'DRAFT' | 'PREPARED' | 'CANCELLED';
  aggregate_version: string;
  package_id: string | null;
  package_hash: Buffer | null;
  preparation_validation_ref: unknown;
  cancel_reason: unknown;
  cancelled_at: Date | null;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  updated_by_principal_id: string;
  updated_by_actor_snapshot_id: string;
  updated_authorization_decision_id: string;
  updated_at: Date;
  last_command_id: string;
}

export interface ReleasePackageTable {
  package_id: string;
  release_id: string;
  enterprise_id: string;
  project_id: string | null;
  canonical_revision_ref: unknown;
  approval_bundle_snapshot_ref: unknown;
  recipient_scope_snapshot_ref: unknown;
  preparation_validation_ref: unknown;
  package_hash: Buffer;
  package_payload_hash: Buffer;
  canonical_manifest: unknown;
  package_definition: unknown;
  prepared_at: Date;
  frozen_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export interface ReleasePackageItemTable {
  package_id: string;
  ordinal: number;
  representation_id: string;
  representation_ref: unknown;
  representation_checksum: Buffer;
  renderer_id: string;
  renderer_version: string;
  display_name: string;
  required: boolean;
  release_role: string;
  enterprise_id: string;
  project_id: string | null;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export interface ReleaseDestinationTable {
  package_id: string;
  destination_id: string;
  destination_type: string;
  destination_ref: unknown;
  recipient_scope_ref: unknown;
  purpose: string;
  required: boolean;
  required_receipt_kind: string;
  delivery_policy_ref: unknown;
  enterprise_id: string;
  project_id: string | null;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export interface ReleasePublicationDb {
  'release_publication.command_receipt': CommandReceiptTable;
  'release_publication.outbox_event': OutboxEventTable;
  'release_publication.inbox_message': InboxMessageTable;
  'release_publication.process_instance': ProcessInstanceTable;
  'release_publication.process_step': ProcessStepTable;
  'release_publication.audit_record': AuditRecordTable;
  'release_publication.reference_edge': ReferenceEdgeTable;
  'release_publication.contract_violation': ContractViolationTable;
  'release_publication.release_record': ReleaseRecordTable;
  'release_publication.release_package': ReleasePackageTable;
  'release_publication.release_package_item': ReleasePackageItemTable;
  'release_publication.release_destination': ReleaseDestinationTable;
}

export const CANONICALIZATION_VERSION = '1';
export const PAYLOAD_HASH_ALGORITHM = 'SHA-256';

export type ReleasePrincipalKind = 'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY';

export interface CanonicalPayloadDigest {
  readonly canonicalJson: string;
  readonly hash: Buffer;
  readonly sizeBytes: number;
  readonly canonicalizationVersion: string;
  readonly hashAlgorithm: string;
}

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

export interface ReleaseTransactionContext {
  readonly kind: 'REQUEST' | 'EVENT_CONSUMER';
  readonly principalId: string;
  readonly principalKind: ReleasePrincipalKind;
  readonly actorSnapshotId: string;
  readonly authorizationDecisionId: string;
  readonly authorizationDecisionHash: Buffer;
  readonly authorizationDecisionExpiresAt: Date;
  readonly policySnapshotId: string;
  readonly enterpriseId: string;
  readonly allowedProjectIds: readonly string[];
  readonly correlationId: string;
  readonly sourceEventId?: string;
}

export type ReleaseTransaction = Transaction<ReleasePublicationDb>;

export function createReleasePublicationDatabase(pool: Pool): Kysely<ReleasePublicationDb> {
  return new Kysely<ReleasePublicationDb>({ dialect: new PostgresDialect({ pool }) });
}

export async function withReleasePublicationTransaction<T>(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  fn: (trx: ReleaseTransaction) => Promise<T>,
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
      await sql.raw('SET LOCAL ROLE release_publication_app').execute(trx);
      return fn(trx);
    }),
  );
}
