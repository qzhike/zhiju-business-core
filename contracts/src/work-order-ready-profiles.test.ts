import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sha256CanonicalJson } from '@zhiju/shared-kernel';
import { workOrderSchema } from './core.schema.js';
import { createPolicyProfileDocumentValidator } from './policy-profile-documents.js';
import { POLICY_PROFILE_REGISTRY_VERSION } from './policy-profiles.js';
import {
  loadWorkOrderReadyProfileRegistry,
  resolveWorkOrderReadyProfile,
  workOrderReadyProfileRegistry,
} from './work-order-ready-profiles.js';

const source = readFileSync(
  new URL('../registry/work-order-ready-profiles.v1.json', import.meta.url),
  'utf8',
);
const key = 'execution.work_order_controls.policy@1.0';
function firstProfile(registry: Record<string, unknown>): Record<string, unknown> {
  const first = (registry.profiles as Record<string, unknown>[])[0];
  if (first === undefined) throw new Error('missing profile fixture');
  return first;
}
const validator = createPolicyProfileDocumentValidator();
const fixture = JSON.parse(
  readFileSync(
    new URL('../../tests/fixtures/contracts/core/work-order-valid.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;
const controlKeys = [
  'targetScope',
  'allowedCapabilities',
  'deniedCapabilities',
  'expectedOutputs',
  'riskAndQuality',
  'executionPolicy',
  'budget',
  'harnessPolicy',
  'modelPolicy',
];
function document() {
  return { controls: Object.fromEntries(controlKeys.map((k) => [k, structuredClone(fixture[k])])) };
}

describe('WorkOrder READY dependency registration', () => {
  it('pins the source, generated artifact and actual Core schema', () => {
    expect(
      readFileSync(new URL('./generated/work-order-ready-profiles.json', import.meta.url), 'utf8'),
    ).toBe(source);
    expect(loadWorkOrderReadyProfileRegistry(JSON.parse(source))).toEqual(
      workOrderReadyProfileRegistry,
    );
    expect(workOrderReadyProfileRegistry.profiles[0]?.descriptor.schemaId).toBe(
      workOrderSchema.$id,
    );
  });
  it('resolves only complete registered identities and hashes only the descriptor', () => {
    for (const entry of workOrderReadyProfileRegistry.profiles) {
      expect(
        resolveWorkOrderReadyProfile(entry.reference, entry.registryKey)?.descriptorHash.digest,
      ).toBe(sha256CanonicalJson(entry.descriptor));
      for (const mutation of [
        { ...entry.reference, objectId: entry.reference.versionId },
        { ...entry.reference, versionId: entry.reference.objectId },
        { ...entry.reference, objectType: 'legacy.schema' },
        { ...entry.reference, scope: { projectId: entry.reference.objectId } },
        { ...entry.reference, extra: true },
      ])
        expect(resolveWorkOrderReadyProfile(mutation, entry.registryKey)).toBeUndefined();
    }
  });
  it('rejects descriptor, owner, identity, duplicate and registry version drift', () => {
    for (const mutate of [
      (r: Record<string, unknown>) => {
        r.registryVersion = 'unknown';
      },
      (r: Record<string, unknown>) => {
        (r.profiles as Record<string, unknown>[]).push(firstProfile(r));
      },
      ...['owner', 'reference', 'descriptor'].map((k) => (r: Record<string, unknown>) => {
        firstProfile(r)[k] = {};
      }),
    ]) {
      const value = JSON.parse(source) as Record<string, unknown>;
      mutate(value);
      expect(() => loadWorkOrderReadyProfileRegistry(value)).toThrow();
    }
  });
  it('reuses all nine Core control structures in a closed policy document', () => {
    expect(validator.validate(POLICY_PROFILE_REGISTRY_VERSION, key, document()).valid).toBe(true);
    for (const missing of controlKeys) {
      const value = {
        controls: Object.fromEntries(
          Object.entries(document().controls).filter(([name]) => name !== missing),
        ),
      };
      expect(validator.validate(POLICY_PROFILE_REGISTRY_VERSION, key, value).valid).toBe(false);
    }
    for (const value of [
      { ...document(), extra: true },
      { controls: { ...document().controls, extra: true } },
      { controls: { ...document().controls, budget: {} } },
    ]) {
      expect(validator.validate(POLICY_PROFILE_REGISTRY_VERSION, key, value).valid).toBe(false);
    }
  });
});
