import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  POLICY_PROFILE_REGISTRY_VERSION,
  registeredPolicyProfileReference,
} from '@zhiju/contracts';
import {
  hashContractPayload,
  sha256CanonicalJson,
  type CanonicalJsonObject,
} from '@zhiju/shared-kernel';
import {
  evaluateWorkOrderPlan,
  object,
  textValue,
  hash,
  specificationFields,
  specificationHash,
  type WorkOrderPlanInput,
  type WorkOrderPolicyObservation,
} from './work-order-validation-plan.js';
function fixture(name: string) {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../../../tests/fixtures/contracts/work-order-validation/${name}`,
        import.meta.url,
      ),
      'utf8',
    ),
  ) as CanonicalJsonObject;
}
function policy(
  ref: CanonicalJsonObject,
  key: string,
  document: CanonicalJsonObject,
): WorkOrderPolicyObservation {
  return {
    policyRef: ref,
    policyVersionRef: {
      kind: 'SNAPSHOT',
      objectType: 'zhiju.identity.policy_version',
      objectId: textValue(ref.objectId),
      snapshotId: textValue(ref.objectId),
      scope: ref.scope as CanonicalJsonObject,
      contentHash: hash(sha256CanonicalJson(document)),
    },
    contentHash: hash(sha256CanonicalJson(document)),
    effectiveFrom: '2026-09-21T00:00:00.000Z',
    useStatus: 'USABLE',
    policySchemaRefs: [registeredPolicyProfileReference(POLICY_PROFILE_REGISTRY_VERSION, key)],
    policyDocument: document,
  };
}
function input(): WorkOrderPlanInput {
  const c = fixture('ready-candidate-valid.json'),
    pins = object(c.versionPins),
    controls = fixture('controls-policy-document-valid.json');
  const bp = policy(object(pins.contextBuilderPolicyRef), 'execution.context_builder.policy@1.0', {
    allowedProjectionTypes: ['COORDINATOR'],
  });
  const cp = policy(
    object(pins.capabilityPolicyRef),
    'execution.work_order_controls.policy@1.0',
    controls,
  );
  const vp = policy(
    {
      ...object(pins.capabilityPolicyRef),
      objectId: '01996900-0000-7000-8000-000000000141',
      versionId: '01996900-0000-7000-8000-000000000142',
    },
    'execution.work_order_validation.policy@1.0',
    { maxValidationValiditySeconds: 600 },
  );
  const draftValues = Object.fromEntries(
    specificationFields.filter((k) => k !== 'contextSnapshotRef').map((k) => [k, c[k]]),
  );
  const { projectContextContractRef: _, ...draftPins } = pins;
  void _;
  const draft = {
    workOrderRef: c.workOrderRef,
    taskRef: c.taskRef,
    scopeRef: object(c.workOrderRef).scope,
    draft: { ...draftValues, requestedBy: c.requestedBy, versionPins: draftPins },
    expiresAt: c.expiresAt,
  } as CanonicalJsonObject;
  return {
    candidate: c,
    draft,
    context: {
      asOf: '2026-09-21T23:59:00.000Z',
      projection: { projectionType: 'COORDINATOR' },
      coverage: { completeness: 'COMPLETE_FOR_PURPOSE' },
    },
    metadata: {
      builderPolicyRef: bp.policyRef,
      policyContentHash: object(bp.contentHash).digest as string,
      policyEffectiveFrom: bp.effectiveFrom,
      inputRefObservations: (c.inputRefs as CanonicalJsonObject[]).map((i) => ({
        ...i,
        resolution: 'ADOPTED',
      })),
    },
    validationPolicy: vp,
    builderPolicy: bp,
    controlsPolicy: cp,
    evaluatorRef: object((c.completionCriteria as CanonicalJsonObject[])[0])
      .evaluatorRef as CanonicalJsonObject,
    serviceId: textValue(object(object(c.header).issuedBy).principalId),
    decisionIssuedAt: '2026-09-22T00:00:00.000Z',
    evaluatedAt: '2026-09-22T00:00:01.000Z',
    decisionExpiries: ['2026-09-22T00:05:00.000Z'],
    sliceExpiries: ['2026-09-22T00:04:00.000Z'],
    capabilitiesValid: true,
  };
}
function changePlan(
  i: WorkOrderPlanInput,
  key: string,
  value: CanonicalJsonObject | readonly CanonicalJsonObject[],
) {
  const c = { ...i.candidate, [key]: value };
  const rebuilt = { ...c, specificationHash: hash(specificationHash(c)) };
  const candidate = {
    ...rebuilt,
    header: { ...object(c.header), payloadHash: hash(hashContractPayload(rebuilt)) },
  };
  return {
    ...i,
    candidate,
    draft: { ...i.draft, draft: { ...object(i.draft.draft), [key]: value } },
  };
}
describe('WorkOrder READY plan', () => {
  it('accepts the registered technical profile and caps its validity by the earliest dependency', () => {
    const result = evaluateWorkOrderPlan(input());
    expect(result.validation.executable).toBe(true);
    expect(result.validUntil).toBe('2026-09-22T00:04:00.000Z');
    expect(result.dependencyObservations).toHaveLength(7);
    expect(result.checks).toHaveLength(7);
  });
  it('records an explicit failure for a smaller but unapproved budget', () => {
    const i = input();
    const changed = changePlan(i, 'budget', { ...object(i.candidate.budget), tokenLimit: 100 });
    const r = evaluateWorkOrderPlan(changed);
    expect(r.validation.budgetValid).toBe(false);
    expect(r.validation.violations).toContain('BUDGET_CONTROL_MISMATCH');
    expect(r.validation.executable).toBe(false);
  });
  it('records Human-only and missing required criterion failures', () => {
    expect(
      evaluateWorkOrderPlan({ ...input(), capabilitiesValid: false }).validation.violations,
    ).toContain('HUMAN_ONLY_CAPABILITY');
    const i = input();
    const r = evaluateWorkOrderPlan(
      changePlan(
        i,
        'completionCriteria',
        (i.candidate.completionCriteria as CanonicalJsonObject[]).slice(1),
      ),
    );
    expect(r.validation.violations).toContain('CRITERION_COVERAGE_MISSING');
  });
  it('refuses fabricated hashes, selectors, constraints and unsupported optional criteria', () => {
    const i = input();
    expect(() =>
      evaluateWorkOrderPlan({
        ...i,
        candidate: { ...i.candidate, specificationHash: hash('a'.repeat(64)) },
      }),
    ).toThrow();
    expect(() => evaluateWorkOrderPlan(changePlan(i, 'constraints', []))).toThrow();
    expect(() =>
      evaluateWorkOrderPlan(changePlan(i, 'constraints', [{ constraintType: 'anything' }])),
    ).toThrow();
    const criteria = (i.candidate.completionCriteria as CanonicalJsonObject[]).map((c, index) =>
      index === 0 ? { ...c, criterionType: 'OUTPUT_SCHEMA_VALID', required: false } : c,
    );
    expect(() => evaluateWorkOrderPlan(changePlan(i, 'completionCriteria', criteria))).toThrow();
  });
  it('refuses stale dependencies, and explains incomplete Context coverage', () => {
    const i = input();
    expect(() => evaluateWorkOrderPlan({ ...i, sliceExpiries: [i.evaluatedAt] })).toThrow();
    expect(() =>
      evaluateWorkOrderPlan({
        ...i,
        controlsPolicy: { ...i.controlsPolicy, useStatus: 'SUPERSEDED' },
      }),
    ).toThrow();
    expect(
      evaluateWorkOrderPlan({
        ...i,
        context: { ...i.context, coverage: { completeness: 'PARTIAL' } },
      }).validation.contextCoverageValid,
    ).toBe(false);
  });
});
