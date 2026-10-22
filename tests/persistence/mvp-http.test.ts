import { createHash, randomBytes } from 'node:crypto';

import fastify, { type FastifyInstance } from '../../apps/api/node_modules/fastify/fastify.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { newUuidV7 } from '@zhiju/shared-kernel';
import { registerMvpTransport } from '../../apps/api/src/mvp/http.js';
import { createMvpCoreRuntime, type MvpCoreRuntime } from '../../apps/api/src/mvp/runtime.js';
import { FakeOidcProvider } from '../../apps/workspace-bff/src/testing/fake-oidc.js';
import {
  applyMvpMigration,
  createMvpDatabase,
  docxBytes,
  markdownBytes,
  provisionMvp,
  sha256,
  xlsxBytes,
  zipBytes,
  type MvpFixture,
} from './mvp-fixtures.js';

const adminUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = adminUrl !== undefined;
const CLIENT_ID = 'mvp-bff';
const AUDIENCE = 'zhiju-mvp-api';
const CALLBACK = 'http://127.0.0.1:3300/bff/auth/callback';

describe.skipIf(!gateEnabled)('MVP01 Core HTTP custody', () => {
  let fixture: MvpFixture;
  let provider: FakeOidcProvider;
  let server: FastifyInstance | undefined;
  let runtime: MvpCoreRuntime | undefined;
  let origin = '';
  let accessToken = '';
  let trustHash = '';
  const sessionBinding = randomBytes(32).toString('base64url');

  beforeAll(async () => {
    if (adminUrl === undefined) throw new Error('persistence gate is required');
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
    const trust = {
      trustConfigVersion: 'mvp-trust-v1',
      publicOrigin: 'http://127.0.0.1:3300',
      allowedHosts: ['127.0.0.1:3300', '127.0.0.1:3301'],
      trustedProxyPeers: [],
      issuer: provider.issuer,
      providerCode: 'synthetic-oidc',
      discoveryUrl: provider.url('/.well-known/openid-configuration'),
      clientId: CLIENT_ID,
      clientAuthSecretRef: 'env:MVP_TEST_CLIENT_SECRET',
      apiAudience: AUDIENCE,
      allowedAzp: CLIENT_ID,
      callbackUri: CALLBACK,
      postLogoutRedirectUri: 'http://127.0.0.1:3300/custody',
      returnRoutePatterns: ['/custody', '/custody/projects/:projectRef'],
      oidcEndpointAllowlist: [
        provider.url('/.well-known/openid-configuration'),
        provider.url('/authorize'),
        provider.url('/token'),
        provider.url('/jwks'),
        provider.url('/logout'),
        provider.url('/revoke'),
      ],
      apiBaseUrl: 'http://127.0.0.1:3302/api',
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
    trustHash = createHash('sha256').update(rawTrust, 'utf8').digest('hex');
    runtime = await createMvpCoreRuntime({
      NODE_ENV: 'test',
      ZHIJU_MVP_INSTANCE_ID: fixture.instanceId,
      ZHIJU_MVP_DATABASE_URL: fixture.databaseUrl,
      ZHIJU_MVP_STORE_ROOT: fixture.storeRoot,
      ZHIJU_MVP_STORE_ID: fixture.storeId,
      ZHIJU_MVP_STORE_IDENTITY: fixture.store.identity.storeIdentity,
      ZHIJU_MVP_CURSOR_KEY: '44'.repeat(32),
      ZHIJU_MVP_TRUST_CONFIG: rawTrust,
      ZHIJU_MVP_CORE_PORT: '3399',
    });
    server = fastify({ logger: false });
    registerMvpTransport(server, runtime);
    await server.listen({ host: '127.0.0.1', port: 0 });
    const address = server.server.address();
    if (address === null || typeof address === 'string') throw new Error('no server address');
    origin = `http://127.0.0.1:${address.port}`;
    accessToken = await mintAccessToken();
  }, 180_000);

  afterAll(async () => {
    await server?.close();
    await runtime?.close();
    try {
      await provider.stop();
    } catch {
      // beforeAll may have failed before the synthetic provider started.
    }
  }, 60_000);

  async function mintAccessToken(): Promise<string> {
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorize = new URL(provider.url('/authorize'));
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', CLIENT_ID);
    authorize.searchParams.set('redirect_uri', CALLBACK);
    authorize.searchParams.set('state', 'state-1');
    authorize.searchParams.set('nonce', 'nonce-1');
    authorize.searchParams.set('scope', 'openid');
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    const redirect = await fetch(authorize, { redirect: 'manual' });
    const location = redirect.headers.get('location');
    if (location === null) throw new Error('missing authorization redirect');
    const code = new URL(location).searchParams.get('code');
    if (code === null) throw new Error('missing authorization code');
    const tokens = await fetch(provider.url('/token'), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: CLIENT_ID,
        redirect_uri: CALLBACK,
      }).toString(),
    });
    const body = (await tokens.json()) as { access_token?: string };
    if (body.access_token === undefined) throw new Error('missing access token');
    return body.access_token;
  }

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${accessToken}`,
      'x-workspace-session-binding': sessionBinding,
      'x-workspace-trust-config-hash': trustHash,
      ...extra,
    };
  }

  async function json(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${origin}/api/mvp/v1${path}`, {
      ...init,
      headers: headers({
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      }),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text.length === 0 ? {} : (JSON.parse(text) as Record<string, unknown>),
    };
  }

  it('authenticates the bound operator and rejects missing technical headers', async () => {
    const session = await json('/session');
    expect(session.status).toBe(200);
    const data = session.body.data as Record<string, unknown>;
    expect(data.ownerId).toBe(fixture.ownerId);
    expect(data.instanceId).toBe(fixture.instanceId);
    expect(data.capabilities).toEqual(['PROJECT_CUSTODY']);
    const missing = await fetch(`${origin}/api/mvp/v1/session`, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-workspace-trust-config-hash': trustHash,
      },
    });
    expect(missing.status).toBe(401);
  });

  it('creates, replays and rejects changed idempotent project intents', async () => {
    const projectId = newUuidV7();
    const requestId = newUuidV7();
    const body = JSON.stringify({ customerName: '客户甲', title: 'HTTP 项目' });
    const first = await json(`/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'idempotency-key': requestId },
      body,
    });
    expect(first.status).toBe(201);
    expect(first.body.ok).toBe(true);
    const replay = await json(`/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'idempotency-key': requestId },
      body,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.receipt).toEqual(first.body.receipt);
    const conflict = await json(`/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'idempotency-key': requestId },
      body: JSON.stringify({ customerName: '客户甲', title: '不同项目' }),
    });
    expect(conflict.status).toBe(409);
    expect((conflict.body.error as Record<string, unknown>).code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('rejects unknown queries, duplicate JSON keys and missing idempotency keys', async () => {
    const query = await json('/projects?unknown=1');
    expect(query.status).toBe(400);
    const duplicate = await json(`/projects/${newUuidV7()}`, {
      method: 'PUT',
      headers: { 'idempotency-key': newUuidV7() },
      body: '{"customerName":"a","customerName":"b","title":"t"}',
    });
    expect(duplicate.status).toBe(400);
    const unknown = await json(`/projects/${newUuidV7()}`, {
      method: 'PUT',
      headers: { 'idempotency-key': newUuidV7() },
      body: JSON.stringify({ customerName: 'a', title: 't', ownerId: newUuidV7() }),
    });
    expect(unknown.status).toBe(400);
    const missingKey = await json(`/projects/${newUuidV7()}`, {
      method: 'PUT',
      body: JSON.stringify({ customerName: 'a', title: 't' }),
    });
    expect(missingKey.status).toBe(400);
  });

  it('uploads a three-format package, extracts it and serves exact original bytes', async () => {
    const projectId = newUuidV7();
    const project = await json(`/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'idempotency-key': newUuidV7() },
      body: JSON.stringify({ customerName: '客户乙', title: 'HTTP 上传' }),
    });
    expect(project.status).toBe(201);
    const batchId = newUuidV7();
    const packageBytes = zipBytes([
      { name: 'readme.md', bytes: markdownBytes() },
      { name: 'spec.docx', bytes: docxBytes() },
      { name: 'sheet.xlsx', bytes: xlsxBytes() },
    ]);
    const created = await json(`/projects/${projectId}/batches/${batchId}`, {
      method: 'PUT',
      headers: { 'idempotency-key': newUuidV7() },
      body: JSON.stringify({
        expectedProjectVersion: 1,
        originalName: 'package.zip',
        declaredBytes: packageBytes.length,
        zipSha256: sha256(packageBytes),
        note: 'HTTP 试走',
      }),
    });
    expect(created.status).toBe(201);
    const batch = (created.body.data as Record<string, unknown>).batch as Record<string, unknown>;
    const attempt = batch.currentAttempt as Record<string, unknown>;
    const upload = await fetch(
      `${origin}/api/mvp/v1/projects/${projectId}/batches/${batchId}/zip`,
      {
        method: 'PUT',
        headers: headers({
          'content-type': 'application/zip',
          'content-length': String(packageBytes.length),
          'x-mvp-upload-attempt': String(attempt.attemptId),
          'x-mvp-upload-generation': String(attempt.generation),
        }),
        body: packageBytes,
      },
    );
    expect(upload.status).toBe(202);
    if (runtime === undefined) throw new Error('runtime missing');
    await runtime.service.whenIdle();
    const detail = await json(`/projects/${projectId}/batches/${batchId}`);
    const data = detail.body.data as Record<string, unknown>;
    const sealed = data.batch as Record<string, unknown>;
    expect(sealed.status).toBe('RECEIVED');
    const manifest = data.manifest as Record<string, unknown>;
    expect(manifest.acceptedEntries).toBe(3);
    const originalZip = manifest.originalZip as Record<string, unknown>;
    const source = await fetch(
      `${origin}/api/mvp/v1/projects/${projectId}/batches/${batchId}/sources/${String(originalZip.sourceId)}/content`,
      { headers: headers() },
    );
    expect(source.status).toBe(200);
    expect(source.headers.get('content-sha256')).toBe(sha256(packageBytes));
    expect(source.headers.get('content-disposition')).toContain('attachment');
    const bytes = Buffer.from(await source.arrayBuffer());
    expect(bytes.equals(packageBytes)).toBe(true);
  });
});
