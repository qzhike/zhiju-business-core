// IM-02 WI-08 (issue #36): build-time static registries (PG-022). The
// Human-only Capability Registry and the Policy Schema Registry are
// declared at build time; the database only records which registry version
// was used. There is no online dynamic semantics change path.

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
