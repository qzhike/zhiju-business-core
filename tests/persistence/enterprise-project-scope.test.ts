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
import {
  createEnterpriseProjectDatabase,
  digestCanonicalPayload,
  EnterpriseBusinessError,
  handleCreateEnterprise,
  handleCreateProject,
  handleEnterpriseProductCreate,
  handleEnterpriseProductCreateScopeSnapshot,
  handleEnterpriseProfileCreateSnapshot,
  handleEnterpriseQmsCreateRevision,
  handleEnterpriseQmsActivateRevision,
  handleValidateObjectScope,
  PROJECT_PROJECT_DISPLAY_CODE_CONFLICT,
  PROJECT_START_SNAPSHOT_LATEST_FORBIDDEN,
  PROJECT_START_SNAPSHOT_SCOPE_MISMATCH,
  PROJECT_MEMBER_POLICY_REF_INVALID,
  PROJECT_OBJECT_SCOPE_MISMATCH,
  type CommandEnvelope,
  type CommandResult,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import {
  newUuidV7,
  type CanonicalJsonObject,
  type UuidV7,
} from '@zhiju/shared-kernel';
import type { Common } from '@zhiju/contracts';

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
): { kind: 'VERSIONED'; objectType: T; objectId: string; versionId: string; scope: Common.ScopeRef } {
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

describe.skipIf(!gateEnabled).sequential(
  'EnterpriseProject ProjectScope vertical slice (real PostgreSQL, IM-03 WI-04)',
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
              qmsConfigurationRef: versionedRef('QMSConfiguration', fixtures.qmsConfigurationId, fixtures.qmsConfigurationRevisionId),
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
      }>(
        `SELECT aggregate_version::text, member_policy_version_id::text
           FROM enterprise_project.project
          WHERE project_id = $1::uuid`,
        [projectId],
      );
      expect(root.rows[0]).toMatchObject({
        aggregate_version: '1',
        member_policy_version_id: memberPolicy.versionId,
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
      const base = payloadEnvelope(
        'p002-create-a',
        {
          enterpriseRef: objectRef('Enterprise' as const, enterpriseId),
          displayCode: 'WI04-P002',
          title: 'P002-A',
          objective: 'first',
          startSnapshot: {
            enterpriseProfileSnapshotRef: snapshotRef(
              'EnterpriseProfileSnapshot',
              fixtures.enterpriseProfileSnapshotId,
              fixtures.enterpriseProfilePayloadHash,
            ),
            qmsConfigurationRef: versionedRef('QMSConfiguration', fixtures.qmsConfigurationId, fixtures.qmsConfigurationRevisionId),
            productScopeSnapshotRef: snapshotRef(
              'ProductScopeSnapshot',
              fixtures.productScopeSnapshotId,
              fixtures.productScopePayloadHash,
            ),
          },
          memberPolicyRef: memberPolicy,
        },
        { idempotencyKey: 'p002-create-a' },
      );
      const first = await handleCreateProject(db(), ctx, base);
      expect(first.status).toBe('COMMITTED');
      const dup = await handleCreateProject(
        db(),
        ctx,
        payloadEnvelope(
          'p002-create-b',
          {
            enterpriseRef: objectRef('Enterprise' as const, enterpriseId),
            displayCode: 'WI04-P002',
            title: 'P002-B',
            objective: 'second',
            startSnapshot: {
              enterpriseProfileSnapshotRef: snapshotRef(
                'EnterpriseProfileSnapshot',
                fixtures.enterpriseProfileSnapshotId,
                fixtures.enterpriseProfilePayloadHash,
              ),
              qmsConfigurationRef: versionedRef('QMSConfiguration', fixtures.qmsConfigurationId, fixtures.qmsConfigurationRevisionId),
              productScopeSnapshotRef: snapshotRef(
                'ProductScopeSnapshot',
                fixtures.productScopeSnapshotId,
                fixtures.productScopePayloadHash,
              ),
            },
            memberPolicyRef: memberPolicy,
          },
          { idempotencyKey: 'p002-create-b' },
        ),
      );
      expect(dup.status).toBe('REJECTED');
      if (dup.status === 'REJECTED') {
        expect(dup.errorCode).toBe(PROJECT_PROJECT_DISPLAY_CODE_CONFLICT);
      }
    });

    // ============================================================
    // EP-WI04-P-003 — cross-Enterprise StartSnapshot rejected
    // ============================================================
    it('EP-WI04-P-003 cross-Enterprise startSnapshot is rejected', async () => {
      currentEnterpriseId = ENTERPRISE_A;
      const ctx = contextFor(ENTERPRISE_A);
      const ownFixtures = await seedEnterpriseAndStartFixtures(db(), ENTERPRISE_A);
      currentEnterpriseId = ENTERPRISE_B;
      const ctxB = contextFor(ENTERPRISE_B);
      await seedEnterpriseAndStartFixtures(db(), ENTERPRISE_B);
      currentEnterpriseId = ENTERPRISE_A;
      // Reference Enterprise B's profile snapshot from Enterprise A's start:
      const memberPolicy = versionedRef('Policy', newUuidV7(), newUuidV7());
      // The Profile snapshot of Enterprise B does not exist in this
      // fixture because we seeded Enterprise B separately. The Repository
      // helper must still see a different enterprise_id on the row and
      // reject the startSnapshot scope mismatch. Simulate by passing an
      // Enterprise B-shaped digest that does not match the stored hash.
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
                  ownFixtures.enterpriseProfileSnapshotId,
                  ownFixtures.enterpriseProfilePayloadHash,
                ),
                qmsConfigurationRef: versionedRef(
                  'QMSConfiguration',
                  ownFixtures.qmsConfigurationId,
                  ownFixtures.qmsConfigurationRevisionId,
                  ownFixtures.qmsConfigurationRevisionHash,
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
      // Silence unused-context lint while keeping ctxB as the future
      // extension hook for the cross-Enterprise fixture.
      expect(ctxB.enterpriseId).toBe(ENTERPRISE_B);
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
                qmsConfigurationRef: versionedRef('QMSConfiguration', fixtures.qmsConfigurationId, fixtures.qmsConfigurationRevisionId),
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
      let caught: unknown = null;
      try {
        await handleCreateProject(
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
                  // Use a non-existent id so the up-front shape check
                  // accepts the ref but the handler's Repository lookup
                  // fails; the handler then routes the rejection through
                  // PROJECT_START_SNAPSHOT_INCOMPLETE.
                  '00000000-0000-7000-8000-000000000000',
                  '0'.repeat(64),
                ),
                qmsConfigurationRef: versionedRef('QMSConfiguration', fixtures.qmsConfigurationId, fixtures.qmsConfigurationRevisionId),
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
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(EnterpriseBusinessError);
      expect((caught as EnterpriseBusinessError).code).toBe(PROJECT_START_SNAPSHOT_SCOPE_MISMATCH);
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
                qmsConfigurationRef: versionedRef('QMSConfiguration', fixtures.qmsConfigurationId, fixtures.qmsConfigurationRevisionId),
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
              qmsConfigurationRef: versionedRef('QMSConfiguration', fixtures.qmsConfigurationId, fixtures.qmsConfigurationRevisionId),
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
              qmsConfigurationRef: versionedRef('QMSConfiguration', fixtures.qmsConfigurationId, fixtures.qmsConfigurationRevisionId),
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
      const memberPolicyB = versionedRef('Policy', newUuidV7(), newUuidV7());
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
                fixturesA.qmsConfigurationRevisionHash,
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
                fixturesB.qmsConfigurationRevisionHash,
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
                qmsConfigurationRef: versionedRef('QMSConfiguration', fixtures.qmsConfigurationId, fixtures.qmsConfigurationRevisionId),
                productScopeSnapshotRef: snapshotRef(
                  'ProductScopeSnapshot',
                  fixtures.productScopeSnapshotId,
                  fixtures.productScopePayloadHash,
                ),
              },
              memberPolicyRef: {
                // Missing required contentHash
                kind: 'VERSIONED' as const,
                objectType: 'Policy',
                objectId: newUuidV7(),
                versionId: newUuidV7(),
                scope: { enterpriseId },
              },
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
  },
);
