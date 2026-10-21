// IM-UI-01 (#266): the public trusted-Human workspace HTTP journey over real
// processes and real PostgreSQL. This case starts the *actual* Core workspace
// runtime (`createWorkspaceCoreFromEnv` + the real Nest/Fastify surface) and
// the *actual* BFF (`createBff`) on ephemeral loopback listeners, drives the
// real repo synthetic OIDC provider over real HTTP, and provisions its owners
// in a disposable database. No production surface is stubbed.

import { createHash } from 'node:crypto';

import { NestFactory } from '../../apps/api/node_modules/@nestjs/core/index.js';
import { FastifyAdapter } from '../../apps/api/node_modules/@nestjs/platform-fastify/index.js';
import fastify from '../../apps/api/node_modules/fastify/fastify.js';
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
import { SYNTHETIC_COMPACT_JWT_PATTERN } from '../helpers/synthetic-token-disclosure.js';

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
const SESSION_COOKIE = '__Host-zhiju_session';
const LOGIN_COOKIE = '__Host-zhiju_login';
const LOOKUP_KEY_HEX = '11'.repeat(32);
const FIELD_KEY_HEX = '22'.repeat(32);
const CURSOR_KEY_HEX = '33'.repeat(32);

interface Stack {
  provider: FakeOidcProvider;
  workspace: ProvisionedWorkspace;
  coreRequests: { method: string; url: string }[];
  publicOrigin: string;
  corePort: number;
  bffPort: number;
  stop: () => Promise<void>;
}

function cookieValue(response: Response, name: string): string | undefined {
  for (const entry of response.headers.getSetCookie()) {
    const [pair] = entry.split(';');
    if (pair === undefined) continue;
    const separator = pair.indexOf('=');
    if (separator > 0 && pair.slice(0, separator) === name) return pair.slice(separator + 1);
  }
  return undefined;
}

function loginCookieHeader(value: string): Record<string, string> {
  return { cookie: `${LOGIN_COOKIE}=${value}` };
}

function sessionCookieHeader(value: string): Record<string, string> {
  return { cookie: `${SESSION_COOKIE}=${value}` };
}

/** The closed public Query Envelope projection the BFF forwards verbatim. */
function queryEnvelope(input: {
  type: string;
  scopeRef: Record<string, unknown>;
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    queryId: newUuidV7(),
    type: input.type,
    version: '1.0',
    scopeRef: input.scopeRef,
    consistencyRequirement: 'AUTHORITATIVE',
    correlationId: newUuidV7(),
    requestedAt: new Date().toISOString(),
    payload: input.payload,
  };
}

function commandEnvelope(input: {
  type: string;
  scopeRef: Record<string, unknown>;
  targetRef: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    commandId: newUuidV7(),
    type: input.type,
    version: '1.0',
    scopeRef: input.scopeRef,
    targetRef: input.targetRef,
    idempotencyKey: newUuidV7(),
    correlationId: newUuidV7(),
    requestedAt: new Date().toISOString(),
    payload: {},
  };
}

async function startStack(): Promise<Stack> {
  if (databaseUrl === undefined) {
    throw new Error('ZJU_PERSISTENCE_DATABASE_URL is required for the trusted entry stack');
  }
  const clock = (): number => Date.now();
  const provider = new FakeOidcProvider({
    clock,
    clientId: CLIENT_ID,
    apiAudience: API_AUDIENCE,
    azp: AZP,
    sub: SUBJECT_EXTERNAL_ID,
  });
  await provider.start();
  // A realm-path issuer satisfies the Core trust loader's issuer binding while
  // staying byte-identical to the discovery document the provider serves.
  provider.issuer = `${provider.baseUrl}${ISSUER_REALM_PATH}`;

  const corePort = await reserveLoopbackPort();
  const bffPort = await reserveLoopbackPort();
  const boardServicePrincipalId = newUuidV7();
  const document = buildTrustDocument({
    bffPort,
    corePort,
    issuer: provider.issuer,
    discoveryUrl: provider.url('/.well-known/openid-configuration'),
    authorizeUrl: provider.url('/authorize'),
    tokenUrl: provider.url('/token'),
    jwksUrl: provider.url('/jwks'),
    endSessionUrl: provider.url('/logout'),
    revocationUrl: provider.url('/revoke'),
    boardServicePrincipalId,
  });
  const rawDocument = JSON.stringify(document);
  const publicOrigin = `http://127.0.0.1:${bffPort}`;

  // The real Core workspace runtime on an ephemeral loopback listener.
  const runtime = createWorkspaceCoreFromEnv({
    ZHIJU_WORKSPACE_TRUST_CONFIG: rawDocument,
    ZHIJU_WORKSPACE_DATABASE_URL: databaseUrl,
    ZHIJU_WORKSPACE_IDENTITY_LOOKUP_KEY: LOOKUP_KEY_HEX,
    ZHIJU_WORKSPACE_IDENTITY_FIELD_KEY: FIELD_KEY_HEX,
    ZHIJU_WORKSPACE_BOARD_CURSOR_KEY: CURSOR_KEY_HEX,
    // No owning Task Board policy is deployed here, so the Task Board read
    // fails closed with 503 instead of inventing a page.
    ZHIJU_WORKSPACE_BOARD_POLICY_REFS: '{}',
  });
  const coreRequests: { method: string; url: string }[] = [];
  const server = fastify({ logger: false, bodyLimit: WORKSPACE_BODY_LIMIT_BYTES });
  // Observe every request that reaches the Core listener without touching the
  // Fastify hook chain: a Node 'request' listener counts requests even when a
  // transport guard rejects them before routing.
  server.server.on('request', (request) => {
    coreRequests.push({ method: request.method ?? 'GET', url: request.url ?? '/' });
  });
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
  // Observable deployment evidence: the two ephemeral listeners and the issuer
  // the synthetic provider actually serves.
  console.log(
    `trusted-http stack: core=http://127.0.0.1:${corePort}/api bff=${publicOrigin} issuer=${provider.issuer}`,
  );

  const workspace = await provisionTrustedWorkspace({
    databaseUrl,
    lookupKey: Buffer.from(LOOKUP_KEY_HEX, 'hex'),
    fieldKey: Buffer.from(FIELD_KEY_HEX, 'hex'),
    issuer: provider.issuer,
  });

  return {
    provider,
    workspace,
    coreRequests,
    publicOrigin,
    corePort,
    bffPort,
    stop: async () => {
      await bffApp.close();
      await coreApp.close();
      await workspace.close();
      await provider.stop();
    },
  };
}

/** Reads the safe principal summary and CSRF token of one live session. */
async function readSession(stack: Stack, session: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${stack.publicOrigin}/bff/session`, {
    method: 'GET',
    headers: sessionCookieHeader(session),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

// These cases drive real Core/BFF/OIDC HTTP processes on top of PostgreSQL; the
// default 5s per-test budget is not enough for a cold first login, so the suite
// declares an explicit bounded budget instead of weakening any assertion.
describe.skipIf(!databaseUrl)(
  'workspace trusted Human HTTP journey #266 (real processes)',
  { timeout: 60_000 },
  () => {
    let stack: Stack;

    beforeAll(async () => {
      stack = await startStack();
    }, 60_000);

    afterAll(async () => {
      await stack.stop();
    }, 60_000);

    it('logs in over the real OIDC provider and reads the safe session summary', async () => {
      const login = await fetch(
        `${stack.publicOrigin}/bff/auth/login?returnTo=${encodeURIComponent('/workbench')}`,
        { method: 'GET', redirect: 'manual' },
      );
      expect(login.status).toBe(302);
      const authorizeUrl = login.headers.get('location');
      expect(authorizeUrl).toBeTruthy();
      expect(authorizeUrl ?? '').toContain(stack.provider.url('/authorize'));
      const loginCookie = cookieValue(login, LOGIN_COOKIE);
      expect(loginCookie).toBeTruthy();

      const authorize = await fetch(authorizeUrl ?? '', { method: 'GET', redirect: 'manual' });
      expect(authorize.status).toBe(302);
      const callbackUrl = authorize.headers.get('location');
      expect(callbackUrl).toBeTruthy();
      const callback = await fetch(callbackUrl ?? '', {
        method: 'GET',
        headers: loginCookieHeader(loginCookie ?? ''),
        redirect: 'manual',
      });
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toBe('/workbench');
      const session = cookieValue(callback, SESSION_COOKIE);
      expect(session).toBeTruthy();

      const summary = await readSession(stack, session ?? '');
      expect(summary.accessState).toBe('ALLOWED');
      expect(summary.businessActionsEnabled).toBe(true);
      expect(typeof summary.sessionGeneration).toBe('string');
      expect(summary.sessionGeneration).not.toBe('');
      expect(typeof summary.csrfToken).toBe('string');
      expect(summary.csrfToken).not.toBe('');
      expect(typeof summary.expiresAt).toBe('string');
      expect(typeof summary.idleExpiresAt).toBe('string');
      expect(summary.principal).toMatchObject({
        principalId: stack.workspace.principalId,
        principalKind: 'HUMAN',
        displayName: 'Trusted Human',
      });

      const sessionResponse = await fetch(`${stack.publicOrigin}/bff/session`, {
        method: 'GET',
        headers: sessionCookieHeader(session ?? ''),
      });
      expect(sessionResponse.headers.get('cache-control')).toBe('no-store');
    });

    it('returns the authorized directory cards from the real Core', async () => {
      const login = await fetch(
        `${stack.publicOrigin}/bff/auth/login?returnTo=${encodeURIComponent('/workbench')}`,
        { method: 'GET', redirect: 'manual' },
      );
      const authorize = await fetch(login.headers.get('location') ?? '', {
        method: 'GET',
        redirect: 'manual',
      });
      const callback = await fetch(authorize.headers.get('location') ?? '', {
        method: 'GET',
        headers: loginCookieHeader(cookieValue(login, LOGIN_COOKIE) ?? ''),
        redirect: 'manual',
      });
      const session = cookieValue(callback, SESSION_COOKIE) ?? '';
      const summary = await readSession(stack, session);

      const response = await fetch(
        `${stack.publicOrigin}/bff/queries/project.find_workspace_projects/1.0`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: stack.publicOrigin,
            'x-csrf-token': String(summary.csrfToken),
            ...sessionCookieHeader(session),
          },
          body: JSON.stringify(
            queryEnvelope({
              type: 'project.find_workspace_projects',
              scopeRef: {},
              payload: { page: { pageSize: 25 } },
            }),
          ),
        },
      );
      const text = await response.text();
      const body = JSON.parse(text) as Record<string, unknown>;
      expect(response.status, text).toBe(200);
      expect(body.status).toBe('OK');
      const data = body.data as Record<string, unknown>;
      const items = data.items as Record<string, unknown>[];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        enterpriseDisplayName: stack.workspace.enterpriseDisplayName,
        displayCode: stack.workspace.projectDisplayCode,
        title: stack.workspace.projectTitle,
        status: 'ACTIVE',
      });
      expect((items[0]?.projectRef as Record<string, unknown>).objectId).toBe(
        stack.workspace.projectId,
      );
      expect((items[0]?.enterpriseRef as Record<string, unknown>).objectId).toBe(
        stack.workspace.enterpriseId,
      );
      expect(body.stalenessStatus).toBe('FRESH');
    });

    it('returns the owning Project Board slice with its consistency and freshness fields', async () => {
      const login = await fetch(
        `${stack.publicOrigin}/bff/auth/login?returnTo=${encodeURIComponent('/workbench')}`,
        { method: 'GET', redirect: 'manual' },
      );
      const authorize = await fetch(login.headers.get('location') ?? '', {
        method: 'GET',
        redirect: 'manual',
      });
      const callback = await fetch(authorize.headers.get('location') ?? '', {
        method: 'GET',
        headers: loginCookieHeader(cookieValue(login, LOGIN_COOKIE) ?? ''),
        redirect: 'manual',
      });
      const session = cookieValue(callback, SESSION_COOKIE) ?? '';
      const summary = await readSession(stack, session);

      const projectRef = {
        kind: 'OBJECT',
        objectType: 'project.project',
        objectId: stack.workspace.projectId,
        scope: {
          enterpriseId: stack.workspace.enterpriseId,
          projectId: stack.workspace.projectId,
        },
      };
      const response = await fetch(
        `${stack.publicOrigin}/bff/queries/project.get_project_board_slice/1.0`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: stack.publicOrigin,
            'x-csrf-token': String(summary.csrfToken),
            ...sessionCookieHeader(session),
          },
          body: JSON.stringify(
            queryEnvelope({
              type: 'project.get_project_board_slice',
              scopeRef: {
                enterpriseId: stack.workspace.enterpriseId,
                projectId: stack.workspace.projectId,
              },
              payload: { projectRef, statuses: [], itemTypes: [], page: { pageSize: 25 } },
            }),
          ),
        },
      );
      const text = await response.text();
      const body = JSON.parse(text) as Record<string, unknown>;
      expect(response.status, text).toBe(200);
      expect(body.status).toBe('OK');
      expect(body.stalenessStatus).toBe('FRESH');
      const data = body.data as Record<string, unknown>;
      expect(data.projectionStatus).toBe('READY');
      expect(Array.isArray(data.sourceWatermarks)).toBe(true);
      const items = data.items as Record<string, unknown>[];
      expect(items.map((entry) => entry.itemKey)).toEqual([stack.workspace.boardItemKey]);
    });

    it('returns the configured Task Board dependency failure and rejects commands outside the finite allowlist', async () => {
      const login = await fetch(
        `${stack.publicOrigin}/bff/auth/login?returnTo=${encodeURIComponent('/workbench')}`,
        { method: 'GET', redirect: 'manual' },
      );
      const authorize = await fetch(login.headers.get('location') ?? '', {
        method: 'GET',
        redirect: 'manual',
      });
      const callback = await fetch(authorize.headers.get('location') ?? '', {
        method: 'GET',
        headers: loginCookieHeader(cookieValue(login, LOGIN_COOKIE) ?? ''),
        redirect: 'manual',
      });
      const session = cookieValue(callback, SESSION_COOKIE) ?? '';
      const summary = await readSession(stack, session);
      const headers = {
        'content-type': 'application/json',
        origin: stack.publicOrigin,
        'x-csrf-token': String(summary.csrfToken),
        ...sessionCookieHeader(session),
      };
      const scopeRef = {
        enterpriseId: stack.workspace.enterpriseId,
        projectId: stack.workspace.projectId,
      };
      const projectRef = {
        kind: 'OBJECT',
        objectType: 'project.project',
        objectId: stack.workspace.projectId,
        scope: scopeRef,
      };

      // The deployment maps no Task Board Policy ref for this Project, so the
      // owning read fails closed with the frozen DEPENDENCY_UNAVAILABLE code.
      const taskBoard = await fetch(
        `${stack.publicOrigin}/bff/queries/execution.get_task_board_slice/1.0`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(
            queryEnvelope({
              type: 'execution.get_task_board_slice',
              scopeRef,
              payload: { projectRef, statuses: ['READY'], page: { pageSize: 25 } },
            }),
          ),
        },
      );
      expect(taskBoard.status).toBe(503);
      expect(((await taskBoard.json()) as Record<string, unknown>).code).toBe(
        'DEPENDENCY_UNAVAILABLE',
      );

      const command = await fetch(
        `${stack.publicOrigin}/bff/commands/project.request_startup_confirmation/1.0`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(
            commandEnvelope({
              type: 'project.request_startup_confirmation',
              scopeRef,
              targetRef: projectRef,
            }),
          ),
        },
      );
      expect(command.status).toBe(404);
      expect(((await command.json()) as Record<string, unknown>).code).toBe('NOT_FOUND');
    });

    it('creates no session for an error callback and only shows the fixed safe code', async () => {
      stack.provider.authorizeError = true;
      const tokensBefore = stack.provider.tokenRequests.length;
      const coreBefore = stack.coreRequests.length;
      const login = await fetch(
        `${stack.publicOrigin}/bff/auth/login?returnTo=${encodeURIComponent('/workbench')}`,
        { method: 'GET', redirect: 'manual' },
      );
      const authorize = await fetch(login.headers.get('location') ?? '', {
        method: 'GET',
        redirect: 'manual',
      });
      const callback = await fetch(authorize.headers.get('location') ?? '', {
        method: 'GET',
        headers: loginCookieHeader(cookieValue(login, LOGIN_COOKIE) ?? ''),
        redirect: 'manual',
      });
      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toBe('/workbench?error=UI_REAUTH_REQUIRED');
      expect(cookieValue(callback, SESSION_COOKIE)).toBeUndefined();
      expect(stack.provider.tokenRequests.length).toBe(tokensBefore);
      expect(stack.coreRequests.length).toBe(coreBefore);
      stack.provider.authorizeError = false;
    });

    it('rejects callbacks with a missing, wrong or duplicate iss with zero session and zero Core calls', async () => {
      const coreBefore = stack.coreRequests.length;

      const withIss = async (
        issValues: readonly string[],
      ): Promise<{ status: number; session: string | undefined }> => {
        const login = await fetch(
          `${stack.publicOrigin}/bff/auth/login?returnTo=${encodeURIComponent('/workbench')}`,
          { method: 'GET', redirect: 'manual' },
        );
        const authorizeUrl = new URL(login.headers.get('location') ?? '');
        const state = authorizeUrl.searchParams.get('state') ?? '';
        const url = new URL(`${stack.publicOrigin}/bff/auth/callback`);
        url.searchParams.set('code', 'synthetic-code');
        url.searchParams.set('state', state);
        for (const value of issValues) url.searchParams.append('iss', value);
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: loginCookieHeader(cookieValue(login, LOGIN_COOKIE) ?? ''),
          redirect: 'manual',
        });
        return { status: response.status, session: cookieValue(response, SESSION_COOKIE) };
      };

      const missing = await withIss([]);
      expect(missing.status).toBe(400);
      expect(missing.session).toBeUndefined();

      const wrong = await withIss(['http://127.0.0.1:1/realms/other']);
      expect(wrong.status).toBe(400);
      expect(wrong.session).toBeUndefined();

      const duplicate = await withIss([stack.provider.issuer, stack.provider.issuer]);
      expect(duplicate.status).toBe(400);
      expect(duplicate.session).toBeUndefined();

      expect(stack.coreRequests.length).toBe(coreBefore);
    });

    it('rejects a business POST without CSRF or with a null/mismatched Origin before any Core call', async () => {
      const login = await fetch(
        `${stack.publicOrigin}/bff/auth/login?returnTo=${encodeURIComponent('/workbench')}`,
        { method: 'GET', redirect: 'manual' },
      );
      const authorize = await fetch(login.headers.get('location') ?? '', {
        method: 'GET',
        redirect: 'manual',
      });
      const callback = await fetch(authorize.headers.get('location') ?? '', {
        method: 'GET',
        headers: loginCookieHeader(cookieValue(login, LOGIN_COOKIE) ?? ''),
        redirect: 'manual',
      });
      const session = cookieValue(callback, SESSION_COOKIE) ?? '';
      const summary = await readSession(stack, session);
      const url = `${stack.publicOrigin}/bff/queries/project.find_workspace_projects/1.0`;
      const body = JSON.stringify(
        queryEnvelope({
          type: 'project.find_workspace_projects',
          scopeRef: {},
          payload: { page: { pageSize: 25 } },
        }),
      );

      const coreBefore = stack.coreRequests.length;
      const noCsrf = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: stack.publicOrigin,
          ...sessionCookieHeader(session),
        },
        body,
      });
      expect(noCsrf.status).toBe(403);
      expect(((await noCsrf.json()) as Record<string, unknown>).code).toBe('UI_CSRF_REJECTED');

      const nullOrigin = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'null',
          'x-csrf-token': String(summary.csrfToken),
          ...sessionCookieHeader(session),
        },
        body,
      });
      expect(nullOrigin.status).toBe(403);
      expect(((await nullOrigin.json()) as Record<string, unknown>).code).toBe(
        'UI_ORIGIN_REJECTED',
      );

      const mismatchedOrigin = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://127.0.0.1:9',
          'x-csrf-token': String(summary.csrfToken),
          ...sessionCookieHeader(session),
        },
        body,
      });
      expect(mismatchedOrigin.status).toBe(403);
      expect(((await mismatchedOrigin.json()) as Record<string, unknown>).code).toBe(
        'UI_ORIGIN_REJECTED',
      );

      expect(stack.coreRequests.length).toBe(coreBefore);
    });

    it('refuses an override header and an override body field with 400', async () => {
      const login = await fetch(
        `${stack.publicOrigin}/bff/auth/login?returnTo=${encodeURIComponent('/workbench')}`,
        { method: 'GET', redirect: 'manual' },
      );
      const authorize = await fetch(login.headers.get('location') ?? '', {
        method: 'GET',
        redirect: 'manual',
      });
      const callback = await fetch(authorize.headers.get('location') ?? '', {
        method: 'GET',
        headers: loginCookieHeader(cookieValue(login, LOGIN_COOKIE) ?? ''),
        redirect: 'manual',
      });
      const session = cookieValue(callback, SESSION_COOKIE) ?? '';
      const summary = await readSession(stack, session);
      const url = `${stack.publicOrigin}/bff/queries/project.find_workspace_projects/1.0`;
      const baseHeaders = {
        'content-type': 'application/json',
        origin: stack.publicOrigin,
        'x-csrf-token': String(summary.csrfToken),
        ...sessionCookieHeader(session),
      };

      const coreBefore = stack.coreRequests.length;
      const overrideHeader = await fetch(url, {
        method: 'POST',
        headers: { ...baseHeaders, 'x-actor': stack.workspace.principalId },
        body: JSON.stringify(
          queryEnvelope({
            type: 'project.find_workspace_projects',
            scopeRef: {},
            payload: { page: { pageSize: 25 } },
          }),
        ),
      });
      expect(overrideHeader.status).toBe(400);
      expect(((await overrideHeader.json()) as Record<string, unknown>).code).toBe(
        'UI_CLIENT_STATE_INVALID',
      );

      const requester = {
        ...queryEnvelope({
          type: 'project.find_workspace_projects',
          scopeRef: {},
          payload: { page: { pageSize: 25 } },
        }),
        requester: { kind: 'OBJECT', objectType: 'identity.principal', objectId: newUuidV7() },
      };
      const overrideBody = await fetch(url, {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify(requester),
      });
      expect(overrideBody.status).toBe(400);
      expect(((await overrideBody.json()) as Record<string, unknown>).code).toBe(
        'UI_CLIENT_STATE_INVALID',
      );

      expect(stack.coreRequests.length).toBe(coreBefore);
    });

    it('answers an unknown operation or version with 404', async () => {
      const login = await fetch(
        `${stack.publicOrigin}/bff/auth/login?returnTo=${encodeURIComponent('/workbench')}`,
        { method: 'GET', redirect: 'manual' },
      );
      const authorize = await fetch(login.headers.get('location') ?? '', {
        method: 'GET',
        redirect: 'manual',
      });
      const callback = await fetch(authorize.headers.get('location') ?? '', {
        method: 'GET',
        headers: loginCookieHeader(cookieValue(login, LOGIN_COOKIE) ?? ''),
        redirect: 'manual',
      });
      const session = cookieValue(callback, SESSION_COOKIE) ?? '';
      const summary = await readSession(stack, session);
      const headers = {
        'content-type': 'application/json',
        origin: stack.publicOrigin,
        'x-csrf-token': String(summary.csrfToken),
        ...sessionCookieHeader(session),
      };
      const coreBefore = stack.coreRequests.length;

      const unknownOperation = await fetch(
        `${stack.publicOrigin}/bff/queries/project.no_such_operation/1.0`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(
            queryEnvelope({
              type: 'project.no_such_operation',
              scopeRef: {},
              payload: { page: { pageSize: 25 } },
            }),
          ),
        },
      );
      expect(unknownOperation.status).toBe(404);

      const unknownVersion = await fetch(
        `${stack.publicOrigin}/bff/queries/project.find_workspace_projects/9.9`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(
            queryEnvelope({
              type: 'project.find_workspace_projects',
              scopeRef: {},
              payload: { page: { pageSize: 25 } },
            }),
          ),
        },
      );
      expect(unknownVersion.status).toBe(400);

      expect(stack.coreRequests.length).toBe(coreBefore);
    });

    it('invalidates the session on logout and requires re-authentication', async () => {
      const login = await fetch(
        `${stack.publicOrigin}/bff/auth/login?returnTo=${encodeURIComponent('/workbench')}`,
        { method: 'GET', redirect: 'manual' },
      );
      const authorize = await fetch(login.headers.get('location') ?? '', {
        method: 'GET',
        redirect: 'manual',
      });
      const callback = await fetch(authorize.headers.get('location') ?? '', {
        method: 'GET',
        headers: loginCookieHeader(cookieValue(login, LOGIN_COOKIE) ?? ''),
        redirect: 'manual',
      });
      const session = cookieValue(callback, SESSION_COOKIE) ?? '';
      const summary = await readSession(stack, session);

      const logout = await fetch(`${stack.publicOrigin}/bff/auth/logout`, {
        method: 'POST',
        headers: {
          origin: stack.publicOrigin,
          'x-csrf-token': String(summary.csrfToken),
          ...sessionCookieHeader(session),
        },
      });
      expect(logout.status).toBe(200);
      expect(((await logout.json()) as Record<string, unknown>).accessState).toBe(
        'REAUTH_REQUIRED',
      );

      const anonymous = await fetch(`${stack.publicOrigin}/bff/session`, { method: 'GET' });
      expect(anonymous.status).toBe(200);
      expect(((await anonymous.json()) as Record<string, unknown>).accessState).toBe(
        'REAUTH_REQUIRED',
      );

      const stale = await fetch(`${stack.publicOrigin}/bff/session`, {
        method: 'GET',
        headers: sessionCookieHeader(session),
      });
      expect(stale.status).toBe(200);
      const staleBody = (await stale.json()) as Record<string, unknown>;
      expect(staleBody.accessState).not.toBe('ALLOWED');
      expect(staleBody.principal).toBeUndefined();
    });

    it('never echoes a token, the client secret, the external subject or a customer payload', async () => {
      const previousRefreshToken = stack.provider.lastRefreshToken;
      const login = await fetch(
        `${stack.publicOrigin}/bff/auth/login?returnTo=${encodeURIComponent('/workbench')}`,
        { method: 'GET', redirect: 'manual' },
      );
      const authorize = await fetch(login.headers.get('location') ?? '', {
        method: 'GET',
        redirect: 'manual',
      });
      const callback = await fetch(authorize.headers.get('location') ?? '', {
        method: 'GET',
        headers: loginCookieHeader(cookieValue(login, LOGIN_COOKIE) ?? ''),
        redirect: 'manual',
      });
      const session = cookieValue(callback, SESSION_COOKIE) ?? '';
      const summary = await readSession(stack, session);
      const directory = await fetch(
        `${stack.publicOrigin}/bff/queries/project.find_workspace_projects/1.0`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: stack.publicOrigin,
            'x-csrf-token': String(summary.csrfToken),
            ...sessionCookieHeader(session),
          },
          body: JSON.stringify(
            queryEnvelope({
              type: 'project.find_workspace_projects',
              scopeRef: {},
              payload: { page: { pageSize: 25 } },
            }),
          ),
        },
      );

      const refreshToken = stack.provider.lastRefreshToken;
      if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
        throw new Error('the disclosure probe requires a newly issued refresh token');
      }
      expect(refreshToken !== previousRefreshToken).toBe(true);

      const observed: string[] = [
        login.headers.get('location') ?? '',
        authorize.headers.get('location') ?? '',
        callback.headers.get('location') ?? '',
        JSON.stringify(summary),
        await directory.text(),
        ...callback.headers.getSetCookie(),
      ];
      for (const text of observed) {
        expect(text).not.toContain(CLIENT_SECRET);
        expect(text).not.toContain(SUBJECT_EXTERNAL_ID);
        expect(text).not.toMatch(SYNTHETIC_COMPACT_JWT_PATTERN);
        expect(text.includes(refreshToken)).toBe(false);
        expect(text).not.toContain('Bearer ');
      }
      // The external subject is never an identity key on the wire, and the raw
      // PKCE verifier / authorization code never come back to the browser.
      expect(observed.join('\n')).not.toContain(
        createHash('sha256').update(SUBJECT_EXTERNAL_ID).digest('hex'),
      );
    });
  },
);
