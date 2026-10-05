-- Task Board projection: rebuildable generation / row / alias / checkpoint /
-- fence facts published by TaskExecution into the shared projection Schema.
--
-- The projection schema deliberately has no module owner role. This migration
-- runs as the controlled migration user, while runtime access is restricted
-- to projection_app under FORCE RLS and the transaction-scoped context.
-- Projection objects ship with the owning module range, so the file lives in
-- task_execution/; it touches only the shared projection Schema, creates no
-- cross-schema foreign key and grants no other module access.

CREATE TABLE projection.task_board_generation (
    generation_id uuid PRIMARY KEY,
    export_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    project_ref jsonb NOT NULL,
    manifest jsonb NOT NULL,
    manifest_hash bytea NOT NULL,
    rows_hash bytea NOT NULL,
    row_count integer NOT NULL,
    source_fingerprint bytea NOT NULL,
    policy_observation jsonb NOT NULL,
    snapshot_at timestamptz NOT NULL,
    publish_sequence bigint NOT NULL,
    published_at timestamptz NOT NULL,
    retention_until timestamptz NOT NULL,
    created_by_principal_id uuid NOT NULL,
    CONSTRAINT task_board_generation_export_unique
        UNIQUE (export_id),
    CONSTRAINT task_board_generation_sequence_unique
        UNIQUE (enterprise_id, project_id, publish_sequence),
    CONSTRAINT task_board_generation_scope_unique
        UNIQUE (enterprise_id, project_id, generation_id),
    CONSTRAINT task_board_generation_manifest_hash_len CHECK (
        octet_length(manifest_hash) = 32),
    CONSTRAINT task_board_generation_rows_hash_len CHECK (
        octet_length(rows_hash) = 32),
    CONSTRAINT task_board_generation_source_fingerprint_len CHECK (
        octet_length(source_fingerprint) = 32),
    CONSTRAINT task_board_generation_row_count_range CHECK (
        row_count BETWEEN 0 AND 1000),
    CONSTRAINT task_board_generation_publish_sequence_range CHECK (
        publish_sequence BETWEEN 1 AND 9007199254740991),
    CONSTRAINT task_board_generation_retention_order CHECK (
        retention_until >= published_at)
);

CREATE TABLE projection.task_board_row (
    generation_id uuid NOT NULL,
    task_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    row jsonb NOT NULL,
    delivery_item_ref jsonb,
    PRIMARY KEY (generation_id, task_id),
    CONSTRAINT task_board_row_generation_fk
        FOREIGN KEY (enterprise_id, project_id, generation_id)
        REFERENCES projection.task_board_generation
            (enterprise_id, project_id, generation_id)
        ON DELETE RESTRICT
);

CREATE TABLE projection.task_board_alias (
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    generation_id uuid NOT NULL,
    publish_sequence bigint NOT NULL,
    switched_at timestamptz NOT NULL,
    switched_by_principal_id uuid NOT NULL,
    PRIMARY KEY (enterprise_id, project_id),
    CONSTRAINT task_board_alias_generation_fk
        FOREIGN KEY (enterprise_id, project_id, generation_id)
        REFERENCES projection.task_board_generation
            (enterprise_id, project_id, generation_id)
        ON DELETE RESTRICT,
    CONSTRAINT task_board_alias_publish_sequence_positive CHECK (
        publish_sequence >= 1)
);

CREATE TABLE projection.task_board_checkpoint (
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    last_generation_id uuid NOT NULL,
    last_publish_sequence bigint NOT NULL,
    last_export_id uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (enterprise_id, project_id),
    CONSTRAINT task_board_checkpoint_publish_sequence_positive CHECK (
        last_publish_sequence >= 1)
);

CREATE TABLE projection.task_board_fence (
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    token bigint NOT NULL DEFAULT 0,
    owner_principal_id uuid,
    lease_until timestamptz,
    version bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (enterprise_id, project_id),
    CONSTRAINT task_board_fence_token_range CHECK (
        token BETWEEN 0 AND 9007199254740991),
    CONSTRAINT task_board_fence_version_nonnegative CHECK (version >= 0),
    CONSTRAINT task_board_fence_lease_shape CHECK (
        (owner_principal_id IS NULL) = (lease_until IS NULL))
);

CREATE TABLE projection.task_board_publication_outcome (
    export_id uuid NOT NULL,
    manifest_hash bytea NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    generation_id uuid NOT NULL,
    publish_sequence bigint NOT NULL,
    recorded_at timestamptz NOT NULL,
    PRIMARY KEY (export_id, manifest_hash),
    CONSTRAINT task_board_publication_outcome_manifest_hash_len CHECK (
        octet_length(manifest_hash) = 32)
);

CREATE TABLE projection.task_board_failure (
    failure_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    export_id uuid,
    failure_code text NOT NULL,
    safe_summary text NOT NULL,
    recorded_at timestamptz NOT NULL,
    recorded_by_principal_id uuid NOT NULL,
    CONSTRAINT task_board_failure_text_nonempty CHECK (
        length(failure_code) > 0 AND length(safe_summary) > 0)
);

CREATE INDEX task_board_generation_sequence_idx
    ON projection.task_board_generation
        (enterprise_id, project_id, publish_sequence DESC);
CREATE INDEX task_board_generation_retention_idx
    ON projection.task_board_generation
        (enterprise_id, project_id, retention_until);
CREATE INDEX task_board_row_task_idx
    ON projection.task_board_row
        (enterprise_id, project_id, task_id);
CREATE INDEX task_board_failure_recorded_idx
    ON projection.task_board_failure
        (enterprise_id, project_id, recorded_at);

CREATE FUNCTION projection.guard_task_board_generation_insert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    -- The promoted mirrors must equal the canonical manifest exactly, so an
    -- arbitrary row set can never be stored as a published generation.
    IF NEW.manifest_hash IS DISTINCT FROM task_execution.recovery_payload_hash(NEW.manifest)
       OR NEW.rows_hash IS DISTINCT FROM task_execution.recovery_payload_hash(NEW.manifest->'rows')
       OR NEW.policy_observation IS DISTINCT FROM NEW.manifest->'policyObservation'
       OR NEW.policy_observation->'policyRef' IS DISTINCT FROM NEW.manifest->'policyRef'
       OR NEW.manifest->>'exportId' IS DISTINCT FROM NEW.export_id::text
       OR (NEW.manifest->>'snapshotAt')::timestamptz IS DISTINCT FROM NEW.snapshot_at
       OR (NEW.manifest->>'rowCount')::integer IS DISTINCT FROM NEW.row_count
       OR NEW.manifest->>'rowsHash' IS DISTINCT FROM encode(NEW.rows_hash, 'hex')
       OR NEW.manifest->>'sourceFingerprint'
          IS DISTINCT FROM encode(NEW.source_fingerprint, 'hex')
       OR jsonb_array_length(NEW.manifest->'rows') IS DISTINCT FROM NEW.row_count
       OR NEW.manifest->'projectRef' IS DISTINCT FROM NEW.project_ref
       OR NEW.project_ref->>'objectId' IS DISTINCT FROM NEW.project_id::text
       OR NEW.project_ref->'scope'->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.project_ref->'scope'->>'projectId' IS DISTINCT FROM NEW.project_id::text
    THEN
        RAISE EXCEPTION 'task_board_generation manifest mirror mismatch'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION projection.guard_task_board_generation_insert() FROM PUBLIC;
CREATE TRIGGER task_board_generation_insert_guard
    BEFORE INSERT ON projection.task_board_generation
    FOR EACH ROW EXECUTE FUNCTION projection.guard_task_board_generation_insert();

-- The projection integrity guards reuse the owning canonical cv1 hasher
-- instead of duplicating a second JSON canonicalization in this schema.
GRANT USAGE ON SCHEMA task_execution TO projection_app;
GRANT EXECUTE ON FUNCTION task_execution.recovery_payload_hash(jsonb) TO projection_app;

-- The TaskExecution owner (the SECURITY DEFINER owner of the export dispatch
-- helpers) may read the committed publication outcome and generation to prove
-- a publication before recording it; the projection runtime role still holds
-- no TaskExecution access.
GRANT USAGE ON SCHEMA projection TO task_execution_owner;
GRANT SELECT ON projection.task_board_publication_outcome TO task_execution_owner;
GRANT SELECT ON projection.task_board_alias TO task_execution_owner;
GRANT SELECT ON projection.task_board_generation TO task_execution_owner;

-- FORCE RLS also applies to the TaskExecution owner, so proving a publication
-- needs an explicit owner-scoped SELECT policy on the mirrored facts.
CREATE POLICY task_board_publication_outcome_owner_select
  ON projection.task_board_publication_outcome
  FOR SELECT TO task_execution_owner
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_generation_owner_select
  ON projection.task_board_generation
  FOR SELECT TO task_execution_owner
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_alias_owner_select
  ON projection.task_board_alias
  FOR SELECT TO task_execution_owner
  USING (platform_security.context_allows_project(enterprise_id, project_id));

CREATE FUNCTION projection.guard_task_board_row_insert() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    -- The stored internal row must be the exact manifest row of its
    -- generation, with its promoted identity, Scope and filter mirrors equal.
    IF NEW.row->'item'->'taskRef'->>'kind' IS DISTINCT FROM 'OBJECT'
       OR NEW.row->'item'->'taskRef'->>'objectId' IS DISTINCT FROM NEW.task_id::text
       OR NEW.row->'item'->'taskRef'->'scope'->>'enterpriseId'
          IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.row->'item'->'taskRef'->'scope'->>'projectId' IS DISTINCT FROM NEW.project_id::text
       OR (NEW.row->'filterKeys' ? 'deliveryItemRef')
          IS DISTINCT FROM (NEW.delivery_item_ref IS NOT NULL)
       OR (NEW.delivery_item_ref IS NOT NULL
           AND NEW.row->'filterKeys'->'deliveryItemRef' IS DISTINCT FROM NEW.delivery_item_ref)
    THEN
        RAISE EXCEPTION 'task_board_row identity mirror mismatch' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM projection.task_board_generation AS g
        WHERE g.generation_id = NEW.generation_id
          AND g.enterprise_id = NEW.enterprise_id
          AND g.project_id = NEW.project_id
          AND g.manifest->'rows' @> jsonb_build_array(NEW.row)
    ) THEN
        RAISE EXCEPTION 'task_board_row is not part of its generation manifest'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION projection.guard_task_board_row_insert() FROM PUBLIC;
CREATE TRIGGER task_board_row_insert_guard
    BEFORE INSERT ON projection.task_board_row
    FOR EACH ROW EXECUTE FUNCTION projection.guard_task_board_row_insert();

CREATE FUNCTION projection.guard_task_board_generation_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'task_board_generation rows are immutable' USING ERRCODE = '23514';
END
$guard$;

CREATE FUNCTION projection.guard_task_board_generation_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF OLD.retention_until <= clock_timestamp() THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'task_board_generation is retained until its retention window closes'
        USING ERRCODE = '23514';
END
$guard$;

CREATE FUNCTION projection.guard_task_board_row_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'task_board_row rows are immutable' USING ERRCODE = '23514';
END
$guard$;

CREATE FUNCTION projection.guard_task_board_row_delete() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
DECLARE
    v_retention_until timestamptz;
BEGIN
    SELECT g.retention_until INTO v_retention_until
    FROM projection.task_board_generation AS g
    WHERE g.enterprise_id = OLD.enterprise_id
      AND g.project_id = OLD.project_id
      AND g.generation_id = OLD.generation_id;

    IF v_retention_until IS NOT NULL
       AND v_retention_until <= clock_timestamp() THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'task_board_row is retained until its generation retention window closes'
        USING ERRCODE = '23514';
END
$guard$;

CREATE FUNCTION projection.guard_task_board_alias_forward() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
DECLARE
    v_generation_exists boolean;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'task_board_alias cannot be deleted' USING ERRCODE = '23514';
    END IF;

    IF NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
        RAISE EXCEPTION 'task_board_alias identity is immutable' USING ERRCODE = '23514';
    END IF;

    IF NEW.publish_sequence <= OLD.publish_sequence THEN
        RAISE EXCEPTION 'task_board_alias must move forward' USING ERRCODE = '23514';
    END IF;

    IF NEW.switched_at < OLD.switched_at THEN
        RAISE EXCEPTION 'task_board_alias switch time cannot move backwards'
            USING ERRCODE = '23514';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM projection.task_board_generation AS g
        WHERE g.enterprise_id = NEW.enterprise_id
          AND g.project_id = NEW.project_id
          AND g.generation_id = NEW.generation_id
          AND g.publish_sequence = NEW.publish_sequence
    ) INTO v_generation_exists;
    IF NOT v_generation_exists THEN
        RAISE EXCEPTION 'task_board_alias must reference a published generation'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END
$guard$;

CREATE FUNCTION projection.guard_task_board_checkpoint_forward() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'task_board_checkpoint cannot be deleted' USING ERRCODE = '23514';
    END IF;

    IF NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
        RAISE EXCEPTION 'task_board_checkpoint identity is immutable' USING ERRCODE = '23514';
    END IF;

    IF NEW.last_publish_sequence <= OLD.last_publish_sequence THEN
        RAISE EXCEPTION 'task_board_checkpoint watermark must move forward'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END
$guard$;

CREATE FUNCTION projection.guard_task_board_fence_monotonic() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'task_board_fence cannot be deleted' USING ERRCODE = '23514';
    END IF;

    IF NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
        RAISE EXCEPTION 'task_board_fence identity is immutable' USING ERRCODE = '23514';
    END IF;

    IF NOT (NEW.token > OLD.token
            OR (NEW.token = OLD.token
                AND NEW.owner_principal_id IS NOT DISTINCT FROM OLD.owner_principal_id
                AND NEW.lease_until >= OLD.lease_until)) THEN
        RAISE EXCEPTION 'task_board_fence token cannot move backwards'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'task_board_fence version must advance by one'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END
$guard$;

CREATE FUNCTION projection.guard_task_board_outcome_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'task_board_publication_outcome rows are immutable'
        USING ERRCODE = '23514';
END
$guard$;

CREATE FUNCTION projection.guard_task_board_failure_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'task_board_failure rows are immutable' USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION projection.guard_task_board_generation_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION projection.guard_task_board_generation_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION projection.guard_task_board_row_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION projection.guard_task_board_row_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION projection.guard_task_board_alias_forward() FROM PUBLIC;
REVOKE ALL ON FUNCTION projection.guard_task_board_checkpoint_forward() FROM PUBLIC;
REVOKE ALL ON FUNCTION projection.guard_task_board_fence_monotonic() FROM PUBLIC;
REVOKE ALL ON FUNCTION projection.guard_task_board_outcome_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION projection.guard_task_board_failure_immutable() FROM PUBLIC;

CREATE TRIGGER task_board_generation_mutation_guard
    BEFORE UPDATE ON projection.task_board_generation
    FOR EACH ROW EXECUTE FUNCTION projection.guard_task_board_generation_mutation();
CREATE TRIGGER task_board_generation_delete_guard
    BEFORE DELETE ON projection.task_board_generation
    FOR EACH ROW EXECUTE FUNCTION projection.guard_task_board_generation_delete();
CREATE TRIGGER task_board_row_mutation_guard
    BEFORE UPDATE ON projection.task_board_row
    FOR EACH ROW EXECUTE FUNCTION projection.guard_task_board_row_mutation();
CREATE TRIGGER task_board_row_delete_guard
    BEFORE DELETE ON projection.task_board_row
    FOR EACH ROW EXECUTE FUNCTION projection.guard_task_board_row_delete();
CREATE TRIGGER task_board_alias_forward_guard
    BEFORE UPDATE OR DELETE ON projection.task_board_alias
    FOR EACH ROW EXECUTE FUNCTION projection.guard_task_board_alias_forward();
CREATE TRIGGER task_board_checkpoint_forward_guard
    BEFORE UPDATE OR DELETE ON projection.task_board_checkpoint
    FOR EACH ROW EXECUTE FUNCTION projection.guard_task_board_checkpoint_forward();
CREATE TRIGGER task_board_fence_monotonic_guard
    BEFORE UPDATE OR DELETE ON projection.task_board_fence
    FOR EACH ROW EXECUTE FUNCTION projection.guard_task_board_fence_monotonic();
CREATE TRIGGER task_board_outcome_immutable_guard
    BEFORE UPDATE OR DELETE ON projection.task_board_publication_outcome
    FOR EACH ROW EXECUTE FUNCTION projection.guard_task_board_outcome_immutable();
CREATE TRIGGER task_board_failure_immutable_guard
    BEFORE UPDATE OR DELETE ON projection.task_board_failure
    FOR EACH ROW EXECUTE FUNCTION projection.guard_task_board_failure_immutable();

REVOKE ALL ON TABLE
    projection.task_board_generation,
    projection.task_board_row,
    projection.task_board_alias,
    projection.task_board_checkpoint,
    projection.task_board_fence,
    projection.task_board_publication_outcome,
    projection.task_board_failure
    FROM PUBLIC;

GRANT SELECT, INSERT, DELETE ON
    projection.task_board_generation,
    projection.task_board_row
    TO projection_app;
GRANT SELECT, INSERT, UPDATE ON
    projection.task_board_alias,
    projection.task_board_checkpoint,
    projection.task_board_fence
    TO projection_app;
GRANT SELECT, INSERT ON
    projection.task_board_publication_outcome,
    projection.task_board_failure
    TO projection_app;

REVOKE UPDATE ON
    projection.task_board_generation,
    projection.task_board_row
    FROM projection_app;
REVOKE DELETE ON
    projection.task_board_alias,
    projection.task_board_checkpoint,
    projection.task_board_fence
    FROM projection_app;
REVOKE UPDATE, DELETE ON
    projection.task_board_publication_outcome,
    projection.task_board_failure
    FROM projection_app;

ALTER TABLE projection.task_board_generation ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection.task_board_generation FORCE ROW LEVEL SECURITY;
CREATE POLICY task_board_generation_select
    ON projection.task_board_generation FOR SELECT TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_generation_insert
    ON projection.task_board_generation FOR INSERT TO projection_app
    WITH CHECK (created_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_generation_delete
    ON projection.task_board_generation FOR DELETE TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE projection.task_board_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection.task_board_row FORCE ROW LEVEL SECURITY;
CREATE POLICY task_board_row_select
    ON projection.task_board_row FOR SELECT TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_row_insert
    ON projection.task_board_row FOR INSERT TO projection_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_row_delete
    ON projection.task_board_row FOR DELETE TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE projection.task_board_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection.task_board_alias FORCE ROW LEVEL SECURITY;
CREATE POLICY task_board_alias_select
    ON projection.task_board_alias FOR SELECT TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_alias_insert
    ON projection.task_board_alias FOR INSERT TO projection_app
    WITH CHECK (switched_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_alias_update
    ON projection.task_board_alias FOR UPDATE TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (switched_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE projection.task_board_checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection.task_board_checkpoint FORCE ROW LEVEL SECURITY;
CREATE POLICY task_board_checkpoint_select
    ON projection.task_board_checkpoint FOR SELECT TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_checkpoint_insert
    ON projection.task_board_checkpoint FOR INSERT TO projection_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_checkpoint_update
    ON projection.task_board_checkpoint FOR UPDATE TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE projection.task_board_fence ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection.task_board_fence FORCE ROW LEVEL SECURITY;
CREATE POLICY task_board_fence_select
    ON projection.task_board_fence FOR SELECT TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_fence_insert
    ON projection.task_board_fence FOR INSERT TO projection_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_fence_update
    ON projection.task_board_fence FOR UPDATE TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE projection.task_board_publication_outcome ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection.task_board_publication_outcome FORCE ROW LEVEL SECURITY;
CREATE POLICY task_board_publication_outcome_select
    ON projection.task_board_publication_outcome FOR SELECT TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_publication_outcome_insert
    ON projection.task_board_publication_outcome FOR INSERT TO projection_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE projection.task_board_failure ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection.task_board_failure FORCE ROW LEVEL SECURITY;
CREATE POLICY task_board_failure_select
    ON projection.task_board_failure FOR SELECT TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_failure_insert
    ON projection.task_board_failure FOR INSERT TO projection_app
    WITH CHECK (recorded_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
