import { describe, expect, it } from 'vitest';
import { executionDocumentSchemaReference } from '@zhiju/contracts';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  formalCriteria,
  formalSelector,
  validateFormalTaskDefinition,
  WORK_ORDER_COMPLETION,
  TASK_COMPLETION,
} from './formal-output.js';

const enterpriseId = '0199b600-0000-7000-8000-000000000001';
function contract(): CanonicalJsonObject {
  const output = {
    outputSlot: 'revision',
    cardinality: 'EXACTLY_ONE',
    creationRequired: true,
    requiredReferenceStrength: 'CONTENT_ADDRESSED',
    allowedObjectTypes: ['artifact.artifact_revision'],
    schemaRef: executionDocumentSchemaReference(enterpriseId),
  };
  const types = [
    'EXPECTED_OUTPUT_PRESENT',
    'OUTPUT_REF_VALID',
    'OUTPUT_CREATED_BY_WORK_ORDER',
    'OUTPUT_SCHEMA_VALID',
    'OUTPUT_WITHIN_TARGET_SCOPE',
    'NO_BLOCKING_INFORMATION_REQUEST',
  ];
  return {
    workOrderRef: { scope: { enterpriseId } },
    expectedOutputs: [output],
    targetScope: { allowedCreateTypes: ['artifact.artifact', 'artifact.artifact_revision'] },
    executionPolicy: { maxAttempts: 1 },
    versionPins: {
      runtimeAdapterContractRef: {
        kind: 'VERSIONED',
        objectType: 'zhiju.runtime.adapter_contract',
        objectId: '0199b600-0000-7000-8000-000000000301',
        versionId: '0199b600-0000-7000-8000-000000000311',
        scope: {},
      },
    },
    constraints: [{ profile: 'execution.completion_binding.v1', policyRef: {} }],
    completionCriteria: types.map((type, i) => ({
      criterionId: `c${i}`,
      criterionType: type,
      required: true,
      expectedCondition: 'satisfied',
      inputBindings: [
        type === 'NO_BLOCKING_INFORMATION_REQUEST'
          ? 'informationRequests'
          : 'expectedOutput.revision',
      ],
      evaluatorRef: formalSelector(WORK_ORDER_COMPLETION),
    })),
  } as unknown as CanonicalJsonObject;
}
function task(): CanonicalJsonObject {
  const types = [
    'EXPECTED_OUTPUTS_SATISFIED',
    'NO_BLOCKING_INFORMATION_REQUEST',
    'REQUIRED_WORK_ORDERS_COMPLETED',
  ];
  return {
    expectedOutputSpec: { outputs: required(contract().expectedOutputs) },
    completionCriteria: {
      criteria: types.map((type, i) => ({
        criterionId: `c${i}`,
        criterionType: type,
        required: true,
        expectedCondition: { satisfied: true },
        evaluatorRef: formalSelector(TASK_COMPLETION),
        bindings:
          type === 'NO_BLOCKING_INFORMATION_REQUEST'
            ? { scope: 'TASK_AND_CHILD_WORK_ORDERS' }
            : type === 'REQUIRED_WORK_ORDERS_COMPLETED'
              ? { scope: 'ALL_CHILD_WORK_ORDERS' }
              : { outputSlots: ['revision'] },
      })),
    },
  };
}
const record = (value: unknown) => value as Record<string, unknown>;
describe('formal frozen criterion support', () => {
  it('requires every mandatory criterion exactly once and the exact owning profile', () => {
    expect(formalCriteria(contract()).criteria).toHaveLength(6);
    expect(validateFormalTaskDefinition(task()).criteria).toHaveLength(3);
  });
  it.each([
    'required',
    'condition',
    'binding',
    'evaluator',
    'duplicate',
    'missing',
    'alias',
    'schema',
    'qualityStage',
  ])('rejects the WorkOrder %s counterexample', (which) => {
    const c = contract();
    const criteria = c.completionCriteria as CanonicalJsonObject[];
    const first = record(criteria[0]);
    if (which === 'required') first.required = false;
    if (which === 'condition') first.expectedCondition = 'unknown';
    if (which === 'binding') first.inputBindings = ['wrong'];
    if (which === 'evaluator') first.evaluatorRef = formalSelector(TASK_COMPLETION);
    if (which === 'duplicate') criteria.push({ ...required(criteria[0]), criterionId: 'another' });
    if (which === 'missing') criteria.pop();
    const output = record((c.expectedOutputs as unknown[])[0]);
    if (which === 'alias') output.allowedObjectTypes = ['zhiju.artifact.artifact_revision'];
    if (which === 'schema')
      record(output.schemaRef).versionId = '0199b600-0000-7000-8000-000000000412';
    if (which === 'qualityStage') output.qualityStageRequired = 'READY';
    expect(() => formalCriteria(c)).toThrow();
  });
  it('rejects duplicate Task criteria and FULLY_APPROVED without REVISION_ACCEPTANCE_READY', () => {
    const t = task();
    const criteria = record(t.completionCriteria).criteria as CanonicalJsonObject[];
    criteria.push({ ...required(criteria[0]), criterionId: 'other' });
    expect(() => validateFormalTaskDefinition(t)).toThrow();
    const full = task();
    const cs = record(full.completionCriteria).criteria as CanonicalJsonObject[];
    cs.push({ ...required(cs[0]), criterionId: 'full', criterionType: 'REVISION_FULLY_APPROVED' });
    expect(() => validateFormalTaskDefinition(full)).toThrow();
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing test fixture value');
  return value;
}
