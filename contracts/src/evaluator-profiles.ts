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

/** The approved first-version Evaluator profile selectors. */
export type EvaluatorProfileRegistryKey =
  | 'te.task_readiness.evaluator@1.0'
  | 'te.work_order_validation.evaluator@1.0'
  | 'te.agent_result_validation.evaluator@1.0'
  | 'te.work_order_validation.evaluator@2.0'
  | 'te.agent_result_validation.evaluator@2.0'
  | 'te.work_order_completion.evaluator@1.0'
  | 'te.task_completion.evaluator@1.0';

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

/** The approved registry contents. */
const approvedEntries: readonly { registryKey: EvaluatorProfileRegistryKey; owner: string }[] = [
  ...(
    [
      'te.work_order_validation.evaluator@2.0',
      'te.agent_result_validation.evaluator@2.0',
      'te.work_order_completion.evaluator@1.0',
      'te.task_completion.evaluator@1.0',
    ] as const
  ).map((registryKey) => ({ registryKey, owner: 'task-execution' })),
  { registryKey: 'te.task_readiness.evaluator@1.0', owner: 'task-execution' },
  { registryKey: 'te.work_order_validation.evaluator@1.0', owner: 'task-execution' },
  { registryKey: 'te.agent_result_validation.evaluator@1.0', owner: 'task-execution' },
];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Closed own-key inventory: a missing field, an extra field or a non-enumerable
 * field is not the declared shape. `Object.keys` would silently accept the last
 * one, which is exactly how a hidden field would enter a "matching" reference.
 */
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const names = Reflect.ownKeys(value);
  return (
    names.length === keys.length &&
    names.every((name) => typeof name === 'string' && keys.includes(name))
  );
}

/**
 * A Platform Scope is the empty object literal and nothing else, decided
 * structurally: the prototype is `Object.prototype` (or absent) and the own-key
 * inventory is empty. Serializing the candidate instead would drop `undefined`
 * fields and Map entries and throw on values it cannot represent, so a Scope
 * carrying hidden Platform fields could read as empty.
 */
function isPlatformScope(value: unknown): boolean {
  if (!record(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).length === 0
  );
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
    !isPlatformScope(value.scope)
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
 * Registry key of an exact canonical reference. The candidate must first be the
 * closed reference shape — exactly `kind`, `objectType`, `objectId`, `versionId`
 * and `scope`, with a structurally empty Platform Scope — and every identity
 * field must then equal the registry entry, so a shared suffix, a matching
 * `versionId` alone or a caller-crafted look-alike never resolves to a
 * registered selector. A malformed candidate stays malformed: it resolves to
 * nothing instead of letting serialization behaviour decide the comparison.
 */
export function registeredEvaluatorProfileKey(
  registryVersion: string,
  reference: unknown,
): EvaluatorProfileRegistryKey | undefined {
  if (
    registryVersion !== evaluatorProfileRegistry.registryVersion ||
    !record(reference) ||
    !exactKeys(reference, ['kind', 'objectType', 'objectId', 'versionId', 'scope']) ||
    !isPlatformScope(reference.scope)
  ) {
    return undefined;
  }
  return evaluatorProfileRegistry.profiles.find(
    (profile) =>
      reference.kind === profile.reference.kind &&
      reference.objectType === profile.reference.objectType &&
      reference.objectId === profile.reference.objectId &&
      reference.versionId === profile.reference.versionId,
  )?.registryKey;
}
