import { describe, expect, it } from 'vitest';
import type { Common, ReleasePublication } from '@zhiju/contracts';
import { buildPackageHashMaterial, PACKAGE_MANIFEST_VERSION } from './package-hash.js';

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const RELEASE = '018f22e2-7c15-7b2e-8d86-2de956a9d203';
const REVISION = '018f22e2-7c15-7b2e-8d86-2de956a9d204';
const APPROVAL = '018f22e2-7c15-7b2e-8d86-2de956a9d205';
const RECIPIENT = '018f22e2-7c15-7b2e-8d86-2de956a9d206';
const REPRESENTATION_A = '018f22e2-7c15-7b2e-8d86-2de956a9d207';
const REPRESENTATION_B = '018f22e2-7c15-7b2e-8d86-2de956a9d208';
const DESTINATION_A = '018f22e2-7c15-7b2e-8d86-2de956a9d209';
const DESTINATION_B = '018f22e2-7c15-7b2e-8d86-2de956a9d20a';

function hash(byte: number): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: Buffer.alloc(32, byte).toString('hex'),
    canonicalizationVersion: '1',
  };
}

function objectRef(objectType: string, objectId: string): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType,
    objectId,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
  };
}

function revisionRef(): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'artifact.artifact_revision',
    objectId: REVISION,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    contentHash: hash(0x11),
  };
}

function snapshotRef(objectType: string, objectId: string, byte: number): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId,
    snapshotId: objectId,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    contentHash: hash(byte),
  };
}

function representation(
  representationId: string,
  ordinal: number,
  checksumByte: number,
): ReleasePublication.ReleaseRepresentationSelection {
  return {
    representationRef: {
      representationId,
      revision: revisionRef(),
      format: ordinal === 1 ? 'DOCX' : 'PDF',
      mediaType: ordinal === 1 ? 'application/vnd.test.docx' : 'application/pdf',
      objectStorageRef: `objects/${representationId}`,
      checksum: hash(checksumByte),
      renderer: { rendererId: 'renderer.test', rendererVersion: '1.0.0' },
      createdAt: '2026-08-31T00:00:00Z',
    },
    ordinal,
    displayName: `Representation ${ordinal}`,
    required: true,
    releaseRole: ordinal === 1 ? 'PRIMARY' : 'SECONDARY',
  };
}

function destination(destinationId: string): ReleasePublication.ReleaseDestinationDefinition {
  return {
    destinationId,
    destinationType: 'FEISHU_DOC',
    destinationRef: {
      system: 'feishu',
      resourceType: 'document',
      externalId: destinationId,
      observedAt: '2026-08-31T00:00:00Z',
    },
    recipientScopeRef: snapshotRef('release.recipient_scope_snapshot', RECIPIENT, 0x31),
    purpose: 'CUSTOMER_DELIVERY',
    required: true,
    requiredReceiptKind: 'PROVIDER_ACK',
    deliveryPolicyRef: {
      kind: 'VERSIONED',
      objectType: 'policy.delivery_policy',
      objectId: '018f22e2-7c15-7b2e-8d86-2de956a9d20b',
      versionId: '018f22e2-7c15-7b2e-8d86-2de956a9d20c',
      scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
    },
  };
}

function packageDefinition(
  preparedAt = '2026-08-31T00:01:00Z',
): ReleasePublication.ReleasePackageDefinition {
  return {
    releaseRef: objectRef('release.release', RELEASE),
    canonicalRevisionRef: revisionRef(),
    representations: [
      representation(REPRESENTATION_B, 2, 0x22),
      representation(REPRESENTATION_A, 1, 0x21),
    ],
    destinations: [destination(DESTINATION_B), destination(DESTINATION_A)],
    recipientScopeSnapshotRef: snapshotRef('release.recipient_scope_snapshot', RECIPIENT, 0x31),
    approvalBundleSnapshotRef: snapshotRef('quality.approval_bundle_snapshot', APPROVAL, 0x32),
    preparedAt,
    packageHash: hash(0xff),
  };
}

describe('ReleasePublication WI-06 package hash', () => {
  it('canonicalizes manifest order and excludes preparation-only fields', () => {
    const first = buildPackageHashMaterial(packageDefinition());
    const second = buildPackageHashMaterial(packageDefinition('2026-08-31T00:02:00Z'));

    expect(first.manifest.manifestVersion).toBe(PACKAGE_MANIFEST_VERSION);
    expect(first.manifest.representations.map((item) => item.ordinal)).toEqual([1, 2]);
    expect(first.manifest.destinations.map((item) => item.destinationId)).toEqual([
      DESTINATION_A,
      DESTINATION_B,
    ]);
    expect(first.expectedPackageHash).toEqual(second.expectedPackageHash);
    expect(first.packagePayloadHash).not.toEqual(second.packagePayloadHash);
    expect(first.canonicalManifest).not.toContain('preparedAt');
    expect(first.canonicalManifest).not.toContain('packageHash');
  });

  it('rejects duplicate representation identity and destination identity', () => {
    expect(() =>
      buildPackageHashMaterial({
        ...packageDefinition(),
        representations: [
          representation(REPRESENTATION_A, 1, 0x21),
          representation(REPRESENTATION_A, 2, 0x22),
        ],
      }),
    ).toThrow('RELEASE_REPRESENTATION_INVALID');
    expect(() =>
      buildPackageHashMaterial({
        ...packageDefinition(),
        destinations: [destination(DESTINATION_A), destination(DESTINATION_A)],
      }),
    ).toThrow('RELEASE_DESTINATION_INVALID');
  });
});
