-- IM-02 WI-03: transaction-scoped RLS context and scope anti-forgery (issue #31).
-- Design authority: .vibe/im-02-workitem-issues/rls-context-design-wi-03.md.
-- Runs as the migration superuser from the deployment job only.
--
-- Mechanism summary (threat model in the design doc): the transaction context
-- is NOT carried in forgeable custom GUCs. It is a row in
-- platform_security.tx_context keyed by (pg_backend_pid(), txid_current()) and
-- written exclusively by the SECURITY DEFINER entry point, which validates the
-- AuthorizationDecision reference (id + 32-byte hash + not-yet-expired) and the
-- context shape before inserting. Runtime roles hold zero table privileges, so
-- a forged context cannot exist; commit/rollback assigns a new transaction id,
-- so pool reuse can never observe a previous request's context.

-- ---------------------------------------------------------------------------
-- Owner role and schema. platform_security is a NOLOGIN, non-privileged role:
-- it owns only the context machinery. It is not a module owner, cannot log in,
-- and holds no BYPASSRLS/CREATEROLE/SUPERUSER attribute.
-- ---------------------------------------------------------------------------

CREATE ROLE platform_security NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE ROLE platform_context_establisher NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

CREATE SCHEMA platform_security AUTHORIZATION platform_security;
REVOKE ALL ON SCHEMA platform_security FROM PUBLIC;

-- The NOLOGIN establisher is the only context writer. Runtime roles and module
-- owners receive schema access for read helpers only. Dispatchers,
-- audit_reader, migration_runner and PUBLIC receive no access.
GRANT USAGE ON SCHEMA platform_security TO
    platform_context_establisher,
    identity_policy_app,
    enterprise_project_app,
    task_execution_app,
    artifact_app,
    quality_governance_app,
    release_publication_app,
    integration_gateway_app,
    projection_app,
    identity_policy_owner,
    enterprise_project_owner,
    task_execution_owner,
    artifact_owner,
    quality_governance_owner,
    release_publication_owner,
    integration_gateway_owner;

-- ---------------------------------------------------------------------------
-- Context fact table. RLS enabled with default-deny (no policies) so even an
-- accidental future table grant yields zero rows for non-owners; the owner
-- reads it only through the SECURITY DEFINER functions below. FORCE is
-- deliberately NOT set: the owner role is the trusted reader, and no other
-- role can query the table at all.
-- ---------------------------------------------------------------------------

CREATE TABLE platform_security.tx_context (
    backend_pid integer NOT NULL,
    xact_id bigint NOT NULL,
    context_kind text NOT NULL,
    principal_id uuid NOT NULL,
    actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    authorization_decision_hash bytea NOT NULL,
    authorization_decision_expires_at timestamptz NOT NULL,
    enterprise_id uuid NOT NULL,
    allowed_project_ids uuid[] NOT NULL,
    correlation_id uuid NOT NULL,
    source_event_id uuid,
    established_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    established_by text NOT NULL,
    session_user_name text NOT NULL,
    CONSTRAINT tx_context_pk PRIMARY KEY (backend_pid, xact_id),
    CONSTRAINT tx_context_kind_closed CHECK (context_kind IN ('REQUEST', 'EVENT_CONSUMER')),
    CONSTRAINT tx_context_decision_hash_len CHECK (octet_length(authorization_decision_hash) = 32),
    CONSTRAINT tx_context_project_scope_elements CHECK (
        array_position(allowed_project_ids, NULL) IS NULL
    ),
    CONSTRAINT tx_context_consumer_shape CHECK (
        context_kind <> 'EVENT_CONSUMER'
        OR (source_event_id IS NOT NULL AND cardinality(allowed_project_ids) >= 1)
    ),
    CONSTRAINT tx_context_request_shape CHECK (
        context_kind <> 'REQUEST' OR source_event_id IS NULL
    )
);

ALTER TABLE platform_security.tx_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_security.tx_context OWNER TO platform_security;

-- ---------------------------------------------------------------------------
-- Establish: the single write entry point. SECURITY DEFINER owned by
-- platform_security (a plain role, never a superuser), static SQL only, with
-- the search path pinned to pg_catalog. Validates before writing, stays
-- idempotent for identical re-establishment, and refuses a conflicting second
-- context within the same transaction. Also removes stale rows left by
-- earlier transactions on the same backend (pool reuse).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION platform_security.establish_transaction_context(
    p_context_kind text,
    p_principal_id uuid,
    p_actor_snapshot_id uuid,
    p_authorization_decision_id uuid,
    p_authorization_decision_hash bytea,
    p_authorization_decision_expires_at timestamptz,
    p_enterprise_id uuid,
    p_allowed_project_ids uuid[],
    p_correlation_id uuid,
    p_source_event_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $establish$
DECLARE
    v_decision_hash_len integer;
BEGIN
    IF p_context_kind NOT IN ('REQUEST', 'EVENT_CONSUMER') THEN
        RAISE EXCEPTION 'invalid context kind'
            USING ERRCODE = '22023';
    END IF;
    IF p_principal_id IS NULL OR p_actor_snapshot_id IS NULL
       OR p_enterprise_id IS NULL OR p_correlation_id IS NULL
       OR p_allowed_project_ids IS NULL THEN
        RAISE EXCEPTION 'incomplete transaction context'
            USING ERRCODE = '22023';
    END IF;
    IF p_authorization_decision_id IS NULL OR p_authorization_decision_hash IS NULL THEN
        RAISE EXCEPTION 'missing authorization decision reference'
            USING ERRCODE = '22023';
    END IF;
    v_decision_hash_len := octet_length(p_authorization_decision_hash);
    IF v_decision_hash_len <> 32 THEN
        RAISE EXCEPTION 'authorization decision hash must be 32 bytes'
            USING ERRCODE = '22023';
    END IF;
    IF p_authorization_decision_expires_at IS NULL
       OR p_authorization_decision_expires_at <= clock_timestamp() THEN
        RAISE EXCEPTION 'authorization decision is expired or has no expiry'
            USING ERRCODE = '22023';
    END IF;
    IF p_context_kind = 'EVENT_CONSUMER' AND p_source_event_id IS NULL THEN
        RAISE EXCEPTION 'event consumer context requires source_event_id'
            USING ERRCODE = '22023';
    END IF;
    IF p_context_kind = 'EVENT_CONSUMER' AND cardinality(p_allowed_project_ids) < 1 THEN
        RAISE EXCEPTION 'event consumer context requires at least one project scope'
            USING ERRCODE = '22023';
    END IF;
    IF array_position(p_allowed_project_ids, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'transaction context must not contain a null project scope'
            USING ERRCODE = '22023';
    END IF;
    IF p_context_kind = 'REQUEST' AND p_source_event_id IS NOT NULL THEN
        RAISE EXCEPTION 'request context must not carry source_event_id'
            USING ERRCODE = '22023';
    END IF;

    -- Idempotent replay of the exact same context inside one transaction is a
    -- no-op; a different second context in the same transaction is refused
    -- instead of being merged or overwritten.
    IF EXISTS (SELECT 1 FROM platform_security.tx_context
               WHERE backend_pid = pg_backend_pid() AND xact_id = txid_current()) THEN
        IF EXISTS (SELECT 1 FROM platform_security.tx_context
                   WHERE backend_pid = pg_backend_pid()
                     AND xact_id = txid_current()
                     AND context_kind = p_context_kind
                     AND principal_id = p_principal_id
                     AND actor_snapshot_id = p_actor_snapshot_id
                     AND authorization_decision_id = p_authorization_decision_id
                     AND authorization_decision_hash = p_authorization_decision_hash
                     AND authorization_decision_expires_at = p_authorization_decision_expires_at
                     AND enterprise_id = p_enterprise_id
                     AND allowed_project_ids = p_allowed_project_ids
                     AND correlation_id = p_correlation_id
                     AND source_event_id IS NOT DISTINCT FROM p_source_event_id) THEN
            RETURN;
        END IF;
        RAISE EXCEPTION 'platform_context_conflict: transaction already has a different context'
            USING ERRCODE = '40001';
    END IF;

    -- Housekeeping for pool reuse: rows of completed transactions on this
    -- backend are logically invisible (new txid) and physically removed here.
    DELETE FROM platform_security.tx_context
    WHERE backend_pid = pg_backend_pid()
      AND xact_id <> txid_current();

    INSERT INTO platform_security.tx_context (
        backend_pid, xact_id, context_kind,
        principal_id, actor_snapshot_id,
        authorization_decision_id, authorization_decision_hash,
        authorization_decision_expires_at,
        enterprise_id, allowed_project_ids, correlation_id, source_event_id,
        established_by, session_user_name
    ) VALUES (
        pg_backend_pid(), txid_current(), p_context_kind,
        p_principal_id, p_actor_snapshot_id,
        p_authorization_decision_id, p_authorization_decision_hash,
        p_authorization_decision_expires_at,
        p_enterprise_id, p_allowed_project_ids, p_correlation_id, p_source_event_id,
        current_setting('role'), session_user
    );
END
$establish$;

ALTER FUNCTION platform_security.establish_transaction_context(
    text, uuid, uuid, uuid, bytea, timestamptz, uuid, uuid[], uuid, uuid
) OWNER TO platform_security;

-- ---------------------------------------------------------------------------
-- Read helpers used by module RLS policies. All STABLE + SECURITY DEFINER,
-- owned by platform_security, pinned search path, never error, never leak
-- values: without a live context they return NULL/false so policies fold to
-- zero rows / WITH CHECK rejection. Expiry is re-checked at evaluation time.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION platform_security.current_context()
RETURNS TABLE (
    context_kind text,
    principal_id uuid,
    actor_snapshot_id uuid,
    authorization_decision_id uuid,
    authorization_decision_hash bytea,
    authorization_decision_expires_at timestamptz,
    enterprise_id uuid,
    allowed_project_ids uuid[],
    correlation_id uuid,
    source_event_id uuid,
    established_at timestamptz,
    established_by text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $context$
    SELECT c.context_kind, c.principal_id, c.actor_snapshot_id,
           c.authorization_decision_id, c.authorization_decision_hash,
           c.authorization_decision_expires_at,
           c.enterprise_id, c.allowed_project_ids, c.correlation_id,
           c.source_event_id, c.established_at, c.established_by
    FROM platform_security.tx_context c
    WHERE c.backend_pid = pg_backend_pid()
      AND c.xact_id = txid_current()
      AND c.authorization_decision_expires_at > statement_timestamp()
$context$;

CREATE OR REPLACE FUNCTION platform_security.context_is_valid() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM platform_security.tx_context c
        WHERE c.backend_pid = pg_backend_pid()
          AND c.xact_id = txid_current()
          AND c.authorization_decision_expires_at > statement_timestamp()
    )
$fn$;

CREATE OR REPLACE FUNCTION platform_security.context_enterprise_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
    SELECT c.enterprise_id
    FROM platform_security.tx_context c
    WHERE c.backend_pid = pg_backend_pid()
      AND c.xact_id = txid_current()
      AND c.authorization_decision_expires_at > statement_timestamp()
$fn$;

CREATE OR REPLACE FUNCTION platform_security.context_allows_enterprise(p_enterprise_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM platform_security.tx_context c
        WHERE c.backend_pid = pg_backend_pid()
          AND c.xact_id = txid_current()
          AND c.authorization_decision_expires_at > statement_timestamp()
          AND c.enterprise_id = p_enterprise_id
    )
$fn$;

CREATE OR REPLACE FUNCTION platform_security.context_allows_project(
    p_enterprise_id uuid,
    p_project_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
    SELECT EXISTS (
        SELECT 1 FROM platform_security.tx_context c
        WHERE c.backend_pid = pg_backend_pid()
          AND c.xact_id = txid_current()
          AND c.authorization_decision_expires_at > statement_timestamp()
          AND c.enterprise_id = p_enterprise_id
          AND p_project_id = ANY (c.allowed_project_ids)
    )
$fn$;

CREATE OR REPLACE FUNCTION platform_security.context_principal_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
    SELECT c.principal_id
    FROM platform_security.tx_context c
    WHERE c.backend_pid = pg_backend_pid()
      AND c.xact_id = txid_current()
      AND c.authorization_decision_expires_at > statement_timestamp()
$fn$;

CREATE OR REPLACE FUNCTION platform_security.context_actor_snapshot_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
    SELECT c.actor_snapshot_id
    FROM platform_security.tx_context c
    WHERE c.backend_pid = pg_backend_pid()
      AND c.xact_id = txid_current()
      AND c.authorization_decision_expires_at > statement_timestamp()
$fn$;

CREATE OR REPLACE FUNCTION platform_security.context_correlation_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
    SELECT c.correlation_id
    FROM platform_security.tx_context c
    WHERE c.backend_pid = pg_backend_pid()
      AND c.xact_id = txid_current()
      AND c.authorization_decision_expires_at > statement_timestamp()
$fn$;

CREATE OR REPLACE FUNCTION platform_security.context_kind() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
    SELECT c.context_kind
    FROM platform_security.tx_context c
    WHERE c.backend_pid = pg_backend_pid()
      AND c.xact_id = txid_current()
      AND c.authorization_decision_expires_at > statement_timestamp()
$fn$;

CREATE OR REPLACE FUNCTION platform_security.context_authorization_decision_ref()
RETURNS TABLE (decision_id uuid, payload_hash bytea)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
    SELECT c.authorization_decision_id, c.authorization_decision_hash
    FROM platform_security.tx_context c
    WHERE c.backend_pid = pg_backend_pid()
      AND c.xact_id = txid_current()
      AND c.authorization_decision_expires_at > statement_timestamp()
$fn$;

-- Explicit teardown for applications that want to clear residual rows of
-- finished transactions on their own backend (belt-and-braces on top of the
-- txid isolation that already makes them invisible).
CREATE OR REPLACE FUNCTION platform_security.clear_transaction_context() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $clear$
BEGIN
    DELETE FROM platform_security.tx_context
    WHERE backend_pid = pg_backend_pid()
      AND xact_id <> txid_current();
END
$clear$;

ALTER FUNCTION platform_security.current_context() OWNER TO platform_security;
ALTER FUNCTION platform_security.context_is_valid() OWNER TO platform_security;
ALTER FUNCTION platform_security.context_enterprise_id() OWNER TO platform_security;
ALTER FUNCTION platform_security.context_allows_enterprise(uuid) OWNER TO platform_security;
ALTER FUNCTION platform_security.context_allows_project(uuid, uuid) OWNER TO platform_security;
ALTER FUNCTION platform_security.context_principal_id() OWNER TO platform_security;
ALTER FUNCTION platform_security.context_actor_snapshot_id() OWNER TO platform_security;
ALTER FUNCTION platform_security.context_correlation_id() OWNER TO platform_security;
ALTER FUNCTION platform_security.context_kind() OWNER TO platform_security;
ALTER FUNCTION platform_security.context_authorization_decision_ref() OWNER TO platform_security;
ALTER FUNCTION platform_security.clear_transaction_context() OWNER TO platform_security;

-- ---------------------------------------------------------------------------
-- Function surface: PUBLIC gets nothing (default privileges of the migration
-- superuser would otherwise grant EXECUTE to PUBLIC). Only the NOLOGIN
-- establisher can write or clear context. Runtime roles and owners can execute
-- the read helpers used by RLS policy expressions.
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform_security FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_security.establish_transaction_context(
    text, uuid, uuid, uuid, bytea, timestamptz, uuid, uuid[], uuid, uuid
), platform_security.clear_transaction_context() TO platform_context_establisher;
GRANT EXECUTE ON FUNCTION
    platform_security.current_context(),
    platform_security.context_is_valid(),
    platform_security.context_enterprise_id(),
    platform_security.context_allows_enterprise(uuid),
    platform_security.context_allows_project(uuid, uuid),
    platform_security.context_principal_id(),
    platform_security.context_actor_snapshot_id(),
    platform_security.context_correlation_id(),
    platform_security.context_kind(),
    platform_security.context_authorization_decision_ref()
TO
    identity_policy_app,
    enterprise_project_app,
    task_execution_app,
    artifact_app,
    quality_governance_app,
    release_publication_app,
    integration_gateway_app, projection_app,
    identity_policy_owner, enterprise_project_owner, task_execution_owner,
    artifact_owner, quality_governance_owner, release_publication_owner,
    integration_gateway_owner;
