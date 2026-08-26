-- IM-03 WI-04 repair: read the nested scope object as jsonb before
-- extracting enterpriseId from ProjectSnapshotBinding references.

SET ROLE enterprise_project_owner;

CREATE OR REPLACE FUNCTION enterprise_project.guard_project_snapshot_binding_scope_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.enterprise_profile_snapshot_ref->'scope'->>'enterpriseId'
            IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.qms_configuration_ref->'scope'->>'enterpriseId'
            IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.product_scope_snapshot_ref->'scope'->>'enterpriseId'
            IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.member_policy_ref->'scope'->>'enterpriseId'
            IS DISTINCT FROM NEW.enterprise_id::text THEN
        RAISE EXCEPTION 'project_snapshot_binding scope mirror mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_project_snapshot_binding_scope_mirror() FROM PUBLIC;

RESET ROLE;
