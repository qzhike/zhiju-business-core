import type { JsonSchema } from '../schema-types.js';

const schemaId = 'https://schemas.zhiju.local/modules/enterprise-project/1.0';
const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';

type SchemaProperties = Readonly<Record<string, unknown>>;

interface OperationContractSchema {
  readonly payload: JsonSchema;
  readonly result?: JsonSchema;
}

export interface ExecutableProjectOperationContract {
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

const uuid = { $ref: `${common}uuidV7` } as const;
const namespace = { $ref: `${common}namespaceCode` } as const;
const reasonCode = { $ref: `${common}reasonCode` } as const;
const text = { $ref: `${common}nonEmptyString` } as const;
const instant = { $ref: `${common}utcInstant` } as const;
const contentHash = { $ref: `${common}contentHash` } as const;
const scope = { $ref: `${common}scopeRef` } as const;
const objectReference = { $ref: `${common}objectRef` } as const;
const versionedReference = { $ref: `${common}versionedRef` } as const;
const typedReference = { $ref: `${common}typedReference` } as const;
const contentAddressedReference = { $ref: `${common}contentAddressedRef` } as const;
const snapshotReference = { $ref: `${common}snapshotRef` } as const;
const externalReference = { $ref: `${common}externalRef` } as const;
const canonicalJson = {} as const;

const namedDefinitions = {
  enterpriseStatus: { enum: ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] },
  factStatus: { enum: ['PROPOSED', 'CONFIRMED', 'DISPUTED', 'SUPERSEDED'] },
  materialCompleteness: { enum: ['COMPLETE', 'PARTIAL', 'UNKNOWN', 'UNREADABLE'] },
  materialStatus: {
    enum: ['PRESENT', 'PARTIAL', 'MISSING_CONFIRMED', 'NOT_PROVIDED', 'UNKNOWN', 'NOT_APPLICABLE'],
  },
  gapStatus: {
    enum: ['MATCH', 'MINOR_GAP', 'MAJOR_GAP', 'MISSING', 'EXTRA', 'UNKNOWN', 'NOT_APPLICABLE'],
  },
  recommendedAction: {
    enum: ['KEEP', 'REVISE', 'REPLACE', 'CREATE', 'REMOVE', 'NEED_INFORMATION', 'HUMAN_REVIEW'],
  },
  deliveryCommitmentStatus: { enum: ['PROPOSED', 'APPROVED', 'CANCELLED', 'REPLACED'] },
  deliveryExecutionStatus: {
    enum: [
      'NOT_READY',
      'READY',
      'IN_PROGRESS',
      'BLOCKED',
      'IN_REVIEW',
      'APPROVED_OUTPUT',
      'RELEASED',
      'COMPLETED',
    ],
  },
  effectivePeriod: object([], { validFrom: instant, validTo: instant }),
  evidenceRef: object(['evidence', 'relation'], {
    evidence: contentAddressedReference,
    evidenceLinkRef: objectReference,
    relation: { enum: ['SUPPORTS', 'CONTRADICTS', 'CONTEXT_ONLY'] },
    targetClaimRef: typedReference,
    applicabilityScopeRef: scope,
  }),
  justification: object(['reasonCode', 'summary', 'evidenceRefs'], {
    reasonCode,
    summary: text,
    evidenceRefs: array(localRef('evidenceRef')),
    policyRef: versionedReference,
  }),
  valueEnvelopeCanonicalJson: {
    oneOf: [
      object(['presence', 'value', 'evidenceRefs'], {
        presence: { const: 'PRESENT' },
        value: canonicalJson,
        reasonCode,
        evidenceRefs: array(localRef('evidenceRef')),
        lastVerifiedAt: instant,
      }),
      object(['presence', 'evidenceRefs'], {
        presence: { enum: ['UNKNOWN', 'REDACTED', 'NOT_APPLICABLE', 'UNAVAILABLE'] },
        reasonCode,
        evidenceRefs: array(localRef('evidenceRef')),
        lastVerifiedAt: instant,
      }),
    ],
  },
  sourceWatermark: object(['sourceModule', 'sequence', 'observedAt'], {
    sourceModule: namespace,
    partition: text,
    sequence: { type: 'integer', minimum: 0 },
    observedAt: instant,
  }),
  pageRequest: object(['pageSize'], {
    pageSize: { type: 'integer', minimum: 1 },
    cursor: text,
  }),
  factProposal: object(['factType', 'value', 'sourceRefs', 'riskLevel', 'proposalReason'], {
    factType: namespace,
    value: localRef('valueEnvelopeCanonicalJson'),
    sourceRefs: array(typedReference, { nonEmpty: true, unique: true }),
    validPeriod: localRef('effectivePeriod'),
    riskLevel: namespace,
    proposalReason: localRef('justification'),
  }),
  projectStartSnapshot: object(
    ['enterpriseProfileSnapshotRef', 'qmsConfigurationRef', 'productScopeSnapshotRef'],
    {
      enterpriseProfileSnapshotRef: snapshotReference,
      qmsConfigurationRef: versionedReference,
      productScopeSnapshotRef: snapshotReference,
      initialCustomerBaselineRef: versionedReference,
      templateBaselineRef: versionedReference,
      regulatoryProfileRef: versionedReference,
    },
  ),
  sourceMaterialDescriptor: object(
    [
      'originRef',
      'submittedBy',
      'receivedAt',
      'originalName',
      'mediaType',
      'byteLength',
      'checksum',
      'stagedObjectRef',
      'retentionClass',
    ],
    {
      originRef: externalReference,
      submittedBy: objectReference,
      receivedAt: instant,
      originalName: text,
      mediaType: { type: 'string', pattern: '^[^/\\s]+/[^/\\s]+$' },
      byteLength: { type: 'integer', minimum: 0 },
      checksum: contentHash,
      stagedObjectRef: text,
      retentionClass: namespace,
    },
  ),
  materialSourceSelection: object(['sourceMaterialRef', 'role'], {
    sourceMaterialRef: contentAddressedReference,
    locator: text,
    role: namespace,
    extractionSnapshotRef: snapshotReference,
  }),
  customerMaterialProposal: object(
    [
      'materialType',
      'title',
      'completeness',
      'sourceSelections',
      'language',
      'classificationRationale',
    ],
    {
      materialType: namespace,
      title: text,
      customerDocumentNumber: text,
      customerVersionLabel: text,
      effectiveDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      completeness: localRef('materialCompleteness'),
      sourceSelections: array(localRef('materialSourceSelection'), {
        nonEmpty: true,
        unique: true,
      }),
      language: { type: 'string', pattern: '^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$' },
      classificationRationale: localRef('justification'),
    },
  ),
  baselineExpectation: object(
    [
      'expectationId',
      'expectedMaterialKey',
      'materialType',
      'expectedTitleOrRole',
      'status',
      'customerMaterialRefs',
      'reason',
    ],
    {
      expectationId: uuid,
      expectedMaterialKey: text,
      materialType: namespace,
      expectedTitleOrRole: text,
      status: localRef('materialStatus'),
      customerMaterialRefs: array(versionedReference),
      reason: localRef('justification'),
      decisionRef: contentAddressedReference,
    },
  ),
  templateSelection: object(
    ['deliveryCategory', 'templateRef', 'applicabilityScope', 'selectionReason'],
    {
      deliveryCategory: namespace,
      templateRef: contentAddressedReference,
      applicabilityScope: canonicalJson,
      selectionReason: localRef('justification'),
      replacementFor: contentAddressedReference,
    },
  ),
  regulatoryApplicability: object(
    ['regulatoryReferenceRef', 'applicability', 'rationale', 'evidenceRefs', 'riskLevel'],
    {
      regulatoryReferenceRef: contentAddressedReference,
      applicability: { enum: ['APPLICABLE', 'NOT_APPLICABLE', 'PENDING_DETERMINATION'] },
      rationale: localRef('justification'),
      evidenceRefs: array(localRef('evidenceRef')),
      riskLevel: namespace,
    },
  ),
  gapInputSnapshot: object(
    [
      'customerBaselineRef',
      'templateBaselineRef',
      'regulatoryProfileRef',
      'enterpriseProfileSnapshotRef',
      'qmsConfigurationRef',
      'productScopeSnapshotRef',
      'analysisPolicyRef',
    ],
    {
      customerBaselineRef: versionedReference,
      templateBaselineRef: versionedReference,
      regulatoryProfileRef: versionedReference,
      enterpriseProfileSnapshotRef: snapshotReference,
      qmsConfigurationRef: versionedReference,
      productScopeSnapshotRef: snapshotReference,
      analysisPolicyRef: versionedReference,
    },
  ),
  deliveryItemDefinition: object(
    [
      'itemId',
      'itemKey',
      'itemType',
      'title',
      'objective',
      'sourceGapItemRefs',
      'dependencyItemIds',
      'targetArtifactTypes',
      'qualityProfileRef',
      'completionCriteria',
      'commitmentStatus',
    ],
    {
      itemId: uuid,
      itemKey: text,
      itemType: namespace,
      title: text,
      objective: text,
      sourceGapItemRefs: array(versionedReference, { nonEmpty: true, unique: true }),
      dependencyItemIds: array(uuid, { unique: true }),
      targetArtifactTypes: array(namespace, { nonEmpty: true, unique: true }),
      qualityProfileRef: versionedReference,
      completionCriteria: canonicalJson,
      dueConstraint: canonicalJson,
      commitmentStatus: localRef('deliveryCommitmentStatus'),
    },
  ),
  completionEvaluationInput: object(
    [
      'deliveryPlanRef',
      'deliveryItemId',
      'criteriaHash',
      'factRefs',
      'sourceWatermarks',
      'evaluatorRef',
      'evaluatedAt',
    ],
    {
      deliveryPlanRef: versionedReference,
      deliveryItemId: uuid,
      criteriaHash: contentHash,
      factRefs: array(typedReference, { nonEmpty: true, unique: true }),
      sourceWatermarks: array(localRef('sourceWatermark')),
      evaluatorRef: versionedReference,
      evaluatedAt: instant,
    },
  ),
  projectContextSourceSlice: object(
    [
      'projectRef',
      'enterpriseProfileSnapshotRef',
      'qmsConfigurationRef',
      'productScopeSnapshotRef',
      'activeBaselineRefs',
      'factItems',
      'omissions',
      'redactions',
      'sourceWatermark',
    ],
    {
      projectRef: objectReference,
      enterpriseProfileSnapshotRef: snapshotReference,
      qmsConfigurationRef: versionedReference,
      productScopeSnapshotRef: snapshotReference,
      activeBaselineRefs: array(typedReference),
      factItems: array(canonicalJson),
      omissions: array(canonicalJson),
      redactions: array(canonicalJson),
      sourceWatermark: localRef('sourceWatermark'),
    },
  ),
  enterpriseProfileSnapshotResult: object(['snapshotRef', 'payload'], {
    snapshotRef: snapshotReference,
    payload: canonicalJson,
  }),
  activeBaselineRefsView: object(['aggregateVersions'], {
    customerBaselineRef: versionedReference,
    templateBaselineRef: versionedReference,
    regulatoryProfileRef: versionedReference,
    gapAnalysisRef: versionedReference,
    deliveryPlanRef: versionedReference,
    aggregateVersions: canonicalJson,
  }),
  deliveryItemCriteriaView: object(
    ['deliveryPlanRef', 'deliveryItemId', 'definition', 'criteriaHash', 'executionStatus'],
    {
      deliveryPlanRef: versionedReference,
      deliveryItemId: uuid,
      definition: localRef('deliveryItemDefinition'),
      criteriaHash: contentHash,
      currentEvaluationRef: contentAddressedReference,
      executionStatus: localRef('deliveryExecutionStatus'),
    },
  ),
  objectScopeValidation: object(['valid', 'reasons'], {
    valid: { type: 'boolean' },
    authoritativeScopeRef: scope,
    resolvedRef: typedReference,
    lifecycle: namespace,
    reasons: array(reasonCode),
  }),
  projectBoardSliceItem: object(
    ['deliveryItemId', 'itemKey', 'title', 'commitmentStatus', 'executionStatus', 'blockerRefs'],
    {
      deliveryItemId: uuid,
      itemKey: text,
      title: text,
      commitmentStatus: localRef('deliveryCommitmentStatus'),
      executionStatus: localRef('deliveryExecutionStatus'),
      completionEvaluationRef: contentAddressedReference,
      blockerRefs: array(typedReference),
    },
  ),
  projectBoardPage: object(['items', 'snapshotAt', 'sourceWatermarks'], {
    items: array(localRef('projectBoardSliceItem')),
    nextCursor: text,
    snapshotAt: instant,
    sourceWatermarks: array(localRef('sourceWatermark')),
    consistency: { const: 'PROJECTION' },
    asOfEventId: uuid,
    asOfRecordedAt: instant,
    projectionLag: { type: 'integer', minimum: 0 },
    projectionStatus: { enum: ['READY', 'STALE', 'REBUILDING', 'FAILED'] },
  }),
} as const satisfies Readonly<Record<string, JsonSchema>>;

const operationSchemas = {
  'project.create_enterprise': {
    payload: object(['displayCode', 'displayName', 'initialStatus'], {
      displayCode: text,
      displayName: text,
      initialStatus: { const: 'ACTIVE' },
    }),
  },
  'project.propose_enterprise_fact': {
    payload: object(['enterpriseRef', 'proposal'], {
      enterpriseRef: objectReference,
      proposal: localRef('factProposal'),
    }),
  },
  'project.confirm_enterprise_fact': {
    payload: object(['proposalVersionRef', 'confirmedValue', 'evidenceRefs', 'justification'], {
      proposalVersionRef: versionedReference,
      confirmedValue: localRef('valueEnvelopeCanonicalJson'),
      evidenceRefs: array(localRef('evidenceRef'), { nonEmpty: true, unique: true }),
      effectivePeriod: localRef('effectivePeriod'),
      justification: localRef('justification'),
    }),
  },
  'project.create_project': {
    payload: object(
      ['enterpriseRef', 'displayCode', 'title', 'objective', 'startSnapshot', 'memberPolicyRef'],
      {
        enterpriseRef: objectReference,
        displayCode: text,
        title: text,
        objective: text,
        startSnapshot: localRef('projectStartSnapshot'),
        memberPolicyRef: versionedReference,
      },
    ),
  },
  'project.register_source_material': {
    payload: object(['projectRef', 'descriptor'], {
      projectRef: objectReference,
      descriptor: localRef('sourceMaterialDescriptor'),
    }),
  },
  'project.accept_source_material': {
    payload: object(
      ['securityValidationRefs', 'integrityValidationRef', 'acceptedObjectRef', 'acceptedAt'],
      {
        securityValidationRefs: array(contentAddressedReference, { nonEmpty: true, unique: true }),
        integrityValidationRef: contentAddressedReference,
        acceptedObjectRef: text,
        acceptedAt: instant,
      },
    ),
  },
  'project.propose_customer_material': {
    payload: object(['projectRef', 'proposal'], {
      projectRef: objectReference,
      proposal: localRef('customerMaterialProposal'),
    }),
  },
  'project.confirm_customer_material': {
    payload: object(
      ['candidateVersionRef', 'completeness', 'declaredStatus', 'evidenceRefs', 'justification'],
      {
        candidateVersionRef: versionedReference,
        completeness: localRef('materialCompleteness'),
        declaredStatus: namespace,
        evidenceRefs: array(localRef('evidenceRef')),
        justification: localRef('justification'),
      },
    ),
  },
  'project.create_customer_baseline_draft': {
    payload: object(['projectRef', 'expectations', 'baselinePolicyRef'], {
      projectRef: objectReference,
      previousVersionRef: versionedReference,
      expectations: array(localRef('baselineExpectation'), { nonEmpty: true, unique: true }),
      baselinePolicyRef: versionedReference,
    }),
  },
  'project.activate_customer_baseline_version': {
    payload: object(
      ['baselineVersionRef', 'reviewSnapshotRef', 'impactPolicyRef', 'justification'],
      {
        baselineVersionRef: versionedReference,
        reviewSnapshotRef: snapshotReference,
        impactPolicyRef: versionedReference,
        justification: localRef('justification'),
      },
    ),
  },
  'project.freeze_template_baseline': {
    payload: object(
      ['templateBaselineVersionRef', 'selections', 'reviewSnapshotRef', 'selectionRationale'],
      {
        templateBaselineVersionRef: versionedReference,
        selections: array(localRef('templateSelection'), { nonEmpty: true, unique: true }),
        reviewSnapshotRef: snapshotReference,
        selectionRationale: localRef('justification'),
      },
    ),
  },
  'project.activate_regulatory_profile': {
    payload: object(
      [
        'regulatoryProfileVersionRef',
        'jurisdiction',
        'productScopeSnapshotRef',
        'applicabilityItems',
        'reviewSnapshotRef',
      ],
      {
        regulatoryProfileVersionRef: versionedReference,
        jurisdiction: namespace,
        productScopeSnapshotRef: snapshotReference,
        applicabilityItems: array(localRef('regulatoryApplicability'), {
          nonEmpty: true,
          unique: true,
        }),
        reviewSnapshotRef: snapshotReference,
      },
    ),
  },
  'project.start_gap_analysis': {
    payload: object(['projectRef', 'inputSnapshot', 'mode', 'requestedScope'], {
      projectRef: objectReference,
      inputSnapshot: localRef('gapInputSnapshot'),
      mode: { enum: ['FORMAL', 'EXPLORATORY'] },
      requestedScope: canonicalJson,
    }),
  },
  'project.accept_gap_analysis': {
    payload: object(
      ['gapAnalysisVersionRef', 'reviewSnapshotRef', 'disposition', 'justification'],
      {
        gapAnalysisVersionRef: versionedReference,
        reviewSnapshotRef: snapshotReference,
        disposition: { enum: ['ACCEPT', 'REJECT', 'CHANGES_REQUIRED'] },
        justification: localRef('justification'),
      },
    ),
  },
  'project.create_delivery_plan_draft': {
    payload: object(
      [
        'projectRef',
        'acceptedGapAnalysisRef',
        'baselineRefs',
        'items',
        'assumptions',
        'exclusions',
        'planQualityPolicyRef',
      ],
      {
        projectRef: objectReference,
        acceptedGapAnalysisRef: versionedReference,
        baselineRefs: array(typedReference, { nonEmpty: true, unique: true }),
        items: array(localRef('deliveryItemDefinition'), { nonEmpty: true, unique: true }),
        assumptions: array(text),
        exclusions: array(text),
        planQualityPolicyRef: versionedReference,
      },
    ),
  },
  'project.approve_delivery_plan': {
    payload: object(['deliveryPlanVersionRef', 'reviewSnapshotRef', 'decision', 'justification'], {
      deliveryPlanVersionRef: versionedReference,
      reviewSnapshotRef: snapshotReference,
      decision: { enum: ['APPROVE', 'CHANGES_REQUIRED', 'REJECT'] },
      justification: localRef('justification'),
    }),
  },
  'project.activate_delivery_plan': {
    payload: object(
      ['deliveryPlanVersionRef', 'approvalDecisionRef', 'activatedAt', 'impactPolicyRef'],
      {
        deliveryPlanVersionRef: versionedReference,
        approvalDecisionRef: contentAddressedReference,
        activatedAt: instant,
        impactPolicyRef: versionedReference,
      },
    ),
  },
  'project.evaluate_delivery_item_completion': {
    payload: object(['input'], { input: localRef('completionEvaluationInput') }),
  },
  'project.get_project_context_source': {
    payload: object(['projectRef', 'purpose', 'audience', 'requestedKinds'], {
      projectRef: objectReference,
      purpose: namespace,
      audience: objectReference,
      requestedKinds: array(namespace, { unique: true }),
      asOf: instant,
    }),
    result: localRef('projectContextSourceSlice'),
  },
  'project.get_enterprise_profile_snapshot': {
    payload: object(['enterpriseProfileSnapshotRef'], {
      enterpriseProfileSnapshotRef: snapshotReference,
    }),
    result: localRef('enterpriseProfileSnapshotResult'),
  },
  'project.get_active_baseline_refs': {
    payload: object(['projectRef'], { projectRef: objectReference }),
    result: localRef('activeBaselineRefsView'),
  },
  'project.get_delivery_item_criteria': {
    payload: object(['deliveryPlanRef', 'deliveryItemId'], {
      deliveryPlanRef: versionedReference,
      deliveryItemId: uuid,
    }),
    result: localRef('deliveryItemCriteriaView'),
  },
  'project.validate_object_scope': {
    payload: object(['objectRef', 'expectedScopeRef', 'purpose'], {
      objectRef: typedReference,
      expectedScopeRef: scope,
      purpose: namespace,
    }),
    result: localRef('objectScopeValidation'),
  },
  'project.get_project_board_slice': {
    payload: object(['projectRef', 'statuses', 'itemTypes', 'page'], {
      projectRef: objectReference,
      statuses: array(localRef('deliveryExecutionStatus'), { unique: true }),
      itemTypes: array(namespace, { unique: true }),
      page: localRef('pageRequest'),
    }),
    result: localRef('projectBoardPage'),
  },
  'project.SourceMaterialAccepted': {
    payload: object(['sourceMaterialRef', 'projectRef', 'originRef', 'acceptedAt'], {
      sourceMaterialRef: contentAddressedReference,
      projectRef: objectReference,
      originRef: externalReference,
      acceptedAt: instant,
    }),
  },
  'project.CustomerMaterialConfirmed': {
    payload: object(
      [
        'customerMaterialRef',
        'projectRef',
        'materialType',
        'completeness',
        'confirmationDecisionRef',
      ],
      {
        customerMaterialRef: versionedReference,
        projectRef: objectReference,
        materialType: namespace,
        completeness: localRef('materialCompleteness'),
        confirmationDecisionRef: contentAddressedReference,
      },
    ),
  },
  'project.CustomerBaselineVersionActivated': {
    payload: object(['customerBaselineRef', 'projectRef', 'impactPolicyRef'], {
      customerBaselineRef: versionedReference,
      previousActiveRef: versionedReference,
      projectRef: objectReference,
      impactPolicyRef: versionedReference,
    }),
  },
  'project.GapAnalysisAccepted': {
    payload: object(['gapAnalysisRef', 'projectRef', 'inputSnapshotRef', 'acceptanceDecisionRef'], {
      gapAnalysisRef: versionedReference,
      projectRef: objectReference,
      inputSnapshotRef: snapshotReference,
      acceptanceDecisionRef: contentAddressedReference,
    }),
  },
  'project.DeliveryPlanActivated': {
    payload: object(['deliveryPlanRef', 'projectRef', 'itemRefs'], {
      deliveryPlanRef: versionedReference,
      previousActiveRef: versionedReference,
      projectRef: objectReference,
      itemRefs: array(versionedReference, { nonEmpty: true, unique: true }),
    }),
  },
  'project.DeliveryItemActivated': {
    payload: object(['deliveryPlanRef', 'deliveryItemRef', 'criteriaHash', 'qualityProfileRef'], {
      deliveryPlanRef: versionedReference,
      deliveryItemRef: versionedReference,
      criteriaHash: contentHash,
      qualityProfileRef: versionedReference,
    }),
  },
  'project.DeliveryItemCompletionSatisfied': {
    payload: object(['deliveryItemRef', 'evaluationRef', 'satisfiedFactRefs', 'satisfiedAt'], {
      deliveryItemRef: versionedReference,
      evaluationRef: contentAddressedReference,
      satisfiedFactRefs: array(typedReference, { nonEmpty: true, unique: true }),
      satisfiedAt: instant,
    }),
  },
  'project.DeliveryItemImpactReviewRequested': {
    payload: object(['deliveryItemRef', 'triggeringRef', 'impactReason'], {
      deliveryItemRef: versionedReference,
      triggeringRef: typedReference,
      priorEvaluationRef: contentAddressedReference,
      impactReason: reasonCode,
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

export const enterpriseProjectOperationContracts = Object.freeze(
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
  ) as Readonly<Record<string, ExecutableProjectOperationContract>>,
);

export const enterpriseProjectSchema = {
  $id: schemaId,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: { ...namedDefinitions, ...operationDefinitions },
} as const satisfies JsonSchema;
