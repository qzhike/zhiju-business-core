// ReleasePublication Runtime write path for publication attempts and formal
// receipts (Issue #15 / IM-RP-001).
//
// This is a domain-service level orchestrator: it owns the release-level
// destination outcomes and delegates fact-level validation to the Receipt
// Validator. The persistence-backed Handler/Repository path is implemented
// separately; this runtime remains the controlled in-memory adapter seam.
// IntegrationGateway provider injection is tracked by Issue #27 and is NOT
// claimed by this slice.

import { canonicalize, newUuidV7, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import { createHash } from 'node:crypto';
import type { ApiError } from '@zhiju/shared-kernel';
import type { CanonicalJson, Common, ReleasePublication } from '@zhiju/contracts';

import {
  InMemoryRawExternalReceiptRepository,
  InMemoryReleaseReceiptLedger,
  registerPublicationAttempt,
  recordFormalReceipt,
  buildApiRejection,
  sameObjectRef,
  samePackageRef,
  sameScopeRef,
  PUBLICATION_ATTEMPT_OBJECT_TYPE,
  RELEASE_RECEIPT_TARGET_MISMATCH,
  type ReceiptValidationResult,
  type RawExternalReceiptFact,
  type RawExternalReceiptRepository,
  type ReleaseReceiptLedger,
} from './receipt-validator.js';
import {
  RELEASE_AUTHORIZATION_INVALID,
  RELEASE_AUTHORIZATION_DECISION_MISMATCH,
  RELEASE_READINESS_INVALID,
  validateHumanAuthorizationChain,
  validateReleaseAuthorization,
  type ReleaseAuthorizationValidationInput,
  type ReleaseHumanAuthorizationChainInput,
} from './release-publication-authorization.js';

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
  readonly failedDestinationIds?: readonly string[];
  readonly unknownDestinationIds?: readonly string[];
  readonly recallRef?: Common.ContentAddressedRef;
}

export interface ReleasePublicationOutboxEvent {
  readonly eventId: string;
  readonly eventType:
    | 'release.ReleaseAuthorized'
    | 'release.PublicationAttemptRequested'
    | 'release.PublicationSucceeded'
    | 'release.PublicationFailed'
    | 'release.ReleasePartiallyCompleted'
    | 'release.ReleaseCompleted'
    | 'release.ReleaseRecalled';
  readonly releaseRef: ObjectRef;
  readonly payload: CanonicalJson;
  readonly recordedAt: string;
}

export interface AuthorizeReleaseRequest {
  readonly validation: ReleaseAuthorizationValidationInput;
  readonly destinations: readonly ReleaseDestinationPolicy[];
  /** Optional stable fact identity supplied by the command/persistence adapter. */
  readonly authorizationRef?: Common.ContentAddressedRef;
}

export interface ReleaseAuthorizationRuntimeResult {
  readonly ok: true;
  readonly releaseRef: ObjectRef;
  readonly releaseReadinessSnapshotRef: Common.SnapshotRef;
  readonly authorizationRef: Common.ContentAddressedRef;
}

export interface RecordFailureRequest {
  readonly releaseRef: ObjectRef;
  readonly failure: ReleasePublication.PublicationFailureSubmission;
  readonly failureRef: Common.ContentAddressedRef;
  readonly correlationId: string;
}

export type PublicationFailureRuntimeResult =
  | {
      readonly ok: true;
      readonly failureRef: Common.ContentAddressedRef;
      readonly outcome: ReleasePublication.PublicationFailureOutcome;
    }
  | { readonly ok: false; readonly error: ApiError };

export interface CompleteReleaseRequest {
  readonly releaseRef: ObjectRef;
  readonly completionPolicyRef: Common.VersionedRef;
  readonly destinationOutcomeRefs: readonly Common.TypedReference[];
  readonly evaluatedAt: string;
  readonly correlationId: string;
}

export interface CompleteReleaseResult {
  readonly ok: true;
  readonly status: ReleaseStatus;
  readonly succeededDestinationIds: readonly string[];
  readonly pendingOrFailedDestinationIds: readonly string[];
}

export interface RecallReleaseRequest extends ReleaseHumanAuthorizationChainInput {
  readonly packageRef: ReleasePackageRef;
  readonly recallRef: Common.ContentAddressedRef;
  readonly affectedDestinationIds: readonly string[];
  readonly recalledAt: string;
}

export type PublicationAdapterResult =
  | { readonly outcome: 'SUCCEEDED'; readonly receipt: RecordReceiptRequest }
  | { readonly outcome: 'FAILED' | 'UNKNOWN'; readonly failure: RecordFailureRequest };

export type PublicationDispatchResult =
  | { readonly status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'; readonly invoked: boolean }
  | {
      readonly status: 'RECONCILIATION_REQUIRED';
      readonly invoked: false;
      readonly attemptRef: ObjectRef;
    }
  | { readonly status: 'REJECTED'; readonly invoked: boolean; readonly error: ApiError };

export type RecallReleaseResult =
  | { readonly ok: true; readonly recallRef: Common.ContentAddressedRef }
  | { readonly ok: false; readonly error: ApiError };

export interface AttemptRuntimeState {
  readonly definition: PublicationAttemptDefinition;
  outcome: ReleasePublication.PublicationOutcome;
  rawReceiptRef?: Common.ContentAddressedRef;
  formalReceiptRef?: Common.ContentAddressedRef;
  failureRef?: Common.ContentAddressedRef;
  retryableFailure?: boolean;
  dispatchInFlight: boolean;
}

interface ReleaseState {
  readonly releaseRef: ObjectRef;
  readonly destinations: ReadonlyMap<string, ReleaseDestinationPolicy>;
  readonly receiptsByDestination: Map<string, Common.ContentAddressedRef>;
  readonly attemptsById: Map<string, AttemptRuntimeState>;
  readonly failuresByAttemptId: Map<string, Common.ContentAddressedRef>;
  readonly outboxEvents: ReleasePublicationOutboxEvent[];
  /** Frozen on the first accepted publication attempt for this release. */
  frozenPackageRef: ReleasePackageRef | undefined;
  purpose?: ReleasePublication.ReleasePurpose;
  revisionRef?: Common.ContentAddressedRef;
  releaseReadinessSnapshotRef?: Common.SnapshotRef;
  authorizationRef?: Common.ContentAddressedRef;
  recallRef?: Common.ContentAddressedRef;
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
 * PUBLISHING otherwise. Failure/UNKNOWN transitions are recorded through the
 * `recordPublicationFailure` path and retain the prior Attempt history.
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
    if (request.releaseRef.objectType !== 'release.release') {
      throw new Error('releaseRef must address a release.release object');
    }
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
    this.releases.set(objectRefKey(request.releaseRef), {
      releaseRef: request.releaseRef,
      destinations,
      receiptsByDestination: new Map(),
      attemptsById: new Map(),
      failuresByAttemptId: new Map(),
      outboxEvents: [],
      frozenPackageRef: request.frozenPackageRef,
      status: 'AUTHORIZED',
    });
  }

  /**
   * Runs the last Release Readiness and Human Authorization recheck. The
   * method is intentionally separate from the legacy fixture opener above:
   * only this path can establish a trusted authorization reference for a
   * prepared Release.
   */
  async authorizeRelease(
    request: AuthorizeReleaseRequest,
  ): Promise<ReleaseAuthorizationRuntimeResult | { readonly ok: false; readonly error: ApiError }> {
    try {
      const validated = await validateReleaseAuthorization(request.validation);
      const key = objectRefKey(request.validation.releaseRef);
      let release = this.releases.get(key);
      if (release === undefined) {
        const destinations = new Map<string, ReleaseDestinationPolicy>();
        for (const destination of request.destinations) {
          destinations.set(destination.destinationId, destination);
        }
        if (
          destinations.size !== validated.packageDefinition.destinations.length ||
          validated.packageDefinition.destinations.some(
            (destination) => !destinations.has(destination.destinationId),
          )
        ) {
          throw new Error('authorization destinations must equal the frozen Package destinations');
        }
        release = {
          releaseRef: request.validation.releaseRef,
          destinations,
          receiptsByDestination: new Map(),
          attemptsById: new Map(),
          failuresByAttemptId: new Map(),
          outboxEvents: [],
          frozenPackageRef: request.validation.packageRef,
          purpose: request.validation.draftDefinition.purpose,
          revisionRef: request.validation.draftDefinition.revisionRef,
          status: 'PREPARED',
        };
        this.releases.set(key, release);
      } else if (
        release.frozenPackageRef !== undefined &&
        !samePackageRef(release.frozenPackageRef, request.validation.packageRef)
      ) {
        throw new Error('authorization package does not match the frozen Package');
      }
      release.frozenPackageRef = request.validation.packageRef;
      release.purpose = request.validation.draftDefinition.purpose;
      release.revisionRef = request.validation.draftDefinition.revisionRef;
      release.releaseReadinessSnapshotRef = request.validation.releaseReadinessSnapshotRef;
      const authorizationRef =
        request.authorizationRef ?? runtimeAuthorizationRef(request.validation);
      release.authorizationRef = authorizationRef;
      release.status = 'AUTHORIZED';
      appendOutbox(release, {
        eventType: 'release.ReleaseAuthorized',
        releaseRef: release.releaseRef,
        payload: {
          releaseRef: release.releaseRef,
          packageRef: request.validation.packageRef,
          releaseReadinessSnapshotRef: request.validation.releaseReadinessSnapshotRef,
          authorizationRef,
          authorizedAt: request.validation.now.toISOString(),
        },
      });
      return {
        ok: true,
        releaseRef: release.releaseRef,
        releaseReadinessSnapshotRef: request.validation.releaseReadinessSnapshotRef,
        authorizationRef,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Release authorization was rejected';
      const code =
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : RELEASE_AUTHORIZATION_INVALID;
      return {
        ok: false,
        error: buildApiRejection({
          code,
          category: 'AUTHORIZATION',
          retryDisposition: 'RELOAD_AND_REEVALUATE',
          safeMessage: message,
          fieldPath: '/payload',
          violatedRule:
            'Release authorization must use exact current authority and trusted Human facts',
          correlationId: request.validation.context.correlationId,
          targetRef: request.validation.releaseRef,
        }),
      };
    }
  }

  startPublicationAttempt(
    request: StartAttemptRequest,
  ): { readonly ok: true } | { readonly ok: false; readonly error: ApiError } {
    const correlationId = request.correlationId ?? '';
    const release = this.releases.get(objectRefKey(request.releaseRef));
    if (release === undefined) {
      return { ok: false, error: unknownReleaseError(request.releaseRef, correlationId) };
    }
    if (publicationClosed(release.status)) {
      return {
        ok: false,
        error: closedReleaseError(request.releaseRef, correlationId),
      };
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

    if (!sameScopeRef(request.attemptRef.scope, request.releaseRef.scope)) {
      return {
        ok: false,
        error: buildApiRejection({
          code: RELEASE_RECEIPT_TARGET_MISMATCH,
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'publication attempt scope does not match the target release',
          fieldPath: '/payload/attemptRef/scope',
          violatedRule: 'publication attempts must share the release scope',
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
    if (registration.inserted) {
      release.attemptsById.set(request.attemptRef.objectId, {
        definition: registration.record.definition,
        outcome: 'PENDING',
        dispatchInFlight: false,
      });
      appendOutbox(release, {
        eventType: 'release.PublicationAttemptRequested',
        releaseRef: release.releaseRef,
        payload: {
          releaseRef: release.releaseRef,
          packageRef: request.definition.packageRef,
          attemptRef: request.attemptRef,
          destinationId: request.definition.destinationId,
          externalDeliveryRequestRef: request.definition.externalDeliveryRequestRef,
        },
      });
    }
    // Promote only AUTHORIZED → PUBLISHING. Later/idempotent starts must not
    // downgrade an earned PARTIALLY_RELEASED / RELEASED outcome.
    if (release.status === 'AUTHORIZED') {
      release.status = 'PUBLISHING';
    }
    return { ok: true };
  }

  recordPublicationReceipt(request: RecordReceiptRequest): ReceiptValidationResult {
    const release = this.releases.get(objectRefKey(request.releaseRef));
    if (release === undefined) {
      return {
        ok: false,
        error: unknownReleaseError(request.releaseRef, request.correlationId),
      };
    }
    if (publicationClosed(release.status)) {
      return { ok: false, error: closedReleaseError(request.releaseRef, request.correlationId) };
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
    const attempt = release.attemptsById.get(request.submission.attemptRef.objectId);
    if (attempt !== undefined) {
      attempt.outcome = 'SUCCEEDED';
      attempt.rawReceiptRef = request.submission.rawReceiptRef;
      attempt.formalReceiptRef = validation.record.receiptRef;
      delete attempt.failureRef;
    }
    appendOutbox(release, {
      eventType: 'release.PublicationSucceeded',
      releaseRef: release.releaseRef,
      payload: {
        releaseRef: release.releaseRef,
        packageRef: request.submission.packageRef,
        attemptRef: request.submission.attemptRef,
        destinationId: request.submission.destinationId,
        receiptRef: validation.record.receiptRef,
        occurredAt: request.submission.occurredAt,
      },
    });
    release.status = evaluateCompletion(release);
    return validation;
  }

  recordPublicationFailure(request: RecordFailureRequest): PublicationFailureRuntimeResult {
    const release = this.releases.get(objectRefKey(request.releaseRef));
    if (release === undefined) {
      return { ok: false, error: unknownReleaseError(request.releaseRef, request.correlationId) };
    }
    if (publicationClosed(release.status)) {
      return { ok: false, error: closedReleaseError(request.releaseRef, request.correlationId) };
    }
    const attempt = release.attemptsById.get(request.failure.attemptRef.objectId);
    const registered = this.ledger.findAttempt(request.failure.attemptRef.objectId);
    if (
      attempt === undefined ||
      registered === undefined ||
      !sameObjectRef(registered.attemptRef, request.failure.attemptRef) ||
      registered.definition.destinationId !== request.failure.destinationId ||
      !samePackageRef(registered.definition.packageRef, request.failure.packageRef)
    ) {
      return {
        ok: false,
        error: buildApiRejection({
          code: RELEASE_RECEIPT_TARGET_MISMATCH,
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'publication failure does not match a registered Attempt',
          fieldPath: '/payload/failure',
          violatedRule: 'failure must target the exact registered Attempt and Package',
          correlationId: request.correlationId,
          targetRef: request.failure.attemptRef,
        }),
      };
    }
    if (request.failureRef.objectType !== 'release.publication_failure') {
      return {
        ok: false,
        error: buildApiRejection({
          code: RELEASE_RECEIPT_TARGET_MISMATCH,
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'failureRef must address a release.publication_failure fact',
          fieldPath: '/failureRef/objectType',
          violatedRule: 'failure facts require the registered failure object type',
          correlationId: request.correlationId,
          targetRef: request.failure.attemptRef,
        }),
      };
    }
    if (!sameScopeRef(request.failureRef.scope, request.releaseRef.scope)) {
      return {
        ok: false,
        error: buildApiRejection({
          code: RELEASE_RECEIPT_TARGET_MISMATCH,
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'failureRef scope does not match the Release scope',
          fieldPath: '/failureRef/scope',
          violatedRule: 'failure facts must share the Release scope',
          correlationId: request.correlationId,
          targetRef: request.failure.attemptRef,
        }),
      };
    }
    const existingFailure = release.failuresByAttemptId.get(request.failure.attemptRef.objectId);
    if (existingFailure !== undefined) {
      return sameContentAddressedRef(existingFailure, request.failureRef)
        ? { ok: true, failureRef: existingFailure, outcome: request.failure.outcome }
        : {
            ok: false,
            error: buildApiRejection({
              code: RELEASE_AUTHORIZATION_DECISION_MISMATCH,
              category: 'CONFLICT',
              retryDisposition: 'RELOAD_AND_REEVALUATE',
              safeMessage: 'publication failure already recorded for this Attempt',
              fieldPath: '/payload/failure',
              violatedRule: 'Attempt failure facts are immutable',
              correlationId: request.correlationId,
              targetRef: request.failure.attemptRef,
            }),
          };
    }
    if (attempt.outcome === 'SUCCEEDED') {
      return {
        ok: false,
        error: buildApiRejection({
          code: RELEASE_RECEIPT_TARGET_MISMATCH,
          category: 'CONFLICT',
          retryDisposition: 'RELOAD_AND_REEVALUATE',
          safeMessage: 'a successful Formal Receipt already exists for this Attempt',
          fieldPath: '/payload/failure/attemptRef',
          violatedRule: 'a successful Attempt cannot be overwritten by a Failure',
          correlationId: request.correlationId,
          targetRef: request.failure.attemptRef,
        }),
      };
    }
    attempt.outcome = request.failure.outcome;
    attempt.failureRef = request.failureRef;
    attempt.retryableFailure = request.failure.retryable;
    release.failuresByAttemptId.set(request.failure.attemptRef.objectId, request.failureRef);
    appendOutbox(release, {
      eventType: 'release.PublicationFailed',
      releaseRef: release.releaseRef,
      payload: {
        releaseRef: release.releaseRef,
        packageRef: request.failure.packageRef,
        attemptRef: request.failure.attemptRef,
        destinationId: request.failure.destinationId,
        outcome: request.failure.outcome,
        failureRef: request.failureRef,
      },
    });
    release.status = evaluateCompletion(release);
    return { ok: true, failureRef: request.failureRef, outcome: request.failure.outcome };
  }

  completeRelease(
    request: CompleteReleaseRequest,
  ): CompleteReleaseResult | { readonly ok: false; readonly error: ApiError } {
    const release = this.releases.get(objectRefKey(request.releaseRef));
    if (release === undefined) {
      return { ok: false, error: unknownReleaseError(request.releaseRef, request.correlationId) };
    }
    if (immutableRelease(release.status)) {
      return { ok: false, error: closedReleaseError(request.releaseRef, request.correlationId) };
    }
    if (request.destinationOutcomeRefs.length === 0) {
      return {
        ok: false,
        error: buildApiRejection({
          code: RELEASE_READINESS_INVALID,
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'completion requires destination outcome references',
          fieldPath: '/payload/destinationOutcomeRefs',
          violatedRule: 'completion evidence must identify destination outcomes',
          correlationId: request.correlationId,
          targetRef: request.releaseRef,
        }),
      };
    }
    release.status = evaluateCompletion(release);
    const succeededDestinationIds = [...release.receiptsByDestination.keys()];
    const pendingOrFailedDestinationIds = [...release.destinations.keys()].filter(
      (destinationId) => !release.receiptsByDestination.has(destinationId),
    );
    if (
      release.frozenPackageRef === undefined ||
      release.purpose === undefined ||
      release.revisionRef === undefined
    ) {
      return {
        ok: false,
        error: buildApiRejection({
          code: RELEASE_READINESS_INVALID,
          category: 'INTEGRITY',
          retryDisposition: 'RELOAD_AND_REEVALUATE',
          safeMessage: 'completion requires a fully bound frozen Package',
          fieldPath: '/payload',
          violatedRule: 'Release completion must retain exact Package purpose and Revision refs',
          correlationId: request.correlationId,
          targetRef: request.releaseRef,
        }),
      };
    }
    if (release.status === 'RELEASED') {
      appendOutbox(release, {
        eventType: 'release.ReleaseCompleted',
        releaseRef: release.releaseRef,
        payload: {
          releaseRef: release.releaseRef,
          packageRef: release.frozenPackageRef,
          purpose: release.purpose,
          revisionRef: release.revisionRef,
          receiptRefs: [...release.receiptsByDestination.values()],
          completedAt: request.evaluatedAt,
        },
      });
    } else if (succeededDestinationIds.length > 0) {
      appendOutbox(release, {
        eventType: 'release.ReleasePartiallyCompleted',
        releaseRef: release.releaseRef,
        payload: {
          releaseRef: release.releaseRef,
          packageRef: release.frozenPackageRef,
          succeededDestinationIds,
          pendingOrFailedDestinationIds,
          evaluatedAt: request.evaluatedAt,
        },
      });
    }
    return {
      ok: true,
      status: release.status,
      succeededDestinationIds,
      pendingOrFailedDestinationIds,
    };
  }

  async recallRelease(request: RecallReleaseRequest): Promise<RecallReleaseResult> {
    const release = this.releases.get(objectRefKey(request.releaseRef));
    if (release === undefined) {
      return {
        ok: false,
        error: unknownReleaseError(request.releaseRef, request.context.correlationId),
      };
    }
    if (immutableRelease(release.status)) {
      return {
        ok: false,
        error: closedReleaseError(request.releaseRef, request.context.correlationId),
      };
    }
    if (
      release.frozenPackageRef === undefined ||
      !samePackageRef(release.frozenPackageRef, request.packageRef)
    ) {
      return {
        ok: false,
        error: buildApiRejection({
          code: RELEASE_READINESS_INVALID,
          category: 'VALIDATION',
          retryDisposition: 'RELOAD_AND_REEVALUATE',
          safeMessage: 'Recall package does not match the frozen Release Package',
          fieldPath: '/payload/packageRef',
          violatedRule: 'Recall must target the exact frozen Package',
          correlationId: request.context.correlationId,
          targetRef: request.releaseRef,
        }),
      };
    }
    try {
      await validateHumanAuthorizationChain({
        ...request,
        expectedCommandType: 'release.recall_release',
        expectedCommandVersion: '1.0',
        expectedPurpose: 'release.publication.recall_release',
      });
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error && typeof error.code === 'string'
          ? error.code
          : RELEASE_AUTHORIZATION_INVALID;
      return {
        ok: false,
        error: buildApiRejection({
          code,
          category: 'AUTHORIZATION',
          retryDisposition: 'RELOAD_AND_REEVALUATE',
          safeMessage: error instanceof Error ? error.message : 'Recall authorization was rejected',
          fieldPath: '/payload',
          violatedRule: 'Recall requires an exact trusted Human authorization chain',
          correlationId: request.context.correlationId,
          targetRef: request.releaseRef,
        }),
      };
    }
    const affected = [...new Set(request.affectedDestinationIds)];
    if (
      affected.length === 0 ||
      affected.some((destinationId) => !release.destinations.has(destinationId))
    ) {
      return {
        ok: false,
        error: buildApiRejection({
          code: RELEASE_READINESS_INVALID,
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'Recall affected destinations must belong to the Release',
          fieldPath: '/payload/affectedDestinationIds',
          violatedRule: 'Recall must identify one or more exact Release destinations',
          correlationId: request.context.correlationId,
          targetRef: request.releaseRef,
        }),
      };
    }
    release.recallRef = request.recallRef;
    release.status = 'RECALLED';
    appendOutbox(release, {
      eventType: 'release.ReleaseRecalled',
      releaseRef: release.releaseRef,
      payload: {
        releaseRef: release.releaseRef,
        packageRef: request.packageRef,
        recallRef: request.recallRef,
        affectedDestinationIds: affected,
        recalledAt: request.recalledAt,
      },
    });
    return { ok: true, recallRef: request.recallRef };
  }

  getPublicationAttempts(releaseRef: ObjectRef): readonly AttemptRuntimeState[] {
    return [...(this.releases.get(objectRefKey(releaseRef))?.attemptsById.values() ?? [])].map(
      (attempt) => ({ ...attempt }),
    );
  }

  getOutboxEvents(releaseRef: ObjectRef): readonly ReleasePublicationOutboxEvent[] {
    return [...(this.releases.get(objectRefKey(releaseRef))?.outboxEvents ?? [])];
  }

  /**
   * Executes one committed Attempt through an injected Adapter. A persisted
   * UNKNOWN Attempt is never sent again by this method; callers must first
   * reconcile the authoritative Attempt/Raw Receipt.
   */
  async dispatchPublicationAttempt(
    releaseRef: ObjectRef,
    attemptRef: ObjectRef,
    invoke: () => Promise<PublicationAdapterResult>,
  ): Promise<PublicationDispatchResult> {
    const release = this.releases.get(objectRefKey(releaseRef));
    const attempt = release?.attemptsById.get(attemptRef.objectId);
    if (release === undefined || attempt === undefined) {
      return {
        status: 'REJECTED',
        invoked: false,
        error: unknownReleaseError(releaseRef, ''),
      };
    }
    const registeredAttemptRef: ObjectRef = {
      kind: 'OBJECT',
      objectType: PUBLICATION_ATTEMPT_OBJECT_TYPE,
      objectId: attemptRef.objectId,
      scope: releaseRef.scope,
    };
    if (!sameObjectRef(registeredAttemptRef, attemptRef)) {
      return {
        status: 'REJECTED',
        invoked: false,
        error: buildApiRejection({
          code: RELEASE_RECEIPT_TARGET_MISMATCH,
          category: 'VALIDATION',
          retryDisposition: 'DO_NOT_RETRY',
          safeMessage: 'dispatch must target the exact registered publication Attempt',
          fieldPath: '/attemptRef',
          violatedRule: 'Adapter dispatch requires the Attempt object type, ID and scope to match',
          correlationId: '',
          targetRef: attemptRef,
        }),
      };
    }
    if (publicationClosed(release.status)) {
      return {
        status: 'REJECTED',
        invoked: false,
        error: closedReleaseError(attemptRef, ''),
      };
    }
    if (attempt.outcome === 'UNKNOWN') {
      return { status: 'RECONCILIATION_REQUIRED', invoked: false, attemptRef };
    }
    if (
      attempt.outcome === 'SUCCEEDED' ||
      (attempt.outcome === 'FAILED' && !attempt.retryableFailure)
    ) {
      return { status: attempt.outcome, invoked: false };
    }
    if (attempt.dispatchInFlight) {
      return { status: 'RECONCILIATION_REQUIRED', invoked: false, attemptRef };
    }
    attempt.dispatchInFlight = true;
    try {
      const result = await invoke();
      if (result.outcome === 'SUCCEEDED') {
        const receipt = this.recordPublicationReceipt(result.receipt);
        return receipt.ok
          ? { status: 'SUCCEEDED', invoked: true }
          : { status: 'REJECTED', invoked: true, error: receipt.error };
      }
      const failure = this.recordPublicationFailure(result.failure);
      return failure.ok
        ? { status: result.outcome, invoked: true }
        : { status: 'REJECTED', invoked: true, error: failure.error };
    } finally {
      attempt.dispatchInFlight = false;
    }
  }

  /** Applies an already authoritative reconciliation result without invoking a Provider. */
  reconcilePublicationAttempt(result: PublicationAdapterResult): PublicationDispatchResult {
    if (result.outcome === 'SUCCEEDED') {
      const recorded = this.recordPublicationReceipt(result.receipt);
      return recorded.ok
        ? { status: 'SUCCEEDED', invoked: false }
        : { status: 'REJECTED', invoked: false, error: recorded.error };
    }
    const recorded = this.recordPublicationFailure(result.failure);
    return recorded.ok
      ? { status: result.outcome, invoked: false }
      : { status: 'REJECTED', invoked: false, error: recorded.error };
  }

  getReleaseOutcome(releaseRef: ObjectRef): ReleasePublicationOutcomeView | undefined {
    const release = this.releases.get(objectRefKey(releaseRef));
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
      failedDestinationIds: [...release.attemptsById.values()]
        .filter((attempt) => attempt.outcome === 'FAILED')
        .map((attempt) => attempt.definition.destinationId),
      unknownDestinationIds: [...release.attemptsById.values()]
        .filter((attempt) => attempt.outcome === 'UNKNOWN')
        .map((attempt) => attempt.definition.destinationId),
      ...(release.recallRef === undefined ? {} : { recallRef: release.recallRef }),
    };
  }

  /** Late window configured for a destination; exposed for timeline audits. */
  getDeliveryTimeoutMs(releaseRef: ObjectRef, destinationId: string): number | undefined {
    return this.releases.get(objectRefKey(releaseRef))?.destinations.get(destinationId)
      ?.deliveryTimeoutMs;
  }
}

function objectRefKey(ref: ObjectRef): string {
  return [
    ref.objectType,
    ref.objectId,
    ref.scope.enterpriseId ?? '',
    ref.scope.projectId ?? '',
  ].join('\u0000');
}

function immutableRelease(status: ReleaseStatus): boolean {
  return status === 'CANCELLED' || status === 'RECALLED' || status === 'SUPERSEDED';
}

function publicationClosed(status: ReleaseStatus): boolean {
  return immutableRelease(status) || status === 'RELEASED';
}

function closedReleaseError(targetRef: ObjectRef, correlationId: string): ApiError {
  return buildApiRejection({
    code: RELEASE_RECEIPT_TARGET_MISMATCH,
    category: 'LIFECYCLE',
    retryDisposition: 'NEW_COMMAND_REQUIRED',
    safeMessage: 'publication cannot mutate or dispatch for a closed Release',
    fieldPath: '/targetRef',
    violatedRule: 'closed Release history is immutable and has no further publication side effects',
    correlationId,
    targetRef,
  });
}

function evaluateCompletion(release: ReleaseState): ReleaseStatus {
  let requiredTotal = 0;
  let requiredSatisfied = 0;
  let requiredTerminalFailures = 0;
  for (const destination of release.destinations.values()) {
    if (!destination.required) {
      continue;
    }
    requiredTotal += 1;
    if (release.receiptsByDestination.has(destination.destinationId)) {
      requiredSatisfied += 1;
    } else {
      const attempts = [...release.attemptsById.values()].filter(
        (attempt) => attempt.definition.destinationId === destination.destinationId,
      );
      const hasPendingAttempt = attempts.some((attempt) => attempt.outcome === 'PENDING');
      if (
        !hasPendingAttempt &&
        attempts.some((attempt) => attempt.outcome === 'FAILED' || attempt.outcome === 'UNKNOWN')
      ) {
        requiredTerminalFailures += 1;
      }
    }
  }
  if (requiredTotal > 0 && requiredSatisfied === requiredTotal) {
    return 'RELEASED';
  }
  if (requiredSatisfied > 0) {
    return 'PARTIALLY_RELEASED';
  }
  if (requiredTotal > 0 && requiredTerminalFailures === requiredTotal) {
    return 'FAILED';
  }
  return release.status === 'AUTHORIZED' ? 'AUTHORIZED' : 'PUBLISHING';
}

function runtimeAuthorizationRef(
  validation: ReleaseAuthorizationValidationInput,
): Common.ContentAddressedRef {
  const payload = {
    releaseRef: validation.releaseRef,
    packageRef: validation.packageRef,
    releaseReadinessSnapshotRef: validation.releaseReadinessSnapshotRef,
    authorizingHumanRef: validation.authorizingHumanRef,
    actorSnapshotRef: validation.actorSnapshotRef,
    authorizationDecisionRef: validation.authorizationDecisionRef,
    authorizedAt: validation.now.toISOString(),
  } as unknown as CanonicalJsonValue;
  const digest = createHash('sha256').update(canonicalize(payload), 'utf8').digest('hex');
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'release.release_authorization',
    objectId: validation.authorizationDecisionRef.objectId,
    scope: validation.releaseRef.scope,
    contentHash: {
      algorithm: 'SHA-256',
      digest,
      canonicalizationVersion: '1',
    },
  };
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
    left.contentHash.digest === right.contentHash.digest
  );
}

function appendOutbox(
  release: ReleaseState,
  input: {
    readonly eventType: ReleasePublicationOutboxEvent['eventType'];
    readonly releaseRef: ObjectRef;
    readonly payload: unknown;
  },
): void {
  release.outboxEvents.push({
    eventId: newUuidV7(),
    eventType: input.eventType,
    releaseRef: input.releaseRef,
    payload: input.payload as CanonicalJson,
    recordedAt: new Date().toISOString(),
  });
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
