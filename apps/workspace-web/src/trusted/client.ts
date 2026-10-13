// BFF client for the trusted journey.
//
// Every protected read is a POST that carries the session cookie (same-origin),
// the exact operation/version in the path *and* the body, the in-memory CSRF
// token and nothing else: no Authorization header, no actor/decision field, no
// upstream URL. Responses are `no-store` and never cached by the browser.

import type { ApiFailure } from './errors.js';
import type { ResponseTag } from './guard.js';
import { nowInstant, queryRoute, uuidV7 } from './identity.js';
import { BffFailure, readQueryResult, type ParsedPage } from './protocol.js';
import type { PageObservation } from './pagination.js';
import { isLegacyUnconfiguredBootstrap, readSessionProbe, type SessionProbe } from './session.js';
import type { JsonRecord } from './values.js';

const REQUEST_TIMEOUT_MS = 15_000;

export interface QueryIdentity {
  readonly sessionGeneration: string;
  readonly principalId: string;
  readonly operation: string;
  readonly version: string;
  readonly scopeKey: string;
}

export interface PageFetch<T> {
  readonly tag: ResponseTag;
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly observation: PageObservation;
}

interface WireResponse {
  readonly status: number;
  readonly body: unknown;
}

export async function readExactQuery(
  operation: string,
  scopeRef: JsonRecord,
  payload: JsonRecord,
  csrfToken: string,
  signal: AbortSignal,
): Promise<unknown> {
  const queryId = uuidV7();
  const response = await requestJson(
    queryRoute(operation, '1.0'),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify({
        queryId,
        type: operation,
        version: '1.0',
        scopeRef,
        consistencyRequirement: 'AUTHORITATIVE',
        correlationId: uuidV7(),
        requestedAt: nowInstant(),
        payload,
      }),
    },
    signal,
  );
  const result = readQueryResult(response.status, response.body);
  if (result.freshness !== 'FRESH' || (response.body as { queryId?: unknown }).queryId !== queryId)
    throw new Error('Unexpected exact read response');
  return result.data;
}

async function requestJson(
  path: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<WireResponse> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
  });
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, body };
}

/** Maps any thrown request error to a fail-closed failure (never an empty page). */
export function failureFromUnknown(error: unknown, fallbackCode: string): ApiFailure {
  if (error instanceof BffFailure) return error.api;
  return { httpStatus: 0, code: fallbackCode, retryable: true, correlationId: null };
}

export async function fetchSession(signal?: AbortSignal): Promise<SessionProbe> {
  const response = await requestJson(
    '/bff/session',
    { method: 'GET', headers: { accept: 'application/json' } },
    signal,
  );
  return readSessionProbe(response.status, response.body);
}

/** Legacy unconfigured probe; its exact payload is the only accepted success. */
export async function fetchLegacyUnconfigured(signal?: AbortSignal): Promise<boolean> {
  const response = await requestJson(
    '/bff/bootstrap',
    { method: 'GET', headers: { accept: 'application/json' } },
    signal,
  );
  return response.status === 200 && isLegacyUnconfiguredBootstrap(response.body);
}

export async function postLogout(csrfToken: string, signal?: AbortSignal): Promise<number> {
  const response = await requestJson(
    '/bff/auth/logout',
    { method: 'POST', headers: { 'x-csrf-token': csrfToken, accept: 'application/json' } },
    signal,
  );
  return response.status;
}

/** Explicit user activity may renew the idle window at most once per minute. */
export async function postActivity(csrfToken: string, signal?: AbortSignal): Promise<void> {
  await requestJson(
    '/bff/session/activity',
    { method: 'POST', headers: { 'x-csrf-token': csrfToken, accept: 'application/json' } },
    signal,
  );
}

export interface PageQueryArgs<T> {
  readonly identity: QueryIdentity;
  readonly generation: number;
  readonly csrfToken: string;
  readonly cursor: string | null;
  readonly signal?: AbortSignal;
  readonly buildBody: (ids: {
    readonly queryId: string;
    readonly correlationId: string;
    readonly requestedAt: string;
    readonly cursor: string | null;
  }) => JsonRecord;
  readonly parsePage: (data: unknown) => ParsedPage<T>;
}

export async function readQueryPage<T>(args: PageQueryArgs<T>): Promise<PageFetch<T>> {
  const queryId = uuidV7();
  const correlationId = uuidV7();
  const requestedAt = nowInstant();
  const body = args.buildBody({ queryId, correlationId, requestedAt, cursor: args.cursor });
  const response = await requestJson(
    queryRoute(args.identity.operation, args.identity.version),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-csrf-token': args.csrfToken,
      },
      body: JSON.stringify(body),
    },
    args.signal,
  );
  const result = readQueryResult(response.status, response.body);
  const page = args.parsePage(result.data);
  return {
    tag: {
      generation: args.generation,
      principalId: args.identity.principalId,
      scopeKey: args.identity.scopeKey,
    },
    items: page.items,
    nextCursor: page.nextCursor,
    observation: {
      resultStatus: result.resultStatus,
      freshness: result.freshness,
      snapshotAt: page.snapshotAt,
      sourceWatermarks: page.sourceWatermarks,
    },
  };
}
