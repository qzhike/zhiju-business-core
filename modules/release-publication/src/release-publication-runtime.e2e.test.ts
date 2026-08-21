import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Common, ReleasePublication } from '@zhiju/contracts';

import {
  ReleasePublicationRuntime,
  type ReleaseDestinationPolicy,
} from './release-publication-runtime.js';
import { RELEASE_RECEIPT_STALE } from './receipt-validator.js';

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
    const runtime = new ReleasePublicationRuntime();

    runtime.openReleaseForPublication({
      releaseRef: fixture.release.releaseRef,
      destinations: fixture.release.destinations,
    });

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
    const runtime = new ReleasePublicationRuntime();
    runtime.openReleaseForPublication({
      releaseRef: fixture.release.releaseRef,
      destinations: fixture.release.destinations,
    });

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
});
