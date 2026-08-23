-- IM-02 WI-07 (issue #35): the one-time, audited bootstrap claim for the
-- first business principal. The infrastructure bootstrap admin is not a
-- Zhiju HumanPrincipal: the first business principal can only be created by
-- explicitly claiming this auditable, expiring, single-use fact. The claim
-- never maps the bootstrap admin to a business Role/Capability; WI-08
-- permanently closes it after the first minimal admin role bootstrap.

SET ROLE identity_policy_owner;

CREATE TABLE identity_policy.bootstrap_claim (
    claim_id uuid PRIMARY KEY,
    purpose text NOT NULL,
    operator_description text NOT NULL,
    operator_actor_snapshot_id uuid NOT NULL,
    operator_authorization_decision_id uuid NOT NULL,
    reason text NOT NULL,
    evidence_refs jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    consumed_by_command_id uuid,
    consumed_result jsonb,
    closed_at timestamptz,
    closed_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT bootstrap_claim_purpose_unique UNIQUE (purpose),
    CONSTRAINT bootstrap_claim_open_shape CHECK (
        (closed_at IS NULL AND closed_reason IS NULL)
        OR (closed_at IS NOT NULL AND closed_reason IS NOT NULL))
);

ALTER TABLE identity_policy.bootstrap_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_policy.bootstrap_claim FORCE ROW LEVEL SECURITY;
CREATE POLICY bootstrap_claim_select ON identity_policy.bootstrap_claim
    FOR SELECT TO identity_policy_app USING (platform_security.context_is_valid());
CREATE POLICY bootstrap_claim_insert ON identity_policy.bootstrap_claim
    FOR INSERT TO identity_policy_app WITH CHECK (platform_security.context_is_valid());
CREATE POLICY bootstrap_claim_update ON identity_policy.bootstrap_claim
    FOR UPDATE TO identity_policy_app
    USING (platform_security.context_is_valid())
    WITH CHECK (platform_security.context_is_valid());

RESET ROLE;
