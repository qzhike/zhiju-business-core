// IM-03 WI-08 (issue #64): real PostgreSQL acceptance tests for controlled
// Platform reference lifecycle and Project TemplateBaseline/RegulatoryProfile
// exact-reference freeze, RLS, immutability, idempotency and CAS.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql } from 'kysely';
import {
  CONCURRENCY_CONFLICT,
  createEnterpriseProjectDatabase,
  digestCanonicalPayload,
  handleActivateRegulatoryProfile,
  handleFreezeTemplateBaseline,
  handleGetActiveBaselineRefs,
  handlePlatformRegulatoryImportVersion,
  handlePlatformRegulatoryPublishVersion,
  handlePlatformTemplateImportVersion,
  handlePlatformTemplatePublishVersion,
  PLATFORM_CONTROL_SCOPE_ID,
  PROJECT_PLATFORM_REFERENCE_HASH_MISMATCH,
  PROJECT_PLATFORM_REFERENCE_INVALID,
  PROJECT_PLATFORM_REFERENCE_ROLE_REQUIRED,
  PROJECT_PLATFORM_REGULATORY_SOURCE_REQUIRED,
  PROJECT_REGULATORY_EVIDENCE_REQUIRED,
  PROJECT_HUMAN_ONLY_DENIED,
  PROJECT_TEMPLATE_LATEST_FORBIDDEN,
  TemplateRegulatoryRepository,
  withEnterpriseProjectTransaction,
  type CommandEnvelope,
  type CommandResult,
  type EnterprisePrincipalKind,
  type EnterpriseProjectTransactionContext,
  type PlatformRegulatoryImportVersionPayload,
  type PlatformTemplateImportVersionPayload,
} from '@zhiju/enterprise-project';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Common, EnterpriseProject } from '@zhiju/contracts';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const HUMAN_PRINCIPAL = 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f1f1';
const SERVICE_PRINCIPAL = 'f2f2f2f2-f2f2-72f2-82f2-f2f2f2f2f2f2';
const HUMAN_ACTOR = 'f3f3f3f3-f3f3-73f3-83f3-f3f3f3f3f3f3';
const SERVICE_ACTOR = 'f4f4f4f4-f4f4-74f4-84f4-f4f4f4f4f4f4';
const AUTHORIZATION_DECISION = 'f5f5f5f5-f5f5-75f5-85f5-f5f5f5f5f5f5';
const POLICY_SNAPSHOT = 'f6f6f6f6-f6f6-76f6-86f6-f6f6f6f6f6f6';
const DECISION_HASH = Buffer.alloc(32, 0x64);

function contextFor(
  enterpriseId: string,
  allowedProjectIds: readonly string[] = [],
  principalKind: EnterprisePrincipalKind = 'HUMAN',
  capabilities?: readonly ('PLATFORM_REFERENCE_ADMIN' | 'PLATFORM_REFERENCE_PUBLISHER')[],
): EnterpriseProjectTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: principalKind === 'HUMAN' ? HUMAN_PRINCIPAL : SERVICE_PRINCIPAL,
    principalKind,
    actorSnapshotId: principalKind === 'HUMAN' ? HUMAN_ACTOR : SERVICE_ACTOR,
    authorizationDecisionId: AUTHORIZATION_DECISION,
    authorizationDecisionHash: DECISION_HASH,
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY_SNAPSHOT,
    enterpriseId,
    allowedProjectIds,
    correlationId: newUuidV7(),
    ...(capabilities === undefined ? {} : { platformReferenceCapabilities: capabilities }),
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

function versionedRef(
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

function contentHash(hash: Buffer): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: hash.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function contentRef(
  objectType: string,
  objectId: string,
  hash: Buffer,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    scope: {},
    contentHash: contentHash(hash),
  };
}

function projectSnapshotRef(
  objectType: 'TemplateReview' | 'RegulatoryReview',
  enterpriseId: string,
  projectId: string,
): Common.SnapshotRef {
  const snapshotId = newUuidV7();
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: newUuidV7(),
    snapshotId,
    scope: { enterpriseId, projectId },
    contentHash: contentHash(Buffer.alloc(32, 0x65)),
  };
}

function justification(reasonCode = 'WI08_REVIEW'): EnterpriseProject.Justification {
  return {
    reasonCode,
    summary: 'The exact WI-08 reference set was reviewed by an authorized Human.',
    evidenceRefs: [],
  };
}

function evidenceRef(enterpriseId: string, projectId: string): EnterpriseProject.EvidenceRef {
  return {
    evidence: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'EvidenceRecord',
      objectId: newUuidV7(),
      scope: { enterpriseId, projectId },
      contentHash: contentHash(Buffer.alloc(32, 0x66)),
    },
    relation: 'SUPPORTS',
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
    idempotencyScope: 'im03.wi08',
    idempotencyKey,
    requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
    enterpriseId: context.enterpriseId,
    projectId: undefined,
    targetType: 'ReferenceTemplate',
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

interface Fixture {
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly productId: string;
  readonly productScopeSnapshotId: string;
  readonly productScopePayloadHash: Buffer;
}

async function seedFixture(admin: pg.Client): Promise<Fixture> {
  const enterpriseId = newUuidV7();
  const projectId = newUuidV7();
  const productId = newUuidV7();
  const productScopeSnapshotId = newUuidV7();
  const productScopePayloadHash = Buffer.alloc(32, 0x67);
  await admin.query(
    `INSERT INTO enterprise_project.product
       (product_id, enterprise_id, display_code, display_name, status,
        current_version_id, created_by_principal_id, created_by_actor_snapshot_id,
        last_command_id)
     VALUES ($1, $2, $3, $4, 'ACTIVE', NULL, $5, $6, $7)`,
    [
      productId,
      enterpriseId,
      `WI08-${productId.slice(-8)}`,
      'WI-08 fixture product',
      HUMAN_PRINCIPAL,
      HUMAN_ACTOR,
      newUuidV7(),
    ],
  );
  await admin.query(
    `INSERT INTO enterprise_project.project
       (project_id, enterprise_id, display_code, title, objective, status,
        member_policy_ref, member_policy_version_id, member_policy_payload_hash,
        created_by_principal_id, created_by_actor_snapshot_id, last_command_id)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6::jsonb, $7, $8, $9, $10, $11)`,
    [
      projectId,
      enterpriseId,
      `WI08-${projectId.slice(-8)}`,
      'WI-08 Template and Regulatory fixture',
      'Exercise exact reference freezing and activation.',
      JSON.stringify({
        kind: 'VERSIONED',
        objectType: 'Policy',
        objectId: newUuidV7(),
        versionId: newUuidV7(),
      }),
      newUuidV7(),
      Buffer.alloc(32, 0x68),
      HUMAN_PRINCIPAL,
      HUMAN_ACTOR,
      newUuidV7(),
    ],
  );
  const productScopePayload = {
    enterpriseId,
    productId,
    productType: 'fixture.product',
    displayName: 'WI-08 fixture product',
  };
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
      'WI08_TEST',
      newUuidV7(),
    ],
  );
  return {
    enterpriseId,
    projectId,
    productId,
    productScopeSnapshotId,
    productScopePayloadHash,
  };
}

function platformContext(
  capability: 'PLATFORM_REFERENCE_ADMIN' | 'PLATFORM_REFERENCE_PUBLISHER',
): EnterpriseProjectTransactionContext {
  return contextFor(PLATFORM_CONTROL_SCOPE_ID, [], 'SERVICE', [capability]);
}

function projectContext(fixture: Fixture): EnterpriseProjectTransactionContext {
  return contextFor(fixture.enterpriseId, [fixture.projectId]);
}

function templateImportPayload(
  referenceTemplateId: string,
  versionId: string,
  versionLabel: string,
  contentRefValue: Common.ContentAddressedRef,
): PlatformTemplateImportVersionPayload {
  return {
    referenceTemplateId,
    referenceCode: `WI08-TEMPLATE-${referenceTemplateId.slice(-8)}`,
    templateType: 'CONTROL_PROCEDURE',
    versionId,
    versionLabel,
    contentRef: contentRefValue,
    contentHash: contentRefValue.contentHash,
    sourceRef: { sourceSystem: 'fixture', sourceLocator: `template/${versionLabel}` },
    applicability: { jurisdiction: 'CN', productFamily: 'fixture' },
  };
}

function regulatoryImportPayload(
  regulatoryReferenceId: string,
  versionId: string,
  versionLabel: string,
  contentRefValue: Common.ContentAddressedRef,
): PlatformRegulatoryImportVersionPayload {
  return {
    regulatoryReferenceId,
    authorityCode: 'CN-REGULATOR',
    jurisdiction: 'CN',
    referenceCode: `WI08-REG-${regulatoryReferenceId.slice(-8)}`,
    versionId,
    versionLabel,
    citation: 'Fixture regulatory citation',
    effectivePeriod: { validFrom: '2026-01-01T00:00:00Z' },
    sourceRef: { sourceSystem: 'fixture', sourceLocator: `regulatory/${versionLabel}` },
    contentRef: contentRefValue,
    contentHash: contentRefValue.contentHash,
    verificationRefs: [contentRef('RegulatoryVerification', newUuidV7(), Buffer.alloc(32, 0x69))],
  };
}

describe.skipIf(!gateEnabled)(
  'TemplateBaseline and RegulatoryProfile WI-08 (real PostgreSQL)',
  () => {
    let admin: pg.Client;
    let pool: pg.Pool;
    let db: ReturnType<typeof createEnterpriseProjectDatabase>;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(
        `DO $do$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'im03_wi08_probe') THEN
           CREATE ROLE im03_wi08_probe LOGIN PASSWORD 'im03-wi08-probe'
             NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
         END IF;
       END $do$`,
      );
      await admin.query(
        `GRANT platform_context_establisher, enterprise_project_app,
              enterprise_project_platform_reference_writer TO im03_wi08_probe`,
      );
      const url = new URL(databaseUrl ?? '');
      url.username = 'im03_wi08_probe';
      url.password = 'im03-wi08-probe';
      pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
      db = createEnterpriseProjectDatabase(pool);
    });

    afterAll(async () => {
      await pool.end();
      await admin.end();
    });

    it('EP-WI08-U-001: rejects invalid platform inputs before opening a transaction', async () => {
      const adminContext = platformContext('PLATFORM_REFERENCE_ADMIN');
      const templateId = newUuidV7();
      const templateVersionId = newUuidV7();
      const templateHash = digestCanonicalPayload({ title: 'WI-08 validation fixture' }).hash;
      const templateVersionRef = contentRef('TemplateDocument', newUuidV7(), templateHash);
      await expect(
        handlePlatformTemplateImportVersion(
          db,
          adminContext,
          commandEnvelope(
            adminContext,
            'enterprise_project.platform_template_import_version',
            `validation-source-${templateVersionId}`,
            {
              ...templateImportPayload(templateId, templateVersionId, 'v1', templateVersionRef),
              sourceRef: {},
            },
            { platform: true, targetType: 'ReferenceTemplate', targetId: templateId },
          ),
        ),
      ).rejects.toMatchObject({ code: PROJECT_PLATFORM_REFERENCE_INVALID });
      await expect(
        handlePlatformTemplateImportVersion(
          db,
          adminContext,
          commandEnvelope(
            adminContext,
            'enterprise_project.platform_template_import_version',
            `validation-hash-${templateVersionId}`,
            {
              ...templateImportPayload(templateId, templateVersionId, 'v1', templateVersionRef),
              contentHash: contentHash(Buffer.alloc(32, 0x70)),
            },
            { platform: true, targetType: 'ReferenceTemplate', targetId: templateId },
          ),
        ),
      ).rejects.toMatchObject({ code: PROJECT_PLATFORM_REFERENCE_HASH_MISMATCH });
      const noCapabilityContext = contextFor(PLATFORM_CONTROL_SCOPE_ID);
      await expect(
        handlePlatformTemplateImportVersion(
          db,
          noCapabilityContext,
          commandEnvelope(
            noCapabilityContext,
            'enterprise_project.platform_template_import_version',
            `validation-capability-${templateVersionId}`,
            templateImportPayload(templateId, templateVersionId, 'v1', templateVersionRef),
            { platform: true, targetType: 'ReferenceTemplate', targetId: templateId },
          ),
        ),
      ).rejects.toMatchObject({ code: PROJECT_PLATFORM_REFERENCE_ROLE_REQUIRED });

      const regulatoryId = newUuidV7();
      const regulatoryVersionId = newUuidV7();
      const regulatoryHash = digestCanonicalPayload({ citation: 'WI-08 validation fixture' }).hash;
      const regulatoryVersionRef = contentRef('RegulatoryDocument', newUuidV7(), regulatoryHash);
      await expect(
        handlePlatformRegulatoryImportVersion(
          db,
          adminContext,
          commandEnvelope(
            adminContext,
            'enterprise_project.platform_regulatory_import_version',
            `validation-verification-${regulatoryVersionId}`,
            {
              ...regulatoryImportPayload(
                regulatoryId,
                regulatoryVersionId,
                'v1',
                regulatoryVersionRef,
              ),
              verificationRefs: [],
            },
            { platform: true, targetType: 'RegulatoryReference', targetId: regulatoryId },
          ),
        ),
      ).rejects.toMatchObject({ code: PROJECT_PLATFORM_REGULATORY_SOURCE_REQUIRED });
    });

    it('EP-WI08-P-001/RLS: imports and publishes exact platform versions with app isolation', async () => {
      const fixture = await seedFixture(admin);
      const adminContext = platformContext('PLATFORM_REFERENCE_ADMIN');
      const publisherContext = platformContext('PLATFORM_REFERENCE_PUBLISHER');
      const templateId = newUuidV7();
      const templateVersion1 = newUuidV7();
      const templateContent1 = { title: 'WI-08 template v1', controls: ['C-001'] };
      const templateHash1 = digestCanonicalPayload(templateContent1).hash;
      const templateRef1 = contentRef('TemplateDocument', newUuidV7(), templateHash1);
      const templateImportEnvelope = commandEnvelope(
        adminContext,
        'enterprise_project.platform_template_import_version',
        `template-import-${templateVersion1}`,
        templateImportPayload(templateId, templateVersion1, 'v1', templateRef1),
        {
          platform: true,
          targetType: 'ReferenceTemplate',
          targetId: templateId,
        },
      );
      const imported = await handlePlatformTemplateImportVersion(
        db,
        adminContext,
        templateImportEnvelope,
      );
      expect(committedPayload(imported)).toMatchObject({
        lifecycle: 'DRAFT',
        versionNo: 1,
        referenceTemplateVersionRef: { immutableVersionId: templateVersion1 },
      });

      const appRepo = new TemplateRegulatoryRepository();
      const appContext = projectContext(fixture);
      await withEnterpriseProjectTransaction(db, appContext, async (trx) => {
        expect(await appRepo.getReferenceTemplateVersion(trx, templateVersion1)).toBeUndefined();
      });

      const replay = await handlePlatformTemplateImportVersion(
        db,
        adminContext,
        templateImportEnvelope,
      );
      expect(replay.status).toBe('DUPLICATE');

      const published = await handlePlatformTemplatePublishVersion(
        db,
        publisherContext,
        commandEnvelope(
          publisherContext,
          'enterprise_project.platform_template_publish_version',
          `template-publish-${templateVersion1}`,
          {
            referenceTemplateId: templateId,
            versionId: templateVersion1,
            releaseDecisionRef: { decision: 'APPROVE', fixture: true },
            publishReason: { reasonCode: 'WI08_RELEASED' },
          },
          {
            platform: true,
            targetType: 'ReferenceTemplate',
            targetId: templateId,
            expectedAggregateVersion: '1',
          },
        ),
      );
      expect(committedPayload(published)).toMatchObject({ lifecycle: 'PUBLISHED', versionNo: 1 });

      const templateVersion2 = newUuidV7();
      const templateContent2 = { title: 'WI-08 template v2', controls: ['C-001', 'C-002'] };
      const templateHash2 = digestCanonicalPayload(templateContent2).hash;
      const templateRef2 = contentRef('TemplateDocument', newUuidV7(), templateHash2);
      await handlePlatformTemplateImportVersion(
        db,
        adminContext,
        commandEnvelope(
          adminContext,
          'enterprise_project.platform_template_import_version',
          `template-import-${templateVersion2}`,
          templateImportPayload(templateId, templateVersion2, 'v2', templateRef2),
          {
            platform: true,
            targetType: 'ReferenceTemplate',
            targetId: templateId,
            expectedAggregateVersion: '2',
          },
        ),
      );
      await handlePlatformTemplatePublishVersion(
        db,
        publisherContext,
        commandEnvelope(
          publisherContext,
          'enterprise_project.platform_template_publish_version',
          `template-publish-${templateVersion2}`,
          {
            referenceTemplateId: templateId,
            versionId: templateVersion2,
            releaseDecisionRef: { decision: 'APPROVE', fixture: true },
            publishReason: { reasonCode: 'WI08_RELEASED_V2' },
          },
          {
            platform: true,
            targetType: 'ReferenceTemplate',
            targetId: templateId,
            expectedAggregateVersion: '3',
          },
        ),
      );
      await withEnterpriseProjectTransaction(db, appContext, async (trx) => {
        const oldVersion = await appRepo.getReferenceTemplateVersion(trx, templateVersion1);
        const newVersion = await appRepo.getReferenceTemplateVersion(trx, templateVersion2);
        expect(oldVersion?.lifecycle).toBe('PUBLISHED');
        expect(newVersion?.lifecycle).toBe('PUBLISHED');
        expect(oldVersion?.content_hash.equals(templateHash1)).toBe(true);
        expect(newVersion?.content_hash.equals(templateHash2)).toBe(true);
      });

      await expect(
        withEnterpriseProjectTransaction(db, appContext, async (trx) => {
          await sql`
          UPDATE enterprise_project.reference_template_version
             SET version_label = 'tampered'
           WHERE reference_template_version_id = ${templateVersion1}::uuid
        `.execute(trx);
        }),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('EP-WI08-P-002/P-003/C-002: freezes exact template/regulatory refs and exposes active refs', async () => {
      const fixture = await seedFixture(admin);
      const adminContext = platformContext('PLATFORM_REFERENCE_ADMIN');
      const publisherContext = platformContext('PLATFORM_REFERENCE_PUBLISHER');
      const templateId = newUuidV7();
      const templateVersionId = newUuidV7();
      const templateHash = digestCanonicalPayload({ title: 'WI-08 project template' }).hash;
      const templateVersionRef = contentRef('TemplateDocument', newUuidV7(), templateHash);
      await handlePlatformTemplateImportVersion(
        db,
        adminContext,
        commandEnvelope(
          adminContext,
          'enterprise_project.platform_template_import_version',
          `project-template-import-${templateVersionId}`,
          templateImportPayload(templateId, templateVersionId, 'v1', templateVersionRef),
          { platform: true, targetType: 'ReferenceTemplate', targetId: templateId },
        ),
      );
      await handlePlatformTemplatePublishVersion(
        db,
        publisherContext,
        commandEnvelope(
          publisherContext,
          'enterprise_project.platform_template_publish_version',
          `project-template-publish-${templateVersionId}`,
          {
            referenceTemplateId: templateId,
            versionId: templateVersionId,
            releaseDecisionRef: { decision: 'APPROVE' },
            publishReason: { reasonCode: 'WI08_TEST_RELEASE' },
          },
          {
            platform: true,
            targetType: 'ReferenceTemplate',
            targetId: templateId,
            expectedAggregateVersion: '1',
          },
        ),
      );

      const regulatoryId = newUuidV7();
      const regulatoryVersionId = newUuidV7();
      const regulatoryHash = digestCanonicalPayload({ citation: 'WI-08 fixture regulation' }).hash;
      const regulatoryVersionRef = contentRef('RegulatoryDocument', newUuidV7(), regulatoryHash);
      await handlePlatformRegulatoryImportVersion(
        db,
        adminContext,
        commandEnvelope(
          adminContext,
          'enterprise_project.platform_regulatory_import_version',
          `project-regulatory-import-${regulatoryVersionId}`,
          regulatoryImportPayload(regulatoryId, regulatoryVersionId, 'v1', regulatoryVersionRef),
          { platform: true, targetType: 'RegulatoryReference', targetId: regulatoryId },
        ),
      );
      await handlePlatformRegulatoryPublishVersion(
        db,
        publisherContext,
        commandEnvelope(
          publisherContext,
          'enterprise_project.platform_regulatory_publish_version',
          `project-regulatory-publish-${regulatoryVersionId}`,
          {
            regulatoryReferenceId: regulatoryId,
            versionId: regulatoryVersionId,
            releaseDecisionRef: { decision: 'APPROVE' },
            publishReason: { reasonCode: 'WI08_TEST_RELEASE' },
          },
          {
            platform: true,
            targetType: 'RegulatoryReference',
            targetId: regulatoryId,
            expectedAggregateVersion: '1',
          },
        ),
      );

      const humanContext = projectContext(fixture);
      const baselineId = newUuidV7();
      const baselineVersionId = newUuidV7();
      const freezePayload: EnterpriseProject.ProjectFreezeTemplateBaselinePayload = {
        templateBaselineVersionRef: versionedRef(
          'TemplateBaseline',
          baselineId,
          baselineVersionId,
          fixture.enterpriseId,
          fixture.projectId,
        ),
        selections: [
          {
            deliveryCategory: 'CONTROL_PROCEDURE',
            templateRef: {
              ...templateVersionRef,
              objectType: 'TemplateVersion',
              objectId: templateId,
              immutableVersionId: templateVersionId,
            },
            applicabilityScope: { jurisdiction: 'CN', productId: fixture.productId },
            selectionReason: justification('WI08_TEMPLATE_SELECTED'),
          },
        ],
        reviewSnapshotRef: projectSnapshotRef(
          'TemplateReview',
          fixture.enterpriseId,
          fixture.projectId,
        ),
        selectionRationale: justification('WI08_TEMPLATE_BASELINE_FROZEN'),
      };
      const serviceContext = contextFor(fixture.enterpriseId, [fixture.projectId], 'SERVICE');
      await expect(
        handleFreezeTemplateBaseline(
          db,
          serviceContext,
          commandEnvelope(
            serviceContext,
            'project.freeze_template_baseline',
            `reject-service-${baselineVersionId}`,
            freezePayload,
            {
              projectId: fixture.projectId,
              targetType: 'TemplateBaseline',
              targetId: baselineId,
            },
          ),
        ),
      ).rejects.toMatchObject({ code: PROJECT_HUMAN_ONLY_DENIED });
      const freezeEnvelope = commandEnvelope(
        humanContext,
        'project.freeze_template_baseline',
        `freeze-${baselineVersionId}`,
        freezePayload,
        {
          projectId: fixture.projectId,
          targetType: 'TemplateBaseline',
          targetId: baselineId,
        },
      );
      const frozen = await handleFreezeTemplateBaseline(db, humanContext, freezeEnvelope);
      const frozenPayload = committedPayload(frozen) as unknown as {
        templateBaselineRef: Common.VersionedRef;
      };
      expect(frozenPayload.templateBaselineRef).toMatchObject({
        objectType: 'TemplateBaseline',
        versionId: baselineVersionId,
      });

      const regulatoryProfileId = newUuidV7();
      const regulatoryProfileVersionId = newUuidV7();
      const productScopeSnapshotRef: Common.SnapshotRef = {
        kind: 'SNAPSHOT',
        objectType: 'ProductScopeSnapshot',
        objectId: fixture.productId,
        snapshotId: fixture.productScopeSnapshotId,
        scope: { enterpriseId: fixture.enterpriseId },
        contentHash: contentHash(fixture.productScopePayloadHash),
      };
      const activated = await handleActivateRegulatoryProfile(
        db,
        humanContext,
        commandEnvelope(
          humanContext,
          'project.activate_regulatory_profile',
          `activate-${regulatoryProfileVersionId}`,
          {
            regulatoryProfileVersionRef: versionedRef(
              'RegulatoryProfile',
              regulatoryProfileId,
              regulatoryProfileVersionId,
              fixture.enterpriseId,
              fixture.projectId,
            ),
            jurisdiction: 'CN',
            productScopeSnapshotRef,
            applicabilityItems: [
              {
                regulatoryReferenceRef: {
                  ...regulatoryVersionRef,
                  objectType: 'RegulatoryReferenceVersion',
                  objectId: regulatoryId,
                  immutableVersionId: regulatoryVersionId,
                },
                applicability: 'APPLICABLE',
                rationale: justification('WI08_REGULATORY_APPLICABLE'),
                evidenceRefs: [evidenceRef(fixture.enterpriseId, fixture.projectId)],
                riskLevel: 'MEDIUM',
              },
            ],
            reviewSnapshotRef: projectSnapshotRef(
              'RegulatoryReview',
              fixture.enterpriseId,
              fixture.projectId,
            ),
          },
          {
            projectId: fixture.projectId,
            targetType: 'RegulatoryProfile',
            targetId: regulatoryProfileId,
          },
        ),
      );
      const activatedPayload = committedPayload(activated) as unknown as {
        regulatoryProfileRef: Common.VersionedRef;
      };
      expect(activatedPayload.regulatoryProfileRef.versionId).toBe(regulatoryProfileVersionId);

      const active = await handleGetActiveBaselineRefs(db, humanContext, {
        projectRef: objectRef(
          'Project',
          fixture.projectId,
          fixture.enterpriseId,
          fixture.projectId,
        ),
      });
      expect(active.customerBaselineRef).toBeUndefined();
      expect(active.templateBaselineRef).toEqual(frozenPayload.templateBaselineRef);
      expect(active.regulatoryProfileRef).toEqual(activatedPayload.regulatoryProfileRef);
      expect(active.aggregateVersions).toMatchObject({
        templateBaseline: '1',
        templateBaselineVersion: '1',
        regulatoryProfile: '1',
        regulatoryProfileVersion: '1',
      });

      const firstSelection = freezePayload.selections.at(0);
      if (firstSelection === undefined) {
        throw new Error('fixture must contain a TemplateBaseline selection');
      }
      const nextTemplateVersionId = newUuidV7();
      const nextTemplateHash = digestCanonicalPayload({
        title: 'WI-08 project template v2',
      }).hash;
      const nextTemplateRef = contentRef('TemplateDocument', newUuidV7(), nextTemplateHash);
      const unpublishedFreezePayload: EnterpriseProject.ProjectFreezeTemplateBaselinePayload = {
        ...freezePayload,
        templateBaselineVersionRef: versionedRef(
          'TemplateBaseline',
          baselineId,
          newUuidV7(),
          fixture.enterpriseId,
          fixture.projectId,
        ),
        selections: [
          {
            ...firstSelection,
            templateRef: {
              ...nextTemplateRef,
              objectType: 'TemplateVersion',
              objectId: templateId,
              immutableVersionId: nextTemplateVersionId,
            },
          },
        ],
      };
      await handlePlatformTemplateImportVersion(
        db,
        adminContext,
        commandEnvelope(
          adminContext,
          'enterprise_project.platform_template_import_version',
          `project-template-v2-import-${nextTemplateVersionId}`,
          templateImportPayload(templateId, nextTemplateVersionId, 'v2', nextTemplateRef),
          {
            platform: true,
            targetType: 'ReferenceTemplate',
            targetId: templateId,
            expectedAggregateVersion: '2',
          },
        ),
      );
      await expect(
        handleFreezeTemplateBaseline(
          db,
          humanContext,
          commandEnvelope(
            humanContext,
            'project.freeze_template_baseline',
            `reject-unpublished-${newUuidV7()}`,
            unpublishedFreezePayload,
            {
              projectId: fixture.projectId,
              targetType: 'TemplateBaseline',
              targetId: baselineId,
            },
          ),
        ),
      ).rejects.toMatchObject({ code: 'PROJECT_PLATFORM_REFERENCE_UNPUBLISHED' });
      await handlePlatformTemplatePublishVersion(
        db,
        publisherContext,
        commandEnvelope(
          publisherContext,
          'enterprise_project.platform_template_publish_version',
          `project-template-v2-publish-${nextTemplateVersionId}`,
          {
            referenceTemplateId: templateId,
            versionId: nextTemplateVersionId,
            releaseDecisionRef: { decision: 'APPROVE' },
            publishReason: { reasonCode: 'WI08_TEST_RELEASE_V2' },
          },
          {
            platform: true,
            targetType: 'ReferenceTemplate',
            targetId: templateId,
            expectedAggregateVersion: '3',
          },
        ),
      );
      const mismatchedTemplateRef = {
        ...firstSelection.templateRef,
        objectType: 'TemplateVersion',
        objectId: templateId,
        immutableVersionId: nextTemplateVersionId,
        contentHash: contentHash(Buffer.alloc(32, 0x70)),
      } as unknown as Common.ContentAddressedRef;
      await expect(
        handleFreezeTemplateBaseline(
          db,
          humanContext,
          commandEnvelope(
            humanContext,
            'project.freeze_template_baseline',
            `reject-hash-${newUuidV7()}`,
            {
              ...unpublishedFreezePayload,
              selections: [{ ...firstSelection, templateRef: mismatchedTemplateRef }],
            },
            {
              projectId: fixture.projectId,
              targetType: 'TemplateBaseline',
              targetId: baselineId,
            },
          ),
        ),
      ).rejects.toMatchObject({ code: 'PROJECT_PLATFORM_REFERENCE_HASH_MISMATCH' });

      const nextRegulatoryVersionId = newUuidV7();
      const nextRegulatoryHash = digestCanonicalPayload({
        citation: 'WI-08 fixture regulation v2',
      }).hash;
      const nextRegulatoryRef = contentRef('RegulatoryDocument', newUuidV7(), nextRegulatoryHash);
      await handlePlatformRegulatoryImportVersion(
        db,
        adminContext,
        commandEnvelope(
          adminContext,
          'enterprise_project.platform_regulatory_import_version',
          `project-regulatory-v2-import-${nextRegulatoryVersionId}`,
          regulatoryImportPayload(regulatoryId, nextRegulatoryVersionId, 'v2', nextRegulatoryRef),
          {
            platform: true,
            targetType: 'RegulatoryReference',
            targetId: regulatoryId,
            expectedAggregateVersion: '2',
          },
        ),
      );
      await handlePlatformRegulatoryPublishVersion(
        db,
        publisherContext,
        commandEnvelope(
          publisherContext,
          'enterprise_project.platform_regulatory_publish_version',
          `project-regulatory-v2-publish-${nextRegulatoryVersionId}`,
          {
            regulatoryReferenceId: regulatoryId,
            versionId: nextRegulatoryVersionId,
            releaseDecisionRef: { decision: 'APPROVE' },
            publishReason: { reasonCode: 'WI08_TEST_RELEASE_REG_V2' },
          },
          {
            platform: true,
            targetType: 'RegulatoryReference',
            targetId: regulatoryId,
            expectedAggregateVersion: '3',
          },
        ),
      );
      const activeAfterPlatformUpdate = await handleGetActiveBaselineRefs(db, humanContext, {
        projectRef: objectRef(
          'Project',
          fixture.projectId,
          fixture.enterpriseId,
          fixture.projectId,
        ),
      });
      expect(activeAfterPlatformUpdate.templateBaselineRef).toEqual(
        frozenPayload.templateBaselineRef,
      );
      expect(activeAfterPlatformUpdate.regulatoryProfileRef).toEqual(
        activatedPayload.regulatoryProfileRef,
      );
      const selectionRows = await admin.query<{
        template_version_id: string;
        template_hash: string;
      }>(
        `SELECT template_version_id,
                template_ref->'contentHash'->>'digest' AS template_hash
           FROM enterprise_project.template_selection
          WHERE version_id = $1`,
        [baselineVersionId],
      );
      expect(selectionRows.rows).toEqual([
        { template_version_id: templateVersionId, template_hash: templateHash.toString('hex') },
      ]);
      const profileItemRows = await admin.query<{
        regulatory_reference_version_id: string;
        content_hash: Buffer;
      }>(
        `SELECT regulatory_reference_version_id, content_hash
           FROM enterprise_project.regulatory_profile_item
          WHERE version_id = $1`,
        [regulatoryProfileVersionId],
      );
      expect(profileItemRows.rows).toHaveLength(1);
      expect(profileItemRows.rows[0]?.regulatory_reference_version_id).toBe(regulatoryVersionId);
      expect(profileItemRows.rows[0]?.content_hash.equals(regulatoryHash)).toBe(true);
      const templateContentEdges = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM enterprise_project.reference_edge
          WHERE owner_object_type = 'ReferenceTemplate'
            AND owner_object_id = $1
            AND reference_purpose = 'PLATFORM_TEMPLATE_CONTENT'`,
        [templateId],
      );
      expect(templateContentEdges.rows[0]?.count).toBe('2');
      const regulatoryContentEdges = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM enterprise_project.reference_edge
          WHERE owner_object_type = 'RegulatoryReference'
            AND owner_object_id = $1
            AND reference_purpose = 'PLATFORM_REGULATORY_CONTENT'`,
        [regulatoryId],
      );
      expect(regulatoryContentEdges.rows[0]?.count).toBe('2');
      const latestTemplateRef = {
        ...firstSelection.templateRef,
        immutableVersionId: 'latest',
      } as unknown as Common.ContentAddressedRef;
      await expect(
        handleFreezeTemplateBaseline(
          db,
          humanContext,
          commandEnvelope(
            humanContext,
            'project.freeze_template_baseline',
            `reject-latest-${newUuidV7()}`,
            {
              ...freezePayload,
              selections: [{ ...firstSelection, templateRef: latestTemplateRef }],
            },
            { projectId: fixture.projectId, targetType: 'TemplateBaseline', targetId: baselineId },
          ),
        ),
      ).rejects.toMatchObject({ code: PROJECT_TEMPLATE_LATEST_FORBIDDEN });

      const invalidRegulatoryProfileId = regulatoryProfileId;
      const invalidEvidencePayload = {
        regulatoryProfileVersionRef: versionedRef(
          'RegulatoryProfile',
          invalidRegulatoryProfileId,
          newUuidV7(),
          fixture.enterpriseId,
          fixture.projectId,
        ),
        jurisdiction: 'CN',
        productScopeSnapshotRef,
        applicabilityItems: [
          {
            regulatoryReferenceRef: {
              ...regulatoryVersionRef,
              objectType: 'RegulatoryReferenceVersion',
              objectId: regulatoryId,
              immutableVersionId: regulatoryVersionId,
            },
            applicability: 'APPLICABLE',
            rationale: justification('WI08_REGULATORY_APPLICABLE'),
            evidenceRefs: [
              {
                ...evidenceRef(fixture.enterpriseId, fixture.projectId),
                evidence: {
                  ...evidenceRef(fixture.enterpriseId, fixture.projectId).evidence,
                  objectType: 'TemplateVersion',
                },
              },
            ],
            riskLevel: 'MEDIUM',
          },
        ],
        reviewSnapshotRef: projectSnapshotRef(
          'RegulatoryReview',
          fixture.enterpriseId,
          fixture.projectId,
        ),
      } as EnterpriseProject.ProjectActivateRegulatoryProfilePayload;
      await expect(
        handleActivateRegulatoryProfile(
          db,
          humanContext,
          commandEnvelope(
            humanContext,
            'project.activate_regulatory_profile',
            `reject-evidence-${newUuidV7()}`,
            invalidEvidencePayload,
            {
              projectId: fixture.projectId,
              targetType: 'RegulatoryProfile',
              targetId: invalidRegulatoryProfileId,
            },
          ),
        ),
      ).rejects.toMatchObject({ code: PROJECT_REGULATORY_EVIDENCE_REQUIRED });
    });

    it('EP-WI08-P-004/P-005/C-001: project root CAS is atomic and frozen history is immutable', async () => {
      const fixture = await seedFixture(admin);
      const adminContext = platformContext('PLATFORM_REFERENCE_ADMIN');
      const publisherContext = platformContext('PLATFORM_REFERENCE_PUBLISHER');
      const templateId = newUuidV7();
      const version1 = newUuidV7();
      const templateHash = digestCanonicalPayload({ title: 'WI-08 CAS template' }).hash;
      const ref = contentRef('TemplateDocument', newUuidV7(), templateHash);
      await handlePlatformTemplateImportVersion(
        db,
        adminContext,
        commandEnvelope(
          adminContext,
          'enterprise_project.platform_template_import_version',
          `cas-template-import-${version1}`,
          templateImportPayload(templateId, version1, 'v1', ref),
          { platform: true, targetType: 'ReferenceTemplate', targetId: templateId },
        ),
      );
      await handlePlatformTemplatePublishVersion(
        db,
        publisherContext,
        commandEnvelope(
          publisherContext,
          'enterprise_project.platform_template_publish_version',
          `cas-template-publish-${version1}`,
          {
            referenceTemplateId: templateId,
            versionId: version1,
            releaseDecisionRef: { decision: 'APPROVE' },
            publishReason: { reasonCode: 'WI08_CAS' },
          },
          {
            platform: true,
            targetType: 'ReferenceTemplate',
            targetId: templateId,
            expectedAggregateVersion: '1',
          },
        ),
      );
      const humanContext = projectContext(fixture);
      const baselineId = newUuidV7();
      const firstVersionId = newUuidV7();
      const makeFreeze = (versionId: string, key: string, expectedAggregateVersion?: string) =>
        commandEnvelope(
          humanContext,
          'project.freeze_template_baseline',
          key,
          {
            templateBaselineVersionRef: versionedRef(
              'TemplateBaseline',
              baselineId,
              versionId,
              fixture.enterpriseId,
              fixture.projectId,
            ),
            selections: [
              {
                deliveryCategory: 'CAS_CONTROL',
                templateRef: {
                  ...ref,
                  objectType: 'TemplateVersion',
                  objectId: templateId,
                  immutableVersionId: version1,
                },
                applicabilityScope: { jurisdiction: 'CN' },
                selectionReason: justification('WI08_CAS_SELECTION'),
              },
            ],
            reviewSnapshotRef: projectSnapshotRef(
              'TemplateReview',
              fixture.enterpriseId,
              fixture.projectId,
            ),
            selectionRationale: justification('WI08_CAS_FREEZE'),
          },
          {
            projectId: fixture.projectId,
            targetType: 'TemplateBaseline',
            targetId: baselineId,
            ...(expectedAggregateVersion === undefined ? {} : { expectedAggregateVersion }),
          },
        );
      const firstEnvelope = makeFreeze(firstVersionId, `cas-first-${firstVersionId}`);
      const first = await handleFreezeTemplateBaseline(db, humanContext, firstEnvelope);
      expect(first.status).toBe('COMMITTED');
      const replay = await handleFreezeTemplateBaseline(db, humanContext, firstEnvelope);
      expect(replay.status).toBe('DUPLICATE');

      const secondVersionId = newUuidV7();
      const second = await handleFreezeTemplateBaseline(
        db,
        humanContext,
        makeFreeze(secondVersionId, `cas-second-${secondVersionId}`, '1'),
      );
      expect(committedPayload(second)).toMatchObject({ versionNo: 2, aggregateVersion: '2' });

      const racingVersionId = newUuidV7();
      const [raceA, raceB] = await Promise.allSettled([
        handleFreezeTemplateBaseline(
          db,
          humanContext,
          makeFreeze(racingVersionId, `cas-race-a-${racingVersionId}`, '2'),
        ),
        handleFreezeTemplateBaseline(
          db,
          humanContext,
          makeFreeze(racingVersionId, `cas-race-b-${racingVersionId}`, '2'),
        ),
      ]);
      const fulfilled = [raceA, raceB].filter(
        (result): result is PromiseFulfilledResult<CommandResult> => result.status === 'fulfilled',
      );
      const rejected = [raceA, raceB].filter(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      const winner = fulfilled.at(0);
      if (winner === undefined) {
        throw new Error('parallel freeze must have one committed winner');
      }
      expect(committedPayload(winner.value)).toMatchObject({
        versionNo: 3,
        aggregateVersion: '3',
      });
      expect(rejected).toHaveLength(1);
      const loser = rejected.at(0);
      if (loser === undefined) {
        throw new Error('parallel freeze must have one rejected loser');
      }
      expect(loser.reason).toMatchObject({ code: CONCURRENCY_CONFLICT });

      await expect(
        withEnterpriseProjectTransaction(db, humanContext, async (trx) => {
          await sql`
          UPDATE enterprise_project.template_baseline_version
             SET selection_rationale = '{}'::jsonb
           WHERE version_id = ${firstVersionId}::uuid
        `.execute(trx);
        }),
      ).rejects.toMatchObject({ code: '42501' });

      const rows = await admin.query<{ version_no: number; version_status: string }>(
        `SELECT version_no, version_status
         FROM enterprise_project.template_baseline_version
        WHERE template_baseline_id = $1
        ORDER BY version_no`,
        [baselineId],
      );
      expect(rows.rows.map((row) => [row.version_no, row.version_status])).toEqual([
        [1, 'FROZEN'],
        [2, 'FROZEN'],
        [3, 'FROZEN'],
      ]);
      const events = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM enterprise_project.outbox_event
        WHERE event_type = 'Project.TemplateBaselineFrozen'
          AND aggregate_id = $1`,
        [baselineId],
      );
      expect(events.rows[0]?.count).toBe('3');
    });

    it.each([false, true])(
      'EP-WI08-P-004: first Project root creation race is conflict-safe (different identities: %s)',
      async (differentIdentities) => {
        const fixture = await seedFixture(admin);
        const adminContext = platformContext('PLATFORM_REFERENCE_ADMIN');
        const publisherContext = platformContext('PLATFORM_REFERENCE_PUBLISHER');
        const templateId = newUuidV7();
        const templateVersionId = newUuidV7();
        const templateHash = digestCanonicalPayload({ title: 'WI-08 root race template' }).hash;
        const templateVersionRef = contentRef('TemplateDocument', newUuidV7(), templateHash);
        await handlePlatformTemplateImportVersion(
          db,
          adminContext,
          commandEnvelope(
            adminContext,
            'enterprise_project.platform_template_import_version',
            `root-race-template-import-${templateVersionId}`,
            templateImportPayload(templateId, templateVersionId, 'v1', templateVersionRef),
            { platform: true, targetType: 'ReferenceTemplate', targetId: templateId },
          ),
        );
        await handlePlatformTemplatePublishVersion(
          db,
          publisherContext,
          commandEnvelope(
            publisherContext,
            'enterprise_project.platform_template_publish_version',
            `root-race-template-publish-${templateVersionId}`,
            {
              referenceTemplateId: templateId,
              versionId: templateVersionId,
              releaseDecisionRef: { decision: 'APPROVE' },
              publishReason: { reasonCode: 'WI08_ROOT_RACE' },
            },
            {
              platform: true,
              targetType: 'ReferenceTemplate',
              targetId: templateId,
              expectedAggregateVersion: '1',
            },
          ),
        );

        const humanContext = projectContext(fixture);
        const baselineId = newUuidV7();
        const otherBaselineId = differentIdentities ? newUuidV7() : baselineId;
        const makeFreeze = (baselineId: string, versionId: string, idempotencyKey: string) =>
          commandEnvelope(
            humanContext,
            'project.freeze_template_baseline',
            idempotencyKey,
            {
              templateBaselineVersionRef: versionedRef(
                'TemplateBaseline',
                baselineId,
                versionId,
                fixture.enterpriseId,
                fixture.projectId,
              ),
              selections: [
                {
                  deliveryCategory: 'ROOT_RACE_CONTROL',
                  templateRef: {
                    ...templateVersionRef,
                    objectType: 'TemplateVersion',
                    objectId: templateId,
                    immutableVersionId: templateVersionId,
                  },
                  applicabilityScope: { jurisdiction: 'CN' },
                  selectionReason: justification('WI08_ROOT_RACE_SELECTION'),
                },
              ],
              reviewSnapshotRef: projectSnapshotRef(
                'TemplateReview',
                fixture.enterpriseId,
                fixture.projectId,
              ),
              selectionRationale: justification('WI08_ROOT_RACE_FREEZE'),
            },
            {
              projectId: fixture.projectId,
              targetType: 'TemplateBaseline',
              targetId: baselineId,
            },
          );
        const envelopes = [
          makeFreeze(baselineId, newUuidV7(), `root-race-a-${baselineId}`),
          makeFreeze(otherBaselineId, newUuidV7(), `root-race-b-${baselineId}`),
        ];
        const blocker = new pg.Client({ connectionString: databaseUrl });
        await blocker.connect();
        let pending: Promise<PromiseSettledResult<CommandResult>[]> | undefined;
        try {
          await blocker.query('BEGIN');
          const backend = await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
          const pid = backend.rows[0]?.pid;
          if (pid === undefined) throw new Error('blocker backend PID missing');
          // Uncommitted roots in OTHER Projects leave the target Project arbiter
          // empty, but hold the primary keys. Both real INSERTs must pass their
          // arbiter precheck and wait in unique-index insertion before release.
          for (const candidateId of new Set([baselineId, otherBaselineId])) {
            const blockerFixture = await seedFixture(admin);
            await blocker.query(
              `INSERT INTO enterprise_project.template_baseline
               (template_baseline_id, enterprise_id, project_id, current_version_id,
                active_version_id, created_by_principal_id, created_by_actor_snapshot_id)
             VALUES ($1, $2, $3, $4, $4, $5, $6)`,
              [
                candidateId,
                blockerFixture.enterpriseId,
                blockerFixture.projectId,
                newUuidV7(),
                HUMAN_PRINCIPAL,
                HUMAN_ACTOR,
              ],
            );
          }
          pending = Promise.allSettled(
            envelopes.map((envelope) => handleFreezeTemplateBaseline(db, humanContext, envelope)),
          );
          const deadline = Date.now() + 5_000;
          let blockedCount = 0;
          while (Date.now() < deadline) {
            const blocked = await admin.query<{ count: number }>(
              `SELECT count(*)::int AS count FROM pg_stat_activity
              WHERE usename = 'im03_wi08_probe' AND wait_event = 'transactionid'
                AND $1 = ANY(pg_blocking_pids(pid))
                AND query LIKE 'insert into "enterprise_project"."template_baseline" %'`,
              [pid],
            );
            blockedCount = blocked.rows[0]?.count ?? 0;
            if (blockedCount === 2) break;
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
          expect(
            blockedCount,
            'both INSERTs reached primary-key checks after the Project precheck',
          ).toBe(2);
        } finally {
          await blocker.query('ROLLBACK');
          await blocker.end();
          // Drain both transactions even if the barrier assertion fails.
          await pending;
        }
        const settled = await pending;
        const results = settled.map((result) => {
          if (result.status === 'rejected') throw result.reason;
          return result.value;
        });
        expect(results.filter((result) => result.status === 'COMMITTED')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'REJECTED')).toHaveLength(1);
        expect(results.find((result) => result.status === 'REJECTED')).toMatchObject({
          errorCode: CONCURRENCY_CONFLICT,
        });

        const winner = envelopes[results.findIndex((result) => result.status === 'COMMITTED')];
        const loser = envelopes[results.findIndex((result) => result.status === 'REJECTED')];
        if (!winner || !loser) throw new Error('expected winner and loser envelopes');
        const winnerVersion = winner.payload.templateBaselineVersionRef.versionId;
        const roots = await admin.query(
          `SELECT template_baseline_id, current_version_id, active_version_id, aggregate_version::text
           FROM enterprise_project.template_baseline WHERE project_id = $1`,
          [fixture.projectId],
        );
        expect(roots.rows).toEqual([
          {
            template_baseline_id: winner.targetId,
            current_version_id: winnerVersion,
            active_version_id: winnerVersion,
            aggregate_version: '1',
          },
        ]);
        for (const table of ['template_baseline_version', 'template_selection']) {
          const rows = await admin.query(
            `SELECT version_id, source_command_id FROM enterprise_project.${table} WHERE project_id = $1`,
            [fixture.projectId],
          );
          expect(rows.rows).toEqual([
            { version_id: winnerVersion, source_command_id: winner.commandId },
          ]);
        }
        const versions = await admin.query(
          `SELECT version_status FROM enterprise_project.template_baseline_version WHERE project_id = $1`,
          [fixture.projectId],
        );
        expect(versions.rows).toEqual([{ version_status: 'FROZEN' }]);
        const edges = await admin.query(
          `SELECT reference_path, source_command_id, owner_version_id
           FROM enterprise_project.reference_edge WHERE project_id = $1 ORDER BY reference_path`,
          [fixture.projectId],
        );
        expect(edges.rows).toEqual(
          ['/projectRef', '/reviewSnapshotRef', '/selections/0/templateRef'].map((path) => ({
            reference_path: path,
            source_command_id: winner.commandId,
            owner_version_id: winnerVersion,
          })),
        );
        const events = await admin.query(
          `SELECT event_type, source_command_id FROM enterprise_project.outbox_event WHERE project_id = $1`,
          [fixture.projectId],
        );
        expect(events.rows).toEqual([
          { event_type: 'Project.TemplateBaselineFrozen', source_command_id: winner.commandId },
        ]);
        for (const table of ['command_receipt', 'audit_record']) {
          const rows = await admin.query(
            `SELECT command_id, outcome FROM enterprise_project.${table} WHERE project_id = $1 ORDER BY outcome`,
            [fixture.projectId],
          );
          expect(rows.rows).toEqual([
            { command_id: winner.commandId, outcome: 'COMMITTED' },
            { command_id: loser.commandId, outcome: 'REJECTED' },
          ]);
        }
        expect(await handleFreezeTemplateBaseline(db, humanContext, winner)).toMatchObject({
          status: 'DUPLICATE',
          originalOutcome: 'COMMITTED',
        });
        expect(await handleFreezeTemplateBaseline(db, humanContext, loser)).toMatchObject({
          status: 'DUPLICATE',
          originalOutcome: 'REJECTED',
          errorCode: CONCURRENCY_CONFLICT,
        });
        const rejection = await admin.query(
          `SELECT r.result_payload->>'errorCode' AS receipt_error, a.error_code AS audit_error
             FROM enterprise_project.command_receipt r
             JOIN enterprise_project.audit_record a USING (command_id)
            WHERE r.command_id = $1`,
          [loser.commandId],
        );
        expect(rejection.rows).toEqual([
          { receipt_error: CONCURRENCY_CONFLICT, audit_error: CONCURRENCY_CONFLICT },
        ]);

        // An unrelated immutable Version CHECK failure must still abort
        // the entire transaction, including the preceding successful Root CAS.
        const reusedVersion = {
          ...makeFreeze(winner.targetId, winnerVersion, `duplicate-version-${baselineId}`),
          expectedAggregateVersion: '1',
        };
        await expect(
          handleFreezeTemplateBaseline(db, humanContext, reusedVersion),
        ).rejects.toMatchObject({
          code: '23514',
          constraint: 'template_baseline_version_previous_not_self',
        });
        const rootAfterFailure = await admin.query(
          `SELECT template_baseline_id, current_version_id, active_version_id, aggregate_version::text
             FROM enterprise_project.template_baseline WHERE project_id = $1`,
          [fixture.projectId],
        );
        expect(rootAfterFailure.rows).toEqual(roots.rows);

        // Reusing another scope's Root ID is not this Project's creation race.
        // The exact same pkey error must propagate when no scoped winner exists.
        const otherFixture = await seedFixture(admin);
        const otherContext = projectContext(otherFixture);
        const scopeCollision = commandEnvelope(
          otherContext,
          'project.freeze_template_baseline',
          `scope-collision-${baselineId}`,
          {
            ...winner.payload,
            templateBaselineVersionRef: versionedRef(
              'TemplateBaseline',
              winner.targetId,
              newUuidV7(),
              otherFixture.enterpriseId,
              otherFixture.projectId,
            ),
            reviewSnapshotRef: projectSnapshotRef(
              'TemplateReview',
              otherFixture.enterpriseId,
              otherFixture.projectId,
            ),
          },
          {
            projectId: otherFixture.projectId,
            targetType: 'TemplateBaseline',
            targetId: winner.targetId,
          },
        );
        await expect(
          handleFreezeTemplateBaseline(db, otherContext, scopeCollision),
        ).rejects.toMatchObject({
          code: '23505',
          constraint: 'template_baseline_pkey',
        });
        for (const table of ['command_receipt', 'audit_record', 'outbox_event']) {
          const facts = await admin.query(
            `SELECT count(*)::int AS count FROM enterprise_project.${table}
              WHERE ${table === 'outbox_event' ? 'source_command_id' : 'command_id'} = ANY($1::uuid[])`,
            [[reusedVersion.commandId, scopeCollision.commandId]],
          );
          expect(facts.rows).toEqual([{ count: 0 }]);
        }
        const replayEvents = await admin.query(
          `SELECT count(*)::int AS count FROM enterprise_project.outbox_event WHERE project_id = $1`,
          [fixture.projectId],
        );
        expect(replayEvents.rows).toEqual([{ count: 1 }]);
      },
    );
  },
);
