// IM-05 WI-03 (issue #123): synthetic technical PostgreSQL evidence for
// GateResult, ChangeImpact reuse, invalidation, readiness snapshots, exact
// references, RLS, append-only guards, and transaction rollback.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Common, QualityGovernance } from '@zhiju/contracts';
import { ContractRegistry } from '../../contracts/src/registry.js';
import {
  createQualityGovernanceDatabase,
  executeQualityGovernanceCommand,
  handleCreateQualityProfileDraft,
  handleActivateQualityProfile,
  handleEvaluateReleaseGateReadiness,
  handleEvaluateRevisionReadiness,
  handleGetGatePlan,
  handleGetGateResults,
  handleGetReleaseReadinessSnapshot,
  handleGetRevisionAcceptanceSnapshot,
  handleInvalidateGateResult,
  handleRecordGateResult,
  handleRecordReusedGateResult,
  QUALITY_INCREMENTAL_COVERAGE_INSUFFICIENT,
  QUALITY_RELEASE_PACKAGE_TARGET_MISMATCH,
  QualityBusinessRepository,
  validateChangeImpactDefinition,
  validateGateResultSubmission,
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

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const OTHER_ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d203';
const PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9d204';
const ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d205';
const DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9d206';
const POLICY = '018f22e2-7c15-7b2e-8d86-2de956a9d207';
const CORRELATION = '018f22e2-7c15-7b2e-8d86-2de956a9d208';
const BASE_REVISION = '018f22e2-7c15-7b2e-8d86-2de956a9d209';
const TARGET_REVISION = '018f22e2-7c15-7b2e-8d86-2de956a9d20a';
const RELEASE = '018f22e2-7c15-7b2e-8d86-2de956a9d20b';
const PROBE_ROLE = 'im05_wi03_probe';
const PROBE_PASSWORD = 'im05-wi03-probe';

function context(): QualityTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: Buffer.alloc(32, 0x21),
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY,
    enterpriseId: ENTERPRISE,
    allowedProjectIds: [PROJECT],
    correlationId: CORRELATION,
  };
}

function hash(byte: number): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: Buffer.alloc(32, byte).toString('hex'),
    canonicalizationVersion: '1',
  };
}

function hashFromBytes(value: Buffer): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: value.toString('hex'),
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
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: newUuidV7(),
    snapshotId: newUuidV7(),
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    contentHash: hash(byte),
  };
}

function enterpriseSnapshotRef(objectType: string, byte: number): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: newUuidV7(),
    snapshotId: newUuidV7(),
    scope: { enterpriseId: ENTERPRISE },
    contentHash: hash(byte),
  };
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
  name = 'QMS_PROCEDURE_HIGH',
): QualityGovernance.QualityProfileDefinition {
  return {
    name,
    profileVersion: '3.0.0',
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
  contextValue: QualityTransactionContext,
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
    idempotencyScope: 'im05.wi03',
    idempotencyKey: `${targetType}:${targetId}:${newUuidV7()}`,
    requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
    enterpriseId: contextValue.enterpriseId,
    ...(targetType === 'quality.quality_profile' ? {} : { projectId: PROJECT }),
    targetType,
    targetId,
    correlationId: contextValue.correlationId,
    principalId: contextValue.principalId,
    principalKind: contextValue.principalKind,
    actorSnapshotId: contextValue.actorSnapshotId,
    authorizationDecisionId: contextValue.authorizationDecisionId,
    policySnapshotId: contextValue.policySnapshotId,
    ...overrides,
    payload,
  };
}

interface ProfileFixture {
  readonly profileRef: Common.VersionedRef;
  readonly revisionGateId: string;
  readonly representationGateId: string;
  readonly packageGateId: string;
}

interface GateFixture {
  readonly gateResultId: string;
  readonly gateResultRef: Common.ContentAddressedRef;
  readonly target: QualityGovernance.GateTarget;
}

interface SqlOutcome {
  readonly allowed: boolean;
  readonly code?: string;
}

describe.skipIf(!gateEnabled)('QualityGovernance WI-03 business persistence', () => {
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

  async function establish(client: pg.Client): Promise<void> {
    const current = context();
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

  async function probeTrySql(text: string, values: unknown[] = []): Promise<SqlOutcome> {
    await probe.query('BEGIN');
    try {
      await establish(probe);
      await probe.query(text, values);
      await probe.query('ROLLBACK');
      return { allowed: true };
    } catch (error) {
      const code = (error as pg.DatabaseError).code;
      await probe.query('ROLLBACK');
      return { allowed: false, ...(code === undefined ? {} : { code }) };
    }
  }

  async function probeCount(text: string, values: unknown[] = []): Promise<number> {
    await probe.query('BEGIN');
    try {
      await establish(probe);
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

  async function createProfile(): Promise<ProfileFixture> {
    const current = context();
    const profileId = newUuidV7();
    const revisionGateId = newUuidV7();
    const representationGateId = newUuidV7();
    const packageGateId = newUuidV7();
    const definition = profileDefinition(
      revisionGateId,
      representationGateId,
      packageGateId,
      `QMS_PROCEDURE_HIGH_${profileId}`,
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
    return { profileRef, revisionGateId, representationGateId, packageGateId };
  }

  async function recordGate(
    profile: ProfileFixture,
    gateSpecId: string,
    evaluationStage: QualityGovernance.EvaluationStage,
    target: QualityGovernance.GateTarget,
    outcome: QualityGovernance.GateOutcome,
    evaluationAttempt = 1,
  ): Promise<GateFixture> {
    const current = context();
    const gateResultId = newUuidV7();
    const submission: QualityGovernance.GateResultSubmission = {
      artifactRef: objectRef('artifact.artifact', newUuidV7()),
      gateTarget: target,
      evaluationStage,
      qualityProfileRef: profile.profileRef,
      gateSpecId,
      gateVersion: '1.0.0',
      evaluationAttempt,
      evaluatedScope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
      inputSnapshotRef: snapshotRef('quality.gate_input', 0x20),
      evaluator: { evaluatorId: 'synthetic-gate', evaluatorVersion: '1.0.0' },
      outcome,
      findings: outcome === 'PASS' ? [] : [{ code: 'SYNTHETIC_FAILURE' }],
      evidenceRefs: [],
      startedAt: '2026-08-30T00:11:00Z',
      completedAt: '2026-08-30T00:12:00Z',
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
      target,
    };
  }

  async function createImpact(
    base: Common.ContentAddressedRef,
    target: Common.ContentAddressedRef,
    complete = true,
  ): Promise<Common.ContentAddressedRef> {
    const definition = {
      baseRevisionRef: base,
      targetRevisionRef: target,
      changedUnits: [{ unit: 'claims/1' }],
      unchangedUnits: [{ unit: 'claims/2' }],
      affectedClaimRefs: [],
      affectedEvidenceLinkRefs: [],
      affectedGateSpecIds: [],
      toolchainChanges: [],
      profileChanges: [],
      analysisMethod: 'structural-diff',
      analysisVersion: '1.0.0',
      analyzedBy: { principalKind: 'SERVICE', principalId: PRINCIPAL },
      analyzedAt: '2026-08-30T00:13:00Z',
      coverage: complete
        ? { complete: true, coveredUnits: [{ unit: 'claims/2' }] }
        : { complete: false, status: 'INCOMPLETE', coveredUnits: [] },
    };
    const validated = validateChangeImpactDefinition(definition, context());
    const impactId = newUuidV7();
    const outcome = await withQualityGovernanceTransaction(db, context(), (trx) =>
      businessRepository.insertChangeImpact(trx, {
        changeImpactId: impactId,
        enterpriseId: ENTERPRISE,
        projectId: PROJECT,
        definition: validated.definition,
        payloadHash: validated.payloadHash,
        createdByPrincipalId: PRINCIPAL,
        createdByActorSnapshotId: ACTOR,
        createdByAuthorizationDecisionId: DECISION,
        sourceCommandId: newUuidV7(),
      }),
    );
    expect(outcome).toBe('OK');
    return {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'quality.change_impact',
      objectId: impactId,
      scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
      contentHash: hashFromBytes(validated.payloadHash),
    };
  }

  function representationTarget(
    revision: Common.ContentAddressedRef,
  ): QualityGovernance.GateTarget {
    return {
      kind: 'REPRESENTATION',
      revisionRef: revision,
      representationRef: {
        representationId: newUuidV7(),
        revision,
        format: 'DOCX',
        mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        objectStorageRef: 'object-storage/im05-wi03/release.docx',
        checksum: hash(0x71),
        renderer: { rendererId: 'renderer.docx', rendererVersion: '1.0.0' },
        createdAt: '2026-08-30T00:14:00Z',
      },
    };
  }

  function releasePackage(): Common.ReleasePackageRef {
    return {
      releaseRef: objectRef('release.release', RELEASE),
      packageSnapshotRef: snapshotRef('release.package_snapshot', 0x72),
      packageHash: hash(0x73),
    };
  }

  function releasePackageTarget(
    revision: Common.ContentAddressedRef,
    packageRef: Common.ReleasePackageRef,
  ): QualityGovernance.GateTarget {
    return { kind: 'RELEASE_PACKAGE', revisionRef: revision, releasePackageRef: packageRef };
  }

  it('records immutable exact GateResults, supports rerun identity, and enforces RLS/ACL', async () => {
    const current = context();
    const profile = await createProfile();
    const revision = contentRef('artifact.artifact_revision', BASE_REVISION, 0x31);
    const target: QualityGovernance.GateTarget = { kind: 'REVISION', revisionRef: revision };
    const failed = await recordGate(
      profile,
      profile.revisionGateId,
      'REVISION_ACCEPTANCE',
      target,
      'FAIL',
    );
    const rerun = await recordGate(
      profile,
      profile.revisionGateId,
      'REVISION_ACCEPTANCE',
      target,
      'PASS',
      2,
    );
    expect(rerun.gateResultId).not.toBe(failed.gateResultId);
    expect(rerun.gateResultRef.contentHash.digest).not.toBe(
      failed.gateResultRef.contentHash.digest,
    );

    const page = await handleGetGateResults(db, current, {
      target,
      qualityProfileRef: profile.profileRef,
      gateSpecIds: [profile.revisionGateId],
      outcomes: [],
      validOnly: true,
      page: { pageSize: 10 },
    });
    expect(page.items).toHaveLength(2);
    expect(page.items.map((item) => item.outcome)).toEqual(['PASS', 'FAIL']);

    const wrongTarget: QualityGovernance.GateTarget = {
      kind: 'REVISION',
      revisionRef: { ...revision, contentHash: hash(0x99) },
    };
    const wrongTargetPage = await handleGetGateResults(db, current, {
      target: wrongTarget,
      qualityProfileRef: profile.profileRef,
      gateSpecIds: [profile.revisionGateId],
      outcomes: [],
      validOnly: true,
      page: { pageSize: 10 },
    });
    expect(wrongTargetPage.items).toHaveLength(0);

    const ownerUpdate = await ownerTrySql(
      "UPDATE quality_governance.gate_result SET outcome = 'PASS' WHERE gate_result_id = $1",
      [failed.gateResultId],
    );
    const ownerDelete = await ownerTrySql(
      'DELETE FROM quality_governance.gate_result WHERE gate_result_id = $1',
      [failed.gateResultId],
    );
    expect(ownerUpdate).toMatchObject({ allowed: false, code: '55000' });
    expect(ownerDelete).toMatchObject({ allowed: false, code: '55000' });

    const directInsert = await probeTrySql(
      'INSERT INTO quality_governance.gate_result (gate_result_id, enterprise_id) VALUES ($1, $2)',
      [newUuidV7(), ENTERPRISE],
    );
    expect(directInsert).toMatchObject({ allowed: false, code: '42501' });
    const hiddenRows = await probeCount(
      'SELECT count(*)::text AS count FROM quality_governance.gate_result WHERE enterprise_id = $1',
      [OTHER_ENTERPRISE],
    );
    expect(hiddenRows).toBe(0);
  });

  it('creates exact ChangeImpact reuse facts and rejects insufficient coverage without a new result', async () => {
    const current = context();
    const profile = await createProfile();
    const base = contentRef('artifact.artifact_revision', BASE_REVISION, 0x41);
    const targetRevision = contentRef('artifact.artifact_revision', TARGET_REVISION, 0x42);
    const sourceTarget: QualityGovernance.GateTarget = { kind: 'REVISION', revisionRef: base };
    const newTarget: QualityGovernance.GateTarget = {
      kind: 'REVISION',
      revisionRef: targetRevision,
    };
    const source = await recordGate(
      profile,
      profile.revisionGateId,
      'REVISION_ACCEPTANCE',
      sourceTarget,
      'PASS',
    );
    const impactRef = await createImpact(base, targetRevision);
    const plan = await handleGetGatePlan(db, current, {
      target: newTarget,
      qualityProfileRef: profile.profileRef,
      changeImpactRef: impactRef,
    });
    expect(plan.reuseDecisions).toContainEqual(
      expect.objectContaining({ decision: 'REUSE_ALLOWED' }),
    );

    const reusedId = newUuidV7();
    const reused = await handleRecordReusedGateResult(
      db,
      current,
      envelope(current, 'quality.gate_result', reusedId, {
        reuse: {
          newTarget,
          sourceGateResultRef: source.gateResultRef,
          changeImpactRef: impactRef,
          qualityProfileRef: profile.profileRef,
          gateSpecId: profile.revisionGateId,
          derivedOutcome: 'PASS',
          evaluatedAt: '2026-08-30T00:15:00Z',
        },
      }),
    );
    const reusedPayload = committed(reused);
    expect(reusedPayload.executionMode).toBe('REUSED_BY_IMPACT_ANALYSIS');
    const reusedRef = resultRef(reusedPayload, 'gateResultRef') as Common.ContentAddressedRef;

    const incompleteImpactRef = await createImpact(base, targetRevision, false);
    const rejected = await handleRecordReusedGateResult(
      db,
      current,
      envelope(current, 'quality.gate_result', newUuidV7(), {
        reuse: {
          newTarget,
          sourceGateResultRef: source.gateResultRef,
          changeImpactRef: incompleteImpactRef,
          qualityProfileRef: profile.profileRef,
          gateSpecId: profile.revisionGateId,
          derivedOutcome: 'PASS',
          evaluatedAt: '2026-08-30T00:16:00Z',
        },
      }),
    );
    expect(rejected).toMatchObject({
      status: 'REJECTED',
      errorCode: QUALITY_INCREMENTAL_COVERAGE_INSUFFICIENT,
    });
    const targetPage = await handleGetGateResults(db, current, {
      target: newTarget,
      qualityProfileRef: profile.profileRef,
      gateSpecIds: [profile.revisionGateId],
      outcomes: [],
      validOnly: true,
      page: { pageSize: 10 },
    });
    expect(targetPage.items).toHaveLength(1);
    expect(targetPage.items[0]?.gateResultRef).toEqual(reusedRef);
  });

  it('keeps old readiness snapshots immutable and produces stale/not-ready snapshots', async () => {
    const current = context();
    const profile = await createProfile();
    const revision = contentRef('artifact.artifact_revision', BASE_REVISION, 0x51);
    const target: QualityGovernance.GateTarget = { kind: 'REVISION', revisionRef: revision };
    const passed = await recordGate(
      profile,
      profile.revisionGateId,
      'REVISION_ACCEPTANCE',
      target,
      'PASS',
    );
    const readinessInput = {
      revisionRef: revision,
      qualityProfileRef: profile.profileRef,
      gateResultRefs: [passed.gateResultRef],
      evidenceStatusSnapshotRef: snapshotRef('quality.evidence_status_snapshot', 0x52),
      issueSnapshotRef: snapshotRef('quality.review_issue_snapshot', 0x53),
      evaluatorVersions: [{ evaluatorId: 'synthetic.readiness', evaluatorVersion: '1.0.0' }],
      evaluatedAt: '2026-08-30T00:17:00Z',
    } satisfies QualityGovernance.QualityEvaluateRevisionReadinessPayload;
    const readyResult = await handleEvaluateRevisionReadiness(
      db,
      current,
      envelope(current, 'quality.revision_acceptance_snapshot', newUuidV7(), readinessInput),
    );
    const readyPayload = committed(readyResult);
    expect(readyPayload.readinessStatus).toBe('READY');
    const readySnapshotRef = resultRef(readyPayload, 'snapshotRef') as Common.SnapshotRef;
    const readySnapshot = readyPayload.snapshot;
    const readyContract = registry.validateCoreContract(
      'https://schemas.zhiju.local/core/revision-acceptance/1.0',
      readySnapshot,
    );
    expect(readyContract, JSON.stringify(readyContract.errors, null, 2)).toMatchObject({
      valid: true,
    });

    const loadedReady = await handleGetRevisionAcceptanceSnapshot(db, current, {
      snapshotRef: readySnapshotRef,
    });
    expect(loadedReady.readiness.status).toBe('READY');

    const invalidated = await handleInvalidateGateResult(
      db,
      current,
      envelope(current, 'quality.gate_result', passed.gateResultId, {
        invalidationReason: {
          reasonCode: 'QUALITY_UPSTREAM_CHANGED',
          summary: 'Synthetic upstream change invalidated the prior result.',
          evidenceRefs: [],
        },
        impactAssessmentRef: contentRef('quality.impact_assessment', newUuidV7(), 0x54),
        invalidatedAt: '2026-08-30T00:18:00Z',
      }),
    );
    expect(committed(invalidated).validityStatus).toBe('INVALIDATED');

    const staleResult = await handleEvaluateRevisionReadiness(
      db,
      current,
      envelope(current, 'quality.revision_acceptance_snapshot', newUuidV7(), {
        ...readinessInput,
        evaluatedAt: '2026-08-30T00:19:00Z',
      }),
    );
    const stalePayload = committed(staleResult);
    expect(stalePayload.readinessStatus).toBe('STALE');
    const staleSnapshot = await handleGetRevisionAcceptanceSnapshot(db, current, {
      snapshotRef: resultRef(stalePayload, 'snapshotRef') as Common.SnapshotRef,
    });
    expect(staleSnapshot.readiness.status).toBe('STALE');
    expect(
      (await handleGetRevisionAcceptanceSnapshot(db, current, { snapshotRef: readySnapshotRef }))
        .readiness.status,
    ).toBe('READY');

    const failed = await recordGate(
      profile,
      profile.revisionGateId,
      'REVISION_ACCEPTANCE',
      target,
      'FAIL',
    );
    const notReadyResult = await handleEvaluateRevisionReadiness(
      db,
      current,
      envelope(current, 'quality.revision_acceptance_snapshot', newUuidV7(), {
        ...readinessInput,
        gateResultRefs: [failed.gateResultRef],
        evaluatedAt: '2026-08-30T00:20:00Z',
      }),
    );
    const notReadyPayload = committed(notReadyResult);
    expect(notReadyPayload.readinessStatus).toBe('NOT_READY');
    expect(notReadyPayload.snapshot).toMatchObject({
      readiness: {
        status: 'NOT_READY',
        reasons: expect.arrayContaining(['QUALITY_GATE_RESULT_INVALID']),
      },
    });
  });

  it('binds RRS to exact Representation and ReleasePackage targets and rejects package drift', async () => {
    const current = context();
    const profile = await createProfile();
    const revision = contentRef('artifact.artifact_revision', TARGET_REVISION, 0x61);
    const packageRef = releasePackage();
    const representation = representationTarget(revision);
    const packageTarget = releasePackageTarget(revision, packageRef);
    const representationGate = await recordGate(
      profile,
      profile.representationGateId,
      'RELEASE_READINESS',
      representation,
      'PASS',
    );
    const packageGate = await recordGate(
      profile,
      profile.packageGateId,
      'RELEASE_READINESS',
      packageTarget,
      'PASS',
    );
    const readinessInput = {
      releasePackageRef: packageRef,
      approvalBundleSnapshotRef: snapshotRef('quality.approval_bundle_snapshot', 0x74),
      recipientScopeSnapshotRef: snapshotRef('release.recipient_scope_snapshot', 0x75),
      destinationRefs: [
        {
          system: 'feishu',
          resourceType: 'tenant',
          externalId: 'tenant-1',
          observedAt: '2026-08-30T00:21:00Z',
        },
      ],
      releaseGateResultRefs: [representationGate.gateResultRef, packageGate.gateResultRef],
      evaluatedAt: '2026-08-30T00:22:00Z',
    } satisfies QualityGovernance.QualityEvaluateReleaseGateReadinessPayload;
    const readyResult = await handleEvaluateReleaseGateReadiness(
      db,
      current,
      envelope(current, 'quality.release_readiness_snapshot', newUuidV7(), readinessInput),
    );
    const readyPayload = committed(readyResult);
    expect(readyPayload.readinessStatus).toBe('READY_FOR_AUTHORIZATION');
    expect(
      registry.validateCoreContract(
        'https://schemas.zhiju.local/core/release-readiness/1.0',
        readyPayload.snapshot,
      ),
    ).toMatchObject({ valid: true });

    const driftedPackage = {
      ...packageRef,
      packageHash: hash(0x99),
    };
    const driftResult = await handleEvaluateReleaseGateReadiness(
      db,
      current,
      envelope(current, 'quality.release_readiness_snapshot', newUuidV7(), {
        ...readinessInput,
        releasePackageRef: driftedPackage,
        evaluatedAt: '2026-08-30T00:23:00Z',
      }),
    );
    const driftPayload = committed(driftResult);
    expect(driftPayload.readinessStatus).toBe('NOT_READY');
    expect(driftPayload.snapshot).toMatchObject({
      readiness: {
        status: 'NOT_READY',
        reasons: expect.arrayContaining([QUALITY_RELEASE_PACKAGE_TARGET_MISMATCH]),
      },
    });
    const loaded = await handleGetReleaseReadinessSnapshot(db, current, {
      snapshotRef: resultRef(readyPayload, 'snapshotRef') as Common.SnapshotRef,
    });
    expect(loaded.readiness.status).toBe('READY_FOR_AUTHORIZATION');
  });

  it('rolls back a GateResult and command receipt after a post-write fault', async () => {
    const current = context();
    const profile = await createProfile();
    const gateResultId = newUuidV7();
    const revision = contentRef('artifact.artifact_revision', BASE_REVISION, 0x81);
    const submission: QualityGovernance.GateResultSubmission = {
      artifactRef: objectRef('artifact.artifact', newUuidV7()),
      gateTarget: { kind: 'REVISION', revisionRef: revision },
      evaluationStage: 'REVISION_ACCEPTANCE',
      qualityProfileRef: profile.profileRef,
      gateSpecId: profile.revisionGateId,
      gateVersion: '1.0.0',
      evaluationAttempt: 1,
      evaluatedScope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
      inputSnapshotRef: snapshotRef('quality.gate_input', 0x82),
      evaluator: { evaluatorId: 'synthetic-gate', evaluatorVersion: '1.0.0' },
      outcome: 'PASS',
      findings: [],
      evidenceRefs: [],
      startedAt: '2026-08-30T00:24:00Z',
      completedAt: '2026-08-30T00:25:00Z',
    };
    const validated = validateGateResultSubmission(submission, current);
    const command = envelope(current, 'quality.gate_result', gateResultId, { submission });
    await expect(
      executeQualityGovernanceCommand(db, current, command, async (execution) => {
        const outcome = await businessRepository.insertGateResult(execution.trx, {
          gateResultId,
          enterpriseId: ENTERPRISE,
          projectId: PROJECT,
          definition: validated.definition,
          revisionContentHash: validated.revisionContentHash,
          evaluationStage: 'REVISION_ACCEPTANCE',
          executionMode: 'EXECUTED',
          payloadHash: validated.payloadHash,
          createdByPrincipalId: PRINCIPAL,
          createdByActorSnapshotId: ACTOR,
          createdByAuthorizationDecisionId: DECISION,
          sourceCommandId: command.commandId,
        });
        expect(outcome).toBe('OK');
        return execution.failAfterTechnicalWrites();
      }),
    ).rejects.toMatchObject({ code: 'INJECTED_FAULT' });
    const counts = await admin.query<{ gate_result: string; receipts: string }>(
      `SELECT
       (SELECT count(*) FROM quality_governance.gate_result WHERE gate_result_id = $1)::text AS gate_result,
       (SELECT count(*) FROM quality_governance.command_receipt WHERE command_id = $2)::text AS receipts`,
      [gateResultId, command.commandId],
    );
    expect(counts.rows[0]).toEqual({ gate_result: '0', receipts: '0' });
  });
});
