-- Preserve the complete final validation set and exact local command payloads.
SET ROLE task_execution_owner;

CREATE FUNCTION task_execution.guard_final_request_mirror() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE;
DECLARE source_id uuid;
DECLARE payload jsonb;
DECLARE parent task_execution.result_validation_bundle%ROWTYPE;
DECLARE field text;
DECLARE expected_ref jsonb;
BEGIN
  IF TG_TABLE_NAME='run' THEN source_id:=NEW.last_command_id;
  ELSE source_id:=NEW.source_command_id; END IF;
  SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=source_id;
  IF c.command_version IS DISTINCT FROM '1.0' THEN
    RAISE EXCEPTION 'final source command version mismatch' USING ERRCODE = '22023';
  END IF;
  IF TG_TABLE_NAME = 'agent_result' THEN
    payload := jsonb_build_object('agentResultContract', NEW.result_payload,
      'runFencingToken', NEW.fencing_token, 'runtimeSubmissionRef', NEW.runtime_submission_ref);
  ELSIF TG_TABLE_NAME = 'result_validation_bundle' THEN
    payload := jsonb_build_object('agentResultRef', NEW.canonical_payload->'agentResultRef',
      'runRef', NEW.canonical_payload->'runRef', 'runtimeAttemptRef', NEW.attempt_ref,
      'policyRef', NEW.policy_ref, 'evaluatorRef', NEW.evaluator_ref);
  ELSIF TG_TABLE_NAME = 'agent_result_acceptance' THEN
    payload := jsonb_build_object('agentResultRef', NEW.canonical_payload->'agentResultRef',
      'schemaValidationRef', NEW.canonical_payload->'validationRefs'->0,
      'identityValidationRef', NEW.canonical_payload->'validationRefs'->1,
      'runBindingValidationRef', NEW.canonical_payload->'validationRefs'->2,
      'scopeValidationRef', NEW.canonical_payload->'validationRefs'->3,
      'businessOutputValidationRef', NEW.canonical_payload->'validationRefs'->4,
      'disposition', NEW.canonical_payload->'disposition', 'reasons', NEW.canonical_payload->'reasons');
  ELSIF TG_TABLE_NAME = 'run' THEN
    IF c.expected_aggregate_version IS DISTINCT FROM OLD.aggregate_version THEN
      RAISE EXCEPTION 'final source CAS version mismatch' USING ERRCODE = '22023';
    END IF;
    payload := CASE WHEN NEW.status='RESULT_RECORDED'
      THEN jsonb_build_object('agentResultRef', NEW.result_ref)
      WHEN NEW.status='SUCCEEDED' THEN jsonb_build_object('acceptanceRecordRef', NEW.acceptance_ref)
      ELSE jsonb_build_object('reason','DEADLINE_EXCEEDED') END;
  ELSE
    SELECT * INTO parent FROM task_execution.result_validation_bundle WHERE bundle_id=NEW.bundle_id;
    FOREACH field IN ARRAY ARRAY['runRef','agentResultRef','attemptRef','observationRef',
      'policyRef','evaluatorRef','validUntil'] LOOP
      IF NEW.canonical_payload->field IS DISTINCT FROM parent.canonical_payload->field THEN
        RAISE EXCEPTION 'final validation common subject mismatch' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    expected_ref := jsonb_build_object('kind','CONTENT_ADDRESSED',
      'objectType','zhiju.execution.validation_result', 'objectId',NEW.validation_id::text,
      'scope',jsonb_build_object('enterpriseId',NEW.enterprise_id::text,'projectId',NEW.project_id::text),
      'contentHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1',
        'digest',encode(NEW.payload_hash,'hex')));
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(parent.canonical_payload->'validationRefs') AS refs(value)
      WHERE value=expected_ref) THEN
      RAISE EXCEPTION 'final validation parent reference mismatch' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF c.request_payload_hash IS DISTINCT FROM sha256(convert_to(
    task_execution.canonical_jsonb_text(payload),'UTF8')) THEN
    RAISE EXCEPTION 'final source request payload mismatch' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION task_execution.guard_final_request_mirror() FROM PUBLIC;

CREATE TRIGGER final_request_mirror_guard BEFORE INSERT ON task_execution.agent_result
  FOR EACH ROW EXECUTE FUNCTION task_execution.guard_final_request_mirror();
CREATE TRIGGER final_request_mirror_guard BEFORE INSERT ON task_execution.result_validation_bundle
  FOR EACH ROW EXECUTE FUNCTION task_execution.guard_final_request_mirror();
CREATE TRIGGER final_request_mirror_guard BEFORE INSERT ON task_execution.result_validation_fact
  FOR EACH ROW EXECUTE FUNCTION task_execution.guard_final_request_mirror();
CREATE TRIGGER final_request_mirror_guard BEFORE INSERT ON task_execution.agent_result_acceptance
  FOR EACH ROW EXECUTE FUNCTION task_execution.guard_final_request_mirror();
CREATE TRIGGER final_request_mirror_guard BEFORE UPDATE ON task_execution.run
  FOR EACH ROW WHEN (NEW.status IN ('RESULT_RECORDED','SUCCEEDED','TIMED_OUT'))
  EXECUTE FUNCTION task_execution.guard_final_request_mirror();

CREATE FUNCTION task_execution.guard_complete_final_validation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $guard$
DECLARE parent task_execution.result_validation_bundle%ROWTYPE;
DECLARE subject_id uuid;
DECLARE judgment task_execution.execution_judgment%ROWTYPE;
DECLARE f task_execution.result_validation_fact%ROWTYPE;
DECLARE reference jsonb;
DECLARE expected_ref jsonb;
DECLARE field text;
BEGIN
  IF TG_TABLE_NAME='execution_judgment' THEN subject_id:=NEW.judgment_id;
  ELSE subject_id:=NEW.bundle_id; END IF;
  SELECT * INTO parent FROM task_execution.result_validation_bundle WHERE bundle_id=subject_id;
  IF NOT FOUND OR jsonb_array_length(parent.canonical_payload->'validationRefs') IS DISTINCT FROM 5
     OR (SELECT count(DISTINCT value->>'objectId') FROM jsonb_array_elements(parent.canonical_payload->'validationRefs')) <> 5
     OR (SELECT count(*) FROM task_execution.result_validation_fact WHERE bundle_id=subject_id) <> 5 THEN
    RAISE EXCEPTION 'final validation requires five complete facts' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO judgment FROM task_execution.execution_judgment WHERE judgment_id=subject_id;
  IF NOT FOUND OR judgment.judgment_kind IS DISTINCT FROM 'RESULT_VALIDATION_BUNDLE'
     OR judgment.canonical_payload IS DISTINCT FROM parent.canonical_payload
     OR judgment.payload_hash IS DISTINCT FROM parent.payload_hash
     OR judgment.source_command_id IS DISTINCT FROM parent.source_command_id THEN
    RAISE EXCEPTION 'final validation deferred judgment mismatch' USING ERRCODE = '22023';
  END IF;
  FOR reference IN SELECT value FROM jsonb_array_elements(parent.canonical_payload->'validationRefs') LOOP
    SELECT * INTO f FROM task_execution.result_validation_fact
      WHERE bundle_id=subject_id AND validation_id::text=reference->>'objectId';
    expected_ref := jsonb_build_object('kind','CONTENT_ADDRESSED',
      'objectType','zhiju.execution.validation_result','objectId',f.validation_id::text,
      'scope',jsonb_build_object('enterpriseId',parent.enterprise_id::text,'projectId',parent.project_id::text),
      'contentHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(f.payload_hash,'hex')));
    IF NOT FOUND OR reference IS DISTINCT FROM expected_ref
       OR f.enterprise_id IS DISTINCT FROM parent.enterprise_id
       OR f.project_id IS DISTINCT FROM parent.project_id
       OR f.source_command_id IS DISTINCT FROM parent.source_command_id
       OR f.canonical_payload->>'status' IS DISTINCT FROM 'SATISFIED' THEN
      RAISE EXCEPTION 'final validation deferred reference mismatch' USING ERRCODE = '22023';
    END IF;
    FOREACH field IN ARRAY ARRAY['runRef','agentResultRef','attemptRef','observationRef',
      'policyRef','evaluatorRef','validUntil'] LOOP
      IF f.canonical_payload->field IS DISTINCT FROM parent.canonical_payload->field THEN
        RAISE EXCEPTION 'final validation deferred subject mismatch' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;
  RETURN NULL;
END $guard$;
REVOKE ALL ON FUNCTION task_execution.guard_complete_final_validation() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER final_validation_complete_guard AFTER INSERT ON task_execution.result_validation_bundle
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION task_execution.guard_complete_final_validation();
CREATE CONSTRAINT TRIGGER final_validation_complete_guard AFTER INSERT ON task_execution.result_validation_fact
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION task_execution.guard_complete_final_validation();
CREATE CONSTRAINT TRIGGER final_validation_complete_guard AFTER INSERT ON task_execution.execution_judgment
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.judgment_kind='RESULT_VALIDATION_BUNDLE')
  EXECUTE FUNCTION task_execution.guard_complete_final_validation();
