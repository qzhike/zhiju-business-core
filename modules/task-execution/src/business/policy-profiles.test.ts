import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredPolicyProfileReference,
  type Common,
} from '@zhiju/contracts';

import {
  CONTEXT_BUILDER_POLICY_PROFILE_KEY,
  TASK_READINESS_POLICY_PROFILE_KEY,
  WORK_ORDER_VALIDATION_POLICY_PROFILE_KEY,
  validateContextBuilderPolicy,
  validateTaskReadinessPolicy,
  validateWorkOrderValidationPolicy,
} from './policy-profiles.js';

const legacyPolicySnapshotReference: Common.VersionedRef = {
  kind: 'VERSIONED',
  objectType: 'identity.contract_schema',
  objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d401',
  versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d411',
  scope: {},
};

function canonicalReference(registryKey: string): Common.VersionedRef {
  const reference = registeredPolicyProfileReference(POLICY_PROFILE_REGISTRY_VERSION, registryKey);
  if (reference === undefined) throw new Error(`missing profile reference ${registryKey}`);
  return reference;
}

function fixture(name: string): Record<string, unknown> {
  const url = new URL(
    `../../../../tests/fixtures/contracts/policy-profiles/${name}`,
    import.meta.url,
  );
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

describe('initial Context Builder profile', () => {
  const declared = () => ({
    policySchemaRefs: [canonicalReference(CONTEXT_BUILDER_POLICY_PROFILE_KEY)],
  });
  const document = () => fixture('execution-context-builder-policy-document-valid.json');

  it('accepts the canonical reference with its closed projection types', () => {
    expect(validateContextBuilderPolicy({ ...declared(), policyDocument: document() })).toEqual({
      valid: true,
      rules: { allowedProjectionTypes: ['COORDINATOR', 'DOCUMENT_WRITER'] },
    });
  });

  it('rejects a missing profile reference, a historical-only set and a wrong profile key', () => {
    expect(
      validateContextBuilderPolicy({ policySchemaRefs: [], policyDocument: document() }).valid,
    ).toBe(false);
    expect(
      validateContextBuilderPolicy({
        policySchemaRefs: [legacyPolicySnapshotReference],
        policyDocument: document(),
      }).valid,
    ).toBe(false);
    expect(
      validateContextBuilderPolicy({
        policySchemaRefs: [canonicalReference(TASK_READINESS_POLICY_PROFILE_KEY)],
        policyDocument: document(),
      }).valid,
    ).toBe(false);
  });

  it('rejects a document that is not the approved closed rule set', () => {
    for (const policyDocument of [
      {},
      { allowedProjectionTypes: [] },
      { allowedProjectionTypes: ['COORDINATOR', 'COORDINATOR'] },
      { allowedProjectionTypes: ['NOT_A_PROJECTION'] },
      { allowedProjectionTypes: ['coordinator'] },
      { ...document(), maxSliceValiditySeconds: 60 },
    ]) {
      expect(validateContextBuilderPolicy({ ...declared(), policyDocument }).valid).toBe(false);
    }
  });
});

describe('TaskReadinessBuilder profile', () => {
  const declared = () => ({
    policySchemaRefs: [canonicalReference(TASK_READINESS_POLICY_PROFILE_KEY)],
  });
  const document = () => fixture('execution-task-readiness-policy-document-valid.json');

  it('accepts the canonical reference with its closed validity bound', () => {
    expect(validateTaskReadinessPolicy({ ...declared(), policyDocument: document() })).toEqual({
      valid: true,
      rules: { maxReadinessValiditySeconds: 900 },
    });
  });

  it('rejects a missing profile reference and an invalid validity bound', () => {
    expect(
      validateTaskReadinessPolicy({ policySchemaRefs: [], policyDocument: document() }).valid,
    ).toBe(false);
    for (const value of [undefined, 0, -5, 2.5, '900']) {
      expect(
        validateTaskReadinessPolicy({
          ...declared(),
          policyDocument: value === undefined ? {} : { maxReadinessValiditySeconds: value },
        }).valid,
      ).toBe(false);
    }
    expect(
      validateTaskReadinessPolicy({
        ...declared(),
        policyDocument: { ...document(), contextTtlSeconds: 60 },
      }).valid,
    ).toBe(false);
  });
});

describe('WorkOrderValidator profile', () => {
  const declared = () => ({
    policySchemaRefs: [canonicalReference(WORK_ORDER_VALIDATION_POLICY_PROFILE_KEY)],
  });
  const document = () => fixture('execution-work-order-validation-policy-document-valid.json');

  it('accepts the canonical reference with its closed validity bound', () => {
    expect(
      validateWorkOrderValidationPolicy({ ...declared(), policyDocument: document() }),
    ).toEqual({
      valid: true,
      rules: {
        maxValidationValiditySeconds: 1800,
        mandatoryCriterionTypes: ['EXPECTED_OUTPUT_PRESENT', 'OUTPUT_REF_VALID'],
      },
    });
  });

  it('accepts an omitted or empty mandatoryCriterionTypes and rejects an unregistered type', () => {
    const omitted = validateWorkOrderValidationPolicy({
      ...declared(),
      policyDocument: { maxValidationValiditySeconds: 1800 },
    });
    expect(omitted).toEqual({ valid: true, rules: { maxValidationValiditySeconds: 1800 } });
    expect(
      validateWorkOrderValidationPolicy({
        ...declared(),
        policyDocument: { maxValidationValiditySeconds: 1800, mandatoryCriterionTypes: [] },
      }),
    ).toEqual({
      valid: true,
      rules: { maxValidationValiditySeconds: 1800, mandatoryCriterionTypes: [] },
    });
    for (const mandatoryCriterionTypes of [['QUALITY_APPROVED'], ['EXPECTED_OUTPUT_PRESENT', 1]]) {
      expect(
        validateWorkOrderValidationPolicy({
          ...declared(),
          policyDocument: { maxValidationValiditySeconds: 1800, mandatoryCriterionTypes },
        }).valid,
      ).toBe(false);
    }
  });

  it('rejects a missing profile reference, an unknown field and an invalid bound', () => {
    expect(
      validateWorkOrderValidationPolicy({ policySchemaRefs: [], policyDocument: document() }).valid,
    ).toBe(false);
    expect(
      validateWorkOrderValidationPolicy({
        ...declared(),
        policyDocument: { ...document(), allowedProjectionTypes: ['COORDINATOR'] },
      }).valid,
    ).toBe(false);
    expect(
      validateWorkOrderValidationPolicy({
        ...declared(),
        policyDocument: { maxValidationValiditySeconds: 0 },
      }).valid,
    ).toBe(false);
  });
});
