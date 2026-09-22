import {
  ContractRegistry,
  EVALUATOR_PROFILE_REGISTRY_VERSION,
  evaluatorProfileRegistry,
  resolveWorkOrderReadyProfile,
  WORK_ORDER_READY_REGISTRY_VERSION,
} from '@zhiju/contracts';
import {
  canonicalize,
  hashContractPayload,
  sha256CanonicalJson,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import { CommandExecutionError } from '../persistence/command-runner.js';
import {
  validateWorkOrderControlsPolicy,
  validateWorkOrderValidationPolicy,
  validateContextBuilderPolicy,
} from './policy-profiles.js';

const registry = new ContractRegistry();

export function object(value: unknown): CanonicalJsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail('REFERENCE_INVALID');
  return value as CanonicalJsonObject;
}
export function same(a: unknown, b: unknown): boolean {
  return (
    a !== undefined &&
    b !== undefined &&
    canonicalize(a as CanonicalJsonValue) === canonicalize(b as CanonicalJsonValue)
  );
}
export function fail(code: string): never {
  throw new CommandExecutionError(code, 'WorkOrder validation dependency or plan is unavailable');
}
export function requireThat(value: unknown, code = 'REFERENCE_INVALID'): asserts value {
  if (!value) fail(code);
}
export function hash(digest: string): CanonicalJsonObject {
  return { algorithm: 'SHA-256', canonicalizationVersion: '1', digest };
}
export function textValue(value: unknown): string {
  requireThat(typeof value === 'string');
  return value;
}
export function digest(value: unknown): string {
  return textValue(object(value).digest);
}
export const specificationFields = [
  'objective',
  'targetScope',
  'inputRefs',
  'contextSnapshotRef',
  'constraints',
  'allowedCapabilities',
  'deniedCapabilities',
  'expectedOutputs',
  'completionCriteria',
  'riskAndQuality',
  'executionPolicy',
  'budget',
  'harnessPolicy',
  'modelPolicy',
  'versionPins',
] as const;
export function specificationHash(candidate: CanonicalJsonObject): string {
  return sha256CanonicalJson(
    Object.fromEntries(
      specificationFields.map((key) => [key, candidate[key]]),
    ) as CanonicalJsonObject,
  );
}
export interface WorkOrderPolicyObservation {
  readonly policyRef: CanonicalJsonObject;
  readonly policyVersionRef: CanonicalJsonObject;
  readonly contentHash: CanonicalJsonObject;
  readonly effectiveFrom: string;
  readonly supersededAt?: string | undefined;
  readonly useStatus: string;
  readonly policySchemaRefs: readonly unknown[];
  readonly policyDocument: unknown;
}
export interface WorkOrderPlanInput {
  readonly candidate: CanonicalJsonObject;
  readonly draft: CanonicalJsonObject;
  readonly context: CanonicalJsonObject;
  readonly metadata: CanonicalJsonObject;
  readonly validationPolicy: WorkOrderPolicyObservation;
  readonly builderPolicy: WorkOrderPolicyObservation;
  readonly controlsPolicy: WorkOrderPolicyObservation;
  readonly evaluatorRef: CanonicalJsonObject;
  readonly serviceId: string;
  readonly decisionIssuedAt: string;
  readonly evaluatedAt: string;
  readonly decisionExpiries: readonly string[];
  readonly sliceExpiries: readonly string[];
  readonly capabilitiesValid: boolean;
}
function array(value: unknown): readonly CanonicalJsonValue[] {
  requireThat(Array.isArray(value));
  return value as CanonicalJsonValue[];
}
function ordered(
  values: readonly CanonicalJsonValue[],
  key: (value: CanonicalJsonValue) => string = canonicalize,
): void {
  const keys = values.map(key);
  requireThat(
    keys.every(
      (v, i) => i === 0 || Buffer.compare(Buffer.from(keys[i - 1] ?? ''), Buffer.from(v)) < 0,
    ),
    'EXECUTION_CRITERION_UNSUPPORTED',
  );
}
function empty(value: unknown): void {
  requireThat(array(value).length === 0, 'EXECUTION_CRITERION_UNSUPPORTED');
}
function supported(value: unknown): asserts value {
  requireThat(value, 'EXECUTION_CRITERION_UNSUPPORTED');
}
const outputCriteria = [
  'EXPECTED_OUTPUT_PRESENT',
  'OUTPUT_REF_VALID',
  'OUTPUT_CREATED_BY_WORK_ORDER',
  'OUTPUT_WITHIN_TARGET_SCOPE',
];
const criterionTypes = [...outputCriteria, 'NO_BLOCKING_INFORMATION_REQUEST'];

/** Pure evaluation of a previously authenticated, exact set of owning facts. */
export function evaluateWorkOrderPlan(input: WorkOrderPlanInput) {
  const {
    candidate: c,
    draft,
    context,
    metadata,
    validationPolicy: vp,
    builderPolicy: bp,
    controlsPolicy: cp,
  } = input;

  requireThat(
    registry.validateCoreContract('https://schemas.zhiju.local/core/work-order/1.0', c).valid,
    'API_VALUE_INVALID',
  );
  const header = object(c.header),
    pins = object(c.versionPins),
    d = object(draft.draft);
  for (const key of specificationFields) {
    if (key === 'contextSnapshotRef') continue;
    const expected =
      key === 'versionPins'
        ? { ...object(d.versionPins), projectContextContractRef: c.contextSnapshotRef }
        : d[key];
    requireThat(same(c[key], expected));
  }
  for (const key of ['workOrderRef', 'taskRef']) requireThat(same(c[key], draft[key]));
  requireThat(
    same(c.projectRef, {
      kind: 'OBJECT',
      objectType: 'zhiju.project.project',
      objectId: object(draft.scopeRef).projectId,
      scope: draft.scopeRef,
    }) && same(c.requestedBy, d.requestedBy),
  );
  requireThat(same(pins.projectContextContractRef, c.contextSnapshotRef));
  requireThat(c.expiresAt === draft.expiresAt);
  requireThat(same(header.issuedBy, { principalId: input.serviceId, principalKind: 'SERVICE' }));
  requireThat(
    header.issuedAt === c.issuedAt &&
      typeof c.issuedAt === 'string' &&
      Date.parse(c.issuedAt) <= Date.parse(input.decisionIssuedAt) &&
      Date.parse(c.issuedAt) >= Date.parse(textValue(context.asOf)),
  );
  requireThat(
    same(header.payloadHash, hash(hashContractPayload(c))) &&
      same(c.specificationHash, hash(specificationHash(c))),
    'PAYLOAD_HASH_MISMATCH',
  );
  const validation = validateWorkOrderValidationPolicy(vp),
    builder = validateContextBuilderPolicy(bp),
    controls = validateWorkOrderControlsPolicy(cp);
  supported(validation.valid && builder.valid && controls.valid);
  supported(
    builder.rules.allowedProjectionTypes.some(
      (type) => type === object(context.projection).projectionType,
    ),
  );
  const scope = object(object(c.workOrderRef).scope);
  const policies = [
    ['VALIDATION', vp],
    ['CONTEXT_BUILDER', bp],
    ['CONTROLS', cp],
  ] as const;
  const observations: CanonicalJsonObject[] = policies.map(([role, p]) => {
    requireThat(
      p.useStatus === 'USABLE' &&
        Date.parse(p.effectiveFrom) <= Date.parse(input.evaluatedAt) &&
        (p.supersededAt === undefined ||
          Date.parse(p.supersededAt) > Date.parse(input.evaluatedAt)),
      'EXECUTION_JUDGMENT_STALE',
    );
    requireThat(
      p.policyRef.kind === 'VERSIONED' &&
        p.policyRef.objectType === 'zhiju.identity.policy' &&
        same(p.policyRef.scope, scope),
    );
    return {
      kind: 'POLICY',
      role,
      reference: p.policyRef,
      policyVersionRef: p.policyVersionRef,
      contentHash: p.contentHash,
      effectiveFrom: p.effectiveFrom,
      supersededAt: p.supersededAt ?? null,
    };
  });
  requireThat(
    same(pins.contextBuilderPolicyRef, bp.policyRef) &&
      same(metadata.builderPolicyRef, bp.policyRef) &&
      metadata.policyContentHash === digest(bp.contentHash) &&
      metadata.policyEffectiveFrom === bp.effectiveFrom &&
      (metadata.policySupersededAt ?? null) === (bp.supersededAt ?? null),
  );
  requireThat(same(pins.capabilityPolicyRef, cp.policyRef));
  const staticInputs = [
    ['WORK_ORDER_SCHEMA', pins.workOrderSchemaRef, 'core.work_order@1.0'],
    ['RUNTIME_ADAPTER', pins.runtimeAdapterContractRef, 'te.human_operated.synthetic@1.0'],
    ['EXECUTION_RISK', object(c.riskAndQuality).riskProfileRef, 'te.work_order.human_review@1.0'],
  ] as const;
  for (const [role, ref, key] of staticInputs) {
    const profile = resolveWorkOrderReadyProfile(ref, key);
    supported(profile !== undefined);
    observations.push({
      kind: 'STATIC',
      role,
      reference: profile.reference as unknown as CanonicalJsonObject,
      registryVersion: WORK_ORDER_READY_REGISTRY_VERSION,
      registryKey: key,
      descriptorHash: profile.descriptorHash as unknown as CanonicalJsonObject,
    });
  }
  requireThat(same(header.schemaRef, pins.workOrderSchemaRef));
  const evaluator = evaluatorProfileRegistry.profiles.find(
    (p) =>
      p.registryKey === 'te.work_order_validation.evaluator@1.0' &&
      same(p.reference, input.evaluatorRef),
  );
  supported(evaluator !== undefined);
  observations.push({
    kind: 'STATIC',
    role: 'EVALUATOR',
    reference: input.evaluatorRef,
    registryVersion: EVALUATOR_PROFILE_REGISTRY_VERSION,
    registryKey: evaluator.registryKey,
    descriptorHash: hash(sha256CanonicalJson(evaluator as unknown as CanonicalJsonObject)),
  });
  observations.sort((a, b) =>
    Buffer.compare(
      Buffer.from(`${textValue(a.kind)}:${textValue(a.role)}`),
      Buffer.from(`${textValue(b.kind)}:${textValue(b.role)}`),
    ),
  );
  empty(pins.skillRefs);
  empty(pins.templateRefs);
  supported(
    pins.regulatoryProfileRef === undefined &&
      pins.qualityProfileRef === undefined &&
      object(c.riskAndQuality).qualityProfileRef === undefined,
  );
  empty(object(c.objective).relatedIssueRefs);
  empty(object(c.objective).deliveryItemRefs);
  supported(
    same(c.constraints, [
      { constraintType: 'execution.work_order_controls', policyRef: cp.policyRef },
    ]),
  );
  const controlsValue = controls.rules.controls as unknown as CanonicalJsonObject;
  const policyRefs = (value: CanonicalJsonObject) => {
    for (const [group, fields] of [
      ['targetScope', ['scopePolicyRef']],
      ['budget', ['budgetPolicyRef']],
      ['harnessPolicy', ['selectionPolicyRef']],
      ['modelPolicy', ['selectionPolicyRef']],
      ['executionPolicy', ['leasePolicyRef', 'cancellationPolicyRef']],
      ['riskAndQuality', ['dataHandlingPolicyRef', 'escalationPolicyRef']],
    ] as const) {
      for (const field of fields) requireThat(same(object(value[group])[field], cp.policyRef));
    }
    for (const group of ['allowedCapabilities', 'deniedCapabilities'])
      for (const cap of array(value[group]))
        requireThat(same(object(cap).grantPolicyRef, cp.policyRef));
    for (const out of array(value.expectedOutputs))
      requireThat(same(object(out).acceptancePolicyRef, cp.policyRef));
  };
  const capabilityExpiries: string[] = [];
  for (const value of [c, controlsValue]) {
    policyRefs(value);
    const target = object(value.targetScope),
      risk = object(value.riskAndQuality),
      execution = object(value.executionPolicy),
      harness = object(value.harnessPolicy),
      model = object(value.modelPolicy),
      budget = object(value.budget);
    for (const k of [
      'targetObjectRefs',
      'baseContentRefs',
      'allowedUnitRefs',
      'forbiddenUnitRefs',
      'crossObjectReferencesAllowed',
    ])
      empty(target[k]);
    supported(
      same(target.allowedCreateTypes, [
        'zhiju.artifact.artifact',
        'zhiju.artifact.artifact_revision',
      ]),
    );
    supported(
      same(risk.riskProfileRef, object(c.riskAndQuality).riskProfileRef) &&
        risk.humanReviewRequired === true,
    );
    supported(
      execution.maxAttempts === 1 &&
        execution.resumePolicy === 'new_run_only' &&
        execution.fallbackPolicy === 'human_intervention',
    );
    empty(execution.retryableOutcomes);
    supported(
      harness.requiredHarness === 'zhiju.runtime.synthetic' &&
        same(harness.preferredHarnesses, ['zhiju.runtime.synthetic']) &&
        harness.fallbackAllowed === false &&
        harness.fallbackRequiresHuman === true,
    );
    supported(
      same(model.allowedProviders, ['synthetic']) && same(model.allowedModels, ['synthetic']),
    );
    empty(model.minimumCapabilities);
    const prohibited = array(model.prohibitedDataClasses);
    ordered(prohibited);
    supported(prohibited.includes('RESTRICTED_PERSONAL') && prohibited.includes('REGULATED'));
    supported(
      ['tokenLimit', 'toolCallLimit', 'wallClockLimit', 'monetaryLimit'].some(
        (k) => budget[k] !== undefined,
      ),
    );
    if (budget.wallClockLimit !== undefined)
      supported(
        typeof budget.wallClockLimit === 'string' &&
          /^PT[1-9][0-9]*S$/u.test(budget.wallClockLimit),
      );
    if (budget.monetaryLimit !== undefined)
      supported(
        /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(
          textValue(object(budget.monetaryLimit).amountDecimal),
        ) && /[1-9]/u.test(textValue(object(budget.monetaryLimit).amountDecimal)),
      );
    const allowed = array(value.allowedCapabilities),
      denied = array(value.deniedCapabilities);
    for (const caps of [allowed, denied]) {
      ordered(caps, (cap) => textValue(object(cap).capabilityType));
      for (const capValue of caps) {
        const cap = object(capValue);
        empty(cap.constraints);
        ordered(array(cap.actions));
        ordered(array(cap.resourceSelectors));
        supported(
          array(cap.actions).every((a) => a === 'read' || a === 'create') &&
            array(cap.resourceSelectors).every((r) => array(target.allowedCreateTypes).includes(r)),
        );
        requireThat(
          Date.parse(textValue(cap.expiresAt)) > Date.parse(input.evaluatedAt),
          'EXECUTION_JUDGMENT_STALE',
        );
        capabilityExpiries.push(textValue(cap.expiresAt));
      }
    }
    supported(
      !allowed.some((a) =>
        denied.some((b) => object(a).capabilityType === object(b).capabilityType),
      ),
    );
    const outputs = array(value.expectedOutputs);
    ordered(outputs, (o) => textValue(object(o).outputSlot));
    for (const outValue of outputs) {
      const out = object(outValue);
      supported(
        same(out.allowedObjectTypes, ['zhiju.artifact.artifact_revision']) &&
          out.requiredReferenceStrength === 'CONTENT_ADDRESSED' &&
          out.creationRequired === true &&
          out.schemaRef === undefined &&
          out.qualityStageRequired === undefined &&
          out.requiredTargetRelation === undefined,
      );
    }
  }
  const criteria = array(c.completionCriteria);
  ordered(criteria, (x) => textValue(object(x).criterionId));
  for (const val of criteria) {
    const crit = object(val);
    supported(
      criterionTypes.includes(textValue(crit.criterionType)) &&
        same(crit.evaluatorRef, input.evaluatorRef),
    );
    supported(
      crit.failureDisposition === 'block_until_satisfied' ||
        crit.failureDisposition === 'require_human_review',
    );
    // The original profile accepts its explicit EXACTLY_ONE aliases only for that slot.
    const binding = array(crit.inputBindings);
    supported(binding.length === 1);
    const slot = array(c.expectedOutputs).find(
      (out) => `expectedOutput.${textValue(object(out).outputSlot)}` === binding[0],
    );
    supported(
      crit.criterionType === 'NO_BLOCKING_INFORMATION_REQUEST'
        ? binding[0] === 'informationRequests'
        : slot !== undefined,
    );
    supported(
      crit.expectedCondition === 'satisfied' ||
        (crit.expectedCondition === 'one ContentAddressedRef points to a frozen revision' &&
          slot !== undefined &&
          object(slot).cardinality === 'EXACTLY_ONE'),
    );
  }
  supported(
    (validation.rules.mandatoryCriterionTypes ?? []).every((t) => criterionTypes.includes(t)),
  );
  const covered = (type: string, binding?: string) =>
    criteria.some((v) => {
      const cr = object(v);
      return (
        cr.required === true &&
        cr.criterionType === type &&
        (binding === undefined || array(cr.inputBindings).includes(binding))
      );
    });
  const coverage =
    covered('NO_BLOCKING_INFORMATION_REQUEST') &&
    array(c.expectedOutputs).every((out) =>
      outputCriteria.every((t) =>
        covered(t, `expectedOutput.${textValue(object(out).outputSlot)}`),
      ),
    ) &&
    (validation.rules.mandatoryCriterionTypes ?? []).every((t) => covered(t));
  const planEqual = [
    'targetScope',
    'expectedOutputs',
    'riskAndQuality',
    'executionPolicy',
    'harnessPolicy',
    'modelPolicy',
  ].every((k) => same(c[k], controlsValue[k]));
  const capsEqual = ['allowedCapabilities', 'deniedCapabilities'].every((k) =>
    same(c[k], controlsValue[k]),
  );
  const inputObservations = array(metadata.inputRefObservations);
  let inputCoverage = true;
  for (const val of array(c.inputRefs)) {
    const entry = object(val),
      ref = object(entry.ref);
    supported(
      ['zhiju.project.enterprise_fact', 'zhiju.project.context_source_slice'].includes(
        textValue(ref.objectType),
      ) && ref.kind !== 'EXTERNAL',
    );
    const observation = inputObservations.find((v) => same(object(v).ref, ref));
    requireThat(observation !== undefined);
    if (entry.required === true && object(observation).resolution !== 'ADOPTED')
      inputCoverage = false;
  }
  const contextCoverage =
    object(context.coverage).completeness === 'COMPLETE_FOR_PURPOSE' && inputCoverage;
  const checks: CanonicalJsonObject[] = [];
  function check(checkCode: string, ok: boolean, reasonCodes: string[]) {
    checks.push({
      checkCode,
      outcome: ok ? 'SATISFIED' : 'UNSATISFIED',
      reasonCodes: ok ? [] : reasonCodes,
    });
    return ok;
  }
  const valid = check('PLAN_VALID', planEqual && coverage, [
    ...(!planEqual ? ['PLAN_CONTROL_MISMATCH'] : []),
    ...(!coverage ? ['CRITERION_COVERAGE_MISSING'] : []),
  ]);
  const referencesValid = check('REFERENCES_VALID', true, []),
    specificationHashValid = check('SPECIFICATION_HASH_VALID', true, []);
  const capabilityValid = check('CAPABILITY_VALID', capsEqual && input.capabilitiesValid, [
    ...(!capsEqual ? ['CAPABILITY_CONTROL_MISMATCH'] : []),
    ...(!input.capabilitiesValid ? ['HUMAN_ONLY_CAPABILITY'] : []),
  ]);
  const budgetValid = check('BUDGET_VALID', same(c.budget, controlsValue.budget), [
    'BUDGET_CONTROL_MISMATCH',
  ]);
  const contextCoverageValid = check('CONTEXT_COVERAGE_VALID', contextCoverage, [
    'CONTEXT_COVERAGE_INCOMPLETE',
  ]);
  const executable = check(
    'EXECUTABLE',
    valid &&
      referencesValid &&
      specificationHashValid &&
      capabilityValid &&
      budgetValid &&
      contextCoverageValid,
    [],
  );
  checks.sort((a, b) =>
    Buffer.compare(Buffer.from(textValue(a.checkCode)), Buffer.from(textValue(b.checkCode))),
  );
  const bounds = [
    new Date(
      Date.parse(input.evaluatedAt) + validation.rules.maxValidationValiditySeconds * 1000,
    ).toISOString(),
    ...input.decisionExpiries,
    ...input.sliceExpiries,
    ...capabilityExpiries,
    ...policies.flatMap(([, p]) => (p.supersededAt === undefined ? [] : [p.supersededAt])),
    ...[c.expiresAt, metadata.effectiveExpiresAt].filter((v) => typeof v === 'string'),
  ];
  const validUntil = new Date(Math.min(...bounds.map(Date.parse))).toISOString();
  requireThat(Date.parse(validUntil) > Date.parse(input.evaluatedAt), 'EXECUTION_JUDGMENT_STALE');
  return {
    dependencyObservations: observations,
    validUntil,
    checks,
    validation: {
      valid,
      referencesValid,
      specificationHashValid,
      capabilityValid,
      executable,
      budgetValid,
      contextCoverageValid,
      violations: checks.flatMap((c) => array(c.reasonCodes)),
      validatedAt: input.evaluatedAt,
    },
  };
}
