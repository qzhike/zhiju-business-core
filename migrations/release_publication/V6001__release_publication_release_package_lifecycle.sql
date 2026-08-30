-- IM-05 WI-06 (issue #126): Release draft and frozen package lifecycle.
-- This migration is forward-only. V6000 remains the technical-table baseline;
-- business mutations cross owner SECURITY DEFINER functions only.

SET ROLE release_publication_owner;

CREATE TABLE release_publication.release_record (
    release_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    artifact_ref jsonb NOT NULL,
    revision_ref jsonb NOT NULL,
    revision_content_hash bytea NOT NULL,
    release_number text NOT NULL,
    purpose text NOT NULL,
    requested_effective_at timestamptz,
    quality_profile_ref jsonb NOT NULL,
    revision_acceptance_snapshot_ref jsonb NOT NULL,
    approval_bundle_snapshot_ref jsonb NOT NULL,
    supersedes_release_ref jsonb,
    representation_selections jsonb NOT NULL DEFAULT '[]'::jsonb,
    representation_selection_reason jsonb,
    destination_definitions jsonb NOT NULL DEFAULT '[]'::jsonb,
    recipient_scope_snapshot_ref jsonb,
    status text NOT NULL DEFAULT 'DRAFT',
    aggregate_version bigint NOT NULL DEFAULT 1,
    package_id uuid,
    package_hash bytea,
    preparation_validation_ref jsonb,
    cancel_reason jsonb,
    cancelled_at timestamptz,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_by_principal_id uuid NOT NULL,
    updated_by_actor_snapshot_id uuid NOT NULL,
    updated_authorization_decision_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid NOT NULL,
    CONSTRAINT release_record_revision_hash_len CHECK (octet_length(revision_content_hash) = 32),
    CONSTRAINT release_record_package_hash_len CHECK (
        package_hash IS NULL OR octet_length(package_hash) = 32),
    CONSTRAINT release_record_release_number_nonempty CHECK (length(btrim(release_number)) > 0),
    CONSTRAINT release_record_purpose_closed CHECK (
        purpose IN ('CUSTOMER_DELIVERY', 'REGULATORY_SUBMISSION',
                    'INTERNAL_EFFECTIVE_USE', 'FEISHU_PUBLICATION', 'CONTROLLED_EXPORT')),
    CONSTRAINT release_record_status_closed CHECK (
        status IN ('DRAFT', 'PREPARED', 'CANCELLED')),
    CONSTRAINT release_record_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT release_record_definition_object CHECK (jsonb_typeof(artifact_ref) = 'object'
        AND jsonb_typeof(revision_ref) = 'object'
        AND jsonb_typeof(quality_profile_ref) = 'object'
        AND jsonb_typeof(revision_acceptance_snapshot_ref) = 'object'),
    CONSTRAINT release_record_selection_array CHECK (jsonb_typeof(representation_selections) = 'array'),
    CONSTRAINT release_record_destination_array CHECK (jsonb_typeof(destination_definitions) = 'array'),
    CONSTRAINT release_record_package_pair CHECK (
        (package_id IS NULL AND package_hash IS NULL)
        OR (package_id IS NOT NULL AND package_hash IS NOT NULL)),
    CONSTRAINT release_record_draft_without_package CHECK (
        status <> 'DRAFT' OR (package_id IS NULL AND package_hash IS NULL
                              AND preparation_validation_ref IS NULL)),
    CONSTRAINT release_record_prepared_with_package CHECK (
        status <> 'PREPARED' OR (package_id IS NOT NULL AND package_hash IS NOT NULL
                                 AND preparation_validation_ref IS NOT NULL)),
    CONSTRAINT release_record_cancelled_at_shape CHECK (
        status <> 'CANCELLED' OR cancelled_at IS NOT NULL),
    CONSTRAINT release_record_release_number_unique UNIQUE (enterprise_id, release_number)
);

CREATE INDEX release_record_scope_status_idx
    ON release_publication.release_record (enterprise_id, project_id, status, updated_at DESC);
CREATE INDEX release_record_package_idx
    ON release_publication.release_record (package_id)
    WHERE package_id IS NOT NULL;

CREATE TABLE release_publication.release_package (
    package_id uuid PRIMARY KEY,
    release_id uuid NOT NULL UNIQUE
        REFERENCES release_publication.release_record (release_id) ON DELETE RESTRICT,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    canonical_revision_ref jsonb NOT NULL,
    approval_bundle_snapshot_ref jsonb NOT NULL,
    recipient_scope_snapshot_ref jsonb NOT NULL,
    preparation_validation_ref jsonb NOT NULL,
    package_hash bytea NOT NULL,
    package_payload_hash bytea NOT NULL,
    canonical_manifest jsonb NOT NULL,
    package_definition jsonb NOT NULL,
    prepared_at timestamptz NOT NULL,
    frozen_at timestamptz NOT NULL,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT release_package_hash_len CHECK (octet_length(package_hash) = 32),
    CONSTRAINT release_package_payload_hash_len CHECK (octet_length(package_payload_hash) = 32),
    CONSTRAINT release_package_manifest_object CHECK (jsonb_typeof(canonical_manifest) = 'object'),
    CONSTRAINT release_package_definition_object CHECK (jsonb_typeof(package_definition) = 'object'),
    CONSTRAINT release_package_revision_ref_object CHECK (jsonb_typeof(canonical_revision_ref) = 'object'),
    CONSTRAINT release_package_approval_ref_object CHECK (jsonb_typeof(approval_bundle_snapshot_ref) = 'object'),
    CONSTRAINT release_package_recipient_ref_object CHECK (jsonb_typeof(recipient_scope_snapshot_ref) = 'object'),
    CONSTRAINT release_package_validation_ref_object CHECK (jsonb_typeof(preparation_validation_ref) = 'object')
);

CREATE INDEX release_package_scope_time_idx
    ON release_publication.release_package (enterprise_id, frozen_at DESC);

CREATE TABLE release_publication.release_package_item (
    package_id uuid NOT NULL
        REFERENCES release_publication.release_package (package_id) ON DELETE RESTRICT,
    ordinal integer NOT NULL,
    representation_id uuid NOT NULL,
    representation_ref jsonb NOT NULL,
    representation_checksum bytea NOT NULL,
    renderer_id text NOT NULL,
    renderer_version text NOT NULL,
    display_name text NOT NULL,
    required boolean NOT NULL,
    release_role text NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT release_package_item_pkey PRIMARY KEY (package_id, ordinal),
    CONSTRAINT release_package_item_ordinal_nonnegative CHECK (ordinal >= 0),
    CONSTRAINT release_package_item_checksum_len CHECK (octet_length(representation_checksum) = 32),
    CONSTRAINT release_package_item_ref_object CHECK (jsonb_typeof(representation_ref) = 'object'),
    CONSTRAINT release_package_item_display_name_nonempty CHECK (length(btrim(display_name)) > 0),
    CONSTRAINT release_package_item_renderer_nonempty CHECK (
        length(btrim(renderer_id)) > 0 AND length(btrim(renderer_version)) > 0),
    CONSTRAINT release_package_item_unique_representation UNIQUE (package_id, representation_id)
);

CREATE INDEX release_package_item_representation_idx
    ON release_publication.release_package_item (representation_id);

CREATE TABLE release_publication.release_destination (
    package_id uuid NOT NULL
        REFERENCES release_publication.release_package (package_id) ON DELETE RESTRICT,
    destination_id uuid NOT NULL,
    destination_type text NOT NULL,
    destination_ref jsonb NOT NULL,
    recipient_scope_ref jsonb NOT NULL,
    purpose text NOT NULL,
    required boolean NOT NULL,
    required_receipt_kind text NOT NULL,
    delivery_policy_ref jsonb NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    created_authorization_decision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT release_destination_pkey PRIMARY KEY (package_id, destination_id),
    CONSTRAINT release_destination_type_nonempty CHECK (length(btrim(destination_type)) > 0),
    CONSTRAINT release_destination_purpose_nonempty CHECK (length(btrim(purpose)) > 0),
    CONSTRAINT release_destination_receipt_kind_nonempty CHECK (length(btrim(required_receipt_kind)) > 0),
    CONSTRAINT release_destination_ref_objects CHECK (
        jsonb_typeof(destination_ref) = 'object'
        AND jsonb_typeof(recipient_scope_ref) = 'object'
        AND jsonb_typeof(delivery_policy_ref) = 'object')
);

CREATE INDEX release_destination_scope_idx
    ON release_publication.release_destination (enterprise_id, project_id, destination_id);

-- Every business write is attributed to the same trusted transaction context
-- used by the technical tables. This function is only reachable through owner
-- functions and trigger execution, never as an application helper.
CREATE FUNCTION release_publication.assert_business_write_context(
    p_enterprise_id uuid,
    p_project_id uuid,
    p_principal_id uuid,
    p_actor_snapshot_id uuid,
    p_authorization_decision_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    IF p_principal_id IS DISTINCT FROM platform_security.context_principal_id()
       OR p_actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
       OR p_authorization_decision_id IS DISTINCT FROM (
           SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'release business attribution does not match trusted context'
            USING ERRCODE = '42501';
    END IF;
    IF (p_project_id IS NULL AND NOT platform_security.context_allows_enterprise(p_enterprise_id))
       OR (p_project_id IS NOT NULL
           AND NOT platform_security.context_allows_project(p_enterprise_id, p_project_id)) THEN
        RAISE EXCEPTION 'release business scope is not allowed'
            USING ERRCODE = '42501';
    END IF;
END
$fn$;

CREATE FUNCTION release_publication.guard_business_fact_insert() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    PERFORM release_publication.assert_business_write_context(
        NEW.enterprise_id,
        NEW.project_id,
        NEW.created_by_principal_id,
        NEW.created_by_actor_snapshot_id,
        NEW.created_authorization_decision_id);
    RETURN NEW;
END
$fn$;

CREATE FUNCTION release_publication.guard_append_only_fact() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    RAISE EXCEPTION 'release package facts are append-only'
        USING ERRCODE = '55000';
END
$fn$;

CREATE FUNCTION release_publication.guard_release_record_update() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    IF OLD.release_id IS DISTINCT FROM NEW.release_id
       OR OLD.enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR OLD.project_id IS DISTINCT FROM NEW.project_id
       OR OLD.artifact_ref IS DISTINCT FROM NEW.artifact_ref
       OR OLD.revision_ref IS DISTINCT FROM NEW.revision_ref
       OR OLD.revision_content_hash IS DISTINCT FROM NEW.revision_content_hash
       OR OLD.release_number IS DISTINCT FROM NEW.release_number
       OR OLD.purpose IS DISTINCT FROM NEW.purpose
       OR OLD.requested_effective_at IS DISTINCT FROM NEW.requested_effective_at
       OR OLD.quality_profile_ref IS DISTINCT FROM NEW.quality_profile_ref
       OR OLD.revision_acceptance_snapshot_ref IS DISTINCT FROM NEW.revision_acceptance_snapshot_ref
       OR OLD.approval_bundle_snapshot_ref IS DISTINCT FROM NEW.approval_bundle_snapshot_ref
       OR OLD.supersedes_release_ref IS DISTINCT FROM NEW.supersedes_release_ref
       OR OLD.created_by_principal_id IS DISTINCT FROM NEW.created_by_principal_id
       OR OLD.created_by_actor_snapshot_id IS DISTINCT FROM NEW.created_by_actor_snapshot_id
       OR OLD.created_authorization_decision_id IS DISTINCT FROM NEW.created_authorization_decision_id
       OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'release identity facts are immutable'
            USING ERRCODE = '55000';
    END IF;
    IF OLD.status = 'CANCELLED' THEN
        RAISE EXCEPTION 'cancelled Release is immutable'
            USING ERRCODE = '55000';
    END IF;
    IF OLD.status = 'PREPARED'
       AND (OLD.representation_selections IS DISTINCT FROM NEW.representation_selections
            OR OLD.representation_selection_reason IS DISTINCT FROM NEW.representation_selection_reason
            OR OLD.destination_definitions IS DISTINCT FROM NEW.destination_definitions
            OR OLD.recipient_scope_snapshot_ref IS DISTINCT FROM NEW.recipient_scope_snapshot_ref
            OR OLD.package_id IS DISTINCT FROM NEW.package_id
            OR OLD.package_hash IS DISTINCT FROM NEW.package_hash
            OR OLD.preparation_validation_ref IS DISTINCT FROM NEW.preparation_validation_ref) THEN
        RAISE EXCEPTION 'prepared Release package facts are immutable'
            USING ERRCODE = '55000';
    END IF;
    IF OLD.status = 'DRAFT' AND NEW.status = 'DRAFT'
       AND (NEW.package_id IS NOT NULL OR NEW.package_hash IS NOT NULL
            OR NEW.preparation_validation_ref IS NOT NULL) THEN
        RAISE EXCEPTION 'DRAFT Release cannot carry a package'
            USING ERRCODE = '55000';
    END IF;
    IF OLD.status = 'PREPARED' AND NEW.status <> 'CANCELLED' THEN
        RAISE EXCEPTION 'PREPARED Release only permits cancellation'
            USING ERRCODE = '55000';
    END IF;
    IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT', 'PREPARED', 'CANCELLED')
       OR OLD.status = 'PREPARED' AND NEW.status <> 'CANCELLED' THEN
        RAISE EXCEPTION 'invalid Release status transition'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
        RAISE EXCEPTION 'Release aggregate version must advance by one'
            USING ERRCODE = '40001';
    END IF;
    IF NEW.status = 'PREPARED'
       AND (NEW.package_id IS NULL OR NEW.package_hash IS NULL
            OR NEW.preparation_validation_ref IS NULL) THEN
        RAISE EXCEPTION 'PREPARED Release requires a frozen package'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$fn$;

CREATE TRIGGER release_record_insert_guard
    BEFORE INSERT ON release_publication.release_record
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_business_fact_insert();
CREATE TRIGGER release_record_update_guard
    BEFORE UPDATE ON release_publication.release_record
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_release_record_update();
CREATE TRIGGER release_package_insert_guard
    BEFORE INSERT ON release_publication.release_package
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_business_fact_insert();
CREATE TRIGGER release_package_immutable_guard
    BEFORE UPDATE OR DELETE ON release_publication.release_package
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_append_only_fact();
CREATE TRIGGER release_package_item_insert_guard
    BEFORE INSERT ON release_publication.release_package_item
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_business_fact_insert();
CREATE TRIGGER release_package_item_immutable_guard
    BEFORE UPDATE OR DELETE ON release_publication.release_package_item
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_append_only_fact();
CREATE TRIGGER release_destination_insert_guard
    BEFORE INSERT ON release_publication.release_destination
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_business_fact_insert();
CREATE TRIGGER release_destination_immutable_guard
    BEFORE UPDATE OR DELETE ON release_publication.release_destination
    FOR EACH ROW EXECUTE FUNCTION release_publication.guard_append_only_fact();

-- ---------------------------------------------------------------------------
-- Owner write functions
-- ---------------------------------------------------------------------------

CREATE FUNCTION release_publication.create_release_draft(
    p_release_id uuid,
    p_enterprise_id uuid,
    p_project_id uuid,
    p_artifact_ref jsonb,
    p_revision_ref jsonb,
    p_revision_content_hash bytea,
    p_release_number text,
    p_purpose text,
    p_requested_effective_at timestamptz,
    p_quality_profile_ref jsonb,
    p_revision_acceptance_snapshot_ref jsonb,
    p_approval_bundle_snapshot_ref jsonb,
    p_supersedes_release_ref jsonb,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
    PERFORM release_publication.assert_business_write_context(
        p_enterprise_id, p_project_id, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id);
    IF p_release_id IS NULL OR p_artifact_ref IS NULL OR jsonb_typeof(p_artifact_ref) <> 'object'
       OR p_revision_ref IS NULL OR jsonb_typeof(p_revision_ref) <> 'object'
       OR p_quality_profile_ref IS NULL OR jsonb_typeof(p_quality_profile_ref) <> 'object'
       OR p_revision_acceptance_snapshot_ref IS NULL
       OR jsonb_typeof(p_revision_acceptance_snapshot_ref) <> 'object'
       OR p_approval_bundle_snapshot_ref IS NULL
       OR jsonb_typeof(p_approval_bundle_snapshot_ref) <> 'object'
       OR p_revision_content_hash IS NULL OR octet_length(p_revision_content_hash) <> 32
       OR p_release_number IS NULL OR length(btrim(p_release_number)) = 0
       OR p_purpose NOT IN ('CUSTOMER_DELIVERY', 'REGULATORY_SUBMISSION',
                            'INTERNAL_EFFECTIVE_USE', 'FEISHU_PUBLICATION', 'CONTROLLED_EXPORT') THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint;
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM release_publication.release_record WHERE release_id = p_release_id)
       OR EXISTS (SELECT 1 FROM release_publication.release_record
                  WHERE enterprise_id = p_enterprise_id AND release_number = p_release_number) THEN
        RETURN QUERY SELECT 'CONFLICT', NULL::bigint;
        RETURN;
    END IF;
    INSERT INTO release_publication.release_record (
        release_id, enterprise_id, project_id, artifact_ref, revision_ref,
        revision_content_hash, release_number, purpose, requested_effective_at,
        quality_profile_ref, revision_acceptance_snapshot_ref,
        approval_bundle_snapshot_ref, supersedes_release_ref, status,
        aggregate_version, created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, updated_by_principal_id,
        updated_by_actor_snapshot_id, updated_authorization_decision_id,
        last_command_id)
    VALUES (
        p_release_id, p_enterprise_id, p_project_id, p_artifact_ref, p_revision_ref,
        p_revision_content_hash, p_release_number, p_purpose, p_requested_effective_at,
        p_quality_profile_ref, p_revision_acceptance_snapshot_ref,
        p_approval_bundle_snapshot_ref, p_supersedes_release_ref, 'DRAFT', 1,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_created_by_principal_id,
        p_created_by_actor_snapshot_id, p_created_authorization_decision_id,
        p_source_command_id);
    RETURN QUERY SELECT 'OK', 1::bigint;
END
$fn$;

CREATE FUNCTION release_publication.replace_release_selections(
    p_release_id uuid,
    p_expected_version bigint,
    p_selections jsonb,
    p_selection_reason jsonb,
    p_updated_by_principal_id uuid,
    p_updated_by_actor_snapshot_id uuid,
    p_updated_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    release_row release_publication.release_record%ROWTYPE;
BEGIN
    IF p_selections IS NULL OR jsonb_typeof(p_selections) <> 'array'
       OR jsonb_array_length(p_selections) = 0
       OR p_selection_reason IS NULL OR jsonb_typeof(p_selection_reason) <> 'object' THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint;
        RETURN;
    END IF;
    SELECT * INTO release_row
      FROM release_publication.release_record
     WHERE release_id = p_release_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint; RETURN; END IF;
    PERFORM release_publication.assert_business_write_context(
        release_row.enterprise_id, release_row.project_id,
        p_updated_by_principal_id, p_updated_by_actor_snapshot_id,
        p_updated_authorization_decision_id);
    IF release_row.aggregate_version <> p_expected_version THEN
        RETURN QUERY SELECT 'CONFLICT', release_row.aggregate_version;
        RETURN;
    END IF;
    IF release_row.status <> 'DRAFT' THEN
        RETURN QUERY SELECT 'FROZEN', release_row.aggregate_version;
        RETURN;
    END IF;
    UPDATE release_publication.release_record
       SET representation_selections = p_selections,
           representation_selection_reason = p_selection_reason,
           aggregate_version = release_row.aggregate_version + 1,
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           updated_authorization_decision_id = p_updated_authorization_decision_id,
           updated_at = clock_timestamp(),
           last_command_id = p_source_command_id
     WHERE release_id = p_release_id;
    RETURN QUERY SELECT 'OK', (release_row.aggregate_version + 1);
END
$fn$;

CREATE FUNCTION release_publication.replace_release_destinations(
    p_release_id uuid,
    p_expected_version bigint,
    p_destinations jsonb,
    p_recipient_scope_snapshot_ref jsonb,
    p_updated_by_principal_id uuid,
    p_updated_by_actor_snapshot_id uuid,
    p_updated_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    release_row release_publication.release_record%ROWTYPE;
BEGIN
    IF p_destinations IS NULL OR jsonb_typeof(p_destinations) <> 'array'
       OR jsonb_array_length(p_destinations) = 0
       OR p_recipient_scope_snapshot_ref IS NULL
       OR jsonb_typeof(p_recipient_scope_snapshot_ref) <> 'object' THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint;
        RETURN;
    END IF;
    SELECT * INTO release_row
      FROM release_publication.release_record
     WHERE release_id = p_release_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint; RETURN; END IF;
    PERFORM release_publication.assert_business_write_context(
        release_row.enterprise_id, release_row.project_id,
        p_updated_by_principal_id, p_updated_by_actor_snapshot_id,
        p_updated_authorization_decision_id);
    IF release_row.aggregate_version <> p_expected_version THEN
        RETURN QUERY SELECT 'CONFLICT', release_row.aggregate_version;
        RETURN;
    END IF;
    IF release_row.status <> 'DRAFT' THEN
        RETURN QUERY SELECT 'FROZEN', release_row.aggregate_version;
        RETURN;
    END IF;
    UPDATE release_publication.release_record
       SET destination_definitions = p_destinations,
           recipient_scope_snapshot_ref = p_recipient_scope_snapshot_ref,
           aggregate_version = release_row.aggregate_version + 1,
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           updated_authorization_decision_id = p_updated_authorization_decision_id,
           updated_at = clock_timestamp(),
           last_command_id = p_source_command_id
     WHERE release_id = p_release_id;
    RETURN QUERY SELECT 'OK', (release_row.aggregate_version + 1);
END
$fn$;

CREATE FUNCTION release_publication.prepare_release(
    p_release_id uuid,
    p_expected_version bigint,
    p_package_id uuid,
    p_package_hash bytea,
    p_package_payload_hash bytea,
    p_package_definition jsonb,
    p_canonical_manifest jsonb,
    p_preparation_validation_ref jsonb,
    p_items jsonb,
    p_destinations jsonb,
    p_prepared_at timestamptz,
    p_created_by_principal_id uuid,
    p_created_by_actor_snapshot_id uuid,
    p_created_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    release_row release_publication.release_record%ROWTYPE;
    item_row jsonb;
    destination_row jsonb;
    next_version bigint;
BEGIN
    IF p_package_id IS NULL OR p_package_hash IS NULL OR octet_length(p_package_hash) <> 32
       OR p_package_payload_hash IS NULL OR octet_length(p_package_payload_hash) <> 32
       OR p_package_definition IS NULL OR jsonb_typeof(p_package_definition) <> 'object'
       OR p_canonical_manifest IS NULL OR jsonb_typeof(p_canonical_manifest) <> 'object'
       OR p_preparation_validation_ref IS NULL
       OR jsonb_typeof(p_preparation_validation_ref) <> 'object'
       OR p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
       OR jsonb_array_length(p_items) = 0
       OR p_destinations IS NULL OR jsonb_typeof(p_destinations) <> 'array'
       OR jsonb_array_length(p_destinations) = 0
       OR p_prepared_at IS NULL THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint;
        RETURN;
    END IF;
    SELECT * INTO release_row
      FROM release_publication.release_record
     WHERE release_id = p_release_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint; RETURN; END IF;
    PERFORM release_publication.assert_business_write_context(
        release_row.enterprise_id, release_row.project_id,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id);
    IF release_row.aggregate_version <> p_expected_version THEN
        RETURN QUERY SELECT 'CONFLICT', release_row.aggregate_version;
        RETURN;
    END IF;
    IF release_row.status <> 'DRAFT' THEN
        IF release_row.package_hash IS NOT NULL
           AND release_row.package_hash = p_package_hash THEN
            RETURN QUERY SELECT 'FROZEN', release_row.aggregate_version;
        ELSE
            RETURN QUERY SELECT 'MULTIPLE_HASH', release_row.aggregate_version;
        END IF;
        RETURN;
    END IF;
    IF release_row.package_id IS NOT NULL OR release_row.package_hash IS NOT NULL THEN
        RETURN QUERY SELECT 'MULTIPLE_HASH', release_row.aggregate_version;
        RETURN;
    END IF;
    IF release_row.representation_selections IS DISTINCT FROM p_items
       OR release_row.destination_definitions IS DISTINCT FROM p_destinations
       OR release_row.recipient_scope_snapshot_ref IS DISTINCT FROM
          (p_package_definition -> 'recipientScopeSnapshotRef')
       OR release_row.revision_ref IS DISTINCT FROM
          (p_package_definition -> 'canonicalRevisionRef')
       OR release_row.approval_bundle_snapshot_ref IS DISTINCT FROM
          (p_package_definition -> 'approvalBundleSnapshotRef') THEN
        RETURN QUERY SELECT 'INVALID', release_row.aggregate_version;
        RETURN;
    END IF;
    INSERT INTO release_publication.release_package (
        package_id, release_id, enterprise_id, project_id,
        canonical_revision_ref, approval_bundle_snapshot_ref,
        recipient_scope_snapshot_ref, preparation_validation_ref,
        package_hash, package_payload_hash, canonical_manifest,
        package_definition, prepared_at, frozen_at,
        created_by_principal_id, created_by_actor_snapshot_id,
        created_authorization_decision_id, source_command_id)
    VALUES (
        p_package_id, release_row.release_id, release_row.enterprise_id, release_row.project_id,
        p_package_definition -> 'canonicalRevisionRef',
        p_package_definition -> 'approvalBundleSnapshotRef',
        p_package_definition -> 'recipientScopeSnapshotRef',
        p_preparation_validation_ref, p_package_hash, p_package_payload_hash,
        p_canonical_manifest, p_package_definition, p_prepared_at, p_prepared_at,
        p_created_by_principal_id, p_created_by_actor_snapshot_id,
        p_created_authorization_decision_id, p_source_command_id);
    FOR item_row IN SELECT value FROM jsonb_array_elements(p_items) AS value LOOP
        INSERT INTO release_publication.release_package_item (
            package_id, ordinal, representation_id, representation_ref,
            representation_checksum, renderer_id, renderer_version, display_name,
            required, release_role, enterprise_id, project_id,
            created_by_principal_id, created_by_actor_snapshot_id,
            created_authorization_decision_id, source_command_id)
        VALUES (
            p_package_id,
            (item_row ->> 'ordinal')::integer,
            (item_row #>> '{representationRef,representationId}')::uuid,
            item_row -> 'representationRef',
            decode(item_row #>> '{representationRef,checksum,digest}', 'hex'),
            item_row #>> '{representationRef,renderer,rendererId}',
            item_row #>> '{representationRef,renderer,rendererVersion}',
            item_row ->> 'displayName',
            (item_row ->> 'required')::boolean,
            item_row ->> 'releaseRole',
            release_row.enterprise_id, release_row.project_id,
            p_created_by_principal_id, p_created_by_actor_snapshot_id,
            p_created_authorization_decision_id, p_source_command_id);
    END LOOP;
    FOR destination_row IN SELECT value FROM jsonb_array_elements(p_destinations) AS value LOOP
        INSERT INTO release_publication.release_destination (
            package_id, destination_id, destination_type, destination_ref,
            recipient_scope_ref, purpose, required, required_receipt_kind,
            delivery_policy_ref, enterprise_id, project_id,
            created_by_principal_id, created_by_actor_snapshot_id,
            created_authorization_decision_id, source_command_id)
        VALUES (
            p_package_id,
            (destination_row ->> 'destinationId')::uuid,
            destination_row ->> 'destinationType',
            destination_row -> 'destinationRef',
            destination_row -> 'recipientScopeRef',
            destination_row ->> 'purpose',
            (destination_row ->> 'required')::boolean,
            destination_row ->> 'requiredReceiptKind',
            destination_row -> 'deliveryPolicyRef',
            release_row.enterprise_id, release_row.project_id,
            p_created_by_principal_id, p_created_by_actor_snapshot_id,
            p_created_authorization_decision_id, p_source_command_id);
    END LOOP;
    next_version := release_row.aggregate_version + 1;
    UPDATE release_publication.release_record
       SET status = 'PREPARED',
           package_id = p_package_id,
           package_hash = p_package_hash,
           preparation_validation_ref = p_preparation_validation_ref,
           aggregate_version = next_version,
           updated_by_principal_id = p_created_by_principal_id,
           updated_by_actor_snapshot_id = p_created_by_actor_snapshot_id,
           updated_authorization_decision_id = p_created_authorization_decision_id,
           updated_at = clock_timestamp(),
           last_command_id = p_source_command_id
     WHERE release_id = p_release_id;
    RETURN QUERY SELECT 'OK', next_version;
END
$fn$;

CREATE FUNCTION release_publication.cancel_release(
    p_release_id uuid,
    p_expected_version bigint,
    p_cancel_reason jsonb,
    p_cancelled_at timestamptz,
    p_updated_by_principal_id uuid,
    p_updated_by_actor_snapshot_id uuid,
    p_updated_authorization_decision_id uuid,
    p_source_command_id uuid
) RETURNS TABLE(outcome text, aggregate_version bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
    release_row release_publication.release_record%ROWTYPE;
BEGIN
    IF p_cancel_reason IS NULL OR jsonb_typeof(p_cancel_reason) <> 'object'
       OR p_cancelled_at IS NULL THEN
        RETURN QUERY SELECT 'INVALID', NULL::bigint;
        RETURN;
    END IF;
    SELECT * INTO release_row
      FROM release_publication.release_record
     WHERE release_id = p_release_id
     FOR UPDATE;
    IF NOT FOUND THEN RETURN QUERY SELECT 'NOT_FOUND', NULL::bigint; RETURN; END IF;
    PERFORM release_publication.assert_business_write_context(
        release_row.enterprise_id, release_row.project_id,
        p_updated_by_principal_id, p_updated_by_actor_snapshot_id,
        p_updated_authorization_decision_id);
    IF release_row.aggregate_version <> p_expected_version THEN
        RETURN QUERY SELECT 'CONFLICT', release_row.aggregate_version;
        RETURN;
    END IF;
    IF release_row.status NOT IN ('DRAFT', 'PREPARED') THEN
        RETURN QUERY SELECT 'NOT_ALLOWED', release_row.aggregate_version;
        RETURN;
    END IF;
    UPDATE release_publication.release_record
       SET status = 'CANCELLED',
           cancel_reason = p_cancel_reason,
           cancelled_at = p_cancelled_at,
           aggregate_version = release_row.aggregate_version + 1,
           updated_by_principal_id = p_updated_by_principal_id,
           updated_by_actor_snapshot_id = p_updated_by_actor_snapshot_id,
           updated_authorization_decision_id = p_updated_authorization_decision_id,
           updated_at = clock_timestamp(),
           last_command_id = p_source_command_id
     WHERE release_id = p_release_id;
    RETURN QUERY SELECT 'OK', (release_row.aggregate_version + 1);
END
$fn$;

-- RLS is intentionally read-only for the application role. All business
-- writes are exposed through the four mutation functions above.
ALTER TABLE release_publication.release_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_publication.release_record FORCE ROW LEVEL SECURITY;
CREATE POLICY release_record_select ON release_publication.release_record
    FOR SELECT TO release_publication_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY release_record_owner_all ON release_publication.release_record
    FOR ALL TO release_publication_owner USING (true) WITH CHECK (true);

ALTER TABLE release_publication.release_package ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_publication.release_package FORCE ROW LEVEL SECURITY;
CREATE POLICY release_package_select ON release_publication.release_package
    FOR SELECT TO release_publication_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY release_package_owner_all ON release_publication.release_package
    FOR ALL TO release_publication_owner USING (true) WITH CHECK (true);

ALTER TABLE release_publication.release_package_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_publication.release_package_item FORCE ROW LEVEL SECURITY;
CREATE POLICY release_package_item_select ON release_publication.release_package_item
    FOR SELECT TO release_publication_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY release_package_item_owner_all ON release_publication.release_package_item
    FOR ALL TO release_publication_owner USING (true) WITH CHECK (true);

ALTER TABLE release_publication.release_destination ENABLE ROW LEVEL SECURITY;
ALTER TABLE release_publication.release_destination FORCE ROW LEVEL SECURITY;
CREATE POLICY release_destination_select ON release_publication.release_destination
    FOR SELECT TO release_publication_app
    USING ((project_id IS NULL AND platform_security.context_allows_enterprise(enterprise_id))
        OR (project_id IS NOT NULL AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY release_destination_owner_all ON release_publication.release_destination
    FOR ALL TO release_publication_owner USING (true) WITH CHECK (true);

REVOKE ALL ON release_publication.release_record,
    release_publication.release_package,
    release_publication.release_package_item,
    release_publication.release_destination
    FROM release_publication_app;
GRANT SELECT ON release_publication.release_record,
    release_publication.release_package,
    release_publication.release_package_item,
    release_publication.release_destination
    TO release_publication_app;

REVOKE ALL ON FUNCTION release_publication.assert_business_write_context(uuid, uuid, uuid, uuid, uuid)
    FROM PUBLIC, release_publication_app;
REVOKE ALL ON FUNCTION release_publication.guard_business_fact_insert() FROM PUBLIC, release_publication_app;
REVOKE ALL ON FUNCTION release_publication.guard_append_only_fact() FROM PUBLIC, release_publication_app;
REVOKE ALL ON FUNCTION release_publication.guard_release_record_update() FROM PUBLIC, release_publication_app;
REVOKE ALL ON FUNCTION release_publication.create_release_draft(
    uuid, uuid, uuid, jsonb, jsonb, bytea, text, text, timestamptz, jsonb, jsonb, jsonb, jsonb,
    uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_publication.replace_release_selections(
    uuid, bigint, jsonb, jsonb, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_publication.replace_release_destinations(
    uuid, bigint, jsonb, jsonb, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_publication.prepare_release(
    uuid, bigint, uuid, bytea, bytea, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz,
    uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_publication.cancel_release(
    uuid, bigint, jsonb, timestamptz, uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_publication.create_release_draft(
    uuid, uuid, uuid, jsonb, jsonb, bytea, text, text, timestamptz, jsonb, jsonb, jsonb, jsonb,
    uuid, uuid, uuid, uuid) TO release_publication_app;
GRANT EXECUTE ON FUNCTION release_publication.replace_release_selections(
    uuid, bigint, jsonb, jsonb, uuid, uuid, uuid, uuid) TO release_publication_app;
GRANT EXECUTE ON FUNCTION release_publication.replace_release_destinations(
    uuid, bigint, jsonb, jsonb, uuid, uuid, uuid, uuid) TO release_publication_app;
GRANT EXECUTE ON FUNCTION release_publication.prepare_release(
    uuid, bigint, uuid, bytea, bytea, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz,
    uuid, uuid, uuid, uuid) TO release_publication_app;
GRANT EXECUTE ON FUNCTION release_publication.cancel_release(
    uuid, bigint, jsonb, timestamptz, uuid, uuid, uuid, uuid) TO release_publication_app;

RESET ROLE;
