// IM-04 WI-05/WI-08 (issues #94/#97): Artifact business row contracts for
// immutable Revisions, Representation bindings and append-only facts.

import type { ColumnType, Generated } from 'kysely';

type Int8 = ColumnType<string, string | number, string | number>;
type Json = ColumnType<unknown, string, string>;

export type ArtifactBusinessScope = 'PROJECT_DELIVERABLE' | 'ENTERPRISE_CONTROLLED';
export type ArtifactLifecycle = 'ACTIVE' | 'ARCHIVED' | 'CANCELLED';
export type ArtifactBranchLifecycle = ArtifactLifecycle;
export type ArtifactContentType = 'STRUCTURED_DOCUMENT' | 'WORKBOOK_SPEC';
export type ArtifactContentStorageState = 'STAGING' | 'LINKED' | 'FROZEN' | 'QUARANTINED';
export type ArtifactContentFinalizationState = 'STAGED' | 'FINALIZED' | 'UNKNOWN';
export type ArtifactContentOrphanOutcome =
  'PENDING' | 'LEASED' | 'RETRY' | 'UNKNOWN' | 'DELETED' | 'NOT_FOUND' | 'HELD';

export interface ArtifactTable {
  artifact_id: string;
  enterprise_id: string;
  project_id: string | null;
  business_scope: ArtifactBusinessScope;
  origin_project_ref: Json;
  artifact_type: string;
  title: string;
  classification: string;
  identity_hash: Buffer;
  delivery_item_refs: Json;
  metadata: Json;
  lifecycle_status: ArtifactLifecycle;
  aggregate_version: Int8;
  metadata_version: Int8;
  default_branch_id: string;
  approved_revision_refs: Json;
  effective_binding_refs: Json;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Generated<Date>;
  updated_by_principal_id: string;
  updated_by_actor_snapshot_id: string;
  last_authorization_decision_id: string;
  last_command_id: string;
  updated_at: Generated<Date>;
  archived_at: Date | null;
  archive_reason: Json;
  retention_policy_ref: Json;
  retention_class: string;
}

export interface ArtifactBranchTable {
  branch_id: string;
  artifact_id: string;
  enterprise_id: string;
  project_id: string | null;
  branch_name: string;
  working_head_ref: Json;
  head_version: Int8;
  lifecycle_status: ArtifactBranchLifecycle;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Generated<Date>;
  updated_by_principal_id: string;
  updated_by_actor_snapshot_id: string;
  last_authorization_decision_id: string;
  last_command_id: string;
  updated_at: Generated<Date>;
  retention_class: string;
}

export interface ArtifactContentObjectTable {
  content_object_id: string;
  enterprise_id: string;
  project_id: string | null;
  payload_schema_ref: Json;
  content_type: ArtifactContentType;
  canonicalization_version: string;
  content_hash: Buffer;
  byte_size: Int8;
  media_type: string;
  storage_provider: string;
  object_locator: string;
  object_version_id: string;
  storage_state: ArtifactContentStorageState;
  finalization_state: ArtifactContentFinalizationState;
  finalization_error_code: string | null;
  verified_at: Date;
  linked_at: Date | null;
  finalized_at: Date | null;
  frozen_at: Date | null;
  quarantine_reason: Json;
  retention_class: string;
  retention_until: Date | null;
  legal_hold: boolean;
  aggregate_version: Int8;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Generated<Date>;
  updated_by_principal_id: string;
  updated_by_actor_snapshot_id: string;
  last_authorization_decision_id: string;
  last_command_id: string;
  updated_at: Generated<Date>;
}

export interface ArtifactContentObjectLinkTable {
  content_object_id: string;
  owner_object_type: string;
  owner_object_id: string;
  owner_version_id: string;
  owner_payload_hash: Buffer | null;
  enterprise_id: string;
  project_id: string | null;
  linked_at: Generated<Date>;
  source_command_id: string;
}

export interface ArtifactContentObjectQuarantineTable {
  quarantine_id: string;
  content_object_id: string;
  enterprise_id: string;
  project_id: string | null;
  reason_code: string;
  safe_summary: string;
  content_hash: Buffer | null;
  storage_provider: string;
  object_locator: string;
  object_version_id: string;
  recorded_at: Generated<Date>;
  source_command_id: string | null;
  retention_class: string;
}

export interface ArtifactContentObjectOrphanTable {
  orphan_id: string;
  content_object_id: string;
  enterprise_id: string;
  project_id: string | null;
  content_hash: Buffer;
  byte_size: Int8;
  media_type: string;
  storage_provider: string;
  object_locator: string;
  object_version_id: string;
  storage_state: 'STAGING' | 'QUARANTINED';
  retention_class: string;
  retention_until: Date | null;
  legal_hold: boolean;
  eligible_at: Date;
  next_attempt_at: Date;
  outcome: ArtifactContentOrphanOutcome;
  attempt_count: number;
  lease_owner: string | null;
  lease_until: Date | null;
  lease_token: string | null;
  last_error_code: string | null;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  source_command_id: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type ArtifactRevisionKind = 'INITIAL' | 'ORDINARY' | 'MERGE';
export type ArtifactRevisionDisposition = 'ACTIVE' | 'SUPERSEDED' | 'WITHDRAWN' | 'INVALIDATED';

export interface ArtifactRevisionTable {
  revision_id: string;
  artifact_id: string;
  branch_id: string;
  enterprise_id: string;
  project_id: string | null;
  revision_no: Int8;
  revision_kind: ArtifactRevisionKind;
  content_object_id: string;
  content_type: ArtifactContentType;
  object_locator: string;
  content_hash: Buffer;
  structure_schema_ref: Json;
  canonicalization_version: string;
  byte_size: Int8;
  media_type: string;
  semantic_metadata: Json;
  changed_units: Json;
  change_summary: string;
  provenance: Json;
  aggregate_version: Int8;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Generated<Date>;
  sealed_at: Generated<Date>;
  source_command_id: string;
}

export interface RevisionParentTable {
  artifact_id: string;
  child_revision_id: string;
  parent_revision_id: string;
  parent_order: number;
  relation_kind: Exclude<ArtifactRevisionKind, 'INITIAL'>;
  enterprise_id: string;
  project_id: string | null;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Generated<Date>;
  source_command_id: string;
}

export type RevisionConflictKind = 'BRANCH_HEAD_CAS' | 'MERGE';

export interface RevisionConflictTable {
  conflict_id: string;
  artifact_id: string;
  branch_id: string | null;
  revision_id: string | null;
  enterprise_id: string;
  project_id: string | null;
  conflict_kind: RevisionConflictKind;
  base_revision_ref: Json | null;
  head_revision_ref: Json | null;
  candidate_revision_ref: Json | null;
  conflict_set: Json;
  conflict_payload: Json;
  conflict_hash: Buffer;
  resolution_refs: Json;
  resolved_by_ref: Json | null;
  resolved_at: Date | null;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Generated<Date>;
  source_command_id: string;
}

export interface RevisionWithdrawalTable {
  withdrawal_id: string;
  revision_id: string;
  artifact_id: string;
  enterprise_id: string;
  project_id: string | null;
  revision_ref: Json;
  revision_hash: Buffer;
  withdrawal_reason: Json;
  impact_assessment_ref: Json | null;
  withdrawn_at: Date;
  recorded_by_principal_id: string;
  recorded_by_actor_snapshot_id: string;
  recorded_authorization_decision_id: string;
  recorded_at: Generated<Date>;
  source_command_id: string;
}

export interface RevisionInvalidationTable {
  invalidation_id: string;
  revision_id: string;
  artifact_id: string;
  enterprise_id: string;
  project_id: string | null;
  revision_ref: Json;
  revision_hash: Buffer;
  invalidation_reason: Json;
  impact_assessment_ref: Json;
  invalidated_at: Date;
  recorded_by_principal_id: string;
  recorded_by_actor_snapshot_id: string;
  recorded_authorization_decision_id: string;
  recorded_at: Generated<Date>;
  source_command_id: string;
}

export type ArtifactRepresentationFormat = string;

export interface ArtifactRepresentationTable {
  representation_id: string;
  artifact_id: string;
  revision_id: string;
  revision_ref: Json;
  enterprise_id: string;
  project_id: string | null;
  format: ArtifactRepresentationFormat;
  media_type: string;
  object_locator: string;
  checksum: Buffer;
  renderer_id: string;
  renderer_version: string;
  render_attempt_id: string;
  render_attempt_ref: Json;
  request_payload_hash: Buffer;
  input_hash: Buffer;
  raw_receipt_ref: Json;
  registered_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Generated<Date>;
  source_command_id: string;
}

export interface ArtifactRepresentationValidationTable {
  validation_id: string;
  representation_id: string;
  artifact_id: string;
  revision_id: string;
  enterprise_id: string;
  project_id: string | null;
  binding_operation: 'integration.get_render_attempt_binding';
  validator_id: string;
  validator_version: string;
  outcome: 'VERIFIED';
  request_payload_hash: Buffer;
  input_hash: Buffer;
  output_checksum: Buffer;
  raw_receipt_ref: Json;
  validated_by_principal_id: string;
  validated_by_actor_snapshot_id: string;
  validated_authorization_decision_id: string;
  validated_at: Generated<Date>;
  source_command_id: string;
}
