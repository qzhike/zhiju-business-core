import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ContractRegistry } from './registry.js';
import {
  contextSnapshotObjectType,
  legacyContextSnapshotObjectType,
  validateContextSnapshotReadBinding,
  validateInitialContextCommandResult,
  type ContextSnapshotBindingCode,
} from './context-snapshot-binding.js';

type JsonObject = Record<string, unknown>;

const legacyObjectType = legacyContextSnapshotObjectType;

function loadFixture(relativePath: string): JsonObject {
  return JSON.parse(
    readFileSync(
      new URL(`../../tests/fixtures/contracts/${relativePath}`, import.meta.url),
      'utf8',
    ),
  ) as JsonObject;
}

function commandResult(): JsonObject {
  return loadFixture('context-build/initial-context-result.json');
}

function dataRef(result: JsonObject): JsonObject {
  return (result.data as JsonObject).contextSnapshotRef as JsonObject;
}

function legacySnapshotRef(): JsonObject {
  const ref = structuredClone(dataRef(commandResult()));
  ref.objectType = legacyObjectType;
  return ref;
}

function setScope(result: JsonObject, scope: JsonObject): void {
  dataRef(result).scope = structuredClone(scope);
  (result.targetRef as JsonObject).scope = structuredClone(scope);
}

describe('Initial Context CommandResult binding', () => {
  const registry = new ContractRegistry();

  it('accepts the canonical ref that matches the envelope target', () => {
    const result = commandResult();

    expect(dataRef(result).objectType).toBe(contextSnapshotObjectType);
    expect(validateInitialContextCommandResult(result)).toEqual({ valid: true, errors: [] });
    expect(registry.validateInitialContextCommandResult(result)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('requires the result schema to describe the same canonical ref', () => {
    const ref = registry.validateOperationResult(
      'execution.build_initial_context_snapshot',
      '1.0',
      commandResult().data,
    );
    expect(ref).toEqual({ valid: true, errors: [] });
    expect(
      registry.validateOperationResult(
        'execution.build_initial_context_snapshot',
        '1.1',
        commandResult().data,
      ),
    ).toEqual({ valid: true, errors: [] });
  });

  it('rejects an operation that has no executable result schema at all', () => {
    const result = registry.validateOperationResult(
      'execution.build_context_snapshot',
      '1.0',
      commandResult().data,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.keyword)).toContain('operationResultRegistry');
  });

  const rejectionCases: readonly {
    readonly name: string;
    readonly code: ContextSnapshotBindingCode;
    readonly mutate: (result: JsonObject) => void;
  }[] = [
    {
      name: 'a missing ref',
      code: 'MISSING_CONTEXT_SNAPSHOT_REF',
      mutate: (result) => {
        delete (result.data as JsonObject).contextSnapshotRef;
      },
    },
    {
      name: 'a malformed ref',
      code: 'INVALID_CONTEXT_SNAPSHOT_REF',
      mutate: (result) => {
        delete dataRef(result).snapshotId;
      },
    },
    {
      name: 'a legacy object type',
      code: 'LEGACY_CONTEXT_SNAPSHOT_OBJECT_TYPE',
      mutate: (result) => {
        dataRef(result).objectType = legacyObjectType;
      },
    },
    {
      name: 'an unregistered object type',
      code: 'INVALID_CONTEXT_SNAPSHOT_REF',
      mutate: (result) => {
        dataRef(result).objectType = 'zhiju.execution.other_snapshot';
      },
    },
    {
      name: 'a non SHA-256 hash',
      code: 'INVALID_CONTEXT_SNAPSHOT_REF',
      mutate: (result) => {
        (dataRef(result).contentHash as JsonObject).algorithm = 'SHA-1';
      },
    },
    {
      name: 'a project Scope without enterprise',
      code: 'INVALID_CONTEXT_SNAPSHOT_REF',
      mutate: (result) => {
        dataRef(result).scope = { projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d202' };
      },
    },
    {
      name: 'an empty Scope on both the target and the returned ref',
      code: 'MISSING_CONTEXT_SNAPSHOT_PROJECT_SCOPE',
      mutate: (result) => {
        setScope(result, {});
      },
    },
    {
      name: 'an enterprise-only Scope on both the target and the returned ref',
      code: 'MISSING_CONTEXT_SNAPSHOT_PROJECT_SCOPE',
      mutate: (result) => {
        setScope(result, { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d201' });
      },
    },
    {
      name: 'a target id that differs from the returned ref',
      code: 'CONTEXT_SNAPSHOT_TARGET_MISMATCH',
      mutate: (result) => {
        (result.targetRef as JsonObject).objectId = '018f22e2-7c15-7b2e-8d86-2de956a9d444';
      },
    },
    {
      name: 'a foreign target object type',
      code: 'CONTEXT_SNAPSHOT_TARGET_MISMATCH',
      mutate: (result) => {
        (result.targetRef as JsonObject).objectType = legacyObjectType;
      },
    },
    {
      name: 'a target Scope that differs from the returned ref',
      code: 'CONTEXT_SNAPSHOT_TARGET_MISMATCH',
      mutate: (result) => {
        delete ((result.targetRef as JsonObject).scope as JsonObject).projectId;
      },
    },
  ];

  it.each(rejectionCases)('rejects $name', ({ code, mutate }) => {
    const result = commandResult();
    mutate(result);

    const validation = registry.validateInitialContextCommandResult(result);
    expect(validation.valid).toBe(false);
    expect(validation.errors.map((error) => error.code)).toContain(code);
  });

  it('rejects a target/ref mismatch that both structural schemas accept independently', () => {
    const result = commandResult();
    (result.targetRef as JsonObject).objectId = '018f22e2-7c15-7b2e-8d86-2de956a9d444';

    expect(
      registry.validateOperationResult(
        'execution.build_initial_context_snapshot',
        '1.0',
        result.data,
      ),
    ).toEqual({ valid: true, errors: [] });
    expect(registry.validateInitialContextCommandResult(result).valid).toBe(false);
  });
});

describe('authoritative Context Snapshot read binding', () => {
  const registry = new ContractRegistry();

  function readBinding(ref: JsonObject): JsonObject {
    return {
      payload: { contextSnapshotRef: structuredClone(ref) },
      data: {
        contextSnapshotRef: structuredClone(ref),
        projectContextContract: loadFixture('core/project-context-valid.json'),
        contractRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.contract.project_context',
          objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d445',
          scope: {
            enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d201',
            projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d202',
          },
          contentHash: {
            algorithm: 'SHA-256',
            digest: 'a'.repeat(64),
            canonicalizationVersion: '1',
          },
        },
      },
    };
  }

  function canonicalRef(): JsonObject {
    return structuredClone(dataRef(commandResult()));
  }

  it('accepts a read that returns the requested canonical ref', () => {
    const binding = readBinding(canonicalRef());

    expect(validateContextSnapshotReadBinding(binding)).toEqual({ valid: true, errors: [] });
    expect(
      registry.validateOperationResult('execution.get_context_snapshot', '1.0', binding.data),
    ).toEqual({ valid: true, errors: [] });
    expect(registry.validateContextSnapshotReadBinding(binding)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('still reads the historical Core v1.0 context snapshot identity back', () => {
    const legacy = legacySnapshotRef();
    const binding = readBinding(legacy);

    expect(registry.validateContextSnapshotReadBinding(binding)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('execution.get_context_snapshot', '1.0', binding.data),
    ).toEqual({ valid: true, errors: [] });
  });

  it('keeps the historical read acceptance set for an enterprise-only legacy scope', () => {
    const legacy = legacySnapshotRef();
    legacy.scope = { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d201' };
    const binding = readBinding(legacy);

    expect(registry.validateContextSnapshotReadBinding(binding)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('execution.get_context_snapshot', '1.0', binding.data),
    ).toEqual({ valid: true, errors: [] });
  });

  const mismatchCases: readonly {
    readonly field: string;
    readonly mutate: (ref: JsonObject) => void;
  }[] = [
    {
      field: 'objectId',
      mutate: (ref) => {
        ref.objectId = '018f22e2-7c15-7b2e-8d86-2de956a9d444';
      },
    },
    {
      field: 'snapshotId',
      mutate: (ref) => {
        ref.snapshotId = '018f22e2-7c15-7b2e-8d86-2de956a9d444';
      },
    },
    {
      field: 'objectType',
      mutate: (ref) => {
        ref.objectType = 'zhiju.execution.other_snapshot';
      },
    },
    {
      field: 'contentHash',
      mutate: (ref) => {
        (ref.contentHash as JsonObject).digest = 'b'.repeat(64);
      },
    },
    {
      field: 'scope',
      mutate: (ref) => {
        (ref.scope as JsonObject).projectId = '018f22e2-7c15-7b2e-8d86-2de956a9d444';
      },
    },
  ];

  it.each(mismatchCases)(
    'rejects a returned ref whose $field differs from the request',
    ({ mutate }) => {
      const binding = readBinding(canonicalRef());
      mutate((binding.data as JsonObject).contextSnapshotRef as JsonObject);

      const validation = registry.validateContextSnapshotReadBinding(binding);
      expect(validation.valid).toBe(false);
      expect(validation.errors.map((error) => error.code)).toContain(
        'CONTEXT_SNAPSHOT_READ_MISMATCH',
      );
    },
  );
});
