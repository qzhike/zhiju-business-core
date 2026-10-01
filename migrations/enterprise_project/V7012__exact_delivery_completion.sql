-- #239: exact provenance ledger and closed v2 Evaluation mirrors.
SET ROLE enterprise_project_owner;
CREATE TABLE enterprise_project.delivery_completion_ledger_lock (
 enterprise_id uuid NOT NULL,project_id uuid NOT NULL,PRIMARY KEY(enterprise_id,project_id)
);
CREATE FUNCTION enterprise_project.lock_completion_ledger(e uuid,p uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
BEGIN
 IF NOT COALESCE(platform_security.context_allows_project(e,p),false) THEN RAISE EXCEPTION 'AUTHORIZATION_DECISION_INVALID' USING ERRCODE='42501'; END IF;
 INSERT INTO enterprise_project.delivery_completion_ledger_lock VALUES(e,p) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM enterprise_project.delivery_completion_ledger_lock WHERE enterprise_id=e AND project_id=p FOR UPDATE;
END; $fn$;
CREATE TABLE enterprise_project.delivery_completion_task_association (
 fact_id uuid PRIMARY KEY,enterprise_id uuid NOT NULL,project_id uuid NOT NULL,delivery_plan_id uuid NOT NULL,version_id uuid NOT NULL,delivery_item_id uuid NOT NULL,
 task_id uuid NOT NULL, event_id uuid NOT NULL, canonical_payload jsonb NOT NULL,payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 FOREIGN KEY(enterprise_id,project_id,fact_id) REFERENCES enterprise_project.delivery_item_completion_fact(enterprise_id,project_id,fact_id),
 FOREIGN KEY(enterprise_id,project_id,version_id,delivery_item_id) REFERENCES enterprise_project.delivery_item(enterprise_id,project_id,version_id,delivery_item_id),
 FOREIGN KEY(enterprise_id,project_id,delivery_plan_id,version_id) REFERENCES enterprise_project.delivery_plan_version(enterprise_id,project_id,delivery_plan_id,version_id)
);
CREATE FUNCTION enterprise_project.completion_hash(b jsonb) RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT sha256(convert_to(enterprise_project.canonical_jsonb_text(b),'UTF8'))
$fn$;
CREATE FUNCTION enterprise_project.completion_canonical_text(b jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $fn$
 SELECT enterprise_project.canonical_jsonb_text(b)
$fn$;
CREATE FUNCTION enterprise_project.guard_exact_completion_association() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE b jsonb; s jsonb; ev jsonb; f enterprise_project.delivery_item_completion_fact%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Completion association is immutable' USING ERRCODE='55000'; END IF;
 b:=NEW.canonical_payload; s:=b->'sidecar'; ev:=b->'event';
 SELECT * INTO f FROM enterprise_project.delivery_item_completion_fact WHERE fact_id=NEW.fact_id;
 IF f.event_type IS DISTINCT FROM 'execution.TaskCompleted' OR f.event_version IS DISTINCT FROM '1.0' OR f.producer_module IS DISTINCT FROM 'task-execution'
 OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(b) key) IS DISTINCT FROM ARRAY['bindingHash','deliveryPlanRef','enterpriseId','event','projectId','sidecar','sourceWatermark','sourceWatermarkHash']
 OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(s) key) IS DISTINCT FROM ARRAY['deliveryItemRef','eventEnvelopeHash','eventId','publicPayloadHash','storedPayloadHash','taskDefinitionSnapshotRef','taskEvaluationRef','taskRef']
 OR f.enterprise_id IS DISTINCT FROM NEW.enterprise_id OR f.project_id IS DISTINCT FROM NEW.project_id OR f.event_id IS DISTINCT FROM NEW.event_id OR f.aggregate_type IS DISTINCT FROM 'zhiju.execution.task' OR f.aggregate_id IS DISTINCT FROM NEW.task_id
 OR NEW.payload_hash IS DISTINCT FROM enterprise_project.completion_hash(b)
 OR b->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text OR b->>'projectId' IS DISTINCT FROM NEW.project_id::text
 OR b->'deliveryPlanRef'->>'objectId' IS DISTINCT FROM NEW.delivery_plan_id::text OR b->'deliveryPlanRef'->>'versionId' IS DISTINCT FROM NEW.version_id::text
 OR s->'deliveryItemRef'->>'objectId' IS DISTINCT FROM NEW.delivery_item_id::text OR s->'deliveryItemRef'->>'versionId' IS DISTINCT FROM NEW.version_id::text OR s->'deliveryItemRef'->>'kind' IS DISTINCT FROM 'VERSIONED' OR s->'deliveryItemRef'->>'objectType' IS DISTINCT FROM 'zhiju.project.delivery_item'
 OR s->'taskDefinitionSnapshotRef'->>'kind' IS DISTINCT FROM 'CONTENT_ADDRESSED' OR s->'taskDefinitionSnapshotRef'->>'objectType' IS DISTINCT FROM 'zhiju.execution.task_definition_snapshot'
 OR s->'taskEvaluationRef'->>'kind' IS DISTINCT FROM 'CONTENT_ADDRESSED' OR s->'taskEvaluationRef'->>'objectType' IS DISTINCT FROM 'zhiju.execution.completion_evaluation'
 OR s->'taskRef' IS DISTINCT FROM ev->'payload'->'taskRef' OR s->'taskEvaluationRef' IS DISTINCT FROM ev->'payload'->'evaluationRef'
 OR s->'taskRef'->>'objectId' IS DISTINCT FROM NEW.task_id::text OR s->'taskRef'->>'objectType' IS DISTINCT FROM 'zhiju.execution.task' OR s->'taskRef'->>'kind' IS DISTINCT FROM 'OBJECT'
 OR s->>'eventId' IS DISTINCT FROM NEW.event_id::text OR ev->>'eventId' IS DISTINCT FROM NEW.event_id::text OR ev->'payload' IS DISTINCT FROM f.payload OR ev->'scopeRef' IS DISTINCT FROM s->'taskRef'->'scope'
 OR s->'deliveryItemRef'->'scope' IS DISTINCT FROM ev->'scopeRef' OR s->'taskDefinitionSnapshotRef'->'scope' IS DISTINCT FROM ev->'scopeRef'
 OR s->'publicPayloadHash'->>'digest' IS DISTINCT FROM encode(f.payload_hash,'hex') OR s->'eventEnvelopeHash'->>'digest' IS DISTINCT FROM encode(enterprise_project.completion_hash(ev),'hex')
 OR s->'storedPayloadHash'->>'digest' IS DISTINCT FROM encode(enterprise_project.completion_hash(f.payload||jsonb_build_object('enterpriseId',NEW.enterprise_id,'projectId',NEW.project_id)),'hex')
 OR f.payload_hash IS DISTINCT FROM enterprise_project.completion_hash(f.payload) OR f.source_watermark_hash IS DISTINCT FROM enterprise_project.completion_hash(f.source_watermark)
 OR ev->>'eventType' IS DISTINCT FROM f.event_type OR ev->>'eventVersion' IS DISTINCT FROM f.event_version OR ev->>'producerModule' IS DISTINCT FROM f.producer_module
 OR ev->>'aggregateType' IS DISTINCT FROM f.aggregate_type OR ev->>'aggregateId' IS DISTINCT FROM f.aggregate_id::text OR ev->'aggregateVersion' IS DISTINCT FROM to_jsonb(f.aggregate_version)
 OR ev->>'commandId' IS DISTINCT FROM f.source_command_id::text OR ev->>'correlationId' IS DISTINCT FROM f.correlation_id::text OR ev->>'causationId' IS DISTINCT FROM f.causation_id::text
 OR b->'bindingHash'->>'digest' IS DISTINCT FROM encode(enterprise_project.completion_hash(s),'hex') OR b->'sourceWatermark' IS DISTINCT FROM f.source_watermark
 OR b->'sourceWatermarkHash'->>'digest' IS DISTINCT FROM encode(f.source_watermark_hash,'hex')
 OR NOT EXISTS(SELECT 1 FROM enterprise_project.delivery_item i WHERE i.enterprise_id=NEW.enterprise_id AND i.project_id=NEW.project_id AND i.delivery_plan_id=NEW.delivery_plan_id AND i.version_id=NEW.version_id AND i.delivery_item_id=NEW.delivery_item_id)
 THEN RAISE EXCEPTION 'Exact completion association mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $fn$;
CREATE TRIGGER association_guard BEFORE INSERT OR UPDATE OR DELETE ON enterprise_project.delivery_completion_task_association FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_exact_completion_association();
CREATE FUNCTION enterprise_project.guard_completion_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $fn$
DECLARE b jsonb; i enterprise_project.delivery_item%ROWTYPE; expected_keys text[];
 task_ref jsonb; release_ref jsonb; associations jsonb; watermarks jsonb; revocations jsonb; satisfied boolean;
BEGIN
 b:=NEW.payload;
 IF NOT b ? 'taskFactSemantics' THEN RETURN NEW; END IF;
 expected_keys:=ARRAY['associationHashes','criteriaHash','deliveryItemRef','deliveryPlanRef','enterpriseId','evaluatedAt','evaluatorRef','factRefs','outcome','projectId','revocationFactRefs','satisfiedFactRefs','sourceWatermarks','taskFactSemantics'];
 SELECT * INTO i FROM enterprise_project.delivery_item WHERE enterprise_id=NEW.enterprise_id AND project_id=NEW.project_id AND version_id=NEW.version_id AND delivery_item_id=NEW.delivery_item_id;
 IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(b) key) IS DISTINCT FROM expected_keys
 OR b->>'taskFactSemantics' IS DISTINCT FROM 'HISTORICAL_COMPLETION' OR i.completion_criteria->>'profile' IS DISTINCT FROM 'ep.delivery_item.exact_task_completion@1.0'
 OR NEW.payload_hash IS DISTINCT FROM enterprise_project.completion_hash(b) OR NEW.input_fingerprint IS DISTINCT FROM enterprise_project.completion_hash(b-'outcome'-'satisfiedFactRefs'-'evaluatedAt')
 OR b->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text OR b->>'projectId' IS DISTINCT FROM NEW.project_id::text
 OR b->'deliveryPlanRef'->>'objectId' IS DISTINCT FROM NEW.delivery_plan_id::text OR b->'deliveryPlanRef'->>'versionId' IS DISTINCT FROM NEW.version_id::text OR b->'deliveryPlanRef'->>'objectType' IS DISTINCT FROM 'zhiju.project.delivery_plan'
 OR b->'deliveryItemRef'->>'objectId' IS DISTINCT FROM NEW.delivery_item_id::text OR b->'deliveryItemRef'->>'versionId' IS DISTINCT FROM NEW.version_id::text OR b->'deliveryItemRef'->>'objectType' IS DISTINCT FROM 'zhiju.project.delivery_item'
 OR b->'criteriaHash'->>'digest' IS DISTINCT FROM encode(NEW.criteria_hash,'hex') OR NEW.criteria_hash IS DISTINCT FROM enterprise_project.completion_hash(jsonb_build_object('criteria',i.completion_criteria))
 OR b->'evaluatorRef' IS DISTINCT FROM NEW.evaluator_ref OR NEW.evaluator_id::text IS DISTINCT FROM '0199b700-0000-7000-8000-000000000201' OR NEW.evaluator_version_id::text IS DISTINCT FROM '0199b700-0000-7000-8000-000000000211'
 OR NEW.evaluator_ref IS DISTINCT FROM jsonb_build_object('kind','VERSIONED','objectType','zhiju.project.evaluator_profile','scope','{}'::jsonb,'objectId',NEW.evaluator_id,'versionId',NEW.evaluator_version_id)
 OR NEW.evaluator_ref_hash IS DISTINCT FROM enterprise_project.completion_hash(NEW.evaluator_ref)
 OR b->'factRefs' IS DISTINCT FROM NEW.fact_refs OR NEW.fact_refs_hash IS DISTINCT FROM enterprise_project.completion_hash(jsonb_build_object('factRefs',NEW.fact_refs))
 OR b->'sourceWatermarks' IS DISTINCT FROM NEW.source_watermarks OR NEW.source_watermarks_hash IS DISTINCT FROM enterprise_project.completion_hash(jsonb_build_object('sourceWatermarks',NEW.source_watermarks))
 OR b->>'outcome' IS DISTINCT FROM NEW.outcome OR (b->>'evaluatedAt')::timestamptz IS DISTINCT FROM NEW.evaluated_at
 OR (NEW.outcome='UNSATISFIED' AND b->'satisfiedFactRefs'<>'[]'::jsonb)
 THEN RAISE EXCEPTION 'V2 completion evaluation mismatch' USING ERRCODE='23514'; END IF;
 SELECT c->'taskRef' INTO task_ref FROM jsonb_array_elements(i.completion_criteria->'allOf') c WHERE c->>'eventType'='execution.TaskCompleted';
 SELECT c->'factRef' INTO release_ref FROM jsonb_array_elements(i.completion_criteria->'allOf') c WHERE c->>'eventType'='release.ReleaseCompleted';
 IF task_ref IS NULL OR jsonb_array_length(NEW.fact_refs)=0
 OR b->'deliveryPlanRef' IS DISTINCT FROM jsonb_build_object('kind','VERSIONED','objectType','zhiju.project.delivery_plan','objectId',NEW.delivery_plan_id,'versionId',NEW.version_id,'scope',jsonb_build_object('enterpriseId',NEW.enterprise_id,'projectId',NEW.project_id))
 OR b->'deliveryItemRef' IS DISTINCT FROM jsonb_build_object('kind','VERSIONED','objectType','zhiju.project.delivery_item','objectId',NEW.delivery_item_id,'versionId',NEW.version_id,'scope',jsonb_build_object('enterpriseId',NEW.enterprise_id,'projectId',NEW.project_id))
 OR NEW.fact_refs IS DISTINCT FROM (SELECT jsonb_agg(ref ORDER BY enterprise_project.completion_canonical_text(ref) COLLATE "C") FROM (SELECT DISTINCT ref FROM jsonb_array_elements(NEW.fact_refs) ref) sorted)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.fact_refs) ref LEFT JOIN enterprise_project.delivery_item_completion_fact f ON f.fact_ref=ref AND f.enterprise_id=NEW.enterprise_id AND f.project_id=NEW.project_id
 LEFT JOIN enterprise_project.delivery_completion_task_association a ON a.fact_id=f.fact_id
 WHERE f.fact_id IS NULL OR f.payload_hash IS DISTINCT FROM enterprise_project.completion_hash(f.payload) OR f.source_watermark_hash IS DISTINCT FROM enterprise_project.completion_hash(f.source_watermark)
 OR (f.event_type='execution.TaskCompleted' AND (a.fact_id IS NULL OR a.version_id<>NEW.version_id OR a.delivery_plan_id<>NEW.delivery_plan_id OR a.delivery_item_id<>NEW.delivery_item_id OR a.canonical_payload->'sidecar'->'taskRef' IS DISTINCT FROM task_ref OR a.payload_hash IS DISTINCT FROM enterprise_project.completion_hash(a.canonical_payload)))
 OR (f.event_type='execution.TaskCompleted' AND EXISTS(SELECT 1 FROM enterprise_project.delivery_completion_task_association newer JOIN enterprise_project.delivery_item_completion_fact nf ON nf.fact_id=newer.fact_id
 WHERE newer.enterprise_id=NEW.enterprise_id AND newer.project_id=NEW.project_id AND newer.delivery_plan_id=NEW.delivery_plan_id AND newer.version_id=NEW.version_id AND newer.delivery_item_id=NEW.delivery_item_id AND newer.task_id=a.task_id
 AND (nf.source_watermark->>'sequence')::bigint>(f.source_watermark->>'sequence')::bigint))
 OR (f.event_type='release.ReleaseCompleted' AND (release_ref IS NULL OR f.payload->'releaseRef' IS DISTINCT FROM release_ref))
 OR f.event_type NOT IN('execution.TaskCompleted','release.ReleaseCompleted'))
 THEN RAISE EXCEPTION 'V2 completion facts mismatch' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(a.payload_hash,'hex')) ORDER BY enterprise_project.completion_canonical_text(ref) COLLATE "C"),'[]'::jsonb) INTO associations
 FROM jsonb_array_elements(NEW.fact_refs) ref JOIN enterprise_project.delivery_item_completion_fact f ON f.fact_ref=ref AND f.enterprise_id=NEW.enterprise_id AND f.project_id=NEW.project_id JOIN enterprise_project.delivery_completion_task_association a ON a.fact_id=f.fact_id;
 SELECT COALESCE(jsonb_agg(watermark ORDER BY enterprise_project.completion_canonical_text(watermark) COLLATE "C"),'[]'::jsonb) INTO watermarks FROM
 (SELECT DISTINCT f.source_watermark watermark FROM jsonb_array_elements(NEW.fact_refs) ref JOIN enterprise_project.delivery_item_completion_fact f ON f.fact_ref=ref AND f.enterprise_id=NEW.enterprise_id AND f.project_id=NEW.project_id) sorted;
 SELECT COALESCE(jsonb_agg(r.fact_ref ORDER BY enterprise_project.completion_canonical_text(r.fact_ref) COLLATE "C"),'[]'::jsonb) INTO revocations
 FROM enterprise_project.delivery_item_completion_fact r WHERE r.enterprise_id=NEW.enterprise_id AND r.project_id=NEW.project_id AND r.lifecycle='REVOKED'
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.fact_refs) ref JOIN enterprise_project.delivery_item_completion_fact f ON f.fact_ref=ref AND f.enterprise_id=NEW.enterprise_id AND f.project_id=NEW.project_id,
 jsonb_array_elements(f.subject_refs) subject,jsonb_array_elements(r.subject_refs) revoked_subject WHERE subject=revoked_subject AND subject->>'kind' IN('VERSIONED','CONTENT_ADDRESSED','SNAPSHOT'));
 WITH eligible AS (
 SELECT f.* FROM jsonb_array_elements(NEW.fact_refs) ref JOIN enterprise_project.delivery_item_completion_fact f ON f.fact_ref=ref
 WHERE f.enterprise_id=NEW.enterprise_id AND f.project_id=NEW.project_id AND f.lifecycle='ACTIVE'
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(revocations) revoked_ref JOIN enterprise_project.delivery_item_completion_fact r ON r.fact_ref=revoked_ref,
 jsonb_array_elements(f.subject_refs) subject,jsonb_array_elements(r.subject_refs) revoked_subject WHERE subject=revoked_subject AND subject->>'kind' IN('VERSIONED','CONTENT_ADDRESSED','SNAPSHOT')))
 SELECT EXISTS(SELECT 1 FROM eligible WHERE event_type='execution.TaskCompleted') AND (release_ref IS NULL OR EXISTS(SELECT 1 FROM eligible WHERE event_type='release.ReleaseCompleted')) INTO satisfied;
 IF b->'associationHashes' IS DISTINCT FROM associations OR b->'sourceWatermarks' IS DISTINCT FROM watermarks OR b->'revocationFactRefs' IS DISTINCT FROM revocations
 OR NEW.outcome IS DISTINCT FROM (CASE WHEN satisfied THEN 'SATISFIED' ELSE 'UNSATISFIED' END)
 OR b->'satisfiedFactRefs' IS DISTINCT FROM (CASE WHEN satisfied THEN NEW.fact_refs ELSE '[]'::jsonb END)
 THEN RAISE EXCEPTION 'V2 completion selection mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $fn$;
CREATE TRIGGER completion_v2_guard BEFORE INSERT ON enterprise_project.delivery_item_completion_evaluation FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_completion_v2();
DO $setup$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['delivery_completion_ledger_lock','delivery_completion_task_association'] LOOP
  EXECUTE format('ALTER TABLE enterprise_project.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE enterprise_project.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY scope ON enterprise_project.%I USING(platform_security.context_allows_project(enterprise_id,project_id)) WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id))',name);
 END LOOP;
END; $setup$;
GRANT SELECT,INSERT,UPDATE ON enterprise_project.delivery_completion_ledger_lock TO enterprise_project_app;
GRANT SELECT,INSERT ON enterprise_project.delivery_completion_task_association TO enterprise_project_app;
REVOKE ALL ON FUNCTION enterprise_project.lock_completion_ledger(uuid,uuid),enterprise_project.completion_hash(jsonb),enterprise_project.guard_exact_completion_association(),enterprise_project.guard_completion_v2() FROM PUBLIC;
REVOKE ALL ON FUNCTION enterprise_project.completion_canonical_text(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enterprise_project.lock_completion_ledger(uuid,uuid),enterprise_project.completion_hash(jsonb),enterprise_project.completion_canonical_text(jsonb) TO enterprise_project_app;
RESET ROLE;
