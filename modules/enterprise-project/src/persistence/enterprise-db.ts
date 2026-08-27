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
import type {
  EnterpriseTable,
  EnterpriseFactTable,
  EnterpriseFactVersionTable,
  EnterpriseProfileSnapshotTable,
  ProductTable,
  ProductVersionTable,
  ProductScopeSnapshotTable,
  QmsConfigurationTable,
  QmsConfigurationRevisionTable,
  ProjectTable,
  ProjectScopeClaimTable,
  ProjectSnapshotBindingTable,
  SourceMaterialTable,
  SourceMaterialOriginTable,
  SourceMaterialValidationTable,
  CustomerMaterialTable,
  CustomerMaterialVersionTable,
  CustomerMaterialDecisionTable,
  CustomerBaselineTable,
  CustomerBaselineVersionTable,
  CustomerBaselineItemTable,
  CustomerBaselineImpactReviewTable,
  ReferenceTemplateTable,
  ReferenceTemplateVersionTable,
  RegulatoryReferenceTable,
  RegulatoryReferenceVersionTable,
  TemplateBaselineTable,
  TemplateBaselineVersionTable,
  TemplateSelectionTable,
  RegulatoryProfileTable,
  RegulatoryProfileVersionTable,
  RegulatoryProfileItemTable,
  GapAnalysisTable,
  GapAnalysisInputSnapshotTable,
  GapAnalysisVersionTable,
  GapFindingTable,
  GapAnalysisDecisionTable,
  DeliveryPlanTable,
  DeliveryPlanVersionTable,
  DeliveryItemTable,
  DeliveryItemCompletionFactTable,
  DeliveryItemCompletionEvaluationTable,
  DeliveryItemImpactReviewTable,
  DeliveryItemArtifactRequirementTable,
  DeliveryItemDependencyTable,
  DeliveryPlanDecisionTable,
} from './enterprise-business-types.js';
import type {
  ProjectBoardProjectionVersionTable,
  ProjectBoardReadAliasTable,
  ProjectBoardTable,
  ProjectionCheckpointTable,
  ProjectionFailureTable,
  ProjectionSourceStateTable,
} from './projection-types.js';

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
  'enterprise_project.inbox_message': InboxMessageTable;
  'enterprise_project.process_step': ProcessStepTable;
  'enterprise_project.audit_record': AuditRecordTable;
  'enterprise_project.reference_edge': ReferenceEdgeTable;
  'enterprise_project.process_instance': ProcessInstanceTable;
  'enterprise_project.contract_violation': ContractViolationTable;
  // IM-03 WI-03 (issue #59): business aggregates landed by V2001. The
  // tables live under the same owning schema; the technical receipt/outbox/
  // audit/reference_edge/process_instance tables above remain owned by the
  // WI-02 Application/Persistence foundation.
  'enterprise_project.enterprise': EnterpriseTable;
  'enterprise_project.enterprise_fact': EnterpriseFactTable;
  'enterprise_project.enterprise_fact_version': EnterpriseFactVersionTable;
  'enterprise_project.enterprise_profile_snapshot': EnterpriseProfileSnapshotTable;
  'enterprise_project.product': ProductTable;
  'enterprise_project.product_version': ProductVersionTable;
  'enterprise_project.product_scope_snapshot': ProductScopeSnapshotTable;
  'enterprise_project.qms_configuration': QmsConfigurationTable;
  'enterprise_project.qms_configuration_revision': QmsConfigurationRevisionTable;
  // IM-03 WI-04 (issue #60): Project Aggregate, ProjectScopeClaim and
  // ProjectSnapshotBinding. The Project row owns (enterprise_id, project_id);
  // the Scope Claim publishes that pair to other modules; the Snapshot
  // Binding freezes the exact StartSnapshot consumed at create time.
  'enterprise_project.project': ProjectTable;
  'enterprise_project.project_scope_claim': ProjectScopeClaimTable;
  'enterprise_project.project_snapshot_binding': ProjectSnapshotBindingTable;
  // IM-03 WI-05 (issue #61): Project-owned source custody root and its
  // append-only origin/validation history.
  'enterprise_project.source_material': SourceMaterialTable;
  'enterprise_project.source_material_origin': SourceMaterialOriginTable;
  'enterprise_project.source_material_validation': SourceMaterialValidationTable;
  // IM-03 WI-06 (issue #62): Project-owned CustomerMaterial root, immutable
  // classification versions and immutable proposal/confirmation decisions.
  'enterprise_project.customer_material': CustomerMaterialTable;
  'enterprise_project.customer_material_version': CustomerMaterialVersionTable;
  'enterprise_project.customer_material_decision': CustomerMaterialDecisionTable;
  // IM-03 WI-07 (issue #63): Project-owned CustomerBaseline pointers,
  // immutable versions/items and append-only impact review facts.
  'enterprise_project.customer_baseline': CustomerBaselineTable;
  'enterprise_project.customer_baseline_version': CustomerBaselineVersionTable;
  'enterprise_project.customer_baseline_item': CustomerBaselineItemTable;
  'enterprise_project.customer_baseline_impact_review': CustomerBaselineImpactReviewTable;
  // IM-03 WI-08 (issue #64): platform reference facts and Project-owned
  // frozen TemplateBaseline/RegulatoryProfile chains.
  'enterprise_project.reference_template': ReferenceTemplateTable;
  'enterprise_project.reference_template_version': ReferenceTemplateVersionTable;
  'enterprise_project.regulatory_reference': RegulatoryReferenceTable;
  'enterprise_project.regulatory_reference_version': RegulatoryReferenceVersionTable;
  'enterprise_project.template_baseline': TemplateBaselineTable;
  'enterprise_project.template_baseline_version': TemplateBaselineVersionTable;
  'enterprise_project.template_selection': TemplateSelectionTable;
  'enterprise_project.regulatory_profile': RegulatoryProfileTable;
  'enterprise_project.regulatory_profile_version': RegulatoryProfileVersionTable;
  'enterprise_project.regulatory_profile_item': RegulatoryProfileItemTable;
  // IM-03 WI-09 (issue #65): Project-owned GapAnalysis root, exact input
  // snapshots, immutable findings and Human decisions.
  'enterprise_project.gap_analysis': GapAnalysisTable;
  'enterprise_project.gap_analysis_input_snapshot': GapAnalysisInputSnapshotTable;
  'enterprise_project.gap_analysis_version': GapAnalysisVersionTable;
  'enterprise_project.gap_finding': GapFindingTable;
  'enterprise_project.gap_analysis_decision': GapAnalysisDecisionTable;
  // IM-03 WI-10 (issue #66): Project-owned DeliveryPlan/DeliveryItem facts,
  // Human decisions and immutable criteria/dependency requirements.
  'enterprise_project.delivery_plan': DeliveryPlanTable;
  'enterprise_project.delivery_plan_version': DeliveryPlanVersionTable;
  'enterprise_project.delivery_item': DeliveryItemTable;
  'enterprise_project.delivery_item_completion_fact': DeliveryItemCompletionFactTable;
  'enterprise_project.delivery_item_completion_evaluation': DeliveryItemCompletionEvaluationTable;
  'enterprise_project.delivery_item_impact_review': DeliveryItemImpactReviewTable;
  'enterprise_project.delivery_item_artifact_requirement': DeliveryItemArtifactRequirementTable;
  'enterprise_project.delivery_item_dependency': DeliveryItemDependencyTable;
  'enterprise_project.delivery_plan_decision': DeliveryPlanDecisionTable;
  // IM-03 WI-11 (issue #67): rebuildable Project Board projection. The
  // projection transaction is deliberately separate from the authoritative
  // EnterpriseProject transaction and never reads across schemas.
  'projection.project_board_projection_version': ProjectBoardProjectionVersionTable;
  'projection.project_board': ProjectBoardTable;
  'projection.project_board_read_alias': ProjectBoardReadAliasTable;
  'projection.projection_source_state': ProjectionSourceStateTable;
  'projection.projection_checkpoint': ProjectionCheckpointTable;
  'projection.projection_failure': ProjectionFailureTable;
}

export const CANONICALIZATION_VERSION = '1';
export const PAYLOAD_HASH_ALGORITHM = 'SHA-256';

export type EnterprisePrincipalKind = 'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY';

export type PlatformReferenceCapability =
  'PLATFORM_REFERENCE_ADMIN' | 'PLATFORM_REFERENCE_PUBLISHER';

export const PLATFORM_CONTROL_SCOPE_ID = '00000000-0000-7000-8000-000000000000';

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
  /** Principal kind is part of the trusted IdentityPolicy snapshot. */
  readonly principalKind: EnterprisePrincipalKind;
  readonly actorSnapshotId: string;
  readonly authorizationDecisionId: string;
  readonly authorizationDecisionHash: Buffer;
  readonly authorizationDecisionExpiresAt: Date;
  readonly policySnapshotId: string;
  readonly enterpriseId: string;
  readonly allowedProjectIds: readonly string[];
  readonly correlationId: string;
  readonly sourceEventId?: string;
  /** Capabilities are supplied by the trusted composition layer, never by payload. */
  readonly platformReferenceCapabilities?: readonly PlatformReferenceCapability[];
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

/**
 * Runs a platform-reference command under a dedicated writer role. The
 * reserved enterprise value is a technical RLS scope for shared transaction
 * facts only; platform business reference rows have no business scope.
 */
export async function withEnterpriseProjectPlatformTransaction<T>(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  fn: (trx: EnterpriseProjectTransaction) => Promise<T>,
): Promise<T> {
  if (
    context.enterpriseId !== PLATFORM_CONTROL_SCOPE_ID ||
    context.allowedProjectIds.length !== 0
  ) {
    throw new Error('platform transaction requires the reserved control scope');
  }
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
          ${PLATFORM_CONTROL_SCOPE_ID},
          ${[]},
          ${context.correlationId},
          ${context.sourceEventId ?? null})`.execute(trx);
      await sql.raw('SET LOCAL ROLE enterprise_project_platform_reference_writer').execute(trx);
      return fn(trx);
    }),
  );
}

/**
 * Runs a projection read/write operation under the trusted RLS context.
 * Projection writers receive only the projection_app role and therefore
 * cannot read or join EnterpriseProject owning tables.
 */
export async function withProjectionTransaction<T>(
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
      await sql.raw('SET LOCAL ROLE projection_app').execute(trx);
      return fn(trx);
    }),
  );
}
