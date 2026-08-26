-- IM-03 WI-05 (issue #61): Project-owned SourceMaterial custody.
--
-- SourceMaterial is the smallest durable unit for an incoming original
-- material. The root owns the immutable descriptor and custody state;
-- origin and validation rows are append-only history/facts. No table in this
-- migration creates CustomerMaterial, Baseline, Fact or Evidence records.
-- Canonical JSON/hash equality remains an application write-boundary rule;
-- promoted scope and validation facts are additionally guarded in SQL.

SET ROLE enterprise_project_owner;

-- ---------------------------------------------------------------------------
-- source_material: immutable original-content custody root.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.source_material (
    source_material_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    submitted_by_principal_id uuid NOT NULL,
    submitted_by_ref jsonb NOT NULL,
    received_at timestamptz NOT NULL,
    original_name text NOT NULL,
    media_type text NOT NULL,
    byte_length bigint NOT NULL,
    content_hash bytea NOT NULL,
    staged_object_ref text NOT NULL,
    descriptor_payload_hash bytea NOT NULL,
    custody_status text NOT NULL DEFAULT 'RECEIVED',
    processing_status text NOT NULL DEFAULT 'NOT_PROCESSED',
    duplicate_of_source_material_id uuid,
    accepted_object_ref text,
    accepted_at timestamptz,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    retention_class text NOT NULL,
    CONSTRAINT source_material_scope_unique UNIQUE (enterprise_id, project_id, source_material_id),
    CONSTRAINT source_material_byte_length_nonnegative CHECK (byte_length >= 0),
    CONSTRAINT source_material_content_hash_len CHECK (octet_length(content_hash) = 32),
    CONSTRAINT source_material_descriptor_hash_len CHECK (octet_length(descriptor_payload_hash) = 32),
    CONSTRAINT source_material_custody_closed CHECK (
        custody_status IN ('RECEIVED', 'ACCEPTED', 'QUARANTINED', 'REJECTED', 'ARCHIVED')),
    CONSTRAINT source_material_processing_closed CHECK (
        processing_status IN ('NOT_PROCESSED', 'PROCESSING', 'PROCESSED',
                              'PARTIALLY_PROCESSED', 'UNREADABLE')),
    CONSTRAINT source_material_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT source_material_text_nonempty CHECK (
        length(original_name) > 0
        AND length(media_type) > 0
        AND length(staged_object_ref) > 0
        AND length(retention_class) > 0),
    CONSTRAINT source_material_duplicate_not_self CHECK (
        duplicate_of_source_material_id IS NULL
        OR duplicate_of_source_material_id <> source_material_id),
    CONSTRAINT source_material_acceptance_shape CHECK (
        ((custody_status IN ('ACCEPTED', 'ARCHIVED'))
            AND accepted_object_ref IS NOT NULL
            AND accepted_at IS NOT NULL)
        OR ((custody_status IN ('RECEIVED', 'QUARANTINED', 'REJECTED'))
            AND accepted_object_ref IS NULL
            AND accepted_at IS NULL))
);

ALTER TABLE enterprise_project.source_material
    ADD CONSTRAINT source_material_project_fk
    FOREIGN KEY (enterprise_id, project_id)
    REFERENCES enterprise_project.project (enterprise_id, project_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.source_material
    ADD CONSTRAINT source_material_duplicate_fk
    FOREIGN KEY (enterprise_id, project_id, duplicate_of_source_material_id)
    REFERENCES enterprise_project.source_material
        (enterprise_id, project_id, source_material_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX source_material_project_received_idx
    ON enterprise_project.source_material (enterprise_id, project_id, received_at, source_material_id);
CREATE INDEX source_material_project_hash_idx
    ON enterprise_project.source_material (enterprise_id, project_id, content_hash);

CREATE FUNCTION enterprise_project.guard_source_material_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.source_material_id IS DISTINCT FROM OLD.source_material_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.submitted_by_principal_id IS DISTINCT FROM OLD.submitted_by_principal_id
       OR NEW.submitted_by_ref IS DISTINCT FROM OLD.submitted_by_ref
       OR NEW.received_at IS DISTINCT FROM OLD.received_at
       OR NEW.original_name IS DISTINCT FROM OLD.original_name
       OR NEW.media_type IS DISTINCT FROM OLD.media_type
       OR NEW.byte_length IS DISTINCT FROM OLD.byte_length
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.staged_object_ref IS DISTINCT FROM OLD.staged_object_ref
       OR NEW.descriptor_payload_hash IS DISTINCT FROM OLD.descriptor_payload_hash
       OR NEW.processing_status IS DISTINCT FROM OLD.processing_status
       OR NEW.duplicate_of_source_material_id IS DISTINCT FROM OLD.duplicate_of_source_material_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.retention_class IS DISTINCT FROM OLD.retention_class THEN
        RAISE EXCEPTION 'source_material original descriptor is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.custody_status IS DISTINCT FROM OLD.custody_status
       AND NOT (
           (OLD.custody_status = 'RECEIVED'
               AND NEW.custody_status IN ('ACCEPTED', 'QUARANTINED', 'REJECTED'))
           OR (OLD.custody_status = 'ACCEPTED' AND NEW.custody_status = 'ARCHIVED')) THEN
        RAISE EXCEPTION 'source_material custody transition is not allowed'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_source_material_immutable() FROM PUBLIC;

CREATE TRIGGER source_material_immutable_guard
    BEFORE UPDATE ON enterprise_project.source_material
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_source_material_immutable();

-- ---------------------------------------------------------------------------
-- source_material_origin: immutable external provenance history.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.source_material_origin (
    source_material_origin_id uuid PRIMARY KEY,
    source_material_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    origin_ref jsonb NOT NULL,
    origin_ref_hash bytea NOT NULL,
    received_at timestamptz NOT NULL,
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    source_command_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT source_material_origin_hash_len CHECK (octet_length(origin_ref_hash) = 32),
    CONSTRAINT source_material_origin_scope_unique
        UNIQUE (enterprise_id, project_id, source_material_origin_id)
);

ALTER TABLE enterprise_project.source_material_origin
    ADD CONSTRAINT source_material_origin_root_fk
    FOREIGN KEY (enterprise_id, project_id, source_material_id)
    REFERENCES enterprise_project.source_material
        (enterprise_id, project_id, source_material_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX source_material_origin_root_idx
    ON enterprise_project.source_material_origin (source_material_id, recorded_at, source_material_origin_id);

CREATE FUNCTION enterprise_project.guard_source_material_origin_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.source_material_origin_id IS DISTINCT FROM OLD.source_material_origin_id
       OR NEW.source_material_id IS DISTINCT FROM OLD.source_material_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.origin_ref IS DISTINCT FROM OLD.origin_ref
       OR NEW.origin_ref_hash IS DISTINCT FROM OLD.origin_ref_hash
       OR NEW.received_at IS DISTINCT FROM OLD.received_at
       OR NEW.recorded_by_principal_id IS DISTINCT FROM OLD.recorded_by_principal_id
       OR NEW.recorded_by_actor_snapshot_id IS DISTINCT FROM OLD.recorded_by_actor_snapshot_id
       OR NEW.authorization_decision_id IS DISTINCT FROM OLD.authorization_decision_id
       OR NEW.source_command_id IS DISTINCT FROM OLD.source_command_id
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at THEN
        RAISE EXCEPTION 'source_material_origin history is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_source_material_origin_immutable() FROM PUBLIC;

CREATE TRIGGER source_material_origin_immutable_guard
    BEFORE UPDATE ON enterprise_project.source_material_origin
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_source_material_origin_immutable();

-- ---------------------------------------------------------------------------
-- source_material_validation: immutable validation facts.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.source_material_validation (
    validation_id uuid PRIMARY KEY,
    source_material_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    validation_kind text NOT NULL,
    outcome text NOT NULL,
    validated_object_ref text NOT NULL,
    validated_content_hash bytea NOT NULL,
    validated_byte_length bigint NOT NULL,
    validator_id text NOT NULL,
    validator_version text NOT NULL,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    source_command_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT source_material_validation_kind_closed CHECK (
        validation_kind IN ('SECURITY', 'INTEGRITY')),
    CONSTRAINT source_material_validation_outcome_closed CHECK (
        outcome IN ('PASSED', 'FAILED')),
    CONSTRAINT source_material_validation_hash_len CHECK (
        octet_length(validated_content_hash) = 32
        AND octet_length(payload_hash) = 32),
    CONSTRAINT source_material_validation_byte_length_nonnegative CHECK (
        validated_byte_length >= 0),
    CONSTRAINT source_material_validation_text_nonempty CHECK (
        length(validated_object_ref) > 0
        AND length(validator_id) > 0
        AND length(validator_version) > 0),
    CONSTRAINT source_material_validation_scope_unique
        UNIQUE (enterprise_id, project_id, validation_id)
);

ALTER TABLE enterprise_project.source_material_validation
    ADD CONSTRAINT source_material_validation_root_fk
    FOREIGN KEY (enterprise_id, project_id, source_material_id)
    REFERENCES enterprise_project.source_material
        (enterprise_id, project_id, source_material_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX source_material_validation_root_idx
    ON enterprise_project.source_material_validation
        (source_material_id, validation_kind, recorded_at, validation_id);

CREATE FUNCTION enterprise_project.guard_source_material_validation_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.payload->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.payload->>'projectId' IS DISTINCT FROM NEW.project_id::text
       OR NEW.payload->>'sourceMaterialId' IS DISTINCT FROM NEW.source_material_id::text
       OR NEW.payload->>'validationKind' IS DISTINCT FROM NEW.validation_kind
       OR NEW.payload->>'outcome' IS DISTINCT FROM NEW.outcome
       OR NEW.payload->>'validatedObjectRef' IS DISTINCT FROM NEW.validated_object_ref
       OR NEW.payload->>'validatedContentHash' IS DISTINCT FROM encode(NEW.validated_content_hash, 'hex')
       OR NEW.payload->>'validatedByteLength' IS DISTINCT FROM NEW.validated_byte_length::text
       OR NEW.payload->>'validatorId' IS DISTINCT FROM NEW.validator_id
       OR NEW.payload->>'validatorVersion' IS DISTINCT FROM NEW.validator_version THEN
        RAISE EXCEPTION 'source_material_validation promoted mirror mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_source_material_validation_mirror() FROM PUBLIC;

CREATE TRIGGER source_material_validation_mirror_guard
    BEFORE INSERT OR UPDATE ON enterprise_project.source_material_validation
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_source_material_validation_mirror();

CREATE FUNCTION enterprise_project.guard_source_material_validation_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.validation_id IS DISTINCT FROM OLD.validation_id
       OR NEW.source_material_id IS DISTINCT FROM OLD.source_material_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.validation_kind IS DISTINCT FROM OLD.validation_kind
       OR NEW.outcome IS DISTINCT FROM OLD.outcome
       OR NEW.validated_object_ref IS DISTINCT FROM OLD.validated_object_ref
       OR NEW.validated_content_hash IS DISTINCT FROM OLD.validated_content_hash
       OR NEW.validated_byte_length IS DISTINCT FROM OLD.validated_byte_length
       OR NEW.validator_id IS DISTINCT FROM OLD.validator_id
       OR NEW.validator_version IS DISTINCT FROM OLD.validator_version
       OR NEW.payload IS DISTINCT FROM OLD.payload
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
       OR NEW.canonicalization_version IS DISTINCT FROM OLD.canonicalization_version
       OR NEW.recorded_by_principal_id IS DISTINCT FROM OLD.recorded_by_principal_id
       OR NEW.recorded_by_actor_snapshot_id IS DISTINCT FROM OLD.recorded_by_actor_snapshot_id
       OR NEW.authorization_decision_id IS DISTINCT FROM OLD.authorization_decision_id
       OR NEW.source_command_id IS DISTINCT FROM OLD.source_command_id
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at THEN
        RAISE EXCEPTION 'source_material_validation history is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_source_material_validation_immutable() FROM PUBLIC;

CREATE TRIGGER source_material_validation_immutable_guard
    BEFORE UPDATE ON enterprise_project.source_material_validation
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_source_material_validation_immutable();

-- ---------------------------------------------------------------------------
-- Grants and Project RLS. All rows require an explicitly established
-- Project context; an Enterprise-only context cannot read these tables.
-- ---------------------------------------------------------------------------

REVOKE UPDATE ON enterprise_project.source_material FROM enterprise_project_app;
GRANT UPDATE (custody_status, accepted_object_ref, accepted_at,
              aggregate_version, updated_at, last_command_id)
    ON enterprise_project.source_material TO enterprise_project_app;
REVOKE DELETE ON enterprise_project.source_material FROM enterprise_project_app;
REVOKE UPDATE, DELETE ON enterprise_project.source_material_origin FROM enterprise_project_app;
REVOKE UPDATE, DELETE ON enterprise_project.source_material_validation FROM enterprise_project_app;

ALTER TABLE enterprise_project.source_material ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.source_material FORCE ROW LEVEL SECURITY;
CREATE POLICY source_material_select ON enterprise_project.source_material
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY source_material_insert ON enterprise_project.source_material
    FOR INSERT TO enterprise_project_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY source_material_update ON enterprise_project.source_material
    FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.source_material_origin ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.source_material_origin FORCE ROW LEVEL SECURITY;
CREATE POLICY source_material_origin_select ON enterprise_project.source_material_origin
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY source_material_origin_insert ON enterprise_project.source_material_origin
    FOR INSERT TO enterprise_project_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.source_material_validation ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.source_material_validation FORCE ROW LEVEL SECURITY;
CREATE POLICY source_material_validation_select ON enterprise_project.source_material_validation
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY source_material_validation_insert ON enterprise_project.source_material_validation
    FOR INSERT TO enterprise_project_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

RESET ROLE;
