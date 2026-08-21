// ReleasePublication Runtime write path for publication attempts and formal
// receipts (Issue #15 / IM-RP-001).
//
// This is a domain-service level orchestrator: it owns the release-level
// destination outcomes and delegates fact-level validation to the Receipt
// Validator. It intentionally does not handle command envelopes, HTTP
// transport or persistence beyond the ReleaseReceiptLedger /
// RawExternalReceiptRepository abstractions — those layers remain future
// work (see Module-Spec-006 §9). IntegrationGateway provider injection is
// tracked by Issue #17 and is NOT claimed by this slice.

import type { ApiError } from '@zhiju/shared-kernel';
import type { Common, ReleasePublication } from '@zhiju/contracts';

import {
  InMemoryRawExternalReceiptRepository,
  InMemoryReleaseReceiptLedger,
  registerPublicationAttempt,
  recordFormalReceipt,
  buildApiRejection,
  sameObjectRef,
  samePackageRef,
  RELEASE_RECEIPT_TARGET_MISMATCH,
  type ReceiptValidationResult,
  type RawExternalReceiptFact,
  type RawExternalReceiptRepository,
  type ReleaseReceiptLedger,
} from './receipt-validator.js';

type ObjectRef = Common.ObjectRef;
type ReleasePackageRef = Common.ReleasePackageRef;

type PublicationAttemptDefinition = ReleasePublication.PublicationAttemptDefinition;
type FormalReceiptSubmission = ReleasePublication.FormalReceiptSubmission;
type ReleaseStatus = ReleasePublication.ReleaseStatus;

/** Per-destination delivery policy snapshot used by the late-receipt window. */
export interface ReleaseDestinationPolicy {
  readonly destinationId: string;
  readonly required: boolean;
  /**
   * `policy.delivery.deliveryTimeout` in milliseconds. Injected until the
   * Policy domain confirms the field-level contract (Issue #15 dependency).
   */
  readonly deliveryTimeoutMs: number;
}

export interface ReleasePublicationOutcomeView {
  readonly releaseRef: ObjectRef;
  readonly status: ReleaseStatus;
  readonly succeededDestinationIds: readonly string[];
  readonly pendingDestinationIds: readonly string[];
  readonly receiptRefs: readonly Common.ContentAddressedRef[];
}

interface ReleaseState {
  readonly releaseRef: ObjectRef;
  readonly destinations: ReadonlyMap<string, ReleaseDestinationPolicy>;
  readonly receiptsByDestination: Map<string, Common.ContentAddressedRef>;
  /** Frozen on the first accepted publication attempt for this release. */
  frozenPackageRef: ReleasePackageRef | undefined;
  status: ReleaseStatus;
}

export interface OpenReleaseRequest {
  readonly releaseRef: ObjectRef;
  readonly destinations: readonly ReleaseDestinationPolicy[];
  /** Optional pre-frozen package identity; otherwise frozen on first attempt. */
  readonly frozenPackageRef?: ReleasePackageRef;
}

export interface StartAttemptRequest {
  readonly releaseRef: ObjectRef;
  readonly attemptRef: ObjectRef;
  readonly definition: PublicationAttemptDefinition;
  readonly correlationId?: string;
}

export interface RecordReceiptRequest {
  readonly releaseRef: ObjectRef;
  readonly submission: FormalReceiptSubmission;
  /** Content-addressed ref minted for the formal receipt fact. */
  readonly receiptRef: Common.ContentAddressedRef;
  readonly correlationId: string;
}

export interface ReleasePublicationRuntimeOptions {
  readonly ledger?: ReleaseReceiptLedger;
  readonly rawReceipts?: RawExternalReceiptRepository;
}

/**
 * Domain-service runtime for ReleasePublication publication facts.
 *
 * Status evaluation is intentionally minimal: RELEASED once every required
 * destination holds a formal receipt, PARTIALLY_RELEASED once some do, and
 * PUBLISHING otherwise. Failure/UNKNOWN transitions belong to the
 * `record_publication_failure` write path, which is not part of this slice.
 */
export class ReleasePublicationRuntime {
  private readonly ledger: ReleaseReceiptLedger;
  private readonly rawReceipts: RawExternalReceiptRepository;
  private readonly releases = new Map<string, ReleaseState>();

  constructor(options: ReleasePublicationRuntimeOptions = {}) {
    this.ledger = options.ledger ?? new InMemoryReleaseReceiptLedger();
    this.rawReceipts = options.rawReceipts ?? new InMemoryRawExternalReceiptRepository();
  }

  /** Seeds a RawExternalReceipt fact consumed by formal-receipt provenance checks. */
  seedRawExternalReceipt(fact: RawExternalReceiptFact): void {
    const store = this.rawReceipts;
    if (!(store instanceof InMemoryRawExternalReceiptRepository)) {
      throw new Error('seedRawExternalReceipt requires an InMemoryRawExternalReceiptRepository');
    }
    store.save(fact);
  }

  openReleaseForPublication(request: OpenReleaseRequest): void {
    const destinations = new Map<string, ReleaseDestinationPolicy>();
    for (const destination of request.destinations) {
      destinations.set(destination.destinationId, destination);
    }
    if (
      request.frozenPackageRef !== undefined &&
      !sameObjectRef(request.frozenPackageRef.releaseRef, request.releaseRef)
    ) {
      throw new Error('frozenPackageRef.releaseRef must equal the opened releaseRef');
    }
    this.releases.set(request.releaseRef.objectId, {
      releaseRef: request.releaseRef,
      destinations,
      receiptsByDestination: new Map(),
      frozenPackageRef: request.frozenPackageRef,
      status: 'AUTHORIZED',
    });
  }

  startPublicationAttempt(
    request: StartAttemptRequest,
  ): { readonly ok: true } | { readonly ok: false; readonly error: ApiError } {
    const correlationId = request.correlationId ?? '';
    const release = this.releases.get(request.releaseRef.objectId);
    if (release === undefined) {
      return { ok: false, error: unknownReleaseError(request.releaseRef, correlationId) };
    }
    if (!release.destinations.has(request.definition.destinationId)) {
      return {
        ok: false,
        error: buildApiRejection({
          code: RELEASE_RECEIPT_TARGET_MISMATCH,
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'publication attempt references a destination outside the release',
          fieldPath: '/payload/attempt/destinationId',
          violatedRule: 'attempt destination must belong to the release',
          correlationId,
          targetRef: request.attemptRef,
        }),
      };
    }

    // Bind the attempt package to this release before any ledger mutation.
    if (!sameObjectRef(request.definition.packageRef.releaseRef, request.releaseRef)) {
      return {
        ok: false,
        error: buildApiRejection({
          code: RELEASE_RECEIPT_TARGET_MISMATCH,
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'publication attempt package belongs to a different release',
          fieldPath: '/payload/attempt/packageRef/releaseRef',
          violatedRule: 'attempt.packageRef.releaseRef must equal the target release',
          correlationId,
          targetRef: request.attemptRef,
        }),
      };
    }

    if (release.frozenPackageRef !== undefined) {
      if (!samePackageRef(release.frozenPackageRef, request.definition.packageRef)) {
        return {
          ok: false,
          error: buildApiRejection({
            code: RELEASE_RECEIPT_TARGET_MISMATCH,
            category: 'VALIDATION',
            retryDisposition: 'DO_NOT_RETRY',
            safeMessage: 'publication attempt package does not match the frozen release package',
            fieldPath: '/payload/attempt/packageRef',
            violatedRule: 'all attempts for a release share one frozen ReleasePackageRef',
            correlationId,
            targetRef: request.attemptRef,
          }),
        };
      }
    }

    const registration = registerPublicationAttempt(this.ledger, {
      attemptRef: request.attemptRef,
      definition: request.definition,
      correlationId,
    });
    if (!registration.ok) {
      return registration;
    }
    release.frozenPackageRef ??= request.definition.packageRef;
    // Promote only AUTHORIZED → PUBLISHING. Later/idempotent starts must not
    // downgrade an earned PARTIALLY_RELEASED / RELEASED outcome.
    if (release.status === 'AUTHORIZED') {
      release.status = 'PUBLISHING';
    }
    return { ok: true };
  }

  recordPublicationReceipt(request: RecordReceiptRequest): ReceiptValidationResult {
    const release = this.releases.get(request.releaseRef.objectId);
    if (release === undefined) {
      return {
        ok: false,
        error: unknownReleaseError(request.releaseRef, request.correlationId),
      };
    }
    const destination = release.destinations.get(request.submission.destinationId);
    if (destination === undefined) {
      return {
        ok: false,
        error: buildApiRejection({
          code: RELEASE_RECEIPT_TARGET_MISMATCH,
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'receipt references a destination outside the release',
          fieldPath: '/payload/receipt/destinationId',
          violatedRule: 'receipt destination must belong to the release',
          correlationId: request.correlationId,
          targetRef: request.submission.attemptRef,
        }),
      };
    }

    if (!sameObjectRef(request.submission.packageRef.releaseRef, request.releaseRef)) {
      return {
        ok: false,
        error: buildApiRejection({
          code: RELEASE_RECEIPT_TARGET_MISMATCH,
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'receipt package belongs to a different release',
          fieldPath: '/payload/receipt/packageRef/releaseRef',
          violatedRule: 'receipt.packageRef.releaseRef must equal the target release',
          correlationId: request.correlationId,
          targetRef: request.submission.attemptRef,
        }),
      };
    }

    if (
      release.frozenPackageRef !== undefined &&
      !samePackageRef(release.frozenPackageRef, request.submission.packageRef)
    ) {
      return {
        ok: false,
        error: buildApiRejection({
          code: RELEASE_RECEIPT_TARGET_MISMATCH,
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'receipt package does not match the frozen release package',
          fieldPath: '/payload/receipt/packageRef',
          violatedRule: 'formal receipts must target the frozen ReleasePackageRef',
          correlationId: request.correlationId,
          targetRef: request.submission.attemptRef,
        }),
      };
    }

    // Validation and insert are a single ledger compare-and-save.
    const validation = recordFormalReceipt(this.ledger, this.rawReceipts, {
      submission: request.submission,
      receiptRef: request.receiptRef,
      deliveryTimeoutMs: destination.deliveryTimeoutMs,
      correlationId: request.correlationId,
    });
    if (!validation.ok) {
      // Rejected receipts never mutate release state: the original facts stay.
      return validation;
    }
    release.receiptsByDestination.set(
      request.submission.destinationId,
      validation.record.receiptRef,
    );
    release.status = evaluateCompletion(release);
    return validation;
  }

  getReleaseOutcome(releaseRef: ObjectRef): ReleasePublicationOutcomeView | undefined {
    const release = this.releases.get(releaseRef.objectId);
    if (release === undefined) {
      return undefined;
    }
    return {
      releaseRef: release.releaseRef,
      status: release.status,
      succeededDestinationIds: [...release.receiptsByDestination.keys()],
      pendingDestinationIds: [...release.destinations.keys()].filter(
        (destinationId) => !release.receiptsByDestination.has(destinationId),
      ),
      receiptRefs: [...release.receiptsByDestination.values()],
    };
  }

  /** Late window configured for a destination; exposed for timeline audits. */
  getDeliveryTimeoutMs(releaseRef: ObjectRef, destinationId: string): number | undefined {
    return this.releases.get(releaseRef.objectId)?.destinations.get(destinationId)
      ?.deliveryTimeoutMs;
  }
}

function evaluateCompletion(release: ReleaseState): ReleaseStatus {
  let requiredTotal = 0;
  let requiredSatisfied = 0;
  for (const destination of release.destinations.values()) {
    if (!destination.required) {
      continue;
    }
    requiredTotal += 1;
    if (release.receiptsByDestination.has(destination.destinationId)) {
      requiredSatisfied += 1;
    }
  }
  if (requiredTotal > 0 && requiredSatisfied === requiredTotal) {
    return 'RELEASED';
  }
  if (requiredSatisfied > 0) {
    return 'PARTIALLY_RELEASED';
  }
  return release.status === 'AUTHORIZED' ? 'AUTHORIZED' : 'PUBLISHING';
}

function unknownReleaseError(releaseRef: ObjectRef, correlationId = ''): ApiError {
  return buildApiRejection({
    code: RELEASE_RECEIPT_TARGET_MISMATCH,
    category: 'VALIDATION',
    retryDisposition: 'DO_NOT_RETRY',
    safeMessage: 'release is not open for publication',
    fieldPath: '/targetRef',
    violatedRule: 'release must be opened for publication first',
    correlationId,
    targetRef: releaseRef,
  });
}
