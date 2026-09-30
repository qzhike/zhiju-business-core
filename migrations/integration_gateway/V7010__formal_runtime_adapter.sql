-- Issue #235: immutable adapter identities for the exact formal synthetic runtime.
SET ROLE integration_gateway_owner;
ALTER TABLE integration_gateway.runtime_adapter_identity DROP CONSTRAINT runtime_adapter_identity_adapter_code_check;
ALTER TABLE integration_gateway.runtime_adapter_identity ADD CONSTRAINT runtime_adapter_identity_adapter_code_check CHECK(adapter_code IN('te.human_operated.synthetic','te.human_operated.synthetic.formal'));
CREATE FUNCTION integration_gateway.guard_formal_adapter_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE binding jsonb;
BEGIN
 SELECT invocation_binding->'runtimeBinding' INTO binding FROM integration_gateway.runtime_attempt WHERE attempt_id=NEW.attempt_id;
 IF (NEW.adapter_code IS DISTINCT FROM binding->>'adapterCode' OR NEW.adapter_version IS DISTINCT FROM binding->>'adapterVersion'
  OR NEW.canonical_payload->>'adapterCode' IS DISTINCT FROM NEW.adapter_code OR NEW.canonical_payload->>'adapterVersion' IS DISTINCT FROM NEW.adapter_version) THEN
  RAISE EXCEPTION 'Adapter identity runtime binding mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER formal_adapter_identity_guard BEFORE INSERT ON integration_gateway.runtime_adapter_identity FOR EACH ROW EXECUTE FUNCTION integration_gateway.guard_formal_adapter_identity();
REVOKE ALL ON FUNCTION integration_gateway.guard_formal_adapter_identity() FROM PUBLIC;
RESET ROLE;
