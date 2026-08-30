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
