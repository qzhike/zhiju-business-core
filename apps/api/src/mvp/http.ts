import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  MvpError,
  mvpErrorMessage,
  mvpErrorRetryable,
  mvpErrorStatus,
  type MvpErrorCode,
} from '@zhiju/document-delivery';
import { isUuidV7 } from '@zhiju/shared-kernel';

import { StrictJsonError, parseStrictJson } from './json.js';
import type { MvpCoreRuntime, MvpVerifiedIdentity } from './runtime.js';

export const MVP_JSON_BODY_LIMIT = 64 * 1024;
export const MVP_UPLOAD_BODY_LIMIT = 104857600 + 1;

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined;
  return value;
}

function fail(code: MvpErrorCode): never {
  throw new MvpError(code);
}

function bodyRecord(request: FastifyRequest): Record<string, unknown> {
  const body: unknown = request.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) fail('INVALID_REQUEST');
  return body as Record<string, unknown>;
}

function queryParameters(request: FastifyRequest, allowed: readonly string[]): URLSearchParams {
  const url = request.raw.url ?? '';
  const index = url.indexOf('?');
  const parameters = new URLSearchParams(index === -1 ? '' : url.slice(index + 1));
  for (const key of parameters.keys()) {
    if (!allowed.includes(key) || parameters.getAll(key).length !== 1) fail('INVALID_REQUEST');
  }
  return parameters;
}

function pathParameters(request: FastifyRequest): Record<string, string> {
  const parameters: unknown = request.params;
  if (typeof parameters !== 'object' || parameters === null) fail('INVALID_REQUEST');
  return parameters as Record<string, string>;
}

function pathId(request: FastifyRequest, name: string): string {
  const value = pathParameters(request)[name];
  if (value === undefined || !isUuidV7(value)) fail('RESOURCE_NOT_FOUND');
  return value;
}

function idempotencyKey(request: FastifyRequest): string {
  const value = header(request, 'idempotency-key');
  if (value === undefined || !isUuidV7(value)) fail('INVALID_REQUEST');
  return value;
}

function limitParameter(
  parameters: URLSearchParams,
  name: string,
  fallback: number,
  maximum = 50,
): number {
  const value = parameters.get(name);
  if (value === null) return fallback;
  if (!/^[1-9][0-9]{0,2}$/u.test(value)) fail('INVALID_REQUEST');
  const parsed = Number(value);
  if (parsed > maximum) fail('INVALID_REQUEST');
  return parsed;
}

function cursorParameter(parameters: URLSearchParams, name: string): string | undefined {
  const value = parameters.get(name);
  if (value === null) return undefined;
  if (value.length === 0 || value.length > 4096) fail('INVALID_REQUEST');
  return value;
}

function observedAt(): string {
  return new Date().toISOString();
}

function sendSuccess(reply: FastifyReply, status: number, data: unknown, receipt?: unknown): void {
  reply
    .status(status)
    .header('content-type', 'application/json; charset=utf-8')
    .send({
      ok: true,
      data,
      ...(receipt === undefined ? {} : { receipt }),
      observedAt: observedAt(),
    });
}

function sendError(reply: FastifyReply, code: MvpErrorCode, requestId?: string): void {
  reply
    .status(mvpErrorStatus(code))
    .header('content-type', 'application/json; charset=utf-8')
    .send({
      ok: false,
      error: {
        code,
        message: mvpErrorMessage(code),
        ...(requestId === undefined ? {} : { requestId }),
        retryable: mvpErrorRetryable(code),
      },
      observedAt: observedAt(),
    });
}

function safeRequestId(request: FastifyRequest): string | undefined {
  const value = header(request, 'idempotency-key');
  return value !== undefined && isUuidV7(value) ? value : undefined;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object' && value !== null && Symbol.asyncIterator in value;
}

async function* byteChunks(stream: AsyncIterable<unknown>): AsyncIterable<Uint8Array> {
  for await (const chunk of stream) {
    if (chunk instanceof Uint8Array) yield chunk;
    else if (typeof chunk === 'string') yield Buffer.from(chunk, 'utf8');
    else fail('INVALID_REQUEST');
  }
}

function safeFileName(name: string): string {
  const ascii = name
    .replace(/[^\x20-\x7e]/gu, '_')
    .replace(/["\\]/gu, '_')
    .slice(0, 180);
  return ascii.length === 0 ? 'source' : ascii;
}

function disposition(name: string): string {
  const encoded = encodeURIComponent(name).replace(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${safeFileName(name)}"; filename*=UTF-8''${encoded}`;
}

async function authenticate(
  runtime: MvpCoreRuntime,
  request: FastifyRequest,
): Promise<MvpVerifiedIdentity> {
  return runtime.authenticate({
    remoteAddress: request.raw.socket.remoteAddress,
    headers: request.headers,
  });
}

/**
 * Registers only the finite `/api/mvp/v1` surface. There is no generic
 * dispatcher, upstream path proxy or fixture fallback in this composition.
 */
export function registerMvpTransport(server: FastifyInstance, runtime: MvpCoreRuntime): void {
  server.removeContentTypeParser('application/json');
  server.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => {
    try {
      done(null, parseStrictJson(typeof body === 'string' ? Buffer.from(body, 'utf8') : body));
    } catch (error) {
      done(error instanceof StrictJsonError ? error : new StrictJsonError());
    }
  });
  server.addContentTypeParser('application/zip', (_request, payload, done) => {
    done(null, payload);
  });

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof MvpError) {
      sendError(reply, error.code, safeRequestId(request));
      return;
    }
    if (error instanceof StrictJsonError) {
      sendError(reply, 'INVALID_REQUEST', safeRequestId(request));
      return;
    }
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : undefined;
    if (statusCode === 413) sendError(reply, 'INPUT_LIMIT_EXCEEDED', safeRequestId(request));
    else if (statusCode === 404) sendError(reply, 'RESOURCE_NOT_FOUND', safeRequestId(request));
    else if (statusCode !== undefined && statusCode >= 400 && statusCode < 500)
      sendError(reply, 'INVALID_REQUEST', safeRequestId(request));
    else sendError(reply, 'DEPENDENCY_UNAVAILABLE', safeRequestId(request));
  });

  server.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
  });

  server.get('/api/mvp/v1/session', async (request, reply) => {
    const identity = await authenticate(runtime, request);
    sendSuccess(reply, 200, runtime.service.session(identity));
  });

  server.put('/api/mvp/v1/projects/:projectId', async (request, reply) => {
    const identity = await authenticate(runtime, request);
    const requestId = idempotencyKey(request);
    const projectId = pathId(request, 'projectId');
    const body = bodyRecord(request);
    const outcome = await runtime.service.createProject(identity, {
      requestId,
      projectId,
      payload: body,
    });
    sendSuccess(reply, outcome.replayed ? 200 : 201, outcome.data, outcome.receipt);
  });

  server.get('/api/mvp/v1/projects', async (request, reply) => {
    const identity = await authenticate(runtime, request);
    const parameters = queryParameters(request, ['limit', 'cursor']);
    const page = await runtime.service.listProjects(
      identity,
      limitParameter(parameters, 'limit', 20),
      cursorParameter(parameters, 'cursor'),
    );
    sendSuccess(reply, 200, page);
  });

  server.get('/api/mvp/v1/projects/:projectId', async (request, reply) => {
    const identity = await authenticate(runtime, request);
    queryParameters(request, []);
    const project = await runtime.service.getProject(identity, pathId(request, 'projectId'));
    sendSuccess(reply, 200, { project });
  });

  server.put('/api/mvp/v1/projects/:projectId/batches/:batchId', async (request, reply) => {
    const identity = await authenticate(runtime, request);
    const requestId = idempotencyKey(request);
    const projectId = pathId(request, 'projectId');
    const batchId = pathId(request, 'batchId');
    const body = bodyRecord(request);
    const outcome = await runtime.service.createBatch(identity, {
      requestId,
      projectId,
      batchId,
      payload: body,
    });
    sendSuccess(reply, outcome.replayed ? 200 : 201, outcome.data, outcome.receipt);
  });

  server.get('/api/mvp/v1/projects/:projectId/batches', async (request, reply) => {
    const identity = await authenticate(runtime, request);
    const parameters = queryParameters(request, ['limit', 'cursor']);
    const page = await runtime.service.listBatches(
      identity,
      pathId(request, 'projectId'),
      limitParameter(parameters, 'limit', 20),
      cursorParameter(parameters, 'cursor'),
    );
    sendSuccess(reply, 200, page);
  });

  server.get('/api/mvp/v1/projects/:projectId/batches/:batchId', async (request, reply) => {
    const identity = await authenticate(runtime, request);
    const parameters = queryParameters(request, ['attemptLimit', 'attemptCursor']);
    const detail = await runtime.service.getBatch(
      identity,
      pathId(request, 'projectId'),
      pathId(request, 'batchId'),
      limitParameter(parameters, 'attemptLimit', 20),
      cursorParameter(parameters, 'attemptCursor'),
    );
    sendSuccess(reply, 200, detail);
  });

  server.get('/api/mvp/v1/projects/:projectId/batches/:batchId/entries', async (request, reply) => {
    const identity = await authenticate(runtime, request);
    const parameters = queryParameters(request, ['manifestId', 'limit', 'cursor']);
    const manifestId = parameters.get('manifestId');
    if (manifestId === null || !isUuidV7(manifestId)) fail('INVALID_REQUEST');
    const page = await runtime.service.getEntries(
      identity,
      pathId(request, 'projectId'),
      pathId(request, 'batchId'),
      manifestId,
      limitParameter(parameters, 'limit', 50, 100),
      cursorParameter(parameters, 'cursor'),
    );
    sendSuccess(reply, 200, page);
  });

  server.get('/api/mvp/v1/requests/:requestId', async (request, reply) => {
    const identity = await authenticate(runtime, request);
    queryParameters(request, []);
    const view = await runtime.service.getRequest(identity, pathId(request, 'requestId'));
    sendSuccess(reply, 200, view);
  });

  server.post(
    '/api/mvp/v1/projects/:projectId/batches/:batchId/recovery',
    async (request, reply) => {
      const identity = await authenticate(runtime, request);
      const requestId = idempotencyKey(request);
      const body = bodyRecord(request);
      const outcome = await runtime.service.recover(identity, {
        requestId,
        projectId: pathId(request, 'projectId'),
        batchId: pathId(request, 'batchId'),
        payload: body,
      });
      sendSuccess(reply, 200, outcome.data, outcome.receipt);
    },
  );

  server.put(
    '/api/mvp/v1/projects/:projectId/batches/:batchId/zip',
    { bodyLimit: MVP_UPLOAD_BODY_LIMIT },
    async (request, reply) => {
      const identity = await authenticate(runtime, request);
      queryParameters(request, []);
      const length = header(request, 'content-length');
      if (length === undefined || !/^[1-9][0-9]*$/u.test(length)) fail('INVALID_REQUEST');
      if (
        header(request, 'content-encoding') !== undefined ||
        header(request, 'range') !== undefined
      )
        fail('INVALID_REQUEST');
      const attemptId = header(request, 'x-mvp-upload-attempt');
      const generation = header(request, 'x-mvp-upload-generation');
      if (
        attemptId === undefined ||
        !isUuidV7(attemptId) ||
        generation === undefined ||
        !/^[1-9][0-9]{0,8}$/u.test(generation)
      )
        fail('INVALID_REQUEST');
      const body: unknown = request.body;
      if (!isAsyncIterable(body)) fail('INVALID_REQUEST');
      const result = await runtime.service.upload(identity, {
        projectId: pathId(request, 'projectId'),
        batchId: pathId(request, 'batchId'),
        attemptId,
        generation: Number(generation),
        contentLength: Number(length),
        chunks: byteChunks(body),
      });
      sendSuccess(reply, 202, { batch: result.batch });
    },
  );

  server.get(
    '/api/mvp/v1/projects/:projectId/batches/:batchId/sources/:sourceId/content',
    async (request, reply) => {
      const identity = await authenticate(runtime, request);
      queryParameters(request, []);
      if (header(request, 'range') !== undefined) fail('INVALID_REQUEST');
      const source = await runtime.service.readSource(
        identity,
        pathId(request, 'projectId'),
        pathId(request, 'batchId'),
        pathId(request, 'sourceId'),
      );
      reply
        .status(200)
        .header('content-type', source.sourceRef.mediaType)
        .header('content-length', String(source.bytes.length))
        .header('content-sha256', source.sourceRef.sha256)
        .header('content-disposition', disposition(source.fileName))
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'no-store')
        .header('accept-ranges', 'none')
        .send(source.bytes);
    },
  );
}
