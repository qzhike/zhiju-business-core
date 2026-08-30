// IM-05 WI-02 (issue #122): real PostgreSQL evidence for Evidence custody,
// EvidenceLink exactness, QualityProfile versioning, RLS and CAS. These tests
// use only synthetic technical fixtures and run inside the persistence gate.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Common, QualityGovernance } from '@zhiju/contracts';
import {
  CONCURRENCY_CONFLICT,
  createQualityGovernanceDatabase,
  digestCanonicalPayload,
  executeQualityGovernanceCommand,
  handleActivateQualityProfile,
  handleCaptureEvidenceCandidate,
  handleCreateEvidenceLink,
  handleCreateQualityProfileDraft,
  handleGetEvidence,
  handleGetQualityProfile,
  handleRevokeEvidence,
  handleVerifyEvidence,
  QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
  QUALITY_EVIDENCE_NOT_VERIFIED,
  QUALITY_EVIDENCE_QUERY_NOT_FOUND,
  QualityBusinessRepository,
  type CommandEnvelope,
  type CommandResult,
  type QualityCommandEnvelope,
  type QualityTransactionContext,
} from '@zhiju/quality-governance';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const OTHER_ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d203';
const PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9d204';
const ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d205';
const DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9d206';
const POLICY = '018f22e2-7c15-7b2e-8d86-2de956a9d207';
const CORRELATION = '018f22e2-7c15-7b2e-8d86-2de956a9d208';
const PROBE_ROLE = 'im05_wi02_probe';
const PROBE_PASSWORD = 'im05-wi02-probe';

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

function contentAddressedRef(
  objectType: string,
  objectId: string,
  projectId: string | undefined,
  byte: number,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    scope: { enterpriseId: ENTERPRISE, ...(projectId === undefined ? {} : { projectId }) },
    contentHash: hash(byte),
  };
}

function snapshotRef(objectType: string, byte: number): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: newUuidV7(),
    snapshotId: newUuidV7(),
    scope: { enterpriseId: ENTERPRISE },
    contentHash: hash(byte),
  };
}

function candidate(): QualityGovernance.EvidenceCandidate {
  return {
    sourceType: 'artifact.revision',
    sourceObjectRef: {
      kind: 'OBJECT',
      objectType: 'artifact.revision',
      objectId: newUuidV7(),
      scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    },
    sourceSnapshotRef: {
      kind: 'SNAPSHOT',
      objectType: 'artifact.revision_snapshot',
      objectId: newUuidV7(),
      snapshotId: newUuidV7(),
      scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
      contentHash: hash(0x31),
    },
    sourceVersion: '1.0.0',
    locator: 'artifact.revision/claims/1',
    capturedContentRef: 'object-storage/im05-wi02/evidence.txt',
    capturedContentHash: hash(0x32),
    authority: 'artifact.authoritative',
    accessClassification: 'regulated.internal',
    capturedAt: '2026-08-30T00:00:00Z',
  };
}

function verification(
  principalKind: 'HUMAN' | 'AGENT' = 'HUMAN',
  outcome: 'VERIFIED' | 'DISPUTED' = 'VERIFIED',
  verifiedAt = '2026-08-30T00:01:00Z',
): QualityGovernance.EvidenceVerification {
  return {
    method: 'regulatory.cross_reference',
    verifier: { principalKind, principalId: PRINCIPAL },
    verificationPolicyRef: {
      kind: 'VERSIONED',
      objectType: 'quality.verification_policy',
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d209',
      versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d20a',
      scope: { enterpriseId: ENTERPRISE },
    },
    outcome,
    evidenceRefs: [],
    reasons: ['QUALITY_EVIDENCE_REVIEWED'],
    verifiedAt,
  };
}

function profileGate(gateSpecId: string, dependencies: readonly string[]): CanonicalJsonObject {
  return {
    gateSpecId,
    gateType: 'STRUCTURAL_SCHEMA',
    gateVersion: '1.0.0',
    evaluationStage: 'REVISION_ACCEPTANCE',
    mandatory: true,
    applicabilityRule: { kind: 'always' },
    inputContract: { objectType: 'ArtifactRevision' },
    evaluatorPolicy: { principalKind: 'SERVICE' },
    passCriteria: { outcome: 'PASS' },
    failureSeverity: 'MAJOR',
    blockingRule: { outcomes: ['FAIL', 'ERROR'] },
    dependencyGateSpecIds: dependencies,
    rerunRule: { onChange: 'FULL' },
    resultRetentionRule: { retain: 'regulated' },
  };
}

function profileDefinition(version: string): QualityGovernance.QualityProfileDefinition {
  const gateA = newUuidV7();
  const gateB = newUuidV7();
  return {
    name: 'QMS_PROCEDURE_HIGH',
    profileVersion: version,
    applicableArtifactTypes: ['artifact.dhf_section'],
    riskApplicability: { riskLevels: ['HIGH'] },
    gateSpecs: [profileGate(gateA, []), profileGate(gateB, [gateA])],
    gateDependencies: [],
    rerunPolicy: { rerunOnChange: 'FULL' },
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
    idempotencyScope: 'im05.wi02',
    idempotencyKey: newUuidV7(),
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

function committed(result: CommandResult): CanonicalJsonObject {
  expect(result.status).toBe('COMMITTED');
  if (result.status !== 'COMMITTED') throw new Error(`expected COMMITTED, got ${result.status}`);
  return result.resultPayload;
}

function resultRef(
  payload: CanonicalJsonObject,
  key: string,
): Common.ContentAddressedRef | Common.VersionedRef {
  const value = payload[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${key} is not a reference`);
  }
  return value as unknown as Common.ContentAddressedRef | Common.VersionedRef;
}

interface SqlOutcome {
  readonly allowed: boolean;
  readonly code?: string;
}

describe.skipIf(!gateEnabled)(
  'QualityGovernance WI-02 business persistence (real PostgreSQL)',
  () => {
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

    it('keeps Evidence identity/history exact through verify, dispute and revoke', async () => {
      const current = context();
      const evidenceId = newUuidV7();
      const evidenceCandidate = candidate();
      const captureEnvelope = envelope(current, 'quality.evidence', evidenceId, {
        candidate: evidenceCandidate,
      });
      const capture = await handleCaptureEvidenceCandidate(db, current, captureEnvelope);
      const capturedRef = resultRef(
        committed(capture),
        'evidenceRef',
      ) as Common.ContentAddressedRef;
      expect(capturedRef.contentHash.digest).not.toBe(evidenceCandidate.capturedContentHash.digest);
      const replay = await handleCaptureEvidenceCandidate(db, current, captureEnvelope);
      expect(replay).toMatchObject({ status: 'DUPLICATE', originalOutcome: 'COMMITTED' });

      const wrongEvidenceRef = {
        ...capturedRef,
        contentHash: hash(0x99),
      } satisfies Common.ContentAddressedRef;
      await expect(
        handleGetEvidence(db, current, { evidenceRef: wrongEvidenceRef }),
      ).rejects.toMatchObject({
        code: QUALITY_EVIDENCE_QUERY_NOT_FOUND,
      });

      const firstVerification = await handleVerifyEvidence(
        db,
        current,
        envelope(
          current,
          'quality.evidence',
          evidenceId,
          { verification: verification() },
          { expectedAggregateVersion: '1' },
        ),
      );
      expect(committed(firstVerification)).toMatchObject({
        status: 'VERIFIED',
        aggregateVersion: '2',
      });
      const linkDefinition: QualityGovernance.EvidenceLinkDefinition = {
        evidenceRef: capturedRef,
        targetRef: contentAddressedRef('artifact.claim', newUuidV7(), PROJECT, 0x41),
        claimLocator: '/claims/1',
        claimHash: hash(0x42),
        relation: 'SUPPORTS',
        applicabilityScope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
        linkedAt: '2026-08-30T00:02:00Z',
      };
      const link = await handleCreateEvidenceLink(
        db,
        current,
        envelope(current, 'quality.evidence_link', newUuidV7(), { definition: linkDefinition }),
      );
      expect(committed(link)).toMatchObject({ relation: 'SUPPORTS' });
      await expect(
        handleCreateEvidenceLink(
          db,
          current,
          envelope(current, 'quality.evidence_link', newUuidV7(), {
            definition: { ...linkDefinition, evidenceRef: wrongEvidenceRef },
          }),
        ),
      ).rejects.toMatchObject({ code: QUALITY_EVIDENCE_LINK_TARGET_MISMATCH });

      const disputed = await handleVerifyEvidence(
        db,
        current,
        envelope(
          current,
          'quality.evidence',
          evidenceId,
          { verification: verification('HUMAN', 'DISPUTED', '2026-08-30T00:03:00Z') },
          { expectedAggregateVersion: '2' },
        ),
      );
      expect(committed(disputed)).toMatchObject({ status: 'DISPUTED', aggregateVersion: '3' });
      const disputedSupport = await handleCreateEvidenceLink(
        db,
        current,
        envelope(current, 'quality.evidence_link', newUuidV7(), {
          definition: {
            ...linkDefinition,
            linkedAt: '2026-08-30T00:03:30Z',
          },
        }),
      );
      expect(disputedSupport).toMatchObject({
        status: 'REJECTED',
        errorCode: QUALITY_EVIDENCE_NOT_VERIFIED,
      });

      const revoked = await handleRevokeEvidence(
        db,
        current,
        envelope(
          current,
          'quality.evidence',
          evidenceId,
          {
            revocationReason: {
              reasonCode: 'QUALITY_EVIDENCE_REVOKED',
              summary: 'Source was withdrawn.',
              evidenceRefs: [],
            },
            impactAssessmentRef: contentAddressedRef(
              'quality.impact_assessment',
              newUuidV7(),
              PROJECT,
              0x43,
            ),
            revokedAt: '2026-08-30T00:04:00Z',
          },
          { expectedAggregateVersion: '3' },
        ),
      );
      expect(committed(revoked)).toMatchObject({ status: 'REVOKED', aggregateVersion: '4' });
      const revokedSupport = await handleCreateEvidenceLink(
        db,
        current,
        envelope(current, 'quality.evidence_link', newUuidV7(), {
          definition: {
            ...linkDefinition,
            linkedAt: '2026-08-30T00:04:30Z',
          },
        }),
      );
      expect(revokedSupport).toMatchObject({
        status: 'REJECTED',
        errorCode: QUALITY_EVIDENCE_NOT_VERIFIED,
      });
      const revokedContext = await handleCreateEvidenceLink(
        db,
        current,
        envelope(current, 'quality.evidence_link', newUuidV7(), {
          definition: {
            ...linkDefinition,
            relation: 'CONTEXT_ONLY',
            linkedAt: '2026-08-30T00:04:31Z',
          },
        }),
      );
      expect(committed(revokedContext)).toMatchObject({ relation: 'CONTEXT_ONLY' });

      const view = await handleGetEvidence(db, current, { evidenceRef: capturedRef });
      expect(view).toMatchObject({ status: 'REVOKED', impactStatus: 'evidence.impact.stale' });
      expect(view.evidenceRef).toEqual(capturedRef);
      const history = await admin.query<{
        validations: string;
        revocations: string;
        links: string;
      }>(
        `SELECT
         (SELECT count(*) FROM quality_governance.evidence_validation WHERE evidence_id = $1)::text AS validations,
         (SELECT count(*) FROM quality_governance.evidence_revocation WHERE evidence_id = $1)::text AS revocations,
         (SELECT count(*) FROM quality_governance.evidence_link WHERE evidence_id = $1)::text AS links`,
        [evidenceId],
      );
      expect(history.rows[0]).toEqual({ validations: '2', revocations: '1', links: '2' });
    });

    it('adjudicates concurrent Evidence verification with one exact CAS winner', async () => {
      const current = context();
      const evidenceId = newUuidV7();
      const capture = await handleCaptureEvidenceCandidate(
        db,
        current,
        envelope(current, 'quality.evidence', evidenceId, { candidate: candidate() }),
      );
      const verify = (outcome: 'VERIFIED' | 'DISPUTED', suffix: string) =>
        handleVerifyEvidence(
          db,
          current,
          envelope(
            current,
            'quality.evidence',
            evidenceId,
            { verification: verification('HUMAN', outcome, `2026-08-30T00:0${suffix}:00Z`) },
            { expectedAggregateVersion: '1', idempotencyKey: `cas-${suffix}-${newUuidV7()}` },
          ),
        );
      expect(capture.status).toBe('COMMITTED');
      const outcomes = await Promise.all([verify('VERIFIED', '5'), verify('DISPUTED', '6')]);
      expect(outcomes.filter((item) => item.status === 'COMMITTED')).toHaveLength(1);
      expect(outcomes.filter((item) => item.status === 'REJECTED')).toHaveLength(1);
      const rejectedResult = outcomes.find((item) => item.status === 'REJECTED');
      expect(rejectedResult).toMatchObject({
        errorCode: CONCURRENCY_CONFLICT,
        currentAggregateVersion: '2',
      });
    });

    it('creates exact QualityProfile versions, activates them, supersedes old versions, and preserves hashes', async () => {
      const current = context();
      const profileId = newUuidV7();
      const firstDefinition = profileDefinition('3.0.0');
      const firstDraft = await handleCreateQualityProfileDraft(
        db,
        current,
        envelope(current, 'quality.quality_profile', profileId, { definition: firstDefinition }),
      );
      const firstProfileRef = resultRef(
        committed(firstDraft),
        'qualityProfileRef',
      ) as Common.VersionedRef;
      const firstDraftView = await handleGetQualityProfile(db, current, {
        qualityProfileRef: firstProfileRef,
      });
      expect(firstDraftView.status).toBe('DRAFT');
      const firstHash = firstDraftView.payloadHash.digest;

      const activationPayload = {
        profileVersionRef: firstProfileRef,
        reviewSnapshotRef: snapshotRef('quality.quality_profile_review', 0x51),
        validationSnapshotRef: snapshotRef('quality.quality_profile_validation', 0x52),
        activatedAt: '2026-08-30T00:10:00Z',
      } satisfies QualityGovernance.QualityActivateQualityProfilePayload;
      const firstActivation = await handleActivateQualityProfile(
        db,
        current,
        envelope(current, 'quality.quality_profile', profileId, activationPayload, {
          expectedAggregateVersion: '1',
        }),
      );
      expect(committed(firstActivation)).toMatchObject({ status: 'ACTIVE', aggregateVersion: '2' });
      const firstActiveView = await handleGetQualityProfile(db, current, {
        qualityProfileRef: firstProfileRef,
      });
      expect(firstActiveView.status).toBe('ACTIVE');
      expect(firstActiveView.payloadHash.digest).toBe(firstHash);
      const ownerProfileUpdate = await ownerTrySql(
        "UPDATE quality_governance.quality_profile SET name = 'TAMPERED' WHERE quality_profile_id = $1",
        [profileId],
      );
      const ownerVersionUpdate = await ownerTrySql(
        'UPDATE quality_governance.quality_profile_version SET definition = definition || \'{"tampered": true}\'::jsonb WHERE profile_version_id = $1',
        [firstProfileRef.versionId],
      );
      const ownerGateDelete = await ownerTrySql(
        'DELETE FROM quality_governance.quality_profile_gate_spec WHERE profile_version_id = $1',
        [firstProfileRef.versionId],
      );
      const ownerProfileDelete = await ownerTrySql(
        'DELETE FROM quality_governance.quality_profile WHERE quality_profile_id = $1',
        [profileId],
      );
      expect(ownerProfileUpdate).toMatchObject({ allowed: false, code: '55000' });
      expect(ownerVersionUpdate).toMatchObject({ allowed: false, code: '55000' });
      expect(ownerGateDelete).toMatchObject({ allowed: false, code: '55000' });
      expect(ownerProfileDelete).toMatchObject({ allowed: false, code: '55000' });

      const secondDraft = await handleCreateQualityProfileDraft(
        db,
        current,
        envelope(
          current,
          'quality.quality_profile',
          profileId,
          { definition: profileDefinition('3.1.0') },
          { expectedAggregateVersion: '2' },
        ),
      );
      const secondProfileRef = resultRef(
        committed(secondDraft),
        'qualityProfileRef',
      ) as Common.VersionedRef;
      const secondActivation = await handleActivateQualityProfile(
        db,
        current,
        envelope(
          current,
          'quality.quality_profile',
          profileId,
          {
            profileVersionRef: secondProfileRef,
            reviewSnapshotRef: snapshotRef('quality.quality_profile_review', 0x53),
            validationSnapshotRef: snapshotRef('quality.quality_profile_validation', 0x54),
            activatedAt: '2026-08-30T00:11:00Z',
          },
          { expectedAggregateVersion: '3' },
        ),
      );
      expect(committed(secondActivation)).toMatchObject({
        status: 'ACTIVE',
        aggregateVersion: '4',
      });
      expect(
        (await handleGetQualityProfile(db, current, { qualityProfileRef: firstProfileRef })).status,
      ).toBe('SUPERSEDED');
      expect(
        (await handleGetQualityProfile(db, current, { qualityProfileRef: secondProfileRef }))
          .status,
      ).toBe('ACTIVE');
      const childRows = await admin.query<{
        gates: string;
        dependencies: string;
        approvals: string;
        releases: string;
      }>(
        `SELECT
         (SELECT count(*) FROM quality_governance.quality_profile_gate_spec WHERE profile_version_id = $1)::text AS gates,
         (SELECT count(*) FROM quality_governance.quality_profile_gate_dependency WHERE profile_version_id = $1)::text AS dependencies,
         (SELECT count(*) FROM quality_governance.quality_profile_approval_requirement WHERE profile_version_id = $1)::text AS approvals,
         (SELECT count(*) FROM quality_governance.quality_profile_release_requirement WHERE profile_version_id = $1)::text AS releases`,
        [secondProfileRef.versionId],
      );
      expect(childRows.rows[0]).toEqual({
        gates: '2',
        dependencies: '1',
        approvals: '1',
        releases: '1',
      });
    });

    it('keeps business tables app-read-only and isolates cross-enterprise rows with RLS', async () => {
      const evidenceId = newUuidV7();
      const evidencePayload = candidate();
      const evidenceHash = digestCanonicalPayload(
        evidencePayload as unknown as CanonicalJsonObject,
      ).hash;
      const insertOutcome = await probeTrySql(
        `INSERT INTO quality_governance.evidence
        (evidence_id, enterprise_id, project_id, candidate, candidate_payload_hash,
         status, created_by_principal_id, created_by_actor_snapshot_id,
         created_authorization_decision_id, last_command_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'CANDIDATE', $6, $7, $8, $9)`,
        [
          evidenceId,
          ENTERPRISE,
          PROJECT,
          JSON.stringify(evidencePayload),
          evidenceHash,
          PRINCIPAL,
          ACTOR,
          DECISION,
          newUuidV7(),
        ],
      );
      expect(insertOutcome).toMatchObject({ allowed: false, code: '42501' });

      const updateOutcome = await probeTrySql(
        "UPDATE quality_governance.evidence SET status = 'VERIFIED' WHERE evidence_id = $1",
        [evidenceId],
      );
      const deleteOutcome = await probeTrySql(
        'DELETE FROM quality_governance.quality_profile WHERE quality_profile_id = $1',
        [newUuidV7()],
      );
      expect(updateOutcome).toMatchObject({ allowed: false, code: '42501' });
      expect(deleteOutcome).toMatchObject({ allowed: false, code: '42501' });

      const immutableEvidenceId = newUuidV7();
      const captured = await handleCaptureEvidenceCandidate(
        db,
        context(),
        envelope(context(), 'quality.evidence', immutableEvidenceId, {
          candidate: candidate(),
        }),
      );
      expect(captured.status).toBe('COMMITTED');
      const verified = await handleVerifyEvidence(
        db,
        context(),
        envelope(
          context(),
          'quality.evidence',
          immutableEvidenceId,
          { verification: verification() },
          { expectedAggregateVersion: '1' },
        ),
      );
      expect(verified.status).toBe('COMMITTED');
      const ownerEvidenceDelete = await ownerTrySql(
        'DELETE FROM quality_governance.evidence WHERE evidence_id = $1',
        [immutableEvidenceId],
      );
      const ownerValidationDelete = await ownerTrySql(
        'DELETE FROM quality_governance.evidence_validation WHERE evidence_id = $1',
        [immutableEvidenceId],
      );
      expect(ownerEvidenceDelete).toMatchObject({ allowed: false, code: '55000' });
      expect(ownerValidationDelete).toMatchObject({ allowed: false, code: '55000' });

      const crossEnterpriseCount = await probeCount(
        'SELECT count(*)::text AS count FROM quality_governance.evidence WHERE enterprise_id = $1',
        [OTHER_ENTERPRISE],
      );
      expect(crossEnterpriseCount).toBe(0);
      const guardCall = await probeTrySql(
        'SELECT quality_governance.assert_business_write_context($1, $2, $3, $4, $5)',
        [ENTERPRISE, PROJECT, PRINCIPAL, ACTOR, DECISION],
      );
      expect(guardCall).toMatchObject({ allowed: false, code: '42501' });
    });

    it('rolls back an Evidence row and command receipt after a post-write technical fault', async () => {
      const current = context();
      const evidenceId = newUuidV7();
      const evidenceCandidate = candidate();
      const command = envelope(
        current,
        'quality.evidence',
        evidenceId,
        { candidate: evidenceCandidate },
        { idempotencyKey: `rollback-${newUuidV7()}` },
      );
      await expect(
        executeQualityGovernanceCommand(db, current, command, async (execution) => {
          const outcome = await businessRepository.insertEvidence(execution.trx, {
            evidenceId,
            enterpriseId: ENTERPRISE,
            projectId: PROJECT,
            candidate: evidenceCandidate,
            candidatePayloadHash: digestCanonicalPayload(
              evidenceCandidate as unknown as CanonicalJsonObject,
            ).hash,
            createdByPrincipalId: PRINCIPAL,
            createdByActorSnapshotId: ACTOR,
            createdAuthorizationDecisionId: DECISION,
            sourceCommandId: command.commandId,
          });
          expect(outcome).toBe('OK');
          return execution.failAfterTechnicalWrites();
        }),
      ).rejects.toMatchObject({ code: 'INJECTED_FAULT' });
      const counts = await admin.query<{ evidence: string; receipts: string }>(
        `SELECT
         (SELECT count(*) FROM quality_governance.evidence WHERE evidence_id = $1)::text AS evidence,
         (SELECT count(*) FROM quality_governance.command_receipt WHERE command_id = $2)::text AS receipts`,
        [evidenceId, command.commandId],
      );
      expect(counts.rows[0]).toEqual({ evidence: '0', receipts: '0' });
    });
  },
);
