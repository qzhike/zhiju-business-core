-- MVP01 DocumentDelivery owning schema in the dedicated MVP database.
-- This migration history is separate from the legacy public Flyway history.
-- The owning schema never reads or references old module schemas.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mvp_ddl') THEN
    CREATE ROLE mvp_ddl NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mvp_runtime') THEN
    CREATE ROLE mvp_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS document_delivery AUTHORIZATION mvp_ddl;
REVOKE ALL ON SCHEMA document_delivery FROM PUBLIC;
GRANT USAGE ON SCHEMA document_delivery TO mvp_runtime;

SET ROLE mvp_ddl;

CREATE TABLE document_delivery.installation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  instance_id text NOT NULL CHECK (instance_id ~ '^[0-9a-f]{16}$'),
  schema_version text NOT NULL CHECK (schema_version = 'mvp.document_delivery@1'),
  store_id uuid NOT NULL,
  store_identity text NOT NULL CHECK (store_identity ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL
);

CREATE TABLE document_delivery.operator_binding (
  owner_id uuid PRIMARY KEY,
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 2048),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 512),
  enabled boolean NOT NULL,
  auth_epoch bigint NOT NULL CHECK (auth_epoch >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (issuer, subject)
);

CREATE TABLE document_delivery.projects (
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL,
  customer_name text NOT NULL CHECK (octet_length(customer_name) BETWEEN 1 AND 512),
  title text NOT NULL CHECK (octet_length(title) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL,
  creation_seq bigint GENERATED ALWAYS AS IDENTITY,
  version bigint NOT NULL CHECK (version >= 1),
  last_batch_no integer NOT NULL CHECK (last_batch_no >= 0),
  active_batch_id uuid,
  PRIMARY KEY (owner_id, project_id),
  UNIQUE (owner_id, creation_seq)
);

CREATE TABLE document_delivery.requests (
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL,
  request_id uuid NOT NULL,
  operation text NOT NULL CHECK (
    operation IN (
      'mvp.create_project',
      'mvp.create_input_batch',
      'mvp.recover_input_batch'
    )
  ),
  target_id uuid NOT NULL,
  original_payload jsonb NOT NULL CHECK (jsonb_typeof(original_payload) = 'object'),
  payload_hash bytea NOT NULL CHECK (octet_length(payload_hash) = 32),
  authorization_fact jsonb NOT NULL CHECK (jsonb_typeof(authorization_fact) = 'object'),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  committed_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, request_id),
  UNIQUE (owner_id, project_id, request_id),
  FOREIGN KEY (owner_id, project_id)
    REFERENCES document_delivery.projects (owner_id, project_id),
  CHECK (authorization_fact ? 'ownerId' AND authorization_fact ? 'authEpoch'
    AND authorization_fact ? 'authorizedAt'),
  CHECK ((authorization_fact ->> 'ownerId')::uuid = owner_id),
  CHECK ((authorization_fact ->> 'authEpoch')::bigint >= 1),
  CHECK (receipt ? 'requestId' AND receipt ? 'projectId' AND receipt ? 'operation'
    AND receipt ? 'targetId' AND receipt ? 'payloadHash' AND receipt ? 'committedAt'
    AND receipt ? 'result'),
  CHECK ((receipt ->> 'requestId')::uuid = request_id),
  CHECK ((receipt ->> 'projectId')::uuid = project_id),
  CHECK (receipt ->> 'operation' = operation),
  CHECK ((receipt ->> 'targetId')::uuid = target_id),
  CHECK (receipt ->> 'payloadHash' = encode(payload_hash, 'hex'))
);

-- One durable creation request per target; recovery requests may repeat.
CREATE UNIQUE INDEX requests_creation_target_unique
  ON document_delivery.requests (owner_id, operation, target_id)
  WHERE operation IN ('mvp.create_project', 'mvp.create_input_batch');

CREATE TABLE document_delivery.input_batches (
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  batch_no integer NOT NULL CHECK (batch_no >= 1),
  kind text NOT NULL CHECK (kind IN ('INITIAL', 'SUPPLEMENT')),
  original_name text NOT NULL CHECK (octet_length(original_name) BETWEEN 1 AND 1024),
  declared_bytes bigint NOT NULL CHECK (declared_bytes BETWEEN 1 AND 104857600),
  zip_sha256 bytea NOT NULL CHECK (octet_length(zip_sha256) = 32),
  note text,
  policy_version text NOT NULL CHECK (policy_version = 'mvp.zip-input@1'),
  status text NOT NULL CHECK (
    status IN (
      'AWAITING_UPLOAD','RECEIVING','STAGED','EXTRACTING','RECEIVED',
      'PARTIAL','FAILED','REJECTED','ABANDONED','UNKNOWN'
    )
  ),
  generation integer NOT NULL CHECK (generation >= 1),
  version bigint NOT NULL CHECK (version >= 1),
  original_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  manifest_id uuid,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  original_zip_source jsonb,
  original_object_key text,
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, project_id, batch_id),
  UNIQUE (owner_id, project_id, batch_no),
  UNIQUE (owner_id, batch_id),
  FOREIGN KEY (owner_id, project_id)
    REFERENCES document_delivery.projects (owner_id, project_id),
  FOREIGN KEY (owner_id, project_id, original_request_id)
    REFERENCES document_delivery.requests (owner_id, project_id, request_id),
  CHECK ((kind = 'INITIAL') = (batch_no = 1)),
  CHECK (note IS NULL OR (octet_length(note) BETWEEN 1 AND 16384)),
  CHECK (original_zip_source IS NULL OR jsonb_typeof(original_zip_source) = 'object'),
  CHECK ((original_zip_source IS NULL) = (original_object_key IS NULL))
);

-- At most one receiving/extracting/unknown batch per project. RECEIVED,
-- PARTIAL, FAILED, REJECTED and ABANDONED release the project's active slot.
CREATE UNIQUE INDEX input_batches_active_project_unique
  ON document_delivery.input_batches (owner_id, project_id)
  WHERE status IN ('AWAITING_UPLOAD','RECEIVING','STAGED','EXTRACTING','UNKNOWN');

CREATE TABLE document_delivery.batch_attempts (
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('UPLOAD', 'EXTRACT')),
  number integer NOT NULL CHECK (number >= 1),
  generation integer NOT NULL CHECK (generation >= 1),
  creation_seq bigint GENERATED ALWAYS AS IDENTITY,
  status text NOT NULL CHECK (
    status IN ('PREPARED','RUNNING','SUCCEEDED','FAILED','UNKNOWN','ABANDONED')
  ),
  process_incarnation text NOT NULL,
  fencing_token uuid NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  staged_object_receipts jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(staged_object_receipts) = 'array'),
  authorization_request_id uuid NOT NULL,
  authorized_owner_id uuid NOT NULL,
  authorized_auth_epoch bigint NOT NULL CHECK (authorized_auth_epoch >= 1),
  original_input_sha256 bytea NOT NULL CHECK (octet_length(original_input_sha256) = 32),
  PRIMARY KEY (owner_id, project_id, batch_id, attempt_id),
  UNIQUE (owner_id, project_id, batch_id, kind, number),
  FOREIGN KEY (owner_id, project_id, batch_id)
    REFERENCES document_delivery.input_batches (owner_id, project_id, batch_id),
  FOREIGN KEY (owner_id, project_id, authorization_request_id)
    REFERENCES document_delivery.requests (owner_id, project_id, request_id),
  CHECK (authorized_owner_id = owner_id),
  CHECK ((status IN ('SUCCEEDED','FAILED','ABANDONED')) = (ended_at IS NOT NULL))
);

CREATE TABLE document_delivery.input_manifests (
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  manifest_id uuid NOT NULL,
  manifest_hash bytea NOT NULL CHECK (octet_length(manifest_hash) = 32),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  total_entries integer NOT NULL CHECK (total_entries >= 0),
  accepted_entries integer NOT NULL CHECK (accepted_entries >= 0),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, project_id, batch_id),
  UNIQUE (owner_id, manifest_id),
  UNIQUE (owner_id, project_id, batch_id, manifest_id),
  FOREIGN KEY (owner_id, project_id, batch_id)
    REFERENCES document_delivery.input_batches (owner_id, project_id, batch_id),
  CHECK (accepted_entries <= total_entries),
  CHECK (payload ? 'manifestId' AND payload ? 'batchId' AND payload ? 'projectId'
    AND payload ? 'ownerId' AND payload ? 'manifestHash'),
  CHECK (payload ->> 'manifestId' = manifest_id::text),
  CHECK (payload ->> 'batchId' = batch_id::text),
  CHECK (payload ->> 'projectId' = project_id::text),
  CHECK (payload ->> 'ownerId' = owner_id::text),
  CHECK (payload ->> 'manifestHash' = encode(manifest_hash, 'hex'))
);

CREATE TABLE document_delivery.source_entries (
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  manifest_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  original_name text NOT NULL CHECK (octet_length(original_name) BETWEEN 1 AND 1024),
  normalized_path text NOT NULL CHECK (octet_length(normalized_path) BETWEEN 1 AND 1024),
  status text NOT NULL CHECK (status IN ('ACCEPTED','UNSUPPORTED','CORRUPT','READ_LIMITED')),
  reason_codes jsonb NOT NULL CHECK (jsonb_typeof(reason_codes) = 'array'),
  media_type text,
  byte_length bigint CHECK (byte_length >= 0),
  sha256 bytea CHECK (sha256 IS NULL OR octet_length(sha256) = 32),
  source_id uuid,
  source_kind text CHECK (source_kind IS NULL OR source_kind = 'ACCEPTED_ENTRY'),
  source_sha256 bytea,
  source_byte_length bigint,
  source_media_type text,
  object_key text,
  PRIMARY KEY (owner_id, project_id, batch_id, entry_id),
  UNIQUE (owner_id, project_id, batch_id, manifest_id, ordinal),
  UNIQUE (owner_id, project_id, batch_id, source_id),
  FOREIGN KEY (owner_id, project_id, batch_id)
    REFERENCES document_delivery.input_batches (owner_id, project_id, batch_id),
  FOREIGN KEY (owner_id, project_id, batch_id, manifest_id)
    REFERENCES document_delivery.input_manifests (owner_id, project_id, batch_id, manifest_id),
  CHECK ((status = 'ACCEPTED') = (source_id IS NOT NULL)),
  CHECK (
    (source_id IS NULL AND source_kind IS NULL AND source_sha256 IS NULL
      AND source_byte_length IS NULL AND source_media_type IS NULL AND object_key IS NULL)
    OR
    (source_kind = 'ACCEPTED_ENTRY' AND octet_length(source_sha256) = 32
      AND source_byte_length >= 0 AND source_media_type IS NOT NULL AND object_key IS NOT NULL)
  ),
  CHECK ((sha256 IS NULL) = (byte_length IS NULL)),
  CHECK ((status = 'ACCEPTED') OR source_id IS NULL)
);

CREATE TABLE document_delivery.custody_events (
  owner_id uuid NOT NULL,
  project_id uuid NOT NULL,
  event_id uuid NOT NULL,
  batch_id uuid,
  attempt_id uuid,
  event_type text NOT NULL CHECK (event_type IN (
    'PROJECT_CREATED','BATCH_CREATED','BATCH_STATE','ATTEMPT_STATE','RECOVERY_REQUESTED'
  )),
  from_status text,
  to_status text,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  request_id uuid,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_id, event_id),
  FOREIGN KEY (owner_id, project_id)
    REFERENCES document_delivery.projects (owner_id, project_id),
  FOREIGN KEY (owner_id, project_id, batch_id)
    REFERENCES document_delivery.input_batches (owner_id, project_id, batch_id),
  CHECK ((batch_id IS NULL) = (attempt_id IS NULL) OR batch_id IS NOT NULL),
  CHECK (batch_id IS NOT NULL OR event_type = 'PROJECT_CREATED')
);

CREATE FUNCTION document_delivery.current_owner() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT nullif(current_setting('mvp.owner_id', true), '')::uuid
$$;

CREATE FUNCTION document_delivery.resolve_operator_binding(p_issuer text, p_subject text)
RETURNS TABLE (owner_id uuid, display_name text, auth_epoch bigint, enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT b.owner_id, b.display_name, b.auth_epoch, b.enabled
  FROM document_delivery.operator_binding b
  WHERE b.issuer = p_issuer AND b.subject = p_subject
$$;

-- Worker revalidation reads the current binding state by owner; the caller
-- already holds the owner identity from the persisted attempt.
CREATE FUNCTION document_delivery.current_binding(p_owner_id uuid)
RETURNS TABLE (enabled boolean, auth_epoch bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT b.enabled, b.auth_epoch
  FROM document_delivery.operator_binding b
  WHERE b.owner_id = p_owner_id
$$;

-- Startup recovery may enumerate pending extraction identities only; this
-- selector carries no content, note or credential and cannot choose an owner.
CREATE FUNCTION document_delivery.pending_extractions()
RETURNS TABLE (
  owner_id uuid, project_id uuid, batch_id uuid, attempt_id uuid,
  generation integer, authorized_auth_epoch bigint, status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT a.owner_id, a.project_id, a.batch_id, a.attempt_id, a.generation,
         a.authorized_auth_epoch, a.status
  FROM document_delivery.batch_attempts a
  WHERE a.kind = 'EXTRACT' AND a.status IN ('PREPARED', 'RUNNING')
  ORDER BY a.owner_id, a.project_id, a.batch_id, a.creation_seq
$$;

CREATE FUNCTION document_delivery.guard_installation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP <> 'INSERT' OR (SELECT count(*) FROM document_delivery.installation) > 1 THEN
    RAISE EXCEPTION 'installation identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION document_delivery.guard_operator_binding() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'binding is not deletable' USING ERRCODE = '55000'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW.owner_id <> OLD.owner_id OR NEW.issuer <> OLD.issuer
    OR NEW.subject <> OLD.subject OR NEW.auth_epoch < OLD.auth_epoch) THEN
    RAISE EXCEPTION 'binding identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION document_delivery.guard_projects() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'projects are not deletable' USING ERRCODE = '55000'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.last_batch_no <> 0 OR NEW.active_batch_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid project creation' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.owner_id <> OLD.owner_id OR NEW.project_id <> OLD.project_id
    OR NEW.customer_name <> OLD.customer_name OR NEW.title <> OLD.title
    OR NEW.created_at <> OLD.created_at OR NEW.creation_seq <> OLD.creation_seq
    OR NEW.version <> OLD.version + 1
    OR NEW.last_batch_no NOT IN (OLD.last_batch_no, OLD.last_batch_no + 1) THEN
    RAISE EXCEPTION 'immutable project facts or invalid version' USING ERRCODE = '55000';
  END IF;
  IF NEW.active_batch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM document_delivery.input_batches b
    WHERE b.owner_id = NEW.owner_id AND b.project_id = NEW.project_id
      AND b.batch_id = NEW.active_batch_id
      AND b.status IN ('AWAITING_UPLOAD','RECEIVING','STAGED','EXTRACTING','UNKNOWN')
  ) THEN
    RAISE EXCEPTION 'active batch must be an active batch of this project' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION document_delivery.guard_requests() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'requests are immutable' USING ERRCODE = '55000';
END $$;

CREATE FUNCTION document_delivery.guard_batches() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE allowed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'batches are not deletable' USING ERRCODE = '55000'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'AWAITING_UPLOAD' OR NEW.version <> 1 OR NEW.generation <> 1
      OR NEW.manifest_id IS NOT NULL OR NEW.original_zip_source IS NOT NULL
      OR NEW.original_object_key IS NOT NULL THEN
      RAISE EXCEPTION 'invalid batch creation' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('RECEIVED','PARTIAL','REJECTED','ABANDONED') THEN
    RAISE EXCEPTION 'sealed batch is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.owner_id <> OLD.owner_id OR NEW.project_id <> OLD.project_id
    OR NEW.batch_id <> OLD.batch_id OR NEW.batch_no <> OLD.batch_no
    OR NEW.kind <> OLD.kind OR NEW.original_name <> OLD.original_name
    OR NEW.declared_bytes <> OLD.declared_bytes OR NEW.zip_sha256 <> OLD.zip_sha256
    OR NEW.note IS DISTINCT FROM OLD.note OR NEW.policy_version <> OLD.policy_version
    OR NEW.original_request_id <> OLD.original_request_id
    OR NEW.created_at <> OLD.created_at OR NEW.version <> OLD.version + 1
    OR NEW.generation NOT IN (OLD.generation, OLD.generation + 1)
    OR NEW.observed_at < OLD.observed_at
    OR (OLD.manifest_id IS NOT NULL AND NEW.manifest_id IS DISTINCT FROM OLD.manifest_id)
    OR (OLD.original_zip_source IS NOT NULL
      AND NEW.original_zip_source IS DISTINCT FROM OLD.original_zip_source)
    OR (OLD.original_object_key IS NOT NULL
      AND NEW.original_object_key IS DISTINCT FROM OLD.original_object_key) THEN
    RAISE EXCEPTION 'immutable batch facts or invalid version' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  allowed := (OLD.status, NEW.status) IN (
    ('AWAITING_UPLOAD','RECEIVING'),('AWAITING_UPLOAD','FAILED'),('AWAITING_UPLOAD','ABANDONED'),
    ('RECEIVING','STAGED'),('RECEIVING','FAILED'),('RECEIVING','UNKNOWN'),
    ('RECEIVING','ABANDONED'),
    ('STAGED','EXTRACTING'),('STAGED','FAILED'),('STAGED','UNKNOWN'),('STAGED','ABANDONED'),
    ('EXTRACTING','RECEIVED'),('EXTRACTING','PARTIAL'),('EXTRACTING','FAILED'),
    ('EXTRACTING','REJECTED'),('EXTRACTING','UNKNOWN'),('EXTRACTING','ABANDONED'),
    ('UNKNOWN','STAGED'),('UNKNOWN','RECEIVED'),('UNKNOWN','PARTIAL'),
    ('UNKNOWN','FAILED'),('UNKNOWN','REJECTED'),('UNKNOWN','ABANDONED'),
    ('FAILED','AWAITING_UPLOAD'),('FAILED','STAGED'),('FAILED','EXTRACTING'),
    ('FAILED','ABANDONED')
  );
  IF NOT allowed THEN
    RAISE EXCEPTION 'invalid batch status transition' USING ERRCODE = '55000';
  END IF;
  IF NEW.status IN ('RECEIVED','PARTIAL') AND NEW.manifest_id IS NULL THEN
    RAISE EXCEPTION 'sealed batch requires a manifest' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION document_delivery.guard_attempts() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'attempts are not deletable' USING ERRCODE = '55000'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('PREPARED','ABANDONED') THEN
      RAISE EXCEPTION 'new attempts start PREPARED' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.owner_id <> OLD.owner_id OR NEW.project_id <> OLD.project_id
    OR NEW.batch_id <> OLD.batch_id OR NEW.attempt_id <> OLD.attempt_id
    OR NEW.kind <> OLD.kind OR NEW.number <> OLD.number OR NEW.generation <> OLD.generation
    OR NEW.fencing_token <> OLD.fencing_token
    OR NEW.authorization_request_id <> OLD.authorization_request_id
    OR NEW.authorized_owner_id <> OLD.authorized_owner_id
    OR NEW.authorized_auth_epoch <> OLD.authorized_auth_epoch
    OR NEW.original_input_sha256 <> OLD.original_input_sha256
    OR NEW.started_at <> OLD.started_at THEN
    RAISE EXCEPTION 'immutable attempt facts' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('SUCCEEDED','FAILED','ABANDONED') THEN
    RAISE EXCEPTION 'attempt is terminal' USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> OLD.status AND NOT (OLD.status, NEW.status) IN (
    ('PREPARED','RUNNING'),('PREPARED','FAILED'),('PREPARED','ABANDONED'),('PREPARED','UNKNOWN'),
    ('RUNNING','SUCCEEDED'),('RUNNING','FAILED'),('RUNNING','UNKNOWN'),
    ('UNKNOWN','SUCCEEDED'),('UNKNOWN','FAILED'),('UNKNOWN','ABANDONED')
  ) THEN
    RAISE EXCEPTION 'invalid attempt status transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION document_delivery.guard_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'immutable MVP01 fact' USING ERRCODE = '55000';
END $$;

CREATE TRIGGER installation_guard BEFORE INSERT OR UPDATE OR DELETE
  ON document_delivery.installation FOR EACH ROW
  EXECUTE FUNCTION document_delivery.guard_installation();
CREATE TRIGGER operator_binding_guard BEFORE UPDATE OR DELETE
  ON document_delivery.operator_binding FOR EACH ROW
  EXECUTE FUNCTION document_delivery.guard_operator_binding();
CREATE TRIGGER projects_guard BEFORE INSERT OR UPDATE OR DELETE
  ON document_delivery.projects FOR EACH ROW
  EXECUTE FUNCTION document_delivery.guard_projects();
CREATE TRIGGER requests_guard BEFORE UPDATE OR DELETE
  ON document_delivery.requests FOR EACH ROW
  EXECUTE FUNCTION document_delivery.guard_requests();
CREATE TRIGGER batches_guard BEFORE INSERT OR UPDATE OR DELETE
  ON document_delivery.input_batches FOR EACH ROW
  EXECUTE FUNCTION document_delivery.guard_batches();
CREATE TRIGGER attempts_guard BEFORE INSERT OR UPDATE OR DELETE
  ON document_delivery.batch_attempts FOR EACH ROW
  EXECUTE FUNCTION document_delivery.guard_attempts();
CREATE TRIGGER manifests_guard BEFORE UPDATE OR DELETE
  ON document_delivery.input_manifests FOR EACH ROW
  EXECUTE FUNCTION document_delivery.guard_immutable();
CREATE TRIGGER entries_guard BEFORE UPDATE OR DELETE
  ON document_delivery.source_entries FOR EACH ROW
  EXECUTE FUNCTION document_delivery.guard_immutable();
CREATE TRIGGER events_guard BEFORE UPDATE OR DELETE
  ON document_delivery.custody_events FOR EACH ROW
  EXECUTE FUNCTION document_delivery.guard_immutable();

ALTER TABLE document_delivery.installation ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.installation FORCE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.operator_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.operator_binding FORCE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.projects FORCE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.requests FORCE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.input_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.input_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.batch_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.batch_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.input_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.input_manifests FORCE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.source_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.source_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.custody_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_delivery.custody_events FORCE ROW LEVEL SECURITY;

CREATE POLICY installation_owner ON document_delivery.installation TO mvp_ddl
  USING (true) WITH CHECK (true);
CREATE POLICY installation_runtime ON document_delivery.installation TO mvp_runtime
  USING (true) WITH CHECK (false);
CREATE POLICY operator_binding_owner ON document_delivery.operator_binding TO mvp_ddl
  USING (true) WITH CHECK (true);

CREATE POLICY projects_runtime ON document_delivery.projects TO mvp_runtime
  USING (owner_id = document_delivery.current_owner())
  WITH CHECK (owner_id = document_delivery.current_owner());
CREATE POLICY requests_runtime ON document_delivery.requests TO mvp_runtime
  USING (owner_id = document_delivery.current_owner())
  WITH CHECK (owner_id = document_delivery.current_owner());
CREATE POLICY batches_runtime ON document_delivery.input_batches TO mvp_runtime
  USING (owner_id = document_delivery.current_owner())
  WITH CHECK (owner_id = document_delivery.current_owner());
CREATE POLICY attempts_runtime ON document_delivery.batch_attempts TO mvp_runtime
  USING (owner_id = document_delivery.current_owner())
  WITH CHECK (owner_id = document_delivery.current_owner());
CREATE POLICY manifests_runtime ON document_delivery.input_manifests TO mvp_runtime
  USING (owner_id = document_delivery.current_owner())
  WITH CHECK (owner_id = document_delivery.current_owner());
CREATE POLICY entries_runtime ON document_delivery.source_entries TO mvp_runtime
  USING (owner_id = document_delivery.current_owner())
  WITH CHECK (owner_id = document_delivery.current_owner());
CREATE POLICY events_runtime ON document_delivery.custody_events TO mvp_runtime
  USING (owner_id = document_delivery.current_owner())
  WITH CHECK (owner_id = document_delivery.current_owner());

-- Owner policies are required because FORCE RLS also applies to the owner.
CREATE POLICY projects_owner ON document_delivery.projects TO mvp_ddl
  USING (true) WITH CHECK (true);
CREATE POLICY requests_owner ON document_delivery.requests TO mvp_ddl
  USING (true) WITH CHECK (true);
CREATE POLICY batches_owner ON document_delivery.input_batches TO mvp_ddl
  USING (true) WITH CHECK (true);
CREATE POLICY attempts_owner ON document_delivery.batch_attempts TO mvp_ddl
  USING (true) WITH CHECK (true);
CREATE POLICY manifests_owner ON document_delivery.input_manifests TO mvp_ddl
  USING (true) WITH CHECK (true);
CREATE POLICY entries_owner ON document_delivery.source_entries TO mvp_ddl
  USING (true) WITH CHECK (true);
CREATE POLICY events_owner ON document_delivery.custody_events TO mvp_ddl
  USING (true) WITH CHECK (true);

REVOKE ALL ON ALL TABLES IN SCHEMA document_delivery FROM PUBLIC, mvp_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA document_delivery FROM PUBLIC, mvp_runtime;

GRANT SELECT ON document_delivery.installation TO mvp_runtime;
GRANT SELECT, INSERT, UPDATE ON document_delivery.projects TO mvp_runtime;
GRANT SELECT, INSERT ON document_delivery.requests TO mvp_runtime;
GRANT SELECT, INSERT, UPDATE ON document_delivery.input_batches TO mvp_runtime;
GRANT SELECT, INSERT, UPDATE ON document_delivery.batch_attempts TO mvp_runtime;
GRANT SELECT, INSERT ON document_delivery.input_manifests TO mvp_runtime;
GRANT SELECT, INSERT ON document_delivery.source_entries TO mvp_runtime;
GRANT SELECT, INSERT ON document_delivery.custody_events TO mvp_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA document_delivery TO mvp_runtime;
GRANT EXECUTE ON FUNCTION document_delivery.current_owner() TO mvp_runtime;
GRANT EXECUTE ON FUNCTION document_delivery.resolve_operator_binding(text, text) TO mvp_runtime;
GRANT EXECUTE ON FUNCTION document_delivery.current_binding(uuid) TO mvp_runtime;
GRANT EXECUTE ON FUNCTION document_delivery.pending_extractions() TO mvp_runtime;

RESET ROLE;
