// IM-06 (#191): real PostgreSQL acceptance for the canonical resolution
// receipt material and the narrow `project.get_resolution_receipt@1.0` Query.
//
// Positive facts are established through the real owning EnterpriseProject
// path (enterprise/project start snapshot, SourceMaterial custody, accept
// validation, CustomerMaterial proposal and Human confirmation); the receipt
// content address is the canonical hash of the material that confirmation
// committed, never the request payload hash. Reads enter through the
// composition entry in `@zhiju/api/composition` — the same boundary a
// transport uses — with a real IdentityPolicy Decision minted for
// `project.resolution_receipt.read` and the current covering capability grant.
// No authorization, existence or attestation path under test is stubbed.

import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Kysely } from 'kysely';
import {
  createResolutionReceiptEntry,
  type ResolutionReceiptEntry,
  type ResolutionReceiptSession,
} from '@zhiju/api/composition';
import {
  AUTHORIZATION_DECISION_INVALID,
  COMMAND_RECEIPT_OBJECT_TYPE,
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
  PROJECT_HUMAN_ONLY_DENIED,
  PROJECT_QUERY_NOT_FOUND,
  PROJECT_QUERY_REF_INVALID,
  ResolutionReceiptRepository,
  withEnterpriseProjectTransaction,
  type CommandEnvelope,
  type CommandResult,
  type EnterprisePrincipalKind,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import {
  API_VALUE_INVALID,
  AUTHORIZATION_REVOKED,
  authorizeCommand,
  createActorSnapshot,
  createIdentityPolicyDatabase,
  digestCanonicalPayload as digestIdentityPayload,
  grantCapability,
  IdentityPolicyRepository,
  recordPolicySnapshot,
  revokeCapability,
  SCOPE_MISMATCH,
  withIdentityTransaction,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import { ContractRegistry, type Common, type EnterpriseProject } from '@zhiju/contracts';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const PROBE_ROLE = 'im06_wi191_probe';
const PROBE_PASSWORD = 'im06-wi191-probe';

const RESOLVER_PRINCIPAL = 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f101';
const RESOLVER_ACTOR = 'f2f2f2f2-f2f2-72f2-82f2-f2f2f2f2f201';
const RESOLVER_ACTOR_OTHER = 'f2f2f2f2-f2f2-72f2-82f2-f2f2f2f2f202';
const HUMAN_PRINCIPAL = 'f3f3f3f3-f3f3-73f3-83f3-f3f3f3f3f301';
const HUMAN_ACTOR = 'f4f4f4f4-f4f4-74f4-84f4-f4f4f4f4f401';
const AGENT_PRINCIPAL = 'f5f5f5f5-f5f5-75f5-85f5-f5f5f5f5f501';
const AGENT_ACTOR = 'f6f6f6f6-f6f6-76f6-86f6-f6f6f6f6f601';
const CONFIRMATION_DECISION = 'f7f7f7f7-f7f7-77f7-87f7-f7f7f7f7f701';
const SEED_DECISION = 'f8f8f8f8-f8f8-78f8-88f8-f8f8f8f8f801';
const POLICY_SNAPSHOT_ID = 'f9f9f9f9-f9f9-79f9-89f9-f9f9f9f9f901';
const POLICY_SNAPSHOT_SET_VERSION = 'wi191-grant-policy-set';
const GRANT_READ_PROJECT = 'fafafafa-fafa-7afa-8afa-fafafafafa01';
const GRANT_CAPTURE_PROJECT = 'fafafafa-fafa-7afa-8afa-fafafafafa02';
const GRANT_REVOCABLE_READ = 'fafafafa-fafa-7afa-8afa-fafafafafa03';
const AUTH_CONTEXT_ID = 'fbfbfbfb-fbfb-7bfb-8bfb-fbfbfbfbfb01';
const DECISION_HASH = Buffer.alloc(32, 0x71);
const AUTH_HASH = Buffer.alloc(32, 0x72);
const OTHER_SESSION_HASH = Buffer.alloc(32, 0x73);
const CORRELATION = 'fcfcfcfc-fcfc-7cfc-8cfc-fcfcfcfcfc01';
const PAST = new Date('2026-01-01T00:00:00.000Z');

const READ_CAPABILITY = 'project.resolution_receipt.read';
const CAPTURE_CAPABILITY = 'project.context_source.capture';
const REVOCABLE_READ_CAPABILITY = 'wi191.revocable.read';

interface ReceiptFixture {
  readonly enterpriseId: string;
  readonly projectId: string;
}

/** One real Human confirmation and the facts its receipt must attest. */
interface Confirmation {
  readonly envelope: CommandEnvelope & {
    readonly payload: EnterpriseProject.ProjectConfirmCustomerMaterialPayload;
  };
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly customerMaterialId: string;
  readonly candidateVersionId: string;
  readonly confirmedVersionId: string;
  readonly sourceMaterialId: string;
  readonly sourceDigest: string;
  readonly decisionId: string;
  readonly receiptPayload: CanonicalJsonObject;
  readonly receiptHash: string;
}

function objectRef<TObjectType extends string>(
  objectType: TObjectType,
  objectId: string,
  enterpriseId: string,
  projectId?: string,
) {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: projectId === undefined ? { enterpriseId } : { enterpriseId, projectId },
  } as Common.ObjectRef & { objectType: TObjectType };
}

function versionedRef<TObjectType extends string>(
  objectType: TObjectType,
  objectId: string,
  versionId: string,
  enterpriseId: string,
  projectId?: string,
) {
  return {
    kind: 'VERSIONED',
    objectType,
    objectId,
    versionId,
    scope: projectId === undefined ? { enterpriseId } : { enterpriseId, projectId },
  } as Common.VersionedRef & { objectType: TObjectType };
}

function snapshotRef<TObjectType extends string>(
  objectType: TObjectType,
  snapshotId: string,
  digest: string,
  enterpriseId: string,
) {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: snapshotId,
    snapshotId,
    scope: { enterpriseId },
    contentHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
  } as Common.SnapshotRef & { objectType: TObjectType };
}

function contentRef<TObjectType extends string>(
  objectType: TObjectType,
  objectId: string,
  enterpriseId: string,
  projectId: string,
  digest: string,
) {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    scope: { enterpriseId, projectId },
    contentHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
  } as Common.ContentAddressedRef & { objectType: TObjectType };
}

function contentHashValue(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' };
}

function testCrypto(): IdentityCryptoPorts {
  return {
    lookupHash: {
      computeKeyedLookupHash(input: string) {
        return {
          hash: createHmac('sha256', Buffer.alloc(32, 0x6c)).update(input, 'utf8').digest(),
          algorithm: 'HMAC-SHA-256' as const,
          keyVersion: 1,
        };
      },
    },
    fieldEncryption: {
      encryptField() {
        throw new Error('not needed');
      },
      decryptField() {
        throw new Error('not needed');
      },
    },
  };
}

describe.skipIf(!gateEnabled)(
  'Resolution receipt material and attestation Query (real PostgreSQL, IM-06 #191)',
  { concurrent: false },
  () => {
    const crypto = testCrypto();
    const registry = new ContractRegistry();
    let admin: pg.Client;
    let epPool: pg.Pool;
    let ipPool: pg.Pool;
    let db: Kysely<EnterpriseProjectDb>;
    let identityDb: Kysely<IdentityPolicyDb>;
    let identityRepo: IdentityPolicyRepository;
    let fixture: ReceiptFixture;
    let grantPolicyHash: Buffer;
    let projectActorRef: Common.SnapshotRef;
    let entry: ResolutionReceiptEntry;
    let revocableEntry: ResolutionReceiptEntry;
    let session: ResolutionReceiptSession;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(
        `DO $do$
         BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
             CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${PROBE_PASSWORD}'
               NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
           END IF;
         END $do$`,
      );
      await admin.query(
        `GRANT platform_context_establisher, enterprise_project_app, identity_policy_app TO ${PROBE_ROLE}`,
      );
      const url = new URL(databaseUrl ?? '');
      url.username = PROBE_ROLE;
      url.password = PROBE_PASSWORD;
      const probeUrl = url.toString();
      epPool = new pg.Pool({ connectionString: probeUrl, max: 6 });
      ipPool = new pg.Pool({ connectionString: probeUrl, max: 6 });
      db = createEnterpriseProjectDatabase(epPool);
      identityDb = createIdentityPolicyDatabase(ipPool);
      identityRepo = new IdentityPolicyRepository(crypto);
      fixture = await seedEnterpriseProject();
      await registerIdentityFacts();
      entry = createResolutionReceiptEntry({
        enterpriseProjectDb: db,
        identity: { db: identityDb, repo: identityRepo, crypto },
        capabilities: { read: READ_CAPABILITY },
      });
      revocableEntry = createResolutionReceiptEntry({
        enterpriseProjectDb: db,
        identity: { db: identityDb, repo: identityRepo, crypto },
        capabilities: { read: REVOCABLE_READ_CAPABILITY },
      });
      session = { authenticationContextHash: AUTH_HASH };
    });

    afterAll(async () => {
      await epPool.end();
      await ipPool.end();
      await admin.end();
    });

    // ---------------------------------------------------------------------
    // Trusted contexts and owning fixtures
    // ---------------------------------------------------------------------

    function seedContext(
      principalKind: EnterprisePrincipalKind = 'HUMAN',
      allowedProjectIds: readonly string[] = [],
    ): EnterpriseProjectTransactionContext {
      return {
        kind: 'REQUEST',
        principalId: principalKind === 'HUMAN' ? HUMAN_PRINCIPAL : AGENT_PRINCIPAL,
        principalKind,
        actorSnapshotId: principalKind === 'HUMAN' ? HUMAN_ACTOR : AGENT_ACTOR,
        authorizationDecisionId: CONFIRMATION_DECISION,
        authorizationDecisionHash: DECISION_HASH,
        authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        policySnapshotId: POLICY_SNAPSHOT_ID,
        enterpriseId: fixture.enterpriseId,
        allowedProjectIds,
        correlationId: CORRELATION,
      };
    }

    function seedEnvelope<TPayload>(
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
        idempotencyScope: 'im06.wi191',
        idempotencyKey,
        requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
        enterpriseId: context.enterpriseId,
        targetType: 'Unknown',
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

    async function seedEnterpriseProject(): Promise<ReceiptFixture> {
      const enterpriseId = newUuidV7();
      const context: EnterpriseProjectTransactionContext = {
        kind: 'REQUEST',
        principalId: HUMAN_PRINCIPAL,
        principalKind: 'HUMAN',
        actorSnapshotId: HUMAN_ACTOR,
        authorizationDecisionId: CONFIRMATION_DECISION,
        authorizationDecisionHash: DECISION_HASH,
        authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        policySnapshotId: POLICY_SNAPSHOT_ID,
        enterpriseId,
        allowedProjectIds: [],
        correlationId: CORRELATION,
      };
      const enterprise = await handleCreateEnterprise(db, context, {
        ...seedEnvelope(context, 'project.create_enterprise', 'wi191-enterprise', {
          displayCode: 'WI191',
          displayName: 'WI-191 receipt fixture',
          initialStatus: 'ACTIVE' as const,
        }),
        enterpriseId,
        targetType: 'Enterprise',
        targetId: enterpriseId,
      });
      expect(enterprise.status).toBe('COMMITTED');

      const product = committedPayload(
        await handleEnterpriseProductCreate(
          db,
          context,
          seedEnvelope(context, 'enterprise_product.create', 'wi191-product', {
            enterpriseRef: objectRef('Enterprise', enterpriseId, enterpriseId),
            displayCode: 'WI191-PRODUCT',
            initialVersion: {
              productType: 'manufactured.widget',
              displayName: 'WI191 Widget',
              intendedUse: 'Resolution receipt fixture',
              productScope: { family: 'widget', markets: ['CN'] },
              sourceRefs: [objectRef('SourceMaterial', newUuidV7(), enterpriseId)],
            },
          }),
        ),
      ) as { productRef: { objectId: string }; productVersionRef: { versionId: string } };
      const productScope = committedPayload(
        await handleEnterpriseProductCreateScopeSnapshot(
          db,
          context,
          seedEnvelope(context, 'enterprise_product.create_scope_snapshot', 'wi191-scope', {
            productRef: { objectType: 'Product' as const, objectId: product.productRef.objectId },
            productVersionRefs: [
              {
                objectType: 'ProductVersion',
                objectId: product.productRef.objectId,
                versionId: product.productVersionRef.versionId,
              },
            ],
            purpose: 'WI191 product scope fixture',
          }),
        ),
      ) as { productScopeSnapshotRef: { objectId: string }; payloadHash: string };

      const qms = committedPayload(
        await handleEnterpriseQmsCreateRevision(
          db,
          context,
          seedEnvelope(context, 'enterprise_qms.create_revision', 'wi191-qms', {
            qmsConfigurationRef: objectRef('QMSConfiguration', newUuidV7(), enterpriseId),
            applicabilityDecisions: [{ requirementRef: 'req-1', outcome: 'APPLICABLE' }],
            managementChoices: [{ choiceKey: 'review-cycle', selectedOption: 'quarterly' }],
            professionalDecisions: [{ decisionType: 'risk-method', outcome: 'apply' }],
            sourceRefs: [objectRef('SourceMaterial', newUuidV7(), enterpriseId)],
          }),
        ),
      ) as { qmsConfigurationRevisionRef: { objectId: string; versionId: string } };
      await handleEnterpriseQmsActivateRevision(
        db,
        context,
        seedEnvelope(
          context,
          'enterprise_qms.activate_revision',
          'wi191-qms-activate',
          {
            qmsConfigurationRef: objectRef(
              'QMSConfiguration',
              qms.qmsConfigurationRevisionRef.objectId,
              enterpriseId,
            ),
            qmsConfigurationRevisionRef: versionedRef(
              'QMSConfigurationRevision',
              qms.qmsConfigurationRevisionRef.objectId,
              qms.qmsConfigurationRevisionRef.versionId,
              enterpriseId,
            ),
            activationMode: 'ACTIVATE' as const,
            expectedAggregateVersion: '1',
            humanDecisionRef: objectRef('BusinessDecision', newUuidV7(), enterpriseId),
          },
          { expectedAggregateVersion: '1' },
        ),
      );

      const profile = committedPayload(
        await handleEnterpriseProfileCreateSnapshot(
          db,
          context,
          seedEnvelope(context, 'enterprise_profile.create_snapshot', 'wi191-profile', {
            enterpriseRef: objectRef('Enterprise', enterpriseId, enterpriseId),
            enterpriseFactVersionRefs: [],
            productVersionRefs: [
              {
                objectType: 'ProductVersion',
                objectId: product.productRef.objectId,
                versionId: product.productVersionRef.versionId,
              },
            ],
            qmsConfigurationRef: objectRef(
              'QMSConfiguration',
              qms.qmsConfigurationRevisionRef.objectId,
              enterpriseId,
            ),
            qmsConfigurationRevisionRef: versionedRef(
              'QMSConfigurationRevision',
              qms.qmsConfigurationRevisionRef.objectId,
              qms.qmsConfigurationRevisionRef.versionId,
              enterpriseId,
            ),
            purpose: 'WI191 profile fixture',
          }),
        ),
      ) as { enterpriseProfileSnapshotRef: { objectId: string }; payloadHash: string };

      const project = committedPayload(
        await handleCreateProject(
          db,
          context,
          seedEnvelope(context, 'project.create_project', 'wi191-project', {
            enterpriseRef: objectRef('Enterprise', enterpriseId, enterpriseId),
            displayCode: 'WI191-PROJECT',
            title: 'WI191 project',
            objective: 'Resolution receipt persistence acceptance fixture',
            startSnapshot: {
              enterpriseProfileSnapshotRef: snapshotRef(
                'EnterpriseProfileSnapshot',
                profile.enterpriseProfileSnapshotRef.objectId,
                profile.payloadHash,
                enterpriseId,
              ),
              qmsConfigurationRef: versionedRef(
                'QMSConfiguration',
                qms.qmsConfigurationRevisionRef.objectId,
                qms.qmsConfigurationRevisionRef.versionId,
                enterpriseId,
              ),
              productScopeSnapshotRef: snapshotRef(
                'ProductScopeSnapshot',
                productScope.productScopeSnapshotRef.objectId,
                productScope.payloadHash,
                enterpriseId,
              ),
            },
            memberPolicyRef: versionedRef('Policy', newUuidV7(), newUuidV7(), enterpriseId),
          }),
        ),
      ) as { projectRef: { objectId: string } };
      return { enterpriseId, projectId: project.projectRef.objectId };
    }

    async function registerAndAcceptSource(tag: string): Promise<{
      sourceMaterialId: string;
      sourceRef: Common.ContentAddressedRef;
      digest: string;
    }> {
      const digest = 'a'.repeat(64);
      const context = seedContext('HUMAN', [fixture.projectId]);
      const descriptor: EnterpriseProject.SourceMaterialDescriptor = {
        originRef: {
          system: 'feishu',
          resourceType: 'message_attachment',
          externalId: `wi191-${tag}-origin`,
          observedAt: '2026-09-01T00:00:00.000Z',
          tenantOrAccountRef: objectRef('FeishuTenant', newUuidV7(), fixture.enterpriseId),
        },
        submittedBy: objectRef('Principal', HUMAN_PRINCIPAL, fixture.enterpriseId),
        receivedAt: '2026-09-01T00:00:00.000Z',
        originalName: `${tag}.pdf`,
        mediaType: 'application/pdf',
        byteLength: 12,
        checksum: contentHashValue(digest),
        stagedObjectRef: `staging/wi191/${tag}`,
        retentionClass: 'CUSTOMER_RECORD',
      };
      const registered = committedPayload(
        await handleRegisterSourceMaterial(
          db,
          context,
          seedEnvelope(
            context,
            'project.register_source_material',
            `wi191-${tag}-register`,
            {
              projectRef: objectRef(
                'Project',
                fixture.projectId,
                fixture.enterpriseId,
                fixture.projectId,
              ),
              descriptor,
            },
            { projectId: fixture.projectId },
          ),
        ),
      ) as unknown as { sourceMaterialRef: Common.ContentAddressedRef };
      const sourceMaterialId = registered.sourceMaterialRef.objectId;
      const sourceRepo = new EnterpriseBusinessRepository();
      const validationRefs: Common.ContentAddressedRef[] = [];
      for (const validationKind of ['SECURITY', 'INTEGRITY'] as const) {
        const validationId = newUuidV7();
        const validationPayload = {
          enterpriseId: fixture.enterpriseId,
          projectId: fixture.projectId,
          sourceMaterialId,
          validationKind,
          outcome: 'PASSED',
          validatedObjectRef: `accepted/wi191/${tag}`,
          validatedContentHash: digest,
          validatedByteLength: descriptor.byteLength,
          validatorId: 'wi191-validator',
          validatorVersion: '1.0.0',
        } as CanonicalJsonObject;
        const validationDigest = digestCanonicalPayload(validationPayload);
        await withEnterpriseProjectTransaction(db, context, async (trx) => {
          await sourceRepo.insertSourceMaterialValidation(trx, {
            validationId,
            sourceMaterialId,
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
            validationKind,
            outcome: 'PASSED',
            validatedObjectRef: `accepted/wi191/${tag}`,
            validatedContentHash: Buffer.from(digest, 'hex'),
            validatedByteLength: descriptor.byteLength,
            validatorId: 'wi191-validator',
            validatorVersion: '1.0.0',
            payload: validationPayload,
            payloadHash: validationDigest.hash,
            recordedByPrincipalId: HUMAN_PRINCIPAL,
            recordedByActorSnapshotId: HUMAN_ACTOR,
            authorizationDecisionId: CONFIRMATION_DECISION,
            sourceCommandId: newUuidV7(),
          });
        });
        validationRefs.push(
          contentRef(
            'ValidationResult',
            validationId,
            fixture.enterpriseId,
            fixture.projectId,
            validationDigest.hash.toString('hex'),
          ),
        );
      }
      const securityValidationRef = validationRefs[0];
      const integrityValidationRef = validationRefs[1];
      if (securityValidationRef === undefined || integrityValidationRef === undefined) {
        throw new Error('SourceMaterial acceptance fixture requires two validation references');
      }
      const accepted = await handleAcceptSourceMaterial(
        db,
        context,
        seedEnvelope(
          context,
          'project.accept_source_material',
          `wi191-${tag}-accept`,
          {
            securityValidationRefs: [securityValidationRef],
            integrityValidationRef,
            acceptedObjectRef: `accepted/wi191/${tag}`,
            acceptedAt: '2026-09-01T01:00:00.000Z',
          },
          {
            projectId: fixture.projectId,
            targetType: 'SourceMaterial',
            targetId: sourceMaterialId,
            expectedAggregateVersion: '1',
          },
        ),
      );
      expect(accepted.status).toBe('COMMITTED');
      return { sourceMaterialId, sourceRef: registered.sourceMaterialRef, digest };
    }

    /**
     * One real Human confirmation through the owning proposal/confirm path.
     * The proposer and the confirming Human are the same trusted principal
     * fixture; the Agent kind is only used for the Human-only rejection case.
     */
    async function confirmCustomerMaterial(input: {
      tag: string;
      sourceRef: Common.ContentAddressedRef;
      sourceMaterialId: string;
      digest: string;
      proposerKind?: EnterprisePrincipalKind;
      sourceSelections?: readonly EnterpriseProject.MaterialSourceSelection[];
    }): Promise<Confirmation> {
      const proposeContext = seedContext(input.proposerKind ?? 'HUMAN', [fixture.projectId]);
      const evidence = { evidence: input.sourceRef, relation: 'SUPPORTS' as const };
      const proposed = committedPayload(
        await handleProposeCustomerMaterial(
          db,
          proposeContext,
          seedEnvelope(
            proposeContext,
            'project.propose_customer_material',
            `wi191-${input.tag}-propose`,
            {
              projectRef: objectRef(
                'Project',
                fixture.projectId,
                fixture.enterpriseId,
                fixture.projectId,
              ),
              proposal: {
                materialType: 'quality.procedure',
                title: `${input.tag} control procedure`,
                customerDocumentNumber: `QP-${input.tag}`,
                completeness: 'PARTIAL',
                sourceSelections: input.sourceSelections ?? [
                  { sourceMaterialRef: input.sourceRef, role: 'primary', locator: 'section.1' },
                ],
                language: 'zh-CN',
                classificationRationale: {
                  reasonCode: 'SOURCE_CLASSIFICATION',
                  summary: 'SourceMaterial identifies the proposed controlled procedure.',
                  evidenceRefs: [evidence],
                },
              },
            },
            { projectId: fixture.projectId },
          ),
        ),
      ) as unknown as { customerMaterialRef: Common.VersionedRef };
      const customerMaterialId = proposed.customerMaterialRef.objectId;
      const humanContext = seedContext('HUMAN', [fixture.projectId]);
      const commandId = newUuidV7();
      const idempotencyKey = `wi191-${input.tag}-confirm`;
      const envelope = {
        ...seedEnvelope(
          humanContext,
          'project.confirm_customer_material',
          idempotencyKey,
          {
            candidateVersionRef: proposed.customerMaterialRef,
            completeness: 'COMPLETE',
            declaredStatus: 'approved',
            evidenceRefs: [evidence],
            justification: {
              reasonCode: 'HUMAN_REVIEW',
              summary: 'Human reviewed the exact accepted SourceMaterial selection.',
              evidenceRefs: [evidence],
            },
          },
          { projectId: fixture.projectId },
        ),
        commandId,
      } as CommandEnvelope & {
        payload: EnterpriseProject.ProjectConfirmCustomerMaterialPayload;
      };
      const confirmed = await handleConfirmCustomerMaterial(db, humanContext, envelope);
      const resultPayload = committedPayload(confirmed) as unknown as {
        customerMaterialRef: Common.VersionedRef;
      };
      const material = await readMaterial(commandId);
      if (material === undefined) throw new Error('confirmation did not commit receipt material');
      const decision = await admin.query<{ decision_id: string }>(
        `SELECT decision_id::text
           FROM enterprise_project.customer_material_decision
          WHERE source_command_id = $1 AND decision_kind = 'CONFIRMED'`,
        [commandId],
      );
      const decisionId = decision.rows[0]?.decision_id;
      if (decisionId === undefined) throw new Error('confirmation did not record a decision');
      return {
        envelope,
        commandId,
        idempotencyKey,
        customerMaterialId,
        candidateVersionId: proposed.customerMaterialRef.versionId,
        confirmedVersionId: resultPayload.customerMaterialRef.versionId,
        sourceMaterialId: input.sourceMaterialId,
        sourceDigest: input.digest,
        decisionId,
        receiptPayload: material.payload,
        receiptHash: material.hash,
      };
    }

    async function readMaterial(
      commandId: string,
    ): Promise<{ payload: CanonicalJsonObject; hash: string } | undefined> {
      const rows = await admin.query<{ receipt_payload: CanonicalJsonObject; hash: string }>(
        `SELECT receipt_payload, encode(receipt_payload_hash, 'hex') AS hash
           FROM enterprise_project.resolution_receipt_material
          WHERE command_id = $1`,
        [commandId],
      );
      const row = rows.rows[0];
      return row === undefined ? undefined : { payload: row.receipt_payload, hash: row.hash };
    }

    async function readReceiptRow(commandId: string): Promise<{
      outcome: string;
      completed_at: Date;
    }> {
      const rows = await admin.query<{ outcome: string; completed_at: Date }>(
        `SELECT outcome, completed_at FROM enterprise_project.command_receipt WHERE command_id = $1`,
        [commandId],
      );
      const row = rows.rows[0];
      if (row === undefined) throw new Error('missing command receipt');
      return row;
    }

    function receiptRefFor(confirmation: Confirmation, digest = confirmation.receiptHash) {
      return contentRef(
        COMMAND_RECEIPT_OBJECT_TYPE,
        confirmation.commandId,
        fixture.enterpriseId,
        fixture.projectId,
        digest,
      );
    }

    // ---------------------------------------------------------------------
    // IdentityPolicy facts and the resolver boundary
    // ---------------------------------------------------------------------

    function identityContext(
      allowedProjectIds: readonly string[] = [],
      overrides: Partial<IdentityTransactionContext> = {},
    ): IdentityTransactionContext {
      return {
        kind: 'REQUEST',
        principalId: RESOLVER_PRINCIPAL,
        actorSnapshotId: RESOLVER_ACTOR,
        authorizationDecisionId: SEED_DECISION,
        authorizationDecisionHash: DECISION_HASH,
        authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        enterpriseId: fixture.enterpriseId,
        allowedProjectIds,
        correlationId: CORRELATION,
        ...overrides,
      };
    }

    function identityDeps(context: IdentityTransactionContext): IdentityCommandDeps {
      return { db: identityDb, repo: identityRepo, crypto, context };
    }

    function grantPolicySnapshotReference(): Common.SnapshotRef {
      return {
        kind: 'SNAPSHOT',
        objectType: 'identity.policy_snapshot',
        objectId: POLICY_SNAPSHOT_ID,
        snapshotId: POLICY_SNAPSHOT_ID,
        scope: {},
        contentHash: contentHashValue(grantPolicyHash.toString('hex')),
      };
    }

    async function registerIdentityFacts(): Promise<void> {
      await withIdentityTransaction(identityDb, identityContext(), (trx) =>
        identityRepo.insertPrincipal(trx, {
          id: RESOLVER_PRINCIPAL,
          principalKind: 'SERVICE',
          displayName: 'WI191 TE resolver service fixture',
          createdByPrincipalId: RESOLVER_PRINCIPAL,
          createdByActorSnapshotId: RESOLVER_ACTOR,
        }),
      );
      const platformPolicy = await recordPolicySnapshot(identityDeps(identityContext()), {
        policySnapshotId: POLICY_SNAPSHOT_ID,
        policySetVersion: POLICY_SNAPSHOT_SET_VERSION,
        policySchemaRefs: ['identity.PolicySnapshot@1.0'],
        effectiveFrom: PAST,
        policyDocument: { rules: ['wi191-grant-policy'], version: 1 },
        idempotencyKey: 'wi191:policy-snapshot',
      });
      expect(platformPolicy).toMatchObject({ status: 'COMMITTED' });
      const snapshot = await admin.query<{ payload_hash: Buffer }>(
        `SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1`,
        [POLICY_SNAPSHOT_ID],
      );
      grantPolicyHash = snapshot.rows[0]?.payload_hash ?? Buffer.alloc(0);
      expect(grantPolicyHash).toHaveLength(32);
      for (const grant of [
        { id: GRANT_READ_PROJECT, code: READ_CAPABILITY },
        { id: GRANT_CAPTURE_PROJECT, code: CAPTURE_CAPABILITY },
        { id: GRANT_REVOCABLE_READ, code: REVOCABLE_READ_CAPABILITY },
      ]) {
        const result = await grantCapability(identityDeps(identityContext([fixture.projectId])), {
          grantId: grant.id,
          principalId: RESOLVER_PRINCIPAL,
          capabilityCode: grant.code,
          scope: {
            scopeKind: 'PROJECT' as const,
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
          },
          resourceSelectors: [],
          actions: [grant.code],
          validFrom: PAST,
          grantPolicySnapshotId: POLICY_SNAPSHOT_ID,
          grantPolicySnapshotHash: grantPolicyHash,
          justification: 'wi191 fixture',
          idempotencyKey: `wi191:grant:${grant.id}`,
        });
        expect(result).toMatchObject({ status: 'COMMITTED' });
      }
      projectActorRef = await createActorSnapshot(
        identityDeps(identityContext([fixture.projectId])),
        {
          actorSnapshotId: RESOLVER_ACTOR_OTHER,
          principalId: RESOLVER_PRINCIPAL,
          declaredPrincipalKind: 'SERVICE',
          authenticationContextHash: AUTH_HASH,
          scopeKind: 'PROJECT',
          enterpriseId: fixture.enterpriseId,
          projectId: fixture.projectId,
        },
      );
    }

    /** Mints the read Decision for the exact receipt reference and payload. */
    async function readDecisionRef(
      ref: Common.ContentAddressedRef,
      overrides: {
        commandType?: string;
        capability?: string;
        purpose?: string;
        payloadHash?: Buffer;
        actorSnapshotRef?: Common.SnapshotRef;
      } = {},
    ): Promise<Common.ContentAddressedRef> {
      const payload = { commandReceiptRef: ref };
      const decision = await authorizeCommand(identityDeps(identityContext([fixture.projectId])), {
        actorSnapshotRef: overrides.actorSnapshotRef ?? projectActorRef,
        intent: {
          commandType: overrides.commandType ?? 'project.get_resolution_receipt',
          commandVersion: '1.0',
          scopeKind: 'PROJECT',
          enterpriseId: fixture.enterpriseId,
          projectId: fixture.projectId,
          purpose: overrides.purpose ?? READ_CAPABILITY,
          requestedCapability: overrides.capability ?? READ_CAPABILITY,
          commandPayloadHash:
            overrides.payloadHash ??
            digestIdentityPayload(payload as unknown as CanonicalJsonObject).hash,
          requestedAt: new Date(),
          highRiskAction: false,
        },
        authenticationContextHash: AUTH_HASH,
        policySnapshotRef: grantPolicySnapshotReference(),
        ttlSeconds: 900,
      });
      expect(decision.outcome).toBe('ALLOW');
      return decision.authorizationDecisionRef;
    }

    function readEnvelope(input: {
      ref: Common.ContentAddressedRef;
      decisionRef: Common.ContentAddressedRef;
      actorRef?: Common.SnapshotRef;
      scope?: { enterpriseId: string; projectId?: string };
      authenticationContextHash?: Buffer;
      consistencyRequirement?: string;
    }): CanonicalJsonObject {
      const scope = input.scope ?? {
        enterpriseId: fixture.enterpriseId,
        projectId: fixture.projectId,
      };
      const requesterScope =
        scope.projectId === undefined
          ? { enterpriseId: scope.enterpriseId }
          : { enterpriseId: scope.enterpriseId, projectId: scope.projectId };
      return {
        queryId: newUuidV7(),
        queryType: 'project.get_resolution_receipt',
        queryVersion: '1.0',
        scopeRef: scope,
        requester: input.actorRef ?? projectActorRef,
        authenticationContextRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.identity.authentication_context',
          objectId: AUTH_CONTEXT_ID,
          scope: requesterScope,
          contentHash: contentHashValue(
            (input.authenticationContextHash ?? AUTH_HASH).toString('hex'),
          ),
        },
        authorizationDecisionRef: input.decisionRef,
        consistencyRequirement: input.consistencyRequirement ?? 'AUTHORITATIVE',
        correlationId: CORRELATION,
        requestedAt: new Date().toISOString(),
        payload: { commandReceiptRef: input.ref },
      } as unknown as CanonicalJsonObject;
    }

    /** Reads one exact receipt through the trusted composition entry. */
    async function readThroughEntry(
      confirmation: Confirmation,
      options: {
        digest?: string;
        decisionRef?: Common.ContentAddressedRef;
        scope?: { enterpriseId: string; projectId?: string };
        sessionHash?: Buffer;
        authenticationContextHash?: Buffer;
        consistencyRequirement?: string;
      } = {},
    ) {
      const ref = receiptRefFor(confirmation, options.digest);
      const decisionRef = options.decisionRef ?? (await readDecisionRef(ref));
      const envelope = readEnvelope({
        ref,
        decisionRef,
        ...(options.scope === undefined ? {} : { scope: options.scope }),
        ...(options.authenticationContextHash === undefined
          ? {}
          : { authenticationContextHash: options.authenticationContextHash }),
        ...(options.consistencyRequirement === undefined
          ? {}
          : { consistencyRequirement: options.consistencyRequirement }),
      });
      return entry.read(envelope, {
        authenticationContextHash: options.sessionHash ?? AUTH_HASH,
      });
    }

    // ---------------------------------------------------------------------
    // EP-TD-003: a real confirmation is exactly attestable
    // ---------------------------------------------------------------------

    it('EP-TD-003 attests one real Human confirmation exactly and read-only', async () => {
      const source = await registerAndAcceptSource('td003');
      const confirmation = await confirmCustomerMaterial({
        tag: 'td003',
        sourceRef: source.sourceRef,
        sourceMaterialId: source.sourceMaterialId,
        digest: source.digest,
      });

      // The receipt hash is the canonical hash of the persisted material, not
      // the request payload hash of the confirmation command.
      const recomputed = digestCanonicalPayload(confirmation.receiptPayload).hash.toString('hex');
      expect(confirmation.receiptHash).toBe(recomputed);
      const attestedRequestHash = confirmation.receiptPayload
        .requestPayloadHash as unknown as Common.ContentHash;
      expect(confirmation.receiptHash).not.toBe(attestedRequestHash.digest);
      const receiptRow = await readReceiptRow(confirmation.commandId);
      expect(receiptRow.outcome).toBe('COMMITTED');
      expect(confirmation.receiptPayload.committedAt).toBe(receiptRow.completed_at.toISOString());

      const before = await admin.query<{ receipts: string; versions: string; decisions: string }>(
        `SELECT
           (SELECT count(*)::text FROM enterprise_project.resolution_receipt_material) AS receipts,
           (SELECT count(*)::text FROM enterprise_project.customer_material_version) AS versions,
           (SELECT count(*)::text FROM enterprise_project.customer_material_decision) AS decisions`,
      );

      const attestation = await readThroughEntry(confirmation);

      expect(attestation).toEqual({
        commandReceiptRef: receiptRefFor(confirmation),
        commandType: 'project.confirm_customer_material',
        commandVersion: '1.0',
        targetRef: objectRef(
          'zhiju.project.customer_material',
          confirmation.customerMaterialId,
          fixture.enterpriseId,
          fixture.projectId,
        ),
        scopeRef: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
        requestPayloadHash: attestedRequestHash,
        outcome: 'COMMITTED',
        candidateVersionRef: versionedRef(
          'zhiju.project.customer_material',
          confirmation.customerMaterialId,
          confirmation.candidateVersionId,
          fixture.enterpriseId,
          fixture.projectId,
        ),
        confirmedVersionRef: versionedRef(
          'zhiju.project.customer_material',
          confirmation.customerMaterialId,
          confirmation.confirmedVersionId,
          fixture.enterpriseId,
          fixture.projectId,
        ),
        sourceMaterialRefs: [
          contentRef(
            'zhiju.project.source_material',
            confirmation.sourceMaterialId,
            fixture.enterpriseId,
            fixture.projectId,
            confirmation.sourceDigest,
          ),
        ],
        decisionRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.project.business_decision',
          objectId: confirmation.decisionId,
          scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
          contentHash: expect.objectContaining({ algorithm: 'SHA-256' }),
        },
        actorRef: { principalKind: 'HUMAN', principalId: HUMAN_PRINCIPAL },
        actorSnapshotRef: objectRef(
          'zhiju.identity.actor_snapshot',
          HUMAN_ACTOR,
          fixture.enterpriseId,
          fixture.projectId,
        ),
        authorizationDecisionRef: objectRef(
          'zhiju.identity.authorization_decision',
          CONFIRMATION_DECISION,
          fixture.enterpriseId,
          fixture.projectId,
        ),
        committedAt: receiptRow.completed_at.toISOString(),
      });
      // The public attestation is the persisted canonical payload: the only
      // difference is the Receipt reference replacing the command identity.
      const payloadFields = Object.fromEntries(
        Object.entries(confirmation.receiptPayload).filter(([key]) => key !== 'commandId'),
      );
      expect(attestation).toEqual({ commandReceiptRef: expect.anything(), ...payloadFields });
      // The registered Result Schema accepts exactly what the owning read returns.
      expect(
        registry.validateOperationResult('project.get_resolution_receipt', '1.0', attestation),
      ).toEqual({ valid: true, errors: [] });

      const after = await admin.query<{ receipts: string; versions: string; decisions: string }>(
        `SELECT
           (SELECT count(*)::text FROM enterprise_project.resolution_receipt_material) AS receipts,
           (SELECT count(*)::text FROM enterprise_project.customer_material_version) AS versions,
           (SELECT count(*)::text FROM enterprise_project.customer_material_decision) AS decisions`,
      );
      expect(after.rows).toEqual(before.rows);
    });

    it('EP-TD-003 replays the confirmation without changing the attested receipt', async () => {
      const source = await registerAndAcceptSource('ttl-replay');
      const confirmation = await confirmCustomerMaterial({
        tag: 'replay',
        sourceRef: source.sourceRef,
        sourceMaterialId: source.sourceMaterialId,
        digest: source.digest,
      });
      const first = await readThroughEntry(confirmation);

      const replayed = await handleConfirmCustomerMaterial(
        db,
        seedContext('HUMAN', [fixture.projectId]),
        confirmation.envelope,
      );
      // A replayed envelope must not produce a second material or a second
      // confirmation: the stored receipt result is returned unchanged.
      expect(replayed.status).toBe('DUPLICATE');
      const material = await readMaterial(confirmation.commandId);
      expect(material).toEqual({
        payload: confirmation.receiptPayload,
        hash: confirmation.receiptHash,
      });
      expect(await readThroughEntry(confirmation)).toEqual(first);
    });

    // ---------------------------------------------------------------------
    // EP-TD-004: only a committed confirmation of this Project is attestable
    // ---------------------------------------------------------------------

    it('EP-TD-004 refuses receipts of other commands, uncommitted facts and wrong references', async () => {
      const source = await registerAndAcceptSource('td004');
      const confirmation = await confirmCustomerMaterial({
        tag: 'td004',
        sourceRef: source.sourceRef,
        sourceMaterialId: source.sourceMaterialId,
        digest: source.digest,
      });
      const other = await confirmCustomerMaterial({
        tag: 'td004-other',
        sourceRef: source.sourceRef,
        sourceMaterialId: source.sourceMaterialId,
        digest: source.digest,
      });

      // Another committed command of the same command type has its own exact
      // material: presenting its hash for this receipt is refused, and the
      // correlation id alone never selects a receipt.
      const foreignCommand = await admin.query<{ command_id: string }>(
        `SELECT command_id::text
           FROM enterprise_project.command_receipt
          WHERE command_type = 'project.propose_customer_material'
          LIMIT 1`,
      );
      const foreignId = foreignCommand.rows[0]?.command_id;
      if (foreignId === undefined) throw new Error('missing proposal receipt fixture');
      const foreignRef = contentRef(
        COMMAND_RECEIPT_OBJECT_TYPE,
        foreignId,
        fixture.enterpriseId,
        fixture.projectId,
        confirmation.receiptHash,
      );
      await expect(
        entry.read(
          readEnvelope({ ref: foreignRef, decisionRef: await readDecisionRef(foreignRef) }),
          session,
        ),
      ).rejects.toMatchObject({ code: PROJECT_QUERY_NOT_FOUND });

      await expect(
        readThroughEntry(confirmation, { digest: 'b'.repeat(64) }),
      ).rejects.toMatchObject({ code: PROJECT_QUERY_REF_INVALID });

      const crossMaterialRef = contentRef(
        COMMAND_RECEIPT_OBJECT_TYPE,
        confirmation.commandId,
        fixture.enterpriseId,
        fixture.projectId,
        other.receiptHash,
      );
      await expect(
        entry.read(
          readEnvelope({
            ref: crossMaterialRef,
            decisionRef: await readDecisionRef(crossMaterialRef),
          }),
          session,
        ),
      ).rejects.toMatchObject({ code: PROJECT_QUERY_REF_INVALID });

      // A rejected confirmation (unknown candidate version) never attests
      // anything, and an Agent confirmation is refused before it is recorded.
      const agentContext = seedContext('AGENT', [fixture.projectId]);
      await expect(
        handleConfirmCustomerMaterial(
          db,
          agentContext,
          seedEnvelope(
            agentContext,
            'project.confirm_customer_material',
            'wi191-td004-agent',
            {
              candidateVersionRef: versionedRef(
                'CustomerMaterial',
                confirmation.customerMaterialId,
                confirmation.candidateVersionId,
                fixture.enterpriseId,
                fixture.projectId,
              ),
              completeness: 'COMPLETE',
              declaredStatus: 'approved',
              evidenceRefs: [],
              justification: { reasonCode: 'HUMAN_REVIEW', summary: 'agent', evidenceRefs: [] },
            },
            { projectId: fixture.projectId },
          ),
        ),
      ).rejects.toMatchObject({ code: PROJECT_HUMAN_ONLY_DENIED });

      const humanContext = seedContext('HUMAN', [fixture.projectId]);
      const rejectedEnvelope = seedEnvelope(
        humanContext,
        'project.confirm_customer_material',
        'wi191-td004-rejected',
        {
          candidateVersionRef: versionedRef(
            'CustomerMaterial',
            confirmation.customerMaterialId,
            newUuidV7(),
            fixture.enterpriseId,
            fixture.projectId,
          ),
          completeness: 'COMPLETE',
          declaredStatus: 'approved',
          evidenceRefs: [],
          justification: {
            reasonCode: 'HUMAN_REVIEW',
            summary: 'unknown candidate',
            evidenceRefs: [],
          },
        },
        { projectId: fixture.projectId },
      );
      const rejectedConfirm = await handleConfirmCustomerMaterial(
        db,
        humanContext,
        rejectedEnvelope as unknown as CommandEnvelope & {
          payload: EnterpriseProject.ProjectConfirmCustomerMaterialPayload;
        },
      );
      expect(rejectedConfirm.status).toBe('REJECTED');
      const rejectedReceipt = await readReceiptRow(rejectedEnvelope.commandId);
      expect(rejectedReceipt.outcome).toBe('REJECTED');
      const rejectedRef = contentRef(
        COMMAND_RECEIPT_OBJECT_TYPE,
        rejectedEnvelope.commandId,
        fixture.enterpriseId,
        fixture.projectId,
        confirmation.receiptHash,
      );
      await expect(
        entry.read(
          readEnvelope({ ref: rejectedRef, decisionRef: await readDecisionRef(rejectedRef) }),
          session,
        ),
      ).rejects.toMatchObject({ code: PROJECT_QUERY_NOT_FOUND });

      // An unknown receipt id and an out-of-scope reference stay unavailable.
      const unknownRef = contentRef(
        COMMAND_RECEIPT_OBJECT_TYPE,
        newUuidV7(),
        fixture.enterpriseId,
        fixture.projectId,
        confirmation.receiptHash,
      );
      await expect(
        entry.read(
          readEnvelope({ ref: unknownRef, decisionRef: await readDecisionRef(unknownRef) }),
          session,
        ),
      ).rejects.toMatchObject({ code: PROJECT_QUERY_NOT_FOUND });

      const otherEnterpriseRef = contentRef(
        COMMAND_RECEIPT_OBJECT_TYPE,
        confirmation.commandId,
        newUuidV7(),
        fixture.projectId,
        confirmation.receiptHash,
      );
      // The reference Scope must be the Envelope Scope: the boundary refuses
      // it before any owning fact is read.
      await expect(
        entry.read(
          readEnvelope({
            ref: otherEnterpriseRef,
            decisionRef: await readDecisionRef(otherEnterpriseRef),
          }),
          session,
        ),
      ).rejects.toMatchObject({ code: SCOPE_MISMATCH });
    });

    // ---------------------------------------------------------------------
    // Authorization isolation at the resolver boundary
    // ---------------------------------------------------------------------

    it('EP-WI191-U-001 binds the read to the exact Decision, session, scope and payload', async () => {
      const source = await registerAndAcceptSource('authz');
      const confirmation = await confirmCustomerMaterial({
        tag: 'authz',
        sourceRef: source.sourceRef,
        sourceMaterialId: source.sourceMaterialId,
        digest: source.digest,
      });
      const ref = receiptRefFor(confirmation);

      // A Decision minted for another operation never authorizes this Query.
      const foreignOperation = await readDecisionRef(ref, {
        commandType: 'project.get_context_source_slice',
        purpose: 'project.context_source.read',
        capability: CAPTURE_CAPABILITY,
      });
      await expect(
        entry.read(readEnvelope({ ref, decisionRef: foreignOperation }), session),
      ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });

      // A Decision minted for another payload hash never authorizes this Query.
      const foreignPayload = await readDecisionRef(ref, {
        payloadHash: digestIdentityPayload({
          commandReceiptRef: foreignOperation,
        } as unknown as CanonicalJsonObject).hash,
      });
      await expect(
        entry.read(readEnvelope({ ref, decisionRef: foreignPayload }), session),
      ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });

      // A Decision of another session cannot be replayed through this session.
      await expect(
        entry.read(readEnvelope({ ref, decisionRef: await readDecisionRef(ref) }), {
          authenticationContextHash: OTHER_SESSION_HASH,
        }),
      ).rejects.toMatchObject({
        code: AUTHORIZATION_DECISION_INVALID,
      });

      // The Envelope authentication context must be the trusted session.
      const wrongSessionEnvelope = readEnvelope({
        ref,
        decisionRef: await readDecisionRef(ref),
        authenticationContextHash: OTHER_SESSION_HASH,
      });
      await expect(entry.read(wrongSessionEnvelope, session)).rejects.toMatchObject({
        code: AUTHORIZATION_DECISION_INVALID,
      });

      // A non-AUTHORITATIVE Query is refused before any fact is read.
      await expect(
        entry.read(
          readEnvelope({
            ref,
            decisionRef: await readDecisionRef(ref),
            consistencyRequirement: 'PROJECTION_OK',
          }),
          session,
        ),
      ).rejects.toMatchObject({ code: API_VALUE_INVALID });

      // The Envelope Scope must be the whole reference Scope.
      const mismatchedScope = contentRef(
        COMMAND_RECEIPT_OBJECT_TYPE,
        confirmation.commandId,
        fixture.enterpriseId,
        newUuidV7(),
        confirmation.receiptHash,
      );
      await expect(
        entry.read(
          readEnvelope({
            ref: mismatchedScope,
            decisionRef: await readDecisionRef(ref),
            scope: { enterpriseId: fixture.enterpriseId },
          }),
          session,
        ),
      ).rejects.toMatchObject({ code: SCOPE_MISMATCH });
    });

    // ---------------------------------------------------------------------
    // Storage boundary: RLS, ACL, mirror and immutability
    // ---------------------------------------------------------------------

    it('EP-WI191-RLS-001 enforces Project RLS, ACL, mirror and immutability', async () => {
      const source = await registerAndAcceptSource('rls');
      const confirmation = await confirmCustomerMaterial({
        tag: 'rls',
        sourceRef: source.sourceRef,
        sourceMaterialId: source.sourceMaterialId,
        digest: source.digest,
      });
      const context = seedContext('HUMAN', [fixture.projectId]);
      const repository = new ResolutionReceiptRepository();

      await expect(
        withEnterpriseProjectTransaction(db, context, (trx) =>
          trx
            .updateTable('enterprise_project.resolution_receipt_material')
            .set({ outcome: 'COMMITTED' })
            .where('command_id', '=', confirmation.commandId)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        withEnterpriseProjectTransaction(db, context, (trx) =>
          trx
            .deleteFrom('enterprise_project.resolution_receipt_material')
            .where('command_id', '=', confirmation.commandId)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: '42501' });

      // A self-consistent row of a Project the context does not allow is
      // refused by the RLS insert policy itself.
      const foreignPayload = {
        ...confirmation.receiptPayload,
        commandId: newUuidV7(),
      } as CanonicalJsonObject;
      const foreignPayloadHash = digestCanonicalPayload(foreignPayload).hash;
      await expect(
        withEnterpriseProjectTransaction(db, seedContext('HUMAN', []), (trx) =>
          repository.insertResolutionReceiptMaterial(trx, {
            commandId: foreignPayload.commandId as string,
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
            commandType: 'project.confirm_customer_material',
            commandVersion: '1.0',
            outcome: 'COMMITTED',
            targetRef: foreignPayload.targetRef,
            requestPayloadHash: Buffer.from(
              (foreignPayload.requestPayloadHash as unknown as Common.ContentHash).digest,
              'hex',
            ),
            candidateVersionRef: foreignPayload.candidateVersionRef,
            confirmedVersionRef: foreignPayload.confirmedVersionRef,
            sourceMaterialRefs: foreignPayload.sourceMaterialRefs,
            decisionRef: foreignPayload.decisionRef,
            actorRef: foreignPayload.actorRef,
            actorSnapshotRef: foreignPayload.actorSnapshotRef,
            authorizationDecisionRef: foreignPayload.authorizationDecisionRef,
            committedAt: new Date(foreignPayload.committedAt as unknown as string),
            receiptPayload: foreignPayload,
            receiptPayloadHash: foreignPayloadHash,
            createdByPrincipalId: HUMAN_PRINCIPAL,
            createdByActorSnapshotId: HUMAN_ACTOR,
            authorizationDecisionId: CONFIRMATION_DECISION,
          }),
        ),
      ).rejects.toMatchObject({ code: '42501' });

      // Promoted mirrors that disagree with the canonical payload are rejected
      // by the owning guard, including the content address itself.
      await expect(
        withEnterpriseProjectTransaction(db, context, (trx) =>
          repository.insertResolutionReceiptMaterial(trx, {
            commandId: newUuidV7(),
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
            commandType: 'project.confirm_customer_material',
            commandVersion: '1.0',
            outcome: 'COMMITTED',
            targetRef: confirmation.receiptPayload.targetRef,
            requestPayloadHash: Buffer.alloc(32, 0x02),
            candidateVersionRef: confirmation.receiptPayload.candidateVersionRef,
            confirmedVersionRef: confirmation.receiptPayload.confirmedVersionRef,
            sourceMaterialRefs: confirmation.receiptPayload.sourceMaterialRefs,
            decisionRef: confirmation.receiptPayload.decisionRef,
            actorRef: confirmation.receiptPayload.actorRef,
            actorSnapshotRef: confirmation.receiptPayload.actorSnapshotRef,
            authorizationDecisionRef: confirmation.receiptPayload.authorizationDecisionRef,
            committedAt: new Date(),
            receiptPayload: confirmation.receiptPayload,
            receiptPayloadHash: Buffer.from(confirmation.receiptHash, 'hex'),
            createdByPrincipalId: HUMAN_PRINCIPAL,
            createdByActorSnapshotId: HUMAN_ACTOR,
            authorizationDecisionId: CONFIRMATION_DECISION,
          }),
        ),
      ).rejects.toMatchObject({ code: '22023' });

      // Without an established Project context the table is not enumerable.
      const connection = await epPool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query('SET LOCAL ROLE enterprise_project_app');
        const visible = await connection.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM enterprise_project.resolution_receipt_material`,
        );
        expect(visible.rows[0]?.count).toBe('0');
        await connection.query('ROLLBACK');
      } finally {
        connection.release();
      }

      // The two maintenance helpers stay owner-only: the V0002 default
      // privileges would otherwise grant EXECUTE on every owner-created
      // function to the application role, letting it re-derive or write
      // Receipt material outside the owning confirmation path.
      const privileges = await admin.query<{
        app_canonicalizer: boolean;
        app_backfill: boolean;
        owner_canonicalizer: boolean;
        owner_backfill: boolean;
      }>(
        `SELECT has_function_privilege('enterprise_project_app',
                    'enterprise_project.canonical_jsonb_text(jsonb)', 'EXECUTE') AS app_canonicalizer,
                has_function_privilege('enterprise_project_app',
                    'enterprise_project.backfill_resolution_receipt_material()', 'EXECUTE') AS app_backfill,
                has_function_privilege('enterprise_project_owner',
                    'enterprise_project.canonical_jsonb_text(jsonb)', 'EXECUTE') AS owner_canonicalizer,
                has_function_privilege('enterprise_project_owner',
                    'enterprise_project.backfill_resolution_receipt_material()', 'EXECUTE') AS owner_backfill`,
      );
      expect(privileges.rows[0]).toEqual({
        app_canonicalizer: false,
        app_backfill: false,
        owner_canonicalizer: true,
        owner_backfill: true,
      });
      for (const statement of [
        `SELECT enterprise_project.canonical_jsonb_text('{}'::jsonb)`,
        `SELECT enterprise_project.backfill_resolution_receipt_material()`,
      ]) {
        const appConnection = await epPool.connect();
        try {
          await appConnection.query('BEGIN');
          await appConnection.query('SET LOCAL ROLE enterprise_project_app');
          await expect(appConnection.query(statement)).rejects.toMatchObject({
            code: '42501',
            message: expect.stringContaining('permission denied for function'),
          });
        } finally {
          await appConnection.query('ROLLBACK');
          appConnection.release();
        }
      }
    });

    it('EP-WI191-RLS-002 refuses a receipt that repeats an exact source ref', async () => {
      const source = await registerAndAcceptSource('dup-guard');
      const confirmation = await confirmCustomerMaterial({
        tag: 'dup-guard',
        sourceRef: source.sourceRef,
        sourceMaterialId: source.sourceMaterialId,
        digest: source.digest,
      });
      const singleRef = (confirmation.receiptPayload.sourceMaterialRefs as readonly unknown[])[0];
      const repository = new ResolutionReceiptRepository();
      // A row whose own payload, mirrors and content address are otherwise
      // consistent: only the source refs are repeated, which the public Result
      // Schema declares unique. The owning guard refuses it instead of storing
      // a receipt the Query could never return.
      const duplicatePayload = {
        ...confirmation.receiptPayload,
        commandId: newUuidV7(),
        sourceMaterialRefs: [singleRef, singleRef],
      } as unknown as CanonicalJsonObject;
      const duplicatePayloadHash = digestCanonicalPayload(duplicatePayload).hash;
      const context = seedContext('HUMAN', [fixture.projectId]);
      await expect(
        withEnterpriseProjectTransaction(db, context, (trx) =>
          repository.insertResolutionReceiptMaterial(trx, {
            commandId: duplicatePayload.commandId as string,
            enterpriseId: fixture.enterpriseId,
            projectId: fixture.projectId,
            commandType: 'project.confirm_customer_material',
            commandVersion: '1.0',
            outcome: 'COMMITTED',
            targetRef: duplicatePayload.targetRef,
            requestPayloadHash: Buffer.from(
              (duplicatePayload.requestPayloadHash as unknown as Common.ContentHash).digest,
              'hex',
            ),
            candidateVersionRef: duplicatePayload.candidateVersionRef,
            confirmedVersionRef: duplicatePayload.confirmedVersionRef,
            sourceMaterialRefs: duplicatePayload.sourceMaterialRefs,
            decisionRef: duplicatePayload.decisionRef,
            actorRef: duplicatePayload.actorRef,
            actorSnapshotRef: duplicatePayload.actorSnapshotRef,
            authorizationDecisionRef: duplicatePayload.authorizationDecisionRef,
            committedAt: new Date(duplicatePayload.committedAt as unknown as string),
            receiptPayload: duplicatePayload,
            receiptPayloadHash: duplicatePayloadHash,
            createdByPrincipalId: HUMAN_PRINCIPAL,
            createdByActorSnapshotId: HUMAN_ACTOR,
            authorizationDecisionId: CONFIRMATION_DECISION,
          }),
        ),
      ).rejects.toMatchObject({ code: '22023' });
    });

    // ---------------------------------------------------------------------
    // Historical material: exact recomputation only
    // ---------------------------------------------------------------------

    it('EP-WI191-B-001 backfills an exactly recomputable historical confirmation', async () => {
      const source = await registerAndAcceptSource('backfill');
      const confirmation = await confirmCustomerMaterial({
        tag: 'backfill',
        sourceRef: source.sourceRef,
        sourceMaterialId: source.sourceMaterialId,
        digest: source.digest,
      });
      const before = await readThroughEntry(confirmation);

      // Simulate a confirmation that predates this table: the owning immutable
      // records stay, only the material is gone.
      await admin.query(
        `DELETE FROM enterprise_project.resolution_receipt_material WHERE command_id = $1`,
        [confirmation.commandId],
      );
      await expect(readThroughEntry(confirmation)).rejects.toMatchObject({
        code: PROJECT_QUERY_NOT_FOUND,
      });
      const backfilled = await admin.query<{ inserted: number }>(
        `SELECT enterprise_project.backfill_resolution_receipt_material() AS inserted`,
      );
      expect(backfilled.rows[0]?.inserted).toBe(1);
      const material = await readMaterial(confirmation.commandId);
      expect(material).toEqual({
        payload: confirmation.receiptPayload,
        hash: confirmation.receiptHash,
      });
      expect(await readThroughEntry(confirmation)).toEqual(before);
      // Re-running the backfill is idempotent: one command keeps one receipt.
      const rerun = await admin.query<{ inserted: number }>(
        `SELECT enterprise_project.backfill_resolution_receipt_material() AS inserted`,
      );
      expect(rerun.rows[0]?.inserted).toBe(0);
    });

    it('EP-WI191-B-002 leaves history without sufficient immutable records unavailable', async () => {
      const source = await registerAndAcceptSource('nodata');
      const confirmation = await confirmCustomerMaterial({
        tag: 'nodata',
        sourceRef: source.sourceRef,
        sourceMaterialId: source.sourceMaterialId,
        digest: source.digest,
      });
      await admin.query(
        `DELETE FROM enterprise_project.resolution_receipt_material WHERE command_id = $1`,
        [confirmation.commandId],
      );
      // The confirmation decision is part of the canonical material: without
      // it the receipt cannot be recomputed, and the current root/version must
      // never be used to guess what the Human confirmed.
      await admin.query(
        `DELETE FROM enterprise_project.customer_material_decision WHERE decision_id = $1`,
        [confirmation.decisionId],
      );
      const backfilled = await admin.query<{ inserted: number }>(
        `SELECT enterprise_project.backfill_resolution_receipt_material() AS inserted`,
      );
      expect(backfilled.rows[0]?.inserted).toBe(0);
      expect(await readMaterial(confirmation.commandId)).toBeUndefined();
      await expect(readThroughEntry(confirmation)).rejects.toMatchObject({
        code: PROJECT_QUERY_NOT_FOUND,
      });
    });

    // ---------------------------------------------------------------------
    // Commit-before failure leaves no attestation behind
    // ---------------------------------------------------------------------

    it('EP-WI191-F-001 aborts the whole confirmation when the receipt cannot commit', async () => {
      const source = await registerAndAcceptSource('fault');
      const proposeContext = seedContext('HUMAN', [fixture.projectId]);
      const evidence = { evidence: source.sourceRef, relation: 'SUPPORTS' as const };
      const proposed = committedPayload(
        await handleProposeCustomerMaterial(
          db,
          proposeContext,
          seedEnvelope(
            proposeContext,
            'project.propose_customer_material',
            'wi191-fault-propose',
            {
              projectRef: objectRef(
                'Project',
                fixture.projectId,
                fixture.enterpriseId,
                fixture.projectId,
              ),
              proposal: {
                materialType: 'quality.procedure',
                title: 'fault control procedure',
                completeness: 'PARTIAL',
                sourceSelections: [{ sourceMaterialRef: source.sourceRef, role: 'primary' }],
                language: 'zh-CN',
                classificationRationale: {
                  reasonCode: 'SOURCE_CLASSIFICATION',
                  summary: 'Fault injection fixture.',
                  evidenceRefs: [evidence],
                },
              },
            },
            { projectId: fixture.projectId },
          ),
        ),
      ) as unknown as { customerMaterialRef: Common.VersionedRef };

      const humanContext = seedContext('HUMAN', [fixture.projectId]);
      const commandId = newUuidV7();
      const confirmEnvelope = (
        id: string,
      ): CommandEnvelope & {
        payload: EnterpriseProject.ProjectConfirmCustomerMaterialPayload;
      } =>
        ({
          ...seedEnvelope(
            humanContext,
            'project.confirm_customer_material',
            'wi191-fault-confirm',
            {
              candidateVersionRef: proposed.customerMaterialRef,
              completeness: 'COMPLETE',
              declaredStatus: 'approved',
              evidenceRefs: [evidence],
              justification: {
                reasonCode: 'HUMAN_REVIEW',
                summary: 'Fault injection confirmation.',
                evidenceRefs: [evidence],
              },
            },
            { projectId: fixture.projectId },
          ),
          commandId: id,
        }) as unknown as CommandEnvelope & {
          payload: EnterpriseProject.ProjectConfirmCustomerMaterialPayload;
        };

      await admin.query(
        `ALTER TABLE enterprise_project.resolution_receipt_material
           ADD CONSTRAINT wi191_fault_guard CHECK (command_id <> '${commandId}'::uuid) NOT VALID`,
      );
      try {
        await expect(
          handleConfirmCustomerMaterial(db, humanContext, confirmEnvelope(commandId)),
        ).rejects.toThrow();
      } finally {
        await admin.query(
          `ALTER TABLE enterprise_project.resolution_receipt_material
             DROP CONSTRAINT wi191_fault_guard`,
        );
      }

      // Nothing half-written survives: no material, no confirmed version, no
      // decision and no committed receipt for that command.
      expect(await readMaterial(commandId)).toBeUndefined();
      const leftovers = await admin.query<{
        versions: string;
        decisions: string;
        receipts: string;
        status: string;
      }>(
        `SELECT
           (SELECT count(*)::text FROM enterprise_project.customer_material_version
             WHERE source_command_id = $1) AS versions,
           (SELECT count(*)::text FROM enterprise_project.customer_material_decision
             WHERE source_command_id = $1) AS decisions,
           (SELECT count(*)::text FROM enterprise_project.command_receipt
             WHERE command_id = $1) AS receipts,
           (SELECT classification_status FROM enterprise_project.customer_material
             WHERE customer_material_id = $2) AS status`,
        [commandId, proposed.customerMaterialRef.objectId],
      );
      expect(leftovers.rows[0]).toEqual({
        versions: '0',
        decisions: '0',
        receipts: '0',
        status: 'PROPOSED',
      });

      // With the obstruction removed the same command commits normally.
      const retried = await handleConfirmCustomerMaterial(
        db,
        humanContext,
        confirmEnvelope(commandId),
      );
      expect(retried.status).toBe('COMMITTED');
      const material = await readMaterial(commandId);
      if (material === undefined) throw new Error('retried confirmation lost its receipt');
      expect(digestCanonicalPayload(material.payload).hash.toString('hex')).toBe(material.hash);
    });

    it('EP-WI191-P-004 never accepts a tampered stored receipt as canonical', async () => {
      const source = await registerAndAcceptSource('tamper');
      const confirmation = await confirmCustomerMaterial({
        tag: 'tamper',
        sourceRef: source.sourceRef,
        sourceMaterialId: source.sourceMaterialId,
        digest: source.digest,
      });
      for (const trigger of [
        'resolution_receipt_material_immutable_guard',
        'resolution_receipt_material_mirror_guard',
      ]) {
        await admin.query(
          `ALTER TABLE enterprise_project.resolution_receipt_material DISABLE TRIGGER ${trigger}`,
        );
      }
      try {
        await admin.query(
          `UPDATE enterprise_project.resolution_receipt_material
              SET receipt_payload = jsonb_set(receipt_payload, '{actorRef,principalId}', to_jsonb($2::text))
            WHERE command_id = $1`,
          [confirmation.commandId, RESOLVER_PRINCIPAL],
        );
      } finally {
        for (const trigger of [
          'resolution_receipt_material_immutable_guard',
          'resolution_receipt_material_mirror_guard',
        ]) {
          await admin.query(
            `ALTER TABLE enterprise_project.resolution_receipt_material ENABLE TRIGGER ${trigger}`,
          );
        }
      }
      // The stored payload no longer hashes to the published content address,
      // so the exact reference is refused instead of being re-attested.
      await expect(readThroughEntry(confirmation)).rejects.toMatchObject({
        code: PROJECT_QUERY_REF_INVALID,
      });
      expect(await readMaterial(confirmation.commandId)).toMatchObject({
        hash: confirmation.receiptHash,
      });
      const stored = await readMaterial(confirmation.commandId);
      expect(stored?.payload).not.toEqual(confirmation.receiptPayload);
    });

    it('EP-WI191-P-005 attests one exact source ref when a selection repeats it', async () => {
      const source = await registerAndAcceptSource('dup-selection');
      // `sourceSelections` is a NonEmptySet of whole selections: the same
      // exact SourceMaterial under another role/locator is legal input and is
      // still accepted by the owning proposal path.
      const selections: readonly EnterpriseProject.MaterialSourceSelection[] = [
        { sourceMaterialRef: source.sourceRef, role: 'primary', locator: 'section.1' },
        { sourceMaterialRef: source.sourceRef, role: 'attachment', locator: 'annex.b' },
      ];
      const confirmation = await confirmCustomerMaterial({
        tag: 'dup-selection',
        sourceRef: source.sourceRef,
        sourceMaterialId: source.sourceMaterialId,
        digest: source.digest,
        sourceSelections: selections,
      });

      // The confirmation kept both selections; only the Receipt projection
      // publishes the exact refs themselves, which are a unique set.
      const version = await admin.query<{ selections: number }>(
        `SELECT jsonb_array_length(source_selections) AS selections
           FROM enterprise_project.customer_material_version
          WHERE version_id = $1`,
        [confirmation.confirmedVersionId],
      );
      expect(version.rows[0]?.selections).toBe(2);
      expect(confirmation.receiptPayload.sourceMaterialRefs).toEqual([
        contentRef(
          'zhiju.project.source_material',
          source.sourceMaterialId,
          fixture.enterpriseId,
          fixture.projectId,
          source.digest,
        ),
      ]);

      const attestation = await readThroughEntry(confirmation);
      expect(attestation.sourceMaterialRefs).toEqual([
        contentRef(
          'zhiju.project.source_material',
          source.sourceMaterialId,
          fixture.enterpriseId,
          fixture.projectId,
          source.digest,
        ),
      ]);
      expect(
        registry.validateOperationResult('project.get_resolution_receipt', '1.0', attestation),
      ).toEqual({ valid: true, errors: [] });

      // The V2015 backfill mirrors the same exact-ref rule: re-deriving the
      // material from the immutable records reproduces the committed one
      // byte for byte and stays readable.
      await admin.query(
        `DELETE FROM enterprise_project.resolution_receipt_material WHERE command_id = $1`,
        [confirmation.commandId],
      );
      const backfilled = await admin.query<{ inserted: number }>(
        `SELECT enterprise_project.backfill_resolution_receipt_material() AS inserted`,
      );
      expect(backfilled.rows[0]?.inserted).toBe(1);
      expect(await readMaterial(confirmation.commandId)).toEqual({
        payload: confirmation.receiptPayload,
        hash: confirmation.receiptHash,
      });
      expect(await readThroughEntry(confirmation)).toEqual(attestation);
    });

    it('EP-WI191-U-002 refuses a resolver whose capability grant was revoked', async () => {
      const source = await registerAndAcceptSource('revoked');
      const confirmation = await confirmCustomerMaterial({
        tag: 'revoked',
        sourceRef: source.sourceRef,
        sourceMaterialId: source.sourceMaterialId,
        digest: source.digest,
      });
      const ref = receiptRefFor(confirmation);
      const decisionRef = await readDecisionRef(ref, {
        capability: REVOCABLE_READ_CAPABILITY,
      });
      const allowed = await revocableEntry.read(readEnvelope({ ref, decisionRef }), session);
      expect(allowed.commandReceiptRef).toEqual(ref);

      const revoked = await revokeCapability(identityDeps(identityContext([fixture.projectId])), {
        targetId: GRANT_REVOCABLE_READ,
        expectedAggregateVersion: '1',
        scope: {
          scopeKind: 'PROJECT',
          enterpriseId: fixture.enterpriseId,
          projectId: fixture.projectId,
        },
        reasonCode: 'WI191_REVOKED',
        effectiveAt: new Date(),
        idempotencyKey: 'wi191:revoke:read',
      });
      expect(revoked).toMatchObject({ status: 'COMMITTED' });

      // The grant is re-evaluated at read time: the same Decision that was
      // valid a moment ago no longer authorizes the attestation.
      await expect(
        revocableEntry.read(readEnvelope({ ref, decisionRef }), session),
      ).rejects.toMatchObject({ code: AUTHORIZATION_REVOKED });
    });

    it('EP-WI191-C-001 keeps the legacy public operations and the receipt boundary exact', async () => {
      const source = await registerAndAcceptSource('compat');
      const confirmation = await confirmCustomerMaterial({
        tag: 'compat',
        sourceRef: source.sourceRef,
        sourceMaterialId: source.sourceMaterialId,
        digest: source.digest,
      });
      // The new Query is additive: the historical Source Slice operations and
      // their acceptance stay as delivered, and the attestation keeps the
      // exact reference the caller presented.
      expect(registry.getOperation('project.get_context_source_slice', '1.0')).toMatchObject({
        kind: 'QUERY',
        authorizationPurpose: 'project.context_source.read',
      });
      expect(registry.getOperation('project.capture_context_source_slice', '1.0')).toMatchObject({
        kind: 'COMMAND',
        targetObjectType: 'zhiju.project.context_source_slice',
      });
      const attestation = await readThroughEntry(confirmation);
      expect(attestation.commandReceiptRef).toEqual(receiptRefFor(confirmation));
      expect(attestation.outcome).toBe('COMMITTED');
    });
  },
);
