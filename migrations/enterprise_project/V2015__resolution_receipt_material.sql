-- IM-06 (#191): Project-owned canonical Resolution Receipt material.
-- Design authority: Module-Spec-002 IM-06 Source Slice / Resolution Receipt
-- design, PostgreSQL logical model §33, #157/#191 registration metadata.
--
-- One committed CustomerMaterial confirmation Receipt is published as one
-- immutable canonical receipt fact. The canonical payload contains only facts
-- EnterpriseProject itself recorded immutably for that command: the command
-- identity, the exact Project scope and target, the request payload hash, the
-- outcome, the candidate/confirmed version references, the source selections,
-- the confirmation BusinessDecision reference, the Human actor, the exact
-- ActorSnapshot/AuthorizationDecision identities, and the commit instant of
-- the owning receipt. The content address of that payload is the Receipt
-- reference the narrow `project.get_resolution_receipt@1.0` Query accepts; the
-- original command request hash is never used as the Receipt hash.
--
-- The table is INSERT-only for the application role and guarded in SQL: a
-- direct write cannot publish a receipt whose promoted mirrors, scope or
-- content address disagree with its own canonical payload. Historical
-- confirmations are backfilled by this migration only when every canonical
-- field can be recomputed exactly from those same immutable records; anything
-- less stays unavailable instead of guessing from the current root.

SET ROLE enterprise_project_owner;

-- ---------------------------------------------------------------------------
-- resolution_receipt_material: one immutable canonical Receipt per command.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.resolution_receipt_material (
    command_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    command_type text NOT NULL,
    command_version text NOT NULL,
    outcome text NOT NULL,
    target_ref jsonb NOT NULL,
    request_payload_hash bytea NOT NULL,
    candidate_version_ref jsonb NOT NULL,
    confirmed_version_ref jsonb NOT NULL,
    source_material_refs jsonb NOT NULL,
    decision_ref jsonb NOT NULL,
    actor_ref jsonb NOT NULL,
    actor_snapshot_ref jsonb NOT NULL,
    authorization_decision_ref jsonb NOT NULL,
    committed_at timestamptz NOT NULL,
    receipt_payload jsonb NOT NULL,
    receipt_payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    source_command_id uuid NOT NULL,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT resolution_receipt_material_scope_unique
        UNIQUE (enterprise_id, project_id, command_id),
    -- First version boundary: only a committed CustomerMaterial confirmation
    -- is attestable. Any other command stays unavailable.
    CONSTRAINT resolution_receipt_material_command_identity CHECK (
        command_type = 'project.confirm_customer_material'
        AND command_version = '1.0'),
    CONSTRAINT resolution_receipt_material_outcome_closed CHECK (outcome = 'COMMITTED'),
    CONSTRAINT resolution_receipt_material_request_hash_len CHECK (
        octet_length(request_payload_hash) = 32),
    CONSTRAINT resolution_receipt_material_receipt_hash_len CHECK (
        octet_length(receipt_payload_hash) = 32),
    CONSTRAINT resolution_receipt_material_source_refs_nonempty CHECK (
        jsonb_typeof(source_material_refs) = 'array'
        AND jsonb_array_length(source_material_refs) > 0),
    -- The confirmation command is Human-only: the persisted actor is exactly
    -- the Human principal the owning receipt recorded.
    CONSTRAINT resolution_receipt_material_actor_human CHECK (
        actor_ref->>'principalKind' = 'HUMAN'),
    CONSTRAINT resolution_receipt_material_self_command CHECK (source_command_id = command_id),
    CONSTRAINT resolution_receipt_material_text_nonempty CHECK (
        length(command_type) > 0
        AND length(command_version) > 0
        AND length(canonicalization_version) > 0
        AND length(retention_class) > 0)
);

ALTER TABLE enterprise_project.resolution_receipt_material
    ADD CONSTRAINT resolution_receipt_material_project_fk
    FOREIGN KEY (enterprise_id, project_id)
    REFERENCES enterprise_project.project (enterprise_id, project_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX resolution_receipt_material_project_committed_idx
    ON enterprise_project.resolution_receipt_material
        (enterprise_id, project_id, committed_at DESC, command_id);

-- PostgreSQL 18 provides sha256(bytea); this local canonicalizer mirrors the
-- shared-kernel canonicalization v1 rules (NFC-normalized strings, UTF-8 byte
-- order of object keys, safe integers only) without enabling pgcrypto, so the
-- stored Receipt content address can be recomputed from the stored payload
-- inside the database. It is a migration/backfill helper only and is not
-- granted to the application role.
CREATE FUNCTION enterprise_project.canonical_jsonb_text(p_value jsonb)
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
BEGIN
    kind := jsonb_typeof(p_value);
    IF kind = 'object' THEN
        result := '{';
        FOR item IN
            SELECT key, value
              FROM jsonb_each(p_value)
             ORDER BY encode(convert_to(normalize(key, NFC), 'UTF8'), 'hex')
        LOOP
            result := result
                || separator
                || to_jsonb(normalize(item.key, NFC))::text
                || ':'
                || enterprise_project.canonical_jsonb_text(item.value);
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
                || enterprise_project.canonical_jsonb_text(item.value);
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

REVOKE ALL ON FUNCTION enterprise_project.canonical_jsonb_text(jsonb) FROM PUBLIC;
-- V0002 grants EXECUTE on every function its owner creates in this schema to
-- the application role, so revoking PUBLIC is not enough: the canonicalizer is
-- a migration/backfill helper and no application session may call it.
REVOKE EXECUTE ON FUNCTION enterprise_project.canonical_jsonb_text(jsonb)
    FROM enterprise_project_app;

-- The stored payload, its content address and every promoted column must
-- agree, and the content address must be the canonical hash of the stored
-- payload: a Receipt cannot be published under a scope, actor, version or
-- validity fact that its own canonical payload does not carry.
--
-- SECURITY DEFINER: the guard calls the owner-only canonicalizer, and a
-- permission check on that nested call is evaluated against the role that
-- performed the write. Running the guard as its owner keeps the canonicalizer
-- unreachable for the application role while every insert still re-derives the
-- content address in the database. The function only reads its own NEW row and
-- cannot be invoked directly (trigger functions are trigger-only).
CREATE FUNCTION enterprise_project.guard_resolution_receipt_mirror() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $guard$
DECLARE
    committed_text text;
BEGIN
    committed_text := to_char(NEW.committed_at AT TIME ZONE 'UTC',
                              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    IF NEW.receipt_payload->>'commandId' IS DISTINCT FROM NEW.command_id::text
       OR NEW.receipt_payload->>'commandType' IS DISTINCT FROM NEW.command_type
       OR NEW.receipt_payload->>'commandVersion' IS DISTINCT FROM NEW.command_version
       OR NEW.receipt_payload->>'outcome' IS DISTINCT FROM NEW.outcome
       OR NEW.receipt_payload->>'committedAt' IS DISTINCT FROM committed_text
       OR NEW.receipt_payload->'scopeRef'->>'enterpriseId'
          IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.receipt_payload->'scopeRef'->>'projectId'
          IS DISTINCT FROM NEW.project_id::text
       OR NEW.receipt_payload->'targetRef' IS DISTINCT FROM NEW.target_ref
       OR NEW.receipt_payload->'candidateVersionRef'
          IS DISTINCT FROM NEW.candidate_version_ref
       OR NEW.receipt_payload->'confirmedVersionRef'
          IS DISTINCT FROM NEW.confirmed_version_ref
       OR NEW.receipt_payload->'sourceMaterialRefs'
          IS DISTINCT FROM NEW.source_material_refs
       -- The public Result Schema publishes sourceMaterialRefs as a unique
       -- set of exact refs. A Receipt whose own payload repeats an exact ref
       -- could never be returned, so the duplicate is refused at write time
       -- instead of being stored as unreadable history.
       OR (SELECT count(*) - count(DISTINCT exact_ref.value)
             FROM jsonb_array_elements(NEW.source_material_refs) AS exact_ref(value)) <> 0
       OR NEW.receipt_payload->'decisionRef' IS DISTINCT FROM NEW.decision_ref
       OR NEW.receipt_payload->'actorRef' IS DISTINCT FROM NEW.actor_ref
       OR NEW.receipt_payload->'actorSnapshotRef' IS DISTINCT FROM NEW.actor_snapshot_ref
       OR NEW.receipt_payload->'authorizationDecisionRef'
          IS DISTINCT FROM NEW.authorization_decision_ref
       OR NEW.receipt_payload->'requestPayloadHash'->>'digest'
          IS DISTINCT FROM encode(NEW.request_payload_hash, 'hex')
       OR NEW.actor_ref->>'principalId' IS DISTINCT FROM NEW.created_by_principal_id::text
       OR NEW.actor_snapshot_ref->>'objectId'
          IS DISTINCT FROM NEW.created_by_actor_snapshot_id::text
       OR NEW.authorization_decision_ref->>'objectId'
          IS DISTINCT FROM NEW.authorization_decision_id::text
       OR NEW.receipt_payload_hash
          IS DISTINCT FROM sha256(convert_to(
                 enterprise_project.canonical_jsonb_text(NEW.receipt_payload), 'UTF8')) THEN
        RAISE EXCEPTION 'resolution_receipt_material promoted mirror mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_resolution_receipt_mirror() FROM PUBLIC;

CREATE TRIGGER resolution_receipt_material_mirror_guard
    BEFORE INSERT OR UPDATE ON enterprise_project.resolution_receipt_material
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_resolution_receipt_mirror();

-- A committed Receipt material is immutable history.
CREATE FUNCTION enterprise_project.guard_resolution_receipt_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'resolution_receipt_material is immutable'
        USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_resolution_receipt_immutable() FROM PUBLIC;

CREATE TRIGGER resolution_receipt_material_immutable_guard
    BEFORE UPDATE ON enterprise_project.resolution_receipt_material
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_resolution_receipt_immutable();

REVOKE UPDATE, DELETE ON enterprise_project.resolution_receipt_material
    FROM enterprise_project_app;

-- ---------------------------------------------------------------------------
-- Historical material: exact recomputation only.
--
-- The canonical payload of a confirmation that predates this table can be
-- recomputed exactly from the owning immutable records: the committed command
-- receipt, the confirmed CustomerMaterial version it created, and the
-- confirmation BusinessDecision it recorded. A confirmation whose version,
-- decision, actor or decision attribution cannot be recovered that way is not
-- backfilled and stays unavailable; the current root or a later version is
-- never used to guess a historical confirmation.
-- ---------------------------------------------------------------------------

CREATE FUNCTION enterprise_project.backfill_resolution_receipt_material() RETURNS integer
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $fn$
DECLARE
    inserted integer := 0;
BEGIN
    WITH recoverable AS (
        SELECT receipt.command_id,
               receipt.enterprise_id,
               receipt.project_id,
               receipt.command_type,
               receipt.command_version,
               receipt.request_payload_hash,
               receipt.completed_at,
               receipt.created_by_principal_id,
               receipt.actor_snapshot_id,
               receipt.authorization_decision_id,
               version.customer_material_id,
               version.version_id AS confirmed_version_id,
               version.previous_version_id AS candidate_version_id,
               version.source_selections,
               decision.decision_id,
               decision.payload_hash AS decision_payload_hash
          FROM enterprise_project.command_receipt receipt
          JOIN enterprise_project.customer_material_version version
            ON version.source_command_id = receipt.command_id
           AND version.version_status = 'CONFIRMED'
          JOIN enterprise_project.customer_material_decision decision
            ON decision.source_command_id = receipt.command_id
           AND decision.decision_kind = 'CONFIRMED'
           AND decision.version_id = version.version_id
         WHERE receipt.command_type = 'project.confirm_customer_material'
           AND receipt.command_version = '1.0'
           AND receipt.outcome = 'COMMITTED'
           AND receipt.completed_at IS NOT NULL
           AND receipt.project_id IS NOT NULL
           AND version.enterprise_id = receipt.enterprise_id
           AND version.project_id = receipt.project_id
           AND version.customer_material_id = receipt.target_id
           AND version.previous_version_id IS NOT NULL
           AND jsonb_typeof(version.source_selections) = 'array'
           AND jsonb_array_length(version.source_selections) > 0
           AND decision.enterprise_id = receipt.enterprise_id
           AND decision.project_id = receipt.project_id
           AND decision.customer_material_id = receipt.target_id
           AND decision.decided_by_principal_id = receipt.created_by_principal_id
           AND decision.decided_by_actor_snapshot_id = receipt.actor_snapshot_id
           AND decision.authorization_decision_id = receipt.authorization_decision_id
    ), payload AS (
        SELECT recoverable.*,
               jsonb_build_object(
                   'commandId', recoverable.command_id::text,
                   'commandType', recoverable.command_type,
                   'commandVersion', recoverable.command_version,
                   'scopeRef', jsonb_build_object(
                       'enterpriseId', recoverable.enterprise_id::text,
                       'projectId', recoverable.project_id::text),
                   'targetRef', jsonb_build_object(
                       'kind', 'OBJECT',
                       'objectType', 'zhiju.project.customer_material',
                       'objectId', recoverable.customer_material_id::text,
                       'scope', jsonb_build_object(
                           'enterpriseId', recoverable.enterprise_id::text,
                           'projectId', recoverable.project_id::text)),
                   'requestPayloadHash', jsonb_build_object(
                       'algorithm', 'SHA-256',
                       'digest', encode(recoverable.request_payload_hash, 'hex'),
                       'canonicalizationVersion', '1'),
                   'outcome', 'COMMITTED',
                   'candidateVersionRef', jsonb_build_object(
                       'kind', 'VERSIONED',
                       'objectType', 'zhiju.project.customer_material',
                       'objectId', recoverable.customer_material_id::text,
                       'versionId', recoverable.candidate_version_id::text,
                       'scope', jsonb_build_object(
                           'enterpriseId', recoverable.enterprise_id::text,
                           'projectId', recoverable.project_id::text)),
                   'confirmedVersionRef', jsonb_build_object(
                       'kind', 'VERSIONED',
                       'objectType', 'zhiju.project.customer_material',
                       'objectId', recoverable.customer_material_id::text,
                       'versionId', recoverable.confirmed_version_id::text,
                       'scope', jsonb_build_object(
                           'enterpriseId', recoverable.enterprise_id::text,
                           'projectId', recoverable.project_id::text)),
                   'sourceMaterialRefs', (
                       -- Same exact-ref dedupe rule as the live Receipt
                       -- projection and the read path: selections that
                       -- project to the same exact SourceMaterialRef keep
                       -- only their first occurrence, in selection order.
                       SELECT jsonb_agg(exact_ref.ref ORDER BY exact_ref.ordinal)
                         FROM (
                             SELECT DISTINCT ON (
                                        selection.value->'sourceMaterialRef'->>'objectId',
                                        selection.value->'sourceMaterialRef'->'contentHash'->>'digest')
                                    jsonb_build_object(
                                        'kind', 'CONTENT_ADDRESSED',
                                        'objectType', 'zhiju.project.source_material',
                                        'objectId', selection.value->'sourceMaterialRef'->>'objectId',
                                        'scope', jsonb_build_object(
                                            'enterpriseId', recoverable.enterprise_id::text,
                                            'projectId', recoverable.project_id::text),
                                        'contentHash', jsonb_build_object(
                                            'algorithm', 'SHA-256',
                                            'digest',
                                            selection.value->'sourceMaterialRef'->'contentHash'->>'digest',
                                            'canonicalizationVersion', '1')) AS ref,
                                    selection.ordinal
                               FROM jsonb_array_elements(recoverable.source_selections)
                                    WITH ORDINALITY AS selection(value, ordinal)
                              ORDER BY selection.value->'sourceMaterialRef'->>'objectId',
                                       selection.value->'sourceMaterialRef'->'contentHash'->>'digest',
                                       selection.ordinal
                         ) AS exact_ref),
                   'decisionRef', jsonb_build_object(
                       'kind', 'CONTENT_ADDRESSED',
                       'objectType', 'zhiju.project.business_decision',
                       'objectId', recoverable.decision_id::text,
                       'scope', jsonb_build_object(
                           'enterpriseId', recoverable.enterprise_id::text,
                           'projectId', recoverable.project_id::text),
                       'contentHash', jsonb_build_object(
                           'algorithm', 'SHA-256',
                           'digest', encode(recoverable.decision_payload_hash, 'hex'),
                           'canonicalizationVersion', '1')),
                   'actorRef', jsonb_build_object(
                       'principalKind', 'HUMAN',
                       'principalId', recoverable.created_by_principal_id::text),
                   'actorSnapshotRef', jsonb_build_object(
                       'kind', 'OBJECT',
                       'objectType', 'zhiju.identity.actor_snapshot',
                       'objectId', recoverable.actor_snapshot_id::text,
                       'scope', jsonb_build_object(
                           'enterpriseId', recoverable.enterprise_id::text,
                           'projectId', recoverable.project_id::text)),
                   'authorizationDecisionRef', jsonb_build_object(
                       'kind', 'OBJECT',
                       'objectType', 'zhiju.identity.authorization_decision',
                       'objectId', recoverable.authorization_decision_id::text,
                       'scope', jsonb_build_object(
                           'enterpriseId', recoverable.enterprise_id::text,
                           'projectId', recoverable.project_id::text)),
                   'committedAt', to_char(recoverable.completed_at AT TIME ZONE 'UTC',
                                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS receipt_payload
          FROM recoverable
    )
    INSERT INTO enterprise_project.resolution_receipt_material (
        command_id,
        enterprise_id,
        project_id,
        command_type,
        command_version,
        outcome,
        target_ref,
        request_payload_hash,
        candidate_version_ref,
        confirmed_version_ref,
        source_material_refs,
        decision_ref,
        actor_ref,
        actor_snapshot_ref,
        authorization_decision_ref,
        committed_at,
        receipt_payload,
        receipt_payload_hash,
        canonicalization_version,
        created_at,
        created_by_principal_id,
        created_by_actor_snapshot_id,
        authorization_decision_id,
        source_command_id,
        retention_class)
    SELECT payload.command_id,
           payload.enterprise_id,
           payload.project_id,
           payload.command_type,
           payload.command_version,
           'COMMITTED',
           payload.receipt_payload->'targetRef',
           payload.request_payload_hash,
           payload.receipt_payload->'candidateVersionRef',
           payload.receipt_payload->'confirmedVersionRef',
           payload.receipt_payload->'sourceMaterialRefs',
           payload.receipt_payload->'decisionRef',
           payload.receipt_payload->'actorRef',
           payload.receipt_payload->'actorSnapshotRef',
           payload.receipt_payload->'authorizationDecisionRef',
           payload.completed_at,
           payload.receipt_payload,
           sha256(convert_to(
               enterprise_project.canonical_jsonb_text(payload.receipt_payload), 'UTF8')),
           '1',
           now(),
           payload.created_by_principal_id,
           payload.actor_snapshot_id,
           payload.authorization_decision_id,
           payload.command_id,
           'CUSTOMER_RECORD'
      FROM payload
    ON CONFLICT (command_id) DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    RETURN inserted;
END
$fn$;

REVOKE ALL ON FUNCTION enterprise_project.backfill_resolution_receipt_material() FROM PUBLIC;
-- A writing maintenance helper: the V0002 default privileges would let the
-- application role call it directly, bypassing the owning confirmation path.
REVOKE EXECUTE ON FUNCTION enterprise_project.backfill_resolution_receipt_material()
    FROM enterprise_project_app;

-- Runs before RLS is enforced so the owning role can recompute history; the
-- function stays available for an exact, idempotent re-run.
SELECT enterprise_project.backfill_resolution_receipt_material();

-- ---------------------------------------------------------------------------
-- Grants and Project RLS. A Receipt material is only reachable inside an
-- explicitly established Project context; an Enterprise-only context cannot
-- read it and no Project can enumerate another Project's receipts.
-- ---------------------------------------------------------------------------

ALTER TABLE enterprise_project.resolution_receipt_material ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.resolution_receipt_material FORCE ROW LEVEL SECURITY;
CREATE POLICY resolution_receipt_material_select
    ON enterprise_project.resolution_receipt_material
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY resolution_receipt_material_insert
    ON enterprise_project.resolution_receipt_material
    FOR INSERT TO enterprise_project_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

RESET ROLE;
