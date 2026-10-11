import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createBff } from '../app.js';
import { FakeOidcProvider } from './fake-oidc.js';

export const PUBLIC_ORIGIN = 'http://127.0.0.1:4100';
export const PUBLIC_HOST = '127.0.0.1:4100';
export const CLIENT_ID = 'workspace-bff';
export const API_AUDIENCE = 'zhiju-api';
export const AZP = 'workspace-bff';
export const CLIENT_SECRET = 'synthetic-client-secret';

export interface RecordedCoreRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

export class FakeCore {
  baseUrl = '';
  bootstrapStatus = 200;
  bootstrapBody: unknown = {
    principalRef: {
      kind: 'OBJECT',
      objectType: 'identity.principal',
      objectId: '01920000-0000-7000-8000-0000000000aa',
      scope: { enterpriseId: '01920000-0000-7000-8000-0000000000ee' },
    },
    principalKind: 'HUMAN',
    status: 'ACTIVE',
    displayName: 'Synthetic Human',
  };
  queryStatus = 200;
  queryBody: unknown = {
    status: 'OK',
    data: { items: [], snapshotAt: '2026-10-10T00:00:00.000Z' },
  };
  queryDelayMs = 0;
  requests: RecordedCoreRequest[] = [];
  private server: ReturnType<typeof createServer> | undefined;
  private pendingQueryArrival: ((value: undefined) => void) | undefined;

  /** Resolves once the next protected query has been received (before any delay). */
  nextQueryArrival(): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<undefined>();
    this.pendingQueryArrival = resolve;
    return promise;
  }

  async start(): Promise<void> {
    const server = createServer((request, response) => {
      this.handle(request, response).catch(() => {
        if (!response.headersSent) {
          response.writeHead(500, { 'content-type': 'application/json' });
          response.end('{}');
        }
      });
    });
    this.server = server;
    const started = Promise.withResolvers<undefined>();
    server.listen(0, '127.0.0.1', () => {
      started.resolve(undefined);
    });
    await started.promise;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === undefined) return;
    const closed = Promise.withResolvers<undefined>();
    server.close(() => {
      closed.resolve(undefined);
    });
    await closed.promise;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of request as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    this.requests.push({
      method: request.method ?? 'GET',
      path,
      headers: request.headers,
      body,
    });
    if (path.endsWith('/workspace/session-bootstrap')) {
      this.respond(response, this.bootstrapStatus, this.bootstrapBody);
      return;
    }
    if (path.includes('/queries/')) {
      const arrival = this.pendingQueryArrival;
      this.pendingQueryArrival = undefined;
      arrival?.(undefined);
    }
    if (this.queryDelayMs > 0) {
      const delay = Promise.withResolvers<undefined>();
      setTimeout(() => {
        delay.resolve(undefined);
      }, this.queryDelayMs);
      await delay.promise;
    }
    if (path.includes('/queries/')) {
      this.respond(response, this.queryStatus, this.queryBody);
      return;
    }
    this.respond(response, 404, { code: 'NOT_FOUND', message: 'not found', retryable: false });
  }

  private respond(response: ServerResponse, status: number, body: unknown): void {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(text);
  }

  get apiBaseUrl(): string {
    return `${this.baseUrl}/api`;
  }
}

export function buildTrustConfig(input: {
  provider: FakeOidcProvider;
  core: FakeCore;
  overrides?: Record<string, unknown> | undefined;
}): Record<string, unknown> {
  const { provider, core } = input;
  return {
    trustConfigVersion: 'trusted-human-v1',
    publicOrigin: PUBLIC_ORIGIN,
    allowedHosts: [PUBLIC_HOST],
    trustedProxyPeers: [],
    issuer: provider.issuer,
    providerCode: 'keycloak',
    discoveryUrl: provider.url('/.well-known/openid-configuration'),
    clientId: CLIENT_ID,
    clientAuthSecretRef: 'env:ZHIJU_TEST_CLIENT_SECRET',
    apiAudience: API_AUDIENCE,
    allowedAzp: AZP,
    callbackUri: `${PUBLIC_ORIGIN}/bff/auth/callback`,
    postLogoutRedirectUri: `${PUBLIC_ORIGIN}/workbench`,
    returnRoutePatterns: ['/workbench', '/projects/:projectRef', '/projects/:projectRef/*'],
    oidcEndpointAllowlist: [
      provider.url('/.well-known/openid-configuration'),
      provider.url('/authorize'),
      provider.url('/token'),
      provider.url('/jwks'),
      provider.url('/logout'),
      provider.url('/revoke'),
    ],
    apiBaseUrl: core.apiBaseUrl,
    apiGatewayPeers: ['127.0.0.1'],
    idTokenAlgorithms: ['RS256'],
    accessTokenAlgorithms: ['RS256'],
    accessTokenMaxAgeSeconds: 300,
    clockSkewSeconds: 30,
    jwksTtlSeconds: 300,
    httpTimeoutSeconds: 10,
    maxSessions: 1000,
    maxLoginTransactions: 2000,
    maxTransactionsPerBrowser: 4,
    maxConcurrentUploads: 4,
    capabilityCodes: {
      workspaceProjectDiscoveryHumanV1: 'code-discovery-human',
      projectBoardSliceReadHumanV1: 'code-board-read-human',
      taskBoardReadHumanV1: 'code-task-board-read-human',
      taskBoardSourceReadV1: 'code-task-board-source-read',
      taskBoardHealthReadV1: 'code-task-board-health-read',
      taskBoardPolicyReadV1: 'code-task-board-policy-read',
    },
    boardService: { principalId: '01920000-0000-7000-8000-0000000000b0' },
    ...input.overrides,
  };
}

export interface InjectionResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  setCookies: string[];
  json: unknown;
}

export interface TestStack {
  provider: FakeOidcProvider;
  core: FakeCore;
  now: { value: number };
  inject: (input: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    url: string;
    cookie?: string;
    headers?: Record<string, string>;
    payload?: string;
    remoteAddress?: string;
  }) => Promise<InjectionResponse>;
  close: () => Promise<void>;
}

export function headerValue(response: InjectionResponse, name: string): string {
  const value = response.headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export function cookieFrom(response: InjectionResponse, name: string): string {
  for (const cookie of response.setCookies) {
    const [pair] = cookie.split(';');
    const separator = (pair ?? '').indexOf('=');
    if (separator === -1) continue;
    if ((pair ?? '').slice(0, separator) === name) return (pair ?? '').slice(separator + 1);
  }
  return '';
}

export function cookieHeader(name: string, value: string): string {
  return `${name}=${value}`;
}

export const SESSION_COOKIE = '__Host-zhiju_session';
export const LOGIN_COOKIE = '__Host-zhiju_login';

export async function createTestStack(options: {
  now: { value: number };
  trustOverrides?: Record<string, unknown>;
  bff?: Record<string, unknown>;
}): Promise<TestStack> {
  const clock = () => options.now.value;
  const provider = new FakeOidcProvider({
    clock,
    clientId: CLIENT_ID,
    apiAudience: API_AUDIENCE,
    azp: AZP,
  });
  const core = new FakeCore();
  await provider.start();
  await core.start();
  const config = buildTrustConfig({ provider, core, overrides: options.trustOverrides });
  const app = await createBff({
    env: {
      ZHIJU_WORKSPACE_TRUST_CONFIG: JSON.stringify(config),
      ZHIJU_TEST_CLIENT_SECRET: CLIENT_SECRET,
    },
    clock,
    ...options.bff,
  });
  const instance = app.getHttpAdapter().getInstance();
  return {
    provider,
    core,
    now: options.now,
    inject: async (input) => {
      const headers: Record<string, string> = { host: PUBLIC_HOST, ...input.headers };
      if (input.cookie !== undefined) headers.cookie = input.cookie;
      const response = (await instance.inject({
        method: input.method,
        url: input.url,
        headers,
        ...(input.payload === undefined ? {} : { payload: input.payload }),
        ...(input.remoteAddress === undefined ? {} : { remoteAddress: input.remoteAddress }),
      })) as unknown as {
        statusCode: number;
        headers: Record<string, string | string[] | undefined>;
        body: string;
      };
      let json: unknown;
      try {
        json = JSON.parse(response.body);
      } catch {
        json = undefined;
      }
      const setCookies = response.headers['set-cookie'];
      return {
        status: response.statusCode,
        headers: response.headers,
        text: response.body,
        setCookies: Array.isArray(setCookies)
          ? setCookies
          : setCookies === undefined
            ? []
            : [setCookies],
        json,
      };
    },
    close: async () => {
      await app.close();
      await provider.stop();
      await core.stop();
    },
  };
}

/** Drives one full login: login redirect, authorization hop, bound callback. */
export async function login(
  stack: TestStack,
  returnTo = '/workbench',
): Promise<{ callbackUrl: string; loginCookie: string; authorizeUrl: string }> {
  const response = await stack.inject({
    method: 'GET',
    url: `/bff/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
  });
  const authorizeUrl = headerValue(response, 'location');
  const loginCookie = cookieFrom(response, LOGIN_COOKIE);
  const authorizeResponse = await fetch(authorizeUrl, { redirect: 'manual' });
  const callbackUrl = authorizeResponse.headers.get('location') ?? '';
  return { callbackUrl, loginCookie, authorizeUrl };
}
