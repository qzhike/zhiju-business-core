-- IM-04 WI-04 (issue #93): Canonical Content Object lifecycle and orphan
-- cleanup boundary. This migration is forward-only; V4000/V4001 remain
-- unchanged. Object Storage and PostgreSQL do not share a transaction.

SET ROLE artifact_owner;

-- ---------------------------------------------------------------------------
-- Canonical Content Object Manifest
-- ---------------------------------------------------------------------------

CREATE TABLE artifact.artifact_content_object (
    content_object_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    payload_schema_ref jsonb NOT NULL,
    content_type text NOT NULL,
    canonicalization_version text NOT NULL,
    content_hash bytea NOT NULL,
    byte_size bigint NOT NULL,
    media_type text NOT NULL,
    storage_provider text NOT NULL,
    object_locator text NOT NULL,
    object_version_id text NOT NULL,
    storage_state text NOT NULL DEFAULT 'STAGING',
    finalization_state text NOT NULL DEFAULT 'STAGED',
    finalization_error_code text,
    verified_at timestamptz NOT NULL,
    linked_at timestamptz,
    finalized_at timestamptz,
    frozen_at timestamptz,
    quarantine_reason jsonb,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    retention_until timestamptz,
    legal_hold boolean NOT NULL DEFAULT false,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_by_principal_id uuid NOT NULL,
    updated_by_actor_snapshot_id uuid NOT NULL,
    last_authorization_decision_id uuid NOT NULL,
    last_command_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT content_object_scope_shape CHECK (
        project_id IS NULL OR enterprise_id IS NOT NULL),
    CONSTRAINT content_object_type_closed CHECK (
        content_type IN ('STRUCTURED_DOCUMENT', 'WORKBOOK_SPEC')),
    CONSTRAINT content_object_canonicalization_closed CHECK (
        canonicalization_version = '1'),
    CONSTRAINT content_object_hash_len CHECK (octet_length(content_hash) = 32),
    CONSTRAINT content_object_size_nonnegative CHECK (byte_size >= 0),
    CONSTRAINT content_object_media_type_shape CHECK (
        media_type ~ '^[^/[:space:]]+/[^/[:space:]]+$'),
    CONSTRAINT content_object_locator_shape CHECK (
        object_locator ~ '^[a-z0-9][a-z0-9._-]*(/[A-Za-z0-9._-]+)+$'),
    CONSTRAINT content_object_state_closed CHECK (
        storage_state IN ('STAGING', 'LINKED', 'FROZEN', 'QUARANTINED')),
    CONSTRAINT content_object_finalization_closed CHECK (
        finalization_state IN ('STAGED', 'FINALIZED', 'UNKNOWN')),
    CONSTRAINT content_object_frozen_finalized CHECK (
        storage_state <> 'FROZEN' OR finalization_state = 'FINALIZED'),
    CONSTRAINT content_object_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT content_object_quarantine_shape CHECK (
        (storage_state = 'QUARANTINED' AND quarantine_reason IS NOT NULL)
        OR (storage_state <> 'QUARANTINED' AND quarantine_reason IS NULL))
);

CREATE INDEX content_object_scope_state_idx
    ON artifact.artifact_content_object (enterprise_id, project_id, storage_state, updated_at DESC);
CREATE INDEX content_object_hash_idx
    ON artifact.artifact_content_object (enterprise_id, content_hash);
CREATE UNIQUE INDEX content_object_storage_identity_idx
    ON artifact.artifact_content_object (storage_provider, object_locator, object_version_id);

-- ---------------------------------------------------------------------------
-- Exact future owner link. The Revision table is intentionally deferred.
-- ---------------------------------------------------------------------------

CREATE TABLE artifact.artifact_content_object_link (
    content_object_id uuid PRIMARY KEY,
    owner_object_type text NOT NULL,
    owner_object_id uuid NOT NULL,
    owner_version_id uuid NOT NULL,
    owner_payload_hash bytea,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    linked_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT content_object_link_owner_type_closed CHECK (
        owner_object_type = 'ArtifactRevision'),
    CONSTRAINT content_object_link_owner_hash_len CHECK (
        owner_payload_hash IS NULL OR octet_length(owner_payload_hash) = 32)
);

CREATE UNIQUE INDEX content_object_link_owner_idx
    ON artifact.artifact_content_object_link (owner_object_type, owner_object_id, owner_version_id);
CREATE INDEX content_object_link_scope_idx
    ON artifact.artifact_content_object_link (enterprise_id, project_id);

-- ---------------------------------------------------------------------------
-- Quarantine and orphan facts. Orphans deliberately do not FK to the
-- Manifest: a DB rollback after upload leaves no Manifest row to reference.
-- ---------------------------------------------------------------------------

CREATE TABLE artifact.artifact_content_object_quarantine (
    quarantine_id uuid PRIMARY KEY,
    content_object_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    reason_code text NOT NULL,
    safe_summary text NOT NULL,
    content_hash bytea,
    storage_provider text NOT NULL,
    object_locator text NOT NULL,
    object_version_id text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid,
    retention_class text NOT NULL DEFAULT 'REGULATED_AUDIT',
    CONSTRAINT content_object_quarantine_hash_len CHECK (
        content_hash IS NULL OR octet_length(content_hash) = 32),
    CONSTRAINT content_object_quarantine_locator_shape CHECK (
        object_locator ~ '^[a-z0-9][a-z0-9._-]*(/[A-Za-z0-9._-]+)+$')
);

CREATE INDEX content_object_quarantine_scope_idx
    ON artifact.artifact_content_object_quarantine (enterprise_id, project_id, recorded_at DESC);

CREATE TABLE artifact.artifact_content_object_orphan (
    orphan_id uuid PRIMARY KEY,
    content_object_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    content_hash bytea NOT NULL,
    byte_size bigint NOT NULL,
    media_type text NOT NULL,
    storage_provider text NOT NULL,
    object_locator text NOT NULL,
    object_version_id text NOT NULL,
    storage_state text NOT NULL,
    retention_class text NOT NULL,
    retention_until timestamptz,
    legal_hold boolean NOT NULL DEFAULT false,
    eligible_at timestamptz NOT NULL,
    next_attempt_at timestamptz NOT NULL,
    outcome text NOT NULL DEFAULT 'PENDING',
    attempt_count integer NOT NULL DEFAULT 0,
    lease_owner text,
    lease_until timestamptz,
    lease_token uuid,
    last_error_code text,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    source_command_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT content_object_orphan_hash_len CHECK (octet_length(content_hash) = 32),
    CONSTRAINT content_object_orphan_size_nonnegative CHECK (byte_size >= 0),
    CONSTRAINT content_object_orphan_media_type_shape CHECK (
        media_type ~ '^[^/[:space:]]+/[^/[:space:]]+$'),
    CONSTRAINT content_object_orphan_locator_shape CHECK (
        object_locator ~ '^[a-z0-9][a-z0-9._-]*(/[A-Za-z0-9._-]+)+$'),
    CONSTRAINT content_object_orphan_state_closed CHECK (
        storage_state IN ('STAGING', 'QUARANTINED')),
    CONSTRAINT content_object_orphan_outcome_closed CHECK (
        outcome IN ('PENDING', 'LEASED', 'RETRY', 'UNKNOWN', 'DELETED', 'NOT_FOUND', 'HELD')),
    CONSTRAINT content_object_orphan_attempts_nonnegative CHECK (attempt_count >= 0),
    CONSTRAINT content_object_orphan_lease_shape CHECK (
        (lease_owner IS NULL AND lease_until IS NULL AND lease_token IS NULL)
        OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL AND lease_token IS NOT NULL)),
    CONSTRAINT content_object_orphan_terminal_lease CHECK (
        outcome NOT IN ('DELETED', 'NOT_FOUND', 'HELD')
        OR (lease_owner IS NULL AND lease_until IS NULL AND lease_token IS NULL))
);

CREATE UNIQUE INDEX content_object_orphan_storage_identity_idx
    ON artifact.artifact_content_object_orphan
        (storage_provider, object_locator, object_version_id);
CREATE INDEX content_object_orphan_claim_idx
    ON artifact.artifact_content_object_orphan (enterprise_id, project_id, next_attempt_at)
    WHERE outcome IN ('PENDING', 'RETRY', 'UNKNOWN', 'LEASED');

-- ---------------------------------------------------------------------------
-- Manifest immutability and lifecycle transition guard.
-- ---------------------------------------------------------------------------

CREATE FUNCTION artifact.guard_content_object_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF OLD.content_object_id IS DISTINCT FROM NEW.content_object_id
       OR OLD.enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR OLD.project_id IS DISTINCT FROM NEW.project_id
       OR OLD.payload_schema_ref IS DISTINCT FROM NEW.payload_schema_ref
       OR OLD.content_type IS DISTINCT FROM NEW.content_type
       OR OLD.canonicalization_version IS DISTINCT FROM NEW.canonicalization_version
       OR OLD.content_hash IS DISTINCT FROM NEW.content_hash
       OR OLD.byte_size IS DISTINCT FROM NEW.byte_size
       OR OLD.media_type IS DISTINCT FROM NEW.media_type
       OR OLD.storage_provider IS DISTINCT FROM NEW.storage_provider
       OR OLD.object_locator IS DISTINCT FROM NEW.object_locator
       OR OLD.object_version_id IS DISTINCT FROM NEW.object_version_id
       OR OLD.verified_at IS DISTINCT FROM NEW.verified_at
       OR OLD.retention_class IS DISTINCT FROM NEW.retention_class
       OR OLD.retention_until IS DISTINCT FROM NEW.retention_until
       OR OLD.legal_hold IS DISTINCT FROM NEW.legal_hold
       OR OLD.created_by_principal_id IS DISTINCT FROM NEW.created_by_principal_id
       OR OLD.created_by_actor_snapshot_id IS DISTINCT FROM NEW.created_by_actor_snapshot_id
       OR OLD.created_authorization_decision_id IS DISTINCT FROM NEW.created_authorization_decision_id
       OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'content object identity and retention fields are immutable'
            USING ERRCODE = '55000';
    END IF;
    IF OLD.storage_state = 'FROZEN'
       AND (OLD.storage_state, OLD.finalization_state, OLD.finalization_error_code,
            OLD.linked_at, OLD.finalized_at, OLD.frozen_at, OLD.quarantine_reason,
            OLD.aggregate_version, OLD.updated_by_principal_id,
            OLD.updated_by_actor_snapshot_id, OLD.last_authorization_decision_id,
            OLD.last_command_id, OLD.updated_at)
           IS DISTINCT FROM
           (NEW.storage_state, NEW.finalization_state, NEW.finalization_error_code,
            NEW.linked_at, NEW.finalized_at, NEW.frozen_at, NEW.quarantine_reason,
            NEW.aggregate_version, NEW.updated_by_principal_id,
            NEW.updated_by_actor_snapshot_id, NEW.last_authorization_decision_id,
            NEW.last_command_id, NEW.updated_at) THEN
        RAISE EXCEPTION 'frozen content object is immutable'
            USING ERRCODE = '55000';
    END IF;
    IF OLD.storage_state = 'QUARANTINED' AND NEW.storage_state <> 'QUARANTINED' THEN
        RAISE EXCEPTION 'quarantined content object cannot be restored'
            USING ERRCODE = '55000';
    END IF;
    IF OLD.storage_state = 'STAGING'
       AND NEW.storage_state NOT IN ('STAGING', 'LINKED', 'QUARANTINED') THEN
        RAISE EXCEPTION 'invalid content object state transition'
            USING ERRCODE = '22023';
    END IF;
    IF OLD.storage_state = 'LINKED'
       AND NEW.storage_state NOT IN ('LINKED', 'FROZEN', 'QUARANTINED') THEN
        RAISE EXCEPTION 'invalid content object state transition'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.storage_state = 'FROZEN' AND NEW.finalization_state <> 'FINALIZED' THEN
        RAISE EXCEPTION 'content object must be finalized before freeze'
            USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE TRIGGER content_object_update_guard
    BEFORE UPDATE ON artifact.artifact_content_object
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_content_object_update();

-- ---------------------------------------------------------------------------
-- Security-definer write boundaries.
-- ---------------------------------------------------------------------------

CREATE FUNCTION artifact.create_content_object(
    p_content_object_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_payload_schema_ref jsonb,
    p_content_type text,
    p_canonicalization_version text,
    p_content_hash bytea,
    p_byte_size bigint,
    p_media_type text,
    p_storage_provider text,
    p_object_locator text,
    p_object_version_id text,
    p_verified_at timestamptz,
    p_retention_class text,
    p_retention_until timestamptz,
    p_legal_hold boolean,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    IF (p_project_id IS NULL AND NOT platform_security.context_allows_enterprise(p_enterprise_id))
       OR (p_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(p_enterprise_id, p_project_id)) THEN
        RAISE EXCEPTION 'content object scope does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF p_created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_created_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_created_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'content object attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    INSERT INTO artifact.artifact_content_object (
        content_object_id, enterprise_id, project_id, payload_schema_ref, content_type,
        canonicalization_version, content_hash, byte_size, media_type, storage_provider,
        object_locator, object_version_id, storage_state, finalization_state, verified_at,
        retention_class, retention_until, legal_hold, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id,
        updated_by_principal_id, updated_by_actor_snapshot_id, last_authorization_decision_id,
        last_command_id)
    VALUES (
        p_content_object_id, p_enterprise_id, p_project_id, p_payload_schema_ref, p_content_type,
        p_canonicalization_version, p_content_hash, p_byte_size, p_media_type, p_storage_provider,
        p_object_locator, p_object_version_id, 'STAGING', 'STAGED', p_verified_at,
        p_retention_class, p_retention_until, p_legal_hold, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id);
    RETURN true;
END
$fn$;

CREATE FUNCTION artifact.link_content_object(
    p_content_object_id uuid,
    p_expected_version bigint,
    p_owner_object_type text,
    p_owner_object_id uuid,
    p_owner_version_id uuid,
    p_owner_payload_hash bytea,
    p_enterprise_id uuid,
    p_project_id uuid,
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
    object_enterprise_id uuid;
    object_project_id uuid;
    object_state text;
    object_version bigint;
    existing_link artifact.artifact_content_object_link%ROWTYPE;
BEGIN
    SELECT c.enterprise_id, c.project_id, c.storage_state, c.aggregate_version
      INTO object_enterprise_id, object_project_id, object_state, object_version
      FROM artifact.artifact_content_object c
     WHERE c.content_object_id = p_content_object_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    IF object_enterprise_id IS DISTINCT FROM p_enterprise_id
       OR object_project_id IS DISTINCT FROM p_project_id
       OR (p_project_id IS NULL AND NOT platform_security.context_allows_enterprise(object_enterprise_id))
       OR (p_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(object_enterprise_id, p_project_id)) THEN
        RETURN 'NOT_FOUND';
    END IF;
    IF object_version <> p_expected_version THEN RETURN 'CONFLICT'; END IF;
    IF p_updated_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_updated_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_last_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'content object link attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF p_owner_object_type <> 'ArtifactRevision' THEN RETURN 'OWNER_TYPE_INVALID'; END IF;
    IF object_state <> 'STAGING' THEN
        SELECT * INTO existing_link
          FROM artifact.artifact_content_object_link l
         WHERE l.content_object_id = p_content_object_id;
        IF object_state = 'LINKED' AND FOUND
           AND existing_link.owner_object_type = p_owner_object_type
           AND existing_link.owner_object_id = p_owner_object_id
           AND existing_link.owner_version_id = p_owner_version_id THEN
            RETURN 'ALREADY_LINKED';
        END IF;
        RETURN 'INVALID_STATE';
    END IF;
    INSERT INTO artifact.artifact_content_object_link (
        content_object_id, owner_object_type, owner_object_id, owner_version_id,
        owner_payload_hash, enterprise_id, project_id, source_command_id)
    VALUES (
        p_content_object_id, p_owner_object_type, p_owner_object_id, p_owner_version_id,
        p_owner_payload_hash, p_enterprise_id, p_project_id, p_source_command_id);
    UPDATE artifact.artifact_content_object
       SET storage_state = 'LINKED',
           linked_at = clock_timestamp(),
           aggregate_version = p_expected_version + 1,
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           last_authorization_decision_id = p_last_authorization_decision_id,
           last_command_id = p_source_command_id,
           updated_at = clock_timestamp()
     WHERE content_object_id = p_content_object_id;
    RETURN 'OK';
END
$fn$;

CREATE FUNCTION artifact.mark_content_object_finalization(
    p_content_object_id uuid,
    p_finalized boolean,
    p_error_code text,
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
    object_enterprise_id uuid;
    object_project_id uuid;
    object_state text;
    current_finalization text;
BEGIN
    SELECT c.enterprise_id, c.project_id, c.storage_state, c.finalization_state
      INTO object_enterprise_id, object_project_id, object_state, current_finalization
      FROM artifact.artifact_content_object c
     WHERE c.content_object_id = p_content_object_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    IF (object_project_id IS NULL AND NOT platform_security.context_allows_enterprise(object_enterprise_id))
       OR (object_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(object_enterprise_id, object_project_id)) THEN
        RETURN 'NOT_FOUND';
    END IF;
    IF p_updated_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_updated_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_last_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'content object finalization attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF object_state = 'QUARANTINED' THEN RETURN 'QUARANTINED'; END IF;
    IF object_state = 'FROZEN' AND p_finalized THEN RETURN 'ALREADY_FINALIZED'; END IF;
    IF object_state = 'FROZEN' THEN RETURN 'INVALID_STATE'; END IF;
    IF object_state <> 'LINKED' THEN RETURN 'INVALID_STATE'; END IF;
    IF p_finalized AND current_finalization = 'FINALIZED' THEN RETURN 'ALREADY_FINALIZED'; END IF;
    UPDATE artifact.artifact_content_object
       SET finalization_state = CASE WHEN p_finalized THEN 'FINALIZED' ELSE 'UNKNOWN' END,
           finalization_error_code = CASE WHEN p_finalized THEN NULL ELSE COALESCE(p_error_code, 'OBJECT_FINALIZE_UNKNOWN') END,
           finalized_at = CASE WHEN p_finalized THEN clock_timestamp() ELSE finalized_at END,
           aggregate_version = aggregate_version + 1,
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           last_authorization_decision_id = p_last_authorization_decision_id,
           last_command_id = p_source_command_id,
           updated_at = clock_timestamp()
     WHERE content_object_id = p_content_object_id;
    RETURN CASE WHEN p_finalized THEN 'FINALIZED' ELSE 'UNKNOWN' END;
END
$fn$;

CREATE FUNCTION artifact.freeze_content_object(
    p_content_object_id uuid,
    p_expected_version bigint,
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
    object_enterprise_id uuid;
    object_project_id uuid;
    object_state text;
    object_finalization text;
    object_version bigint;
BEGIN
    SELECT c.enterprise_id, c.project_id, c.storage_state, c.finalization_state, c.aggregate_version
      INTO object_enterprise_id, object_project_id, object_state, object_finalization, object_version
      FROM artifact.artifact_content_object c
     WHERE c.content_object_id = p_content_object_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    IF (object_project_id IS NULL AND NOT platform_security.context_allows_enterprise(object_enterprise_id))
       OR (object_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(object_enterprise_id, object_project_id)) THEN
        RETURN 'NOT_FOUND';
    END IF;
    IF object_version <> p_expected_version THEN RETURN 'CONFLICT'; END IF;
    IF p_updated_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_updated_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_last_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'content object freeze attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF object_state = 'FROZEN' THEN RETURN 'ALREADY_FROZEN'; END IF;
    IF object_state = 'QUARANTINED' THEN RETURN 'QUARANTINED'; END IF;
    IF object_state <> 'LINKED' THEN RETURN 'INVALID_STATE'; END IF;
    IF object_finalization <> 'FINALIZED' THEN RETURN 'NOT_FINALIZED'; END IF;
    UPDATE artifact.artifact_content_object
       SET storage_state = 'FROZEN',
           frozen_at = clock_timestamp(),
           aggregate_version = p_expected_version + 1,
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           last_authorization_decision_id = p_last_authorization_decision_id,
           last_command_id = p_source_command_id,
           updated_at = clock_timestamp()
     WHERE content_object_id = p_content_object_id;
    RETURN 'OK';
END
$fn$;

CREATE FUNCTION artifact.quarantine_content_object(
    p_content_object_id uuid,
    p_expected_version bigint,
    p_reason_code text,
    p_safe_summary text,
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
    object_enterprise_id uuid;
    object_project_id uuid;
    object_state text;
    object_hash bytea;
    object_provider text;
    object_locator text;
    object_version text;
    object_aggregate_version bigint;
BEGIN
    SELECT c.enterprise_id, c.project_id, c.storage_state, c.content_hash,
           c.storage_provider, c.object_locator, c.object_version_id, c.aggregate_version
      INTO object_enterprise_id, object_project_id, object_state, object_hash,
           object_provider, object_locator, object_version, object_aggregate_version
      FROM artifact.artifact_content_object c
     WHERE c.content_object_id = p_content_object_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    IF (object_project_id IS NULL AND NOT platform_security.context_allows_enterprise(object_enterprise_id))
       OR (object_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(object_enterprise_id, object_project_id)) THEN
        RETURN 'NOT_FOUND';
    END IF;
    IF object_aggregate_version <> p_expected_version THEN RETURN 'CONFLICT'; END IF;
    IF p_updated_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_updated_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_last_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'content object quarantine attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF object_state = 'FROZEN' THEN RETURN 'INVALID_STATE'; END IF;
    IF object_state = 'QUARANTINED' THEN RETURN 'ALREADY_QUARANTINED'; END IF;
    UPDATE artifact.artifact_content_object
       SET storage_state = 'QUARANTINED',
           quarantine_reason = jsonb_build_object(
               'reasonCode', p_reason_code, 'safeSummary', p_safe_summary),
           aggregate_version = p_expected_version + 1,
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           last_authorization_decision_id = p_last_authorization_decision_id,
           last_command_id = p_source_command_id,
           updated_at = clock_timestamp()
     WHERE content_object_id = p_content_object_id;
    INSERT INTO artifact.artifact_content_object_quarantine (
        quarantine_id, content_object_id, enterprise_id, project_id, reason_code,
        safe_summary, content_hash, storage_provider, object_locator, object_version_id,
        source_command_id)
    VALUES (
        uuidv7(), p_content_object_id, object_enterprise_id, object_project_id, p_reason_code,
        p_safe_summary, object_hash, object_provider, object_locator, object_version,
        p_source_command_id);
    RETURN 'OK';
END
$fn$;

CREATE FUNCTION artifact.record_content_object_orphan(
    p_orphan_id uuid,
    p_content_object_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_content_hash bytea,
    p_byte_size bigint,
    p_media_type text,
    p_storage_provider text,
    p_object_locator text,
    p_object_version_id text,
    p_storage_state text,
    p_retention_class text,
    p_retention_until timestamptz,
    p_legal_hold boolean,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    existing_id uuid;
BEGIN
    IF (p_project_id IS NULL AND NOT platform_security.context_allows_enterprise(p_enterprise_id))
       OR (p_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(p_enterprise_id, p_project_id)) THEN
        RAISE EXCEPTION 'orphan scope does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF p_created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_created_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_created_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'orphan attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    INSERT INTO artifact.artifact_content_object_orphan (
        orphan_id, content_object_id, enterprise_id, project_id, content_hash, byte_size,
        media_type, storage_provider, object_locator, object_version_id, storage_state,
        retention_class, retention_until, legal_hold, eligible_at, next_attempt_at,
        created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_orphan_id, p_content_object_id, p_enterprise_id, p_project_id, p_content_hash,
        p_byte_size, p_media_type, p_storage_provider, p_object_locator, p_object_version_id,
        p_storage_state, p_retention_class, p_retention_until, p_legal_hold,
        clock_timestamp() + interval '24 hours', clock_timestamp() + interval '24 hours',
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id)
    ON CONFLICT (storage_provider, object_locator, object_version_id)
    DO NOTHING
    RETURNING orphan_id INTO existing_id;
    IF existing_id IS NULL THEN
        SELECT o.orphan_id
          INTO existing_id
          FROM artifact.artifact_content_object_orphan o
         WHERE o.storage_provider = p_storage_provider
           AND o.object_locator = p_object_locator
           AND o.object_version_id IS NOT DISTINCT FROM p_object_version_id;
    END IF;
    RETURN existing_id;
END
$fn$;

CREATE FUNCTION artifact.claim_content_object_orphan(
    p_worker text,
    p_lease_token uuid
) RETURNS TABLE (
    orphan_id uuid,
    content_object_id uuid,
    enterprise_id uuid,
    project_id uuid,
    content_hash bytea,
    byte_size bigint,
    media_type text,
    storage_provider text,
    object_locator text,
    object_version_id text,
    storage_state text,
    retention_class text,
    retention_until timestamptz,
    legal_hold boolean,
    attempt_count integer,
    source_command_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    selected artifact.artifact_content_object_orphan%ROWTYPE;
BEGIN
    SELECT o.*
      INTO selected
      FROM artifact.artifact_content_object_orphan o
     WHERE (
           (o.project_id IS NULL AND platform_security.context_allows_enterprise(o.enterprise_id))
           OR (o.project_id IS NOT NULL AND platform_security.context_allows_project(o.enterprise_id, o.project_id))
       )
       AND (
           (o.outcome IN ('PENDING', 'RETRY', 'UNKNOWN')
            AND o.eligible_at <= clock_timestamp()
            AND o.next_attempt_at <= clock_timestamp())
           OR (o.outcome = 'LEASED' AND o.lease_until < clock_timestamp())
       )
     ORDER BY o.next_attempt_at, o.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;
    UPDATE artifact.artifact_content_object_orphan
       SET outcome = 'LEASED',
           attempt_count = selected.attempt_count + 1,
           lease_owner = p_worker,
           lease_until = clock_timestamp() + interval '5 minutes',
           lease_token = p_lease_token,
           updated_at = clock_timestamp()
     WHERE artifact_content_object_orphan.orphan_id = selected.orphan_id;
    RETURN QUERY
    SELECT selected.orphan_id, selected.content_object_id, selected.enterprise_id,
           selected.project_id, selected.content_hash, selected.byte_size, selected.media_type,
           selected.storage_provider, selected.object_locator, selected.object_version_id,
           selected.storage_state, selected.retention_class, selected.retention_until,
           selected.legal_hold, selected.attempt_count + 1, selected.source_command_id;
END
$fn$;

CREATE FUNCTION artifact.complete_content_object_orphan(
    p_orphan_id uuid,
    p_worker text,
    p_lease_token uuid,
    p_delete_outcome text,
    p_error_code text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    selected artifact.artifact_content_object_orphan%ROWTYPE;
BEGIN
    IF p_delete_outcome NOT IN ('DELETED', 'NOT_FOUND', 'UNKNOWN') THEN
        RAISE EXCEPTION 'unsupported orphan deletion outcome'
            USING ERRCODE = '22023';
    END IF;
    SELECT o.* INTO selected
      FROM artifact.artifact_content_object_orphan o
     WHERE o.orphan_id = p_orphan_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    IF selected.project_id IS NULL
       AND NOT platform_security.context_allows_enterprise(selected.enterprise_id) THEN
        RETURN 'NOT_FOUND';
    END IF;
    IF selected.project_id IS NOT NULL
       AND NOT platform_security.context_allows_project(selected.enterprise_id, selected.project_id) THEN
        RETURN 'NOT_FOUND';
    END IF;
    IF selected.outcome IN ('DELETED', 'NOT_FOUND', 'HELD') THEN RETURN 'ALREADY_COMPLETED'; END IF;
    IF selected.outcome <> 'LEASED'
       OR selected.lease_owner IS DISTINCT FROM p_worker
       OR selected.lease_token IS DISTINCT FROM p_lease_token
       OR selected.lease_until IS NULL
       OR selected.lease_until < clock_timestamp() THEN
        RETURN 'FENCED';
    END IF;
    IF selected.legal_hold THEN
        UPDATE artifact.artifact_content_object_orphan
           SET outcome = 'HELD', lease_owner = NULL, lease_until = NULL, lease_token = NULL,
               last_error_code = 'LEGAL_HOLD', updated_at = clock_timestamp()
         WHERE orphan_id = selected.orphan_id;
        RETURN 'HELD';
    END IF;
    IF selected.storage_state = 'QUARANTINED'
       OR EXISTS (
           SELECT 1 FROM artifact.artifact_content_object_link l
            WHERE l.content_object_id = selected.content_object_id) THEN
        UPDATE artifact.artifact_content_object_orphan
           SET outcome = 'RETRY', lease_owner = NULL, lease_until = NULL, lease_token = NULL,
               next_attempt_at = clock_timestamp() + interval '24 hours',
               last_error_code = 'ORPHAN_NOT_ELIGIBLE', updated_at = clock_timestamp()
         WHERE orphan_id = selected.orphan_id;
        RETURN 'RETRY';
    END IF;
    IF selected.retention_until IS NOT NULL AND selected.retention_until > clock_timestamp() THEN
        UPDATE artifact.artifact_content_object_orphan
           SET outcome = 'RETRY', lease_owner = NULL, lease_until = NULL, lease_token = NULL,
               next_attempt_at = selected.retention_until,
               last_error_code = 'RETENTION_ACTIVE', updated_at = clock_timestamp()
         WHERE orphan_id = selected.orphan_id;
        RETURN 'RETRY';
    END IF;
    IF p_delete_outcome IN ('DELETED', 'NOT_FOUND') THEN
        UPDATE artifact.artifact_content_object_orphan
           SET outcome = p_delete_outcome, lease_owner = NULL, lease_until = NULL,
               lease_token = NULL, last_error_code = NULL, updated_at = clock_timestamp()
         WHERE orphan_id = selected.orphan_id;
        RETURN p_delete_outcome;
    END IF;
    UPDATE artifact.artifact_content_object_orphan
       SET outcome = 'UNKNOWN', lease_owner = NULL, lease_until = NULL, lease_token = NULL,
           next_attempt_at = clock_timestamp() + LEAST(
               interval '24 hours',
               interval '5 minutes' * power(2::double precision, GREATEST(attempt_count - 1, 0))),
           last_error_code = COALESCE(p_error_code, 'OBJECT_DELETE_UNKNOWN'),
           updated_at = clock_timestamp()
     WHERE orphan_id = selected.orphan_id;
    RETURN 'UNKNOWN';
END
$fn$;

-- ---------------------------------------------------------------------------
-- Least privilege and RLS. All application writes go through functions.
-- ---------------------------------------------------------------------------

ALTER TABLE artifact.artifact_content_object ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.artifact_content_object FORCE ROW LEVEL SECURITY;
CREATE POLICY content_object_select ON artifact.artifact_content_object
    FOR SELECT TO artifact_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY content_object_owner_all ON artifact.artifact_content_object
    FOR ALL TO artifact_owner USING (true) WITH CHECK (true);

ALTER TABLE artifact.artifact_content_object_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.artifact_content_object_link FORCE ROW LEVEL SECURITY;
CREATE POLICY content_object_link_select ON artifact.artifact_content_object_link
    FOR SELECT TO artifact_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY content_object_link_owner_all ON artifact.artifact_content_object_link
    FOR ALL TO artifact_owner USING (true) WITH CHECK (true);

ALTER TABLE artifact.artifact_content_object_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.artifact_content_object_quarantine FORCE ROW LEVEL SECURITY;
CREATE POLICY content_object_quarantine_select ON artifact.artifact_content_object_quarantine
    FOR SELECT TO artifact_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY content_object_quarantine_owner_all ON artifact.artifact_content_object_quarantine
    FOR ALL TO artifact_owner USING (true) WITH CHECK (true);

ALTER TABLE artifact.artifact_content_object_orphan ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.artifact_content_object_orphan FORCE ROW LEVEL SECURITY;
CREATE POLICY content_object_orphan_select ON artifact.artifact_content_object_orphan
    FOR SELECT TO artifact_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY content_object_orphan_owner_all ON artifact.artifact_content_object_orphan
    FOR ALL TO artifact_owner USING (true) WITH CHECK (true);

REVOKE ALL ON artifact.artifact_content_object,
    artifact.artifact_content_object_link,
    artifact.artifact_content_object_quarantine,
    artifact.artifact_content_object_orphan FROM artifact_app;
GRANT SELECT ON artifact.artifact_content_object,
    artifact.artifact_content_object_link,
    artifact.artifact_content_object_quarantine,
    artifact.artifact_content_object_orphan TO artifact_app;

REVOKE ALL ON FUNCTION artifact.guard_content_object_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.create_content_object(
    uuid, uuid, uuid, jsonb, text, text, bytea, bigint, text, text, text, text,
    timestamptz, text, timestamptz, boolean, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.link_content_object(
    uuid, bigint, text, uuid, uuid, bytea, uuid, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.mark_content_object_finalization(
    uuid, boolean, text, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.freeze_content_object(
    uuid, bigint, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.quarantine_content_object(
    uuid, bigint, text, text, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.record_content_object_orphan(
    uuid, uuid, uuid, uuid, bytea, bigint, text, text, text, text, text, text,
    timestamptz, boolean, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.claim_content_object_orphan(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.complete_content_object_orphan(uuid, text, uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION artifact.create_content_object(
    uuid, uuid, uuid, jsonb, text, text, bytea, bigint, text, text, text, text,
    timestamptz, text, timestamptz, boolean, uuid, uuid, uuid, uuid) TO artifact_app;
GRANT EXECUTE ON FUNCTION artifact.link_content_object(
    uuid, bigint, text, uuid, uuid, bytea, uuid, uuid, uuid, uuid, uuid, uuid) TO artifact_app;
GRANT EXECUTE ON FUNCTION artifact.mark_content_object_finalization(
    uuid, boolean, text, uuid, uuid, uuid, uuid) TO artifact_app;
GRANT EXECUTE ON FUNCTION artifact.freeze_content_object(
    uuid, bigint, uuid, uuid, uuid, uuid) TO artifact_app;
GRANT EXECUTE ON FUNCTION artifact.quarantine_content_object(
    uuid, bigint, text, text, uuid, uuid, uuid, uuid) TO artifact_app;
GRANT EXECUTE ON FUNCTION artifact.record_content_object_orphan(
    uuid, uuid, uuid, uuid, bytea, bigint, text, text, text, text, text, text,
    timestamptz, boolean, uuid, uuid, uuid, uuid) TO artifact_app;
GRANT EXECUTE ON FUNCTION artifact.claim_content_object_orphan(text, uuid) TO artifact_app;
GRANT EXECUTE ON FUNCTION artifact.complete_content_object_orphan(uuid, text, uuid, text, text) TO artifact_app;

RESET ROLE;
