// IM-05 WI-01 (issue #121): QualityGovernance-owned technical table types and
// the single-connection transaction boundary. Business aggregate tables are
// intentionally absent from this foundation.

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
import type {
  ChangeImpactTable,
  EvidenceLinkTable,
  EvidenceRevocationTable,
  EvidenceTable,
  EvidenceValidationTable,
  GateInvalidationTable,
  GateResultReuseTable,
  GateResultTable,
  QualityProfileApprovalRequirementTable,
  QualityProfileGateDependencyTable,
  QualityProfileGateSpecTable,
  QualityProfileReleaseRequirementTable,
  QualityProfileTable,
  QualityProfileVersionTable,
  ReleaseReadinessSnapshotTable,
  RevisionAcceptanceSnapshotTable,
} from './quality-business-types.js';

type Int8 = ColumnType<string, string | number, string | number>;
type Int8Default = ColumnType<string, string | number | undefined, string | number | undefined>;
type Json = ColumnType<unknown, string>;

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

export interface QualityGovernanceDb {
  'quality_governance.command_receipt': CommandReceiptTable;
  'quality_governance.outbox_event': OutboxEventTable;
  'quality_governance.inbox_message': InboxMessageTable;
  'quality_governance.process_instance': ProcessInstanceTable;
  'quality_governance.process_step': ProcessStepTable;
  'quality_governance.audit_record': AuditRecordTable;
  'quality_governance.reference_edge': ReferenceEdgeTable;
  'quality_governance.evidence': EvidenceTable;
  'quality_governance.evidence_validation': EvidenceValidationTable;
  'quality_governance.evidence_revocation': EvidenceRevocationTable;
  'quality_governance.evidence_link': EvidenceLinkTable;
  'quality_governance.quality_profile': QualityProfileTable;
  'quality_governance.quality_profile_version': QualityProfileVersionTable;
  'quality_governance.quality_profile_gate_spec': QualityProfileGateSpecTable;
  'quality_governance.quality_profile_gate_dependency': QualityProfileGateDependencyTable;
  'quality_governance.quality_profile_approval_requirement': QualityProfileApprovalRequirementTable;
  'quality_governance.quality_profile_release_requirement': QualityProfileReleaseRequirementTable;
  'quality_governance.change_impact': ChangeImpactTable;
  'quality_governance.gate_result': GateResultTable;
  'quality_governance.gate_result_reuse': GateResultReuseTable;
  'quality_governance.gate_invalidation': GateInvalidationTable;
  'quality_governance.revision_acceptance_snapshot': RevisionAcceptanceSnapshotTable;
  'quality_governance.release_readiness_snapshot': ReleaseReadinessSnapshotTable;
}

export const CANONICALIZATION_VERSION = '1';
export const PAYLOAD_HASH_ALGORITHM = 'SHA-256';

export type QualityPrincipalKind = 'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY';

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

export interface QualityTransactionContext {
  readonly kind: 'REQUEST' | 'EVENT_CONSUMER';
  readonly principalId: string;
  readonly principalKind: QualityPrincipalKind;
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

export type QualityTransaction = Transaction<QualityGovernanceDb>;

export function createQualityGovernanceDatabase(pool: Pool): Kysely<QualityGovernanceDb> {
  return new Kysely<QualityGovernanceDb>({ dialect: new PostgresDialect({ pool }) });
}

export async function withQualityGovernanceTransaction<T>(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  fn: (trx: QualityTransaction) => Promise<T>,
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
      await sql.raw('SET LOCAL ROLE quality_governance_app').execute(trx);
      return fn(trx);
    }),
  );
}
