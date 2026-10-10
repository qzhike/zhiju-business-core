// IM-UI-01 (#258): the closed, transport-safe failure surface of the Core
// workspace entry. Session Delta §5/§6 freeze the public status/code table:
// a Browser must never be able to probe whether an object exists, whether
// another Principal is linked or how a dependency failed, so every failure of
// this entry is expressed with one of the codes below and an HTTP status.
//
// The safe body carries a code, a fixed sentence from this closed table, its
// retry disposition and a server-generated correlation id — never a token, a
// Subject, a customer datum, a payload, a stack trace or a dependency message.
// `retryable` is informational only: it is not a permission to resend a
// business Command (Session Delta §7: business writes are never auto-retried).

import { randomBytes } from 'node:crypto';

/**
 * The frozen public codes of this transport. They are the only thing a client
 * may branch on; each maps to exactly one status below.
 */
export const CORE_ERROR_CODE = {
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  AUTHORIZATION_REVOKED: 'AUTHORIZATION_REVOKED',
  NOT_FOUND: 'NOT_FOUND',
  API_VALUE_INVALID: 'API_VALUE_INVALID',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  QUERY_CURSOR_SCOPE_MISMATCH: 'QUERY_CURSOR_SCOPE_MISMATCH',
  QUERY_CURSOR_EXPIRED: 'QUERY_CURSOR_EXPIRED',
  QUERY_CURSOR_INVALID: 'QUERY_CURSOR_INVALID',
} as const;

export type CoreErrorCode = (typeof CORE_ERROR_CODE)[keyof typeof CORE_ERROR_CODE];

/** Dispositions of the frozen table; `UNKNOWN` means "not decidable here". */
export type CoreRetryDisposition = 'RETRYABLE' | 'NOT_RETRYABLE' | 'UNKNOWN';

export interface CoreErrorEntry {
  readonly status: number;
  readonly retryDisposition: CoreRetryDisposition;
  /** Fixed, non-interpolated sentence: safe to render for any request. */
  readonly message: string;
}

/**
 * The single closed status/code table (Session Delta §4/§5/§6):
 *
 * - unknown or non-allowlisted operation -> 404 `NOT_FOUND`;
 * - allowlisted operation without an owning handler -> 503
 *   `DEPENDENCY_UNAVAILABLE` (same code as a dependency failure);
 * - missing/invalid token or trust binding -> 401 `AUTHENTICATION_REQUIRED`;
 * - authenticated but without a linked ACTIVE HUMAN -> 403 `ACCESS_DENIED`;
 * - revoked or expired authorization -> 403 `AUTHORIZATION_REVOKED`;
 * - structurally invalid input -> 400 `API_VALUE_INVALID`.
 *
 * The directory cursor codes are request-state failures: the client must
 * restart the enumeration at page one instead of retrying the same cursor, so
 * they are `API_VALUE_INVALID`-class 400s (the Experience layer classifies all
 * three as `CURSOR` regardless of status).
 */
export const CORE_ERROR_TABLE: Readonly<Record<CoreErrorCode, CoreErrorEntry>> = Object.freeze({
  [CORE_ERROR_CODE.AUTHENTICATION_REQUIRED]: Object.freeze({
    status: 401,
    retryDisposition: 'NOT_RETRYABLE',
    message: 'Authentication required',
  }),
  [CORE_ERROR_CODE.ACCESS_DENIED]: Object.freeze({
    status: 403,
    retryDisposition: 'NOT_RETRYABLE',
    message: 'Access denied',
  }),
  [CORE_ERROR_CODE.AUTHORIZATION_REVOKED]: Object.freeze({
    status: 403,
    retryDisposition: 'NOT_RETRYABLE',
    message: 'Authorization is no longer current',
  }),
  [CORE_ERROR_CODE.NOT_FOUND]: Object.freeze({
    status: 404,
    retryDisposition: 'NOT_RETRYABLE',
    message: 'Not found',
  }),
  [CORE_ERROR_CODE.API_VALUE_INVALID]: Object.freeze({
    status: 400,
    retryDisposition: 'NOT_RETRYABLE',
    message: 'Invalid request',
  }),
  [CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE]: Object.freeze({
    status: 503,
    retryDisposition: 'RETRYABLE',
    message: 'Service temporarily unavailable',
  }),
  [CORE_ERROR_CODE.QUERY_CURSOR_SCOPE_MISMATCH]: Object.freeze({
    status: 400,
    retryDisposition: 'NOT_RETRYABLE',
    message: 'Invalid request',
  }),
  [CORE_ERROR_CODE.QUERY_CURSOR_EXPIRED]: Object.freeze({
    status: 400,
    retryDisposition: 'NOT_RETRYABLE',
    message: 'Invalid request',
  }),
  [CORE_ERROR_CODE.QUERY_CURSOR_INVALID]: Object.freeze({
    status: 400,
    retryDisposition: 'NOT_RETRYABLE',
    message: 'Invalid request',
  }),
});

/** Failure of an unexpected cause: reported as a dependency failure, not as success. */
const FALLBACK_ENTRY: CoreErrorEntry = CORE_ERROR_TABLE[CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE];

export interface WorkspaceCoreErrorOptions {
  /** Internal diagnostic sentence; it is never serialized by `toSafeBody`. */
  readonly message?: string;
  readonly retryDisposition?: CoreRetryDisposition;
}

/** The only error type this transport maps to a public status/code pair. */
export class WorkspaceCoreError extends Error {
  readonly code: CoreErrorCode;
  readonly status: number;
  readonly retryDisposition: CoreRetryDisposition;

  constructor(code: CoreErrorCode, options: WorkspaceCoreErrorOptions = {}) {
    const entry = CORE_ERROR_TABLE[code];
    super(options.message ?? entry.message);
    this.name = 'WorkspaceCoreError';
    this.code = code;
    this.status = entry.status;
    this.retryDisposition = options.retryDisposition ?? entry.retryDisposition;
  }
}

export interface SafeErrorBody {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly correlationId: string;
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Server-generated UuidV7 correlation id (never derived from request input). */
export function newCorrelationId(timestampMs: number = Date.now()): string {
  const bytes = randomBytes(16);
  let remaining = BigInt(Math.trunc(timestampMs));
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The HTTP status this failure is reported with; unexpected causes are 503. */
export function statusOfError(error: unknown): number {
  return error instanceof WorkspaceCoreError ? error.status : FALLBACK_ENTRY.status;
}

/**
 * Projects any failure onto the closed public body. The body is built only
 * from the frozen table, the retry disposition and a server-generated
 * correlation id: no message, code or field of the original failure is echoed,
 * so a dependency message or a customer value cannot leak.
 */
export function toSafeBody(error: unknown, correlationId?: string): SafeErrorBody {
  const core = error instanceof WorkspaceCoreError ? error : undefined;
  const entry = core === undefined ? FALLBACK_ENTRY : CORE_ERROR_TABLE[core.code];
  return {
    code: core === undefined ? CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE : core.code,
    message: entry.message,
    retryable: (core?.retryDisposition ?? entry.retryDisposition) === 'RETRYABLE',
    correlationId:
      correlationId !== undefined && UUID_V7_PATTERN.test(correlationId)
        ? correlationId
        : newCorrelationId(),
  };
}
