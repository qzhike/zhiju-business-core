import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { publicApiOperations } from '../generated/public-api.js';
import { ContractRegistry } from '../registry.js';
import { releasePublicationOperationContracts } from './release-publication.schema.js';

function fixture(name: string): Record<string, unknown> {
  const url = new URL(`../../../tests/fixtures/contracts/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

const ENTERPRISE_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const ZERO_DIGEST = '0'.repeat(64);
const SOURCE_WATERMARK = {
  sourceModule: 'release_publication',
  partition: 'partition-1',
  sequence: 1,
  observedAt: '2026-08-17T00:00:00Z',
};

function scopeRef() {
  return { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID };
}

function objectRef(objectType: string, objectId: string) {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
  };
}

function contentAddressedRef(objectType: string, objectId: string, digest: string) {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    scope: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
    contentHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
  };
}

function snapshotRef(objectType: string, objectId: string, snapshotId: string, digest: string) {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId,
    snapshotId,
    scope: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
    contentHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
  };
}

function versionedRef(objectType: string, objectId: string, versionId: string) {
  return {
    kind: 'VERSIONED',
    objectType,
    objectId,
    versionId,
    scope: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
  };
}

function externalRef(system: string, resourceType: string, externalId: string) {
  return {
    system,
    resourceType,
    externalId,
    observedAt: '2026-08-17T00:00:00Z',
  };
}

function integrity(digest: string) {
  return {
    canonicalizationVersion: '1',
    payloadHash: { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' },
  };
}

function commandEnvelope(
  commandType: string,
  targetRef: Record<string, unknown>,
  payload: Record<string, unknown>,
  digest: string = ZERO_DIGEST,
): Record<string, unknown> {
  return {
    commandId: '018f22e2-7c15-7b2e-8d86-2de956a9d301',
    commandType,
    commandVersion: '1.0',
    scopeRef: scopeRef(),
    targetRef,
    actor: objectRef('identity.principal', '018f22e2-7c15-7b2e-8d86-2de956a9d302'),
    authorizationDecisionRef: contentAddressedRef(
      'identity.authorization_decision',
      '018f22e2-7c15-7b2e-8d86-2de956a9d303',
      '1'.repeat(64),
    ),
    idempotencyKey: `fixture-${commandType}-${digest.slice(0, 6)}`,
    correlationId: '018f22e2-7c15-7b2e-8d86-2de956a9d304',
    requestedAt: '2026-08-17T00:00:00Z',
    payload,
    integrity: integrity(digest),
  };
}

function queryEnvelope(
  queryType: string,
  payload: Record<string, unknown>,
  consistencyRequirement: 'AUTHORITATIVE' | 'SNAPSHOT_AT_LEAST' | 'PROJECTION_OK' = 'AUTHORITATIVE',
): Record<string, unknown> {
  return {
    queryId: '018f22e2-7c15-7b2e-8d86-2de956a9d305',
    queryType,
    queryVersion: '1.0',
    scopeRef: scopeRef(),
    requester: objectRef('identity.principal', '018f22e2-7c15-7b2e-8d86-2de956a9d302'),
    authenticationContextRef: objectRef(
      'identity.authentication_context',
      '018f22e2-7c15-7b2e-8d86-2de956a9d306',
    ),
    consistencyRequirement,
    correlationId: '018f22e2-7c15-7b2e-8d86-2de956a9d304',
    requestedAt: '2026-08-17T00:00:00Z',
    payload,
  };
}

function eventEnvelope(
  eventType: string,
  aggregateId: string,
  payload: Record<string, unknown>,
  digest: string = ZERO_DIGEST,
): Record<string, unknown> {
  return {
    eventId: '018f22e2-7c15-7b2e-8d86-2de956a9d307',
    eventType,
    eventVersion: '1.0',
    producerModule: 'release-publication',
    aggregateType: 'release.release',
    aggregateId,
    aggregateVersion: 1,
    scopeRef: scopeRef(),
    correlationId: '018f22e2-7c15-7b2e-8d86-2de956a9d304',
    causationId: '018f22e2-7c15-7b2e-8d86-2de956a9d304',
    commandId: '018f22e2-7c15-7b2e-8d86-2de956a9d301',
    actorRef: objectRef('identity.principal', '018f22e2-7c15-7b2e-8d86-2de956a9d302'),
    occurredAt: '2026-08-17T00:00:00Z',
    dataClassification: 'INTERNAL',
    payload,
    integrity: integrity(digest),
  };
}

function releaseDraftPayload(suffix = '010') {
  return {
    definition: {
      artifactRef: objectRef('artifact.artifact', `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`),
      revisionRef: contentAddressedRef(
        'artifact.artifact_revision',
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        ZERO_DIGEST,
      ),
      releaseNumber: 'REL-801',
      purpose: 'CUSTOMER_DELIVERY',
      qualityProfileRef: versionedRef(
        'quality.quality_profile',
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      ),
      revisionAcceptanceSnapshotRef: snapshotRef(
        'quality.revision_acceptance_snapshot',
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        ZERO_DIGEST,
      ),
      approvalBundleSnapshotRef: snapshotRef(
        'quality.approval_bundle_snapshot',
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        ZERO_DIGEST,
      ),
    },
  };
}

function packagePayload(suffix = '020') {
  return {
    package: {
      releaseRef: objectRef('release.release', `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`),
      canonicalRevisionRef: contentAddressedRef(
        'artifact.artifact_revision',
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        ZERO_DIGEST,
      ),
      representations: [
        {
          representationRef: {
            representationId: `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
            revision: contentAddressedRef(
              'artifact.artifact_revision',
              `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
              ZERO_DIGEST,
            ),
            format: 'docx',
            mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            objectStorageRef: 'object-storage/release-packages/docx',
            checksum: { algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' },
            renderer: { rendererId: 'renderer.docx', rendererVersion: '1.0.0' },
            createdAt: '2026-08-17T00:00:00Z',
          },
          ordinal: 0,
          displayName: 'Customer-facing DOCX',
          required: true,
          releaseRole: 'customer.primary',
        },
      ],
      destinations: [
        {
          destinationId: `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
          destinationType: 'feishu.chat',
          destinationRef: externalRef('feishu', 'chat', 'oc_release_destination'),
          recipientScopeRef: snapshotRef(
            'release.recipient_scope',
            `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
            `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
            ZERO_DIGEST,
          ),
          purpose: 'customer.delivery',
          required: true,
          requiredReceiptKind: 'feishu.message_receipt',
          deliveryPolicyRef: versionedRef(
            'policy.delivery',
            `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
            `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
          ),
        },
      ],
      recipientScopeSnapshotRef: snapshotRef(
        'release.recipient_scope',
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        ZERO_DIGEST,
      ),
      approvalBundleSnapshotRef: snapshotRef(
        'quality.approval_bundle_snapshot',
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        ZERO_DIGEST,
      ),
      preparedAt: '2026-08-17T00:00:00Z',
      packageHash: { algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' },
    },
    preparationValidationRef: contentAddressedRef(
      'quality.validation_result',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      ZERO_DIGEST,
    ),
  };
}

function readinessPayload(suffix = '030') {
  return {
    releaseReadinessSnapshotRef: snapshotRef(
      'core.release_readiness',
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      ZERO_DIGEST,
    ),
    validatedPackageRef: {
      releaseRef: objectRef('release.release', `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`),
      packageSnapshotRef: snapshotRef(
        'release.release_package',
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        ZERO_DIGEST,
      ),
      packageHash: { algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' },
    },
    validatedAt: '2026-08-17T00:00:00Z',
  };
}

function attemptPayload(suffix = '040') {
  return {
    attempt: {
      destinationId: `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
      packageRef: {
        releaseRef: objectRef('release.release', `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`),
        packageSnapshotRef: snapshotRef(
          'release.release_package',
          `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
          `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
          ZERO_DIGEST,
        ),
        packageHash: { algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' },
      },
      attemptNumber: 1,
      stableIdempotencyKey: 'rel-801-attempt-001',
      requestedAt: '2026-08-17T00:00:00Z',
      externalDeliveryRequestRef: contentAddressedRef(
        'integration.external_delivery_request',
        `018f22e2-7c15-7b2e-8d86-2de956a9d${suffix}`,
        ZERO_DIGEST,
      ),
    },
  };
}

function humanPrincipalRef() {
  return { principalKind: 'HUMAN', principalId: '018f22e2-7c15-7b2e-8d86-2de956a9d308' };
}

describe('release-publication schema', () => {
  const registry = new ContractRegistry();

  it('registers exactly 25 full release-publication operations with the approved kind distribution', () => {
    const release = publicApiOperations.filter(
      (operation) => operation.owner === 'release-publication',
    );

    expect(release).toHaveLength(25);
    expect(release.filter((operation) => operation.kind === 'COMMAND')).toHaveLength(12);
    expect(release.filter((operation) => operation.kind === 'QUERY')).toHaveLength(5);
    expect(release.filter((operation) => operation.kind === 'EVENT')).toHaveLength(8);
    expect(Object.keys(releasePublicationOperationContracts).sort()).toEqual(
      release.map((operation) => operation.type).sort(),
    );
  });

  it('exposes result schemas for every release-publication query', () => {
    const release = publicApiOperations.filter(
      (operation) => operation.owner === 'release-publication' && operation.kind === 'QUERY',
    );

    expect(release).toHaveLength(5);
    for (const operation of release) {
      const contract = releasePublicationOperationContracts[operation.type];
      expect(contract?.resultSchemaRef).toBeDefined();
    }
  });

  // ===========================================================================
  // Happy-path command / query / event validation (12 + 5 + 8 = 25)
  // ===========================================================================

  it('validates create_release_draft with exact Revision / Approval Bundle references', () => {
    const command = commandEnvelope(
      'release.create_release_draft',
      objectRef('artifact.artifact', '018f22e2-7c15-7b2e-8d86-2de956a9d010'),
      releaseDraftPayload('010'),
    );
    expect(registry.validateOperation('release.create_release_draft', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates select_representations with justification', () => {
    const command = commandEnvelope(
      'release.select_representations',
      objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d020'),
      {
        selections: [
          {
            representationRef: {
              representationId: '018f22e2-7c15-7b2e-8d86-2de956a9d020',
              revision: contentAddressedRef(
                'artifact.artifact_revision',
                '018f22e2-7c15-7b2e-8d86-2de956a9d020',
                ZERO_DIGEST,
              ),
              format: 'docx',
              mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              objectStorageRef: 'object-storage/release-packages/docx',
              checksum: { algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' },
              renderer: { rendererId: 'renderer.docx', rendererVersion: '1.0.0' },
              createdAt: '2026-08-17T00:00:00Z',
            },
            ordinal: 0,
            displayName: 'Primary DOCX',
            required: true,
            releaseRole: 'customer.primary',
          },
        ],
        selectionReason: {
          reasonCode: 'RELEASE_REPRESENTATION_SELECTED',
          summary: 'Primary customer-facing DOCX selected for REL-801.',
          evidenceRefs: [],
        },
      },
    );
    expect(registry.validateOperation('release.select_representations', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates set_destinations with a recipient scope snapshot', () => {
    const command = commandEnvelope(
      'release.set_destinations',
      objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d021'),
      {
        destinations: [
          {
            destinationId: '018f22e2-7c15-7b2e-8d86-2de956a9d021',
            destinationType: 'feishu.chat',
            destinationRef: externalRef('feishu', 'chat', 'oc_release_destination'),
            recipientScopeRef: snapshotRef(
              'release.recipient_scope',
              '018f22e2-7c15-7b2e-8d86-2de956a9d021',
              '018f22e2-7c15-7b2e-8d86-2de956a9d022',
              ZERO_DIGEST,
            ),
            purpose: 'customer.delivery',
            required: true,
            requiredReceiptKind: 'feishu.message_receipt',
            deliveryPolicyRef: versionedRef(
              'policy.delivery',
              '018f22e2-7c15-7b2e-8d86-2de956a9d023',
              '018f22e2-7c15-7b2e-8d86-2de956a9d024',
            ),
          },
        ],
        recipientScopeSnapshotRef: snapshotRef(
          'release.recipient_scope',
          '018f22e2-7c15-7b2e-8d86-2de956a9d021',
          '018f22e2-7c15-7b2e-8d86-2de956a9d022',
          ZERO_DIGEST,
        ),
      },
    );
    expect(registry.validateOperation('release.set_destinations', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates prepare_release with a frozen package hash', () => {
    const command = commandEnvelope(
      'release.prepare_release',
      objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d020'),
      packagePayload('020'),
    );
    expect(registry.validateOperation('release.prepare_release', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates validate_release_readiness with snapshot + package + instant', () => {
    const command = commandEnvelope(
      'release.validate_release_readiness',
      objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d030'),
      readinessPayload('030'),
    );
    expect(
      registry.validateOperation('release.validate_release_readiness', '1.0', command),
    ).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates authorize_release when the human principal is HUMAN', () => {
    const command = commandEnvelope(
      'release.authorize_release',
      objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d031'),
      {
        releaseReadinessSnapshotRef: snapshotRef(
          'core.release_readiness',
          '018f22e2-7c15-7b2e-8d86-2de956a9d031',
          '018f22e2-7c15-7b2e-8d86-2de956a9d032',
          ZERO_DIGEST,
        ),
        authorizingHumanRef: humanPrincipalRef(),
        actorSnapshotRef: snapshotRef(
          'identity.actor_snapshot',
          '018f22e2-7c15-7b2e-8d86-2de956a9d033',
          '018f22e2-7c15-7b2e-8d86-2de956a9d034',
          ZERO_DIGEST,
        ),
        authorizationDecisionRef: contentAddressedRef(
          'identity.authorization_decision',
          '018f22e2-7c15-7b2e-8d86-2de956a9d035',
          ZERO_DIGEST,
        ),
        authorizedAt: '2026-08-17T00:00:00Z',
      },
    );
    expect(registry.validateOperation('release.authorize_release', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates start_publication_attempt with stable idempotency key', () => {
    const command = commandEnvelope(
      'release.start_publication_attempt',
      objectRef('release.publication_attempt', '018f22e2-7c15-7b2e-8d86-2de956a9d040'),
      attemptPayload('040'),
    );
    expect(registry.validateOperation('release.start_publication_attempt', '1.0', command)).toEqual(
      {
        valid: true,
        errors: [],
      },
    );
  });

  it('validates record_publication_receipt as a Formal Receipt submission', () => {
    const command = commandEnvelope(
      'release.record_publication_receipt',
      objectRef('release.publication_receipt', '018f22e2-7c15-7b2e-8d86-2de956a9d041'),
      {
        receipt: {
          attemptRef: objectRef(
            'release.publication_attempt',
            '018f22e2-7c15-7b2e-8d86-2de956a9d040',
          ),
          destinationId: '018f22e2-7c15-7b2e-8d86-2de956a9d041',
          packageRef: {
            releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d040'),
            packageSnapshotRef: snapshotRef(
              'release.release_package',
              '018f22e2-7c15-7b2e-8d86-2de956a9d040',
              '018f22e2-7c15-7b2e-8d86-2de956a9d042',
              ZERO_DIGEST,
            ),
            packageHash: {
              algorithm: 'SHA-256',
              digest: ZERO_DIGEST,
              canonicalizationVersion: '1',
            },
          },
          rawReceiptRef: contentAddressedRef(
            'integration.raw_external_receipt',
            '018f22e2-7c15-7b2e-8d86-2de956a9d043',
            ZERO_DIGEST,
          ),
          providerResult: { messageId: 'om_destination_message_001' },
          occurredAt: '2026-08-17T00:00:00Z',
          receiptPayloadHash: {
            algorithm: 'SHA-256',
            digest: ZERO_DIGEST,
            canonicalizationVersion: '1',
          },
        },
      },
    );
    expect(
      registry.validateOperation('release.record_publication_receipt', '1.0', command),
    ).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates record_publication_failure with FAILED outcome', () => {
    const command = commandEnvelope(
      'release.record_publication_failure',
      objectRef('release.publication_failure', '018f22e2-7c15-7b2e-8d86-2de956a9d044'),
      {
        failure: {
          attemptRef: objectRef(
            'release.publication_attempt',
            '018f22e2-7c15-7b2e-8d86-2de956a9d040',
          ),
          destinationId: '018f22e2-7c15-7b2e-8d86-2de956a9d041',
          packageRef: {
            releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d040'),
            packageSnapshotRef: snapshotRef(
              'release.release_package',
              '018f22e2-7c15-7b2e-8d86-2de956a9d040',
              '018f22e2-7c15-7b2e-8d86-2de956a9d042',
              ZERO_DIGEST,
            ),
            packageHash: {
              algorithm: 'SHA-256',
              digest: ZERO_DIGEST,
              canonicalizationVersion: '1',
            },
          },
          classification: 'INTEGRATION_DELIVERY_FAILED',
          retryable: true,
          outcome: 'FAILED',
          occurredAt: '2026-08-17T00:00:00Z',
        },
      },
    );
    expect(
      registry.validateOperation('release.record_publication_failure', '1.0', command),
    ).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates complete_release with destination outcomes', () => {
    const command = commandEnvelope(
      'release.complete_release',
      objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d045'),
      {
        completionPolicyRef: versionedRef(
          'policy.completion',
          '018f22e2-7c15-7b2e-8d86-2de956a9d046',
          '018f22e2-7c15-7b2e-8d86-2de956a9d047',
        ),
        destinationOutcomeRefs: [
          contentAddressedRef(
            'release.publication_receipt',
            '018f22e2-7c15-7b2e-8d86-2de956a9d048',
            ZERO_DIGEST,
          ),
          contentAddressedRef(
            'release.publication_failure',
            '018f22e2-7c15-7b2e-8d86-2de956a9d049',
            ZERO_DIGEST,
          ),
        ],
        evaluatedAt: '2026-08-17T00:00:00Z',
      },
    );
    expect(registry.validateOperation('release.complete_release', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates recall_release with HUMAN_ONLY authorization', () => {
    const command = commandEnvelope(
      'release.recall_release',
      objectRef('release.recall', '018f22e2-7c15-7b2e-8d86-2de956a9d050'),
      {
        recallScope: { reason: 'INCORRECT_RELEASE_CONTENT' },
        recallReason: {
          reasonCode: 'RELEASE_RECALL_CONTENT_INCORRECT',
          summary: 'Customer-facing DOCX contained a typo in section 4.2.',
          evidenceRefs: [],
        },
        authorizingHumanRef: humanPrincipalRef(),
        authorizationDecisionRef: contentAddressedRef(
          'identity.authorization_decision',
          '018f22e2-7c15-7b2e-8d86-2de956a9d051',
          ZERO_DIGEST,
        ),
        notificationPolicyRef: versionedRef(
          'policy.notification',
          '018f22e2-7c15-7b2e-8d86-2de956a9d052',
          '018f22e2-7c15-7b2e-8d86-2de956a9d053',
        ),
        recalledAt: '2026-08-17T00:00:00Z',
      },
    );
    expect(registry.validateOperation('release.recall_release', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates cancel_release with justification', () => {
    const command = commandEnvelope(
      'release.cancel_release',
      objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d054'),
      {
        cancelReason: {
          reasonCode: 'RELEASE_CANCEL_DRAFT_OBSOLETE',
          summary: 'Draft superseded by revised Scope.',
          evidenceRefs: [],
        },
        cancelledAt: '2026-08-17T00:00:00Z',
      },
    );
    expect(registry.validateOperation('release.cancel_release', '1.0', command)).toEqual({
      valid: true,
      errors: [],
    });
  });

  // ---- Queries ----------------------------------------------------------

  it('validates get_release payload and its ReleaseView result', () => {
    const query = queryEnvelope('release.get_release', {
      releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d060'),
    });
    const resultData = {
      releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d060'),
      aggregateVersion: 5,
      ...releaseDraftPayload('060'),
      status: 'RELEASED',
      packageRef: {
        releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d060'),
        packageSnapshotRef: snapshotRef(
          'release.release_package',
          '018f22e2-7c15-7b2e-8d86-2de956a9d060',
          '018f22e2-7c15-7b2e-8d86-2de956a9d061',
          ZERO_DIGEST,
        ),
        packageHash: { algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' },
      },
      releaseReadinessSnapshotRef: snapshotRef(
        'core.release_readiness',
        '018f22e2-7c15-7b2e-8d86-2de956a9d062',
        '018f22e2-7c15-7b2e-8d86-2de956a9d063',
        ZERO_DIGEST,
      ),
      authorizationRef: contentAddressedRef(
        'release.release_authorization',
        '018f22e2-7c15-7b2e-8d86-2de956a9d064',
        ZERO_DIGEST,
      ),
      attemptRefs: [
        objectRef('release.publication_attempt', '018f22e2-7c15-7b2e-8d86-2de956a9d065'),
      ],
      receiptRefs: [
        contentAddressedRef(
          'release.publication_receipt',
          '018f22e2-7c15-7b2e-8d86-2de956a9d066',
          ZERO_DIGEST,
        ),
      ],
    };
    expect(registry.validateOperation('release.get_release', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(registry.validateOperationResult('release.get_release', '1.0', resultData)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates get_frozen_package payload and FrozenPackageView result', () => {
    const query = queryEnvelope('release.get_frozen_package', {
      packageRef: {
        releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d070'),
        packageSnapshotRef: snapshotRef(
          'release.release_package',
          '018f22e2-7c15-7b2e-8d86-2de956a9d070',
          '018f22e2-7c15-7b2e-8d86-2de956a9d071',
          ZERO_DIGEST,
        ),
        packageHash: { algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' },
      },
    });
    const resultData = {
      packageRef: {
        releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d070'),
        packageSnapshotRef: snapshotRef(
          'release.release_package',
          '018f22e2-7c15-7b2e-8d86-2de956a9d070',
          '018f22e2-7c15-7b2e-8d86-2de956a9d071',
          ZERO_DIGEST,
        ),
        packageHash: { algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' },
      },
      definition: packagePayload('070').package,
      packagePayloadHash: {
        algorithm: 'SHA-256',
        digest: ZERO_DIGEST,
        canonicalizationVersion: '1',
      },
      frozenAt: '2026-08-17T00:00:00Z',
    };
    expect(registry.validateOperation('release.get_frozen_package', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('release.get_frozen_package', '1.0', resultData),
    ).toEqual({
      valid: true,
      errors: [],
    });
  });

  it('validates get_publication_attempts with outcomes filter and Page result', () => {
    const query = queryEnvelope(
      'release.get_publication_attempts',
      {
        releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d080'),
        destinationIds: ['018f22e2-7c15-7b2e-8d86-2de956a9d081'],
        outcomes: ['SUCCEEDED', 'FAILED', 'UNKNOWN'],
        page: { pageSize: 50, cursor: 'cursor-attempts-rel-801-page-001' },
      },
      'SNAPSHOT_AT_LEAST',
    );
    const resultData = {
      items: [
        {
          attemptRef: objectRef(
            'release.publication_attempt',
            '018f22e2-7c15-7b2e-8d86-2de956a9d082',
          ),
          definition: attemptPayload('080').attempt,
          outcome: 'SUCCEEDED',
          rawReceiptRef: contentAddressedRef(
            'integration.raw_external_receipt',
            '018f22e2-7c15-7b2e-8d86-2de956a9d083',
            ZERO_DIGEST,
          ),
          formalReceiptRef: contentAddressedRef(
            'release.publication_receipt',
            '018f22e2-7c15-7b2e-8d86-2de956a9d084',
            ZERO_DIGEST,
          ),
        },
        {
          attemptRef: objectRef(
            'release.publication_attempt',
            '018f22e2-7c15-7b2e-8d86-2de956a9d085',
          ),
          definition: attemptPayload('085').attempt,
          outcome: 'UNKNOWN',
          failureRef: contentAddressedRef(
            'release.publication_failure',
            '018f22e2-7c15-7b2e-8d86-2de956a9d086',
            ZERO_DIGEST,
          ),
        },
      ],
      snapshotAt: '2026-08-17T00:00:00Z',
      sourceWatermarks: [SOURCE_WATERMARK],
    };
    expect(registry.validateOperation('release.get_publication_attempts', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('release.get_publication_attempts', '1.0', resultData),
    ).toEqual({ valid: true, errors: [] });
  });

  it('validates get_release_receipts with Page<ContentAddressedRef<PublicationReceipt>>', () => {
    const query = queryEnvelope('release.get_release_receipts', {
      releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d090'),
      destinationIds: ['018f22e2-7c15-7b2e-8d86-2de956a9d091'],
      page: { pageSize: 50, cursor: 'cursor-receipts-rel-801-page-001' },
    });
    const resultData = {
      items: [
        contentAddressedRef(
          'release.publication_receipt',
          '018f22e2-7c15-7b2e-8d86-2de956a9d092',
          ZERO_DIGEST,
        ),
      ],
      snapshotAt: '2026-08-17T00:00:00Z',
      sourceWatermarks: [SOURCE_WATERMARK],
    };
    expect(registry.validateOperation('release.get_release_receipts', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('release.get_release_receipts', '1.0', resultData),
    ).toEqual({ valid: true, errors: [] });
  });

  it('validates get_release_impact with optional triggering reference', () => {
    const query = queryEnvelope('release.get_release_impact', {
      releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d0a0'),
      triggeringRef: contentAddressedRef(
        'release.recall',
        '018f22e2-7c15-7b2e-8d86-2de956a9d0a1',
        ZERO_DIGEST,
      ),
    });
    const resultData = {
      releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d0a0'),
      triggeringRefs: [
        contentAddressedRef('release.recall', '018f22e2-7c15-7b2e-8d86-2de956a9d0a1', ZERO_DIGEST),
      ],
      affectedDestinations: ['018f22e2-7c15-7b2e-8d86-2de956a9d0a2'],
      riskClassification: 'release.impact.moderate',
      requiredActions: ['release.notify_destinations'],
      humanInterventionRequired: true,
    };
    expect(registry.validateOperation('release.get_release_impact', '1.0', query)).toEqual({
      valid: true,
      errors: [],
    });
    expect(
      registry.validateOperationResult('release.get_release_impact', '1.0', resultData),
    ).toEqual({
      valid: true,
      errors: [],
    });
  });

  // ---- Events -----------------------------------------------------------

  it('validates the 8 release-publication public events', () => {
    const packageRef = {
      releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d0b0'),
      packageSnapshotRef: snapshotRef(
        'release.release_package',
        '018f22e2-7c15-7b2e-8d86-2de956a9d0b0',
        '018f22e2-7c15-7b2e-8d86-2de956a9d0b1',
        ZERO_DIGEST,
      ),
      packageHash: { algorithm: 'SHA-256', digest: ZERO_DIGEST, canonicalizationVersion: '1' },
    };
    const prepared = eventEnvelope(
      'release.ReleasePrepared',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0b0',
      {
        releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d0b0'),
        packageRef,
        revisionRef: contentAddressedRef(
          'artifact.artifact_revision',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0b0',
          ZERO_DIGEST,
        ),
        approvalBundleSnapshotRef: snapshotRef(
          'quality.approval_bundle_snapshot',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0b0',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0b2',
          ZERO_DIGEST,
        ),
        destinationIds: ['018f22e2-7c15-7b2e-8d86-2de956a9d0b3'],
      },
    );
    expect(registry.validateOperation('release.ReleasePrepared', '1.0', prepared)).toEqual({
      valid: true,
      errors: [],
    });

    const authorized = eventEnvelope(
      'release.ReleaseAuthorized',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0b0',
      {
        releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d0b0'),
        packageRef,
        releaseReadinessSnapshotRef: snapshotRef(
          'core.release_readiness',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0b0',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0b4',
          ZERO_DIGEST,
        ),
        authorizationRef: contentAddressedRef(
          'release.release_authorization',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0b5',
          ZERO_DIGEST,
        ),
        authorizedAt: '2026-08-17T00:00:00Z',
      },
    );
    expect(registry.validateOperation('release.ReleaseAuthorized', '1.0', authorized)).toEqual({
      valid: true,
      errors: [],
    });

    const attemptRequested = eventEnvelope(
      'release.PublicationAttemptRequested',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0b0',
      {
        releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d0b0'),
        packageRef,
        attemptRef: objectRef(
          'release.publication_attempt',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0b6',
        ),
        destinationId: '018f22e2-7c15-7b2e-8d86-2de956a9d0b3',
        externalDeliveryRequestRef: contentAddressedRef(
          'integration.external_delivery_request',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0b7',
          ZERO_DIGEST,
        ),
      },
    );
    expect(
      registry.validateOperation('release.PublicationAttemptRequested', '1.0', attemptRequested),
    ).toEqual({ valid: true, errors: [] });

    const succeeded = eventEnvelope(
      'release.PublicationSucceeded',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0b0',
      {
        releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d0b0'),
        packageRef,
        attemptRef: objectRef(
          'release.publication_attempt',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0b6',
        ),
        destinationId: '018f22e2-7c15-7b2e-8d86-2de956a9d0b3',
        receiptRef: contentAddressedRef(
          'release.publication_receipt',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0b8',
          ZERO_DIGEST,
        ),
        occurredAt: '2026-08-17T00:00:00Z',
      },
    );
    expect(registry.validateOperation('release.PublicationSucceeded', '1.0', succeeded)).toEqual({
      valid: true,
      errors: [],
    });

    const failed = eventEnvelope(
      'release.PublicationFailed',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0b0',
      {
        releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d0b0'),
        packageRef,
        attemptRef: objectRef(
          'release.publication_attempt',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0b6',
        ),
        destinationId: '018f22e2-7c15-7b2e-8d86-2de956a9d0b3',
        outcome: 'UNKNOWN',
        failureRef: contentAddressedRef(
          'release.publication_failure',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0b9',
          ZERO_DIGEST,
        ),
      },
    );
    expect(registry.validateOperation('release.PublicationFailed', '1.0', failed)).toEqual({
      valid: true,
      errors: [],
    });

    const partiallyCompleted = eventEnvelope(
      'release.ReleasePartiallyCompleted',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0b0',
      {
        releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d0b0'),
        packageRef,
        succeededDestinationIds: ['018f22e2-7c15-7b2e-8d86-2de956a9d0b3'],
        pendingOrFailedDestinationIds: ['018f22e2-7c15-7b2e-8d86-2de956a9d0ba'],
        evaluatedAt: '2026-08-17T00:00:00Z',
      },
    );
    expect(
      registry.validateOperation('release.ReleasePartiallyCompleted', '1.0', partiallyCompleted),
    ).toEqual({ valid: true, errors: [] });

    const completed = eventEnvelope(
      'release.ReleaseCompleted',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0b0',
      {
        releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d0b0'),
        packageRef,
        purpose: 'CUSTOMER_DELIVERY',
        revisionRef: contentAddressedRef(
          'artifact.artifact_revision',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0b0',
          ZERO_DIGEST,
        ),
        receiptRefs: [
          contentAddressedRef(
            'release.publication_receipt',
            '018f22e2-7c15-7b2e-8d86-2de956a9d0b8',
            ZERO_DIGEST,
          ),
        ],
        completedAt: '2026-08-17T00:00:00Z',
      },
    );
    expect(registry.validateOperation('release.ReleaseCompleted', '1.0', completed)).toEqual({
      valid: true,
      errors: [],
    });

    const recalled = eventEnvelope(
      'release.ReleaseRecalled',
      '018f22e2-7c15-7b2e-8d86-2de956a9d0b0',
      {
        releaseRef: objectRef('release.release', '018f22e2-7c15-7b2e-8d86-2de956a9d0b0'),
        packageRef,
        recallRef: contentAddressedRef(
          'release.recall',
          '018f22e2-7c15-7b2e-8d86-2de956a9d0bb',
          ZERO_DIGEST,
        ),
        affectedDestinationIds: ['018f22e2-7c15-7b2e-8d86-2de956a9d0b3'],
        recalledAt: '2026-08-17T00:00:00Z',
      },
    );
    expect(registry.validateOperation('release.ReleaseRecalled', '1.0', recalled)).toEqual({
      valid: true,
      errors: [],
    });
  });

  // ===========================================================================
  // Negative / forbidden scenarios (using disk fixtures)
  // ===========================================================================

  it('rejects Agent principalKind in authorize_release.authorizingHumanRef (schema-level HUMAN_ONLY guard)', () => {
    // Schema layer: payload.authorizingHumanRef.principalKind must equal HUMAN.
    // The full Agent/actingFor authorization invariant (ActorSnapshot + actor envelope)
    // is enforced at runtime; see RP-API-C-001 in Module-Test-006 for the runtime TODO.
    const command = fixture('release-authorize-release-command-agent-forbidden.json');
    const result = registry.validateOperation('release.authorize_release', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.keyword === 'const' && error.instancePath.includes('principalKind'),
      ),
    ).toBe(true);
  });

  it('rejects Agent principalKind in recall_release.authorizingHumanRef (schema-level HUMAN_ONLY guard)', () => {
    // Schema layer: payload.authorizingHumanRef.principalKind must equal HUMAN.
    // The full Agent/actingFor authorization invariant is enforced at runtime;
    // see RP-API-C-001 in Module-Test-006 for the runtime TODO.
    const command = fixture('release-recall-release-command-agent-forbidden.json');
    const result = registry.validateOperation('release.recall_release', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.keyword === 'const' && error.instancePath.includes('principalKind'),
      ),
    ).toBe(true);
  });

  it('rejects publication failure submissions whose outcome is not FAILED or UNKNOWN', () => {
    const command = fixture('release-record-publication-failure-command-illegal-outcome.json');
    const result = registry.validateOperation('release.record_publication_failure', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.keyword === 'enum' && error.instancePath.includes('outcome'),
      ),
    ).toBe(true);
  });

  it('requires publication failure submissions to carry an occurredAt timestamp', () => {
    // Regression for review P1: Module-Spec-006 §2 declares occurredAt as required;
    // ensure the schema rejects submissions that omit it.
    const command = fixture('release-record-publication-failure-command-missing-occurred-at.json');
    const result = registry.validateOperation('release.record_publication_failure', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.keyword === 'required' &&
          error.instancePath === '/payload/failure' &&
          (error.params as { missingProperty?: string }).missingProperty === 'occurredAt',
      ),
    ).toBe(true);
  });

  it('requires formal receipt submissions to carry a rawReceiptRef pointer (duplicate / late raw-observation prerequisite)', () => {
    // Schema layer prerequisite for duplicate / late receipt detection: the
    // payload must reference the raw external observation via rawReceiptRef, so
    // the runtime Receipt Validator can deduplicate by rawReceiptRef content
    // hash and reject late resubmissions against an already-recorded attempt.
    // Cross-aggregate dedup is a runtime concern (see RP-API-U-003 / IM-RP-001);
    // the schema only guarantees the structural hook is mandatory.
    const command = fixture(
      'release-record-publication-receipt-command-missing-raw-receipt-ref.json',
    );
    const result = registry.validateOperation('release.record_publication_receipt', '1.0', command);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) =>
          error.keyword === 'required' &&
          error.instancePath === '/payload/receipt' &&
          (error.params as { missingProperty?: string }).missingProperty === 'rawReceiptRef',
      ),
    ).toBe(true);
  });

  it('rejects PublicationFailed events whose outcome carries a non-FAILED / non-UNKNOWN value', () => {
    const event = fixture('release-publication-failed-event-illegal-outcome.json');
    const result = registry.validateOperation('release.PublicationFailed', '1.0', event);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (error) => error.keyword === 'enum' && error.instancePath.includes('outcome'),
      ),
    ).toBe(true);
  });

  it('rejects presigned download URLs in PublicationAttemptRequested events', () => {
    const event = fixture('release-publication-attempt-requested-event-presigned-url.json');
    const result = registry.validateOperation('release.PublicationAttemptRequested', '1.0', event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });

  it('enforces additionalProperties closure on the receipt envelope (recipient details leak)', () => {
    // Schema layer: `formalReceiptSubmission` rejects unknown fields placed at the
    // receipt top level. providerResult itself remains CanonicalJson by Module-Spec-006 §2;
    // deeper providerResult-level minimization (e.g. recipient PII inside providerResult)
    // is a runtime concern. See RP-API-C-005 in Module-Test-006 for the runtime TODO.
    const command = fixture(
      'release-record-publication-receipt-command-recipient-details-leak.json',
    );
    const result = registry.validateOperation('release.record_publication_receipt', '1.0', command);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });

  it('rejects unauthorized file body content nested in a PublicationSucceeded event', () => {
    const event = fixture('release-publication-succeeded-event-file-body-leak.json');
    const result = registry.validateOperation('release.PublicationSucceeded', '1.0', event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });

  it('enforces additionalProperties closure on PublicationSucceeded (unknown-field rejection)', () => {
    // Schema layer: PublicationSucceeded rejects any unknown field placed at the
    // event payload top level. The plain Feishu send vs. formal Release provenance
    // check (proving that an unauthorized integration-gateway message cannot impersonate
    // a Formal Receipt) is a runtime concern; see RP-API-E-002 in Module-Test-006.
    const event = fixture('release-publication-succeeded-event-plain-feishu-send.json');
    const result = registry.validateOperation('release.PublicationSucceeded', '1.0', event);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });

  it('rejects ReleaseView result data carrying an unauthorized document body field', () => {
    const resultData = {
      ...fixture('release-get-release-result-valid.json'),
      approvedDocumentBody: 'must-not-leak',
    };
    const result = registry.validateOperationResult('release.get_release', '1.0', resultData);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.keyword === 'additionalProperties')).toBe(true);
  });
});
