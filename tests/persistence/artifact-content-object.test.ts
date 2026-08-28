import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Artifact, Common } from '@zhiju/contracts';
import {
  ARTIFACT_CONTENT_NOT_FINALIZED,
  ARTIFACT_CONTENT_READBACK_MISMATCH,
  ArtifactRepository,
  cleanupCanonicalContentOrphans,
  createArtifactDatabase,
  finalizeCanonicalContent,
  freezeCanonicalContent,
  InMemoryObjectStorage,
  linkCanonicalContent,
  quarantineCanonicalContent,
  stageCanonicalContent,
  type ArtifactTransactionContext,
  type ArtifactTransaction,
  type CanonicalContentCommandEnvelope,
  type LinkCanonicalContentPayload,
  type ObjectStoragePort,
  type StageCanonicalContentPayload,
} from '@zhiju/artifact';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import { withArtifactTransaction } from '@zhiju/artifact';

// IM-04 WI-04 (issue #93): real PostgreSQL acceptance for Canonical Content
// Object staging, authoritative readback, link/finalize/freeze and orphan
// cleanup. The fixture is synthetic and does not require EnterpriseProject
// rows or a real object-storage provider.

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT_A = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const PROJECT_B = '018f22e2-7c15-7b2e-8d86-2de956a9d203';
const PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9d302';
const ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d303';
const DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9d304';
const POLICY = '018f22e2-7c15-7b2e-8d86-2de956a9d305';

interface CanonicalFixture {
  readonly payload: Artifact.CanonicalContentPayload;
  readonly manifest: { readonly contentHash: Common.ContentHash };
}

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
    authorizationDecisionHash: Buffer.alloc(32, 0x93),
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY,
    enterpriseId: ENTERPRISE,
    allowedProjectIds,
    correlationId: newUuidV7(),
    ...overrides,
  };
}

function commandEnvelope<TPayload>(
  context: ArtifactTransactionContext,
  payload: TPayload,
  options: {
    readonly targetId?: string;
    readonly projectId?: string;
    readonly commandType?: string;
    readonly idempotencyKey?: string;
    readonly expectedAggregateVersion?: string;
  } = {},
): CanonicalContentCommandEnvelope<TPayload> {
  return {
    commandId: newUuidV7(),
    commandType: options.commandType ?? 'artifact.content-object.test',
    commandVersion: '1.0',
    idempotencyScope: 'im04-wi04-test',
    idempotencyKey: options.idempotencyKey ?? `wi04-${newUuidV7()}`,
    requestPayload: payload as unknown as CanonicalJsonObject,
    enterpriseId: context.enterpriseId,
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
    targetType: 'CanonicalContentObject',
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

function stagePayload(
  fixture: CanonicalFixture,
  options: {
    readonly declaredContentHash?: Common.ContentHash;
    readonly legalHold?: boolean;
    readonly retentionUntil?: string;
  } = {},
): StageCanonicalContentPayload {
  return {
    content: structuredClone(fixture.payload),
    declaredContentHash: options.declaredContentHash ?? fixture.manifest.contentHash,
    ...(options.legalHold === undefined ? {} : { legalHold: options.legalHold }),
    ...(options.retentionUntil === undefined ? {} : { retentionUntil: options.retentionUntil }),
  };
}

function linkPayload(): LinkCanonicalContentPayload {
  return {
    ownerObjectType: 'ArtifactRevision',
    ownerObjectId: newUuidV7(),
    ownerVersionId: newUuidV7(),
  };
}

class TamperingStorage implements ObjectStoragePort {
  constructor(readonly delegate: InMemoryObjectStorage) {}

  async putStaging(input: Parameters<ObjectStoragePort['putStaging']>[0]) {
    const reference = await this.delegate.putStaging(input);
    this.delegate.tamper(reference.objectLocator, {
      bytes: Buffer.from('{"tampered":true}', 'utf8'),
      mediaType: 'application/octet-stream',
      reportedByteSize: 17,
    });
    return reference;
  }

  read(reference: Parameters<ObjectStoragePort['read']>[0]) {
    return this.delegate.read(reference);
  }

  finalize(reference: Parameters<ObjectStoragePort['finalize']>[0]) {
    return this.delegate.finalize(reference);
  }

  delete(reference: Parameters<ObjectStoragePort['delete']>[0]) {
    return this.delegate.delete(reference);
  }
}

class BlockingDeleteStorage implements ObjectStoragePort {
  readonly deleteStarted: Promise<void>;
  readonly #release: Promise<void>;
  readonly #resolveDeleteStarted: () => void;
  readonly #releaseDelete: () => void;

  constructor(readonly delegate: InMemoryObjectStorage) {
    let resolveDeleteStarted: () => void = () => undefined;
    let releaseDelete: () => void = () => undefined;
    this.deleteStarted = new Promise<void>((resolve) => {
      resolveDeleteStarted = resolve;
    });
    this.#release = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    this.#resolveDeleteStarted = resolveDeleteStarted;
    this.#releaseDelete = releaseDelete;
  }

  putStaging(input: Parameters<ObjectStoragePort['putStaging']>[0]) {
    return this.delegate.putStaging(input);
  }

  read(reference: Parameters<ObjectStoragePort['read']>[0]) {
    return this.delegate.read(reference);
  }

  finalize(reference: Parameters<ObjectStoragePort['finalize']>[0]) {
    return this.delegate.finalize(reference);
  }

  async delete(reference: Parameters<ObjectStoragePort['delete']>[0]) {
    this.#resolveDeleteStarted();
    await this.#release;
    return this.delegate.delete(reference);
  }

  release(): void {
    this.#releaseDelete();
  }
}

describe.skipIf(databaseUrl === undefined)(
  'Artifact WI-04 Canonical Content Object (real PostgreSQL)',
  () => {
    let admin: pg.Client;
    let probe: pg.Client;
    let pool: pg.Pool;
    let db: ReturnType<typeof createArtifactDatabase>;
    let repo: ArtifactRepository;
    const fixture = loadFixture();

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(
        "CREATE ROLE im04_wi04_probe LOGIN PASSWORD 'im04-wi04-probe' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
      );
      await admin.query('GRANT platform_context_establisher, artifact_app TO im04_wi04_probe');
      const probeUrl = new URL(databaseUrl ?? '');
      probeUrl.username = 'im04_wi04_probe';
      probeUrl.password = 'im04-wi04-probe';
      probe = new pg.Client({ connectionString: probeUrl.toString() });
      await probe.connect();
      pool = new pg.Pool({ connectionString: probeUrl.toString(), max: 6 });
      db = createArtifactDatabase(pool);
      repo = new ArtifactRepository();
    });

    afterAll(async () => {
      await probe.end();
      await pool.end();
      await admin.end();
    });

    async function contentRow(
      contentObjectId: string,
    ): Promise<Record<string, unknown> | undefined> {
      const result = await admin.query(
        `SELECT content_object_id, storage_state, finalization_state, aggregate_version::text,
              object_locator, object_version_id, content_hash, byte_size::text, media_type
         FROM artifact.artifact_content_object
        WHERE content_object_id = $1`,
        [contentObjectId],
      );
      return result.rows[0] as Record<string, unknown> | undefined;
    }

    async function orphanRow(
      contentObjectId: string,
    ): Promise<Record<string, unknown> | undefined> {
      const result = await admin.query(
        `SELECT orphan_id, storage_state, outcome, attempt_count, legal_hold, next_attempt_at,
              object_locator, object_version_id
         FROM artifact.artifact_content_object_orphan
        WHERE content_object_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
        [contentObjectId],
      );
      return result.rows[0] as Record<string, unknown> | undefined;
    }

    async function makeRollbackOrphan(
      storage: InMemoryObjectStorage,
      options: { readonly legalHold?: boolean; readonly retentionUntil?: string } = {},
    ): Promise<{ readonly contentObjectId: string; readonly orphan: Record<string, unknown> }> {
      const contentObjectId = newUuidV7();
      const context = contextFor();
      const payload = stagePayload(fixture, options);
      const envelope = commandEnvelope(context, payload, {
        targetId: contentObjectId,
        projectId: PROJECT_A,
        commandType: 'artifact.content-object.rollback-probe',
      });
      const signature =
        'artifact.create_content_object(uuid, uuid, uuid, jsonb, text, text, bytea, bigint, text, text, text, text, timestamptz, text, timestamptz, boolean, uuid, uuid, uuid, uuid)';
      await admin.query(`REVOKE EXECUTE ON FUNCTION ${signature} FROM artifact_app`);
      try {
        await expect(stageCanonicalContent(db, context, envelope, storage)).rejects.toMatchObject({
          code: '42501',
        });
      } finally {
        await admin.query(`GRANT EXECUTE ON FUNCTION ${signature} TO artifact_app`);
      }
      expect(await contentRow(contentObjectId)).toBeUndefined();
      await admin.query(
        `UPDATE artifact.artifact_content_object_orphan
          SET eligible_at = now() - interval '1 minute',
              next_attempt_at = now() - interval '1 minute'
        WHERE content_object_id = $1`,
        [contentObjectId],
      );
      const orphan = await orphanRow(contentObjectId);
      if (orphan === undefined) throw new Error('rollback did not create an orphan');
      return { contentObjectId, orphan };
    }

    it('stages, links, finalizes and freezes only after authoritative readback verification', async () => {
      const context = contextFor();
      const storage = new InMemoryObjectStorage();
      const contentObjectId = newUuidV7();
      const staged = await stageCanonicalContent(
        db,
        context,
        commandEnvelope(context, stagePayload(fixture), {
          targetId: contentObjectId,
          projectId: PROJECT_A,
          commandType: 'artifact.content-object.stage',
        }),
        storage,
      );
      expect(staged.status).toBe('COMMITTED');
      expect(await contentRow(contentObjectId)).toMatchObject({
        storage_state: 'STAGING',
        finalization_state: 'STAGED',
        aggregate_version: '1',
        media_type: 'application/json',
      });
      const directStagingFinalize = await withArtifactProbeTransaction(context, (trx) =>
        repo.markContentObjectFinalization(trx, {
          contentObjectId,
          finalized: true,
          updatedByPrincipalId: context.principalId,
          updatedByActorSnapshotId: context.actorSnapshotId,
          lastAuthorizationDecisionId: context.authorizationDecisionId,
          sourceCommandId: newUuidV7(),
        }),
      );
      expect(directStagingFinalize).toBe('INVALID_STATE');

      const ownerPayload = linkPayload();
      const linked = await linkCanonicalContent(
        db,
        context,
        commandEnvelope(context, ownerPayload, {
          targetId: contentObjectId,
          commandType: 'artifact.content-object.link',
        }),
        storage,
      );
      expect(linked.commandResult.status).toBe('COMMITTED');
      expect(linked.finalizationState).toBe('FINALIZED');
      expect(await contentRow(contentObjectId)).toMatchObject({
        storage_state: 'LINKED',
        finalization_state: 'FINALIZED',
        aggregate_version: '3',
      });
      const linkedAgain = await linkCanonicalContent(
        db,
        context,
        commandEnvelope(context, ownerPayload, {
          targetId: contentObjectId,
          commandType: 'artifact.content-object.link-replay',
        }),
        storage,
      );
      expect(linkedAgain.commandResult.status).toBe('COMMITTED');
      expect(linkedAgain.finalizationState).toBe('FINALIZED');
      const linkFacts = await admin.query<{ outbox_count: string; edge_count: string }>(
        `SELECT
            (SELECT count(*)::text FROM artifact.outbox_event WHERE aggregate_id = $1) AS outbox_count,
            (SELECT count(*)::text FROM artifact.reference_edge WHERE owner_object_id = $1) AS edge_count`,
        [contentObjectId],
      );
      expect(linkFacts.rows[0]).toEqual({ outbox_count: '2', edge_count: '2' });

      const frozen = await freezeCanonicalContent(
        db,
        context,
        commandEnvelope(
          context,
          {},
          {
            targetId: contentObjectId,
            commandType: 'artifact.content-object.freeze',
          },
        ),
      );
      expect(frozen.status).toBe('COMMITTED');
      expect(await contentRow(contentObjectId)).toMatchObject({
        storage_state: 'FROZEN',
        finalization_state: 'FINALIZED',
        aggregate_version: '4',
      });

      const directUpdate = await (async () => {
        await probe.query('BEGIN');
        await probe.query('SET LOCAL ROLE artifact_app');
        try {
          await probe.query(
            'UPDATE artifact.artifact_content_object SET content_hash = $1 WHERE content_object_id = $2',
            [Buffer.alloc(32, 0x01), contentObjectId],
          );
          return { allowed: true };
        } catch (error) {
          return { allowed: false, code: (error as pg.DatabaseError).code };
        } finally {
          await probe.query('ROLLBACK');
        }
      })();
      expect(directUpdate).toEqual({ allowed: false, code: '42501' });
    });

    it('quarantines authoritative readback tampering and rejects cross-Project schema scope', async () => {
      const mismatchedHash: Common.ContentHash = {
        ...fixture.manifest.contentHash,
        digest: `0${fixture.manifest.contentHash.digest.slice(1)}`,
      };
      const hashObjectId = newUuidV7();
      const hashStorage = new InMemoryObjectStorage();
      const hashContext = contextFor();
      const hashRejected = await stageCanonicalContent(
        db,
        hashContext,
        commandEnvelope(
          hashContext,
          stagePayload(fixture, { declaredContentHash: mismatchedHash }),
          {
            targetId: hashObjectId,
            projectId: PROJECT_A,
            commandType: 'artifact.content-object.hash-mismatch',
          },
        ),
        hashStorage,
      );
      expect(hashRejected).toMatchObject({
        status: 'REJECTED',
        errorCode: 'ARTIFACT_CONTENT_HASH_MISMATCH',
      });
      expect(hashStorage.has(`staging/canonical/${hashObjectId}`)).toBe(false);
      expect(await contentRow(hashObjectId)).toBeUndefined();

      const tamperingStorage = new TamperingStorage(new InMemoryObjectStorage());
      const context = contextFor();
      const contentObjectId = newUuidV7();
      const tampered = await stageCanonicalContent(
        db,
        context,
        commandEnvelope(context, stagePayload(fixture), {
          targetId: contentObjectId,
          projectId: PROJECT_A,
          commandType: 'artifact.content-object.tamper',
        }),
        tamperingStorage,
      );
      expect(tampered).toMatchObject({
        status: 'REJECTED',
        errorCode: ARTIFACT_CONTENT_READBACK_MISMATCH,
      });
      expect(await contentRow(contentObjectId)).toBeUndefined();
      expect(await orphanRow(contentObjectId)).toMatchObject({
        storage_state: 'QUARANTINED',
        outcome: 'PENDING',
      });

      const wrongProjectContext = contextFor([PROJECT_B]);
      const wrongProjectObject = newUuidV7();
      const wrongProject = await stageCanonicalContent(
        db,
        wrongProjectContext,
        commandEnvelope(wrongProjectContext, stagePayload(fixture), {
          targetId: wrongProjectObject,
          projectId: PROJECT_B,
          commandType: 'artifact.content-object.cross-scope',
        }),
        new InMemoryObjectStorage(),
      );
      expect(wrongProject).toMatchObject({
        status: 'REJECTED',
        errorCode: 'ARTIFACT_CONTENT_SCHEMA_INVALID',
      });
      expect(await orphanRow(wrongProjectObject)).toBeUndefined();
    });

    it('keeps LINKED when finalize is unknown and prevents freeze until retry succeeds', async () => {
      const context = contextFor();
      const storage = new InMemoryObjectStorage();
      storage.setFinalizeFailure(true);
      const contentObjectId = newUuidV7();
      await stageCanonicalContent(
        db,
        context,
        commandEnvelope(context, stagePayload(fixture), {
          targetId: contentObjectId,
          projectId: PROJECT_A,
          commandType: 'artifact.content-object.finalize-retry',
        }),
        storage,
      );
      const link = await linkCanonicalContent(
        db,
        context,
        commandEnvelope(context, linkPayload(), {
          targetId: contentObjectId,
          commandType: 'artifact.content-object.link-retry',
        }),
        storage,
      );
      expect(link.finalizationState).toBe('UNKNOWN');
      expect(await contentRow(contentObjectId)).toMatchObject({
        storage_state: 'LINKED',
        finalization_state: 'UNKNOWN',
      });
      const blocked = await freezeCanonicalContent(
        db,
        context,
        commandEnvelope(
          context,
          {},
          {
            targetId: contentObjectId,
            commandType: 'artifact.content-object.freeze-blocked',
          },
        ),
      );
      expect(blocked).toMatchObject({
        status: 'REJECTED',
        errorCode: ARTIFACT_CONTENT_NOT_FINALIZED,
      });

      storage.setFinalizeFailure(false);
      const finalized = await finalizeCanonicalContent(
        db,
        context,
        commandEnvelope(
          context,
          {},
          {
            targetId: contentObjectId,
            commandType: 'artifact.content-object.finalize-success',
          },
        ),
        storage,
      );
      expect(finalized).toBe('FINALIZED');
      const frozen = await freezeCanonicalContent(
        db,
        context,
        commandEnvelope(
          context,
          {},
          {
            targetId: contentObjectId,
            commandType: 'artifact.content-object.freeze-after-retry',
          },
        ),
      );
      expect(frozen.status).toBe('COMMITTED');
    });

    it('records rollback orphans and exercises grace, lease fencing, retry, NOT_FOUND and legal hold cleanup', async () => {
      const context = contextFor();
      const storage = new InMemoryObjectStorage();
      const rollback = await makeRollbackOrphan(storage);
      const cleaned = await cleanupCanonicalContentOrphans(db, context, storage, 'wi04-worker-a');
      expect(cleaned).toHaveLength(1);
      expect(cleaned[0]).toMatchObject({ orphanId: rollback.orphan.orphan_id, outcome: 'DELETED' });
      expect(storage.has(String(rollback.orphan.object_locator))).toBe(false);
      expect(await orphanRow(rollback.contentObjectId)).toMatchObject({ outcome: 'DELETED' });
      expect(await cleanupCanonicalContentOrphans(db, context, storage, 'wi04-worker-a')).toEqual(
        [],
      );

      const unknownRollback = await makeRollbackOrphan(storage);
      storage.setDeleteOutcome('UNKNOWN');
      const unknown = await cleanupCanonicalContentOrphans(db, context, storage, 'wi04-worker-b');
      expect(unknown[0]).toMatchObject({
        orphanId: unknownRollback.orphan.orphan_id,
        outcome: 'UNKNOWN',
      });
      await admin.query(
        `UPDATE artifact.artifact_content_object_orphan
          SET next_attempt_at = now() - interval '1 minute'
        WHERE content_object_id = $1`,
        [unknownRollback.contentObjectId],
      );
      storage.setDeleteOutcome('NOT_FOUND');
      const notFound = await cleanupCanonicalContentOrphans(db, context, storage, 'wi04-worker-b');
      expect(notFound[0]).toMatchObject({
        orphanId: unknownRollback.orphan.orphan_id,
        outcome: 'NOT_FOUND',
      });
      expect(await cleanupCanonicalContentOrphans(db, context, storage, 'wi04-worker-b')).toEqual(
        [],
      );

      const retainedRollback = await makeRollbackOrphan(storage, {
        retentionUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      const retained = await cleanupCanonicalContentOrphans(db, context, storage, 'wi04-worker-b');
      expect(retained[0]).toMatchObject({
        orphanId: retainedRollback.orphan.orphan_id,
        outcome: 'RETRY',
      });
      expect(storage.has(String(retainedRollback.orphan.object_locator))).toBe(true);
      expect(await orphanRow(retainedRollback.contentObjectId)).toMatchObject({
        outcome: 'RETRY',
      });

      const heldRollback = await makeRollbackOrphan(storage, { legalHold: true });
      storage.setDeleteOutcome(undefined);
      const held = await cleanupCanonicalContentOrphans(db, context, storage, 'wi04-worker-c');
      expect(held[0]).toMatchObject({ orphanId: heldRollback.orphan.orphan_id, outcome: 'HELD' });
      expect(storage.has(String(heldRollback.orphan.object_locator))).toBe(true);

      const concurrentRollback = await makeRollbackOrphan(storage);
      const blockingStorage = new BlockingDeleteStorage(storage);
      const firstCleanup = cleanupCanonicalContentOrphans(
        db,
        context,
        blockingStorage,
        'wi04-worker-concurrent-a',
      );
      await blockingStorage.deleteStarted;
      const secondCleanup = await cleanupCanonicalContentOrphans(
        db,
        context,
        storage,
        'wi04-worker-concurrent-b',
      );
      expect(secondCleanup).toEqual([]);
      blockingStorage.release();
      await expect(firstCleanup).resolves.toMatchObject([
        { orphanId: concurrentRollback.orphan.orphan_id, outcome: 'DELETED' },
      ]);

      const fencedRollback = await makeRollbackOrphan(storage);
      const tokenA = newUuidV7();
      const tokenB = newUuidV7();
      const claim = await withArtifactProbeTransaction(context, async (trx) =>
        repo.claimContentObjectOrphan(trx, 'wi04-worker-fence', tokenA),
      );
      expect(claim?.orphan_id).toBe(fencedRollback.orphan.orphan_id);
      const fenced = await withArtifactProbeTransaction(context, async (trx) =>
        repo.completeContentObjectOrphan(
          trx,
          fencedRollback.orphan.orphan_id as string,
          'wi04-worker-fence',
          tokenB,
          'DELETED',
        ),
      );
      expect(fenced).toBe('FENCED');
      const completed = await withArtifactProbeTransaction(context, async (trx) =>
        repo.completeContentObjectOrphan(
          trx,
          fencedRollback.orphan.orphan_id as string,
          'wi04-worker-fence',
          tokenA,
          'DELETED',
        ),
      );
      expect(completed).toBe('DELETED');
    });

    it('allows only owner functions to quarantine a persisted manifest and preserves the no-public-URL locator boundary', async () => {
      const context = contextFor();
      const storage = new InMemoryObjectStorage();
      const contentObjectId = newUuidV7();
      await stageCanonicalContent(
        db,
        context,
        commandEnvelope(context, stagePayload(fixture), {
          targetId: contentObjectId,
          projectId: PROJECT_A,
          commandType: 'artifact.content-object.quarantine',
        }),
        storage,
      );
      const quarantined = await quarantineCanonicalContent(
        db,
        context,
        commandEnvelope(
          context,
          {
            reasonCode: 'SECURITY_REVIEW',
            safeSummary: 'staging/canonical/secret locator should be redacted',
          },
          { targetId: contentObjectId, commandType: 'artifact.content-object.quarantine-command' },
        ),
      );
      expect(quarantined.status).toBe('COMMITTED');
      expect(await contentRow(contentObjectId)).toMatchObject({ storage_state: 'QUARANTINED' });
      const quarantine = await admin.query<{ safe_summary: string }>(
        `SELECT safe_summary
           FROM artifact.artifact_content_object_quarantine
          WHERE content_object_id = $1`,
        [contentObjectId],
      );
      expect(quarantine.rows[0]?.safe_summary).toBe(
        'content object was quarantined by an owning command',
      );
      const manifest = await admin.query(
        `SELECT object_locator FROM artifact.artifact_content_object WHERE content_object_id = $1`,
        [contentObjectId],
      );
      expect(String(manifest.rows[0]?.object_locator)).not.toMatch(/^https?:\/\//u);
    });

    async function withArtifactProbeTransaction<T>(
      context: ArtifactTransactionContext,
      fn: (trx: ArtifactTransaction) => Promise<T>,
    ): Promise<T> {
      return withArtifactTransaction(db, context, fn);
    }
  },
);
