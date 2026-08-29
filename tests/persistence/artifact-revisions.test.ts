import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Artifact, Common } from '@zhiju/contracts';
import {
  ARTIFACT_BRANCH_HEAD_CONFLICT,
  ARTIFACT_CONTENT_HASH_MISMATCH,
  ARTIFACT_CONTENT_STATE_INVALID,
  ARTIFACT_CROSS_ARTIFACT_PARENT,
  ARTIFACT_HUMAN_ONLY_DENIED,
  ARTIFACT_MERGE_CONFLICT_UNRESOLVED,
  ARTIFACT_QUERY_NOT_FOUND,
  ArtifactRepository,
  createArtifactDatabase,
  digestCanonicalPayload,
  executeArtifactCommand,
  handleCreateAndSealRevision,
  handleCreateArtifact,
  handleCreateMergeRevision,
  handleGetRevisionDiffInputs,
  handleGetRevisionLineage,
  handleGetRevisionSnapshot,
  handleInvalidateRevision,
  handleMoveWorkingHead,
  handleValidateRevisionRef,
  handleWithdrawRevision,
  InMemoryObjectStorage,
  linkCanonicalContent,
  stageCanonicalContent,
  freezeCanonicalContent,
  type ArtifactTransactionContext,
  type CommandEnvelope,
} from '@zhiju/artifact';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

// IM-04 WI-05 (issue #94): real PostgreSQL acceptance for immutable Revision
// snapshots, same-Artifact lineage, branch-head CAS, explicit Merge facts,
// governance append-only facts, exact historical queries and RLS.

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT_A = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const PROJECT_B = '018f22e2-7c15-7b2e-8d86-2de956a9d203';
const PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9d302';
const ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d303';
const DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9d304';
const POLICY = '018f22e2-7c15-7b2e-8d86-2de956a9d305';
const DELIVERY_ITEM = '018f22e2-7c15-7b2e-8d86-2de956a9d241';
const DELIVERY_VERSION = '018f22e2-7c15-7b2e-8d86-2de956a9d242';

interface CanonicalFixture {
  readonly payload: Artifact.CanonicalContentPayload;
  readonly manifest: { readonly contentHash: Common.ContentHash };
}

interface ManifestFacts {
  readonly contentObjectId: string;
  readonly objectLocator: string;
  readonly byteSize: number;
  readonly mediaType: string;
}

interface ArtifactFacts {
  readonly artifactId: string;
  readonly branchId: string;
  readonly artifactRef: Common.ObjectRef;
}

type TestEnvelope<TPayload> = CommandEnvelope & { payload: TPayload };

function loadFixture(): CanonicalFixture {
  const fixtureUrl = new URL(
    '../../tests/fixtures/contracts/canonical-content/document-golden.json',
    import.meta.url,
  );
  return JSON.parse(readFileSync(fixtureUrl, 'utf8')) as CanonicalFixture;
}

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
    authorizationDecisionHash: Buffer.alloc(32, 0x94),
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

function deliveryItemRef(projectId: string): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'DeliveryItem',
    objectId: DELIVERY_ITEM,
    versionId: DELIVERY_VERSION,
    scope: { enterpriseId: ENTERPRISE, projectId },
  };
}

function artifactPayload(projectId: string, title: string): Artifact.ArtifactCreateArtifactPayload {
  return {
    enterpriseRef: enterpriseRef(),
    definition: {
      businessScope: 'PROJECT_DELIVERABLE',
      originProjectRef: projectRef(projectId),
      artifactType: 'CONTROL_PROCEDURE',
      title,
      classification: 'CUSTOMER_DELIVERY',
      deliveryItemRefs: [deliveryItemRef(projectId)],
      metadata: { issue: 94, fixture: 'ART-023' },
    },
  };
}

function commandEnvelope<TPayload>(
  context: ArtifactTransactionContext,
  payload: TPayload,
  options: {
    readonly commandType?: string;
    readonly idempotencyScope?: string;
    readonly idempotencyKey?: string;
    readonly requestPayload?: CanonicalJsonObject;
    readonly projectId?: string;
    readonly targetType?: string;
    readonly targetId?: string;
    readonly expectedAggregateVersion?: string;
  } = {},
): TestEnvelope<TPayload> {
  return {
    commandId: newUuidV7(),
    commandType: options.commandType ?? 'artifact.issue-94.test',
    commandVersion: '1.0',
    idempotencyScope: options.idempotencyScope ?? 'im04-wi05-test',
    idempotencyKey: options.idempotencyKey ?? `wi05-${newUuidV7()}`,
    requestPayload: options.requestPayload ?? (payload as unknown as CanonicalJsonObject),
    enterpriseId: context.enterpriseId,
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
    targetType: options.targetType ?? 'Artifact',
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

function committedPayload(result: {
  readonly status: string;
  readonly resultPayload?: CanonicalJsonObject | null;
}): CanonicalJsonObject {
  if (
    result.status !== 'COMMITTED' ||
    result.resultPayload === undefined ||
    result.resultPayload === null
  ) {
    throw new Error(`expected COMMITTED result, received ${result.status}`);
  }
  return result.resultPayload;
}

function artifactFactsFrom(result: {
  readonly status: string;
  readonly resultPayload?: CanonicalJsonObject | null;
}): ArtifactFacts {
  const payload = committedPayload(result);
  const artifactRef = payload.artifactRef as unknown as Common.ObjectRef;
  const workingHeads = payload.workingHeads as unknown as readonly Record<string, unknown>[];
  const branchId = workingHeads[0]?.branchId;
  if (typeof branchId !== 'string') throw new Error('created Artifact did not return a Branch id');
  return { artifactId: artifactRef.objectId, branchId, artifactRef };
}

function principalRef(): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'identity.principal',
    objectId: PRINCIPAL,
    scope: { enterpriseId: ENTERPRISE },
  };
}

function revisionContent(
  artifact: ArtifactFacts,
  manifest: ManifestFacts,
  fixture: CanonicalFixture,
  parents: readonly Common.ContentAddressedRef[],
  label: string,
  structureSchemaRef = fixture.payload.schemaRef,
): Artifact.RevisionContent {
  return {
    artifactRef: artifact.artifactRef,
    branchId: artifact.branchId,
    parentRevisionRefs: parents,
    contentType: fixture.payload.contentType,
    contentRef: manifest.objectLocator,
    contentHash: fixture.manifest.contentHash,
    structureSchemaRef,
    semanticMetadata: { issue: 94, label },
    changedUnits: [`${label}-unit`, 'control-table'],
    changeSummary: `${label} immutable revision fixture`,
    provenance: {
      principal: principalRef(),
      sourceMaterialRefs: [],
      toolchainVersions: [{ name: 'issue-94-test', version: '1' }],
    },
  };
}

function mergePayload(
  revision: Artifact.RevisionContent,
  resolutionRef: Common.TypedReference,
): Artifact.ArtifactCreateMergeRevisionPayload {
  return {
    merge: {
      revision,
      mergeStrategy: 'THREE_WAY_HUMAN_RESOLUTION',
      conflictSet: [{ unitId: 'control-table', left: 'rev-002', right: 'rev-003' }],
      conflictResolutionRefs: [resolutionRef],
      resolvedBy: principalRef(),
    },
  };
}

describe.skipIf(databaseUrl === undefined)(
  'Artifact WI-05 immutable Revisions and lineage (real PostgreSQL)',
  () => {
    const fixture = loadFixture();
    let admin: pg.Client;
    let probe: pg.Client;
    let pool: pg.Pool;
    let db: ReturnType<typeof createArtifactDatabase>;
    let repo: ArtifactRepository;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(
        `CREATE ROLE im04_wi05_probe LOGIN PASSWORD 'im04-wi05-probe' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await admin.query('GRANT platform_context_establisher, artifact_app TO im04_wi05_probe');
      const url = new URL(databaseUrl ?? '');
      url.username = 'im04_wi05_probe';
      url.password = 'im04-wi05-probe';
      probe = new pg.Client({ connectionString: url.toString() });
      await probe.connect();
      pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
      db = createArtifactDatabase(pool);
      repo = new ArtifactRepository();
    });

    afterAll(async () => {
      await probe.end();
      await pool.end();
      await admin.end();
    });

    async function countRows(
      table: string,
      condition: string,
      values: readonly unknown[] = [],
    ): Promise<number> {
      const result = await admin.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM artifact.${table} WHERE ${condition}`,
        [...values],
      );
      return Number(result.rows[0]?.count ?? '-1');
    }

    async function tryQuery(
      connection: pg.Client,
      text: string,
      values: readonly unknown[] = [],
    ): Promise<{ readonly allowed: boolean; readonly code?: string }> {
      try {
        await connection.query(text, [...values]);
        return { allowed: true };
      } catch (error) {
        const code = (error as pg.DatabaseError).code;
        return code === undefined ? { allowed: false } : { allowed: false, code };
      }
    }

    async function establishDirectContext(
      connection: pg.Client,
      context: ArtifactTransactionContext,
    ): Promise<void> {
      await connection.query('SET LOCAL ROLE platform_context_establisher');
      await connection.query(
        `SELECT platform_security.establish_transaction_context(
         'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
        [
          context.principalId,
          context.actorSnapshotId,
          context.authorizationDecisionId,
          context.authorizationDecisionHash,
          context.authorizationDecisionExpiresAt,
          context.enterpriseId,
          [...context.allowedProjectIds],
          context.correlationId,
        ],
      );
      await connection.query('SET LOCAL ROLE artifact_app');
    }

    async function withProbeContext<T>(
      context: ArtifactTransactionContext,
      callback: () => Promise<T>,
    ): Promise<T> {
      await probe.query('BEGIN');
      try {
        await establishDirectContext(probe, context);
        return await callback();
      } finally {
        await probe.query('ROLLBACK');
      }
    }

    async function createArtifact(
      context: ArtifactTransactionContext,
      title: string,
    ): Promise<ArtifactFacts> {
      const artifactId = newUuidV7();
      const result = await handleCreateArtifact(
        db,
        context,
        commandEnvelope(context, artifactPayload(PROJECT_A, title), {
          targetId: artifactId,
          commandType: 'artifact.create_artifact.issue-94',
          idempotencyKey: `issue-94-artifact-${title}`,
        }),
      );
      expect(result.status).toBe('COMMITTED');
      return artifactFactsFrom(result);
    }

    async function makeFrozenContent(
      context: ArtifactTransactionContext,
      ownerRevisionId: string,
      suffix: string,
    ): Promise<ManifestFacts> {
      const contentObjectId = newUuidV7();
      const storage = new InMemoryObjectStorage();
      const staged = await stageCanonicalContent(
        db,
        context,
        commandEnvelope(
          context,
          {
            content: structuredClone(fixture.payload),
            declaredContentHash: fixture.manifest.contentHash,
          },
          {
            targetType: 'CanonicalContentObject',
            targetId: contentObjectId,
            projectId: PROJECT_A,
            commandType: 'artifact.content-object.stage.issue-94',
            idempotencyKey: `issue-94-stage-${suffix}-${contentObjectId}`,
          },
        ),
        storage,
      );
      expect(staged.status).toBe('COMMITTED');
      const linked = await linkCanonicalContent(
        db,
        context,
        commandEnvelope(
          context,
          {
            ownerObjectType: 'ArtifactRevision',
            ownerObjectId: ownerRevisionId,
            ownerVersionId: ownerRevisionId,
          },
          {
            targetType: 'CanonicalContentObject',
            targetId: contentObjectId,
            commandType: 'artifact.content-object.link.issue-94',
            idempotencyKey: `issue-94-link-${suffix}-${contentObjectId}`,
          },
        ),
        storage,
      );
      expect(linked.commandResult.status).toBe('COMMITTED');
      expect(linked.finalizationState).toBe('FINALIZED');
      const frozen = await freezeCanonicalContent(
        db,
        context,
        commandEnvelope(
          context,
          {},
          {
            targetType: 'CanonicalContentObject',
            targetId: contentObjectId,
            commandType: 'artifact.content-object.freeze.issue-94',
            idempotencyKey: `issue-94-freeze-${suffix}-${contentObjectId}`,
          },
        ),
      );
      const frozenPayload = committedPayload(frozen) as unknown as Record<string, unknown>;
      const objectLocator = frozenPayload.objectRef;
      const byteSize = frozenPayload.byteSize;
      const mediaType = frozenPayload.mediaType;
      if (
        typeof objectLocator !== 'string' ||
        typeof byteSize !== 'number' ||
        typeof mediaType !== 'string'
      ) {
        throw new Error('FROZEN Manifest did not return its exact storage identity');
      }
      return {
        contentObjectId,
        objectLocator,
        byteSize,
        mediaType,
      };
    }

    async function stageOnlyContent(
      context: ArtifactTransactionContext,
      suffix: string,
    ): Promise<ManifestFacts> {
      const contentObjectId = newUuidV7();
      const storage = new InMemoryObjectStorage();
      const staged = await stageCanonicalContent(
        db,
        context,
        commandEnvelope(
          context,
          {
            content: structuredClone(fixture.payload),
            declaredContentHash: fixture.manifest.contentHash,
          },
          {
            targetType: 'CanonicalContentObject',
            targetId: contentObjectId,
            projectId: PROJECT_A,
            commandType: 'artifact.content-object.stage-only.issue-94',
            idempotencyKey: `issue-94-stage-only-${suffix}-${contentObjectId}`,
          },
        ),
        storage,
      );
      const payload = committedPayload(staged) as unknown as Record<string, unknown>;
      return {
        contentObjectId,
        objectLocator: String(payload.objectRef),
        byteSize: Number(payload.byteSize),
        mediaType: String(payload.mediaType),
      };
    }

    async function createRevision(
      context: ArtifactTransactionContext,
      revisionId: string,
      revision: Artifact.RevisionContent,
      suffix: string,
    ): Promise<{
      readonly result: Awaited<ReturnType<typeof handleCreateAndSealRevision>>;
      readonly envelope: TestEnvelope<Artifact.ArtifactCreateAndSealRevisionPayload>;
    }> {
      const envelope = commandEnvelope(
        context,
        { revision },
        {
          targetType: 'ArtifactRevision',
          targetId: revisionId,
          projectId: PROJECT_A,
          commandType: 'artifact.create_and_seal_revision.issue-94',
          idempotencyKey: `issue-94-revision-${suffix}-${revisionId}`,
        },
      );
      return { result: await handleCreateAndSealRevision(db, context, envelope), envelope };
    }

    it('replays an immutable ART-023 DAG, rejects bad parents, races Branch CAS and records Merge/governance facts', async () => {
      const context = contextFor();
      const artifact = await createArtifact(context, 'ART-023');
      const otherArtifact = await createArtifact(context, 'ART-023-OTHER');

      const revisionOneId = newUuidV7();
      const manifestOne = await makeFrozenContent(context, revisionOneId, 'rev-001');
      const revisionOne = revisionContent(artifact, manifestOne, fixture, [], 'rev-001');
      const first = await createRevision(context, revisionOneId, revisionOne, 'rev-001');
      expect(first.result.status).toBe('COMMITTED');
      const firstSnapshot = committedPayload(first.result) as unknown as Artifact.RevisionSnapshot;
      expect(firstSnapshot.revisionNumber).toBe(1);
      expect(firstSnapshot.parentRevisionRefs).toEqual([]);

      const revisionOneRef = firstSnapshot.revisionRef;
      const revisionTwoId = newUuidV7();
      const manifestTwo = await makeFrozenContent(context, revisionTwoId, 'rev-002');
      const second = await createRevision(
        context,
        revisionTwoId,
        revisionContent(artifact, manifestTwo, fixture, [revisionOneRef], 'rev-002'),
        'rev-002',
      );
      expect(second.result.status).toBe('COMMITTED');
      const secondSnapshot = committedPayload(
        second.result,
      ) as unknown as Artifact.RevisionSnapshot;

      const revisionThreeId = newUuidV7();
      const manifestThree = await makeFrozenContent(context, revisionThreeId, 'rev-003');
      const third = await createRevision(
        context,
        revisionThreeId,
        revisionContent(artifact, manifestThree, fixture, [revisionOneRef], 'rev-003'),
        'rev-003',
      );
      expect(third.result.status).toBe('COMMITTED');
      const thirdSnapshot = committedPayload(third.result) as unknown as Artifact.RevisionSnapshot;

      const otherRevisionId = newUuidV7();
      const otherManifest = await makeFrozenContent(context, otherRevisionId, 'cross-artifact');
      const otherRevision = await createRevision(
        context,
        otherRevisionId,
        revisionContent(otherArtifact, otherManifest, fixture, [], 'cross-artifact'),
        'cross-artifact',
      );
      expect(otherRevision.result.status).toBe('COMMITTED');
      const otherSnapshot = committedPayload(
        otherRevision.result,
      ) as unknown as Artifact.RevisionSnapshot;

      const crossArtifactCandidateId = newUuidV7();
      const crossArtifactManifest = await makeFrozenContent(
        context,
        crossArtifactCandidateId,
        'cross-artifact-reject',
      );
      const crossArtifactRejected = await createRevision(
        context,
        crossArtifactCandidateId,
        revisionContent(
          artifact,
          crossArtifactManifest,
          fixture,
          [otherSnapshot.revisionRef],
          'cross-artifact-reject',
        ),
        'cross-artifact-reject',
      );
      expect(crossArtifactRejected.result).toMatchObject({
        status: 'REJECTED',
        errorCode: ARTIFACT_CROSS_ARTIFACT_PARENT,
      });
      expect(
        await countRows('artifact_revision', 'revision_id = $1', [crossArtifactCandidateId]),
      ).toBe(0);

      const wrongHashCandidateId = newUuidV7();
      const wrongHashManifest = await makeFrozenContent(
        context,
        wrongHashCandidateId,
        'wrong-hash',
      );
      const wrongHash = { ...fixture.manifest.contentHash, digest: 'f'.repeat(64) };
      const wrongHashParent = { ...revisionOneRef, contentHash: wrongHash };
      const wrongHashRejected = await createRevision(
        context,
        wrongHashCandidateId,
        revisionContent(artifact, wrongHashManifest, fixture, [wrongHashParent], 'wrong-hash'),
        'wrong-hash',
      );
      expect(wrongHashRejected.result).toMatchObject({
        status: 'REJECTED',
        errorCode: ARTIFACT_CONTENT_HASH_MISMATCH,
      });
      expect(await countRows('artifact_revision', 'revision_id = $1', [wrongHashCandidateId])).toBe(
        0,
      );

      const stagedManifest = await stageOnlyContent(context, 'not-frozen');
      const notFrozenCandidateId = newUuidV7();
      const notFrozenRejected = await createRevision(
        context,
        notFrozenCandidateId,
        revisionContent(artifact, stagedManifest, fixture, [], 'not-frozen'),
        'not-frozen',
      );
      expect(notFrozenRejected.result).toMatchObject({
        status: 'REJECTED',
        errorCode: ARTIFACT_CONTENT_STATE_INVALID,
      });
      expect(await countRows('artifact_revision', 'revision_id = $1', [notFrozenCandidateId])).toBe(
        0,
      );

      const payloadForgeryContext = contextFor();
      await expect(
        handleMoveWorkingHead(
          db,
          payloadForgeryContext,
          commandEnvelope(
            payloadForgeryContext,
            {
              branchId: artifact.branchId,
              newHeadRef: secondSnapshot.revisionRef,
              moveReason: {
                reasonCode: 'ISSUE_94_ENVELOPE_CAS_ONLY',
                summary: 'reject a payload-level expected version forgery',
                evidenceRefs: [],
              },
              expectedAggregateVersion: '999',
            },
            {
              targetType: 'Artifact',
              targetId: artifact.artifactId,
              projectId: PROJECT_A,
              expectedAggregateVersion: '0',
              commandType: 'artifact.move_working_head.issue-94',
              idempotencyKey: 'issue-94-head-payload-version-forgery',
            },
          ),
        ),
      ).rejects.toMatchObject({ code: 'COMMAND_TARGET_MISMATCH' });

      const casContext = contextFor();
      const move = (newHeadRef: Common.ContentAddressedRef, suffix: string) =>
        handleMoveWorkingHead(
          db,
          casContext,
          commandEnvelope(
            casContext,
            {
              branchId: artifact.branchId,
              newHeadRef,
              moveReason: {
                reasonCode: 'ISSUE_94_BRANCH_CAS',
                summary: `advance ${suffix}`,
                evidenceRefs: [],
              },
            },
            {
              targetType: 'Artifact',
              targetId: artifact.artifactId,
              projectId: PROJECT_A,
              expectedAggregateVersion: '0',
              commandType: 'artifact.move_working_head.issue-94',
              idempotencyKey: `issue-94-head-race-${suffix}`,
            },
          ),
        );
      const [moveA, moveB] = await Promise.all([
        move(secondSnapshot.revisionRef, 'rev-002'),
        move(thirdSnapshot.revisionRef, 'rev-003'),
      ]);
      expect([moveA.status, moveB.status].sort()).toEqual(['COMMITTED', 'REJECTED']);
      const committedMove = moveA.status === 'COMMITTED' ? moveA : moveB;
      const rejectedMove = moveA.status === 'REJECTED' ? moveA : moveB;
      expect(rejectedMove).toMatchObject({
        errorCode: ARTIFACT_BRANCH_HEAD_CONFLICT,
        currentAggregateVersion: '1',
      });
      const winnerPayload = committedPayload(committedMove);
      const winnerRef = winnerPayload.workingHeadRef as unknown as Common.ContentAddressedRef;
      const loserRef =
        winnerRef.objectId === secondSnapshot.revisionRef.objectId
          ? thirdSnapshot.revisionRef
          : secondSnapshot.revisionRef;
      expect(
        await countRows(
          'revision_conflict',
          "branch_id = $1 AND conflict_kind = 'BRANCH_HEAD_CAS'",
          [artifact.branchId],
        ),
      ).toBe(1);

      const moveAfterRace = await handleMoveWorkingHead(
        db,
        casContext,
        commandEnvelope(
          casContext,
          {
            branchId: artifact.branchId,
            expectedHeadRef: winnerRef,
            newHeadRef: loserRef,
            moveReason: {
              reasonCode: 'ISSUE_94_BRANCH_CAS_RETRY',
              summary: 'move the retained divergent candidate after rereading the head',
              evidenceRefs: [],
            },
          },
          {
            targetType: 'Artifact',
            targetId: artifact.artifactId,
            projectId: PROJECT_A,
            expectedAggregateVersion: '1',
            commandType: 'artifact.move_working_head.issue-94',
            idempotencyKey: 'issue-94-head-retry',
          },
        ),
      );
      expect(moveAfterRace).toMatchObject({ status: 'COMMITTED' });
      expect(
        (committedPayload(moveAfterRace) as unknown as Record<string, unknown>).headVersion,
      ).toBe(2);
      const headEdges = await admin.query<{ owner_version_id: string | null }>(
        `SELECT owner_version_id::text
           FROM artifact.reference_edge
          WHERE owner_object_type = 'Artifact'
            AND owner_object_id = $1
            AND reference_path = $2`,
        [artifact.artifactId, `/branches/${artifact.branchId}/workingHeadRef`],
      );
      expect(headEdges.rows.length).toBeGreaterThanOrEqual(2);
      expect(new Set(headEdges.rows.map((row) => row.owner_version_id))).toEqual(
        new Set([artifact.branchId]),
      );
      const headEvents = await admin.query<{ aggregate_version: string }>(
        `SELECT aggregate_version
           FROM artifact.outbox_event
          WHERE event_type = 'artifact.ArtifactBranchHeadMoved'
            AND aggregate_id = $1
          ORDER BY aggregate_version`,
        [artifact.artifactId],
      );
      expect(headEvents.rows.map((row) => row.aggregate_version)).toEqual(['1', '2']);

      const mergeRevisionId = newUuidV7();
      const mergeManifest = await makeFrozenContent(context, mergeRevisionId, 'rev-004-merge');
      const resolutionRef: Common.TypedReference = {
        kind: 'OBJECT',
        objectType: 'artifact.MergeResolution',
        objectId: newUuidV7(),
        scope: { enterpriseId: ENTERPRISE, projectId: PROJECT_A },
      };
      const mergeRevision = revisionContent(
        artifact,
        mergeManifest,
        fixture,
        [secondSnapshot.revisionRef, thirdSnapshot.revisionRef],
        'rev-004-merge',
      );
      const mergeResult = await handleCreateMergeRevision(
        db,
        context,
        commandEnvelope(context, mergePayload(mergeRevision, resolutionRef), {
          targetType: 'ArtifactRevision',
          targetId: mergeRevisionId,
          projectId: PROJECT_A,
          commandType: 'artifact.create_merge_revision.issue-94',
          idempotencyKey: 'issue-94-merge-rev-004',
        }),
      );
      expect(mergeResult.status).toBe('COMMITTED');
      const mergeSnapshot = committedPayload(mergeResult) as unknown as Artifact.RevisionSnapshot;
      expect(mergeSnapshot.parentRevisionRefs.map((ref) => ref.objectId)).toEqual([
        secondSnapshot.revisionRef.objectId,
        thirdSnapshot.revisionRef.objectId,
      ]);
      expect(
        await countRows('revision_conflict', "revision_id = $1 AND conflict_kind = 'MERGE'", [
          mergeRevisionId,
        ]),
      ).toBe(1);

      const unresolvedMergeId = newUuidV7();
      const unresolvedMerge = {
        merge: {
          ...mergePayload(mergeRevision, resolutionRef).merge,
          conflictResolutionRefs: [],
        },
      } satisfies Artifact.ArtifactCreateMergeRevisionPayload;
      await expect(
        handleCreateMergeRevision(
          db,
          context,
          commandEnvelope(context, unresolvedMerge, {
            targetType: 'ArtifactRevision',
            targetId: unresolvedMergeId,
            projectId: PROJECT_A,
            commandType: 'artifact.create_merge_revision.issue-94',
            idempotencyKey: 'issue-94-merge-unresolved',
          }),
        ),
      ).rejects.toMatchObject({ code: ARTIFACT_MERGE_CONFLICT_UNRESOLVED });
      expect(await countRows('artifact_revision', 'revision_id = $1', [unresolvedMergeId])).toBe(0);

      const agentMergeContext = contextFor([PROJECT_A], { principalKind: 'AGENT' });
      const nonHumanMergeId = newUuidV7();
      await expect(
        handleCreateMergeRevision(
          db,
          agentMergeContext,
          commandEnvelope(agentMergeContext, mergePayload(mergeRevision, resolutionRef), {
            targetType: 'ArtifactRevision',
            targetId: nonHumanMergeId,
            projectId: PROJECT_A,
            commandType: 'artifact.create_merge_revision.issue-94',
            idempotencyKey: 'issue-94-merge-non-human',
          }),
        ),
      ).rejects.toMatchObject({ code: ARTIFACT_HUMAN_ONLY_DENIED });
      expect(await countRows('artifact_revision', 'revision_id = $1', [nonHumanMergeId])).toBe(0);

      const lineage = await handleGetRevisionLineage(db, context, {
        artifactRef: artifact.artifactRef,
        headRef: mergeSnapshot.revisionRef,
      });
      expect(lineage.nodes.map((node) => node.revisionRef.objectId)).toEqual([
        revisionOneId,
        revisionTwoId,
        revisionThreeId,
        mergeRevisionId,
      ]);
      expect(lineage.rootRefs.map((ref) => ref.objectId)).toEqual([revisionOneId]);
      expect(lineage.edges).toHaveLength(4);
      expect(lineage.lineageHash.digest).toMatch(/^[0-9a-f]{64}$/u);

      const diffInputs = await handleGetRevisionDiffInputs(db, context, {
        leftRef: secondSnapshot.revisionRef,
        rightRef: thirdSnapshot.revisionRef,
      });
      expect(diffInputs.commonAncestorRef?.objectId).toBe(revisionOneId);
      expect(diffInputs.left.revisionRef).toEqual(secondSnapshot.revisionRef);
      expect(diffInputs.right.revisionRef).toEqual(thirdSnapshot.revisionRef);

      const validation = await handleValidateRevisionRef(db, context, {
        revisionRef: mergeSnapshot.revisionRef,
        expectedScopeRef: { enterpriseId: ENTERPRISE, projectId: PROJECT_A },
        purpose: 'REVISION_VALIDATION',
        allowedDispositions: ['ACTIVE'],
      });
      expect(validation).toMatchObject({
        valid: true,
        contentAvailable: true,
        disposition: 'ACTIVE',
      });

      const broadArtifactRef = {
        ...artifact.artifactRef,
        scope: { enterpriseId: ENTERPRISE },
      } as Common.ObjectRef;
      await expect(
        handleGetRevisionLineage(db, context, {
          artifactRef: broadArtifactRef,
          headRef: mergeSnapshot.revisionRef,
        }),
      ).rejects.toMatchObject({ code: 'ARTIFACT_QUERY_SCOPE_MISMATCH' });
      const broadValidation = await handleValidateRevisionRef(db, context, {
        revisionRef: mergeSnapshot.revisionRef,
        expectedScopeRef: { enterpriseId: ENTERPRISE },
        purpose: 'REVISION_VALIDATION',
        allowedDispositions: ['ACTIVE'],
      });
      expect(broadValidation).toMatchObject({
        valid: false,
        reasons: ['ARTIFACT_QUERY_SCOPE_MISMATCH'],
      });

      const replay = await handleCreateAndSealRevision(db, context, first.envelope);
      expect(replay).toMatchObject({ status: 'DUPLICATE', originalOutcome: 'COMMITTED' });
      const differentRevision = {
        ...revisionOne,
        changeSummary: 'same key with a different immutable payload',
      } as Artifact.InitialOrOrdinaryRevisionContent;
      await expect(
        handleCreateAndSealRevision(
          db,
          context,
          commandEnvelope(
            context,
            { revision: differentRevision },
            {
              targetType: 'ArtifactRevision',
              targetId: revisionOneId,
              projectId: PROJECT_A,
              commandType: 'artifact.create_and_seal_revision.issue-94',
              idempotencyKey: first.envelope.idempotencyKey,
              requestPayload: { revision: differentRevision } as unknown as CanonicalJsonObject,
            },
          ),
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_PAYLOAD_CONFLICT' });

      const withdrawn = await handleWithdrawRevision(
        db,
        context,
        commandEnvelope(
          context,
          {
            withdrawalReason: {
              reasonCode: 'ISSUE_94_WITHDRAWAL',
              summary: 'withdraw the historical root after later revisions exist',
              evidenceRefs: [],
            },
          },
          {
            targetType: 'ArtifactRevision',
            targetId: revisionOneId,
            projectId: PROJECT_A,
            commandType: 'artifact.withdraw_revision.issue-94',
            idempotencyKey: 'issue-94-withdraw-rev-001',
          },
        ),
      );
      expect(withdrawn.status).toBe('COMMITTED');
      const withdrawnSnapshot = await handleGetRevisionSnapshot(db, context, {
        revisionRef: revisionOneRef,
      });
      expect(withdrawnSnapshot).toMatchObject({ disposition: 'WITHDRAWN' });
      expect(withdrawnSnapshot.revisionRef).toEqual(firstSnapshot.revisionRef);
      expect(withdrawnSnapshot.parentRevisionRefs).toEqual(firstSnapshot.parentRevisionRefs);
      const withdrawalTimestamps = await admin.query<{
        withdrawn_at: string;
        occurred_at: string;
      }>(
        `SELECT w.withdrawn_at::text AS withdrawn_at, o.occurred_at::text AS occurred_at
           FROM artifact.revision_withdrawal w
           JOIN artifact.outbox_event o
             ON o.aggregate_id = w.revision_id
            AND o.source_command_id = w.source_command_id
          WHERE w.revision_id = $1
            AND o.event_type = 'artifact.ArtifactRevisionWithdrawn'`,
        [revisionOneId],
      );
      expect(withdrawalTimestamps.rows).toHaveLength(1);
      expect(withdrawalTimestamps.rows[0]?.withdrawn_at).toBe(
        withdrawalTimestamps.rows[0]?.occurred_at,
      );

      const impactAssessmentRef: Common.ContentAddressedRef = {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'artifact.impact_assessment',
        objectId: newUuidV7(),
        scope: { enterpriseId: ENTERPRISE, projectId: PROJECT_A },
        contentHash: fixture.manifest.contentHash,
      };
      const invalidated = await handleInvalidateRevision(
        db,
        context,
        commandEnvelope(
          context,
          {
            invalidationReason: {
              reasonCode: 'ISSUE_94_INVALIDATION',
              summary: 'append an invalidation governance fact without rewriting the Revision',
              evidenceRefs: [],
            },
            impactAssessmentRef,
            invalidatedAt: '2026-08-28T08:00:00.000Z',
          },
          {
            targetType: 'ArtifactRevision',
            targetId: revisionOneId,
            projectId: PROJECT_A,
            commandType: 'artifact.invalidate_revision.issue-94',
            idempotencyKey: 'issue-94-invalidate-rev-001',
          },
        ),
      );
      expect(invalidated.status).toBe('COMMITTED');
      const invalidatedSnapshot = await handleGetRevisionSnapshot(db, context, {
        revisionRef: revisionOneRef,
      });
      expect(invalidatedSnapshot).toMatchObject({ disposition: 'INVALIDATED' });
      expect(invalidatedSnapshot.revisionRef).toEqual(firstSnapshot.revisionRef);
      expect(invalidatedSnapshot.parentRevisionRefs).toEqual(firstSnapshot.parentRevisionRefs);
      expect(invalidatedSnapshot.contentRef).toBe(firstSnapshot.contentRef);

      const foreignContext = contextFor([PROJECT_B]);
      await expect(
        handleGetRevisionSnapshot(db, foreignContext, { revisionRef: revisionOneRef }),
      ).rejects.toMatchObject({ code: ARTIFACT_QUERY_NOT_FOUND });

      const immutableRevisionUpdate = await withProbeContext(context, () =>
        tryQuery(
          probe,
          `UPDATE artifact.artifact_revision
              SET change_summary = 'forged'
            WHERE revision_id = $1`,
          [revisionOneId],
        ),
      );
      expect(immutableRevisionUpdate).toEqual({ allowed: false, code: '42501' });
      const immutableParentDelete = await withProbeContext(context, () =>
        tryQuery(
          probe,
          `DELETE FROM artifact.revision_parent
            WHERE child_revision_id = $1`,
          [mergeRevisionId],
        ),
      );
      expect(immutableParentDelete).toEqual({ allowed: false, code: '42501' });
      const immutableConflictDelete = await withProbeContext(context, () =>
        tryQuery(
          probe,
          `DELETE FROM artifact.revision_conflict
            WHERE revision_id = $1`,
          [mergeRevisionId],
        ),
      );
      expect(immutableConflictDelete).toEqual({ allowed: false, code: '42501' });
      const immutableWithdrawalUpdate = await withProbeContext(context, () =>
        tryQuery(
          probe,
          `UPDATE artifact.revision_withdrawal
              SET withdrawal_reason = '{}'::jsonb
            WHERE revision_id = $1`,
          [revisionOneId],
        ),
      );
      expect(immutableWithdrawalUpdate).toEqual({ allowed: false, code: '42501' });
      const immutableInvalidationDelete = await withProbeContext(context, () =>
        tryQuery(
          probe,
          `DELETE FROM artifact.revision_invalidation
            WHERE revision_id = $1`,
          [revisionOneId],
        ),
      );
      expect(immutableInvalidationDelete).toEqual({ allowed: false, code: '42501' });
      const foreignRows = await withProbeContext(foreignContext, async () => {
        const result = await probe.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM artifact.artifact_revision WHERE artifact_id = $1',
          [artifact.artifactId],
        );
        return result.rows[0]?.count;
      });
      expect(foreignRows).toBe('0');

      const rollbackRevisionId = newUuidV7();
      const rollbackManifest = await makeFrozenContent(context, rollbackRevisionId, 'rollback');
      const rollbackRevision = revisionContent(artifact, rollbackManifest, fixture, [], 'rollback');
      const rollbackEnvelope = commandEnvelope(
        context,
        { probe: 'revision-rollback' },
        {
          targetType: 'ArtifactRevision',
          targetId: rollbackRevisionId,
          projectId: PROJECT_A,
          commandType: 'artifact.revision.rollback.issue-94',
          idempotencyKey: 'issue-94-revision-rollback',
        },
      );
      await expect(
        executeArtifactCommand(db, context, rollbackEnvelope, async (execution) => {
          const stored = await repo.createArtifactRevision(execution.trx, {
            revisionId: rollbackRevisionId,
            artifactId: artifact.artifactId,
            branchId: artifact.branchId,
            enterpriseId: ENTERPRISE,
            projectId: PROJECT_A,
            revisionKind: 'INITIAL',
            contentObjectId: rollbackManifest.contentObjectId,
            contentType: fixture.payload.contentType,
            objectLocator: rollbackManifest.objectLocator,
            contentHash: Buffer.from(fixture.manifest.contentHash.digest, 'hex'),
            structureSchemaRef: fixture.payload.schemaRef,
            canonicalizationVersion: '1',
            byteSize: rollbackManifest.byteSize,
            mediaType: rollbackManifest.mediaType,
            semanticMetadata: rollbackRevision.semanticMetadata,
            changedUnits: rollbackRevision.changedUnits,
            changeSummary: rollbackRevision.changeSummary,
            provenance: rollbackRevision.provenance,
            parentRefs: [],
            conflictSet: [],
            conflictResolutionRefs: [],
            createdByPrincipalId: PRINCIPAL,
            createdByActorSnapshotId: ACTOR,
            createdAuthorizationDecisionId: DECISION,
            sourceCommandId: rollbackEnvelope.commandId,
          });
          expect(stored.outcome).toBe('OK');
          await execution.appendOutbox({
            eventId: newUuidV7(),
            eventType: 'artifact.RevisionRollbackProbe',
            eventVersion: '1.0',
            aggregateType: 'ArtifactRevision',
            aggregateId: rollbackRevisionId,
            aggregateVersion: '1',
            payload: { enterpriseId: ENTERPRISE, projectId: PROJECT_A, probe: true },
            occurredAt: new Date(),
          });
          execution.failAfterOutbox();
          return { kind: 'COMMITTED', resultPayload: { rollback: true } };
        }),
      ).rejects.toMatchObject({ code: 'INJECTED_FAULT' });
      expect(await countRows('artifact_revision', 'revision_id = $1', [rollbackRevisionId])).toBe(
        0,
      );
      expect(await countRows('outbox_event', 'aggregate_id = $1', [rollbackRevisionId])).toBe(0);
      expect(
        await countRows('command_receipt', 'command_id = $1', [rollbackEnvelope.commandId]),
      ).toBe(0);
      expect(await countRows('audit_record', 'command_id = $1', [rollbackEnvelope.commandId])).toBe(
        0,
      );
      expect(await countRows('reference_edge', 'owner_object_id = $1', [rollbackRevisionId])).toBe(
        0,
      );
      expect(
        await countRows('artifact_content_object_link', 'owner_object_id = $1', [
          rollbackRevisionId,
        ]),
      ).toBe(1);

      const lineageAfterGovernance = await handleGetRevisionLineage(db, context, {
        artifactRef: artifact.artifactRef,
        headRef: mergeSnapshot.revisionRef,
      });
      expect(
        lineageAfterGovernance.nodes.find((node) => node.revisionRef.objectId === revisionOneId),
      ).toMatchObject({
        disposition: 'INVALIDATED',
        revisionRef: firstSnapshot.revisionRef,
        parentRevisionRefs: [],
      });
      expect(
        digestCanonicalPayload(lineageAfterGovernance as unknown as CanonicalJsonObject).hash
          .length,
      ).toBe(32);
    });
  },
);
