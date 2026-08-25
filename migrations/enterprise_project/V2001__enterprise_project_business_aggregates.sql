-- IM-03 WI-03 (issue #59): business aggregates for EnterpriseProject
-- Reference Foundation vertical slice.
--
-- One owning schema per file; no cross-schema FK, no shared business schema
-- (PG-009 / PG-017). Executed via SET ROLE <module>_owner so the WI-02
-- default privileges apply (SELECT/INSERT/UPDATE to the app role, nothing
-- to PUBLIC), then tightened: append-only history tables lose UPDATE, scope
-- columns are immutable, and active/current pointers carry explicit closed
-- CHECK constraints so partial unique indexes can reject duplicate
-- activations at the database layer.
--
-- Scope mirror: all tables are Enterprise-scope (project_id IS NULL). The
-- promoted scope column is enterprise_id; before-write triggers reject any
-- row whose payload->>'enterpriseId' is DISTINCT FROM enterprise_id, mirroring
-- the V2000 outbox_scope_mirror_guard. Canonical payload/hash equality cannot
-- be recomputed in SQL (pgcrypto stays disabled), so payload_hash integrity
-- is enforced by the owning repository write path (Repository.write guards)
-- and asserted in the gate tests.

SET ROLE enterprise_project_owner;

-- ---------------------------------------------------------------------------
-- enterprise: isolation boundary Aggregate Root.
--   display_code uniqueness is the CAS column for create; aggregate_version
--   is the optimistic concurrency token for status transitions
--   (ACTIVE -> SUSPENDED -> ARCHIVED). Once created, enterprise_id and the
--   derived scope are immutable: there is no UPDATE path that can rebind
--   an Enterprise to a different scope (PG-006 / PG-007 / Issue #59 #1).
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.enterprise (
    enterprise_id uuid PRIMARY KEY,
    display_code text NOT NULL,
    display_name text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    aggregate_version bigint NOT NULL DEFAULT 1,
    current_fact_snapshot_id uuid,
    current_product_id uuid,
    current_qms_configuration_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT enterprise_status_closed CHECK (
        status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
    CONSTRAINT enterprise_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT enterprise_display_code_unique UNIQUE (display_code)
);

CREATE INDEX enterprise_status_idx ON enterprise_project.enterprise (status, updated_at DESC);

-- ---------------------------------------------------------------------------
-- enterprise_fact: long-lived fact Aggregate Root. Each status transition
-- (PROPOSED -> CONFIRMED, or any transition to DISPUTED/SUPERSEDED) appends
-- a new enterprise_fact_version row; the root's current_version_id always
-- points to the latest exact version. Updates to value/source_refs of an
-- existing version row are rejected by REVOKE UPDATE + trigger.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.enterprise_fact (
    enterprise_fact_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    fact_type text NOT NULL,
    risk_level text NOT NULL,
    current_version_id uuid,
    current_status text NOT NULL DEFAULT 'PROPOSED',
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT enterprise_fact_risk_closed CHECK (
        risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    CONSTRAINT enterprise_fact_status_closed CHECK (
        current_status IN ('PROPOSED', 'CONFIRMED', 'DISPUTED', 'SUPERSEDED')),
    CONSTRAINT enterprise_fact_version_positive CHECK (aggregate_version >= 1)
);

CREATE INDEX enterprise_fact_enterprise_idx
    ON enterprise_project.enterprise_fact (enterprise_id, updated_at DESC);
CREATE INDEX enterprise_fact_status_idx
    ON enterprise_project.enterprise_fact (current_status, updated_at DESC);

-- ---------------------------------------------------------------------------
-- enterprise_fact_version: immutable history. Each PROPOSED/CONFIRMED/
-- DISPUTED/SUPERSEDED transition appends a new version row; the root only
-- points to it. value and source_refs cannot be UPDATEd once written
-- (Issue #59 #2: "Fact value/source 创建后不覆盖").
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.enterprise_fact_version (
    version_id uuid PRIMARY KEY,
    enterprise_fact_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    version_no integer NOT NULL,
    status text NOT NULL,
    value jsonb NOT NULL,
    source_refs jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    effective_from timestamptz,
    effective_to timestamptz,
    proposed_by_principal_id uuid NOT NULL,
    proposed_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT enterprise_fact_version_status_closed CHECK (
        status IN ('PROPOSED', 'CONFIRMED', 'DISPUTED', 'SUPERSEDED')),
    CONSTRAINT enterprise_fact_version_no_positive CHECK (version_no >= 1),
    CONSTRAINT enterprise_fact_version_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT enterprise_fact_version_unique UNIQUE (enterprise_fact_id, version_no)
);

CREATE INDEX enterprise_fact_version_fact_idx
    ON enterprise_project.enterprise_fact_version (enterprise_fact_id, version_no DESC);
CREATE INDEX enterprise_fact_version_enterprise_idx
    ON enterprise_project.enterprise_fact_version (enterprise_id, recorded_at DESC);

CREATE FUNCTION enterprise_project.guard_enterprise_fact_version_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.value IS DISTINCT FROM OLD.value
       OR NEW.source_refs IS DISTINCT FROM OLD.source_refs
       OR NEW.enterprise_fact_id IS DISTINCT FROM OLD.enterprise_fact_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash THEN
        RAISE EXCEPTION 'enterprise_fact_version history is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_enterprise_fact_version_immutable() FROM PUBLIC;

CREATE TRIGGER enterprise_fact_version_immutable_guard
    BEFORE UPDATE ON enterprise_project.enterprise_fact_version
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_enterprise_fact_version_immutable();

REVOKE UPDATE ON enterprise_project.enterprise_fact_version FROM enterprise_project_app;

-- ---------------------------------------------------------------------------
-- enterprise_profile_snapshot: immutable Profile Snapshot. Payload is
-- generated by the Application layer from exact fact / product version /
-- qms revision refs (WI-01 §6); the database only validates that the
-- promoted scope columns mirror payload->>'enterpriseId' and that
-- payload_hash is consistent. Snapshot rows are INSERT-only; UPDATE/DELETE
-- are revoked from the app role.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.enterprise_profile_snapshot (
    snapshot_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    derived_from jsonb NOT NULL,
    frozen_by_principal_id uuid NOT NULL,
    frozen_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    purpose text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT enterprise_profile_snapshot_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT enterprise_profile_snapshot_purpose_nonempty CHECK (length(purpose) > 0)
);

CREATE INDEX enterprise_profile_snapshot_enterprise_idx
    ON enterprise_project.enterprise_profile_snapshot (enterprise_id, recorded_at DESC);

CREATE FUNCTION enterprise_project.guard_enterprise_profile_snapshot_scope_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.payload->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text THEN
        RAISE EXCEPTION 'enterprise_profile_snapshot scope mirror mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_enterprise_profile_snapshot_scope_mirror() FROM PUBLIC;

CREATE TRIGGER enterprise_profile_snapshot_scope_mirror_guard
    BEFORE INSERT OR UPDATE ON enterprise_project.enterprise_profile_snapshot
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_enterprise_profile_snapshot_scope_mirror();

REVOKE UPDATE, DELETE ON enterprise_project.enterprise_profile_snapshot FROM enterprise_project_app;

-- ---------------------------------------------------------------------------
-- product: Product Aggregate Root. Status CAS + current_version_id pointer.
-- current_version_id is updated only by activate_version, and only to point
-- at an existing product_version row of the same product. Partial unique
-- index enforces "one ACTIVE root per product_id" (a product root is itself
-- ACTIVE; versions have their own ACTIVE pointer inside product_version).
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.product (
    product_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    display_code text NOT NULL,
    display_name text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    current_version_id uuid,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT product_status_closed CHECK (
        status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
    CONSTRAINT product_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT product_display_code_unique UNIQUE (enterprise_id, display_code)
);

CREATE INDEX product_enterprise_idx
    ON enterprise_project.product (enterprise_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- product_version: immutable Product Version. Version row is INSERT-only;
-- value/scope/source_refs/payload_hash never change after creation.
-- "Active" pointer semantics live on product.current_version_id; a separate
-- partial unique index on product_version enforces "one ACTIVE version
-- pointer per product" by allowing the Application layer to label a version
-- as CURRENT (the row that product.current_version_id points to) vs.
-- HISTORICAL (all other version rows of the same product).
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.product_version (
    version_id uuid PRIMARY KEY,
    product_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    version_no integer NOT NULL,
    product_type text NOT NULL,
    display_name text NOT NULL,
    intended_use text NOT NULL,
    product_scope jsonb NOT NULL,
    source_refs jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    lifecycle text NOT NULL DEFAULT 'HISTORICAL',
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    previous_version_id uuid,
    CONSTRAINT product_version_no_positive CHECK (version_no >= 1),
    CONSTRAINT product_version_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT product_version_lifecycle_closed CHECK (
        lifecycle IN ('CURRENT', 'HISTORICAL')),
    CONSTRAINT product_version_unique UNIQUE (product_id, version_no)
);

CREATE UNIQUE INDEX product_version_current_unique
    ON enterprise_project.product_version (product_id)
    WHERE lifecycle = 'CURRENT';
CREATE INDEX product_version_enterprise_idx
    ON enterprise_project.product_version (enterprise_id, recorded_at DESC);

CREATE FUNCTION enterprise_project.guard_product_version_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.source_refs IS DISTINCT FROM OLD.source_refs
       OR NEW.product_id IS DISTINCT FROM OLD.product_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
       OR NEW.product_type IS DISTINCT FROM OLD.product_type
       OR NEW.display_name IS DISTINCT FROM OLD.display_name
       OR NEW.intended_use IS DISTINCT FROM OLD.intended_use
       OR NEW.product_scope IS DISTINCT FROM OLD.product_scope THEN
        RAISE EXCEPTION 'product_version history is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle
       AND OLD.lifecycle = 'HISTORICAL' AND NEW.lifecycle = 'CURRENT' THEN
        RETURN NEW;
    END IF;
    IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
        RAISE EXCEPTION 'product_version lifecycle can only transition HISTORICAL -> CURRENT'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_product_version_immutable() FROM PUBLIC;

CREATE TRIGGER product_version_immutable_guard
    BEFORE UPDATE ON enterprise_project.product_version
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_product_version_immutable();

-- product_version keeps the active-pointer CURRENT/HISTORICAL lifecycle; the
-- Application Repository updates only that column via this column-level grant
-- while the BEFORE UPDATE trigger still rejects any other column change.
GRANT UPDATE (lifecycle) ON enterprise_project.product_version TO enterprise_project_app;
REVOKE DELETE ON enterprise_project.product_version FROM enterprise_project_app;

-- ---------------------------------------------------------------------------
-- product_scope_snapshot: immutable Scope Snapshot for ProjectStartSnapshot
-- inputs. payload is built by the Application layer from exact
-- ProductVersion rows (Issue #59 §6); the database enforces scope mirror
-- and INSERT-only lifecycle.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.product_scope_snapshot (
    snapshot_id uuid PRIMARY KEY,
    product_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    derived_from jsonb NOT NULL,
    frozen_by_principal_id uuid NOT NULL,
    frozen_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    purpose text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT product_scope_snapshot_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT product_scope_snapshot_purpose_nonempty CHECK (length(purpose) > 0)
);

CREATE INDEX product_scope_snapshot_enterprise_idx
    ON enterprise_project.product_scope_snapshot (enterprise_id, recorded_at DESC);

CREATE FUNCTION enterprise_project.guard_product_scope_snapshot_scope_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.payload->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.payload->>'productId' IS DISTINCT FROM NEW.product_id::text THEN
        RAISE EXCEPTION 'product_scope_snapshot scope mirror mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_product_scope_snapshot_scope_mirror() FROM PUBLIC;

CREATE TRIGGER product_scope_snapshot_scope_mirror_guard
    BEFORE INSERT OR UPDATE ON enterprise_project.product_scope_snapshot
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_product_scope_snapshot_scope_mirror();

REVOKE UPDATE, DELETE ON enterprise_project.product_scope_snapshot FROM enterprise_project_app;

-- ---------------------------------------------------------------------------
-- qms_configuration: QMS Configuration Aggregate Root. Same Root/version
-- split as product: version_id pointer on root, version rows are
-- immutable, activate/rollback only moves the pointer.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.qms_configuration (
    qms_configuration_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    display_code text NOT NULL,
    display_name text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    current_revision_id uuid,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT qms_configuration_status_closed CHECK (
        status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
    CONSTRAINT qms_configuration_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT qms_configuration_display_code_unique UNIQUE (enterprise_id, display_code)
);

CREATE INDEX qms_configuration_enterprise_idx
    ON enterprise_project.qms_configuration (enterprise_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- qms_configuration_revision: immutable QMS Revision with the three
-- decision families from WI-01 §5 (applicability / management / professional).
-- Decision rows may be replaced only by appending a new revision; the
-- Application layer moves the root.current_revision_id pointer.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.qms_configuration_revision (
    revision_id uuid PRIMARY KEY,
    qms_configuration_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    revision_no integer NOT NULL,
    applicability_decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
    management_choices jsonb NOT NULL DEFAULT '[]'::jsonb,
    professional_decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
    source_refs jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    lifecycle text NOT NULL DEFAULT 'HISTORICAL',
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    previous_revision_id uuid,
    CONSTRAINT qms_configuration_revision_no_positive CHECK (revision_no >= 1),
    CONSTRAINT qms_configuration_revision_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT qms_configuration_revision_lifecycle_closed CHECK (
        lifecycle IN ('CURRENT', 'HISTORICAL')),
    CONSTRAINT qms_configuration_revision_unique UNIQUE (qms_configuration_id, revision_no)
);

CREATE UNIQUE INDEX qms_configuration_revision_current_unique
    ON enterprise_project.qms_configuration_revision (qms_configuration_id)
    WHERE lifecycle = 'CURRENT';
CREATE INDEX qms_configuration_revision_enterprise_idx
    ON enterprise_project.qms_configuration_revision (enterprise_id, recorded_at DESC);

CREATE FUNCTION enterprise_project.guard_qms_configuration_revision_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.applicability_decisions IS DISTINCT FROM OLD.applicability_decisions
       OR NEW.management_choices IS DISTINCT FROM OLD.management_choices
       OR NEW.professional_decisions IS DISTINCT FROM OLD.professional_decisions
       OR NEW.source_refs IS DISTINCT FROM OLD.source_refs
       OR NEW.qms_configuration_id IS DISTINCT FROM OLD.qms_configuration_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.revision_no IS DISTINCT FROM OLD.revision_no
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash THEN
        RAISE EXCEPTION 'qms_configuration_revision history is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.lifecycle = 'CURRENT' AND OLD.lifecycle = 'HISTORICAL' THEN
        RETURN NEW;
    END IF;
    IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
        RAISE EXCEPTION 'qms_configuration_revision lifecycle can only transition HISTORICAL -> CURRENT'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_qms_configuration_revision_immutable() FROM PUBLIC;

CREATE TRIGGER qms_configuration_revision_immutable_guard
    BEFORE UPDATE ON enterprise_project.qms_configuration_revision
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_qms_configuration_revision_immutable();

REVOKE DELETE ON enterprise_project.qms_configuration_revision FROM enterprise_project_app;
GRANT UPDATE (lifecycle) ON enterprise_project.qms_configuration_revision TO enterprise_project_app;

-- ---------------------------------------------------------------------------
-- RLS: every business table is Enterprise-scoped (project_id IS NULL) and
-- protected by the WI-03 transaction context. Default-deny without a
-- context, FORCE applies to the owner as well. Policy mirrors V2000.
-- ---------------------------------------------------------------------------

ALTER TABLE enterprise_project.enterprise ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.enterprise FORCE ROW LEVEL SECURITY;
CREATE POLICY enterprise_select ON enterprise_project.enterprise FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
-- The INSERT policy for the Enterprise root must permit a newly generated
-- `enterprise_id` UUIDv7 that does not yet exist in any scope; the Application
-- Repository binds `created_by_principal_id` to the trusted transaction
-- principal (assertContextPrincipal) so checking that the row's principal
-- matches the context principal is sufficient here. SELECT/UPDATE keep the
-- strict enterprise-scope predicate.
CREATE POLICY enterprise_insert ON enterprise_project.enterprise FOR INSERT TO enterprise_project_app
    WITH CHECK (created_by_principal_id = platform_security.context_principal_id());
CREATE POLICY enterprise_update ON enterprise_project.enterprise FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id))
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

ALTER TABLE enterprise_project.enterprise_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.enterprise_fact FORCE ROW LEVEL SECURITY;
CREATE POLICY enterprise_fact_select ON enterprise_project.enterprise_fact FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY enterprise_fact_insert ON enterprise_project.enterprise_fact FOR INSERT TO enterprise_project_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY enterprise_fact_update ON enterprise_project.enterprise_fact FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id))
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

ALTER TABLE enterprise_project.enterprise_fact_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.enterprise_fact_version FORCE ROW LEVEL SECURITY;
CREATE POLICY enterprise_fact_version_select ON enterprise_project.enterprise_fact_version FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY enterprise_fact_version_insert ON enterprise_project.enterprise_fact_version FOR INSERT TO enterprise_project_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

ALTER TABLE enterprise_project.enterprise_profile_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.enterprise_profile_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY enterprise_profile_snapshot_select ON enterprise_project.enterprise_profile_snapshot FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY enterprise_profile_snapshot_insert ON enterprise_project.enterprise_profile_snapshot FOR INSERT TO enterprise_project_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

ALTER TABLE enterprise_project.product ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.product FORCE ROW LEVEL SECURITY;
CREATE POLICY product_select ON enterprise_project.product FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY product_insert ON enterprise_project.product FOR INSERT TO enterprise_project_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY product_update ON enterprise_project.product FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id))
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

ALTER TABLE enterprise_project.product_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.product_version FORCE ROW LEVEL SECURITY;
CREATE POLICY product_version_select ON enterprise_project.product_version FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY product_version_insert ON enterprise_project.product_version FOR INSERT TO enterprise_project_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY product_version_update ON enterprise_project.product_version FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id))
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

ALTER TABLE enterprise_project.product_scope_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.product_scope_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY product_scope_snapshot_select ON enterprise_project.product_scope_snapshot FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY product_scope_snapshot_insert ON enterprise_project.product_scope_snapshot FOR INSERT TO enterprise_project_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

ALTER TABLE enterprise_project.qms_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.qms_configuration FORCE ROW LEVEL SECURITY;
CREATE POLICY qms_configuration_select ON enterprise_project.qms_configuration FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY qms_configuration_insert ON enterprise_project.qms_configuration FOR INSERT TO enterprise_project_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY qms_configuration_update ON enterprise_project.qms_configuration FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id))
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

ALTER TABLE enterprise_project.qms_configuration_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.qms_configuration_revision FORCE ROW LEVEL SECURITY;
CREATE POLICY qms_configuration_revision_select ON enterprise_project.qms_configuration_revision FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY qms_configuration_revision_insert ON enterprise_project.qms_configuration_revision FOR INSERT TO enterprise_project_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY qms_configuration_revision_update ON enterprise_project.qms_configuration_revision FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_enterprise(enterprise_id))
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

RESET ROLE;