// Synthetic V6002 data used by the persistence gate to prove the historical
// Provider Result remediation path. The rows are intentionally isolated from
// business fixtures and contain no production data.

export const HISTORICAL_PROVIDER_RESULT_RECEIPT_ID = '0190a1b2-c3d4-7e81-8f90-123456789201';
export const HISTORICAL_PROVIDER_RESULT_OBSERVATION_ID = '0190a1b2-c3d4-7e81-8f90-123456789202';

export function historicalProviderResultSeedSql() {
  return `
BEGIN;
ALTER TABLE release_publication.publication_receipt DISABLE TRIGGER ALL;
ALTER TABLE release_publication.publication_observation DISABLE TRIGGER ALL;

INSERT INTO release_publication.publication_receipt (
    receipt_id, attempt_id, release_id, package_id, enterprise_id, project_id,
    destination_id, raw_receipt_ref, formal_receipt_ref, provider_result,
    receipt_payload_hash, occurred_at, created_by_principal_id,
    created_by_actor_snapshot_id, created_authorization_decision_id,
    source_command_id)
VALUES (
    '${HISTORICAL_PROVIDER_RESULT_RECEIPT_ID}'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789203'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789204'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789205'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789101'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789102'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789112'::uuid,
    '{"kind":"CONTENT_ADDRESSED","objectType":"integration.raw_external_receipt","objectId":"0190a1b2-c3d4-7e81-8f90-123456789206","scope":{"enterpriseId":"0190a1b2-c3d4-7e81-8f90-123456789101","projectId":"0190a1b2-c3d4-7e81-8f90-123456789102"},"contentHash":{"algorithm":"SHA-256","canonicalizationVersion":"1","digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'::jsonb,
    '{"kind":"CONTENT_ADDRESSED","objectType":"release.publication_receipt","objectId":"${HISTORICAL_PROVIDER_RESULT_RECEIPT_ID}","scope":{"enterpriseId":"0190a1b2-c3d4-7e81-8f90-123456789101","projectId":"0190a1b2-c3d4-7e81-8f90-123456789102"},"contentHash":{"algorithm":"SHA-256","canonicalizationVersion":"1","digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}'::jsonb,
    '{"messageId":"LegacyAliceCustomer","providerStatus":"LegacyAliceCustomer","reasonCode":"LegacyBobBuyer","status":"LegacyCustomerName","customRecipientData":[{"email":"legacy.customer@example.com","body":"legacy document body"}],"customer@example.com":"LegacyAliceCustomer"}'::jsonb,
    decode(repeat('81', 32), 'hex'),
    clock_timestamp(),
    '0190a1b2-c3d4-7e81-8f90-123456789104'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789105'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789106'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789207'::uuid);

INSERT INTO release_publication.publication_observation (
    observation_id, attempt_id, release_id, package_id, enterprise_id, project_id,
    destination_id, observation_kind, outcome, raw_receipt_ref, observed_at,
    observation_payload, observation_payload_hash, created_by_principal_id,
    created_by_actor_snapshot_id, created_authorization_decision_id,
    source_command_id)
VALUES (
    '${HISTORICAL_PROVIDER_RESULT_OBSERVATION_ID}'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789203'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789204'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789205'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789101'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789102'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789112'::uuid,
    'PROVIDER_RESULT',
    'SUCCEEDED',
    NULL,
    clock_timestamp(),
    '{"formalReceiptRef":{"kind":"CONTENT_ADDRESSED","objectType":"release.publication_receipt","objectId":"${HISTORICAL_PROVIDER_RESULT_RECEIPT_ID}","scope":{"enterpriseId":"0190a1b2-c3d4-7e81-8f90-123456789101","projectId":"0190a1b2-c3d4-7e81-8f90-123456789102"},"contentHash":{"algorithm":"SHA-256","canonicalizationVersion":"1","digest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}},"providerResult":{"messageId":"LegacyAliceCustomer","providerStatus":"LegacyAliceCustomer","reasonCode":"LegacyBobBuyer","status":"LegacyCustomerName","customRecipientData":[{"email":"legacy.customer@example.com","body":"legacy document body"}],"customer@example.com":"LegacyAliceCustomer"}}'::jsonb,
    decode(repeat('82', 32), 'hex'),
    '0190a1b2-c3d4-7e81-8f90-123456789104'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789105'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789106'::uuid,
    '0190a1b2-c3d4-7e81-8f90-123456789208'::uuid);

ALTER TABLE release_publication.publication_observation ENABLE TRIGGER ALL;
ALTER TABLE release_publication.publication_receipt ENABLE TRIGGER ALL;
COMMIT;
`.trim();
}
