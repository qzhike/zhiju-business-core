import { describe, expect, it, vi } from 'vitest';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import { validateRecoveryFinal } from './recovery-final-profile.js';
import { canonicalSet } from './blocked-input-recovery.js';

const scope = {
  enterpriseId: '01996900-0000-7000-8000-000000000201',
  projectId: '01996900-0000-7000-8000-000000000202',
};
const ref = (objectType: string, id: string, kind = 'OBJECT') => ({
  kind,
  objectType,
  objectId: id,
  scope,
});
const task = ref('zhiju.execution.task', '01996900-0000-7000-8000-000000000203');
const workOrder = ref('zhiju.execution.work_order', '01996900-0000-7000-8000-000000000204');
const candidate = {
  ...ref('zhiju.project.customer_material', '01996900-0000-7000-8000-000000000205', 'VERSIONED'),
  versionId: '01996900-0000-7000-8000-000000000206',
};
const source = {
  ...ref(
    'zhiju.project.source_material',
    '01996900-0000-7000-8000-000000000207',
    'CONTENT_ADDRESSED',
  ),
  contentHash: { algorithm: 'SHA-256', canonicalizationVersion: '1', digest: 'a'.repeat(64) },
};
const contract: CanonicalJsonObject = {
  workOrderRef: workOrder,
  taskRef: task,
  executionPolicy: { maxAttempts: 2, retryableOutcomes: ['BLOCKED_INPUT'] },
};
const proposal: CanonicalJsonObject = {
  requestType: 'execution.input.customer_material_confirmation',
  blocking: true,
  requestedResponderRole: 'project.customer_material.confirmer',
  targetRefs: canonicalSet([task, workOrder]),
  expectedAnswerSpec: {
    profile: 'execution.answer.customer_material.v1',
    candidateMaterialRef: candidate,
    requiredSourceRefs: [source],
  },
};
const blocked = (): CanonicalJsonObject => ({
  executionOutcome: 'BLOCKED_INPUT',
  inputRequestProposals: [structuredClone(proposal)],
});

describe('TE-REC-D-002 finite final profile (unit support boundary)', () => {
  it('requires an independently authorized material proof for Run-1', async () => {
    const read = vi
      .fn<(input: CanonicalJsonObject) => Promise<CanonicalJsonObject>>()
      .mockResolvedValue({});
    await validateRecoveryFinal(blocked(), contract, 1, read);
    expect(read).toHaveBeenCalledExactlyOnceWith({
      candidateMaterialRef: candidate,
      requiredSourceRefs: [source],
    });
    await expect(validateRecoveryFinal(blocked(), contract, 1, undefined)).rejects.toMatchObject({
      code: 'EXECUTION_CRITERION_UNSUPPORTED',
    });
  });
  it.each([
    ['nonblocking', { blocking: false }],
    ['wrong role', { requestedResponderRole: 'project.other' }],
    ['wrong target', { targetRefs: [task] }],
    [
      'unknown answer profile',
      {
        expectedAnswerSpec: {
          profile: 'other',
          candidateMaterialRef: candidate,
          requiredSourceRefs: [source],
        },
      },
    ],
    [
      'empty sources',
      {
        expectedAnswerSpec: {
          profile: 'execution.answer.customer_material.v1',
          candidateMaterialRef: candidate,
          requiredSourceRefs: [],
        },
      },
    ],
    [
      'candidate Scope',
      {
        expectedAnswerSpec: {
          profile: 'execution.answer.customer_material.v1',
          candidateMaterialRef: { ...candidate, scope: {} },
          requiredSourceRefs: [source],
        },
      },
    ],
    [
      'source type',
      {
        expectedAnswerSpec: {
          profile: 'execution.answer.customer_material.v1',
          candidateMaterialRef: candidate,
          requiredSourceRefs: [{ ...source, objectType: 'source_material' }],
        },
      },
    ],
    [
      'extra profile member',
      {
        expectedAnswerSpec: {
          profile: 'execution.answer.customer_material.v1',
          candidateMaterialRef: candidate,
          requiredSourceRefs: [source],
          extra: true,
        },
      },
    ],
  ])('rejects %s before reading material', async (_label, change) => {
    const read = vi
      .fn<(input: CanonicalJsonObject) => Promise<CanonicalJsonObject>>()
      .mockResolvedValue({});
    await expect(
      validateRecoveryFinal(
        { executionOutcome: 'BLOCKED_INPUT', inputRequestProposals: [{ ...proposal, ...change }] },
        contract,
        1,
        read,
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_CRITERION_UNSUPPORTED' });
    expect(read).not.toHaveBeenCalled();
  });
  it.each([
    'BLOCKED_INPUT',
    'PARTIAL',
    'FAILED_EXECUTION',
    'BLOCKED_POLICY',
    'CANCELLED_BY_RUNTIME',
  ])('Run-2 rejects %s without another recovery', async (outcome) => {
    await expect(
      validateRecoveryFinal(
        { executionOutcome: outcome, inputRequestProposals: [] },
        contract,
        2,
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_CRITERION_UNSUPPORTED' });
  });
  it('closes cardinality, terminal attempt and historical maxAttempts=1', async () => {
    await expect(
      validateRecoveryFinal(
        { ...blocked(), inputRequestProposals: [proposal, proposal] },
        contract,
        1,
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_CRITERION_UNSUPPORTED' });
    await expect(validateRecoveryFinal(blocked(), contract, 3, undefined)).rejects.toMatchObject({
      code: 'EXECUTION_CRITERION_UNSUPPORTED',
    });
    await expect(
      validateRecoveryFinal(
        blocked(),
        { ...contract, executionPolicy: { maxAttempts: 1 } },
        1,
        undefined,
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_CRITERION_UNSUPPORTED' });
    await validateRecoveryFinal(
      { executionOutcome: 'COMPLETED', inputRequestProposals: [] },
      contract,
      2,
      undefined,
    );
  });
});
