// IM-03 WI-02 (issue #58): hand-written Kysely types for the
// enterprise_project technical tables (V2000). Kysely is a SQL builder
// only — it never owns the schema, migrations or domain semantics
// (Technology-Baseline §3). This database type deliberately excludes
// IdentityPolicy tables and any EnterpriseProject business model.

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

export interface ProcessInstanceTable {
  process_id: string;
  process_type: string;
  process_version: string;
  correlation_key: string;
  enterprise_id: string;
  project_id?: string | null;
  state: 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'SUSPENDED';
  aggregate_version: Int8Default;
  next_action_at?: Date | null;
  retry_count: Generated<number>;
  last_consumed_event_id?: string | null;
  blocked_reason_code?: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  created_by_principal_id: string;
}

export interface EnterpriseProjectDb {
  'enterprise_project.command_receipt': CommandReceiptTable;
  'enterprise_project.outbox_event': OutboxEventTable;
  'enterprise_project.audit_record': AuditRecordTable;
  'enterprise_project.reference_edge': ReferenceEdgeTable;
  'enterprise_project.process_instance': ProcessInstanceTable;
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
 * Trusted RLS + authorization binding for one EnterpriseProject transaction.
 * Policy snapshot is an application-level pin: the SQL establisher does not
 * store it, and this module never reads identity_policy tables.
 */
export interface EnterpriseProjectTransactionContext {
  readonly kind: 'REQUEST' | 'EVENT_CONSUMER';
  readonly principalId: string;
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

export type EnterpriseProjectTransaction = Transaction<EnterpriseProjectDb>;

/** Creates the Kysely SQL builder over an application-owned pg pool. */
export function createEnterpriseProjectDatabase(pool: Pool): Kysely<EnterpriseProjectDb> {
  return new Kysely<EnterpriseProjectDb>({ dialect: new PostgresDialect({ pool }) });
}

/**
 * Runs `fn` in one transaction on a single connection, establishing the
 * WI-03 RLS context first. The context lives and dies with the transaction.
 */
export async function withEnterpriseProjectTransaction<T>(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  fn: (trx: EnterpriseProjectTransaction) => Promise<T>,
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
      await sql.raw('SET LOCAL ROLE enterprise_project_app').execute(trx);
      return fn(trx);
    }),
  );
}
