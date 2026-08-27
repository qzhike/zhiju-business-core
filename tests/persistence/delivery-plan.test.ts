// IM-03 WI-10 (issue #66): real PostgreSQL acceptance for DeliveryPlan draft,
// Human approval, exact activation, dependency validation and immutable facts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  CONCURRENCY_CONFLICT,
  createEnterpriseProjectDatabase,
  DeliveryPlanRepository,
  handleActivateDeliveryPlan,
  handleApproveDeliveryPlan,
  handleCreateDeliveryPlanDraft,
  handleGetActiveBaselineRefs,
  handleGetDeliveryItemCriteria,
  PROJECT_DELIVERY_APPROVAL_DECISION_INVALID,
  PROJECT_DELIVERY_DEPENDENCY_CYCLE,
  PROJECT_DELIVERY_GAP_NOT_ACCEPTED,
  PROJECT_DELIVERY_ITEM_KEY_CONFLICT,
  PROJECT_DELIVERY_PLAN_HUMAN_APPROVAL_REQUIRED,
  withEnterpriseProjectTransaction,
  digestCanonicalPayload,
  type CommandEnvelope,
  type CommandResult,
  type DeliveryPlanDecision,
  type EnterprisePrincipalKind,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Common, EnterpriseProject } from '@zhiju/contracts';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const HUMAN_PRINCIPAL = 'b1b1b1b1-b1b1-71b1-81b1-b1b1b1b1b1b1';
const AGENT_PRINCIPAL = 'b2b2b2b2-b2b2-72b2-82b2-b2b2b2b2b2b2';
const SERVICE_PRINCIPAL = 'b3b3b3b3-b3b3-73b3-83b3-b3b3b3b3b3b3';
const HUMAN_ACTOR = 'b4b4b4b4-b4b4-74b4-84b4-b4b4b4b4b4b4';
const AGENT_ACTOR = 'b5b5b5b5-b5b5-75b5-85b5-b5b5b5b5b5b5';
const SERVICE_ACTOR = 'b6b6b6b6-b6b6-76b6-86b6-b6b6b6b6b6b6';
const AUTHORIZATION_DECISION = 'b7b7b7b7-b7b7-77b7-87b7-b7b7b7b7b7b7';
const POLICY_SNAPSHOT = 'b8b8b8b8-b8b8-78b8-88b8-b8b8b8b8b8b8';
const DECISION_HASH = Buffer.alloc(32, 0xb8);

function contextFor(
  enterpriseId: string,
  projectId: string,
  principalKind: EnterprisePrincipalKind = 'HUMAN',
): EnterpriseProjectTransactionContext {
  const principalId =
    principalKind === 'HUMAN'
      ? HUMAN_PRINCIPAL
      : principalKind === 'AGENT'
        ? AGENT_PRINCIPAL
        : SERVICE_PRINCIPAL;
  const actorSnapshotId =
    principalKind === 'HUMAN'
      ? HUMAN_ACTOR
      : principalKind === 'AGENT'
        ? AGENT_ACTOR
        : SERVICE_ACTOR;
  return {
    kind: 'REQUEST',
    principalId,
    principalKind,
    actorSnapshotId,
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
  objectType = 'DeliveryPlanReview',
): Common.SnapshotRef {
  const snapshotId = newUuidV7();
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: snapshotId,
    snapshotId,
    scope: { enterpriseId, projectId },
    contentHash: hashValue(Buffer.alloc(32, 0xd1)),
  };
}

function justification(reasonCode: string): EnterpriseProject.Justification {
  return {
    reasonCode,
    summary: 'The exact DeliveryPlan version was reviewed by a Human.',
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
    idempotencyScope: 'im03.wi10',
    idempotencyKey,
    requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
    enterpriseId: context.enterpriseId,
    projectId: undefined,
    targetType: 'DeliveryPlan',
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

function asAggregateVersion(value: unknown): string {
  return String(value);
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
  readonly qualityProfileId: string;
  readonly qualityProfileVersionId: string;
  readonly gapAnalysisId: string;
  readonly gapVersionId: string;
  readonly gapInputSnapshotId: string;
  readonly gapFindingId: string;
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
  const qualityProfileId = newUuidV7();
  const qualityProfileVersionId = newUuidV7();
  const gapAnalysisId = newUuidV7();
  const gapVersionId = newUuidV7();
  const gapInputSnapshotId = newUuidV7();
  const gapFindingId = newUuidV7();
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
  const enterpriseProfilePayload = { enterpriseId, displayName: 'WI-10 fixture enterprise' };
  const productScopePayload = {
    enterpriseId,
    productId,
    productType: 'fixture.product',
    displayName: 'WI-10 fixture product',
  };
  const productScopeRef = enterpriseSnapshotRef(
    'ProductScopeSnapshot',
    productId,
    productScopeSnapshotId,
    enterpriseId,
    productScopePayloadHash,
  );
  const enterpriseProfileRef = enterpriseSnapshotRef(
    'EnterpriseProfileSnapshot',
    enterpriseProfileSnapshotId,
    enterpriseProfileSnapshotId,
    enterpriseId,
    enterpriseProfilePayloadHash,
  );
  const customerBaselineRef = projectVersionedRef(
    'CustomerBaseline',
    customerBaselineId,
    customerBaselineVersionId,
    enterpriseId,
    projectId,
  );
  const templateBaselineRef = projectVersionedRef(
    'TemplateBaseline',
    templateBaselineId,
    templateBaselineVersionId,
    enterpriseId,
    projectId,
  );
  const regulatoryProfileRef = projectVersionedRef(
    'RegulatoryProfile',
    regulatoryProfileId,
    regulatoryProfileVersionId,
    enterpriseId,
    projectId,
  );
  const qmsRef = enterpriseVersionedRef(
    'QMSConfiguration',
    qmsConfigurationId,
    qmsRevisionId,
    enterpriseId,
  );
  const analysisPolicyRef = projectVersionedRef(
    'Policy',
    analysisPolicyId,
    analysisPolicyVersionId,
    enterpriseId,
    projectId,
  );
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
        `WI10-${projectId.slice(-8)}`,
        'WI-10 DeliveryPlan fixture',
        'Exercise exact accepted Gap input, Human decisions and active Plan CAS.',
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
        `WI10-P-${productId.slice(-8)}`,
        'WI-10 fixture product',
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
        'WI10_TEST',
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
        'WI10_TEST',
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
        `WI10-QMS-${qmsConfigurationId.slice(-8)}`,
        'WI-10 fixture QMS',
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
        JSON.stringify(productScopeRef),
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
    await admin.query(
      `INSERT INTO enterprise_project.gap_analysis
         (gap_analysis_id, enterprise_id, project_id, current_version_id,
          accepted_version_id, status, created_by_principal_id,
          created_by_actor_snapshot_id, last_command_id)
       VALUES ($1, $2, $3, $4, $4, 'ACCEPTED', $5, $6, $7)`,
      [
        gapAnalysisId,
        enterpriseId,
        projectId,
        gapVersionId,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.gap_analysis_input_snapshot
         (input_snapshot_id, gap_analysis_id, version_id, enterprise_id, project_id,
          customer_baseline_ref, customer_baseline_id, customer_baseline_version_id,
          template_baseline_ref, template_baseline_id, template_baseline_version_id,
          regulatory_profile_ref, regulatory_profile_id, regulatory_profile_version_id,
          enterprise_profile_snapshot_ref, enterprise_profile_snapshot_id,
          enterprise_profile_payload_hash, qms_configuration_ref,
          qms_configuration_id, qms_configuration_revision_id,
          qms_configuration_revision_hash, product_scope_snapshot_ref,
          product_scope_snapshot_id, product_scope_payload_hash, analysis_policy_ref,
          analysis_policy_id, analysis_policy_version_id, payload, payload_hash,
          recorded_by_principal_id, recorded_by_actor_snapshot_id,
          authorization_decision_id, source_command_id)
       VALUES ($1, $2, $3, $4, $5,
          $6::jsonb, $7, $8, $9::jsonb, $10, $11, $12::jsonb, $13, $14,
          $15::jsonb, $16, $17, $18::jsonb, $19, $20, $21,
          $22::jsonb, $23, $24, $25::jsonb, $26, $27,
          '{"fixture":"wi10"}'::jsonb, $28, $29, $30, $31, $32)`,
      [
        gapInputSnapshotId,
        gapAnalysisId,
        gapVersionId,
        enterpriseId,
        projectId,
        JSON.stringify(customerBaselineRef),
        customerBaselineId,
        customerBaselineVersionId,
        JSON.stringify(templateBaselineRef),
        templateBaselineId,
        templateBaselineVersionId,
        JSON.stringify(regulatoryProfileRef),
        regulatoryProfileId,
        regulatoryProfileVersionId,
        JSON.stringify(enterpriseProfileRef),
        enterpriseProfileSnapshotId,
        enterpriseProfilePayloadHash,
        JSON.stringify(qmsRef),
        qmsConfigurationId,
        qmsRevisionId,
        qmsRevisionPayloadHash,
        JSON.stringify(productScopeRef),
        productScopeSnapshotId,
        productScopePayloadHash,
        JSON.stringify(analysisPolicyRef),
        analysisPolicyId,
        analysisPolicyVersionId,
        genericPayloadHash,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        AUTHORIZATION_DECISION,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.gap_analysis_version
         (version_id, gap_analysis_id, enterprise_id, project_id, version_no,
          version_status, mode, input_snapshot_id, requested_scope,
          findings_summary, payload, payload_hash, created_by_principal_id,
          created_by_actor_snapshot_id, authorization_decision_id, source_command_id)
       VALUES ($1, $2, $3, $4, 1, 'ACCEPTED', 'FORMAL', $5,
          '{"fixture":"wi10"}'::jsonb, '{"findingCount":1}'::jsonb,
          '{"fixture":"wi10"}'::jsonb, $6, $7, $8, $9, $10)`,
      [
        gapVersionId,
        gapAnalysisId,
        enterpriseId,
        projectId,
        gapInputSnapshotId,
        genericPayloadHash,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        AUTHORIZATION_DECISION,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.gap_finding
         (finding_id, gap_analysis_id, version_id, enterprise_id, project_id,
          subject_key, subject_type, customer_baseline_item_refs, template_refs,
          regulatory_item_refs, gap_status, severity, rationale, evidence_refs,
          recommended_action, information_request_refs, payload_hash,
          recorded_by_principal_id, recorded_by_actor_snapshot_id,
          authorization_decision_id, source_command_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, '[]'::jsonb, '[]'::jsonb,
          'UNKNOWN', 'MEDIUM', '{"reasonCode":"WI10_FIXTURE"}'::jsonb,
          '[]'::jsonb, 'NEED_INFORMATION', '[]'::jsonb, $9, $10, $11, $12, $13)`,
      [
        gapFindingId,
        gapAnalysisId,
        gapVersionId,
        enterpriseId,
        projectId,
        `fixture.finding.${gapFindingId.slice(-8)}`,
        'ControlRequirement',
        JSON.stringify([
          projectVersionedRef(
            'CustomerBaselineItem',
            customerBaselineItemId,
            customerBaselineVersionId,
            enterpriseId,
            projectId,
          ),
        ]),
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
    qualityProfileId,
    qualityProfileVersionId,
    gapAnalysisId,
    gapVersionId,
    gapInputSnapshotId,
    gapFindingId,
  };
}

function acceptedGapRef(fixture: Fixture): Common.VersionedRef {
  return projectVersionedRef(
    'GapAnalysis',
    fixture.gapAnalysisId,
    fixture.gapVersionId,
    fixture.enterpriseId,
    fixture.projectId,
  );
}

function qualityProfileRef(fixture: Fixture): Common.VersionedRef {
  return projectVersionedRef(
    'QualityProfile',
    fixture.qualityProfileId,
    fixture.qualityProfileVersionId,
    fixture.enterpriseId,
    fixture.projectId,
  );
}

function planQualityPolicyRef(fixture: Fixture): Common.VersionedRef {
  return projectVersionedRef(
    'Policy',
    fixture.analysisPolicyId,
    fixture.analysisPolicyVersionId,
    fixture.enterpriseId,
    fixture.projectId,
  );
}

function baselineRefs(fixture: Fixture): readonly Common.TypedReference[] {
  return [
    projectVersionedRef(
      'CustomerBaseline',
      fixture.customerBaselineId,
      fixture.customerBaselineVersionId,
      fixture.enterpriseId,
      fixture.projectId,
    ),
    projectVersionedRef(
      'TemplateBaseline',
      fixture.templateBaselineId,
      fixture.templateBaselineVersionId,
      fixture.enterpriseId,
      fixture.projectId,
    ),
    projectVersionedRef(
      'RegulatoryProfile',
      fixture.regulatoryProfileId,
      fixture.regulatoryProfileVersionId,
      fixture.enterpriseId,
      fixture.projectId,
    ),
    enterpriseVersionedRef(
      'QMSConfiguration',
      fixture.qmsConfigurationId,
      fixture.qmsRevisionId,
      fixture.enterpriseId,
    ),
    enterpriseSnapshotRef(
      'ProductScopeSnapshot',
      fixture.productId,
      fixture.productScopeSnapshotId,
      fixture.enterpriseId,
      fixture.productScopePayloadHash,
    ),
  ];
}

function deliveryItem(
  fixture: Fixture,
  itemId: string,
  itemKey: string,
  dependencyItemIds: readonly string[] = [],
  completionCriteria: CanonicalJsonObject = { required: true, itemKey },
): EnterpriseProject.DeliveryItemDefinition {
  return {
    itemId,
    itemKey,
    itemType: 'control.implementation',
    title: `Delivery item ${itemKey}`,
    objective: `Complete ${itemKey} from the accepted Gap finding.`,
    sourceGapItemRefs: [
      projectVersionedRef(
        'GapItem',
        fixture.gapFindingId,
        fixture.gapVersionId,
        fixture.enterpriseId,
        fixture.projectId,
      ),
    ],
    dependencyItemIds,
    targetArtifactTypes: ['delivery.document', 'delivery.evidence'],
    qualityProfileRef: qualityProfileRef(fixture),
    completionCriteria,
    dueConstraint: { kind: 'RELATIVE_DAYS', days: 10 },
    commitmentStatus: 'PROPOSED',
  };
}

function createPayload(
  fixture: Fixture,
  items?: readonly EnterpriseProject.DeliveryItemDefinition[],
): EnterpriseProject.ProjectCreateDeliveryPlanDraftPayload {
  const firstItemId = newUuidV7();
  const defaultItems = [
    deliveryItem(fixture, firstItemId, 'design'),
    deliveryItem(fixture, newUuidV7(), 'verification', [firstItemId]),
  ];
  return {
    projectRef: objectRef('Project', fixture.projectId, fixture.enterpriseId, fixture.projectId),
    acceptedGapAnalysisRef: acceptedGapRef(fixture),
    baselineRefs: baselineRefs(fixture),
    items: items ?? defaultItems,
    assumptions: ['The accepted Gap finding is the sole source of this fixture plan.'],
    exclusions: ['Task, Artifact and Release execution are outside WI-10.'],
    planQualityPolicyRef: planQualityPolicyRef(fixture),
  };
}

interface PlanRun {
  readonly envelope: CommandEnvelope & {
    payload: EnterpriseProject.ProjectCreateDeliveryPlanDraftPayload;
  };
  readonly result: CommandResult;
  readonly planRef: Common.VersionedRef;
  readonly itemIds: readonly string[];
}

async function createPlan(
  db: ReturnType<typeof createEnterpriseProjectDatabase>,
  fixture: Fixture,
  context: EnterpriseProjectTransactionContext,
  idempotencyKey: string,
  payload = createPayload(fixture),
  targetId = newUuidV7(),
): Promise<PlanRun> {
  const envelope = commandEnvelope(
    context,
    'project.create_delivery_plan_draft',
    idempotencyKey,
    payload,
    { projectId: fixture.projectId, targetType: 'DeliveryPlan', targetId },
  );
  const result = await handleCreateDeliveryPlanDraft(db, context, envelope);
  const committed = committedPayload(result);
  return {
    envelope,
    result,
    planRef: committed.deliveryPlanRef as unknown as Common.VersionedRef,
    itemIds: payload.items.map((item) => item.itemId),
  };
}

function approvePayload(
  fixture: Fixture,
  planRef: Common.VersionedRef,
  decision: DeliveryPlanDecision,
): EnterpriseProject.ProjectApproveDeliveryPlanPayload {
  return {
    deliveryPlanVersionRef: planRef,
    reviewSnapshotRef: projectSnapshotRef(fixture.enterpriseId, fixture.projectId),
    decision,
    justification: justification(`DELIVERY_PLAN_${decision}`),
  };
}

async function approvePlan(
  db: ReturnType<typeof createEnterpriseProjectDatabase>,
  fixture: Fixture,
  context: EnterpriseProjectTransactionContext,
  plan: PlanRun,
  idempotencyKey: string,
  decision: DeliveryPlanDecision = 'APPROVE',
): Promise<{
  envelope: CommandEnvelope & { payload: EnterpriseProject.ProjectApproveDeliveryPlanPayload };
  result: CommandResult;
}> {
  const payload = approvePayload(fixture, plan.planRef, decision);
  const envelope = commandEnvelope(
    context,
    'project.approve_delivery_plan',
    idempotencyKey,
    payload,
    {
      projectId: fixture.projectId,
      targetType: 'DeliveryPlan',
      targetId: plan.planRef.objectId,
      expectedAggregateVersion: '1',
    },
  );
  return { envelope, result: await handleApproveDeliveryPlan(db, context, envelope) };
}

function activationPayload(
  fixture: Fixture,
  planRef: Common.VersionedRef,
  approvalDecisionRef: Common.ContentAddressedRef,
): EnterpriseProject.ProjectActivateDeliveryPlanPayload {
  return {
    deliveryPlanVersionRef: planRef,
    approvalDecisionRef,
    activatedAt: '2026-08-27T12:00:00.000Z',
    impactPolicyRef: planQualityPolicyRef(fixture),
  };
}

async function activatePlan(
  db: ReturnType<typeof createEnterpriseProjectDatabase>,
  fixture: Fixture,
  context: EnterpriseProjectTransactionContext,
  planRef: Common.VersionedRef,
  approvalDecisionRef: Common.ContentAddressedRef,
  idempotencyKey: string,
  expectedAggregateVersion = '2',
): Promise<{
  envelope: CommandEnvelope & { payload: EnterpriseProject.ProjectActivateDeliveryPlanPayload };
  result: CommandResult;
}> {
  const payload = activationPayload(fixture, planRef, approvalDecisionRef);
  const envelope = commandEnvelope(
    context,
    'project.activate_delivery_plan',
    idempotencyKey,
    payload,
    {
      projectId: fixture.projectId,
      targetType: 'DeliveryPlan',
      targetId: planRef.objectId,
      expectedAggregateVersion,
    },
  );
  return { envelope, result: await handleActivateDeliveryPlan(db, context, envelope) };
}

async function readPlanState(
  db: ReturnType<typeof createEnterpriseProjectDatabase>,
  context: EnterpriseProjectTransactionContext,
  planRef: Common.VersionedRef,
) {
  return withEnterpriseProjectTransaction(db, context, async (trx) => {
    const repository = new DeliveryPlanRepository();
    const items = await repository.getDeliveryItems(trx, planRef.versionId);
    const requirements = (
      await Promise.all(
        items.map((item) =>
          repository.getDeliveryItemArtifactRequirements(
            trx,
            planRef.versionId,
            item.delivery_item_id,
          ),
        ),
      )
    ).flat();
    return {
      root: await repository.getDeliveryPlanById(trx, planRef.objectId),
      version: await repository.getDeliveryPlanVersion(trx, planRef.versionId),
      items,
      requirements,
      dependencies: await repository.getDeliveryItemDependencies(trx, planRef.versionId),
    };
  });
}

describe.skipIf(!gateEnabled)('DeliveryPlan WI-10 (real PostgreSQL)', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createEnterpriseProjectDatabase>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `DO $do$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'im03_wi10_probe') THEN
           CREATE ROLE im03_wi10_probe LOGIN PASSWORD 'im03-wi10-probe'
             NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
         END IF;
       END $do$`,
    );
    await admin.query(
      `GRANT platform_context_establisher, enterprise_project_app TO im03_wi10_probe`,
    );
    const url = new URL(databaseUrl ?? '');
    url.username = 'im03_wi10_probe';
    url.password = 'im03-wi10-probe';
    pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
    db = createEnterpriseProjectDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  it('EP-WI10-U/E-001: rejects dependency cycles and freezes an exact draft', async () => {
    const fixture = await seedFixture(admin);
    const context = contextFor(fixture.enterpriseId, fixture.projectId, 'AGENT');
    const alternateSnapshotId = newUuidV7();
    const alternateSnapshotHash = Buffer.alloc(32, 0xd2);
    await admin.query(
      `INSERT INTO enterprise_project.product_scope_snapshot
         (snapshot_id, product_id, enterprise_id, payload, payload_hash,
          derived_from, frozen_by_principal_id, frozen_by_actor_snapshot_id,
          authorization_decision_id, purpose, source_command_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, '{}'::jsonb, $6, $7, $8, $9, $10)`,
      [
        alternateSnapshotId,
        fixture.productId,
        fixture.enterpriseId,
        JSON.stringify({
          enterpriseId: fixture.enterpriseId,
          productId: fixture.productId,
          productType: 'fixture.product',
          displayName: 'WI-10 alternate product snapshot',
        }),
        alternateSnapshotHash,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        AUTHORIZATION_DECISION,
        'WI10_ALTERNATE_TEST',
        newUuidV7(),
      ],
    );
    const alternateBaselinePayload = {
      ...createPayload(fixture),
      baselineRefs: baselineRefs(fixture).map((reference) =>
        'objectType' in reference && reference.objectType === 'ProductScopeSnapshot'
          ? enterpriseSnapshotRef(
              'ProductScopeSnapshot',
              fixture.productId,
              alternateSnapshotId,
              fixture.enterpriseId,
              alternateSnapshotHash,
            )
          : reference,
      ),
    };
    const alternateBaselineResult = await handleCreateDeliveryPlanDraft(
      db,
      context,
      commandEnvelope(
        context,
        'project.create_delivery_plan_draft',
        'reject-gap-baseline-mix',
        alternateBaselinePayload,
        { projectId: fixture.projectId, targetType: 'DeliveryPlan', targetId: newUuidV7() },
      ),
    );
    expect(alternateBaselineResult).toMatchObject({
      status: 'REJECTED',
      errorCode: 'PROJECT_DELIVERY_REFERENCE_INVALID',
    });

    const incompleteBaselineResult = await handleCreateDeliveryPlanDraft(
      db,
      context,
      commandEnvelope(
        context,
        'project.create_delivery_plan_draft',
        'reject-incomplete-baselines',
        {
          ...createPayload(fixture),
          baselineRefs: baselineRefs(fixture).slice(0, -1),
        },
        { projectId: fixture.projectId, targetType: 'DeliveryPlan', targetId: newUuidV7() },
      ),
    );
    expect(incompleteBaselineResult).toMatchObject({
      status: 'REJECTED',
      errorCode: 'PROJECT_DELIVERY_REFERENCE_INVALID',
    });

    const firstId = newUuidV7();
    const secondId = newUuidV7();
    const cyclicItems = [
      deliveryItem(fixture, firstId, 'cycle-a', [secondId]),
      deliveryItem(fixture, secondId, 'cycle-b', [firstId]),
    ];
    const cyclicEnvelope = commandEnvelope(
      context,
      'project.create_delivery_plan_draft',
      'reject-cycle',
      createPayload(fixture, cyclicItems),
      { projectId: fixture.projectId, targetType: 'DeliveryPlan', targetId: newUuidV7() },
    );
    await expect(handleCreateDeliveryPlanDraft(db, context, cyclicEnvelope)).rejects.toMatchObject({
      code: PROJECT_DELIVERY_DEPENDENCY_CYCLE,
    });

    const duplicateKeyEnvelope = commandEnvelope(
      context,
      'project.create_delivery_plan_draft',
      'reject-duplicate-item-key',
      createPayload(fixture, [
        deliveryItem(fixture, newUuidV7(), 'duplicate'),
        deliveryItem(fixture, newUuidV7(), 'duplicate'),
      ]),
      { projectId: fixture.projectId, targetType: 'DeliveryPlan', targetId: newUuidV7() },
    );
    await expect(
      handleCreateDeliveryPlanDraft(db, context, duplicateKeyEnvelope),
    ).rejects.toMatchObject({ code: PROJECT_DELIVERY_ITEM_KEY_CONFLICT });

    const plan = await createPlan(db, fixture, context, 'draft-exact-dag');
    expect(plan.result.status).toBe('COMMITTED');
    const state = await readPlanState(db, context, plan.planRef);
    expect(state.root).toMatchObject({
      delivery_plan_id: plan.planRef.objectId,
      enterprise_id: fixture.enterpriseId,
      project_id: fixture.projectId,
      current_version_id: plan.planRef.versionId,
      status: 'DRAFT',
      approved_version_id: null,
      active_version_id: null,
    });
    expect(asAggregateVersion(state.root?.aggregate_version)).toBe('1');
    expect(state.version).toMatchObject({
      delivery_plan_id: plan.planRef.objectId,
      version_id: plan.planRef.versionId,
      version_no: 1,
      version_status: 'DRAFT',
      accepted_gap_analysis_id: fixture.gapAnalysisId,
      accepted_gap_analysis_version_id: fixture.gapVersionId,
    });
    expect(state.items).toHaveLength(2);
    expect(state.items.every((item) => item.commitment_status === 'PROPOSED')).toBe(true);
    expect(state.items.every((item) => item.execution_status === 'NOT_READY')).toBe(true);
    expect(state.requirements).toHaveLength(4);
    expect(state.dependencies).toHaveLength(1);

    const edges = await admin.query<{ reference_path: string; target_payload_hash: Buffer | null }>(
      `SELECT reference_path, target_payload_hash
         FROM enterprise_project.reference_edge
        WHERE owner_object_type = 'DeliveryPlan'
          AND owner_object_id = $1
          AND owner_version_id = $2
        ORDER BY reference_path`,
      [plan.planRef.objectId, plan.planRef.versionId],
    );
    expect(edges.rows).toHaveLength(12);
    expect(
      edges.rows.find((edge) => edge.reference_path === '/baselineRefs/4')?.target_payload_hash,
    ).toEqual(fixture.productScopePayloadHash);

    const firstItemId = plan.itemIds[0];
    if (!firstItemId) throw new Error('expected the first DeliveryItem id');
    const criteria = await handleGetDeliveryItemCriteria(db, context, {
      deliveryPlanRef: plan.planRef,
      deliveryItemId: firstItemId,
    });
    expect(criteria.deliveryPlanRef).toEqual(plan.planRef);
    expect(criteria.executionStatus).toBe('NOT_READY');
    expect(criteria.definition.sourceGapItemRefs[0]).toEqual(
      projectVersionedRef(
        'GapItem',
        fixture.gapFindingId,
        fixture.gapVersionId,
        fixture.enterpriseId,
        fixture.projectId,
      ),
    );
    expect(criteria.criteriaHash.digest).toBe(
      digestCanonicalPayload({
        criteria: criteria.definition.completionCriteria,
      }).hash.toString('hex'),
    );
  });

  it('EP-WI10-P-001/P-002: keeps approval Human-only and separates non-approval decisions', async () => {
    const fixture = await seedFixture(admin);
    const agentContext = contextFor(fixture.enterpriseId, fixture.projectId, 'AGENT');
    const serviceContext = contextFor(fixture.enterpriseId, fixture.projectId, 'SERVICE');
    const humanContext = contextFor(fixture.enterpriseId, fixture.projectId, 'HUMAN');
    const changesPlan = await createPlan(db, fixture, agentContext, 'changes-plan');

    await expect(
      approvePlan(db, fixture, agentContext, changesPlan, 'agent-approve'),
    ).rejects.toMatchObject({ code: PROJECT_DELIVERY_PLAN_HUMAN_APPROVAL_REQUIRED });
    await expect(
      approvePlan(db, fixture, serviceContext, changesPlan, 'service-approve'),
    ).rejects.toMatchObject({ code: PROJECT_DELIVERY_PLAN_HUMAN_APPROVAL_REQUIRED });
    const actingForPayload = {
      ...approvePayload(fixture, changesPlan.planRef, 'CHANGES_REQUIRED'),
      justification: {
        ...justification('DELIVERY_PLAN_ACTING_FOR'),
        actingFor: { principalId: AGENT_PRINCIPAL },
      },
    } as unknown as EnterpriseProject.ProjectApproveDeliveryPlanPayload;
    await expect(
      handleApproveDeliveryPlan(
        db,
        humanContext,
        commandEnvelope(
          humanContext,
          'project.approve_delivery_plan',
          'acting-for-approve',
          actingForPayload,
          {
            projectId: fixture.projectId,
            targetType: 'DeliveryPlan',
            targetId: changesPlan.planRef.objectId,
            expectedAggregateVersion: '1',
          },
        ),
      ),
    ).rejects.toMatchObject({ code: PROJECT_DELIVERY_PLAN_HUMAN_APPROVAL_REQUIRED });
    const changes = await approvePlan(
      db,
      fixture,
      humanContext,
      changesPlan,
      'human-changes',
      'CHANGES_REQUIRED',
    );
    expect(changes.result).toMatchObject({ status: 'COMMITTED' });
    const changesState = await readPlanState(db, humanContext, changesPlan.planRef);
    expect(changesState.root).toMatchObject({
      status: 'CHANGES_REQUIRED',
      approved_version_id: null,
      active_version_id: null,
    });
    expect(changesState.version?.version_status).toBe('CHANGES_REQUIRED');

    const rejectPlan = await createPlan(db, fixture, agentContext, 'reject-plan');
    const rejected = await approvePlan(
      db,
      fixture,
      humanContext,
      rejectPlan,
      'human-reject',
      'REJECT',
    );
    expect(rejected.result).toMatchObject({ status: 'COMMITTED' });
    const rejectedState = await readPlanState(db, humanContext, rejectPlan.planRef);
    expect(rejectedState.root).toMatchObject({
      status: 'REJECTED',
      approved_version_id: null,
      active_version_id: null,
    });
    expect(rejectedState.version?.version_status).toBe('REJECTED');
  });

  it('EP-WI10-P/C-002: consumes the exact Human approval and emits minimal activation events', async () => {
    const fixture = await seedFixture(admin);
    const agentContext = contextFor(fixture.enterpriseId, fixture.projectId, 'AGENT');
    const humanContext = contextFor(fixture.enterpriseId, fixture.projectId, 'HUMAN');
    const serviceContext = contextFor(fixture.enterpriseId, fixture.projectId, 'SERVICE');
    const plan = await createPlan(db, fixture, agentContext, 'activate-plan');
    const approval = await approvePlan(db, fixture, humanContext, plan, 'activate-approval');
    const approvalPayload = committedPayload(approval.result);
    const approvalDecisionRef =
      approvalPayload.approvalDecisionRef as unknown as Common.ContentAddressedRef;

    const wrongDecisionRef: Common.ContentAddressedRef = {
      ...approvalDecisionRef,
      contentHash: hashValue(Buffer.alloc(32, 0xe1)),
    };
    const wrongActivation = await activatePlan(
      db,
      fixture,
      humanContext,
      plan.planRef,
      wrongDecisionRef,
      'reject-wrong-decision',
    );
    expect(wrongActivation.result).toMatchObject({
      status: 'REJECTED',
      errorCode: PROJECT_DELIVERY_APPROVAL_DECISION_INVALID,
      currentAggregateVersion: '2',
    });

    await expect(
      activatePlan(db, fixture, agentContext, plan.planRef, approvalDecisionRef, 'agent-activate'),
    ).rejects.toMatchObject({ code: PROJECT_DELIVERY_PLAN_HUMAN_APPROVAL_REQUIRED });

    const activated = await activatePlan(
      db,
      fixture,
      serviceContext,
      plan.planRef,
      approvalDecisionRef,
      'human-activate',
    );
    expect(activated.result).toMatchObject({ status: 'COMMITTED' });
    const state = await readPlanState(db, humanContext, plan.planRef);
    expect(state.root).toMatchObject({
      status: 'ACTIVE',
      approved_version_id: plan.planRef.versionId,
      active_version_id: plan.planRef.versionId,
    });
    expect(asAggregateVersion(state.root?.aggregate_version)).toBe('3');
    expect(state.version?.version_status).toBe('ACTIVE');
    expect(state.version?.approval_decision_id).toBe(approvalDecisionRef.objectId);
    const activeBaselineRefs = await handleGetActiveBaselineRefs(db, humanContext, {
      projectRef: objectRef('Project', fixture.projectId, fixture.enterpriseId, fixture.projectId),
    });
    expect(activeBaselineRefs.customerBaselineRef).toEqual(
      projectVersionedRef(
        'CustomerBaseline',
        fixture.customerBaselineId,
        fixture.customerBaselineVersionId,
        fixture.enterpriseId,
        fixture.projectId,
      ),
    );
    expect(activeBaselineRefs.templateBaselineRef).toEqual(
      projectVersionedRef(
        'TemplateBaseline',
        fixture.templateBaselineId,
        fixture.templateBaselineVersionId,
        fixture.enterpriseId,
        fixture.projectId,
      ),
    );
    expect(activeBaselineRefs.regulatoryProfileRef).toEqual(
      projectVersionedRef(
        'RegulatoryProfile',
        fixture.regulatoryProfileId,
        fixture.regulatoryProfileVersionId,
        fixture.enterpriseId,
        fixture.projectId,
      ),
    );
    expect(activeBaselineRefs.gapAnalysisRef).toEqual(
      projectVersionedRef(
        'GapAnalysis',
        fixture.gapAnalysisId,
        fixture.gapVersionId,
        fixture.enterpriseId,
        fixture.projectId,
      ),
    );
    expect(activeBaselineRefs.deliveryPlanRef).toEqual(plan.planRef);

    const events = await admin.query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload
         FROM enterprise_project.outbox_event
        WHERE source_command_id = $1
        ORDER BY event_type`,
      [activated.envelope.commandId],
    );
    expect(events.rows).toHaveLength(3);
    expect(events.rows.map((row) => row.event_type)).toEqual([
      'project.DeliveryItemActivated',
      'project.DeliveryItemActivated',
      'project.DeliveryPlanActivated',
    ]);
    const planEvent = events.rows.find((row) => row.event_type === 'project.DeliveryPlanActivated');
    expect(planEvent?.payload).toMatchObject({
      deliveryPlanRef: plan.planRef,
      projectRef: objectRef('Project', fixture.projectId, fixture.enterpriseId, fixture.projectId),
      itemRefs: expect.arrayContaining(
        plan.itemIds.map((itemId) =>
          projectVersionedRef(
            'DeliveryItem',
            itemId,
            plan.planRef.versionId,
            fixture.enterpriseId,
            fixture.projectId,
          ),
        ),
      ),
    });
    for (const event of events.rows.filter(
      (row) => row.event_type === 'project.DeliveryItemActivated',
    )) {
      expect(event.payload).not.toHaveProperty('completionCriteria');
      expect(event.payload).not.toHaveProperty('sourceGapItemRefs');
      expect(event.payload).toHaveProperty('criteriaHash');
      expect(event.payload).toHaveProperty('qualityProfileRef');
    }
  });

  it('EP-WI10-P-004/P-005: serializes activation, replays idempotently and supersedes the old active Plan', async () => {
    const fixture = await seedFixture(admin);
    const agentContext = contextFor(fixture.enterpriseId, fixture.projectId, 'AGENT');
    const humanContext = contextFor(fixture.enterpriseId, fixture.projectId, 'HUMAN');

    const first = await createPlan(db, fixture, agentContext, 'first-active-plan');
    const firstApproval = await approvePlan(
      db,
      fixture,
      humanContext,
      first,
      'first-active-approval',
    );
    const firstDecision = committedPayload(firstApproval.result)
      .approvalDecisionRef as unknown as Common.ContentAddressedRef;
    await activatePlan(
      db,
      fixture,
      humanContext,
      first.planRef,
      firstDecision,
      'first-active-activation',
    );

    const second = await createPlan(db, fixture, agentContext, 'second-active-plan');
    const secondApproval = await approvePlan(
      db,
      fixture,
      humanContext,
      second,
      'second-active-approval',
    );
    const secondDecision = committedPayload(secondApproval.result)
      .approvalDecisionRef as unknown as Common.ContentAddressedRef;
    const concurrent = await Promise.all([
      activatePlan(
        db,
        fixture,
        humanContext,
        second.planRef,
        secondDecision,
        'second-active-race-a',
      ),
      activatePlan(
        db,
        fixture,
        humanContext,
        second.planRef,
        secondDecision,
        'second-active-race-b',
      ),
    ]);
    expect(concurrent.filter((entry) => entry.result.status === 'COMMITTED')).toHaveLength(1);
    expect(concurrent.filter((entry) => entry.result.status === 'REJECTED')).toHaveLength(1);
    expect(concurrent.find((entry) => entry.result.status === 'REJECTED')?.result).toMatchObject({
      errorCode: CONCURRENCY_CONFLICT,
    });

    const winner = concurrent.find((entry) => entry.result.status === 'COMMITTED');
    if (!winner) throw new Error('expected one activation winner');
    const duplicate = await handleActivateDeliveryPlan(db, humanContext, winner.envelope);
    expect(duplicate).toMatchObject({ status: 'DUPLICATE', originalOutcome: 'COMMITTED' });

    const firstState = await readPlanState(db, humanContext, first.planRef);
    const secondState = await readPlanState(db, humanContext, second.planRef);
    expect(firstState.root).toMatchObject({ status: 'SUPERSEDED', active_version_id: null });
    expect(firstState.version?.version_status).toBe('SUPERSEDED');
    expect(secondState.root).toMatchObject({
      status: 'ACTIVE',
      approved_version_id: second.planRef.versionId,
      active_version_id: second.planRef.versionId,
    });
    expect(secondState.items).toHaveLength(2);
    expect(secondState.requirements).toHaveLength(4);
    expect(secondState.dependencies).toHaveLength(1);
    const activeRoots = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM enterprise_project.delivery_plan
        WHERE enterprise_id = $1 AND project_id = $2 AND active_version_id IS NOT NULL`,
      [fixture.enterpriseId, fixture.projectId],
    );
    expect(activeRoots.rows[0]?.count).toBe('1');

    await expect(
      admin.query(
        `UPDATE enterprise_project.delivery_item
            SET title = 'tampered'
          WHERE version_id = $1`,
        [second.planRef.versionId],
      ),
    ).rejects.toThrow(/delivery_item history is immutable/);
    await expect(
      admin.query(
        `UPDATE enterprise_project.delivery_plan_version
            SET payload = '{}'::jsonb
          WHERE version_id = $1`,
        [second.planRef.versionId],
      ),
    ).rejects.toThrow(/delivery_plan_version content is immutable/);
    await expect(
      admin.query(
        `UPDATE enterprise_project.delivery_plan_decision
            SET justification = '{}'::jsonb
          WHERE delivery_plan_id = $1`,
        [second.planRef.objectId],
      ),
    ).rejects.toThrow(/delivery_plan_decision history is immutable/);
  });

  it('EP-WI10-RLS-001: rejects a Plan reference outside the trusted Project context', async () => {
    const fixture = await seedFixture(admin);
    const otherProjectId = newUuidV7();
    const context = contextFor(fixture.enterpriseId, otherProjectId, 'HUMAN');
    await expect(
      handleGetDeliveryItemCriteria(db, context, {
        deliveryPlanRef: acceptedGapRef(fixture),
        deliveryItemId: newUuidV7(),
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_DELIVERY_REFERENCE_INVALID' });
  });

  it('EP-WI10-U-001: rejects a non-accepted Gap before creating DeliveryPlan facts', async () => {
    const fixture = await seedFixture(admin);
    const context = contextFor(fixture.enterpriseId, fixture.projectId, 'AGENT');
    const fakeGapRef = projectVersionedRef(
      'GapAnalysis',
      newUuidV7(),
      newUuidV7(),
      fixture.enterpriseId,
      fixture.projectId,
    );
    const payload = {
      ...createPayload(fixture),
      acceptedGapAnalysisRef: fakeGapRef,
      items: createPayload(fixture).items.map((item) => ({
        ...item,
        sourceGapItemRefs: item.sourceGapItemRefs.map((sourceRef) => ({
          ...sourceRef,
          versionId: fakeGapRef.versionId,
        })),
      })),
    };
    const result = await handleCreateDeliveryPlanDraft(
      db,
      context,
      commandEnvelope(
        context,
        'project.create_delivery_plan_draft',
        'reject-non-accepted-gap',
        payload,
        { projectId: fixture.projectId, targetType: 'DeliveryPlan', targetId: newUuidV7() },
      ),
    );
    expect(result).toMatchObject({
      status: 'REJECTED',
      errorCode: PROJECT_DELIVERY_GAP_NOT_ACCEPTED,
    });
    const roots = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM enterprise_project.delivery_plan
        WHERE project_id = $1`,
      [fixture.projectId],
    );
    expect(roots.rows[0]?.count).toBe('0');
  });
});
