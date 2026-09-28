-- Bounded recovery retains immutable command bytes before target invocation.
SET ROLE task_execution_owner;
ALTER TABLE task_execution.process_instance ADD COLUMN recovery_source_ref jsonb;
ALTER TABLE task_execution.process_instance ADD COLUMN recovery_proposal_id uuid;
ALTER TABLE task_execution.process_instance ADD COLUMN recovery_step integer;
ALTER TABLE task_execution.process_instance ADD COLUMN last_recovery_command_id uuid REFERENCES task_execution.command_receipt(command_id);
ALTER TABLE task_execution.process_instance ADD CONSTRAINT blocked_input_process_shape CHECK (
 process_type <> 'blocked-input-recovery@1' OR (project_id IS NOT NULL AND recovery_source_ref IS NOT NULL
 AND recovery_source_ref->>'kind'='CONTENT_ADDRESSED' AND recovery_source_ref->>'objectType'='execution.agent_result'
 AND recovery_proposal_id IS NOT NULL AND recovery_step BETWEEN 0 AND 13 AND last_recovery_command_id IS NOT NULL));
CREATE FUNCTION task_execution.guard_blocked_input_process() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE c task_execution.command_receipt; cp jsonb; a task_execution.agent_result; r task_execution.run;
BEGIN
 IF NEW.process_type<>'blocked-input-recovery@1' THEN RETURN NEW; END IF;
 SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=NEW.last_recovery_command_id;
 SELECT request_payload INTO cp FROM task_execution.recovery_command_material WHERE command_id=c.command_id;
 SELECT * INTO a FROM task_execution.agent_result WHERE result_id::text=NEW.recovery_source_ref->>'objectId';
 SELECT * INTO r FROM task_execution.run WHERE run_id=a.run_id;
 IF (c.outcome IS DISTINCT FROM 'PENDING' OR c.command_type IS DISTINCT FROM 'execution.process.recovery_progress' OR c.command_version IS DISTINCT FROM '1.0'
  OR c.target_type IS DISTINCT FROM 'ProcessInstance' OR c.target_id IS DISTINCT FROM NEW.process_id
  OR c.enterprise_id IS DISTINCT FROM NEW.enterprise_id OR c.project_id IS DISTINCT FROM NEW.project_id
  OR c.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id() OR platform_security.context_principal_kind() IS DISTINCT FROM 'SERVICE'
  OR c.authorization_decision_id IS DISTINCT FROM (SELECT decision_id FROM platform_security.context_authorization_decision_ref())
  OR NEW.recovery_source_ref IS DISTINCT FROM task_execution.recovery_ref('CONTENT_ADDRESSED','execution.agent_result',a.result_id,NEW.enterprise_id,NEW.project_id,a.result_payload_hash)
  OR r.status IS DISTINCT FROM 'SUCCEEDED' OR a.result_payload->>'executionOutcome' IS DISTINCT FROM 'BLOCKED_INPUT'
  OR NOT EXISTS(SELECT 1 FROM task_execution.agent_result_acceptance ac WHERE ac.result_id=a.result_id AND ac.canonical_payload->>'disposition'='ACCEPTED')
  OR NOT EXISTS(SELECT 1 FROM task_execution.run_final_submission_claim fc WHERE fc.result_id=a.result_id AND fc.run_id=r.run_id)
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.result_payload->'inputRequestProposals') p WHERE p->>'proposalId'=NEW.recovery_proposal_id::text)) IS DISTINCT FROM FALSE
 THEN RAISE EXCEPTION 'invalid blocked input Process authority or source' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF (NEW.state IS DISTINCT FROM 'ACTIVE' OR NEW.aggregate_version<>1 OR NEW.recovery_step<>0
   OR cp IS DISTINCT FROM jsonb_build_object('sourceRef',NEW.recovery_source_ref,'proposalId',NEW.recovery_proposal_id::text)) IS DISTINCT FROM FALSE
  THEN RAISE EXCEPTION 'invalid blocked input Process creation' USING ERRCODE='23514'; END IF;
 ELSE
  IF ((NEW.process_id,NEW.process_type,NEW.process_version,NEW.correlation_key,NEW.enterprise_id,NEW.project_id,NEW.created_by_principal_id,NEW.created_at,NEW.recovery_source_ref,NEW.recovery_proposal_id) IS DISTINCT FROM (OLD.process_id,OLD.process_type,OLD.process_version,OLD.correlation_key,OLD.enterprise_id,OLD.project_id,OLD.created_by_principal_id,OLD.created_at,OLD.recovery_source_ref,OLD.recovery_proposal_id)
   OR OLD.state IS DISTINCT FROM 'ACTIVE' OR c.expected_aggregate_version IS DISTINCT FROM OLD.aggregate_version OR NEW.aggregate_version<>OLD.aggregate_version+1
   OR NOT ((NEW.recovery_step=OLD.recovery_step+1 AND NEW.state=CASE WHEN NEW.recovery_step=13 THEN 'COMPLETED' ELSE 'ACTIVE' END AND (cp->>'step')::integer=OLD.recovery_step AND EXISTS(SELECT 1 FROM task_execution.recovery_process_command m WHERE m.process_id=OLD.process_id AND m.step_no=OLD.recovery_step AND m.stable_idempotency_key=cp->>'stableIdempotencyKey'))
    OR (NEW.recovery_step=OLD.recovery_step AND NEW.state='SUSPENDED' AND cp->>'suspendReason'=NEW.blocked_reason_code AND NEW.blocked_reason_code IN('AUTHORIZATION_DECISION_INVALID','AUTHORIZATION_REVOKED','AUTHORIZATION_DECISION_EXPIRED','POLICY_EXPIRED','EXECUTION_WORK_ORDER_EXPIRED','EXECUTION_WORK_ORDER_BUDGET_EXHAUSTED','EXECUTION_CONTEXT_SOURCE_INVALID','EXECUTION_CONTEXT_TARGET_INVALID')))) IS DISTINCT FROM FALSE
  THEN RAISE EXCEPTION 'invalid blocked input Process CAS' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER blocked_input_process_guard BEFORE INSERT OR UPDATE ON task_execution.process_instance FOR EACH ROW EXECUTE FUNCTION task_execution.guard_blocked_input_process();
REVOKE ALL ON FUNCTION task_execution.guard_blocked_input_process() FROM PUBLIC;
CREATE TABLE task_execution.recovery_process_command (
 process_id uuid NOT NULL REFERENCES task_execution.process_instance(process_id),
 step_no integer NOT NULL CHECK(step_no BETWEEN 0 AND 12),
 enterprise_id uuid NOT NULL, project_id uuid NOT NULL,
 command_bytes jsonb NOT NULL, payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 stable_idempotency_key text NOT NULL, source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
 PRIMARY KEY(process_id,step_no), UNIQUE(process_id,stable_idempotency_key));
CREATE FUNCTION task_execution.guard_recovery_process_command() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
 SET search_path=pg_catalog,task_execution AS $$
DECLARE p task_execution.process_instance; c task_execution.command_receipt;
BEGIN
 SELECT * INTO p FROM task_execution.process_instance WHERE process_id=NEW.process_id;
 SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=NEW.source_command_id;
 IF (p.process_type IS DISTINCT FROM 'blocked-input-recovery@1' OR p.enterprise_id<>NEW.enterprise_id OR p.project_id<>NEW.project_id
 OR p.recovery_step<>NEW.step_no OR c.command_type IS DISTINCT FROM 'execution.process.recovery_progress'
 OR c.target_type IS DISTINCT FROM 'ProcessInstance' OR c.target_id<>NEW.process_id OR platform_security.context_principal_kind()<>'SERVICE'
 OR c.outcome IS DISTINCT FROM 'PENDING' OR c.enterprise_id<>NEW.enterprise_id OR c.project_id<>NEW.project_id
 OR NEW.payload_hash<>task_execution.recovery_payload_hash(NEW.command_bytes->'payload')
 OR (CASE WHEN NEW.step_no=4 THEN NEW.command_bytes->>'queryType' IS DISTINCT FROM 'execution.get_work_order_execution_state' OR NEW.command_bytes ? 'commandType' OR NEW.command_bytes ? 'idempotencyKey' ELSE NEW.command_bytes->>'idempotencyKey' IS DISTINCT FROM NEW.stable_idempotency_key END)
 OR NEW.command_bytes->'scopeRef' IS DISTINCT FROM jsonb_build_object('enterpriseId',NEW.enterprise_id,'projectId',NEW.project_id)
 OR NEW.stable_idempotency_key IS DISTINCT FROM 'blocked-input-recovery:'||(p.recovery_source_ref->>'objectId')||':'||
 (p.recovery_source_ref->'contentHash'->>'digest')||':'||p.recovery_proposal_id::text||':'||NEW.step_no::text) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'invalid recovery command material' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recovery_process_command_creation BEFORE INSERT ON task_execution.recovery_process_command
 FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_process_command();
CREATE TRIGGER recovery_process_command_immutable BEFORE UPDATE OR DELETE ON task_execution.recovery_process_command
 FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_fact();
ALTER TABLE task_execution.recovery_process_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.recovery_process_command FORCE ROW LEVEL SECURITY;
CREATE POLICY recovery_process_command_project ON task_execution.recovery_process_command TO task_execution_app
 USING(platform_security.context_allows_project(enterprise_id,project_id)) WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id));
CREATE POLICY recovery_process_command_owner ON task_execution.recovery_process_command TO task_execution_owner USING(true) WITH CHECK(true);
REVOKE UPDATE,DELETE ON task_execution.recovery_process_command FROM task_execution_app;
GRANT SELECT,INSERT ON task_execution.recovery_process_command TO task_execution_app;
REVOKE ALL ON FUNCTION task_execution.guard_recovery_process_command() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER recovery_process_command_committed AFTER INSERT ON task_execution.recovery_process_command
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_committed_receipt();
CREATE FUNCTION task_execution.guard_blocked_input_process_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.process_type='blocked-input-recovery@1' THEN
  IF NOT EXISTS(SELECT 1 FROM task_execution.command_receipt c WHERE c.command_id=NEW.last_recovery_command_id AND c.outcome='COMMITTED' AND c.enterprise_id=NEW.enterprise_id AND c.project_id=NEW.project_id)
   OR (TG_OP='UPDATE' AND NEW.recovery_step>OLD.recovery_step AND NOT EXISTS(
    SELECT 1 FROM task_execution.process_step s JOIN task_execution.recovery_process_command m ON m.process_id=s.process_id AND m.step_no=s.step_no-1
    WHERE s.process_id=NEW.process_id AND s.step_no=NEW.recovery_step AND s.outcome='COMPLETED'
     AND s.enterprise_id=NEW.enterprise_id AND s.project_id=NEW.project_id AND s.source_fact_ref=NEW.recovery_source_ref
     AND s.stable_idempotency_key=m.stable_idempotency_key
     AND s.issued_command_type=coalesce(m.command_bytes->>'commandType',m.command_bytes->>'queryType')
     AND (CASE WHEN m.step_no=4 THEN s.issued_command_id IS NULL ELSE s.issued_command_id::text=m.command_bytes->>'commandId' END)))
  THEN RAISE EXCEPTION 'Recovery Process has incomplete committed progress' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER blocked_input_process_complete AFTER INSERT OR UPDATE ON task_execution.process_instance
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_execution.guard_blocked_input_process_complete();
REVOKE ALL ON FUNCTION task_execution.guard_blocked_input_process_complete() FROM PUBLIC;
RESET ROLE;
