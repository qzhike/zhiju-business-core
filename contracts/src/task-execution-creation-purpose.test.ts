import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  assertTaskExecutionCreationPurposeMetadata,
  assertTaskExecutionCreationPurposeRegistrations,
} from './operation-registration.js';
import {
  loadTaskExecutionCreationPurposeMappings,
  taskExecutionCreationPurposeMappings,
} from './task-execution-creation-purpose.js';

type JsonObject = Record<string, unknown>;

const publicApiRegistryUrl = new URL(
  '../../contracts/registry/public-api.v1.json',
  import.meta.url,
);
const metadataRegistryUrl = new URL(
  '../../contracts/registry/operation-compatibility-metadata.v1.json',
  import.meta.url,
);
const artifactUrl = new URL('./generated/task-execution-creation-purposes.json', import.meta.url);

/** The approved Spec 003 §15.1 mapping, transcribed here instead of imported. */
const approvedMappings = [
  {
    commandType: 'execution.create_task',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.create_task',
  },
  {
    commandType: 'execution.create_task',
    commandVersion: '2.0',
    authorizationPurpose: 'execution.task.create',
  },
  {
    commandType: 'execution.create_work_order',
    commandVersion: '1.0',
    authorizationPurpose: 'task.execution.create_work_order',
  },
  {
    commandType: 'execution.create_work_order',
    commandVersion: '1.1',
    authorizationPurpose: 'task.execution.create_work_order',
  },
];

function registryEntries(url: URL): JsonObject[] {
  const registry: unknown = JSON.parse(readFileSync(url, 'utf8'));
  if (typeof registry !== 'object' || registry === null || !('operations' in registry)) {
    throw new Error(`invalid registry fixture: ${url.pathname}`);
  }
  return structuredClone(registry.operations) as JsonObject[];
}

function publicApiOperations(): JsonObject[] {
  return registryEntries(publicApiRegistryUrl);
}

function compatibilityMetadata(): JsonObject[] {
  return registryEntries(metadataRegistryUrl);
}

function entry(entries: JsonObject[], type: string, version: string): JsonObject {
  const match = entries.filter(
    (candidate) => candidate.type === type && candidate.version === version,
  );
  const [first] = match;
  if (match.length !== 1 || first === undefined) {
    throw new Error(`missing fixture ${type}@${version}`);
  }
  return first;
}

/**
 * Registry fixtures stay in their published JSON shape; the checks under test
 * are what validate them, so the cast only states the asserted input contract.
 */
function asOperations(
  entries: JsonObject[],
): Parameters<typeof assertTaskExecutionCreationPurposeRegistrations>[0] {
  return entries as unknown as Parameters<
    typeof assertTaskExecutionCreationPurposeRegistrations
  >[0];
}

function asMetadata(
  entries: JsonObject[],
): Parameters<typeof assertTaskExecutionCreationPurposeMetadata>[0] {
  return entries as unknown as Parameters<typeof assertTaskExecutionCreationPurposeMetadata>[0];
}

/** Independent recomputation of the projection the generator produces. */
function projectedMappings(): JsonObject[] {
  const operations = publicApiOperations();
  const metadata = compatibilityMetadata();
  return approvedMappings.map(({ commandType, commandVersion }) => {
    const operation = entry(operations, commandType, commandVersion);
    const declared = entry(metadata, commandType, commandVersion);
    return {
      commandType: operation.type,
      commandVersion: operation.version,
      authorizationPurpose: declared.authorizationPurpose,
    };
  });
}

describe('published creation Purpose projection', () => {
  it('is derived from the two registries and stays regenerable', () => {
    const artifact: unknown = JSON.parse(readFileSync(artifactUrl, 'utf8'));
    expect(artifact).toMatchObject({
      generatedFrom: [
        'contracts/registry/public-api.v1.json',
        'contracts/registry/operation-compatibility-metadata.v1.json',
      ],
    });
    if (typeof artifact !== 'object' || artifact === null || !('mappings' in artifact)) {
      throw new Error('invalid creation Purpose artifact fixture');
    }
    expect(artifact.mappings).toEqual(projectedMappings());
    expect(taskExecutionCreationPurposeMappings).toEqual(approvedMappings);
  });

  it('keeps the four exact keys, no alias and no merged WorkOrder version', () => {
    const rows = taskExecutionCreationPurposeMappings;
    expect(new Set(rows.map((row) => `${row.commandType}@${row.commandVersion}`)).size).toBe(4);
    const workOrder = rows.filter((row) => row.commandType === 'execution.create_work_order');
    expect(workOrder.map((row) => row.commandVersion)).toEqual(['1.0', '1.1']);
    expect(
      workOrder.every((row) => row.authorizationPurpose === 'task.execution.create_work_order'),
    ).toBe(true);
    const task = rows.filter((row) => row.commandType === 'execution.create_task');
    expect(task.map((row) => row.authorizationPurpose)).toEqual([
      'task.execution.create_task',
      'execution.task.create',
    ]);
    expect(rows.some((row) => row.authorizationPurpose === 'execution.work_order.create')).toBe(
      false,
    );
  });

  it('rejects a malformed artifact', () => {
    expect(() => loadTaskExecutionCreationPurposeMappings(null)).toThrow('artifact');
    expect(() => loadTaskExecutionCreationPurposeMappings({ mappings: [] })).toThrow('empty');
    expect(() =>
      loadTaskExecutionCreationPurposeMappings({
        mappings: [{ commandType: '', commandVersion: '1.0', authorizationPurpose: 'p' }],
      }),
    ).toThrow('entry');
    expect(() =>
      loadTaskExecutionCreationPurposeMappings({
        mappings: [
          { commandType: 'a', commandVersion: '1.0', authorizationPurpose: 'p' },
          { commandType: 'a', commandVersion: '1.0', authorizationPurpose: 'q' },
        ],
      }),
    ).toThrow('duplicate');
    expect(loadTaskExecutionCreationPurposeMappings({ mappings: approvedMappings })).toEqual(
      approvedMappings,
    );
  });
});

describe('creation Purpose build checks', () => {
  it('accepts the published registries and the historical @1.0 omission', () => {
    const operations = publicApiOperations();
    assertTaskExecutionCreationPurposeRegistrations(asOperations(operations));
    assertTaskExecutionCreationPurposeMetadata(asMetadata(compatibilityMetadata()));

    for (const type of ['execution.create_task', 'execution.create_work_order']) {
      expect(entry(operations, type, '1.0').authorizationPurpose).toBeUndefined();
      // Declaring the approved value on the legacy entry stays legal too.
      entry(operations, type, '1.0').authorizationPurpose = approvedMappings.find(
        (row) => row.commandType === type && row.commandVersion === '1.0',
      )?.authorizationPurpose;
    }
    assertTaskExecutionCreationPurposeRegistrations(asOperations(operations));
  });

  it('rejects a missing or duplicated creation version', () => {
    const operations = publicApiOperations();
    const withoutLegacy = operations.filter(
      (operation) =>
        !(operation.type === 'execution.create_work_order' && operation.version === '1.0'),
    );
    expect(() => {
      assertTaskExecutionCreationPurposeRegistrations(asOperations(withoutLegacy));
    }).toThrow('missing or duplicate creation operation');
    assertTaskExecutionCreationPurposeRegistrations(asOperations(publicApiOperations()));

    const duplicated = [...operations, entry(operations, 'execution.create_task', '2.0')];
    expect(() => {
      assertTaskExecutionCreationPurposeRegistrations(asOperations(duplicated));
    }).toThrow('missing or duplicate creation operation');
    assertTaskExecutionCreationPurposeRegistrations(asOperations(publicApiOperations()));
  });

  it('rejects a wrong owner or kind', () => {
    for (const [field, value] of [
      ['owner', 'enterprise-project'],
      ['kind', 'QUERY'],
    ] as const) {
      const operations = publicApiOperations();
      entry(operations, 'execution.create_task', '2.0')[field] = value;
      expect(() => {
        assertTaskExecutionCreationPurposeRegistrations(asOperations(operations));
      }).toThrow('invalid creation operation registration');
      assertTaskExecutionCreationPurposeRegistrations(asOperations(publicApiOperations()));
    }
  });

  it('rejects a declared public API Purpose that is not the approved one', () => {
    const operations = publicApiOperations();
    entry(operations, 'execution.create_task', '2.0').authorizationPurpose =
      'task.execution.create_task';
    expect(() => {
      assertTaskExecutionCreationPurposeRegistrations(asOperations(operations));
    }).toThrow('invalid creation operation Purpose');
    // The other source still carries the approved value: the two disagree.
    expect(
      entry(compatibilityMetadata(), 'execution.create_task', '2.0').authorizationPurpose,
    ).toBe('execution.task.create');
    assertTaskExecutionCreationPurposeRegistrations(asOperations(publicApiOperations()));
  });

  it('rejects missing, aliased or duplicated compatibility metadata', () => {
    const withoutLegacy = compatibilityMetadata().filter(
      (operation) => !(operation.type === 'execution.create_task' && operation.version === '1.0'),
    );
    expect(() => {
      assertTaskExecutionCreationPurposeMetadata(asMetadata(withoutLegacy));
    }).toThrow('inconsistent creation Purpose metadata');
    assertTaskExecutionCreationPurposeMetadata(asMetadata(compatibilityMetadata()));

    const aliased = compatibilityMetadata();
    entry(aliased, 'execution.create_work_order', '1.1').authorizationPurpose =
      'execution.work_order.create';
    expect(() => {
      assertTaskExecutionCreationPurposeMetadata(asMetadata(aliased));
    }).toThrow('inconsistent creation Purpose metadata');
    assertTaskExecutionCreationPurposeMetadata(asMetadata(compatibilityMetadata()));

    const stored = compatibilityMetadata();
    const duplicated = [...stored, entry(stored, 'execution.create_task', '1.0')];
    expect(() => {
      assertTaskExecutionCreationPurposeMetadata(asMetadata(duplicated));
    }).toThrow('inconsistent creation Purpose metadata');
    assertTaskExecutionCreationPurposeMetadata(asMetadata(compatibilityMetadata()));
  });
});
