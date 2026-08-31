import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { Artifact, Common, Core, ReleasePublication } from '@zhiju/contracts';

import {
  ReleasePublicationRuntime,
  type ReleaseDestinationPolicy,
  type PublicationAdapterResult,
} from './release-publication-runtime.js';
import { buildPackageHashMaterial } from './package-hash.js';
import {
  RELEASE_ACTOR_NOT_HUMAN,
  RELEASE_AUTHORIZATION_DECISION_MISMATCH,
  type ReleaseAuthorizationValidationInput,
} from './release-publication-authorization.js';
import {
  RELEASE_RECEIPT_STALE,
  RELEASE_RECEIPT_TARGET_MISMATCH,
  type RawExternalReceiptFact,
} from './receipt-validator.js';
import type { ReleaseTransactionContext } from './persistence/release-publication-db.js';
import type {
  ReleaseActorSnapshotFact,
  ReleaseAuthorizationDecisionFact,
  ReleaseAuthorityQueryPorts,
} from './release-publication-validation.js';
import { RELEASE_NOT_AUTHORIZED } from './release-publication-validation.js';

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

interface RuntimeAuthorizationFixture {
  readonly validation: ReleaseAuthorizationValidationInput;
}

type PreparedTimelineFixture = TimelineFixture & {
  readonly authorization: RuntimeAuthorizationFixture;
};

function fixtureHash(byte: number): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: Buffer.alloc(32, byte).toString('hex'),
    canonicalizationVersion: '1',
  };
}

function fixtureObjectRef(
  objectType: string,
  objectId: string,
  scope: Common.ScopeRef,
): Common.ObjectRef {
  return { kind: 'OBJECT', objectType, objectId, scope };
}

function fixtureContentRef(
  objectType: string,
  objectId: string,
  scope: Common.ScopeRef,
  byte: number,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    scope,
    contentHash: fixtureHash(byte),
  };
}

function fixtureSnapshotRef(
  objectType: string,
  objectId: string,
  scope: Common.ScopeRef,
  byte: number,
): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId,
    snapshotId: objectId,
    scope,
    contentHash: fixtureHash(byte),
  };
}

function fixtureVersionedRef(
  objectType: string,
  objectId: string,
  versionId: string,
  scope: Common.ScopeRef,
): Common.VersionedRef {
  return { kind: 'VERSIONED', objectType, objectId, versionId, scope };
}

function buildRuntimeAuthorizationFixture(fixture: TimelineFixture): RuntimeAuthorizationFixture {
  const { enterpriseId, projectId } = fixture.release.releaseRef.scope;
  if (enterpriseId === undefined || projectId === undefined) {
    throw new Error('REL-801 authorization fixture requires an Enterprise and Project scope');
  }
  const scope: Common.ScopeRef = { enterpriseId, projectId };
  const artifactId = '018f22e2-7c15-7b2e-8d86-2de956a9d8b0';
  const revisionId = '018f22e2-7c15-7b2e-8d86-2de956a9d8b1';
  const profileId = '018f22e2-7c15-7b2e-8d86-2de956a9d8b2';
  const profileVersionId = '018f22e2-7c15-7b2e-8d86-2de956a9d8b3';
  const rasId = '018f22e2-7c15-7b2e-8d86-2de956a9d8b4';
  const absId = '018f22e2-7c15-7b2e-8d86-2de956a9d8b5';
  const recipientId = '018f22e2-7c15-7b2e-8d86-2de956a9d8b6';
  const representationId = '018f22e2-7c15-7b2e-8d86-2de956a9d8b7';
  const packageId = '018f22e2-7c15-7b2e-8d86-2de956a9d8b8';
  const packageSnapshotId = '018f22e2-7c15-7b2e-8d86-2de956a9d8b9';
  const readinessId = '018f22e2-7c15-7b2e-8d86-2de956a9d8ba';
  const principalId = '018f22e2-7c15-7b2e-8d86-2de956a9d8bb';
  const actorId = '018f22e2-7c15-7b2e-8d86-2de956a9d8bc';
  const decisionId = '018f22e2-7c15-7b2e-8d86-2de956a9d8bd';
  const policyId = '018f22e2-7c15-7b2e-8d86-2de956a9d8be';
  const correlationId = '018f22e2-7c15-7b2e-8d86-2de956a9d8bf';
  const registrationId = '018f22e2-7c15-7b2e-8d86-2de956a9d8c0';

  const revisionRef = fixtureContentRef('artifact.artifact_revision', revisionId, scope, 0x41);
  const artifactRef = fixtureObjectRef('artifact.artifact', artifactId, scope);
  const qualityProfileRef = fixtureVersionedRef(
    'quality.quality_profile',
    profileId,
    profileVersionId,
    { enterpriseId },
  );
  const revisionAcceptanceSnapshotRef = fixtureSnapshotRef(
    'quality.revision_acceptance_snapshot',
    rasId,
    scope,
    0x42,
  );
  const approvalBundleSnapshotRef = fixtureSnapshotRef(
    'quality.approval_bundle_snapshot',
    absId,
    scope,
    0x43,
  );
  const recipientScopeSnapshotRef = fixtureSnapshotRef(
    'release.recipient_scope_snapshot',
    recipientId,
    scope,
    0x44,
  );
  const representationRef: Artifact.RepresentationRef = {
    representationId,
    revision: revisionRef,
    format: 'PDF',
    mediaType: 'application/pdf',
    objectStorageRef: 'objects/rel-801-formal-representation',
    checksum: fixtureHash(0x45),
    renderer: { rendererId: 'renderer.test', rendererVersion: '1.0.0' },
    createdAt: '2026-08-20T00:00:00Z',
  };
  const representations: readonly ReleasePublication.ReleaseRepresentationSelection[] = [
    {
      representationRef,
      ordinal: 0,
      displayName: 'REL-801 formal PDF',
      required: true,
      releaseRole: 'PRIMARY',
    },
  ];
  const destinations: readonly ReleasePublication.ReleaseDestinationDefinition[] =
    fixture.release.destinations.map((policy, index) => ({
      destinationId: policy.destinationId,
      destinationType: 'FEISHU_DOC',
      destinationRef: {
        system: 'feishu',
        resourceType: 'document',
        externalId: `rel-801-${policy.destinationId}`,
        observedAt: '2026-08-20T00:00:00Z',
      },
      recipientScopeRef: recipientScopeSnapshotRef,
      purpose: 'CUSTOMER_DELIVERY',
      required: policy.required,
      requiredReceiptKind: 'PROVIDER_ACK',
      deliveryPolicyRef: fixtureVersionedRef(
        'policy.delivery_policy',
        `018f22e2-7c15-7b2e-8d86-2de956a9d8${String(index + 1)}0`,
        `018f22e2-7c15-7b2e-8d86-2de956a9d8${String(index + 1)}1`,
        scope,
      ),
    }));
  const packageWithPlaceholderHash: ReleasePublication.ReleasePackageDefinition = {
    releaseRef: fixture.release.releaseRef,
    canonicalRevisionRef: revisionRef,
    representations,
    destinations,
    recipientScopeSnapshotRef,
    approvalBundleSnapshotRef,
    preparedAt: '2026-08-20T00:00:00Z',
    packageHash: fixtureHash(0x00),
  };
  const packageMaterial = buildPackageHashMaterial(packageWithPlaceholderHash);
  const packageDefinition: ReleasePublication.ReleasePackageDefinition = {
    ...packageMaterial.normalizedDefinition,
    packageHash: packageMaterial.expectedPackageHash,
  };
  const packageSnapshotRef: Common.SnapshotRef = {
    kind: 'SNAPSHOT',
    objectType: 'release.release_package',
    objectId: packageId,
    snapshotId: packageSnapshotId,
    scope,
    contentHash: packageMaterial.expectedPackageHash,
  };
  const packageRef: Common.ReleasePackageRef = {
    releaseRef: fixture.release.releaseRef,
    packageSnapshotRef,
    packageHash: packageMaterial.expectedPackageHash,
  };
  const releaseReadinessSnapshotRef = fixtureSnapshotRef(
    'quality.release_readiness_snapshot',
    readinessId,
    scope,
    0x46,
  );
  const readinessSnapshot = {
    header: { scopeRef: scope },
    snapshotId: readinessId,
    releaseRef: fixture.release.releaseRef,
    artifactRef,
    revisionRef,
    approvalBundleSnapshotRef,
    releasePackageRef: packageRef,
    purpose: 'CUSTOMER_DELIVERY',
    recipientScopeSnapshotRef,
    destinationRefs: destinations.map((destination) => destination.destinationRef),
    releaseRequirements: [],
    requiredReleaseGateSpecs: [],
    releaseGateResultRefs: [],
    readiness: { status: 'READY_FOR_AUTHORIZATION', reasons: [] },
    evaluatedAt: '2026-08-20T00:00:00Z',
  } as unknown as Core.ReleaseReadinessSnapshot;
  const registrationRef = fixtureContentRef(
    'artifact.representation_registration',
    registrationId,
    scope,
    0x47,
  );
  const acceptance = {
    header: { scopeRef: scope },
    snapshotId: rasId,
    artifactRef,
    revisionRef,
    qualityProfileRef,
    readiness: { status: 'READY' },
  } as unknown as Core.RevisionAcceptanceSnapshot;
  const approval = {
    header: { scopeRef: scope },
    snapshotId: absId,
    artifactRef,
    revisionRef,
    revisionAcceptanceSnapshotRef,
    qualityProfileRef,
    completeness: { status: 'FULLY_APPROVED' },
    separationOfDutiesResult: { outcome: 'SATISFIED' },
  } as unknown as Core.ApprovalBundleSnapshot;
  const revisionValidation: Artifact.ArtifactValidateRevisionRefResult = {
    valid: true,
    exactRef: revisionRef,
    authoritativeScopeRef: revisionRef.scope,
    disposition: 'ACTIVE',
    contentAvailable: true,
    reasons: [],
  };
  const actorSnapshotRef = fixtureSnapshotRef('identity.actor_snapshot', actorId, scope, 0x48);
  const authorizationDecisionRef = fixtureContentRef(
    'identity.authorization_decision',
    decisionId,
    scope,
    0x49,
  );
  const authenticationContextHash = fixtureHash(0x4a);
  const commandPayloadHash = fixtureHash(0x4b);
  const actor: ReleaseActorSnapshotFact = {
    actorSnapshotRef,
    principalRef: { principalKind: 'HUMAN', principalId },
    authenticationContextHash,
  };
  const decision: ReleaseAuthorizationDecisionFact = {
    authorizationDecisionRef,
    actorSnapshotRef,
    principalRef: { principalKind: 'HUMAN', principalId },
    commandType: 'release.authorize_release',
    commandVersion: '1.0',
    scope,
    purpose: 'release.publication.authorize_release',
    commandPayloadHash,
    authenticationContextHash,
    outcome: 'ALLOW',
    expiresAt: '2026-09-01T00:00:00Z',
  };
  const ports: ReleaseAuthorityQueryPorts = {
    artifact: {
      validateRevisionRef: () => Promise.resolve(revisionValidation),
      getRepresentation: () =>
        Promise.resolve({
          representationRef,
          status: 'registered',
          registrationRef,
        }),
    },
    quality: {
      getRevisionAcceptanceSnapshot: () => Promise.resolve(acceptance),
      getApprovalBundleSnapshot: () => Promise.resolve(approval),
      getReleaseReadinessSnapshot: () => Promise.resolve(readinessSnapshot),
    },
    identity: {
      getActorSnapshot: () => Promise.resolve(actor),
      getAuthorizationDecision: () => Promise.resolve(decision),
    },
  };
  const now = new Date('2026-08-21T00:00:10Z');
  const validation: ReleaseAuthorizationValidationInput = {
    context: {
      kind: 'REQUEST',
      principalId,
      principalKind: 'HUMAN',
      actorSnapshotId: actorId,
      authorizationDecisionId: decisionId,
      authorizationDecisionHash: Buffer.from(authorizationDecisionRef.contentHash.digest, 'hex'),
      authorizationDecisionExpiresAt: new Date('2026-09-01T00:00:00Z'),
      policySnapshotId: policyId,
      enterpriseId,
      allowedProjectIds: [projectId],
      correlationId,
    },
    ports,
    releaseRef: fixture.release.releaseRef,
    draftDefinition: {
      artifactRef,
      revisionRef,
      releaseNumber: 'REL-801',
      purpose: 'CUSTOMER_DELIVERY',
      requestedEffectiveAt: '2026-09-01T00:00:00Z',
      qualityProfileRef,
      revisionAcceptanceSnapshotRef,
      approvalBundleSnapshotRef,
    },
    packageRef,
    packageDefinition,
    releaseReadinessSnapshotRef,
    authorizingHumanRef: { principalKind: 'HUMAN', principalId },
    actorSnapshotRef,
    authorizationDecisionRef,
    expectedCommandType: 'release.authorize_release',
    expectedCommandVersion: '1.0',
    expectedPurpose: 'release.publication.authorize_release',
    expectedCommandPayloadHash: commandPayloadHash,
    now,
  };
  return { validation };
}

function loadFixture(): PreparedTimelineFixture {
  const url = new URL(
    '../../../tests/fixtures/runtime/rel-801-late-receipt-timeline.json',
    import.meta.url,
  );
  const fixture = JSON.parse(readFileSync(url, 'utf8')) as TimelineFixture;
  const authorization = buildRuntimeAuthorizationFixture(fixture);
  const packageRef = authorization.validation.packageRef;
  const timeline = fixture.timeline.map((entry) => ({
    ...entry,
    ...(entry.definition === undefined ? {} : { definition: { ...entry.definition, packageRef } }),
    ...(entry.submission === undefined || typeof entry.submission === 'string'
      ? {}
      : { submission: { ...entry.submission, packageRef } }),
  }));
  return {
    ...fixture,
    authorization,
    rawExternalReceipts: fixture.rawExternalReceipts.map((fact) => ({
      ...fact,
      packageHashDigest: packageRef.packageHash.digest,
    })),
    timeline,
  };
}

async function openRuntime(fixture: PreparedTimelineFixture): Promise<ReleasePublicationRuntime> {
  const runtime = new ReleasePublicationRuntime();
  runtime.openReleaseForPublication({
    releaseRef: fixture.release.releaseRef,
    destinations: fixture.release.destinations,
    frozenPackageRef: fixture.authorization.validation.packageRef,
  });
  for (const fact of fixture.rawExternalReceipts) {
    runtime.seedRawExternalReceipt(fact);
  }
  const authorization = await runtime.authorizeRelease({
    validation: fixture.authorization.validation,
    destinations: fixture.release.destinations,
  });
  if (!authorization.ok) {
    throw new Error(`REL-801 fixture authorization failed: ${authorization.error.code}`);
  }
  return runtime;
}

function recallAuthorizationFixture(fixture: TimelineFixture): {
  readonly context: ReleaseTransactionContext;
  readonly ports: ReleaseAuthorityQueryPorts;
  readonly actorSnapshotRef: Common.SnapshotRef;
  readonly authorizationDecisionRef: Common.ContentAddressedRef;
  readonly recallRef: Common.ContentAddressedRef;
} {
  const { enterpriseId, projectId } = fixture.release.releaseRef.scope;
  if (enterpriseId === undefined || projectId === undefined) {
    throw new Error('Recall test fixture requires a Project scope');
  }
  const scope = { enterpriseId, projectId };
  const principalId = '018f22e2-7c15-7b2e-8d86-2de956a9d880';
  const actorId = '018f22e2-7c15-7b2e-8d86-2de956a9d881';
  const decisionId = '018f22e2-7c15-7b2e-8d86-2de956a9d882';
  const policyId = '018f22e2-7c15-7b2e-8d86-2de956a9d883';
  const correlationId = '018f22e2-7c15-7b2e-8d86-2de956a9d884';
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const authorizationContextHash: Common.ContentHash = {
    algorithm: 'SHA-256',
    digest: Buffer.alloc(32, 0x91).toString('hex'),
    canonicalizationVersion: '1',
  };
  const actorSnapshotRef: Common.SnapshotRef = {
    kind: 'SNAPSHOT',
    objectType: 'identity.actor_snapshot',
    objectId: actorId,
    snapshotId: actorId,
    scope,
    contentHash: authorizationContextHash,
  };
  const authorizationDecisionRef: Common.ContentAddressedRef = {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'identity.authorization_decision',
    objectId: decisionId,
    scope,
    contentHash: {
      algorithm: 'SHA-256',
      digest: Buffer.alloc(32, 0x92).toString('hex'),
      canonicalizationVersion: '1',
    },
  };
  const actor = {
    actorSnapshotRef,
    principalRef: { principalKind: 'HUMAN' as const, principalId },
    authenticationContextHash: authorizationContextHash,
  };
  const decision = {
    authorizationDecisionRef,
    actorSnapshotRef,
    principalRef: { principalKind: 'HUMAN' as const, principalId },
    commandType: 'release.recall_release',
    commandVersion: '1.0',
    scope,
    purpose: 'release.publication.recall_release',
    authenticationContextHash: authorizationContextHash,
    outcome: 'ALLOW' as const,
    expiresAt,
  };
  const ports: ReleaseAuthorityQueryPorts = {
    artifact: {
      validateRevisionRef: () => Promise.reject(new Error('not used by Recall test')),
      getRepresentation: () => Promise.reject(new Error('not used by Recall test')),
    },
    quality: {
      getRevisionAcceptanceSnapshot: () => Promise.reject(new Error('not used by Recall test')),
      getApprovalBundleSnapshot: () => Promise.reject(new Error('not used by Recall test')),
    },
    identity: {
      getActorSnapshot: () => Promise.resolve(actor),
      getAuthorizationDecision: () => Promise.resolve(decision),
    },
  };
  return {
    context: {
      kind: 'REQUEST',
      principalId,
      principalKind: 'HUMAN',
      actorSnapshotId: actorId,
      authorizationDecisionId: decisionId,
      authorizationDecisionHash: Buffer.from(authorizationDecisionRef.contentHash.digest, 'hex'),
      authorizationDecisionExpiresAt: new Date(expiresAt),
      policySnapshotId: policyId,
      enterpriseId,
      allowedProjectIds: [projectId],
      correlationId,
    },
    ports,
    actorSnapshotRef,
    authorizationDecisionRef,
    recallRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'release.recall',
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d885',
      scope,
      contentHash: {
        algorithm: 'SHA-256',
        digest: Buffer.alloc(32, 0x93).toString('hex'),
        canonicalizationVersion: '1',
      },
    },
  };
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
  it('preserves the early success receipt, rejects the late submission as stale, and settles at PARTIALLY_RELEASED', async () => {
    const fixture = loadFixture();
    const runtime = await openRuntime(fixture);

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

  it('RP-ISSUE23-U-005: keeps normalized provider result in the Receipt and excludes it from Events and errors', async () => {
    const fixture = loadFixture();
    const runtime = await openRuntime(fixture);
    const firstEntry = fixture.timeline[0];
    const receiptEntry = fixture.timeline.find((entry) => entry.step === 3);
    if (firstEntry === undefined || receiptEntry === undefined) {
      throw new Error('fixture is missing the first Attempt or accepted Receipt');
    }
    const first = requireAttemptFields(firstEntry);
    const baseSubmission = resolveSubmission(receiptEntry, undefined);
    const baseReceiptRef = resolveReceiptRef(receiptEntry, undefined);
    const sensitiveSubmission: ReleasePublication.FormalReceiptSubmission = {
      ...baseSubmission,
      providerResult: {
        messageId: 'AliceCustomer',
        providerStatus: 'AliceCustomer',
        reasonCode: 'BobBuyer',
        status: 'CustomerName',
        customRecipientData: [{ email: 'customer@example.com', body: 'document body' }],
      },
    };

    expect(
      runtime.startPublicationAttempt({
        releaseRef: fixture.release.releaseRef,
        attemptRef: first.attemptRef,
        definition: first.definition,
        correlationId: 'issue-23-runtime-start',
      }).ok,
    ).toBe(true);
    const accepted = runtime.recordPublicationReceipt({
      releaseRef: fixture.release.releaseRef,
      submission: sensitiveSubmission,
      receiptRef: baseReceiptRef,
      correlationId: 'issue-23-runtime-accepted',
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      const serializedReceipt = JSON.stringify(accepted.record.submission.providerResult);
      expect(accepted.record.submission.providerResult).toEqual({
        providerStatus: { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' },
        reasonCode: { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' },
        status: { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' },
      });
      expect(serializedReceipt).not.toContain('AliceCustomer');
      expect(serializedReceipt).not.toContain('BobBuyer');
      expect(serializedReceipt).not.toContain('CustomerName');
      expect(serializedReceipt).not.toContain('customer@example.com');
      expect(serializedReceipt).not.toContain('document body');
    }

    const events = runtime.getOutboxEvents(fixture.release.releaseRef);
    expect(JSON.stringify(events)).not.toContain('AliceCustomer');
    expect(JSON.stringify(events)).not.toContain('BobBuyer');
    expect(JSON.stringify(events)).not.toContain('CustomerName');
    expect(
      events.find((event) => event.eventType === 'release.PublicationSucceeded')?.payload,
    ).not.toHaveProperty('providerResult');

    const rejected = runtime.recordPublicationReceipt({
      releaseRef: fixture.release.releaseRef,
      submission: {
        ...sensitiveSubmission,
        destinationId: '018f22e2-7c15-7b2e-8d86-2de956a9d811',
      },
      receiptRef: {
        ...baseReceiptRef,
        objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d8d2',
      },
      correlationId: 'issue-23-runtime-rejected',
    });
    expect(rejected.ok).toBe(false);
    expect(JSON.stringify(rejected)).not.toContain('AliceCustomer');
    expect(JSON.stringify(rejected)).not.toContain('BobBuyer');
    expect(JSON.stringify(rejected)).not.toContain('CustomerName');
    expect(JSON.stringify(rejected)).not.toContain('customer@example.com');
    expect(JSON.stringify(rejected)).not.toContain('document body');
  });

  it('RP-ISSUE23-E-001: maps a serialized Adapter result before Runtime Receipt persistence', async () => {
    const fixture = loadFixture();
    const runtime = await openRuntime(fixture);
    const firstEntry = fixture.timeline[0];
    const receiptEntry = fixture.timeline.find((entry) => entry.step === 3);
    if (firstEntry === undefined || receiptEntry === undefined) {
      throw new Error('fixture is missing the first Attempt or accepted Receipt');
    }
    const first = requireAttemptFields(firstEntry);
    const submission = resolveSubmission(receiptEntry, undefined);
    const receiptRef = resolveReceiptRef(receiptEntry, undefined);
    expect(
      runtime.startPublicationAttempt({
        releaseRef: fixture.release.releaseRef,
        attemptRef: first.attemptRef,
        definition: first.definition,
        correlationId: 'issue-23-adapter-start',
      }).ok,
    ).toBe(true);

    const serializedAdapterResult = JSON.stringify({
      outcome: 'SUCCEEDED',
      receipt: {
        releaseRef: fixture.release.releaseRef,
        submission: {
          ...submission,
          providerResult: {
            adapterCode: 'feishu.channel',
            messageId: 'serialized-provider-message',
            providerRequestId: 'serialized-provider-request',
            status: 'delivered',
            outcome: 'success',
          },
        },
        receiptRef,
        correlationId: 'issue-23-adapter-receipt',
      },
    });
    const adapterResult = JSON.parse(serializedAdapterResult) as PublicationAdapterResult;
    const dispatch = await runtime.dispatchPublicationAttempt(
      fixture.release.releaseRef,
      first.attemptRef,
      () => Promise.resolve(adapterResult),
    );

    expect(dispatch).toEqual({ status: 'SUCCEEDED', invoked: true });
    expect(runtime.getReleaseOutcome(fixture.release.releaseRef)?.receiptRefs).toHaveLength(1);
    const eventPayloads = JSON.stringify(runtime.getOutboxEvents(fixture.release.releaseRef));
    expect(eventPayloads).not.toContain('serialized-provider-message');
    expect(eventPayloads).not.toContain('serialized-provider-request');
    expect(eventPayloads).not.toContain('providerResult');
  });

  it('keeps the stale rejection from mutating the ledger on replay', async () => {
    const fixture = loadFixture();
    const runtime = await openRuntime(fixture);

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

  it('preserves PARTIALLY_RELEASED when a later destination attempt starts after an early receipt', async () => {
    const fixture = loadFixture();
    const runtime = await openRuntime(fixture);
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

  it('rejects a publication attempt whose package belongs to a foreign release', async () => {
    const fixture = loadFixture();
    const runtime = await openRuntime(fixture);
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

  it('does not expose or mutate a release through the same objectId in another project scope', async () => {
    const fixture = loadFixture();
    const runtime = await openRuntime(fixture);
    const firstStep = fixture.timeline[0];
    if (firstStep === undefined) {
      throw new Error('fixture timeline is empty');
    }
    const { attemptRef, definition } = requireAttemptFields(firstStep);
    const foreignScopeRelease: Common.ObjectRef = {
      ...fixture.release.releaseRef,
      scope: {
        enterpriseId: '018f22e2-7c15-7b2e-8d86-2de956a9d201',
        projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d299',
      },
    };
    const foreignScopeDefinition: ReleasePublication.PublicationAttemptDefinition = {
      ...definition,
      packageRef: {
        ...definition.packageRef,
        releaseRef: foreignScopeRelease,
      },
    };

    const result = runtime.startPublicationAttempt({
      releaseRef: foreignScopeRelease,
      attemptRef,
      definition: foreignScopeDefinition,
      correlationId: 'foreign-scope-probe',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
    }
    expect(runtime.getReleaseOutcome(foreignScopeRelease)).toBeUndefined();
    expect(runtime.getReleaseOutcome(fixture.release.releaseRef)?.status).toBe('AUTHORIZED');

    const foreignScopeAttemptRef: Common.ObjectRef = {
      ...attemptRef,
      scope: foreignScopeRelease.scope,
    };
    const attemptScopeResult = runtime.startPublicationAttempt({
      releaseRef: fixture.release.releaseRef,
      attemptRef: foreignScopeAttemptRef,
      definition,
      correlationId: 'foreign-attempt-scope-probe',
    });
    expect(attemptScopeResult.ok).toBe(false);
    if (!attemptScopeResult.ok) {
      expect(attemptScopeResult.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
      expect(attemptScopeResult.error.fieldViolations[0]?.fieldPath).toBe(
        '/payload/attemptRef/scope',
      );
    }
  });

  it('does not settle FAILED while a newer retry Attempt is still pending', async () => {
    const fixture = loadFixture();
    const runtime = await openRuntime(fixture);
    const firstEntry = fixture.timeline[0];
    const secondEntry = fixture.timeline[1];
    if (firstEntry === undefined || secondEntry === undefined) {
      throw new Error('fixture is missing the first two Attempts');
    }
    const first = requireAttemptFields(firstEntry);
    const second = requireAttemptFields(secondEntry);
    expect(
      runtime.startPublicationAttempt({
        releaseRef: fixture.release.releaseRef,
        attemptRef: first.attemptRef,
        definition: first.definition,
      }).ok,
    ).toBe(true);
    expect(
      runtime.startPublicationAttempt({
        releaseRef: fixture.release.releaseRef,
        attemptRef: second.attemptRef,
        definition: second.definition,
      }).ok,
    ).toBe(true);

    const failureRef = (objectId: string): Common.ContentAddressedRef => ({
      kind: 'CONTENT_ADDRESSED',
      objectType: 'release.publication_failure',
      objectId,
      scope: fixture.release.releaseRef.scope,
      contentHash: first.definition.packageRef.packageHash,
    });
    const failure = (attempt: typeof first, ref: Common.ContentAddressedRef) =>
      runtime.recordPublicationFailure({
        releaseRef: fixture.release.releaseRef,
        failure: {
          attemptRef: attempt.attemptRef,
          destinationId: attempt.definition.destinationId,
          packageRef: attempt.definition.packageRef,
          classification: 'INTEGRATION_DELIVERY_FAILED',
          retryable: true,
          outcome: 'FAILED',
          occurredAt: '2026-08-21T00:00:10Z',
        },
        failureRef: ref,
        correlationId: `failure-${ref.objectId}`,
      });

    expect(failure(first, failureRef('018f22e2-7c15-7b2e-8d86-2de956a9d870')).ok).toBe(true);
    expect(failure(second, failureRef('018f22e2-7c15-7b2e-8d86-2de956a9d871')).ok).toBe(true);
    expect(runtime.getReleaseOutcome(fixture.release.releaseRef)?.status).toBe('FAILED');

    const retryFirst = {
      ...first.definition,
      attemptNumber: 2,
      externalDeliveryRequestRef: {
        ...first.definition.externalDeliveryRequestRef,
        objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d872',
      },
    };
    const retrySecond = {
      ...second.definition,
      attemptNumber: 2,
      externalDeliveryRequestRef: {
        ...second.definition.externalDeliveryRequestRef,
        objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d873',
      },
    };
    const retryFirstRef = {
      ...first.attemptRef,
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d874',
    };
    const retrySecondRef = {
      ...second.attemptRef,
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d875',
    };
    expect(
      runtime.startPublicationAttempt({
        releaseRef: fixture.release.releaseRef,
        attemptRef: retryFirstRef,
        definition: retryFirst,
      }).ok,
    ).toBe(true);
    expect(
      runtime.startPublicationAttempt({
        releaseRef: fixture.release.releaseRef,
        attemptRef: retrySecondRef,
        definition: retrySecond,
      }).ok,
    ).toBe(true);

    const retrySecondFailure = runtime.recordPublicationFailure({
      releaseRef: fixture.release.releaseRef,
      failure: {
        attemptRef: retrySecondRef,
        destinationId: retrySecond.destinationId,
        packageRef: retrySecond.packageRef,
        classification: 'INTEGRATION_DELIVERY_FAILED',
        retryable: true,
        outcome: 'FAILED',
        occurredAt: '2026-08-21T00:00:20Z',
      },
      failureRef: failureRef('018f22e2-7c15-7b2e-8d86-2de956a9d876'),
      correlationId: 'retry-second-failure',
    });
    expect(retrySecondFailure.ok).toBe(true);
    expect(runtime.getReleaseOutcome(fixture.release.releaseRef)?.status).toBe('PUBLISHING');

    const conflictingFailure = runtime.recordPublicationFailure({
      releaseRef: fixture.release.releaseRef,
      failure: {
        attemptRef: first.attemptRef,
        destinationId: first.definition.destinationId,
        packageRef: first.definition.packageRef,
        classification: 'DIFFERENT_FAILURE',
        retryable: false,
        outcome: 'UNKNOWN',
        occurredAt: '2026-08-21T00:00:30Z',
      },
      failureRef: failureRef('018f22e2-7c15-7b2e-8d86-2de956a9d877'),
      correlationId: 'conflicting-failure',
    });
    expect(conflictingFailure.ok).toBe(false);
  });

  it('blocks publication mutations, repeat Recall, and Adapter dispatch after Recall', async () => {
    const fixture = loadFixture();
    const runtime = await openRuntime(fixture);
    const firstEntry = fixture.timeline[0];
    const receiptEntry = fixture.timeline.find((entry) => entry.step === 3);
    if (firstEntry === undefined || receiptEntry === undefined) {
      throw new Error('fixture is missing the first Attempt or accepted Receipt');
    }
    const first = requireAttemptFields(firstEntry);
    const receiptSubmission = resolveSubmission(receiptEntry, undefined);
    const receiptRef = resolveReceiptRef(receiptEntry, undefined);
    expect(
      runtime.startPublicationAttempt({
        releaseRef: fixture.release.releaseRef,
        attemptRef: first.attemptRef,
        definition: first.definition,
        correlationId: 'recall-terminal-start',
      }).ok,
    ).toBe(true);

    let invokeCount = 0;
    const wrongTypeDispatch = await runtime.dispatchPublicationAttempt(
      fixture.release.releaseRef,
      { ...first.attemptRef, objectType: 'release.publication_receipt' },
      () => {
        invokeCount += 1;
        return Promise.reject(
          new Error('an incorrect Attempt object type must not invoke an Adapter'),
        );
      },
    );
    expect(wrongTypeDispatch.status).toBe('REJECTED');
    expect(wrongTypeDispatch.invoked).toBe(false);

    const enterpriseId = fixture.release.releaseRef.scope.enterpriseId;
    if (enterpriseId === undefined) throw new Error('Dispatch test requires an Enterprise scope');
    const wrongScopeDispatch = await runtime.dispatchPublicationAttempt(
      fixture.release.releaseRef,
      {
        ...first.attemptRef,
        scope: {
          enterpriseId,
          projectId: '018f22e2-7c15-7b2e-8d86-2de956a9d899',
        },
      },
      () => {
        invokeCount += 1;
        return Promise.reject(new Error('an incorrect Attempt scope must not invoke an Adapter'));
      },
    );
    expect(wrongScopeDispatch.status).toBe('REJECTED');
    expect(wrongScopeDispatch.invoked).toBe(false);
    expect(invokeCount).toBe(0);

    const authorization = recallAuthorizationFixture(fixture);
    const recall = await runtime.recallRelease({
      context: authorization.context,
      ports: authorization.ports,
      releaseRef: fixture.release.releaseRef,
      packageRef: first.definition.packageRef,
      authorizingHumanRef: {
        principalKind: 'HUMAN',
        principalId: authorization.context.principalId,
      },
      actorSnapshotRef: authorization.actorSnapshotRef,
      authorizationDecisionRef: authorization.authorizationDecisionRef,
      now: new Date(),
      recallRef: authorization.recallRef,
      affectedDestinationIds: fixture.release.destinations.map(
        (destination) => destination.destinationId,
      ),
      recalledAt: new Date().toISOString(),
    });
    expect(recall).toEqual({ ok: true, recallRef: authorization.recallRef });

    const secondStart = runtime.startPublicationAttempt({
      releaseRef: fixture.release.releaseRef,
      attemptRef: first.attemptRef,
      definition: first.definition,
      correlationId: 'recall-terminal-start-replay',
    });
    expect(secondStart.ok).toBe(false);
    if (!secondStart.ok) expect(secondStart.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);

    const receipt = runtime.recordPublicationReceipt({
      releaseRef: fixture.release.releaseRef,
      submission: receiptSubmission,
      receiptRef,
      correlationId: 'recall-terminal-receipt',
    });
    expect(receipt.ok).toBe(false);
    if (!receipt.ok) expect(receipt.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);

    const failure = runtime.recordPublicationFailure({
      releaseRef: fixture.release.releaseRef,
      failure: {
        attemptRef: first.attemptRef,
        destinationId: first.definition.destinationId,
        packageRef: first.definition.packageRef,
        classification: 'INTEGRATION_DELIVERY_FAILED',
        retryable: true,
        outcome: 'FAILED',
        occurredAt: '2026-08-21T00:00:10Z',
      },
      failureRef: {
        ...receiptRef,
        objectType: 'release.publication_failure',
      },
      correlationId: 'recall-terminal-failure',
    });
    expect(failure.ok).toBe(false);
    if (!failure.ok) expect(failure.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);

    const projectId = authorization.context.allowedProjectIds[0];
    if (projectId === undefined) throw new Error('Recall test context requires a Project scope');
    const completion = runtime.completeRelease({
      releaseRef: fixture.release.releaseRef,
      completionPolicyRef: {
        kind: 'VERSIONED',
        objectType: 'policy.release_completion',
        objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d886',
        versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d887',
        scope: {
          enterpriseId: authorization.context.enterpriseId,
          projectId,
        },
      },
      destinationOutcomeRefs: [receiptRef],
      evaluatedAt: new Date().toISOString(),
      correlationId: 'recall-terminal-complete',
    });
    expect(completion.ok).toBe(false);
    if (!completion.ok) expect(completion.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);

    const dispatch = await runtime.dispatchPublicationAttempt(
      fixture.release.releaseRef,
      first.attemptRef,
      () => {
        invokeCount += 1;
        return Promise.reject(new Error('recalled Release must not invoke an Adapter'));
      },
    );
    expect(dispatch.status).toBe('REJECTED');
    expect(dispatch.invoked).toBe(false);
    expect(invokeCount).toBe(0);

    const repeatedRecall = await runtime.recallRelease({
      context: authorization.context,
      ports: authorization.ports,
      releaseRef: fixture.release.releaseRef,
      packageRef: first.definition.packageRef,
      authorizingHumanRef: {
        principalKind: 'HUMAN',
        principalId: authorization.context.principalId,
      },
      actorSnapshotRef: authorization.actorSnapshotRef,
      authorizationDecisionRef: authorization.authorizationDecisionRef,
      now: new Date(),
      recallRef: authorization.recallRef,
      affectedDestinationIds: fixture.release.destinations.map(
        (destination) => destination.destinationId,
      ),
      recalledAt: new Date().toISOString(),
    });
    expect(repeatedRecall.ok).toBe(false);
    expect(runtime.getPublicationAttempts(fixture.release.releaseRef)).toHaveLength(1);
    expect(runtime.getOutboxEvents(fixture.release.releaseRef)).toHaveLength(3);
  });

  it('RP-ISSUE22-E-001: rejects an Agent Envelope before authorization or publication side effects', async () => {
    const fixture = loadFixture();
    const runtime = new ReleasePublicationRuntime();
    runtime.openReleaseForPublication({
      releaseRef: fixture.release.releaseRef,
      destinations: fixture.release.destinations,
      frozenPackageRef: fixture.authorization.validation.packageRef,
    });

    const denied = await runtime.authorizeRelease({
      validation: {
        ...fixture.authorization.validation,
        context: {
          ...fixture.authorization.validation.context,
          principalKind: 'AGENT',
        },
      },
      destinations: fixture.release.destinations,
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error.code).toBe(RELEASE_ACTOR_NOT_HUMAN);
      expect(denied.error.safeMessage).not.toContain('port');
    }
    expect(runtime.getOutboxEvents(fixture.release.releaseRef)).toHaveLength(0);
    expect(runtime.getReleaseOutcome(fixture.release.releaseRef)?.status).toBe('PREPARED');

    const firstEntry = fixture.timeline[0];
    if (firstEntry === undefined) throw new Error('fixture is missing the first Attempt');
    const first = requireAttemptFields(firstEntry);
    const start = runtime.startPublicationAttempt({
      releaseRef: fixture.release.releaseRef,
      attemptRef: first.attemptRef,
      definition: first.definition,
      correlationId: 'issue-22-after-denied-authorization',
    });
    expect(start.ok).toBe(false);
    if (!start.ok) expect(start.error.code).toBe(RELEASE_NOT_AUTHORIZED);
    expect(runtime.getPublicationAttempts(fixture.release.releaseRef)).toHaveLength(0);
    expect(runtime.getOutboxEvents(fixture.release.releaseRef)).toHaveLength(0);
  });

  it('RP-ISSUE22-U-001: rejects a forged runtime authorization ref before mutating state', async () => {
    const fixture = loadFixture();
    const runtime = new ReleasePublicationRuntime();
    const firstEntry = fixture.timeline[0];
    if (firstEntry === undefined) throw new Error('fixture is missing the first Attempt');
    const first = requireAttemptFields(firstEntry);

    const denied = await runtime.authorizeRelease({
      validation: fixture.authorization.validation,
      destinations: fixture.release.destinations,
      authorizationRef: fixtureContentRef(
        'release.release_authorization',
        fixture.authorization.validation.authorizationDecisionRef.objectId,
        fixture.release.releaseRef.scope,
        0xfa,
      ),
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe(RELEASE_AUTHORIZATION_DECISION_MISMATCH);
    expect(runtime.getOutboxEvents(fixture.release.releaseRef)).toHaveLength(0);
    expect(runtime.getPublicationAttempts(fixture.release.releaseRef)).toHaveLength(0);

    const start = runtime.startPublicationAttempt({
      releaseRef: fixture.release.releaseRef,
      attemptRef: first.attemptRef,
      definition: first.definition,
      correlationId: 'issue-22-forged-authorization-ref',
    });
    expect(start.ok).toBe(false);
    if (start.ok) throw new Error('forged authorization unexpectedly created a Runtime Release');
    expect(start.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
  });

  it('RP-ISSUE24-E-001: rejects an ordinary provider success without a formal Raw Receipt binding', async () => {
    const fixture = loadFixture();
    const runtime = await openRuntime(fixture);
    const firstEntry = fixture.timeline[0];
    const receiptEntry = fixture.timeline.find((entry) => entry.step === 3);
    if (firstEntry === undefined || receiptEntry === undefined) {
      throw new Error('fixture is missing the first Attempt or accepted Receipt');
    }
    const first = requireAttemptFields(firstEntry);
    const receiptSubmission = resolveSubmission(receiptEntry, undefined);
    const receiptRef = resolveReceiptRef(receiptEntry, undefined);
    const start = runtime.startPublicationAttempt({
      releaseRef: fixture.release.releaseRef,
      attemptRef: first.attemptRef,
      definition: first.definition,
      correlationId: 'issue-24-formal-attempt',
    });
    expect(start.ok).toBe(true);

    let invokeCount = 0;
    const ordinaryReceiptRef: Common.ContentAddressedRef = {
      ...receiptRef,
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d8d1',
      contentHash: fixtureHash(0x9b),
    };
    const ordinaryAdapterResult = JSON.parse(
      JSON.stringify({
        outcome: 'SUCCEEDED',
        receipt: {
          releaseRef: fixture.release.releaseRef,
          submission: {
            ...receiptSubmission,
            rawReceiptRef: {
              ...receiptSubmission.rawReceiptRef,
              objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d8d0',
              contentHash: fixtureHash(0x9a),
            },
            providerResult: {
              adapterCode: 'feishu.channel',
              messageId: 'ordinary-feishu-message-001',
              status: 'DELIVERED',
            },
          },
          receiptRef: ordinaryReceiptRef,
          correlationId: 'issue-24-ordinary-send',
        },
      }),
    ) as PublicationAdapterResult;
    const dispatch = await runtime.dispatchPublicationAttempt(
      fixture.release.releaseRef,
      first.attemptRef,
      () => {
        invokeCount += 1;
        return Promise.resolve(ordinaryAdapterResult);
      },
    );

    expect(dispatch.status).toBe('REJECTED');
    expect(dispatch.invoked).toBe(true);
    expect(invokeCount).toBe(1);
    if (dispatch.status === 'REJECTED') {
      expect(dispatch.error.code).toBe(RELEASE_RECEIPT_TARGET_MISMATCH);
    }
    expect(runtime.getPublicationAttempts(fixture.release.releaseRef)[0]?.outcome).toBe('PENDING');
    expect(runtime.getReleaseOutcome(fixture.release.releaseRef)?.status).toBe('PUBLISHING');
    expect(runtime.getReleaseOutcome(fixture.release.releaseRef)?.receiptRefs).toHaveLength(0);
    expect(
      runtime.getOutboxEvents(fixture.release.releaseRef).map((event) => event.eventType),
    ).toEqual(['release.ReleaseAuthorized', 'release.PublicationAttemptRequested']);
  });
});
