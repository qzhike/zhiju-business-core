// IM-03 WI-07 (issue #63): real PostgreSQL acceptance tests for
// CustomerBaseline epistemic states, Human-only activation, immutable
// historical references, impact review facts, RLS and Root CAS.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { sql } from 'kysely';
import {
  CONCURRENCY_CONFLICT,
  createEnterpriseProjectDatabase,
  EnterpriseBusinessRepository,
  handleActivateCustomerBaselineVersion,
  handleCreateCustomerBaselineDraft,
  handleGetActiveBaselineRefs,
  PROJECT_BASELINE_STATUS_INVALID,
  PROJECT_BASELINE_VERSION_IMMUTABLE,
  PROJECT_MISSING_CONFIRMATION_REQUIRED,
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

const HUMAN_PRINCIPAL = 'e1e1e1e1-e1e1-71e1-81e1-e1e1e1e1e1e1';
const AGENT_PRINCIPAL = 'e2e2e2e2-e2e2-72e2-82e2-e2e2e2e2e2e2';
const HUMAN_ACTOR = 'e3e3e3e3-e3e3-73e3-83e3-e3e3e3e3e3e3';
const AGENT_ACTOR = 'e4e4e4e4-e4e4-74e4-84e4-e4e4e4e4e4e4';
const AUTHORIZATION_DECISION = 'e5e5e5e5-e5e5-75e5-85e5-e5e5e5e5e5e5';
const POLICY_SNAPSHOT = 'e6e6e6e6-e6e6-76e6-86e6-e6e6e6e6e6e6';
const DECISION_HASH = Buffer.alloc(32, 0x52);

function contextFor(
  enterpriseId: string,
  allowedProjectIds: readonly string[],
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
  projectId: string,
): Common.ObjectRef & { objectType: TObjectType } {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: { enterpriseId, projectId },
  };
}

function versionedRef<TObjectType extends string>(
  objectType: TObjectType,
  objectId: string,
  versionId: string,
  enterpriseId: string,
  projectId: string,
): Common.VersionedRef & { objectType: TObjectType } {
  return {
    kind: 'VERSIONED',
    objectType,
    objectId,
    versionId,
    scope: { enterpriseId, projectId },
  };
}

function decisionRef(
  decisionId: string,
  enterpriseId: string,
  projectId: string,
  digest = 'd'.repeat(64),
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'BusinessDecision',
    objectId: decisionId,
    scope: { enterpriseId, projectId },
    contentHash: {
      algorithm: 'SHA-256',
      digest,
      canonicalizationVersion: '1',
    },
  };
}

function reviewSnapshotRef(
  snapshotId: string,
  enterpriseId: string,
  projectId: string,
  digest = 'c'.repeat(64),
): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType: 'BaselineReview',
    objectId: snapshotId,
    snapshotId,
    scope: { enterpriseId, projectId },
    contentHash: {
      algorithm: 'SHA-256',
      digest,
      canonicalizationVersion: '1',
    },
  };
}

function justification(reasonCode = 'BASELINE_REVIEW'): EnterpriseProject.Justification {
  return {
    reasonCode,
    summary: 'The exact CustomerBaseline state was reviewed by a Human.',
    evidenceRefs: [],
  };
}

function baselinePolicyRef(enterpriseId: string, projectId: string): Common.VersionedRef {
  return versionedRef('Policy', newUuidV7(), newUuidV7(), enterpriseId, projectId);
}

function expectation(
  enterpriseId: string,
  projectId: string,
  status: EnterpriseProject.MaterialStatus,
  expectedMaterialKey: string,
  customerMaterialRefs: readonly Common.VersionedRef[] = [],
  decision: boolean,
): EnterpriseProject.BaselineExpectation {
  return {
    expectationId: newUuidV7(),
    expectedMaterialKey,
    materialType: 'quality.procedure',
    expectedTitleOrRole: expectedMaterialKey,
    status,
    customerMaterialRefs,
    reason: justification(),
    ...(decision ? { decisionRef: decisionRef(newUuidV7(), enterpriseId, projectId) } : {}),
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
    idempotencyScope: 'im03.wi07',
    idempotencyKey,
    requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
    enterpriseId: context.enterpriseId,
    projectId: undefined,
    targetType: 'CustomerBaseline',
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
  readonly customerMaterialId: string;
  readonly customerMaterialVersionId: string;
  readonly customerMaterialRef: Common.VersionedRef;
}

async function seedFixture(admin: pg.Client): Promise<Fixture> {
  const enterpriseId = newUuidV7();
  const projectId = newUuidV7();
  const customerMaterialId = newUuidV7();
  const customerMaterialVersionId = newUuidV7();
  const commandId = newUuidV7();
  const payloadHash = Buffer.alloc(32, 0x61);
  await admin.query(
    `INSERT INTO enterprise_project.project
       (project_id, enterprise_id, display_code, title, objective, status,
        member_policy_ref, member_policy_version_id, member_policy_payload_hash,
        created_by_principal_id, created_by_actor_snapshot_id, last_command_id)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6::jsonb, $7, $8, $9, $10, $11)`,
    [
      projectId,
      enterpriseId,
      `WI07-${projectId.slice(-8)}`,
      'WI-07 CustomerBaseline fixture',
      'Exercise three-state baseline activation and impact review.',
      JSON.stringify({
        kind: 'VERSIONED',
        objectType: 'Policy',
        objectId: newUuidV7(),
        versionId: newUuidV7(),
      }),
      newUuidV7(),
      payloadHash,
      HUMAN_PRINCIPAL,
      HUMAN_ACTOR,
      commandId,
    ],
  );
  await admin.query('BEGIN');
  try {
    await admin.query(
      `INSERT INTO enterprise_project.customer_material_version
         (version_id, customer_material_id, enterprise_id, project_id, version_no,
          version_status, material_type, title, declared_status, completeness,
          source_selections, language, classification_rationale, payload_hash,
          proposed_by_principal_id, proposed_by_actor_snapshot_id,
          authorization_decision_id, source_command_id)
       VALUES ($1, $2, $3, $4, 1, 'CONFIRMED', 'quality.procedure',
          'Confirmed purchasing procedure', 'approved', 'COMPLETE',
          '[]'::jsonb, 'zh-CN', $5::jsonb, $6, $7, $8, $9, $10)`,
      [
        customerMaterialVersionId,
        customerMaterialId,
        enterpriseId,
        projectId,
        JSON.stringify(justification('MATERIAL_CONFIRMED')),
        payloadHash,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
        AUTHORIZATION_DECISION,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.customer_material
         (customer_material_id, enterprise_id, project_id, material_type, title,
          declared_status, completeness, classification_status, current_version_id,
          created_by_principal_id, created_by_actor_snapshot_id,
          confirmed_by_principal_id, confirmed_by_actor_snapshot_id, confirmed_at,
          last_command_id)
       VALUES ($1, $2, $3, 'quality.procedure', 'Confirmed purchasing procedure',
          'approved', 'COMPLETE', 'CONFIRMED', $4, $5, $6, $5, $6, now(), $7)`,
      [
        customerMaterialId,
        enterpriseId,
        projectId,
        customerMaterialVersionId,
        HUMAN_PRINCIPAL,
        HUMAN_ACTOR,
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
    customerMaterialId,
    customerMaterialVersionId,
    customerMaterialRef: versionedRef(
      'CustomerMaterial',
      customerMaterialId,
      customerMaterialVersionId,
      enterpriseId,
      projectId,
    ),
  };
}

function draftPayload(
  fixture: Fixture,
  expectations: readonly EnterpriseProject.BaselineExpectation[],
  previousVersionRef?: Common.VersionedRef,
): EnterpriseProject.ProjectCreateCustomerBaselineDraftPayload {
  return {
    projectRef: objectRef('Project', fixture.projectId, fixture.enterpriseId, fixture.projectId),
    ...(previousVersionRef === undefined ? {} : { previousVersionRef }),
    expectations,
    baselinePolicyRef: baselinePolicyRef(fixture.enterpriseId, fixture.projectId),
  };
}

function activationPayload(
  fixture: Fixture,
  baselineVersionRef: Common.VersionedRef,
): EnterpriseProject.ProjectActivateCustomerBaselineVersionPayload {
  return {
    baselineVersionRef,
    reviewSnapshotRef: reviewSnapshotRef(newUuidV7(), fixture.enterpriseId, fixture.projectId),
    impactPolicyRef: baselinePolicyRef(fixture.enterpriseId, fixture.projectId),
    justification: justification('BASELINE_ACTIVATION'),
  };
}

describe.skipIf(!gateEnabled)('CustomerBaseline WI-07 (real PostgreSQL)', () => {
  let admin: pg.Client;
  let pool: pg.Pool;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `DO $do$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'im03_wi07_probe') THEN
           CREATE ROLE im03_wi07_probe LOGIN PASSWORD 'im03-wi07-probe'
             NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
         END IF;
       END $do$`,
    );
    await admin.query(
      `GRANT platform_context_establisher, enterprise_project_app TO im03_wi07_probe`,
    );
    const url = new URL(databaseUrl ?? '');
    url.username = 'im03_wi07_probe';
    url.password = 'im03-wi07-probe';
    pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
  });

  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  function db(): ReturnType<typeof createEnterpriseProjectDatabase> {
    return createEnterpriseProjectDatabase(pool);
  }

  it('EP-API-U-001/U-002: enforces Agent/Human epistemic boundaries and DB CHECKs', async () => {
    const fixture = await seedFixture(admin);
    const agentContext = contextFor(fixture.enterpriseId, [fixture.projectId], 'AGENT');
    const missingExpectation = expectation(
      fixture.enterpriseId,
      fixture.projectId,
      'MISSING_CONFIRMED',
      'training.procedure',
      [],
      true,
    );
    const agentResult = await handleCreateCustomerBaselineDraft(
      db(),
      agentContext,
      commandEnvelope(
        agentContext,
        'project.create_customer_baseline_draft',
        'agent-missing',
        draftPayload(fixture, [missingExpectation]),
        { projectId: fixture.projectId, targetId: newUuidV7() },
      ),
    );
    expect(agentResult).toMatchObject({
      status: 'REJECTED',
      errorCode: PROJECT_MISSING_CONFIRMATION_REQUIRED,
    });
    const emptyRoot = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM enterprise_project.customer_baseline
        WHERE project_id = $1`,
      [fixture.projectId],
    );
    expect(emptyRoot.rows[0]?.count).toBe('0');

    const humanContext = contextFor(fixture.enterpriseId, [fixture.projectId]);
    const humanMissingExpectation = expectation(
      fixture.enterpriseId,
      fixture.projectId,
      'MISSING_CONFIRMED',
      'missing.confirmed.procedure',
      [],
      true,
    );
    const firstDraft = await handleCreateCustomerBaselineDraft(
      db(),
      humanContext,
      commandEnvelope(
        humanContext,
        'project.create_customer_baseline_draft',
        'human-cb003-draft',
        draftPayload(fixture, [
          expectation(
            fixture.enterpriseId,
            fixture.projectId,
            'PRESENT',
            'purchasing.procedure',
            [fixture.customerMaterialRef],
            false,
          ),
          expectation(
            fixture.enterpriseId,
            fixture.projectId,
            'PARTIAL',
            'quality.procedure',
            [fixture.customerMaterialRef],
            false,
          ),
          expectation(
            fixture.enterpriseId,
            fixture.projectId,
            'NOT_PROVIDED',
            'training.procedure',
            [],
            false,
          ),
          expectation(
            fixture.enterpriseId,
            fixture.projectId,
            'UNKNOWN',
            'supplier.procedure',
            [],
            false,
          ),
          humanMissingExpectation,
        ]),
        { projectId: fixture.projectId, targetId: newUuidV7() },
      ),
    );
    const firstDraftPayload = committedPayload(firstDraft) as unknown as {
      customerBaselineRef: Common.VersionedRef;
      payloadHash: string;
    };
    expect(firstDraftPayload.customerBaselineRef).toMatchObject({
      objectType: 'CustomerBaseline',
      scope: { enterpriseId: fixture.enterpriseId, projectId: fixture.projectId },
    });

    await expect(
      handleCreateCustomerBaselineDraft(
        db(),
        humanContext,
        commandEnvelope(
          humanContext,
          'project.create_customer_baseline_draft',
          'invalid-runtime-combination',
          draftPayload(fixture, [
            expectation(
              fixture.enterpriseId,
              fixture.projectId,
              'UNKNOWN',
              'invalid.unknown',
              [fixture.customerMaterialRef],
              false,
            ),
          ]),
          {
            projectId: fixture.projectId,
            targetId: firstDraftPayload.customerBaselineRef.objectId,
          },
        ),
      ),
    ).rejects.toMatchObject({ code: PROJECT_BASELINE_STATUS_INVALID });

    const invalidDbBase = {
      expectation_id: newUuidV7(),
      customer_baseline_id: firstDraftPayload.customerBaselineRef.objectId,
      version_id: firstDraftPayload.customerBaselineRef.versionId,
      enterprise_id: fixture.enterpriseId,
      project_id: fixture.projectId,
      expected_material_key: 'db.invalid.unknown',
      material_type: 'quality.procedure',
      expected_title_or_role: 'DB invalid state',
      status: 'UNKNOWN',
      reason: JSON.stringify(justification()),
      payload_hash: Buffer.alloc(32, 0x62),
      recorded_by_principal_id: HUMAN_PRINCIPAL,
      recorded_by_actor_snapshot_id: HUMAN_ACTOR,
      authorization_decision_id: AUTHORIZATION_DECISION,
      source_command_id: newUuidV7(),
    };
    await expect(
      withEnterpriseProjectTransaction(db(), humanContext, async (trx) => {
        await sql`
          INSERT INTO enterprise_project.customer_baseline_item
            (expectation_id, customer_baseline_id, version_id, enterprise_id, project_id,
             expected_material_key, material_type, expected_title_or_role, status,
             customer_material_refs, decision_ref, reason, payload_hash,
             recorded_by_principal_id, recorded_by_actor_snapshot_id,
             authorization_decision_id, source_command_id)
          VALUES (
            ${invalidDbBase.expectation_id}::uuid,
            ${invalidDbBase.customer_baseline_id}::uuid,
            ${invalidDbBase.version_id}::uuid,
            ${invalidDbBase.enterprise_id}::uuid,
            ${invalidDbBase.project_id}::uuid,
            ${invalidDbBase.expected_material_key},
            ${invalidDbBase.material_type},
            ${invalidDbBase.expected_title_or_role},
            ${invalidDbBase.status},
            ${JSON.stringify([fixture.customerMaterialRef])}::jsonb,
            NULL,
            ${invalidDbBase.reason}::jsonb,
            ${invalidDbBase.payload_hash},
            ${invalidDbBase.recorded_by_principal_id}::uuid,
            ${invalidDbBase.recorded_by_actor_snapshot_id}::uuid,
            ${invalidDbBase.authorization_decision_id}::uuid,
            ${invalidDbBase.source_command_id}::uuid)
        `.execute(trx);
      }),
    ).rejects.toMatchObject({ code: '23514' });

    const invalidMissing = {
      ...invalidDbBase,
      expectation_id: newUuidV7(),
      expected_material_key: 'db.invalid.missing',
      status: 'MISSING_CONFIRMED',
    };
    await expect(
      withEnterpriseProjectTransaction(db(), humanContext, async (trx) => {
        await sql`
          INSERT INTO enterprise_project.customer_baseline_item
            (expectation_id, customer_baseline_id, version_id, enterprise_id, project_id,
             expected_material_key, material_type, expected_title_or_role, status,
             customer_material_refs, decision_ref, reason, payload_hash,
             recorded_by_principal_id, recorded_by_actor_snapshot_id,
             authorization_decision_id, source_command_id)
          VALUES (
            ${invalidMissing.expectation_id}::uuid,
            ${invalidMissing.customer_baseline_id}::uuid,
            ${invalidMissing.version_id}::uuid,
            ${invalidMissing.enterprise_id}::uuid,
            ${invalidMissing.project_id}::uuid,
            ${invalidMissing.expected_material_key},
            ${invalidMissing.material_type},
            ${invalidMissing.expected_title_or_role},
            ${invalidMissing.status},
            '[]'::jsonb,
            NULL,
            ${invalidMissing.reason}::jsonb,
            ${invalidMissing.payload_hash},
            ${invalidMissing.recorded_by_principal_id}::uuid,
            ${invalidMissing.recorded_by_actor_snapshot_id}::uuid,
            ${invalidMissing.authorization_decision_id}::uuid,
            ${invalidMissing.source_command_id}::uuid)
        `.execute(trx);
      }),
    ).rejects.toMatchObject({ code: '23514' });

    const activation = await handleActivateCustomerBaselineVersion(
      db(),
      humanContext,
      commandEnvelope(
        humanContext,
        'project.activate_customer_baseline_version',
        'human-cb003-activate',
        activationPayload(fixture, firstDraftPayload.customerBaselineRef),
        {
          projectId: fixture.projectId,
          targetId: firstDraftPayload.customerBaselineRef.objectId,
          expectedAggregateVersion: '1',
        },
      ),
    );
    const activatedPayload = committedPayload(activation) as unknown as {
      customerBaselineRef: Common.VersionedRef;
    };
    expect(activatedPayload.customerBaselineRef.versionId).toBe(
      firstDraftPayload.customerBaselineRef.versionId,
    );
    const event = await admin.query<{
      payload: Record<string, unknown>;
      aggregate_version: string;
    }>(
      `SELECT payload, aggregate_version::text
         FROM enterprise_project.outbox_event
        WHERE event_type = 'project.CustomerBaselineVersionActivated'
          AND aggregate_id = $1`,
      [firstDraftPayload.customerBaselineRef.objectId],
    );
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0]?.aggregate_version).toBe('2');
    expect(event.rows[0]?.payload).not.toHaveProperty('customerDocumentText');
    expect(event.rows[0]?.payload).not.toHaveProperty('expectations');

    const active = await handleGetActiveBaselineRefs(db(), humanContext, {
      projectRef: objectRef('Project', fixture.projectId, fixture.enterpriseId, fixture.projectId),
    });
    expect(active.customerBaselineRef).toEqual(activatedPayload.customerBaselineRef);
    expect(active.aggregateVersions).toMatchObject({
      customerBaseline: '2',
      customerBaselineVersion: '1',
    });

    const repository = new EnterpriseBusinessRepository();
    await withEnterpriseProjectTransaction(
      db(),
      contextFor(fixture.enterpriseId, []),
      async (trx) => {
        expect(
          await repository.getCustomerBaselineById(
            trx,
            firstDraftPayload.customerBaselineRef.objectId,
          ),
        ).toBeUndefined();
      },
    );
  });

  it('EP-API-P-001/E-002: preserves CB-003 refs while activating CB-004 with a stale impact fact', async () => {
    const fixture = await seedFixture(admin);
    const context = contextFor(fixture.enterpriseId, [fixture.projectId]);
    const firstDraft = await handleCreateCustomerBaselineDraft(
      db(),
      context,
      commandEnvelope(
        context,
        'project.create_customer_baseline_draft',
        'cb003-draft-e2e',
        draftPayload(fixture, [
          expectation(
            fixture.enterpriseId,
            fixture.projectId,
            'PRESENT',
            'purchasing.procedure',
            [fixture.customerMaterialRef],
            false,
          ),
        ]),
        { projectId: fixture.projectId, targetId: newUuidV7() },
      ),
    );
    const cb003 = (
      committedPayload(firstDraft) as unknown as { customerBaselineRef: Common.VersionedRef }
    ).customerBaselineRef;
    await handleActivateCustomerBaselineVersion(
      db(),
      context,
      commandEnvelope(
        context,
        'project.activate_customer_baseline_version',
        'cb003-activate-e2e',
        activationPayload(fixture, cb003),
        { projectId: fixture.projectId, targetId: cb003.objectId, expectedAggregateVersion: '1' },
      ),
    );

    const gapObjectId = newUuidV7();
    const planObjectId = newUuidV7();
    const contextObjectId = newUuidV7();
    const oldPayloadHash = Buffer.from(
      (committedPayload(firstDraft) as unknown as { payloadHash: string }).payloadHash,
      'hex',
    );
    await admin.query(
      `INSERT INTO enterprise_project.reference_edge
         (owner_object_type, owner_object_id, owner_version_id, owner_payload_hash,
          reference_path, target_module, target_object_type, target_object_id,
          target_version_id, target_payload_hash, reference_purpose,
          enterprise_id, project_id, source_command_id)
       VALUES
         ('GapAnalysis', $1, $2, $3, '/input/customerBaselineRef', 'EnterpriseProject', 'CustomerBaseline', $4, $5, $6, 'GAP_ANALYSIS_BASELINE_INPUT', $7, $8, $9),
         ('DeliveryPlan', $10, $11, $12, '/baselineRefs/0', 'EnterpriseProject', 'CustomerBaseline', $4, $5, $6, 'DELIVERY_PLAN_BASELINE_INPUT', $7, $8, $13),
         ('ProjectContext', $14, $15, $16, '/activeBaselineRefs/0', 'EnterpriseProject', 'CustomerBaseline', $4, $5, $6, 'PROJECT_CONTEXT_BASELINE_INPUT', $7, $8, $17)`,
      [
        gapObjectId,
        newUuidV7(),
        Buffer.alloc(32, 0x71),
        cb003.objectId,
        cb003.versionId,
        oldPayloadHash,
        fixture.enterpriseId,
        fixture.projectId,
        newUuidV7(),
        planObjectId,
        newUuidV7(),
        Buffer.alloc(32, 0x72),
        newUuidV7(),
        contextObjectId,
        newUuidV7(),
        Buffer.alloc(32, 0x73),
        newUuidV7(),
      ],
    );

    const cb004Draft = await handleCreateCustomerBaselineDraft(
      db(),
      context,
      commandEnvelope(
        context,
        'project.create_customer_baseline_draft',
        'cb004-draft-e2e',
        draftPayload(
          fixture,
          [
            expectation(
              fixture.enterpriseId,
              fixture.projectId,
              'UNKNOWN',
              'supplier.procedure',
              [],
              false,
            ),
          ],
          cb003,
        ),
        { projectId: fixture.projectId, targetId: cb003.objectId, expectedAggregateVersion: '2' },
      ),
    );
    const cb004 = (
      committedPayload(cb004Draft) as unknown as { customerBaselineRef: Common.VersionedRef }
    ).customerBaselineRef;
    expect(cb004.versionId).not.toBe(cb003.versionId);

    const cb004Activation = await handleActivateCustomerBaselineVersion(
      db(),
      context,
      commandEnvelope(
        context,
        'project.activate_customer_baseline_version',
        'cb004-activate-e2e',
        activationPayload(fixture, cb004),
        { projectId: fixture.projectId, targetId: cb004.objectId, expectedAggregateVersion: '3' },
      ),
    );
    const cb004Activated = (
      committedPayload(cb004Activation) as unknown as { previousActiveRef: Common.VersionedRef }
    ).previousActiveRef;
    expect(cb004Activated).toEqual(cb003);

    const edges = await admin.query<{ target_version_id: string; owner_object_type: string }>(
      `SELECT target_version_id::text
              , owner_object_type
         FROM enterprise_project.reference_edge
        WHERE target_object_type = 'CustomerBaseline'
          AND target_object_id = $1
          AND target_version_id = $2
        ORDER BY reference_path`,
      [cb003.objectId, cb003.versionId],
    );
    expect(edges.rows).toHaveLength(5);
    expect(
      edges.rows.filter((row) =>
        ['GapAnalysis', 'DeliveryPlan', 'ProjectContext'].includes(row.owner_object_type),
      ),
    ).toHaveLength(3);

    const impact = await admin.query<{
      impact_status: string;
      previous_active_version_id: string | null;
      affected_references: Record<string, unknown>[];
      stale_references: Record<string, unknown>[];
    }>(
      `SELECT impact_status, previous_active_version_id::text,
              affected_references, stale_references
         FROM enterprise_project.customer_baseline_impact_review
        WHERE customer_baseline_id = $1 AND new_version_id = $2`,
      [cb004.objectId, cb004.versionId],
    );
    expect(impact.rows).toHaveLength(1);
    expect(impact.rows[0]).toMatchObject({
      impact_status: 'STALE',
      previous_active_version_id: cb003.versionId,
    });
    expect(impact.rows[0]?.affected_references).toHaveLength(3);
    expect(impact.rows[0]?.stale_references).toHaveLength(3);

    const versions = await admin.query<{
      version_no: number;
      version_status: string;
      payload_hash: Buffer;
    }>(
      `SELECT version_no, version_status, payload_hash
         FROM enterprise_project.customer_baseline_version
        WHERE customer_baseline_id = $1
        ORDER BY version_no`,
      [cb003.objectId],
    );
    expect(versions.rows.map((row) => [row.version_no, row.version_status])).toEqual([
      [1, 'CONFIRMED'],
      [2, 'CONFIRMED'],
    ]);
    expect(
      versions.rows[0]?.payload_hash.equals(versions.rows[1]?.payload_hash ?? Buffer.alloc(0)),
    ).toBe(false);

    const eventRows = await admin.query<{ payload: Record<string, unknown> }>(
      `SELECT payload
         FROM enterprise_project.outbox_event
        WHERE event_type = 'project.CustomerBaselineVersionActivated'
          AND aggregate_id = $1
        ORDER BY aggregate_version`,
      [cb003.objectId],
    );
    expect(eventRows.rows).toHaveLength(2);
    expect(eventRows.rows[1]?.payload).toMatchObject({ previousActiveRef: cb003 });
    expect(eventRows.rows[1]?.payload).not.toHaveProperty('customerDocumentText');

    await expect(
      withEnterpriseProjectTransaction(db(), context, async (trx) => {
        await sql`
          UPDATE enterprise_project.customer_baseline_version
             SET baseline_policy_ref = '{}'::jsonb
           WHERE version_id = ${cb003.versionId}::uuid
        `.execute(trx);
      }),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withEnterpriseProjectTransaction(db(), context, async (trx) => {
        await sql`
          DELETE FROM enterprise_project.customer_baseline_impact_review
           WHERE customer_baseline_id = ${cb003.objectId}::uuid
        `.execute(trx);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('EP-API-P-002/P-003: Root CAS permits one activation and rejects stale writes', async () => {
    const fixture = await seedFixture(admin);
    const context = contextFor(fixture.enterpriseId, [fixture.projectId]);
    const draft = await handleCreateCustomerBaselineDraft(
      db(),
      context,
      commandEnvelope(
        context,
        'project.create_customer_baseline_draft',
        'cas-draft',
        draftPayload(fixture, [
          expectation(
            fixture.enterpriseId,
            fixture.projectId,
            'UNKNOWN',
            'training.procedure',
            [],
            false,
          ),
        ]),
        { projectId: fixture.projectId, targetId: newUuidV7() },
      ),
    );
    const draftRef = (
      committedPayload(draft) as unknown as { customerBaselineRef: Common.VersionedRef }
    ).customerBaselineRef;
    const activationPayloadValue = activationPayload(fixture, draftRef);
    const contextA = contextFor(fixture.enterpriseId, [fixture.projectId]);
    const contextB = contextFor(fixture.enterpriseId, [fixture.projectId]);
    const outcomes = await Promise.all([
      handleActivateCustomerBaselineVersion(
        db(),
        contextA,
        commandEnvelope(
          contextA,
          'project.activate_customer_baseline_version',
          'cas-activate-a',
          activationPayloadValue,
          {
            projectId: fixture.projectId,
            targetId: draftRef.objectId,
            expectedAggregateVersion: '1',
          },
        ),
      ),
      handleActivateCustomerBaselineVersion(
        db(),
        contextB,
        commandEnvelope(
          contextB,
          'project.activate_customer_baseline_version',
          'cas-activate-b',
          activationPayloadValue,
          {
            projectId: fixture.projectId,
            targetId: draftRef.objectId,
            expectedAggregateVersion: '1',
          },
        ),
      ),
    ]);
    expect(outcomes.filter((result) => result.status === 'COMMITTED')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'REJECTED')).toHaveLength(1);
    expect(outcomes.find((result) => result.status === 'REJECTED')).toMatchObject({
      errorCode: CONCURRENCY_CONFLICT,
      currentAggregateVersion: '2',
    });

    const eventCount = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM enterprise_project.outbox_event
        WHERE event_type = 'project.CustomerBaselineVersionActivated'
          AND aggregate_id = $1`,
      [draftRef.objectId],
    );
    expect(eventCount.rows[0]?.count).toBe('1');

    await expect(
      withEnterpriseProjectTransaction(db(), context, async (trx) => {
        await sql`
          DELETE FROM enterprise_project.customer_baseline_version
           WHERE version_id = ${draftRef.versionId}::uuid
        `.execute(trx);
      }),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withEnterpriseProjectTransaction(db(), context, async (trx) => {
        await sql`
          UPDATE enterprise_project.customer_baseline
             SET active_version_id = NULL
           WHERE customer_baseline_id = ${draftRef.objectId}::uuid
        `.execute(trx);
      }),
    ).rejects.toMatchObject({ code: '23514' });

    const staleDraft = await handleCreateCustomerBaselineDraft(
      db(),
      context,
      commandEnvelope(
        context,
        'project.create_customer_baseline_draft',
        'cas-stale-draft',
        draftPayload(
          fixture,
          [
            expectation(
              fixture.enterpriseId,
              fixture.projectId,
              'UNKNOWN',
              'stale.procedure',
              [],
              false,
            ),
          ],
          draftRef,
        ),
        {
          projectId: fixture.projectId,
          targetId: draftRef.objectId,
          expectedAggregateVersion: '1',
        },
      ),
    );
    expect(staleDraft).toMatchObject({ status: 'REJECTED', errorCode: CONCURRENCY_CONFLICT });
  });

  it('EP-API-M-001: exposes a runnable three-state probe boundary', () => {
    expect(PROJECT_BASELINE_VERSION_IMMUTABLE).toBe('PROJECT_BASELINE_VERSION_IMMUTABLE');
    expect(PROJECT_MISSING_CONFIRMATION_REQUIRED).toBe('PROJECT_MISSING_CONFIRMATION_REQUIRED');
  });
});
