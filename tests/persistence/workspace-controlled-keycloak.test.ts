// IM-UI-01 (#266): the required *controlled Keycloak* acceptance journey.
//
// Issue #266 / review finding R6 requires the trusted-Human entry to be proven
// against a real controlled Keycloak Authorization Code + PKCE journey — not
// only against the synthetic OIDC issuer the sibling cases use — together with
// the applicable denial, refresh and key-rotation evidence. Production
// installation and production credentials are explicitly out of scope; an
// isolated realm/client/user created only for this controlled test is not.
//
// This case therefore composes the same real stack as the built-artifact case
// (real Core workspace runtime, real BFF, real disposable PostgreSQL with the
// provisioned linked ACTIVE Human, its grants and its readable Project Board
// projection, and the *built* production SPA served with `/bff/*` reverse
// proxied) in front of a real `keycloak/keycloak:26.7.0` container started from
// the pinned digest. The realm, its confidential client, its audience client
// scope, its un-audienced second client, its one test user, its client
// secret/password and its signing key are generated at test time.
//
// The assertions are the journey plus four required denial/refresh/rotation
// cases. Every rejection is asserted *and* bounded to the owning boundary: the
// Core's owning dispatch is counted, so "reached no owning read" is an
// observed fact rather than an inference from the status code.

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

import { NestFactory } from '../../apps/api/node_modules/@nestjs/core/index.js';
import { FastifyAdapter } from '../../apps/api/node_modules/@nestjs/platform-fastify/index.js';
import fastify from '../../apps/api/node_modules/fastify/fastify.js';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';

import { AppModule } from '../../apps/api/src/app.module.js';
import {
  WORKSPACE_BODY_LIMIT_BYTES,
  registerWorkspaceTransport,
  type WorkspaceDispatchRequest,
  type WorkspaceDispatchResponse,
} from '../../apps/api/src/workspace/controller.js';
import { createWorkspaceCoreFromEnv } from '../../apps/api/src/workspace/server.js';
import { createBff } from '../../apps/workspace-bff/src/app.js';
import { LOGIN_COOKIE, SESSION_COOKIE } from '../../apps/workspace-bff/src/cookies.js';
import { newUuidV7 } from '@zhiju/shared-kernel';

import {
  CONTROLLED_ACCESS_TOKEN_LIFESPAN_SECONDS,
  CONTROLLED_KEYCLOAK_VERSION_TAG,
  CONTROLLED_REALM,
  CONTROLLED_USERNAME,
  FOREIGN_ISSUER_REALM,
  UNAUDIENCED_CLIENT_ID,
  removeAllControlledKeycloakContainers,
  startControlledKeycloak,
  type ControlledKeycloak,
} from './controlled-keycloak.js';
import { startBuiltWebArtifactServer, type BuiltWebArtifactServer } from './trusted-built-web.js';
import {
  API_AUDIENCE,
  AZP,
  CLIENT_ID,
  CLIENT_SECRET_ENV,
  SUBJECT_EXTERNAL_ID,
  buildTrustDocument,
  provisionTrustedWorkspace,
  reserveLoopbackPort,
  type ProvisionedWorkspace,
} from './trusted-http-fixtures.js';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const execFileAsync = promisify(execFile);

/**
 * The realm container's log tail, used only when the journey fails: the
 * controlled realm is the one surface whose internal behaviour is otherwise
 * unobservable from the test process.
 */
async function keycloakLogTail(containerName: string): Promise<string> {
  return execFileAsync('docker', ['logs', '--tail', '60', containerName], {
    maxBuffer: 8 * 1024 * 1024,
  })
    .then((result) => result.stdout)
    .catch(() => '<no container log>');
}
const LOOKUP_KEY_HEX = '11'.repeat(32);
const FIELD_KEY_HEX = '22'.repeat(32);
const CURSOR_KEY_HEX = '33'.repeat(32);

const VIEWPORT = { width: 1440, height: 900 } as const;
const DIRECTORY_PATH = '/bff/queries/project.find_workspace_projects/1.0';
const FIXTURE_MARKERS = ['DEMO-PROJECT-01', '演示'] as const;
/**
 * Short JWKS lifetime: the key-rotation case must resolve the retired `kid`
 * from the realm's *current* document rather than from the pre-rotation cache.
 */
const KEYCLOAK_JWKS_TTL_SECONDS = 5;
/**
 * The BFF refreshes once the access token is inside the clock skew. The realm
 * issues 300s tokens, so this advance leaves 20s — inside the 30s skew — while
 * staying far below the session's absolute lifetime.
 */
const REFRESH_CLOCK_ADVANCE_MS = 280_000;

interface ControlledStack {
  readonly keycloak: ControlledKeycloak;
  readonly workspace: ProvisionedWorkspace;
  readonly webOrigin: string;
  readonly bffOrigin: string;
  readonly coreOrigin: string;
  readonly trustConfigHash: string;
  readonly jwksTtlSeconds: number;
  /** Keycloak JWKS fetches performed by the Core's access-token verifier. */
  readonly jwksFetches: () => number;
  /** Requests the Core HTTP surface accepted from a trusted peer. */
  readonly coreRequests: () => number;
  /** Owning dispatch calls, i.e. reads that actually reached an owning module. */
  readonly owningDispatches: () => number;
  /** Access tokens the BFF presented to the Core, in order. */
  readonly coreAccessTokens: () => readonly string[];
  readonly advanceClock: (milliseconds: number) => void;
  readonly stop: () => Promise<void>;
}

let stack: ControlledStack | undefined;
let browser: Browser | undefined;
let browserContext: BrowserContext | undefined;
let browserPage: Page | undefined;

async function readJsonRecord(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`response body was not JSON (status ${response.status})`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`response body was not a JSON object (status ${response.status})`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * The closed directory Query envelope the built SPA sends; the direct Core
 * cases reuse it byte-for-byte so a rejection can only come from the token.
 */
function directoryQueryBody(): Record<string, unknown> {
  return {
    queryId: newUuidV7(),
    type: 'project.find_workspace_projects',
    version: '1.0',
    scopeRef: {},
    consistencyRequirement: 'AUTHORITATIVE',
    pagination: { pageSize: 50 },
    correlationId: newUuidV7(),
    requestedAt: new Date().toISOString(),
    payload: { page: { pageSize: 50 } },
    integrity: null,
  };
}

function decodeJwtSegment(token: string, index: 0 | 1): Record<string, unknown> {
  const segment = token.split('.')[index];
  if (segment === undefined) throw new Error('compact JWS is missing a segment');
  const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('compact JWS segment is not a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function audienceIncludesClaim(claims: Record<string, unknown>, audience: string): boolean {
  const value = claims.aud;
  if (typeof value === 'string') return value === audience;
  if (Array.isArray(value)) return value.includes(audience);
  return false;
}

/** The claims of an access token that is valid for every gate except the one under test. */
function accessTokenClaims(issuer: string): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    iss: issuer,
    sub: SUBJECT_EXTERNAL_ID,
    aud: API_AUDIENCE,
    azp: AZP,
    typ: 'Bearer',
    nbf: nowSeconds,
    iat: nowSeconds,
    exp: nowSeconds + CONTROLLED_ACCESS_TOKEN_LIFESPAN_SECONDS,
    jti: randomBytes(16).toString('hex'),
    sid: randomBytes(16).toString('hex'),
  };
}

function readSetCookieValue(response: Response, name: string): string | undefined {
  for (const header of response.headers.getSetCookie()) {
    const separator = header.indexOf('=');
    if (separator <= 0 || header.slice(0, separator) !== name) continue;
    const value = header.slice(separator + 1);
    const end = value.indexOf(';');
    return end === -1 ? value : value.slice(0, end);
  }
  return undefined;
}

/** Calls the Core exactly as the BFF does: Bearer token plus its two technical headers. */
async function callCoreDirectory(
  target: ControlledStack,
  accessToken: string,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const response = await fetch(
    `${target.coreOrigin}/api/queries/project.find_workspace_projects/1.0`,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
        'x-workspace-session-binding': randomBytes(32).toString('base64url'),
        'x-workspace-trust-config-hash': target.trustConfigHash,
      },
      body: JSON.stringify(directoryQueryBody()),
    },
  );
  return { status: response.status, body: await readJsonRecord(response) };
}

async function startControlledStack(): Promise<ControlledStack> {
  if (databaseUrl === undefined) {
    throw new Error(
      'ZJU_PERSISTENCE_DATABASE_URL is required for the controlled Keycloak acceptance case',
    );
  }
  const webPort = await reserveLoopbackPort();
  const corePort = await reserveLoopbackPort();
  const bffPort = await reserveLoopbackPort();
  const webOrigin = `http://127.0.0.1:${webPort}`;
  const coreOrigin = `http://127.0.0.1:${corePort}`;
  const bffOrigin = `http://127.0.0.1:${bffPort}`;

  // Fail on a missing/development artifact dist before any container starts.
  const keycloak = await startControlledKeycloak({
    redirectUri: `${webOrigin}/bff/auth/callback`,
    webOrigin,
  });

  const cleanups: (() => Promise<void> | void)[] = [keycloak.stop];
  const closeAll = async (): Promise<void> => {
    let failure: unknown;
    for (const cleanup of [...cleanups].reverse()) {
      try {
        await cleanup();
      } catch (error) {
        // Every remaining resource must still be released; the first failure is
        // surfaced once teardown has finished.
        failure ??= error;
      }
    }
    if (failure === undefined) return;
    if (failure instanceof Error) throw failure;
    if (typeof failure === 'string') throw new Error(failure);
    throw new Error('resource teardown failed');
  };

  try {
    const workspace = await provisionTrustedWorkspace({
      databaseUrl,
      lookupKey: Buffer.from(LOOKUP_KEY_HEX, 'hex'),
      fieldKey: Buffer.from(FIELD_KEY_HEX, 'hex'),
      issuer: keycloak.issuer,
    });
    cleanups.push(workspace.close);

    // The browser only ever reaches the built artifact origin, so that origin is
    // the public origin and the upstream BFF host is allowlisted as well.
    const document = {
      ...buildTrustDocument({
        bffPort,
        corePort,
        issuer: keycloak.issuer,
        discoveryUrl: keycloak.discoveryUrl,
        authorizeUrl: keycloak.authorizationEndpoint,
        tokenUrl: keycloak.tokenEndpoint,
        jwksUrl: keycloak.jwksUri,
        endSessionUrl: keycloak.endSessionEndpoint,
        revocationUrl: keycloak.revocationEndpoint,
        boardServicePrincipalId: workspace.servicePrincipalId,
      }),
      publicOrigin: webOrigin,
      allowedHosts: [`127.0.0.1:${webPort}`, `127.0.0.1:${bffPort}`],
      callbackUri: `${webOrigin}/bff/auth/callback`,
      postLogoutRedirectUri: `${webOrigin}/workbench`,
      jwksTtlSeconds: KEYCLOAK_JWKS_TTL_SECONDS,
    };
    const rawDocument = JSON.stringify(document);
    const trustConfigHash = createHash('sha256').update(rawDocument, 'utf8').digest('hex');

    const counters = { jwksFetches: 0, coreRequests: 0, owningDispatches: 0 };
    const coreAccessTokens: string[] = [];
    // The Core reads its transport from the global fetch at construction time, so
    // this wrapper observes exactly the Core's OIDC traffic; the BFF keeps a
    // direct handle and is deliberately not counted here.
    const realFetch = globalThis.fetch;
    const countingFetch: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === keycloak.jwksUri) counters.jwksFetches += 1;
      return realFetch(input, init);
    };
    globalThis.fetch = countingFetch;
    let clockNow = Date.now();

    const runtime = createWorkspaceCoreFromEnv({
      ZHIJU_WORKSPACE_TRUST_CONFIG: rawDocument,
      ZHIJU_WORKSPACE_DATABASE_URL: databaseUrl,
      ZHIJU_WORKSPACE_IDENTITY_LOOKUP_KEY: LOOKUP_KEY_HEX,
      ZHIJU_WORKSPACE_IDENTITY_FIELD_KEY: FIELD_KEY_HEX,
      ZHIJU_WORKSPACE_BOARD_CURSOR_KEY: CURSOR_KEY_HEX,
      ZHIJU_WORKSPACE_BOARD_POLICY_REFS: '{}',
    });
    const instrumented = {
      ...runtime,
      dispatch: async (request: WorkspaceDispatchRequest): Promise<WorkspaceDispatchResponse> => {
        counters.owningDispatches += 1;
        return runtime.dispatch(request);
      },
    };
    const server = fastify({ logger: false, bodyLimit: WORKSPACE_BODY_LIMIT_BYTES });
    // Callback-style hook on purpose: a *synchronous* `onRequest` hook (one that
    // returns `undefined`) silently stalls Fastify's body parsing for POSTs, so
    // the Core's own handlers would never run.
    server.addHook('onRequest', (request, _reply, done) => {
      if (request.url.startsWith('/api/')) {
        counters.coreRequests += 1;
        const authorization = request.headers.authorization;
        if (typeof authorization === 'string') coreAccessTokens.push(authorization);
      }
      done();
    });
    const adapter = new FastifyAdapter(server);
    const coreApp = await NestFactory.create(AppModule.register(instrumented), adapter, {
      logger: false,
    });
    registerWorkspaceTransport(server, instrumented);
    await coreApp.listen(corePort, '127.0.0.1');
    cleanups.push(async () => {
      await coreApp.close();
    });

    const bffApp = await createBff({
      env: {
        ZHIJU_WORKSPACE_TRUST_CONFIG: rawDocument,
        [CLIENT_SECRET_ENV]: keycloak.clientSecret,
      },
      clock: () => clockNow,
      fetchImpl: realFetch,
    });
    await bffApp.listen(bffPort, '127.0.0.1');
    cleanups.push(async () => {
      await bffApp.close();
    });

    const artifactServer: BuiltWebArtifactServer = await startBuiltWebArtifactServer({
      port: webPort,
      bffOrigin,
    });
    cleanups.push(artifactServer.stop);
    cleanups.push(() => {
      globalThis.fetch = realFetch;
    });

    console.log(
      `controlled-keycloak image:    ${keycloak.image}\n` +
        `controlled-keycloak version:  ${keycloak.version} (pinned tag ${CONTROLLED_KEYCLOAK_VERSION_TAG})\n` +
        `controlled-keycloak issuer:   ${keycloak.issuer}\n` +
        `controlled-keycloak realm:    ${CONTROLLED_REALM} client ${CLIENT_ID} ` +
        `(audience client scope) + ${UNAUDIENCED_CLIENT_ID} (no audience mapper)\n` +
        `controlled-keycloak user:     ${CONTROLLED_USERNAME}, subject ${SUBJECT_EXTERNAL_ID}; ` +
        'client secret, user password and realm signing key were generated for this test only\n' +
        `controlled-keycloak stack:    web=${artifactServer.origin} bff=${bffOrigin} ` +
        `core=${coreOrigin}/api`,
    );

    return {
      keycloak,
      workspace,
      webOrigin,
      bffOrigin,
      coreOrigin,
      trustConfigHash,
      jwksTtlSeconds: KEYCLOAK_JWKS_TTL_SECONDS,
      jwksFetches: () => counters.jwksFetches,
      coreRequests: () => counters.coreRequests,
      owningDispatches: () => counters.owningDispatches,
      coreAccessTokens: () => [...coreAccessTokens],
      advanceClock: (milliseconds) => {
        clockNow += milliseconds;
      },
      stop: closeAll,
    };
  } catch (error) {
    await closeAll().catch(() => undefined);
    throw error;
  }
}

function activeStack(): ControlledStack {
  if (stack === undefined) {
    throw new Error('the controlled Keycloak stack is not running');
  }
  return stack;
}

function activePage(): Page {
  if (browserPage === undefined) {
    throw new Error('the controlled Keycloak browser page is not open');
  }
  return browserPage;
}

/** The repository must be buildable without a Keycloak-independent skip: this evidence is required. */
describe('workspace controlled-Keycloak acceptance #266 (real Keycloak, real processes)', () => {
  beforeAll(async () => {
    stack = await startControlledStack();
    browser = await chromium.launch({ headless: true });
    browserContext = await browser.newContext({ viewport: { ...VIEWPORT } });
    browserPage = await browserContext.newPage();
  }, 300_000);

  afterAll(async () => {
    await browserContext?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await stack?.stop();
    // Belt and braces: a container whose startup failed partway is removed too.
    await removeAllControlledKeycloakContainers();
  }, 180_000);

  it('completes the real Keycloak Authorization Code + PKCE journey through the built SPA', async () => {
    const current = activeStack();
    const page = activePage();
    const responses: { status: number; url: string }[] = [];
    page.on('response', (response) =>
      responses.push({ status: response.status(), url: response.url() }),
    );

    // 1. Anonymous workbench: the sign-in entry, no fabricated cards.
    await page.goto(`${current.webOrigin}/workbench`);
    const signIn = page.getByRole('link', { name: '使用企业账号登录' });
    await signIn.waitFor({ state: 'visible' });
    expect(await signIn.getAttribute('href')).toBe('/bff/auth/login?returnTo=%2Fworkbench');
    expect(await page.locator('article.work-item').count()).toBe(0);
    const anonymousHtml = await page.content();
    for (const marker of FIXTURE_MARKERS) expect(anonymousHtml).not.toContain(marker);

    // 2. The real Keycloak sign-in form of the controlled realm.
    await signIn.click();
    try {
      await page.locator('#username').waitFor({ state: 'visible', timeout: 60_000 });
    } catch (error) {
      throw new Error(
        `the controlled Keycloak sign-in form never appeared (url=${page.url()} ` +
          `responses=[${responses.map((entry) => `${entry.status} ${entry.url}`).join(' | ')}])`,
        { cause: error },
      );
    }
    expect(page.url().startsWith(current.keycloak.authorizationEndpoint)).toBe(true);
    await page.locator('#username').fill(CONTROLLED_USERNAME);
    await page.locator('#password').fill(current.keycloak.userPassword);
    await page.locator('#kc-login').click();

    // 3. Back on the app with a live session and the authorized directory card.
    const card = page.locator('article.work-item');
    try {
      await card.waitFor({ state: 'visible', timeout: 60_000 });
    } catch (error) {
      const body = (await page.locator('body').innerText()).slice(0, 400);
      const diagnostic =
        `url=${page.url()}\n` +
        `coreRequests=${current.coreRequests()} owningDispatches=${current.owningDispatches()}\n` +
        `responses=\n  ${responses.map((entry) => `${entry.status} ${entry.url}`).join('\n  ')}\n` +
        `body=${JSON.stringify(body)}\n` +
        `keycloak log tail:\n${await keycloakLogTail(current.keycloak.containerName)}`;
      console.log(`controlled-keycloak journey diagnostic:\n${diagnostic}`);
      throw new Error(
        `the controlled-Keycloak sign-in never reached the authorized directory (${diagnostic})`,
        { cause: error },
      );
    }
    expect(await card.count()).toBe(1);
    // Exact references remain available in the compact workbench disclosure.
    await card.getByText('项目引用', { exact: true }).click();
    const cardText = (await card.innerText()).replace(/\s+/gu, ' ');
    expect(cardText).toContain(
      `${current.workspace.enterpriseDisplayName} · ${current.workspace.projectTitle}`,
    );
    expect(cardText).toContain(current.workspace.projectDisplayCode);
    expect(cardText).toContain(current.workspace.projectId);
    expect(cardText).toContain('进行中');
    expect(cardText).toContain('聚合版本 1');

    // 4. Selecting the Project reads its own board scope: the EP rows are the
    //    owning projection rows and the TE board reports the honest unavailable
    //    state because no Board Policy is deployed.
    await card.getByRole('button', { name: '查看该项目看板' }).click();
    const boardSection = page.locator('section.panel', {
      has: page.getByRole('heading', { name: `项目看板 · ${current.workspace.projectTitle}` }),
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
    await page
      .getByText('该项目任务看板当前不可用', { exact: true })
      .waitFor({ state: 'visible', timeout: 30_000 });
    expect(boardsText).toContain('DEPENDENCY_UNAVAILABLE');

    // 5. Evidence that the *real* controlled Keycloak performed the
    //    authorization: the browser hit the realm's authorize endpoint and the
    //    callback carries the realm's RFC 9207 `iss`, which the BFF consumes.
    const callback = responses.find((entry) =>
      entry.url.startsWith(`${current.webOrigin}/bff/auth/callback?`),
    );
    if (callback === undefined) {
      throw new Error(
        `no callback response from the controlled realm was observed: ${responses
          .map((entry) => `${entry.status} ${entry.url}`)
          .join(' | ')}`,
      );
    }
    expect(callback.status).toBe(302);
    const callbackQuery = new URL(callback.url).searchParams;
    expect(callbackQuery.get('iss')).toBe(current.keycloak.issuer);
    expect(callbackQuery.get('state')).not.toBeNull();
    expect(callbackQuery.get('code')).not.toBeNull();
    expect(responses.some((entry) => entry.url.startsWith(current.keycloak.issuer))).toBe(true);

    // 6. The built shell never renders a fixture marker, a token, a secret, the
    //    generated password or the external subject.
    const html = await page.content();
    for (const marker of FIXTURE_MARKERS) expect(html).not.toContain(marker);
    expect(html).not.toContain(current.keycloak.clientSecret);
    expect(html).not.toContain(current.keycloak.unaudiencedClientSecret);
    expect(html).not.toContain(current.keycloak.userPassword);
    expect(html).not.toContain(SUBJECT_EXTERNAL_ID);
    expect(html).not.toContain(createHash('sha256').update(SUBJECT_EXTERNAL_ID).digest('hex'));
    expect(html).not.toContain('eyJ');
    expect(html).not.toContain('Bearer ');

    const session = ((await browserContext?.cookies()) ?? []).find(
      (cookie) => cookie.name === SESSION_COOKIE,
    );
    expect(session?.httpOnly).toBe(true);
    expect(session?.value).not.toContain('eyJ');

    console.log(
      `controlled-keycloak browser:  ${browser?.version() ?? 'unknown'} ` +
        `${VIEWPORT.width}x${VIEWPORT.height} headless`,
    );
    console.log(`controlled-keycloak card:     ${cardText}`);
  }, 180_000);

  it('rejects an access token of the client without the audience mapper (401, no owning read)', async () => {
    const current = activeStack();
    const token = await current.keycloak.fetchUnaudiencedAccessToken();
    const claims = decodeJwtSegment(token, 1);
    expect(claims.azp).toBe(UNAUDIENCED_CLIENT_ID);
    expect(audienceIncludesClaim(claims, API_AUDIENCE)).toBe(false);

    const before = current.owningDispatches();
    const rejected = await callCoreDirectory(current, token);
    expect(rejected.status).toBe(401);
    expect(rejected.body.code).toBe('AUTHENTICATION_REQUIRED');
    expect(current.owningDispatches()).toBe(before);
    expect(JSON.stringify(rejected.body)).not.toContain(current.workspace.projectId);
  }, 60_000);

  it('rejects an access token whose iss is not the configured realm issuer (401, no owning read)', async () => {
    const current = activeStack();

    // Positive control: the identical carved token under the configured issuer
    // passes every gate and reaches the owning directory read, so the next
    // rejection can only come from the substituted issuer.
    const control = current.keycloak.mintAccessToken({
      kid: current.keycloak.importedSigningKid,
      claims: accessTokenClaims(current.keycloak.issuer),
    });
    const accepted = await callCoreDirectory(current, control);
    expect(accepted.status).toBe(200);
    expect(JSON.stringify(accepted.body)).toContain(current.workspace.projectId);

    const foreign = current.keycloak.mintAccessToken({
      kid: current.keycloak.importedSigningKid,
      claims: accessTokenClaims(`${current.keycloak.origin}/realms/${FOREIGN_ISSUER_REALM}`),
    });
    const before = current.owningDispatches();
    const rejected = await callCoreDirectory(current, foreign);
    expect(rejected.status).toBe(401);
    expect(rejected.body.code).toBe('AUTHENTICATION_REQUIRED');
    expect(current.owningDispatches()).toBe(before);
    expect(JSON.stringify(rejected.body)).not.toContain(current.workspace.projectId);
  }, 60_000);

  it('rejects a callback carrying a mismatched iss with 400, zero session and zero Core calls', async () => {
    const current = activeStack();
    const login = await fetch(`${current.bffOrigin}/bff/auth/login?returnTo=/workbench`, {
      redirect: 'manual',
    });
    expect(login.status).toBe(302);
    const authorizeLocation = login.headers.get('location');
    if (authorizeLocation === null)
      throw new Error('the login response carried no Location header');
    expect(authorizeLocation.startsWith(current.keycloak.authorizationEndpoint)).toBe(true);
    const state = new URL(authorizeLocation).searchParams.get('state');
    if (state === null) throw new Error('the authorize redirect carried no state');
    const loginCookie = readSetCookieValue(login, LOGIN_COOKIE);
    if (loginCookie === undefined) throw new Error('the login response set no login cookie');

    const coreRequestsBefore = current.coreRequests();
    const dispatchesBefore = current.owningDispatches();
    const mismatch = encodeURIComponent(
      `${current.keycloak.origin}/realms/${FOREIGN_ISSUER_REALM}`,
    );
    const callback = await fetch(
      `${current.bffOrigin}/bff/auth/callback?code=not-a-real-code&state=${encodeURIComponent(
        state,
      )}&iss=${mismatch}`,
      {
        redirect: 'manual',
        headers: { cookie: `${LOGIN_COOKIE}=${loginCookie}`, origin: current.webOrigin },
      },
    );
    expect(callback.status).toBe(400);
    expect((await readJsonRecord(callback)).code).toBe('UI_REAUTH_REQUIRED');
    expect(readSetCookieValue(callback, SESSION_COOKIE)).toBeUndefined();
    expect(current.coreRequests()).toBe(coreRequestsBefore);
    expect(current.owningDispatches()).toBe(dispatchesBefore);
  }, 60_000);

  it('refreshes against real Keycloak without extending the absolute session expiry', async () => {
    const current = activeStack();
    const sessionCookieValue = ((await browserContext?.cookies()) ?? []).find(
      (cookie) => cookie.name === SESSION_COOKIE,
    )?.value;
    if (sessionCookieValue === undefined) throw new Error('no session cookie after the journey');
    const cookieHeader = { cookie: `${SESSION_COOKIE}=${sessionCookieValue}` };
    const readDirectory = async (csrf: string): Promise<Response> =>
      fetch(`${current.bffOrigin}${DIRECTORY_PATH}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...cookieHeader,
          origin: current.webOrigin,
          'x-csrf-token': csrf,
        },
        body: JSON.stringify(directoryQueryBody()),
      });

    const sessionBefore = await readJsonRecord(
      await fetch(`${current.bffOrigin}/bff/session`, { headers: cookieHeader }),
    );
    const csrfToken = sessionBefore.csrfToken;
    if (typeof csrfToken !== 'string' || csrfToken.length === 0) {
      throw new Error('the session payload carried no CSRF token');
    }

    // A first protected read on the same live BFF session records the token the
    // session is actually using; its access-token remaining lifetime is still
    // far outside the refresh window, so it proves no refresh has happened yet.
    const before = await readDirectory(csrfToken);
    expect(before.status).toBe(200);
    expect(JSON.stringify(await readJsonRecord(before))).toContain(current.workspace.projectId);
    const tokenBefore = current.coreAccessTokens().at(-1);
    if (tokenBefore === undefined) throw new Error('no Core access token was captured before');

    // Only the trusted BFF clock advances, so the refresh is a genuine Keycloak
    // refresh of a healthy, real SSO session.
    current.advanceClock(REFRESH_CLOCK_ADVANCE_MS);

    const after = await readDirectory(csrfToken);
    expect(after.status).toBe(200);
    expect(JSON.stringify(await readJsonRecord(after))).toContain(current.workspace.projectId);

    const tokenAfter = current.coreAccessTokens().at(-1);
    if (tokenAfter === undefined) throw new Error('no Core access token was captured after');
    expect(tokenAfter).not.toBe(tokenBefore);
    const refreshed = decodeJwtSegment(tokenAfter, 1);
    const original = decodeJwtSegment(tokenBefore, 1);
    // The refreshed token is a real realm token for the same Keycloak session and
    // the same re-verified subject: same issuer, same authorized party, same SSO
    // session id, a new token id.
    expect(refreshed.iss).toBe(current.keycloak.issuer);
    expect(refreshed.sub).toBe(SUBJECT_EXTERNAL_ID);
    expect(refreshed.azp).toBe(AZP);
    expect(audienceIncludesClaim(refreshed, API_AUDIENCE)).toBe(true);
    expect(refreshed.sid).toBe(original.sid);
    expect(refreshed.jti).not.toBe(original.jti);

    const sessionAfter = await readJsonRecord(
      await fetch(`${current.bffOrigin}/bff/session`, { headers: cookieHeader }),
    );
    expect(sessionAfter.accessState).toBe('ALLOWED');
    expect(sessionAfter.expiresAt).toBe(sessionBefore.expiresAt);
    console.log(
      `controlled-keycloak refresh:  Keycloak access token rotated for sid ${String(
        refreshed.sid,
      )}; absolute expiry ${String(sessionAfter.expiresAt)} unchanged`,
    );
  }, 90_000);

  it('rejects the retired key after a real admin-API rotation, then accepts the new key', async () => {
    const current = activeStack();
    const rotation = await current.keycloak.rotateSigningKey();
    expect(rotation.newKid).not.toBe(rotation.retiredKid);
    expect(await current.keycloak.readSigningKids()).toEqual([rotation.newKid]);

    // Let the Core's JWKS cache lapse, so the retired kid is resolved against the
    // realm's current key set instead of the pre-rotation cache.
    await delay((current.jwksTtlSeconds + 1) * 1000);

    const retiredToken = current.keycloak.mintAccessToken({
      kid: rotation.retiredKid,
      claims: accessTokenClaims(current.keycloak.issuer),
    });
    const jwksBefore = current.jwksFetches();
    const dispatchesBefore = current.owningDispatches();
    const rejected = await callCoreDirectory(current, retiredToken);
    const jwksUsed = current.jwksFetches() - jwksBefore;
    expect(rejected.status).toBe(401);
    expect(rejected.body.code).toBe('AUTHENTICATION_REQUIRED');
    expect(current.owningDispatches()).toBe(dispatchesBefore);
    // Unknown kid: at most one bounded JWKS refresh, never a key lookup storm.
    expect(jwksUsed).toBeLessThanOrEqual(1);

    // The cache is not poisoned: a real token signed by the rotated key is
    // accepted (and the owning read still returns the provisioned Project).
    const freshToken = await current.keycloak.fetchUserAccessToken();
    expect(decodeJwtSegment(freshToken, 0).kid).toBe(rotation.newKid);
    const accepted = await callCoreDirectory(current, freshToken);
    expect(accepted.status).toBe(200);
    expect(JSON.stringify(accepted.body)).toContain(current.workspace.projectId);

    console.log(
      `controlled-keycloak rotation: retired ${rotation.retiredKid} -> ${rotation.newKid}; ` +
        `unknown-kid JWKS fetches = ${jwksUsed}; rotated token accepted afterwards`,
    );
  }, 120_000);
});
