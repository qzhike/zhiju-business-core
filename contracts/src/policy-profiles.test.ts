import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { commonSchema } from './common.schema.js';
import { workOrderSchema } from './core.schema.js';
import { createPolicyProfileDocumentValidator } from './policy-profile-documents.js';
import {
  loadPolicyProfileRegistry,
  policyProfileDocumentSchemaRef,
  POLICY_PROFILE_REGISTRY_VERSION,
  policyProfileRegistry,
  registeredPolicyProfileKey,
  registeredPolicyProfileReference,
} from './policy-profiles.js';
import { ContractRegistry } from './registry.js';

const registrySourceUrl = new URL(
  '../../contracts/registry/policy-profiles.v1.json',
  import.meta.url,
);
const registrySource = readFileSync(registrySourceUrl, 'utf8');
const generatedSource = readFileSync(
  new URL('./generated/policy-profiles.json', import.meta.url),
  'utf8',
);

const captureKey = 'ep.context_source_slice_capture.policy@1.0';
const builderKey = 'execution.context_builder.policy@1.0';
const readinessKey = 'execution.task_readiness.policy@1.0';
const validationKey = 'execution.work_order_validation.policy@1.0';
const controlsKey = 'execution.work_order_controls.policy@1.0';
const recoveryControlsKey = 'execution.work_order_controls.policy@1.1';
const policySnapshotKey = 'identity.PolicySnapshot@1.0';
const legacyKeys = [policySnapshotKey, 'identity.RolePolicy@1.0', 'identity.CapabilityPolicy@1.0'];

const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function fixture(name: string): Record<string, unknown> {
  const url = new URL(`../../tests/fixtures/contracts/policy-profiles/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

interface RawProfileEntry {
  registryKey?: string;
  owner?: string;
  reference?: Record<string, unknown>;
  documentSchema?: Record<string, unknown>;
}

function rawRegistry(): { registryVersion: string; profiles: RawProfileEntry[] } {
  return JSON.parse(registrySource) as { registryVersion: string; profiles: RawProfileEntry[] };
}

function entry(profiles: RawProfileEntry[], registryKey: string): RawProfileEntry {
  const match = profiles.find((profile) => profile.registryKey === registryKey);
  if (match === undefined) throw new Error(`missing fixture entry ${registryKey}`);
  return match;
}

function omitKey(source: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([name]) => name !== key));
}

function mutatedRegistry(mutate: (profiles: RawProfileEntry[]) => void): unknown {
  const registry = rawRegistry();
  mutate(registry.profiles);
  return registry;
}

const documents = createPolicyProfileDocumentValidator();

describe('policy profile registry artifact', () => {
  it('registers the three historical entries and the five approved profiles', () => {
    expect(policyProfileRegistry.registryVersion).toBe(POLICY_PROFILE_REGISTRY_VERSION);
    expect(policyProfileRegistry.profiles.map((profile) => profile.registryKey)).toEqual([
      ...legacyKeys,
      captureKey,
      builderKey,
      readinessKey,
      validationKey,
      controlsKey,
      recoveryControlsKey,
      'execution.work_order_controls.policy@2.0',
      'execution.completion.policy@1.0',
    ]);
    expect(
      policyProfileRegistry.profiles.map((profile) => [profile.registryKey, profile.owner]),
    ).toEqual([
      [policySnapshotKey, 'identity-policy'],
      [legacyKeys[1], 'identity-policy'],
      [legacyKeys[2], 'identity-policy'],
      [captureKey, 'enterprise-project'],
      [builderKey, 'task-execution'],
      [readinessKey, 'task-execution'],
      [validationKey, 'task-execution'],
      [controlsKey, 'task-execution'],
      [recoveryControlsKey, 'task-execution'],
      ['execution.work_order_controls.policy@2.0', 'task-execution'],
      ['execution.completion.policy@1.0', 'task-execution'],
    ]);
  });

  it('maps every registry key to a fixed canonical Platform-scoped contract schema', () => {
    const objectIds = new Set<string>();
    const versionIds = new Set<string>();
    for (const profile of policyProfileRegistry.profiles) {
      expect(profile.reference.kind).toBe('VERSIONED');
      expect(profile.reference.objectType).toBe('identity.contract_schema');
      expect(profile.reference.objectId).toMatch(uuidV7Pattern);
      expect(profile.reference.versionId).toMatch(uuidV7Pattern);
      expect(profile.reference.scope).toEqual({});
      objectIds.add(profile.reference.objectId);
      versionIds.add(profile.reference.versionId);
    }
    expect(objectIds.size).toBe(policyProfileRegistry.profiles.length - 1);
    expect(versionIds.size).toBe(policyProfileRegistry.profiles.length);
  });

  it('exposes a closed document schema only for the five approved profiles', () => {
    for (const key of legacyKeys) {
      expect(
        policyProfileRegistry.profiles.find((profile) => profile.registryKey === key)
          ?.documentSchema,
      ).toBeUndefined();
      expect(
        policyProfileDocumentSchemaRef(policyProfileRegistry, POLICY_PROFILE_REGISTRY_VERSION, key),
      ).toBeUndefined();
    }
    for (const key of [captureKey, builderKey, readinessKey, validationKey, controlsKey]) {
      expect(
        policyProfileDocumentSchemaRef(policyProfileRegistry, POLICY_PROFILE_REGISTRY_VERSION, key),
      ).toContain('#/$defs/');
    }
  });

  it('keeps the generated build artifact byte-identical to the registry source', () => {
    expect(generatedSource).toBe(registrySource);
  });
});

describe('deterministic registry rejection', () => {
  it('rejects a duplicated registry key', () => {
    expect(() =>
      loadPolicyProfileRegistry(
        mutatedRegistry((profiles) => {
          profiles.push({ ...entry(profiles, captureKey) });
        }),
      ),
    ).toThrow(/duplicate policy profile registry key/u);
  });

  it('rejects a duplicated identity', () => {
    expect(() =>
      loadPolicyProfileRegistry(
        mutatedRegistry((profiles) => {
          const target = entry(profiles, readinessKey);
          const reference = target.reference;
          if (reference === undefined) throw new Error('missing reference fixture');
          reference.objectId = entry(profiles, builderKey).reference?.objectId;
          reference.versionId = entry(profiles, builderKey).reference?.versionId;
        }),
      ),
    ).toThrow(/duplicate policy profile identity/u);
    expect(() =>
      loadPolicyProfileRegistry(
        mutatedRegistry((profiles) => {
          const target = entry(profiles, readinessKey);
          const reference = target.reference;
          if (reference === undefined) throw new Error('missing reference fixture');
          reference.versionId = entry(profiles, builderKey).reference?.versionId;
        }),
      ),
    ).toThrow(/duplicate policy profile identity/u);
  });

  it('rejects a missing mapping or a missing closed schema', () => {
    expect(() =>
      loadPolicyProfileRegistry(
        mutatedRegistry((profiles) => {
          profiles.splice(
            profiles.findIndex((profile) => profile.registryKey === captureKey),
            1,
          );
        }),
      ),
    ).toThrow(/missing policy profile mapping/u);
    expect(() =>
      loadPolicyProfileRegistry(
        mutatedRegistry((profiles) => {
          delete entry(profiles, captureKey).documentSchema;
        }),
      ),
    ).toThrow(/missing closed policy profile schema/u);
  });

  it('rejects a closed schema attached to a historical entry', () => {
    expect(() =>
      loadPolicyProfileRegistry(
        mutatedRegistry((profiles) => {
          entry(profiles, policySnapshotKey).documentSchema = {
            type: 'object',
            additionalProperties: false,
            required: [],
            properties: {},
          };
        }),
      ),
    ).toThrow(/unexpected closed policy profile schema/u);
  });

  it('rejects a drifted field set', () => {
    const drift = (key: string, mutate: (schema: Record<string, unknown>) => void): unknown =>
      mutatedRegistry((profiles) => {
        const schema = entry(profiles, key).documentSchema;
        if (schema === undefined) throw new Error('missing schema fixture');
        mutate(schema);
      });

    expect(() =>
      loadPolicyProfileRegistry(
        drift(captureKey, (schema) => {
          delete (schema.properties as Record<string, unknown>).allowedPurposeCodes;
        }),
      ),
    ).toThrow(/drifted from the approved set/u);
    expect(() =>
      loadPolicyProfileRegistry(
        drift(captureKey, (schema) => {
          (schema.properties as Record<string, unknown>).ttlSeconds = { type: 'integer' };
        }),
      ),
    ).toThrow(/drifted from the approved set/u);
    expect(() =>
      loadPolicyProfileRegistry(
        drift(validationKey, (schema) => {
          schema.required = ['maxValidationValiditySeconds', 'mandatoryCriterionTypes'];
        }),
      ),
    ).toThrow(/drifted from the approved set/u);
    expect(() =>
      loadPolicyProfileRegistry(
        drift(readinessKey, (schema) => {
          schema.additionalProperties = true;
        }),
      ),
    ).toThrow(/closed object/u);
  });

  it('rejects a non-canonical reference, an unapproved entry and an unknown version', () => {
    expect(() =>
      loadPolicyProfileRegistry(
        mutatedRegistry((profiles) => {
          const target = entry(profiles, builderKey);
          if (target.reference === undefined) throw new Error('missing reference fixture');
          target.reference.objectType = 'identity.policy';
        }),
      ),
    ).toThrow(/Platform-scoped canonical contract schema/u);
    expect(() =>
      loadPolicyProfileRegistry(
        mutatedRegistry((profiles) => {
          const target = entry(profiles, builderKey);
          if (target.reference === undefined) throw new Error('missing reference fixture');
          target.reference.scope = { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d401' };
        }),
      ),
    ).toThrow(/Platform-scoped canonical contract schema/u);
    expect(() =>
      loadPolicyProfileRegistry(
        mutatedRegistry((profiles) => {
          entry(profiles, captureKey).registryKey = 'ep.unapproved.policy@1.0';
        }),
      ),
    ).toThrow(/unapproved policy profile entry/u);
    expect(() =>
      loadPolicyProfileRegistry(
        mutatedRegistry((profiles) => {
          entry(profiles, captureKey).owner = 'identity-policy';
        }),
      ),
    ).toThrow(/unapproved policy profile entry/u);
    expect(() =>
      loadPolicyProfileRegistry(
        mutatedRegistry((profiles) => {
          const target = entry(profiles, captureKey);
          if (target.reference === undefined) throw new Error('missing reference fixture');
          delete target.reference.objectId;
        }),
      ),
    ).toThrow(/invalid policy profile reference shape/u);
    expect(() =>
      loadPolicyProfileRegistry({ ...rawRegistry(), registryVersion: 'im99-static-v1' }),
    ).toThrow(/unsupported policy profile registry version/u);
  });
});

describe('canonical reference resolution', () => {
  it('resolves an exact reference and its own registry key', () => {
    for (const profile of policyProfileRegistry.profiles) {
      expect(registeredPolicyProfileKey(POLICY_PROFILE_REGISTRY_VERSION, profile.reference)).toBe(
        profile.registryKey,
      );
      expect(
        registeredPolicyProfileReference(POLICY_PROFILE_REGISTRY_VERSION, profile.registryKey),
      ).toEqual(profile.reference);
    }
  });

  it('fails closed on a wrong objectId, versionId, scope, objectType or version', () => {
    const canonical = registeredPolicyProfileReference(POLICY_PROFILE_REGISTRY_VERSION, captureKey);
    expect(canonical).toBeDefined();
    const base = {
      kind: 'VERSIONED',
      objectType: 'identity.contract_schema',
      objectId: canonical?.objectId,
      versionId: canonical?.versionId,
      scope: {},
    };

    expect(registeredPolicyProfileKey(POLICY_PROFILE_REGISTRY_VERSION, base)).toBe(captureKey);
    expect(
      registeredPolicyProfileKey(POLICY_PROFILE_REGISTRY_VERSION, {
        ...base,
        objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d401',
      }),
    ).toBeUndefined();
    expect(
      registeredPolicyProfileKey(POLICY_PROFILE_REGISTRY_VERSION, {
        ...base,
        versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d411',
      }),
    ).toBeUndefined();
    expect(
      registeredPolicyProfileKey(POLICY_PROFILE_REGISTRY_VERSION, {
        ...base,
        scope: { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d401' },
      }),
    ).toBeUndefined();
    expect(
      registeredPolicyProfileKey(POLICY_PROFILE_REGISTRY_VERSION, {
        ...base,
        objectType: 'identity.policy',
      }),
    ).toBeUndefined();
    expect(
      registeredPolicyProfileKey(POLICY_PROFILE_REGISTRY_VERSION, { ...base, extra: true }),
    ).toBeUndefined();
    expect(
      registeredPolicyProfileKey('im02-static-v1', {
        ...base,
        objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d401',
        versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d411',
      }),
    ).toBeUndefined();
    expect(registeredPolicyProfileKey('im06-static-v2', base)).toBeUndefined();
    expect(
      registeredPolicyProfileReference(POLICY_PROFILE_REGISTRY_VERSION, 'unknown@1.0'),
    ).toBeUndefined();
  });
});

describe('closed profile documents', () => {
  const cases = [
    {
      registryKey: captureKey,
      name: 'ep-context-source-slice-capture-policy-document-valid.json',
      requiredField: 'maxSliceValiditySeconds',
      numericField: 'maxSliceValiditySeconds',
      setField: 'allowedPurposeCodes',
      setMember: 'project.context_source.capture',
      nonEmptySet: true,
    },
    {
      registryKey: builderKey,
      name: 'execution-context-builder-policy-document-valid.json',
      requiredField: 'allowedProjectionTypes',
      numericField: undefined,
      setField: 'allowedProjectionTypes',
      setMember: 'COORDINATOR',
      nonEmptySet: true,
    },
    {
      registryKey: readinessKey,
      name: 'execution-task-readiness-policy-document-valid.json',
      requiredField: 'maxReadinessValiditySeconds',
      numericField: 'maxReadinessValiditySeconds',
      setField: undefined,
      setMember: undefined,
    },
    {
      registryKey: validationKey,
      name: 'execution-work-order-validation-policy-document-valid.json',
      requiredField: 'maxValidationValiditySeconds',
      numericField: 'maxValidationValiditySeconds',
      setField: 'mandatoryCriterionTypes',
      setMember: 'EXPECTED_OUTPUT_PRESENT',
      nonEmptySet: false,
    },
  ] as const;

  for (const testCase of cases) {
    describe(testCase.registryKey, () => {
      it('accepts its own valid fixture', () => {
        const result = documents.validate(
          POLICY_PROFILE_REGISTRY_VERSION,
          testCase.registryKey,
          fixture(testCase.name),
        );
        expect(result.errors).toEqual([]);
        expect(result.valid).toBe(true);
      });

      it('rejects a missing required field', () => {
        const document = omitKey(fixture(testCase.name), testCase.requiredField);
        const result = documents.validate(
          POLICY_PROFILE_REGISTRY_VERSION,
          testCase.registryKey,
          document,
        );
        expect(result.valid).toBe(false);
        expect(result.errors.map((error) => error.keyword)).toContain('required');
      });

      it('rejects an unknown field', () => {
        const document = { ...fixture(testCase.name), extensionField: 1 };
        const result = documents.validate(
          POLICY_PROFILE_REGISTRY_VERSION,
          testCase.registryKey,
          document,
        );
        expect(result.valid).toBe(false);
        expect(result.errors.map((error) => error.keyword)).toContain('additionalProperties');
      });

      if (testCase.numericField !== undefined) {
        const numericField = testCase.numericField;
        it('rejects a non-positive or non-integer value', () => {
          for (const value of [0, -1, 1.5, '3600']) {
            const document = { ...fixture(testCase.name), [numericField]: value };
            const result = documents.validate(
              POLICY_PROFILE_REGISTRY_VERSION,
              testCase.registryKey,
              document,
            );
            expect(result.valid).toBe(false);
          }
        });
      }

      if (testCase.setField !== undefined) {
        const setField = testCase.setField;
        const setMember = testCase.setMember;
        it('rejects a duplicated set member', () => {
          const duplicated = {
            ...fixture(testCase.name),
            [setField]: [setMember, setMember],
          };
          expect(
            documents.validate(POLICY_PROFILE_REGISTRY_VERSION, testCase.registryKey, duplicated)
              .valid,
          ).toBe(false);
        });

        if (testCase.nonEmptySet) {
          it('rejects an empty set', () => {
            const empty = { ...fixture(testCase.name), [setField]: [] };
            expect(
              documents.validate(POLICY_PROFILE_REGISTRY_VERSION, testCase.registryKey, empty)
                .valid,
            ).toBe(false);
          });
        }
      }
    });
  }

  it('fails closed for an unregistered profile key', () => {
    for (const registryKey of ['identity.PolicySnapshot@1.0', 'ep.unknown.policy@1.0']) {
      const result = documents.validate(POLICY_PROFILE_REGISTRY_VERSION, registryKey, {});
      expect(result.valid).toBe(false);
      expect(result.errors.map((error) => error.keyword)).toEqual(['policyProfileRegistry']);
    }
  });

  it('accepts an omitted or empty mandatoryCriterionTypes and rejects an unregistered one', () => {
    const base = { maxValidationValiditySeconds: 1800 };
    const validate = (document: unknown) =>
      documents.validate(POLICY_PROFILE_REGISTRY_VERSION, validationKey, document);

    expect(validate(base).valid).toBe(true);
    expect(validate({ ...base, mandatoryCriterionTypes: [] }).valid).toBe(true);
    expect(
      validate({ ...base, mandatoryCriterionTypes: ['REQUIRED_PROPOSAL_PROCESSED'] }).valid,
    ).toBe(true);
    expect(validate({ ...base, mandatoryCriterionTypes: ['QUALITY_APPROVED'] }).valid).toBe(false);
  });

  it('accepts every registered ProjectionType and rejects an unregistered one', () => {
    const registered = (commonSchema.$defs as Record<string, { enum?: readonly string[] }>)
      .projectionType?.enum;
    expect(registered).toBeDefined();
    for (const projectionType of registered ?? []) {
      expect(
        documents.validate(POLICY_PROFILE_REGISTRY_VERSION, builderKey, {
          allowedProjectionTypes: [projectionType],
        }).valid,
      ).toBe(true);
    }
    expect(
      documents.validate(POLICY_PROFILE_REGISTRY_VERSION, builderKey, {
        allowedProjectionTypes: ['NOT_A_PROJECTION'],
      }).valid,
    ).toBe(false);
  });

  it('keeps the registered criterion types aligned with the Core v1.0 Criterion Types', () => {
    const coreCriterionTypes = (
      workOrderSchema.$defs as Record<
        string,
        { properties?: Record<string, { enum?: readonly string[] }> }
      >
    ).completionCriterion?.properties?.criterionType?.enum;
    const registered = entry(rawRegistry().profiles, validationKey).documentSchema;
    const profileProperties = registered?.properties as
      Record<string, { items?: { enum?: readonly string[] } }> | undefined;
    const profileCriterionTypes = profileProperties?.mandatoryCriterionTypes?.items?.enum;
    expect(coreCriterionTypes).toBeDefined();
    expect(profileCriterionTypes).toEqual(coreCriterionTypes);
  });
});

describe('shared contract registry integration', () => {
  it('applies the same closed schemas and keeps 237 public operations', () => {
    const registry = new ContractRegistry();
    expect(registry.operationCount).toBe(237);
    expect(registry.policyProfileRegistry).toBe(policyProfileRegistry);
    expect(
      registry.validatePolicyProfileDocument(
        captureKey,
        fixture('ep-context-source-slice-capture-policy-document-valid.json'),
      ).valid,
    ).toBe(true);
    expect(
      registry.validatePolicyProfileDocument(captureKey, { maxSliceValiditySeconds: 1 }),
    ).toEqual(
      documents.validate(POLICY_PROFILE_REGISTRY_VERSION, captureKey, {
        maxSliceValiditySeconds: 1,
      }),
    );
    expect(
      registry
        .validatePolicyProfileDocument('identity.RolePolicy@1.0', {})
        .errors.map((error) => error.keyword),
    ).toEqual(['policyProfileRegistry']);
  });
});
