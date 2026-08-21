import { describe, expect, it } from 'vitest';

import type { Common, ReleasePublication } from '@zhiju/contracts';

import {
  InMemoryReleaseReceiptLedger,
  registerPublicationAttempt,
  validateFormalReceipt,
  RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT,
  RELEASE_RECEIPT_ALREADY_RECORDED,
  RELEASE_RECEIPT_STALE,
  RELEASE_RECEIPT_TARGET_MISMATCH,
  type PublicationAttemptRecord,
  type ReceiptValidationResult,
  type ReleaseReceiptLedger,
} from './receipt-validator.js';

// =============================================================================
// Deterministic builders (schema-shaped; structural validity is owned by the
// contract schema layer, so these focus on the cross-fact runtime rules)
// =============================================================================

const ENTERPRISE_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const RELEASE_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d801';
const PACKAGE_OBJECT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d830';
const PACKAGE_SNAPSHOT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d831';
const REQUESTED_AT = '2026-08-21T00:00:00Z';
const DELIVERY_TIMEOUT_MS = 60_000;
const CORRELATION_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d870';

function digest(prefix: string): string {
  return (prefix + '0'.repeat(64)).slice(0, 64);
}

function scope(): Common.ScopeRef {
  return { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID };
}

function objectRef(objectType: string, objectId: string): Common.ObjectRef {
  return { kind: 'OBJECT', objectType, objectId, scope: scope() };
}

function contentAddressedRef(
  objectType: string,
  objectId: string,
  contentDigest: string,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    scope: scope(),
    contentHash: { algorithm: 'SHA-256', digest: contentDigest, canonicalizationVersion: '1' },
  };
}

function packageRef(packageDigest: string): Common.ReleasePackageRef {
  return {
    releaseRef: objectRef('release.release', RELEASE_ID),
    packageSnapshotRef: {
      kind: 'SNAPSHOT',
      objectType: 'release.release_package',
      objectId: PACKAGE_OBJECT_ID,
      snapshotId: PACKAGE_SNAPSHOT_ID,
      scope: scope(),
      contentHash: {
        algorithm: 'SHA-256',
        digest: digest('aa'),
        canonicalizationVersion: '1',
      },
    },
    packageHash: { algorithm: 'SHA-256', digest: packageDigest, canonicalizationVersion: '1' },
  };
}

interface AttemptOptions {
  readonly attemptId: string;
  readonly destinationId: string;
  readonly stableKey: string;
  readonly packageDigest?: string | undefined;
  readonly requestedAt?: string | undefined;
}

function attemptDefinition(
  options: AttemptOptions,
): ReleasePublication.PublicationAttemptDefinition {
  return {
    destinationId: options.destinationId,
    packageRef: packageRef(options.packageDigest ?? digest('ab')),
    attemptNumber: 1,
    stableIdempotencyKey: options.stableKey,
    requestedAt: options.requestedAt ?? REQUESTED_AT,
    externalDeliveryRequestRef: contentAddressedRef(
      'integration.external_delivery_request',
      options.attemptId,
      digest('ee'),
    ),
  };
}

interface ReceiptOptions {
  readonly attemptId: string;
  readonly destinationId: string;
  readonly rawReceiptDigest: string;
  readonly packageDigest?: string;
  readonly occurredAt?: string;
}

function receiptSubmission(options: ReceiptOptions): ReleasePublication.FormalReceiptSubmission {
  return {
    attemptRef: objectRef('release.publication_attempt', options.attemptId),
    destinationId: options.destinationId,
    packageRef: packageRef(options.packageDigest ?? digest('ab')),
    rawReceiptRef: contentAddressedRef(
      'integration.raw_external_receipt',
      options.attemptId,
      options.rawReceiptDigest,
    ),
    providerResult: { messageId: `om_${options.attemptId}` },
    occurredAt: options.occurredAt ?? '2026-08-21T00:00:05Z',
    receiptPayloadHash: {
      algorithm: 'SHA-256',
      digest: digest('dd'),
      canonicalizationVersion: '1',
    },
  };
}

const DESTINATION_A = '018f22e2-7c15-7b2e-8d86-2de956a9d810';
const DESTINATION_B = '018f22e2-7c15-7b2e-8d86-2de956a9d811';
const ATTEMPT_A = '018f22e2-7c15-7b2e-8d86-2de956a9d820';
const ATTEMPT_B = '018f22e2-7c15-7b2e-8d86-2de956a9d821';

function registerAttempt(
  ledger: ReleaseReceiptLedger,
  attemptId: string,
  destinationId: string,
  stableKey: string,
  packageDigest?: string,
): PublicationAttemptRecord {
  const attemptRef = objectRef('release.publication_attempt', attemptId);
  const result = registerPublicationAttempt(ledger, {
    attemptRef,
    definition: attemptDefinition({ attemptId, destinationId, stableKey, packageDigest }),
    correlationId: CORRELATION_ID,
  });
  if (!result.ok) {
    throw new Error(`fixture registration failed: ${result.error.code}`);
  }
  return result.record;
}

function validateAndSave(
  ledger: ReleaseReceiptLedger,
  submission: ReleasePublication.FormalReceiptSubmission,
): ReceiptValidationResult {
  const result = validateFormalReceipt(ledger, {
    submission,
    receiptRef: contentAddressedRef(
      'release.publication_receipt',
      submission.attemptRef.objectId,
      digest('ff'),
    ),
    deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
    correlationId: CORRELATION_ID,
  });
  if (result.ok) {
    ledger.saveReceipt(result.record);
  }
  return result;
}

// =============================================================================
// RP-API-U-003 — Runtime duplicate / late receipt detection
// =============================================================================

describe('release-publication receipt validator (RP-API-U-003)', () => {
  it('RP-API-U-003a: rejects a same-stable-key receipt with a different packageHash and preserves the original fact', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-dest-a-attempt-001', digest('ab'));
    const first = validateAndSave(
      ledger,
      receiptSubmission({
        attemptId: ATTEMPT_A,
        destinationId: DESTINATION_A,
        rawReceiptDigest: digest('cc'),
        packageDigest: digest('ab'),
      }),
    );
    expect(first.ok).toBe(true);

    // Same stable key (via the registered attempt), different packageHash.
    const conflicting = validateFormalReceipt(ledger, {
      submission: receiptSubmission({
        attemptId: ATTEMPT_A,
        destinationId: DESTINATION_A,
        rawReceiptDigest: digest('cd'),
        packageDigest: digest('ef'),
      }),
      receiptRef: contentAddressedRef('release.publication_receipt', ATTEMPT_B, digest('fe')),
      deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
      correlationId: CORRELATION_ID,
    });
    expect(conflicting.ok).toBe(false);
    if (!conflicting.ok) {
      expect(conflicting.error.code).toBe(RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT);
      expect(conflicting.error.category).toBe('CONFLICT');
      expect(conflicting.error.retryDisposition).toBe('RELOAD_AND_REEVALUATE');
      expect(conflicting.error.fieldViolations[0]?.fieldPath).toBe(
        '/payload/receipt/packageRef/packageHash',
      );
    }

    // The original receipt fact is untouched (no overwrite).
    const preserved = ledger.findReceiptByStableKey('rel-801-dest-a-attempt-001');
    expect(preserved?.submission.rawReceiptRef.contentHash.digest).toBe(digest('cc'));
    expect(ledger.findReceiptByRawReceiptDigest(digest('cd'))).toBeUndefined();
  });

  it('RP-API-U-003b: rejects a duplicate submission of the same rawReceiptRef', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-dest-a-attempt-001');
    const submission = receiptSubmission({
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('cc'),
    });
    expect(validateAndSave(ledger, submission).ok).toBe(true);

    const duplicate = validateAndSave(ledger, submission);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.code).toBe(RELEASE_RECEIPT_ALREADY_RECORDED);
      expect(duplicate.error.category).toBe('CONFLICT');
    }
  });

  it('RP-API-U-003c: rejects a receipt whose occurredAt is beyond requestedAt + deliveryTimeout', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    registerAttempt(ledger, ATTEMPT_B, DESTINATION_B, 'rel-801-dest-b-attempt-001');

    const late = validateAndSave(
      ledger,
      receiptSubmission({
        attemptId: ATTEMPT_B,
        destinationId: DESTINATION_B,
        rawReceiptDigest: digest('ce'),
        occurredAt: '2026-08-21T00:01:30Z',
      }),
    );
    expect(late.ok).toBe(false);
    if (!late.ok) {
      expect(late.error.code).toBe(RELEASE_RECEIPT_STALE);
      expect(late.error.category).toBe('LIFECYCLE');
      expect(late.error.retryDisposition).toBe('NEW_COMMAND_REQUIRED');
      expect(late.error.fieldViolations[0]?.fieldPath).toBe('/payload/receipt/occurredAt');
    }
    expect(ledger.findReceiptByStableKey('rel-801-dest-b-attempt-001')).toBeUndefined();
  });

  it('RP-API-U-003c boundary: accepts a receipt exactly at the delivery timeout window edge', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    registerAttempt(ledger, ATTEMPT_B, DESTINATION_B, 'rel-801-dest-b-attempt-001');
    const atEdge = validateAndSave(
      ledger,
      receiptSubmission({
        attemptId: ATTEMPT_B,
        destinationId: DESTINATION_B,
        rawReceiptDigest: digest('cf'),
        occurredAt: '2026-08-21T00:01:00Z',
      }),
    );
    expect(atEdge.ok).toBe(true);
  });

  it('RP-API-U-003d: rejects receipts referencing an unknown attempt or mismatched target fields', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-dest-a-attempt-001');

    const unknownAttempt = validateAndSave(
      ledger,
      receiptSubmission({
        attemptId: ATTEMPT_B,
        destinationId: DESTINATION_B,
        rawReceiptDigest: digest('c1'),
      }),
    );
    expect(unknownAttempt.ok).toBe(false);
    if (!unknownAttempt.ok) {
      expect(unknownAttempt.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
    }

    const wrongDestination = validateAndSave(
      ledger,
      receiptSubmission({
        attemptId: ATTEMPT_A,
        destinationId: DESTINATION_B,
        rawReceiptDigest: digest('c2'),
      }),
    );
    expect(wrongDestination.ok).toBe(false);
    if (!wrongDestination.ok) {
      expect(wrongDestination.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
    }

    const wrongPackage = validateAndSave(
      ledger,
      receiptSubmission({
        attemptId: ATTEMPT_A,
        destinationId: DESTINATION_A,
        rawReceiptDigest: digest('c3'),
        packageDigest: digest('ef'),
      }),
    );
    expect(wrongPackage.ok).toBe(false);
    if (!wrongPackage.ok) {
      expect(wrongPackage.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
    }
  });

  it('RP-API-U-003e: accepts a legitimate early receipt as a formal publication fact', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const record = registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-dest-a-attempt-001');
    const accepted = validateAndSave(
      ledger,
      receiptSubmission({
        attemptId: ATTEMPT_A,
        destinationId: DESTINATION_A,
        rawReceiptDigest: digest('cc'),
      }),
    );
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.record.receiptRef.objectType).toBe('release.publication_receipt');
      expect(accepted.record.submission.occurredAt).toBe('2026-08-21T00:00:05Z');
    }
    expect(ledger.findAttempt(ATTEMPT_A)).toEqual(record);

    // Idempotent re-registration of the identical attempt is a no-op success.
    const reregistration = registerPublicationAttempt(ledger, {
      attemptRef: objectRef('release.publication_attempt', ATTEMPT_A),
      definition: attemptDefinition({
        attemptId: ATTEMPT_A,
        destinationId: DESTINATION_A,
        stableKey: 'rel-801-dest-a-attempt-001',
      }),
      correlationId: CORRELATION_ID,
    });
    expect(reregistration.ok).toBe(true);
  });

  it('rejects attempt registration that rebinds a stable key to another destination or packageHash', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-shared-key', digest('ab'));

    const reboundPackage = registerPublicationAttempt(ledger, {
      attemptRef: objectRef('release.publication_attempt', ATTEMPT_B),
      definition: attemptDefinition({
        attemptId: ATTEMPT_B,
        destinationId: DESTINATION_A,
        stableKey: 'rel-801-shared-key',
        packageDigest: digest('ef'),
      }),
      correlationId: CORRELATION_ID,
    });
    expect(reboundPackage.ok).toBe(false);
    if (!reboundPackage.ok) {
      expect(reboundPackage.error.code).toBe(RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT);
    }

    const reboundDestination = registerPublicationAttempt(ledger, {
      attemptRef: objectRef('release.publication_attempt', ATTEMPT_B),
      definition: attemptDefinition({
        attemptId: ATTEMPT_B,
        destinationId: DESTINATION_B,
        stableKey: 'rel-801-shared-key',
      }),
      correlationId: CORRELATION_ID,
    });
    expect(reboundDestination.ok).toBe(false);
    if (!reboundDestination.ok) {
      expect(reboundDestination.error.code).toBe(RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT);
    }
  });

  it('keeps retry attempts sharing one stable key registrable while only one receipt wins', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-retry-key', digest('ab'));
    // Retry of the same destination/package legitimately shares the key.
    const retry = registerPublicationAttempt(ledger, {
      attemptRef: objectRef('release.publication_attempt', ATTEMPT_B),
      definition: {
        ...attemptDefinition({
          attemptId: ATTEMPT_B,
          destinationId: DESTINATION_A,
          stableKey: 'rel-801-retry-key',
          packageDigest: digest('ab'),
        }),
        attemptNumber: 2,
      },
      correlationId: CORRELATION_ID,
    });
    expect(retry.ok).toBe(true);

    expect(
      validateAndSave(
        ledger,
        receiptSubmission({
          attemptId: ATTEMPT_A,
          destinationId: DESTINATION_A,
          rawReceiptDigest: digest('cc'),
        }),
      ).ok,
    ).toBe(true);
    // A second formal receipt under the same stable key never lands.
    const second = validateAndSave(
      ledger,
      receiptSubmission({
        attemptId: ATTEMPT_B,
        destinationId: DESTINATION_A,
        rawReceiptDigest: digest('cd'),
      }),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe(RELEASE_RECEIPT_ALREADY_RECORDED);
    }
    expect(ledger.findAttemptsByStableKey('rel-801-retry-key')).toHaveLength(2);
    expect(ledger.findReceiptByRawReceiptDigest(digest('cd'))).toBeUndefined();
  });
});
