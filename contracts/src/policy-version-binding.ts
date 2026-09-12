import { readSnapshotRef, type SnapshotRefReadError } from './work-order-context-binding.js';

/** Canonical namespace of the version key (`VersionedRef<Policy>`). */
export const policyObjectType = 'zhiju.identity.policy';

/** Canonical namespace of the committed version fact (`SnapshotRef<PolicyVersion>`). */
export const policyVersionObjectType = 'zhiju.identity.policy_version';

export type PolicyVersionBindingCode =
  | 'MALFORMED_POLICY_VERSION_REF'
  | 'POLICY_VERSION_TARGET_MISMATCH'
  | 'POLICY_VERSION_SCOPE_MISMATCH'
  | 'POLICY_REF_ECHO_MISMATCH';

export interface PolicyVersionBindingError extends SnapshotRefReadError {
  readonly code: PolicyVersionBindingCode;
}

export interface PolicyVersionBindingValidationResult {
  readonly valid: boolean;
  readonly errors: readonly PolicyVersionBindingError[];
}

interface PolicyScope {
  readonly enterpriseId: string;
  readonly projectId?: string;
}

interface PolicyVersionKeyParts {
  readonly objectId: string;
  readonly versionId: string;
  readonly scope: PolicyScope;
}

/**
 * Boundary view over a caller-supplied JSON value. Non-objects have no members,
 * and every member this module reads is validated by the reader that consumes
 * it, so no shape is assumed from the cast alone.
 */
function members(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

/** Closed Scope shape: `enterpriseId` required, `projectId` optional, nothing else. */
function readPolicyScope(
  value: unknown,
  path: string,
  errors: PolicyVersionBindingError[],
): PolicyScope | undefined {
  const scope = members(value);
  if (
    typeof scope.enterpriseId !== 'string' ||
    (scope.projectId !== undefined && typeof scope.projectId !== 'string') ||
    Object.keys(scope).some((key) => key !== 'enterpriseId' && key !== 'projectId')
  ) {
    errors.push({
      path: `${path}/scope`,
      code: 'MALFORMED_POLICY_VERSION_REF',
      message: 'Policy version Scope must be a closed {enterpriseId, projectId?} object',
    });
    return undefined;
  }
  return {
    enterpriseId: scope.enterpriseId,
    ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
  };
}

/** Reads the canonical `VersionedRef<Policy>` version key, including its closed Scope. */
function readPolicyKey(
  value: unknown,
  path: string,
  errors: PolicyVersionBindingError[],
): PolicyVersionKeyParts | undefined {
  const key = members(value);
  const scope = readPolicyScope(key.scope, path, errors);
  if (
    key.kind !== 'VERSIONED' ||
    key.objectType !== policyObjectType ||
    typeof key.objectId !== 'string' ||
    typeof key.versionId !== 'string' ||
    scope === undefined
  ) {
    errors.push({
      path,
      code: 'MALFORMED_POLICY_VERSION_REF',
      message: `Policy version key must be VERSIONED/${policyObjectType} with a closed scoped shape`,
    });
    return undefined;
  }
  return { objectId: key.objectId, versionId: key.versionId, scope };
}

/**
 * Reads the canonical `SnapshotRef<PolicyVersion>`: shared structural parsing,
 * then this module's namespace and `objectId == snapshotId` identity.
 */
function readPolicyVersionFact(value: unknown, path: string, errors: PolicyVersionBindingError[]) {
  const ref = readSnapshotRef(value, path, errors);
  if (ref === undefined) {
    errors.push({
      path,
      code: 'MALFORMED_POLICY_VERSION_REF',
      message: 'PolicyVersion ref is malformed',
    });
    return undefined;
  }
  if (ref.objectType !== policyVersionObjectType) {
    errors.push({
      path: `${path}/objectType`,
      code: 'MALFORMED_POLICY_VERSION_REF',
      message: `Ref objectType must be ${policyVersionObjectType}`,
    });
    return undefined;
  }
  if (ref.objectId !== ref.snapshotId) {
    errors.push({
      path: `${path}/snapshotId`,
      code: 'MALFORMED_POLICY_VERSION_REF',
      message: 'PolicyVersion ref requires objectId == snapshotId',
    });
    return undefined;
  }
  if (ref.scope.enterpriseId === undefined) {
    errors.push({
      path: `${path}/scope`,
      code: 'MALFORMED_POLICY_VERSION_REF',
      message: 'PolicyVersion ref requires an Enterprise or Project scope',
    });
    return undefined;
  }
  return ref;
}

function sameScope(
  left: { readonly enterpriseId?: string; readonly projectId?: string },
  right: { readonly enterpriseId?: string; readonly projectId?: string },
): boolean {
  return left.enterpriseId === right.enterpriseId && left.projectId === right.projectId;
}

/**
 * Cross-field binding of the `identity.record_policy_version` CommandResult:
 * the returned fact must be the CREATE target and must carry the exact Scope
 * the version key was submitted with. This is reference identity only — it
 * never claims a PolicyVersion row exists or that authorization passed.
 */
export function validatePolicyVersionCommandResult(
  input: unknown,
): PolicyVersionBindingValidationResult {
  const errors: PolicyVersionBindingError[] = [];
  const result = members(input);
  const key = readPolicyKey(members(result.payload).policyRef, '/payload/policyRef', errors);
  const fact = readPolicyVersionFact(
    members(result.data).policyVersionRef,
    '/data/policyVersionRef',
    errors,
  );

  const targetRef = members(result.targetRef);
  if (targetRef.objectType !== policyVersionObjectType || typeof targetRef.objectId !== 'string') {
    errors.push({
      path: '/targetRef',
      code: 'POLICY_VERSION_TARGET_MISMATCH',
      message: `targetRef must be an OBJECT ref of ${policyVersionObjectType}`,
    });
    return { valid: false, errors };
  }
  if (fact !== undefined) {
    const targetScope = readPolicyScope(targetRef.scope, '/targetRef', errors);
    if (
      targetRef.objectId !== fact.objectId ||
      targetScope === undefined ||
      !sameScope(targetScope, fact.scope)
    ) {
      errors.push({
        path: '/data/policyVersionRef',
        code: 'POLICY_VERSION_TARGET_MISMATCH',
        message: 'data.policyVersionRef must be the fact created for envelope targetRef',
      });
    }
    if (key !== undefined && !sameScope(key.scope, fact.scope)) {
      errors.push({
        path: '/data/policyVersionRef/scope',
        code: 'POLICY_VERSION_SCOPE_MISMATCH',
        message: 'PolicyVersion scope must equal payload.policyRef.scope',
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Cross-field binding of the authoritative `identity.resolve_policy` Query:
 * the version key, Scope and content Hash the caller asked for are echoed
 * exactly. Shape and echo only — an accepted result does not prove the version
 * was committed, is currently effective, or that the read was authorized.
 */
export function validatePolicyVersionResolutionBinding(
  input: unknown,
): PolicyVersionBindingValidationResult {
  const errors: PolicyVersionBindingError[] = [];
  const binding = members(input);
  const requested = readPolicyKey(members(binding.payload).policyRef, '/payload/policyRef', errors);
  const data = members(binding.data);
  const echoed = readPolicyKey(data.policyRef, '/data/policyRef', errors);
  const fact = readPolicyVersionFact(data.policyVersionRef, '/data/policyVersionRef', errors);

  // `objectType` is pinned to the canonical name by both readers, so the echo
  // comparison only has to cover the members that can actually differ.
  if (
    requested !== undefined &&
    echoed !== undefined &&
    (requested.objectId !== echoed.objectId ||
      requested.versionId !== echoed.versionId ||
      !sameScope(requested.scope, echoed.scope))
  ) {
    errors.push({
      path: '/data/policyRef',
      code: 'POLICY_REF_ECHO_MISMATCH',
      message: 'data.policyRef must equal the requested Policy version key field by field',
    });
  }

  const scopeRef = readPolicyScope(data.scopeRef, '/data/scopeRef', errors);
  if (
    requested !== undefined &&
    (scopeRef === undefined || !sameScope(scopeRef, requested.scope))
  ) {
    errors.push({
      path: '/data/scopeRef',
      code: 'POLICY_VERSION_SCOPE_MISMATCH',
      message: 'data.scopeRef must equal payload.policyRef.scope',
    });
  }

  if (fact !== undefined && requested !== undefined && !sameScope(fact.scope, requested.scope)) {
    errors.push({
      path: '/data/policyVersionRef/scope',
      code: 'POLICY_VERSION_SCOPE_MISMATCH',
      message: 'data.policyVersionRef.scope must equal payload.policyRef.scope',
    });
  }

  const contentHash = members(data.contentHash);
  if (
    fact !== undefined &&
    (contentHash.algorithm !== fact.contentHash.algorithm ||
      contentHash.digest !== fact.contentHash.digest ||
      contentHash.canonicalizationVersion !== fact.contentHash.canonicalizationVersion)
  ) {
    errors.push({
      path: '/data/contentHash',
      code: 'POLICY_REF_ECHO_MISMATCH',
      message: 'data.contentHash must equal data.policyVersionRef.contentHash',
    });
  }

  return { valid: errors.length === 0, errors };
}
