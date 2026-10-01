import {
  getContractRegistry,
  EVALUATOR_PROFILE_REGISTRY_VERSION,
  registeredEvaluatorProfileReference,
  registeredEvaluatorProfileKey,
  isExecutionDocumentSchema,
} from '@zhiju/contracts';
import {
  sha256CanonicalJson,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import { object, requireThat, same, hash, textValue } from './work-order-validation-plan.js';
import { canonicalSet } from './blocked-input-recovery.js';

const registry = getContractRegistry();
export const FORMAL_VALIDATOR = 'te.work_order_validation.evaluator@2.0';
export const FORMAL_RESULT_VALIDATOR = 'te.agent_result_validation.evaluator@2.0';
export const WORK_ORDER_COMPLETION = 'te.work_order_completion.evaluator@1.0';
export const TASK_COMPLETION = 'te.task_completion.evaluator@1.0';
export function formalSelector(key: string): CanonicalJsonObject {
  const ref = registeredEvaluatorProfileReference(EVALUATOR_PROFILE_REGISTRY_VERSION, key);
  requireThat(ref, 'EXECUTION_CRITERION_UNSUPPORTED');
  return ref as unknown as CanonicalJsonObject;
}
export function formalEvaluator(ref: unknown, key: string) {
  return registeredEvaluatorProfileKey(EVALUATOR_PROFILE_REGISTRY_VERSION, ref) === key;
}
export function isFormalContract(contract: CanonicalJsonObject): boolean {
  return same(object(contract.versionPins).runtimeAdapterContractRef, {
    kind: 'VERSIONED',
    objectType: 'zhiju.runtime.adapter_contract',
    objectId: '0199b600-0000-7000-8000-000000000301',
    versionId: '0199b600-0000-7000-8000-000000000311',
    scope: {},
  });
}
export function formalCompletionPolicy(contract: CanonicalJsonObject): CanonicalJsonObject {
  requireThat(isFormalContract(contract), 'EXECUTION_CRITERION_UNSUPPORTED');
  const constraints = contract.constraints;
  requireThat(
    Array.isArray(constraints) &&
      constraints.length === 1 &&
      Object.keys(object(constraints[0])).length === 2 &&
      object(constraints[0]).profile === 'execution.completion_binding.v1',
    'EXECUTION_CRITERION_UNSUPPORTED',
  );
  return object(object(constraints[0]).policyRef);
}
export function formalCriteria(
  contract: CanonicalJsonObject,
  taskDefinition?: CanonicalJsonObject,
) {
  const unsupported = 'EXECUTION_CRITERION_UNSUPPORTED';
  const scope = object(object(contract.workOrderRef).scope);
  const outputs = contract.expectedOutputs;
  requireThat(Array.isArray(outputs) && outputs.length === 1, unsupported);
  const output = object(outputs[0]);
  requireThat(
    output.cardinality === 'EXACTLY_ONE' &&
      output.creationRequired === true &&
      output.requiredReferenceStrength === 'CONTENT_ADDRESSED' &&
      same(output.allowedObjectTypes, ['artifact.artifact_revision']) &&
      isExecutionDocumentSchema(output.schemaRef, textValue(scope.enterpriseId)) &&
      output.qualityStageRequired === undefined &&
      output.requiredTargetRelation === undefined,
    unsupported,
  );
  const types = [
    'EXPECTED_OUTPUT_PRESENT',
    'OUTPUT_REF_VALID',
    'OUTPUT_CREATED_BY_WORK_ORDER',
    'OUTPUT_SCHEMA_VALID',
    'OUTPUT_WITHIN_TARGET_SCOPE',
    'NO_BLOCKING_INFORMATION_REQUEST',
    ...(object(contract.executionPolicy).maxAttempts === 2 ? ['REQUIRED_PROPOSAL_PROCESSED'] : []),
  ];
  const criteria = contract.completionCriteria;
  requireThat(
    Array.isArray(criteria) &&
      criteria.length === types.length &&
      new Set(criteria.map((c) => object(c).criterionId)).size === criteria.length &&
      new Set(criteria.map((c) => object(c).criterionType)).size === criteria.length,
    unsupported,
  );
  for (const val of criteria) {
    const c = object(val);
    const binding =
      c.criterionType === 'NO_BLOCKING_INFORMATION_REQUEST'
        ? 'informationRequests'
        : c.criterionType === 'REQUIRED_PROPOSAL_PROCESSED'
          ? 'requiredProposals'
          : `expectedOutput.${textValue(output.outputSlot)}`;
    requireThat(
      types.includes(textValue(c.criterionType)) &&
        c.required === true &&
        c.expectedCondition === 'satisfied' &&
        same(c.inputBindings, [binding]) &&
        formalEvaluator(c.evaluatorRef, WORK_ORDER_COMPLETION),
      unsupported,
    );
  }
  requireThat(
    types.every((type) => criteria.some((c) => object(c).criterionType === type)),
    unsupported,
  );
  requireThat(
    same(object(contract.targetScope).allowedCreateTypes, [
      'artifact.artifact',
      'artifact.artifact_revision',
    ]),
    unsupported,
  );
  formalCompletionPolicy(contract);
  if (taskDefinition !== undefined) validateFormalTaskDefinition(taskDefinition, output);
  return { output, criteria: criteria.map(object) };
}
export function validateFormalTaskDefinition(
  definition: CanonicalJsonObject,
  output?: CanonicalJsonObject,
) {
  const unsupported = 'EXECUTION_CRITERION_UNSUPPORTED';
  const outputs = object(definition.expectedOutputSpec).outputs,
    criteria = object(definition.completionCriteria).criteria;
  requireThat(
    Array.isArray(outputs) && outputs.length === 1 && Array.isArray(criteria),
    unsupported,
  );
  if (output) requireThat(same(outputs, [output]), unsupported);
  requireThat(
    new Set(criteria.map((c) => object(c).criterionId)).size === criteria.length &&
      new Set(criteria.map((c) => object(c).criterionType)).size === criteria.length,
    unsupported,
  );
  const types = [
    'EXPECTED_OUTPUTS_SATISFIED',
    'NO_BLOCKING_INFORMATION_REQUEST',
    'REQUIRED_WORK_ORDERS_COMPLETED',
    'REVISION_ACCEPTANCE_READY',
    'REVISION_FULLY_APPROVED',
  ];
  for (const val of criteria) {
    const c = object(val);
    requireThat(
      types.includes(textValue(c.criterionType)) &&
        c.required === true &&
        formalEvaluator(c.evaluatorRef, TASK_COMPLETION) &&
        same(c.expectedCondition, { satisfied: true }),
      unsupported,
    );
    const binding =
      c.criterionType === 'NO_BLOCKING_INFORMATION_REQUEST'
        ? { scope: 'TASK_AND_CHILD_WORK_ORDERS' }
        : c.criterionType === 'REQUIRED_WORK_ORDERS_COMPLETED'
          ? { scope: 'ALL_CHILD_WORK_ORDERS' }
          : { outputSlots: [object(outputs[0]).outputSlot] };
    requireThat(same(c.bindings, binding), unsupported);
  }
  requireThat(
    types.slice(0, 3).every((type) => criteria.some((c) => object(c).criterionType === type)),
    unsupported,
  );
  const full = criteria.some((c) => object(c).criterionType === 'REVISION_FULLY_APPROVED');
  requireThat(
    !full || criteria.some((c) => object(c).criterionType === 'REVISION_ACCEPTANCE_READY'),
    unsupported,
  );
  return {
    output: object(outputs[0]),
    criteria: criteria.map(object),
    quality: criteria.some((c) =>
      ['REVISION_ACCEPTANCE_READY', 'REVISION_FULLY_APPROVED'].includes(
        textValue(object(c).criterionType),
      ),
    ),
    requireApproval: full,
  };
}
/** Recompute all immutable source identities; declared Result fields alone grant nothing. */
export function verifyFormalOutput(input: {
  contract: CanonicalJsonObject;
  runRef: CanonicalJsonObject;
  contextRef: CanonicalJsonObject;
  contractRef: CanonicalJsonObject;
  output: CanonicalJsonObject;
  fact: CanonicalJsonObject;
  submittedAt: string;
  endedAt?: string;
  startedAt: string;
}) {
  const { contract, runRef, contextRef, contractRef, output, fact } = input;
  const scope = object(runRef.scope),
    expected = formalCriteria(contract).output;
  const revision = object(fact.revision),
    binding = object(fact.creationBinding),
    receipt = object(fact.creationReceipt),
    content = object(fact.canonicalContent);
  requireThat(
    registry.validateOperationResult('artifact.get_execution_output_fact', '1.0', fact).valid,
    'EXECUTION_JUDGMENT_INVALID',
  );
  requireThat(
    output.objectType === 'artifact.artifact_revision' &&
      output.outputSlot === expected.outputSlot &&
      output.relationToTarget === 'created_for_work_order' &&
      same(output.createdByRunRef, runRef) &&
      same(output.ref, revision.revisionRef) &&
      same(output.creationCommandRef, binding.creationCommandRef) &&
      same(binding.revisionRef, output.ref),
    'EXECUTION_JUDGMENT_INVALID',
  );
  requireThat(
    same(binding.runRef, runRef) &&
      same(binding.taskRef, contract.taskRef) &&
      same(binding.workOrderRef, contract.workOrderRef) &&
      same(binding.workOrderContractRef, contractRef) &&
      same(binding.contextSnapshotRef, contextRef) &&
      same(binding.controlsPolicyRef, object(contract.versionPins).capabilityPolicyRef),
    'EXECUTION_JUDGMENT_INVALID',
  );
  requireThat(
    same(binding.creationCommandRef, {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'zhiju.artifact.command_receipt',
      objectId: receipt.commandId,
      scope,
      contentHash: hash(sha256CanonicalJson(receipt)),
    }) &&
      same(fact.creationBindingHash, hash(sha256CanonicalJson(binding))) &&
      receipt.commandType === 'artifact.create_execution_revision' &&
      receipt.commandVersion === '1.0' &&
      receipt.outcome === 'COMMITTED' &&
      same(receipt.revisionRef, output.ref) &&
      same(receipt.scopeRef, scope) &&
      same(receipt.actorRef, object(revision.provenance).principal),
    'EXECUTION_JUDGMENT_INVALID',
  );
  requireThat(
    same(object(output.ref).scope, scope) &&
      same(object(fact.artifactRef).scope, scope) &&
      fact.businessScope === 'PROJECT_DELIVERABLE' &&
      same(fact.originProjectRef, contract.projectRef),
    'EXECUTION_JUDGMENT_INVALID',
  );
  requireThat(
    isExecutionDocumentSchema(content.schemaRef, textValue(scope.enterpriseId)) &&
      same(content.schemaRef, expected.schemaRef) &&
      registry.validateCanonicalContent(content).valid &&
      same(object(output.ref).contentHash, hash(sha256CanonicalJson(content))),
    'EXECUTION_JUDGMENT_INVALID',
  );
  const provenance = object(revision.provenance);
  requireThat(
    same(provenance.taskRef, contract.taskRef) &&
      same(provenance.workOrderRef, contract.workOrderRef) &&
      same(provenance.runRef, runRef) &&
      same(provenance.contextSnapshotRef, contextRef) &&
      provenance.agentResultRef === undefined &&
      provenance.actingForRef === undefined &&
      same(provenance.sourceMaterialRefs, []) &&
      same(provenance.toolchainVersions, []),
    'EXECUTION_JUDGMENT_INVALID',
  );
  const at = Date.parse(textValue(binding.createdAt)),
    observed = Date.parse(textValue(binding.bindingObservedAt));
  requireThat(
    Number.isFinite(at) &&
      at >= Date.parse(input.startedAt) &&
      at >= observed &&
      at < Date.parse(textValue(binding.bindingValidUntil)) &&
      at <= Date.parse(input.submittedAt) &&
      (input.endedAt === undefined || at <= Date.parse(input.endedAt)) &&
      same(binding.startedAt, input.startedAt),
    'EXECUTION_JUDGMENT_INVALID',
  );
  const forbidden = canonicalSet([
    ...(contract.inputRefs as CanonicalJsonValue[]).map((v) => object(v).ref as CanonicalJsonValue),
    ...(object(contract.targetScope).baseContentRefs as CanonicalJsonValue[]),
    ...(revision.parentRevisionRefs as CanonicalJsonValue[]),
  ]);
  requireThat(
    !forbidden.some((v) => object(v).objectId === object(output.ref).objectId),
    'EXECUTION_JUDGMENT_INVALID',
  );
  return {
    usable: fact.useStatus === 'USABLE',
    revoked: fact.useStatus === 'REVOKED',
    ref: object(output.ref),
    observationHash: hash(sha256CanonicalJson(fact)),
    fact,
  };
}
