import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  EVALUATOR_PROFILE_REFERENCE_OBJECT_TYPE,
  EVALUATOR_PROFILE_REGISTRY_VERSION,
  evaluatorProfileRegistry,
  loadEvaluatorProfileRegistry,
  registeredEvaluatorProfileKey,
  registeredEvaluatorProfileReference,
} from './evaluator-profiles.js';

const registrySource = readFileSync(
  new URL('../../contracts/registry/evaluator-profiles.v1.json', import.meta.url),
  'utf8',
);
const generatedSource = readFileSync(
  new URL('./generated/evaluator-profiles.json', import.meta.url),
  'utf8',
);

const readinessKey = 'te.task_readiness.evaluator@1.0';
const validationKey = 'te.work_order_validation.evaluator@1.0';
const evaluatorKeys = [readinessKey, validationKey];

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * A Platform Scope is the empty object literal and nothing else. Each entry
 * below carries a Platform field outside the own-key inventory, is not a plain
 * object, or would only reveal itself through serialization — none of them is
 * an empty Platform Scope, so none of them may resolve or register.
 */
const malformedPlatformScopes: readonly unknown[] = [
  { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d4a1' },
  { enterpriseId: undefined },
  { enterpriseId: 1n },
  new Map([['enterpriseId', '018f22e2-7c15-7b2e-8d86-2de956a9d4a1']]),
  Object.defineProperty({}, 'enterpriseId', {
    value: '018f22e2-7c15-7b2e-8d86-2de956a9d4a1',
    enumerable: false,
  }),
  [],
  {
    toJSON: (): never => {
      throw new Error('candidate Scope must not be serialized');
    },
  },
];

interface RawEntry {
  registryKey?: string;
  owner?: string;
  reference?: Record<string, unknown>;
}

function rawRegistry(): { registryVersion: string; profiles: RawEntry[] } {
  return JSON.parse(registrySource) as { registryVersion: string; profiles: RawEntry[] };
}

function entry(profiles: RawEntry[], registryKey: string): RawEntry {
  const match = profiles.find((profile) => profile.registryKey === registryKey);
  if (match === undefined) throw new Error(`missing fixture entry ${registryKey}`);
  return match;
}

function mutatedRegistry(
  mutate: (registry: { registryVersion: string; profiles: RawEntry[] }) => void,
): unknown {
  const registry = rawRegistry();
  mutate(registry);
  return registry;
}

function reference(registryKey: string): Record<string, unknown> {
  const found = entry(rawRegistry().profiles, registryKey).reference;
  if (found === undefined) throw new Error(`missing fixture reference ${registryKey}`);
  return found;
}

describe('evaluator profile registry artifact', () => {
  it('registers the historical and four formal completion selectors owned by task-execution', () => {
    expect(evaluatorProfileRegistry.registryVersion).toBe(EVALUATOR_PROFILE_REGISTRY_VERSION);
    expect(
      evaluatorProfileRegistry.profiles.map((profile) => [profile.registryKey, profile.owner]),
    ).toEqual([
      [readinessKey, 'task-execution'],
      [validationKey, 'task-execution'],
      ['te.agent_result_validation.evaluator@1.0', 'task-execution'],
      ['te.work_order_validation.evaluator@2.0', 'task-execution'],
      ['te.agent_result_validation.evaluator@2.0', 'task-execution'],
      ['te.work_order_completion.evaluator@1.0', 'task-execution'],
      ['te.task_completion.evaluator@1.0', 'task-execution'],
      ['ep.delivery_item_completion.evaluator@2.0', 'enterprise-project'],
    ]);
  });

  it('maps every selector to a fixed Platform-scoped canonical evaluator profile', () => {
    const objectIds = new Set<string>();
    const versionIds = new Set<string>();
    for (const profile of evaluatorProfileRegistry.profiles) {
      expect(profile.reference.kind).toBe('VERSIONED');
      expect(profile.reference.objectType).toBe(
        profile.owner === 'enterprise-project'
          ? 'zhiju.project.evaluator_profile'
          : EVALUATOR_PROFILE_REFERENCE_OBJECT_TYPE,
      );
      expect(profile.reference.objectId).toMatch(uuidV7Pattern);
      expect(profile.reference.versionId).toMatch(uuidV7Pattern);
      expect(profile.reference.scope).toEqual({});
      expect(profile.reference).not.toHaveProperty('contentHash');
      objectIds.add(profile.reference.objectId);
      versionIds.add(profile.reference.versionId);
    }
    expect(objectIds.size).toBe(8);
    expect(versionIds.size).toBe(8);
  });

  it('keeps the generated build artifact byte-identical to the registry source', () => {
    expect(generatedSource).toBe(registrySource);
  });
});

describe('deterministic registry rejection', () => {
  it('rejects a duplicated registry key', () => {
    expect(() =>
      loadEvaluatorProfileRegistry(
        mutatedRegistry((registry) => {
          registry.profiles.push({ ...entry(registry.profiles, readinessKey) });
        }),
      ),
    ).toThrow(/duplicate evaluator profile registry key/u);
  });

  it('rejects a duplicated identity', () => {
    expect(() =>
      loadEvaluatorProfileRegistry(
        mutatedRegistry((registry) => {
          entry(registry.profiles, validationKey).reference = {
            ...reference(validationKey),
            objectId: reference(readinessKey).objectId,
          };
        }),
      ),
    ).toThrow(/duplicate evaluator profile identity/u);
    expect(() =>
      loadEvaluatorProfileRegistry(
        mutatedRegistry((registry) => {
          entry(registry.profiles, validationKey).reference = {
            ...reference(validationKey),
            versionId: reference(readinessKey).versionId,
          };
        }),
      ),
    ).toThrow(/duplicate evaluator profile identity/u);
  });

  it('rejects a missing mapping, an unapproved key and a wrong owner', () => {
    expect(() =>
      loadEvaluatorProfileRegistry(
        mutatedRegistry((registry) => {
          registry.profiles = registry.profiles.filter(
            (profile) => profile.registryKey !== validationKey,
          );
        }),
      ),
    ).toThrow(/missing evaluator profile mapping/u);
    expect(() =>
      loadEvaluatorProfileRegistry(
        mutatedRegistry((registry) => {
          entry(registry.profiles, readinessKey).registryKey = 'te.unapproved.evaluator@1.0';
        }),
      ),
    ).toThrow(/unapproved evaluator profile entry/u);
    expect(() =>
      loadEvaluatorProfileRegistry(
        mutatedRegistry((registry) => {
          entry(registry.profiles, readinessKey).owner = 'enterprise-project';
        }),
      ),
    ).toThrow(/unapproved evaluator profile entry/u);
  });

  it('rejects an unsupported registry version and a drifted registry shape', () => {
    expect(() =>
      loadEvaluatorProfileRegistry({
        ...rawRegistry(),
        registryVersion: 'im02-static-v1',
      }),
    ).toThrow(/unsupported evaluator profile registry version/u);
    expect(() => loadEvaluatorProfileRegistry({ ...rawRegistry(), profiles: [] })).toThrow(
      /missing evaluator profile mapping/u,
    );
    expect(() =>
      loadEvaluatorProfileRegistry({
        registryVersion: EVALUATOR_PROFILE_REGISTRY_VERSION,
        profiles: rawRegistry().profiles,
        policies: [],
      }),
    ).toThrow(/invalid evaluator profile registry/u);
  });

  it('rejects a reference that is not a Platform-scoped canonical selector', () => {
    const registered = reference(readinessKey);
    const rejected: readonly Record<string, unknown>[] = [
      { ...registered, objectType: 'zhiju.execution.task' },
      { ...registered, kind: 'SNAPSHOT' },
      { ...registered, objectId: '018f22e2-7c15-1b2e-8d86-2de956a9d4a0' },
      { ...registered, versionId: 'not-a-uuid' },
      { ...registered, contentHash: { algorithm: 'SHA-256', hashValue: 'x' } },
      ...malformedPlatformScopes.map((scope) => ({ ...registered, scope })),
    ];
    for (const candidate of rejected) {
      expect(() =>
        loadEvaluatorProfileRegistry(
          mutatedRegistry((registry) => {
            entry(registry.profiles, readinessKey).reference = candidate;
          }),
        ),
      ).toThrow(/invalid evaluator profile reference shape|Platform-scoped canonical selector/u);
    }
  });
});

describe('canonical selector resolution', () => {
  it('resolves each registered key to its canonical reference and back', () => {
    for (const registryKey of evaluatorKeys) {
      const canonical = registeredEvaluatorProfileReference(
        EVALUATOR_PROFILE_REGISTRY_VERSION,
        registryKey,
      );
      expect(canonical).toEqual(reference(registryKey));
      expect(registeredEvaluatorProfileKey(EVALUATOR_PROFILE_REGISTRY_VERSION, canonical)).toBe(
        registryKey,
      );
    }
  });

  it('resolves nothing for an unknown key or an unregistered registry version', () => {
    expect(
      registeredEvaluatorProfileReference(
        EVALUATOR_PROFILE_REGISTRY_VERSION,
        'te.task_readiness.evaluator@1.1',
      ),
    ).toBeUndefined();
    for (const candidate of [readinessKey, validationKey]) {
      expect(registeredEvaluatorProfileReference('im02-static-v1', candidate)).toBeUndefined();
      expect(
        registeredEvaluatorProfileKey(
          'im02-static-v1',
          registeredEvaluatorProfileReference(EVALUATOR_PROFILE_REGISTRY_VERSION, candidate),
        ),
      ).toBeUndefined();
    }
  });

  it('resolves nothing unless the whole typed reference matches', () => {
    const readiness = reference(readinessKey);
    const validation = reference(validationKey);
    const rejected: readonly unknown[] = [
      { ...readiness, objectType: 'zhiju.execution.evaluator' },
      { ...readiness, objectType: 'zhiju.execution.task' },
      { ...readiness, kind: 'OBJECT' },
      { ...readiness, objectId: validation.objectId },
      { ...readiness, versionId: validation.versionId },
      {
        ...readiness,
        objectId: validation.objectId,
        versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d4b3',
      },
      { ...readiness, scope: { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d4a1' } },
      ...malformedPlatformScopes.map((scope) => ({ ...readiness, scope })),
      { ...readiness, contentHash: { algorithm: 'SHA-256', hashValue: 'x' } },
      Object.defineProperty({ ...readiness }, 'contentHash', {
        value: { algorithm: 'SHA-256', hashValue: 'x' },
        enumerable: false,
      }),
      Object.fromEntries(Object.entries(readiness).filter(([name]) => name !== 'scope')),
      null,
      'te.task_readiness.evaluator@1.0',
      [readiness],
      undefined,
    ];
    for (const candidate of rejected) {
      expect(
        registeredEvaluatorProfileKey(EVALUATOR_PROFILE_REGISTRY_VERSION, candidate),
      ).toBeUndefined();
    }
    expect(registeredEvaluatorProfileKey(EVALUATOR_PROFILE_REGISTRY_VERSION, validation)).toBe(
      validationKey,
    );
  });
});
