-- #267: controlled Platform company requirement definition/publication.
CREATE ROLE enterprise_project_company_rule_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA enterprise_project, platform_security TO enterprise_project_company_rule_writer;
GRANT EXECUTE ON FUNCTION platform_security.context_is_valid(), platform_security.context_enterprise_id(), platform_security.context_actor_snapshot_id(), platform_security.context_authorization_decision_ref()
 TO enterprise_project_company_rule_writer, enterprise_project_owner;
SET ROLE enterprise_project_owner;
GRANT SELECT ON enterprise_project.reference_template, enterprise_project.reference_template_version,
 enterprise_project.regulatory_reference, enterprise_project.regulatory_reference_version TO enterprise_project_company_rule_writer;
CREATE POLICY company_definition_read ON enterprise_project.reference_template FOR SELECT TO enterprise_project_company_rule_writer
 USING(platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY company_definition_read ON enterprise_project.reference_template_version FOR SELECT TO enterprise_project_company_rule_writer
 USING(platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY company_definition_read ON enterprise_project.regulatory_reference FOR SELECT TO enterprise_project_company_rule_writer
 USING(platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY company_definition_read ON enterprise_project.regulatory_reference_version FOR SELECT TO enterprise_project_company_rule_writer
 USING(platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid);
CREATE TABLE enterprise_project.company_startup_requirement (
 id uuid PRIMARY KEY, code text NOT NULL, version text NOT NULL,
 payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK (octet_length(payload_hash)=32),
 actor_ref jsonb NOT NULL, decision_ref jsonb NOT NULL, source_command_id uuid NOT NULL,
 UNIQUE(code,version)
);
CREATE TABLE enterprise_project.company_startup_requirement_publication (
 id uuid PRIMARY KEY, requirement_id uuid NOT NULL UNIQUE REFERENCES enterprise_project.company_startup_requirement(id) ON DELETE RESTRICT,
 payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 actor_ref jsonb NOT NULL, decision_ref jsonb NOT NULL, source_command_id uuid NOT NULL
);
CREATE TABLE enterprise_project.company_startup_receipt (
 id uuid PRIMARY KEY, operation text NOT NULL, idempotency_key text NOT NULL,
 request_hash bytea NOT NULL CHECK(octet_length(request_hash)=32),
 result jsonb NOT NULL,result_hash bytea NOT NULL CHECK(octet_length(result_hash)=32),
 actor_ref jsonb NOT NULL,decision_ref jsonb NOT NULL, UNIQUE(operation,idempotency_key)
);
ALTER TABLE enterprise_project.company_startup_requirement ADD FOREIGN KEY(source_command_id)
 REFERENCES enterprise_project.company_startup_receipt(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE enterprise_project.company_startup_requirement_publication ADD FOREIGN KEY(source_command_id)
 REFERENCES enterprise_project.company_startup_receipt(id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION enterprise_project.guard_company_startup_fact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guard$
DECLARE p jsonb; h bytea; ctx_decision_id uuid; ctx_decision_hash bytea;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'company startup fact is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='company_startup_receipt' THEN p:=NEW.result; h:=NEW.result_hash;
 ELSE p:=NEW.payload;h:=NEW.payload_hash; END IF;
 IF h IS DISTINCT FROM sha256(convert_to(enterprise_project.canonical_jsonb_text(p),'UTF8')) THEN
  RAISE EXCEPTION 'company startup hash mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.actor_ref->>'kind' IS DISTINCT FROM 'SNAPSHOT' OR NEW.actor_ref->>'objectType' IS DISTINCT FROM 'identity.actor_snapshot'
    OR NEW.actor_ref->'scope' IS DISTINCT FROM '{}'::jsonb OR NEW.decision_ref->>'kind' IS DISTINCT FROM 'CONTENT_ADDRESSED'
    OR NEW.decision_ref->>'objectType' IS DISTINCT FROM 'identity.authorization_decision' OR NEW.decision_ref->'scope' IS DISTINCT FROM '{}'::jsonb THEN
  RAISE EXCEPTION 'company startup provenance mismatch' USING ERRCODE='23514'; END IF;
 SELECT decision_id,payload_hash INTO ctx_decision_id,ctx_decision_hash FROM platform_security.context_authorization_decision_ref();
 IF NEW.actor_ref->>'objectId' IS DISTINCT FROM platform_security.context_actor_snapshot_id()::text
    OR NEW.actor_ref->>'snapshotId' IS DISTINCT FROM NEW.actor_ref->>'objectId'
    OR NEW.decision_ref->>'objectId' IS DISTINCT FROM ctx_decision_id::text
    OR NEW.decision_ref->'contentHash'->>'digest' IS DISTINCT FROM encode(ctx_decision_hash,'hex') THEN
  RAISE EXCEPTION 'company startup context mismatch' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='company_startup_requirement' THEN
  IF p->>'requirementCode' IS DISTINCT FROM NEW.code OR p->>'definitionVersion' IS DISTINCT FROM NEW.version THEN
   RAISE EXCEPTION 'company requirement mirror mismatch' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='company_startup_requirement_publication' THEN
  IF p->'requirementRef'->>'objectId' IS DISTINCT FROM NEW.requirement_id::text THEN
   RAISE EXCEPTION 'company requirement publication mirror mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION enterprise_project.guard_company_startup_fact() FROM PUBLIC;
ALTER TABLE enterprise_project.company_startup_requirement ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.company_startup_requirement FORCE ROW LEVEL SECURITY;
REVOKE ALL ON enterprise_project.company_startup_requirement FROM PUBLIC,enterprise_project_app,enterprise_project_platform_reference_writer,enterprise_project_dispatcher,audit_reader;
GRANT SELECT,INSERT ON enterprise_project.company_startup_requirement TO enterprise_project_company_rule_writer;
CREATE POLICY company_startup_access ON enterprise_project.company_startup_requirement TO enterprise_project_company_rule_writer
 USING(platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid)
 WITH CHECK(platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid);
CREATE TRIGGER company_startup_immutable BEFORE INSERT OR UPDATE OR DELETE ON enterprise_project.company_startup_requirement FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_company_startup_fact();
ALTER TABLE enterprise_project.company_startup_requirement_publication ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.company_startup_requirement_publication FORCE ROW LEVEL SECURITY;
REVOKE ALL ON enterprise_project.company_startup_requirement_publication FROM PUBLIC,enterprise_project_app,enterprise_project_platform_reference_writer,enterprise_project_dispatcher,audit_reader;
GRANT SELECT,INSERT ON enterprise_project.company_startup_requirement_publication TO enterprise_project_company_rule_writer;
CREATE POLICY company_startup_access ON enterprise_project.company_startup_requirement_publication TO enterprise_project_company_rule_writer
 USING(platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid)
 WITH CHECK(platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid);
CREATE TRIGGER company_startup_immutable BEFORE INSERT OR UPDATE OR DELETE ON enterprise_project.company_startup_requirement_publication FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_company_startup_fact();
ALTER TABLE enterprise_project.company_startup_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.company_startup_receipt FORCE ROW LEVEL SECURITY;
REVOKE ALL ON enterprise_project.company_startup_receipt FROM PUBLIC,enterprise_project_app,enterprise_project_platform_reference_writer,enterprise_project_dispatcher,audit_reader;
GRANT SELECT,INSERT ON enterprise_project.company_startup_receipt TO enterprise_project_company_rule_writer;
CREATE POLICY company_startup_access ON enterprise_project.company_startup_receipt TO enterprise_project_company_rule_writer
 USING(platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid)
 WITH CHECK(platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid);
CREATE TRIGGER company_startup_immutable BEFORE INSERT OR UPDATE OR DELETE ON enterprise_project.company_startup_receipt FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_company_startup_fact();
RESET ROLE;
