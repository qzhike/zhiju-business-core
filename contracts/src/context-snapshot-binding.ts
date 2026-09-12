import {
  readSnapshotRef,
  sameSnapshotRef,
  type SnapshotRefParts,
  type SnapshotRefReadError,
} from './work-order-context-binding.js';

type UnknownRecord = Record<string, unknown>;

/** Canonical namespace for every Context Snapshot produced by a WI-02 entry. */
export const contextSnapshotObjectType = 'zhiju.execution.context_snapshot';

/**
 * Historical Core v1.0 name. It stays readable through the existing
 * compatibility path, but no WI-02 entry may produce it and it cannot be
 * interchanged with the canonical name by object id alone.
 */
export const legacyContextSnapshotObjectType = 'zhiju.project.context_snapshot';

export type ContextSnapshotBindingCode =
  | 'MISSING_CONTEXT_SNAPSHOT_REF'
  | 'INVALID_CONTEXT_SNAPSHOT_REF'
  | 'LEGACY_CONTEXT_SNAPSHOT_OBJECT_TYPE'
  | 'MISSING_CONTEXT_SNAPSHOT_PROJECT_SCOPE'
  | 'CONTEXT_SNAPSHOT_TARGET_MISMATCH'
  | 'CONTEXT_SNAPSHOT_READ_MISMATCH';

export interface ContextSnapshotBindingError extends SnapshotRefReadError {
  readonly code: ContextSnapshotBindingCode;
}

export interface ContextSnapshotBindingValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ContextSnapshotBindingError[];
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pushError(
  errors: ContextSnapshotBindingError[],
  path: string,
  code: ContextSnapshotBindingCode,
  message: string,
): void {
  errors.push({ path, code, message });
}

/**
 * Parses a SnapshotRef that a WI-02 entry returns and pins its namespace to the
 * canonical one. Structural defects and the legacy namespace are reported
 * separately so a caller can tell "malformed" from "wrong identity".
 */
function readCanonicalSnapshotRef(
  value: unknown,
  path: string,
  errors: ContextSnapshotBindingError[],
): SnapshotRefParts | undefined {
  const ref = readSnapshotRef(value, path, errors);
  if (ref === undefined) return undefined;
  if (ref.objectType === legacyContextSnapshotObjectType) {
    pushError(
      errors,
      `${path}/objectType`,
      'LEGACY_CONTEXT_SNAPSHOT_OBJECT_TYPE',
      'Legacy Context Snapshot object type is readable history, not a WI-02 entry result',
    );
    return undefined;
  }
  if (ref.objectType !== contextSnapshotObjectType) {
    pushError(
      errors,
      `${path}/objectType`,
      'INVALID_CONTEXT_SNAPSHOT_REF',
      `Ref objectType must be ${contextSnapshotObjectType}`,
    );
    return undefined;
  }
  // A WI-02 Initial Context Snapshot is always Project scoped. The shared
  // `scopeRef` treats both members as optional, so the enterprise-only or empty
  // scope has to be rejected here as well as in the result schema.
  if (ref.scope.enterpriseId === undefined || ref.scope.projectId === undefined) {
    pushError(
      errors,
      `${path}/scope`,
      'MISSING_CONTEXT_SNAPSHOT_PROJECT_SCOPE',
      'Context Snapshot refs from a WI-02 entry require enterpriseId and projectId',
    );
    return undefined;
  }
  return ref;
}

function sameScope(left: UnknownRecord, right: SnapshotRefParts['scope']): boolean {
  const enterpriseId = left.enterpriseId;
  const projectId = left.projectId;
  return (
    (enterpriseId === undefined || typeof enterpriseId === 'string') &&
    (projectId === undefined || typeof projectId === 'string') &&
    enterpriseId === right.enterpriseId &&
    projectId === right.projectId
  );
}

/**
 * Cross-field binding of the `execution.build_initial_context_snapshot`
 * CommandResult: the operation-specific `data.contextSnapshotRef` must be the
 * canonical Context Snapshot and must agree with the envelope `targetRef` on
 * object type, object id and Scope. Comparing object ids alone is not enough —
 * a legacy or foreign namespace ref never satisfies it.
 */
export function validateInitialContextCommandResult(
  input: unknown,
): ContextSnapshotBindingValidationResult {
  const errors: ContextSnapshotBindingError[] = [];
  const result = isRecord(input) ? input : undefined;
  const data = isRecord(result?.data) ? result.data : undefined;
  const targetRef = isRecord(result?.targetRef) ? result.targetRef : undefined;

  const ref = readCanonicalSnapshotRef(
    data?.contextSnapshotRef,
    '/data/contextSnapshotRef',
    errors,
  );

  if (targetRef === undefined) {
    pushError(
      errors,
      '/targetRef',
      'CONTEXT_SNAPSHOT_TARGET_MISMATCH',
      'CommandResult targetRef is missing or not an object',
    );
  } else if (
    targetRef.kind !== 'OBJECT' ||
    targetRef.objectType !== contextSnapshotObjectType ||
    typeof targetRef.objectId !== 'string' ||
    !isRecord(targetRef.scope)
  ) {
    pushError(
      errors,
      '/targetRef',
      'CONTEXT_SNAPSHOT_TARGET_MISMATCH',
      `targetRef must be an OBJECT ref of ${contextSnapshotObjectType}`,
    );
  } else if (
    ref !== undefined &&
    (targetRef.objectId !== ref.objectId || !sameScope(targetRef.scope, ref.scope))
  ) {
    pushError(
      errors,
      '/data/contextSnapshotRef',
      'CONTEXT_SNAPSHOT_TARGET_MISMATCH',
      'data.contextSnapshotRef must be the Context Snapshot created for envelope targetRef',
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Cross-field binding of the authoritative `execution.get_context_snapshot`
 * Query: the returned SnapshotRef must equal the requested one in every field.
 * The check is namespace-agnostic on purpose — the historical Core v1.0
 * `zhiju.project.context_snapshot` identity stays readable, but a read can
 * never answer with a different identity than the caller asked for.
 */
export function validateContextSnapshotReadBinding(
  input: unknown,
): ContextSnapshotBindingValidationResult {
  const errors: ContextSnapshotBindingError[] = [];
  const binding = isRecord(input) ? input : undefined;
  const payload = isRecord(binding?.payload) ? binding.payload : undefined;
  const data = isRecord(binding?.data) ? binding.data : undefined;

  const requested = readSnapshotRef(
    payload?.contextSnapshotRef,
    '/payload/contextSnapshotRef',
    errors,
  );
  const returned = readSnapshotRef(data?.contextSnapshotRef, '/data/contextSnapshotRef', errors);

  if (requested !== undefined && returned !== undefined && !sameSnapshotRef(requested, returned)) {
    pushError(
      errors,
      '/data/contextSnapshotRef',
      'CONTEXT_SNAPSHOT_READ_MISMATCH',
      'QueryResult data.contextSnapshotRef must exactly equal the requested Context Snapshot ref',
    );
  }

  return { valid: errors.length === 0, errors };
}
