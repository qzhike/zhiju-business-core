-- #266: self-only workspace self-discovery read boundary for trusted Human
-- sessions. The verified principal's own CURRENT Project-scope candidate grants
-- are read under a dedicated NOLOGIN/NOINHERIT/NOBYPASSRLS role whose RLS
-- policy exposes only rows owned by that principal in the trusted technical
-- context (Logical Model "Workspace self-discovery" / IP Spec #258). The Core
-- path establishes the context under platform_context_establisher and then
-- SET LOCAL ROLE identity_workspace_discovery_reader; the role itself can
-- never write, bypass RLS, reach EnterpriseProject or enumerate other
-- principals. Existing app/audit/dispatcher/projection grants are untouched.
DO $roles$ BEGIN
 CREATE ROLE identity_workspace_discovery_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
END $roles$;
GRANT USAGE ON SCHEMA identity_policy, platform_security TO identity_workspace_discovery_reader;
GRANT EXECUTE ON FUNCTION platform_security.context_is_valid(), platform_security.context_principal_id() TO identity_workspace_discovery_reader;
SET ROLE identity_policy_owner;

REVOKE ALL ON identity_policy.capability_grant FROM PUBLIC;

-- SELECT only: the reader can never INSERT/UPDATE/DELETE or take ownership.
-- The candidate scan reads the owning capability_grant rows exclusively, so no
-- role/revocation table is granted here; a later need must add its own
-- bounded policy rather than widening this one.
GRANT SELECT ON identity_policy.capability_grant TO identity_workspace_discovery_reader;

-- capability_grant: self-only and Project-scope only. A row is visible only for
-- the principal carried by the trusted technical context, only while that
-- context is valid, and only as a Project grant candidate scope. An
-- Enterprise-scope or wildcard row is never exposed, so the reader cannot
-- expand an Enterprise grant into Project candidates.
ALTER TABLE identity_policy.capability_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.capability_grant FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_discovery_reader_select ON identity_policy.capability_grant
    FOR SELECT TO identity_workspace_discovery_reader
    USING (
        platform_security.context_is_valid()
        AND scope_kind = 'PROJECT'
        AND principal_id = platform_security.context_principal_id());

RESET ROLE;
