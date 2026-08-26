// IM-03 WI-06 (issue #62): real PostgreSQL acceptance tests for
// CustomerMaterial proposal, Human confirmation, exact SourceMaterial
// references, conflict rejection, RLS and immutable versions.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql } from 'kysely';
import {
  createEnterpriseProjectDatabase,
  digestCanonicalPayload,
  EnterpriseBusinessRepository,
  handleAcceptSourceMaterial,
  handleConfirmCustomerMaterial,
  handleCreateEnterprise,
  handleCreateProject,
  handleEnterpriseProductCreate,
  handleEnterpriseProductCreateScopeSnapshot,
  handleEnterpriseProfileCreateSnapshot,
  handleEnterpriseQmsActivateRevision,
  handleEnterpriseQmsCreateRevision,
  handleProposeCustomerMaterial,
  handleRegisterSourceMaterial,
  withEnterpriseProjectTransaction,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  PROJECT_HUMAN_ONLY_DENIED,
  PROJECT_MATERIAL_CONFLICT_UNRESOLVED,
  PROJECT_MATERIAL_CONFIRMATION_CONFLICT,
  PROJECT_MATERIAL_SOURCE_INVALID,
  type CommandEnvelope,
  type CommandResult,
  type EnterprisePrincipalKind,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Common, EnterpriseProject } from '@zhiju/contracts';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const HUMAN_PRINCIPAL = 'd1d1d1d1-d1d1-71d1-81d1-d1d1d1d1d1d1';
const AGENT_PRINCIPAL = 'd2d2d2d2-d2d2-72d2-82d2-d2d2d2d2d2d2';
const HUMAN_ACTOR = 'd3d3d3d3-d3d3-73d3-83d3-d3d3d3d3d3d3';
const AGENT_ACTOR = 'd4d4d4d4-d4d4-74d4-84d4-d4d4d4d4d4d4';
const AUTHORIZATION_DECISION = 'd5d5d5d5-d5d5-75d5-85d5-d5d5d5d5d5d5';
const POLICY_SNAPSHOT = 'd6d6d6d6-d6d6-76d6-86d6-d6d6d6d6d6d6';
const DECISION_HASH = Buffer.alloc(32, 0x42);

function contextFor(
  enterpriseId: string,
  allowedProjectIds: readonly string[] = [],
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
    allowedProjectIds,
    correlationId: newUuidV7(),
  };
}

function objectRef<TObjectType extends string>(
  objectType: TObjectType,
  objectId: string,
  enterpriseId: string,
  projectId?: string,
): Common.ObjectRef & { objectType: TObjectType } {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: projectId === undefined ? { enterpriseId } : { enterpriseId, projectId },
  };
}

function contentRef<TObjectType extends string>(
  objectType: TObjectType,
  objectId: string,
  enterpriseId: string,
  projectId: string,
  digest: string,
): Common.ContentAddressedRef & { objectType: TObjectType } {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    scope: { enterpriseId, projectId },
    contentHash: {
      algorithm: 'SHA-256',
      digest,
      canonicalizationVersion: '1',
    },
  };
}

function versionedRef<TObjectType extends string>(
  objectType: TObjectType,
  objectId: string,
  versionId: string,
  enterpriseId: string,
): Common.VersionedRef & { objectType: TObjectType } {
  return {
    kind: 'VERSIONED',
    objectType,
    objectId,
    versionId,
    scope: { enterpriseId },
  };
}

function snapshotRef<TObjectType extends string>(
  objectType: TObjectType,
  snapshotId: string,
  digest: string,
  enterpriseId: string,
): Common.SnapshotRef & { objectType: TObjectType } {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: snapshotId,
    snapshotId,
    scope: { enterpriseId },
    contentHash: {
      algorithm: 'SHA-256',
      digest,
      canonicalizationVersion: '1',
    },
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
    idempotencyScope: 'im03.wi06',
    idempotencyKey,
    requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
    enterpriseId: context.enterpriseId,
    targetType: 'CustomerMaterial',
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

function sourceDescriptor(
  enterpriseId: string,
  tag: string,
  digest = 'a'.repeat(64),
): EnterpriseProject.SourceMaterialDescriptor {
  return {
    originRef: {
      system: 'feishu',
      resourceType: 'message_attachment',
      externalId: `wi06-${tag}-origin`,
      observedAt: '2026-08-26T00:00:00.000Z',
      tenantOrAccountRef: objectRef('FeishuTenant', newUuidV7(), enterpriseId),
    },
    submittedBy: objectRef('Principal', HUMAN_PRINCIPAL, enterpriseId),
    receivedAt: '2026-08-26T00:00:00.000Z',
    originalName: `${tag}.pdf`,
    mediaType: 'application/pdf',
    byteLength: 12,
    checksum: {
      algorithm: 'SHA-256',
      digest,
      canonicalizationVersion: '1',
    },
    stagedObjectRef: `staging/wi06/${tag}`,
    retentionClass: 'CUSTOMER_RECORD',
  };
}

async function seedEnterpriseProject(
  db: ReturnType<typeof createEnterpriseProjectDatabase>,
  enterpriseId: string,
  tag: string,
): Promise<{ context: EnterpriseProjectTransactionContext; projectId: string }> {
  const context = contextFor(enterpriseId);
  const enterprise = await handleCreateEnterprise(
    db,
    context,
    commandEnvelope(
      context,
      'project.create_enterprise',
      `${tag}-enterprise`,
      { displayCode: `WI06-${tag}`, displayName: `WI06 ${tag}`, initialStatus: 'ACTIVE' as const },
      { targetType: 'Enterprise', targetId: enterpriseId },
    ),
  );
  expect(enterprise.status).toBe('COMMITTED');

  const productCreate = await handleEnterpriseProductCreate(
    db,
    context,
    commandEnvelope(context, 'enterprise_product.create', `${tag}-product`, {
      enterpriseRef: objectRef('Enterprise', enterpriseId, enterpriseId),
      displayCode: `WI06-PRODUCT-${tag}`,
      initialVersion: {
        productType: 'manufactured.widget',
        displayName: 'WI06 Widget',
        intendedUse: 'CustomerMaterial acceptance fixture',
        productScope: { family: 'widget', markets: ['CN'] },
        sourceRefs: [objectRef('SourceMaterial', newUuidV7(), enterpriseId)],
      },
    }),
  );
  const productPayload = committedPayload(productCreate) as {
    productRef: { objectId: string };
    productVersionRef: { versionId: string };
  };
  const productScope = await handleEnterpriseProductCreateScopeSnapshot(
    db,
    context,
    commandEnvelope(context, 'enterprise_product.create_scope_snapshot', `${tag}-product-scope`, {
      productRef: {
        objectType: 'Product' as const,
        objectId: productPayload.productRef.objectId,
      },
      productVersionRefs: [
        {
          objectType: 'ProductVersion',
          objectId: productPayload.productRef.objectId,
          versionId: productPayload.productVersionRef.versionId,
        },
      ],
      purpose: 'WI06 product scope fixture',
    }),
  );
  const productScopePayload = committedPayload(productScope) as {
    productScopeSnapshotRef: { objectId: string };
    payloadHash: string;
  };

  const qmsCreate = await handleEnterpriseQmsCreateRevision(
    db,
    context,
    commandEnvelope(context, 'enterprise_qms.create_revision', `${tag}-qms-create`, {
      qmsConfigurationRef: objectRef('QMSConfiguration', newUuidV7(), enterpriseId),
      applicabilityDecisions: [{ requirementRef: 'req-1', outcome: 'APPLICABLE' }],
      managementChoices: [{ choiceKey: 'review-cycle', selectedOption: 'quarterly' }],
      professionalDecisions: [{ decisionType: 'risk-method', outcome: 'apply' }],
      sourceRefs: [objectRef('SourceMaterial', newUuidV7(), enterpriseId)],
    }),
  );
  const qmsPayload = committedPayload(qmsCreate) as {
    qmsConfigurationRevisionRef: { objectId: string; versionId: string };
  };
  await handleEnterpriseQmsActivateRevision(
    db,
    context,
    commandEnvelope(
      context,
      'enterprise_qms.activate_revision',
      `${tag}-qms-activate`,
      {
        qmsConfigurationRef: objectRef(
          'QMSConfiguration',
          qmsPayload.qmsConfigurationRevisionRef.objectId,
          enterpriseId,
        ),
        qmsConfigurationRevisionRef: versionedRef(
          'QMSConfigurationRevision',
          qmsPayload.qmsConfigurationRevisionRef.objectId,
          qmsPayload.qmsConfigurationRevisionRef.versionId,
          enterpriseId,
        ),
        activationMode: 'ACTIVATE' as const,
        expectedAggregateVersion: '1',
        humanDecisionRef: objectRef('BusinessDecision', newUuidV7(), enterpriseId),
      },
      { expectedAggregateVersion: '1' },
    ),
  );

  const profile = await handleEnterpriseProfileCreateSnapshot(
    db,
    context,
    commandEnvelope(context, 'enterprise_profile.create_snapshot', `${tag}-profile`, {
      enterpriseRef: objectRef('Enterprise', enterpriseId, enterpriseId),
      enterpriseFactVersionRefs: [],
      productVersionRefs: [
        {
          objectType: 'ProductVersion',
          objectId: productPayload.productRef.objectId,
          versionId: productPayload.productVersionRef.versionId,
        },
      ],
      qmsConfigurationRef: objectRef(
        'QMSConfiguration',
        qmsPayload.qmsConfigurationRevisionRef.objectId,
        enterpriseId,
      ),
      qmsConfigurationRevisionRef: versionedRef(
        'QMSConfigurationRevision',
        qmsPayload.qmsConfigurationRevisionRef.objectId,
        qmsPayload.qmsConfigurationRevisionRef.versionId,
        enterpriseId,
      ),
      purpose: 'WI06 profile fixture',
    }),
  );
  const profilePayload = committedPayload(profile) as {
    enterpriseProfileSnapshotRef: { objectId: string };
    payloadHash: string;
  };

  const project = await handleCreateProject(
    db,
    context,
    commandEnvelope(context, 'project.create_project', `${tag}-project`, {
      enterpriseRef: objectRef('Enterprise', enterpriseId, enterpriseId),
      displayCode: `WI06-PROJECT-${tag}`,
      title: `WI06 project ${tag}`,
      objective: 'CustomerMaterial persistence acceptance fixture',
      startSnapshot: {
        enterpriseProfileSnapshotRef: snapshotRef(
          'EnterpriseProfileSnapshot',
          profilePayload.enterpriseProfileSnapshotRef.objectId,
          profilePayload.payloadHash,
          enterpriseId,
        ),
        qmsConfigurationRef: versionedRef(
          'QMSConfiguration',
          qmsPayload.qmsConfigurationRevisionRef.objectId,
          qmsPayload.qmsConfigurationRevisionRef.versionId,
          enterpriseId,
        ),
        productScopeSnapshotRef: snapshotRef(
          'ProductScopeSnapshot',
          productScopePayload.productScopeSnapshotRef.objectId,
          productScopePayload.payloadHash,
          enterpriseId,
        ),
      },
      memberPolicyRef: versionedRef('Policy', newUuidV7(), newUuidV7(), enterpriseId),
    }),
  );
  const projectPayload = committedPayload(project) as { projectRef: { objectId: string } };
  return { context, projectId: projectPayload.projectRef.objectId };
}

async function registerAndAcceptSource(
  db: ReturnType<typeof createEnterpriseProjectDatabase>,
  context: EnterpriseProjectTransactionContext,
  projectId: string,
  tag: string,
  digest = 'a'.repeat(64),
  accepted = true,
): Promise<{ sourceMaterialId: string; sourceRef: Common.ContentAddressedRef }> {
  const descriptor = sourceDescriptor(context.enterpriseId, tag, digest);
  const sourceContext = contextFor(context.enterpriseId, [projectId]);
  const source = await handleRegisterSourceMaterial(
    db,
    sourceContext,
    commandEnvelope(
      sourceContext,
      'project.register_source_material',
      `${tag}-register`,
      {
        projectRef: objectRef('Project', projectId, context.enterpriseId, projectId),
        descriptor,
      },
      { projectId },
    ),
  );
  const sourcePayload = committedPayload(source) as unknown as {
    sourceMaterialRef: Common.ContentAddressedRef;
  };
  const sourceMaterialId = sourcePayload.sourceMaterialRef.objectId;
  if (accepted) {
    const validationRefs: Common.ContentAddressedRef[] = [];
    const sourceRepo = new EnterpriseBusinessRepository();
    for (const validationKind of ['SECURITY', 'INTEGRITY'] as const) {
      const validationId = newUuidV7();
      const validationPayload = {
        enterpriseId: context.enterpriseId,
        projectId,
        sourceMaterialId,
        validationKind,
        outcome: 'PASSED',
        validatedObjectRef: `accepted/wi06/${tag}`,
        validatedContentHash: digest,
        validatedByteLength: descriptor.byteLength,
        validatorId: 'wi06-validator',
        validatorVersion: '1.0.0',
      } as CanonicalJsonObject;
      const validationDigest = digestCanonicalPayload(validationPayload);
      await withEnterpriseProjectTransaction(
        db,
        contextFor(context.enterpriseId, [projectId]),
        async (trx) => {
          await sourceRepo.insertSourceMaterialValidation(trx, {
            validationId,
            sourceMaterialId,
            enterpriseId: context.enterpriseId,
            projectId,
            validationKind,
            outcome: 'PASSED',
            validatedObjectRef: `accepted/wi06/${tag}`,
            validatedContentHash: Buffer.from(digest, 'hex'),
            validatedByteLength: descriptor.byteLength,
            validatorId: 'wi06-validator',
            validatorVersion: '1.0.0',
            payload: validationPayload,
            payloadHash: validationDigest.hash,
            recordedByPrincipalId: HUMAN_PRINCIPAL,
            recordedByActorSnapshotId: HUMAN_ACTOR,
            authorizationDecisionId: AUTHORIZATION_DECISION,
            sourceCommandId: newUuidV7(),
          });
        },
      );
      validationRefs.push(
        contentRef(
          'ValidationResult',
          validationId,
          context.enterpriseId,
          projectId,
          validationDigest.hash.toString('hex'),
        ),
      );
    }
    const acceptedContext = contextFor(context.enterpriseId, [projectId]);
    const securityValidationRef = validationRefs[0];
    const integrityValidationRef = validationRefs[1];
    if (securityValidationRef === undefined || integrityValidationRef === undefined) {
      throw new Error('SourceMaterial acceptance fixture requires two validation references');
    }
    const acceptedSource = await handleAcceptSourceMaterial(
      db,
      acceptedContext,
      commandEnvelope(
        acceptedContext,
        'project.accept_source_material',
        `${tag}-accept`,
        {
          securityValidationRefs: [securityValidationRef],
          integrityValidationRef,
          acceptedObjectRef: `accepted/wi06/${tag}`,
          acceptedAt: '2026-08-26T01:00:00.000Z',
        },
        {
          projectId,
          targetType: 'SourceMaterial',
          targetId: sourceMaterialId,
          expectedAggregateVersion: '1',
        },
      ),
    );
    expect(acceptedSource.status).toBe('COMMITTED');
  }
  return { sourceMaterialId, sourceRef: sourcePayload.sourceMaterialRef };
}

function materialProposal(
  enterpriseId: string,
  projectId: string,
  sourceRef: Common.ContentAddressedRef,
  title: string,
): EnterpriseProject.ProjectProposeCustomerMaterialPayload {
  const evidence = { evidence: sourceRef, relation: 'SUPPORTS' as const };
  return {
    projectRef: objectRef('Project', projectId, enterpriseId, projectId),
    proposal: {
      materialType: 'quality.procedure',
      title,
      customerDocumentNumber: 'QP-001',
      customerVersionLabel: '2025.2',
      effectiveDate: '2025-02-01',
      completeness: 'PARTIAL',
      sourceSelections: [{ sourceMaterialRef: sourceRef, role: 'primary', locator: 'section.1' }],
      language: 'zh-CN',
      classificationRationale: {
        reasonCode: 'SOURCE_CLASSIFICATION',
        summary: 'SourceMaterial identifies the proposed controlled procedure.',
        evidenceRefs: [evidence],
      },
    },
  };
}

function confirmationPayload(
  candidateVersionRef: Common.VersionedRef,
  sourceRef: Common.ContentAddressedRef,
): EnterpriseProject.ProjectConfirmCustomerMaterialPayload {
  return {
    candidateVersionRef,
    completeness: 'COMPLETE',
    declaredStatus: 'approved',
    evidenceRefs: [{ evidence: sourceRef, relation: 'SUPPORTS' }],
    justification: {
      reasonCode: 'HUMAN_REVIEW',
      summary: 'Human reviewed the exact accepted SourceMaterial selection.',
      evidenceRefs: [{ evidence: sourceRef, relation: 'SUPPORTS' }],
    },
  };
}

describe.skipIf(!gateEnabled)(
  'EnterpriseProject CustomerMaterial vertical slice (real PostgreSQL, IM-03 WI-06)',
  { concurrent: false },
  () => {
    let admin: pg.Client;
    let pool: pg.Pool;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(
        `DO $do$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'im03_wi06_probe') THEN
             CREATE ROLE im03_wi06_probe LOGIN PASSWORD 'im03-wi06-probe'
               NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
           END IF;
         END $do$`,
      );
      await admin.query(
        `GRANT platform_context_establisher, enterprise_project_app TO im03_wi06_probe`,
      );
      const url = new URL(databaseUrl ?? '');
      url.username = 'im03_wi06_probe';
      url.password = 'im03-wi06-probe';
      pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
    });

    afterAll(async () => {
      await pool.end();
      await admin.end();
    });

    function db(): ReturnType<typeof createEnterpriseProjectDatabase> {
      return createEnterpriseProjectDatabase(pool);
    }

    it('EP-WI06-P-001/P-002 proposal and Human confirmation preserve immutable versions', async () => {
      const enterpriseId = newUuidV7();
      const seeded = await seedEnterpriseProject(db(), enterpriseId, 'P001');
      const source = await registerAndAcceptSource(db(), seeded.context, seeded.projectId, 'p001');
      const context = contextFor(enterpriseId, [seeded.projectId]);
      const proposal = materialProposal(
        enterpriseId,
        seeded.projectId,
        source.sourceRef,
        '采购控制程序',
      );
      const proposed = await handleProposeCustomerMaterial(
        db(),
        context,
        commandEnvelope(context, 'project.propose_customer_material', 'p001-propose', proposal, {
          projectId: seeded.projectId,
        }),
      );
      const proposedPayload = committedPayload(proposed) as unknown as {
        customerMaterialRef: Common.VersionedRef;
        proposalDecisionRef: Common.ContentAddressedRef;
      };
      expect(proposedPayload.customerMaterialRef).toMatchObject({
        kind: 'VERSIONED',
        objectType: 'CustomerMaterial',
        versionId: expect.any(String),
        scope: { enterpriseId, projectId: seeded.projectId },
      });
      expect(proposedPayload.proposalDecisionRef.objectType).toBe('BusinessDecision');

      const proposedRows = await admin.query<{
        classification_status: string;
        aggregate_version: string;
        current_version_id: string;
      }>(
        `SELECT classification_status, aggregate_version::text, current_version_id::text
           FROM enterprise_project.customer_material
          WHERE customer_material_id = $1`,
        [proposedPayload.customerMaterialRef.objectId],
      );
      expect(proposedRows.rows).toEqual([
        {
          classification_status: 'PROPOSED',
          aggregate_version: '1',
          current_version_id: proposedPayload.customerMaterialRef.versionId,
        },
      ]);

      const agentContext = contextFor(enterpriseId, [seeded.projectId], 'AGENT');
      await expect(
        handleConfirmCustomerMaterial(
          db(),
          agentContext,
          commandEnvelope(
            agentContext,
            'project.confirm_customer_material',
            'p001-agent-confirm',
            confirmationPayload(proposedPayload.customerMaterialRef, source.sourceRef),
            { projectId: seeded.projectId },
          ),
        ),
      ).rejects.toMatchObject({ code: PROJECT_HUMAN_ONLY_DENIED });

      const actingForPayload = {
        ...confirmationPayload(proposedPayload.customerMaterialRef, source.sourceRef),
        actingFor: objectRef('Principal', HUMAN_PRINCIPAL, enterpriseId),
      } as unknown as EnterpriseProject.ProjectConfirmCustomerMaterialPayload;
      await expect(
        handleConfirmCustomerMaterial(
          db(),
          context,
          commandEnvelope(
            context,
            'project.confirm_customer_material',
            'p001-acting-for',
            actingForPayload,
            { projectId: seeded.projectId },
          ),
        ),
      ).rejects.toMatchObject({ code: PROJECT_HUMAN_ONLY_DENIED });

      const humanConfirmation = await handleConfirmCustomerMaterial(
        db(),
        context,
        commandEnvelope(
          context,
          'project.confirm_customer_material',
          'p001-confirm',
          confirmationPayload(proposedPayload.customerMaterialRef, source.sourceRef),
          { projectId: seeded.projectId },
        ),
      );
      const confirmedPayload = committedPayload(humanConfirmation) as unknown as {
        customerMaterialRef: Common.VersionedRef;
        confirmationDecisionRef: Common.ContentAddressedRef;
      };
      expect(confirmedPayload.customerMaterialRef.versionId).not.toBe(
        proposedPayload.customerMaterialRef.versionId,
      );
      expect(confirmedPayload.confirmationDecisionRef.objectType).toBe('BusinessDecision');

      const versions = await admin.query<{
        version_no: number;
        version_status: string;
        title: string;
        payload_hash: Buffer;
      }>(
        `SELECT version_no, version_status, title, payload_hash
           FROM enterprise_project.customer_material_version
          WHERE customer_material_id = $1
          ORDER BY version_no`,
        [proposedPayload.customerMaterialRef.objectId],
      );
      expect(versions.rows).toHaveLength(2);
      expect(versions.rows[0]).toMatchObject({
        version_no: 1,
        version_status: 'PROPOSED',
        title: '采购控制程序',
      });
      expect(versions.rows[1]).toMatchObject({
        version_no: 2,
        version_status: 'CONFIRMED',
        title: '采购控制程序',
      });
      const firstVersion = versions.rows[0];
      const secondVersion = versions.rows[1];
      if (firstVersion === undefined || secondVersion === undefined) {
        throw new Error('CustomerMaterial confirmation fixture requires two versions');
      }
      expect(firstVersion.payload_hash.equals(secondVersion.payload_hash)).toBe(false);

      const root = await admin.query<{
        classification_status: string;
        completeness: string;
        declared_status: string;
        aggregate_version: string;
        current_version_id: string;
      }>(
        `SELECT classification_status, completeness, declared_status,
                aggregate_version::text, current_version_id::text
           FROM enterprise_project.customer_material
          WHERE customer_material_id = $1`,
        [proposedPayload.customerMaterialRef.objectId],
      );
      expect(root.rows[0]).toEqual({
        classification_status: 'CONFIRMED',
        completeness: 'COMPLETE',
        declared_status: 'approved',
        aggregate_version: '2',
        current_version_id: confirmedPayload.customerMaterialRef.versionId,
      });

      const staleCas = await withEnterpriseProjectTransaction(db(), context, (trx) =>
        new EnterpriseBusinessRepository().casCustomerMaterial(
          trx,
          proposedPayload.customerMaterialRef.objectId,
          '1',
          newUuidV7(),
          'CONFIRMED',
          {
            completeness: 'COMPLETE',
            declaredStatus: 'approved',
            sourceCommandId: newUuidV7(),
          },
        ),
      );
      expect(staleCas).toEqual({ ok: false, current: '2' });

      const decisions = await admin.query<{ decision_kind: string; version_id: string }>(
        `SELECT decision_kind, version_id::text
           FROM enterprise_project.customer_material_decision
          WHERE customer_material_id = $1
          ORDER BY recorded_at, decision_id`,
        [proposedPayload.customerMaterialRef.objectId],
      );
      expect(decisions.rows).toHaveLength(2);
      expect(decisions.rows.map((row) => row.decision_kind)).toEqual(['PROPOSED', 'CONFIRMED']);

      const event = await admin.query<{ payload: unknown; aggregate_version: string }>(
        `SELECT payload, aggregate_version::text
           FROM enterprise_project.outbox_event
          WHERE event_type = 'project.CustomerMaterialConfirmed'
            AND aggregate_id = $1`,
        [proposedPayload.customerMaterialRef.objectId],
      );
      expect(event.rows).toHaveLength(1);
      expect(event.rows[0]?.aggregate_version).toBe('2');
      const eventPayload = event.rows[0]?.payload as Record<string, unknown>;
      expect(eventPayload).toMatchObject({
        customerMaterialRef: confirmedPayload.customerMaterialRef,
        materialType: 'quality.procedure',
        completeness: 'COMPLETE',
        confirmationDecisionRef: confirmedPayload.confirmationDecisionRef,
      });
      expect(eventPayload).not.toHaveProperty('title');
      expect(eventPayload).not.toHaveProperty('originalName');
      expect(eventPayload).not.toHaveProperty('sourceSelections');

      await expect(
        withEnterpriseProjectTransaction(db(), context, async (trx) => {
          await sql`
            UPDATE enterprise_project.customer_material_version
               SET title = '改写确认版本'
             WHERE version_id = ${confirmedPayload.customerMaterialRef.versionId}::uuid
          `.execute(trx);
        }),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        withEnterpriseProjectTransaction(db(), context, async (trx) => {
          await sql`
            DELETE FROM enterprise_project.customer_material_version
             WHERE version_id = ${confirmedPayload.customerMaterialRef.versionId}::uuid
          `.execute(trx);
        }),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        withEnterpriseProjectTransaction(db(), context, async (trx) => {
          await sql`
            UPDATE enterprise_project.customer_material_decision
               SET justification = '{}'::jsonb
             WHERE decision_id = ${confirmedPayload.confirmationDecisionRef.objectId}::uuid
          `.execute(trx);
        }),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        withEnterpriseProjectTransaction(db(), context, async (trx) => {
          await sql`
            DELETE FROM enterprise_project.customer_material_decision
             WHERE decision_id = ${confirmedPayload.confirmationDecisionRef.objectId}::uuid
          `.execute(trx);
        }),
      ).rejects.toMatchObject({ code: '42501' });

      const replay = await handleProposeCustomerMaterial(
        db(),
        context,
        commandEnvelope(context, 'project.propose_customer_material', 'p001-propose', proposal, {
          projectId: seeded.projectId,
        }),
      );
      expect(replay.status).toBe('DUPLICATE');
      await expect(
        handleProposeCustomerMaterial(
          db(),
          context,
          commandEnvelope(
            context,
            'project.propose_customer_material',
            'p001-propose',
            materialProposal(enterpriseId, seeded.projectId, source.sourceRef, '幂等冲突材料'),
            { projectId: seeded.projectId },
          ),
        ),
      ).rejects.toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT });

      const confirmationReplay = await handleConfirmCustomerMaterial(
        db(),
        context,
        commandEnvelope(
          context,
          'project.confirm_customer_material',
          'p001-confirm',
          confirmationPayload(proposedPayload.customerMaterialRef, source.sourceRef),
          { projectId: seeded.projectId },
        ),
      );
      expect(confirmationReplay.status).toBe('DUPLICATE');
      await expect(
        handleConfirmCustomerMaterial(
          db(),
          context,
          commandEnvelope(
            context,
            'project.confirm_customer_material',
            'p001-confirm',
            {
              ...confirmationPayload(proposedPayload.customerMaterialRef, source.sourceRef),
              declaredStatus: 'rejected',
            },
            { projectId: seeded.projectId },
          ),
        ),
      ).rejects.toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT });
      const staleCandidate = await handleConfirmCustomerMaterial(
        db(),
        context,
        commandEnvelope(
          context,
          'project.confirm_customer_material',
          'p001-stale-candidate',
          confirmationPayload(proposedPayload.customerMaterialRef, source.sourceRef),
          { projectId: seeded.projectId },
        ),
      );
      expect(staleCandidate).toMatchObject({
        status: 'REJECTED',
        errorCode: PROJECT_MATERIAL_CONFIRMATION_CONFLICT,
        currentAggregateVersion: '2',
      });
    });

    it('EP-WI06-P-003 rejects unaccepted and hash-mismatched SourceMaterial refs', async () => {
      const enterpriseId = newUuidV7();
      const seeded = await seedEnterpriseProject(db(), enterpriseId, 'P003');
      const unaccepted = await registerAndAcceptSource(
        db(),
        seeded.context,
        seeded.projectId,
        'p003-unaccepted',
        'b'.repeat(64),
        false,
      );
      const context = contextFor(enterpriseId, [seeded.projectId]);
      const unacceptedResult = await handleProposeCustomerMaterial(
        db(),
        context,
        commandEnvelope(
          context,
          'project.propose_customer_material',
          'p003-unaccepted',
          materialProposal(enterpriseId, seeded.projectId, unaccepted.sourceRef, '未接受材料'),
          { projectId: seeded.projectId },
        ),
      );
      expect(unacceptedResult).toMatchObject({
        status: 'REJECTED',
        errorCode: PROJECT_MATERIAL_SOURCE_INVALID,
      });

      const accepted = await registerAndAcceptSource(
        db(),
        seeded.context,
        seeded.projectId,
        'p003-accepted',
      );
      const wrongHashRef = contentRef(
        'SourceMaterial',
        accepted.sourceMaterialId,
        enterpriseId,
        seeded.projectId,
        'c'.repeat(64),
      );
      const wrongHashResult = await handleProposeCustomerMaterial(
        db(),
        context,
        commandEnvelope(
          context,
          'project.propose_customer_material',
          'p003-wrong-hash',
          materialProposal(enterpriseId, seeded.projectId, wrongHashRef, '错误 Hash'),
          { projectId: seeded.projectId },
        ),
      );
      expect(wrongHashResult).toMatchObject({
        status: 'REJECTED',
        errorCode: PROJECT_MATERIAL_SOURCE_INVALID,
      });
      const crossProjectRef = {
        ...accepted.sourceRef,
        scope: { enterpriseId, projectId: newUuidV7() },
      };
      await expect(
        handleProposeCustomerMaterial(
          db(),
          context,
          commandEnvelope(
            context,
            'project.propose_customer_material',
            'p003-cross-project',
            materialProposal(enterpriseId, seeded.projectId, crossProjectRef, '跨 Project 材料'),
            { projectId: seeded.projectId },
          ),
        ),
      ).rejects.toMatchObject({ code: PROJECT_MATERIAL_SOURCE_INVALID });
      const versionedSourceRef = {
        ...accepted.sourceRef,
        immutableVersionId: newUuidV7(),
      };
      await expect(
        handleProposeCustomerMaterial(
          db(),
          context,
          commandEnvelope(
            context,
            'project.propose_customer_material',
            'p003-versioned-source',
            materialProposal(enterpriseId, seeded.projectId, versionedSourceRef, '伪造版本材料'),
            { projectId: seeded.projectId },
          ),
        ),
      ).rejects.toMatchObject({ code: PROJECT_MATERIAL_SOURCE_INVALID });
      const persisted = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM enterprise_project.customer_material
          WHERE enterprise_id = $1 AND project_id = $2`,
        [enterpriseId, seeded.projectId],
      );
      expect(persisted.rows[0]?.count).toBe('0');
    });

    it('EP-WI06-P-005 refuses conflicting current proposals instead of last-write-wins', async () => {
      const enterpriseId = newUuidV7();
      const seeded = await seedEnterpriseProject(db(), enterpriseId, 'P005');
      const source = await registerAndAcceptSource(db(), seeded.context, seeded.projectId, 'p005');
      const context = contextFor(enterpriseId, [seeded.projectId]);
      const first = await handleProposeCustomerMaterial(
        db(),
        context,
        commandEnvelope(
          context,
          'project.propose_customer_material',
          'p005-first',
          materialProposal(enterpriseId, seeded.projectId, source.sourceRef, '采购控制程序'),
          { projectId: seeded.projectId },
        ),
      );
      const firstRef = (
        committedPayload(first) as unknown as { customerMaterialRef: Common.VersionedRef }
      ).customerMaterialRef;
      const second = await handleProposeCustomerMaterial(
        db(),
        context,
        commandEnvelope(
          context,
          'project.propose_customer_material',
          'p005-second',
          materialProposal(enterpriseId, seeded.projectId, source.sourceRef, '供应商管理程序'),
          { projectId: seeded.projectId },
        ),
      );
      expect(second.status).toBe('COMMITTED');
      const conflict = await handleConfirmCustomerMaterial(
        db(),
        context,
        commandEnvelope(
          context,
          'project.confirm_customer_material',
          'p005-conflict',
          confirmationPayload(firstRef, source.sourceRef),
          { projectId: seeded.projectId },
        ),
      );
      expect(conflict).toMatchObject({
        status: 'REJECTED',
        errorCode: PROJECT_MATERIAL_CONFLICT_UNRESOLVED,
      });
      const eventCount = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM enterprise_project.outbox_event
          WHERE event_type = 'project.CustomerMaterialConfirmed'
            AND project_id = $1`,
        [seeded.projectId],
      );
      expect(eventCount.rows[0]?.count).toBe('0');
    });

    it('EP-WI06-RLS-001 hides CustomerMaterial outside the allowed Project context', async () => {
      const enterpriseId = newUuidV7();
      const seeded = await seedEnterpriseProject(db(), enterpriseId, 'RLS');
      const source = await registerAndAcceptSource(db(), seeded.context, seeded.projectId, 'rls');
      const context = contextFor(enterpriseId, [seeded.projectId]);
      const proposal = await handleProposeCustomerMaterial(
        db(),
        context,
        commandEnvelope(
          context,
          'project.propose_customer_material',
          'rls-propose',
          materialProposal(enterpriseId, seeded.projectId, source.sourceRef, 'RLS 材料'),
          { projectId: seeded.projectId },
        ),
      );
      const proposedPayload = committedPayload(proposal) as unknown as {
        customerMaterialRef: Common.VersionedRef;
      };
      const repository = new EnterpriseBusinessRepository();
      await withEnterpriseProjectTransaction(db(), contextFor(enterpriseId), async (trx) => {
        expect(
          await repository.getCustomerMaterialById(
            trx,
            proposedPayload.customerMaterialRef.objectId,
          ),
        ).toBeUndefined();
        expect(
          await repository.getCustomerMaterialsByProject(trx, enterpriseId, seeded.projectId),
        ).toHaveLength(0);
      });
      await withEnterpriseProjectTransaction(db(), context, async (trx) => {
        expect(
          await repository.getCustomerMaterialById(
            trx,
            proposedPayload.customerMaterialRef.objectId,
          ),
        ).toMatchObject({
          customer_material_id: proposedPayload.customerMaterialRef.objectId,
          project_id: seeded.projectId,
        });
      });
    });
  },
);
