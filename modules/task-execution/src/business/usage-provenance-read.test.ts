import { getContractRegistry } from '@zhiju/contracts';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import { describe, expect, it } from 'vitest';
import { validateUsageSafetyProfile } from './usage-provenance-read.js';

const registry = getContractRegistry();
const scope = { enterpriseId: newUuidV7(), projectId: newUuidV7() };
const runRef = {
  kind: 'OBJECT',
  objectType: 'execution.run',
  objectId: newUuidV7(),
  scope,
};
const digest = (seed: string) => seed.repeat(64).slice(0, 64);

function validResult(): Record<string, unknown> {
  return {
    runRef,
    agentDeclaredUsage: {
      presence: 'UNKNOWN',
      reasonCode: 'SOURCE_NOT_OBSERVED',
      evidenceRefs: [],
    },
    authoritativeSource: 'UNAVAILABLE',
    provenance: {
      profile: 'execution.provenance.human_operated.v1',
      runRef,
      aggregateVersion: 3,
      runStatus: 'RUNNING',
      snapshotAt: '2026-10-04T00:00:00.000Z',
      workOrderContractRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.contract.work_order',
        objectId: newUuidV7(),
        scope,
        contentHash: { algorithm: 'SHA-256', canonicalizationVersion: '1', digest: digest('a') },
      },
      contextSnapshotRef: {
        kind: 'SNAPSHOT',
        objectType: 'zhiju.execution.context_snapshot',
        objectId: newUuidV7(),
        snapshotId: newUuidV7(),
        scope,
        contentHash: { algorithm: 'SHA-256', canonicalizationVersion: '1', digest: digest('b') },
      },
      capabilityGrantRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.identity.execution_capability_bundle',
        objectId: newUuidV7(),
        scope,
        contentHash: { algorithm: 'SHA-256', canonicalizationVersion: '1', digest: digest('c') },
      },
      runtimeBinding: {
        adapterCode: 'te.human_operated.synthetic',
        adapterVersion: '1.0',
        harnessId: 'zhiju.runtime.synthetic',
        harnessVersion: '1.0',
        provider: 'synthetic',
        modelId: 'synthetic',
        modelConfigHash: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: digest('d'),
        },
      },
      attemptEvidence: {
        presence: 'UNKNOWN',
        reasonCode: 'SOURCE_NOT_OBSERVED',
        evidenceRefs: [],
      },
      resultEvidence: {
        presence: 'UNKNOWN',
        reasonCode: 'SOURCE_NOT_OBSERVED',
        evidenceRefs: [],
      },
    },
    reconciliationStatus: 'execution.usage.unavailable',
  };
}

function provenance(result: Record<string, unknown>): Record<string, unknown> {
  return result.provenance as Record<string, unknown>;
}

function check(result: Record<string, unknown>): void {
  validateUsageSafetyProfile(result as CanonicalJsonObject, runRef);
}

describe('usage provenance safety profile', () => {
  it('accepts the closed UNKNOWN profile and the registered public result schema', () => {
    const result = validResult();
    expect(() => {
      check(result);
    }).not.toThrow();
    expect(
      registry.validateOperationResult('execution.get_usage_and_provenance', '1.0', result),
    ).toEqual({ valid: true, errors: [] });
  });

  it('rejects a runtimeUsageRef on every path', () => {
    const result = validResult();
    result.runtimeUsageRef = { objectType: 'execution.usage', objectId: newUuidV7(), scope };
    expect(() => {
      check(result);
    }).toThrow();
  });

  it('rejects an unknown provenance member', () => {
    const result = validResult();
    provenance(result).runtimeSessionExternalRef = 'external-session';
    expect(() => {
      check(result);
    }).toThrow();
  });

  it('rejects UNKNOWN usage that carries a value', () => {
    const result = validResult();
    result.agentDeclaredUsage = {
      presence: 'UNKNOWN',
      reasonCode: 'SOURCE_NOT_OBSERVED',
      evidenceRefs: [],
      value: { measurementSource: 'AGENT_DECLARED' },
    };
    expect(() => {
      check(result);
    }).toThrow();
  });

  it('rejects a PRESENT declaration without any measurement field', () => {
    const result = validResult();
    result.agentDeclaredUsage = {
      presence: 'PRESENT',
      evidenceRefs: [],
      value: { measurementSource: 'AGENT_DECLARED' },
    };
    result.authoritativeSource = 'AGENT_DECLARED';
    result.reconciliationStatus = 'execution.usage.agent_declared_only';
    expect(() => {
      check(result);
    }).toThrow();
  });

  it('rejects a zero token declaration but accepts an explicit zero estimated cost', () => {
    const zeroTokens = validResult();
    zeroTokens.agentDeclaredUsage = {
      presence: 'PRESENT',
      evidenceRefs: [],
      value: { measurementSource: 'AGENT_DECLARED', inputTokens: 0 },
    };
    zeroTokens.authoritativeSource = 'AGENT_DECLARED';
    zeroTokens.reconciliationStatus = 'execution.usage.agent_declared_only';
    expect(() => {
      check(zeroTokens);
    }).toThrow();

    const zeroCost = validResult();
    zeroCost.agentDeclaredUsage = {
      presence: 'PRESENT',
      evidenceRefs: [],
      value: {
        measurementSource: 'AGENT_DECLARED',
        estimatedCost: { amountDecimal: '0', currency: 'CNY' },
      },
    };
    zeroCost.authoritativeSource = 'AGENT_DECLARED';
    zeroCost.reconciliationStatus = 'execution.usage.agent_declared_only';
    expect(() => {
      check(zeroCost);
    }).not.toThrow();
  });

  it('rejects a PRESENT attempt evidence carrying only one optional observation member', () => {
    const result = validResult();
    provenance(result).attemptEvidence = {
      presence: 'PRESENT',
      evidenceRefs: [],
      value: {
        attemptRef: {
          kind: 'OBJECT',
          objectType: 'integration.runtime_attempt',
          objectId: newUuidV7(),
          scope,
        },
        bindingHash: { algorithm: 'SHA-256', canonicalizationVersion: '1', digest: digest('e') },
        ackObservationId: newUuidV7(),
        runtimeAdapterIdentityRef: {
          kind: 'OBJECT',
          objectType: 'zhiju.runtime.runtime',
          objectId: newUuidV7(),
          scope,
        },
        source: 'SYNTHETIC_DRIVER',
        observationRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.integration.runtime_final_observation',
          objectId: newUuidV7(),
          scope,
          contentHash: { algorithm: 'SHA-256', canonicalizationVersion: '1', digest: digest('f') },
        },
      },
    };
    expect(() => {
      check(result);
    }).toThrow();
  });
});
