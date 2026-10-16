import { describe, expect, it } from 'vitest';
import {
  createCustomerZipPolicyRegistry,
  customerZipPolicyHash,
  type CustomerZipPolicyArtifact,
} from './policy.js';
import { ZIP_LIMITS } from './zip-safety.js';
function artifact(): CustomerZipPolicyArtifact {
  const payload: CustomerZipPolicyArtifact['payload'] = {
    profile: 'zip-intake-limits@1',
    limits: ZIP_LIMITS,
    allowedFormats: ['DOCX', 'UTF8_MARKDOWN'],
    rejectRules: [
      'MULTI_DISK',
      'ENCRYPTED',
      'UNSAFE_PATH',
      'LINK_OR_DEVICE',
      'PATH_COLLISION',
      'CRC_MISMATCH',
      'ZIP_BOMB',
    ],
    retainOriginalBytes: true,
    noteIsUntrustedMaterial: true,
    extractorProfileRef: {
      kind: 'VERSIONED',
      objectType: 'zhiju.integration.customer_zip_extractor_profile',
      objectId: '0199e61a-7000-7000-8000-000000000001',
      versionId: '0199e61a-7000-7000-8000-000000000002',
      scope: {},
    },
  };
  return {
    policyRef: {
      kind: 'VERSIONED',
      objectType: 'zhiju.integration.customer_zip_policy',
      objectId: '0199e61a-7000-7000-8000-000000000003',
      versionId: '0199e61a-7000-7000-8000-000000000004',
      scope: {},
    },
    payloadHash: {
      algorithm: 'SHA-256',
      canonicalizationVersion: '1',
      digest: customerZipPolicyHash(payload),
    },
    payload,
  };
}
describe('controlled customer ZIP policy registry', () => {
  it('requires exact approved artifact, recomputed canonical hash, and fixed resource limits', () => {
    const value = artifact(),
      registry = createCustomerZipPolicyRegistry([value]);
    expect(registry.resolve(value.policyRef, value.payloadHash)).toEqual(value);
    expect(() =>
      registry.resolve({ ...value.policyRef, versionId: 'other' }, value.payloadHash),
    ).toThrow('INTEGRATION_PREPARATION_PROFILE_UNAVAILABLE');
    expect(() =>
      registry.resolve(value.policyRef, { ...value.payloadHash, digest: 'a'.repeat(64) }),
    ).toThrow('INTEGRATION_PREPARATION_PROFILE_UNAVAILABLE');
    const changed = {
      ...value,
      payload: { ...value.payload, limits: { ...ZIP_LIMITS, entryBytes: 100 } },
    };
    expect(() => createCustomerZipPolicyRegistry([changed as CustomerZipPolicyArtifact])).toThrow();
  });
  it('has no fallback for missing deployment publications', () => {
    const value = artifact();
    expect(() =>
      createCustomerZipPolicyRegistry([]).resolve(value.policyRef, value.payloadHash),
    ).toThrow();
  });
  it('protects the loaded artifact from mutable caller state', () => {
    const value = artifact(),
      registry = createCustomerZipPolicyRegistry([value]);
    const read = registry.resolve(value.policyRef, value.payloadHash);
    (read.payload.limits as unknown as Record<string, number>).entryBytes = 1;
    expect(registry.resolve(value.policyRef, value.payloadHash).payload.limits.entryBytes).toBe(
      52428800,
    );
  });
});
