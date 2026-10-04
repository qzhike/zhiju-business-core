import { getContractRegistry } from '@zhiju/contracts';
import { hashContractPayload, newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import { describe, expect, it } from 'vitest';
import { finalBindsCommittedFacts, validateUsageSafetyProfile } from './usage-provenance-read.js';

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

const H = (d: string) => ({ algorithm: 'SHA-256', canonicalizationVersion: '1', digest: d });

function associationFixture() {
  const subject = { enterpriseId: newUuidV7(), projectId: newUuidV7() };
  const objectRef = (objectType: string) => ({
    kind: 'OBJECT',
    objectType,
    objectId: newUuidV7(),
    scope: subject,
  });
  const runRefValue = objectRef('execution.run');
  const attemptRefValue = objectRef('integration.runtime_attempt');
  const adapterRefValue = objectRef('zhiju.runtime.runtime');
  const workOrderRef = objectRef('zhiju.execution.work_order');
  const taskRef = objectRef('zhiju.execution.task');
  const projectRef = objectRef('zhiju.project.project');
  const contractRef = {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'zhiju.contract.work_order',
    objectId: newUuidV7(),
    scope: subject,
    contentHash: H(digest('1')),
  };
  const contextRef = {
    kind: 'SNAPSHOT',
    objectType: 'zhiju.execution.context_snapshot',
    objectId: newUuidV7(),
    snapshotId: newUuidV7(),
    scope: subject,
    contentHash: H(digest('2')),
  };
  const grantRef = {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'zhiju.identity.execution_capability_bundle',
    objectId: newUuidV7(),
    scope: subject,
    contentHash: H(digest('3')),
  };
  const adapterContractRef = {
    kind: 'VERSIONED',
    objectType: 'zhiju.runtime.adapter_contract',
    objectId: newUuidV7(),
    versionId: newUuidV7(),
    scope: {},
  };
  const modelConfigHash = H(digest('4'));
  const runtimeBinding = {
    adapterCode: 'te.human_operated.synthetic',
    adapterVersion: '1.0',
    harnessId: 'zhiju.runtime.synthetic',
    harnessVersion: '1.0',
    provider: 'synthetic',
    modelId: 'synthetic',
    modelConfigHash,
  };
  const runtimeSessionRef = {
    system: 'synthetic',
    resourceType: 'session',
    externalId: 'session-1',
  };
  const observationRef = {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'zhiju.integration.runtime_final_observation',
    objectId: newUuidV7(),
    scope: subject,
    contentHash: H(digest('5')),
  };
  const runtimeSubmissionRef = {
    system: 'synthetic',
    resourceType: 'submission',
    externalId: 'submission-1',
    observedAt: '2026-10-04T00:00:10.000Z',
  };
  const contract: Record<string, unknown> = {
    runRef: runRefValue,
    workOrderRef,
    taskRef,
    projectRef,
    submittedByRuntime: adapterRefValue,
    submissionKind: 'FINAL',
    submittedAt: '2026-10-04T00:00:05.000Z',
    provenance: {
      contextSnapshotRef: contextRef,
      workOrderContractRef: contractRef,
      capabilityGrantRef: grantRef,
      runtimeSessionExternalRef: runtimeSessionRef,
      runtimeAdapterRef: adapterContractRef,
      harness: { harnessId: 'zhiju.runtime.synthetic', harnessVersion: '1.0' },
      provider: 'synthetic',
      model: { modelId: 'synthetic', modelConfigHash },
    },
  };
  const contractHash = hashContractPayload(contract as CanonicalJsonObject);
  const final: Record<string, unknown> = {
    observationRef,
    attemptRef: attemptRefValue,
    runRef: runRefValue,
    runtimeSubmissionRef,
    resultPayloadHash: H(contractHash),
    bindingHash: H(digest('6')),
    runFencingToken: 2,
    ackObservationId: observationRef.objectId,
    runtimeAdapterIdentityRef: adapterRefValue,
    agentResultContract: contract,
    observedAt: '2026-10-04T00:00:10.000Z',
    source: 'SYNTHETIC_DRIVER',
  };
  const result: Record<string, unknown> = {
    observation_ref: observationRef,
    attempt_ref: attemptRefValue,
    adapter_identity_ref: adapterRefValue,
    runtime_submission_ref: runtimeSubmissionRef,
    result_payload_hash: Buffer.from(contractHash, 'hex'),
    result_payload: contract,
    fencing_token: '2',
  };
  const claim: Record<string, unknown> = {
    observation_ref: observationRef,
    result_payload_hash: Buffer.from(contractHash, 'hex'),
  };
  return {
    final,
    contract,
    binding: {
      attemptRef: attemptRefValue,
      status: 'SUCCEEDED',
      bindingHash: H(digest('6')),
      acknowledgement: {
        observationId: observationRef.objectId,
        runtimeSessionRef,
        acknowledgedAt: '2026-10-04T00:00:09.000Z',
        source: 'SYNTHETIC_DRIVER',
      },
    },
    run: {
      run_id: runRefValue.objectId,
      work_order_ref: workOrderRef,
      work_order_contract_ref: contractRef,
      context_snapshot_ref: contextRef,
      capability_grant_ref: grantRef,
      runtime_binding: runtimeBinding,
      fencing_token: '2',
      started_at: new Date('2026-10-04T00:00:00.000Z'),
    },
    runRef: runRefValue,
    attemptRef: attemptRefValue,
    adapterRef: adapterRefValue,
    frozenContract: {
      taskRef,
      projectRef,
      versionPins: { runtimeAdapterContractRef: adapterContractRef },
    },
    result,
    claim,
  };
}

type AssociationFixture = ReturnType<typeof associationFixture>;

function binds(fixture: AssociationFixture): boolean {
  return finalBindsCommittedFacts(
    fixture as unknown as Parameters<typeof finalBindsCommittedFacts>[0],
  );
}

function reseal(fixture: AssociationFixture): void {
  fixture.final.resultPayloadHash = H(hashContractPayload(fixture.contract as CanonicalJsonObject));
}

describe('original final to committed TE facts association', () => {
  it('accepts the intact association as a positive control', () => {
    expect(binds(associationFixture())).toBe(true);
  });

  it('rejects each individual association mismatch', () => {
    const mutations: readonly [string, (fixture: AssociationFixture) => void][] = [
      [
        'final attemptRef',
        (f) => (f.final.attemptRef = { ...f.attemptRef, objectId: newUuidV7() }),
      ],
      ['final runRef', (f) => (f.final.runRef = { ...f.runRef, objectId: newUuidV7() })],
      [
        'final adapter identity',
        (f) => (f.final.runtimeAdapterIdentityRef = { ...f.adapterRef, objectId: newUuidV7() }),
      ],
      ['final bindingHash', (f) => (f.final.bindingHash = H(digest('f')))],
      ['final fencing', (f) => (f.final.runFencingToken = 3)],
      ['final ack observation', (f) => (f.final.ackObservationId = newUuidV7())],
      ['final source', (f) => (f.final.source = 'PROVIDER')],
      ['final body hash', (f) => (f.final.resultPayloadHash = H(digest('e')))],
      [
        'contract runRef',
        (f) => {
          f.contract.runRef = { ...f.runRef, objectId: newUuidV7() };
          reseal(f);
        },
      ],
      [
        'contract workOrderRef',
        (f) => {
          f.contract.workOrderRef = {
            ...(f.contract.workOrderRef as Record<string, unknown>),
            objectId: newUuidV7(),
          };
          reseal(f);
        },
      ],
      [
        'contract submittedByRuntime',
        (f) => {
          f.contract.submittedByRuntime = { ...f.adapterRef, objectId: newUuidV7() };
          reseal(f);
        },
      ],
      [
        'contract runtime session',
        (f) => {
          (f.contract.provenance as Record<string, unknown>).runtimeSessionExternalRef = {
            system: 'synthetic',
            resourceType: 'session',
            externalId: 'other-session',
          };
          reseal(f);
        },
      ],
      [
        'contract runtime adapter pin',
        (f) => {
          (f.contract.provenance as Record<string, unknown>).runtimeAdapterRef = {
            ...((f.contract.provenance as Record<string, unknown>).runtimeAdapterRef as Record<
              string,
              unknown
            >),
            versionId: newUuidV7(),
          };
          reseal(f);
        },
      ],
      [
        'submitted after observedAt',
        (f) => {
          f.contract.submittedAt = '2026-10-04T00:00:11.000Z';
          reseal(f);
        },
      ],
      [
        'submitted before startedAt',
        (f) => {
          f.contract.submittedAt = '2026-10-03T23:59:59.000Z';
          reseal(f);
        },
      ],
      [
        'result observation',
        (f) => {
          f.result.observation_ref = {
            ...(f.result.observation_ref as Record<string, unknown>),
            objectId: newUuidV7(),
          };
        },
      ],
      [
        'result attempt',
        (f) => {
          f.result.attempt_ref = {
            ...(f.result.attempt_ref as Record<string, unknown>),
            objectId: newUuidV7(),
          };
        },
      ],
      [
        'result adapter identity',
        (f) => {
          f.result.adapter_identity_ref = {
            ...(f.result.adapter_identity_ref as Record<string, unknown>),
            objectId: newUuidV7(),
          };
        },
      ],
      [
        'result submission',
        (f) => {
          f.result.runtime_submission_ref = {
            ...(f.result.runtime_submission_ref as Record<string, unknown>),
            externalId: 'other-submission',
          };
        },
      ],
      [
        'result payload hash',
        (f) => (f.result.result_payload_hash = Buffer.from(digest('a'), 'hex')),
      ],
      [
        'result body',
        (f) => (f.result.result_payload = { ...f.contract, humanSummary: 'other body' }),
      ],
      ['result fencing', (f) => (f.result.fencing_token = '3')],
      [
        'claim observation',
        (f) => {
          f.claim.observation_ref = {
            ...(f.claim.observation_ref as Record<string, unknown>),
            objectId: newUuidV7(),
          };
        },
      ],
      [
        'claim payload hash',
        (f) => (f.claim.result_payload_hash = Buffer.from(digest('b'), 'hex')),
      ],
    ];
    for (const [name, mutate] of mutations) {
      const fixture = associationFixture();
      mutate(fixture);
      expect(binds(fixture), name).toBe(false);
    }
  });
});
