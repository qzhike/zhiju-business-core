-- IM-06 #224: the acknowledged adapter instance and one immutable final observation.
SET ROLE integration_gateway_owner;
CREATE POLICY runtime_final_source_receipt_owner_select
  ON integration_gateway.command_receipt FOR SELECT TO integration_gateway_owner USING (true);

CREATE FUNCTION integration_gateway.canonical_jsonb_text(p_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $fn$
DECLARE
    item record;
    kind text;
    result text;
    separator text := '';
    number_value numeric;
    normalized_key text;
    previous_key text;
BEGIN
    kind := jsonb_typeof(p_value);
    IF kind = 'object' THEN
        result := '{';
        FOR item IN
            SELECT key, value
              FROM jsonb_each(p_value)
             ORDER BY encode(convert_to(normalize(key, NFC), 'UTF8'), 'hex')
        LOOP
            normalized_key := normalize(item.key, NFC);
            -- The scan is ordered by the normalized bytes, so a collision is
            -- always adjacent to its twin.
            IF normalized_key = previous_key THEN
                RAISE EXCEPTION 'canonical JSON property names collide after NFC normalization'
                    USING ERRCODE = '22023';
            END IF;
            previous_key := normalized_key;
            result := result
                || separator
                || to_jsonb(normalized_key)::text
                || ':'
                || integration_gateway.canonical_jsonb_text(item.value);
            separator := ',';
        END LOOP;
        RETURN result || '}';
    ELSIF kind = 'array' THEN
        result := '[';
        FOR item IN
            SELECT value
              FROM jsonb_array_elements(p_value) WITH ORDINALITY AS elements(value, ordinal)
             ORDER BY ordinal
        LOOP
            result := result
                || separator
                || integration_gateway.canonical_jsonb_text(item.value);
            separator := ',';
        END LOOP;
        RETURN result || ']';
    ELSIF kind = 'string' THEN
        RETURN to_jsonb(normalize(p_value #>> '{}', NFC))::text;
    ELSIF kind = 'number' THEN
        number_value := (p_value #>> '{}')::numeric;
        IF number_value <> trunc(number_value)
           OR abs(number_value) > 9007199254740991::numeric THEN
            RAISE EXCEPTION 'canonical JSON number is not a safe integer'
                USING ERRCODE = '22023';
        END IF;
        RETURN trunc(number_value)::text;
    ELSIF kind = 'boolean' THEN
        RETURN p_value #>> '{}';
    ELSIF kind = 'null' THEN
        RETURN 'null';
    END IF;
    RAISE EXCEPTION 'unsupported JSON value in canonical payload'
        USING ERRCODE = '22023';
END
$fn$;
REVOKE ALL ON FUNCTION integration_gateway.canonical_jsonb_text(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION integration_gateway.canonical_jsonb_text(jsonb) FROM integration_gateway_app;

ALTER TABLE integration_gateway.runtime_attempt
  ADD COLUMN planned_runtime_instance_id uuid;
ALTER TABLE integration_gateway.runtime_attempt
  ADD CONSTRAINT runtime_attempt_instance_distinct
  CHECK (planned_runtime_instance_id IS NULL OR planned_runtime_instance_id <> attempt_id);

CREATE OR REPLACE FUNCTION integration_gateway.guard_runtime_attempt_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $guard$
BEGIN
  IF (NEW.attempt_id, NEW.enterprise_id, NEW.project_id, NEW.stable_key_hash,
      NEW.request_payload, NEW.request_payload_hash, NEW.invocation_binding,
      NEW.binding_hash, NEW.source_command_id, NEW.planned_runtime_instance_id,
      NEW.created_at) IS DISTINCT FROM
     (OLD.attempt_id, OLD.enterprise_id, OLD.project_id, OLD.stable_key_hash,
      OLD.request_payload, OLD.request_payload_hash, OLD.invocation_binding,
      OLD.binding_hash, OLD.source_command_id, OLD.planned_runtime_instance_id,
      OLD.created_at)
     OR NOT ((OLD.status = 'CREATED' AND NEW.status IN ('SUCCEEDED', 'UNKNOWN'))
          OR (OLD.status = 'UNKNOWN' AND NEW.status = 'SUCCEEDED')) THEN
    RAISE EXCEPTION 'runtime attempt immutable binding or transition violation'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.status = 'SUCCEEDED' AND NOT EXISTS (
    SELECT 1 FROM integration_gateway.runtime_attempt_observation o
    JOIN integration_gateway.raw_external_receipt r
      ON r.receipt_id = o.raw_receipt_id
     AND r.runtime_attempt_id = OLD.attempt_id
     AND r.attempt_kind = 'RUNTIME' AND r.observed_outcome = 'SUCCEEDED'
    WHERE o.attempt_id = OLD.attempt_id
      AND o.enterprise_id = OLD.enterprise_id AND o.project_id = OLD.project_id
  ) THEN
    RAISE EXCEPTION 'runtime success requires matching receipt and observation'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.status = 'SUCCEEDED' AND OLD.planned_runtime_instance_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM integration_gateway.runtime_adapter_identity i
       WHERE i.attempt_id = OLD.attempt_id
         AND i.instance_id = OLD.planned_runtime_instance_id
         AND i.enterprise_id = OLD.enterprise_id AND i.project_id = OLD.project_id
     ) THEN
    RAISE EXCEPTION 'runtime success requires acknowledged adapter identity'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $guard$;

CREATE TABLE integration_gateway.runtime_adapter_identity (
  instance_id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL UNIQUE REFERENCES integration_gateway.runtime_attempt(attempt_id),
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  adapter_code text NOT NULL CHECK (adapter_code = 'te.human_operated.synthetic'),
  adapter_version text NOT NULL CHECK (adapter_version = '1.0'),
  binding_hash bytea NOT NULL CHECK (octet_length(binding_hash) = 32),
  ack_observation_id uuid NOT NULL UNIQUE,
  source text NOT NULL CHECK (source = 'SYNTHETIC_DRIVER'),
  source_command_id uuid NOT NULL REFERENCES integration_gateway.command_receipt(command_id),
  canonical_payload jsonb NOT NULL,
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  CONSTRAINT runtime_adapter_identity_scope UNIQUE (instance_id, enterprise_id, project_id),
  CONSTRAINT runtime_adapter_identity_ack_fk FOREIGN KEY
    (ack_observation_id, enterprise_id, project_id)
    REFERENCES integration_gateway.runtime_attempt_observation
      (observation_id, enterprise_id, project_id)
);

CREATE FUNCTION integration_gateway.guard_runtime_adapter_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $guard$
DECLARE a integration_gateway.runtime_attempt%ROWTYPE;
DECLARE o integration_gateway.runtime_attempt_observation%ROWTYPE;
DECLARE c integration_gateway.command_receipt%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'runtime adapter identity is immutable' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO a FROM integration_gateway.runtime_attempt WHERE attempt_id = NEW.attempt_id;
  SELECT * INTO o FROM integration_gateway.runtime_attempt_observation
    WHERE observation_id = NEW.ack_observation_id;
  SELECT * INTO c FROM integration_gateway.command_receipt
    WHERE command_id = NEW.source_command_id;
  IF a.planned_runtime_instance_id IS DISTINCT FROM NEW.instance_id
     OR a.attempt_id IS NOT DISTINCT FROM NEW.instance_id
     OR a.status NOT IN ('CREATED', 'UNKNOWN')
     OR a.enterprise_id IS DISTINCT FROM NEW.enterprise_id
     OR a.project_id IS DISTINCT FROM NEW.project_id
     OR a.binding_hash IS DISTINCT FROM NEW.binding_hash
     OR a.source_command_id IS DISTINCT FROM NEW.source_command_id
     OR o.attempt_id IS DISTINCT FROM NEW.attempt_id
     OR o.acknowledgement_source IS DISTINCT FROM NEW.source
     OR c.outcome IS DISTINCT FROM 'PENDING'
     OR c.command_type IS DISTINCT FROM 'integration.request_runtime_dispatch'
     OR c.target_id IS DISTINCT FROM NEW.attempt_id
     OR NEW.canonical_payload->>'instanceId' IS DISTINCT FROM NEW.instance_id::text
     OR NEW.canonical_payload->>'attemptId' IS DISTINCT FROM NEW.attempt_id::text
     OR NEW.canonical_payload->>'ackObservationId' IS DISTINCT FROM NEW.ack_observation_id::text
     OR NEW.canonical_payload->>'bindingHash' IS DISTINCT FROM encode(NEW.binding_hash, 'hex')
     OR NEW.payload_hash IS DISTINCT FROM sha256(convert_to(
       integration_gateway.canonical_jsonb_text(NEW.canonical_payload), 'UTF8')) THEN
    RAISE EXCEPTION 'runtime adapter identity source mismatch' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER runtime_adapter_identity_guard BEFORE INSERT OR UPDATE OR DELETE
  ON integration_gateway.runtime_adapter_identity FOR EACH ROW
  EXECUTE FUNCTION integration_gateway.guard_runtime_adapter_identity();
REVOKE ALL ON FUNCTION integration_gateway.guard_runtime_adapter_identity() FROM PUBLIC;

CREATE TABLE integration_gateway.runtime_final_observation (
  observation_id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL UNIQUE REFERENCES integration_gateway.runtime_attempt(attempt_id),
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  ack_observation_id uuid NOT NULL,
  runtime_adapter_identity_id uuid NOT NULL,
  runtime_submission_ref jsonb NOT NULL,
  result_payload jsonb NOT NULL,
  result_payload_hash bytea NOT NULL CHECK (octet_length(result_payload_hash) = 32),
  binding_hash bytea NOT NULL CHECK (octet_length(binding_hash) = 32),
  fencing_token bigint NOT NULL CHECK (fencing_token >= 0),
  observed_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source = 'SYNTHETIC_DRIVER'),
  source_command_id uuid NOT NULL REFERENCES integration_gateway.command_receipt(command_id),
  canonical_payload jsonb NOT NULL,
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  CONSTRAINT runtime_final_submission_unique UNIQUE (enterprise_id, project_id, runtime_submission_ref),
  CONSTRAINT runtime_final_identity_fk FOREIGN KEY
    (runtime_adapter_identity_id, enterprise_id, project_id)
    REFERENCES integration_gateway.runtime_adapter_identity(instance_id, enterprise_id, project_id),
  CONSTRAINT runtime_final_ack_fk FOREIGN KEY
    (ack_observation_id, enterprise_id, project_id)
    REFERENCES integration_gateway.runtime_attempt_observation
      (observation_id, enterprise_id, project_id)
);

CREATE FUNCTION integration_gateway.guard_runtime_final_observation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $guard$
DECLARE a integration_gateway.runtime_attempt%ROWTYPE;
DECLARE i integration_gateway.runtime_adapter_identity%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'runtime final observation is immutable' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO a FROM integration_gateway.runtime_attempt WHERE attempt_id = NEW.attempt_id;
  SELECT * INTO i FROM integration_gateway.runtime_adapter_identity
    WHERE instance_id = NEW.runtime_adapter_identity_id;
  IF a.status IS DISTINCT FROM 'SUCCEEDED'
     OR a.enterprise_id IS DISTINCT FROM NEW.enterprise_id
     OR a.project_id IS DISTINCT FROM NEW.project_id
     OR a.binding_hash IS DISTINCT FROM NEW.binding_hash
     OR a.source_command_id IS DISTINCT FROM NEW.source_command_id
     OR i.attempt_id IS DISTINCT FROM NEW.attempt_id
     OR i.ack_observation_id IS DISTINCT FROM NEW.ack_observation_id
     OR NEW.result_payload->'submittedByRuntime'->>'objectId'
          IS DISTINCT FROM NEW.runtime_adapter_identity_id::text
     OR NEW.result_payload_hash IS DISTINCT FROM decode(
       NEW.result_payload->'header'->'payloadHash'->>'digest', 'hex')
     OR NEW.result_payload_hash IS DISTINCT FROM sha256(convert_to(
       integration_gateway.canonical_jsonb_text(
         NEW.result_payload #- '{header,payloadHash}'), 'UTF8'))
     OR NEW.canonical_payload->>'observationId' IS DISTINCT FROM NEW.observation_id::text
     OR NEW.canonical_payload->>'attemptId' IS DISTINCT FROM NEW.attempt_id::text
     OR NEW.payload_hash IS DISTINCT FROM sha256(convert_to(
       integration_gateway.canonical_jsonb_text(NEW.canonical_payload), 'UTF8')) THEN
    RAISE EXCEPTION 'runtime final source mismatch' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $guard$;
CREATE TRIGGER runtime_final_observation_guard BEFORE INSERT OR UPDATE OR DELETE
  ON integration_gateway.runtime_final_observation FOR EACH ROW
  EXECUTE FUNCTION integration_gateway.guard_runtime_final_observation();
REVOKE ALL ON FUNCTION integration_gateway.guard_runtime_final_observation() FROM PUBLIC;

GRANT SELECT, INSERT ON integration_gateway.runtime_adapter_identity,
  integration_gateway.runtime_final_observation TO integration_gateway_app;
REVOKE UPDATE, DELETE ON integration_gateway.runtime_adapter_identity,
  integration_gateway.runtime_final_observation FROM integration_gateway_app;
ALTER TABLE integration_gateway.runtime_adapter_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_gateway.runtime_adapter_identity FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_adapter_identity_select ON integration_gateway.runtime_adapter_identity
  FOR SELECT TO integration_gateway_app
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY runtime_adapter_identity_insert ON integration_gateway.runtime_adapter_identity
  FOR INSERT TO integration_gateway_app
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY runtime_adapter_identity_owner ON integration_gateway.runtime_adapter_identity
  FOR ALL TO integration_gateway_owner USING (true) WITH CHECK (true);
ALTER TABLE integration_gateway.runtime_final_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_gateway.runtime_final_observation FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_final_observation_select ON integration_gateway.runtime_final_observation
  FOR SELECT TO integration_gateway_app
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY runtime_final_observation_insert ON integration_gateway.runtime_final_observation
  FOR INSERT TO integration_gateway_app
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY runtime_final_observation_owner ON integration_gateway.runtime_final_observation
  FOR ALL TO integration_gateway_owner USING (true) WITH CHECK (true);
RESET ROLE;
