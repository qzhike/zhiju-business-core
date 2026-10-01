-- #239: TaskCompleted-only delivery with immutable source allocation and fencing.
SET ROLE task_execution_owner;
-- FORCE RLS also applies inside the owning SECURITY DEFINER functions.
CREATE POLICY dispatch_outbox_owner_select ON task_execution.outbox_event FOR SELECT TO task_execution_owner
 USING(platform_security.context_allows_project(enterprise_id,project_id) AND event_type='execution.TaskCompleted' AND event_version='1.0' AND aggregate_type='zhiju.execution.task');
CREATE POLICY dispatch_outbox_owner_update ON task_execution.outbox_event FOR UPDATE TO task_execution_owner
 USING(platform_security.context_allows_project(enterprise_id,project_id) AND event_type='execution.TaskCompleted' AND event_version='1.0' AND aggregate_type='zhiju.execution.task')
 WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id) AND event_type='execution.TaskCompleted' AND event_version='1.0' AND aggregate_type='zhiju.execution.task');
CREATE POLICY dispatch_definition_owner_select ON task_execution.task_definition_snapshot FOR SELECT TO task_execution_owner
 USING(platform_security.context_allows_project(enterprise_id,project_id));
CREATE POLICY dispatch_resume_audit_owner_insert ON task_execution.audit_record FOR INSERT TO task_execution_owner
 WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id) AND platform_security.context_principal_kind()='HUMAN' AND command_type='execution.task_completed.dispatch.resume');
CREATE TABLE task_execution.task_completed_dispatch_cursor (
 enterprise_id uuid NOT NULL, project_id uuid NOT NULL, source_module text NOT NULL DEFAULT 'task_execution' CHECK(source_module='task_execution'),
 last_sequence bigint NOT NULL DEFAULT 0 CHECK(last_sequence BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY(enterprise_id,project_id,source_module)
);
CREATE TABLE task_execution.task_completed_dispatch_binding (
 event_id uuid PRIMARY KEY REFERENCES task_execution.outbox_event(event_id), enterprise_id uuid NOT NULL, project_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence BETWEEN 1 AND 9007199254740991), event_envelope jsonb NOT NULL, sidecar jsonb NOT NULL,
 storage_payload_hash bytea NOT NULL CHECK(octet_length(storage_payload_hash)=32), public_payload_hash bytea NOT NULL CHECK(octet_length(public_payload_hash)=32),
 envelope_hash bytea NOT NULL CHECK(octet_length(envelope_hash)=32), binding_hash bytea NOT NULL CHECK(octet_length(binding_hash)=32),
 source_watermark jsonb NOT NULL, watermark_hash bytea NOT NULL CHECK(octet_length(watermark_hash)=32),
 UNIQUE(enterprise_id,project_id,sequence), UNIQUE(enterprise_id,project_id,event_id)
);
CREATE TABLE task_execution.task_completed_dispatch_window (
 event_id uuid PRIMARY KEY, enterprise_id uuid NOT NULL, project_id uuid NOT NULL,
 window_start_attempt_count integer NOT NULL DEFAULT 0 CHECK(window_start_attempt_count>=0), window_number integer NOT NULL DEFAULT 1 CHECK(window_number>=1),
 FOREIGN KEY(enterprise_id,project_id,event_id) REFERENCES task_execution.task_completed_dispatch_binding(enterprise_id,project_id,event_id)
);
CREATE TABLE task_execution.task_completed_dispatch_attempt (
 event_id uuid NOT NULL, lease_token bigint NOT NULL CHECK(lease_token>0), enterprise_id uuid NOT NULL, project_id uuid NOT NULL,
 principal_id uuid NOT NULL, worker_owner text NOT NULL, claimed_at timestamptz NOT NULL, lease_until timestamptz NOT NULL, window_number integer NOT NULL,
 PRIMARY KEY(event_id,lease_token), FOREIGN KEY(enterprise_id,project_id,event_id) REFERENCES task_execution.task_completed_dispatch_binding(enterprise_id,project_id,event_id),
 CHECK(lease_until>claimed_at)
);
CREATE TABLE task_execution.task_completed_dispatch_outcome (
 event_id uuid NOT NULL, lease_token bigint NOT NULL, enterprise_id uuid NOT NULL, project_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN('PROCESSED','DUPLICATE','UNKNOWN','DEAD','STALE')),
 binding_hash bytea NOT NULL, watermark_hash bytea NOT NULL, consumer_result jsonb, result_hash bytea, failure_code text,
 checked_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(event_id,lease_token),
 FOREIGN KEY(event_id,lease_token) REFERENCES task_execution.task_completed_dispatch_attempt(event_id,lease_token),
 FOREIGN KEY(enterprise_id,project_id,event_id) REFERENCES task_execution.task_completed_dispatch_binding(enterprise_id,project_id,event_id),
 CHECK(octet_length(binding_hash)=32 AND octet_length(watermark_hash)=32), CHECK(result_hash IS NULL OR octet_length(result_hash)=32)
);
CREATE FUNCTION task_execution.dispatch_scope(e uuid,p uuid,human boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT COALESCE(platform_security.context_allows_project(e,p),false) OR
    platform_security.context_principal_kind() IS DISTINCT FROM (CASE WHEN human THEN 'HUMAN' ELSE 'SERVICE' END)
 THEN RAISE EXCEPTION 'AUTHORIZATION_DECISION_INVALID' USING ERRCODE='42501'; END IF;
END; $fn$;
CREATE FUNCTION task_execution.dispatch_source(e uuid,p uuid,id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE o task_execution.outbox_event%ROWTYPE; c task_execution.command_receipt%ROWTYPE;
 v task_execution.completion_evaluation%ROWTYPE; d task_execution.task_definition_snapshot%ROWTYPE; t task_execution.task%ROWTYPE;
 pub jsonb; env jsonb; side jsonb; scope jsonb; task_ref jsonb; eval_ref jsonb; def_ref jsonb; item jsonb;
BEGIN
 PERFORM task_execution.dispatch_scope(e,p);
 SELECT * INTO o FROM task_execution.outbox_event WHERE event_id=id AND enterprise_id=e AND project_id=p;
 SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=o.source_command_id;
 SELECT * INTO v FROM task_execution.completion_evaluation WHERE evaluation_id=(o.payload->'evaluationRef'->>'objectId')::uuid;
 def_ref:=v.canonical_payload->'definitionRef';
 SELECT * INTO d FROM task_execution.task_definition_snapshot WHERE snapshot_id=(def_ref->>'objectId')::uuid;
 SELECT * INTO t FROM task_execution.task WHERE task_id=o.aggregate_id;
 scope:=jsonb_build_object('enterpriseId',e,'projectId',p);
 task_ref:=task_execution.recovery_ref('OBJECT','zhiju.execution.task',o.aggregate_id,e,p);
 eval_ref:=task_execution.recovery_ref('CONTENT_ADDRESSED','zhiju.execution.completion_evaluation',v.evaluation_id,e,p,v.payload_hash);
 IF o.event_type IS DISTINCT FROM 'execution.TaskCompleted' OR o.event_version IS DISTINCT FROM '1.0' OR o.aggregate_type IS DISTINCT FROM 'zhiju.execution.task'
 OR c.command_id IS NULL OR c.outcome IS DISTINCT FROM 'COMMITTED' OR c.command_type IS DISTINCT FROM 'execution.evaluate_task_completion' OR c.command_version IS DISTINCT FROM '2.0'
 OR c.enterprise_id IS DISTINCT FROM e OR c.project_id IS DISTINCT FROM p OR c.target_type IS DISTINCT FROM o.aggregate_type OR c.target_id IS DISTINCT FROM o.aggregate_id
 OR c.created_by_principal_id IS DISTINCT FROM o.created_by_principal_id OR c.correlation_id IS DISTINCT FROM o.correlation_id OR c.causation_id IS DISTINCT FROM o.causation_id
 OR c.result_payload_hash IS DISTINCT FROM task_execution.recovery_payload_hash(c.result_payload)
 OR c.result_payload->'evaluationRef' IS DISTINCT FROM eval_ref OR c.result_payload->>'outcome' IS DISTINCT FROM 'SATISFIED'
 OR v.source_command_id IS DISTINCT FROM c.command_id OR v.target_kind IS DISTINCT FROM 'TASK' OR v.target_id IS DISTINCT FROM o.aggregate_id OR v.enterprise_id IS DISTINCT FROM e OR v.project_id IS DISTINCT FROM p
 OR v.payload_hash IS DISTINCT FROM task_execution.recovery_payload_hash(v.canonical_payload) OR v.canonical_payload->>'outcome' IS DISTINCT FROM 'SATISFIED'
 OR v.canonical_payload->'completionTransition' IS DISTINCT FROM 'true'::jsonb
 OR t.first_completion_evaluation_id IS DISTINCT FROM v.evaluation_id OR t.first_completion_evaluation_hash IS DISTINCT FROM v.payload_hash
 OR o.payload->>'completedAt' IS DISTINCT FROM v.canonical_payload->>'evaluatedAt'
 OR (o.payload->>'completedAt')::timestamptz IS DISTINCT FROM t.completed_at
 OR v.canonical_payload->'targetRef' IS DISTINCT FROM task_ref OR (v.canonical_payload->>'committedTargetVersion')::bigint IS DISTINCT FROM o.aggregate_version
 OR d.schema_version IS DISTINCT FROM '2.0' OR d.task_id IS DISTINCT FROM o.aggregate_id OR d.enterprise_id IS DISTINCT FROM e OR d.project_id IS DISTINCT FROM p
 OR d.payload_hash IS DISTINCT FROM task_execution.recovery_payload_hash(d.canonical_payload)
 OR def_ref IS DISTINCT FROM task_execution.recovery_ref('CONTENT_ADDRESSED','zhiju.execution.task_definition_snapshot',d.snapshot_id,e,p,d.payload_hash)
 OR o.payload_hash IS DISTINCT FROM task_execution.recovery_payload_hash(o.payload) OR o.payload->>'enterpriseId' IS DISTINCT FROM e::text OR o.payload->>'projectId' IS DISTINCT FROM p::text
 OR o.payload->'taskRef' IS DISTINCT FROM task_ref OR o.payload->'evaluationRef' IS DISTINCT FROM eval_ref OR o.payload->'satisfiedFactRefs' IS DISTINCT FROM v.canonical_payload->'factRefs'
 OR t.enterprise_id IS DISTINCT FROM e OR t.project_id IS DISTINCT FROM p
 THEN RAISE EXCEPTION 'DISPATCH_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 item:=d.canonical_payload->'definition'->'deliveryItemRef';
 IF item IS NULL THEN RETURN jsonb_build_object('status','UNSUPPORTED_ASSOCIATION'); END IF;
 IF item->>'kind' IS DISTINCT FROM 'VERSIONED' OR item->>'objectType' IS DISTINCT FROM 'zhiju.project.delivery_item' OR item->'scope' IS DISTINCT FROM scope
 OR item->>'objectId' IS DISTINCT FROM t.delivery_item_id::text OR item->>'versionId' IS DISTINCT FROM t.delivery_item_version_id::text
 OR d.delivery_item_id IS DISTINCT FROM t.delivery_item_id OR d.delivery_item_version_id IS DISTINCT FROM t.delivery_item_version_id
 THEN RAISE EXCEPTION 'DISPATCH_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 pub:=o.payload-'enterpriseId'-'projectId';
 env:=jsonb_build_object('eventId',o.event_id,'eventType',o.event_type,'eventVersion',o.event_version,'producerModule','task-execution',
 'aggregateType',o.aggregate_type,'aggregateId',o.aggregate_id,'aggregateVersion',o.aggregate_version,'scopeRef',scope,'correlationId',o.correlation_id,
 'causationId',COALESCE(o.causation_id,o.source_command_id),'commandId',o.source_command_id,'actorRef',jsonb_build_object('kind','OBJECT','objectType','zhiju.identity.principal','objectId',o.created_by_principal_id,'scope',jsonb_build_object('enterpriseId',e)),
 'occurredAt',to_char(o.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'dataClassification','INTERNAL','payload',pub,
 'integrity',jsonb_build_object('canonicalizationVersion','1','payloadHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(task_execution.recovery_payload_hash(pub),'hex'))));
 side:=jsonb_build_object('eventId',o.event_id,'storedPayloadHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(o.payload_hash,'hex')),
 'publicPayloadHash',env->'integrity'->'payloadHash','eventEnvelopeHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(task_execution.recovery_payload_hash(env),'hex')),
 'taskRef',task_ref,'taskEvaluationRef',eval_ref,'taskDefinitionSnapshotRef',def_ref,'deliveryItemRef',item);
 RETURN jsonb_build_object('event',env,'sidecar',side);
END; $fn$;
CREATE FUNCTION task_execution.dispatch_scan(e uuid,p uuid) RETURNS SETOF uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 PERFORM task_execution.dispatch_scope(e,p);
 RETURN QUERY SELECT event_id FROM task_execution.outbox_event o WHERE enterprise_id=e AND project_id=p AND event_type='execution.TaskCompleted' AND event_version='1.0' AND aggregate_type='zhiju.execution.task'
 AND ((delivery_state IN('PENDING','UNKNOWN') AND available_at<=clock_timestamp()) OR (delivery_state='LEASED' AND lease_until<=clock_timestamp()))
 AND NOT EXISTS(SELECT 1 FROM task_execution.outbox_event x WHERE x.enterprise_id=e AND x.project_id=p AND x.aggregate_type=o.aggregate_type AND x.aggregate_id=o.aggregate_id AND x.event_type=o.event_type AND x.event_version=o.event_version AND x.aggregate_version<o.aggregate_version AND x.delivery_state<>'PUBLISHED')
 ORDER BY recorded_at,event_id LIMIT 10;
END; $fn$;
-- Locks remain held until the owning transaction finishes. No source body is returned here.
CREATE FUNCTION task_execution.dispatch_lock(e uuid,p uuid,id uuid,human boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE o task_execution.outbox_event%ROWTYPE;
BEGIN
 PERFORM task_execution.dispatch_scope(e,p,human);
 INSERT INTO task_execution.task_completed_dispatch_cursor(enterprise_id,project_id) VALUES(e,p) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM task_execution.task_completed_dispatch_cursor WHERE enterprise_id=e AND project_id=p FOR UPDATE;
 SELECT * INTO o FROM task_execution.outbox_event WHERE event_id=id AND enterprise_id=e AND project_id=p AND event_type='execution.TaskCompleted' AND event_version='1.0' AND aggregate_type='zhiju.execution.task' FOR UPDATE;
 IF o.event_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
 RETURN jsonb_build_object('taskRef',task_execution.recovery_ref('OBJECT','zhiju.execution.task',o.aggregate_id,e,p),'nextToken',(COALESCE(o.lease_token,0)+1)::text);
END; $fn$;
CREATE FUNCTION task_execution.dispatch_claim(e uuid,p uuid,id uuid,worker text,lease_seconds integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE o task_execution.outbox_event%ROWTYPE; b task_execution.task_completed_dispatch_binding%ROWTYPE; w task_execution.task_completed_dispatch_window%ROWTYPE;
 src jsonb; wm jsonb; seq bigint; ts timestamptz; token bigint;
BEGIN
 PERFORM task_execution.dispatch_lock(e,p,id);
 SELECT * INTO o FROM task_execution.outbox_event WHERE event_id=id;
 ts:=clock_timestamp();
 IF lease_seconds NOT BETWEEN 1 AND 300 OR worker NOT LIKE platform_security.context_principal_id()::text||':%' OR length(worker)>200 THEN RAISE EXCEPTION 'AUTHORIZATION_DECISION_INVALID' USING ERRCODE='42501'; END IF;
 IF NOT ((o.delivery_state IN('PENDING','UNKNOWN') AND o.available_at<=ts) OR (o.delivery_state='LEASED' AND o.lease_until<=ts)) THEN RETURN jsonb_build_object('status','UNAVAILABLE'); END IF;
 IF EXISTS(SELECT 1 FROM task_execution.outbox_event x WHERE x.enterprise_id=e AND x.project_id=p AND x.aggregate_type=o.aggregate_type AND x.aggregate_id=o.aggregate_id AND x.event_type=o.event_type AND x.event_version=o.event_version AND x.aggregate_version<o.aggregate_version AND x.delivery_state<>'PUBLISHED') THEN RETURN jsonb_build_object('status','UNAVAILABLE'); END IF;
 SELECT * INTO b FROM task_execution.task_completed_dispatch_binding WHERE event_id=id;
 IF b.event_id IS NULL THEN
  src:=task_execution.dispatch_source(e,p,id);
  IF src->>'status'='UNSUPPORTED_ASSOCIATION' THEN RETURN src; END IF;
  UPDATE task_execution.task_completed_dispatch_cursor SET last_sequence=last_sequence+1 WHERE enterprise_id=e AND project_id=p RETURNING last_sequence INTO seq;
  wm:=jsonb_build_object('sourceModule','task_execution','partition',p,'sequence',seq,'observedAt',to_char(ts AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  INSERT INTO task_execution.task_completed_dispatch_binding VALUES(id,e,p,seq,src->'event',src->'sidecar',o.payload_hash,task_execution.recovery_payload_hash(src->'event'->'payload'),task_execution.recovery_payload_hash(src->'event'),task_execution.recovery_payload_hash(src->'sidecar'),wm,task_execution.recovery_payload_hash(wm));
  INSERT INTO task_execution.task_completed_dispatch_window(event_id,enterprise_id,project_id) VALUES(id,e,p);
 END IF;
 SELECT * INTO w FROM task_execution.task_completed_dispatch_window WHERE event_id=id;
 IF o.attempt_count-w.window_start_attempt_count>=5 THEN
  UPDATE task_execution.outbox_event SET delivery_state='DEAD',lease_owner=NULL,lease_until=NULL,last_error_code='DISPATCH_BUDGET_EXHAUSTED' WHERE event_id=id;
  RETURN jsonb_build_object('status','DEAD');
 END IF;
 token:=COALESCE(o.lease_token,0)+1;
 UPDATE task_execution.outbox_event SET delivery_state='LEASED',attempt_count=attempt_count+1,lease_token=token,lease_owner=worker,lease_until=ts+make_interval(secs=>lease_seconds) WHERE event_id=id;
 INSERT INTO task_execution.task_completed_dispatch_attempt VALUES(id,token,e,p,platform_security.context_principal_id(),worker,ts,ts+make_interval(secs=>lease_seconds),w.window_number);
 RETURN jsonb_build_object('status','CLAIMED','eventId',id,'taskRef',task_execution.recovery_ref('OBJECT','zhiju.execution.task',o.aggregate_id,e,p),'leaseToken',token::text);
END; $fn$;
CREATE FUNCTION task_execution.dispatch_read(e uuid,p uuid,id uuid,worker text,token bigint,task_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE o task_execution.outbox_event%ROWTYPE; b task_execution.task_completed_dispatch_binding%ROWTYPE; src jsonb;
BEGIN
 PERFORM task_execution.dispatch_scope(e,p);
 SELECT * INTO o FROM task_execution.outbox_event WHERE event_id=id AND enterprise_id=e AND project_id=p;
 IF o.aggregate_id IS DISTINCT FROM task_id OR o.delivery_state IS DISTINCT FROM 'LEASED' OR o.lease_owner IS DISTINCT FROM worker OR o.lease_token IS DISTINCT FROM token OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() OR worker NOT LIKE platform_security.context_principal_id()::text||':%' THEN RAISE EXCEPTION 'DISPATCHER_STALE_LEASE'; END IF;
 SELECT * INTO b FROM task_execution.task_completed_dispatch_binding WHERE event_id=id;
 src:=task_execution.dispatch_source(e,p,id);
 IF src->'event' IS DISTINCT FROM b.event_envelope OR src->'sidecar' IS DISTINCT FROM b.sidecar THEN RAISE EXCEPTION 'DISPATCH_SOURCE_INVALID'; END IF;
 RETURN jsonb_build_object('event',b.event_envelope,'sidecar',b.sidecar,'bindingHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(b.binding_hash,'hex')),'sourceWatermark',b.source_watermark);
END; $fn$;
CREATE FUNCTION task_execution.dispatch_finish(e uuid,p uuid,id uuid,worker text,token bigint,task_id uuid,result jsonb,failure text DEFAULT NULL,retry boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
DECLARE o task_execution.outbox_event%ROWTYPE; b task_execution.task_completed_dispatch_binding%ROWTYPE; start_count integer; state text;
BEGIN
 PERFORM task_execution.dispatch_lock(e,p,id);
 SELECT * INTO o FROM task_execution.outbox_event WHERE event_id=id;
 IF o.aggregate_id IS DISTINCT FROM task_id OR o.delivery_state IS DISTINCT FROM 'LEASED' OR o.lease_owner IS DISTINCT FROM worker OR o.lease_token IS DISTINCT FROM token OR o.lease_until IS NULL OR o.lease_until<=clock_timestamp() OR worker NOT LIKE platform_security.context_principal_id()::text||':%' THEN RAISE EXCEPTION 'DISPATCHER_STALE_LEASE'; END IF;
 SELECT * INTO b FROM task_execution.task_completed_dispatch_binding WHERE event_id=id;
 SELECT window_start_attempt_count INTO start_count FROM task_execution.task_completed_dispatch_window WHERE event_id=id;
 IF failure IS NULL THEN
  IF result->>'status' NOT IN('PROCESSED','DUPLICATE') OR result->>'eventId' IS DISTINCT FROM id::text OR result->'bindingHash'->>'digest' IS DISTINCT FROM encode(b.binding_hash,'hex') OR result->'sourceWatermark' IS DISTINCT FROM b.source_watermark
   OR result->'factRef'->>'kind' IS DISTINCT FROM 'CONTENT_ADDRESSED' OR result->'factRef'->>'objectType' IS DISTINCT FROM 'DeliveryItemCompletionFact'
   OR result->'factRef'->'contentHash' IS DISTINCT FROM b.sidecar->'publicPayloadHash' OR result->'factRef'->'scope' IS DISTINCT FROM b.event_envelope->'scopeRef'
  THEN RAISE EXCEPTION 'DISPATCH_ACK_INVALID'; END IF;
  state:='PUBLISHED';
 ELSE
  IF failure !~ '^[A-Z][A-Z0-9_]{0,95}$' THEN RAISE EXCEPTION 'DISPATCH_FAILURE_INVALID'; END IF;
  state:=CASE WHEN NOT retry OR o.attempt_count-start_count>=5 THEN 'DEAD' ELSE 'UNKNOWN' END;
 END IF;
 INSERT INTO task_execution.task_completed_dispatch_outcome(event_id,lease_token,enterprise_id,project_id,outcome,binding_hash,watermark_hash,consumer_result,result_hash,failure_code)
 VALUES(id,token,e,p,CASE WHEN state='PUBLISHED' THEN result->>'status' ELSE state END,b.binding_hash,b.watermark_hash,result,CASE WHEN result IS NULL THEN NULL ELSE task_execution.recovery_payload_hash(result) END,failure);
 UPDATE task_execution.outbox_event SET delivery_state=state,lease_owner=NULL,lease_until=NULL,last_error_code=failure,
 available_at=clock_timestamp()+CASE WHEN state='UNKNOWN' THEN make_interval(secs=>2*power(2,o.attempt_count-start_count-1)::integer) ELSE interval '0' END,
 published_at=CASE WHEN state='PUBLISHED' THEN clock_timestamp() ELSE NULL END WHERE event_id=id;
 RETURN state;
END; $fn$;
CREATE FUNCTION task_execution.dispatch_resume(e uuid,p uuid,id uuid,task_id uuid,reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $fn$
BEGIN
 PERFORM task_execution.dispatch_lock(e,p,id,true);
 IF length(btrim(reason)) NOT BETWEEN 1 AND 256 OR reason ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'DISPATCH_REASON_INVALID'; END IF;
 IF NOT EXISTS(SELECT 1 FROM task_execution.outbox_event WHERE event_id=id AND aggregate_id=task_id AND delivery_state='DEAD') THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 INSERT INTO task_execution.audit_record(audit_id,enterprise_id,project_id,principal_id,actor_snapshot_id,authorization_decision_id,command_type,outcome,target_type,target_id,correlation_id,safe_summary,retention_class)
 SELECT uuidv7(),e,p,platform_security.context_principal_id(),platform_security.context_actor_snapshot_id(),decision_id,'execution.task_completed.dispatch.resume','INFO','zhiju.execution.task',aggregate_id,platform_security.context_correlation_id(),'Resume TaskCompleted delivery: '||reason,'OPERATIONAL'
 FROM task_execution.outbox_event CROSS JOIN platform_security.context_authorization_decision_ref() WHERE event_id=id;
 UPDATE task_execution.task_completed_dispatch_window SET window_start_attempt_count=o.attempt_count,window_number=window_number+1 FROM task_execution.outbox_event o WHERE task_completed_dispatch_window.event_id=id AND o.event_id=id;
 UPDATE task_execution.outbox_event SET delivery_state='PENDING',available_at=clock_timestamp(),last_error_code=NULL WHERE event_id=id;
END; $fn$;
CREATE FUNCTION task_execution.guard_dispatch_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN RAISE EXCEPTION 'Dispatch history is immutable' USING ERRCODE='55000'; END; $fn$;
CREATE FUNCTION task_execution.guard_dispatch_binding() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE source jsonb; watermark jsonb;
BEGIN
 source:=task_execution.dispatch_source(NEW.enterprise_id,NEW.project_id,NEW.event_id);
 watermark:=NEW.source_watermark;
 IF source->'event' IS DISTINCT FROM NEW.event_envelope OR source->'sidecar' IS DISTINCT FROM NEW.sidecar
 OR NEW.storage_payload_hash IS DISTINCT FROM decode(NEW.sidecar->'storedPayloadHash'->>'digest','hex')
 OR NEW.public_payload_hash IS DISTINCT FROM task_execution.recovery_payload_hash(NEW.event_envelope->'payload')
 OR NEW.envelope_hash IS DISTINCT FROM task_execution.recovery_payload_hash(NEW.event_envelope)
 OR NEW.binding_hash IS DISTINCT FROM task_execution.recovery_payload_hash(NEW.sidecar)
 OR NEW.watermark_hash IS DISTINCT FROM task_execution.recovery_payload_hash(watermark)
 OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(watermark) key) IS DISTINCT FROM ARRAY['observedAt','partition','sequence','sourceModule']
 OR watermark->>'sourceModule' IS DISTINCT FROM 'task_execution'
 OR watermark->>'partition' IS DISTINCT FROM NEW.project_id::text
 OR watermark->'sequence' IS DISTINCT FROM to_jsonb(NEW.sequence)
 OR jsonb_typeof(watermark->'observedAt') IS DISTINCT FROM 'string'
 OR (watermark->>'observedAt')::timestamptz>clock_timestamp()
 OR NOT EXISTS(SELECT 1 FROM task_execution.task_completed_dispatch_cursor WHERE enterprise_id=NEW.enterprise_id AND project_id=NEW.project_id AND last_sequence=NEW.sequence)
 THEN RAISE EXCEPTION 'DISPATCH_SOURCE_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $fn$;
CREATE FUNCTION task_execution.guard_dispatch_attempt() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM task_execution.outbox_event o JOIN task_execution.task_completed_dispatch_window w USING(event_id)
 WHERE o.event_id=NEW.event_id AND o.enterprise_id=NEW.enterprise_id AND o.project_id=NEW.project_id AND o.delivery_state='LEASED'
 AND o.lease_token=NEW.lease_token AND o.lease_owner=NEW.worker_owner AND o.lease_until=NEW.lease_until
 AND NEW.principal_id=platform_security.context_principal_id() AND NEW.worker_owner LIKE NEW.principal_id::text||':%'
 AND NEW.window_number=w.window_number AND NEW.claimed_at<=clock_timestamp() AND NEW.lease_until>clock_timestamp())
 THEN RAISE EXCEPTION 'Dispatch attempt mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $fn$;
CREATE FUNCTION task_execution.guard_dispatch_outcome() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE b task_execution.task_completed_dispatch_binding%ROWTYPE;
BEGIN
 SELECT * INTO b FROM task_execution.task_completed_dispatch_binding WHERE event_id=NEW.event_id;
 IF b.enterprise_id IS DISTINCT FROM NEW.enterprise_id OR b.project_id IS DISTINCT FROM NEW.project_id
 OR NEW.binding_hash IS DISTINCT FROM b.binding_hash OR NEW.watermark_hash IS DISTINCT FROM b.watermark_hash
 OR NOT EXISTS(SELECT 1 FROM task_execution.task_completed_dispatch_attempt a WHERE a.event_id=NEW.event_id AND a.lease_token=NEW.lease_token AND a.enterprise_id=NEW.enterprise_id AND a.project_id=NEW.project_id)
 OR NEW.result_hash IS DISTINCT FROM (CASE WHEN NEW.consumer_result IS NULL THEN NULL ELSE task_execution.recovery_payload_hash(NEW.consumer_result) END)
 OR (NEW.outcome IN('PROCESSED','DUPLICATE') AND (NEW.failure_code IS NOT NULL OR NEW.consumer_result->>'status' IS DISTINCT FROM NEW.outcome OR NEW.consumer_result->>'eventId' IS DISTINCT FROM NEW.event_id::text OR NEW.consumer_result->'bindingHash' IS DISTINCT FROM jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(b.binding_hash,'hex')) OR NEW.consumer_result->'sourceWatermark' IS DISTINCT FROM b.source_watermark))
 OR (NEW.outcome IN('UNKNOWN','DEAD') AND (NEW.consumer_result IS NOT NULL OR NEW.failure_code IS NULL OR NEW.failure_code !~ '^[A-Z][A-Z0-9_]{0,95}$'))
 THEN RAISE EXCEPTION 'Dispatch outcome mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $fn$;
CREATE TRIGGER attempt_guard BEFORE INSERT ON task_execution.task_completed_dispatch_attempt FOR EACH ROW EXECUTE FUNCTION task_execution.guard_dispatch_attempt();
CREATE TRIGGER outcome_guard BEFORE INSERT ON task_execution.task_completed_dispatch_outcome FOR EACH ROW EXECUTE FUNCTION task_execution.guard_dispatch_outcome();
REVOKE ALL ON FUNCTION task_execution.guard_dispatch_attempt(),task_execution.guard_dispatch_outcome() FROM PUBLIC;
CREATE TRIGGER binding_guard BEFORE INSERT ON task_execution.task_completed_dispatch_binding FOR EACH ROW EXECUTE FUNCTION task_execution.guard_dispatch_binding();
DO $setup$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['cursor','binding','window','attempt','outcome'] LOOP
  EXECUTE format('ALTER TABLE task_execution.%I ENABLE ROW LEVEL SECURITY','task_completed_dispatch_'||name);
  EXECUTE format('ALTER TABLE task_execution.%I FORCE ROW LEVEL SECURITY','task_completed_dispatch_'||name);
  EXECUTE format('CREATE POLICY scope ON task_execution.%I TO task_execution_owner USING(platform_security.context_allows_project(enterprise_id,project_id)) WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id))','task_completed_dispatch_'||name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['binding','attempt','outcome'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON task_execution.%I FOR EACH ROW EXECUTE FUNCTION task_execution.guard_dispatch_immutable()','task_completed_dispatch_'||name);
 END LOOP;
END; $setup$;
REVOKE SELECT ON task_execution.outbox_event FROM task_execution_dispatcher;
REVOKE UPDATE(delivery_state,available_at,attempt_count,lease_owner,lease_until,lease_token,last_error_code,published_at) ON task_execution.outbox_event FROM task_execution_dispatcher;
DROP POLICY outbox_event_dispatcher_select ON task_execution.outbox_event;
DROP POLICY outbox_event_dispatcher_update ON task_execution.outbox_event;
REVOKE ALL ON FUNCTION task_execution.dispatch_scope(uuid,uuid,boolean),task_execution.dispatch_source(uuid,uuid,uuid),task_execution.dispatch_scan(uuid,uuid),task_execution.dispatch_lock(uuid,uuid,uuid,boolean),task_execution.dispatch_claim(uuid,uuid,uuid,text,integer),task_execution.dispatch_read(uuid,uuid,uuid,text,bigint,uuid),task_execution.dispatch_finish(uuid,uuid,uuid,text,bigint,uuid,jsonb,text,boolean),task_execution.dispatch_resume(uuid,uuid,uuid,uuid,text),task_execution.guard_dispatch_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION task_execution.guard_dispatch_binding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION task_execution.dispatch_scan(uuid,uuid),task_execution.dispatch_lock(uuid,uuid,uuid,boolean),task_execution.dispatch_claim(uuid,uuid,uuid,text,integer),task_execution.dispatch_read(uuid,uuid,uuid,text,bigint,uuid),task_execution.dispatch_finish(uuid,uuid,uuid,text,bigint,uuid,jsonb,text,boolean),task_execution.dispatch_resume(uuid,uuid,uuid,uuid,text) TO task_execution_dispatcher;
RESET ROLE;
