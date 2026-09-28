-- #231: additive bounded recovery facts. Historical Contracts and rows are untouched.
SET ROLE task_execution_owner;
-- Pure hashing stays owner-side; relational guards retain caller Project RLS.
-- This helper reads no tables and cannot disclose or mutate owning facts.
CREATE FUNCTION task_execution.recovery_payload_hash(payload jsonb) RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $body$
 SELECT sha256(convert_to(task_execution.canonical_jsonb_text(payload),'UTF8'))
$body$;
REVOKE ALL ON FUNCTION task_execution.recovery_payload_hash(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION task_execution.recovery_payload_hash(jsonb) TO task_execution_app;

CREATE TABLE task_execution.recovery_command_material (
 command_id uuid PRIMARY KEY REFERENCES task_execution.command_receipt(command_id),
 enterprise_id uuid NOT NULL, project_id uuid NOT NULL, request_payload jsonb NOT NULL,
 request_payload_hash bytea NOT NULL CHECK(octet_length(request_payload_hash)=32)
);
CREATE FUNCTION task_execution.guard_recovery_command_material() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE;
BEGIN
 IF (TG_OP<>'INSERT') IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Recovery command bytes are immutable' USING ERRCODE='55000'; END IF;
 SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=NEW.command_id;
 IF (c.outcome IS DISTINCT FROM 'PENDING' OR c.enterprise_id<>NEW.enterprise_id OR c.project_id<>NEW.project_id
  OR c.created_by_principal_id<>platform_security.context_principal_id()
  OR c.authorization_decision_id IS DISTINCT FROM (SELECT decision_id FROM platform_security.context_authorization_decision_ref())
  OR c.request_payload_hash IS DISTINCT FROM NEW.request_payload_hash
  OR NEW.request_payload_hash<>task_execution.recovery_payload_hash(NEW.request_payload)) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Recovery command material mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER recovery_command_material_guard BEFORE INSERT OR UPDATE OR DELETE ON task_execution.recovery_command_material FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_command_material();


CREATE TABLE task_execution.information_request (
 request_id uuid PRIMARY KEY,
 enterprise_id uuid NOT NULL, project_id uuid NOT NULL,
 work_order_id uuid NOT NULL, task_id uuid NOT NULL,
 definition jsonb NOT NULL, definition_hash bytea NOT NULL CHECK(octet_length(definition_hash)=32),
 status text NOT NULL CHECK(status IN ('OPEN','ANSWERED','RESOLVED')),
 aggregate_version bigint NOT NULL CHECK(aggregate_version>=1), expires_at timestamptz NOT NULL,
 accepted_answer_ref jsonb, resolution_ref jsonb,
 source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
 last_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
 UNIQUE(enterprise_id,project_id,request_id),
 FOREIGN KEY(enterprise_id,project_id,work_order_id) REFERENCES task_execution.work_order(enterprise_id,project_id,work_order_id),
 FOREIGN KEY(enterprise_id,project_id,task_id) REFERENCES task_execution.task(enterprise_id,project_id,task_id),
 CHECK ((status='RESOLVED') = (accepted_answer_ref IS NOT NULL AND resolution_ref IS NOT NULL))
);
CREATE TABLE task_execution.information_request_origin (
 request_id uuid PRIMARY KEY REFERENCES task_execution.information_request(request_id) DEFERRABLE INITIALLY DEFERRED,
 enterprise_id uuid NOT NULL, project_id uuid NOT NULL,
 source_result_id uuid NOT NULL REFERENCES task_execution.agent_result(result_id), proposal_id uuid NOT NULL,
 source_result_ref jsonb NOT NULL, source_acceptance_ref jsonb NOT NULL, previous_run_ref jsonb NOT NULL,
 work_order_contract_ref jsonb NOT NULL, definition_hash bytea NOT NULL,
 canonical_payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
 UNIQUE(source_result_id,proposal_id),
 FOREIGN KEY(enterprise_id,project_id,request_id) REFERENCES task_execution.information_request(enterprise_id,project_id,request_id)
);
CREATE TABLE task_execution.answer_submission (
 answer_id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE,
 enterprise_id uuid NOT NULL, project_id uuid NOT NULL,
 canonical_payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 recorded_at timestamptz NOT NULL,
 source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
 UNIQUE(enterprise_id,project_id,answer_id),
 FOREIGN KEY(enterprise_id,project_id,request_id) REFERENCES task_execution.information_request(enterprise_id,project_id,request_id)
);
CREATE TABLE task_execution.answer_resolution (
 resolution_id uuid PRIMARY KEY, request_id uuid NOT NULL UNIQUE, answer_id uuid NOT NULL UNIQUE,
 enterprise_id uuid NOT NULL, project_id uuid NOT NULL,
 canonical_payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 effective_at timestamptz NOT NULL,
 source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
 UNIQUE(enterprise_id,project_id,resolution_id),
 FOREIGN KEY(enterprise_id,project_id,request_id) REFERENCES task_execution.information_request(enterprise_id,project_id,request_id),
 FOREIGN KEY(enterprise_id,project_id,answer_id) REFERENCES task_execution.answer_submission(enterprise_id,project_id,answer_id)
);
CREATE TABLE task_execution.resolution_receipt_observation (
 resolution_id uuid PRIMARY KEY REFERENCES task_execution.answer_resolution(resolution_id) DEFERRABLE INITIALLY DEFERRED,
 enterprise_id uuid NOT NULL, project_id uuid NOT NULL,
 canonical_payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 source_command_id uuid NOT NULL REFERENCES task_execution.command_receipt(command_id),
 FOREIGN KEY(enterprise_id,project_id,resolution_id) REFERENCES task_execution.answer_resolution(enterprise_id,project_id,resolution_id)
);
CREATE INDEX information_request_work_order_idx ON task_execution.information_request(enterprise_id,project_id,work_order_id,status);
CREATE INDEX information_request_task_idx ON task_execution.information_request(enterprise_id,project_id,task_id,status);

CREATE FUNCTION task_execution.recovery_ref(kind text, object_type text, object_id uuid, enterprise uuid, project uuid, hash bytea DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $body$
 SELECT jsonb_build_object('kind',kind,'objectType',object_type,'objectId',object_id::text,'scope',jsonb_build_object('enterpriseId',enterprise::text,'projectId',project::text))
 || CASE WHEN hash IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('contentHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(hash,'hex'))) END
$body$;

CREATE FUNCTION task_execution.guard_recovery_request() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE;
DECLARE cp jsonb;
BEGIN
 IF (TG_OP='DELETE') IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Request history cannot be deleted' USING ERRCODE='55000'; END IF;
 IF TG_OP='INSERT' THEN
  IF (NEW.status<>'OPEN' OR NEW.aggregate_version<>1) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Request must open once' USING ERRCODE='23514'; END IF;
 ELSE
  IF ((NEW.request_id,NEW.enterprise_id,NEW.project_id,NEW.task_id,NEW.work_order_id,NEW.definition,NEW.definition_hash,NEW.expires_at,NEW.source_command_id)
   IS DISTINCT FROM (OLD.request_id,OLD.enterprise_id,OLD.project_id,OLD.task_id,OLD.work_order_id,OLD.definition,OLD.definition_hash,OLD.expires_at,OLD.source_command_id)
   OR NEW.aggregate_version<>OLD.aggregate_version+1 OR NOT ((OLD.status='OPEN' AND NEW.status='ANSWERED') OR (OLD.status='ANSWERED' AND NEW.status='RESOLVED'))) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'invalid Request transition' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=NEW.last_command_id;
 SELECT request_payload INTO cp FROM task_execution.recovery_command_material WHERE command_id=c.command_id;
 IF (cp IS NULL OR c.outcome IS DISTINCT FROM 'PENDING' OR c.target_type<>'execution.information_request' OR c.target_id<>NEW.request_id
  OR c.enterprise_id<>NEW.enterprise_id OR c.project_id<>NEW.project_id OR c.command_version<>'1.0'
  OR c.created_by_principal_id<>platform_security.context_principal_id()
  OR c.authorization_decision_id IS DISTINCT FROM (SELECT decision_id FROM platform_security.context_authorization_decision_ref())
  OR (TG_OP='INSERT' AND platform_security.context_principal_kind()<>'SERVICE')
  OR (TG_OP='UPDATE' AND platform_security.context_principal_kind()<>'HUMAN')
  OR (TG_OP='INSERT' AND (c.command_type<>'execution.open_information_request' OR cp->'definition' IS DISTINCT FROM NEW.definition))
  OR (TG_OP='UPDATE' AND c.expected_aggregate_version IS DISTINCT FROM OLD.aggregate_version)
  OR (NEW.status='ANSWERED' AND c.command_type<>'execution.submit_information_answer')
  OR (NEW.status='RESOLVED' AND c.command_type<>'execution.resolve_information_request')
  OR NEW.definition_hash<>task_execution.recovery_payload_hash(NEW.definition)
  OR NEW.definition->'taskRef' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','zhiju.execution.task',NEW.task_id,NEW.enterprise_id,NEW.project_id)
  OR NEW.definition->'workOrderRef' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','zhiju.execution.work_order',NEW.work_order_id,NEW.enterprise_id,NEW.project_id)
  OR (NEW.definition->>'expiresAt')::timestamptz IS DISTINCT FROM NEW.expires_at OR NEW.expires_at<=clock_timestamp()) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Request command or payload mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $guard$;
CREATE TRIGGER recovery_request_guard BEFORE INSERT OR UPDATE OR DELETE ON task_execution.information_request FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_request();

CREATE FUNCTION task_execution.guard_recovery_fact() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE c task_execution.command_receipt%ROWTYPE;
DECLARE cp jsonb;
DECLARE q task_execution.information_request%ROWTYPE;
DECLARE a task_execution.answer_submission%ROWTYPE;
DECLARE r task_execution.run%ROWTYPE;
DECLARE ar task_execution.agent_result%ROWTYPE;
DECLARE ac task_execution.agent_result_acceptance%ROWTYPE;
DECLARE o task_execution.information_request_origin%ROWTYPE;
DECLARE p jsonb;
DECLARE expected_type text;
DECLARE resolution task_execution.answer_resolution%ROWTYPE;
BEGIN
 IF (TG_OP<>'INSERT') IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Recovery fact is immutable' USING ERRCODE='55000'; END IF;
 SELECT * INTO c FROM task_execution.command_receipt WHERE command_id=NEW.source_command_id;
 SELECT request_payload INTO cp FROM task_execution.recovery_command_material WHERE command_id=c.command_id;
 IF (c.outcome IS DISTINCT FROM 'PENDING' OR c.enterprise_id<>NEW.enterprise_id OR c.project_id<>NEW.project_id
  OR c.created_by_principal_id<>platform_security.context_principal_id()
  OR c.authorization_decision_id IS DISTINCT FROM (SELECT decision_id FROM platform_security.context_authorization_decision_ref())
  OR NEW.payload_hash<>task_execution.recovery_payload_hash(NEW.canonical_payload)) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Recovery fact receipt or hash mismatch' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='resolution_receipt_observation' THEN
  SELECT * INTO q FROM task_execution.information_request WHERE resolution_ref->>'objectId'=NEW.resolution_id::text;
  SELECT * INTO resolution FROM task_execution.answer_resolution WHERE resolution_id=NEW.resolution_id;
  SELECT * INTO a FROM task_execution.answer_submission WHERE answer_id=resolution.answer_id;
  IF (c.command_type<>'execution.resolve_information_request' OR c.target_id<>q.request_id
   OR NEW.canonical_payload->'commandReceiptRef' IS DISTINCT FROM resolution.canonical_payload->'domainCommandRefs'->0
   OR NEW.canonical_payload->>'commandType' IS DISTINCT FROM 'project.confirm_customer_material'
   OR NEW.canonical_payload->>'commandVersion' IS DISTINCT FROM '1.0' OR NEW.canonical_payload->>'outcome' IS DISTINCT FROM 'COMMITTED'
   OR NEW.canonical_payload->'scopeRef' IS DISTINCT FROM jsonb_build_object('enterpriseId',NEW.enterprise_id,'projectId',NEW.project_id)
   OR NEW.canonical_payload->'candidateVersionRef' IS DISTINCT FROM a.canonical_payload->'answer'->'answerContent'->'candidateMaterialRef'
   OR NEW.canonical_payload->'confirmedVersionRef' IS DISTINCT FROM a.canonical_payload->'answer'->'answerContent'->'confirmedMaterialRef'
   OR NEW.canonical_payload->'sourceMaterialRefs' IS DISTINCT FROM a.canonical_payload->'answer'->'sourceRefs'
   OR NEW.canonical_payload->'actorRef' IS DISTINCT FROM jsonb_build_object('principalKind','HUMAN','principalId',a.canonical_payload->'answer'->'responder'->>'objectId')
   OR NEW.canonical_payload->'targetRef' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','zhiju.project.customer_material',(a.canonical_payload->'answer'->'answerContent'->'candidateMaterialRef'->>'objectId')::uuid,NEW.enterprise_id,NEW.project_id)
   OR NEW.canonical_payload->'decisionRef' IS DISTINCT FROM resolution.canonical_payload->'confirmationDecisionRef'
   OR NEW.canonical_payload->'actorSnapshotRef' IS DISTINCT FROM resolution.canonical_payload->'confirmationActorSnapshotRef'
   OR NEW.canonical_payload->'authorizationDecisionRef' IS DISTINCT FROM resolution.canonical_payload->'confirmationAuthorizationDecisionRef'
   OR (NEW.canonical_payload->>'committedAt')::timestamptz>resolution.effective_at
   OR NOT EXISTS (
   SELECT 1 FROM task_execution.answer_resolution x WHERE x.resolution_id=NEW.resolution_id AND x.enterprise_id=NEW.enterprise_id AND x.project_id=NEW.project_id
    AND x.canonical_payload->'receiptAttestationHash'->>'digest'=encode(NEW.payload_hash,'hex'))) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Receipt observation mismatch' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO q FROM task_execution.information_request WHERE request_id=NEW.request_id;
 IF (q.enterprise_id IS DISTINCT FROM NEW.enterprise_id OR q.project_id IS DISTINCT FROM NEW.project_id OR c.target_id<>q.request_id OR c.target_type<>'execution.information_request') IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Recovery Request mismatch' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='information_request_origin' THEN
  SELECT * INTO ar FROM task_execution.agent_result WHERE result_id=NEW.source_result_id;
  SELECT * INTO r FROM task_execution.run WHERE run_id=ar.run_id;
  SELECT * INTO ac FROM task_execution.agent_result_acceptance WHERE result_id=ar.result_id;
  SELECT x INTO p FROM jsonb_array_elements(ar.result_payload->'inputRequestProposals') x WHERE x->>'proposalId'=NEW.proposal_id::text;
  IF (c.command_type<>'execution.open_information_request' OR r.status IS DISTINCT FROM 'SUCCEEDED' OR ac.canonical_payload->>'disposition' IS DISTINCT FROM 'ACCEPTED' OR ar.result_payload->>'executionOutcome'<>'BLOCKED_INPUT' OR p IS NULL
   OR NEW.canonical_payload IS DISTINCT FROM jsonb_build_object('informationRequestRef',task_execution.recovery_ref('OBJECT','execution.information_request',q.request_id,NEW.enterprise_id,NEW.project_id),'sourceAgentResultRef',NEW.source_result_ref,'sourceAcceptanceRef',NEW.source_acceptance_ref,'previousRunRef',NEW.previous_run_ref,'workOrderContractRef',NEW.work_order_contract_ref,'proposalId',NEW.proposal_id::text,'definitionHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(NEW.definition_hash,'hex')))
   OR NEW.source_result_ref IS DISTINCT FROM task_execution.recovery_ref('CONTENT_ADDRESSED','execution.agent_result',ar.result_id,NEW.enterprise_id,NEW.project_id,ar.result_payload_hash)
   OR NEW.source_acceptance_ref IS DISTINCT FROM r.acceptance_ref OR NEW.previous_run_ref IS DISTINCT FROM task_execution.recovery_ref('OBJECT','execution.run',r.run_id,NEW.enterprise_id,NEW.project_id)
   OR NEW.work_order_contract_ref IS DISTINCT FROM r.work_order_contract_ref OR NEW.definition_hash IS DISTINCT FROM q.definition_hash
   OR q.work_order_id<>r.work_order_id OR q.definition->'runRef' IS DISTINCT FROM NEW.previous_run_ref
   OR q.definition->'expectedAnswerSpec' IS DISTINCT FROM p->'expectedAnswerSpec' OR q.definition->'question' IS DISTINCT FROM p->'question'
   OR q.definition->'requestedResponder' IS DISTINCT FROM jsonb_build_object('principalKind','HUMAN','roleCode','project.customer_material.confirmer','scopeRef',jsonb_build_object('enterpriseId',NEW.enterprise_id,'projectId',NEW.project_id))
   OR q.definition - ARRAY['taskRef','workOrderRef','runRef','requestType','question','reason','expectedAnswerSpec','blocking','requestedResponder','relatedRefs','expiresAt'] IS DISTINCT FROM '{}'::jsonb
   OR q.definition->'reason' IS DISTINCT FROM p->'reason' OR q.definition->'requestType' IS DISTINCT FROM p->'requestType' OR q.definition->'blocking' IS DISTINCT FROM 'true'::jsonb
   OR NOT EXISTS(SELECT 1 FROM task_execution.run_final_submission_claim fc WHERE fc.run_id=r.run_id AND fc.result_id=ar.result_id AND fc.result_payload_hash=ar.result_payload_hash)) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Request origin is not accepted terminal source' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='answer_submission' THEN
  IF (c.command_type<>'execution.submit_information_answer' OR q.status<>'ANSWERED'
   OR NEW.canonical_payload - ARRAY['answerId','informationRequestRef','answer','actorSnapshotRef','authorizationDecisionRef','recordedAt'] IS DISTINCT FROM '{}'::jsonb
   OR NEW.canonical_payload->'answer'->'sourceRefs' IS DISTINCT FROM q.definition->'expectedAnswerSpec'->'requiredSourceRefs'
   OR NEW.canonical_payload->'answer'->'answerContent'->'candidateMaterialRef' IS DISTINCT FROM q.definition->'expectedAnswerSpec'->'candidateMaterialRef'
   OR (NEW.canonical_payload->'answer'->>'submittedAt')::timestamptz>NEW.recorded_at OR NEW.recorded_at>=q.expires_at
   OR NEW.canonical_payload->>'answerId'<>NEW.answer_id::text
   OR NEW.canonical_payload->'informationRequestRef' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','execution.information_request',q.request_id,NEW.enterprise_id,NEW.project_id)
   OR NEW.canonical_payload->'answer' IS DISTINCT FROM cp->'answer'
   OR NEW.canonical_payload->'answer'->'payloadHash'->>'digest'<>encode(task_execution.recovery_payload_hash((NEW.canonical_payload->'answer')-'payloadHash'),'hex')
   OR (NEW.canonical_payload->>'recordedAt')::timestamptz IS DISTINCT FROM NEW.recorded_at
   OR NEW.canonical_payload->'answer'->>'answerId' IS DISTINCT FROM NEW.answer_id::text
   OR NEW.canonical_payload->'answer'->'responder' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','zhiju.identity.principal',c.created_by_principal_id,NEW.enterprise_id,NEW.project_id)
   OR NEW.canonical_payload->'actorSnapshotRef' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','zhiju.identity.actor_snapshot',c.actor_snapshot_id,NEW.enterprise_id,NEW.project_id)
   OR NEW.canonical_payload->'authorizationDecisionRef' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','zhiju.identity.authorization_decision',c.authorization_decision_id,NEW.enterprise_id,NEW.project_id)
   OR platform_security.context_principal_kind()<>'HUMAN') IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Answer identity or command mismatch' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='answer_resolution' THEN
  SELECT * INTO a FROM task_execution.answer_submission WHERE answer_id=NEW.answer_id;
  SELECT * INTO o FROM task_execution.information_request_origin WHERE request_id=q.request_id;
  IF (c.command_type<>'execution.resolve_information_request' OR q.status<>'RESOLVED' OR a.request_id IS DISTINCT FROM q.request_id
   OR NEW.canonical_payload - ARRAY['resolutionId','informationRequestRef','sourceAgentResultRef','proposalId','sourceAcceptanceRef','previousRunRef','acceptedAnswerRef','resolutionDisposition','domainCommandRefs','receiptAttestationHash','confirmationDecisionRef','confirmationActorSnapshotRef','confirmationAuthorizationDecisionRef','resolvedBy','resolverActorSnapshotRef','resolverAuthorizationDecisionRef','resolvedAt','effectiveAt'] IS DISTINCT FROM '{}'::jsonb
   OR NEW.canonical_payload->>'resolutionId' IS DISTINCT FROM NEW.resolution_id::text
   OR NEW.canonical_payload->'informationRequestRef' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','execution.information_request',q.request_id,NEW.enterprise_id,NEW.project_id)
   OR q.accepted_answer_ref IS DISTINCT FROM task_execution.recovery_ref('CONTENT_ADDRESSED','execution.information_answer',a.answer_id,NEW.enterprise_id,NEW.project_id,a.payload_hash)
   OR q.resolution_ref IS DISTINCT FROM task_execution.recovery_ref('CONTENT_ADDRESSED','execution.information_request_resolution',NEW.resolution_id,NEW.enterprise_id,NEW.project_id,NEW.payload_hash)
   OR NEW.canonical_payload->'acceptedAnswerRef' IS DISTINCT FROM q.accepted_answer_ref
   OR NEW.canonical_payload->'sourceAgentResultRef' IS DISTINCT FROM o.source_result_ref OR NEW.canonical_payload->'sourceAcceptanceRef' IS DISTINCT FROM o.source_acceptance_ref
   OR NEW.canonical_payload->'previousRunRef' IS DISTINCT FROM o.previous_run_ref OR NEW.canonical_payload->>'proposalId'<>o.proposal_id::text
   OR NEW.canonical_payload->'resolvedBy' IS DISTINCT FROM a.canonical_payload->'answer'->'responder'
   OR NEW.canonical_payload->'resolvedBy'->>'objectId'<>c.created_by_principal_id::text
   OR NEW.canonical_payload->'domainCommandRefs' IS DISTINCT FROM cp->'domainCommandRefs'
   OR NEW.canonical_payload->'acceptedAnswerRef' IS DISTINCT FROM cp->'acceptedAnswerRef'
   OR NEW.canonical_payload->>'resolutionDisposition'<>'execution.resolution.customer_material_confirmed'
   OR NEW.canonical_payload->'resolvedBy' IS DISTINCT FROM cp->'resolvedBy'
   OR NEW.canonical_payload->'resolvedAt' IS DISTINCT FROM cp->'resolvedAt'
   OR NEW.canonical_payload->'resolverActorSnapshotRef' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','zhiju.identity.actor_snapshot',c.actor_snapshot_id,NEW.enterprise_id,NEW.project_id)
   OR NEW.canonical_payload->'resolverAuthorizationDecisionRef' IS DISTINCT FROM task_execution.recovery_ref('OBJECT','zhiju.identity.authorization_decision',c.authorization_decision_id,NEW.enterprise_id,NEW.project_id)
   OR NEW.effective_at<a.recorded_at OR NEW.effective_at>=q.expires_at
   OR (NEW.canonical_payload->>'effectiveAt')::timestamptz IS DISTINCT FROM NEW.effective_at) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Resolution source or command mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $guard$;

DO $body$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['recovery_command_material','information_request','information_request_origin','answer_submission','answer_resolution','resolution_receipt_observation'] LOOP
  EXECUTE format('ALTER TABLE task_execution.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE task_execution.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY recovery_select ON task_execution.%I FOR SELECT TO task_execution_app USING (platform_security.context_allows_project(enterprise_id,project_id))',t);
  EXECUTE format('CREATE POLICY recovery_insert ON task_execution.%I FOR INSERT TO task_execution_app WITH CHECK (platform_security.context_allows_project(enterprise_id,project_id))',t);
  EXECUTE format('CREATE POLICY recovery_owner ON task_execution.%I FOR ALL TO task_execution_owner USING (true) WITH CHECK(true)',t);
  EXECUTE format('REVOKE UPDATE,DELETE ON task_execution.%I FROM task_execution_app',t);
  EXECUTE format('GRANT SELECT,INSERT ON task_execution.%I TO task_execution_app',t);
  IF t NOT IN ('information_request','recovery_command_material') THEN
   EXECUTE format('CREATE TRIGGER recovery_fact_guard BEFORE INSERT OR UPDATE OR DELETE ON task_execution.%I FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_fact()',t);
  END IF;
 END LOOP;
END $body$;
GRANT UPDATE ON task_execution.information_request TO task_execution_app;
CREATE POLICY recovery_update ON task_execution.information_request FOR UPDATE TO task_execution_app USING (platform_security.context_allows_project(enterprise_id,project_id)) WITH CHECK (platform_security.context_allows_project(enterprise_id,project_id));

CREATE FUNCTION task_execution.guard_recovery_request_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE q task_execution.information_request%ROWTYPE;
BEGIN
 SELECT * INTO q FROM task_execution.information_request WHERE request_id=NEW.request_id;
 IF (NOT EXISTS(SELECT 1 FROM task_execution.information_request_origin o WHERE o.request_id=q.request_id)
  OR (q.status IN ('ANSWERED','RESOLVED') AND NOT EXISTS(SELECT 1 FROM task_execution.answer_submission a WHERE a.request_id=q.request_id))
  OR (q.status='RESOLVED' AND NOT EXISTS(SELECT 1 FROM task_execution.answer_resolution r JOIN task_execution.resolution_receipt_observation o USING(resolution_id) WHERE r.request_id=q.request_id))
  OR NOT EXISTS(SELECT 1 FROM task_execution.command_receipt c WHERE c.command_id=q.last_command_id AND c.outcome='COMMITTED')) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Recovery Request has incomplete committed facts' USING ERRCODE='23514'; END IF;
 IF ((SELECT count(*) FROM task_execution.outbox_event e WHERE e.event_type='execution.InformationRequestOpened' AND e.aggregate_id=q.request_id AND e.source_command_id=q.source_command_id AND e.payload->'informationRequestRef'=task_execution.recovery_ref('OBJECT','execution.information_request',q.request_id,q.enterprise_id,q.project_id))<>1
  OR (q.status='RESOLVED' AND (SELECT count(*) FROM task_execution.outbox_event e JOIN task_execution.answer_resolution r ON r.source_command_id=e.source_command_id WHERE r.request_id=q.request_id AND e.event_type='execution.InformationRequestResolved' AND e.aggregate_id=q.request_id AND e.payload->'resolutionRef'=q.resolution_ref)<>1)) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'Recovery Request events are incomplete' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $guard$;
CREATE CONSTRAINT TRIGGER recovery_request_complete AFTER INSERT OR UPDATE ON task_execution.information_request DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_request_complete();
CREATE FUNCTION task_execution.guard_recovery_committed_receipt() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE id uuid;
BEGIN
 id:=coalesce(to_jsonb(NEW)->>'source_command_id',to_jsonb(NEW)->>'command_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM task_execution.command_receipt c WHERE c.command_id=id AND c.outcome='COMMITTED' AND c.enterprise_id=NEW.enterprise_id AND c.project_id=NEW.project_id)
 THEN RAISE EXCEPTION 'Recovery fact has no committed Receipt' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $guard$;
DO $body$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['recovery_command_material','information_request_origin','answer_submission','answer_resolution','resolution_receipt_observation'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER recovery_committed_receipt AFTER INSERT ON task_execution.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION task_execution.guard_recovery_committed_receipt()',t);
 END LOOP;
END $body$;
REVOKE ALL ON FUNCTION task_execution.guard_recovery_committed_receipt() FROM PUBLIC;
REVOKE ALL ON FUNCTION task_execution.guard_recovery_request(), task_execution.guard_recovery_fact(), task_execution.guard_recovery_request_complete(), task_execution.guard_recovery_command_material(), task_execution.recovery_ref(text,text,uuid,uuid,uuid,bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION task_execution.recovery_ref(text,text,uuid,uuid,uuid,bytea) TO task_execution_app;
RESET ROLE;
