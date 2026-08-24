-- IM-02 WI-08 review remediation: enforce Project scope in the IdentityPolicy
-- RLS boundary and retain the promoted project scope on revocation facts.

SET ROLE identity_policy_owner;

ALTER TABLE identity_policy.role_revocation
    ADD COLUMN project_id uuid;
ALTER TABLE identity_policy.role_revocation NO FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.role_assignment NO FORCE ROW LEVEL SECURITY;
UPDATE identity_policy.role_revocation r
SET project_id = a.project_id
FROM identity_policy.role_assignment a
WHERE a.id = r.role_assignment_id;
ALTER TABLE identity_policy.role_revocation FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.role_assignment FORCE ROW LEVEL SECURITY;

ALTER TABLE identity_policy.capability_revocation
    ADD COLUMN project_id uuid;
ALTER TABLE identity_policy.capability_revocation NO FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.capability_grant NO FORCE ROW LEVEL SECURITY;
UPDATE identity_policy.capability_revocation r
SET project_id = g.project_id
FROM identity_policy.capability_grant g
WHERE g.id = r.capability_grant_id;
ALTER TABLE identity_policy.capability_revocation FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.capability_grant FORCE ROW LEVEL SECURITY;

ALTER TABLE identity_policy.role_assignment
    ADD CONSTRAINT role_assignment_scope_shape CHECK (
        (scope_kind = 'ENTERPRISE' AND project_id IS NULL)
        OR (scope_kind = 'PROJECT' AND project_id IS NOT NULL)
    );

ALTER TABLE identity_policy.capability_grant
    ADD CONSTRAINT capability_grant_scope_shape CHECK (
        (scope_kind = 'ENTERPRISE' AND project_id IS NULL)
        OR (scope_kind = 'PROJECT' AND project_id IS NOT NULL)
    );

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
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY role_revocation_insert ON identity_policy.role_revocation;
CREATE POLICY role_revocation_insert ON identity_policy.role_revocation
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
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
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
    );
DROP POLICY capability_revocation_insert ON identity_policy.capability_revocation;
CREATE POLICY capability_revocation_insert ON identity_policy.capability_revocation
    FOR INSERT TO identity_policy_app
    WITH CHECK (
        platform_security.context_allows_enterprise(enterprise_id)
        AND (project_id IS NULL OR platform_security.context_allows_project(enterprise_id, project_id))
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
