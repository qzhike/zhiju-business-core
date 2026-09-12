import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredPolicyProfileReference,
  type Common,
} from '@zhiju/contracts';

import { CAPTURE_POLICY_PROFILE_KEY, validateCapturePolicy } from './capture-policy-profile.js';

const legacyPolicySnapshotReference: Common.VersionedRef = {
  kind: 'VERSIONED',
  objectType: 'identity.contract_schema',
  objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d401',
  versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d411',
  scope: {},
};

function canonicalReference(): Common.VersionedRef {
  const reference = registeredPolicyProfileReference(
    POLICY_PROFILE_REGISTRY_VERSION,
    CAPTURE_POLICY_PROFILE_KEY,
  );
  if (reference === undefined) throw new Error('missing capture profile reference');
  return reference;
}

function validDocument(): Record<string, unknown> {
  const url = new URL(
    '../../../../tests/fixtures/contracts/policy-profiles/ep-context-source-slice-capture-policy-document-valid.json',
    import.meta.url,
  );
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

describe('capture policy profile', () => {
  it('accepts the canonical profile reference with its closed rule fields', () => {
    const result = validateCapturePolicy({
      policySchemaRefs: [canonicalReference()],
      policyDocument: validDocument(),
    });
    expect(result).toEqual({
      valid: true,
      rules: {
        maxSliceValiditySeconds: 3600,
        allowedPurposeCodes: ['project.context_source.capture', 'project.context_source.read'],
      },
    });
  });

  it('accepts the profile reference alongside other registered references', () => {
    const result = validateCapturePolicy({
      policySchemaRefs: [legacyPolicySnapshotReference, canonicalReference()],
      policyDocument: validDocument(),
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a missing, historical-only or tampered profile reference', () => {
    const missing = validateCapturePolicy({
      policySchemaRefs: [],
      policyDocument: validDocument(),
    });
    expect(missing.valid).toBe(false);
    if (missing.valid) throw new Error('unreachable');
    expect(missing.errors[0]?.instancePath).toBe('/policySchemaRefs');

    expect(
      validateCapturePolicy({
        policySchemaRefs: [legacyPolicySnapshotReference],
        policyDocument: validDocument(),
      }).valid,
    ).toBe(false);

    for (const tampered of [
      { ...canonicalReference(), objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d401' },
      { ...canonicalReference(), versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d411' },
      { ...canonicalReference(), scope: { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d401' } },
      { ...canonicalReference(), objectType: 'zhiju.identity.policy' },
    ]) {
      expect(
        validateCapturePolicy({
          policySchemaRefs: [tampered],
          policyDocument: validDocument(),
        }).valid,
      ).toBe(false);
    }
  });

  it('rejects a document that is not the approved closed rule set', () => {
    const declared = { policySchemaRefs: [canonicalReference()] };
    const cases: readonly Record<string, unknown>[] = [
      { allowedPurposeCodes: ['project.context_source.capture'] },
      { maxSliceValiditySeconds: 3600 },
      { maxSliceValiditySeconds: 3600, allowedPurposeCodes: [] },
      { maxSliceValiditySeconds: 0, allowedPurposeCodes: ['project.context_source.capture'] },
      { maxSliceValiditySeconds: -1, allowedPurposeCodes: ['project.context_source.capture'] },
      { maxSliceValiditySeconds: 1.5, allowedPurposeCodes: ['project.context_source.capture'] },
      {
        maxSliceValiditySeconds: 3600,
        allowedPurposeCodes: ['project.context_source.capture', 'project.context_source.capture'],
      },
      { ...validDocument(), ttlSeconds: 60 },
      { ...validDocument(), maxSliceValiditySeconds: '3600' },
    ];
    for (const policyDocument of cases) {
      const result = validateCapturePolicy({ ...declared, policyDocument });
      expect(result.valid).toBe(false);
      if (result.valid) continue;
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});
