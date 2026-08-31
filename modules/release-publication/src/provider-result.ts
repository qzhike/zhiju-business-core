// IM-05 WI-07 (issue #127): provider-result minimization boundary.
// Provider payloads are untrusted external data. Only the sanitized value may
// cross the Formal Receipt, Event, Error, or logging boundary.

import type { CanonicalJson } from '@zhiju/contracts';
import type { CanonicalJsonValue } from '@zhiju/shared-kernel';

const sensitiveStringPatterns = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
  /(?:\+?\d[\d ()-]{7,}\d)/u,
  /bearer\s+[A-Z0-9._~+/=-]+/iu,
  /https?:\/\/[^\s]+/iu,
];

const SAFE_PROVIDER_RESULT_KEYS = new Set([
  'attemptNumber',
  'deliveryId',
  'errorCode',
  'messageId',
  'outcome',
  'providerAttemptId',
  'providerCode',
  'providerMessageId',
  'providerRequestId',
  'providerStatus',
  'reasonCode',
  'requestId',
  'retryable',
  'status',
  'traceId',
]);

const SAFE_PROVIDER_IDENTIFIER_KEYS = new Set([
  'deliveryId',
  'messageId',
  'providerAttemptId',
  'providerMessageId',
  'providerRequestId',
  'requestId',
  'traceId',
]);

const SAFE_PROVIDER_STATUS_KEYS = new Set([
  'errorCode',
  'outcome',
  'providerCode',
  'providerStatus',
  'reasonCode',
  'status',
]);

const REDACTED_VALUE = Object.freeze({
  redacted: true,
  reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED',
} satisfies CanonicalJson);

export interface SanitizedProviderResult {
  readonly value: CanonicalJson;
  readonly redactedPaths: readonly string[];
}

function shouldRedactString(value: string): boolean {
  return sensitiveStringPatterns.some((pattern) => pattern.test(value));
}

function redacted(path: string, redactedPaths: string[]): CanonicalJson {
  redactedPaths.push(path);
  return REDACTED_VALUE;
}

function isSafeProviderScalar(key: string, value: CanonicalJsonValue): boolean {
  if (key === 'attemptNumber') return typeof value === 'number' && Number.isInteger(value);
  if (key === 'retryable') return typeof value === 'boolean';
  if (SAFE_PROVIDER_IDENTIFIER_KEYS.has(key)) {
    return (
      typeof value === 'string' &&
      /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u.test(value) &&
      !shouldRedactString(value)
    );
  }
  if (SAFE_PROVIDER_STATUS_KEYS.has(key)) {
    return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/u.test(value);
  }
  return false;
}

function sanitize(
  value: CanonicalJsonValue,
  path: string,
  redactedPaths: string[],
  key?: string,
): CanonicalJson {
  if (key !== undefined && value !== null && typeof value === 'object') {
    return redacted(path, redactedPaths);
  }
  if (typeof value === 'string') {
    if (key !== undefined && !isSafeProviderScalar(key, value)) {
      return redacted(path, redactedPaths);
    }
    if (shouldRedactString(value)) {
      return redacted(path, redactedPaths);
    }
    return value;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    if (key === undefined && path !== '') {
      return redacted(path, redactedPaths);
    }
    if (key !== undefined && !isSafeProviderScalar(key, value)) {
      return redacted(path, redactedPaths);
    }
    return value;
  }
  if (Array.isArray(value)) {
    return Array.from(value, (item: CanonicalJsonValue, index) =>
      sanitize(item, `${path}/${String(index)}`, redactedPaths),
    );
  }
  const result: Record<string, CanonicalJson> = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    if (!SAFE_PROVIDER_RESULT_KEYS.has(key)) {
      redactedPaths.push(childPath);
      continue;
    }
    result[key] = sanitize(child, childPath, redactedPaths, key);
  }
  return result;
}

/**
 * Recursively removes PII and secret-like values without retaining the input
 * value in an error or diagnostic object. Safe provider identifiers such as
 * `messageId` are intentionally retained only when their key/value is safe.
 */
export function sanitizeProviderResult(value: CanonicalJson): SanitizedProviderResult {
  const redactedPaths: string[] = [];
  if (value === null || typeof value !== 'object') {
    return { value: redacted('', redactedPaths), redactedPaths };
  }
  if (Array.isArray(value)) {
    return { value: redacted('', redactedPaths), redactedPaths };
  }
  return {
    value: sanitize(value, '', redactedPaths),
    redactedPaths,
  };
}

export function providerResultContainsSensitiveData(value: CanonicalJson): boolean {
  return sanitizeProviderResult(value).redactedPaths.length > 0;
}
