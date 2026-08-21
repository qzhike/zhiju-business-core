import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Common, ReleasePublication } from '@zhiju/contracts';

import {
  ReleasePublicationRuntime,
  type ReleaseDestinationPolicy,
} from './release-publication-runtime.js';
import {
  RELEASE_RECEIPT_STALE,
  RELEASE_RECEIPT_TARGET_MISMATCH,
  type RawExternalReceiptFact,
} from './receipt-validator.js';

// =============================================================================
// REL-801 late-receipt timeline fixture (RP-API-E-003 / RP-API-M-001)
// =============================================================================

interface TimelineExpectation {
  readonly outcome: string;
  readonly note?: string;
}

interface TimelineEntry {
  readonly step: number;
  readonly action: 'start_publication_attempt' | 'record_publication_receipt';
  readonly attemptRef?: Common.ObjectRef;
  readonly definition?: ReleasePublication.PublicationAttemptDefinition;
  readonly submission?: ReleasePublication.FormalReceiptSubmission | 'duplicate-of-step-3';
  readonly receiptRef?: Common.ContentAddressedRef | 'duplicate-of-step-3';
  readonly expect: TimelineExpectation;
}

interface TimelineFixture {
  readonly fixtureId: string;
  readonly policy: { readonly deliveryTimeoutMs: number };
  readonly rawExternalReceipts: readonly RawExternalReceiptFact[];
  readonly release: {
    readonly releaseRef: Common.ObjectRef;
    readonly destinations: readonly ReleaseDestinationPolicy[];
  };
  readonly timeline: readonly TimelineEntry[];
  readonly expectedFinalState: {
    readonly status: string;
    readonly succeededDestinationIds: readonly string[];
    readonly pendingDestinationIds: readonly string[];
    readonly recordedReceiptCount: number;
  };
}

function loadFixture(): TimelineFixture {
  const url = new URL(
    '../../../tests/fixtures/runtime/rel-801-late-receipt-timeline.json',
    import.meta.url,
  );
  return JSON.parse(readFileSync(url, 'utf8')) as TimelineFixture;
}

function openRuntime(fixture: TimelineFixture): ReleasePublicationRuntime {
  const runtime = new ReleasePublicationRuntime();
  runtime.openReleaseForPublication({
    releaseRef: fixture.release.releaseRef,
    destinations: fixture.release.destinations,
  });
  for (const fact of fixture.rawExternalReceipts) {
    runtime.seedRawExternalReceipt(fact);
  }
  return runtime;
}

// Fixture guards: a malformed timeline must fail loudly instead of silently
// skipping a step, so every lookup below throws on missing data.

function requireAttemptFields(entry: TimelineEntry): {
  readonly attemptRef: Common.ObjectRef;
  readonly definition: ReleasePublication.PublicationAttemptDefinition;
} {
  if (entry.attemptRef === undefined || entry.definition === undefined) {
    throw new Error(`fixture step ${String(entry.step)} is missing attemptRef/definition`);
  }
  return { attemptRef: entry.attemptRef, definition: entry.definition };
}

function resolveSubmission(
  entry: TimelineEntry,
  acceptedSubmission: ReleasePublication.FormalReceiptSubmission | undefined,
): ReleasePublication.FormalReceiptSubmission {
  const resolved =
    entry.submission === 'duplicate-of-step-3'
      ? acceptedSubmission
      : (entry.submission ?? undefined);
  if (resolved === undefined) {
    throw new Error(`fixture step ${String(entry.step)} has no resolvable submission`);
  }
  return resolved;
}

function resolveReceiptRef(
  entry: TimelineEntry,
  acceptedReceiptRef: Common.ContentAddressedRef | undefined,
): Common.ContentAddressedRef {
  const resolved =
    entry.receiptRef === 'duplicate-of-step-3'
      ? acceptedReceiptRef
      : (entry.receiptRef ?? undefined);
  if (resolved === undefined) {
    throw new Error(`fixture step ${String(entry.step)} has no resolvable receiptRef`);
  }
  return resolved;
}

describe('REL-801 simulated late receipt timeline (RP-API-E-003)', () => {
  it('preserves the early success receipt, rejects the late submission as stale, and settles at PARTIALLY_RELEASED', () => {
    const fixture = loadFixture();
    const runtime = openRuntime(fixture);

    // Step 3 is the only accepted receipt; step 5 replays it verbatim.
    let acceptedSubmission: ReleasePublication.FormalReceiptSubmission | undefined;
    let acceptedReceiptRef: Common.ContentAddressedRef | undefined;

    for (const entry of fixture.timeline) {
      if (entry.action === 'start_publication_attempt') {
        const { attemptRef, definition } = requireAttemptFields(entry);
        const result = runtime.startPublicationAttempt({
          releaseRef: fixture.release.releaseRef,
          attemptRef,
          definition,
        });
        expect(result.ok).toBe(true);
        continue;
      }

      const submission = resolveSubmission(entry, acceptedSubmission);
      const receiptRef = resolveReceiptRef(entry, acceptedReceiptRef);
      const result = runtime.recordPublicationReceipt({
        releaseRef: fixture.release.releaseRef,
        submission,
        receiptRef,
        correlationId: `fixture-step-${String(entry.step)}`,
      });

      if (entry.expect.outcome === 'ACCEPTED') {
        expect(result.ok).toBe(true);
        acceptedSubmission = submission;
        acceptedReceiptRef = receiptRef;
      } else {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe(entry.expect.outcome);
        }
      }
    }

    const finalOutcome = runtime.getReleaseOutcome(fixture.release.releaseRef);
    expect(finalOutcome).toBeDefined();
    expect(finalOutcome?.status).toBe(fixture.expectedFinalState.status);
    expect(finalOutcome?.succeededDestinationIds).toEqual(
      fixture.expectedFinalState.succeededDestinationIds,
    );
    expect(finalOutcome?.pendingDestinationIds).toEqual(
      fixture.expectedFinalState.pendingDestinationIds,
    );
    expect(finalOutcome?.receiptRefs).toHaveLength(fixture.expectedFinalState.recordedReceiptCount);

    // The preserved fact is destination A's early success receipt.
    expect(finalOutcome?.succeededDestinationIds).toContain('018f22e2-7c15-7b2e-8d86-2de956a9d810');
  });

  it('keeps the stale rejection from mutating the ledger on replay', () => {
    const fixture = loadFixture();
    const runtime = openRuntime(fixture);

    for (const entry of fixture.timeline) {
      if (entry.action === 'start_publication_attempt') {
        const { attemptRef, definition } = requireAttemptFields(entry);
        runtime.startPublicationAttempt({
          releaseRef: fixture.release.releaseRef,
          attemptRef,
          definition,
        });
        continue;
      }
      if (entry.step !== 4) {
        continue;
      }
      const result = runtime.recordPublicationReceipt({
        releaseRef: fixture.release.releaseRef,
        submission: resolveSubmission(entry, undefined),
        receiptRef: resolveReceiptRef(entry, undefined),
        correlationId: `fixture-step-${String(entry.step)}`,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(RELEASE_RECEIPT_STALE);
      }
    }

    // Only the attempts exist; no receipt has been recorded for destination B.
    const outcome = runtime.getReleaseOutcome(fixture.release.releaseRef);
    expect(outcome?.status).toBe('PUBLISHING');
    expect(outcome?.receiptRefs).toHaveLength(0);
  });

  it('preserves PARTIALLY_RELEASED when a later destination attempt starts after an early receipt', () => {
    const fixture = loadFixture();
    const runtime = openRuntime(fixture);
    const step1 = fixture.timeline[0];
    const step2 = fixture.timeline[1];
    const step3 = fixture.timeline.find((entry) => entry.step === 3);
    if (step1 === undefined || step2 === undefined || step3 === undefined) {
      throw new Error('fixture is missing steps 1-3');
    }

    const first = requireAttemptFields(step1);
    expect(
      runtime.startPublicationAttempt({
        releaseRef: fixture.release.releaseRef,
        attemptRef: first.attemptRef,
        definition: first.definition,
        correlationId: 'start-after-partial-1',
      }).ok,
    ).toBe(true);

    expect(
      runtime.recordPublicationReceipt({
        releaseRef: fixture.release.releaseRef,
        submission: resolveSubmission(step3, undefined),
        receiptRef: resolveReceiptRef(step3, undefined),
        correlationId: 'start-after-partial-receipt',
      }).ok,
    ).toBe(true);
    expect(runtime.getReleaseOutcome(fixture.release.releaseRef)?.status).toBe(
      'PARTIALLY_RELEASED',
    );

    const second = requireAttemptFields(step2);
    expect(
      runtime.startPublicationAttempt({
        releaseRef: fixture.release.releaseRef,
        attemptRef: second.attemptRef,
        definition: second.definition,
        correlationId: 'start-after-partial-2',
      }).ok,
    ).toBe(true);
    expect(runtime.getReleaseOutcome(fixture.release.releaseRef)?.status).toBe(
      'PARTIALLY_RELEASED',
    );

    // Idempotent re-start of the first attempt must also keep PARTIAL.
    expect(
      runtime.startPublicationAttempt({
        releaseRef: fixture.release.releaseRef,
        attemptRef: first.attemptRef,
        definition: first.definition,
        correlationId: 'start-after-partial-reentry',
      }).ok,
    ).toBe(true);
    expect(runtime.getReleaseOutcome(fixture.release.releaseRef)?.status).toBe(
      'PARTIALLY_RELEASED',
    );
  });

  it('rejects a publication attempt whose package belongs to a foreign release', () => {
    const fixture = loadFixture();
    const runtime = openRuntime(fixture);
    const firstStep = fixture.timeline[0];
    if (firstStep === undefined) {
      throw new Error('fixture timeline is empty');
    }
    const { attemptRef, definition } = requireAttemptFields(firstStep);
    const foreignDefinition: ReleasePublication.PublicationAttemptDefinition = {
      ...definition,
      packageRef: {
        ...definition.packageRef,
        releaseRef: {
          ...definition.packageRef.releaseRef,
          objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d899',
        },
      },
    };

    const attempt = runtime.startPublicationAttempt({
      releaseRef: fixture.release.releaseRef,
      attemptRef,
      definition: foreignDefinition,
    });
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) {
      expect(attempt.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
      expect(attempt.error.fieldViolations[0]?.fieldPath).toBe(
        '/payload/attempt/packageRef/releaseRef',
      );
    }

    // Even if a caller forged a matching receipt submission, no formal fact lands.
    const step3 = fixture.timeline.find((entry) => entry.step === 3);
    if (step3 === undefined) {
      throw new Error('fixture is missing step 3');
    }
    const seededRaw = fixture.rawExternalReceipts[0];
    if (seededRaw === undefined) {
      throw new Error('fixture is missing rawExternalReceipts[0]');
    }
    const forgedSubmission: ReleasePublication.FormalReceiptSubmission = {
      ...resolveSubmission(step3, undefined),
      packageRef: foreignDefinition.packageRef,
    };
    runtime.seedRawExternalReceipt({
      ...seededRaw,
      releaseId: '018f22e2-7c15-7b2e-8d86-2de956a9d899',
      packageHashDigest: foreignDefinition.packageRef.packageHash.digest,
    });
    const receipt = runtime.recordPublicationReceipt({
      releaseRef: fixture.release.releaseRef,
      submission: forgedSubmission,
      receiptRef: resolveReceiptRef(step3, undefined),
      correlationId: 'foreign-package-probe',
    });
    expect(receipt.ok).toBe(false);
    if (!receipt.ok) {
      expect(receipt.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
    }
    expect(runtime.getReleaseOutcome(fixture.release.releaseRef)?.status).toBe('AUTHORIZED');
    expect(runtime.getReleaseOutcome(fixture.release.releaseRef)?.receiptRefs).toHaveLength(0);
  });
});
