// Runtime Receipt Validator for `release.record_publication_receipt`.
//
// Implements the duplicate / late receipt detection required by Issue #15
// (IM-RP-001) on top of the field-level schema prerequisites from PR #14:
//   - same stable idempotency key with a different packageHash is rejected as
//     RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT and never overwrites the recorded fact;
//   - a repeated rawReceiptRef (same content hash) is rejected as
//     RELEASE_RECEIPT_ALREADY_RECORDED;
//   - an occurredAt beyond attempt.requestedAt + deliveryTimeout is rejected as
//     RELEASE_RECEIPT_STALE;
//   - receipts that do not match their referenced attempt are rejected as
//     RELEASE_RECEIPT_TARGET_MISMATCH.
//
// Persistence is abstracted behind ReleaseReceiptLedger so the production
// repository can replace the in-memory implementation without touching the
// validation rules (DDL / real persistence remains NOT RUN in this slice).

import { apiError, parseUuidV7 } from '@zhiju/shared-kernel';
import type {
  ApiError,
  ApiErrorCategory,
  ObjectRef as KernelObjectRef,
  RetryDisposition,
  ScopeRef as KernelScopeRef,
} from '@zhiju/shared-kernel';
import type { Common, ReleasePublication } from '@zhiju/contracts';

type FormalReceiptSubmission = ReleasePublication.FormalReceiptSubmission;
type PublicationAttemptDefinition = ReleasePublication.PublicationAttemptDefinition;
type ReleasePackageRef = Common.ReleasePackageRef;
type ObjectRef = Common.ObjectRef;

// =============================================================================
// Error codes (Module-Spec-006 §6)
// =============================================================================

export const RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT = 'RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT';
export const RELEASE_RECEIPT_TARGET_MISMATCH = 'RELEASE_RECEIPT_TARGET_MISMATCH';
export const RELEASE_RECEIPT_ALREADY_RECORDED = 'RELEASE_RECEIPT_ALREADY_RECORDED';
export const RELEASE_RECEIPT_STALE = 'RELEASE_RECEIPT_STALE';

// =============================================================================
// Ledger records and stable-key index
// =============================================================================

export interface PublicationAttemptRecord {
  readonly attemptRef: ObjectRef;
  readonly definition: PublicationAttemptDefinition;
}

export interface PublicationReceiptRecord {
  readonly receiptRef: Common.ContentAddressedRef;
  readonly submission: FormalReceiptSubmission;
}

/**
 * Stable-key index over PublicationAttempt + PublicationReceipt facts.
 *
 * Implementations must index attempts by `attemptRef.objectId` and by
 * `stableIdempotencyKey`, and receipts by the owning `stableIdempotencyKey`
 * plus the `rawReceiptRef.contentHash.digest` of their submission.
 */
export interface ReleaseReceiptLedger {
  findAttempt(attemptId: string): PublicationAttemptRecord | undefined;
  findAttemptsByStableKey(stableIdempotencyKey: string): readonly PublicationAttemptRecord[];
  findReceiptByStableKey(stableIdempotencyKey: string): PublicationReceiptRecord | undefined;
  findReceiptByRawReceiptDigest(rawReceiptDigest: string): PublicationReceiptRecord | undefined;
  saveAttempt(record: PublicationAttemptRecord): void;
  saveReceipt(record: PublicationReceiptRecord): void;
}

export class InMemoryReleaseReceiptLedger implements ReleaseReceiptLedger {
  private readonly attemptsById = new Map<string, PublicationAttemptRecord>();
  private readonly attemptsByStableKey = new Map<string, PublicationAttemptRecord[]>();
  private readonly receiptsByStableKey = new Map<string, PublicationReceiptRecord>();
  private readonly receiptsByRawDigest = new Map<string, PublicationReceiptRecord>();

  findAttempt(attemptId: string): PublicationAttemptRecord | undefined {
    return this.attemptsById.get(attemptId);
  }

  findAttemptsByStableKey(stableIdempotencyKey: string): readonly PublicationAttemptRecord[] {
    return this.attemptsByStableKey.get(stableIdempotencyKey) ?? [];
  }

  findReceiptByStableKey(stableIdempotencyKey: string): PublicationReceiptRecord | undefined {
    return this.receiptsByStableKey.get(stableIdempotencyKey);
  }

  findReceiptByRawReceiptDigest(rawReceiptDigest: string): PublicationReceiptRecord | undefined {
    return this.receiptsByRawDigest.get(rawReceiptDigest);
  }

  saveAttempt(record: PublicationAttemptRecord): void {
    this.attemptsById.set(record.attemptRef.objectId, record);
    const bucket = this.attemptsByStableKey.get(record.definition.stableIdempotencyKey) ?? [];
    bucket.push(record);
    this.attemptsByStableKey.set(record.definition.stableIdempotencyKey, bucket);
  }

  saveReceipt(record: PublicationReceiptRecord): void {
    const stableKey = stableKeyOf(record.submission, this);
    if (stableKey !== undefined) {
      this.receiptsByStableKey.set(stableKey, record);
    }
    this.receiptsByRawDigest.set(record.submission.rawReceiptRef.contentHash.digest, record);
  }
}

function stableKeyOf(
  submission: FormalReceiptSubmission,
  ledger: ReleaseReceiptLedger,
): string | undefined {
  return ledger.findAttempt(submission.attemptRef.objectId)?.definition.stableIdempotencyKey;
}

// =============================================================================
// Attempt registration (start_publication_attempt write path)
// =============================================================================

export type AttemptRegistrationResult =
  | { readonly ok: true; readonly record: PublicationAttemptRecord }
  | { readonly ok: false; readonly error: ApiError };

export interface AttemptRegistrationRequest {
  readonly attemptRef: ObjectRef;
  readonly definition: PublicationAttemptDefinition;
  readonly correlationId: string;
}

/**
 * Registers an attempt under its stable idempotency key. Retries of the same
 * destination/package legitimately share one key; a key that disagrees about
 * destination or packageHash is an attempt/receipt conflict and is rejected
 * without mutating the ledger.
 */
export function registerPublicationAttempt(
  ledger: ReleaseReceiptLedger,
  request: AttemptRegistrationRequest,
): AttemptRegistrationResult {
  const existingById = ledger.findAttempt(request.attemptRef.objectId);
  if (existingById !== undefined) {
    if (sameAttemptDefinition(existingById.definition, request.definition)) {
      return { ok: true, record: existingById };
    }
    return {
      ok: false,
      error: rejection({
        code: RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT,
        category: 'CONFLICT',
        retryDisposition: 'RELOAD_AND_REEVALUATE',
        safeMessage:
          'publication attempt already registered under this attemptRef with a different definition',
        fieldPath: '/payload/attempt',
        violatedRule: 'attempt definitions are immutable once registered',
        correlationId: request.correlationId,
        targetRef: request.attemptRef,
      }),
    };
  }

  for (const other of ledger.findAttemptsByStableKey(request.definition.stableIdempotencyKey)) {
    const sameDestination = other.definition.destinationId === request.definition.destinationId;
    if (
      !sameDestination ||
      !samePackageRef(other.definition.packageRef, request.definition.packageRef)
    ) {
      return {
        ok: false,
        error: rejection({
          code: RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT,
          category: 'CONFLICT',
          retryDisposition: 'RELOAD_AND_REEVALUATE',
          safeMessage:
            'stable idempotency key already bound to a different destination or packageHash',
          fieldPath: '/payload/attempt/stableIdempotencyKey',
          violatedRule: 'one stable key maps to exactly one destination/package pair',
          correlationId: request.correlationId,
          targetRef: request.attemptRef,
        }),
      };
    }
  }

  const record: PublicationAttemptRecord = {
    attemptRef: request.attemptRef,
    definition: request.definition,
  };
  ledger.saveAttempt(record);
  return { ok: true, record };
}

// =============================================================================
// Formal receipt validation (record_publication_receipt write path)
// =============================================================================

export type ReceiptValidationResult =
  | { readonly ok: true; readonly record: PublicationReceiptRecord }
  | { readonly ok: false; readonly error: ApiError };

export interface ReceiptValidationRequest {
  readonly submission: FormalReceiptSubmission;
  /** Content-addressed ref minted by the caller for the formal receipt fact. */
  readonly receiptRef: Common.ContentAddressedRef;
  /**
   * Late window granted by the destination DeliveryPolicy in milliseconds
   * (`policy.delivery.deliveryTimeout`). Injected by the caller until the
   * Policy domain confirms the field-level contract (Issue #15 dependency).
   */
  readonly deliveryTimeoutMs: number;
  readonly correlationId: string;
}

/**
 * Validation precedence (documented in Module-Spec-006 §7):
 * 1. TARGET_MISMATCH — unknown attemptRef or destination disagreement;
 * 2. IDEMPOTENCY_CONFLICT — the stable key already carries a receipt for a
 *    different packageHash (checked before per-attempt equality so the
 *    issue-mandated "same stable key / different packageHash" case surfaces
 *    as the conflict class); the original receipt is never overwritten;
 * 3. ALREADY_RECORDED — at most one formal receipt per stable key, also
 *    enforced per rawReceiptRef content hash;
 * 4. TARGET_MISMATCH — packageRef disagrees with the referenced attempt;
 * 5. STALE — occurredAt beyond requestedAt + deliveryTimeout.
 */
export function validateFormalReceipt(
  ledger: ReleaseReceiptLedger,
  request: ReceiptValidationRequest,
): ReceiptValidationResult {
  const submission = request.submission;

  // 1. The referenced attempt must exist.
  const attempt = ledger.findAttempt(submission.attemptRef.objectId);
  if (attempt === undefined) {
    return {
      ok: false,
      error: rejection({
        code: RELEASE_RECEIPT_TARGET_MISMATCH,
        category: 'VALIDATION',
        retryDisposition: 'DO_NOT_RETRY',
        safeMessage: 'receipt references an unregistered publication attempt',
        fieldPath: '/payload/receipt/attemptRef',
        violatedRule: 'formal receipts require a registered publication attempt',
        correlationId: request.correlationId,
        targetRef: submission.attemptRef,
      }),
    };
  }

  // 2. The destination must match the referenced attempt.
  if (attempt.definition.destinationId !== submission.destinationId) {
    return {
      ok: false,
      error: rejection({
        code: RELEASE_RECEIPT_TARGET_MISMATCH,
        category: 'VALIDATION',
        retryDisposition: 'DO_NOT_RETRY',
        safeMessage: 'receipt destination does not match the referenced attempt',
        fieldPath: '/payload/receipt/destinationId',
        violatedRule: 'receipt destinationId must equal the attempt destinationId',
        correlationId: request.correlationId,
        targetRef: submission.attemptRef,
      }),
    };
  }

  // 3. Stable-key authority: one formal receipt per key, same packageHash only.
  const stableKey = attempt.definition.stableIdempotencyKey;
  const existingReceipt = ledger.findReceiptByStableKey(stableKey);
  if (existingReceipt !== undefined) {
    if (
      existingReceipt.submission.packageRef.packageHash.digest !==
      submission.packageRef.packageHash.digest
    ) {
      return {
        ok: false,
        error: rejection({
          code: RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT,
          category: 'CONFLICT',
          retryDisposition: 'RELOAD_AND_REEVALUATE',
          safeMessage:
            'stable idempotency key already recorded with a different packageHash; original receipt preserved',
          fieldPath: '/payload/receipt/packageRef/packageHash',
          violatedRule: 'one stable key maps to exactly one packageHash',
          correlationId: request.correlationId,
          targetRef: submission.attemptRef,
        }),
      };
    }
    return {
      ok: false,
      error: rejection({
        code: RELEASE_RECEIPT_ALREADY_RECORDED,
        category: 'CONFLICT',
        retryDisposition: 'RELOAD_AND_REEVALUATE',
        safeMessage: 'a formal receipt is already recorded for this stable idempotency key',
        fieldPath: '/payload/receipt/rawReceiptRef',
        violatedRule: 'at most one formal receipt per stable idempotency key',
        correlationId: request.correlationId,
        targetRef: submission.attemptRef,
      }),
    };
  }

  // 4. The receipt package must equal the referenced attempt package.
  if (!samePackageRef(attempt.definition.packageRef, submission.packageRef)) {
    return {
      ok: false,
      error: rejection({
        code: RELEASE_RECEIPT_TARGET_MISMATCH,
        category: 'VALIDATION',
        retryDisposition: 'DO_NOT_RETRY',
        safeMessage: 'receipt package does not match the referenced attempt package',
        fieldPath: '/payload/receipt/packageRef',
        violatedRule: 'receipt packageRef must equal the attempt packageRef',
        correlationId: request.correlationId,
        targetRef: submission.attemptRef,
      }),
    };
  }

  // 5. Raw observation dedup by content hash (defense in depth).
  const rawDigest = submission.rawReceiptRef.contentHash.digest;
  if (ledger.findReceiptByRawReceiptDigest(rawDigest) !== undefined) {
    return {
      ok: false,
      error: rejection({
        code: RELEASE_RECEIPT_ALREADY_RECORDED,
        category: 'CONFLICT',
        retryDisposition: 'RELOAD_AND_REEVALUATE',
        safeMessage: 'raw external receipt content hash already recorded',
        fieldPath: '/payload/receipt/rawReceiptRef',
        violatedRule: 'rawReceiptRef content hash must be unique per release',
        correlationId: request.correlationId,
        targetRef: submission.attemptRef,
      }),
    };
  }

  // 6. Late window: occurredAt must fall within requestedAt + deliveryTimeout.
  const elapsedMs = Date.parse(submission.occurredAt) - Date.parse(attempt.definition.requestedAt);
  if (elapsedMs > request.deliveryTimeoutMs) {
    return {
      ok: false,
      error: rejection({
        code: RELEASE_RECEIPT_STALE,
        category: 'LIFECYCLE',
        retryDisposition: 'NEW_COMMAND_REQUIRED',
        safeMessage: 'receipt occurred after the delivery timeout window of its attempt',
        fieldPath: '/payload/receipt/occurredAt',
        violatedRule: 'occurredAt must be within requestedAt + deliveryTimeout',
        correlationId: request.correlationId,
        targetRef: submission.attemptRef,
      }),
    };
  }

  return {
    ok: true,
    record: { receiptRef: request.receiptRef, submission },
  };
}

// =============================================================================
// Shared helpers
// =============================================================================

function samePackageRef(left: ReleasePackageRef, right: ReleasePackageRef): boolean {
  return (
    left.releaseRef.objectId === right.releaseRef.objectId &&
    left.packageSnapshotRef.snapshotId === right.packageSnapshotRef.snapshotId &&
    left.packageSnapshotRef.contentHash.digest === right.packageSnapshotRef.contentHash.digest &&
    left.packageHash.digest === right.packageHash.digest
  );
}

function sameAttemptDefinition(
  left: PublicationAttemptDefinition,
  right: PublicationAttemptDefinition,
): boolean {
  return (
    left.destinationId === right.destinationId &&
    left.attemptNumber === right.attemptNumber &&
    left.stableIdempotencyKey === right.stableIdempotencyKey &&
    left.requestedAt === right.requestedAt &&
    samePackageRef(left.packageRef, right.packageRef) &&
    left.externalDeliveryRequestRef.objectId === right.externalDeliveryRequestRef.objectId &&
    left.externalDeliveryRequestRef.contentHash.digest ===
      right.externalDeliveryRequestRef.contentHash.digest
  );
}

interface RejectionInput {
  readonly code: string;
  readonly category: ApiErrorCategory;
  readonly retryDisposition: RetryDisposition;
  readonly safeMessage: string;
  readonly fieldPath: string;
  readonly violatedRule: string;
  readonly correlationId: string;
  readonly targetRef?: ObjectRef;
}

/**
 * Converts a contract-level ObjectRef (plain string ids, schema-validated at
 * the envelope layer) into the branded shared-kernel ObjectRef expected by
 * ApiError.targetRef.
 */
function toKernelObjectRef(ref: ObjectRef): KernelObjectRef {
  const scope: KernelScopeRef = {
    ...(ref.scope.enterpriseId === undefined
      ? {}
      : { enterpriseId: parseUuidV7(ref.scope.enterpriseId) }),
    ...(ref.scope.projectId === undefined ? {} : { projectId: parseUuidV7(ref.scope.projectId) }),
  };
  return {
    kind: 'OBJECT',
    objectType: ref.objectType,
    objectId: parseUuidV7(ref.objectId),
    scope,
  };
}

/** Builds a registered ApiError for a receipt/attempt rejection. */
export function buildApiRejection(input: RejectionInput): ApiError {
  const kernelTargetRef =
    input.targetRef === undefined ? undefined : toKernelObjectRef(input.targetRef);
  return apiError({
    code: input.code,
    category: input.category,
    safeMessage: input.safeMessage,
    fieldViolations: [
      {
        code: input.code,
        fieldPath: input.fieldPath,
        violatedRule: input.violatedRule,
        ...(kernelTargetRef === undefined ? {} : { targetRef: kernelTargetRef }),
      },
    ],
    ...(kernelTargetRef === undefined ? {} : { targetRef: kernelTargetRef }),
    retryDisposition: input.retryDisposition,
    correlationId: input.correlationId,
  });
}

function rejection(input: RejectionInput): ApiError {
  return buildApiRejection(input);
}
