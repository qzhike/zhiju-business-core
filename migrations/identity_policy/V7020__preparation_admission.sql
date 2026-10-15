-- #291: preparation authority is separate from historical company authority.
CREATE ROLE identity_policy_preparation_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE identity_preparation_self_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA identity_policy,platform_security TO identity_policy_preparation_writer,identity_preparation_self_reader;
GRANT EXECUTE ON FUNCTION platform_security.context_is_valid(),platform_security.context_enterprise_id(),platform_security.context_principal_id(),platform_security.context_allows_project(uuid,uuid) TO identity_policy_preparation_writer,identity_preparation_self_reader,identity_policy_owner;
SET ROLE identity_policy_owner;
CREATE TABLE identity_policy.preparation_fact (
 id uuid PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('ACTOR','DECISION','GRANT','ENROLLMENT','REVOCATION','TEMPLATE','WITHDRAWAL','ADMISSION','BOOTSTRAP','MEMBER_POLICY','PROVISIONING','RECEIPT')),
 principal_id uuid NOT NULL REFERENCES identity_policy.principal(id),
 parent_id uuid REFERENCES identity_policy.preparation_fact(id),
 enterprise_id uuid, project_id uuid,
 payload jsonb NOT NULL,payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 CHECK(project_id IS NULL OR enterprise_id IS NOT NULL),
 CHECK(kind NOT IN ('MEMBER_POLICY','PROVISIONING') OR (enterprise_id IS NOT NULL AND project_id IS NOT NULL))
);
CREATE UNIQUE INDEX preparation_revocation_unique ON identity_policy.preparation_fact(parent_id) WHERE kind IN ('REVOCATION','WITHDRAWAL');
CREATE UNIQUE INDEX preparation_template_identity ON identity_policy.preparation_fact((payload->>'templateId'),(payload->>'versionId')) WHERE kind='TEMPLATE';
CREATE UNIQUE INDEX preparation_template_code_version ON identity_policy.preparation_fact((payload->'payload'->>'templateCode'),(payload->'payload'->>'templateVersion')) WHERE kind='TEMPLATE';
CREATE UNIQUE INDEX preparation_admission_key ON identity_policy.preparation_fact(principal_id,(payload->>'originalKey')) WHERE kind='ADMISSION';
CREATE UNIQUE INDEX preparation_admission_request ON identity_policy.preparation_fact((payload->'requestRef'->>'objectId')) WHERE kind='ADMISSION';
CREATE UNIQUE INDEX preparation_admission_project ON identity_policy.preparation_fact((payload->'projectRef'->>'objectId')) WHERE kind='ADMISSION';
CREATE UNIQUE INDEX preparation_admission_new_enterprise ON identity_policy.preparation_fact((payload->'enterpriseRef'->>'objectId')) WHERE kind='ADMISSION' AND payload->>'customerMode'='NEW';
CREATE UNIQUE INDEX preparation_member_policy_admission ON identity_policy.preparation_fact(parent_id) WHERE kind='MEMBER_POLICY';
CREATE UNIQUE INDEX preparation_provisioning_slot ON identity_policy.preparation_fact(parent_id,(payload->>'operation')) WHERE kind='PROVISIONING';
CREATE FUNCTION identity_policy.guard_preparation_fact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE parent jsonb; template jsonb; decision jsonb; actor jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'immutable preparation fact' USING ERRCODE='23514'; END IF;
 IF NEW.payload_hash IS DISTINCT FROM sha256(convert_to(identity_policy.canonical_jsonb_text(NEW.payload),'UTF8')) THEN RAISE EXCEPTION 'preparation canonical hash mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.payload->>'kind' IS DISTINCT FROM NEW.kind OR NEW.payload->>'principalId' IS DISTINCT FROM NEW.principal_id::text THEN RAISE EXCEPTION 'preparation mirror mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.enterprise_id IS NOT NULL AND (NEW.payload->'scope'->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text OR NEW.payload->'scope'->>'projectId' IS DISTINCT FROM NEW.project_id::text) THEN RAISE EXCEPTION 'preparation scope mirror mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.kind='ENROLLMENT' AND (NEW.payload->>'grantId' IS DISTINCT FROM NEW.id::text OR NEW.payload->'principalRef'->>'objectId' IS DISTINCT FROM NEW.principal_id::text) THEN RAISE EXCEPTION 'preparation enrollment mirror mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.kind='TEMPLATE' AND NEW.payload->>'versionId' IS DISTINCT FROM NEW.id::text THEN RAISE EXCEPTION 'preparation template mirror mismatch' USING ERRCODE='23514'; END IF;
 IF NEW.kind='DECISION' THEN
  SELECT payload INTO actor FROM identity_policy.preparation_fact WHERE id=(NEW.payload->'actorSnapshotRef'->>'objectId')::uuid AND kind='ACTOR';
  IF actor IS NULL OR actor->>'principalId' IS DISTINCT FROM NEW.principal_id::text OR NEW.payload->'actorSnapshotRef'->'contentHash'->>'digest' IS DISTINCT FROM encode(sha256(convert_to(identity_policy.canonical_jsonb_text(actor),'UTF8')),'hex') THEN RAISE EXCEPTION 'preparation decision actor mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.kind='ADMISSION' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.parent_id::text,0));
  SELECT payload INTO parent FROM identity_policy.preparation_fact WHERE id=NEW.parent_id AND kind='ENROLLMENT';
  IF parent IS NULL OR parent->'principalRef'->>'objectId' IS DISTINCT FROM NEW.principal_id::text
    OR (parent->'effectivePeriod'->>'from')::timestamptz>clock_timestamp() OR (parent->'effectivePeriod'->>'to')::timestamptz<=clock_timestamp()
    OR EXISTS(SELECT 1 FROM identity_policy.preparation_fact WHERE kind='REVOCATION' AND parent_id=NEW.parent_id)
    OR (SELECT count(*) FROM identity_policy.preparation_fact WHERE kind='ADMISSION' AND parent_id=NEW.parent_id)>=(parent->>'maxUses')::integer
    OR NEW.payload->'admission'->'requestRef' IS DISTINCT FROM NEW.payload->'requestRef'
    OR NEW.payload->'admission'->'projectRef' IS DISTINCT FROM NEW.payload->'projectRef'
    OR NEW.payload->'admission'->'enterpriseRef' IS DISTINCT FROM NEW.payload->'enterpriseRef'
    OR NEW.payload->'admission'->'payloadHash' IS DISTINCT FROM NEW.payload->'payloadHash'
    OR NEW.payload->'admission'->'preparationPresetRef' IS DISTINCT FROM parent->'preparationPresetRef'
    OR NEW.payload->'admission'->'preparationPresetHash' IS DISTINCT FROM parent->'preparationPresetHash'
  THEN RAISE EXCEPTION 'preparation admission enrollment mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.kind='MEMBER_POLICY' THEN
  SELECT payload->'admission' INTO parent FROM identity_policy.preparation_fact WHERE id=NEW.parent_id AND kind='ADMISSION';
  SELECT payload INTO template FROM identity_policy.preparation_fact WHERE kind='TEMPLATE' AND id=(NEW.payload->'payload'->'templateRef'->>'versionId')::uuid;
  IF parent IS NULL OR template IS NULL OR NEW.enterprise_id::text IS DISTINCT FROM parent->'enterpriseRef'->>'objectId' OR NEW.project_id::text IS DISTINCT FROM parent->'projectRef'->>'objectId'
   OR NEW.payload->'payload'->'creatorRef' IS DISTINCT FROM parent->'creatorRef'
   OR NEW.payload->'payload'->'templateRef' IS DISTINCT FROM parent->'membershipTemplateRef'
   OR NEW.payload->'payload'->'templateHash' IS DISTINCT FROM parent->'membershipTemplateHash'
   OR NEW.payload->'payload'->'creatorBindings' IS DISTINCT FROM template->'payload'->'creatorBindings'
   OR NEW.payload->'payload'->'grantPolicySnapshotRef' IS DISTINCT FROM template->'payload'->'grantPolicySnapshotRef'
   OR (NEW.payload->'payload'->>'validUntil')::timestamptz>(parent->>'validUntil')::timestamptz
   OR (NEW.payload->'payload'->>'validUntil')::timestamptz>clock_timestamp()+make_interval(secs=>(template->'payload'->>'maxGrantLifetimeSeconds')::integer)
  THEN RAISE EXCEPTION 'preparation member policy binding mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.kind NOT IN ('ACTOR','DECISION','ADMISSION','BOOTSTRAP') AND NEW.payload ? 'authorizationDecisionRef' THEN
  SELECT payload INTO decision FROM identity_policy.preparation_fact WHERE kind='DECISION' AND id=(NEW.payload->'authorizationDecisionRef'->>'objectId')::uuid;
  IF decision IS NULL OR decision->>'outcome'<>'ALLOW' OR NEW.payload->'authorizationDecisionRef'->'contentHash'->>'digest' IS DISTINCT FROM encode(sha256(convert_to(identity_policy.canonical_jsonb_text(decision),'UTF8')),'hex') OR NEW.payload->'actorSnapshotRef' IS DISTINCT FROM decision->'actorSnapshotRef' THEN RAISE EXCEPTION 'preparation source provenance mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION identity_policy.guard_preparation_fact() FROM PUBLIC;
CREATE TRIGGER preparation_fact_immutable BEFORE INSERT OR UPDATE OR DELETE ON identity_policy.preparation_fact FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_preparation_fact();
ALTER TABLE identity_policy.preparation_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.preparation_fact FORCE ROW LEVEL SECURITY;
REVOKE ALL ON identity_policy.preparation_fact FROM PUBLIC,identity_policy_app,identity_policy_dispatcher,audit_reader;
GRANT SELECT,INSERT ON identity_policy.preparation_fact TO identity_policy_preparation_writer;
CREATE POLICY preparation_writer ON identity_policy.preparation_fact TO identity_policy_preparation_writer USING(platform_security.context_is_valid() AND ((enterprise_id IS NULL AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid) OR (enterprise_id=platform_security.context_enterprise_id() AND platform_security.context_allows_project(enterprise_id,project_id)))) WITH CHECK(platform_security.context_is_valid() AND ((enterprise_id IS NULL AND platform_security.context_enterprise_id()='00000000-0000-7000-8000-000000000000'::uuid) OR (enterprise_id=platform_security.context_enterprise_id() AND platform_security.context_allows_project(enterprise_id,project_id))));
CREATE POLICY preparation_owner_read ON identity_policy.preparation_fact FOR SELECT TO identity_policy_owner USING(true);
GRANT SELECT ON identity_policy.principal,identity_policy.policy_snapshot,identity_policy.capability_grant TO identity_policy_preparation_writer;
CREATE POLICY preparation_principal_read ON identity_policy.principal FOR SELECT TO identity_policy_preparation_writer USING(platform_security.context_is_valid());
CREATE POLICY preparation_policy_read ON identity_policy.policy_snapshot FOR SELECT TO identity_policy_preparation_writer USING(platform_security.context_is_valid());
CREATE POLICY preparation_grant_read ON identity_policy.capability_grant FOR SELECT TO identity_policy_preparation_writer USING(platform_security.context_is_valid() AND (principal_id=platform_security.context_principal_id() OR (scope_kind='ENTERPRISE' AND EXISTS(SELECT 1 FROM identity_policy.preparation_fact a WHERE a.kind='ADMISSION' AND a.principal_id=capability_grant.principal_id AND a.payload->'enterpriseRef'->>'objectId'=capability_grant.enterprise_id::text)) OR (enterprise_id=platform_security.context_enterprise_id() AND platform_security.context_allows_project(enterprise_id,project_id))));
GRANT INSERT ON identity_policy.capability_grant TO identity_policy_preparation_writer;
CREATE POLICY preparation_grant_insert ON identity_policy.capability_grant FOR INSERT TO identity_policy_preparation_writer WITH CHECK(platform_security.context_is_valid() AND scope_kind='PROJECT' AND enterprise_id=platform_security.context_enterprise_id() AND platform_security.context_allows_project(enterprise_id,project_id) AND EXISTS(SELECT 1 FROM identity_policy.preparation_fact p WHERE p.kind='MEMBER_POLICY' AND p.enterprise_id=capability_grant.enterprise_id AND p.project_id=capability_grant.project_id AND p.payload->'payload'->'creatorRef'->>'objectId'=capability_grant.principal_id::text));
GRANT SELECT ON identity_policy.capability_grant,identity_policy.preparation_fact TO identity_preparation_self_reader;
CREATE POLICY preparation_self_grant ON identity_policy.capability_grant FOR SELECT TO identity_preparation_self_reader USING(platform_security.context_is_valid() AND principal_id=platform_security.context_principal_id() AND scope_kind='ENTERPRISE');
CREATE POLICY preparation_self_enrollment ON identity_policy.preparation_fact FOR SELECT TO identity_preparation_self_reader USING(platform_security.context_is_valid() AND principal_id=platform_security.context_principal_id() AND kind IN ('ENROLLMENT','REVOCATION'));
GRANT SELECT(id,principal_id,status) ON identity_policy.external_identity_link TO identity_policy_preparation_writer;
CREATE POLICY preparation_current_human_link ON identity_policy.external_identity_link FOR SELECT TO identity_policy_preparation_writer USING(platform_security.context_is_valid() AND EXISTS(SELECT 1 FROM identity_policy.preparation_fact a WHERE a.kind='ADMISSION' AND a.principal_id=external_identity_link.principal_id));
RESET ROLE;

-- The dedicated writer cannot manufacture an unplanned creator capability.
SET ROLE identity_policy_owner;
CREATE FUNCTION identity_policy.guard_preparation_creator_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy jsonb; binding jsonb; matched boolean:=false;
BEGIN
 IF current_setting('role') <> 'identity_policy_preparation_writer' THEN RETURN NEW; END IF;
 SELECT p.payload->'payload' INTO policy FROM identity_policy.preparation_fact p
 WHERE p.kind='MEMBER_POLICY' AND p.enterprise_id=NEW.enterprise_id AND p.project_id=NEW.project_id
 AND p.payload->'payload'->'creatorRef'->>'objectId'=NEW.principal_id::text;
 IF policy IS NULL OR (policy->>'validUntil')::timestamptz<=clock_timestamp() OR NEW.scope_kind<>'PROJECT'
 OR NEW.valid_to IS NULL OR NEW.valid_to>(policy->>'validUntil')::timestamptz OR NEW.max_uses IS NOT NULL OR NEW.constraints<>'{}'::jsonb
 OR NEW.grant_policy_snapshot_id::text IS DISTINCT FROM policy->'grantPolicySnapshotRef'->>'snapshotId'
 OR encode(NEW.grant_policy_snapshot_hash,'hex') IS DISTINCT FROM policy->'grantPolicySnapshotRef'->'contentHash'->>'digest'
 THEN RAISE EXCEPTION 'preparation membership grant mismatch' USING ERRCODE='23514'; END IF;
 FOR binding IN SELECT value FROM jsonb_array_elements(policy->'creatorBindings') LOOP
  IF binding->>'capabilityCode'=NEW.capability_code AND NEW.actions=ARRAY[binding->>'action']
   AND NEW.resource_selectors=(CASE WHEN binding->>'operation'='integration.get_customer_zip_intake'
    THEN jsonb_build_array(jsonb_build_object('selectorType','TARGET_TYPE','objectType',binding->>'targetObjectType'),jsonb_build_object('selectorType','TARGET_TYPE','objectType','zhiju.project.preparation_request'))
    ELSE jsonb_build_array(jsonb_build_object('selectorType',CASE WHEN binding->>'operation'='integration.request_customer_zip_intake' THEN 'CREATE_TARGET_TYPE' ELSE 'TARGET_TYPE' END,'objectType',binding->>'targetObjectType')) END)
  THEN matched:=true; END IF;
 END LOOP;
 IF NOT matched THEN RAISE EXCEPTION 'preparation creator slot mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION identity_policy.guard_preparation_creator_grant() FROM PUBLIC;
CREATE TRIGGER preparation_creator_grant_guard BEFORE INSERT ON identity_policy.capability_grant FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_preparation_creator_grant();
RESET ROLE;
