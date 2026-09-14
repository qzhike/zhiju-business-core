import registryData from './generated/evaluator-profiles.json' with { type: 'json' };
import type { Common } from './generated/types/common.js';

// =============================================================================
// IM-06 build-time Evaluator profile registry (`im06-evaluator-static-v1`)
// =============================================================================
//
// `contracts/registry/evaluator-profiles.v1.json` is the source of truth and
// `contracts/src/generated/evaluator-profiles.json` is its byte-identical build
// artifact (drift is rejected by `pnpm contracts:check`).
//
// The registry carries one thing and nothing else: the one-to-one mapping
// between a registry key and the canonical `VersionedRef<Evaluator>` of a
// first-version profile selector (`objectType=zhiju.execution.evaluator_profile`,
// fixed UuidV7 objectId/versionId, Platform Scope). An Evaluator profile is
// deterministic implementation code registered at build time, so its entry
// carries no `contentHash`, no database row and no Policy version lifecycle,
// and it is never resolved as latest (design decision §12.4 / Spec 003 §11.9).
//
// Owning boundary: this module answers only "is this a registered canonical
// selector, and which key does it name". Whether a consumer supports the
// selector stays with the owning module, which rejects everything else.
// =============================================================================

/** Registry version carrying the first-version Evaluator profile selectors. */
export const EVALUATOR_PROFILE_REGISTRY_VERSION = 'im06-evaluator-static-v1';

/** Canonical `objectType` of every build-time registered Evaluator profile. */
export const EVALUATOR_PROFILE_REFERENCE_OBJECT_TYPE = 'zhiju.execution.evaluator_profile';

/** The approved first-version Evaluator profile selectors, and only these two. */
export type EvaluatorProfileRegistryKey =
  'te.task_readiness.evaluator@1.0' | 'te.work_order_validation.evaluator@1.0';

const registryKeyPattern = /^[a-z][A-Za-z0-9]*(?:[._][A-Za-z0-9]+)*@\d+\.\d+$/u;
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface EvaluatorProfileEntry {
  readonly registryKey: EvaluatorProfileRegistryKey;
  readonly owner: string;
  readonly reference: Common.VersionedRef;
}

export interface EvaluatorProfileRegistry {
  readonly registryVersion: string;
  readonly profiles: readonly EvaluatorProfileEntry[];
}

/** The approved registry contents: two selectors, no more and no fewer. */
const approvedEntries: readonly { registryKey: EvaluatorProfileRegistryKey; owner: string }[] = [
  { registryKey: 'te.task_readiness.evaluator@1.0', owner: 'task-execution' },
  { registryKey: 'te.work_order_validation.evaluator@1.0', owner: 'task-execution' },
];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const names = Object.keys(value);
  return names.length === keys.length && names.every((name) => keys.includes(name));
}

/**
 * Accept only a Platform-scoped canonical selector: a non-empty Scope, another
 * objectType, a non-UuidV7 id or a non-`VERSIONED` kind cannot enter the
 * registry, so no entry can describe a look-alike identity.
 */
function parseReference(value: unknown): Common.VersionedRef {
  if (
    !record(value) ||
    !exactKeys(value, ['kind', 'objectType', 'objectId', 'versionId', 'scope'])
  ) {
    throw new Error('invalid evaluator profile reference shape');
  }
  if (
    value.kind !== 'VERSIONED' ||
    value.objectType !== EVALUATOR_PROFILE_REFERENCE_OBJECT_TYPE ||
    typeof value.objectId !== 'string' ||
    !uuidV7Pattern.test(value.objectId) ||
    typeof value.versionId !== 'string' ||
    !uuidV7Pattern.test(value.versionId) ||
    !record(value.scope) ||
    Object.keys(value.scope).length !== 0
  ) {
    throw new Error('evaluator profile reference must be a Platform-scoped canonical selector');
  }
  return Object.freeze({
    kind: 'VERSIONED',
    objectType: EVALUATOR_PROFILE_REFERENCE_OBJECT_TYPE,
    objectId: value.objectId,
    versionId: value.versionId,
    scope: Object.freeze({}),
  });
}

export function loadEvaluatorProfileRegistry(input: unknown): EvaluatorProfileRegistry {
  if (
    !record(input) ||
    !exactKeys(input, ['registryVersion', 'profiles']) ||
    typeof input.registryVersion !== 'string' ||
    !Array.isArray(input.profiles)
  ) {
    throw new Error('invalid evaluator profile registry');
  }
  if (input.registryVersion !== EVALUATOR_PROFILE_REGISTRY_VERSION) {
    throw new Error(`unsupported evaluator profile registry version: ${input.registryVersion}`);
  }

  const profiles: EvaluatorProfileEntry[] = [];
  const objectIds = new Set<string>();
  const versionIds = new Set<string>();
  for (const entry of input.profiles as unknown[]) {
    if (!record(entry) || !exactKeys(entry, ['registryKey', 'owner', 'reference'])) {
      throw new Error('invalid evaluator profile registry entry');
    }
    const registryKey = entry.registryKey;
    if (typeof registryKey !== 'string' || !registryKeyPattern.test(registryKey)) {
      throw new Error('invalid evaluator profile registry key');
    }
    const approved = approvedEntries.find((candidate) => candidate.registryKey === registryKey);
    if (approved === undefined || entry.owner !== approved.owner) {
      throw new Error(`unapproved evaluator profile entry: ${registryKey}`);
    }
    if (profiles.some((profile) => profile.registryKey === registryKey)) {
      throw new Error(`duplicate evaluator profile registry key: ${registryKey}`);
    }
    const reference = parseReference(entry.reference);
    if (objectIds.has(reference.objectId) || versionIds.has(reference.versionId)) {
      throw new Error(`duplicate evaluator profile identity: ${registryKey}`);
    }
    objectIds.add(reference.objectId);
    versionIds.add(reference.versionId);
    profiles.push(
      Object.freeze({ registryKey: approved.registryKey, owner: approved.owner, reference }),
    );
  }
  for (const approved of approvedEntries) {
    if (!profiles.some((profile) => profile.registryKey === approved.registryKey)) {
      throw new Error(`missing evaluator profile mapping: ${approved.registryKey}`);
    }
  }
  return Object.freeze({
    registryVersion: input.registryVersion,
    profiles: Object.freeze(profiles),
  });
}

/**
 * The frozen build-time registry. Loading it validates every mapping once, so a
 * duplicated key/identity, a missing entry, a wrong owner or a non-canonical
 * reference fails the build instead of reaching a consumer.
 */
export const evaluatorProfileRegistry = loadEvaluatorProfileRegistry(registryData);

/**
 * Canonical reference of a registered Evaluator profile key. An unknown key or
 * a registry version this build did not register resolves to nothing: there is
 * no latest lookup and no other registry version to fall back on.
 */
export function registeredEvaluatorProfileReference(
  registryVersion: string,
  registryKey: string,
): Common.VersionedRef | undefined {
  if (registryVersion !== evaluatorProfileRegistry.registryVersion) return undefined;
  return evaluatorProfileRegistry.profiles.find((profile) => profile.registryKey === registryKey)
    ?.reference;
}

/**
 * Registry key of an exact canonical reference. The comparison is field by
 * field over the whole typed reference — kind, objectType, objectId, versionId
 * and Scope — so a shared suffix, a matching versionId alone or a
 * caller-crafted look-alike never resolves to a registered selector.
 */
export function registeredEvaluatorProfileKey(
  registryVersion: string,
  reference: unknown,
): EvaluatorProfileRegistryKey | undefined {
  if (registryVersion !== evaluatorProfileRegistry.registryVersion || !record(reference)) {
    return undefined;
  }
  if (Object.keys(reference).length !== 5) return undefined;
  return evaluatorProfileRegistry.profiles.find((profile) => {
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
