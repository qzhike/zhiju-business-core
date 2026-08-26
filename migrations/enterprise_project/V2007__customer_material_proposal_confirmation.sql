-- IM-03 WI-06 (issue #62): Project-owned CustomerMaterial proposal,
-- confirmation and immutable version history.
--
-- CustomerMaterial is deliberately separate from SourceMaterial. A source
-- may participate in more than one candidate classification, while each
-- candidate and confirmation decision remains an immutable, exact record.
-- The application validates canonical payload/hash equality and exact source
-- references; PostgreSQL owns scope, pointer, lifecycle and immutability
-- invariants.

SET ROLE enterprise_project_owner;

-- ---------------------------------------------------------------------------
-- customer_material: Project-owned classification aggregate root.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.customer_material (
    customer_material_id uuid PRIMARY KEY,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    material_type text NOT NULL,
    title text NOT NULL,
    customer_document_number text,
    customer_version_label text,
    effective_date date,
    declared_status text NOT NULL DEFAULT 'PROPOSED',
    completeness text NOT NULL DEFAULT 'UNKNOWN',
    classification_status text NOT NULL DEFAULT 'PROPOSED',
    current_version_id uuid NOT NULL,
    aggregate_version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by_principal_id uuid NOT NULL,
    created_by_actor_snapshot_id uuid NOT NULL,
    confirmed_by_principal_id uuid,
    confirmed_by_actor_snapshot_id uuid,
    confirmed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_command_id uuid,
    retention_class text NOT NULL DEFAULT 'CUSTOMER_RECORD',
    CONSTRAINT customer_material_scope_unique
        UNIQUE (enterprise_id, project_id, customer_material_id),
    CONSTRAINT customer_material_status_closed CHECK (
        classification_status IN ('PROPOSED', 'UNDER_REVIEW', 'CONFIRMED',
                                  'DISPUTED', 'REJECTED', 'NOT_CURRENT', 'SUPERSEDED')),
    CONSTRAINT customer_material_completeness_closed CHECK (
        completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN', 'UNREADABLE')),
    CONSTRAINT customer_material_version_positive CHECK (aggregate_version >= 1),
    CONSTRAINT customer_material_text_nonempty CHECK (
        length(material_type) > 0
        AND length(title) > 0
        AND length(declared_status) > 0
        AND length(retention_class) > 0),
    CONSTRAINT customer_material_confirmed_shape CHECK (
        ((classification_status IN ('CONFIRMED', 'NOT_CURRENT', 'SUPERSEDED')
          AND confirmed_by_principal_id IS NOT NULL
          AND confirmed_by_actor_snapshot_id IS NOT NULL
          AND confirmed_at IS NOT NULL)
         OR (classification_status NOT IN ('CONFIRMED', 'NOT_CURRENT', 'SUPERSEDED')
             AND confirmed_by_principal_id IS NULL
             AND confirmed_by_actor_snapshot_id IS NULL
             AND confirmed_at IS NULL)))
);

ALTER TABLE enterprise_project.customer_material
    ADD CONSTRAINT customer_material_project_fk
    FOREIGN KEY (enterprise_id, project_id)
    REFERENCES enterprise_project.project (enterprise_id, project_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX customer_material_project_status_idx
    ON enterprise_project.customer_material
        (enterprise_id, project_id, classification_status, updated_at DESC);

-- ---------------------------------------------------------------------------
-- customer_material_version: immutable classification candidates/decisions.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.customer_material_version (
    version_id uuid PRIMARY KEY,
    customer_material_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    version_no integer NOT NULL,
    version_status text NOT NULL,
    material_type text NOT NULL,
    title text NOT NULL,
    customer_document_number text,
    customer_version_label text,
    effective_date date,
    declared_status text NOT NULL,
    completeness text NOT NULL,
    source_selections jsonb NOT NULL,
    language text NOT NULL,
    classification_rationale jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    proposed_by_principal_id uuid NOT NULL,
    proposed_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    previous_version_id uuid,
    CONSTRAINT customer_material_version_scope_unique
        UNIQUE (enterprise_id, project_id, customer_material_id, version_id),
    CONSTRAINT customer_material_version_no_unique
        UNIQUE (customer_material_id, version_no),
    CONSTRAINT customer_material_version_status_closed CHECK (
        version_status IN ('PROPOSED', 'CONFIRMED')),
    CONSTRAINT customer_material_version_no_positive CHECK (version_no >= 1),
    CONSTRAINT customer_material_version_completeness_closed CHECK (
        completeness IN ('COMPLETE', 'PARTIAL', 'UNKNOWN', 'UNREADABLE')),
    CONSTRAINT customer_material_version_hash_len CHECK (octet_length(payload_hash) = 32),
    CONSTRAINT customer_material_version_text_nonempty CHECK (
        length(material_type) > 0
        AND length(title) > 0
        AND length(declared_status) > 0
        AND length(language) > 0),
    CONSTRAINT customer_material_version_previous_not_self CHECK (
        previous_version_id IS NULL OR previous_version_id <> version_id)
);

ALTER TABLE enterprise_project.customer_material_version
    ADD CONSTRAINT customer_material_version_root_fk
    FOREIGN KEY (enterprise_id, project_id, customer_material_id)
    REFERENCES enterprise_project.customer_material
        (enterprise_id, project_id, customer_material_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.customer_material_version
    ADD CONSTRAINT customer_material_version_previous_fk
    FOREIGN KEY (enterprise_id, project_id, customer_material_id, previous_version_id)
    REFERENCES enterprise_project.customer_material_version
        (enterprise_id, project_id, customer_material_id, version_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX customer_material_version_root_idx
    ON enterprise_project.customer_material_version
        (customer_material_id, version_no DESC);
CREATE INDEX customer_material_version_project_idx
    ON enterprise_project.customer_material_version
        (enterprise_id, project_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- customer_material_decision: immutable proposal/confirmation facts.
-- ---------------------------------------------------------------------------

CREATE TABLE enterprise_project.customer_material_decision (
    decision_id uuid PRIMARY KEY,
    customer_material_id uuid NOT NULL,
    version_id uuid NOT NULL,
    enterprise_id uuid NOT NULL,
    project_id uuid NOT NULL,
    decision_kind text NOT NULL,
    evidence_refs jsonb NOT NULL,
    justification jsonb NOT NULL,
    payload jsonb NOT NULL,
    payload_hash bytea NOT NULL,
    canonicalization_version text NOT NULL DEFAULT '1',
    decided_by_principal_id uuid NOT NULL,
    decided_by_actor_snapshot_id uuid NOT NULL,
    authorization_decision_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    source_command_id uuid NOT NULL,
    CONSTRAINT customer_material_decision_scope_unique
        UNIQUE (enterprise_id, project_id, decision_id),
    CONSTRAINT customer_material_decision_kind_closed CHECK (
        decision_kind IN ('PROPOSED', 'CONFIRMED', 'DISPUTED', 'REJECTED')),
    CONSTRAINT customer_material_decision_hash_len CHECK (octet_length(payload_hash) = 32)
);

ALTER TABLE enterprise_project.customer_material_decision
    ADD CONSTRAINT customer_material_decision_root_fk
    FOREIGN KEY (enterprise_id, project_id, customer_material_id)
    REFERENCES enterprise_project.customer_material
        (enterprise_id, project_id, customer_material_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE enterprise_project.customer_material_decision
    ADD CONSTRAINT customer_material_decision_version_fk
    FOREIGN KEY (enterprise_id, project_id, customer_material_id, version_id)
    REFERENCES enterprise_project.customer_material_version
        (enterprise_id, project_id, customer_material_id, version_id)
    ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX customer_material_decision_root_idx
    ON enterprise_project.customer_material_decision
        (customer_material_id, recorded_at DESC, decision_id);

-- ---------------------------------------------------------------------------
-- Immutability and controlled root transitions.
-- ---------------------------------------------------------------------------

CREATE FUNCTION enterprise_project.guard_customer_material_root() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.customer_material_id IS DISTINCT FROM OLD.customer_material_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.material_type IS DISTINCT FROM OLD.material_type
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.customer_document_number IS DISTINCT FROM OLD.customer_document_number
       OR NEW.customer_version_label IS DISTINCT FROM OLD.customer_version_label
       OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
       OR NEW.created_by_actor_snapshot_id IS DISTINCT FROM OLD.created_by_actor_snapshot_id
       OR NEW.retention_class IS DISTINCT FROM OLD.retention_class THEN
        RAISE EXCEPTION 'customer_material identity and classification seed are immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.aggregate_version <> OLD.aggregate_version + 1 THEN
        RAISE EXCEPTION 'customer_material aggregate_version must advance by one'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.classification_status IS DISTINCT FROM OLD.classification_status
       AND NOT (
           (OLD.classification_status = 'PROPOSED'
               AND NEW.classification_status IN ('UNDER_REVIEW', 'CONFIRMED',
                                                   'DISPUTED', 'REJECTED'))
           OR (OLD.classification_status = 'UNDER_REVIEW'
               AND NEW.classification_status IN ('CONFIRMED', 'DISPUTED', 'REJECTED'))
           OR (OLD.classification_status = 'CONFIRMED'
               AND NEW.classification_status IN ('NOT_CURRENT', 'SUPERSEDED'))
       ) THEN
        RAISE EXCEPTION 'customer_material classification transition is not allowed'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.confirmed_by_principal_id IS DISTINCT FROM OLD.confirmed_by_principal_id
       OR NEW.confirmed_by_actor_snapshot_id IS DISTINCT FROM OLD.confirmed_by_actor_snapshot_id
       OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
        IF OLD.classification_status <> 'PROPOSED'
           OR NEW.classification_status <> 'CONFIRMED'
           OR OLD.confirmed_by_principal_id IS NOT NULL
           OR OLD.confirmed_by_actor_snapshot_id IS NOT NULL
           OR OLD.confirmed_at IS NOT NULL THEN
            RAISE EXCEPTION 'customer_material confirmation facts are immutable'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_customer_material_root() FROM PUBLIC;

CREATE TRIGGER customer_material_root_guard
    BEFORE UPDATE ON enterprise_project.customer_material
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_customer_material_root();

CREATE FUNCTION enterprise_project.guard_customer_material_version_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.version_id IS DISTINCT FROM OLD.version_id
       OR NEW.customer_material_id IS DISTINCT FROM OLD.customer_material_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.version_status IS DISTINCT FROM OLD.version_status
       OR NEW.material_type IS DISTINCT FROM OLD.material_type
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.customer_document_number IS DISTINCT FROM OLD.customer_document_number
       OR NEW.customer_version_label IS DISTINCT FROM OLD.customer_version_label
       OR NEW.effective_date IS DISTINCT FROM OLD.effective_date
       OR NEW.declared_status IS DISTINCT FROM OLD.declared_status
       OR NEW.completeness IS DISTINCT FROM OLD.completeness
       OR NEW.source_selections IS DISTINCT FROM OLD.source_selections
       OR NEW.language IS DISTINCT FROM OLD.language
       OR NEW.classification_rationale IS DISTINCT FROM OLD.classification_rationale
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
       OR NEW.canonicalization_version IS DISTINCT FROM OLD.canonicalization_version
       OR NEW.proposed_by_principal_id IS DISTINCT FROM OLD.proposed_by_principal_id
       OR NEW.proposed_by_actor_snapshot_id IS DISTINCT FROM OLD.proposed_by_actor_snapshot_id
       OR NEW.authorization_decision_id IS DISTINCT FROM OLD.authorization_decision_id
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
       OR NEW.source_command_id IS DISTINCT FROM OLD.source_command_id
       OR NEW.previous_version_id IS DISTINCT FROM OLD.previous_version_id THEN
        RAISE EXCEPTION 'customer_material_version history is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_customer_material_version_immutable() FROM PUBLIC;

CREATE TRIGGER customer_material_version_immutable_guard
    BEFORE UPDATE ON enterprise_project.customer_material_version
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_customer_material_version_immutable();

CREATE FUNCTION enterprise_project.guard_customer_material_decision_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
BEGIN
    IF NEW.decision_id IS DISTINCT FROM OLD.decision_id
       OR NEW.customer_material_id IS DISTINCT FROM OLD.customer_material_id
       OR NEW.version_id IS DISTINCT FROM OLD.version_id
       OR NEW.enterprise_id IS DISTINCT FROM OLD.enterprise_id
       OR NEW.project_id IS DISTINCT FROM OLD.project_id
       OR NEW.decision_kind IS DISTINCT FROM OLD.decision_kind
       OR NEW.evidence_refs IS DISTINCT FROM OLD.evidence_refs
       OR NEW.justification IS DISTINCT FROM OLD.justification
       OR NEW.payload IS DISTINCT FROM OLD.payload
       OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
       OR NEW.canonicalization_version IS DISTINCT FROM OLD.canonicalization_version
       OR NEW.decided_by_principal_id IS DISTINCT FROM OLD.decided_by_principal_id
       OR NEW.decided_by_actor_snapshot_id IS DISTINCT FROM OLD.decided_by_actor_snapshot_id
       OR NEW.authorization_decision_id IS DISTINCT FROM OLD.authorization_decision_id
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
       OR NEW.source_command_id IS DISTINCT FROM OLD.source_command_id THEN
        RAISE EXCEPTION 'customer_material_decision history is immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

REVOKE ALL ON FUNCTION enterprise_project.guard_customer_material_decision_immutable() FROM PUBLIC;

CREATE TRIGGER customer_material_decision_immutable_guard
    BEFORE UPDATE ON enterprise_project.customer_material_decision
    FOR EACH ROW EXECUTE FUNCTION enterprise_project.guard_customer_material_decision_immutable();

ALTER TABLE enterprise_project.customer_material
    ADD CONSTRAINT customer_material_current_version_fk
    FOREIGN KEY (enterprise_id, project_id, customer_material_id, current_version_id)
    REFERENCES enterprise_project.customer_material_version
        (enterprise_id, project_id, customer_material_id, version_id)
    DEFERRABLE INITIALLY DEFERRED;

-- The application can move the root pointer only as part of the command CAS.
-- Version and decision rows are append-only and cannot be removed by the app.
REVOKE UPDATE ON enterprise_project.customer_material FROM enterprise_project_app;
GRANT UPDATE (classification_status, completeness, declared_status,
              current_version_id, aggregate_version, confirmed_by_principal_id,
              confirmed_by_actor_snapshot_id, confirmed_at, updated_at,
              last_command_id)
    ON enterprise_project.customer_material TO enterprise_project_app;
REVOKE UPDATE, DELETE ON enterprise_project.customer_material_version FROM enterprise_project_app;
REVOKE UPDATE, DELETE ON enterprise_project.customer_material_decision FROM enterprise_project_app;

-- ---------------------------------------------------------------------------
-- Project RLS. All three tables require an explicitly allowed Project scope.
-- ---------------------------------------------------------------------------

ALTER TABLE enterprise_project.customer_material ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.customer_material FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_material_select ON enterprise_project.customer_material
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY customer_material_insert ON enterprise_project.customer_material
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        created_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY customer_material_update ON enterprise_project.customer_material
    FOR UPDATE TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id))
    WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.customer_material_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.customer_material_version FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_material_version_select ON enterprise_project.customer_material_version
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY customer_material_version_insert ON enterprise_project.customer_material_version
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        proposed_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

ALTER TABLE enterprise_project.customer_material_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise_project.customer_material_decision FORCE ROW LEVEL SECURITY;
CREATE POLICY customer_material_decision_select ON enterprise_project.customer_material_decision
    FOR SELECT TO enterprise_project_app
    USING (platform_security.context_allows_project(enterprise_id, project_id));
CREATE POLICY customer_material_decision_insert ON enterprise_project.customer_material_decision
    FOR INSERT TO enterprise_project_app
    WITH CHECK (
        decided_by_principal_id = platform_security.context_principal_id()
        AND platform_security.context_allows_project(enterprise_id, project_id));

RESET ROLE;
