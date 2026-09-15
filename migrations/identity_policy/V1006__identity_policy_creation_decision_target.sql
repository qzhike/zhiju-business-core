-- IM-06 (#200): AuthorizationDecision target binding.
-- Design authority: Module-Spec-001 §15, PostgreSQL logical model §33
-- (IM06-AUTH-01, APPROVED 2026-09-15), decisions §14.
--
-- The four version-bound creation versions (`execution.create_task@1.0/@2.0`
-- and `execution.create_work_order@1.0/@1.1`) are authorized by Decisions that
-- bind the exact CREATE target. The target enters the canonical payload as
-- `targetRef` and is mirrored into these two columns, so a promoted row and its
-- integrity hash cannot describe different targets.
--
-- Forward-only and additive: historical and generic decisions keep NULL mirrors
-- and stay readable with their original payload hash; they simply never
-- authorize one of the four creation versions. The pair constraint keeps the
-- mirrors all-or-nothing, and the replaced mirror guard rejects a payload
-- without `targetRef` next to promoted target columns (and vice versa).
--
-- Executed as identity_policy_owner so the WI-02 default privileges apply
-- (SELECT/INSERT to the app role); UPDATE stays revoked from the app role.

SET ROLE identity_policy_owner;

ALTER TABLE identity_policy.authorization_decision
    ADD COLUMN target_object_type text,
    ADD COLUMN target_object_id uuid,
    ADD CONSTRAINT authorization_decision_target_pair CHECK (
        (target_object_type IS NULL) = (target_object_id IS NULL));

CREATE OR REPLACE FUNCTION identity_policy.guard_authorization_decision_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $mirror$
DECLARE
    v_actor identity_policy.actor_snapshot%ROWTYPE;
    v_policy_hash bytea;
BEGIN
    IF NEW.canonical_payload->>'outcome' IS DISTINCT FROM NEW.outcome THEN
        RAISE EXCEPTION 'authorization decision promoted mirror mismatch: outcome'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.canonical_payload->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text THEN
        RAISE EXCEPTION 'authorization decision promoted mirror mismatch: enterpriseId'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.canonical_payload->>'commandType' IS DISTINCT FROM NEW.command_type THEN
        RAISE EXCEPTION 'authorization decision promoted mirror mismatch: commandType'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.canonical_payload->>'actorSnapshotId' IS DISTINCT FROM NEW.actor_snapshot_id::text
       OR NEW.canonical_payload->>'actorSnapshotPayloadHash'
          IS DISTINCT FROM encode(NEW.actor_snapshot_payload_hash, 'hex')
       OR NEW.canonical_payload->>'policySnapshotId' IS DISTINCT FROM NEW.policy_snapshot_id::text
       OR NEW.canonical_payload->>'policySnapshotPayloadHash'
          IS DISTINCT FROM encode(NEW.policy_snapshot_payload_hash, 'hex') THEN
        RAISE EXCEPTION 'authorization decision promoted mirror mismatch: snapshot reference'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.canonical_payload->>'principalId' IS DISTINCT FROM NEW.principal_id::text
       OR NEW.canonical_payload->>'principalKind' IS DISTINCT FROM NEW.principal_kind
       OR NEW.canonical_payload->>'commandVersion' IS DISTINCT FROM NEW.command_version
       OR NEW.canonical_payload->>'scopeKind' IS DISTINCT FROM NEW.scope_kind
       OR NEW.canonical_payload->>'projectId' IS DISTINCT FROM NEW.project_id::text
       OR NEW.canonical_payload->>'purpose' IS DISTINCT FROM NEW.purpose
       OR NEW.canonical_payload->>'requestedCapability' IS DISTINCT FROM NEW.requested_capability
       OR NEW.canonical_payload->>'commandPayloadHash'
          IS DISTINCT FROM encode(NEW.command_payload_hash, 'hex')
       OR NEW.canonical_payload->>'authenticationContextHash'
          IS DISTINCT FROM encode(NEW.authentication_context_hash, 'hex')
       OR (NEW.canonical_payload->>'expiresAt')::timestamptz IS DISTINCT FROM NEW.expires_at THEN
        RAISE EXCEPTION 'authorization decision promoted mirror mismatch: intent or scope'
            USING ERRCODE = '22023';
    END IF;

    -- IM-06 (#200) target binding: the promoted target columns and the payload
    -- `targetRef` (object type, object id and the Decision's own Project Scope)
    -- are one fact. Without promoted target columns the payload must not carry
    -- a targetRef at all.
    IF NEW.target_object_type IS NULL AND NEW.target_object_id IS NULL THEN
        IF NEW.canonical_payload ? 'targetRef' THEN
            RAISE EXCEPTION 'authorization decision promoted mirror mismatch: targetRef'
                USING ERRCODE = '22023';
        END IF;
    ELSIF NEW.canonical_payload->'targetRef'->>'objectType'
          IS DISTINCT FROM NEW.target_object_type
       OR NEW.canonical_payload->'targetRef'->>'objectId'
          IS DISTINCT FROM NEW.target_object_id::text
       OR NEW.canonical_payload->'targetRef'->'scope'->>'enterpriseId'
          IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.canonical_payload->'targetRef'->'scope'->>'projectId'
          IS DISTINCT FROM NEW.project_id::text THEN
        RAISE EXCEPTION 'authorization decision promoted mirror mismatch: targetRef'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_actor
      FROM identity_policy.actor_snapshot
     WHERE actor_snapshot_id = NEW.actor_snapshot_id;
    IF FOUND AND (
        NEW.actor_snapshot_payload_hash IS DISTINCT FROM v_actor.payload_hash
        OR NEW.principal_id IS DISTINCT FROM v_actor.principal_id
        OR NEW.principal_kind IS DISTINCT FROM v_actor.principal_kind
        OR NEW.authentication_context_hash IS DISTINCT FROM v_actor.authentication_context_hash
        OR NEW.enterprise_id IS DISTINCT FROM v_actor.enterprise_id
        OR (v_actor.project_id IS NOT NULL AND NEW.project_id IS DISTINCT FROM v_actor.project_id)
    ) THEN
        RAISE EXCEPTION 'authorization decision does not match actor snapshot'
            USING ERRCODE = '23514';
    END IF;

    SELECT payload_hash INTO v_policy_hash
      FROM identity_policy.policy_snapshot
     WHERE policy_snapshot_id = NEW.policy_snapshot_id;
    IF FOUND AND NEW.policy_snapshot_payload_hash IS DISTINCT FROM v_policy_hash THEN
        RAISE EXCEPTION 'authorization decision policy hash does not match snapshot'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$mirror$;

RESET ROLE;
