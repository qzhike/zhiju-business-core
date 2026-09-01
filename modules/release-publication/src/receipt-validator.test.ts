import { describe, expect, it } from 'vitest';

import type { CanonicalJson, Common, ReleasePublication } from '@zhiju/contracts';

import {
  InMemoryRawExternalReceiptRepository,
  InMemoryReleaseReceiptLedger,
  registerPublicationAttempt,
  recordFormalReceipt,
  RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT,
  RELEASE_RECEIPT_ALREADY_RECORDED,
  RELEASE_RECEIPT_STALE,
  RELEASE_RECEIPT_TARGET_MISMATCH,
  RAW_EXTERNAL_RECEIPT_OBJECT_TYPE,
  sameObjectRef,
  type FormalAdapterAttemptBinding,
  type FormalAdapterAttemptQueryPort,
  type PublicationAttemptRecord,
  type RawExternalReceiptFact,
  type ReceiptValidationResult,
  type ReleaseReceiptLedger,
} from './receipt-validator.js';
import {
  createProviderResultFromAdapter,
  providerResultContainsSensitiveData,
} from './provider-result.js';

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
const REDACTED_VALUE = { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' };

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
  readonly rawReceiptObjectId?: string;
  readonly rawReceiptObjectType?: string;
  readonly packageDigest?: string;
  readonly occurredAt?: string;
  readonly receiptPayloadDigest?: string;
  readonly rawObservedOutcome?: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
  readonly rawOccurredAt?: string | undefined;
  readonly rawRecordedAt?: string;
  readonly rawReceiptPayloadDigest?: string;
  readonly providerResult?: CanonicalJson;
}

function receiptSubmission(options: ReceiptOptions): ReleasePublication.FormalReceiptSubmission {
  return {
    attemptRef: objectRef('release.publication_attempt', options.attemptId),
    destinationId: options.destinationId,
    packageRef: packageRef(options.packageDigest ?? digest('ab')),
    rawReceiptRef: contentAddressedRef(
      options.rawReceiptObjectType ?? RAW_EXTERNAL_RECEIPT_OBJECT_TYPE,
      options.rawReceiptObjectId ?? options.attemptId,
      options.rawReceiptDigest,
    ),
    providerResult: options.providerResult ?? { messageId: `om_${options.attemptId}` },
    occurredAt: options.occurredAt ?? '2026-08-21T00:00:05Z',
    receiptPayloadHash: {
      algorithm: 'SHA-256',
      digest: options.receiptPayloadDigest ?? digest('dd'),
      canonicalizationVersion: '1',
    },
  };
}

function rawFact(options: ReceiptOptions): RawExternalReceiptFact {
  const packageDigest = options.packageDigest ?? digest('ab');
  return {
    rawReceiptRef: contentAddressedRef(
      RAW_EXTERNAL_RECEIPT_OBJECT_TYPE,
      options.rawReceiptObjectId ?? options.attemptId,
      options.rawReceiptDigest,
    ),
    releaseId: RELEASE_ID,
    destinationId: options.destinationId,
    packageHashDigest: packageDigest,
    publicationAttemptId: options.attemptId,
    externalDeliveryRequestRef: contentAddressedRef(
      'integration.external_delivery_request',
      options.attemptId,
      digest('ee'),
    ),
    adapterAttemptRef: objectRef('integration.adapter_attempt', options.attemptId),
    receiptPayloadHash: {
      algorithm: 'SHA-256',
      digest: options.rawReceiptPayloadDigest ?? options.receiptPayloadDigest ?? digest('dd'),
      canonicalizationVersion: '1',
    },
    observedOutcome: options.rawObservedOutcome ?? 'SUCCEEDED',
    ...(options.rawOccurredAt === undefined
      ? { occurredAt: options.occurredAt ?? '2026-08-21T00:00:05Z' }
      : { occurredAt: options.rawOccurredAt }),
    recordedAt: options.rawRecordedAt ?? '2026-08-21T00:00:06Z',
  };
}

const registeredAdapterAuthority: FormalAdapterAttemptQueryPort = {
  getFormalAdapterAttempt: (attemptRef) => ({
    attemptRef,
    adapterKind: 'FEISHU_CHANNEL',
    status: 'SUCCEEDED',
    externalDeliveryRequestRef: contentAddressedRef(
      'integration.external_delivery_request',
      attemptRef.objectId,
      digest('ee'),
    ),
  }),
};

function authorityForFact(
  fact: RawExternalReceiptFact,
  overrides: Partial<FormalAdapterAttemptBinding> = {},
): FormalAdapterAttemptQueryPort {
  return {
    getFormalAdapterAttempt: (attemptRef) =>
      sameObjectRef(attemptRef, fact.adapterAttemptRef)
        ? {
            attemptRef: fact.adapterAttemptRef,
            adapterKind: 'FEISHU_CHANNEL',
            status: 'SUCCEEDED',
            externalDeliveryRequestRef: fact.externalDeliveryRequestRef,
            ...overrides,
          }
        : undefined,
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

function record(
  ledger: ReleaseReceiptLedger,
  rawReceipts: InMemoryRawExternalReceiptRepository,
  options: ReceiptOptions,
): ReceiptValidationResult {
  rawReceipts.save(rawFact(options));
  return recordFormalReceipt(ledger, rawReceipts, {
    submission: receiptSubmission(options),
    receiptRef: contentAddressedRef('release.publication_receipt', options.attemptId, digest('ff')),
    deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
    correlationId: CORRELATION_ID,
    adapterAttempts: registeredAdapterAuthority,
  });
}

// =============================================================================
// RP-API-U-003 — Runtime duplicate / late receipt detection
// =============================================================================

describe('release-publication receipt validator (RP-API-U-003)', () => {
  it('RP-API-U-003a: rejects a same-stable-key receipt with a different packageHash and preserves the original fact', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-dest-a-attempt-001', digest('ab'));
    const first = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('cc'),
      packageDigest: digest('ab'),
    });
    expect(first.ok).toBe(true);

    // Same stable key (via the registered attempt), different packageHash.
    // Seed a raw fact that matches the conflicting submission so the failure
    // class is the idempotency conflict, not a missing raw observation.
    const conflicting = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('cd'),
      packageDigest: digest('ef'),
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
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-dest-a-attempt-001');
    const options = {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('cc'),
    };
    expect(record(ledger, rawReceipts, options).ok).toBe(true);

    const duplicate = record(ledger, rawReceipts, options);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.code).toBe(RELEASE_RECEIPT_ALREADY_RECORDED);
      expect(duplicate.error.category).toBe('CONFLICT');
    }
  });

  it('RP-API-U-003c: rejects a receipt whose occurredAt is beyond requestedAt + deliveryTimeout', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_B, DESTINATION_B, 'rel-801-dest-b-attempt-001');

    const late = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_B,
      destinationId: DESTINATION_B,
      rawReceiptDigest: digest('ce'),
      occurredAt: '2026-08-21T00:01:30Z',
    });
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
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_B, DESTINATION_B, 'rel-801-dest-b-attempt-001');
    const atEdge = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_B,
      destinationId: DESTINATION_B,
      rawReceiptDigest: digest('cf'),
      occurredAt: '2026-08-21T00:01:00Z',
    });
    expect(atEdge.ok).toBe(true);
  });

  it('RP-API-U-003d: rejects receipts referencing an unknown attempt or mismatched target fields', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-dest-a-attempt-001');

    const unknownAttempt = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_B,
      destinationId: DESTINATION_B,
      rawReceiptDigest: digest('c1'),
    });
    expect(unknownAttempt.ok).toBe(false);
    if (!unknownAttempt.ok) {
      expect(unknownAttempt.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
    }

    const wrongDestination = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_B,
      rawReceiptDigest: digest('c2'),
    });
    expect(wrongDestination.ok).toBe(false);
    if (!wrongDestination.ok) {
      expect(wrongDestination.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
    }

    const wrongPackage = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('c3'),
      packageDigest: digest('ef'),
    });
    expect(wrongPackage.ok).toBe(false);
    if (!wrongPackage.ok) {
      expect(wrongPackage.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
    }
  });

  it('RP-API-U-003e: accepts a legitimate early receipt as a formal publication fact', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    const attempt = registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-dest-a-attempt-001');
    const accepted = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('cc'),
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.record.receiptRef.objectType).toBe('release.publication_receipt');
      expect(accepted.record.submission.occurredAt).toBe('2026-08-21T00:00:05Z');
    }
    expect(ledger.findAttempt(ATTEMPT_A)).toEqual(attempt);

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

  it('RP-ISSUE23-U-001: rejects name-like values in allowlisted fields before Formal Receipt persistence', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-dest-a-attempt-001');

    const accepted = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('c8'),
      providerResult: {
        messageId: 'AliceCustomer',
        providerStatus: 'AliceCustomer',
        reasonCode: 'BobBuyer',
        status: 'CustomerName',
        customRecipientData: [{ email: 'customer@example.com', body: 'document body' }],
      },
    });

    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.record.submission.providerResult).toEqual({
        providerStatus: REDACTED_VALUE,
        reasonCode: REDACTED_VALUE,
        status: REDACTED_VALUE,
      });
      const serialized = JSON.stringify(accepted.record.submission.providerResult);
      expect(serialized).not.toContain('AliceCustomer');
      expect(serialized).not.toContain('BobBuyer');
      expect(serialized).not.toContain('CustomerName');
      expect(serialized).not.toContain('customer@example.com');
      expect(serialized).not.toContain('document body');
    }
  });

  it('RP-ISSUE23-U-003: persists deterministic closed Adapter output with identifiers omitted', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-dest-a-attempt-001');
    const mapped = createProviderResultFromAdapter({
      adapterCode: 'feishu.channel',
      messageId: 'AliceCustomer',
      providerRequestId: 'request-801',
      providerStatus: 'delivered',
      status: 'delivered',
      outcome: 'success',
      errorCode: 'rate_limited',
      reasonCode: 'delivery_rejected',
      attemptNumber: 1,
      retryable: false,
    });
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error(`Adapter mapping failed: ${mapped.error.code}`);

    const accepted = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('c9'),
      providerResult: mapped.value,
    });

    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.record.submission.providerResult).toEqual(mapped.value);
      expect(accepted.record.submission.providerResult).not.toHaveProperty('messageIdHash');
      expect(accepted.record.submission.providerResult).not.toHaveProperty('providerRequestIdHash');
      expect(JSON.stringify(accepted.record.submission.providerResult)).not.toContain(
        'AliceCustomer',
      );
      expect(providerResultContainsSensitiveData(accepted.record.submission.providerResult)).toBe(
        false,
      );
    }
  });

  it('RP-ISSUE23-U-005: keeps sensitive provider input out of rejected ApiError diagnostics', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-dest-a-attempt-001');

    const rejected = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('ca'),
      rawObservedOutcome: 'FAILED',
      providerResult: {
        messageId: 'AliceCustomer',
        providerStatus: 'AliceCustomer',
        reasonCode: 'BobBuyer',
        status: 'CustomerName',
        customRecipientData: [{ email: 'customer@example.com', body: 'document body' }],
      },
    });

    expect(rejected.ok).toBe(false);
    const serialized = JSON.stringify(rejected);
    expect(serialized).not.toContain('AliceCustomer');
    expect(serialized).not.toContain('BobBuyer');
    expect(serialized).not.toContain('CustomerName');
    expect(serialized).not.toContain('customer@example.com');
    expect(serialized).not.toContain('document body');
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
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
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
      record(ledger, rawReceipts, {
        attemptId: ATTEMPT_A,
        destinationId: DESTINATION_A,
        rawReceiptDigest: digest('cc'),
      }).ok,
    ).toBe(true);
    // A second formal receipt under the same stable key never lands.
    const second = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_B,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('cd'),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe(RELEASE_RECEIPT_ALREADY_RECORDED);
    }
    expect(ledger.findAttemptsByStableKey('rel-801-retry-key')).toHaveLength(2);
    expect(ledger.findReceiptByRawReceiptDigest(digest('cd'))).toBeUndefined();
  });

  it('RP-API-C-002: rejects a rawReceiptRef that is not a loaded RawExternalReceipt fact', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-dest-a-attempt-001');

    // Wrong object type and no fact seeded — must not mint a formal receipt.
    const wrongType = recordFormalReceipt(ledger, rawReceipts, {
      submission: receiptSubmission({
        attemptId: ATTEMPT_A,
        destinationId: DESTINATION_A,
        rawReceiptDigest: digest('cc'),
        rawReceiptObjectType: 'artifact.revision',
        rawReceiptObjectId: '018f22e2-7c15-7b2e-8d86-2de956a9d999',
      }),
      receiptRef: contentAddressedRef('release.publication_receipt', ATTEMPT_A, digest('ff')),
      deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
      correlationId: CORRELATION_ID,
      adapterAttempts: registeredAdapterAuthority,
    });
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) {
      expect(wrongType.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
      expect(wrongType.error.fieldViolations[0]?.fieldPath).toBe(
        '/payload/receipt/rawReceiptRef/objectType',
      );
    }
    expect(ledger.findReceiptByStableKey('rel-801-dest-a-attempt-001')).toBeUndefined();

    // Correct type but missing fact.
    const missingFact = recordFormalReceipt(ledger, rawReceipts, {
      submission: receiptSubmission({
        attemptId: ATTEMPT_A,
        destinationId: DESTINATION_A,
        rawReceiptDigest: digest('cc'),
      }),
      receiptRef: contentAddressedRef('release.publication_receipt', ATTEMPT_A, digest('ff')),
      deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
      correlationId: CORRELATION_ID,
      adapterAttempts: registeredAdapterAuthority,
    });
    expect(missingFact.ok).toBe(false);
    if (!missingFact.ok) {
      expect(missingFact.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
      expect(missingFact.error.fieldViolations[0]?.fieldPath).toBe(
        '/payload/receipt/rawReceiptRef',
      );
    }
  });

  it('RP-API-C-002: rejects loaded RawExternalReceipt facts with mismatched provenance fields', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-dest-a-attempt-001');

    const cases: readonly {
      readonly label: string;
      readonly mutate: (fact: RawExternalReceiptFact) => RawExternalReceiptFact;
    }[] = [
      {
        label: 'releaseId',
        mutate: (fact) => ({ ...fact, releaseId: '018f22e2-7c15-7b2e-8d86-2de956a9d899' }),
      },
      {
        label: 'destinationId',
        mutate: (fact) => ({ ...fact, destinationId: DESTINATION_B }),
      },
      {
        label: 'packageHashDigest',
        mutate: (fact) => ({ ...fact, packageHashDigest: digest('ef') }),
      },
      {
        label: 'publicationAttemptId',
        mutate: (fact) => ({ ...fact, publicationAttemptId: ATTEMPT_B }),
      },
      {
        label: 'rawReceiptRef scope',
        mutate: (fact) => ({
          ...fact,
          rawReceiptRef: {
            ...fact.rawReceiptRef,
            scope: {
              enterpriseId: ENTERPRISE_ID,
              projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d299',
            },
          },
        }),
      },
      {
        label: 'adapterAttemptRef scope',
        mutate: (fact) => ({
          ...fact,
          adapterAttemptRef: {
            ...fact.adapterAttemptRef,
            scope: {
              enterpriseId: ENTERPRISE_ID,
              projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d299',
            },
          },
        }),
      },
      {
        label: 'adapterAttemptRef objectType',
        mutate: (fact) => ({
          ...fact,
          adapterAttemptRef: {
            ...fact.adapterAttemptRef,
            objectType: 'integration.external_delivery_request',
          },
        }),
      },
      {
        label: 'externalDeliveryRequestRef',
        mutate: (fact) => ({
          ...fact,
          externalDeliveryRequestRef: {
            ...fact.externalDeliveryRequestRef,
            objectId: ATTEMPT_B,
          },
        }),
      },
    ];

    for (const [index, probe] of cases.entries()) {
      const options = {
        attemptId: ATTEMPT_A,
        destinationId: DESTINATION_A,
        rawReceiptDigest: digest(`c${String(index)}`),
        rawReceiptObjectId: `018f22e2-7c15-7b2e-8d86-2de956a9d85${String(index)}`,
      };
      rawReceipts.save(probe.mutate(rawFact(options)));
      const rejected = recordFormalReceipt(ledger, rawReceipts, {
        submission: receiptSubmission(options),
        receiptRef: contentAddressedRef(
          'release.publication_receipt',
          options.rawReceiptObjectId,
          digest('ff'),
        ),
        deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
        correlationId: CORRELATION_ID,
        adapterAttempts: registeredAdapterAuthority,
      });
      expect(rejected.ok, probe.label).toBe(false);
      if (!rejected.ok) {
        expect(rejected.error.code, probe.label).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
        expect(rejected.error.fieldViolations[0]?.fieldPath, probe.label).toBe(
          '/payload/receipt/rawReceiptRef',
        );
      }
    }
    expect(ledger.findReceiptByStableKey('rel-801-dest-a-attempt-001')).toBeUndefined();
  });

  it('RP-API-C-006: rejects an unregistered Adapter Attempt ID even when the Raw Receipt is self-consistent', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-formal-binding-key');
    const options = {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('d1'),
    };
    const registeredFact = rawFact(options);
    const forgedFact: RawExternalReceiptFact = {
      ...registeredFact,
      adapterAttemptRef: {
        ...registeredFact.adapterAttemptRef,
        objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d899',
      },
    };
    rawReceipts.save(forgedFact);

    const result = recordFormalReceipt(ledger, rawReceipts, {
      submission: receiptSubmission(options),
      receiptRef: contentAddressedRef(
        'release.publication_receipt',
        '018f22e2-7c15-7b2e-8d86-2de956a9d89a',
        digest('d2'),
      ),
      deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
      correlationId: CORRELATION_ID,
      adapterAttempts: authorityForFact(registeredFact),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
    }
    expect(ledger.findReceiptByStableKey('rel-801-formal-binding-key')).toBeUndefined();
  });

  it.each([
    [
      'missing registered Adapter Attempt',
      { getFormalAdapterAttempt: () => undefined } satisfies FormalAdapterAttemptQueryPort,
      'd3',
    ],
    [
      'non-successful registered Adapter Attempt',
      authorityForFact(
        rawFact({
          attemptId: ATTEMPT_A,
          destinationId: DESTINATION_A,
          rawReceiptDigest: digest('d4'),
        }),
        { status: 'FAILED' },
      ),
      'd4',
    ],
  ])('RP-API-C-006: rejects %s before minting a Formal Receipt', (_label, authority, byte) => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, `rel-801-binding-${_label}`);
    const options = {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest(byte),
    };
    rawReceipts.save(rawFact(options));

    const result = recordFormalReceipt(ledger, rawReceipts, {
      submission: receiptSubmission(options),
      receiptRef: contentAddressedRef('release.publication_receipt', ATTEMPT_A, digest('d5')),
      deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
      correlationId: CORRELATION_ID,
      adapterAttempts: authority,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
    expect(ledger.findReceiptByRawReceiptDigest(options.rawReceiptDigest)).toBeUndefined();
  });

  it('compareAndSaveReceipt rejects a second insert for the same stable key without a separate validate step', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-dest-a-attempt-001');
    const options = {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('cc'),
    };
    expect(record(ledger, rawReceipts, options).ok).toBe(true);

    // Competing submission with a different raw digest under the same key:
    // compare-and-save must lose atomically (ALREADY_RECORDED).
    const competing = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('cd'),
      rawReceiptObjectId: '018f22e2-7c15-7b2e-8d86-2de956a9d851',
    });
    expect(competing.ok).toBe(false);
    if (!competing.ok) {
      expect(competing.error.code).toBe(RELEASE_RECEIPT_ALREADY_RECORDED);
    }
    expect(ledger.findReceiptByRawReceiptDigest(digest('cd'))).toBeUndefined();
    expect(
      ledger.findReceiptByStableKey('rel-801-dest-a-attempt-001')?.submission.rawReceiptRef
        .contentHash.digest,
    ).toBe(digest('cc'));
  });

  it('compareAndSaveAttempt atomically rejects a stable key rebound to a different package', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const first = registerPublicationAttempt(ledger, {
      attemptRef: objectRef('release.publication_attempt', ATTEMPT_A),
      definition: attemptDefinition({
        attemptId: ATTEMPT_A,
        destinationId: DESTINATION_A,
        stableKey: 'rel-801-atomic-attempt-key',
        packageDigest: digest('ab'),
      }),
      correlationId: CORRELATION_ID,
    });
    expect(first.ok).toBe(true);

    const conflicting = registerPublicationAttempt(ledger, {
      attemptRef: objectRef('release.publication_attempt', ATTEMPT_B),
      definition: attemptDefinition({
        attemptId: ATTEMPT_B,
        destinationId: DESTINATION_A,
        stableKey: 'rel-801-atomic-attempt-key',
        packageDigest: digest('ef'),
      }),
      correlationId: CORRELATION_ID,
    });
    expect(conflicting.ok).toBe(false);
    if (!conflicting.ok) {
      expect(conflicting.error.code).toBe(RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT);
    }
    expect(ledger.findAttempt(ATTEMPT_B)).toBeUndefined();
    expect(ledger.findAttemptsByStableKey('rel-801-atomic-attempt-key')).toHaveLength(1);
  });

  it('RP-API-C-002: rejects FAILED or UNKNOWN raw observations as formal success receipts', () => {
    for (const observedOutcome of ['FAILED', 'UNKNOWN'] as const) {
      const ledger = new InMemoryReleaseReceiptLedger();
      const rawReceipts = new InMemoryRawExternalReceiptRepository();
      registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-outcome-key');
      const result = record(ledger, rawReceipts, {
        attemptId: ATTEMPT_A,
        destinationId: DESTINATION_A,
        rawReceiptDigest: observedOutcome === 'FAILED' ? digest('c5') : digest('c6'),
        rawObservedOutcome: observedOutcome,
      });
      expect(result.ok, observedOutcome).toBe(false);
      if (!result.ok) {
        expect(result.error.code, observedOutcome).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
      }
      expect(ledger.findReceiptByStableKey('rel-801-outcome-key')).toBeUndefined();
    }
  });

  it('RP-API-C-002: rejects a formal receipt whose payload hash differs from the raw fact', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-payload-key');
    const result = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('c7'),
      receiptPayloadDigest: digest('dd'),
      rawReceiptPayloadDigest: digest('de'),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
    }
    expect(ledger.findReceiptByStableKey('rel-801-payload-key')).toBeUndefined();
  });

  it('RP-API-C-002: rejects a caller that rewrites the raw authoritative occurrence time', () => {
    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-time-key');
    const result = record(ledger, rawReceipts, {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('c8'),
      occurredAt: '2026-08-21T00:00:05Z',
      rawOccurredAt: '2026-08-21T00:01:30Z',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
    }
    expect(ledger.findReceiptByStableKey('rel-801-time-key')).toBeUndefined();
  });

  it('RP-API-C-002: rejects attempt and receipt refs with the wrong object type or scope', () => {
    const wrongAttemptType = registerPublicationAttempt(new InMemoryReleaseReceiptLedger(), {
      attemptRef: objectRef('artifact.revision', ATTEMPT_A),
      definition: attemptDefinition({
        attemptId: ATTEMPT_A,
        destinationId: DESTINATION_A,
        stableKey: 'rel-801-ref-key',
      }),
      correlationId: CORRELATION_ID,
    });
    expect(wrongAttemptType.ok).toBe(false);
    if (!wrongAttemptType.ok) {
      expect(wrongAttemptType.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
    }

    const ledger = new InMemoryReleaseReceiptLedger();
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    registerAttempt(ledger, ATTEMPT_A, DESTINATION_A, 'rel-801-ref-key');
    const options = {
      attemptId: ATTEMPT_A,
      destinationId: DESTINATION_A,
      rawReceiptDigest: digest('c9'),
    };
    rawReceipts.save(rawFact(options));
    const validSubmission = receiptSubmission(options);
    const wrongScope = recordFormalReceipt(ledger, rawReceipts, {
      submission: {
        ...validSubmission,
        attemptRef: {
          ...validSubmission.attemptRef,
          scope: {
            enterpriseId: ENTERPRISE_ID,
            projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d299',
          },
        },
      },
      receiptRef: contentAddressedRef('release.publication_receipt', ATTEMPT_A, digest('ff')),
      deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
      correlationId: CORRELATION_ID,
      adapterAttempts: registeredAdapterAuthority,
    });
    expect(wrongScope.ok).toBe(false);
    if (!wrongScope.ok) {
      expect(wrongScope.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
      expect(wrongScope.error.fieldViolations[0]?.fieldPath).toBe('/payload/receipt/attemptRef');
    }

    const wrongReceiptType = recordFormalReceipt(ledger, rawReceipts, {
      submission: validSubmission,
      receiptRef: contentAddressedRef('artifact.revision', ATTEMPT_A, digest('ff')),
      deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
      correlationId: CORRELATION_ID,
      adapterAttempts: registeredAdapterAuthority,
    });
    expect(wrongReceiptType.ok).toBe(false);
    if (!wrongReceiptType.ok) {
      expect(wrongReceiptType.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
      expect(wrongReceiptType.error.fieldViolations[0]?.fieldPath).toBe('/receiptRef/objectType');
    }

    const wrongReceiptScope = recordFormalReceipt(ledger, rawReceipts, {
      submission: validSubmission,
      receiptRef: {
        ...contentAddressedRef('release.publication_receipt', ATTEMPT_A, digest('ff')),
        scope: {
          enterpriseId: ENTERPRISE_ID,
          projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d299',
        },
      },
      deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
      correlationId: CORRELATION_ID,
      adapterAttempts: registeredAdapterAuthority,
    });
    expect(wrongReceiptScope.ok).toBe(false);
    if (!wrongReceiptScope.ok) {
      expect(wrongReceiptScope.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
      expect(wrongReceiptScope.error.fieldViolations[0]?.fieldPath).toBe('/receiptRef/scope');
    }
    expect(ledger.findReceiptByStableKey('rel-801-ref-key')).toBeUndefined();
  });
});
