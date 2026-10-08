import type { JsonSchema } from '../schema-types.js';

// =============================================================================
// QualityGovernance Module Schema (v0.1, 37 operations, FULL)
//
// Authoritative source: `.vibe/module-specs/Module-Spec-005-QualityGovernance.md`.
// Field-level Payload/Result/Event schemas implement the following constraints
// that the Envelope-level JSON Schema cannot enforce:
//
//   - QualityProfile, GateSpec, RiskProfile must be referenced by exact
//     `VersionedRef` (no `latest` / no implicit current profile).
//   - Gate Target binds to a frozen `ContentAddressedRef<ArtifactRevision>`
//     plus an optional Representation or Release Package.
//   - Approval Submission is `HUMAN_ONLY`: approverHumanPrincipalRef must be
//     `HUMAN` and `actingForRef` is rejected via the SeparationCheck ref. The
//     payload structurally forbids Agent-only decisions entering the Bundle.
//   - Separation of Duties is enforced via dedicated `SeparationCheckRef` and
//     `approverRoleSnapshotRef`; verifiers cannot self-verify when SoD forbids.
//   - Evidence, Gate, Review Issue, Approval, Revision Acceptance, Approval
//     Bundle and Release Readiness outputs must not leak raw content, secrets,
//     or Chain-of-Thought — only typed references and metadata.
//
// All shared scalars (`UuidV7`, `NamespaceCode`, `ReasonCode`, `UtcInstant`,
// `ContentHash`, etc.) are imported from `common.schema.ts` via the canonical
// `https://schemas.zhiju.local/common/1.0#/$defs/<name>` URL, keeping the
// per-module schema focused on QualityGovernance-specific shapes only.
// =============================================================================

const schemaId = 'https://schemas.zhiju.local/modules/quality-governance/1.0';
const common = 'https://schemas.zhiju.local/common/1.0#/$defs/';
const coreRevisionAcceptance = 'https://schemas.zhiju.local/core/revision-acceptance/1.0';
const coreApprovalBundle = 'https://schemas.zhiju.local/core/approval-bundle/1.0';
const coreReleaseReadiness = 'https://schemas.zhiju.local/core/release-readiness/1.0';

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

function externalRef(target: string) {
  return { $ref: target } as const;
}

const uuid = { $ref: `${common}uuidV7` } as const;
const namespace = { $ref: `${common}namespaceCode` } as const;
const reasonCode = { $ref: `${common}reasonCode` } as const;
const text = { $ref: `${common}nonEmptyString` } as const;
const safeSummary = { $ref: `${common}safeSummary` } as const;
const instant = { $ref: `${common}utcInstant` } as const;
const positiveInt = { $ref: `${common}positiveInteger` } as const;
const contentHash = { $ref: `${common}contentHash` } as const;
const scope = { $ref: `${common}scopeRef` } as const;
const objectReference = { $ref: `${common}objectRef` } as const;
const versionedReference = { $ref: `${common}versionedRef` } as const;
const typedReference = { $ref: `${common}typedReference` } as const;
const contentAddressedReference = { $ref: `${common}contentAddressedRef` } as const;
const snapshotReference = { $ref: `${common}snapshotRef` } as const;
const externalReference = { $ref: `${common}externalRef` } as const;
const evidenceRefCommon = { $ref: `${common}evidenceRef` } as const;
const effectivePeriodCommon = { $ref: `${common}effectivePeriod` } as const;
const representationRefCommon = { $ref: `${common}representationRef` } as const;
const releasePackageRefCommon = { $ref: `${common}releasePackageRef` } as const;
const principalReference = { $ref: `${common}principalRef` } as const;
const canonicalJson = {} as const;

// -----------------------------------------------------------------------------
// Opaque controlled-object-storage locator: bucket-or-container plus key
// segments. A public URL, a scheme prefix, or an absolute local path is
// rejected so that Evidence/Revision content stays inside the governed store.
// -----------------------------------------------------------------------------
const objectLocator = {
  type: 'string',
  pattern: '^[a-z0-9][a-z0-9._-]*(?:/[A-Za-z0-9._-]+)+$',
} as const;

// -----------------------------------------------------------------------------
// Named definitions — shared value objects reused across the 37 operations.
// -----------------------------------------------------------------------------
const namedDefinitions = {
  evidenceStatus: {
    enum: ['CANDIDATE', 'VERIFYING', 'VERIFIED', 'DISPUTED', 'EXPIRED', 'SUPERSEDED', 'REVOKED'],
  },
  gateOutcome: {
    enum: ['PASS', 'FAIL', 'ERROR', 'SKIPPED', 'NOT_APPLICABLE'],
  },
  // evaluationStage re-uses the Core-contract enum (REVISION_ACCEPTANCE |
  // RELEASE_READINESS) so a Gate Submission cannot smuggle a third stage into
  // the readiness evaluator.
  evaluationStage: { $ref: `${common}evaluationStage` },
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
  issueSeverity: { enum: ['CRITICAL', 'MAJOR', 'MINOR', 'INFO'] },
  approvalDecision: { enum: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'] },
  principalKind: {
    enum: ['HUMAN', 'AGENT', 'SERVICE', 'RUNTIME', 'EXTERNAL_PARTY'],
  },
  validityStatus: { enum: ['VALID', 'INVALIDATED', 'SUPERSEDED', 'STALE'] },

  evidenceRef: evidenceRefCommon,
  effectivePeriod: effectivePeriodCommon,
  justification: object(['reasonCode', 'summary', 'evidenceRefs'], {
    reasonCode,
    summary: safeSummary,
    evidenceRefs: array(evidenceRefCommon, { unique: true }),
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
      capturedContentRef: objectLocator,
      capturedContentHash: contentHash,
      authority: namespace,
      jurisdiction: namespace,
      validPeriod: effectivePeriodCommon,
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
      evidenceRefs: array(evidenceRefCommon, { unique: true }),
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
      applicabilityScope: scope,
      linkedAt: instant,
    },
  ),

  qualityProfileDefinition: object(
    ['name', 'profileVersion', 'applicableArtifactTypes', 'gateSpecs', 'approvalRequirements'],
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
      releaseRequirements: array(canonicalJson),
    },
  ),

  // GateTarget is a closed tagged union: REVISION (default), REPRESENTATION
  // (Render Gate), or RELEASE_PACKAGE. Each variant carries the frozen
  // Revision content hash so a Gate Result is always bound to the exact
  // revision content that was evaluated (no "latest" reference is accepted).
  gateTarget: {
    oneOf: [
      object(['kind', 'revisionRef'], {
        kind: { const: 'REVISION' },
        revisionRef: contentAddressedReference,
      }),
      object(['kind', 'revisionRef', 'representationRef'], {
        kind: { const: 'REPRESENTATION' },
        revisionRef: contentAddressedReference,
        representationRef: representationRefCommon,
      }),
      object(['kind', 'revisionRef', 'releasePackageRef'], {
        kind: { const: 'RELEASE_PACKAGE' },
        revisionRef: contentAddressedReference,
        releasePackageRef: releasePackageRefCommon,
      }),
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
      'inputSnapshotRef',
      'outcome',
      'startedAt',
      'completedAt',
    ],
    {
      artifactRef: objectReference,
      gateTarget: localRef('gateTarget'),
      evaluationStage: localRef('evaluationStage'),
      qualityProfileRef: versionedReference,
      gateSpecId: uuid,
      gateVersion: text,
      evaluationAttempt: positiveInt,
      evaluatedScope: canonicalJson,
      inputSnapshotRef: snapshotReference,
      evaluator: canonicalJson,
      outcome: localRef('gateOutcome'),
      findings: array(canonicalJson),
      evidenceRefs: array(evidenceRefCommon, { unique: true }),
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
      evidenceRefs: array(evidenceRefCommon, { unique: true }),
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

  // ApprovalSubmission is the only Command payload that requires a
  // `principalKind: HUMAN` approver and a `SeparationCheck` content-addressed
  // reference. Agent / actingFor Agent submissions are rejected at the
  // structural layer by `approverHumanPrincipalRef.principalKind`.
  approvalSubmission: object(
    [
      'requestRef',
      'revisionRef',
      'revisionAcceptanceSnapshotRef',
      'approvalRequirementId',
      'decision',
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

  revisionAcceptanceEvaluation: object(
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
      gateResultRefs: array(contentAddressedReference, { nonEmpty: true, unique: true }),
      evidenceStatusSnapshotRef: snapshotReference,
      issueSnapshotRef: snapshotReference,
      evaluatorVersions: array(canonicalJson, { nonEmpty: true, unique: true }),
      evaluatedAt: instant,
    },
  ),

  releaseReadinessEvaluation: object(
    [
      'releasePackageRef',
      'approvalBundleSnapshotRef',
      'recipientScopeSnapshotRef',
      'destinationRefs',
      'releaseGateResultRefs',
      'evaluatedAt',
    ],
    {
      releasePackageRef: releasePackageRefCommon,
      approvalBundleSnapshotRef: snapshotReference,
      recipientScopeSnapshotRef: snapshotReference,
      destinationRefs: array(externalReference, { nonEmpty: true, unique: true }),
      releaseGateResultRefs: array(contentAddressedReference, { unique: true }),
      evaluatedAt: instant,
    },
  ),

  // --- Query Result views ----------------------------------------------------
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
      evaluationStage: localRef('evaluationStage'),
      outcome: localRef('gateOutcome'),
      validityStatus: localRef('validityStatus'),
      evidenceRefs: array(evidenceRefCommon, { unique: true }),
      reviewIssueRefs: array(objectReference, { unique: true }),
    },
  ),

  gateResultsPage: object(['items', 'snapshotAt', 'sourceWatermarks'], {
    items: array(localRef('gateResultView')),
    nextCursor: text,
    snapshotAt: instant,
    sourceWatermarks: array(
      object(['sourceModule', 'sequence', 'observedAt'], {
        sourceModule: namespace,
        partition: text,
        sequence: { type: 'integer', minimum: 0 },
        observedAt: instant,
      }),
      { nonEmpty: true, unique: true },
    ),
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

  blockingIssueList: object(['evaluatedAt', 'items'], {
    items: array(localRef('blockingIssueView'), { unique: true }),
    evaluatedAt: instant,
    revisionRef: contentAddressedReference,
    qualityProfileRef: versionedReference,
  }),
} as const satisfies Readonly<Record<string, JsonSchema>>;

// -----------------------------------------------------------------------------
// Operation contracts: 18 Command, 8 Query, 11 Event.
// -----------------------------------------------------------------------------
const operationSchemas = {
  // ===== Commands (18) ======================================================
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
    payload: object(['revocationReason', 'impactAssessmentRef', 'revokedAt'], {
      evidenceRef: contentAddressedReference,
      revocationReason: localRef('justification'),
      impactAssessmentRef: contentAddressedReference,
      revokedAt: instant,
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
    payload: object(['invalidationReason', 'impactAssessmentRef', 'invalidatedAt'], {
      gateResultRef: contentAddressedReference,
      invalidationReason: localRef('justification'),
      impactAssessmentRef: contentAddressedReference,
      invalidatedAt: instant,
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
      proposedBy: principalReference,
    }),
  },
  'quality.verify_issue_resolution': {
    payload: object(['verification'], {
      verification: localRef('issueVerification'),
    }),
  },
  'quality.close_review_issue': {
    payload: object(['verificationRef', 'closeReason', 'closedAt'], {
      reviewIssueRef: objectReference,
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
    payload: object(['revocationReason', 'impactAssessmentRef', 'revokedAt'], {
      approvalRef: contentAddressedReference,
      revocationReason: localRef('justification'),
      impactAssessmentRef: contentAddressedReference,
      revokedAt: instant,
    }),
  },
  'quality.evaluate_revision_readiness': {
    payload: object(['evaluation'], {
      evaluation: localRef('revisionAcceptanceEvaluation'),
    }),
  },
  'quality.evaluate_release_gate_readiness': {
    payload: object(['evaluation'], {
      evaluation: localRef('releaseReadinessEvaluation'),
    }),
  },

  // ===== Queries (8) =======================================================
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
      page: object(['pageSize'], {
        pageSize: positiveInt,
        cursor: text,
      }),
    }),
    result: localRef('gateResultsPage'),
  },
  'quality.get_open_blocking_issues': {
    payload: object(['revisionRef', 'qualityProfileRef'], {
      revisionRef: contentAddressedReference,
      qualityProfileRef: versionedReference,
    }),
    result: localRef('blockingIssueList'),
  },
  // The three Snapshot Queries delegate their Result schema to the Core
  // Contracts (`https://schemas.zhiju.local/core/...`) so the Query envelope
  // and the underlying Contract agree byte-for-byte. Re-declaring the
  // structure here would invite drift between the Query Result and the
  // Snapshot that the Readiness Evaluator actually emits.
  'quality.get_revision_acceptance_snapshot': {
    payload: object(['snapshotRef'], {
      snapshotRef: snapshotReference,
    }),
    result: externalRef(coreRevisionAcceptance),
  },
  'quality.get_approval_bundle_snapshot': {
    payload: object(['snapshotRef'], {
      snapshotRef: snapshotReference,
    }),
    result: externalRef(coreApprovalBundle),
  },
  'quality.get_release_readiness_snapshot': {
    payload: object(['snapshotRef'], {
      snapshotRef: snapshotReference,
    }),
    result: externalRef(coreReleaseReadiness),
  },

  // ===== Events (11) =======================================================
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
      releasePackageRef: releasePackageRefCommon,
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
        releasePackageRef: releasePackageRefCommon,
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
    Object.entries(operationSchemas).map(([type, contract]) => {
      const base: ExecutableQualityOperationContract = {
        payloadSchemaRef: `${schemaId}#/$defs/${operationDefinitionName(type, 'payload')}`,
      };
      const full =
        'result' in contract
          ? {
              ...base,
              resultSchemaRef: `${schemaId}#/$defs/${operationDefinitionName(type, 'result')}`,
            }
          : base;
      return [type, full];
    }),
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
