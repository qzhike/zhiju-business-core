// IM-02 WI-08 (issue #36): build-time static registries (PG-022). The
// Human-only Capability Registry and the Policy Schema Registry are
// declared at build time; the database only records which registry version
// was used. There is no online dynamic semantics change path.

import {
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredPolicyProfileKey,
  type Common,
} from '@zhiju/contracts';

/** Registry identity recorded with every grant/snapshot. */
export const HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION = 'im02-static-v1';

/**
 * Capabilities that AGENT/RUNTIME principals can never receive — not via
 * Role inheritance, not via actingFor, not through any Service passthrough.
 */
export const HUMAN_ONLY_CAPABILITIES: ReadonlySet<string> = new Set<string>([
  'quality.approval.decide',
  'release.authorize',
  'identity.human_only.probe',
]);

export function isHumanOnlyCapability(code: string): boolean {
  return HUMAN_ONLY_CAPABILITIES.has(code);
}

/** Policy schema references resolvable by the static registry (WI-08). */
export const POLICY_SCHEMA_REGISTRY_VERSION = 'im02-static-v1';

export const POLICY_SCHEMA_REGISTRY: ReadonlySet<string> = new Set<string>([
  'identity.PolicySnapshot@1.0',
  'identity.RolePolicy@1.0',
  'identity.CapabilityPolicy@1.0',
]);

export function isResolvablePolicySchemaRef(ref: string): boolean {
  return POLICY_SCHEMA_REGISTRY.has(ref);
}

/**
 * Public typed references for the static schema names stored by WI-08.
 * Persistence keeps the registry key for compatibility with the existing
 * command payload, while public PolicySnapshotView exposes the contract-level
 * VersionedRef required by the IdentityPolicy schema.
 */
const POLICY_SCHEMA_TYPED_REFS: Readonly<Record<string, Common.VersionedRef>> = {
  'identity.PolicySnapshot@1.0': {
    kind: 'VERSIONED',
    objectType: 'identity.contract_schema',
    objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d401',
    versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d411',
    scope: {},
  },
  'identity.RolePolicy@1.0': {
    kind: 'VERSIONED',
    objectType: 'identity.contract_schema',
    objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d402',
    versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d412',
    scope: {},
  },
  'identity.CapabilityPolicy@1.0': {
    kind: 'VERSIONED',
    objectType: 'identity.contract_schema',
    objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d403',
    versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d413',
    scope: {},
  },
};

export function policySchemaReference(ref: string): Common.VersionedRef | undefined {
  return POLICY_SCHEMA_TYPED_REFS[ref];
}

// ---------------------------------------------------------------------------
// IM-06 (#179): registration of a policy schema reference under a declared
// registry version.
//
// IdentityPolicy only answers "is this an exact registered canonical entry of
// the declared registry version". It never interprets the rule fields of an
// EnterpriseProject or TaskExecution profile, and it never lets a historical
// `im02-static-v1` entry stand in for a profile that a consumer requires.
// `identity.record_policy_snapshot@1.0` keeps its historical acceptance set.
// ---------------------------------------------------------------------------

/** Registry versions a policy schema reference can be registered against. */
export const POLICY_SCHEMA_REGISTRY_VERSIONS: readonly string[] = Object.freeze([
  POLICY_SCHEMA_REGISTRY_VERSION,
  POLICY_PROFILE_REGISTRY_VERSION,
]);

/**
 * Registry key of an exact registered canonical entry, or `undefined` when the
 * registry version is unknown, the reference is not canonical, or the entry is
 * not registered under that version.
 */
export function registeredPolicySchemaKey(
  registryVersion: string,
  reference: unknown,
): string | undefined {
  if (registryVersion === POLICY_SCHEMA_REGISTRY_VERSION) {
    return legacyPolicySchemaKey(reference);
  }
  if (registryVersion === POLICY_PROFILE_REGISTRY_VERSION) {
    return registeredPolicyProfileKey(registryVersion, reference);
  }
  return undefined;
}

function legacyPolicySchemaKey(reference: unknown): string | undefined {
  return Object.keys(POLICY_SCHEMA_TYPED_REFS).find((key) =>
    sameVersionedReference(POLICY_SCHEMA_TYPED_REFS[key], reference),
  );
}

function sameVersionedReference(
  expected: Common.VersionedRef | undefined,
  candidate: unknown,
): boolean {
  if (expected === undefined || candidate === null || typeof candidate !== 'object') return false;
  const reference = candidate as Record<string, unknown>;
  return (
    Object.keys(reference).length === 5 &&
    reference.kind === expected.kind &&
    reference.objectType === expected.objectType &&
    reference.objectId === expected.objectId &&
    reference.versionId === expected.versionId &&
    JSON.stringify(reference.scope) === JSON.stringify(expected.scope)
  );
}
