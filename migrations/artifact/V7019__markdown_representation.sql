-- #279: a separate registration operation; old format acceptance remains closed.
SET ROLE artifact_owner;
-- The SECURITY DEFINER registration function proves the pending owning receipt.
-- Even the owner read stays within the caller's established Project context.
CREATE POLICY markdown_registration_receipt_read ON artifact.command_receipt
 FOR SELECT TO artifact_owner
 USING (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id));
ALTER TABLE artifact.representation DROP CONSTRAINT representation_format_closed;
ALTER TABLE artifact.representation ADD CONSTRAINT representation_format_closed CHECK (
 (format ~ '^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$' AND format ~ '(^|[._])(pdf|docx|xlsx)$') OR format = 'zhiju.markdown');
ALTER TABLE artifact.representation DROP CONSTRAINT representation_format_media_closed;
ALTER TABLE artifact.representation ADD CONSTRAINT representation_format_media_closed CHECK (
 (format ~ '(^|[._])pdf$' AND media_type = 'application/pdf') OR
 (format ~ '(^|[._])docx$' AND media_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') OR
 (format ~ '(^|[._])xlsx$' AND media_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') OR
 (format = 'zhiju.markdown' AND media_type = 'text/markdown; charset=utf-8'));
ALTER TABLE artifact.representation_validation DROP CONSTRAINT representation_validation_operation_closed;
ALTER TABLE artifact.representation_validation ADD CONSTRAINT representation_validation_operation_closed CHECK (
 binding_operation IN ('integration.get_render_attempt_binding', 'integration.get_markdown_render_binding'));

CREATE OR REPLACE FUNCTION artifact.register_representation(
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
    IF p_format = 'zhiju.markdown' THEN
        RAISE EXCEPTION 'legacy registration does not accept Markdown' USING ERRCODE = '22023';
    END IF;
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

CREATE FUNCTION artifact.register_markdown_representation(
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
    IF p_format IS DISTINCT FROM 'zhiju.markdown'
       OR p_media_type IS DISTINCT FROM 'text/markdown; charset=utf-8'
       OR p_project_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM artifact.command_receipt c
          WHERE c.command_id = p_source_command_id
            AND c.command_type = 'artifact.register_markdown_representation'
            AND c.command_version = '1.0' AND c.target_id = p_representation_id
            AND c.outcome = 'PENDING') THEN
        RAISE EXCEPTION 'Markdown registration operation mismatch' USING ERRCODE = '22023';
    END IF;
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
        p_project_id, 'integration.get_markdown_render_binding', p_validator_id,
        p_validator_version, 'VERIFIED', p_request_payload_hash, p_input_hash,
        p_checksum, p_raw_receipt_ref, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id, p_source_command_id);

    RETURN QUERY SELECT 'OK'::text, p_representation_id;
END
$fn$;

REVOKE ALL ON FUNCTION artifact.register_markdown_representation(
 uuid, uuid, uuid, jsonb, uuid, uuid, text, text, text, bytea, text, text, jsonb, text,
 bytea, bytea, jsonb, timestamptz, uuid, text, text, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION artifact.register_markdown_representation(
 uuid, uuid, uuid, jsonb, uuid, uuid, text, text, text, bytea, text, text, jsonb, text,
 bytea, bytea, jsonb, timestamptz, uuid, text, text, uuid, uuid, uuid, uuid) TO artifact_app;
RESET ROLE;
