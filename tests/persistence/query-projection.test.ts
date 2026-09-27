// IM-03 WI-11 (issue #67): real PostgreSQL coverage for authoritative Query,
// Source Slice trimming, stable Board cursor, and rebuildable projection state.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  calculateProjectBoardSnapshotHash,
  consumeProjectBoardEvent,
  createEnterpriseProjectDatabase,
  handleGetProjectBoardSlice,
  handleGetProjectContextSource,
  pauseProjectBoardProjection,
  PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
  PROJECT_PROJECTION_EVENT_INVALID,
  PROJECT_QUERY_AUDIENCE_INVALID,
  PROJECT_QUERY_CONTEXT_EXPIRED,
  PROJECT_QUERY_CURSOR_INVALID,
  PROJECT_QUERY_NOT_FOUND,
  PROJECT_QUERY_PURPOSE_FORBIDDEN,
  PROJECT_QUERY_REF_INVALID,
  PROJECT_QUERY_SCOPE_MISMATCH,
  PROJECT_PROJECTION_REBUILD_INVALID,
  readProjectBoardProjection,
  rebuildProjectBoardProjection,
  recordProjectBoardSourceEvent,
  recordProjectBoardProjectionFailure,
  withProjectionTransaction,
  type EnterpriseProjectTransactionContext,
  type ProjectBoardEventDelta,
  type ProjectBoardProjectionItemInput,
  type ProjectBoardSnapshotExport,
} from '@zhiju/enterprise-project';
import { newUuidV7 } from '@zhiju/shared-kernel';
import type { Common, EnterpriseProject } from '@zhiju/contracts';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const PROBE_ROLE = 'im03_wi11_probe';
const PROBE_PASSWORD = 'im03-wi11-probe';
const PRINCIPAL = 'a7a7a7a7-a7a7-77a7-87a7-a7a7a7a7a7a7';
const ACTOR = 'a8a8a8a8-a8a8-78a8-88a8-a8a8a8a8a8a8';
const DECISION = 'a9a9a9a9-a9a9-79a9-89a9-a9a9a9a9a9a9';
const POLICY = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const DECISION_HASH = Buffer.alloc(32, 0xa1);

function contextFor(
  enterpriseId: string,
  projectId: string,
  overrides: Partial<EnterpriseProjectTransactionContext> = {},
): EnterpriseProjectTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: DECISION_HASH,
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY,
    enterpriseId,
    allowedProjectIds: [projectId],
    correlationId: newUuidV7(),
    ...overrides,
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

function contentHash(digest: string): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest,
    canonicalizationVersion: '1',
  };
}

function watermark(
  projectId: string,
  sequence: number,
  observedAt: string,
): Common.SourceWatermark {
  return {
    sourceModule: 'enterprise_project',
    partition: projectId,
    sequence,
    observedAt,
  };
}

function item(
  deliveryItemId: string,
  itemKey: string,
  title: string,
  executionStatus: EnterpriseProject.DeliveryExecutionStatus = 'READY',
): ProjectBoardProjectionItemInput {
  return {
    deliveryItemId,
    itemKey,
    itemType: 'delivery.output',
    title,
    commitmentStatus: 'APPROVED',
    executionStatus,
    blockerRefs: [],
  };
}

function snapshot(
  enterpriseId: string,
  projectId: string,
  sequence: number,
  sourceEventId: string,
  items: readonly ProjectBoardProjectionItemInput[],
): ProjectBoardSnapshotExport {
  const snapshotAt = `2026-08-27T00:0${Math.min(sequence, 9)}:00.000Z`;
  const sourceWatermark = watermark(projectId, sequence, snapshotAt);
  const base = {
    projectRef: projectRef(enterpriseId, projectId),
    snapshotAt,
    sourceWatermark,
    items,
    sourceSnapshotHash: contentHash('0'.repeat(64)),
  } satisfies ProjectBoardSnapshotExport;
  return {
    ...base,
    sourceEventId,
    sourceSnapshotHash: contentHash(calculateProjectBoardSnapshotHash(base)),
  };
}

function delta(
  enterpriseId: string,
  projectId: string,
  sequence: number,
  eventId: string,
  itemId: string,
  operation: 'UPSERT' | 'REMOVE',
  changedItem?: ProjectBoardProjectionItemInput,
): ProjectBoardEventDelta {
  const observedAt = `2026-08-27T00:1${Math.min(sequence, 9)}:00.000Z`;
  return {
    projectRef: projectRef(enterpriseId, projectId),
    eventId,
    eventType: 'project.delivery_item.changed',
    operation,
    sourceWatermark: watermark(projectId, sequence, observedAt),
    itemId,
    ...(changedItem === undefined ? {} : { item: changedItem }),
  };
}

interface QueryFixture {
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly profileSnapshotId: string;
  readonly qmsConfigurationId: string;
  readonly qmsRevisionId: string;
  readonly productScopeSnapshotId: string;
  readonly profileHash: Buffer;
  readonly qmsHash: Buffer;
  readonly productHash: Buffer;
}

function snapshotRef(
  objectType: string,
  objectId: string,
  enterpriseId: string,
  payloadHash: Buffer,
): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId,
    snapshotId: objectId,
    scope: { enterpriseId },
    contentHash: contentHash(payloadHash.toString('hex')),
  };
}

function versionedRef(
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

async function seedQueryFixture(admin: pg.Client, withBinding = true): Promise<QueryFixture> {
  const enterpriseId = newUuidV7();
  const projectId = newUuidV7();
  const profileSnapshotId = newUuidV7();
  const qmsConfigurationId = newUuidV7();
  const qmsRevisionId = newUuidV7();
  const productScopeSnapshotId = newUuidV7();
  const factId = newUuidV7();
  const factVersionId = newUuidV7();
  const memberPolicyVersionId = newUuidV7();
  const profileHash = Buffer.alloc(32, 0xb1);
  const qmsHash = Buffer.alloc(32, 0xb2);
  const productHash = Buffer.alloc(32, 0xb3);
  const memberPolicyHash = Buffer.alloc(32, 0xb4);
  const memberPolicyRef = versionedRef('Policy', newUuidV7(), memberPolicyVersionId, enterpriseId);
  const profileRef = snapshotRef(
    'EnterpriseProfileSnapshot',
    profileSnapshotId,
    enterpriseId,
    profileHash,
  );
  const profileBindingRef = {
    ...profileRef,
    bindingSecret: 'binding-secret',
  } as unknown as Common.SnapshotRef;
  const qmsRef = versionedRef('QMSConfiguration', qmsConfigurationId, qmsRevisionId, enterpriseId);
  const productRef = snapshotRef(
    'ProductScopeSnapshot',
    productScopeSnapshotId,
    enterpriseId,
    productHash,
  );
  await admin.query('BEGIN');
  try {
    await admin.query(
      `INSERT INTO enterprise_project.project
         (project_id, enterprise_id, display_code, title, objective,
          member_policy_ref, member_policy_version_id, member_policy_payload_hash,
          created_by_principal_id, created_by_actor_snapshot_id, last_command_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
      [
        projectId,
        enterpriseId,
        `WI11-${projectId.slice(-8)}`,
        'WI-11 Query fixture project',
        'Exercise exact Source Slice references and fail-closed query access.',
        JSON.stringify(memberPolicyRef),
        memberPolicyVersionId,
        memberPolicyHash,
        PRINCIPAL,
        ACTOR,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.enterprise_fact_version
         (version_id, enterprise_fact_id, enterprise_id, version_no, status,
          value, source_refs, payload_hash, proposed_by_principal_id,
          proposed_by_actor_snapshot_id, authorization_decision_id, source_command_id)
       VALUES ($1, $2, $3, 1, 'CONFIRMED', $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10)`,
      [
        factVersionId,
        factId,
        enterpriseId,
        JSON.stringify({ secret: 'do-not-leak' }),
        JSON.stringify([{ secret: 'sensitive-source-ref' }]),
        Buffer.alloc(32, 0xb6),
        PRINCIPAL,
        ACTOR,
        DECISION,
        newUuidV7(),
      ],
    );
    await admin.query(
      `INSERT INTO enterprise_project.enterprise_fact
         (enterprise_fact_id, enterprise_id, fact_type, risk_level,
          current_version_id, current_status, created_by_principal_id,
          last_command_id)
       VALUES ($1, $2, 'enterprise.risk', 'HIGH', $3, 'CONFIRMED', $4, $5)`,
      [factId, enterpriseId, factVersionId, PRINCIPAL, newUuidV7()],
    );
    if (withBinding) {
      await admin.query(
        `INSERT INTO enterprise_project.project_snapshot_binding
           (binding_id, enterprise_id, project_id, binding_purpose,
            enterprise_profile_snapshot_ref, enterprise_profile_snapshot_id,
            enterprise_profile_payload_hash, qms_configuration_ref,
            qms_configuration_id, qms_configuration_revision_id,
            qms_configuration_revision_hash, product_scope_snapshot_ref,
            product_scope_snapshot_id, product_scope_payload_hash,
            member_policy_ref, member_policy_version_id, member_policy_payload_hash,
            payload_hash, bound_by_principal_id, bound_by_actor_snapshot_id,
            authorization_decision_id, source_command_id)
         VALUES ($1, $2, $3, 'PROJECT_START', $4::jsonb, $5, $6, $7::jsonb,
                 $8, $9, $10, $11::jsonb, $12, $13, $14::jsonb, $15, $16,
                 $17, $18, $19, $20, $21)`,
        [
          newUuidV7(),
          enterpriseId,
          projectId,
          JSON.stringify(profileBindingRef),
          profileSnapshotId,
          profileHash,
          JSON.stringify(qmsRef),
          qmsConfigurationId,
          qmsRevisionId,
          qmsHash,
          JSON.stringify(productRef),
          productScopeSnapshotId,
          productHash,
          JSON.stringify(memberPolicyRef),
          memberPolicyVersionId,
          memberPolicyHash,
          Buffer.alloc(32, 0xb5),
          PRINCIPAL,
          ACTOR,
          DECISION,
          newUuidV7(),
        ],
      );
    }
    await admin.query('COMMIT');
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
  return {
    enterpriseId,
    projectId,
    profileSnapshotId,
    qmsConfigurationId,
    qmsRevisionId,
    productScopeSnapshotId,
    profileHash,
    qmsHash,
    productHash,
  };
}

describe.skipIf(!gateEnabled)('EnterpriseProject WI-11 (real PostgreSQL)', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createEnterpriseProjectDatabase>;

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
      `GRANT platform_context_establisher, enterprise_project_app, projection_app TO ${PROBE_ROLE}`,
    );
    const url = new URL(databaseUrl ?? '');
    url.username = PROBE_ROLE;
    url.password = PROBE_PASSWORD;
    pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
    db = createEnterpriseProjectDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  async function readState(
    context: EnterpriseProjectTransactionContext,
  ): Promise<Awaited<ReturnType<typeof readProjectBoardProjection>>> {
    return withProjectionTransaction(db, context, (trx) =>
      readProjectBoardProjection(trx, context.enterpriseId, context.allowedProjectIds[0] ?? ''),
    );
  }

  it('rebuilds Snapshot Export plus ordered upsert/remove deltas and atomically swaps the alias', async () => {
    const enterpriseId = newUuidV7();
    const projectId = newUuidV7();
    const context = contextFor(enterpriseId, projectId);
    const firstItem = item(newUuidV7(), 'b-item', 'Original B');
    const removedItem = item(newUuidV7(), 'a-item', 'Removed A');
    const snapshotExport = snapshot(enterpriseId, projectId, 1, newUuidV7(), [
      firstItem,
      removedItem,
    ]);
    const updatedItem = { ...firstItem, title: 'Updated B' };
    const unsafeBlockerRef = {
      kind: 'OBJECT',
      objectType: 'DeliveryBlocker',
      objectId: newUuidV7(),
      scope: { enterpriseId, projectId },
      secret: 'projection-secret',
    } as unknown as Common.ObjectRef;
    await expect(
      rebuildProjectBoardProjection(
        db,
        context,
        snapshot(enterpriseId, projectId, 1, newUuidV7(), [
          { ...firstItem, blockerRefs: [unsafeBlockerRef] },
        ]),
      ),
    ).rejects.toMatchObject({ code: PROJECT_PROJECTION_REBUILD_INVALID });
    await expect(
      recordProjectBoardSourceEvent(
        db,
        context,
        delta(
          enterpriseId,
          projectId,
          0,
          newUuidV7(),
          firstItem.deliveryItemId,
          'UPSERT',
          updatedItem,
        ),
      ),
    ).rejects.toMatchObject({ code: PROJECT_PROJECTION_EVENT_INVALID });
    const validSourceModuleEvent = delta(
      enterpriseId,
      projectId,
      2,
      newUuidV7(),
      firstItem.deliveryItemId,
      'UPSERT',
      updatedItem,
    );
    const invalidSourceModuleEvent = {
      ...validSourceModuleEvent,
      sourceWatermark: {
        ...validSourceModuleEvent.sourceWatermark,
        sourceModule: 'enterprise-project',
      },
    };
    await expect(
      recordProjectBoardSourceEvent(db, context, invalidSourceModuleEvent),
    ).rejects.toMatchObject({
      code: PROJECT_PROJECTION_EVENT_INVALID,
    });
    const deltas = [
      delta(
        enterpriseId,
        projectId,
        2,
        newUuidV7(),
        firstItem.deliveryItemId,
        'UPSERT',
        updatedItem,
      ),
      delta(enterpriseId, projectId, 3, newUuidV7(), removedItem.deliveryItemId, 'REMOVE'),
    ];
    const [upsertDelta, removeDelta] = deltas;
    if (!upsertDelta || !removeDelta) {
      throw new Error('Projection delta fixture must contain both ordered events');
    }
    const first = await rebuildProjectBoardProjection(db, context, snapshotExport, deltas);
    const second = await rebuildProjectBoardProjection(db, context, snapshotExport, deltas);
    expect(first).toMatchObject({ rowCount: 1, checkpointSequence: 3, aliasSwitched: true });
    expect(second.domainChecksum).toBe(first.domainChecksum);
    const state = await readState(context);
    expect(state.version?.status).toBe('READY');
    expect(state.version?.source_event_id).toBe(deltas[1]?.eventId);
    expect(Number(state.version?.source_sequence)).toBe(3);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]?.item_key).toBe('b-item');
    expect(state.rows[0]?.title).toBe('Updated B');
    expect(Number(state.checkpoint?.last_sequence)).toBe(3);
    expect(Number(state.checkpoint?.target_sequence)).toBe(3);
    expect(state.sourceState?.latest_event_id).toBe(deltas[1]?.eventId);
    expect(await recordProjectBoardSourceEvent(db, context, removeDelta)).toEqual({
      status: 'DUPLICATE',
      targetSequence: 3,
    });
    await expect(consumeProjectBoardEvent(db, context, upsertDelta)).rejects.toMatchObject({
      code: PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
    });
    const versions = await admin.query<{ count: string }>(
      `SELECT count(*) AS count
         FROM projection.project_board_projection_version
        WHERE enterprise_id = $1 AND project_id = $2`,
      [enterpriseId, projectId],
    );
    expect(versions.rows[0]?.count).toBe('2');
    expect(state.alias?.projection_version_id).toBe(second.projectionVersionId);
  });

  it('provides stable cursor pagination and rejects tampered, filtered, expired, and cross-scope cursors', async () => {
    const enterpriseId = newUuidV7();
    const projectId = newUuidV7();
    const context = contextFor(enterpriseId, projectId);
    const firstItem = item(newUuidV7(), 'item-2', 'Second item');
    const secondItem = item(newUuidV7(), 'item-10', 'Tenth item', 'COMPLETED');
    await rebuildProjectBoardProjection(
      db,
      context,
      snapshot(enterpriseId, projectId, 1, newUuidV7(), [firstItem, secondItem]),
    );
    const basePayload: EnterpriseProject.ProjectGetProjectBoardSlicePayload = {
      projectRef: projectRef(enterpriseId, projectId),
      statuses: [],
      itemTypes: [],
      page: { pageSize: 1 },
    };
    const firstPage = await handleGetProjectBoardSlice(db, context, basePayload);
    expect(firstPage.items.map((row) => row.itemKey)).toEqual(['item-10']);
    expect(firstPage.nextCursor).toBeDefined();
    expect(firstPage.projectionStatus).toBe('READY');
    const cursor = firstPage.nextCursor;
    if (cursor === undefined) throw new Error('expected a cursor for the second page');
    const secondPage = await handleGetProjectBoardSlice(db, context, {
      ...basePayload,
      page: { pageSize: 1, cursor },
    });
    expect(secondPage.items.map((row) => row.itemKey)).toEqual(['item-2']);
    expect(secondPage.nextCursor).toBeUndefined();
    await expect(
      handleGetProjectBoardSlice(db, context, {
        ...basePayload,
        page: { pageSize: 1, cursor: `${cursor}tampered` },
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_CURSOR_INVALID });
    await expect(
      handleGetProjectBoardSlice(db, context, {
        ...basePayload,
        statuses: ['READY'],
        page: { pageSize: 1, cursor },
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_CURSOR_INVALID });
    const otherProject = newUuidV7();
    await expect(
      handleGetProjectBoardSlice(db, context, {
        ...basePayload,
        projectRef: projectRef(enterpriseId, otherProject),
        page: { pageSize: 1, cursor },
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_SCOPE_MISMATCH });
    await expect(
      handleGetProjectBoardSlice(
        db,
        contextFor(enterpriseId, projectId, {
          authorizationDecisionExpiresAt: new Date(Date.now() - 1000),
        }),
        basePayload,
      ),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_CONTEXT_EXPIRED });
  });

  it('preserves a higher recorded target while consuming a lower event and exposes lag', async () => {
    const enterpriseId = newUuidV7();
    const projectId = newUuidV7();
    const context = contextFor(enterpriseId, projectId);
    const baseItem = item(newUuidV7(), 'item-a', 'Base');
    const eventTwoItem = { ...baseItem, title: 'Event two' };
    const eventThreeItem = { ...baseItem, title: 'Event three' };
    await rebuildProjectBoardProjection(
      db,
      context,
      snapshot(enterpriseId, projectId, 1, newUuidV7(), [baseItem]),
    );
    const eventTwo = delta(
      enterpriseId,
      projectId,
      2,
      newUuidV7(),
      baseItem.deliveryItemId,
      'UPSERT',
      eventTwoItem,
    );
    const eventThree = delta(
      enterpriseId,
      projectId,
      3,
      newUuidV7(),
      baseItem.deliveryItemId,
      'UPSERT',
      eventThreeItem,
    );
    expect(await recordProjectBoardSourceEvent(db, context, eventTwo)).toMatchObject({
      status: 'RECORDED',
      targetSequence: 2,
    });
    expect(await recordProjectBoardSourceEvent(db, context, eventThree)).toMatchObject({
      status: 'RECORDED',
      targetSequence: 3,
    });
    const consumed = await consumeProjectBoardEvent(db, context, eventTwo);
    expect(consumed.checkpointSequence).toBe(2);
    const state = await readState(context);
    expect(state.rows[0]?.title).toBe('Event two');
    expect(Number(state.checkpoint?.last_sequence)).toBe(2);
    expect(Number(state.checkpoint?.target_sequence)).toBe(3);
    expect(Number(state.sourceState?.latest_sequence)).toBe(3);
    const page = await handleGetProjectBoardSlice(db, context, {
      projectRef: projectRef(enterpriseId, projectId),
      statuses: [],
      itemTypes: [],
      page: { pageSize: 10 },
    });
    expect(page.projectionLag).toBe(1);
    expect(page.projectionStatus).toBe('STALE');
    expect(page.sourceWatermarks.map((watermarkValue) => watermarkValue.sequence)).toEqual([3, 2]);
    expect(consumed.projectionVersionId).toBe(state.alias?.projection_version_id);
  });

  it('pauses projection without changing the alias, then rebuilds to recover the checkpoint', async () => {
    const enterpriseId = newUuidV7();
    const projectId = newUuidV7();
    const context = contextFor(enterpriseId, projectId);
    const baseItem = item(newUuidV7(), 'item-a', 'Base');
    const changedItem = { ...baseItem, title: 'After pause' };
    await rebuildProjectBoardProjection(
      db,
      context,
      snapshot(enterpriseId, projectId, 1, newUuidV7(), [baseItem]),
    );
    const beforePause = await readState(context);
    expect(
      await pauseProjectBoardProjection(db, context, projectRef(enterpriseId, projectId)),
    ).toEqual(expect.objectContaining({ status: 'PAUSED', targetSequence: 1 }));
    const event = delta(
      enterpriseId,
      projectId,
      2,
      newUuidV7(),
      baseItem.deliveryItemId,
      'UPSERT',
      changedItem,
    );
    await recordProjectBoardSourceEvent(db, context, event);
    const pausedPage = await handleGetProjectBoardSlice(db, context, {
      projectRef: projectRef(enterpriseId, projectId),
      statuses: [],
      itemTypes: [],
      page: { pageSize: 10 },
    });
    expect(pausedPage.projectionLag).toBe(1);
    expect(pausedPage.projectionStatus).toBe('STALE');
    const pausedState = await readState(context);
    expect(pausedState.alias?.projection_version_id).toBe(beforePause.alias?.projection_version_id);
    await expect(consumeProjectBoardEvent(db, context, event)).rejects.toMatchObject({
      code: PROJECT_PROJECTION_CHECKPOINT_CONFLICT,
    });
    await rebuildProjectBoardProjection(
      db,
      context,
      snapshot(enterpriseId, projectId, 2, event.eventId, [changedItem]),
    );
    const recoveredPage = await handleGetProjectBoardSlice(db, context, {
      projectRef: projectRef(enterpriseId, projectId),
      statuses: [],
      itemTypes: [],
      page: { pageSize: 10 },
    });
    expect(recoveredPage.projectionLag).toBe(0);
    expect(recoveredPage.projectionStatus).toBe('READY');
  });

  it('keeps projection rows isolated and immutable under the runtime role', async () => {
    const enterpriseId = newUuidV7();
    const projectId = newUuidV7();
    const context = contextFor(enterpriseId, projectId);
    const boardItem = item(newUuidV7(), 'item-a', 'Immutable row');
    await rebuildProjectBoardProjection(
      db,
      context,
      snapshot(enterpriseId, projectId, 1, newUuidV7(), [boardItem]),
    );
    const state = await readState(context);
    const versionId = state.version?.projection_version_id;
    if (versionId === undefined) throw new Error('expected a ready projection version');
    await expect(
      withProjectionTransaction(db, context, async (trx) =>
        trx
          .updateTable('projection.project_board')
          .set({ title: 'tampered' })
          .where('projection_version_id', '=', versionId)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withProjectionTransaction(db, context, async (trx) =>
        trx
          .updateTable('projection.projection_source_state')
          .set({ latest_sequence: 0 })
          .where('enterprise_id', '=', enterpriseId)
          .where('project_id', '=', projectId)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const failure = await recordProjectBoardProjectionFailure(db, context, {
      projectRef: projectRef(enterpriseId, projectId),
      eventType: 'project.delivery_item.changed',
      failureCode: 'PROJECT_PROJECTION_EVENT_INVALID',
      safeSummary: 'The event was rejected by the projection boundary.',
    });
    await expect(
      withProjectionTransaction(db, context, async (trx) =>
        trx
          .updateTable('projection.projection_failure')
          .set({ safe_summary: 'tampered' })
          .where('failure_id', '=', failure.failureId)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withProjectionTransaction(db, context, async (trx) =>
        trx
          .deleteFrom('projection.projection_failure')
          .where('failure_id', '=', failure.failureId)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withProjectionTransaction(db, context, async (trx) =>
        trx
          .deleteFrom('projection.project_board')
          .where('projection_version_id', '=', versionId)
          .execute(),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    const otherProjectState = await withProjectionTransaction(db, context, (trx) =>
      readProjectBoardProjection(trx, enterpriseId, newUuidV7()),
    );
    expect(otherProjectState.alias).toBeUndefined();
    expect(otherProjectState.rows).toEqual([]);
  });

  it('returns exact Source Slice refs with omissions/redactions and fails closed before reads', async () => {
    const fixture = await seedQueryFixture(admin);
    const context = contextFor(fixture.enterpriseId, fixture.projectId);
    const result = await handleGetProjectContextSource(db, context, {
      projectRef: projectRef(fixture.enterpriseId, fixture.projectId),
      purpose: 'context.snapshot.read',
      audience: {
        kind: 'OBJECT',
        objectType: 'Principal',
        objectId: PRINCIPAL,
        scope: { enterpriseId: fixture.enterpriseId },
      },
      requestedKinds: [
        'PROJECT',
        'ENTERPRISE_PROFILE',
        'QMS_CONFIGURATION',
        'PRODUCT_SCOPE',
        'ENTERPRISE_FACTS',
      ],
    });
    expect(result.projectRef).toEqual(projectRef(fixture.enterpriseId, fixture.projectId));
    expect(result.enterpriseProfileSnapshotRef.contentHash.digest).toBe(
      fixture.profileHash.toString('hex'),
    );
    expect(JSON.stringify(result.enterpriseProfileSnapshotRef)).not.toContain('binding-secret');
    expect(result.qmsConfigurationRef).toEqual(
      versionedRef(
        'QMSConfiguration',
        fixture.qmsConfigurationId,
        fixture.qmsRevisionId,
        fixture.enterpriseId,
      ),
    );
    expect(result.productScopeSnapshotRef.contentHash.digest).toBe(
      fixture.productHash.toString('hex'),
    );
    expect(result.activeBaselineRefs).toEqual([]);
    expect(result.factItems).toHaveLength(1);
    expect(result.factItems[0]).toMatchObject({
      factType: 'enterprise.risk',
      riskLevel: 'HIGH',
      status: 'CONFIRMED',
      value: { presence: 'REDACTED' },
    });
    expect(result.factItems[0]).not.toHaveProperty('sourceRefs');
    expect(JSON.stringify(result)).not.toContain('do-not-leak');
    expect(result.omissions).toEqual(
      expect.arrayContaining([{ kind: 'ACTIVE_BASELINES', reasonCode: 'KIND_NOT_REQUESTED' }]),
    );
    expect(result.redactions).toEqual(
      expect.arrayContaining([
        { path: '/factItems/*/value', reasonCode: 'PROJECT_QUERY_SENSITIVE_VALUE_REDACTED' },
        { path: '/factItems/*/sourceRefs', reasonCode: 'PROJECT_QUERY_SOURCE_REFS_REDACTED' },
      ]),
    );
    const formResult = await handleGetProjectContextSource(db, context, {
      projectRef: projectRef(fixture.enterpriseId, fixture.projectId),
      purpose: 'record.form.read',
      audience: {
        kind: 'OBJECT',
        objectType: 'Principal',
        objectId: PRINCIPAL,
        scope: { enterpriseId: fixture.enterpriseId },
      },
      requestedKinds: ['ENTERPRISE_FACTS'],
    });
    expect(formResult.factItems).toEqual([]);
    expect(formResult.redactions).toEqual([]);
    expect(formResult.omissions).toEqual(
      expect.arrayContaining([{ kind: 'ENTERPRISE_FACTS', reasonCode: 'PURPOSE_FORBIDDEN' }]),
    );
    expect(result.sourceWatermark).toMatchObject({
      sourceModule: 'enterprise_project',
      partition: fixture.projectId,
      sequence: 0,
    });
    const missingBinding = await seedQueryFixture(admin, false);
    await expect(
      handleGetProjectContextSource(
        db,
        contextFor(missingBinding.enterpriseId, missingBinding.projectId),
        {
          projectRef: projectRef(missingBinding.enterpriseId, missingBinding.projectId),
          purpose: 'context.snapshot.read',
          audience: {
            kind: 'OBJECT',
            objectType: 'Principal',
            objectId: PRINCIPAL,
            scope: { enterpriseId: missingBinding.enterpriseId },
          },
          requestedKinds: ['PROJECT'],
        },
      ),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_NOT_FOUND });
    await expect(
      handleGetProjectContextSource(db, context, {
        projectRef: projectRef(fixture.enterpriseId, fixture.projectId),
        purpose: 'context.snapshot.read',
        audience: {
          kind: 'OBJECT',
          objectType: 'Principal',
          objectId: newUuidV7(),
          scope: { enterpriseId: fixture.enterpriseId },
        },
        requestedKinds: ['PROJECT'],
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_AUDIENCE_INVALID });
    await expect(
      handleGetProjectContextSource(db, context, {
        projectRef: projectRef(fixture.enterpriseId, fixture.projectId),
        purpose: 'unsupported.purpose',
        audience: {
          kind: 'OBJECT',
          objectType: 'Principal',
          objectId: PRINCIPAL,
          scope: { enterpriseId: fixture.enterpriseId },
        },
        requestedKinds: ['PROJECT'],
      } as unknown as EnterpriseProject.ProjectGetProjectContextSourcePayload),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_PURPOSE_FORBIDDEN });
    await expect(
      handleGetProjectContextSource(db, context, {
        projectRef: projectRef(fixture.enterpriseId, fixture.projectId),
        purpose: 'context.snapshot.read',
        audience: {
          kind: 'OBJECT',
          objectType: 'Principal',
          objectId: PRINCIPAL,
          scope: { enterpriseId: fixture.enterpriseId },
        },
        requestedKinds: ['UNSUPPORTED_KIND'],
      } as unknown as EnterpriseProject.ProjectGetProjectContextSourcePayload),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_REF_INVALID });
  });

  it('rejects cross-project projection rebuild input before opening a write transaction', async () => {
    const enterpriseId = newUuidV7();
    const allowedProjectId = newUuidV7();
    const forbiddenProjectId = newUuidV7();
    const context = contextFor(enterpriseId, allowedProjectId);
    await expect(
      rebuildProjectBoardProjection(
        db,
        context,
        snapshot(enterpriseId, forbiddenProjectId, 1, newUuidV7(), [
          item(newUuidV7(), 'forbidden', 'Forbidden'),
        ]),
      ),
    ).rejects.toMatchObject({ code: PROJECT_PROJECTION_REBUILD_INVALID });
    await expect(
      handleGetProjectBoardSlice(db, context, {
        projectRef: projectRef(enterpriseId, forbiddenProjectId),
        statuses: [],
        itemTypes: [],
        page: { pageSize: 10 },
      }),
    ).rejects.toMatchObject({ code: PROJECT_QUERY_SCOPE_MISMATCH });
  });
});
