import type { JsonSchema } from '../schema-types.js';

const schemaId = 'https://schemas.zhiju.local/modules/quality-governance/1.0';
const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';
const revisionAcceptanceCore = 'https://schemas.zhiju.local/core/revision-acceptance/1.0';
const approvalBundleCore = 'https://schemas.zhiju.local/core/approval-bundle/1.0';
const releaseReadinessCore = 'https://schemas.zhiju.local/core/release-readiness/1.0';

type SchemaProperties = Readonly<Record<string, unknown>>;

interface OperationContractSchema {
  readonly payload: JsonSchema;
  readonly result?: JsonSchema;
}

export interface ExecutableQualityGovernanceOperationContract {
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
const safeSummary = { $ref: `${common}safeSummary` } as const;
const instant = { $ref: `${common}utcInstant` } as const;
const positiveInteger = { $ref: `${common}positiveInteger` } as const;
const contentHash = { $ref: `${common}contentHash` } as const;
const objectReference = { $ref: `${common}objectRef` } as const;
const versionedReference = { $ref: `${common}versionedRef` } as const;
const typedReference = { $ref: `${common}typedReference` } as const;
const contentAddressedReference = { $ref: `${common}contentAddressedRef` } as const;
const snapshotReference = { $ref: `${common}snapshotRef` } as const;
const releasePackageReference = { $ref: `${common}releasePackageRef` } as const;
const evidenceReference = { $ref: `${common}evidenceRef` } as const;
const principalReference = { $ref: `${common}principalRef` } as const;
const justificationReference = { $ref: `${common}justification` } as const;
const pageRequestReference = { $ref: `${common}pageRequest` } as const;
const evaluationStageRef = { $ref: `${common}evaluationStage` } as const;
const canonicalJson = {} as const;

const namedDefinitions = {
  evidenceStatus: {
    enum: ['CANDIDATE', 'VERIFYING', 'VERIFIED', 'DISPUTED', 'EXPIRED', 'SUPERSEDED', 'REVOKED'],
  },
  gateOutcome: {
    enum: ['PASS', 'FAIL', 'ERROR', 'SKIPPED', 'NOT_APPLICABLE'],
  },
  gateExecutionMode: { enum: ['EXECUTED', 'REUSED_BY_IMPACT_ANALYSIS'] },
  issueStatus: {
    enum: [
      'OPEN',
      'ACKNOWLEDGED',
      'RESOLUTION_PROPOSED',
      'VERIFICATION_PENDING',
      'VERIFIED',
      'CLOSED',
      'DISMISSED',
      'DUPLICATE',
      'SUPERSEDED',
    ],
  },
  approvalDecision: { enum: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'] },
  issueSeverity: { enum: ['CRITICAL', 'MAJOR', 'MINOR', 'INFO'] },
  gateValidityStatus: { enum: ['VALID', 'INVALIDATED', 'SUPERSEDED'] },
  // Strict Human Principal — principalKind is fixed to HUMAN so that
  // schema-level enforcement rejects Agent / Service / Runtime impersonation.
  humanPrincipalRef: object(['principalKind', 'principalId'], {
    principalKind: { const: 'HUMAN' },
    principalId: uuid,
  }),
  // Opaque controlled-object-storage locator (bucket-or-container plus key
  // segments). A public URL, a scheme prefix and an absolute local path are
  // all rejected.
  objectLocator: {
    type: 'string',
    pattern: '^[a-z0-9][a-z0-9._-]*(?:/[A-Za-z0-9._-]+)+$',
  },
  effectivePeriod: object([], { validFrom: instant, validTo: instant }),
  sourceWatermark: object(['sourceModule', 'sequence', 'observedAt'], {
    sourceModule: namespace,
    partition: text,
    sequence: { type: 'integer', minimum: 0 },
    observedAt: instant,
  }),
  gateTarget: {
    oneOf: [
      object(['kind', 'revisionRef'], {
        kind: { const: 'REVISION' },
        revisionRef: contentAddressedReference,
      }),
      object(['kind', 'revisionRef', 'representationRef'], {
        kind: { const: 'REPRESENTATION' },
        revisionRef: contentAddressedReference,
        representationRef: { $ref: `${common}representationRef` },
      }),
      object(['kind', 'revisionRef', 'releasePackageRef'], {
        kind: { const: 'RELEASE_PACKAGE' },
        revisionRef: contentAddressedReference,
        releasePackageRef: releasePackageReference,
      }),
    ],
  },
  gateSpecRef: object(
    ['objectType', 'gateSpecId', 'gateVersion', 'qualityProfileVersionId', 'evaluationStage'],
    {
      objectType: namespace,
      gateSpecId: uuid,
      gateVersion: text,
      qualityProfileVersionId: uuid,
      evaluationStage: evaluationStageRef,
    },
  ),
  evaluatorVersion: object(['evaluatorId', 'evaluatorVersion'], {
    evaluatorId: namespace,
    evaluatorVersion: text,
  }),
  evidenceCandidate: object(
    [
      'sourceType',
      'sourceObjectRef',
      'sourceSnapshotRef',
      'sourceVersion',
      'locator',
      'capturedContentRef',
      'capturedContentHash',
      'authority',
      'accessClassification',
      'capturedAt',
    ],
    {
      sourceType: namespace,
      sourceObjectRef: typedReference,
      sourceSnapshotRef: snapshotReference,
      sourceVersion: text,
      locator: localRef('objectLocator'),
      capturedContentRef: localRef('objectLocator'),
      capturedContentHash: contentHash,
      authority: namespace,
      jurisdiction: namespace,
      validPeriod: localRef('effectivePeriod'),
      accessClassification: namespace,
      capturedAt: instant,
    },
  ),
  evidenceVerification: object(
    [
      'method',
      'verifier',
      'verificationPolicyRef',
      'outcome',
      'evidenceRefs',
      'reasons',
      'verifiedAt',
    ],
    {
      method: namespace,
      verifier: principalReference,
      verificationPolicyRef: versionedReference,
      outcome: { enum: ['VERIFIED', 'DISPUTED'] },
      evidenceRefs: array(evidenceReference, { nonEmpty: true, unique: true }),
      reasons: array(reasonCode),
      verifiedAt: instant,
    },
  ),
  evidenceLinkDefinition: object(
    [
      'evidenceRef',
      'targetRef',
      'claimLocator',
      'claimHash',
      'relation',
      'applicabilityScope',
      'linkedAt',
    ],
    {
      evidenceRef: contentAddressedReference,
      targetRef: contentAddressedReference,
      claimLocator: text,
      claimHash: contentHash,
      relation: { enum: ['SUPPORTS', 'CONTRADICTS', 'CONTEXT_ONLY'] },
      applicabilityScope: canonicalJson,
      linkedAt: instant,
    },
  ),
  qualityProfileDefinition: object(
    [
      'name',
      'profileVersion',
      'applicableArtifactTypes',
      'riskApplicability',
      'gateSpecs',
      'approvalRequirements',
    ],
    {
      name: text,
      profileVersion: text,
      applicableArtifactTypes: array(namespace, { nonEmpty: true, unique: true }),
      riskApplicability: canonicalJson,
      gateSpecs: array(canonicalJson, { nonEmpty: true, unique: true }),
      gateDependencies: array(canonicalJson, { unique: true }),
      rerunPolicy: canonicalJson,
      issuePolicy: canonicalJson,
      separationOfDutiesPolicy: canonicalJson,
      approvalRequirements: array(canonicalJson, { nonEmpty: true, unique: true }),
      releaseRequirements: array(canonicalJson, { unique: true }),
    },
  ),
  gateResultSubmission: object(
    [
      'artifactRef',
      'gateTarget',
      'evaluationStage',
      'qualityProfileRef',
      'gateSpecId',
      'gateVersion',
      'evaluationAttempt',
      'evaluatedScope',
      'inputSnapshotRef',
      'evaluator',
      'outcome',
      'evidenceRefs',
      'startedAt',
      'completedAt',
    ],
    {
      artifactRef: objectReference,
      gateTarget: localRef('gateTarget'),
      evaluationStage: evaluationStageRef,
      qualityProfileRef: versionedReference,
      gateSpecId: uuid,
      gateVersion: text,
      evaluationAttempt: positiveInteger,
      evaluatedScope: canonicalJson,
      inputSnapshotRef: snapshotReference,
      evaluator: canonicalJson,
      outcome: localRef('gateOutcome'),
      findings: array(canonicalJson),
      evidenceRefs: array(evidenceReference, { unique: true }),
      startedAt: instant,
      completedAt: instant,
    },
  ),
  gateReuseSubmission: object(
    [
      'newTarget',
      'sourceGateResultRef',
      'changeImpactRef',
      'qualityProfileRef',
      'gateSpecId',
      'derivedOutcome',
      'evaluatedAt',
    ],
    {
      newTarget: localRef('gateTarget'),
      sourceGateResultRef: contentAddressedReference,
      changeImpactRef: contentAddressedReference,
      qualityProfileRef: versionedReference,
      gateSpecId: uuid,
      derivedOutcome: localRef('gateOutcome'),
      evaluatedAt: instant,
    },
  ),
  reviewIssueDefinition: object(
    [
      'artifactRef',
      'originRevisionRef',
      'issueType',
      'severity',
      'blockingClassification',
      'statement',
      'locator',
      'evidenceRefs',
      'raisedAt',
    ],
    {
      artifactRef: objectReference,
      originRevisionRef: contentAddressedReference,
      originGateResultRef: contentAddressedReference,
      issueType: namespace,
      severity: localRef('issueSeverity'),
      blockingClassification: namespace,
      statement: text,
      locator: text,
      evidenceRefs: array(evidenceReference, { unique: true }),
      raisedAt: instant,
    },
  ),
  issueResolution: object(['targetRevisionRef', 'changedClaimRefs', 'explanation', 'proposedAt'], {
    targetRevisionRef: contentAddressedReference,
    changedClaimRefs: array(contentAddressedReference, { nonEmpty: true, unique: true }),
    explanation: text,
    proposedAt: instant,
  }),
  issueVerification: object(
    [
      'targetRevisionRef',
      'verifier',
      'verificationMethod',
      'supportingGateResultRefs',
      'outcome',
      'verifiedAt',
    ],
    {
      targetRevisionRef: contentAddressedReference,
      verifier: principalReference,
      verificationMethod: namespace,
      supportingGateResultRefs: array(contentAddressedReference, { unique: true }),
      outcome: { enum: ['VERIFIED', 'REJECTED'] },
      verifiedAt: instant,
    },
  ),
  approvalRequestDefinition: object(
    [
      'artifactRef',
      'revisionRef',
      'revisionAcceptanceSnapshotRef',
      'qualityProfileRef',
      'approvalRequirementId',
      'requestedApproverRole',
      'requestNonceHash',
    ],
    {
      artifactRef: objectReference,
      revisionRef: contentAddressedReference,
      revisionAcceptanceSnapshotRef: snapshotReference,
      qualityProfileRef: versionedReference,
      approvalRequirementId: uuid,
      requestedApproverRole: namespace,
      expiresAt: instant,
      requestNonceHash: contentHash,
    },
  ),
  approvalSubmission: object(
    [
      'requestRef',
      'revisionRef',
      'revisionAcceptanceSnapshotRef',
      'approvalRequirementId',
      'decision',
      'decisionComment',
      'approverHumanPrincipalRef',
      'approverRoleSnapshotRef',
      'authorizationDecisionRef',
      'separationCheckRef',
      'decidedAt',
    ],
    {
      requestRef: objectReference,
      revisionRef: contentAddressedReference,
      revisionAcceptanceSnapshotRef: snapshotReference,
      approvalRequirementId: uuid,
      decision: localRef('approvalDecision'),
      decisionComment: safeSummary,
      // Spec §3 — Human Approval is permanently HUMAN_ONLY; AGENT and
      // actingFor Agent must be rejected at the schema boundary.
      approverHumanPrincipalRef: localRef('humanPrincipalRef'),
      approverRoleSnapshotRef: snapshotReference,
      authorizationDecisionRef: contentAddressedReference,
      separationCheckRef: contentAddressedReference,
      decidedAt: instant,
    },
  ),
  evidenceView: object(['evidenceRef', 'status', 'candidate', 'impactStatus'], {
    evidenceRef: contentAddressedReference,
    status: localRef('evidenceStatus'),
    candidate: localRef('evidenceCandidate'),
    latestVerificationRef: contentAddressedReference,
    impactStatus: namespace,
  }),
  qualityProfileView: object(['qualityProfileRef', 'status', 'definition', 'payloadHash'], {
    qualityProfileRef: versionedReference,
    status: namespace,
    definition: localRef('qualityProfileDefinition'),
    payloadHash: contentHash,
  }),
  gatePlan: object(
    [
      'target',
      'qualityProfileRef',
      'applicableGateSpecs',
      'dependencyOrder',
      'reuseDecisions',
      'planHash',
    ],
    {
      target: localRef('gateTarget'),
      qualityProfileRef: versionedReference,
      applicableGateSpecs: array(canonicalJson),
      dependencyOrder: array(uuid, { unique: true }),
      reuseDecisions: array(canonicalJson),
      planHash: contentHash,
    },
  ),
  gateResultView: object(
    [
      'gateResultRef',
      'target',
      'evaluationStage',
      'outcome',
      'validityStatus',
      'evidenceRefs',
      'reviewIssueRefs',
    ],
    {
      gateResultRef: contentAddressedReference,
      target: localRef('gateTarget'),
      evaluationStage: evaluationStageRef,
      outcome: localRef('gateOutcome'),
      validityStatus: localRef('gateValidityStatus'),
      evidenceRefs: array(evidenceReference, { unique: true }),
      reviewIssueRefs: array(objectReference, { unique: true }),
    },
  ),
  gateResultPage: object(['items', 'snapshotAt', 'sourceWatermarks'], {
    items: array(localRef('gateResultView')),
    nextCursor: text,
    snapshotAt: instant,
    sourceWatermarks: array(localRef('sourceWatermark')),
  }),
  blockingIssueView: object(
    ['reviewIssueRef', 'originRevisionRef', 'severity', 'blockingClassification', 'status'],
    {
      reviewIssueRef: objectReference,
      originRevisionRef: contentAddressedReference,
      severity: localRef('issueSeverity'),
      blockingClassification: namespace,
      status: localRef('issueStatus'),
      ownerRef: principalReference,
    },
  ),
  revisionAcceptanceSnapshotResult: { $ref: revisionAcceptanceCore },
  approvalBundleSnapshotResult: { $ref: approvalBundleCore },
  releaseReadinessSnapshotResult: { $ref: releaseReadinessCore },
} as const satisfies Readonly<Record<string, JsonSchema>>;

const operationSchemas = {
  'quality.capture_evidence_candidate': {
    payload: object(['candidate'], { candidate: localRef('evidenceCandidate') }),
  },
  'quality.verify_evidence': {
    payload: object(['verification'], { verification: localRef('evidenceVerification') }),
  },
  'quality.revoke_evidence': {
    payload: object(['revocationReason', 'impactAssessmentRef', 'revokedAt'], {
      revocationReason: justificationReference,
      impactAssessmentRef: contentAddressedReference,
      revokedAt: instant,
    }),
  },
  'quality.create_evidence_link': {
    payload: object(['definition'], { definition: localRef('evidenceLinkDefinition') }),
  },
  'quality.create_quality_profile_draft': {
    payload: object(['definition'], { definition: localRef('qualityProfileDefinition') }),
  },
  'quality.activate_quality_profile': {
    payload: object(
      ['profileVersionRef', 'reviewSnapshotRef', 'validationSnapshotRef', 'activatedAt'],
      {
        profileVersionRef: versionedReference,
        reviewSnapshotRef: snapshotReference,
        validationSnapshotRef: snapshotReference,
        activatedAt: instant,
      },
    ),
  },
  'quality.record_gate_result': {
    payload: object(['submission'], { submission: localRef('gateResultSubmission') }),
  },
  'quality.record_reused_gate_result': {
    payload: object(['reuse'], { reuse: localRef('gateReuseSubmission') }),
  },
  'quality.invalidate_gate_result': {
    payload: object(['invalidationReason', 'impactAssessmentRef', 'invalidatedAt'], {
      invalidationReason: justificationReference,
      impactAssessmentRef: contentAddressedReference,
      invalidatedAt: instant,
    }),
  },
  'quality.raise_review_issue': {
    payload: object(['definition'], { definition: localRef('reviewIssueDefinition') }),
  },
  'quality.propose_issue_resolution': {
    payload: object(['resolution', 'proposedBy'], {
      resolution: localRef('issueResolution'),
      proposedBy: principalReference,
    }),
  },
  'quality.verify_issue_resolution': {
    payload: object(['verification'], { verification: localRef('issueVerification') }),
  },
  'quality.close_review_issue': {
    payload: object(['verificationRef', 'closeReason', 'closedAt'], {
      verificationRef: contentAddressedReference,
      closeReason: justificationReference,
      closedAt: instant,
    }),
  },
  'quality.request_approval': {
    payload: object(['definition'], { definition: localRef('approvalRequestDefinition') }),
  },
  'quality.submit_approval_decision': {
    payload: object(['submission'], { submission: localRef('approvalSubmission') }),
  },
  'quality.revoke_approval': {
    payload: object(['revocationReason', 'impactAssessmentRef', 'revokedAt'], {
      revocationReason: justificationReference,
      impactAssessmentRef: contentAddressedReference,
      revokedAt: instant,
    }),
  },
  'quality.evaluate_revision_readiness': {
    payload: object(
      [
        'revisionRef',
        'qualityProfileRef',
        'gateResultRefs',
        'evidenceStatusSnapshotRef',
        'issueSnapshotRef',
        'evaluatorVersions',
        'evaluatedAt',
      ],
      {
        revisionRef: contentAddressedReference,
        qualityProfileRef: versionedReference,
        gateResultRefs: array(contentAddressedReference, { unique: true }),
        evidenceStatusSnapshotRef: snapshotReference,
        issueSnapshotRef: snapshotReference,
        evaluatorVersions: array(localRef('evaluatorVersion'), {
          nonEmpty: true,
          unique: true,
        }),
        evaluatedAt: instant,
      },
    ),
  },
  'quality.evaluate_release_gate_readiness': {
    payload: object(
      [
        'releasePackageRef',
        'approvalBundleSnapshotRef',
        'recipientScopeSnapshotRef',
        'destinationRefs',
        'releaseGateResultRefs',
        'evaluatedAt',
      ],
      {
        releasePackageRef: releasePackageReference,
        approvalBundleSnapshotRef: snapshotReference,
        recipientScopeSnapshotRef: snapshotReference,
        destinationRefs: array(typedReference, { nonEmpty: true, unique: true }),
        releaseGateResultRefs: array(contentAddressedReference, { unique: true }),
        evaluatedAt: instant,
      },
    ),
  },
  'quality.get_evidence': {
    payload: object(['evidenceRef'], { evidenceRef: contentAddressedReference }),
    result: localRef('evidenceView'),
  },
  'quality.get_quality_profile': {
    payload: object(['qualityProfileRef'], { qualityProfileRef: versionedReference }),
    result: localRef('qualityProfileView'),
  },
  'quality.get_gate_plan': {
    payload: object(['target', 'qualityProfileRef'], {
      target: localRef('gateTarget'),
      qualityProfileRef: versionedReference,
      changeImpactRef: contentAddressedReference,
    }),
    result: localRef('gatePlan'),
  },
  'quality.get_gate_results': {
    payload: object(['target', 'gateSpecIds', 'outcomes', 'validOnly', 'page'], {
      target: localRef('gateTarget'),
      qualityProfileRef: versionedReference,
      gateSpecIds: array(uuid, { nonEmpty: true, unique: true }),
      outcomes: array(localRef('gateOutcome'), { nonEmpty: true, unique: true }),
      validOnly: { type: 'boolean' },
      page: pageRequestReference,
    }),
    result: localRef('gateResultPage'),
  },
  'quality.get_open_blocking_issues': {
    payload: object(['revisionRef', 'qualityProfileRef'], {
      revisionRef: contentAddressedReference,
      qualityProfileRef: versionedReference,
    }),
    result: array(localRef('blockingIssueView')),
  },
  'quality.get_revision_acceptance_snapshot': {
    payload: object(['snapshotRef'], { snapshotRef: snapshotReference }),
    result: localRef('revisionAcceptanceSnapshotResult'),
  },
  'quality.get_approval_bundle_snapshot': {
    payload: object(['snapshotRef'], { snapshotRef: snapshotReference }),
    result: localRef('approvalBundleSnapshotResult'),
  },
  'quality.get_release_readiness_snapshot': {
    payload: object(['snapshotRef'], { snapshotRef: snapshotReference }),
    result: localRef('releaseReadinessSnapshotResult'),
  },
  'quality.EvidenceVerified': {
    payload: object(['evidenceRef', 'verificationRef', 'authority', 'verifiedAt'], {
      evidenceRef: contentAddressedReference,
      verificationRef: contentAddressedReference,
      authority: namespace,
      verifiedAt: instant,
    }),
  },
  'quality.EvidenceRevoked': {
    payload: object(['evidenceRef', 'impactAssessmentRef', 'reasonCode', 'revokedAt'], {
      evidenceRef: contentAddressedReference,
      impactAssessmentRef: contentAddressedReference,
      reasonCode,
      revokedAt: instant,
    }),
  },
  'quality.QualityProfileActivated': {
    payload: object(['qualityProfileRef', 'applicableArtifactTypes', 'activatedAt'], {
      qualityProfileRef: versionedReference,
      applicableArtifactTypes: array(namespace, { nonEmpty: true, unique: true }),
      activatedAt: instant,
    }),
  },
  'quality.GateResultRecorded': {
    payload: object(
      ['gateResultRef', 'target', 'evaluationStage', 'gateSpecId', 'outcome', 'validityStatus'],
      {
        gateResultRef: contentAddressedReference,
        target: localRef('gateTarget'),
        evaluationStage: evaluationStageRef,
        gateSpecId: uuid,
        outcome: localRef('gateOutcome'),
        validityStatus: { const: 'VALID' },
      },
    ),
  },
  'quality.BlockingReviewIssueRaised': {
    payload: object(
      ['reviewIssueRef', 'artifactRef', 'originRevisionRef', 'blockingClassification', 'severity'],
      {
        reviewIssueRef: objectReference,
        artifactRef: objectReference,
        originRevisionRef: contentAddressedReference,
        blockingClassification: namespace,
        severity: localRef('issueSeverity'),
      },
    ),
  },
  'quality.ReviewIssueClosed': {
    payload: object(['reviewIssueRef', 'verifiedRevisionRef', 'verificationRef', 'closedAt'], {
      reviewIssueRef: objectReference,
      verifiedRevisionRef: contentAddressedReference,
      verificationRef: contentAddressedReference,
      closedAt: instant,
    }),
  },
  'quality.RevisionQualityReady': {
    payload: object(
      ['artifactRef', 'revisionRef', 'revisionAcceptanceSnapshotRef', 'qualityProfileRef'],
      {
        artifactRef: objectReference,
        revisionRef: contentAddressedReference,
        revisionAcceptanceSnapshotRef: snapshotReference,
        qualityProfileRef: versionedReference,
      },
    ),
  },
  'quality.RevisionFullyApproved': {
    payload: object(['artifactRef', 'revisionRef', 'approvalBundleSnapshotRef', 'approvalRefs'], {
      artifactRef: objectReference,
      revisionRef: contentAddressedReference,
      approvalBundleSnapshotRef: snapshotReference,
      approvalRefs: array(contentAddressedReference, { nonEmpty: true, unique: true }),
    }),
  },
  'quality.RevisionApprovalLost': {
    payload: object(
      [
        'artifactRef',
        'revisionRef',
        'priorApprovalBundleSnapshotRef',
        'triggeringRef',
        'reasonCode',
      ],
      {
        artifactRef: objectReference,
        revisionRef: contentAddressedReference,
        priorApprovalBundleSnapshotRef: snapshotReference,
        triggeringRef: typedReference,
        reasonCode,
      },
    ),
  },
  'quality.ReleaseGateReady': {
    payload: object(['releaseRef', 'releasePackageRef', 'releaseReadinessSnapshotRef', 'readyAt'], {
      releaseRef: objectReference,
      releasePackageRef: releasePackageReference,
      releaseReadinessSnapshotRef: snapshotReference,
      readyAt: instant,
    }),
  },
  'quality.ReleaseGateReadinessLost': {
    payload: object(
      [
        'releaseRef',
        'releasePackageRef',
        'priorReadinessSnapshotRef',
        'triggeringRef',
        'reasonCode',
      ],
      {
        releaseRef: objectReference,
        releasePackageRef: releasePackageReference,
        priorReadinessSnapshotRef: snapshotReference,
        triggeringRef: typedReference,
        reasonCode,
      },
    ),
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

export const qualityGovernanceOperationContracts = Object.freeze(
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
  ) as Readonly<Record<string, ExecutableQualityGovernanceOperationContract>>,
);

export const qualityGovernanceSchema = {
  $id: schemaId,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: { ...namedDefinitions, ...operationDefinitions },
} as const satisfies JsonSchema;
