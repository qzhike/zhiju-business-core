-- IM-03 WI-10 (issue #66): Project-owned DeliveryPlan/DeliveryItem facts,
-- immutable criteria and dependency requirements, and Human approval history.
--
-- A draft may be created by an Agent, but only a trusted Human can create an
-- APPROVE decision. Activation consumes that exact Human decision. The
-- database protects scope, immutable history, root CAS/pointers and the
-- single-active-plan invariant; the application validates typed references and
-- the dependency graph before these rows are written.

SET ROLE enterprise_project_owner;

-- ---------------------------------------------------------------------------
-- Plan root and immutable version.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.delivery_plan (
    delivery_plan_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    current_version_id uuid NOT NULL,
    approved_version_id uuid,
    active_version_id uuid,
    status text NOT NULL,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT delivery_plan_scope_unique
        UNIQUE (enterprise_id, project_id, delivery_plan_id),
    CONSTRAINT delivery_plan_status_closed CHECK (
        status IN ('DRAFT', 'APPROVED', 'CHANGES_REQUIRED', 'REJECTED',
                   'ACTIVE', 'SUPERSEDED')),
    CONSTRAINT delivery_plan_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT delivery_plan_retention_nonempty CHECK (length(retention_class) > 0),
    CONSTRAINT delivery_plan_approved_shape CHECK (
        (status IN ('APPROVED', 'ACTIVE') AND approved_version_id IS NOT NULL)
        OR (status NOT IN ('APPROVED', 'ACTIVE') AND approved_version_id IS NULL)),
    CONSTRAINT delivery_plan_active_shape CHECK (
        (status = 'ACTIVE' AND active_version_id IS NOT NULL)
        OR (status <> 'ACTIVE' AND active_version_id IS NULL))
);

ALTER TABLE enterprise_project.delivery_plan
    ADD CONSTRAINT delivery_plan_project_fk
    FOREIGN KEY (enterprise_id, project_id)
    REFERENCES enterprise_project.project (enterprise_id, project_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX delivery_plan_project_idx
    ON enterprise_project.delivery_plan (enterprise_id, project_id, updated_at DESC);

CREATE UNIQUE INDEX delivery_plan_one_active_project_idx
    ON enterprise_project.delivery_plan (enterprise_id, project_id)
    WHERE active_version_id IS NOT NULL;

CREATE TABLE enterprise_project.delivery_plan_version (
    version_id uuid PRIMARY KEY,
    delivery_plan_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    version_no integer NOT NULL,
    version_status text NOT NULL DEFAULT 'DRAFT',
    accepted_gap_analysis_ref jsonb NOT NULL,
    accepted_gap_analysis_id uuid NOT NULL,
    accepted_gap_analysis_version_id uuid NOT NULL,
    baseline_refs jsonb NOT NULL,
    assumptions jsonb NOT NULL,
    exclusions jsonb NOT NULL,
    plan_quality_policy_ref jsonb NOT NULL,
    plan_quality_policy_id uuid NOT NULL,
    plan_quality_policy_version_id uuid NOT NULL,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    approval_decision_id uuid,
    approved_by_principal_id uuid,
    approved_by_actor_snapshot_id uuid,
    approved_at timestamptz,
    activated_at timestamptz,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT delivery_plan_version_scope_unique
        UNIQUE (enterprise_id, project_id, delivery_plan_id, version_id),
    CONSTRAINT delivery_plan_version_no_unique
        UNIQUE (delivery_plan_id, version_no),
    CONSTRAINT delivery_plan_version_no_positive CHECK (version_no >= 1),
    CONSTRAINT delivery_plan_version_status_closed CHECK (
        version_status IN ('DRAFT', 'APPROVED', 'CHANGES_REQUIRED', 'REJECTED',
                           'ACTIVE', 'SUPERSEDED')),
    CONSTRAINT delivery_plan_version_refs_object CHECK (
        jsonb_typeof(accepted_gap_analysis_ref) = 'object'
        AND jsonb_typeof(baseline_refs) = 'array'
        AND jsonb_typeof(assumptions) = 'array'
        AND jsonb_typeof(exclusions) = 'array'
        AND jsonb_typeof(plan_quality_policy_ref) = 'object'
        AND jsonb_typeof(payload) = 'object'),
    CONSTRAINT delivery_plan_version_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT delivery_plan_version_approval_shape CHECK (
        (version_status IN ('APPROVED', 'ACTIVE', 'SUPERSEDED')
         AND approval_decision_id IS NOT NULL
         AND approved_by_principal_id IS NOT NULL
         AND approved_by_actor_snapshot_id IS NOT NULL
         AND approved_at IS NOT NULL)
        OR
        (version_status IN ('DRAFT', 'CHANGES_REQUIRED', 'REJECTED')
         AND approval_decision_id IS NULL
         AND approved_by_principal_id IS NULL
         AND approved_by_actor_snapshot_id IS NULL
         AND approved_at IS NULL)),
    CONSTRAINT delivery_plan_version_activation_shape CHECK (
        (version_status IN ('ACTIVE', 'SUPERSEDED') AND activated_at IS NOT NULL)
        OR (version_status IN ('DRAFT', 'APPROVED', 'CHANGES_REQUIRED', 'REJECTED')
            AND activated_at IS NULL))
);

ALTER TABLE enterprise_project.delivery_plan_version
    ADD CONSTRAINT delivery_plan_version_root_fk
    FOREIGN KEY (enterprise_id, project_id, delivery_plan_id)
    REFERENCES enterprise_project.delivery_plan
        (enterprise_id, project_id, delivery_plan_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.delivery_plan_version
    ADD CONSTRAINT delivery_plan_version_gap_fk
    FOREIGN KEY (enterprise_id, project_id, accepted_gap_analysis_id,
                 accepted_gap_analysis_version_id)
    REFERENCES enterprise_project.gap_analysis_version
        (enterprise_id, project_id, gap_analysis_id, version_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX delivery_plan_version_root_idx
    ON enterprise_project.delivery_plan_version
        (enterprise_id, project_id, delivery_plan_id, version_no DESC);

-- ---------------------------------------------------------------------------
-- Items, artifact requirements and dependency graph facts.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.delivery_item (
    delivery_item_id uuid NOT NULL,
    delivery_plan_id uuid NOT NULL,
    version_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    item_key text NOT NULL,
    item_type text NOT NULL,
    title text NOT NULL,
    objective text NOT NULL,
    source_gap_item_refs jsonb NOT NULL,
    dependency_item_ids jsonb NOT NULL,
    target_artifact_types jsonb NOT NULL,
    quality_profile_ref jsonb NOT NULL,
    quality_profile_id uuid NOT NULL,
    quality_profile_version_id uuid NOT NULL,
    completion_criteria jsonb NOT NULL,
    due_constraint jsonb,
    commitment_status text NOT NULL DEFAULT 'PROPOSED',
    execution_status text NOT NULL DEFAULT 'NOT_READY',
    criteria_hash bytea NOT NULL,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    PRIMARY KEY (version_id, delivery_item_id),
    CONSTRAINT delivery_item_scope_unique
        UNIQUE (enterprise_id, project_id, version_id, delivery_item_id),
    CONSTRAINT delivery_item_key_unique UNIQUE (version_id, item_key),
    CONSTRAINT delivery_item_text_nonempty CHECK (
        length(item_key) > 0 AND length(item_type) > 0
        AND length(title) > 0 AND length(objective) > 0),
    CONSTRAINT delivery_item_refs_shape CHECK (
        jsonb_typeof(source_gap_item_refs) = 'array'
        AND jsonb_array_length(source_gap_item_refs) > 0
        AND jsonb_typeof(dependency_item_ids) = 'array'
        AND jsonb_typeof(target_artifact_types) = 'array'
        AND jsonb_array_length(target_artifact_types) > 0
        AND jsonb_typeof(quality_profile_ref) = 'object'
        AND jsonb_typeof(completion_criteria) IN ('object', 'array', 'string', 'number', 'boolean', 'null')
        AND (due_constraint IS NULL OR jsonb_typeof(due_constraint) IN
             ('object', 'array', 'string', 'number', 'boolean', 'null'))
        AND jsonb_typeof(payload) = 'object'),
    CONSTRAINT delivery_item_commitment_closed CHECK (
        commitment_status IN ('PROPOSED', 'APPROVED', 'CANCELLED', 'REPLACED')),
    CONSTRAINT delivery_item_execution_closed CHECK (
        execution_status IN ('NOT_READY', 'READY', 'IN_PROGRESS', 'BLOCKED',
                             'IN_REVIEW', 'APPROVED_OUTPUT', 'RELEASED', 'COMPLETED')),
    CONSTRAINT delivery_item_initial_commitment CHECK (commitment_status = 'PROPOSED'),
    CONSTRAINT delivery_item_criteria_hash_len CHECK (octet_length(criteria_hash) = 32),
    CONSTRAINT delivery_item_payload_hash_len CHECK (octet_length(payload_hash) = 32)
);

ALTER TABLE enterprise_project.delivery_item
    ADD CONSTRAINT delivery_item_version_fk
    FOREIGN KEY (enterprise_id, project_id, delivery_plan_id, version_id)
    REFERENCES enterprise_project.delivery_plan_version
        (enterprise_id, project_id, delivery_plan_id, version_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX delivery_item_project_idx
    ON enterprise_project.delivery_item (enterprise_id, project_id, version_id, item_key);

CREATE TABLE enterprise_project.delivery_item_artifact_requirement (
    requirement_id uuid PRIMARY KEY,
    delivery_plan_id uuid NOT NULL,
    version_id uuid NOT NULL,
    delivery_item_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    artifact_type text NOT NULL,
    purpose text NOT NULL,
    required_cardinality text NOT NULL DEFAULT 'REQUIRED',
    acceptance_criteria jsonb NOT NULL,
    release_criteria jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT delivery_item_requirement_unique
        UNIQUE (version_id, delivery_item_id, artifact_type),
    CONSTRAINT delivery_item_requirement_text_nonempty CHECK (
        length(artifact_type) > 0 AND length(purpose) > 0),
    CONSTRAINT delivery_item_requirement_cardinality CHECK (
        required_cardinality = 'REQUIRED'),
    CONSTRAINT delivery_item_requirement_json_shape CHECK (
        jsonb_typeof(acceptance_criteria) IN
            ('object', 'array', 'string', 'number', 'boolean', 'null')
        AND jsonb_typeof(release_criteria) IN
            ('object', 'array', 'string', 'number', 'boolean', 'null')),
    CONSTRAINT delivery_item_requirement_hash_len CHECK (octet_length(payload_hash) = 32)
);

ALTER TABLE enterprise_project.delivery_item_artifact_requirement
    ADD CONSTRAINT delivery_item_requirement_item_fk
    FOREIGN KEY (enterprise_id, project_id, version_id, delivery_item_id)
    REFERENCES enterprise_project.delivery_item
        (enterprise_id, project_id, version_id, delivery_item_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE enterprise_project.delivery_item_dependency (
    delivery_plan_id uuid NOT NULL,
    version_id uuid NOT NULL,
    from_item_id uuid NOT NULL,
    to_item_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    dependency_type text NOT NULL DEFAULT 'BLOCKS',
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    PRIMARY KEY (version_id, from_item_id, to_item_id),
    CONSTRAINT delivery_item_dependency_not_self CHECK (from_item_id <> to_item_id),
    CONSTRAINT delivery_item_dependency_type_closed CHECK (dependency_type = 'BLOCKS'),
    CONSTRAINT delivery_item_dependency_hash_len CHECK (octet_length(payload_hash) = 32)
);

ALTER TABLE enterprise_project.delivery_item_dependency
    ADD CONSTRAINT delivery_item_dependency_from_fk
    FOREIGN KEY (enterprise_id, project_id, version_id, from_item_id)
    REFERENCES enterprise_project.delivery_item
        (enterprise_id, project_id, version_id, delivery_item_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE enterprise_project.delivery_item_dependency
    ADD CONSTRAINT delivery_item_dependency_to_fk
    FOREIGN KEY (enterprise_id, project_id, version_id, to_item_id)
    REFERENCES enterprise_project.delivery_item
        (enterprise_id, project_id, version_id, delivery_item_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX delivery_item_dependency_project_idx
    ON enterprise_project.delivery_item_dependency
        (enterprise_id, project_id, version_id);

-- ---------------------------------------------------------------------------
-- Immutable Human decision history.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.delivery_plan_decision (
    decision_id uuid PRIMARY KEY,
    delivery_plan_id uuid NOT NULL,
    version_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    review_snapshot_ref jsonb NOT NULL,
    decision text NOT NULL,
    justification jsonb NOT NULL,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    decided_by_principal_id uuid NOT NULL,
    decided_by_principal_kind text NOT NULL DEFAULT 'HUMAN',
    decided_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT delivery_plan_decision_scope_unique
        UNIQUE (enterprise_id, project_id, decision_id),
    CONSTRAINT delivery_plan_decision_version_unique
        UNIQUE (enterprise_id, project_id, delivery_plan_id, version_id, decision_id),
    CONSTRAINT delivery_plan_decision_closed CHECK (
        decision IN ('APPROVE', 'CHANGES_REQUIRED', 'REJECT')),
    CONSTRAINT delivery_plan_decision_human_only CHECK (
        decided_by_principal_kind = 'HUMAN'),
    CONSTRAINT delivery_plan_decision_refs_shape CHECK (
        jsonb_typeof(review_snapshot_ref) = 'object'
        AND jsonb_typeof(justification) = 'object'
        AND jsonb_typeof(payload) = 'object'),
    CONSTRAINT delivery_plan_decision_hash_len CHECK (octet_length(payload_hash) = 32)
);

ALTER TABLE enterprise_project.delivery_plan_decision
    ADD CONSTRAINT delivery_plan_decision_version_fk
    FOREIGN KEY (enterprise_id, project_id, delivery_plan_id, version_id)
    REFERENCES enterprise_project.delivery_plan_version
        (enterprise_id, project_id, delivery_plan_id, version_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.delivery_plan_version
    ADD CONSTRAINT delivery_plan_version_decision_fk
    FOREIGN KEY (enterprise_id, project_id, delivery_plan_id, version_id,
                 approval_decision_id)
    REFERENCES enterprise_project.delivery_plan_decision
        (enterprise_id, project_id, delivery_plan_id, version_id, decision_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX delivery_plan_decision_project_idx
    ON enterprise_project.delivery_plan_decision
        (enterprise_id, project_id, delivery_plan_id, recorded_at DESC);

-- Root pointers are deferred until the version and decision facts exist.
ALTER TABLE enterprise_project.delivery_plan
    ADD CONSTRAINT delivery_plan_current_version_fk
    FOREIGN KEY (enterprise_id, project_id, delivery_plan_id, current_version_id)
    REFERENCES enterprise_project.delivery_plan_version
        (enterprise_id, project_id, delivery_plan_id, version_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE enterprise_project.delivery_plan
    ADD CONSTRAINT delivery_plan_approved_version_fk
    FOREIGN KEY (enterprise_id, project_id, delivery_plan_id, approved_version_id)
    REFERENCES enterprise_project.delivery_plan_version
        (enterprise_id, project_id, delivery_plan_id, version_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE enterprise_project.delivery_plan
    ADD CONSTRAINT delivery_plan_active_version_fk
    FOREIGN KEY (enterprise_id, project_id, delivery_plan_id, active_version_id)
    REFERENCES enterprise_project.delivery_plan_version
        (enterprise_id, project_id, delivery_plan_id, version_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- Immutable and pointer guards.
-- ---------------------------------------------------------------------------

CREATE FUNCTION enterprise_project.guard_delivery_payload_scope_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.payload->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.payload->>'projectId' IS DISTINCT FROM NEW.project_id::text THEN
        RAISE EXCEPTION 'delivery payload scope mirror mismatch'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_delivery_payload_scope_mirror() FROM PUBLIC;

CREATE TRIGGER delivery_plan_version_payload_scope_guard
    BEFORE INSERT OR UPDATE ON enterprise_project.delivery_plan_version
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_delivery_payload_scope_mirror();
CREATE TRIGGER delivery_item_payload_scope_guard
    BEFORE INSERT OR UPDATE ON enterprise_project.delivery_item
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_delivery_payload_scope_mirror();
CREATE TRIGGER delivery_plan_decision_payload_scope_guard
    BEFORE INSERT OR UPDATE ON enterprise_project.delivery_plan_decision
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_delivery_payload_scope_mirror();

CREATE FUNCTION enterprise_project.guard_delivery_plan_root() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.delivery_plan_id IS DISTINCT FROM OLD.delivery_plan_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.current_version_id IS DISTINCT FROM OLD.current_version_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.retention_class IS DISTINCT FROM OLD.retention_class THEN
        RAISE EXCEPTION 'delivery_plan identity and ownership are immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
        RAISE EXCEPTION 'delivery_plan aggregate_version must advance by one'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_delivery_plan_root() FROM PUBLIC;
CREATE TRIGGER delivery_plan_root_guard
    BEFORE UPDATE ON enterprise_project.delivery_plan
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_delivery_plan_root();

CREATE FUNCTION enterprise_project.guard_delivery_plan_version_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.version_id IS DISTINCT FROM OLD.version_id
       OR NEW.delivery_plan_id IS DISTINCT FROM OLD.delivery_plan_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.accepted_gap_analysis_ref IS DISTINCT FROM OLD.accepted_gap_analysis_ref
       OR NEW.accepted_gap_analysis_id IS DISTINCT FROM OLD.accepted_gap_analysis_id
       OR NEW.accepted_gap_analysis_version_id IS DISTINCT FROM OLD.accepted_gap_analysis_version_id
       OR NEW.baseline_refs IS DISTINCT FROM OLD.baseline_refs
       OR NEW.assumptions IS DISTINCT FROM OLD.assumptions
       OR NEW.exclusions IS DISTINCT FROM OLD.exclusions
       OR NEW.plan_quality_policy_ref IS DISTINCT FROM OLD.plan_quality_policy_ref
       OR NEW.plan_quality_policy_id IS DISTINCT FROM OLD.plan_quality_policy_id
       OR NEW.plan_quality_policy_version_id IS DISTINCT FROM OLD.plan_quality_policy_version_id
       OR NEW.payload IS DISTINCT FROM OLD.payload
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
       OR NEW.canonicalization_version IS DISTINCT FROM OLD.canonicalization_version
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.authorization_decision_id IS DISTINCT FROM OLD.authorization_decision_id
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
       OR NEW.source_command_id IS DISTINCT FROM OLD.source_command_id THEN
        RAISE EXCEPTION 'delivery_plan_version content is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.version_status IS DISTINCT FROM OLD.version_status
       AND NOT (
           (OLD.version_status = 'DRAFT'
            AND NEW.version_status IN ('APPROVED', 'CHANGES_REQUIRED', 'REJECTED'))
           OR (OLD.version_status = 'APPROVED' AND NEW.version_status = 'ACTIVE')
           OR (OLD.version_status = 'ACTIVE' AND NEW.version_status = 'SUPERSEDED')) THEN
        RAISE EXCEPTION 'delivery_plan_version status transition is not allowed'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.approval_decision_id IS NOT NULL
       AND NEW.approval_decision_id IS DISTINCT FROM OLD.approval_decision_id THEN
        RAISE EXCEPTION 'delivery_plan_version approval decision is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.approved_by_principal_id IS NOT NULL
       AND (NEW.approved_by_principal_id IS DISTINCT FROM OLD.approved_by_principal_id
            OR NEW.approved_by_actor_snapshot_id IS DISTINCT FROM OLD.approved_by_actor_snapshot_id
            OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
        RAISE EXCEPTION 'delivery_plan_version approval actor is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.activated_at IS NOT NULL
       AND NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
        RAISE EXCEPTION 'delivery_plan_version activation time is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_delivery_plan_version_immutable() FROM PUBLIC;
CREATE TRIGGER delivery_plan_version_immutable_guard
    BEFORE UPDATE ON enterprise_project.delivery_plan_version
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_delivery_plan_version_immutable();

CREATE FUNCTION enterprise_project.guard_delivery_item_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'delivery_item history is immutable' USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_delivery_item_immutable() FROM PUBLIC;
CREATE TRIGGER delivery_item_immutable_guard
    BEFORE UPDATE ON enterprise_project.delivery_item
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_delivery_item_immutable();

CREATE FUNCTION enterprise_project.guard_delivery_item_requirement_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'delivery_item_artifact_requirement history is immutable'
        USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_delivery_item_requirement_immutable() FROM PUBLIC;
CREATE TRIGGER delivery_item_requirement_immutable_guard
    BEFORE UPDATE ON enterprise_project.delivery_item_artifact_requirement
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_delivery_item_requirement_immutable();

CREATE FUNCTION enterprise_project.guard_delivery_item_dependency_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'delivery_item_dependency history is immutable' USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_delivery_item_dependency_immutable() FROM PUBLIC;
CREATE TRIGGER delivery_item_dependency_immutable_guard
    BEFORE UPDATE ON enterprise_project.delivery_item_dependency
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_delivery_item_dependency_immutable();

CREATE FUNCTION enterprise_project.guard_delivery_plan_decision_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'delivery_plan_decision history is immutable' USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_delivery_plan_decision_immutable() FROM PUBLIC;
CREATE TRIGGER delivery_plan_decision_immutable_guard
    BEFORE UPDATE ON enterprise_project.delivery_plan_decision
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_delivery_plan_decision_immutable();

CREATE FUNCTION enterprise_project.guard_delivery_plan_pointer() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM enterprise_project.delivery_plan_version version_row
         WHERE version_row.enterprise_id = NEW.enterprise_id
           AND version_row.project_id = NEW.project_id
           AND version_row.delivery_plan_id = NEW.delivery_plan_id
           AND version_row.version_id = NEW.current_version_id
           AND version_row.version_status = NEW.status) THEN
        RAISE EXCEPTION 'delivery_plan current pointer must resolve to root status'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.approved_version_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM enterprise_project.delivery_plan_version version_row
            WHERE version_row.enterprise_id = NEW.enterprise_id
              AND version_row.project_id = NEW.project_id
              AND version_row.delivery_plan_id = NEW.delivery_plan_id
              AND version_row.version_id = NEW.approved_version_id
              AND version_row.version_status IN ('APPROVED', 'ACTIVE')) THEN
        RAISE EXCEPTION 'delivery_plan approved pointer must resolve to approved version'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.active_version_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM enterprise_project.delivery_plan_version version_row
            WHERE version_row.enterprise_id = NEW.enterprise_id
              AND version_row.project_id = NEW.project_id
              AND version_row.delivery_plan_id = NEW.delivery_plan_id
              AND version_row.version_id = NEW.active_version_id
              AND version_row.version_status = 'ACTIVE') THEN
        RAISE EXCEPTION 'delivery_plan active pointer must resolve to ACTIVE version'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_delivery_plan_pointer() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER delivery_plan_pointer_guard
    AFTER INSERT OR UPDATE ON enterprise_project.delivery_plan
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_delivery_plan_pointer();

-- ---------------------------------------------------------------------------
-- Application grants and Project RLS.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON enterprise_project.delivery_plan
    TO enterprise_project_app;
GRANT UPDATE (status, approved_version_id, active_version_id,
              aggregate_version, updated_at, last_command_id)
    ON enterprise_project.delivery_plan TO enterprise_project_app;
GRANT SELECT, INSERT, UPDATE ON enterprise_project.delivery_plan_version
    TO enterprise_project_app;
GRANT UPDATE (version_status, approval_decision_id, approved_by_principal_id,
              approved_by_actor_snapshot_id, approved_at, activated_at)
    ON enterprise_project.delivery_plan_version TO enterprise_project_app;
GRANT SELECT, INSERT ON
    enterprise_project.delivery_item,
    enterprise_project.delivery_item_artifact_requirement,
    enterprise_project.delivery_item_dependency,
    enterprise_project.delivery_plan_decision
    TO enterprise_project_app;
REVOKE DELETE ON
    enterprise_project.delivery_plan,
    enterprise_project.delivery_plan_version,
    enterprise_project.delivery_item,
    enterprise_project.delivery_item_artifact_requirement,
    enterprise_project.delivery_item_dependency,
    enterprise_project.delivery_plan_decision
    FROM enterprise_project_app;
REVOKE UPDATE ON
    enterprise_project.delivery_item,
    enterprise_project.delivery_item_artifact_requirement,
    enterprise_project.delivery_item_dependency,
    enterprise_project.delivery_plan_decision
    FROM enterprise_project_app;

ALTER TABLE enterprise_project.delivery_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.delivery_plan FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_plan_select ON enterprise_project.delivery_plan
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY delivery_plan_insert ON enterprise_project.delivery_plan
    FOR INSERT TO enterprise_project_app
    WITH CHECK (created_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY delivery_plan_update ON enterprise_project.delivery_plan
    FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.delivery_plan_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.delivery_plan_version FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_plan_version_select ON enterprise_project.delivery_plan_version
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY delivery_plan_version_insert ON enterprise_project.delivery_plan_version
    FOR INSERT TO enterprise_project_app
    WITH CHECK (created_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY delivery_plan_version_update ON enterprise_project.delivery_plan_version
    FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.delivery_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.delivery_item FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_item_select ON enterprise_project.delivery_item
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY delivery_item_insert ON enterprise_project.delivery_item
    FOR INSERT TO enterprise_project_app
    WITH CHECK (recorded_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.delivery_item_artifact_requirement ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.delivery_item_artifact_requirement FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_item_requirement_select
    ON enterprise_project.delivery_item_artifact_requirement
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY delivery_item_requirement_insert
    ON enterprise_project.delivery_item_artifact_requirement
    FOR INSERT TO enterprise_project_app
    WITH CHECK (recorded_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.delivery_item_dependency ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.delivery_item_dependency FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_item_dependency_select
    ON enterprise_project.delivery_item_dependency
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY delivery_item_dependency_insert
    ON enterprise_project.delivery_item_dependency
    FOR INSERT TO enterprise_project_app
    WITH CHECK (recorded_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.delivery_plan_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.delivery_plan_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_plan_decision_select ON enterprise_project.delivery_plan_decision
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY delivery_plan_decision_insert ON enterprise_project.delivery_plan_decision
    FOR INSERT TO enterprise_project_app
    WITH CHECK (decided_by_principal_id = platform_security.context_principal_id()
        AND decided_by_principal_kind = 'HUMAN'
        AND platform_security.context_allows_project(enterprise_id, project_id));

RESET ROLE;
