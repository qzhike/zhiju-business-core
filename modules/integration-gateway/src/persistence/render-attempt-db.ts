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
type Int8 = ColumnType<string, string | number, string | number>;

export interface RenderAttemptTable {
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
  attempt_id: string;
  provider_receipt_ref: Json;
  receipt_payload_ref: string;
  receipt_payload_hash: Buffer;
  receipt_content_hash: Buffer;
  observed_outcome: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  occurred_at: Date | null;
  recorded_at: Date;
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
  'integration_gateway.render_attempt': RenderAttemptTable;
  'integration_gateway.raw_external_receipt': RawExternalReceiptTable;
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
