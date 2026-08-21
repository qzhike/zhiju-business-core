// ReleasePublication Runtime write path for publication attempts and formal
// receipts (Issue #15 / IM-RP-001).
//
// This is a domain-service level orchestrator: it owns the release-level
// destination outcomes and delegates fact-level validation to the Receipt
// Validator. It intentionally does not handle command envelopes, HTTP
// transport or persistence beyond the ReleaseReceiptLedger abstraction —
// those layers remain future work (see Module-Spec-006 §9).

import type { ApiError } from '@zhiju/shared-kernel';
import type { Common, ReleasePublication } from '@zhiju/contracts';

import {
  InMemoryReleaseReceiptLedger,
  registerPublicationAttempt,
  validateFormalReceipt,
  buildApiRejection,
  RELEASE_RECEIPT_TARGET_MISMATCH,
  type ReceiptValidationResult,
  type ReleaseReceiptLedger,
} from './receipt-validator.js';

type ObjectRef = Common.ObjectRef;

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
  status: ReleaseStatus;
}

export interface OpenReleaseRequest {
  readonly releaseRef: ObjectRef;
  readonly destinations: readonly ReleaseDestinationPolicy[];
}

export interface StartAttemptRequest {
  readonly releaseRef: ObjectRef;
  readonly attemptRef: ObjectRef;
  readonly definition: PublicationAttemptDefinition;
}

export interface RecordReceiptRequest {
  readonly releaseRef: ObjectRef;
  readonly submission: FormalReceiptSubmission;
  /** Content-addressed ref minted for the formal receipt fact. */
  readonly receiptRef: Common.ContentAddressedRef;
  readonly correlationId: string;
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
  private readonly releases = new Map<string, ReleaseState>();

  constructor(ledger: ReleaseReceiptLedger = new InMemoryReleaseReceiptLedger()) {
    this.ledger = ledger;
  }

  openReleaseForPublication(request: OpenReleaseRequest): void {
    const destinations = new Map<string, ReleaseDestinationPolicy>();
    for (const destination of request.destinations) {
      destinations.set(destination.destinationId, destination);
    }
    this.releases.set(request.releaseRef.objectId, {
      releaseRef: request.releaseRef,
      destinations,
      receiptsByDestination: new Map(),
      status: 'AUTHORIZED',
    });
  }

  startPublicationAttempt(
    request: StartAttemptRequest,
  ): { readonly ok: true } | { readonly ok: false; readonly error: ApiError } {
    const release = this.releases.get(request.releaseRef.objectId);
    if (release === undefined) {
      return { ok: false, error: unknownReleaseError(request.releaseRef) };
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
          correlationId: '',
          targetRef: request.attemptRef,
        }),
      };
    }
    const registration = registerPublicationAttempt(this.ledger, {
      attemptRef: request.attemptRef,
      definition: request.definition,
      correlationId: '',
    });
    if (!registration.ok) {
      return registration;
    }
    release.status = 'PUBLISHING';
    return { ok: true };
  }

  recordPublicationReceipt(request: RecordReceiptRequest): ReceiptValidationResult {
    const release = this.releases.get(request.releaseRef.objectId);
    if (release === undefined) {
      return { ok: false, error: unknownReleaseError(request.releaseRef) };
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
    const validation = validateFormalReceipt(this.ledger, {
      submission: request.submission,
      receiptRef: request.receiptRef,
      deliveryTimeoutMs: destination.deliveryTimeoutMs,
      correlationId: request.correlationId,
    });
    if (!validation.ok) {
      // Rejected receipts never mutate release state: the original facts stay.
      return validation;
    }
    this.ledger.saveReceipt(validation.record);
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

function unknownReleaseError(releaseRef: ObjectRef): ApiError {
  return buildApiRejection({
    code: RELEASE_RECEIPT_TARGET_MISMATCH,
    category: 'VALIDATION',
    retryDisposition: 'DO_NOT_RETRY',
    safeMessage: 'release is not open for publication',
    fieldPath: '/targetRef',
    violatedRule: 'release must be opened for publication first',
    correlationId: '',
    targetRef: releaseRef,
  });
}
