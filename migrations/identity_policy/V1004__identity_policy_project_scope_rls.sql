-- IM-02 WI-08 review remediation: enforce Project scope in the IdentityPolicy
-- RLS boundary and retain the promoted project scope on revocation facts.
--
-- V1001 already contains these objects for a new database. This migration is
-- still required because an older database may have applied the original
-- V1001 before the Project shape and revocation scope were introduced. Every
-- schema change below is therefore forward-only and conditional.

SET ROLE identity_policy_owner;

ALTER TABLE identity_policy.role_revocation
    ADD COLUMN IF NOT EXISTS scope_kind text;
ALTER TABLE identity_policy.role_revocation
    ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE identity_policy.role_revocation NO FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.role_assignment NO FORCE ROW LEVEL SECURITY;
UPDATE identity_policy.role_revocation r
SET project_id = a.project_id
FROM identity_policy.role_assignment a
WHERE a.id = r.role_assignment_id;
UPDATE identity_policy.role_revocation r
SET scope_kind = a.scope_kind,
    enterprise_id = a.enterprise_id
FROM identity_policy.role_assignment a
WHERE a.id = r.role_assignment_id;
ALTER TABLE identity_policy.role_revocation
    ALTER COLUMN scope_kind SET NOT NULL;
ALTER TABLE identity_policy.role_revocation FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.role_assignment FORCE ROW LEVEL SECURITY;

ALTER TABLE identity_policy.capability_revocation
    ADD COLUMN IF NOT EXISTS scope_kind text;
ALTER TABLE identity_policy.capability_revocation
    ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE identity_policy.capability_revocation NO FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.capability_grant NO FORCE ROW LEVEL SECURITY;
UPDATE identity_policy.capability_revocation r
SET project_id = g.project_id
FROM identity_policy.capability_grant g
WHERE g.id = r.capability_grant_id;
UPDATE identity_policy.capability_revocation r
SET scope_kind = g.scope_kind,
    enterprise_id = g.enterprise_id
FROM identity_policy.capability_grant g
WHERE g.id = r.capability_grant_id;
ALTER TABLE identity_policy.capability_revocation
    ALTER COLUMN scope_kind SET NOT NULL;
ALTER TABLE identity_policy.capability_revocation FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.capability_grant FORCE ROW LEVEL SECURITY;

-- Add the composite keys before adding the revocation foreign keys. The
-- conditional checks keep this migration valid when V1001 has already
-- supplied the current definitions.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'identity_policy.role_assignment'::regclass
          AND conname = 'role_assignment_scope_shape'
    ) THEN
        ALTER TABLE identity_policy.role_assignment
            ADD CONSTRAINT role_assignment_scope_shape CHECK (
                (scope_kind = 'ENTERPRISE' AND project_id IS NULL)
                OR (scope_kind = 'PROJECT' AND project_id IS NOT NULL));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'identity_policy.capability_grant'::regclass
          AND conname = 'capability_grant_scope_shape'
    ) THEN
        ALTER TABLE identity_policy.capability_grant
            ADD CONSTRAINT capability_grant_scope_shape CHECK (
                (scope_kind = 'ENTERPRISE' AND project_id IS NULL)
                OR (scope_kind = 'PROJECT' AND project_id IS NOT NULL));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'identity_policy.role_assignment'::regclass
          AND conname = 'role_assignment_scope_ref_unique'
    ) THEN
        ALTER TABLE identity_policy.role_assignment
            ADD CONSTRAINT role_assignment_scope_ref_unique
            UNIQUE (id, scope_kind, enterprise_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'identity_policy.role_assignment'::regclass
          AND conname = 'role_assignment_project_ref_unique'
    ) THEN
        ALTER TABLE identity_policy.role_assignment
            ADD CONSTRAINT role_assignment_project_ref_unique
            UNIQUE NULLS NOT DISTINCT (id, project_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'identity_policy.capability_grant'::regclass
          AND conname = 'capability_grant_scope_ref_unique'
    ) THEN
        ALTER TABLE identity_policy.capability_grant
            ADD CONSTRAINT capability_grant_scope_ref_unique
            UNIQUE (id, scope_kind, enterprise_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'identity_policy.capability_grant'::regclass
          AND conname = 'capability_grant_project_ref_unique'
    ) THEN
        ALTER TABLE identity_policy.capability_grant
            ADD CONSTRAINT capability_grant_project_ref_unique
            UNIQUE NULLS NOT DISTINCT (id, project_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'identity_policy.role_revocation'::regclass
          AND conname = 'role_revocation_scope_fk'
    ) THEN
        ALTER TABLE identity_policy.role_revocation
            ADD CONSTRAINT role_revocation_scope_fk FOREIGN KEY
            (role_assignment_id, scope_kind, enterprise_id)
            REFERENCES identity_policy.role_assignment (id, scope_kind, enterprise_id)
            ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'identity_policy.role_revocation'::regclass
          AND conname = 'role_revocation_project_fk'
    ) THEN
        ALTER TABLE identity_policy.role_revocation
            ADD CONSTRAINT role_revocation_project_fk FOREIGN KEY
            (role_assignment_id, project_id)
            REFERENCES identity_policy.role_assignment (id, project_id)
            ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'identity_policy.role_revocation'::regclass
          AND conname = 'role_revocation_scope_closed'
    ) THEN
        ALTER TABLE identity_policy.role_revocation
            ADD CONSTRAINT role_revocation_scope_closed
            CHECK (scope_kind IN ('ENTERPRISE', 'PROJECT'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'identity_policy.role_revocation'::regclass
          AND conname = 'role_revocation_scope_shape'
    ) THEN
        ALTER TABLE identity_policy.role_revocation
            ADD CONSTRAINT role_revocation_scope_shape CHECK (
                (scope_kind = 'ENTERPRISE' AND project_id IS NULL)
                OR (scope_kind = 'PROJECT' AND project_id IS NOT NULL));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'identity_policy.capability_revocation'::regclass
          AND conname = 'capability_revocation_scope_fk'
    ) THEN
        ALTER TABLE identity_policy.capability_revocation
            ADD CONSTRAINT capability_revocation_scope_fk FOREIGN KEY
            (capability_grant_id, scope_kind, enterprise_id)
            REFERENCES identity_policy.capability_grant (id, scope_kind, enterprise_id)
            ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'identity_policy.capability_revocation'::regclass
          AND conname = 'capability_revocation_project_fk'
    ) THEN
        ALTER TABLE identity_policy.capability_revocation
            ADD CONSTRAINT capability_revocation_project_fk FOREIGN KEY
            (capability_grant_id, project_id)
            REFERENCES identity_policy.capability_grant (id, project_id)
            ON DELETE RESTRICT;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'identity_policy.capability_revocation'::regclass
          AND conname = 'capability_revocation_scope_closed'
    ) THEN
        ALTER TABLE identity_policy.capability_revocation
            ADD CONSTRAINT capability_revocation_scope_closed
            CHECK (scope_kind IN ('ENTERPRISE', 'PROJECT'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'identity_policy.capability_revocation'::regclass
          AND conname = 'capability_revocation_scope_shape'
    ) THEN
        ALTER TABLE identity_policy.capability_revocation
            ADD CONSTRAINT capability_revocation_scope_shape CHECK (
                (scope_kind = 'ENTERPRISE' AND project_id IS NULL)
                OR (scope_kind = 'PROJECT' AND project_id IS NOT NULL));
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION identity_policy.guard_role_revocation_scope() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
DECLARE
    v_scope_kind text;
    v_enterprise_id uuid;
    v_project_id uuid;
BEGIN
    SELECT scope_kind, enterprise_id, project_id
      INTO v_scope_kind, v_enterprise_id, v_project_id
      FROM identity_policy.role_assignment
     WHERE id = NEW.role_assignment_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    IF NEW.scope_kind IS DISTINCT FROM v_scope_kind
       OR NEW.enterprise_id IS DISTINCT FROM v_enterprise_id
       OR NEW.project_id IS DISTINCT FROM v_project_id THEN
        RAISE EXCEPTION 'role revocation scope does not match assignment'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

CREATE OR REPLACE FUNCTION identity_policy.guard_capability_revocation_scope() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
DECLARE
    v_scope_kind text;
    v_enterprise_id uuid;
    v_project_id uuid;
BEGIN
    SELECT scope_kind, enterprise_id, project_id
      INTO v_scope_kind, v_enterprise_id, v_project_id
      FROM identity_policy.capability_grant
     WHERE id = NEW.capability_grant_id;
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;
    IF NEW.scope_kind IS DISTINCT FROM v_scope_kind
       OR NEW.enterprise_id IS DISTINCT FROM v_enterprise_id
       OR NEW.project_id IS DISTINCT FROM v_project_id THEN
        RAISE EXCEPTION 'capability revocation scope does not match grant'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END
$guard$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'identity_policy.role_revocation'::regclass
          AND tgname = 'role_revocation_scope_guard'
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER role_revocation_scope_guard
            BEFORE INSERT ON identity_policy.role_revocation
            FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_role_revocation_scope();
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'identity_policy.capability_revocation'::regclass
          AND tgname = 'capability_revocation_scope_guard'
          AND NOT tgisinternal
    ) THEN
        CREATE TRIGGER capability_revocation_scope_guard
            BEFORE INSERT ON identity_policy.capability_revocation
            FOR EACH ROW EXECUTE FUNCTION identity_policy.guard_capability_revocation_scope();
    END IF;
END
$$;

DROP POLICY role_assignment_select ON identity_policy.role_assignment;
CREATE POLICY role_assignment_select ON identity_policy.role_assignment
    FOR SELECT TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (scope_kind = 'ENTERPRISE'
             OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY role_assignment_insert ON identity_policy.role_assignment;
CREATE POLICY role_assignment_insert ON identity_policy.role_assignment
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (scope_kind = 'ENTERPRISE'
             OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY role_assignment_update ON identity_policy.role_assignment;
CREATE POLICY role_assignment_update ON identity_policy.role_assignment
    FOR UPDATE TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (scope_kind = 'ENTERPRISE'
             OR platform_security.context_allows_project(enterprise_id, project_id))
    )
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (scope_kind = 'ENTERPRISE'
             OR platform_security.context_allows_project(enterprise_id, project_id))
    );

DROP POLICY role_revocation_select ON identity_policy.role_revocation;
CREATE POLICY role_revocation_select ON identity_policy.role_revocation
    FOR SELECT TO identity_policy_app
    USING (
        (scope_kind = 'ENTERPRISE' AND platform_security.context_allows_enterprise(enterprise_id))
        OR (scope_kind = 'PROJECT' AND platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY role_revocation_insert ON identity_policy.role_revocation;
CREATE POLICY role_revocation_insert ON identity_policy.role_revocation
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        (scope_kind = 'ENTERPRISE' AND platform_security.context_allows_enterprise(enterprise_id))
        OR (scope_kind = 'PROJECT' AND platform_security.context_allows_project(enterprise_id, project_id))
    );

DROP POLICY capability_grant_select ON identity_policy.capability_grant;
CREATE POLICY capability_grant_select ON identity_policy.capability_grant
    FOR SELECT TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (scope_kind = 'ENTERPRISE'
             OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY capability_grant_insert ON identity_policy.capability_grant;
CREATE POLICY capability_grant_insert ON identity_policy.capability_grant
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (scope_kind = 'ENTERPRISE'
             OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY capability_grant_update ON identity_policy.capability_grant;
CREATE POLICY capability_grant_update ON identity_policy.capability_grant
    FOR UPDATE TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (scope_kind = 'ENTERPRISE'
             OR platform_security.context_allows_project(enterprise_id, project_id))
    )
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (scope_kind = 'ENTERPRISE'
             OR platform_security.context_allows_project(enterprise_id, project_id))
    );

DROP POLICY capability_revocation_select ON identity_policy.capability_revocation;
CREATE POLICY capability_revocation_select ON identity_policy.capability_revocation
    FOR SELECT TO identity_policy_app
    USING (
        (scope_kind = 'ENTERPRISE' AND platform_security.context_allows_enterprise(enterprise_id))
        OR (scope_kind = 'PROJECT' AND platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY capability_revocation_insert ON identity_policy.capability_revocation;
CREATE POLICY capability_revocation_insert ON identity_policy.capability_revocation
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        (scope_kind = 'ENTERPRISE' AND platform_security.context_allows_enterprise(enterprise_id))
        OR (scope_kind = 'PROJECT' AND platform_security.context_allows_project(enterprise_id, project_id))
    );

-- The command receipt, audit and event rows are part of the same scoped
-- transaction as the business aggregate. Keep their promoted project scope
-- behind the same context boundary; enterprise membership alone must not
-- expose another project's history or technical side effects.
DROP POLICY command_receipt_select ON identity_policy.command_receipt;
CREATE POLICY command_receipt_select ON identity_policy.command_receipt
    FOR SELECT TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY command_receipt_insert ON identity_policy.command_receipt;
CREATE POLICY command_receipt_insert ON identity_policy.command_receipt
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY command_receipt_update ON identity_policy.command_receipt;
CREATE POLICY command_receipt_update ON identity_policy.command_receipt
    FOR UPDATE TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    )
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );

DROP POLICY outbox_event_select ON identity_policy.outbox_event;
CREATE POLICY outbox_event_select ON identity_policy.outbox_event
    FOR SELECT TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY outbox_event_insert ON identity_policy.outbox_event;
CREATE POLICY outbox_event_insert ON identity_policy.outbox_event
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );

DROP POLICY audit_record_select ON identity_policy.audit_record;
CREATE POLICY audit_record_select ON identity_policy.audit_record
    FOR SELECT TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY audit_record_insert ON identity_policy.audit_record;
CREATE POLICY audit_record_insert ON identity_policy.audit_record
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );

-- The remaining enterprise tables carry the same optional promoted project
-- field. Their consumers must observe the same anti-cross-project invariant.
DROP POLICY inbox_message_select ON identity_policy.inbox_message;
CREATE POLICY inbox_message_select ON identity_policy.inbox_message
    FOR SELECT TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY inbox_message_insert ON identity_policy.inbox_message;
CREATE POLICY inbox_message_insert ON identity_policy.inbox_message
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY inbox_message_update ON identity_policy.inbox_message;
CREATE POLICY inbox_message_update ON identity_policy.inbox_message
    FOR UPDATE TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    )
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );

DROP POLICY process_instance_select ON identity_policy.process_instance;
CREATE POLICY process_instance_select ON identity_policy.process_instance
    FOR SELECT TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY process_instance_insert ON identity_policy.process_instance;
CREATE POLICY process_instance_insert ON identity_policy.process_instance
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY process_instance_update ON identity_policy.process_instance;
CREATE POLICY process_instance_update ON identity_policy.process_instance
    FOR UPDATE TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    )
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );

DROP POLICY process_step_select ON identity_policy.process_step;
CREATE POLICY process_step_select ON identity_policy.process_step
    FOR SELECT TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY process_step_insert ON identity_policy.process_step;
CREATE POLICY process_step_insert ON identity_policy.process_step
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );

DROP POLICY reference_edge_select ON identity_policy.reference_edge;
CREATE POLICY reference_edge_select ON identity_policy.reference_edge
    FOR SELECT TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY reference_edge_insert ON identity_policy.reference_edge;
CREATE POLICY reference_edge_insert ON identity_policy.reference_edge
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );

DROP POLICY contract_violation_select ON identity_policy.contract_violation;
CREATE POLICY contract_violation_select ON identity_policy.contract_violation
    FOR SELECT TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY contract_violation_insert ON identity_policy.contract_violation;
CREATE POLICY contract_violation_insert ON identity_policy.contract_violation
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );

-- Core contract rows also promote the optional project scope.
DROP POLICY actor_snapshot_select ON identity_policy.actor_snapshot;
CREATE POLICY actor_snapshot_select ON identity_policy.actor_snapshot
    FOR SELECT TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY actor_snapshot_insert ON identity_policy.actor_snapshot;
CREATE POLICY actor_snapshot_insert ON identity_policy.actor_snapshot
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );

DROP POLICY authorization_decision_select ON identity_policy.authorization_decision;
CREATE POLICY authorization_decision_select ON identity_policy.authorization_decision
    FOR SELECT TO identity_policy_app
    USING (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY authorization_decision_insert ON identity_policy.authorization_decision;
CREATE POLICY authorization_decision_insert ON identity_policy.authorization_decision
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );

RESET ROLE;
