-- IM-03 WI-11 (issue #67): rebuildable Project Board projection.
--
-- The projection schema deliberately has no module owner role. This migration
-- runs as the controlled migration user, while runtime access is restricted
-- to projection_app and the transaction-scoped RLS context. Projection rows
-- are populated from validated Snapshot Export/Event Delta inputs; this file
-- creates no cross-schema foreign key and grants no EnterpriseProject access.

REVOKE CREATE ON SCHEMA projection FROM PUBLIC;

CREATE TABLE projection.project_board_projection_version (
    projection_version_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    status text NOT NULL,
    source_snapshot_hash bytea NOT NULL,
    source_event_id uuid,
    source_sequence bigint NOT NULL,
    source_recorded_at timestamptz NOT NULL,
    row_count integer NOT NULL,
    domain_checksum bytea NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    ready_at timestamptz,
    failure_code text,
    CONSTRAINT project_board_projection_version_scope_unique
        UNIQUE (enterprise_id, project_id, projection_version_id),
    CONSTRAINT project_board_projection_version_status_closed CHECK (
        status IN ('BUILDING', 'READY', 'FAILED')),
    CONSTRAINT project_board_projection_version_sequence_nonnegative CHECK (
        source_sequence >= 0),
    CONSTRAINT project_board_projection_version_row_count_nonnegative CHECK (
        row_count >= 0),
    CONSTRAINT project_board_projection_version_snapshot_hash_len CHECK (
        octet_length(source_snapshot_hash) = 32),
    CONSTRAINT project_board_projection_version_checksum_len CHECK (
        octet_length(domain_checksum) = 32),
    CONSTRAINT project_board_projection_version_status_shape CHECK (
        (status = 'BUILDING' AND ready_at IS NULL AND failure_code IS NULL)
        OR (status = 'READY' AND ready_at IS NOT NULL AND failure_code IS NULL)
        OR (status = 'FAILED' AND ready_at IS NULL AND failure_code IS NOT NULL))
);

CREATE TABLE projection.project_board (
    projection_version_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    delivery_item_id uuid NOT NULL,
    item_key text NOT NULL,
    item_type text NOT NULL,
    title text NOT NULL,
    commitment_status text NOT NULL,
    execution_status text NOT NULL,
    completion_evaluation_ref jsonb,
    blocker_refs jsonb NOT NULL,
    source_event_id uuid,
    source_sequence bigint NOT NULL,
    source_recorded_at timestamptz NOT NULL,
    PRIMARY KEY (projection_version_id, delivery_item_id),
    CONSTRAINT project_board_scope_version_fk
        FOREIGN KEY (enterprise_id, project_id, projection_version_id)
        REFERENCES projection.project_board_projection_version
            (enterprise_id, project_id, projection_version_id)
        ON DELETE RESTRICT,
    CONSTRAINT project_board_text_nonempty CHECK (
        length(item_key) > 0 AND length(item_type) > 0 AND length(title) > 0),
    CONSTRAINT project_board_status_closed CHECK (
        commitment_status IN ('PROPOSED', 'APPROVED', 'CANCELLED', 'REPLACED')
        AND execution_status IN ('NOT_READY', 'READY', 'IN_PROGRESS', 'BLOCKED',
                                 'IN_REVIEW', 'APPROVED_OUTPUT', 'RELEASED', 'COMPLETED')),
    CONSTRAINT project_board_blocker_refs_array CHECK (
        jsonb_typeof(blocker_refs) = 'array'),
    CONSTRAINT project_board_sequence_nonnegative CHECK (source_sequence >= 0)
);

CREATE TABLE projection.project_board_read_alias (
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    projection_version_id uuid NOT NULL,
    switched_at timestamptz NOT NULL DEFAULT now(),
    switched_by_principal_id uuid NOT NULL,
    PRIMARY KEY (enterprise_id, project_id),
    CONSTRAINT project_board_read_alias_version_fk
        FOREIGN KEY (enterprise_id, project_id, projection_version_id)
        REFERENCES projection.project_board_projection_version
            (enterprise_id, project_id, projection_version_id)
        ON DELETE RESTRICT
);

CREATE TABLE projection.projection_source_state (
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    latest_event_id uuid,
    latest_sequence bigint NOT NULL,
    observed_at timestamptz NOT NULL,
    updated_by_principal_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (enterprise_id, project_id),
    CONSTRAINT projection_source_state_sequence_nonnegative CHECK (
        latest_sequence >= 0)
);

CREATE TABLE projection.projection_checkpoint (
    consumer_name text NOT NULL,
    partition text NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    last_event_id uuid,
    last_sequence bigint NOT NULL,
    target_event_id uuid,
    target_sequence bigint NOT NULL,
    status text NOT NULL,
    updated_by_principal_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer_name, partition, enterprise_id, project_id),
    CONSTRAINT projection_checkpoint_partition_nonempty CHECK (length(partition) > 0),
    CONSTRAINT projection_checkpoint_partition_scope CHECK (partition = project_id::text),
    CONSTRAINT projection_checkpoint_sequence_nonnegative CHECK (
        last_sequence >= 0 AND target_sequence >= 0 AND target_sequence >= last_sequence),
    CONSTRAINT projection_checkpoint_status_closed CHECK (
        status IN ('ACTIVE', 'PAUSED', 'REBUILDING', 'FAILED'))
);

CREATE TABLE projection.projection_failure (
    failure_id uuid PRIMARY KEY,
    consumer_name text NOT NULL,
    partition text NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    event_id uuid,
    event_type text NOT NULL,
    failure_code text NOT NULL,
    safe_summary text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    recorded_by_principal_id uuid NOT NULL,
    CONSTRAINT projection_failure_text_nonempty CHECK (
        length(consumer_name) > 0 AND length(partition) > 0
        AND length(event_type) > 0 AND length(failure_code) > 0
        AND length(safe_summary) > 0),
    CONSTRAINT projection_failure_partition_scope CHECK (partition = project_id::text)
);

CREATE INDEX project_board_query_idx
    ON projection.project_board
        (enterprise_id, project_id, projection_version_id, item_key, delivery_item_id);
CREATE INDEX projection_version_project_idx
    ON projection.project_board_projection_version
        (enterprise_id, project_id, created_at DESC);
CREATE INDEX projection_checkpoint_project_idx
    ON projection.projection_checkpoint
        (enterprise_id, project_id, consumer_name, partition);
CREATE INDEX projection_failure_project_idx
    ON projection.projection_failure
        (enterprise_id, project_id, recorded_at DESC);

CREATE FUNCTION projection.guard_project_board_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'project_board projection rows are immutable' USING ERRCODE = '23514';
END
$guard$;

CREATE FUNCTION projection.guard_projection_failure_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'projection_failure rows are immutable' USING ERRCODE = '23514';
END
$guard$;

CREATE FUNCTION projection.guard_scope_and_watermark() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
        RAISE EXCEPTION 'projection scope is immutable' USING ERRCODE = '23514';
    END IF;

    IF TG_TABLE_NAME = 'project_board_read_alias' THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'projection_source_state' THEN
        IF NEW.latest_sequence < OLD.latest_sequence THEN
            RAISE EXCEPTION 'projection source watermark cannot move backwards'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.latest_sequence = OLD.latest_sequence
           AND NEW.latest_event_id IS DISTINCT FROM OLD.latest_event_id THEN
            RAISE EXCEPTION 'projection source sequence is bound to another event'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'projection_checkpoint' THEN
        IF NEW.consumer_name IS DISTINCT FROM OLD.consumer_name
           OR NEW.partition IS DISTINCT FROM OLD.partition THEN
            RAISE EXCEPTION 'projection checkpoint identity is immutable'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.last_sequence < OLD.last_sequence
           OR NEW.target_sequence < OLD.target_sequence THEN
            RAISE EXCEPTION 'projection checkpoint watermark cannot move backwards'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.last_sequence = OLD.last_sequence
           AND NEW.last_event_id IS DISTINCT FROM OLD.last_event_id THEN
            RAISE EXCEPTION 'projection checkpoint last sequence is bound to another event'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.target_sequence = OLD.target_sequence
           AND NEW.target_event_id IS DISTINCT FROM OLD.target_event_id THEN
            RAISE EXCEPTION 'projection checkpoint target sequence is bound to another event'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION projection.guard_scope_and_watermark() FROM PUBLIC;

CREATE FUNCTION projection.guard_projection_version_transition() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF OLD.enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR OLD.project_id IS DISTINCT FROM NEW.project_id
       OR OLD.source_snapshot_hash IS DISTINCT FROM NEW.source_snapshot_hash
       OR OLD.source_event_id IS DISTINCT FROM NEW.source_event_id
       OR OLD.source_sequence IS DISTINCT FROM NEW.source_sequence
       OR OLD.source_recorded_at IS DISTINCT FROM NEW.source_recorded_at
       OR OLD.row_count IS DISTINCT FROM NEW.row_count
       OR OLD.domain_checksum IS DISTINCT FROM NEW.domain_checksum
       OR OLD.created_by_principal_id IS DISTINCT FROM NEW.created_by_principal_id
       OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'projection version identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD.status <> 'BUILDING' OR NEW.status NOT IN ('READY', 'FAILED') THEN
        RAISE EXCEPTION 'projection version transition is invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE TRIGGER project_board_immutable_guard
    BEFORE UPDATE OR DELETE ON projection.project_board
    FOR EACH ROW EXECUTE FUNCTION projection.guard_project_board_immutable();
CREATE TRIGGER projection_failure_immutable_guard
    BEFORE UPDATE OR DELETE ON projection.projection_failure
    FOR EACH ROW EXECUTE FUNCTION projection.guard_projection_failure_immutable();
CREATE TRIGGER projection_version_transition_guard
    BEFORE UPDATE ON projection.project_board_projection_version
    FOR EACH ROW EXECUTE FUNCTION projection.guard_projection_version_transition();
CREATE TRIGGER project_board_read_alias_scope_guard
    BEFORE UPDATE ON projection.project_board_read_alias
    FOR EACH ROW EXECUTE FUNCTION projection.guard_scope_and_watermark();
CREATE TRIGGER projection_source_state_scope_guard
    BEFORE UPDATE ON projection.projection_source_state
    FOR EACH ROW EXECUTE FUNCTION projection.guard_scope_and_watermark();
CREATE TRIGGER projection_checkpoint_scope_guard
    BEFORE UPDATE ON projection.projection_checkpoint
    FOR EACH ROW EXECUTE FUNCTION projection.guard_scope_and_watermark();

REVOKE ALL ON TABLE
    projection.project_board_projection_version,
    projection.project_board,
    projection.project_board_read_alias,
    projection.projection_source_state,
    projection.projection_checkpoint,
    projection.projection_failure
    FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON
    projection.project_board_projection_version,
    projection.project_board_read_alias,
    projection.projection_source_state,
    projection.projection_checkpoint
    TO projection_app;
GRANT SELECT, INSERT ON
    projection.project_board,
    projection.projection_failure
    TO projection_app;
REVOKE DELETE ON
    projection.project_board_projection_version,
    projection.project_board,
    projection.project_board_read_alias,
    projection.projection_source_state,
    projection.projection_checkpoint,
    projection.projection_failure
    FROM projection_app;
REVOKE UPDATE ON projection.project_board, projection.projection_failure FROM projection_app;
REVOKE UPDATE ON projection.project_board_projection_version FROM projection_app;
GRANT UPDATE (status, ready_at, failure_code)
    ON projection.project_board_projection_version TO projection_app;

ALTER TABLE projection.project_board_projection_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection.project_board_projection_version FORCE ROW LEVEL SECURITY;
CREATE POLICY project_board_projection_version_select
    ON projection.project_board_projection_version FOR SELECT TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY project_board_projection_version_insert
    ON projection.project_board_projection_version FOR INSERT TO projection_app
    WITH CHECK (created_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY project_board_projection_version_update
    ON projection.project_board_projection_version FOR UPDATE TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE projection.project_board ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection.project_board FORCE ROW LEVEL SECURITY;
CREATE POLICY project_board_select
    ON projection.project_board FOR SELECT TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY project_board_insert
    ON projection.project_board FOR INSERT TO projection_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE projection.project_board_read_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection.project_board_read_alias FORCE ROW LEVEL SECURITY;
CREATE POLICY project_board_read_alias_select
    ON projection.project_board_read_alias FOR SELECT TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY project_board_read_alias_insert
    ON projection.project_board_read_alias FOR INSERT TO projection_app
    WITH CHECK (switched_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY project_board_read_alias_update
    ON projection.project_board_read_alias FOR UPDATE TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (switched_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE projection.projection_source_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection.projection_source_state FORCE ROW LEVEL SECURITY;
CREATE POLICY projection_source_state_select
    ON projection.projection_source_state FOR SELECT TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY projection_source_state_insert
    ON projection.projection_source_state FOR INSERT TO projection_app
    WITH CHECK (updated_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY projection_source_state_update
    ON projection.projection_source_state FOR UPDATE TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (updated_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE projection.projection_checkpoint ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection.projection_checkpoint FORCE ROW LEVEL SECURITY;
CREATE POLICY projection_checkpoint_select
    ON projection.projection_checkpoint FOR SELECT TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY projection_checkpoint_insert
    ON projection.projection_checkpoint FOR INSERT TO projection_app
    WITH CHECK (updated_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY projection_checkpoint_update
    ON projection.projection_checkpoint FOR UPDATE TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (updated_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE projection.projection_failure ENABLE ROW LEVEL SECURITY;
ALTER TABLE projection.projection_failure FORCE ROW LEVEL SECURITY;
CREATE POLICY projection_failure_select
    ON projection.projection_failure FOR SELECT TO projection_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY projection_failure_insert
    ON projection.projection_failure FOR INSERT TO projection_app
    WITH CHECK (recorded_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

RESET ROLE;
