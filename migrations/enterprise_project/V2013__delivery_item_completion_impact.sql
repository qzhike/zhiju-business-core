-- IM-03 WI-12 (issue #68): formal DeliveryItem completion facts, derived
-- evaluations, impact history and the controlled current-evaluation pointer.
--
-- Upstream events are consumed through the existing technical Inbox and
-- Process Manager tables. This migration deliberately does not add a direct
-- COMPLETED write path to delivery_item; only the evaluator may move the
-- current evaluation pointer after it has stored an immutable evaluation.

SET ROLE enterprise_project_owner;

-- ---------------------------------------------------------------------------
-- DeliveryItem pointer boundary.
-- ---------------------------------------------------------------------------

ALTER TABLE enterprise_project.delivery_item
    ADD COLUMN current_completion_evaluation_id uuid,
    ADD COLUMN completion_aggregate_version bigint NOT NULL DEFAULT 1,
    ADD COLUMN completion_updated_at timestamptz,
    ADD COLUMN completion_last_command_id uuid,
    ADD CONSTRAINT delivery_item_completion_version_nonnegative
        CHECK (completion_aggregate_version >= 1);

-- ---------------------------------------------------------------------------
-- Formal upstream fact ledger.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.delivery_item_completion_fact (
    fact_id uuid PRIMARY KEY,
    consumer_name text NOT NULL,
    event_id uuid NOT NULL,
    event_type text NOT NULL,
    event_version text NOT NULL,
    producer_module text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    aggregate_version bigint NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    fact_ref jsonb NOT NULL,
    fact_refs jsonb NOT NULL,
    subject_refs jsonb NOT NULL,
    lifecycle text NOT NULL,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    source_watermark jsonb NOT NULL,
    source_watermark_hash bytea NOT NULL,
    correlation_id uuid NOT NULL,
    causation_id uuid,
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT delivery_item_completion_fact_event_unique
        UNIQUE (consumer_name, event_id),
    CONSTRAINT delivery_item_completion_fact_inbox_fk
        FOREIGN KEY (consumer_name, event_id)
        REFERENCES enterprise_project.inbox_message (consumer_name, event_id)
        ON DELETE RESTRICT,
    CONSTRAINT delivery_item_completion_fact_scope_unique
        UNIQUE (enterprise_id, project_id, fact_id),
    CONSTRAINT delivery_item_completion_fact_version_positive
        CHECK (aggregate_version >= 1),
    CONSTRAINT delivery_item_completion_fact_lifecycle_closed
        CHECK (lifecycle IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT delivery_item_completion_fact_json_shape
        CHECK (
            jsonb_typeof(fact_ref) = 'object'
            AND jsonb_typeof(fact_refs) = 'array'
            AND jsonb_array_length(fact_refs) > 0
            AND jsonb_typeof(subject_refs) = 'array'
            AND jsonb_typeof(payload) = 'object'
            AND jsonb_typeof(source_watermark) = 'object'),
    CONSTRAINT delivery_item_completion_fact_payload_hash_len
        CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT delivery_item_completion_fact_watermark_hash_len
        CHECK (octet_length(source_watermark_hash) = 32)
);

CREATE INDEX delivery_item_completion_fact_project_type_idx
    ON enterprise_project.delivery_item_completion_fact
        (enterprise_id, project_id, event_type, recorded_at DESC);
CREATE INDEX delivery_item_completion_fact_subject_idx
    ON enterprise_project.delivery_item_completion_fact
        (enterprise_id, project_id, lifecycle, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Immutable Completion Evaluation history.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.delivery_item_completion_evaluation (
    evaluation_id uuid PRIMARY KEY,
    delivery_plan_id uuid NOT NULL,
    version_id uuid NOT NULL,
    delivery_item_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    criteria_hash bytea NOT NULL,
    evaluator_ref jsonb NOT NULL,
    evaluator_ref_hash bytea NOT NULL,
    evaluator_id uuid NOT NULL,
    evaluator_version_id uuid NOT NULL,
    fact_refs jsonb NOT NULL,
    fact_refs_hash bytea NOT NULL,
    source_watermarks jsonb NOT NULL,
    source_watermarks_hash bytea NOT NULL,
    outcome text NOT NULL,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    input_fingerprint bytea NOT NULL,
    evaluated_at timestamptz NOT NULL,
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    source_event_id uuid,
    CONSTRAINT delivery_item_completion_evaluation_identity_unique
        UNIQUE (enterprise_id, project_id, version_id, delivery_item_id, evaluation_id),
    CONSTRAINT delivery_item_completion_evaluation_fingerprint_unique
        UNIQUE (enterprise_id, project_id, version_id, delivery_item_id, input_fingerprint),
    CONSTRAINT delivery_item_completion_evaluation_version_fk
        FOREIGN KEY (enterprise_id, project_id, delivery_plan_id, version_id)
        REFERENCES enterprise_project.delivery_plan_version
            (enterprise_id, project_id, delivery_plan_id, version_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT delivery_item_completion_evaluation_item_fk
        FOREIGN KEY (enterprise_id, project_id, version_id, delivery_item_id)
        REFERENCES enterprise_project.delivery_item
            (enterprise_id, project_id, version_id, delivery_item_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT delivery_item_completion_evaluation_json_shape
        CHECK (
            jsonb_typeof(evaluator_ref) = 'object'
            AND jsonb_typeof(fact_refs) = 'array'
            AND jsonb_array_length(fact_refs) > 0
            AND jsonb_typeof(source_watermarks) = 'array'
            AND jsonb_array_length(source_watermarks) > 0
            AND jsonb_typeof(payload) = 'object'),
    CONSTRAINT delivery_item_completion_evaluation_outcome_closed
        CHECK (outcome IN ('SATISFIED', 'UNSATISFIED')),
    CONSTRAINT delivery_item_completion_evaluation_criteria_hash_len
        CHECK (octet_length(criteria_hash) = 32),
    CONSTRAINT delivery_item_completion_evaluation_ref_hash_len
        CHECK (octet_length(evaluator_ref_hash) = 32),
    CONSTRAINT delivery_item_completion_evaluation_fact_hash_len
        CHECK (octet_length(fact_refs_hash) = 32),
    CONSTRAINT delivery_item_completion_evaluation_watermark_hash_len
        CHECK (octet_length(source_watermarks_hash) = 32),
    CONSTRAINT delivery_item_completion_evaluation_payload_hash_len
        CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT delivery_item_completion_evaluation_fingerprint_len
        CHECK (octet_length(input_fingerprint) = 32)
);

CREATE INDEX delivery_item_completion_evaluation_current_idx
    ON enterprise_project.delivery_item_completion_evaluation
        (enterprise_id, project_id, version_id, delivery_item_id, evaluated_at DESC);

-- ---------------------------------------------------------------------------
-- Immutable Impact Review history.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.delivery_item_impact_review (
    impact_review_id uuid PRIMARY KEY,
    delivery_plan_id uuid NOT NULL,
    version_id uuid NOT NULL,
    delivery_item_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    triggering_ref jsonb NOT NULL,
    prior_evaluation_ref jsonb,
    prior_evaluation_id uuid,
    new_evaluation_ref jsonb NOT NULL,
    new_evaluation_id uuid NOT NULL,
    impact_reason text NOT NULL,
    affected_fact_refs jsonb NOT NULL,
    source_watermarks jsonb NOT NULL,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT delivery_item_impact_review_version_fk
        FOREIGN KEY (enterprise_id, project_id, delivery_plan_id, version_id)
        REFERENCES enterprise_project.delivery_plan_version
            (enterprise_id, project_id, delivery_plan_id, version_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT delivery_item_impact_review_item_fk
        FOREIGN KEY (enterprise_id, project_id, version_id, delivery_item_id)
        REFERENCES enterprise_project.delivery_item
            (enterprise_id, project_id, version_id, delivery_item_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT delivery_item_impact_review_new_evaluation_fk
        FOREIGN KEY (enterprise_id, project_id, version_id, delivery_item_id,
                     new_evaluation_id)
        REFERENCES enterprise_project.delivery_item_completion_evaluation
            (enterprise_id, project_id, version_id, delivery_item_id,
             evaluation_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT delivery_item_impact_review_prior_evaluation_fk
        FOREIGN KEY (enterprise_id, project_id, version_id, delivery_item_id,
                     prior_evaluation_id)
        REFERENCES enterprise_project.delivery_item_completion_evaluation
            (enterprise_id, project_id, version_id, delivery_item_id,
             evaluation_id)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT delivery_item_impact_review_json_shape
        CHECK (
            jsonb_typeof(triggering_ref) = 'object'
            AND (prior_evaluation_ref IS NULL OR jsonb_typeof(prior_evaluation_ref) = 'object')
            AND jsonb_typeof(new_evaluation_ref) = 'object'
            AND jsonb_typeof(affected_fact_refs) = 'array'
            AND jsonb_typeof(source_watermarks) = 'array'
            AND jsonb_array_length(source_watermarks) > 0
            AND jsonb_typeof(payload) = 'object'),
    CONSTRAINT delivery_item_impact_review_payload_hash_len
        CHECK (octet_length(payload_hash) = 32)
);

CREATE INDEX delivery_item_impact_review_project_idx
    ON enterprise_project.delivery_item_impact_review
        (enterprise_id, project_id, delivery_item_id, recorded_at DESC);

-- Exact pointers are deferred until the evaluation row exists and the item
-- identity has been checked by the evaluation foreign keys.
ALTER TABLE enterprise_project.delivery_item
    ADD CONSTRAINT delivery_item_current_completion_evaluation_fk
    FOREIGN KEY (enterprise_id, project_id, version_id, delivery_item_id,
                 current_completion_evaluation_id)
    REFERENCES enterprise_project.delivery_item_completion_evaluation
        (enterprise_id, project_id, version_id, delivery_item_id, evaluation_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- Scope mirror, item-pointer and immutable-history guards.
-- ---------------------------------------------------------------------------

CREATE FUNCTION enterprise_project.guard_completion_payload_scope_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.payload->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.payload->>'projectId' IS DISTINCT FROM NEW.project_id::text THEN
        RAISE EXCEPTION 'completion payload scope mirror mismatch'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_completion_payload_scope_mirror() FROM PUBLIC;

CREATE TRIGGER delivery_item_completion_evaluation_payload_scope_guard
    BEFORE INSERT OR UPDATE ON enterprise_project.delivery_item_completion_evaluation
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_completion_payload_scope_mirror();
CREATE TRIGGER delivery_item_impact_review_payload_scope_guard
    BEFORE INSERT OR UPDATE ON enterprise_project.delivery_item_impact_review
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_completion_payload_scope_mirror();

CREATE OR REPLACE FUNCTION enterprise_project.guard_delivery_item_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF (to_jsonb(NEW) - ARRAY[
        'current_completion_evaluation_id',
        'completion_aggregate_version',
        'completion_updated_at',
        'completion_last_command_id']::text[])
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY[
        'current_completion_evaluation_id',
        'completion_aggregate_version',
        'completion_updated_at',
        'completion_last_command_id']::text[]) THEN
        RAISE EXCEPTION 'delivery_item history is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.completion_aggregate_version <> OLD.completion_aggregate_version + 1 THEN
        RAISE EXCEPTION 'delivery_item completion aggregate_version must advance by one'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.current_completion_evaluation_id IS NOT DISTINCT FROM
       OLD.current_completion_evaluation_id THEN
        RAISE EXCEPTION 'delivery_item completion pointer must change'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.current_completion_evaluation_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM enterprise_project.delivery_item_completion_evaluation evaluation_row
            WHERE evaluation_row.enterprise_id = NEW.enterprise_id
              AND evaluation_row.project_id = NEW.project_id
              AND evaluation_row.version_id = NEW.version_id
              AND evaluation_row.delivery_item_id = NEW.delivery_item_id
              AND evaluation_row.evaluation_id = NEW.current_completion_evaluation_id) THEN
        RAISE EXCEPTION 'delivery_item completion pointer must resolve to the exact item'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_delivery_item_immutable() FROM PUBLIC;

-- Immutable fact/result rows have no application UPDATE or DELETE path.
CREATE FUNCTION enterprise_project.guard_delivery_item_completion_fact_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'delivery_item_completion_fact history is immutable'
        USING ERRCODE = '23514';
END
$guard$;

CREATE FUNCTION enterprise_project.guard_delivery_item_completion_evaluation_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'delivery_item_completion_evaluation history is immutable'
        USING ERRCODE = '23514';
END
$guard$;

CREATE FUNCTION enterprise_project.guard_delivery_item_impact_review_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'delivery_item_impact_review history is immutable'
        USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_delivery_item_completion_fact_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION enterprise_project.guard_delivery_item_completion_evaluation_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION enterprise_project.guard_delivery_item_impact_review_immutable() FROM PUBLIC;

CREATE TRIGGER delivery_item_completion_fact_immutable_guard
    BEFORE UPDATE OR DELETE ON enterprise_project.delivery_item_completion_fact
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_delivery_item_completion_fact_immutable();
CREATE TRIGGER delivery_item_completion_evaluation_immutable_guard
    BEFORE UPDATE OR DELETE ON enterprise_project.delivery_item_completion_evaluation
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_delivery_item_completion_evaluation_immutable();
CREATE TRIGGER delivery_item_impact_review_immutable_guard
    BEFORE UPDATE OR DELETE ON enterprise_project.delivery_item_impact_review
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_delivery_item_impact_review_immutable();

-- ---------------------------------------------------------------------------
-- Application grants and Project RLS.
-- ---------------------------------------------------------------------------

GRANT UPDATE (
    current_completion_evaluation_id,
    completion_aggregate_version,
    completion_updated_at,
    completion_last_command_id)
    ON enterprise_project.delivery_item TO enterprise_project_app;

GRANT SELECT, INSERT ON
    enterprise_project.delivery_item_completion_fact,
    enterprise_project.delivery_item_completion_evaluation,
    enterprise_project.delivery_item_impact_review
    TO enterprise_project_app;
REVOKE UPDATE, DELETE ON
    enterprise_project.delivery_item_completion_fact,
    enterprise_project.delivery_item_completion_evaluation,
    enterprise_project.delivery_item_impact_review
    FROM enterprise_project_app;

ALTER TABLE enterprise_project.delivery_item_completion_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.delivery_item_completion_fact FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_item_completion_fact_select
    ON enterprise_project.delivery_item_completion_fact
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY delivery_item_completion_fact_insert
    ON enterprise_project.delivery_item_completion_fact
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        recorded_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

CREATE POLICY delivery_item_completion_pointer_update
    ON enterprise_project.delivery_item
    FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.delivery_item_completion_evaluation ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.delivery_item_completion_evaluation FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_item_completion_evaluation_select
    ON enterprise_project.delivery_item_completion_evaluation
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY delivery_item_completion_evaluation_insert
    ON enterprise_project.delivery_item_completion_evaluation
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        recorded_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.delivery_item_impact_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.delivery_item_impact_review FORCE ROW LEVEL SECURITY;
CREATE POLICY delivery_item_impact_review_select
    ON enterprise_project.delivery_item_impact_review
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY delivery_item_impact_review_insert
    ON enterprise_project.delivery_item_impact_review
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        recorded_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

RESET ROLE;
