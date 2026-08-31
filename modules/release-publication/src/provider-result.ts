// IM-05 WI-07 (issue #127): provider-result minimization boundary.
// Provider payloads are untrusted external data. Only the sanitized value may
// cross the Formal Receipt, Event, Error, or logging boundary.

import type { CanonicalJson } from '@zhiju/contracts';
import type { CanonicalJsonValue } from '@zhiju/shared-kernel';

const sensitiveKeyPattern =
  /(?:address|body|content|credential|email|location|message(?:body|content|text|value)?$|mobile|name|password|phone|recipient|secret|subject|token|url|user)/iu;
const sensitiveStringPatterns = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu,
  /(?:\+?\d[\d ()-]{7,}\d)/u,
  /bearer\s+[A-Z0-9._~+/=-]+/iu,
];

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

function sanitize(value: CanonicalJsonValue, path: string, redactedPaths: string[]): CanonicalJson {
  if (typeof value === 'string') {
    if (shouldRedactString(value)) {
      redactedPaths.push(path);
      return REDACTED_VALUE;
    }
    return value;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
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
    if (sensitiveKeyPattern.test(key)) {
      redactedPaths.push(childPath);
      result[key] = REDACTED_VALUE;
      continue;
    }
    result[key] = sanitize(child, childPath, redactedPaths);
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
  return {
    value: sanitize(value, '', redactedPaths),
    redactedPaths,
  };
}

export function providerResultContainsSensitiveData(value: CanonicalJson): boolean {
  return sanitizeProviderResult(value).redactedPaths.length > 0;
}
