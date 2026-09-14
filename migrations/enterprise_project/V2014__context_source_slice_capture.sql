-- IM-06 (#188): Project-owned Context Source Slice aggregate.
-- Design authority: Module-Spec-002 IM-06 Source Slice design, #157 registration
-- metadata, #176 capture policy resolution, PostgreSQL logical model §33.
--
-- A Context Source Slice is an immutable capture of the Project's already
-- committed owning facts, trimmed by the owning Source Query rules, plus the
-- exact Policy resolution observation that bounded its validity. The Slice
-- payload is content addressed; the promoted columns and the ancillary Policy
-- observation are guarded in SQL so a direct write cannot publish a Slice whose
-- payload disagrees with its own identity, scope or captured validity.
--
-- The table is INSERT-only for the application role: a Slice is never updated
-- and never deleted, and later source or Policy changes must be expressed by a
-- new Slice with a new key rather than by rewriting history.

SET ROLE enterprise_project_owner;

-- ---------------------------------------------------------------------------
-- context_source_slice: immutable content-addressed capture fact.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.context_source_slice (
    slice_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    purpose text NOT NULL,
    audience_ref jsonb NOT NULL,
    capture_policy_ref jsonb NOT NULL,
    captured_at timestamptz NOT NULL,
    valid_until timestamptz NOT NULL,
    slice_payload jsonb NOT NULL,
    slice_payload_hash bytea NOT NULL,
    policy_version_ref jsonb NOT NULL,
    policy_set_version text NOT NULL,
    policy_content_hash bytea NOT NULL,
    policy_effective_from timestamptz NOT NULL,
    policy_superseded_at timestamptz,
    policy_checked_at timestamptz NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    source_command_id uuid NOT NULL,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT context_source_slice_scope_unique
        UNIQUE (enterprise_id, project_id, slice_id),
    CONSTRAINT context_source_slice_payload_hash_len CHECK (
        octet_length(slice_payload_hash) = 32),
    CONSTRAINT context_source_slice_policy_hash_len CHECK (
        octet_length(policy_content_hash) = 32),
    CONSTRAINT context_source_slice_validity_positive CHECK (valid_until > captured_at),
    CONSTRAINT context_source_slice_observation_order CHECK (policy_checked_at <= captured_at),
    CONSTRAINT context_source_slice_policy_supersede_order CHECK (
        policy_superseded_at IS NULL OR policy_superseded_at > policy_effective_from),
    CONSTRAINT context_source_slice_text_nonempty CHECK (
        length(purpose) > 0
        AND length(policy_set_version) > 0
        AND length(canonicalization_version) > 0
        AND length(retention_class) > 0)
);

ALTER TABLE enterprise_project.context_source_slice
    ADD CONSTRAINT context_source_slice_project_fk
    FOREIGN KEY (enterprise_id, project_id)
    REFERENCES enterprise_project.project (enterprise_id, project_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX context_source_slice_project_captured_idx
    ON enterprise_project.context_source_slice
        (enterprise_id, project_id, captured_at, slice_id);

-- The stored payload, its content address and the promoted columns must agree:
-- a Slice cannot be published under a scope, purpose, policy key or validity
-- window that its own canonical payload does not carry. Timestamp comparison is
-- done on the canonical millisecond ISO text the application writes, so a
-- malformed or partial instant is rejected instead of silently cast.
CREATE FUNCTION enterprise_project.guard_context_source_slice_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.slice_payload->>'sliceId' IS DISTINCT FROM NEW.slice_id::text
       OR NEW.slice_payload->>'purpose' IS DISTINCT FROM NEW.purpose
       OR NEW.slice_payload->>'capturedAt'
          IS DISTINCT FROM to_char(NEW.captured_at AT TIME ZONE 'UTC',
                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       OR NEW.slice_payload->>'validUntil'
          IS DISTINCT FROM to_char(NEW.valid_until AT TIME ZONE 'UTC',
                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       OR NEW.slice_payload->'audience' IS DISTINCT FROM NEW.audience_ref
       OR NEW.slice_payload->'capturePolicyRef' IS DISTINCT FROM NEW.capture_policy_ref
       OR NEW.slice_payload->'scopeRef'->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.slice_payload->'scopeRef'->>'projectId' IS DISTINCT FROM NEW.project_id::text
       OR NEW.slice_payload->'projectRef'->'scope'->>'enterpriseId'
          IS DISTINCT FROM NEW.enterprise_id::text
       OR NEW.slice_payload->'projectRef'->'scope'->>'projectId'
          IS DISTINCT FROM NEW.project_id::text
       OR NEW.slice_payload->'projectRef'->>'objectId' IS DISTINCT FROM NEW.project_id::text THEN
        RAISE EXCEPTION 'context_source_slice promoted mirror mismatch'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_context_source_slice_mirror() FROM PUBLIC;

CREATE TRIGGER context_source_slice_mirror_guard
    BEFORE INSERT OR UPDATE ON enterprise_project.context_source_slice
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_context_source_slice_mirror();

-- A committed Slice and its Policy observation are immutable history.
CREATE FUNCTION enterprise_project.guard_context_source_slice_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    RAISE EXCEPTION 'context_source_slice is immutable'
        USING ERRCODE = '23514';
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_context_source_slice_immutable() FROM PUBLIC;

CREATE TRIGGER context_source_slice_immutable_guard
    BEFORE UPDATE ON enterprise_project.context_source_slice
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_context_source_slice_immutable();

REVOKE UPDATE, DELETE ON enterprise_project.context_source_slice FROM enterprise_project_app;

-- ---------------------------------------------------------------------------
-- Grants and Project RLS. A Slice is only reachable inside an explicitly
-- established Project context; an Enterprise-only context cannot read it and
-- no Project can enumerate another Project's captures.
-- ---------------------------------------------------------------------------

ALTER TABLE enterprise_project.context_source_slice ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.context_source_slice FORCE ROW LEVEL SECURITY;
CREATE POLICY context_source_slice_select ON enterprise_project.context_source_slice
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY context_source_slice_insert ON enterprise_project.context_source_slice
    FOR INSERT TO enterprise_project_app
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

RESET ROLE;
