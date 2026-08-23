-- IM-02 WI-05: IdentityPolicy relational model (issue #33), PostgreSQL
-- Logical Model §9. Ten hand-written tables in the single owning schema
-- identity_policy. Platform security data (principal, state transitions,
-- external identity links, policy snapshots) is separated from
-- enterprise-scoped authorization rows (PG-008): no nullable enterprise_id
-- mixing; the two families use different RLS patterns from WI-03/WI-04.
-- Executed as identity_policy_owner so default privileges apply, then
-- immutable tables lose UPDATE. Cross-module references are not stored here;
-- in-module FKs only (PG-009).

SET ROLE identity_policy_owner;

-- ---------------------------------------------------------------------------
-- principal: platform Aggregate Root. Kind is immutable after creation; the
-- trigger rejects any attempt to swap it (or to rebind scope-bearing roots
-- below). Status changes append principal_state_transition facts.
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.principal (
    id uuid PRIMARY KEY,
    principal_kind text NOT NULL,
    status text NOT NULL,
    aggregate_version bigint NOT NULL DEFAULT 1,
    display_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT principal_kind_closed CHECK (
        principal_kind IN ('HUMAN', 'AGENT', 'SERVICE', 'RUNTIME', 'EXTERNAL_PARTY')),
    CONSTRAINT principal_status_closed CHECK (
        status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'ARCHIVED')),
    CONSTRAINT principal_version_positive CHECK (aggregate_version >= 1)
);

CREATE INDEX principal_status_idx ON identity_policy.principal (status, updated_at DESC);

-- One generic guard shared by the root tables: columns are compared through
-- to_jsonb so the function compiles and runs on every attached table.
CREATE FUNCTION identity_policy.guard_identity_roots_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
DECLARE
    v_old jsonb := to_jsonb(OLD);
    v_new jsonb := to_jsonb(NEW);
BEGIN
    IF TG_TABLE_NAME = 'principal'
       AND v_new->>'principal_kind' IS DISTINCT FROM v_old->>'principal_kind' THEN
        RAISE EXCEPTION 'principal kind is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'external_identity_link'
       AND (v_new->>'principal_id' IS DISTINCT FROM v_old->>'principal_id'
            OR v_new->>'provider_code' IS DISTINCT FROM v_old->>'provider_code'
            OR v_new->>'account_lookup_hash' IS DISTINCT FROM v_old->>'account_lookup_hash'
            OR v_new->>'external_id_lookup_hash' IS DISTINCT FROM v_old->>'external_id_lookup_hash') THEN
        RAISE EXCEPTION 'external identity link mapping is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME IN ('role_assignment', 'capability_grant')
       AND (v_new->>'enterprise_id' IS DISTINCT FROM v_old->>'enterprise_id'
            OR v_new->>'project_id' IS DISTINCT FROM v_old->>'project_id'
            OR v_new->>'principal_id' IS DISTINCT FROM v_old->>'principal_id') THEN
        RAISE EXCEPTION 'scope columns are immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE TRIGGER principal_identity_guard
    BEFORE UPDATE ON identity_policy.principal
    FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_identity_roots_immutable();

ALTER TABLE identity_policy.principal ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.principal FORCE ROW LEVEL SECURITY;
CREATE POLICY principal_select ON identity_policy.principal
    FOR SELECT TO identity_policy_app USING (platform_security.context_is_valid());
CREATE POLICY principal_insert ON identity_policy.principal
    FOR INSERT TO identity_policy_app WITH CHECK (platform_security.context_is_valid());
CREATE POLICY principal_update ON identity_policy.principal
    FOR UPDATE TO identity_policy_app
    USING (platform_security.context_is_valid())
    WITH CHECK (platform_security.context_is_valid());

-- ---------------------------------------------------------------------------
-- principal_state_transition: immutable appended facts.
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.principal_state_transition (
    transition_id uuid PRIMARY KEY,
    principal_id uuid NOT NULL,
    from_status text NOT NULL,
    to_status text NOT NULL,
    reason_code text NOT NULL,
    actor_snapshot_id uuid NOT NULL,
    source_command_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT principal_transition_fk FOREIGN KEY (principal_id)
        REFERENCES identity_policy.principal (id) ON DELETE RESTRICT,
    CONSTRAINT principal_transition_statuses_closed CHECK (
        from_status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'ARCHIVED')
        AND to_status IN ('ACTIVE', 'SUSPENDED', 'REVOKED', 'ARCHIVED'))
);

CREATE INDEX principal_transition_principal_idx
    ON identity_policy.principal_state_transition (principal_id, recorded_at DESC);

REVOKE UPDATE ON identity_policy.principal_state_transition FROM identity_policy_app;

ALTER TABLE identity_policy.principal_state_transition ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.principal_state_transition FORCE ROW LEVEL SECURITY;
CREATE POLICY principal_transition_select ON identity_policy.principal_state_transition
    FOR SELECT TO identity_policy_app USING (platform_security.context_is_valid());
CREATE POLICY principal_transition_insert ON identity_policy.principal_state_transition
    FOR INSERT TO identity_policy_app WITH CHECK (platform_security.context_is_valid());

-- ---------------------------------------------------------------------------
-- external_identity_link: platform Aggregate Root. Only keyed lookup hashes
-- and envelope ciphertext are stored; raw open_id/email/phone never reach
-- this table (or the logs). provider + account + subject lookup is unique;
-- conflicts must not overwrite the first mapping (IP-U-005).
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.external_identity_link (
    id uuid PRIMARY KEY,
    provider_code text NOT NULL,
    account_lookup_hash bytea NOT NULL,
    external_id_lookup_hash bytea NOT NULL,
    lookup_hash_algorithm text NOT NULL,
    lookup_key_version integer NOT NULL,
    account_ciphertext bytea NOT NULL,
    account_ciphertext_algorithm text NOT NULL,
    account_ciphertext_key_version integer NOT NULL,
    subject_ciphertext bytea NOT NULL,
    subject_ciphertext_algorithm text NOT NULL,
    subject_ciphertext_key_version integer NOT NULL,
    display_hint text,
    principal_id uuid NOT NULL,
    verified_at timestamptz NOT NULL,
    verification_method text NOT NULL,
    evidence_refs jsonb NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT external_link_lookup_hash_len CHECK (
        octet_length(account_lookup_hash) = 32 AND octet_length(external_id_lookup_hash) = 32),
    CONSTRAINT external_link_status_closed CHECK (status IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT external_link_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT external_link_lookup_unique UNIQUE
        (provider_code, account_lookup_hash, external_id_lookup_hash),
    CONSTRAINT external_link_principal_fk FOREIGN KEY (principal_id)
        REFERENCES identity_policy.principal (id) ON DELETE RESTRICT
);

CREATE INDEX external_link_principal_idx ON identity_policy.external_identity_link (principal_id);
CREATE INDEX external_link_key_version_idx
    ON identity_policy.external_identity_link (lookup_key_version);

CREATE TRIGGER external_link_identity_guard
    BEFORE UPDATE ON identity_policy.external_identity_link
    FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_identity_roots_immutable();

ALTER TABLE identity_policy.external_identity_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.external_identity_link FORCE ROW LEVEL SECURITY;
CREATE POLICY external_link_select ON identity_policy.external_identity_link
    FOR SELECT TO identity_policy_app USING (platform_security.context_is_valid());
CREATE POLICY external_link_insert ON identity_policy.external_identity_link
    FOR INSERT TO identity_policy_app WITH CHECK (platform_security.context_is_valid());
CREATE POLICY external_link_update ON identity_policy.external_identity_link
    FOR UPDATE TO identity_policy_app
    USING (platform_security.context_is_valid())
    WITH CHECK (platform_security.context_is_valid());

-- ---------------------------------------------------------------------------
-- role_assignment: enterprise Aggregate Root with exact Enterprise/Project
-- scope. One ACTIVE assignment per (principal, role, scope); revocation
-- appends a fact instead of deleting.
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.role_assignment (
    id uuid PRIMARY KEY,
    principal_id uuid NOT NULL,
    role_code text NOT NULL,
    scope_kind text NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
    justification text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT role_assignment_scope_closed CHECK (scope_kind IN ('ENTERPRISE', 'PROJECT')),
    CONSTRAINT role_assignment_status_closed CHECK (status IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT role_assignment_period CHECK (valid_to IS NULL OR valid_to > valid_from),
    CONSTRAINT role_assignment_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT role_assignment_principal_fk FOREIGN KEY (principal_id)
        REFERENCES identity_policy.principal (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX role_assignment_active_unique
    ON identity_policy.role_assignment (principal_id, role_code, enterprise_id, project_id)
    NULLS NOT DISTINCT
    WHERE status = 'ACTIVE';
CREATE INDEX role_assignment_lookup_idx
    ON identity_policy.role_assignment (principal_id, enterprise_id, status);
CREATE INDEX role_assignment_expiry_idx
    ON identity_policy.role_assignment (valid_to) WHERE status = 'ACTIVE';

CREATE TRIGGER role_assignment_identity_guard
    BEFORE UPDATE ON identity_policy.role_assignment
    FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_identity_roots_immutable();

ALTER TABLE identity_policy.role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.role_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY role_assignment_select ON identity_policy.role_assignment
    FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY role_assignment_insert ON identity_policy.role_assignment
    FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY role_assignment_update ON identity_policy.role_assignment
    FOR UPDATE TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id))
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

CREATE TABLE identity_policy.role_revocation (
    revocation_id uuid PRIMARY KEY,
    role_assignment_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    revoked_by_principal_id uuid NOT NULL,
    reason_code text NOT NULL,
    effective_at timestamptz NOT NULL,
    actor_snapshot_id uuid NOT NULL,
    source_command_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT role_revocation_assignment_fk FOREIGN KEY (role_assignment_id)
        REFERENCES identity_policy.role_assignment (id) ON DELETE RESTRICT,
    CONSTRAINT role_revocation_once UNIQUE (role_assignment_id)
);

REVOKE UPDATE ON identity_policy.role_revocation FROM identity_policy_app;

ALTER TABLE identity_policy.role_revocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.role_revocation FORCE ROW LEVEL SECURITY;
CREATE POLICY role_revocation_select ON identity_policy.role_revocation
    FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY role_revocation_insert ON identity_policy.role_revocation
    FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

-- ---------------------------------------------------------------------------
-- capability_grant: enterprise Aggregate Root. Human-only enforcement is a
-- static registry decision in the application layer (WI-08); the database
-- keeps the exact scope, period and grant-policy reference.
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.capability_grant (
    id uuid PRIMARY KEY,
    principal_id uuid NOT NULL,
    capability_code text NOT NULL,
    scope_kind text NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    resource_selectors jsonb NOT NULL,
    actions text[] NOT NULL,
    constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
    valid_from timestamptz NOT NULL,
    valid_to timestamptz,
    max_uses integer,
    grant_policy_snapshot_id uuid NOT NULL,
    grant_policy_snapshot_hash bytea NOT NULL,
    justification text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT capability_grant_scope_closed CHECK (scope_kind IN ('ENTERPRISE', 'PROJECT')),
    CONSTRAINT capability_grant_status_closed CHECK (status IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT capability_grant_period CHECK (valid_to IS NULL OR valid_to > valid_from),
    CONSTRAINT capability_grant_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT capability_grant_actions_nonempty CHECK (array_length(actions, 1) >= 1),
    CONSTRAINT capability_grant_policy_hash_len CHECK (octet_length(grant_policy_snapshot_hash) = 32),
    CONSTRAINT capability_grant_max_uses CHECK (max_uses IS NULL OR max_uses >= 1),
    CONSTRAINT capability_grant_principal_fk FOREIGN KEY (principal_id)
        REFERENCES identity_policy.principal (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX capability_grant_active_unique
    ON identity_policy.capability_grant (principal_id, capability_code, enterprise_id, project_id)
    NULLS NOT DISTINCT
    WHERE status = 'ACTIVE';
CREATE INDEX capability_grant_lookup_idx
    ON identity_policy.capability_grant (principal_id, enterprise_id, status);
CREATE INDEX capability_grant_expiry_idx
    ON identity_policy.capability_grant (valid_to) WHERE status = 'ACTIVE';

CREATE TRIGGER capability_grant_identity_guard
    BEFORE UPDATE ON identity_policy.capability_grant
    FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_identity_roots_immutable();

ALTER TABLE identity_policy.capability_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.capability_grant FORCE ROW LEVEL SECURITY;
CREATE POLICY capability_grant_select ON identity_policy.capability_grant
    FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY capability_grant_insert ON identity_policy.capability_grant
    FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY capability_grant_update ON identity_policy.capability_grant
    FOR UPDATE TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id))
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

CREATE TABLE identity_policy.capability_revocation (
    revocation_id uuid PRIMARY KEY,
    capability_grant_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    revoked_by_principal_id uuid NOT NULL,
    reason_code text NOT NULL,
    effective_at timestamptz NOT NULL,
    actor_snapshot_id uuid NOT NULL,
    source_command_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT capability_revocation_grant_fk FOREIGN KEY (capability_grant_id)
        REFERENCES identity_policy.capability_grant (id) ON DELETE RESTRICT,
    CONSTRAINT capability_revocation_once UNIQUE (capability_grant_id)
);

REVOKE UPDATE ON identity_policy.capability_revocation FROM identity_policy_app;

ALTER TABLE identity_policy.capability_revocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.capability_revocation FORCE ROW LEVEL SECURITY;
CREATE POLICY capability_revocation_select ON identity_policy.capability_revocation
    FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY capability_revocation_insert ON identity_policy.capability_revocation
    FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

-- ---------------------------------------------------------------------------
-- policy_snapshot: platform Immutable Contract (§8.1 header). Build-time
-- registry-resolvable; promoted policy_set_version/effective_from must mirror
-- the canonical payload (trigger).
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.policy_snapshot (
    policy_snapshot_id uuid PRIMARY KEY,
    policy_set_version text NOT NULL,
    policy_schema_refs jsonb NOT NULL,
    effective_from timestamptz NOT NULL,
    superseded_at timestamptz,
    contract_type text NOT NULL,
    contract_version text NOT NULL,
    schema_registry_version text NOT NULL,
    canonicalization_version text NOT NULL,
    payload_hash_algorithm text NOT NULL,
    payload_hash bytea NOT NULL,
    payload_size_bytes bigint NOT NULL,
    canonical_payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    actor_snapshot_id uuid NOT NULL,
    source_command_id uuid NOT NULL,
    data_classification text NOT NULL,
    retention_class text NOT NULL,
    CONSTRAINT policy_snapshot_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT policy_snapshot_size_nonnegative CHECK (payload_size_bytes >= 0),
    CONSTRAINT policy_snapshot_set_unique UNIQUE (policy_set_version)
);

CREATE INDEX policy_snapshot_effective_idx
    ON identity_policy.policy_snapshot (effective_from DESC);

-- The grant policy reference binds a capability grant to the exact policy
-- snapshot it was granted under (in-schema FK; added once the referenced
-- table exists).
ALTER TABLE identity_policy.capability_grant
    ADD CONSTRAINT capability_grant_policy_fk FOREIGN KEY (grant_policy_snapshot_id)
    REFERENCES identity_policy.policy_snapshot (policy_snapshot_id) ON DELETE RESTRICT;

CREATE FUNCTION identity_policy.guard_policy_snapshot_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $mirror$
BEGIN
    IF NEW.canonical_payload->>'policySetVersion' IS DISTINCT FROM NEW.policy_set_version THEN
        RAISE EXCEPTION 'policy snapshot promoted mirror mismatch: policySetVersion'
            USING ERRCODE = '22023';
    END IF;
    IF (NEW.canonical_payload->>'effectiveFrom')::timestamptz IS DISTINCT FROM NEW.effective_from THEN
        RAISE EXCEPTION 'policy snapshot promoted mirror mismatch: effectiveFrom'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$mirror$;

CREATE TRIGGER policy_snapshot_mirror_guard
    BEFORE INSERT OR UPDATE ON identity_policy.policy_snapshot
    FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_policy_snapshot_mirror();

REVOKE UPDATE ON identity_policy.policy_snapshot FROM identity_policy_app;

ALTER TABLE identity_policy.policy_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.policy_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY policy_snapshot_select ON identity_policy.policy_snapshot
    FOR SELECT TO identity_policy_app USING (platform_security.context_is_valid());
CREATE POLICY policy_snapshot_insert ON identity_policy.policy_snapshot
    FOR INSERT TO identity_policy_app WITH CHECK (platform_security.context_is_valid());

-- ---------------------------------------------------------------------------
-- actor_snapshot: enterprise Immutable Contract. actingFor never changes the
-- actor principal kind (promoted mirror guard).
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.actor_snapshot (
    actor_snapshot_id uuid PRIMARY KEY,
    principal_id uuid NOT NULL,
    principal_kind text NOT NULL,
    acting_for_principal_id uuid,
    acting_for_kind text,
    channel_code text,
    runtime_source text,
    authentication_context_hash bytea NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    contract_type text NOT NULL,
    contract_version text NOT NULL,
    canonicalization_version text NOT NULL,
    payload_hash_algorithm text NOT NULL,
    payload_hash bytea NOT NULL,
    payload_size_bytes bigint NOT NULL,
    canonical_payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    source_command_id uuid NOT NULL,
    retention_class text NOT NULL,
    CONSTRAINT actor_snapshot_kind_closed CHECK (
        principal_kind IN ('HUMAN', 'AGENT', 'SERVICE', 'RUNTIME', 'EXTERNAL_PARTY')),
    CONSTRAINT actor_snapshot_acting_for_shape CHECK (
        (acting_for_principal_id IS NULL AND acting_for_kind IS NULL)
        OR (acting_for_principal_id IS NOT NULL AND acting_for_kind IS NOT NULL)),
    CONSTRAINT actor_snapshot_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT actor_snapshot_auth_hash_len CHECK (octet_length(authentication_context_hash) = 32),
    CONSTRAINT actor_snapshot_principal_fk FOREIGN KEY (principal_id)
        REFERENCES identity_policy.principal (id) ON DELETE RESTRICT
);

CREATE INDEX actor_snapshot_principal_idx ON identity_policy.actor_snapshot (principal_id);
CREATE INDEX actor_snapshot_enterprise_idx
    ON identity_policy.actor_snapshot (enterprise_id, created_at DESC);

CREATE FUNCTION identity_policy.guard_actor_snapshot_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $mirror$
BEGIN
    IF NEW.canonical_payload->>'principalKind' IS DISTINCT FROM NEW.principal_kind THEN
        RAISE EXCEPTION 'actor snapshot promoted mirror mismatch: principalKind'
            USING ERRCODE = '22023';
    END IF;
    IF NEW.canonical_payload->>'enterpriseId' IS DISTINCT FROM NEW.enterprise_id::text THEN
        RAISE EXCEPTION 'actor snapshot promoted mirror mismatch: enterpriseId'
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END
$mirror$;

CREATE TRIGGER actor_snapshot_mirror_guard
    BEFORE INSERT OR UPDATE ON identity_policy.actor_snapshot
    FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_actor_snapshot_mirror();

REVOKE UPDATE ON identity_policy.actor_snapshot FROM identity_policy_app;

ALTER TABLE identity_policy.actor_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.actor_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY actor_snapshot_select ON identity_policy.actor_snapshot
    FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY actor_snapshot_insert ON identity_policy.actor_snapshot
    FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

-- ---------------------------------------------------------------------------
-- authorization_decision: enterprise Immutable Contract, ALLOW/DENY, bound
-- to the exact actor snapshot, command intent, scope/purpose, payload hash
-- and policy snapshot; expires_at is checked by readers.
-- ---------------------------------------------------------------------------

CREATE TABLE identity_policy.authorization_decision (
    authorization_decision_id uuid PRIMARY KEY,
    actor_snapshot_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    principal_kind text NOT NULL,
    outcome text NOT NULL,
    reason_codes text[] NOT NULL,
    command_type text NOT NULL,
    command_version text NOT NULL,
    scope_kind text NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid,
    purpose text NOT NULL,
    requested_capability text NOT NULL,
    command_payload_hash bytea NOT NULL,
    policy_snapshot_id uuid NOT NULL,
    policy_snapshot_payload_hash bytea NOT NULL,
    authentication_context_hash bytea NOT NULL,
    expires_at timestamptz NOT NULL,
    contract_type text NOT NULL,
    contract_version text NOT NULL,
    canonicalization_version text NOT NULL,
    payload_hash_algorithm text NOT NULL,
    payload_hash bytea NOT NULL,
    payload_size_bytes bigint NOT NULL,
    canonical_payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    source_command_id uuid NOT NULL,
    retention_class text NOT NULL,
    CONSTRAINT authorization_decision_outcome_closed CHECK (outcome IN ('ALLOW', 'DENY')),
    CONSTRAINT authorization_decision_kind_closed CHECK (
        principal_kind IN ('HUMAN', 'AGENT', 'SERVICE', 'RUNTIME', 'EXTERNAL_PARTY')),
    CONSTRAINT authorization_decision_scope_closed CHECK (
        scope_kind IN ('ENTERPRISE', 'PROJECT')),
    CONSTRAINT authorization_decision_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT authorization_decision_command_hash_len CHECK (
        octet_length(command_payload_hash) = 32),
    CONSTRAINT authorization_decision_policy_hash_len CHECK (
        octet_length(policy_snapshot_payload_hash) = 32),
    CONSTRAINT authorization_decision_auth_hash_len CHECK (
        octet_length(authentication_context_hash) = 32),
    CONSTRAINT authorization_decision_actor_fk FOREIGN KEY (actor_snapshot_id)
        REFERENCES identity_policy.actor_snapshot (actor_snapshot_id) ON DELETE RESTRICT,
    CONSTRAINT authorization_decision_policy_fk FOREIGN KEY (policy_snapshot_id)
        REFERENCES identity_policy.policy_snapshot (policy_snapshot_id) ON DELETE RESTRICT,
    CONSTRAINT authorization_decision_principal_fk FOREIGN KEY (principal_id)
        REFERENCES identity_policy.principal (id) ON DELETE RESTRICT
);

CREATE INDEX authorization_decision_actor_idx
    ON identity_policy.authorization_decision (actor_snapshot_id);
CREATE INDEX authorization_decision_lookup_idx
    ON identity_policy.authorization_decision (authorization_decision_id, payload_hash);
CREATE INDEX authorization_decision_principal_scope_idx
    ON identity_policy.authorization_decision (principal_id, enterprise_id, outcome);
CREATE INDEX authorization_decision_expiry_idx
    ON identity_policy.authorization_decision (expires_at) WHERE outcome = 'ALLOW';

CREATE FUNCTION identity_policy.guard_authorization_decision_mirror() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $mirror$
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
    RETURN NEW;
END
$mirror$;

CREATE TRIGGER authorization_decision_mirror_guard
    BEFORE INSERT OR UPDATE ON identity_policy.authorization_decision
    FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_authorization_decision_mirror();

REVOKE UPDATE ON identity_policy.authorization_decision FROM identity_policy_app;

ALTER TABLE identity_policy.authorization_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.authorization_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY authorization_decision_select ON identity_policy.authorization_decision
    FOR SELECT TO identity_policy_app
    USING (platform_security.context_allows_enterprise(enterprise_id));
CREATE POLICY authorization_decision_insert ON identity_policy.authorization_decision
    FOR INSERT TO identity_policy_app
    WITH CHECK (platform_security.context_allows_enterprise(enterprise_id));

RESET ROLE;
