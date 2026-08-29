-- IM-04 WI-05 (issue #94): immutable Artifact Revisions, same-Artifact
-- lineage relations, Branch head CAS and append-only governance facts.
-- This migration is forward-only. V4000, V4001 and V4002 remain unchanged.
-- Canonical bodies stay in Object Storage; PostgreSQL stores only exact
-- immutable identity snapshots and auditable references.

SET ROLE artifact_owner;

-- ---------------------------------------------------------------------------
-- Immutable Revision snapshot and same-Artifact parent relation
-- ---------------------------------------------------------------------------

CREATE TABLE artifact.artifact_revision (
    revision_id uuid PRIMARY KEY,
    artifact_id uuid NOT NULL,
    branch_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    revision_no bigint NOT NULL,
    revision_kind text NOT NULL,
    content_object_id uuid NOT NULL,
    content_type text NOT NULL,
    object_locator text NOT NULL,
    content_hash bytea NOT NULL,
    structure_schema_ref jsonb NOT NULL,
    canonicalization_version text NOT NULL,
    byte_size bigint NOT NULL,
    media_type text NOT NULL,
    semantic_metadata jsonb NOT NULL,
    changed_units jsonb NOT NULL,
    change_summary text NOT NULL,
    provenance jsonb NOT NULL,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    sealed_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT artifact_revision_artifact_fk FOREIGN KEY (artifact_id)
        REFERENCES artifact.artifact (artifact_id) ON DELETE RESTRICT,
    CONSTRAINT artifact_revision_branch_fk FOREIGN KEY (branch_id)
        REFERENCES artifact.artifact_branch (branch_id) ON DELETE RESTRICT,
    CONSTRAINT artifact_revision_content_object_fk FOREIGN KEY (content_object_id)
        REFERENCES artifact.artifact_content_object (content_object_id) ON DELETE RESTRICT,
    CONSTRAINT artifact_revision_revision_no_positive CHECK (revision_no >= 1),
    CONSTRAINT artifact_revision_kind_closed CHECK (
        revision_kind IN ('INITIAL', 'ORDINARY', 'MERGE')),
    CONSTRAINT artifact_revision_content_type_closed CHECK (
        content_type IN ('STRUCTURED_DOCUMENT', 'WORKBOOK_SPEC')),
    CONSTRAINT artifact_revision_hash_len CHECK (octet_length(content_hash) = 32),
    CONSTRAINT artifact_revision_canonicalization_closed CHECK (
        canonicalization_version = '1'),
    CONSTRAINT artifact_revision_size_nonnegative CHECK (byte_size >= 0),
    CONSTRAINT artifact_revision_media_type_shape CHECK (
        media_type ~ '^[^/[:space:]]+/[^/[:space:]]+$'),
    CONSTRAINT artifact_revision_locator_shape CHECK (
        object_locator ~ '^[a-z0-9][a-z0-9._-]*(/[A-Za-z0-9._-]+)+$'),
    CONSTRAINT artifact_revision_schema_ref_object CHECK (
        jsonb_typeof(structure_schema_ref) = 'object'),
    CONSTRAINT artifact_revision_semantic_metadata_json CHECK (
        semantic_metadata IS NOT NULL),
    CONSTRAINT artifact_revision_changed_units_array CHECK (
        jsonb_typeof(changed_units) = 'array' AND jsonb_array_length(changed_units) > 0),
    CONSTRAINT artifact_revision_provenance_object CHECK (
        jsonb_typeof(provenance) = 'object'),
    CONSTRAINT artifact_revision_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT artifact_revision_number_unique UNIQUE (artifact_id, revision_no)
);

CREATE INDEX artifact_revision_scope_idx
    ON artifact.artifact_revision (enterprise_id, project_id, artifact_id, revision_no);
CREATE INDEX artifact_revision_artifact_idx
    ON artifact.artifact_revision (artifact_id, revision_no);
CREATE INDEX artifact_revision_content_hash_idx
    ON artifact.artifact_revision (enterprise_id, content_hash);

CREATE TABLE artifact.revision_parent (
    artifact_id uuid NOT NULL,
    child_revision_id uuid NOT NULL,
    parent_revision_id uuid NOT NULL,
    parent_order integer NOT NULL,
    relation_kind text NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT revision_parent_pkey PRIMARY KEY (child_revision_id, parent_revision_id),
    CONSTRAINT revision_parent_child_fk FOREIGN KEY (child_revision_id)
        REFERENCES artifact.artifact_revision (revision_id) ON DELETE RESTRICT,
    CONSTRAINT revision_parent_parent_fk FOREIGN KEY (parent_revision_id)
        REFERENCES artifact.artifact_revision (revision_id) ON DELETE RESTRICT,
    CONSTRAINT revision_parent_order_nonnegative CHECK (parent_order >= 0),
    CONSTRAINT revision_parent_relation_kind_closed CHECK (
        relation_kind IN ('ORDINARY', 'MERGE')),
    CONSTRAINT revision_parent_scope_project_shape CHECK (
        project_id IS NULL OR enterprise_id IS NOT NULL),
    CONSTRAINT revision_parent_child_not_self CHECK (
        child_revision_id <> parent_revision_id),
    CONSTRAINT revision_parent_order_unique UNIQUE (child_revision_id, parent_order)
);

CREATE INDEX revision_parent_parent_idx
    ON artifact.revision_parent (parent_revision_id, child_revision_id);
CREATE INDEX revision_parent_scope_idx
    ON artifact.revision_parent (enterprise_id, project_id, child_revision_id);

-- ---------------------------------------------------------------------------
-- Conflict and governance facts
-- ---------------------------------------------------------------------------

CREATE TABLE artifact.revision_conflict (
    conflict_id uuid PRIMARY KEY,
    artifact_id uuid NOT NULL,
    branch_id uuid,
    revision_id uuid,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    conflict_kind text NOT NULL,
    base_revision_ref jsonb,
    head_revision_ref jsonb,
    candidate_revision_ref jsonb,
    conflict_set jsonb NOT NULL DEFAULT '[]'::jsonb,
    conflict_payload jsonb NOT NULL,
    conflict_hash bytea NOT NULL,
    resolution_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    resolved_by_ref jsonb,
    resolved_at timestamptz,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT revision_conflict_artifact_fk FOREIGN KEY (artifact_id)
        REFERENCES artifact.artifact (artifact_id) ON DELETE RESTRICT,
    CONSTRAINT revision_conflict_branch_fk FOREIGN KEY (branch_id)
        REFERENCES artifact.artifact_branch (branch_id) ON DELETE RESTRICT,
    CONSTRAINT revision_conflict_revision_fk FOREIGN KEY (revision_id)
        REFERENCES artifact.artifact_revision (revision_id) ON DELETE RESTRICT,
    CONSTRAINT revision_conflict_kind_closed CHECK (
        conflict_kind IN ('BRANCH_HEAD_CAS', 'MERGE')),
    CONSTRAINT revision_conflict_hash_len CHECK (octet_length(conflict_hash) = 32),
    CONSTRAINT revision_conflict_set_array CHECK (jsonb_typeof(conflict_set) = 'array'),
    CONSTRAINT revision_conflict_payload_object CHECK (
        jsonb_typeof(conflict_payload) = 'object'),
    CONSTRAINT revision_conflict_resolution_array CHECK (
        jsonb_typeof(resolution_refs) = 'array'),
    CONSTRAINT revision_conflict_resolution_shape CHECK (
        (resolved_at IS NULL AND resolved_by_ref IS NULL)
        OR (resolved_at IS NOT NULL AND jsonb_typeof(resolved_by_ref) = 'object'))
);

CREATE INDEX revision_conflict_scope_idx
    ON artifact.revision_conflict (enterprise_id, project_id, artifact_id, created_at DESC);
CREATE INDEX revision_conflict_revision_idx
    ON artifact.revision_conflict (revision_id, created_at DESC);

CREATE TABLE artifact.revision_withdrawal (
    withdrawal_id uuid PRIMARY KEY,
    revision_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    revision_ref jsonb NOT NULL,
    revision_hash bytea NOT NULL,
    withdrawal_reason jsonb NOT NULL,
    impact_assessment_ref jsonb,
    withdrawn_at timestamptz NOT NULL,
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    recorded_authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT revision_withdrawal_revision_fk FOREIGN KEY (revision_id)
        REFERENCES artifact.artifact_revision (revision_id) ON DELETE RESTRICT,
    CONSTRAINT revision_withdrawal_artifact_fk FOREIGN KEY (artifact_id)
        REFERENCES artifact.artifact (artifact_id) ON DELETE RESTRICT,
    CONSTRAINT revision_withdrawal_hash_len CHECK (octet_length(revision_hash) = 32),
    CONSTRAINT revision_withdrawal_reason_object CHECK (
        jsonb_typeof(withdrawal_reason) = 'object'),
    CONSTRAINT revision_withdrawal_unique UNIQUE (revision_id)
);

CREATE INDEX revision_withdrawal_scope_idx
    ON artifact.revision_withdrawal (enterprise_id, project_id, artifact_id, recorded_at DESC);

CREATE TABLE artifact.revision_invalidation (
    invalidation_id uuid PRIMARY KEY,
    revision_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    revision_ref jsonb NOT NULL,
    revision_hash bytea NOT NULL,
    invalidation_reason jsonb NOT NULL,
    impact_assessment_ref jsonb NOT NULL,
    invalidated_at timestamptz NOT NULL,
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    recorded_authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT revision_invalidation_revision_fk FOREIGN KEY (revision_id)
        REFERENCES artifact.artifact_revision (revision_id) ON DELETE RESTRICT,
    CONSTRAINT revision_invalidation_artifact_fk FOREIGN KEY (artifact_id)
        REFERENCES artifact.artifact (artifact_id) ON DELETE RESTRICT,
    CONSTRAINT revision_invalidation_hash_len CHECK (octet_length(revision_hash) = 32),
    CONSTRAINT revision_invalidation_reason_object CHECK (
        jsonb_typeof(invalidation_reason) = 'object'),
    CONSTRAINT revision_invalidation_impact_object CHECK (
        jsonb_typeof(impact_assessment_ref) = 'object'),
    CONSTRAINT revision_invalidation_unique UNIQUE (revision_id)
);

CREATE INDEX revision_invalidation_scope_idx
    ON artifact.revision_invalidation (enterprise_id, project_id, artifact_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- Database guards
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION artifact.guard_artifact_branch_update() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
DECLARE
    trusted_decision_id uuid;
BEGIN
    IF NEW.branch_id IS DISTINCT FROM OLD.branch_id
       OR NEW.artifact_id IS DISTINCT FROM OLD.artifact_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.branch_name IS DISTINCT FROM OLD.branch_name
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.created_authorization_decision_id IS DISTINCT FROM OLD.created_authorization_decision_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'artifact branch identity is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.lifecycle_status = 'ACTIVE' AND NEW.lifecycle_status = 'ACTIVE' THEN
        IF NEW.head_version <> OLD.head_version + 1 THEN
            RAISE EXCEPTION 'artifact branch head version must advance by one'
                USING ERRCODE = '23514';
        END IF;
    ELSIF OLD.lifecycle_status = 'ACTIVE' AND NEW.lifecycle_status = 'ARCHIVED' THEN
        IF NEW.working_head_ref IS DISTINCT FROM OLD.working_head_ref
           OR NEW.head_version IS DISTINCT FROM OLD.head_version THEN
            RAISE EXCEPTION 'archiving a branch cannot rewrite its working head'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        RAISE EXCEPTION 'artifact branch lifecycle transition is not allowed'
            USING ERRCODE = '23514';
    END IF;
    SELECT decision_id
      INTO trusted_decision_id
      FROM platform_security.context_authorization_decision_ref();
    IF NEW.updated_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR NEW.updated_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR NEW.last_authorization_decision_id IS DISTINCT FROM trusted_decision_id
       OR NEW.last_command_id IS NOT DISTINCT FROM OLD.last_command_id THEN
        RAISE EXCEPTION 'artifact branch update attribution is invalid'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION artifact.guard_artifact_revision_insert() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR NEW.created_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'artifact revision attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF (NEW.project_id IS NULL AND NOT platform_security.context_allows_enterprise(NEW.enterprise_id))
       OR (NEW.project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(NEW.enterprise_id, NEW.project_id)) THEN
        RAISE EXCEPTION 'artifact revision scope is not allowed'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION artifact.guard_revision_parent_insert() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
DECLARE
    child_artifact_id uuid;
    child_enterprise_id uuid;
    child_project_id uuid;
    parent_artifact_id uuid;
    parent_enterprise_id uuid;
    parent_project_id uuid;
BEGIN
    SELECT artifact_id, enterprise_id, project_id
      INTO child_artifact_id, child_enterprise_id, child_project_id
      FROM artifact.artifact_revision
     WHERE revision_id = NEW.child_revision_id;
    SELECT artifact_id, enterprise_id, project_id
      INTO parent_artifact_id, parent_enterprise_id, parent_project_id
      FROM artifact.artifact_revision
     WHERE revision_id = NEW.parent_revision_id;
    IF child_artifact_id IS NULL OR parent_artifact_id IS NULL
       OR child_artifact_id IS DISTINCT FROM parent_artifact_id
       OR child_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR child_project_id IS DISTINCT FROM NEW.project_id
       OR parent_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR parent_project_id IS DISTINCT FROM NEW.project_id THEN
        RAISE EXCEPTION 'revision parent scope or artifact does not match'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR NEW.created_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'revision parent attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION artifact.guard_revision_fact_insert() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR NEW.created_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'revision conflict attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF (NEW.project_id IS NULL AND NOT platform_security.context_allows_enterprise(NEW.enterprise_id))
       OR (NEW.project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(NEW.enterprise_id, NEW.project_id)) THEN
        RAISE EXCEPTION 'revision conflict scope is not allowed'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION artifact.guard_governance_fact_insert() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.recorded_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR NEW.recorded_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR NEW.recorded_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'revision governance attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF (NEW.project_id IS NULL AND NOT platform_security.context_allows_enterprise(NEW.enterprise_id))
       OR (NEW.project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(NEW.enterprise_id, NEW.project_id)) THEN
        RAISE EXCEPTION 'revision governance scope is not allowed'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION artifact.guard_revision_immutable() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'artifact revision facts are append-only'
        USING ERRCODE = '55000';
END
$guard$;

CREATE FUNCTION artifact.guard_revision_fact_immutable() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'revision relations and governance facts are append-only'
        USING ERRCODE = '55000';
END
$guard$;

CREATE TRIGGER artifact_revision_insert_guard
    BEFORE INSERT ON artifact.artifact_revision
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_artifact_revision_insert();
CREATE TRIGGER artifact_revision_immutable_guard
    BEFORE UPDATE OR DELETE ON artifact.artifact_revision
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_revision_immutable();
CREATE TRIGGER revision_parent_insert_guard
    BEFORE INSERT ON artifact.revision_parent
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_revision_parent_insert();
CREATE TRIGGER revision_parent_immutable_guard
    BEFORE UPDATE OR DELETE ON artifact.revision_parent
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_revision_fact_immutable();
CREATE TRIGGER revision_conflict_insert_guard
    BEFORE INSERT ON artifact.revision_conflict
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_revision_fact_insert();
CREATE TRIGGER revision_conflict_immutable_guard
    BEFORE UPDATE OR DELETE ON artifact.revision_conflict
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_revision_fact_immutable();
CREATE TRIGGER revision_withdrawal_insert_guard
    BEFORE INSERT ON artifact.revision_withdrawal
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_governance_fact_insert();
CREATE TRIGGER revision_withdrawal_immutable_guard
    BEFORE UPDATE OR DELETE ON artifact.revision_withdrawal
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_revision_fact_immutable();
CREATE TRIGGER revision_invalidation_insert_guard
    BEFORE INSERT ON artifact.revision_invalidation
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_governance_fact_insert();
CREATE TRIGGER revision_invalidation_immutable_guard
    BEFORE UPDATE OR DELETE ON artifact.revision_invalidation
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_revision_fact_immutable();

-- ---------------------------------------------------------------------------
-- Owner write boundaries
-- ---------------------------------------------------------------------------

CREATE FUNCTION artifact.create_artifact_revision(
    p_revision_id uuid,
    p_artifact_id uuid,
    p_branch_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_revision_kind text,
    p_content_object_id uuid,
    p_content_type text,
    p_object_locator text,
    p_content_hash bytea,
    p_structure_schema_ref jsonb,
    p_canonicalization_version text,
    p_byte_size bigint,
    p_media_type text,
    p_semantic_metadata jsonb,
    p_changed_units jsonb,
    p_change_summary text,
    p_provenance jsonb,
    p_parent_refs jsonb,
    p_merge_strategy text,
    p_conflict_set jsonb,
    p_conflict_resolution_refs jsonb,
    p_resolved_by_ref jsonb,
    p_conflict_id uuid,
    p_conflict_hash bytea,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, revision_no bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    root_enterprise_id uuid;
    root_project_id uuid;
    root_status text;
    branch_enterprise_id uuid;
    branch_project_id uuid;
    branch_status text;
    object_enterprise_id uuid;
    object_project_id uuid;
    object_state text;
    object_content_type text;
    object_locator text;
    object_hash bytea;
    object_byte_size bigint;
    object_media_type text;
    object_canonicalization_version text;
    existing_revision_id uuid;
    existing_link artifact.artifact_content_object_link%ROWTYPE;
    has_existing_link boolean := false;
    parent_ref jsonb;
    parent_id uuid;
    parent_ids uuid[] := ARRAY[]::uuid[];
    parent_artifact_id uuid;
    parent_enterprise_id uuid;
    parent_project_id uuid;
    parent_hash bytea;
    next_revision_no bigint;
    parent_order integer := 0;
BEGIN
    IF p_created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_created_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_created_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RETURN QUERY SELECT 'CONTEXT_REJECTED', NULL::bigint;
        RETURN;
    END IF;
    IF (p_project_id IS NULL AND NOT platform_security.context_allows_enterprise(p_enterprise_id))
       OR (p_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(p_enterprise_id, p_project_id)) THEN
        RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint;
        RETURN;
    END IF;

    SELECT a.enterprise_id, a.project_id, a.lifecycle_status
      INTO root_enterprise_id, root_project_id, root_status
      FROM artifact.artifact a
     WHERE a.artifact_id = p_artifact_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint;
        RETURN;
    END IF;
    IF root_enterprise_id IS DISTINCT FROM p_enterprise_id
       OR root_project_id IS DISTINCT FROM p_project_id THEN
        RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint;
        RETURN;
    END IF;
    IF root_status <> 'ACTIVE' THEN
        RETURN QUERY SELECT 'NOT_ACTIVE', NULL::bigint;
        RETURN;
    END IF;

    SELECT b.enterprise_id, b.project_id, b.lifecycle_status
      INTO branch_enterprise_id, branch_project_id, branch_status
      FROM artifact.artifact_branch b
     WHERE b.branch_id = p_branch_id
       AND b.artifact_id = p_artifact_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint;
        RETURN;
    END IF;
    IF branch_enterprise_id IS DISTINCT FROM p_enterprise_id
       OR branch_project_id IS DISTINCT FROM p_project_id THEN
        RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint;
        RETURN;
    END IF;
    IF branch_status <> 'ACTIVE' THEN
        RETURN QUERY SELECT 'NOT_ACTIVE', NULL::bigint;
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM artifact.artifact_revision WHERE revision_id = p_revision_id) THEN
        RETURN QUERY SELECT 'CONFLICT', NULL::bigint;
        RETURN;
    END IF;

    SELECT c.enterprise_id, c.project_id, c.storage_state, c.content_type,
           c.object_locator, c.content_hash, c.byte_size, c.media_type,
           c.canonicalization_version
      INTO object_enterprise_id, object_project_id, object_state, object_content_type,
           object_locator, object_hash, object_byte_size, object_media_type,
           object_canonicalization_version
      FROM artifact.artifact_content_object c
     WHERE c.content_object_id = p_content_object_id
     FOR SHARE;
    IF NOT FOUND
       OR object_enterprise_id IS DISTINCT FROM p_enterprise_id
       OR object_project_id IS DISTINCT FROM p_project_id THEN
        RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint;
        RETURN;
    END IF;
    IF object_state <> 'FROZEN' THEN
        RETURN QUERY SELECT 'CONTENT_NOT_FROZEN', NULL::bigint;
        RETURN;
    END IF;
    IF object_content_type IS DISTINCT FROM p_content_type
       OR object_locator IS DISTINCT FROM p_object_locator
       OR object_hash IS DISTINCT FROM p_content_hash
       OR object_byte_size IS DISTINCT FROM p_byte_size
       OR object_media_type IS DISTINCT FROM p_media_type
       OR object_canonicalization_version IS DISTINCT FROM p_canonicalization_version THEN
        RETURN QUERY SELECT 'CONTENT_HASH_MISMATCH', NULL::bigint;
        RETURN;
    END IF;

    SELECT l.*
      INTO existing_link
      FROM artifact.artifact_content_object_link l
     WHERE l.content_object_id = p_content_object_id
     FOR UPDATE;
    has_existing_link := FOUND;
    IF has_existing_link THEN
        IF existing_link.owner_object_type IS DISTINCT FROM 'ArtifactRevision'
           OR existing_link.owner_object_id IS DISTINCT FROM p_revision_id
           OR existing_link.owner_version_id IS DISTINCT FROM p_revision_id
           OR existing_link.enterprise_id IS DISTINCT FROM p_enterprise_id
           OR existing_link.project_id IS DISTINCT FROM p_project_id THEN
            RETURN QUERY SELECT 'CONTENT_LINK_CONFLICT', NULL::bigint;
            RETURN;
        END IF;
    END IF;

    IF jsonb_typeof(p_parent_refs) <> 'array' THEN
        RETURN QUERY SELECT 'PARENT_INVALID', NULL::bigint;
        RETURN;
    END IF;
    IF p_revision_kind = 'INITIAL' AND jsonb_array_length(p_parent_refs) <> 0 THEN
        RETURN QUERY SELECT 'PARENT_REQUIRED', NULL::bigint;
        RETURN;
    END IF;
    IF p_revision_kind = 'ORDINARY' AND jsonb_array_length(p_parent_refs) <> 1 THEN
        RETURN QUERY SELECT 'PARENT_REQUIRED', NULL::bigint;
        RETURN;
    END IF;
    IF p_revision_kind = 'MERGE' AND jsonb_array_length(p_parent_refs) < 2 THEN
        RETURN QUERY SELECT 'PARENT_REQUIRED', NULL::bigint;
        RETURN;
    END IF;
    IF p_revision_kind NOT IN ('INITIAL', 'ORDINARY', 'MERGE') THEN
        RETURN QUERY SELECT 'PARENT_INVALID', NULL::bigint;
        RETURN;
    END IF;
    IF p_revision_kind = 'MERGE' THEN
        IF p_merge_strategy IS NULL OR btrim(p_merge_strategy) = ''
           OR jsonb_typeof(p_conflict_set) IS DISTINCT FROM 'array'
           OR jsonb_typeof(p_conflict_resolution_refs) IS DISTINCT FROM 'array'
           OR p_resolved_by_ref IS NULL
           OR jsonb_typeof(p_resolved_by_ref) IS DISTINCT FROM 'object' THEN
            RETURN QUERY SELECT 'CONFLICT_INVALID', NULL::bigint;
            RETURN;
        END IF;
        IF jsonb_array_length(p_conflict_set) > 0
           AND jsonb_array_length(p_conflict_resolution_refs) = 0 THEN
            RETURN QUERY SELECT 'CONFLICT_INVALID', NULL::bigint;
            RETURN;
        END IF;
        IF jsonb_array_length(p_conflict_set) > 0
           AND (p_conflict_id IS NULL OR p_conflict_hash IS NULL
                OR octet_length(p_conflict_hash) <> 32) THEN
            RETURN QUERY SELECT 'CONFLICT_INVALID', NULL::bigint;
            RETURN;
        END IF;
    END IF;

    FOR parent_ref IN SELECT value FROM jsonb_array_elements(p_parent_refs) LOOP
        IF parent_ref->>'kind' IS DISTINCT FROM 'CONTENT_ADDRESSED'
           OR parent_ref->>'objectType' NOT IN ('ArtifactRevision', 'artifact.artifact_revision')
           OR parent_ref->>'objectId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           OR parent_ref->'scope'->>'enterpriseId' IS DISTINCT FROM p_enterprise_id::text
           OR (p_project_id IS NULL AND parent_ref->'scope'->>'projectId' IS NOT NULL)
           OR (p_project_id IS NOT NULL
               AND parent_ref->'scope'->>'projectId' IS DISTINCT FROM p_project_id::text)
           OR parent_ref->'contentHash'->>'algorithm' IS DISTINCT FROM 'SHA-256'
           OR parent_ref->'contentHash'->>'canonicalizationVersion' IS DISTINCT FROM '1'
           OR parent_ref->'contentHash'->>'digest' !~ '^[0-9a-f]{64}$' THEN
            RETURN QUERY SELECT 'PARENT_INVALID', NULL::bigint;
            RETURN;
        END IF;
        parent_id := (parent_ref->>'objectId')::uuid;
        IF parent_id = ANY(parent_ids) OR parent_id = p_revision_id THEN
            RETURN QUERY SELECT 'PARENT_DUPLICATE', NULL::bigint;
            RETURN;
        END IF;
        SELECT r.artifact_id, r.enterprise_id, r.project_id, r.content_hash
          INTO parent_artifact_id, parent_enterprise_id, parent_project_id, parent_hash
          FROM artifact.artifact_revision r
         WHERE r.revision_id = parent_id;
        IF NOT FOUND THEN
            RETURN QUERY SELECT 'PARENT_INVALID', NULL::bigint;
            RETURN;
        END IF;
        IF parent_artifact_id IS DISTINCT FROM p_artifact_id
           OR parent_enterprise_id IS DISTINCT FROM p_enterprise_id
           OR parent_project_id IS DISTINCT FROM p_project_id THEN
            RETURN QUERY SELECT 'CROSS_ARTIFACT_PARENT', NULL::bigint;
            RETURN;
        END IF;
        IF parent_ref->'contentHash'->>'digest' IS DISTINCT FROM encode(parent_hash, 'hex') THEN
            RETURN QUERY SELECT 'CONTENT_HASH_MISMATCH', NULL::bigint;
            RETURN;
        END IF;
        parent_ids := array_append(parent_ids, parent_id);
    END LOOP;

    IF EXISTS (
        WITH RECURSIVE ancestors(revision_id) AS (
            SELECT unnest(parent_ids)
            UNION
            SELECT rp.parent_revision_id
              FROM artifact.revision_parent rp
              JOIN ancestors a ON a.revision_id = rp.child_revision_id
        )
        SELECT 1 FROM ancestors WHERE revision_id = p_revision_id
    ) THEN
        RETURN QUERY SELECT 'LINEAGE_CYCLE', NULL::bigint;
        RETURN;
    END IF;

    SELECT coalesce(max(r.revision_no), 0) + 1
      INTO next_revision_no
      FROM artifact.artifact_revision r
     WHERE r.artifact_id = p_artifact_id;

    INSERT INTO artifact.artifact_revision (
        revision_id, artifact_id, branch_id, enterprise_id, project_id,
        revision_no, revision_kind, content_object_id, content_type,
        object_locator, content_hash, structure_schema_ref,
        canonicalization_version, byte_size, media_type, semantic_metadata,
        changed_units, change_summary, provenance, aggregate_version,
        created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_revision_id, p_artifact_id, p_branch_id, p_enterprise_id, p_project_id,
        next_revision_no, p_revision_kind, p_content_object_id, p_content_type,
        p_object_locator, p_content_hash, p_structure_schema_ref,
        p_canonicalization_version, p_byte_size, p_media_type, p_semantic_metadata,
        p_changed_units, p_change_summary, p_provenance, 1,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id);

    IF NOT has_existing_link THEN
        INSERT INTO artifact.artifact_content_object_link (
            content_object_id, owner_object_type, owner_object_id, owner_version_id,
            owner_payload_hash, enterprise_id, project_id, source_command_id)
        VALUES (
            p_content_object_id, 'ArtifactRevision', p_revision_id, p_revision_id,
            p_content_hash, p_enterprise_id, p_project_id, p_source_command_id);
    END IF;

    IF p_revision_kind <> 'INITIAL' THEN
        FOR parent_ref IN SELECT value FROM jsonb_array_elements(p_parent_refs) LOOP
            INSERT INTO artifact.revision_parent (
                artifact_id, child_revision_id, parent_revision_id, parent_order,
                relation_kind, enterprise_id, project_id, created_by_principal_id,
                created_by_actor_snapshot_id, created_authorization_decision_id,
                source_command_id)
            VALUES (
                p_artifact_id, p_revision_id, (parent_ref->>'objectId')::uuid,
                parent_order, p_revision_kind, p_enterprise_id, p_project_id,
                p_created_by_principal_id, p_created_by_actor_snapshot_id,
                p_created_authorization_decision_id, p_source_command_id);
            parent_order := parent_order + 1;
        END LOOP;
    END IF;

    IF p_revision_kind = 'MERGE' AND jsonb_array_length(p_conflict_set) > 0 THEN
        INSERT INTO artifact.revision_conflict (
            conflict_id, artifact_id, branch_id, revision_id, enterprise_id,
            project_id, conflict_kind, candidate_revision_ref, conflict_set,
            conflict_payload, conflict_hash, resolution_refs, resolved_by_ref,
            resolved_at, created_by_principal_id, created_by_actor_snapshot_id,
            created_authorization_decision_id, source_command_id)
        VALUES (
            p_conflict_id, p_artifact_id, p_branch_id, p_revision_id,
            p_enterprise_id, p_project_id, 'MERGE',
            jsonb_build_object('kind', 'CONTENT_ADDRESSED',
                               'objectType', 'ArtifactRevision',
                               'objectId', p_revision_id,
                               'scope', jsonb_build_object(
                                   'enterpriseId', p_enterprise_id,
                                   'projectId', p_project_id),
                               'contentHash', jsonb_build_object(
                                   'algorithm', 'SHA-256',
                                   'digest', encode(p_content_hash, 'hex'),
                                   'canonicalizationVersion', '1')),
            p_conflict_set, jsonb_build_object(
                'mergeStrategy', p_merge_strategy,
                'conflictSet', p_conflict_set,
                'resolutionRefs', p_conflict_resolution_refs),
            p_conflict_hash, p_conflict_resolution_refs, p_resolved_by_ref,
            clock_timestamp(), p_created_by_principal_id,
            p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
            p_source_command_id);
    END IF;
    RETURN QUERY SELECT 'OK', next_revision_no;
END
$fn$;

CREATE FUNCTION artifact.move_working_head(
    p_artifact_id uuid,
    p_branch_id uuid,
    p_expected_version bigint,
    p_expected_head_ref jsonb,
    p_new_head_ref jsonb,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_conflict_id uuid,
    p_conflict_payload jsonb,
    p_conflict_hash bytea,
    p_updated_by_principal_id uuid,
    p_updated_by_actor_snapshot_id uuid,
    p_last_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    branch artifact.artifact_branch%ROWTYPE;
    root_status text;
    candidate_id uuid;
    candidate_artifact_id uuid;
    candidate_branch_id uuid;
    candidate_enterprise_id uuid;
    candidate_project_id uuid;
    candidate_hash bytea;
BEGIN
    IF p_updated_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_updated_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_last_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'artifact branch head attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    SELECT b.* INTO branch
      FROM artifact.artifact_branch b
     WHERE b.branch_id = p_branch_id
       AND b.artifact_id = p_artifact_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    IF branch.enterprise_id IS DISTINCT FROM p_enterprise_id
       OR branch.project_id IS DISTINCT FROM p_project_id
       OR (p_project_id IS NULL AND NOT platform_security.context_allows_enterprise(p_enterprise_id))
       OR (p_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(p_enterprise_id, p_project_id)) THEN
        RETURN 'NOT_FOUND';
    END IF;
    SELECT a.lifecycle_status INTO root_status
      FROM artifact.artifact a
     WHERE a.artifact_id = p_artifact_id;
    IF root_status IS NULL THEN RETURN 'NOT_FOUND'; END IF;
    IF root_status <> 'ACTIVE' OR branch.lifecycle_status <> 'ACTIVE' THEN
        RETURN 'NOT_ACTIVE';
    END IF;
    IF p_new_head_ref IS NULL
       OR p_new_head_ref->>'kind' IS DISTINCT FROM 'CONTENT_ADDRESSED'
       OR p_new_head_ref->>'objectType' NOT IN ('ArtifactRevision', 'artifact.artifact_revision')
       OR p_new_head_ref->>'objectId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR p_new_head_ref->'scope'->>'enterpriseId' IS DISTINCT FROM p_enterprise_id::text
       OR (p_project_id IS NULL AND p_new_head_ref->'scope'->>'projectId' IS NOT NULL)
       OR (p_project_id IS NOT NULL
           AND p_new_head_ref->'scope'->>'projectId' IS DISTINCT FROM p_project_id::text)
       OR p_new_head_ref->'contentHash'->>'algorithm' IS DISTINCT FROM 'SHA-256'
       OR p_new_head_ref->'contentHash'->>'canonicalizationVersion' IS DISTINCT FROM '1'
       OR p_new_head_ref->'contentHash'->>'digest' !~ '^[0-9a-f]{64}$' THEN
        RETURN 'INVALID_REF';
    END IF;
    candidate_id := (p_new_head_ref->>'objectId')::uuid;
    SELECT r.artifact_id, r.branch_id, r.enterprise_id, r.project_id, r.content_hash
      INTO candidate_artifact_id, candidate_branch_id, candidate_enterprise_id,
           candidate_project_id, candidate_hash
      FROM artifact.artifact_revision r
     WHERE r.revision_id = candidate_id;
    IF NOT FOUND
       OR candidate_artifact_id IS DISTINCT FROM p_artifact_id
       OR candidate_branch_id IS DISTINCT FROM p_branch_id
       OR candidate_enterprise_id IS DISTINCT FROM p_enterprise_id
       OR candidate_project_id IS DISTINCT FROM p_project_id
       OR p_new_head_ref->'contentHash'->>'digest' IS DISTINCT FROM encode(candidate_hash, 'hex') THEN
        RETURN 'INVALID_REF';
    END IF;

    IF branch.head_version IS DISTINCT FROM p_expected_version
       OR branch.working_head_ref IS DISTINCT FROM p_expected_head_ref THEN
        INSERT INTO artifact.revision_conflict (
            conflict_id, artifact_id, branch_id, enterprise_id, project_id,
            conflict_kind, base_revision_ref, head_revision_ref,
            candidate_revision_ref, conflict_set, conflict_payload,
            conflict_hash, resolution_refs, created_by_principal_id,
            created_by_actor_snapshot_id, created_authorization_decision_id,
            source_command_id)
        VALUES (
            p_conflict_id, p_artifact_id, p_branch_id, p_enterprise_id, p_project_id,
            'BRANCH_HEAD_CAS', p_expected_head_ref, branch.working_head_ref,
            p_new_head_ref,
            jsonb_build_array(jsonb_build_object(
                'reasonCode', 'ARTIFACT_BRANCH_HEAD_CONFLICT',
                'expectedVersion', p_expected_version,
                'actualVersion', branch.head_version)),
            p_conflict_payload, p_conflict_hash, '[]'::jsonb,
            p_updated_by_principal_id, p_updated_by_actor_snapshot_id,
            p_last_authorization_decision_id, p_source_command_id);
        RETURN 'CONFLICT';
    END IF;
    IF branch.working_head_ref IS NOT DISTINCT FROM p_new_head_ref THEN
        RETURN 'ALREADY';
    END IF;
    UPDATE artifact.artifact_branch
       SET working_head_ref = p_new_head_ref,
           head_version = p_expected_version + 1,
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           last_authorization_decision_id = p_last_authorization_decision_id,
           last_command_id = p_source_command_id,
           updated_at = clock_timestamp()
     WHERE branch_id = p_branch_id;
    RETURN 'OK';
END
$fn$;

CREATE FUNCTION artifact.withdraw_revision(
    p_withdrawal_id uuid,
    p_revision_id uuid,
    p_artifact_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_revision_ref jsonb,
    p_revision_hash bytea,
    p_withdrawal_reason jsonb,
    p_impact_assessment_ref jsonb,
    p_withdrawn_at timestamptz,
    p_recorded_by_principal_id uuid,
    p_recorded_by_actor_snapshot_id uuid,
    p_recorded_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    revision_artifact_id uuid;
    revision_enterprise_id uuid;
    revision_project_id uuid;
    revision_hash bytea;
BEGIN
    SELECT r.artifact_id, r.enterprise_id, r.project_id, r.content_hash
      INTO revision_artifact_id, revision_enterprise_id, revision_project_id, revision_hash
      FROM artifact.artifact_revision r
     WHERE r.revision_id = p_revision_id
     FOR SHARE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    IF revision_artifact_id IS DISTINCT FROM p_artifact_id
       OR revision_enterprise_id IS DISTINCT FROM p_enterprise_id
       OR revision_project_id IS DISTINCT FROM p_project_id
       OR revision_hash IS DISTINCT FROM p_revision_hash THEN
        RETURN 'NOT_FOUND';
    END IF;
    IF (p_project_id IS NULL AND NOT platform_security.context_allows_enterprise(p_enterprise_id))
       OR (p_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(p_enterprise_id, p_project_id)) THEN
        RETURN 'NOT_FOUND';
    END IF;
    IF p_recorded_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_recorded_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_recorded_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'revision withdrawal attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM artifact.revision_withdrawal WHERE revision_id = p_revision_id) THEN
        RETURN 'ALREADY';
    END IF;
    INSERT INTO artifact.revision_withdrawal (
        withdrawal_id, revision_id, artifact_id, enterprise_id, project_id,
        revision_ref, revision_hash, withdrawal_reason, impact_assessment_ref,
        withdrawn_at, recorded_by_principal_id, recorded_by_actor_snapshot_id,
        recorded_authorization_decision_id, source_command_id)
    VALUES (
        p_withdrawal_id, p_revision_id, p_artifact_id, p_enterprise_id, p_project_id,
        p_revision_ref, p_revision_hash, p_withdrawal_reason, p_impact_assessment_ref,
        p_withdrawn_at, p_recorded_by_principal_id, p_recorded_by_actor_snapshot_id,
        p_recorded_authorization_decision_id, p_source_command_id);
    RETURN 'OK';
END
$fn$;

CREATE FUNCTION artifact.invalidate_revision(
    p_invalidation_id uuid,
    p_revision_id uuid,
    p_artifact_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_revision_ref jsonb,
    p_revision_hash bytea,
    p_invalidation_reason jsonb,
    p_impact_assessment_ref jsonb,
    p_invalidated_at timestamptz,
    p_recorded_by_principal_id uuid,
    p_recorded_by_actor_snapshot_id uuid,
    p_recorded_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    revision_artifact_id uuid;
    revision_enterprise_id uuid;
    revision_project_id uuid;
    revision_hash bytea;
BEGIN
    SELECT r.artifact_id, r.enterprise_id, r.project_id, r.content_hash
      INTO revision_artifact_id, revision_enterprise_id, revision_project_id, revision_hash
      FROM artifact.artifact_revision r
     WHERE r.revision_id = p_revision_id
     FOR SHARE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    IF revision_artifact_id IS DISTINCT FROM p_artifact_id
       OR revision_enterprise_id IS DISTINCT FROM p_enterprise_id
       OR revision_project_id IS DISTINCT FROM p_project_id
       OR revision_hash IS DISTINCT FROM p_revision_hash THEN
        RETURN 'NOT_FOUND';
    END IF;
    IF (p_project_id IS NULL AND NOT platform_security.context_allows_enterprise(p_enterprise_id))
       OR (p_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(p_enterprise_id, p_project_id)) THEN
        RETURN 'NOT_FOUND';
    END IF;
    IF p_recorded_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_recorded_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_recorded_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'revision invalidation attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF EXISTS (SELECT 1 FROM artifact.revision_invalidation WHERE revision_id = p_revision_id) THEN
        RETURN 'ALREADY';
    END IF;
    INSERT INTO artifact.revision_invalidation (
        invalidation_id, revision_id, artifact_id, enterprise_id, project_id,
        revision_ref, revision_hash, invalidation_reason, impact_assessment_ref,
        invalidated_at, recorded_by_principal_id, recorded_by_actor_snapshot_id,
        recorded_authorization_decision_id, source_command_id)
    VALUES (
        p_invalidation_id, p_revision_id, p_artifact_id, p_enterprise_id, p_project_id,
        p_revision_ref, p_revision_hash, p_invalidation_reason, p_impact_assessment_ref,
        p_invalidated_at, p_recorded_by_principal_id, p_recorded_by_actor_snapshot_id,
        p_recorded_authorization_decision_id, p_source_command_id);
    RETURN 'OK';
END
$fn$;

-- ---------------------------------------------------------------------------
-- Least privilege and RLS
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION artifact.guard_artifact_revision_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.guard_revision_parent_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.guard_revision_fact_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.guard_governance_fact_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.guard_revision_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.guard_revision_fact_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.create_artifact_revision(
    uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, bytea, jsonb, text,
    bigint, text, jsonb, jsonb, text, jsonb, jsonb, text, jsonb, jsonb, jsonb,
    uuid, bytea, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.move_working_head(
    uuid, uuid, bigint, jsonb, jsonb, uuid, uuid, uuid, jsonb, bytea, uuid, uuid,
    uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.withdraw_revision(
    uuid, uuid, uuid, uuid, uuid, jsonb, bytea, jsonb, jsonb, timestamptz, uuid,
    uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.invalidate_revision(
    uuid, uuid, uuid, uuid, uuid, jsonb, bytea, jsonb, jsonb, timestamptz, uuid,
    uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION artifact.create_artifact_revision(
    uuid, uuid, uuid, uuid, uuid, text, uuid, text, text, bytea, jsonb, text,
    bigint, text, jsonb, jsonb, text, jsonb, jsonb, text, jsonb, jsonb, jsonb,
    uuid, bytea, uuid, uuid, uuid, uuid) TO artifact_app;
GRANT EXECUTE ON FUNCTION artifact.move_working_head(
    uuid, uuid, bigint, jsonb, jsonb, uuid, uuid, uuid, jsonb, bytea, uuid, uuid,
    uuid, uuid) TO artifact_app;
GRANT EXECUTE ON FUNCTION artifact.withdraw_revision(
    uuid, uuid, uuid, uuid, uuid, jsonb, bytea, jsonb, jsonb, timestamptz, uuid,
    uuid, uuid, uuid) TO artifact_app;
GRANT EXECUTE ON FUNCTION artifact.invalidate_revision(
    uuid, uuid, uuid, uuid, uuid, jsonb, bytea, jsonb, jsonb, timestamptz, uuid,
    uuid, uuid, uuid) TO artifact_app;

ALTER TABLE artifact.artifact_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.artifact_revision FORCE ROW LEVEL SECURITY;
CREATE POLICY artifact_revision_select ON artifact.artifact_revision
    FOR SELECT TO artifact_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY artifact_revision_owner_all ON artifact.artifact_revision
    FOR ALL TO artifact_owner USING (true) WITH CHECK (true);

ALTER TABLE artifact.revision_parent ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.revision_parent FORCE ROW LEVEL SECURITY;
CREATE POLICY revision_parent_select ON artifact.revision_parent
    FOR SELECT TO artifact_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY revision_parent_owner_all ON artifact.revision_parent
    FOR ALL TO artifact_owner USING (true) WITH CHECK (true);

ALTER TABLE artifact.revision_conflict ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.revision_conflict FORCE ROW LEVEL SECURITY;
CREATE POLICY revision_conflict_select ON artifact.revision_conflict
    FOR SELECT TO artifact_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY revision_conflict_owner_all ON artifact.revision_conflict
    FOR ALL TO artifact_owner USING (true) WITH CHECK (true);

ALTER TABLE artifact.revision_withdrawal ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.revision_withdrawal FORCE ROW LEVEL SECURITY;
CREATE POLICY revision_withdrawal_select ON artifact.revision_withdrawal
    FOR SELECT TO artifact_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY revision_withdrawal_owner_all ON artifact.revision_withdrawal
    FOR ALL TO artifact_owner USING (true) WITH CHECK (true);

ALTER TABLE artifact.revision_invalidation ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.revision_invalidation FORCE ROW LEVEL SECURITY;
CREATE POLICY revision_invalidation_select ON artifact.revision_invalidation
    FOR SELECT TO artifact_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY revision_invalidation_owner_all ON artifact.revision_invalidation
    FOR ALL TO artifact_owner USING (true) WITH CHECK (true);

REVOKE ALL ON artifact.artifact_revision,
    artifact.revision_parent,
    artifact.revision_conflict,
    artifact.revision_withdrawal,
    artifact.revision_invalidation FROM artifact_app;
GRANT SELECT ON artifact.artifact_revision,
    artifact.revision_parent,
    artifact.revision_conflict,
    artifact.revision_withdrawal,
    artifact.revision_invalidation TO artifact_app;

RESET ROLE;
