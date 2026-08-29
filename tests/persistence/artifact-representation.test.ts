import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  ContractRegistry,
  type Artifact,
  type Common,
  type IntegrationGateway,
} from '@zhiju/contracts';
import {
  ARTIFACT_QUERY_NOT_FOUND,
  ARTIFACT_REPRESENTATION_BINDING_INVALID,
  ARTIFACT_REPRESENTATION_BINDING_MISMATCH,
  ARTIFACT_REPRESENTATION_IDENTITY_CONFLICT,
  createArtifactDatabase,
  freezeCanonicalContent,
  handleCreateAndSealRevision,
  handleCreateArtifact,
  handleGetRepresentation,
  handleRegisterRepresentation,
  InMemoryObjectStorage,
  linkCanonicalContent,
  stageCanonicalContent,
  type ArtifactTransactionContext,
  type CommandEnvelope,
  type RenderAttemptBindingQueryPort,
} from '@zhiju/artifact';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

// IM-04 WI-08 (issue #97): real PostgreSQL acceptance for authoritative
// RenderAttempt binding, immutable Representation facts and event minimality.

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

interface ArtifactFacts {
  readonly artifactId: string;
  readonly branchId: string;
  readonly artifactRef: Common.ObjectRef;
}

type TestEnvelope<TPayload> = CommandEnvelope & { readonly payload: TPayload };

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

function loadFixture(): CanonicalFixture {
  const fixtureUrl = new URL(
    '../../tests/fixtures/contracts/canonical-content/document-golden.json',
    import.meta.url,
  );
  return JSON.parse(readFileSync(fixtureUrl, 'utf8')) as CanonicalFixture;
}

function contextFor(
  allowedProjectIds: readonly string[] = [PROJECT_A],
): ArtifactTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: Buffer.alloc(32, 0x97),
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY,
    enterpriseId: ENTERPRISE,
    allowedProjectIds,
    correlationId: newUuidV7(),
  };
}

function commandEnvelope<TPayload>(
  context: ArtifactTransactionContext,
  payload: TPayload,
  options: {
    readonly targetType: string;
    readonly targetId: string;
    readonly commandType: string;
    readonly idempotencyKey: string;
    readonly projectId?: string;
  },
): TestEnvelope<TPayload> {
  return {
    commandId: newUuidV7(),
    commandType: options.commandType,
    commandVersion: '1.0',
    idempotencyScope: 'im04-wi08-test',
    idempotencyKey: options.idempotencyKey,
    requestPayload: payload as unknown as CanonicalJsonObject,
    enterpriseId: context.enterpriseId,
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
    targetType: options.targetType,
    targetId: options.targetId,
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
  if (result.status !== 'COMMITTED' || result.resultPayload == null) {
    throw new Error(`expected COMMITTED result, received ${result.status}`);
  }
  return result.resultPayload;
}

function hash(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' };
}

describe.skipIf(databaseUrl === undefined)(
  'Artifact WI-08 Representation binding (real PostgreSQL)',
  () => {
    const fixture = loadFixture();
    let admin: pg.Client;
    let probe: pg.Client;
    let pool: pg.Pool;
    let db: ReturnType<typeof createArtifactDatabase>;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(
        `CREATE ROLE im04_wi08_probe LOGIN PASSWORD 'im04-wi08-probe' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await admin.query('GRANT platform_context_establisher, artifact_app TO im04_wi08_probe');
      const url = new URL(databaseUrl ?? '');
      url.username = 'im04_wi08_probe';
      url.password = 'im04-wi08-probe';
      probe = new pg.Client({ connectionString: url.toString() });
      await probe.connect();
      pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
      db = createArtifactDatabase(pool);
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

    async function createArtifact(context: ArtifactTransactionContext): Promise<ArtifactFacts> {
      const artifactId = newUuidV7();
      const payload: Artifact.ArtifactCreateArtifactPayload = {
        enterpriseRef: enterpriseRef(),
        definition: {
          businessScope: 'PROJECT_DELIVERABLE',
          originProjectRef: projectRef(PROJECT_A),
          artifactType: 'CONTROL_PROCEDURE',
          title: 'ART-025 Representation Binding',
          classification: 'CUSTOMER_DELIVERY',
          deliveryItemRefs: [
            {
              kind: 'VERSIONED',
              objectType: 'DeliveryItem',
              objectId: DELIVERY_ITEM,
              versionId: DELIVERY_VERSION,
              scope: { enterpriseId: ENTERPRISE, projectId: PROJECT_A },
            },
          ],
          metadata: { issue: 97, fixture: 'ART-025' },
        },
      };
      const result = await handleCreateArtifact(
        db,
        context,
        commandEnvelope(context, payload, {
          targetType: 'Artifact',
          targetId: artifactId,
          commandType: 'artifact.create_artifact.issue-97',
          idempotencyKey: `issue-97-artifact-${artifactId}`,
          projectId: PROJECT_A,
        }),
      );
      const resultPayload = committedPayload(result);
      const artifactRef = resultPayload.artifactRef as unknown as Common.ObjectRef;
      const heads = resultPayload.workingHeads as unknown as readonly Record<string, unknown>[];
      const branchId = heads[0]?.branchId;
      if (typeof branchId !== 'string') throw new Error('Artifact did not return its Branch');
      return { artifactId, branchId, artifactRef };
    }

    async function createRevision(
      context: ArtifactTransactionContext,
      artifact: ArtifactFacts,
    ): Promise<Artifact.RevisionSnapshot> {
      const revisionId = newUuidV7();
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
            commandType: 'artifact.content-object.stage.issue-97',
            idempotencyKey: `issue-97-stage-${contentObjectId}`,
            projectId: PROJECT_A,
          },
        ),
        storage,
      );
      const stagedPayload = committedPayload(staged);
      const linked = await linkCanonicalContent(
        db,
        context,
        commandEnvelope(
          context,
          {
            ownerObjectType: 'ArtifactRevision',
            ownerObjectId: revisionId,
            ownerVersionId: revisionId,
          },
          {
            targetType: 'CanonicalContentObject',
            targetId: contentObjectId,
            commandType: 'artifact.content-object.link.issue-97',
            idempotencyKey: `issue-97-link-${contentObjectId}`,
            projectId: PROJECT_A,
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
            commandType: 'artifact.content-object.freeze.issue-97',
            idempotencyKey: `issue-97-freeze-${contentObjectId}`,
            projectId: PROJECT_A,
          },
        ),
      );
      const frozenPayload = committedPayload(frozen);
      const contentRef = frozenPayload.objectRef ?? stagedPayload.objectRef;
      if (typeof contentRef !== 'string')
        throw new Error('Content Object did not return a locator');
      const revision: Artifact.RevisionContent = {
        artifactRef: artifact.artifactRef,
        branchId: artifact.branchId,
        parentRevisionRefs: [],
        contentType: fixture.payload.contentType,
        contentRef,
        contentHash: fixture.manifest.contentHash,
        structureSchemaRef: fixture.payload.schemaRef,
        semanticMetadata: { issue: 97, fixture: 'ART-025' },
        changedUnits: ['representation-binding'],
        changeSummary: 'create exact Representation binding fixture',
        provenance: {
          principal: {
            kind: 'OBJECT',
            objectType: 'identity.principal',
            objectId: PRINCIPAL,
            scope: { enterpriseId: ENTERPRISE },
          },
          sourceMaterialRefs: [],
          toolchainVersions: [{ name: 'issue-97-test', version: '1' }],
        },
      };
      const result = await handleCreateAndSealRevision(
        db,
        context,
        commandEnvelope(
          context,
          { revision },
          {
            targetType: 'ArtifactRevision',
            targetId: revisionId,
            commandType: 'artifact.create_and_seal_revision.issue-97',
            idempotencyKey: `issue-97-revision-${revisionId}`,
            projectId: PROJECT_A,
          },
        ),
      );
      return committedPayload(result) as unknown as Artifact.RevisionSnapshot;
    }

    function attemptRef(attemptId: string, projectId = PROJECT_A): Common.ObjectRef {
      return {
        kind: 'OBJECT',
        objectType: 'integration.render_attempt',
        objectId: attemptId,
        scope: { enterpriseId: ENTERPRISE, projectId },
      };
    }

    function receiptRef(receiptId: string, projectId = PROJECT_A): Common.ContentAddressedRef {
      return {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'integration.raw_external_receipt',
        objectId: receiptId,
        scope: { enterpriseId: ENTERPRISE, projectId },
        contentHash: hash('55'.repeat(32)),
      };
    }

    function registration(
      revision: Artifact.RevisionSnapshot,
      attemptId: string,
      outputChecksum: string,
      outputObject: string,
      rendererVersion = '1.0.0',
    ): Artifact.RepresentationRegistration {
      return {
        revisionRef: revision.revisionRef,
        format: 'document.pdf',
        mediaType: 'application/pdf',
        objectRef: outputObject,
        checksum: hash(outputChecksum),
        rendererId: 'renderer.pdf',
        rendererVersion,
        renderAttemptRef: attemptRef(attemptId),
        createdAt: '2026-08-29T08:00:01Z',
      };
    }

    function binding(
      revision: Artifact.RevisionSnapshot,
      registration: Artifact.RepresentationRegistration,
      receiptId: string,
    ): IntegrationGateway.RenderAttemptBindingView {
      const rawReceiptRef = receiptRef(receiptId);
      return {
        attemptRef: registration.renderAttemptRef,
        status: 'SUCCEEDED',
        request: {
          revisionRef: revision.revisionRef,
          canonicalContentRef: revision.contentRef,
          inputHash: revision.revisionRef.contentHash,
          outputFormat: registration.format,
          rendererId: registration.rendererId,
          rendererVersion: registration.rendererVersion,
          renderPolicyRef: {
            kind: 'VERSIONED',
            objectType: 'policy.render',
            objectId: newUuidV7(),
            versionId: newUuidV7(),
            scope: { enterpriseId: ENTERPRISE, projectId: PROJECT_A },
          },
          stableIdempotencyKey: `render-${registration.renderAttemptRef.objectId}`,
          requestedAt: '2026-08-29T08:00:00Z',
        },
        requestPayloadHash: hash('33'.repeat(32)),
        succeededResult: {
          attemptRef: registration.renderAttemptRef,
          revisionRef: revision.revisionRef,
          outputObjectRef: registration.objectRef,
          outputChecksum: registration.checksum,
          rendererId: registration.rendererId,
          rendererVersion: registration.rendererVersion,
          rawReceiptRef,
        },
        rawReceiptRef,
      };
    }

    function portFor(value: unknown): RenderAttemptBindingQueryPort {
      return { getRenderAttemptBinding: () => Promise.resolve(structuredClone(value)) };
    }

    function representationEnvelope(
      context: ArtifactTransactionContext,
      registration: Artifact.RepresentationRegistration,
      targetId: string,
      suffix: string,
    ) {
      return commandEnvelope(
        context,
        { registration },
        {
          targetType: 'Representation',
          targetId,
          commandType: 'artifact.register_representation',
          idempotencyKey: `issue-97-representation-${suffix}`,
          projectId: PROJECT_A,
        },
      );
    }

    it('registers exact bindings, rejects substitution, replays once, isolates scope and rolls back atomically', async () => {
      const context = contextFor();
      const artifact = await createArtifact(context);
      const revision = await createRevision(context, artifact);
      expect(
        new ContractRegistry().validateOperationResult(
          'artifact.get_revision_snapshot',
          '1.0',
          revision,
        ),
      ).toMatchObject({ valid: true });
      const attemptId = newUuidV7();
      const representationId = newUuidV7();
      const exactRegistration = registration(
        revision,
        attemptId,
        '44'.repeat(32),
        'artifact/rendered/art-025.pdf',
      );
      const exactBinding = binding(revision, exactRegistration, newUuidV7());
      const exactEnvelope = representationEnvelope(
        context,
        exactRegistration,
        representationId,
        'exact',
      );
      const committed = await handleRegisterRepresentation(
        db,
        context,
        exactEnvelope,
        portFor(exactBinding),
      );
      expect(committed.status).toBe('COMMITTED');
      const view = committedPayload(committed) as unknown as Artifact.RepresentationView;
      expect(view.representationRef.representationId).toBe(representationId);
      expect(
        await handleGetRepresentation(db, context, { representationRef: view.representationRef }),
      ).toEqual(view);
      expect(await countRows('representation', 'representation_id = $1', [representationId])).toBe(
        1,
      );
      expect(
        await countRows('representation_validation', 'representation_id = $1', [representationId]),
      ).toBe(1);
      expect(
        await countRows(
          'outbox_event',
          "event_type = 'artifact.RepresentationRegistered' AND aggregate_id = $1",
          [representationId],
        ),
      ).toBe(1);
      expect(
        await countRows(
          'reference_edge',
          "owner_object_type = 'Representation' AND owner_object_id = $1",
          [representationId],
        ),
      ).toBe(3);

      const sameCommandReplay = await handleRegisterRepresentation(
        db,
        context,
        exactEnvelope,
        portFor(exactBinding),
      );
      expect(sameCommandReplay.status).toBe('DUPLICATE');
      const secondTarget = newUuidV7();
      const differentKeyReplay = await handleRegisterRepresentation(
        db,
        context,
        representationEnvelope(context, exactRegistration, secondTarget, 'different-key-replay'),
        portFor(exactBinding),
      );
      expect(differentKeyReplay.status).toBe('COMMITTED');
      expect(
        (committedPayload(differentKeyReplay) as unknown as Artifact.RepresentationView)
          .representationRef.representationId,
      ).toBe(representationId);
      expect(await countRows('representation', 'render_attempt_id = $1', [attemptId])).toBe(1);
      expect(
        await countRows(
          'outbox_event',
          "event_type = 'artifact.RepresentationRegistered' AND aggregate_id = $1",
          [representationId],
        ),
      ).toBe(1);

      const mismatchCases: {
        readonly label: string;
        readonly mutate: (
          candidate: DeepMutable<IntegrationGateway.RenderAttemptBindingView>,
        ) => void;
        readonly code: string;
      }[] = [
        {
          label: 'revision',
          mutate: (candidate) => {
            candidate.request.revisionRef.objectId = newUuidV7();
          },
          code: ARTIFACT_REPRESENTATION_BINDING_MISMATCH,
        },
        {
          label: 'input-hash',
          mutate: (candidate) => {
            candidate.request.inputHash.digest = '66'.repeat(32);
          },
          code: ARTIFACT_REPRESENTATION_BINDING_MISMATCH,
        },
        {
          label: 'renderer',
          mutate: (candidate) => {
            if (candidate.succeededResult === undefined) throw new Error('missing fixture result');
            candidate.succeededResult.rendererVersion = '2.0.0';
          },
          code: ARTIFACT_REPRESENTATION_BINDING_MISMATCH,
        },
        {
          label: 'checksum',
          mutate: (candidate) => {
            if (candidate.succeededResult === undefined) throw new Error('missing fixture result');
            candidate.succeededResult.outputChecksum.digest = '77'.repeat(32);
          },
          code: ARTIFACT_REPRESENTATION_BINDING_MISMATCH,
        },
      ];
      for (const mismatchCase of mismatchCases) {
        const candidate = structuredClone(
          exactBinding,
        ) as DeepMutable<IntegrationGateway.RenderAttemptBindingView>;
        mismatchCase.mutate(candidate);
        const targetId = newUuidV7();
        const rejected = await handleRegisterRepresentation(
          db,
          context,
          representationEnvelope(
            context,
            exactRegistration,
            targetId,
            `mismatch-${mismatchCase.label}`,
          ),
          portFor(candidate),
        );
        expect(rejected).toMatchObject({ status: 'REJECTED', errorCode: mismatchCase.code });
        expect(await countRows('representation', 'representation_id = $1', [targetId])).toBe(0);
      }

      const unknown = structuredClone(
        exactBinding,
      ) as DeepMutable<IntegrationGateway.RenderAttemptBindingView>;
      unknown.status = 'UNKNOWN';
      delete unknown.succeededResult;
      delete unknown.rawReceiptRef;
      const unknownTarget = newUuidV7();
      const unknownRejected = await handleRegisterRepresentation(
        db,
        context,
        representationEnvelope(context, exactRegistration, unknownTarget, 'unknown'),
        portFor(unknown),
      );
      expect(unknownRejected).toMatchObject({
        status: 'REJECTED',
        errorCode: ARTIFACT_REPRESENTATION_BINDING_INVALID,
      });
      expect(await countRows('representation', 'representation_id = $1', [unknownTarget])).toBe(0);

      const sameAttemptConflictRegistration = {
        ...exactRegistration,
        objectRef: 'artifact/rendered/substituted.pdf',
        checksum: hash('88'.repeat(32)),
      } satisfies Artifact.RepresentationRegistration;
      if (exactBinding.rawReceiptRef === undefined) throw new Error('missing fixture receipt');
      const sameAttemptConflictBinding = binding(
        revision,
        sameAttemptConflictRegistration,
        exactBinding.rawReceiptRef.objectId,
      );
      const sameAttemptConflict = await handleRegisterRepresentation(
        db,
        context,
        representationEnvelope(
          context,
          sameAttemptConflictRegistration,
          newUuidV7(),
          'same-attempt-conflict',
        ),
        portFor(sameAttemptConflictBinding),
      );
      expect(sameAttemptConflict).toMatchObject({
        status: 'REJECTED',
        errorCode: ARTIFACT_REPRESENTATION_IDENTITY_CONFLICT,
      });

      const distinctAttempt = newUuidV7();
      const distinctRepresentationId = newUuidV7();
      const distinctRegistration = registration(
        revision,
        distinctAttempt,
        '99'.repeat(32),
        'artifact/rendered/art-025-v2.pdf',
        '2.0.0',
      );
      const distinctCommitted = await handleRegisterRepresentation(
        db,
        context,
        representationEnvelope(
          context,
          distinctRegistration,
          distinctRepresentationId,
          'distinct-attempt',
        ),
        portFor(binding(revision, distinctRegistration, newUuidV7())),
      );
      expect(distinctCommitted.status).toBe('COMMITTED');
      expect(
        await countRows('representation', 'revision_id = $1', [revision.revisionRef.objectId]),
      ).toBe(2);

      const concurrentAttempt = newUuidV7();
      const concurrentRegistration = registration(
        revision,
        concurrentAttempt,
        'ab'.repeat(32),
        'artifact/rendered/concurrent.pdf',
      );
      const concurrentBinding = binding(revision, concurrentRegistration, newUuidV7());
      const concurrentTargetA = newUuidV7();
      const concurrentTargetB = newUuidV7();
      const concurrentResults = await Promise.all([
        handleRegisterRepresentation(
          db,
          context,
          representationEnvelope(
            context,
            concurrentRegistration,
            concurrentTargetA,
            'concurrent-a',
          ),
          portFor(concurrentBinding),
        ),
        handleRegisterRepresentation(
          db,
          context,
          representationEnvelope(
            context,
            concurrentRegistration,
            concurrentTargetB,
            'concurrent-b',
          ),
          portFor(concurrentBinding),
        ),
      ]);
      expect(concurrentResults.map((result) => result.status)).toEqual(['COMMITTED', 'COMMITTED']);
      const concurrentIds = concurrentResults.map(
        (result) =>
          (committedPayload(result) as unknown as Artifact.RepresentationView).representationRef
            .representationId,
      );
      expect(new Set(concurrentIds).size).toBe(1);
      expect([concurrentTargetA, concurrentTargetB]).toContain(concurrentIds[0]);
      expect(await countRows('representation', 'render_attempt_id = $1', [concurrentAttempt])).toBe(
        1,
      );
      expect(
        await countRows(
          'outbox_event',
          "event_type = 'artifact.RepresentationRegistered' AND aggregate_id = $1",
          [concurrentIds[0]],
        ),
      ).toBe(1);

      const rollbackAttempt = newUuidV7();
      const rollbackTarget = newUuidV7();
      const rollbackRegistration = registration(
        revision,
        rollbackAttempt,
        'aa'.repeat(32),
        'artifact/rendered/rollback.pdf',
      );
      const rollbackEnvelope = representationEnvelope(
        context,
        rollbackRegistration,
        rollbackTarget,
        'rollback',
      );
      await expect(
        handleRegisterRepresentation(
          db,
          context,
          rollbackEnvelope,
          portFor(binding(revision, rollbackRegistration, newUuidV7())),
          { failAfterOutbox: true },
        ),
      ).rejects.toThrow('controlled fault after outbox write');
      expect(await countRows('representation', 'representation_id = $1', [rollbackTarget])).toBe(0);
      expect(
        await countRows('representation_validation', 'representation_id = $1', [rollbackTarget]),
      ).toBe(0);
      expect(
        await countRows('command_receipt', 'command_id = $1', [rollbackEnvelope.commandId]),
      ).toBe(0);

      const wrongScopeVisible = await withProbeContext(contextFor([PROJECT_B]), async () => {
        const result = await probe.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM artifact.representation WHERE representation_id = $1',
          [representationId],
        );
        return result.rows[0]?.count;
      });
      expect(wrongScopeVisible).toBe('0');
      const directUpdate = await withProbeContext(context, () =>
        tryQuery(
          probe,
          'UPDATE artifact.representation SET renderer_version = $2 WHERE representation_id = $1',
          [representationId, 'forged'],
        ),
      );
      expect(directUpdate).toMatchObject({ allowed: false, code: '42501' });
      const directDelete = await withProbeContext(context, () =>
        tryQuery(probe, 'DELETE FROM artifact.representation WHERE representation_id = $1', [
          representationId,
        ]),
      );
      expect(directDelete).toMatchObject({ allowed: false, code: '42501' });

      const wrongRef = structuredClone(
        view.representationRef,
      ) as DeepMutable<Artifact.RepresentationRef>;
      wrongRef.checksum.digest = 'bb'.repeat(32);
      await expect(
        handleGetRepresentation(db, context, { representationRef: wrongRef }),
      ).rejects.toMatchObject({
        code: ARTIFACT_QUERY_NOT_FOUND,
      });

      const privileges = await admin.query<{
        can_insert: boolean;
        can_execute: boolean;
      }>(`
        SELECT has_table_privilege('artifact_app', 'artifact.representation', 'INSERT') AS can_insert,
               has_function_privilege(
                 'artifact_app',
                 'artifact.register_representation(uuid,uuid,uuid,jsonb,uuid,uuid,text,text,text,bytea,text,text,jsonb,text,bytea,bytea,jsonb,timestamptz,uuid,text,text,uuid,uuid,uuid,uuid)',
                 'EXECUTE') AS can_execute
      `);
      expect(privileges.rows[0]).toEqual({ can_insert: false, can_execute: true });
    });
  },
);
