-- IM-06 #244: Human Run cancellation, lease-expiry abandonment and late-final
-- isolation. Forward-only; extends the owned task_execution shapes and adds the
-- immutable cancellation Intent. Applied migrations V3000-V3010/V7005-V7012 are
-- not modified.
SET ROLE task_execution_owner;

-- ---------------------------------------------------------------------------
-- 1. Run status vocabulary: legal CANCELLING / ABANDONED shapes.
--    CANCELLING mirrors the RUNNING shape (started, no result/acceptance/end);
--    ABANDONED mirrors the TIMED_OUT shape with the cancellation reason.
-- ---------------------------------------------------------------------------
ALTER TABLE task_execution.run
  DROP CONSTRAINT run_status_check,
  DROP CONSTRAINT run_status_shape,
  ADD CONSTRAINT run_status_check CHECK (status IN
    ('CREATED', 'STARTING', 'RUNNING', 'RESULT_RECORDED', 'SUCCEEDED', 'TIMED_OUT',
     'CANCELLING', 'ABANDONED')),
  ADD CONSTRAINT run_status_shape CHECK (
    (status IN ('CREATED', 'STARTING') AND started_at IS NULL
      AND start_attempt_ref IS NULL AND runtime_adapter_identity_ref IS NULL
      AND result_ref IS NULL AND acceptance_ref IS NULL AND ended_at IS NULL)
    OR (status IN ('RUNNING', 'CANCELLING') AND started_at IS NOT NULL
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
      AND termination_reason = 'EXECUTION_DEADLINE_EXCEEDED')
    OR (status = 'ABANDONED' AND ended_at IS NOT NULL
      AND acceptance_ref IS NULL
      AND termination_reason = 'EXECUTION_CANCELLATION_UNACKNOWLEDGED'));

-- ---------------------------------------------------------------------------
-- 2. Run transition whitelist: RUNNING -> CANCELLING (Human Intent) and
--    CANCELLING -> ABANDONED (@2.0 LEASE_EXPIRED after the original lease).
-- ---------------------------------------------------------------------------
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
          OR (OLD.status = 'RUNNING' AND NEW.status = 'CANCELLING'
            AND c.command_type = 'execution.request_run_cancel'
            AND c.command_version = '1.0'
            AND clock_timestamp() < NEW.execution_deadline
            AND clock_timestamp() < NEW.lease_expires_at
            AND NEW.result_ref IS NULL AND NEW.acceptance_ref IS NULL
            AND NEW.ended_at IS NULL)
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
            AND NEW.result_ref IS NOT DISTINCT FROM OLD.result_ref)
          OR (OLD.status = 'CANCELLING' AND NEW.status = 'ABANDONED'
            AND c.command_type = 'execution.expire_run'
            AND c.command_version = '2.0'
            AND clock_timestamp() >= NEW.lease_expires_at
            AND NEW.ended_at IS NOT NULL
            AND NEW.termination_reason = 'EXECUTION_CANCELLATION_UNACKNOWLEDGED'
            AND NEW.result_ref IS NOT DISTINCT FROM OLD.result_ref)) THEN
    RAISE EXCEPTION 'unsupported final Run transition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $guard$;

-- ---------------------------------------------------------------------------
-- 3. Claim terminal guard: ABANDONED expires the original ACTIVE claim.
--    CANCELLING deliberately keeps the claim ACTIVE.
-- ---------------------------------------------------------------------------
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
            OR (NEW.status = 'EXPIRED' AND r.status IN ('TIMED_OUT', 'ABANDONED')
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

-- ---------------------------------------------------------------------------
-- 4. Budget closure: a legitimate ABANDONED terminal consumes exactly one
--    original reservation with the existing elapsed-to-effective-bound formula.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION task_execution.guard_recovery_budget() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE r task_execution.run%ROWTYPE;
DECLARE c task_execution.command_receipt%ROWTYPE;
DECLARE reservation task_execution.run_budget_reservation%ROWTYPE;
DECLARE contract jsonb;
DECLARE total integer;
DECLARE consumed integer;
BEGIN
 IF (TG_OP<>'INSERT') IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'budget fact is immutable' USING ERRCODE='55000'; END IF;
 SELECT * INTO r FROM task_execution.run WHERE run_id=NEW.run_id;
 SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=NEW.source_command_id;
 SELECT w.canonical_payload INTO contract FROM task_execution.work_order_contract w WHERE w.contract_id::text=r.work_order_contract_ref->>'objectId';
 IF (c.outcome IS DISTINCT FROM 'PENDING' OR c.target_id IS DISTINCT FROM r.run_id OR c.target_type<>'execution.run'
  OR c.enterprise_id<>NEW.enterprise_id OR c.project_id<>NEW.project_id OR c.created_by_principal_id<>platform_security.context_principal_id()
  OR r.enterprise_id<>NEW.enterprise_id OR r.project_id<>NEW.project_id OR (contract->'executionPolicy'->>'maxAttempts')::integer<>2) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'budget binding mismatch' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='run_budget_reservation' THEN
  total:=substring(contract->'budget'->>'wallClockLimit' from '^PT([1-9][0-9]*)S$')::integer;
  SELECT coalesce(sum(b.consumed_seconds),0) INTO consumed FROM task_execution.run_budget_consumption b JOIN task_execution.run x USING(run_id) WHERE x.work_order_id=r.work_order_id;
  IF (c.command_type<>'execution.create_run' OR NEW.work_order_id<>r.work_order_id OR NEW.attempt_number<>r.attempt_number
   OR NEW.total_seconds IS DISTINCT FROM total OR NEW.reserved_seconds<>total-consumed OR r.execution_deadline>r.created_at+make_interval(secs=>NEW.reserved_seconds)) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'cumulative budget reservation mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO reservation FROM task_execution.run_budget_reservation WHERE run_id=r.run_id;
  IF (r.status NOT IN('SUCCEEDED','TIMED_OUT','ABANDONED') OR c.command_type NOT IN('execution.finalize_run_from_acceptance','execution.expire_run')
   OR NEW.ended_at IS DISTINCT FROM r.ended_at OR NEW.effective_bound IS DISTINCT FROM least(r.ended_at,r.execution_deadline,r.lease_expires_at)
   OR NEW.consumed_seconds IS DISTINCT FROM least(reservation.reserved_seconds,greatest(0,ceil(extract(epoch FROM (NEW.effective_bound-r.created_at)))::integer))) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'budget consumption mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $guard$;

CREATE OR REPLACE FUNCTION task_execution.guard_recovery_run_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE r task_execution.run%ROWTYPE; contract jsonb;
BEGIN
 SELECT * INTO r FROM task_execution.run WHERE run_id=NEW.run_id;
 SELECT canonical_payload INTO contract FROM task_execution.work_order_contract WHERE contract_id::text=r.work_order_contract_ref->>'objectId';
 IF (contract->'executionPolicy'->>'maxAttempts')::integer=2 THEN
  IF NOT EXISTS(SELECT 1 FROM task_execution.run_budget_reservation b WHERE b.run_id=r.run_id AND b.work_order_id=r.work_order_id AND b.attempt_number=r.attempt_number)
   OR (r.attempt_number=2 AND NOT EXISTS(SELECT 1 FROM task_execution.run_retry_intent_consumption c JOIN task_execution.work_order_retry_intent i USING(intent_id) WHERE c.run_id=r.run_id AND i.work_order_id=r.work_order_id))
   OR (r.status IN('SUCCEEDED','TIMED_OUT','ABANDONED') AND NOT EXISTS(SELECT 1 FROM task_execution.run_budget_consumption c WHERE c.run_id=r.run_id))
  THEN RAISE EXCEPTION 'Recovery Run has incomplete budget or intent facts' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $guard$;

-- ---------------------------------------------------------------------------
-- 5. Final request mirror: the @2.0 expire receipt is the only new source
--    version, and ABANDONED mirrors the LEASE_EXPIRED request.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION task_execution.guard_final_request_mirror() RETURNS trigger
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
  IF c.command_version IS DISTINCT FROM '1.0'
     AND NOT (c.command_type = 'execution.expire_run' AND c.command_version = '2.0') THEN
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
      WHEN NEW.status='ABANDONED' THEN jsonb_build_object('reason','LEASE_EXPIRED')
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

DROP TRIGGER final_request_mirror_guard ON task_execution.run;
CREATE TRIGGER final_request_mirror_guard BEFORE UPDATE ON task_execution.run
  FOR EACH ROW WHEN (NEW.status IN ('RESULT_RECORDED','SUCCEEDED','TIMED_OUT','ABANDONED'))
  EXECUTE FUNCTION task_execution.guard_final_request_mirror();

-- ---------------------------------------------------------------------------
-- 6. Immutable cancellation Intent (one per Run).
-- ---------------------------------------------------------------------------
CREATE TABLE task_execution.run_cancellation_intent (
  intent_id uuid PRIMARY KEY,
  run_id uuid NOT NULL UNIQUE,
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  reason jsonb NOT NULL CHECK (jsonb_typeof(reason) = 'object'),
  requested_at timestamptz NOT NULL,
  committed_at timestamptz NOT NULL,
  cancellation_policy_ref jsonb NOT NULL,
  source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
  request_payload_hash bytea NOT NULL CHECK (octet_length(request_payload_hash) = 32),
  principal_id uuid NOT NULL,
  actor_snapshot_id uuid NOT NULL,
  authorization_decision_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  canonical_payload jsonb NOT NULL,
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_cancellation_intent_run_fk
    FOREIGN KEY (enterprise_id, project_id, run_id)
    REFERENCES task_execution.run (enterprise_id, project_id, run_id)
);

CREATE FUNCTION task_execution.guard_run_cancellation_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE;
DECLARE r task_execution.run%ROWTYPE;
DECLARE contract jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Run cancellation intent is immutable' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO c FROM task_execution.command_receipt WHERE command_id = NEW.source_command_id;
  SELECT * INTO r FROM task_execution.run WHERE run_id = NEW.run_id;
  IF r.run_id IS NULL THEN
    RAISE EXCEPTION 'Run cancellation intent target missing' USING ERRCODE = '22023';
  END IF;
  SELECT w.canonical_payload INTO contract FROM task_execution.work_order_contract w
    WHERE w.contract_id::text = r.work_order_contract_ref->>'objectId';
  IF (c.outcome IS DISTINCT FROM 'PENDING'
      OR c.command_type IS DISTINCT FROM 'execution.request_run_cancel'
      OR c.command_version IS DISTINCT FROM '1.0'
      OR c.target_type IS DISTINCT FROM 'execution.run'
      OR c.target_id IS DISTINCT FROM NEW.run_id
      OR c.enterprise_id IS DISTINCT FROM NEW.enterprise_id
      OR c.project_id IS DISTINCT FROM NEW.project_id
      OR c.created_by_principal_id IS DISTINCT FROM NEW.principal_id
      OR c.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
      OR c.authorization_decision_id IS DISTINCT FROM NEW.authorization_decision_id
      OR c.authorization_decision_id IS DISTINCT FROM
           (SELECT decision_id FROM platform_security.context_authorization_decision_ref())
      OR c.request_payload_hash IS DISTINCT FROM NEW.request_payload_hash
      -- The stored request fields must reproduce the authorized command
      -- payload, so a genuine Receipt hash cannot be copied onto a different
      -- reason/requestedAt/policy triple.
      OR c.request_payload_hash IS DISTINCT FROM sha256(convert_to(
           task_execution.canonical_jsonb_text(jsonb_build_object(
             'reason', NEW.reason,
             'requestedAt', NEW.canonical_payload->>'requestedAt',
             'cancellationPolicyRef', NEW.cancellation_policy_ref)), 'UTF8'))
      OR r.enterprise_id IS DISTINCT FROM NEW.enterprise_id
      OR r.project_id IS DISTINCT FROM NEW.project_id
      OR r.status IS DISTINCT FROM 'RUNNING'
      OR (contract->'executionPolicy'->>'maxAttempts')::integer IS DISTINCT FROM 2
      OR NOT EXISTS (SELECT 1 FROM task_execution.run_budget_reservation b
           WHERE b.run_id = r.run_id AND b.work_order_id = r.work_order_id
             AND b.attempt_number = r.attempt_number)
      OR NEW.cancellation_policy_ref IS DISTINCT FROM
           contract->'executionPolicy'->'cancellationPolicyRef'
      OR NEW.canonical_payload->'reason' IS DISTINCT FROM NEW.reason
      OR NEW.canonical_payload->'cancellationPolicyRef' IS DISTINCT FROM NEW.cancellation_policy_ref
      OR NEW.canonical_payload->>'requestedAt' IS NULL
      OR NEW.requested_at IS DISTINCT FROM (NEW.canonical_payload->>'requestedAt')::timestamptz
      OR NEW.canonical_payload->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text
      OR NEW.canonical_payload->>'projectId' IS DISTINCT FROM NEW.project_id::text
      OR NEW.canonical_payload->>'runId' IS DISTINCT FROM NEW.run_id::text
      OR NEW.canonical_payload->>'sourceCommandId' IS DISTINCT FROM NEW.source_command_id::text
      OR NEW.canonical_payload->>'requestPayloadHash' IS DISTINCT FROM
           encode(NEW.request_payload_hash, 'hex')
      OR NEW.canonical_payload->>'principalId' IS DISTINCT FROM NEW.principal_id::text
      OR NEW.canonical_payload->>'actorSnapshotId' IS DISTINCT FROM NEW.actor_snapshot_id::text
      -- The ActorSnapshot attribution must come from the authentic source and
      -- the trusted transaction context, not from a self-consistent mirror.
      OR NEW.actor_snapshot_id IS DISTINCT FROM c.actor_snapshot_id
      OR NEW.actor_snapshot_id IS DISTINCT FROM platform_security.context_actor_snapshot_id()
      OR NEW.canonical_payload->>'authorizationDecisionId' IS DISTINCT FROM
           NEW.authorization_decision_id::text
      OR NEW.canonical_payload->>'committedAt' IS NULL
      OR NEW.committed_at IS DISTINCT FROM (NEW.canonical_payload->>'committedAt')::timestamptz
      OR NEW.payload_hash IS DISTINCT FROM
           sha256(convert_to(task_execution.canonical_jsonb_text(NEW.canonical_payload), 'UTF8')))
     IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'Run cancellation intent source mismatch' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION task_execution.guard_run_cancellation_intent() FROM PUBLIC;

CREATE TRIGGER run_cancellation_intent_guard
  BEFORE INSERT OR UPDATE OR DELETE ON task_execution.run_cancellation_intent
  FOR EACH ROW EXECUTE FUNCTION task_execution.guard_run_cancellation_intent();

GRANT SELECT, INSERT ON task_execution.run_cancellation_intent TO task_execution_app;
REVOKE UPDATE, DELETE ON task_execution.run_cancellation_intent FROM task_execution_app;

ALTER TABLE task_execution.run_cancellation_intent ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.run_cancellation_intent FORCE ROW LEVEL SECURITY;
CREATE POLICY run_cancellation_intent_select ON task_execution.run_cancellation_intent
  FOR SELECT TO task_execution_app
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY run_cancellation_intent_insert ON task_execution.run_cancellation_intent
  FOR INSERT TO task_execution_app
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY run_cancellation_intent_owner ON task_execution.run_cancellation_intent
  FOR ALL TO task_execution_owner USING (true) WITH CHECK (true);

-- The SECURITY DEFINER intent guard reads the frozen WorkOrder contract as the
-- schema owner; FORCE RLS requires an explicit owner read policy (as V3007 did
-- for command_receipt and run).
CREATE POLICY run_cancellation_contract_owner_select ON task_execution.work_order_contract
  FOR SELECT TO task_execution_owner USING (true);
RESET ROLE;
