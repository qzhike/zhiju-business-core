-- IM-05 WI-02 (issue #122): immutable Evidence custody and versioned
-- QualityProfile lifecycle. V5000 and V5001 are applied migrations and are
-- intentionally not edited. Business writes use owner functions so the app
-- role has no direct INSERT/UPDATE/DELETE surface.

SET ROLE quality_governance_owner;

-- ---------------------------------------------------------------------------
-- Evidence custody
-- ---------------------------------------------------------------------------

CREATE TABLE quality_governance.evidence (
    evidence_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    candidate jsonb NOT NULL,
    candidate_payload_hash bytea NOT NULL,
    status text NOT NULL,
    impact_status text NOT NULL DEFAULT 'evidence.impact.live',
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid NOT NULL,
    CONSTRAINT evidence_candidate_object CHECK (jsonb_typeof(candidate) = 'object'),
    CONSTRAINT evidence_candidate_hash_len CHECK (octet_length(candidate_payload_hash) = 32),
    CONSTRAINT evidence_status_closed CHECK (
        status IN ('CANDIDATE', 'VERIFYING', 'VERIFIED', 'DISPUTED', 'EXPIRED', 'SUPERSEDED', 'REVOKED')),
    CONSTRAINT evidence_version_positive CHECK (aggregate_version >= 1)
);

CREATE INDEX evidence_scope_status_idx
    ON quality_governance.evidence (enterprise_id, project_id, status, updated_at DESC);
CREATE INDEX evidence_hash_idx
    ON quality_governance.evidence (evidence_id, candidate_payload_hash);

CREATE TABLE quality_governance.evidence_validation (
    validation_id uuid PRIMARY KEY,
    evidence_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    verification jsonb NOT NULL,
    verification_payload_hash bytea NOT NULL,
    outcome text NOT NULL,
    verified_at timestamptz NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT evidence_validation_object CHECK (jsonb_typeof(verification) = 'object'),
    CONSTRAINT evidence_validation_hash_len CHECK (octet_length(verification_payload_hash) = 32),
    CONSTRAINT evidence_validation_outcome_closed CHECK (outcome IN ('VERIFIED', 'DISPUTED')),
    CONSTRAINT evidence_validation_evidence_fk FOREIGN KEY (evidence_id)
        REFERENCES quality_governance.evidence (evidence_id) ON DELETE RESTRICT
);

CREATE INDEX evidence_validation_history_idx
    ON quality_governance.evidence_validation (evidence_id, verified_at DESC, validation_id DESC);

CREATE TABLE quality_governance.evidence_revocation (
    revocation_id uuid PRIMARY KEY,
    evidence_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    revocation_reason jsonb NOT NULL,
    impact_assessment_ref jsonb NOT NULL,
    revoked_at timestamptz NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT evidence_revocation_reason_object CHECK (jsonb_typeof(revocation_reason) = 'object'),
    CONSTRAINT evidence_revocation_impact_ref_object CHECK (jsonb_typeof(impact_assessment_ref) = 'object'),
    CONSTRAINT evidence_revocation_evidence_fk FOREIGN KEY (evidence_id)
        REFERENCES quality_governance.evidence (evidence_id) ON DELETE RESTRICT,
    CONSTRAINT evidence_revocation_one_per_evidence UNIQUE (evidence_id)
);

CREATE TABLE quality_governance.evidence_link (
    evidence_link_id uuid PRIMARY KEY,
    evidence_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    definition jsonb NOT NULL,
    evidence_payload_hash bytea NOT NULL,
    claim_hash bytea NOT NULL,
    relation text NOT NULL,
    linked_at timestamptz NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT evidence_link_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT evidence_link_evidence_hash_len CHECK (octet_length(evidence_payload_hash) = 32),
    CONSTRAINT evidence_link_claim_hash_len CHECK (octet_length(claim_hash) = 32),
    CONSTRAINT evidence_link_relation_closed CHECK (relation IN ('SUPPORTS', 'CONTRADICTS', 'CONTEXT_ONLY')),
    CONSTRAINT evidence_link_evidence_fk FOREIGN KEY (evidence_id)
        REFERENCES quality_governance.evidence (evidence_id) ON DELETE RESTRICT,
    CONSTRAINT evidence_link_identity_unique UNIQUE (evidence_id, definition)
);

CREATE INDEX evidence_link_target_idx
    ON quality_governance.evidence_link ((definition->'targetRef'->>'objectType'),
                                         (definition->'targetRef'->>'objectId'));

-- ---------------------------------------------------------------------------
-- QualityProfile versioned policy
-- ---------------------------------------------------------------------------

CREATE TABLE quality_governance.quality_profile (
    quality_profile_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    name text NOT NULL,
    status text NOT NULL,
    active_version_id uuid,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by_principal_id uuid NOT NULL,
    updated_by_actor_snapshot_id uuid NOT NULL,
    updated_authorization_decision_id uuid NOT NULL,
    last_command_id uuid NOT NULL,
    CONSTRAINT quality_profile_enterprise_scope CHECK (project_id IS NULL),
    CONSTRAINT quality_profile_name_nonempty CHECK (btrim(name) <> ''),
    CONSTRAINT quality_profile_status_closed CHECK (status IN ('DRAFT', 'ACTIVE')),
    CONSTRAINT quality_profile_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT quality_profile_name_unique UNIQUE (enterprise_id, name)
);

CREATE TABLE quality_governance.quality_profile_version (
    profile_version_id uuid PRIMARY KEY,
    quality_profile_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    profile_version text NOT NULL,
    definition jsonb NOT NULL,
    definition_hash bytea NOT NULL,
    status text NOT NULL,
    review_snapshot_ref jsonb,
    validation_snapshot_ref jsonb,
    activated_at timestamptz,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT quality_profile_version_enterprise_scope CHECK (project_id IS NULL),
    CONSTRAINT quality_profile_version_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT quality_profile_version_hash_len CHECK (octet_length(definition_hash) = 32),
    CONSTRAINT quality_profile_version_status_closed CHECK (
        status IN ('DRAFT', 'UNDER_REVIEW', 'ACTIVE', 'SUPERSEDED', 'RETIRED')),
    CONSTRAINT quality_profile_version_profile_fk FOREIGN KEY (quality_profile_id)
        REFERENCES quality_governance.quality_profile (quality_profile_id) ON DELETE RESTRICT,
    CONSTRAINT quality_profile_version_identity_unique UNIQUE (quality_profile_id, profile_version)
);

CREATE TABLE quality_governance.quality_profile_gate_spec (
    gate_spec_id uuid NOT NULL,
    profile_version_id uuid NOT NULL,
    quality_profile_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    definition jsonb NOT NULL,
    gate_version text NOT NULL,
    evaluation_stage text NOT NULL,
    mandatory boolean NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT quality_profile_gate_spec_pk PRIMARY KEY (profile_version_id, gate_spec_id),
    CONSTRAINT quality_profile_gate_spec_scope CHECK (project_id IS NULL),
    CONSTRAINT quality_profile_gate_spec_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT quality_profile_gate_spec_stage_closed CHECK (
        evaluation_stage IN ('REVISION_ACCEPTANCE', 'RELEASE_READINESS')),
    CONSTRAINT quality_profile_gate_spec_version_fk FOREIGN KEY (profile_version_id)
        REFERENCES quality_governance.quality_profile_version (profile_version_id) ON DELETE RESTRICT
);

CREATE TABLE quality_governance.quality_profile_gate_dependency (
    dependency_id uuid PRIMARY KEY,
    profile_version_id uuid NOT NULL,
    quality_profile_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    from_gate_spec_id uuid NOT NULL,
    to_gate_spec_id uuid NOT NULL,
    definition jsonb NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT quality_profile_gate_dependency_scope CHECK (project_id IS NULL),
    CONSTRAINT quality_profile_gate_dependency_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT quality_profile_gate_dependency_distinct CHECK (from_gate_spec_id <> to_gate_spec_id),
    CONSTRAINT quality_profile_gate_dependency_version_fk FOREIGN KEY (profile_version_id)
        REFERENCES quality_governance.quality_profile_version (profile_version_id) ON DELETE RESTRICT,
    CONSTRAINT quality_profile_gate_dependency_unique UNIQUE (profile_version_id, from_gate_spec_id, to_gate_spec_id)
);

CREATE TABLE quality_governance.quality_profile_approval_requirement (
    approval_requirement_id uuid PRIMARY KEY,
    profile_version_id uuid NOT NULL,
    quality_profile_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    requirement_order integer NOT NULL,
    definition jsonb NOT NULL,
    required_role text NOT NULL,
    required_count integer NOT NULL,
    approver_kind text NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT quality_profile_approval_requirement_scope CHECK (project_id IS NULL),
    CONSTRAINT quality_profile_approval_requirement_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT quality_profile_approval_requirement_order_positive CHECK (requirement_order >= 1),
    CONSTRAINT quality_profile_approval_requirement_count_positive CHECK (required_count >= 1),
    CONSTRAINT quality_profile_approval_requirement_role_nonempty CHECK (btrim(required_role) <> ''),
    CONSTRAINT quality_profile_approval_requirement_version_fk FOREIGN KEY (profile_version_id)
        REFERENCES quality_governance.quality_profile_version (profile_version_id) ON DELETE RESTRICT,
    CONSTRAINT quality_profile_approval_requirement_order_unique UNIQUE (profile_version_id, requirement_order)
);

CREATE TABLE quality_governance.quality_profile_release_requirement (
    release_requirement_id uuid PRIMARY KEY,
    profile_version_id uuid NOT NULL,
    quality_profile_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    requirement_order integer NOT NULL,
    definition jsonb NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT quality_profile_release_requirement_scope CHECK (project_id IS NULL),
    CONSTRAINT quality_profile_release_requirement_definition_object CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT quality_profile_release_requirement_order_positive CHECK (requirement_order >= 1),
    CONSTRAINT quality_profile_release_requirement_version_fk FOREIGN KEY (profile_version_id)
        REFERENCES quality_governance.quality_profile_version (profile_version_id) ON DELETE RESTRICT,
    CONSTRAINT quality_profile_release_requirement_order_unique UNIQUE (profile_version_id, requirement_order)
);

CREATE INDEX quality_profile_active_idx
    ON quality_governance.quality_profile (enterprise_id, status, active_version_id);
CREATE INDEX quality_profile_version_status_idx
    ON quality_governance.quality_profile_version (quality_profile_id, status, created_at DESC);

-- ---------------------------------------------------------------------------
-- Common trusted-context and immutability guards
-- ---------------------------------------------------------------------------

CREATE FUNCTION quality_governance.assert_business_write_context(
    p_enterprise_id uuid,
    p_project_id uuid,
    p_principal_id uuid,
    p_actor_snapshot_id uuid,
    p_authorization_decision_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    IF p_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'quality business attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF (p_project_id IS NULL AND NOT platform_security.context_allows_enterprise(p_enterprise_id))
       OR (p_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(p_enterprise_id, p_project_id)) THEN
        RAISE EXCEPTION 'quality business scope is not allowed'
            USING ERRCODE = '42501';
    END IF;
END
$fn$;

CREATE FUNCTION quality_governance.guard_business_fact_insert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR NEW.created_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'quality fact attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF (NEW.project_id IS NULL AND NOT platform_security.context_allows_enterprise(NEW.enterprise_id))
       OR (NEW.project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(NEW.enterprise_id, NEW.project_id)) THEN
        RAISE EXCEPTION 'quality fact scope is not allowed'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION quality_governance.guard_append_only_fact() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'quality facts are append-only'
        USING ERRCODE = '55000';
END
$guard$;

CREATE FUNCTION quality_governance.guard_evidence_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF current_user <> 'quality_governance_owner' THEN
        RAISE EXCEPTION 'Evidence identity and source facts are immutable'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Evidence root is immutable and cannot be deleted'
            USING ERRCODE = '55000';
    END IF;
    IF NEW.evidence_id IS DISTINCT FROM OLD.evidence_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.candidate IS DISTINCT FROM OLD.candidate
       OR NEW.candidate_payload_hash IS DISTINCT FROM OLD.candidate_payload_hash
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.created_authorization_decision_id IS DISTINCT FROM OLD.created_authorization_decision_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.aggregate_version <= OLD.aggregate_version THEN
        RAISE EXCEPTION 'Evidence immutable identity or source facts changed'
            USING ERRCODE = '55000';
    END IF;
    IF NEW.status = 'REVOKED' AND OLD.status = 'REVOKED' THEN
        RAISE EXCEPTION 'revoked Evidence cannot transition again'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION quality_governance.guard_quality_profile_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF current_user <> 'quality_governance_owner' THEN
        RAISE EXCEPTION 'QualityProfile identity is immutable'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'QualityProfile root is immutable and cannot be deleted'
            USING ERRCODE = '55000';
    END IF;
    IF NEW.quality_profile_id IS DISTINCT FROM OLD.quality_profile_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.created_authorization_decision_id IS DISTINCT FROM OLD.created_authorization_decision_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.aggregate_version <= OLD.aggregate_version THEN
        RAISE EXCEPTION 'QualityProfile identity facts changed'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION quality_governance.guard_quality_profile_version_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF current_user <> 'quality_governance_owner' THEN
        RAISE EXCEPTION 'QualityProfile version is immutable'
            USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'QualityProfile version is immutable and cannot be deleted'
            USING ERRCODE = '55000';
    END IF;
    IF NEW.profile_version_id IS DISTINCT FROM OLD.profile_version_id
       OR NEW.quality_profile_id IS DISTINCT FROM OLD.quality_profile_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.profile_version IS DISTINCT FROM OLD.profile_version
       OR NEW.definition IS DISTINCT FROM OLD.definition
       OR NEW.definition_hash IS DISTINCT FROM OLD.definition_hash
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.created_authorization_decision_id IS DISTINCT FROM OLD.created_authorization_decision_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.status = 'DRAFT' AND OLD.status = 'ACTIVE' THEN
        RAISE EXCEPTION 'QualityProfile version policy facts changed'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE TRIGGER evidence_insert_guard
    BEFORE INSERT ON quality_governance.evidence
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER evidence_update_guard
    BEFORE UPDATE OR DELETE ON quality_governance.evidence
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_evidence_update();
CREATE TRIGGER evidence_validation_insert_guard
    BEFORE INSERT ON quality_governance.evidence_validation
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER evidence_validation_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.evidence_validation
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();
CREATE TRIGGER evidence_revocation_insert_guard
    BEFORE INSERT ON quality_governance.evidence_revocation
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER evidence_revocation_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.evidence_revocation
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();
CREATE TRIGGER evidence_link_insert_guard
    BEFORE INSERT ON quality_governance.evidence_link
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER evidence_link_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.evidence_link
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();
CREATE TRIGGER quality_profile_insert_guard
    BEFORE INSERT ON quality_governance.quality_profile
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER quality_profile_update_guard
    BEFORE UPDATE OR DELETE ON quality_governance.quality_profile
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_quality_profile_update();
CREATE TRIGGER quality_profile_version_insert_guard
    BEFORE INSERT ON quality_governance.quality_profile_version
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER quality_profile_version_update_guard
    BEFORE UPDATE OR DELETE ON quality_governance.quality_profile_version
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_quality_profile_version_update();
CREATE TRIGGER quality_profile_gate_spec_insert_guard
    BEFORE INSERT ON quality_governance.quality_profile_gate_spec
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER quality_profile_gate_spec_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.quality_profile_gate_spec
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();
CREATE TRIGGER quality_profile_gate_dependency_insert_guard
    BEFORE INSERT ON quality_governance.quality_profile_gate_dependency
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER quality_profile_gate_dependency_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.quality_profile_gate_dependency
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();
CREATE TRIGGER quality_profile_approval_requirement_insert_guard
    BEFORE INSERT ON quality_governance.quality_profile_approval_requirement
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER quality_profile_approval_requirement_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.quality_profile_approval_requirement
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();
CREATE TRIGGER quality_profile_release_requirement_insert_guard
    BEFORE INSERT ON quality_governance.quality_profile_release_requirement
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER quality_profile_release_requirement_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.quality_profile_release_requirement
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();

-- ---------------------------------------------------------------------------
-- Owner write functions
-- ---------------------------------------------------------------------------

CREATE FUNCTION quality_governance.create_evidence(
    p_evidence_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_candidate jsonb,
    p_candidate_payload_hash bytea,
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
    IF p_candidate IS NULL OR jsonb_typeof(p_candidate) <> 'object'
       OR p_candidate_payload_hash IS NULL OR octet_length(p_candidate_payload_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM quality_governance.evidence WHERE evidence_id = p_evidence_id) THEN
        RETURN QUERY SELECT 'CONFLICT';
        RETURN;
    END IF;
    INSERT INTO quality_governance.evidence (
        evidence_id, enterprise_id, project_id, candidate, candidate_payload_hash,
        status, impact_status, aggregate_version, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id,
        last_command_id)
    VALUES (
        p_evidence_id, p_enterprise_id, p_project_id, p_candidate, p_candidate_payload_hash,
        'CANDIDATE', 'evidence.impact.live', 1, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
        p_source_command_id);
    RETURN QUERY SELECT 'OK';
END
$fn$;

CREATE FUNCTION quality_governance.append_evidence_verification(
    p_validation_id uuid,
    p_evidence_id uuid,
    p_evidence_payload_hash bytea,
    p_expected_version bigint,
    p_verification jsonb,
    p_verification_payload_hash bytea,
    p_outcome text,
    p_verified_at timestamptz,
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
    evidence_row quality_governance.evidence%ROWTYPE;
BEGIN
    IF p_verification IS NULL OR jsonb_typeof(p_verification) <> 'object'
       OR p_verification_payload_hash IS NULL OR octet_length(p_verification_payload_hash) <> 32
       OR p_outcome NOT IN ('VERIFIED', 'DISPUTED') THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    SELECT * INTO evidence_row
      FROM quality_governance.evidence
     WHERE evidence_id = p_evidence_id
       AND candidate_payload_hash = p_evidence_payload_hash
       AND enterprise_id = platform_security.context_enterprise_id()
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'; RETURN; END IF;
    PERFORM quality_governance.assert_business_write_context(
        evidence_row.enterprise_id, evidence_row.project_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id);
    IF evidence_row.aggregate_version <> p_expected_version THEN
        RETURN QUERY SELECT 'CONFLICT';
        RETURN;
    END IF;
    IF evidence_row.status = 'REVOKED' THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM quality_governance.evidence_validation WHERE validation_id = p_validation_id) THEN
        RETURN QUERY SELECT 'ALREADY';
        RETURN;
    END IF;
    INSERT INTO quality_governance.evidence_validation (
        validation_id, evidence_id, enterprise_id, project_id, verification,
        verification_payload_hash, outcome, verified_at, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id,
        source_command_id)
    VALUES (
        p_validation_id, evidence_row.evidence_id, evidence_row.enterprise_id,
        evidence_row.project_id, p_verification, p_verification_payload_hash,
        p_outcome, p_verified_at, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
        p_source_command_id);
    UPDATE quality_governance.evidence
       SET status = p_outcome,
           aggregate_version = evidence_row.aggregate_version + 1,
           updated_at = clock_timestamp(),
           last_command_id = p_source_command_id
     WHERE evidence_id = evidence_row.evidence_id;
    RETURN QUERY SELECT 'OK';
END
$fn$;

CREATE FUNCTION quality_governance.append_evidence_revocation(
    p_revocation_id uuid,
    p_evidence_id uuid,
    p_evidence_payload_hash bytea,
    p_expected_version bigint,
    p_revocation_reason jsonb,
    p_impact_assessment_ref jsonb,
    p_revoked_at timestamptz,
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
    evidence_row quality_governance.evidence%ROWTYPE;
BEGIN
    IF p_revocation_reason IS NULL OR jsonb_typeof(p_revocation_reason) <> 'object'
       OR p_impact_assessment_ref IS NULL OR jsonb_typeof(p_impact_assessment_ref) <> 'object' THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    SELECT * INTO evidence_row
      FROM quality_governance.evidence
     WHERE evidence_id = p_evidence_id
       AND candidate_payload_hash = p_evidence_payload_hash
       AND enterprise_id = platform_security.context_enterprise_id()
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'; RETURN; END IF;
    PERFORM quality_governance.assert_business_write_context(
        evidence_row.enterprise_id, evidence_row.project_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id);
    IF evidence_row.aggregate_version <> p_expected_version THEN
        RETURN QUERY SELECT 'CONFLICT';
        RETURN;
    END IF;
    IF evidence_row.status = 'REVOKED'
       OR EXISTS (SELECT 1 FROM quality_governance.evidence_revocation WHERE evidence_id = p_evidence_id) THEN
        RETURN QUERY SELECT 'ALREADY';
        RETURN;
    END IF;
    INSERT INTO quality_governance.evidence_revocation (
        revocation_id, evidence_id, enterprise_id, project_id, revocation_reason,
        impact_assessment_ref, revoked_at, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id,
        source_command_id)
    VALUES (
        p_revocation_id, evidence_row.evidence_id, evidence_row.enterprise_id,
        evidence_row.project_id, p_revocation_reason, p_impact_assessment_ref,
        p_revoked_at, p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id);
    UPDATE quality_governance.evidence
       SET status = 'REVOKED',
           impact_status = 'evidence.impact.stale',
           aggregate_version = evidence_row.aggregate_version + 1,
           updated_at = clock_timestamp(),
           last_command_id = p_source_command_id
     WHERE evidence_id = evidence_row.evidence_id;
    RETURN QUERY SELECT 'OK';
END
$fn$;

CREATE FUNCTION quality_governance.create_evidence_link(
    p_evidence_link_id uuid,
    p_evidence_id uuid,
    p_evidence_payload_hash bytea,
    p_definition jsonb,
    p_claim_hash bytea,
    p_enterprise_id uuid,
    p_project_id uuid,
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
    evidence_row quality_governance.evidence%ROWTYPE;
BEGIN
    IF p_definition IS NULL OR jsonb_typeof(p_definition) <> 'object'
       OR p_claim_hash IS NULL OR octet_length(p_claim_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    SELECT * INTO evidence_row
      FROM quality_governance.evidence
     WHERE evidence_id = p_evidence_id
       AND candidate_payload_hash = p_evidence_payload_hash
       AND enterprise_id = p_enterprise_id
       AND (project_id = p_project_id OR project_id IS NULL)
     FOR SHARE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'; RETURN; END IF;
    IF p_definition->'evidenceRef'->>'objectId' IS DISTINCT FROM p_evidence_id::text
       OR p_definition->'evidenceRef'->'contentHash'->>'digest' IS DISTINCT FROM encode(p_evidence_payload_hash, 'hex') THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    PERFORM quality_governance.assert_business_write_context(
        p_enterprise_id, p_project_id, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id);
    IF EXISTS (SELECT 1 FROM quality_governance.evidence_link WHERE evidence_link_id = p_evidence_link_id) THEN
        RETURN QUERY SELECT 'CONFLICT';
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM quality_governance.evidence_link WHERE evidence_id = p_evidence_id AND definition = p_definition) THEN
        RETURN QUERY SELECT 'ALREADY';
        RETURN;
    END IF;
    INSERT INTO quality_governance.evidence_link (
        evidence_link_id, evidence_id, enterprise_id, project_id, definition,
        evidence_payload_hash, claim_hash, relation, linked_at,
        created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_evidence_link_id, p_evidence_id, p_enterprise_id, p_project_id,
        p_definition, p_evidence_payload_hash, p_claim_hash,
        p_definition->>'relation', (p_definition->>'linkedAt')::timestamptz,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id);
    RETURN QUERY SELECT 'OK';
END
$fn$;

CREATE FUNCTION quality_governance.create_quality_profile_draft(
    p_profile_id uuid,
    p_profile_version_id uuid,
    p_enterprise_id uuid,
    p_definition jsonb,
    p_definition_hash bytea,
    p_expected_version bigint,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, profile_version_id uuid, aggregate_version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    profile_row quality_governance.quality_profile%ROWTYPE;
    item jsonb;
    prerequisite uuid;
    from_id uuid;
    to_id uuid;
    next_version bigint;
    requirement_order integer;
BEGIN
    IF p_definition IS NULL OR jsonb_typeof(p_definition) <> 'object'
       OR p_definition_hash IS NULL OR octet_length(p_definition_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID', NULL::uuid, NULL::bigint;
        RETURN;
    END IF;
    PERFORM quality_governance.assert_business_write_context(
        p_enterprise_id, NULL, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id);
    SELECT * INTO profile_row
      FROM quality_governance.quality_profile
     WHERE quality_profile_id = p_profile_id
     FOR UPDATE;
    IF NOT FOUND THEN
        next_version := 1;
        INSERT INTO quality_governance.quality_profile (
            quality_profile_id, enterprise_id, project_id, name, status,
            active_version_id, aggregate_version, created_by_principal_id,
            created_by_actor_snapshot_id, created_authorization_decision_id,
            updated_by_principal_id, updated_by_actor_snapshot_id,
            updated_authorization_decision_id, last_command_id)
        VALUES (
            p_profile_id, p_enterprise_id, NULL, p_definition->>'name', 'DRAFT',
            NULL, next_version, p_created_by_principal_id,
            p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
            p_created_by_principal_id, p_created_by_actor_snapshot_id,
            p_created_authorization_decision_id, p_source_command_id);
    ELSE
        IF profile_row.enterprise_id IS DISTINCT FROM p_enterprise_id
           OR profile_row.project_id IS NOT NULL
           OR p_expected_version IS NULL THEN
            RETURN QUERY SELECT 'NOT_FOUND', NULL::uuid, NULL::bigint;
            RETURN;
        END IF;
        IF profile_row.aggregate_version <> p_expected_version THEN
            RETURN QUERY SELECT 'CONFLICT', NULL::uuid, profile_row.aggregate_version;
            RETURN;
        END IF;
        IF profile_row.name IS DISTINCT FROM p_definition->>'name'
           OR EXISTS (
               SELECT 1
                 FROM quality_governance.quality_profile_version AS existing_version
                WHERE existing_version.profile_version_id = p_profile_version_id) THEN
            RETURN QUERY SELECT 'INVALID', NULL::uuid, profile_row.aggregate_version;
            RETURN;
        END IF;
        next_version := profile_row.aggregate_version + 1;
        UPDATE quality_governance.quality_profile
           SET aggregate_version = next_version,
               updated_at = clock_timestamp(),
               updated_by_principal_id = p_created_by_principal_id,
               updated_by_actor_snapshot_id = p_created_by_actor_snapshot_id,
               updated_authorization_decision_id = p_created_authorization_decision_id,
               last_command_id = p_source_command_id
         WHERE quality_profile_id = p_profile_id;
    END IF;

    INSERT INTO quality_governance.quality_profile_version (
        profile_version_id, quality_profile_id, enterprise_id, project_id,
        profile_version, definition, definition_hash, status,
        created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_profile_version_id, p_profile_id, p_enterprise_id, NULL,
        p_definition->>'profileVersion', p_definition, p_definition_hash, 'DRAFT',
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id);

    FOR item IN SELECT value FROM jsonb_array_elements(p_definition->'gateSpecs') LOOP
        INSERT INTO quality_governance.quality_profile_gate_spec (
            gate_spec_id, profile_version_id, quality_profile_id, enterprise_id,
            project_id, definition, gate_version, evaluation_stage, mandatory,
            created_by_principal_id, created_by_actor_snapshot_id,
            created_authorization_decision_id, source_command_id)
        VALUES (
            (item->>'gateSpecId')::uuid, p_profile_version_id, p_profile_id,
            p_enterprise_id, NULL, item, item->>'gateVersion',
            item->>'evaluationStage', (item->>'mandatory')::boolean,
            p_created_by_principal_id, p_created_by_actor_snapshot_id,
            p_created_authorization_decision_id, p_source_command_id);
        FOR prerequisite IN
            SELECT value::text::uuid
              FROM jsonb_array_elements_text(item->'dependencyGateSpecIds')
        LOOP
            IF NOT EXISTS (
                SELECT 1
                  FROM quality_governance.quality_profile_gate_dependency AS existing_gate_dependency
                 WHERE existing_gate_dependency.profile_version_id = p_profile_version_id
                   AND existing_gate_dependency.from_gate_spec_id = prerequisite
                   AND existing_gate_dependency.to_gate_spec_id = (item->>'gateSpecId')::uuid) THEN
                INSERT INTO quality_governance.quality_profile_gate_dependency (
                    dependency_id, profile_version_id, quality_profile_id,
                    enterprise_id, project_id, from_gate_spec_id, to_gate_spec_id,
                    definition, created_by_principal_id,
                    created_by_actor_snapshot_id, created_authorization_decision_id,
                    source_command_id)
                VALUES (
                    uuidv7(), p_profile_version_id, p_profile_id, p_enterprise_id,
                    NULL, prerequisite, (item->>'gateSpecId')::uuid,
                    jsonb_build_object('fromGateSpecId', prerequisite,
                                       'toGateSpecId', (item->>'gateSpecId')::uuid),
                    p_created_by_principal_id, p_created_by_actor_snapshot_id,
                    p_created_authorization_decision_id, p_source_command_id);
            END IF;
        END LOOP;
    END LOOP;

    FOR item IN SELECT value FROM jsonb_array_elements(p_definition->'gateDependencies') LOOP
        from_id := (item->>'fromGateSpecId')::uuid;
        to_id := (item->>'toGateSpecId')::uuid;
        IF NOT EXISTS (
            SELECT 1
              FROM quality_governance.quality_profile_gate_dependency AS existing_gate_dependency
             WHERE existing_gate_dependency.profile_version_id = p_profile_version_id
               AND existing_gate_dependency.from_gate_spec_id = from_id
               AND existing_gate_dependency.to_gate_spec_id = to_id) THEN
            INSERT INTO quality_governance.quality_profile_gate_dependency (
                dependency_id, profile_version_id, quality_profile_id,
                enterprise_id, project_id, from_gate_spec_id, to_gate_spec_id,
                definition, created_by_principal_id,
                created_by_actor_snapshot_id, created_authorization_decision_id,
                source_command_id)
            VALUES (
                uuidv7(), p_profile_version_id, p_profile_id, p_enterprise_id,
                NULL, from_id, to_id, item, p_created_by_principal_id,
                p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
                p_source_command_id);
        END IF;
    END LOOP;

    requirement_order := 0;
    FOR item IN SELECT value FROM jsonb_array_elements(p_definition->'approvalRequirements') LOOP
        requirement_order := requirement_order + 1;
        INSERT INTO quality_governance.quality_profile_approval_requirement (
            approval_requirement_id, profile_version_id, quality_profile_id,
            enterprise_id, project_id, requirement_order, definition,
            required_role, required_count, approver_kind,
            created_by_principal_id, created_by_actor_snapshot_id,
            created_authorization_decision_id, source_command_id)
        VALUES (
            uuidv7(), p_profile_version_id, p_profile_id, p_enterprise_id, NULL,
            requirement_order, item, item->>'requiredRole',
            (item->>'requiredCount')::integer, coalesce(item->>'approverKind', 'HUMAN'),
            p_created_by_principal_id, p_created_by_actor_snapshot_id,
            p_created_authorization_decision_id, p_source_command_id);
    END LOOP;

    requirement_order := 0;
    FOR item IN SELECT value FROM jsonb_array_elements(p_definition->'releaseRequirements') LOOP
        requirement_order := requirement_order + 1;
        INSERT INTO quality_governance.quality_profile_release_requirement (
            release_requirement_id, profile_version_id, quality_profile_id,
            enterprise_id, project_id, requirement_order, definition,
            created_by_principal_id, created_by_actor_snapshot_id,
            created_authorization_decision_id, source_command_id)
        VALUES (
            uuidv7(), p_profile_version_id, p_profile_id, p_enterprise_id, NULL,
            requirement_order, item, p_created_by_principal_id,
            p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
            p_source_command_id);
    END LOOP;
    RETURN QUERY SELECT 'OK', p_profile_version_id, next_version;
EXCEPTION
    WHEN unique_violation THEN
        RETURN QUERY SELECT 'CONFLICT', NULL::uuid, NULL::bigint;
END
$fn$;

CREATE FUNCTION quality_governance.activate_quality_profile(
    p_profile_id uuid,
    p_profile_version_id uuid,
    p_expected_version bigint,
    p_review_snapshot_ref jsonb,
    p_validation_snapshot_ref jsonb,
    p_activated_at timestamptz,
    p_updated_by_principal_id uuid,
    p_updated_by_actor_snapshot_id uuid,
    p_updated_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    profile_row quality_governance.quality_profile%ROWTYPE;
    version_row quality_governance.quality_profile_version%ROWTYPE;
BEGIN
    SELECT * INTO profile_row
      FROM quality_governance.quality_profile
     WHERE quality_profile_id = p_profile_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'; RETURN; END IF;
    PERFORM quality_governance.assert_business_write_context(
        profile_row.enterprise_id, NULL, p_updated_by_principal_id,
        p_updated_by_actor_snapshot_id, p_updated_authorization_decision_id);
    IF profile_row.aggregate_version <> p_expected_version THEN
        RETURN QUERY SELECT 'CONFLICT';
        RETURN;
    END IF;
    SELECT * INTO version_row
      FROM quality_governance.quality_profile_version
     WHERE profile_version_id = p_profile_version_id
       AND quality_profile_id = p_profile_id
       AND enterprise_id = profile_row.enterprise_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'; RETURN; END IF;
    IF version_row.status = 'ACTIVE' THEN RETURN QUERY SELECT 'ALREADY'; RETURN; END IF;
    IF version_row.status NOT IN ('DRAFT', 'UNDER_REVIEW') THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    IF p_review_snapshot_ref IS NULL OR p_validation_snapshot_ref IS NULL THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    IF profile_row.active_version_id IS NOT NULL THEN
        UPDATE quality_governance.quality_profile_version
           SET status = 'SUPERSEDED'
         WHERE profile_version_id = profile_row.active_version_id;
    END IF;
    UPDATE quality_governance.quality_profile_version
       SET status = 'ACTIVE',
           review_snapshot_ref = p_review_snapshot_ref,
           validation_snapshot_ref = p_validation_snapshot_ref,
           activated_at = p_activated_at
     WHERE profile_version_id = p_profile_version_id;
    UPDATE quality_governance.quality_profile
       SET status = 'ACTIVE',
           active_version_id = p_profile_version_id,
           aggregate_version = profile_row.aggregate_version + 1,
           updated_at = clock_timestamp(),
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           updated_authorization_decision_id = p_updated_authorization_decision_id,
           last_command_id = p_source_command_id
     WHERE quality_profile_id = p_profile_id;
    RETURN QUERY SELECT 'OK';
END
$fn$;

-- ---------------------------------------------------------------------------
-- RLS and ACL: app reads only; owner functions are the write boundary.
-- ---------------------------------------------------------------------------

ALTER TABLE quality_governance.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_select ON quality_governance.evidence FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY evidence_owner_all ON quality_governance.evidence FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.evidence_validation ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.evidence_validation FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_validation_select ON quality_governance.evidence_validation FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY evidence_validation_owner_all ON quality_governance.evidence_validation FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.evidence_revocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.evidence_revocation FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_revocation_select ON quality_governance.evidence_revocation FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY evidence_revocation_owner_all ON quality_governance.evidence_revocation FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.evidence_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.evidence_link FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_link_select ON quality_governance.evidence_link FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY evidence_link_owner_all ON quality_governance.evidence_link FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.quality_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.quality_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY quality_profile_select ON quality_governance.quality_profile FOR SELECT TO quality_governance_app
    USING (project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY quality_profile_owner_all ON quality_governance.quality_profile FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.quality_profile_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.quality_profile_version FORCE ROW LEVEL SECURITY;
CREATE POLICY quality_profile_version_select ON quality_governance.quality_profile_version FOR SELECT TO quality_governance_app
    USING (project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY quality_profile_version_owner_all ON quality_governance.quality_profile_version FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.quality_profile_gate_spec ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.quality_profile_gate_spec FORCE ROW LEVEL SECURITY;
CREATE POLICY quality_profile_gate_spec_select ON quality_governance.quality_profile_gate_spec FOR SELECT TO quality_governance_app
    USING (project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY quality_profile_gate_spec_owner_all ON quality_governance.quality_profile_gate_spec FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.quality_profile_gate_dependency ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.quality_profile_gate_dependency FORCE ROW LEVEL SECURITY;
CREATE POLICY quality_profile_gate_dependency_select ON quality_governance.quality_profile_gate_dependency FOR SELECT TO quality_governance_app
    USING (project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY quality_profile_gate_dependency_owner_all ON quality_governance.quality_profile_gate_dependency FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.quality_profile_approval_requirement ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.quality_profile_approval_requirement FORCE ROW LEVEL SECURITY;
CREATE POLICY quality_profile_approval_requirement_select ON quality_governance.quality_profile_approval_requirement FOR SELECT TO quality_governance_app
    USING (project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY quality_profile_approval_requirement_owner_all ON quality_governance.quality_profile_approval_requirement FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.quality_profile_release_requirement ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.quality_profile_release_requirement FORCE ROW LEVEL SECURITY;
CREATE POLICY quality_profile_release_requirement_select ON quality_governance.quality_profile_release_requirement FOR SELECT TO quality_governance_app
    USING (project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY quality_profile_release_requirement_owner_all ON quality_governance.quality_profile_release_requirement FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

REVOKE ALL ON quality_governance.evidence,
    quality_governance.evidence_validation,
    quality_governance.evidence_revocation,
    quality_governance.evidence_link,
    quality_governance.quality_profile,
    quality_governance.quality_profile_version,
    quality_governance.quality_profile_gate_spec,
    quality_governance.quality_profile_gate_dependency,
    quality_governance.quality_profile_approval_requirement,
    quality_governance.quality_profile_release_requirement
    FROM quality_governance_app;
GRANT SELECT ON quality_governance.evidence,
    quality_governance.evidence_validation,
    quality_governance.evidence_revocation,
    quality_governance.evidence_link,
    quality_governance.quality_profile,
    quality_governance.quality_profile_version,
    quality_governance.quality_profile_gate_spec,
    quality_governance.quality_profile_gate_dependency,
    quality_governance.quality_profile_approval_requirement,
    quality_governance.quality_profile_release_requirement
    TO quality_governance_app;

REVOKE ALL ON FUNCTION quality_governance.assert_business_write_context(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.assert_business_write_context(uuid, uuid, uuid, uuid, uuid) FROM quality_governance_app;
REVOKE ALL ON FUNCTION quality_governance.guard_business_fact_insert() FROM PUBLIC, quality_governance_app;
REVOKE ALL ON FUNCTION quality_governance.guard_append_only_fact() FROM PUBLIC, quality_governance_app;
REVOKE ALL ON FUNCTION quality_governance.guard_evidence_update() FROM PUBLIC, quality_governance_app;
REVOKE ALL ON FUNCTION quality_governance.guard_quality_profile_update() FROM PUBLIC, quality_governance_app;
REVOKE ALL ON FUNCTION quality_governance.guard_quality_profile_version_update() FROM PUBLIC, quality_governance_app;
REVOKE ALL ON FUNCTION quality_governance.create_evidence(uuid, uuid, uuid, jsonb, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.append_evidence_verification(uuid, uuid, bytea, bigint, jsonb, bytea, text, timestamptz, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.append_evidence_revocation(uuid, uuid, bytea, bigint, jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.create_evidence_link(uuid, uuid, bytea, jsonb, bytea, uuid, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.create_quality_profile_draft(uuid, uuid, uuid, jsonb, bytea, bigint, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.activate_quality_profile(uuid, uuid, bigint, jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quality_governance.create_evidence(uuid, uuid, uuid, jsonb, bytea, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.append_evidence_verification(uuid, uuid, bytea, bigint, jsonb, bytea, text, timestamptz, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.append_evidence_revocation(uuid, uuid, bytea, bigint, jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.create_evidence_link(uuid, uuid, bytea, jsonb, bytea, uuid, uuid, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.create_quality_profile_draft(uuid, uuid, uuid, jsonb, bytea, bigint, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.activate_quality_profile(uuid, uuid, bigint, jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid) TO quality_governance_app;

RESET ROLE;
