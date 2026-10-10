import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Closed set of Experience/BFF interaction codes (UI01 Module Spec §9). These
 * never enter the Business Core Catalog and never replace a Core ApiError code.
 */
export const UI_ERROR = {
  SESSION_EXPIRED: 'UI_SESSION_EXPIRED',
  REAUTH_REQUIRED: 'UI_REAUTH_REQUIRED',
  CSRF_REJECTED: 'UI_CSRF_REJECTED',
  ORIGIN_REJECTED: 'UI_ORIGIN_REJECTED',
  SERVICE_NOT_CONFIGURED: 'UI_SERVICE_NOT_CONFIGURED',
  CLIENT_STATE_INVALID: 'UI_CLIENT_STATE_INVALID',
} as const;

export type UiErrorCode = (typeof UI_ERROR)[keyof typeof UI_ERROR];

export const CORE_ERROR = {
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
} as const;

/**
 * Technical pre-session failures expose exactly these four fields: no token,
 * no Subject, no Core code and no customer content ever leaks into them.
 */
export interface SafeErrorBody {
  code: string;
  message: string;
  retryable: boolean;
  correlationId: string;
}

export function safeErrorBody(
  code: string,
  message: string,
  retryable: boolean,
  correlation: string,
): SafeErrorBody {
  return { code, message, retryable, correlationId: correlation };
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Hash-then-compare keeps the comparison length-independent and constant time. */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const left = createHash('sha256').update(a, 'utf8').digest();
  const right = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(left, right);
}

/** UUIDv7, used for BFF-generated correlation ids and opaque request identifiers. */
export function uuidV7(timestampMs: number = Date.now()): string {
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

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
}

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Strict UUIDv7, the only identifier form the trusted document/refs may use. */
export function isUuidV7(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
