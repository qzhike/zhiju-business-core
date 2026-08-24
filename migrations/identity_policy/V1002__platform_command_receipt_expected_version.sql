-- IM-02 WI-06: forward-only expansion for platform Command CAS receipts.
-- V1000 is already applied in earlier WI branches and must remain immutable.

SET ROLE identity_policy_owner;

ALTER TABLE identity_policy.platform_command_receipt
    ADD COLUMN expected_aggregate_version bigint;

RESET ROLE;
