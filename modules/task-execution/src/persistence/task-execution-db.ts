// IM-06 WI-01 (issue #151): hand-written Kysely types and the trusted
// transaction boundary for TaskExecution-owned technical facts. The module
// borrows the IM-02 standard eight technical tables, the IM-04
// canonical-payload digest and the platform context establisher wiring from
// the artifact module, but binds its own Kysely schema to
// `task_execution.<table>` so that this module cannot silently read or write
// another owning module's rows.

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
/**
 * A declared `expiresAt` instant is written as the exact text the command
 * declared. A JavaScript `Date` only carries milliseconds, so passing one would
 * store a truncated column that the V3003 mirror guard - which casts the same
 * declared text to `timestamptz` at microsecond precision - then rejects as a
 * mirror mismatch. Reads still see a `Date`, which is what `pg` decodes.
 */
type InstantColumn = ColumnType<Date | null, string | null, string | null>;

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

/**
 * IM-06 (#204): Task Aggregate Root. `current_definition_hash` is part of the
 * composite pointer to the snapshot row, so a re-written definition cannot
 * satisfy the pointer by reusing the same `snapshot_id`.
 */
export interface TaskTable {
  task_id: string;
  enterprise_id: string;
  project_id: string;
  status: string;
  aggregate_version: Int8Default;
  current_definition_snapshot_id: string;
  current_definition_hash: Buffer;
  delivery_item_id: string | null;
  delivery_item_version_id: string | null;
  created_at: Generated<Date>;
  created_by_principal_id: string;
}

/** IM-06 (#204): immutable TaskDefinition of one Task; INSERT-only. */
export interface TaskDefinitionSnapshotTable {
  snapshot_id: string;
  task_id: string;
  schema_version: string;
  enterprise_id: string;
  project_id: string;
  delivery_item_id: string | null;
  delivery_item_version_id: string | null;
  canonical_payload: Json;
  payload_hash: Buffer;
  canonicalization_version: Generated<string>;
  created_at: Generated<Date>;
  created_by_principal_id: string;
  source_command_id: string;
}

/**
 * IM-06 (#208): immutable Task Readiness judgment fact. It has no CAS version
 * and no current pointer: the identity of a judgment is the judgment itself, so
 * the primary key is the database-adjudicated single-winner boundary for a
 * duplicate CREATE identity and every promoted column is a mirror of the
 * canonical payload (`V3002` re-derives them inside the database).
 */
export interface ExecutionJudgmentTable {
  judgment_id: string;
  judgment_kind: string;
  enterprise_id: string;
  project_id: string;
  task_id: string;
  task_definition_snapshot_id: string;
  task_definition_hash: Buffer;
  policy_version_ref: Json;
  policy_content_hash: Buffer;
  policy_effective_from: Date;
  policy_superseded_at: Date | null;
  evaluator_ref: Json;
  input_hash: Buffer;
  evaluated_at: Date;
  valid_until: Date;
  ready: boolean;
  canonical_payload: Json;
  payload_hash: Buffer;
  canonicalization_version: Generated<string>;
  request_payload_hash: Buffer;
  source_command_id: string;
  created_at: Generated<Date>;
  created_by_principal_id: string;
}

/**
 * IM-06 (#212): WorkOrder Aggregate Root. DRAFT creation writes `status='DRAFT'`
 * and `aggregate_version=1`; `current_draft_snapshot_hash` is part of the
 * composite pointer to the draft snapshot, so a silently re-written payload
 * cannot satisfy the pointer by reusing the same `snapshot_id`. Identity,
 * Project Scope, both spellings, the draft schema version and the expiry are
 * creation facts (V3003), so only `status`, `aggregate_version` and the pointer
 * may move in a later CAS transition.
 */
export interface WorkOrderTable {
  work_order_id: string;
  enterprise_id: string;
  project_id: string;
  work_order_object_type: string;
  task_id: string;
  task_object_type: string;
  status: string;
  aggregate_version: Int8Default;
  current_draft_snapshot_id: string;
  current_draft_snapshot_hash: Buffer;
  draft_schema_version: string;
  expires_at: InstantColumn;
  created_at: Generated<Date>;
  created_by_principal_id: string;
  requested_by_principal_id: string;
}

/**
 * IM-06 (#212): immutable `WorkOrderDraftSnapshot` of one WorkOrder;
 * INSERT-only. Every promoted column is a mirror of `canonical_payload` that
 * V3003 re-derives inside the database, and `request_payload_hash` only counts
 * once the creation guard has proven it equals the projection the owning
 * in-flight `execution.create_work_order` Receipt was claimed for.
 */
export interface WorkOrderDraftSnapshotTable {
  snapshot_id: string;
  work_order_id: string;
  draft_schema_version: string;
  work_order_object_type: string;
  task_object_type: string;
  enterprise_id: string;
  project_id: string;
  expires_at: InstantColumn;
  canonical_payload: Json;
  payload_hash: Buffer;
  canonicalization_version: Generated<string>;
  request_payload_hash: Buffer;
  source_command_id: string;
  created_at: Generated<Date>;
  created_by_principal_id: string;
}

/**
 * IM-06 (#216): immutable initial Context Snapshot of one CREATE target (V3004).
 * `snapshot_id` is application-generated and independent of any aggregate CAS
 * version; `object_id` is the validated CREATE `targetRef.objectId`. Every
 * promoted column is re-derived inside the database from `canonical_payload` by
 * the V3004 mirror guard, so the writer stores the payload and the mirrors it
 * already computed - never a second derivation. `expires_at` and
 * `effective_expires_at` both mirror the payload's single `expiresAt` member
 * (§19.4 item 5: the payload member IS the effective expiry) and are written as
 * the declared text for the same microsecond-precision reason as the WorkOrder
 * expiry.
 */
export interface ContextSnapshotTable {
  snapshot_id: string;
  object_id: string;
  purpose: string;
  /** The encoded `projection.audience` string (the PrincipalRef principalId). */
  audience: string;
  enterprise_id: string;
  project_id: string;
  builder_version: string;
  /** `projection.builderPolicyRef.versionId`. */
  policy_snapshot_id: string;
  source_manifest_count: number;
  context_item_count: number;
  omission_count: number;
  redaction_count: number;
  /** `coverage.completeness`. */
  coverage_state: string;
  payload_hash: Buffer;
  canonicalization_version: Generated<string>;
  payload_hash_algorithm: string;
  expires_at: InstantColumn;
  effective_expires_at: InstantColumn;
  request_payload_hash: Buffer;
  source_command_id: string;
  created_at: Generated<Date>;
  created_by_principal_id: string;
  canonical_payload: Json;
}

/**
 * IM-06 (#216): immutable INITIAL build metadata of one committed Context
 * Snapshot (V3004). This slice writes INITIAL success rows only:
 * `frozen_contract_ref` stays NULL (the FROZEN branch has no owning producer),
 * and the canonical payload never carries a `frozenContractRef` member - the
 * NULL column and the absent member are the same fact. The Policy observation
 * columns are exact mirrors of the `builderPolicyRef`/`policyContentHash`/
 * `policyEffectiveFrom`/`policySupersededAt` payload members, and both expiry
 * columns mirror the #168 composition result. Expiry and Policy validity
 * columns are written as declared text (microsecond precision, same as
 * `expires_at` on the Snapshot).
 */
export interface ContextSnapshotBuildTable {
  snapshot_id: string;
  build_kind: string;
  draft_snapshot_ref: Json;
  frozen_contract_ref?: Json | null;
  slice_refs: Json;
  purpose: string;
  /** The full audience PrincipalRef. */
  audience: Json;
  builder_policy_ref: Json;
  policy_content_hash: Buffer;
  policy_effective_from: InstantColumn;
  policy_superseded_at: InstantColumn;
  request_expires_at: InstantColumn;
  effective_expires_at: InstantColumn;
  canonical_payload: Json;
  payload_hash: Buffer;
  request_payload_hash: Buffer;
  source_command_id: string;
  enterprise_id: string;
  project_id: string;
  created_at: Generated<Date>;
  created_by_principal_id: string;
}

export interface TaskExecutionDb {
  'task_execution.task': TaskTable;
  'task_execution.task_definition_snapshot': TaskDefinitionSnapshotTable;
  'task_execution.execution_judgment': ExecutionJudgmentTable;
  'task_execution.work_order': WorkOrderTable;
  'task_execution.work_order_draft_snapshot': WorkOrderDraftSnapshotTable;
  'task_execution.context_snapshot': ContextSnapshotTable;
  'task_execution.context_snapshot_build': ContextSnapshotBuildTable;
  'task_execution.command_receipt': CommandReceiptTable;
  'task_execution.outbox_event': OutboxEventTable;
  'task_execution.inbox_message': InboxMessageTable;
  'task_execution.process_instance': ProcessInstanceTable;
  'task_execution.process_step': ProcessStepTable;
  'task_execution.audit_record': AuditRecordTable;
  'task_execution.reference_edge': ReferenceEdgeTable;
  'task_execution.contract_violation': ContractViolationTable;
}

export const CANONICALIZATION_VERSION = '1';
export const PAYLOAD_HASH_ALGORITHM = 'SHA-256';

export type TaskExecutionPrincipalKind =
  'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY';

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

export interface TaskExecutionTransactionContext {
  readonly kind: 'REQUEST' | 'EVENT_CONSUMER';
  readonly principalId: string;
  readonly principalKind: TaskExecutionPrincipalKind;
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

export type TaskExecutionTransaction = Transaction<TaskExecutionDb>;

/** Creates the Kysely SQL builder over an application-owned pg pool. */
export function createTaskExecutionDatabase(pool: Pool): Kysely<TaskExecutionDb> {
  return new Kysely<TaskExecutionDb>({ dialect: new PostgresDialect({ pool }) });
}

/**
 * Runs one TaskExecution transaction on one connection and binds its RLS
 * context before any owning-schema statement can execute.
 *
 * The context is established through the 11-argument entry point, so the
 * `principalKind` the composition layer derived from the revalidated Decision
 * becomes a database-verifiable fact
 * (`platform_security.context_principal_kind()`). The legacy 10-argument entry
 * would write a NULL kind and can never satisfy a WorkOrder guard (IM-06 #212,
 * decision `rls-transaction-context.md` §3.5 items 6-7).
 */
export async function withTaskExecutionTransaction<T>(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  fn: (trx: TaskExecutionTransaction) => Promise<T>,
): Promise<T> {
  return db.connection().execute(async (connection) =>
    connection.transaction().execute(async (trx) => {
      await sql.raw('SET LOCAL ROLE platform_context_establisher').execute(trx);
      await sql`SELECT platform_security.establish_transaction_context(
          ${context.kind},
          ${context.principalId},
          ${context.principalKind},
          ${context.actorSnapshotId},
          ${context.authorizationDecisionId},
          ${context.authorizationDecisionHash},
          ${context.authorizationDecisionExpiresAt},
          ${context.enterpriseId},
          ${[...context.allowedProjectIds]},
          ${context.correlationId},
          ${context.sourceEventId ?? null})`.execute(trx);
      await sql.raw('SET LOCAL ROLE task_execution_app').execute(trx);
      return fn(trx);
    }),
  );
}
