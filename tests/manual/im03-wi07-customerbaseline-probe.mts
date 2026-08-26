// IM-03 WI-07 (issue #63): disposable PostgreSQL manual probe.
//
// Run with an administrative disposable database URL, for example:
//   ZJU_PERSISTENCE_DATABASE_URL=... node --experimental-strip-types tests/manual/im03-wi07-customerbaseline-probe.mts
// The probe creates one random fixture, prints the Agent/Human and old/new
// baseline transitions, then removes the fixture rows before exiting.

import pg from 'pg';
import {
  createEnterpriseProjectDatabase,
  handleActivateCustomerBaselineVersion,
  handleCreateCustomerBaselineDraft,
  handleGetActiveBaselineRefs,
  type CommandEnvelope,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Common, EnterpriseProject } from '@zhiju/contracts';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL ?? process.env.ZJU_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('ZJU_PERSISTENCE_DATABASE_URL or ZJU_DATABASE_URL is required');
}

const HUMAN_PRINCIPAL = 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f1f1';
const HUMAN_ACTOR = 'f2f2f2f2-f2f2-72f2-82f2-f2f2f2f2f2f2';
const AGENT_PRINCIPAL = 'f3f3f3f3-f3f3-73f3-83f3-f3f3f3f3f3f3';
const AGENT_ACTOR = 'f4f4f4f4-f4f4-74f4-84f4-f4f4f4f4f4f4';
const AUTHORIZATION_DECISION = 'f5f5f5f5-f5f5-75f5-85f5-f5f5f5f5f5f5';
const POLICY_SNAPSHOT = 'f6f6f6f6-f6f6-76f6-86f6-f6f6f6f6f6f6';
const DECISION_HASH = Buffer.alloc(32, 0x63);

function contextFor(
  enterpriseId: string,
  projectId: string,
  principalKind: 'HUMAN' | 'AGENT',
): EnterpriseProjectTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: principalKind === 'HUMAN' ? HUMAN_PRINCIPAL : AGENT_PRINCIPAL,
    principalKind,
    actorSnapshotId: principalKind === 'HUMAN' ? HUMAN_ACTOR : AGENT_ACTOR,
    authorizationDecisionId: AUTHORIZATION_DECISION,
    authorizationDecisionHash: DECISION_HASH,
    authorizationDecisionExpiresAt: new Date(Date.now() + 3_600_000),
    policySnapshotId: POLICY_SNAPSHOT,
    enterpriseId,
    allowedProjectIds: [projectId],
    correlationId: newUuidV7(),
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

function projectRef(enterpriseId: string, projectId: string): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'Project',
    objectId: projectId,
    scope: { enterpriseId, projectId },
  };
}

function justification(reasonCode: string): EnterpriseProject.Justification {
  return {
    reasonCode,
    summary: 'WI-07 manual baseline probe fact review.',
    evidenceRefs: [],
  };
}

function decisionRef(enterpriseId: string, projectId: string): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'BusinessDecision',
    objectId: newUuidV7(),
    scope: { enterpriseId, projectId },
    contentHash: {
      algorithm: 'SHA-256',
      digest: 'a'.repeat(64),
      canonicalizationVersion: '1',
    },
  };
}

function policyRef(enterpriseId: string, projectId: string): Common.VersionedRef {
  return versionedRef('Policy', newUuidV7(), newUuidV7(), enterpriseId, projectId);
}

function expectation(
  enterpriseId: string,
  projectId: string,
  status: EnterpriseProject.MaterialStatus,
  key: string,
  decision = false,
): EnterpriseProject.BaselineExpectation {
  return {
    expectationId: newUuidV7(),
    expectedMaterialKey: key,
    materialType: 'quality.procedure',
    expectedTitleOrRole: key,
    status,
    customerMaterialRefs: [],
    reason: justification('BASELINE_STATE_REVIEW'),
    ...(decision ? { decisionRef: decisionRef(enterpriseId, projectId) } : {}),
  };
}

function envelope<TPayload extends object>(
  context: EnterpriseProjectTransactionContext,
  commandType: string,
  key: string,
  payload: TPayload,
  targetId: string,
  expectedAggregateVersion?: string,
): CommandEnvelope & { payload: TPayload } {
  return {
    commandId: newUuidV7(),
    commandType,
    commandVersion: '1.0',
    idempotencyScope: 'wi07-manual',
    idempotencyKey: key,
    requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
    enterpriseId: context.enterpriseId,
    projectId: context.allowedProjectIds[0],
    targetType: 'CustomerBaseline',
    targetId,
    ...(expectedAggregateVersion === undefined ? {} : { expectedAggregateVersion }),
    correlationId: context.correlationId,
    principalId: context.principalId,
    principalKind: context.principalKind,
    actorSnapshotId: context.actorSnapshotId,
    authorizationDecisionId: context.authorizationDecisionId,
    policySnapshotId: context.policySnapshotId,
    payload,
  };
}

function committedRef(result: {
  status: string;
  resultPayload?: CanonicalJsonObject;
}): Common.VersionedRef {
  if (result.status !== 'COMMITTED' || result.resultPayload === undefined) {
    throw new Error(`expected COMMITTED, got ${result.status}`);
  }
  return result.resultPayload.customerBaselineRef as unknown as Common.VersionedRef;
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
const db = createEnterpriseProjectDatabase(pool);
const admin = new pg.Client({ connectionString: databaseUrl });
let adminConnected = false;
const enterpriseId = newUuidV7();
const projectId = newUuidV7();
const customerMaterialId = newUuidV7();
const customerMaterialVersionId = newUuidV7();
const baselineId = newUuidV7();

async function seed(): Promise<void> {
  await admin.connect();
  adminConnected = true;
  await admin.query(
    `INSERT INTO enterprise_project.project
       (project_id, enterprise_id, display_code, title, objective, status,
        member_policy_ref, member_policy_version_id, member_policy_payload_hash,
        created_by_principal_id, created_by_actor_snapshot_id, last_command_id)
     VALUES ($1, $2, $3, 'WI-07 manual probe', 'Observe baseline state transitions',
             'ACTIVE', $4::jsonb, $5, $6, $7, $8, $9)`,
    [
      projectId,
      enterpriseId,
      `WI07-MANUAL-${projectId.slice(-8)}`,
      JSON.stringify({
        kind: 'VERSIONED',
        objectType: 'Policy',
        objectId: newUuidV7(),
        versionId: newUuidV7(),
      }),
      newUuidV7(),
      Buffer.alloc(32, 0x64),
      HUMAN_PRINCIPAL,
      HUMAN_ACTOR,
      newUuidV7(),
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
          'Manual confirmed procedure', 'approved', 'COMPLETE', '[]'::jsonb,
          'zh-CN', $5::jsonb, $6, $7, $8, $9, $10)`,
      [
        customerMaterialVersionId,
        customerMaterialId,
        enterpriseId,
        projectId,
        JSON.stringify(justification('MATERIAL_CONFIRMED')),
        Buffer.alloc(32, 0x65),
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
       VALUES ($1, $2, $3, 'quality.procedure', 'Manual confirmed procedure',
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
}

async function cleanup(): Promise<void> {
  await admin.query('BEGIN');
  try {
    // This is an administrative cleanup of the random tenant in a disposable
    // database. The application role cannot bypass the immutable FK boundary.
    await admin.query("SET LOCAL session_replication_role = 'replica'");
    await admin.query('DELETE FROM enterprise_project.reference_edge WHERE enterprise_id = $1', [
      enterpriseId,
    ]);
    await admin.query('DELETE FROM enterprise_project.audit_record WHERE enterprise_id = $1', [
      enterpriseId,
    ]);
    await admin.query('DELETE FROM enterprise_project.outbox_event WHERE enterprise_id = $1', [
      enterpriseId,
    ]);
    await admin.query('DELETE FROM enterprise_project.command_receipt WHERE enterprise_id = $1', [
      enterpriseId,
    ]);
    await admin.query(
      'DELETE FROM enterprise_project.customer_baseline_impact_review WHERE enterprise_id = $1',
      [enterpriseId],
    );
    await admin.query(
      'DELETE FROM enterprise_project.customer_baseline_item WHERE enterprise_id = $1',
      [enterpriseId],
    );
    await admin.query(
      'DELETE FROM enterprise_project.customer_baseline_version WHERE enterprise_id = $1',
      [enterpriseId],
    );
    await admin.query('DELETE FROM enterprise_project.customer_baseline WHERE enterprise_id = $1', [
      enterpriseId,
    ]);
    await admin.query(
      'DELETE FROM enterprise_project.customer_material_version WHERE enterprise_id = $1',
      [enterpriseId],
    );
    await admin.query('DELETE FROM enterprise_project.customer_material WHERE enterprise_id = $1', [
      enterpriseId,
    ]);
    await admin.query('DELETE FROM enterprise_project.project WHERE enterprise_id = $1', [
      enterpriseId,
    ]);
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}

async function seedDownstreamReferenceEdges(targetVersionId: string): Promise<void> {
  const owners = [
    ['GapAnalysis', 'GAP_ANALYSIS_BASELINE_INPUT', '/input/customerBaselineRef'],
    ['DeliveryPlan', 'DELIVERY_PLAN_BASELINE_INPUT', '/baselineRefs/0'],
    ['ProjectContext', 'PROJECT_CONTEXT_BASELINE_INPUT', '/activeBaselineRefs/0'],
  ] as const;
  for (const [ownerObjectType, referencePurpose, referencePath] of owners) {
    await admin.query(
      `INSERT INTO enterprise_project.reference_edge
         (owner_object_type, owner_object_id, owner_version_id, owner_payload_hash,
          reference_path, target_module, target_object_type, target_object_id,
          target_version_id, target_payload_hash, reference_purpose,
          enterprise_id, project_id, source_command_id)
       VALUES ($1, $2, $3, $4, $5, 'EnterpriseProject', 'CustomerBaseline',
               $6, $7, $8, $9, $10, $11, $12)`,
      [
        ownerObjectType,
        newUuidV7(),
        newUuidV7(),
        Buffer.alloc(32, 0x67),
        referencePath,
        baselineId,
        targetVersionId,
        Buffer.alloc(32, 0x68),
        referencePurpose,
        enterpriseId,
        projectId,
        newUuidV7(),
      ],
    );
  }
}

try {
  await seed();
  const materialRef = versionedRef(
    'CustomerMaterial',
    customerMaterialId,
    customerMaterialVersionId,
    enterpriseId,
    projectId,
  );
  const agent = contextFor(enterpriseId, projectId, 'AGENT');
  const agentResult = await handleCreateCustomerBaselineDraft(
    db,
    agent,
    envelope(
      agent,
      'project.create_customer_baseline_draft',
      'agent-missing',
      {
        projectRef: projectRef(enterpriseId, projectId),
        expectations: [
          expectation(enterpriseId, projectId, 'MISSING_CONFIRMED', 'training.procedure', true),
        ],
        baselinePolicyRef: policyRef(enterpriseId, projectId),
      },
      baselineId,
    ),
  );
  console.log(
    '[agent] MISSING_CONFIRMED ->',
    agentResult.status,
    agentResult.status === 'REJECTED' ? agentResult.errorCode : 'UNEXPECTED',
  );

  const human = contextFor(enterpriseId, projectId, 'HUMAN');
  const firstDraft = await handleCreateCustomerBaselineDraft(
    db,
    human,
    envelope(
      human,
      'project.create_customer_baseline_draft',
      'cb003-draft',
      {
        projectRef: projectRef(enterpriseId, projectId),
        expectations: [
          {
            ...expectation(enterpriseId, projectId, 'PRESENT', 'purchasing.procedure'),
            customerMaterialRefs: [materialRef],
          },
          expectation(enterpriseId, projectId, 'NOT_PROVIDED', 'training.procedure'),
          expectation(enterpriseId, projectId, 'UNKNOWN', 'supplier.procedure'),
        ],
        baselinePolicyRef: policyRef(enterpriseId, projectId),
      },
      baselineId,
    ),
  );
  const cb003 = committedRef(firstDraft);
  console.log('[human] CB-003 draft ->', firstDraft.status, cb003.versionId);

  const firstActivationPayload: EnterpriseProject.ProjectActivateCustomerBaselineVersionPayload = {
    baselineVersionRef: cb003,
    reviewSnapshotRef: (() => {
      const snapshotId = newUuidV7();
      return {
        kind: 'SNAPSHOT',
        objectType: 'BaselineReview',
        objectId: snapshotId,
        snapshotId,
        scope: { enterpriseId, projectId },
        contentHash: { algorithm: 'SHA-256', digest: 'b'.repeat(64), canonicalizationVersion: '1' },
      };
    })(),
    impactPolicyRef: policyRef(enterpriseId, projectId),
    justification: justification('BASELINE_ACTIVATION'),
  };
  const firstActivation = await handleActivateCustomerBaselineVersion(
    db,
    human,
    envelope(
      human,
      'project.activate_customer_baseline_version',
      'cb003-activate',
      firstActivationPayload,
      baselineId,
      '1',
    ),
  );
  console.log('[human] CB-003 activate ->', firstActivation.status, cb003.versionId);
  const cb003Items = await admin.query<{ expected_material_key: string; status: string }>(
    `SELECT expected_material_key, status
       FROM enterprise_project.customer_baseline_item
      WHERE version_id = $1
      ORDER BY expected_material_key`,
    [cb003.versionId],
  );
  console.log(
    '[verify] CB-003 states ->',
    cb003Items.rows.map((row) => `${row.expected_material_key}=${row.status}`).join(', '),
  );
  await seedDownstreamReferenceEdges(cb003.versionId);

  const secondDraft = await handleCreateCustomerBaselineDraft(
    db,
    human,
    envelope(
      human,
      'project.create_customer_baseline_draft',
      'cb004-draft',
      {
        projectRef: projectRef(enterpriseId, projectId),
        previousVersionRef: cb003,
        expectations: [expectation(enterpriseId, projectId, 'UNKNOWN', 'supplier.procedure.v2')],
        baselinePolicyRef: policyRef(enterpriseId, projectId),
      },
      baselineId,
      '2',
    ),
  );
  const cb004 = committedRef(secondDraft);
  console.log('[human] CB-004 draft ->', secondDraft.status, cb004.versionId);

  const secondSnapshotId = newUuidV7();
  const secondActivationPayload: EnterpriseProject.ProjectActivateCustomerBaselineVersionPayload = {
    ...firstActivationPayload,
    baselineVersionRef: cb004,
    reviewSnapshotRef: {
      ...firstActivationPayload.reviewSnapshotRef,
      objectId: secondSnapshotId,
      snapshotId: secondSnapshotId,
    },
  };
  const secondActivation = await handleActivateCustomerBaselineVersion(
    db,
    human,
    envelope(
      human,
      'project.activate_customer_baseline_version',
      'cb004-activate',
      secondActivationPayload,
      baselineId,
      '3',
    ),
  );
  console.log(
    '[human] CB-004 activate ->',
    secondActivation.status,
    'previousActiveRef=',
    cb003.versionId,
  );
  const oldReferences = await admin.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM enterprise_project.reference_edge
      WHERE enterprise_id = $1
        AND target_object_type = 'CustomerBaseline'
        AND target_object_id = $2
        AND target_version_id = $3`,
    [enterpriseId, baselineId, cb003.versionId],
  );
  const impact = await admin.query<{ impact_status: string; affected_count: string }>(
    `SELECT impact_status, jsonb_array_length(affected_references)::text AS affected_count
       FROM enterprise_project.customer_baseline_impact_review
      WHERE customer_baseline_id = $1 AND new_version_id = $2`,
    [baselineId, cb004.versionId],
  );
  console.log(
    '[verify] old refs preserved / impact ->',
    oldReferences.rows[0]?.count,
    impact.rows[0]?.impact_status,
    impact.rows[0]?.affected_count,
  );

  const active = await handleGetActiveBaselineRefs(db, human, {
    projectRef: projectRef(enterpriseId, projectId),
  });
  console.log(
    '[verify] active baseline ->',
    active.customerBaselineRef?.versionId,
    active.aggregateVersions,
  );
} finally {
  try {
    if (adminConnected) await cleanup();
  } finally {
    await pool.end();
    await admin.end();
  }
}
