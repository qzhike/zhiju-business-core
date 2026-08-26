-- IM-03 WI-07 (issue #63): Project-owned CustomerBaseline drafts,
-- immutable versions/items and append-only impact review facts.
--
-- The public v1.0 Contract keeps the closed field/reference shapes. This
-- migration owns the cross-field epistemic invariant, Project scope, the
-- single active pointer and the immutable historical boundary.

SET ROLE enterprise_project_owner;

-- ---------------------------------------------------------------------------
-- customer_baseline: one identity and one mutable pointer per Project.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.customer_baseline (
    customer_baseline_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    current_version_id uuid NOT NULL,
    active_version_id uuid,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT customer_baseline_scope_unique
        UNIQUE (enterprise_id, project_id, customer_baseline_id),
    CONSTRAINT customer_baseline_project_unique
        UNIQUE (enterprise_id, project_id),
    CONSTRAINT customer_baseline_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT customer_baseline_retention_nonempty CHECK (length(retention_class) > 0)
);

ALTER TABLE enterprise_project.customer_baseline
    ADD CONSTRAINT customer_baseline_project_fk
    FOREIGN KEY (enterprise_id, project_id)
    REFERENCES enterprise_project.project (enterprise_id, project_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX customer_baseline_project_idx
    ON enterprise_project.customer_baseline (enterprise_id, project_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- customer_baseline_version: immutable content and a controlled confirmation
-- transition. Draft creation and Human activation use the same Root CAS.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.customer_baseline_version (
    version_id uuid PRIMARY KEY,
    customer_baseline_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    version_no integer NOT NULL,
    version_status text NOT NULL DEFAULT 'DRAFT',
    previous_version_id uuid,
    baseline_policy_ref jsonb NOT NULL,
    expectations_payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    proposed_by_principal_id uuid NOT NULL,
    proposed_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    confirmed_by_principal_id uuid,
    confirmed_by_actor_snapshot_id uuid,
    confirmed_at timestamptz,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT customer_baseline_version_scope_unique
        UNIQUE (enterprise_id, project_id, customer_baseline_id, version_id),
    CONSTRAINT customer_baseline_version_no_unique
        UNIQUE (customer_baseline_id, version_no),
    CONSTRAINT customer_baseline_version_status_closed CHECK (
        version_status IN ('DRAFT', 'CONFIRMED')),
    CONSTRAINT customer_baseline_version_no_positive CHECK (version_no >= 1),
    CONSTRAINT customer_baseline_version_previous_not_self CHECK (
        previous_version_id IS NULL OR previous_version_id <> version_id),
    CONSTRAINT customer_baseline_version_policy_object CHECK (
        jsonb_typeof(baseline_policy_ref) = 'object'),
    CONSTRAINT customer_baseline_version_expectations_array CHECK (
        jsonb_typeof(expectations_payload) = 'array'
        AND jsonb_array_length(expectations_payload) > 0),
    CONSTRAINT customer_baseline_version_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT customer_baseline_version_confirmation_shape CHECK (
        (version_status = 'DRAFT'
         AND confirmed_by_principal_id IS NULL
         AND confirmed_by_actor_snapshot_id IS NULL
         AND confirmed_at IS NULL)
        OR
        (version_status = 'CONFIRMED'
         AND confirmed_by_principal_id IS NOT NULL
         AND confirmed_by_actor_snapshot_id IS NOT NULL
         AND confirmed_at IS NOT NULL))
);

ALTER TABLE enterprise_project.customer_baseline_version
    ADD CONSTRAINT customer_baseline_version_root_fk
    FOREIGN KEY (enterprise_id, project_id, customer_baseline_id)
    REFERENCES enterprise_project.customer_baseline
        (enterprise_id, project_id, customer_baseline_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.customer_baseline_version
    ADD CONSTRAINT customer_baseline_version_previous_fk
    FOREIGN KEY (enterprise_id, project_id, customer_baseline_id, previous_version_id)
    REFERENCES enterprise_project.customer_baseline_version
        (enterprise_id, project_id, customer_baseline_id, version_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX customer_baseline_version_root_idx
    ON enterprise_project.customer_baseline_version
        (customer_baseline_id, version_no DESC);
CREATE INDEX customer_baseline_version_project_idx
    ON enterprise_project.customer_baseline_version
        (enterprise_id, project_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- customer_baseline_item: immutable epistemic facts for one Version.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.customer_baseline_item (
    expectation_id uuid NOT NULL,
    customer_baseline_id uuid NOT NULL,
    version_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    expected_material_key text NOT NULL,
    material_type text NOT NULL,
    expected_title_or_role text NOT NULL,
    status text NOT NULL,
    customer_material_refs jsonb NOT NULL,
    decision_ref jsonb,
    reason jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    PRIMARY KEY (version_id, expectation_id),
    CONSTRAINT customer_baseline_item_scope_unique
        UNIQUE (enterprise_id, project_id, version_id, expectation_id),
    CONSTRAINT customer_baseline_item_key_unique
        UNIQUE (version_id, expected_material_key),
    CONSTRAINT customer_baseline_item_status_closed CHECK (
        status IN ('PRESENT', 'PARTIAL', 'MISSING_CONFIRMED',
                   'NOT_PROVIDED', 'UNKNOWN', 'NOT_APPLICABLE')),
    CONSTRAINT customer_baseline_item_key_nonempty CHECK (
        length(expected_material_key) > 0
        AND length(material_type) > 0
        AND length(expected_title_or_role) > 0),
    CONSTRAINT customer_baseline_item_refs_array CHECK (
        jsonb_typeof(customer_material_refs) = 'array'),
    CONSTRAINT customer_baseline_item_reason_object CHECK (
        jsonb_typeof(reason) = 'object'),
    CONSTRAINT customer_baseline_item_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT customer_baseline_item_epistemic_shape CHECK (
        CASE
            WHEN status IN ('PRESENT', 'PARTIAL')
                THEN jsonb_array_length(customer_material_refs) > 0
                     AND decision_ref IS NULL
            WHEN status IN ('NOT_PROVIDED', 'UNKNOWN')
                THEN jsonb_array_length(customer_material_refs) = 0
                     AND decision_ref IS NULL
            WHEN status IN ('MISSING_CONFIRMED', 'NOT_APPLICABLE')
                THEN jsonb_array_length(customer_material_refs) = 0
                     AND decision_ref IS NOT NULL
            ELSE false
        END),
    CONSTRAINT customer_baseline_item_decision_object CHECK (
        decision_ref IS NULL OR jsonb_typeof(decision_ref) = 'object')
);

ALTER TABLE enterprise_project.customer_baseline_item
    ADD CONSTRAINT customer_baseline_item_version_fk
    FOREIGN KEY (enterprise_id, project_id, customer_baseline_id, version_id)
    REFERENCES enterprise_project.customer_baseline_version
        (enterprise_id, project_id, customer_baseline_id, version_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX customer_baseline_item_project_idx
    ON enterprise_project.customer_baseline_item (enterprise_id, project_id, version_id);

-- ---------------------------------------------------------------------------
-- customer_baseline_impact_review: append-only activation impact fact.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.customer_baseline_impact_review (
    impact_review_id uuid PRIMARY KEY,
    customer_baseline_id uuid NOT NULL,
    new_version_id uuid NOT NULL,
    previous_active_version_id uuid,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    review_snapshot_ref jsonb NOT NULL,
    impact_policy_ref jsonb NOT NULL,
    justification jsonb NOT NULL,
    affected_references jsonb NOT NULL,
    stale_references jsonb NOT NULL,
    impact_status text NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT customer_baseline_impact_scope_unique
        UNIQUE (enterprise_id, project_id, impact_review_id),
    CONSTRAINT customer_baseline_impact_version_unique
        UNIQUE (customer_baseline_id, new_version_id),
    CONSTRAINT customer_baseline_impact_status_closed CHECK (
        impact_status IN ('STALE', 'NO_PRIOR_ACTIVE')),
    CONSTRAINT customer_baseline_impact_previous_not_new CHECK (
        previous_active_version_id IS NULL OR previous_active_version_id <> new_version_id),
    CONSTRAINT customer_baseline_impact_review_ref_object CHECK (
        jsonb_typeof(review_snapshot_ref) = 'object'
        AND jsonb_typeof(impact_policy_ref) = 'object'
        AND jsonb_typeof(justification) = 'object'),
    CONSTRAINT customer_baseline_impact_refs_arrays CHECK (
        jsonb_typeof(affected_references) = 'array'
        AND jsonb_typeof(stale_references) = 'array'),
    CONSTRAINT customer_baseline_impact_hash_len CHECK (octet_length(payload_hash) = 32)
);

ALTER TABLE enterprise_project.customer_baseline_impact_review
    ADD CONSTRAINT customer_baseline_impact_root_fk
    FOREIGN KEY (enterprise_id, project_id, customer_baseline_id)
    REFERENCES enterprise_project.customer_baseline
        (enterprise_id, project_id, customer_baseline_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.customer_baseline_impact_review
    ADD CONSTRAINT customer_baseline_impact_new_version_fk
    FOREIGN KEY (enterprise_id, project_id, customer_baseline_id, new_version_id)
    REFERENCES enterprise_project.customer_baseline_version
        (enterprise_id, project_id, customer_baseline_id, version_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.customer_baseline_impact_review
    ADD CONSTRAINT customer_baseline_impact_previous_version_fk
    FOREIGN KEY (enterprise_id, project_id, customer_baseline_id, previous_active_version_id)
    REFERENCES enterprise_project.customer_baseline_version
        (enterprise_id, project_id, customer_baseline_id, version_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX customer_baseline_impact_project_idx
    ON enterprise_project.customer_baseline_impact_review
        (enterprise_id, project_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Controlled pointer/confirmation transitions and immutable history.
-- ---------------------------------------------------------------------------

CREATE FUNCTION enterprise_project.guard_customer_baseline_root() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.customer_baseline_id IS DISTINCT FROM OLD.customer_baseline_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.retention_class IS DISTINCT FROM OLD.retention_class THEN
        RAISE EXCEPTION 'customer_baseline identity and ownership are immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
        RAISE EXCEPTION 'customer_baseline aggregate_version must advance by one'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.active_version_id IS NOT NULL AND NEW.active_version_id IS NULL THEN
        RAISE EXCEPTION 'customer_baseline active pointer cannot be cleared'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_customer_baseline_root() FROM PUBLIC;

CREATE TRIGGER customer_baseline_root_guard
    BEFORE UPDATE ON enterprise_project.customer_baseline
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_customer_baseline_root();

CREATE FUNCTION enterprise_project.guard_customer_baseline_active_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.active_version_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM enterprise_project.customer_baseline_version version_row
            WHERE version_row.enterprise_id = NEW.enterprise_id
              AND version_row.project_id = NEW.project_id
              AND version_row.customer_baseline_id = NEW.customer_baseline_id
              AND version_row.version_id = NEW.active_version_id
              AND version_row.version_status = 'CONFIRMED') THEN
        RAISE EXCEPTION 'customer_baseline active pointer must resolve to a confirmed version'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_customer_baseline_active_version() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER customer_baseline_active_version_guard
    AFTER INSERT OR UPDATE ON enterprise_project.customer_baseline
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_customer_baseline_active_version();

CREATE FUNCTION enterprise_project.guard_customer_baseline_version_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.version_id IS DISTINCT FROM OLD.version_id
       OR NEW.customer_baseline_id IS DISTINCT FROM OLD.customer_baseline_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.previous_version_id IS DISTINCT FROM OLD.previous_version_id
       OR NEW.baseline_policy_ref IS DISTINCT FROM OLD.baseline_policy_ref
       OR NEW.expectations_payload IS DISTINCT FROM OLD.expectations_payload
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
       OR NEW.canonicalization_version IS DISTINCT FROM OLD.canonicalization_version
       OR NEW.proposed_by_principal_id IS DISTINCT FROM OLD.proposed_by_principal_id
       OR NEW.proposed_by_actor_snapshot_id IS DISTINCT FROM OLD.proposed_by_actor_snapshot_id
       OR NEW.authorization_decision_id IS DISTINCT FROM OLD.authorization_decision_id
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
       OR NEW.source_command_id IS DISTINCT FROM OLD.source_command_id THEN
        RAISE EXCEPTION 'customer_baseline_version content is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.version_status IS DISTINCT FROM OLD.version_status
       AND NOT (OLD.version_status = 'DRAFT' AND NEW.version_status = 'CONFIRMED') THEN
        RAISE EXCEPTION 'customer_baseline_version status transition is not allowed'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.version_status = OLD.version_status
       AND (NEW.confirmed_by_principal_id IS DISTINCT FROM OLD.confirmed_by_principal_id
            OR NEW.confirmed_by_actor_snapshot_id IS DISTINCT FROM OLD.confirmed_by_actor_snapshot_id
            OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN
        RAISE EXCEPTION 'customer_baseline_version confirmation facts require DRAFT to CONFIRMED'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_customer_baseline_version_immutable() FROM PUBLIC;

CREATE TRIGGER customer_baseline_version_immutable_guard
    BEFORE UPDATE ON enterprise_project.customer_baseline_version
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_customer_baseline_version_immutable();

CREATE FUNCTION enterprise_project.guard_customer_baseline_item_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.expectation_id IS DISTINCT FROM OLD.expectation_id
       OR NEW.customer_baseline_id IS DISTINCT FROM OLD.customer_baseline_id
       OR NEW.version_id IS DISTINCT FROM OLD.version_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.expected_material_key IS DISTINCT FROM OLD.expected_material_key
       OR NEW.material_type IS DISTINCT FROM OLD.material_type
       OR NEW.expected_title_or_role IS DISTINCT FROM OLD.expected_title_or_role
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.customer_material_refs IS DISTINCT FROM OLD.customer_material_refs
       OR NEW.decision_ref IS DISTINCT FROM OLD.decision_ref
       OR NEW.reason IS DISTINCT FROM OLD.reason
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
       OR NEW.canonicalization_version IS DISTINCT FROM OLD.canonicalization_version
       OR NEW.recorded_by_principal_id IS DISTINCT FROM OLD.recorded_by_principal_id
       OR NEW.recorded_by_actor_snapshot_id IS DISTINCT FROM OLD.recorded_by_actor_snapshot_id
       OR NEW.authorization_decision_id IS DISTINCT FROM OLD.authorization_decision_id
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
       OR NEW.source_command_id IS DISTINCT FROM OLD.source_command_id THEN
        RAISE EXCEPTION 'customer_baseline_item history is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_customer_baseline_item_immutable() FROM PUBLIC;

CREATE TRIGGER customer_baseline_item_immutable_guard
    BEFORE UPDATE ON enterprise_project.customer_baseline_item
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_customer_baseline_item_immutable();

CREATE FUNCTION enterprise_project.guard_customer_baseline_impact_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.impact_review_id IS DISTINCT FROM OLD.impact_review_id
       OR NEW.customer_baseline_id IS DISTINCT FROM OLD.customer_baseline_id
       OR NEW.new_version_id IS DISTINCT FROM OLD.new_version_id
       OR NEW.previous_active_version_id IS DISTINCT FROM OLD.previous_active_version_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.review_snapshot_ref IS DISTINCT FROM OLD.review_snapshot_ref
       OR NEW.impact_policy_ref IS DISTINCT FROM OLD.impact_policy_ref
       OR NEW.justification IS DISTINCT FROM OLD.justification
       OR NEW.affected_references IS DISTINCT FROM OLD.affected_references
       OR NEW.stale_references IS DISTINCT FROM OLD.stale_references
       OR NEW.impact_status IS DISTINCT FROM OLD.impact_status
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
       OR NEW.canonicalization_version IS DISTINCT FROM OLD.canonicalization_version
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.authorization_decision_id IS DISTINCT FROM OLD.authorization_decision_id
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
       OR NEW.source_command_id IS DISTINCT FROM OLD.source_command_id THEN
        RAISE EXCEPTION 'customer_baseline_impact_review history is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_customer_baseline_impact_immutable() FROM PUBLIC;

CREATE TRIGGER customer_baseline_impact_immutable_guard
    BEFORE UPDATE ON enterprise_project.customer_baseline_impact_review
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_customer_baseline_impact_immutable();

-- Complete the pointer FKs after both Root and Version tables exist.
ALTER TABLE enterprise_project.customer_baseline
    ADD CONSTRAINT customer_baseline_current_version_fk
    FOREIGN KEY (enterprise_id, project_id, customer_baseline_id, current_version_id)
    REFERENCES enterprise_project.customer_baseline_version
        (enterprise_id, project_id, customer_baseline_id, version_id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.customer_baseline
    ADD CONSTRAINT customer_baseline_active_version_fk
    FOREIGN KEY (enterprise_id, project_id, customer_baseline_id, active_version_id)
    REFERENCES enterprise_project.customer_baseline_version
        (enterprise_id, project_id, customer_baseline_id, version_id)
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- Minimum app-role grants and Project RLS.
-- ---------------------------------------------------------------------------

REVOKE UPDATE, DELETE ON enterprise_project.customer_baseline_version
    FROM enterprise_project_app;
GRANT UPDATE (
    version_status,
    confirmed_by_principal_id,
    confirmed_by_actor_snapshot_id,
    confirmed_at
) ON enterprise_project.customer_baseline_version TO enterprise_project_app;
REVOKE UPDATE, DELETE ON enterprise_project.customer_baseline_item
    FROM enterprise_project_app;
REVOKE UPDATE, DELETE ON enterprise_project.customer_baseline_impact_review
    FROM enterprise_project_app;
REVOKE UPDATE, DELETE ON enterprise_project.customer_baseline FROM enterprise_project_app;
GRANT UPDATE (
    current_version_id,
    active_version_id,
    aggregate_version,
    updated_at,
    last_command_id
) ON enterprise_project.customer_baseline TO enterprise_project_app;

ALTER TABLE enterprise_project.customer_baseline ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.customer_baseline FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_baseline_select ON enterprise_project.customer_baseline
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY customer_baseline_insert ON enterprise_project.customer_baseline
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        created_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY customer_baseline_update ON enterprise_project.customer_baseline
    FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.customer_baseline_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.customer_baseline_version FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_baseline_version_select ON enterprise_project.customer_baseline_version
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY customer_baseline_version_insert ON enterprise_project.customer_baseline_version
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        proposed_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY customer_baseline_version_confirm ON enterprise_project.customer_baseline_version
    FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (
        confirmed_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.customer_baseline_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.customer_baseline_item FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_baseline_item_select ON enterprise_project.customer_baseline_item
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY customer_baseline_item_insert ON enterprise_project.customer_baseline_item
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        recorded_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.customer_baseline_impact_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.customer_baseline_impact_review FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_baseline_impact_select ON enterprise_project.customer_baseline_impact_review
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY customer_baseline_impact_insert ON enterprise_project.customer_baseline_impact_review
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        created_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

RESET ROLE;
