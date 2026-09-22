import {
  readSnapshotRef,
  type SnapshotRefParts,
  type SnapshotRefReadError,
} from './work-order-context-binding.js';

type UnknownRecord = Record<string, unknown>;

/** Canonical namespace for every WorkOrder Validation judgment produced by #219. */
export const workOrderValidationObjectType = 'zhiju.execution.work_order_validation';

/**
 * The two structural codes belong to the shared `readSnapshotRef` reader, which
 * names them after the Context Snapshot family; they stay in this union so the
 * caller can tell "malformed ref" from "wrong identity" instead of receiving a
 * code its own union cannot express.
 */
export type WorkOrderValidationBindingCode =
  | 'MISSING_CONTEXT_SNAPSHOT_REF'
  | 'INVALID_CONTEXT_SNAPSHOT_REF'
  | 'FOREIGN_WORK_ORDER_VALIDATION_OBJECT_TYPE'
  | 'MISSING_WORK_ORDER_VALIDATION_PROJECT_SCOPE'
  | 'WORK_ORDER_VALIDATION_SNAPSHOT_IDENTITY_MISMATCH'
  | 'WORK_ORDER_VALIDATION_TARGET_MISMATCH';

export interface WorkOrderValidationBindingError extends SnapshotRefReadError {
  readonly code: WorkOrderValidationBindingCode;
}

export interface WorkOrderValidationBindingValidationResult {
  readonly valid: boolean;
  readonly errors: readonly WorkOrderValidationBindingError[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pushError(
  errors: WorkOrderValidationBindingError[],
  path: string,
  code: WorkOrderValidationBindingCode,
  message: string,
): void {
  errors.push({ path, code, message });
}

/**
 * Parses the returned SnapshotRef and pins it to the validation namespace and a
 * complete Project scope. Structural defects, a foreign namespace and an
 * incomplete scope are reported separately so a caller can distinguish them
 * without weakening any of the three.
 */
function readValidationSnapshotRef(
  value: unknown,
  path: string,
  errors: WorkOrderValidationBindingError[],
): SnapshotRefParts | undefined {
  const ref = readSnapshotRef(value, path, errors);
  if (ref === undefined) return undefined;
  if (ref.objectType !== workOrderValidationObjectType) {
    pushError(
      errors,
      `${path}/objectType`,
      'FOREIGN_WORK_ORDER_VALIDATION_OBJECT_TYPE',
      `Ref objectType must be ${workOrderValidationObjectType}`,
    );
    return undefined;
  }
  // A validation judgment is always Project scoped; the shared `scopeRef`
  // treats both members as optional, so the enterprise-only and empty forms
  // have to be rejected here as well as in the result schema.
  if (ref.scope.enterpriseId === undefined || ref.scope.projectId === undefined) {
    pushError(
      errors,
      `${path}/scope`,
      'MISSING_WORK_ORDER_VALIDATION_PROJECT_SCOPE',
      'Validation SnapshotRefs require enterpriseId and projectId',
    );
    return undefined;
  }
  return ref;
}

/**
 * Cross-field binding of the `execution.validate_work_order_draft`
 * CommandResult: the operation-specific `data.validationSnapshotRef` must be
 * the validation judgment created for the envelope `targetRef`, and it must be
 * self-consistent — a judgment has no separate root, so `snapshotId` mirrors
 * `objectId`. Comparing object ids alone is not enough: a foreign namespace
 * ref, an enterprise-only scope or a mismatched Project scope never satisfies
 * it.
 */
export function validateWorkOrderValidationCommandResult(
  input: unknown,
): WorkOrderValidationBindingValidationResult {
  const errors: WorkOrderValidationBindingError[] = [];
  const result = isRecord(input) ? input : undefined;
  const data = isRecord(result?.data) ? result.data : undefined;
  const targetRef = isRecord(result?.targetRef) ? result.targetRef : undefined;

  const ref = readValidationSnapshotRef(
    data?.validationSnapshotRef,
    '/data/validationSnapshotRef',
    errors,
  );

  if (ref !== undefined && ref.snapshotId !== ref.objectId) {
    pushError(
      errors,
      '/data/validationSnapshotRef/snapshotId',
      'WORK_ORDER_VALIDATION_SNAPSHOT_IDENTITY_MISMATCH',
      'A validation judgment has no separate root: snapshotId must equal objectId',
    );
  }

  if (targetRef === undefined) {
    pushError(
      errors,
      '/targetRef',
      'WORK_ORDER_VALIDATION_TARGET_MISMATCH',
      'CommandResult targetRef is missing or not an object',
    );
  } else if (
    targetRef.kind !== 'OBJECT' ||
    targetRef.objectType !== workOrderValidationObjectType ||
    typeof targetRef.objectId !== 'string' ||
    !isRecord(targetRef.scope)
  ) {
    pushError(
      errors,
      '/targetRef',
      'WORK_ORDER_VALIDATION_TARGET_MISMATCH',
      `targetRef must be an OBJECT ref of ${workOrderValidationObjectType}`,
    );
  } else if (
    // The reference scope is fully populated by `readValidationSnapshotRef`, so
    // a missing or non-string member on the target side fails this equality
    // instead of needing its own branch.
    ref !== undefined &&
    (targetRef.objectId !== ref.objectId ||
      targetRef.scope.enterpriseId !== ref.scope.enterpriseId ||
      targetRef.scope.projectId !== ref.scope.projectId)
  ) {
    pushError(
      errors,
      '/data/validationSnapshotRef',
      'WORK_ORDER_VALIDATION_TARGET_MISMATCH',
      'data.validationSnapshotRef must be the validation judgment created for envelope targetRef',
    );
  }

  return { valid: errors.length === 0, errors };
}
