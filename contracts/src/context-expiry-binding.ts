import type { Common, TaskExecution } from './generated/types/index.js';
import { compareUtcInstants, parseUtcInstant } from './utc-instant.js';

type UnknownRecord = Record<string, unknown>;

export type ContextExpiryBindingCode =
  | 'MISSING_EXPIRY_BINDING'
  | 'INVALID_EXPIRY_BINDING'
  | 'INVALID_EXPIRY_INPUT'
  | 'EXPIRY_UPPER_BOUND_EXCEEDED'
  | 'EXPIRY_OBSERVATION_MISMATCH'
  | 'EXPIRY_EFFECTIVE_MISMATCH'
  | 'CONTEXT_EXPIRY_MISMATCH'
  | 'CONTEXT_EXPIRED'
  | 'INVALID_CONSUMPTION_TIME';

export interface ContextExpiryBindingError {
  readonly path: string;
  readonly code: ContextExpiryBindingCode;
  readonly message: string;
}

export interface ContextExpiryBindingValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ContextExpiryBindingError[];
}

export interface ContextExpiryBindingValidationInput {
  /** `InitialContextBuildRequest.expiresAt`: the caller's Context upper bound. */
  readonly request: { readonly expiresAt?: Common.UtcInstant };
  /** WorkOrder Root / exact Draft Snapshot creation expiry, owned by §11.2.4. */
  readonly workOrder: { readonly expiresAt?: Common.UtcInstant };
  /** Consumed Source Slice upper bounds, in request order. */
  readonly sourceSlices: readonly { readonly validUntil?: Common.UtcInstant }[];
  /** Resolved IdentityPolicy observation; `supersededAt` is its finite end. */
  readonly builderPolicy: { readonly supersededAt?: Common.UtcInstant };
  /** Committed ProjectContext Snapshot payload. */
  readonly projectContext: { readonly expiresAt?: Common.UtcInstant };
  /** INITIAL `context_snapshot_build` expiry metadata for the same build. */
  readonly contextBuildMetadata: TaskExecution.InitialContextExpiryBinding;
  /** Trusted server time at this consumption checkpoint. */
  readonly now: Common.UtcInstant;
}

interface UpperBound {
  readonly path: string;
  readonly value: string | undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pushError(
  errors: ContextExpiryBindingError[],
  path: string,
  code: ContextExpiryBindingCode,
  message: string,
): void {
  errors.push({ path, code, message });
}

/**
 * Reads an optional instant. `undefined` means "no bound", while `null` and any
 * non-instant value are rejected: a JSON null must never stand in for an absent
 * expiry, and a malformed one must never silently widen the Context lifetime.
 */
function readOptionalInstant(
  value: unknown,
  path: string,
  code: ContextExpiryBindingCode,
  errors: ContextExpiryBindingError[],
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || parseUtcInstant(value) === undefined) {
    pushError(errors, path, code, 'Expiry upper bound is missing or not a valid UtcInstant');
    return undefined;
  }
  return value;
}

function readRequiredInstant(
  value: unknown,
  path: string,
  errors: ContextExpiryBindingError[],
): string | undefined {
  if (typeof value !== 'string' || parseUtcInstant(value) === undefined) {
    pushError(errors, path, 'INVALID_CONSUMPTION_TIME', 'Consumption time is missing or invalid');
    return undefined;
  }
  return value;
}

/**
 * Reads the INITIAL `context_snapshot_build` expiry metadata. Both members are
 * optional: a request may not carry an expiry, and the composition rule may
 * observe no finite upper bound at all. That absence is meaningful and must not
 * be read as unlimited authorization.
 */
function readExpiryBinding(
  value: unknown,
  errors: ContextExpiryBindingError[],
): TaskExecution.InitialContextExpiryBinding | undefined {
  if (!isRecord(value)) {
    pushError(
      errors,
      '/contextBuildMetadata',
      value === undefined ? 'MISSING_EXPIRY_BINDING' : 'INVALID_EXPIRY_BINDING',
      'Initial Context expiry metadata is missing or not an object',
    );
    return undefined;
  }

  const requestExpiresAt = readOptionalInstant(
    value.requestExpiresAt,
    '/contextBuildMetadata/requestExpiresAt',
    'INVALID_EXPIRY_BINDING',
    errors,
  );
  const effectiveExpiresAt = readOptionalInstant(
    value.effectiveExpiresAt,
    '/contextBuildMetadata/effectiveExpiresAt',
    'INVALID_EXPIRY_BINDING',
    errors,
  );
  if (
    (value.requestExpiresAt !== undefined && requestExpiresAt === undefined) ||
    (value.effectiveExpiresAt !== undefined && effectiveExpiresAt === undefined)
  ) {
    return undefined;
  }

  return {
    ...(requestExpiresAt === undefined ? {} : { requestExpiresAt }),
    ...(effectiveExpiresAt === undefined ? {} : { effectiveExpiresAt }),
  };
}

function readSourceSliceBounds(
  value: unknown,
  errors: ContextExpiryBindingError[],
): readonly UpperBound[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    pushError(
      errors,
      '/sourceSlices',
      'INVALID_EXPIRY_INPUT',
      'Expiry composition requires the non-empty consumed Source Slice list',
    );
    return undefined;
  }

  const bounds: UpperBound[] = [];
  for (const [index, slice] of value.entries()) {
    const path = `/sourceSlices/${index}/validUntil`;
    if (!isRecord(slice)) {
      pushError(
        errors,
        `/sourceSlices/${index}`,
        'INVALID_EXPIRY_INPUT',
        'Source Slice is invalid',
      );
      return undefined;
    }
    bounds.push({
      path,
      value: readOptionalInstant(slice.validUntil, path, 'INVALID_EXPIRY_INPUT', errors),
    });
  }
  return bounds;
}

function earliestBound(bounds: readonly UpperBound[]): string | undefined {
  let earliest: string | undefined;
  for (const bound of bounds) {
    if (bound.value === undefined) continue;
    if (earliest === undefined) {
      earliest = bound.value;
      continue;
    }
    if (compareUtcInstants(bound.value, earliest) === -1) earliest = bound.value;
  }
  return earliest;
}

/**
 * Compares a mirrored expiry with the value it must reproduce. Persisted and
 * committed mirrors are compared as exact values, not as instants: two
 * different canonical spellings of the same instant are still a mismatch, so a
 * rewritten expiry can never pass as a faithful copy.
 */
function sameExpiryValue(
  actual: string | undefined,
  expected: string | undefined,
  path: string,
  code: ContextExpiryBindingCode,
  message: string,
  errors: ContextExpiryBindingError[],
): void {
  if (actual === expected) return;
  pushError(errors, path, code, message);
}

/**
 * Composes and re-checks the Initial Context effective expiry. The request
 * `expiresAt` is an upper bound for the Context only — it never rewrites the
 * WorkOrder Root expiry and never relaxes a WorkOrder, Source Slice or
 * Builder Policy bound. An explicit request expiry that exceeds any finite
 * bound is rejected instead of silently truncated; an absent request expiry
 * resolves to the earliest finite bound, or to no bound at all when nothing
 * finite was observed.
 *
 * The same check runs at candidate assembly, Validator and Freeze with a fresh
 * trusted `now`; committed Snapshots and judgments are historical facts and are
 * never re-authorized by re-running the check.
 */
export function validateInitialContextExpiryBinding(
  input: ContextExpiryBindingValidationInput,
): ContextExpiryBindingValidationResult {
  const errors: ContextExpiryBindingError[] = [];
  const record = input as unknown as UnknownRecord;
  const request = isRecord(record.request) ? record.request : undefined;
  const workOrder = isRecord(record.workOrder) ? record.workOrder : undefined;
  const builderPolicy = isRecord(record.builderPolicy) ? record.builderPolicy : undefined;
  const projectContext = isRecord(record.projectContext) ? record.projectContext : undefined;

  const metadata = readExpiryBinding(record.contextBuildMetadata, errors);
  const requestExpiresAt = readOptionalInstant(
    request?.expiresAt,
    '/request/expiresAt',
    'INVALID_EXPIRY_INPUT',
    errors,
  );
  const workOrderExpiresAt = readOptionalInstant(
    workOrder?.expiresAt,
    '/workOrder/expiresAt',
    'INVALID_EXPIRY_INPUT',
    errors,
  );
  const builderPolicySupersededAt = readOptionalInstant(
    builderPolicy?.supersededAt,
    '/builderPolicy/supersededAt',
    'INVALID_EXPIRY_INPUT',
    errors,
  );
  const projectContextExpiresAt = readOptionalInstant(
    projectContext?.expiresAt,
    '/projectContext/expiresAt',
    'INVALID_EXPIRY_INPUT',
    errors,
  );
  const sliceBounds = readSourceSliceBounds(record.sourceSlices, errors);
  const now = readRequiredInstant(record.now, '/now', errors);

  if (metadata !== undefined) {
    sameExpiryValue(
      metadata.requestExpiresAt,
      requestExpiresAt,
      '/contextBuildMetadata/requestExpiresAt',
      'EXPIRY_OBSERVATION_MISMATCH',
      'Recorded request expiry must reproduce the observed request expiresAt exactly',
      errors,
    );
  }

  const bounds: readonly UpperBound[] = [
    { path: '/workOrder/expiresAt', value: workOrderExpiresAt },
    { path: '/builderPolicy/supersededAt', value: builderPolicySupersededAt },
    ...(sliceBounds ?? []),
  ];

  let effectiveExpiresAt: string | undefined;
  if (requestExpiresAt !== undefined) {
    for (const bound of bounds) {
      if (bound.value === undefined) continue;
      const compared = compareUtcInstants(requestExpiresAt, bound.value);
      if (compared === 1) {
        pushError(
          errors,
          bound.path,
          'EXPIRY_UPPER_BOUND_EXCEEDED',
          'Request expiresAt must not be later than a finite WorkOrder, Source Slice or Builder Policy bound',
        );
      }
    }
    effectiveExpiresAt = requestExpiresAt;
  } else {
    effectiveExpiresAt = earliestBound(bounds);
  }

  if (metadata !== undefined) {
    sameExpiryValue(
      metadata.effectiveExpiresAt,
      effectiveExpiresAt,
      '/contextBuildMetadata/effectiveExpiresAt',
      'EXPIRY_EFFECTIVE_MISMATCH',
      'Recorded effective expiry must equal the composed effective expiresAt',
      errors,
    );
  }
  sameExpiryValue(
    projectContextExpiresAt,
    effectiveExpiresAt,
    '/projectContext/expiresAt',
    'CONTEXT_EXPIRY_MISMATCH',
    'ProjectContext expiresAt must equal the composed effective expiresAt',
    errors,
  );

  if (effectiveExpiresAt !== undefined && now !== undefined) {
    const compared = compareUtcInstants(now, effectiveExpiresAt);
    if (compared === undefined) {
      pushError(errors, '/now', 'INVALID_CONSUMPTION_TIME', 'Consumption time is invalid');
    } else if (compared >= 0) {
      pushError(
        errors,
        '/contextBuildMetadata/effectiveExpiresAt',
        'CONTEXT_EXPIRED',
        'Initial Context is expired at consumption time',
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
