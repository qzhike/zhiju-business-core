-- IM-06 (#219): TaskExecution-owned WorkOrder Validation judgment branch and
-- the frozen WorkOrder Contract fact behind the DRAFT->READY freeze.
-- Design authority: Module-Spec-003 §21 (approved #219 design) and the
-- PostgreSQL logical model §36 (#219 increment).
--
-- Scope of this slice: `execution_judgment` gains a second, mutually exclusive
-- kind branch `WORK_ORDER_VALIDATION`; the historical `TASK_READINESS` rows and
-- every constraint that governs them stay byte-for-byte readable, and the two
-- kinds are separated by a branch CHECK plus branched mirror/creation-identity
-- guards rather than by widening the old single-shape rules. The new
-- `work_order_contract` table holds the one immutable frozen Contract of a
-- WorkOrder; the WorkOrder Root gains the write-once composite frozen pointer
-- `(work_order_id, frozen_contract_id, frozen_contract_hash)`.
--
-- A validation judgment is an immutable fact about one evaluation instant,
-- exactly like the V3002 readiness judgment: no CAS version, no current
-- pointer, no Outbox row (the Catalog registers no ValidationBuilt Event), and
-- a business-false verdict is still a persistable explainable judgment while
-- identity/scope/authorization failures are rejected before any insert.
--
-- Mirrors and content address: every promoted column of the new judgment
-- branch and of `work_order_contract` is re-derived in SQL from the stored
-- canonical payload, so a direct write cannot publish a row whose columns
-- disagree with its own bytes. `payload_hash` is
-- `sha256(convert_to(task_execution.canonical_jsonb_text(canonical_payload),
-- 'UTF8'))`, reusing the owner-only canonicalization-v1 helper V3001 created
-- (PostgreSQL 18 provides `sha256(bytea)`; pgcrypto stays disabled). For the
-- Contract only, its own header.payloadHash is excluded, matching the shared
-- hashContractPayload function; the stored header must carry that digest. The
-- Contract's `specification_hash` re-implements the Core §4.3 frozen
-- specification subset: the fifteen members objective..versionPins (including
-- `contextSnapshotRef`, excluding the header, the identity/attribution members
-- and `expiresAt`), rebuilt with `jsonb_build_object` and hashed under the
-- same canonicalization. All fifteen members are required by the registered
-- Core WorkOrder schema, so the payload shape CHECK pins their presence and
-- JSON kind before any comparison runs.
--
-- Ownership closure follows the V3003/V3004 convention: the trusted anchor is
-- the platform transaction context, not the Receipt's caller-writable creator
-- column. The contract INSERT policy binds `created_by_principal_id` to
-- `platform_security.context_principal_id()`, and the creation-identity guard
-- additionally requires a non-NULL `context_principal_kind()` (a legacy
-- 10-parameter context can never freeze a WorkOrder) and the Receipt creator
-- equal to the context principal.
--
-- RLS follows the V3000-V3004 conventions: FORCE, and Project-scoped rows call
-- `context_allows_project(enterprise_id, project_id)`, so a judgment or a
-- frozen Contract can never leak through an Enterprise-only or foreign-Project
-- Context. No cross-Schema FK/join is created and no other Schema's data is
-- copied.

SET ROLE task_execution_owner;

-- ---------------------------------------------------------------------------
-- execution_judgment: add the WORK_ORDER_VALIDATION branch.
--
-- The V3002 columns `task_id`, `task_definition_snapshot_id`,
-- `task_definition_hash` and `ready` are Task-kind mirrors and must be NULL on
-- the new kind; the new mirrors (`work_order_id`, the exact Draft/Context refs
-- by row id + payload hash, the candidate/specification hashes and the seven
-- Core §4.14 booleans) must be NULL on the old kind. `ALTER COLUMN ... DROP
-- NOT NULL` plus the branch CHECK below replaces the V3002 single-kind
-- nullability without rewriting any historical row.
-- ---------------------------------------------------------------------------

-- Private structural predicates for the new judgment kind only. They validate
-- JSON bytes, not external Policy lifecycle or membership in a static registry.
CREATE FUNCTION task_execution.work_order_validation_hash_valid(h jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $body$
  SELECT coalesce(
    jsonb_typeof(h) = 'object'
    AND h ?& ARRAY['algorithm','digest','canonicalizationVersion']
    AND h - ARRAY['algorithm','digest','canonicalizationVersion'] = '{}'::jsonb
    AND h->'algorithm' = '"SHA-256"'::jsonb
    AND h->'canonicalizationVersion' = '"1"'::jsonb
    AND jsonb_typeof(h->'digest') = 'string'
    AND h->>'digest' ~ '^[0-9a-f]{64}$', false)
$body$;
REVOKE ALL ON FUNCTION task_execution.work_order_validation_hash_valid(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION task_execution.work_order_validation_hash_valid(jsonb) FROM task_execution_app;

CREATE FUNCTION task_execution.work_order_validation_ref_valid(
  r jsonb, expected_kind text, expected_type text, expected_scope jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $body$
DECLARE
  keys text[] := ARRAY['kind','objectType','objectId','scope'];
  identity_key text;
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
BEGIN
  CASE expected_kind
    WHEN 'OBJECT' THEN identity_key := 'objectId';
    WHEN 'VERSIONED' THEN keys := array_append(keys,'versionId'); identity_key := 'versionId';
    WHEN 'SNAPSHOT' THEN keys := keys || ARRAY['snapshotId','contentHash']; identity_key := 'snapshotId';
    WHEN 'CONTENT_ADDRESSED' THEN keys := array_append(keys,'contentHash'); identity_key := 'objectId';
    ELSE RETURN false;
  END CASE;
  IF jsonb_typeof(r) IS DISTINCT FROM 'object'
     OR NOT r ?& keys OR r - keys <> '{}'::jsonb
     OR r->>'kind' IS DISTINCT FROM expected_kind
     OR r->>'objectType' IS DISTINCT FROM expected_type
     OR r->'scope' IS DISTINCT FROM expected_scope
     OR jsonb_typeof(r->'objectId') IS DISTINCT FROM 'string'
     OR (r->>'objectId' ~ uuid_pattern) IS DISTINCT FROM true
     OR jsonb_typeof(r->identity_key) IS DISTINCT FROM 'string'
     OR (r->>identity_key ~ uuid_pattern) IS DISTINCT FROM true
     OR (expected_kind IN ('SNAPSHOT','CONTENT_ADDRESSED')
         AND NOT task_execution.work_order_validation_hash_valid(r->'contentHash'))
  THEN RETURN false; END IF;
  RETURN true;
END
$body$;
REVOKE ALL ON FUNCTION task_execution.work_order_validation_ref_valid(jsonb,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION task_execution.work_order_validation_ref_valid(jsonb,text,text,jsonb) FROM task_execution_app;

-- New-kind closure only. Historical TASK_READINESS payloads retain their V3002
-- contract; no existing row is rewritten to carry dependency observations.
CREATE FUNCTION task_execution.work_order_validation_payload_valid(p jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog AS $body$
DECLARE
  keys text[] := ARRAY['judgmentId','judgmentKind','scope','workOrderRef','draftSnapshotRef',
    'candidateContractHash','specificationHash','contextSnapshotRef','policyRef','policyVersionRef',
    'policyContentHash','policyEffectiveFrom','policySupersededAt','evaluatorRef','subjectRefs',
    'sourceWatermarks','producedBy','actorSnapshotRef','authorizationDecisionRef','inputHash',
    'evaluatedAt','validUntil','validation','checks','dependencyObservations'];
  item jsonb; roles text[] := ARRAY[]::text[]; code text; field text; prior text := '';
  reasons jsonb := '[]'::jsonb; passed boolean := true;
  uuid_pattern constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  static_type text;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT p ?& keys OR p - keys <> '{}'::jsonb
     OR jsonb_typeof(p->'dependencyObservations') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p->'dependencyObservations') <> 7
     OR (p->>'validUntil')::timestamptz <= (p->>'evaluatedAt')::timestamptz
     OR p->>'inputHash' IS DISTINCT FROM encode(sha256(convert_to(task_execution.canonical_jsonb_text(
        jsonb_build_object('subjectRefs',p->'subjectRefs','candidateContractHash',p->'candidateContractHash',
          'dependencyObservations',p->'dependencyObservations','sourceWatermarks',p->'sourceWatermarks')),'UTF8')),'hex')
  THEN RETURN false; END IF;
  -- These three distinct kinds have one fixed UTF-8 order: CONTENT_ADDRESSED,
  -- OBJECT, SNAPSHOT. Exact equality closes count, order, uniqueness and every
  -- embedded member; a valid hash alone cannot establish this binding.
  IF jsonb_typeof(p->'scope') IS DISTINCT FROM 'object'
     OR NOT (p->'scope') ?& ARRAY['enterpriseId','projectId']
     OR (p->'scope') - ARRAY['enterpriseId','projectId'] <> '{}'::jsonb
     OR jsonb_typeof(p->'scope'->'enterpriseId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(p->'scope'->'projectId') IS DISTINCT FROM 'string'
     OR (p->'scope'->>'enterpriseId' ~ uuid_pattern) IS DISTINCT FROM true
     OR (p->'scope'->>'projectId' ~ uuid_pattern) IS DISTINCT FROM true
     OR NOT task_execution.work_order_validation_ref_valid(p->'workOrderRef',
       'OBJECT','zhiju.execution.work_order',p->'scope')
     OR NOT task_execution.work_order_validation_ref_valid(p->'draftSnapshotRef',
       'CONTENT_ADDRESSED','zhiju.execution.work_order_draft_snapshot',p->'scope')
     OR NOT task_execution.work_order_validation_ref_valid(p->'contextSnapshotRef',
       'SNAPSHOT','zhiju.execution.context_snapshot',p->'scope')
     OR NOT task_execution.work_order_validation_ref_valid(p->'actorSnapshotRef',
       'SNAPSHOT','identity.actor_snapshot',p->'scope')
     OR NOT task_execution.work_order_validation_ref_valid(p->'authorizationDecisionRef',
       'CONTENT_ADDRESSED','identity.authorization_decision',p->'scope')
     OR p->'subjectRefs' IS DISTINCT FROM jsonb_build_array(
       p->'draftSnapshotRef',p->'workOrderRef',p->'contextSnapshotRef')
  THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p->'dependencyObservations') LOOP
    code := (item->>'kind') || ':' || (item->>'role');
    IF code IS NULL OR code COLLATE "C" <= prior COLLATE "C" THEN RETURN false; END IF;
    prior := code; roles := array_append(roles,code);
    IF item->>'kind' = 'POLICY' THEN
      keys := ARRAY['kind','role','reference','policyVersionRef','contentHash','effectiveFrom','supersededAt'];
      IF NOT item ?& keys OR item - keys <> '{}'::jsonb
         OR NOT task_execution.work_order_validation_ref_valid(item->'reference',
           'VERSIONED','zhiju.identity.policy',p->'scope')
         OR NOT task_execution.work_order_validation_ref_valid(item->'policyVersionRef',
           'SNAPSHOT','zhiju.identity.policy_version',p->'scope')
         OR NOT task_execution.work_order_validation_hash_valid(item->'contentHash')
         OR (item->>'effectiveFrom')::timestamptz > (p->>'evaluatedAt')::timestamptz
         OR (item->>'supersededAt' IS NOT NULL AND (item->>'supersededAt')::timestamptz < (p->>'validUntil')::timestamptz)
      THEN RETURN false; END IF;
      IF item->>'role' = 'VALIDATION' AND (
         item->'reference' IS DISTINCT FROM p->'policyRef'
         OR item->'policyVersionRef' IS DISTINCT FROM p->'policyVersionRef'
         OR item->'contentHash'->>'digest' IS DISTINCT FROM p->>'policyContentHash'
         OR item->'effectiveFrom' IS DISTINCT FROM p->'policyEffectiveFrom'
         OR item->'supersededAt' IS DISTINCT FROM p->'policySupersededAt') THEN RETURN false; END IF;
    ELSIF item->>'kind' = 'STATIC' THEN
      keys := ARRAY['kind','role','reference','registryVersion','registryKey','descriptorHash'];
      static_type := CASE item->>'role'
        WHEN 'EVALUATOR' THEN 'zhiju.execution.evaluator_profile'
        WHEN 'EXECUTION_RISK' THEN 'zhiju.execution.work_order_risk_profile'
        WHEN 'RUNTIME_ADAPTER' THEN 'zhiju.runtime.adapter_contract'
        WHEN 'WORK_ORDER_SCHEMA' THEN 'zhiju.contract.work_order_schema' END;
      IF NOT item ?& keys OR item - keys <> '{}'::jsonb
         OR static_type IS NULL
         OR NOT task_execution.work_order_validation_ref_valid(item->'reference',
           'VERSIONED',static_type,'{}'::jsonb)
         OR NOT task_execution.work_order_validation_hash_valid(item->'descriptorHash')
         OR jsonb_typeof(item->'registryVersion') IS DISTINCT FROM 'string'
         OR jsonb_typeof(item->'registryKey') IS DISTINCT FROM 'string'
         OR nullif(item->>'registryVersion','') IS NULL OR nullif(item->>'registryKey','') IS NULL
         OR (item->>'role' = 'EVALUATOR' AND item->'reference' IS DISTINCT FROM p->'evaluatorRef')
      THEN RETURN false; END IF;
    ELSE RETURN false; END IF;
  END LOOP;
  IF roles IS DISTINCT FROM ARRAY['POLICY:CONTEXT_BUILDER','POLICY:CONTROLS','POLICY:VALIDATION',
    'STATIC:EVALUATOR','STATIC:EXECUTION_RISK','STATIC:RUNTIME_ADAPTER','STATIC:WORK_ORDER_SCHEMA'] THEN RETURN false; END IF;
  keys := ARRAY['valid','referencesValid','specificationHashValid','capabilityValid','executable','budgetValid','contextCoverageValid','violations','validatedAt'];
  IF NOT (p->'validation') ?& keys OR (p->'validation') - keys <> '{}'::jsonb
     OR p->'validation'->'validatedAt' IS DISTINCT FROM p->'evaluatedAt'
     OR jsonb_typeof(p->'checks') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'checks') <> 7 THEN RETURN false; END IF;
  prior := ''; roles := ARRAY[]::text[];
  FOR item IN SELECT value FROM jsonb_array_elements(p->'checks') LOOP
    code := item->>'checkCode';
    field := CASE code WHEN 'PLAN_VALID' THEN 'valid' WHEN 'REFERENCES_VALID' THEN 'referencesValid'
      WHEN 'SPECIFICATION_HASH_VALID' THEN 'specificationHashValid' WHEN 'CAPABILITY_VALID' THEN 'capabilityValid'
      WHEN 'EXECUTABLE' THEN 'executable' WHEN 'BUDGET_VALID' THEN 'budgetValid'
      WHEN 'CONTEXT_COVERAGE_VALID' THEN 'contextCoverageValid' END;
    keys := ARRAY['checkCode','outcome','reasonCodes'];
    IF field IS NULL OR code COLLATE "C" <= prior COLLATE "C" OR NOT item ?& keys OR item - keys <> '{}'::jsonb
       OR jsonb_typeof(item->'reasonCodes') IS DISTINCT FROM 'array'
       OR (item->>'outcome' IN ('SATISFIED','UNSATISFIED')) IS DISTINCT FROM true
       OR jsonb_typeof(p->'validation'->field) IS DISTINCT FROM 'boolean'
       OR (p->'validation'->>field)::boolean IS DISTINCT FROM (item->>'outcome'='SATISFIED')
       OR (item->>'outcome'='SATISFIED' AND item->'reasonCodes' <> '[]'::jsonb)
    THEN RETURN false; END IF;
    prior := code; roles := array_append(roles,code);
    IF code <> 'EXECUTABLE' THEN passed := passed AND (item->>'outcome'='SATISFIED'); END IF;
    reasons := reasons || (item->'reasonCodes');
  END LOOP;
  IF roles IS DISTINCT FROM ARRAY['BUDGET_VALID','CAPABILITY_VALID','CONTEXT_COVERAGE_VALID','EXECUTABLE','PLAN_VALID','REFERENCES_VALID','SPECIFICATION_HASH_VALID']
     OR (p->'validation'->>'executable')::boolean IS DISTINCT FROM passed
     OR p->'validation'->'violations' IS DISTINCT FROM reasons THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$body$;
REVOKE ALL ON FUNCTION task_execution.work_order_validation_payload_valid(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION task_execution.work_order_validation_payload_valid(jsonb) TO task_execution_app;

ALTER TABLE task_execution.execution_judgment
    ALTER COLUMN task_id DROP NOT NULL,
    ALTER COLUMN task_definition_snapshot_id DROP NOT NULL,
    ALTER COLUMN task_definition_hash DROP NOT NULL,
    ALTER COLUMN ready DROP NOT NULL,
    ADD COLUMN work_order_id uuid,
    ADD COLUMN draft_snapshot_id uuid,
    ADD COLUMN draft_snapshot_hash bytea,
    ADD COLUMN candidate_contract_hash bytea,
    ADD COLUMN specification_hash bytea,
    ADD COLUMN context_snapshot_id uuid,
    ADD COLUMN context_snapshot_hash bytea,
    ADD COLUMN validation_valid boolean,
    ADD COLUMN validation_references_valid boolean,
    ADD COLUMN validation_specification_hash_valid boolean,
    ADD COLUMN validation_capability_valid boolean,
    ADD COLUMN validation_executable boolean,
    ADD COLUMN validation_budget_valid boolean,
    ADD COLUMN validation_context_coverage_valid boolean;

-- The three V3002 CHECKs are single-shape rules; they are replaced by branched
-- equivalents that keep the TASK_READINESS half byte-identical in effect and
-- add the WORK_ORDER_VALIDATION half. Dropping and re-adding is safe on an
-- upgrade database because every existing row satisfies the new predicates.
ALTER TABLE task_execution.execution_judgment
    DROP CONSTRAINT execution_judgment_kind_closed,
    DROP CONSTRAINT execution_judgment_hash_len,
    DROP CONSTRAINT execution_judgment_payload_shape;

ALTER TABLE task_execution.execution_judgment
    -- §33/§36: two kinds have owning producers now. Widening this list must be
    -- a forward migration delivered together with the producing command of
    -- that kind.
    ADD CONSTRAINT execution_judgment_kind_closed CHECK (
        judgment_kind IN ('TASK_READINESS', 'WORK_ORDER_VALIDATION')),
    -- Mutually exclusive kind halves: each kind's own mirrors are NOT NULL and
    -- the other kind's mirrors are NULL, so a row can never straddle the two
    -- shapes or smuggle a half-populated mirror set.
    ADD CONSTRAINT execution_judgment_kind_columns CHECK (
        (judgment_kind = 'TASK_READINESS'
            AND task_id IS NOT NULL
            AND task_definition_snapshot_id IS NOT NULL
            AND task_definition_hash IS NOT NULL
            AND ready IS NOT NULL
            AND work_order_id IS NULL
            AND draft_snapshot_id IS NULL
            AND draft_snapshot_hash IS NULL
            AND candidate_contract_hash IS NULL
            AND specification_hash IS NULL
            AND context_snapshot_id IS NULL
            AND context_snapshot_hash IS NULL
            AND validation_valid IS NULL
            AND validation_references_valid IS NULL
            AND validation_specification_hash_valid IS NULL
            AND validation_capability_valid IS NULL
            AND validation_executable IS NULL
            AND validation_budget_valid IS NULL
            AND validation_context_coverage_valid IS NULL)
        OR (judgment_kind = 'WORK_ORDER_VALIDATION'
            AND task_id IS NULL
            AND task_definition_snapshot_id IS NULL
            AND task_definition_hash IS NULL
            AND ready IS NULL
            AND work_order_id IS NOT NULL
            AND draft_snapshot_id IS NOT NULL
            AND draft_snapshot_hash IS NOT NULL
            AND candidate_contract_hash IS NOT NULL
            AND specification_hash IS NOT NULL
            AND context_snapshot_id IS NOT NULL
            AND context_snapshot_hash IS NOT NULL
            AND validation_valid IS NOT NULL
            AND validation_references_valid IS NOT NULL
            AND validation_specification_hash_valid IS NOT NULL
            AND validation_capability_valid IS NOT NULL
            AND validation_executable IS NOT NULL
            AND validation_budget_valid IS NOT NULL
            AND validation_context_coverage_valid IS NOT NULL)),
    -- Content addresses and the request binding are SHA-256 in both branches:
    -- a row with a short or absent digest could claim an identity the
    -- application cannot recompute.
    ADD CONSTRAINT execution_judgment_hash_len CHECK (
        octet_length(policy_content_hash) = 32
        AND octet_length(input_hash) = 32
        AND octet_length(payload_hash) = 32
        AND octet_length(request_payload_hash) = 32
        AND (judgment_kind <> 'TASK_READINESS'
             OR octet_length(task_definition_hash) = 32)
        AND (judgment_kind <> 'WORK_ORDER_VALIDATION'
             OR (octet_length(draft_snapshot_hash) = 32
                 AND octet_length(candidate_contract_hash) = 32
                 AND octet_length(specification_hash) = 32
                 AND octet_length(context_snapshot_hash) = 32))),
    -- Branched payload shape: the shared head (object payload, judgmentKind
    -- echoing the column, object scope) applies to both kinds; each branch
    -- then closes the cheap structural half of its own §17.7 / §21.2 body.
    -- Every comparison is `IS NOT DISTINCT FROM`: a plain `=` against a
    -- missing JSON member yields NULL, and SQL would let a NULL CHECK pass.
    ADD CONSTRAINT execution_judgment_payload_shape CHECK (
        jsonb_typeof(canonical_payload) IS NOT DISTINCT FROM 'object'
        AND canonical_payload->>'judgmentKind' IS NOT DISTINCT FROM judgment_kind
        AND jsonb_typeof(canonical_payload->'scope') IS NOT DISTINCT FROM 'object'
        AND (judgment_kind <> 'TASK_READINESS' OR (
            jsonb_typeof(canonical_payload->'taskRef') IS NOT DISTINCT FROM 'object'
            AND jsonb_typeof(canonical_payload->'taskDefinitionRef')
                IS NOT DISTINCT FROM 'object'
            AND jsonb_typeof(canonical_payload->'dependencies') IS NOT DISTINCT FROM 'array'
            AND jsonb_typeof(canonical_payload->'inputs') IS NOT DISTINCT FROM 'array'
            AND jsonb_typeof(canonical_payload->'blockers') IS NOT DISTINCT FROM 'array'
            AND jsonb_typeof(canonical_payload->'checks') IS NOT DISTINCT FROM 'array'
            AND jsonb_typeof(canonical_payload->'ready') IS NOT DISTINCT FROM 'boolean'))
        AND (judgment_kind <> 'WORK_ORDER_VALIDATION' OR (
            task_execution.work_order_validation_payload_valid(canonical_payload)
            AND jsonb_typeof(canonical_payload->'workOrderRef') IS NOT DISTINCT FROM 'object'
            AND jsonb_typeof(canonical_payload->'draftSnapshotRef')
                IS NOT DISTINCT FROM 'object'
            AND jsonb_typeof(canonical_payload->'contextSnapshotRef')
                IS NOT DISTINCT FROM 'object'
            AND jsonb_typeof(canonical_payload->'policyVersionRef')
                IS NOT DISTINCT FROM 'object'
            AND jsonb_typeof(canonical_payload->'evaluatorRef') IS NOT DISTINCT FROM 'object'
            AND jsonb_typeof(canonical_payload->'subjectRefs') IS NOT DISTINCT FROM 'array'
            AND jsonb_typeof(canonical_payload->'sourceWatermarks') IS NOT DISTINCT FROM 'array'
            AND jsonb_typeof(canonical_payload->'validation') IS NOT DISTINCT FROM 'object'
            AND jsonb_typeof(canonical_payload->'checks') IS NOT DISTINCT FROM 'array')));

-- Audit read path for the new kind: the validation judgments of one WorkOrder
-- in this Project Scope, newest first. The latest judgment is never a Freeze
-- qualification input (§36 item 1); this index serves exact audit reads only.
CREATE INDEX execution_judgment_work_order_idx
    ON task_execution.execution_judgment (enterprise_id, project_id, work_order_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Payload mirror guard (branched).
-- ---------------------------------------------------------------------------

-- CREATE OR REPLACE keeps the existing trigger binding; the TASK_READINESS
-- comparison set is the V3002 set verbatim, the WORK_ORDER_VALIDATION set
-- re-derives the new mirrors from the §21.2 closed payload. The nested-block
-- rationale is unchanged: a payload that cannot be cast fails the guard as a
-- mirror mismatch instead of escaping as a cast error, and failures that are
-- not properties of the payload keep their own code.
CREATE OR REPLACE FUNCTION task_execution.guard_execution_judgment_mirror() RETURNS trigger
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
        IF NEW.judgment_kind = 'TASK_READINESS' THEN
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
        ELSE
            -- WORK_ORDER_VALIDATION (§21.2 closed payload): `judgmentId` is the
            -- CREATE target identity, the Draft ref is ContentAddressed (row id
            -- = objectId), the Context ref is a SnapshotRef (row id =
            -- snapshotId), both contract hashes and the input/policy hashes
            -- are 64-hex members, and the seven Core §4.14 booleans live under
            -- `validation`.
            mirror_mismatch := (
                NEW.judgment_id::text
                    IS DISTINCT FROM NEW.canonical_payload->>'judgmentId'
                OR NEW.enterprise_id::text
                    IS DISTINCT FROM NEW.canonical_payload->'scope'->>'enterpriseId'
                OR NEW.project_id::text
                    IS DISTINCT FROM NEW.canonical_payload->'scope'->>'projectId'
                OR NEW.judgment_kind
                    IS DISTINCT FROM NEW.canonical_payload->>'judgmentKind'
                OR NEW.work_order_id::text
                    IS DISTINCT FROM NEW.canonical_payload->'workOrderRef'->>'objectId'
                OR NEW.draft_snapshot_id::text
                    IS DISTINCT FROM NEW.canonical_payload->'draftSnapshotRef'->>'objectId'
                OR NEW.draft_snapshot_hash
                    IS DISTINCT FROM decode(
                           NEW.canonical_payload->'draftSnapshotRef'->'contentHash'->>'digest',
                           'hex')
                OR NEW.candidate_contract_hash
                    IS DISTINCT FROM decode(NEW.canonical_payload->>'candidateContractHash', 'hex')
                OR NEW.specification_hash
                    IS DISTINCT FROM decode(NEW.canonical_payload->>'specificationHash', 'hex')
                OR NEW.context_snapshot_id::text
                    IS DISTINCT FROM NEW.canonical_payload->'contextSnapshotRef'->>'snapshotId'
                OR NEW.context_snapshot_hash
                    IS DISTINCT FROM decode(
                           NEW.canonical_payload->'contextSnapshotRef'->'contentHash'->>'digest',
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
                OR NEW.validation_valid
                    IS DISTINCT FROM (NEW.canonical_payload->'validation'->>'valid')::boolean
                OR NEW.validation_references_valid
                    IS DISTINCT FROM (NEW.canonical_payload->'validation'->>'referencesValid')::boolean
                OR NEW.validation_specification_hash_valid
                    IS DISTINCT FROM (NEW.canonical_payload->'validation'->>'specificationHashValid')::boolean
                OR NEW.validation_capability_valid
                    IS DISTINCT FROM (NEW.canonical_payload->'validation'->>'capabilityValid')::boolean
                OR NEW.validation_executable
                    IS DISTINCT FROM (NEW.canonical_payload->'validation'->>'executable')::boolean
                OR NEW.validation_budget_valid
                    IS DISTINCT FROM (NEW.canonical_payload->'validation'->>'budgetValid')::boolean
                OR NEW.validation_context_coverage_valid
                    IS DISTINCT FROM (NEW.canonical_payload->'validation'->>'contextCoverageValid')::boolean
                OR NEW.payload_hash
                    IS DISTINCT FROM sha256(convert_to(
                           task_execution.canonical_jsonb_text(NEW.canonical_payload), 'UTF8')));
        END IF;
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

-- ---------------------------------------------------------------------------
-- Creation identity guard (branched).
-- ---------------------------------------------------------------------------

-- The judgment must be written by the in-flight transaction of the very
-- command it claims. The TASK_READINESS branch is the V3002 binding verbatim
-- (`execution.build_task_readiness@1.0` on `zhiju.execution.task_readiness`);
-- the WORK_ORDER_VALIDATION branch binds a PENDING
-- `execution.validate_work_order_draft@1.0` Receipt whose target is this
-- judgment (`zhiju.execution.work_order_validation` / `judgment_id`), whose
-- Project Scope is the judgment's Scope and whose `request_payload_hash` is
-- the judgment's `request_payload_hash`. The judgment payload is the command's
-- *conclusion*, not its request, so only the request hash and the target/Scope
-- identity are required to agree - the payload is deliberately not required to
-- equal the request body.
--
-- SECURITY INVOKER on purpose: the Receipt is read under the same RLS policies
-- and trusted Scope the writer itself is subject to, so a Receipt hidden from
-- this writer is indistinguishable from a missing one and the guard fails
-- closed instead of trusting a row the transaction may not see.
CREATE OR REPLACE FUNCTION task_execution.guard_execution_judgment_creation_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
DECLARE
    expected_command_type text;
    expected_target_type text;
    receipt_command_version text;
    receipt_target_type text;
    receipt_target_id uuid;
    receipt_enterprise_id uuid;
    receipt_project_id uuid;
    receipt_request_payload_hash bytea;
    receipt_outcome text;
BEGIN
    IF NEW.judgment_kind = 'TASK_READINESS' THEN
        expected_command_type := 'execution.build_task_readiness';
        expected_target_type := 'zhiju.execution.task_readiness';
    ELSE
        expected_command_type := 'execution.validate_work_order_draft';
        expected_target_type := 'zhiju.execution.work_order_validation';
    END IF;

    SELECT r.command_version, r.target_type, r.target_id,
           r.enterprise_id, r.project_id, r.request_payload_hash, r.outcome
      INTO receipt_command_version, receipt_target_type, receipt_target_id,
           receipt_enterprise_id, receipt_project_id, receipt_request_payload_hash,
           receipt_outcome
      FROM task_execution.command_receipt r
     WHERE r.command_id = NEW.source_command_id
       AND r.command_type = expected_command_type;
    IF NOT FOUND
       OR receipt_command_version IS DISTINCT FROM '1.0'
       OR receipt_target_type IS DISTINCT FROM expected_target_type
       OR receipt_target_id IS DISTINCT FROM NEW.judgment_id
       OR receipt_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR receipt_project_id IS DISTINCT FROM NEW.project_id
       OR receipt_request_payload_hash IS DISTINCT FROM NEW.request_payload_hash
       OR receipt_outcome IS DISTINCT FROM 'PENDING'
       OR (NEW.judgment_kind = 'WORK_ORDER_VALIDATION' AND (
           platform_security.context_principal_kind() IS DISTINCT FROM 'SERVICE'
           OR NEW.created_by_principal_id IS DISTINCT FROM platform_security.context_principal_id()
           OR NEW.canonical_payload->'producedBy' IS DISTINCT FROM jsonb_build_object('principalId',platform_security.context_principal_id()::text,'principalKind','SERVICE'))) THEN
        RAISE EXCEPTION 'execution judgment creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_execution_judgment_creation_identity() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION task_execution.guard_execution_judgment_creation_identity()
    FROM task_execution_app;

-- The immutable guard, the REVOKEs and the RLS policies of V3002 are
-- kind-agnostic and stay as they are.

-- ---------------------------------------------------------------------------
-- task_execution.work_order_contract: the one immutable frozen WorkOrder
-- Contract of a WorkOrder (§36 item 2). `contract_id` is the Contract's own
-- identity (`header.contractId`), generated by the application; the primary
-- key is the identity boundary, the Project-scoped UNIQUE adjudicates a
-- duplicate identity inside one Project Scope, and `UNIQUE (work_order_id)`
-- makes a second frozen binding for the same WorkOrder impossible no matter
-- which command produced it.
-- ---------------------------------------------------------------------------

CREATE TABLE task_execution.work_order_contract (
    contract_id uuid PRIMARY KEY,
    work_order_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    work_order_object_type text NOT NULL,
    task_id uuid NOT NULL,
    task_object_type text NOT NULL,
    draft_snapshot_id uuid NOT NULL,
    draft_snapshot_hash bytea NOT NULL,
    context_snapshot_id uuid NOT NULL,
    context_snapshot_hash bytea NOT NULL,
    validation_judgment_id uuid NOT NULL,
    validation_judgment_hash bytea NOT NULL,
    canonical_payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    specification_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    request_payload_hash bytea NOT NULL,
    source_command_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    -- The first Freeze slice accepts only the canonical spelling: a WorkOrder
    -- created by `create_work_order@1.1` (§21.3); the legacy noun has no
    -- owning freeze path and fails closed before any insert.
    CONSTRAINT work_order_contract_object_type_closed CHECK (
        work_order_object_type IN ('zhiju.execution.work_order')),
    -- The bound Task spelling is derived from that Task's own creation
    -- definition snapshot (§18.3), never from the WorkOrder version.
    CONSTRAINT work_order_contract_task_object_type_closed CHECK (
        task_object_type IN ('execution.task', 'zhiju.execution.task')),
    CONSTRAINT work_order_contract_hash_len CHECK (
        octet_length(draft_snapshot_hash) = 32
        AND octet_length(context_snapshot_hash) = 32
        AND octet_length(validation_judgment_hash) = 32
        AND octet_length(payload_hash) = 32
        AND octet_length(specification_hash) = 32
        AND octet_length(request_payload_hash) = 32),
    CONSTRAINT work_order_contract_scope_unique UNIQUE (
        enterprise_id, project_id, contract_id),
    -- One frozen binding per WorkOrder, ever.
    CONSTRAINT work_order_contract_single_binding_unique UNIQUE (work_order_id),
    -- Composite identity the Root frozen pointer references: the same
    -- WorkOrder, the same Contract and the exact canonical payload hash.
    CONSTRAINT work_order_contract_pointer_unique UNIQUE (
        work_order_id, contract_id, payload_hash),
    -- The payload is the full Core WorkOrderContract candidate that was
    -- frozen. This constraint closes the cheap structural half: the members
    -- the mirror guard re-derives, plus the presence and JSON kind of all
    -- fifteen Core §4.3 specification members so the `jsonb_build_object`
    -- subset below can never silently turn a missing member into a JSON null
    -- that the application-side subset hash would not contain.
    CONSTRAINT work_order_contract_payload_shape CHECK (
        jsonb_typeof(canonical_payload) IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'header') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'workOrderRef') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'taskRef') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'projectRef') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'requestedBy') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'objective') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'targetScope') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'inputRefs') IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'contextSnapshotRef') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'constraints') IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'allowedCapabilities') IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'deniedCapabilities') IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'expectedOutputs') IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'completionCriteria') IS NOT DISTINCT FROM 'array'
        AND jsonb_typeof(canonical_payload->'riskAndQuality') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'executionPolicy') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'budget') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'harnessPolicy') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'modelPolicy') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'versionPins') IS NOT DISTINCT FROM 'object'
        AND jsonb_typeof(canonical_payload->'specificationHash') IS NOT DISTINCT FROM 'object')
);

-- ---------------------------------------------------------------------------
-- Contract payload mirror guard. The Contract content address follows
-- shared-kernel hashContractPayload: exclude only its own header.payloadHash.
-- ---------------------------------------------------------------------------

-- The promoted columns and both content addresses must agree with the stored
-- canonical payload: a frozen Contract cannot be published under an identity,
-- Scope, WorkOrder/Task spelling or Context ref its own bytes do not carry.
-- `specification_hash` is recomputed over the Core §4.3 fifteen-member subset
-- (objective..versionPins, including `contextSnapshotRef`) and must also equal
-- the payload's own declared `specificationHash` digest, so declaration,
-- column and recomputation are one fact. The Draft/Validation ref mirrors have
-- no payload counterpart: they are bound by the owning Freeze handler against
-- the committed judgment, and the creation-identity guard below binds the row
-- to that command's in-flight Receipt.
--
-- SECURITY DEFINER for the same reason as the V3002/V3003 mirror guards: the
-- guard calls the owner-only canonicalizer, and running as its owner keeps the
-- canonicalizer unreachable for the application role while every insert still
-- re-derives both content addresses in the database.
CREATE FUNCTION task_execution.guard_work_order_contract_mirror() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $guard$
DECLARE
    mirror_mismatch boolean;
BEGIN
    -- Nested block for the same reason as the judgment mirror guard: a payload
    -- that cannot be cast or decoded fails this guard as a mirror mismatch
    -- rather than escaping under a different code.
    BEGIN
        mirror_mismatch := (
            NEW.contract_id::text
                IS DISTINCT FROM NEW.canonical_payload->'header'->>'contractId'
            OR NEW.work_order_id::text
                IS DISTINCT FROM NEW.canonical_payload->'workOrderRef'->>'objectId'
            OR NEW.work_order_object_type
                IS DISTINCT FROM NEW.canonical_payload->'workOrderRef'->>'objectType'
            OR NEW.task_id::text
                IS DISTINCT FROM NEW.canonical_payload->'taskRef'->>'objectId'
            OR NEW.task_object_type
                IS DISTINCT FROM NEW.canonical_payload->'taskRef'->>'objectType'
            OR NEW.enterprise_id::text
                IS DISTINCT FROM NEW.canonical_payload->'projectRef'->'scope'->>'enterpriseId'
            OR NEW.project_id::text
                IS DISTINCT FROM NEW.canonical_payload->'projectRef'->'scope'->>'projectId'
            OR NEW.context_snapshot_id::text
                IS DISTINCT FROM NEW.canonical_payload->'contextSnapshotRef'->>'snapshotId'
            OR NEW.context_snapshot_hash
                IS DISTINCT FROM decode(
                       NEW.canonical_payload->'contextSnapshotRef'->'contentHash'->>'digest',
                       'hex')
            OR NEW.specification_hash
                IS DISTINCT FROM decode(
                       NEW.canonical_payload->'specificationHash'->>'digest', 'hex')
            OR NEW.payload_hash
                IS DISTINCT FROM decode(
                       NEW.canonical_payload->'header'->'payloadHash'->>'digest', 'hex')
            OR NEW.payload_hash
                IS DISTINCT FROM sha256(convert_to(
                       task_execution.canonical_jsonb_text(
                           NEW.canonical_payload #- '{header,payloadHash}'), 'UTF8'))
            OR NEW.specification_hash
                IS DISTINCT FROM sha256(convert_to(
                       task_execution.canonical_jsonb_text(jsonb_build_object(
                           'objective', NEW.canonical_payload->'objective',
                           'targetScope', NEW.canonical_payload->'targetScope',
                           'inputRefs', NEW.canonical_payload->'inputRefs',
                           'contextSnapshotRef', NEW.canonical_payload->'contextSnapshotRef',
                           'constraints', NEW.canonical_payload->'constraints',
                           'allowedCapabilities', NEW.canonical_payload->'allowedCapabilities',
                           'deniedCapabilities', NEW.canonical_payload->'deniedCapabilities',
                           'expectedOutputs', NEW.canonical_payload->'expectedOutputs',
                           'completionCriteria', NEW.canonical_payload->'completionCriteria',
                           'riskAndQuality', NEW.canonical_payload->'riskAndQuality',
                           'executionPolicy', NEW.canonical_payload->'executionPolicy',
                           'budget', NEW.canonical_payload->'budget',
                           'harnessPolicy', NEW.canonical_payload->'harnessPolicy',
                           'modelPolicy', NEW.canonical_payload->'modelPolicy',
                           'versionPins', NEW.canonical_payload->'versionPins')), 'UTF8')));
    EXCEPTION
        WHEN invalid_text_representation
          OR invalid_datetime_format
          OR datetime_field_overflow
          OR numeric_value_out_of_range
          OR invalid_parameter_value THEN
            mirror_mismatch := true;
    END;
    IF mirror_mismatch THEN
        RAISE EXCEPTION 'work order contract promoted mirror mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_work_order_contract_mirror() FROM PUBLIC;

CREATE TRIGGER work_order_contract_mirror_guard
    BEFORE INSERT OR UPDATE ON task_execution.work_order_contract
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_work_order_contract_mirror();

-- ---------------------------------------------------------------------------
-- Contract creation identity guard.
-- ---------------------------------------------------------------------------

-- The Contract must be written by the in-flight transaction of the very Freeze
-- it claims: `source_command_id` must name a `command_receipt` row for
-- `execution.freeze_work_order@1.0` whose target is this WorkOrder
-- (`zhiju.execution.work_order` / `work_order_id`), whose Project Scope is the
-- Contract's Scope, whose `request_payload_hash` is the Contract's
-- `request_payload_hash` and whose `outcome` is still `PENDING`. Ownership
-- closure follows V3003/V3004: the Receipt creator and the row's creator
-- column must equal `platform_security.context_principal_id()`, and a NULL
-- `context_principal_kind()` (a legacy 10-parameter context) rejects.
--
-- SECURITY INVOKER on purpose: the Receipt is read under the same RLS policies
-- and trusted Scope the writer itself is subject to, so a Receipt hidden from
-- this writer is indistinguishable from a missing one and the guard fails
-- closed instead of trusting a row the transaction may not see.
CREATE FUNCTION task_execution.guard_work_order_contract_creation_identity()
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
       AND r.command_type = 'execution.freeze_work_order';

    context_principal_id := platform_security.context_principal_id();
    context_principal_kind := platform_security.context_principal_kind();

    IF NOT FOUND
       OR receipt_outcome IS DISTINCT FROM 'PENDING'
       OR receipt_command_version IS DISTINCT FROM '1.0'
       OR receipt_target_type IS DISTINCT FROM 'zhiju.execution.work_order'
       OR receipt_target_id IS DISTINCT FROM NEW.work_order_id
       OR receipt_enterprise_id IS DISTINCT FROM NEW.enterprise_id
       OR receipt_project_id IS DISTINCT FROM NEW.project_id
       OR receipt_request_payload_hash IS DISTINCT FROM NEW.request_payload_hash
       OR context_principal_kind IS DISTINCT FROM 'SERVICE'
       OR NEW.created_by_principal_id IS DISTINCT FROM context_principal_id
       OR receipt_created_by_principal_id IS DISTINCT FROM context_principal_id THEN
        RAISE EXCEPTION 'work order contract creation identity mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_work_order_contract_creation_identity() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION task_execution.guard_work_order_contract_creation_identity()
    FROM task_execution_app;

CREATE TRIGGER work_order_contract_creation_identity_guard
    BEFORE INSERT ON task_execution.work_order_contract
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_work_order_contract_creation_identity();

-- ---------------------------------------------------------------------------
-- Contract immutability.
-- ---------------------------------------------------------------------------

-- A frozen Contract is history: it is never rewritten and never deleted (§21.3
-- - after the freeze the Contract, the Context, the DRAFT and the judgment are
-- all immutable, and the Root can only advance through the state machine). The
-- BEFORE UPDATE OR DELETE trigger is the in-database half of that rule; the
-- ACL below is the other half.
CREATE FUNCTION task_execution.guard_work_order_contract_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'work_order_contract history is immutable' USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_work_order_contract_immutable() FROM PUBLIC;

CREATE TRIGGER work_order_contract_immutable_guard
    BEFORE UPDATE OR DELETE ON task_execution.work_order_contract
    FOR EACH ROW EXECUTE FUNCTION task_execution.guard_work_order_contract_immutable();

REVOKE UPDATE, DELETE ON task_execution.work_order_contract FROM task_execution_app;

-- ---------------------------------------------------------------------------
-- WorkOrder Root: the write-once frozen pointer.
-- ---------------------------------------------------------------------------

-- `frozen_contract_id`/`frozen_contract_hash` are NULL for the whole DRAFT
-- life and are written exactly once by the Freeze CAS; the composite FK binds
-- the pointer to this very WorkOrder's Contract row and its exact payload
-- hash, so a dangling or re-labelled pointer cannot be written. The state CHECK
-- pins the §36 rule: DRAFT means both columns NULL, every later state means
-- both columns NOT NULL, and a single-column pointer can never exist.
ALTER TABLE task_execution.work_order
    ADD COLUMN frozen_contract_id uuid,
    ADD COLUMN frozen_contract_hash bytea;

ALTER TABLE task_execution.work_order
    ADD CONSTRAINT work_order_frozen_hash_len CHECK (
        frozen_contract_hash IS NULL OR octet_length(frozen_contract_hash) = 32),
    ADD CONSTRAINT work_order_frozen_pointer_state CHECK (
        (status = 'DRAFT'
            AND frozen_contract_id IS NULL
            AND frozen_contract_hash IS NULL)
        OR (status <> 'DRAFT'
            AND frozen_contract_id IS NOT NULL
            AND frozen_contract_hash IS NOT NULL)),
    ADD CONSTRAINT work_order_frozen_pointer_fk FOREIGN KEY (
        work_order_id, frozen_contract_id, frozen_contract_hash)
        REFERENCES task_execution.work_order_contract
            (work_order_id, contract_id, payload_hash)
        ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- The V3003 Root update guard is extended forward (the existing rules are kept
-- verbatim): the frozen pointer is write-once - it may move NULL -> value in
-- one version-advancing transition and can never change afterwards; a WorkOrder
-- that left DRAFT can never return to it; and once the WorkOrder is frozen the
-- draft pointer itself is immutable, so a later draft snapshot cannot be used
-- to launder a different pre-freeze draft under the same Root.
CREATE OR REPLACE FUNCTION task_execution.guard_work_order_root_update() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'work_order root is not deletable' USING ERRCODE = '23514';
    END IF;
    IF NEW.work_order_id IS DISTINCT FROM OLD.work_order_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.work_order_object_type IS DISTINCT FROM OLD.work_order_object_type
       OR NEW.task_id IS DISTINCT FROM OLD.task_id
       OR NEW.task_object_type IS DISTINCT FROM OLD.task_object_type
       OR NEW.draft_schema_version IS DISTINCT FROM OLD.draft_schema_version
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.requested_by_principal_id IS DISTINCT FROM OLD.requested_by_principal_id THEN
        RAISE EXCEPTION 'work order identity and scope are immutable' USING ERRCODE = '23514';
    END IF;
    IF (NEW.current_draft_snapshot_id, NEW.current_draft_snapshot_hash)
       IS DISTINCT FROM (OLD.current_draft_snapshot_id, OLD.current_draft_snapshot_hash) THEN
        IF NEW.aggregate_version <= OLD.aggregate_version THEN
            RAISE EXCEPTION 'work order draft pointer change must advance the aggregate version'
                USING ERRCODE = '23514';
        END IF;
        IF NOT EXISTS (
            SELECT 1
              FROM task_execution.work_order_draft_snapshot s
             WHERE s.work_order_id = NEW.work_order_id
               AND s.snapshot_id = NEW.current_draft_snapshot_id
               AND s.payload_hash = NEW.current_draft_snapshot_hash) THEN
            RAISE EXCEPTION 'work order draft pointer must reference a snapshot of this work order'
                USING ERRCODE = '23514';
        END IF;
        -- Once the WorkOrder has left DRAFT the draft it was frozen from is a
        -- creation-bound fact: re-pointing it would let a later draft snapshot
        -- masquerade as the frozen input.
        IF OLD.status <> 'DRAFT' THEN
            RAISE EXCEPTION 'work order draft pointer is frozen once the work order leaves DRAFT'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    -- The frozen pointer is write-once: NULL -> value exactly once (in the
    -- same version-advancing Freeze CAS), never value -> other value and never
    -- value -> NULL.
    IF (NEW.frozen_contract_id, NEW.frozen_contract_hash)
       IS DISTINCT FROM (OLD.frozen_contract_id, OLD.frozen_contract_hash) THEN
        IF OLD.frozen_contract_id IS NOT NULL OR OLD.frozen_contract_hash IS NOT NULL THEN
            RAISE EXCEPTION 'work order frozen contract pointer is write-once'
                USING ERRCODE = '23514';
        END IF;
        IF NEW.aggregate_version <= OLD.aggregate_version THEN
            RAISE EXCEPTION 'work order frozen pointer change must advance the aggregate version'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    -- No status regression into DRAFT: the DRAFT half of the pointer state
    -- CHECK requires NULL frozen columns, and the write-once rule above
    -- forbids clearing them, so this transition is doubly closed.
    IF OLD.status <> 'DRAFT' AND NEW.status = 'DRAFT' THEN
        RAISE EXCEPTION 'work order status cannot return to DRAFT' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION task_execution.guard_work_order_root_update() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- RLS: a frozen Contract is visible only through the exact Project scope of
-- the trusted transaction context (default-deny without a context, FORCE
-- applies to the owner as well). Creation attribution is anchored to the
-- context principal on INSERT. The `execution_judgment` policies of V3002 and
-- the `work_order` policies of V3003 are kind/state agnostic and unchanged.
-- ---------------------------------------------------------------------------

ALTER TABLE task_execution.work_order_contract ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_execution.work_order_contract FORCE ROW LEVEL SECURITY;
CREATE POLICY work_order_contract_select ON task_execution.work_order_contract
    FOR SELECT TO task_execution_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY work_order_contract_insert ON task_execution.work_order_contract
    FOR INSERT TO task_execution_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id)
        AND created_by_principal_id = platform_security.context_principal_id());

RESET ROLE;
