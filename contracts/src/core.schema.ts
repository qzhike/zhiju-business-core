import type { JsonSchema } from './schema-types.js';

// =============================================================================
// Core Contract schemas
// =============================================================================
//
// Each `ProjectContextContract`, `WorkOrderContract`, `AgentResultContract`,
// `RevisionAcceptanceSnapshot`, `ApprovalBundleSnapshot` and
// `ReleaseReadinessSnapshot` is registered with Ajv under its own `$id`.
//
// All nested structures below originate from `.vibe/high-level-docs/03-core-contracts.md`
// (the contract authority). Shared value objects (`EvidenceRef`, `Justification`,
// `EffectivePeriod`, `ValueEnvelope`, `SourceWatermark`, `Page`, etc.) live in
// `common.schema.ts` and are referenced via the full `https://schemas.zhiju.local/common/1.0#/$defs/<name>`
// URL so that this file focuses on Core-Contract-specific shapes only.
//
// Where the authoring spec intentionally permits open JSON, the schema contains
// a sibling `description` note linking to the authoritative clause. No other
// open objects are introduced without first consulting the spec.
// =============================================================================

const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';

const headerRef = { $ref: `${common}contractHeader` } as const;
const typedReferenceRef = { $ref: `${common}typedReference` } as const;
const objectRefRef = { $ref: `${common}objectRef` } as const;
const versionedRefRef = { $ref: `${common}versionedRef` } as const;
const contentAddressedRefRef = { $ref: `${common}contentAddressedRef` } as const;
const snapshotRefRef = { $ref: `${common}snapshotRef` } as const;
const externalRefRef = { $ref: `${common}externalRef` } as const;
const evidenceRefRef = { $ref: `${common}evidenceRef` } as const;
const effectivePeriodRef = { $ref: `${common}effectivePeriod` } as const;
const sourceWatermarkRef = { $ref: `${common}sourceWatermark` } as const;
const valueEnvelopeRef = { $ref: `${common}valueEnvelope` } as const;
const reasonCodeRef = { $ref: `${common}reasonCode` } as const;
const namespaceCodeRef = { $ref: `${common}namespaceCode` } as const;
const nonEmptyStringRef = { $ref: `${common}nonEmptyString` } as const;
const safeSummaryRef = { $ref: `${common}safeSummary` } as const;
const utcInstantRef = { $ref: `${common}utcInstant` } as const;
const durationRef = { $ref: `${common}duration` } as const;
const decimalStringRef = { $ref: `${common}decimalString` } as const;
const currencyCodeRef = { $ref: `${common}currencyCode` } as const;
const positiveIntRef = { $ref: `${common}positiveInteger` } as const;
const mediaTypeRef = { $ref: `${common}mediaType` } as const;
const contentHashRef = { $ref: `${common}contentHash` } as const;
const uuidRef = { $ref: `${common}uuidV7` } as const;
const nonEmptySet = (ref: JsonSchema): JsonSchema => ({
  type: 'array',
  items: ref,
  uniqueItems: true,
});
const orderedList = (ref: JsonSchema): JsonSchema => ({ type: 'array', items: ref });

/**
 * Build a Core Contract schema with the standard `contractHeader` prepended to
 * `required` and a local `$defs` block for contract-specific nested types.
 *
 * Open JSON is only emitted through `openJson(reason)` and only for shapes
 * explicitly declared open by the spec (`Constraint`, `RunSession` etc).
 */
function strictContractSchema(
  id: string,
  required: readonly string[],
  properties: Readonly<Record<string, unknown>>,
  defs: Readonly<Record<string, JsonSchema>> = {},
  description?: string,
): JsonSchema {
  const schema: JsonSchema & { description?: string } = {
    $id: id,
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['header', ...required],
    properties: {
      header: headerRef,
      ...properties,
    },
    $defs: defs,
  };
  if (description !== undefined) schema.description = description;
  return schema;
}

/**
 * `CanonicalJson` placeholder. Open JSON is only justified where `.vibe/.../03-core-contracts.md`
 * (or higher-priority authorities) describes a payload as free-form. Every
 * occurrence carries a sibling description pointing at the exact section.
 */
function openJson(reason: string): JsonSchema {
  return { description: reason };
}

// =============================================================================
// Helper: out-of-scope partial builders, kept local to keep the data
// definitions grouped by Contract.
// =============================================================================

// --- ProjectContext nested definitions --------------------------------------

const projection = {
  type: 'object',
  additionalProperties: false,
  required: ['projectionType', 'purpose', 'audience', 'builderPolicyRef'],
  properties: {
    projectionType: { $ref: `${common}projectionType` },
    purpose: nonEmptyStringRef,
    audience: nonEmptyStringRef,
    requestedByWorkOrderRef: typedReferenceRef,
    builderPolicyRef: typedReferenceRef,
  },
} as const satisfies JsonSchema;

const sourceManifest = {
  type: 'object',
  additionalProperties: false,
  required: ['enterpriseProfileSnapshotRef', 'qmsConfigurationRef', 'policyRefs', 'schemaRefs'],
  properties: {
    enterpriseProfileSnapshotRef: snapshotRefRef,
    qmsConfigurationRef: versionedRefRef,
    customerBaselineRef: versionedRefRef,
    templateBaselineRef: versionedRefRef,
    regulatoryProfileRef: versionedRefRef,
    gapAnalysisRef: versionedRefRef,
    deliveryPlanRef: versionedRefRef,
    policyRefs: nonEmptySet(typedReferenceRef),
    schemaRefs: nonEmptySet(typedReferenceRef),
    externalAuthoritySnapshotRefs: nonEmptySet(snapshotRefRef),
  },
} as const satisfies JsonSchema;

const contextItem = {
  type: 'object',
  additionalProperties: false,
  required: [
    'contextItemId',
    'kind',
    'subjectRef',
    'epistemicState',
    'evidenceRefs',
    'provenanceRefs',
    'recordedTime',
    'permittedUses',
    'sensitivity',
  ],
  properties: {
    contextItemId: uuidRef,
    kind: { $ref: `${common}contextItemKind` },
    subjectRef: typedReferenceRef,
    epistemicState: { $ref: `${common}epistemicState` },
    // Spec §3.6 — `value: ValueEnvelope | contentFragmentRef`. We model both
    // as a tagged union (Presence open value vs. content-addressed reference).
    value: {
      oneOf: [valueEnvelopeRef, contentAddressedRefRef],
    },
    evidenceRefs: nonEmptySet(evidenceRefRef),
    provenanceRefs: nonEmptySet(typedReferenceRef),
    validTime: effectivePeriodRef,
    recordedTime: utcInstantRef,
    permittedUses: nonEmptySet(namespaceCodeRef),
    sensitivity: {
      enum: [
        'PUBLIC_AUTHORITY',
        'INTERNAL',
        'CUSTOMER_CONFIDENTIAL',
        'RESTRICTED_PERSONAL',
        'REGULATED',
      ],
    },
  },
} as const satisfies JsonSchema;

const artifactContext = {
  type: 'object',
  additionalProperties: false,
  required: [
    'artifactRef',
    'allowedSectionRefs',
    'relevantEvidenceRefs',
    'openReviewIssueRefs',
    'representationRefs',
  ],
  properties: {
    artifactRef: typedReferenceRef,
    baseRevisionRef: contentAddressedRefRef,
    branchRef: typedReferenceRef,
    allowedSectionRefs: nonEmptySet(typedReferenceRef),
    relevantEvidenceRefs: nonEmptySet(evidenceRefRef),
    openReviewIssueRefs: nonEmptySet(typedReferenceRef),
    acceptanceSnapshotRef: snapshotRefRef,
    currentEffectiveBindingRef: typedReferenceRef,
    representationRefs: nonEmptySet({ $ref: `${common}representationRef` }),
  },
} as const satisfies JsonSchema;

const workContext = {
  type: 'object',
  additionalProperties: false,
  required: [
    'deliveryItemRefs',
    'informationRequestRefs',
    'blockers',
    'relatedCompletionCriteriaRefs',
  ],
  properties: {
    deliveryItemRefs: nonEmptySet(typedReferenceRef),
    taskRef: objectRefRef,
    workOrderRef: objectRefRef,
    informationRequestRefs: nonEmptySet(objectRefRef),
    blockers: nonEmptySet(typedReferenceRef),
    relatedCompletionCriteriaRefs: nonEmptySet(typedReferenceRef),
  },
} as const satisfies JsonSchema;

const unresolvedItem = {
  type: 'object',
  additionalProperties: false,
  required: ['itemRef', 'reasonCode', 'effectOnCompletion'],
  properties: {
    itemRef: typedReferenceRef,
    reasonCode: reasonCodeRef,
    effectOnCompletion: safeSummaryRef,
  },
} as const satisfies JsonSchema;

const omission = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'reasonCode', 'effectOnTask'],
  properties: {
    category: nonEmptyStringRef,
    reasonCode: reasonCodeRef,
    sourceRef: typedReferenceRef,
    effectOnTask: safeSummaryRef,
  },
} as const satisfies JsonSchema;

const redaction = {
  type: 'object',
  additionalProperties: false,
  required: ['fieldPath', 'policyRef', 'reasonCode'],
  properties: {
    fieldPath: nonEmptyStringRef,
    policyRef: versionedRefRef,
    reasonCode: reasonCodeRef,
    substituteSummary: safeSummaryRef,
  },
} as const satisfies JsonSchema;

const coverage = {
  type: 'object',
  additionalProperties: false,
  required: ['requestedScopes', 'includedScopes', 'excludedScopes', 'completeness'],
  properties: {
    requestedScopes: nonEmptySet(nonEmptyStringRef),
    includedScopes: nonEmptySet(nonEmptyStringRef),
    excludedScopes: nonEmptySet(nonEmptyStringRef),
    completeness: { $ref: `${common}coverageCompleteness` },
  },
} as const satisfies JsonSchema;

// --- WorkOrder nested definitions -------------------------------------------

const objective = {
  type: 'object',
  additionalProperties: false,
  required: ['objectiveType', 'humanReadableStatement', 'successIntent'],
  properties: {
    objectiveType: namespaceCodeRef,
    humanReadableStatement: safeSummaryRef,
    successIntent: safeSummaryRef,
    relatedIssueRefs: nonEmptySet(typedReferenceRef),
    deliveryItemRefs: nonEmptySet(typedReferenceRef),
    outOfScopeStatement: safeSummaryRef,
  },
} as const satisfies JsonSchema;

const targetScope = {
  type: 'object',
  additionalProperties: false,
  required: [
    'targetObjectRefs',
    'baseContentRefs',
    'allowedUnitRefs',
    'forbiddenUnitRefs',
    'allowedCreateTypes',
    'crossObjectReferencesAllowed',
    'scopePolicyRef',
  ],
  properties: {
    targetObjectRefs: nonEmptySet(typedReferenceRef),
    // Spec §4.5 — `baseContentRefs` must be ContentAddressedRef. Modeling
    // `items` as the content-addressed kind prevents accidentally using
    // object/latest references against immutable base revisions.
    baseContentRefs: nonEmptySet(contentAddressedRefRef),
    allowedUnitRefs: nonEmptySet(nonEmptyStringRef),
    forbiddenUnitRefs: nonEmptySet(nonEmptyStringRef),
    allowedCreateTypes: nonEmptySet(namespaceCodeRef),
    crossObjectReferencesAllowed: nonEmptySet(nonEmptyStringRef),
    scopePolicyRef: versionedRefRef,
  },
} as const satisfies JsonSchema;

const monetaryLimit = {
  type: 'object',
  additionalProperties: false,
  required: ['amountDecimal', 'currency'],
  properties: {
    amountDecimal: decimalStringRef,
    currency: currencyCodeRef,
  },
} as const satisfies JsonSchema;

const constraint = openJson(
  'Open JSON per 03-core-contracts §4.3 (Constraint). Authoring bodies describe Constraints via Canonical JSON rather than a closed schema.',
);

const capabilityGrant = {
  type: 'object',
  additionalProperties: false,
  required: [
    'capabilityType',
    'actions',
    'resourceSelectors',
    'constraints',
    'expiresAt',
    'grantPolicyRef',
  ],
  properties: {
    capabilityType: namespaceCodeRef,
    actions: nonEmptySet(namespaceCodeRef),
    resourceSelectors: nonEmptySet(nonEmptyStringRef),
    constraints: nonEmptySet(constraint),
    expiresAt: utcInstantRef,
    maxUses: positiveIntRef,
    grantPolicyRef: versionedRefRef,
  },
} as const satisfies JsonSchema;

const inputRef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'inputRole',
    'ref',
    'required',
    'permittedUse',
    'contentAccessMode',
    'integrityRequired',
  ],
  properties: {
    inputRole: namespaceCodeRef,
    ref: typedReferenceRef,
    required: { type: 'boolean' },
    permittedUse: nonEmptyStringRef,
    epistemicExpectation: { $ref: `${common}epistemicState` },
    contentAccessMode: { $ref: `${common}inputContentAccessMode` },
    integrityRequired: { type: 'boolean' },
  },
} as const satisfies JsonSchema;

const expectedOutput = {
  type: 'object',
  additionalProperties: false,
  required: [
    'outputSlot',
    'allowedObjectTypes',
    'cardinality',
    'requiredReferenceStrength',
    'creationRequired',
    'acceptancePolicyRef',
  ],
  properties: {
    outputSlot: nonEmptyStringRef,
    allowedObjectTypes: nonEmptySet(namespaceCodeRef),
    cardinality: { $ref: `${common}outputCardinality` },
    requiredReferenceStrength: { $ref: `${common}referenceStrength` },
    creationRequired: { type: 'boolean' },
    requiredTargetRelation: nonEmptyStringRef,
    schemaRef: versionedRefRef,
    qualityStageRequired: namespaceCodeRef,
    acceptancePolicyRef: versionedRefRef,
  },
} as const satisfies JsonSchema;

const completionCriterion = {
  type: 'object',
  additionalProperties: false,
  required: [
    'criterionId',
    'criterionType',
    'evaluatorRef',
    'required',
    'inputBindings',
    'expectedCondition',
    'failureDisposition',
  ],
  properties: {
    criterionId: uuidRef,
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
    evaluatorRef: versionedRefRef,
    required: { type: 'boolean' },
    inputBindings: nonEmptySet(nonEmptyStringRef),
    expectedCondition: nonEmptyStringRef,
    failureDisposition: namespaceCodeRef,
  },
} as const satisfies JsonSchema;

const riskAndQuality = {
  type: 'object',
  additionalProperties: false,
  required: [
    'riskProfileRef',
    'dataHandlingPolicyRef',
    'humanReviewRequired',
    'escalationPolicyRef',
  ],
  properties: {
    riskProfileRef: versionedRefRef,
    qualityProfileRef: versionedRefRef,
    dataHandlingPolicyRef: versionedRefRef,
    humanReviewRequired: { type: 'boolean' },
    escalationPolicyRef: versionedRefRef,
  },
} as const satisfies JsonSchema;

const executionPolicy = {
  type: 'object',
  additionalProperties: false,
  required: [
    'maxAttempts',
    'retryableOutcomes',
    'resumePolicy',
    'fallbackPolicy',
    'leasePolicyRef',
    'cancellationPolicyRef',
  ],
  properties: {
    maxAttempts: positiveIntRef,
    retryableOutcomes: nonEmptySet({ $ref: `${common}executionOutcome` }),
    resumePolicy: nonEmptyStringRef,
    fallbackPolicy: nonEmptyStringRef,
    leasePolicyRef: versionedRefRef,
    cancellationPolicyRef: versionedRefRef,
  },
} as const satisfies JsonSchema;

const executionBudget = {
  type: 'object',
  additionalProperties: false,
  required: ['budgetPolicyRef'],
  properties: {
    tokenLimit: positiveIntRef,
    monetaryLimit: monetaryLimit,
    wallClockLimit: durationRef,
    toolCallLimit: positiveIntRef,
    budgetPolicyRef: versionedRefRef,
  },
} as const satisfies JsonSchema;

const harnessPolicy = {
  type: 'object',
  additionalProperties: false,
  required: [
    'preferredHarnesses',
    'fallbackAllowed',
    'fallbackRequiresHuman',
    'selectionPolicyRef',
  ],
  properties: {
    requiredHarness: namespaceCodeRef,
    preferredHarnesses: nonEmptySet(namespaceCodeRef),
    fallbackAllowed: { type: 'boolean' },
    fallbackRequiresHuman: { type: 'boolean' },
    selectionPolicyRef: versionedRefRef,
  },
} as const satisfies JsonSchema;

const modelPolicy = {
  type: 'object',
  additionalProperties: false,
  required: [
    'allowedProviders',
    'allowedModels',
    'prohibitedDataClasses',
    'minimumCapabilities',
    'selectionPolicyRef',
  ],
  properties: {
    allowedProviders: nonEmptySet(namespaceCodeRef),
    allowedModels: nonEmptySet(nonEmptyStringRef),
    prohibitedDataClasses: nonEmptySet({
      enum: [
        'PUBLIC_AUTHORITY',
        'INTERNAL',
        'CUSTOMER_CONFIDENTIAL',
        'RESTRICTED_PERSONAL',
        'REGULATED',
      ],
    }),
    minimumCapabilities: nonEmptySet(namespaceCodeRef),
    selectionPolicyRef: versionedRefRef,
  },
} as const satisfies JsonSchema;

const versionPins = {
  type: 'object',
  additionalProperties: false,
  required: [
    'projectContextContractRef',
    'contextBuilderPolicyRef',
    'workOrderSchemaRef',
    'skillRefs',
    'templateRefs',
    'capabilityPolicyRef',
    'runtimeAdapterContractRef',
  ],
  properties: {
    projectContextContractRef: snapshotRefRef,
    contextBuilderPolicyRef: versionedRefRef,
    workOrderSchemaRef: versionedRefRef,
    skillRefs: nonEmptySet(versionedRefRef),
    templateRefs: nonEmptySet(versionedRefRef),
    regulatoryProfileRef: versionedRefRef,
    qualityProfileRef: versionedRefRef,
    capabilityPolicyRef: versionedRefRef,
    runtimeAdapterContractRef: versionedRefRef,
  },
} as const satisfies JsonSchema;

// --- AgentResult nested definitions -----------------------------------------

const businessOutput = {
  type: 'object',
  additionalProperties: false,
  required: ['outputSlot', 'ref', 'objectType', 'relationToTarget', 'declaredPurpose'],
  properties: {
    outputSlot: nonEmptyStringRef,
    ref: typedReferenceRef,
    objectType: namespaceCodeRef,
    creationCommandRef: contentAddressedRefRef,
    createdByRunRef: objectRefRef,
    relationToTarget: nonEmptyStringRef,
    declaredPurpose: safeSummaryRef,
  },
} as const satisfies JsonSchema;

const workspaceOutput = {
  type: 'object',
  additionalProperties: false,
  required: ['outputType', 'externalRef', 'retentionClass', 'diagnosticOnly'],
  properties: {
    outputType: namespaceCodeRef,
    externalRef: externalRefRef,
    checksum: contentHashRef,
    mediaType: mediaTypeRef,
    retentionClass: nonEmptyStringRef,
    diagnosticOnly: { const: true },
  },
} as const satisfies JsonSchema;

const finding = {
  type: 'object',
  additionalProperties: false,
  required: ['findingId', 'type', 'severity', 'statement', 'targetRefs', 'evidenceRefs'],
  properties: {
    findingId: uuidRef,
    type: namespaceCodeRef,
    severity: { $ref: `${common}findingSeverity` },
    statement: safeSummaryRef,
    targetRefs: nonEmptySet(typedReferenceRef),
    evidenceRefs: nonEmptySet(evidenceRefRef),
    suggestedDisposition: { $ref: `${common}findingDisposition` },
  },
} as const satisfies JsonSchema;

const knowledgeProposal = {
  type: 'object',
  additionalProperties: false,
  required: ['proposalId', 'proposalType', 'statement', 'targetRefs', 'suggestedAction'],
  properties: {
    proposalId: uuidRef,
    proposalType: namespaceCodeRef,
    statement: safeSummaryRef,
    targetRefs: nonEmptySet(typedReferenceRef),
    suggestedAction: nonEmptyStringRef,
  },
} as const satisfies JsonSchema;

const inputRequestProposal = {
  type: 'object',
  additionalProperties: false,
  required: [
    'proposalId',
    'requestType',
    'question',
    'reason',
    'targetRefs',
    'expectedAnswerSpec',
    'blocking',
  ],
  properties: {
    proposalId: uuidRef,
    requestType: namespaceCodeRef,
    question: safeSummaryRef,
    reason: safeSummaryRef,
    targetRefs: nonEmptySet(typedReferenceRef),
    expectedAnswerSpec: openJson(
      'Free-format CanonicalJson per 03-core-contracts §5.7 expectedAnswerSpec.',
    ),
    blocking: { type: 'boolean' },
    requestedResponderRole: namespaceCodeRef,
  },
} as const satisfies JsonSchema;

const followUpProposal = {
  type: 'object',
  additionalProperties: false,
  required: ['proposalId', 'followUpType', 'summary', 'targetRefs'],
  properties: {
    proposalId: uuidRef,
    followUpType: namespaceCodeRef,
    summary: safeSummaryRef,
    targetRefs: nonEmptySet(typedReferenceRef),
    suggestedWorkOrderHint: nonEmptyStringRef,
  },
} as const satisfies JsonSchema;

const agentDeclaredUsage = {
  type: 'object',
  additionalProperties: false,
  required: ['measurementSource'],
  properties: {
    inputTokens: positiveIntRef,
    outputTokens: positiveIntRef,
    reasoningTokens: positiveIntRef,
    toolCalls: positiveIntRef,
    estimatedCost: monetaryLimit,
    measurementSource: { const: 'AGENT_DECLARED' },
  },
} as const satisfies JsonSchema;

const harnessBinding = {
  type: 'object',
  additionalProperties: false,
  required: ['harnessId', 'harnessVersion'],
  properties: {
    harnessId: namespaceCodeRef,
    harnessVersion: nonEmptyStringRef,
  },
} as const satisfies JsonSchema;

const modelBinding = {
  type: 'object',
  additionalProperties: false,
  required: ['modelId', 'modelConfigHash'],
  properties: {
    modelId: nonEmptyStringRef,
    modelConfigHash: contentHashRef,
  },
} as const satisfies JsonSchema;

const resultProvenance = {
  type: 'object',
  additionalProperties: false,
  required: [
    'contextSnapshotRef',
    'workOrderContractRef',
    'capabilityGrantRef',
    'runtimeAdapterRef',
    'harness',
    'provider',
    'model',
    'skillRefs',
    'policyRefs',
    'templateRefs',
  ],
  properties: {
    contextSnapshotRef: snapshotRefRef,
    workOrderContractRef: contentAddressedRefRef,
    capabilityGrantRef: contentAddressedRefRef,
    runtimeAdapterRef: versionedRefRef,
    harness: harnessBinding,
    provider: namespaceCodeRef,
    model: modelBinding,
    skillRefs: nonEmptySet(versionedRefRef),
    policyRefs: nonEmptySet(versionedRefRef),
    templateRefs: nonEmptySet(versionedRefRef),
    regulatoryProfileRef: versionedRefRef,
    executionNodeRef: externalRefRef,
    runtimeSessionExternalRef: externalRefRef,
  },
} as const satisfies JsonSchema;

const continuationProposal = {
  type: 'object',
  additionalProperties: false,
  required: ['proposalId', 'summary', 'suggestedContextRevision'],
  properties: {
    proposalId: uuidRef,
    summary: safeSummaryRef,
    targetWorkOrderHint: nonEmptyStringRef,
    suggestedContextRevision: { type: 'boolean' },
  },
} as const satisfies JsonSchema;

// --- Quality / Release family nested definitions ----------------------------

const reviewIssueSnapshot = {
  type: 'object',
  additionalProperties: false,
  required: [
    'openBlockingIssueRefs',
    'openNonBlockingIssueRefs',
    'closedIssueRefs',
    'dismissedIssueRefs',
  ],
  properties: {
    openBlockingIssueRefs: nonEmptySet(typedReferenceRef),
    openNonBlockingIssueRefs: nonEmptySet(typedReferenceRef),
    closedIssueRefs: nonEmptySet(typedReferenceRef),
    dismissedIssueRefs: nonEmptySet(typedReferenceRef),
  },
} as const satisfies JsonSchema;

const gateSpecRef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'objectType',
    'gateSpecId',
    'gateVersion',
    'qualityProfileVersionId',
    'evaluationStage',
  ],
  properties: {
    objectType: namespaceCodeRef,
    gateSpecId: uuidRef,
    gateVersion: nonEmptyStringRef,
    qualityProfileVersionId: uuidRef,
    evaluationStage: { $ref: `${common}evaluationStage` },
  },
} as const satisfies JsonSchema;

const gateResultRef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'objectType',
    'gateSpecId',
    'gateResultId',
    'qualityProfileVersionId',
    'evaluationStage',
    'revisionContentHash',
  ],
  properties: {
    objectType: namespaceCodeRef,
    gateSpecId: uuidRef,
    gateResultId: uuidRef,
    qualityProfileVersionId: uuidRef,
    evaluationStage: { $ref: `${common}evaluationStage` },
    revisionContentHash: contentHashRef,
  },
} as const satisfies JsonSchema;

const evaluatorVersion = {
  type: 'object',
  additionalProperties: false,
  required: ['evaluatorId', 'evaluatorVersion'],
  properties: {
    evaluatorId: namespaceCodeRef,
    evaluatorVersion: nonEmptyStringRef,
  },
} as const satisfies JsonSchema;

const readinessSummary = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reasons'],
  properties: {
    status: { $ref: `${common}readinessStatus` },
    reasons: nonEmptySet(nonEmptyStringRef),
  },
} as const satisfies JsonSchema;

const approvalRequirement = {
  type: 'object',
  additionalProperties: false,
  required: [
    'requirementId',
    'requiredRole',
    'requiredCount',
    'ordering',
    'authorizationAssurance',
    'separationRules',
  ],
  properties: {
    requirementId: uuidRef,
    requiredRole: namespaceCodeRef,
    requiredCount: positiveIntRef,
    ordering: namespaceCodeRef,
    authorizationAssurance: namespaceCodeRef,
    separationRules: nonEmptyStringRef,
    effectivePeriod: effectivePeriodRef,
  },
} as const satisfies JsonSchema;

const separationOfDutiesResult = {
  type: 'object',
  additionalProperties: false,
  required: ['outcome', 'checkedAt'],
  properties: {
    outcome: { $ref: `${common}separationOfDutiesOutcome` },
    violatedRules: nonEmptySet(nonEmptyStringRef),
    checkedAt: utcInstantRef,
  },
} as const satisfies JsonSchema;

const approvalCompleteness = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reasons'],
  properties: {
    status: { $ref: `${common}approvalCompletenessStatus` },
    reasons: nonEmptySet(nonEmptyStringRef),
  },
} as const satisfies JsonSchema;

const releaseRequirement = {
  type: 'object',
  additionalProperties: false,
  required: ['requirementId', 'requirementType', 'profileRef', 'satisfied'],
  properties: {
    requirementId: uuidRef,
    requirementType: namespaceCodeRef,
    profileRef: versionedRefRef,
    satisfied: { type: 'boolean' },
  },
} as const satisfies JsonSchema;

const releaseReadinessSummary = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'reasons'],
  properties: {
    status: { $ref: `${common}releaseReadinessStatus` },
    reasons: nonEmptySet(nonEmptyStringRef),
  },
} as const satisfies JsonSchema;

// =============================================================================
// Six Core Contract schemas
// =============================================================================

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
    contextSnapshotId: uuidRef,
    projectRef: objectRefRef,
    enterpriseRef: objectRefRef,
    projection,
    asOf: utcInstantRef,
    sourceManifest,
    contextItems: orderedList(contextItem),
    artifactContext: orderedList(artifactContext),
    workContext,
    unresolvedItems: orderedList(unresolvedItem),
    omissions: orderedList(omission),
    redactions: orderedList(redaction),
    coverage,
    sourceWatermarks: nonEmptySet(sourceWatermarkRef),
    expiresAt: utcInstantRef,
  },
  {
    projection,
    sourceManifest,
    contextItem,
    artifactContext,
    workContext,
    unresolvedItem,
    omission,
    redaction,
    coverage,
  },
  'ProjectContextContract per 03-core-contracts §3.',
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
    workOrderRef: objectRefRef,
    taskRef: objectRefRef,
    projectRef: objectRefRef,
    requestedBy: { $ref: `${common}principalRef` },
    objective,
    targetScope,
    inputRefs: nonEmptySet(inputRef),
    contextSnapshotRef: snapshotRefRef,
    constraints: nonEmptySet(constraint),
    allowedCapabilities: nonEmptySet(capabilityGrant),
    deniedCapabilities: nonEmptySet(capabilityGrant),
    expectedOutputs: nonEmptySet(expectedOutput),
    completionCriteria: nonEmptySet(completionCriterion),
    riskAndQuality,
    executionPolicy,
    budget: executionBudget,
    harnessPolicy,
    modelPolicy,
    versionPins,
    issuedAt: utcInstantRef,
    expiresAt: utcInstantRef,
    specificationHash: contentHashRef,
  },
  {
    objective,
    targetScope,
    monetaryLimit,
    constraint,
    capabilityGrant,
    inputRef,
    expectedOutput,
    completionCriterion,
    riskAndQuality,
    executionPolicy,
    executionBudget,
    harnessPolicy,
    modelPolicy,
    versionPins,
  },
  'WorkOrderContract per 03-core-contracts §4.',
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
    agentResultId: uuidRef,
    runRef: objectRefRef,
    workOrderRef: objectRefRef,
    taskRef: objectRefRef,
    projectRef: objectRefRef,
    submissionKind: { const: 'FINAL' },
    executionOutcome: { $ref: `${common}executionOutcome` },
    businessOutputs: orderedList(businessOutput),
    workspaceOutputs: orderedList(workspaceOutput),
    findings: orderedList(finding),
    knowledgeProposals: orderedList(knowledgeProposal),
    inputRequestProposals: orderedList(inputRequestProposal),
    followUpProposals: orderedList(followUpProposal),
    agentDeclaredUsage,
    runtimeUsageRef: contentAddressedRefRef,
    provenance: resultProvenance,
    continuationProposal,
    humanSummary: safeSummaryRef,
    submittedAt: utcInstantRef,
    submittedByRuntime: objectRefRef,
  },
  {
    monetaryLimit,
    businessOutput,
    workspaceOutput,
    finding,
    knowledgeProposal,
    inputRequestProposal,
    followUpProposal,
    agentDeclaredUsage,
    harnessBinding,
    modelBinding,
    resultProvenance,
    continuationProposal,
  },
  'AgentResultContract per 03-core-contracts §5.',
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
    snapshotId: uuidRef,
    artifactRef: objectRefRef,
    revisionRef: contentAddressedRefRef,
    qualityProfileRef: versionedRefRef,
    riskProfileRef: versionedRefRef,
    evaluationStage: { const: 'REVISION_ACCEPTANCE' },
    requiredGateSpecs: nonEmptySet(gateSpecRef),
    gateResultRefs: nonEmptySet(gateResultRef),
    evidenceStatusSnapshotRef: snapshotRefRef,
    reviewIssueSnapshot,
    evaluatorVersions: nonEmptySet(evaluatorVersion),
    readiness: readinessSummary,
    evaluatedAt: utcInstantRef,
  },
  {
    reviewIssueSnapshot,
    gateSpecRef,
    gateResultRef,
    evaluatorVersion,
    readinessSummary,
  },
  'RevisionAcceptanceSnapshot per 03-core-contracts §6.3.',
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
    snapshotId: uuidRef,
    artifactRef: objectRefRef,
    revisionRef: contentAddressedRefRef,
    revisionAcceptanceSnapshotRef: snapshotRefRef,
    qualityProfileRef: versionedRefRef,
    approvalRequirements: nonEmptySet(approvalRequirement),
    approvalRefs: nonEmptySet(contentAddressedRefRef),
    separationOfDutiesResult,
    authorizationSnapshotRefs: nonEmptySet(snapshotRefRef),
    completeness: approvalCompleteness,
    evaluatedAt: utcInstantRef,
  },
  {
    approvalRequirement,
    separationOfDutiesResult,
    approvalCompleteness,
  },
  'ApprovalBundleSnapshot per 03-core-contracts §6.4.',
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
    snapshotId: uuidRef,
    releaseRef: objectRefRef,
    artifactRef: objectRefRef,
    revisionRef: contentAddressedRefRef,
    approvalBundleSnapshotRef: snapshotRefRef,
    // Spec §6.5 — `releasePackageRef` is the strong typed ReleasePackageRef.
    releasePackageRef: { $ref: `${common}releasePackageRef` },
    purpose: safeSummaryRef,
    recipientScopeSnapshotRef: snapshotRefRef,
    destinationRefs: nonEmptySet(typedReferenceRef),
    releaseRequirements: nonEmptySet(releaseRequirement),
    requiredReleaseGateSpecs: nonEmptySet(gateSpecRef),
    releaseGateResultRefs: nonEmptySet(gateResultRef),
    readiness: releaseReadinessSummary,
    evaluatedAt: utcInstantRef,
  },
  {
    releaseRequirement,
    releaseReadinessSummary,
  },
  'ReleaseReadinessSnapshot per 03-core-contracts §6.5.',
);

export const coreContractSchemas = [
  projectContextSchema,
  workOrderSchema,
  agentResultSchema,
  revisionAcceptanceSchema,
  approvalBundleSchema,
  releaseReadinessSchema,
] as const;
