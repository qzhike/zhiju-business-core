// IM-04 WI-02 (issue #91): stable repository write-boundary errors for
// canonical payload hashes, promoted scope mirrors and trusted principals.

import type { CanonicalJsonObject } from '@zhiju/shared-kernel';

export const ARTIFACT_PAYLOAD_HASH_MISMATCH = 'ARTIFACT_PAYLOAD_HASH_MISMATCH';
export const ARTIFACT_PROMOTED_MIRROR_MISMATCH = 'ARTIFACT_PROMOTED_MIRROR_MISMATCH';
export const ARTIFACT_CONTEXT_PRINCIPAL_MISMATCH = 'ARTIFACT_CONTEXT_PRINCIPAL_MISMATCH';
export const ARTIFACT_CONTEXT_SCOPE_MISMATCH = 'ARTIFACT_CONTEXT_SCOPE_MISMATCH';

export class ArtifactPersistenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ArtifactPersistenceError';
  }
}

function expectString(value: unknown, field: string): string {
  return typeof value === 'string' ? value : throwMirrorMismatch(field);
}

function throwMirrorMismatch(field: string): never {
  throw new ArtifactPersistenceError(
    ARTIFACT_PROMOTED_MIRROR_MISMATCH,
    `canonical payload is missing promoted field ${field}`,
  );
}

/** Validates that promoted database columns equal canonical payload fields. */
export function validatePromotedMirror(
  payload: CanonicalJsonObject,
  promoted: Readonly<Record<string, unknown>>,
): void {
  for (const [field, expected] of Object.entries(promoted)) {
    const actual = payload[field];
    if (expected instanceof Date) {
      if (new Date(expectString(actual, field)).getTime() !== expected.getTime()) {
        throw new ArtifactPersistenceError(
          ARTIFACT_PROMOTED_MIRROR_MISMATCH,
          `canonical payload ${field} does not match promoted column`,
        );
      }
      continue;
    }
    if (expected === null || expected === undefined) {
      if (actual !== undefined && actual !== null) {
        throw new ArtifactPersistenceError(
          ARTIFACT_PROMOTED_MIRROR_MISMATCH,
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
      throw new ArtifactPersistenceError(
        ARTIFACT_PROMOTED_MIRROR_MISMATCH,
        `canonical payload ${field} does not match promoted column`,
      );
    }
  }
}

/** Rejects a caller-declared hash that disagrees with canonical bytes. */
export function assertHashMatches(
  digest: { hash: Buffer; canonicalJson: string },
  expectedHash?: Buffer,
): void {
  if (expectedHash !== undefined && !digest.hash.equals(expectedHash)) {
    throw new ArtifactPersistenceError(
      ARTIFACT_PAYLOAD_HASH_MISMATCH,
      'declared payload hash does not match the canonical payload',
    );
  }
}
