import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  MvpDatabase,
  MvpError,
  MvpService,
  errorCodeOf,
  type SessionIdentity,
  acquireExclusiveLock,
  attemptLockPath,
} from '../../modules/document-delivery/src/index.js';
import {
  entryObjectKey,
  originalObjectKey,
  stagingObjectKey,
} from '../../modules/document-delivery/src/custody/keys.js';
import {
  applyMvpMigration,
  appleDoubleBytes,
  corruptStoredFile,
  createMvpDatabase,
  docxBytes,
  markdownBytes,
  provisionMvp,
  sha256,
  singleChunk,
  textBytes,
  templateDocxBytes,
  templateDocxEntries,
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
  const legacyBatchIds: string[] = [];
  let legacyBefore: Record<string, unknown>[] = [];
  const legacyV3BatchIds: string[] = [];
  let legacyV3Before: Record<string, unknown>[] = [];

  beforeAll(async () => {
    if (adminUrl === undefined) throw new Error('persistence gate is required');
    admin = await createMvpDatabase(adminUrl);
    await applyMvpMigration(
      adminUrl,
      async (client) => {
        // Fixture-only terminal records created under the previous migration.
        await client.query(
          'ALTER TABLE document_delivery.input_batches DISABLE TRIGGER batches_guard',
        );
        for (const [policy, reason] of [
          ['mvp.zip-input@1', 'ZIP_LIMIT_EXCEEDED'],
          ['mvp.zip-input@2', 'ZIP_LIMIT_EXCEEDED'],
          ['mvp.zip-input@2', 'NESTED_ARCHIVE_NOT_ALLOWED'],
        ]) {
          const owner = newUuidV7(),
            project = newUuidV7(),
            batch = newUuidV7(),
            request = newUuidV7();
          legacyBatchIds.push(batch);
          await client.query(
            `INSERT INTO document_delivery.projects
          (owner_id,project_id,customer_name,title,created_at,version,last_batch_no)
          VALUES ($1,$2,'legacy','legacy',now(),1,0)`,
            [owner, project],
          );
          await client.query(
            `INSERT INTO document_delivery.requests
          (owner_id,project_id,request_id,operation,target_id,original_payload,payload_hash,authorization_fact,receipt,committed_at)
          VALUES ($1,$2,$3,'mvp.create_input_batch',$4,'{}',decode(repeat('a',64),'hex'),
            jsonb_build_object('ownerId',$1::uuid::text,'authEpoch',1,'authorizedAt',now()),
            jsonb_build_object('requestId',$3::uuid::text,'projectId',$2::uuid::text,'operation','mvp.create_input_batch',
              'targetId',$4::uuid::text,'payloadHash',repeat('a',64),'committedAt',now(),'result','{}'::jsonb),now())`,
            [owner, project, request, batch],
          );
          await client.query(
            `INSERT INTO document_delivery.input_batches
          (owner_id,project_id,batch_id,batch_no,kind,original_name,declared_bytes,zip_sha256,policy_version,
           status,generation,version,original_request_id,created_at,reason_codes,observed_at,rejected_archive_paths)
          VALUES ($1,$2,$3,1,'INITIAL','legacy.zip',1,decode(repeat('b',64),'hex'),$4,
            'REJECTED',1,5,$5,now(),$6::jsonb,now(),$7::jsonb)`,
            [
              owner,
              project,
              batch,
              policy,
              request,
              JSON.stringify([reason]),
              reason === 'NESTED_ARCHIVE_NOT_ALLOWED' ? '["inner.zip"]' : null,
            ],
          );
        }
        await client.query(
          `UPDATE document_delivery.projects SET version=2,last_batch_no=1
        WHERE project_id IN (SELECT project_id FROM document_delivery.input_batches WHERE batch_id=ANY($1::uuid[]))`,
          [legacyBatchIds],
        );
        await client.query(
          'ALTER TABLE document_delivery.input_batches ENABLE TRIGGER batches_guard',
        );
        legacyBefore = (
          await client.query<Record<string, unknown>>(
            `SELECT b.batch_id, to_jsonb(b) AS batch, to_jsonb(r) AS receipt
        FROM document_delivery.input_batches b JOIN document_delivery.requests r ON r.owner_id=b.owner_id AND r.request_id=b.original_request_id
        WHERE b.batch_id = ANY($1::uuid[]) ORDER BY b.batch_id`,
            [legacyBatchIds],
          )
        ).rows;
      },
      async (client) => {
        // Seed @3 refusals before V0004 to verify exact historical readback.
        await client.query(
          'ALTER TABLE document_delivery.input_batches DISABLE TRIGGER batches_guard',
        );
        for (const reason of ['ZIP_LIMIT_EXCEEDED', 'NESTED_ARCHIVE_NOT_ALLOWED']) {
          const owner = newUuidV7(),
            project = newUuidV7(),
            batch = newUuidV7(),
            request = newUuidV7();
          legacyV3BatchIds.push(batch);
          await client.query(
            `INSERT INTO document_delivery.projects
          (owner_id,project_id,customer_name,title,created_at,version,last_batch_no)
          VALUES ($1,$2,'legacy-v3','legacy-v3',now(),1,0)`,
            [owner, project],
          );
          await client.query(
            `INSERT INTO document_delivery.requests
          (owner_id,project_id,request_id,operation,target_id,original_payload,payload_hash,authorization_fact,receipt,committed_at)
          VALUES ($1,$2,$3,'mvp.create_input_batch',$4,'{}',decode(repeat('a',64),'hex'),
            jsonb_build_object('ownerId',$1::uuid::text,'authEpoch',1,'authorizedAt',now()),
            jsonb_build_object('requestId',$3::uuid::text,'projectId',$2::uuid::text,'operation','mvp.create_input_batch',
              'targetId',$4::uuid::text,'payloadHash',repeat('a',64),'committedAt',now(),'result','{}'::jsonb),now())`,
            [owner, project, request, batch],
          );
          await client.query(
            `INSERT INTO document_delivery.input_batches
          (owner_id,project_id,batch_id,batch_no,kind,original_name,declared_bytes,zip_sha256,policy_version,
           status,generation,version,original_request_id,created_at,reason_codes,observed_at,rejected_archive_paths,limit_violation)
          VALUES ($1,$2,$3,1,'INITIAL','legacy.zip',1,decode(repeat('b',64),'hex'),'mvp.zip-input@3',
            'REJECTED',1,5,$4,now(),$5::jsonb,now(),$6::jsonb,$7::jsonb)`,
            [
              owner,
              project,
              batch,
              request,
              JSON.stringify([reason]),
              reason === 'NESTED_ARCHIVE_NOT_ALLOWED' ? '["inner.zip"]' : null,
              reason === 'ZIP_LIMIT_EXCEEDED'
                ? '{"metric":"OUTER_ENTRIES","actual":1001,"limit":1000}'
                : null,
            ],
          );
        }
        await client.query(
          `UPDATE document_delivery.projects SET version=2,last_batch_no=1
        WHERE project_id IN (SELECT project_id FROM document_delivery.input_batches WHERE batch_id=ANY($1::uuid[]))`,
          [legacyV3BatchIds],
        );
        await client.query(
          'ALTER TABLE document_delivery.input_batches ENABLE TRIGGER batches_guard',
        );
        legacyV3Before = (
          await client.query<Record<string, unknown>>(
            `SELECT b.batch_id, to_jsonb(b) AS batch, to_jsonb(r) AS receipt
        FROM document_delivery.input_batches b JOIN document_delivery.requests r ON r.owner_id=b.owner_id AND r.request_id=b.original_request_id
        WHERE b.batch_id=ANY($1::uuid[]) ORDER BY b.batch_id`,
            [legacyV3BatchIds],
          )
        ).rows;
      },
    );
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

  async function sourceEntryCount(batchId: string): Promise<number> {
    const result = await withMvpAdmin((client) =>
      client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM document_delivery.source_entries
         WHERE owner_id = $1 AND batch_id = $2`,
        [fixture.ownerId, batchId],
      ),
    );
    return Number(result.rows[0]?.count ?? '0');
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

  it('lists only the requested project across batch pages and concurrent new batches', async () => {
    const projectId = await createProject('分页目标项目');
    const otherProjectId = await createProject('同一员工的其他项目');
    const bytes = zipBytes([{ name: 'notes.md', bytes: markdownBytes() }]);
    const other = await createBatch(otherProjectId, bytes);
    const first = await createBatch(projectId, bytes);
    await upload(projectId, first.batchId, bytes);
    await waitForTerminal(projectId, first.batchId);
    const second = await createBatch(projectId, bytes);
    await upload(projectId, second.batchId, bytes);
    await waitForTerminal(projectId, second.batchId);
    const attempts = await service.getBatch(identity, projectId, first.batchId, 1, undefined);
    expect(attempts.nextAttemptCursor).toBeTypeOf('string');
    const following = await service.getBatch(
      identity,
      projectId,
      first.batchId,
      1,
      attempts.nextAttemptCursor,
    );
    expect(following.attempts).toHaveLength(1);
    expect(following.attempts[0]?.kind).toBe('EXTRACT');
    await expect(
      service.getBatch(identity, projectId, second.batchId, 1, attempts.nextAttemptCursor),
    ).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    const page = await service.listBatches(identity, projectId, 1, undefined);
    expect(page.items.map((batch) => batch.batchId)).toEqual([first.batchId]);
    expect(page.nextCursor).toBeTypeOf('string');
    const third = await createBatch(projectId, bytes);
    const next = await service.listBatches(identity, projectId, 1, page.nextCursor);
    expect(next.items.map((batch) => batch.batchId)).toEqual([second.batchId]);
    expect(next.nextCursor).toBeUndefined();
    const refreshed = await service.listBatches(identity, projectId, 50, undefined);
    expect(refreshed.items.map((batch) => batch.batchId)).toEqual([
      first.batchId,
      second.batchId,
      third.batchId,
    ]);
    expect(refreshed.items.every((batch) => batch.projectId === projectId)).toBe(true);
    expect(
      (await service.listBatches(identity, otherProjectId, 50, undefined)).items,
    ).toMatchObject([{ batchId: other.batchId, projectId: otherProjectId }]);
    await expect(
      service.listBatches(identity, otherProjectId, 1, page.nextCursor),
    ).rejects.toMatchObject({
      code: 'CURSOR_INVALID',
    });
  });

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

  it('upgrades @1/@2 rejection records without changing old facts or receipts', async () => {
    await withMvpAdmin(async (client) => {
      const after = (
        await client.query<Record<string, unknown>>(
          `SELECT b.batch_id, to_jsonb(b) - 'limit_violation' AS batch, to_jsonb(r) AS receipt
        FROM document_delivery.input_batches b JOIN document_delivery.requests r ON r.owner_id=b.owner_id AND r.request_id=b.original_request_id
        WHERE b.batch_id = ANY($1::uuid[]) ORDER BY b.batch_id`,
          [legacyBatchIds],
        )
      ).rows;
      expect(after).toEqual(legacyBefore);
      expect(
        (
          await client.query<{ count: string }>(
            'SELECT count(*) FROM document_delivery.input_batches WHERE batch_id = ANY($1::uuid[]) AND limit_violation IS NULL',
            [legacyBatchIds],
          )
        ).rows[0]?.count,
      ).toBe('3');
      const good = {
        metric: 'OFFICE_ENTRIES',
        actual: 20001,
        limit: 20000,
        documentPath: '资料/<file>.docx',
      };
      for (const [detail, expected] of [
        [good, true],
        [{ ...good, actual: 20000 }, false],
        [{ ...good, limit: 1000 }, false],
        [{ ...good, unknown: true }, false],
        [{ ...good, documentPath: '../file.docx' }, false],
        [{ ...good, documentPath: null }, false],
        [{ metric: 'EXPANSION_RATIO', expandedBytes: 1, compressedBytes: 0, limit: 100 }, true],
        [{ metric: 'EXPANSION_RATIO', expandedBytes: 100, compressedBytes: 1, limit: 100 }, false],
      ] as const) {
        expect(
          (
            await client.query<{ valid: boolean }>(
              'SELECT document_delivery.valid_limit_violation($1::jsonb) AS valid',
              [JSON.stringify(detail)],
            )
          ).rows[0]?.valid,
        ).toBe(expected);
      }
    });
  });

  it('upgrades @3 refusal details through V0004 without changing historical facts', async () => {
    await withMvpAdmin(async (client) => {
      const after = (
        await client.query<Record<string, unknown>>(
          `SELECT b.batch_id, to_jsonb(b) AS batch, to_jsonb(r) AS receipt
        FROM document_delivery.input_batches b JOIN document_delivery.requests r ON r.owner_id=b.owner_id AND r.request_id=b.original_request_id
        WHERE b.batch_id=ANY($1::uuid[]) ORDER BY b.batch_id`,
          [legacyV3BatchIds],
        )
      ).rows;
      expect(after).toEqual(legacyV3Before);
      expect(after).toHaveLength(2);
      expect(
        (
          await client.query<{ count: string }>(
            `SELECT count(*) FROM document_delivery.input_batches
        WHERE batch_id=ANY($1::uuid[]) AND limit_violation IS NOT NULL`,
            [legacyV3BatchIds],
          )
        ).rows[0]?.count,
      ).toBe('1');
      expect(
        (
          await client.query<{ count: string }>(
            `SELECT count(*) FROM document_delivery.input_batches
        WHERE batch_id=ANY($1::uuid[]) AND rejected_archive_paths IS NOT NULL`,
            [legacyV3BatchIds],
          )
        ).rows[0]?.count,
      ).toBe('1');
    });
  });

  it('seals @4 template explanations and metadata with exact sources across pagination and restart', async () => {
    const projectId = await createProject('静态模板接收');
    const document = zipBytes(
      templateDocxEntries().map((part) => ({ ...part, method: 8, flags: 6 })),
    );
    const original = zipBytes([
      { name: 'manual.docx', bytes: document },
      { name: '__MACOSX/._manual.docx', bytes: appleDoubleBytes() },
    ]);
    const { batchId } = await createBatch(projectId, original);
    await upload(projectId, batchId, original);
    const detail = await waitForTerminal(projectId, batchId);
    expect(detail.batch).toMatchObject({
      status: 'PARTIAL',
      policyVersion: 'mvp.zip-input@4',
      reasonCodes: ['SYSTEM_METADATA_NOT_DOCUMENT'],
    });
    expect(detail.manifest).toMatchObject({
      totalEntries: 2,
      acceptedEntries: 1,
      limitedEntries: 1,
    });
    const manifestId = detail.manifest?.manifestId;
    if (manifestId === undefined) throw new Error('manifest missing');
    const first = await service.getEntries(identity, projectId, batchId, manifestId, 1, undefined);
    const entry = first.entries[0];
    expect(entry).toMatchObject({
      status: 'ACCEPTED',
      reasonCodes: ['EXTERNAL_TEMPLATE_NOT_LOADED'],
      sha256: sha256(document),
    });
    const source = entry?.sourceRef;
    if (source === undefined) throw new Error('accepted source missing');
    const second = await service.getEntries(
      identity,
      projectId,
      batchId,
      manifestId,
      1,
      first.nextCursor,
    );
    expect(second.entries[0]).toMatchObject({
      status: 'UNSUPPORTED',
      reasonCodes: ['SYSTEM_METADATA_NOT_DOCUMENT'],
    });
    expect(second.entries[0]?.sourceRef).toBeUndefined();
    expect((await service.readSource(identity, projectId, batchId, source.sourceId)).bytes).toEqual(
      document,
    );
    await expect(
      service.readSource(
        { ...identity, ownerId: fixture.owner2 },
        projectId,
        batchId,
        source.sourceId,
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(
      service.readSource(identity, await createProject('其他模板项目'), batchId, source.sourceId),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    const receipt = await service.getRequest(identity, detail.batch.originalRequestId);
    await withMvpAdmin(async (client) => {
      const payload = (
        await client.query<{ payload: { policyVersion: string; extractorVersion: string } }>(
          'SELECT payload FROM document_delivery.input_manifests WHERE batch_id=$1',
          [batchId],
        )
      ).rows[0]?.payload;
      expect(payload).toMatchObject({
        policyVersion: 'mvp.zip-input@4',
        extractorVersion: 'mvp.input-extractor@4',
      });
      await expect(
        client.query(
          `UPDATE document_delivery.source_entries SET reason_codes='[]'::jsonb WHERE batch_id=$1`,
          [batchId],
        ),
      ).rejects.toMatchObject({ code: '55000' });
    });
    await restartService('static-template-restart');
    expect(await service.getBatch(identity, projectId, batchId, 20, undefined)).toEqual(detail);
    expect(
      await service.getEntries(identity, projectId, batchId, manifestId, 1, undefined),
    ).toEqual(first);
    expect(await service.getRequest(identity, detail.batch.originalRequestId)).toEqual(receipt);
    expect((await service.readSource(identity, projectId, batchId, source.sourceId)).bytes).toEqual(
      document,
    );
  });

  it('persists an exact budget refusal across restart, isolates reads and admits a new @4 batch', async () => {
    const projectId = await createProject('资源配额');
    const original = zipBytes([{ name: 'unverified.md', bytes: markdownBytes() }]);
    original.writeUInt16LE(1001, original.length - 14);
    original.writeUInt16LE(1001, original.length - 12);
    const { batchId } = await createBatch(projectId, original);
    await upload(projectId, batchId, original);
    const detail = await waitForTerminal(projectId, batchId);
    expect(detail.batch).toMatchObject({
      status: 'REJECTED',
      policyVersion: 'mvp.zip-input@4',
      reasonCodes: ['ZIP_LIMIT_EXCEEDED'],
    });
    expect(detail.limitViolation).toEqual({ metric: 'OUTER_ENTRIES', actual: 1001, limit: 1000 });
    expect(detail.manifest).toBeUndefined();
    expect(detail.rejectedArchivePaths).toBeUndefined();
    expect(await sourceEntryCount(batchId)).toBe(0);
    expect(await manifestCount(batchId)).toBe(0);
    expect((await service.getProject(identity, projectId)).activeBatchId).toBeUndefined();
    await expect(
      service.getBatch({ ...identity, ownerId: fixture.owner2 }, projectId, batchId, 20, undefined),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(
      service.getBatch(identity, await createProject('另一个项目'), batchId, 20, undefined),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await restartService('resource-rejection-restart');
    expect(await service.getBatch(identity, projectId, batchId, 20, undefined)).toEqual(detail);
    await withMvpAdmin(async (client) => {
      await client.query('BEGIN');
      try {
        // Bypass the immutable terminal-row trigger only to exercise CHECK constraints.
        await client.query(
          'ALTER TABLE document_delivery.input_batches DISABLE TRIGGER batches_guard',
        );
        for (const assignment of [
          'limit_violation = NULL',
          `limit_violation = '{"metric":"OUTER_ENTRIES","actual":1000,"limit":1000}'::jsonb`,
          `policy_version = 'mvp.zip-input@2'`,
          `status = 'FAILED'`,
          `reason_codes = '["ZIP_CORRUPT"]'::jsonb`,
        ]) {
          await client.query('SAVEPOINT invalid_detail');
          await expect(
            client.query(
              `UPDATE document_delivery.input_batches SET ${assignment} WHERE batch_id=$1`,
              [batchId],
            ),
          ).rejects.toMatchObject({
            code: '23514',
            constraint: 'input_batches_limit_violation_check',
          });
          await client.query('ROLLBACK TO SAVEPOINT invalid_detail');
        }
      } finally {
        await client.query('ROLLBACK');
      }
    });
    const corrected = zipBytes(
      Array.from({ length: 5 }, (_, i) => ({ name: `${i}.docx`, bytes: docxBytes(297) })),
    );
    const next = await createBatch(projectId, corrected);
    await upload(projectId, next.batchId, corrected);
    const accepted = await waitForTerminal(projectId, next.batchId);
    expect(accepted.batch).toMatchObject({ status: 'RECEIVED', policyVersion: 'mvp.zip-input@4' });
    expect(accepted.manifest?.acceptedEntries).toBe(5);
    expect(accepted.limitViolation).toBeUndefined();
    expect(await service.getBatch(identity, projectId, batchId, 20, undefined)).toEqual(detail);
  });

  it('rejects nested archives in initial and supplement batches and persists their paths across restart', async () => {
    const projectId = await createProject('嵌套压缩拒绝');
    const paths = ['历史/<archive>.RAR', '资料/inner.zip', `${'e\u0301'.repeat(78)}aa.rar`];
    const bytes = zipBytes([
      { name: 'normal.md', bytes: markdownBytes() },
      ...paths.map((name) => ({ name, bytes: textBytes('archive') })),
    ]);
    const { batchId } = await createBatch(projectId, bytes);
    await upload(projectId, batchId, bytes);
    const detail = await waitForTerminal(projectId, batchId);
    expect(detail.batch).toMatchObject({
      status: 'REJECTED',
      policyVersion: 'mvp.zip-input@4',
      reasonCodes: ['NESTED_ARCHIVE_NOT_ALLOWED'],
    });
    expect(detail.rejectedArchivePaths).toEqual(paths);
    expect(detail.manifest).toBeUndefined();
    expect(detail.permittedActions).toEqual([]);
    expect(await sourceEntryCount(batchId)).toBe(0);
    expect(await manifestCount(batchId)).toBe(0);
    expect((await service.getProject(identity, projectId)).activeBatchId).toBeUndefined();
    const state = await service.repository.readBatchState(identity.ownerId, projectId, batchId);
    const quarantined = state.batch.originalZipSource;
    if (quarantined === undefined) throw new Error('quarantined original missing');
    await expect(
      service.readSource(identity, projectId, batchId, quarantined.sourceId),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(
      service.getBatch({ ...identity, ownerId: fixture.owner2 }, projectId, batchId, 20, undefined),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(
      service.getBatch(identity, await createProject('另一项目'), batchId, 20, undefined),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    const request = await service.getRequest(identity, detail.batch.originalRequestId);
    const record = await service.repository.getRequestView(
      identity.ownerId,
      detail.batch.originalRequestId,
    );
    expect(record).toEqual(request);
    await restartService('nested-rejection-restart');
    expect(await service.getBatch(identity, projectId, batchId, 20, undefined)).toEqual(detail);
    for (const repeats of [79, 100]) {
      const unsafe = zipBytes([
        { name: 'normal.md', bytes: markdownBytes() },
        { name: `${'e\u0301'.repeat(repeats)}.rar`, bytes: textBytes('archive') },
      ]);
      const oversized = await createBatch(projectId, unsafe);
      await upload(projectId, oversized.batchId, unsafe);
      const rejected = await waitForTerminal(projectId, oversized.batchId);
      expect(rejected.batch).toMatchObject({ status: 'REJECTED', reasonCodes: ['ZIP_UNSAFE'] });
      expect(rejected.rejectedArchivePaths).toBeUndefined();
      expect(rejected.manifest).toBeUndefined();
      expect(await sourceEntryCount(oversized.batchId)).toBe(0);
      expect(await manifestCount(oversized.batchId)).toBe(0);
      expect((await service.getProject(identity, projectId)).activeBatchId).toBeUndefined();
    }
    const corrected = zipBytes([
      { name: 'normal.md', bytes: markdownBytes() },
      { name: '资料/word.docx', bytes: docxBytes() },
    ]);
    const next = await createBatch(projectId, corrected);
    await upload(projectId, next.batchId, corrected);
    const accepted = await waitForTerminal(projectId, next.batchId);
    expect(accepted.batch.status).toBe('RECEIVED');
    expect(accepted.manifest?.acceptedEntries).toBe(2);
    expect(accepted.rejectedArchivePaths).toBeUndefined();
    const supplement = await createBatch(projectId, bytes);
    await upload(projectId, supplement.batchId, bytes);
    expect((await waitForTerminal(projectId, supplement.batchId)).rejectedArchivePaths).toEqual(
      paths,
    );
    expect(
      (await service.getBatch(identity, projectId, next.batchId, 20, undefined)).manifest,
    ).toEqual(accepted.manifest);
    expect(await service.getBatch(identity, projectId, batchId, 20, undefined)).toEqual(detail);
  });

  it.each([
    ['nested rejection paths', 'nested'],
    ['limit rejection details', 'limit'],
  ] as const)('rolls back %s, status and active-slot release together', async (_label, kind) => {
    const projectId = await createProject('拒绝事务回滚');
    const bytes = zipBytes([
      { name: 'normal.md', bytes: markdownBytes() },
      { name: 'inner.rar', bytes: textBytes('archive') },
    ]);
    if (kind === 'limit') {
      bytes.writeUInt16LE(1001, bytes.length - 14);
      bytes.writeUInt16LE(1001, bytes.length - 12);
    }
    const { batchId } = await createBatch(projectId, bytes);
    await withMvpAdmin(async (client) => {
      await client.query(`CREATE FUNCTION document_delivery.mvp_test_fail_rejection() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected rejection event failure'; END $$`);
      await client.query(`CREATE TRIGGER mvp_test_fail_rejection BEFORE INSERT ON document_delivery.custody_events
        FOR EACH ROW WHEN (NEW.batch_id = '${batchId}'::uuid AND NEW.to_status = 'REJECTED')
        EXECUTE FUNCTION document_delivery.mvp_test_fail_rejection()`);
    });
    try {
      await upload(projectId, batchId, bytes);
      await service.whenIdle();
      const failed = await service.getBatch(identity, projectId, batchId, 20, undefined);
      expect(failed.batch.status).toBe('EXTRACTING');
      expect(failed.rejectedArchivePaths).toBeUndefined();
      expect(failed.limitViolation).toBeUndefined();
      expect(failed.batch.reasonCodes).toEqual([]);
      expect((await service.getProject(identity, projectId)).activeBatchId).toBe(batchId);
      expect(await sourceEntryCount(batchId)).toBe(0);
      expect(await manifestCount(batchId)).toBe(0);
    } finally {
      await withMvpAdmin(async (client) => {
        await client.query(
          'DROP TRIGGER mvp_test_fail_rejection ON document_delivery.custody_events',
        );
        await client.query('DROP FUNCTION document_delivery.mvp_test_fail_rejection()');
      });
    }
    await restartService('nested-rejection-after-rollback');
    await service.resumePendingExtractions();
    const recovered = await waitForTerminal(projectId, batchId);
    if (kind === 'nested') expect(recovered.rejectedArchivePaths).toEqual(['inner.rar']);
    else
      expect(recovered.limitViolation).toEqual({
        metric: 'OUTER_ENTRIES',
        actual: 1001,
        limit: 1000,
      });
  });

  it.each([
    ['old-policy', 'mvp.zip-input@1'],
    ['mvp.zip-input@2', 'mvp.zip-input@2'],
    ['mvp.zip-input@3', 'mvp.zip-input@3'],
  ])(
    'blocks %s execution and requires ended writers, reconciliation and explicit abandonment',
    async (_label, oldPolicy) => {
      const bytes = zipBytes([{ name: 'legacy.md', bytes: markdownBytes() }]);
      for (const mode of ['AWAITING_UPLOAD', 'RECEIVING', 'STAGED', 'EXTRACTING', 'UNKNOWN']) {
        const running = ['RECEIVING', 'EXTRACTING', 'UNKNOWN'].includes(mode);
        const projectId = await createProject('旧策略恢复');
        const { batchId } = await createBatch(projectId, bytes);
        const initial = await service.getBatch(identity, projectId, batchId, 20, undefined);
        let attempt = initial.batch.currentAttempt;
        if (attempt === undefined) throw new Error('legacy attempt missing');
        if (mode !== 'AWAITING_UPLOAD')
          await service.repository.claimUpload(
            identity.ownerId,
            identity.authEpoch,
            projectId,
            batchId,
            attempt.attemptId,
            attempt.generation,
          );
        if (mode === 'STAGED' || mode === 'EXTRACTING') {
          const key = originalObjectKey(identity.ownerId, projectId, batchId, attempt.attemptId);
          const stored = await fixture.store.putImmutable(key, bytes, 'application/zip');
          const completed = await service.repository.completeUpload(
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
          attempt = completed.attempt;
          if (mode === 'EXTRACTING')
            await service.repository.claimExtraction(
              identity.ownerId,
              identity.authEpoch,
              projectId,
              batchId,
              attempt.attemptId,
              attempt.generation,
            );
        }
        if (mode === 'UNKNOWN')
          await service.repository.markUploadUnknown(identity.ownerId, projectId, batchId);
        // Fixture-only conversion; production never changes a batch's fixed policy.
        await withMvpAdmin(async (client) => {
          await client.query('BEGIN');
          try {
            await client.query(
              'ALTER TABLE document_delivery.input_batches DISABLE TRIGGER batches_guard',
            );
            await client.query(
              'UPDATE document_delivery.input_batches SET policy_version = $2 WHERE batch_id = $1',
              [batchId, oldPolicy],
            );
            await client.query(
              'ALTER TABLE document_delivery.input_batches ENABLE TRIGGER batches_guard',
            );
            await client.query('COMMIT');
          } catch (error) {
            await client.query('ROLLBACK');
            throw error;
          }
        });
        await expect(upload(projectId, batchId, bytes)).rejects.toMatchObject({
          code: 'RECOVERY_NOT_ALLOWED',
        });
        await restartService('old-policy-restart');
        await service.resumePendingExtractions();
        let detail = await service.getBatch(identity, projectId, batchId, 20, undefined);
        expect(detail.permittedActions).toEqual([running ? 'RECONCILE' : 'ABANDON']);
        for (const action of ['RETRY_UPLOAD', 'CONTINUE_EXTRACTION'])
          await expect(
            service.recover(identity, {
              requestId: newUuidV7(),
              projectId,
              batchId,
              payload: { expectedBatchVersion: detail.batch.version, action },
            }),
          ).rejects.toMatchObject({ code: 'RECOVERY_NOT_ALLOWED' });
        const lock = await acquireExclusiveLock(
          attemptLockPath(fixture.store.root, attempt.attemptId),
        );
        if (lock === null) throw new Error('test writer lock missing');
        const input = {
          requestId: newUuidV7(),
          projectId,
          batchId,
          payload: {
            expectedBatchVersion: detail.batch.version,
            action: running ? 'RECONCILE' : 'ABANDON',
          },
        };
        try {
          await expect(service.recover(identity, input)).rejects.toMatchObject({
            code: 'RECOVERY_NOT_ALLOWED',
          });
        } finally {
          await lock.release();
        }
        await service.recover(identity, input);
        if (running) {
          detail = await service.getBatch(identity, projectId, batchId, 20, undefined);
          expect(detail.batch.status).toBe('FAILED');
          expect(detail.permittedActions).toEqual(['ABANDON']);
          expect((await service.getProject(identity, projectId)).activeBatchId).toBe(batchId);
          await service.recover(identity, {
            requestId: newUuidV7(),
            projectId,
            batchId,
            payload: { expectedBatchVersion: detail.batch.version, action: 'ABANDON' },
          });
        }
        const historical = await service.getBatch(identity, projectId, batchId, 20, undefined);
        expect(historical.batch).toMatchObject({
          status: 'ABANDONED',
          policyVersion: oldPolicy,
        });
        const next = await createBatch(projectId, bytes);
        await upload(projectId, next.batchId, bytes);
        expect((await waitForTerminal(projectId, next.batchId)).batch.policyVersion).toBe(
          'mvp.zip-input@4',
        );
        expect(await service.getBatch(identity, projectId, batchId, 20, undefined)).toEqual(
          historical,
        );
      }
    },
  );

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

  it('rejects ABANDON during a real live upload without changing its intent or history', async () => {
    const projectId = await createProject('活跃上传');
    const bytes = zipBytes([{ name: 'live.md', bytes: markdownBytes() }]);
    const { batchId } = await createBatch(projectId, bytes);
    const before = await service.getBatch(identity, projectId, batchId, 20, undefined);
    const attempt = before.batch.currentAttempt;
    if (attempt === undefined) throw new Error('attempt missing');
    const entered = Promise.withResolvers<undefined>();
    const resume = Promise.withResolvers<undefined>();
    const uploading = service.upload(identity, {
      projectId,
      batchId,
      attemptId: attempt.attemptId,
      generation: attempt.generation,
      contentLength: bytes.length,
      chunks: (async function* () {
        yield bytes.subarray(0, 1);
        entered.resolve(undefined);
        await resume.promise;
        yield bytes.subarray(1);
      })(),
    });
    try {
      await entered.promise;
      const live = await service.getBatch(identity, projectId, batchId, 20, undefined);
      const project = await service.getProject(identity, projectId);
      expect(live.batch.status).toBe('RECEIVING');
      const requestId = newUuidV7();
      await expect(
        service.recover(identity, {
          requestId,
          projectId,
          batchId,
          payload: { expectedBatchVersion: live.batch.version, action: 'ABANDON' },
        }),
      ).rejects.toMatchObject({ code: 'RECOVERY_NOT_ALLOWED' });
      expect(await service.getBatch(identity, projectId, batchId, 20, undefined)).toEqual(live);
      expect(await service.getProject(identity, projectId)).toEqual(project);
      await expect(service.getRequest(identity, requestId)).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
      });
    } finally {
      resume.resolve(undefined);
      await uploading;
      await service.whenIdle();
    }
    const completed = await waitForTerminal(projectId, batchId);
    expect(completed.batch.status).toBe('RECEIVED');
    expect(completed.attempts.find((item) => item.attemptId === attempt.attemptId)?.status).toBe(
      'SUCCEEDED',
    );
  });

  it.each(['ABANDON', 'RETRY_UPLOAD'] as const)(
    'requires the old upload lock for %s',
    async (action) => {
      const projectId = await createProject('恢复互斥');
      const bytes = zipBytes([{ name: 'lock.md', bytes: markdownBytes() }]);
      const { batchId } = await createBatch(projectId, bytes);
      const before = await service.getBatch(identity, projectId, batchId, 20, undefined);
      const attempt = before.batch.currentAttempt;
      if (attempt === undefined) throw new Error('attempt missing');
      const path = attemptLockPath(fixture.store.root, attempt.attemptId);
      const lock = await acquireExclusiveLock(path);
      expect(lock).not.toBeNull();
      const requestId = newUuidV7();
      const input = {
        requestId,
        projectId,
        batchId,
        payload: { expectedBatchVersion: before.batch.version, action },
      };
      try {
        await expect(service.recover(identity, input)).rejects.toMatchObject({
          code: 'RECOVERY_NOT_ALLOWED',
        });
        expect(await service.getBatch(identity, projectId, batchId, 20, undefined)).toEqual(before);
        await expect(service.getRequest(identity, requestId)).rejects.toMatchObject({
          code: 'RESOURCE_NOT_FOUND',
        });
      } finally {
        await lock?.release();
      }
      const recovered = await service.recover(identity, input);
      expect(recovered.replayed).toBe(false);
      expect((await service.recover(identity, input)).replayed).toBe(true);
    },
  );

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

  it.each(['missing', 'truncated'])(
    'converges a terminated incomplete upload to an explicit retry: %s',
    async (staging) => {
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
      if (staging === 'truncated')
        await fixture.store.writeStaged(
          stagingObjectKey(attempt.attemptId),
          singleChunk(bytes.subarray(0, 1)),
          bytes.length,
        );
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
    },
  );

  it('reuses complete staging before publish only after its old writer has stopped', async () => {
    const projectId = await createProject('暂存窗口');
    const original = zipBytes([{ name: 'staged.md', bytes: markdownBytes() }]);
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
    const stagedKey = stagingObjectKey(attempt.attemptId);
    const fixedKey = originalObjectKey(identity.ownerId, projectId, batchId, attempt.attemptId);
    const receipt = await fixture.store.writeStaged(
      stagedKey,
      singleChunk(original),
      original.length,
    );
    expect(await fixture.store.inspect(fixedKey)).toBeNull();
    const oldWriter = await acquireExclusiveLock(
      attemptLockPath(fixture.store.root, attempt.attemptId),
    );
    expect(oldWriter).not.toBeNull();
    const receiving = await service.getBatch(identity, projectId, batchId, 20, undefined);
    try {
      const observed = await service.recover(identity, {
        requestId: newUuidV7(),
        projectId,
        batchId,
        payload: { expectedBatchVersion: receiving.batch.version, action: 'RECONCILE' },
      });
      expect(observed.data.batch.status).toBe('RECEIVING');
      expect(await fixture.store.inspect(fixedKey)).toBeNull();
      expect(await fixture.store.inspectStaged(stagedKey)).toEqual(receipt);
    } finally {
      await oldWriter?.release();
    }
    await service.recover(identity, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: { expectedBatchVersion: receiving.batch.version, action: 'RECONCILE' },
    });
    const staged = await service.getBatch(identity, projectId, batchId, 20, undefined);
    expect(staged.batch.status).toBe('STAGED');
    expect(staged.attempts).toHaveLength(1);
    expect(staged.attempts[0]?.attemptId).toBe(attempt.attemptId);
    expect(staged.manifest).toBeUndefined();
    expect(await fixture.store.inspectStaged(stagedKey)).toBeNull();
    expect((await fixture.store.readVerified(fixedKey, receipt)).equals(original)).toBe(true);
    await expect(
      service.recover(identity, {
        requestId: newUuidV7(),
        projectId,
        batchId,
        payload: { expectedBatchVersion: staged.batch.version, action: 'RETRY_UPLOAD' },
      }),
    ).rejects.toMatchObject({ code: 'RECOVERY_NOT_ALLOWED' });
    await service.recover(identity, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: { expectedBatchVersion: staged.batch.version, action: 'CONTINUE_EXTRACTION' },
    });
    expect((await waitForTerminal(projectId, batchId)).batch.status).toBe('RECEIVED');
  });

  it.each(['complete', 'truncated'])(
    'checks retained staging before RETRY on a failed observation: %s',
    async (contents) => {
      const projectId = await createProject('暂存重试保护');
      const original = zipBytes([{ name: 'retained.md', bytes: markdownBytes() }]);
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
      const stagedKey = stagingObjectKey(attempt.attemptId);
      await fixture.store.writeStaged(
        stagedKey,
        singleChunk(contents === 'complete' ? original : original.subarray(0, 1)),
        original.length,
      );
      // A prior failure observation cannot override the actual durable bytes.
      await service.repository.failUpload(identity.ownerId, projectId, batchId, attempt.attemptId, [
        'UPLOAD_INCOMPLETE',
      ]);
      const failed = await service.getBatch(identity, projectId, batchId, 20, undefined);
      expect(failed.permittedActions).toContain('RETRY_UPLOAD');
      expect(
        await fixture.store.inspect(
          originalObjectKey(identity.ownerId, projectId, batchId, attempt.attemptId),
        ),
      ).toBeNull();
      const requestId = newUuidV7();
      const recovery = service.recover(identity, {
        requestId,
        projectId,
        batchId,
        payload: { expectedBatchVersion: failed.batch.version, action: 'RETRY_UPLOAD' },
      });
      if (contents === 'complete') {
        await expect(recovery).rejects.toMatchObject({ code: 'RECOVERY_NOT_ALLOWED' });
        expect(await service.getBatch(identity, projectId, batchId, 20, undefined)).toEqual(failed);
        await expect(service.getRequest(identity, requestId)).rejects.toMatchObject({
          code: 'RESOURCE_NOT_FOUND',
        });
      } else {
        expect((await recovery).replayed).toBe(false);
        expect(
          (await service.getBatch(identity, projectId, batchId, 20, undefined)).attempts,
        ).toHaveLength(2);
      }
      expect((await fixture.store.inspectStaged(stagedKey))?.byteLength).toBe(
        contents === 'complete' ? original.length : 1,
      );
    },
  );

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

  it.each(['', ' with a template explanation'])(
    'rolls back entry acceptance when an entry row write fails and preserves prior custody%s',
    async (variant) => {
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
        variant === ''
          ? { name: 'second.md', bytes: markdownBytes('# 第二项') }
          : { name: 'template.docx', bytes: templateDocxBytes() },
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
        expect(await sourceEntryCount(batchId)).toBe(0);
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

      const oldExtract = failed.batch.currentAttempt;
      if (oldExtract === undefined) throw new Error('extract missing');
      const heldExtract = await acquireExclusiveLock(
        attemptLockPath(fixture.store.root, oldExtract.attemptId),
      );
      expect(heldExtract).not.toBeNull();
      try {
        for (const action of ['CONTINUE_EXTRACTION', 'ABANDON'] as const) {
          const requestId = newUuidV7();
          await expect(
            service.recover(identity, {
              requestId,
              projectId,
              batchId,
              payload: { expectedBatchVersion: failed.batch.version, action },
            }),
          ).rejects.toMatchObject({ code: 'RECOVERY_NOT_ALLOWED' });
          expect(await service.getBatch(identity, projectId, batchId, 20, undefined)).toEqual(
            failed,
          );
          await expect(service.getRequest(identity, requestId)).rejects.toMatchObject({
            code: 'RESOURCE_NOT_FOUND',
          });
        }
      } finally {
        await heldExtract?.release();
      }
      await service.recover(identity, {
        requestId: newUuidV7(),
        projectId,
        batchId,
        payload: { expectedBatchVersion: failed.batch.version, action: 'CONTINUE_EXTRACTION' },
      });
      const accepted = await waitForTerminal(projectId, batchId);
      expect(accepted.batch.status).toBe('RECEIVED');
      if (variant !== '') {
        const manifestId = accepted.manifest?.manifestId;
        if (manifestId === undefined) throw new Error('template manifest missing');
        const entries = await service.getEntries(
          identity,
          projectId,
          batchId,
          manifestId,
          20,
          undefined,
        );
        expect(entries.entries[1]).toMatchObject({
          status: 'ACCEPTED',
          reasonCodes: ['EXTERNAL_TEMPLATE_NOT_LOADED'],
        });
      }
      expect(await manifestCount(batchId)).toBe(1);
      expect(await sourceEntryCount(batchId)).toBeGreaterThan(0);
      const acceptedSource = accepted.manifest?.originalZip;
      if (acceptedSource === undefined) throw new Error('accepted source missing');
      const acceptedBytes = await service.readSource(
        identity,
        projectId,
        batchId,
        acceptedSource.sourceId,
      );
      expect(acceptedBytes.bytes.equals(bytes)).toBe(true);
    },
  );

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
    expect(injected).toBe(true);

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

  it.each(['published', 'staged'])(
    'reconciles a durable first-upload gap across an epoch change and continues at the current epoch: %s',
    async (location) => {
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
      if (location === 'staged')
        await fixture.store.writeStaged(
          stagingObjectKey(attempt.attemptId),
          singleChunk(original),
          original.length,
        );
      else
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
      const state = await service.repository.readBatchState(fresh.ownerId, projectId, batchId);
      expect(state.attempts).toHaveLength(1);
      expect(state.attempts[0]?.authorizedAuthEpoch).toBe(epoch);
      expect(state.attempts[0]?.attemptId).toBe(attempt.attemptId);
      expect(staged.permittedActions).toContain('CONTINUE_EXTRACTION');
      await service.recover(fresh, {
        requestId: newUuidV7(),
        projectId,
        batchId,
        payload: { expectedBatchVersion: staged.batch.version, action: 'CONTINUE_EXTRACTION' },
      });
      const completed = await waitForTerminal(projectId, batchId, fresh);
      expect(completed.batch.status).toBe('RECEIVED');
    },
  );

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
