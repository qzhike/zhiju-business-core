-- IM-06 (#208): TaskExecution-owned Task Readiness judgment fact.
-- Design authority: Module-Spec-003 §17.7 (approved #207 design) and the
-- PostgreSQL logical model §33 (#206 increment).
--
-- Scope of this slice: the designed table carries five judgment kinds, but
-- only `TASK_READINESS` is implemented here. `result_validation_fact` and
-- `judgment_invalidation` are not implemented and no row of any other kind can
-- be written (closed CHECK below); widening it is a deliberate future
-- migration, not a runtime decision.
--
-- A judgment is an immutable fact about one evaluation instant: it has no CAS
-- `aggregate_version`, no current pointer, no superseding edge and no mutable
-- state column. Several judgments for the same Task may coexist (different
-- methods, different instants) and the READY transition never consults a
-- "current" judgment: the transition is explained by the judgment it names,
-- that judgment's Receipt and the Reference Edges written with it.
--
-- A judgment write emits **zero** `outbox_event` rows. The Catalog registers no
-- `execution.TaskReadinessBuilt@1.0` event, so a producer must not publish one;
-- only the consumer (`execution.mark_task_ready@1.0`) writes exactly one
-- registered `execution.TaskReady@1.0` row, in its own transaction.
--
-- Mirrors and content address: every promoted column (Project Scope, subject,
-- Policy observation, evaluator, input hash, validity window, verdict) is
-- re-derived in SQL from the stored canonical payload, so a direct write cannot
-- publish a judgment whose columns disagree with its own bytes. `payload_hash`
-- is `sha256(canonical_jsonb_text(canonical_payload))`, using the owner-only
-- canonicalization-v1 helper `V3001` created (PostgreSQL 18 provides
-- `sha256(bytea)`; pgcrypto stays disabled). The judgment payload is the
-- *conclusion* of its command rather than the command's request payload, so the
-- creation-identity guard binds the Receipt's target, Scope and request hash
-- and deliberately does not require the payload to equal the request.
--
-- RLS follows the V3000/V3001 conventions: FORCE, and Project-scoped rows call
-- `context_allows_project(enterprise_id, project_id)`, so a judgment can never
-- leak through an Enterprise-only or foreign-Project Context.

SET ROLE task_execution_owner;

-- ---------------------------------------------------------------------------
-- execution_judgment: one immutable Task Readiness judgment.
-- `judgment_id` is the validated CREATE `targetRef.objectId` and is generated
-- by the application; the primary key is the CREATE identity boundary, and the
-- Project-scoped unique constraint is what adjudicates a duplicate CREATE
-- identity inside one Project Scope (mapped to CONCURRENCY_CONFLICT, never to
-- another command's result).
-- ---------------------------------------------------------------------------

CREATE TABLE task_execution.execution_judgment (
    judgment_id uuid PRIMARY KEY,
    judgment_kind text NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    task_definition_snapshot_id uuid NOT NULL,
    task_definition_hash bytea NOT NULL,
    policy_version_ref jsonb NOT NULL,
    policy_content_hash bytea NOT NULL,
    policy_effective_from timestamptz NOT NULL,
    policy_superseded_at timestamptz,
    evaluator_ref jsonb NOT NULL,
    input_hash bytea NOT NULL,
    evaluated_at timestamptz NOT NULL,
    valid_until timestamptz NOT NULL,
    ready boolean NOT NULL,
    canonical_payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    request_payload_hash bytea NOT NULL,
    source_command_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    -- §33 designs five judgment kinds. Only `TASK_READINESS` has an owning
    -- producer in this slice: `result_validation_fact` and
    -- `judgment_invalidation` do not exist yet, so accepting their kind here
    -- would let a write publish a judgment no owning invariant can guard.
    -- Widening this list must be a forward migration delivered together with
    -- the producing command of that kind.
    CONSTRAINT execution_judgment_kind_closed CHECK (
        judgment_kind IN ('TASK_READINESS')),
    -- Content addresses and the request binding are SHA-256: a row with a
    -- short or absent digest could claim an identity the application cannot
    -- recompute, so the length is enforced for every hash column.
    CONSTRAINT execution_judgment_hash_len CHECK (
        octet_length(task_definition_hash) = 32
        AND octet_length(policy_content_hash) = 32
        AND octet_length(input_hash) = 32
        AND octet_length(payload_hash) = 32
        AND octet_length(request_payload_hash) = 32),
    -- A judgment whose validity window closes before the instant it observed
    -- describes no usable interval; the consumer's `now < valid_until` check
    -- would then reject it after claiming it was fresh.
    CONSTRAINT execution_judgment_valid_until_after_evaluated CHECK (
        valid_until >= evaluated_at),
    -- Same-Project duplicate CREATE identity is adjudicated here, so the
    -- application always sees a stable business outcome instead of another
    -- command's judgment leaking through the primary key conflict.
    CONSTRAINT execution_judgment_scope_unique UNIQUE (
        enterprise_id, project_id, judgment_id),
    -- The payload is the closed §17.7 judgment body, and the mirror guard below
    -- re-derives every promoted column from it. This constraint closes the
    -- cheap structural half of that contract so a payload whose members are not
    -- even of the right JSON kind is refused before any comparison runs.
    -- Every comparison is `IS NOT DISTINCT FROM`: a plain `=` against a
    -- missing JSON member yields NULL, and SQL would let a NULL CHECK pass.
    CONSTRAINT execution_judgment_payload_shape CHECK (
        jsonb_typeof(canonical_payload) IS NOT DISTINCT FROM 'object'
        AND canonical_payload->>'judgmentKind' IS NOT DISTINCT FROM judgment_kind
        AND jsonb_typeof(canonical_payload->'scope') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'taskRef') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'taskDefinitionRef')
            IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'dependencies') IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'inputs') IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'blockers') IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'checks') IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'ready') IS NOT DISTINCT FROM 'boolean')
);

-- History read path: the judgments of one Task in this Project Scope, newest
-- first (the consumer and the explainability read resolve a judgment by id and
-- then confirm it belongs to the same Task).
CREATE INDEX execution_judgment_task_idx
    ON task_execution.execution_judgment (enterprise_id, project_id, task_id, created_at DESC);
CREATE INDEX execution_judgment_command_idx
    ON task_execution.execution_judgment (source_command_id);

-- ---------------------------------------------------------------------------
-- Payload mirror guard.
-- ---------------------------------------------------------------------------

-- The promoted columns and the stored content address must agree with the
-- canonical payload: a judgment cannot be published under a scope, subject,
-- Policy observation, evaluator, validity window or verdict that its own
-- payload does not carry, and `payload_hash` must be recomputable from the
-- stored bytes by the shared-kernel canonicalization v1 rules.
--
-- SECURITY DEFINER: the guard calls the owner-only canonicalizer, and a
-- permission check on that nested call is evaluated against the role that
-- performed the write. Running the guard as its owner keeps the canonicalizer
-- unreachable for the application role while every insert still re-derives the
-- content address in the database. The function only reads its own NEW row and
-- cannot be invoked directly (trigger functions are trigger-only).
--
-- The comparisons below cast members of `canonical_payload` (hex digests,
-- instants, a boolean), so a malformed payload would otherwise surface as a
-- cast or decode error instead of this guard's stable identity. A preceding
-- CHECK cannot close that: a CHECK cannot express "this text is a parseable
-- timestamptz" without pinning one spelling, and the canonical payload format
-- deliberately does not fix the instant spelling (an offset form is the same
-- instant), so a regex would reject payloads the application may legally
-- produce. The comparison is therefore guarded: a payload-data failure is
-- treated as a mirror mismatch and reported as the single guard error, because
-- the write is rejected either way and the application should only ever see one
-- code for "the stored payload cannot define these columns". Failures that are
-- not properties of the payload (for example a missing guard helper) keep their
-- own code, so a broken deployment stays distinguishable from a bad write.
CREATE FUNCTION task_execution.guard_execution_judgment_mirror() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $guard$
DECLARE
    mirror_mismatch boolean;
BEGIN
    -- The comparison runs in a nested block so a payload that cannot be cast
    -- fails the guard rather than escaping as a cast error; the guard's own
    -- rejection is raised afterwards, outside that block, so the failure this
    -- function reports is always this one statement.
    BEGIN
        mirror_mismatch := (
            NEW.enterprise_id::text
                IS DISTINCT FROM NEW.canonical_payload->'scope'->>'enterpriseId'
            OR NEW.project_id::text
                IS DISTINCT FROM NEW.canonical_payload->'scope'->>'projectId'
            OR NEW.judgment_kind
                IS DISTINCT FROM NEW.canonical_payload->>'judgmentKind'
            OR NEW.task_id::text
                IS DISTINCT FROM NEW.canonical_payload->'taskRef'->>'objectId'
            OR NEW.task_definition_snapshot_id::text
                IS DISTINCT FROM NEW.canonical_payload->'taskDefinitionRef'->>'objectId'
            OR NEW.task_definition_hash
                IS DISTINCT FROM decode(
                       NEW.canonical_payload->'taskDefinitionRef'->'contentHash'->>'digest',
                       'hex')
            OR NEW.policy_version_ref
                IS DISTINCT FROM NEW.canonical_payload->'policyVersionRef'
            OR NEW.policy_content_hash
                IS DISTINCT FROM decode(NEW.canonical_payload->>'policyContentHash', 'hex')
            OR NEW.policy_effective_from
                IS DISTINCT FROM (NEW.canonical_payload->>'policyEffectiveFrom')::timestamptz
            OR NEW.policy_superseded_at
                IS DISTINCT FROM (NEW.canonical_payload->>'policySupersededAt')::timestamptz
            OR NEW.evaluator_ref
                IS DISTINCT FROM NEW.canonical_payload->'evaluatorRef'
            OR NEW.input_hash
                IS DISTINCT FROM decode(NEW.canonical_payload->>'inputHash', 'hex')
            OR NEW.evaluated_at
                IS DISTINCT FROM (NEW.canonical_payload->>'evaluatedAt')::timestamptz
            OR NEW.valid_until
                IS DISTINCT FROM (NEW.canonical_payload->>'validUntil')::timestamptz
            OR NEW.ready
                IS DISTINCT FROM (NEW.canonical_payload->>'ready')::boolean
            OR NEW.payload_hash
                IS DISTINCT FROM sha256(convert_to(
                       task_execution.canonical_jsonb_text(NEW.canonical_payload), 'UTF8')));
    EXCEPTION
        WHEN invalid_text_representation
          OR invalid_datetime_format
          OR datetime_field_overflow
          OR numeric_value_out_of_range
          OR invalid_parameter_value THEN
            -- Includes 22023 raised by `decode` and by the canonicalizer
            -- itself: those are the same class of defect (bytes that cannot
            -- define these columns), and they must not escape under a
            -- different message.
            mirror_mismatch := true;
    END;
    IF mirror_mismatch THEN
        RAISE EXCEPTION 'execution judgment promoted mirror mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_execution_judgment_mirror() FROM PUBLIC;

CREATE TRIGGER execution_judgment_mirror_guard
    BEFORE INSERT OR UPDATE ON task_execution.execution_judgment
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_execution_judgment_mirror();

-- ---------------------------------------------------------------------------
-- Creation identity guard.
-- ---------------------------------------------------------------------------

-- The judgment must be written by the in-flight transaction of the very command
-- it claims: `source_command_id` must name a `command_receipt` row for
-- `execution.build_task_readiness@1.0` whose target is this judgment
-- (`zhiju.execution.task_readiness` / `judgment_id`), whose Project Scope is the
-- judgment's Scope, whose `request_payload_hash` is the judgment's
-- `request_payload_hash`, and whose `outcome` is still `PENDING`. Without this
-- binding a real Receipt could be reused for a judgment it never produced, and
-- a judgment could be retro-fitted after its command was finalized. The
-- judgment payload is the command's *conclusion*, not its request, so only the
-- request hash and the target/Scope identity are required to agree - the
-- payload is deliberately not required to equal the request body.
--
-- `PENDING` on purpose: the owning runner writes the judgment inside the very
-- transaction that claimed the command, so a judgment attached later to an
-- already-finalized (`COMMITTED`/`REJECTED`/`DUPLICATE`) command is a
-- retro-fitted fact rather than this command's output. Every row the runner
-- writes has exactly one such Receipt; a forged one has no Receipt to agree
-- with.
--
-- SECURITY INVOKER on purpose: the Receipt is read under the same RLS policies
-- and trusted Scope the writer itself is subject to, so a Receipt hidden from
-- this writer is indistinguishable from a missing one and the guard fails
-- closed instead of trusting a row the transaction may not see.
CREATE FUNCTION task_execution.guard_execution_judgment_creation_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
DECLARE
    receipt_command_version text;
    receipt_target_type text;
    receipt_target_id uuid;
    receipt_enterprise_id uuid;
    receipt_project_id uuid;
    receipt_request_payload_hash bytea;
    receipt_outcome text;
BEGIN
    SELECT r.command_version, r.target_type, r.target_id,
           r.enterprise_id, r.project_id, r.request_payload_hash, r.outcome
      INTO receipt_command_version, receipt_target_type, receipt_target_id,
           receipt_enterprise_id, receipt_project_id, receipt_request_payload_hash,
           receipt_outcome
      FROM task_execution.command_receipt r
     WHERE r.command_id = NEW.source_command_id
       AND r.command_type = 'execution.build_task_readiness';
    IF NOT FOUND
       OR receipt_command_version IS DISTINCT FROM '1.0'
       OR receipt_target_type IS DISTINCT FROM 'zhiju.execution.task_readiness'
       OR receipt_target_id IS DISTINCT FROM NEW.judgment_id
       OR receipt_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR receipt_project_id IS DISTINCT FROM NEW.project_id
       OR receipt_request_payload_hash IS DISTINCT FROM NEW.request_payload_hash
       OR receipt_outcome IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'execution judgment creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_execution_judgment_creation_identity() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION task_execution.guard_execution_judgment_creation_identity()
    FROM task_execution_app;

CREATE TRIGGER execution_judgment_creation_identity_guard
    BEFORE INSERT ON task_execution.execution_judgment
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_execution_judgment_creation_identity();

-- ---------------------------------------------------------------------------
-- Immutability.
-- ---------------------------------------------------------------------------

-- A committed judgment is history: a stale judgment is superseded by building
-- a new one, never by rewriting the old row, so Scope, subject, Policy and
-- evaluator bindings, `input_hash`, the validity window, the verdict and the
-- payload are all write-once. The BEFORE UPDATE trigger is the in-database half
-- of that rule; the ACL below is the other half.
CREATE FUNCTION task_execution.guard_execution_judgment_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'execution_judgment history is immutable' USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_execution_judgment_immutable() FROM PUBLIC;

CREATE TRIGGER execution_judgment_immutable_guard
    BEFORE UPDATE ON task_execution.execution_judgment
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_execution_judgment_immutable();

-- Immutable fact: no UPDATE/DELETE path for the app role.
REVOKE UPDATE, DELETE ON task_execution.execution_judgment FROM task_execution_app;

-- ---------------------------------------------------------------------------
-- RLS: a judgment is visible only through the exact Project scope of the
-- trusted transaction context (default-deny without a context, FORCE applies to
-- the owner as well). Authorization never relies on the caller not knowing a
-- judgment id.
-- ---------------------------------------------------------------------------

ALTER TABLE task_execution.execution_judgment ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.execution_judgment FORCE ROW LEVEL SECURITY;
CREATE POLICY execution_judgment_select ON task_execution.execution_judgment
    FOR SELECT TO task_execution_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY execution_judgment_insert ON task_execution.execution_judgment
    FOR INSERT TO task_execution_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

RESET ROLE;
