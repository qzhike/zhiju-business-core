-- #279: original operation and immutable output observations for Markdown.
SET ROLE integration_gateway_owner;
ALTER TABLE integration_gateway.render_attempt
 ADD COLUMN original_operation text NOT NULL DEFAULT 'integration.request_render',
 ADD COLUMN source_command_id uuid REFERENCES integration_gateway.command_receipt(command_id),
 ADD CONSTRAINT render_operation_closed CHECK (original_operation IN ('integration.request_render', 'integration.request_markdown_render')),
 ADD CONSTRAINT markdown_original_command CHECK (original_operation <> 'integration.request_markdown_render' OR (source_command_id IS NOT NULL AND project_id IS NOT NULL));

CREATE TABLE integration_gateway.markdown_render_work (
 attempt_id uuid PRIMARY KEY REFERENCES integration_gateway.render_attempt(attempt_id),
 enterprise_id uuid NOT NULL,
 project_id uuid NOT NULL,
 started_at timestamptz NOT NULL,
 deadline_at timestamptz NOT NULL,
 CHECK (deadline_at > started_at)
);
CREATE TABLE integration_gateway.markdown_render_output (
 attempt_id uuid PRIMARY KEY REFERENCES integration_gateway.markdown_render_work(attempt_id),
 enterprise_id uuid NOT NULL,
 project_id uuid NOT NULL,
 storage_reference jsonb NOT NULL,
 receipt_storage_reference jsonb NOT NULL,
 validation jsonb NOT NULL,
 observed_at timestamptz NOT NULL,
 CHECK (jsonb_typeof(storage_reference) = 'object'),
 CHECK (jsonb_typeof(receipt_storage_reference) = 'object'),
 CHECK (validation->>'outcome' = 'PASS')
);
CREATE FUNCTION integration_gateway.guard_markdown_render_material() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $guard$
DECLARE a integration_gateway.render_attempt%ROWTYPE;
BEGIN
 IF TG_OP <> 'INSERT' THEN
   RAISE EXCEPTION 'Markdown observations are immutable' USING ERRCODE = '55000';
 END IF;
 SELECT * INTO a FROM integration_gateway.render_attempt WHERE attempt_id = NEW.attempt_id;
 IF NOT FOUND OR a.original_operation <> 'integration.request_markdown_render'
    OR a.enterprise_id <> NEW.enterprise_id OR a.project_id <> NEW.project_id
    OR a.status <> 'CREATED' THEN
   RAISE EXCEPTION 'Markdown observation binding mismatch' USING ERRCODE = '22023';
 END IF;
 IF TG_TABLE_NAME = 'markdown_render_output' THEN
 IF NOT EXISTS (
   SELECT 1 FROM integration_gateway.markdown_render_work w
    WHERE w.attempt_id = NEW.attempt_id AND NEW.observed_at >= w.started_at AND NEW.observed_at <= w.deadline_at
 ) THEN
   RAISE EXCEPTION 'late Markdown result' USING ERRCODE = '22023';
 END IF;
 END IF;
 RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION integration_gateway.guard_markdown_render_material() FROM PUBLIC;
CREATE TRIGGER markdown_work_guard BEFORE INSERT OR UPDATE OR DELETE ON integration_gateway.markdown_render_work
 FOR EACH ROW EXECUTE FUNCTION integration_gateway.guard_markdown_render_material();
CREATE TRIGGER markdown_output_guard BEFORE INSERT OR UPDATE OR DELETE ON integration_gateway.markdown_render_output
 FOR EACH ROW EXECUTE FUNCTION integration_gateway.guard_markdown_render_material();
ALTER TABLE integration_gateway.markdown_render_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_gateway.markdown_render_work FORCE ROW LEVEL SECURITY;
ALTER TABLE integration_gateway.markdown_render_output ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_gateway.markdown_render_output FORCE ROW LEVEL SECURITY;
CREATE POLICY markdown_work_scope ON integration_gateway.markdown_render_work TO integration_gateway_app
 USING (platform_security.context_allows_project(enterprise_id, project_id))
 WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY markdown_output_scope ON integration_gateway.markdown_render_output TO integration_gateway_app
 USING (platform_security.context_allows_project(enterprise_id, project_id))
 WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY markdown_work_owner ON integration_gateway.markdown_render_work TO integration_gateway_owner USING (true) WITH CHECK (true);
CREATE POLICY markdown_output_owner ON integration_gateway.markdown_render_output TO integration_gateway_owner USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON integration_gateway.markdown_render_work, integration_gateway.markdown_render_output TO integration_gateway_app;

CREATE FUNCTION integration_gateway.guard_markdown_attempt_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $guard$
BEGIN
 IF TG_OP = 'UPDATE' AND (NEW.original_operation IS DISTINCT FROM OLD.original_operation
   OR NEW.source_command_id IS DISTINCT FROM OLD.source_command_id
   OR NEW.request_payload IS DISTINCT FROM OLD.request_payload
   OR NEW.request_payload_hash IS DISTINCT FROM OLD.request_payload_hash
   OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id OR NEW.project_id IS DISTINCT FROM OLD.project_id) THEN
   RAISE EXCEPTION 'original render binding is immutable' USING ERRCODE = '55000';
 END IF;
 IF NEW.original_operation = 'integration.request_markdown_render' THEN
   IF NOT EXISTS (SELECT 1 FROM integration_gateway.command_receipt r
     WHERE r.command_id = NEW.source_command_id AND r.command_type = NEW.original_operation
       AND r.command_version = '1.0' AND r.target_type = 'integration.render_attempt'
       AND r.target_id = NEW.attempt_id AND r.enterprise_id = NEW.enterprise_id
       AND r.project_id = NEW.project_id AND r.outcome = 'COMMITTED'
       AND r.request_payload_hash = NEW.request_payload_hash) THEN
     RAISE EXCEPTION 'original Markdown command receipt mismatch' USING ERRCODE = '22023';
   END IF;
   IF NEW.status = 'SUCCEEDED' AND NOT EXISTS (
     SELECT 1 FROM integration_gateway.markdown_render_output o
      WHERE o.attempt_id = NEW.attempt_id AND o.enterprise_id = NEW.enterprise_id
        AND o.project_id = NEW.project_id
        AND o.storage_reference->>'objectLocator' = NEW.output_object_ref
        AND o.validation->'outputBytesSha256'->>'digest' = encode(NEW.output_checksum, 'hex')
        AND o.validation->'inputContentHash' = NEW.request_payload->'inputHash'
        AND o.validation->'roundTripContentHash' = NEW.request_payload->'inputHash'
        AND o.validation->'profileRef' = NEW.request_payload->'markdownProfileRef'
        AND o.validation->'structureSchemaRef' = NEW.request_payload->'structureSchemaRef'
        AND o.validation->'identityMapHash' = NEW.request_payload->'identityMapHash'
        AND o.validation->'rendererDigest' = NEW.request_payload->'rendererDigest'
   ) THEN
     RAISE EXCEPTION 'successful Markdown output observation missing' USING ERRCODE = '22023';
   END IF;
 END IF;
 RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION integration_gateway.guard_markdown_attempt_binding() FROM PUBLIC;
CREATE TRIGGER markdown_attempt_binding_guard BEFORE INSERT OR UPDATE ON integration_gateway.render_attempt
 FOR EACH ROW EXECUTE FUNCTION integration_gateway.guard_markdown_attempt_binding();
RESET ROLE;
