SET ROLE integration_gateway_owner;
CREATE TABLE integration_gateway.customer_zip_intake (
 intake_id uuid PRIMARY KEY,
 enterprise_id uuid NOT NULL,
 project_id uuid NOT NULL,
 preparation_request_id uuid NOT NULL UNIQUE,
 creator_id uuid NOT NULL,
 original_command jsonb NOT NULL,
 payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 original_key text NOT NULL UNIQUE,
 aggregate_version bigint NOT NULL CHECK(aggregate_version>=1),
 generation integer NOT NULL CHECK(generation IN (1,2)),
 state jsonb NOT NULL,
 created_at timestamptz NOT NULL,
 CHECK(original_command->'targetRef'->>'objectId'=intake_id::text),
 CHECK(original_command->'scopeRef'->>'enterpriseId'=enterprise_id::text),
 CHECK(original_command->'scopeRef'->>'projectId'=project_id::text),
 CHECK(original_command->'payload'->'preparationRequestRef'->>'objectId'=preparation_request_id::text),
 CHECK(original_command->'integrity'->'payloadHash'->>'digest'=encode(payload_hash,'hex')),
 CHECK((state->>'generation')::integer=generation),
 CHECK((state->>'restartsUsed')::integer=generation-1),
 CHECK(state->>'uploadState' IN ('ISSUED','RECEIVING','CLOSED_NO_OBJECT','STAGED','UNKNOWN')),
 CHECK((state->>'aggregateVersion')::bigint=aggregate_version)
);
CREATE TABLE integration_gateway.customer_zip_manifest (
 intake_id uuid PRIMARY KEY REFERENCES integration_gateway.customer_zip_intake(intake_id),
 enterprise_id uuid NOT NULL, project_id uuid NOT NULL,
 manifest_id uuid NOT NULL UNIQUE, payload jsonb NOT NULL,
 payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 receipt_id uuid NOT NULL REFERENCES integration_gateway.command_receipt(command_id),
 event_id uuid NOT NULL REFERENCES integration_gateway.outbox_event(event_id),
 CHECK(payload->'intakeRef'->>'objectId'=intake_id::text),
 CHECK(payload->'projectRef'->'scope'->>'enterpriseId'=enterprise_id::text),
 CHECK(payload->'projectRef'->'scope'->>'projectId'=project_id::text)
);
CREATE FUNCTION integration_gateway.guard_customer_zip_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE step_key text; step_value jsonb;
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME='customer_zip_manifest' THEN RAISE EXCEPTION 'immutable intake facts' USING ERRCODE='55000'; END IF;
 IF NEW.intake_id<>OLD.intake_id OR NEW.enterprise_id<>OLD.enterprise_id OR NEW.project_id<>OLD.project_id OR NEW.preparation_request_id<>OLD.preparation_request_id OR NEW.creator_id<>OLD.creator_id OR NEW.original_command<>OLD.original_command OR NEW.payload_hash<>OLD.payload_hash OR NEW.original_key<>OLD.original_key OR NEW.created_at<>OLD.created_at OR NEW.aggregate_version<>OLD.aggregate_version+1 OR NEW.generation<OLD.generation OR NEW.generation>OLD.generation+1 OR (OLD.state->>'manifestRef' IS NOT NULL AND NEW.state->'manifestRef' IS DISTINCT FROM OLD.state->'manifestRef') THEN RAISE EXCEPTION 'immutable original intake binding or invalid version' USING ERRCODE='55000'; END IF;
 IF NEW.generation=OLD.generation AND NEW.state->'ticket' IS DISTINCT FROM OLD.state->'ticket' THEN RAISE EXCEPTION 'ticket cannot renew within generation' USING ERRCODE='55000'; END IF;
 IF OLD.state->'object' IS NOT NULL AND NEW.state->'object' IS DISTINCT FROM OLD.state->'object' THEN RAISE EXCEPTION 'durable object is immutable' USING ERRCODE='55000'; END IF;
 IF OLD.state->'restartCommand' IS NOT NULL AND NEW.state->'restartCommand' IS DISTINCT FROM OLD.state->'restartCommand' THEN RAISE EXCEPTION 'restart command is immutable' USING ERRCODE='55000'; END IF;
 IF OLD.state->>'terminalContentFailure'='true' AND NEW.state->>'terminalContentFailure' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'content failure is terminal' USING ERRCODE='55000'; END IF;
 IF NEW.generation>OLD.generation AND (OLD.state->>'terminalContentFailure'='true' OR OLD.state->>'streamClosed'<>'true' OR OLD.state->'object' IS NOT NULL OR OLD.state->'manifestRef' IS NOT NULL OR OLD.state->>'uploadState' NOT IN ('ISSUED','CLOSED_NO_OBJECT') OR NEW.state->>'uploadState'<>'ISSUED' OR NEW.state->'restartCommand' IS NULL) THEN RAISE EXCEPTION 'unsafe generation transition' USING ERRCODE='55000'; END IF;
 FOR step_key,step_value IN SELECT key,value FROM jsonb_each(OLD.state->'steps') LOOP
  IF NEW.state->'steps'->step_key IS NULL OR (NEW.state->'steps'->step_key)-'result'-'object'-'input' IS DISTINCT FROM step_value-'result'-'object'-'input' OR (step_value->'input' IS NOT NULL AND NEW.state->'steps'->step_key->'input' IS DISTINCT FROM step_value->'input') OR (step_value->'result' IS NOT NULL AND NEW.state->'steps'->step_key->'result' IS DISTINCT FROM step_value->'result') OR (step_value->'object' IS NOT NULL AND NEW.state->'steps'->step_key->'object' IS DISTINCT FROM step_value->'object') THEN RAISE EXCEPTION 'source steps are immutable' USING ERRCODE='55000'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION integration_gateway.guard_customer_zip_immutable() FROM PUBLIC;
CREATE TRIGGER customer_zip_original_guard BEFORE UPDATE OR DELETE ON integration_gateway.customer_zip_intake FOR EACH ROW EXECUTE FUNCTION integration_gateway.guard_customer_zip_immutable();
CREATE TRIGGER customer_zip_manifest_guard BEFORE UPDATE OR DELETE ON integration_gateway.customer_zip_manifest FOR EACH ROW EXECUTE FUNCTION integration_gateway.guard_customer_zip_immutable();
ALTER TABLE integration_gateway.customer_zip_intake ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_gateway.customer_zip_intake FORCE ROW LEVEL SECURITY;
ALTER TABLE integration_gateway.customer_zip_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_gateway.customer_zip_manifest FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_zip_intake_scope ON integration_gateway.customer_zip_intake TO integration_gateway_app USING(platform_security.context_allows_project(enterprise_id,project_id)) WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id));
CREATE POLICY customer_zip_manifest_scope ON integration_gateway.customer_zip_manifest TO integration_gateway_app USING(platform_security.context_allows_project(enterprise_id,project_id)) WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id));
CREATE POLICY customer_zip_intake_owner ON integration_gateway.customer_zip_intake TO integration_gateway_owner USING(true) WITH CHECK(true);
CREATE POLICY customer_zip_manifest_owner ON integration_gateway.customer_zip_manifest TO integration_gateway_owner USING(true) WITH CHECK(true);
REVOKE ALL ON integration_gateway.customer_zip_intake,integration_gateway.customer_zip_manifest FROM PUBLIC,integration_gateway_app;
GRANT SELECT,INSERT,UPDATE ON integration_gateway.customer_zip_intake TO integration_gateway_app;
GRANT SELECT,INSERT ON integration_gateway.customer_zip_manifest TO integration_gateway_app;
RESET ROLE;
-- This selector reveals only scope to the verified original creator. The owning
-- service verifies the trusted Session before calling and reauthorizes current
-- Project grants before any protected row read, token check or stream claim.
SET ROLE integration_gateway_owner;
CREATE FUNCTION integration_gateway.lookup_customer_zip_scope(p_intake_id uuid,p_creator_id uuid)
RETURNS TABLE(enterprise_id uuid,project_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path=pg_catalog AS $$
 SELECT i.enterprise_id,i.project_id FROM integration_gateway.customer_zip_intake i
 WHERE i.intake_id=p_intake_id AND i.creator_id=p_creator_id
$$;
REVOKE ALL ON FUNCTION integration_gateway.lookup_customer_zip_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION integration_gateway.lookup_customer_zip_scope(uuid,uuid) TO integration_gateway_app;
RESET ROLE;
