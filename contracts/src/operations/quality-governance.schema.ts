import type { JsonSchema } from '../schema-types.js';

const schemaId = 'https://schemas.zhiju.local/modules/quality-governance/1.0';
const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';

type SchemaProperties = Readonly<Record<string, unknown>>;

interface OperationContractSchema {
  readonly payload: JsonSchema;
  readonly result?: JsonSchema;
}

export interface ExecutableQualityOperationContract {
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
const contentHash = { $ref: `${common}contentHash` } as const;
const positiveInt = { $ref: `${common}positiveInteger` } as const;
const objectReference = { $ref: `${common}objectRef` } as const;
const versionedReference = { $ref: `${common}versionedRef` } as const;
const typedReference = { $ref: `${common}typedReference` } as const;
const contentAddressedReference = { $ref: `${common}contentAddressedRef` } as const;
const snapshotReference = { $ref: `${common}snapshotRef` } as const;
const externalReference = { $ref: `${common}externalRef` } as const;
const evidenceRef = { $ref: `${common}evidenceRef` } as const;
const releasePackageRef = { $ref: `${common}releasePackageRef` } as const;
const canonicalJson = {} as const;

const evidenceStatus = {
  enum: ['CANDIDATE', 'VERIFYING', 'VERIFIED', 'DISPUTED', 'EXPIRED', 'SUPERSEDED', 'REVOKED'],
} as const;

const gateOutcome = {
  enum: ['PASS', 'FAIL', 'ERROR', 'SKIPPED', 'NOT_APPLICABLE'],
} as const;

const evaluationStage = {
  enum: ['REVISION_ACCEPTANCE', 'RELEASE_READINESS'],
} as const;

const gateExecutionMode = {
  enum: ['EXECUTED', 'REUSED_BY_IMPACT_ANALYSIS'],
} as const;

const issueStatus = {
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
} as const;

const approvalDecision = {
  enum: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'],
} as const;

const issueSeverity = {
  enum: ['CRITICAL', 'MAJOR', 'MINOR', 'INFO'],
} as const;

const namedDefinitions = {
  evidenceStatus,
  gateOutcome,
  evaluationStage,
  gateExecutionMode,
  issueStatus,
  approvalDecision,
  issueSeverity,
  effectivePeriod: object([], { validFrom: instant, validTo: instant }),
  objectLocator: {
    type: 'string',
    pattern: '^[a-z0-9][a-z0-9._-]*(?:/[A-Za-z0-9._-]+)+$',
  },
  mediaType: { type: 'string', pattern: '^[^/\\s]+/[^/\\s]+$' },
  justification: object(['reasonCode', 'summary', 'evidenceRefs'], {
    reasonCode,
    summary: safeSummary,
    evidenceRefs: array(evidenceRef),
    policyRef: versionedReference,
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
      locator: text,
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
      verifier: objectReference,
      verificationPolicyRef: versionedReference,
      outcome: { enum: ['VERIFIED', 'DISPUTED'] },
      evidenceRefs: array(evidenceRef, { nonEmpty: true, unique: true }),
      reasons: array(reasonCode, { unique: true }),
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
      'gateDependencies',
      'rerunPolicy',
      'issuePolicy',
      'separationOfDutiesPolicy',
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
  gateTargetRevision: object(['kind', 'revisionRef'], {
    kind: { const: 'REVISION' },
    revisionRef: contentAddressedReference,
  }),
  gateTargetRepresentation: object(['kind', 'revisionRef', 'representationRef'], {
    kind: { const: 'REPRESENTATION' },
    revisionRef: contentAddressedReference,
    representationRef: objectReference,
    renderer: object(['rendererId', 'rendererVersion'], {
      rendererId: namespace,
      rendererVersion: text,
    }),
    mediaType: localRef('mediaType'),
    checksum: contentHash,
  }),
  gateTargetReleasePackage: object(['kind', 'revisionRef', 'releasePackageRef'], {
    kind: { const: 'RELEASE_PACKAGE' },
    revisionRef: contentAddressedReference,
    releasePackageRef,
  }),
  gateTarget: {
    oneOf: [
      localRef('gateTargetRevision'),
      localRef('gateTargetRepresentation'),
      localRef('gateTargetReleasePackage'),
    ],
  },
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
      'findings',
      'evidenceRefs',
      'startedAt',
      'completedAt',
    ],
    {
      artifactRef: objectReference,
      gateTarget: localRef('gateTarget'),
      evaluationStage: localRef('evaluationStage'),
      executionMode: localRef('gateExecutionMode'),
      qualityProfileRef: versionedReference,
      gateSpecId: uuid,
      gateVersion: text,
      evaluationAttempt: positiveInt,
      evaluatedScope: canonicalJson,
      inputSnapshotRef: snapshotReference,
      evaluator: canonicalJson,
      outcome: localRef('gateOutcome'),
      findings: array(canonicalJson),
      evidenceRefs: array(evidenceRef, { unique: true }),
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
      evidenceRefs: array(evidenceRef, { unique: true }),
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
      verifier: objectReference,
      verificationMethod: namespace,
      supportingGateResultRefs: array(contentAddressedReference, { nonEmpty: true, unique: true }),
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
      approverHumanPrincipalRef: object(['principalKind', 'principalId'], {
        principalKind: { const: 'HUMAN' },
        principalId: uuid,
      }),
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
      dependencyOrder: array(uuid, { nonEmpty: true, unique: true }),
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
      evaluationStage: localRef('evaluationStage'),
      outcome: localRef('gateOutcome'),
      validityStatus: namespace,
      evidenceRefs: array(evidenceRef, { unique: true }),
      reviewIssueRefs: array(objectReference, { unique: true }),
    },
  ),
  blockingIssueView: object(
    ['reviewIssueRef', 'originRevisionRef', 'severity', 'blockingClassification', 'status'],
    {
      reviewIssueRef: objectReference,
      originRevisionRef: contentAddressedReference,
      severity: namespace,
      blockingClassification: namespace,
      status: localRef('issueStatus'),
      ownerRef: objectReference,
    },
  ),
  sourceWatermark: object(['sourceModule', 'sequence', 'observedAt'], {
    sourceModule: namespace,
    partition: text,
    sequence: { type: 'integer', minimum: 0 },
    observedAt: instant,
  }),
  pageRequest: object(['pageSize'], {
    pageSize: positiveInt,
    cursor: text,
  }),
  gateResultPage: object(['items', 'snapshotAt', 'sourceWatermarks'], {
    items: array(localRef('gateResultView')),
    nextCursor: text,
    snapshotAt: instant,
    sourceWatermarks: array(localRef('sourceWatermark')),
  }),
  revisionAcceptanceResult: object(
    ['revisionAcceptanceSnapshotRef', 'revisionRef', 'qualityProfileRef', 'evaluationStage'],
    {
      revisionAcceptanceSnapshotRef: snapshotReference,
      revisionRef: contentAddressedReference,
      qualityProfileRef: versionedReference,
      evaluationStage: { const: 'REVISION_ACCEPTANCE' },
    },
  ),
  approvalBundleResult: object(
    [
      'approvalBundleSnapshotRef',
      'revisionRef',
      'approvalRefs',
      'separationOfDutiesResult',
      'completeness',
    ],
    {
      approvalBundleSnapshotRef: snapshotReference,
      revisionRef: contentAddressedReference,
      approvalRefs: array(contentAddressedReference, { nonEmpty: true, unique: true }),
      separationOfDutiesResult: object(['outcome', 'checkedAt'], {
        outcome: { enum: ['SATISFIED', 'VIOLATED', 'INDETERMINATE'] },
        checkedAt: instant,
      }),
      completeness: object(['status', 'reasons'], {
        status: {
          enum: ['FULLY_APPROVED', 'PARTIALLY_APPROVED', 'NOT_APPROVED', 'STALE'],
        },
        reasons: array(text, { unique: true }),
      }),
    },
  ),
  releaseReadinessResult: object(
    ['releaseReadinessSnapshotRef', 'releasePackageRef', 'readiness', 'evaluatedAt'],
    {
      releaseReadinessSnapshotRef: snapshotReference,
      releasePackageRef,
      approvalBundleSnapshotRef: snapshotReference,
      readiness: object(['status', 'reasons'], {
        status: { enum: ['READY_FOR_AUTHORIZATION', 'NOT_READY', 'STALE'] },
        reasons: array(text, { unique: true }),
      }),
      evaluatedAt: instant,
    },
  ),
  revocationJustification: object(['revocationReason', 'impactAssessmentRef', 'revokedAt'], {
    revocationReason: localRef('justification'),
    impactAssessmentRef: contentAddressedReference,
    revokedAt: instant,
  }),
} as const satisfies Readonly<Record<string, JsonSchema>>;

const operationSchemas = {
  'quality.capture_evidence_candidate': {
    payload: object(['candidate'], {
      candidate: localRef('evidenceCandidate'),
    }),
  },
  'quality.verify_evidence': {
    payload: object(['verification'], {
      verification: localRef('evidenceVerification'),
    }),
  },
  'quality.revoke_evidence': {
    payload: object(['revocation'], {
      revocation: localRef('revocationJustification'),
    }),
  },
  'quality.create_evidence_link': {
    payload: object(['definition'], {
      definition: localRef('evidenceLinkDefinition'),
    }),
  },
  'quality.create_quality_profile_draft': {
    payload: object(['definition'], {
      definition: localRef('qualityProfileDefinition'),
    }),
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
    payload: object(['submission'], {
      submission: localRef('gateResultSubmission'),
    }),
  },
  'quality.record_reused_gate_result': {
    payload: object(['reuse'], {
      reuse: localRef('gateReuseSubmission'),
    }),
  },
  'quality.invalidate_gate_result': {
    payload: object(['invalidation'], {
      invalidation: localRef('revocationJustification'),
    }),
  },
  'quality.raise_review_issue': {
    payload: object(['definition'], {
      definition: localRef('reviewIssueDefinition'),
    }),
  },
  'quality.propose_issue_resolution': {
    payload: object(['resolution', 'proposedBy'], {
      resolution: localRef('issueResolution'),
      proposedBy: objectReference,
    }),
  },
  'quality.verify_issue_resolution': {
    payload: object(['verification'], {
      verification: localRef('issueVerification'),
    }),
  },
  'quality.close_review_issue': {
    payload: object(['verificationRef', 'closeReason', 'closedAt'], {
      verificationRef: contentAddressedReference,
      closeReason: localRef('justification'),
      closedAt: instant,
    }),
  },
  'quality.request_approval': {
    payload: object(['definition'], {
      definition: localRef('approvalRequestDefinition'),
    }),
  },
  'quality.submit_approval_decision': {
    payload: object(['submission'], {
      submission: localRef('approvalSubmission'),
    }),
  },
  'quality.revoke_approval': {
    payload: object(['revocation'], {
      revocation: localRef('revocationJustification'),
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
        evaluatorVersions: array(canonicalJson, { nonEmpty: true, unique: true }),
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
        releasePackageRef,
        approvalBundleSnapshotRef: snapshotReference,
        recipientScopeSnapshotRef: snapshotReference,
        destinationRefs: array(externalReference, { nonEmpty: true, unique: true }),
        releaseGateResultRefs: array(contentAddressedReference, { unique: true }),
        evaluatedAt: instant,
      },
    ),
  },
  'quality.get_evidence': {
    payload: object(['evidenceRef'], {
      evidenceRef: contentAddressedReference,
    }),
    result: localRef('evidenceView'),
  },
  'quality.get_quality_profile': {
    payload: object(['qualityProfileRef'], {
      qualityProfileRef: versionedReference,
    }),
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
      page: localRef('pageRequest'),
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
    payload: object(['snapshotRef'], {
      snapshotRef: snapshotReference,
    }),
    result: localRef('revisionAcceptanceResult'),
  },
  'quality.get_approval_bundle_snapshot': {
    payload: object(['snapshotRef'], {
      snapshotRef: snapshotReference,
    }),
    result: localRef('approvalBundleResult'),
  },
  'quality.get_release_readiness_snapshot': {
    payload: object(['snapshotRef'], {
      snapshotRef: snapshotReference,
    }),
    result: localRef('releaseReadinessResult'),
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
        evaluationStage: localRef('evaluationStage'),
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
        severity: namespace,
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
      releasePackageRef,
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
        releasePackageRef,
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
  ) as Readonly<Record<string, ExecutableQualityOperationContract>>,
);

export const qualityGovernanceSchema = {
  $id: schemaId,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $defs: {
    ...namedDefinitions,
    ...operationDefinitions,
  },
} as const satisfies JsonSchema;
