// IM-03 WI-11 (issue #67): Kysely table types for the rebuildable projection
// schema. Projection rows are supplied by validated Snapshot Export/Event
// Delta inputs; these types do not grant the projection any business-table
// access or cross-schema join capability.

import type { ColumnType } from 'kysely';

type Int8Default = ColumnType<string, string | number | undefined, string | number | undefined>;
type Json = ColumnType<unknown, string>;

export type ProjectionVersionStatus = 'BUILDING' | 'READY' | 'FAILED';
export type ProjectionCheckpointStatus = 'ACTIVE' | 'PAUSED' | 'REBUILDING' | 'FAILED';

export interface ProjectBoardProjectionVersionTable {
  projection_version_id: string;
  enterprise_id: string;
  project_id: string;
  status: ProjectionVersionStatus;
  source_snapshot_hash: Buffer;
  source_event_id: string | null;
  source_sequence: Int8Default;
  source_recorded_at: Date;
  row_count: number;
  domain_checksum: Buffer;
  created_by_principal_id: string;
  created_at: Date;
  ready_at: Date | null;
  failure_code: string | null;
}

export interface ProjectBoardTable {
  projection_version_id: string;
  enterprise_id: string;
  project_id: string;
  delivery_item_id: string;
  item_key: string;
  item_type: string;
  title: string;
  commitment_status: string;
  execution_status: string;
  completion_evaluation_ref: Json | null;
  blocker_refs: Json;
  source_event_id: string | null;
  source_sequence: Int8Default;
  source_recorded_at: Date;
}

export interface ProjectBoardReadAliasTable {
  enterprise_id: string;
  project_id: string;
  projection_version_id: string;
  switched_at: Date;
  switched_by_principal_id: string;
}

export interface ProjectionSourceStateTable {
  enterprise_id: string;
  project_id: string;
  latest_event_id: string | null;
  latest_sequence: Int8Default;
  observed_at: Date;
  updated_by_principal_id: string;
  updated_at: Date;
}

export interface ProjectionCheckpointTable {
  consumer_name: string;
  partition: string;
  enterprise_id: string;
  project_id: string;
  last_event_id: string | null;
  last_sequence: Int8Default;
  target_event_id: string | null;
  target_sequence: Int8Default;
  status: ProjectionCheckpointStatus;
  updated_by_principal_id: string;
  updated_at: Date;
}

export interface ProjectionFailureTable {
  failure_id: string;
  consumer_name: string;
  partition: string;
  enterprise_id: string;
  project_id: string;
  event_id: string | null;
  event_type: string;
  failure_code: string;
  safe_summary: string;
  recorded_at: Date;
  recorded_by_principal_id: string;
}
