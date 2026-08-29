-- IM-04 WI-08 (issue #97): immutable Artifact Representations verified from
-- the public IntegrationGateway RenderAttempt binding query.
-- This migration is forward-only. V4000 through V4003 remain unchanged.

SET ROLE artifact_owner;

CREATE TABLE artifact.representation (
    representation_id uuid PRIMARY KEY,
    artifact_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    revision_ref jsonb NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    format text NOT NULL,
    media_type text NOT NULL,
    object_locator text NOT NULL,
    checksum bytea NOT NULL,
    renderer_id text NOT NULL,
    renderer_version text NOT NULL,
    render_attempt_id uuid NOT NULL,
    render_attempt_ref jsonb NOT NULL,
    request_payload_hash bytea NOT NULL,
    input_hash bytea NOT NULL,
    raw_receipt_ref jsonb NOT NULL,
    registered_at timestamptz NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT representation_artifact_fk FOREIGN KEY (artifact_id)
        REFERENCES artifact.artifact (artifact_id) ON DELETE RESTRICT,
    CONSTRAINT representation_revision_fk FOREIGN KEY (revision_id)
        REFERENCES artifact.artifact_revision (revision_id) ON DELETE RESTRICT,
    CONSTRAINT representation_revision_ref_object CHECK (
        jsonb_typeof(revision_ref) = 'object'),
    CONSTRAINT representation_format_closed CHECK (
        format ~ '^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$'
        AND format ~ '(^|[._])(pdf|docx|xlsx)$'),
    CONSTRAINT representation_format_media_closed CHECK (
        (format ~ '(^|[._])pdf$' AND media_type = 'application/pdf')
        OR (format ~ '(^|[._])docx$'
            AND media_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        OR (format ~ '(^|[._])xlsx$'
            AND media_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
    CONSTRAINT representation_locator_shape CHECK (
        object_locator ~ '^[a-z0-9][a-z0-9._-]*(/[A-Za-z0-9._-]+)+$'),
    CONSTRAINT representation_checksum_len CHECK (octet_length(checksum) = 32),
    CONSTRAINT representation_request_hash_len CHECK (octet_length(request_payload_hash) = 32),
    CONSTRAINT representation_input_hash_len CHECK (octet_length(input_hash) = 32),
    CONSTRAINT representation_renderer_shape CHECK (
        renderer_id ~ '^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$' AND renderer_version <> ''),
    CONSTRAINT representation_attempt_ref_object CHECK (
        jsonb_typeof(render_attempt_ref) = 'object'),
    CONSTRAINT representation_raw_receipt_ref_object CHECK (
        jsonb_typeof(raw_receipt_ref) = 'object'),
    CONSTRAINT representation_render_attempt_unique UNIQUE (render_attempt_id)
);

CREATE INDEX representation_scope_idx
    ON artifact.representation (enterprise_id, project_id, revision_id, registered_at DESC);
CREATE INDEX representation_revision_idx
    ON artifact.representation (revision_id, format, renderer_id, renderer_version);
CREATE INDEX representation_checksum_idx
    ON artifact.representation (enterprise_id, checksum);

CREATE TABLE artifact.representation_validation (
    validation_id uuid PRIMARY KEY,
    representation_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    binding_operation text NOT NULL,
    validator_id text NOT NULL,
    validator_version text NOT NULL,
    outcome text NOT NULL,
    request_payload_hash bytea NOT NULL,
    input_hash bytea NOT NULL,
    output_checksum bytea NOT NULL,
    raw_receipt_ref jsonb NOT NULL,
    validated_by_principal_id uuid NOT NULL,
    validated_by_actor_snapshot_id uuid NOT NULL,
    validated_authorization_decision_id uuid NOT NULL,
    validated_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT representation_validation_representation_fk FOREIGN KEY (representation_id)
        REFERENCES artifact.representation (representation_id) ON DELETE RESTRICT,
    CONSTRAINT representation_validation_artifact_fk FOREIGN KEY (artifact_id)
        REFERENCES artifact.artifact (artifact_id) ON DELETE RESTRICT,
    CONSTRAINT representation_validation_revision_fk FOREIGN KEY (revision_id)
        REFERENCES artifact.artifact_revision (revision_id) ON DELETE RESTRICT,
    CONSTRAINT representation_validation_operation_closed CHECK (
        binding_operation = 'integration.get_render_attempt_binding'),
    CONSTRAINT representation_validation_outcome_closed CHECK (outcome = 'VERIFIED'),
    CONSTRAINT representation_validation_hash_lengths CHECK (
        octet_length(request_payload_hash) = 32
        AND octet_length(input_hash) = 32
        AND octet_length(output_checksum) = 32),
    CONSTRAINT representation_validation_receipt_object CHECK (
        jsonb_typeof(raw_receipt_ref) = 'object'),
    CONSTRAINT representation_validation_once UNIQUE (representation_id)
);

CREATE INDEX representation_validation_scope_idx
    ON artifact.representation_validation (
        enterprise_id, project_id, representation_id, validated_at DESC);

CREATE FUNCTION artifact.guard_representation_insert() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR NEW.created_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'representation attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF (NEW.project_id IS NULL AND NOT platform_security.context_allows_enterprise(NEW.enterprise_id))
       OR (NEW.project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(NEW.enterprise_id, NEW.project_id)) THEN
        RAISE EXCEPTION 'representation scope is not allowed'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION artifact.guard_representation_validation_insert() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.validated_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR NEW.validated_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR NEW.validated_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'representation validation attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF (NEW.project_id IS NULL AND NOT platform_security.context_allows_enterprise(NEW.enterprise_id))
       OR (NEW.project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(NEW.enterprise_id, NEW.project_id)) THEN
        RAISE EXCEPTION 'representation validation scope is not allowed'
            USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE FUNCTION artifact.guard_representation_immutable() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'representation facts are append-only'
        USING ERRCODE = '55000';
END
$guard$;

CREATE TRIGGER representation_insert_guard
    BEFORE INSERT ON artifact.representation
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_representation_insert();
CREATE TRIGGER representation_immutable_guard
    BEFORE UPDATE OR DELETE ON artifact.representation
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_representation_immutable();
CREATE TRIGGER representation_validation_insert_guard
    BEFORE INSERT ON artifact.representation_validation
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_representation_validation_insert();
CREATE TRIGGER representation_validation_immutable_guard
    BEFORE UPDATE OR DELETE ON artifact.representation_validation
    FOR EACH ROW EXECUTE FUNCTION artifact.guard_representation_immutable();

CREATE FUNCTION artifact.register_representation(
    p_representation_id uuid,
    p_artifact_id uuid,
    p_revision_id uuid,
    p_revision_ref jsonb,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_format text,
    p_media_type text,
    p_object_locator text,
    p_checksum bytea,
    p_renderer_id text,
    p_renderer_version text,
    p_render_attempt_ref jsonb,
    p_canonical_content_ref text,
    p_request_payload_hash bytea,
    p_input_hash bytea,
    p_raw_receipt_ref jsonb,
    p_registered_at timestamptz,
    p_validation_id uuid,
    p_validator_id text,
    p_validator_version text,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, representation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    revision_row artifact.artifact_revision%ROWTYPE;
    artifact_status text;
    attempt_id uuid;
    existing artifact.representation%ROWTYPE;
BEGIN
    IF p_created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_created_by_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_created_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'representation attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF (p_project_id IS NULL AND NOT platform_security.context_allows_enterprise(p_enterprise_id))
       OR (p_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(p_enterprise_id, p_project_id)) THEN
        RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid;
        RETURN;
    END IF;
    IF p_render_attempt_ref->>'kind' IS DISTINCT FROM 'OBJECT'
       OR p_render_attempt_ref->>'objectType' IS DISTINCT FROM 'integration.render_attempt'
       OR p_render_attempt_ref->>'objectId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR p_render_attempt_ref->'scope'->>'enterpriseId' IS DISTINCT FROM p_enterprise_id::text
       OR (p_project_id IS NULL AND p_render_attempt_ref->'scope'->>'projectId' IS NOT NULL)
       OR (p_project_id IS NOT NULL
           AND p_render_attempt_ref->'scope'->>'projectId' IS DISTINCT FROM p_project_id::text) THEN
        RETURN QUERY SELECT 'BINDING_MISMATCH'::text, NULL::uuid;
        RETURN;
    END IF;
    IF p_raw_receipt_ref->>'kind' IS DISTINCT FROM 'CONTENT_ADDRESSED'
       OR p_raw_receipt_ref->>'objectType' IS DISTINCT FROM 'integration.raw_external_receipt'
       OR p_raw_receipt_ref->>'objectId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR p_raw_receipt_ref->'scope'->>'enterpriseId' IS DISTINCT FROM p_enterprise_id::text
       OR (p_project_id IS NULL AND p_raw_receipt_ref->'scope'->>'projectId' IS NOT NULL)
       OR (p_project_id IS NOT NULL
           AND p_raw_receipt_ref->'scope'->>'projectId' IS DISTINCT FROM p_project_id::text)
       OR p_raw_receipt_ref->'contentHash'->>'algorithm' IS DISTINCT FROM 'SHA-256'
       OR p_raw_receipt_ref->'contentHash'->>'canonicalizationVersion' IS DISTINCT FROM '1'
       OR p_raw_receipt_ref->'contentHash'->>'digest' !~ '^[0-9a-f]{64}$' THEN
        RETURN QUERY SELECT 'BINDING_MISMATCH'::text, NULL::uuid;
        RETURN;
    END IF;
    attempt_id := (p_render_attempt_ref->>'objectId')::uuid;
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(attempt_id::text, 4004));

    SELECT r.* INTO existing
      FROM artifact.representation r
     WHERE r.render_attempt_id = attempt_id
     FOR SHARE;
    IF FOUND THEN
        IF existing.artifact_id IS NOT DISTINCT FROM p_artifact_id
           AND existing.revision_id IS NOT DISTINCT FROM p_revision_id
           AND existing.revision_ref IS NOT DISTINCT FROM p_revision_ref
           AND existing.enterprise_id IS NOT DISTINCT FROM p_enterprise_id
           AND existing.project_id IS NOT DISTINCT FROM p_project_id
           AND existing.format IS NOT DISTINCT FROM p_format
           AND existing.media_type IS NOT DISTINCT FROM p_media_type
           AND existing.object_locator IS NOT DISTINCT FROM p_object_locator
           AND existing.checksum IS NOT DISTINCT FROM p_checksum
           AND existing.renderer_id IS NOT DISTINCT FROM p_renderer_id
           AND existing.renderer_version IS NOT DISTINCT FROM p_renderer_version
           AND existing.render_attempt_ref IS NOT DISTINCT FROM p_render_attempt_ref
           AND existing.request_payload_hash IS NOT DISTINCT FROM p_request_payload_hash
           AND existing.input_hash IS NOT DISTINCT FROM p_input_hash
           AND existing.raw_receipt_ref IS NOT DISTINCT FROM p_raw_receipt_ref
           AND existing.registered_at IS NOT DISTINCT FROM p_registered_at THEN
            RETURN QUERY SELECT 'ALREADY'::text, existing.representation_id;
        ELSE
            RETURN QUERY SELECT 'CONFLICT'::text, existing.representation_id;
        END IF;
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM artifact.representation r
         WHERE r.representation_id = p_representation_id) THEN
        RETURN QUERY SELECT 'CONFLICT'::text, p_representation_id;
        RETURN;
    END IF;

    SELECT r.* INTO revision_row
      FROM artifact.artifact_revision r
     WHERE r.revision_id = p_revision_id
       AND r.artifact_id = p_artifact_id
       AND r.enterprise_id = p_enterprise_id
       AND r.project_id IS NOT DISTINCT FROM p_project_id
     FOR SHARE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid;
        RETURN;
    END IF;
    IF p_revision_ref->>'kind' IS DISTINCT FROM 'CONTENT_ADDRESSED'
       OR p_revision_ref->>'objectType' IS DISTINCT FROM 'artifact.artifact_revision'
       OR p_revision_ref->>'objectId' IS DISTINCT FROM p_revision_id::text
       OR p_revision_ref->'scope'->>'enterpriseId' IS DISTINCT FROM p_enterprise_id::text
       OR (p_project_id IS NULL AND p_revision_ref->'scope'->>'projectId' IS NOT NULL)
       OR (p_project_id IS NOT NULL
           AND p_revision_ref->'scope'->>'projectId' IS DISTINCT FROM p_project_id::text)
       OR p_revision_ref->'contentHash'->>'algorithm' IS DISTINCT FROM 'SHA-256'
       OR p_revision_ref->'contentHash'->>'canonicalizationVersion' IS DISTINCT FROM '1'
       OR p_revision_ref->'contentHash'->>'digest' IS DISTINCT FROM encode(revision_row.content_hash, 'hex') THEN
        RETURN QUERY SELECT 'BINDING_MISMATCH'::text, NULL::uuid;
        RETURN;
    END IF;
    SELECT a.lifecycle_status INTO artifact_status
      FROM artifact.artifact a
     WHERE a.artifact_id = p_artifact_id;
    IF artifact_status IS DISTINCT FROM 'ACTIVE' THEN
        RETURN QUERY SELECT 'NOT_ACTIVE'::text, NULL::uuid;
        RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM artifact.revision_withdrawal w WHERE w.revision_id = p_revision_id)
       OR EXISTS (
        SELECT 1 FROM artifact.revision_invalidation i WHERE i.revision_id = p_revision_id) THEN
        RETURN QUERY SELECT 'REVISION_NOT_ACTIVE'::text, NULL::uuid;
        RETURN;
    END IF;
    IF revision_row.object_locator IS DISTINCT FROM p_canonical_content_ref
       OR revision_row.content_hash IS DISTINCT FROM p_input_hash THEN
        RETURN QUERY SELECT 'BINDING_MISMATCH'::text, NULL::uuid;
        RETURN;
    END IF;

    INSERT INTO artifact.representation (
        representation_id, artifact_id, revision_id, revision_ref, enterprise_id, project_id,
        format, media_type, object_locator, checksum, renderer_id, renderer_version,
        render_attempt_id, render_attempt_ref, request_payload_hash, input_hash,
        raw_receipt_ref, registered_at, created_by_principal_id,
        created_by_actor_snapshot_id, created_authorization_decision_id, source_command_id)
    VALUES (
        p_representation_id, p_artifact_id, p_revision_id, p_revision_ref,
        p_enterprise_id, p_project_id,
        p_format, p_media_type, p_object_locator, p_checksum, p_renderer_id, p_renderer_version,
        attempt_id, p_render_attempt_ref, p_request_payload_hash, p_input_hash,
        p_raw_receipt_ref, p_registered_at, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id, p_source_command_id);

    INSERT INTO artifact.representation_validation (
        validation_id, representation_id, artifact_id, revision_id, enterprise_id,
        project_id, binding_operation, validator_id, validator_version, outcome,
        request_payload_hash, input_hash, output_checksum, raw_receipt_ref,
        validated_by_principal_id, validated_by_actor_snapshot_id,
        validated_authorization_decision_id, source_command_id)
    VALUES (
        p_validation_id, p_representation_id, p_artifact_id, p_revision_id, p_enterprise_id,
        p_project_id, 'integration.get_render_attempt_binding', p_validator_id,
        p_validator_version, 'VERIFIED', p_request_payload_hash, p_input_hash,
        p_checksum, p_raw_receipt_ref, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id, p_source_command_id);

    RETURN QUERY SELECT 'OK'::text, p_representation_id;
END
$fn$;

REVOKE ALL ON FUNCTION artifact.guard_representation_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.guard_representation_validation_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.guard_representation_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION artifact.register_representation(
    uuid, uuid, uuid, jsonb, uuid, uuid, text, text, text, bytea, text, text, jsonb, text,
    bytea, bytea, jsonb, timestamptz, uuid, text, text, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION artifact.register_representation(
    uuid, uuid, uuid, jsonb, uuid, uuid, text, text, text, bytea, text, text, jsonb, text,
    bytea, bytea, jsonb, timestamptz, uuid, text, text, uuid, uuid, uuid, uuid) TO artifact_app;

ALTER TABLE artifact.representation ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.representation FORCE ROW LEVEL SECURITY;
CREATE POLICY representation_select ON artifact.representation
    FOR SELECT TO artifact_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY representation_owner_all ON artifact.representation
    FOR ALL TO artifact_owner USING (true) WITH CHECK (true);

ALTER TABLE artifact.representation_validation ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.representation_validation FORCE ROW LEVEL SECURITY;
CREATE POLICY representation_validation_select ON artifact.representation_validation
    FOR SELECT TO artifact_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY representation_validation_owner_all ON artifact.representation_validation
    FOR ALL TO artifact_owner USING (true) WITH CHECK (true);

REVOKE ALL ON artifact.representation, artifact.representation_validation FROM artifact_app;
GRANT SELECT ON artifact.representation, artifact.representation_validation TO artifact_app;

RESET ROLE;
