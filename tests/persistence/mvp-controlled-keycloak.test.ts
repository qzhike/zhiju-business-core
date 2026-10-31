// Real Keycloak security regressions through the MVP custody composition.
// Legacy Enterprise, Grant and Projection fixtures are deliberately absent.

import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { rm } from 'node:fs/promises';

import fastify from '../../apps/api/node_modules/fastify/fastify.js';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';

import { MVP_JSON_BODY_LIMIT, registerMvpTransport } from '../../apps/api/src/mvp/http.js';
import { createMvpCoreRuntime } from '../../apps/api/src/mvp/runtime.js';
import {
  applyMvpMigration,
  createMvpDatabase,
  provisionMvp,
  type MvpFixture,
} from './mvp-fixtures.js';
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
  reserveLoopbackPort,
} from './oidc-fixtures.js';

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
const CURSOR_KEY_HEX = '33'.repeat(32);

const VIEWPORT = { width: 1440, height: 900 } as const;
const DIRECTORY_PATH = '/bff/mvp/v1/projects';
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
  readonly workspace: MvpFixture & { readonly projectId: string; readonly projectTitle: string };
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
  const response = await fetch(`${target.coreOrigin}/api/mvp/v1/projects`, {
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      'x-workspace-session-binding': randomBytes(32).toString('base64url'),
      'x-workspace-trust-config-hash': target.trustConfigHash,
    },
  });
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
    const admin = await createMvpDatabase(databaseUrl);
    await admin.end();
    await applyMvpMigration(databaseUrl);
    const fixture = await provisionMvp(databaseUrl, {
      issuer: keycloak.issuer,
      subject: SUBJECT_EXTERNAL_ID,
    });
    cleanups.push(() => rm(fixture.storeRoot, { recursive: true, force: true }));
    const workspace = { ...fixture, projectId: newUuidV7(), projectTitle: 'Keycloak 托管项目' };

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
        boardServicePrincipalId: newUuidV7(),
      }),
      publicOrigin: webOrigin,
      allowedHosts: [`127.0.0.1:${webPort}`, `127.0.0.1:${bffPort}`],
      callbackUri: `${webOrigin}/bff/auth/callback`,
      postLogoutRedirectUri: `${webOrigin}/custody`,
      returnRoutePatterns: ['/custody', '/custody/projects/:projectRef'],
      jwksTtlSeconds: KEYCLOAK_JWKS_TTL_SECONDS,
    };
    const rawDocument = JSON.stringify(document);
    const trustConfigHash = createHash('sha256').update(rawDocument, 'utf8').digest('hex');

    const counters = { jwksFetches: 0, coreRequests: 0 };
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
    cleanups.push(() => {
      globalThis.fetch = realFetch;
    });
    let clockNow = Date.now();

    const runtime = await createMvpCoreRuntime({
      NODE_ENV: 'test',
      ZHIJU_MVP_INSTANCE_ID: fixture.instanceId,
      ZHIJU_MVP_DATABASE_URL: fixture.databaseUrl,
      ZHIJU_MVP_STORE_ROOT: fixture.storeRoot,
      ZHIJU_MVP_STORE_ID: fixture.storeId,
      ZHIJU_MVP_STORE_IDENTITY: fixture.store.identity.storeIdentity,
      ZHIJU_MVP_CURSOR_KEY: CURSOR_KEY_HEX,
      ZHIJU_MVP_TRUST_CONFIG: rawDocument,
      ZHIJU_MVP_CORE_PORT: String(corePort),
    });
    cleanups.push(() => runtime.close());
    await runtime.service.createProject(
      { ownerId: fixture.ownerId, displayName: 'MVP 操作者', authEpoch: 1 },
      {
        requestId: newUuidV7(),
        projectId: workspace.projectId,
        payload: { customerName: '受控客户', title: workspace.projectTitle },
      },
    );
    const projectReads = vi.spyOn(runtime.service, 'listProjects');
    cleanups.push(() => {
      projectReads.mockRestore();
    });
    const server = fastify({ logger: false, bodyLimit: MVP_JSON_BODY_LIMIT });
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
    cleanups.push(() => server.close());
    registerMvpTransport(server, runtime);
    await server.listen({ port: corePort, host: '127.0.0.1' });

    const bffApp = await createBff({
      env: {
        ZHIJU_WORKSPACE_TRUST_CONFIG: rawDocument,
        ZHIJU_BFF_MVP_CORE_URL: coreOrigin,
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
      owningDispatches: () => projectReads.mock.calls.length,
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
describe('MVP01 controlled-Keycloak acceptance (real Keycloak and PostgreSQL)', () => {
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

    // Open a known project through the same protected deep link used after login.
    const projectPath = `/custody/projects/${current.workspace.projectId}`;
    await page.goto(`${current.webOrigin}${projectPath}`);
    const signIn = page.getByRole('link', { name: '使用企业账号登录' });
    await signIn.waitFor({ state: 'visible' });
    expect(await signIn.getAttribute('href')).toBe(
      `/bff/auth/login?returnTo=${encodeURIComponent(projectPath)}`,
    );
    const anonymousHtml = await page.content();
    expect(anonymousHtml).not.toContain(current.workspace.projectTitle);
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

    // The authenticated browser reads the real MVP project without legacy grants.
    const projectHeading = page.getByRole('heading', {
      name: current.workspace.projectTitle,
      exact: true,
    });
    try {
      await projectHeading.waitFor({ state: 'visible', timeout: 60_000 });
    } catch (error) {
      const navigation = new URL(page.url());
      const requests = responses.map((entry) => {
        const url = new URL(entry.url);
        return `${entry.status} ${url.origin}${url.pathname}`;
      });
      throw new Error(
        `the controlled-Keycloak sign-in never reached MVP custody ` +
          `(page=${navigation.origin}${navigation.pathname}; ` +
          `alerts=${JSON.stringify(await page.getByRole('alert').allTextContents())}; ` +
          `responses=${requests.join(' | ')}): ` +
          (await keycloakLogTail(current.keycloak.containerName)),
        { cause: error },
      );
    }
    expect(await projectHeading.count()).toBe(1);
    expect(page.url()).toBe(`${current.webOrigin}${projectPath}`);

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
    console.log(`controlled-keycloak project:  ${current.workspace.projectTitle}`);
  }, 180_000);

  it('rejects a custody write without CSRF or with an invalid Origin before any Core call', async () => {
    const current = activeStack();
    const sessionCookie = ((await browserContext?.cookies()) ?? []).find(
      (cookie) => cookie.name === SESSION_COOKIE,
    )?.value;
    if (!sessionCookie) throw new Error('no session cookie after the journey');
    const cookie = `${SESSION_COOKIE}=${sessionCookie}`;
    const session = await readJsonRecord(
      await fetch(`${current.bffOrigin}/bff/session`, {
        headers: { cookie },
      }),
    );
    if (typeof session.csrfToken !== 'string') throw new Error('missing CSRF token');
    const before = current.coreRequests();
    for (const headers of [
      { origin: current.webOrigin },
      { origin: 'null', 'x-csrf-token': session.csrfToken },
      { origin: 'http://untrusted.invalid', 'x-csrf-token': session.csrfToken },
    ]) {
      const response = await fetch(`${current.bffOrigin}/bff/mvp/v1/projects/${newUuidV7()}`, {
        method: 'PUT',
        headers: {
          cookie,
          'content-type': 'application/json',
          'idempotency-key': newUuidV7(),
          ...headers,
        },
        body: JSON.stringify({ customerName: '拒绝客户', title: '不得创建' }),
      });
      expect(response.status).toBe(403);
      expect(current.coreRequests()).toBe(before);
    }
  });

  it('rejects missing or wrong audience claims (401, no owning read)', async () => {
    const current = activeStack();
    const token = await current.keycloak.fetchUnaudiencedAccessToken();
    const claims = decodeJwtSegment(token, 1);
    expect(claims.azp).toBe(UNAUDIENCED_CLIENT_ID);
    expect(audienceIncludesClaim(claims, API_AUDIENCE)).toBe(false);

    const before = current.owningDispatches();
    const rejected = await callCoreDirectory(current, token);
    expect(rejected.status).toBe(401);
    expect(rejected.body.error).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(current.owningDispatches()).toBe(before);
    expect(JSON.stringify(rejected.body)).not.toContain(current.workspace.projectId);

    // The no-mapper client also has a different azp. Isolate audience rejection
    // with the realm's published signing key and an otherwise identical token.
    const validClaims = accessTokenClaims(current.keycloak.issuer);
    const control = current.keycloak.mintAccessToken({
      kid: current.keycloak.importedSigningKid,
      claims: validClaims,
    });
    const readsBeforeControl = current.owningDispatches();
    const accepted = await callCoreDirectory(current, control);
    expect(accepted.status).toBe(200);
    expect(JSON.stringify(accepted.body)).toContain(current.workspace.projectId);
    expect(current.owningDispatches()).toBe(readsBeforeControl + 1);

    for (const audience of [undefined, 'untrusted-audience']) {
      const claims = { ...validClaims };
      if (audience === undefined) delete claims.aud;
      else claims.aud = audience;
      const invalid = current.keycloak.mintAccessToken({
        kid: current.keycloak.importedSigningKid,
        claims,
      });
      const readsBeforeRejection = current.owningDispatches();
      const audienceRejected = await callCoreDirectory(current, invalid);
      expect(audienceRejected.status).toBe(401);
      expect(audienceRejected.body.error).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
      expect(current.owningDispatches()).toBe(readsBeforeRejection);
      expect(JSON.stringify(audienceRejected.body)).not.toContain(current.workspace.projectId);
    }
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
    expect(rejected.body.error).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    expect(current.owningDispatches()).toBe(before);
    expect(JSON.stringify(rejected.body)).not.toContain(current.workspace.projectId);
  }, 60_000);

  it('rejects a callback carrying a mismatched iss with 400, zero session and zero Core calls', async () => {
    const current = activeStack();
    const login = await fetch(`${current.bffOrigin}/bff/auth/login?returnTo=/custody`, {
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
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...cookieHeader,
          origin: current.webOrigin,
          'x-csrf-token': csrf,
        },
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
    current.advanceClock(-REFRESH_CLOCK_ADVANCE_MS);
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
    expect(rejected.body.error).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
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
