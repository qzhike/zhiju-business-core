import profileRegistryData from './generated/policy-profiles.json' with { type: 'json' };
import type { Common } from './generated/types/common.js';
import type { JsonSchema } from './schema-types.js';

// =============================================================================
// IM-06 build-time Policy profile registry (`im06-static-v1`)
// =============================================================================
//
// `contracts/registry/policy-profiles.v1.json` is the source of truth and
// `contracts/src/generated/policy-profiles.json` is its byte-identical build
// artifact (drift is rejected by `pnpm contracts:check`).
//
// The registry carries two things and nothing else:
//
// 1. the one-to-one mapping between a registry key and a canonical
//    `VersionedRef` (`objectType=identity.contract_schema`, fixed UuidV7
//    objectId/versionId, Platform Scope) — no database row, no fabricated
//    content hash, no latest resolution at run time;
// 2. for the four approved first-version profiles, the closed rule-field
//    schema of their `policyDocument`.
//
// Owning boundaries (design decision §12.4 / Spec 001 §13.5): this module only
// answers "is this a registered canonical entry" and "does the document match
// the registered closed schema". The rule *semantics* stay with the consuming
// module (EnterpriseProject / TaskExecution), which decides which profile key
// it requires.
// =============================================================================

/** Registry version carrying the historical three entries plus the four profiles. */
export const POLICY_PROFILE_REGISTRY_VERSION = 'im06-static-v1';

/** Canonical `objectType` of every build-time registered policy schema entry. */
export const POLICY_SCHEMA_REFERENCE_OBJECT_TYPE = 'identity.contract_schema';

const registrySchemaId = 'https://schemas.zhiju.local/registry/policy-profiles/im06-static-v1';

const registryKeyPattern = /^[a-z][A-Za-z0-9]*(?:[._][A-Za-z0-9]+)*@\d+\.\d+$/u;
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface PolicyProfileEntry {
  readonly registryKey: string;
  readonly owner: string;
  readonly reference: Common.VersionedRef;
  /** Closed `policyDocument` schema; absent for entries that declare no closed fields. */
  readonly documentSchema?: JsonSchema;
}

export interface PolicyProfileRegistry {
  readonly registryVersion: string;
  readonly profiles: readonly PolicyProfileEntry[];
}

interface ApprovedEntry {
  readonly registryKey: string;
  readonly owner: string;
  /** Approved closed field set; absent for the historical entries carried forward. */
  readonly fields?: readonly string[];
  readonly requiredFields?: readonly string[];
}

/**
 * The approved registry contents. Entries without `fields` are the historical
 * `im02-static-v1` schemas carried forward, whose closed fields stay owned by
 * their original implementation; the four profiles below are the first-version
 * closed rule sets approved in design decision §12.4.
 */
const approvedEntries: readonly ApprovedEntry[] = [
  { registryKey: 'identity.PolicySnapshot@1.0', owner: 'identity-policy' },
  { registryKey: 'identity.RolePolicy@1.0', owner: 'identity-policy' },
  { registryKey: 'identity.CapabilityPolicy@1.0', owner: 'identity-policy' },
  {
    registryKey: 'ep.context_source_slice_capture.policy@1.0',
    owner: 'enterprise-project',
    fields: ['maxSliceValiditySeconds', 'allowedPurposeCodes'],
    requiredFields: ['maxSliceValiditySeconds', 'allowedPurposeCodes'],
  },
  {
    registryKey: 'execution.context_builder.policy@1.0',
    owner: 'task-execution',
    fields: ['allowedProjectionTypes'],
    requiredFields: ['allowedProjectionTypes'],
  },
  {
    registryKey: 'execution.task_readiness.policy@1.0',
    owner: 'task-execution',
    fields: ['maxReadinessValiditySeconds'],
    requiredFields: ['maxReadinessValiditySeconds'],
  },
  {
    registryKey: 'execution.work_order_validation.policy@1.0',
    owner: 'task-execution',
    fields: ['maxValidationValiditySeconds', 'mandatoryCriterionTypes'],
    requiredFields: ['maxValidationValiditySeconds'],
  },
];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const names = Object.keys(value);
  return names.length === keys.length && names.every((name) => keys.includes(name));
}

function uniqueStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return undefined;
  const names = value as string[];
  return new Set(names).size === names.length ? names : undefined;
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && expected.every((name) => actual.includes(name));
}

function parseReference(value: unknown): Common.VersionedRef {
  if (
    !record(value) ||
    !exactKeys(value, ['kind', 'objectType', 'objectId', 'versionId', 'scope'])
  ) {
    throw new Error('invalid policy profile reference shape');
  }
  if (
    value.kind !== 'VERSIONED' ||
    value.objectType !== POLICY_SCHEMA_REFERENCE_OBJECT_TYPE ||
    typeof value.objectId !== 'string' ||
    !uuidV7Pattern.test(value.objectId) ||
    typeof value.versionId !== 'string' ||
    !uuidV7Pattern.test(value.versionId) ||
    !record(value.scope) ||
    Object.keys(value.scope).length !== 0
  ) {
    throw new Error('policy profile reference must be a Platform-scoped canonical contract schema');
  }
  return Object.freeze({
    kind: 'VERSIONED',
    objectType: POLICY_SCHEMA_REFERENCE_OBJECT_TYPE,
    objectId: value.objectId,
    versionId: value.versionId,
    scope: Object.freeze({}),
  });
}

/**
 * Accept the closed field schema of a first-version profile only when it stays
 * closed and exposes exactly the approved fields, so that neither a silent
 * field extension nor a dropped required field passes the build check.
 */
function parseDocumentSchema(value: unknown, approved: ApprovedEntry): JsonSchema {
  if (
    !record(value) ||
    value.type !== 'object' ||
    value.additionalProperties !== false ||
    !record(value.properties)
  ) {
    throw new Error(`policy profile schema must be a closed object: ${approved.registryKey}`);
  }
  const requiredFields = uniqueStrings(value.required);
  if (
    requiredFields === undefined ||
    approved.fields === undefined ||
    !sameNames(Object.keys(value.properties), approved.fields) ||
    !sameNames(requiredFields, approved.requiredFields ?? [])
  ) {
    throw new Error(`policy profile fields drifted from the approved set: ${approved.registryKey}`);
  }
  return value;
}

export function loadPolicyProfileRegistry(input: unknown): PolicyProfileRegistry {
  if (
    !record(input) ||
    !exactKeys(input, ['registryVersion', 'profiles']) ||
    typeof input.registryVersion !== 'string' ||
    !Array.isArray(input.profiles)
  ) {
    throw new Error('invalid policy profile registry');
  }
  if (input.registryVersion !== POLICY_PROFILE_REGISTRY_VERSION) {
    throw new Error(`unsupported policy profile registry version: ${input.registryVersion}`);
  }

  const profiles: PolicyProfileEntry[] = [];
  const objectIds = new Set<string>();
  const versionIds = new Set<string>();
  for (const entry of input.profiles as unknown[]) {
    if (
      !record(entry) ||
      !(
        exactKeys(entry, ['registryKey', 'owner', 'reference', 'documentSchema']) ||
        exactKeys(entry, ['registryKey', 'owner', 'reference'])
      )
    ) {
      throw new Error('invalid policy profile registry entry');
    }
    const registryKey = entry.registryKey;
    if (typeof registryKey !== 'string' || !registryKeyPattern.test(registryKey)) {
      throw new Error('invalid policy profile registry key');
    }
    const approved = approvedEntries.find((candidate) => candidate.registryKey === registryKey);
    if (approved === undefined || entry.owner !== approved.owner) {
      throw new Error(`unapproved policy profile entry: ${registryKey}`);
    }
    if (profiles.some((profile) => profile.registryKey === registryKey)) {
      throw new Error(`duplicate policy profile registry key: ${registryKey}`);
    }
    const reference = parseReference(entry.reference);
    if (objectIds.has(reference.objectId) || versionIds.has(reference.versionId)) {
      throw new Error(`duplicate policy profile identity: ${registryKey}`);
    }
    objectIds.add(reference.objectId);
    versionIds.add(reference.versionId);

    if (approved.fields === undefined) {
      if (entry.documentSchema !== undefined) {
        throw new Error(`unexpected closed policy profile schema: ${registryKey}`);
      }
      profiles.push(Object.freeze({ registryKey, owner: approved.owner, reference }));
      continue;
    }
    if (entry.documentSchema === undefined) {
      throw new Error(`missing closed policy profile schema: ${registryKey}`);
    }
    profiles.push(
      Object.freeze({
        registryKey,
        owner: approved.owner,
        reference,
        documentSchema: parseDocumentSchema(entry.documentSchema, approved),
      }),
    );
  }
  for (const approved of approvedEntries) {
    if (!profiles.some((profile) => profile.registryKey === approved.registryKey)) {
      throw new Error(`missing policy profile mapping: ${approved.registryKey}`);
    }
  }
  return Object.freeze({
    registryVersion: input.registryVersion,
    profiles: Object.freeze(profiles),
  });
}

/**
 * The frozen build-time registry. Loading it validates every mapping and
 * closed schema once, so a duplicated key/identity or a drifted field set
 * fails the process instead of reaching a consumer.
 */
export const policyProfileRegistry = loadPolicyProfileRegistry(profileRegistryData);

/** Canonical reference of a registered profile key; unknown key/version fails closed. */
export function registeredPolicyProfileReference(
  registryVersion: string,
  registryKey: string,
): Common.VersionedRef | undefined {
  return policyProfileReference(policyProfileRegistry, registryVersion, registryKey);
}

/** Registry key of an exact canonical reference; unregistered inputs fail closed. */
export function registeredPolicyProfileKey(
  registryVersion: string,
  reference: unknown,
): string | undefined {
  return resolvePolicyProfileKey(policyProfileRegistry, registryVersion, reference);
}

export function policyProfileDefinitionName(registryKey: string): string {
  return `${registryKey.replaceAll('.', '_').replaceAll('@', '_')}_document`;
}

/** Ajv root schema holding the closed `policyDocument` schema of every profile. */
export function policyProfileRegistrySchema(registry: PolicyProfileRegistry): JsonSchema {
  return {
    $id: registrySchemaId,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: Object.fromEntries(
      registry.profiles
        .filter((profile) => profile.documentSchema !== undefined)
        .map((profile) => [
          policyProfileDefinitionName(profile.registryKey),
          profile.documentSchema,
        ]),
    ),
  };
}

export function policyProfileEntry(
  registry: PolicyProfileRegistry,
  registryVersion: string,
  registryKey: string,
): PolicyProfileEntry | undefined {
  if (registryVersion !== registry.registryVersion) return undefined;
  return registry.profiles.find((profile) => profile.registryKey === registryKey);
}

export function policyProfileReference(
  registry: PolicyProfileRegistry,
  registryVersion: string,
  registryKey: string,
): Common.VersionedRef | undefined {
  return policyProfileEntry(registry, registryVersion, registryKey)?.reference;
}

/** Exact `$ref` of the closed `policyDocument` schema; unregistered profiles fail closed. */
export function policyProfileDocumentSchemaRef(
  registry: PolicyProfileRegistry,
  registryVersion: string,
  registryKey: string,
): string | undefined {
  const entry = policyProfileEntry(registry, registryVersion, registryKey);
  if (entry?.documentSchema === undefined) return undefined;
  return `${registrySchemaId}#/$defs/${policyProfileDefinitionName(registryKey)}`;
}

/**
 * Exact field-by-field comparison of a candidate typed reference against the
 * canonical registry entries. A registry version the build did not register —
 * or a reference with a different objectType/objectId/versionId/Scope —
 * resolves to nothing.
 */
export function resolvePolicyProfileKey(
  registry: PolicyProfileRegistry,
  registryVersion: string,
  reference: unknown,
): string | undefined {
  if (registryVersion !== registry.registryVersion || !record(reference)) return undefined;
  if (Object.keys(reference).length !== 5) return undefined;
  return registry.profiles.find((profile) => {
    const expected = profile.reference;
    return (
      reference.kind === expected.kind &&
      reference.objectType === expected.objectType &&
      reference.objectId === expected.objectId &&
      reference.versionId === expected.versionId &&
      JSON.stringify(reference.scope) === JSON.stringify(expected.scope)
    );
  })?.registryKey;
}
