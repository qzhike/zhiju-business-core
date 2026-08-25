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
