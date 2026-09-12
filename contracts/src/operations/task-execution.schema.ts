import type { JsonSchema, OperationVersion } from '../schema-types.js';

const schemaId = 'https://schemas.zhiju.local/modules/task-execution/1.0';
const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';
const workOrderTypes = 'https://schemas.zhiju.local/core/work-order/1.0#/$defs/';
const projectContextContract = {
  $ref: 'https://schemas.zhiju.local/core/project-context/1.0',
} as const;
const workOrderContract = { $ref: 'https://schemas.zhiju.local/core/work-order/1.0' } as const;
const agentResultContract = { $ref: 'https://schemas.zhiju.local/core/agent-result/1.0' } as const;

type SchemaProperties = Readonly<Record<string, unknown>>;

interface OperationContractSchema {
  readonly payload: JsonSchema;
  readonly result?: JsonSchema;
}

function operationSchemaDefinitionName(
  type: string,
  version: OperationVersion,
  suffix: 'payload' | 'result',
): string {
  const versionSuffix = version === '1.0' ? '' : `_v${version.replaceAll('.', '_')}`;
  return `${type.replaceAll('.', '_')}${versionSuffix}_${suffix}`;
}

export interface ExecutableExecutionOperationContract {
  readonly payloadSchemaRef: string;
  readonly resultSchemaRef?: string;
}

function object(required: readonly string[], properties: SchemaProperties): JsonSchema {
  return { type: 'object', additionalProperties: false, required, properties };
}

function array(
  items: unknown,
  options: { readonly nonEmpty?: boolean; readonly unique?: boolean } = {},
) {
  return {
    type: 'array',
    items,
    ...(options.nonEmpty === true ? { minItems: 1 } : {}),
    ...(options.unique === true ? { uniqueItems: true } : {}),
  } as const;
}

function localRef(name: string) {
  return { $ref: `${schemaId}#/$defs/${name}` } as const;
}

function workOrderTypeRef(name: string) {
  return { $ref: `${workOrderTypes}${name}` } as const;
}

function exactObjectType(reference: unknown, objectType: string): JsonSchema {
  return {
    allOf: [reference, { type: 'object', properties: { objectType: { const: objectType } } }],
  };
}

const uuid = { $ref: `${common}uuidV7` } as const;
const namespace = { $ref: `${common}namespaceCode` } as const;
const reasonCode = { $ref: `${common}reasonCode` } as const;
const text = { $ref: `${common}nonEmptyString` } as const;
const instant = { $ref: `${common}utcInstant` } as const;
const positiveInt = { $ref: `${common}positiveInteger` } as const;
const nonNegativeInt = { $ref: `${common}nonNegativeInteger` } as const;
const losslessNonNegativeInt = {
  $ref: `${common}nonNegativeInteger`,
  type: 'integer',
  maximum: 9007199254740991,
} as const;
const payloadHash = { $ref: `${common}contentHash` } as const;
const objectReference = { $ref: `${common}objectRef` } as const;
const versionedReference = { $ref: `${common}versionedRef` } as const;
const typedReference = { $ref: `${common}typedReference` } as const;
const contentAddressedReference = { $ref: `${common}contentAddressedRef` } as const;
const snapshotReference = { $ref: `${common}snapshotRef` } as const;
const principalReference = { $ref: `${common}principalRef` } as const;
const scopeReference = { $ref: `${common}scopeRef` } as const;
const externalReference = { $ref: `${common}externalRef` } as const;
const canonicalJson = {} as const;

const workOrderObjectReference = exactObjectType(objectReference, 'zhiju.execution.work_order');
const taskObjectReference = exactObjectType(objectReference, 'zhiju.execution.task');
const projectObjectReference = exactObjectType(objectReference, 'zhiju.project.project');
const draftSnapshotReference = exactObjectType(
  contentAddressedReference,
  'zhiju.execution.work_order_draft_snapshot',
);
const sourceSliceReference = exactObjectType(
  contentAddressedReference,
  'zhiju.project.context_source_slice',
);
const builderPolicyReference = exactObjectType(versionedReference, 'zhiju.identity.policy');
/**
 * Initial Context entries return a Project-scoped Context Snapshot. Beside the
 * canonical object type this narrows the shared `scopeRef` so both members are
 * present; the shared `scopeRef` itself stays unchanged for the historical
 * read paths, which must keep accepting their legacy snapshots.
 */
const contextSnapshotReference = {
  allOf: [
    snapshotReference,
    {
      type: 'object',
      properties: {
        objectType: { const: 'zhiju.execution.context_snapshot' },
        scope: {
          type: 'object',
          required: ['enterpriseId', 'projectId'],
          properties: {
            enterpriseId: { $ref: `${common}uuidV7` },
            projectId: { $ref: `${common}uuidV7` },
          },
        },
      },
    },
  ],
} as const;

const taskStatus = {
  enum: [
    'DRAFT',
    'BACKLOG',
    'READY',
    'IN_PROGRESS',
    'WAITING_INPUT',
    'BLOCKED',
    'IN_REVIEW',
    'CHANGES_REQUIRED',
    'COMPLETION_PENDING',
    'COMPLETED',
    'CANCELLED',
  ],
} as const;

const workOrderStatus = {
  enum: [
    'DRAFT',
    'READY',
    'QUEUED',
    'RUNNING',
    'WAITING_INPUT',
    'COMPLETION_PENDING',
    'RETRY_PENDING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
    'EXPIRED',
  ],
} as const;

const runStatus = {
  enum: [
    'CREATED',
    'STARTING',
    'RUNNING',
    'SUSPENDED',
    'CANCELLING',
    'RESULT_RECORDED',
    'SUCCEEDED',
    'INVALID_RESULT',
    'FAILED',
    'TIMED_OUT',
    'CANCELLED',
    'ABANDONED',
    'INVALIDATED',
  ],
} as const;

const terminalRunStatus = {
  enum: [
    'SUCCEEDED',
    'INVALID_RESULT',
    'FAILED',
    'TIMED_OUT',
    'CANCELLED',
    'ABANDONED',
    'INVALIDATED',
  ],
} as const;

const executionOutcome = {
  enum: [
    'COMPLETED',
    'PARTIAL',
    'BLOCKED_INPUT',
    'BLOCKED_POLICY',
    'FAILED_EXECUTION',
    'CANCELLED_BY_RUNTIME',
  ],
} as const;

const informationRequestStatus = {
  enum: [
    'OPEN',
    'DELIVERY_PENDING',
    'DELIVERED',
    'ANSWERED',
    'UNDER_VALIDATION',
    'CLARIFICATION_REQUIRED',
    'ANSWER_REJECTED',
    'RESOLVED',
    'DELIVERY_FAILED',
    'EXPIRED',
    'CANCELLED',
  ],
} as const;

const authoritativeSource = {
  enum: ['PROVIDER', 'RUNTIME_ADAPTER', 'HARNESS', 'AGENT_DECLARED', 'UNAVAILABLE'],
} as const;

/**
 * §11.6 criterion `bindings`. The three branches are closed shapes and the
 * criterion type selects exactly one of them through the `allOf` guard below,
 * so a criterion cannot carry a binding that does not belong to its type.
 */
const taskCriterionOutputSlotBindings = object(['outputSlots'], {
  outputSlots: array(namespace, { nonEmpty: true, unique: true }),
});
const taskCriterionChildWorkOrderBindings = object(['scope'], {
  scope: { const: 'ALL_CHILD_WORK_ORDERS' },
});
const taskCriterionTaskAndChildWorkOrderBindings = object(['scope'], {
  scope: { const: 'TASK_AND_CHILD_WORK_ORDERS' },
});

const taskCriterionV1 = {
  type: 'object',
  additionalProperties: false,
  required: [
    'criterionId',
    'criterionType',
    'required',
    'evaluatorRef',
    'bindings',
    'expectedCondition',
    'failureDisposition',
  ],
  properties: {
    criterionId: namespace,
    criterionType: {
      enum: [
        'EXPECTED_OUTPUTS_SATISFIED',
        'NO_BLOCKING_INFORMATION_REQUEST',
        'REQUIRED_WORK_ORDERS_COMPLETED',
        'REVISION_ACCEPTANCE_READY',
        'REVISION_FULLY_APPROVED',
      ],
    },
    required: { type: 'boolean' },
    // `VersionedRef<Evaluator>`; no `Evaluator` object type is registered, so
    // the ref keeps the shared generic VersionedRef shape exactly as the Core
    // `completionCriterion.evaluatorRef` does. Whether a given evaluator id and
    // version are supported is an owning-Handler fact and is not asserted here.
    evaluatorRef: versionedReference,
    bindings: {
      oneOf: [
        taskCriterionOutputSlotBindings,
        taskCriterionChildWorkOrderBindings,
        taskCriterionTaskAndChildWorkOrderBindings,
      ],
    },
    expectedCondition: object(['satisfied'], { satisfied: { const: true } }),
    failureDisposition: { enum: ['BLOCK', 'REQUIRE_HUMAN_REVIEW'] },
  },
  allOf: [
    {
      if: {
        properties: { criterionType: { const: 'EXPECTED_OUTPUTS_SATISFIED' } },
        required: ['criterionType'],
      },
      then: { properties: { bindings: taskCriterionOutputSlotBindings } },
    },
    {
      if: {
        properties: { criterionType: { const: 'NO_BLOCKING_INFORMATION_REQUEST' } },
        required: ['criterionType'],
      },
      then: { properties: { bindings: taskCriterionTaskAndChildWorkOrderBindings } },
    },
    {
      if: {
        properties: { criterionType: { const: 'REQUIRED_WORK_ORDERS_COMPLETED' } },
        required: ['criterionType'],
      },
      then: { properties: { bindings: taskCriterionChildWorkOrderBindings } },
    },
    {
      if: {
        properties: { criterionType: { const: 'REVISION_ACCEPTANCE_READY' } },
        required: ['criterionType'],
      },
      then: { properties: { bindings: taskCriterionOutputSlotBindings } },
    },
    {
      if: {
        properties: { criterionType: { const: 'REVISION_FULLY_APPROVED' } },
        required: ['criterionType'],
      },
      then: { properties: { bindings: taskCriterionOutputSlotBindings } },
    },
  ],
} as const satisfies JsonSchema;

/**
 * Business fields shared by the historical `TaskDefinition` and the `@2.0`
 * `TaskDefinitionV2`. §11.6 defines v2 as v1 `except` the two output/completion
 * members, so both definitions are rendered from this single map and only those
 * two members differ.
 */
const taskDefinitionProperties = {
  deliveryItemRef: versionedReference,
  parentTaskRef: objectReference,
  taskType: namespace,
  title: text,
  objective: text,
  priority: namespace,
  riskLevel: namespace,
  dependencyTaskRefs: array(objectReference, { unique: true }),
  inputRefs: array(typedReference, { unique: true }),
  expectedOutputSpec: canonicalJson,
  completionCriteria: canonicalJson,
  dueConstraint: canonicalJson,
} as const;

const namedDefinitions = {
  taskStatus,
  workOrderStatus,
  runStatus,
  terminalRunStatus,
  executionOutcome,
  informationRequestStatus,
  authoritativeSource,
  taskDefinition: object(
    [
      'taskType',
      'title',
      'objective',
      'priority',
      'riskLevel',
      'dependencyTaskRefs',
      'inputRefs',
      'expectedOutputSpec',
      'completionCriteria',
    ],
    taskDefinitionProperties,
  ),
  // §11.6 `TaskDefinitionV2 = TaskDefinition except:` — the only members that
  // change are the two open CanonicalJson fields, which become registered closed
  // shapes so a criterion cannot bind an output slot that no output declares.
  taskDefinitionV2: object(
    [
      'taskType',
      'title',
      'objective',
      'priority',
      'riskLevel',
      'dependencyTaskRefs',
      'inputRefs',
      'expectedOutputSpec',
      'completionCriteria',
    ],
    {
      ...taskDefinitionProperties,
      expectedOutputSpec: localRef('taskExpectedOutputSpec'),
      completionCriteria: localRef('taskCompletionCriteria'),
    },
  ),
  taskExpectedOutputSpec: object(['schemaVersion', 'outputs'], {
    schemaVersion: { const: '1.0' },
    // `ExpectedOutput[]` per §11.6; the Core `ExpectedOutput` value object is
    // reused unchanged, including `outputSlot` and `cardinality`.
    outputs: array(workOrderTypeRef('expectedOutput')),
  }),
  taskCompletionCriteria: object(['schemaVersion', 'criteria'], {
    schemaVersion: { const: '1.0' },
    criteria: array(localRef('taskCriterionV1'), { nonEmpty: true, unique: true }),
  }),
  taskCriterionV1,
  workOrderDraft: object(
    [
      'taskRef',
      'requestedBy',
      'objective',
      'targetScope',
      'inputRefs',
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
    ],
    {
      taskRef: objectReference,
      requestedBy: principalReference,
      objective: workOrderTypeRef('objective'),
      targetScope: workOrderTypeRef('targetScope'),
      inputRefs: array(workOrderTypeRef('inputRef'), { unique: true }),
      constraints: array(canonicalJson),
      allowedCapabilities: array(workOrderTypeRef('capabilityGrant'), { unique: true }),
      deniedCapabilities: array(workOrderTypeRef('capabilityGrant'), { unique: true }),
      expectedOutputs: array(workOrderTypeRef('expectedOutput'), { nonEmpty: true, unique: true }),
      completionCriteria: array(workOrderTypeRef('completionCriterion'), {
        nonEmpty: true,
        unique: true,
      }),
      riskAndQuality: workOrderTypeRef('riskAndQuality'),
      executionPolicy: workOrderTypeRef('executionPolicy'),
      budget: workOrderTypeRef('executionBudget'),
      harnessPolicy: workOrderTypeRef('harnessPolicy'),
      modelPolicy: workOrderTypeRef('modelPolicy'),
      versionPins: workOrderTypeRef('versionPins'),
    },
  ),
  draftVersionPins: object(
    [
      'contextBuilderPolicyRef',
      'workOrderSchemaRef',
      'skillRefs',
      'templateRefs',
      'capabilityPolicyRef',
      'runtimeAdapterContractRef',
    ],
    {
      contextBuilderPolicyRef: builderPolicyReference,
      workOrderSchemaRef: versionedReference,
      skillRefs: array(versionedReference, { unique: true }),
      templateRefs: array(versionedReference, { unique: true }),
      regulatoryProfileRef: versionedReference,
      qualityProfileRef: versionedReference,
      capabilityPolicyRef: versionedReference,
      runtimeAdapterContractRef: versionedReference,
    },
  ),
  initialWorkOrderDraft: object(
    [
      'taskRef',
      'requestedBy',
      'objective',
      'targetScope',
      'inputRefs',
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
    ],
    {
      taskRef: objectReference,
      requestedBy: principalReference,
      objective: workOrderTypeRef('objective'),
      targetScope: workOrderTypeRef('targetScope'),
      inputRefs: array(workOrderTypeRef('inputRef'), { unique: true }),
      constraints: array(canonicalJson),
      allowedCapabilities: array(workOrderTypeRef('capabilityGrant'), { unique: true }),
      deniedCapabilities: array(workOrderTypeRef('capabilityGrant'), { unique: true }),
      expectedOutputs: array(workOrderTypeRef('expectedOutput'), { nonEmpty: true, unique: true }),
      completionCriteria: array(workOrderTypeRef('completionCriterion'), {
        nonEmpty: true,
        unique: true,
      }),
      riskAndQuality: workOrderTypeRef('riskAndQuality'),
      executionPolicy: workOrderTypeRef('executionPolicy'),
      budget: workOrderTypeRef('executionBudget'),
      harnessPolicy: workOrderTypeRef('harnessPolicy'),
      modelPolicy: workOrderTypeRef('modelPolicy'),
      versionPins: localRef('draftVersionPins'),
    },
  ),
  workOrderDraftSnapshot: object(
    ['snapshotId', 'workOrderRef', 'taskRef', 'scopeRef', 'draft', 'capturedAt', 'createdBy'],
    {
      snapshotId: uuid,
      workOrderRef: workOrderObjectReference,
      taskRef: taskObjectReference,
      scopeRef: scopeReference,
      draft: localRef('workOrderDraft'),
      expiresAt: instant,
      capturedAt: instant,
      createdBy: principalReference,
    },
  ),
  initialWorkOrderDraftSnapshot: object(
    ['snapshotId', 'workOrderRef', 'taskRef', 'scopeRef', 'draft', 'capturedAt', 'createdBy'],
    {
      snapshotId: uuid,
      workOrderRef: workOrderObjectReference,
      taskRef: taskObjectReference,
      scopeRef: scopeReference,
      draft: localRef('initialWorkOrderDraft'),
      expiresAt: instant,
      capturedAt: instant,
      createdBy: principalReference,
    },
  ),
  initialContextBuildRequest: object(
    [
      'draftSnapshotRef',
      'projectionType',
      'purpose',
      'audience',
      'sourceSlices',
      'builderPolicyRef',
    ],
    {
      draftSnapshotRef: draftSnapshotReference,
      projectionType: { $ref: `${common}projectionType` },
      purpose: namespace,
      audience: principalReference,
      sourceSlices: array(sourceSliceReference, { nonEmpty: true, unique: true }),
      builderPolicyRef: builderPolicyReference,
      expiresAt: instant,
    },
  ),
  initialContextBuildRequestV11: object(
    [
      'draftSnapshotRef',
      'projectionType',
      'purpose',
      'audience',
      'sourceSlices',
      'builderPolicyRef',
    ],
    {
      draftSnapshotRef: draftSnapshotReference,
      projectionType: { $ref: `${common}projectionType` },
      purpose: namespace,
      audience: principalReference,
      sourceSlices: array(sourceSliceReference, { nonEmpty: true, unique: true }),
      builderPolicyRef: builderPolicyReference,
      expiresAt: instant,
    },
  ),
  contextBuildRequest: object(
    [
      'workOrderRef',
      'workOrderContractRef',
      'projectionType',
      'purpose',
      'audience',
      'sourceSlices',
      'answeredInformationRefs',
      'builderPolicyRef',
    ],
    {
      workOrderRef: objectReference,
      workOrderContractRef: contentAddressedReference,
      projectionType: namespace,
      purpose: namespace,
      audience: typedReference,
      sourceSlices: array(contentAddressedReference, { nonEmpty: true, unique: true }),
      answeredInformationRefs: array(typedReference),
      builderPolicyRef: versionedReference,
      expiresAt: instant,
    },
  ),
  runtimeBinding: object(
    [
      'adapterCode',
      'adapterVersion',
      'harnessId',
      'harnessVersion',
      'provider',
      'modelId',
      'modelConfigHash',
    ],
    {
      adapterCode: namespace,
      adapterVersion: text,
      harnessId: namespace,
      harnessVersion: text,
      provider: namespace,
      modelId: text,
      modelConfigHash: payloadHash,
      executionNodeRef: externalReference,
    },
  ),
  runtimeBindingSummary: object(
    [
      'adapterCode',
      'adapterVersion',
      'harnessId',
      'harnessVersion',
      'provider',
      'modelId',
      'modelConfigHash',
    ],
    {
      adapterCode: namespace,
      adapterVersion: text,
      harnessId: namespace,
      harnessVersion: text,
      provider: namespace,
      modelId: text,
      modelConfigHash: payloadHash,
    },
  ),
  runCreation: object(
    [
      'workOrderRef',
      'workOrderContractRef',
      'attemptNumber',
      'runtimeBinding',
      'contextSnapshotRef',
      'capabilityGrantRef',
      'leasePolicyRef',
    ],
    {
      workOrderRef: objectReference,
      workOrderContractRef: contentAddressedReference,
      attemptNumber: positiveInt,
      runtimeBinding: localRef('runtimeBinding'),
      contextSnapshotRef: snapshotReference,
      capabilityGrantRef: contentAddressedReference,
      leasePolicyRef: versionedReference,
      executionDeadline: instant,
    },
  ),
  runtimeInputRequired: object(
    ['runtimeEventRef', 'question', 'reason', 'expectedAnswerSpec', 'blocking', 'occurredAt'],
    {
      runtimeEventRef: externalReference,
      question: text,
      reason: text,
      expectedAnswerSpec: canonicalJson,
      blocking: { type: 'boolean' },
      requestedResponderRole: namespace,
      continuationRef: externalReference,
      occurredAt: instant,
    },
  ),
  informationRequestDefinition: object(
    [
      'relatedRefs',
      'requestType',
      'question',
      'reason',
      'expectedAnswerSpec',
      'requestedResponder',
      'blocking',
    ],
    {
      taskRef: objectReference,
      workOrderRef: objectReference,
      runRef: objectReference,
      relatedRefs: array(typedReference, { nonEmpty: true, unique: true }),
      requestType: namespace,
      question: text,
      reason: text,
      expectedAnswerSpec: canonicalJson,
      requestedResponder: canonicalJson,
      blocking: { type: 'boolean' },
      dueAt: instant,
      expiresAt: instant,
    },
  ),
  answerSubmission: object(
    ['answerId', 'responder', 'answerContent', 'sourceRefs', 'submittedAt', 'payloadHash'],
    {
      answerId: uuid,
      responder: typedReference,
      answerContent: canonicalJson,
      sourceRefs: array(typedReference, { unique: true }),
      channelSourceRef: externalReference,
      submittedAt: instant,
      payloadHash,
    },
  ),
  completionEvaluationInput: object(
    ['criteriaHash', 'factRefs', 'blockingRefs', 'sourceWatermarks', 'evaluatorRef', 'evaluatedAt'],
    {
      criteriaHash: payloadHash,
      factRefs: array(typedReference, { nonEmpty: true, unique: true }),
      blockingRefs: array(typedReference, { unique: true }),
      sourceWatermarks: array(localRef('sourceWatermark')),
      evaluatorRef: versionedReference,
      evaluatedAt: instant,
    },
  ),
  runStateView: object(
    [
      'runRef',
      'aggregateVersion',
      'workOrderRef',
      'attemptNumber',
      'status',
      'runtimeBinding',
      'contextSnapshotRef',
      'currentFencingToken',
    ],
    {
      runRef: objectReference,
      aggregateVersion: nonNegativeInt,
      workOrderRef: objectReference,
      attemptNumber: positiveInt,
      status: runStatus,
      runtimeBinding: localRef('runtimeBinding'),
      contextSnapshotRef: snapshotReference,
      leaseExpiresAt: instant,
      currentFencingToken: nonNegativeInt,
      resultRef: contentAddressedReference,
      terminationReason: reasonCode,
    },
  ),
  informationRequestView: object(
    [
      'informationRequestRef',
      'aggregateVersion',
      'definition',
      'status',
      'deliveryRefs',
      'answerRefs',
    ],
    {
      informationRequestRef: objectReference,
      aggregateVersion: nonNegativeInt,
      definition: localRef('informationRequestDefinition'),
      status: informationRequestStatus,
      deliveryRefs: array(contentAddressedReference, { unique: true }),
      answerRefs: array(contentAddressedReference, { unique: true }),
      acceptedAnswerRef: contentAddressedReference,
      resolutionRef: contentAddressedReference,
    },
  ),
  usageAndProvenanceView: object(
    ['runRef', 'agentDeclaredUsage', 'authoritativeSource', 'provenance', 'reconciliationStatus'],
    {
      runRef: objectReference,
      runtimeUsageRef: contentAddressedReference,
      agentDeclaredUsage: localRef('valueEnvelopeCanonicalJson'),
      authoritativeSource,
      provenance: canonicalJson,
      reconciliationStatus: namespace,
    },
  ),
  taskBoardItem: object(
    ['taskRef', 'aggregateVersion', 'title', 'status', 'blockerRefs', 'activeWorkOrderRefs'],
    {
      taskRef: objectReference,
      aggregateVersion: nonNegativeInt,
      title: text,
      status: taskStatus,
      assignee: canonicalJson,
      blockerRefs: array(typedReference, { unique: true }),
      activeWorkOrderRefs: array(objectReference, { unique: true }),
      completionEvaluationRef: contentAddressedReference,
    },
  ),
  taskBoardPage: object(['items', 'snapshotAt', 'sourceWatermarks'], {
    items: array(localRef('taskBoardItem')),
    nextCursor: text,
    snapshotAt: instant,
    sourceWatermarks: array(localRef('sourceWatermark')),
  }),
  sourceWatermark: object(['sourceModule', 'sequence', 'observedAt'], {
    sourceModule: namespace,
    partition: text,
    sequence: nonNegativeInt,
    observedAt: instant,
  }),
  valueEnvelopeCanonicalJson: {
    oneOf: [
      object(['presence', 'value', 'evidenceRefs'], {
        presence: { const: 'PRESENT' },
        value: canonicalJson,
        reasonCode,
        evidenceRefs: array(typedReference, { unique: true }),
        lastVerifiedAt: instant,
      }),
      object(['presence', 'reasonCode', 'evidenceRefs'], {
        presence: { const: 'REDACTED' },
        reasonCode,
        evidenceRefs: array(typedReference, { unique: true }),
        lastVerifiedAt: instant,
      }),
      object(['presence', 'evidenceRefs'], {
        presence: { enum: ['UNKNOWN', 'NOT_APPLICABLE', 'UNAVAILABLE'] },
        reasonCode,
        evidenceRefs: array(typedReference, { unique: true }),
        lastVerifiedAt: instant,
      }),
    ],
  },
  initialContextCommandResult: object(['contextSnapshotRef'], {
    // Operation-specific CommandResult data. `objectType` is pinned to the
    // canonical namespace, so a new entry cannot return the legacy
    // `zhiju.project.context_snapshot` identity that stays readable through
    // the historical Core v1.0 compatibility path only.
    contextSnapshotRef: contextSnapshotReference,
  }),
  contextBuilderPolicyBinding: object(['builderPolicyRef', 'contentHash', 'effectiveFrom'], {
    // VersionedRef intentionally remains hash-free. The resolved Policy
    // content hash and validity window are persisted beside the exact ref so
    // every consumer can re-check the same immutable observation.
    builderPolicyRef: builderPolicyReference,
    contentHash: payloadHash,
    effectiveFrom: instant,
    supersededAt: instant,
  }),
  initialContextExpiryBinding: object([], {
    // The request `expiresAt` is an upper bound for the Context only; it never
    // rewrites the WorkOrder Root expiry. It is recorded verbatim so Validator
    // and Freeze can re-derive the effective value instead of trusting a
    // silently truncated one. Both members are optional: an absent request
    // expiry combined with no finite observed bound leaves the Context without
    // a finite expiry, and that absence is not an unlimited authorization.
    requestExpiresAt: instant,
    effectiveExpiresAt: instant,
  }),
  acceptanceDisposition: { enum: ['ACCEPTED', 'REJECTED', 'QUARANTINED'] },
  deliveryOutcome: { enum: ['DELIVERED', 'FAILED', 'UNKNOWN'] },
  justification: object(['reasonCode', 'summary', 'evidenceRefs'], {
    reasonCode,
    summary: text,
    evidenceRefs: array(typedReference, { nonEmpty: true, unique: true }),
    policyRef: versionedReference,
  }),
} as const satisfies Readonly<Record<string, JsonSchema>>;

export const contextBuilderPolicyBindingSchemaRef = `${schemaId}#/$defs/contextBuilderPolicyBinding`;
export const initialContextExpiryBindingSchemaRef = `${schemaId}#/$defs/initialContextExpiryBinding`;

const operationSchemas = {
  'execution.create_task': {
    payload: object(['projectRef', 'definition'], {
      projectRef: objectReference,
      definition: localRef('taskDefinition'),
      initialAssignee: canonicalJson,
    }),
  },
  'execution.mark_task_ready': {
    payload: object(['readinessSnapshotRef', 'requestedAt'], {
      readinessSnapshotRef: snapshotReference,
      requestedAt: instant,
    }),
  },
  'execution.create_work_order': {
    payload: object(['draft'], {
      draft: localRef('workOrderDraft'),
      expiresAt: instant,
    }),
  },
  'execution.freeze_work_order': {
    payload: object(['workOrderContract', 'validationSnapshotRef', 'specificationHash'], {
      workOrderContract,
      validationSnapshotRef: snapshotReference,
      specificationHash: payloadHash,
    }),
  },
  'execution.queue_work_order': {
    payload: object(['queuePolicyRef'], {
      queuePolicyRef: versionedReference,
      notBefore: instant,
      requestedRuntimeClass: namespace,
    }),
  },
  'execution.build_context_snapshot': {
    payload: object(['request'], {
      request: localRef('contextBuildRequest'),
    }),
  },
  'execution.build_initial_context_snapshot': {
    payload: object(['request'], {
      request: localRef('initialContextBuildRequest'),
    }),
    result: localRef('initialContextCommandResult'),
  },
  'execution.create_run': {
    payload: object(['creation'], {
      creation: localRef('runCreation'),
    }),
  },
  'execution.start_run': {
    payload: object(['leaseId', 'fencingToken', 'runtimeAttemptRef', 'startedAt'], {
      leaseId: uuid,
      fencingToken: nonNegativeInt,
      runtimeAttemptRef: objectReference,
      startedAt: instant,
    }),
  },
  'execution.request_run_cancel': {
    payload: object(['reason', 'requestedAt', 'cancellationPolicyRef'], {
      reason: localRef('justification'),
      requestedAt: instant,
      cancellationPolicyRef: versionedReference,
    }),
  },
  'execution.record_runtime_input_required': {
    payload: object(['inputRequired'], {
      inputRequired: localRef('runtimeInputRequired'),
    }),
  },
  'execution.submit_agent_result': {
    payload: object(['agentResultContract', 'runFencingToken', 'runtimeSubmissionRef'], {
      agentResultContract,
      runFencingToken: nonNegativeInt,
      runtimeSubmissionRef: externalReference,
    }),
  },
  'execution.accept_agent_result': {
    payload: object(
      [
        'agentResultRef',
        'schemaValidationRef',
        'identityValidationRef',
        'runBindingValidationRef',
        'scopeValidationRef',
        'businessOutputValidationRef',
        'disposition',
        'reasons',
      ],
      {
        agentResultRef: contentAddressedReference,
        schemaValidationRef: contentAddressedReference,
        identityValidationRef: contentAddressedReference,
        runBindingValidationRef: contentAddressedReference,
        scopeValidationRef: contentAddressedReference,
        businessOutputValidationRef: contentAddressedReference,
        disposition: localRef('acceptanceDisposition'),
        reasons: array(reasonCode, { unique: true }),
      },
    ),
  },
  'execution.open_information_request': {
    payload: object(['definition'], {
      definition: localRef('informationRequestDefinition'),
    }),
  },
  'execution.record_information_delivery': {
    payload: object(['deliveryAttemptRef', 'destinationRef', 'outcome', 'occurredAt'], {
      deliveryAttemptRef: objectReference,
      destinationRef: externalReference,
      outcome: localRef('deliveryOutcome'),
      receiptRef: contentAddressedReference,
      occurredAt: instant,
      errorCode: reasonCode,
    }),
  },
  'execution.submit_information_answer': {
    payload: object(['answer'], {
      answer: localRef('answerSubmission'),
    }),
  },
  'execution.resolve_information_request': {
    payload: object(
      [
        'acceptedAnswerRef',
        'resolutionDisposition',
        'domainCommandRefs',
        'resolvedBy',
        'resolvedAt',
        'justification',
      ],
      {
        acceptedAnswerRef: contentAddressedReference,
        resolutionDisposition: namespace,
        domainCommandRefs: array(contentAddressedReference, { nonEmpty: true, unique: true }),
        resolvedBy: typedReference,
        resolvedAt: instant,
        justification: localRef('justification'),
      },
    ),
  },
  'execution.schedule_work_order_retry': {
    payload: object(['previousRunRef', 'retryReason', 'nextAttemptNumber', 'retryPolicyRef'], {
      previousRunRef: objectReference,
      retryReason: reasonCode,
      nextAttemptNumber: positiveInt,
      notBefore: instant,
      selectedRuntimeBinding: localRef('runtimeBinding'),
      retryPolicyRef: versionedReference,
    }),
  },
  'execution.evaluate_work_order_completion': {
    payload: object(['input'], {
      input: localRef('completionEvaluationInput'),
    }),
  },
  'execution.evaluate_task_completion': {
    payload: object(['input'], {
      input: localRef('completionEvaluationInput'),
    }),
  },
  'execution.get_work_order_contract': {
    payload: object(['workOrderRef'], {
      workOrderRef: objectReference,
    }),
    result: object(['workOrderRef', 'workOrderContract', 'contractRef'], {
      workOrderRef: objectReference,
      workOrderContract,
      contractRef: contentAddressedReference,
    }),
  },
  'execution.get_work_order_draft': {
    payload: object(['workOrderRef'], {
      workOrderRef: workOrderObjectReference,
    }),
    result: object(['draftSnapshotRef', 'draft', 'rootAggregateVersion', 'status'], {
      draftSnapshotRef: draftSnapshotReference,
      draft: localRef('workOrderDraft'),
      expiresAt: instant,
      rootAggregateVersion: losslessNonNegativeInt,
      status: localRef('workOrderStatus'),
    }),
  },
  'execution.get_context_snapshot': {
    payload: object(['contextSnapshotRef'], {
      contextSnapshotRef: snapshotReference,
    }),
    result: object(['contextSnapshotRef', 'projectContextContract', 'contractRef'], {
      contextSnapshotRef: snapshotReference,
      projectContextContract,
      contractRef: contentAddressedReference,
    }),
  },
  'execution.get_run_state': {
    payload: object(['runRef'], {
      runRef: objectReference,
    }),
    result: localRef('runStateView'),
  },
  'execution.get_agent_result': {
    payload: object(['agentResultRef'], {
      agentResultRef: contentAddressedReference,
    }),
    result: object(['agentResultRef', 'agentResultContract', 'acceptanceRecordRef'], {
      agentResultRef: contentAddressedReference,
      agentResultContract,
      acceptanceRecordRef: contentAddressedReference,
    }),
  },
  'execution.get_information_request': {
    payload: object(['informationRequestRef'], {
      informationRequestRef: objectReference,
    }),
    result: localRef('informationRequestView'),
  },
  'execution.get_usage_and_provenance': {
    payload: object(['runRef'], {
      runRef: objectReference,
    }),
    result: localRef('usageAndProvenanceView'),
  },
  'execution.get_task_board_slice': {
    payload: object(['projectRef', 'statuses', 'page'], {
      projectRef: objectReference,
      statuses: array(taskStatus, { nonEmpty: true, unique: true }),
      assigneeRef: typedReference,
      deliveryItemRef: versionedReference,
      page: object(['pageSize'], {
        pageSize: positiveInt,
        cursor: text,
      }),
    }),
    result: localRef('taskBoardPage'),
  },
  'execution.TaskReady': {
    payload: object(['taskRef', 'readinessSnapshotRef', 'readyAt'], {
      taskRef: objectReference,
      readinessSnapshotRef: snapshotReference,
      readyAt: instant,
    }),
  },
  'execution.WorkOrderBecameReady': {
    payload: object(['workOrderRef', 'taskRef', 'workOrderContractRef'], {
      workOrderRef: objectReference,
      taskRef: objectReference,
      workOrderContractRef: contentAddressedReference,
      expiresAt: instant,
    }),
  },
  'execution.WorkOrderQueued': {
    payload: object(['workOrderRef', 'queuePolicyRef'], {
      workOrderRef: objectReference,
      queuePolicyRef: versionedReference,
      notBefore: instant,
    }),
  },
  'execution.ContextSnapshotBuilt': {
    payload: object(['contextSnapshotRef', 'workOrderRef', 'projectionType', 'coverageStatus'], {
      contextSnapshotRef: snapshotReference,
      workOrderRef: objectReference,
      projectionType: namespace,
      coverageStatus: namespace,
    }),
  },
  'execution.RunStarted': {
    payload: object(
      ['runRef', 'workOrderRef', 'attemptNumber', 'runtimeBindingSummary', 'contextSnapshotRef'],
      {
        runRef: objectReference,
        workOrderRef: objectReference,
        attemptNumber: positiveInt,
        runtimeBindingSummary: localRef('runtimeBindingSummary'),
        contextSnapshotRef: snapshotReference,
      },
    ),
  },
  'execution.RunTerminated': {
    payload: object(['runRef', 'workOrderRef', 'terminalStatus', 'terminationReason', 'endedAt'], {
      runRef: objectReference,
      workOrderRef: objectReference,
      terminalStatus: terminalRunStatus,
      terminationReason: reasonCode,
      agentResultRef: contentAddressedReference,
      endedAt: instant,
    }),
  },
  'execution.AgentResultAccepted': {
    payload: object(
      ['agentResultRef', 'acceptanceRecordRef', 'runRef', 'workOrderRef', 'businessOutputRefs'],
      {
        agentResultRef: contentAddressedReference,
        acceptanceRecordRef: contentAddressedReference,
        runRef: objectReference,
        workOrderRef: objectReference,
        businessOutputRefs: array(typedReference, { unique: true }),
      },
    ),
  },
  'execution.InformationRequestOpened': {
    payload: object(
      ['informationRequestRef', 'blocking', 'requestedResponder', 'deliveryPurpose'],
      {
        informationRequestRef: objectReference,
        workOrderRef: objectReference,
        blocking: { type: 'boolean' },
        requestedResponder: canonicalJson,
        deliveryPurpose: namespace,
      },
    ),
  },
  'execution.InformationRequestResolved': {
    payload: object(
      ['informationRequestRef', 'acceptedAnswerRef', 'resolutionRef', 'affectedWorkRefs'],
      {
        informationRequestRef: objectReference,
        acceptedAnswerRef: contentAddressedReference,
        resolutionRef: contentAddressedReference,
        affectedWorkRefs: array(typedReference, { unique: true }),
      },
    ),
  },
  'execution.WorkOrderCompleted': {
    payload: object(['workOrderRef', 'evaluationRef', 'satisfiedOutputRefs', 'completedAt'], {
      workOrderRef: objectReference,
      evaluationRef: contentAddressedReference,
      satisfiedOutputRefs: array(typedReference, { nonEmpty: true, unique: true }),
      completedAt: instant,
    }),
  },
  'execution.TaskCompleted': {
    payload: object(['taskRef', 'evaluationRef', 'satisfiedFactRefs', 'completedAt'], {
      taskRef: objectReference,
      evaluationRef: contentAddressedReference,
      satisfiedFactRefs: array(typedReference, { nonEmpty: true, unique: true }),
      completedAt: instant,
    }),
  },
} as const satisfies Readonly<Record<string, OperationContractSchema>>;

interface VersionedOperationContractSchema extends OperationContractSchema {
  readonly type: string;
  readonly version: OperationVersion;
}

const versionedOperationSchemas: readonly VersionedOperationContractSchema[] = [
  ...Object.entries(operationSchemas).map(([type, contract]) => ({
    type,
    version: '1.0' as const,
    ...contract,
  })),
  {
    type: 'execution.create_task',
    version: '2.0',
    // §11.1 `execution.create_task@2.0` / Task CREATE. `initialAssignee` keeps
    // the historical open shape: §11.6 changes only the two definition members
    // and the approved design does not type the assignee further.
    payload: object(['projectRef', 'definition'], {
      projectRef: projectObjectReference,
      definition: localRef('taskDefinitionV2'),
      initialAssignee: canonicalJson,
    }),
  },
  {
    type: 'execution.create_work_order',
    version: '1.1',
    payload: object(['draft'], {
      draft: localRef('initialWorkOrderDraft'),
      expiresAt: instant,
    }),
  },
  {
    type: 'execution.get_work_order_draft',
    version: '1.1',
    payload: object(['workOrderRef'], {
      workOrderRef: workOrderObjectReference,
    }),
    result: object(['draftSnapshotRef', 'draft', 'rootAggregateVersion', 'status'], {
      draftSnapshotRef: draftSnapshotReference,
      draft: localRef('initialWorkOrderDraft'),
      expiresAt: instant,
      rootAggregateVersion: losslessNonNegativeInt,
      status: localRef('workOrderStatus'),
    }),
  },
  {
    type: 'execution.build_initial_context_snapshot',
    version: '1.1',
    payload: object(['request'], {
      request: localRef('initialContextBuildRequestV11'),
    }),
    result: localRef('initialContextCommandResult'),
  },
];

const operationDefinitions = Object.fromEntries(
  versionedOperationSchemas.flatMap(({ type, version, ...contract }) => [
    [operationSchemaDefinitionName(type, version, 'payload'), contract.payload],
    ...('result' in contract
      ? [[operationSchemaDefinitionName(type, version, 'result'), contract.result] as const]
      : []),
  ]),
) as Readonly<Record<string, JsonSchema>>;

export const taskExecutionOperationContracts = Object.freeze(
  Object.fromEntries(
    versionedOperationSchemas.map(({ type, version, ...contract }) => [
      version === '1.0' ? type : `${type}@${version}`,
      {
        payloadSchemaRef: `${schemaId}#/$defs/${operationSchemaDefinitionName(type, version, 'payload')}`,
        ...('result' in contract
          ? {
              resultSchemaRef: `${schemaId}#/$defs/${operationSchemaDefinitionName(type, version, 'result')}`,
            }
          : {}),
      },
    ]),
  ) as Readonly<Record<string, ExecutableExecutionOperationContract>>,
);

export const taskExecutionSchema = {
  $id: schemaId,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: {
    ...namedDefinitions,
    ...operationDefinitions,
  },
} as const satisfies JsonSchema;
