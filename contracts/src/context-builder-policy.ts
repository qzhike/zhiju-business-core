import type { Core, Common, TaskExecution } from './generated/types/index.js';
import { compareUtcInstants, parseUtcInstant } from './utc-instant.js';

export const CONTEXT_BUILDER_POLICY_OBJECT_TYPE = 'zhiju.identity.policy' as const;

type UnknownRecord = Record<string, unknown>;

export type ContextBuilderPolicyValidationCode =
  | 'MISSING_POLICY_REF'
  | 'INVALID_POLICY_REF'
  | 'POLICY_OBJECT_TYPE_INVALID'
  | 'POLICY_REF_MISMATCH'
  | 'INVALID_POLICY_BINDING'
  | 'POLICY_CONTENT_HASH_MISMATCH'
  | 'POLICY_VALIDITY_MISMATCH'
  | 'POLICY_NOT_EFFECTIVE'
  | 'POLICY_EXPIRED'
  | 'INVALID_CONSUMPTION_TIME';

export interface ContextBuilderPolicyValidationError {
  readonly path: string;
  readonly code: ContextBuilderPolicyValidationCode;
  readonly message: string;
}

export interface ContextBuilderPolicyValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ContextBuilderPolicyValidationError[];
}

export interface ContextBuilderPolicyBindingValidationInput {
  readonly initialRequest: Pick<TaskExecution.InitialContextBuildRequest, 'builderPolicyRef'>;
  readonly projectContext: {
    readonly projection: Pick<Core.ProjectContextContract['projection'], 'builderPolicyRef'>;
  };
  readonly contextBuildMetadata: TaskExecution.ContextBuilderPolicyBinding;
  readonly workOrder: {
    readonly versionPins: Pick<Core.WorkOrderContract['versionPins'], 'contextBuilderPolicyRef'>;
  };
  readonly resolvedPolicy: TaskExecution.ContextBuilderPolicyBinding;
  readonly now: Common.UtcInstant;
}

interface PolicyRefParts {
  readonly objectType: typeof CONTEXT_BUILDER_POLICY_OBJECT_TYPE;
  readonly objectId: string;
  readonly versionId: string;
  readonly scope: {
    readonly enterpriseId?: string;
    readonly projectId?: string;
  };
}

interface PolicyBindingParts {
  readonly ref: PolicyRefParts;
  readonly contentHash: Common.ContentHash;
  readonly effectiveFrom: string;
  readonly supersededAt?: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pushError(
  errors: ContextBuilderPolicyValidationError[],
  path: string,
  code: ContextBuilderPolicyValidationCode,
  message: string,
): void {
  errors.push({ path, code, message });
}

function readScope(
  value: unknown,
  path: string,
  errors: ContextBuilderPolicyValidationError[],
): PolicyRefParts['scope'] | undefined {
  if (!isRecord(value)) {
    pushError(errors, path, 'INVALID_POLICY_REF', 'Policy ref scope is missing or not an object');
    return undefined;
  }

  for (const key of Object.keys(value)) {
    if (key !== 'enterpriseId' && key !== 'projectId') {
      pushError(
        errors,
        `${path}/${key}`,
        'INVALID_POLICY_REF',
        'Policy ref scope has an unknown field',
      );
      return undefined;
    }
  }

  const enterpriseId = value.enterpriseId;
  const projectId = value.projectId;
  if (enterpriseId !== undefined && typeof enterpriseId !== 'string') {
    pushError(
      errors,
      `${path}/enterpriseId`,
      'INVALID_POLICY_REF',
      'Policy ref scope enterpriseId must be a string',
    );
    return undefined;
  }
  if (projectId !== undefined && typeof projectId !== 'string') {
    pushError(
      errors,
      `${path}/projectId`,
      'INVALID_POLICY_REF',
      'Policy ref scope projectId must be a string',
    );
    return undefined;
  }
  if (projectId !== undefined && enterpriseId === undefined) {
    pushError(
      errors,
      `${path}/enterpriseId`,
      'INVALID_POLICY_REF',
      'Project-scoped Policy refs require enterpriseId',
    );
    return undefined;
  }

  return {
    ...(enterpriseId === undefined ? {} : { enterpriseId }),
    ...(projectId === undefined ? {} : { projectId }),
  };
}

function readPolicyRef(
  value: unknown,
  path: string,
  errors: ContextBuilderPolicyValidationError[],
): PolicyRefParts | undefined {
  if (!isRecord(value)) {
    pushError(
      errors,
      path,
      value === undefined || value === null ? 'MISSING_POLICY_REF' : 'INVALID_POLICY_REF',
      'Context Builder Policy ref is missing or not an object',
    );
    return undefined;
  }

  if (value.kind !== 'VERSIONED') {
    pushError(
      errors,
      `${path}/kind`,
      'INVALID_POLICY_REF',
      'Context Builder Policy ref must be VERSIONED',
    );
  }
  if (value.objectType !== CONTEXT_BUILDER_POLICY_OBJECT_TYPE) {
    pushError(
      errors,
      `${path}/objectType`,
      'POLICY_OBJECT_TYPE_INVALID',
      `Context Builder Policy ref must use ${CONTEXT_BUILDER_POLICY_OBJECT_TYPE}`,
    );
  }

  const objectId = value.objectId;
  const versionId = value.versionId;
  if (typeof objectId !== 'string' || objectId.length === 0) {
    pushError(
      errors,
      `${path}/objectId`,
      'INVALID_POLICY_REF',
      'Policy ref objectId is missing or invalid',
    );
  }
  if (typeof versionId !== 'string' || versionId.length === 0) {
    pushError(
      errors,
      `${path}/versionId`,
      'INVALID_POLICY_REF',
      'Policy ref versionId is missing or invalid',
    );
  }
  const scope = readScope(value.scope, `${path}/scope`, errors);
  if (
    value.kind !== 'VERSIONED' ||
    value.objectType !== CONTEXT_BUILDER_POLICY_OBJECT_TYPE ||
    typeof objectId !== 'string' ||
    objectId.length === 0 ||
    typeof versionId !== 'string' ||
    versionId.length === 0 ||
    scope === undefined
  ) {
    return undefined;
  }

  return { objectType: CONTEXT_BUILDER_POLICY_OBJECT_TYPE, objectId, versionId, scope };
}

function readContentHash(
  value: unknown,
  path: string,
  errors: ContextBuilderPolicyValidationError[],
): Common.ContentHash | undefined {
  if (!isRecord(value)) {
    pushError(
      errors,
      path,
      'INVALID_POLICY_BINDING',
      'Policy contentHash is missing or not an object',
    );
    return undefined;
  }
  if (value.algorithm !== 'SHA-256') {
    pushError(
      errors,
      `${path}/algorithm`,
      'INVALID_POLICY_BINDING',
      'Policy contentHash must use SHA-256',
    );
  }
  if (typeof value.digest !== 'string' || !/^[0-9a-f]{64}$/.test(value.digest)) {
    pushError(
      errors,
      `${path}/digest`,
      'INVALID_POLICY_BINDING',
      'Policy contentHash digest is invalid',
    );
  }
  if (value.canonicalizationVersion !== '1') {
    pushError(
      errors,
      `${path}/canonicalizationVersion`,
      'INVALID_POLICY_BINDING',
      'Policy contentHash canonicalizationVersion must be 1',
    );
  }
  if (
    value.algorithm !== 'SHA-256' ||
    typeof value.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.digest) ||
    value.canonicalizationVersion !== '1'
  ) {
    return undefined;
  }
  return {
    algorithm: 'SHA-256',
    digest: value.digest,
    canonicalizationVersion: '1',
  };
}

function readInstant(
  value: unknown,
  path: string,
  errors: ContextBuilderPolicyValidationError[],
  required: boolean,
): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || parseUtcInstant(value) === undefined) {
    pushError(
      errors,
      path,
      required ? 'INVALID_POLICY_BINDING' : 'POLICY_VALIDITY_MISMATCH',
      required
        ? 'Policy validity instant is missing or invalid'
        : 'Policy validity instant is invalid',
    );
    return undefined;
  }
  return value;
}

function readPolicyBinding(
  value: unknown,
  path: string,
  errors: ContextBuilderPolicyValidationError[],
): PolicyBindingParts | undefined {
  if (!isRecord(value)) {
    pushError(
      errors,
      path,
      'INVALID_POLICY_BINDING',
      'Policy binding metadata is missing or not an object',
    );
    return undefined;
  }
  const ref = readPolicyRef(value.builderPolicyRef, `${path}/builderPolicyRef`, errors);
  const contentHash = readContentHash(value.contentHash, `${path}/contentHash`, errors);
  const effectiveFrom = readInstant(value.effectiveFrom, `${path}/effectiveFrom`, errors, true);
  const supersededAt = readInstant(value.supersededAt, `${path}/supersededAt`, errors, false);
  if (ref === undefined || contentHash === undefined || effectiveFrom === undefined)
    return undefined;
  const validityOrder =
    supersededAt === undefined ? undefined : compareUtcInstants(effectiveFrom, supersededAt);
  if (supersededAt !== undefined && (validityOrder === undefined || validityOrder >= 0)) {
    pushError(
      errors,
      `${path}/supersededAt`,
      'POLICY_VALIDITY_MISMATCH',
      'Policy supersededAt must be later than effectiveFrom',
    );
    return undefined;
  }
  return {
    ref,
    contentHash,
    effectiveFrom,
    ...(supersededAt === undefined ? {} : { supersededAt }),
  };
}

function comparePolicyRefs(
  actual: PolicyRefParts | undefined,
  expected: PolicyRefParts | undefined,
  path: string,
  errors: ContextBuilderPolicyValidationError[],
): void {
  if (actual === undefined || expected === undefined) return;
  if (actual.objectId !== expected.objectId) {
    pushError(
      errors,
      `${path}/objectId`,
      'POLICY_REF_MISMATCH',
      'Policy objectId differs from the resolved ref',
    );
  }
  if (actual.versionId !== expected.versionId) {
    pushError(
      errors,
      `${path}/versionId`,
      'POLICY_REF_MISMATCH',
      'Policy versionId differs from the resolved ref',
    );
  }
  if (actual.scope.enterpriseId !== expected.scope.enterpriseId) {
    pushError(
      errors,
      `${path}/scope/enterpriseId`,
      'POLICY_REF_MISMATCH',
      'Policy enterprise Scope differs from the resolved ref',
    );
  }
  if (actual.scope.projectId !== expected.scope.projectId) {
    pushError(
      errors,
      `${path}/scope/projectId`,
      'POLICY_REF_MISMATCH',
      'Policy project Scope differs from the resolved ref',
    );
  }
}

function compareContentHashes(
  actual: Common.ContentHash,
  expected: Common.ContentHash,
  path: string,
  errors: ContextBuilderPolicyValidationError[],
): void {
  if (actual.digest !== expected.digest) {
    pushError(
      errors,
      `${path}/digest`,
      'POLICY_CONTENT_HASH_MISMATCH',
      'Policy contentHash differs',
    );
  }
}

function compareValidity(
  actual: PolicyBindingParts,
  expected: PolicyBindingParts,
  path: string,
  errors: ContextBuilderPolicyValidationError[],
): void {
  if (actual.effectiveFrom !== expected.effectiveFrom) {
    pushError(
      errors,
      `${path}/effectiveFrom`,
      'POLICY_VALIDITY_MISMATCH',
      'Policy effectiveFrom differs from the resolved policy',
    );
  }
  if (actual.supersededAt !== expected.supersededAt) {
    pushError(
      errors,
      `${path}/supersededAt`,
      'POLICY_VALIDITY_MISMATCH',
      'Policy supersededAt differs from the resolved policy',
    );
  }
}

function checkCurrentValidity(
  policy: PolicyBindingParts,
  now: unknown,
  errors: ContextBuilderPolicyValidationError[],
): void {
  if (typeof now !== 'string' || parseUtcInstant(now) === undefined) {
    pushError(errors, '/now', 'INVALID_CONSUMPTION_TIME', 'Policy consumption time is invalid');
    return;
  }
  const nowVsEffectiveFrom = compareUtcInstants(now, policy.effectiveFrom);
  if (nowVsEffectiveFrom === undefined) {
    pushError(errors, '/now', 'INVALID_CONSUMPTION_TIME', 'Policy consumption time is invalid');
    return;
  }
  if (nowVsEffectiveFrom < 0) {
    pushError(
      errors,
      '/resolvedPolicy/effectiveFrom',
      'POLICY_NOT_EFFECTIVE',
      'Policy is not effective at consumption time',
    );
  }
  const nowVsSuperseded =
    policy.supersededAt === undefined ? undefined : compareUtcInstants(now, policy.supersededAt);
  if (
    policy.supersededAt !== undefined &&
    (nowVsSuperseded === undefined || nowVsSuperseded >= 0)
  ) {
    pushError(
      errors,
      '/resolvedPolicy/supersededAt',
      'POLICY_EXPIRED',
      'Policy is expired or superseded at consumption time',
    );
  }
}

/**
 * Validates the WI-02 Builder Policy binding at one consumer checkpoint.
 * Callers must invoke the same check during candidate assembly, validation,
 * and freeze after re-reading the current IdentityPolicy observation.
 */
export function validateContextBuilderPolicyBinding(
  input: ContextBuilderPolicyBindingValidationInput,
): ContextBuilderPolicyValidationResult {
  const errors: ContextBuilderPolicyValidationError[] = [];
  const resolvedPolicy = readPolicyBinding(input.resolvedPolicy, '/resolvedPolicy', errors);
  const metadata = readPolicyBinding(input.contextBuildMetadata, '/contextBuildMetadata', errors);
  const inputRecord = input as unknown as UnknownRecord;
  const initialRequest = isRecord(inputRecord.initialRequest)
    ? inputRecord.initialRequest
    : undefined;
  const projectContext = isRecord(inputRecord.projectContext)
    ? inputRecord.projectContext
    : undefined;
  const projection = isRecord(projectContext?.projection) ? projectContext.projection : undefined;
  const workOrder = isRecord(inputRecord.workOrder) ? inputRecord.workOrder : undefined;
  const versionPins = isRecord(workOrder?.versionPins) ? workOrder.versionPins : undefined;
  const initialRef = readPolicyRef(
    initialRequest?.builderPolicyRef,
    '/initialRequest/builderPolicyRef',
    errors,
  );
  const projectionRef = readPolicyRef(
    projection?.builderPolicyRef,
    '/projectContext/projection/builderPolicyRef',
    errors,
  );
  const versionPinsRef = readPolicyRef(
    versionPins?.contextBuilderPolicyRef,
    '/workOrder/versionPins/contextBuilderPolicyRef',
    errors,
  );

  if (resolvedPolicy !== undefined) {
    comparePolicyRefs(
      metadata?.ref,
      resolvedPolicy.ref,
      '/contextBuildMetadata/builderPolicyRef',
      errors,
    );
    if (metadata !== undefined) {
      compareContentHashes(
        metadata.contentHash,
        resolvedPolicy.contentHash,
        '/contextBuildMetadata/contentHash',
        errors,
      );
      compareValidity(metadata, resolvedPolicy, '/contextBuildMetadata', errors);
    }
    comparePolicyRefs(initialRef, resolvedPolicy.ref, '/initialRequest/builderPolicyRef', errors);
    comparePolicyRefs(
      projectionRef,
      resolvedPolicy.ref,
      '/projectContext/projection/builderPolicyRef',
      errors,
    );
    comparePolicyRefs(
      versionPinsRef,
      resolvedPolicy.ref,
      '/workOrder/versionPins/contextBuilderPolicyRef',
      errors,
    );
    checkCurrentValidity(resolvedPolicy, input.now, errors);
  }

  return { valid: errors.length === 0, errors };
}
