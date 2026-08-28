import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Artifact, Common } from '@zhiju/contracts';
import {
  ARTIFACT_EXPECTED_VERSION_REQUIRED,
  ARTIFACT_HUMAN_ONLY_DENIED,
  ARTIFACT_IDENTITY_CONFLICT,
  ARTIFACT_NOT_ACTIVE,
  ARTIFACT_QUERY_NOT_FOUND,
  ARTIFACT_SCOPE_INVALID,
  ArtifactRepository,
  CONCURRENCY_CONFLICT,
  createArtifactDatabase,
  digestCanonicalPayload,
  executeArtifactCommand,
  handleArchiveArtifact,
  handleCreateArtifact,
  handleGetArtifact,
  handleUpdateArtifactMetadata,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  type ArtifactCommandEnvelope,
  type ArtifactTransactionContext,
  type ArchiveArtifactPayload,
  type CommandEnvelope,
  type CommandExecutionError,
  type CommandResult,
  type CreateArtifactPayload,
  type UpdateArtifactMetadataPayload,
} from '@zhiju/artifact';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

// IM-04 WI-03 (issue #92): real PostgreSQL acceptance for the Artifact
// business Root, default Branch, metadata CAS and archive boundary.

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE = 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a1a1';
const PROJECT_A = 'b2b2b2b2-b2b2-72b2-82b2-b2b2b2b2b2b2';
const PROJECT_B = 'c3c3c3c3-c3c3-73c3-83c3-c3c3c3c3c3c3';
const PRINCIPAL = 'd4d4d4d4-d4d4-74d4-84d4-d4d4d4d4d4d4';
const AGENT_PRINCIPAL = 'e5e5e5e5-e5e5-75e5-85e5-e5e5e5e5e5e5';
const ACTOR = 'f6f6f6f6-f6f6-76f6-86f6-f6f6f6f6f6f6';
const AGENT_ACTOR = '07070707-0707-7707-8707-070707070707';
const DECISION = '08080808-0808-7808-8808-080808080808';
const POLICY = '09090909-0909-7909-8909-090909090909';
const CORRELATION = '10101010-1010-7010-8010-101010101010';
const DELIVERY_ITEM = '11111111-1111-7111-8111-111111111111';
const DELIVERY_VERSION = '12121212-1212-7212-8212-121212121212';
const RETENTION_POLICY = '13131313-1313-7313-8313-131313131313';
const RETENTION_VERSION = '14141414-1414-7414-8414-141414141414';

function contextFor(
  allowedProjectIds: readonly string[] = [PROJECT_A],
  overrides: Partial<ArtifactTransactionContext> = {},
): ArtifactTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: Buffer.alloc(32, 0x23),
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY,
    enterpriseId: ENTERPRISE,
    allowedProjectIds,
    correlationId: newUuidV7(),
    ...overrides,
  };
}

function enterpriseRef(): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'Enterprise',
    objectId: ENTERPRISE,
    scope: { enterpriseId: ENTERPRISE },
  };
}

function projectRef(projectId: string): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'Project',
    objectId: projectId,
    scope: { enterpriseId: ENTERPRISE, projectId },
  };
}

function deliveryRef(projectId: string): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'DeliveryItem',
    objectId: DELIVERY_ITEM,
    versionId: DELIVERY_VERSION,
    scope: { enterpriseId: ENTERPRISE, projectId },
  };
}

function enterpriseDeliveryRef(): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'DeliveryItem',
    objectId: DELIVERY_ITEM,
    versionId: DELIVERY_VERSION,
    scope: { enterpriseId: ENTERPRISE },
  };
}

function policyRef(projectId: string): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'Policy',
    objectId: RETENTION_POLICY,
    versionId: RETENTION_VERSION,
    scope: { enterpriseId: ENTERPRISE, projectId },
  };
}

function createPayload(
  title = 'ART-023',
  metadata: CanonicalJsonObject = {
    source: 'fixture',
    nested: { retained: true },
    removeMe: 'drop-me',
  },
  projectId = PROJECT_A,
): CreateArtifactPayload {
  return {
    enterpriseRef: enterpriseRef(),
    definition: {
      businessScope: 'PROJECT_DELIVERABLE',
      originProjectRef: projectRef(projectId),
      artifactType: 'CONTROL_PROCEDURE',
      title,
      classification: 'CUSTOMER_DELIVERY',
      deliveryItemRefs: [deliveryRef(projectId)],
      metadata,
    },
  };
}

function enterpriseControlledPayload(title = 'ART-CTRL-001'): CreateArtifactPayload {
  return {
    enterpriseRef: enterpriseRef(),
    definition: {
      businessScope: 'ENTERPRISE_CONTROLLED',
      artifactType: 'CONTROL_PROCEDURE',
      title,
      classification: 'INTERNAL_CONTROLLED',
      deliveryItemRefs: [enterpriseDeliveryRef()],
      metadata: { source: 'enterprise-fixture' },
    },
  };
}

function justification(reasonCode: string, summary: string): Artifact.Justification {
  return { reasonCode, summary, evidenceRefs: [] };
}

let envelopeSequence = 0;

function commandEnvelope<TPayload>(
  context: ArtifactTransactionContext,
  payload: TPayload,
  options: {
    readonly idempotencyKey?: string;
    readonly targetId?: string;
    readonly expectedAggregateVersion?: string;
    readonly projectId?: string;
    readonly commandType?: string;
    readonly requestPayload?: CanonicalJsonObject;
  } = {},
): ArtifactCommandEnvelope<TPayload> {
  envelopeSequence += 1;
  const requestPayload = options.requestPayload ?? (payload as unknown as CanonicalJsonObject);
  return {
    commandId: newUuidV7(),
    commandType: options.commandType ?? 'artifact.wi03.test',
    commandVersion: '1.0',
    idempotencyScope: 'im04-wi03-test',
    idempotencyKey: options.idempotencyKey ?? `wi03-${envelopeSequence}`,
    requestPayload,
    enterpriseId: context.enterpriseId,
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
    targetType: 'Artifact',
    targetId: options.targetId ?? newUuidV7(),
    ...(options.expectedAggregateVersion === undefined
      ? {}
      : { expectedAggregateVersion: options.expectedAggregateVersion }),
    correlationId: context.correlationId,
    principalId: context.principalId,
    principalKind: context.principalKind,
    actorSnapshotId: context.actorSnapshotId,
    authorizationDecisionId: context.authorizationDecisionId,
    policySnapshotId: context.policySnapshotId,
    payload,
  };
}

function committedPayload(result: CommandResult): CanonicalJsonObject {
  if (result.status !== 'COMMITTED') {
    throw new Error(`expected committed result, received ${result.status}`);
  }
  return result.resultPayload;
}

function returnedPayload(result: CommandResult): CanonicalJsonObject {
  if (result.status === 'COMMITTED') return result.resultPayload;
  if (result.status === 'DUPLICATE' && result.resultPayload !== null) {
    return result.resultPayload;
  }
  throw new Error(`expected a result payload, received ${result.status}`);
}

function viewFrom(result: CommandResult): Artifact.ArtifactView {
  const payload = committedPayload(result);
  return {
    artifactRef: payload.artifactRef,
    aggregateVersion: payload.aggregateVersion,
    definition: payload.definition,
    lifecycleStatus: payload.lifecycleStatus,
    workingHeads: payload.workingHeads,
    approvedRevisionRefs: payload.approvedRevisionRefs,
    effectiveBindingRefs: payload.effectiveBindingRefs,
  } as unknown as Artifact.ArtifactView;
}

interface StatementOutcome {
  readonly allowed: boolean;
  readonly code?: string | undefined;
  readonly message: string;
}

describe.skipIf(!gateEnabled)('Artifact WI-03 business aggregates (real PostgreSQL)', () => {
  let admin: pg.Client;
  let probe: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createArtifactDatabase>;
  let repo: ArtifactRepository;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE im04_wi03_probe LOGIN PASSWORD 'im04-wi03-probe' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(`GRANT platform_context_establisher, artifact_app TO im04_wi03_probe`);
    const url = new URL(databaseUrl ?? '');
    url.username = 'im04_wi03_probe';
    url.password = 'im04-wi03-probe';
    probe = new pg.Client({ connectionString: url.toString() });
    await probe.connect();
    pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
    db = createArtifactDatabase(pool);
    repo = new ArtifactRepository();
  });

  afterAll(async () => {
    await probe.end();
    await pool.end();
    await admin.end();
  });

  async function countRows(table: string, column: string, value: string): Promise<number> {
    const result = await admin.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM artifact.${table} WHERE ${column} = $1`,
      [value],
    );
    return Number(result.rows[0]?.count ?? '-1');
  }

  async function tryQuery(
    connection: pg.Client,
    text: string,
    values?: unknown[],
  ): Promise<StatementOutcome> {
    try {
      await connection.query(text, values);
      return { allowed: true, message: 'ok' };
    } catch (error) {
      const pgError = error as pg.DatabaseError;
      return { allowed: false, code: pgError.code, message: pgError.message };
    }
  }

  async function establishDirectContext(
    connection: pg.Client,
    options: {
      readonly enterpriseId?: string;
      readonly allowedProjectIds?: readonly string[];
      readonly expiresAt?: Date;
    } = {},
  ): Promise<void> {
    await connection.query('SET LOCAL ROLE platform_context_establisher');
    await connection.query(
      `SELECT platform_security.establish_transaction_context(
       'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
      [
        PRINCIPAL,
        ACTOR,
        DECISION,
        Buffer.alloc(32, 0x23),
        options.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
        options.enterpriseId ?? ENTERPRISE,
        [...(options.allowedProjectIds ?? [])],
        CORRELATION,
      ],
    );
    await connection.query('SET LOCAL ROLE artifact_app');
  }

  it('creates ART-023, preserves exact identity, replays idempotently and applies metadata/archive CAS', async () => {
    const context = contextFor();
    const initialPayload = createPayload();
    const createEnvelope = commandEnvelope(context, initialPayload, {
      idempotencyKey: 'art-023-create',
    });
    const created = await handleCreateArtifact(db, context, createEnvelope);
    const createdView = viewFrom(created);
    const artifactId = createdView.artifactRef.objectId;

    expect(createdView.aggregateVersion).toBe(1);
    expect(createdView.lifecycleStatus).toBe('ACTIVE');
    expect(createdView.workingHeads).toHaveLength(1);
    expect(createdView.workingHeads[0]).toMatchObject({
      branchName: 'main',
      workingHeadRef: null,
      headVersion: 0,
      lifecycleStatus: 'ACTIVE',
    });
    expect(createdView.approvedRevisionRefs).toEqual([]);
    expect(createdView.effectiveBindingRefs).toEqual([]);
    expect(createdView.definition.title).toBe('ART-023');
    expect(await countRows('artifact', 'artifact_id', artifactId)).toBe(1);
    expect(await countRows('artifact_branch', 'artifact_id', artifactId)).toBe(1);

    const exactRead = await handleGetArtifact(db, context, {
      artifactRef: createdView.artifactRef,
    });
    expect(exactRead).toEqual(createdView);

    await expect(
      handleUpdateArtifactMetadata(
        db,
        context,
        commandEnvelope(
          context,
          {
            title: 'missing expected version',
            changeReason: justification('MISSING_EXPECTED_VERSION', 'version is required'),
          },
          {
            targetId: artifactId,
            idempotencyKey: 'art-023-metadata-missing-version',
          },
        ),
      ),
    ).rejects.toMatchObject({ code: ARTIFACT_EXPECTED_VERSION_REQUIRED });

    const replay = await handleCreateArtifact(db, context, {
      ...createEnvelope,
      commandId: newUuidV7(),
      targetId: newUuidV7(),
    });
    expect(replay.status).toBe('DUPLICATE');
    expect(returnedPayload(replay)).toEqual(committedPayload(created));
    expect(await countRows('artifact', 'artifact_id', artifactId)).toBe(1);
    expect(await countRows('artifact_branch', 'artifact_id', artifactId)).toBe(1);

    const differentPayload = createPayload('ART-023', { source: 'different-request' });
    await expect(
      handleCreateArtifact(
        db,
        context,
        commandEnvelope(context, differentPayload, {
          idempotencyKey: 'art-023-create',
          requestPayload: differentPayload as unknown as CanonicalJsonObject,
        }),
      ),
    ).rejects.toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT });

    const identityConflict = await handleCreateArtifact(
      db,
      context,
      commandEnvelope(context, differentPayload, { idempotencyKey: 'art-023-identity-conflict' }),
    );
    expect(identityConflict).toMatchObject({
      status: 'REJECTED',
      errorCode: ARTIFACT_IDENTITY_CONFLICT,
    });
    expect(await countRows('artifact', 'artifact_id', artifactId)).toBe(1);

    const metadataPayload: UpdateArtifactMetadataPayload = {
      title: 'ART-023 revised',
      classification: 'CUSTOMER_DELIVERY_REVISED',
      metadataPatch: { nested: { retained: false, added: true }, removeMe: null },
      changeReason: justification('ARTIFACT_METADATA_UPDATE', 'corrected delivery metadata'),
    };
    const updated = await handleUpdateArtifactMetadata(
      db,
      context,
      commandEnvelope(context, metadataPayload, {
        targetId: artifactId,
        expectedAggregateVersion: '1',
        idempotencyKey: 'art-023-metadata-1',
      }),
    );
    const updatedView = viewFrom(updated);
    expect(updatedView.aggregateVersion).toBe(2);
    expect(updatedView.definition.title).toBe('ART-023 revised');
    expect(updatedView.definition.classification).toBe('CUSTOMER_DELIVERY_REVISED');
    expect(updatedView.definition.metadata).toEqual({
      source: 'fixture',
      nested: { retained: false, added: true },
    });
    expect((committedPayload(updated) as Record<string, unknown>).metadataVersion).toBe(2);

    const staleUpdate = await handleUpdateArtifactMetadata(
      db,
      context,
      commandEnvelope(
        context,
        {
          title: 'stale writer',
          changeReason: justification('STALE_WRITE', 'stale writer'),
        },
        {
          targetId: artifactId,
          expectedAggregateVersion: '1',
          idempotencyKey: 'art-023-metadata-stale',
        },
      ),
    );
    expect(staleUpdate).toMatchObject({
      status: 'REJECTED',
      errorCode: CONCURRENCY_CONFLICT,
      currentAggregateVersion: '2',
    });

    const archivePayload: ArchiveArtifactPayload = {
      archivedAt: '2026-08-28T03:04:05.000Z',
      archiveReason: justification('DELIVERY_RETIRED', 'delivery package retired'),
      retentionPolicyRef: policyRef(PROJECT_A),
    };
    const archived = await handleArchiveArtifact(
      db,
      context,
      commandEnvelope(context, archivePayload, {
        targetId: artifactId,
        expectedAggregateVersion: '2',
        idempotencyKey: 'art-023-archive',
      }),
    );
    const archivedView = viewFrom(archived);
    expect(archivedView.aggregateVersion).toBe(3);
    expect(archivedView.lifecycleStatus).toBe('ARCHIVED');
    expect(archivedView.workingHeads[0]).toMatchObject({
      branchName: 'main',
      workingHeadRef: null,
      headVersion: 0,
      lifecycleStatus: 'ARCHIVED',
    });
    expect(await countRows('outbox_event', 'aggregate_id', artifactId)).toBe(3);
    expect(await countRows('reference_edge', 'owner_object_id', artifactId)).toBe(4);

    const archivedRead = await handleGetArtifact(db, context, {
      artifactRef: archivedView.artifactRef,
    });
    expect(archivedRead).toEqual(archivedView);

    const enterpriseContext = contextFor([]);
    const enterpriseCreated = await handleCreateArtifact(
      db,
      enterpriseContext,
      commandEnvelope(enterpriseContext, enterpriseControlledPayload(), {
        idempotencyKey: 'art-ctrl-001-create',
      }),
    );
    const enterpriseView = viewFrom(enterpriseCreated);
    expect(enterpriseView.artifactRef.scope).toEqual({ enterpriseId: ENTERPRISE });
    expect(enterpriseView.aggregateVersion).toBe(1);
    expect(enterpriseView.workingHeads[0]).toMatchObject({
      branchName: 'main',
      workingHeadRef: null,
      headVersion: 0,
      lifecycleStatus: 'ACTIVE',
    });
    await expect(
      handleGetArtifact(db, enterpriseContext, { artifactRef: enterpriseView.artifactRef }),
    ).resolves.toEqual(enterpriseView);

    const postArchive = await handleUpdateArtifactMetadata(
      db,
      context,
      commandEnvelope(
        context,
        {
          title: 'must not mutate',
          changeReason: justification('POST_ARCHIVE_ATTEMPT', 'post archive attempt'),
        },
        {
          targetId: artifactId,
          expectedAggregateVersion: '3',
          idempotencyKey: 'art-023-post-archive',
        },
      ),
    );
    expect(postArchive).toMatchObject({
      status: 'REJECTED',
      errorCode: ARTIFACT_NOT_ACTIVE,
      currentAggregateVersion: '3',
    });

    const agentContext = contextFor([PROJECT_A], {
      principalId: AGENT_PRINCIPAL,
      principalKind: 'AGENT',
      actorSnapshotId: AGENT_ACTOR,
    });
    await expect(
      handleArchiveArtifact(
        db,
        agentContext,
        commandEnvelope(agentContext, archivePayload, {
          targetId: artifactId,
          expectedAggregateVersion: '3',
          idempotencyKey: 'art-023-agent-archive',
        }),
      ),
    ).rejects.toMatchObject({ code: ARTIFACT_HUMAN_ONLY_DENIED });

    const foreignContext = contextFor([PROJECT_B]);
    await expect(
      handleGetArtifact(db, foreignContext, { artifactRef: createdView.artifactRef }),
    ).rejects.toMatchObject({ code: ARTIFACT_QUERY_NOT_FOUND });
    await expect(
      handleCreateArtifact(
        db,
        foreignContext,
        commandEnvelope(foreignContext, createPayload('ART-024', undefined, PROJECT_A), {
          idempotencyKey: 'art-024-cross-project',
        }),
      ),
    ).rejects.toMatchObject({ code: ARTIFACT_SCOPE_INVALID });
  });

  it('denies uncontextualized and direct Root/Branch writes without cross-project enumeration', async () => {
    const noContext = await (async () => {
      await probe.query('BEGIN');
      await probe.query('SET LOCAL ROLE artifact_app');
      const result = await probe.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM artifact.artifact',
      );
      await probe.query('ROLLBACK');
      return result.rows[0]?.count ?? '-1';
    })();
    expect(noContext).toBe('0');

    await probe.query('BEGIN');
    await establishDirectContext(probe, { allowedProjectIds: [PROJECT_B] });
    const foreignRows = await probe.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM artifact.artifact WHERE project_id = $1',
      [PROJECT_A],
    );
    expect(foreignRows.rows[0]?.count).toBe('0');
    await probe.query('ROLLBACK');

    await probe.query('BEGIN');
    await establishDirectContext(probe, { allowedProjectIds: [PROJECT_A] });
    const rootUpdate = await tryQuery(
      probe,
      `UPDATE artifact.artifact
          SET title = 'forged'
        WHERE artifact_id = $1`,
      [newUuidV7()],
    );
    expect(rootUpdate).toMatchObject({ allowed: false, code: '42501' });
    await probe.query('ROLLBACK');

    await probe.query('BEGIN');
    await establishDirectContext(probe, { allowedProjectIds: [PROJECT_A] });
    const branchDelete = await tryQuery(
      probe,
      'DELETE FROM artifact.artifact_branch WHERE branch_id = $1',
      [newUuidV7()],
    );
    expect(branchDelete).toMatchObject({ allowed: false, code: '42501' });
    await probe.query('ROLLBACK');
  });

  it('enforces the required Project Origin at the owner write boundary', async () => {
    const artifactId = newUuidV7();
    const branchId = newUuidV7();
    const sourceCommandId = newUuidV7();
    await probe.query('BEGIN');
    await establishDirectContext(probe, { allowedProjectIds: [PROJECT_A] });
    const malformedCreate = await tryQuery(
      probe,
      `SELECT artifact.create_artifact(
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::jsonb,
         $7::text, $8::text, $9::text, $10::bytea, $11::jsonb, $12::jsonb,
         $13::uuid, $14::uuid, $15::uuid, $16::uuid
       )`,
      [
        artifactId,
        branchId,
        ENTERPRISE,
        PROJECT_A,
        'PROJECT_DELIVERABLE',
        null,
        'CONTROL_PROCEDURE',
        'MALFORMED-PROJECT-ORIGIN',
        'CUSTOMER_DELIVERY',
        Buffer.alloc(32, 0x92),
        JSON.stringify([deliveryRef(PROJECT_A)]),
        JSON.stringify({ source: 'owner-boundary-probe' }),
        PRINCIPAL,
        ACTOR,
        DECISION,
        sourceCommandId,
      ],
    );
    expect(malformedCreate).toMatchObject({ allowed: false, code: '23514' });
    await probe.query('ROLLBACK');
    expect(await countRows('artifact', 'artifact_id', artifactId)).toBe(0);
    expect(await countRows('artifact_branch', 'artifact_id', artifactId)).toBe(0);
  });

  it('rolls back Root, Branch, Receipt, Audit, Reference Edge and Outbox together', async () => {
    const context = contextFor();
    const artifactId = newUuidV7();
    const branchId = newUuidV7();
    const commandId = newUuidV7();
    const payload: CanonicalJsonObject = { artifactType: 'ROLLBACK_PROBE', title: 'rollback' };
    const envelope: CommandEnvelope = {
      commandId,
      commandType: 'artifact.wi03.rollback-probe',
      commandVersion: '1.0',
      idempotencyScope: 'im04-wi03-test',
      idempotencyKey: 'wi03-rollback-probe',
      requestPayload: payload,
      enterpriseId: ENTERPRISE,
      projectId: PROJECT_A,
      targetType: 'Artifact',
      targetId: artifactId,
      correlationId: context.correlationId,
      principalId: context.principalId,
      principalKind: context.principalKind,
      actorSnapshotId: context.actorSnapshotId,
      authorizationDecisionId: context.authorizationDecisionId,
      policySnapshotId: context.policySnapshotId,
    };
    const identityHash = digestCanonicalPayload({
      businessScope: 'PROJECT_DELIVERABLE',
      enterpriseId: ENTERPRISE,
      projectId: PROJECT_A,
      artifactType: 'ROLLBACK_PROBE',
      title: 'rollback',
    }).hash;

    await expect(
      executeArtifactCommand(db, context, envelope, async (execution) => {
        await repo.insertArtifact(execution.trx, {
          artifactId,
          defaultBranchId: branchId,
          enterpriseId: ENTERPRISE,
          projectId: PROJECT_A,
          businessScope: 'PROJECT_DELIVERABLE',
          originProjectRef: projectRef(PROJECT_A),
          artifactType: 'ROLLBACK_PROBE',
          title: 'rollback',
          classification: 'TEST',
          identityHash,
          deliveryItemRefs: [deliveryRef(PROJECT_A)],
          metadata: { rollback: true },
          createdByPrincipalId: PRINCIPAL,
          createdByActorSnapshotId: ACTOR,
          createdAuthorizationDecisionId: DECISION,
          sourceCommandId: commandId,
        });
        await execution.appendOutbox({
          eventId: newUuidV7(),
          eventType: 'artifact.RollbackProbe',
          eventVersion: '1.0',
          aggregateType: 'Artifact',
          aggregateId: artifactId,
          aggregateVersion: '1',
          payload: { enterpriseId: ENTERPRISE, projectId: PROJECT_A, probe: true },
          occurredAt: new Date(),
        });
        await execution.appendReferenceEdge({
          ownerObjectType: 'Artifact',
          ownerObjectId: artifactId,
          referencePath: '/definition/enterpriseRef',
          targetModule: 'enterprise_project',
          targetObjectType: 'Enterprise',
          targetObjectId: ENTERPRISE,
          referencePurpose: 'ROLLBACK_PROBE',
        });
        execution.failAfterOutbox();
        return { kind: 'COMMITTED', resultPayload: payload };
      }),
    ).rejects.toMatchObject({
      code: 'INJECTED_FAULT',
    } satisfies Partial<CommandExecutionError>);

    expect(await countRows('artifact', 'artifact_id', artifactId)).toBe(0);
    expect(await countRows('artifact_branch', 'artifact_id', artifactId)).toBe(0);
    expect(await countRows('command_receipt', 'command_id', commandId)).toBe(0);
    expect(await countRows('outbox_event', 'aggregate_id', artifactId)).toBe(0);
    expect(await countRows('reference_edge', 'owner_object_id', artifactId)).toBe(0);
    expect(await countRows('audit_record', 'command_id', commandId)).toBe(0);
  });
});
