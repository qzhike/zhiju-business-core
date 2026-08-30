-- IM-05 WI-03 (issue #123): immutable ChangeImpact, GateResult, invalidation,
-- RevisionAcceptanceSnapshot, and ReleaseReadinessSnapshot facts. V5000-V5002
-- remain forward-only history; all new business writes cross owner functions.

SET ROLE quality_governance_owner;

-- ---------------------------------------------------------------------------
-- ChangeImpact and GateResult facts
-- ---------------------------------------------------------------------------

CREATE TABLE quality_governance.change_impact (
    change_impact_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    base_revision_ref jsonb NOT NULL,
    target_revision_ref jsonb NOT NULL,
    changed_units jsonb NOT NULL,
    unchanged_units jsonb NOT NULL,
    affected_claim_refs jsonb NOT NULL,
    affected_evidence_link_refs jsonb NOT NULL,
    affected_gate_spec_ids jsonb NOT NULL,
    toolchain_changes jsonb NOT NULL,
    profile_changes jsonb NOT NULL,
    analysis_method text NOT NULL,
    analysis_version text NOT NULL,
    analyzed_by jsonb NOT NULL,
    analyzed_at timestamptz NOT NULL,
    coverage jsonb NOT NULL,
    definition jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    impact_status text NOT NULL DEFAULT 'LIVE',
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT change_impact_revision_ref_object CHECK (
        jsonb_typeof(base_revision_ref) = 'object'
        AND jsonb_typeof(target_revision_ref) = 'object'),
    CONSTRAINT change_impact_array_fields CHECK (
        jsonb_typeof(changed_units) = 'array'
        AND jsonb_typeof(unchanged_units) = 'array'
        AND jsonb_typeof(affected_claim_refs) = 'array'
        AND jsonb_typeof(affected_evidence_link_refs) = 'array'
        AND jsonb_typeof(affected_gate_spec_ids) = 'array'
        AND jsonb_typeof(toolchain_changes) = 'array'
        AND jsonb_typeof(profile_changes) = 'array'),
    CONSTRAINT change_impact_analysis_object CHECK (
        jsonb_typeof(analyzed_by) = 'object'
        AND jsonb_typeof(coverage) = 'object'
        AND jsonb_typeof(definition) = 'object'),
    CONSTRAINT change_impact_text_nonempty CHECK (
        btrim(analysis_method) <> '' AND btrim(analysis_version) <> ''),
    CONSTRAINT change_impact_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT change_impact_status_closed CHECK (impact_status IN ('LIVE', 'STALE'))
);

CREATE INDEX change_impact_scope_target_idx
    ON quality_governance.change_impact (enterprise_id, project_id, target_revision_ref);
CREATE INDEX change_impact_base_target_idx
    ON quality_governance.change_impact (base_revision_ref, target_revision_ref);

CREATE TABLE quality_governance.gate_result (
    gate_result_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    artifact_ref jsonb NOT NULL,
    revision_ref jsonb NOT NULL,
    revision_content_hash bytea NOT NULL,
    gate_target jsonb NOT NULL,
    evaluation_stage text NOT NULL,
    quality_profile_ref jsonb NOT NULL,
    gate_spec_id uuid NOT NULL,
    gate_version text NOT NULL,
    evaluation_attempt integer NOT NULL,
    execution_mode text NOT NULL,
    evaluated_scope jsonb NOT NULL,
    input_snapshot_ref jsonb NOT NULL,
    evaluator jsonb NOT NULL,
    outcome text NOT NULL,
    findings jsonb NOT NULL,
    evidence_refs jsonb NOT NULL,
    review_issue_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    reuse_source_gate_result_ref jsonb,
    change_impact_ref jsonb,
    started_at timestamptz NOT NULL,
    completed_at timestamptz NOT NULL,
    validity_status text NOT NULL DEFAULT 'VALID',
    definition jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT gate_result_artifact_ref_object CHECK (jsonb_typeof(artifact_ref) = 'object'),
    CONSTRAINT gate_result_revision_ref_object CHECK (
        jsonb_typeof(revision_ref) = 'object'),
    CONSTRAINT gate_result_target_object CHECK (jsonb_typeof(gate_target) = 'object'),
    CONSTRAINT gate_result_profile_ref_object CHECK (
        jsonb_typeof(quality_profile_ref) = 'object'),
    CONSTRAINT gate_result_input_ref_object CHECK (
        jsonb_typeof(input_snapshot_ref) = 'object'),
    CONSTRAINT gate_result_evaluator_object CHECK (jsonb_typeof(evaluator) = 'object'),
    CONSTRAINT gate_result_array_fields CHECK (
        jsonb_typeof(findings) = 'array'
        AND jsonb_typeof(evidence_refs) = 'array'
        AND jsonb_typeof(review_issue_refs) = 'array'
        AND jsonb_typeof(definition) = 'object'),
    CONSTRAINT gate_result_revision_hash_len CHECK (octet_length(revision_content_hash) = 32),
    CONSTRAINT gate_result_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT gate_result_stage_closed CHECK (
        evaluation_stage IN ('REVISION_ACCEPTANCE', 'RELEASE_READINESS')),
    CONSTRAINT gate_result_outcome_closed CHECK (
        outcome IN ('PASS', 'FAIL', 'ERROR', 'SKIPPED', 'NOT_APPLICABLE')),
    CONSTRAINT gate_result_execution_mode_closed CHECK (
        execution_mode IN ('EXECUTED', 'REUSED_BY_IMPACT_ANALYSIS')),
    CONSTRAINT gate_result_validity_closed CHECK (validity_status = 'VALID'),
    CONSTRAINT gate_result_attempt_positive CHECK (evaluation_attempt >= 1),
    CONSTRAINT gate_result_time_order CHECK (completed_at >= started_at),
    CONSTRAINT gate_result_target_stage CHECK (
        (evaluation_stage = 'REVISION_ACCEPTANCE'
            AND gate_target->>'kind' = 'REVISION')
        OR (evaluation_stage = 'RELEASE_READINESS'
            AND gate_target->>'kind' IN ('REPRESENTATION', 'RELEASE_PACKAGE'))),
    CONSTRAINT gate_result_reuse_pair CHECK (
        (execution_mode = 'EXECUTED'
            AND reuse_source_gate_result_ref IS NULL
            AND change_impact_ref IS NULL)
        OR (execution_mode = 'REUSED_BY_IMPACT_ANALYSIS'
            AND reuse_source_gate_result_ref IS NOT NULL
            AND change_impact_ref IS NOT NULL))
);

CREATE INDEX gate_result_scope_target_idx
    ON quality_governance.gate_result (enterprise_id, project_id, gate_result_id);
CREATE INDEX gate_result_revision_gate_idx
    ON quality_governance.gate_result (revision_ref, gate_spec_id, evaluation_stage, completed_at DESC);
CREATE INDEX gate_result_profile_idx
    ON quality_governance.gate_result (quality_profile_ref, gate_spec_id, completed_at DESC);

CREATE TABLE quality_governance.gate_result_reuse (
    reuse_id uuid PRIMARY KEY,
    gate_result_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    source_gate_result_ref jsonb NOT NULL,
    source_gate_result_hash bytea NOT NULL,
    change_impact_ref jsonb NOT NULL,
    change_impact_hash bytea NOT NULL,
    coverage_proof jsonb NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT gate_result_reuse_source_ref_object CHECK (
        jsonb_typeof(source_gate_result_ref) = 'object'),
    CONSTRAINT gate_result_reuse_impact_ref_object CHECK (
        jsonb_typeof(change_impact_ref) = 'object'),
    CONSTRAINT gate_result_reuse_coverage_object CHECK (
        jsonb_typeof(coverage_proof) = 'object'),
    CONSTRAINT gate_result_reuse_source_hash_len CHECK (octet_length(source_gate_result_hash) = 32),
    CONSTRAINT gate_result_reuse_impact_hash_len CHECK (octet_length(change_impact_hash) = 32),
    CONSTRAINT gate_result_reuse_gate_fk FOREIGN KEY (gate_result_id)
        REFERENCES quality_governance.gate_result (gate_result_id) ON DELETE RESTRICT,
    CONSTRAINT gate_result_reuse_one_per_result UNIQUE (gate_result_id)
);

CREATE INDEX gate_result_reuse_source_idx
    ON quality_governance.gate_result_reuse (source_gate_result_ref, change_impact_ref);

CREATE TABLE quality_governance.gate_invalidation (
    invalidation_id uuid PRIMARY KEY,
    gate_result_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    gate_result_ref jsonb NOT NULL,
    gate_result_hash bytea NOT NULL,
    invalidation_reason jsonb NOT NULL,
    impact_assessment_ref jsonb NOT NULL,
    invalidated_at timestamptz NOT NULL,
    impact_status text NOT NULL DEFAULT 'STALE',
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT gate_invalidation_result_ref_object CHECK (
        jsonb_typeof(gate_result_ref) = 'object'),
    CONSTRAINT gate_invalidation_reason_object CHECK (
        jsonb_typeof(invalidation_reason) = 'object'),
    CONSTRAINT gate_invalidation_impact_ref_object CHECK (
        jsonb_typeof(impact_assessment_ref) = 'object'),
    CONSTRAINT gate_invalidation_hash_len CHECK (octet_length(gate_result_hash) = 32),
    CONSTRAINT gate_invalidation_status_closed CHECK (impact_status = 'STALE'),
    CONSTRAINT gate_invalidation_gate_fk FOREIGN KEY (gate_result_id)
        REFERENCES quality_governance.gate_result (gate_result_id) ON DELETE RESTRICT,
    CONSTRAINT gate_invalidation_one_per_result UNIQUE (gate_result_id)
);

CREATE INDEX gate_invalidation_scope_result_idx
    ON quality_governance.gate_invalidation (enterprise_id, project_id, gate_result_id);

-- ---------------------------------------------------------------------------
-- Immutable readiness snapshots
-- ---------------------------------------------------------------------------

CREATE TABLE quality_governance.revision_acceptance_snapshot (
    snapshot_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    artifact_ref jsonb NOT NULL,
    revision_ref jsonb NOT NULL,
    revision_content_hash bytea NOT NULL,
    quality_profile_ref jsonb NOT NULL,
    evidence_status_snapshot_ref jsonb NOT NULL,
    issue_snapshot_ref jsonb NOT NULL,
    gate_result_refs jsonb NOT NULL,
    status text NOT NULL,
    snapshot jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    evaluated_at timestamptz NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT revision_acceptance_snapshot_artifact_object CHECK (
        jsonb_typeof(artifact_ref) = 'object'),
    CONSTRAINT revision_acceptance_snapshot_revision_object CHECK (
        jsonb_typeof(revision_ref) = 'object'),
    CONSTRAINT revision_acceptance_snapshot_profile_object CHECK (
        jsonb_typeof(quality_profile_ref) = 'object'),
    CONSTRAINT revision_acceptance_snapshot_input_objects CHECK (
        jsonb_typeof(evidence_status_snapshot_ref) = 'object'
        AND jsonb_typeof(issue_snapshot_ref) = 'object'
        AND jsonb_typeof(gate_result_refs) = 'array'
        AND jsonb_typeof(snapshot) = 'object'),
    CONSTRAINT revision_acceptance_snapshot_revision_hash_len CHECK (
        octet_length(revision_content_hash) = 32),
    CONSTRAINT revision_acceptance_snapshot_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT revision_acceptance_snapshot_status_closed CHECK (
        status IN ('READY', 'NOT_READY', 'STALE'))
);

CREATE INDEX revision_acceptance_snapshot_revision_idx
    ON quality_governance.revision_acceptance_snapshot
       (enterprise_id, project_id, revision_ref, evaluated_at DESC);

CREATE TABLE quality_governance.release_readiness_snapshot (
    snapshot_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    release_ref jsonb NOT NULL,
    artifact_ref jsonb NOT NULL,
    revision_ref jsonb NOT NULL,
    revision_content_hash bytea NOT NULL,
    approval_bundle_snapshot_ref jsonb NOT NULL,
    release_package_ref jsonb NOT NULL,
    package_hash bytea NOT NULL,
    representation_refs jsonb NOT NULL,
    recipient_scope_snapshot_ref jsonb NOT NULL,
    destination_refs jsonb NOT NULL,
    release_gate_result_refs jsonb NOT NULL,
    status text NOT NULL,
    snapshot jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    evaluated_at timestamptz NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT release_readiness_snapshot_release_object CHECK (
        jsonb_typeof(release_ref) = 'object'),
    CONSTRAINT release_readiness_snapshot_artifact_object CHECK (
        jsonb_typeof(artifact_ref) = 'object'),
    CONSTRAINT release_readiness_snapshot_revision_object CHECK (
        jsonb_typeof(revision_ref) = 'object'),
    CONSTRAINT release_readiness_snapshot_input_objects CHECK (
        jsonb_typeof(approval_bundle_snapshot_ref) = 'object'
        AND jsonb_typeof(release_package_ref) = 'object'
        AND jsonb_typeof(representation_refs) = 'array'
        AND jsonb_typeof(recipient_scope_snapshot_ref) = 'object'
        AND jsonb_typeof(destination_refs) = 'array'
        AND jsonb_typeof(release_gate_result_refs) = 'array'
        AND jsonb_typeof(snapshot) = 'object'),
    CONSTRAINT release_readiness_snapshot_revision_hash_len CHECK (
        octet_length(revision_content_hash) = 32),
    CONSTRAINT release_readiness_snapshot_package_hash_len CHECK (octet_length(package_hash) = 32),
    CONSTRAINT release_readiness_snapshot_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT release_readiness_snapshot_status_closed CHECK (
        status IN ('READY_FOR_AUTHORIZATION', 'NOT_READY', 'STALE'))
);

CREATE INDEX release_readiness_snapshot_release_idx
    ON quality_governance.release_readiness_snapshot
       (enterprise_id, project_id, release_ref, evaluated_at DESC);

-- ---------------------------------------------------------------------------
-- Common append-only guards
-- ---------------------------------------------------------------------------

CREATE TRIGGER change_impact_insert_guard
    BEFORE INSERT ON quality_governance.change_impact
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER change_impact_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.change_impact
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();

CREATE TRIGGER gate_result_insert_guard
    BEFORE INSERT ON quality_governance.gate_result
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER gate_result_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.gate_result
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();

CREATE TRIGGER gate_result_reuse_insert_guard
    BEFORE INSERT ON quality_governance.gate_result_reuse
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER gate_result_reuse_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.gate_result_reuse
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();

CREATE TRIGGER gate_invalidation_insert_guard
    BEFORE INSERT ON quality_governance.gate_invalidation
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER gate_invalidation_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.gate_invalidation
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();

CREATE TRIGGER revision_acceptance_snapshot_insert_guard
    BEFORE INSERT ON quality_governance.revision_acceptance_snapshot
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER revision_acceptance_snapshot_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.revision_acceptance_snapshot
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();

CREATE TRIGGER release_readiness_snapshot_insert_guard
    BEFORE INSERT ON quality_governance.release_readiness_snapshot
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_business_fact_insert();
CREATE TRIGGER release_readiness_snapshot_immutable_guard
    BEFORE UPDATE OR DELETE ON quality_governance.release_readiness_snapshot
    FOR EACH ROW EXECUTE FUNCTION quality_governance.guard_append_only_fact();

-- ---------------------------------------------------------------------------
-- Owner functions
-- ---------------------------------------------------------------------------

CREATE FUNCTION quality_governance.create_change_impact(
    p_change_impact_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_definition jsonb,
    p_payload_hash bytea,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_by_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    PERFORM quality_governance.assert_business_write_context(
        p_enterprise_id, p_project_id, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_by_authorization_decision_id);
    IF p_definition IS NULL OR jsonb_typeof(p_definition) <> 'object'
       OR p_payload_hash IS NULL OR octet_length(p_payload_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM quality_governance.change_impact
         WHERE change_impact_id = p_change_impact_id) THEN
        RETURN QUERY SELECT 'CONFLICT';
        RETURN;
    END IF;
    INSERT INTO quality_governance.change_impact (
        change_impact_id, enterprise_id, project_id,
        base_revision_ref, target_revision_ref, changed_units, unchanged_units,
        affected_claim_refs, affected_evidence_link_refs, affected_gate_spec_ids,
        toolchain_changes, profile_changes, analysis_method, analysis_version,
        analyzed_by, analyzed_at, coverage, definition, payload_hash,
        created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_change_impact_id, p_enterprise_id, p_project_id,
        p_definition->'baseRevisionRef', p_definition->'targetRevisionRef',
        p_definition->'changedUnits', p_definition->'unchangedUnits',
        p_definition->'affectedClaimRefs', p_definition->'affectedEvidenceLinkRefs',
        p_definition->'affectedGateSpecIds', p_definition->'toolchainChanges',
        p_definition->'profileChanges', p_definition->>'analysisMethod',
        coalesce(p_definition->>'analysisVersion', '1.0'), p_definition->'analyzedBy',
        (p_definition->>'analyzedAt')::timestamptz, p_definition->'coverage',
        p_definition, p_payload_hash, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_by_authorization_decision_id,
        p_source_command_id);
    RETURN QUERY SELECT 'OK';
EXCEPTION
    WHEN not_null_violation OR check_violation OR invalid_text_representation THEN
        RETURN QUERY SELECT 'INVALID';
    WHEN unique_violation THEN
        RETURN QUERY SELECT 'CONFLICT';
END
$fn$;

CREATE FUNCTION quality_governance.create_gate_result(
    p_gate_result_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_definition jsonb,
    p_revision_content_hash bytea,
    p_evaluation_stage text,
    p_execution_mode text,
    p_payload_hash bytea,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_by_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    PERFORM quality_governance.assert_business_write_context(
        p_enterprise_id, p_project_id, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_by_authorization_decision_id);
    IF p_definition IS NULL OR jsonb_typeof(p_definition) <> 'object'
       OR p_revision_content_hash IS NULL OR octet_length(p_revision_content_hash) <> 32
       OR p_payload_hash IS NULL OR octet_length(p_payload_hash) <> 32
       OR p_evaluation_stage NOT IN ('REVISION_ACCEPTANCE', 'RELEASE_READINESS')
       OR p_execution_mode NOT IN ('EXECUTED', 'REUSED_BY_IMPACT_ANALYSIS') THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM quality_governance.gate_result
         WHERE gate_result_id = p_gate_result_id) THEN
        RETURN QUERY SELECT 'CONFLICT';
        RETURN;
    END IF;
    IF (p_evaluation_stage = 'REVISION_ACCEPTANCE'
          AND p_definition->'gateTarget'->>'kind' <> 'REVISION')
       OR (p_evaluation_stage = 'RELEASE_READINESS'
          AND p_definition->'gateTarget'->>'kind' NOT IN ('REPRESENTATION', 'RELEASE_PACKAGE')) THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    INSERT INTO quality_governance.gate_result (
        gate_result_id, enterprise_id, project_id, artifact_ref, revision_ref,
        revision_content_hash, gate_target, evaluation_stage, quality_profile_ref,
        gate_spec_id, gate_version, evaluation_attempt, execution_mode,
        evaluated_scope, input_snapshot_ref, evaluator, outcome, findings,
        evidence_refs, review_issue_refs, reuse_source_gate_result_ref,
        change_impact_ref, started_at, completed_at, definition, payload_hash,
        created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_gate_result_id, p_enterprise_id, p_project_id,
        p_definition->'artifactRef', p_definition->'gateTarget'->'revisionRef',
        p_revision_content_hash, p_definition->'gateTarget', p_evaluation_stage,
        p_definition->'qualityProfileRef', (p_definition->>'gateSpecId')::uuid,
        p_definition->>'gateVersion', (p_definition->>'evaluationAttempt')::integer,
        p_execution_mode, p_definition->'evaluatedScope', p_definition->'inputSnapshotRef',
        p_definition->'evaluator', p_definition->>'outcome', p_definition->'findings',
        p_definition->'evidenceRefs', coalesce(p_definition->'reviewIssueRefs', '[]'::jsonb),
        p_definition->'reuseSourceGateResultRef', p_definition->'changeImpactRef',
        (p_definition->>'startedAt')::timestamptz,
        (p_definition->>'completedAt')::timestamptz, p_definition, p_payload_hash,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_by_authorization_decision_id, p_source_command_id);
    RETURN QUERY SELECT 'OK';
EXCEPTION
    WHEN not_null_violation OR check_violation OR invalid_text_representation THEN
        RETURN QUERY SELECT 'INVALID';
    WHEN unique_violation THEN
        RETURN QUERY SELECT 'CONFLICT';
END
$fn$;

CREATE FUNCTION quality_governance.create_gate_result_reuse(
    p_reuse_id uuid,
    p_gate_result_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_source_gate_result_ref jsonb,
    p_source_gate_result_hash bytea,
    p_change_impact_ref jsonb,
    p_change_impact_hash bytea,
    p_coverage_proof jsonb,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_by_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    result_row quality_governance.gate_result%ROWTYPE;
BEGIN
    SELECT * INTO result_row
      FROM quality_governance.gate_result
     WHERE gate_result_id = p_gate_result_id
       AND enterprise_id = p_enterprise_id
       AND project_id IS NOT DISTINCT FROM p_project_id;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'; RETURN; END IF;
    PERFORM quality_governance.assert_business_write_context(
        result_row.enterprise_id, result_row.project_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_by_authorization_decision_id);
    IF p_source_gate_result_ref IS NULL OR jsonb_typeof(p_source_gate_result_ref) <> 'object'
       OR p_change_impact_ref IS NULL OR jsonb_typeof(p_change_impact_ref) <> 'object'
       OR p_coverage_proof IS NULL OR jsonb_typeof(p_coverage_proof) <> 'object'
       OR p_source_gate_result_hash IS NULL OR octet_length(p_source_gate_result_hash) <> 32
       OR p_change_impact_hash IS NULL OR octet_length(p_change_impact_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    INSERT INTO quality_governance.gate_result_reuse (
        reuse_id, gate_result_id, enterprise_id, project_id,
        source_gate_result_ref, source_gate_result_hash, change_impact_ref,
        change_impact_hash, coverage_proof, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id,
        source_command_id)
    VALUES (
        p_reuse_id, p_gate_result_id, result_row.enterprise_id, result_row.project_id,
        p_source_gate_result_ref, p_source_gate_result_hash, p_change_impact_ref,
        p_change_impact_hash, p_coverage_proof, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_by_authorization_decision_id,
        p_source_command_id);
    RETURN QUERY SELECT 'OK';
EXCEPTION
    WHEN unique_violation THEN
        RETURN QUERY SELECT 'CONFLICT';
    WHEN check_violation THEN
        RETURN QUERY SELECT 'INVALID';
END
$fn$;

CREATE FUNCTION quality_governance.create_gate_invalidation(
    p_invalidation_id uuid,
    p_gate_result_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_gate_result_ref jsonb,
    p_gate_result_hash bytea,
    p_invalidation_reason jsonb,
    p_impact_assessment_ref jsonb,
    p_invalidated_at timestamptz,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_by_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    result_row quality_governance.gate_result%ROWTYPE;
BEGIN
    SELECT * INTO result_row
      FROM quality_governance.gate_result
     WHERE gate_result_id = p_gate_result_id
       AND enterprise_id = p_enterprise_id
       AND project_id IS NOT DISTINCT FROM p_project_id
       AND payload_hash = p_gate_result_hash
     FOR SHARE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND'; RETURN; END IF;
    PERFORM quality_governance.assert_business_write_context(
        result_row.enterprise_id, result_row.project_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_by_authorization_decision_id);
    IF p_gate_result_ref IS NULL OR jsonb_typeof(p_gate_result_ref) <> 'object'
       OR p_gate_result_hash IS NULL OR octet_length(p_gate_result_hash) <> 32
       OR p_invalidation_reason IS NULL OR jsonb_typeof(p_invalidation_reason) <> 'object'
       OR p_impact_assessment_ref IS NULL OR jsonb_typeof(p_impact_assessment_ref) <> 'object'
       OR p_invalidated_at IS NULL THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    INSERT INTO quality_governance.gate_invalidation (
        invalidation_id, gate_result_id, enterprise_id, project_id,
        gate_result_ref, gate_result_hash, invalidation_reason,
        impact_assessment_ref, invalidated_at, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id,
        source_command_id)
    VALUES (
        p_invalidation_id, result_row.gate_result_id, result_row.enterprise_id,
        result_row.project_id, p_gate_result_ref, p_gate_result_hash,
        p_invalidation_reason, p_impact_assessment_ref, p_invalidated_at,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_by_authorization_decision_id, p_source_command_id);
    RETURN QUERY SELECT 'OK';
EXCEPTION
    WHEN unique_violation THEN
        RETURN QUERY SELECT 'ALREADY';
    WHEN check_violation THEN
        RETURN QUERY SELECT 'INVALID';
END
$fn$;

CREATE FUNCTION quality_governance.create_revision_acceptance_snapshot(
    p_snapshot_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_snapshot jsonb,
    p_revision_content_hash bytea,
    p_payload_hash bytea,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_by_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    PERFORM quality_governance.assert_business_write_context(
        p_enterprise_id, p_project_id, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_by_authorization_decision_id);
    IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
       OR p_snapshot->>'evaluationStage' <> 'REVISION_ACCEPTANCE'
       OR p_revision_content_hash IS NULL OR octet_length(p_revision_content_hash) <> 32
       OR p_payload_hash IS NULL OR octet_length(p_payload_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM quality_governance.revision_acceptance_snapshot
         WHERE snapshot_id = p_snapshot_id) THEN
        RETURN QUERY SELECT 'CONFLICT';
        RETURN;
    END IF;
    INSERT INTO quality_governance.revision_acceptance_snapshot (
        snapshot_id, enterprise_id, project_id, artifact_ref, revision_ref,
        revision_content_hash, quality_profile_ref, evidence_status_snapshot_ref,
        issue_snapshot_ref, gate_result_refs, status, snapshot, payload_hash,
        evaluated_at, created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_snapshot_id, p_enterprise_id, p_project_id, p_snapshot->'artifactRef',
        p_snapshot->'revisionRef', p_revision_content_hash,
        p_snapshot->'qualityProfileRef', p_snapshot->'evidenceStatusSnapshotRef',
        p_snapshot->'reviewIssueSnapshot', p_snapshot->'gateResultRefs',
        p_snapshot->'readiness'->>'status', p_snapshot, p_payload_hash,
        (p_snapshot->>'evaluatedAt')::timestamptz, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_by_authorization_decision_id,
        p_source_command_id);
    RETURN QUERY SELECT 'OK';
EXCEPTION
    WHEN not_null_violation OR check_violation OR invalid_text_representation THEN
        RETURN QUERY SELECT 'INVALID';
    WHEN unique_violation THEN
        RETURN QUERY SELECT 'CONFLICT';
END
$fn$;

CREATE FUNCTION quality_governance.create_release_readiness_snapshot(
    p_snapshot_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_snapshot jsonb,
    p_revision_content_hash bytea,
    p_payload_hash bytea,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_by_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    PERFORM quality_governance.assert_business_write_context(
        p_enterprise_id, p_project_id, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_by_authorization_decision_id);
    IF p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object'
       OR p_snapshot->>'releasePackageRef' IS NULL
       OR p_snapshot->'releasePackageRef'->>'packageHash' IS NULL
       OR p_snapshot->'readiness'->>'status' NOT IN
          ('READY_FOR_AUTHORIZATION', 'NOT_READY', 'STALE')
       OR p_revision_content_hash IS NULL OR octet_length(p_revision_content_hash) <> 32
       OR p_payload_hash IS NULL OR octet_length(p_payload_hash) <> 32 THEN
        RETURN QUERY SELECT 'INVALID';
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM quality_governance.release_readiness_snapshot
         WHERE snapshot_id = p_snapshot_id) THEN
        RETURN QUERY SELECT 'CONFLICT';
        RETURN;
    END IF;
    INSERT INTO quality_governance.release_readiness_snapshot (
        snapshot_id, enterprise_id, project_id, release_ref, artifact_ref,
        revision_ref, revision_content_hash, approval_bundle_snapshot_ref,
        release_package_ref, package_hash, representation_refs,
        recipient_scope_snapshot_ref, destination_refs, release_gate_result_refs,
        status, snapshot, payload_hash, evaluated_at, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id,
        source_command_id)
    VALUES (
        p_snapshot_id, p_enterprise_id, p_project_id, p_snapshot->'releaseRef',
        p_snapshot->'artifactRef', p_snapshot->'revisionRef', p_revision_content_hash,
        p_snapshot->'approvalBundleSnapshotRef', p_snapshot->'releasePackageRef',
        decode(p_snapshot->'releasePackageRef'->'packageHash'->>'digest', 'hex'),
        coalesce(p_snapshot->'representationRefs', '[]'::jsonb),
        p_snapshot->'recipientScopeSnapshotRef', p_snapshot->'destinationRefs',
        p_snapshot->'releaseGateResultRefs', p_snapshot->'readiness'->>'status',
        p_snapshot, p_payload_hash, (p_snapshot->>'evaluatedAt')::timestamptz,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_by_authorization_decision_id, p_source_command_id);
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

ALTER TABLE quality_governance.change_impact ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.change_impact FORCE ROW LEVEL SECURITY;
CREATE POLICY change_impact_select ON quality_governance.change_impact FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY change_impact_owner_all ON quality_governance.change_impact FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.gate_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.gate_result FORCE ROW LEVEL SECURITY;
CREATE POLICY gate_result_select ON quality_governance.gate_result FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY gate_result_owner_all ON quality_governance.gate_result FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.gate_result_reuse ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.gate_result_reuse FORCE ROW LEVEL SECURITY;
CREATE POLICY gate_result_reuse_select ON quality_governance.gate_result_reuse FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY gate_result_reuse_owner_all ON quality_governance.gate_result_reuse FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.gate_invalidation ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.gate_invalidation FORCE ROW LEVEL SECURITY;
CREATE POLICY gate_invalidation_select ON quality_governance.gate_invalidation FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY gate_invalidation_owner_all ON quality_governance.gate_invalidation FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.revision_acceptance_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.revision_acceptance_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY revision_acceptance_snapshot_select ON quality_governance.revision_acceptance_snapshot FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY revision_acceptance_snapshot_owner_all ON quality_governance.revision_acceptance_snapshot FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

ALTER TABLE quality_governance.release_readiness_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_governance.release_readiness_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY release_readiness_snapshot_select ON quality_governance.release_readiness_snapshot FOR SELECT TO quality_governance_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY release_readiness_snapshot_owner_all ON quality_governance.release_readiness_snapshot FOR ALL TO quality_governance_owner
    USING (true) WITH CHECK (true);

REVOKE ALL ON quality_governance.change_impact,
    quality_governance.gate_result,
    quality_governance.gate_result_reuse,
    quality_governance.gate_invalidation,
    quality_governance.revision_acceptance_snapshot,
    quality_governance.release_readiness_snapshot
    FROM quality_governance_app;
GRANT SELECT ON quality_governance.change_impact,
    quality_governance.gate_result,
    quality_governance.gate_result_reuse,
    quality_governance.gate_invalidation,
    quality_governance.revision_acceptance_snapshot,
    quality_governance.release_readiness_snapshot
    TO quality_governance_app;

REVOKE ALL ON FUNCTION quality_governance.create_change_impact(uuid, uuid, uuid, jsonb, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.create_gate_result(uuid, uuid, uuid, jsonb, bytea, text, text, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.create_gate_result_reuse(uuid, uuid, uuid, uuid, jsonb, bytea, jsonb, bytea, jsonb, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.create_gate_invalidation(uuid, uuid, uuid, uuid, jsonb, bytea, jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.create_revision_acceptance_snapshot(uuid, uuid, uuid, jsonb, bytea, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quality_governance.create_release_readiness_snapshot(uuid, uuid, uuid, jsonb, bytea, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION quality_governance.create_change_impact(uuid, uuid, uuid, jsonb, bytea, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.create_gate_result(uuid, uuid, uuid, jsonb, bytea, text, text, bytea, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.create_gate_result_reuse(uuid, uuid, uuid, uuid, jsonb, bytea, jsonb, bytea, jsonb, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.create_gate_invalidation(uuid, uuid, uuid, uuid, jsonb, bytea, jsonb, jsonb, timestamptz, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.create_revision_acceptance_snapshot(uuid, uuid, uuid, jsonb, bytea, bytea, uuid, uuid, uuid, uuid) TO quality_governance_app;
GRANT EXECUTE ON FUNCTION quality_governance.create_release_readiness_snapshot(uuid, uuid, uuid, jsonb, bytea, bytea, uuid, uuid, uuid, uuid) TO quality_governance_app;

RESET ROLE;
