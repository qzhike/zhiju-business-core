// IM-UI-01 (#266): the built-artifact Chromium acceptance journey.
//
// This case composes the *same* real stack as the trusted HTTP journey (real
// Core workspace runtime, real BFF, real synthetic OIDC provider over HTTP, and
// real disposable PostgreSQL with the provisioned linked ACTIVE Human, its
// discovery/board grants and the readable Project Board projection), and then
// puts the *built* production SPA in front of it: `apps/workspace-web/dist` is
// served by `tools/serve.mjs` with `NODE_ENV=production` and `/bff/*` is
// reverse-proxied to the BFF, which is the deployed single-origin shape.
//
// The deployment document consequently declares the artifact server as the
// public origin (the browser never reaches the BFF directly) and allowlists
// both hosts: the front origin plus the upstream BFF address that the proxy
// rewrites the proxied request Host to. Both synthetic processes receive the
// exact same serialized document, so their derived trust-config hashes match.
//
// Module-Spec-UI01 §258 and Module-Test UI-258-007/012 define what the journey
// must show: the anonymous workbench entry with no fabricated cards or tasks,
// the real OIDC redirect back to the app, the authorized directory card of the
// provisioned Project, its EP board rows, the honest unavailable TE board, and
// no anonymous-fixture marker, token, subject or secret anywhere in the DOM.
//
// The sibling HTTP case keeps its `startStack()` private to its own module, so
// this journey rebuilds the same stack from the shared `./trusted-http-fixtures.js`
// fixtures plus the same real entry points; the only difference is the public
// origin (the built artifact server) described above.

import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { provisionMarkdownReview, type MarkdownFixture } from './markdown-review-fixtures.js';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NestFactory } from '../../apps/api/node_modules/@nestjs/core/index.js';
import { FastifyAdapter } from '../../apps/api/node_modules/@nestjs/platform-fastify/index.js';
import fastify from '../../apps/api/node_modules/fastify/fastify.js';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Request as BrowserRequest,
} from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/api/src/app.module.js';
import {
  WORKSPACE_BODY_LIMIT_BYTES,
  registerWorkspaceTransport,
} from '../../apps/api/src/workspace/controller.js';
import { createWorkspaceCoreFromEnv } from '../../apps/api/src/workspace/server.js';
import { createBff } from '../../apps/workspace-bff/src/app.js';
import { FakeOidcProvider } from '../../apps/workspace-bff/src/testing/fake-oidc.js';
import { newUuidV7 } from '@zhiju/shared-kernel';

import {
  API_AUDIENCE,
  AZP,
  CLIENT_ID,
  CLIENT_SECRET,
  CLIENT_SECRET_ENV,
  ISSUER_REALM_PATH,
  SUBJECT_EXTERNAL_ID,
  buildTrustDocument,
  provisionTrustedWorkspace,
  reserveLoopbackPort,
  type ProvisionedWorkspace,
} from './trusted-http-fixtures.js';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const LOOKUP_KEY_HEX = '11'.repeat(32);
const FIELD_KEY_HEX = '22'.repeat(32);
const CURSOR_KEY_HEX = '33'.repeat(32);

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const webDist = join('apps', 'workspace-web', 'dist');
const webServerEntry = join('apps', 'workspace-web', 'tools', 'serve.mjs');
/** `tools/build-fixture.mjs` drops this marker into a development fixture dist. */
const fixtureArtifactMarker = 'fixture-build.json';
const screenshotDirectory = resolve(repositoryRoot, 'test-results');
const screenshotPath = join(screenshotDirectory, 'wi266-built-browser.png');

const VIEWPORT = { width: 1440, height: 900 } as const;
const DIRECTORY_PATH = '/bff/queries/project.find_workspace_projects/1.0';
/** Distinctive strings that only the development anonymous fixture shell renders. */
const FIXTURE_MARKERS = ['DEMO-PROJECT-01', '演示'] as const;
const SESSION_COOKIE = '__Host-zhiju_session';
/** Upper bound on the whole teardown so a stuck close cannot wedge the suite. */
const TEARDOWN_TIMEOUT_MS = 30_000;

interface ArtifactServer {
  readonly origin: string;
  readonly stop: () => Promise<void>;
}

interface BuiltBrowserStack {
  readonly markdown?: MarkdownFixture;
  readonly provider: FakeOidcProvider;
  readonly workspace: ProvisionedWorkspace;
  /** The browser-facing origin of the built SPA artifact server. */
  readonly webOrigin: string;
  readonly bffOrigin: string;
  readonly coreOrigin: string;
  readonly stop: () => Promise<void>;
}

/**
 * The served SPA must be the production trusted artifact. A missing dist is
 * built once through the workspace build script; a development fixture dist
 * (`fixture-build.json`, which `tools/serve.mjs` refuses to serve outside
 * `NODE_ENV=development`) is rebuilt through the same production build instead
 * of being served, and the test still fails loudly if the marker survives.
 */
function ensureBuiltArtifacts(): void {
  const dist = resolve(repositoryRoot, webDist);
  const fixture = existsSync(join(dist, fixtureArtifactMarker));
  if (!fixture && existsSync(join(dist, 'index.html'))) return;
  execFileSync('pnpm', ['--filter', '@zhiju/workspace-web', 'build'], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
  if (existsSync(join(dist, fixtureArtifactMarker))) {
    throw new Error(
      `${webDist} still carries ${fixtureArtifactMarker} after the production build; ` +
        '#266 requires the production trusted artifact (pnpm --filter @zhiju/workspace-web build).',
    );
  }
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error(`building ${webDist} produced no index.html`);
  }
}

/** One bounded retry gap while the artifact server binds its loopback socket. */
function nextAttempt(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  setTimeout(() => {
    resolve(undefined);
  }, 100);
  return promise;
}

/** Starts the real artifact server on a reserved loopback port and waits for it. */
async function startArtifactServer(input: {
  readonly port: number;
  readonly bffOrigin: string;
}): Promise<ArtifactServer> {
  ensureBuiltArtifacts();
  const child = spawn(process.execPath, [resolve(repositoryRoot, webServerEntry)], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(input.port),
      BFF_URL: input.bffOrigin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  const lifecycle: { exited: number | null } = { exited: null };
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
  child.on('exit', (code) => {
    lifecycle.exited = code;
  });

  const origin = `http://127.0.0.1:${input.port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (lifecycle.exited !== null) {
      throw new Error(
        `${webServerEntry} exited with ${lifecycle.exited} before serving ${origin}: ` +
          output.join('').trim(),
      );
    }
    // `tools/serve.mjs` only answers index.html for a text/html navigation.
    const serving = await fetch(`${origin}/workbench`, { headers: { accept: 'text/html' } })
      .then((response) => response.status === 200)
      .catch(() => false);
    if (serving) break;
    if (Date.now() > deadline) {
      child.kill('SIGTERM');
      throw new Error(
        `${webServerEntry} did not serve ${origin}/workbench within 20s: ` + output.join('').trim(),
      );
    }
    // The child binds a real socket and exposes no readiness event, so the only
    // way to observe "listening" is to retry the real request; there is no
    // controllable clock for another process's bind.
    await nextAttempt();
  }

  return {
    origin,
    stop: async () => {
      if (lifecycle.exited !== null) return;
      const stopped = Promise.withResolvers<undefined>();
      child.on('exit', () => {
        stopped.resolve(undefined);
      });
      child.kill('SIGTERM');
      await stopped.promise;
    },
  };
}

async function startBuiltStack(withMarkdown = false): Promise<BuiltBrowserStack> {
  if (databaseUrl === undefined) {
    throw new Error('ZJU_PERSISTENCE_DATABASE_URL is required for the built-artifact journey');
  }
  const provider = new FakeOidcProvider({
    clock: () => Date.now(),
    clientId: CLIENT_ID,
    apiAudience: API_AUDIENCE,
    azp: AZP,
    sub: SUBJECT_EXTERNAL_ID,
  });
  await provider.start();
  // A realm-path issuer satisfies the Core trust loader's issuer binding while
  // staying byte-identical to the discovery document the provider serves.
  provider.issuer = `${provider.baseUrl}${ISSUER_REALM_PATH}`;

  const webPort = await reserveLoopbackPort();
  const corePort = await reserveLoopbackPort();
  const bffPort = await reserveLoopbackPort();
  const webOrigin = `http://127.0.0.1:${webPort}`;
  const coreOrigin = `http://127.0.0.1:${corePort}`;
  const bffOrigin = `http://127.0.0.1:${bffPort}`;

  // The closed document with the built artifact server as the public origin.
  const document = {
    ...buildTrustDocument({
      bffPort,
      corePort,
      issuer: provider.issuer,
      discoveryUrl: provider.url('/.well-known/openid-configuration'),
      authorizeUrl: provider.url('/authorize'),
      tokenUrl: provider.url('/token'),
      jwksUrl: provider.url('/jwks'),
      endSessionUrl: provider.url('/logout'),
      revocationUrl: provider.url('/revoke'),
      boardServicePrincipalId: newUuidV7(),
    }),
    publicOrigin: webOrigin,
    allowedHosts: [`127.0.0.1:${webPort}`, `127.0.0.1:${bffPort}`],
    callbackUri: `${webOrigin}/bff/auth/callback`,
    postLogoutRedirectUri: `${webOrigin}/workbench`,
  };
  const rawDocument = JSON.stringify(document);

  const workspace = await provisionTrustedWorkspace({
    databaseUrl,
    lookupKey: Buffer.from(LOOKUP_KEY_HEX, 'hex'),
    fieldKey: Buffer.from(FIELD_KEY_HEX, 'hex'),
    issuer: provider.issuer,
  });
  const markdown = withMarkdown
    ? await provisionMarkdownReview({
        databaseUrl,
        workspace,
        lookupKey: Buffer.from(LOOKUP_KEY_HEX, 'hex'),
        fieldKey: Buffer.from(FIELD_KEY_HEX, 'hex'),
      })
    : undefined;

  // The real Core workspace runtime; no Task Board policy is deployed, so the
  // Task Board read fails closed with 503 instead of inventing a page.
  const runtime = createWorkspaceCoreFromEnv(
    {
      ZHIJU_WORKSPACE_TRUST_CONFIG: rawDocument,
      ZHIJU_WORKSPACE_DATABASE_URL: databaseUrl,
      ZHIJU_WORKSPACE_IDENTITY_LOOKUP_KEY: LOOKUP_KEY_HEX,
      ZHIJU_WORKSPACE_IDENTITY_FIELD_KEY: FIELD_KEY_HEX,
      ZHIJU_WORKSPACE_BOARD_CURSOR_KEY: CURSOR_KEY_HEX,
      ZHIJU_WORKSPACE_BOARD_POLICY_REFS: '{}',
    },
    markdown ? { markdown } : {},
  );
  const server = fastify({ logger: false, bodyLimit: WORKSPACE_BODY_LIMIT_BYTES });
  const adapter = new FastifyAdapter(server);
  const coreApp = await NestFactory.create(AppModule.register(runtime), adapter, { logger: false });
  registerWorkspaceTransport(server, runtime);
  await coreApp.listen(corePort, '127.0.0.1');

  // The real BFF composition entry, sharing the exact same trust document.
  const bffApp = await createBff({
    env: {
      ZHIJU_WORKSPACE_TRUST_CONFIG: rawDocument,
      [CLIENT_SECRET_ENV]: CLIENT_SECRET,
    },
  });
  await bffApp.listen(bffPort, '127.0.0.1');

  const artifactServer = await startArtifactServer({ port: webPort, bffOrigin });

  console.log(
    `built-browser stack: web=${artifactServer.origin} bff=${bffOrigin} core=${coreOrigin}/api ` +
      `issuer=${provider.issuer} dist=${webDist}`,
  );

  return {
    provider,
    workspace,
    ...(markdown ? { markdown } : {}),
    webOrigin: artifactServer.origin,
    bffOrigin,
    coreOrigin,
    stop: async () => {
      await artifactServer.stop();
      await bffApp.close();
      await coreApp.close();
      await markdown?.close();
      await workspace.close();
      await provider.stop();
    },
  };
}

describe.skipIf(!databaseUrl)(
  'workspace built-artifact browser journey #266 (real processes)',
  () => {
    let stack: BuiltBrowserStack;
    let browser: Browser;
    let context: BrowserContext;
    let page: Page;
    /**
     * Teardown is registered as each real resource comes up, newest first, so a
     * startup failure (for example a missing Chromium executable) never leaves a
     * created browser or stack running and never closes an uncreated context.
     */
    const teardown: (() => Promise<unknown>)[] = [];

    beforeAll(async () => {
      stack = await startBuiltStack();
      teardown.push(() => stack.stop());
      browser = await chromium.launch({ headless: true });
      teardown.push(() => browser.close());
      context = await browser.newContext({ viewport: { ...VIEWPORT } });
      teardown.push(() => context.close());
      page = await context.newPage();
    }, 180_000);

    // The vitest hook timeout bounds the whole cleanup, so no wall-clock timer is
    // needed here; each step is attempted even when an earlier one throws.
    afterAll(async () => {
      for (const step of teardown.reverse()) {
        try {
          await step();
        } catch {
          // A failing cleanup must not mask the journey failure or skip the rest.
        }
      }
    }, TEARDOWN_TIMEOUT_MS);

    it('completes login -> directory -> selected-project board against the built artifact', async () => {
      // The real directory read is held open once so the honest LOADING state can
      // be observed deterministically instead of racing a loopback response. The
      // request itself is the genuine one; only its answer is delayed.
      const released = Promise.withResolvers<undefined>();
      await page.route(
        (url) => url.origin === stack.webOrigin && url.pathname === DIRECTORY_PATH,
        async (route) => {
          await released.promise;
          await route.continue();
        },
      );

      // 1. Anonymous workbench: the sign-in entry, no fabricated cards or tasks.
      await page.goto(`${stack.webOrigin}/workbench`);
      const signIn = page.getByRole('link', { name: '使用企业账号登录' });
      await signIn.waitFor({ state: 'visible' });
      expect(await signIn.getAttribute('href')).toBe('/bff/auth/login?returnTo=%2Fworkbench');
      await page.getByRole('heading', { name: '需要登录' }).waitFor({ state: 'visible' });
      expect(await page.locator('article.work-item').count()).toBe(0);
      expect(await page.locator('ul.progress-list').count()).toBe(0);
      const anonymousHtml = await page.content();
      for (const marker of FIXTURE_MARKERS) expect(anonymousHtml).not.toContain(marker);

      // 2. The real OIDC redirect (login -> provider -> callback -> app) returns to
      //    the workbench with a live session, and the directory read is LOADING
      //    while it is still unanswered: no placeholder card is ever shown. The
      //    proxied hop chain is captured so a stalled redirect reports its own
      //    evidence: a /bff response that loses its status or `Location` header is
      //    otherwise an opaque blank page.
      const hops: string[] = [];
      page.on('response', (response) => {
        hops.push(`${response.status()} ${new URL(response.url()).pathname}`);
      });
      await signIn.click();
      try {
        await page
          .getByRole('heading', { name: '正在读取授权项目目录' })
          .waitFor({ state: 'visible', timeout: 30_000 });
      } catch (error) {
        const body = (await page.locator('body').innerText()).slice(0, 300);
        throw new Error(
          `the sign-in journey never reached the live directory (url=${page.url()} ` +
            `hops=[${hops.join(', ')}] body=${JSON.stringify(body)})`,
          { cause: error },
        );
      }
      expect(await page.locator('article.work-item').count()).toBe(0);
      released.resolve(undefined);

      // 3. The authorized directory card, exactly as the real Core returns it.
      const card = page.locator('article.work-item');
      await card.waitFor({ state: 'visible', timeout: 30_000 });
      expect(await card.count()).toBe(1);
      // The compact workbench keeps exact references in a secondary disclosure.
      await card.getByText('项目引用', { exact: true }).click();
      const cardText = (await card.innerText()).replace(/\s+/gu, ' ');
      expect(cardText).toContain(
        `${stack.workspace.enterpriseDisplayName} · ${stack.workspace.projectTitle}`,
      );
      expect(cardText).toContain(stack.workspace.projectDisplayCode);
      expect(cardText).toContain(stack.workspace.projectId);
      // The owning Project status is ACTIVE, which the shell renders as 进行中;
      // its aggregate version is the owning row's version, not a client default.
      expect(cardText).toContain('进行中');
      expect(cardText).not.toContain('非进行中');
      expect(cardText).toContain('聚合版本 1');
      const directoryText = (
        await page
          .locator('section.panel', { has: page.getByRole('heading', { name: '授权项目' }) })
          .innerText()
      ).replace(/\s+/gu, ' ');
      expect(directoryText).toContain('已显示 1 个项目');

      // 4. Selecting the Project reads both boards in its exact scope: the EP rows
      //    are the owning projection rows, the TE board reports the honest
      //    unavailable state because no Board Policy is deployed. EMPTY is not
      //    reachable from these fixtures (they provision exactly one discoverable
      //    Project and one board item), so it is not asserted here.
      await card.getByRole('button', { name: '查看该项目看板' }).click();
      const boardSection = page.locator('section.panel', {
        has: page.getByRole('heading', { name: `项目看板 · ${stack.workspace.projectTitle}` }),
      });
      await boardSection
        .getByRole('heading', { name: '交付项看板（EP）', exact: true })
        .waitFor({ state: 'visible', timeout: 30_000 });
      const boardRows = boardSection.locator('ul.progress-list li');
      await boardRows.first().waitFor({ state: 'visible', timeout: 30_000 });
      expect(await boardRows.count()).toBe(1);
      const boardsText = (await boardSection.innerText()).replace(/\s+/gu, ' ');
      expect(boardsText).toContain('本次读取 1 条');
      expect(boardsText).toContain('Board Item');
      expect(boardsText).toContain('READY · APPROVED');
      expect(boardsText).toContain('观察点');
      expect(boardsText).toContain('当前观察');
      await page
        .getByText('该项目任务看板当前不可用', { exact: true })
        .waitFor({ state: 'visible', timeout: 30_000 });
      expect(boardsText).toContain('依赖服务暂不可用，未显示任何数据。');
      expect(boardsText).toContain('DEPENDENCY_UNAVAILABLE');

      // 5. The built shell never renders an anonymous fixture marker, a token, the
      //    client secret or the external subject in the document.
      const html = await page.content();
      for (const marker of FIXTURE_MARKERS) expect(html).not.toContain(marker);
      expect(html).not.toContain(CLIENT_SECRET);
      expect(html).not.toContain(SUBJECT_EXTERNAL_ID);
      expect(html).not.toContain(createHash('sha256').update(SUBJECT_EXTERNAL_ID).digest('hex'));
      expect(html).not.toContain('eyJ');
      expect(html).not.toContain('Bearer ');

      // The session cookie is host-prefixed, HttpOnly and carries no JWT material.
      const sessionCookie = (await context.cookies()).find(
        (cookie) => cookie.name === SESSION_COOKIE,
      );
      expect(sessionCookie?.httpOnly).toBe(true);
      expect(sessionCookie?.value).not.toContain('eyJ');

      // Evidence: the journey really exchanged an authorization code at the OIDC
      // provider, and the browser really is the installed Chromium build.
      const exchanges = stack.provider.tokenRequests.filter(
        (request) => request.grantType === 'authorization_code',
      );
      expect(exchanges).toHaveLength(1);
      console.log(
        `built-browser browser: ${browser.version()} ${VIEWPORT.width}x${VIEWPORT.height} headless`,
      );
      console.log(`built-browser directory card: ${cardText}`);
      console.log(`built-browser EP board rows: ${await boardRows.count()}`);
      console.log('built-browser TE board: DEPENDENCY_UNAVAILABLE (honest unavailable)');

      if (existsSync(screenshotDirectory)) {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`built-browser screenshot: ${screenshotPath}`);
      } else {
        console.log(`built-browser screenshot skipped: ${screenshotDirectory} does not exist`);
      }
    }, 120_000);
  },
);

describe.skipIf(!databaseUrl)('exact Markdown built browser journey #279', () => {
  let stack: BuiltBrowserStack;
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  beforeAll(async () => {
    stack = await startBuiltStack(true);
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
    page = await context.newPage();
  }, 180_000);
  afterAll(async () => {
    await context.close();
    await browser.close();
    await stack.stop();
  }, TEARDOWN_TIMEOUT_MS);
  it('opens the exact link, visits all 36 changes, searches 9 chapters and downloads identical registered bytes twice', async () => {
    const fixture = requiredValue(stack.markdown);
    const transportErrors: string[] = [];
    const downloadHeaders: Record<string, string>[] = [];
    page.on('response', (response) => {
      if (response.status() >= 400 || response.url().includes('markdown'))
        transportErrors.push(`${response.status()} ${new URL(response.url()).pathname}`);
      if (
        response.status() === 200 &&
        new URL(response.url()).pathname.startsWith('/api/markdown-representations/')
      )
        downloadHeaders.push(response.headers());
    });
    await page.goto(`${stack.webOrigin}${fixture.link}`);
    await page.getByRole('link', { name: '使用企业账号登录' }).click();
    try {
      await page
        .getByRole('heading', { name: '采购控制程序', exact: true })
        .waitFor({ timeout: 30_000 });
    } catch (error) {
      throw new Error(
        `Markdown entry failed: ${(await page.locator('body').innerText()).slice(0, 700)}; ${transportErrors.join(', ')}`,
        { cause: error },
      );
    }
    const directory = page.getByRole('complementary', { name: '变化目录' });
    expect(await directory.locator('details').count()).toBe(9);
    expect(await directory.innerText()).toContain('36');
    const note = page.getByRole('textbox', { name: '意见草稿' });
    await note.fill('核对采购凭证；这是未提交的本页记录。');
    const directoryUrl = new URL(
      '/bff/queries/artifact.get_file_change_directory/1.0',
      stack.webOrigin,
    );
    let failOneContinuation = true;
    const failFirstContinuation = (url: URL) =>
      url.origin === stack.webOrigin && url.pathname === directoryUrl.pathname;
    await page.route(failFirstContinuation, async (route) => {
      const envelope = JSON.parse(route.request().postData() ?? '{}') as {
        payload?: { page?: { cursor?: unknown } };
      };
      if (envelope.payload?.page?.cursor && failOneContinuation) {
        failOneContinuation = false;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: { code: 'DEPENDENCY_UNAVAILABLE', retryable: true, correlationId: null },
          }),
        });
        return;
      }
      await route.continue();
    });
    const loadedCount = async () => {
      const text = await directory.locator(':scope > small').innerText();
      const match = /已加载 (\d+) \/ 36/u.exec(text);
      return match ? Number(match[1]) : 0;
    };
    const waitForPageChange = async (prior: number) =>
      expect.poll(loadedCount, { timeout: 5_000 }).toBeGreaterThan(prior);
    const firstPage = await loadedCount();
    await page.getByRole('button', { name: '继续加载变化', exact: true }).click();
    const paginationStatus = directory.getByRole('status');
    await paginationStatus.waitFor({ state: 'visible' });
    expect(await paginationStatus.innerText()).toContain('意见草稿已保留');
    expect(await note.inputValue()).toContain('未提交');
    expect(await page.getByRole('heading', { name: '采购控制程序', exact: true }).isVisible()).toBe(
      true,
    );
    await page.unroute(failFirstContinuation);
    await page.getByRole('button', { name: '重试加载变化', exact: true }).click();
    await waitForPageChange(firstPage);
    while (await page.getByRole('button', { name: '继续加载变化', exact: true }).count()) {
      const prior = await loadedCount();
      await page.getByRole('button', { name: '继续加载变化', exact: true }).click();
      await waitForPageChange(prior);
    }
    expect(await loadedCount()).toBe(36);
    for (let n = 1; n <= 36; n++) {
      expect(await page.locator('.markdown-change').innerText()).toContain(`第 ${n} / 36 处`);
      expect(await page.locator('.markdown-after').innerText()).toContain('更新要求');
      if (n < 36) await page.getByRole('button', { name: '下一处变化' }).click();
    }
    expect(await note.inputValue()).toContain('未提交');
    await page.getByRole('searchbox', { name: '搜索章节' }).fill('5 采购');
    expect(await directory.locator('details').count()).toBe(1);
    await directory.locator('details button').first().click();
    expect(await page.locator('.markdown-change').innerText()).toContain('第 17 / 36 处');
    await page.getByRole('searchbox', { name: '搜索章节' }).fill('');
    await page.getByRole('button', { name: '查看全文' }).click();
    const table = page.getByRole('region', { name: '完整表格，可横向滚动' });
    expect(await table.locator('th').count()).toBe(12);
    expect(await table.locator('tbody tr').first().locator('td').count()).toBe(12);
    expect(await table.locator('td').nth(0).innerText()).toBe('0');
    expect(await table.locator('td').nth(1).innerText()).toBe('');
    expect(await table.locator('td').last().innerText()).toBe('最后一列完整');
    expect(await page.getByRole('button', { name: '提交并修改 · 暂不可用' }).isDisabled()).toBe(
      true,
    );
    await page.screenshot({
      path: join(screenshotDirectory, 'wi279-markdown-review.png'),
      fullPage: true,
    });
    const bytes: Buffer[] = [];
    const streamPath = `/api/markdown-representations/${fixture.representationRef.representationId}/content`;
    const streamUrl = (url: URL) => url.origin === stack.webOrigin && url.pathname === streamPath;
    await page.route(streamUrl, async (route) => {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    await page.getByRole('button', { name: '下载 Markdown', exact: true }).click();
    await expect
      .poll(async () => (await page.locator('.markdown-download-status').textContent()) ?? '')
      .toContain('精确版本仍可读取');
    expect(await note.inputValue()).toContain('未提交');
    expect(await page.getByRole('heading', { name: '采购控制程序', exact: true }).isVisible()).toBe(
      true,
    );
    await page.unroute(streamUrl);
    for (let n = 0; n < 2; n++) {
      const downloaded = page.waitForEvent('download');
      await page.getByRole('button', { name: '下载 Markdown', exact: true }).click();
      const download = await downloaded.catch(async (cause: unknown) => {
        throw new Error(
          `Markdown download failed: ${(await page.locator('body').innerText()).slice(-900)}; ${transportErrors.join(', ')}`,
          { cause },
        );
      });
      expect(download.suggestedFilename()).toMatch(/^document-[a-f0-9-]+\.md$/u);
      const path = await download.path();
      if (!path) throw new Error('Download file missing');
      bytes.push(readFileSync(path));
    }
    expect(bytes[0]).toEqual(bytes[1]);
    expect(downloadHeaders).toHaveLength(2);
    for (const headers of downloadHeaders) {
      expect(headers['cache-control']).toContain('no-store');
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['content-type']).toBe('text/markdown; charset=utf-8');
      expect(headers['content-disposition']).toMatch(
        /^attachment; filename="document-[a-f0-9-]+\.md"$/u,
      );
    }
    expect(createHash('sha256').update(requiredValue(bytes[0])).digest('hex')).toBe(
      fixture.representationRef.checksum.digest,
    );
    expect(await note.inputValue()).toContain('未提交');
    const html = await page.content();
    expect(html).not.toContain(SUBJECT_EXTERNAL_ID);
    expect(html).not.toContain(CLIENT_SECRET);
    expect(html).not.toContain('downloadTicket');
    await page.setViewportSize({ width: 390, height: 844 });
    const downloadBounds = requiredValue(
      await page.getByRole('button', { name: '下载 Markdown', exact: true }).boundingBox(),
    );
    const tabBounds = requiredValue(
      await page.getByRole('button', { name: '阅读文件', exact: true }).boundingBox(),
    );
    expect(downloadBounds.y + downloadBounds.height).toBeLessThanOrEqual(tabBounds.y);
    await page.getByRole('button', { name: '本文件意见', exact: true }).click();
    expect(await note.isVisible()).toBe(true);
    expect(await note.inputValue()).toContain('未提交');
    await page.screenshot({
      path: join(screenshotDirectory, 'wi279-markdown-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize(VIEWPORT);
    await note.fill('');
  }, 120_000);
  it('clears the comparison when only the baseline is denied and recovers only on explicit retry', async () => {
    const fixture = requiredValue(stack.markdown);
    const contentPath = '/bff/queries/artifact.get_file_review_content/1.0';
    const directoryPath = '/bff/queries/artifact.get_file_change_directory/1.0';
    const contentUrl = (url: URL) => url.origin === stack.webOrigin && url.pathname === contentPath;
    const directoryUrl = (url: URL) =>
      url.origin === stack.webOrigin && url.pathname === directoryPath;
    let denyBaseline = false;
    const probes: string[] = [];
    const requests = { session: 0, content: 0, directory: 0 };
    const track = (request: BrowserRequest) => {
      const path = new URL(request.url()).pathname;
      if (path === '/bff/session') requests.session += 1;
      if (path === contentPath) requests.content += 1;
      if (path === directoryPath) requests.directory += 1;
    };
    page.on('request', track);
    await page.route(contentUrl, async (route) => {
      const envelope = JSON.parse(route.request().postData() ?? '{}') as {
        payload: { revisionRef: { objectId: string } };
      };
      if (denyBaseline) probes.push(envelope.payload.revisionRef.objectId);
      if (
        denyBaseline &&
        envelope.payload.revisionRef.objectId === fixture.from.revisionRef.objectId
      ) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      } else {
        await route.continue();
      }
    });
    try {
      await page.goto(`${stack.webOrigin}${fixture.link}`);
      await page.getByRole('heading', { name: '采购控制程序', exact: true }).waitFor();
      const note = page.getByRole('textbox', { name: '意见草稿' });
      await note.fill('基线失权后必须清除的本页意见。');
      expect(await page.locator('.markdown-before').innerText()).toContain('原有要求');
      denyBaseline = true;
      await page.route(directoryUrl, async (route) => {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      });
      await page.getByRole('button', { name: '继续加载变化', exact: true }).click();
      const retry = page.getByRole('button', { name: '重新读取文件', exact: true });
      await retry.waitFor();
      await note.waitFor({ state: 'detached' });
      expect(probes).toEqual([fixture.to.revisionRef.objectId, fixture.from.revisionRef.objectId]);
      const body = await page.locator('body').innerText();
      expect(body).not.toContain('原有要求');
      expect(body).not.toContain('更新要求');
      expect(body).not.toContain('基线失权后必须清除');
      const stopped = { ...requests };
      await page.waitForTimeout(500);
      expect(requests).toEqual(stopped);
      await retry.click();
      await expect.poll(() => probes.length).toBe(4);
      await retry.waitFor();
      expect(probes).toEqual([
        fixture.to.revisionRef.objectId,
        fixture.from.revisionRef.objectId,
        fixture.to.revisionRef.objectId,
        fixture.from.revisionRef.objectId,
      ]);
      const retried = { ...requests };
      await page.waitForTimeout(500);
      expect(requests).toEqual(retried);
      denyBaseline = false;
      await page.unroute(directoryUrl);
      await retry.click();
      await page.getByRole('heading', { name: '采购控制程序', exact: true }).waitFor();
      expect(await page.getByRole('textbox', { name: '意见草稿' }).inputValue()).toBe('');
    } finally {
      page.off('request', track);
      await page.unroute(contentUrl);
      await page.unroute(directoryUrl);
    }
  }, 30_000);
  it.each([401, 403, 404])(
    'stops persistent %i reads with the same ALLOWED session until explicit retry',
    async (status) => {
      const fixture = requiredValue(stack.markdown);
      const contentPath = '/bff/queries/artifact.get_file_review_content/1.0';
      const contentUrl = (url: URL) =>
        url.origin === stack.webOrigin && url.pathname === contentPath;
      const readSession = () =>
        page.evaluate(async () => {
          const session = (await (await fetch('/bff/session', { cache: 'no-store' })).json()) as {
            accessState: string;
            sessionGeneration: string;
          };
          return { accessState: session.accessState, sessionGeneration: session.sessionGeneration };
        });
      const before = await readSession();
      expect(before.accessState).toBe('ALLOWED');
      const requests = { session: 0, content: 0 };
      const track = (request: BrowserRequest) => {
        const path = new URL(request.url()).pathname;
        if (path === '/bff/session') requests.session += 1;
        if (path === contentPath) requests.content += 1;
      };
      page.on('request', track);
      await page.route(contentUrl, async (route) => {
        await route.fulfill({ status, contentType: 'application/json', body: '{}' });
      });
      try {
        await page.goto(`${stack.webOrigin}${fixture.link}`);
        const retry = page.getByRole('button', {
          name: status === 401 ? '重新检查会话' : '重新读取文件',
          exact: true,
        });
        await retry.waitFor();
        expect(await page.locator('.canonical-document').count()).toBe(0);
        expect(await page.getByRole('textbox', { name: '意见草稿' }).count()).toBe(0);
        expect(await readSession()).toEqual(before);
        expect(requests.content).toBe(1);
        const stopped = { ...requests };
        await page.waitForTimeout(500);
        expect(requests).toEqual(stopped);
        await retry.click();
        await expect.poll(() => requests.content).toBe(2);
        await retry.waitFor();
        const retried = { ...requests };
        await page.waitForTimeout(500);
        expect(requests).toEqual(retried);
        await page.unroute(contentUrl);
        await retry.click();
        await page.getByRole('heading', { name: '采购控制程序', exact: true }).waitFor();
      } finally {
        page.off('request', track);
        await page.unroute(contentUrl);
      }
    },
    30_000,
  );
  it('refuses cross-scope and unregistered Service routes, and clears content after permission revocation', async () => {
    const fixture = requiredValue(stack.markdown);
    const results = await page.evaluate(
      async ({ projectId, revisionRef }) => {
        const session = (await (await fetch('/bff/session', { cache: 'no-store' })).json()) as {
          csrfToken: string;
        };
        const headers = { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
        const scope = { ...revisionRef.scope, projectId };
        const read = await fetch('/bff/queries/artifact.get_file_review_content/1.0', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            queryId: '019aaa00-0000-7000-8000-000000000279',
            type: 'artifact.get_file_review_content',
            version: '1.0',
            scopeRef: scope,
            consistencyRequirement: 'AUTHORITATIVE',
            correlationId: '019aaa00-0000-7000-8000-000000000280',
            requestedAt: new Date().toISOString(),
            payload: { revisionRef: { ...revisionRef, scope } },
          }),
        });
        const service = await fetch('/bff/commands/integration.request_markdown_render/1.0', {
          method: 'POST',
          headers,
          body: '{}',
        });
        return { read: read.status, service: service.status };
      },
      { projectId: newUuidV7(), revisionRef: fixture.to.revisionRef },
    );
    expect([403, 404]).toContain(results.read);
    expect([400, 404]).toContain(results.service);
    await page.goto(`${stack.webOrigin}${fixture.link}`);
    await page.getByRole('heading', { name: '采购控制程序', exact: true }).waitFor();
    const note = page.getByRole('textbox', { name: '意见草稿' });
    await note.fill('仅在本页保留，撤权后需要清除。');
    const streamPath = `/api/markdown-representations/${fixture.representationRef.representationId}/content`;
    const streamUrl = (url: URL) => url.origin === stack.webOrigin && url.pathname === streamPath;
    await page.route(streamUrl, async (route) => {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    await fixture.revoke('artifact.get_file_review_content');
    await page.getByRole('button', { name: '下载 Markdown', exact: true }).click();
    await page.getByRole('heading', { name: '文件检查', exact: true }).waitFor();
    await note.waitFor({ state: 'detached' });
    expect(await page.locator('body').innerText()).not.toContain('撤权后需要清除');
    expect(await page.locator('body').innerText()).not.toContain('更新要求');
    const session = await page.evaluate(
      async () =>
        (await (await fetch('/bff/session', { cache: 'no-store' })).json()) as {
          accessState: string;
        },
    );
    expect(session.accessState).toBe('ALLOWED');
    const requests = { session: 0, content: 0 };
    const track = (request: BrowserRequest) => {
      const path = new URL(request.url()).pathname;
      if (path === '/bff/session') requests.session += 1;
      if (path === '/bff/queries/artifact.get_file_review_content/1.0') requests.content += 1;
    };
    page.on('request', track);
    try {
      await page.waitForTimeout(500);
      expect(requests).toEqual({ session: 0, content: 0 });
      await page.getByRole('button', { name: '重新读取文件', exact: true }).click();
      await expect.poll(() => requests.content).toBe(1);
      await page.getByRole('button', { name: '重新读取文件', exact: true }).waitFor();
      await page.waitForTimeout(500);
      expect(requests).toEqual({ session: 0, content: 1 });
    } finally {
      page.off('request', track);
    }
    await page.unroute(streamUrl);
  }, 30_000);
});

function requiredValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Required Markdown binding is unavailable');
  return value;
}
