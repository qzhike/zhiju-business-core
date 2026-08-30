// IM-05 WI-04 (issue #124): synthetic technical PostgreSQL evidence for
// ReviewIssue remediation, Human Approval, immutable snapshots, RLS, ACL,
// exact references, event provenance, and transaction rollback.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Common, Core, QualityGovernance } from '@zhiju/contracts';
import { ContractRegistry } from '../../contracts/src/registry.js';
import {
  createQualityGovernanceDatabase,
  executeQualityGovernanceCommand,
  handleActivateQualityProfile,
  handleCloseReviewIssue,
  handleCreateQualityProfileDraft,
  handleEvaluateRevisionReadiness,
  handleGetApprovalBundleSnapshot,
  handleGetOpenBlockingIssues,
  handleProposeIssueResolution,
  handleRecordGateResult,
  handleRaiseReviewIssue,
  handleRequestApproval,
  handleSubmitApprovalDecision,
  handleRevokeApproval,
  handleVerifyIssueResolution,
  QualityBusinessRepository,
  validateReviewIssueDefinition,
  withQualityGovernanceTransaction,
  type CommandEnvelope,
  type CommandResult,
  type QualityCommandEnvelope,
  type QualityTransactionContext,
} from '@zhiju/quality-governance';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);
const registry = new ContractRegistry();

const ENTERPRISE = '0190a1b2-c3d4-7e81-8f90-123456789001';
const PROJECT = '0190a1b2-c3d4-7e81-8f90-123456789002';
const OTHER_ENTERPRISE = '0190a1b2-c3d4-7e81-8f90-123456789003';
const RAISED_BY = '0190a1b2-c3d4-7e81-8f90-123456789004';
const RAISED_ACTOR = '0190a1b2-c3d4-7e81-8f90-123456789005';
const RAISED_DECISION = '0190a1b2-c3d4-7e81-8f90-123456789006';
const RAISED_POLICY = '0190a1b2-c3d4-7e81-8f90-123456789007';
const RAISED_CORRELATION = '0190a1b2-c3d4-7e81-8f90-123456789008';
const VERIFYING_BY = '0190a1b2-c3d4-7e81-8f90-123456789009';
const VERIFYING_ACTOR = '0190a1b2-c3d4-7e81-8f90-12345678900a';
const VERIFYING_DECISION = '0190a1b2-c3d4-7e81-8f90-12345678900b';
const VERIFYING_CORRELATION = '0190a1b2-c3d4-7e81-8f90-12345678900c';
const APPROVING_BY = '0190a1b2-c3d4-7e81-8f90-12345678900d';
const APPROVING_ACTOR = '0190a1b2-c3d4-7e81-8f90-12345678900e';
const APPROVING_DECISION = '0190a1b2-c3d4-7e81-8f90-12345678900f';
const APPROVING_CORRELATION = '0190a1b2-c3d4-7e81-8f90-123456789010';
const SECOND_APPROVER = '0190a1b2-c3d4-7e81-8f90-123456789011';
const SECOND_APPROVER_ACTOR = '0190a1b2-c3d4-7e81-8f90-123456789012';
const SECOND_APPROVER_DECISION = '0190a1b2-c3d4-7e81-8f90-123456789013';
const SECOND_APPROVER_CORRELATION = '0190a1b2-c3d4-7e81-8f90-123456789014';
const ARTIFACT_ID = '0190a1b2-c3d4-7e81-8f90-123456789015';
const ORIGIN_REVISION_ID = '0190a1b2-c3d4-7e81-8f90-123456789016';
const REMEDIATED_REVISION_ID = '0190a1b2-c3d4-7e81-8f90-123456789017';
const PROBE_ROLE = 'im05_wi04_probe';
const PROBE_PASSWORD = 'im05-wi04-probe';

function contextFor(
  principalId = RAISED_BY,
  actorSnapshotId = RAISED_ACTOR,
  authorizationDecisionId = RAISED_DECISION,
  policySnapshotId = RAISED_POLICY,
  correlationId = RAISED_CORRELATION,
  principalKind: QualityTransactionContext['principalKind'] = 'HUMAN',
): QualityTransactionContext {
  return {
    kind: 'REQUEST',
    principalId,
    principalKind,
    actorSnapshotId,
    authorizationDecisionId,
    authorizationDecisionHash: Buffer.alloc(32, 0x21),
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId,
    enterpriseId: ENTERPRISE,
    allowedProjectIds: [PROJECT],
    correlationId,
  };
}

function hash(byte: number): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: Buffer.alloc(32, byte).toString('hex'),
    canonicalizationVersion: '1',
  };
}

function contentRef(
  objectType: string,
  objectId: string,
  byte: number,
  projectId = PROJECT,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    scope: { enterpriseId: ENTERPRISE, projectId },
    contentHash: hash(byte),
  };
}

function objectRef(objectType: string, objectId: string): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
  };
}

function snapshotRef(objectType: string, byte: number): Common.SnapshotRef {
  const snapshotId = newUuidV7();
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: newUuidV7(),
    snapshotId,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    contentHash: hash(byte),
  };
}

function enterpriseSnapshotRef(objectType: string, byte: number): Common.SnapshotRef {
  const snapshotId = newUuidV7();
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: newUuidV7(),
    snapshotId,
    scope: { enterpriseId: ENTERPRISE },
    contentHash: hash(byte),
  };
}

function principalRef(principalId: string): Common.PrincipalRef {
  return { principalKind: 'HUMAN', principalId };
}

function profileGate(
  gateSpecId: string,
  evaluationStage: QualityGovernance.EvaluationStage,
  inputObjectType: string,
): CanonicalJsonObject {
  return {
    gateSpecId,
    gateType: evaluationStage === 'REVISION_ACCEPTANCE' ? 'STRUCTURAL_SCHEMA' : 'RENDER',
    gateVersion: '1.0.0',
    evaluationStage,
    mandatory: true,
    applicabilityRule: { kind: 'always' },
    inputContract: { objectType: inputObjectType },
    evaluatorPolicy: { principalKind: 'SERVICE' },
    passCriteria: { outcome: 'PASS' },
    failureSeverity: 'MAJOR',
    blockingRule: { outcomes: ['FAIL', 'ERROR'] },
    dependencyGateSpecIds: [],
    rerunRule: { onChange: 'IMPACT_ANALYSIS' },
    resultRetentionRule: { retain: 'regulated' },
  };
}

function profileDefinition(
  revisionGateId: string,
  representationGateId: string,
  packageGateId: string,
  name: string,
): QualityGovernance.QualityProfileDefinition {
  return {
    name,
    profileVersion: '4.0.0',
    applicableArtifactTypes: ['artifact.dhf_section'],
    riskApplicability: { riskLevels: ['MEDIUM'] },
    gateSpecs: [
      profileGate(revisionGateId, 'REVISION_ACCEPTANCE', 'ArtifactRevision'),
      profileGate(representationGateId, 'RELEASE_READINESS', 'Representation'),
      profileGate(packageGateId, 'RELEASE_READINESS', 'ReleasePackage'),
    ],
    gateDependencies: [],
    rerunPolicy: { allowImpactReuse: true, reusableOutcomes: ['PASS'] },
    issuePolicy: { blockingLevels: ['CRITICAL', 'MAJOR'] },
    separationOfDutiesPolicy: { authorMayReviewOwnWork: false },
    approvalRequirements: [
      { requiredRole: 'quality.reviewer', requiredCount: 2, approverKind: 'HUMAN' },
    ],
    releaseRequirements: [
      {
        purpose: 'formal_release',
        formats: ['DOCX'],
        recipientScope: { enterpriseId: ENTERPRISE },
        validity: { validFrom: '2026-01-01T00:00:00Z', validTo: '2027-01-01T00:00:00Z' },
        receiptRequired: true,
      },
    ],
  };
}

function committed(result: CommandResult): CanonicalJsonObject {
  expect(result.status).toBe('COMMITTED');
  if (result.status !== 'COMMITTED') throw new Error(`expected COMMITTED, got ${result.status}`);
  return result.resultPayload;
}

function resultRef(payload: CanonicalJsonObject, key: string): Common.TypedReference {
  const value = payload[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${key} is not a typed reference`);
  }
  return value as unknown as Common.TypedReference;
}

function envelope<TPayload extends object>(
  current: QualityTransactionContext,
  targetType: string,
  targetId: string,
  payload: TPayload,
  overrides: Partial<CommandEnvelope> = {},
): QualityCommandEnvelope<TPayload> {
  const commandType = `quality.${targetType}`;
  return {
    commandId: newUuidV7(),
    commandType,
    commandVersion: '1.0',
    idempotencyScope: 'im05.wi04',
    idempotencyKey: `${targetType}:${targetId}:${newUuidV7()}`,
    requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
    enterpriseId: current.enterpriseId,
    ...(targetType === 'quality.quality_profile' ? {} : { projectId: PROJECT }),
    targetType,
    targetId,
    correlationId: current.correlationId,
    principalId: current.principalId,
    principalKind: current.principalKind,
    actorSnapshotId: current.actorSnapshotId,
    authorizationDecisionId: current.authorizationDecisionId,
    policySnapshotId: current.policySnapshotId,
    ...overrides,
    payload,
  };
}

interface ProfileFixture {
  readonly profileRef: Common.VersionedRef;
  readonly revisionGateId: string;
  readonly approvalRequirementId: string;
}

interface GateFixture {
  readonly gateResultId: string;
  readonly gateResultRef: Common.ContentAddressedRef;
}

interface ReadinessFixture {
  readonly snapshotRef: Common.SnapshotRef;
  readonly snapshot: Core.RevisionAcceptanceSnapshot;
}

interface SqlOutcome {
  readonly allowed: boolean;
  readonly code?: string;
}

describe.skipIf(!gateEnabled)('QualityGovernance WI-04 business persistence', () => {
  let admin: pg.Client;
  let probe: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createQualityGovernanceDatabase>;
  const businessRepository = new QualityBusinessRepository();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl ?? '' });
    await admin.connect();
    await admin.query(
      `CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${PROBE_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(
      `GRANT platform_context_establisher, quality_governance_app TO ${PROBE_ROLE}`,
    );
    const url = new URL(databaseUrl ?? '');
    url.username = PROBE_ROLE;
    url.password = PROBE_PASSWORD;
    probe = new pg.Client({ connectionString: url.toString() });
    await probe.connect();
    pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
    db = createQualityGovernanceDatabase(pool);
  });

  afterAll(async () => {
    await probe.end();
    await pool.end();
    await admin.query(`DROP ROLE ${PROBE_ROLE}`);
    await admin.end();
  });

  async function establish(client: pg.Client, current: QualityTransactionContext): Promise<void> {
    await client.query('SET LOCAL ROLE platform_context_establisher');
    await client.query(
      `SELECT platform_security.establish_transaction_context(
      'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
      [
        current.principalId,
        current.actorSnapshotId,
        current.authorizationDecisionId,
        current.authorizationDecisionHash,
        current.authorizationDecisionExpiresAt,
        current.enterpriseId,
        [...current.allowedProjectIds],
        current.correlationId,
      ],
    );
    await client.query('SET LOCAL ROLE quality_governance_app');
  }

  async function probeTrySql(
    current: QualityTransactionContext,
    text: string,
    values: unknown[] = [],
  ): Promise<SqlOutcome> {
    await probe.query('BEGIN');
    try {
      await establish(probe, current);
      await probe.query(text, values);
      await probe.query('ROLLBACK');
      return { allowed: true };
    } catch (error) {
      const code = (error as pg.DatabaseError).code;
      await probe.query('ROLLBACK');
      return { allowed: false, ...(code === undefined ? {} : { code }) };
    }
  }

  async function probeCount(
    current: QualityTransactionContext,
    text: string,
    values: unknown[] = [],
  ): Promise<number> {
    await probe.query('BEGIN');
    try {
      await establish(probe, current);
      const result = await probe.query<{ count: string }>(text, values);
      await probe.query('ROLLBACK');
      return Number(result.rows[0]?.count ?? '-1');
    } catch (error) {
      await probe.query('ROLLBACK');
      throw error;
    }
  }

  async function ownerTrySql(text: string, values: unknown[] = []): Promise<SqlOutcome> {
    await admin.query('BEGIN');
    try {
      await admin.query('SET LOCAL ROLE quality_governance_owner');
      await admin.query(text, values);
      await admin.query('ROLLBACK');
      return { allowed: true };
    } catch (error) {
      const code = (error as pg.DatabaseError).code;
      await admin.query('ROLLBACK');
      return { allowed: false, ...(code === undefined ? {} : { code }) };
    }
  }

  async function createProfile(current: QualityTransactionContext): Promise<ProfileFixture> {
    const profileId = newUuidV7();
    const revisionGateId = newUuidV7();
    const representationGateId = newUuidV7();
    const packageGateId = newUuidV7();
    const definition = profileDefinition(
      revisionGateId,
      representationGateId,
      packageGateId,
      `QMS_WI04_${profileId}`,
    );
    const draft = await handleCreateQualityProfileDraft(
      db,
      current,
      envelope(current, 'quality.quality_profile', profileId, { definition }),
    );
    const draftPayload = committed(draft);
    const profileRef = resultRef(draftPayload, 'qualityProfileRef') as Common.VersionedRef;
    const activation = await handleActivateQualityProfile(
      db,
      current,
      envelope(
        current,
        'quality.quality_profile',
        profileId,
        {
          profileVersionRef: profileRef,
          reviewSnapshotRef: enterpriseSnapshotRef('quality.quality_profile_review', 0x11),
          validationSnapshotRef: enterpriseSnapshotRef('quality.quality_profile_validation', 0x12),
          activatedAt: '2026-08-30T00:10:00Z',
        },
        { expectedAggregateVersion: '1' },
      ),
    );
    expect(committed(activation)).toMatchObject({ status: 'ACTIVE' });
    const requirements = await withQualityGovernanceTransaction(db, current, (trx) =>
      businessRepository.getQualityProfileApprovalRequirements(trx, profileRef.versionId),
    );
    expect(requirements).toHaveLength(1);
    const approvalRequirementId = requirements[0]?.approval_requirement_id;
    if (approvalRequirementId === undefined)
      throw new Error('approval requirement was not persisted');
    return { profileRef, revisionGateId, approvalRequirementId };
  }

  async function recordGate(
    current: QualityTransactionContext,
    profile: ProfileFixture,
    revisionRef: Common.ContentAddressedRef,
    evaluatedAt: string,
  ): Promise<GateFixture> {
    const gateResultId = newUuidV7();
    const submission: QualityGovernance.GateResultSubmission = {
      artifactRef: objectRef('artifact.artifact', ARTIFACT_ID),
      gateTarget: { kind: 'REVISION', revisionRef },
      evaluationStage: 'REVISION_ACCEPTANCE',
      qualityProfileRef: profile.profileRef,
      gateSpecId: profile.revisionGateId,
      gateVersion: '1.0.0',
      evaluationAttempt: 1,
      evaluatedScope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
      inputSnapshotRef: snapshotRef('quality.gate_input', 0x20),
      evaluator: { evaluatorId: 'synthetic_gate', evaluatorVersion: '1.0.0' },
      outcome: 'PASS',
      findings: [],
      evidenceRefs: [],
      startedAt: evaluatedAt,
      completedAt: evaluatedAt,
    };
    const result = await handleRecordGateResult(
      db,
      current,
      envelope(current, 'quality.gate_result', gateResultId, { submission }),
    );
    const payload = committed(result);
    return {
      gateResultId,
      gateResultRef: resultRef(payload, 'gateResultRef') as Common.ContentAddressedRef,
    };
  }

  async function evaluateReadiness(
    current: QualityTransactionContext,
    profile: ProfileFixture,
    revisionRef: Common.ContentAddressedRef,
    gateResultRef: Common.ContentAddressedRef,
    evaluatedAt: string,
  ): Promise<ReadinessFixture> {
    const result = await handleEvaluateRevisionReadiness(
      db,
      current,
      envelope(current, 'quality.revision_acceptance_snapshot', newUuidV7(), {
        revisionRef,
        qualityProfileRef: profile.profileRef,
        gateResultRefs: [gateResultRef],
        evidenceStatusSnapshotRef: snapshotRef('quality.evidence_status_snapshot', 0x30),
        issueSnapshotRef: snapshotRef('quality.issue_snapshot', 0x31),
        evaluatorVersions: [{ evaluatorId: 'synthetic_readiness', evaluatorVersion: '1.0.0' }],
        evaluatedAt,
      }),
    );
    const payload = committed(result);
    const snapshot = payload.snapshot as unknown as Core.RevisionAcceptanceSnapshot;
    const rasContract = registry.validateCoreContract(
      'https://schemas.zhiju.local/core/revision-acceptance/1.0',
      snapshot,
    );
    expect(rasContract, JSON.stringify(rasContract.errors, null, 2)).toMatchObject({ valid: true });
    expect(payload.readinessStatus).toBe('READY');
    return {
      snapshotRef: resultRef(payload, 'snapshotRef') as Common.SnapshotRef,
      snapshot,
    };
  }

  function approvalSubmission(
    current: QualityTransactionContext,
    requestRef: Common.ObjectRef,
    revisionRef: Common.ContentAddressedRef,
    revisionAcceptanceSnapshotRef: Common.SnapshotRef,
    approvalRequirementId: string,
    decidedAt: string,
  ): QualityGovernance.ApprovalSubmission {
    return {
      requestRef,
      revisionRef,
      revisionAcceptanceSnapshotRef,
      approvalRequirementId,
      decision: 'APPROVED',
      decisionComment: 'Synthetic independent Human approval for technical verification.',
      approverHumanPrincipalRef: { principalKind: 'HUMAN', principalId: current.principalId },
      approverRoleSnapshotRef: snapshotRef('identity.role_assignment', 0x61),
      authorizationDecisionRef: contentRef('identity.authorization_decision', newUuidV7(), 0x62),
      separationCheckRef: contentRef('quality.separation_check', newUuidV7(), 0x63),
      decidedAt,
    };
  }

  it('keeps ReviewIssue remediation and Human Approval exact, immutable, and auditable', async () => {
    const raiser = contextFor();
    const verifier = contextFor(
      VERIFYING_BY,
      VERIFYING_ACTOR,
      VERIFYING_DECISION,
      RAISED_POLICY,
      VERIFYING_CORRELATION,
    );
    const firstApprover = contextFor(
      APPROVING_BY,
      APPROVING_ACTOR,
      APPROVING_DECISION,
      RAISED_POLICY,
      APPROVING_CORRELATION,
    );
    const secondApprover = contextFor(
      SECOND_APPROVER,
      SECOND_APPROVER_ACTOR,
      SECOND_APPROVER_DECISION,
      RAISED_POLICY,
      SECOND_APPROVER_CORRELATION,
    );
    const profile = await createProfile(raiser);
    const originRevisionRef = contentRef('artifact.artifact_revision', ORIGIN_REVISION_ID, 0x41);
    const remediatedRevisionRef = contentRef(
      'artifact.artifact_revision',
      REMEDIATED_REVISION_ID,
      0x42,
    );
    const originGate = await recordGate(raiser, profile, originRevisionRef, '2026-08-30T00:11:00Z');
    const remediatedGate = await recordGate(
      raiser,
      profile,
      remediatedRevisionRef,
      '2026-08-30T00:12:00Z',
    );
    const remediatedReadiness = await evaluateReadiness(
      raiser,
      profile,
      remediatedRevisionRef,
      remediatedGate.gateResultRef,
      '2026-08-30T00:13:00Z',
    );

    const issueId = newUuidV7();
    const issueDefinition: QualityGovernance.ReviewIssueDefinition = {
      artifactRef: objectRef('artifact.artifact', ARTIFACT_ID),
      originRevisionRef,
      originGateResultRef: originGate.gateResultRef,
      issueType: 'quality.structural_defect',
      severity: 'MAJOR',
      blockingClassification: 'release_blocking',
      statement: 'Synthetic blocking issue for ReviewIssue remediation.',
      locator: 'claims/1',
      evidenceRefs: [],
      raisedAt: '2026-08-30T00:14:00Z',
    };
    const raiseCommand = envelope(raiser, 'quality.review_issue', issueId, {
      definition: issueDefinition,
    });
    const raised = committed(await handleRaiseReviewIssue(db, raiser, raiseCommand));
    expect(raised).toMatchObject({ status: 'OPEN', aggregateVersion: '1' });
    const issueRef = resultRef(raised, 'reviewIssueRef') as Common.ObjectRef;
    const openBefore = await handleGetOpenBlockingIssues(db, raiser, {
      revisionRef: originRevisionRef,
      qualityProfileRef: profile.profileRef,
    });
    expect(openBefore).toHaveLength(1);
    expect(openBefore[0]?.reviewIssueRef).toEqual(issueRef);

    const resolutionPayload = {
      resolution: {
        targetRevisionRef: remediatedRevisionRef,
        changedClaimRefs: [],
        explanation: 'Synthetic remediation creates a distinct exact Revision.',
        proposedAt: '2026-08-30T00:15:00Z',
      },
      proposedBy: principalRef(RAISED_BY),
    };
    const resolutionResults = await Promise.all(
      [
        envelope(raiser, 'quality.review_issue', issueId, resolutionPayload),
        envelope(raiser, 'quality.review_issue', issueId, resolutionPayload),
      ].map((command) =>
        handleProposeIssueResolution(db, raiser, {
          ...command,
          expectedAggregateVersion: '1',
        }),
      ),
    );
    expect(resolutionResults.filter((result) => result.status === 'COMMITTED')).toHaveLength(1);
    expect(resolutionResults.filter((result) => result.status === 'REJECTED')).toHaveLength(1);
    expect(resolutionResults.find((result) => result.status === 'REJECTED')).toMatchObject({
      status: 'REJECTED',
      errorCode: 'CONCURRENCY_CONFLICT',
      currentAggregateVersion: '2',
    });
    const committedResolution = resolutionResults.find((result) => result.status === 'COMMITTED');
    if (committedResolution?.status !== 'COMMITTED')
      throw new Error('concurrent Resolution Proposal did not produce a committed winner');
    const resolution = committedResolution.resultPayload;
    expect(resolution).toMatchObject({ status: 'RESOLUTION_PROPOSED', aggregateVersion: '2' });
    const resolutionRef = resultRef(resolution, 'resolutionRef') as Common.ContentAddressedRef;

    const selfVerification = await handleVerifyIssueResolution(db, raiser, {
      ...envelope(raiser, 'quality.review_issue', issueId, {
        verification: {
          targetRevisionRef: remediatedRevisionRef,
          verifier: principalRef(RAISED_BY),
          verificationMethod: 'manual_review',
          supportingGateResultRefs: [remediatedGate.gateResultRef],
          outcome: 'VERIFIED',
          verifiedAt: '2026-08-30T00:16:00Z',
        },
      }),
      expectedAggregateVersion: '2',
    });
    expect(selfVerification).toMatchObject({
      status: 'REJECTED',
      errorCode: 'QUALITY_SEPARATION_OF_DUTIES_VIOLATION',
    });
    expect(resolutionRef.objectId).toEqual(expect.any(String));

    const verification = committed(
      await handleVerifyIssueResolution(db, verifier, {
        ...envelope(verifier, 'quality.review_issue', issueId, {
          verification: {
            targetRevisionRef: remediatedRevisionRef,
            verifier: principalRef(VERIFYING_BY),
            verificationMethod: 'manual_review',
            supportingGateResultRefs: [remediatedGate.gateResultRef],
            outcome: 'VERIFIED',
            verifiedAt: '2026-08-30T00:17:00Z',
          },
        }),
        expectedAggregateVersion: '2',
      }),
    );
    expect(verification).toMatchObject({ status: 'VERIFIED', aggregateVersion: '3' });
    const verificationRef = resultRef(
      verification,
      'verificationRef',
    ) as Common.ContentAddressedRef;
    expect(
      await handleGetOpenBlockingIssues(db, verifier, {
        revisionRef: originRevisionRef,
        qualityProfileRef: profile.profileRef,
      }),
    ).toHaveLength(1);

    const closeCommand = envelope(verifier, 'quality.review_issue', issueId, {
      verificationRef,
      closeReason: {
        reasonCode: 'QUALITY_REMEDIATION_VERIFIED',
        summary: 'Independent Human verification confirms the exact remediation.',
        evidenceRefs: [],
      },
      closedAt: '2026-08-30T00:18:00Z',
    });
    const close = committed(
      await handleCloseReviewIssue(db, verifier, {
        ...closeCommand,
        expectedAggregateVersion: '3',
      }),
    );
    expect(close).toMatchObject({ status: 'CLOSED', aggregateVersion: '4' });
    expect(
      await handleGetOpenBlockingIssues(db, verifier, {
        revisionRef: originRevisionRef,
        qualityProfileRef: profile.profileRef,
      }),
    ).toHaveLength(0);

    const issueHistory = await withQualityGovernanceTransaction(db, verifier, async (trx) => ({
      issue: await businessRepository.getReviewIssueById(trx, issueId),
      observations: await businessRepository.getIssueObservations(trx, issueId),
      resolutions: await businessRepository.getResolutionProposals(trx, issueId),
      verifications: await businessRepository.getVerificationRecords(trx, issueId),
      transitions: await businessRepository.getIssueStateTransitions(trx, issueId),
    }));
    expect(issueHistory.issue).toMatchObject({ status: 'CLOSED', aggregate_version: '4' });
    expect(issueHistory.observations).toHaveLength(1);
    expect(issueHistory.resolutions).toHaveLength(1);
    expect(issueHistory.verifications).toHaveLength(1);
    expect(issueHistory.transitions).toHaveLength(3);
    expect(issueHistory.transitions.map((item) => item.to_status)).toEqual([
      'RESOLUTION_PROPOSED',
      'VERIFIED',
      'CLOSED',
    ]);

    const requestId = newUuidV7();
    const requestCommand = envelope(verifier, 'quality.approval_request', requestId, {
      definition: {
        artifactRef: objectRef('artifact.artifact', ARTIFACT_ID),
        revisionRef: remediatedRevisionRef,
        revisionAcceptanceSnapshotRef: remediatedReadiness.snapshotRef,
        qualityProfileRef: profile.profileRef,
        approvalRequirementId: profile.approvalRequirementId,
        requestedApproverRole: 'quality.reviewer',
        expiresAt: '2026-12-31T00:00:00Z',
        requestNonceHash: hash(0x51),
      },
    });
    const request = committed(await handleRequestApproval(db, verifier, requestCommand));
    expect(request).toMatchObject({ status: 'OPEN', aggregateVersion: '1' });
    const requestRef = resultRef(request, 'requestRef') as Common.ObjectRef;

    for (const principalKind of ['AGENT', 'SERVICE', 'RUNTIME'] as const) {
      const untrustedContext = contextFor(
        newUuidV7(),
        newUuidV7(),
        newUuidV7(),
        RAISED_POLICY,
        newUuidV7(),
        principalKind,
      );
      const deniedImpersonation = await handleSubmitApprovalDecision(db, untrustedContext, {
        ...envelope(untrustedContext, 'quality.approval_request', requestId, {
          // A non-Human trusted context cannot be upgraded by a declared Human payload.
          submission: approvalSubmission(
            firstApprover,
            requestRef,
            remediatedRevisionRef,
            remediatedReadiness.snapshotRef,
            profile.approvalRequirementId,
            '2026-08-30T00:19:00Z',
          ),
        }),
      });
      expect(deniedImpersonation).toMatchObject({
        status: 'REJECTED',
        errorCode: 'QUALITY_APPROVAL_AGENT_FORBIDDEN',
      });
    }

    const firstApprovalCommand = envelope(firstApprover, 'quality.approval_request', requestId, {
      submission: approvalSubmission(
        firstApprover,
        requestRef,
        remediatedRevisionRef,
        remediatedReadiness.snapshotRef,
        profile.approvalRequirementId,
        '2026-08-30T00:20:00Z',
      ),
    });
    const firstApproval = committed(
      await handleSubmitApprovalDecision(db, firstApprover, firstApprovalCommand),
    );
    expect(firstApproval).toMatchObject({
      status: 'EFFECTIVE',
      completeness: { status: 'PARTIALLY_APPROVED' },
    });
    const firstBundleRef = resultRef(
      firstApproval,
      'approvalBundleSnapshotRef',
    ) as Common.SnapshotRef;
    const firstBundle = await handleGetApprovalBundleSnapshot(db, firstApprover, {
      snapshotRef: firstBundleRef,
    });
    expect(firstBundle.completeness.status).toBe('PARTIALLY_APPROVED');
    expect(
      registry.validateCoreContract(
        'https://schemas.zhiju.local/core/approval-bundle/1.0',
        firstBundle,
      ),
    ).toMatchObject({ valid: true });
    const firstApprovalRef = resultRef(firstApproval, 'approvalRef') as Common.ContentAddressedRef;

    const secondApprovalCommand = envelope(secondApprover, 'quality.approval_request', requestId, {
      submission: approvalSubmission(
        secondApprover,
        requestRef,
        remediatedRevisionRef,
        remediatedReadiness.snapshotRef,
        profile.approvalRequirementId,
        '2026-08-30T00:21:00Z',
      ),
    });
    const secondApproval = committed(
      await handleSubmitApprovalDecision(db, secondApprover, secondApprovalCommand),
    );
    expect(secondApproval).toMatchObject({
      status: 'EFFECTIVE',
      completeness: { status: 'FULLY_APPROVED', reasons: [] },
    });
    const fullBundleRef = resultRef(
      secondApproval,
      'approvalBundleSnapshotRef',
    ) as Common.SnapshotRef;
    const fullBundle = await handleGetApprovalBundleSnapshot(db, secondApprover, {
      snapshotRef: fullBundleRef,
    });
    expect(fullBundle.completeness.status).toBe('FULLY_APPROVED');
    expect(fullBundle.approvalRefs).toHaveLength(2);
    expect(
      registry.validateCoreContract(
        'https://schemas.zhiju.local/core/approval-bundle/1.0',
        fullBundle,
      ),
    ).toMatchObject({ valid: true });
    const secondApprovalRef = resultRef(
      secondApproval,
      'approvalRef',
    ) as Common.ContentAddressedRef;

    const duplicateApproval = await handleSubmitApprovalDecision(db, firstApprover, {
      ...envelope(firstApprover, 'quality.approval_request', requestId, {
        submission: approvalSubmission(
          firstApprover,
          requestRef,
          remediatedRevisionRef,
          remediatedReadiness.snapshotRef,
          profile.approvalRequirementId,
          '2026-08-30T00:21:30Z',
        ),
      }),
    });
    expect(duplicateApproval).toMatchObject({
      status: 'REJECTED',
      errorCode: 'QUALITY_APPROVAL_IDENTITY_CONFLICT',
    });

    const ownerReviewUpdate = await ownerTrySql(
      'UPDATE quality_governance.review_issue SET statement = statement WHERE review_issue_id = $1',
      [issueId],
    );
    const ownerReviewDelete = await ownerTrySql(
      'DELETE FROM quality_governance.review_issue WHERE review_issue_id = $1',
      [issueId],
    );
    const ownerResolutionDelete = await ownerTrySql(
      'DELETE FROM quality_governance.resolution_proposal WHERE review_issue_id = $1',
      [issueId],
    );
    const ownerApprovalUpdate = await ownerTrySql(
      'UPDATE quality_governance.approval SET status = status WHERE approval_id = $1',
      [secondApprovalRef.objectId],
    );
    expect(ownerReviewUpdate).toMatchObject({ allowed: false, code: '55000' });
    expect(ownerReviewDelete).toMatchObject({ allowed: false, code: '55000' });
    expect(ownerResolutionDelete).toMatchObject({ allowed: false, code: '55000' });
    expect(ownerApprovalUpdate).toMatchObject({ allowed: false, code: '55000' });

    const revoke = committed(
      await handleRevokeApproval(db, secondApprover, {
        ...envelope(secondApprover, 'quality.approval', secondApprovalRef.objectId, {
          revocationReason: {
            reasonCode: 'QUALITY_APPROVAL_REVOKED',
            summary: 'Synthetic upstream impact invalidates one approval.',
            evidenceRefs: [],
          },
          impactAssessmentRef: contentRef('quality.impact_assessment', newUuidV7(), 0x71),
          revokedAt: '2026-08-30T00:22:00Z',
        }),
        expectedAggregateVersion: '1',
      }),
    );
    expect(revoke).toMatchObject({ status: 'REVOKED', aggregateVersion: '2' });
    const staleBundleRef = resultRef(
      revoke,
      'staleApprovalBundleSnapshotRef',
    ) as Common.SnapshotRef;
    const staleBundle = await handleGetApprovalBundleSnapshot(db, secondApprover, {
      snapshotRef: staleBundleRef,
    });
    expect(staleBundle.completeness).toEqual({
      status: 'STALE',
      reasons: ['QUALITY_APPROVAL_REVOKED'],
    });
    expect(staleBundle.approvalRefs).toHaveLength(2);
    expect(
      await handleGetApprovalBundleSnapshot(db, secondApprover, {
        snapshotRef: fullBundleRef,
      }),
    ).toMatchObject({ completeness: { status: 'FULLY_APPROVED' } });

    const histories = await withQualityGovernanceTransaction(db, secondApprover, async (trx) => ({
      request: await businessRepository.getApprovalRequestById(trx, requestId),
      approvals: await businessRepository.getApprovals(trx),
      decisions: await businessRepository.getApprovalDecisions(trx, secondApprovalRef.objectId),
      revocations: await businessRepository.getApprovalRevocations(trx, secondApprovalRef.objectId),
      bundles: await businessRepository.getApprovalBundleSnapshots(trx),
    }));
    const targetApprovals = histories.approvals.filter((item) => item.request_id === requestId);
    const targetBundles = histories.bundles.filter((item) => item.revision_ref !== null);
    expect(histories.request).toMatchObject({ status: 'OPEN' });
    expect(targetApprovals).toHaveLength(2);
    expect(
      targetApprovals.find((item) => item.approval_id === secondApprovalRef.objectId),
    ).toMatchObject({
      status: 'REVOKED',
      aggregate_version: '2',
    });
    expect(histories.decisions).toHaveLength(1);
    expect(histories.revocations).toHaveLength(1);
    expect(targetBundles.length).toBeGreaterThanOrEqual(3);

    const probeContext = contextFor();
    const directInsert = await probeTrySql(
      probeContext,
      'INSERT INTO quality_governance.review_issue (review_issue_id, enterprise_id) VALUES ($1, $2)',
      [newUuidV7(), ENTERPRISE],
    );
    expect(directInsert).toMatchObject({ allowed: false, code: '42501' });
    const hiddenRows = await probeCount(
      probeContext,
      'SELECT count(*)::text AS count FROM quality_governance.review_issue WHERE enterprise_id = $1',
      [OTHER_ENTERPRISE],
    );
    expect(hiddenRows).toBe(0);

    const eventRows = await admin.query<{ event_type: string }>(
      `SELECT event_type
       FROM quality_governance.outbox_event
       WHERE source_command_id = ANY($1::uuid[])
       ORDER BY occurred_at, event_id`,
      [[closeCommand.commandId, secondApprovalCommand.commandId]],
    );
    const issueEventRows = await admin.query<{ event_type: string }>(
      `SELECT event_type
       FROM quality_governance.outbox_event
       WHERE aggregate_id = $1
       ORDER BY occurred_at, event_id`,
      [issueId],
    );
    const approvalEventRows = await admin.query<{ event_type: string }>(
      `SELECT event_type
       FROM quality_governance.outbox_event
       WHERE aggregate_id = $1
       ORDER BY occurred_at, event_id`,
      [secondApprovalRef.objectId],
    );
    const requestEventRows = await admin.query<{ event_type: string }>(
      `SELECT event_type
       FROM quality_governance.outbox_event
       WHERE aggregate_id = $1
       ORDER BY occurred_at, event_id`,
      [requestId],
    );
    expect(eventRows.rows.map((row) => row.event_type)).toEqual([
      'quality.ReviewIssueClosed',
      'quality.RevisionFullyApproved',
    ]);
    expect(issueEventRows.rows.map((row) => row.event_type)).toContain(
      'quality.BlockingReviewIssueRaised',
    );
    expect(issueEventRows.rows.map((row) => row.event_type)).toContain('quality.ReviewIssueClosed');
    expect(approvalEventRows.rows.map((row) => row.event_type)).toContain(
      'quality.RevisionApprovalLost',
    );
    expect(requestEventRows.rows.map((row) => row.event_type)).toContain(
      'quality.RevisionFullyApproved',
    );
    expect(firstApprovalRef.objectId).not.toBe(secondApprovalRef.objectId);
  }, 15000);

  it('rolls back ReviewIssue business facts and the command receipt after a post-write fault', async () => {
    const current = contextFor();
    const issueId = newUuidV7();
    const definition: QualityGovernance.ReviewIssueDefinition = {
      artifactRef: objectRef('artifact.artifact', newUuidV7()),
      originRevisionRef: contentRef('artifact.artifact_revision', newUuidV7(), 0x81),
      issueType: 'quality.rollback_probe',
      severity: 'MAJOR',
      blockingClassification: 'release_blocking',
      statement: 'Synthetic rollback probe ReviewIssue.',
      locator: 'claims/rollback',
      evidenceRefs: [],
      raisedAt: '2026-08-30T00:30:00Z',
    };
    const validated = validateReviewIssueDefinition(definition, current);
    const command = envelope(current, 'quality.review_issue', issueId, { definition });
    await expect(
      executeQualityGovernanceCommand(db, current, command, async (execution) => {
        const outcome = await businessRepository.insertReviewIssue(execution.trx, {
          reviewIssueId: issueId,
          enterpriseId: ENTERPRISE,
          projectId: PROJECT,
          definition: validated.definition,
          raisedBy: principalRef(current.principalId),
          payloadHash: validated.payloadHash,
          createdByPrincipalId: current.principalId,
          createdByActorSnapshotId: current.actorSnapshotId,
          createdAuthorizationDecisionId: current.authorizationDecisionId,
          sourceCommandId: command.commandId,
        });
        expect(outcome).toBe('OK');
        return execution.failAfterTechnicalWrites();
      }),
    ).rejects.toMatchObject({ code: 'INJECTED_FAULT' });
    const counts = await admin.query<{
      review_issue: string;
      observation: string;
      receipt: string;
    }>(
      `SELECT
       (SELECT count(*) FROM quality_governance.review_issue WHERE review_issue_id = $1)::text AS review_issue,
       (SELECT count(*) FROM quality_governance.issue_observation WHERE review_issue_id = $1)::text AS observation,
       (SELECT count(*) FROM quality_governance.command_receipt WHERE command_id = $2)::text AS receipt`,
      [issueId, command.commandId],
    );
    expect(counts.rows[0]).toEqual({ review_issue: '0', observation: '0', receipt: '0' });
  });
});
