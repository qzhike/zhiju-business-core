-- #235: independent Completion facts and guarded single-Root transitions.
SET ROLE task_execution_owner;
CREATE TABLE task_execution.completion_evaluation (
 evaluation_id uuid PRIMARY KEY, target_kind text NOT NULL CHECK(target_kind IN('TASK','WORK_ORDER')),
 target_id uuid NOT NULL, enterprise_id uuid NOT NULL, project_id uuid NOT NULL,
 canonical_payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 source_command_id uuid NOT NULL UNIQUE REFERENCES task_execution.command_receipt(command_id),
 UNIQUE(target_kind,target_id,enterprise_id,project_id,evaluation_id,payload_hash)
);
CREATE TABLE task_execution.completion_source_observation (
 evaluation_id uuid NOT NULL REFERENCES task_execution.completion_evaluation(evaluation_id),
 enterprise_id uuid NOT NULL, project_id uuid NOT NULL, source_ref jsonb NOT NULL,
 canonical_payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 PRIMARY KEY(evaluation_id,source_ref)
);
ALTER TABLE task_execution.task
 ADD COLUMN completion_target_kind text GENERATED ALWAYS AS ('TASK'::text) STORED,
 ADD COLUMN current_completion_evaluation_id uuid,
 ADD COLUMN current_completion_evaluation_hash bytea,
 ADD COLUMN first_completion_evaluation_id uuid,
 ADD COLUMN first_completion_evaluation_hash bytea,
 ADD COLUMN completed_at timestamptz,
 ADD CONSTRAINT task_current_completion_fk FOREIGN KEY(completion_target_kind,task_id,enterprise_id,project_id,current_completion_evaluation_id,current_completion_evaluation_hash) REFERENCES task_execution.completion_evaluation(target_kind,target_id,enterprise_id,project_id,evaluation_id,payload_hash) DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT task_first_completion_fk FOREIGN KEY(completion_target_kind,task_id,enterprise_id,project_id,first_completion_evaluation_id,first_completion_evaluation_hash) REFERENCES task_execution.completion_evaluation(target_kind,target_id,enterprise_id,project_id,evaluation_id,payload_hash) DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT task_completion_pointer_pairs CHECK((current_completion_evaluation_id IS NULL)=(current_completion_evaluation_hash IS NULL) AND (first_completion_evaluation_id IS NULL)=(first_completion_evaluation_hash IS NULL) AND (first_completion_evaluation_id IS NULL)=(completed_at IS NULL));
ALTER TABLE task_execution.work_order
 ADD COLUMN completion_target_kind text GENERATED ALWAYS AS ('WORK_ORDER'::text) STORED,
 ADD COLUMN current_completion_evaluation_id uuid,
 ADD COLUMN current_completion_evaluation_hash bytea,
 ADD COLUMN first_completion_evaluation_id uuid,
 ADD COLUMN first_completion_evaluation_hash bytea,
 ADD COLUMN completed_at timestamptz,
 ADD CONSTRAINT work_order_current_completion_fk FOREIGN KEY(completion_target_kind,work_order_id,enterprise_id,project_id,current_completion_evaluation_id,current_completion_evaluation_hash) REFERENCES task_execution.completion_evaluation(target_kind,target_id,enterprise_id,project_id,evaluation_id,payload_hash) DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT work_order_first_completion_fk FOREIGN KEY(completion_target_kind,work_order_id,enterprise_id,project_id,first_completion_evaluation_id,first_completion_evaluation_hash) REFERENCES task_execution.completion_evaluation(target_kind,target_id,enterprise_id,project_id,evaluation_id,payload_hash) DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT work_order_completion_pointer_pairs CHECK((current_completion_evaluation_id IS NULL)=(current_completion_evaluation_hash IS NULL) AND (first_completion_evaluation_id IS NULL)=(first_completion_evaluation_hash IS NULL) AND (first_completion_evaluation_id IS NULL)=(completed_at IS NULL));
CREATE FUNCTION task_execution.completion_source_key(ref jsonb) RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $body$
 SELECT convert_to(task_execution.canonical_jsonb_text(ref),'UTF8')
$body$;
REVOKE ALL ON FUNCTION task_execution.completion_source_key(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION task_execution.completion_source_key(jsonb) TO task_execution_app;
-- Derive the complete owning source collection independently of submitted JSON.
CREATE FUNCTION task_execution.completion_local_sources(target_kind text,target uuid,enterprise uuid,project uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog AS $body$
 WITH children AS (
  SELECT w.* FROM task_execution.work_order w WHERE w.enterprise_id=enterprise AND w.project_id=project
   AND ((target_kind='TASK' AND w.task_id=target) OR (target_kind='WORK_ORDER' AND w.work_order_id=target))
 ), runs AS (SELECT r.* FROM task_execution.run r JOIN children w USING(work_order_id)),
 requests AS (SELECT q.* FROM task_execution.information_request q JOIN children w USING(work_order_id)),
 sources AS (
  SELECT jsonb_build_object('ref',task_execution.recovery_ref('CONTENT_ADDRESSED','zhiju.execution.task_definition_snapshot',d.snapshot_id,enterprise,project,d.payload_hash),'payloadHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(d.payload_hash,'hex'))) s
   FROM task_execution.task t JOIN task_execution.task_definition_snapshot d ON d.snapshot_id=t.current_definition_snapshot_id WHERE target_kind='TASK' AND t.task_id=target AND t.enterprise_id=enterprise AND t.project_id=project
  UNION ALL
  SELECT jsonb_build_object('ref',task_execution.recovery_ref('CONTENT_ADDRESSED','zhiju.contract.work_order',c.contract_id,enterprise,project,c.payload_hash),'payloadHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(c.payload_hash,'hex')))
   FROM children w JOIN task_execution.work_order_contract c ON c.contract_id=w.frozen_contract_id
  UNION ALL
  SELECT jsonb_build_object('ref',task_execution.recovery_ref('OBJECT','zhiju.execution.work_order',w.work_order_id,enterprise,project),'aggregateVersion',w.aggregate_version,'payloadHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(task_execution.recovery_payload_hash(jsonb_build_object('definitionRef',task_execution.recovery_ref('CONTENT_ADDRESSED','zhiju.contract.work_order',c.contract_id,enterprise,project,c.payload_hash),'status',w.status,'pointer',CASE WHEN w.current_completion_evaluation_id IS NULL THEN NULL ELSE task_execution.recovery_ref('CONTENT_ADDRESSED','zhiju.execution.completion_evaluation',w.current_completion_evaluation_id,enterprise,project,w.current_completion_evaluation_hash) END)),'hex')))
   FROM children w JOIN task_execution.work_order_contract c ON c.contract_id=w.frozen_contract_id WHERE target_kind='TASK'
  UNION ALL
  SELECT jsonb_build_object('ref',task_execution.recovery_ref('OBJECT','execution.run',r.run_id,enterprise,project),'aggregateVersion',r.aggregate_version,'payloadHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(task_execution.recovery_payload_hash(to_jsonb(r)||jsonb_build_object('runClaimStatus',(SELECT status FROM task_execution.work_order_run_claim WHERE run_id=r.run_id),'finalReservation',(SELECT to_jsonb(x) FROM task_execution.run_final_submission_claim x WHERE x.run_id=r.run_id),'retryConsumption',(SELECT to_jsonb(x) FROM task_execution.run_retry_intent_consumption x WHERE x.run_id=r.run_id),'budgetReservation',(SELECT to_jsonb(x) FROM task_execution.run_budget_reservation x WHERE x.run_id=r.run_id),'budgetConsumption',(SELECT to_jsonb(x) FROM task_execution.run_budget_consumption x WHERE x.run_id=r.run_id))),'hex'))) FROM runs r
  UNION ALL
  SELECT jsonb_build_object('ref',task_execution.recovery_ref('CONTENT_ADDRESSED','execution.agent_result',a.result_id,enterprise,project,a.result_payload_hash),'payloadHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(a.result_payload_hash,'hex'))) FROM task_execution.agent_result a JOIN runs r USING(run_id)
  UNION ALL
  SELECT jsonb_build_object('ref',task_execution.recovery_ref('CONTENT_ADDRESSED','execution.agent_result_acceptance',a.acceptance_id,enterprise,project,a.payload_hash),'payloadHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(a.payload_hash,'hex'))) FROM task_execution.agent_result_acceptance a JOIN task_execution.agent_result result USING(result_id) JOIN runs r ON r.run_id=result.run_id
  UNION ALL
  SELECT jsonb_build_object('ref',task_execution.recovery_ref('OBJECT','execution.information_request',q.request_id,enterprise,project),'aggregateVersion',q.aggregate_version,'payloadHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(task_execution.recovery_payload_hash(to_jsonb(q)||jsonb_build_object('origin',(SELECT to_jsonb(x) FROM task_execution.information_request_origin x WHERE x.request_id=q.request_id),'answer',(SELECT to_jsonb(x) FROM task_execution.answer_submission x WHERE x.request_id=q.request_id),'resolution',(SELECT to_jsonb(x) FROM task_execution.answer_resolution x WHERE x.request_id=q.request_id),'receiptObservation',(SELECT to_jsonb(o) FROM task_execution.resolution_receipt_observation o JOIN task_execution.answer_resolution x USING(resolution_id) WHERE x.request_id=q.request_id))),'hex'))) FROM requests q
  UNION ALL
  SELECT jsonb_build_object('ref',task_execution.recovery_ref('OBJECT','execution.work_order_retry_intent',i.intent_id,enterprise,project),'payloadHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(task_execution.recovery_payload_hash(to_jsonb(i)),'hex'))) FROM task_execution.work_order_retry_intent i JOIN children w USING(work_order_id)
  UNION ALL
  SELECT jsonb_build_object('ref',(task_execution.recovery_ref('SNAPSHOT','zhiju.execution.context_snapshot',x.object_id,enterprise,project,x.payload_hash)||jsonb_build_object('snapshotId',x.snapshot_id)),'payloadHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(task_execution.recovery_payload_hash(to_jsonb(x)||jsonb_build_object('build',(SELECT to_jsonb(b) FROM task_execution.context_snapshot_build b WHERE b.snapshot_id=x.snapshot_id))),'hex')))
   FROM task_execution.context_snapshot x WHERE EXISTS(SELECT 1 FROM runs r WHERE r.context_snapshot_ref->>'objectId'=x.object_id::text) AND x.enterprise_id=enterprise AND x.project_id=project
 ) SELECT COALESCE(jsonb_agg(s ORDER BY task_execution.completion_source_key(s->'ref')),'[]'::jsonb) FROM sources
$body$;
REVOKE ALL ON FUNCTION task_execution.completion_local_sources(text,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION task_execution.completion_local_sources(text,uuid,uuid,uuid) TO task_execution_app;
CREATE FUNCTION task_execution.guard_completion_evaluation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE; b jsonb; root jsonb; definition jsonb; definition_ref jsonb; definition_hash bytea;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Completion history is immutable' USING ERRCODE='55000'; END IF;
 b:=NEW.canonical_payload;
 SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=NEW.source_command_id;
 IF NEW.target_kind='TASK' THEN
  SELECT to_jsonb(t) INTO root FROM task_execution.task t WHERE task_id=NEW.target_id;
  SELECT canonical_payload,payload_hash INTO definition,definition_hash FROM task_execution.task_definition_snapshot WHERE snapshot_id=(root->>'current_definition_snapshot_id')::uuid;
  definition_ref:=task_execution.recovery_ref('CONTENT_ADDRESSED','zhiju.execution.task_definition_snapshot',(root->>'current_definition_snapshot_id')::uuid,NEW.enterprise_id,NEW.project_id,definition_hash);
 ELSE
  SELECT to_jsonb(w) INTO root FROM task_execution.work_order w WHERE work_order_id=NEW.target_id;
  SELECT canonical_payload,payload_hash INTO definition,definition_hash FROM task_execution.work_order_contract WHERE contract_id=(root->>'frozen_contract_id')::uuid;
  definition_ref:=task_execution.recovery_ref('CONTENT_ADDRESSED','zhiju.contract.work_order',(root->>'frozen_contract_id')::uuid,NEW.enterprise_id,NEW.project_id,definition_hash);
 END IF;
 IF (c.command_type IS DISTINCT FROM CASE NEW.target_kind WHEN 'TASK' THEN 'execution.evaluate_task_completion' ELSE 'execution.evaluate_work_order_completion' END
  OR c.command_version<>'2.0' OR c.target_type IS DISTINCT FROM CASE NEW.target_kind WHEN 'TASK' THEN 'zhiju.execution.task' ELSE 'zhiju.execution.work_order' END
  OR c.target_id<>NEW.target_id OR c.outcome<>'PENDING' OR c.enterprise_id<>NEW.enterprise_id OR c.project_id<>NEW.project_id
  OR c.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
  OR c.authorization_decision_id IS DISTINCT FROM (SELECT decision_id FROM platform_security.context_authorization_decision_ref())
  OR platform_security.context_principal_kind() NOT IN('HUMAN','SERVICE')
  OR root IS NULL OR root->>'enterprise_id' IS DISTINCT FROM NEW.enterprise_id::text OR root->>'project_id' IS DISTINCT FROM NEW.project_id::text
  OR root->>'status' NOT IN('COMPLETION_PENDING','COMPLETED') OR (root->>'aggregate_version')::bigint<>c.expected_aggregate_version
  OR NEW.payload_hash IS DISTINCT FROM task_execution.recovery_payload_hash(b)
  OR b->>'judgmentId' IS DISTINCT FROM NEW.evaluation_id::text OR b->>'judgmentKind' IS DISTINCT FROM 'COMPLETION_EVALUATION'
  OR b->>'targetKind' IS DISTINCT FROM NEW.target_kind OR b->'targetRef'->>'objectId' IS DISTINCT FROM NEW.target_id::text
  OR b->'targetRef'->>'objectType' IS DISTINCT FROM c.target_type OR b->'targetRef'->>'kind' IS DISTINCT FROM 'OBJECT'
  OR b->'scopeRef' IS DISTINCT FROM jsonb_build_object('enterpriseId',NEW.enterprise_id,'projectId',NEW.project_id)
  OR b->'targetRef'->'scope' IS DISTINCT FROM b->'scopeRef'
  OR b->'definitionRef' IS DISTINCT FROM definition_ref
  OR b->'subjectRefs' IS DISTINCT FROM (SELECT jsonb_agg(v ORDER BY task_execution.completion_source_key(v)) FROM (VALUES(b->'targetRef'),(definition_ref)) x(v))
  OR b->'producedBy' IS DISTINCT FROM jsonb_build_object('principalId',c.created_by_principal_id,'principalKind',platform_security.context_principal_kind())
  OR b->'actorSnapshotRef'->>'snapshotId' IS DISTINCT FROM c.actor_snapshot_id::text
  OR b->'authorizationDecisionRef' IS DISTINCT FROM jsonb_build_object('kind','CONTENT_ADDRESSED','objectType','identity.authorization_decision','objectId',c.authorization_decision_id,'scope',jsonb_build_object('enterpriseId',NEW.enterprise_id,'projectId',NEW.project_id),'contentHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',(SELECT encode(payload_hash,'hex') FROM platform_security.context_authorization_decision_ref())))
  OR (b->'actorSnapshotRef') - 'contentHash' IS DISTINCT FROM jsonb_build_object('kind','SNAPSHOT','objectType','identity.actor_snapshot','objectId',c.actor_snapshot_id,'snapshotId',c.actor_snapshot_id,'scope',jsonb_build_object('enterpriseId',NEW.enterprise_id,'projectId',NEW.project_id))
  OR (b->'actorSnapshotRef'->'contentHash') - 'digest' IS DISTINCT FROM '{"algorithm":"SHA-256","canonicalizationVersion":"1"}'::jsonb
  OR b->'actorSnapshotRef'->'contentHash'->>'digest' !~ '^[0-9a-f]{64}$'
  OR (b->>'observedTargetVersion')::bigint<>c.expected_aggregate_version OR (b->>'committedTargetVersion')::bigint<>c.expected_aggregate_version+1
  OR (b->>'validUntil')::timestamptz<=clock_timestamp()
  OR (b->>'validUntil')::timestamptz<=(b->>'evaluatedAt')::timestamptz
  OR b->>'outcome' NOT IN('SATISFIED','UNSATISFIED')
  OR b->'collectionHash'->>'digest' IS DISTINCT FROM encode(task_execution.recovery_payload_hash(b->'observedLocalSources'),'hex')
  OR b->'criteriaHash'->>'digest' IS DISTINCT FROM encode(task_execution.recovery_payload_hash(CASE NEW.target_kind WHEN 'TASK' THEN definition->'definition'->'completionCriteria'->'criteria' ELSE definition->'completionCriteria' END),'hex')
  OR b->'inputHash'->>'digest' IS DISTINCT FROM encode(task_execution.recovery_payload_hash(jsonb_build_object('targetRef',b->'targetRef','definitionRef',b->'definitionRef','criteriaHash',b->'criteriaHash','policyObservation',b->'policyObservation','evaluatorRef',b->'evaluatorRef','collectionHash',b->'collectionHash','observedLocalSources',b->'observedLocalSources','sourceFacts',b->'sourceFacts') || CASE WHEN b ? 'qualitySelection' THEN jsonb_build_object('qualitySelection',b->'qualitySelection') ELSE '{}'::jsonb END),'hex')) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Completion evaluation mirror mismatch' USING ERRCODE='23514'; END IF;
 IF (b - ARRAY['targetRef','definitionRef','criteriaHash','policyObservation','evaluatorRef','collectionHash','observedLocalSources','sourceFacts','qualitySelection','judgmentId','judgmentKind','scopeRef','subjectRefs','inputHash','policyRef','producedBy','actorSnapshotRef','authorizationDecisionRef','evaluatedAt','validUntil','sourceWatermarks','checks','targetKind','observedTargetVersion','committedTargetVersion','factRefs','blockerRefs','criterionResults','outcome','completionTransition'] IS DISTINCT FROM '{}'::jsonb
  OR b->'policyRef' IS DISTINCT FROM b->'policyObservation'->'policyRef'
  OR NOT EXISTS(SELECT 1 FROM task_execution.work_order w WHERE (NEW.target_kind='TASK' AND w.task_id=NEW.target_id OR NEW.target_kind='WORK_ORDER' AND w.work_order_id=NEW.target_id))
  OR EXISTS(SELECT 1 FROM task_execution.work_order w JOIN task_execution.work_order_contract contract ON contract.contract_id=w.frozen_contract_id WHERE (NEW.target_kind='TASK' AND w.task_id=NEW.target_id OR NEW.target_kind='WORK_ORDER' AND w.work_order_id=NEW.target_id) AND (contract.canonical_payload->'constraints' IS DISTINCT FROM jsonb_build_array(jsonb_build_object('profile','execution.completion_binding.v1','policyRef',b->'policyRef'))))
  OR b->'evaluatorRef' IS DISTINCT FROM CASE NEW.target_kind WHEN 'TASK' THEN '{"kind":"VERSIONED","objectType":"zhiju.execution.evaluator_profile","objectId":"0199b600-0000-7000-8000-000000000204","versionId":"0199b600-0000-7000-8000-000000000214","scope":{}}'::jsonb ELSE '{"kind":"VERSIONED","objectType":"zhiju.execution.evaluator_profile","objectId":"0199b600-0000-7000-8000-000000000203","versionId":"0199b600-0000-7000-8000-000000000213","scope":{}}'::jsonb END
  OR c.request_payload_hash IS DISTINCT FROM task_execution.recovery_payload_hash(jsonb_build_object('policyRef',b->'policyRef','evaluatorRef',b->'evaluatorRef'))
  OR jsonb_array_length(b->'criterionResults') IS DISTINCT FROM jsonb_array_length(CASE NEW.target_kind WHEN 'TASK' THEN definition->'definition'->'completionCriteria'->'criteria' ELSE definition->'completionCriteria' END)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE NEW.target_kind WHEN 'TASK' THEN definition->'definition'->'completionCriteria'->'criteria' ELSE definition->'completionCriteria' END) criterion WHERE (SELECT count(*) FROM jsonb_array_elements(b->'criterionResults') result WHERE result->'criterionId'=criterion->'criterionId' AND result->'criterionType'=criterion->'criterionType' AND result->'required'='true'::jsonb AND result->>'outcome' IN('SATISFIED','UNSATISFIED','STALE'))<>1)
  OR (b->>'outcome'='SATISFIED' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b->'criterionResults') result WHERE result->>'outcome' IS DISTINCT FROM 'SATISFIED'))
 ) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Completion criterion or header mirror mismatch' USING ERRCODE='23514'; END IF;
 IF ((b->>'completionTransition')::boolean IS DISTINCT FROM (root->>'status'='COMPLETION_PENDING' AND b->>'outcome'='SATISFIED')) THEN RAISE EXCEPTION 'Completion transition mismatch' USING ERRCODE='23514'; END IF;
 IF b->>'outcome'='SATISFIED' THEN
  IF (jsonb_array_length(b->'factRefs')=0 OR jsonb_array_length(b->'blockerRefs')<>0
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(b->'checks') x WHERE x->>'outcome'<>'SATISFIED')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b->'checks') x WHERE x->>'checkCode'='ACTIVE_RUN_ABSENT')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b->'checks') x WHERE x->>'checkCode'='UNPROCESSED_FINAL_BLOCKER_ABSENT')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b->'checks') x WHERE x->>'checkCode'='FORMAL_FACTS_NONEMPTY')
   OR EXISTS(SELECT 1 FROM task_execution.work_order w JOIN task_execution.run r USING(work_order_id) WHERE (NEW.target_kind='TASK' AND w.task_id=NEW.target_id OR NEW.target_kind='WORK_ORDER' AND w.work_order_id=NEW.target_id) AND r.status IN('CREATED','STARTING','RUNNING','RESULT_RECORDED','SUSPENDED','CANCELLING'))
   OR EXISTS(SELECT 1 FROM task_execution.work_order w WHERE (NEW.target_kind='TASK' AND w.task_id=NEW.target_id OR NEW.target_kind='WORK_ORDER' AND w.work_order_id=NEW.target_id) AND task_execution.recovery_work_order_blocked(w.work_order_id))
   OR (NEW.target_kind='TASK' AND (NOT EXISTS(SELECT 1 FROM task_execution.work_order w WHERE w.task_id=NEW.target_id) OR EXISTS(SELECT 1 FROM task_execution.work_order w LEFT JOIN task_execution.completion_evaluation e ON e.evaluation_id=w.current_completion_evaluation_id WHERE w.task_id=NEW.target_id AND (w.status IS DISTINCT FROM 'COMPLETED' OR e.canonical_payload->>'outcome' IS DISTINCT FROM 'SATISFIED' OR (e.canonical_payload->>'validUntil')::timestamptz<=clock_timestamp() OR (e.canonical_payload->>'committedTargetVersion')::bigint IS DISTINCT FROM w.aggregate_version))))
   OR (NEW.target_kind='WORK_ORDER' AND NOT EXISTS(SELECT 1 FROM task_execution.run r JOIN task_execution.agent_result a USING(run_id) JOIN task_execution.agent_result_acceptance ac ON ac.result_id=a.result_id WHERE r.work_order_id=NEW.target_id AND r.status='SUCCEEDED' AND a.result_payload->>'executionOutcome'='COMPLETED' AND ac.canonical_payload->>'disposition'='ACCEPTED' AND jsonb_array_length(a.result_payload->'businessOutputs')>0 AND r.result_ref=task_execution.recovery_ref('CONTENT_ADDRESSED','execution.agent_result',a.result_id,NEW.enterprise_id,NEW.project_id,a.result_payload_hash) AND r.acceptance_ref=task_execution.recovery_ref('CONTENT_ADDRESSED','execution.agent_result_acceptance',ac.acceptance_id,NEW.enterprise_id,NEW.project_id,ac.payload_hash))) ) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Completion hides a source blocker' USING ERRCODE='23514'; END IF;
 END IF;
 IF b->'observedLocalSources' IS DISTINCT FROM task_execution.completion_local_sources(NEW.target_kind,NEW.target_id,NEW.enterprise_id,NEW.project_id) THEN RAISE EXCEPTION 'Completion source collection changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER completion_evaluation_guard BEFORE INSERT OR UPDATE OR DELETE ON task_execution.completion_evaluation FOR EACH ROW EXECUTE FUNCTION task_execution.guard_completion_evaluation();
CREATE FUNCTION task_execution.guard_completion_observation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE e task_execution.completion_evaluation%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Completion observations are immutable' USING ERRCODE='55000'; END IF;
 SELECT * INTO e FROM task_execution.completion_evaluation WHERE evaluation_id=NEW.evaluation_id;
 IF (e.enterprise_id IS DISTINCT FROM NEW.enterprise_id OR e.project_id IS DISTINCT FROM NEW.project_id
  OR NEW.payload_hash IS DISTINCT FROM task_execution.recovery_payload_hash(NEW.canonical_payload)
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.canonical_payload->'sourceFacts') s WHERE s->'ref'=NEW.source_ref AND s->'observationHash'->>'digest'=encode(NEW.payload_hash,'hex'))) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Completion external attestation mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER completion_observation_guard BEFORE INSERT OR UPDATE OR DELETE ON task_execution.completion_source_observation FOR EACH ROW EXECUTE FUNCTION task_execution.guard_completion_observation();
CREATE FUNCTION task_execution.guard_completion_root() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE e task_execution.completion_evaluation%ROWTYPE; c task_execution.command_receipt%ROWTYPE; target uuid;
BEGIN
 IF (NEW.first_completion_evaluation_id,NEW.first_completion_evaluation_hash,NEW.completed_at) IS DISTINCT FROM (OLD.first_completion_evaluation_id,OLD.first_completion_evaluation_hash,OLD.completed_at) AND OLD.first_completion_evaluation_id IS NOT NULL THEN RAISE EXCEPTION 'first Completion is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.current_completion_evaluation_id IS NOT DISTINCT FROM OLD.current_completion_evaluation_id THEN
  IF NEW.current_completion_evaluation_hash IS DISTINCT FROM OLD.current_completion_evaluation_hash OR (NEW.status='COMPLETED' AND OLD.status<>'COMPLETED') THEN RAISE EXCEPTION 'Completion requires an Evaluation' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 target:=CASE TG_TABLE_NAME WHEN 'task' THEN (to_jsonb(NEW)->>'task_id')::uuid ELSE (to_jsonb(NEW)->>'work_order_id')::uuid END;
 SELECT * INTO e FROM task_execution.completion_evaluation WHERE evaluation_id=NEW.current_completion_evaluation_id;
 SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=e.source_command_id;
 IF (e.target_id IS DISTINCT FROM target OR e.target_kind IS DISTINCT FROM CASE TG_TABLE_NAME WHEN 'task' THEN 'TASK' ELSE 'WORK_ORDER' END
  OR e.payload_hash IS DISTINCT FROM NEW.current_completion_evaluation_hash OR e.enterprise_id<>NEW.enterprise_id OR e.project_id<>NEW.project_id
  OR c.outcome IS DISTINCT FROM 'PENDING' OR c.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
  OR (e.canonical_payload->>'observedTargetVersion')::bigint<>OLD.aggregate_version OR (e.canonical_payload->>'committedTargetVersion')::bigint<>NEW.aggregate_version
  OR NEW.aggregate_version<>OLD.aggregate_version+1
  OR NEW.status IS DISTINCT FROM CASE WHEN (e.canonical_payload->>'completionTransition')::boolean THEN 'COMPLETED' ELSE OLD.status END
  OR ((e.canonical_payload->>'completionTransition')::boolean AND (NEW.first_completion_evaluation_id IS DISTINCT FROM e.evaluation_id OR NEW.first_completion_evaluation_hash IS DISTINCT FROM e.payload_hash OR NEW.completed_at IS DISTINCT FROM (e.canonical_payload->>'evaluatedAt')::timestamptz))) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Completion Root mirror mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER completion_root_guard BEFORE UPDATE ON task_execution.task FOR EACH ROW EXECUTE FUNCTION task_execution.guard_completion_root();
CREATE TRIGGER completion_root_guard BEFORE UPDATE ON task_execution.work_order FOR EACH ROW EXECUTE FUNCTION task_execution.guard_completion_root();
-- The narrow definer transition keeps FORCE RLS and the same trusted Project scope.
CREATE POLICY completion_task_owner_select ON task_execution.task FOR SELECT TO task_execution_owner USING(platform_security.context_allows_project(enterprise_id,project_id));
CREATE POLICY completion_task_owner_update ON task_execution.task FOR UPDATE TO task_execution_owner USING(platform_security.context_allows_project(enterprise_id,project_id)) WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id));
CREATE POLICY completion_work_order_owner_select ON task_execution.work_order FOR SELECT TO task_execution_owner USING(platform_security.context_allows_project(enterprise_id,project_id));
CREATE POLICY completion_work_order_owner_update ON task_execution.work_order FOR UPDATE TO task_execution_owner USING(platform_security.context_allows_project(enterprise_id,project_id)) WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id));
CREATE POLICY completion_receipt_owner_select ON task_execution.command_receipt FOR SELECT TO task_execution_owner USING(platform_security.context_allows_project(enterprise_id,project_id));
CREATE FUNCTION task_execution.commit_completion(kind text,target uuid,expected_version bigint,evaluation uuid,digest bytea,command uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE e task_execution.completion_evaluation%ROWTYPE;
BEGIN
 SELECT * INTO e FROM task_execution.completion_evaluation WHERE evaluation_id=evaluation AND target_kind=kind AND target_id=target AND payload_hash=digest AND source_command_id=command;
 IF e.evaluation_id IS NULL OR NOT platform_security.context_allows_project(e.enterprise_id,e.project_id) THEN RAISE EXCEPTION 'Completion unavailable' USING ERRCODE='42501'; END IF;
 IF kind='TASK' THEN
  UPDATE task_execution.task SET current_completion_evaluation_id=evaluation,current_completion_evaluation_hash=digest,aggregate_version=expected_version+1,last_execution_command_id=command,
   status=CASE WHEN (e.canonical_payload->>'completionTransition')::boolean THEN 'COMPLETED' ELSE status END,
   first_completion_evaluation_id=CASE WHEN (e.canonical_payload->>'completionTransition')::boolean THEN evaluation ELSE first_completion_evaluation_id END,
   first_completion_evaluation_hash=CASE WHEN (e.canonical_payload->>'completionTransition')::boolean THEN digest ELSE first_completion_evaluation_hash END,
   completed_at=CASE WHEN (e.canonical_payload->>'completionTransition')::boolean THEN (e.canonical_payload->>'evaluatedAt')::timestamptz ELSE completed_at END
   WHERE task_id=target AND aggregate_version=expected_version;
 ELSE
  UPDATE task_execution.work_order SET current_completion_evaluation_id=evaluation,current_completion_evaluation_hash=digest,aggregate_version=expected_version+1,last_transition_command_id=command,
   status=CASE WHEN (e.canonical_payload->>'completionTransition')::boolean THEN 'COMPLETED' ELSE status END,
   first_completion_evaluation_id=CASE WHEN (e.canonical_payload->>'completionTransition')::boolean THEN evaluation ELSE first_completion_evaluation_id END,
   first_completion_evaluation_hash=CASE WHEN (e.canonical_payload->>'completionTransition')::boolean THEN digest ELSE first_completion_evaluation_hash END,
   completed_at=CASE WHEN (e.canonical_payload->>'completionTransition')::boolean THEN (e.canonical_payload->>'evaluatedAt')::timestamptz ELSE completed_at END
   WHERE work_order_id=target AND aggregate_version=expected_version;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Completion aggregate version conflict' USING ERRCODE='40001'; END IF;
END $body$;
REVOKE ALL ON FUNCTION task_execution.commit_completion(text,uuid,bigint,uuid,bytea,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION task_execution.commit_completion(text,uuid,bigint,uuid,bytea,uuid) TO task_execution_app;
CREATE UNIQUE INDEX first_completed_event_unique ON task_execution.outbox_event(aggregate_type,aggregate_id,event_type) WHERE event_type IN('execution.TaskCompleted','execution.WorkOrderCompleted');
CREATE FUNCTION task_execution.assert_completion_commit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE; e task_execution.completion_evaluation%ROWTYPE; root jsonb;
BEGIN
 SELECT * INTO e FROM task_execution.completion_evaluation WHERE evaluation_id=NEW.evaluation_id;
 SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=e.source_command_id;
 IF e.target_kind='TASK' THEN SELECT to_jsonb(t) INTO root FROM task_execution.task t WHERE task_id=e.target_id;
 ELSE SELECT to_jsonb(w) INTO root FROM task_execution.work_order w WHERE work_order_id=e.target_id; END IF;
 IF (c.outcome IS DISTINCT FROM 'COMMITTED' OR c.result_payload->'evaluationRef'->>'objectId' IS DISTINCT FROM e.evaluation_id::text
  OR c.result_payload->'evaluationRef'->'contentHash'->>'digest' IS DISTINCT FROM encode(e.payload_hash,'hex')
  OR root->>'current_completion_evaluation_id' IS DISTINCT FROM e.evaluation_id::text
  OR ((e.canonical_payload->>'completionTransition')::boolean AND NOT EXISTS(SELECT 1 FROM task_execution.outbox_event o WHERE o.source_command_id=c.command_id AND o.aggregate_id=e.target_id AND o.payload->'evaluationRef'->>'objectId'=e.evaluation_id::text AND o.event_type=CASE e.target_kind WHEN 'TASK' THEN 'execution.TaskCompleted' ELSE 'execution.WorkOrderCompleted' END))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(e.canonical_payload->'sourceFacts') s WHERE NOT EXISTS(SELECT 1 FROM task_execution.completion_source_observation o WHERE o.evaluation_id=e.evaluation_id AND o.source_ref=s->'ref' AND encode(o.payload_hash,'hex')=s->'observationHash'->>'digest'))) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Completion commit incomplete' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $guard$;
CREATE CONSTRAINT TRIGGER completion_commit_guard AFTER INSERT ON task_execution.completion_evaluation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_execution.assert_completion_commit();

CREATE OR REPLACE FUNCTION task_execution.guard_first_run_work_order_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE;
BEGIN
 IF NEW.current_completion_evaluation_id IS DISTINCT FROM OLD.current_completion_evaluation_id THEN RETURN NEW; END IF;
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

CREATE OR REPLACE FUNCTION task_execution.guard_recovery_task_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE; blocked boolean; active boolean; complete boolean; expected text;
BEGIN
 IF NEW.current_completion_evaluation_id IS DISTINCT FROM OLD.current_completion_evaluation_id THEN RETURN NEW; END IF;
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
ALTER TABLE task_execution.completion_evaluation ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.completion_evaluation FORCE ROW LEVEL SECURITY;
CREATE POLICY completion_evaluation_project ON task_execution.completion_evaluation TO task_execution_app USING(platform_security.context_allows_project(enterprise_id,project_id)) WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id));
CREATE POLICY completion_evaluation_owner ON task_execution.completion_evaluation TO task_execution_owner USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON task_execution.completion_evaluation TO task_execution_app;
REVOKE UPDATE,DELETE ON task_execution.completion_evaluation FROM task_execution_app;
ALTER TABLE task_execution.completion_source_observation ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.completion_source_observation FORCE ROW LEVEL SECURITY;
CREATE POLICY completion_source_observation_project ON task_execution.completion_source_observation TO task_execution_app USING(platform_security.context_allows_project(enterprise_id,project_id)) WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id));
CREATE POLICY completion_source_observation_owner ON task_execution.completion_source_observation TO task_execution_owner USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON task_execution.completion_source_observation TO task_execution_app;
REVOKE UPDATE,DELETE ON task_execution.completion_source_observation FROM task_execution_app;
REVOKE ALL ON FUNCTION task_execution.guard_completion_evaluation(),task_execution.guard_completion_observation(),task_execution.guard_completion_root(),task_execution.assert_completion_commit() FROM PUBLIC;


-- Preserve the original runtime tuple and admit only the exact new frozen profile.
ALTER TABLE task_execution.run DROP CONSTRAINT run_runtime_binding_closed;
ALTER TABLE task_execution.run ADD CONSTRAINT run_runtime_binding_closed CHECK (
 runtime_binding->>'adapterCode' IN('te.human_operated.synthetic','te.human_operated.synthetic.formal') AND
 runtime_binding = jsonb_build_object('adapterCode',runtime_binding->>'adapterCode','adapterVersion','1.0','harnessId','zhiju.runtime.synthetic','harnessVersion','1.0','provider','synthetic','modelId','synthetic','modelConfigHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(sha256(convert_to('{}','UTF8')),'hex')))
);
CREATE FUNCTION task_execution.guard_formal_runtime_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE pin jsonb;
BEGIN
 SELECT canonical_payload->'versionPins'->'runtimeAdapterContractRef' INTO pin FROM task_execution.work_order_contract WHERE contract_id=(NEW.work_order_contract_ref->>'objectId')::uuid;
 IF (NEW.runtime_binding->>'adapterCode' IS DISTINCT FROM CASE WHEN pin=jsonb_build_object('kind','VERSIONED','objectType','zhiju.runtime.adapter_contract','objectId','0199b600-0000-7000-8000-000000000301','versionId','0199b600-0000-7000-8000-000000000311','scope','{}'::jsonb) THEN 'te.human_operated.synthetic.formal' ELSE 'te.human_operated.synthetic' END) THEN
  RAISE EXCEPTION 'Run runtime does not match frozen profile' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER formal_runtime_binding_guard BEFORE INSERT ON task_execution.run FOR EACH ROW EXECUTE FUNCTION task_execution.guard_formal_runtime_binding();
REVOKE ALL ON FUNCTION task_execution.guard_formal_runtime_binding() FROM PUBLIC;

-- All mutating entry points acquire parents before taking any child row lock.
CREATE FUNCTION task_execution.lock_command_sources(target_type text,target uuid,payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $body$
DECLARE parent_task_id uuid; wo uuid; source_run_id uuid; request uuid;
BEGIN
 IF target_type IN('zhiju.execution.task','execution.task') THEN parent_task_id:=target;
 ELSIF target_type IN('zhiju.execution.work_order','execution.work_order') THEN
  wo:=target; SELECT task_id INTO parent_task_id FROM task_execution.work_order WHERE work_order_id=wo;
  IF parent_task_id IS NULL AND payload->'draft'->'taskRef'->>'objectId' IS NOT NULL THEN parent_task_id:=(payload->'draft'->'taskRef'->>'objectId')::uuid; END IF;
 ELSIF target_type='execution.run' THEN
  source_run_id:=target; SELECT work_order_id INTO wo FROM task_execution.run WHERE run_id=source_run_id;
 ELSIF target_type='execution.information_request' THEN
  request:=target; SELECT work_order_id,task_id INTO wo,parent_task_id FROM task_execution.information_request WHERE request_id=request;
 END IF;
 IF wo IS NULL AND COALESCE(payload->'workOrderRef'->>'objectId',payload->'definition'->'workOrderRef'->>'objectId',payload->'creation'->'workOrderRef'->>'objectId') IS NOT NULL THEN wo:=COALESCE(payload->'workOrderRef'->>'objectId',payload->'definition'->'workOrderRef'->>'objectId',payload->'creation'->'workOrderRef'->>'objectId')::uuid; END IF;
 IF source_run_id IS NULL AND COALESCE(payload->'runRef'->>'objectId',payload->'definition'->'runRef'->>'objectId') IS NOT NULL THEN source_run_id:=COALESCE(payload->'runRef'->>'objectId',payload->'definition'->'runRef'->>'objectId')::uuid; END IF;
 IF source_run_id IS NULL AND payload->'agentResultContract'->'runRef'->>'objectId' IS NOT NULL THEN source_run_id:=(payload->'agentResultContract'->'runRef'->>'objectId')::uuid; END IF;
 IF wo IS NULL AND source_run_id IS NOT NULL THEN SELECT work_order_id INTO wo FROM task_execution.run WHERE run_id=source_run_id; END IF;
 IF wo IS NULL AND target_type='execution.agent_result_acceptance' THEN SELECT work_order_id INTO wo FROM task_execution.run r JOIN task_execution.agent_result a USING(run_id) WHERE a.result_id=(payload->'agentResultRef'->>'objectId')::uuid; END IF;
 IF parent_task_id IS NULL AND wo IS NOT NULL THEN SELECT task_id INTO parent_task_id FROM task_execution.work_order WHERE work_order_id=wo; END IF;
 IF parent_task_id IS NULL THEN
  parent_task_id:=COALESCE(payload->'taskRef'->>'objectId',payload->'definition'->'taskRef'->>'objectId',payload->'candidateContract'->'taskRef'->>'objectId',payload->'workOrderContract'->'taskRef'->>'objectId')::uuid;
 END IF;
 IF parent_task_id IS NULL AND payload->'draftSnapshotRef'->>'objectId' IS NOT NULL THEN
  SELECT task_id INTO parent_task_id FROM task_execution.work_order_draft_snapshot WHERE snapshot_id=(payload->'draftSnapshotRef'->>'objectId')::uuid;
 END IF;
 IF parent_task_id IS NOT NULL THEN
  PERFORM task_id FROM task_execution.task WHERE task_id=parent_task_id FOR UPDATE;
  PERFORM work_order_id FROM task_execution.work_order WHERE task_id=parent_task_id ORDER BY work_order_id FOR UPDATE;
  PERFORM r.run_id FROM task_execution.run r JOIN task_execution.work_order w USING(work_order_id) WHERE w.task_id=parent_task_id ORDER BY r.run_id FOR UPDATE OF r;
  PERFORM request_id FROM task_execution.information_request WHERE task_id=parent_task_id ORDER BY request_id FOR UPDATE;
 END IF;
END $body$;
REVOKE ALL ON FUNCTION task_execution.lock_command_sources(text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION task_execution.lock_command_sources(text,uuid,jsonb) TO task_execution_app;
CREATE FUNCTION task_execution.guard_completion_membership() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE parent_task_id uuid; wo uuid; t_status text; w_status text;
BEGIN
 IF TG_TABLE_NAME='work_order' THEN parent_task_id:=NEW.task_id; wo:=NULL;
 ELSIF TG_TABLE_NAME='run' THEN wo:=NEW.work_order_id; SELECT task_id INTO parent_task_id FROM task_execution.work_order WHERE work_order_id=wo;
 ELSE parent_task_id:=NEW.task_id; wo:=NEW.work_order_id; END IF;
 SELECT status INTO t_status FROM task_execution.task WHERE task_id=parent_task_id FOR UPDATE;
 IF wo IS NOT NULL THEN
  SELECT status INTO w_status FROM task_execution.work_order WHERE work_order_id=wo AND task_id=parent_task_id FOR UPDATE;
  IF w_status IS NULL THEN RAISE EXCEPTION 'Completion membership chain mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF t_status IN('COMPLETED','CANCELLED','EXPIRED','FAILED') OR w_status IN('COMPLETED','CANCELLED','EXPIRED','FAILED') THEN RAISE EXCEPTION 'terminal parent rejects new membership' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER completion_work_order_membership BEFORE INSERT ON task_execution.work_order FOR EACH ROW EXECUTE FUNCTION task_execution.guard_completion_membership();
CREATE TRIGGER completion_run_membership BEFORE INSERT ON task_execution.run FOR EACH ROW EXECUTE FUNCTION task_execution.guard_completion_membership();
CREATE TRIGGER completion_request_membership BEFORE INSERT ON task_execution.information_request FOR EACH ROW EXECUTE FUNCTION task_execution.guard_completion_membership();
REVOKE ALL ON FUNCTION task_execution.guard_completion_membership() FROM PUBLIC;
-- Preserve old writable columns; new Completion pointers are owner-function-only.
DO $permissions$
DECLARE t text; cols text;
BEGIN
 FOREACH t IN ARRAY ARRAY['task','work_order'] LOOP
  SELECT string_agg(quote_ident(column_name),',') INTO cols FROM information_schema.columns WHERE table_schema='task_execution' AND table_name=t
   AND column_name NOT IN('completion_target_kind','current_completion_evaluation_id','current_completion_evaluation_hash','first_completion_evaluation_id','first_completion_evaluation_hash','completed_at');
  EXECUTE format('REVOKE UPDATE ON task_execution.%I FROM task_execution_app',t);
  EXECUTE format('GRANT UPDATE(%s) ON task_execution.%I TO task_execution_app',cols,t);
 END LOOP;
END $permissions$;
RESET ROLE;
