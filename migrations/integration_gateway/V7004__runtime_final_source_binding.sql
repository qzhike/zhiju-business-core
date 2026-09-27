-- Close the final observation mirrors against the original invocation and ack.
-- V7003 remains unchanged; immutable historical observations are not rewritten.
CREATE OR REPLACE FUNCTION integration_gateway.guard_runtime_final_observation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $guard$
DECLARE a integration_gateway.runtime_attempt%ROWTYPE;
DECLARE i integration_gateway.runtime_adapter_identity%ROWTYPE;
DECLARE o integration_gateway.runtime_attempt_observation%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'runtime final observation is immutable' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO a FROM integration_gateway.runtime_attempt WHERE attempt_id = NEW.attempt_id;
  SELECT * INTO i FROM integration_gateway.runtime_adapter_identity
    WHERE instance_id = NEW.runtime_adapter_identity_id;
  SELECT * INTO o FROM integration_gateway.runtime_attempt_observation
    WHERE observation_id = NEW.ack_observation_id;
  IF a.status IS DISTINCT FROM 'SUCCEEDED'
     OR a.enterprise_id IS DISTINCT FROM NEW.enterprise_id
     OR a.project_id IS DISTINCT FROM NEW.project_id
     OR a.binding_hash IS DISTINCT FROM NEW.binding_hash
     OR a.source_command_id IS DISTINCT FROM NEW.source_command_id
     OR a.invocation_binding->'fencingToken' IS DISTINCT FROM to_jsonb(NEW.fencing_token)
     OR a.invocation_binding->'runRef' IS DISTINCT FROM NEW.result_payload->'runRef'
     OR NEW.result_payload->'header'->'scopeRef' IS DISTINCT FROM jsonb_build_object(
       'enterpriseId', NEW.enterprise_id::text, 'projectId', NEW.project_id::text)
     OR i.attempt_id IS DISTINCT FROM NEW.attempt_id
     OR i.ack_observation_id IS DISTINCT FROM NEW.ack_observation_id
     OR o.attempt_id IS DISTINCT FROM NEW.attempt_id
     OR o.enterprise_id IS DISTINCT FROM NEW.enterprise_id
     OR o.project_id IS DISTINCT FROM NEW.project_id
     OR NEW.result_payload->'provenance'->'runtimeSessionExternalRef'
          IS DISTINCT FROM o.runtime_session_ref
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
REVOKE ALL ON FUNCTION integration_gateway.guard_runtime_final_observation() FROM PUBLIC;
