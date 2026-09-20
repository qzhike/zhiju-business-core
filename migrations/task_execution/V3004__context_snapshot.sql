-- IM-06 (#216): TaskExecution-owned initial Context Snapshot facts.
-- Design authority: Module-Spec-003 §19.6 (R-214-6, approved #214 design),
-- Module-Spec-003 §19.1/§19.2/§19.4/§19.5 and the PostgreSQL logical model
-- §33 (#214 increment). The import-only legacy compatibility store at the end
-- of this file follows PostgreSQL logical model §35 and Module-Spec-003 §20.1
-- (PR #217 independent implementation review, finding 1).
--
-- One successful `execution.build_initial_context_snapshot@1.1` commits one
-- immutable `context_snapshot` row (the ProjectContext v1.0 Contract Record of
-- §8.1/§8.2) and one immutable `context_snapshot_build` INITIAL metadata row in
-- the same owning transaction. The same transaction's Receipt completion,
-- Audit, the DRAFT->Snapshot / Snapshot->Policy / Snapshot->Slice Reference
-- Edges and the single registered `execution.ContextSnapshotBuilt@1.0` Outbox
-- row are written by the owning runner into the existing V3000 tables; this
-- migration adds the two fact tables plus the legacy compatibility store.
-- `build_initial_context_snapshot@1.0`
-- has no satisfiable input and no owning writer (§19.1), and the closed
-- `builder_version`/`build_kind` CHECKs plus the Receipt binding below give it
-- no row it could ever produce.
--
-- Mirrors and content address: every promoted column of both tables is
-- re-derived in SQL from the stored canonical payload, so a direct write cannot
-- publish a fact whose mirrors or content address disagree with its own bytes.
-- `payload_hash` is
-- `sha256(convert_to(task_execution.canonical_jsonb_text(canonical_payload),
-- 'UTF8'))`, reusing the owner-only canonicalization-v1 helper V3001 created
-- (PostgreSQL 18 provides `sha256(bytea)`; pgcrypto stays disabled).
--
-- Promoted columns without a payload counterpart: the ProjectContext v1.0
-- payload carries no member for the CREATE object identity, the build command
-- version or the hash framing, so `object_id` is bound by the creation-identity
-- guard to the Receipt target (and adjudicated per Project Scope by the UNIQUE
-- constraint), `builder_version` is closed to `'1.1'` by CHECK and bound to the
-- Receipt's `command_version`, and `canonicalization_version`/
-- `payload_hash_algorithm` are closed by CHECK.
--
-- Two derivations the authorities fix the column set for but not the SQL
-- expression, pinned here so the mirror guard can recompute them:
--   * `source_manifest_count` counts every reference entry the Core v1.0
--     `sourceManifest` carries: each present singleton ref member
--     (`enterpriseProfileSnapshotRef`, `qmsConfigurationRef` and the five
--     optional baseline/profile/plan refs) counts one, and each of
--     `policyRefs`/`schemaRefs`/`externalAuthoritySnapshotRefs` contributes its
--     array length. The member set is closed (`additionalProperties:false`), so
--     this total is well-defined.
--   * `expires_at` and `effective_expires_at` both mirror the payload's single
--     `expiresAt` member, because §19.4 item 5 defines `expiresAt :=
--     effectiveExpiresAt`: the payload member IS the effective expiry (#168),
--     so the two columns can never diverge, and a missing member agrees with
--     two NULL columns while a JSON null can never carry a value (the request
--     Envelope rejects JSON null expiry, and member presence is pinned by the
--     Receipt's request hash).
--
-- The build metadata payload (`context_snapshot_build.canonical_payload`) is a
-- TaskExecution-internal shape no Core contract fixes; its member spellings are
-- defined by this migration: `buildKind`, `draftSnapshotRef`, `sliceRefs`,
-- `purpose`, `audience` (full PrincipalRef), `builderPolicyRef` (VersionedRef),
-- `policyContentHash` (64-hex), `policyEffectiveFrom`, optional
-- `policySupersededAt`, optional `requestExpiresAt`, optional
-- `effectiveExpiresAt`, `inputRefObservations` (sorted by the §19.4 item 9
-- total canonical comparator; ordering is proven by the assembly layer, not
-- re-checked in SQL) and `scopeRef` (`{enterpriseId, projectId}`). An INITIAL
-- payload never carries `frozenContractRef`: the NULL column corresponds to
-- the absent member, and a JSON null member disagrees with it (§33: the two
-- refs must never be both present or both absent; INITIAL fixes the second
-- branch by construction).
--
-- Ownership closure (§19.6 item 2): the trusted anchor is the V0004 platform
-- transaction context, not the Receipt's caller-writable creator column. Both
-- INSERT policies bind `created_by_principal_id` to
-- `platform_security.context_principal_id()`, and both creation-identity guards
-- additionally require a non-NULL `context_principal_kind()` (a legacy
-- 10-parameter context can never commit these facts) and the Receipt creator
-- equal to the context principal.
--
-- RLS follows the V3000-V3003 conventions: FORCE, Project-scoped rows call
-- `context_allows_project(enterprise_id, project_id)`, so a snapshot can never
-- leak through an Enterprise-only or foreign-Project Context. No cross-Schema
-- FK/join is created and no other Schema's data is copied; Slice and Policy
-- identities stay cross-module TypedRefs closed through `reference_edge` rows
-- written by the owning runner.

SET ROLE task_execution_owner;

-- ---------------------------------------------------------------------------
-- task_execution.context_snapshot: the immutable initial Context Snapshot of
-- one CREATE target. `snapshot_id` is generated by the application (UuidV7) and
-- is independent of any aggregate CAS version; `object_id` is the validated
-- CREATE `targetRef.objectId`, and the Project-scoped UNIQUE constraint is what
-- adjudicates a duplicate CREATE identity inside one Project Scope (mapped to
-- a stable business outcome, never leaking `23505`).
-- ---------------------------------------------------------------------------

CREATE TABLE task_execution.context_snapshot (
    snapshot_id uuid PRIMARY KEY,
    object_id uuid NOT NULL,
    purpose text NOT NULL,
    audience text NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    builder_version text NOT NULL,
    policy_snapshot_id uuid NOT NULL,
    source_manifest_count integer NOT NULL,
    context_item_count integer NOT NULL,
    omission_count integer NOT NULL,
    redaction_count integer NOT NULL,
    coverage_state text NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    payload_hash_algorithm text NOT NULL,
    expires_at timestamptz,
    effective_expires_at timestamptz,
    request_payload_hash bytea NOT NULL,
    source_command_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    canonical_payload jsonb NOT NULL,
    -- Only the @1.1 build has an owning producer (§19.1): the @1.0 build is
    -- registered but frozen, so no snapshot may be labelled with it. Widening
    -- this set must be a forward migration delivered together with the
    -- producing command of that version.
    CONSTRAINT context_snapshot_builder_version_closed CHECK (builder_version = '1.1'),
    CONSTRAINT context_snapshot_counts_nonnegative CHECK (
        source_manifest_count >= 0
        AND context_item_count >= 0
        AND omission_count >= 0
        AND redaction_count >= 0),
    -- Both content addresses are SHA-256: a row with a short or absent digest
    -- could claim an identity the application cannot recompute.
    CONSTRAINT context_snapshot_hash_len CHECK (
        octet_length(payload_hash) = 32
        AND octet_length(request_payload_hash) = 32),
    CONSTRAINT context_snapshot_canonicalization_version_closed CHECK (
        canonicalization_version = '1'),
    CONSTRAINT context_snapshot_hash_algorithm_closed CHECK (
        payload_hash_algorithm = 'SHA-256'),
    -- The payload is the full ProjectContext v1.0 body, and the mirror guard
    -- below re-derives every promoted column from it. This constraint closes
    -- the cheap structural half of that contract so a payload whose members
    -- are not even of the right JSON kind is refused before any comparison
    -- runs. Every comparison is `IS NOT DISTINCT FROM`: a plain `=` against a
    -- missing JSON member yields NULL, and SQL would let a NULL CHECK pass.
    CONSTRAINT context_snapshot_payload_shape CHECK (
        jsonb_typeof(canonical_payload) IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'projection') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'projection'->'builderPolicyRef')
                IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'sourceManifest') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'enterpriseRef') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'projectRef') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'contextItems') IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'omissions') IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'redactions') IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'coverage') IS NOT DISTINCT FROM 'object'),
    CONSTRAINT context_snapshot_scope_unique UNIQUE (enterprise_id, project_id, object_id)
);

-- ---------------------------------------------------------------------------
-- task_execution.context_snapshot_build: the immutable build metadata of one
-- committed Snapshot. This slice writes INITIAL success rows only: `build_kind`
-- is closed to 'INITIAL', `draft_snapshot_ref` is the requested
-- CONTENT_ADDRESSED ref of the exact `work_order_draft_snapshot` the build
-- consumed, and `frozen_contract_ref` must be NULL (the FROZEN branch belongs
-- to a future freeze slice, never to this table's rows). A failed build leaves
-- no metadata row; its Receipt is finalized REJECTED in the same transaction
-- (§19.6 item 3).
-- ---------------------------------------------------------------------------

CREATE TABLE task_execution.context_snapshot_build (
    snapshot_id uuid PRIMARY KEY
        REFERENCES task_execution.context_snapshot (snapshot_id) ON DELETE RESTRICT,
    build_kind text NOT NULL,
    draft_snapshot_ref jsonb NOT NULL,
    frozen_contract_ref jsonb,
    slice_refs jsonb NOT NULL,
    purpose text NOT NULL,
    audience jsonb NOT NULL,
    builder_policy_ref jsonb NOT NULL,
    policy_content_hash bytea NOT NULL,
    policy_effective_from timestamptz NOT NULL,
    policy_superseded_at timestamptz,
    request_expires_at timestamptz,
    effective_expires_at timestamptz,
    canonical_payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    request_payload_hash bytea NOT NULL,
    source_command_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    -- §33: INITIAL carries exactly one of the two source refs. The FROZEN
    -- branch has no owning producer in this slice, so the column is pinned
    -- NULL; widening it is a deliberate future migration, not a runtime
    -- decision.
    CONSTRAINT context_snapshot_build_kind_closed CHECK (build_kind = 'INITIAL'),
    CONSTRAINT context_snapshot_build_frozen_contract_absent CHECK (
        frozen_contract_ref IS NULL),
    CONSTRAINT context_snapshot_build_hash_len CHECK (
        octet_length(policy_content_hash) = 32
        AND octet_length(payload_hash) = 32
        AND octet_length(request_payload_hash) = 32),
    -- The request's `sourceSlices` set is nonEmpty (registered Envelope), so a
    -- committed build can never name zero slices. The CASE keeps a non-array
    -- value a plain CHECK violation instead of a `jsonb_array_length` error.
    CONSTRAINT context_snapshot_build_slice_refs_nonempty CHECK (
        CASE WHEN jsonb_typeof(slice_refs) = 'array'
             THEN jsonb_array_length(slice_refs) >= 1
             ELSE false
        END),
    CONSTRAINT context_snapshot_build_ref_shape CHECK (
        jsonb_typeof(draft_snapshot_ref) IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(audience) IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(builder_policy_ref) IS NOT DISTINCT FROM 'object'),
    CONSTRAINT context_snapshot_build_payload_shape CHECK (
        jsonb_typeof(canonical_payload) IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'draftSnapshotRef') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'sliceRefs') IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'audience') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'builderPolicyRef') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'inputRefObservations')
                IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'scopeRef') IS NOT DISTINCT FROM 'object')
);

-- ---------------------------------------------------------------------------
-- Payload mirror guards.
-- ---------------------------------------------------------------------------

-- The promoted columns and the stored content address must agree with the
-- canonical payload: a snapshot cannot be published under a Scope, policy
-- version, coverage state, expiry or hash that its own payload does not carry,
-- and `payload_hash` must be recomputable from the stored bytes by the
-- shared-kernel canonicalization v1 rules. `snapshot_id` mirrors the payload's
-- `contextSnapshotId`; `policy_snapshot_id` mirrors
-- `projection.builderPolicyRef.versionId`; `coverage_state` mirrors
-- `coverage.completeness`; `audience` mirrors the encoded
-- `projection.audience` string (matching against Slices happens on the full
-- PrincipalRef, never on this encoding, §19.4 item 4).
--
-- SECURITY DEFINER: the guard calls the owner-only canonicalizer, and a
-- permission check on that nested call is evaluated against the role that
-- performed the write. Running the guard as its owner keeps the canonicalizer
-- unreachable for the application role while every insert still re-derives the
-- content address in the database. The function only reads its own NEW row and
-- cannot be invoked directly (trigger functions are trigger-only).
--
-- The comparisons below cast a member of `canonical_payload` (the `expiresAt`
-- instant) and take array lengths of members, so a malformed payload would
-- otherwise surface as a cast/length error instead of this guard's stable
-- identity. A preceding CHECK cannot close that: a CHECK cannot express "this
-- text is a parseable timestamptz" without pinning one spelling, and the
-- canonical payload format deliberately does not fix the instant spelling (an
-- offset form is the same instant), so a regex would reject payloads the
-- application may legally produce. The comparison is therefore guarded: a
-- payload-data failure is treated as a mirror mismatch and reported as the
-- single guard error, because the write is rejected either way and the
-- application should only ever see one code for "the stored payload cannot
-- define these columns". Failures that are not properties of the payload (for
-- example a missing guard helper) keep their own code, so a broken deployment
-- stays distinguishable from a bad write.
CREATE FUNCTION task_execution.guard_context_snapshot_mirror() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $guard$
DECLARE
    mirror_mismatch boolean;
BEGIN
    -- The comparison runs in a nested block so a payload that cannot be cast
    -- or measured fails the guard rather than escaping as a cast error; the
    -- guard's own rejection is raised afterwards, outside that block, so the
    -- failure this function reports is always this one statement.
    BEGIN
        mirror_mismatch := (
            NEW.snapshot_id::text
                IS DISTINCT FROM NEW.canonical_payload->>'contextSnapshotId'
            OR NEW.purpose
                IS DISTINCT FROM NEW.canonical_payload->'projection'->>'purpose'
            OR NEW.audience
                IS DISTINCT FROM NEW.canonical_payload->'projection'->>'audience'
            OR NEW.enterprise_id::text
                IS DISTINCT FROM NEW.canonical_payload->'enterpriseRef'->>'objectId'
            OR NEW.project_id::text
                IS DISTINCT FROM NEW.canonical_payload->'projectRef'->>'objectId'
            OR NEW.enterprise_id::text
                IS DISTINCT FROM NEW.canonical_payload->'projectRef'->'scope'->>'enterpriseId'
            OR NEW.project_id::text
                IS DISTINCT FROM NEW.canonical_payload->'projectRef'->'scope'->>'projectId'
            OR NEW.policy_snapshot_id::text
                IS DISTINCT FROM
                   NEW.canonical_payload->'projection'->'builderPolicyRef'->>'versionId'
            -- See the header for this derivation: every reference entry the
            -- closed Core v1.0 `sourceManifest` member set can carry.
            OR NEW.source_manifest_count IS DISTINCT FROM (
                   (CASE WHEN (NEW.canonical_payload->'sourceManifest')
                             ? 'enterpriseProfileSnapshotRef' THEN 1 ELSE 0 END)
                 + (CASE WHEN (NEW.canonical_payload->'sourceManifest')
                             ? 'qmsConfigurationRef' THEN 1 ELSE 0 END)
                 + (CASE WHEN (NEW.canonical_payload->'sourceManifest')
                             ? 'customerBaselineRef' THEN 1 ELSE 0 END)
                 + (CASE WHEN (NEW.canonical_payload->'sourceManifest')
                             ? 'templateBaselineRef' THEN 1 ELSE 0 END)
                 + (CASE WHEN (NEW.canonical_payload->'sourceManifest')
                             ? 'regulatoryProfileRef' THEN 1 ELSE 0 END)
                 + (CASE WHEN (NEW.canonical_payload->'sourceManifest')
                             ? 'gapAnalysisRef' THEN 1 ELSE 0 END)
                 + (CASE WHEN (NEW.canonical_payload->'sourceManifest')
                             ? 'deliveryPlanRef' THEN 1 ELSE 0 END)
                 + COALESCE(jsonb_array_length(
                       NEW.canonical_payload->'sourceManifest'->'policyRefs'), 0)
                 + COALESCE(jsonb_array_length(
                       NEW.canonical_payload->'sourceManifest'->'schemaRefs'), 0)
                 + COALESCE(jsonb_array_length(
                       NEW.canonical_payload->'sourceManifest'->'externalAuthoritySnapshotRefs'),
                       0))
            OR NEW.context_item_count
                IS DISTINCT FROM jsonb_array_length(NEW.canonical_payload->'contextItems')
            OR NEW.omission_count
                IS DISTINCT FROM jsonb_array_length(NEW.canonical_payload->'omissions')
            OR NEW.redaction_count
                IS DISTINCT FROM jsonb_array_length(NEW.canonical_payload->'redactions')
            OR NEW.coverage_state
                IS DISTINCT FROM NEW.canonical_payload->'coverage'->>'completeness'
            OR NEW.expires_at
                IS DISTINCT FROM (NEW.canonical_payload->>'expiresAt')::timestamptz
            OR NEW.effective_expires_at
                IS DISTINCT FROM (NEW.canonical_payload->>'expiresAt')::timestamptz
            OR NEW.payload_hash
                IS DISTINCT FROM sha256(convert_to(
                       task_execution.canonical_jsonb_text(NEW.canonical_payload), 'UTF8')));
    EXCEPTION
        WHEN invalid_text_representation
          OR invalid_datetime_format
          OR datetime_field_overflow
          OR numeric_value_out_of_range
          OR invalid_parameter_value THEN
            -- Includes 22023 raised by the canonicalizer itself: that is the
            -- same class of defect (bytes that cannot define these columns),
            -- and it must not escape under a different message.
            mirror_mismatch := true;
    END;
    IF mirror_mismatch THEN
        RAISE EXCEPTION 'context snapshot promoted mirror mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_context_snapshot_mirror() FROM PUBLIC;

CREATE TRIGGER context_snapshot_mirror_guard
    BEFORE INSERT OR UPDATE ON task_execution.context_snapshot
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_context_snapshot_mirror();

-- The build metadata's promoted columns must agree with its canonical payload
-- the same way: the DRAFT source ref, the slice set, the purpose, the full
-- audience PrincipalRef, the Builder Policy observation (ref, content hash,
-- validity window), both expiry observations and the Project Scope are
-- re-derived from the stored bytes, and `payload_hash` must recompute under
-- canonicalization v1. A JSON null `frozenContractRef` member disagrees with
-- the pinned NULL column, so only genuine member absence represents "no frozen
-- contract" (the same null-safe presence semantics as the draft expiry in
-- V3003).
--
-- SECURITY DEFINER for the same reason as the snapshot mirror guard: the
-- canonicalizer is owner-only, and the guard runs it as its owner so the
-- application role can never call it.
CREATE FUNCTION task_execution.guard_context_snapshot_build_mirror() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $guard$
DECLARE
    mirror_mismatch boolean;
BEGIN
    BEGIN
        mirror_mismatch := (
            NEW.build_kind
                IS DISTINCT FROM NEW.canonical_payload->>'buildKind'
            OR NEW.draft_snapshot_ref
                IS DISTINCT FROM NEW.canonical_payload->'draftSnapshotRef'
            OR NEW.frozen_contract_ref
                IS DISTINCT FROM NEW.canonical_payload->'frozenContractRef'
            OR NEW.slice_refs
                IS DISTINCT FROM NEW.canonical_payload->'sliceRefs'
            OR NEW.purpose
                IS DISTINCT FROM NEW.canonical_payload->>'purpose'
            OR NEW.audience
                IS DISTINCT FROM NEW.canonical_payload->'audience'
            OR NEW.builder_policy_ref
                IS DISTINCT FROM NEW.canonical_payload->'builderPolicyRef'
            OR NEW.policy_content_hash
                IS DISTINCT FROM decode(NEW.canonical_payload->>'policyContentHash', 'hex')
            OR NEW.policy_effective_from
                IS DISTINCT FROM (NEW.canonical_payload->>'policyEffectiveFrom')::timestamptz
            OR NEW.policy_superseded_at
                IS DISTINCT FROM (NEW.canonical_payload->>'policySupersededAt')::timestamptz
            OR NEW.request_expires_at
                IS DISTINCT FROM (NEW.canonical_payload->>'requestExpiresAt')::timestamptz
            OR NEW.effective_expires_at
                IS DISTINCT FROM (NEW.canonical_payload->>'effectiveExpiresAt')::timestamptz
            OR NEW.enterprise_id::text
                IS DISTINCT FROM NEW.canonical_payload->'scopeRef'->>'enterpriseId'
            OR NEW.project_id::text
                IS DISTINCT FROM NEW.canonical_payload->'scopeRef'->>'projectId'
            OR NEW.payload_hash
                IS DISTINCT FROM sha256(convert_to(
                       task_execution.canonical_jsonb_text(NEW.canonical_payload), 'UTF8')));
    EXCEPTION
        WHEN invalid_text_representation
          OR invalid_datetime_format
          OR datetime_field_overflow
          OR numeric_value_out_of_range
          OR invalid_parameter_value THEN
            mirror_mismatch := true;
    END;
    IF mirror_mismatch THEN
        RAISE EXCEPTION 'context snapshot build promoted mirror mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_context_snapshot_build_mirror() FROM PUBLIC;

CREATE TRIGGER context_snapshot_build_mirror_guard
    BEFORE INSERT OR UPDATE ON task_execution.context_snapshot_build
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_context_snapshot_build_mirror();

-- ---------------------------------------------------------------------------
-- Creation identity guards.
-- ---------------------------------------------------------------------------

-- The snapshot must be written by the in-flight transaction of the very
-- command it claims: `source_command_id` must name a `command_receipt` row for
-- `execution.build_initial_context_snapshot` that is still `PENDING`, whose
-- `command_version` is `'1.1'` and equals the promoted `builder_version`, whose
-- `target_type` is the canonical `zhiju.execution.context_snapshot` (the legacy
-- `zhiju.project.context_snapshot` is a historical read-back identity this
-- entry never produces, §19.2), whose `target_id` is this row's `object_id`,
-- whose Project Scope is this row's Scope, and whose `request_payload_hash`
-- equals this row's `request_payload_hash`. The snapshot payload is the
-- command's *conclusion* (the assembled ProjectContext), not its request, so -
-- exactly as V3002 treats the judgment - only the request hash and the
-- target/Scope identity are bound; the payload is deliberately not required to
-- equal the request body.
--
-- Ownership closure: the trusted anchor is the V0004 transaction context. A
-- NULL principal kind (legacy 10-parameter context) rejects, and both the
-- row's and the Receipt's creator columns must equal the context principal id.
--
-- SECURITY INVOKER on purpose: the Receipt is read under the same RLS policies
-- and trusted Scope the writer itself is subject to, so a hidden receipt is
-- indistinguishable from a missing one and the guard fails closed instead of
-- trusting a row the transaction may not see.
CREATE FUNCTION task_execution.guard_context_snapshot_creation_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
DECLARE
    receipt_found boolean;
    receipt_command_version text;
    receipt_target_type text;
    receipt_target_id uuid;
    receipt_enterprise_id uuid;
    receipt_project_id uuid;
    receipt_request_payload_hash bytea;
    receipt_outcome text;
    receipt_created_by_principal_id uuid;
    context_principal_id uuid;
    context_principal_kind text;
BEGIN
    SELECT r.command_version, r.target_type, r.target_id, r.enterprise_id,
           r.project_id, r.request_payload_hash, r.outcome,
           r.created_by_principal_id
      INTO receipt_command_version, receipt_target_type, receipt_target_id,
           receipt_enterprise_id, receipt_project_id,
           receipt_request_payload_hash, receipt_outcome,
           receipt_created_by_principal_id
      FROM task_execution.command_receipt r
     WHERE r.command_id = NEW.source_command_id
       AND r.command_type = 'execution.build_initial_context_snapshot';
    receipt_found := FOUND;

    context_principal_id := platform_security.context_principal_id();
    context_principal_kind := platform_security.context_principal_kind();

    -- Source Receipt identity, its Project Scope and the request hash binding.
    IF NOT receipt_found
       OR receipt_outcome IS DISTINCT FROM 'PENDING'
       OR receipt_command_version IS DISTINCT FROM '1.1'
       OR NEW.builder_version IS DISTINCT FROM receipt_command_version
       OR receipt_target_type IS DISTINCT FROM 'zhiju.execution.context_snapshot'
       OR receipt_target_id IS DISTINCT FROM NEW.object_id
       OR receipt_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR receipt_project_id IS DISTINCT FROM NEW.project_id
       OR receipt_request_payload_hash IS DISTINCT FROM NEW.request_payload_hash THEN
        RAISE EXCEPTION 'context snapshot creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;

    -- Ownership closure: the context principal id *and* kind are the only
    -- trusted anchor, and a NULL kind (legacy context) can never commit a
    -- Context Snapshot.
    IF context_principal_kind IS NULL
       OR NEW.created_by_principal_id IS DISTINCT FROM context_principal_id
       OR receipt_created_by_principal_id IS DISTINCT FROM context_principal_id THEN
        RAISE EXCEPTION 'context snapshot creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_context_snapshot_creation_identity() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION task_execution.guard_context_snapshot_creation_identity()
    FROM task_execution_app;

CREATE TRIGGER context_snapshot_creation_identity_guard
    BEFORE INSERT ON task_execution.context_snapshot
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_context_snapshot_creation_identity();

-- The build metadata row shares its Snapshot's creation command: it must be
-- written by the same in-flight `execution.build_initial_context_snapshot@1.1`
-- transaction (same PENDING Receipt, same request hash, same Scope), its
-- `snapshot_id` must resolve to the committed Snapshot of that very command
-- (same `source_command_id`, request hash, Scope, purpose and effective expiry,
-- and the Snapshot payload's `projection.builderPolicyRef` equal to this row's
-- `builder_policy_ref`, §19.6 item 3), and its `draft_snapshot_ref` must close
-- to the exact immutable `work_order_draft_snapshot` the build consumed:
-- kind/objectType/Scope on the ref itself, `contentHash.digest` equal to the
-- snapshot row's `payload_hash`, `draft_schema_version = '1.1'`, the owning
-- WorkOrder carrying the canonical `zhiju.execution.work_order` spelling in
-- the same Project Scope, and the Root's current draft pointer resolving to
-- that same `(snapshot_id, payload_hash)` pair (§19.1 item 1). Without the
-- pointer closure a superseded draft could still be cited as the source of a
-- new Snapshot, and without the hash closure a merely present snapshot row
-- would satisfy the ref.
--
-- The WorkOrder's mutable lifecycle status is deliberately not part of this
-- closure: the committed metadata records which draft fact the build consumed,
-- and `status='DRAFT'` at build time is revalidated by the owning Builder
-- under the dependency row lock (§19.8), not by rewriting history here.
--
-- SECURITY INVOKER on purpose: the Receipt, the Snapshot, the draft snapshot
-- and the WorkOrder Root are read under the same RLS policies and trusted
-- Scope the writer itself is subject to, so a hidden row is indistinguishable
-- from a missing one and the guard fails closed.
CREATE FUNCTION task_execution.guard_context_snapshot_build_creation_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
DECLARE
    receipt_found boolean;
    receipt_command_version text;
    receipt_target_type text;
    receipt_target_id uuid;
    receipt_enterprise_id uuid;
    receipt_project_id uuid;
    receipt_request_payload_hash bytea;
    receipt_outcome text;
    receipt_created_by_principal_id uuid;
    snapshot_found boolean;
    snapshot_object_id uuid;
    snapshot_enterprise_id uuid;
    snapshot_project_id uuid;
    snapshot_purpose text;
    snapshot_effective_expires_at timestamptz;
    snapshot_request_payload_hash bytea;
    snapshot_source_command_id uuid;
    snapshot_builder_policy_ref jsonb;
    draft_ref_object_id uuid;
    draft_ref_content_hash bytea;
    draft_ref_readable boolean := true;
    draft_found boolean := false;
    draft_snapshot_id uuid;
    draft_payload_hash bytea;
    draft_row_schema_version text;
    draft_enterprise_id uuid;
    draft_project_id uuid;
    root_object_type text;
    root_enterprise_id uuid;
    root_project_id uuid;
    root_current_draft_snapshot_id uuid;
    root_current_draft_snapshot_hash bytea;
    context_principal_id uuid;
    context_principal_kind text;
BEGIN
    SELECT r.command_version, r.target_type, r.target_id, r.enterprise_id,
           r.project_id, r.request_payload_hash, r.outcome,
           r.created_by_principal_id
      INTO receipt_command_version, receipt_target_type, receipt_target_id,
           receipt_enterprise_id, receipt_project_id,
           receipt_request_payload_hash, receipt_outcome,
           receipt_created_by_principal_id
      FROM task_execution.command_receipt r
     WHERE r.command_id = NEW.source_command_id
       AND r.command_type = 'execution.build_initial_context_snapshot';
    receipt_found := FOUND;

    -- The Snapshot is inserted first and this metadata row second (the FK is
    -- immediate), so the fact this metadata belongs to is readable here under
    -- the writer's own RLS Scope.
    SELECT s.object_id, s.enterprise_id, s.project_id, s.purpose,
           s.effective_expires_at, s.request_payload_hash, s.source_command_id,
           s.canonical_payload->'projection'->'builderPolicyRef'
      INTO snapshot_object_id, snapshot_enterprise_id, snapshot_project_id,
           snapshot_purpose, snapshot_effective_expires_at,
           snapshot_request_payload_hash, snapshot_source_command_id,
           snapshot_builder_policy_ref
      FROM task_execution.context_snapshot s
     WHERE s.snapshot_id = NEW.snapshot_id;
    snapshot_found := FOUND;

    -- The ref members are cast in a nested block for the same reason as in the
    -- mirror guards: a ref that cannot define an identity must fail this guard
    -- rather than escape as a cast/decode error.
    BEGIN
        draft_ref_object_id := (NEW.draft_snapshot_ref->>'objectId')::uuid;
        draft_ref_content_hash :=
            decode(NEW.draft_snapshot_ref->'contentHash'->>'digest', 'hex');
    EXCEPTION
        WHEN invalid_text_representation
          OR invalid_datetime_format
          OR datetime_field_overflow
          OR numeric_value_out_of_range
          OR invalid_parameter_value THEN
            draft_ref_readable := false;
    END;

    -- The bound draft and its owning Root: joined on the Root so the WorkOrder
    -- spelling and the current draft pointer are checked against the same row
    -- pair the draft belongs to (the V3003 composite pointer makes
    -- `(work_order_id, snapshot_id, payload_hash)` one fact).
    IF draft_ref_readable THEN
        SELECT s.snapshot_id, s.payload_hash, s.draft_schema_version,
               s.enterprise_id, s.project_id,
               w.work_order_object_type, w.enterprise_id, w.project_id,
               w.current_draft_snapshot_id, w.current_draft_snapshot_hash
          INTO draft_snapshot_id, draft_payload_hash, draft_row_schema_version,
               draft_enterprise_id, draft_project_id,
               root_object_type, root_enterprise_id, root_project_id,
               root_current_draft_snapshot_id, root_current_draft_snapshot_hash
          FROM task_execution.work_order_draft_snapshot s
          JOIN task_execution.work_order w
            ON w.work_order_id = s.work_order_id
         WHERE s.snapshot_id = draft_ref_object_id;
        draft_found := FOUND;
    END IF;

    context_principal_id := platform_security.context_principal_id();
    context_principal_kind := platform_security.context_principal_kind();

    -- Source Receipt identity, its Project Scope and the request hash binding
    -- (same PENDING in-flight command as the Snapshot's guard).
    IF NOT receipt_found
       OR receipt_outcome IS DISTINCT FROM 'PENDING'
       OR receipt_command_version IS DISTINCT FROM '1.1'
       OR receipt_target_type IS DISTINCT FROM 'zhiju.execution.context_snapshot'
       OR receipt_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR receipt_project_id IS DISTINCT FROM NEW.project_id
       OR receipt_request_payload_hash IS DISTINCT FROM NEW.request_payload_hash THEN
        RAISE EXCEPTION 'context snapshot build creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;

    -- Snapshot closure: this metadata belongs to the Snapshot of the same
    -- command, same Scope, same purpose, same effective expiry and the same
    -- Builder Policy ref the Snapshot payload's projection carries, and the
    -- Receipt's CREATE target is that Snapshot's object identity.
    IF NOT snapshot_found
       OR snapshot_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR snapshot_project_id IS DISTINCT FROM NEW.project_id
       OR snapshot_source_command_id IS DISTINCT FROM NEW.source_command_id
       OR snapshot_request_payload_hash IS DISTINCT FROM NEW.request_payload_hash
       OR snapshot_object_id IS DISTINCT FROM receipt_target_id
       OR snapshot_purpose IS DISTINCT FROM NEW.purpose
       OR snapshot_effective_expires_at IS DISTINCT FROM NEW.effective_expires_at
       OR snapshot_builder_policy_ref IS DISTINCT FROM NEW.builder_policy_ref THEN
        RAISE EXCEPTION 'context snapshot build creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;

    -- DRAFT closure: the ref, the immutable draft snapshot row and the owning
    -- WorkOrder Root are one fact, on the @1.1 creation major and the
    -- canonical WorkOrder spelling, in this row's Project Scope, with the
    -- Root's current pointer resolving to the referenced snapshot and hash.
    IF NOT draft_ref_readable
       OR NOT draft_found
       OR NEW.draft_snapshot_ref->>'kind' IS DISTINCT FROM 'CONTENT_ADDRESSED'
       OR NEW.draft_snapshot_ref->>'objectType'
              IS DISTINCT FROM 'zhiju.execution.work_order_draft_snapshot'
       OR NEW.draft_snapshot_ref->'scope'->>'enterpriseId'
              IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.draft_snapshot_ref->'scope'->>'projectId'
              IS DISTINCT FROM NEW.project_id::text
       OR draft_payload_hash IS DISTINCT FROM draft_ref_content_hash
       OR draft_row_schema_version IS DISTINCT FROM '1.1'
       OR draft_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR draft_project_id IS DISTINCT FROM NEW.project_id
       OR root_object_type IS DISTINCT FROM 'zhiju.execution.work_order'
       OR root_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR root_project_id IS DISTINCT FROM NEW.project_id
       OR root_current_draft_snapshot_id IS DISTINCT FROM draft_snapshot_id
       OR root_current_draft_snapshot_hash IS DISTINCT FROM draft_ref_content_hash THEN
        RAISE EXCEPTION 'context snapshot build creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;

    -- Ownership closure, same anchor as the Snapshot's guard.
    IF context_principal_kind IS NULL
       OR NEW.created_by_principal_id IS DISTINCT FROM context_principal_id
       OR receipt_created_by_principal_id IS DISTINCT FROM context_principal_id THEN
        RAISE EXCEPTION 'context snapshot build creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_context_snapshot_build_creation_identity() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION task_execution.guard_context_snapshot_build_creation_identity()
    FROM task_execution_app;

CREATE TRIGGER context_snapshot_build_creation_identity_guard
    BEFORE INSERT ON task_execution.context_snapshot_build
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_context_snapshot_build_creation_identity();

-- ---------------------------------------------------------------------------
-- Immutability.
-- ---------------------------------------------------------------------------

-- A committed Context Snapshot is history (§8.1/§8.2): a later build is a new
-- snapshot, never a rewrite of an old row, and an old Snapshot always resolves
-- its original exact refs, so the Scope, mirrors, payload and the command that
-- bound them are write-once. The BEFORE UPDATE OR DELETE trigger is the
-- in-database half of that rule; the ACL below is the other half.
CREATE FUNCTION task_execution.guard_context_snapshot_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'context_snapshot history is immutable' USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_context_snapshot_immutable() FROM PUBLIC;

CREATE TRIGGER context_snapshot_immutable_guard
    BEFORE UPDATE OR DELETE ON task_execution.context_snapshot
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_context_snapshot_immutable();

-- Build metadata is committed atomically with its Snapshot and is equally
-- write-once: a failed build leaves no row at all rather than a row to correct.
CREATE FUNCTION task_execution.guard_context_snapshot_build_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'context_snapshot_build history is immutable' USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_context_snapshot_build_immutable() FROM PUBLIC;

CREATE TRIGGER context_snapshot_build_immutable_guard
    BEFORE UPDATE OR DELETE ON task_execution.context_snapshot_build
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_context_snapshot_build_immutable();

-- Immutable facts: no UPDATE/DELETE path for the app role. No table outside
-- this migration is touched and every other grant stays as it is (the V0002
-- default privileges already grant the app role SELECT/INSERT on these new
-- owner-created tables, so no explicit GRANT is needed).
REVOKE UPDATE, DELETE ON task_execution.context_snapshot FROM task_execution_app;
REVOKE UPDATE, DELETE ON task_execution.context_snapshot_build FROM task_execution_app;

-- ---------------------------------------------------------------------------
-- RLS: Project-scoped rows are visible only through the exact Project scope of
-- the trusted transaction context (default-deny without a context, FORCE
-- applies to the owner as well). Creation attribution is anchored to the
-- context principal on INSERT only: the Receipt's own creator column is
-- caller-writable, so it can never be the anchor. No UPDATE or DELETE policy
-- exists on either table - the immutable trigger and the ACL close those paths.
-- ---------------------------------------------------------------------------

ALTER TABLE task_execution.context_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.context_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY context_snapshot_select ON task_execution.context_snapshot
    FOR SELECT TO task_execution_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY context_snapshot_insert ON task_execution.context_snapshot
    FOR INSERT TO task_execution_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id)
        AND created_by_principal_id = platform_security.context_principal_id());

ALTER TABLE task_execution.context_snapshot_build ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.context_snapshot_build FORCE ROW LEVEL SECURITY;
CREATE POLICY context_snapshot_build_select ON task_execution.context_snapshot_build
    FOR SELECT TO task_execution_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY context_snapshot_build_insert ON task_execution.context_snapshot_build
    FOR INSERT TO task_execution_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id)
        AND created_by_principal_id = platform_security.context_principal_id());

-- ---------------------------------------------------------------------------
-- task_execution.context_snapshot_legacy: read-back-only compatibility store
-- for historical immutable Context Snapshots whose identity must stay the
-- legacy `zhiju.project.context_snapshot` spelling (PostgreSQL logical model
-- §35, PR #217 independent implementation review finding 1; read routing in
-- Module-Spec-003 §20.1). Rows are created only by a migration or controlled
-- import running as the schema owner under an established Project-scoped
-- transaction context; no command handler, public API or outbox consumer can
-- ever produce one, so the table carries no creation-identity guard and no
-- Receipt binding - the controlled import manifest recorded on each row is
-- the provenance authority.
--
-- Identity: the complete legacy SnapshotRef is mirrored in promoted columns
-- (`object_type` closed to the legacy spelling, `object_id`, `snapshot_id`,
-- the hash algorithm/canonicalization version/digest triple and the Project
-- Scope). `snapshot_id` is the fact's primary key, and one object identity
-- holds exactly one snapshot inside one Project Scope, the same adjudication
-- shape as the canonical `context_snapshot` table.
--
-- Content: `canonical_payload` is the historical ProjectContext v1.0 body
-- stored exactly as imported; `project_context_contract` and `contract_ref`
-- are the historical contract body and its reference, stored as-is and closed
-- against that payload by the mirror guard below (§35 content row: at write
-- time the canonical hash is recomputed and the ref must equal it exactly).
-- The guard re-derives `snapshot_id`, the Project Scope and the SnapshotRef
-- digest from `canonical_payload`, requires the stored contract body to be the
-- hashed payload itself (the two jsonb columns must not differ), and requires
-- the stored `contract_ref` to name exactly that content address - the
-- CONTENT_ADDRESSED `zhiju.contract.project_context` ref whose objectId is the
-- Snapshot identity (the same binding the canonical read derives, §19.2), whose
-- Scope is the row's Project Scope and whose contentHash triple is the
-- recomputed cv1 SHA-256 of the contract body. An import whose stored contract
-- would not close against its own content address is refused; reads never
-- rebuild, extend or convert the stored bytes into the canonical spelling
-- (§35).
-- `object_id` is not derivable from the payload (the same posture as the
-- canonical table, where the Receipt target binds it): here the UNIQUE
-- constraint and the import manifest bind it.
-- ---------------------------------------------------------------------------

CREATE TABLE task_execution.context_snapshot_legacy (
    snapshot_id uuid PRIMARY KEY,
    object_type text NOT NULL,
    object_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    payload_hash bytea NOT NULL,
    payload_hash_algorithm text NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    canonical_payload jsonb NOT NULL,
    project_context_contract jsonb NOT NULL,
    contract_ref jsonb NOT NULL,
    import_manifest_id text NOT NULL,
    import_batch_id text NOT NULL,
    source_system text NOT NULL,
    imported_at timestamptz NOT NULL,
    import_tool_version text NOT NULL,
    -- The legacy spelling is the whole point of this store: a row labelled
    -- with anything else (including the canonical spelling) has no place here.
    CONSTRAINT context_snapshot_legacy_object_type_closed CHECK (
        object_type = 'zhiju.project.context_snapshot'),
    CONSTRAINT context_snapshot_legacy_hash_algorithm_closed CHECK (
        payload_hash_algorithm = 'SHA-256'),
    CONSTRAINT context_snapshot_legacy_canonicalization_version_closed CHECK (
        canonicalization_version = '1'),
    CONSTRAINT context_snapshot_legacy_hash_len CHECK (octet_length(payload_hash) = 32),
    -- Every row answers to a controlled import: manifest and batch, the source
    -- system, the import instant and the importing tool's version.
    CONSTRAINT context_snapshot_legacy_provenance_nonempty CHECK (
        btrim(import_manifest_id) <> ''
        AND btrim(import_batch_id) <> ''
        AND btrim(source_system) <> ''
        AND btrim(import_tool_version) <> ''),
    -- Closes the members the mirror guard dereferences, with the same
    -- null-safe `IS NOT DISTINCT FROM` semantics as the canonical table: a
    -- missing or wrongly-typed member must not survive as a NULL comparison.
    CONSTRAINT context_snapshot_legacy_content_shape CHECK (
        jsonb_typeof(canonical_payload) IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'enterpriseRef') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'projectRef') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'projectRef'->'scope')
                IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(project_context_contract) IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(contract_ref) IS NOT DISTINCT FROM 'object'),
    -- The complete identity is unique: one snapshot (primary key) and one
    -- snapshot per legacy object identity inside one Project Scope.
    CONSTRAINT context_snapshot_legacy_identity_unique UNIQUE (
        enterprise_id, project_id, object_id)
);

-- The promoted identity mirrors and the stored content address must agree with
-- the canonical payload: `snapshot_id` mirrors `contextSnapshotId`, the Scope
-- mirrors `enterpriseRef`/`projectRef` (with the `projectRef.scope` closure,
-- same as the canonical table), and `payload_hash` must recompute from the
-- stored bytes under canonicalization v1. A payload that cannot define these
-- columns is reported as the single guard error, never as a bare cast error.
--
-- The historical contract columns close against the same content address
-- (§35 content row): `project_context_contract` must not differ from the
-- hashed `canonical_payload` (the read returns one body, never a second body
-- the hash does not cover), and `contract_ref` must name exactly the
-- recomputed cv1 SHA-256 of that contract body - kind CONTENT_ADDRESSED,
-- objectType `zhiju.contract.project_context`, objectId equal to the Snapshot
-- identity (the binding the canonical read derives, §19.2), the row's Project
-- Scope, and the SHA-256/'1'/digest triple. The digest comparison is textual
-- against `encode(..., 'hex')`, so the stored digest must be the exact
-- lowercase 64-hex spelling; a missing member never survives because every
-- comparison is null-safe `IS DISTINCT FROM`.
--
-- SECURITY DEFINER for the same reason as the canonical mirror guards: the
-- guard runs the owner-only canonicalizer as its owner, so the application
-- role can never call it, and trigger functions are trigger-only.
CREATE FUNCTION task_execution.guard_context_snapshot_legacy_mirror() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $guard$
DECLARE
    mirror_mismatch boolean;
BEGIN
    BEGIN
        mirror_mismatch := (
            NEW.snapshot_id::text
                IS DISTINCT FROM NEW.canonical_payload->>'contextSnapshotId'
            OR NEW.enterprise_id::text
                IS DISTINCT FROM NEW.canonical_payload->'enterpriseRef'->>'objectId'
            OR NEW.project_id::text
                IS DISTINCT FROM NEW.canonical_payload->'projectRef'->>'objectId'
            OR NEW.enterprise_id::text
                IS DISTINCT FROM NEW.canonical_payload->'projectRef'->'scope'->>'enterpriseId'
            OR NEW.project_id::text
                IS DISTINCT FROM NEW.canonical_payload->'projectRef'->'scope'->>'projectId'
            OR NEW.payload_hash
                IS DISTINCT FROM sha256(convert_to(
                       task_execution.canonical_jsonb_text(NEW.canonical_payload), 'UTF8'))
            OR NEW.project_context_contract
                IS DISTINCT FROM NEW.canonical_payload
            OR NEW.contract_ref->>'kind'
                IS DISTINCT FROM 'CONTENT_ADDRESSED'
            OR NEW.contract_ref->>'objectType'
                IS DISTINCT FROM 'zhiju.contract.project_context'
            OR NEW.contract_ref->>'objectId'
                IS DISTINCT FROM NEW.snapshot_id::text
            OR NEW.contract_ref->'scope'->>'enterpriseId'
                IS DISTINCT FROM NEW.enterprise_id::text
            OR NEW.contract_ref->'scope'->>'projectId'
                IS DISTINCT FROM NEW.project_id::text
            OR NEW.contract_ref->'contentHash'->>'algorithm'
                IS DISTINCT FROM 'SHA-256'
            OR NEW.contract_ref->'contentHash'->>'canonicalizationVersion'
                IS DISTINCT FROM '1'
            OR NEW.contract_ref->'contentHash'->>'digest'
                IS DISTINCT FROM encode(sha256(convert_to(
                       task_execution.canonical_jsonb_text(NEW.project_context_contract),
                       'UTF8')), 'hex'));
    EXCEPTION
        WHEN invalid_text_representation
          OR invalid_datetime_format
          OR datetime_field_overflow
          OR numeric_value_out_of_range
          OR invalid_parameter_value THEN
            -- Includes 22023 raised by the canonicalizer itself (the same
            -- class of defect as in the canonical mirror guards).
            mirror_mismatch := true;
    END;
    IF mirror_mismatch THEN
        RAISE EXCEPTION 'context snapshot legacy promoted mirror mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_context_snapshot_legacy_mirror() FROM PUBLIC;

CREATE TRIGGER context_snapshot_legacy_mirror_guard
    BEFORE INSERT OR UPDATE ON task_execution.context_snapshot_legacy
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_context_snapshot_legacy_mirror();

-- An imported legacy snapshot is history exactly like its canonical sibling:
-- INSERT-only, never rewritten or removed (§35 immutability row).
CREATE FUNCTION task_execution.guard_context_snapshot_legacy_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'context_snapshot_legacy history is immutable' USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_context_snapshot_legacy_immutable() FROM PUBLIC;

CREATE TRIGGER context_snapshot_legacy_immutable_guard
    BEFORE UPDATE OR DELETE ON task_execution.context_snapshot_legacy
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_context_snapshot_legacy_immutable();

-- Read-back-only for the runtime: the V0002 default privileges grant the app
-- role SELECT, INSERT and UPDATE on new owner-created tables, so INSERT,
-- UPDATE and DELETE are revoked explicitly and the app role keeps SELECT
-- alone. No command handler, public API or outbox consumer can become a
-- legacy producer (§35 runtime ACL row).
REVOKE INSERT, UPDATE, DELETE ON task_execution.context_snapshot_legacy
    FROM task_execution_app;

-- RLS: the same FORCE + Project-scoped posture as the canonical tables.
-- SELECT is the runtime read path (the §20.1 legacy route) and is visible
-- only through the exact Project scope of the trusted transaction context.
-- INSERT is the controlled import path: only the schema owner (the migration
-- or controlled-import role) may create rows, and only under an established
-- context that allows the row's Project Scope, so an import session can never
-- plant a fact into a scope its context does not cover. No UPDATE or DELETE
-- policy exists - the immutable trigger and the ACL close those paths.
ALTER TABLE task_execution.context_snapshot_legacy ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.context_snapshot_legacy FORCE ROW LEVEL SECURITY;
CREATE POLICY context_snapshot_legacy_select ON task_execution.context_snapshot_legacy
    FOR SELECT TO task_execution_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY context_snapshot_legacy_insert ON task_execution.context_snapshot_legacy
    FOR INSERT TO task_execution_owner
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

RESET ROLE;
