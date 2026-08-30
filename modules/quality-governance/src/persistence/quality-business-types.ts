// IM-05 WI-02 (issue #122): QualityGovernance-owned Evidence and
// QualityProfile business row contracts. Cross-module references remain JSON
// values because this module must not create cross-schema foreign keys.

export type EvidenceStatus =
  'CANDIDATE' | 'VERIFYING' | 'VERIFIED' | 'DISPUTED' | 'EXPIRED' | 'SUPERSEDED' | 'REVOKED';

export interface EvidenceTable {
  evidence_id: string;
  enterprise_id: string;
  project_id: string | null;
  candidate: unknown;
  candidate_payload_hash: Buffer;
  status: EvidenceStatus;
  impact_status: string;
  aggregate_version: string;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  updated_at: Date;
  last_command_id: string;
}

export interface EvidenceValidationTable {
  validation_id: string;
  evidence_id: string;
  enterprise_id: string;
  project_id: string | null;
  verification: unknown;
  verification_payload_hash: Buffer;
  outcome: 'VERIFIED' | 'DISPUTED';
  verified_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export interface EvidenceRevocationTable {
  revocation_id: string;
  evidence_id: string;
  enterprise_id: string;
  project_id: string | null;
  revocation_reason: unknown;
  impact_assessment_ref: unknown;
  revoked_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export interface EvidenceLinkTable {
  evidence_link_id: string;
  evidence_id: string;
  enterprise_id: string;
  project_id: string | null;
  definition: unknown;
  evidence_payload_hash: Buffer;
  claim_hash: Buffer;
  relation: 'SUPPORTS' | 'CONTRADICTS' | 'CONTEXT_ONLY';
  linked_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export type QualityProfileRootStatus = 'DRAFT' | 'ACTIVE';
export type QualityProfileVersionStatus =
  'DRAFT' | 'UNDER_REVIEW' | 'ACTIVE' | 'SUPERSEDED' | 'RETIRED';

export interface QualityProfileTable {
  quality_profile_id: string;
  enterprise_id: string;
  project_id: string | null;
  name: string;
  status: QualityProfileRootStatus;
  active_version_id: string | null;
  aggregate_version: string;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  updated_at: Date;
  updated_by_principal_id: string;
  updated_by_actor_snapshot_id: string;
  updated_authorization_decision_id: string;
  last_command_id: string;
}

export interface QualityProfileVersionTable {
  profile_version_id: string;
  quality_profile_id: string;
  enterprise_id: string;
  project_id: string | null;
  profile_version: string;
  definition: unknown;
  definition_hash: Buffer;
  status: QualityProfileVersionStatus;
  review_snapshot_ref: unknown;
  validation_snapshot_ref: unknown;
  activated_at: Date | null;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export interface QualityProfileGateSpecTable {
  gate_spec_id: string;
  profile_version_id: string;
  quality_profile_id: string;
  enterprise_id: string;
  project_id: string | null;
  definition: unknown;
  gate_version: string;
  evaluation_stage: string;
  mandatory: boolean;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export interface QualityProfileGateDependencyTable {
  dependency_id: string;
  profile_version_id: string;
  quality_profile_id: string;
  enterprise_id: string;
  project_id: string | null;
  from_gate_spec_id: string;
  to_gate_spec_id: string;
  definition: unknown;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export interface QualityProfileApprovalRequirementTable {
  approval_requirement_id: string;
  profile_version_id: string;
  quality_profile_id: string;
  enterprise_id: string;
  project_id: string | null;
  requirement_order: number;
  definition: unknown;
  required_role: string;
  required_count: number;
  approver_kind: string;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export interface QualityProfileReleaseRequirementTable {
  release_requirement_id: string;
  profile_version_id: string;
  quality_profile_id: string;
  enterprise_id: string;
  project_id: string | null;
  requirement_order: number;
  definition: unknown;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

// IM-05 WI-03 (issue #123): immutable GateResult and readiness fact rows.
// Cross-module references remain JSON values so this module keeps ownership of
// its own facts without introducing cross-schema foreign keys.

export interface ChangeImpactTable {
  change_impact_id: string;
  enterprise_id: string;
  project_id: string | null;
  base_revision_ref: unknown;
  target_revision_ref: unknown;
  changed_units: unknown;
  unchanged_units: unknown;
  affected_claim_refs: unknown;
  affected_evidence_link_refs: unknown;
  affected_gate_spec_ids: unknown;
  toolchain_changes: unknown;
  profile_changes: unknown;
  analysis_method: string;
  analysis_version: string;
  analyzed_by: unknown;
  analyzed_at: Date;
  coverage: unknown;
  definition: unknown;
  payload_hash: Buffer;
  impact_status: 'LIVE' | 'STALE';
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export type GateResultExecutionMode = 'EXECUTED' | 'REUSED_BY_IMPACT_ANALYSIS';

export interface GateResultTable {
  gate_result_id: string;
  enterprise_id: string;
  project_id: string | null;
  artifact_ref: unknown;
  revision_ref: unknown;
  revision_content_hash: Buffer;
  gate_target: unknown;
  evaluation_stage: 'REVISION_ACCEPTANCE' | 'RELEASE_READINESS';
  quality_profile_ref: unknown;
  gate_spec_id: string;
  gate_version: string;
  evaluation_attempt: number;
  execution_mode: GateResultExecutionMode;
  evaluated_scope: unknown;
  input_snapshot_ref: unknown;
  evaluator: unknown;
  outcome: 'PASS' | 'FAIL' | 'ERROR' | 'SKIPPED' | 'NOT_APPLICABLE';
  findings: unknown;
  evidence_refs: unknown;
  review_issue_refs: unknown;
  reuse_source_gate_result_ref: unknown;
  change_impact_ref: unknown;
  started_at: Date;
  completed_at: Date;
  validity_status: 'VALID';
  definition: unknown;
  payload_hash: Buffer;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export interface GateResultReuseTable {
  reuse_id: string;
  gate_result_id: string;
  enterprise_id: string;
  project_id: string | null;
  source_gate_result_ref: unknown;
  source_gate_result_hash: Buffer;
  change_impact_ref: unknown;
  change_impact_hash: Buffer;
  coverage_proof: unknown;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export interface GateInvalidationTable {
  invalidation_id: string;
  gate_result_id: string;
  enterprise_id: string;
  project_id: string | null;
  gate_result_ref: unknown;
  gate_result_hash: Buffer;
  invalidation_reason: unknown;
  impact_assessment_ref: unknown;
  invalidated_at: Date;
  impact_status: 'STALE';
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export interface RevisionAcceptanceSnapshotTable {
  snapshot_id: string;
  enterprise_id: string;
  project_id: string | null;
  artifact_ref: unknown;
  revision_ref: unknown;
  revision_content_hash: Buffer;
  quality_profile_ref: unknown;
  evidence_status_snapshot_ref: unknown;
  issue_snapshot_ref: unknown;
  gate_result_refs: unknown;
  status: 'READY' | 'NOT_READY' | 'STALE';
  snapshot: unknown;
  payload_hash: Buffer;
  evaluated_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}

export interface ReleaseReadinessSnapshotTable {
  snapshot_id: string;
  enterprise_id: string;
  project_id: string | null;
  release_ref: unknown;
  artifact_ref: unknown;
  revision_ref: unknown;
  revision_content_hash: Buffer;
  approval_bundle_snapshot_ref: unknown;
  release_package_ref: unknown;
  package_hash: Buffer;
  representation_refs: unknown;
  recipient_scope_snapshot_ref: unknown;
  destination_refs: unknown;
  release_gate_result_refs: unknown;
  status: 'READY_FOR_AUTHORIZATION' | 'NOT_READY' | 'STALE';
  snapshot: unknown;
  payload_hash: Buffer;
  evaluated_at: Date;
  created_by_principal_id: string;
  created_by_actor_snapshot_id: string;
  created_authorization_decision_id: string;
  created_at: Date;
  source_command_id: string;
}
