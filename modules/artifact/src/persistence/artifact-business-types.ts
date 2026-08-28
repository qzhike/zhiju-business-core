// IM-04 WI-03 (issue #92): Artifact Root and Branch row contracts.
// These types intentionally stop at lifecycle and pointer placeholders; they
// do not model Revision, Content Object, Representation or Binding rows.

import type { ColumnType, Generated } from 'kysely';

type Int8 = ColumnType<string, string | number, string | number>;
type Json = ColumnType<unknown, string, string>;

export type ArtifactBusinessScope = 'PROJECT_DELIVERABLE' | 'ENTERPRISE_CONTROLLED';
export type ArtifactLifecycle = 'ACTIVE' | 'ARCHIVED' | 'CANCELLED';
export type ArtifactBranchLifecycle = ArtifactLifecycle;

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
