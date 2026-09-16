import {
  readSnapshotRef,
  type SnapshotRefParts,
  type SnapshotRefReadError,
} from './work-order-context-binding.js';

type UnknownRecord = Record<string, unknown>;

/** Canonical namespace for every Task Readiness judgment produced by #208. */
export const taskReadinessObjectType = 'zhiju.execution.task_readiness';

/**
 * The two structural codes belong to the shared `readSnapshotRef` reader, which
 * names them after the Context Snapshot family; they stay in this union so the
 * caller can tell "malformed ref" from "wrong identity" instead of receiving a
 * code its own union cannot express.
 */
export type TaskReadinessBindingCode =
  | 'MISSING_CONTEXT_SNAPSHOT_REF'
  | 'INVALID_CONTEXT_SNAPSHOT_REF'
  | 'FOREIGN_TASK_READINESS_OBJECT_TYPE'
  | 'MISSING_TASK_READINESS_PROJECT_SCOPE'
  | 'TASK_READINESS_SNAPSHOT_IDENTITY_MISMATCH'
  | 'TASK_READINESS_TARGET_MISMATCH';

export interface TaskReadinessBindingError extends SnapshotRefReadError {
  readonly code: TaskReadinessBindingCode;
}

export interface TaskReadinessBindingValidationResult {
  readonly valid: boolean;
  readonly errors: readonly TaskReadinessBindingError[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pushError(
  errors: TaskReadinessBindingError[],
  path: string,
  code: TaskReadinessBindingCode,
  message: string,
): void {
  errors.push({ path, code, message });
}

/**
 * Parses the returned SnapshotRef and pins it to the readiness namespace and a
 * complete Project scope. Structural defects, a foreign namespace and an
 * incomplete scope are reported separately so a caller can distinguish them
 * without weakening any of the three.
 */
function readReadinessSnapshotRef(
  value: unknown,
  path: string,
  errors: TaskReadinessBindingError[],
): SnapshotRefParts | undefined {
  const ref = readSnapshotRef(value, path, errors);
  if (ref === undefined) return undefined;
  if (ref.objectType !== taskReadinessObjectType) {
    pushError(
      errors,
      `${path}/objectType`,
      'FOREIGN_TASK_READINESS_OBJECT_TYPE',
      `Ref objectType must be ${taskReadinessObjectType}`,
    );
    return undefined;
  }
  // A readiness judgment is always Project scoped; the shared `scopeRef` treats
  // both members as optional, so the enterprise-only and empty forms have to be
  // rejected here as well as in the result schema.
  if (ref.scope.enterpriseId === undefined || ref.scope.projectId === undefined) {
    pushError(
      errors,
      `${path}/scope`,
      'MISSING_TASK_READINESS_PROJECT_SCOPE',
      'Readiness SnapshotRefs require enterpriseId and projectId',
    );
    return undefined;
  }
  return ref;
}

/**
 * Cross-field binding of the `execution.build_task_readiness` CommandResult: the
 * operation-specific `data.readinessSnapshotRef` must be the readiness judgment
 * created for the envelope `targetRef`, and it must be self-consistent —
 * a judgment has no separate root, so `snapshotId` mirrors `objectId`.
 * Comparing object ids alone is not enough: a foreign namespace ref, an
 * enterprise-only scope or a mismatched Project scope never satisfies it.
 */
export function validateBuildTaskReadinessCommandResult(
  input: unknown,
): TaskReadinessBindingValidationResult {
  const errors: TaskReadinessBindingError[] = [];
  const result = isRecord(input) ? input : undefined;
  const data = isRecord(result?.data) ? result.data : undefined;
  const targetRef = isRecord(result?.targetRef) ? result.targetRef : undefined;

  const ref = readReadinessSnapshotRef(
    data?.readinessSnapshotRef,
    '/data/readinessSnapshotRef',
    errors,
  );

  if (ref !== undefined && ref.snapshotId !== ref.objectId) {
    pushError(
      errors,
      '/data/readinessSnapshotRef/snapshotId',
      'TASK_READINESS_SNAPSHOT_IDENTITY_MISMATCH',
      'A readiness judgment has no separate root: snapshotId must equal objectId',
    );
  }

  if (targetRef === undefined) {
    pushError(
      errors,
      '/targetRef',
      'TASK_READINESS_TARGET_MISMATCH',
      'CommandResult targetRef is missing or not an object',
    );
  } else if (
    targetRef.kind !== 'OBJECT' ||
    targetRef.objectType !== taskReadinessObjectType ||
    typeof targetRef.objectId !== 'string' ||
    !isRecord(targetRef.scope)
  ) {
    pushError(
      errors,
      '/targetRef',
      'TASK_READINESS_TARGET_MISMATCH',
      `targetRef must be an OBJECT ref of ${taskReadinessObjectType}`,
    );
  } else if (
    // The reference scope is fully populated by `readReadinessSnapshotRef`, so a
    // missing or non-string member on the target side fails this equality
    // instead of needing its own branch.
    ref !== undefined &&
    (targetRef.objectId !== ref.objectId ||
      targetRef.scope.enterpriseId !== ref.scope.enterpriseId ||
      targetRef.scope.projectId !== ref.scope.projectId)
  ) {
    pushError(
      errors,
      '/data/readinessSnapshotRef',
      'TASK_READINESS_TARGET_MISMATCH',
      'data.readinessSnapshotRef must be the readiness judgment created for envelope targetRef',
    );
  }

  return { valid: errors.length === 0, errors };
}
