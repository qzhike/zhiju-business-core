import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  MvpDatabase,
  MvpError,
  MvpService,
  errorCodeOf,
  type SessionIdentity,
} from '../../modules/document-delivery/src/index.js';
import {
  entryObjectKey,
  originalObjectKey,
} from '../../modules/document-delivery/src/custody/keys.js';
import {
  applyMvpMigration,
  corruptStoredFile,
  createMvpDatabase,
  docxBytes,
  markdownBytes,
  provisionMvp,
  sha256,
  singleChunk,
  textBytes,
  xlsxBytes,
  zipBytes,
  type MvpFixture,
} from './mvp-fixtures.js';

const adminUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = adminUrl !== undefined;
const terminal = new Set(['RECEIVED', 'PARTIAL', 'REJECTED', 'FAILED', 'ABANDONED']);

describe.skipIf(!gateEnabled)('MVP01 document delivery custody (isolated PostgreSQL)', () => {
  let admin: Client | undefined;
  let fixture: MvpFixture;
  let database: MvpDatabase;
  let service: MvpService;
  let identity: SessionIdentity;

  beforeAll(async () => {
    if (adminUrl === undefined) throw new Error('persistence gate is required');
    admin = await createMvpDatabase(adminUrl);
    await applyMvpMigration(adminUrl);
    fixture = await provisionMvp(adminUrl, { owner2: true });
    identity = {
      ownerId: fixture.ownerId,
      displayName: 'MVP 操作者',
      authEpoch: 1,
    };
    database = new MvpDatabase({ connectionString: fixture.databaseUrl });
    service = new MvpService({
      database,
      store: fixture.store,
      cursorKey: Buffer.alloc(32, 7),
      incarnation: 'vitest',
    });
    await service.startup();
  }, 180_000);

  afterAll(async () => {
    try {
      await database.close();
    } catch {
      // beforeAll may have failed before a pool existed.
    }
    await admin?.end();
  }, 60_000);

  async function createProject(
    name = '客户甲',
    actor: SessionIdentity = identity,
  ): Promise<string> {
    const projectId = newUuidV7();
    await service.createProject(actor, {
      requestId: newUuidV7(),
      projectId,
      payload: { customerName: name, title: `${name}交付项目` },
    });
    return projectId;
  }

  async function createBatch(
    projectId: string,
    bytes: Buffer,
    note?: string,
    actor: SessionIdentity = identity,
  ): Promise<{ batchId: string; version: number }> {
    const project = await service.getProject(actor, projectId);
    const batchId = newUuidV7();
    const outcome = await service.createBatch(actor, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: {
        expectedProjectVersion: project.version,
        originalName: 'materials.zip',
        declaredBytes: bytes.length,
        zipSha256: sha256(bytes),
        ...(note === undefined ? {} : { note }),
      },
    });
    return { batchId, version: outcome.data.batch.version };
  }

  async function upload(
    projectId: string,
    batchId: string,
    bytes: Buffer,
    contentLength = bytes.length,
    actor: SessionIdentity = identity,
  ): Promise<void> {
    const detail = await service.getBatch(actor, projectId, batchId, 20, undefined);
    const attempt = detail.batch.currentAttempt;
    if (attempt === undefined) throw new Error('batch has no attempt');
    await service.upload(actor, {
      projectId,
      batchId,
      attemptId: attempt.attemptId,
      generation: attempt.generation,
      contentLength,
      chunks: singleChunk(bytes),
    });
  }

  async function currentEpoch(): Promise<number> {
    const binding = await service.currentBinding(fixture.ownerId);
    if (binding === undefined) throw new Error('operator binding missing');
    return binding.authEpoch;
  }

  async function advanceEpoch(): Promise<number> {
    const adminConnection = new URL(fixture.adminUrl);
    adminConnection.pathname = '/zhiju_mvp_test';
    const owner = new Client({ connectionString: adminConnection.toString() });
    await owner.connect();
    try {
      await owner.query('SET ROLE mvp_ddl');
      const result = await owner.query<{ auth_epoch: string }>(
        `UPDATE document_delivery.operator_binding
         SET auth_epoch = auth_epoch + 1 WHERE owner_id = $1
         RETURNING auth_epoch`,
        [fixture.ownerId],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('binding update returned no row');
      return Number(row.auth_epoch);
    } finally {
      await owner.end();
    }
  }

  async function openService(incarnation: string): Promise<void> {
    database = new MvpDatabase({ connectionString: fixture.databaseUrl });
    service = new MvpService({
      database,
      store: fixture.store,
      cursorKey: Buffer.alloc(32, 7),
      incarnation,
    });
    await service.startup();
  }

  async function restartService(incarnation: string): Promise<void> {
    await database.close();
    await openService(incarnation);
  }

  async function withMvpAdmin<T>(run: (client: Client) => Promise<T>): Promise<T> {
    const adminConnection = new URL(fixture.adminUrl);
    adminConnection.pathname = '/zhiju_mvp_test';
    const owner = new Client({ connectionString: adminConnection.toString() });
    await owner.connect();
    try {
      await owner.query('SET ROLE mvp_ddl');
      return await run(owner);
    } finally {
      await owner.end();
    }
  }

  async function manifestCount(batchId: string): Promise<number> {
    const result = await withMvpAdmin((client) =>
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM document_delivery.input_manifests
         WHERE owner_id = $1 AND batch_id = $2`,
        [fixture.ownerId, batchId],
      ),
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async function waitForTerminal(
    projectId: string,
    batchId: string,
    viewer: SessionIdentity = identity,
  ) {
    await service.whenIdle();
    const detail = await service.getBatch(viewer, projectId, batchId, 20, undefined);
    if (!terminal.has(detail.batch.status))
      throw new Error(`batch did not reach a terminal state: ${detail.batch.status}`);
    return detail;
  }

  it('creates, replays and conflicts a project idempotently', async () => {
    const projectId = newUuidV7();
    const requestId = newUuidV7();
    const input = {
      requestId,
      projectId,
      payload: { customerName: '客户甲', title: '资料托管项目' },
    };
    const first = await service.createProject(identity, input);
    expect(first.replayed).toBe(false);
    const replay = await service.createProject(identity, input);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt).toEqual(first.receipt);
    await expect(
      service.createProject(identity, {
        ...input,
        payload: { customerName: '客户甲', title: '不同标题' },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(
      service.createProject(identity, { ...input, requestId: newUuidV7() }),
    ).rejects.toMatchObject({ code: 'TARGET_EXISTS' });
  });

  it('receives a mixed DOCX/Markdown/XLSX package with exact bytes and paths', async () => {
    const projectId = await createProject();
    const docx = docxBytes();
    const markdown = markdownBytes();
    const xlsx = xlsxBytes();
    const original = zipBytes([
      { name: 'readme.md', bytes: markdown },
      { name: 'specifications/', bytes: Buffer.alloc(0), directory: true },
      { name: 'specifications/design.docx', bytes: docx },
      { name: 'budget.xlsx', bytes: xlsx },
      { name: 'legacy.xls', bytes: textBytes('not a workbook') },
    ]);
    const { batchId } = await createBatch(projectId, original);
    await upload(projectId, batchId, original);
    const detail = await waitForTerminal(projectId, batchId);
    expect(detail.batch.status).toBe('PARTIAL');
    expect(detail.manifest).not.toBeNull();
    const manifestId = detail.manifest?.manifestId;
    if (manifestId === undefined) throw new Error('manifest missing');
    const page = await service.getEntries(identity, projectId, batchId, manifestId, 100, undefined);
    expect(page.entries.map((entry) => entry.originalName)).toEqual([
      'readme.md',
      'specifications/design.docx',
      'budget.xlsx',
      'legacy.xls',
    ]);
    expect(page.entries.map((entry) => entry.status)).toEqual([
      'ACCEPTED',
      'ACCEPTED',
      'ACCEPTED',
      'UNSUPPORTED',
    ]);
    expect(page.entries[3]?.reasonCodes).toEqual(['UNSUPPORTED_MEDIA_TYPE']);

    const sealedManifest = detail.manifest;
    if (sealedManifest === undefined) throw new Error('manifest missing');
    const originalSource = await service.readSource(
      identity,
      projectId,
      batchId,
      sealedManifest.originalZip.sourceId,
    );
    expect(originalSource.bytes.equals(original)).toBe(true);
    expect(originalSource.sourceRef.sha256).toBe(sha256(original));
    expect(originalSource.sourceRef.byteLength).toBe(original.length);

    for (const entry of page.entries) {
      if (entry.sourceRef === undefined) continue;
      const source = await service.readSource(
        identity,
        projectId,
        batchId,
        entry.sourceRef.sourceId,
      );
      expect(sha256(source.bytes)).toBe(entry.sourceRef.sha256);
      if (entry.originalName === 'readme.md') expect(source.bytes.equals(markdown)).toBe(true);
      if (entry.originalName === 'specifications/design.docx')
        expect(source.bytes.equals(docx)).toBe(true);
      if (entry.originalName === 'budget.xlsx') expect(source.bytes.equals(xlsx)).toBe(true);
    }

    const request = await service.getRequest(identity, detail.batch.originalRequestId);
    expect(request.operation).toBe('mvp.create_input_batch');
  });

  it('rejects an unsafe outer package without creating a manifest', async () => {
    const projectId = await createProject();
    const unsafe = zipBytes([{ name: '../escape.md', bytes: markdownBytes() }]);
    const { batchId } = await createBatch(projectId, unsafe);
    await upload(projectId, batchId, unsafe);
    const detail = await waitForTerminal(projectId, batchId);
    expect(detail.batch.status).toBe('REJECTED');
    expect(detail.manifest).toBeUndefined();
    await expect(
      service.getEntries(identity, projectId, batchId, newUuidV7(), 50, undefined),
    ).rejects.toMatchObject({ code: 'MANIFEST_NOT_READY' });
  });

  it('keeps a safe package with zero accepted entries explicit', async () => {
    const projectId = await createProject();
    const onlyUnsupported = zipBytes([
      { name: 'paper.pdf', bytes: textBytes('%PDF-1.7') },
      { name: 'sheet.xls', bytes: textBytes('legacy') },
    ]);
    const { batchId } = await createBatch(projectId, onlyUnsupported);
    await upload(projectId, batchId, onlyUnsupported);
    const detail = await waitForTerminal(projectId, batchId);
    expect(detail.batch.status).toBe('PARTIAL');
    expect(detail.manifest?.acceptedEntries).toBe(0);
    expect(detail.manifest?.totalEntries).toBe(2);
    const manifestId = detail.manifest?.manifestId;
    if (manifestId === undefined) throw new Error('manifest missing');
    const page = await service.getEntries(identity, projectId, batchId, manifestId, 50, undefined);
    expect(page.entries.every((entry) => entry.status === 'UNSUPPORTED')).toBe(true);
  });

  it('appends a supplementary batch without changing the first manifest', async () => {
    const projectId = await createProject();
    const firstBytes = zipBytes([{ name: 'first.md', bytes: markdownBytes('first') }]);
    const firstBatch = await createBatch(projectId, firstBytes);
    await upload(projectId, firstBatch.batchId, firstBytes);
    const firstDetail = await waitForTerminal(projectId, firstBatch.batchId);
    const firstManifest = firstDetail.manifest;
    if (firstManifest === undefined) throw new Error('manifest missing');

    const secondBytes = zipBytes([{ name: 'first.md', bytes: markdownBytes('second') }]);
    const secondBatch = await createBatch(projectId, secondBytes, '补充说明');
    const projectAfterSecond = await service.getProject(identity, projectId);
    expect(projectAfterSecond.lastBatchNo).toBe(2);
    expect(secondBatch.version).toBe(1);
    await upload(projectId, secondBatch.batchId, secondBytes);
    const secondDetail = await waitForTerminal(projectId, secondBatch.batchId);
    expect(secondDetail.batch.batchNo).toBe(2);
    expect(secondDetail.batch.kind).toBe('SUPPLEMENT');
    expect(secondDetail.manifest?.manifestId).not.toBe(firstManifest.manifestId);

    const reread = await service.getBatch(identity, projectId, firstBatch.batchId, 20, undefined);
    expect(reread.manifest).toEqual(firstManifest);
    const firstEntries = await service.getEntries(
      identity,
      projectId,
      firstBatch.batchId,
      firstManifest.manifestId,
      50,
      undefined,
    );
    expect(firstEntries.entries.map((entry) => entry.originalName)).toEqual(['first.md']);
  });

  it('keeps failed uploads recoverable through RETRY_UPLOAD and refuses stale authorization', async () => {
    const projectId = await createProject();
    const expected = zipBytes([{ name: 'retry.md', bytes: markdownBytes('retry') }]);
    const { batchId } = await createBatch(projectId, expected);
    await expect(
      upload(projectId, batchId, textBytes('wrong'), expected.length),
    ).rejects.toMatchObject({ code: 'INPUT_REJECTED' });
    const failed = await service.getBatch(identity, projectId, batchId, 20, undefined);
    expect(failed.batch.status).toBe('FAILED');
    expect(failed.permittedActions).toContain('RETRY_UPLOAD');
    const retry = await service.recover(identity, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: { expectedBatchVersion: failed.batch.version, action: 'RETRY_UPLOAD' },
    });
    expect(retry.data.batch.status).toBe('AWAITING_UPLOAD');
    await upload(projectId, batchId, expected);
    const detail = await waitForTerminal(projectId, batchId);
    expect(detail.batch.status).toBe('RECEIVED');
  });

  it('abandons an unstarted batch and preserves its history', async () => {
    const projectId = await createProject();
    const bytes = zipBytes([{ name: 'abandon.md', bytes: markdownBytes() }]);
    const { batchId } = await createBatch(projectId, bytes);
    const before = await service.getBatch(identity, projectId, batchId, 20, undefined);
    expect(before.permittedActions).toContain('ABANDON');
    const abandoned = await service.recover(identity, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: { expectedBatchVersion: before.batch.version, action: 'ABANDON' },
    });
    expect(abandoned.data.batch.status).toBe('ABANDONED');
    const detail = await service.getBatch(identity, projectId, batchId, 20, undefined);
    expect(detail.permittedActions).toEqual([]);
    const replay = await service.recover(identity, {
      requestId: abandoned.receipt.requestId,
      projectId,
      batchId,
      payload: { expectedBatchVersion: before.batch.version, action: 'ABANDON' },
    });
    expect(replay.replayed).toBe(true);
  });

  it('rejects cross-owner reads, cursor reuse and forged scope combinations', async () => {
    const projectId = await createProject('隔离客户');
    const other: SessionIdentity = {
      ownerId: fixture.owner2,
      displayName: '第二操作者',
      authEpoch: 1,
    };
    await expect(service.getProject(other, projectId)).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    const first = await service.listProjects(identity, 1, undefined);
    const cursor = first.nextCursor;
    expect(cursor).toBeDefined();
    await expect(service.listProjects(other, 1, cursor)).rejects.toMatchObject({
      code: 'CURSOR_INVALID',
    });
    await expect(
      service.readSource(other, projectId, newUuidV7(), newUuidV7()),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('reads the same facts and bytes after reopening the service and database', async () => {
    const projectId = await createProject('重启客户');
    const original = zipBytes([{ name: 'restart.docx', bytes: docxBytes() }]);
    const { batchId } = await createBatch(projectId, original);
    await upload(projectId, batchId, original);
    const detail = await waitForTerminal(projectId, batchId);
    const manifest = detail.manifest;
    if (manifest === undefined) throw new Error('manifest missing');
    await database.close();
    database = new MvpDatabase({ connectionString: fixture.databaseUrl });
    service = new MvpService({
      database,
      store: fixture.store,
      cursorKey: Buffer.alloc(32, 7),
      incarnation: 'vitest-restart',
    });
    await service.startup();
    await service.resumePendingExtractions();
    const reopened = await service.getBatch(identity, projectId, batchId, 20, undefined);
    expect(reopened.batch.status).toBe('RECEIVED');
    expect(reopened.manifest).toEqual(manifest);
    const source = await service.readSource(
      identity,
      projectId,
      batchId,
      manifest.originalZip.sourceId,
    );
    expect(source.bytes.equals(original)).toBe(true);
  });

  it('fails visibly when a stored original is corrupted instead of substituting bytes', async () => {
    const projectId = await createProject('损坏客户');
    const original = zipBytes([{ name: 'corrupt.md', bytes: markdownBytes() }]);
    const { batchId } = await createBatch(projectId, original);
    await upload(projectId, batchId, original);
    const detail = await waitForTerminal(projectId, batchId);
    const manifest = detail.manifest;
    if (manifest === undefined) throw new Error('manifest missing');
    const uploadAttempt = detail.attempts.find((attempt) => attempt.kind === 'UPLOAD');
    if (uploadAttempt === undefined) throw new Error('upload attempt missing');
    await corruptStoredFile(
      fixture.storeRoot,
      `original/${fixture.ownerId}/${projectId}/${batchId}/${uploadAttempt.attemptId}`,
    );
    await expect(
      service.readSource(identity, projectId, batchId, manifest.originalZip.sourceId),
    ).rejects.toMatchObject({ code: 'STORAGE_INTEGRITY_ERROR' });
    const reread = await service.getBatch(identity, projectId, batchId, 20, undefined);
    expect(reread.batch.status).toBe('RECEIVED');
  });

  it('keeps zero-byte accepted Markdown sources and downloads them', async () => {
    const projectId = await createProject('空文件客户');
    const empty = Buffer.alloc(0);
    const original = zipBytes([
      { name: 'empty.md', bytes: empty },
      { name: 'normal.md', bytes: markdownBytes('normal') },
    ]);
    const { batchId } = await createBatch(projectId, original);
    await upload(projectId, batchId, original);
    const detail = await waitForTerminal(projectId, batchId);
    expect(detail.batch.status).toBe('RECEIVED');
    expect(detail.manifest?.acceptedEntries).toBe(2);
    const manifestId = detail.manifest?.manifestId;
    if (manifestId === undefined) throw new Error('manifest missing');
    const page = await service.getEntries(identity, projectId, batchId, manifestId, 100, undefined);
    const emptyEntry = page.entries.find((entry) => entry.originalName === 'empty.md');
    expect(emptyEntry?.status).toBe('ACCEPTED');
    expect(emptyEntry?.sourceRef?.byteLength).toBe(0);
    if (emptyEntry?.sourceRef === undefined) throw new Error('empty source missing');
    const source = await service.readSource(
      identity,
      projectId,
      batchId,
      emptyEntry.sourceRef.sourceId,
    );
    expect(source.bytes.length).toBe(0);
    expect(source.sourceRef.sha256).toBe(sha256(empty));
  });

  it('does not expose a staged or rejected original without a sealed manifest', async () => {
    const projectId = await createProject('隔离客户');
    const original = zipBytes([{ name: 'readme.md', bytes: markdownBytes() }]);
    const { batchId } = await createBatch(projectId, original);
    const before = await service.getBatch(identity, projectId, batchId, 20, undefined);
    const attempt = before.batch.currentAttempt;
    if (attempt === undefined) throw new Error('attempt missing');
    await service.repository.claimUpload(
      identity.ownerId,
      identity.authEpoch,
      projectId,
      batchId,
      attempt.attemptId,
      attempt.generation,
    );
    const key = originalObjectKey(identity.ownerId, projectId, batchId, attempt.attemptId);
    const stored = await fixture.store.putImmutable(key, original, 'application/zip');
    const uploaded = await service.repository.completeUpload(
      identity.ownerId,
      identity.authEpoch,
      projectId,
      batchId,
      attempt.attemptId,
      attempt.generation,
      {
        objectKey: key,
        sha256: stored.sha256,
        byteLength: stored.byteLength,
        mediaType: 'application/zip',
      },
    );
    expect(uploaded.batch.status).toBe('STAGED');
    const staged = await service.repository.readBatchState(identity.ownerId, projectId, batchId);
    const stagedSource = staged.batch.originalZipSource;
    if (stagedSource === undefined) throw new Error('staged source missing');
    await expect(
      service.readSource(identity, projectId, batchId, stagedSource.sourceId),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await service.resumePendingExtractions();
    const accepted = await waitForTerminal(projectId, batchId);
    expect(accepted.manifest).toBeDefined();
    const acceptedSource = accepted.manifest?.originalZip;
    if (acceptedSource === undefined) throw new Error('accepted source missing');
    const bytes = await service.readSource(identity, projectId, batchId, acceptedSource.sourceId);
    expect(bytes.bytes.equals(original)).toBe(true);
  });

  it('rejects original reads after a safety rejection without a manifest', async () => {
    const projectId = await createProject('拒绝读取客户');
    const unsafe = zipBytes([{ name: '../escape.md', bytes: markdownBytes() }]);
    const { batchId } = await createBatch(projectId, unsafe);
    await upload(projectId, batchId, unsafe);
    const detail = await waitForTerminal(projectId, batchId);
    expect(detail.batch.status).toBe('REJECTED');
    expect(detail.manifest).toBeUndefined();
    const state = await service.repository.readBatchState(identity.ownerId, projectId, batchId);
    const rejectedSource = state.batch.originalZipSource;
    if (rejectedSource === undefined) throw new Error('quarantined source missing');
    await expect(
      service.readSource(identity, projectId, batchId, rejectedSource.sourceId),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('converges a terminated incomplete upload to an explicit retry', async () => {
    const projectId = await createProject('中断客户');
    const bytes = zipBytes([{ name: 'retry.md', bytes: markdownBytes() }]);
    const { batchId } = await createBatch(projectId, bytes);
    const before = await service.getBatch(identity, projectId, batchId, 20, undefined);
    const attempt = before.batch.currentAttempt;
    if (attempt === undefined) throw new Error('attempt missing');
    await service.repository.claimUpload(
      identity.ownerId,
      identity.authEpoch,
      projectId,
      batchId,
      attempt.attemptId,
      attempt.generation,
    );
    const claimed = await service.getBatch(identity, projectId, batchId, 20, undefined);
    expect(claimed.batch.status).toBe('RECEIVING');
    const reconciled = await service.recover(identity, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: { expectedBatchVersion: claimed.batch.version, action: 'RECONCILE' },
    });
    expect(reconciled.data.batch.status).toBe('FAILED');
    const after = await service.getBatch(identity, projectId, batchId, 20, undefined);
    expect(after.permittedActions).toContain('RETRY_UPLOAD');
    expect(after.permittedActions).not.toContain('RECONCILE');
    const retry = await service.recover(identity, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: { expectedBatchVersion: after.batch.version, action: 'RETRY_UPLOAD' },
    });
    expect(retry.data.batch.status).toBe('AWAITING_UPLOAD');
    await upload(projectId, batchId, bytes);
    const completed = await waitForTerminal(projectId, batchId);
    expect(completed.batch.status).toBe('RECEIVED');
  });

  it('recovers a durable original before the first EXTRACT arrangement commits', async () => {
    const projectId = await createProject('提取前客户');
    const original = zipBytes([{ name: 'gap.md', bytes: markdownBytes() }]);
    const { batchId } = await createBatch(projectId, original);
    const before = await service.getBatch(identity, projectId, batchId, 20, undefined);
    const attempt = before.batch.currentAttempt;
    if (attempt === undefined) throw new Error('attempt missing');
    await service.repository.claimUpload(
      identity.ownerId,
      identity.authEpoch,
      projectId,
      batchId,
      attempt.attemptId,
      attempt.generation,
    );
    const key = originalObjectKey(identity.ownerId, projectId, batchId, attempt.attemptId);
    await fixture.store.putImmutable(key, original, 'application/zip');
    const current = await service.getBatch(identity, projectId, batchId, 20, undefined);
    const reconciled = await service.recover(identity, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: { expectedBatchVersion: current.batch.version, action: 'RECONCILE' },
    });
    expect(reconciled.data.batch.status).toBe('STAGED');
    expect(reconciled.data.batch.manifestId).toBeUndefined();
    const staged = await service.getBatch(identity, projectId, batchId, 20, undefined);
    expect(staged.permittedActions).toContain('CONTINUE_EXTRACTION');
    await service.recover(identity, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: { expectedBatchVersion: staged.batch.version, action: 'CONTINUE_EXTRACTION' },
    });
    const completed = await waitForTerminal(projectId, batchId);
    expect(completed.batch.status).toBe('RECEIVED');
  });

  it('rolls back entry acceptance when an entry row write fails and preserves prior custody', async () => {
    const priorProject = await createProject('既有托管客户');
    const priorBytes = zipBytes([{ name: 'prior.md', bytes: markdownBytes('# 既有资料') }]);
    const { batchId: priorBatchId } = await createBatch(priorProject, priorBytes);
    await upload(priorProject, priorBatchId, priorBytes);
    const prior = await waitForTerminal(priorProject, priorBatchId);
    const priorManifestId = prior.manifest?.manifestId;
    const priorSource = prior.manifest?.originalZip;
    if (priorManifestId === undefined || priorSource === undefined)
      throw new Error('prior manifest missing');

    const projectId = await createProject('条目写失败客户');
    const bytes = zipBytes([
      { name: 'first.md', bytes: markdownBytes('# 第一项') },
      { name: 'second.md', bytes: markdownBytes('# 第二项') },
    ]);
    const { batchId } = await createBatch(projectId, bytes);
    await withMvpAdmin(async (client) => {
      await client.query(
        'DROP TRIGGER IF EXISTS mvp_test_fail_entry ON document_delivery.source_entries',
      );
      await client.query('DROP FUNCTION IF EXISTS document_delivery.mvp_test_fail_entry()');
      await client.query(
        `CREATE FUNCTION document_delivery.mvp_test_fail_entry() RETURNS trigger
         LANGUAGE plpgsql SET search_path = pg_catalog AS $$
         BEGIN
           RAISE EXCEPTION 'injected entry insert failure';
         END
         $$`,
      );
      await client.query(
        `CREATE TRIGGER mvp_test_fail_entry BEFORE INSERT ON document_delivery.source_entries
         FOR EACH ROW WHEN (NEW.batch_id = '${batchId}'::uuid)
         EXECUTE FUNCTION document_delivery.mvp_test_fail_entry()`,
      );
    });

    let failed: Awaited<ReturnType<typeof waitForTerminal>>;
    try {
      await upload(projectId, batchId, bytes);
      failed = await waitForTerminal(projectId, batchId);
      expect(failed.batch.status).toBe('FAILED');
      expect(failed.manifest).toBeUndefined();
      expect(await manifestCount(batchId)).toBe(0);
      const state = await service.repository.readBatchState(identity.ownerId, projectId, batchId);
      const extract = state.attempts.find((attempt) => attempt.kind === 'EXTRACT');
      if (extract === undefined) throw new Error('extract attempt missing');
      const staged = await fixture.store.inspect(
        entryObjectKey(identity.ownerId, projectId, batchId, extract.attemptId, 0),
      );
      expect(staged).not.toBeNull();
      await expect(
        service.readSource(identity, projectId, batchId, newUuidV7()),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
      const priorAfterFailure = await service.getBatch(
        identity,
        priorProject,
        priorBatchId,
        20,
        undefined,
      );
      expect(priorAfterFailure.manifest?.manifestId).toBe(priorManifestId);
      const priorBytesAfterFailure = await service.readSource(
        identity,
        priorProject,
        priorBatchId,
        priorSource.sourceId,
      );
      expect(priorBytesAfterFailure.bytes.equals(priorBytes)).toBe(true);
    } finally {
      await withMvpAdmin(async (client) => {
        await client.query(
          'DROP TRIGGER IF EXISTS mvp_test_fail_entry ON document_delivery.source_entries',
        );
        await client.query('DROP FUNCTION IF EXISTS document_delivery.mvp_test_fail_entry()');
      });
    }

    await service.recover(identity, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: { expectedBatchVersion: failed.batch.version, action: 'CONTINUE_EXTRACTION' },
    });
    const accepted = await waitForTerminal(projectId, batchId);
    expect(accepted.batch.status).toBe('RECEIVED');
    expect(await manifestCount(batchId)).toBe(1);
    const acceptedSource = accepted.manifest?.originalZip;
    if (acceptedSource === undefined) throw new Error('accepted source missing');
    const acceptedBytes = await service.readSource(
      identity,
      projectId,
      batchId,
      acceptedSource.sourceId,
    );
    expect(acceptedBytes.bytes.equals(bytes)).toBe(true);
  });

  it('reconciles a committed manifest after its success response is lost without duplicate acceptance', async () => {
    const priorProject = await createProject('提交丢失前客户');
    const priorBytes = zipBytes([{ name: 'stable.md', bytes: markdownBytes('# 稳定资料') }]);
    const { batchId: priorBatchId } = await createBatch(priorProject, priorBytes);
    await upload(priorProject, priorBatchId, priorBytes);
    const prior = await waitForTerminal(priorProject, priorBatchId);
    const priorManifestId = prior.manifest?.manifestId;
    const priorSource = prior.manifest?.originalZip;
    if (priorManifestId === undefined || priorSource === undefined)
      throw new Error('prior manifest missing');

    const projectId = await createProject('清单提交丢失客户');
    const bytes = zipBytes([{ name: 'committed.md', bytes: markdownBytes('# 已提交资料') }]);
    const { batchId } = await createBatch(projectId, bytes);
    const originalAccept = service.repository.acceptManifest.bind(service.repository);
    let injected = false;
    service.repository.acceptManifest = async (...args) => {
      const result = await originalAccept(...args);
      if (!injected) {
        injected = true;
        throw new MvpError('DEPENDENCY_UNAVAILABLE');
      }
      return result;
    };
    try {
      await upload(projectId, batchId, bytes);
      await service.whenIdle();
    } finally {
      service.repository.acceptManifest = originalAccept;
    }

    const committed = await service.getBatch(identity, projectId, batchId, 20, undefined);
    expect(committed.batch.status).toBe('RECEIVED');
    const manifestId = committed.manifest?.manifestId;
    if (manifestId === undefined) throw new Error('committed manifest missing');
    expect(await manifestCount(batchId)).toBe(1);

    await restartService('vitest-manifest-response-loss');
    const reread = await service.getBatch(identity, projectId, batchId, 20, undefined);
    expect(reread.manifest?.manifestId).toBe(manifestId);
    expect(await manifestCount(batchId)).toBe(1);
    const source = reread.manifest?.originalZip;
    if (source === undefined) throw new Error('committed source missing');
    const sourceBytes = await service.readSource(identity, projectId, batchId, source.sourceId);
    expect(sourceBytes.bytes.equals(bytes)).toBe(true);
    await service.resumePendingExtractions();
    expect(await manifestCount(batchId)).toBe(1);

    const priorAfter = await service.getBatch(identity, priorProject, priorBatchId, 20, undefined);
    expect(priorAfter.manifest?.manifestId).toBe(priorManifestId);
    const priorBytesAfter = await service.readSource(
      identity,
      priorProject,
      priorBatchId,
      priorSource.sourceId,
    );
    expect(priorBytesAfter.bytes.equals(priorBytes)).toBe(true);
  });

  it('does not resume a prepared extraction under a changed authorization epoch', async () => {
    const projectId = await createProject('重启授权客户');
    const original = zipBytes([{ name: 'restart-auth.md', bytes: markdownBytes() }]);
    const { batchId } = await createBatch(projectId, original);
    const before = await service.getBatch(identity, projectId, batchId, 20, undefined);
    const attempt = before.batch.currentAttempt;
    if (attempt === undefined) throw new Error('attempt missing');
    await service.repository.claimUpload(
      identity.ownerId,
      identity.authEpoch,
      projectId,
      batchId,
      attempt.attemptId,
      attempt.generation,
    );
    const key = originalObjectKey(identity.ownerId, projectId, batchId, attempt.attemptId);
    const stored = await fixture.store.putImmutable(key, original, 'application/zip');
    await service.repository.completeUpload(
      identity.ownerId,
      identity.authEpoch,
      projectId,
      batchId,
      attempt.attemptId,
      attempt.generation,
      {
        objectKey: key,
        sha256: stored.sha256,
        byteLength: stored.byteLength,
        mediaType: 'application/zip',
      },
    );
    const adminConnection = new URL(fixture.adminUrl);
    adminConnection.pathname = '/zhiju_mvp_test';
    const owner = new Client({ connectionString: adminConnection.toString() });
    await owner.connect();
    try {
      await owner.query('SET ROLE mvp_ddl');
      await owner.query(
        'UPDATE document_delivery.operator_binding SET auth_epoch = auth_epoch + 1 WHERE owner_id = $1',
        [fixture.ownerId],
      );
    } finally {
      await owner.end();
    }
    await database.close();
    database = new MvpDatabase({ connectionString: fixture.databaseUrl });
    service = new MvpService({
      database,
      store: fixture.store,
      cursorKey: Buffer.alloc(32, 7),
      incarnation: 'vitest-restart-auth',
    });
    await service.startup();
    await service.resumePendingExtractions();
    const fresh: SessionIdentity = {
      ownerId: fixture.ownerId,
      displayName: 'MVP 操作者',
      authEpoch: 2,
    };
    const stopped = await service.getBatch(fresh, projectId, batchId, 20, undefined);
    expect(stopped.batch.status).toBe('FAILED');
    expect(stopped.manifest).toBeUndefined();
    const failedExtract = stopped.attempts.find((item) => item.kind === 'EXTRACT');
    expect(failedExtract?.status).toBe('FAILED');
    expect(failedExtract?.reasonCodes).toContain('AUTHORIZATION_CHANGED');
    await service.recover(fresh, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: { expectedBatchVersion: stopped.batch.version, action: 'CONTINUE_EXTRACTION' },
    });
    const completed = await waitForTerminal(projectId, batchId, fresh);
    expect(completed.batch.status).toBe('RECEIVED');
    const extractAttempts = completed.attempts.filter((item) => item.kind === 'EXTRACT');
    expect(extractAttempts).toHaveLength(2);
  });

  it('serializes a concurrent upload claim and rejects a late old generation', async () => {
    const fresh: SessionIdentity = {
      ownerId: fixture.ownerId,
      displayName: 'MVP 操作者',
      authEpoch: 2,
    };
    const projectId = await createProject('并发布次客户', fresh);
    const bytes = zipBytes([{ name: 'race.md', bytes: markdownBytes() }]);
    const { batchId } = await createBatch(projectId, bytes, undefined, fresh);
    const before = await service.getBatch(fresh, projectId, batchId, 20, undefined);
    const firstAttempt = before.batch.currentAttempt;
    if (firstAttempt === undefined) throw new Error('attempt missing');
    const claims = await Promise.allSettled([
      service.repository.claimUpload(
        fresh.ownerId,
        fresh.authEpoch,
        projectId,
        batchId,
        firstAttempt.attemptId,
        firstAttempt.generation,
      ),
      service.repository.claimUpload(
        fresh.ownerId,
        fresh.authEpoch,
        projectId,
        batchId,
        firstAttempt.attemptId,
        firstAttempt.generation,
      ),
    ]);
    expect(
      claims.map((result) =>
        result.status === 'fulfilled' ? 'ok' : (errorCodeOf(result.reason) ?? 'unknown'),
      ),
    ).toEqual(expect.arrayContaining(['ok', 'UPLOAD_BUSY']));
    await service.repository.failUpload(fresh.ownerId, projectId, batchId, firstAttempt.attemptId, [
      'UPLOAD_INCOMPLETE',
    ]);
    const failed = await service.getBatch(fresh, projectId, batchId, 20, undefined);
    await service.recover(fresh, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: { expectedBatchVersion: failed.batch.version, action: 'RETRY_UPLOAD' },
    });
    const retried = await service.getBatch(fresh, projectId, batchId, 20, undefined);
    const current = retried.batch.currentAttempt;
    if (current === undefined) throw new Error('retry attempt missing');
    await expect(
      service.repository.completeUpload(
        fresh.ownerId,
        fresh.authEpoch,
        projectId,
        batchId,
        firstAttempt.attemptId,
        firstAttempt.generation,
        {
          objectKey: originalObjectKey(fresh.ownerId, projectId, batchId, firstAttempt.attemptId),
          sha256: sha256(bytes),
          byteLength: bytes.length,
          mediaType: 'application/zip',
        },
      ),
    ).rejects.toMatchObject({ code: 'RECOVERY_NOT_ALLOWED' });
    expect(retried.batch.currentAttempt?.attemptId).toBe(current.attemptId);
  });

  it('reconciles a durable first-upload gap across an epoch change and continues at the current epoch', async () => {
    const epoch = await currentEpoch();
    const current: SessionIdentity = { ...identity, authEpoch: epoch };
    const projectId = await createProject('跨代恢复客户', current);
    const original = zipBytes([{ name: 'cross-epoch.md', bytes: markdownBytes() }]);
    const { batchId } = await createBatch(projectId, original, undefined, current);
    const before = await service.getBatch(current, projectId, batchId, 20, undefined);
    const attempt = before.batch.currentAttempt;
    if (attempt === undefined) throw new Error('attempt missing');
    await service.repository.claimUpload(
      current.ownerId,
      current.authEpoch,
      projectId,
      batchId,
      attempt.attemptId,
      attempt.generation,
    );
    await fixture.store.putImmutable(
      originalObjectKey(current.ownerId, projectId, batchId, attempt.attemptId),
      original,
      'application/zip',
    );
    const next = await advanceEpoch();
    expect(await currentEpoch()).toBe(next);
    await restartService('vitest-reconcile-epoch');
    const fresh: SessionIdentity = { ...identity, authEpoch: next };
    const reopened = await service.getBatch(fresh, projectId, batchId, 20, undefined);
    expect(reopened.batch.status).toBe('RECEIVING');
    const reconciled = await service.recover(fresh, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: { expectedBatchVersion: reopened.batch.version, action: 'RECONCILE' },
    });
    expect(reconciled.data.batch.status).toBe('STAGED');
    const staged = await service.getBatch(fresh, projectId, batchId, 20, undefined);
    expect(staged.batch.manifestId).toBeUndefined();
    expect(staged.permittedActions).toContain('CONTINUE_EXTRACTION');
    await service.recover(fresh, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: { expectedBatchVersion: staged.batch.version, action: 'CONTINUE_EXTRACTION' },
    });
    const completed = await waitForTerminal(projectId, batchId, fresh);
    expect(completed.batch.status).toBe('RECEIVED');
  });

  it('refuses to advance execution under a changed authorization epoch', async () => {
    const epoch = await currentEpoch();
    const current: SessionIdentity = { ...identity, authEpoch: epoch };
    const projectId = await createProject('授权客户', current);
    const bytes = zipBytes([{ name: 'epoch.md', bytes: markdownBytes() }]);
    const { batchId } = await createBatch(projectId, bytes, undefined, current);
    const next = await advanceEpoch();
    expect(await currentEpoch()).toBe(next);
    await expect(upload(projectId, batchId, bytes, bytes.length, current)).rejects.toMatchObject({
      code: 'RECOVERY_NOT_ALLOWED',
    });
    const fresh: SessionIdentity = {
      ownerId: fixture.ownerId,
      displayName: 'MVP 操作者',
      authEpoch: next,
    };
    const detail = await service.getBatch(fresh, projectId, batchId, 20, undefined);
    const attempt = detail.batch.currentAttempt;
    if (attempt === undefined) throw new Error('attempt missing');
    await expect(
      service.upload(fresh, {
        projectId,
        batchId,
        attemptId: attempt.attemptId,
        generation: attempt.generation,
        contentLength: bytes.length,
        chunks: singleChunk(bytes),
      }),
    ).rejects.toMatchObject({ code: 'RECOVERY_NOT_ALLOWED' });
    const after = await service.getBatch(fresh, projectId, batchId, 20, undefined);
    expect(after.batch.status).not.toBe('RECEIVED');
    expect(after.manifest).toBeUndefined();
    const retry = await service.recover(fresh, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: { expectedBatchVersion: after.batch.version, action: 'RETRY_UPLOAD' },
    });
    expect(retry.data.batch.status).toBe('AWAITING_UPLOAD');
    await upload(projectId, batchId, bytes, bytes.length, fresh);
    const accepted = await waitForTerminal(projectId, batchId, fresh);
    expect(accepted.batch.status).toBe('RECEIVED');
  });
});
