-- IM-06 #221: the first canonical WorkOrder queue and synthetic Run facts.
SET ROLE task_execution_owner;

ALTER TABLE task_execution.work_order
    ADD COLUMN queue_policy_ref jsonb,
    ADD COLUMN queued_at timestamptz,
    ADD COLUMN requested_runtime_class text,
    ADD COLUMN last_transition_command_id uuid,
    ADD CONSTRAINT work_order_queue_binding CHECK (
        (status IN ('DRAFT', 'READY') AND queue_policy_ref IS NULL
            AND queued_at IS NULL AND requested_runtime_class IS NULL)
        OR (status NOT IN ('DRAFT', 'READY') AND queue_policy_ref IS NOT NULL
            AND queued_at IS NOT NULL
            AND requested_runtime_class = 'te.human_operated.synthetic'));

CREATE FUNCTION task_execution.guard_first_run_work_order_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog
AS $guard$
DECLARE source_receipt task_execution.command_receipt%ROWTYPE;
BEGIN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
        IF (NEW.queue_policy_ref, NEW.queued_at, NEW.requested_runtime_class,
            NEW.last_transition_command_id) IS DISTINCT FROM
           (OLD.queue_policy_ref, OLD.queued_at, OLD.requested_runtime_class,
            OLD.last_transition_command_id) THEN
            RAISE EXCEPTION 'queue binding is immutable' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NOT ((OLD.status = 'READY' AND NEW.status = 'QUEUED')
        OR (OLD.status = 'QUEUED' AND NEW.status = 'RUNNING')) THEN
        -- The existing V3005 DRAFT -> READY transition remains owned by Freeze.
        IF OLD.status = 'DRAFT' AND NEW.status = 'READY' THEN RETURN NEW; END IF;
        RAISE EXCEPTION 'unsupported WorkOrder transition' USING ERRCODE = '23514';
    END IF;
    IF NEW.aggregate_version <> OLD.aggregate_version + 1
       OR NEW.last_transition_command_id IS NULL
       OR NEW.last_transition_command_id IS NOT DISTINCT FROM OLD.last_transition_command_id THEN
        RAISE EXCEPTION 'WorkOrder transition version or command identity mismatch'
            USING ERRCODE = '23514';
    END IF;
    SELECT * INTO source_receipt FROM task_execution.command_receipt
     WHERE command_id = NEW.last_transition_command_id;
    IF NOT FOUND OR source_receipt.outcome <> 'PENDING'
       OR source_receipt.command_version <> '1.0'
       OR NOT ((NEW.status = 'QUEUED'
                AND source_receipt.command_type = 'execution.queue_work_order')
            OR (NEW.status = 'RUNNING'
                AND source_receipt.command_type = 'execution.reconcile_work_order_execution'))
       OR source_receipt.target_type <> 'zhiju.execution.work_order'
       OR source_receipt.target_id <> NEW.work_order_id
       OR source_receipt.enterprise_id <> NEW.enterprise_id
       OR source_receipt.project_id <> NEW.project_id
       OR source_receipt.created_by_principal_id <> platform_security.context_principal_id()
       OR source_receipt.authorization_decision_id IS DISTINCT FROM
            (SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'WorkOrder transition is not runner-bound'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.status = 'QUEUED' THEN
        IF OLD.work_order_object_type <> 'zhiju.execution.work_order'
           OR OLD.draft_schema_version <> '1.1'
           OR OLD.frozen_contract_id IS NULL
           OR NEW.queue_policy_ref IS NULL
           OR NEW.queued_at IS NULL
           OR NEW.requested_runtime_class <> 'te.human_operated.synthetic' THEN
            RAISE EXCEPTION 'unsupported WorkOrder queue binding' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF (NEW.queue_policy_ref, NEW.queued_at, NEW.requested_runtime_class)
           IS DISTINCT FROM
           (OLD.queue_policy_ref, OLD.queued_at, OLD.requested_runtime_class)
           OR NOT EXISTS (
               SELECT 1 FROM task_execution.run r
               JOIN task_execution.work_order_run_claim c
                 ON c.run_id = r.run_id AND c.work_order_id = r.work_order_id
               WHERE r.work_order_id = NEW.work_order_id
                 AND r.enterprise_id = NEW.enterprise_id
                 AND r.project_id = NEW.project_id
                 AND r.status = 'RUNNING' AND c.status = 'ACTIVE') THEN
            RAISE EXCEPTION 'WorkOrder reconciliation has no active running Run'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION task_execution.guard_first_run_work_order_transition() FROM PUBLIC;
CREATE TRIGGER first_run_work_order_transition_guard
    BEFORE UPDATE ON task_execution.work_order
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_first_run_work_order_transition();

CREATE TABLE task_execution.run (
    run_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    work_order_id uuid NOT NULL,
    work_order_ref jsonb NOT NULL,
    work_order_contract_ref jsonb NOT NULL,
    context_snapshot_ref jsonb NOT NULL,
    capability_grant_ref jsonb NOT NULL,
    attempt_number integer NOT NULL CHECK (attempt_number = 1),
    runtime_binding jsonb NOT NULL,
    lease_policy_ref jsonb NOT NULL,
    lease_id uuid NOT NULL,
    fencing_token bigint NOT NULL CHECK (fencing_token >= 1),
    lease_expires_at timestamptz NOT NULL,
    execution_deadline timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'CREATED'
        CHECK (status IN ('CREATED', 'STARTING', 'RUNNING')),
    aggregate_version bigint NOT NULL DEFAULT 1 CHECK (aggregate_version >= 1),
    created_at timestamptz NOT NULL,
    started_at timestamptz,
    start_attempt_ref jsonb,
    source_command_id uuid NOT NULL,
    last_command_id uuid,
    created_by_principal_id uuid NOT NULL,
    CONSTRAINT run_scope_unique UNIQUE (enterprise_id, project_id, run_id),
    CONSTRAINT run_work_order_attempt_unique UNIQUE (work_order_id, attempt_number),
    CONSTRAINT run_work_order_fk FOREIGN KEY (enterprise_id, project_id, work_order_id)
        REFERENCES task_execution.work_order (enterprise_id, project_id, work_order_id)
        ON DELETE RESTRICT,
    CONSTRAINT run_binding_scope CHECK (
        work_order_ref->>'objectId' = work_order_id::text
        AND work_order_ref->'scope' = jsonb_build_object(
            'enterpriseId', enterprise_id::text, 'projectId', project_id::text)
        AND work_order_contract_ref->'scope' = work_order_ref->'scope'
        AND context_snapshot_ref->'scope' = work_order_ref->'scope'
        AND capability_grant_ref->'scope' = work_order_ref->'scope'
        AND lease_policy_ref->'scope' = work_order_ref->'scope'),
    CONSTRAINT run_lease_order CHECK (
        lease_expires_at > created_at AND execution_deadline = lease_expires_at),
    CONSTRAINT run_status_shape CHECK (
        (status IN ('CREATED', 'STARTING') AND started_at IS NULL
            AND start_attempt_ref IS NULL)
        OR (status = 'RUNNING' AND started_at IS NOT NULL
            AND start_attempt_ref IS NOT NULL)),
    CONSTRAINT run_runtime_binding_closed CHECK (
        runtime_binding = jsonb_build_object(
          'adapterCode', 'te.human_operated.synthetic',
          'adapterVersion', '1.0',
          'harnessId', 'zhiju.runtime.synthetic',
          'harnessVersion', '1.0',
          'provider', 'synthetic',
          'modelId', 'synthetic',
          'modelConfigHash', jsonb_build_object(
             'algorithm', 'SHA-256',
             'canonicalizationVersion', '1',
             'digest', encode(sha256(convert_to('{}','UTF8')),'hex'))))
);

CREATE TABLE task_execution.work_order_run_claim (
    work_order_id uuid NOT NULL,
    run_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    attempt_number integer NOT NULL CHECK (attempt_number = 1),
    fencing_token bigint NOT NULL CHECK (fencing_token >= 1),
    status text NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED', 'EXPIRED')),
    source_command_id uuid NOT NULL,
    CONSTRAINT work_order_run_claim_attempt_unique UNIQUE (work_order_id, attempt_number),
    CONSTRAINT work_order_run_claim_run_fk FOREIGN KEY (enterprise_id, project_id, run_id)
        REFERENCES task_execution.run (enterprise_id, project_id, run_id) ON DELETE RESTRICT,
    CONSTRAINT work_order_run_claim_work_order_fk FOREIGN KEY (enterprise_id, project_id, work_order_id)
        REFERENCES task_execution.work_order (enterprise_id, project_id, work_order_id)
        ON DELETE RESTRICT
);
CREATE UNIQUE INDEX work_order_one_active_run
    ON task_execution.work_order_run_claim (work_order_id) WHERE status = 'ACTIVE';

CREATE FUNCTION task_execution.guard_first_run_claim() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog
AS $guard$
DECLARE source_receipt task_execution.command_receipt%ROWTYPE;
DECLARE run_row task_execution.run%ROWTYPE;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Run claim is immutable in this slice' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO source_receipt FROM task_execution.command_receipt
     WHERE command_id = NEW.source_command_id;
    SELECT * INTO run_row FROM task_execution.run WHERE run_id = NEW.run_id;
    IF source_receipt.outcome IS DISTINCT FROM 'PENDING'
       OR source_receipt.command_type IS DISTINCT FROM 'execution.create_run'
       OR source_receipt.target_id IS DISTINCT FROM NEW.run_id
       OR source_receipt.enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR source_receipt.project_id IS DISTINCT FROM NEW.project_id
       OR source_receipt.created_by_principal_id IS DISTINCT FROM
            platform_security.context_principal_id()
       OR run_row.source_command_id IS DISTINCT FROM NEW.source_command_id
       OR run_row.enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR run_row.project_id IS DISTINCT FROM NEW.project_id
       OR run_row.work_order_id IS DISTINCT FROM NEW.work_order_id
       OR run_row.attempt_number IS DISTINCT FROM NEW.attempt_number
       OR run_row.fencing_token IS DISTINCT FROM NEW.fencing_token
       OR NEW.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Run claim is not bound to its created Run'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION task_execution.guard_first_run_claim() FROM PUBLIC;
CREATE TRIGGER first_run_claim_guard
    BEFORE INSERT OR UPDATE OR DELETE ON task_execution.work_order_run_claim
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_first_run_claim();

CREATE FUNCTION task_execution.guard_first_run_creation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog
AS $guard$
DECLARE source_receipt task_execution.command_receipt%ROWTYPE;
DECLARE parent task_execution.work_order%ROWTYPE;
BEGIN
    SELECT * INTO source_receipt FROM task_execution.command_receipt
     WHERE command_id = NEW.source_command_id;
    IF NOT FOUND OR source_receipt.outcome <> 'PENDING'
       OR source_receipt.command_type <> 'execution.create_run'
       OR source_receipt.command_version <> '1.0'
       OR source_receipt.target_type <> 'execution.run'
       OR source_receipt.target_id <> NEW.run_id
       OR source_receipt.enterprise_id <> NEW.enterprise_id
       OR source_receipt.project_id <> NEW.project_id
       OR source_receipt.created_by_principal_id <> platform_security.context_principal_id()
       OR NEW.created_by_principal_id <> platform_security.context_principal_id()
       OR source_receipt.authorization_decision_id IS DISTINCT FROM
            (SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'Run creation is not runner-bound' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO parent FROM task_execution.work_order
     WHERE work_order_id = NEW.work_order_id AND enterprise_id = NEW.enterprise_id
       AND project_id = NEW.project_id FOR SHARE;
    IF NOT FOUND OR parent.status <> 'QUEUED'
       OR parent.frozen_contract_id::text <> NEW.work_order_contract_ref->>'objectId'
       OR encode(parent.frozen_contract_hash, 'hex') <>
          NEW.work_order_contract_ref->'contentHash'->>'digest'
       OR parent.queue_policy_ref IS DISTINCT FROM NEW.lease_policy_ref THEN
        RAISE EXCEPTION 'Run parent binding is not queued and frozen'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION task_execution.guard_first_run_creation() FROM PUBLIC;
CREATE TRIGGER first_run_creation_guard BEFORE INSERT ON task_execution.run
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_first_run_creation();

CREATE FUNCTION task_execution.guard_first_run_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog
AS $guard$
DECLARE source_receipt task_execution.command_receipt%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Run is not deletable' USING ERRCODE = '23514';
    END IF;
    IF (NEW.enterprise_id, NEW.project_id, NEW.work_order_id, NEW.work_order_ref,
        NEW.work_order_contract_ref, NEW.context_snapshot_ref, NEW.capability_grant_ref,
        NEW.attempt_number, NEW.runtime_binding, NEW.lease_policy_ref, NEW.lease_id,
        NEW.fencing_token, NEW.lease_expires_at, NEW.execution_deadline,
        NEW.created_at, NEW.source_command_id, NEW.created_by_principal_id)
       IS DISTINCT FROM
       (OLD.enterprise_id, OLD.project_id, OLD.work_order_id, OLD.work_order_ref,
        OLD.work_order_contract_ref, OLD.context_snapshot_ref, OLD.capability_grant_ref,
        OLD.attempt_number, OLD.runtime_binding, OLD.lease_policy_ref, OLD.lease_id,
        OLD.fencing_token, OLD.lease_expires_at, OLD.execution_deadline,
        OLD.created_at, OLD.source_command_id, OLD.created_by_principal_id)
       OR OLD.status NOT IN ('CREATED', 'STARTING') OR NEW.status <> 'RUNNING'
       OR NEW.aggregate_version <> OLD.aggregate_version + 1
       OR NEW.last_command_id IS NULL OR NEW.started_at IS NULL
       OR NEW.start_attempt_ref IS NULL THEN
        RAISE EXCEPTION 'invalid first Run transition' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO source_receipt FROM task_execution.command_receipt
     WHERE command_id = NEW.last_command_id;
    IF NOT FOUND OR source_receipt.outcome <> 'PENDING'
       OR source_receipt.command_type <> 'execution.start_run'
       OR source_receipt.target_id <> NEW.run_id
       OR source_receipt.enterprise_id <> NEW.enterprise_id
       OR source_receipt.project_id <> NEW.project_id
       OR source_receipt.created_by_principal_id <> platform_security.context_principal_id()
       OR source_receipt.authorization_decision_id IS DISTINCT FROM
            (SELECT decision_id FROM platform_security.context_authorization_decision_ref()) THEN
        RAISE EXCEPTION 'Run start is not runner-bound' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION task_execution.guard_first_run_update() FROM PUBLIC;
CREATE TRIGGER first_run_update_guard BEFORE UPDATE OR DELETE ON task_execution.run
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_first_run_update();

ALTER TABLE task_execution.run ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.run FORCE ROW LEVEL SECURITY;
CREATE POLICY first_run_select ON task_execution.run FOR SELECT TO task_execution_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY first_run_insert ON task_execution.run FOR INSERT TO task_execution_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id)
        AND created_by_principal_id = platform_security.context_principal_id());
CREATE POLICY first_run_update ON task_execution.run FOR UPDATE TO task_execution_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
REVOKE DELETE ON task_execution.run FROM task_execution_app;

ALTER TABLE task_execution.work_order_run_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.work_order_run_claim FORCE ROW LEVEL SECURITY;
CREATE POLICY first_run_claim_select ON task_execution.work_order_run_claim
    FOR SELECT TO task_execution_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY first_run_claim_insert ON task_execution.work_order_run_claim
    FOR INSERT TO task_execution_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));
REVOKE UPDATE, DELETE ON task_execution.work_order_run_claim FROM task_execution_app;

RESET ROLE;
