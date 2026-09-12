import { describe, expect, it } from 'vitest';
import {
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredPolicyProfileKey,
  registeredPolicyProfileReference,
  type Common,
} from '@zhiju/contracts';

import {
  isResolvablePolicySchemaRef,
  policySchemaReference,
  POLICY_SCHEMA_REGISTRY,
  POLICY_SCHEMA_REGISTRY_VERSIONS,
  POLICY_SCHEMA_REGISTRY_VERSION,
  registeredPolicySchemaKey,
} from './static-registry.js';

const legacyKeys = [
  'identity.PolicySnapshot@1.0',
  'identity.RolePolicy@1.0',
  'identity.CapabilityPolicy@1.0',
];
const profileKeys = [
  'ep.context_source_slice_capture.policy@1.0',
  'execution.context_builder.policy@1.0',
  'execution.task_readiness.policy@1.0',
  'execution.work_order_validation.policy@1.0',
];

function legacyReference(registryKey: string): Common.VersionedRef {
  const reference = policySchemaReference(registryKey);
  if (reference === undefined) throw new Error(`missing legacy reference ${registryKey}`);
  return reference;
}

function profileReference(registryKey: string): Common.VersionedRef {
  const reference = registeredPolicyProfileReference(POLICY_PROFILE_REGISTRY_VERSION, registryKey);
  if (reference === undefined) throw new Error(`missing profile reference ${registryKey}`);
  return reference;
}

describe('historical im02-static-v1 acceptance set', () => {
  it('is unchanged and rejects a profile key', () => {
    expect(POLICY_SCHEMA_REGISTRY_VERSION).toBe('im02-static-v1');
    expect([...POLICY_SCHEMA_REGISTRY].sort()).toEqual([...legacyKeys].sort());
    for (const key of legacyKeys) expect(isResolvablePolicySchemaRef(key)).toBe(true);
    for (const key of profileKeys) expect(isResolvablePolicySchemaRef(key)).toBe(false);
    expect(isResolvablePolicySchemaRef('identity.UnknownPolicy@9.0')).toBe(false);
  });

  it('keeps the historical typed reference mapping intact', () => {
    for (const key of legacyKeys) {
      expect(policySchemaReference(key)).toEqual(
        registeredPolicyProfileReference(POLICY_PROFILE_REGISTRY_VERSION, key),
      );
    }
    expect(policySchemaReference('identity.UnknownPolicy@9.0')).toBeUndefined();
  });
});

describe('policy schema registration under a declared registry version', () => {
  it('exposes exactly the historical version and the profile registry version', () => {
    expect(POLICY_SCHEMA_REGISTRY_VERSIONS).toEqual([
      POLICY_SCHEMA_REGISTRY_VERSION,
      POLICY_PROFILE_REGISTRY_VERSION,
    ]);
  });

  it('resolves the four profile references only under im06-static-v1', () => {
    for (const key of profileKeys) {
      const reference = profileReference(key);
      expect(registeredPolicySchemaKey(POLICY_PROFILE_REGISTRY_VERSION, reference)).toBe(key);
      expect(registeredPolicySchemaKey(POLICY_SCHEMA_REGISTRY_VERSION, reference)).toBeUndefined();
    }
  });

  it('keeps the historical entries registered under both versions', () => {
    for (const key of legacyKeys) {
      const reference = legacyReference(key);
      expect(registeredPolicySchemaKey(POLICY_SCHEMA_REGISTRY_VERSION, reference)).toBe(key);
      expect(registeredPolicySchemaKey(POLICY_PROFILE_REGISTRY_VERSION, reference)).toBe(key);
    }
  });

  it('never lets a historical entry stand in for a profile', () => {
    const legacy = legacyReference(legacyKeys[0] ?? '');
    const resolved = registeredPolicySchemaKey(POLICY_PROFILE_REGISTRY_VERSION, legacy);
    expect(resolved).toBe('identity.PolicySnapshot@1.0');
    expect(profileKeys).not.toContain(resolved);
    for (const key of profileKeys) {
      expect(registeredPolicySchemaKey(POLICY_PROFILE_REGISTRY_VERSION, legacy)).not.toBe(key);
    }
  });

  it('fails closed for an unknown registry version or a non-canonical reference', () => {
    const reference = profileReference(profileKeys[0] ?? '');
    expect(registeredPolicySchemaKey('im99-static-v1', reference)).toBeUndefined();
    expect(registeredPolicySchemaKey(POLICY_PROFILE_REGISTRY_VERSION, undefined)).toBeUndefined();
    expect(
      registeredPolicySchemaKey(POLICY_PROFILE_REGISTRY_VERSION, 'im06-static-v1'),
    ).toBeUndefined();
    expect(
      registeredPolicySchemaKey(POLICY_PROFILE_REGISTRY_VERSION, {
        ...reference,
        objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d401',
      }),
    ).toBeUndefined();
    expect(
      registeredPolicySchemaKey(POLICY_PROFILE_REGISTRY_VERSION, {
        ...reference,
        versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d411',
      }),
    ).toBeUndefined();
    expect(
      registeredPolicySchemaKey(POLICY_PROFILE_REGISTRY_VERSION, {
        ...reference,
        scope: { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d401' },
      }),
    ).toBeUndefined();
    expect(
      registeredPolicySchemaKey(POLICY_PROFILE_REGISTRY_VERSION, {
        ...reference,
        objectType: 'zhiju.identity.policy',
      }),
    ).toBeUndefined();
    expect(
      registeredPolicySchemaKey(POLICY_PROFILE_REGISTRY_VERSION, { ...reference, extra: true }),
    ).toBeUndefined();
    expect(registeredPolicyProfileKey(POLICY_PROFILE_REGISTRY_VERSION, reference)).toBe(
      profileKeys[0],
    );
  });
});
