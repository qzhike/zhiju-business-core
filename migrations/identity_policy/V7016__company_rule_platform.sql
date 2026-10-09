-- #267: independent immutable company facts and Platform authority.
DO $roles$ BEGIN
 CREATE ROLE identity_policy_company_rule_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
END $roles$;
GRANT USAGE ON SCHEMA identity_policy, platform_security TO identity_policy_company_rule_writer;
GRANT EXECUTE ON FUNCTION platform_security.context_is_valid(), platform_security.context_enterprise_id(), platform_security.context_principal_id(), platform_security.context_actor_snapshot_id(), platform_security.context_authorization_decision_ref() TO identity_policy_company_rule_writer, identity_policy_owner;
SET ROLE identity_policy_owner;

CREATE TABLE identity_policy.company_rule_authority (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('ACTOR','GRANT','REVOCATION','DECISION')),
 principal_id uuid NOT NULL REFERENCES identity_policy.principal(id) ON DELETE RESTRICT,
 parent_id uuid REFERENCES identity_policy.company_rule_authority(id) ON DELETE RESTRICT,
 payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK (octet_length(payload_hash)=32)
);
CREATE UNIQUE INDEX company_rule_grant_revocation_unique ON identity_policy.company_rule_authority(parent_id) WHERE kind='REVOCATION';
CREATE TABLE identity_policy.company_rule_snapshot (
 id uuid PRIMARY KEY, registry_version text NOT NULL CHECK (registry_version='im-ui-company-startup-v1'),
 profile_key text NOT NULL CHECK (profile_key IN ('ep.company_startup_bundle@1.0','ep.company_startup_rules@1.0','ep.company_startup_vocabulary@1.0')),
 document_code text NOT NULL, document_version text NOT NULL,
 payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK (octet_length(payload_hash)=32),
 actor_id uuid NOT NULL REFERENCES identity_policy.company_rule_authority(id) ON DELETE RESTRICT,
 decision_id uuid NOT NULL REFERENCES identity_policy.company_rule_authority(id) ON DELETE RESTRICT,
 source_command_id uuid NOT NULL,
 UNIQUE (registry_version,profile_key,document_code,document_version)
);
CREATE TABLE identity_policy.company_rule_publication (
 id uuid PRIMARY KEY, bundle_code text NOT NULL, bundle_version text NOT NULL,
 bundle_id uuid NOT NULL REFERENCES identity_policy.company_rule_snapshot(id) ON DELETE RESTRICT,
 predecessor_id uuid UNIQUE REFERENCES identity_policy.company_rule_publication(id) ON DELETE RESTRICT,
 effective_from timestamptz NOT NULL,
 payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK (octet_length(payload_hash)=32),
 actor_id uuid NOT NULL REFERENCES identity_policy.company_rule_authority(id) ON DELETE RESTRICT,
 decision_id uuid NOT NULL REFERENCES identity_policy.company_rule_authority(id) ON DELETE RESTRICT,
 source_command_id uuid NOT NULL, UNIQUE(bundle_code,bundle_version), UNIQUE(bundle_id), CHECK (id IS DISTINCT FROM predecessor_id)
);
CREATE TABLE identity_policy.company_rule_withdrawal (
 id uuid PRIMARY KEY, publication_id uuid NOT NULL UNIQUE REFERENCES identity_policy.company_rule_publication(id) ON DELETE RESTRICT,
 effective_from timestamptz NOT NULL,
 payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK (octet_length(payload_hash)=32),
 actor_id uuid NOT NULL REFERENCES identity_policy.company_rule_authority(id) ON DELETE RESTRICT,
 decision_id uuid NOT NULL REFERENCES identity_policy.company_rule_authority(id) ON DELETE RESTRICT,
 source_command_id uuid NOT NULL
);
CREATE TABLE identity_policy.company_rule_receipt (
 id uuid PRIMARY KEY, operation text NOT NULL, idempotency_key text NOT NULL,
 request_hash bytea NOT NULL CHECK (octet_length(request_hash)=32),
 result jsonb NOT NULL, result_hash bytea NOT NULL CHECK (octet_length(result_hash)=32),
 actor_id uuid NOT NULL REFERENCES identity_policy.company_rule_authority(id) ON DELETE RESTRICT,
 decision_id uuid NOT NULL REFERENCES identity_policy.company_rule_authority(id) ON DELETE RESTRICT,
 UNIQUE(operation,idempotency_key)
);
CREATE TABLE identity_policy.company_rule_audit (
 id uuid PRIMARY KEY, operation text NOT NULL, principal_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES identity_policy.company_rule_authority(id) ON DELETE RESTRICT,
 decision_id uuid NOT NULL REFERENCES identity_policy.company_rule_authority(id) ON DELETE RESTRICT,
 request_hash bytea NOT NULL CHECK (octet_length(request_hash)=32),
 target_id uuid NOT NULL, recorded_at timestamptz NOT NULL
);
ALTER TABLE identity_policy.company_rule_snapshot ADD FOREIGN KEY(source_command_id)
 REFERENCES identity_policy.company_rule_receipt(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE identity_policy.company_rule_publication ADD FOREIGN KEY(source_command_id)
 REFERENCES identity_policy.company_rule_receipt(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE identity_policy.company_rule_withdrawal ADD FOREIGN KEY(source_command_id)
 REFERENCES identity_policy.company_rule_receipt(id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION identity_policy.guard_company_rule_fact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guard$
DECLARE p jsonb; h bytea; decision jsonb; decision_hash bytea; ctx_decision_id uuid; ctx_decision_hash bytea; request jsonb; operation text; target_id uuid;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'company rule fact is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='company_rule_receipt' THEN p:=NEW.result; h:=NEW.result_hash;
 ELSIF TG_TABLE_NAME='company_rule_audit' THEN p:=NULL; h:=NULL;
 ELSE p:=NEW.payload; h:=NEW.payload_hash; END IF;
 IF TG_TABLE_NAME<>'company_rule_audit' AND h IS DISTINCT FROM sha256(convert_to(identity_policy.canonical_jsonb_text(p),'UTF8')) THEN
  RAISE EXCEPTION 'company rule canonical hash mismatch' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='company_rule_authority' THEN
  IF p->>'principalId' IS DISTINCT FROM NEW.principal_id::text OR p->>'kind' IS DISTINCT FROM NEW.kind THEN
   RAISE EXCEPTION 'company authority mirror mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT payload,payload_hash INTO decision,decision_hash FROM identity_policy.company_rule_authority WHERE id=NEW.decision_id AND kind='DECISION';
  SELECT decision_id,payload_hash INTO ctx_decision_id,ctx_decision_hash FROM platform_security.context_authorization_decision_ref();
  IF decision IS NULL OR decision->>'outcome'<>'ALLOW' OR decision->'actorSnapshotRef'->>'objectId' IS DISTINCT FROM NEW.actor_id::text THEN
   RAISE EXCEPTION 'company source decision mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.actor_id IS DISTINCT FROM platform_security.context_actor_snapshot_id() OR NEW.decision_id IS DISTINCT FROM ctx_decision_id
     OR decision_hash IS DISTINCT FROM ctx_decision_hash OR decision->>'principalId' IS DISTINCT FROM platform_security.context_principal_id()::text THEN
   RAISE EXCEPTION 'company source context mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='company_rule_snapshot' THEN
  operation:='identity.company_rule.snapshot.record'; target_id:=NEW.id;
  request:=jsonb_build_object('snapshotId',NEW.id,'payload',p);
  IF p->>'registryVersion' IS DISTINCT FROM NEW.registry_version OR p->>'profileKey' IS DISTINCT FROM NEW.profile_key
     OR p->'policyDocument'->>(CASE WHEN NEW.profile_key='ep.company_startup_bundle@1.0' THEN 'bundleCode' WHEN NEW.profile_key='ep.company_startup_rules@1.0' THEN 'rulesCode' ELSE 'vocabularyCode' END) IS DISTINCT FROM NEW.document_code
     OR p->'policyDocument'->>(CASE WHEN NEW.profile_key='ep.company_startup_bundle@1.0' THEN 'bundleVersion' WHEN NEW.profile_key='ep.company_startup_rules@1.0' THEN 'rulesVersion' ELSE 'vocabularyVersion' END) IS DISTINCT FROM NEW.document_version THEN
   RAISE EXCEPTION 'company snapshot mirror mismatch' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='company_rule_publication' THEN
  operation:='identity.company_rule.publish'; target_id:=NEW.id;
  request:=(p-'bundleCode'-'bundleVersion'-'semanticValidation'-'actorSnapshotRef'-'authorizationDecisionRef'-'recordedAt') || jsonb_build_object('publicationId',NEW.id);
  IF p->>'bundleCode' IS DISTINCT FROM NEW.bundle_code OR p->>'bundleVersion' IS DISTINCT FROM NEW.bundle_version
     OR p->'ruleBundleRef'->>'objectId' IS DISTINCT FROM NEW.bundle_id::text
     OR (p->'supersedesPublicationRef'->>'objectId') IS DISTINCT FROM NEW.predecessor_id::text
     OR (p->>'effectiveFrom')::timestamptz IS DISTINCT FROM NEW.effective_from THEN
   RAISE EXCEPTION 'company publication mirror mismatch' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='company_rule_withdrawal' THEN
  operation:='identity.company_rule.withdraw'; target_id:=NEW.publication_id;
  request:=(p-'recordedAt'-'actorSnapshotRef'-'authorizationDecisionRef') || jsonb_build_object('withdrawalId',NEW.id);
  IF p->'publicationRef'->>'objectId' IS DISTINCT FROM NEW.publication_id::text OR (p->>'effectiveFrom')::timestamptz IS DISTINCT FROM NEW.effective_from THEN
   RAISE EXCEPTION 'company withdrawal mirror mismatch' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='company_rule_receipt' OR TG_TABLE_NAME='company_rule_audit' THEN
  IF decision->>'operation' IS DISTINCT FROM NEW.operation OR decision->'requestHash'->>'digest' IS DISTINCT FROM encode(NEW.request_hash,'hex') THEN
   RAISE EXCEPTION 'company command provenance mismatch' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='company_rule_audit' THEN
   IF decision->>'principalId' IS DISTINCT FROM NEW.principal_id::text OR decision->'target'->>'objectId' IS DISTINCT FROM NEW.target_id::text THEN
    RAISE EXCEPTION 'company audit provenance mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 IF operation IS NOT NULL AND (decision->>'operation' IS DISTINCT FROM operation
    OR decision->'target'->>'objectId' IS DISTINCT FROM target_id::text OR decision->'target'->'scope' IS DISTINCT FROM '{}'::jsonb
    OR decision->'requestHash'->>'digest' IS DISTINCT FROM encode(sha256(convert_to(identity_policy.canonical_jsonb_text(request),'UTF8')),'hex')) THEN
  RAISE EXCEPTION 'company fact request mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION identity_policy.guard_company_rule_fact() FROM PUBLIC;
ALTER TABLE identity_policy.company_rule_authority ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.company_rule_authority FORCE ROW LEVEL SECURITY;
REVOKE ALL ON identity_policy.company_rule_authority FROM PUBLIC,identity_policy_app,identity_policy_dispatcher,audit_reader;
GRANT SELECT,INSERT ON identity_policy.company_rule_authority TO identity_policy_company_rule_writer;
CREATE POLICY company_rule_access ON identity_policy.company_rule_authority TO identity_policy_company_rule_writer
 USING (platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid)
 WITH CHECK (platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY company_rule_owner_read ON identity_policy.company_rule_authority FOR SELECT TO identity_policy_owner USING (true);
CREATE TRIGGER company_rule_immutable BEFORE INSERT OR UPDATE OR DELETE ON identity_policy.company_rule_authority FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_company_rule_fact();
ALTER TABLE identity_policy.company_rule_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.company_rule_snapshot FORCE ROW LEVEL SECURITY;
REVOKE ALL ON identity_policy.company_rule_snapshot FROM PUBLIC,identity_policy_app,identity_policy_dispatcher,audit_reader;
GRANT SELECT,INSERT ON identity_policy.company_rule_snapshot TO identity_policy_company_rule_writer;
CREATE POLICY company_rule_access ON identity_policy.company_rule_snapshot TO identity_policy_company_rule_writer
 USING (platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid)
 WITH CHECK (platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY company_rule_owner_read ON identity_policy.company_rule_snapshot FOR SELECT TO identity_policy_owner USING (true);
CREATE TRIGGER company_rule_immutable BEFORE INSERT OR UPDATE OR DELETE ON identity_policy.company_rule_snapshot FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_company_rule_fact();
ALTER TABLE identity_policy.company_rule_publication ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.company_rule_publication FORCE ROW LEVEL SECURITY;
REVOKE ALL ON identity_policy.company_rule_publication FROM PUBLIC,identity_policy_app,identity_policy_dispatcher,audit_reader;
GRANT SELECT,INSERT ON identity_policy.company_rule_publication TO identity_policy_company_rule_writer;
CREATE POLICY company_rule_access ON identity_policy.company_rule_publication TO identity_policy_company_rule_writer
 USING (platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid)
 WITH CHECK (platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY company_rule_owner_read ON identity_policy.company_rule_publication FOR SELECT TO identity_policy_owner USING (true);
CREATE TRIGGER company_rule_immutable BEFORE INSERT OR UPDATE OR DELETE ON identity_policy.company_rule_publication FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_company_rule_fact();
ALTER TABLE identity_policy.company_rule_withdrawal ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.company_rule_withdrawal FORCE ROW LEVEL SECURITY;
REVOKE ALL ON identity_policy.company_rule_withdrawal FROM PUBLIC,identity_policy_app,identity_policy_dispatcher,audit_reader;
GRANT SELECT,INSERT ON identity_policy.company_rule_withdrawal TO identity_policy_company_rule_writer;
CREATE POLICY company_rule_access ON identity_policy.company_rule_withdrawal TO identity_policy_company_rule_writer
 USING (platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid)
 WITH CHECK (platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY company_rule_owner_read ON identity_policy.company_rule_withdrawal FOR SELECT TO identity_policy_owner USING (true);
CREATE TRIGGER company_rule_immutable BEFORE INSERT OR UPDATE OR DELETE ON identity_policy.company_rule_withdrawal FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_company_rule_fact();
ALTER TABLE identity_policy.company_rule_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.company_rule_receipt FORCE ROW LEVEL SECURITY;
REVOKE ALL ON identity_policy.company_rule_receipt FROM PUBLIC,identity_policy_app,identity_policy_dispatcher,audit_reader;
GRANT SELECT,INSERT ON identity_policy.company_rule_receipt TO identity_policy_company_rule_writer;
CREATE POLICY company_rule_access ON identity_policy.company_rule_receipt TO identity_policy_company_rule_writer
 USING (platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid)
 WITH CHECK (platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY company_rule_owner_read ON identity_policy.company_rule_receipt FOR SELECT TO identity_policy_owner USING (true);
CREATE TRIGGER company_rule_immutable BEFORE INSERT OR UPDATE OR DELETE ON identity_policy.company_rule_receipt FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_company_rule_fact();
ALTER TABLE identity_policy.company_rule_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.company_rule_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON identity_policy.company_rule_audit FROM PUBLIC,identity_policy_app,identity_policy_dispatcher,audit_reader;
GRANT SELECT,INSERT ON identity_policy.company_rule_audit TO identity_policy_company_rule_writer;
CREATE POLICY company_rule_access ON identity_policy.company_rule_audit TO identity_policy_company_rule_writer
 USING (platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid)
 WITH CHECK (platform_security.context_is_valid() AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid);
CREATE POLICY company_rule_owner_read ON identity_policy.company_rule_audit FOR SELECT TO identity_policy_owner USING (true);
CREATE TRIGGER company_rule_immutable BEFORE INSERT OR UPDATE OR DELETE ON identity_policy.company_rule_audit FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_company_rule_fact();
GRANT SELECT ON identity_policy.principal,identity_policy.policy_snapshot TO identity_policy_company_rule_writer;
CREATE POLICY company_authority_principal_read ON identity_policy.principal FOR SELECT TO identity_policy_company_rule_writer USING (platform_security.context_is_valid());
CREATE POLICY company_authority_policy_read ON identity_policy.policy_snapshot FOR SELECT TO identity_policy_company_rule_writer USING (platform_security.context_is_valid());
RESET ROLE;
