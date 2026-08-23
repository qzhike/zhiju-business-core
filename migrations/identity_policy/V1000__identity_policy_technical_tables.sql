-- IM-02 WI-04: standard transactional technical tables for identity_policy (issue #32).
-- One owning schema per file; no cross-schema FK, no shared technical schema
-- (PG-017). Executed via SET ROLE <module>_owner so the WI-02 default
-- privileges apply (SELECT/INSERT/UPDATE to the app role, nothing to PUBLIC),
-- then tightened: append-only tables lose UPDATE, the dispatcher receives
-- column-level outbox delivery grants only.
--
-- Scope mirror: outbox payloads must embed their promoted scope
-- (payload->>'enterpriseId' / ->>'projectId'); the BEFORE INSERT OR UPDATE
-- guard rejects a mismatched mirror. Canonical payload/hash equality cannot
-- be recomputed in SQL (pgcrypto stays disabled), so payload_hash integrity
-- is enforced by the owning repository write path (WI-05/WI-06) and asserted
-- in their gate tests.

SET ROLE identity_policy_owner;

-- ---------------------------------------------------------------------------
-- command_receipt: idempotency claims. (idempotency_scope, idempotency_key)
-- is the database-adjudicated uniqueness for concurrent duplicates.
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.command_receipt (
    command_id uuid PRIMARY KEY,
    command_type text NOT NULL,
    command_version text NOT NULL,
    idempotency_scope text NOT NULL,
    idempotency_key text NOT NULL,
    request_payload_hash bytea NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    expected_aggregate_version bigint,
    outcome text NOT NULL,
    result_payload jsonb,
    result_payload_hash bytea,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    correlation_id uuid NOT NULL,
    causation_id uuid,
    created_by_principal_id uuid NOT NULL,
    actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    CONSTRAINT command_receipt_request_hash_len CHECK (octet_length(request_payload_hash) = 32),
    CONSTRAINT command_receipt_result_hash_len CHECK (
        result_payload_hash IS NULL OR octet_length(result_payload_hash) = 32),
    CONSTRAINT command_receipt_outcome_closed CHECK (
        outcome IN ('PENDING', 'COMMITTED', 'REJECTED', 'DUPLICATE')),
    CONSTRAINT command_receipt_idem_unique UNIQUE (idempotency_scope, idempotency_key)
);

CREATE INDEX command_receipt_scope_time_idx ON identity_policy.command_receipt (enterprise_id, first_seen_at DESC);
CREATE INDEX command_receipt_target_idx ON identity_policy.command_receipt (target_type, target_id, command_id);
CREATE INDEX command_receipt_correlation_idx ON identity_policy.command_receipt (correlation_id);

-- ---------------------------------------------------------------------------
-- outbox_event: business events written in the same transaction as the
-- aggregate. Payload/event id/aggregate version are immutable for the app
-- role (UPDATE revoked); the dispatcher may only update delivery metadata
-- through column-level grants.
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.outbox_event (
    event_id uuid PRIMARY KEY,
    event_type text NOT NULL,
    event_version text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    aggregate_version bigint NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    correlation_id uuid NOT NULL,
    causation_id uuid,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL,
    occurred_at timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    delivery_state text NOT NULL DEFAULT 'PENDING',
    available_at timestamptz NOT NULL DEFAULT now(),
    attempt_count integer NOT NULL DEFAULT 0,
    lease_owner text,
    lease_until timestamptz,
    lease_token bigint,
    last_error_code text,
    published_at timestamptz,
    created_by_principal_id uuid NOT NULL,
    source_command_id uuid NOT NULL,
    CONSTRAINT outbox_event_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT outbox_event_attempts_nonnegative CHECK (attempt_count >= 0),
    CONSTRAINT outbox_event_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT outbox_event_delivery_closed CHECK (
        delivery_state IN ('PENDING', 'LEASED', 'PUBLISHED', 'UNKNOWN', 'DEAD')),
    CONSTRAINT outbox_event_lease_shape CHECK (
        (lease_owner IS NULL AND lease_until IS NULL)
        OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
);

CREATE INDEX outbox_event_dispatch_idx ON identity_policy.outbox_event (available_at, recorded_at)
    WHERE delivery_state IN ('PENDING', 'UNKNOWN');
CREATE INDEX outbox_event_aggregate_idx ON identity_policy.outbox_event (aggregate_id, aggregate_version);
CREATE INDEX outbox_event_lease_idx ON identity_policy.outbox_event (lease_until)
    WHERE lease_owner IS NOT NULL;

CREATE FUNCTION identity_policy.guard_outbox_scope_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.payload->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text THEN
        RAISE EXCEPTION 'outbox scope mirror mismatch: payload enterpriseId'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.payload->>'projectId' IS DISTINCT FROM NEW.project_id::text THEN
        RAISE EXCEPTION 'outbox scope mirror mismatch: payload projectId'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE TRIGGER outbox_scope_mirror_guard
    BEFORE INSERT OR UPDATE ON identity_policy.outbox_event
    FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_outbox_scope_mirror();

-- The dispatcher never modifies the business payload columns.
REVOKE UPDATE ON identity_policy.outbox_event FROM identity_policy_app;
GRANT SELECT ON identity_policy.outbox_event TO identity_policy_dispatcher;
GRANT UPDATE (delivery_state, available_at, attempt_count, lease_owner, lease_until,
              lease_token, last_error_code, published_at)
    ON identity_policy.outbox_event TO identity_policy_dispatcher;

-- ---------------------------------------------------------------------------
-- inbox_message: at-least-once consumption claims, unique per
-- (consumer_name, event_id). Same event id with a different payload hash is
-- a quarantine case adjudicated by the WI-10 consumer, never a silent
-- overwrite (the hash columns are part of the claimed row).
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.inbox_message (
    consumer_name text NOT NULL,
    event_id uuid NOT NULL,
    event_type text NOT NULL,
    event_version text NOT NULL,
    payload_hash bytea NOT NULL,
    source_module text NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    status text NOT NULL DEFAULT 'PENDING',
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    result_command_id uuid,
    failure_code text,
    safe_error_summary text,
    correlation_id uuid NOT NULL,
    created_by_principal_id uuid NOT NULL,
    CONSTRAINT inbox_message_pkey PRIMARY KEY (consumer_name, event_id),
    CONSTRAINT inbox_message_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT inbox_message_status_closed CHECK (
        status IN ('PENDING', 'PROCESSED', 'QUARANTINED', 'FAILED'))
);

CREATE INDEX inbox_message_status_idx ON identity_policy.inbox_message (status, first_seen_at);

-- ---------------------------------------------------------------------------
-- process_instance / process_step: explicit process-manager progress with a
-- database-adjudicated "one active instance per process_type+correlation_key"
-- rule, and an immutable step history.
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.process_instance (
    process_id uuid PRIMARY KEY,
    process_type text NOT NULL,
    process_version text NOT NULL,
    correlation_key text NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    state text NOT NULL,
    aggregate_version bigint NOT NULL DEFAULT 1,
    next_action_at timestamptz,
    retry_count integer NOT NULL DEFAULT 0,
    last_consumed_event_id uuid,
    blocked_reason_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    CONSTRAINT process_instance_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT process_instance_state_closed CHECK (
        state IN ('ACTIVE', 'COMPLETED', 'FAILED', 'SUSPENDED'))
);

CREATE UNIQUE INDEX process_instance_active_unique
    ON identity_policy.process_instance (process_type, correlation_key)
    WHERE state = 'ACTIVE';
CREATE INDEX process_instance_scope_updated_idx
    ON identity_policy.process_instance (enterprise_id, updated_at DESC);

CREATE TABLE identity_policy.process_step (
    process_step_id uuid PRIMARY KEY,
    process_id uuid NOT NULL,
    step_no integer NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    input_event_id uuid,
    input_event_type text,
    issued_command_id uuid,
    issued_command_type text,
    outcome text NOT NULL,
    failure_code text,
    human_intervention text,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    CONSTRAINT process_step_no_positive CHECK (step_no >= 1),
    CONSTRAINT process_step_outcome_closed CHECK (
        outcome IN ('STARTED', 'COMPLETED', 'FAILED', 'AWAITING_HUMAN', 'SKIPPED')),
    CONSTRAINT process_step_process_fk FOREIGN KEY (process_id)
        REFERENCES identity_policy.process_instance (process_id) ON DELETE RESTRICT,
    CONSTRAINT process_step_unique UNIQUE (process_id, step_no)
);

CREATE INDEX process_step_enterprise_idx ON identity_policy.process_step (enterprise_id, recorded_at DESC);

-- Immutable step history: no UPDATE path for the app role.
REVOKE UPDATE ON identity_policy.process_step FROM identity_policy_app;

-- ---------------------------------------------------------------------------
-- audit_record: append-only audit trail. Request/result are stored as hashes
-- only; sensitive payloads are never copied. The app role may INSERT/SELECT;
-- nobody but the owner can UPDATE or DELETE.
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.audit_record (
    audit_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    principal_id uuid NOT NULL,
    actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    command_id uuid,
    command_type text,
    outcome text NOT NULL,
    error_code text,
    request_payload_hash bytea,
    result_payload_hash bytea,
    target_type text,
    target_id uuid,
    target_aggregate_version bigint,
    correlation_id uuid NOT NULL,
    causation_id uuid,
    channel_ref jsonb,
    runtime_ref jsonb,
    break_glass_reason text,
    approval_ref jsonb,
    safe_summary text,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    retention_class text NOT NULL,
    CONSTRAINT audit_record_outcome_closed CHECK (
        outcome IN ('ALLOWED', 'DENIED', 'COMMITTED', 'REJECTED', 'INFO')),
    CONSTRAINT audit_record_request_hash_len CHECK (
        request_payload_hash IS NULL OR octet_length(request_payload_hash) = 32),
    CONSTRAINT audit_record_result_hash_len CHECK (
        result_payload_hash IS NULL OR octet_length(result_payload_hash) = 32)
);

CREATE INDEX audit_record_scope_time_idx ON identity_policy.audit_record (enterprise_id, recorded_at DESC);
CREATE INDEX audit_record_command_idx ON identity_policy.audit_record (command_id);

REVOKE UPDATE ON identity_policy.audit_record FROM identity_policy_app;

-- Masked audit view for audit_reader: metadata and hashes only, no channel /
-- runtime refs or summaries that could carry sensitive context.
CREATE VIEW identity_policy.audit_record_masked AS
    SELECT audit_id, enterprise_id, project_id, command_id, command_type, outcome,
           error_code, correlation_id, recorded_at, retention_class
    FROM identity_policy.audit_record;

GRANT USAGE ON SCHEMA identity_policy TO audit_reader;
GRANT SELECT ON identity_policy.audit_record_masked TO audit_reader;

-- ---------------------------------------------------------------------------
-- reference_edge: derived typed-reference index for this module only. No
-- cross-schema FK: the target is stored as (module, type, id, version?).
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.reference_edge (
    owner_object_type text NOT NULL,
    owner_object_id uuid NOT NULL,
    owner_version_id uuid,
    owner_payload_hash bytea,
    reference_path text NOT NULL,
    target_module text NOT NULL,
    target_object_type text NOT NULL,
    target_object_id uuid NOT NULL,
    target_version_id uuid,
    target_payload_hash bytea,
    reference_purpose text NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT reference_edge_owner_hash_len CHECK (
        owner_payload_hash IS NULL OR octet_length(owner_payload_hash) = 32),
    CONSTRAINT reference_edge_target_hash_len CHECK (
        target_payload_hash IS NULL OR octet_length(target_payload_hash) = 32),
    CONSTRAINT reference_edge_unique UNIQUE NULLS NOT DISTINCT
        (owner_object_type, owner_object_id, reference_path,
         target_module, target_object_type, target_object_id, target_version_id)
);

CREATE INDEX reference_edge_target_idx
    ON identity_policy.reference_edge (target_module, target_object_type, target_object_id);
CREATE INDEX reference_edge_owner_idx
    ON identity_policy.reference_edge (owner_object_type, owner_object_id);

-- Derived index only: insert-and-read, no manual edits.
REVOKE UPDATE ON identity_policy.reference_edge FROM identity_policy_app;

-- ---------------------------------------------------------------------------
-- contract_violation: rejection facts for unknown majors/extensions, hash and
-- scope conflicts. Sensitive payloads are never stored: only hashes, schema
-- error paths and safe summaries.
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.contract_violation (
    violation_id uuid PRIMARY KEY,
    violation_kind text NOT NULL,
    contract_type text,
    contract_version text,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    observed_payload_hash bytea,
    schema_error_path text,
    safe_summary text,
    source_event_id uuid,
    consumer_name text,
    correlation_id uuid,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    CONSTRAINT contract_violation_kind_closed CHECK (
        violation_kind IN ('UNKNOWN_MAJOR', 'UNKNOWN_REQUIRED_EXTENSION', 'HASH_MISMATCH',
                           'SCOPE_MISMATCH', 'SELF_REFERENCE', 'PAYLOAD_TOO_LARGE',
                           'INBOX_HASH_CONFLICT', 'SCOPE_CONFLICT')),
    CONSTRAINT contract_violation_hash_len CHECK (
        observed_payload_hash IS NULL OR octet_length(observed_payload_hash) = 32)
);

CREATE INDEX contract_violation_kind_time_idx
    ON identity_policy.contract_violation (violation_kind, recorded_at DESC);

REVOKE UPDATE ON identity_policy.contract_violation FROM identity_policy_app;

-- ---------------------------------------------------------------------------
-- RLS: every technical table mirrors its enterprise scope and is protected by
-- the WI-03 transaction context for the app role (default-deny without a
-- context, FORCE applies to the owner as well). The dispatcher is bound to
-- its outbox only, via permissive policies plus column grants.
-- ---------------------------------------------------------------------------

ALTER TABLE identity_policy.command_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.command_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY command_receipt_select ON identity_policy.command_receipt FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY command_receipt_insert ON identity_policy.command_receipt FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY command_receipt_update ON identity_policy.command_receipt FOR UPDATE TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id))
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

ALTER TABLE identity_policy.outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.outbox_event FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_event_select ON identity_policy.outbox_event FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY outbox_event_insert ON identity_policy.outbox_event FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY outbox_event_dispatcher_select ON identity_policy.outbox_event
    FOR SELECT TO identity_policy_dispatcher USING (true);
CREATE POLICY outbox_event_dispatcher_update ON identity_policy.outbox_event
    FOR UPDATE TO identity_policy_dispatcher USING (true) WITH CHECK (true);

ALTER TABLE identity_policy.inbox_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.inbox_message FORCE ROW LEVEL SECURITY;
CREATE POLICY inbox_message_select ON identity_policy.inbox_message FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY inbox_message_insert ON identity_policy.inbox_message FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY inbox_message_update ON identity_policy.inbox_message FOR UPDATE TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id))
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

ALTER TABLE identity_policy.process_instance ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.process_instance FORCE ROW LEVEL SECURITY;
CREATE POLICY process_instance_select ON identity_policy.process_instance FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY process_instance_insert ON identity_policy.process_instance FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY process_instance_update ON identity_policy.process_instance FOR UPDATE TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id))
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

ALTER TABLE identity_policy.process_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.process_step FORCE ROW LEVEL SECURITY;
CREATE POLICY process_step_select ON identity_policy.process_step FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY process_step_insert ON identity_policy.process_step FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

ALTER TABLE identity_policy.audit_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.audit_record FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_record_select ON identity_policy.audit_record FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY audit_record_insert ON identity_policy.audit_record FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

ALTER TABLE identity_policy.reference_edge ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.reference_edge FORCE ROW LEVEL SECURITY;
CREATE POLICY reference_edge_select ON identity_policy.reference_edge FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY reference_edge_insert ON identity_policy.reference_edge FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

ALTER TABLE identity_policy.contract_violation ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.contract_violation FORCE ROW LEVEL SECURITY;
CREATE POLICY contract_violation_select ON identity_policy.contract_violation FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY contract_violation_insert ON identity_policy.contract_violation FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Platform-scope technical tables (identity_policy only). PG-008 forbids
-- mixing platform and enterprise rows through a nullable scope column, so
-- the platform commands/events/audit of the security module live in their
-- own tables without enterprise columns. RLS still requires a valid
-- transaction context (default-deny without one).
-- ---------------------------------------------------------------------------

SET ROLE identity_policy_owner;

CREATE TABLE identity_policy.platform_command_receipt (
    command_id uuid PRIMARY KEY,
    command_type text NOT NULL,
    command_version text NOT NULL,
    idempotency_scope text NOT NULL,
    idempotency_key text NOT NULL,
    request_payload_hash bytea NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    expected_aggregate_version bigint,
    outcome text NOT NULL,
    result_payload jsonb,
    result_payload_hash bytea,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    correlation_id uuid NOT NULL,
    causation_id uuid,
    created_by_principal_id uuid NOT NULL,
    actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    CONSTRAINT platform_receipt_request_hash_len CHECK (octet_length(request_payload_hash) = 32),
    CONSTRAINT platform_receipt_result_hash_len CHECK (
        result_payload_hash IS NULL OR octet_length(result_payload_hash) = 32),
    CONSTRAINT platform_receipt_outcome_closed CHECK (
        outcome IN ('PENDING', 'COMMITTED', 'REJECTED', 'DUPLICATE')),
    CONSTRAINT platform_receipt_idem_unique UNIQUE (idempotency_scope, idempotency_key)
);

CREATE INDEX platform_receipt_time_idx
    ON identity_policy.platform_command_receipt (first_seen_at DESC);
CREATE INDEX platform_receipt_correlation_idx
    ON identity_policy.platform_command_receipt (correlation_id);

CREATE TABLE identity_policy.platform_outbox_event (
    event_id uuid PRIMARY KEY,
    event_type text NOT NULL,
    event_version text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    aggregate_version bigint NOT NULL,
    correlation_id uuid NOT NULL,
    causation_id uuid,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL,
    occurred_at timestamptz NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    delivery_state text NOT NULL DEFAULT 'PENDING',
    available_at timestamptz NOT NULL DEFAULT now(),
    attempt_count integer NOT NULL DEFAULT 0,
    lease_owner text,
    lease_until timestamptz,
    lease_token bigint,
    last_error_code text,
    published_at timestamptz,
    created_by_principal_id uuid NOT NULL,
    source_command_id uuid NOT NULL,
    CONSTRAINT platform_outbox_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT platform_outbox_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT platform_outbox_delivery_closed CHECK (
        delivery_state IN ('PENDING', 'LEASED', 'PUBLISHED', 'UNKNOWN', 'DEAD')),
    CONSTRAINT platform_outbox_lease_shape CHECK (
        (lease_owner IS NULL AND lease_until IS NULL)
        OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL))
);

CREATE INDEX platform_outbox_dispatch_idx ON identity_policy.platform_outbox_event (available_at, recorded_at)
    WHERE delivery_state IN ('PENDING', 'UNKNOWN');

REVOKE UPDATE ON identity_policy.platform_outbox_event FROM identity_policy_app;
GRANT SELECT ON identity_policy.platform_outbox_event TO identity_policy_dispatcher;
GRANT UPDATE (delivery_state, available_at, attempt_count, lease_owner, lease_until,
              lease_token, last_error_code, published_at)
    ON identity_policy.platform_outbox_event TO identity_policy_dispatcher;

CREATE TABLE identity_policy.platform_audit_record (
    audit_id uuid PRIMARY KEY,
    principal_id uuid NOT NULL,
    actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    command_id uuid,
    command_type text,
    outcome text NOT NULL,
    error_code text,
    request_payload_hash bytea,
    result_payload_hash bytea,
    target_type text,
    target_id uuid,
    correlation_id uuid NOT NULL,
    causation_id uuid,
    safe_summary text,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    retention_class text NOT NULL,
    CONSTRAINT platform_audit_outcome_closed CHECK (
        outcome IN ('ALLOWED', 'DENIED', 'COMMITTED', 'REJECTED', 'INFO')),
    CONSTRAINT platform_audit_request_hash_len CHECK (
        request_payload_hash IS NULL OR octet_length(request_payload_hash) = 32),
    CONSTRAINT platform_audit_result_hash_len CHECK (
        result_payload_hash IS NULL OR octet_length(result_payload_hash) = 32)
);

CREATE INDEX platform_audit_time_idx ON identity_policy.platform_audit_record (recorded_at DESC);

REVOKE UPDATE ON identity_policy.platform_audit_record FROM identity_policy_app;

CREATE VIEW identity_policy.platform_audit_record_masked AS
    SELECT audit_id, command_id, command_type, outcome, error_code, correlation_id,
           recorded_at, retention_class
    FROM identity_policy.platform_audit_record;

GRANT SELECT ON identity_policy.platform_audit_record_masked TO audit_reader;

ALTER TABLE identity_policy.platform_command_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.platform_command_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_command_receipt_select ON identity_policy.platform_command_receipt
    FOR SELECT TO identity_policy_app USING (platform_security.context_is_valid());
CREATE POLICY platform_command_receipt_insert ON identity_policy.platform_command_receipt
    FOR INSERT TO identity_policy_app WITH CHECK (platform_security.context_is_valid());
CREATE POLICY platform_command_receipt_update ON identity_policy.platform_command_receipt
    FOR UPDATE TO identity_policy_app
    USING (platform_security.context_is_valid())
    WITH CHECK (platform_security.context_is_valid());

ALTER TABLE identity_policy.platform_outbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.platform_outbox_event FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_outbox_select ON identity_policy.platform_outbox_event
    FOR SELECT TO identity_policy_app USING (platform_security.context_is_valid());
CREATE POLICY platform_outbox_insert ON identity_policy.platform_outbox_event
    FOR INSERT TO identity_policy_app WITH CHECK (platform_security.context_is_valid());
CREATE POLICY platform_outbox_dispatcher_select ON identity_policy.platform_outbox_event
    FOR SELECT TO identity_policy_dispatcher USING (true);
CREATE POLICY platform_outbox_dispatcher_update ON identity_policy.platform_outbox_event
    FOR UPDATE TO identity_policy_dispatcher USING (true) WITH CHECK (true);

ALTER TABLE identity_policy.platform_audit_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.platform_audit_record FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_audit_select ON identity_policy.platform_audit_record
    FOR SELECT TO identity_policy_app USING (platform_security.context_is_valid());
CREATE POLICY platform_audit_insert ON identity_policy.platform_audit_record
    FOR INSERT TO identity_policy_app WITH CHECK (platform_security.context_is_valid());

RESET ROLE;
