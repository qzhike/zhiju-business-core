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
  member_policy_payload_hash: Buffer;
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
  member_policy_payload_hash: Buffer;
  payload_hash: Buffer;
  canonicalization_version: string;
  bound_at: Date;
  bound_by_principal_id: string;
  bound_by_actor_snapshot_id: string;
  authorization_decision_id: string;
  source_command_id: string;
}
