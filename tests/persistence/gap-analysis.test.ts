// IM-03 WI-09 (issue #65): real PostgreSQL acceptance tests for exact
// GapAnalysis inputs, deterministic finding fixtures, Human-only decisions,
// idempotent command replay, Root CAS and stale dependency propagation.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  CONCURRENCY_CONFLICT,
  createEnterpriseProjectDatabase,
  GapAnalysisRepository,
  handleAcceptGapAnalysis,
  handleActivateCustomerBaselineVersion,
  handleCreateCustomerBaselineDraft,
  handleStartGapAnalysis,
  PROJECT_GAP_EPISTEMIC_CONFLICT,
  PROJECT_GAP_HUMAN_ACCEPTANCE_REQUIRED,
  PROJECT_GAP_INPUT_HASH_MISMATCH,
  PROJECT_GAP_INPUT_INCOMPLETE,
  PROJECT_GAP_SCOPE_MISMATCH,
  PROJECT_GAP_STATUS_INVALID,
  withEnterpriseProjectTransaction,
  type CommandEnvelope,
  type CommandResult,
  type EnterprisePrincipalKind,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Common, EnterpriseProject } from '@zhiju/contracts';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const HUMAN_PRINCIPAL = 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a1a1';
const AGENT_PRINCIPAL = 'a2a2a2a2-a2a2-72a2-82a2-a2a2a2a2a2a2';
const HUMAN_ACTOR = 'a3a3a3a3-a3a3-73a3-83a3-a3a3a3a3a3a3';
const AGENT_ACTOR = 'a4a4a4a4-a4a4-74a4-84a4-a4a4a4a4a4a4';
const AUTHORIZATION_DECISION = 'a5a5a5a5-a5a5-75a5-85a5-a5a5a5a5a5a5';
const POLICY_SNAPSHOT = 'a6a6a6a6-a6a6-76a6-86a6-a6a6a6a6a6a6';
const DECISION_HASH = Buffer.alloc(32, 0xa6);

function contextFor(
  enterpriseId: string,
  projectId: string,
  principalKind: EnterprisePrincipalKind = 'HUMAN',
): EnterpriseProjectTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: principalKind === 'HUMAN' ? HUMAN_PRINCIPAL : AGENT_PRINCIPAL,
    principalKind,
    actorSnapshotId: principalKind === 'HUMAN' ? HUMAN_ACTOR : AGENT_ACTOR,
    authorizationDecisionId: AUTHORIZATION_DECISION,
    authorizationDecisionHash: DECISION_HASH,
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY_SNAPSHOT,
    enterpriseId,
    allowedProjectIds: [projectId],
    correlationId: newUuidV7(),
  };
}

function hashValue(hash: Buffer): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: hash.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function objectRef(
  objectType: string,
  objectId: string,
  enterpriseId: string,
  projectId: string,
): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: { enterpriseId, projectId },
  };
}

function projectVersionedRef(
  objectType: string,
  objectId: string,
  versionId: string,
  enterpriseId: string,
  projectId: string,
): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType,
    objectId,
    versionId,
    scope: { enterpriseId, projectId },
  };
}

function enterpriseVersionedRef(
  objectType: string,
  objectId: string,
  versionId: string,
  enterpriseId: string,
): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType,
    objectId,
    versionId,
    scope: { enterpriseId },
  };
}

function enterpriseSnapshotRef(
  objectType: string,
  objectId: string,
  snapshotId: string,
  enterpriseId: string,
  payloadHash: Buffer,
): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId,
    snapshotId,
    scope: { enterpriseId },
    contentHash: hashValue(payloadHash),
  };
}

function projectSnapshotRef(
  enterpriseId: string,
  projectId: string,
  objectType = 'GapReview',
  snapshotId = newUuidV7(),
): Common.SnapshotRef {
  const payloadHash = Buffer.alloc(32, 0xb1);
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: snapshotId,
    snapshotId,
    scope: { enterpriseId, projectId },
    contentHash: hashValue(payloadHash),
  };
}

function justification(reasonCode = 'GAP_ANALYSIS_REVIEW'): EnterpriseProject.Justification {
  return {
    reasonCode,
    summary: 'The exact frozen GapAnalysis input was reviewed by a Human.',
    evidenceRefs: [],
  };
}

function commandEnvelope<TPayload extends object>(
  context: EnterpriseProjectTransactionContext,
  commandType: string,
  idempotencyKey: string,
  payload: TPayload,
  overrides: Partial<CommandEnvelope> = {},
): CommandEnvelope & { payload: TPayload } {
  return {
    commandId: newUuidV7(),
    commandType,
    commandVersion: '1.0',
    idempotencyScope: 'im03.wi09',
    idempotencyKey,
    requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
    enterpriseId: context.enterpriseId,
    projectId: undefined,
    targetType: 'GapAnalysis',
    targetId: newUuidV7(),
    correlationId: context.correlationId,
    principalId: context.principalId,
    principalKind: context.principalKind,
    actorSnapshotId: context.actorSnapshotId,
    authorizationDecisionId: context.authorizationDecisionId,
    policySnapshotId: context.policySnapshotId,
    ...overrides,
    payload,
  };
}

function committedPayload(result: CommandResult): CanonicalJsonObject {
  if (result.status !== 'COMMITTED') {
    throw new Error(`expected COMMITTED, got ${result.status} ${result.errorCode ?? ''}`);
  }
  return result.resultPayload;
}

function aggregateVersion(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  throw new Error('expected a PostgreSQL aggregate version');
}

interface Fixture {
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly productId: string;
  readonly productScopeSnapshotId: string;
  readonly productScopePayloadHash: Buffer;
  readonly enterpriseProfileSnapshotId: string;
  readonly enterpriseProfilePayloadHash: Buffer;
  readonly qmsConfigurationId: string;
  readonly qmsRevisionId: string;
  readonly qmsRevisionPayloadHash: Buffer;
  readonly customerBaselineId: string;
  readonly customerBaselineVersionId: string;
  readonly customerBaselineItemId: string;
  readonly templateBaselineId: string;
  readonly templateBaselineVersionId: string;
  readonly regulatoryProfileId: string;
  readonly regulatoryProfileVersionId: string;
  readonly analysisPolicyId: string;
  readonly analysisPolicyVersionId: string;
}

async function seedFixture(admin: pg.Client): Promise<Fixture> {
  const enterpriseId = newUuidV7();
  const projectId = newUuidV7();
  const productId = newUuidV7();
  const productScopeSnapshotId = newUuidV7();
  const enterpriseProfileSnapshotId = newUuidV7();
  const qmsConfigurationId = newUuidV7();
  const qmsRevisionId = newUuidV7();
  const customerBaselineId = newUuidV7();
  const customerBaselineVersionId = newUuidV7();
  const customerBaselineItemId = newUuidV7();
  const templateBaselineId = newUuidV7();
  const templateBaselineVersionId = newUuidV7();
  const regulatoryProfileId = newUuidV7();
  const regulatoryProfileVersionId = newUuidV7();
  const analysisPolicyId = newUuidV7();
  const analysisPolicyVersionId = newUuidV7();
  const productScopePayloadHash = Buffer.alloc(32, 0xc1);
  const enterpriseProfilePayloadHash = Buffer.alloc(32, 0xc2);
  const qmsRevisionPayloadHash = Buffer.alloc(32, 0xc3);
  const genericPayloadHash = Buffer.alloc(32, 0xc4);
  const memberPolicyVersionId = newUuidV7();

  const projectPolicyRef = {
    kind: 'VERSIONED',
    objectType: 'Policy',
    objectId: newUuidV7(),
    versionId: memberPolicyVersionId,
  };
  const enterpriseProfilePayload = { enterpriseId, displayName: 'WI-09 fixture enterprise' };
  const productScopePayload = {
    enterpriseId,
    productId,
    productType: 'fixture.product',
    displayName: 'WI-09 fixture product',
  };

  await admin.query('BEGIN');
  try {
    await admin.query(
      `INSERT INTO enterprise_project.project
         (project_id, enterprise_id, display_code, title, objective, status,
          member_policy_ref, member_policy_version_id, member_policy_payload_hash,
          created_by_principal_id, created_by_actor_snapshot_id, last_command_id)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6::jsonb, $7, $8, $9, $10, $11)`,
      [
        projectId,
        enterpriseId,
        `WI09-${projectId.slice(-8)}`,
        'WI-09 GapAnalysis fixture',
        'Exercise exact frozen inputs, Human decisions and stale propagation.',
        JSON.stringify(projectPolicyRef),
        memberPolicyVersionId,
        genericPayloadHash,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.product
         (product_id, enterprise_id, display_code, display_name, status,
          current_version_id, created_by_principal_id, created_by_actor_snapshot_id,
          last_command_id)
       VALUES ($1, $2, $3, $4, 'ACTIVE', NULL, $5, $6, $7)`,
      [
        productId,
        enterpriseId,
        `WI09-P-${productId.slice(-8)}`,
        'WI-09 fixture product',
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.product_scope_snapshot
         (snapshot_id, product_id, enterprise_id, payload, payload_hash,
          derived_from, frozen_by_principal_id, frozen_by_actor_snapshot_id,
          authorization_decision_id, purpose, source_command_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, '{}'::jsonb, $6, $7, $8, $9, $10)`,
      [
        productScopeSnapshotId,
        productId,
        enterpriseId,
        JSON.stringify(productScopePayload),
        productScopePayloadHash,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        AUTHORIZATION_DECISION,
        'WI09_TEST',
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.enterprise_profile_snapshot
         (snapshot_id, enterprise_id, payload, payload_hash, derived_from,
          frozen_by_principal_id, frozen_by_actor_snapshot_id,
          authorization_decision_id, purpose, source_command_id)
       VALUES ($1, $2, $3::jsonb, $4, '{}'::jsonb, $5, $6, $7, $8, $9)`,
      [
        enterpriseProfileSnapshotId,
        enterpriseId,
        JSON.stringify(enterpriseProfilePayload),
        enterpriseProfilePayloadHash,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        AUTHORIZATION_DECISION,
        'WI09_TEST',
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.qms_configuration
         (qms_configuration_id, enterprise_id, display_code, display_name, status,
          current_revision_id, created_by_principal_id, created_by_actor_snapshot_id,
          last_command_id)
       VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7, $8)`,
      [
        qmsConfigurationId,
        enterpriseId,
        `WI09-QMS-${qmsConfigurationId.slice(-8)}`,
        'WI-09 fixture QMS',
        qmsRevisionId,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.qms_configuration_revision
         (revision_id, qms_configuration_id, enterprise_id, revision_no,
          applicability_decisions, management_choices, professional_decisions,
          source_refs, payload_hash, lifecycle, created_by_principal_id,
          created_by_actor_snapshot_id, authorization_decision_id, source_command_id)
       VALUES ($1, $2, $3, 1, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
          '{}'::jsonb, $4, 'CURRENT', $5, $6, $7, $8)`,
      [
        qmsRevisionId,
        qmsConfigurationId,
        enterpriseId,
        qmsRevisionPayloadHash,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        AUTHORIZATION_DECISION,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.customer_baseline
         (customer_baseline_id, enterprise_id, project_id, current_version_id,
          active_version_id, created_by_principal_id, created_by_actor_snapshot_id,
          last_command_id)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
      [
        customerBaselineId,
        enterpriseId,
        projectId,
        customerBaselineVersionId,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.customer_baseline_version
         (version_id, customer_baseline_id, enterprise_id, project_id, version_no,
          version_status, previous_version_id, baseline_policy_ref,
          expectations_payload, payload_hash, proposed_by_principal_id,
          proposed_by_actor_snapshot_id, authorization_decision_id,
          confirmed_by_principal_id, confirmed_by_actor_snapshot_id, confirmed_at,
          source_command_id)
       VALUES ($1, $2, $3, $4, 1, 'CONFIRMED', NULL, $5::jsonb, $6::jsonb, $7,
          $8, $9, $10, $8, $9, now(), $11)`,
      [
        customerBaselineVersionId,
        customerBaselineId,
        enterpriseId,
        projectId,
        JSON.stringify({
          kind: 'VERSIONED',
          objectType: 'Policy',
          objectId: newUuidV7(),
          versionId: newUuidV7(),
        }),
        JSON.stringify([{ expectedMaterialKey: 'fixture.unknown' }]),
        genericPayloadHash,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        AUTHORIZATION_DECISION,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.customer_baseline_item
         (expectation_id, customer_baseline_id, version_id, enterprise_id, project_id,
          expected_material_key, material_type, expected_title_or_role, status,
          customer_material_refs, decision_ref, reason, payload_hash,
          recorded_by_principal_id, recorded_by_actor_snapshot_id,
          authorization_decision_id, source_command_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'UNKNOWN', '[]'::jsonb,
          NULL, $9::jsonb, $10, $11, $12, $13, $14)`,
      [
        customerBaselineItemId,
        customerBaselineId,
        customerBaselineVersionId,
        enterpriseId,
        projectId,
        'fixture.unknown',
        'quality.procedure',
        'Fixture unknown fact',
        JSON.stringify(justification('BASELINE_UNKNOWN_FIXTURE')),
        genericPayloadHash,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        AUTHORIZATION_DECISION,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.template_baseline
         (template_baseline_id, enterprise_id, project_id, current_version_id,
          active_version_id, created_by_principal_id, created_by_actor_snapshot_id,
          last_command_id)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
      [
        templateBaselineId,
        enterpriseId,
        projectId,
        templateBaselineVersionId,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.template_baseline_version
         (version_id, template_baseline_id, enterprise_id, project_id, version_no,
          version_status, previous_version_id, selections_payload,
          review_snapshot_ref, selection_rationale, payload_hash,
          created_by_principal_id, created_by_actor_snapshot_id,
          authorization_decision_id, source_command_id)
       VALUES ($1, $2, $3, $4, 1, 'FROZEN', NULL, $5::jsonb, $6::jsonb,
          $7::jsonb, $8, $9, $10, $11, $12)`,
      [
        templateBaselineVersionId,
        templateBaselineId,
        enterpriseId,
        projectId,
        JSON.stringify([{ deliveryCategory: 'fixture.control' }]),
        JSON.stringify(projectSnapshotRef(enterpriseId, projectId, 'TemplateReview')),
        JSON.stringify(justification('TEMPLATE_FREEZE_FIXTURE')),
        genericPayloadHash,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        AUTHORIZATION_DECISION,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.regulatory_profile
         (regulatory_profile_id, enterprise_id, project_id, current_version_id,
          active_version_id, created_by_principal_id, created_by_actor_snapshot_id,
          last_command_id)
       VALUES ($1, $2, $3, $4, $4, $5, $6, $7)`,
      [
        regulatoryProfileId,
        enterpriseId,
        projectId,
        regulatoryProfileVersionId,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.regulatory_profile_version
         (version_id, regulatory_profile_id, enterprise_id, project_id, version_no,
          version_status, jurisdiction, product_scope_snapshot_ref,
          product_scope_snapshot_id, product_scope_payload_hash,
          applicability_payload, review_snapshot_ref, payload_hash,
          created_by_principal_id, created_by_actor_snapshot_id,
          authorization_decision_id, source_command_id)
       VALUES ($1, $2, $3, $4, 1, 'FROZEN', 'CN', $5::jsonb, $6, $7,
          $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14)`,
      [
        regulatoryProfileVersionId,
        regulatoryProfileId,
        enterpriseId,
        projectId,
        JSON.stringify(
          enterpriseSnapshotRef(
            'ProductScopeSnapshot',
            productId,
            productScopeSnapshotId,
            enterpriseId,
            productScopePayloadHash,
          ),
        ),
        productScopeSnapshotId,
        productScopePayloadHash,
        JSON.stringify([{ applicability: 'APPLICABLE' }]),
        JSON.stringify(projectSnapshotRef(enterpriseId, projectId, 'RegulatoryReview')),
        genericPayloadHash,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        AUTHORIZATION_DECISION,
        newUuidV7(),
      ],
    );
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }

  return {
    enterpriseId,
    projectId,
    productId,
    productScopeSnapshotId,
    productScopePayloadHash,
    enterpriseProfileSnapshotId,
    enterpriseProfilePayloadHash,
    qmsConfigurationId,
    qmsRevisionId,
    qmsRevisionPayloadHash,
    customerBaselineId,
    customerBaselineVersionId,
    customerBaselineItemId,
    templateBaselineId,
    templateBaselineVersionId,
    regulatoryProfileId,
    regulatoryProfileVersionId,
    analysisPolicyId,
    analysisPolicyVersionId,
  };
}

function inputSnapshot(fixture: Fixture): EnterpriseProject.GapInputSnapshot {
  return {
    customerBaselineRef: projectVersionedRef(
      'CustomerBaseline',
      fixture.customerBaselineId,
      fixture.customerBaselineVersionId,
      fixture.enterpriseId,
      fixture.projectId,
    ),
    templateBaselineRef: projectVersionedRef(
      'TemplateBaseline',
      fixture.templateBaselineId,
      fixture.templateBaselineVersionId,
      fixture.enterpriseId,
      fixture.projectId,
    ),
    regulatoryProfileRef: projectVersionedRef(
      'RegulatoryProfile',
      fixture.regulatoryProfileId,
      fixture.regulatoryProfileVersionId,
      fixture.enterpriseId,
      fixture.projectId,
    ),
    enterpriseProfileSnapshotRef: enterpriseSnapshotRef(
      'EnterpriseProfileSnapshot',
      fixture.enterpriseProfileSnapshotId,
      fixture.enterpriseProfileSnapshotId,
      fixture.enterpriseId,
      fixture.enterpriseProfilePayloadHash,
    ),
    qmsConfigurationRef: enterpriseVersionedRef(
      'QMSConfiguration',
      fixture.qmsConfigurationId,
      fixture.qmsRevisionId,
      fixture.enterpriseId,
    ),
    productScopeSnapshotRef: enterpriseSnapshotRef(
      'ProductScopeSnapshot',
      fixture.productId,
      fixture.productScopeSnapshotId,
      fixture.enterpriseId,
      fixture.productScopePayloadHash,
    ),
    analysisPolicyRef: projectVersionedRef(
      'Policy',
      fixture.analysisPolicyId,
      fixture.analysisPolicyVersionId,
      fixture.enterpriseId,
      fixture.projectId,
    ),
  };
}

function findingFixture(fixture: Fixture, suffix = newUuidV7()): CanonicalJsonObject {
  return {
    findingId: newUuidV7(),
    subjectKey: `fixture.subject.${suffix.slice(-8)}`,
    subjectType: 'ControlRequirement',
    customerBaselineItemRefs: [
      projectVersionedRef(
        'CustomerBaselineItem',
        fixture.customerBaselineItemId,
        fixture.customerBaselineVersionId,
        fixture.enterpriseId,
        fixture.projectId,
      ) as unknown as CanonicalJsonObject,
    ],
    templateRefs: [],
    regulatoryItemRefs: [],
    gapStatus: 'UNKNOWN',
    severity: 'MEDIUM',
    rationale: { reasonCode: 'FIXTURE_UNKNOWN' },
    evidenceRefs: [],
    recommendedAction: 'NEED_INFORMATION',
    informationRequestRefs: [
      projectVersionedRef(
        'InformationRequest',
        newUuidV7(),
        newUuidV7(),
        fixture.enterpriseId,
        fixture.projectId,
      ) as unknown as CanonicalJsonObject,
    ],
  };
}

function startPayload(
  fixture: Fixture,
  finding: CanonicalJsonObject = findingFixture(fixture),
  mode: 'FORMAL' | 'EXPLORATORY' = 'FORMAL',
): EnterpriseProject.ProjectStartGapAnalysisPayload {
  return {
    projectRef: objectRef('Project', fixture.projectId, fixture.enterpriseId, fixture.projectId),
    inputSnapshot: inputSnapshot(fixture),
    mode,
    requestedScope: {
      evaluator: 'controlled-fixture-v1',
      findings: [finding],
    },
  };
}

async function startGap(
  db: ReturnType<typeof createEnterpriseProjectDatabase>,
  fixture: Fixture,
  context: EnterpriseProjectTransactionContext,
  idempotencyKey: string,
  finding?: CanonicalJsonObject,
): Promise<{
  readonly envelope: CommandEnvelope & {
    payload: EnterpriseProject.ProjectStartGapAnalysisPayload;
  };
  readonly result: CommandResult;
  readonly gapRef: Common.VersionedRef;
}> {
  const envelope = commandEnvelope(
    context,
    'project.start_gap_analysis',
    idempotencyKey,
    startPayload(fixture, finding),
    { projectId: fixture.projectId, targetType: 'GapAnalysis', targetId: newUuidV7() },
  );
  const result = await handleStartGapAnalysis(db, context, envelope);
  const payload = committedPayload(result) as unknown as {
    gapAnalysisRef: Common.VersionedRef;
  };
  return { envelope, result, gapRef: payload.gapAnalysisRef };
}

function acceptPayload(
  fixture: Fixture,
  gapRef: Common.VersionedRef,
  disposition: 'ACCEPT' | 'REJECT' | 'CHANGES_REQUIRED',
  actingFor = false,
): EnterpriseProject.ProjectAcceptGapAnalysisPayload {
  const review = projectSnapshotRef(fixture.enterpriseId, fixture.projectId);
  const baseJustification = justification(`GAP_${disposition}`);
  const reviewJustification = actingFor
    ? ({
        ...baseJustification,
        actingFor: { principalId: AGENT_PRINCIPAL },
      } as unknown as EnterpriseProject.Justification)
    : baseJustification;
  return {
    gapAnalysisVersionRef: gapRef,
    reviewSnapshotRef: review,
    disposition,
    justification: reviewJustification,
  };
}

async function acceptGap(
  db: ReturnType<typeof createEnterpriseProjectDatabase>,
  fixture: Fixture,
  context: EnterpriseProjectTransactionContext,
  gapRef: Common.VersionedRef,
  idempotencyKey: string,
  disposition: 'ACCEPT' | 'REJECT' | 'CHANGES_REQUIRED' = 'ACCEPT',
  expectedAggregateVersion = '1',
  actingFor = false,
): Promise<{
  readonly envelope: CommandEnvelope & {
    payload: EnterpriseProject.ProjectAcceptGapAnalysisPayload;
  };
  readonly result: CommandResult;
}> {
  const envelope = commandEnvelope(
    context,
    'project.accept_gap_analysis',
    idempotencyKey,
    acceptPayload(fixture, gapRef, disposition, actingFor),
    {
      projectId: fixture.projectId,
      targetType: 'GapAnalysis',
      targetId: gapRef.objectId,
      expectedAggregateVersion,
    },
  );
  return { envelope, result: await handleAcceptGapAnalysis(db, context, envelope) };
}

describe.skipIf(!gateEnabled)('GapAnalysis WI-09 (real PostgreSQL)', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createEnterpriseProjectDatabase>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `DO $do$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'im03_wi09_probe') THEN
           CREATE ROLE im03_wi09_probe LOGIN PASSWORD 'im03-wi09-probe'
             NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
         END IF;
       END $do$`,
    );
    await admin.query(
      `GRANT platform_context_establisher, enterprise_project_app TO im03_wi09_probe`,
    );
    const url = new URL(databaseUrl ?? '');
    url.username = 'im03_wi09_probe';
    url.password = 'im03-wi09-probe';
    pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
    db = createEnterpriseProjectDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  it('EP-WI09-U-001/U-002: freezes exact inputs, persists findings and replays idempotently', async () => {
    const fixture = await seedFixture(admin);
    const context = contextFor(fixture.enterpriseId, fixture.projectId);
    const started = await startGap(db, fixture, context, 'start-freeze-and-replay');
    expect(started.result.status).toBe('COMMITTED');

    const duplicate = await handleStartGapAnalysis(db, context, started.envelope);
    expect(duplicate).toMatchObject({
      status: 'DUPLICATE',
      originalOutcome: 'COMMITTED',
    });

    const stored = await withEnterpriseProjectTransaction(db, context, async (trx) => {
      const repository = new GapAnalysisRepository();
      const root = await repository.getGapAnalysisById(trx, started.gapRef.objectId);
      const version = await repository.getGapAnalysisVersion(trx, started.gapRef.versionId);
      const input = version
        ? await repository.getGapAnalysisInputSnapshot(trx, version.input_snapshot_id)
        : undefined;
      const findings = await repository.getGapFindings(trx, started.gapRef.versionId);
      return { root, version, input, findings };
    });
    expect(stored.root).toMatchObject({
      gap_analysis_id: started.gapRef.objectId,
      enterprise_id: fixture.enterpriseId,
      project_id: fixture.projectId,
      current_version_id: started.gapRef.versionId,
      status: 'COMPLETED',
    });
    expect(aggregateVersion(stored.root?.aggregate_version)).toBe('1');
    expect(stored.version).toMatchObject({
      gap_analysis_id: started.gapRef.objectId,
      version_id: started.gapRef.versionId,
      version_no: 1,
      version_status: 'COMPLETED',
      mode: 'FORMAL',
    });
    expect(stored.version?.findings_summary).toEqual({
      findingCount: 1,
      byGapStatus: { UNKNOWN: 1 },
      bySeverity: { MEDIUM: 1 },
    });
    expect(stored.input).toMatchObject({
      gap_analysis_id: started.gapRef.objectId,
      version_id: started.gapRef.versionId,
      customer_baseline_version_id: fixture.customerBaselineVersionId,
      template_baseline_version_id: fixture.templateBaselineVersionId,
      regulatory_profile_version_id: fixture.regulatoryProfileVersionId,
      enterprise_profile_snapshot_id: fixture.enterpriseProfileSnapshotId,
      qms_configuration_revision_id: fixture.qmsRevisionId,
      product_scope_snapshot_id: fixture.productScopeSnapshotId,
      analysis_policy_version_id: fixture.analysisPolicyVersionId,
    });
    expect(stored.findings).toHaveLength(1);
    expect(stored.findings[0]).toMatchObject({
      finding_id: expect.any(String),
      version_id: started.gapRef.versionId,
      gap_status: 'UNKNOWN',
      recommended_action: 'NEED_INFORMATION',
    });

    const event = await admin.query<{
      event_type: string;
      aggregate_version: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_type, aggregate_version, payload
         FROM enterprise_project.outbox_event
        WHERE aggregate_type = 'GapAnalysis' AND aggregate_id = $1
        ORDER BY recorded_at ASC`,
      [started.gapRef.objectId],
    );
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0]).toMatchObject({
      event_type: 'project.GapAnalysisCompleted',
      aggregate_version: '1',
      payload: {
        gapAnalysisRef: started.gapRef,
        projectRef: objectRef(
          'Project',
          fixture.projectId,
          fixture.enterpriseId,
          fixture.projectId,
        ),
      },
    });

    const edges = await admin.query<{ reference_path: string }>(
      `SELECT reference_path
         FROM enterprise_project.reference_edge
        WHERE owner_object_type = 'GapAnalysis'
          AND owner_object_id = $1
          AND owner_version_id = $2
        ORDER BY reference_path`,
      [started.gapRef.objectId, started.gapRef.versionId],
    );
    expect(edges.rows.map((row) => row.reference_path)).toEqual(
      expect.arrayContaining([
        '/projectRef',
        '/inputSnapshot/customerBaselineRef',
        '/inputSnapshot/templateBaselineRef',
        '/inputSnapshot/regulatoryProfileRef',
        '/inputSnapshot/enterpriseProfileSnapshotRef',
        '/inputSnapshot/qmsConfigurationRef',
        '/inputSnapshot/productScopeSnapshotRef',
        '/inputSnapshot/analysisPolicyRef',
        '/findings/0/customerBaselineItemRefs/0',
        '/findings/0/informationRequestRefs/0',
      ]),
    );
    expect(edges.rows).toHaveLength(10);
    if (!stored.input) throw new Error('expected the frozen input snapshot to be stored');

    await expect(
      admin.query(
        `UPDATE enterprise_project.gap_analysis_input_snapshot
            SET payload = '{}'::jsonb
          WHERE input_snapshot_id = $1`,
        [stored.input.input_snapshot_id],
      ),
    ).rejects.toThrow(/gap_analysis_input_snapshot history is immutable/);
    await expect(
      admin.query(
        `UPDATE enterprise_project.gap_analysis_version
            SET requested_scope = '{}'::jsonb
          WHERE version_id = $1`,
        [started.gapRef.versionId],
      ),
    ).rejects.toThrow(/gap_analysis_version content is immutable/);
    await expect(
      admin.query(
        `UPDATE enterprise_project.gap_finding
            SET rationale = '{"tampered":true}'::jsonb
          WHERE version_id = $1`,
        [started.gapRef.versionId],
      ),
    ).rejects.toThrow(/gap_finding history is immutable/);
  });

  it('EP-WI09-P-001/P-002: rejects latest, hash mismatch and UNKNOWN-to-MISSING conversion', async () => {
    const fixture = await seedFixture(admin);
    const context = contextFor(fixture.enterpriseId, fixture.projectId);
    const latestInput: EnterpriseProject.GapInputSnapshot = {
      ...inputSnapshot(fixture),
      customerBaselineRef: {
        ...inputSnapshot(fixture).customerBaselineRef,
        versionId: 'latest',
      },
    };
    const latestPayload = {
      ...startPayload(fixture),
      inputSnapshot: latestInput,
    } as EnterpriseProject.ProjectStartGapAnalysisPayload;
    const latestResult = await handleStartGapAnalysis(
      db,
      context,
      commandEnvelope(context, 'project.start_gap_analysis', 'reject-latest-input', latestPayload, {
        projectId: fixture.projectId,
        targetType: 'GapAnalysis',
        targetId: newUuidV7(),
      }),
    );
    expect(latestResult).toMatchObject({
      status: 'REJECTED',
      errorCode: PROJECT_GAP_INPUT_INCOMPLETE,
    });

    await expect(
      handleStartGapAnalysis(
        db,
        context,
        commandEnvelope(
          context,
          'project.start_gap_analysis',
          'reject-invalid-mode',
          {
            ...startPayload(fixture),
            mode: 'INVALID',
          } as unknown as EnterpriseProject.ProjectStartGapAnalysisPayload,
          { projectId: fixture.projectId, targetType: 'GapAnalysis', targetId: newUuidV7() },
        ),
      ),
    ).rejects.toMatchObject({ code: PROJECT_GAP_STATUS_INVALID });

    const wrongHashInput: EnterpriseProject.GapInputSnapshot = {
      ...inputSnapshot(fixture),
      enterpriseProfileSnapshotRef: {
        ...inputSnapshot(fixture).enterpriseProfileSnapshotRef,
        contentHash: hashValue(Buffer.alloc(32, 0xd1)),
      },
    };
    const wrongHashResult = await handleStartGapAnalysis(
      db,
      context,
      commandEnvelope(
        context,
        'project.start_gap_analysis',
        'reject-profile-hash',
        { ...startPayload(fixture), inputSnapshot: wrongHashInput },
        { projectId: fixture.projectId, targetType: 'GapAnalysis', targetId: newUuidV7() },
      ),
    );
    expect(wrongHashResult).toMatchObject({
      status: 'REJECTED',
      errorCode: PROJECT_GAP_INPUT_HASH_MISMATCH,
    });

    const wrongIdentityInput: EnterpriseProject.GapInputSnapshot = {
      ...inputSnapshot(fixture),
      enterpriseProfileSnapshotRef: {
        ...inputSnapshot(fixture).enterpriseProfileSnapshotRef,
        objectId: newUuidV7(),
      },
    };
    const wrongIdentityResult = await handleStartGapAnalysis(
      db,
      context,
      commandEnvelope(
        context,
        'project.start_gap_analysis',
        'reject-profile-identity',
        { ...startPayload(fixture), inputSnapshot: wrongIdentityInput },
        { projectId: fixture.projectId, targetType: 'GapAnalysis', targetId: newUuidV7() },
      ),
    );
    expect(wrongIdentityResult).toMatchObject({
      status: 'REJECTED',
      errorCode: PROJECT_GAP_SCOPE_MISMATCH,
    });

    const missingInput = {
      ...inputSnapshot(fixture),
      analysisPolicyRef: undefined,
    } as unknown as EnterpriseProject.GapInputSnapshot;
    await expect(
      handleStartGapAnalysis(
        db,
        context,
        commandEnvelope(
          context,
          'project.start_gap_analysis',
          'reject-missing-input',
          { ...startPayload(fixture), inputSnapshot: missingInput },
          { projectId: fixture.projectId, targetType: 'GapAnalysis', targetId: newUuidV7() },
        ),
      ),
    ).rejects.toMatchObject({ code: PROJECT_GAP_INPUT_INCOMPLETE });

    const scopeMismatchInput: EnterpriseProject.GapInputSnapshot = {
      ...inputSnapshot(fixture),
      customerBaselineRef: {
        ...inputSnapshot(fixture).customerBaselineRef,
        scope: { enterpriseId: fixture.enterpriseId, projectId: newUuidV7() },
      },
    };
    const scopeMismatchResult = await handleStartGapAnalysis(
      db,
      context,
      commandEnvelope(
        context,
        'project.start_gap_analysis',
        'reject-project-scope',
        { ...startPayload(fixture), inputSnapshot: scopeMismatchInput },
        { projectId: fixture.projectId, targetType: 'GapAnalysis', targetId: newUuidV7() },
      ),
    );
    expect(scopeMismatchResult).toMatchObject({
      status: 'REJECTED',
      errorCode: PROJECT_GAP_SCOPE_MISMATCH,
    });

    const unknownToMissing = {
      ...findingFixture(fixture),
      gapStatus: 'MISSING',
      sourceState: 'UNKNOWN',
    } as CanonicalJsonObject;
    await expect(
      handleStartGapAnalysis(
        db,
        context,
        commandEnvelope(
          context,
          'project.start_gap_analysis',
          'reject-unknown-to-missing',
          startPayload(fixture, unknownToMissing),
          { projectId: fixture.projectId, targetType: 'GapAnalysis', targetId: newUuidV7() },
        ),
      ),
    ).rejects.toMatchObject({ code: PROJECT_GAP_EPISTEMIC_CONFLICT });

    const highRiskWithoutEvidence = {
      ...findingFixture(fixture),
      severity: 'CRITICAL',
      evidenceRefs: [],
      informationRequestRefs: [],
    } as CanonicalJsonObject;
    await expect(
      handleStartGapAnalysis(
        db,
        context,
        commandEnvelope(
          context,
          'project.start_gap_analysis',
          'reject-high-risk-without-evidence',
          startPayload(fixture, highRiskWithoutEvidence),
          { projectId: fixture.projectId, targetType: 'GapAnalysis', targetId: newUuidV7() },
        ),
      ),
    ).rejects.toMatchObject({ code: PROJECT_GAP_EPISTEMIC_CONFLICT });

    const roots = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM enterprise_project.gap_analysis
        WHERE project_id = $1`,
      [fixture.projectId],
    );
    expect(roots.rows[0]?.count).toBe('0');
  });

  it('EP-WI09-U-003/C-001: enforces Human-only decisions, immutable decision facts and CAS', async () => {
    const fixture = await seedFixture(admin);
    const humanContext = contextFor(fixture.enterpriseId, fixture.projectId);
    const started = await startGap(db, fixture, humanContext, 'decision-target');

    const agentContext = contextFor(fixture.enterpriseId, fixture.projectId, 'AGENT');
    const serviceContext = contextFor(fixture.enterpriseId, fixture.projectId, 'SERVICE');
    await expect(
      acceptGap(db, fixture, agentContext, started.gapRef, 'agent-accept'),
    ).rejects.toMatchObject({ code: PROJECT_GAP_HUMAN_ACCEPTANCE_REQUIRED });
    await expect(
      acceptGap(db, fixture, serviceContext, started.gapRef, 'service-accept'),
    ).rejects.toMatchObject({ code: PROJECT_GAP_HUMAN_ACCEPTANCE_REQUIRED });
    await expect(
      acceptGap(
        db,
        fixture,
        humanContext,
        started.gapRef,
        'acting-for-accept',
        'ACCEPT',
        '1',
        true,
      ),
    ).rejects.toMatchObject({ code: PROJECT_GAP_HUMAN_ACCEPTANCE_REQUIRED });

    const accepted = await acceptGap(db, fixture, humanContext, started.gapRef, 'human-accept');
    expect(accepted.result.status).toBe('COMMITTED');
    const acceptedDuplicate = await handleAcceptGapAnalysis(db, humanContext, accepted.envelope);
    expect(acceptedDuplicate).toMatchObject({
      status: 'DUPLICATE',
      originalOutcome: 'COMMITTED',
    });

    const acceptedState = await withEnterpriseProjectTransaction(db, humanContext, async (trx) => {
      const repository = new GapAnalysisRepository();
      return {
        root: await repository.getGapAnalysisById(trx, started.gapRef.objectId),
        version: await repository.getGapAnalysisVersion(trx, started.gapRef.versionId),
        decision: await repository.getGapAnalysisDecision(
          trx,
          (
            committedPayload(accepted.result)
              .acceptanceDecisionRef as unknown as Common.ContentAddressedRef
          ).objectId,
        ),
      };
    });
    expect(acceptedState.root).toMatchObject({
      status: 'ACCEPTED',
      current_version_id: started.gapRef.versionId,
      accepted_version_id: started.gapRef.versionId,
    });
    expect(aggregateVersion(acceptedState.root?.aggregate_version)).toBe('2');
    expect(acceptedState.version?.version_status).toBe('ACCEPTED');
    expect(acceptedState.decision).toMatchObject({
      gap_analysis_id: started.gapRef.objectId,
      version_id: started.gapRef.versionId,
      disposition: 'ACCEPT',
      decided_by_principal_id: HUMAN_PRINCIPAL,
    });

    await expect(
      admin.query(
        `UPDATE enterprise_project.gap_analysis_decision
            SET justification = '{"tampered":true}'::jsonb
          WHERE gap_analysis_id = $1`,
        [started.gapRef.objectId],
      ),
    ).rejects.toThrow(/gap_analysis_decision history is immutable/);

    const acceptedEvent = await admin.query<{ payload: Record<string, unknown> }>(
      `SELECT payload
         FROM enterprise_project.outbox_event
        WHERE event_type = 'project.GapAnalysisAccepted'
          AND aggregate_id = $1`,
      [started.gapRef.objectId],
    );
    expect(acceptedEvent.rows).toHaveLength(1);
    expect(acceptedEvent.rows[0]?.payload).toMatchObject({
      gapAnalysisRef: started.gapRef,
      projectRef: objectRef('Project', fixture.projectId, fixture.enterpriseId, fixture.projectId),
      inputSnapshotRef: {
        objectType: 'GapInput',
        objectId: started.gapRef.objectId,
        scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
      },
      acceptanceDecisionRef: {
        objectType: 'BusinessDecision',
        scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
      },
    });

    const changes = await startGap(db, fixture, humanContext, 'changes-target');
    const rejected = await startGap(db, fixture, humanContext, 'reject-target');
    const changesResult = await acceptGap(
      db,
      fixture,
      humanContext,
      changes.gapRef,
      'changes-decision',
      'CHANGES_REQUIRED',
    );
    const rejectedResult = await acceptGap(
      db,
      fixture,
      humanContext,
      rejected.gapRef,
      'reject-decision',
      'REJECT',
    );
    expect(changesResult.result).toMatchObject({ status: 'COMMITTED' });
    expect(rejectedResult.result).toMatchObject({ status: 'COMMITTED' });
    const nonAccepted = await admin.query<{
      gap_analysis_id: string;
      status: string;
      accepted_version_id: string | null;
    }>(
      `SELECT gap_analysis_id, status, accepted_version_id
         FROM enterprise_project.gap_analysis
        WHERE gap_analysis_id IN ($1, $2)
        ORDER BY gap_analysis_id`,
      [changes.gapRef.objectId, rejected.gapRef.objectId],
    );
    expect(nonAccepted.rows).toEqual(
      expect.arrayContaining([
        {
          gap_analysis_id: changes.gapRef.objectId,
          status: 'CHANGES_REQUIRED',
          accepted_version_id: null,
        },
        {
          gap_analysis_id: rejected.gapRef.objectId,
          status: 'REJECTED',
          accepted_version_id: null,
        },
      ]),
    );

    const concurrent = await startGap(db, fixture, humanContext, 'concurrent-target');
    const concurrentContext = contextFor(fixture.enterpriseId, fixture.projectId);
    const [first, second] = await Promise.all([
      acceptGap(db, fixture, humanContext, concurrent.gapRef, 'concurrent-accept', 'ACCEPT'),
      acceptGap(
        db,
        fixture,
        concurrentContext,
        concurrent.gapRef,
        'concurrent-changes',
        'CHANGES_REQUIRED',
      ),
    ]);
    const outcomes = [first.result, second.result];
    expect(outcomes.filter((result) => result.status === 'COMMITTED')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'REJECTED')).toHaveLength(1);
    expect(outcomes.find((result) => result.status === 'REJECTED')).toMatchObject({
      errorCode: CONCURRENCY_CONFLICT,
      currentAggregateVersion: '2',
    });
  });

  it('EP-WI09-E-001/M-001: marks accepted facts stale while retaining old input, findings and decision', async () => {
    const fixture = await seedFixture(admin);
    const context = contextFor(fixture.enterpriseId, fixture.projectId);
    const started = await startGap(db, fixture, context, 'stale-target');
    const accepted = await acceptGap(db, fixture, context, started.gapRef, 'stale-accept');
    expect(accepted.result.status).toBe('COMMITTED');

    const draftPayload: EnterpriseProject.ProjectCreateCustomerBaselineDraftPayload = {
      projectRef: objectRef('Project', fixture.projectId, fixture.enterpriseId, fixture.projectId),
      previousVersionRef: projectVersionedRef(
        'CustomerBaseline',
        fixture.customerBaselineId,
        fixture.customerBaselineVersionId,
        fixture.enterpriseId,
        fixture.projectId,
      ),
      expectations: [
        {
          expectationId: newUuidV7(),
          expectedMaterialKey: 'fixture.replacement',
          materialType: 'quality.procedure',
          expectedTitleOrRole: 'Fixture replacement fact',
          status: 'UNKNOWN',
          customerMaterialRefs: [],
          reason: justification('BASELINE_REPLACEMENT_DRAFT'),
        },
      ],
      baselinePolicyRef: projectVersionedRef(
        'Policy',
        newUuidV7(),
        newUuidV7(),
        fixture.enterpriseId,
        fixture.projectId,
      ),
    };
    const draft = await handleCreateCustomerBaselineDraft(
      db,
      context,
      commandEnvelope(
        context,
        'project.create_customer_baseline_draft',
        'new-baseline-draft',
        draftPayload,
        {
          projectId: fixture.projectId,
          targetType: 'CustomerBaseline',
          targetId: fixture.customerBaselineId,
          expectedAggregateVersion: '1',
        },
      ),
    );
    const draftRef = (
      committedPayload(draft) as unknown as {
        customerBaselineRef: Common.VersionedRef;
      }
    ).customerBaselineRef;

    const activation = await handleActivateCustomerBaselineVersion(
      db,
      context,
      commandEnvelope(
        context,
        'project.activate_customer_baseline_version',
        'new-baseline-activation',
        {
          baselineVersionRef: draftRef,
          reviewSnapshotRef: projectSnapshotRef(
            fixture.enterpriseId,
            fixture.projectId,
            'BaselineReview',
          ),
          impactPolicyRef: projectVersionedRef(
            'Policy',
            newUuidV7(),
            newUuidV7(),
            fixture.enterpriseId,
            fixture.projectId,
          ),
          justification: justification('BASELINE_ACTIVATION'),
        },
        {
          projectId: fixture.projectId,
          targetType: 'CustomerBaseline',
          targetId: fixture.customerBaselineId,
          expectedAggregateVersion: '2',
        },
      ),
    );
    expect(activation.status).toBe('COMMITTED');

    const staleState = await withEnterpriseProjectTransaction(db, context, async (trx) => {
      const repository = new GapAnalysisRepository();
      const root = await repository.getGapAnalysisById(trx, started.gapRef.objectId);
      const version = await repository.getGapAnalysisVersion(trx, started.gapRef.versionId);
      const findings = await repository.getGapFindings(trx, started.gapRef.versionId);
      const input = version
        ? await repository.getGapAnalysisInputSnapshot(trx, version.input_snapshot_id)
        : undefined;
      const decision = await trx
        .selectFrom('enterprise_project.gap_analysis_decision')
        .selectAll()
        .where('gap_analysis_id', '=', started.gapRef.objectId)
        .executeTakeFirst();
      return { root, version, input, findings, decision };
    });
    const impact = await admin.query<{
      impact_review_id: string;
      impact_status: string;
      stale_references: unknown[];
    }>(
      `SELECT impact_review_id, impact_status, stale_references
         FROM enterprise_project.customer_baseline_impact_review
        WHERE customer_baseline_id = $1 AND new_version_id = $2`,
      [fixture.customerBaselineId, draftRef.versionId],
    );
    expect(impact.rows).toHaveLength(1);
    expect(impact.rows[0]).toMatchObject({ impact_status: 'STALE' });
    expect(impact.rows[0]?.stale_references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ownerObjectType: 'GapAnalysis',
          ownerObjectId: started.gapRef.objectId,
          targetVersionId: fixture.customerBaselineVersionId,
        }),
      ]),
    );
    expect(staleState.root).toMatchObject({
      status: 'STALE',
      current_version_id: started.gapRef.versionId,
      accepted_version_id: null,
    });
    expect(aggregateVersion(staleState.root?.aggregate_version)).toBe('3');
    expect(staleState.version).toMatchObject({
      version_id: started.gapRef.versionId,
      version_status: 'STALE',
      stale_reason: expect.objectContaining({
        reasonCode: 'CUSTOMER_BASELINE_VERSION_ACTIVATED',
        triggeringRef: draftRef,
        previousActiveRef: expect.objectContaining({
          versionId: fixture.customerBaselineVersionId,
        }),
        impactReviewId: impact.rows[0]?.impact_review_id,
      }),
    });
    expect(staleState.input).toMatchObject({
      customer_baseline_version_id: fixture.customerBaselineVersionId,
    });
    expect(staleState.findings).toHaveLength(1);
    expect(staleState.decision).toMatchObject({ disposition: 'ACCEPT' });

    const staleAgain = await withEnterpriseProjectTransaction(db, context, async (trx) =>
      new GapAnalysisRepository().markGapAnalysesStaleForDependency(
        trx,
        {
          kind: 'CustomerBaseline',
          objectId: fixture.customerBaselineId,
          versionId: draftRef.versionId,
        },
        fixture.enterpriseId,
        fixture.projectId,
        { dependency: 'CustomerBaseline', explanation: 'same replacement replay' },
        newUuidV7(),
      ),
    );
    expect(staleAgain).toBe(0);
  });
});
