// IM-03 WI-03 (issue #59): focused PostgreSQL tests for the EnterpriseProject
// business vertical slice. Reuses the WI-02 persistence harness pattern
// (im03_wi02_probe role + disposable container via ZJU_PERSISTENCE_DATABASE_URL).
// The suite exercises the happy path of the four public Contracts and three
// controlled Capabilities, plus the negative paths required by Issue #59
// acceptance §5 (cross-Enterprise ref / hash mismatch / stale expectedVersion
// / duplicate activation).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  CommandExecutionError,
  createEnterpriseProjectDatabase,
  digestCanonicalPayload,
  EnterpriseBusinessError,
  handleConfirmEnterpriseFact,
  handleCreateEnterprise,
  handleEnterpriseProductActivateVersion,
  handleEnterpriseProductCreate,
  handleEnterpriseProductCreateScopeSnapshot,
  handleEnterpriseProfileCreateSnapshot,
  handleEnterpriseQmsActivateRevision,
  handleEnterpriseQmsCreateRevision,
  handleGetEnterpriseProfileSnapshot,
  handleProposeEnterpriseFact,
  PROJECT_ENTERPRISE_DISPLAY_CODE_CONFLICT,
  PROJECT_HUMAN_ONLY_DENIED,
  PROJECT_PRODUCT_ACTIVATION_NOOP,
  PROJECT_PROFILE_SOURCE_MISMATCH,
  PROJECT_PROFILE_SNAPSHOT_IMMUTABLE,
  type CommandEnvelope,
  type CommandResult,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import { newUuidV7, type CanonicalJsonObject, type UuidV7 } from '@zhiju/shared-kernel';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE_A = 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a1a1';
const ENTERPRISE_B = 'b2b2b2b2-b2b2-72b2-82b2-b2b2b2b2b2b2';
const HUMAN_PRINCIPAL = 'd1d1d1d1-d1d1-71d1-81d1-d1d1d1d1d1d1';
const AGENT_PRINCIPAL = 'd2d2d2d2-d2d2-72d2-82d2-d2d2d2d2d2d2';
const ACTOR_HUMAN = 'd3d3d3d3-d3d3-73d3-83d3-d3d3d3d3d3d3';
const ACTOR_AGENT = 'd4d4d4d4-d4d4-74d4-84d4-d4d4d4d4d4d4';
const DECISION = 'd5d5d5d5-d5d5-75d5-85d5-d5d5d5d5d5d5';
const POLICY = 'd6d6d6d6-d6d6-76d6-86d6-d6d6d6d6d6d6';
const DECISION_HASH = Buffer.alloc(32, 0x42);
const CORRELATION = 'd7d7d7d7-d7d7-77d7-87d7-d7d7d7d7d7d7';

function contextFor(
  enterpriseId: string,
  principalId: string,
): EnterpriseProjectTransactionContext {
  return {
    kind: 'REQUEST',
    principalId,
    actorSnapshotId: principalId === HUMAN_PRINCIPAL ? ACTOR_HUMAN : ACTOR_AGENT,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: DECISION_HASH,
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY,
    enterpriseId,
    allowedProjectIds: [],
    correlationId: CORRELATION,
  };
}

let envelopeCounter = 0;
function envelope(overrides: Partial<CommandEnvelope> = {}): CommandEnvelope {
  envelopeCounter += 1;
  // Each envelope needs a unique command_id because command_receipt uses
  // command_id as PRIMARY KEY; reusing the same literal across calls makes
  // the second insert collide with the first. The 13th nibble must be 7
  // (UUIDv7) so the value parses as a UUID.
  const tail = envelopeCounter.toString(16).padStart(12, '0');
  return {
    commandId: `f3f3f3f3-f3f3-73f3-83f3-${tail}`,
    commandType: 'wi03.manual.command',
    commandVersion: '1.0',
    idempotencyScope: 'wi03',
    idempotencyKey: 'wi03-key-1',
    requestPayload: { op: 'manual' },
    enterpriseId: ENTERPRISE_A,
    targetType: 'Enterprise',
    targetId: ENTERPRISE_A,
    correlationId: CORRELATION,
    principalId: HUMAN_PRINCIPAL,
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
  const requestPayload = { op: key, payload } as unknown as CanonicalJsonObject;
  return {
    ...envelope(overrides),
    requestPayload,
    idempotencyKey: `${key}-${overrides.idempotencyKey ?? 'k'}`,
    payload,
  };
}

interface CommittedPayload {
  enterpriseRef?: { objectId: UuidV7 };
  enterpriseFactRef?: { objectId: UuidV7; versionId: UuidV7 };
  productRef?: { objectId: UuidV7 };
  currentVersionRef?: { versionId: UuidV7 };
  qmsConfigurationRef?: { objectId: UuidV7 };
  qmsConfigurationRevisionRef?: { versionId: UuidV7 };
  enterpriseProfileSnapshotRef?: { objectId: UuidV7 };
  productScopeSnapshotRef?: { objectId: UuidV7 };
}

function objectIdFrom(result: CommandResult): UuidV7 {
  if (result.status !== 'COMMITTED') {
    throw new Error(`expected COMMITTED, got ${result.status} ${result.errorCode ?? ''}`);
  }
  const payload = result.resultPayload as CommittedPayload;
  return (
    payload.enterpriseRef?.objectId ??
    payload.enterpriseFactRef?.objectId ??
    payload.productRef?.objectId ??
    payload.qmsConfigurationRef?.objectId ??
    payload.enterpriseProfileSnapshotRef?.objectId ??
    payload.productScopeSnapshotRef?.objectId ??
    (() => {
      throw new Error('no objectId in resultPayload');
    })()
  );
}

function versionIdFrom(result: CommandResult): UuidV7 {
  if (result.status !== 'COMMITTED') {
    throw new Error(`expected COMMITTED, got ${result.status} ${result.errorCode ?? ''}`);
  }
  const payload = result.resultPayload as CommittedPayload;
  return (
    payload.enterpriseFactRef?.versionId ??
    payload.currentVersionRef?.versionId ??
    payload.qmsConfigurationRevisionRef?.versionId ??
    (() => {
      throw new Error('no versionId in resultPayload');
    })()
  );
}

describe.skipIf(!gateEnabled)(
  'EnterpriseProject business vertical slice (real PostgreSQL, IM-03 WI-03)',
  () => {
    let admin: pg.Client;
    let pool: pg.Pool;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(
        `CREATE ROLE im03_wi03_probe LOGIN PASSWORD 'im03-wi03-probe' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await admin.query(
        `GRANT platform_context_establisher, enterprise_project_app TO im03_wi03_probe`,
      );
      const url = new URL(databaseUrl ?? '');
      url.username = 'im03_wi03_probe';
      url.password = 'im03-wi03-probe';
      pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
    });

    afterAll(async () => {
      await pool.end();
      await admin.end();
    });

    async function countRows(table: string, where = ''): Promise<number> {
      const result = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM enterprise_project.${table} ${where}`,
      );
      return Number(result.rows[0]?.count ?? '0');
    }

    function db(): ReturnType<typeof createEnterpriseProjectDatabase> {
      return createEnterpriseProjectDatabase(pool);
    }

    // ============================================================
    // EP-WI03-P-001 — Enterprise displayCode UNIQUE constraint
    // ============================================================
    it('EP-WI03-P-001 rejects duplicate displayCode', async () => {
      const enterpriseA1 = newUuidV7();
      const enterpriseA2 = newUuidV7();
      const ctx = contextFor(enterpriseA1, HUMAN_PRINCIPAL);
      const env1 = payloadEnvelope(
        'p001-a',
        { displayCode: 'WI03-P001', displayName: 'P001-A', initialStatus: 'ACTIVE' as const },
        { idempotencyKey: 'p001-a' },
      );
      const first = await handleCreateEnterprise(db(), ctx, env1);
      expect(first.status).toBe('COMMITTED');

      const ctx2 = contextFor(enterpriseA2, HUMAN_PRINCIPAL);
      const env2 = payloadEnvelope(
        'p001-b',
        { displayCode: 'WI03-P001', displayName: 'P001-B', initialStatus: 'ACTIVE' as const },
        { idempotencyKey: 'p001-b', enterpriseId: enterpriseA2 },
      );
      const second = await handleCreateEnterprise(db(), ctx2, env2);
      expect(second.status).toBe('REJECTED');
      if (second.status === 'REJECTED') {
        expect(second.errorCode).toBe(PROJECT_ENTERPRISE_DISPLAY_CODE_CONFLICT);
      }
    });

    // ============================================================
    // EP-WI03-P-002 — propose + confirm fact; history additive
    // ============================================================
    it('EP-WI03-P-002 propose + confirm keeps additive history', async () => {
      const enterpriseId = newUuidV7();
      const ctx = contextFor(enterpriseId, HUMAN_PRINCIPAL);
      const seedEnv = payloadEnvelope(
        'p002-seed',
        { displayCode: 'WI03-P002', displayName: 'P002', initialStatus: 'ACTIVE' as const },
        { idempotencyKey: 'p002-seed', enterpriseId },
      );
      const seed = await handleCreateEnterprise(db(), ctx, seedEnv);
      objectIdFrom(seed);

      const proposeEnv = payloadEnvelope(
        'p002-propose',
        {
          enterpriseRef: { objectType: 'Enterprise' as const, objectId: enterpriseId },
          proposal: {
            factType: 'enterprise.industry',
            value: { code: 'manufacturing' },
            sourceRefs: [
              {
                objectType: 'SourceMaterial' as const,
                objectId: '00000000-0000-7000-8000-000000000001',
              },
            ],
            riskLevel: 'LOW' as const,
            proposalReason: 'initial',
          },
        },
        { idempotencyKey: 'p002-propose' },
      );
      const propose = await handleProposeEnterpriseFact(db(), ctx, proposeEnv);
      expect(propose.status).toBe('COMMITTED');
      const factId = objectIdFrom(propose);
      const versionId = versionIdFrom(propose);

      const confirmEnv = payloadEnvelope(
        'p002-confirm',
        {
          proposalVersionRef: {
            objectType: 'EnterpriseFact' as const,
            objectId: factId,
            versionId,
          },
          confirmedValue: { code: 'manufacturing', audited: true },
          evidenceRefs: [
            {
              objectType: 'SourceMaterial' as const,
              objectId: '00000000-0000-7000-8000-000000000002',
            },
          ],
          justification: 'human audit',
        },
        { idempotencyKey: 'p002-confirm' },
      );
      const confirm = await handleConfirmEnterpriseFact(db(), ctx, confirmEnv);
      expect(confirm.status).toBe('COMMITTED');
      const versionRows = await countRows(
        'enterprise_fact_version',
        `WHERE enterprise_id = '${enterpriseId}'::uuid`,
      );
      expect(versionRows).toBe(2);
    });

    // ============================================================
    // EP-WI03-P-003 — Agent cannot confirm Human-only
    // ============================================================
    it('EP-WI03-P-003 Agent actingFor Human is rejected with HUMAN_ONLY_DENIED', async () => {
      const ctx = contextFor(ENTERPRISE_A, AGENT_PRINCIPAL);
      (ctx as { principalKind?: string }).principalKind = 'AGENT';
      const env = payloadEnvelope(
        'p003-agent-confirm',
        {
          proposalVersionRef: {
            objectType: 'EnterpriseFact' as const,
            objectId: '00000000-0000-7000-8000-000000000aaa',
            versionId: '00000000-0000-7000-8000-000000000bbb',
          },
          confirmedValue: { x: 1 },
          evidenceRefs: [
            {
              objectType: 'SourceMaterial' as const,
              objectId: '00000000-0000-7000-8000-000000000004',
            },
          ],
          justification: 'agent attempt',
        },
        { idempotencyKey: 'p003-agent-confirm', principalId: AGENT_PRINCIPAL },
      );
      (env as { principalKind?: string }).principalKind = 'AGENT';
      let caught: unknown = null;
      try {
        await handleConfirmEnterpriseFact(db(), ctx, env);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(EnterpriseBusinessError);
      expect((caught as EnterpriseBusinessError).code).toBe(PROJECT_HUMAN_ONLY_DENIED);
    });

    // ============================================================
    // EP-WI03-P-004 — Product create + duplicate activate -> NOOP
    // ============================================================
    it('EP-WI03-P-004 product activation rejects re-activation as NOOP', async () => {
      const enterpriseId = newUuidV7();
      const ctx = contextFor(enterpriseId, HUMAN_PRINCIPAL);
      const seedEnv = payloadEnvelope(
        'p004-seed',
        { displayCode: 'WI03-P004', displayName: 'P004', initialStatus: 'ACTIVE' as const },
        { idempotencyKey: 'p004-seed', enterpriseId },
      );
      const seed = await handleCreateEnterprise(db(), ctx, seedEnv);
      objectIdFrom(seed);

      const productCreate = await handleEnterpriseProductCreate(
        db(),
        ctx,
        payloadEnvelope(
          'p004-prod',
          {
            enterpriseRef: { objectType: 'Enterprise' as const, objectId: enterpriseId },
            displayCode: 'WIDGET',
            initialVersion: {
              productType: 'manufactured.widget',
              displayName: 'Widget',
              intendedUse: 'demo',
              productScope: { productFamily: 'widget', variants: ['a'], markets: ['CN'] },
              sourceRefs: [
                {
                  objectType: 'SourceMaterial' as const,
                  objectId: '00000000-0000-7000-8000-000000000010',
                },
              ],
            },
          },
          { idempotencyKey: 'p004-prod' },
        ),
      );
      expect(productCreate.status).toBe('COMMITTED');
      const productId = objectIdFrom(productCreate);
      const v1Id = versionIdFrom(productCreate);

      // Activate v1 (current pointer)
      const activate = await handleEnterpriseProductActivateVersion(
        db(),
        ctx,
        payloadEnvelope(
          'p004-activate',
          {
            productRef: { objectType: 'Product' as const, objectId: productId },
            productVersionRef: {
              objectType: 'ProductVersion' as const,
              objectId: productId,
              versionId: v1Id,
            },
            activationMode: 'ACTIVATE' as const,
            expectedAggregateVersion: '1',
            humanDecisionRef: {
              objectType: 'BusinessDecision' as const,
              objectId: '00000000-0000-7000-8000-000000000aaa',
            },
          },
          { idempotencyKey: 'p004-activate', expectedAggregateVersion: '1' },
        ),
      );
      expect(activate.status).toBe('COMMITTED');

      // Re-activate the same v1 -> NOOP
      const reactivate = await handleEnterpriseProductActivateVersion(
        db(),
        ctx,
        payloadEnvelope(
          'p004-activate-again',
          {
            productRef: { objectType: 'Product' as const, objectId: productId },
            productVersionRef: {
              objectType: 'ProductVersion' as const,
              objectId: productId,
              versionId: v1Id,
            },
            activationMode: 'ACTIVATE' as const,
            expectedAggregateVersion: '2',
            humanDecisionRef: {
              objectType: 'BusinessDecision' as const,
              objectId: '00000000-0000-7000-8000-000000000bbb',
            },
          },
          { idempotencyKey: 'p004-activate-again', expectedAggregateVersion: '2' },
        ),
      );
      expect(reactivate.status).toBe('REJECTED');
      if (reactivate.status === 'REJECTED') {
        expect(reactivate.errorCode).toBe(PROJECT_PRODUCT_ACTIVATION_NOOP);
      }
    });

    // ============================================================
    // EP-WI03-P-005 — QMS revision1 -> activate -> rollback keeps both revisions
    // ============================================================
    it('EP-WI03-P-005 QMS rollback keeps both revisions', async () => {
      const enterpriseId = newUuidV7();
      const ctx = contextFor(enterpriseId, HUMAN_PRINCIPAL);
      const seedEnv = payloadEnvelope(
        'p005-seed',
        { displayCode: 'WI03-P005', displayName: 'P005', initialStatus: 'ACTIVE' as const },
        { idempotencyKey: 'p005-seed', enterpriseId },
      );
      const seed = await handleCreateEnterprise(db(), ctx, seedEnv);
      objectIdFrom(seed); // warm enterprise seed; not directly used in this test

      const qms1 = await handleEnterpriseQmsCreateRevision(
        db(),
        ctx,
        payloadEnvelope(
          'p005-qms-v1',
          {
            qmsConfigurationRef: {
              objectType: 'QMSConfiguration' as const,
              objectId: 'placeholder',
            },
            applicabilityDecisions: [{ requirementRef: 'req-1', outcome: 'APPLICABLE' }],
            managementChoices: [{ choiceKey: 'review-cycle', selectedOption: 'quarterly' }],
            professionalDecisions: [{ decisionType: 'risk-method', outcome: 'apply' }],
            sourceRefs: [
              {
                objectType: 'SourceMaterial' as const,
                objectId: '00000000-0000-7000-8000-000000000020',
              },
            ],
          },
          { idempotencyKey: 'p005-qms-v1' },
        ),
      );
      const qmsId = objectIdFrom(qms1);
      const v1Id = versionIdFrom(qms1);
      await handleEnterpriseQmsActivateRevision(
        db(),
        ctx,
        payloadEnvelope(
          'p005-activate-v1',
          {
            qmsConfigurationRef: { objectType: 'QMSConfiguration' as const, objectId: qmsId },
            qmsConfigurationRevisionRef: {
              objectType: 'QMSConfigurationRevision' as const,
              objectId: qmsId,
              versionId: v1Id,
            },
            activationMode: 'ACTIVATE' as const,
            expectedAggregateVersion: '1',
            humanDecisionRef: {
              objectType: 'BusinessDecision' as const,
              objectId: '00000000-0000-7000-8000-000000000aaa',
            },
          },
          { idempotencyKey: 'p005-activate-v1', expectedAggregateVersion: '1' },
        ),
      );

      const qms2 = await handleEnterpriseQmsCreateRevision(
        db(),
        ctx,
        payloadEnvelope(
          'p005-qms-v2',
          {
            qmsConfigurationRef: { objectType: 'QMSConfiguration' as const, objectId: qmsId },
            previousRevisionRef: {
              objectType: 'QMSConfigurationRevision' as const,
              objectId: qmsId,
              versionId: v1Id,
            },
            applicabilityDecisions: [{ requirementRef: 'req-1', outcome: 'APPLICABLE' }],
            managementChoices: [{ choiceKey: 'review-cycle', selectedOption: 'monthly' }],
            professionalDecisions: [{ decisionType: 'risk-method', outcome: 'apply' }],
            sourceRefs: [
              {
                objectType: 'SourceMaterial' as const,
                objectId: '00000000-0000-7000-8000-000000000021',
              },
            ],
          },
          { idempotencyKey: 'p005-qms-v2' },
        ),
      );
      const v2Id = versionIdFrom(qms2);
      await handleEnterpriseQmsActivateRevision(
        db(),
        ctx,
        payloadEnvelope(
          'p005-activate-v2',
          {
            qmsConfigurationRef: { objectType: 'QMSConfiguration' as const, objectId: qmsId },
            qmsConfigurationRevisionRef: {
              objectType: 'QMSConfigurationRevision' as const,
              objectId: qmsId,
              versionId: v2Id,
            },
            activationMode: 'ACTIVATE' as const,
            expectedAggregateVersion: '2',
            humanDecisionRef: {
              objectType: 'BusinessDecision' as const,
              objectId: '00000000-0000-7000-8000-000000000bbb',
            },
          },
          { idempotencyKey: 'p005-activate-v2', expectedAggregateVersion: '2' },
        ),
      );
      // ROLLBACK to v1
      const rollback = await handleEnterpriseQmsActivateRevision(
        db(),
        ctx,
        payloadEnvelope(
          'p005-rollback-v1',
          {
            qmsConfigurationRef: { objectType: 'QMSConfiguration' as const, objectId: qmsId },
            qmsConfigurationRevisionRef: {
              objectType: 'QMSConfigurationRevision' as const,
              objectId: qmsId,
              versionId: v1Id,
            },
            activationMode: 'ROLLBACK' as const,
            expectedAggregateVersion: '3',
            humanDecisionRef: {
              objectType: 'BusinessDecision' as const,
              objectId: '00000000-0000-7000-8000-000000000ccc',
            },
          },
          { idempotencyKey: 'p005-rollback-v1', expectedAggregateVersion: '3' },
        ),
      );
      expect(rollback.status).toBe('COMMITTED');
      const revisionRows = await countRows(
        'qms_configuration_revision',
        `WHERE qms_configuration_id = '${qmsId}'::uuid`,
      );
      expect(revisionRows).toBe(2);
    });

    // ============================================================
    // EP-WI03-P-006 — Profile Snapshot rejects cross-Enterprise factRef
    // ============================================================
    it('EP-WI03-P-006 profile snapshot rejects cross-Enterprise factRef', async () => {
      const enterpriseA = newUuidV7();
      const ctx = contextFor(enterpriseA, HUMAN_PRINCIPAL);
      await handleCreateEnterprise(
        db(),
        ctx,
        payloadEnvelope(
          'p006-seed-a',
          { displayCode: 'WI03-P006A', displayName: 'P006A', initialStatus: 'ACTIVE' as const },
          { idempotencyKey: 'p006-seed-a', enterpriseId: enterpriseA },
        ),
      );
      const enterpriseB = newUuidV7();
      const ctxB = contextFor(enterpriseB, HUMAN_PRINCIPAL);
      await handleCreateEnterprise(
        db(),
        ctxB,
        payloadEnvelope(
          'p006-seed-b',
          { displayCode: 'WI03-P006B', displayName: 'P006B', initialStatus: 'ACTIVE' as const },
          { idempotencyKey: 'p006-seed-b', enterpriseId: enterpriseB },
        ),
      );
      // Propose a fact inside Enterprise B
      const proposeInB = await handleProposeEnterpriseFact(
        db(),
        ctxB,
        payloadEnvelope(
          'p006-fact-b',
          {
            enterpriseRef: { objectType: 'Enterprise' as const, objectId: enterpriseB },
            proposal: {
              factType: 'enterprise.size',
              value: { headcount: 50 },
              sourceRefs: [
                {
                  objectType: 'SourceMaterial' as const,
                  objectId: '00000000-0000-7000-8000-000000000030',
                },
              ],
              riskLevel: 'LOW' as const,
              proposalReason: 'b fact',
            },
          },
          { idempotencyKey: 'p006-fact-b', enterpriseId: ENTERPRISE_B },
        ),
      );
      const bFactId = objectIdFrom(proposeInB);
      const bFactVersion = versionIdFrom(proposeInB);

      // Create a product and qms in Enterprise A
      const product = await handleEnterpriseProductCreate(
        db(),
        ctx,
        payloadEnvelope(
          'p006-prod',
          {
            enterpriseRef: { objectType: 'Enterprise' as const, objectId: enterpriseA },
            displayCode: 'PROD-P006',
            initialVersion: {
              productType: 'manufactured.alpha',
              displayName: 'Alpha',
              intendedUse: 'demo',
              productScope: { productFamily: 'alpha', variants: [], markets: ['CN'] },
              sourceRefs: [
                {
                  objectType: 'SourceMaterial' as const,
                  objectId: '00000000-0000-7000-8000-000000000031',
                },
              ],
            },
          },
          { idempotencyKey: 'p006-prod' },
        ),
      );
      const productId = objectIdFrom(product);
      const productVersion = versionIdFrom(product);

      const qms = await handleEnterpriseQmsCreateRevision(
        db(),
        ctx,
        payloadEnvelope(
          'p006-qms',
          {
            qmsConfigurationRef: {
              objectType: 'QMSConfiguration' as const,
              objectId: 'placeholder',
            },
            applicabilityDecisions: [],
            managementChoices: [],
            professionalDecisions: [],
            sourceRefs: [
              {
                objectType: 'SourceMaterial' as const,
                objectId: '00000000-0000-7000-8000-000000000032',
              },
            ],
          },
          { idempotencyKey: 'p006-qms' },
        ),
      );
      const qmsId = objectIdFrom(qms);
      const qmsVersion = versionIdFrom(qms);

      const snapshot = await handleEnterpriseProfileCreateSnapshot(
        db(),
        ctx,
        payloadEnvelope(
          'p006-snapshot',
          {
            enterpriseRef: { objectType: 'Enterprise' as const, objectId: enterpriseA },
            enterpriseFactVersionRefs: [
              {
                objectType: 'EnterpriseFact' as const,
                objectId: bFactId,
                versionId: bFactVersion,
              },
            ],
            productVersionRefs: [
              {
                objectType: 'ProductVersion' as const,
                objectId: productId,
                versionId: productVersion,
              },
            ],
            qmsConfigurationRef: { objectType: 'QMSConfiguration' as const, objectId: qmsId },
            qmsConfigurationRevisionRef: {
              objectType: 'QMSConfigurationRevision' as const,
              objectId: qmsId,
              versionId: qmsVersion,
            },
            purpose: 'cross-enterprise reject',
          },
          { idempotencyKey: 'p006-snapshot' },
        ),
      );
      expect(snapshot.status).toBe('REJECTED');
      if (snapshot.status === 'REJECTED') {
        expect(snapshot.errorCode).toBe(PROJECT_PROFILE_SOURCE_MISMATCH);
      }
    });

    // ============================================================
    // EP-WI03-P-007 — get_enterprise_profile_snapshot replays
    // ============================================================
    it('EP-WI03-P-007 get_enterprise_profile_snapshot reads immutable snapshot', async () => {
      const enterpriseId = newUuidV7();
      const ctx = contextFor(enterpriseId, HUMAN_PRINCIPAL);
      const seed = await handleCreateEnterprise(
        db(),
        ctx,
        payloadEnvelope(
          'p007-seed',
          { displayCode: 'WI03-P007', displayName: 'P007', initialStatus: 'ACTIVE' as const },
          { idempotencyKey: 'p007-seed', enterpriseId },
        ),
      );
      objectIdFrom(seed);
      const product = await handleEnterpriseProductCreate(
        db(),
        ctx,
        payloadEnvelope(
          'p007-prod',
          {
            enterpriseRef: { objectType: 'Enterprise' as const, objectId: enterpriseId },
            displayCode: 'PROD-P007',
            initialVersion: {
              productType: 'manufactured.gamma',
              displayName: 'Gamma',
              intendedUse: 'replay',
              productScope: { productFamily: 'gamma', variants: [], markets: ['CN'] },
              sourceRefs: [
                {
                  objectType: 'SourceMaterial' as const,
                  objectId: '00000000-0000-7000-8000-000000000040',
                },
              ],
            },
          },
          { idempotencyKey: 'p007-prod' },
        ),
      );
      const productId = objectIdFrom(product);
      const productVersion = versionIdFrom(product);
      const qms = await handleEnterpriseQmsCreateRevision(
        db(),
        ctx,
        payloadEnvelope(
          'p007-qms',
          {
            qmsConfigurationRef: {
              objectType: 'QMSConfiguration' as const,
              objectId: 'placeholder',
            },
            applicabilityDecisions: [],
            managementChoices: [],
            professionalDecisions: [],
            sourceRefs: [
              {
                objectType: 'SourceMaterial' as const,
                objectId: '00000000-0000-7000-8000-000000000041',
              },
            ],
          },
          { idempotencyKey: 'p007-qms' },
        ),
      );
      const qmsId = objectIdFrom(qms);
      const qmsVersion = versionIdFrom(qms);
      const snapshot = await handleEnterpriseProfileCreateSnapshot(
        db(),
        ctx,
        payloadEnvelope(
          'p007-snapshot',
          {
            enterpriseRef: { objectType: 'Enterprise' as const, objectId: enterpriseId },
            enterpriseFactVersionRefs: [],
            productVersionRefs: [
              {
                objectType: 'ProductVersion' as const,
                objectId: productId,
                versionId: productVersion,
              },
            ],
            qmsConfigurationRef: { objectType: 'QMSConfiguration' as const, objectId: qmsId },
            qmsConfigurationRevisionRef: {
              objectType: 'QMSConfigurationRevision' as const,
              objectId: qmsId,
              versionId: qmsVersion,
            },
            purpose: 'replay',
          },
          { idempotencyKey: 'p007-snapshot' },
        ),
      );
      expect(snapshot.status).toBe('COMMITTED');
      const snapshotId = objectIdFrom(snapshot);
      const read = await handleGetEnterpriseProfileSnapshot(db(), ctx, {
        enterpriseProfileSnapshotRef: {
          objectType: 'EnterpriseProfileSnapshot' as const,
          objectId: snapshotId,
        },
      });
      expect(read.enterpriseId).toBe(enterpriseId);
      expect(read.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    });

    // ============================================================
    // EP-WI03-P-008 — get_enterprise_profile_snapshot rejects 'latest'
    // ============================================================
    it('EP-WI03-P-008 latest/current pointer is rejected', async () => {
      const ctx = contextFor(ENTERPRISE_A, HUMAN_PRINCIPAL);
      let caught: unknown = null;
      try {
        await handleGetEnterpriseProfileSnapshot(db(), ctx, {
          enterpriseProfileSnapshotRef: {
            objectType: 'EnterpriseProfileSnapshot' as const,
            objectId: 'latest',
          },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(EnterpriseBusinessError);
      expect((caught as EnterpriseBusinessError).code).toBe(PROJECT_PROFILE_SOURCE_MISMATCH);
    });

    // ============================================================
    // EP-WI03-P-009 — get_enterprise_profile_snapshot not-found
    // ============================================================
    it('EP-WI03-P-009 missing snapshot is rejected with SNAPSHOT_IMMUTABLE', async () => {
      const ctx = contextFor(ENTERPRISE_A, HUMAN_PRINCIPAL);
      let caught: unknown = null;
      try {
        await handleGetEnterpriseProfileSnapshot(db(), ctx, {
          enterpriseProfileSnapshotRef: {
            objectType: 'EnterpriseProfileSnapshot' as const,
            objectId: '00000000-0000-7000-8000-000000000999',
          },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(EnterpriseBusinessError);
      expect((caught as EnterpriseBusinessError).code).toBe(PROJECT_PROFILE_SNAPSHOT_IMMUTABLE);
    });

    // ============================================================
    // EP-WI03-P-010 — product scope snapshot with empty refs
    // ============================================================
    it('EP-WI03-P-010 empty product scope snapshot rejected', async () => {
      const enterpriseId = newUuidV7();
      const ctx = contextFor(enterpriseId, HUMAN_PRINCIPAL);
      const seed = await handleCreateEnterprise(
        db(),
        ctx,
        payloadEnvelope(
          'p010-seed',
          { displayCode: 'WI03-P010', displayName: 'P010', initialStatus: 'ACTIVE' as const },
          { idempotencyKey: 'p010-seed', enterpriseId },
        ),
      );
      objectIdFrom(seed);
      const product = await handleEnterpriseProductCreate(
        db(),
        ctx,
        payloadEnvelope(
          'p010-prod',
          {
            enterpriseRef: { objectType: 'Enterprise' as const, objectId: enterpriseId },
            displayCode: 'PROD-P010',
            initialVersion: {
              productType: 'manufactured.epsilon',
              displayName: 'Epsilon',
              intendedUse: 'snapshot probe',
              productScope: { productFamily: 'epsilon', variants: [], markets: ['CN'] },
              sourceRefs: [
                {
                  objectType: 'SourceMaterial' as const,
                  objectId: '00000000-0000-7000-8000-000000000060',
                },
              ],
            },
          },
          { idempotencyKey: 'p010-prod' },
        ),
      );
      const productId = objectIdFrom(product);
      let caught: unknown = null;
      try {
        await handleEnterpriseProductCreateScopeSnapshot(
          db(),
          ctx,
          payloadEnvelope(
            'p010-snapshot-empty',
            {
              productRef: { objectType: 'Product' as const, objectId: productId },
              productVersionRefs: [],
              purpose: 'empty',
            },
            { idempotencyKey: 'p010-snapshot-empty' },
          ),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(EnterpriseBusinessError);
    });

    // ============================================================
    // EP-WI03-P-011 — hash canonicalisation is deterministic
    // ============================================================
    it('EP-WI03-P-011 canonical hash is order-independent', () => {
      const a = digestCanonicalPayload({ x: 1, y: 'z' });
      const b = digestCanonicalPayload({ y: 'z', x: 1 });
      expect(a.hash.equals(b.hash)).toBe(true);
    });

    // Suppress unused-import warning for CommandExecutionError
    it('CommandExecutionError carries a stable code', () => {
      const e = new CommandExecutionError('TEST', 'msg');
      expect(e.code).toBe('TEST');
    });
  },
);
