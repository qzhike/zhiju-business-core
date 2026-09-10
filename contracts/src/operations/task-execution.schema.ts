import type { JsonSchema } from '../schema-types.js';

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
const draftSnapshotReference = exactObjectType(
  contentAddressedReference,
  'zhiju.execution.work_order_draft_snapshot',
);
const sourceSliceReference = exactObjectType(
  contentAddressedReference,
  'zhiju.project.context_source_slice',
);
const builderPolicyReference = exactObjectType(versionedReference, 'zhiju.identity.policy');

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
    {
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
    },
  ),
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
      answeredInformationRefs: array(typedReference, { unique: true }),
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
  acceptanceDisposition: { enum: ['ACCEPTED', 'REJECTED', 'QUARANTINED'] },
  deliveryOutcome: { enum: ['DELIVERED', 'FAILED', 'UNKNOWN'] },
  justification: object(['reasonCode', 'summary', 'evidenceRefs'], {
    reasonCode,
    summary: text,
    evidenceRefs: array(typedReference, { nonEmpty: true, unique: true }),
    policyRef: versionedReference,
  }),
} as const satisfies Readonly<Record<string, JsonSchema>>;

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

function operationDefinitionName(type: string, suffix: 'payload' | 'result'): string {
  return `${type.replaceAll('.', '_')}_${suffix}`;
}

const operationDefinitions = Object.fromEntries(
  Object.entries(operationSchemas).flatMap(([type, contract]) => [
    [operationDefinitionName(type, 'payload'), contract.payload],
    ...('result' in contract
      ? [[operationDefinitionName(type, 'result'), contract.result] as const]
      : []),
  ]),
) as Readonly<Record<string, JsonSchema>>;

export const taskExecutionOperationContracts = Object.freeze(
  Object.fromEntries(
    Object.entries(operationSchemas).map(([type, contract]) => [
      type,
      {
        payloadSchemaRef: `${schemaId}#/$defs/${operationDefinitionName(type, 'payload')}`,
        ...('result' in contract
          ? { resultSchemaRef: `${schemaId}#/$defs/${operationDefinitionName(type, 'result')}` }
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
