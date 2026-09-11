import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  validateContextBuilderPolicyBinding,
  type ContextBuilderPolicyBindingValidationInput,
} from './context-builder-policy.js';
import type { TaskExecution } from './generated/types/index.js';
import { ContractRegistry } from './registry.js';

type JsonObject = Record<string, unknown>;

const registry = new ContractRegistry();

function fixture(name: string): JsonObject {
  return JSON.parse(
    readFileSync(
      new URL(`../../tests/fixtures/contracts/context-build/${name}`, import.meta.url),
      'utf8',
    ),
  ) as JsonObject;
}

function compatibilityFixture(name: string): JsonObject {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../tests/fixtures/contracts/compatibility/v1.0/positive/${name}`,
        import.meta.url,
      ),
      'utf8',
    ),
  ) as JsonObject;
}

function bindingInput(): ContextBuilderPolicyBindingValidationInput {
  const metadata = fixture(
    'policy-binding-valid.json',
  ) as unknown as TaskExecution.ContextBuilderPolicyBinding;
  const policyRef = structuredClone(metadata.builderPolicyRef);
  return {
    initialRequest: { builderPolicyRef: structuredClone(policyRef) },
    projectContext: { projection: { builderPolicyRef: structuredClone(policyRef) } },
    contextBuildMetadata: structuredClone(metadata),
    workOrder: { versionPins: { contextBuilderPolicyRef: structuredClone(policyRef) } },
    resolvedPolicy: structuredClone(metadata),
    now: '2026-09-11T00:00:00Z',
  };
}

function mutate(input: ContextBuilderPolicyBindingValidationInput, path: string, value: unknown) {
  const clone = structuredClone(input) as unknown as JsonObject;
  const segments = path.split('.');
  let current: JsonObject = clone;
  const last = segments.pop();
  if (last === undefined) throw new Error('mutation path is empty');
  for (const segment of segments) {
    const next = current[segment];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      throw new Error(`mutation path is not an object: ${segment}`);
    }
    current = next as JsonObject;
  }
  current[last] = value;
  return clone as unknown as ContextBuilderPolicyBindingValidationInput;
}

describe('WI-02 Context Builder Policy binding', () => {
  it('validates the metadata schema and accepts one canonical binding fixture', () => {
    const metadata = fixture('policy-binding-valid.json');
    expect(registry.validateContextBuilderPolicyBindingMetadata(metadata)).toEqual({
      valid: true,
      errors: [],
    });
    expect(validateContextBuilderPolicyBinding(bindingInput())).toEqual({
      valid: true,
      errors: [],
    });
  });

  it.each([
    [
      'initialRequest.builderPolicyRef.objectType',
      'zhiju.context.policy',
      'POLICY_OBJECT_TYPE_INVALID',
    ],
    [
      'initialRequest.builderPolicyRef.objectId',
      '018f22e2-7c15-7ca2-8d86-2de956a9d221',
      'POLICY_REF_MISMATCH',
    ],
    [
      'projectContext.projection.builderPolicyRef.versionId',
      '018f22e2-7c15-7ca2-8d86-2de956a9d222',
      'POLICY_REF_MISMATCH',
    ],
    [
      'workOrder.versionPins.contextBuilderPolicyRef.scope',
      {
        enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d299',
        projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d202',
      },
      'POLICY_REF_MISMATCH',
    ],
    ['contextBuildMetadata.contentHash.digest', 'b'.repeat(64), 'POLICY_CONTENT_HASH_MISMATCH'],
    ['resolvedPolicy.contentHash.digest', 'b'.repeat(64), 'POLICY_CONTENT_HASH_MISMATCH'],
    ['contextBuildMetadata.supersededAt', '2026-09-01T00:00:00Z', 'POLICY_VALIDITY_MISMATCH'],
  ] as const)('fails closed for %s', (path, value, code) => {
    const result = validateContextBuilderPolicyBinding(mutate(bindingInput(), path, value));
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === code)).toBe(true);
  });

  it('keeps historical Core readback valid while rejecting its legacy namespace for WI-02', () => {
    const historicalProjectContext = compatibilityFixture('core/project-context.json');
    expect(
      registry.validateCoreContract(
        'https://schemas.zhiju.local/core/project-context/1.0',
        historicalProjectContext,
      ),
    ).toEqual({ valid: true, errors: [] });

    const result = validateContextBuilderPolicyBinding(
      mutate(bindingInput(), 'initialRequest.builderPolicyRef.objectType', 'zhiju.context.policy'),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === 'POLICY_OBJECT_TYPE_INVALID')).toBe(true);
  });

  it.each([
    ['contextBuildMetadata', undefined, 'INVALID_POLICY_BINDING'],
    ['resolvedPolicy.builderPolicyRef', undefined, 'MISSING_POLICY_REF'],
  ] as const)('fails closed for missing %s', (path, value, code) => {
    const result = validateContextBuilderPolicyBinding(mutate(bindingInput(), path, value));
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === code)).toBe(true);
  });

  it.each([
    ['2026-07-31T23:59:59Z', 'POLICY_NOT_EFFECTIVE'],
    ['2026-10-01T00:00:00Z', 'POLICY_EXPIRED'],
  ] as const)('fails closed when Policy is not currently valid at %s', (now, code) => {
    const input = { ...bindingInput(), now };
    const result = validateContextBuilderPolicyBinding(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === code)).toBe(true);
  });

  it('is reusable at candidate assembly, Validator, and Freeze checkpoints', () => {
    for (const checkpoint of ['candidate assembly', 'Validator', 'Freeze']) {
      const result = validateContextBuilderPolicyBinding(bindingInput());
      expect(result, checkpoint).toEqual({ valid: true, errors: [] });
    }
  });
});
