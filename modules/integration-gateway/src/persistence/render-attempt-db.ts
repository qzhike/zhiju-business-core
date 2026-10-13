// IM-05 WI-05 (issue #125): IntegrationGateway Renderer transaction boundary.

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

type Json = ColumnType<unknown, string, never>;
type MutableJson = ColumnType<unknown, string, string>;
type Int8 = ColumnType<string, string | number, string | number>;

export interface RenderAttemptTable {
  original_operation: Generated<
    'integration.request_render' | 'integration.request_markdown_render'
  >;
  source_command_id: string | null;
  attempt_id: string;
  enterprise_id: string;
  project_id: string | null;
  stable_key_hash: Buffer;
  request_payload_hash: Buffer;
  request_payload: Json;
  status: Generated<'CREATED' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'>;
  output_object_ref: string | null;
  output_checksum: Buffer | null;
  raw_receipt_id: string | null;
  error_code: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface RawExternalReceiptTable {
  receipt_id: string;
  enterprise_id: string;
  project_id: string | null;
  attempt_id: Generated<string | null>;
  attempt_kind: Generated<'RENDERER' | 'RUNTIME'>;
  runtime_attempt_id: Generated<string | null>;
  provider_receipt_ref: Json;
  receipt_payload_ref: string;
  receipt_payload_hash: Buffer;
  receipt_content_hash: Buffer;
  observed_outcome: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  occurred_at: Date | null;
  recorded_at: Date;
}

export interface RuntimeAttemptTable {
  attempt_id: string;
  enterprise_id: string;
  project_id: string;
  stable_key_hash: Buffer;
  request_payload: Json;
  request_payload_hash: Buffer;
  invocation_binding: Json;
  binding_hash: Buffer;
  planned_runtime_instance_id: string | null;
  source_command_id: string;
  status: Generated<'CREATED' | 'SUCCEEDED' | 'UNKNOWN'>;
  created_at: Date;
  updated_at: Date;
}

export interface RuntimeAdapterIdentityTable {
  instance_id: string;
  attempt_id: string;
  enterprise_id: string;
  project_id: string;
  adapter_code: string;
  adapter_version: string;
  binding_hash: Buffer;
  ack_observation_id: string;
  source: 'SYNTHETIC_DRIVER';
  source_command_id: string;
  canonical_payload: Json;
  payload_hash: Buffer;
}

export interface RuntimeFinalObservationTable {
  observation_id: string;
  attempt_id: string;
  enterprise_id: string;
  project_id: string;
  ack_observation_id: string;
  runtime_adapter_identity_id: string;
  runtime_submission_ref: Json;
  result_payload: Json;
  result_payload_hash: Buffer;
  binding_hash: Buffer;
  fencing_token: Int8;
  observed_at: Date;
  source: 'SYNTHETIC_DRIVER';
  source_command_id: string;
  canonical_payload: Json;
  payload_hash: Buffer;
}

export interface RenderCommandReceiptTable {
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
  expected_aggregate_version?: string | null;
  outcome: 'PENDING' | 'COMMITTED' | 'REJECTED' | 'DUPLICATE';
  result_payload?: MutableJson;
  result_payload_hash?: Buffer | null;
  first_seen_at: Generated<Date>;
  completed_at?: Date | null;
  correlation_id: string;
  causation_id?: string | null;
  created_by_principal_id: string;
  actor_snapshot_id: string;
  authorization_decision_id: string;
}

export interface RenderAuditRecordTable {
  audit_id: string;
  enterprise_id: string;
  project_id: string | null;
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
  safe_summary?: string | null;
  recorded_at: Generated<Date>;
  retention_class: string;
}

export interface RenderReferenceEdgeTable {
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
  project_id: string | null;
  created_at: Generated<Date>;
  source_command_id: string;
}

export interface RuntimeAttemptObservationTable {
  observation_id: string;
  attempt_id: string;
  enterprise_id: string;
  project_id: string;
  raw_receipt_id: string;
  runtime_session_ref: Json;
  acknowledgement_source: 'SYNTHETIC_DRIVER' | 'PROVIDER';
  acknowledged_at: Date;
  observation_payload: Json;
  observation_hash: Buffer;
}

export interface RenderOutboxEventTable {
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

export interface IntegrationRendererDb {
  'integration_gateway.markdown_render_work': {
    attempt_id: string;
    enterprise_id: string;
    project_id: string;
    started_at: Date;
    deadline_at: Date;
  };
  'integration_gateway.markdown_render_output': {
    attempt_id: string;
    enterprise_id: string;
    project_id: string;
    storage_reference: Json;
    receipt_storage_reference: Json;
    validation: Json;
    observed_at: Date;
  };
  'integration_gateway.command_receipt': RenderCommandReceiptTable;
  'integration_gateway.audit_record': RenderAuditRecordTable;
  'integration_gateway.reference_edge': RenderReferenceEdgeTable;
  'integration_gateway.render_attempt': RenderAttemptTable;
  'integration_gateway.raw_external_receipt': RawExternalReceiptTable;
  'integration_gateway.runtime_attempt': RuntimeAttemptTable;
  'integration_gateway.runtime_attempt_observation': RuntimeAttemptObservationTable;
  'integration_gateway.runtime_adapter_identity': RuntimeAdapterIdentityTable;
  'integration_gateway.runtime_final_observation': RuntimeFinalObservationTable;
  'integration_gateway.outbox_event': RenderOutboxEventTable;
}

export type RenderPrincipalKind = 'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY';

export interface RenderTransactionContext {
  readonly kind: 'REQUEST' | 'EVENT_CONSUMER';
  readonly principalId: string;
  readonly principalKind: RenderPrincipalKind;
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

export type RenderTransaction = Transaction<IntegrationRendererDb>;
export type SelectedRenderAttempt = Selectable<RenderAttemptTable>;

export function createIntegrationRendererDatabase(pool: Pool): Kysely<IntegrationRendererDb> {
  return new Kysely<IntegrationRendererDb>({ dialect: new PostgresDialect({ pool }) });
}

export async function withRenderTransaction<T>(
  db: Kysely<IntegrationRendererDb>,
  context: RenderTransactionContext,
  fn: (trx: RenderTransaction) => Promise<T>,
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
      await sql.raw('SET LOCAL ROLE integration_gateway_app').execute(trx);
      return fn(trx);
    }),
  );
}
