-- IM-03 WI-04 repair: bind Project-owned INSERT policies to the trusted
-- Enterprise context and make the absence of a VersionedRef content hash
-- explicit instead of storing a fabricated digest.

SET ROLE enterprise_project_owner;

ALTER TABLE enterprise_project.project
    ALTER COLUMN member_policy_payload_hash DROP NOT NULL;
ALTER TABLE enterprise_project.project
    DROP CONSTRAINT project_member_policy_hash_len;
ALTER TABLE enterprise_project.project
    ADD CONSTRAINT project_member_policy_hash_len CHECK (
        member_policy_payload_hash IS NULL
        OR octet_length(member_policy_payload_hash) = 32);

ALTER TABLE enterprise_project.project_snapshot_binding
    ALTER COLUMN member_policy_payload_hash DROP NOT NULL;
ALTER TABLE enterprise_project.project_snapshot_binding
    DROP CONSTRAINT project_snapshot_binding_member_policy_hash_len;
ALTER TABLE enterprise_project.project_snapshot_binding
    ADD CONSTRAINT project_snapshot_binding_member_policy_hash_len CHECK (
        member_policy_payload_hash IS NULL
        OR octet_length(member_policy_payload_hash) = 32);

DROP POLICY project_insert ON enterprise_project.project;
CREATE POLICY project_insert ON enterprise_project.project
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        created_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_enterprise(enterprise_id));

DROP POLICY project_scope_claim_insert ON enterprise_project.project_scope_claim;
CREATE POLICY project_scope_claim_insert ON enterprise_project.project_scope_claim
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        claimed_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_enterprise(enterprise_id));

DROP POLICY project_snapshot_binding_insert ON enterprise_project.project_snapshot_binding;
CREATE POLICY project_snapshot_binding_insert ON enterprise_project.project_snapshot_binding
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        bound_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_enterprise(enterprise_id));

RESET ROLE;
