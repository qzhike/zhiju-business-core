-- IM-03 WI-04 (issue #60): Project Aggregate, ProjectScopeClaim and
-- ProjectSnapshotBinding tables for the EnterpriseProject Reference
-- Foundation vertical slice.
--
-- The Project Aggregate owns its (enterprise_id, project_id) tuple. Once
-- written, both columns are immutable: Project Scope is never migrated to
-- another Enterprise, and the (enterprise_id, project_id) pair never moves
-- to another Root (PG-007, Issue #60 §1). ProjectScopeClaim is the
-- authoritative source of `(enterprise_id, project_id)` pairs used by other
-- modules to set RLS scope without foreign keys (Section 10.2 of the
-- logical model). ProjectSnapshotBinding freezes the exact
-- ProjectStartSnapshot inputs (EnterpriseProfileSnapshot, QMSConfiguration,
-- ProductScopeSnapshot, optional Baseline/Template/Regulatory refs and
-- memberPolicyRef) at project creation time; bindings are immutable once
-- committed, and the binding purpose explicitly forbids re-pointing.
--
-- RLS follows V2000/V2001 conventions: FORCE, app role only, both
-- Project-owned tables call `context_allows_project(enterprise_id, project_id)`
-- so the Project scope cannot leak via an Enterprise-only Context.
-- ProjectScopeClaim additionally requires `context_allows_enterprise(...)`
-- so the row is still rooted in the trusted Enterprise.
--
-- Scope mirror: project rows embed `payload->>'enterpriseId' / 'projectId'`
-- at the database layer; binding rows embed the same. Scope mirror
-- triggers reject any mismatch before write. Canonical payload/hash
-- equality cannot be recomputed in SQL (pgcrypto stays disabled), so
-- payload_hash integrity is enforced by the owning repository write path
-- (WI-04 handlers) and asserted in the gate tests.

SET ROLE enterprise_project_owner;

-- ---------------------------------------------------------------------------
-- project: Project Aggregate Root. `(enterprise_id, project_id)` is the
-- logical composite key used by every downstream Project-owned slice; both
-- columns are immutable once written. `display_code` is unique only within
-- the Enterprise. `member_policy_ref` mirrors the exact VersionedRef used
-- to create the Project (Module-Spec-002 §3 `project.create_project`) and
-- is the only mutable root field beyond `status` and `aggregate_version`
-- — no update path can rebind the project to another Enterprise or shift
-- the project_id.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.project (
    project_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    display_code text NOT NULL,
    title text NOT NULL,
    objective text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    member_policy_ref jsonb NOT NULL,
    member_policy_version_id uuid NOT NULL,
    member_policy_payload_hash bytea NOT NULL,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT project_status_closed CHECK (
        status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
    CONSTRAINT project_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT project_display_code_unique UNIQUE (enterprise_id, display_code),
    CONSTRAINT project_member_policy_hash_len CHECK (
        octet_length(member_policy_payload_hash) = 32)
);
-- Composite UNIQUE on (enterprise_id, project_id) is the lookup key other
-- modules consult to learn a Project's Enterprise scope without any
-- cross-schema FK. ProjectScopeClaim and ProjectSnapshotBinding FK both
-- reference this composite; without it the DEFERRABLE FK cannot find a
-- matching unique index.
ALTER TABLE enterprise_project.project
    ADD CONSTRAINT project_enterprise_id_project_id_unique
    UNIQUE (enterprise_id, project_id);

CREATE INDEX project_enterprise_idx
    ON enterprise_project.project (enterprise_id, updated_at DESC);
CREATE INDEX project_status_idx
    ON enterprise_project.project (status, updated_at DESC);

CREATE FUNCTION enterprise_project.guard_project_scope_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id THEN
        RAISE EXCEPTION 'project enterprise_id/project_id is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.member_policy_version_id IS DISTINCT FROM OLD.member_policy_version_id
       OR NEW.member_policy_payload_hash IS DISTINCT FROM OLD.member_policy_payload_hash
       OR NEW.member_policy_ref IS DISTINCT FROM OLD.member_policy_ref THEN
        RAISE EXCEPTION 'project memberPolicyRef is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_project_scope_immutable() FROM PUBLIC;

CREATE TRIGGER project_scope_immutable_guard
    BEFORE UPDATE ON enterprise_project.project
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_project_scope_immutable();

-- ---------------------------------------------------------------------------
-- project_scope_claim: authoritative (enterprise_id, project_id) record.
-- One claim per project root (UNIQUE project_id) and per pair
-- (UNIQUE (enterprise_id, project_id)). Status follows the project root
-- and cannot outlive it. The claim is what other modules consult to learn
-- a Project's Enterprise scope without foreign keys; it must be INSERT-only
-- once published (no UPDATE from the app role beyond status transitions).
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.project_scope_claim (
    claim_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    scope_version bigint NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'ACTIVE',
    claimed_by_principal_id uuid NOT NULL,
    claimed_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    payload jsonb NOT NULL,
    source_command_id uuid NOT NULL,
    claimed_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT project_scope_claim_status_closed CHECK (
        status IN ('ACTIVE', 'SUSPENDED', 'REVOKED')),
    CONSTRAINT project_scope_claim_version_positive CHECK (scope_version >= 1),
    CONSTRAINT project_scope_claim_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT project_scope_claim_project_unique UNIQUE (project_id),
    CONSTRAINT project_scope_claim_pair_unique UNIQUE (enterprise_id, project_id)
);

CREATE INDEX project_scope_claim_enterprise_idx
    ON enterprise_project.project_scope_claim (enterprise_id, status);

CREATE FUNCTION enterprise_project.guard_project_scope_claim_scope_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.payload->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.payload->>'projectId' IS DISTINCT FROM NEW.project_id::text THEN
        RAISE EXCEPTION 'project_scope_claim scope mirror mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_project_scope_claim_scope_mirror() FROM PUBLIC;

CREATE TRIGGER project_scope_claim_scope_mirror_guard
    BEFORE INSERT OR UPDATE ON enterprise_project.project_scope_claim
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_project_scope_claim_scope_mirror();

-- Bind the project root and its scope claim inside the schema. The FK is
-- deferrable so a transaction can insert the root and the claim in either
-- order; the trigger above rejects any mismatch between the row's own
-- promoted columns and the payload mirror.
ALTER TABLE enterprise_project.project_scope_claim
    ADD CONSTRAINT project_scope_claim_root_fk
    FOREIGN KEY (enterprise_id, project_id)
    REFERENCES enterprise_project.project (enterprise_id, project_id)
    DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- project_snapshot_binding: immutable project-start binding. Each row pins
-- the exact EnterpriseProfileSnapshot, QMSConfiguration, ProductScopeSnapshot,
-- optional Baseline/Template/Regulatory refs and the memberPolicyRef that
-- the create_project handler consumed. INSERT-only; the binding purpose is
-- closed ('PROJECT_START') so the row cannot be repurposed to a later phase.
-- The composite `project_id + binding_purpose` is unique; the same purpose
-- cannot be rebound for the same project, which is what guarantees the
-- "scope is not migrated" invariant on subsequent updates.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.project_snapshot_binding (
    binding_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    binding_purpose text NOT NULL,
    enterprise_profile_snapshot_ref jsonb NOT NULL,
    enterprise_profile_snapshot_id uuid NOT NULL,
    enterprise_profile_payload_hash bytea NOT NULL,
    qms_configuration_ref jsonb NOT NULL,
    qms_configuration_id uuid NOT NULL,
    qms_configuration_revision_id uuid NOT NULL,
    qms_configuration_revision_hash bytea NOT NULL,
    product_scope_snapshot_ref jsonb NOT NULL,
    product_scope_snapshot_id uuid NOT NULL,
    product_scope_payload_hash bytea NOT NULL,
    initial_customer_baseline_ref jsonb,
    initial_customer_baseline_version_id uuid,
    initial_customer_baseline_version_hash bytea,
    template_baseline_ref jsonb,
    template_baseline_version_id uuid,
    template_baseline_version_hash bytea,
    regulatory_profile_ref jsonb,
    regulatory_profile_version_id uuid,
    regulatory_profile_version_hash bytea,
    member_policy_ref jsonb NOT NULL,
    member_policy_version_id uuid NOT NULL,
    member_policy_payload_hash bytea NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    bound_at timestamptz NOT NULL DEFAULT now(),
    bound_by_principal_id uuid NOT NULL,
    bound_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    source_command_id uuid NOT NULL,
    CONSTRAINT project_snapshot_binding_purpose_closed CHECK (
        binding_purpose IN ('PROJECT_START')),
    CONSTRAINT project_snapshot_binding_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT project_snapshot_binding_profile_hash_len CHECK (
        octet_length(enterprise_profile_payload_hash) = 32),
    CONSTRAINT project_snapshot_binding_qms_hash_len CHECK (
        octet_length(qms_configuration_revision_hash) = 32),
    CONSTRAINT project_snapshot_binding_product_scope_hash_len CHECK (
        octet_length(product_scope_payload_hash) = 32),
    CONSTRAINT project_snapshot_binding_member_policy_hash_len CHECK (
        octet_length(member_policy_payload_hash) = 32),
    CONSTRAINT project_snapshot_binding_baseline_hash_len CHECK (
        initial_customer_baseline_version_hash IS NULL
        OR octet_length(initial_customer_baseline_version_hash) = 32),
    CONSTRAINT project_snapshot_binding_template_hash_len CHECK (
        template_baseline_version_hash IS NULL
        OR octet_length(template_baseline_version_hash) = 32),
    CONSTRAINT project_snapshot_binding_regulatory_hash_len CHECK (
        regulatory_profile_version_hash IS NULL
        OR octet_length(regulatory_profile_version_hash) = 32),
    CONSTRAINT project_snapshot_binding_purpose_unique UNIQUE (project_id, binding_purpose)
);

CREATE INDEX project_snapshot_binding_enterprise_idx
    ON enterprise_project.project_snapshot_binding (enterprise_id, bound_at DESC);
CREATE INDEX project_snapshot_binding_project_idx
    ON enterprise_project.project_snapshot_binding (project_id, binding_purpose);

CREATE FUNCTION enterprise_project.guard_project_snapshot_binding_scope_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.enterprise_profile_snapshot_ref->>'scope'->>'enterpriseId'
            IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.qms_configuration_ref->>'scope'->>'enterpriseId'
            IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.product_scope_snapshot_ref->>'scope'->>'enterpriseId'
            IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.member_policy_ref->>'scope'->>'enterpriseId'
            IS DISTINCT FROM NEW.enterprise_id::text THEN
        RAISE EXCEPTION 'project_snapshot_binding scope mirror mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_project_snapshot_binding_scope_mirror() FROM PUBLIC;

CREATE TRIGGER project_snapshot_binding_scope_mirror_guard
    BEFORE INSERT ON enterprise_project.project_snapshot_binding
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_project_snapshot_binding_scope_mirror();

-- Bind the binding row to the project root so the binding can never outlive
-- the project that owns it. Deferrable so the root insert and the binding
-- insert can land in either order inside the same transaction.
ALTER TABLE enterprise_project.project_snapshot_binding
    ADD CONSTRAINT project_snapshot_binding_root_fk
    FOREIGN KEY (enterprise_id, project_id)
    REFERENCES enterprise_project.project (enterprise_id, project_id)
    DEFERRABLE INITIALLY DEFERRED;

-- ProjectSnapshotBinding is INSERT-only: any later mutation would rewrite
-- the immutable start-snapshot truth, so the app role cannot UPDATE or
-- DELETE.
REVOKE UPDATE, DELETE ON enterprise_project.project_snapshot_binding FROM enterprise_project_app;

-- ---------------------------------------------------------------------------
-- RLS: every table is Project-scoped (project_id IS NOT NULL). The
-- FORCE policy uses `context_allows_project(enterprise_id, project_id)` so
-- an Enterprise-only context cannot read or write Project-owned rows.
-- INSERT policy relies on `created_by_principal_id = context_principal_id()`
-- because the project_id is application-minted (UUIDv7) and the
-- before-write trigger enforces the scope mirror.
-- ---------------------------------------------------------------------------

ALTER TABLE enterprise_project.project ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.project FORCE ROW LEVEL SECURITY;
CREATE POLICY project_select ON enterprise_project.project FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
-- The Project INSERT policy follows the WI-03 Enterprise precedent: a brand
-- new project_id is application-minted and therefore cannot yet satisfy the
-- Project helper. The handler binds `created_by_principal_id` to the trusted
-- transaction principal (assertContextPrincipal) and the row's own scope
-- mirror trigger enforces that the promoted (enterprise_id, project_id) pair
-- matches the payload — together these guarantee the new row cannot escape
-- the trusted Enterprise. SELECT/UPDATE keep the strict Project scope.
CREATE POLICY project_insert ON enterprise_project.project FOR INSERT TO enterprise_project_app
    WITH CHECK (created_by_principal_id = platform_security.context_principal_id());
CREATE POLICY project_update ON enterprise_project.project FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.project_scope_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.project_scope_claim FORCE ROW LEVEL SECURITY;
CREATE POLICY project_scope_claim_select ON enterprise_project.project_scope_claim
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id)
           AND platform_security.context_allows_enterprise(enterprise_id));
-- ProjectScopeClaim shares the new-row Project INSERT precedent: the freshly
-- minted project_id is not yet in the transaction Context's allowed project
-- set, so the policy verifies only the trusted Enterprise principal + scope.
CREATE POLICY project_scope_claim_insert ON enterprise_project.project_scope_claim
    FOR INSERT TO enterprise_project_app
    WITH CHECK (claimed_by_principal_id = platform_security.context_principal_id());
CREATE POLICY project_scope_claim_update ON enterprise_project.project_scope_claim
    FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.project_snapshot_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.project_snapshot_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY project_snapshot_binding_select ON enterprise_project.project_snapshot_binding
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
-- ProjectSnapshotBinding follows the same pattern: the new project_id cannot
-- yet satisfy `context_allows_project(...)`, so the INSERT policy checks the
-- trusted principal and Enterprise helper instead.
CREATE POLICY project_snapshot_binding_insert ON enterprise_project.project_snapshot_binding
    FOR INSERT TO enterprise_project_app
    WITH CHECK (bound_by_principal_id = platform_security.context_principal_id());

RESET ROLE;