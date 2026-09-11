type UnknownRecord = Record<string, unknown>;

export type WorkOrderContextBindingValidationCode =
  'MISSING_CONTEXT_SNAPSHOT_REF' | 'INVALID_CONTEXT_SNAPSHOT_REF' | 'CONTEXT_SNAPSHOT_REF_MISMATCH';

export interface WorkOrderContextBindingValidationError {
  readonly path: string;
  readonly code: WorkOrderContextBindingValidationCode;
  readonly message: string;
}

export interface WorkOrderContextBindingValidationResult {
  readonly valid: boolean;
  readonly errors: readonly WorkOrderContextBindingValidationError[];
}

interface SnapshotRefParts {
  readonly kind: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly snapshotId: string;
  readonly scope: {
    readonly enterpriseId?: string;
    readonly projectId?: string;
  };
  readonly contentHash: {
    readonly algorithm: string;
    readonly digest: string;
    readonly canonicalizationVersion: string;
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pushError(
  errors: WorkOrderContextBindingValidationError[],
  path: string,
  code: WorkOrderContextBindingValidationCode,
  message: string,
): void {
  errors.push({ path, code, message });
}

function readSnapshotRef(
  value: unknown,
  path: string,
  errors: WorkOrderContextBindingValidationError[],
): SnapshotRefParts | undefined {
  if (!isRecord(value)) {
    pushError(
      errors,
      path,
      value === undefined || value === null
        ? 'MISSING_CONTEXT_SNAPSHOT_REF'
        : 'INVALID_CONTEXT_SNAPSHOT_REF',
      'Context Snapshot ref is missing or not an object',
    );
    return undefined;
  }

  const kind = value.kind;
  const objectType = value.objectType;
  const objectId = value.objectId;
  const snapshotId = value.snapshotId;
  const scope = value.scope;
  const contentHash = value.contentHash;
  if (kind !== 'SNAPSHOT') {
    pushError(errors, `${path}/kind`, 'INVALID_CONTEXT_SNAPSHOT_REF', 'Ref kind must be SNAPSHOT');
  }
  if (typeof objectType !== 'string' || objectType.length === 0) {
    pushError(
      errors,
      `${path}/objectType`,
      'INVALID_CONTEXT_SNAPSHOT_REF',
      'Ref objectType is missing or invalid',
    );
  }
  if (typeof objectId !== 'string' || objectId.length === 0) {
    pushError(
      errors,
      `${path}/objectId`,
      'INVALID_CONTEXT_SNAPSHOT_REF',
      'Ref objectId is missing or invalid',
    );
  }
  if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
    pushError(
      errors,
      `${path}/snapshotId`,
      'INVALID_CONTEXT_SNAPSHOT_REF',
      'Ref snapshotId is missing or invalid',
    );
  }

  let parsedScope: SnapshotRefParts['scope'] | undefined;
  if (!isRecord(scope)) {
    pushError(
      errors,
      `${path}/scope`,
      'INVALID_CONTEXT_SNAPSHOT_REF',
      'Ref scope is missing or not an object',
    );
  } else {
    const unknownScopeKey = Object.keys(scope).find(
      (key) => key !== 'enterpriseId' && key !== 'projectId',
    );
    if (unknownScopeKey !== undefined) {
      pushError(
        errors,
        `${path}/scope/${unknownScopeKey}`,
        'INVALID_CONTEXT_SNAPSHOT_REF',
        'Ref scope has an unknown field',
      );
    }
    if (scope.enterpriseId !== undefined && typeof scope.enterpriseId !== 'string') {
      pushError(
        errors,
        `${path}/scope/enterpriseId`,
        'INVALID_CONTEXT_SNAPSHOT_REF',
        'Ref enterpriseId is invalid',
      );
    }
    if (scope.projectId !== undefined && typeof scope.projectId !== 'string') {
      pushError(
        errors,
        `${path}/scope/projectId`,
        'INVALID_CONTEXT_SNAPSHOT_REF',
        'Ref projectId is invalid',
      );
    }
    if (scope.projectId !== undefined && scope.enterpriseId === undefined) {
      pushError(
        errors,
        `${path}/scope/enterpriseId`,
        'INVALID_CONTEXT_SNAPSHOT_REF',
        'Project-scoped refs require enterpriseId',
      );
    }
    if (
      (scope.enterpriseId === undefined || typeof scope.enterpriseId === 'string') &&
      (scope.projectId === undefined || typeof scope.projectId === 'string') &&
      (scope.projectId === undefined || scope.enterpriseId !== undefined) &&
      unknownScopeKey === undefined
    ) {
      parsedScope = {
        ...(scope.enterpriseId === undefined ? {} : { enterpriseId: scope.enterpriseId }),
        ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
      };
    }
  }

  let parsedHash: SnapshotRefParts['contentHash'] | undefined;
  if (!isRecord(contentHash)) {
    pushError(
      errors,
      `${path}/contentHash`,
      'INVALID_CONTEXT_SNAPSHOT_REF',
      'Ref contentHash is missing or not an object',
    );
  } else {
    if (contentHash.algorithm !== 'SHA-256') {
      pushError(
        errors,
        `${path}/contentHash/algorithm`,
        'INVALID_CONTEXT_SNAPSHOT_REF',
        'Ref contentHash algorithm must be SHA-256',
      );
    }
    if (typeof contentHash.digest !== 'string' || !/^[0-9a-f]{64}$/.test(contentHash.digest)) {
      pushError(
        errors,
        `${path}/contentHash/digest`,
        'INVALID_CONTEXT_SNAPSHOT_REF',
        'Ref contentHash digest is invalid',
      );
    }
    if (contentHash.canonicalizationVersion !== '1') {
      pushError(
        errors,
        `${path}/contentHash/canonicalizationVersion`,
        'INVALID_CONTEXT_SNAPSHOT_REF',
        'Ref contentHash canonicalizationVersion must be 1',
      );
    }
    if (
      contentHash.algorithm === 'SHA-256' &&
      typeof contentHash.digest === 'string' &&
      /^[0-9a-f]{64}$/.test(contentHash.digest) &&
      contentHash.canonicalizationVersion === '1'
    ) {
      parsedHash = {
        algorithm: 'SHA-256',
        digest: contentHash.digest,
        canonicalizationVersion: '1',
      };
    }
  }

  if (
    kind !== 'SNAPSHOT' ||
    typeof objectType !== 'string' ||
    objectType.length === 0 ||
    typeof objectId !== 'string' ||
    objectId.length === 0 ||
    typeof snapshotId !== 'string' ||
    snapshotId.length === 0 ||
    parsedScope === undefined ||
    parsedHash === undefined
  ) {
    return undefined;
  }

  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId,
    snapshotId,
    scope: parsedScope,
    contentHash: parsedHash,
  };
}

function sameSnapshotRef(left: SnapshotRefParts, right: SnapshotRefParts): boolean {
  return (
    left.kind === right.kind &&
    left.objectType === right.objectType &&
    left.objectId === right.objectId &&
    left.snapshotId === right.snapshotId &&
    left.scope.enterpriseId === right.scope.enterpriseId &&
    left.scope.projectId === right.scope.projectId &&
    left.contentHash.algorithm === right.contentHash.algorithm &&
    left.contentHash.digest === right.contentHash.digest &&
    left.contentHash.canonicalizationVersion === right.contentHash.canonicalizationVersion
  );
}

/**
 * Validates the cross-field binding introduced by InitialWorkOrderDraft@1.1.
 * The structural schemas validate each SnapshotRef; this check owns their
 * required exact equality after the Context Snapshot has been submitted.
 */
export function validateWorkOrderContextSnapshotBinding(
  input: unknown,
): WorkOrderContextBindingValidationResult {
  const errors: WorkOrderContextBindingValidationError[] = [];
  const candidate = isRecord(input) ? input : undefined;
  const versionPins = isRecord(candidate?.versionPins) ? candidate.versionPins : undefined;
  const contextSnapshotRef = readSnapshotRef(
    candidate?.contextSnapshotRef,
    '/contextSnapshotRef',
    errors,
  );
  const projectContextContractRef = readSnapshotRef(
    versionPins?.projectContextContractRef,
    '/versionPins/projectContextContractRef',
    errors,
  );

  if (
    contextSnapshotRef !== undefined &&
    projectContextContractRef !== undefined &&
    !sameSnapshotRef(contextSnapshotRef, projectContextContractRef)
  ) {
    pushError(
      errors,
      '/versionPins/projectContextContractRef',
      'CONTEXT_SNAPSHOT_REF_MISMATCH',
      'versionPins.projectContextContractRef must exactly equal contextSnapshotRef',
    );
  }

  return { valid: errors.length === 0, errors };
}
