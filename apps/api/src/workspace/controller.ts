// IM-UI-01 (#258): the Core HTTP surface of the workspace trusted-Human entry
// (Session Delta §2/§5). The transport mounts exactly four technical routes:
//
//   POST /api/workspace/session-bootstrap
//   POST /api/queries/{operation}/{version}
//   POST /api/commands/{operation}/{version}
//   PUT  /api/customer-intakes/{intakeId}/zip
//
// The BFF is the only caller and it is authenticated at the TLS peer level: the
// routes accept traffic solely from a remote socket address inside the deployed
// `apiGatewayPeers`. A non-peer is rejected with a safe 403 *before* the body is
// read. Browser-supplied business override headers (X-Actor, X-Principal,
// X-Authorization-Decision, ...) are never honoured; their presence is a safe
// 400. The three trusted technical headers (Bearer access token, session
// binding, trust-config hash) are validated here and the raw access token is
// verified by the trusted Core verifier — a Browser "verified" marker is never
// accepted. No token, subject, payload or configuration value is ever echoed.
//
// The controller is deliberately free of any module-internal dependency: the
// trusted runtime (token verifier, identity bootstrap and workspace dispatch) is
// injected behind `WorkspaceTransportRuntime`, so the HTTP contract can be
// exercised without a database or an identity provider. Every failure is
// projected through the frozen `errors.ts` table.

import { Controller, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { VerifiedOidcContextInput } from '@zhiju/identity-policy';
import type { Common } from '@zhiju/contracts';

import {
  CORE_ERROR_CODE,
  newCorrelationId,
  statusOfError,
  toSafeBody,
  WorkspaceCoreError,
  type SafeErrorBody,
} from './errors.js';

/** Maximum accepted JSON request body: 64 KiB (Session Delta §1/§5). */
export const WORKSPACE_BODY_LIMIT_BYTES = 64 * 1024;

/** Nest injection token of the trusted workspace runtime. */
export const WORKSPACE_TRANSPORT_RUNTIME = 'WORKSPACE_TRANSPORT_RUNTIME';

/** Base64url of at least 32 bytes; the trusted BFF binding is opaque to Core. */
const SESSION_BINDING_PATTERN = /^[A-Za-z0-9_-]{43,512}$/u;
const SESSION_BINDING_BYTES = 32;

/** Business override headers a Browser must never smuggle past the BFF. */
const FORBIDDEN_OVERRIDE_HEADERS: readonly string[] = Object.freeze([
  'x-actor',
  'x-acting-for',
  'x-principal',
  'x-authorization-decision',
]);

const JSON_CONTENT_TYPE = /^application\/json(?:\s*;.*)?$/iu;

/** The four trusted technical routes; every other path is left untouched. */
const WORKSPACE_ROUTE_PREFIXES: readonly string[] = Object.freeze([
  '/api/workspace/',
  '/api/queries/',
  '/api/commands/',
  '/api/customer-intakes/',
]);

/** One verified access token plus the trusted BFF session binding. */
export interface WorkspaceVerifiedAccess {
  readonly context: VerifiedOidcContextInput;
  readonly sessionBinding: Buffer;
}

/** The safe Principal summary returned by the identity bootstrap bridge. */
export interface WorkspaceHumanBootstrap {
  readonly principalRef: Common.ObjectRef;
  readonly displayName: string;
}

export interface WorkspaceDispatchRequest {
  readonly kind: 'QUERY' | 'COMMAND';
  readonly operation: string;
  readonly version: string;
  readonly body: unknown;
  readonly context: VerifiedOidcContextInput;
  readonly sessionBinding: Buffer;
  readonly correlationId: string;
}

export interface WorkspaceDispatchResponse {
  readonly status: number;
  readonly payload: unknown;
}

/**
 * The trusted runtime behind the HTTP surface. Every method fails closed: it
 * either returns a verified result or throws `WorkspaceCoreError` with a code
 * from the frozen table, and it never discloses configuration, tokens or
 * storage internals.
 */
export interface WorkspaceTransportRuntime {
  readonly trustConfigHash: string;
  isTrustedPeer(remoteAddress: string | undefined): boolean;
  verifyAccessToken(input: {
    readonly authorization: string | undefined;
    readonly sessionBinding: Buffer;
  }): Promise<WorkspaceVerifiedAccess>;
  bootstrapHuman(access: WorkspaceVerifiedAccess): Promise<WorkspaceHumanBootstrap>;
  dispatch(request: WorkspaceDispatchRequest): Promise<WorkspaceDispatchResponse>;
}

/** Per-request correlation id; a WeakMap keeps it off the Fastify request shape. */
const correlationByRequest = new WeakMap<FastifyRequest, string>();

function correlationOf(request: FastifyRequest): string {
  const existing = correlationByRequest.get(request);
  if (existing !== undefined) return existing;
  const generated = newCorrelationId();
  correlationByRequest.set(request, generated);
  return generated;
}

function pathOf(url: string): string {
  const queryAt = url.indexOf('?');
  return queryAt === -1 ? url : url.slice(0, queryAt);
}

function isWorkspacePath(url: string): boolean {
  const path = pathOf(url);
  return WORKSPACE_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

function decodeSessionBinding(raw: string | undefined): Buffer | undefined {
  if (raw === undefined) return undefined;
  if (!SESSION_BINDING_PATTERN.test(raw)) return undefined;
  const decoded = Buffer.from(raw, 'base64url');
  if (decoded.length < SESSION_BINDING_BYTES) return undefined;
  return decoded;
}

/** A local safe body for transport-level failures outside the frozen table. */
function transportBody(code: string, correlationId: string): SafeErrorBody {
  return { code, message: 'Invalid request', retryable: false, correlationId };
}

async function reject(
  reply: FastifyReply,
  correlationId: string,
  code:
    | typeof CORE_ERROR_CODE.ACCESS_DENIED
    | typeof CORE_ERROR_CODE.API_VALUE_INVALID
    | typeof CORE_ERROR_CODE.NOT_FOUND,
): Promise<void> {
  const error = new WorkspaceCoreError(code);
  await reply.status(statusOfError(error)).send(toSafeBody(error, correlationId));
}

/**
 * Registers the transport-level guard on the underlying Fastify instance. It
 * runs on `onRequest`, i.e. before the body is parsed, so a non-peer is rejected
 * with a safe 403 and the ZIP route with a safe 404 without ever reading a byte
 * of the body. It also enforces the fixed JSON content type and the 64 KiB body
 * limit. Health and any non-workspace route are untouched.
 */
export function registerWorkspaceTransport(
  server: FastifyInstance,
  runtime: Pick<WorkspaceTransportRuntime, 'isTrustedPeer'>,
): void {
  server.addHook('onRequest', async (request, reply) => {
    if (!isWorkspacePath(request.url)) return;
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    const correlationId = correlationOf(request);

    const remoteAddress = request.socket.remoteAddress ?? undefined;
    if (!runtime.isTrustedPeer(remoteAddress)) {
      await reject(reply, correlationId, CORE_ERROR_CODE.ACCESS_DENIED);
      return;
    }

    if (FORBIDDEN_OVERRIDE_HEADERS.some((name) => request.headers[name] !== undefined)) {
      await reject(reply, correlationId, CORE_ERROR_CODE.API_VALUE_INVALID);
      return;
    }

    // The ZIP route has no registered owning transport in this release: reply
    // 404 without consuming the (potentially large) request body.
    if (request.method === 'PUT' && pathOf(request.url).startsWith('/api/customer-intakes/')) {
      await reject(reply, correlationId, CORE_ERROR_CODE.NOT_FOUND);
      return;
    }

    if (request.method !== 'POST' && request.method !== 'PUT') return;

    const contentType = headerValue(request, 'content-type');
    if (contentType === undefined || !JSON_CONTENT_TYPE.test(contentType)) {
      await reply.status(415).send(transportBody('CONTENT_TYPE_UNSUPPORTED', correlationId));
      return;
    }

    const contentLength = headerValue(request, 'content-length');
    if (contentLength !== undefined) {
      const declared = Number(contentLength);
      if (Number.isFinite(declared) && declared > WORKSPACE_BODY_LIMIT_BYTES) {
        await reply.status(413).send(transportBody('PAYLOAD_TOO_LARGE', correlationId));
        return;
      }
    }
  });
}

/**
 * The NestJS controller mounting the four trusted Core routes. Each handler owns
 * the exact status/body contract of the Session Delta; the cross-cutting peer,
 * override, content-type and size checks live in the Fastify `onRequest` guard.
 */
@Controller()
export class WorkspaceController {
  constructor(
    @Inject(WORKSPACE_TRANSPORT_RUNTIME)
    private readonly runtime: WorkspaceTransportRuntime,
  ) {}

  @Post('api/workspace/session-bootstrap')
  async sessionBootstrap(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const correlationId = correlationOf(request);
    try {
      const access = await this.authenticate(request);
      const human = await this.runtime.bootstrapHuman(access);
      await reply.status(200).send({
        principalRef: human.principalRef,
        principalKind: 'HUMAN',
        status: 'ACTIVE',
        displayName: human.displayName,
      });
    } catch (error) {
      await this.fail(reply, error, correlationId);
    }
  }

  @Post('api/queries/:operation/:version')
  async query(
    @Param('operation') operation: string,
    @Param('version') version: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.dispatchRoute('QUERY', operation, version, request, reply);
  }

  @Post('api/commands/:operation/:version')
  async command(
    @Param('operation') operation: string,
    @Param('version') version: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.dispatchRoute('COMMAND', operation, version, request, reply);
  }

  @Put('api/customer-intakes/:intakeId/zip')
  async customerIntakeZip(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await reject(reply, correlationOf(request), CORE_ERROR_CODE.NOT_FOUND);
  }

  private async dispatchRoute(
    kind: 'QUERY' | 'COMMAND',
    operation: string,
    version: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const correlationId = correlationOf(request);
    try {
      const access = await this.authenticate(request);
      const response = await this.runtime.dispatch({
        kind,
        operation,
        version,
        body: request.body,
        context: access.context,
        sessionBinding: access.sessionBinding,
        correlationId,
      });
      await reply.status(response.status).send(response.payload);
    } catch (error) {
      await this.fail(reply, error, correlationId);
    }
  }

  /**
   * Validates the three trusted technical headers and verifies the access token.
   * A missing/invalid access token is 401 AUTHENTICATION_REQUIRED; a missing or
   * ill-formed session binding and a trust-config hash mismatch are 400
   * API_VALUE_INVALID.
   */
  private async authenticate(request: FastifyRequest): Promise<WorkspaceVerifiedAccess> {
    const authorization = headerValue(request, 'authorization');
    if (authorization === undefined || !/^Bearer\s+\S+$/u.test(authorization)) {
      throw new WorkspaceCoreError(CORE_ERROR_CODE.AUTHENTICATION_REQUIRED);
    }

    const trustConfigHash = headerValue(request, 'x-workspace-trust-config-hash');
    if (trustConfigHash === undefined || trustConfigHash !== this.runtime.trustConfigHash) {
      throw new WorkspaceCoreError(CORE_ERROR_CODE.API_VALUE_INVALID);
    }

    const sessionBinding = decodeSessionBinding(
      headerValue(request, 'x-workspace-session-binding'),
    );
    if (sessionBinding === undefined) {
      throw new WorkspaceCoreError(CORE_ERROR_CODE.API_VALUE_INVALID);
    }

    return this.runtime.verifyAccessToken({ authorization, sessionBinding });
  }

  private async fail(reply: FastifyReply, error: unknown, correlationId: string): Promise<void> {
    await reply.status(statusOfError(error)).send(toSafeBody(error, correlationId));
  }
}
