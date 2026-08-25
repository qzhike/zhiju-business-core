-- IM-03 WI-03 (issue #59): allow CURRENT -> HISTORICAL transitions on
-- product_version / qms_configuration_revision so the activate handlers
-- can move the active pointer off the previous CURRENT row when the
-- new version is flipped CURRENT. The original V2001 trigger only
-- allowed HISTORICAL -> CURRENT, which is correct for the "no
-- field can be silently re-edited" invariant but blocks the swap
-- step the activate capability must perform. All other field changes
-- are still rejected by the same per-field DISTINCT checks.

SET ROLE enterprise_project_owner;

CREATE OR REPLACE FUNCTION enterprise_project.guard_product_version_lifecycle() RETURNS trigger
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
    IF NEW.lifecycle = 'CURRENT' AND OLD.lifecycle = 'HISTORICAL' THEN
        RETURN NEW;
    END IF;
    IF NEW.lifecycle = 'HISTORICAL' AND OLD.lifecycle = 'CURRENT' THEN
        RETURN NEW;
    END IF;
    IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
        RAISE EXCEPTION 'product_version lifecycle can only transition HISTORICAL <-> CURRENT'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_product_version_lifecycle() FROM PUBLIC;

DROP TRIGGER product_version_immutable_guard ON enterprise_project.product_version;
CREATE TRIGGER product_version_immutable_guard
    BEFORE UPDATE ON enterprise_project.product_version
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_product_version_lifecycle();

CREATE OR REPLACE FUNCTION enterprise_project.guard_qms_configuration_revision_lifecycle() RETURNS trigger
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
    IF NEW.lifecycle = 'HISTORICAL' AND OLD.lifecycle = 'CURRENT' THEN
        RETURN NEW;
    END IF;
    IF NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
        RAISE EXCEPTION 'qms_configuration_revision lifecycle can only transition HISTORICAL <-> CURRENT'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_qms_configuration_revision_lifecycle() FROM PUBLIC;

DROP TRIGGER qms_configuration_revision_immutable_guard ON enterprise_project.qms_configuration_revision;
CREATE TRIGGER qms_configuration_revision_immutable_guard
    BEFORE UPDATE ON enterprise_project.qms_configuration_revision
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_qms_configuration_revision_lifecycle();

RESET ROLE;