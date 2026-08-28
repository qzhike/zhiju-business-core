-- IM-04 WI-03 (issue #92): Artifact business root, default Branch and
-- lifecycle boundary. This migration is forward-only and deliberately does
-- not create Revision, Content Object, Representation or Binding tables.
--
-- Business writes are exposed through Artifact-owned SECURITY DEFINER
-- functions. The runtime role can read rows through RLS, but cannot directly
-- UPDATE or DELETE the Root/Branch. The functions re-check the trusted
-- transaction Context before using the owner policy.

SET ROLE artifact_owner;

-- ---------------------------------------------------------------------------
-- Artifact Root
-- ---------------------------------------------------------------------------

CREATE TABLE artifact.artifact (
    artifact_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    business_scope text NOT NULL,
    origin_project_ref jsonb,
    artifact_type text NOT NULL,
    title text NOT NULL,
    classification text NOT NULL,
    identity_hash bytea NOT NULL,
    delivery_item_refs jsonb NOT NULL,
    metadata jsonb NOT NULL,
    lifecycle_status text NOT NULL DEFAULT 'ACTIVE',
    aggregate_version bigint NOT NULL DEFAULT 1,
    metadata_version bigint NOT NULL DEFAULT 1,
    default_branch_id uuid NOT NULL,
    approved_revision_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    effective_binding_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_by_principal_id uuid NOT NULL,
    updated_by_actor_snapshot_id uuid NOT NULL,
    last_authorization_decision_id uuid NOT NULL,
    last_command_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    archive_reason jsonb,
    retention_policy_ref jsonb,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT artifact_scope_closed CHECK (
        business_scope IN ('PROJECT_DELIVERABLE', 'ENTERPRISE_CONTROLLED')),
    CONSTRAINT artifact_lifecycle_closed CHECK (
        lifecycle_status IN ('ACTIVE', 'ARCHIVED', 'CANCELLED')),
    CONSTRAINT artifact_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT artifact_metadata_version_positive CHECK (metadata_version >= 1),
    CONSTRAINT artifact_identity_hash_len CHECK (octet_length(identity_hash) = 32),
    CONSTRAINT artifact_delivery_refs_array CHECK (jsonb_typeof(delivery_item_refs) = 'array'),
    CONSTRAINT artifact_approved_refs_array CHECK (jsonb_typeof(approved_revision_refs) = 'array'),
    CONSTRAINT artifact_effective_refs_array CHECK (jsonb_typeof(effective_binding_refs) = 'array'),
    CONSTRAINT artifact_scope_shape CHECK (
        (business_scope = 'PROJECT_DELIVERABLE' AND project_id IS NOT NULL)
        OR (business_scope = 'ENTERPRISE_CONTROLLED' AND project_id IS NULL)),
    CONSTRAINT artifact_origin_ref_shape CHECK ((
        (
            (business_scope = 'PROJECT_DELIVERABLE' AND origin_project_ref IS NOT NULL)
            OR business_scope = 'ENTERPRISE_CONTROLLED'
        )
        AND (
            origin_project_ref IS NULL
            OR (
                jsonb_typeof(origin_project_ref) = 'object'
                AND origin_project_ref->>'kind' = 'OBJECT'
                AND origin_project_ref->>'objectType' = 'Project'
                AND jsonb_typeof(origin_project_ref->'scope') = 'object'
                AND origin_project_ref->'scope'->>'enterpriseId' = enterprise_id::text
                AND origin_project_ref->>'objectId' IS NOT NULL
                AND origin_project_ref->'scope'->>'projectId' IS NOT NULL
                AND origin_project_ref->>'objectId' = origin_project_ref->'scope'->>'projectId'
                AND (
                    project_id IS NULL
                    OR origin_project_ref->'scope'->>'projectId' = project_id::text
                )
            )
        )
    ) IS TRUE),
    CONSTRAINT artifact_archive_shape CHECK ((
        (
            lifecycle_status = 'ARCHIVED'
            AND archived_at IS NOT NULL
            AND jsonb_typeof(archive_reason) = 'object'
            AND jsonb_typeof(retention_policy_ref) = 'object'
        )
        OR (
            lifecycle_status <> 'ARCHIVED'
            AND archived_at IS NULL
            AND archive_reason IS NULL
            AND retention_policy_ref IS NULL
        )
    ) IS TRUE)
);

CREATE UNIQUE INDEX artifact_identity_unique
    ON artifact.artifact (enterprise_id, identity_hash);
CREATE INDEX artifact_scope_status_idx
    ON artifact.artifact (enterprise_id, project_id, lifecycle_status, artifact_type);
CREATE INDEX artifact_type_status_idx
    ON artifact.artifact (enterprise_id, artifact_type, lifecycle_status);

-- ---------------------------------------------------------------------------
-- Branch identity and working-head placeholder
-- ---------------------------------------------------------------------------

CREATE TABLE artifact.artifact_branch (
    branch_id uuid PRIMARY KEY,
    artifact_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    branch_name text NOT NULL,
    working_head_ref jsonb,
    head_version bigint NOT NULL DEFAULT 0,
    lifecycle_status text NOT NULL DEFAULT 'ACTIVE',
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_by_principal_id uuid NOT NULL,
    updated_by_actor_snapshot_id uuid NOT NULL,
    last_authorization_decision_id uuid NOT NULL,
    last_command_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT artifact_branch_artifact_fk FOREIGN KEY (artifact_id)
        REFERENCES artifact.artifact (artifact_id) ON DELETE RESTRICT,
    CONSTRAINT artifact_branch_name_nonempty CHECK (length(btrim(branch_name)) > 0),
    CONSTRAINT artifact_branch_name_shape CHECK (branch_name ~ '^[a-z][a-z0-9._-]*$'),
    CONSTRAINT artifact_branch_head_version_nonnegative CHECK (head_version >= 0),
    CONSTRAINT artifact_branch_lifecycle_closed CHECK (
        lifecycle_status IN ('ACTIVE', 'ARCHIVED', 'CANCELLED')),
    CONSTRAINT artifact_branch_scope_shape CHECK (
        (project_id IS NOT NULL AND enterprise_id IS NOT NULL)
        OR (project_id IS NULL AND enterprise_id IS NOT NULL)),
    CONSTRAINT artifact_branch_head_ref_shape CHECK (
        working_head_ref IS NULL OR jsonb_typeof(working_head_ref) = 'object'),
    CONSTRAINT artifact_branch_identity_unique UNIQUE (artifact_id, branch_name)
);

CREATE INDEX artifact_branch_scope_idx
    ON artifact.artifact_branch (enterprise_id, project_id, artifact_id, branch_name);
CREATE INDEX artifact_branch_head_idx
    ON artifact.artifact_branch (artifact_id, head_version);

-- The Root and Branch identity is mutually bound within the create
-- transaction. The check is deferred because the Root is inserted before its
-- Branch by the owning function.
ALTER TABLE artifact.artifact
    ADD CONSTRAINT artifact_default_branch_fk FOREIGN KEY (default_branch_id)
    REFERENCES artifact.artifact_branch (branch_id)
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- Root/Branch guards
-- ---------------------------------------------------------------------------

CREATE FUNCTION artifact.guard_artifact_insert() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
DECLARE
    trusted_decision_id uuid;
BEGIN
    SELECT decision_id
      INTO trusted_decision_id
      FROM platform_security.context_authorization_decision_ref();
    IF NEW.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR NEW.updated_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR NEW.updated_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR NEW.created_authorization_decision_id IS DISTINCT FROM trusted_decision_id
       OR NEW.last_authorization_decision_id IS DISTINCT FROM trusted_decision_id THEN
        RAISE EXCEPTION 'artifact attribution does not match trusted transaction context'
            USING ERRCODE = '42501';
    END IF;
    IF NEW.project_id IS NULL THEN
        IF NOT platform_security.context_allows_enterprise(NEW.enterprise_id) THEN
            RAISE EXCEPTION 'artifact enterprise scope is not allowed'
                USING ERRCODE = '42501';
        END IF;
    ELSIF NOT platform_security.context_allows_project(NEW.enterprise_id, NEW.project_id) THEN
        RAISE EXCEPTION 'artifact project scope is not allowed'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION artifact.guard_artifact_update() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
DECLARE
    trusted_decision_id uuid;
BEGIN
    IF OLD.lifecycle_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'artifact is not active'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.artifact_id IS DISTINCT FROM OLD.artifact_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.business_scope IS DISTINCT FROM OLD.business_scope
       OR NEW.origin_project_ref IS DISTINCT FROM OLD.origin_project_ref
       OR NEW.artifact_type IS DISTINCT FROM OLD.artifact_type
       OR NEW.identity_hash IS DISTINCT FROM OLD.identity_hash
       OR NEW.delivery_item_refs IS DISTINCT FROM OLD.delivery_item_refs
       OR NEW.default_branch_id IS DISTINCT FROM OLD.default_branch_id
       OR NEW.approved_revision_refs IS DISTINCT FROM OLD.approved_revision_refs
       OR NEW.effective_binding_refs IS DISTINCT FROM OLD.effective_binding_refs
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.created_authorization_decision_id IS DISTINCT FROM OLD.created_authorization_decision_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'artifact identity, scope or historical reference is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
        RAISE EXCEPTION 'artifact aggregate version must advance by one'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.lifecycle_status = 'ACTIVE' THEN
        IF NEW.metadata_version <> OLD.metadata_version + 1
           OR NEW.archived_at IS NOT NULL
           OR NEW.archive_reason IS NOT NULL
           OR NEW.retention_policy_ref IS NOT NULL THEN
            RAISE EXCEPTION 'artifact metadata update shape is invalid'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.lifecycle_status = 'ARCHIVED' THEN
        IF NEW.metadata_version <> OLD.metadata_version
           OR NEW.archived_at IS NULL
           OR jsonb_typeof(NEW.archive_reason) <> 'object'
           OR jsonb_typeof(NEW.retention_policy_ref) <> 'object' THEN
            RAISE EXCEPTION 'artifact archive shape is invalid'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        RAISE EXCEPTION 'artifact lifecycle transition is not allowed'
            USING ERRCODE = '23514';
    END IF;
    SELECT decision_id
      INTO trusted_decision_id
      FROM platform_security.context_authorization_decision_ref();
    IF NEW.updated_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR NEW.updated_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR NEW.last_authorization_decision_id IS DISTINCT FROM trusted_decision_id
       OR NEW.last_command_id IS NOT DISTINCT FROM OLD.last_command_id THEN
        RAISE EXCEPTION 'artifact update attribution is invalid'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION artifact.guard_artifact_branch_insert() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
DECLARE
    parent_enterprise_id uuid;
    parent_project_id uuid;
    trusted_decision_id uuid;
BEGIN
    SELECT a.enterprise_id, a.project_id
      INTO parent_enterprise_id, parent_project_id
      FROM artifact.artifact a
     WHERE a.artifact_id = NEW.artifact_id;
    IF NOT FOUND
       OR parent_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR parent_project_id IS DISTINCT FROM NEW.project_id THEN
        RAISE EXCEPTION 'artifact branch scope does not match its Root'
            USING ERRCODE = '23514';
    END IF;
    SELECT decision_id
      INTO trusted_decision_id
      FROM platform_security.context_authorization_decision_ref();
    IF NEW.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR NEW.updated_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR NEW.updated_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR NEW.created_authorization_decision_id IS DISTINCT FROM trusted_decision_id
       OR NEW.last_authorization_decision_id IS DISTINCT FROM trusted_decision_id THEN
        RAISE EXCEPTION 'artifact branch attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION artifact.guard_artifact_branch_update() RETURNS trigger
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
       OR NEW.working_head_ref IS DISTINCT FROM OLD.working_head_ref
       OR NEW.head_version IS DISTINCT FROM OLD.head_version
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.created_authorization_decision_id IS DISTINCT FROM OLD.created_authorization_decision_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'artifact branch identity or working head is immutable in this slice'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.lifecycle_status <> 'ACTIVE' OR NEW.lifecycle_status <> 'ARCHIVED' THEN
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

CREATE TRIGGER artifact_insert_guard
    BEFORE INSERT ON artifact.artifact
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_artifact_insert();
CREATE TRIGGER artifact_update_guard
    BEFORE UPDATE ON artifact.artifact
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_artifact_update();
CREATE TRIGGER artifact_branch_insert_guard
    BEFORE INSERT ON artifact.artifact_branch
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_artifact_branch_insert();
CREATE TRIGGER artifact_branch_update_guard
    BEFORE UPDATE ON artifact.artifact_branch
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_artifact_branch_update();

-- ---------------------------------------------------------------------------
-- Owning write boundaries
-- ---------------------------------------------------------------------------

CREATE FUNCTION artifact.create_artifact(
    p_artifact_id uuid,
    p_default_branch_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_business_scope text,
    p_origin_project_ref jsonb,
    p_artifact_type text,
    p_title text,
    p_classification text,
    p_identity_hash bytea,
    p_delivery_item_refs jsonb,
    p_metadata jsonb,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    inserted_artifact_id uuid;
BEGIN
    INSERT INTO artifact.artifact (
        artifact_id, enterprise_id, project_id, business_scope,
        origin_project_ref, artifact_type, title, classification, identity_hash,
        delivery_item_refs, metadata, lifecycle_status, aggregate_version,
        metadata_version, default_branch_id, approved_revision_refs,
        effective_binding_refs, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id,
        updated_by_principal_id, updated_by_actor_snapshot_id,
        last_authorization_decision_id, last_command_id)
    VALUES (
        p_artifact_id, p_enterprise_id, p_project_id, p_business_scope,
        p_origin_project_ref, p_artifact_type, p_title, p_classification,
        p_identity_hash, p_delivery_item_refs, p_metadata, 'ACTIVE', 1, 1,
        p_default_branch_id, '[]'::jsonb, '[]'::jsonb,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
        p_source_command_id)
    ON CONFLICT (enterprise_id, identity_hash) DO NOTHING
    RETURNING artifact_id INTO inserted_artifact_id;

    IF inserted_artifact_id IS NULL THEN
        RETURN false;
    END IF;

    INSERT INTO artifact.artifact_branch (
        branch_id, artifact_id, enterprise_id, project_id, branch_name,
        working_head_ref, head_version, lifecycle_status,
        created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, updated_by_principal_id,
        updated_by_actor_snapshot_id, last_authorization_decision_id,
        last_command_id)
    VALUES (
        p_default_branch_id, p_artifact_id, p_enterprise_id, p_project_id,
        'main', NULL, 0, 'ACTIVE', p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id);
    RETURN true;
END
$fn$;

CREATE FUNCTION artifact.cas_artifact_metadata(
    p_artifact_id uuid,
    p_expected_version bigint,
    p_title text,
    p_classification text,
    p_metadata jsonb,
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
    root_enterprise_id uuid;
    root_project_id uuid;
    root_status text;
    root_version bigint;
BEGIN
    SELECT a.enterprise_id, a.project_id, a.lifecycle_status, a.aggregate_version
      INTO root_enterprise_id, root_project_id, root_status, root_version
      FROM artifact.artifact a
     WHERE a.artifact_id = p_artifact_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'NOT_FOUND';
    END IF;
    IF (root_project_id IS NULL AND NOT platform_security.context_allows_enterprise(root_enterprise_id))
       OR (root_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(root_enterprise_id, root_project_id)) THEN
        RETURN 'NOT_FOUND';
    END IF;
    IF p_updated_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_updated_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_last_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'artifact metadata attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF root_status <> 'ACTIVE' THEN
        RETURN 'NOT_ACTIVE';
    END IF;
    IF root_version <> p_expected_version THEN
        RETURN 'CONFLICT';
    END IF;
    UPDATE artifact.artifact
       SET title = p_title,
           classification = p_classification,
           metadata = p_metadata,
           aggregate_version = p_expected_version + 1,
           metadata_version = metadata_version + 1,
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           last_authorization_decision_id = p_last_authorization_decision_id,
           last_command_id = p_source_command_id,
           updated_at = clock_timestamp()
     WHERE artifact_id = p_artifact_id;
    RETURN 'OK';
END
$fn$;

CREATE FUNCTION artifact.archive_artifact(
    p_artifact_id uuid,
    p_expected_version bigint,
    p_archived_at timestamptz,
    p_archive_reason jsonb,
    p_retention_policy_ref jsonb,
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
    root_enterprise_id uuid;
    root_project_id uuid;
    root_status text;
    root_version bigint;
BEGIN
    SELECT a.enterprise_id, a.project_id, a.lifecycle_status, a.aggregate_version
      INTO root_enterprise_id, root_project_id, root_status, root_version
      FROM artifact.artifact a
     WHERE a.artifact_id = p_artifact_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN 'NOT_FOUND';
    END IF;
    IF (root_project_id IS NULL AND NOT platform_security.context_allows_enterprise(root_enterprise_id))
       OR (root_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(root_enterprise_id, root_project_id)) THEN
        RETURN 'NOT_FOUND';
    END IF;
    IF p_updated_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_updated_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_last_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'artifact archive attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF root_status <> 'ACTIVE' THEN
        RETURN 'NOT_ACTIVE';
    END IF;
    IF root_version <> p_expected_version THEN
        RETURN 'CONFLICT';
    END IF;
    UPDATE artifact.artifact
       SET lifecycle_status = 'ARCHIVED',
           aggregate_version = p_expected_version + 1,
           archived_at = p_archived_at,
           archive_reason = p_archive_reason,
           retention_policy_ref = p_retention_policy_ref,
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           last_authorization_decision_id = p_last_authorization_decision_id,
           last_command_id = p_source_command_id,
           updated_at = clock_timestamp()
     WHERE artifact_id = p_artifact_id;
    UPDATE artifact.artifact_branch
       SET lifecycle_status = 'ARCHIVED',
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           last_authorization_decision_id = p_last_authorization_decision_id,
           last_command_id = p_source_command_id,
           updated_at = clock_timestamp()
     WHERE artifact_id = p_artifact_id
       AND lifecycle_status = 'ACTIVE';
    RETURN 'OK';
END
$fn$;

REVOKE ALL ON FUNCTION artifact.guard_artifact_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.guard_artifact_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.guard_artifact_branch_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.guard_artifact_branch_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.create_artifact(
    uuid, uuid, uuid, uuid, text, jsonb, text, text, text, bytea, jsonb, jsonb,
    uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.cas_artifact_metadata(
    uuid, bigint, text, text, jsonb, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.archive_artifact(
    uuid, bigint, timestamptz, jsonb, jsonb, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION artifact.create_artifact(
    uuid, uuid, uuid, uuid, text, jsonb, text, text, text, bytea, jsonb, jsonb,
    uuid, uuid, uuid, uuid) TO artifact_app;
GRANT EXECUTE ON FUNCTION artifact.cas_artifact_metadata(
    uuid, bigint, text, text, jsonb, uuid, uuid, uuid, uuid) TO artifact_app;
GRANT EXECUTE ON FUNCTION artifact.archive_artifact(
    uuid, bigint, timestamptz, jsonb, jsonb, uuid, uuid, uuid, uuid) TO artifact_app;

-- ---------------------------------------------------------------------------
-- RLS and least privilege
-- ---------------------------------------------------------------------------

ALTER TABLE artifact.artifact ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.artifact FORCE ROW LEVEL SECURITY;
CREATE POLICY artifact_select ON artifact.artifact
    FOR SELECT TO artifact_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY artifact_owner_all ON artifact.artifact
    FOR ALL TO artifact_owner USING (true) WITH CHECK (true);

ALTER TABLE artifact.artifact_branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.artifact_branch FORCE ROW LEVEL SECURITY;
CREATE POLICY artifact_branch_select ON artifact.artifact_branch
    FOR SELECT TO artifact_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY artifact_branch_owner_all ON artifact.artifact_branch
    FOR ALL TO artifact_owner USING (true) WITH CHECK (true);

REVOKE ALL ON artifact.artifact FROM artifact_app;
REVOKE ALL ON artifact.artifact_branch FROM artifact_app;
GRANT SELECT ON artifact.artifact, artifact.artifact_branch TO artifact_app;

RESET ROLE;
