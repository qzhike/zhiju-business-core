-- First accepted template-analysis report; separate from project startup facts.
SET ROLE enterprise_project_owner;
ALTER TABLE enterprise_project.preparation_fact DROP CONSTRAINT preparation_fact_kind_check;
ALTER TABLE enterprise_project.preparation_fact ADD CONSTRAINT preparation_fact_kind_check CHECK(kind IN(
 'PRESET','PUBLICATION','WITHDRAWAL','REQUEST','STEP','SOURCE_LINK','SOURCE','HANDOFF','HANDOFF_STEP','HANDOFF_ATTEMPT','HANDOFF_RESULT','INBOX',
 'ANALYSIS_BASIS','ANALYSIS_BASIS_PUBLICATION','ANALYSIS_BASIS_WITHDRAWAL','ANALYSIS_REPORT','ANALYSIS_CANDIDATES','ANALYSIS_PLAN'));
CREATE TABLE enterprise_project.preparation_report_head (
 project_id uuid PRIMARY KEY REFERENCES enterprise_project.project(project_id),
 enterprise_id uuid NOT NULL,
 source_ref jsonb NOT NULL,
 report_ref jsonb,
 preparation_version bigint NOT NULL CHECK(preparation_version IN(1,2)),
 source_command_id uuid NOT NULL REFERENCES enterprise_project.command_receipt(command_id),
 CHECK((report_ref IS NULL AND preparation_version=1) OR (report_ref IS NOT NULL AND preparation_version=2)),
 CHECK(source_ref->'scope' IS NOT DISTINCT FROM jsonb_build_object('enterpriseId',enterprise_id::text,'projectId',project_id::text))
);
ALTER TABLE enterprise_project.preparation_report_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.preparation_report_head FORCE ROW LEVEL SECURITY;
CREATE POLICY preparation_report_head_scope ON enterprise_project.preparation_report_head TO enterprise_project_app
 USING(platform_security.context_allows_project(enterprise_id,project_id)) WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id));
GRANT SELECT,INSERT,UPDATE ON enterprise_project.preparation_report_head TO enterprise_project_app;
REVOKE DELETE ON enterprise_project.preparation_report_head FROM enterprise_project_app;
CREATE FUNCTION enterprise_project.guard_preparation_report_head() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
DECLARE c enterprise_project.command_receipt%ROWTYPE; f enterprise_project.preparation_fact%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Preparation report history is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM enterprise_project.command_receipt WHERE command_id=NEW.source_command_id;
 IF NOT FOUND OR c.outcome<>'COMMITTED' OR c.enterprise_id<>NEW.enterprise_id OR c.project_id<>NEW.project_id THEN RAISE EXCEPTION 'Preparation report receipt mismatch' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF c.command_type<>'project.capture_preparation_source' OR c.command_version<>'2.0' OR NEW.report_ref IS NOT NULL OR NEW.preparation_version<>1 OR c.result_payload->'preparationSourceRef' IS DISTINCT FROM NEW.source_ref THEN RAISE EXCEPTION 'Preparation report initial source mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.project_id<>OLD.project_id OR NEW.enterprise_id<>OLD.enterprise_id OR NEW.source_ref IS DISTINCT FROM OLD.source_ref OR OLD.report_ref IS NOT NULL OR NEW.preparation_version<>OLD.preparation_version+1 OR c.command_type<>'project.accept_preparation_report' OR c.command_version<>'1.0' THEN RAISE EXCEPTION 'Preparation report CAS mismatch' USING ERRCODE='23514'; END IF;
  SELECT * INTO f FROM enterprise_project.preparation_fact WHERE kind='ANALYSIS_REPORT' AND id::text=NEW.report_ref->>'objectId';
  IF NOT FOUND OR f.payload->'binding'->'reportRef' IS DISTINCT FROM NEW.report_ref OR f.payload->'binding'->'preparationSourceRef' IS DISTINCT FROM NEW.source_ref OR f.project_id<>NEW.project_id THEN RAISE EXCEPTION 'Preparation report current pointer mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION enterprise_project.guard_preparation_report_head() FROM PUBLIC;
CREATE TRIGGER preparation_report_head_guard BEFORE INSERT OR UPDATE OR DELETE ON enterprise_project.preparation_report_head FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_preparation_report_head();
RESET ROLE;
