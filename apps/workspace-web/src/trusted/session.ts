// Session probe, safe return routes and the bounded legacy probe.
//
// `GET /bff/session` is the authoritative boot read (no-store): its
// `accessState` is derived by the BFF from the technical session cookie and the
// Core identity bootstrap, never from anything the browser claims. This module
// maps that response into the closed access vocabulary of Module-Spec-UI01 §4
// plus the deployment-unavailable case the engineering shell must keep
// degrading to.

import { asNonEmptyString, asRecord } from './values.js';

export type AccessState =
  'ALLOWED' | 'DENIED' | 'SESSION_EXPIRED' | 'REAUTH_REQUIRED' | 'UNAVAILABLE';

export interface SessionPrincipal {
  readonly principalId: string;
  readonly principalKind: string;
  readonly displayName: string | null;
}

export interface LiveSession {
  readonly sessionGeneration: string;
  readonly csrfToken: string;
  readonly expiresAt: string | null;
  readonly idleExpiresAt: string | null;
  readonly principal: SessionPrincipal;
}

export interface SessionProbe {
  readonly state: AccessState;
  readonly code: string;
  readonly session: LiveSession | null;
}

export const WORKBENCH_ROUTE = '/workbench';

const RETURN_ROUTE =
  /^\/(?:workbench(?:\?[A-Za-z0-9_=&.-]{0,120})?|projects\/new|projects\/[A-Za-z0-9_-]{1,64}\/(?:intake|(?:analysis|startup|executions)\/[A-Za-z0-9_-]{1,64}))$/u;

const CALLBACK_PARAMETERS = [
  'error',
  'error_description',
  'error_uri',
  'session_state',
  'iss',
  'state',
  'code',
];

export const UNAVAILABLE_PROBE: SessionProbe = {
  state: 'UNAVAILABLE',
  code: 'UI_SERVICE_NOT_CONFIGURED',
  session: null,
};

/**
 * Legacy engineering-shell probe (`GET /bff/bootstrap`). Its exact unconfigured
 * payload must stay reachable, so it is validated and used only to word the
 * "not configured" state; it never supplies identity or business data.
 */
export function isLegacyUnconfiguredBootstrap(body: unknown): boolean {
  const record = asRecord(body);
  if (record === null) return false;
  return record.accessState === 'REAUTH_REQUIRED' && record.businessActionsEnabled === false;
}

function readLiveSession(record: Record<string, unknown>): LiveSession | null {
  const sessionGeneration = asNonEmptyString(record.sessionGeneration);
  const csrfToken = asNonEmptyString(record.csrfToken);
  const principal = asRecord(record.principal);
  const principalId = principal === null ? null : asNonEmptyString(principal.principalId);
  const principalKind = principal === null ? null : asNonEmptyString(principal.principalKind);
  if (sessionGeneration === null || csrfToken === null || principalId === null) return null;
  if (principalKind !== 'HUMAN') return null;
  const displayName = principal === null ? null : asNonEmptyString(principal.displayName);
  return {
    sessionGeneration,
    csrfToken,
    expiresAt: asNonEmptyString(record.expiresAt),
    idleExpiresAt: asNonEmptyString(record.idleExpiresAt),
    principal: { principalId, principalKind, displayName },
  };
}

export function readSessionProbe(httpStatus: number, body: unknown): SessionProbe {
  const record = asRecord(body);
  if (record === null) return UNAVAILABLE_PROBE;
  const accessState = asNonEmptyString(record.accessState);
  const code = asNonEmptyString(record.code) ?? '';
  if (httpStatus === 403 || accessState === 'DENIED') {
    return { state: 'DENIED', code: code.length > 0 ? code : 'ACCESS_DENIED', session: null };
  }
  if (accessState === 'REAUTH_REQUIRED') {
    return { state: 'REAUTH_REQUIRED', code: 'UI_REAUTH_REQUIRED', session: null };
  }
  if (accessState === 'SESSION_EXPIRED') {
    return { state: 'SESSION_EXPIRED', code: 'UI_SESSION_EXPIRED', session: null };
  }
  if (accessState === 'ALLOWED' && httpStatus === 200) {
    const session = readLiveSession(record);
    return session === null
      ? { state: 'UNAVAILABLE', code: 'UI_CLIENT_STATE_INVALID', session: null }
      : { state: 'ALLOWED', code: 'UI_SERVICE_OK', session };
  }
  if (code.length > 0) return { state: 'UNAVAILABLE', code, session: null };
  return UNAVAILABLE_PROBE;
}

/**
 * A return route is only ever an approved same-origin UI page (plus an optional
 * safe request id segment). Schemes, `//`, backslashes, `..`, fragments,
 * percent-encoding and control characters fall back to the workbench.
 */
export function safeReturnTo(candidate: string | null | undefined): string {
  if (
    typeof candidate === 'string' &&
    /^\/preparations\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\?enterprise=[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}&project=[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:&intake=[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?$/.test(
      candidate,
    )
  )
    return candidate;
  // Exact Markdown links carry non-secret, bounded reference bindings through login.
  if (
    typeof candidate === 'string' &&
    /^\/projects\/[0-9a-f-]{36}\/artifacts\/[0-9a-f-]{36}\/revisions\/[0-9a-f-]{36}\?binding=[A-Za-z0-9_-]{1,12000}$/.test(
      candidate,
    )
  ) {
    return candidate;
  }
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 200) {
    return WORKBENCH_ROUTE;
  }
  if (candidate.includes('\\') || candidate.includes('..') || candidate.includes('#')) {
    return WORKBENCH_ROUTE;
  }
  return RETURN_ROUTE.test(candidate) ? candidate : WORKBENCH_ROUTE;
}

export function signInHref(returnTo: string): string {
  return `/bff/auth/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

/**
 * A callback failure redirects back with an `error` parameter. The value is
 * never read, shown or logged; only its presence matters.
 */
export function hasCallbackFailure(search: string): boolean {
  return new URLSearchParams(search).has('error');
}

/** Removes callback-only parameters so a failed login leaves no trace in the URL. */
export function stripCallbackParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of CALLBACK_PARAMETERS) params.delete(key);
  return params.toString();
}
