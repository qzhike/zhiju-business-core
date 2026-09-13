-- IM-06 (#186): IdentityPolicy-owned scoped PolicyVersion facts.
-- Design authority: Module-Spec-001 §13.2/§13.4/§13.6, decisions §12.2–12.9.
--
-- One immutable fact row per Policy version key. The unique version binding
-- and the unique supersede edge are database constraints, so concurrent
-- writers cannot fork a binding or a successor; the version-key uniqueness
-- covers every row (NULLS NOT DISTINCT binds Enterprise rows with
-- project_id IS NULL) while successor uniqueness only constrains real
-- supersede edges (partial index), so initial versions of different Policies
-- coexist. Enterprise policy bodies never enter the Platform policy_snapshot
-- table: these rows are Enterprise/Project scoped and use the same FORCE RLS
-- branches as the other scoped IdentityPolicy tables.
--
-- Executed as identity_policy_owner so the WI-02 default privileges apply
-- (SELECT/INSERT/UPDATE to the app role, nothing to PUBLIC), then tightened
-- to append-only.

SET ROLE identity_policy_owner;

CREATE TABLE identity_policy.policy_version (
    policy_version_fact_id uuid PRIMARY KEY,
    policy_object_id uuid NOT NULL,
    policy_key_version_id uuid NOT NULL,
    scope_kind text NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    supersedes_object_id uuid,
    supersedes_version_id uuid,
    policy_set_version text NOT NULL,
    policy_schema_refs jsonb NOT NULL,
    effective_from timestamptz NOT NULL,
    contract_type text NOT NULL,
    contract_version text NOT NULL,
    schema_registry_version text NOT NULL,
    canonicalization_version text NOT NULL,
    payload_hash_algorithm text NOT NULL,
    payload_hash bytea NOT NULL,
    payload_size_bytes bigint NOT NULL,
    canonical_payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    actor_snapshot_id uuid NOT NULL,
    source_command_id uuid NOT NULL,
    data_classification text NOT NULL,
    retention_class text NOT NULL,
    CONSTRAINT policy_version_scope_closed CHECK (scope_kind IN ('ENTERPRISE', 'PROJECT')),
    CONSTRAINT policy_version_scope_shape CHECK (
        (scope_kind = 'ENTERPRISE' AND project_id IS NULL)
        OR (scope_kind = 'PROJECT' AND project_id IS NOT NULL)),
    CONSTRAINT policy_version_set_version_nonempty CHECK (btrim(policy_set_version) <> ''),
    CONSTRAINT policy_version_schema_refs_shape CHECK (
        jsonb_typeof(policy_schema_refs) = 'array'
        AND jsonb_array_length(policy_schema_refs) >= 1),
    CONSTRAINT policy_version_supersede_pair CHECK (
        (supersedes_object_id IS NULL) = (supersedes_version_id IS NULL)),
    CONSTRAINT policy_version_supersede_not_self CHECK (
        supersedes_object_id IS NULL
        OR supersedes_object_id <> policy_object_id
        OR supersedes_version_id <> policy_key_version_id),
    CONSTRAINT policy_version_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT policy_version_size_nonnegative CHECK (payload_size_bytes >= 0),
    CONSTRAINT policy_version_binding_unique UNIQUE NULLS NOT DISTINCT
        (policy_object_id, policy_key_version_id, enterprise_id, project_id)
);

-- Successor uniqueness only constrains real supersede edges: the predicate is
-- false for initial versions (both columns NULL), so two Policies' first
-- versions never collide on (NULL, NULL, enterprise, project). NULLS NOT
-- DISTINCT keeps Enterprise rows comparable.
CREATE UNIQUE INDEX policy_version_supersede_unique
    ON identity_policy.policy_version
       (supersedes_object_id, supersedes_version_id, enterprise_id, project_id)
    NULLS NOT DISTINCT
    WHERE supersedes_object_id IS NOT NULL AND supersedes_version_id IS NOT NULL;

-- The promoted columns must mirror the canonical payload exactly; the
-- repository checks the same mirrors before the insert and converts any
-- divergence into a stable module error.
CREATE FUNCTION identity_policy.guard_policy_version_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $mirror$
BEGIN
    IF NEW.canonical_payload->'policyRef'->>'objectType'
       IS DISTINCT FROM 'zhiju.identity.policy' THEN
        RAISE EXCEPTION 'policy version promoted mirror mismatch: policyRef.objectType'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.canonical_payload->'policyRef'->>'objectId'
       IS DISTINCT FROM NEW.policy_object_id::text THEN
        RAISE EXCEPTION 'policy version promoted mirror mismatch: policyRef.objectId'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.canonical_payload->'policyRef'->>'versionId'
       IS DISTINCT FROM NEW.policy_key_version_id::text THEN
        RAISE EXCEPTION 'policy version promoted mirror mismatch: policyRef.versionId'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.canonical_payload->'policyRef'->'scope'->>'enterpriseId'
       IS DISTINCT FROM NEW.enterprise_id::text THEN
        RAISE EXCEPTION 'policy version promoted mirror mismatch: policyRef.scope.enterpriseId'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.canonical_payload->'policyRef'->'scope'->>'projectId'
       IS DISTINCT FROM NEW.project_id::text THEN
        RAISE EXCEPTION 'policy version promoted mirror mismatch: policyRef.scope.projectId'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.canonical_payload->>'policySetVersion' IS DISTINCT FROM NEW.policy_set_version THEN
        RAISE EXCEPTION 'policy version promoted mirror mismatch: policySetVersion'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.canonical_payload->'policySchemaRefs' IS DISTINCT FROM NEW.policy_schema_refs THEN
        RAISE EXCEPTION 'policy version promoted mirror mismatch: policySchemaRefs'
            USING ERRCODE = '22023';
    END IF;
    IF (NEW.canonical_payload->>'effectiveFrom')::timestamptz
       IS DISTINCT FROM NEW.effective_from THEN
        RAISE EXCEPTION 'policy version promoted mirror mismatch: effectiveFrom'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.supersedes_object_id IS NULL THEN
        IF NEW.canonical_payload ? 'supersedesRef' THEN
            RAISE EXCEPTION 'policy version promoted mirror mismatch: supersedesRef'
                USING ERRCODE = '22023';
        END IF;
    ELSIF NEW.canonical_payload->'supersedesRef'->>'objectId'
          IS DISTINCT FROM NEW.supersedes_object_id::text
       OR NEW.canonical_payload->'supersedesRef'->>'versionId'
          IS DISTINCT FROM NEW.supersedes_version_id::text THEN
        RAISE EXCEPTION 'policy version promoted mirror mismatch: supersedesRef'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$mirror$;

CREATE TRIGGER policy_version_mirror_guard
    BEFORE INSERT OR UPDATE ON identity_policy.policy_version
    FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_policy_version_mirror();

-- Committed version facts are immutable: no UPDATE path, no DELETE path.
REVOKE UPDATE, DELETE ON identity_policy.policy_version FROM identity_policy_app;

ALTER TABLE identity_policy.policy_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.policy_version FORCE ROW LEVEL SECURITY;
CREATE POLICY policy_version_select ON identity_policy.policy_version
    FOR SELECT TO identity_policy_app
    USING (
        (scope_kind = 'ENTERPRISE' AND platform_security.context_allows_enterprise(enterprise_id))
        OR (scope_kind = 'PROJECT' AND platform_security.context_allows_project(enterprise_id, project_id)));
CREATE POLICY policy_version_insert ON identity_policy.policy_version
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        (scope_kind = 'ENTERPRISE' AND platform_security.context_allows_enterprise(enterprise_id))
        OR (scope_kind = 'PROJECT' AND platform_security.context_allows_project(enterprise_id, project_id)));

RESET ROLE;
