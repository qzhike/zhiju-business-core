-- IM-03 WI-09 (issue #65): Project-owned GapAnalysis roots, exact input
-- snapshots, immutable findings and Human decision history.
--
-- The evaluator is intentionally controlled by the application boundary. The
-- database protects the facts it receives: exact Project scope, immutable
-- input/finding/decision rows, a single aggregate CAS pointer and explicit
-- STALE transitions when a referenced baseline changes.

SET ROLE enterprise_project_owner;

-- ---------------------------------------------------------------------------
-- GapAnalysis root and exact input snapshot.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.gap_analysis (
    gap_analysis_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    current_version_id uuid NOT NULL,
    accepted_version_id uuid,
    status text NOT NULL,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT gap_analysis_scope_unique
        UNIQUE (enterprise_id, project_id, gap_analysis_id),
    CONSTRAINT gap_analysis_status_closed CHECK (
        status IN ('COMPLETED', 'UNDER_REVIEW', 'ACCEPTED',
                   'CHANGES_REQUIRED', 'REJECTED', 'STALE')),
    CONSTRAINT gap_analysis_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT gap_analysis_retention_nonempty CHECK (length(retention_class) > 0),
    CONSTRAINT gap_analysis_accepted_shape CHECK (
        (status = 'ACCEPTED' AND accepted_version_id IS NOT NULL)
        OR (status <> 'ACCEPTED' AND accepted_version_id IS NULL))
);

ALTER TABLE enterprise_project.gap_analysis
    ADD CONSTRAINT gap_analysis_project_fk
    FOREIGN KEY (enterprise_id, project_id)
    REFERENCES enterprise_project.project (enterprise_id, project_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX gap_analysis_project_idx
    ON enterprise_project.gap_analysis (enterprise_id, project_id, updated_at DESC);

CREATE TABLE enterprise_project.gap_analysis_input_snapshot (
    input_snapshot_id uuid PRIMARY KEY,
    gap_analysis_id uuid NOT NULL,
    version_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    customer_baseline_ref jsonb NOT NULL,
    customer_baseline_id uuid NOT NULL,
    customer_baseline_version_id uuid NOT NULL,
    template_baseline_ref jsonb NOT NULL,
    template_baseline_id uuid NOT NULL,
    template_baseline_version_id uuid NOT NULL,
    regulatory_profile_ref jsonb NOT NULL,
    regulatory_profile_id uuid NOT NULL,
    regulatory_profile_version_id uuid NOT NULL,
    enterprise_profile_snapshot_ref jsonb NOT NULL,
    enterprise_profile_snapshot_id uuid NOT NULL,
    enterprise_profile_payload_hash bytea NOT NULL,
    qms_configuration_ref jsonb NOT NULL,
    qms_configuration_id uuid NOT NULL,
    qms_configuration_revision_id uuid NOT NULL,
    qms_configuration_revision_hash bytea NOT NULL,
    product_scope_snapshot_ref jsonb NOT NULL,
    product_scope_snapshot_id uuid NOT NULL,
    product_scope_payload_hash bytea NOT NULL,
    analysis_policy_ref jsonb NOT NULL,
    analysis_policy_id uuid NOT NULL,
    analysis_policy_version_id uuid NOT NULL,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT gap_analysis_input_scope_unique
        UNIQUE (enterprise_id, project_id, gap_analysis_id, input_snapshot_id),
    CONSTRAINT gap_analysis_input_version_unique
        UNIQUE (enterprise_id, project_id, gap_analysis_id, version_id),
    CONSTRAINT gap_analysis_input_refs_objects CHECK (
        jsonb_typeof(customer_baseline_ref) = 'object'
        AND jsonb_typeof(template_baseline_ref) = 'object'
        AND jsonb_typeof(regulatory_profile_ref) = 'object'
        AND jsonb_typeof(enterprise_profile_snapshot_ref) = 'object'
        AND jsonb_typeof(qms_configuration_ref) = 'object'
        AND jsonb_typeof(product_scope_snapshot_ref) = 'object'
        AND jsonb_typeof(analysis_policy_ref) = 'object'),
    CONSTRAINT gap_analysis_input_payload_object CHECK (
        jsonb_typeof(payload) = 'object'),
    CONSTRAINT gap_analysis_input_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT gap_analysis_input_profile_hash_len CHECK (
        octet_length(enterprise_profile_payload_hash) = 32),
    CONSTRAINT gap_analysis_input_qms_hash_len CHECK (
        octet_length(qms_configuration_revision_hash) = 32),
    CONSTRAINT gap_analysis_input_product_hash_len CHECK (
        octet_length(product_scope_payload_hash) = 32)
);

ALTER TABLE enterprise_project.gap_analysis_input_snapshot
    ADD CONSTRAINT gap_analysis_input_root_fk
    FOREIGN KEY (enterprise_id, project_id, gap_analysis_id)
    REFERENCES enterprise_project.gap_analysis
        (enterprise_id, project_id, gap_analysis_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX gap_analysis_input_project_idx
    ON enterprise_project.gap_analysis_input_snapshot
        (enterprise_id, project_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Immutable analysis versions and findings.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.gap_analysis_version (
    version_id uuid PRIMARY KEY,
    gap_analysis_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    version_no integer NOT NULL,
    version_status text NOT NULL DEFAULT 'COMPLETED',
    mode text NOT NULL,
    input_snapshot_id uuid NOT NULL,
    requested_scope jsonb NOT NULL,
    findings_summary jsonb NOT NULL,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    stale_reason jsonb,
    stale_at timestamptz,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT gap_analysis_version_scope_unique
        UNIQUE (enterprise_id, project_id, gap_analysis_id, version_id),
    CONSTRAINT gap_analysis_version_no_unique
        UNIQUE (gap_analysis_id, version_no),
    CONSTRAINT gap_analysis_version_no_positive CHECK (version_no >= 1),
    CONSTRAINT gap_analysis_version_status_closed CHECK (
        version_status IN ('COMPLETED', 'UNDER_REVIEW', 'ACCEPTED',
                           'CHANGES_REQUIRED', 'REJECTED', 'STALE')),
    CONSTRAINT gap_analysis_version_mode_closed CHECK (mode IN ('FORMAL', 'EXPLORATORY')),
    CONSTRAINT gap_analysis_version_scope_object CHECK (
        jsonb_typeof(requested_scope) = 'object'),
    CONSTRAINT gap_analysis_version_summary_object CHECK (
        jsonb_typeof(findings_summary) = 'object'),
    CONSTRAINT gap_analysis_version_payload_object CHECK (
        jsonb_typeof(payload) = 'object'),
    CONSTRAINT gap_analysis_version_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT gap_analysis_version_stale_shape CHECK (
        (version_status = 'STALE' AND stale_reason IS NOT NULL AND stale_at IS NOT NULL)
        OR (version_status <> 'STALE' AND stale_reason IS NULL AND stale_at IS NULL)),
    CONSTRAINT gap_analysis_version_stale_reason_object CHECK (
        stale_reason IS NULL OR jsonb_typeof(stale_reason) = 'object')
);

ALTER TABLE enterprise_project.gap_analysis_version
    ADD CONSTRAINT gap_analysis_version_root_fk
    FOREIGN KEY (enterprise_id, project_id, gap_analysis_id)
    REFERENCES enterprise_project.gap_analysis
        (enterprise_id, project_id, gap_analysis_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.gap_analysis_version
    ADD CONSTRAINT gap_analysis_version_input_fk
    FOREIGN KEY (enterprise_id, project_id, gap_analysis_id, input_snapshot_id)
    REFERENCES enterprise_project.gap_analysis_input_snapshot
        (enterprise_id, project_id, gap_analysis_id, input_snapshot_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX gap_analysis_version_root_idx
    ON enterprise_project.gap_analysis_version
        (gap_analysis_id, version_no DESC);
CREATE INDEX gap_analysis_version_dependency_idx
    ON enterprise_project.gap_analysis_version
        (enterprise_id, project_id, version_status);

CREATE TABLE enterprise_project.gap_finding (
    finding_id uuid NOT NULL,
    gap_analysis_id uuid NOT NULL,
    version_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    subject_key text NOT NULL,
    subject_type text NOT NULL,
    customer_baseline_item_refs jsonb NOT NULL,
    template_refs jsonb NOT NULL,
    regulatory_item_refs jsonb NOT NULL,
    gap_status text NOT NULL,
    severity text NOT NULL,
    rationale jsonb NOT NULL,
    evidence_refs jsonb NOT NULL,
    recommended_action text NOT NULL,
    information_request_refs jsonb NOT NULL,
    review_disposition text,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    PRIMARY KEY (version_id, finding_id),
    CONSTRAINT gap_finding_scope_unique
        UNIQUE (enterprise_id, project_id, version_id, finding_id),
    CONSTRAINT gap_finding_key_unique
        UNIQUE (version_id, subject_key),
    CONSTRAINT gap_finding_key_nonempty CHECK (
        length(subject_key) > 0 AND length(subject_type) > 0),
    CONSTRAINT gap_finding_status_closed CHECK (
        gap_status IN ('MATCH', 'MINOR_GAP', 'MAJOR_GAP', 'MISSING',
                       'EXTRA', 'UNKNOWN', 'NOT_APPLICABLE')),
    CONSTRAINT gap_finding_severity_closed CHECK (
        severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    CONSTRAINT gap_finding_action_closed CHECK (
        recommended_action IN ('KEEP', 'REVISE', 'REPLACE', 'CREATE', 'REMOVE',
                               'NEED_INFORMATION', 'HUMAN_REVIEW')),
    CONSTRAINT gap_finding_json_shape CHECK (
        jsonb_typeof(customer_baseline_item_refs) = 'array'
        AND jsonb_typeof(template_refs) = 'array'
        AND jsonb_typeof(regulatory_item_refs) = 'array'
        AND jsonb_typeof(rationale) = 'object'
        AND jsonb_typeof(evidence_refs) = 'array'
        AND jsonb_typeof(information_request_refs) = 'array'),
    CONSTRAINT gap_finding_hash_len CHECK (octet_length(payload_hash) = 32)
);

ALTER TABLE enterprise_project.gap_finding
    ADD CONSTRAINT gap_finding_version_fk
    FOREIGN KEY (enterprise_id, project_id, gap_analysis_id, version_id)
    REFERENCES enterprise_project.gap_analysis_version
        (enterprise_id, project_id, gap_analysis_id, version_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX gap_finding_project_idx
    ON enterprise_project.gap_finding (enterprise_id, project_id, version_id);

-- ---------------------------------------------------------------------------
-- Human decision history.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.gap_analysis_decision (
    decision_id uuid PRIMARY KEY,
    gap_analysis_id uuid NOT NULL,
    version_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    review_snapshot_ref jsonb NOT NULL,
    disposition text NOT NULL,
    justification jsonb NOT NULL,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    decided_by_principal_id uuid NOT NULL,
    decided_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT gap_analysis_decision_scope_unique
        UNIQUE (enterprise_id, project_id, decision_id),
    CONSTRAINT gap_analysis_decision_disposition_closed CHECK (
        disposition IN ('ACCEPT', 'REJECT', 'CHANGES_REQUIRED')),
    CONSTRAINT gap_analysis_decision_review_object CHECK (
        jsonb_typeof(review_snapshot_ref) = 'object'),
    CONSTRAINT gap_analysis_decision_justification_object CHECK (
        jsonb_typeof(justification) = 'object'),
    CONSTRAINT gap_analysis_decision_payload_object CHECK (
        jsonb_typeof(payload) = 'object'),
    CONSTRAINT gap_analysis_decision_hash_len CHECK (octet_length(payload_hash) = 32)
);

ALTER TABLE enterprise_project.gap_analysis_decision
    ADD CONSTRAINT gap_analysis_decision_version_fk
    FOREIGN KEY (enterprise_id, project_id, gap_analysis_id, version_id)
    REFERENCES enterprise_project.gap_analysis_version
        (enterprise_id, project_id, gap_analysis_id, version_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX gap_analysis_decision_project_idx
    ON enterprise_project.gap_analysis_decision
        (enterprise_id, project_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Root pointer, version transition and immutable-history guards.
-- ---------------------------------------------------------------------------

CREATE FUNCTION enterprise_project.guard_gap_analysis_root() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.gap_analysis_id IS DISTINCT FROM OLD.gap_analysis_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.current_version_id IS DISTINCT FROM OLD.current_version_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.retention_class IS DISTINCT FROM OLD.retention_class THEN
        RAISE EXCEPTION 'gap_analysis identity and ownership are immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
        RAISE EXCEPTION 'gap_analysis aggregate_version must advance by one'
            USING ERRCODE = '23514';
    END IF;
    IF (NEW.status = 'ACCEPTED') <> (NEW.accepted_version_id IS NOT NULL) THEN
        RAISE EXCEPTION 'gap_analysis accepted pointer must match ACCEPTED status'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_gap_analysis_root() FROM PUBLIC;
CREATE TRIGGER gap_analysis_root_guard
    BEFORE UPDATE ON enterprise_project.gap_analysis
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_gap_analysis_root();

CREATE FUNCTION enterprise_project.guard_gap_analysis_version_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.version_id IS DISTINCT FROM OLD.version_id
       OR NEW.gap_analysis_id IS DISTINCT FROM OLD.gap_analysis_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.mode IS DISTINCT FROM OLD.mode
       OR NEW.input_snapshot_id IS DISTINCT FROM OLD.input_snapshot_id
       OR NEW.requested_scope IS DISTINCT FROM OLD.requested_scope
       OR NEW.findings_summary IS DISTINCT FROM OLD.findings_summary
       OR NEW.payload IS DISTINCT FROM OLD.payload
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
       OR NEW.canonicalization_version IS DISTINCT FROM OLD.canonicalization_version
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.authorization_decision_id IS DISTINCT FROM OLD.authorization_decision_id
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
       OR NEW.source_command_id IS DISTINCT FROM OLD.source_command_id THEN
        RAISE EXCEPTION 'gap_analysis_version content is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.version_status IS DISTINCT FROM OLD.version_status
       AND NOT (
           (OLD.version_status IN ('COMPLETED', 'UNDER_REVIEW')
            AND NEW.version_status IN ('ACCEPTED', 'CHANGES_REQUIRED', 'REJECTED'))
           OR (NEW.version_status = 'STALE'
               AND OLD.version_status <> 'STALE')) THEN
        RAISE EXCEPTION 'gap_analysis_version status transition is not allowed'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.version_status = 'STALE' AND OLD.version_status = 'STALE'
       AND (NEW.stale_reason IS DISTINCT FROM OLD.stale_reason
            OR NEW.stale_at IS DISTINCT FROM OLD.stale_at) THEN
        RAISE EXCEPTION 'gap_analysis_version stale fact is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.version_status <> 'STALE'
       AND (NEW.stale_reason IS DISTINCT FROM OLD.stale_reason
            OR NEW.stale_at IS DISTINCT FROM OLD.stale_at) THEN
        RAISE EXCEPTION 'gap_analysis_version stale metadata requires STALE transition'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_gap_analysis_version_immutable() FROM PUBLIC;
CREATE TRIGGER gap_analysis_version_immutable_guard
    BEFORE UPDATE ON enterprise_project.gap_analysis_version
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_gap_analysis_version_immutable();

CREATE FUNCTION enterprise_project.guard_gap_analysis_input_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'gap_analysis_input_snapshot history is immutable'
        USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_gap_analysis_input_immutable() FROM PUBLIC;
CREATE TRIGGER gap_analysis_input_immutable_guard
    BEFORE UPDATE ON enterprise_project.gap_analysis_input_snapshot
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_gap_analysis_input_immutable();

CREATE FUNCTION enterprise_project.guard_gap_finding_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'gap_finding history is immutable' USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_gap_finding_immutable() FROM PUBLIC;
CREATE TRIGGER gap_finding_immutable_guard
    BEFORE UPDATE ON enterprise_project.gap_finding
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_gap_finding_immutable();

CREATE FUNCTION enterprise_project.guard_gap_analysis_decision_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'gap_analysis_decision history is immutable'
        USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_gap_analysis_decision_immutable() FROM PUBLIC;
CREATE TRIGGER gap_analysis_decision_immutable_guard
    BEFORE UPDATE ON enterprise_project.gap_analysis_decision
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_gap_analysis_decision_immutable();

CREATE FUNCTION enterprise_project.guard_gap_analysis_pointer() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM enterprise_project.gap_analysis_version version_row
         WHERE version_row.enterprise_id = NEW.enterprise_id
           AND version_row.project_id = NEW.project_id
           AND version_row.gap_analysis_id = NEW.gap_analysis_id
           AND version_row.version_id = NEW.current_version_id
           AND version_row.version_status = NEW.status) THEN
        RAISE EXCEPTION 'gap_analysis current pointer must resolve to the root status'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.accepted_version_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM enterprise_project.gap_analysis_version version_row
            WHERE version_row.enterprise_id = NEW.enterprise_id
              AND version_row.project_id = NEW.project_id
              AND version_row.gap_analysis_id = NEW.gap_analysis_id
              AND version_row.version_id = NEW.accepted_version_id
              AND version_row.version_status = 'ACCEPTED') THEN
        RAISE EXCEPTION 'gap_analysis accepted pointer must resolve to ACCEPTED version'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_gap_analysis_pointer() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER gap_analysis_pointer_guard
    AFTER INSERT OR UPDATE ON enterprise_project.gap_analysis
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_gap_analysis_pointer();

ALTER TABLE enterprise_project.gap_analysis
    ADD CONSTRAINT gap_analysis_current_version_fk
    FOREIGN KEY (enterprise_id, project_id, gap_analysis_id, current_version_id)
    REFERENCES enterprise_project.gap_analysis_version
        (enterprise_id, project_id, gap_analysis_id, version_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.gap_analysis
    ADD CONSTRAINT gap_analysis_accepted_version_fk
    FOREIGN KEY (enterprise_id, project_id, gap_analysis_id, accepted_version_id)
    REFERENCES enterprise_project.gap_analysis_version
        (enterprise_id, project_id, gap_analysis_id, version_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- App-role grants and Project RLS.
-- ---------------------------------------------------------------------------

REVOKE UPDATE, DELETE ON enterprise_project.gap_analysis_input_snapshot
    FROM enterprise_project_app;
REVOKE UPDATE, DELETE ON enterprise_project.gap_finding
    FROM enterprise_project_app;
REVOKE UPDATE, DELETE ON enterprise_project.gap_analysis_decision
    FROM enterprise_project_app;
REVOKE UPDATE, DELETE ON enterprise_project.gap_analysis_version
    FROM enterprise_project_app;
GRANT UPDATE (version_status, stale_reason, stale_at)
    ON enterprise_project.gap_analysis_version TO enterprise_project_app;
REVOKE UPDATE, DELETE ON enterprise_project.gap_analysis
    FROM enterprise_project_app;
GRANT UPDATE (status, accepted_version_id, aggregate_version, updated_at, last_command_id)
    ON enterprise_project.gap_analysis TO enterprise_project_app;

ALTER TABLE enterprise_project.gap_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.gap_analysis FORCE ROW LEVEL SECURITY;
CREATE POLICY gap_analysis_select ON enterprise_project.gap_analysis
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY gap_analysis_insert ON enterprise_project.gap_analysis
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        created_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY gap_analysis_update ON enterprise_project.gap_analysis
    FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.gap_analysis_input_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.gap_analysis_input_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY gap_analysis_input_select ON enterprise_project.gap_analysis_input_snapshot
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY gap_analysis_input_insert ON enterprise_project.gap_analysis_input_snapshot
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        recorded_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.gap_analysis_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.gap_analysis_version FORCE ROW LEVEL SECURITY;
CREATE POLICY gap_analysis_version_select ON enterprise_project.gap_analysis_version
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY gap_analysis_version_insert ON enterprise_project.gap_analysis_version
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        created_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY gap_analysis_version_update ON enterprise_project.gap_analysis_version
    FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.gap_finding ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.gap_finding FORCE ROW LEVEL SECURITY;
CREATE POLICY gap_finding_select ON enterprise_project.gap_finding
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY gap_finding_insert ON enterprise_project.gap_finding
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        recorded_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.gap_analysis_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.gap_analysis_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY gap_analysis_decision_select ON enterprise_project.gap_analysis_decision
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY gap_analysis_decision_insert ON enterprise_project.gap_analysis_decision
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        decided_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

RESET ROLE;
