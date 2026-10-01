// IM-03 WI-10 (issue #66): real PostgreSQL acceptance for DeliveryPlan draft,
// Human approval, exact activation, dependency validation and immutable facts.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  CONCURRENCY_CONFLICT,
  consumeDeliveryItemCompletionEvent,
  createEnterpriseProjectDatabase,
  DeliveryPlanRepository,
  handleEvaluateDeliveryItemCompletion,
  handleActivateDeliveryPlan,
  handleApproveDeliveryPlan,
  handleCreateDeliveryPlanDraft,
  handleGetActiveBaselineRefs,
  handleGetDeliveryItemCriteria,
  PROJECT_DELIVERY_APPROVAL_DECISION_INVALID,
  type DeliveryCompletionEventEnvelope,
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

function eventContextFor(
  fixture: Pick<Fixture, 'enterpriseId' | 'projectId'>,
  eventId: string,
  correlationId = newUuidV7(),
): EnterpriseProjectTransactionContext {
  return {
    ...contextFor(fixture.enterpriseId, fixture.projectId, 'SERVICE'),
    kind: 'EVENT_CONSUMER',
    correlationId,
    sourceEventId: eventId,
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

function projectContentAddressedRef(
  fixture: Pick<Fixture, 'enterpriseId' | 'projectId'>,
  objectType: string,
  objectId = newUuidV7(),
  payloadHash = Buffer.alloc(32, 0xe1),
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    immutableVersionId: objectId,
    scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
    contentHash: hashValue(payloadHash),
  };
}

function completionWatermark(
  fixture: Pick<Fixture, 'projectId'>,
  sourceModule: string,
  sequence: number,
): EnterpriseProject.SourceWatermark {
  return {
    sourceModule,
    partition: fixture.projectId,
    sequence,
    observedAt: '2026-08-27T12:00:00.000Z',
  };
}

function eventEnvelope(
  fixture: Pick<Fixture, 'enterpriseId' | 'projectId'>,
  context: EnterpriseProjectTransactionContext,
  eventId: string,
  eventType: string,
  producerModule: string,
  aggregateType: string,
  aggregateId: string,
  payload: CanonicalJsonObject,
  aggregateVersion = 1,
): DeliveryCompletionEventEnvelope {
  return {
    eventId,
    eventType,
    eventVersion: '1.0',
    producerModule,
    aggregateType,
    aggregateId,
    aggregateVersion,
    scopeRef: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
    correlationId: context.correlationId,
    causationId: newUuidV7(),
    commandId: newUuidV7(),
    actorRef: objectRef(
      'identity.principal',
      SERVICE_PRINCIPAL,
      fixture.enterpriseId,
      fixture.projectId,
    ),
    occurredAt: '2026-08-27T12:00:00.000Z',
    dataClassification: 'INTERNAL',
    payload,
    integrity: {
      canonicalizationVersion: '1',
      payloadHash: hashValue(digestCanonicalPayload(payload).hash),
    },
  };
}

function taskCompletedEvent(
  fixture: Pick<Fixture, 'enterpriseId' | 'projectId'>,
  context: EnterpriseProjectTransactionContext,
  eventId: string,
  taskId = newUuidV7(),
): DeliveryCompletionEventEnvelope {
  const payload = {
    taskRef: objectRef('execution.task', taskId, fixture.enterpriseId, fixture.projectId),
    evaluationRef: projectContentAddressedRef(fixture, 'execution.task_evaluation'),
    satisfiedFactRefs: [projectContentAddressedRef(fixture, 'execution.fact')],
    completedAt: '2026-08-27T12:00:00.000Z',
  } as unknown as CanonicalJsonObject;
  return eventEnvelope(
    fixture,
    context,
    eventId,
    'execution.TaskCompleted',
    'task-execution',
    'execution.task',
    taskId,
    payload,
  );
}

function releaseCompletedEvent(
  fixture: Pick<Fixture, 'enterpriseId' | 'projectId'>,
  context: EnterpriseProjectTransactionContext,
  eventId: string,
  releaseId = newUuidV7(),
  packageSnapshotId = newUuidV7(),
  aggregateVersion = 1,
): DeliveryCompletionEventEnvelope {
  const releaseRef = objectRef(
    'release.release',
    releaseId,
    fixture.enterpriseId,
    fixture.projectId,
  );
  const packageRef = {
    releaseRef,
    packageSnapshotRef: {
      kind: 'SNAPSHOT',
      objectType: 'release.package',
      objectId: packageSnapshotId,
      snapshotId: packageSnapshotId,
      scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
      contentHash: hashValue(Buffer.alloc(32, 0xe2)),
    },
    packageHash: hashValue(Buffer.alloc(32, 0xe3)),
  };
  const payload = {
    releaseRef,
    packageRef,
    purpose: 'CUSTOMER_DELIVERY',
    revisionRef: projectContentAddressedRef(fixture, 'artifact.artifact_revision'),
    receiptRefs: [projectContentAddressedRef(fixture, 'release.publication_receipt')],
    completedAt: '2026-08-27T12:00:00.000Z',
  } as unknown as CanonicalJsonObject;
  return eventEnvelope(
    fixture,
    context,
    eventId,
    'release.ReleaseCompleted',
    'release-publication',
    'release.release',
    releaseId,
    payload,
    aggregateVersion,
  );
}

function releaseRecalledEvent(
  fixture: Pick<Fixture, 'enterpriseId' | 'projectId'>,
  context: EnterpriseProjectTransactionContext,
  eventId: string,
  releaseId: string,
  packageSnapshotId: string,
  aggregateVersion = 1,
): DeliveryCompletionEventEnvelope {
  const releaseRef = objectRef(
    'release.release',
    releaseId,
    fixture.enterpriseId,
    fixture.projectId,
  );
  const payload = {
    releaseRef,
    packageRef: {
      releaseRef,
      packageSnapshotRef: {
        kind: 'SNAPSHOT',
        objectType: 'release.package',
        objectId: packageSnapshotId,
        snapshotId: packageSnapshotId,
        scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
        contentHash: hashValue(Buffer.alloc(32, 0xe2)),
      },
      packageHash: hashValue(Buffer.alloc(32, 0xe3)),
    },
    recallRef: projectContentAddressedRef(fixture, 'release.recall'),
    affectedDestinationIds: [newUuidV7()],
    recalledAt: '2026-08-27T12:00:00.000Z',
  } as unknown as CanonicalJsonObject;
  return eventEnvelope(
    fixture,
    context,
    eventId,
    'release.ReleaseRecalled',
    'release-publication',
    'release.release',
    releaseId,
    payload,
    aggregateVersion,
  );
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

async function createActiveCompletionPlan(
  db: ReturnType<typeof createEnterpriseProjectDatabase>,
  fixture: Fixture,
  criteria: CanonicalJsonObject,
): Promise<{ plan: PlanRun; itemId: string; criteria: CanonicalJsonObject }> {
  const itemId = newUuidV7();
  const plan = await createPlan(
    db,
    fixture,
    contextFor(fixture.enterpriseId, fixture.projectId, 'AGENT'),
    `wi12-plan-${itemId}`,
    createPayload(fixture, [deliveryItem(fixture, itemId, 'completion', [], criteria)]),
  );
  const approval = await approvePlan(
    db,
    fixture,
    contextFor(fixture.enterpriseId, fixture.projectId, 'HUMAN'),
    plan,
    `wi12-approval-${itemId}`,
  );
  const approvalDecisionRef = committedPayload(approval.result)
    .approvalDecisionRef as unknown as Common.ContentAddressedRef;
  const activation = await activatePlan(
    db,
    fixture,
    contextFor(fixture.enterpriseId, fixture.projectId, 'HUMAN'),
    plan.planRef,
    approvalDecisionRef,
    `wi12-activation-${itemId}`,
  );
  expect(activation.result.status).toBe('COMMITTED');
  return { plan, itemId, criteria };
}

async function evaluateCompletion(
  db: ReturnType<typeof createEnterpriseProjectDatabase>,
  fixture: Fixture,
  active: { plan: PlanRun; itemId: string },
  criteriaHash: Common.ContentHash,
  evaluatorRef: Common.VersionedRef,
  factRefs: readonly Common.TypedReference[],
  sourceWatermarks: readonly EnterpriseProject.SourceWatermark[],
  evaluatedAt: string,
  expectedAggregateVersion: string,
  idempotencyKey: string,
): Promise<{
  envelope: CommandEnvelope & {
    payload: EnterpriseProject.ProjectEvaluateDeliveryItemCompletionPayload;
  };
  result: CommandResult;
}> {
  const context = contextFor(fixture.enterpriseId, fixture.projectId, 'SERVICE');
  const payload = {
    input: {
      deliveryPlanRef: active.plan.planRef,
      deliveryItemId: active.itemId,
      criteriaHash,
      factRefs,
      sourceWatermarks,
      evaluatorRef,
      evaluatedAt,
    },
  } satisfies EnterpriseProject.ProjectEvaluateDeliveryItemCompletionPayload;
  const envelope = commandEnvelope(
    context,
    'project.evaluate_delivery_item_completion',
    idempotencyKey,
    payload,
    {
      idempotencyScope: 'im03.wi12',
      projectId: fixture.projectId,
      targetType: 'DeliveryItem',
      targetId: active.itemId,
      expectedAggregateVersion,
    },
  );
  return { envelope, result: await handleEvaluateDeliveryItemCompletion(db, context, envelope) };
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

  it('EP-WI12-P/E-001..003: consumes exact facts and derives completion atomically', async () => {
    const fixture = await seedFixture(admin);
    const criteria = {
      allOf: [{ eventType: 'execution.TaskCompleted' }, { eventType: 'release.ReleaseCompleted' }],
    } as unknown as CanonicalJsonObject;
    const active = await createActiveCompletionPlan(db, fixture, criteria);
    const criteriaBefore = await handleGetDeliveryItemCriteria(
      db,
      contextFor(fixture.enterpriseId, fixture.projectId, 'SERVICE'),
      {
        deliveryPlanRef: active.plan.planRef,
        deliveryItemId: active.itemId,
      },
    );
    expect(criteriaBefore.currentEvaluationRef).toBeUndefined();

    const taskEventId = newUuidV7();
    const taskContext = eventContextFor(fixture, taskEventId);
    const taskWatermark = completionWatermark(fixture, 'task_execution', 1);
    const taskEvent = taskCompletedEvent(fixture, taskContext, taskEventId);
    const taskConsumed = await consumeDeliveryItemCompletionEvent(db, taskContext, {
      event: taskEvent,
      sourceWatermark: taskWatermark,
    });
    expect(taskConsumed.status).toBe('PROCESSED');
    if (taskConsumed.status !== 'PROCESSED') throw new Error('expected the Task fact');

    const taskReplay = await consumeDeliveryItemCompletionEvent(db, taskContext, {
      event: taskEvent,
      sourceWatermark: taskWatermark,
    });
    expect(taskReplay).toMatchObject({ status: 'DUPLICATE', factRef: taskConsumed.factRef });

    const taskConflictEvent = taskCompletedEvent(fixture, taskContext, taskEventId);
    const taskConflict = await consumeDeliveryItemCompletionEvent(db, taskContext, {
      event: taskConflictEvent,
      sourceWatermark: taskWatermark,
    });
    expect(taskConflict).toEqual({
      status: 'QUARANTINED',
      failureCode: 'PROJECT_DELIVERY_COMPLETION_INBOX_CONFLICT',
    });
    const taskFactCount = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM enterprise_project.delivery_item_completion_fact
        WHERE event_id = $1`,
      [taskEventId],
    );
    expect(taskFactCount.rows[0]?.count).toBe('1');
    const conflictCount = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM enterprise_project.contract_violation
        WHERE source_event_id = $1
          AND violation_kind = 'INBOX_HASH_CONFLICT'`,
      [taskEventId],
    );
    expect(conflictCount.rows[0]?.count).toBe('1');

    const evaluatorRef = projectVersionedRef(
      'zhiju.quality.evaluator',
      newUuidV7(),
      newUuidV7(),
      fixture.enterpriseId,
      fixture.projectId,
    );
    const firstEvaluationPayload = {
      input: {
        deliveryPlanRef: active.plan.planRef,
        deliveryItemId: active.itemId,
        criteriaHash: criteriaBefore.criteriaHash,
        factRefs: [taskConsumed.factRef],
        sourceWatermarks: [taskWatermark],
        evaluatorRef,
        evaluatedAt: '2026-08-27T12:01:00.000Z',
      },
    } satisfies EnterpriseProject.ProjectEvaluateDeliveryItemCompletionPayload;
    const firstEvaluationContext = contextFor(fixture.enterpriseId, fixture.projectId, 'SERVICE');
    const firstEvaluationEnvelope = commandEnvelope(
      firstEvaluationContext,
      'project.evaluate_delivery_item_completion',
      `wi12-evaluate-task-${active.itemId}`,
      firstEvaluationPayload,
      {
        idempotencyScope: 'im03.wi12',
        projectId: fixture.projectId,
        targetType: 'DeliveryItem',
        targetId: active.itemId,
        expectedAggregateVersion: '1',
      },
    );
    const firstEvaluation = await handleEvaluateDeliveryItemCompletion(
      db,
      firstEvaluationContext,
      firstEvaluationEnvelope,
    );
    expect(firstEvaluation).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { outcome: 'UNSATISFIED', aggregateVersion: '2' },
    });
    const firstEvaluationResult = committedPayload(firstEvaluation);

    const afterTask = await handleGetDeliveryItemCriteria(
      db,
      contextFor(fixture.enterpriseId, fixture.projectId, 'SERVICE'),
      { deliveryPlanRef: active.plan.planRef, deliveryItemId: active.itemId },
    );
    expect(afterTask.currentEvaluationRef?.objectId).toBe(
      (firstEvaluationResult.evaluationRef as unknown as Common.ContentAddressedRef).objectId,
    );
    const taskOnlyRows = await admin.query<{ outcome: string }>(
      `SELECT outcome
         FROM enterprise_project.delivery_item_completion_evaluation
        WHERE delivery_item_id = $1
        ORDER BY recorded_at`,
      [active.itemId],
    );
    expect(taskOnlyRows.rows).toEqual([{ outcome: 'UNSATISFIED' }]);
    const taskCompletionEvents = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM enterprise_project.outbox_event
        WHERE source_command_id = $1
          AND event_type = 'project.DeliveryItemCompletionSatisfied'`,
      [firstEvaluationEnvelope.commandId],
    );
    expect(taskCompletionEvents.rows[0]?.count).toBe('0');
    const itemAfterTask = await admin.query<{ execution_status: string }>(
      `SELECT execution_status
         FROM enterprise_project.delivery_item
        WHERE version_id = $1 AND delivery_item_id = $2`,
      [active.plan.planRef.versionId, active.itemId],
    );
    expect(itemAfterTask.rows[0]?.execution_status).toBe('NOT_READY');

    const releaseEventId = newUuidV7();
    const releaseContext = eventContextFor(fixture, releaseEventId);
    const releaseWatermark = completionWatermark(fixture, 'release_publication', 1);
    const releaseEvent = releaseCompletedEvent(fixture, releaseContext, releaseEventId);
    const releaseConsumed = await consumeDeliveryItemCompletionEvent(db, releaseContext, {
      event: releaseEvent,
      sourceWatermark: releaseWatermark,
    });
    expect(releaseConsumed.status).toBe('PROCESSED');
    if (releaseConsumed.status !== 'PROCESSED') throw new Error('expected the Release fact');

    const secondEvaluationPayload = {
      input: {
        deliveryPlanRef: active.plan.planRef,
        deliveryItemId: active.itemId,
        criteriaHash: criteriaBefore.criteriaHash,
        factRefs: [taskConsumed.factRef, releaseConsumed.factRef],
        sourceWatermarks: [taskWatermark, releaseWatermark],
        evaluatorRef,
        evaluatedAt: '2026-08-27T12:02:00.000Z',
      },
    } satisfies EnterpriseProject.ProjectEvaluateDeliveryItemCompletionPayload;
    const secondEvaluationContext = contextFor(fixture.enterpriseId, fixture.projectId, 'SERVICE');
    const secondEvaluationEnvelope = commandEnvelope(
      secondEvaluationContext,
      'project.evaluate_delivery_item_completion',
      `wi12-evaluate-release-${active.itemId}`,
      secondEvaluationPayload,
      {
        idempotencyScope: 'im03.wi12',
        projectId: fixture.projectId,
        targetType: 'DeliveryItem',
        targetId: active.itemId,
        expectedAggregateVersion: '2',
      },
    );
    const secondEvaluation = await handleEvaluateDeliveryItemCompletion(
      db,
      secondEvaluationContext,
      secondEvaluationEnvelope,
    );
    expect(secondEvaluation).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { outcome: 'SATISFIED', aggregateVersion: '3' },
    });
    const secondEvaluationResult = committedPayload(secondEvaluation);

    const secondReplay = await handleEvaluateDeliveryItemCompletion(
      db,
      secondEvaluationContext,
      secondEvaluationEnvelope,
    );
    expect(secondReplay.status).toBe('DUPLICATE');

    const currentItem = await admin.query<{
      current_completion_evaluation_id: string;
      completion_aggregate_version: string;
      execution_status: string;
    }>(
      `SELECT current_completion_evaluation_id, completion_aggregate_version::text,
              execution_status
         FROM enterprise_project.delivery_item
        WHERE version_id = $1 AND delivery_item_id = $2`,
      [active.plan.planRef.versionId, active.itemId],
    );
    expect(currentItem.rows[0]).toMatchObject({
      current_completion_evaluation_id: (
        secondEvaluationResult.evaluationRef as unknown as Common.ContentAddressedRef
      ).objectId,
      completion_aggregate_version: '3',
      execution_status: 'NOT_READY',
    });
    const secondEvents = await admin.query<{
      event_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT event_type, payload
         FROM enterprise_project.outbox_event
        WHERE source_command_id = $1
        ORDER BY event_type`,
      [secondEvaluationEnvelope.commandId],
    );
    expect(secondEvents.rows.map((row) => row.event_type)).toEqual([
      'project.DeliveryItemCompletionSatisfied',
      'project.DeliveryItemImpactReviewRequested',
    ]);
    const completionEvent = secondEvents.rows.find(
      (row) => row.event_type === 'project.DeliveryItemCompletionSatisfied',
    );
    expect(completionEvent?.payload).not.toHaveProperty('completionCriteria');
    expect(completionEvent?.payload).not.toHaveProperty('satisfiedFactPayloads');
    const impactReviews = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM enterprise_project.delivery_item_impact_review
        WHERE delivery_item_id = $1`,
      [active.itemId],
    );
    expect(impactReviews.rows[0]?.count).toBe('1');
  });

  it('EP-WI12-P-004: appends revoke and upstream-version history without rewriting prior facts', async () => {
    const fixture = await seedFixture(admin);
    const criteria = {
      allOf: [{ eventType: 'execution.TaskCompleted' }, { eventType: 'release.ReleaseCompleted' }],
    } as unknown as CanonicalJsonObject;
    const active = await createActiveCompletionPlan(db, fixture, criteria);
    const criteriaView = await handleGetDeliveryItemCriteria(
      db,
      contextFor(fixture.enterpriseId, fixture.projectId, 'SERVICE'),
      { deliveryPlanRef: active.plan.planRef, deliveryItemId: active.itemId },
    );
    const evaluatorRef = projectVersionedRef(
      'zhiju.quality.evaluator',
      newUuidV7(),
      newUuidV7(),
      fixture.enterpriseId,
      fixture.projectId,
    );

    const taskEventId = newUuidV7();
    const taskContext = eventContextFor(fixture, taskEventId);
    const taskWatermark = completionWatermark(fixture, 'task_execution', 1);
    const taskConsumed = await consumeDeliveryItemCompletionEvent(db, taskContext, {
      event: taskCompletedEvent(fixture, taskContext, taskEventId),
      sourceWatermark: taskWatermark,
    });
    expect(taskConsumed.status).toBe('PROCESSED');
    if (taskConsumed.status !== 'PROCESSED') throw new Error('expected the Task fact');

    const releaseId = newUuidV7();
    const firstPackageSnapshotId = newUuidV7();
    const releaseEventId = newUuidV7();
    const releaseContext = eventContextFor(fixture, releaseEventId);
    const firstReleaseWatermark = completionWatermark(fixture, 'release_publication', 1);
    const firstReleaseConsumed = await consumeDeliveryItemCompletionEvent(db, releaseContext, {
      event: releaseCompletedEvent(
        fixture,
        releaseContext,
        releaseEventId,
        releaseId,
        firstPackageSnapshotId,
        1,
      ),
      sourceWatermark: firstReleaseWatermark,
    });
    expect(firstReleaseConsumed.status).toBe('PROCESSED');
    if (firstReleaseConsumed.status !== 'PROCESSED') {
      throw new Error('expected the first Release fact');
    }

    const firstEvaluation = await evaluateCompletion(
      db,
      fixture,
      active,
      criteriaView.criteriaHash,
      evaluatorRef,
      [taskConsumed.factRef, firstReleaseConsumed.factRef],
      [taskWatermark, firstReleaseWatermark],
      '2026-08-27T12:11:00.000Z',
      '1',
      `wi12-revoke-first-${active.itemId}`,
    );
    expect(firstEvaluation.result).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { outcome: 'SATISFIED', aggregateVersion: '2' },
    });
    const firstEvaluationResult = committedPayload(firstEvaluation.result);

    const immutablePlanBefore = await admin.query<{
      payload_hash: Buffer;
      approval_decision_id: string | null;
      version_status: string;
    }>(
      `SELECT payload_hash, approval_decision_id, version_status
         FROM enterprise_project.delivery_plan_version
        WHERE version_id = $1`,
      [active.plan.planRef.versionId],
    );
    const firstEvaluationRow = await admin.query<{ payload_hash: Buffer }>(
      `SELECT payload_hash
         FROM enterprise_project.delivery_item_completion_evaluation
        WHERE evaluation_id = $1`,
      [(firstEvaluationResult.evaluationRef as unknown as Common.ContentAddressedRef).objectId],
    );

    const recallEventId = newUuidV7();
    const recallContext = eventContextFor(fixture, recallEventId);
    const recallWatermark = completionWatermark(fixture, 'release_publication', 2);
    const recalled = await consumeDeliveryItemCompletionEvent(db, recallContext, {
      event: releaseRecalledEvent(
        fixture,
        recallContext,
        recallEventId,
        releaseId,
        firstPackageSnapshotId,
        2,
      ),
      sourceWatermark: recallWatermark,
    });
    expect(recalled.status).toBe('PROCESSED');
    if (recalled.status !== 'PROCESSED') throw new Error('expected the Release recall fact');

    const revokedEvaluation = await evaluateCompletion(
      db,
      fixture,
      active,
      criteriaView.criteriaHash,
      evaluatorRef,
      [taskConsumed.factRef, firstReleaseConsumed.factRef, recalled.factRef],
      [taskWatermark, firstReleaseWatermark, recallWatermark],
      '2026-08-27T12:12:00.000Z',
      '2',
      `wi12-revoke-unsatisfied-${active.itemId}`,
    );
    expect(revokedEvaluation.result).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { outcome: 'UNSATISFIED', aggregateVersion: '3' },
    });

    const newPackageSnapshotId = newUuidV7();
    const newReleaseEventId = newUuidV7();
    const newReleaseContext = eventContextFor(fixture, newReleaseEventId);
    const newReleaseWatermark = completionWatermark(fixture, 'release_publication', 3);
    const newReleaseConsumed = await consumeDeliveryItemCompletionEvent(db, newReleaseContext, {
      event: releaseCompletedEvent(
        fixture,
        newReleaseContext,
        newReleaseEventId,
        releaseId,
        newPackageSnapshotId,
        3,
      ),
      sourceWatermark: newReleaseWatermark,
    });
    expect(newReleaseConsumed.status).toBe('PROCESSED');
    if (newReleaseConsumed.status !== 'PROCESSED') {
      throw new Error('expected the new Release version fact');
    }

    const newVersionEvaluation = await evaluateCompletion(
      db,
      fixture,
      active,
      criteriaView.criteriaHash,
      evaluatorRef,
      [taskConsumed.factRef, newReleaseConsumed.factRef, recalled.factRef],
      [taskWatermark, newReleaseWatermark, recallWatermark],
      '2026-08-27T12:13:00.000Z',
      '3',
      `wi12-revoke-new-version-${active.itemId}`,
    );
    expect(newVersionEvaluation.result).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { outcome: 'SATISFIED', aggregateVersion: '4' },
    });
    const newVersionResult = committedPayload(newVersionEvaluation.result);
    const satisfiedFactRefs =
      newVersionResult.satisfiedFactRefs as unknown as readonly Common.TypedReference[];
    expect(satisfiedFactRefs).toEqual(
      expect.arrayContaining([taskConsumed.factRef, newReleaseConsumed.factRef]),
    );
    expect(satisfiedFactRefs).not.toContainEqual(recalled.factRef);

    const lateTaskEventId = newUuidV7();
    const lateTaskContext = eventContextFor(fixture, lateTaskEventId);
    const lateTaskWatermark = completionWatermark(fixture, 'task_execution', 2);
    const lateTaskConsumed = await consumeDeliveryItemCompletionEvent(db, lateTaskContext, {
      event: taskCompletedEvent(fixture, lateTaskContext, lateTaskEventId),
      sourceWatermark: lateTaskWatermark,
    });
    expect(lateTaskConsumed.status).toBe('PROCESSED');
    if (lateTaskConsumed.status !== 'PROCESSED') throw new Error('expected the late Task fact');
    const lateEvaluation = await evaluateCompletion(
      db,
      fixture,
      active,
      criteriaView.criteriaHash,
      evaluatorRef,
      [lateTaskConsumed.factRef, newReleaseConsumed.factRef, recalled.factRef],
      [lateTaskWatermark, newReleaseWatermark, recallWatermark],
      '2026-08-27T12:14:00.000Z',
      '4',
      `wi12-revoke-late-fact-${active.itemId}`,
    );
    expect(lateEvaluation.result).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { outcome: 'SATISFIED', aggregateVersion: '5' },
    });

    const evaluationRows = await admin.query<{
      outcome: string;
      payload_hash: Buffer;
      payload: Record<string, unknown>;
    }>(
      `SELECT outcome, payload_hash, payload
         FROM enterprise_project.delivery_item_completion_evaluation
        WHERE delivery_item_id = $1
        ORDER BY evaluated_at`,
      [active.itemId],
    );
    expect(evaluationRows.rows.map((row) => row.outcome)).toEqual([
      'SATISFIED',
      'UNSATISFIED',
      'SATISFIED',
      'SATISFIED',
    ]);
    expect(evaluationRows.rows[0]?.payload_hash).toEqual(firstEvaluationRow.rows[0]?.payload_hash);
    expect(evaluationRows.rows[2]?.payload).toMatchObject({
      satisfiedFactRefs: expect.arrayContaining([taskConsumed.factRef, newReleaseConsumed.factRef]),
    });
    expect(evaluationRows.rows[2]?.payload.satisfiedFactRefs).not.toContainEqual(recalled.factRef);

    const facts = await admin.query<{
      event_type: string;
      lifecycle: string;
      aggregate_version: string;
    }>(
      `SELECT event_type, lifecycle, aggregate_version::text
         FROM enterprise_project.delivery_item_completion_fact
        WHERE project_id = $1
        ORDER BY recorded_at, fact_id`,
      [fixture.projectId],
    );
    expect(facts.rows).toHaveLength(5);
    expect(facts.rows.filter((row) => row.event_type === 'execution.TaskCompleted')).toHaveLength(
      2,
    );
    expect(facts.rows).toEqual(
      expect.arrayContaining([
        { event_type: 'execution.TaskCompleted', lifecycle: 'ACTIVE', aggregate_version: '1' },
        { event_type: 'release.ReleaseCompleted', lifecycle: 'ACTIVE', aggregate_version: '1' },
        { event_type: 'release.ReleaseRecalled', lifecycle: 'REVOKED', aggregate_version: '2' },
        { event_type: 'release.ReleaseCompleted', lifecycle: 'ACTIVE', aggregate_version: '3' },
      ]),
    );

    const impactReviews = await admin.query<{ impact_reason: string }>(
      `SELECT impact_reason
         FROM enterprise_project.delivery_item_impact_review
        WHERE delivery_item_id = $1
        ORDER BY recorded_at`,
      [active.itemId],
    );
    expect(impactReviews.rows).toHaveLength(3);
    expect(
      impactReviews.rows.every(
        (row) => row.impact_reason === 'DELIVERY_ITEM_COMPLETION_FACT_REVOKED',
      ),
    ).toBe(true);

    const completionEvents = await admin.query<{
      source_command_id: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT source_command_id, payload
         FROM enterprise_project.outbox_event
        WHERE aggregate_id = $1
          AND event_type = 'project.DeliveryItemCompletionSatisfied'
        ORDER BY recorded_at`,
      [active.itemId],
    );
    expect(completionEvents.rows).toHaveLength(2);
    const latestCompletionEvent = completionEvents.rows.find(
      (row) => row.source_command_id === newVersionEvaluation.envelope.commandId,
    );
    expect(latestCompletionEvent?.payload.satisfiedFactRefs).toEqual(
      expect.arrayContaining([taskConsumed.factRef, newReleaseConsumed.factRef]),
    );
    expect(latestCompletionEvent?.payload.satisfiedFactRefs).not.toContainEqual(recalled.factRef);
    expect(
      completionEvents.rows.filter(
        (row) => row.source_command_id === lateEvaluation.envelope.commandId,
      ),
    ).toHaveLength(0);

    const immutablePlanAfter = await admin.query<{
      payload_hash: Buffer;
      approval_decision_id: string | null;
      version_status: string;
    }>(
      `SELECT payload_hash, approval_decision_id, version_status
         FROM enterprise_project.delivery_plan_version
        WHERE version_id = $1`,
      [active.plan.planRef.versionId],
    );
    expect(immutablePlanAfter.rows[0]).toEqual(immutablePlanBefore.rows[0]);
  });

  it('EP-WI12-P-005: enforces completion ACL, immutable history and Project RLS', async () => {
    const fixture = await seedFixture(admin);
    const criteria = {
      allOf: [{ eventType: 'execution.TaskCompleted' }],
    } as unknown as CanonicalJsonObject;
    const active = await createActiveCompletionPlan(db, fixture, criteria);
    const criteriaView = await handleGetDeliveryItemCriteria(
      db,
      contextFor(fixture.enterpriseId, fixture.projectId, 'SERVICE'),
      { deliveryPlanRef: active.plan.planRef, deliveryItemId: active.itemId },
    );
    const taskEventId = newUuidV7();
    const taskContext = eventContextFor(fixture, taskEventId);
    const taskWatermark = completionWatermark(fixture, 'task_execution', 1);
    const taskConsumed = await consumeDeliveryItemCompletionEvent(db, taskContext, {
      event: taskCompletedEvent(fixture, taskContext, taskEventId),
      sourceWatermark: taskWatermark,
    });
    expect(taskConsumed.status).toBe('PROCESSED');
    if (taskConsumed.status !== 'PROCESSED') throw new Error('expected the Task fact');
    const evaluatorRef = projectVersionedRef(
      'zhiju.quality.evaluator',
      newUuidV7(),
      newUuidV7(),
      fixture.enterpriseId,
      fixture.projectId,
    );
    const evaluation = await evaluateCompletion(
      db,
      fixture,
      active,
      criteriaView.criteriaHash,
      evaluatorRef,
      [taskConsumed.factRef],
      [taskWatermark],
      '2026-08-27T12:21:00.000Z',
      '1',
      `wi12-acl-${active.itemId}`,
    );
    expect(evaluation.result).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { outcome: 'SATISFIED', aggregateVersion: '2' },
    });
    const evaluationId = (
      committedPayload(evaluation.result).evaluationRef as unknown as Common.ContentAddressedRef
    ).objectId;
    // PR #240 F1 compatibility control: the real v1 owning command above
    // commits a legacy Item Evaluation without the v2 discriminator.
    const legacyPayload = await admin.query<{ payload: Record<string, unknown> }>(
      'SELECT payload FROM enterprise_project.delivery_item_completion_evaluation WHERE evaluation_id=$1',
      [evaluationId],
    );
    expect(legacyPayload.rows[0]?.payload).toBeDefined();
    expect(legacyPayload.rows[0]?.payload).not.toHaveProperty('taskFactSemantics');
    const factIdRows = await admin.query<{ fact_id: string }>(
      `SELECT fact_id
         FROM enterprise_project.delivery_item_completion_fact
        WHERE event_id = $1`,
      [taskEventId],
    );
    const factId = factIdRows.rows[0]?.fact_id;
    if (!factId) throw new Error('expected the persisted completion fact');
    const impactIdRows = await admin.query<{ impact_review_id: string }>(
      `SELECT impact_review_id
         FROM enterprise_project.delivery_item_impact_review
        WHERE delivery_item_id = $1`,
      [active.itemId],
    );
    expect(impactIdRows.rows).toHaveLength(0);

    const appContext = contextFor(fixture.enterpriseId, fixture.projectId, 'SERVICE');
    await expect(
      withEnterpriseProjectTransaction(db, appContext, async (trx) =>
        trx
          .updateTable('enterprise_project.delivery_item')
          .set({ execution_status: 'COMPLETED' })
          .where('version_id', '=', active.plan.planRef.versionId)
          .where('delivery_item_id', '=', active.itemId)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withEnterpriseProjectTransaction(db, appContext, async (trx) =>
        trx
          .updateTable('enterprise_project.delivery_item_completion_fact')
          .set({ lifecycle: 'REVOKED' })
          .where('fact_id', '=', factId)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withEnterpriseProjectTransaction(db, appContext, async (trx) =>
        trx
          .deleteFrom('enterprise_project.delivery_item_completion_fact')
          .where('fact_id', '=', factId)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withEnterpriseProjectTransaction(db, appContext, async (trx) =>
        trx
          .updateTable('enterprise_project.delivery_item_completion_evaluation')
          .set({ outcome: 'UNSATISFIED' })
          .where('evaluation_id', '=', evaluationId)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withEnterpriseProjectTransaction(db, appContext, async (trx) =>
        trx
          .deleteFrom('enterprise_project.delivery_item_completion_evaluation')
          .where('evaluation_id', '=', evaluationId)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    const foreignProjectId = newUuidV7();
    const foreignContext = contextFor(fixture.enterpriseId, foreignProjectId, 'SERVICE');
    const foreignRead = await withEnterpriseProjectTransaction(db, foreignContext, async (trx) =>
      trx
        .selectFrom('enterprise_project.delivery_item_completion_fact')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('project_id', '=', fixture.projectId)
        .executeTakeFirstOrThrow(),
    );
    expect(foreignRead.count).toBe('0');
    await expect(
      withEnterpriseProjectTransaction(db, foreignContext, async (trx) =>
        trx
          .updateTable('enterprise_project.delivery_item_completion_fact')
          .set({ lifecycle: 'REVOKED' })
          .where('project_id', '=', fixture.projectId)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '42501' });

    const itemAfterAcl = await admin.query<{
      execution_status: string;
      completion_aggregate_version: string;
      current_completion_evaluation_id: string;
    }>(
      `SELECT execution_status, completion_aggregate_version::text,
              current_completion_evaluation_id
         FROM enterprise_project.delivery_item
        WHERE version_id = $1 AND delivery_item_id = $2`,
      [active.plan.planRef.versionId, active.itemId],
    );
    expect(itemAfterAcl.rows[0]).toMatchObject({
      execution_status: 'NOT_READY',
      completion_aggregate_version: '2',
      current_completion_evaluation_id: evaluationId,
    });
  });

  it('EP-WI12-P-006: serializes completion CAS and rolls back derived history on Outbox failure', async () => {
    const fixture = await seedFixture(admin);
    const criteria = {
      allOf: [{ eventType: 'execution.TaskCompleted' }],
    } as unknown as CanonicalJsonObject;
    const active = await createActiveCompletionPlan(db, fixture, criteria);
    const criteriaView = await handleGetDeliveryItemCriteria(
      db,
      contextFor(fixture.enterpriseId, fixture.projectId, 'SERVICE'),
      { deliveryPlanRef: active.plan.planRef, deliveryItemId: active.itemId },
    );
    const evaluatorRef = projectVersionedRef(
      'zhiju.quality.evaluator',
      newUuidV7(),
      newUuidV7(),
      fixture.enterpriseId,
      fixture.projectId,
    );
    const taskEventId = newUuidV7();
    const taskContext = eventContextFor(fixture, taskEventId);
    const taskWatermark = completionWatermark(fixture, 'task_execution', 1);
    const taskConsumed = await consumeDeliveryItemCompletionEvent(db, taskContext, {
      event: taskCompletedEvent(fixture, taskContext, taskEventId),
      sourceWatermark: taskWatermark,
    });
    expect(taskConsumed.status).toBe('PROCESSED');
    if (taskConsumed.status !== 'PROCESSED') throw new Error('expected the first Task fact');

    const firstEvaluation = await evaluateCompletion(
      db,
      fixture,
      active,
      criteriaView.criteriaHash,
      evaluatorRef,
      [taskConsumed.factRef],
      [taskWatermark],
      '2026-08-27T12:31:00.000Z',
      '1',
      `wi12-cas-first-${active.itemId}`,
    );
    expect(firstEvaluation.result).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { outcome: 'SATISFIED', aggregateVersion: '2' },
    });

    const secondTaskEventId = newUuidV7();
    const secondTaskContext = eventContextFor(fixture, secondTaskEventId);
    const secondTaskWatermark = completionWatermark(fixture, 'task_execution', 2);
    const secondTaskConsumed = await consumeDeliveryItemCompletionEvent(db, secondTaskContext, {
      event: taskCompletedEvent(fixture, secondTaskContext, secondTaskEventId),
      sourceWatermark: secondTaskWatermark,
    });
    expect(secondTaskConsumed.status).toBe('PROCESSED');
    if (secondTaskConsumed.status !== 'PROCESSED') throw new Error('expected the second Task fact');

    const concurrent = await Promise.all([
      evaluateCompletion(
        db,
        fixture,
        active,
        criteriaView.criteriaHash,
        evaluatorRef,
        [secondTaskConsumed.factRef],
        [secondTaskWatermark],
        '2026-08-27T12:32:00.000Z',
        '2',
        `wi12-cas-race-a-${active.itemId}`,
      ),
      evaluateCompletion(
        db,
        fixture,
        active,
        criteriaView.criteriaHash,
        evaluatorRef,
        [secondTaskConsumed.factRef],
        [secondTaskWatermark],
        '2026-08-27T12:32:00.000Z',
        '2',
        `wi12-cas-race-b-${active.itemId}`,
      ),
    ]);
    expect(concurrent.filter((entry) => entry.result.status === 'COMMITTED')).toHaveLength(1);
    expect(concurrent.filter((entry) => entry.result.status === 'REJECTED')).toHaveLength(1);
    expect(concurrent.find((entry) => entry.result.status === 'REJECTED')?.result).toMatchObject({
      errorCode: CONCURRENCY_CONFLICT,
    });

    const committedRace = concurrent.find((entry) => entry.result.status === 'COMMITTED');
    if (!committedRace) throw new Error('expected one completion CAS winner');
    const beforeFailure = await admin.query<{
      evaluation_count: string;
      impact_count: string;
      completion_event_count: string;
      completion_aggregate_version: string;
      current_completion_evaluation_id: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM enterprise_project.delivery_item_completion_evaluation
           WHERE delivery_item_id = $1) AS evaluation_count,
         (SELECT count(*)::text FROM enterprise_project.delivery_item_impact_review
           WHERE delivery_item_id = $1) AS impact_count,
         (SELECT count(*)::text FROM enterprise_project.outbox_event
           WHERE aggregate_id = $2
             AND event_type = 'project.DeliveryItemCompletionSatisfied') AS completion_event_count,
         completion_aggregate_version::text,
         current_completion_evaluation_id
       FROM enterprise_project.delivery_item
      WHERE version_id = $3 AND delivery_item_id = $2`,
      [active.itemId, active.itemId, active.plan.planRef.versionId],
    );
    expect(beforeFailure.rows[0]).toMatchObject({
      evaluation_count: '2',
      impact_count: '1',
      completion_event_count: '1',
      completion_aggregate_version: '3',
    });

    await admin.query(
      `DROP TRIGGER IF EXISTS wi12_test_fail_impact_outbox ON enterprise_project.outbox_event`,
    );
    await admin.query(`
      CREATE OR REPLACE FUNCTION enterprise_project.wi12_test_fail_impact_outbox()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $function$
      BEGIN
        IF NEW.event_type = 'project.DeliveryItemImpactReviewRequested' THEN
          RAISE EXCEPTION 'WI12 rollback injection' USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
      END
      $function$;
    `);
    await admin.query(`
      CREATE TRIGGER wi12_test_fail_impact_outbox
      BEFORE INSERT ON enterprise_project.outbox_event
      FOR EACH ROW
      EXECUTE FUNCTION enterprise_project.wi12_test_fail_impact_outbox();
    `);
    const failureEventId = newUuidV7();
    try {
      const failureContext = eventContextFor(fixture, failureEventId);
      const failureWatermark = completionWatermark(fixture, 'task_execution', 3);
      const failureFact = await consumeDeliveryItemCompletionEvent(db, failureContext, {
        event: taskCompletedEvent(fixture, failureContext, failureEventId),
        sourceWatermark: failureWatermark,
      });
      expect(failureFact.status).toBe('PROCESSED');
      if (failureFact.status !== 'PROCESSED') throw new Error('expected the rollback Task fact');

      await expect(
        evaluateCompletion(
          db,
          fixture,
          active,
          criteriaView.criteriaHash,
          evaluatorRef,
          [failureFact.factRef],
          [failureWatermark],
          '2026-08-27T12:33:00.000Z',
          '3',
          `wi12-rollback-${active.itemId}`,
        ),
      ).rejects.toMatchObject({ code: 'P0001' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'P0001' });
    } finally {
      await admin.query(
        `DROP TRIGGER IF EXISTS wi12_test_fail_impact_outbox ON enterprise_project.outbox_event`,
      );
      await admin.query(
        `DROP FUNCTION IF EXISTS enterprise_project.wi12_test_fail_impact_outbox()`,
      );
    }

    const afterFailure = await admin.query<{
      fact_count: string;
      evaluation_count: string;
      impact_count: string;
      completion_event_count: string;
      completion_aggregate_version: string;
      current_completion_evaluation_id: string;
      inbox_status: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM enterprise_project.delivery_item_completion_fact
           WHERE project_id = $1) AS fact_count,
         (SELECT count(*)::text FROM enterprise_project.delivery_item_completion_evaluation
           WHERE delivery_item_id = $2) AS evaluation_count,
         (SELECT count(*)::text FROM enterprise_project.delivery_item_impact_review
           WHERE delivery_item_id = $2) AS impact_count,
         (SELECT count(*)::text FROM enterprise_project.outbox_event
           WHERE aggregate_id = $2
             AND event_type = 'project.DeliveryItemCompletionSatisfied') AS completion_event_count,
         item.completion_aggregate_version::text,
         item.current_completion_evaluation_id,
         (SELECT status
            FROM enterprise_project.inbox_message
           WHERE event_id = $3
             AND consumer_name = 'enterprise-project.delivery-item-completion') AS inbox_status
       FROM enterprise_project.delivery_item item
      WHERE item.version_id = $4 AND item.delivery_item_id = $2`,
      [fixture.projectId, active.itemId, failureEventId, active.plan.planRef.versionId],
    );
    expect(afterFailure.rows[0]).toMatchObject({
      fact_count: '3',
      evaluation_count: '2',
      impact_count: '1',
      completion_event_count: '1',
      completion_aggregate_version: '3',
      current_completion_evaluation_id: (
        committedPayload(committedRace.result)
          .evaluationRef as unknown as Common.ContentAddressedRef
      ).objectId,
      inbox_status: 'PROCESSED',
    });
  });
});
