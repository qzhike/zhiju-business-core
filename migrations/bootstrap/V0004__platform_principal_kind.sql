-- IM-06 / issue #212: backwards-compatible PrincipalKind increment for the
-- transaction-scoped RLS context (issue #210 design).
-- Design authority: .vibe/decisions/rls-transaction-context.md §3.5.
-- Runs as the migration superuser from the deployment job only.
--
-- V0003 is applied and immutable, so this forward-only migration adds the
-- trusted PrincipalKind fact next to the already-established context row:
--
--   * tx_context.principal_kind is nullable; the closed set is
--     HUMAN | AGENT | SERVICE | RUNTIME | EXTERNAL_PARTY and NULL only ever
--     means "legacy context established through the 10-argument entry point".
--     It is never defaulted, backfilled or inferred.
--   * the 10-argument establish_transaction_context(...) keeps its signature
--     and privileges and now explicitly writes principal_kind = NULL; its
--     same-transaction idempotency comparison additionally requires the
--     existing row to be NULL.
--   * a new 11-argument overload takes the kind immediately after the
--     principal id, requires the closed set, and includes the kind in its
--     same-transaction idempotency comparison. Mixing the two entries inside
--     one transaction is always a platform_context_conflict (SQLSTATE 40001).
--   * platform_security.context_principal_kind() reads the kind with the same
--     shape, ACL and expiry re-check as context_principal_id().

-- ---------------------------------------------------------------------------
-- Nullable PrincipalKind fact. The named CHECK constraint allows NULL (legacy
-- contexts) and otherwise rejects anything outside the closed set, so a
-- direct-SQL writer cannot smuggle an unknown kind past the read helper.
-- ---------------------------------------------------------------------------

ALTER TABLE platform_security.tx_context
    ADD COLUMN principal_kind text;

ALTER TABLE platform_security.tx_context
    ADD CONSTRAINT tx_context_principal_kind_closed CHECK (
        principal_kind IS NULL
        OR principal_kind IN ('HUMAN', 'AGENT', 'SERVICE', 'RUNTIME', 'EXTERNAL_PARTY')
    );

-- ---------------------------------------------------------------------------
-- Legacy entry point, rebuilt with the identical signature. Every V0003
-- validation and the pool-reuse cleanup are preserved verbatim; the only
-- behavioural change is that the row is written with principal_kind = NULL
-- and that an existing row carrying a kind never matches the idempotent
-- replay comparison.
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

    -- Idempotent replay of the exact same legacy context inside one
    -- transaction is a no-op; a legacy context never matches a row that
    -- carries a kind, and a different second context is refused instead of
    -- being merged or overwritten.
    IF EXISTS (SELECT 1 FROM platform_security.tx_context
               WHERE backend_pid = pg_backend_pid() AND xact_id = txid_current()) THEN
        IF EXISTS (SELECT 1 FROM platform_security.tx_context
                   WHERE backend_pid = pg_backend_pid()
                     AND xact_id = txid_current()
                     AND context_kind = p_context_kind
                     AND principal_id = p_principal_id
                     AND principal_kind IS NULL
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
        principal_id, principal_kind, actor_snapshot_id,
        authorization_decision_id, authorization_decision_hash,
        authorization_decision_expires_at,
        enterprise_id, allowed_project_ids, correlation_id, source_event_id,
        established_by, session_user_name
    ) VALUES (
        pg_backend_pid(), txid_current(), p_context_kind,
        p_principal_id, NULL, p_actor_snapshot_id,
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
-- PrincipalKind-carrying entry point. Same role, Decision-reference, expiry,
-- Scope, cleanup and audit constraints as the legacy entry, plus the closed
-- kind. The kind is part of the same-transaction idempotency comparison, so
-- the two entries can never be merged inside one transaction.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION platform_security.establish_transaction_context(
    p_context_kind text,
    p_principal_id uuid,
    p_principal_kind text,
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
    IF p_principal_kind IS NULL
       OR p_principal_kind NOT IN ('HUMAN', 'AGENT', 'SERVICE', 'RUNTIME', 'EXTERNAL_PARTY') THEN
        RAISE EXCEPTION 'invalid principal kind'
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

    -- Idempotent replay requires all eleven fields, kind included, to match;
    -- a legacy row (NULL kind) never matches, so a kind can neither be
    -- backfilled onto nor overwritten over an existing context.
    IF EXISTS (SELECT 1 FROM platform_security.tx_context
               WHERE backend_pid = pg_backend_pid() AND xact_id = txid_current()) THEN
        IF EXISTS (SELECT 1 FROM platform_security.tx_context
                   WHERE backend_pid = pg_backend_pid()
                     AND xact_id = txid_current()
                     AND context_kind = p_context_kind
                     AND principal_id = p_principal_id
                     AND principal_kind = p_principal_kind
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
        principal_id, principal_kind, actor_snapshot_id,
        authorization_decision_id, authorization_decision_hash,
        authorization_decision_expires_at,
        enterprise_id, allowed_project_ids, correlation_id, source_event_id,
        established_by, session_user_name
    ) VALUES (
        pg_backend_pid(), txid_current(), p_context_kind,
        p_principal_id, p_principal_kind, p_actor_snapshot_id,
        p_authorization_decision_id, p_authorization_decision_hash,
        p_authorization_decision_expires_at,
        p_enterprise_id, p_allowed_project_ids, p_correlation_id, p_source_event_id,
        current_setting('role'), session_user
    );
END
$establish$;

ALTER FUNCTION platform_security.establish_transaction_context(
    text, uuid, text, uuid, uuid, bytea, timestamptz, uuid, uuid[], uuid, uuid
) OWNER TO platform_security;

-- ---------------------------------------------------------------------------
-- Read helper. Mirrors context_principal_id() exactly: same STABLE SECURITY
-- DEFINER shape, pinned search path and per-statement expiry re-check. It
-- returns NULL without a context, for an expired context, and for a legacy
-- (NULL-kind) context, so consumers requiring a trusted kind fail closed.
-- current_context()'s composite return signature stays untouched.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION platform_security.context_principal_kind() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $fn$
    SELECT c.principal_kind
    FROM platform_security.tx_context c
    WHERE c.backend_pid = pg_backend_pid()
      AND c.xact_id = txid_current()
      AND c.authorization_decision_expires_at > statement_timestamp()
$fn$;

ALTER FUNCTION platform_security.context_principal_kind() OWNER TO platform_security;

-- ---------------------------------------------------------------------------
-- Function surface: PUBLIC gets nothing (default privileges would otherwise
-- grant EXECUTE to PUBLIC on the functions created above). Only the NOLOGIN
-- establisher can write or clear context; the read helper follows the exact
-- role list of context_principal_id().
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA platform_security FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_security.establish_transaction_context(
    text, uuid, uuid, uuid, bytea, timestamptz, uuid, uuid[], uuid, uuid
), platform_security.establish_transaction_context(
    text, uuid, text, uuid, uuid, bytea, timestamptz, uuid, uuid[], uuid, uuid
), platform_security.clear_transaction_context() TO platform_context_establisher;
GRANT EXECUTE ON FUNCTION platform_security.context_principal_kind()
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
