-- Close local final mirrors without changing V3007 or immutable history.
SET ROLE task_execution_owner;

CREATE FUNCTION task_execution.guard_final_local_mirrors() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $guard$
DECLARE subject_scope jsonb;
DECLARE expected_ref jsonb;
DECLARE j task_execution.execution_judgment%ROWTYPE;
DECLARE r task_execution.agent_result%ROWTYPE;
DECLARE a task_execution.agent_result_acceptance%ROWTYPE;
BEGIN
  subject_scope := jsonb_build_object(
    'enterpriseId', NEW.enterprise_id::text, 'projectId', NEW.project_id::text);
  IF TG_TABLE_NAME = 'agent_result' THEN
    IF NEW.observation_ref->'scope' IS DISTINCT FROM subject_scope THEN
      RAISE EXCEPTION 'final Result observation scope mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF TG_TABLE_NAME = 'result_validation_bundle' THEN
    SELECT * INTO j FROM task_execution.execution_judgment WHERE judgment_id = NEW.bundle_id;
    IF NEW.evaluator_ref IS DISTINCT FROM j.evaluator_ref
       OR NEW.valid_until IS DISTINCT FROM j.valid_until THEN
      RAISE EXCEPTION 'final validation judgment mirror mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.status = 'RESULT_RECORDED' THEN
    SELECT * INTO r FROM task_execution.agent_result
      WHERE result_id::text = NEW.result_ref->>'objectId' AND run_id = NEW.run_id;
    expected_ref := jsonb_build_object(
      'kind', 'CONTENT_ADDRESSED', 'objectType', 'execution.agent_result',
      'objectId', r.result_id::text, 'scope', subject_scope,
      'contentHash', jsonb_build_object('algorithm', 'SHA-256',
        'canonicalizationVersion', '1', 'digest', encode(r.result_payload_hash, 'hex')));
    IF NEW.result_ref IS DISTINCT FROM expected_ref THEN
      RAISE EXCEPTION 'Run final Result reference mirror mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.status = 'SUCCEEDED' THEN
    SELECT * INTO a FROM task_execution.agent_result_acceptance
      WHERE acceptance_id::text = NEW.acceptance_ref->>'objectId' AND run_id = NEW.run_id;
    expected_ref := jsonb_build_object(
      'kind', 'CONTENT_ADDRESSED', 'objectType', 'execution.agent_result_acceptance',
      'objectId', a.acceptance_id::text, 'scope', subject_scope,
      'contentHash', jsonb_build_object('algorithm', 'SHA-256',
        'canonicalizationVersion', '1', 'digest', encode(a.payload_hash, 'hex')));
    IF NEW.acceptance_ref IS DISTINCT FROM expected_ref THEN
      RAISE EXCEPTION 'Run final Acceptance reference mirror mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION task_execution.guard_final_local_mirrors() FROM PUBLIC;

CREATE TRIGGER final_result_local_mirror_guard BEFORE INSERT
  ON task_execution.agent_result FOR EACH ROW
  EXECUTE FUNCTION task_execution.guard_final_local_mirrors();
CREATE TRIGGER final_bundle_local_mirror_guard BEFORE INSERT
  ON task_execution.result_validation_bundle FOR EACH ROW
  EXECUTE FUNCTION task_execution.guard_final_local_mirrors();
CREATE TRIGGER final_run_local_mirror_guard BEFORE UPDATE
  ON task_execution.run FOR EACH ROW
  WHEN (NEW.status IN ('RESULT_RECORDED', 'SUCCEEDED'))
  EXECUTE FUNCTION task_execution.guard_final_local_mirrors();
