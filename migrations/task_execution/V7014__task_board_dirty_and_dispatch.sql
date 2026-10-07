-- IM-06 TD-05 #248: Task Board dirty-marker capture and export/dispatch slice.
-- Forward-only; adds the task_execution owning dirty identity, per-Project
-- export dispatch control and immutable export manifest, plus the SECURITY
-- DEFINER claim/confirm helpers. Applied migrations V3000-V3010 / V7005-V7013
-- are not modified.
SET ROLE task_execution_owner;

-- ---------------------------------------------------------------------------
-- 1. Append-only dirty identity emitted by owning write transactions.
--    A marker is created only by the AFTER triggers below; task_execution_app
--    may read its scope and never fabricate, mutate or delete a marker.
-- ---------------------------------------------------------------------------
CREATE TABLE task_execution.task_board_dirty (
  marker_id uuid PRIMARY KEY,
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  source_version bigint,
  source_hash bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_board_dirty_source_type_closed CHECK (source_type IN
    ('task', 'task_definition_snapshot', 'work_order', 'work_order_draft_snapshot',
     'work_order_contract', 'information_request', 'information_request_origin',
     'agent_result', 'run_final_submission_claim', 'agent_result_acceptance', 'run',
     'work_order_retry_intent', 'run_retry_intent_consumption', 'completion_evaluation')),
  CONSTRAINT task_board_dirty_source_hash_len CHECK (
    source_hash IS NULL OR octet_length(source_hash) = 32),
  CONSTRAINT task_board_dirty_scope_unique UNIQUE (enterprise_id, project_id, marker_id)
);
CREATE INDEX task_board_dirty_scope_created_idx
  ON task_execution.task_board_dirty (enterprise_id, project_id, created_at);

GRANT SELECT ON task_execution.task_board_dirty TO task_execution_app;
REVOKE INSERT, UPDATE, DELETE ON task_execution.task_board_dirty FROM task_execution_app;
ALTER TABLE task_execution.task_board_dirty ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.task_board_dirty FORCE ROW LEVEL SECURITY;
CREATE POLICY task_board_dirty_app_select ON task_execution.task_board_dirty
  FOR SELECT TO task_execution_app
  USING (platform_security.context_allows_project(enterprise_id, project_id));
-- FORCE RLS also applies to the schema owner, so the SECURITY DEFINER marker
-- function and the dispatch confirm helper need explicit owner policies.
CREATE POLICY task_board_dirty_owner_select ON task_execution.task_board_dirty
  FOR SELECT TO task_execution_owner USING (true);
CREATE POLICY task_board_dirty_owner_insert ON task_execution.task_board_dirty
  FOR INSERT TO task_execution_owner WITH CHECK (true);
CREATE POLICY task_board_dirty_owner_delete ON task_execution.task_board_dirty
  FOR DELETE TO task_execution_owner USING (true);

-- ---------------------------------------------------------------------------
-- 2. Owning-table dirty capture. The trigger maps TG_TABLE_NAME to the Board
--    source identity; it marks dirty only and never derives Board state.
-- ---------------------------------------------------------------------------
CREATE FUNCTION task_execution.task_board_mark_dirty() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $guard$
DECLARE
  r jsonb := to_jsonb(NEW);
  v_source_type text;
  v_source_id uuid;
  v_source_version bigint;
  v_source_hash bytea;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'task' THEN
      v_source_type := 'task';
      v_source_id := (r->>'task_id')::uuid;
      v_source_version := (r->>'aggregate_version')::bigint;
      v_source_hash := NULL;
    WHEN 'task_definition_snapshot' THEN
      v_source_type := 'task_definition_snapshot';
      v_source_id := (r->>'snapshot_id')::uuid;
      v_source_version := NULL;
      v_source_hash := (r->>'payload_hash')::bytea;
    WHEN 'work_order' THEN
      v_source_type := 'work_order';
      v_source_id := (r->>'work_order_id')::uuid;
      v_source_version := (r->>'aggregate_version')::bigint;
      v_source_hash := NULL;
    WHEN 'work_order_draft_snapshot' THEN
      v_source_type := 'work_order_draft_snapshot';
      v_source_id := (r->>'snapshot_id')::uuid;
      v_source_version := NULL;
      v_source_hash := (r->>'payload_hash')::bytea;
    WHEN 'work_order_contract' THEN
      v_source_type := 'work_order_contract';
      v_source_id := (r->>'contract_id')::uuid;
      v_source_version := NULL;
      v_source_hash := (r->>'payload_hash')::bytea;
    WHEN 'information_request' THEN
      v_source_type := 'information_request';
      v_source_id := (r->>'request_id')::uuid;
      v_source_version := (r->>'aggregate_version')::bigint;
      v_source_hash := NULL;
    WHEN 'information_request_origin' THEN
      v_source_type := 'information_request_origin';
      v_source_id := (r->>'request_id')::uuid;
      v_source_version := NULL;
      v_source_hash := (r->>'payload_hash')::bytea;
    WHEN 'agent_result' THEN
      v_source_type := 'agent_result';
      v_source_id := (r->>'result_id')::uuid;
      v_source_version := NULL;
      v_source_hash := (r->>'result_payload_hash')::bytea;
    WHEN 'run_final_submission_claim' THEN
      v_source_type := 'run_final_submission_claim';
      v_source_id := (r->>'run_id')::uuid;
      v_source_version := NULL;
      v_source_hash := (r->>'result_payload_hash')::bytea;
    WHEN 'agent_result_acceptance' THEN
      v_source_type := 'agent_result_acceptance';
      v_source_id := (r->>'acceptance_id')::uuid;
      v_source_version := NULL;
      v_source_hash := (r->>'payload_hash')::bytea;
    WHEN 'run' THEN
      v_source_type := 'run';
      v_source_id := (r->>'run_id')::uuid;
      v_source_version := (r->>'aggregate_version')::bigint;
      v_source_hash := NULL;
    WHEN 'work_order_retry_intent' THEN
      v_source_type := 'work_order_retry_intent';
      v_source_id := (r->>'intent_id')::uuid;
      v_source_version := NULL;
      v_source_hash := (r->>'payload_hash')::bytea;
    WHEN 'run_retry_intent_consumption' THEN
      v_source_type := 'run_retry_intent_consumption';
      v_source_id := (r->>'intent_id')::uuid;
      v_source_version := NULL;
      v_source_hash := (r->>'payload_hash')::bytea;
    WHEN 'completion_evaluation' THEN
      v_source_type := 'completion_evaluation';
      v_source_id := (r->>'evaluation_id')::uuid;
      v_source_version := NULL;
      v_source_hash := (r->>'payload_hash')::bytea;
    ELSE
      RAISE EXCEPTION 'TASK_BOARD_SOURCE_UNSUPPORTED' USING ERRCODE = '23514';
  END CASE;
  INSERT INTO task_execution.task_board_dirty
    (marker_id, enterprise_id, project_id, source_type, source_id, source_version, source_hash)
  VALUES
    (uuidv7(), (r->>'enterprise_id')::uuid, (r->>'project_id')::uuid,
     v_source_type, v_source_id, v_source_version, v_source_hash);
  RETURN NULL;
END $guard$;
REVOKE ALL ON FUNCTION task_execution.task_board_mark_dirty() FROM PUBLIC;

-- Attached to the 14 owning tables the Board row profile can depend on. UPDATE
-- triggers watch the version/hash columns; conservative over-marking is
-- allowed, so no-op updates simply re-mark an unchanged identity.
CREATE TRIGGER task_board_dirty_task
  AFTER INSERT OR UPDATE OF aggregate_version, status
  ON task_execution.task FOR EACH ROW
  EXECUTE FUNCTION task_execution.task_board_mark_dirty();
CREATE TRIGGER task_board_dirty_task_definition_snapshot
  AFTER INSERT OR UPDATE OF snapshot_id, payload_hash
  ON task_execution.task_definition_snapshot FOR EACH ROW
  EXECUTE FUNCTION task_execution.task_board_mark_dirty();
CREATE TRIGGER task_board_dirty_work_order
  AFTER INSERT OR UPDATE OF aggregate_version, status
  ON task_execution.work_order FOR EACH ROW
  EXECUTE FUNCTION task_execution.task_board_mark_dirty();
CREATE TRIGGER task_board_dirty_work_order_draft_snapshot
  AFTER INSERT OR UPDATE OF snapshot_id, payload_hash
  ON task_execution.work_order_draft_snapshot FOR EACH ROW
  EXECUTE FUNCTION task_execution.task_board_mark_dirty();
CREATE TRIGGER task_board_dirty_work_order_contract
  AFTER INSERT OR UPDATE OF contract_id, payload_hash
  ON task_execution.work_order_contract FOR EACH ROW
  EXECUTE FUNCTION task_execution.task_board_mark_dirty();
CREATE TRIGGER task_board_dirty_information_request
  AFTER INSERT OR UPDATE OF aggregate_version, status
  ON task_execution.information_request FOR EACH ROW
  EXECUTE FUNCTION task_execution.task_board_mark_dirty();
CREATE TRIGGER task_board_dirty_information_request_origin
  AFTER INSERT OR UPDATE OF request_id, payload_hash
  ON task_execution.information_request_origin FOR EACH ROW
  EXECUTE FUNCTION task_execution.task_board_mark_dirty();
CREATE TRIGGER task_board_dirty_agent_result
  AFTER INSERT OR UPDATE OF result_id, result_payload_hash
  ON task_execution.agent_result FOR EACH ROW
  EXECUTE FUNCTION task_execution.task_board_mark_dirty();
CREATE TRIGGER task_board_dirty_run_final_submission_claim
  AFTER INSERT OR UPDATE OF run_id, result_payload_hash
  ON task_execution.run_final_submission_claim FOR EACH ROW
  EXECUTE FUNCTION task_execution.task_board_mark_dirty();
CREATE TRIGGER task_board_dirty_agent_result_acceptance
  AFTER INSERT OR UPDATE OF acceptance_id, payload_hash
  ON task_execution.agent_result_acceptance FOR EACH ROW
  EXECUTE FUNCTION task_execution.task_board_mark_dirty();
CREATE TRIGGER task_board_dirty_run
  AFTER INSERT OR UPDATE OF aggregate_version, status
  ON task_execution.run FOR EACH ROW
  EXECUTE FUNCTION task_execution.task_board_mark_dirty();
CREATE TRIGGER task_board_dirty_work_order_retry_intent
  AFTER INSERT OR UPDATE OF intent_id, payload_hash
  ON task_execution.work_order_retry_intent FOR EACH ROW
  EXECUTE FUNCTION task_execution.task_board_mark_dirty();
CREATE TRIGGER task_board_dirty_run_retry_intent_consumption
  AFTER INSERT OR UPDATE OF intent_id, payload_hash
  ON task_execution.run_retry_intent_consumption FOR EACH ROW
  EXECUTE FUNCTION task_execution.task_board_mark_dirty();
CREATE TRIGGER task_board_dirty_completion_evaluation
  AFTER INSERT OR UPDATE OF evaluation_id, payload_hash
  ON task_execution.completion_evaluation FOR EACH ROW
  EXECUTE FUNCTION task_execution.task_board_mark_dirty();

-- ---------------------------------------------------------------------------
-- 3. Per-Project export dispatch control: monotonic lease/fencing token, lease
--    owner/until and the last confirmed publication identity.
-- ---------------------------------------------------------------------------
CREATE TABLE task_execution.task_board_export_dispatch (
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  lease_token bigint NOT NULL DEFAULT 0,
  lease_owner text,
  lease_until timestamptz,
  version bigint NOT NULL DEFAULT 0,
  last_export_id uuid,
  last_manifest_hash bytea,
  last_publish_sequence bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_board_export_dispatch_pkey PRIMARY KEY (enterprise_id, project_id),
  CONSTRAINT task_board_export_dispatch_lease_token_range
    CHECK (lease_token >= 0 AND lease_token <= 9007199254740991),
  CONSTRAINT task_board_export_dispatch_version_range CHECK (version >= 0),
  CONSTRAINT task_board_export_dispatch_lease_pair
    CHECK ((lease_owner IS NULL) = (lease_until IS NULL)),
  CONSTRAINT task_board_export_dispatch_manifest_hash_len
    CHECK (last_manifest_hash IS NULL OR octet_length(last_manifest_hash) = 32),
  CONSTRAINT task_board_export_dispatch_publish_sequence_range
    CHECK (last_publish_sequence IS NULL
      OR last_publish_sequence BETWEEN 0 AND 9007199254740991)
);

GRANT SELECT, UPDATE ON task_execution.task_board_export_dispatch TO task_execution_app;
REVOKE INSERT, DELETE ON task_execution.task_board_export_dispatch FROM task_execution_app;
ALTER TABLE task_execution.task_board_export_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.task_board_export_dispatch FORCE ROW LEVEL SECURITY;
CREATE POLICY task_board_export_dispatch_app_select ON task_execution.task_board_export_dispatch
  FOR SELECT TO task_execution_app
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_export_dispatch_app_update ON task_execution.task_board_export_dispatch
  FOR UPDATE TO task_execution_app
  USING (platform_security.context_allows_project(enterprise_id, project_id))
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_export_dispatch_owner_select ON task_execution.task_board_export_dispatch
  FOR SELECT TO task_execution_owner
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_export_dispatch_owner_update ON task_execution.task_board_export_dispatch
  FOR UPDATE TO task_execution_owner
  USING (platform_security.context_allows_project(enterprise_id, project_id))
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_export_dispatch_owner_insert ON task_execution.task_board_export_dispatch
  FOR INSERT TO task_execution_owner
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

-- ---------------------------------------------------------------------------
-- 4. Immutable export manifest: the exact snapshot, its hashes, the technical
--    policy observation and the fully covered dirty identities.
-- ---------------------------------------------------------------------------
CREATE TABLE task_execution.task_board_export_manifest (
  export_id uuid PRIMARY KEY,
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  manifest jsonb NOT NULL,
  manifest_hash bytea NOT NULL,
  snapshot_at timestamptz NOT NULL,
  policy_observation jsonb NOT NULL,
  row_count integer NOT NULL,
  rows_hash bytea NOT NULL,
  source_fingerprint bytea NOT NULL,
  covered_dirty_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_principal_id uuid NOT NULL,
  CONSTRAINT task_board_export_manifest_hash_len CHECK (
    octet_length(manifest_hash) = 32
    AND octet_length(rows_hash) = 32
    AND octet_length(source_fingerprint) = 32),
  CONSTRAINT task_board_export_manifest_row_count_range
    CHECK (row_count >= 0 AND row_count <= 1000),
  CONSTRAINT task_board_export_manifest_no_null_covered
    CHECK (array_position(covered_dirty_ids, NULL) IS NULL),
  CONSTRAINT task_board_export_manifest_scope_unique
    UNIQUE (enterprise_id, project_id, export_id)
);

GRANT SELECT, INSERT ON task_execution.task_board_export_manifest TO task_execution_app;
REVOKE UPDATE, DELETE ON task_execution.task_board_export_manifest FROM task_execution_app;
ALTER TABLE task_execution.task_board_export_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.task_board_export_manifest FORCE ROW LEVEL SECURITY;
CREATE POLICY task_board_export_manifest_app_select ON task_execution.task_board_export_manifest
  FOR SELECT TO task_execution_app
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_export_manifest_app_insert ON task_execution.task_board_export_manifest
  FOR INSERT TO task_execution_app
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id)
    AND created_by_principal_id = platform_security.context_principal_id());
CREATE POLICY task_board_export_manifest_owner_select ON task_execution.task_board_export_manifest
  FOR SELECT TO task_execution_owner
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_export_manifest_owner_insert ON task_execution.task_board_export_manifest
  FOR INSERT TO task_execution_owner
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

CREATE FUNCTION task_execution.guard_task_board_manifest_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $guard$
BEGIN
  RAISE EXCEPTION 'Task Board export manifest is immutable' USING ERRCODE = '23514';
END $guard$;
REVOKE ALL ON FUNCTION task_execution.guard_task_board_manifest_immutable() FROM PUBLIC;
CREATE TRIGGER task_board_manifest_immutable
  BEFORE UPDATE OR DELETE ON task_execution.task_board_export_manifest
  FOR EACH ROW EXECUTE FUNCTION task_execution.guard_task_board_manifest_immutable();

-- ---------------------------------------------------------------------------
-- 4b. Publication proof: the immutable record that one export manifest was
--     published as an exact Projection generation/sequence by the *current*
--     export lease. A dirty confirmation must present this record, so a
--     manifest that was never published can never be acknowledged.
-- ---------------------------------------------------------------------------
CREATE TABLE task_execution.task_board_export_publication (
  export_id uuid PRIMARY KEY,
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  manifest_hash bytea NOT NULL,
  generation_id uuid NOT NULL,
  publish_sequence bigint NOT NULL,
  lease_token bigint NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_board_export_publication_hash_len CHECK (octet_length(manifest_hash) = 32),
  CONSTRAINT task_board_export_publication_sequence_range
    CHECK (publish_sequence >= 1 AND publish_sequence <= 9007199254740991),
  CONSTRAINT task_board_export_publication_lease_positive CHECK (lease_token >= 1),
  CONSTRAINT task_board_export_publication_scope_unique
    UNIQUE (enterprise_id, project_id, export_id, manifest_hash)
);

GRANT SELECT ON task_execution.task_board_export_publication TO task_execution_app;
REVOKE INSERT, UPDATE, DELETE ON task_execution.task_board_export_publication FROM task_execution_app;
ALTER TABLE task_execution.task_board_export_publication ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.task_board_export_publication FORCE ROW LEVEL SECURITY;
CREATE POLICY task_board_export_publication_app_select ON task_execution.task_board_export_publication
  FOR SELECT TO task_execution_app
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_export_publication_owner_select ON task_execution.task_board_export_publication
  FOR SELECT TO task_execution_owner
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_export_publication_owner_insert ON task_execution.task_board_export_publication
  FOR INSERT TO task_execution_owner
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

-- ---------------------------------------------------------------------------
-- 4c. Export confirmation and retirement: the two progress marks that decide
--     whether a persisted manifest still needs recovery. A publication proof
--     alone is not completion (the confirmation is a separate committed
--     transaction), and a manifest whose Policy was superseded before it could
--     be published is retired so a fresh export can replace it.
-- ---------------------------------------------------------------------------
CREATE TABLE task_execution.task_board_export_confirmation (
  export_id uuid PRIMARY KEY,
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  manifest_hash bytea NOT NULL,
  generation_id uuid NOT NULL,
  publish_sequence bigint NOT NULL,
  confirmed_dirty_ids uuid[] NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_board_export_confirmation_hash_len CHECK (octet_length(manifest_hash) = 32),
  CONSTRAINT task_board_export_confirmation_scope_unique
    UNIQUE (enterprise_id, project_id, export_id)
);

CREATE TABLE task_execution.task_board_export_retirement (
  export_id uuid PRIMARY KEY,
  enterprise_id uuid NOT NULL,
  project_id uuid NOT NULL,
  reason_code text NOT NULL,
  retired_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_board_export_retirement_reason CHECK (length(reason_code) > 0),
  CONSTRAINT task_board_export_retirement_scope_unique
    UNIQUE (enterprise_id, project_id, export_id)
);

CREATE FUNCTION task_execution.guard_task_board_publication_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $guard$
BEGIN
  RAISE EXCEPTION 'Task Board export publication is immutable' USING ERRCODE = '23514';
END $guard$;
REVOKE ALL ON FUNCTION task_execution.guard_task_board_publication_immutable() FROM PUBLIC;
CREATE TRIGGER task_board_publication_immutable
  BEFORE UPDATE OR DELETE ON task_execution.task_board_export_publication
  FOR EACH ROW EXECUTE FUNCTION task_execution.guard_task_board_publication_immutable();

-- ---------------------------------------------------------------------------
-- 5. SECURITY DEFINER export/dispatch helpers. Each first validates the
--    Scope and the SERVICE principal kind exactly like dispatch_scope; the
--    helpers are executable only by task_execution_app.
-- ---------------------------------------------------------------------------
GRANT SELECT ON task_execution.task_board_export_confirmation TO task_execution_app;
REVOKE INSERT, UPDATE, DELETE ON task_execution.task_board_export_confirmation FROM task_execution_app;
GRANT SELECT ON task_execution.task_board_export_retirement TO task_execution_app;
REVOKE INSERT, UPDATE, DELETE ON task_execution.task_board_export_retirement FROM task_execution_app;
ALTER TABLE task_execution.task_board_export_confirmation ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.task_board_export_confirmation FORCE ROW LEVEL SECURITY;
ALTER TABLE task_execution.task_board_export_retirement ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.task_board_export_retirement FORCE ROW LEVEL SECURITY;
CREATE POLICY task_board_export_confirmation_app_select ON task_execution.task_board_export_confirmation
  FOR SELECT TO task_execution_app
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_export_retirement_app_select ON task_execution.task_board_export_retirement
  FOR SELECT TO task_execution_app
  USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_export_confirmation_owner_all ON task_execution.task_board_export_confirmation
  FOR ALL TO task_execution_owner
  USING (platform_security.context_allows_project(enterprise_id, project_id))
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY task_board_export_retirement_owner_all ON task_execution.task_board_export_retirement
  FOR ALL TO task_execution_owner
  USING (platform_security.context_allows_project(enterprise_id, project_id))
  WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

CREATE FUNCTION task_execution.task_board_dispatch_claim(
  p_enterprise uuid, p_project uuid, p_owner text, p_lease_seconds integer,
  p_now timestamptz) RETURNS TABLE(lease_token bigint, lease_until timestamptz, version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE d task_execution.task_board_export_dispatch%ROWTYPE;
BEGIN
  PERFORM task_execution.dispatch_scope(p_enterprise, p_project);
  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 THEN
    RAISE EXCEPTION 'TASK_BOARD_LEASE_INVALID' USING ERRCODE = '22023';
  END IF;
  INSERT INTO task_execution.task_board_export_dispatch
    (enterprise_id, project_id, lease_token, lease_owner, lease_until, version, updated_at)
  VALUES
    (p_enterprise, p_project, 1, p_owner,
     p_now + make_interval(secs => p_lease_seconds), 1, p_now)
  ON CONFLICT (enterprise_id, project_id) DO NOTHING;
  IF FOUND THEN
    SELECT * INTO d FROM task_execution.task_board_export_dispatch
      WHERE enterprise_id = p_enterprise AND project_id = p_project;
    RETURN QUERY SELECT d.lease_token, d.lease_until, d.version;
    RETURN;
  END IF;
  SELECT * INTO d FROM task_execution.task_board_export_dispatch
    WHERE enterprise_id = p_enterprise AND project_id = p_project
    FOR UPDATE;
  IF d.lease_until IS NULL OR d.lease_until <= p_now OR d.lease_owner = p_owner THEN
    UPDATE task_execution.task_board_export_dispatch
      SET lease_token = d.lease_token + 1,
          lease_owner = p_owner,
          lease_until = p_now + make_interval(secs => p_lease_seconds),
          version = d.version + 1,
          updated_at = p_now
      WHERE enterprise_id = p_enterprise AND project_id = p_project
      RETURNING * INTO d;
    RETURN QUERY SELECT d.lease_token, d.lease_until, d.version;
    RETURN;
  END IF;
  RETURN;
END $fn$;
REVOKE ALL ON FUNCTION task_execution.task_board_dispatch_claim(uuid, uuid, text, integer, timestamptz) FROM PUBLIC;

CREATE FUNCTION task_execution.task_board_dispatch_state(p_enterprise uuid, p_project uuid)
RETURNS SETOF task_execution.task_board_export_dispatch
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
  PERFORM task_execution.dispatch_scope(p_enterprise, p_project);
  RETURN QUERY SELECT * FROM task_execution.task_board_export_dispatch
    WHERE enterprise_id = p_enterprise AND project_id = p_project;
END $fn$;
REVOKE ALL ON FUNCTION task_execution.task_board_dispatch_state(uuid, uuid) FROM PUBLIC;

CREATE FUNCTION task_execution.task_board_manifest_record(
  p_export_id uuid, p_enterprise uuid, p_project uuid, p_manifest jsonb,
  p_manifest_hash bytea, p_snapshot_at timestamptz, p_policy_observation jsonb,
  p_row_count integer, p_rows_hash bytea, p_source_fingerprint bytea,
  p_covered_dirty_ids uuid[], p_principal uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
  PERFORM task_execution.dispatch_scope(p_enterprise, p_project);
  INSERT INTO task_execution.task_board_export_manifest
    (export_id, enterprise_id, project_id, manifest, manifest_hash, snapshot_at,
     policy_observation, row_count, rows_hash, source_fingerprint,
     covered_dirty_ids, created_by_principal_id)
  VALUES
    (p_export_id, p_enterprise, p_project, p_manifest, p_manifest_hash,
     p_snapshot_at, p_policy_observation, p_row_count, p_rows_hash,
     p_source_fingerprint, p_covered_dirty_ids, p_principal)
  ON CONFLICT (export_id) DO NOTHING;
  IF NOT FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM task_execution.task_board_export_manifest m
      WHERE m.export_id = p_export_id
        AND m.enterprise_id = p_enterprise
        AND m.project_id = p_project
        AND m.manifest_hash = p_manifest_hash
        AND m.rows_hash = p_rows_hash
        AND m.row_count = p_row_count
    ) THEN
      RAISE EXCEPTION 'TASK_BOARD_MANIFEST_CONFLICT' USING ERRCODE = '23514';
    END IF;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION task_execution.task_board_manifest_record(uuid, uuid, uuid, jsonb, bytea, timestamptz, jsonb, integer, bytea, bytea, uuid[], uuid) FROM PUBLIC;

CREATE FUNCTION task_execution.task_board_manifest_read(
  p_export_id uuid, p_enterprise uuid, p_project uuid)
RETURNS SETOF task_execution.task_board_export_manifest
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
  PERFORM task_execution.dispatch_scope(p_enterprise, p_project);
  RETURN QUERY SELECT * FROM task_execution.task_board_export_manifest
    WHERE export_id = p_export_id
      AND enterprise_id = p_enterprise
      AND project_id = p_project;
END $fn$;
REVOKE ALL ON FUNCTION task_execution.task_board_manifest_read(uuid, uuid, uuid) FROM PUBLIC;

CREATE FUNCTION task_execution.task_board_manifest_recovery(p_enterprise uuid, p_project uuid)
RETURNS TABLE(
  export_id uuid, manifest jsonb, manifest_hash bytea, snapshot_at timestamptz,
  policy_observation jsonb, row_count integer, rows_hash bytea,
  source_fingerprint bytea, covered_dirty_ids uuid[],
  generation_id uuid, publish_sequence bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
  PERFORM task_execution.dispatch_scope(p_enterprise, p_project);
  -- The newest persisted export that is neither confirmed nor retired: it may
  -- be unpublished (fresh recovery) or already published but not yet
  -- acknowledged (the two progress marks are separate committed
  -- transactions), and the publication tuple is returned when it exists.
  RETURN QUERY
  SELECT m.export_id, m.manifest, m.manifest_hash, m.snapshot_at, m.policy_observation,
         m.row_count, m.rows_hash, m.source_fingerprint, m.covered_dirty_ids,
         -- The published tuple comes from the immutable Projection outcome
         -- (the owning publication fact) and falls back to the TE proof, so a
         -- crash between the Projection commit and the TE proof still recovers
         -- the exact generation/sequence instead of trying to retire it.
         COALESCE(p.generation_id, o.generation_id),
         COALESCE(p.publish_sequence, o.publish_sequence)
  FROM task_execution.task_board_export_manifest m
  LEFT JOIN task_execution.task_board_export_publication p ON p.export_id = m.export_id
  LEFT JOIN projection.task_board_publication_outcome o
    ON o.export_id = m.export_id
   AND o.manifest_hash = m.manifest_hash
   AND o.enterprise_id = m.enterprise_id
   AND o.project_id = m.project_id
  WHERE m.enterprise_id = p_enterprise
    AND m.project_id = p_project
    AND NOT EXISTS (
      SELECT 1 FROM task_execution.task_board_export_confirmation c
      WHERE c.export_id = m.export_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM task_execution.task_board_export_retirement r
      WHERE r.export_id = m.export_id
    )
  ORDER BY m.created_at DESC, m.export_id
  LIMIT 1;
END $fn$;
REVOKE ALL ON FUNCTION task_execution.task_board_manifest_recovery(uuid, uuid) FROM PUBLIC;

CREATE FUNCTION task_execution.task_board_export_retire(
  p_export_id uuid, p_enterprise uuid, p_project uuid, p_reason_code text,
  p_lease_token bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE d task_execution.task_board_export_dispatch%ROWTYPE;
BEGIN
  PERFORM task_execution.dispatch_scope(p_enterprise, p_project);
  SELECT * INTO d FROM task_execution.task_board_export_dispatch
    WHERE enterprise_id = p_enterprise AND project_id = p_project
    FOR UPDATE;
  IF d.lease_token IS DISTINCT FROM p_lease_token
     OR d.lease_until IS NULL
     OR d.lease_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'TASK_BOARD_LEASE_NOT_CURRENT' USING ERRCODE = '42501';
  END IF;
  -- Only an export that was never published may be retired: a published
  -- manifest still owes its acknowledgement. The committed Projection outcome
  -- is the publication fact, so a missing TE proof cannot allow retirement.
  IF EXISTS (
    SELECT 1 FROM task_execution.task_board_export_publication p
    WHERE p.export_id = p_export_id
  ) OR EXISTS (
    SELECT 1 FROM projection.task_board_publication_outcome o
    WHERE o.export_id = p_export_id
      AND o.enterprise_id = p_enterprise
      AND o.project_id = p_project
  ) THEN
    RAISE EXCEPTION 'TASK_BOARD_EXPORT_ALREADY_PUBLISHED' USING ERRCODE = '23514';
  END IF;
  INSERT INTO task_execution.task_board_export_retirement
    (export_id, enterprise_id, project_id, reason_code)
  VALUES (p_export_id, p_enterprise, p_project, p_reason_code)
  ON CONFLICT (export_id) DO NOTHING;
END $fn$;
REVOKE ALL ON FUNCTION task_execution.task_board_export_retire(uuid, uuid, uuid, text, bigint) FROM PUBLIC;

CREATE FUNCTION task_execution.task_board_dispatch_record_publication(
  p_export_id uuid, p_enterprise uuid, p_project uuid, p_manifest_hash bytea,
  p_generation_id uuid, p_publish_sequence bigint, p_lease_token bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
DECLARE d task_execution.task_board_export_dispatch%ROWTYPE;
BEGIN
  PERFORM task_execution.dispatch_scope(p_enterprise, p_project);
  SELECT * INTO d FROM task_execution.task_board_export_dispatch
    WHERE enterprise_id = p_enterprise AND project_id = p_project
    FOR UPDATE;
  -- Only the live lease that produced the export may record its publication,
  -- judged against the database clock rather than a caller time.
  IF d.lease_token IS DISTINCT FROM p_lease_token
     OR d.lease_until IS NULL
     OR d.lease_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'TASK_BOARD_LEASE_NOT_CURRENT' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM task_execution.task_board_export_manifest m
    WHERE m.export_id = p_export_id
      AND m.enterprise_id = p_enterprise
      AND m.project_id = p_project
      AND m.manifest_hash = p_manifest_hash
  ) THEN
    RAISE EXCEPTION 'TASK_BOARD_MANIFEST_CONFLICT' USING ERRCODE = '23514';
  END IF;
  -- The proof is only accepted when the independent Projection owner has
  -- actually committed this exact export/hash/generation/sequence and its
  -- current alias still points at that generation: a caller cannot invent a
  -- publication for an export that was never published.
  -- The immutable publication outcome is the proof: it is independent of the
  -- current alias and survives the retention cleanup of the generation, so a
  -- legitimate recovery replay of an older export still confirms.
  IF NOT EXISTS (
    SELECT 1
    FROM projection.task_board_publication_outcome o
    WHERE o.export_id = p_export_id
      AND o.manifest_hash = p_manifest_hash
      AND o.generation_id = p_generation_id
      AND o.publish_sequence = p_publish_sequence
      AND o.enterprise_id = p_enterprise
      AND o.project_id = p_project
  ) THEN
    RAISE EXCEPTION 'TASK_BOARD_NOT_PUBLISHED' USING ERRCODE = '23514';
  END IF;
  INSERT INTO task_execution.task_board_export_publication
    (export_id, enterprise_id, project_id, manifest_hash, generation_id,
     publish_sequence, lease_token)
  VALUES
    (p_export_id, p_enterprise, p_project, p_manifest_hash, p_generation_id,
     p_publish_sequence, p_lease_token)
  ON CONFLICT (export_id) DO NOTHING;
  IF NOT FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM task_execution.task_board_export_publication x
      WHERE x.export_id = p_export_id
        AND x.enterprise_id = p_enterprise
        AND x.project_id = p_project
        AND x.manifest_hash = p_manifest_hash
        AND x.generation_id = p_generation_id
        AND x.publish_sequence = p_publish_sequence
    ) THEN
      RAISE EXCEPTION 'TASK_BOARD_PUBLICATION_CONFLICT' USING ERRCODE = '23514';
    END IF;
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION task_execution.task_board_dispatch_record_publication(uuid, uuid, uuid, bytea, uuid, bigint, bigint) FROM PUBLIC;

CREATE FUNCTION task_execution.task_board_dispatch_confirm(
  p_export_id uuid, p_enterprise uuid, p_project uuid, p_manifest_hash bytea,
  p_generation_id uuid, p_publish_sequence bigint, p_dirty_ids uuid[],
  p_principal uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
  PERFORM task_execution.dispatch_scope(p_enterprise, p_project);
  IF NOT EXISTS (
    SELECT 1 FROM task_execution.task_board_export_manifest m
    WHERE m.export_id = p_export_id
      AND m.enterprise_id = p_enterprise
      AND m.project_id = p_project
      AND m.manifest_hash = p_manifest_hash
  ) THEN
    RAISE EXCEPTION 'TASK_BOARD_MANIFEST_CONFLICT' USING ERRCODE = '23514';
  END IF;
  -- A marker may only be acknowledged once this exact manifest was published
  -- as this exact generation/sequence under a recorded live lease.
  IF NOT EXISTS (
    SELECT 1 FROM task_execution.task_board_export_publication x
    WHERE x.export_id = p_export_id
      AND x.enterprise_id = p_enterprise
      AND x.project_id = p_project
      AND x.manifest_hash = p_manifest_hash
      AND x.generation_id = p_generation_id
      AND x.publish_sequence = p_publish_sequence
  ) THEN
    RAISE EXCEPTION 'TASK_BOARD_NOT_PUBLISHED' USING ERRCODE = '23514';
  END IF;
  -- Only identities the published manifest explicitly covered may be confirmed.
  IF EXISTS (
    SELECT 1
    FROM unnest(COALESCE(p_dirty_ids, ARRAY[]::uuid[])) AS x(marker_id)
    JOIN task_execution.task_board_export_manifest m
      ON m.export_id = p_export_id
     AND m.enterprise_id = p_enterprise
     AND m.project_id = p_project
    WHERE NOT (x.marker_id = ANY (m.covered_dirty_ids))
  ) THEN
    RAISE EXCEPTION 'TASK_BOARD_DIRTY_NOT_COVERED' USING ERRCODE = '23514';
  END IF;
  DELETE FROM task_execution.task_board_dirty
    WHERE marker_id = ANY (COALESCE(p_dirty_ids, ARRAY[]::uuid[]))
      AND enterprise_id = p_enterprise
      AND project_id = p_project;
  INSERT INTO task_execution.task_board_export_confirmation
    (export_id, enterprise_id, project_id, manifest_hash, generation_id,
     publish_sequence, confirmed_dirty_ids)
  VALUES
    (p_export_id, p_enterprise, p_project, p_manifest_hash, p_generation_id,
     p_publish_sequence, COALESCE(p_dirty_ids, ARRAY[]::uuid[]))
  ON CONFLICT (export_id) DO NOTHING;
  UPDATE task_execution.task_board_export_dispatch
    SET last_export_id = p_export_id,
        last_manifest_hash = p_manifest_hash,
        last_publish_sequence = p_publish_sequence,
        updated_at = clock_timestamp()
    WHERE enterprise_id = p_enterprise AND project_id = p_project;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_BOARD_DISPATCH_MISSING' USING ERRCODE = '23514';
  END IF;
END $fn$;
REVOKE ALL ON FUNCTION task_execution.task_board_dispatch_confirm(uuid, uuid, uuid, bytea, uuid, bigint, uuid[], uuid) FROM PUBLIC;

CREATE FUNCTION task_execution.task_board_dirty_read(p_enterprise uuid, p_project uuid)
RETURNS SETOF task_execution.task_board_dirty
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
  PERFORM task_execution.dispatch_scope(p_enterprise, p_project);
  RETURN QUERY SELECT * FROM task_execution.task_board_dirty
    WHERE enterprise_id = p_enterprise AND project_id = p_project
    ORDER BY created_at, marker_id;
END $fn$;
REVOKE ALL ON FUNCTION task_execution.task_board_dirty_read(uuid, uuid) FROM PUBLIC;

CREATE FUNCTION task_execution.task_board_health(p_enterprise uuid, p_project uuid)
RETURNS TABLE(pending_dirty_count bigint, lease_token bigint, lease_until timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
  PERFORM task_execution.dispatch_scope(p_enterprise, p_project);
  RETURN QUERY
  SELECT
    (SELECT count(*) FROM task_execution.task_board_dirty d
      WHERE d.enterprise_id = p_enterprise AND d.project_id = p_project),
    COALESCE((SELECT x.lease_token FROM task_execution.task_board_export_dispatch x
      WHERE x.enterprise_id = p_enterprise AND x.project_id = p_project), 0),
    (SELECT x.lease_until FROM task_execution.task_board_export_dispatch x
      WHERE x.enterprise_id = p_enterprise AND x.project_id = p_project);
END $fn$;
REVOKE ALL ON FUNCTION task_execution.task_board_health(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  task_execution.task_board_dispatch_claim(uuid, uuid, text, integer, timestamptz),
  task_execution.task_board_dispatch_state(uuid, uuid),
  task_execution.task_board_manifest_record(uuid, uuid, uuid, jsonb, bytea, timestamptz, jsonb, integer, bytea, bytea, uuid[], uuid),
  task_execution.task_board_manifest_read(uuid, uuid, uuid),
  task_execution.task_board_manifest_recovery(uuid, uuid),
  task_execution.task_board_export_retire(uuid, uuid, uuid, text, bigint),
  task_execution.task_board_dispatch_record_publication(uuid, uuid, uuid, bytea, uuid, bigint, bigint),
  task_execution.task_board_dispatch_confirm(uuid, uuid, uuid, bytea, uuid, bigint, uuid[], uuid),
  task_execution.task_board_dirty_read(uuid, uuid),
  task_execution.task_board_health(uuid, uuid)
TO task_execution_app;

RESET ROLE;
