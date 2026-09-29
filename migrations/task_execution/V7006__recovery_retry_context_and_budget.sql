-- Bounded retry intent, Context binding, cumulative reservations and Root coordination.
SET ROLE task_execution_owner;
CREATE TABLE task_execution.work_order_retry_intent (
 intent_id uuid PRIMARY KEY, work_order_id uuid NOT NULL, next_attempt_number integer NOT NULL CHECK(next_attempt_number=2),
 enterprise_id uuid NOT NULL,project_id uuid NOT NULL,
 canonical_payload jsonb NOT NULL,payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
 UNIQUE(work_order_id,next_attempt_number),UNIQUE(enterprise_id,project_id,intent_id),
 FOREIGN KEY(enterprise_id,project_id,work_order_id) REFERENCES task_execution.work_order(enterprise_id,project_id,work_order_id)
);
CREATE TABLE task_execution.run_retry_intent_consumption (
 intent_id uuid PRIMARY KEY,run_id uuid NOT NULL UNIQUE,
 enterprise_id uuid NOT NULL,project_id uuid NOT NULL,
 canonical_payload jsonb NOT NULL,payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
 FOREIGN KEY(enterprise_id,project_id,intent_id) REFERENCES task_execution.work_order_retry_intent(enterprise_id,project_id,intent_id),
 FOREIGN KEY(enterprise_id,project_id,run_id) REFERENCES task_execution.run(enterprise_id,project_id,run_id)
);
CREATE TABLE task_execution.run_budget_reservation (
 run_id uuid PRIMARY KEY,work_order_id uuid NOT NULL,attempt_number integer NOT NULL CHECK(attempt_number IN(1,2)),
 reserved_seconds integer NOT NULL CHECK(reserved_seconds>0),total_seconds integer NOT NULL CHECK(total_seconds>0),
 enterprise_id uuid NOT NULL,project_id uuid NOT NULL,
 source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
 FOREIGN KEY(enterprise_id,project_id,run_id) REFERENCES task_execution.run(enterprise_id,project_id,run_id),
 FOREIGN KEY(enterprise_id,project_id,work_order_id) REFERENCES task_execution.work_order(enterprise_id,project_id,work_order_id),
 CHECK(reserved_seconds<=total_seconds)
);
CREATE TABLE task_execution.run_budget_consumption (
 run_id uuid PRIMARY KEY,ended_at timestamptz NOT NULL,effective_bound timestamptz NOT NULL,consumed_seconds integer NOT NULL CHECK(consumed_seconds>=0),
 enterprise_id uuid NOT NULL,project_id uuid NOT NULL,
 source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
 FOREIGN KEY(enterprise_id,project_id,run_id) REFERENCES task_execution.run(enterprise_id,project_id,run_id),
 FOREIGN KEY(run_id) REFERENCES task_execution.run_budget_reservation(run_id)
);
ALTER TABLE task_execution.run DROP CONSTRAINT run_attempt_number_check;
ALTER TABLE task_execution.run ADD CONSTRAINT run_attempt_number_check CHECK(attempt_number IN(1,2));
ALTER TABLE task_execution.work_order_run_claim DROP CONSTRAINT work_order_run_claim_attempt_number_check;
ALTER TABLE task_execution.work_order_run_claim ADD CONSTRAINT work_order_run_claim_attempt_number_check CHECK(attempt_number IN(1,2));
ALTER TABLE task_execution.task ADD COLUMN last_execution_command_id uuid REFERENCES task_execution.command_receipt(command_id);

CREATE FUNCTION task_execution.guard_recovery_budget() RETURNS trigger
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
  IF (r.status NOT IN('SUCCEEDED','TIMED_OUT') OR c.command_type NOT IN('execution.finalize_run_from_acceptance','execution.expire_run')
   OR NEW.ended_at IS DISTINCT FROM r.ended_at OR NEW.effective_bound IS DISTINCT FROM least(r.ended_at,r.execution_deadline,r.lease_expires_at)
   OR NEW.consumed_seconds IS DISTINCT FROM least(reservation.reserved_seconds,greatest(0,ceil(extract(epoch FROM (NEW.effective_bound-r.created_at)))::integer))) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'budget consumption mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER recovery_budget_reservation_guard BEFORE INSERT OR UPDATE OR DELETE ON task_execution.run_budget_reservation FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_budget();
CREATE TRIGGER recovery_budget_consumption_guard BEFORE INSERT OR UPDATE OR DELETE ON task_execution.run_budget_consumption FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_budget();

CREATE FUNCTION task_execution.guard_recovery_retry_fact() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE;
DECLARE r task_execution.run%ROWTYPE;
DECLARE i task_execution.work_order_retry_intent%ROWTYPE;
DECLARE cp jsonb;
BEGIN
 IF (TG_OP<>'INSERT') IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'retry fact is immutable' USING ERRCODE='55000'; END IF;
 SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=NEW.source_command_id;
 SELECT request_payload INTO cp FROM task_execution.recovery_command_material WHERE command_id=c.command_id;
 IF (c.outcome IS DISTINCT FROM 'PENDING' OR c.enterprise_id<>NEW.enterprise_id OR c.project_id<>NEW.project_id
  OR c.created_by_principal_id<>platform_security.context_principal_id()
  OR c.authorization_decision_id IS DISTINCT FROM (SELECT decision_id FROM platform_security.context_authorization_decision_ref())
  OR NEW.payload_hash<>task_execution.recovery_payload_hash(NEW.canonical_payload)) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'retry receipt or hash mismatch' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='work_order_retry_intent' THEN
  SELECT * INTO r FROM task_execution.run WHERE run_id::text=NEW.canonical_payload->'previousRunRef'->>'objectId';
  IF (c.command_type<>'execution.schedule_work_order_retry' OR c.target_id<>NEW.work_order_id OR platform_security.context_principal_kind()<>'HUMAN'
   OR NEW.canonical_payload - ARRAY['intentId','workOrderRef','workOrderContractRef','previousRunRef','sourceAgentResultRef','sourceAcceptanceRef','nextAttemptNumber','resolutionRefs','runtimeBinding','retryPolicyRef','budget','scheduledAt','scheduledBy','actorSnapshotRef','authorizationDecisionRef'] IS DISTINCT FROM '{}'::jsonb
   OR NEW.canonical_payload->'workOrderRef' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','zhiju.execution.work_order',NEW.work_order_id,NEW.enterprise_id,NEW.project_id)
   OR NEW.canonical_payload->'previousRunRef' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','execution.run',r.run_id,NEW.enterprise_id,NEW.project_id)
   OR NEW.canonical_payload->'scheduledBy' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','zhiju.identity.principal',c.created_by_principal_id,NEW.enterprise_id,NEW.project_id)
   OR NEW.canonical_payload->'actorSnapshotRef' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','zhiju.identity.actor_snapshot',c.actor_snapshot_id,NEW.enterprise_id,NEW.project_id)
   OR NEW.canonical_payload->'authorizationDecisionRef' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','zhiju.identity.authorization_decision',c.authorization_decision_id,NEW.enterprise_id,NEW.project_id)
   OR NEW.canonical_payload->'runtimeBinding' IS DISTINCT FROM r.runtime_binding
   OR NEW.canonical_payload->>'nextAttemptNumber' IS DISTINCT FROM '2'
   OR cp->>'retryReason' IS DISTINCT FROM 'BLOCKED_INPUT_RESOLVED'
   OR task_execution.recovery_work_order_blocked(NEW.work_order_id) IS DISTINCT FROM true
   OR EXISTS(SELECT 1 FROM task_execution.information_request q WHERE q.work_order_id=NEW.work_order_id AND (q.status<>'RESOLVED' OR NOT (NEW.canonical_payload->'resolutionRefs' @> jsonb_build_array(q.resolution_ref))))
   OR NOT EXISTS(SELECT 1 FROM task_execution.information_request q WHERE q.work_order_id=NEW.work_order_id AND q.status='RESOLVED' AND NEW.canonical_payload->'resolutionRefs'=jsonb_build_array(q.resolution_ref))
   OR r.status<>'SUCCEEDED' OR r.attempt_number<>1 OR r.work_order_id<>NEW.work_order_id
   OR NEW.canonical_payload->>'intentId'<>NEW.intent_id::text OR cp->'previousRunRef' IS DISTINCT FROM NEW.canonical_payload->'previousRunRef'
   OR cp->'retryPolicyRef' IS DISTINCT FROM NEW.canonical_payload->'retryPolicyRef' OR cp->>'nextAttemptNumber'<>'2'
   OR NEW.canonical_payload->'workOrderContractRef' IS DISTINCT FROM r.work_order_contract_ref
   OR NOT EXISTS(SELECT 1 FROM task_execution.work_order_run_claim x WHERE x.run_id=r.run_id AND x.status='RELEASED')
   OR NOT EXISTS(SELECT 1 FROM task_execution.agent_result a WHERE a.run_id=r.run_id AND a.result_payload->>'executionOutcome'='BLOCKED_INPUT')) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'retry intent source mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO r FROM task_execution.run WHERE run_id=NEW.run_id;
  SELECT * INTO i FROM task_execution.work_order_retry_intent WHERE intent_id=NEW.intent_id;
  IF (c.command_type<>'execution.create_run' OR c.target_id<>NEW.run_id OR r.attempt_number<>2 OR r.work_order_id<>i.work_order_id
   OR NEW.canonical_payload - ARRAY['intentId','runRef','contextSnapshotRef','workOrderContractRef','resolutionRefs'] IS DISTINCT FROM '{}'::jsonb
   OR NEW.canonical_payload->>'intentId' IS DISTINCT FROM NEW.intent_id::text
   OR NEW.canonical_payload->'runRef' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','execution.run',NEW.run_id,NEW.enterprise_id,NEW.project_id)
   OR NEW.canonical_payload->'contextSnapshotRef' IS DISTINCT FROM r.context_snapshot_ref
   OR NEW.canonical_payload->'workOrderContractRef' IS DISTINCT FROM r.work_order_contract_ref
   OR NEW.canonical_payload->'resolutionRefs' IS DISTINCT FROM i.canonical_payload->'resolutionRefs'
   OR NOT EXISTS(SELECT 1 FROM task_execution.context_snapshot_build b JOIN task_execution.context_snapshot s USING(snapshot_id)
     WHERE s.object_id::text=r.context_snapshot_ref->>'objectId' AND b.build_kind='FROZEN'
      AND b.canonical_payload->'recovery'->'resolutionRefs'=i.canonical_payload->'resolutionRefs')) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'retry consumption binding mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER recovery_intent_guard BEFORE INSERT OR UPDATE OR DELETE ON task_execution.work_order_retry_intent FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_retry_fact();
CREATE TRIGGER recovery_consumption_guard BEFORE INSERT OR UPDATE OR DELETE ON task_execution.run_retry_intent_consumption FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_retry_fact();

DO $body$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['work_order_retry_intent','run_retry_intent_consumption','run_budget_reservation','run_budget_consumption'] LOOP
  EXECUTE format('ALTER TABLE task_execution.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE task_execution.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY recovery_select ON task_execution.%I FOR SELECT TO task_execution_app USING(platform_security.context_allows_project(enterprise_id,project_id))',t);
  EXECUTE format('CREATE POLICY recovery_insert ON task_execution.%I FOR INSERT TO task_execution_app WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id))',t);
  EXECUTE format('CREATE POLICY recovery_owner ON task_execution.%I FOR ALL TO task_execution_owner USING(true) WITH CHECK(true)',t);
  EXECUTE format('REVOKE UPDATE,DELETE ON task_execution.%I FROM task_execution_app',t);
  EXECUTE format('GRANT SELECT,INSERT ON task_execution.%I TO task_execution_app',t);
 END LOOP;
END $body$;

CREATE FUNCTION task_execution.guard_recovery_run_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE r task_execution.run%ROWTYPE; contract jsonb;
BEGIN
 SELECT * INTO r FROM task_execution.run WHERE run_id=NEW.run_id;
 SELECT canonical_payload INTO contract FROM task_execution.work_order_contract WHERE contract_id::text=r.work_order_contract_ref->>'objectId';
 IF (contract->'executionPolicy'->>'maxAttempts')::integer=2 THEN
  IF NOT EXISTS(SELECT 1 FROM task_execution.run_budget_reservation b WHERE b.run_id=r.run_id AND b.work_order_id=r.work_order_id AND b.attempt_number=r.attempt_number)
   OR (r.attempt_number=2 AND NOT EXISTS(SELECT 1 FROM task_execution.run_retry_intent_consumption c JOIN task_execution.work_order_retry_intent i USING(intent_id) WHERE c.run_id=r.run_id AND i.work_order_id=r.work_order_id))
   OR (r.status IN('SUCCEEDED','TIMED_OUT') AND NOT EXISTS(SELECT 1 FROM task_execution.run_budget_consumption c WHERE c.run_id=r.run_id))
  THEN RAISE EXCEPTION 'Recovery Run has incomplete budget or intent facts' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $guard$;
CREATE CONSTRAINT TRIGGER recovery_run_complete AFTER INSERT OR UPDATE ON task_execution.run DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_run_complete();
DO $body$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['work_order_retry_intent','run_retry_intent_consumption','run_budget_reservation','run_budget_consumption'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER recovery_committed_receipt AFTER INSERT ON task_execution.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_committed_receipt()',t);
 END LOOP;
END $body$;
REVOKE ALL ON FUNCTION task_execution.guard_recovery_run_complete() FROM PUBLIC;

ALTER TABLE task_execution.context_snapshot_build ALTER COLUMN draft_snapshot_ref DROP NOT NULL;
ALTER TABLE task_execution.context_snapshot_build DROP CONSTRAINT context_snapshot_build_kind_closed;
ALTER TABLE task_execution.context_snapshot_build DROP CONSTRAINT context_snapshot_build_frozen_contract_absent;
ALTER TABLE task_execution.context_snapshot_build DROP CONSTRAINT context_snapshot_build_ref_shape;
ALTER TABLE task_execution.context_snapshot_build DROP CONSTRAINT context_snapshot_build_payload_shape;
ALTER TABLE task_execution.context_snapshot_build ADD CONSTRAINT context_snapshot_build_kind_closed CHECK(
 (build_kind='INITIAL' AND draft_snapshot_ref IS NOT NULL AND frozen_contract_ref IS NULL)
 OR (build_kind='FROZEN' AND draft_snapshot_ref IS NULL AND frozen_contract_ref IS NOT NULL));
ALTER TABLE task_execution.context_snapshot_build ADD CONSTRAINT context_snapshot_build_ref_shape CHECK(
 jsonb_typeof(audience)='object' AND jsonb_typeof(builder_policy_ref)='object'
 AND (build_kind='INITIAL' OR jsonb_typeof(canonical_payload->'recovery')='object'));

CREATE FUNCTION task_execution.assert_frozen_build(b task_execution.context_snapshot_build) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE;
DECLARE s task_execution.context_snapshot%ROWTYPE;
DECLARE w task_execution.work_order%ROWTYPE;
DECLARE x task_execution.answer_resolution%ROWTYPE;
DECLARE q task_execution.information_request%ROWTYPE;
DECLARE recovery jsonb;
DECLARE rr jsonb;
BEGIN
 SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=b.source_command_id;
 SELECT * INTO s FROM task_execution.context_snapshot WHERE snapshot_id=b.snapshot_id;
 SELECT wo.* INTO w FROM task_execution.work_order wo JOIN task_execution.work_order_contract wc ON wc.work_order_id=wo.work_order_id WHERE wc.contract_id::text=b.frozen_contract_ref->>'objectId';
 recovery:=b.canonical_payload->'recovery';rr:=recovery->'resolutionRefs'->0;
 SELECT * INTO x FROM task_execution.answer_resolution WHERE resolution_id::text=rr->>'objectId';
 SELECT * INTO q FROM task_execution.information_request WHERE request_id=x.request_id;
 IF (c.command_type<>'execution.build_context_snapshot' OR c.command_version<>'1.1' OR c.outcome<>'PENDING'
  OR b.payload_hash IS DISTINCT FROM task_execution.recovery_payload_hash(b.canonical_payload)
  OR b.canonical_payload - ARRAY['buildKind','frozenContractRef','sliceRefs','purpose','audience','builderPolicyRef','policyContentHash','policyEffectiveFrom','policySupersededAt','requestExpiresAt','effectiveExpiresAt','inputRefObservations','scopeRef','recovery'] IS DISTINCT FROM '{}'::jsonb
  OR b.canonical_payload->>'buildKind' IS DISTINCT FROM 'FROZEN'
  OR b.canonical_payload->'frozenContractRef' IS DISTINCT FROM b.frozen_contract_ref
  OR b.canonical_payload->>'policyContentHash' IS DISTINCT FROM encode(b.policy_content_hash,'hex')
  OR (b.canonical_payload->>'policyEffectiveFrom')::timestamptz IS DISTINCT FROM b.policy_effective_from
  OR (b.canonical_payload->>'policySupersededAt')::timestamptz IS DISTINCT FROM b.policy_superseded_at
  OR (b.canonical_payload->>'requestExpiresAt')::timestamptz IS DISTINCT FROM b.request_expires_at
  OR (b.canonical_payload->>'effectiveExpiresAt')::timestamptz IS DISTINCT FROM b.effective_expires_at
  OR b.canonical_payload->'inputRefObservations' IS DISTINCT FROM '[]'::jsonb
  OR recovery - ARRAY['previousRunRef','sourceAgentResultRef','sourceAcceptanceRef','resolutionRefs','answerRefs','receiptRefs','receiptObservationHashes','requestAggregateVersions','sourceWatermarks'] IS DISTINCT FROM '{}'::jsonb
  OR b.purpose IS DISTINCT FROM b.canonical_payload->>'purpose' OR b.purpose IS DISTINCT FROM s.purpose
  OR b.audience IS DISTINCT FROM b.canonical_payload->'audience' OR b.audience->>'principalId' IS DISTINCT FROM s.audience
  OR b.builder_policy_ref IS DISTINCT FROM b.canonical_payload->'builderPolicyRef'
  OR b.slice_refs IS DISTINCT FROM b.canonical_payload->'sliceRefs'
  OR b.canonical_payload->'scopeRef' IS DISTINCT FROM jsonb_build_object('enterpriseId',b.enterprise_id,'projectId',b.project_id)
  OR recovery->'sourceWatermarks' IS DISTINCT FROM s.canonical_payload->'sourceWatermarks'
  OR recovery->'receiptObservationHashes' IS DISTINCT FROM jsonb_build_array(x.canonical_payload->'receiptAttestationHash')
  OR recovery->'requestAggregateVersions' IS DISTINCT FROM jsonb_build_array(jsonb_build_object('informationRequestRef',task_execution.recovery_ref('OBJECT','execution.information_request',q.request_id,q.enterprise_id,q.project_id),'aggregateVersion',q.aggregate_version))
  OR c.target_id<>s.object_id OR c.target_type<>'zhiju.execution.context_snapshot' OR s.source_command_id<>c.command_id
  OR s.enterprise_id<>b.enterprise_id OR s.project_id<>b.project_id OR c.request_payload_hash IS DISTINCT FROM b.request_payload_hash
  OR b.request_payload_hash IS DISTINCT FROM s.request_payload_hash OR b.effective_expires_at IS DISTINCT FROM s.effective_expires_at
  OR b.builder_policy_ref IS DISTINCT FROM s.canonical_payload->'projection'->'builderPolicyRef'
  OR w.status NOT IN('WAITING_INPUT','RETRY_PENDING') OR w.enterprise_id<>b.enterprise_id OR w.project_id<>b.project_id
  OR b.frozen_contract_ref IS DISTINCT FROM task_execution.recovery_ref('CONTENT_ADDRESSED','zhiju.contract.work_order',w.frozen_contract_id,w.enterprise_id,w.project_id,w.frozen_contract_hash)
  OR rr IS DISTINCT FROM q.resolution_ref OR q.status IS DISTINCT FROM 'RESOLVED' OR jsonb_array_length(recovery->'resolutionRefs')<>1
  OR recovery->'answerRefs' IS DISTINCT FROM jsonb_build_array(q.accepted_answer_ref)
  OR recovery->'receiptRefs' IS DISTINCT FROM x.canonical_payload->'domainCommandRefs'
  OR recovery->'previousRunRef' IS DISTINCT FROM x.canonical_payload->'previousRunRef'
  OR recovery->'sourceAgentResultRef' IS DISTINCT FROM x.canonical_payload->'sourceAgentResultRef'
  OR recovery->'sourceAcceptanceRef' IS DISTINCT FROM x.canonical_payload->'sourceAcceptanceRef'
  OR EXISTS(SELECT 1 FROM task_execution.work_order_run_claim a WHERE a.work_order_id=w.work_order_id AND a.status='ACTIVE')
  OR b.canonical_payload ? 'draftSnapshotRef') IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'FROZEN metadata binding mismatch' USING ERRCODE='23514'; END IF;
END $guard$;

-- Derive the complete local barrier set; a caller's trigger or request list
-- cannot hide a reserved final or an unresolved sibling Request.
CREATE FUNCTION task_execution.recovery_work_order_blocked(work_order uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $guard$
 SELECT EXISTS(SELECT 1 FROM task_execution.information_request q WHERE q.work_order_id=work_order AND q.status<>'RESOLVED')
 OR EXISTS(
  SELECT 1 FROM task_execution.agent_result a
  JOIN task_execution.run r ON r.run_id=a.run_id
  JOIN task_execution.run_final_submission_claim f ON f.result_id=a.result_id
  WHERE r.work_order_id=work_order AND a.result_payload->>'executionOutcome'='BLOCKED_INPUT'
  AND NOT EXISTS(
   SELECT 1 FROM task_execution.information_request_origin o
   JOIN task_execution.information_request q USING(request_id)
   JOIN task_execution.work_order_retry_intent ri ON ri.work_order_id=work_order
   JOIN task_execution.run_retry_intent_consumption ic ON ic.intent_id=ri.intent_id
   JOIN task_execution.run successor ON successor.run_id=ic.run_id
   JOIN task_execution.agent_result sa ON sa.run_id=successor.run_id
   JOIN task_execution.agent_result_acceptance ac ON ac.result_id=sa.result_id
   WHERE o.source_result_id=a.result_id AND q.status='RESOLVED'
    AND ic.canonical_payload->'resolutionRefs' @> jsonb_build_array(q.resolution_ref)
    AND successor.status='SUCCEEDED' AND sa.result_payload->>'executionOutcome'='COMPLETED'
    AND ac.canonical_payload->>'disposition'='ACCEPTED'))
$guard$;
REVOKE ALL ON FUNCTION task_execution.recovery_work_order_blocked(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION task_execution.recovery_work_order_blocked(uuid) TO task_execution_app;

CREATE OR REPLACE FUNCTION task_execution.guard_first_run_work_order_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
  IF ((NEW.queue_policy_ref,NEW.queued_at,NEW.requested_runtime_class,NEW.last_transition_command_id) IS DISTINCT FROM (OLD.queue_policy_ref,OLD.queued_at,OLD.requested_runtime_class,OLD.last_transition_command_id)) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'queue binding immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status='DRAFT' AND NEW.status='READY' THEN RETURN NEW; END IF;
 SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=NEW.last_transition_command_id;
 IF (c.outcome IS DISTINCT FROM 'PENDING' OR c.target_id<>NEW.work_order_id OR c.target_type<>'zhiju.execution.work_order'
  OR c.expected_aggregate_version IS DISTINCT FROM OLD.aggregate_version OR c.command_version<>'1.0'
  OR c.enterprise_id<>NEW.enterprise_id OR c.project_id<>NEW.project_id OR NEW.aggregate_version<>OLD.aggregate_version+1
  OR c.created_by_principal_id<>platform_security.context_principal_id()
  OR c.authorization_decision_id IS DISTINCT FROM (SELECT decision_id FROM platform_security.context_authorization_decision_ref())) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'WorkOrder transition command mismatch' USING ERRCODE='23514'; END IF;
 IF OLD.status='READY' AND NEW.status='QUEUED' AND c.command_type='execution.queue_work_order' THEN RETURN NEW; END IF;
 IF ((NEW.queue_policy_ref,NEW.queued_at,NEW.requested_runtime_class) IS DISTINCT FROM (OLD.queue_policy_ref,OLD.queued_at,OLD.requested_runtime_class)) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'queue binding immutable' USING ERRCODE='23514'; END IF;
 IF NEW.status='RETRY_PENDING' AND OLD.status='WAITING_INPUT' AND c.command_type='execution.schedule_work_order_retry'
  AND EXISTS(SELECT 1 FROM task_execution.work_order_retry_intent i WHERE i.work_order_id=NEW.work_order_id AND i.source_command_id=c.command_id)
 THEN RETURN NEW; END IF;
 IF c.command_type='execution.reconcile_work_order_execution' THEN
  IF NEW.status='RUNNING' AND OLD.status IN('QUEUED','RETRY_PENDING') AND EXISTS(SELECT 1 FROM task_execution.run r JOIN task_execution.work_order_run_claim a USING(run_id) WHERE r.work_order_id=NEW.work_order_id AND r.status='RUNNING' AND a.status='ACTIVE') THEN RETURN NEW; END IF;
  IF NEW.status='WAITING_INPUT' AND OLD.status IN('RUNNING','COMPLETION_PENDING') AND NOT EXISTS(SELECT 1 FROM task_execution.work_order_run_claim a WHERE a.work_order_id=NEW.work_order_id AND a.status='ACTIVE')
   AND task_execution.recovery_work_order_blocked(NEW.work_order_id) THEN RETURN NEW; END IF;
  IF NEW.status='COMPLETION_PENDING' AND OLD.status IN('RUNNING','WAITING_INPUT') AND NOT EXISTS(SELECT 1 FROM task_execution.work_order_run_claim a WHERE a.work_order_id=NEW.work_order_id AND a.status='ACTIVE')
   AND NOT task_execution.recovery_work_order_blocked(NEW.work_order_id)
   AND EXISTS(SELECT 1 FROM task_execution.run r WHERE r.work_order_id=NEW.work_order_id)
   AND NOT EXISTS(SELECT 1 FROM task_execution.run r WHERE r.work_order_id=NEW.work_order_id AND r.status<>'SUCCEEDED')
   AND EXISTS(SELECT 1 FROM task_execution.agent_result a JOIN task_execution.run r USING(run_id) JOIN task_execution.agent_result_acceptance ac ON ac.result_id=a.result_id WHERE r.work_order_id=NEW.work_order_id AND a.result_payload->>'executionOutcome'='COMPLETED' AND ac.canonical_payload->>'disposition'='ACCEPTED') THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'unsupported WorkOrder transition' USING ERRCODE='23514';
END $guard$;

CREATE FUNCTION task_execution.guard_recovery_task_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE; blocked boolean; active boolean; complete boolean; expected text;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status OR (OLD.status='DRAFT' AND NEW.status='READY') THEN RETURN NEW; END IF;
 SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=NEW.last_execution_command_id;
 IF (c.command_type IS DISTINCT FROM 'execution.reconcile_task_execution' OR c.target_type<>'zhiju.execution.task' OR c.target_id<>NEW.task_id
  OR c.outcome<>'PENDING' OR c.enterprise_id<>NEW.enterprise_id OR c.project_id<>NEW.project_id OR c.expected_aggregate_version<>OLD.aggregate_version
  OR c.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
  OR platform_security.context_principal_kind() IS DISTINCT FROM 'SERVICE'
  OR c.authorization_decision_id IS DISTINCT FROM (SELECT decision_id FROM platform_security.context_authorization_decision_ref())
  OR NOT EXISTS(SELECT 1 FROM task_execution.task_definition_snapshot d WHERE d.snapshot_id=NEW.current_definition_snapshot_id AND d.schema_version='2.0')
  OR NEW.aggregate_version<>OLD.aggregate_version+1 OR OLD.status IN('DRAFT','COMPLETED','CANCELLED') OR NEW.status NOT IN('IN_PROGRESS','WAITING_INPUT','COMPLETION_PENDING')) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Task execution transition mismatch' USING ERRCODE='23514'; END IF;
 SELECT EXISTS(SELECT 1 FROM task_execution.work_order w WHERE w.task_id=NEW.task_id
  AND task_execution.recovery_work_order_blocked(w.work_order_id)
  AND NOT EXISTS(SELECT 1 FROM task_execution.run r WHERE r.work_order_id=w.work_order_id AND r.status IN('CREATED','STARTING','RUNNING','RESULT_RECORDED'))) INTO blocked;
 SELECT EXISTS(SELECT 1 FROM task_execution.work_order w JOIN task_execution.run r USING(work_order_id) WHERE w.task_id=NEW.task_id AND r.status IN('CREATED','STARTING','RUNNING','RESULT_RECORDED')) INTO active;
 SELECT EXISTS(SELECT 1 FROM task_execution.work_order w WHERE w.task_id=NEW.task_id)
  AND NOT EXISTS(SELECT 1 FROM task_execution.work_order w WHERE w.task_id=NEW.task_id AND (
   task_execution.recovery_work_order_blocked(w.work_order_id)
   OR NOT EXISTS(SELECT 1 FROM task_execution.run r WHERE r.work_order_id=w.work_order_id)
   OR EXISTS(SELECT 1 FROM task_execution.run r WHERE r.work_order_id=w.work_order_id AND r.status<>'SUCCEEDED'))) INTO complete;
 expected:=CASE WHEN blocked THEN 'WAITING_INPUT' WHEN active THEN 'IN_PROGRESS' WHEN complete THEN 'COMPLETION_PENDING' ELSE OLD.status END;
 IF NEW.status IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Task execution transition hides an owning blocker' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER recovery_task_transition BEFORE UPDATE ON task_execution.task FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_task_transition();

CREATE OR REPLACE FUNCTION task_execution.guard_context_snapshot_creation_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
DECLARE
    receipt_found boolean;
    receipt_command_version text;
    receipt_target_type text;
    receipt_target_id uuid;
    receipt_enterprise_id uuid;
    receipt_project_id uuid;
    receipt_request_payload_hash bytea;
    receipt_outcome text;
    receipt_created_by_principal_id uuid;
    context_principal_id uuid;
    context_principal_kind text;
BEGIN
    SELECT r.command_version, r.target_type, r.target_id, r.enterprise_id,
           r.project_id, r.request_payload_hash, r.outcome,
           r.created_by_principal_id
      INTO receipt_command_version, receipt_target_type, receipt_target_id,
           receipt_enterprise_id, receipt_project_id,
           receipt_request_payload_hash, receipt_outcome,
           receipt_created_by_principal_id
      FROM task_execution.command_receipt r
     WHERE r.command_id = NEW.source_command_id
       AND r.command_type IN ('execution.build_initial_context_snapshot','execution.build_context_snapshot');
    receipt_found := FOUND;

    context_principal_id := platform_security.context_principal_id();
    context_principal_kind := platform_security.context_principal_kind();

    -- Source Receipt identity, its Project Scope and the request hash binding.
    IF (NOT receipt_found
       OR receipt_outcome IS DISTINCT FROM 'PENDING'
       OR receipt_command_version IS DISTINCT FROM '1.1'
       OR NEW.builder_version IS DISTINCT FROM receipt_command_version
       OR receipt_target_type IS DISTINCT FROM 'zhiju.execution.context_snapshot'
       OR receipt_target_id IS DISTINCT FROM NEW.object_id
       OR receipt_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR receipt_project_id IS DISTINCT FROM NEW.project_id
       OR receipt_request_payload_hash IS DISTINCT FROM NEW.request_payload_hash) IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'context snapshot creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;

    -- Ownership closure: the context principal id *and* kind are the only
    -- trusted anchor, and a NULL kind (legacy context) can never commit a
    -- Context Snapshot.
    IF (context_principal_kind IS NULL
       OR NEW.created_by_principal_id IS DISTINCT FROM context_principal_id
       OR receipt_created_by_principal_id IS DISTINCT FROM context_principal_id) IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'context snapshot creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END
$guard$;

CREATE OR REPLACE FUNCTION task_execution.guard_context_snapshot_build_creation_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
DECLARE
    receipt_found boolean;
    receipt_command_version text;
    receipt_target_type text;
    receipt_target_id uuid;
    receipt_enterprise_id uuid;
    receipt_project_id uuid;
    receipt_request_payload_hash bytea;
    receipt_outcome text;
    receipt_created_by_principal_id uuid;
    snapshot_found boolean;
    snapshot_object_id uuid;
    snapshot_enterprise_id uuid;
    snapshot_project_id uuid;
    snapshot_purpose text;
    snapshot_effective_expires_at timestamptz;
    snapshot_request_payload_hash bytea;
    snapshot_source_command_id uuid;
    snapshot_builder_policy_ref jsonb;
    draft_ref_object_id uuid;
    draft_ref_content_hash bytea;
    draft_ref_readable boolean := true;
    draft_found boolean := false;
    draft_snapshot_id uuid;
    draft_payload_hash bytea;
    draft_row_schema_version text;
    draft_enterprise_id uuid;
    draft_project_id uuid;
    root_object_type text;
    root_enterprise_id uuid;
    root_project_id uuid;
    root_current_draft_snapshot_id uuid;
    root_current_draft_snapshot_hash bytea;
    context_principal_id uuid;
    context_principal_kind text;
BEGIN
    IF NEW.build_kind='FROZEN' THEN PERFORM task_execution.assert_frozen_build(NEW); RETURN NEW; END IF;
    SELECT r.command_version, r.target_type, r.target_id, r.enterprise_id,
           r.project_id, r.request_payload_hash, r.outcome,
           r.created_by_principal_id
      INTO receipt_command_version, receipt_target_type, receipt_target_id,
           receipt_enterprise_id, receipt_project_id,
           receipt_request_payload_hash, receipt_outcome,
           receipt_created_by_principal_id
      FROM task_execution.command_receipt r
     WHERE r.command_id = NEW.source_command_id
       AND r.command_type = 'execution.build_initial_context_snapshot';
    receipt_found := FOUND;

    -- The Snapshot is inserted first and this metadata row second (the FK is
    -- immediate), so the fact this metadata belongs to is readable here under
    -- the writer's own RLS Scope.
    SELECT s.object_id, s.enterprise_id, s.project_id, s.purpose,
           s.effective_expires_at, s.request_payload_hash, s.source_command_id,
           s.canonical_payload->'projection'->'builderPolicyRef'
      INTO snapshot_object_id, snapshot_enterprise_id, snapshot_project_id,
           snapshot_purpose, snapshot_effective_expires_at,
           snapshot_request_payload_hash, snapshot_source_command_id,
           snapshot_builder_policy_ref
      FROM task_execution.context_snapshot s
     WHERE s.snapshot_id = NEW.snapshot_id;
    snapshot_found := FOUND;

    -- The ref members are cast in a nested block for the same reason as in the
    -- mirror guards: a ref that cannot define an identity must fail this guard
    -- rather than escape as a cast/decode error.
    BEGIN
        draft_ref_object_id := (NEW.draft_snapshot_ref->>'objectId')::uuid;
        draft_ref_content_hash :=
            decode(NEW.draft_snapshot_ref->'contentHash'->>'digest', 'hex');
    EXCEPTION
        WHEN invalid_text_representation
          OR invalid_datetime_format
          OR datetime_field_overflow
          OR numeric_value_out_of_range
          OR invalid_parameter_value THEN
            draft_ref_readable := false;
    END;

    -- The bound draft and its owning Root: joined on the Root so the WorkOrder
    -- spelling and the current draft pointer are checked against the same row
    -- pair the draft belongs to (the V3003 composite pointer makes
    -- `(work_order_id, snapshot_id, payload_hash)` one fact).
    IF draft_ref_readable THEN
        SELECT s.snapshot_id, s.payload_hash, s.draft_schema_version,
               s.enterprise_id, s.project_id,
               w.work_order_object_type, w.enterprise_id, w.project_id,
               w.current_draft_snapshot_id, w.current_draft_snapshot_hash
          INTO draft_snapshot_id, draft_payload_hash, draft_row_schema_version,
               draft_enterprise_id, draft_project_id,
               root_object_type, root_enterprise_id, root_project_id,
               root_current_draft_snapshot_id, root_current_draft_snapshot_hash
          FROM task_execution.work_order_draft_snapshot s
          JOIN task_execution.work_order w
            ON w.work_order_id = s.work_order_id
         WHERE s.snapshot_id = draft_ref_object_id;
        draft_found := FOUND;
    END IF;

    context_principal_id := platform_security.context_principal_id();
    context_principal_kind := platform_security.context_principal_kind();

    -- Source Receipt identity, its Project Scope and the request hash binding
    -- (same PENDING in-flight command as the Snapshot's guard).
    IF (NOT receipt_found
       OR receipt_outcome IS DISTINCT FROM 'PENDING'
       OR receipt_command_version IS DISTINCT FROM '1.1'
       OR receipt_target_type IS DISTINCT FROM 'zhiju.execution.context_snapshot'
       OR receipt_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR receipt_project_id IS DISTINCT FROM NEW.project_id
       OR receipt_request_payload_hash IS DISTINCT FROM NEW.request_payload_hash) IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'context snapshot build creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;

    -- Snapshot closure: this metadata belongs to the Snapshot of the same
    -- command, same Scope, same purpose, same effective expiry and the same
    -- Builder Policy ref the Snapshot payload's projection carries, and the
    -- Receipt's CREATE target is that Snapshot's object identity.
    IF (NOT snapshot_found
       OR snapshot_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR snapshot_project_id IS DISTINCT FROM NEW.project_id
       OR snapshot_source_command_id IS DISTINCT FROM NEW.source_command_id
       OR snapshot_request_payload_hash IS DISTINCT FROM NEW.request_payload_hash
       OR snapshot_object_id IS DISTINCT FROM receipt_target_id
       OR snapshot_purpose IS DISTINCT FROM NEW.purpose
       OR snapshot_effective_expires_at IS DISTINCT FROM NEW.effective_expires_at
       OR snapshot_builder_policy_ref IS DISTINCT FROM NEW.builder_policy_ref) IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'context snapshot build creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;

    -- DRAFT closure: the ref, the immutable draft snapshot row and the owning
    -- WorkOrder Root are one fact, on the @1.1 creation major and the
    -- canonical WorkOrder spelling, in this row's Project Scope, with the
    -- Root's current pointer resolving to the referenced snapshot and hash.
    IF (NOT draft_ref_readable
       OR NOT draft_found
       OR NEW.draft_snapshot_ref->>'kind' IS DISTINCT FROM 'CONTENT_ADDRESSED'
       OR NEW.draft_snapshot_ref->>'objectType'
              IS DISTINCT FROM 'zhiju.execution.work_order_draft_snapshot'
       OR NEW.draft_snapshot_ref->'scope'->>'enterpriseId'
              IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.draft_snapshot_ref->'scope'->>'projectId'
              IS DISTINCT FROM NEW.project_id::text
       OR draft_payload_hash IS DISTINCT FROM draft_ref_content_hash
       OR draft_row_schema_version IS DISTINCT FROM '1.1'
       OR draft_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR draft_project_id IS DISTINCT FROM NEW.project_id
       OR root_object_type IS DISTINCT FROM 'zhiju.execution.work_order'
       OR root_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR root_project_id IS DISTINCT FROM NEW.project_id
       OR root_current_draft_snapshot_id IS DISTINCT FROM draft_snapshot_id
       OR root_current_draft_snapshot_hash IS DISTINCT FROM draft_ref_content_hash) IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'context snapshot build creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;

    -- Ownership closure, same anchor as the Snapshot's guard.
    IF (context_principal_kind IS NULL
       OR NEW.created_by_principal_id IS DISTINCT FROM context_principal_id
       OR receipt_created_by_principal_id IS DISTINCT FROM context_principal_id) IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'context snapshot build creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END
$guard$;

CREATE OR REPLACE FUNCTION task_execution.guard_first_run_creation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog
AS $guard$
DECLARE source_receipt task_execution.command_receipt%ROWTYPE;
DECLARE parent task_execution.work_order%ROWTYPE;
BEGIN
    SELECT * INTO source_receipt FROM task_execution.command_receipt
     WHERE command_id = NEW.source_command_id;
    IF (NOT FOUND OR source_receipt.outcome <> 'PENDING'
       OR source_receipt.command_type <> 'execution.create_run'
       OR source_receipt.command_version <> '1.0'
       OR source_receipt.target_type <> 'execution.run'
       OR source_receipt.target_id <> NEW.run_id
       OR source_receipt.enterprise_id <> NEW.enterprise_id
       OR source_receipt.project_id <> NEW.project_id
       OR source_receipt.created_by_principal_id <> platform_security.context_principal_id()
       OR NEW.created_by_principal_id <> platform_security.context_principal_id()
       OR source_receipt.authorization_decision_id IS DISTINCT FROM
            (SELECT decision_id FROM platform_security.context_authorization_decision_ref())) IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'Run creation is not runner-bound' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO parent FROM task_execution.work_order
     WHERE work_order_id = NEW.work_order_id AND enterprise_id = NEW.enterprise_id
       AND project_id = NEW.project_id FOR SHARE;
    IF (NOT FOUND OR NOT ((NEW.attempt_number=1 AND parent.status='QUEUED') OR (NEW.attempt_number=2 AND parent.status='RETRY_PENDING'))
       OR parent.frozen_contract_id::text <> NEW.work_order_contract_ref->>'objectId'
       OR encode(parent.frozen_contract_hash, 'hex') <>
          NEW.work_order_contract_ref->'contentHash'->>'digest'
       OR parent.queue_policy_ref IS DISTINCT FROM NEW.lease_policy_ref) IS DISTINCT FROM FALSE THEN
        RAISE EXCEPTION 'Run parent binding is not queued and frozen'
            USING ERRCODE = '23514';
    END IF;
    IF (NEW.attempt_number=2 AND NOT EXISTS (
      SELECT 1 FROM task_execution.work_order_retry_intent i JOIN task_execution.context_snapshot_build b ON b.frozen_contract_ref=NEW.work_order_contract_ref JOIN task_execution.context_snapshot cs USING(snapshot_id)
      WHERE i.work_order_id=NEW.work_order_id AND cs.object_id::text=NEW.context_snapshot_ref->>'objectId'
       AND cs.snapshot_id::text=NEW.context_snapshot_ref->>'snapshotId' AND encode(cs.payload_hash,'hex')=NEW.context_snapshot_ref->'contentHash'->>'digest'
       AND b.canonical_payload->'recovery'->'resolutionRefs'=i.canonical_payload->'resolutionRefs'
       AND NEW.fencing_token>(SELECT coalesce(max(r.fencing_token),0) FROM task_execution.run r WHERE r.work_order_id=NEW.work_order_id)
    )) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'retry Run has no exact intent/Context' USING ERRCODE='23514'; END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.assert_frozen_build(task_execution.context_snapshot_build), task_execution.guard_recovery_task_transition(), task_execution.guard_recovery_budget(), task_execution.guard_recovery_retry_fact() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION task_execution.assert_frozen_build(task_execution.context_snapshot_build) TO task_execution_app;
RESET ROLE;
