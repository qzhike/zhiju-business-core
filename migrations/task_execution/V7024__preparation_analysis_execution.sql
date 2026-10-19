-- Approved template-driven-preparation §6. Add a disjoint preparation profile
-- to existing owning roots. No legacy command gains the new acceptance set.
SET ROLE task_execution_owner;

DO $migration$
DECLARE t text; c record; tr record; definition text; delete_definition text;
BEGIN
  FOREACH t IN ARRAY ARRAY['task_definition_snapshot','task','work_order_draft_snapshot',
    'work_order','context_snapshot','work_order_contract','execution_judgment','run',
    'work_order_run_claim','agent_result','run_final_submission_claim',
    'result_validation_bundle','result_validation_fact','agent_result_acceptance'] LOOP
    EXECUTE format('ALTER TABLE task_execution.%I ADD COLUMN execution_profile text NOT NULL DEFAULT ''ACTIVE'' CHECK (execution_profile IN (''ACTIVE'',''PREPARATION_ANALYSIS''))',t);
    -- Preserve each original constraint for every historical/ACTIVE row.
    -- Preparation payloads have their own closed schema and provenance guard below.
    FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid=format('task_execution.%I',t)::regclass AND contype='c'
        AND conname IN (
          'task_definition_snapshot_schema_version_closed','task_definition_snapshot_v2_shape',
          'work_order_draft_snapshot_schema_version_closed','work_order_draft_schema_version_closed',
          'work_order_draft_snapshot_payload_shape','context_snapshot_builder_version_closed',
          'context_snapshot_payload_shape','work_order_contract_payload_shape',
          'execution_judgment_kind_closed','execution_judgment_kind_columns','execution_judgment_payload_shape',
          'run_runtime_binding_closed','run_binding_scope','run_lease_order','work_order_queue_binding') LOOP
      EXECUTE format('ALTER TABLE task_execution.%I DROP CONSTRAINT %I',t,c.conname);
      EXECUTE format('ALTER TABLE task_execution.%I ADD CONSTRAINT %I CHECK (execution_profile=''PREPARATION_ANALYSIS'' OR (%s))',t,c.conname,
        substring(c.definition FROM 8 FOR length(c.definition)-8));
    END LOOP;
    -- Old semantic producers do not interpret preparation payloads. Their
    -- complete predicates remain effective for all pre-existing records.
    FOR tr IN SELECT tgname,tgtype,pg_get_triggerdef(oid) AS definition FROM pg_trigger
      WHERE tgrelid=format('task_execution.%I',t)::regclass AND NOT tgisinternal
        AND tgname IN (
          'task_definition_snapshot_creation_identity_guard','task_definition_snapshot_mirror_guard',
          'work_order_draft_snapshot_creation_identity_guard','work_order_draft_snapshot_mirror_guard',
          'work_order_root_update_guard','first_run_work_order_transition_guard','recovery_task_transition',
          'context_snapshot_creation_identity_guard','context_snapshot_mirror_guard',
          'work_order_contract_creation_identity_guard','work_order_contract_mirror_guard',
          'execution_judgment_creation_identity_guard','execution_judgment_mirror_guard','result_validation_judgment_guard',
          'first_run_creation_guard','formal_runtime_binding_guard','first_run_update_guard','first_run_claim_guard','final_request_mirror_guard',
          'recovery_run_complete','agent_result_guard','final_claim_guard','validation_bundle_guard',
          'validation_fact_guard','acceptance_guard','final_validation_complete_guard') LOOP
      IF (tr.tgtype & 8)=8 AND (tr.tgtype & 20)=0 THEN CONTINUE; END IF;
      definition := tr.definition;
      IF position(' WHEN (' IN definition)>0 THEN
        definition:=replace(definition,' WHEN (',' WHEN (NEW.execution_profile <> ''PREPARATION_ANALYSIS'' AND ');
      ELSE
        definition:=replace(definition,' EXECUTE FUNCTION',' WHEN (NEW.execution_profile <> ''PREPARATION_ANALYSIS'') EXECUTE FUNCTION');
      END IF;
      -- UPDATE/DELETE triggers cannot reference NEW in DELETE. Keep the
      -- immutable DELETE guard and install a separate preparation-aware
      -- INSERT/UPDATE form; DELETE is never granted for these owning facts.
      IF (tr.tgtype & 8)=8 THEN
        IF position(' WHEN (' IN tr.definition)>0 THEN RAISE EXCEPTION 'Unexpected legacy DELETE predicate'; END IF;
        delete_definition:=regexp_replace(tr.definition,' (INSERT|UPDATE|DELETE)( OR (INSERT|UPDATE|DELETE))* ON ',' DELETE ON ');
        delete_definition:=replace(delete_definition,'TRIGGER '||quote_ident(tr.tgname)||' ', 'TRIGGER '||quote_ident(tr.tgname||'_legacy_delete')||' ');
        delete_definition:=replace(delete_definition,' EXECUTE FUNCTION',' WHEN (OLD.execution_profile <> ''PREPARATION_ANALYSIS'') EXECUTE FUNCTION');
        EXECUTE delete_definition;
        definition:=replace(replace(definition,' OR DELETE ',' '),' DELETE OR ',' ');
      END IF;
      EXECUTE format('DROP TRIGGER %I ON task_execution.%I',tr.tgname,t);
      EXECUTE definition;
    END LOOP;
  END LOOP;
END
$migration$;
ALTER TABLE task_execution.task ADD COLUMN preparation_command_id uuid;
ALTER TABLE task_execution.work_order ADD COLUMN preparation_command_id uuid;
ALTER TABLE task_execution.run ADD COLUMN preparation_command_id uuid;
ALTER TABLE task_execution.work_order_run_claim ADD COLUMN preparation_command_id uuid;
ALTER TABLE task_execution.run ADD COLUMN preparation_authorization_ref jsonb;
GRANT UPDATE(preparation_command_id) ON task_execution.task,task_execution.work_order,task_execution.run,task_execution.work_order_run_claim TO task_execution_app;

ALTER TABLE task_execution.work_order ADD CONSTRAINT preparation_queue_binding CHECK (
 execution_profile<>'PREPARATION_ANALYSIS' OR
 ((status IN('DRAFT','READY') AND queue_policy_ref IS NULL AND queued_at IS NULL AND requested_runtime_class IS NULL)
 OR (status NOT IN('DRAFT','READY') AND queue_policy_ref IS NOT NULL AND queued_at IS NOT NULL
     AND requested_runtime_class='workspace.macos_manual_omp@1')));

ALTER TABLE task_execution.run ALTER COLUMN capability_grant_ref DROP NOT NULL;
ALTER TABLE task_execution.run ADD CONSTRAINT preparation_run_authority_shape CHECK (
  (execution_profile='ACTIVE' AND capability_grant_ref IS NOT NULL AND preparation_authorization_ref IS NULL)
  OR (execution_profile='PREPARATION_ANALYSIS' AND capability_grant_ref IS NULL
      AND jsonb_typeof(preparation_authorization_ref) IS NOT DISTINCT FROM 'object'));

-- Preparation evaluators are fixed local code, not fabricated registry references.
ALTER TABLE task_execution.execution_judgment ALTER COLUMN evaluator_ref DROP NOT NULL;
ALTER TABLE task_execution.execution_judgment ADD COLUMN preparation_evaluator text;
ALTER TABLE task_execution.execution_judgment ADD CONSTRAINT preparation_judgment_evaluator CHECK(
 (execution_profile='ACTIVE' AND evaluator_ref IS NOT NULL AND preparation_evaluator IS NULL) OR
 (execution_profile='PREPARATION_ANALYSIS' AND evaluator_ref IS NULL AND preparation_evaluator='te.preparation_analysis@1'));
ALTER TABLE task_execution.result_validation_bundle ALTER COLUMN evaluator_ref DROP NOT NULL;
ALTER TABLE task_execution.result_validation_bundle ADD COLUMN preparation_evaluator text;
ALTER TABLE task_execution.result_validation_bundle ADD CONSTRAINT preparation_bundle_evaluator CHECK(
 (execution_profile='ACTIVE' AND evaluator_ref IS NOT NULL AND preparation_evaluator IS NULL) OR
 (execution_profile='PREPARATION_ANALYSIS' AND evaluator_ref IS NULL AND preparation_evaluator='te.preparation_analysis@1'));

CREATE TABLE task_execution.preparation_analysis_request (
  request_id uuid PRIMARY KEY,
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL REFERENCES task_execution.task(task_id),
  source_ref jsonb NOT NULL,
  request_payload jsonb NOT NULL,
  payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
  original_command jsonb NOT NULL,
  source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
  state text NOT NULL CHECK(state IN('PENDING','PREPARING','RUNNING','VALIDATING','ACCEPTED','FAILED','UNKNOWN','EXPIRED')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  work_order_id uuid NOT NULL UNIQUE,
  run_id uuid NOT NULL UNIQUE,
  context_id uuid NOT NULL UNIQUE,
  draft_id uuid NOT NULL UNIQUE,
  contract_id uuid NOT NULL UNIQUE,
  attempt_id uuid NOT NULL UNIQUE,
  controls_id uuid NOT NULL UNIQUE,
  readiness_id uuid NOT NULL UNIQUE,
  validation_id uuid NOT NULL UNIQUE,
  result_id uuid NOT NULL UNIQUE,
  acceptance_id uuid NOT NULL UNIQUE,
  reason_codes jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(reason_codes)='array'),
  deadline timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
  worker_id uuid,
  worker_lease timestamptz,
  UNIQUE(enterprise_id,project_id,task_id),
  UNIQUE(enterprise_id,project_id,source_ref)
);
CREATE INDEX preparation_analysis_work ON task_execution.preparation_analysis_request(state,updated_at);
ALTER TABLE task_execution.preparation_analysis_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.preparation_analysis_request FORCE ROW LEVEL SECURITY;
CREATE POLICY preparation_analysis_scope ON task_execution.preparation_analysis_request TO task_execution_app
  USING(platform_security.context_allows_project(enterprise_id,project_id))
  WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id));
GRANT SELECT,INSERT,UPDATE ON task_execution.preparation_analysis_request TO task_execution_app;
REVOKE DELETE ON task_execution.preparation_analysis_request FROM task_execution_app;

CREATE TABLE task_execution.preparation_analysis_fact (
  fact_id uuid PRIMARY KEY,
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES task_execution.preparation_analysis_request(request_id),
  kind text NOT NULL CHECK(kind IN('CONTROLS','READINESS','CONTEXT_VALIDATION','INPUT_VALIDATION','AUTHORIZATION_VALIDATION','RUNTIME_VALIDATION','OUTPUT_VALIDATION','OBSERVATION','REPORT_ACCEPTANCE')),
  canonical_payload jsonb NOT NULL,
  payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
  source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
  UNIQUE(request_id,kind)
);
ALTER TABLE task_execution.preparation_analysis_fact ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.preparation_analysis_fact FORCE ROW LEVEL SECURITY;
CREATE POLICY preparation_analysis_fact_scope ON task_execution.preparation_analysis_fact TO task_execution_app
  USING(platform_security.context_allows_project(enterprise_id,project_id))
  WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id));
GRANT SELECT,INSERT ON task_execution.preparation_analysis_fact TO task_execution_app;
REVOKE UPDATE,DELETE ON task_execution.preparation_analysis_fact FROM task_execution_app;

-- Each new producer is bound to an in-flight owning receipt and the current
-- authenticated transaction. Hashes are recomputed in the owning schema.
CREATE FUNCTION task_execution.guard_preparation_fact() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $guard$
DECLARE j jsonb:=to_jsonb(NEW); oldj jsonb; bound_command_id uuid; receipt task_execution.command_receipt%ROWTYPE; payload jsonb; expected_hash bytea;
BEGIN
  IF TG_OP='DELETE' THEN
    IF to_jsonb(OLD)->>'execution_profile'='ACTIVE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Preparation history is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME NOT IN('preparation_analysis_request','preparation_analysis_fact')
     AND j->>'execution_profile' <> 'PREPARATION_ANALYSIS' THEN
    IF TG_OP='UPDATE' AND to_jsonb(OLD)->>'execution_profile'='PREPARATION_ANALYSIS' THEN
      RAISE EXCEPTION 'Preparation profile is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' THEN
    oldj:=to_jsonb(OLD);
    IF oldj->>'execution_profile' IS DISTINCT FROM j->>'execution_profile'
      OR (j->>'enterprise_id',j->>'project_id') IS DISTINCT FROM (oldj->>'enterprise_id',oldj->>'project_id') THEN
      RAISE EXCEPTION 'Preparation identity is immutable' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME NOT IN('task','work_order','run','work_order_run_claim','preparation_analysis_request') THEN
      RAISE EXCEPTION 'Preparation fact is immutable' USING ERRCODE='23514';
    END IF;
    IF TG_TABLE_NAME='preparation_analysis_request' AND
       (j-'state'-'revision'-'reason_codes'-'updated_at'-'last_command_id'-'worker_id'-'worker_lease') IS DISTINCT FROM
       (oldj-'state'-'revision'-'reason_codes'-'updated_at'-'last_command_id'-'worker_id'-'worker_lease') THEN
      RAISE EXCEPTION 'Preparation request is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  bound_command_id:=coalesce((j->>'preparation_command_id')::uuid,(j->>'last_command_id')::uuid,(j->>'source_command_id')::uuid);
  SELECT * INTO receipt FROM task_execution.command_receipt WHERE command_receipt.command_id=bound_command_id;
  IF NOT FOUND OR receipt.outcome<>'PENDING' OR receipt.enterprise_id::text<>j->>'enterprise_id'
    OR receipt.project_id::text<>j->>'project_id'
    OR receipt.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
    OR NOT (receipt.command_type IN('execution.create_preparation_analysis_task','execution.build_preparation_context','execution.request_preparation_analysis')
      OR receipt.command_type IN('execution.preparation.internal.claim','execution.preparation.internal.draft','execution.preparation.internal.freeze','execution.preparation.internal.queue','execution.preparation.internal.run','execution.preparation.internal.renew','execution.preparation.internal.record','execution.preparation.internal.accept','execution.preparation.internal.failure','execution.preparation.internal.report','execution.preparation.internal.expire'))
    OR receipt.command_version<>'1.0' THEN
    RAISE EXCEPTION 'Preparation owning receipt mismatch' USING ERRCODE='23514';
  END IF;
  payload:=coalesce(j->'canonical_payload',j->'result_payload',j->'request_payload');
  expected_hash:=coalesce((j->>'payload_hash')::bytea,(j->>'result_payload_hash')::bytea);
  IF payload IS NOT NULL AND expected_hash IS NOT NULL AND
     expected_hash IS DISTINCT FROM sha256(convert_to(task_execution.canonical_jsonb_text(payload),'UTF8')) THEN
    RAISE EXCEPTION 'Preparation payload hash mismatch' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='task_definition_snapshot' THEN
    IF (NEW.schema_version<>'preparation.1.0' OR receipt.command_type<>'execution.create_preparation_analysis_task'
      OR receipt.target_id<>NEW.task_id OR NEW.payload_hash<>receipt.request_payload_hash
      OR NEW.canonical_payload->'definition'->>'kind' IS DISTINCT FROM 'PREPARATION_ANALYSIS') THEN
    RAISE EXCEPTION 'Preparation task definition mismatch' USING ERRCODE='23514';
  END IF;
  END IF;
  IF TG_TABLE_NAME='work_order_contract' THEN
    IF (payload->>'profile' IS DISTINCT FROM 'te.preparation_analysis@1'
      OR payload->'allowedCapabilities' IS DISTINCT FROM '["preparation.analysis"]'::jsonb
      OR payload->'completionCriteria' IS DISTINCT FROM '"REPORT_ACCEPTANCE_ONLY"'::jsonb
      OR NEW.specification_hash IS DISTINCT FROM sha256(convert_to(task_execution.canonical_jsonb_text(payload-'specificationHash'),'UTF8'))) THEN
    RAISE EXCEPTION 'Preparation frozen contract mismatch' USING ERRCODE='23514';
  END IF;
  END IF;
  IF TG_TABLE_NAME='run' THEN
    IF NEW.attempt_number<>1 OR NEW.fencing_token<>1 OR NEW.execution_deadline>NEW.created_at+interval '60 minutes'
      OR NEW.lease_expires_at>NEW.execution_deadline OR NEW.lease_expires_at<=NEW.created_at
      OR NEW.runtime_binding->>'profile' IS DISTINCT FROM 'workspace.macos_manual_omp@1'
      OR NEW.preparation_authorization_ref->>'objectType' IS DISTINCT FROM 'identity.authorization_decision' THEN
      RAISE EXCEPTION 'Preparation run boundary mismatch' USING ERRCODE='23514';
    END IF;
    IF TG_OP='UPDATE' AND
      (j-'status'-'aggregate_version'-'started_at'-'start_attempt_ref'-'last_command_id'-'preparation_command_id'-'ended_at'-'termination_reason'-'lease_expires_at'-'runtime_adapter_identity_ref'-'result_ref'-'acceptance_ref') IS DISTINCT FROM
      (oldj-'status'-'aggregate_version'-'started_at'-'start_attempt_ref'-'last_command_id'-'preparation_command_id'-'ended_at'-'termination_reason'-'lease_expires_at'-'runtime_adapter_identity_ref'-'result_ref'-'acceptance_ref') THEN
      RAISE EXCEPTION 'Preparation run binding is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME IN('task','work_order') THEN
   IF NEW.status='COMPLETED' THEN
    RAISE EXCEPTION 'Preparation analysis cannot complete business work' USING ERRCODE='23514';
   END IF;
  END IF;
  IF TG_TABLE_NAME='run' AND TG_OP='UPDATE' THEN
    IF NEW.aggregate_version<>OLD.aggregate_version+1 OR NOT (
      (receipt.command_type='execution.preparation.internal.renew' AND OLD.status IN('CREATED','RUNNING','RESULT_RECORDED') AND (NEW.status=OLD.status OR (OLD.status='CREATED' AND NEW.status='RUNNING')) AND NEW.result_ref IS NOT DISTINCT FROM OLD.result_ref AND NEW.acceptance_ref IS NOT DISTINCT FROM OLD.acceptance_ref)
      OR (receipt.command_type='execution.preparation.internal.record' AND OLD.status='RUNNING' AND NEW.status='RESULT_RECORDED' AND NEW.result_ref IS NOT NULL)
      OR (receipt.command_type='execution.preparation.internal.accept' AND OLD.status='RESULT_RECORDED' AND NEW.status='SUCCEEDED' AND NEW.acceptance_ref IS NOT NULL)
      OR (receipt.command_type='execution.preparation.internal.expire' AND OLD.status IN('CREATED','RUNNING','RESULT_RECORDED') AND NEW.status='TIMED_OUT' AND NEW.execution_deadline<=clock_timestamp() AND NEW.acceptance_ref IS NULL AND NEW.result_ref IS NOT DISTINCT FROM OLD.result_ref)) THEN
      RAISE EXCEPTION 'Preparation run transition mismatch' USING ERRCODE='23514';
    END IF;
    IF receipt.command_type<>'execution.preparation.internal.expire' AND (NEW.execution_deadline<=clock_timestamp() OR OLD.lease_expires_at<=clock_timestamp()) THEN
      RAISE EXCEPTION 'Preparation execution lease expired' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION task_execution.guard_preparation_fact() FROM PUBLIC,task_execution_app;
DO $migration$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['task_definition_snapshot','task','work_order_draft_snapshot','work_order',
 'context_snapshot','work_order_contract','execution_judgment','run','work_order_run_claim',
 'agent_result','run_final_submission_claim','result_validation_bundle','result_validation_fact',
 'agent_result_acceptance','preparation_analysis_request','preparation_analysis_fact'] LOOP
  EXECUTE format('CREATE POLICY preparation_guard_owner_read ON task_execution.%I FOR SELECT TO task_execution_owner USING (true)',t);
  EXECUTE format('CREATE TRIGGER preparation_owning_guard BEFORE INSERT OR UPDATE OR DELETE ON task_execution.%I FOR EACH ROW EXECUTE FUNCTION task_execution.guard_preparation_fact()',t);
 END LOOP;
END
$migration$;
-- Deferred closure proves every new owning root belongs to the exact request.
CREATE FUNCTION task_execution.guard_preparation_closure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $closure$
DECLARE j jsonb:=to_jsonb(NEW); q task_execution.preparation_analysis_request%ROWTYPE;
 d task_execution.task_definition_snapshot%ROWTYPE; w task_execution.work_order%ROWTYPE;
 r task_execution.run%ROWTYPE; c task_execution.work_order_contract%ROWTYPE;
 ctx task_execution.context_snapshot%ROWTYPE; receipt task_execution.command_receipt%ROWTYPE;
 a task_execution.agent_result_acceptance%ROWTYPE; result_row task_execution.agent_result%ROWTYPE;
 id uuid; property text; bound_command_id uuid;
BEGIN
 IF TG_TABLE_NAME NOT IN('preparation_analysis_request','preparation_analysis_fact') AND j->>'execution_profile'<>'PREPARATION_ANALYSIS' THEN RETURN NULL; END IF;
 bound_command_id:=coalesce((j->>'preparation_command_id')::uuid,(j->>'last_command_id')::uuid,(j->>'source_command_id')::uuid);
 SELECT * INTO receipt FROM task_execution.command_receipt WHERE command_id=bound_command_id;
 IF NOT FOUND OR receipt.outcome<>'COMMITTED' THEN RAISE EXCEPTION 'Preparation command did not commit' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME IN('task','task_definition_snapshot') THEN
   SELECT * INTO d FROM task_execution.task_definition_snapshot WHERE task_id=NEW.task_id AND execution_profile='PREPARATION_ANALYSIS';
   IF NOT FOUND OR d.enterprise_id::text<>j->>'enterprise_id' OR d.project_id::text<>j->>'project_id'
    OR NOT EXISTS(SELECT 1 FROM task_execution.task t WHERE t.task_id=d.task_id AND t.current_definition_snapshot_id=d.snapshot_id AND t.current_definition_hash=d.payload_hash AND t.execution_profile='PREPARATION_ANALYSIS') THEN RAISE EXCEPTION 'Preparation task closure mismatch' USING ERRCODE='23514'; END IF;
   RETURN NULL;
 END IF;
 IF TG_TABLE_NAME IN('preparation_analysis_request','preparation_analysis_fact') THEN id:=(j->>'request_id')::uuid;
 ELSE
   property:=CASE TG_TABLE_NAME WHEN 'context_snapshot' THEN 'context_id' WHEN 'work_order_draft_snapshot' THEN 'draft_id' WHEN 'work_order_contract' THEN 'contract_id' WHEN 'execution_judgment' THEN CASE WHEN j->>'judgment_kind'='PREPARATION_READINESS' THEN 'readiness_id' ELSE 'validation_id' END WHEN 'agent_result_acceptance' THEN 'acceptance_id' WHEN 'result_validation_bundle' THEN 'validation_id' ELSE NULL END;
   IF property IS NOT NULL THEN
     SELECT request_id INTO id FROM task_execution.preparation_analysis_request WHERE to_jsonb(preparation_analysis_request)->>property=coalesce(j->>'snapshot_id',j->>'contract_id',j->>'judgment_id',j->>'acceptance_id',j->>'bundle_id');
   ELSIF TG_TABLE_NAME IN('work_order','work_order_run_claim') THEN SELECT request_id INTO id FROM task_execution.preparation_analysis_request WHERE work_order_id=NEW.work_order_id;
   ELSIF TG_TABLE_NAME='result_validation_fact' THEN SELECT request_id INTO id FROM task_execution.preparation_analysis_request WHERE validation_id=NEW.bundle_id;
   ELSE SELECT request_id INTO id FROM task_execution.preparation_analysis_request WHERE run_id=NEW.run_id;
   END IF;
 END IF;
 SELECT * INTO q FROM task_execution.preparation_analysis_request WHERE request_id=id;
 IF NOT FOUND OR q.enterprise_id::text<>j->>'enterprise_id' OR q.project_id::text<>j->>'project_id'
 OR (receipt.command_type='execution.build_preparation_context' AND receipt.target_id<>q.context_id)
 OR (receipt.command_type<>'execution.build_preparation_context' AND receipt.target_id<>q.request_id)
 THEN RAISE EXCEPTION 'Preparation request closure mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO d FROM task_execution.task_definition_snapshot WHERE task_id=q.task_id AND execution_profile='PREPARATION_ANALYSIS';
 IF NOT FOUND OR d.canonical_payload->'preparationSourceRef' IS DISTINCT FROM q.source_ref OR q.request_payload->'preparationSourceRef' IS DISTINCT FROM q.source_ref OR q.original_command->'payload' IS DISTINCT FROM q.request_payload
 OR q.source_ref->'scope' IS DISTINCT FROM jsonb_build_object('enterpriseId',q.enterprise_id::text,'projectId',q.project_id::text)
 THEN RAISE EXCEPTION 'Preparation source closure mismatch' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME IN('work_order','work_order_draft_snapshot') THEN
   SELECT * INTO w FROM task_execution.work_order WHERE work_order_id=q.work_order_id;
   IF NOT FOUND OR w.execution_profile<>'PREPARATION_ANALYSIS' OR w.task_id<>q.task_id OR w.current_draft_snapshot_id<>q.draft_id
    OR NOT EXISTS(SELECT 1 FROM task_execution.work_order_draft_snapshot WHERE snapshot_id=q.draft_id AND payload_hash=w.current_draft_snapshot_hash AND execution_profile='PREPARATION_ANALYSIS')
   THEN RAISE EXCEPTION 'Preparation work order closure mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='work_order_contract' THEN
   SELECT * INTO ctx FROM task_execution.context_snapshot WHERE snapshot_id=q.context_id;
   IF NOT FOUND OR NEW.context_snapshot_hash<>ctx.payload_hash OR NEW.work_order_id<>q.work_order_id OR NEW.task_id<>q.task_id OR NEW.validation_judgment_id<>q.readiness_id
   OR NOT EXISTS(SELECT 1 FROM task_execution.execution_judgment WHERE judgment_id=q.readiness_id AND payload_hash=NEW.validation_judgment_hash AND execution_profile='PREPARATION_ANALYSIS')
   THEN RAISE EXCEPTION 'Preparation contract closure mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME IN('run','work_order_run_claim','agent_result','run_final_submission_claim','result_validation_bundle','result_validation_fact','agent_result_acceptance') THEN
   SELECT * INTO r FROM task_execution.run WHERE run_id=q.run_id;
   SELECT * INTO c FROM task_execution.work_order_contract WHERE contract_id=q.contract_id;
   SELECT * INTO ctx FROM task_execution.context_snapshot WHERE snapshot_id=q.context_id;
   IF r.run_id IS NULL OR c.contract_id IS NULL OR ctx.snapshot_id IS NULL OR r.execution_profile<>'PREPARATION_ANALYSIS' OR r.work_order_id<>q.work_order_id
    OR r.work_order_contract_ref->>'objectId'<>q.contract_id::text OR r.work_order_contract_ref->'contentHash'->>'digest'<>encode(c.payload_hash,'hex')
    OR r.context_snapshot_ref->>'objectId'<>q.context_id::text OR r.context_snapshot_ref->'contentHash'->>'digest'<>encode(ctx.payload_hash,'hex')
    OR r.runtime_binding->'profileHash' IS DISTINCT FROM c.canonical_payload->'runtimeProfileHash'
    OR r.execution_deadline<>q.deadline THEN RAISE EXCEPTION 'Preparation run closure mismatch' USING ERRCODE='23514'; END IF;
   IF r.status IN('RESULT_RECORDED','SUCCEEDED') THEN
     SELECT * INTO result_row FROM task_execution.agent_result WHERE result_id=q.result_id;
     IF NOT FOUND OR result_row.run_id<>q.run_id OR result_row.attempt_ref IS DISTINCT FROM r.start_attempt_ref OR result_row.adapter_identity_ref IS DISTINCT FROM r.runtime_adapter_identity_ref
      OR r.result_ref->>'objectId'<>q.result_id::text OR r.result_ref->'contentHash'->>'digest'<>encode(result_row.result_payload_hash,'hex')
      OR result_row.result_payload->'preparationSourceRef' IS DISTINCT FROM q.source_ref
      OR NOT EXISTS(SELECT 1 FROM task_execution.run_final_submission_claim WHERE run_id=q.run_id AND result_id=q.result_id AND result_payload_hash=result_row.result_payload_hash)
     THEN RAISE EXCEPTION 'Preparation result closure mismatch' USING ERRCODE='23514'; END IF;
   END IF;
   IF TG_TABLE_NAME IN('result_validation_bundle','result_validation_fact','agent_result_acceptance') AND r.status<>'SUCCEEDED' THEN
     RAISE EXCEPTION 'Preparation acceptance has no successful run' USING ERRCODE='23514';
   END IF;
   IF r.status='SUCCEEDED' THEN
     SELECT * INTO a FROM task_execution.agent_result_acceptance WHERE acceptance_id=q.acceptance_id;
     IF NOT FOUND OR a.run_id<>q.run_id OR a.result_id<>q.result_id OR a.bundle_id<>q.validation_id
      OR r.acceptance_ref->>'objectId'<>q.acceptance_id::text OR r.acceptance_ref->'contentHash'->>'digest'<>encode(a.payload_hash,'hex')
      OR NOT EXISTS(SELECT 1 FROM task_execution.result_validation_bundle WHERE bundle_id=q.validation_id AND result_id=q.result_id AND run_id=q.run_id)
      OR (SELECT count(*) FROM task_execution.result_validation_fact WHERE bundle_id=q.validation_id)<>5
      OR NOT EXISTS(SELECT 1 FROM task_execution.work_order_run_claim WHERE run_id=q.run_id AND status='RELEASED')
     THEN RAISE EXCEPTION 'Preparation acceptance closure mismatch' USING ERRCODE='23514'; END IF;
   END IF;
 END IF;
 RETURN NULL;
END
$closure$;
REVOKE ALL ON FUNCTION task_execution.guard_preparation_closure() FROM PUBLIC,task_execution_app;
DO $migration$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['task_definition_snapshot','task','work_order_draft_snapshot','work_order','context_snapshot','work_order_contract','execution_judgment','run','work_order_run_claim','agent_result','run_final_submission_claim','result_validation_bundle','result_validation_fact','agent_result_acceptance','preparation_analysis_request','preparation_analysis_fact'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER preparation_closure AFTER INSERT OR UPDATE ON task_execution.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_execution.guard_preparation_closure()',t);
 END LOOP;
END
$migration$;
RESET ROLE;
