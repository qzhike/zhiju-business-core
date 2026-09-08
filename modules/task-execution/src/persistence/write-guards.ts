// IM-06 WI-01 (issue #151): stable repository write-boundary errors for
// canonical payload hashes, promoted scope mirrors and trusted principals in
// the TaskExecution module. Mirrors the artifact write-guards contract but
// exposes TaskExecution-prefixed codes so upstream routers can distinguish
// the owning module.

import type { CanonicalJsonObject } from '@zhiju/shared-kernel';

export const TASK_EXECUTION_PAYLOAD_HASH_MISMATCH = 'TASK_EXECUTION_PAYLOAD_HASH_MISMATCH';
export const TASK_EXECUTION_PROMOTED_MIRROR_MISMATCH = 'TASK_EXECUTION_PROMOTED_MIRROR_MISMATCH';
export const TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH =
  'TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH';
export const TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH = 'TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH';

export class TaskExecutionPersistenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TaskExecutionPersistenceError';
  }
}

function expectString(value: unknown, field: string): string {
  return typeof value === 'string' ? value : throwMirrorMismatch(field);
}

function throwMirrorMismatch(field: string): never {
  throw new TaskExecutionPersistenceError(
    TASK_EXECUTION_PROMOTED_MIRROR_MISMATCH,
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
        throw new TaskExecutionPersistenceError(
          TASK_EXECUTION_PROMOTED_MIRROR_MISMATCH,
          `canonical payload ${field} does not match promoted column`,
        );
      }
      continue;
    }
    if (expected === null || expected === undefined) {
      if (actual !== undefined && actual !== null) {
        throw new TaskExecutionPersistenceError(
          TASK_EXECUTION_PROMOTED_MIRROR_MISMATCH,
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
      throw new TaskExecutionPersistenceError(
        TASK_EXECUTION_PROMOTED_MIRROR_MISMATCH,
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
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_PAYLOAD_HASH_MISMATCH,
      'declared payload hash does not match the canonical payload',
    );
  }
}
