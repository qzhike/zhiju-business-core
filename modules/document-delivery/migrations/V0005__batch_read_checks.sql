-- Persistent technical read checks; original sources and manifests stay immutable.
SET ROLE mvp_ddl;

ALTER TABLE document_delivery.requests DROP CONSTRAINT requests_operation_check,
  ADD CONSTRAINT requests_operation_check CHECK (operation IN (
    'mvp.create_project','mvp.create_input_batch','mvp.recover_input_batch','mvp.create_batch_read_check'
  ));

CREATE TABLE document_delivery.read_checks (
  owner_id uuid NOT NULL, project_id uuid NOT NULL, batch_id uuid NOT NULL, check_id uuid NOT NULL,
  manifest_id uuid NOT NULL, manifest_hash bytea NOT NULL CHECK (octet_length(manifest_hash)=32),
  profile_id text NOT NULL, profile_hash bytea NOT NULL CHECK (octet_length(profile_hash)=32),
  request_id uuid NOT NULL, authorized_auth_epoch bigint NOT NULL CHECK (authorized_auth_epoch>0),
  status text NOT NULL CHECK (status IN ('QUEUED','RUNNING','COMPLETED','INTERRUPTED','FAILED','UNKNOWN')),
  result_version bigint NOT NULL CHECK (result_version>0), total_entries integer NOT NULL CHECK (total_entries>=0),
  generation integer NOT NULL CHECK (generation>0), fencing_token uuid NOT NULL, process_incarnation text NOT NULL,
  creation_seq bigint GENERATED ALWAYS AS IDENTITY, created_at timestamptz NOT NULL,
  started_at timestamptz, ended_at timestamptz, reason_codes jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY(owner_id,project_id,batch_id,check_id), UNIQUE(owner_id,check_id), UNIQUE(owner_id,request_id),
  FOREIGN KEY(owner_id,project_id,batch_id,manifest_id) REFERENCES document_delivery.input_manifests(owner_id,project_id,batch_id,manifest_id),
  FOREIGN KEY(owner_id,project_id,request_id) REFERENCES document_delivery.requests(owner_id,project_id,request_id),
  CHECK (jsonb_typeof(reason_codes)='array' AND octet_length(reason_codes::text)<=4096),
  CHECK (reason_codes <@ '["AUTHORIZATION_CHANGED","CHECK_INTERRUPTED","CHECK_TIME_LIMIT","DEPENDENCY_UNAVAILABLE","STORAGE_INTEGRITY_ERROR"]'::jsonb),
  CHECK (status NOT IN ('RUNNING','UNKNOWN','COMPLETED','INTERRUPTED') OR started_at IS NOT NULL),
  CHECK ((status IN ('COMPLETED','INTERRUPTED','FAILED'))=(ended_at IS NOT NULL))
);
CREATE UNIQUE INDEX read_checks_active_project ON document_delivery.read_checks(owner_id,project_id)
  WHERE status IN ('QUEUED','RUNNING','UNKNOWN');

CREATE TABLE document_delivery.read_check_results (
  owner_id uuid NOT NULL, project_id uuid NOT NULL, batch_id uuid NOT NULL, check_id uuid NOT NULL,
  entry_id uuid NOT NULL, ordinal integer NOT NULL, generation integer NOT NULL, fencing_token uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('AVAILABLE','LIMITED','UNSUPPORTED','FAILED','NOT_ELIGIBLE')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object' AND octet_length(payload::text)<=16384),
  PRIMARY KEY(owner_id,project_id,batch_id,check_id,entry_id),
  UNIQUE(owner_id,project_id,batch_id,check_id,ordinal),
  FOREIGN KEY(owner_id,project_id,batch_id,check_id) REFERENCES document_delivery.read_checks(owner_id,project_id,batch_id,check_id),
  FOREIGN KEY(owner_id,project_id,batch_id,entry_id) REFERENCES document_delivery.source_entries(owner_id,project_id,batch_id,entry_id),
  CHECK ((payload->>'entryId') IS NOT DISTINCT FROM entry_id::text AND (payload->>'ordinal')::integer IS NOT DISTINCT FROM ordinal AND (payload->>'status') IS NOT DISTINCT FROM outcome),
  CHECK (payload ?& ARRAY['entryId','ordinal','status','profileId','checkedAt','limitations']),
  CHECK ((payload - ARRAY['entryId','ordinal','status','profileId','checkedAt','limitations','resultHash','counts'])='{}'::jsonb),
  CHECK (jsonb_typeof(payload->'limitations')='array'),
  CHECK ((outcome IN ('AVAILABLE','LIMITED'))=(payload ? 'resultHash' AND payload ? 'counts'))
);

CREATE TABLE document_delivery.read_check_events (
  owner_id uuid NOT NULL, project_id uuid NOT NULL, batch_id uuid NOT NULL, check_id uuid NOT NULL,
  event_seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, status text NOT NULL,
  result_version bigint NOT NULL, generation integer NOT NULL, reason_codes jsonb NOT NULL, created_at timestamptz NOT NULL,
  FOREIGN KEY(owner_id,project_id,batch_id,check_id) REFERENCES document_delivery.read_checks(owner_id,project_id,batch_id,check_id)
);

CREATE FUNCTION document_delivery.lock_read_check_binding(p_owner uuid)
RETURNS TABLE(enabled boolean,auth_epoch bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT b.enabled,b.auth_epoch FROM document_delivery.operator_binding b
  WHERE b.owner_id=p_owner AND p_owner=document_delivery.current_owner() FOR SHARE
$$;

CREATE FUNCTION document_delivery.pending_read_checks()
RETURNS TABLE(owner_id uuid,project_id uuid,batch_id uuid,check_id uuid,status text,authorized_auth_epoch bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT c.owner_id,c.project_id,c.batch_id,c.check_id,c.status,c.authorized_auth_epoch
  FROM document_delivery.read_checks c WHERE c.status IN ('QUEUED','RUNNING','UNKNOWN') ORDER BY c.creation_seq
$$;

CREATE FUNCTION document_delivery.guard_read_check() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE request document_delivery.requests; manifest document_delivery.input_manifests;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'checks are not deletable' USING ERRCODE='55000'; END IF;
  IF TG_OP='INSERT' THEN
    SELECT * INTO request FROM document_delivery.requests WHERE owner_id=NEW.owner_id AND request_id=NEW.request_id;
    SELECT * INTO manifest FROM document_delivery.input_manifests WHERE owner_id=NEW.owner_id AND project_id=NEW.project_id AND batch_id=NEW.batch_id;
    IF NEW.status<>'QUEUED' OR NEW.result_version<>1 OR NEW.generation<>1 OR NEW.started_at IS NOT NULL
      OR request.operation IS DISTINCT FROM 'mvp.create_batch_read_check' OR request.target_id IS DISTINCT FROM NEW.batch_id
      OR (request.authorization_fact->>'authEpoch')::bigint IS DISTINCT FROM NEW.authorized_auth_epoch
      OR request.original_payload->>'manifestId' IS DISTINCT FROM NEW.manifest_id::text
      OR manifest.manifest_id IS DISTINCT FROM NEW.manifest_id OR manifest.manifest_hash IS DISTINCT FROM NEW.manifest_hash
      OR manifest.total_entries IS DISTINCT FROM NEW.total_entries THEN
      RAISE EXCEPTION 'invalid read check creation' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('COMPLETED','INTERRUPTED','FAILED') OR NEW.result_version<>OLD.result_version+1
    OR (to_jsonb(NEW)-ARRAY['status','result_version','generation','fencing_token','process_incarnation','started_at','ended_at','reason_codes'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','result_version','generation','fencing_token','process_incarnation','started_at','ended_at','reason_codes'])
    OR (OLD.started_at IS NOT NULL AND NEW.started_at IS DISTINCT FROM OLD.started_at)
    OR NEW.generation NOT IN (OLD.generation,OLD.generation+1)
    OR (NEW.generation=OLD.generation AND NEW.fencing_token<>OLD.fencing_token)
    OR (NEW.generation<>OLD.generation AND (NEW.fencing_token=OLD.fencing_token OR NEW.status NOT IN ('COMPLETED','INTERRUPTED')))
    OR (OLD.status<>'QUEUED' AND NEW.process_incarnation<>OLD.process_incarnation) THEN
    RAISE EXCEPTION 'immutable read check facts' USING ERRCODE='55000';
  END IF;
  IF NEW.status<>OLD.status AND NOT (OLD.status,NEW.status) IN (
    ('QUEUED','RUNNING'),('QUEUED','FAILED'),('RUNNING','COMPLETED'),('RUNNING','INTERRUPTED'),
    ('RUNNING','FAILED'),('RUNNING','UNKNOWN'),('UNKNOWN','INTERRUPTED'),('UNKNOWN','COMPLETED'),('UNKNOWN','FAILED')
  ) THEN RAISE EXCEPTION 'invalid read check transition' USING ERRCODE='55000'; END IF;
  IF NEW.status='COMPLETED' AND NEW.total_entries<>(SELECT count(*) FROM document_delivery.read_check_results r
    WHERE r.owner_id=NEW.owner_id AND r.project_id=NEW.project_id AND r.batch_id=NEW.batch_id AND r.check_id=NEW.check_id)
    THEN RAISE EXCEPTION 'incomplete read check' USING ERRCODE='55000'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION document_delivery.guard_read_check_result() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE task document_delivery.read_checks; entry document_delivery.source_entries; binding record;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'read results are immutable' USING ERRCODE='55000'; END IF;
  SELECT * INTO task FROM document_delivery.read_checks WHERE owner_id=NEW.owner_id AND project_id=NEW.project_id
    AND batch_id=NEW.batch_id AND check_id=NEW.check_id FOR UPDATE;
  SELECT * INTO entry FROM document_delivery.source_entries WHERE owner_id=NEW.owner_id AND project_id=NEW.project_id
    AND batch_id=NEW.batch_id AND entry_id=NEW.entry_id;
  SELECT * INTO binding FROM document_delivery.lock_read_check_binding(NEW.owner_id);
  IF task.status IS DISTINCT FROM 'RUNNING' OR task.generation IS DISTINCT FROM NEW.generation
    OR task.fencing_token IS DISTINCT FROM NEW.fencing_token OR task.manifest_id IS DISTINCT FROM entry.manifest_id
    OR entry.ordinal IS DISTINCT FROM NEW.ordinal OR task.profile_id IS DISTINCT FROM NEW.payload->>'profileId'
    OR binding.enabled IS DISTINCT FROM true OR binding.auth_epoch IS DISTINCT FROM task.authorized_auth_epoch
    OR (entry.status='ACCEPTED')=(NEW.outcome='NOT_ELIGIBLE') THEN
    RAISE EXCEPTION 'read result binding rejected' USING ERRCODE='55000';
  END IF;
  IF NOT (NEW.payload->'limitations' <@ '["EXTERNAL_TEMPLATE_NOT_LOADED","EXTRACTED_VIEW_ONLY","TABLE_TEXT_REPEATED","NUMBERING_NOT_RENDERED","TEXT_REVISIONS_ONLY","MEDIA_NOT_INTERPRETED","INCOMPLETE_EXTRACTION","FORMAT_NOT_SUPPORTED","NESTED_TABLE_NOT_SUPPORTED","EMPTY_CONTENT","UNSAFE_CONTENT","RESOURCE_LIMIT","TIMEOUT","INVALID_READER_OUTPUT"]'::jsonb)
    OR jsonb_typeof(NEW.payload->'checkedAt') IS DISTINCT FROM 'string'
    OR NEW.payload->>'checkedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    OR (NEW.outcome NOT IN ('AVAILABLE','LIMITED') AND NEW.payload ?| ARRAY['resultHash','counts']) THEN
    RAISE EXCEPTION 'invalid read metadata' USING ERRCODE='55000';
  END IF;
  IF NEW.outcome IN ('AVAILABLE','LIMITED') THEN
    IF jsonb_typeof(NEW.payload->'resultHash') IS DISTINCT FROM 'string' OR NEW.payload->>'resultHash' !~ '^[0-9a-f]{64}$' OR jsonb_typeof(NEW.payload->'counts') IS DISTINCT FROM 'object'
      OR NOT (NEW.payload->'counts' ?& ARRAY['paragraphs','tables','comments','revisions','headersFooters','characters'])
      OR ((NEW.payload->'counts') - ARRAY['paragraphs','tables','comments','revisions','headersFooters','characters'])<>'{}'::jsonb THEN
      RAISE EXCEPTION 'invalid read content metadata' USING ERRCODE='55000';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_each(NEW.payload->'counts') v WHERE jsonb_typeof(v.value)<>'number' OR v.value::text !~ '^[0-9]+$') THEN
      RAISE EXCEPTION 'invalid read counts' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION document_delivery.observe_read_check() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.status<>OLD.status THEN
    INSERT INTO document_delivery.read_check_events(owner_id,project_id,batch_id,check_id,status,result_version,generation,reason_codes,created_at)
    VALUES(NEW.owner_id,NEW.project_id,NEW.batch_id,NEW.check_id,NEW.status,NEW.result_version,NEW.generation,NEW.reason_codes,clock_timestamp());
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER read_checks_guard BEFORE INSERT OR UPDATE OR DELETE ON document_delivery.read_checks FOR EACH ROW EXECUTE FUNCTION document_delivery.guard_read_check();
CREATE TRIGGER read_checks_observe AFTER INSERT OR UPDATE ON document_delivery.read_checks FOR EACH ROW EXECUTE FUNCTION document_delivery.observe_read_check();
CREATE TRIGGER read_check_results_guard BEFORE INSERT OR UPDATE OR DELETE ON document_delivery.read_check_results FOR EACH ROW EXECUTE FUNCTION document_delivery.guard_read_check_result();
CREATE TRIGGER read_check_events_guard BEFORE UPDATE OR DELETE ON document_delivery.read_check_events FOR EACH ROW EXECUTE FUNCTION document_delivery.guard_requests();

ALTER TABLE document_delivery.read_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.read_checks FORCE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.read_check_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.read_check_results FORCE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.read_check_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.read_check_events FORCE ROW LEVEL SECURITY;
CREATE POLICY read_checks_owner ON document_delivery.read_checks TO mvp_ddl USING(true) WITH CHECK(true);
CREATE POLICY read_check_results_owner ON document_delivery.read_check_results TO mvp_ddl USING(true) WITH CHECK(true);
CREATE POLICY read_check_events_owner ON document_delivery.read_check_events TO mvp_ddl USING(true) WITH CHECK(true);
CREATE POLICY read_checks_runtime ON document_delivery.read_checks TO mvp_runtime
  USING(owner_id=document_delivery.current_owner() AND project_id::text=current_setting('mvp.project_id',true))
  WITH CHECK(owner_id=document_delivery.current_owner() AND project_id::text=current_setting('mvp.project_id',true));
CREATE POLICY read_check_results_runtime ON document_delivery.read_check_results TO mvp_runtime
  USING(owner_id=document_delivery.current_owner() AND project_id::text=current_setting('mvp.project_id',true))
  WITH CHECK(owner_id=document_delivery.current_owner() AND project_id::text=current_setting('mvp.project_id',true));
CREATE POLICY read_check_events_runtime ON document_delivery.read_check_events TO mvp_runtime
  USING(owner_id=document_delivery.current_owner() AND project_id::text=current_setting('mvp.project_id',true))
  WITH CHECK(owner_id=document_delivery.current_owner() AND project_id::text=current_setting('mvp.project_id',true));
REVOKE ALL ON document_delivery.read_checks,document_delivery.read_check_results,document_delivery.read_check_events FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON document_delivery.read_checks TO mvp_runtime;
GRANT SELECT,INSERT ON document_delivery.read_check_results,document_delivery.read_check_events TO mvp_runtime;
GRANT USAGE,SELECT ON SEQUENCE document_delivery.read_checks_creation_seq_seq,document_delivery.read_check_events_event_seq_seq TO mvp_runtime;
REVOKE ALL ON FUNCTION document_delivery.lock_read_check_binding(uuid),document_delivery.pending_read_checks(),document_delivery.guard_read_check(),document_delivery.guard_read_check_result(),document_delivery.observe_read_check() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION document_delivery.lock_read_check_binding(uuid),document_delivery.pending_read_checks() TO mvp_runtime;
RESET ROLE;
