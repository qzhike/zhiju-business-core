// IM-UI-01 (#258): deterministic transport tests for the Core workspace HTTP
// surface. No database and no identity provider: the trusted runtime (verifier,
// identity bootstrap, dispatch) is a fake injected through the module, so the
// suite pins the exact status/code/body contract of Session Delta §2/§5/§6.

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastify from 'fastify';
import type { VerifiedOidcContextInput } from '@zhiju/identity-policy';
import type { Common } from '@zhiju/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module.js';
import {
  registerWorkspaceTransport,
  WORKSPACE_BODY_LIMIT_BYTES,
  type WorkspaceDispatchRequest,
  type WorkspaceDispatchResponse,
  type WorkspaceHumanBootstrap,
  type WorkspaceTransportRuntime,
} from './controller.js';
import { CORE_ERROR_CODE, WorkspaceCoreError } from './errors.js';

const VALID_TOKEN = 'synthetic-access-token';
const TRUST_HASH = 'a'.repeat(64);
const TRUSTED_PEER = '10.1.2.3';
const UNTRUSTED_PEER = '203.0.113.9';
const BINDING = Buffer.alloc(32, 7);
const BINDING_HEADER = BINDING.toString('base64url');
const PRINCIPAL_REF: Common.ObjectRef = {
  kind: 'OBJECT',
  objectType: 'identity.principal',
  objectId: '01920000-0000-7000-8000-0000000000aa',
  scope: { enterpriseId: '01920000-0000-7000-8000-0000000000ee' },
};
const CORRELATION_ID = '01920000-0000-7000-8000-0000000000cc';

function verifiedContext(): VerifiedOidcContextInput {
  return {
    trustConfigHash: TRUST_HASH,
    issuerConfigHash: 'issuer-config-hash',
    providerCode: 'keycloak',
    issuer: 'https://idp.example/realms/zhiju',
    accountExternalId: 'https://idp.example/realms/zhiju',
    subjectExternalId: 'subject-1',
    clientId: 'workspace-bff',
    apiAudience: 'zhiju-api',
    azp: 'workspace-bff',
    tokenSha256: Buffer.alloc(32, 1),
    issuedAt: new Date('2026-10-10T00:00:00.000Z'),
    expiresAt: new Date('2026-10-10T00:05:00.000Z'),
    validatedAt: new Date('2026-10-10T00:00:01.000Z'),
    sessionBindingHash: Buffer.alloc(32, 9),
  };
}

interface FakeRuntime extends WorkspaceTransportRuntime {
  readonly dispatchCalls: WorkspaceDispatchRequest[];
  dispatchResponse: WorkspaceDispatchResponse;
  bootstrapResult: WorkspaceHumanBootstrap;
  bootstrapError: WorkspaceCoreError | undefined;
  verifyFailure: WorkspaceCoreError | undefined;
}

function createRuntime(): FakeRuntime {
  const runtime: FakeRuntime = {
    trustConfigHash: TRUST_HASH,
    dispatchCalls: [],
    dispatchResponse: { status: 200, payload: { ok: true } },
    bootstrapResult: { principalRef: PRINCIPAL_REF, displayName: 'Synthetic Human' },
    bootstrapError: undefined,
    verifyFailure: undefined,
    isTrustedPeer: (remoteAddress) => remoteAddress === TRUSTED_PEER,
    verifyAccessToken: ({ authorization, sessionBinding }) => {
      if (runtime.verifyFailure !== undefined) return Promise.reject(runtime.verifyFailure);
      if (authorization !== `Bearer ${VALID_TOKEN}`) {
        return Promise.reject(new WorkspaceCoreError(CORE_ERROR_CODE.AUTHENTICATION_REQUIRED));
      }
      return Promise.resolve({ context: verifiedContext(), sessionBinding });
    },
    bootstrapHuman: () => {
      if (runtime.bootstrapError !== undefined) return Promise.reject(runtime.bootstrapError);
      return Promise.resolve(runtime.bootstrapResult);
    },
    dispatch: (request) => {
      runtime.dispatchCalls.push(request);
      return Promise.resolve(runtime.dispatchResponse);
    },
  };
  return runtime;
}

interface Stack {
  readonly app: NestFastifyApplication;
  readonly runtime: FakeRuntime;
  close(): Promise<void>;
}

async function createStack(): Promise<Stack> {
  const runtime = createRuntime();
  const server = fastify({ logger: false, bodyLimit: WORKSPACE_BODY_LIMIT_BYTES });
  // Nest 11.2.1 targets its transitive Fastify 5.11.3; bridge the approved
  // direct 5.12 instance only at this adapter boundary.
  const adapter = new FastifyAdapter(
    server as unknown as ConstructorParameters<typeof FastifyAdapter>[0],
  );
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(runtime),
    adapter,
    { logger: false },
  );
  registerWorkspaceTransport(server, runtime);
  await app.init();
  return { app, runtime, close: () => app.close() };
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${VALID_TOKEN}`,
    'x-workspace-session-binding': BINDING_HEADER,
    'x-workspace-trust-config-hash': TRUST_HASH,
    'content-type': 'application/json',
    ...extra,
  };
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function expectSafeError(
  body: unknown,
  code: string,
): asserts body is { code: string; message: string; retryable: boolean; correlationId: string } {
  expect(body).toMatchObject({ code });
  const record = body as { correlationId?: unknown; message?: unknown };
  expect(typeof record.message).toBe('string');
  expect(record.correlationId).toMatch(UUID_V7);
}

function expectNoStore(response: { headers: Record<string, unknown> }): void {
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['referrer-policy']).toBe('no-referrer');
  expect(response.headers['x-content-type-options']).toBe('nosniff');
}

describe('workspace core HTTP surface', () => {
  let stack: Stack | undefined;

  afterEach(async () => {
    await stack?.close();
    stack = undefined;
  });

  it('rejects a non-peer before reading the body', async () => {
    stack = await createStack();
    const response = await stack.app.inject({
      method: 'POST',
      url: '/api/queries/project.find_workspace_projects/1.0',
      remoteAddress: UNTRUSTED_PEER,
      headers: headers(),
      payload: JSON.stringify({ queryId: CORRELATION_ID }),
    });
    expect(response.statusCode).toBe(403);
    expectSafeError(response.json(), CORE_ERROR_CODE.ACCESS_DENIED);
    expectNoStore(response);
    expect(stack.runtime.dispatchCalls).toHaveLength(0);
  });

  it('rejects business override headers with a safe 400', async () => {
    stack = await createStack();
    const response = await stack.app.inject({
      method: 'POST',
      url: '/api/queries/project.find_workspace_projects/1.0',
      remoteAddress: TRUSTED_PEER,
      headers: headers({ 'x-principal': 'someone-else' }),
      payload: JSON.stringify({ queryId: CORRELATION_ID }),
    });
    expect(response.statusCode).toBe(400);
    expectSafeError(response.json(), CORE_ERROR_CODE.API_VALUE_INVALID);
    expectNoStore(response);
    expect(stack.runtime.dispatchCalls).toHaveLength(0);
  });

  it('rejects a missing or ill-formed session binding with 400', async () => {
    stack = await createStack();
    const missing = await stack.app.inject({
      method: 'POST',
      url: '/api/queries/project.find_workspace_projects/1.0',
      remoteAddress: TRUSTED_PEER,
      headers: {
        authorization: `Bearer ${VALID_TOKEN}`,
        'x-workspace-trust-config-hash': TRUST_HASH,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ queryId: CORRELATION_ID }),
    });
    expect(missing.statusCode).toBe(400);

    const illFormed = await stack.app.inject({
      method: 'POST',
      url: '/api/queries/project.find_workspace_projects/1.0',
      remoteAddress: TRUSTED_PEER,
      headers: headers({ 'x-workspace-session-binding': 'short' }),
      payload: JSON.stringify({ queryId: CORRELATION_ID }),
    });
    expect(illFormed.statusCode).toBe(400);
    expectSafeError(illFormed.json(), CORE_ERROR_CODE.API_VALUE_INVALID);
    expect(stack.runtime.dispatchCalls).toHaveLength(0);
  });

  it('rejects a trust-config hash mismatch with 400', async () => {
    stack = await createStack();
    const response = await stack.app.inject({
      method: 'POST',
      url: '/api/queries/project.find_workspace_projects/1.0',
      remoteAddress: TRUSTED_PEER,
      headers: headers({ 'x-workspace-trust-config-hash': 'b'.repeat(64) }),
      payload: JSON.stringify({ queryId: CORRELATION_ID }),
    });
    expect(response.statusCode).toBe(400);
    expectSafeError(response.json(), CORE_ERROR_CODE.API_VALUE_INVALID);
    expect(stack.runtime.dispatchCalls).toHaveLength(0);
  });

  it('rejects a missing or failing access token with 401 and never echoes it', async () => {
    stack = await createStack();
    const missing = await stack.app.inject({
      method: 'POST',
      url: '/api/queries/project.find_workspace_projects/1.0',
      remoteAddress: TRUSTED_PEER,
      headers: {
        'x-workspace-session-binding': BINDING_HEADER,
        'x-workspace-trust-config-hash': TRUST_HASH,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ queryId: CORRELATION_ID }),
    });
    expect(missing.statusCode).toBe(401);
    expectSafeError(missing.json(), CORE_ERROR_CODE.AUTHENTICATION_REQUIRED);

    const failing = await stack.app.inject({
      method: 'POST',
      url: '/api/queries/project.find_workspace_projects/1.0',
      remoteAddress: TRUSTED_PEER,
      headers: headers({ authorization: 'Bearer expired-token-value' }),
      payload: JSON.stringify({ queryId: CORRELATION_ID }),
    });
    expect(failing.statusCode).toBe(401);
    expectSafeError(failing.json(), CORE_ERROR_CODE.AUTHENTICATION_REQUIRED);
    const serialized = JSON.stringify(failing.json());
    expect(serialized).not.toContain('expired-token-value');
    expect(serialized).not.toContain(TRUST_HASH);
    expect(stack.runtime.dispatchCalls).toHaveLength(0);
  });

  it('maps an unverifiable token to a dependency 503 without leaking it', async () => {
    stack = await createStack();
    stack.runtime.verifyFailure = new WorkspaceCoreError(CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE, {
      message: 'jwks unavailable',
    });
    const response = await stack.app.inject({
      method: 'POST',
      url: '/api/queries/project.find_workspace_projects/1.0',
      remoteAddress: TRUSTED_PEER,
      headers: headers({ authorization: `Bearer ${VALID_TOKEN}` }),
      payload: JSON.stringify({ queryId: CORRELATION_ID }),
    });
    expect(response.statusCode).toBe(503);
    expectSafeError(response.json(), CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE);
    expect(JSON.stringify(response.json())).not.toContain('jwks unavailable');
  });

  it('rejects a bad content type with 415', async () => {
    stack = await createStack();
    const response = await stack.app.inject({
      method: 'POST',
      url: '/api/queries/project.find_workspace_projects/1.0',
      remoteAddress: TRUSTED_PEER,
      headers: headers({ 'content-type': 'text/plain' }),
      payload: 'not json',
    });
    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ code: 'CONTENT_TYPE_UNSUPPORTED' });
    expectNoStore(response);
  });

  it('rejects an oversized body with 413', async () => {
    stack = await createStack();
    const response = await stack.app.inject({
      method: 'POST',
      url: '/api/queries/project.find_workspace_projects/1.0',
      remoteAddress: TRUSTED_PEER,
      headers: headers(),
      payload: JSON.stringify({ queryId: CORRELATION_ID, filler: 'x'.repeat(70_000) }),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(stack.runtime.dispatchCalls).toHaveLength(0);
  });

  it('returns the safe session-bootstrap shape and writes nothing', async () => {
    stack = await createStack();
    const response = await stack.app.inject({
      method: 'POST',
      url: '/api/workspace/session-bootstrap',
      remoteAddress: TRUSTED_PEER,
      headers: headers(),
      payload: JSON.stringify({}),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      principalRef: PRINCIPAL_REF,
      principalKind: 'HUMAN',
      status: 'ACTIVE',
      displayName: 'Synthetic Human',
    });
    expectNoStore(response);
    expect(stack.runtime.dispatchCalls).toHaveLength(0);
  });

  it('maps an unlinked identity to 403 and an unavailable dependency to 503', async () => {
    stack = await createStack();
    stack.runtime.bootstrapError = new WorkspaceCoreError(CORE_ERROR_CODE.ACCESS_DENIED);
    const denied = await stack.app.inject({
      method: 'POST',
      url: '/api/workspace/session-bootstrap',
      remoteAddress: TRUSTED_PEER,
      headers: headers(),
      payload: JSON.stringify({}),
    });
    expect(denied.statusCode).toBe(403);
    expectSafeError(denied.json(), CORE_ERROR_CODE.ACCESS_DENIED);

    stack.runtime.bootstrapError = new WorkspaceCoreError(CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE);
    const unavailable = await stack.app.inject({
      method: 'POST',
      url: '/api/workspace/session-bootstrap',
      remoteAddress: TRUSTED_PEER,
      headers: headers(),
      payload: JSON.stringify({}),
    });
    expect(unavailable.statusCode).toBe(503);
    expectSafeError(unavailable.json(), CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE);
  });

  it('passes a query dispatch status and payload through unchanged', async () => {
    stack = await createStack();
    const payload = {
      queryId: CORRELATION_ID,
      queryType: 'project.find_workspace_projects',
      queryVersion: '1.0',
      status: 'OK',
      data: { items: [], snapshotAt: '2026-10-10T00:00:00.000Z' },
      correlationId: CORRELATION_ID,
    };
    stack.runtime.dispatchResponse = { status: 200, payload };
    const response = await stack.app.inject({
      method: 'POST',
      url: '/api/queries/project.find_workspace_projects/1.0',
      remoteAddress: TRUSTED_PEER,
      headers: headers(),
      payload: JSON.stringify({ queryId: CORRELATION_ID, type: 'project.find_workspace_projects' }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(payload);
    expectNoStore(response);
    expect(stack.runtime.dispatchCalls).toHaveLength(1);
    expect(stack.runtime.dispatchCalls[0]).toMatchObject({
      kind: 'QUERY',
      operation: 'project.find_workspace_projects',
      version: '1.0',
    });
  });

  it('passes a failing command dispatch status and code through unchanged', async () => {
    stack = await createStack();
    const payload = {
      code: CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE,
      message: 'Service temporarily unavailable',
      retryable: true,
      correlationId: CORRELATION_ID,
    };
    stack.runtime.dispatchResponse = { status: 503, payload };
    const response = await stack.app.inject({
      method: 'POST',
      url: '/api/commands/project.request_project_preparation/1.0',
      remoteAddress: TRUSTED_PEER,
      headers: headers(),
      payload: JSON.stringify({ commandId: CORRELATION_ID }),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual(payload);
    expect(stack.runtime.dispatchCalls[0]).toMatchObject({ kind: 'COMMAND' });
  });

  it('returns 404 for the ZIP route without dispatching or reading the body', async () => {
    stack = await createStack();
    const response = await stack.app.inject({
      method: 'PUT',
      url: '/api/customer-intakes/intake-1/zip',
      remoteAddress: TRUSTED_PEER,
      headers: { 'content-type': 'application/zip' },
      payload: 'x'.repeat(200_000),
    });
    expect(response.statusCode).toBe(404);
    expectSafeError(response.json(), CORE_ERROR_CODE.NOT_FOUND);
    expectNoStore(response);
    expect(stack.runtime.dispatchCalls).toHaveLength(0);
  });

  it('keeps GET /health intact while the workspace runtime is registered', async () => {
    stack = await createStack();
    const response = await stack.app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
