import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { newUuidV7 } from '@zhiju/shared-kernel';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  MvpDatabase,
  MvpService,
  type SessionIdentity,
} from '../../modules/document-delivery/src/index.js';
import {
  applyMvpMigration,
  createMvpDatabase,
  markdownBytes,
  provisionMvp,
  sha256,
  singleChunk,
  zipBytes,
  type MvpFixture,
} from './mvp-fixtures.js';

const gateEnabled = process.env.ZJU_PERSISTENCE_DATABASE_URL !== undefined;
const terminal = new Set(['RECEIVED', 'PARTIAL', 'REJECTED', 'FAILED', 'ABANDONED']);

describe.skipIf(!gateEnabled)('MVP01 PostgreSQL process restart (isolated container)', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let fixture: MvpFixture;
  let admin: Client | undefined;
  let database: MvpDatabase;
  let service: MvpService;
  let identity: SessionIdentity;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18.6')
      .withDatabase('postgres')
      .withUsername('postgres')
      .withPassword('zhiju-gate-test')
      .withStartupTimeout(120_000)
      .start();
    const adminUrl = `postgres://postgres:zhiju-gate-test@${container.getHost()}:${container.getMappedPort(5432)}/postgres`;
    admin = await createMvpDatabase(adminUrl);
    await applyMvpMigration(adminUrl);
    fixture = await provisionMvp(adminUrl);
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
      incarnation: 'vitest-postgres-restart',
    });
    await service.startup();
  }, 180_000);

  afterAll(async () => {
    try {
      await database.close();
    } catch {
      // beforeAll may have failed before a pool existed.
    }
    await admin?.end().catch(() => undefined);
    await container?.stop({ remove: true, timeout: 10_000 }).catch(() => undefined);
  }, 60_000);

  async function upload(projectId: string, batchId: string, bytes: Buffer): Promise<void> {
    const detail = await service.getBatch(identity, projectId, batchId, 20, undefined);
    const attempt = detail.batch.currentAttempt;
    if (attempt === undefined) throw new Error('batch has no attempt');
    await service.upload(identity, {
      projectId,
      batchId,
      attemptId: attempt.attemptId,
      generation: attempt.generation,
      contentLength: bytes.length,
      chunks: singleChunk(bytes),
    });
  }

  async function waitForTerminal(projectId: string, batchId: string) {
    await service.whenIdle();
    const detail = await service.getBatch(identity, projectId, batchId, 20, undefined);
    if (!terminal.has(detail.batch.status))
      throw new Error(`batch did not reach a terminal state: ${detail.batch.status}`);
    return detail;
  }

  async function waitForDatabase(connectionString: string): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt++) {
      const client = new Client({ connectionString });
      try {
        await client.connect();
        await client.query('SELECT 1');
        return;
      } catch {
        await delay(500);
      } finally {
        await client.end().catch(() => undefined);
      }
    }
    throw new Error('PostgreSQL did not accept connections after restart');
  }

  it('reads the same accepted manifest after a real PostgreSQL stop-start', async () => {
    if (container === undefined) throw new Error('container missing');
    const projectId = newUuidV7();
    await service.createProject(identity, {
      requestId: newUuidV7(),
      projectId,
      payload: { customerName: '数据库重启客户', title: '数据库重启项目' },
    });
    const original = zipBytes([{ name: 'restart.md', bytes: markdownBytes('# 重启资料') }]);
    const batchId = newUuidV7();
    await service.createBatch(identity, {
      requestId: newUuidV7(),
      projectId,
      batchId,
      payload: {
        expectedProjectVersion: 1,
        originalName: 'restart.zip',
        declaredBytes: original.length,
        zipSha256: sha256(original),
      },
    });
    await upload(projectId, batchId, original);
    const accepted = await waitForTerminal(projectId, batchId);
    const manifestId = accepted.manifest?.manifestId;
    const source = accepted.manifest?.originalZip;
    if (manifestId === undefined || source === undefined) throw new Error('manifest missing');

    await database.close();
    await admin?.end();
    admin = undefined;
    const containerId = container.getId();
    let stopped = false;
    try {
      execFileSync('docker', ['stop', '--time', '10', containerId]);
      stopped = true;
      execFileSync('docker', ['start', containerId]);
      stopped = false;
    } finally {
      if (stopped) execFileSync('docker', ['start', containerId]);
    }
    const mapping = execFileSync('docker', ['port', containerId, '5432/tcp'], {
      encoding: 'utf8',
    }).trim();
    const port = mapping.slice(mapping.lastIndexOf(':') + 1);
    const databaseUrl = new URL(fixture.databaseUrl);
    databaseUrl.port = port;
    await waitForDatabase(databaseUrl.toString());
    database = new MvpDatabase({ connectionString: databaseUrl.toString() });
    service = new MvpService({
      database,
      store: fixture.store,
      cursorKey: Buffer.alloc(32, 7),
      incarnation: 'vitest-postgres-restart',
    });
    await service.startup();

    const reread = await service.getBatch(identity, projectId, batchId, 20, undefined);
    expect(reread.manifest?.manifestId).toBe(manifestId);
    const bytes = await service.readSource(identity, projectId, batchId, source.sourceId);
    expect(bytes.bytes.equals(original)).toBe(true);
  }, 60_000);
});
