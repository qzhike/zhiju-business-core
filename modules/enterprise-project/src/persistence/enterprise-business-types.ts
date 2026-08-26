// IM-03 WI-03 (issue #59): hand-written Kysely table types for the
// enterprise_project business aggregates (V2001). Mirrors the WI-02
// persistence boundary — Kysely is a SQL builder only; the database owns
// schema, migrations and domain semantics. This database type only
// describes the business tables introduced in V2001; the technical tables
// (command_receipt, outbox_event, audit_record, reference_edge,
// process_instance) are declared in enterprise-db.ts (V2000) and remain
// owned by WI-02.

import type { ColumnType } from 'kysely';

type Int8Default = ColumnType<string, string | number | undefined, string | number | undefined>;
type Json = ColumnType<unknown, string>;

export type EnterpriseStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type EnterpriseFactRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type EnterpriseFactStatus = 'PROPOSED' | 'CONFIRMED' | 'DISPUTED' | 'SUPERSEDED';
export type ProductStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type VersionLifecycle = 'CURRENT' | 'HISTORICAL';
export type QmsConfigurationStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export interface EnterpriseTable {
  enterprise_id: string;
  display_code: string;
  display_name: string;
  status: EnterpriseStatus;
  aggregate_version: Int8Default;
  current_fact_snapshot_id: string | null;
  current_product_id: string | null;
  current_qms_configuration_id: string | null;
  created_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  updated_at: Date;
  last_command_id: string | null;
  retention_class: string;
}

export interface EnterpriseFactTable {
  enterprise_fact_id: string;
  enterprise_id: string;
  fact_type: string;
  risk_level: EnterpriseFactRiskLevel;
  current_version_id: string | null;
  current_status: EnterpriseFactStatus;
  aggregate_version: Int8Default;
  created_at: Date;
  created_by_principal_id: string;
  updated_at: Date;
  last_command_id: string | null;
  retention_class: string;
}

export interface EnterpriseFactVersionTable {
  version_id: string;
  enterprise_fact_id: string;
  enterprise_id: string;
  version_no: number;
  status: EnterpriseFactStatus;
  value: Json;
  source_refs: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  effective_from: Date | null;
  effective_to: Date | null;
  proposed_by_principal_id: string;
  proposed_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
}

export interface EnterpriseProfileSnapshotTable {
  snapshot_id: string;
  enterprise_id: string;
  payload: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  derived_from: Json;
  frozen_by_principal_id: string;
  frozen_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  purpose: string;
  recorded_at: Date;
  source_command_id: string;
}

export interface ProductTable {
  product_id: string;
  enterprise_id: string;
  display_code: string;
  display_name: string;
  status: ProductStatus;
  current_version_id: string | null;
  aggregate_version: Int8Default;
  created_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  updated_at: Date;
  last_command_id: string | null;
  retention_class: string;
}

export interface ProductVersionTable {
  version_id: string;
  product_id: string;
  enterprise_id: string;
  version_no: number;
  product_type: string;
  display_name: string;
  intended_use: string;
  product_scope: Json;
  source_refs: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  lifecycle: VersionLifecycle;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
  previous_version_id: string | null;
}

export interface ProductScopeSnapshotTable {
  snapshot_id: string;
  product_id: string;
  enterprise_id: string;
  payload: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  derived_from: Json;
  frozen_by_principal_id: string;
  frozen_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  purpose: string;
  recorded_at: Date;
  source_command_id: string;
}

export interface QmsConfigurationTable {
  qms_configuration_id: string;
  enterprise_id: string;
  display_code: string;
  display_name: string;
  status: QmsConfigurationStatus;
  current_revision_id: string | null;
  aggregate_version: Int8Default;
  created_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  updated_at: Date;
  last_command_id: string | null;
  retention_class: string;
}

export interface QmsConfigurationRevisionTable {
  revision_id: string;
  qms_configuration_id: string;
  enterprise_id: string;
  revision_no: number;
  applicability_decisions: Json;
  management_choices: Json;
  professional_decisions: Json;
  source_refs: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  lifecycle: VersionLifecycle;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
  previous_revision_id: string | null;
}

// IM-03 WI-04 (issue #60): Project Aggregate, ProjectScopeClaim and
// ProjectSnapshotBinding rows. The Project row owns the (enterprise_id,
// project_id) tuple; both columns are immutable once written (PG-007,
// Issue #60 #1). The ScopeClaim is the authoritative source of that
// pair used by other modules. The SnapshotBinding is INSERT-only and
// records the exact StartSnapshot consumed at create time.
export type ProjectStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type ProjectScopeClaimStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
export type ProjectSnapshotBindingPurpose = 'PROJECT_START';

export interface ProjectTable {
  project_id: string;
  enterprise_id: string;
  display_code: string;
  title: string;
  objective: string;
  status: ProjectStatus;
  member_policy_ref: Json;
  member_policy_version_id: string;
  member_policy_payload_hash: Buffer | null;
  aggregate_version: Int8Default;
  created_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  updated_at: Date;
  last_command_id: string | null;
  retention_class: string;
}

export interface ProjectScopeClaimTable {
  claim_id: string;
  enterprise_id: string;
  project_id: string;
  scope_version: Int8Default;
  status: ProjectScopeClaimStatus;
  claimed_by_principal_id: string;
  claimed_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  payload_hash: Buffer;
  canonicalization_version: string;
  payload: Json;
  source_command_id: string;
  claimed_at: Date;
  updated_at: Date;
}

export interface ProjectSnapshotBindingTable {
  binding_id: string;
  enterprise_id: string;
  project_id: string;
  binding_purpose: ProjectSnapshotBindingPurpose;
  enterprise_profile_snapshot_ref: Json;
  enterprise_profile_snapshot_id: string;
  enterprise_profile_payload_hash: Buffer;
  qms_configuration_ref: Json;
  qms_configuration_id: string;
  qms_configuration_revision_id: string;
  qms_configuration_revision_hash: Buffer;
  product_scope_snapshot_ref: Json;
  product_scope_snapshot_id: string;
  product_scope_payload_hash: Buffer;
  initial_customer_baseline_ref: Json | null;
  initial_customer_baseline_version_id: string | null;
  initial_customer_baseline_version_hash: Buffer | null;
  template_baseline_ref: Json | null;
  template_baseline_version_id: string | null;
  template_baseline_version_hash: Buffer | null;
  regulatory_profile_ref: Json | null;
  regulatory_profile_version_id: string | null;
  regulatory_profile_version_hash: Buffer | null;
  member_policy_ref: Json;
  member_policy_version_id: string;
  member_policy_payload_hash: Buffer | null;
  payload_hash: Buffer;
  canonicalization_version: string;
  bound_at: Date;
  bound_by_principal_id: string;
  bound_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  source_command_id: string;
}

// IM-03 WI-05 (issue #61): SourceMaterial is a Project-owned custody root.
// Origins and validations are append-only history/fact rows; the root keeps
// only the exact accepted object locator and its state transition.
export type SourceMaterialCustodyStatus =
  'RECEIVED' | 'ACCEPTED' | 'QUARANTINED' | 'REJECTED' | 'ARCHIVED';
export type SourceMaterialProcessingStatus =
  'NOT_PROCESSED' | 'PROCESSING' | 'PROCESSED' | 'PARTIALLY_PROCESSED' | 'UNREADABLE';
export type SourceMaterialValidationKind = 'SECURITY' | 'INTEGRITY';
export type SourceMaterialValidationOutcome = 'PASSED' | 'FAILED';

export interface SourceMaterialTable {
  source_material_id: string;
  enterprise_id: string;
  project_id: string;
  submitted_by_principal_id: string;
  submitted_by_ref: Json;
  received_at: Date;
  original_name: string;
  media_type: string;
  byte_length: Int8Default;
  content_hash: Buffer;
  staged_object_ref: string;
  descriptor_payload_hash: Buffer;
  custody_status: SourceMaterialCustodyStatus;
  processing_status: SourceMaterialProcessingStatus;
  duplicate_of_source_material_id: string | null;
  accepted_object_ref: string | null;
  accepted_at: Date | null;
  aggregate_version: Int8Default;
  created_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  updated_at: Date;
  last_command_id: string | null;
  retention_class: string;
}

export interface SourceMaterialOriginTable {
  source_material_origin_id: string;
  source_material_id: string;
  enterprise_id: string;
  project_id: string;
  origin_ref: Json;
  origin_ref_hash: Buffer;
  received_at: Date;
  recorded_by_principal_id: string;
  recorded_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  source_command_id: string;
  recorded_at: Date;
}

export interface SourceMaterialValidationTable {
  validation_id: string;
  source_material_id: string;
  enterprise_id: string;
  project_id: string;
  validation_kind: SourceMaterialValidationKind;
  outcome: SourceMaterialValidationOutcome;
  validated_object_ref: string;
  validated_content_hash: Buffer;
  validated_byte_length: Int8Default;
  validator_id: string;
  validator_version: string;
  payload: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  recorded_by_principal_id: string;
  recorded_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  source_command_id: string;
  recorded_at: Date;
}

// IM-03 WI-06 (issue #62): CustomerMaterial is a Project-owned
// classification aggregate. Its versions and decisions are append-only;
// source selections stay as exact reference payloads so one SourceMaterial
// can support multiple candidate classifications without overwriting history.
export type CustomerMaterialClassificationStatus =
  | 'PROPOSED'
  | 'UNDER_REVIEW'
  | 'CONFIRMED'
  | 'DISPUTED'
  | 'REJECTED'
  | 'NOT_CURRENT'
  | 'SUPERSEDED';
export type CustomerMaterialVersionStatus = 'PROPOSED' | 'CONFIRMED';
export type CustomerMaterialDecisionKind = 'PROPOSED' | 'CONFIRMED' | 'DISPUTED' | 'REJECTED';
export type MaterialCompleteness = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'UNREADABLE';

export interface CustomerMaterialTable {
  customer_material_id: string;
  enterprise_id: string;
  project_id: string;
  material_type: string;
  title: string;
  customer_document_number: string | null;
  customer_version_label: string | null;
  effective_date: Date | null;
  declared_status: string;
  completeness: MaterialCompleteness;
  classification_status: CustomerMaterialClassificationStatus;
  current_version_id: string;
  aggregate_version: Int8Default;
  created_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  confirmed_by_principal_id: string | null;
  confirmed_by_actor_snapshot_id: string | null;
  confirmed_at: Date | null;
  updated_at: Date;
  last_command_id: string | null;
  retention_class: string;
}

export interface CustomerMaterialVersionTable {
  version_id: string;
  customer_material_id: string;
  enterprise_id: string;
  project_id: string;
  version_no: number;
  version_status: CustomerMaterialVersionStatus;
  material_type: string;
  title: string;
  customer_document_number: string | null;
  customer_version_label: string | null;
  effective_date: Date | null;
  declared_status: string;
  completeness: MaterialCompleteness;
  source_selections: Json;
  language: string;
  classification_rationale: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  proposed_by_principal_id: string;
  proposed_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
  previous_version_id: string | null;
}

export interface CustomerMaterialDecisionTable {
  decision_id: string;
  customer_material_id: string;
  version_id: string;
  enterprise_id: string;
  project_id: string;
  decision_kind: CustomerMaterialDecisionKind;
  evidence_refs: Json;
  justification: Json;
  payload: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  decided_by_principal_id: string;
  decided_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
}

// IM-03 WI-07 (issue #63): CustomerBaseline keeps Project-scoped epistemic
// states separate from CustomerMaterial custody. The Root owns only pointers;
// Version, Item and ImpactReview rows preserve immutable facts.
export type CustomerBaselineVersionStatus = 'DRAFT' | 'CONFIRMED';
export type CustomerBaselineItemStatus =
  'PRESENT' | 'PARTIAL' | 'MISSING_CONFIRMED' | 'NOT_PROVIDED' | 'UNKNOWN' | 'NOT_APPLICABLE';
export type CustomerBaselineImpactStatus = 'STALE' | 'NO_PRIOR_ACTIVE';

export interface CustomerBaselineTable {
  customer_baseline_id: string;
  enterprise_id: string;
  project_id: string;
  current_version_id: string;
  active_version_id: string | null;
  aggregate_version: Int8Default;
  created_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  updated_at: Date;
  last_command_id: string | null;
  retention_class: string;
}

export interface CustomerBaselineVersionTable {
  version_id: string;
  customer_baseline_id: string;
  enterprise_id: string;
  project_id: string;
  version_no: number;
  version_status: CustomerBaselineVersionStatus;
  previous_version_id: string | null;
  baseline_policy_ref: Json;
  expectations_payload: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  proposed_by_principal_id: string;
  proposed_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  confirmed_by_principal_id: string | null;
  confirmed_by_actor_snapshot_id: string | null;
  confirmed_at: Date | null;
  recorded_at: Date;
  source_command_id: string;
}

export interface CustomerBaselineItemTable {
  expectation_id: string;
  customer_baseline_id: string;
  version_id: string;
  enterprise_id: string;
  project_id: string;
  expected_material_key: string;
  material_type: string;
  expected_title_or_role: string;
  status: CustomerBaselineItemStatus;
  customer_material_refs: Json;
  decision_ref: Json | null;
  reason: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  recorded_by_principal_id: string;
  recorded_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
}

export interface CustomerBaselineImpactReviewTable {
  impact_review_id: string;
  customer_baseline_id: string;
  new_version_id: string;
  previous_active_version_id: string | null;
  enterprise_id: string;
  project_id: string;
  review_snapshot_ref: Json;
  impact_policy_ref: Json;
  justification: Json;
  affected_references: Json;
  stale_references: Json;
  impact_status: CustomerBaselineImpactStatus;
  payload_hash: Buffer;
  canonicalization_version: string;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
}

// IM-03 WI-08 (issue #64): platform-controlled reference facts have no
// Enterprise or Project business scope. The technical transaction scope is
// carried only by the shared receipt/audit/outbox/reference-edge tables.
export type PlatformReferenceStatus = 'ACTIVE' | 'ARCHIVED';
export type PlatformReferenceLifecycle = 'DRAFT' | 'PUBLISHED';

export interface ReferenceTemplateTable {
  reference_template_id: string;
  reference_code: string;
  template_type: string;
  status: PlatformReferenceStatus;
  current_version_id: string | null;
  aggregate_version: Int8Default;
  created_at: Date;
  created_by_principal_id: string;
  updated_at: Date;
  last_command_id: string | null;
}

export interface ReferenceTemplateVersionTable {
  reference_template_version_id: string;
  reference_template_id: string;
  version_no: number;
  version_label: string;
  content_ref: Json;
  content_hash: Buffer;
  source_ref: Json;
  applicability: Json;
  lifecycle: PlatformReferenceLifecycle;
  published_by_principal_id: string | null;
  published_at: Date | null;
  release_decision_ref: Json | null;
  publish_reason: Json | null;
  created_by_principal_id: string;
  recorded_at: Date;
  source_command_id: string;
}

export interface RegulatoryReferenceTable {
  regulatory_reference_id: string;
  authority_code: string;
  jurisdiction: string;
  reference_code: string;
  status: PlatformReferenceStatus;
  current_version_id: string | null;
  aggregate_version: Int8Default;
  created_at: Date;
  created_by_principal_id: string;
  updated_at: Date;
  last_command_id: string | null;
}

export interface RegulatoryReferenceVersionTable {
  regulatory_reference_version_id: string;
  regulatory_reference_id: string;
  version_no: number;
  version_label: string;
  citation: string;
  effective_period: Json;
  source_ref: Json;
  content_ref: Json;
  content_hash: Buffer;
  verification_refs: Json;
  lifecycle: PlatformReferenceLifecycle;
  published_by_principal_id: string | null;
  published_at: Date | null;
  release_decision_ref: Json | null;
  publish_reason: Json | null;
  created_by_principal_id: string;
  recorded_at: Date;
  source_command_id: string;
}

// Project-side frozen reference selections. Every row repeats the owning
// scope so PostgreSQL can enforce cross-row identity with composite FKs.
export type FrozenVersionStatus = 'FROZEN';

export interface TemplateBaselineTable {
  template_baseline_id: string;
  enterprise_id: string;
  project_id: string;
  current_version_id: string;
  active_version_id: string;
  aggregate_version: Int8Default;
  created_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  updated_at: Date;
  last_command_id: string | null;
}

export interface TemplateBaselineVersionTable {
  version_id: string;
  template_baseline_id: string;
  enterprise_id: string;
  project_id: string;
  version_no: number;
  version_status: FrozenVersionStatus;
  previous_version_id: string | null;
  selections_payload: Json;
  review_snapshot_ref: Json;
  selection_rationale: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
}

export interface TemplateSelectionTable {
  selection_id: string;
  template_baseline_id: string;
  version_id: string;
  enterprise_id: string;
  project_id: string;
  delivery_category: string;
  template_ref: Json;
  template_id: string;
  template_version_id: string;
  applicability_scope: Json;
  selection_reason: Json;
  replacement_for: Json | null;
  payload_hash: Buffer;
  canonicalization_version: string;
  recorded_by_principal_id: string;
  recorded_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
}

export interface RegulatoryProfileTable {
  regulatory_profile_id: string;
  enterprise_id: string;
  project_id: string;
  current_version_id: string;
  active_version_id: string;
  aggregate_version: Int8Default;
  created_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  updated_at: Date;
  last_command_id: string | null;
}

export interface RegulatoryProfileVersionTable {
  version_id: string;
  regulatory_profile_id: string;
  enterprise_id: string;
  project_id: string;
  version_no: number;
  version_status: FrozenVersionStatus;
  jurisdiction: string;
  product_scope_snapshot_ref: Json;
  product_scope_snapshot_id: string;
  product_scope_payload_hash: Buffer;
  applicability_payload: Json;
  review_snapshot_ref: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
}

export interface RegulatoryProfileItemTable {
  item_id: string;
  regulatory_profile_id: string;
  version_id: string;
  enterprise_id: string;
  project_id: string;
  regulatory_reference_ref: Json;
  regulatory_reference_id: string;
  regulatory_reference_version_id: string;
  content_hash: Buffer;
  applicability: 'APPLICABLE' | 'NOT_APPLICABLE' | 'PENDING_DETERMINATION';
  rationale: Json;
  evidence_refs: Json;
  risk_level: string;
  payload_hash: Buffer;
  canonicalization_version: string;
  recorded_by_principal_id: string;
  recorded_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
}

// IM-03 WI-09 (issue #65): GapAnalysis preserves the exact input snapshot,
// immutable findings and Human decision history. Root status and pointers are
// the only mutable aggregate projection; stale metadata is an impact fact.
export type GapAnalysisStatus =
  'COMPLETED' | 'UNDER_REVIEW' | 'ACCEPTED' | 'CHANGES_REQUIRED' | 'REJECTED' | 'STALE';
export type GapAnalysisVersionStatus = GapAnalysisStatus;
export type GapAnalysisMode = 'FORMAL' | 'EXPLORATORY';
export type GapAnalysisDisposition = 'ACCEPT' | 'REJECT' | 'CHANGES_REQUIRED';
export type GapFindingSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface GapAnalysisTable {
  gap_analysis_id: string;
  enterprise_id: string;
  project_id: string;
  current_version_id: string;
  accepted_version_id: string | null;
  status: GapAnalysisStatus;
  aggregate_version: Int8Default;
  created_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  updated_at: Date;
  last_command_id: string | null;
  retention_class: string;
}

export interface GapAnalysisInputSnapshotTable {
  input_snapshot_id: string;
  gap_analysis_id: string;
  version_id: string;
  enterprise_id: string;
  project_id: string;
  customer_baseline_ref: Json;
  customer_baseline_id: string;
  customer_baseline_version_id: string;
  template_baseline_ref: Json;
  template_baseline_id: string;
  template_baseline_version_id: string;
  regulatory_profile_ref: Json;
  regulatory_profile_id: string;
  regulatory_profile_version_id: string;
  enterprise_profile_snapshot_ref: Json;
  enterprise_profile_snapshot_id: string;
  enterprise_profile_payload_hash: Buffer;
  qms_configuration_ref: Json;
  qms_configuration_id: string;
  qms_configuration_revision_id: string;
  qms_configuration_revision_hash: Buffer;
  product_scope_snapshot_ref: Json;
  product_scope_snapshot_id: string;
  product_scope_payload_hash: Buffer;
  analysis_policy_ref: Json;
  analysis_policy_id: string;
  analysis_policy_version_id: string;
  payload: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  recorded_by_principal_id: string;
  recorded_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
}

export interface GapAnalysisVersionTable {
  version_id: string;
  gap_analysis_id: string;
  enterprise_id: string;
  project_id: string;
  version_no: number;
  version_status: GapAnalysisVersionStatus;
  mode: GapAnalysisMode;
  input_snapshot_id: string;
  requested_scope: Json;
  findings_summary: Json;
  payload: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  stale_reason: Json | null;
  stale_at: Date | null;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
}

export interface GapFindingTable {
  finding_id: string;
  gap_analysis_id: string;
  version_id: string;
  enterprise_id: string;
  project_id: string;
  subject_key: string;
  subject_type: string;
  customer_baseline_item_refs: Json;
  template_refs: Json;
  regulatory_item_refs: Json;
  gap_status: string;
  severity: GapFindingSeverity;
  rationale: Json;
  evidence_refs: Json;
  recommended_action: string;
  information_request_refs: Json;
  review_disposition: string | null;
  payload_hash: Buffer;
  canonicalization_version: string;
  recorded_by_principal_id: string;
  recorded_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
}

export interface GapAnalysisDecisionTable {
  decision_id: string;
  gap_analysis_id: string;
  version_id: string;
  enterprise_id: string;
  project_id: string;
  review_snapshot_ref: Json;
  disposition: GapAnalysisDisposition;
  justification: Json;
  payload: Json;
  payload_hash: Buffer;
  canonicalization_version: string;
  decided_by_principal_id: string;
  decided_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  recorded_at: Date;
  source_command_id: string;
}
