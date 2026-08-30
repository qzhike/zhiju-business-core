// IM-05 WI-01 (issue #121): stable persistence-boundary errors for canonical
// hashes, promoted scope mirrors, and trusted attribution.

import type { CanonicalJsonObject } from '@zhiju/shared-kernel';

export const QUALITY_PAYLOAD_HASH_MISMATCH = 'QUALITY_PAYLOAD_HASH_MISMATCH';
export const QUALITY_PROMOTED_MIRROR_MISMATCH = 'QUALITY_PROMOTED_MIRROR_MISMATCH';
export const QUALITY_CONTEXT_PRINCIPAL_MISMATCH = 'QUALITY_CONTEXT_PRINCIPAL_MISMATCH';
export const QUALITY_CONTEXT_SCOPE_MISMATCH = 'QUALITY_CONTEXT_SCOPE_MISMATCH';

export class QualityPersistenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'QualityPersistenceError';
  }
}

function mirrorMismatch(field: string): never {
  throw new QualityPersistenceError(
    QUALITY_PROMOTED_MIRROR_MISMATCH,
    `canonical payload does not match promoted field ${field}`,
  );
}

export function validatePromotedMirror(
  payload: CanonicalJsonObject,
  promoted: Readonly<Record<string, string | number | boolean | Date | null | undefined>>,
): void {
  for (const [field, expected] of Object.entries(promoted)) {
    const actual = payload[field];
    if (expected instanceof Date) {
      if (typeof actual !== 'string' || new Date(actual).getTime() !== expected.getTime()) {
        mirrorMismatch(field);
      }
    } else if (expected === null || expected === undefined) {
      if (actual !== null && actual !== undefined) mirrorMismatch(field);
    } else if (typeof actual !== 'string' || actual !== String(expected)) {
      mirrorMismatch(field);
    }
  }
}

export function assertHashMatches(digest: { readonly hash: Buffer }, expectedHash?: Buffer): void {
  if (expectedHash !== undefined && !digest.hash.equals(expectedHash)) {
    throw new QualityPersistenceError(
      QUALITY_PAYLOAD_HASH_MISMATCH,
      'declared payload hash does not match the canonical payload',
    );
  }
}
