-- IM-05 WI-01 (issue #121): make QualityGovernance trigger guards owner-only
-- for direct invocation. V5000 is already applied and remains immutable.
-- PostgreSQL executes trigger functions through their owning trigger without
-- checking caller EXECUTE, so these revocations do not weaken row guards.

SET ROLE quality_governance_owner;

REVOKE ALL ON FUNCTION quality_governance.guard_outbox_scope_mirror()
    FROM PUBLIC, quality_governance_app, quality_governance_dispatcher, audit_reader;
REVOKE ALL ON FUNCTION quality_governance.guard_process_step_scope()
    FROM PUBLIC, quality_governance_app, quality_governance_dispatcher, audit_reader;

RESET ROLE;
