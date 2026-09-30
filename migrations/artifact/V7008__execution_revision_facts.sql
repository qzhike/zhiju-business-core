-- #235: immutable Human execution output binding and actual command Receipt.
SET ROLE artifact_owner;
CREATE FUNCTION artifact.canonical_jsonb_text(p_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $fn$
DECLARE
    item record;
    kind text;
    result text;
    separator text := '';
    number_value numeric;
    normalized_key text;
    previous_key text;
BEGIN
    kind := jsonb_typeof(p_value);
    IF kind = 'object' THEN
        result := '{';
        FOR item IN
            SELECT key, value
              FROM jsonb_each(p_value)
             ORDER BY encode(convert_to(normalize(key, NFC), 'UTF8'), 'hex')
        LOOP
            normalized_key := normalize(item.key, NFC);
            -- The scan is ordered by the normalized bytes, so a collision is
            -- always adjacent to its twin.
            IF normalized_key = previous_key THEN
                RAISE EXCEPTION 'canonical JSON property names collide after NFC normalization'
                    USING ERRCODE = '22023';
            END IF;
            previous_key := normalized_key;
            result := result
                || separator
                || to_jsonb(normalized_key)::text
                || ':'
                || artifact.canonical_jsonb_text(item.value);
            separator := ',';
        END LOOP;
        RETURN result || '}';
    ELSIF kind = 'array' THEN
        result := '[';
        FOR item IN
            SELECT value
              FROM jsonb_array_elements(p_value) WITH ORDINALITY AS elements(value, ordinal)
             ORDER BY ordinal
        LOOP
            result := result
                || separator
                || artifact.canonical_jsonb_text(item.value);
            separator := ',';
        END LOOP;
        RETURN result || ']';
    ELSIF kind = 'string' THEN
        RETURN to_jsonb(normalize(p_value #>> '{}', NFC))::text;
    ELSIF kind = 'number' THEN
        number_value := (p_value #>> '{}')::numeric;
        IF number_value <> trunc(number_value)
           OR abs(number_value) > 9007199254740991::numeric THEN
            RAISE EXCEPTION 'canonical JSON number is not a safe integer'
                USING ERRCODE = '22023';
        END IF;
        RETURN trunc(number_value)::text;
    ELSIF kind = 'boolean' THEN
        RETURN p_value #>> '{}';
    ELSIF kind = 'null' THEN
        RETURN 'null';
    END IF;
    RAISE EXCEPTION 'unsupported JSON value in canonical payload'
        USING ERRCODE = '22023';
END
$fn$;


CREATE FUNCTION artifact.execution_payload_hash(payload jsonb) RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $body$
 SELECT sha256(convert_to(artifact.canonical_jsonb_text(payload),'UTF8'))
$body$;
REVOKE ALL ON FUNCTION artifact.canonical_jsonb_text(jsonb),artifact.execution_payload_hash(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION artifact.execution_payload_hash(jsonb) TO artifact_app;
CREATE TABLE artifact.execution_revision_command_receipt (
 revision_id uuid PRIMARY KEY REFERENCES artifact.artifact_revision(revision_id),
 command_id uuid NOT NULL UNIQUE REFERENCES artifact.command_receipt(command_id),
 enterprise_id uuid NOT NULL, project_id uuid NOT NULL,
 canonical_payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 UNIQUE(revision_id,command_id,enterprise_id,project_id)
);
CREATE TABLE artifact.execution_revision_creation_binding (
 revision_id uuid PRIMARY KEY REFERENCES artifact.artifact_revision(revision_id),
 command_id uuid NOT NULL UNIQUE REFERENCES artifact.command_receipt(command_id),
 enterprise_id uuid NOT NULL, project_id uuid NOT NULL,
 canonical_payload jsonb NOT NULL, payload_hash bytea NOT NULL CHECK(octet_length(payload_hash)=32),
 FOREIGN KEY(revision_id,command_id,enterprise_id,project_id) REFERENCES artifact.execution_revision_command_receipt(revision_id,command_id,enterprise_id,project_id)
);
CREATE FUNCTION artifact.guard_execution_revision_fact() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE r artifact.artifact_revision%ROWTYPE; c artifact.command_receipt%ROWTYPE; b jsonb; receipt jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'execution output facts are immutable' USING ERRCODE='55000'; END IF;
 SELECT * INTO r FROM artifact.artifact_revision WHERE revision_id=NEW.revision_id;
 SELECT * INTO c FROM artifact.command_receipt WHERE command_id=NEW.command_id;
 b:=NEW.canonical_payload;
 IF (NEW.payload_hash<>artifact.execution_payload_hash(b)
  OR r.revision_id IS NULL OR r.source_command_id<>NEW.command_id OR r.enterprise_id<>NEW.enterprise_id OR r.project_id<>NEW.project_id
  OR r.content_type<>'STRUCTURED_DOCUMENT' OR r.revision_kind<>'INITIAL'
  OR c.command_type IS DISTINCT FROM 'artifact.create_execution_revision' OR c.command_version<>'1.0' OR c.target_type<>'artifact.artifact_revision'
  OR c.target_id<>NEW.revision_id OR c.outcome<>'PENDING' OR c.enterprise_id<>NEW.enterprise_id OR c.project_id<>NEW.project_id
  OR c.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
  OR platform_security.context_principal_kind() IS DISTINCT FROM 'HUMAN'
  OR c.authorization_decision_id IS DISTINCT FROM (SELECT decision_id FROM platform_security.context_authorization_decision_ref())
  OR b->'revisionRef'->>'objectId' IS DISTINCT FROM NEW.revision_id::text
  OR b->'revisionRef'->>'kind' IS DISTINCT FROM 'CONTENT_ADDRESSED' OR b->'revisionRef'->>'objectType' IS DISTINCT FROM 'artifact.artifact_revision'
  OR b->'revisionRef'->'scope' IS DISTINCT FROM jsonb_build_object('enterpriseId',NEW.enterprise_id,'projectId',NEW.project_id)
  OR b->'revisionRef'->'contentHash' IS DISTINCT FROM jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(r.content_hash,'hex'))) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'execution output fact mirror mismatch' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='execution_revision_command_receipt' THEN
  IF (b->>'commandId' IS DISTINCT FROM NEW.command_id::text OR b->>'commandType' IS DISTINCT FROM c.command_type OR b->>'commandVersion' IS DISTINCT FROM c.command_version
   OR b->>'outcome' IS DISTINCT FROM 'COMMITTED' OR b->'scopeRef' IS DISTINCT FROM jsonb_build_object('enterpriseId',NEW.enterprise_id,'projectId',NEW.project_id)
   OR b->'targetRef' IS DISTINCT FROM jsonb_build_object('kind','OBJECT','objectType',c.target_type,'objectId',c.target_id,'scope',b->'scopeRef')
   OR b->'requestPayloadHash'->>'digest' IS DISTINCT FROM encode(c.request_payload_hash,'hex')
   OR b->'actorRef' IS DISTINCT FROM r.provenance->'principal'
   OR b->'actorRef'->>'objectId' IS DISTINCT FROM c.created_by_principal_id::text
   OR b->'actorSnapshotRef'->>'snapshotId' IS DISTINCT FROM c.actor_snapshot_id::text
   OR b->'authorizationDecisionRef' IS DISTINCT FROM jsonb_build_object('kind','CONTENT_ADDRESSED','objectType','identity.authorization_decision','objectId',c.authorization_decision_id,'scope',jsonb_build_object('enterpriseId',NEW.enterprise_id,'projectId',NEW.project_id),'contentHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',(SELECT encode(payload_hash,'hex') FROM platform_security.context_authorization_decision_ref())))
  OR (b->'actorSnapshotRef') - 'contentHash' IS DISTINCT FROM jsonb_build_object('kind','SNAPSHOT','objectType','identity.actor_snapshot','objectId',c.actor_snapshot_id,'snapshotId',c.actor_snapshot_id,'scope',jsonb_build_object('enterpriseId',NEW.enterprise_id,'projectId',NEW.project_id))
  OR (b->'actorSnapshotRef'->'contentHash') - 'digest' IS DISTINCT FROM '{"algorithm":"SHA-256","canonicalizationVersion":"1"}'::jsonb
  OR b->'actorSnapshotRef'->'contentHash'->>'digest' !~ '^[0-9a-f]{64}$'
   OR (SELECT count(*) FROM jsonb_object_keys(b))<>12) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'execution creation Receipt mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT canonical_payload INTO receipt FROM artifact.execution_revision_command_receipt WHERE revision_id=NEW.revision_id AND command_id=NEW.command_id;
  IF (receipt IS NULL OR b->'creationCommandRef' IS DISTINCT FROM jsonb_build_object('kind','CONTENT_ADDRESSED','objectType','zhiju.artifact.command_receipt','objectId',NEW.command_id,'scope',receipt->'scopeRef','contentHash',jsonb_build_object('algorithm','SHA-256','canonicalizationVersion','1','digest',encode(artifact.execution_payload_hash(receipt),'hex')))
   OR b->'taskRef' IS DISTINCT FROM r.provenance->'taskRef' OR b->'workOrderRef' IS DISTINCT FROM r.provenance->'workOrderRef'
   OR b->'runRef' IS DISTINCT FROM r.provenance->'runRef' OR b->'contextSnapshotRef' IS DISTINCT FROM r.provenance->'contextSnapshotRef'
   OR r.provenance ? 'agentResultRef' OR r.provenance ? 'actingForRef' OR r.provenance->'sourceMaterialRefs'<>'[]'::jsonb OR r.provenance->'toolchainVersions'<>'[]'::jsonb
   OR (b->>'createdAt')::timestamptz<>(receipt->>'committedAt')::timestamptz
   OR (b->>'createdAt')::timestamptz<(b->>'startedAt')::timestamptz
   OR (b->>'createdAt')::timestamptz<(b->>'bindingObservedAt')::timestamptz
   OR (b->>'createdAt')::timestamptz>=(b->>'bindingValidUntil')::timestamptz
   OR (SELECT count(*) FROM jsonb_object_keys(b))<>14) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'execution creation binding mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $guard$;
CREATE FUNCTION artifact.assert_execution_revision_commit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $guard$
DECLARE c artifact.command_receipt%ROWTYPE; receipt artifact.execution_revision_command_receipt%ROWTYPE; binding artifact.execution_revision_creation_binding%ROWTYPE;
BEGIN
 SELECT * INTO c FROM artifact.command_receipt WHERE command_id=NEW.command_id;
 SELECT * INTO receipt FROM artifact.execution_revision_command_receipt WHERE command_id=NEW.command_id;
 SELECT * INTO binding FROM artifact.execution_revision_creation_binding WHERE command_id=NEW.command_id;
 IF (c.outcome IS DISTINCT FROM 'COMMITTED' OR receipt.command_id IS NULL OR binding.command_id IS NULL
  OR c.result_payload->'revisionRef' IS DISTINCT FROM receipt.canonical_payload->'revisionRef'
  OR c.result_payload->'creationCommandRef' IS DISTINCT FROM binding.canonical_payload->'creationCommandRef'
  OR NOT EXISTS(SELECT 1 FROM artifact.outbox_event e WHERE e.source_command_id=c.command_id AND e.event_type='artifact.ArtifactRevisionSealed' AND e.aggregate_id=receipt.revision_id)) IS DISTINCT FROM FALSE THEN RAISE EXCEPTION 'execution output commit incomplete' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $guard$;
CREATE TRIGGER execution_revision_command_receipt_immutable BEFORE INSERT OR UPDATE OR DELETE ON artifact.execution_revision_command_receipt FOR EACH ROW EXECUTE FUNCTION artifact.guard_execution_revision_fact();
CREATE CONSTRAINT TRIGGER execution_revision_command_receipt_committed AFTER INSERT ON artifact.execution_revision_command_receipt DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION artifact.assert_execution_revision_commit();
ALTER TABLE artifact.execution_revision_command_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.execution_revision_command_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY execution_revision_command_receipt_project ON artifact.execution_revision_command_receipt TO artifact_app USING(platform_security.context_allows_project(enterprise_id,project_id)) WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id));
CREATE POLICY execution_revision_command_receipt_owner ON artifact.execution_revision_command_receipt TO artifact_owner USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON artifact.execution_revision_command_receipt TO artifact_app;
REVOKE UPDATE,DELETE ON artifact.execution_revision_command_receipt FROM artifact_app;
CREATE TRIGGER execution_revision_creation_binding_immutable BEFORE INSERT OR UPDATE OR DELETE ON artifact.execution_revision_creation_binding FOR EACH ROW EXECUTE FUNCTION artifact.guard_execution_revision_fact();
CREATE CONSTRAINT TRIGGER execution_revision_creation_binding_committed AFTER INSERT ON artifact.execution_revision_creation_binding DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION artifact.assert_execution_revision_commit();
ALTER TABLE artifact.execution_revision_creation_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact.execution_revision_creation_binding FORCE ROW LEVEL SECURITY;
CREATE POLICY execution_revision_creation_binding_project ON artifact.execution_revision_creation_binding TO artifact_app USING(platform_security.context_allows_project(enterprise_id,project_id)) WITH CHECK(platform_security.context_allows_project(enterprise_id,project_id));
CREATE POLICY execution_revision_creation_binding_owner ON artifact.execution_revision_creation_binding TO artifact_owner USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON artifact.execution_revision_creation_binding TO artifact_app;
REVOKE UPDATE,DELETE ON artifact.execution_revision_creation_binding FROM artifact_app;
REVOKE ALL ON FUNCTION artifact.guard_execution_revision_fact(),artifact.assert_execution_revision_commit() FROM PUBLIC;
RESET ROLE;
