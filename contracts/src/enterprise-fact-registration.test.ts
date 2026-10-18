import { describe, expect, it } from 'vitest';

import { publicApiOperations } from './generated/public-api.js';
import {
  assertInitialContextEnterpriseFactRegistration,
  taskExecutionObjectTypes,
} from './operation-registration.js';
import { ContractRegistry } from './registry.js';
import type { PublicOperationDefinition } from './schema-types.js';

// =============================================================================
// #214 initial-Context assembly: the additive, EnterpriseProject-owned
// canonical object type `zhiju.project.enterprise_fact`. It carries the
// existing Enterprise Fact versioned identity so the assembler can normalize a
// Source Slice `factRef` into a Core-valid `subjectRef`. No public operation,
// Catalog entry or historical Baseline row changes with this registration.
// =============================================================================

const registry = new ContractRegistry();

describe('enterprise fact object type registration (#214)', () => {
  it('registers the canonical object type as EnterpriseProject-owned and VERSIONED', () => {
    expect(taskExecutionObjectTypes['zhiju.project.enterprise_fact']).toEqual({
      owner: 'enterprise-project',
      kinds: ['VERSIONED'],
    });
    expect(() => {
      assertInitialContextEnterpriseFactRegistration();
    }).not.toThrow();
  });

  it('keeps the legacy EnterpriseFact spelling unregistered and never aliases it', () => {
    const registered = taskExecutionObjectTypes as Readonly<Record<string, unknown>>;
    expect(registered.EnterpriseFact).toBeUndefined();
    expect(registered['zhiju.project.enterprisefact']).toBeUndefined();
  });

  it('adds no operation, reference declaration or Catalog entry', () => {
    const operations: readonly PublicOperationDefinition[] = publicApiOperations;
    expect(operations).toHaveLength(260);
    const referencing = operations.filter((operation) =>
      [...(operation.references ?? []), ...(operation.resultReferences ?? [])].some(
        (ref) => ref.objectType === 'zhiju.project.enterprise_fact',
      ),
    );
    expect(referencing).toEqual([]);
  });

  it('accepts a VERSIONED TypedReference with the canonical object type', () => {
    const ref = {
      kind: 'VERSIONED',
      objectType: 'zhiju.project.enterprise_fact',
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d460',
      versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d461',
      scope: { enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d201' },
    };
    expect(
      registry.validateCoreContract(
        'https://schemas.zhiju.local/common/1.0#/$defs/versionedRef',
        ref,
      ),
    ).toEqual({ valid: true, errors: [] });
  });
});
