// IM-03 WI-02 (issue #58): write-boundary guards for canonical JSONB ↔ hash
// and promoted scope/ref columns. Failures stay inside the owning
// transaction with stable codes and no payload echo.

import type { CanonicalJsonObject } from '@zhiju/shared-kernel';

export const ENTERPRISE_PAYLOAD_HASH_MISMATCH = 'ENTERPRISE_PAYLOAD_HASH_MISMATCH';
export const ENTERPRISE_PROMOTED_MIRROR_MISMATCH = 'ENTERPRISE_PROMOTED_MIRROR_MISMATCH';
export const ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH = 'ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH';

export class EnterprisePersistenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EnterprisePersistenceError';
  }
}

function expectString(value: unknown, field: string): string {
  return typeof value === 'string' ? value : throwMirrorMismatch(field);
}

function throwMirrorMismatch(field: string): never {
  throw new EnterprisePersistenceError(
    ENTERPRISE_PROMOTED_MIRROR_MISMATCH,
    `canonical payload is missing promoted field ${field}`,
  );
}

/**
 * Repository-level promoted-mirror validation. The database additionally
 * guards outbox enterpriseId/projectId with a trigger; this check keeps the
 * failure inside the owning transaction with a stable code.
 */
export function validatePromotedMirror(
  payload: CanonicalJsonObject,
  promoted: Readonly<Record<string, unknown>>,
): void {
  for (const [field, expected] of Object.entries(promoted)) {
    const actual = payload[field];
    if (expected instanceof Date) {
      if (new Date(expectString(actual, field)).getTime() !== expected.getTime()) {
        throw new EnterprisePersistenceError(
          ENTERPRISE_PROMOTED_MIRROR_MISMATCH,
          `canonical payload ${field} does not match promoted column`,
        );
      }
      continue;
    }
    if (expected === null || expected === undefined) {
      if (actual !== undefined && actual !== null) {
        throw new EnterprisePersistenceError(
          ENTERPRISE_PROMOTED_MIRROR_MISMATCH,
          `canonical payload ${field} does not match promoted column`,
        );
      }
      continue;
    }
    if (
      typeof expected !== 'string' &&
      typeof expected !== 'number' &&
      typeof expected !== 'boolean'
    ) {
      throwMirrorMismatch(field);
    }
    const actualText = expectString(actual, field);
    if (actualText !== String(expected)) {
      throw new EnterprisePersistenceError(
        ENTERPRISE_PROMOTED_MIRROR_MISMATCH,
        `canonical payload ${field} does not match promoted column`,
      );
    }
  }
}

/** Rejects a caller-declared hash that disagrees with the canonical bytes. */
export function assertHashMatches(
  digest: { hash: Buffer; canonicalJson: string },
  expectedHash?: Buffer,
): void {
  if (expectedHash !== undefined && !digest.hash.equals(expectedHash)) {
    throw new EnterprisePersistenceError(
      ENTERPRISE_PAYLOAD_HASH_MISMATCH,
      'declared payload hash does not match the canonical payload',
    );
  }
}
