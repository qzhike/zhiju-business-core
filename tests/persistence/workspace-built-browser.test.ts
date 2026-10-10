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
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NestFactory } from '../../apps/api/node_modules/@nestjs/core/index.js';
import { FastifyAdapter } from '../../apps/api/node_modules/@nestjs/platform-fastify/index.js';
import fastify from '../../apps/api/node_modules/fastify/fastify.js';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
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

async function startBuiltStack(): Promise<BuiltBrowserStack> {
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

  // The real Core workspace runtime; no Task Board policy is deployed, so the
  // Task Board read fails closed with 503 instead of inventing a page.
  const runtime = createWorkspaceCoreFromEnv({
    ZHIJU_WORKSPACE_TRUST_CONFIG: rawDocument,
    ZHIJU_WORKSPACE_DATABASE_URL: databaseUrl,
    ZHIJU_WORKSPACE_IDENTITY_LOOKUP_KEY: LOOKUP_KEY_HEX,
    ZHIJU_WORKSPACE_IDENTITY_FIELD_KEY: FIELD_KEY_HEX,
    ZHIJU_WORKSPACE_BOARD_CURSOR_KEY: CURSOR_KEY_HEX,
    ZHIJU_WORKSPACE_BOARD_POLICY_REFS: '{}',
  });
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

  const workspace = await provisionTrustedWorkspace({
    databaseUrl,
    lookupKey: Buffer.from(LOOKUP_KEY_HEX, 'hex'),
    fieldKey: Buffer.from(FIELD_KEY_HEX, 'hex'),
    issuer: provider.issuer,
  });
  const artifactServer = await startArtifactServer({ port: webPort, bffOrigin });

  console.log(
    `built-browser stack: web=${artifactServer.origin} bff=${bffOrigin} core=${coreOrigin}/api ` +
      `issuer=${provider.issuer} dist=${webDist}`,
  );

  return {
    provider,
    workspace,
    webOrigin: artifactServer.origin,
    bffOrigin,
    coreOrigin,
    stop: async () => {
      await artifactServer.stop();
      await bffApp.close();
      await coreApp.close();
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
