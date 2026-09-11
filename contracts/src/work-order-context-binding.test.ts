import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ContractRegistry } from './registry.js';
import { validateWorkOrderContextSnapshotBinding } from './work-order-context-binding.js';

type JsonObject = Record<string, unknown>;

function fixture(): JsonObject {
  return JSON.parse(
    readFileSync(
      new URL('../../tests/fixtures/contracts/core/work-order-valid.json', import.meta.url),
      'utf8',
    ),
  ) as JsonObject;
}

function refs(candidate: JsonObject): { top: JsonObject; nested: JsonObject } {
  return {
    top: candidate.contextSnapshotRef as JsonObject,
    nested: (candidate.versionPins as JsonObject).projectContextContractRef as JsonObject,
  };
}

describe('InitialWorkOrderDraft context snapshot binding', () => {
  const registry = new ContractRegistry();
  const mismatchCases: readonly (readonly [string, (ref: JsonObject) => void])[] = [
    ['objectType', (ref) => (ref.objectType = 'zhiju.project.other_snapshot')],
    ['objectId', (ref) => (ref.objectId = '018f22e2-7c15-7b2e-8d86-2de956a9d210')],
    ['snapshotId', (ref) => (ref.snapshotId = '018f22e2-7c15-7b22-8d86-2de956a9d211')],
    [
      'scope',
      (ref) => {
        (ref.scope as JsonObject).projectId = '018f22e2-7c15-7b2e-8d86-2de956a9d212';
      },
    ],
    [
      'contentHash',
      (ref) => {
        (ref.contentHash as JsonObject).digest = 'b'.repeat(64);
      },
    ],
  ];

  it('accepts a frozen WorkOrder Contract whose Context refs are identical', () => {
    const candidate = fixture();

    expect(validateWorkOrderContextSnapshotBinding(candidate)).toEqual({ valid: true, errors: [] });
    expect(registry.validateWorkOrderContextSnapshotBinding(candidate)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it.each(mismatchCases)(
    'rejects a %s mismatch between the top-level and nested refs',
    (_, mutate) => {
      const candidate = fixture();
      mutate(refs(candidate).top);

      const result = registry.validateWorkOrderContextSnapshotBinding(candidate);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'CONTEXT_SNAPSHOT_REF_MISMATCH',
          path: '/versionPins/projectContextContractRef',
        }),
      );
    },
  );

  it('rejects missing, malformed, and stale Context refs deterministically', () => {
    const missingTopLevel = fixture();
    delete missingTopLevel.contextSnapshotRef;
    expect(registry.validateWorkOrderContextSnapshotBinding(missingTopLevel).errors).toContainEqual(
      expect.objectContaining({ code: 'MISSING_CONTEXT_SNAPSHOT_REF' }),
    );

    const malformedHash = fixture();
    const malformedHashRef = refs(malformedHash).top.contentHash as JsonObject;
    malformedHashRef.digest = 'not-a-sha256-digest';
    expect(registry.validateWorkOrderContextSnapshotBinding(malformedHash).errors).toContainEqual(
      expect.objectContaining({ code: 'INVALID_CONTEXT_SNAPSHOT_REF' }),
    );

    const missingNested = fixture();
    delete (missingNested.versionPins as JsonObject).projectContextContractRef;
    expect(registry.validateWorkOrderContextSnapshotBinding(missingNested).errors).toContainEqual(
      expect.objectContaining({ code: 'MISSING_CONTEXT_SNAPSHOT_REF' }),
    );
  });
});
