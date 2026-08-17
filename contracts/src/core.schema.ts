import type { JsonSchema } from './schema-types.js';

const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';
const workOrderTypesId = 'https://schemas.zhiju.local/core/work-order-types/1.0';

function strictContractSchema(
  id: string,
  required: readonly string[],
  properties: Readonly<Record<string, unknown>>,
): JsonSchema {
  return {
    $id: id,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['header', ...required],
    properties: {
      header: { $ref: `${common}contractHeader` },
      ...properties,
    },
  };
}

const ref = { $ref: `${common}typedReference` } as const;
const objectRef = { $ref: `${common}objectRef` } as const;
const versionedRef = { $ref: `${common}versionedRef` } as const;
const contentAddressedRef = { $ref: `${common}contentAddressedRef` } as const;
const instant = { $ref: `${common}utcInstant` } as const;
const uuid = { $ref: `${common}uuidV7` } as const;
const namespace = { $ref: `${common}namespaceCode` } as const;
const text = { $ref: `${common}nonEmptyString` } as const;
const nonNegativeInt = { $ref: `${common}nonNegativeInteger` } as const;
const objects = { type: 'array', items: { type: 'object' } } as const;
const refs = { type: 'array', items: ref } as const;
const canonicalJson = {} as const;

function strictObject(required: readonly string[], properties: Readonly<Record<string, unknown>>) {
  return { type: 'object', additionalProperties: false, required, properties } as const;
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

function workOrderTypeRef(name: string) {
  return { $ref: `${workOrderTypesId}#/$defs/${name}` } as const;
}

export const workOrderTypesSchema = {
  $id: workOrderTypesId,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: {
    objective: strictObject(
      [
        'objectiveType',
        'humanReadableStatement',
        'successIntent',
        'relatedIssueRefs',
        'deliveryItemRefs',
      ],
      {
        objectiveType: namespace,
        humanReadableStatement: text,
        successIntent: text,
        relatedIssueRefs: array(ref, { unique: true }),
        deliveryItemRefs: array(versionedRef, { unique: true }),
        outOfScopeStatement: text,
      },
    ),
    targetScope: strictObject(
      [
        'targetObjectRefs',
        'baseContentRefs',
        'allowedUnitRefs',
        'forbiddenUnitRefs',
        'allowedCreateTypes',
        'crossObjectReferencesAllowed',
        'scopePolicyRef',
      ],
      {
        targetObjectRefs: array(ref, { unique: true }),
        baseContentRefs: array(contentAddressedRef, { unique: true }),
        allowedUnitRefs: array(ref, { unique: true }),
        forbiddenUnitRefs: array(ref, { unique: true }),
        allowedCreateTypes: array(namespace, { unique: true }),
        crossObjectReferencesAllowed: array(canonicalJson, { unique: true }),
        scopePolicyRef: versionedRef,
      },
    ),
    inputRef: strictObject(
      ['inputRole', 'ref', 'required', 'permittedUse', 'contentAccessMode', 'integrityRequired'],
      {
        inputRole: namespace,
        ref,
        required: { type: 'boolean' },
        permittedUse: namespace,
        epistemicExpectation: canonicalJson,
        contentAccessMode: { enum: ['REFERENCE_ONLY', 'INLINE_FRAGMENT', 'AUTHORIZED_FETCH'] },
        integrityRequired: { type: 'boolean' },
      },
    ),
    capabilityGrant: strictObject(
      [
        'capabilityType',
        'actions',
        'resourceSelectors',
        'constraints',
        'expiresAt',
        'grantPolicyRef',
      ],
      {
        capabilityType: namespace,
        actions: array(namespace, { unique: true }),
        resourceSelectors: array(canonicalJson, { unique: true }),
        constraints: array(canonicalJson),
        expiresAt: instant,
        maxUses: { type: 'integer', minimum: 1 },
        grantPolicyRef: versionedRef,
      },
    ),
    expectedOutput: strictObject(
      [
        'outputSlot',
        'allowedObjectTypes',
        'cardinality',
        'requiredReferenceStrength',
        'creationRequired',
        'acceptancePolicyRef',
      ],
      {
        outputSlot: namespace,
        allowedObjectTypes: array(namespace, { nonEmpty: true, unique: true }),
        cardinality: text,
        requiredReferenceStrength: {
          enum: [
            'OBJECT',
            'VERSIONED',
            'CONTENT_ADDRESSED',
            'SNAPSHOT',
            'EVIDENCE',
            'REPRESENTATION',
            'RELEASE_PACKAGE',
          ],
        },
        creationRequired: { type: 'boolean' },
        requiredTargetRelation: namespace,
        schemaRef: ref,
        qualityStageRequired: text,
        acceptancePolicyRef: versionedRef,
      },
    ),
    completionCriterion: strictObject(
      [
        'criterionId',
        'criterionType',
        'evaluatorRef',
        'required',
        'inputBindings',
        'expectedCondition',
        'failureDisposition',
      ],
      {
        criterionId: uuid,
        criterionType: {
          enum: [
            'EXPECTED_OUTPUT_PRESENT',
            'OUTPUT_REF_VALID',
            'OUTPUT_CREATED_BY_WORK_ORDER',
            'NO_BLOCKING_INFORMATION_REQUEST',
            'OUTPUT_SCHEMA_VALID',
            'OUTPUT_WITHIN_TARGET_SCOPE',
            'REQUIRED_PROPOSAL_PROCESSED',
          ],
        },
        evaluatorRef: versionedRef,
        required: { type: 'boolean' },
        inputBindings: array(canonicalJson),
        expectedCondition: canonicalJson,
        failureDisposition: text,
      },
    ),
    riskAndQuality: strictObject(
      ['riskProfileRef', 'dataHandlingPolicyRef', 'humanReviewRequired', 'escalationPolicyRef'],
      {
        riskProfileRef: versionedRef,
        qualityProfileRef: versionedRef,
        dataHandlingPolicyRef: versionedRef,
        humanReviewRequired: { type: 'boolean' },
        escalationPolicyRef: versionedRef,
      },
    ),
    executionPolicy: strictObject(
      [
        'maxAttempts',
        'retryableOutcomes',
        'resumePolicy',
        'fallbackPolicy',
        'leasePolicyRef',
        'cancellationPolicyRef',
      ],
      {
        maxAttempts: { type: 'integer', minimum: 1 },
        retryableOutcomes: array(
          {
            enum: [
              'COMPLETED',
              'PARTIAL',
              'BLOCKED_INPUT',
              'BLOCKED_POLICY',
              'FAILED_EXECUTION',
              'CANCELLED_BY_RUNTIME',
            ],
          },
          { unique: true },
        ),
        resumePolicy: canonicalJson,
        fallbackPolicy: canonicalJson,
        leasePolicyRef: versionedRef,
        cancellationPolicyRef: versionedRef,
      },
    ),
    executionBudget: strictObject(['budgetPolicyRef'], {
      tokenLimit: nonNegativeInt,
      monetaryLimit: strictObject(['amountDecimal', 'currency'], {
        amountDecimal: { type: 'string', pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$' },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
      }),
      wallClockLimit: text,
      toolCallLimit: nonNegativeInt,
      budgetPolicyRef: versionedRef,
    }),
    harnessPolicy: strictObject(
      ['preferredHarnesses', 'fallbackAllowed', 'fallbackRequiresHuman', 'selectionPolicyRef'],
      {
        requiredHarness: namespace,
        preferredHarnesses: array(namespace, { unique: true }),
        fallbackAllowed: { type: 'boolean' },
        fallbackRequiresHuman: { type: 'boolean' },
        selectionPolicyRef: versionedRef,
      },
    ),
    modelPolicy: strictObject(
      [
        'allowedProviders',
        'allowedModels',
        'prohibitedDataClasses',
        'minimumCapabilities',
        'selectionPolicyRef',
      ],
      {
        allowedProviders: array(namespace, { nonEmpty: true, unique: true }),
        allowedModels: array(text, { nonEmpty: true, unique: true }),
        prohibitedDataClasses: array(
          {
            enum: [
              'PUBLIC_AUTHORITY',
              'INTERNAL',
              'CUSTOMER_CONFIDENTIAL',
              'RESTRICTED_PERSONAL',
              'REGULATED',
            ],
          },
          { unique: true },
        ),
        minimumCapabilities: array(namespace, { unique: true }),
        selectionPolicyRef: versionedRef,
      },
    ),
    versionPins: strictObject(
      [
        'projectContextContractRef',
        'contextBuilderPolicyRef',
        'workOrderSchemaRef',
        'skillRefs',
        'templateRefs',
        'capabilityPolicyRef',
        'runtimeAdapterContractRef',
      ],
      {
        projectContextContractRef: versionedRef,
        contextBuilderPolicyRef: versionedRef,
        workOrderSchemaRef: versionedRef,
        skillRefs: array(versionedRef, { unique: true }),
        templateRefs: array(versionedRef, { unique: true }),
        regulatoryProfileRef: versionedRef,
        qualityProfileRef: versionedRef,
        capabilityPolicyRef: versionedRef,
        runtimeAdapterContractRef: versionedRef,
      },
    ),
  },
} as const satisfies JsonSchema;

export const projectContextSchema = strictContractSchema(
  'https://schemas.zhiju.local/core/project-context/1.0',
  [
    'contextSnapshotId',
    'projectRef',
    'enterpriseRef',
    'projection',
    'asOf',
    'sourceManifest',
    'contextItems',
    'artifactContext',
    'workContext',
    'unresolvedItems',
    'omissions',
    'redactions',
    'coverage',
    'sourceWatermarks',
  ],
  {
    contextSnapshotId: uuid,
    projectRef: ref,
    enterpriseRef: ref,
    projection: {
      type: 'object',
      additionalProperties: false,
      required: ['projectionType', 'purpose', 'audience', 'builderPolicyRef'],
      properties: {
        projectionType: {
          enum: [
            'COORDINATOR',
            'DOCUMENT_WRITER',
            'REVIEWER',
            'RECORD_FORM_BUILDER',
            'FEISHU_SUMMARY',
            'HUMAN_WORKSPACE',
          ],
        },
        purpose: { type: 'string', minLength: 1 },
        audience: { type: 'string', minLength: 1 },
        requestedByWorkOrderRef: ref,
        builderPolicyRef: ref,
      },
    },
    asOf: instant,
    sourceManifest: { type: 'object' },
    contextItems: objects,
    artifactContext: objects,
    workContext: { type: 'object' },
    unresolvedItems: objects,
    omissions: objects,
    redactions: objects,
    coverage: {
      type: 'object',
      required: ['completeness'],
      properties: { completeness: { enum: ['COMPLETE_FOR_PURPOSE', 'PARTIAL', 'BLOCKED'] } },
    },
    sourceWatermarks: objects,
    expiresAt: instant,
  },
);

export const workOrderSchema = strictContractSchema(
  'https://schemas.zhiju.local/core/work-order/1.0',
  [
    'workOrderRef',
    'taskRef',
    'projectRef',
    'requestedBy',
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
    'issuedAt',
    'specificationHash',
  ],
  {
    workOrderRef: ref,
    taskRef: ref,
    projectRef: ref,
    requestedBy: objectRef,
    objective: workOrderTypeRef('objective'),
    targetScope: workOrderTypeRef('targetScope'),
    inputRefs: array(workOrderTypeRef('inputRef')),
    contextSnapshotRef: ref,
    constraints: array(canonicalJson),
    allowedCapabilities: array(workOrderTypeRef('capabilityGrant')),
    deniedCapabilities: array(workOrderTypeRef('capabilityGrant')),
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
    issuedAt: instant,
    expiresAt: instant,
    specificationHash: { $ref: `${common}contentHash` },
  },
);

export const agentResultSchema = strictContractSchema(
  'https://schemas.zhiju.local/core/agent-result/1.0',
  [
    'agentResultId',
    'runRef',
    'workOrderRef',
    'taskRef',
    'projectRef',
    'submissionKind',
    'executionOutcome',
    'businessOutputs',
    'workspaceOutputs',
    'findings',
    'knowledgeProposals',
    'inputRequestProposals',
    'followUpProposals',
    'provenance',
    'humanSummary',
    'submittedAt',
    'submittedByRuntime',
  ],
  {
    agentResultId: uuid,
    runRef: ref,
    workOrderRef: ref,
    taskRef: ref,
    projectRef: ref,
    submissionKind: { const: 'FINAL' },
    executionOutcome: {
      enum: [
        'COMPLETED',
        'PARTIAL',
        'BLOCKED_INPUT',
        'BLOCKED_POLICY',
        'FAILED_EXECUTION',
        'CANCELLED_BY_RUNTIME',
      ],
    },
    businessOutputs: objects,
    workspaceOutputs: objects,
    findings: objects,
    knowledgeProposals: objects,
    inputRequestProposals: objects,
    followUpProposals: objects,
    agentDeclaredUsage: { type: 'object' },
    runtimeUsageRef: ref,
    provenance: { type: 'object' },
    continuationProposal: { type: 'object' },
    humanSummary: { type: 'string', minLength: 1 },
    submittedAt: instant,
    submittedByRuntime: ref,
  },
);

export const revisionAcceptanceSchema = strictContractSchema(
  'https://schemas.zhiju.local/core/revision-acceptance/1.0',
  [
    'snapshotId',
    'artifactRef',
    'revisionRef',
    'qualityProfileRef',
    'riskProfileRef',
    'evaluationStage',
    'requiredGateSpecs',
    'gateResultRefs',
    'evidenceStatusSnapshotRef',
    'reviewIssueSnapshot',
    'evaluatorVersions',
    'readiness',
    'evaluatedAt',
  ],
  {
    snapshotId: uuid,
    artifactRef: ref,
    revisionRef: ref,
    qualityProfileRef: ref,
    riskProfileRef: ref,
    evaluationStage: { const: 'REVISION_ACCEPTANCE' },
    requiredGateSpecs: refs,
    gateResultRefs: refs,
    evidenceStatusSnapshotRef: ref,
    reviewIssueSnapshot: { type: 'object' },
    evaluatorVersions: objects,
    readiness: {
      type: 'object',
      required: ['status', 'reasons'],
      properties: {
        status: { enum: ['READY', 'NOT_READY', 'STALE'] },
        reasons: { type: 'array', items: { type: 'string' } },
      },
    },
    evaluatedAt: instant,
  },
);

export const approvalBundleSchema = strictContractSchema(
  'https://schemas.zhiju.local/core/approval-bundle/1.0',
  [
    'snapshotId',
    'artifactRef',
    'revisionRef',
    'revisionAcceptanceSnapshotRef',
    'qualityProfileRef',
    'approvalRequirements',
    'approvalRefs',
    'separationOfDutiesResult',
    'authorizationSnapshotRefs',
    'completeness',
    'evaluatedAt',
  ],
  {
    snapshotId: uuid,
    artifactRef: ref,
    revisionRef: ref,
    revisionAcceptanceSnapshotRef: ref,
    qualityProfileRef: ref,
    approvalRequirements: objects,
    approvalRefs: refs,
    separationOfDutiesResult: { type: 'object' },
    authorizationSnapshotRefs: refs,
    completeness: {
      type: 'object',
      required: ['status', 'reasons'],
      properties: {
        status: { enum: ['FULLY_APPROVED', 'PARTIALLY_APPROVED', 'NOT_APPROVED', 'STALE'] },
        reasons: { type: 'array', items: { type: 'string' } },
      },
    },
    evaluatedAt: instant,
  },
);

export const releaseReadinessSchema = strictContractSchema(
  'https://schemas.zhiju.local/core/release-readiness/1.0',
  [
    'snapshotId',
    'releaseRef',
    'artifactRef',
    'revisionRef',
    'approvalBundleSnapshotRef',
    'releasePackageRef',
    'purpose',
    'recipientScopeSnapshotRef',
    'destinationRefs',
    'releaseRequirements',
    'requiredReleaseGateSpecs',
    'releaseGateResultRefs',
    'readiness',
    'evaluatedAt',
  ],
  {
    snapshotId: uuid,
    releaseRef: ref,
    artifactRef: ref,
    revisionRef: ref,
    approvalBundleSnapshotRef: ref,
    releasePackageRef: ref,
    purpose: { type: 'string', minLength: 1 },
    recipientScopeSnapshotRef: ref,
    destinationRefs: refs,
    releaseRequirements: objects,
    requiredReleaseGateSpecs: refs,
    releaseGateResultRefs: refs,
    readiness: {
      type: 'object',
      required: ['status', 'reasons'],
      properties: {
        status: { enum: ['READY_FOR_AUTHORIZATION', 'NOT_READY', 'STALE'] },
        reasons: { type: 'array', items: { type: 'string' } },
      },
    },
    evaluatedAt: instant,
  },
);

export const coreContractSchemas = [
  workOrderTypesSchema,
  projectContextSchema,
  workOrderSchema,
  agentResultSchema,
  revisionAcceptanceSchema,
  approvalBundleSchema,
  releaseReadinessSchema,
] as const;
