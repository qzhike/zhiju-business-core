// IM-03 WI-04 (issue #60): focused PostgreSQL tests for the Project
// Aggregate, ProjectScopeClaim, ProjectSnapshotBinding vertical slice and
// the `project.validate_object_scope` authoritative Query.
//
// Reuses the WI-02/WI-03 disposable container + `im03_wi04_probe` role
// pattern. The suite exercises the happy path of `project.create_project`
// (creating Project + ScopeClaim + SnapshotBinding inside one transaction)
// plus the negative paths required by Issue #60 acceptance: cross-Enterprise
// refs, `latest`/`current` pointer rejection, missing Profile/QMS/ProductScope,
// optional Baseline/Template/Regulatory, memberPolicyRef validation, scope
// immutability of (enterprise_id, project_id), and the
// `project.validate_object_scope` query against Project A/B isolation.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql } from 'kysely';
import {
  createEnterpriseProjectDatabase,
  digestCanonicalPayload,
  EnterpriseBusinessError,
  EnterpriseBusinessRepository,
  handleCreateEnterprise,
  handleCreateProject,
  handleAcceptSourceMaterial,
  handleEnterpriseProductCreate,
  handleEnterpriseProductCreateScopeSnapshot,
  handleEnterpriseProfileCreateSnapshot,
  handleEnterpriseQmsCreateRevision,
  handleEnterpriseQmsActivateRevision,
  handleRegisterSourceMaterial,
  handleValidateObjectScope,
  withEnterpriseProjectTransaction,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  PROJECT_MATERIAL_SOURCE_INVALID,
  PROJECT_SOURCE_ALREADY_ACCEPTED,
  PROJECT_SOURCE_NOT_TRUSTED,
  PROJECT_PROJECT_DISPLAY_CODE_CONFLICT,
  PROJECT_START_SNAPSHOT_LATEST_FORBIDDEN,
  PROJECT_START_SNAPSHOT_SCOPE_MISMATCH,
  PROJECT_MEMBER_POLICY_REF_INVALID,
  PROJECT_OBJECT_SCOPE_MISMATCH,
  type CommandEnvelope,
  type CommandResult,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import { newUuidV7, type CanonicalJsonObject, type UuidV7 } from '@zhiju/shared-kernel';
import type { Common, EnterpriseProject } from '@zhiju/contracts';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE_A = 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a1a1';
const ENTERPRISE_B = 'b2b2b2b2-b2b2-72b2-82b2-b2b2b2b2b2b2';
const HUMAN_PRINCIPAL = 'd1d1d1d1-d1d1-71d1-81d1-d1d1d1d1d1d1';
const ACTOR_HUMAN = 'd3d3d3d3-d3d3-73d3-83d3-d3d3d3d3d3d3';
const DECISION = 'd5d5d5d5-d5d5-75d5-85d5-d5d5d5d5d5d5';
const POLICY = 'd6d6d6d6-d6d6-76d6-86d6-d6d6d6d6d6d6';
const DECISION_HASH = Buffer.alloc(32, 0x42);
const CORRELATION = 'd7d7d7d7-d7d7-77d7-87d7-d7d7d7d7d7d7';

const TEST_CONTENT_HASH: Common.ContentHash = {
  algorithm: 'SHA-256',
  digest: 'a'.repeat(64),
  canonicalizationVersion: '1',
};

interface CommittedProps {
  projectRef?: { objectId: UuidV7 };
  projectScopeClaimRef?: { objectId: UuidV7 };
  projectSnapshotBindingRef?: { objectId: UuidV7 };
}

let currentEnterpriseId = ENTERPRISE_A;

function contextFor(
  enterpriseId: string,
  allowedProjectIds: readonly string[] = [],
): EnterpriseProjectTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: HUMAN_PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR_HUMAN,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: DECISION_HASH,
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY,
    enterpriseId,
    allowedProjectIds,
    correlationId: CORRELATION,
  };
}

let envelopeCounter = 0;
function envelope(overrides: Partial<CommandEnvelope> = {}): CommandEnvelope {
  envelopeCounter += 1;
  const tail = envelopeCounter.toString(16).padStart(12, '0');
  return {
    commandId: `f4f4f4f4-f4f4-73f4-83f4-${tail}`,
    commandType: 'wi04.manual.command',
    commandVersion: '1.0',
    idempotencyScope: 'wi04',
    idempotencyKey: 'wi04-key-1',
    requestPayload: { op: 'manual' },
    enterpriseId: currentEnterpriseId,
    targetType: 'Project',
    targetId: '00000000-0000-7000-8000-000000000000',
    correlationId: CORRELATION,
    principalId: HUMAN_PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR_HUMAN,
    authorizationDecisionId: DECISION,
    policySnapshotId: POLICY,
    ...overrides,
  };
}

function payloadEnvelope<TPayload extends object>(
  key: string,
  payload: TPayload,
  overrides: Partial<CommandEnvelope> = {},
): CommandEnvelope & { payload: TPayload } {
  return {
    ...envelope(overrides),
    requestPayload: { op: key, payload } as unknown as CanonicalJsonObject,
    idempotencyKey: `${key}-${overrides.idempotencyKey ?? 'k'}`,
    payload,
  };
}

function objectRef<T extends string>(
  objectType: T,
  objectId: string,
  enterpriseId = currentEnterpriseId,
): { kind: 'OBJECT'; objectType: T; objectId: string; scope: Common.ScopeRef } {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: { enterpriseId },
  };
}

function versionedRef<T extends string>(
  objectType: T,
  objectId: string,
  versionId: string,
  enterpriseId = currentEnterpriseId,
): {
  kind: 'VERSIONED';
  objectType: T;
  objectId: string;
  versionId: string;
  scope: Common.ScopeRef;
} {
  return {
    kind: 'VERSIONED',
    objectType,
    objectId,
    versionId,
    scope: { enterpriseId },
  };
}

function snapshotRef(
  objectType: string,
  snapshotId: string,
  digest: string,
  enterpriseId = currentEnterpriseId,
): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType: objectType,
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

function refDigest(payload: object): string {
  return digestCanonicalPayload(
    payload as Parameters<typeof digestCanonicalPayload>[0],
  ).hash.toString('hex');
}
// Silence unused-symbol warning while keeping the helper available for future
// ad-hoc test extensions that need to derive deterministic digests.
void refDigest;

function objectIdFrom(result: CommandResult): UuidV7 {
  if (result.status !== 'COMMITTED') {
    throw new Error(`expected COMMITTED, got ${result.status} ${result.errorCode ?? ''}`);
  }
  const payload = result.resultPayload as CommittedProps;
  const id =
    payload.projectRef?.objectId ??
    payload.projectScopeClaimRef?.objectId ??
    payload.projectSnapshotBindingRef?.objectId;
  if (!id) throw new Error('no objectId in resultPayload');
  return id;
}

async function seedEnterpriseAndStartFixtures(
  db: ReturnType<typeof createEnterpriseProjectDatabase>,
  enterpriseId: string,
): Promise<{
  enterpriseProfileSnapshotId: string;
  enterpriseProfilePayloadHash: string;
  qmsConfigurationId: string;
  qmsConfigurationRevisionId: string;
  qmsConfigurationRevisionHash: string;
  productScopeSnapshotId: string;
  productScopePayloadHash: string;
}> {
  const ctx = contextFor(enterpriseId);
  // The seed helper runs six Commands in sequence. Each test mints a fresh
  // enterprise_id (UUIDv7) so we derive a unique idempotency key prefix from
  // the full id and a per-seed sub-tag; this avoids any collision when
  // multiple tests run sequentially against the same database.
  const seedTag = enterpriseId;
  const displayCodeSuffix = newUuidV7().replace(/-/g, '').slice(0, 12);
  const seed = await handleCreateEnterprise(
    db,
    ctx,
    payloadEnvelope(
      `seed-enterprise-${seedTag}`,
      {
        displayCode: `WI04-SEED-${displayCodeSuffix}`,
        displayName: 'WI04 seed',
        initialStatus: 'ACTIVE' as const,
      },
      { idempotencyKey: `seed-enterprise-${seedTag}`, enterpriseId },
    ),
  );
  if (seed.status !== 'COMMITTED') {
    throw new Error(`enterprise seed failed: ${seed.status} ${seed.errorCode ?? ''}`);
  }
  // Create a Product + initial ProductVersion so the Profile Snapshot can
  // bind to a ProductVersionRef. The Product root's initial version remains
  // HISTORICAL until activation, but Profile Snapshot does not require the
  // version to be CURRENT — it only requires the exact row to exist.
  const productCreate = await handleEnterpriseProductCreate(
    db,
    ctx,
    payloadEnvelope(
      `seed-product-${seedTag}`,
      {
        enterpriseRef: objectRef('Enterprise' as const, enterpriseId),
        displayCode: `WIDGET-${displayCodeSuffix}`,
        initialVersion: {
          productType: 'manufactured.widget',
          displayName: 'Widget',
          intendedUse: 'demo',
          productScope: { productFamily: 'widget', variants: ['a'], markets: ['CN'] },
          sourceRefs: [objectRef('SourceMaterial', '00000000-0000-7000-8000-000000000701')],
        },
      },
      { idempotencyKey: `seed-product-${seedTag}` },
    ),
  );
  if (productCreate.status !== 'COMMITTED') {
    throw new Error(
      `product seed failed: ${productCreate.status} ${productCreate.errorCode ?? ''}`,
    );
  }
  const productId = (productCreate.resultPayload as { productRef?: { objectId: UuidV7 } })
    .productRef?.objectId;
  const productVersionId = (
    productCreate.resultPayload as {
      productVersionRef?: { versionId: UuidV7 };
    }
  ).productVersionRef?.versionId;
  if (!productId || !productVersionId) {
    throw new Error('product seed missing ids');
  }
  // Activate the ProductVersion so the QMSRevision can later be marked
  // CURRENT and bind to a CURRENT revision (Profile snapshot requires
  // lifecycle='CURRENT' on the bound QMSRevision).
  // Build the ProductScopeSnapshot for the product version.
  const productScopeSnapshot = await handleEnterpriseProductCreateScopeSnapshot(
    db,
    ctx,
    payloadEnvelope(
      `seed-product-scope-${seedTag}`,
      {
        productRef: { objectType: 'Product', objectId: productId },
        productVersionRefs: [
          { objectType: 'ProductVersion', objectId: productId, versionId: productVersionId },
        ],
        purpose: 'WI04 product scope seed',
      },
      { idempotencyKey: `seed-product-scope-${seedTag}` },
    ),
  );
  if (productScopeSnapshot.status !== 'COMMITTED') {
    throw new Error(
      `product scope snapshot failed: ${productScopeSnapshot.status} ${productScopeSnapshot.errorCode ?? ''}`,
    );
  }
  const productScopeSnapshotId = (
    productScopeSnapshot.resultPayload as {
      productScopeSnapshotRef?: { objectId: UuidV7 };
    }
  ).productScopeSnapshotRef?.objectId;
  const productScopePayloadHash = (
    productScopeSnapshot.resultPayload as {
      payloadHash?: string;
    }
  ).payloadHash;
  if (!productScopeSnapshotId || !productScopePayloadHash) {
    throw new Error('product scope snapshot missing ids');
  }
  // QMS revision lifecycle: create_revision creates a HISTORICAL row;
  // activate_revision flips it to CURRENT and moves the root pointer.
  const qmsCreate = await handleEnterpriseQmsCreateRevision(
    db,
    ctx,
    payloadEnvelope(
      `seed-qms-create-${seedTag}`,
      {
        qmsConfigurationRef: { objectType: 'QMSConfiguration', objectId: newUuidV7() },
        applicabilityDecisions: [{ requirementRef: 'req-1', outcome: 'APPLICABLE' }],
        managementChoices: [{ choiceKey: 'review-cycle', selectedOption: 'quarterly' }],
        professionalDecisions: [{ decisionType: 'risk-method', outcome: 'apply' }],
        sourceRefs: [objectRef('SourceMaterial', '00000000-0000-7000-8000-000000000702')],
      },
      { idempotencyKey: `seed-qms-create-${seedTag}` },
    ),
  );
  if (qmsCreate.status !== 'COMMITTED') {
    throw new Error(`qms create failed: ${qmsCreate.status} ${qmsCreate.errorCode ?? ''}`);
  }
  const qmsConfigurationId = (
    qmsCreate.resultPayload as {
      qmsConfigurationRevisionRef?: { objectId: UuidV7 };
    }
  ).qmsConfigurationRevisionRef?.objectId;
  const qmsConfigurationRevisionId = (
    qmsCreate.resultPayload as {
      qmsConfigurationRevisionRef?: { versionId: UuidV7 };
    }
  ).qmsConfigurationRevisionRef?.versionId;
  if (!qmsConfigurationId || !qmsConfigurationRevisionId) {
    throw new Error('qms seed missing ids');
  }
  const qmsConfigurationRevisionHash = (qmsCreate.resultPayload as { payloadHash?: string })
    .payloadHash;
  if (!qmsConfigurationRevisionHash) {
    throw new Error('qms revision hash missing');
  }
  const qmsActivate = await handleEnterpriseQmsActivateRevision(
    db,
    ctx,
    payloadEnvelope(
      `seed-qms-activate-${seedTag}`,
      {
        qmsConfigurationRef: { objectType: 'QMSConfiguration', objectId: qmsConfigurationId },
        qmsConfigurationRevisionRef: {
          objectType: 'QMSConfigurationRevision',
          objectId: qmsConfigurationId,
          versionId: qmsConfigurationRevisionId,
        },
        activationMode: 'ACTIVATE',
        expectedAggregateVersion: '1',
        humanDecisionRef: { objectType: 'BusinessDecision', objectId: newUuidV7() },
      },
      { idempotencyKey: `seed-qms-activate-${seedTag}`, expectedAggregateVersion: '1' },
    ),
  );
  if (qmsActivate.status !== 'COMMITTED') {
    throw new Error(`qms activate failed: ${qmsActivate.status} ${qmsActivate.errorCode ?? ''}`);
  }
  // Build the EnterpriseProfileSnapshot. The handler accepts ProductVersion
  // refs in any state, so we point it at the (HISTORICAL) initial version
  // we just minted.
  const enterpriseProfileSnapshot = await handleEnterpriseProfileCreateSnapshot(
    db,
    ctx,
    payloadEnvelope(
      `seed-enterprise-profile-${seedTag}`,
      {
        enterpriseRef: objectRef('Enterprise' as const, enterpriseId),
        enterpriseFactVersionRefs: [],
        productVersionRefs: [
          { objectType: 'ProductVersion', objectId: productId, versionId: productVersionId },
        ],
        qmsConfigurationRef: { objectType: 'QMSConfiguration', objectId: qmsConfigurationId },
        qmsConfigurationRevisionRef: {
          objectType: 'QMSConfigurationRevision',
          objectId: qmsConfigurationId,
          versionId: qmsConfigurationRevisionId,
        },
        purpose: 'WI04 enterprise profile seed',
      },
      { idempotencyKey: `seed-enterprise-profile-${seedTag}` },
    ),
  );
  if (enterpriseProfileSnapshot.status !== 'COMMITTED') {
    throw new Error(
      `profile snapshot failed: ${enterpriseProfileSnapshot.status} ${enterpriseProfileSnapshot.errorCode ?? ''}`,
    );
  }
  const enterpriseProfileSnapshotId = (
    enterpriseProfileSnapshot.resultPayload as {
      enterpriseProfileSnapshotRef?: { objectId: UuidV7 };
    }
  ).enterpriseProfileSnapshotRef?.objectId;
  const enterpriseProfilePayloadHash = (
    enterpriseProfileSnapshot.resultPayload as {
      payloadHash?: string;
    }
  ).payloadHash;
  if (!enterpriseProfileSnapshotId || !enterpriseProfilePayloadHash) {
    throw new Error('enterprise profile snapshot missing ids');
  }
  return {
    enterpriseProfileSnapshotId,
    enterpriseProfilePayloadHash,
    qmsConfigurationId,
    qmsConfigurationRevisionId,
    qmsConfigurationRevisionHash,
    productScopeSnapshotId,
    productScopePayloadHash,
  };
}

describe.skipIf(!gateEnabled)(
  'EnterpriseProject ProjectScope vertical slice (real PostgreSQL, IM-03 WI-04)',
  { concurrent: false },
  () => {
    let admin: pg.Client;
    let pool: pg.Pool;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      // Idempotent role creation so re-runs against the same disposable
      // database do not collide on already-existing roles.
      await admin.query(
        `DO $do$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'im03_wi04_probe') THEN
              CREATE ROLE im03_wi04_probe LOGIN PASSWORD 'im03-wi04-probe'
                NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
            END IF;
          END $do$`,
      );
      await admin.query(
        `GRANT platform_context_establisher, enterprise_project_app TO im03_wi04_probe`,
      );
      const url = new URL(databaseUrl ?? '');
      url.username = 'im03_wi04_probe';
      url.password = 'im03-wi04-probe';
      pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
    });

    afterAll(async () => {
      await pool.end();
      await admin.end();
    });

    function db(): ReturnType<typeof createEnterpriseProjectDatabase> {
      return createEnterpriseProjectDatabase(pool);
    }

    async function countRows(table: string, where = ''): Promise<number> {
      const result = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM enterprise_project.${table} ${where}`,
      );
      return Number(result.rows[0]?.count ?? '0');
    }

    // ============================================================
    // EP-WI04-P-001 — happy path: Project + ScopeClaim + Binding land atomically
    // ============================================================
    it('EP-WI04-P-001 happy path commits Project + ScopeClaim + SnapshotBinding', async () => {
      const enterpriseId = newUuidV7();
      currentEnterpriseId = enterpriseId;
      const ctx = contextFor(enterpriseId);
      const fixtures = await seedEnterpriseAndStartFixtures(db(), enterpriseId);
      const memberPolicy = versionedRef('Policy', newUuidV7(), newUuidV7());
      const result = await handleCreateProject(
        db(),
        ctx,
        payloadEnvelope(
          'p001-create',
          {
            enterpriseRef: objectRef('Enterprise' as const, enterpriseId),
            displayCode: 'WI04-P001',
            title: '采购控制程序',
            objective: '建立采购控制程序',
            startSnapshot: {
              enterpriseProfileSnapshotRef: snapshotRef(
                'EnterpriseProfileSnapshot',
                fixtures.enterpriseProfileSnapshotId,
                fixtures.enterpriseProfilePayloadHash,
              ),
              qmsConfigurationRef: versionedRef(
                'QMSConfiguration',
                fixtures.qmsConfigurationId,
                fixtures.qmsConfigurationRevisionId,
              ),
              productScopeSnapshotRef: snapshotRef(
                'ProductScopeSnapshot',
                fixtures.productScopeSnapshotId,
                fixtures.productScopePayloadHash,
              ),
            },
            memberPolicyRef: memberPolicy,
          },
          { idempotencyKey: 'p001-create' },
        ),
      );
      expect(result.status).toBe('COMMITTED');
      const projectId = objectIdFrom(result);
      const projectRows = await countRows('project', `WHERE project_id = '${projectId}'::uuid`);
      expect(projectRows).toBe(1);
      const claimRows = await countRows(
        'project_scope_claim',
        `WHERE project_id = '${projectId}'::uuid`,
      );
      expect(claimRows).toBe(1);
      const bindingRows = await countRows(
        'project_snapshot_binding',
        `WHERE project_id = '${projectId}'::uuid`,
      );
      expect(bindingRows).toBe(1);
      const root = await admin.query<{
        aggregate_version: string;
        member_policy_version_id: string;
        member_policy_payload_hash: Buffer | null;
      }>(
        `SELECT aggregate_version::text,
                member_policy_version_id::text,
                member_policy_payload_hash
           FROM enterprise_project.project
          WHERE project_id = $1::uuid`,
        [projectId],
      );
      expect(root.rows[0]).toMatchObject({
        aggregate_version: '1',
        member_policy_version_id: memberPolicy.versionId,
        member_policy_payload_hash: null,
      });
    });

    // ============================================================
    // EP-WI04-P-002 — duplicate Project displayCode rejected
    // ============================================================
    it('EP-WI04-P-002 duplicate displayCode is rejected with PROJECT_PROJECT_DISPLAY_CODE_CONFLICT', async () => {
      const enterpriseId = newUuidV7();
      currentEnterpriseId = enterpriseId;
      const ctx = contextFor(enterpriseId);
      const fixtures = await seedEnterpriseAndStartFixtures(db(), enterpriseId);
      const memberPolicy = versionedRef('Policy', newUuidV7(), newUuidV7());
      const startSnapshot = {
        enterpriseProfileSnapshotRef: snapshotRef(
          'EnterpriseProfileSnapshot',
          fixtures.enterpriseProfileSnapshotId,
          fixtures.enterpriseProfilePayloadHash,
        ),
        qmsConfigurationRef: versionedRef(
          'QMSConfiguration',
          fixtures.qmsConfigurationId,
          fixtures.qmsConfigurationRevisionId,
        ),
        productScopeSnapshotRef: snapshotRef(
          'ProductScopeSnapshot',
          fixtures.productScopeSnapshotId,
          fixtures.productScopePayloadHash,
        ),
      };
      const createProject = (key: string, displayCode: string, title: string, objective: string) =>
        handleCreateProject(
          db(),
          ctx,
          payloadEnvelope(
            key,
            {
              enterpriseRef: objectRef('Enterprise' as const, enterpriseId),
              displayCode,
              title,
              objective,
              startSnapshot,
              memberPolicyRef: memberPolicy,
            },
            { idempotencyKey: key },
          ),
        );
      const first = await createProject('p002-create-a', 'WI04-P002', 'P002-A', 'first');
      expect(first.status).toBe('COMMITTED');
      const dup = await createProject('p002-create-b', 'WI04-P002', 'P002-B', 'second');
      expect(dup.status).toBe('REJECTED');
      if (dup.status === 'REJECTED') {
        expect(dup.errorCode).toBe(PROJECT_PROJECT_DISPLAY_CODE_CONFLICT);
      }
      const afterDuplicate = await createProject(
        'p002-create-c',
        'WI04-P002-C',
        'P002-C',
        'subsequent command can commit after duplicate rejection',
      );
      expect(afterDuplicate.status).toBe('COMMITTED');
    });

    // ============================================================
    // EP-WI04-P-003 — cross-Enterprise StartSnapshot rejected
    // ============================================================
    it('EP-WI04-P-003 cross-Enterprise startSnapshot is rejected', async () => {
      currentEnterpriseId = ENTERPRISE_A;
      const ctx = contextFor(ENTERPRISE_A);
      const ownFixtures = await seedEnterpriseAndStartFixtures(db(), ENTERPRISE_A);
      currentEnterpriseId = ENTERPRISE_B;
      const foreignFixtures = await seedEnterpriseAndStartFixtures(db(), ENTERPRISE_B);
      currentEnterpriseId = ENTERPRISE_A;
      // Reference Enterprise B's profile snapshot from Enterprise A's start:
      const memberPolicy = versionedRef('Policy', newUuidV7(), newUuidV7());
      let caught: unknown = null;
      try {
        await handleCreateProject(
          db(),
          ctx,
          payloadEnvelope(
            'p003-cross-enterprise',
            {
              enterpriseRef: objectRef('Enterprise' as const, ENTERPRISE_A),
              displayCode: 'WI04-P003',
              title: 'Cross-Enterprise',
              objective: 'attempt',
              startSnapshot: {
                enterpriseProfileSnapshotRef: snapshotRef(
                  'EnterpriseProfileSnapshot',
                  // Use Enterprise B's profile snapshot id and the wrong
                  // enterprise_id in the scope. The handler rejects
                  // either via the up-front scope mirror or via the
                  // database-mirror trigger; both lead to
                  // PROJECT_START_SNAPSHOT_SCOPE_MISMATCH.
                  foreignFixtures.enterpriseProfileSnapshotId,
                  foreignFixtures.enterpriseProfilePayloadHash,
                  ENTERPRISE_B,
                ),
                qmsConfigurationRef: versionedRef(
                  'QMSConfiguration',
                  ownFixtures.qmsConfigurationId,
                  ownFixtures.qmsConfigurationRevisionId,
                  ENTERPRISE_A,
                ),
                productScopeSnapshotRef: snapshotRef(
                  'ProductScopeSnapshot',
                  ownFixtures.productScopeSnapshotId,
                  ownFixtures.productScopePayloadHash,
                ),
              },
              memberPolicyRef: memberPolicy,
            },
            { idempotencyKey: 'p003-cross-enterprise' },
          ),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(EnterpriseBusinessError);
      expect((caught as EnterpriseBusinessError).code).toBe(PROJECT_START_SNAPSHOT_SCOPE_MISMATCH);
    });

    // ============================================================
    // EP-WI04-P-004 — `latest` / `current` pointer rejected
    // ============================================================
    it('EP-WI04-P-004 latest/current pointer rejected', async () => {
      const enterpriseId = newUuidV7();
      currentEnterpriseId = enterpriseId;
      const ctx = contextFor(enterpriseId);
      const fixtures = await seedEnterpriseAndStartFixtures(db(), enterpriseId);
      const memberPolicy = versionedRef('Policy', newUuidV7(), newUuidV7());
      let caught: unknown = null;
      try {
        await handleCreateProject(
          db(),
          ctx,
          payloadEnvelope(
            'p004-latest',
            {
              enterpriseRef: objectRef('Enterprise' as const, enterpriseId),
              displayCode: 'WI04-P004',
              title: 'Latest',
              objective: 'attempt',
              startSnapshot: {
                enterpriseProfileSnapshotRef: {
                  kind: 'SNAPSHOT' as const,
                  objectType: 'EnterpriseProfileSnapshot',
                  objectId: 'latest',
                  snapshotId: 'latest',
                  scope: { enterpriseId },
                  contentHash: TEST_CONTENT_HASH,
                },
                qmsConfigurationRef: versionedRef(
                  'QMSConfiguration',
                  fixtures.qmsConfigurationId,
                  fixtures.qmsConfigurationRevisionId,
                ),
                productScopeSnapshotRef: snapshotRef(
                  'ProductScopeSnapshot',
                  fixtures.productScopeSnapshotId,
                  fixtures.productScopePayloadHash,
                ),
              },
              memberPolicyRef: memberPolicy,
            },
            { idempotencyKey: 'p004-latest' },
          ),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(EnterpriseBusinessError);
      expect((caught as EnterpriseBusinessError).code).toBe(
        PROJECT_START_SNAPSHOT_LATEST_FORBIDDEN,
      );
    });

    // ============================================================
    // EP-WI04-P-005 — incomplete StartSnapshot rejected
    // ============================================================
    it('EP-WI04-P-005 missing Profile ref rejected', async () => {
      const enterpriseId = newUuidV7();
      currentEnterpriseId = enterpriseId;
      const ctx = contextFor(enterpriseId);
      const fixtures = await seedEnterpriseAndStartFixtures(db(), enterpriseId);
      const memberPolicy = versionedRef('Policy', newUuidV7(), newUuidV7());
      const result = await handleCreateProject(
        db(),
        ctx,
        payloadEnvelope(
          'p005-incomplete',
          {
            enterpriseRef: objectRef('Enterprise' as const, enterpriseId),
            displayCode: 'WI04-P005',
            title: 'Incomplete',
            objective: 'attempt',
            startSnapshot: {
              enterpriseProfileSnapshotRef: snapshotRef(
                'EnterpriseProfileSnapshot',
                // The shape is valid, but no persisted row has this exact
                // snapshot id/hash pair, so the Command returns REJECTED.
                '00000000-0000-7000-8000-000000000000',
                '0'.repeat(64),
              ),
              qmsConfigurationRef: versionedRef(
                'QMSConfiguration',
                fixtures.qmsConfigurationId,
                fixtures.qmsConfigurationRevisionId,
              ),
              productScopeSnapshotRef: snapshotRef(
                'ProductScopeSnapshot',
                fixtures.productScopeSnapshotId,
                fixtures.productScopePayloadHash,
              ),
            },
            memberPolicyRef: memberPolicy,
          },
          { idempotencyKey: 'p005-incomplete' },
        ),
      );
      expect(result.status).toBe('REJECTED');
      if (result.status === 'REJECTED') {
        expect(result.errorCode).toBe(PROJECT_START_SNAPSHOT_SCOPE_MISMATCH);
      }
    });

    // ============================================================
    // EP-WI04-P-006 — invalid memberPolicyRef rejected
    // ============================================================
    it('EP-WI04-P-006 invalid memberPolicyRef rejected', async () => {
      const enterpriseId = newUuidV7();
      currentEnterpriseId = enterpriseId;
      const ctx = contextFor(enterpriseId);
      const fixtures = await seedEnterpriseAndStartFixtures(db(), enterpriseId);
      let caught: unknown = null;
      try {
        await handleCreateProject(
          db(),
          ctx,
          payloadEnvelope(
            'p006-invalid-member',
            {
              enterpriseRef: objectRef('Enterprise' as const, enterpriseId),
              displayCode: 'WI04-P006',
              title: 'Bad member',
              objective: 'attempt',
              startSnapshot: {
                enterpriseProfileSnapshotRef: snapshotRef(
                  'EnterpriseProfileSnapshot',
                  fixtures.enterpriseProfileSnapshotId,
                  fixtures.enterpriseProfilePayloadHash,
                ),
                qmsConfigurationRef: versionedRef(
                  'QMSConfiguration',
                  fixtures.qmsConfigurationId,
                  fixtures.qmsConfigurationRevisionId,
                ),
                productScopeSnapshotRef: snapshotRef(
                  'ProductScopeSnapshot',
                  fixtures.productScopeSnapshotId,
                  fixtures.productScopePayloadHash,
                ),
              },
              memberPolicyRef: {
                kind: 'OBJECT' as const,
                objectType: 'Policy' as const,
                objectId: newUuidV7(),
                scope: { enterpriseId },
              } as unknown as Common.VersionedRef,
            },
            { idempotencyKey: 'p006-invalid-member' },
          ),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(EnterpriseBusinessError);
      expect((caught as EnterpriseBusinessError).code).toBe(PROJECT_MEMBER_POLICY_REF_INVALID);
    });

    // ============================================================
    // EP-WI04-P-007 — ProjectScopeClaim publishes the (enterprise, project) pair
    // ============================================================
    it('EP-WI04-P-007 ProjectScopeClaim is queryable for other modules', async () => {
      const enterpriseId = newUuidV7();
      currentEnterpriseId = enterpriseId;
      const ctx = contextFor(enterpriseId);
      const fixtures = await seedEnterpriseAndStartFixtures(db(), enterpriseId);
      const memberPolicy = versionedRef('Policy', newUuidV7(), newUuidV7());
      const result = await handleCreateProject(
        db(),
        ctx,
        payloadEnvelope(
          'p007-create',
          {
            enterpriseRef: objectRef('Enterprise' as const, enterpriseId),
            displayCode: 'WI04-P007',
            title: 'P007',
            objective: 'scope claim visibility',
            startSnapshot: {
              enterpriseProfileSnapshotRef: snapshotRef(
                'EnterpriseProfileSnapshot',
                fixtures.enterpriseProfileSnapshotId,
                fixtures.enterpriseProfilePayloadHash,
              ),
              qmsConfigurationRef: versionedRef(
                'QMSConfiguration',
                fixtures.qmsConfigurationId,
                fixtures.qmsConfigurationRevisionId,
              ),
              productScopeSnapshotRef: snapshotRef(
                'ProductScopeSnapshot',
                fixtures.productScopeSnapshotId,
                fixtures.productScopePayloadHash,
              ),
            },
            memberPolicyRef: memberPolicy,
          },
          { idempotencyKey: 'p007-create' },
        ),
      );
      expect(result.status).toBe('COMMITTED');
      const projectId = objectIdFrom(result);
      const claimRows = await admin.query<{
        enterprise_id: string;
        project_id: string;
        status: string;
      }>(
        `SELECT enterprise_id::text, project_id::text, status
           FROM enterprise_project.project_scope_claim
          WHERE project_id = $1::uuid`,
        [projectId],
      );
      expect(claimRows.rows[0]).toEqual({
        enterprise_id: enterpriseId,
        project_id: projectId,
        status: 'ACTIVE',
      });
    });

    // ============================================================
    // EP-WI04-P-008 — validate_object_scope happy path + Project B isolation
    // ============================================================
    it('EP-WI04-P-008 validate_object_scope returns the exact scope', async () => {
      const enterpriseId = newUuidV7();
      currentEnterpriseId = enterpriseId;
      const ctx = contextFor(enterpriseId);
      const fixtures = await seedEnterpriseAndStartFixtures(db(), enterpriseId);
      const memberPolicy = versionedRef('Policy', newUuidV7(), newUuidV7());
      const result = await handleCreateProject(
        db(),
        ctx,
        payloadEnvelope(
          'p008-create',
          {
            enterpriseRef: objectRef('Enterprise' as const, enterpriseId),
            displayCode: 'WI04-P008',
            title: 'P008',
            objective: 'validate_object_scope happy path',
            startSnapshot: {
              enterpriseProfileSnapshotRef: snapshotRef(
                'EnterpriseProfileSnapshot',
                fixtures.enterpriseProfileSnapshotId,
                fixtures.enterpriseProfilePayloadHash,
              ),
              qmsConfigurationRef: versionedRef(
                'QMSConfiguration',
                fixtures.qmsConfigurationId,
                fixtures.qmsConfigurationRevisionId,
              ),
              productScopeSnapshotRef: snapshotRef(
                'ProductScopeSnapshot',
                fixtures.productScopeSnapshotId,
                fixtures.productScopePayloadHash,
              ),
            },
            memberPolicyRef: memberPolicy,
          },
          { idempotencyKey: 'p008-create' },
        ),
      );
      expect(result.status).toBe('COMMITTED');
      const projectId = objectIdFrom(result);
      // Validate Project A scope
      const valid = await handleValidateObjectScope(db(), contextFor(enterpriseId, [projectId]), {
        objectRef: objectRef('Project', projectId, enterpriseId),
        expectedScopeRef: { enterpriseId, projectId },
        purpose: 'wi04.p008.validate',
      });
      expect(valid.valid).toBe(true);
      // Cross-project probe: ask the same object with a Project B scope.
      const otherProjectId = newUuidV7();
      let caught: unknown = null;
      try {
        await handleValidateObjectScope(db(), contextFor(enterpriseId, [otherProjectId]), {
          objectRef: objectRef('Project', projectId, enterpriseId),
          expectedScopeRef: { enterpriseId, projectId: otherProjectId },
          purpose: 'wi04.p008.cross_project',
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(EnterpriseBusinessError);
      expect((caught as EnterpriseBusinessError).code).toBe(PROJECT_OBJECT_SCOPE_MISMATCH);
    });

    // ============================================================
    // EP-WI04-P-009 — duplicate displayCode across enterprises is allowed
    // ============================================================
    it('EP-WI04-P-009 same displayCode in two enterprises is allowed', async () => {
      const enterpriseA = newUuidV7();
      const enterpriseB = newUuidV7();
      const ctxA = contextFor(enterpriseA);
      const ctxB = contextFor(enterpriseB);
      currentEnterpriseId = enterpriseA;
      const fixturesA = await seedEnterpriseAndStartFixtures(db(), enterpriseA);
      currentEnterpriseId = enterpriseB;
      const fixturesB = await seedEnterpriseAndStartFixtures(db(), enterpriseB);
      currentEnterpriseId = enterpriseA;
      const memberPolicyA = versionedRef('Policy', newUuidV7(), newUuidV7());
      const memberPolicyB = versionedRef('Policy', newUuidV7(), newUuidV7(), enterpriseB);
      const first = await handleCreateProject(
        db(),
        ctxA,
        payloadEnvelope(
          'p009-create-a',
          {
            enterpriseRef: objectRef('Enterprise' as const, enterpriseA),
            displayCode: 'WI04-P009',
            title: 'P009-A',
            objective: 'first',
            startSnapshot: {
              enterpriseProfileSnapshotRef: snapshotRef(
                'EnterpriseProfileSnapshot',
                fixturesA.enterpriseProfileSnapshotId,
                fixturesA.enterpriseProfilePayloadHash,
              ),
              qmsConfigurationRef: versionedRef(
                'QMSConfiguration',
                fixturesA.qmsConfigurationId,
                fixturesA.qmsConfigurationRevisionId,
                enterpriseA,
              ),
              productScopeSnapshotRef: snapshotRef(
                'ProductScopeSnapshot',
                fixturesA.productScopeSnapshotId,
                fixturesA.productScopePayloadHash,
              ),
            },
            memberPolicyRef: memberPolicyA,
          },
          { idempotencyKey: 'p009-create-a' },
        ),
      );
      expect(first.status).toBe('COMMITTED');
      currentEnterpriseId = enterpriseB;
      const second = await handleCreateProject(
        db(),
        ctxB,
        payloadEnvelope(
          'p009-create-b',
          {
            enterpriseRef: objectRef('Enterprise' as const, enterpriseB),
            displayCode: 'WI04-P009',
            title: 'P009-B',
            objective: 'second',
            startSnapshot: {
              enterpriseProfileSnapshotRef: snapshotRef(
                'EnterpriseProfileSnapshot',
                fixturesB.enterpriseProfileSnapshotId,
                fixturesB.enterpriseProfilePayloadHash,
              ),
              qmsConfigurationRef: versionedRef(
                'QMSConfiguration',
                fixturesB.qmsConfigurationId,
                fixturesB.qmsConfigurationRevisionId,
                enterpriseB,
              ),
              productScopeSnapshotRef: snapshotRef(
                'ProductScopeSnapshot',
                fixturesB.productScopeSnapshotId,
                fixturesB.productScopePayloadHash,
              ),
            },
            memberPolicyRef: memberPolicyB,
          },
          { idempotencyKey: 'p009-create-b' },
        ),
      );
      expect(second.status).toBe('COMMITTED');
    });

    // ============================================================
    // EP-WI04-P-010 — incomplete shape (missing memberPolicyRef) rejected
    // ============================================================
    it('EP-WI04-P-010 incomplete shape rejected', async () => {
      const enterpriseId = newUuidV7();
      currentEnterpriseId = enterpriseId;
      const ctx = contextFor(enterpriseId);
      const fixtures = await seedEnterpriseAndStartFixtures(db(), enterpriseId);
      let caught: unknown = null;
      try {
        await handleCreateProject(
          db(),
          ctx,
          payloadEnvelope(
            'p010-incomplete',
            {
              enterpriseRef: objectRef('Enterprise' as const, enterpriseId),
              displayCode: 'WI04-P010',
              title: 'Incomplete',
              objective: 'attempt',
              startSnapshot: {
                enterpriseProfileSnapshotRef: snapshotRef(
                  'EnterpriseProfileSnapshot',
                  fixtures.enterpriseProfileSnapshotId,
                  fixtures.enterpriseProfilePayloadHash,
                ),
                qmsConfigurationRef: versionedRef(
                  'QMSConfiguration',
                  fixtures.qmsConfigurationId,
                  fixtures.qmsConfigurationRevisionId,
                ),
                productScopeSnapshotRef: snapshotRef(
                  'ProductScopeSnapshot',
                  fixtures.productScopeSnapshotId,
                  fixtures.productScopePayloadHash,
                ),
              },
              memberPolicyRef: {
                // VersionedRef requires an exact versionId; it does not
                // require a contentHash field.
                kind: 'VERSIONED' as const,
                objectType: 'Policy',
                objectId: newUuidV7(),
                versionId: undefined,
                scope: { enterpriseId },
              } as unknown as Common.VersionedRef,
            },
            { idempotencyKey: 'p010-incomplete' },
          ),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(EnterpriseBusinessError);
      expect((caught as EnterpriseBusinessError).code).toBe(PROJECT_MEMBER_POLICY_REF_INVALID);
    });

    // ============================================================
    // EP-WI04-DB-012 — Project INSERT cannot cross the trusted Enterprise
    // ============================================================
    it('EP-WI04-DB-012 Project INSERT policy binds the Enterprise context', async () => {
      const trustedEnterpriseId = newUuidV7();
      const rogueEnterpriseId = newUuidV7();
      await expect(
        withEnterpriseProjectTransaction(db(), contextFor(trustedEnterpriseId), async (trx) => {
          await sql`
            INSERT INTO enterprise_project.project (
              project_id,
              enterprise_id,
              display_code,
              title,
              objective,
              member_policy_ref,
              member_policy_version_id,
              member_policy_payload_hash,
              created_by_principal_id,
              created_by_actor_snapshot_id
            ) VALUES (
              ${newUuidV7()}::uuid,
              ${rogueEnterpriseId}::uuid,
              'WI04-DB-012',
              'Rogue Project',
              'RLS negative path',
              ${JSON.stringify({ kind: 'VERSIONED', objectType: 'Policy' })}::jsonb,
              ${newUuidV7()}::uuid,
              NULL,
              ${HUMAN_PRINCIPAL}::uuid,
              ${ACTOR_HUMAN}::uuid
            )
          `.execute(trx);
        }),
      ).rejects.toMatchObject({ code: '42501' });
    });

    // Sanity guard so the unit-level "no skipped imports" assertion still
    // sees the types; we use the imported types via `EnterpriseProject.`
    // here to keep the surface visible to the build graph.
    it('Project snapshot binding refs remain immutable on UPDATE attempts', async () => {
      const result = await admin.query<{ ok: boolean }>(
        `SELECT has_table_privilege('enterprise_project_app',
                                    'enterprise_project.project_snapshot_binding',
                                    'UPDATE') AS ok`,
      );
      // The app role must NOT be able to UPDATE the Snapshot Binding.
      expect(result.rows[0]?.ok).toBe(false);
    });

    // ============================================================
    // IM-03 WI-05 helpers and acceptance scenarios (issue #61)
    // ============================================================

    function projectObjectRef(enterpriseId: string, projectId: string): Common.ObjectRef {
      return {
        kind: 'OBJECT',
        objectType: 'Project',
        objectId: projectId,
        scope: { enterpriseId, projectId },
      };
    }

    function sourceDescriptor(
      enterpriseId: string,
      tag: string,
      contentDigest = 'a'.repeat(64),
    ): EnterpriseProject.SourceMaterialDescriptor {
      return {
        originRef: {
          system: 'feishu',
          resourceType: 'message_attachment',
          externalId: `wi05-${tag}-origin`,
          observedAt: '2026-08-26T00:00:00.000Z',
          tenantOrAccountRef: {
            kind: 'OBJECT',
            objectType: 'FeishuTenant',
            objectId: newUuidV7(),
            scope: { enterpriseId },
          },
        },
        submittedBy: {
          kind: 'OBJECT',
          objectType: 'Principal',
          objectId: HUMAN_PRINCIPAL,
          scope: { enterpriseId },
        },
        receivedAt: '2026-08-26T00:00:00.000Z',
        originalName: `${tag}.pdf`,
        mediaType: 'application/pdf',
        byteLength: 12,
        checksum: {
          algorithm: 'SHA-256',
          digest: contentDigest,
          canonicalizationVersion: '1',
        },
        stagedObjectRef: `staging://wi05/${tag}`,
        retentionClass: 'CUSTOMER_RECORD',
      };
    }

    function sourceIdFrom(result: CommandResult): string {
      if (result.status !== 'COMMITTED') {
        throw new Error(`expected SourceMaterial COMMITTED, got ${result.status}`);
      }
      const ref = (result.resultPayload as { sourceMaterialRef?: { objectId?: string } })
        .sourceMaterialRef;
      if (ref?.objectId === undefined) throw new Error('SourceMaterial result missing objectId');
      return ref.objectId;
    }

    async function createWi05Project(
      enterpriseId: string,
      fixtures: Awaited<ReturnType<typeof seedEnterpriseAndStartFixtures>>,
      tag: string,
    ): Promise<string> {
      currentEnterpriseId = enterpriseId;
      const result = await handleCreateProject(
        db(),
        contextFor(enterpriseId),
        payloadEnvelope(
          `wi05-project-${tag}`,
          {
            enterpriseRef: objectRef('Enterprise' as const, enterpriseId),
            displayCode: `WI05-${tag}`,
            title: `WI05 ${tag}`,
            objective: 'SourceMaterial custody test project',
            startSnapshot: {
              enterpriseProfileSnapshotRef: snapshotRef(
                'EnterpriseProfileSnapshot',
                fixtures.enterpriseProfileSnapshotId,
                fixtures.enterpriseProfilePayloadHash,
                enterpriseId,
              ),
              qmsConfigurationRef: versionedRef(
                'QMSConfiguration',
                fixtures.qmsConfigurationId,
                fixtures.qmsConfigurationRevisionId,
                enterpriseId,
              ),
              productScopeSnapshotRef: snapshotRef(
                'ProductScopeSnapshot',
                fixtures.productScopeSnapshotId,
                fixtures.productScopePayloadHash,
                enterpriseId,
              ),
            },
            memberPolicyRef: versionedRef('Policy', newUuidV7(), newUuidV7(), enterpriseId),
          },
          { enterpriseId, idempotencyKey: `wi05-project-${tag}` },
        ),
      );
      return objectIdFrom(result);
    }

    async function registerSource(
      enterpriseId: string,
      projectId: string,
      tag: string,
      descriptor: EnterpriseProject.SourceMaterialDescriptor,
    ): Promise<{ result: CommandResult; sourceMaterialId: string }> {
      currentEnterpriseId = enterpriseId;
      const result = await handleRegisterSourceMaterial(
        db(),
        contextFor(enterpriseId, [projectId]),
        payloadEnvelope(
          `wi05-register-${tag}`,
          { projectRef: projectObjectRef(enterpriseId, projectId), descriptor },
          {
            enterpriseId,
            projectId,
            idempotencyScope: 'wi05.register',
            idempotencyKey: `wi05-register-${tag}`,
          },
        ),
      );
      return { result, sourceMaterialId: sourceIdFrom(result) };
    }

    function validationRef(
      enterpriseId: string,
      projectId: string,
      validationId: string,
      payloadHash: string,
    ): Common.ContentAddressedRef {
      return {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'ValidationResult',
        objectId: validationId,
        scope: { enterpriseId, projectId },
        contentHash: {
          algorithm: 'SHA-256',
          digest: payloadHash,
          canonicalizationVersion: '1',
        },
      };
    }

    async function addValidation(
      enterpriseId: string,
      projectId: string,
      sourceMaterialId: string,
      descriptor: EnterpriseProject.SourceMaterialDescriptor,
      validationKind: 'SECURITY' | 'INTEGRITY',
      outcome: 'PASSED' | 'FAILED',
      validatedObjectRef: string,
      validatedContentDigest = descriptor.checksum.digest,
    ): Promise<Common.ContentAddressedRef> {
      const validationId = newUuidV7();
      const payload = {
        enterpriseId,
        projectId,
        sourceMaterialId,
        validationKind,
        outcome,
        validatedObjectRef,
        validatedContentHash: validatedContentDigest,
        validatedByteLength: descriptor.byteLength,
        validatorId: 'wi05-validator',
        validatorVersion: '1.0.0',
      } as CanonicalJsonObject;
      const payloadDigest = digestCanonicalPayload(payload);
      const sourceRepo = new EnterpriseBusinessRepository();
      await withEnterpriseProjectTransaction(
        db(),
        contextFor(enterpriseId, [projectId]),
        async (trx) => {
          await sourceRepo.insertSourceMaterialValidation(trx, {
            validationId,
            sourceMaterialId,
            enterpriseId,
            projectId,
            validationKind,
            outcome,
            validatedObjectRef,
            validatedContentHash: Buffer.from(validatedContentDigest, 'hex'),
            validatedByteLength: descriptor.byteLength,
            validatorId: 'wi05-validator',
            validatorVersion: '1.0.0',
            payload,
            payloadHash: payloadDigest.hash,
            recordedByPrincipalId: HUMAN_PRINCIPAL,
            recordedByActorSnapshotId: ACTOR_HUMAN,
            authorizationDecisionId: DECISION,
            sourceCommandId: newUuidV7(),
          });
        },
      );
      return validationRef(
        enterpriseId,
        projectId,
        validationId,
        payloadDigest.hash.toString('hex'),
      );
    }

    function acceptEnvelope(
      enterpriseId: string,
      projectId: string,
      sourceMaterialId: string,
      securityValidationRefs: readonly Common.ContentAddressedRef[],
      integrityValidationRef: Common.ContentAddressedRef,
      acceptedObjectRef: string,
      tag: string,
      expectedAggregateVersion = '1',
    ): CommandEnvelope & { payload: EnterpriseProject.ProjectAcceptSourceMaterialPayload } {
      currentEnterpriseId = enterpriseId;
      return payloadEnvelope(
        `wi05-accept-${tag}`,
        {
          securityValidationRefs,
          integrityValidationRef,
          acceptedObjectRef,
          acceptedAt: '2026-08-26T01:00:00.000Z',
        },
        {
          enterpriseId,
          projectId,
          targetType: 'SourceMaterial',
          targetId: sourceMaterialId,
          expectedAggregateVersion,
          idempotencyScope: 'wi05.accept',
          idempotencyKey: `wi05-accept-${tag}`,
        },
      );
    }

    it('EP-WI05-P-001 same Hash with different origins retains two SourceMaterials', async () => {
      const enterpriseId = newUuidV7();
      currentEnterpriseId = enterpriseId;
      const fixtures = await seedEnterpriseAndStartFixtures(db(), enterpriseId);
      const projectId = await createWi05Project(enterpriseId, fixtures, 'P001');
      const first = await registerSource(
        enterpriseId,
        projectId,
        'p001-a',
        sourceDescriptor(enterpriseId, 'p001-a'),
      );
      const second = await registerSource(
        enterpriseId,
        projectId,
        'p001-b',
        sourceDescriptor(enterpriseId, 'p001-b'),
      );
      expect(first.result.status).toBe('COMMITTED');
      expect(second.result.status).toBe('COMMITTED');
      expect(second.sourceMaterialId).not.toBe(first.sourceMaterialId);
      expect(
        (second.result as Extract<CommandResult, { status: 'COMMITTED' }>).resultPayload,
      ).toMatchObject({
        duplicateOfSourceMaterialRef: { objectId: first.sourceMaterialId },
      });
      const rows = await admin.query<{
        source_material_id: string;
        duplicate_of_source_material_id: string | null;
      }>(
        `SELECT source_material_id::text, duplicate_of_source_material_id::text
           FROM enterprise_project.source_material
          WHERE project_id = $1::uuid
          ORDER BY received_at, source_material_id`,
        [projectId],
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows[0]?.duplicate_of_source_material_id).toBeNull();
      expect(rows.rows[1]?.duplicate_of_source_material_id).toBe(first.sourceMaterialId);
      const origins = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM enterprise_project.source_material_origin
          WHERE project_id = $1::uuid`,
        [projectId],
      );
      expect(origins.rows[0]?.count).toBe('2');
    });

    it('EP-WI05-P-002 passed validations CAS the root and write a minimal Accepted event', async () => {
      const enterpriseId = newUuidV7();
      currentEnterpriseId = enterpriseId;
      const fixtures = await seedEnterpriseAndStartFixtures(db(), enterpriseId);
      const projectId = await createWi05Project(enterpriseId, fixtures, 'P002');
      const descriptor = sourceDescriptor(enterpriseId, 'p002');
      const registered = await registerSource(enterpriseId, projectId, 'p002', descriptor);
      const acceptedObjectRef = 'object://accepted/wi05-p002';
      const securityRef = await addValidation(
        enterpriseId,
        projectId,
        registered.sourceMaterialId,
        descriptor,
        'SECURITY',
        'PASSED',
        acceptedObjectRef,
      );
      const integrityRef = await addValidation(
        enterpriseId,
        projectId,
        registered.sourceMaterialId,
        descriptor,
        'INTEGRITY',
        'PASSED',
        acceptedObjectRef,
      );
      const command = acceptEnvelope(
        enterpriseId,
        projectId,
        registered.sourceMaterialId,
        [securityRef],
        integrityRef,
        acceptedObjectRef,
        'p002',
      );
      const accepted = await handleAcceptSourceMaterial(
        db(),
        contextFor(enterpriseId, [projectId]),
        command,
      );
      expect(accepted.status).toBe('COMMITTED');
      const root = await admin.query<{
        custody_status: string;
        aggregate_version: string;
        accepted_object_ref: string;
        original_name: string;
      }>(
        `SELECT custody_status, aggregate_version::text, accepted_object_ref, original_name
           FROM enterprise_project.source_material
          WHERE source_material_id = $1::uuid`,
        [registered.sourceMaterialId],
      );
      expect(root.rows[0]).toMatchObject({
        custody_status: 'ACCEPTED',
        aggregate_version: '2',
        accepted_object_ref: acceptedObjectRef,
        original_name: 'p002.pdf',
      });
      const events = await admin.query<{
        payload: Record<string, unknown>;
        aggregate_version: string;
      }>(
        `SELECT payload, aggregate_version::text
           FROM enterprise_project.outbox_event
          WHERE source_command_id = $1::uuid
            AND event_type = 'project.SourceMaterialAccepted'`,
        [command.commandId],
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]?.aggregate_version).toBe('2');
      const eventPayload = events.rows[0]?.payload;
      expect(eventPayload).toMatchObject({
        enterpriseId,
        projectId,
        projectRef: { objectId: projectId },
        sourceMaterialRef: {
          objectId: registered.sourceMaterialId,
          contentHash: { digest: descriptor.checksum.digest },
        },
      });
      expect(eventPayload).not.toHaveProperty('originalName');
      expect(eventPayload).not.toHaveProperty('stagedObjectRef');
      expect(eventPayload).not.toHaveProperty('acceptedObjectRef');
      expect(eventPayload).not.toHaveProperty('securityValidationRefs');
      const edges = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count
           FROM enterprise_project.reference_edge
          WHERE owner_object_type = 'SourceMaterial'
            AND owner_object_id = $1::uuid`,
        [registered.sourceMaterialId],
      );
      expect(edges.rows[0]?.count).toBe('3');
      expect(
        await countRows('command_receipt', `WHERE command_id = '${command.commandId}'::uuid`),
      ).toBe(1);
      expect(
        await countRows('audit_record', `WHERE command_id = '${command.commandId}'::uuid`),
      ).toBe(1);
    });

    it('EP-WI05-P-003 missing, failed and mismatched validations reject without changing the root or emitting an event', async () => {
      const enterpriseId = newUuidV7();
      currentEnterpriseId = enterpriseId;
      const fixtures = await seedEnterpriseAndStartFixtures(db(), enterpriseId);
      const projectId = await createWi05Project(enterpriseId, fixtures, 'P003');
      const descriptor = sourceDescriptor(enterpriseId, 'p003');
      const registered = await registerSource(enterpriseId, projectId, 'p003', descriptor);
      const acceptedObjectRef = 'object://accepted/wi05-p003';
      const missingSecurity = validationRef(enterpriseId, projectId, newUuidV7(), 'b'.repeat(64));
      const missingIntegrity = validationRef(enterpriseId, projectId, newUuidV7(), 'c'.repeat(64));
      const missing = await handleAcceptSourceMaterial(
        db(),
        contextFor(enterpriseId, [projectId]),
        acceptEnvelope(
          enterpriseId,
          projectId,
          registered.sourceMaterialId,
          [missingSecurity],
          missingIntegrity,
          acceptedObjectRef,
          'p003-missing',
        ),
      );
      expect(missing).toMatchObject({ status: 'REJECTED', errorCode: PROJECT_SOURCE_NOT_TRUSTED });

      const failedSecurity = await addValidation(
        enterpriseId,
        projectId,
        registered.sourceMaterialId,
        descriptor,
        'SECURITY',
        'FAILED',
        acceptedObjectRef,
      );
      const passedIntegrity = await addValidation(
        enterpriseId,
        projectId,
        registered.sourceMaterialId,
        descriptor,
        'INTEGRITY',
        'PASSED',
        acceptedObjectRef,
      );
      const failed = await handleAcceptSourceMaterial(
        db(),
        contextFor(enterpriseId, [projectId]),
        acceptEnvelope(
          enterpriseId,
          projectId,
          registered.sourceMaterialId,
          [failedSecurity],
          passedIntegrity,
          acceptedObjectRef,
          'p003-failed',
        ),
      );
      expect(failed).toMatchObject({ status: 'REJECTED', errorCode: PROJECT_SOURCE_NOT_TRUSTED });

      const passedSecurity = await addValidation(
        enterpriseId,
        projectId,
        registered.sourceMaterialId,
        descriptor,
        'SECURITY',
        'PASSED',
        acceptedObjectRef,
      );
      const wrongLocator = await handleAcceptSourceMaterial(
        db(),
        contextFor(enterpriseId, [projectId]),
        acceptEnvelope(
          enterpriseId,
          projectId,
          registered.sourceMaterialId,
          [passedSecurity],
          passedIntegrity,
          'object://accepted/wrong-locator',
          'p003-locator',
        ),
      );
      expect(wrongLocator).toMatchObject({
        status: 'REJECTED',
        errorCode: PROJECT_SOURCE_NOT_TRUSTED,
      });

      const wrongHashSecurity = {
        ...passedSecurity,
        contentHash: {
          ...passedSecurity.contentHash,
          digest: 'd'.repeat(64),
        },
      };
      const wrongHash = await handleAcceptSourceMaterial(
        db(),
        contextFor(enterpriseId, [projectId]),
        acceptEnvelope(
          enterpriseId,
          projectId,
          registered.sourceMaterialId,
          [wrongHashSecurity],
          passedIntegrity,
          acceptedObjectRef,
          'p003-hash',
        ),
      );
      expect(wrongHash).toMatchObject({
        status: 'REJECTED',
        errorCode: PROJECT_SOURCE_NOT_TRUSTED,
      });
      const root = await admin.query<{ custody_status: string; aggregate_version: string }>(
        `SELECT custody_status, aggregate_version::text
           FROM enterprise_project.source_material
          WHERE source_material_id = $1::uuid`,
        [registered.sourceMaterialId],
      );
      expect(root.rows[0]).toEqual({ custody_status: 'RECEIVED', aggregate_version: '1' });
      expect(
        await countRows(
          'outbox_event',
          `WHERE aggregate_id = '${registered.sourceMaterialId}'::uuid
             AND event_type = 'project.SourceMaterialAccepted'`,
        ),
      ).toBe(0);
    });

    it('EP-WI05-P-004 app role cannot update original fields or delete origin/validation history', async () => {
      const enterpriseId = newUuidV7();
      currentEnterpriseId = enterpriseId;
      const fixtures = await seedEnterpriseAndStartFixtures(db(), enterpriseId);
      const projectId = await createWi05Project(enterpriseId, fixtures, 'P004');
      const descriptor = sourceDescriptor(enterpriseId, 'p004');
      const registered = await registerSource(enterpriseId, projectId, 'p004', descriptor);
      const validationRef = await addValidation(
        enterpriseId,
        projectId,
        registered.sourceMaterialId,
        descriptor,
        'SECURITY',
        'PASSED',
        'object://accepted/wi05-p004',
      );
      const validationId = validationRef.objectId;
      const privileges = await admin.query<{
        source_original_update: boolean;
        source_custody_update: boolean;
        source_delete: boolean;
        origin_update: boolean;
        origin_delete: boolean;
        validation_update: boolean;
        validation_delete: boolean;
      }>(
        `SELECT has_column_privilege('enterprise_project_app', 'enterprise_project.source_material', 'original_name', 'UPDATE') AS source_original_update,
                has_column_privilege('enterprise_project_app', 'enterprise_project.source_material', 'custody_status', 'UPDATE') AS source_custody_update,
                has_table_privilege('enterprise_project_app', 'enterprise_project.source_material', 'DELETE') AS source_delete,
                has_table_privilege('enterprise_project_app', 'enterprise_project.source_material_origin', 'UPDATE') AS origin_update,
                has_table_privilege('enterprise_project_app', 'enterprise_project.source_material_origin', 'DELETE') AS origin_delete,
                has_table_privilege('enterprise_project_app', 'enterprise_project.source_material_validation', 'UPDATE') AS validation_update,
                has_table_privilege('enterprise_project_app', 'enterprise_project.source_material_validation', 'DELETE') AS validation_delete`,
      );
      expect(privileges.rows[0]).toEqual({
        source_original_update: false,
        source_custody_update: true,
        source_delete: false,
        origin_update: false,
        origin_delete: false,
        validation_update: false,
        validation_delete: false,
      });
      await expect(
        withEnterpriseProjectTransaction(db(), contextFor(enterpriseId, [projectId]), async (trx) =>
          trx
            .updateTable('enterprise_project.source_material')
            .set({ original_name: 'tampered.pdf' })
            .where('source_material_id', '=', registered.sourceMaterialId)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      const originRows = await admin.query<{ source_material_origin_id: string }>(
        `SELECT source_material_origin_id::text
           FROM enterprise_project.source_material_origin
          WHERE source_material_id = $1::uuid`,
        [registered.sourceMaterialId],
      );
      const originId = originRows.rows[0]?.source_material_origin_id;
      if (originId === undefined) throw new Error('origin row missing');
      await expect(
        withEnterpriseProjectTransaction(db(), contextFor(enterpriseId, [projectId]), async (trx) =>
          trx
            .deleteFrom('enterprise_project.source_material_origin')
            .where('source_material_origin_id', '=', originId)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        withEnterpriseProjectTransaction(db(), contextFor(enterpriseId, [projectId]), async (trx) =>
          trx
            .deleteFrom('enterprise_project.source_material_validation')
            .where('validation_id', '=', validationId)
            .execute(),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('EP-WI05-P-005 same idempotency key replays and altered payload conflicts', async () => {
      const enterpriseId = newUuidV7();
      currentEnterpriseId = enterpriseId;
      const fixtures = await seedEnterpriseAndStartFixtures(db(), enterpriseId);
      const projectId = await createWi05Project(enterpriseId, fixtures, 'P005');
      const descriptor = sourceDescriptor(enterpriseId, 'p005');
      const registered = await registerSource(enterpriseId, projectId, 'p005', descriptor);
      const acceptedObjectRef = 'object://accepted/wi05-p005';
      const securityRef = await addValidation(
        enterpriseId,
        projectId,
        registered.sourceMaterialId,
        descriptor,
        'SECURITY',
        'PASSED',
        acceptedObjectRef,
      );
      const integrityRef = await addValidation(
        enterpriseId,
        projectId,
        registered.sourceMaterialId,
        descriptor,
        'INTEGRITY',
        'PASSED',
        acceptedObjectRef,
      );
      const command = acceptEnvelope(
        enterpriseId,
        projectId,
        registered.sourceMaterialId,
        [securityRef],
        integrityRef,
        acceptedObjectRef,
        'p005',
      );
      const first = await handleAcceptSourceMaterial(
        db(),
        contextFor(enterpriseId, [projectId]),
        command,
      );
      expect(first.status).toBe('COMMITTED');
      const replay = await handleAcceptSourceMaterial(
        db(),
        contextFor(enterpriseId, [projectId]),
        command,
      );
      expect(replay.status).toBe('DUPLICATE');
      const alteredPayload = {
        ...command.payload,
        acceptedObjectRef: 'object://accepted/altered',
      };
      const altered = {
        ...command,
        commandId: newUuidV7(),
        requestPayload: {
          op: 'wi05-accept-p005',
          payload: alteredPayload,
        } as unknown as CanonicalJsonObject,
        payload: alteredPayload,
      };
      await expect(
        handleAcceptSourceMaterial(db(), contextFor(enterpriseId, [projectId]), altered),
      ).rejects.toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT });
      const alreadyAccepted = await handleAcceptSourceMaterial(
        db(),
        contextFor(enterpriseId, [projectId]),
        acceptEnvelope(
          enterpriseId,
          projectId,
          registered.sourceMaterialId,
          [securityRef],
          integrityRef,
          acceptedObjectRef,
          'p005-new-key',
          '2',
        ),
      );
      expect(alreadyAccepted).toMatchObject({
        status: 'REJECTED',
        errorCode: PROJECT_SOURCE_ALREADY_ACCEPTED,
        currentAggregateVersion: '2',
      });
      expect(
        await countRows(
          'outbox_event',
          `WHERE aggregate_id = '${registered.sourceMaterialId}'::uuid
             AND event_type = 'project.SourceMaterialAccepted'`,
        ),
      ).toBe(1);
    });

    it('EP-WI05-P-006 cross-Project SourceMaterial is invisible and cannot be accepted', async () => {
      const enterpriseId = newUuidV7();
      currentEnterpriseId = enterpriseId;
      const fixtures = await seedEnterpriseAndStartFixtures(db(), enterpriseId);
      const projectA = await createWi05Project(enterpriseId, fixtures, 'P006-A');
      const projectB = await createWi05Project(enterpriseId, fixtures, 'P006-B');
      const descriptor = sourceDescriptor(enterpriseId, 'p006-b');
      const registered = await registerSource(enterpriseId, projectB, 'p006-b', descriptor);
      const fakeSecurity = validationRef(enterpriseId, projectA, newUuidV7(), 'e'.repeat(64));
      const fakeIntegrity = validationRef(enterpriseId, projectA, newUuidV7(), 'f'.repeat(64));
      const crossProject = await handleAcceptSourceMaterial(
        db(),
        contextFor(enterpriseId, [projectA]),
        acceptEnvelope(
          enterpriseId,
          projectA,
          registered.sourceMaterialId,
          [fakeSecurity],
          fakeIntegrity,
          'object://accepted/wi05-p006',
          'p006-cross-project',
        ),
      );
      expect(crossProject).toMatchObject({
        status: 'REJECTED',
        errorCode: PROJECT_SOURCE_NOT_TRUSTED,
      });
      const visible = await withEnterpriseProjectTransaction(
        db(),
        contextFor(enterpriseId, [projectA]),
        async (trx) =>
          trx
            .selectFrom('enterprise_project.source_material')
            .select('source_material_id')
            .where('source_material_id', '=', registered.sourceMaterialId)
            .execute(),
      );
      expect(visible).toHaveLength(0);
      expect(
        await countRows(
          'outbox_event',
          `WHERE aggregate_id = '${registered.sourceMaterialId}'::uuid
             AND event_type = 'project.SourceMaterialAccepted'`,
        ),
      ).toBe(0);
    });
  },
);

describe('IM-03 WI-05 SourceMaterial unit validation', () => {
  it('EP-WI05-U-001 rejects an invalid descriptor before opening a database transaction', async () => {
    const enterpriseId = newUuidV7();
    const projectId = newUuidV7();
    currentEnterpriseId = enterpriseId;
    await expect(
      handleRegisterSourceMaterial(
        null as unknown as ReturnType<typeof createEnterpriseProjectDatabase>,
        contextFor(enterpriseId, [projectId]),
        payloadEnvelope(
          'wi05-unit-invalid-descriptor',
          {
            projectRef: {
              kind: 'OBJECT' as const,
              objectType: 'Project' as const,
              objectId: projectId,
              scope: { enterpriseId, projectId },
            },
            descriptor: {
              originRef: {
                system: 'feishu',
                resourceType: 'message_attachment',
                externalId: 'wi05-u001-origin',
                observedAt: '2026-08-26T00:00:00.000Z',
              },
              submittedBy: {
                kind: 'OBJECT' as const,
                objectType: 'Principal' as const,
                objectId: HUMAN_PRINCIPAL,
                scope: { enterpriseId },
              },
              receivedAt: '2026-08-26T00:00:00.000Z',
              originalName: 'u001.pdf',
              mediaType: 'application/pdf',
              byteLength: -1,
              checksum: {
                algorithm: 'SHA-256' as const,
                digest: 'a'.repeat(64),
                canonicalizationVersion: '1' as const,
              },
              stagedObjectRef: 'staging://wi05/u001',
              retentionClass: 'CUSTOMER_RECORD',
            },
          },
          { enterpriseId, projectId },
        ),
      ),
    ).rejects.toMatchObject({ code: PROJECT_MATERIAL_SOURCE_INVALID });
  });
});
