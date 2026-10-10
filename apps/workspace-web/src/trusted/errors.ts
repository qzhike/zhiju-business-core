// Failure classification for BFF/Core responses.
//
// Module-Spec-UI01 §9 keeps the Experience-local codes separate from the
// Business Core Catalog. This module reads only `code`, `retryable` and
// `correlationId` from an error body: a safe reason code plus its retry
// disposition is what the contract guarantees, and the rendered copy is chosen
// locally per code so no unvalidated server text (which could carry a token,
// Subject or customer content) can reach the DOM.

import { asBoolean, asNonEmptyString, asRecord } from './values.js';

export type FailureKind = 'SESSION' | 'DENIED' | 'NOT_FOUND' | 'UNAVAILABLE' | 'CURSOR' | 'ERROR';

export interface ApiFailure {
  readonly httpStatus: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly correlationId: string | null;
}

const CURSOR_CODES: Record<string, true> = {
  QUERY_CURSOR_SCOPE_MISMATCH: true,
  QUERY_CURSOR_EXPIRED: true,
  QUERY_CURSOR_INVALID: true,
};

const SESSION_CODES: Record<string, true> = {
  AUTHENTICATION_REQUIRED: true,
  AUTHORIZATION_EXPIRED: true,
  UI_SESSION_EXPIRED: true,
  UI_REAUTH_REQUIRED: true,
};

const DENIED_CODES: Record<string, true> = {
  ACCESS_DENIED: true,
  AUTHORIZATION_DECISION_REQUIRED: true,
  AUTHORIZATION_DECISION_INVALID: true,
  AUTHORIZATION_REVOKED: true,
  HUMAN_ONLY_CAPABILITY: true,
  SCOPE_MISMATCH: true,
  PROJECT_SCOPE_MISMATCH: true,
};

const UNAVAILABLE_CODES: Record<string, true> = {
  DEPENDENCY_UNAVAILABLE: true,
  UI_SERVICE_NOT_CONFIGURED: true,
  INTERNAL_CONTRACT_VIOLATION: true,
};

function fallbackCode(httpStatus: number): string {
  if (httpStatus === 401) return 'AUTHENTICATION_REQUIRED';
  if (httpStatus === 403) return 'ACCESS_DENIED';
  if (httpStatus === 404) return 'NOT_FOUND';
  if (httpStatus >= 500) return 'DEPENDENCY_UNAVAILABLE';
  return 'UI_CLIENT_STATE_INVALID';
}

/** Reads the closed `{code, retryable, correlationId}` surface of an error body. */
export function readApiFailure(httpStatus: number, body: unknown): ApiFailure {
  const outer = asRecord(body);
  const record = (outer === null ? null : asRecord(outer.error)) ?? outer ?? {};
  return {
    httpStatus,
    code: asNonEmptyString(record.code) ?? fallbackCode(httpStatus),
    retryable: asBoolean(record.retryable) ?? (httpStatus >= 500 || httpStatus === 429),
    correlationId: asNonEmptyString(record.correlationId),
  };
}

export function classifyFailure(failure: ApiFailure): FailureKind {
  if (CURSOR_CODES[failure.code] === true) return 'CURSOR';
  if (SESSION_CODES[failure.code] === true || failure.httpStatus === 401) return 'SESSION';
  if (DENIED_CODES[failure.code] === true || failure.httpStatus === 403) return 'DENIED';
  if (UNAVAILABLE_CODES[failure.code] === true || failure.httpStatus >= 500) return 'UNAVAILABLE';
  if (failure.httpStatus === 404) return 'NOT_FOUND';
  return 'ERROR';
}
