-- IM-05 WI-04 (issue #124): immutable ReviewIssue remediation, Human Approval,
-- revocation, and ApprovalBundleSnapshot facts. V5000-V5003 remain forward-only
-- history; all new business writes cross owner SECURITY DEFINER functions.

SET ROLE quality_governance_owner;

-- ---------------------------------------------------------------------------
-- ReviewIssue facts
-- ---------------------------------------------------------------------------

CREATE TABLE quality_governance.review_issue (
    review_issue_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    artifact_ref jsonb NOT NULL,
    origin_revision_ref jsonb NOT NULL,
    origin_revision_hash bytea NOT NULL,
    origin_gate_result_ref jsonb,
    issue_type text NOT NULL,
    severity text NOT NULL,
    blocking_classification text NOT NULL,
    statement text NOT NULL,
    locator text NOT NULL,
    evidence_refs jsonb NOT NULL,
    raised_by jsonb NOT NULL,
    raised_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'OPEN',
    aggregate_version bigint NOT NULL DEFAULT 1,
    payload_hash bytea NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid NOT NULL,
    CONSTRAINT review_issue_artifact_ref_object CHECK (jsonb_typeof(artifact_ref) = 'object'),
    CONSTRAINT review_issue_origin_revision_ref_object CHECK (
        jsonb_typeof(origin_revision_ref) = 'object'),
    CONSTRAINT review_issue_origin_gate_result_ref_object CHECK (
        origin_gate_result_ref IS NULL OR jsonb_typeof(origin_gate_result_ref) = 'object'),
    CONSTRAINT review_issue_evidence_refs_array CHECK (jsonb_typeof(evidence_refs) = 'array'),
    CONSTRAINT review_issue_raised_by_object CHECK (jsonb_typeof(raised_by) = 'object'),
    CONSTRAINT review_issue_text_nonempty CHECK (
        btrim(issue_type) <> ''
        AND btrim(severity) <> ''
        AND btrim(blocking_classification) <> ''
        AND btrim(statement) <> ''
        AND btrim(locator) <> ''),
    CONSTRAINT review_issue_origin_hash_len CHECK (octet_length(origin_revision_hash) = 32),
    CONSTRAINT review_issue_payload_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT review_issue_status_closed CHECK (status IN (
        'OPEN', 'ACKNOWLEDGED', 'RESOLUTION_PROPOSED', 'VERIFICATION_PENDING',
        'VERIFIED', 'CLOSED', 'DISMISSED', 'DUPLICATE', 'SUPERSEDED')),
    CONSTRAINT review_issue_version_positive CHECK (aggregate_version >= 1)
);

CREATE INDEX review_issue_scope_status_idx
    ON quality_governance.review_issue (enterprise_id, project_id, status, updated_at DESC);
CREATE INDEX review_issue_origin_idx
    ON quality_governance.review_issue (origin_revision_ref, status);

CREATE TABLE quality_governance.issue_observation (
    observation_id uuid PRIMARY KEY,
    review_issue_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    origin_revision_ref jsonb NOT NULL,
    origin_revision_hash bytea NOT NULL,
    origin_gate_result_ref jsonb,
    evidence_refs jsonb NOT NULL,
    definition jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    observed_at timestamptz NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT issue_observation_revision_ref_object CHECK (
        jsonb_typeof(origin_revision_ref) = 'object'),
    CONSTRAINT issue_observation_gate_ref_object CHECK (
        origin_gate_result_ref IS NULL OR jsonb_typeof(origin_gate_result_ref) = 'object'),
    CONSTRAINT issue_observation_evidence_refs_array CHECK (jsonb_typeof(evidence_refs) = 'array'),
    CONSTRAINT issue_observation_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT issue_observation_revision_hash_len CHECK (octet_length(origin_revision_hash) = 32),
    CONSTRAINT issue_observation_payload_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT issue_observation_issue_fk FOREIGN KEY (review_issue_id)
        REFERENCES quality_governance.review_issue (review_issue_id) ON DELETE RESTRICT
);

CREATE INDEX issue_observation_issue_idx
    ON quality_governance.issue_observation (review_issue_id, observed_at DESC);

CREATE TABLE quality_governance.resolution_proposal (
    resolution_id uuid PRIMARY KEY,
    review_issue_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    target_revision_ref jsonb NOT NULL,
    target_revision_hash bytea NOT NULL,
    changed_claim_refs jsonb NOT NULL,
    explanation text NOT NULL,
    proposed_by jsonb NOT NULL,
    proposed_at timestamptz NOT NULL,
    definition jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT resolution_proposal_target_revision_object CHECK (
        jsonb_typeof(target_revision_ref) = 'object'),
    CONSTRAINT resolution_proposal_changed_claims_array CHECK (
        jsonb_typeof(changed_claim_refs) = 'array'),
    CONSTRAINT resolution_proposal_proposer_object CHECK (jsonb_typeof(proposed_by) = 'object'),
    CONSTRAINT resolution_proposal_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT resolution_proposal_text_nonempty CHECK (btrim(explanation) <> ''),
    CONSTRAINT resolution_proposal_target_hash_len CHECK (octet_length(target_revision_hash) = 32),
    CONSTRAINT resolution_proposal_payload_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT resolution_proposal_issue_fk FOREIGN KEY (review_issue_id)
        REFERENCES quality_governance.review_issue (review_issue_id) ON DELETE RESTRICT
);

CREATE INDEX resolution_proposal_issue_idx
    ON quality_governance.resolution_proposal (review_issue_id, proposed_at DESC);

CREATE TABLE quality_governance.verification_record (
    verification_id uuid PRIMARY KEY,
    review_issue_id uuid NOT NULL,
    resolution_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    target_revision_ref jsonb NOT NULL,
    target_revision_hash bytea NOT NULL,
    verifier jsonb NOT NULL,
    supporting_gate_result_refs jsonb NOT NULL,
    outcome text NOT NULL,
    verified_at timestamptz NOT NULL,
    definition jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT verification_record_target_revision_object CHECK (
        jsonb_typeof(target_revision_ref) = 'object'),
    CONSTRAINT verification_record_verifier_object CHECK (jsonb_typeof(verifier) = 'object'),
    CONSTRAINT verification_record_gate_refs_array CHECK (
        jsonb_typeof(supporting_gate_result_refs) = 'array'),
    CONSTRAINT verification_record_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT verification_record_outcome_closed CHECK (outcome IN ('VERIFIED', 'REJECTED')),
    CONSTRAINT verification_record_target_hash_len CHECK (octet_length(target_revision_hash) = 32),
    CONSTRAINT verification_record_payload_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT verification_record_issue_fk FOREIGN KEY (review_issue_id)
        REFERENCES quality_governance.review_issue (review_issue_id) ON DELETE RESTRICT,
    CONSTRAINT verification_record_resolution_fk FOREIGN KEY (resolution_id)
        REFERENCES quality_governance.resolution_proposal (resolution_id) ON DELETE RESTRICT
);

CREATE INDEX verification_record_issue_idx
    ON quality_governance.verification_record (review_issue_id, verified_at DESC);

CREATE TABLE quality_governance.issue_state_transition (
    transition_id uuid PRIMARY KEY,
    review_issue_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    from_status text NOT NULL,
    to_status text NOT NULL,
    cause_ref jsonb,
    reason jsonb NOT NULL,
    transitioned_at timestamptz NOT NULL,
    definition jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT issue_transition_from_status_closed CHECK (from_status IN (
        'OPEN', 'ACKNOWLEDGED', 'RESOLUTION_PROPOSED', 'VERIFICATION_PENDING',
        'VERIFIED', 'CLOSED', 'DISMISSED', 'DUPLICATE', 'SUPERSEDED')),
    CONSTRAINT issue_transition_to_status_closed CHECK (to_status IN (
        'OPEN', 'ACKNOWLEDGED', 'RESOLUTION_PROPOSED', 'VERIFICATION_PENDING',
        'VERIFIED', 'CLOSED', 'DISMISSED', 'DUPLICATE', 'SUPERSEDED')),
    CONSTRAINT issue_transition_cause_object CHECK (
        cause_ref IS NULL OR jsonb_typeof(cause_ref) = 'object'),
    CONSTRAINT issue_transition_reason_object CHECK (jsonb_typeof(reason) = 'object'),
    CONSTRAINT issue_transition_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT issue_transition_payload_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT issue_transition_issue_fk FOREIGN KEY (review_issue_id)
        REFERENCES quality_governance.review_issue (review_issue_id) ON DELETE RESTRICT
);

CREATE INDEX issue_state_transition_issue_idx
    ON quality_governance.issue_state_transition (review_issue_id, transitioned_at, transition_id);

-- ---------------------------------------------------------------------------
-- Approval and ApprovalBundleSnapshot facts
-- ---------------------------------------------------------------------------

CREATE TABLE quality_governance.approval_request (
    request_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    artifact_ref jsonb NOT NULL,
    revision_ref jsonb NOT NULL,
    revision_content_hash bytea NOT NULL,
    revision_acceptance_snapshot_ref jsonb NOT NULL,
    revision_acceptance_snapshot_hash bytea NOT NULL,
    quality_profile_ref jsonb NOT NULL,
    approval_requirement_id uuid NOT NULL,
    requested_approver_role text NOT NULL,
    expires_at timestamptz,
    request_nonce_hash bytea NOT NULL,
    status text NOT NULL DEFAULT 'OPEN',
    definition jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT approval_request_artifact_ref_object CHECK (jsonb_typeof(artifact_ref) = 'object'),
    CONSTRAINT approval_request_revision_ref_object CHECK (jsonb_typeof(revision_ref) = 'object'),
    CONSTRAINT approval_request_ras_ref_object CHECK (
        jsonb_typeof(revision_acceptance_snapshot_ref) = 'object'),
    CONSTRAINT approval_request_profile_ref_object CHECK (jsonb_typeof(quality_profile_ref) = 'object'),
    CONSTRAINT approval_request_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT approval_request_role_nonempty CHECK (btrim(requested_approver_role) <> ''),
    CONSTRAINT approval_request_revision_hash_len CHECK (octet_length(revision_content_hash) = 32),
    CONSTRAINT approval_request_ras_hash_len CHECK (
        octet_length(revision_acceptance_snapshot_hash) = 32),
    CONSTRAINT approval_request_nonce_hash_len CHECK (octet_length(request_nonce_hash) = 32),
    CONSTRAINT approval_request_payload_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT approval_request_status_closed CHECK (status IN ('OPEN', 'EXPIRED', 'FULFILLED', 'REVOKED')),
    CONSTRAINT approval_request_nonce_unique UNIQUE (enterprise_id, request_nonce_hash)
);

CREATE INDEX approval_request_target_idx
    ON quality_governance.approval_request (enterprise_id, project_id, revision_ref, created_at DESC);

CREATE TABLE quality_governance.approval (
    approval_id uuid PRIMARY KEY,
    request_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    artifact_ref jsonb NOT NULL,
    revision_ref jsonb NOT NULL,
    revision_content_hash bytea NOT NULL,
    revision_acceptance_snapshot_ref jsonb NOT NULL,
    revision_acceptance_snapshot_hash bytea NOT NULL,
    quality_profile_ref jsonb NOT NULL,
    approval_requirement_id uuid NOT NULL,
    decision text NOT NULL,
    status text NOT NULL,
    aggregate_version bigint NOT NULL DEFAULT 1,
    payload_hash bytea NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid NOT NULL,
    CONSTRAINT approval_artifact_ref_object CHECK (jsonb_typeof(artifact_ref) = 'object'),
    CONSTRAINT approval_revision_ref_object CHECK (jsonb_typeof(revision_ref) = 'object'),
    CONSTRAINT approval_ras_ref_object CHECK (jsonb_typeof(revision_acceptance_snapshot_ref) = 'object'),
    CONSTRAINT approval_profile_ref_object CHECK (jsonb_typeof(quality_profile_ref) = 'object'),
    CONSTRAINT approval_decision_closed CHECK (
        decision IN ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED')),
    CONSTRAINT approval_status_closed CHECK (
        status IN ('EFFECTIVE', 'REVOKED', 'STALE', 'INVALID', 'SUPERSEDED')),
    CONSTRAINT approval_revision_hash_len CHECK (octet_length(revision_content_hash) = 32),
    CONSTRAINT approval_ras_hash_len CHECK (octet_length(revision_acceptance_snapshot_hash) = 32),
    CONSTRAINT approval_payload_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT approval_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT approval_request_fk FOREIGN KEY (request_id)
        REFERENCES quality_governance.approval_request (request_id) ON DELETE RESTRICT
);

CREATE INDEX approval_target_idx
    ON quality_governance.approval (enterprise_id, project_id, revision_ref, approval_requirement_id, created_at DESC);

CREATE TABLE quality_governance.approval_decision (
    decision_id uuid PRIMARY KEY,
    approval_id uuid NOT NULL,
    request_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    revision_ref jsonb NOT NULL,
    revision_content_hash bytea NOT NULL,
    revision_acceptance_snapshot_ref jsonb NOT NULL,
    revision_acceptance_snapshot_hash bytea NOT NULL,
    approval_requirement_id uuid NOT NULL,
    decision text NOT NULL,
    decision_comment text NOT NULL,
    approver_human_principal_ref jsonb NOT NULL,
    approver_role_snapshot_ref jsonb NOT NULL,
    authorization_decision_ref jsonb NOT NULL,
    separation_check_ref jsonb NOT NULL,
    decided_at timestamptz NOT NULL,
    definition jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT approval_decision_revision_ref_object CHECK (jsonb_typeof(revision_ref) = 'object'),
    CONSTRAINT approval_decision_ras_ref_object CHECK (
        jsonb_typeof(revision_acceptance_snapshot_ref) = 'object'),
    CONSTRAINT approval_decision_human_principal_object CHECK (
        jsonb_typeof(approver_human_principal_ref) = 'object'
        AND approver_human_principal_ref->>'principalKind' = 'HUMAN'),
    CONSTRAINT approval_decision_role_snapshot_object CHECK (
        jsonb_typeof(approver_role_snapshot_ref) = 'object'),
    CONSTRAINT approval_decision_authorization_object CHECK (
        jsonb_typeof(authorization_decision_ref) = 'object'),
    CONSTRAINT approval_decision_separation_object CHECK (
        jsonb_typeof(separation_check_ref) = 'object'),
    CONSTRAINT approval_decision_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT approval_decision_comment_nonempty CHECK (btrim(decision_comment) <> ''),
    CONSTRAINT approval_decision_closed CHECK (
        decision IN ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED')),
    CONSTRAINT approval_decision_revision_hash_len CHECK (octet_length(revision_content_hash) = 32),
    CONSTRAINT approval_decision_ras_hash_len CHECK (
        octet_length(revision_acceptance_snapshot_hash) = 32),
    CONSTRAINT approval_decision_payload_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT approval_decision_request_approver_unique
        UNIQUE (request_id, approver_human_principal_ref),
    CONSTRAINT approval_decision_approval_fk FOREIGN KEY (approval_id)
        REFERENCES quality_governance.approval (approval_id) ON DELETE RESTRICT,
    CONSTRAINT approval_decision_request_fk FOREIGN KEY (request_id)
        REFERENCES quality_governance.approval_request (request_id) ON DELETE RESTRICT
);

CREATE INDEX approval_decision_target_idx
    ON quality_governance.approval_decision (enterprise_id, project_id, revision_ref, approval_requirement_id);

CREATE TABLE quality_governance.approval_revocation (
    revocation_id uuid PRIMARY KEY,
    approval_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    approval_ref jsonb NOT NULL,
    approval_hash bytea NOT NULL,
    approval_decision_ref jsonb NOT NULL,
    approval_decision_hash bytea NOT NULL,
    revocation_reason jsonb NOT NULL,
    impact_assessment_ref jsonb NOT NULL,
    revoked_at timestamptz NOT NULL,
    definition jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT approval_revocation_approval_ref_object CHECK (jsonb_typeof(approval_ref) = 'object'),
    CONSTRAINT approval_revocation_decision_ref_object CHECK (
        jsonb_typeof(approval_decision_ref) = 'object'),
    CONSTRAINT approval_revocation_reason_object CHECK (jsonb_typeof(revocation_reason) = 'object'),
    CONSTRAINT approval_revocation_impact_ref_object CHECK (
        jsonb_typeof(impact_assessment_ref) = 'object'),
    CONSTRAINT approval_revocation_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT approval_revocation_approval_hash_len CHECK (octet_length(approval_hash) = 32),
    CONSTRAINT approval_revocation_decision_hash_len CHECK (
        octet_length(approval_decision_hash) = 32),
    CONSTRAINT approval_revocation_payload_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT approval_revocation_one_per_approval UNIQUE (approval_id),
    CONSTRAINT approval_revocation_approval_fk FOREIGN KEY (approval_id)
        REFERENCES quality_governance.approval (approval_id) ON DELETE RESTRICT
);

CREATE INDEX approval_revocation_scope_idx
    ON quality_governance.approval_revocation (enterprise_id, project_id, revoked_at DESC);

CREATE TABLE quality_governance.approval_bundle_snapshot (
    snapshot_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    artifact_ref jsonb NOT NULL,
    revision_ref jsonb NOT NULL,
    revision_content_hash bytea NOT NULL,
    revision_acceptance_snapshot_ref jsonb NOT NULL,
    quality_profile_ref jsonb NOT NULL,
    approval_requirements jsonb NOT NULL,
    approval_refs jsonb NOT NULL,
    separation_of_duties_result jsonb NOT NULL,
    authorization_snapshot_refs jsonb NOT NULL,
    completeness jsonb NOT NULL,
    snapshot jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    evaluated_at timestamptz NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT approval_bundle_artifact_ref_object CHECK (jsonb_typeof(artifact_ref) = 'object'),
    CONSTRAINT approval_bundle_revision_ref_object CHECK (jsonb_typeof(revision_ref) = 'object'),
    CONSTRAINT approval_bundle_ras_ref_object CHECK (
        jsonb_typeof(revision_acceptance_snapshot_ref) = 'object'),
    CONSTRAINT approval_bundle_profile_ref_object CHECK (jsonb_typeof(quality_profile_ref) = 'object'),
    CONSTRAINT approval_bundle_array_fields CHECK (
        jsonb_typeof(approval_requirements) = 'array'
        AND jsonb_typeof(approval_refs) = 'array'
        AND jsonb_typeof(authorization_snapshot_refs) = 'array'),
    CONSTRAINT approval_bundle_result_objects CHECK (
        jsonb_typeof(separation_of_duties_result) = 'object'
        AND jsonb_typeof(completeness) = 'object'
        AND jsonb_typeof(snapshot) = 'object'),
    CONSTRAINT approval_bundle_revision_hash_len CHECK (octet_length(revision_content_hash) = 32),
    CONSTRAINT approval_bundle_payload_hash_len CHECK (octet_length(payload_hash) = 32)
);

CREATE INDEX approval_bundle_target_idx
    ON quality_governance.approval_bundle_snapshot
       (enterprise_id, project_id, revision_ref, evaluated_at DESC);

-- ---------------------------------------------------------------------------
-- Aggregate and append-only guards
-- ---------------------------------------------------------------------------

CREATE FUNCTION quality_governance.guard_review_issue_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF current_user <> 'quality_governance_owner'
       OR coalesce(current_setting('quality_governance.allow_aggregate_transition', true), 'off') <> 'on' THEN
        RAISE EXCEPTION 'ReviewIssue aggregate changes require the owner transition function'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'ReviewIssue root is immutable and cannot be deleted'
            USING ERRCODE = '55000';
    END IF;
    IF NEW.review_issue_id IS DISTINCT FROM OLD.review_issue_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.artifact_ref IS DISTINCT FROM OLD.artifact_ref
       OR NEW.origin_revision_ref IS DISTINCT FROM OLD.origin_revision_ref
       OR NEW.origin_revision_hash IS DISTINCT FROM OLD.origin_revision_hash
       OR NEW.origin_gate_result_ref IS DISTINCT FROM OLD.origin_gate_result_ref
       OR NEW.issue_type IS DISTINCT FROM OLD.issue_type
       OR NEW.severity IS DISTINCT FROM OLD.severity
       OR NEW.blocking_classification IS DISTINCT FROM OLD.blocking_classification
       OR NEW.statement IS DISTINCT FROM OLD.statement
       OR NEW.locator IS DISTINCT FROM OLD.locator
       OR NEW.evidence_refs IS DISTINCT FROM OLD.evidence_refs
       OR NEW.raised_by IS DISTINCT FROM OLD.raised_by
       OR NEW.raised_at IS DISTINCT FROM OLD.raised_at
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.created_authorization_decision_id IS DISTINCT FROM OLD.created_authorization_decision_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.aggregate_version <= OLD.aggregate_version THEN
        RAISE EXCEPTION 'ReviewIssue original facts are immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION quality_governance.guard_approval_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF current_user <> 'quality_governance_owner'
       OR coalesce(current_setting('quality_governance.allow_aggregate_transition', true), 'off') <> 'on' THEN
        RAISE EXCEPTION 'Approval aggregate changes require the owner transition function'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Approval root is immutable and cannot be deleted'
            USING ERRCODE = '55000';
    END IF;
    IF NEW.approval_id IS DISTINCT FROM OLD.approval_id
       OR NEW.request_id IS DISTINCT FROM OLD.request_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.artifact_ref IS DISTINCT FROM OLD.artifact_ref
       OR NEW.revision_ref IS DISTINCT FROM OLD.revision_ref
       OR NEW.revision_content_hash IS DISTINCT FROM OLD.revision_content_hash
       OR NEW.revision_acceptance_snapshot_ref IS DISTINCT FROM OLD.revision_acceptance_snapshot_ref
       OR NEW.revision_acceptance_snapshot_hash IS DISTINCT FROM OLD.revision_acceptance_snapshot_hash
       OR NEW.quality_profile_ref IS DISTINCT FROM OLD.quality_profile_ref
       OR NEW.approval_requirement_id IS DISTINCT FROM OLD.approval_requirement_id
       OR NEW.decision IS DISTINCT FROM OLD.decision
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.created_authorization_decision_id IS DISTINCT FROM OLD.created_authorization_decision_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.aggregate_version <= OLD.aggregate_version THEN
        RAISE EXCEPTION 'Approval decision facts are immutable'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE TRIGGER review_issue_insert_guard
    BEFORE INSERT ON quality_governance.review_issue
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER review_issue_update_guard
    BEFORE UPDATE OR DELETE ON quality_governance.review_issue
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_review_issue_update();
CREATE TRIGGER issue_observation_insert_guard
    BEFORE INSERT ON quality_governance.issue_observation
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER issue_observation_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.issue_observation
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();
CREATE TRIGGER resolution_proposal_insert_guard
    BEFORE INSERT ON quality_governance.resolution_proposal
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER resolution_proposal_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.resolution_proposal
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();
CREATE TRIGGER verification_record_insert_guard
    BEFORE INSERT ON quality_governance.verification_record
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER verification_record_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.verification_record
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();
CREATE TRIGGER issue_state_transition_insert_guard
    BEFORE INSERT ON quality_governance.issue_state_transition
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER issue_state_transition_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.issue_state_transition
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();

CREATE TRIGGER approval_request_insert_guard
    BEFORE INSERT ON quality_governance.approval_request
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER approval_request_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.approval_request
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();
CREATE TRIGGER approval_insert_guard
    BEFORE INSERT ON quality_governance.approval
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER approval_update_guard
    BEFORE UPDATE OR DELETE ON quality_governance.approval
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_approval_update();
CREATE TRIGGER approval_decision_insert_guard
    BEFORE INSERT ON quality_governance.approval_decision
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER approval_decision_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.approval_decision
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();
CREATE TRIGGER approval_revocation_insert_guard
    BEFORE INSERT ON quality_governance.approval_revocation
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER approval_revocation_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.approval_revocation
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();
CREATE TRIGGER approval_bundle_snapshot_insert_guard
    BEFORE INSERT ON quality_governance.approval_bundle_snapshot
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER approval_bundle_snapshot_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.approval_bundle_snapshot
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();

-- ---------------------------------------------------------------------------
-- Owner write functions
-- ---------------------------------------------------------------------------

CREATE FUNCTION quality_governance.create_review_issue(
    p_review_issue_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_definition jsonb,
    p_raised_by jsonb,
    p_payload_hash bytea,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    revision_hash bytea;
BEGIN
    PERFORM quality_governance.assert_business_write_context(
        p_enterprise_id, p_project_id, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id);
    IF p_definition IS NULL OR jsonb_typeof(p_definition) <> 'object'
       OR p_raised_by IS NULL OR jsonb_typeof(p_raised_by) <> 'object'
       OR p_payload_hash IS NULL OR octet_length(p_payload_hash) <> 32
       OR p_definition->'originRevisionRef' IS NULL
       OR p_definition->'originRevisionRef'->'contentHash' IS NULL THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    revision_hash := decode(p_definition->'originRevisionRef'->'contentHash'->>'digest', 'hex');
    IF octet_length(revision_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM quality_governance.review_issue
         WHERE review_issue_id = p_review_issue_id) THEN
        RETURN QUERY SELECT 'CONFLICT';
        RETURN;
    END IF;
    INSERT INTO quality_governance.review_issue (
        review_issue_id, enterprise_id, project_id, artifact_ref,
        origin_revision_ref, origin_revision_hash, origin_gate_result_ref,
        issue_type, severity, blocking_classification, statement, locator,
        evidence_refs, raised_by, raised_at, status, aggregate_version,
        payload_hash, created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, last_command_id)
    VALUES (
        p_review_issue_id, p_enterprise_id, p_project_id,
        p_definition->'artifactRef', p_definition->'originRevisionRef', revision_hash,
        p_definition->'originGateResultRef', p_definition->>'issueType',
        p_definition->>'severity', p_definition->>'blockingClassification',
        p_definition->>'statement', p_definition->>'locator',
        p_definition->'evidenceRefs', p_raised_by, (p_definition->>'raisedAt')::timestamptz,
        'OPEN', 1, p_payload_hash, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
        p_source_command_id);
    INSERT INTO quality_governance.issue_observation (
        observation_id, review_issue_id, enterprise_id, project_id,
        origin_revision_ref, origin_revision_hash, origin_gate_result_ref,
        evidence_refs, definition, payload_hash, observed_at,
        created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        uuidv7(), p_review_issue_id, p_enterprise_id, p_project_id,
        p_definition->'originRevisionRef', revision_hash,
        p_definition->'originGateResultRef', p_definition->'evidenceRefs',
        p_definition, p_payload_hash, (p_definition->>'raisedAt')::timestamptz,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id);
    RETURN QUERY SELECT 'OK';
EXCEPTION
    WHEN not_null_violation OR check_violation OR invalid_text_representation THEN
        RETURN QUERY SELECT 'INVALID';
    WHEN unique_violation THEN
        RETURN QUERY SELECT 'CONFLICT';
END
$fn$;

CREATE FUNCTION quality_governance.append_issue_resolution(
    p_resolution_id uuid,
    p_review_issue_id uuid,
    p_expected_version bigint,
    p_definition jsonb,
    p_payload_hash bytea,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    issue_row quality_governance.review_issue%ROWTYPE;
    next_version bigint;
BEGIN
    SELECT * INTO issue_row
      FROM quality_governance.review_issue
     WHERE review_issue_id = p_review_issue_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint; RETURN; END IF;
    PERFORM quality_governance.assert_business_write_context(
        issue_row.enterprise_id, issue_row.project_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id);
    IF issue_row.aggregate_version <> p_expected_version THEN
        RETURN QUERY SELECT 'CONFLICT', issue_row.aggregate_version;
        RETURN;
    END IF;
    IF issue_row.status IN ('CLOSED', 'DISMISSED', 'DUPLICATE', 'SUPERSEDED')
       OR p_definition IS NULL OR jsonb_typeof(p_definition) <> 'object'
       OR p_definition->'resolution' IS NULL
       OR p_definition->'proposedBy' IS NULL
       OR p_payload_hash IS NULL OR octet_length(p_payload_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID', issue_row.aggregate_version;
        RETURN;
    END IF;
    INSERT INTO quality_governance.resolution_proposal (
        resolution_id, review_issue_id, enterprise_id, project_id,
        target_revision_ref, target_revision_hash, changed_claim_refs,
        explanation, proposed_by, proposed_at, definition, payload_hash,
        created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_resolution_id, issue_row.review_issue_id, issue_row.enterprise_id,
        issue_row.project_id, p_definition->'resolution'->'targetRevisionRef',
        decode(p_definition->'resolution'->'targetRevisionRef'->'contentHash'->>'digest', 'hex'),
        p_definition->'resolution'->'changedClaimRefs',
        p_definition->'resolution'->>'explanation', p_definition->'proposedBy',
        (p_definition->'resolution'->>'proposedAt')::timestamptz,
        p_definition, p_payload_hash, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
        p_source_command_id);
    next_version := issue_row.aggregate_version + 1;
    INSERT INTO quality_governance.issue_state_transition (
        transition_id, review_issue_id, enterprise_id, project_id,
        from_status, to_status, cause_ref, reason, transitioned_at,
        definition, payload_hash, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id,
        source_command_id)
    VALUES (
        uuidv7(), issue_row.review_issue_id, issue_row.enterprise_id, issue_row.project_id,
        issue_row.status, 'RESOLUTION_PROPOSED',
        jsonb_build_object('kind', 'OBJECT', 'objectType', 'quality.resolution_proposal',
                           'objectId', p_resolution_id, 'scope',
                           jsonb_build_object('enterpriseId', issue_row.enterprise_id)),
        jsonb_build_object('reasonCode', 'QUALITY_ISSUE_RESOLUTION_PROPOSED'),
        (p_definition->'resolution'->>'proposedAt')::timestamptz,
        p_definition, p_payload_hash, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
        p_source_command_id);
    PERFORM set_config('quality_governance.allow_aggregate_transition', 'on', true);
    UPDATE quality_governance.review_issue
       SET status = 'RESOLUTION_PROPOSED', aggregate_version = next_version,
           updated_at = clock_timestamp(), last_command_id = p_source_command_id
     WHERE review_issue_id = issue_row.review_issue_id;
    PERFORM set_config('quality_governance.allow_aggregate_transition', 'off', true);
    RETURN QUERY SELECT 'OK', next_version;
EXCEPTION
    WHEN not_null_violation OR check_violation OR invalid_text_representation THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint;
    WHEN unique_violation THEN
        RETURN QUERY SELECT 'CONFLICT', NULL::bigint;
END
$fn$;

CREATE FUNCTION quality_governance.append_issue_verification(
    p_verification_id uuid,
    p_review_issue_id uuid,
    p_resolution_id uuid,
    p_expected_version bigint,
    p_definition jsonb,
    p_payload_hash bytea,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    issue_row quality_governance.review_issue%ROWTYPE;
    resolution_row quality_governance.resolution_proposal%ROWTYPE;
    next_version bigint;
    next_status text;
BEGIN
    SELECT * INTO issue_row
      FROM quality_governance.review_issue
     WHERE review_issue_id = p_review_issue_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint; RETURN; END IF;
    SELECT * INTO resolution_row
      FROM quality_governance.resolution_proposal
     WHERE resolution_id = p_resolution_id
       AND review_issue_id = p_review_issue_id;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', issue_row.aggregate_version; RETURN; END IF;
    PERFORM quality_governance.assert_business_write_context(
        issue_row.enterprise_id, issue_row.project_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id);
    IF issue_row.aggregate_version <> p_expected_version THEN
        RETURN QUERY SELECT 'CONFLICT', issue_row.aggregate_version;
        RETURN;
    END IF;
    IF issue_row.status NOT IN ('RESOLUTION_PROPOSED', 'VERIFICATION_PENDING')
       OR p_definition IS NULL OR jsonb_typeof(p_definition) <> 'object'
       OR p_definition->'verification' IS NULL
       OR p_payload_hash IS NULL OR octet_length(p_payload_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID', issue_row.aggregate_version;
        RETURN;
    END IF;
    IF p_definition->'verification'->'targetRevisionRef' IS DISTINCT FROM
       resolution_row.target_revision_ref THEN
        RETURN QUERY SELECT 'INVALID', issue_row.aggregate_version;
        RETURN;
    END IF;
    next_status := CASE WHEN p_definition->'verification'->>'outcome' = 'VERIFIED'
                        THEN 'VERIFIED' ELSE 'RESOLUTION_PROPOSED' END;
    INSERT INTO quality_governance.verification_record (
        verification_id, review_issue_id, resolution_id, enterprise_id, project_id,
        target_revision_ref, target_revision_hash, verifier,
        supporting_gate_result_refs, outcome, verified_at, definition, payload_hash,
        created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_verification_id, issue_row.review_issue_id, p_resolution_id,
        issue_row.enterprise_id, issue_row.project_id,
        p_definition->'verification'->'targetRevisionRef',
        decode(p_definition->'verification'->'targetRevisionRef'->'contentHash'->>'digest', 'hex'),
        p_definition->'verification'->'verifier',
        p_definition->'verification'->'supportingGateResultRefs',
        p_definition->'verification'->>'outcome',
        (p_definition->'verification'->>'verifiedAt')::timestamptz,
        p_definition, p_payload_hash, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
        p_source_command_id);
    next_version := issue_row.aggregate_version + 1;
    INSERT INTO quality_governance.issue_state_transition (
        transition_id, review_issue_id, enterprise_id, project_id,
        from_status, to_status, cause_ref, reason, transitioned_at,
        definition, payload_hash, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id,
        source_command_id)
    VALUES (
        uuidv7(), issue_row.review_issue_id, issue_row.enterprise_id, issue_row.project_id,
        issue_row.status, next_status,
        jsonb_build_object('kind', 'CONTENT_ADDRESSED', 'objectType', 'quality.issue_verification',
                           'objectId', p_verification_id, 'scope',
                           jsonb_build_object('enterpriseId', issue_row.enterprise_id),
                           'contentHash', jsonb_build_object('algorithm', 'SHA-256',
                               'digest', encode(p_payload_hash, 'hex'),
                               'canonicalizationVersion', '1')),
        jsonb_build_object('reasonCode', CASE WHEN next_status = 'VERIFIED'
                                              THEN 'QUALITY_ISSUE_VERIFIED'
                                              ELSE 'QUALITY_ISSUE_VERIFICATION_REJECTED' END),
        (p_definition->'verification'->>'verifiedAt')::timestamptz,
        p_definition, p_payload_hash, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
        p_source_command_id);
    PERFORM set_config('quality_governance.allow_aggregate_transition', 'on', true);
    UPDATE quality_governance.review_issue
       SET status = next_status, aggregate_version = next_version,
           updated_at = clock_timestamp(), last_command_id = p_source_command_id
     WHERE review_issue_id = issue_row.review_issue_id;
    PERFORM set_config('quality_governance.allow_aggregate_transition', 'off', true);
    RETURN QUERY SELECT 'OK', next_version;
EXCEPTION
    WHEN not_null_violation OR check_violation OR invalid_text_representation THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint;
    WHEN unique_violation THEN
        RETURN QUERY SELECT 'CONFLICT', NULL::bigint;
END
$fn$;

CREATE FUNCTION quality_governance.close_review_issue(
    p_review_issue_id uuid,
    p_expected_version bigint,
    p_verification_ref jsonb,
    p_verification_hash bytea,
    p_close_reason jsonb,
    p_closed_at timestamptz,
    p_transition_id uuid,
    p_payload_hash bytea,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    issue_row quality_governance.review_issue%ROWTYPE;
    verification_row quality_governance.verification_record%ROWTYPE;
    next_version bigint;
BEGIN
    SELECT * INTO issue_row
      FROM quality_governance.review_issue
     WHERE review_issue_id = p_review_issue_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint; RETURN; END IF;
    PERFORM quality_governance.assert_business_write_context(
        issue_row.enterprise_id, issue_row.project_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id);
    IF issue_row.aggregate_version <> p_expected_version THEN
        RETURN QUERY SELECT 'CONFLICT', issue_row.aggregate_version;
        RETURN;
    END IF;
    IF issue_row.status <> 'VERIFIED'
       OR p_verification_ref IS NULL OR jsonb_typeof(p_verification_ref) <> 'object'
       OR p_verification_hash IS NULL OR octet_length(p_verification_hash) <> 32
       OR p_close_reason IS NULL OR jsonb_typeof(p_close_reason) <> 'object'
       OR p_payload_hash IS NULL OR octet_length(p_payload_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID', issue_row.aggregate_version;
        RETURN;
    END IF;
    SELECT * INTO verification_row
      FROM quality_governance.verification_record
     WHERE verification_id = (p_verification_ref->>'objectId')::uuid
       AND review_issue_id = issue_row.review_issue_id
       AND payload_hash = p_verification_hash
       AND verification_record.outcome = 'VERIFIED';
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', issue_row.aggregate_version; RETURN; END IF;
    next_version := issue_row.aggregate_version + 1;
    INSERT INTO quality_governance.issue_state_transition (
        transition_id, review_issue_id, enterprise_id, project_id,
        from_status, to_status, cause_ref, reason, transitioned_at,
        definition, payload_hash, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id,
        source_command_id)
    VALUES (
        p_transition_id, issue_row.review_issue_id, issue_row.enterprise_id,
        issue_row.project_id, issue_row.status, 'CLOSED', p_verification_ref,
        p_close_reason, p_closed_at,
        jsonb_build_object('verificationRef', p_verification_ref,
                           'closeReason', p_close_reason, 'closedAt', p_closed_at),
        p_payload_hash, p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id);
    PERFORM set_config('quality_governance.allow_aggregate_transition', 'on', true);
    UPDATE quality_governance.review_issue
       SET status = 'CLOSED', aggregate_version = next_version,
           updated_at = clock_timestamp(), last_command_id = p_source_command_id
     WHERE review_issue_id = issue_row.review_issue_id;
    PERFORM set_config('quality_governance.allow_aggregate_transition', 'off', true);
    RETURN QUERY SELECT 'OK', next_version;
EXCEPTION
    WHEN not_null_violation OR check_violation OR invalid_text_representation THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint;
END
$fn$;

CREATE FUNCTION quality_governance.create_approval_request(
    p_request_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_definition jsonb,
    p_payload_hash bytea,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    revision_hash bytea;
    ras_hash bytea;
    nonce_hash bytea;
BEGIN
    PERFORM quality_governance.assert_business_write_context(
        p_enterprise_id, p_project_id, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id);
    IF p_definition IS NULL OR jsonb_typeof(p_definition) <> 'object'
       OR p_payload_hash IS NULL OR octet_length(p_payload_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID'; RETURN;
    END IF;
    revision_hash := decode(p_definition->'revisionRef'->'contentHash'->>'digest', 'hex');
    ras_hash := decode(p_definition->'revisionAcceptanceSnapshotRef'->'contentHash'->>'digest', 'hex');
    nonce_hash := decode(p_definition->'requestNonceHash'->>'digest', 'hex');
    IF octet_length(revision_hash) <> 32 OR octet_length(ras_hash) <> 32
       OR octet_length(nonce_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID'; RETURN;
    END IF;
    INSERT INTO quality_governance.approval_request (
        request_id, enterprise_id, project_id, artifact_ref, revision_ref,
        revision_content_hash, revision_acceptance_snapshot_ref,
        revision_acceptance_snapshot_hash, quality_profile_ref,
        approval_requirement_id, requested_approver_role, expires_at,
        request_nonce_hash, status, definition, payload_hash,
        created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_request_id, p_enterprise_id, p_project_id, p_definition->'artifactRef',
        p_definition->'revisionRef', revision_hash,
        p_definition->'revisionAcceptanceSnapshotRef', ras_hash,
        p_definition->'qualityProfileRef', (p_definition->>'approvalRequirementId')::uuid,
        p_definition->>'requestedApproverRole', (p_definition->>'expiresAt')::timestamptz,
        nonce_hash, 'OPEN', p_definition, p_payload_hash,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id);
    RETURN QUERY SELECT 'OK';
EXCEPTION
    WHEN not_null_violation OR check_violation OR invalid_text_representation THEN
        RETURN QUERY SELECT 'INVALID';
    WHEN unique_violation THEN
        RETURN QUERY SELECT 'CONFLICT';
END
$fn$;

CREATE FUNCTION quality_governance.create_approval_decision(
    p_approval_id uuid,
    p_request_id uuid,
    p_definition jsonb,
    p_payload_hash bytea,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    request_row quality_governance.approval_request%ROWTYPE;
    revision_hash bytea;
    ras_hash bytea;
    decision_id uuid;
BEGIN
    SELECT * INTO request_row
      FROM quality_governance.approval_request
     WHERE request_id = p_request_id;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'; RETURN; END IF;
    PERFORM quality_governance.assert_business_write_context(
        request_row.enterprise_id, request_row.project_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id);
    IF p_definition IS NULL OR jsonb_typeof(p_definition) <> 'object'
       OR p_definition->'submission' IS NULL
       OR p_payload_hash IS NULL OR octet_length(p_payload_hash) <> 32
       OR p_definition->'submission'->'requestRef'->>'objectId' <> p_request_id::text THEN
        RETURN QUERY SELECT 'INVALID'; RETURN;
    END IF;
    revision_hash := decode(p_definition->'submission'->'revisionRef'->'contentHash'->>'digest', 'hex');
    ras_hash := decode(p_definition->'submission'->'revisionAcceptanceSnapshotRef'->'contentHash'->>'digest', 'hex');
    IF octet_length(revision_hash) <> 32 OR octet_length(ras_hash) <> 32
       OR (p_definition->'submission'->>'approvalRequirementId')::uuid
          IS DISTINCT FROM request_row.approval_requirement_id THEN
        RETURN QUERY SELECT 'INVALID'; RETURN;
    END IF;
    decision_id := uuidv7();
    INSERT INTO quality_governance.approval (
        approval_id, request_id, enterprise_id, project_id, artifact_ref,
        revision_ref, revision_content_hash, revision_acceptance_snapshot_ref,
        revision_acceptance_snapshot_hash, quality_profile_ref,
        approval_requirement_id, decision, status, aggregate_version,
        payload_hash, created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, last_command_id)
    VALUES (
        p_approval_id, p_request_id, request_row.enterprise_id, request_row.project_id,
        request_row.artifact_ref,
        p_definition->'submission'->'revisionRef', revision_hash,
        p_definition->'submission'->'revisionAcceptanceSnapshotRef', ras_hash,
        request_row.quality_profile_ref, request_row.approval_requirement_id,
        p_definition->'submission'->>'decision', 'EFFECTIVE', 1, p_payload_hash,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id);
    INSERT INTO quality_governance.approval_decision (
        decision_id, approval_id, request_id, enterprise_id, project_id,
        revision_ref, revision_content_hash, revision_acceptance_snapshot_ref,
        revision_acceptance_snapshot_hash, approval_requirement_id, decision,
        decision_comment, approver_human_principal_ref, approver_role_snapshot_ref,
        authorization_decision_ref, separation_check_ref, decided_at,
        definition, payload_hash, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id,
        source_command_id)
    VALUES (
        decision_id, p_approval_id, p_request_id, request_row.enterprise_id,
        request_row.project_id, p_definition->'submission'->'revisionRef', revision_hash,
        p_definition->'submission'->'revisionAcceptanceSnapshotRef', ras_hash,
        request_row.approval_requirement_id, p_definition->'submission'->>'decision',
        p_definition->'submission'->>'decisionComment',
        p_definition->'submission'->'approverHumanPrincipalRef',
        p_definition->'submission'->'approverRoleSnapshotRef',
        p_definition->'submission'->'authorizationDecisionRef',
        p_definition->'submission'->'separationCheckRef',
        (p_definition->'submission'->>'decidedAt')::timestamptz,
        p_definition, p_payload_hash, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
        p_source_command_id);
    RETURN QUERY SELECT 'OK';
EXCEPTION
    WHEN not_null_violation OR check_violation OR invalid_text_representation THEN
        RETURN QUERY SELECT 'INVALID';
    WHEN unique_violation THEN
        RETURN QUERY SELECT 'CONFLICT';
END
$fn$;

CREATE FUNCTION quality_governance.append_approval_revocation(
    p_revocation_id uuid,
    p_approval_id uuid,
    p_expected_version bigint,
    p_definition jsonb,
    p_payload_hash bytea,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    approval_row quality_governance.approval%ROWTYPE;
    decision_row quality_governance.approval_decision%ROWTYPE;
    next_version bigint;
BEGIN
    SELECT * INTO approval_row
      FROM quality_governance.approval
     WHERE approval_id = p_approval_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint; RETURN; END IF;
    PERFORM quality_governance.assert_business_write_context(
        approval_row.enterprise_id, approval_row.project_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id);
    IF approval_row.aggregate_version <> p_expected_version THEN
        RETURN QUERY SELECT 'CONFLICT', approval_row.aggregate_version; RETURN;
    END IF;
    IF approval_row.status = 'REVOKED' THEN
        RETURN QUERY SELECT 'ALREADY', approval_row.aggregate_version; RETURN;
    END IF;
    IF p_definition IS NULL OR jsonb_typeof(p_definition) <> 'object'
       OR p_definition->'revocationReason' IS NULL
       OR p_definition->'impactAssessmentRef' IS NULL
       OR p_payload_hash IS NULL OR octet_length(p_payload_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID', approval_row.aggregate_version; RETURN;
    END IF;
    SELECT * INTO decision_row
      FROM quality_governance.approval_decision
     WHERE approval_id = p_approval_id
     ORDER BY decided_at DESC, decision_id DESC
     LIMIT 1;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', approval_row.aggregate_version; RETURN; END IF;
    next_version := approval_row.aggregate_version + 1;
    INSERT INTO quality_governance.approval_revocation (
        revocation_id, approval_id, enterprise_id, project_id, approval_ref,
        approval_hash, approval_decision_ref, approval_decision_hash,
        revocation_reason, impact_assessment_ref, revoked_at, definition,
        payload_hash, created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_revocation_id, p_approval_id, approval_row.enterprise_id, approval_row.project_id,
        jsonb_build_object('kind', 'CONTENT_ADDRESSED', 'objectType', 'quality.approval',
                           'objectId', approval_row.approval_id, 'scope',
                           jsonb_build_object('enterpriseId', approval_row.enterprise_id),
                           'contentHash', jsonb_build_object('algorithm', 'SHA-256',
                               'digest', encode(approval_row.payload_hash, 'hex'),
                               'canonicalizationVersion', '1')),
        approval_row.payload_hash,
        jsonb_build_object('kind', 'CONTENT_ADDRESSED', 'objectType', 'quality.approval_decision',
                           'objectId', decision_row.decision_id, 'scope',
                           jsonb_build_object('enterpriseId', approval_row.enterprise_id),
                           'contentHash', jsonb_build_object('algorithm', 'SHA-256',
                               'digest', encode(decision_row.payload_hash, 'hex'),
                               'canonicalizationVersion', '1')),
        decision_row.payload_hash, p_definition->'revocationReason',
        p_definition->'impactAssessmentRef', (p_definition->>'revokedAt')::timestamptz,
        p_definition, p_payload_hash, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
        p_source_command_id);
    PERFORM set_config('quality_governance.allow_aggregate_transition', 'on', true);
    UPDATE quality_governance.approval
       SET status = 'REVOKED', aggregate_version = next_version,
           updated_at = clock_timestamp(), last_command_id = p_source_command_id
     WHERE approval_id = p_approval_id;
    PERFORM set_config('quality_governance.allow_aggregate_transition', 'off', true);
    RETURN QUERY SELECT 'OK', next_version;
EXCEPTION
    WHEN not_null_violation OR check_violation OR invalid_text_representation THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint;
    WHEN unique_violation THEN
        RETURN QUERY SELECT 'ALREADY', NULL::bigint;
END
$fn$;

CREATE FUNCTION quality_governance.create_approval_bundle_snapshot(
    p_snapshot_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_snapshot jsonb,
    p_revision_content_hash bytea,
    p_payload_hash bytea,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    PERFORM quality_governance.assert_business_write_context(
        p_enterprise_id, p_project_id, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id);
    IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
       OR p_snapshot->>'snapshotId' <> p_snapshot_id::text
       OR p_revision_content_hash IS NULL OR octet_length(p_revision_content_hash) <> 32
       OR p_payload_hash IS NULL OR octet_length(p_payload_hash) <> 32
       OR p_snapshot->'approvalRequirements' IS NULL
       OR jsonb_typeof(p_snapshot->'approvalRequirements') <> 'array'
       OR p_snapshot->'approvalRefs' IS NULL
       OR jsonb_typeof(p_snapshot->'approvalRefs') <> 'array' THEN
        RETURN QUERY SELECT 'INVALID'; RETURN;
    END IF;
    INSERT INTO quality_governance.approval_bundle_snapshot (
        snapshot_id, enterprise_id, project_id, artifact_ref, revision_ref,
        revision_content_hash, revision_acceptance_snapshot_ref, quality_profile_ref,
        approval_requirements, approval_refs, separation_of_duties_result,
        authorization_snapshot_refs, completeness, snapshot, payload_hash,
        evaluated_at, created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_snapshot_id, p_enterprise_id, p_project_id, p_snapshot->'artifactRef',
        p_snapshot->'revisionRef', p_revision_content_hash,
        p_snapshot->'revisionAcceptanceSnapshotRef', p_snapshot->'qualityProfileRef',
        p_snapshot->'approvalRequirements', p_snapshot->'approvalRefs',
        p_snapshot->'separationOfDutiesResult', p_snapshot->'authorizationSnapshotRefs',
        p_snapshot->'completeness', p_snapshot, p_payload_hash,
        (p_snapshot->>'evaluatedAt')::timestamptz, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
        p_source_command_id);
    RETURN QUERY SELECT 'OK';
EXCEPTION
    WHEN not_null_violation OR check_violation OR invalid_text_representation THEN
        RETURN QUERY SELECT 'INVALID';
    WHEN unique_violation THEN
        RETURN QUERY SELECT 'CONFLICT';
END
$fn$;

-- ---------------------------------------------------------------------------
-- RLS and ACL: app reads only; owner functions are the write boundary.
-- ---------------------------------------------------------------------------

ALTER TABLE quality_governance.review_issue ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.review_issue FORCE ROW LEVEL SECURITY;
CREATE POLICY review_issue_select ON quality_governance.review_issue FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY review_issue_owner_all ON quality_governance.review_issue FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.issue_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.issue_observation FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_observation_select ON quality_governance.issue_observation FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY issue_observation_owner_all ON quality_governance.issue_observation FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.resolution_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.resolution_proposal FORCE ROW LEVEL SECURITY;
CREATE POLICY resolution_proposal_select ON quality_governance.resolution_proposal FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY resolution_proposal_owner_all ON quality_governance.resolution_proposal FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.verification_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.verification_record FORCE ROW LEVEL SECURITY;
CREATE POLICY verification_record_select ON quality_governance.verification_record FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY verification_record_owner_all ON quality_governance.verification_record FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.issue_state_transition ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.issue_state_transition FORCE ROW LEVEL SECURITY;
CREATE POLICY issue_state_transition_select ON quality_governance.issue_state_transition FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY issue_state_transition_owner_all ON quality_governance.issue_state_transition FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.approval_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.approval_request FORCE ROW LEVEL SECURITY;
CREATE POLICY approval_request_select ON quality_governance.approval_request FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY approval_request_owner_all ON quality_governance.approval_request FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.approval FORCE ROW LEVEL SECURITY;
CREATE POLICY approval_select ON quality_governance.approval FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY approval_owner_all ON quality_governance.approval FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.approval_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.approval_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY approval_decision_select ON quality_governance.approval_decision FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY approval_decision_owner_all ON quality_governance.approval_decision FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.approval_revocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.approval_revocation FORCE ROW LEVEL SECURITY;
CREATE POLICY approval_revocation_select ON quality_governance.approval_revocation FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY approval_revocation_owner_all ON quality_governance.approval_revocation FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.approval_bundle_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.approval_bundle_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY approval_bundle_snapshot_select ON quality_governance.approval_bundle_snapshot FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY approval_bundle_snapshot_owner_all ON quality_governance.approval_bundle_snapshot FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

REVOKE ALL ON quality_governance.review_issue,
    quality_governance.issue_observation,
    quality_governance.resolution_proposal,
    quality_governance.verification_record,
    quality_governance.issue_state_transition,
    quality_governance.approval_request,
    quality_governance.approval,
    quality_governance.approval_decision,
    quality_governance.approval_revocation,
    quality_governance.approval_bundle_snapshot
    FROM quality_governance_app;
GRANT SELECT ON quality_governance.review_issue,
    quality_governance.issue_observation,
    quality_governance.resolution_proposal,
    quality_governance.verification_record,
    quality_governance.issue_state_transition,
    quality_governance.approval_request,
    quality_governance.approval,
    quality_governance.approval_decision,
    quality_governance.approval_revocation,
    quality_governance.approval_bundle_snapshot
    TO quality_governance_app;

REVOKE ALL ON FUNCTION quality_governance.guard_review_issue_update() FROM PUBLIC, quality_governance_app;
REVOKE ALL ON FUNCTION quality_governance.guard_approval_update() FROM PUBLIC, quality_governance_app;
REVOKE ALL ON FUNCTION quality_governance.create_review_issue(uuid, uuid, uuid, jsonb, jsonb, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.append_issue_resolution(uuid, uuid, bigint, jsonb, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.append_issue_verification(uuid, uuid, uuid, bigint, jsonb, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.close_review_issue(uuid, bigint, jsonb, bytea, jsonb, timestamptz, uuid, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.create_approval_request(uuid, uuid, uuid, jsonb, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.create_approval_decision(uuid, uuid, jsonb, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.append_approval_revocation(uuid, uuid, bigint, jsonb, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.create_approval_bundle_snapshot(uuid, uuid, uuid, jsonb, bytea, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION quality_governance.create_review_issue(uuid, uuid, uuid, jsonb, jsonb, bytea, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.append_issue_resolution(uuid, uuid, bigint, jsonb, bytea, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.append_issue_verification(uuid, uuid, uuid, bigint, jsonb, bytea, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.close_review_issue(uuid, bigint, jsonb, bytea, jsonb, timestamptz, uuid, bytea, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.create_approval_request(uuid, uuid, uuid, jsonb, bytea, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.create_approval_decision(uuid, uuid, jsonb, bytea, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.append_approval_revocation(uuid, uuid, bigint, jsonb, bytea, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.create_approval_bundle_snapshot(uuid, uuid, uuid, jsonb, bytea, bytea, uuid, uuid, uuid, uuid) TO quality_governance_app;

RESET ROLE;
