-- IM-06 #224: one accepted final result and one terminal Run fact.
SET ROLE task_execution_owner;
CREATE POLICY final_source_receipt_owner_select
  ON task_execution.command_receipt FOR SELECT TO task_execution_owner USING (true);

ALTER TABLE task_execution.run
  ADD COLUMN runtime_adapter_identity_ref jsonb,
  ADD COLUMN result_ref jsonb,
  ADD COLUMN acceptance_ref jsonb,
  ADD COLUMN ended_at timestamptz,
  ADD COLUMN termination_reason text;
ALTER TABLE task_execution.run
  DROP CONSTRAINT run_status_check,
  DROP CONSTRAINT run_status_shape,
  ADD CONSTRAINT run_status_check CHECK (status IN
    ('CREATED', 'STARTING', 'RUNNING', 'RESULT_RECORDED', 'SUCCEEDED', 'TIMED_OUT')),
  ADD CONSTRAINT run_status_shape CHECK (
    (status IN ('CREATED', 'STARTING') AND started_at IS NULL
      AND start_attempt_ref IS NULL AND runtime_adapter_identity_ref IS NULL
      AND result_ref IS NULL AND acceptance_ref IS NULL AND ended_at IS NULL)
    OR (status = 'RUNNING' AND started_at IS NOT NULL
      AND start_attempt_ref IS NOT NULL AND result_ref IS NULL
      AND acceptance_ref IS NULL AND ended_at IS NULL)
    OR (status = 'RESULT_RECORDED' AND started_at IS NOT NULL
      AND start_attempt_ref IS NOT NULL AND runtime_adapter_identity_ref IS NOT NULL
      AND result_ref IS NOT NULL AND acceptance_ref IS NULL AND ended_at IS NULL)
    OR (status = 'SUCCEEDED' AND started_at IS NOT NULL
      AND start_attempt_ref IS NOT NULL AND runtime_adapter_identity_ref IS NOT NULL
      AND result_ref IS NOT NULL AND acceptance_ref IS NOT NULL AND ended_at IS NOT NULL
      AND termination_reason = 'EXECUTION_RESULT_ACCEPTED')
    OR (status = 'TIMED_OUT' AND ended_at IS NOT NULL
      AND acceptance_ref IS NULL
      AND termination_reason = 'EXECUTION_DEADLINE_EXCEEDED'));
CREATE POLICY final_run_owner_select ON task_execution.run FOR SELECT TO task_execution_owner
  USING (true);

CREATE TABLE task_execution.agent_result (
  result_id uuid PRIMARY KEY,
  run_id uuid NOT NULL UNIQUE,
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  attempt_ref jsonb NOT NULL,
  observation_ref jsonb NOT NULL,
  adapter_identity_ref jsonb NOT NULL,
  runtime_submission_ref jsonb NOT NULL,
  fencing_token bigint NOT NULL,
  result_payload jsonb NOT NULL,
  result_payload_hash bytea NOT NULL CHECK (octet_length(result_payload_hash) = 32),
  source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
  CONSTRAINT agent_result_run_fk FOREIGN KEY (enterprise_id, project_id, run_id)
    REFERENCES task_execution.run(enterprise_id, project_id, run_id),
  CONSTRAINT agent_result_scope_unique UNIQUE (enterprise_id, project_id, result_id),
  CONSTRAINT agent_result_observation_unique UNIQUE (enterprise_id, project_id, observation_ref),
  CONSTRAINT agent_result_submission_unique UNIQUE (enterprise_id, project_id, runtime_submission_ref),
  CONSTRAINT agent_result_hash_unique UNIQUE (enterprise_id, project_id, result_payload_hash)
);

CREATE TABLE task_execution.run_final_submission_claim (
  run_id uuid PRIMARY KEY REFERENCES task_execution.run(run_id),
  result_id uuid NOT NULL UNIQUE REFERENCES task_execution.agent_result(result_id)
    DEFERRABLE INITIALLY DEFERRED,
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  observation_ref jsonb NOT NULL,
  result_payload_hash bytea NOT NULL,
  source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id)
);

-- The final evaluator is a third, additive ExecutionJudgment kind. Existing
-- TaskReadiness and WorkOrderValidation rows retain their exact old branches.
ALTER TABLE task_execution.execution_judgment
  ADD COLUMN run_id uuid,
  ADD COLUMN result_id uuid,
  ADD COLUMN attempt_ref jsonb,
  ADD COLUMN observation_ref jsonb,
  ADD CONSTRAINT result_judgment_run_fk FOREIGN KEY (enterprise_id, project_id, run_id)
    REFERENCES task_execution.run(enterprise_id, project_id, run_id),
  ADD CONSTRAINT result_judgment_result_fk FOREIGN KEY (result_id)
    REFERENCES task_execution.agent_result(result_id),
  ADD CONSTRAINT result_judgment_result_unique UNIQUE (result_id);
CREATE POLICY result_judgment_owner_select
  ON task_execution.execution_judgment FOR SELECT TO task_execution_owner USING (true);
ALTER TABLE task_execution.execution_judgment
  DROP CONSTRAINT execution_judgment_kind_closed,
  DROP CONSTRAINT execution_judgment_kind_columns,
  DROP CONSTRAINT execution_judgment_payload_shape;
ALTER TABLE task_execution.execution_judgment
  ADD CONSTRAINT execution_judgment_kind_closed CHECK (judgment_kind IN
    ('TASK_READINESS', 'WORK_ORDER_VALIDATION', 'RESULT_VALIDATION_BUNDLE')),
  ADD CONSTRAINT execution_judgment_kind_columns CHECK (
    (judgment_kind = 'TASK_READINESS'
      AND task_id IS NOT NULL AND task_definition_snapshot_id IS NOT NULL
      AND task_definition_hash IS NOT NULL AND ready IS NOT NULL
      AND work_order_id IS NULL AND draft_snapshot_id IS NULL
      AND draft_snapshot_hash IS NULL AND candidate_contract_hash IS NULL
      AND specification_hash IS NULL AND context_snapshot_id IS NULL
      AND context_snapshot_hash IS NULL AND validation_valid IS NULL
      AND validation_references_valid IS NULL
      AND validation_specification_hash_valid IS NULL
      AND validation_capability_valid IS NULL AND validation_executable IS NULL
      AND validation_budget_valid IS NULL
      AND validation_context_coverage_valid IS NULL
      AND run_id IS NULL AND result_id IS NULL
      AND attempt_ref IS NULL AND observation_ref IS NULL)
    OR (judgment_kind = 'WORK_ORDER_VALIDATION'
      AND task_id IS NULL AND task_definition_snapshot_id IS NULL
      AND task_definition_hash IS NULL AND ready IS NULL
      AND work_order_id IS NOT NULL AND draft_snapshot_id IS NOT NULL
      AND draft_snapshot_hash IS NOT NULL AND candidate_contract_hash IS NOT NULL
      AND specification_hash IS NOT NULL AND context_snapshot_id IS NOT NULL
      AND context_snapshot_hash IS NOT NULL AND validation_valid IS NOT NULL
      AND validation_references_valid IS NOT NULL
      AND validation_specification_hash_valid IS NOT NULL
      AND validation_capability_valid IS NOT NULL AND validation_executable IS NOT NULL
      AND validation_budget_valid IS NOT NULL
      AND validation_context_coverage_valid IS NOT NULL
      AND run_id IS NULL AND result_id IS NULL
      AND attempt_ref IS NULL AND observation_ref IS NULL)
    OR (judgment_kind = 'RESULT_VALIDATION_BUNDLE'
      AND run_id IS NOT NULL AND result_id IS NOT NULL
      AND attempt_ref IS NOT NULL AND observation_ref IS NOT NULL
      AND task_id IS NULL AND task_definition_snapshot_id IS NULL
      AND task_definition_hash IS NULL AND ready IS NULL
      AND work_order_id IS NULL AND draft_snapshot_id IS NULL
      AND draft_snapshot_hash IS NULL AND candidate_contract_hash IS NULL
      AND specification_hash IS NULL AND context_snapshot_id IS NULL
      AND context_snapshot_hash IS NULL AND validation_valid IS NULL
      AND validation_references_valid IS NULL
      AND validation_specification_hash_valid IS NULL
      AND validation_capability_valid IS NULL AND validation_executable IS NULL
      AND validation_budget_valid IS NULL
      AND validation_context_coverage_valid IS NULL)),
  ADD CONSTRAINT execution_judgment_payload_shape CHECK (
    jsonb_typeof(canonical_payload) IS NOT DISTINCT FROM 'object'
    AND canonical_payload->>'judgmentKind' IS NOT DISTINCT FROM judgment_kind
    AND jsonb_typeof(canonical_payload->'scope') IS NOT DISTINCT FROM 'object'
    AND (judgment_kind <> 'TASK_READINESS' OR (
      jsonb_typeof(canonical_payload->'taskRef') IS NOT DISTINCT FROM 'object'
      AND jsonb_typeof(canonical_payload->'taskDefinitionRef') IS NOT DISTINCT FROM 'object'
      AND jsonb_typeof(canonical_payload->'dependencies') IS NOT DISTINCT FROM 'array'
      AND jsonb_typeof(canonical_payload->'inputs') IS NOT DISTINCT FROM 'array'
      AND jsonb_typeof(canonical_payload->'blockers') IS NOT DISTINCT FROM 'array'
      AND jsonb_typeof(canonical_payload->'checks') IS NOT DISTINCT FROM 'array'
      AND jsonb_typeof(canonical_payload->'ready') IS NOT DISTINCT FROM 'boolean'))
    AND (judgment_kind <> 'WORK_ORDER_VALIDATION' OR (
      task_execution.work_order_validation_payload_valid(canonical_payload)
      AND jsonb_typeof(canonical_payload->'workOrderRef') IS NOT DISTINCT FROM 'object'
      AND jsonb_typeof(canonical_payload->'draftSnapshotRef') IS NOT DISTINCT FROM 'object'
      AND jsonb_typeof(canonical_payload->'contextSnapshotRef') IS NOT DISTINCT FROM 'object'
      AND jsonb_typeof(canonical_payload->'policyVersionRef') IS NOT DISTINCT FROM 'object'
      AND jsonb_typeof(canonical_payload->'evaluatorRef') IS NOT DISTINCT FROM 'object'
      AND jsonb_typeof(canonical_payload->'subjectRefs') IS NOT DISTINCT FROM 'array'
      AND jsonb_typeof(canonical_payload->'sourceWatermarks') IS NOT DISTINCT FROM 'array'
      AND jsonb_typeof(canonical_payload->'validation') IS NOT DISTINCT FROM 'object'
      AND jsonb_typeof(canonical_payload->'checks') IS NOT DISTINCT FROM 'array'))
    AND (judgment_kind <> 'RESULT_VALIDATION_BUNDLE' OR (
      jsonb_typeof(canonical_payload->'runRef') IS NOT DISTINCT FROM 'object'
      AND jsonb_typeof(canonical_payload->'agentResultRef') IS NOT DISTINCT FROM 'object'
      AND jsonb_typeof(canonical_payload->'attemptRef') IS NOT DISTINCT FROM 'object'
      AND jsonb_typeof(canonical_payload->'observationRef') IS NOT DISTINCT FROM 'object'
      AND jsonb_typeof(canonical_payload->'validationRefs') IS NOT DISTINCT FROM 'array'
      AND jsonb_array_length(canonical_payload->'validationRefs') = 5)));

DROP TRIGGER execution_judgment_mirror_guard ON task_execution.execution_judgment;
CREATE TRIGGER execution_judgment_mirror_guard
  BEFORE INSERT OR UPDATE ON task_execution.execution_judgment
  FOR EACH ROW WHEN (NEW.judgment_kind <> 'RESULT_VALIDATION_BUNDLE')
  EXECUTE FUNCTION task_execution.guard_execution_judgment_mirror();
DROP TRIGGER execution_judgment_creation_identity_guard
  ON task_execution.execution_judgment;
CREATE TRIGGER execution_judgment_creation_identity_guard
  BEFORE INSERT ON task_execution.execution_judgment
  FOR EACH ROW WHEN (NEW.judgment_kind <> 'RESULT_VALIDATION_BUNDLE')
  EXECUTE FUNCTION task_execution.guard_execution_judgment_creation_identity();

CREATE FUNCTION task_execution.guard_result_validation_judgment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE;
DECLARE r task_execution.run%ROWTYPE;
DECLARE a task_execution.agent_result%ROWTYPE;
BEGIN
  SELECT * INTO c FROM task_execution.command_receipt WHERE command_id = NEW.source_command_id;
  SELECT * INTO r FROM task_execution.run WHERE run_id = NEW.run_id;
  SELECT * INTO a FROM task_execution.agent_result WHERE result_id = NEW.result_id;
  IF c.outcome IS DISTINCT FROM 'PENDING'
     OR c.command_type <> 'execution.validate_agent_result'
     OR c.target_type <> 'zhiju.execution.agent_result_validation_bundle'
     OR c.target_id IS DISTINCT FROM NEW.judgment_id
     OR c.enterprise_id IS DISTINCT FROM NEW.enterprise_id
     OR c.project_id IS DISTINCT FROM NEW.project_id
     OR c.request_payload_hash IS DISTINCT FROM NEW.request_payload_hash
     OR c.created_by_principal_id IS DISTINCT FROM NEW.created_by_principal_id
     OR c.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
     OR c.authorization_decision_id IS DISTINCT FROM
       (SELECT decision_id FROM platform_security.context_authorization_decision_ref())
     OR r.status <> 'RESULT_RECORDED'
     OR r.enterprise_id IS DISTINCT FROM NEW.enterprise_id
     OR r.project_id IS DISTINCT FROM NEW.project_id
     OR r.result_ref->>'objectId' IS DISTINCT FROM NEW.result_id::text
     OR r.start_attempt_ref IS DISTINCT FROM NEW.attempt_ref
     OR a.run_id IS DISTINCT FROM NEW.run_id
     OR a.observation_ref IS DISTINCT FROM NEW.observation_ref
     OR a.result_payload_hash IS DISTINCT FROM NEW.input_hash
     OR NEW.policy_version_ref IS DISTINCT FROM r.lease_policy_ref
     OR NEW.policy_version_ref IS DISTINCT FROM NEW.canonical_payload->'policyRef'
     OR NEW.evaluator_ref IS DISTINCT FROM NEW.canonical_payload->'evaluatorRef'
     OR NEW.policy_content_hash IS DISTINCT FROM decode(
       NEW.canonical_payload->>'policyContentHash', 'hex')
     OR NEW.policy_effective_from IS DISTINCT FROM
       (NEW.canonical_payload->>'policyEffectiveFrom')::timestamptz
     OR NEW.policy_superseded_at IS DISTINCT FROM
       (NEW.canonical_payload->>'policySupersededAt')::timestamptz
     OR NEW.valid_until IS DISTINCT FROM
       (NEW.canonical_payload->>'validUntil')::timestamptz
     OR NEW.valid_until > r.execution_deadline
     OR NEW.valid_until > r.lease_expires_at
     OR NEW.valid_until <= clock_timestamp()
     OR NEW.canonical_payload->>'bundleId' IS DISTINCT FROM NEW.judgment_id::text
     OR NEW.canonical_payload->'scope' IS DISTINCT FROM jsonb_build_object(
       'enterpriseId', NEW.enterprise_id::text, 'projectId', NEW.project_id::text)
     OR NEW.canonical_payload->'runRef'->>'objectId' IS DISTINCT FROM NEW.run_id::text
     OR NEW.canonical_payload->'agentResultRef'->>'objectId'
       IS DISTINCT FROM NEW.result_id::text
     OR NEW.canonical_payload->'attemptRef' IS DISTINCT FROM NEW.attempt_ref
     OR NEW.canonical_payload->'observationRef' IS DISTINCT FROM NEW.observation_ref
     OR NEW.payload_hash IS DISTINCT FROM sha256(convert_to(
       task_execution.canonical_jsonb_text(NEW.canonical_payload), 'UTF8')) THEN
    RAISE EXCEPTION 'Result judgment source or mirror mismatch' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION task_execution.guard_result_validation_judgment() FROM PUBLIC;
CREATE TRIGGER result_validation_judgment_guard
  BEFORE INSERT ON task_execution.execution_judgment
  FOR EACH ROW WHEN (NEW.judgment_kind = 'RESULT_VALIDATION_BUNDLE')
  EXECUTE FUNCTION task_execution.guard_result_validation_judgment();

CREATE TABLE task_execution.result_validation_bundle (
  bundle_id uuid PRIMARY KEY REFERENCES task_execution.execution_judgment(judgment_id),
  run_id uuid NOT NULL,
  result_id uuid NOT NULL UNIQUE REFERENCES task_execution.agent_result(result_id),
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  attempt_ref jsonb NOT NULL,
  observation_ref jsonb NOT NULL,
  policy_ref jsonb NOT NULL,
  evaluator_ref jsonb NOT NULL,
  valid_until timestamptz NOT NULL,
  canonical_payload jsonb NOT NULL,
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
  CONSTRAINT result_bundle_run_fk FOREIGN KEY (enterprise_id, project_id, run_id)
    REFERENCES task_execution.run(enterprise_id, project_id, run_id)
);

CREATE TABLE task_execution.result_validation_fact (
  validation_id uuid PRIMARY KEY,
  bundle_id uuid NOT NULL REFERENCES task_execution.result_validation_bundle(bundle_id)
    DEFERRABLE INITIALLY DEFERRED,
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN
    ('SCHEMA', 'IDENTITY', 'RUN_BINDING', 'SCOPE', 'BUSINESS_OUTPUT')),
  canonical_payload jsonb NOT NULL,
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
  CONSTRAINT result_validation_kind_unique UNIQUE (bundle_id, kind)
);

CREATE TABLE task_execution.agent_result_acceptance (
  acceptance_id uuid PRIMARY KEY,
  result_id uuid NOT NULL UNIQUE REFERENCES task_execution.agent_result(result_id),
  bundle_id uuid NOT NULL REFERENCES task_execution.result_validation_bundle(bundle_id),
  run_id uuid NOT NULL REFERENCES task_execution.run(run_id),
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  canonical_payload jsonb NOT NULL,
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id)
);

CREATE FUNCTION task_execution.guard_final_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE;
DECLARE r task_execution.run%ROWTYPE;
DECLARE result_row task_execution.agent_result%ROWTYPE;
DECLARE bundle_row task_execution.result_validation_bundle%ROWTYPE;
DECLARE judgment_row task_execution.execution_judgment%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'final fact is immutable' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO c FROM task_execution.command_receipt WHERE command_id = NEW.source_command_id;
  IF c.outcome IS DISTINCT FROM 'PENDING'
     OR c.enterprise_id IS DISTINCT FROM NEW.enterprise_id
     OR c.project_id IS DISTINCT FROM NEW.project_id
     OR c.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
     OR c.authorization_decision_id IS DISTINCT FROM
       (SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
    RAISE EXCEPTION 'final fact source receipt mismatch' USING ERRCODE = '22023';
  END IF;
  IF TG_TABLE_NAME = 'agent_result' THEN
    SELECT * INTO r FROM task_execution.run WHERE run_id = NEW.run_id;
    IF c.command_type <> 'execution.submit_agent_result'
       OR c.target_type <> 'execution.agent_result' OR c.target_id <> NEW.result_id
       OR r.status <> 'RUNNING' OR clock_timestamp() >= r.execution_deadline
       OR clock_timestamp() >= r.lease_expires_at
       OR r.enterprise_id <> NEW.enterprise_id
       OR r.project_id <> NEW.project_id
       OR r.start_attempt_ref IS DISTINCT FROM NEW.attempt_ref
       OR r.runtime_adapter_identity_ref IS DISTINCT FROM NEW.adapter_identity_ref
       OR r.fencing_token IS DISTINCT FROM NEW.fencing_token
       OR NEW.result_payload->'runRef'->>'objectId' IS DISTINCT FROM NEW.run_id::text
       OR NEW.result_payload->'submittedByRuntime' IS DISTINCT FROM NEW.adapter_identity_ref
       OR NEW.result_payload->>'agentResultId' IS DISTINCT FROM NEW.result_id::text
       OR NEW.result_payload_hash IS DISTINCT FROM decode(
         NEW.result_payload->'header'->'payloadHash'->>'digest', 'hex')
       OR NEW.result_payload_hash IS DISTINCT FROM sha256(convert_to(
         task_execution.canonical_jsonb_text(
           NEW.result_payload #- '{header,payloadHash}'), 'UTF8')) THEN
      RAISE EXCEPTION 'final Result run or payload mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF TG_TABLE_NAME = 'result_validation_bundle' THEN
    SELECT * INTO r FROM task_execution.run WHERE run_id = NEW.run_id;
    SELECT * INTO result_row FROM task_execution.agent_result
      WHERE result_id = NEW.result_id;
    SELECT * INTO judgment_row FROM task_execution.execution_judgment
      WHERE judgment_id = NEW.bundle_id;
    IF c.command_type <> 'execution.validate_agent_result'
       OR c.target_type <> 'zhiju.execution.agent_result_validation_bundle'
       OR c.target_id <> NEW.bundle_id
       OR r.status <> 'RESULT_RECORDED'
       OR r.enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR r.project_id IS DISTINCT FROM NEW.project_id
       OR r.start_attempt_ref IS DISTINCT FROM NEW.attempt_ref
       OR r.lease_policy_ref IS DISTINCT FROM NEW.policy_ref
       OR result_row.run_id IS DISTINCT FROM NEW.run_id
       OR result_row.observation_ref IS DISTINCT FROM NEW.observation_ref
       OR judgment_row.judgment_kind IS DISTINCT FROM 'RESULT_VALIDATION_BUNDLE'
       OR judgment_row.run_id IS DISTINCT FROM NEW.run_id
       OR judgment_row.result_id IS DISTINCT FROM NEW.result_id
       OR judgment_row.payload_hash IS DISTINCT FROM NEW.payload_hash
       OR judgment_row.source_command_id IS DISTINCT FROM NEW.source_command_id
       OR NEW.valid_until > r.execution_deadline
       OR NEW.valid_until > r.lease_expires_at
       OR NEW.valid_until <= clock_timestamp()
       OR NEW.canonical_payload->>'bundleId' IS DISTINCT FROM NEW.bundle_id::text
       OR NEW.canonical_payload->'observationRef' IS DISTINCT FROM NEW.observation_ref
       OR NEW.payload_hash IS DISTINCT FROM sha256(convert_to(
         task_execution.canonical_jsonb_text(NEW.canonical_payload), 'UTF8')) THEN
      RAISE EXCEPTION 'validation bundle source mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF TG_TABLE_NAME = 'result_validation_fact' THEN
    SELECT * INTO bundle_row FROM task_execution.result_validation_bundle
      WHERE bundle_id = NEW.bundle_id;
    IF c.command_type <> 'execution.validate_agent_result'
       OR c.target_id IS DISTINCT FROM NEW.bundle_id
       OR bundle_row.enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR bundle_row.project_id IS DISTINCT FROM NEW.project_id
       OR bundle_row.source_command_id IS DISTINCT FROM NEW.source_command_id
       OR NEW.canonical_payload->>'validationId' IS DISTINCT FROM NEW.validation_id::text
       OR NEW.canonical_payload->>'bundleId' IS DISTINCT FROM NEW.bundle_id::text
       OR NEW.canonical_payload->>'kind' IS DISTINCT FROM NEW.kind
       OR NEW.canonical_payload->>'status' <> 'SATISFIED'
       OR NEW.payload_hash IS DISTINCT FROM sha256(convert_to(
         task_execution.canonical_jsonb_text(NEW.canonical_payload), 'UTF8')) THEN
      RAISE EXCEPTION 'validation fact source mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF TG_TABLE_NAME = 'agent_result_acceptance' THEN
    SELECT * INTO r FROM task_execution.run WHERE run_id = NEW.run_id;
    SELECT * INTO result_row FROM task_execution.agent_result
      WHERE result_id = NEW.result_id;
    SELECT * INTO bundle_row FROM task_execution.result_validation_bundle
      WHERE bundle_id = NEW.bundle_id;
    IF c.command_type <> 'execution.accept_agent_result'
       OR c.target_type <> 'execution.agent_result_acceptance'
       OR c.target_id <> NEW.acceptance_id
       OR r.status <> 'RESULT_RECORDED'
       OR r.enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR r.project_id IS DISTINCT FROM NEW.project_id
       OR result_row.run_id IS DISTINCT FROM NEW.run_id
       OR bundle_row.run_id IS DISTINCT FROM NEW.run_id
       OR bundle_row.result_id IS DISTINCT FROM NEW.result_id
       OR bundle_row.valid_until <= clock_timestamp()
       OR (SELECT count(*) FROM task_execution.result_validation_fact f
           WHERE f.bundle_id = NEW.bundle_id AND f.enterprise_id = NEW.enterprise_id
             AND f.project_id = NEW.project_id
             AND f.canonical_payload->>'status' = 'SATISFIED') <> 5
       OR NEW.canonical_payload->>'acceptanceId' IS DISTINCT FROM NEW.acceptance_id::text
       OR NEW.canonical_payload->>'disposition' <> 'ACCEPTED'
       OR NEW.canonical_payload->'reasons' <> '[]'::jsonb
       OR NEW.payload_hash IS DISTINCT FROM sha256(convert_to(
         task_execution.canonical_jsonb_text(NEW.canonical_payload), 'UTF8')) THEN
      RAISE EXCEPTION 'acceptance source mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION task_execution.guard_final_insert() FROM PUBLIC;

CREATE FUNCTION task_execution.guard_final_claim() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $guard$
DECLARE r task_execution.agent_result%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'final reservation is immutable' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO r FROM task_execution.agent_result WHERE result_id = NEW.result_id;
  IF r.run_id IS DISTINCT FROM NEW.run_id
     OR r.enterprise_id IS DISTINCT FROM NEW.enterprise_id
     OR r.project_id IS DISTINCT FROM NEW.project_id
     OR r.observation_ref IS DISTINCT FROM NEW.observation_ref
     OR r.result_payload_hash IS DISTINCT FROM NEW.result_payload_hash
     OR r.source_command_id IS DISTINCT FROM NEW.source_command_id THEN
    RAISE EXCEPTION 'final reservation mismatch' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION task_execution.guard_final_claim() FROM PUBLIC;

CREATE OR REPLACE FUNCTION task_execution.guard_first_run_claim() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE;
DECLARE r task_execution.run%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Run claim is immutable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO c FROM task_execution.command_receipt
    WHERE command_id = CASE WHEN TG_OP = 'INSERT' THEN NEW.source_command_id
                          ELSE (SELECT last_command_id FROM task_execution.run
                                WHERE run_id = NEW.run_id) END;
  SELECT * INTO r FROM task_execution.run WHERE run_id = NEW.run_id;
  IF TG_OP = 'INSERT' THEN
    IF c.outcome IS DISTINCT FROM 'PENDING' OR c.command_type <> 'execution.create_run'
       OR r.source_command_id IS DISTINCT FROM NEW.source_command_id
       OR r.work_order_id IS DISTINCT FROM NEW.work_order_id
       OR r.fencing_token IS DISTINCT FROM NEW.fencing_token
       OR NEW.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Run claim creation mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF (NEW.work_order_id, NEW.run_id, NEW.enterprise_id, NEW.project_id,
         NEW.attempt_number, NEW.fencing_token, NEW.source_command_id)
       IS DISTINCT FROM
        (OLD.work_order_id, OLD.run_id, OLD.enterprise_id, OLD.project_id,
         OLD.attempt_number, OLD.fencing_token, OLD.source_command_id)
       OR OLD.status <> 'ACTIVE'
       OR NOT ((NEW.status = 'RELEASED' AND r.status = 'SUCCEEDED'
                AND c.command_type = 'execution.finalize_run_from_acceptance')
            OR (NEW.status = 'EXPIRED' AND r.status = 'TIMED_OUT'
                AND c.command_type = 'execution.expire_run'))
       OR c.outcome IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'Run claim terminal mismatch' USING ERRCODE = '22023';
  END IF;
  IF c.enterprise_id IS DISTINCT FROM NEW.enterprise_id
     OR c.project_id IS DISTINCT FROM NEW.project_id
     OR c.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id() THEN
    RAISE EXCEPTION 'Run claim source mismatch' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $guard$;

CREATE OR REPLACE FUNCTION task_execution.guard_first_run_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Run is not deletable' USING ERRCODE = '23514';
  END IF;
  IF (NEW.enterprise_id, NEW.project_id, NEW.work_order_id, NEW.work_order_ref,
      NEW.work_order_contract_ref, NEW.context_snapshot_ref, NEW.capability_grant_ref,
      NEW.attempt_number, NEW.runtime_binding, NEW.lease_policy_ref, NEW.lease_id,
      NEW.fencing_token, NEW.lease_expires_at, NEW.execution_deadline,
      NEW.created_at, NEW.source_command_id, NEW.created_by_principal_id)
     IS DISTINCT FROM
     (OLD.enterprise_id, OLD.project_id, OLD.work_order_id, OLD.work_order_ref,
      OLD.work_order_contract_ref, OLD.context_snapshot_ref, OLD.capability_grant_ref,
      OLD.attempt_number, OLD.runtime_binding, OLD.lease_policy_ref, OLD.lease_id,
      OLD.fencing_token, OLD.lease_expires_at, OLD.execution_deadline,
      OLD.created_at, OLD.source_command_id, OLD.created_by_principal_id)
     OR (OLD.runtime_adapter_identity_ref IS NOT NULL
         AND NEW.runtime_adapter_identity_ref IS DISTINCT FROM OLD.runtime_adapter_identity_ref)
     OR (OLD.start_attempt_ref IS NOT NULL
         AND NEW.start_attempt_ref IS DISTINCT FROM OLD.start_attempt_ref)
     OR NEW.aggregate_version <> OLD.aggregate_version + 1
     OR NEW.last_command_id IS NULL THEN
    RAISE EXCEPTION 'Run immutable binding or CAS mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO c FROM task_execution.command_receipt WHERE command_id = NEW.last_command_id;
  IF c.outcome IS DISTINCT FROM 'PENDING'
     OR c.target_type IS DISTINCT FROM 'execution.run'
     OR c.target_id IS DISTINCT FROM NEW.run_id
     OR c.enterprise_id IS DISTINCT FROM NEW.enterprise_id
     OR c.project_id IS DISTINCT FROM NEW.project_id
     OR c.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
     OR c.authorization_decision_id IS DISTINCT FROM
       (SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
    RAISE EXCEPTION 'Run transition source mismatch' USING ERRCODE = '22023';
  END IF;
  IF NOT ((OLD.status IN ('CREATED', 'STARTING') AND NEW.status = 'RUNNING'
            AND c.command_type = 'execution.start_run'
            AND OLD.start_attempt_ref IS NULL AND NEW.start_attempt_ref IS NOT NULL
            AND OLD.runtime_adapter_identity_ref IS NULL
            AND NEW.runtime_adapter_identity_ref IS NOT NULL)
          OR (OLD.status = 'RUNNING' AND NEW.status = 'RESULT_RECORDED'
            AND c.command_type = 'execution.record_run_result'
            AND NEW.result_ref IS NOT NULL
            AND EXISTS (SELECT 1 FROM task_execution.agent_result ar
              WHERE ar.run_id = NEW.run_id
                AND ar.result_id::text = NEW.result_ref->>'objectId'
                AND encode(ar.result_payload_hash, 'hex') =
                  NEW.result_ref->'contentHash'->>'digest'))
          OR (OLD.status = 'RESULT_RECORDED' AND NEW.status = 'SUCCEEDED'
            AND c.command_type = 'execution.finalize_run_from_acceptance'
            AND clock_timestamp() < NEW.execution_deadline
            AND clock_timestamp() < NEW.lease_expires_at
            AND NEW.result_ref = OLD.result_ref AND NEW.acceptance_ref IS NOT NULL
            AND EXISTS (SELECT 1 FROM task_execution.agent_result_acceptance a
              WHERE a.run_id = NEW.run_id
                AND a.acceptance_id::text = NEW.acceptance_ref->>'objectId'
                AND encode(a.payload_hash, 'hex') =
                  NEW.acceptance_ref->'contentHash'->>'digest'))
          OR (OLD.status IN ('CREATED', 'STARTING', 'RUNNING', 'RESULT_RECORDED')
            AND NEW.status = 'TIMED_OUT' AND c.command_type = 'execution.expire_run'
            AND clock_timestamp() >= NEW.execution_deadline
            AND NEW.result_ref IS NOT DISTINCT FROM OLD.result_ref)) THEN
    RAISE EXCEPTION 'unsupported final Run transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $guard$;

CREATE TRIGGER agent_result_guard BEFORE INSERT OR UPDATE OR DELETE
  ON task_execution.agent_result FOR EACH ROW EXECUTE FUNCTION task_execution.guard_final_insert();
CREATE TRIGGER final_claim_guard BEFORE INSERT OR UPDATE OR DELETE
  ON task_execution.run_final_submission_claim FOR EACH ROW
  EXECUTE FUNCTION task_execution.guard_final_claim();
CREATE TRIGGER validation_bundle_guard BEFORE INSERT OR UPDATE OR DELETE
  ON task_execution.result_validation_bundle FOR EACH ROW
  EXECUTE FUNCTION task_execution.guard_final_insert();
CREATE TRIGGER validation_fact_guard BEFORE INSERT OR UPDATE OR DELETE
  ON task_execution.result_validation_fact FOR EACH ROW
  EXECUTE FUNCTION task_execution.guard_final_insert();
CREATE TRIGGER acceptance_guard BEFORE INSERT OR UPDATE OR DELETE
  ON task_execution.agent_result_acceptance FOR EACH ROW
  EXECUTE FUNCTION task_execution.guard_final_insert();

GRANT SELECT, INSERT ON task_execution.agent_result,
  task_execution.run_final_submission_claim, task_execution.result_validation_bundle,
  task_execution.result_validation_fact, task_execution.agent_result_acceptance
  TO task_execution_app;
GRANT UPDATE ON task_execution.work_order_run_claim TO task_execution_app;
REVOKE UPDATE, DELETE ON task_execution.agent_result,
  task_execution.run_final_submission_claim, task_execution.result_validation_bundle,
  task_execution.result_validation_fact, task_execution.agent_result_acceptance
  FROM task_execution_app;

ALTER TABLE task_execution.agent_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.agent_result FORCE ROW LEVEL SECURITY;
CREATE POLICY final_result_select ON task_execution.agent_result FOR SELECT TO task_execution_app
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY final_result_insert ON task_execution.agent_result FOR INSERT TO task_execution_app
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY final_result_owner ON task_execution.agent_result FOR ALL TO task_execution_owner
  USING (true) WITH CHECK (true);
ALTER TABLE task_execution.run_final_submission_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.run_final_submission_claim FORCE ROW LEVEL SECURITY;
CREATE POLICY final_claim_select ON task_execution.run_final_submission_claim FOR SELECT TO task_execution_app
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY final_claim_insert ON task_execution.run_final_submission_claim FOR INSERT TO task_execution_app
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY final_claim_owner ON task_execution.run_final_submission_claim FOR ALL TO task_execution_owner
  USING (true) WITH CHECK (true);
ALTER TABLE task_execution.result_validation_bundle ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.result_validation_bundle FORCE ROW LEVEL SECURITY;
CREATE POLICY result_bundle_select ON task_execution.result_validation_bundle FOR SELECT TO task_execution_app
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY result_bundle_insert ON task_execution.result_validation_bundle FOR INSERT TO task_execution_app
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY result_bundle_owner ON task_execution.result_validation_bundle FOR ALL TO task_execution_owner
  USING (true) WITH CHECK (true);
ALTER TABLE task_execution.result_validation_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.result_validation_fact FORCE ROW LEVEL SECURITY;
CREATE POLICY result_fact_select ON task_execution.result_validation_fact FOR SELECT TO task_execution_app
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY result_fact_insert ON task_execution.result_validation_fact FOR INSERT TO task_execution_app
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY result_fact_owner ON task_execution.result_validation_fact FOR ALL TO task_execution_owner
  USING (true) WITH CHECK (true);
ALTER TABLE task_execution.agent_result_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.agent_result_acceptance FORCE ROW LEVEL SECURITY;
CREATE POLICY result_acceptance_select ON task_execution.agent_result_acceptance FOR SELECT TO task_execution_app
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY result_acceptance_insert ON task_execution.agent_result_acceptance FOR INSERT TO task_execution_app
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY result_acceptance_owner ON task_execution.agent_result_acceptance FOR ALL TO task_execution_owner
  USING (true) WITH CHECK (true);
CREATE POLICY final_claim_update ON task_execution.work_order_run_claim FOR UPDATE TO task_execution_app
  USING (platform_security.context_allows_project(enterprise_id, project_id))
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
RESET ROLE;
