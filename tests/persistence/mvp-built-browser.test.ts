import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect as vitestExpect, it } from 'vitest';

import { newUuidV7 } from '@zhiju/shared-kernel';
import { FakeOidcProvider } from '../../apps/workspace-bff/src/testing/fake-oidc.js';
import {
  applyMvpMigration,
  createMvpDatabase,
  docxBytes,
  markdownBytes,
  provisionMvp,
  textBytes,
  xlsxBytes,
  zipBytes,
  type MvpFixture,
} from './mvp-fixtures.js';

const adminUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = adminUrl !== undefined;
const CLIENT_ID = 'mvp-bff';
const AUDIENCE = 'zhiju-mvp-api';
const CLIENT_SECRET = 'browser-client-secret';
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const webServerEntry = resolve(repositoryRoot, 'apps/workspace-web/tools/serve.mjs');
const webDist = resolve(repositoryRoot, 'apps/workspace-web/dist');
const coreEntry = resolve(repositoryRoot, 'apps/api/dist/mvp-main.js');
const bffEntry = resolve(repositoryRoot, 'apps/workspace-bff/dist/main.js');

function freePort(): Promise<number> {
  const server = createServer();
  const started = Promise.withResolvers<number>();
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      started.reject(new Error('no loopback port'));
      return;
    }
    started.resolve(address.port);
  });
  server.once('error', (error) => {
    started.reject(error);
  });
  return started.promise.then((port) => {
    const closed = Promise.withResolvers<undefined>();
    server.close((error) => {
      if (error) closed.reject(error);
      else closed.resolve(undefined);
    });
    return closed.promise.then(() => port);
  });
}

function ensureBuiltArtifacts(): void {
  // Persistence partitions normally pre-build, but a focused diagnostic may
  // run after a source edit. Always produce the current production entries so
  // this journey cannot pass against a stale BFF/Core binary.
  execFileSync('pnpm', ['build'], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  if (!existsSync(coreEntry) || !existsSync(bffEntry))
    throw new Error('production Core/BFF builds are missing');
  if (!existsSync(resolve(webDist, 'index.html')))
    throw new Error('production workspace-web build produced no index.html');
  if (existsSync(resolve(webDist, 'fixture-build.json')))
    throw new Error('production workspace-web build still carries a fixture marker');
}

interface ChildProcessHandle {
  readonly stop: () => Promise<void>;
}

async function startChild(input: {
  readonly name: string;
  readonly entry: string;
  readonly env: NodeJS.ProcessEnv;
  readonly readyUrl: string;
}): Promise<ChildProcessHandle> {
  const child = spawn(process.execPath, [input.entry], {
    cwd: repositoryRoot,
    env: { ...process.env, ...input.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  const lifecycle: { exited: number | null } = { exited: null };
  child.stdout.on('data', (chunk: Buffer) => {
    output.push(chunk.toString('utf8'));
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output.push(chunk.toString('utf8'));
  });
  child.once('exit', (code) => {
    lifecycle.exited = code;
  });
  for (let attempt = 0; attempt < 200; attempt++) {
    if (lifecycle.exited !== null)
      throw new Error(`${input.name} exited ${lifecycle.exited}: ${output.join('').trim()}`);
    const ready = await fetch(input.readyUrl)
      .then(() => true)
      .catch(() => false);
    if (ready) break;
    const delay = Promise.withResolvers<undefined>();
    setTimeout(() => {
      delay.resolve(undefined);
    }, 100);
    await delay.promise;
  }
  return {
    async stop() {
      if (lifecycle.exited !== null) return;
      const stopped = Promise.withResolvers<undefined>();
      child.once('exit', () => {
        stopped.resolve(undefined);
      });
      child.kill('SIGTERM');
      await stopped.promise;
    },
  };
}

async function startWeb(port: number, bffOrigin: string): Promise<{ stop: () => Promise<void> }> {
  const child = spawn(process.execPath, [webServerEntry], {
    cwd: repositoryRoot,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), BFF_URL: bffOrigin },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  const lifecycle: { exited: number | null } = { exited: null };
  child.stdout.on('data', (chunk: Buffer) => {
    output.push(chunk.toString('utf8'));
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output.push(chunk.toString('utf8'));
  });
  child.once('exit', (code) => {
    lifecycle.exited = code;
  });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (lifecycle.exited !== null)
      throw new Error(`web server exited ${lifecycle.exited}: ${output.join('').trim()}`);
    const ready = await fetch(`${origin}/custody`, { headers: { accept: 'text/html' } })
      .then((response) => response.status === 200)
      .catch(() => false);
    if (ready) break;
    const delay = Promise.withResolvers<undefined>();
    setTimeout(() => {
      delay.resolve(undefined);
    }, 100);
    await delay.promise;
  }
  return {
    async stop() {
      if (lifecycle.exited !== null) return;
      const stopped = Promise.withResolvers<undefined>();
      child.once('exit', () => {
        stopped.resolve(undefined);
      });
      child.kill('SIGTERM');
      await stopped.promise;
    },
  };
}

describe.skipIf(!gateEnabled)('MVP01 built browser custody journey', () => {
  let fixture: MvpFixture;
  let provider: FakeOidcProvider;
  let core: ChildProcessHandle | undefined;
  let bff: ChildProcessHandle | undefined;
  let web: ChildProcessHandle | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let webOrigin = '';
  let coreOrigin = '';
  let coreEnv: Record<string, string> = {};

  beforeAll(async () => {
    if (adminUrl === undefined) throw new Error('persistence gate is required');
    ensureBuiltArtifacts();
    await createMvpDatabase(adminUrl);
    await applyMvpMigration(adminUrl);
    const subject = newUuidV7();
    provider = new FakeOidcProvider({
      clock: () => Date.now(),
      clientId: CLIENT_ID,
      apiAudience: AUDIENCE,
      azp: CLIENT_ID,
      sub: subject,
    });
    await provider.start();
    fixture = await provisionMvp(adminUrl, { issuer: provider.issuer, subject });

    const webPort = await freePort();
    const bffPort = await freePort();
    const corePort = await freePort();
    webOrigin = `http://127.0.0.1:${webPort}`;
    const bffOrigin = `http://127.0.0.1:${bffPort}`;
    coreOrigin = `http://127.0.0.1:${corePort}`;
    const trust = {
      trustConfigVersion: 'mvp-trust-v1',
      publicOrigin: webOrigin,
      allowedHosts: [`127.0.0.1:${webPort}`, `127.0.0.1:${bffPort}`],
      trustedProxyPeers: [],
      issuer: provider.issuer,
      providerCode: 'synthetic-oidc',
      discoveryUrl: provider.url('/.well-known/openid-configuration'),
      clientId: CLIENT_ID,
      clientAuthSecretRef: 'env:ZHIJU_MVP_CLIENT_SECRET',
      apiAudience: AUDIENCE,
      allowedAzp: CLIENT_ID,
      callbackUri: `${webOrigin}/bff/auth/callback`,
      postLogoutRedirectUri: `${webOrigin}/custody`,
      returnRoutePatterns: ['/custody', '/custody/projects/:projectRef'],
      oidcEndpointAllowlist: [
        provider.url('/.well-known/openid-configuration'),
        provider.url('/authorize'),
        provider.url('/token'),
        provider.url('/jwks'),
        provider.url('/logout'),
        provider.url('/revoke'),
      ],
      apiBaseUrl: `${coreOrigin}/api`,
      apiGatewayPeers: ['127.0.0.1', '::1'],
      idTokenAlgorithms: ['RS256'],
      accessTokenAlgorithms: ['RS256'],
      accessTokenMaxAgeSeconds: 300,
      clockSkewSeconds: 30,
      jwksTtlSeconds: 300,
      httpTimeoutSeconds: 10,
      maxSessions: 10,
      maxLoginTransactions: 20,
      maxTransactionsPerBrowser: 2,
      maxConcurrentUploads: 2,
      capabilityCodes: {
        workspaceProjectDiscoveryHumanV1: 'unused.discovery',
        projectBoardSliceReadHumanV1: 'unused.board',
        taskBoardReadHumanV1: 'unused.task',
        taskBoardSourceReadV1: 'unused.source',
        taskBoardHealthReadV1: 'unused.health',
        taskBoardPolicyReadV1: 'unused.policy',
      },
      boardService: { principalId: newUuidV7() },
    };
    const rawTrust = JSON.stringify(trust);
    coreEnv = {
      NODE_ENV: 'production',
      ZHIJU_MVP_INSTANCE_ID: fixture.instanceId,
      ZHIJU_MVP_DATABASE_URL: fixture.databaseUrl,
      ZHIJU_MVP_STORE_ROOT: fixture.storeRoot,
      ZHIJU_MVP_STORE_ID: fixture.storeId,
      ZHIJU_MVP_STORE_IDENTITY: fixture.store.identity.storeIdentity,
      ZHIJU_MVP_CURSOR_KEY: '55'.repeat(32),
      ZHIJU_MVP_TRUST_CONFIG: rawTrust,
      ZHIJU_MVP_CORE_HOST: '127.0.0.1',
      ZHIJU_MVP_CORE_PORT: String(corePort),
    };
    core = await startChild({
      name: 'mvp-core',
      entry: coreEntry,
      env: coreEnv,
      readyUrl: `${coreOrigin}/api/mvp/v1/session`,
    });
    bff = await startChild({
      name: 'mvp-bff',
      entry: bffEntry,
      env: {
        NODE_ENV: 'production',
        PORT: String(bffPort),
        ZHIJU_WORKSPACE_TRUST_CONFIG: rawTrust,
        ZHIJU_MVP_CLIENT_SECRET: CLIENT_SECRET,
        ZHIJU_BFF_MVP_CORE_URL: coreOrigin,
      },
      readyUrl: `${bffOrigin}/bff/health`,
    });
    web = await startWeb(webPort, bffOrigin);
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
  }, 180_000);

  afterAll(async () => {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await web?.stop().catch(() => undefined);
    await bff?.stop().catch(() => undefined);
    await core?.stop().catch(() => undefined);
    await provider.stop().catch(() => undefined);
  }, 60_000);

  it('logs in, creates a real project and reads a mixed custody manifest in the built browser', async () => {
    if (page === undefined) throw new Error('browser page missing');
    await page.goto(`${webOrigin}/custody`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '需要登录' })).toBeVisible();
    await page.getByRole('link', { name: '使用企业账号登录' }).click();
    await page.waitForURL(`${webOrigin}/custody`, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: '项目与资料托管' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('MVP 操作者')).toBeVisible();

    await page.getByLabel('客户名称').fill('浏览器客户');
    await page.getByLabel('项目标题').fill('浏览器托管项目');
    await expect(page.getByRole('button', { name: '创建项目' })).toBeEnabled();
    await page.getByRole('button', { name: '创建项目' }).click();
    await expect(page.getByRole('heading', { name: '浏览器托管项目' })).toBeVisible({
      timeout: 30_000,
    });

    const packageBytes = zipBytes([
      { name: 'readme.md', bytes: markdownBytes('# 浏览器资料') },
      { name: 'empty.md', bytes: Buffer.alloc(0) },
      { name: 'spec.docx', bytes: docxBytes() },
      { name: 'sheet.xlsx', bytes: xlsxBytes() },
      { name: 'paper.pdf', bytes: textBytes('%PDF-1.7') },
    ]);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'browser-materials.zip',
      mimeType: 'application/zip',
      buffer: packageBytes,
    });
    await expect(page.getByRole('button', { name: '登记并上传' })).toBeEnabled({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: '登记并上传' }).click();
    await expect(page.getByRole('heading', { name: /部分接收/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText(/已封存清单：共 5 项/)).toBeVisible();
    await expect(page.getByText(/可分析来源 4 项/)).toBeVisible();
    await expect(page.getByText('readme.md')).toBeVisible();
    await expect(page.getByText('empty.md')).toBeVisible();
    await expect(page.getByText('sheet.xlsx')).toBeVisible();
    await expect(page.getByText(/UNSUPPORTED_MEDIA_TYPE/).first()).toBeVisible();

    const emptyDownloadPromise = page.waitForEvent('download');
    await page
      .getByRole('row', { name: /empty\.md/ })
      .getByRole('button', { name: '下载' })
      .click();
    const emptyDownload = await emptyDownloadPromise;
    const emptyPath = await emptyDownload.path();
    vitestExpect(readFileSync(emptyPath).length).toBe(0);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载原包' }).click();
    const download = await downloadPromise;
    const path = await download.path();
    vitestExpect(readFileSync(path).equals(packageBytes)).toBe(true);

    const supplementBytes = zipBytes([
      { name: 'supplement.md', bytes: markdownBytes('# 补充资料') },
    ]);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'supplement.zip',
      mimeType: 'application/zip',
      buffer: supplementBytes,
    });
    await expect(page.getByText(/supplement\.zip.*SHA-256/u)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: '登记并上传' })).toBeEnabled({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: '登记并上传' }).click();
    await expect(page.getByRole('heading', { name: /批次 2/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText(/已封存清单：共 1 项/)).toBeVisible();
    await expect(page.getByText('supplement.md')).toBeVisible();

    const recoveredBytes = zipBytes([{ name: 'recovered.md', bytes: markdownBytes('# 恢复资料') }]);
    let dropped = false;
    const commitState: { promise: Promise<Response> | null } = { promise: null };
    const batchRoute = '**/bff/mvp/v1/projects/*/batches/*';
    await page.route(batchRoute, async (route) => {
      const request = route.request();
      const contentType = request.headers()['content-type'] ?? '';
      if (!dropped && request.method() === 'PUT' && contentType.includes('application/json')) {
        dropped = true;
        const headers = { ...request.headers() };
        delete headers.host;
        delete headers['content-length'];
        const body = request.postData();
        commitState.promise = fetch(request.url(), {
          method: request.method(),
          headers,
          ...(body === null ? {} : { body }),
        });
        await route.abort('failed');
        const committed = await commitState.promise;
        if (!committed.ok) throw new Error(`server did not commit: ${committed.status}`);
        return;
      }
      await route.continue();
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: 'recovered.zip',
      mimeType: 'application/zip',
      buffer: recoveredBytes,
    });
    await expect(page.getByText(/recovered\.zip.*SHA-256/u)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '登记并上传' }).click();
    await expect(page.getByRole('heading', { name: '存在未确认的原请求' })).toBeVisible({
      timeout: 30_000,
    });
    if (commitState.promise === null) throw new Error('create request was not intercepted');
    const committed = await commitState.promise;
    if (!committed.ok) throw new Error(`server did not commit: ${committed.status}`);
    await page.unroute(batchRoute);
    await page.getByRole('button', { name: '登记并上传' }).evaluate((button) => {
      (button as unknown as { click: () => void }).click();
    });
    await expect(page.getByRole('heading', { name: /批次 3/ })).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText('recovered.md')).toBeVisible();

    const project = new URL(page.url()).pathname;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '浏览器托管项目' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: /第 1 批/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /第 2 批/ })).toBeVisible();
    await page.getByRole('button', { name: /第 1 批/ }).click();
    await expect(page.getByText(/已封存清单：共 5 项/)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /第 2 批/ }).click();
    await expect(page.getByText(/已封存清单：共 1 项/)).toBeVisible({ timeout: 30_000 });

    await core?.stop().catch(() => undefined);
    core = await startChild({
      name: 'mvp-core-restart',
      entry: coreEntry,
      env: coreEnv,
      readyUrl: `${coreOrigin}/api/mvp/v1/session`,
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: '浏览器托管项目' })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: /第 1 批/ }).click();
    await expect(page.getByText(/已封存清单：共 5 项/)).toBeVisible({ timeout: 30_000 });
    vitestExpect(project).toMatch(/^\/custody\/projects\//u);
  }, 120_000);
});
