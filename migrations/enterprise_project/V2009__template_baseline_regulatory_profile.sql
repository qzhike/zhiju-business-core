-- IM-03 WI-08 (issue #64): controlled Platform Template/Regulatory
-- references and Project-owned TemplateBaseline/RegulatoryProfile chains.
-- Platform reference rows have no business Enterprise or Project scope. The
-- reserved control scope is used only by shared technical transaction facts.

-- The migration runner is the only process allowed to create this role. It is
-- deliberately not named *_app so the existing module-role baseline remains
-- unchanged; application sessions must be explicitly granted membership by
-- the deployment/composition layer before they can SET ROLE to it.
DO $roles$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'enterprise_project_platform_reference_writer'
    ) THEN
        CREATE ROLE enterprise_project_platform_reference_writer
            NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT
            NOREPLICATION NOBYPASSRLS;
    END IF;
END
$roles$;

GRANT USAGE ON SCHEMA enterprise_project, platform_security
    TO enterprise_project_platform_reference_writer;
GRANT EXECUTE ON FUNCTION
    platform_security.current_context(),
    platform_security.context_is_valid(),
    platform_security.context_enterprise_id(),
    platform_security.context_allows_enterprise(uuid),
    platform_security.context_allows_project(uuid, uuid),
    platform_security.context_principal_id(),
    platform_security.context_actor_snapshot_id(),
    platform_security.context_correlation_id(),
    platform_security.context_kind(),
    platform_security.context_authorization_decision_ref()
    TO enterprise_project_platform_reference_writer;

SET ROLE enterprise_project_owner;

-- ---------------------------------------------------------------------------
-- Platform Template Reference
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.reference_template (
    reference_template_id uuid PRIMARY KEY,
    reference_code text NOT NULL,
    template_type text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    current_version_id uuid,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    CONSTRAINT reference_template_code_unique UNIQUE (reference_code),
    CONSTRAINT reference_template_status_closed CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    CONSTRAINT reference_template_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT reference_template_code_nonempty CHECK (
        length(reference_code) > 0 AND length(template_type) > 0)
);

CREATE TABLE enterprise_project.reference_template_version (
    reference_template_version_id uuid PRIMARY KEY,
    reference_template_id uuid NOT NULL,
    version_no integer NOT NULL,
    version_label text NOT NULL,
    content_ref jsonb NOT NULL,
    content_hash bytea NOT NULL,
    source_ref jsonb NOT NULL,
    applicability jsonb NOT NULL,
    lifecycle text NOT NULL DEFAULT 'DRAFT',
    published_by_principal_id uuid,
    published_at timestamptz,
    release_decision_ref jsonb,
    publish_reason jsonb,
    created_by_principal_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT reference_template_version_identity_unique
        UNIQUE (reference_template_id, reference_template_version_id),
    CONSTRAINT reference_template_version_no_unique
        UNIQUE (reference_template_id, version_no),
    CONSTRAINT reference_template_version_no_positive CHECK (version_no >= 1),
    CONSTRAINT reference_template_version_label_nonempty CHECK (length(version_label) > 0),
    CONSTRAINT reference_template_version_hash_len CHECK (octet_length(content_hash) = 32),
    CONSTRAINT reference_template_version_lifecycle_closed CHECK (
        lifecycle IN ('DRAFT', 'PUBLISHED')),
    CONSTRAINT reference_template_version_content_object CHECK (
        jsonb_typeof(content_ref) = 'object'),
    CONSTRAINT reference_template_version_source_object CHECK (
        jsonb_typeof(source_ref) = 'object'),
    CONSTRAINT reference_template_version_applicability_json CHECK (
        jsonb_typeof(applicability) IN ('object', 'array')),
    CONSTRAINT reference_template_version_publish_shape CHECK (
        (lifecycle = 'DRAFT'
         AND published_by_principal_id IS NULL
         AND published_at IS NULL
         AND release_decision_ref IS NULL
         AND publish_reason IS NULL)
        OR
        (lifecycle = 'PUBLISHED'
         AND published_by_principal_id IS NOT NULL
         AND published_at IS NOT NULL
         AND release_decision_ref IS NOT NULL
         AND publish_reason IS NOT NULL))
);

ALTER TABLE enterprise_project.reference_template_version
    ADD CONSTRAINT reference_template_version_root_fk
    FOREIGN KEY (reference_template_id)
    REFERENCES enterprise_project.reference_template (reference_template_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX reference_template_version_root_idx
    ON enterprise_project.reference_template_version (reference_template_id, version_no DESC);

-- ---------------------------------------------------------------------------
-- Platform Regulatory Reference
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.regulatory_reference (
    regulatory_reference_id uuid PRIMARY KEY,
    authority_code text NOT NULL,
    jurisdiction text NOT NULL,
    reference_code text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    current_version_id uuid,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    CONSTRAINT regulatory_reference_identity_unique
        UNIQUE (authority_code, jurisdiction, reference_code),
    CONSTRAINT regulatory_reference_status_closed CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    CONSTRAINT regulatory_reference_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT regulatory_reference_identity_nonempty CHECK (
        length(authority_code) > 0
        AND length(jurisdiction) > 0
        AND length(reference_code) > 0)
);

CREATE TABLE enterprise_project.regulatory_reference_version (
    regulatory_reference_version_id uuid PRIMARY KEY,
    regulatory_reference_id uuid NOT NULL,
    version_no integer NOT NULL,
    version_label text NOT NULL,
    citation text NOT NULL,
    effective_period jsonb NOT NULL,
    source_ref jsonb NOT NULL,
    content_ref jsonb NOT NULL,
    content_hash bytea NOT NULL,
    verification_refs jsonb NOT NULL,
    lifecycle text NOT NULL DEFAULT 'DRAFT',
    published_by_principal_id uuid,
    published_at timestamptz,
    release_decision_ref jsonb,
    publish_reason jsonb,
    created_by_principal_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT regulatory_reference_version_identity_unique
        UNIQUE (regulatory_reference_id, regulatory_reference_version_id),
    CONSTRAINT regulatory_reference_version_no_unique
        UNIQUE (regulatory_reference_id, version_no),
    CONSTRAINT regulatory_reference_version_no_positive CHECK (version_no >= 1),
    CONSTRAINT regulatory_reference_version_label_nonempty CHECK (length(version_label) > 0),
    CONSTRAINT regulatory_reference_version_citation_nonempty CHECK (length(citation) > 0),
    CONSTRAINT regulatory_reference_version_hash_len CHECK (octet_length(content_hash) = 32),
    CONSTRAINT regulatory_reference_version_lifecycle_closed CHECK (
        lifecycle IN ('DRAFT', 'PUBLISHED')),
    CONSTRAINT regulatory_reference_version_effective_object CHECK (
        jsonb_typeof(effective_period) = 'object'),
    CONSTRAINT regulatory_reference_version_source_object CHECK (
        jsonb_typeof(source_ref) = 'object'),
    CONSTRAINT regulatory_reference_version_content_object CHECK (
        jsonb_typeof(content_ref) = 'object'),
    CONSTRAINT regulatory_reference_version_verification_array CHECK (
        jsonb_typeof(verification_refs) = 'array'),
    CONSTRAINT regulatory_reference_version_publish_shape CHECK (
        (lifecycle = 'DRAFT'
         AND published_by_principal_id IS NULL
         AND published_at IS NULL
         AND release_decision_ref IS NULL
         AND publish_reason IS NULL)
        OR
        (lifecycle = 'PUBLISHED'
         AND published_by_principal_id IS NOT NULL
         AND published_at IS NOT NULL
         AND release_decision_ref IS NOT NULL
         AND publish_reason IS NOT NULL))
);

ALTER TABLE enterprise_project.regulatory_reference_version
    ADD CONSTRAINT regulatory_reference_version_root_fk
    FOREIGN KEY (regulatory_reference_id)
    REFERENCES enterprise_project.regulatory_reference (regulatory_reference_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX regulatory_reference_version_root_idx
    ON enterprise_project.regulatory_reference_version
        (regulatory_reference_id, version_no DESC);

-- ---------------------------------------------------------------------------
-- Platform lifecycle and current-pointer guards
-- ---------------------------------------------------------------------------

CREATE FUNCTION enterprise_project.guard_reference_template_root() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.reference_template_id IS DISTINCT FROM OLD.reference_template_id
       OR NEW.reference_code IS DISTINCT FROM OLD.reference_code
       OR NEW.template_type IS DISTINCT FROM OLD.template_type
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id THEN
        RAISE EXCEPTION 'reference_template identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
        RAISE EXCEPTION 'reference_template aggregate_version must advance by one'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.current_version_id IS NOT NULL AND NEW.current_version_id IS NULL THEN
        RAISE EXCEPTION 'reference_template current pointer cannot be cleared'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_reference_template_root() FROM PUBLIC;
CREATE TRIGGER reference_template_root_guard
    BEFORE UPDATE ON enterprise_project.reference_template
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_reference_template_root();

CREATE FUNCTION enterprise_project.guard_reference_template_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.reference_template_version_id IS DISTINCT FROM OLD.reference_template_version_id
       OR NEW.reference_template_id IS DISTINCT FROM OLD.reference_template_id
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.version_label IS DISTINCT FROM OLD.version_label
       OR NEW.content_ref IS DISTINCT FROM OLD.content_ref
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
       OR NEW.applicability IS DISTINCT FROM OLD.applicability
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
       OR NEW.source_command_id IS DISTINCT FROM OLD.source_command_id THEN
        RAISE EXCEPTION 'reference_template_version content is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
        IF OLD.lifecycle <> 'DRAFT' OR NEW.lifecycle <> 'PUBLISHED' THEN
            RAISE EXCEPTION 'reference_template_version lifecycle transition is not allowed'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.published_by_principal_id IS DISTINCT FROM OLD.published_by_principal_id
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.release_decision_ref IS DISTINCT FROM OLD.release_decision_ref
       OR NEW.publish_reason IS DISTINCT FROM OLD.publish_reason THEN
        RAISE EXCEPTION 'reference_template_version publish facts require DRAFT to PUBLISHED'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_reference_template_version() FROM PUBLIC;
CREATE TRIGGER reference_template_version_guard
    BEFORE UPDATE ON enterprise_project.reference_template_version
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_reference_template_version();

CREATE FUNCTION enterprise_project.guard_regulatory_reference_root() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.regulatory_reference_id IS DISTINCT FROM OLD.regulatory_reference_id
       OR NEW.authority_code IS DISTINCT FROM OLD.authority_code
       OR NEW.jurisdiction IS DISTINCT FROM OLD.jurisdiction
       OR NEW.reference_code IS DISTINCT FROM OLD.reference_code
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id THEN
        RAISE EXCEPTION 'regulatory_reference identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
        RAISE EXCEPTION 'regulatory_reference aggregate_version must advance by one'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.current_version_id IS NOT NULL AND NEW.current_version_id IS NULL THEN
        RAISE EXCEPTION 'regulatory_reference current pointer cannot be cleared'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_regulatory_reference_root() FROM PUBLIC;
CREATE TRIGGER regulatory_reference_root_guard
    BEFORE UPDATE ON enterprise_project.regulatory_reference
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_regulatory_reference_root();

CREATE FUNCTION enterprise_project.guard_regulatory_reference_version() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.regulatory_reference_version_id IS DISTINCT FROM OLD.regulatory_reference_version_id
       OR NEW.regulatory_reference_id IS DISTINCT FROM OLD.regulatory_reference_id
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.version_label IS DISTINCT FROM OLD.version_label
       OR NEW.citation IS DISTINCT FROM OLD.citation
       OR NEW.effective_period IS DISTINCT FROM OLD.effective_period
       OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
       OR NEW.content_ref IS DISTINCT FROM OLD.content_ref
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.verification_refs IS DISTINCT FROM OLD.verification_refs
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
       OR NEW.source_command_id IS DISTINCT FROM OLD.source_command_id THEN
        RAISE EXCEPTION 'regulatory_reference_version content is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
        IF OLD.lifecycle <> 'DRAFT' OR NEW.lifecycle <> 'PUBLISHED' THEN
            RAISE EXCEPTION 'regulatory_reference_version lifecycle transition is not allowed'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.published_by_principal_id IS DISTINCT FROM OLD.published_by_principal_id
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.release_decision_ref IS DISTINCT FROM OLD.release_decision_ref
       OR NEW.publish_reason IS DISTINCT FROM OLD.publish_reason THEN
        RAISE EXCEPTION 'regulatory_reference_version publish facts require DRAFT to PUBLISHED'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_regulatory_reference_version() FROM PUBLIC;
CREATE TRIGGER regulatory_reference_version_guard
    BEFORE UPDATE ON enterprise_project.regulatory_reference_version
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_regulatory_reference_version();

CREATE FUNCTION enterprise_project.guard_reference_template_current() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.current_version_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM enterprise_project.reference_template_version version_row
            WHERE version_row.reference_template_id = NEW.reference_template_id
              AND version_row.reference_template_version_id = NEW.current_version_id
              AND version_row.lifecycle = 'PUBLISHED') THEN
        RAISE EXCEPTION 'reference_template current pointer must resolve to PUBLISHED'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_reference_template_current() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER reference_template_current_guard
    AFTER INSERT OR UPDATE ON enterprise_project.reference_template
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_reference_template_current();

CREATE FUNCTION enterprise_project.guard_regulatory_reference_current() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.current_version_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
             FROM enterprise_project.regulatory_reference_version version_row
            WHERE version_row.regulatory_reference_id = NEW.regulatory_reference_id
              AND version_row.regulatory_reference_version_id = NEW.current_version_id
              AND version_row.lifecycle = 'PUBLISHED') THEN
        RAISE EXCEPTION 'regulatory_reference current pointer must resolve to PUBLISHED'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_regulatory_reference_current() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER regulatory_reference_current_guard
    AFTER INSERT OR UPDATE ON enterprise_project.regulatory_reference
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_regulatory_reference_current();

ALTER TABLE enterprise_project.reference_template
    ADD CONSTRAINT reference_template_current_fk
    FOREIGN KEY (reference_template_id, current_version_id)
    REFERENCES enterprise_project.reference_template_version
        (reference_template_id, reference_template_version_id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.regulatory_reference
    ADD CONSTRAINT regulatory_reference_current_fk
    FOREIGN KEY (regulatory_reference_id, current_version_id)
    REFERENCES enterprise_project.regulatory_reference_version
        (regulatory_reference_id, regulatory_reference_version_id)
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- Project-owned TemplateBaseline
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.template_baseline (
    template_baseline_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    current_version_id uuid NOT NULL,
    active_version_id uuid NOT NULL,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    CONSTRAINT template_baseline_scope_unique
        UNIQUE (enterprise_id, project_id, template_baseline_id),
    CONSTRAINT template_baseline_project_unique
        UNIQUE (enterprise_id, project_id),
    CONSTRAINT template_baseline_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT template_baseline_pointer_match CHECK (
        current_version_id = active_version_id)
);

ALTER TABLE enterprise_project.template_baseline
    ADD CONSTRAINT template_baseline_project_fk
    FOREIGN KEY (enterprise_id, project_id)
    REFERENCES enterprise_project.project (enterprise_id, project_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE enterprise_project.template_baseline_version (
    version_id uuid PRIMARY KEY,
    template_baseline_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    version_no integer NOT NULL,
    version_status text NOT NULL DEFAULT 'FROZEN',
    previous_version_id uuid,
    selections_payload jsonb NOT NULL,
    review_snapshot_ref jsonb NOT NULL,
    selection_rationale jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT template_baseline_version_scope_unique
        UNIQUE (enterprise_id, project_id, template_baseline_id, version_id),
    CONSTRAINT template_baseline_version_no_unique
        UNIQUE (template_baseline_id, version_no),
    CONSTRAINT template_baseline_version_no_positive CHECK (version_no >= 1),
    CONSTRAINT template_baseline_version_status_closed CHECK (version_status = 'FROZEN'),
    CONSTRAINT template_baseline_version_previous_not_self CHECK (
        previous_version_id IS NULL OR previous_version_id <> version_id),
    CONSTRAINT template_baseline_version_selections_array CHECK (
        jsonb_typeof(selections_payload) = 'array'
        AND jsonb_array_length(selections_payload) > 0),
    CONSTRAINT template_baseline_version_review_object CHECK (
        jsonb_typeof(review_snapshot_ref) = 'object'),
    CONSTRAINT template_baseline_version_rationale_object CHECK (
        jsonb_typeof(selection_rationale) = 'object'),
    CONSTRAINT template_baseline_version_hash_len CHECK (octet_length(payload_hash) = 32)
);

ALTER TABLE enterprise_project.template_baseline_version
    ADD CONSTRAINT template_baseline_version_root_fk
    FOREIGN KEY (enterprise_id, project_id, template_baseline_id)
    REFERENCES enterprise_project.template_baseline
        (enterprise_id, project_id, template_baseline_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.template_baseline_version
    ADD CONSTRAINT template_baseline_version_previous_fk
    FOREIGN KEY (enterprise_id, project_id, template_baseline_id, previous_version_id)
    REFERENCES enterprise_project.template_baseline_version
        (enterprise_id, project_id, template_baseline_id, version_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX template_baseline_version_root_idx
    ON enterprise_project.template_baseline_version (template_baseline_id, version_no DESC);

CREATE TABLE enterprise_project.template_selection (
    selection_id uuid NOT NULL,
    template_baseline_id uuid NOT NULL,
    version_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    delivery_category text NOT NULL,
    template_ref jsonb NOT NULL,
    template_id uuid NOT NULL,
    template_version_id uuid NOT NULL,
    applicability_scope jsonb NOT NULL,
    selection_reason jsonb NOT NULL,
    replacement_for jsonb,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    PRIMARY KEY (version_id, selection_id),
    CONSTRAINT template_selection_scope_unique
        UNIQUE (enterprise_id, project_id, version_id, selection_id),
    CONSTRAINT template_selection_category_unique
        UNIQUE (version_id, delivery_category),
    CONSTRAINT template_selection_category_nonempty CHECK (length(delivery_category) > 0),
    CONSTRAINT template_selection_scope_object CHECK (
        jsonb_typeof(applicability_scope) IN ('object', 'array')),
    CONSTRAINT template_selection_reason_object CHECK (
        jsonb_typeof(selection_reason) = 'object'),
    CONSTRAINT template_selection_replacement_object CHECK (
        replacement_for IS NULL OR jsonb_typeof(replacement_for) = 'object'),
    CONSTRAINT template_selection_hash_len CHECK (octet_length(payload_hash) = 32)
);

ALTER TABLE enterprise_project.template_selection
    ADD CONSTRAINT template_selection_version_fk
    FOREIGN KEY (enterprise_id, project_id, template_baseline_id, version_id)
    REFERENCES enterprise_project.template_baseline_version
        (enterprise_id, project_id, template_baseline_id, version_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.template_selection
    ADD CONSTRAINT template_selection_platform_ref_fk
    FOREIGN KEY (template_id, template_version_id)
    REFERENCES enterprise_project.reference_template_version
        (reference_template_id, reference_template_version_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX template_selection_project_idx
    ON enterprise_project.template_selection (enterprise_id, project_id, version_id);

-- ---------------------------------------------------------------------------
-- Project-owned RegulatoryProfile
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.regulatory_profile (
    regulatory_profile_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    current_version_id uuid NOT NULL,
    active_version_id uuid NOT NULL,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    CONSTRAINT regulatory_profile_scope_unique
        UNIQUE (enterprise_id, project_id, regulatory_profile_id),
    CONSTRAINT regulatory_profile_project_unique
        UNIQUE (enterprise_id, project_id),
    CONSTRAINT regulatory_profile_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT regulatory_profile_pointer_match CHECK (
        current_version_id = active_version_id)
);

ALTER TABLE enterprise_project.regulatory_profile
    ADD CONSTRAINT regulatory_profile_project_fk
    FOREIGN KEY (enterprise_id, project_id)
    REFERENCES enterprise_project.project (enterprise_id, project_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE enterprise_project.regulatory_profile_version (
    version_id uuid PRIMARY KEY,
    regulatory_profile_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    version_no integer NOT NULL,
    version_status text NOT NULL DEFAULT 'FROZEN',
    jurisdiction text NOT NULL,
    product_scope_snapshot_ref jsonb NOT NULL,
    product_scope_snapshot_id uuid NOT NULL,
    product_scope_payload_hash bytea NOT NULL,
    applicability_payload jsonb NOT NULL,
    review_snapshot_ref jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT regulatory_profile_version_scope_unique
        UNIQUE (enterprise_id, project_id, regulatory_profile_id, version_id),
    CONSTRAINT regulatory_profile_version_no_unique
        UNIQUE (regulatory_profile_id, version_no),
    CONSTRAINT regulatory_profile_version_no_positive CHECK (version_no >= 1),
    CONSTRAINT regulatory_profile_version_status_closed CHECK (version_status = 'FROZEN'),
    CONSTRAINT regulatory_profile_version_jurisdiction_nonempty CHECK (length(jurisdiction) > 0),
    CONSTRAINT regulatory_profile_version_applicability_array CHECK (
        jsonb_typeof(applicability_payload) = 'array'
        AND jsonb_array_length(applicability_payload) > 0),
    CONSTRAINT regulatory_profile_version_review_object CHECK (
        jsonb_typeof(review_snapshot_ref) = 'object'),
    CONSTRAINT regulatory_profile_version_scope_ref_object CHECK (
        jsonb_typeof(product_scope_snapshot_ref) = 'object'),
    CONSTRAINT regulatory_profile_version_hash_len CHECK (
        octet_length(payload_hash) = 32
        AND octet_length(product_scope_payload_hash) = 32)
);

ALTER TABLE enterprise_project.regulatory_profile_version
    ADD CONSTRAINT regulatory_profile_version_root_fk
    FOREIGN KEY (enterprise_id, project_id, regulatory_profile_id)
    REFERENCES enterprise_project.regulatory_profile
        (enterprise_id, project_id, regulatory_profile_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.regulatory_profile_version
    ADD CONSTRAINT regulatory_profile_version_product_scope_fk
    FOREIGN KEY (product_scope_snapshot_id)
    REFERENCES enterprise_project.product_scope_snapshot (snapshot_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX regulatory_profile_version_root_idx
    ON enterprise_project.regulatory_profile_version (regulatory_profile_id, version_no DESC);

CREATE TABLE enterprise_project.regulatory_profile_item (
    item_id uuid NOT NULL,
    regulatory_profile_id uuid NOT NULL,
    version_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    regulatory_reference_ref jsonb NOT NULL,
    regulatory_reference_id uuid NOT NULL,
    regulatory_reference_version_id uuid NOT NULL,
    content_hash bytea NOT NULL,
    applicability text NOT NULL,
    rationale jsonb NOT NULL,
    evidence_refs jsonb NOT NULL,
    risk_level text NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    recorded_by_principal_id uuid NOT NULL,
    recorded_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    PRIMARY KEY (version_id, item_id),
    CONSTRAINT regulatory_profile_item_scope_unique
        UNIQUE (enterprise_id, project_id, version_id, item_id),
    CONSTRAINT regulatory_profile_item_reference_unique
        UNIQUE (version_id, regulatory_reference_version_id),
    CONSTRAINT regulatory_profile_item_applicability_closed CHECK (
        applicability IN ('APPLICABLE', 'NOT_APPLICABLE', 'PENDING_DETERMINATION')),
    CONSTRAINT regulatory_profile_item_rationale_object CHECK (
        jsonb_typeof(rationale) = 'object'),
    CONSTRAINT regulatory_profile_item_evidence_array CHECK (
        jsonb_typeof(evidence_refs) = 'array'),
    CONSTRAINT regulatory_profile_item_reference_object CHECK (
        jsonb_typeof(regulatory_reference_ref) = 'object'),
    CONSTRAINT regulatory_profile_item_hash_len CHECK (
        octet_length(content_hash) = 32 AND octet_length(payload_hash) = 32),
    CONSTRAINT regulatory_profile_item_risk_nonempty CHECK (length(risk_level) > 0)
);

ALTER TABLE enterprise_project.regulatory_profile_item
    ADD CONSTRAINT regulatory_profile_item_version_fk
    FOREIGN KEY (enterprise_id, project_id, regulatory_profile_id, version_id)
    REFERENCES enterprise_project.regulatory_profile_version
        (enterprise_id, project_id, regulatory_profile_id, version_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.regulatory_profile_item
    ADD CONSTRAINT regulatory_profile_item_platform_ref_fk
    FOREIGN KEY (regulatory_reference_id, regulatory_reference_version_id)
    REFERENCES enterprise_project.regulatory_reference_version
        (regulatory_reference_id, regulatory_reference_version_id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX regulatory_profile_item_project_idx
    ON enterprise_project.regulatory_profile_item (enterprise_id, project_id, version_id);

-- ---------------------------------------------------------------------------
-- Project immutable boundaries and deferred pointer checks
-- ---------------------------------------------------------------------------

CREATE FUNCTION enterprise_project.guard_template_baseline_root() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.template_baseline_id IS DISTINCT FROM OLD.template_baseline_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id THEN
        RAISE EXCEPTION 'template_baseline identity and ownership are immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
        RAISE EXCEPTION 'template_baseline aggregate_version must advance by one'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.current_version_id IS DISTINCT FROM NEW.active_version_id THEN
        RAISE EXCEPTION 'template_baseline current and active pointers must match'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_template_baseline_root() FROM PUBLIC;
CREATE TRIGGER template_baseline_root_guard
    BEFORE UPDATE ON enterprise_project.template_baseline
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_template_baseline_root();

CREATE FUNCTION enterprise_project.guard_template_baseline_version_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'template_baseline_version history is immutable' USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_template_baseline_version_immutable() FROM PUBLIC;
CREATE TRIGGER template_baseline_version_immutable_guard
    BEFORE UPDATE ON enterprise_project.template_baseline_version
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_template_baseline_version_immutable();

CREATE FUNCTION enterprise_project.guard_template_selection_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'template_selection history is immutable' USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_template_selection_immutable() FROM PUBLIC;
CREATE TRIGGER template_selection_immutable_guard
    BEFORE UPDATE ON enterprise_project.template_selection
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_template_selection_immutable();

CREATE FUNCTION enterprise_project.guard_regulatory_profile_root() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.regulatory_profile_id IS DISTINCT FROM OLD.regulatory_profile_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id THEN
        RAISE EXCEPTION 'regulatory_profile identity and ownership are immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
        RAISE EXCEPTION 'regulatory_profile aggregate_version must advance by one'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.current_version_id IS DISTINCT FROM NEW.active_version_id THEN
        RAISE EXCEPTION 'regulatory_profile current and active pointers must match'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_regulatory_profile_root() FROM PUBLIC;
CREATE TRIGGER regulatory_profile_root_guard
    BEFORE UPDATE ON enterprise_project.regulatory_profile
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_regulatory_profile_root();

CREATE FUNCTION enterprise_project.guard_regulatory_profile_version_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'regulatory_profile_version history is immutable' USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_regulatory_profile_version_immutable() FROM PUBLIC;
CREATE TRIGGER regulatory_profile_version_immutable_guard
    BEFORE UPDATE ON enterprise_project.regulatory_profile_version
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_regulatory_profile_version_immutable();

CREATE FUNCTION enterprise_project.guard_regulatory_profile_item_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'regulatory_profile_item history is immutable' USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_regulatory_profile_item_immutable() FROM PUBLIC;
CREATE TRIGGER regulatory_profile_item_immutable_guard
    BEFORE UPDATE ON enterprise_project.regulatory_profile_item
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_regulatory_profile_item_immutable();

CREATE FUNCTION enterprise_project.guard_template_baseline_pointer() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM enterprise_project.template_baseline_version version_row
         WHERE version_row.enterprise_id = NEW.enterprise_id
           AND version_row.project_id = NEW.project_id
           AND version_row.template_baseline_id = NEW.template_baseline_id
           AND version_row.version_id = NEW.current_version_id
           AND version_row.version_status = 'FROZEN') THEN
        RAISE EXCEPTION 'template_baseline pointer must resolve to FROZEN version'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_template_baseline_pointer() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER template_baseline_pointer_guard
    AFTER INSERT OR UPDATE ON enterprise_project.template_baseline
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_template_baseline_pointer();

CREATE FUNCTION enterprise_project.guard_regulatory_profile_pointer() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM enterprise_project.regulatory_profile_version version_row
         WHERE version_row.enterprise_id = NEW.enterprise_id
           AND version_row.project_id = NEW.project_id
           AND version_row.regulatory_profile_id = NEW.regulatory_profile_id
           AND version_row.version_id = NEW.current_version_id
           AND version_row.version_status = 'FROZEN') THEN
        RAISE EXCEPTION 'regulatory_profile pointer must resolve to FROZEN version'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_regulatory_profile_pointer() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER regulatory_profile_pointer_guard
    AFTER INSERT OR UPDATE ON enterprise_project.regulatory_profile
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_regulatory_profile_pointer();

ALTER TABLE enterprise_project.template_baseline
    ADD CONSTRAINT template_baseline_current_version_fk
    FOREIGN KEY (enterprise_id, project_id, template_baseline_id, current_version_id)
    REFERENCES enterprise_project.template_baseline_version
        (enterprise_id, project_id, template_baseline_id, version_id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.template_baseline
    ADD CONSTRAINT template_baseline_active_version_fk
    FOREIGN KEY (enterprise_id, project_id, template_baseline_id, active_version_id)
    REFERENCES enterprise_project.template_baseline_version
        (enterprise_id, project_id, template_baseline_id, version_id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.regulatory_profile
    ADD CONSTRAINT regulatory_profile_current_version_fk
    FOREIGN KEY (enterprise_id, project_id, regulatory_profile_id, current_version_id)
    REFERENCES enterprise_project.regulatory_profile_version
        (enterprise_id, project_id, regulatory_profile_id, version_id)
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.regulatory_profile
    ADD CONSTRAINT regulatory_profile_active_version_fk
    FOREIGN KEY (enterprise_id, project_id, regulatory_profile_id, active_version_id)
    REFERENCES enterprise_project.regulatory_profile_version
        (enterprise_id, project_id, regulatory_profile_id, version_id)
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- Grants and RLS
-- ---------------------------------------------------------------------------

GRANT SELECT ON
    enterprise_project.reference_template,
    enterprise_project.reference_template_version,
    enterprise_project.regulatory_reference,
    enterprise_project.regulatory_reference_version
    TO enterprise_project_app;
REVOKE INSERT, UPDATE, DELETE ON
    enterprise_project.reference_template,
    enterprise_project.reference_template_version,
    enterprise_project.regulatory_reference,
    enterprise_project.regulatory_reference_version
    FROM enterprise_project_app;
GRANT SELECT, INSERT, UPDATE ON
    enterprise_project.reference_template,
    enterprise_project.reference_template_version,
    enterprise_project.regulatory_reference,
    enterprise_project.regulatory_reference_version
    TO enterprise_project_platform_reference_writer;
REVOKE DELETE ON
    enterprise_project.reference_template,
    enterprise_project.reference_template_version,
    enterprise_project.regulatory_reference,
    enterprise_project.regulatory_reference_version
    FROM enterprise_project_platform_reference_writer;

REVOKE UPDATE, DELETE ON
    enterprise_project.template_baseline_version,
    enterprise_project.template_selection,
    enterprise_project.regulatory_profile_version,
    enterprise_project.regulatory_profile_item
    FROM enterprise_project_app;
REVOKE DELETE ON
    enterprise_project.template_baseline,
    enterprise_project.regulatory_profile
    FROM enterprise_project_app;
GRANT UPDATE (current_version_id, active_version_id, aggregate_version,
              updated_at, last_command_id)
    ON enterprise_project.template_baseline,
       enterprise_project.regulatory_profile
    TO enterprise_project_app;

ALTER TABLE enterprise_project.reference_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.reference_template FORCE ROW LEVEL SECURITY;
CREATE POLICY reference_template_runtime_select
    ON enterprise_project.reference_template FOR SELECT TO enterprise_project_app
    USING (status = 'ACTIVE');
CREATE POLICY reference_template_writer_select
    ON enterprise_project.reference_template FOR SELECT
    TO enterprise_project_platform_reference_writer
    USING (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY reference_template_writer_insert
    ON enterprise_project.reference_template FOR INSERT
    TO enterprise_project_platform_reference_writer
    WITH CHECK (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY reference_template_writer_update
    ON enterprise_project.reference_template FOR UPDATE
    TO enterprise_project_platform_reference_writer
    USING (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid)
    WITH CHECK (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid);

ALTER TABLE enterprise_project.reference_template_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.reference_template_version FORCE ROW LEVEL SECURITY;
CREATE POLICY reference_template_version_runtime_select
    ON enterprise_project.reference_template_version FOR SELECT TO enterprise_project_app
    USING (lifecycle = 'PUBLISHED');
CREATE POLICY reference_template_version_writer_select
    ON enterprise_project.reference_template_version FOR SELECT
    TO enterprise_project_platform_reference_writer
    USING (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY reference_template_version_writer_insert
    ON enterprise_project.reference_template_version FOR INSERT
    TO enterprise_project_platform_reference_writer
    WITH CHECK (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY reference_template_version_writer_update
    ON enterprise_project.reference_template_version FOR UPDATE
    TO enterprise_project_platform_reference_writer
    USING (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid)
    WITH CHECK (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid);

ALTER TABLE enterprise_project.regulatory_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.regulatory_reference FORCE ROW LEVEL SECURITY;
CREATE POLICY regulatory_reference_runtime_select
    ON enterprise_project.regulatory_reference FOR SELECT TO enterprise_project_app
    USING (status = 'ACTIVE');
CREATE POLICY regulatory_reference_writer_select
    ON enterprise_project.regulatory_reference FOR SELECT
    TO enterprise_project_platform_reference_writer
    USING (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY regulatory_reference_writer_insert
    ON enterprise_project.regulatory_reference FOR INSERT
    TO enterprise_project_platform_reference_writer
    WITH CHECK (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY regulatory_reference_writer_update
    ON enterprise_project.regulatory_reference FOR UPDATE
    TO enterprise_project_platform_reference_writer
    USING (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid)
    WITH CHECK (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid);

ALTER TABLE enterprise_project.regulatory_reference_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.regulatory_reference_version FORCE ROW LEVEL SECURITY;
CREATE POLICY regulatory_reference_version_runtime_select
    ON enterprise_project.regulatory_reference_version FOR SELECT TO enterprise_project_app
    USING (lifecycle = 'PUBLISHED');
CREATE POLICY regulatory_reference_version_writer_select
    ON enterprise_project.regulatory_reference_version FOR SELECT
    TO enterprise_project_platform_reference_writer
    USING (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY regulatory_reference_version_writer_insert
    ON enterprise_project.regulatory_reference_version FOR INSERT
    TO enterprise_project_platform_reference_writer
    WITH CHECK (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY regulatory_reference_version_writer_update
    ON enterprise_project.regulatory_reference_version FOR UPDATE
    TO enterprise_project_platform_reference_writer
    USING (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid)
    WITH CHECK (platform_security.context_enterprise_id() =
        '00000000-0000-7000-8000-000000000000'::uuid);

ALTER TABLE enterprise_project.template_baseline ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.template_baseline FORCE ROW LEVEL SECURITY;
CREATE POLICY template_baseline_select ON enterprise_project.template_baseline
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY template_baseline_insert ON enterprise_project.template_baseline
    FOR INSERT TO enterprise_project_app
    WITH CHECK (created_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY template_baseline_update ON enterprise_project.template_baseline
    FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.template_baseline_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.template_baseline_version FORCE ROW LEVEL SECURITY;
CREATE POLICY template_baseline_version_select
    ON enterprise_project.template_baseline_version FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY template_baseline_version_insert
    ON enterprise_project.template_baseline_version FOR INSERT TO enterprise_project_app
    WITH CHECK (created_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.template_selection ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.template_selection FORCE ROW LEVEL SECURITY;
CREATE POLICY template_selection_select ON enterprise_project.template_selection
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY template_selection_insert ON enterprise_project.template_selection
    FOR INSERT TO enterprise_project_app
    WITH CHECK (recorded_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.regulatory_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.regulatory_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY regulatory_profile_select ON enterprise_project.regulatory_profile
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY regulatory_profile_insert ON enterprise_project.regulatory_profile
    FOR INSERT TO enterprise_project_app
    WITH CHECK (created_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY regulatory_profile_update ON enterprise_project.regulatory_profile
    FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.regulatory_profile_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.regulatory_profile_version FORCE ROW LEVEL SECURITY;
CREATE POLICY regulatory_profile_version_select
    ON enterprise_project.regulatory_profile_version FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY regulatory_profile_version_insert
    ON enterprise_project.regulatory_profile_version FOR INSERT TO enterprise_project_app
    WITH CHECK (created_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.regulatory_profile_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.regulatory_profile_item FORCE ROW LEVEL SECURITY;
CREATE POLICY regulatory_profile_item_select ON enterprise_project.regulatory_profile_item
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY regulatory_profile_item_insert ON enterprise_project.regulatory_profile_item
    FOR INSERT TO enterprise_project_app
    WITH CHECK (recorded_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

-- The platform writer also needs the shared technical facts for the same
-- atomic command. Existing policies remain unchanged for normal app users.
GRANT SELECT, INSERT, UPDATE ON
    enterprise_project.command_receipt,
    enterprise_project.outbox_event,
    enterprise_project.audit_record,
    enterprise_project.reference_edge
    TO enterprise_project_platform_reference_writer;
ALTER POLICY command_receipt_select ON enterprise_project.command_receipt
    TO enterprise_project_app, enterprise_project_platform_reference_writer;
ALTER POLICY command_receipt_insert ON enterprise_project.command_receipt
    TO enterprise_project_app, enterprise_project_platform_reference_writer;
ALTER POLICY command_receipt_update ON enterprise_project.command_receipt
    TO enterprise_project_app, enterprise_project_platform_reference_writer;
ALTER POLICY outbox_event_select ON enterprise_project.outbox_event
    TO enterprise_project_app, enterprise_project_platform_reference_writer;
ALTER POLICY outbox_event_insert ON enterprise_project.outbox_event
    TO enterprise_project_app, enterprise_project_platform_reference_writer;
ALTER POLICY audit_record_insert ON enterprise_project.audit_record
    TO enterprise_project_app, enterprise_project_platform_reference_writer;
ALTER POLICY reference_edge_insert ON enterprise_project.reference_edge
    TO enterprise_project_app, enterprise_project_platform_reference_writer;

RESET ROLE;
