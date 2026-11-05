import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  MvpDatabase,
  MvpService,
  ReadCheckRepository,
  type SessionIdentity,
} from '../../modules/document-delivery/src/index.js';
import { SourcePreviewReader } from '../../modules/document-delivery/src/preview/reader.js';
import { ReadCheckRunner } from '../../modules/document-delivery/src/read-check/runner.js';
import {
  readCheckResult,
  READ_CHECK_PROFILE,
} from '../../modules/document-delivery/src/read-check/profile.js';
import {
  applyMvpMigration,
  appleDoubleBytes,
  createMvpDatabase,
  docxBytes,
  provisionMvp,
  sha256,
  singleChunk,
  xlsxBytes,
  zipBytes,
  type MvpFixture,
} from './mvp-fixtures.js';

const adminUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
describe.skipIf(adminUrl === undefined)('MVP batch read checks (isolated PostgreSQL)', () => {
  let admin: Client | undefined, database: MvpDatabase, fixture: MvpFixture, service: MvpService;
  let identity: SessionIdentity, repository: ReadCheckRepository, reader: SourcePreviewReader;
  beforeAll(async () => {
    if (adminUrl === undefined) throw new Error('persistence gate required');
    admin = await createMvpDatabase(adminUrl);
    await applyMvpMigration(adminUrl);
    fixture = await provisionMvp(adminUrl, { owner2: true });
    identity = { ownerId: fixture.ownerId, authEpoch: 1, displayName: 'Synthetic operator' };
    database = new MvpDatabase({ connectionString: fixture.databaseUrl });
    const preview = {
      runnerRoot: resolve('tests/fixtures/document-preview'),
      python: execFileSync('python3', ['-I', '-S', '-c', 'import sys; print(sys.executable)'], {
        encoding: 'utf8',
      }).trim(),
    };
    service = new MvpService({
      database,
      store: fixture.store,
      cursorKey: Buffer.alloc(32, 7),
      incarnation: 'read-tests',
      preview,
    });
    await service.startup();
    repository = new ReadCheckRepository(database, Buffer.alloc(32, 7), 'read-tests');
    reader = new SourcePreviewReader({
      ...preview,
      temporaryRoot: join(fixture.store.root, `preview-${fixture.instanceId}`),
    });
    await reader.initialize();
  }, 180_000);
  afterAll(async () => {
    await Promise.allSettled(
      [
        async () => {
          await service.stopReadChecks();
        },
        async () => {
          await reader.close();
        },
      ].map((cleanup) => cleanup()),
    );
    await (async () => {
      await database.close();
    })().catch(() => undefined);
    await admin?.end();
  });

  async function sealed(
    entries = [
      { name: 'readme.md', bytes: Buffer.from('# Synthetic private text\r\nSource paragraph') },
      { name: 'procedure.docx', bytes: docxBytes() },
      { name: 'table.xlsx', bytes: xlsxBytes() },
      { name: '__MACOSX/._readme.md', bytes: appleDoubleBytes() },
      { name: 'unknown.bin', bytes: Buffer.from([1, 2, 3]) },
    ],
  ) {
    const projectId = newUuidV7(),
      batchId = newUuidV7(),
      bytes = zipBytes(entries);
    await service.createProject(identity, {
      projectId,
      requestId: newUuidV7(),
      payload: { customerName: 'Synthetic', title: 'Read checks' },
    });
    const created = await service.createBatch(identity, {
      projectId,
      batchId,
      requestId: newUuidV7(),
      payload: {
        expectedProjectVersion: 1,
        originalName: 'synthetic.zip',
        declaredBytes: bytes.length,
        zipSha256: sha256(bytes),
      },
    });
    const attempt = created.data.batch.currentAttempt;
    if (attempt === undefined) throw new Error('missing attempt');
    await service.upload(identity, {
      projectId,
      batchId,
      attemptId: attempt.attemptId,
      generation: attempt.generation,
      contentLength: bytes.length,
      chunks: singleChunk(bytes),
    });
    await service.whenIdle();
    const detail = await service.getBatch(identity, projectId, batchId, 20, undefined);
    if (detail.manifest === undefined) throw new Error('missing manifest');
    return { projectId, batchId, manifestId: detail.manifest.manifestId };
  }
  const runner = () =>
    new ReadCheckRunner(
      repository,
      reader,
      fixture.store.identity.storeIdentity,
      (actor, scope, sourceId, manifestId, signal) =>
        service.getSourcePreview(
          { ...actor, displayName: '' },
          scope.projectId,
          scope.batchId,
          sourceId,
          manifestId,
          signal,
        ),
    );
  async function queued() {
    const input = await sealed();
    const outcome = await repository.create(
      identity,
      input.projectId,
      input.batchId,
      input.manifestId,
      newUuidV7(),
    );
    return { ...input, checkId: outcome.data.check.checkId };
  }

  it('persists exact mixed-manifest metadata through the real reader and idempotent service entry', async () => {
    const input = await sealed(),
      requestId = newUuidV7();
    const command = {
      projectId: input.projectId,
      batchId: input.batchId,
      requestId,
      payload: { manifestId: input.manifestId },
    };
    const [first, replay] = await Promise.all([
      service.createReadCheck(identity, command),
      service.createReadCheck(identity, command),
    ]);
    expect(first.data.check.checkId).toBe(replay.data.check.checkId);
    expect([first.replayed, replay.replayed].sort()).toEqual([false, true]);
    await service.whenIdle();
    await expect(
      service.createReadCheck(identity, { ...command, payload: { manifestId: newUuidV7() } }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const scope = { ...input, checkId: first.data.check.checkId };
    const report = await service.listReadCheckEntries(identity, scope);
    expect(report.check.status).toBe('COMPLETED');
    expect(report.check.counts).toEqual({
      available: 1,
      limited: 1,
      unsupported: 1,
      failed: 0,
      notEligible: 2,
      pending: 0,
    });
    expect(new Set(report.entries.map((row) => row.entry.entryId)).size).toBe(5);
    expect(report.entries.every((row) => row.result?.profileId === READ_CHECK_PROFILE)).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Synthetic private text');
    expect(
      report.entries.find((row) => row.result?.status === 'LIMITED')?.result?.limitations,
    ).toContain('EXTRACTED_VIEW_ONLY');
    const problems = await service.listReadCheckEntries(identity, scope, { filter: 'PROBLEMS' });
    expect(problems.total).toBe(3);
    const next = await service.createReadCheck(identity, { ...command, requestId: newUuidV7() });
    expect(next.data.check.checkId).not.toBe(scope.checkId);
    await service.whenIdle();
    expect((await service.getReadCheck(identity, scope)).resultVersion).toBe(
      report.check.resultVersion,
    );
    expect(
      (await service.listReadChecks(identity, input.projectId, input.batchId)).items,
    ).toHaveLength(2);
  }, 60_000);

  it('binds concurrent requests, immutable results and mutable-filter cursors to one exact check version', async () => {
    const scope = await queued();
    await expect(
      repository.create(identity, scope.projectId, scope.batchId, scope.manifestId, newUuidV7()),
    ).rejects.toMatchObject({ code: 'READ_CHECK_ACTIVE', details: { checkId: scope.checkId } });
    await expect(
      repository.create(identity, scope.projectId, scope.batchId, newUuidV7(), newUuidV7()),
    ).rejects.toMatchObject({ code: 'READ_CHECK_NOT_READY' });
    const lease = await repository.claim(identity, scope);
    if (lease === undefined) throw new Error('missing lease');
    const page = await repository.entries(identity, scope, 'PENDING', 2);
    expect(page.nextCursor).toBeDefined();
    await expect(
      repository.entries(identity, scope, 'ALL', 2, page.nextCursor, page.check.resultVersion),
    ).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    await expect(
      repository.entries(identity, scope, 'PENDING', 3, page.nextCursor, page.check.resultVersion),
    ).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    const entry = await repository.next(lease);
    if (entry?.sourceRef === undefined) throw new Error('missing source');
    const preview = await service.getSourcePreview(
      identity,
      scope.projectId,
      scope.batchId,
      entry.sourceRef.sourceId,
      scope.manifestId,
    );
    const result = readCheckResult(entry, preview, new Date().toISOString());
    await expect(
      repository.commit(lease, { ...result, resultHash: null as unknown as string }),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      repository.commit(lease, { ...result, checkedAt: null as unknown as string }),
    ).rejects.toMatchObject({ code: '55000' });
    expect((await repository.get(identity, scope)).counts.pending).toBe(5);
    await repository.commit(lease, result);
    await repository.commit(lease, result);
    expect(await repository.confirmed(lease, result)).toBe(true);
    await expect(
      repository.commit(lease, { ...result, checkedAt: '2026-01-01T00:00:00.000Z' }),
    ).rejects.toMatchObject({ code: 'OUTCOME_UNKNOWN' });
    await expect(
      repository.entries(identity, scope, 'PENDING', 2, page.nextCursor, page.check.resultVersion),
    ).rejects.toMatchObject({ code: 'READ_CHECK_RESULTS_CHANGED' });
    const current = await repository.entries(identity, scope, 'PENDING', 2);
    expect(current.total).toBe(4);
    expect(current.check.counts.pending).toBe(4);
    expect(current.check.resultVersion).toBe(page.check.resultVersion + 1);
    await expect(
      repository.get({ ...identity, ownerId: fixture.owner2 }, scope),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(
      repository.get(identity, { ...scope, batchId: newUuidV7() }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(() => repository.commit(lease, { ...result, limitations: ['x'.repeat(17000)] })).toThrow(
      'INPUT_LIMIT_EXCEEDED',
    );
    await repository.reconcile(identity, scope);
    await expect(repository.commit(lease, result)).rejects.toMatchObject({
      code: 'RECOVERY_NOT_ALLOWED',
    });
    const empty = await database.transaction(fixture.owner2, scope.projectId, (client) =>
      client.query('SELECT * FROM document_delivery.read_check_results'),
    );
    expect(empty.rowCount).toBe(0);
  }, 60_000);

  it('keeps UNKNOWN occupied until inherited reader ownership ends and reconciles it on a later startup', async () => {
    const scope = await queued(),
      lease = await repository.claim(identity, scope);
    if (lease === undefined) throw new Error('missing lease');
    const held = await reader.acquireIdleLock();
    if (held === null) throw new Error('missing lock');
    const first = runner();
    try {
      await first.startup();
      await first.whenIdle();
      expect((await repository.get(identity, scope)).status).toBe('UNKNOWN');
      await expect(
        repository.create(identity, scope.projectId, scope.batchId, scope.manifestId, newUuidV7()),
      ).rejects.toMatchObject({ code: 'READ_CHECK_ACTIVE' });
    } finally {
      await first.close();
      await held.release();
    }
    const second = runner();
    await second.startup();
    await second.whenIdle();
    await second.close();
    expect((await repository.get(identity, scope)).status).toBe('INTERRUPTED');
    expect((await repository.entries(identity, scope, 'ALL', 20)).check.counts.pending).toBe(5);
    await expect(repository.next(lease)).rejects.toMatchObject({ code: 'RECOVERY_NOT_ALLOWED' });
    const replacement = await repository.create(
      identity,
      scope.projectId,
      scope.batchId,
      scope.manifestId,
      newUuidV7(),
    );
    await repository.finish(
      identity,
      { ...scope, checkId: replacement.data.check.checkId },
      'FAILED',
      'CHECK_INTERRUPTED',
    );
  }, 60_000);

  it('reads back a committed result after response loss and never stores a BUSY outcome', async () => {
    const scope = await queued();
    const original = repository.commit.bind(repository);
    const spy = vi.spyOn(repository, 'commit').mockImplementationOnce(async (lease, result) => {
      await original(lease, result);
      throw new Error('synthetic lost commit response');
    });
    const held = await reader.acquireIdleLock();
    if (held === null) throw new Error('missing lock');
    const worker = runner();
    try {
      worker.kick();
      await vi.waitFor(async () => {
        expect((await repository.get(identity, scope)).status).toBe('RUNNING');
      });
      expect((await repository.get(identity, scope)).counts.pending).toBe(5);
      await held.release();
      await worker.whenIdle();
      const report = await repository.entries(identity, scope, 'ALL', 20);
      expect(report.check.status).toBe('COMPLETED');
      expect(report.entries.some((row) => row.result?.limitations.includes('BUSY'))).toBe(false);
      expect(spy).toHaveBeenCalledTimes(5);
    } finally {
      spy.mockRestore();
      await held.release();
      await worker.close();
    }
  }, 60_000);

  it('stops revoked original authorization and preserves completed results under a new login epoch', async () => {
    const scope = await queued(),
      lease = await repository.claim(identity, scope);
    if (lease === undefined) throw new Error('missing lease');
    const url = new URL(fixture.adminUrl);
    url.pathname = '/zhiju_mvp_test';
    const connection = new Client({ connectionString: url.toString() });
    await connection.connect();
    try {
      await connection.query(
        'UPDATE document_delivery.operator_binding SET auth_epoch=auth_epoch+1 WHERE owner_id=$1',
        [identity.ownerId],
      );
      await expect(repository.next(lease)).rejects.toMatchObject({
        code: 'INSTANCE_ACCESS_DENIED',
      });
      await expect(repository.get(identity, scope)).rejects.toMatchObject({
        code: 'INSTANCE_ACCESS_DENIED',
      });
      await repository.finish(identity, scope, 'FAILED', 'AUTHORIZATION_CHANGED', lease);
      identity = { ...identity, authEpoch: identity.authEpoch + 1 };
      expect((await repository.get(identity, scope)).reasonCodes).toEqual([
        'AUTHORIZATION_CHANGED',
      ]);
      expect((await repository.get(identity, scope)).counts.pending).toBe(5);
    } finally {
      await connection.end();
    }
  }, 60_000);

  it('explains zero accepted entries and stops task-wide dependency and time failures without fabricating file results', async () => {
    const input = await sealed([{ name: 'unknown.bin', bytes: Buffer.from([1, 2, 3]) }]);
    const created = await service.createReadCheck(identity, {
      ...input,
      requestId: newUuidV7(),
      payload: { manifestId: input.manifestId },
    });
    await service.whenIdle();
    expect(
      (await repository.get(identity, { ...input, checkId: created.data.check.checkId })).counts,
    ).toMatchObject({ notEligible: 1, available: 0, pending: 0 });
    const scope = await queued();
    const missing = new ReadCheckRunner(
      repository,
      reader,
      fixture.store.identity.storeIdentity,
      () => Promise.reject(new Error('synthetic dependency failure')),
    );
    missing.kick();
    await missing.whenIdle();
    await missing.close();
    expect(await repository.get(identity, scope)).toMatchObject({
      status: 'FAILED',
      reasonCodes: ['DEPENDENCY_UNAVAILABLE'],
      counts: { pending: 5 },
    });
    const timed = await queued();
    const timeout = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementationOnce(() => AbortSignal.abort(new DOMException('timeout', 'TimeoutError')));
    const worker = runner();
    try {
      worker.kick();
      await worker.whenIdle();
    } finally {
      timeout.mockRestore();
      await worker.close();
    }
    expect(await repository.get(identity, timed)).toMatchObject({
      status: 'FAILED',
      reasonCodes: ['CHECK_TIME_LIMIT'],
      counts: { pending: 5 },
    });
  }, 60_000);

  it('cancels database waits and rolls back results at the task deadline without late completion', async () => {
    const url = new URL(adminUrl ?? '');
    url.pathname = '/zhiju_mvp_test';
    const blocker = new Client({ connectionString: url.toString() });
    await blocker.connect();
    try {
      for (const phase of ['claim', 'next', 'commit'] as const) {
        const input = await sealed([{ name: 'unknown.bin', bytes: Buffer.from([1, 2, 3]) }]);
        const created = await repository.create(
          identity,
          input.projectId,
          input.batchId,
          input.manifestId,
          newUuidV7(),
        );
        const scope = { ...input, checkId: created.data.check.checkId };
        const deadline = new AbortController();
        const hold = async <T>(operation: () => Promise<T>): Promise<T> => {
          await blocker.query('BEGIN');
          await blocker.query(
            'SELECT check_id FROM document_delivery.read_checks WHERE check_id=$1 FOR UPDATE',
            [scope.checkId],
          );
          const pending = operation();
          void pending.catch(() => undefined);
          try {
            await expect
              .poll(
                async () => {
                  await blocker.query('SELECT pg_stat_clear_snapshot()');
                  const waiting = await blocker.query(
                    "SELECT count(*) AS amount FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%document_delivery.read_checks%'",
                  );
                  return Number(waiting.rows[0]?.amount);
                },
                { timeout: 5000 },
              )
              .toBeGreaterThan(0);
            deadline.abort(new DOMException('deadline', 'TimeoutError'));
            await expect(pending).rejects.toThrow();
          } finally {
            deadline.abort(new DOMException('deadline', 'TimeoutError'));
            await blocker.query('ROLLBACK');
          }
          return pending;
        };
        const claim = repository.claim.bind(repository),
          next = repository.next.bind(repository),
          commit = repository.commit.bind(repository);
        const intercepted =
          phase === 'claim'
            ? vi
                .spyOn(repository, 'claim')
                .mockImplementationOnce((...args) => hold(() => claim(...args)))
            : phase === 'next'
              ? vi
                  .spyOn(repository, 'next')
                  .mockImplementationOnce((...args) => hold(() => next(...args)))
              : vi
                  .spyOn(repository, 'commit')
                  .mockImplementationOnce((...args) => hold(() => commit(...args)));
        const timeout = vi
          .spyOn(AbortSignal, 'timeout')
          .mockImplementationOnce(() => deadline.signal);
        const worker = runner();
        try {
          worker.kick();
          await worker.whenIdle();
          expect(await repository.get(identity, scope), phase).toMatchObject({
            status: 'FAILED',
            reasonCodes: ['CHECK_TIME_LIMIT'],
            counts: { pending: 1, notEligible: 0 },
          });
        } finally {
          intercepted.mockRestore();
          timeout.mockRestore();
          await worker.close();
        }
      }

      // Cancel after SQL changed both the final result and task, but before COMMIT.
      const input = await sealed([{ name: 'unknown.bin', bytes: Buffer.from([1, 2, 3]) }]);
      const created = await repository.create(
        identity,
        input.projectId,
        input.batchId,
        input.manifestId,
        newUuidV7(),
      );
      const scope = { ...input, checkId: created.data.check.checkId };
      const lease = await repository.claim(identity, scope);
      if (lease === undefined) throw new Error('missing lease');
      const entry = await repository.next(lease);
      if (entry === undefined) throw new Error('missing entry');
      const deadline = new AbortController();
      const transaction = database.transaction.bind(database);
      const intercepted = vi
        .spyOn(database, 'transaction')
        .mockImplementationOnce((owner, project, operation, signal) =>
          transaction(
            owner,
            project,
            async (client) => {
              const result = await operation(client);
              deadline.abort(new DOMException('deadline', 'TimeoutError'));
              return result;
            },
            signal,
          ),
        );
      try {
        await expect(
          repository.commit(
            lease,
            readCheckResult(entry, undefined, new Date().toISOString()),
            deadline.signal,
          ),
        ).rejects.toThrow();
      } finally {
        intercepted.mockRestore();
      }
      expect(await repository.get(identity, scope)).toMatchObject({
        status: 'RUNNING',
        counts: { pending: 1, notEligible: 0 },
      });
      await repository.finish(identity, scope, 'FAILED', 'CHECK_TIME_LIMIT', lease);
    } finally {
      await blocker.end();
    }
  }, 60_000);
});
