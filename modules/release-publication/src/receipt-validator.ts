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
//     RELEASE_RECEIPT_TARGET_MISMATCH;
//   - FormalReceiptSubmission.rawReceiptRef must resolve to a loaded
//     RawExternalReceipt fact whose release/destination/package/attempt
//     provenance matches (Module-Spec-006 §7.5 / RP-API-C-002).
//
// Persistence is abstracted behind ReleaseReceiptLedger so the production
// repository can replace the in-memory implementation without touching the
// validation rules. Formal receipt inserts go through compareAndSaveReceipt
// (unique-index semantics); DDL / real persistence remains NOT RUN in this
// slice.

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

/** Object type required on FormalReceiptSubmission.rawReceiptRef. */
export const RAW_EXTERNAL_RECEIPT_OBJECT_TYPE = 'integration.raw_external_receipt';
export const PUBLICATION_ATTEMPT_OBJECT_TYPE = 'release.publication_attempt';
export const PUBLICATION_RECEIPT_OBJECT_TYPE = 'release.publication_receipt';

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
 *
 * `compareAndSaveReceipt` is the only supported insert path for formal
 * receipts: production repositories MUST back it with a unique constraint /
 * single transactional write so a check-then-write race cannot mint two
 * formal receipts for the same stable key or raw digest.
 */
export interface ReleaseReceiptLedger {
  findAttempt(attemptId: string): PublicationAttemptRecord | undefined;
  findAttemptsByStableKey(stableIdempotencyKey: string): readonly PublicationAttemptRecord[];
  findReceiptByStableKey(stableIdempotencyKey: string): PublicationReceiptRecord | undefined;
  findReceiptByRawReceiptDigest(rawReceiptDigest: string): PublicationReceiptRecord | undefined;
  /**
   * Atomically insert an attempt while enforcing attemptRef immutability and
   * stable-key destination/package binding. Identical retries return the
   * existing record as a successful no-op.
   */
  compareAndSaveAttempt(record: PublicationAttemptRecord):
    | {
        readonly ok: true;
        readonly record: PublicationAttemptRecord;
        readonly inserted: boolean;
      }
    | {
        readonly ok: false;
        readonly existing: PublicationAttemptRecord;
        readonly conflictOn: 'ATTEMPT_REF' | 'STABLE_KEY';
      };
  /**
   * Atomically insert `record` if neither `stableKey` nor the raw digest is
   * occupied. Returns the conflicting existing receipt otherwise.
   */
  compareAndSaveReceipt(
    record: PublicationReceiptRecord,
    stableKey: string,
  ):
    | { readonly ok: true; readonly record: PublicationReceiptRecord }
    | {
        readonly ok: false;
        readonly existing: PublicationReceiptRecord;
        readonly conflictOn: 'STABLE_KEY' | 'RAW_DIGEST';
      };
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

  compareAndSaveAttempt(record: PublicationAttemptRecord):
    | {
        readonly ok: true;
        readonly record: PublicationAttemptRecord;
        readonly inserted: boolean;
      }
    | {
        readonly ok: false;
        readonly existing: PublicationAttemptRecord;
        readonly conflictOn: 'ATTEMPT_REF' | 'STABLE_KEY';
      } {
    const existingById = this.attemptsById.get(record.attemptRef.objectId);
    if (existingById !== undefined) {
      if (sameAttemptDefinition(existingById.definition, record.definition)) {
        return { ok: true, record: existingById, inserted: false };
      }
      return { ok: false, existing: existingById, conflictOn: 'ATTEMPT_REF' };
    }

    const stableKey = record.definition.stableIdempotencyKey;
    const bucket = this.attemptsByStableKey.get(stableKey) ?? [];
    const conflicting = bucket.find(
      (other) =>
        other.definition.destinationId !== record.definition.destinationId ||
        !samePackageRef(other.definition.packageRef, record.definition.packageRef),
    );
    if (conflicting !== undefined) {
      return { ok: false, existing: conflicting, conflictOn: 'STABLE_KEY' };
    }

    this.attemptsById.set(record.attemptRef.objectId, record);
    bucket.push(record);
    this.attemptsByStableKey.set(stableKey, bucket);
    return { ok: true, record, inserted: true };
  }

  compareAndSaveReceipt(
    record: PublicationReceiptRecord,
    stableKey: string,
  ):
    | { readonly ok: true; readonly record: PublicationReceiptRecord }
    | {
        readonly ok: false;
        readonly existing: PublicationReceiptRecord;
        readonly conflictOn: 'STABLE_KEY' | 'RAW_DIGEST';
      } {
    const existingByKey = this.receiptsByStableKey.get(stableKey);
    if (existingByKey !== undefined) {
      return { ok: false, existing: existingByKey, conflictOn: 'STABLE_KEY' };
    }
    const rawDigest = record.submission.rawReceiptRef.contentHash.digest;
    const existingByDigest = this.receiptsByRawDigest.get(rawDigest);
    if (existingByDigest !== undefined) {
      return { ok: false, existing: existingByDigest, conflictOn: 'RAW_DIGEST' };
    }
    this.receiptsByStableKey.set(stableKey, record);
    this.receiptsByRawDigest.set(rawDigest, record);
    return { ok: true, record };
  }
}

// =============================================================================
// RawExternalReceipt repository boundary (cross-aggregate provenance)
// =============================================================================

/**
 * Loaded Raw External Receipt fact used by ReleasePublication to enforce
 * Module-Spec-006 §7.5 / RP-API-C-002 before minting a Formal PublicationReceipt.
 *
 * IntegrationGateway owns the observation write path; this module only consumes
 * the resolved fact. Production wiring loads it from the Integration repository;
 * tests / fixtures seed an in-memory store.
 */
export interface RawExternalReceiptFact {
  readonly rawReceiptRef: Common.ContentAddressedRef;
  readonly releaseId: string;
  readonly destinationId: string;
  readonly packageHashDigest: string;
  readonly publicationAttemptId: string;
  readonly adapterAttemptRef: ObjectRef;
  readonly receiptPayloadHash: Common.ContentHash;
  readonly observedOutcome: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  readonly occurredAt?: string;
  readonly recordedAt: string;
}

export interface RawExternalReceiptRepository {
  findByRef(rawReceiptRef: Common.ContentAddressedRef): RawExternalReceiptFact | undefined;
}

export class InMemoryRawExternalReceiptRepository implements RawExternalReceiptRepository {
  private readonly byDigest = new Map<string, RawExternalReceiptFact>();

  save(fact: RawExternalReceiptFact): void {
    this.byDigest.set(fact.rawReceiptRef.contentHash.digest, fact);
  }

  findByRef(rawReceiptRef: Common.ContentAddressedRef): RawExternalReceiptFact | undefined {
    const found = this.byDigest.get(rawReceiptRef.contentHash.digest);
    if (found === undefined) {
      return undefined;
    }
    if (!sameContentAddressedRef(found.rawReceiptRef, rawReceiptRef)) {
      return undefined;
    }
    return found;
  }
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
  if (request.attemptRef.objectType !== PUBLICATION_ATTEMPT_OBJECT_TYPE) {
    return {
      ok: false,
      error: rejection({
        code: RELEASE_RECEIPT_TARGET_MISMATCH,
        category: 'VALIDATION',
        retryDisposition: 'DO_NOT_RETRY',
        safeMessage: 'attemptRef must address a release.publication_attempt object',
        fieldPath: '/payload/attemptRef/objectType',
        violatedRule: 'publication attempts require the registered attempt object type',
        correlationId: request.correlationId,
        targetRef: request.attemptRef,
      }),
    };
  }
  const record: PublicationAttemptRecord = {
    attemptRef: request.attemptRef,
    definition: request.definition,
  };
  const saved = ledger.compareAndSaveAttempt(record);
  if (saved.ok) {
    return { ok: true, record: saved.record };
  }

  const attemptRefConflict = saved.conflictOn === 'ATTEMPT_REF';
  return {
    ok: false,
    error: rejection({
      code: RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT,
      category: 'CONFLICT',
      retryDisposition: 'RELOAD_AND_REEVALUATE',
      safeMessage: attemptRefConflict
        ? 'publication attempt already registered under this attemptRef with a different definition'
        : 'stable idempotency key already bound to a different destination or packageHash',
      fieldPath: attemptRefConflict ? '/payload/attempt' : '/payload/attempt/stableIdempotencyKey',
      violatedRule: attemptRefConflict
        ? 'attempt definitions are immutable once registered'
        : 'one stable key maps to exactly one destination/package pair',
      correlationId: request.correlationId,
      targetRef: request.attemptRef,
    }),
  };
}

// =============================================================================
// Formal receipt validation + atomic record (record_publication_receipt)
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
 * 5. TARGET_MISMATCH — rawReceiptRef objectType / missing fact / provenance
 *    (release, destination, packageHash, publication attempt) mismatch;
 * 6. STALE — occurredAt beyond requestedAt + deliveryTimeout;
 * 7. Atomic compare-and-save — uniqueness conflicts surface as ALREADY_RECORDED
 *    or IDEMPOTENCY_CONFLICT without a separate save step.
 */
export function recordFormalReceipt(
  ledger: ReleaseReceiptLedger,
  rawReceipts: RawExternalReceiptRepository,
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

  if (!sameObjectRef(attempt.attemptRef, submission.attemptRef)) {
    return {
      ok: false,
      error: rejection({
        code: RELEASE_RECEIPT_TARGET_MISMATCH,
        category: 'VALIDATION',
        retryDisposition: 'DO_NOT_RETRY',
        safeMessage:
          'receipt attemptRef does not match the registered publication attempt identity',
        fieldPath: '/payload/receipt/attemptRef',
        violatedRule: 'receipt attemptRef must match objectType, objectId and scope of the attempt',
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

  // 5. Raw observation must be a loaded RawExternalReceipt with matching
  //    release / destination / packageHash / publication attempt provenance.
  const provenance = validateRawReceiptProvenance(
    rawReceipts,
    submission,
    attempt,
    request.correlationId,
  );
  if (!provenance.ok) {
    return { ok: false, error: provenance.error };
  }

  // 6. Raw observation dedup by content hash (defense in depth before insert).
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

  // 7. Late window: occurredAt must fall within requestedAt + deliveryTimeout.
  const authoritativeOccurredAt = provenance.fact.occurredAt ?? provenance.fact.recordedAt;
  const elapsedMs =
    Date.parse(authoritativeOccurredAt) - Date.parse(attempt.definition.requestedAt);
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

  const record: PublicationReceiptRecord = {
    receiptRef: request.receiptRef,
    submission,
  };

  if (request.receiptRef.objectType !== PUBLICATION_RECEIPT_OBJECT_TYPE) {
    return {
      ok: false,
      error: rejection({
        code: RELEASE_RECEIPT_TARGET_MISMATCH,
        category: 'VALIDATION',
        retryDisposition: 'DO_NOT_RETRY',
        safeMessage: 'receiptRef must address a release.publication_receipt fact',
        fieldPath: '/receiptRef/objectType',
        violatedRule: 'formal receipt facts require the registered receipt object type',
        correlationId: request.correlationId,
        targetRef: submission.attemptRef,
      }),
    };
  }
  if (!sameScopeRef(request.receiptRef.scope, submission.packageRef.releaseRef.scope)) {
    return {
      ok: false,
      error: rejection({
        code: RELEASE_RECEIPT_TARGET_MISMATCH,
        category: 'VALIDATION',
        retryDisposition: 'DO_NOT_RETRY',
        safeMessage: 'receiptRef scope does not match the target release scope',
        fieldPath: '/receiptRef/scope',
        violatedRule: 'formal receipt facts must share the release scope',
        correlationId: request.correlationId,
        targetRef: submission.attemptRef,
      }),
    };
  }

  // 8. Atomic compare-and-save — uniqueness is enforced here, not via a
  //    separate validate-then-save pair that can race.
  const saved = ledger.compareAndSaveReceipt(record, stableKey);
  if (!saved.ok) {
    if (
      saved.conflictOn === 'STABLE_KEY' &&
      saved.existing.submission.packageRef.packageHash.digest !==
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
        safeMessage: 'a formal receipt is already recorded for this stable key or raw receipt',
        fieldPath: '/payload/receipt/rawReceiptRef',
        violatedRule: 'formal receipt insert is unique on stable key and raw digest',
        correlationId: request.correlationId,
        targetRef: submission.attemptRef,
      }),
    };
  }

  return { ok: true, record: saved.record };
}

type RawReceiptProvenanceResult =
  | { readonly ok: true; readonly fact: RawExternalReceiptFact }
  | { readonly ok: false; readonly error: ApiError };

function validateRawReceiptProvenance(
  rawReceipts: RawExternalReceiptRepository,
  submission: FormalReceiptSubmission,
  attempt: PublicationAttemptRecord,
  correlationId: string,
): RawReceiptProvenanceResult {
  const rawRef = submission.rawReceiptRef;
  if (rawRef.objectType !== RAW_EXTERNAL_RECEIPT_OBJECT_TYPE) {
    return {
      ok: false,
      error: rejection({
        code: RELEASE_RECEIPT_TARGET_MISMATCH,
        category: 'VALIDATION',
        retryDisposition: 'DO_NOT_RETRY',
        safeMessage: 'rawReceiptRef must address an integration.raw_external_receipt fact',
        fieldPath: '/payload/receipt/rawReceiptRef/objectType',
        violatedRule: 'formal receipts require a RawExternalReceipt content-addressed ref',
        correlationId,
        targetRef: submission.attemptRef,
      }),
    };
  }

  const fact = rawReceipts.findByRef(rawRef);
  if (fact === undefined) {
    return rawProvenanceRejection(
      submission,
      correlationId,
      'rawReceiptRef does not resolve to a loaded RawExternalReceipt fact',
      'formal receipts require a previously recorded raw observation',
    );
  }

  if (fact.releaseId !== attempt.definition.packageRef.releaseRef.objectId) {
    return rawProvenanceRejection(
      submission,
      correlationId,
      'raw external receipt release does not match the publication attempt release',
      'RawExternalReceipt.releaseId must equal attempt.packageRef.releaseRef',
    );
  }
  if (
    !sameScopeRef(rawRef.scope, attempt.definition.packageRef.releaseRef.scope) ||
    !sameScopeRef(fact.adapterAttemptRef.scope, attempt.definition.packageRef.releaseRef.scope)
  ) {
    return rawProvenanceRejection(
      submission,
      correlationId,
      'raw external receipt scope does not match the publication attempt release',
      'RawExternalReceipt and adapter attempt must share the release scope',
    );
  }
  if (fact.destinationId !== submission.destinationId) {
    return rawProvenanceRejection(
      submission,
      correlationId,
      'raw external receipt destination does not match the formal receipt',
      'RawExternalReceipt.destinationId must equal receipt.destinationId',
    );
  }
  if (fact.packageHashDigest !== submission.packageRef.packageHash.digest) {
    return rawProvenanceRejection(
      submission,
      correlationId,
      'raw external receipt packageHash does not match the formal receipt',
      'RawExternalReceipt.packageHash must equal receipt.packageRef.packageHash',
    );
  }
  if (fact.publicationAttemptId !== submission.attemptRef.objectId) {
    return rawProvenanceRejection(
      submission,
      correlationId,
      'raw external receipt attempt does not match the formal receipt attempt',
      'RawExternalReceipt.publicationAttemptId must equal receipt.attemptRef',
    );
  }
  if (fact.observedOutcome !== 'SUCCEEDED') {
    return rawProvenanceRejection(
      submission,
      correlationId,
      'raw external receipt does not report a successful delivery',
      'only a SUCCEEDED RawExternalReceipt may become a Formal PublicationReceipt',
    );
  }
  if (!sameContentHash(fact.receiptPayloadHash, submission.receiptPayloadHash)) {
    return rawProvenanceRejection(
      submission,
      correlationId,
      'formal receipt payload hash does not match the raw external receipt',
      'receipt.receiptPayloadHash must equal RawExternalReceipt.receiptPayloadHash',
    );
  }
  const authoritativeOccurredAt = fact.occurredAt ?? fact.recordedAt;
  if (submission.occurredAt !== authoritativeOccurredAt) {
    return rawProvenanceRejection(
      submission,
      correlationId,
      'formal receipt occurrence time does not match the raw external receipt',
      'receipt.occurredAt must equal RawExternalReceipt.occurredAt or recordedAt fallback',
    );
  }
  return { ok: true, fact };
}

function rawProvenanceRejection(
  submission: FormalReceiptSubmission,
  correlationId: string,
  safeMessage: string,
  violatedRule: string,
): RawReceiptProvenanceResult {
  return {
    ok: false,
    error: rejection({
      code: RELEASE_RECEIPT_TARGET_MISMATCH,
      category: 'VALIDATION',
      retryDisposition: 'DO_NOT_RETRY',
      safeMessage,
      fieldPath: '/payload/receipt/rawReceiptRef',
      violatedRule,
      correlationId,
      targetRef: submission.attemptRef,
    }),
  };
}

// =============================================================================
// Shared helpers
// =============================================================================

export function samePackageRef(left: ReleasePackageRef, right: ReleasePackageRef): boolean {
  return (
    sameObjectRef(left.releaseRef, right.releaseRef) &&
    sameSnapshotRef(left.packageSnapshotRef, right.packageSnapshotRef) &&
    sameContentHash(left.packageHash, right.packageHash)
  );
}

export function sameObjectRef(left: ObjectRef, right: ObjectRef): boolean {
  return (
    left.objectType === right.objectType &&
    left.objectId === right.objectId &&
    sameScopeRef(left.scope, right.scope)
  );
}

export function sameScopeRef(left: Common.ScopeRef, right: Common.ScopeRef): boolean {
  return left.enterpriseId === right.enterpriseId && left.projectId === right.projectId;
}

function sameSnapshotRef(left: Common.SnapshotRef, right: Common.SnapshotRef): boolean {
  return (
    left.objectType === right.objectType &&
    left.objectId === right.objectId &&
    left.snapshotId === right.snapshotId &&
    left.scope.enterpriseId === right.scope.enterpriseId &&
    left.scope.projectId === right.scope.projectId &&
    sameContentHash(left.contentHash, right.contentHash)
  );
}

function sameContentAddressedRef(
  left: Common.ContentAddressedRef,
  right: Common.ContentAddressedRef,
): boolean {
  return (
    left.objectType === right.objectType &&
    left.objectId === right.objectId &&
    left.immutableVersionId === right.immutableVersionId &&
    left.scope.enterpriseId === right.scope.enterpriseId &&
    left.scope.projectId === right.scope.projectId &&
    sameContentHash(left.contentHash, right.contentHash)
  );
}

function sameContentHash(left: Common.ContentHash, right: Common.ContentHash): boolean {
  // The generated contract type fixes algorithm=SHA-256 and
  // canonicalizationVersion=1, so digest is the only varying identity field.
  return left.digest === right.digest;
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
    sameContentAddressedRef(left.externalDeliveryRequestRef, right.externalDeliveryRequestRef)
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
