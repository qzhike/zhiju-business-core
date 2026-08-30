// IM-05 WI-06 (issue #126): deterministic frozen-package manifest and hash.

import { createHash } from 'node:crypto';
import type { Common, ReleasePublication } from '@zhiju/contracts';
import { canonicalize, type CanonicalJsonValue } from '@zhiju/shared-kernel';

export const PACKAGE_MANIFEST_VERSION = 'release-package-manifest/1.0';

type PackageDefinition = ReleasePublication.ReleasePackageDefinition;
type Selection = ReleasePublication.ReleaseRepresentationSelection;
type Destination = ReleasePublication.ReleaseDestinationDefinition;

export interface CanonicalPackageManifest {
  readonly manifestVersion: typeof PACKAGE_MANIFEST_VERSION;
  readonly releaseRef: Common.ObjectRef;
  readonly canonicalRevisionRef: Common.ContentAddressedRef;
  readonly approvalBundleSnapshotRef: Common.SnapshotRef;
  readonly recipientScopeSnapshotRef: Common.SnapshotRef;
  readonly representations: readonly Selection[];
  readonly destinations: readonly Destination[];
}

export interface PackageHashMaterial {
  readonly manifest: CanonicalPackageManifest;
  readonly canonicalManifest: string;
  readonly expectedPackageHash: Common.ContentHash;
  readonly normalizedDefinition: PackageDefinition;
  readonly canonicalDefinition: string;
  readonly packagePayloadHash: Common.ContentHash;
}

function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function compareSelections(left: Selection, right: Selection): number {
  return (
    left.ordinal - right.ordinal ||
    compareText(
      left.representationRef.representationId,
      right.representationRef.representationId,
    ) ||
    compareText(left.representationRef.checksum.digest, right.representationRef.checksum.digest)
  );
}

function compareDestinations(left: Destination, right: Destination): number {
  return compareText(left.destinationId, right.destinationId);
}

function sha256(value: string): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: createHash('sha256').update(value, 'utf8').digest('hex'),
    canonicalizationVersion: '1',
  };
}

function canonicalJson(value: unknown): string {
  return canonicalize(value as CanonicalJsonValue);
}

function assertUniqueSelections(selections: readonly Selection[]): void {
  const representationIds = new Set<string>();
  const ordinals = new Set<number>();
  for (const selection of selections) {
    if (representationIds.has(selection.representationRef.representationId)) {
      throw new Error('RELEASE_REPRESENTATION_INVALID');
    }
    if (ordinals.has(selection.ordinal)) {
      throw new Error('RELEASE_REPRESENTATION_INVALID');
    }
    representationIds.add(selection.representationRef.representationId);
    ordinals.add(selection.ordinal);
  }
}

function assertUniqueDestinations(destinations: readonly Destination[]): void {
  const destinationIds = new Set<string>();
  for (const destination of destinations) {
    if (destinationIds.has(destination.destinationId)) {
      throw new Error('RELEASE_DESTINATION_INVALID');
    }
    destinationIds.add(destination.destinationId);
  }
}

export function normalizePackageDefinition(
  packageDefinition: PackageDefinition,
): PackageDefinition {
  if (
    packageDefinition.representations.length === 0 ||
    packageDefinition.destinations.length === 0
  ) {
    throw new Error('RELEASE_PACKAGE_EMPTY');
  }
  assertUniqueSelections(packageDefinition.representations);
  assertUniqueDestinations(packageDefinition.destinations);
  return {
    ...packageDefinition,
    representations: [...packageDefinition.representations].sort(compareSelections),
    destinations: [...packageDefinition.destinations].sort(compareDestinations),
  };
}

export function buildPackageHashMaterial(
  packageDefinition: PackageDefinition,
): PackageHashMaterial {
  const normalizedDefinition = normalizePackageDefinition(packageDefinition);
  const manifest: CanonicalPackageManifest = {
    manifestVersion: PACKAGE_MANIFEST_VERSION,
    releaseRef: normalizedDefinition.releaseRef,
    canonicalRevisionRef: normalizedDefinition.canonicalRevisionRef,
    approvalBundleSnapshotRef: normalizedDefinition.approvalBundleSnapshotRef,
    recipientScopeSnapshotRef: normalizedDefinition.recipientScopeSnapshotRef,
    representations: normalizedDefinition.representations,
    destinations: normalizedDefinition.destinations,
  };
  const canonicalManifest = canonicalJson(manifest);
  const canonicalDefinition = canonicalJson(normalizedDefinition);
  return {
    manifest,
    canonicalManifest,
    expectedPackageHash: sha256(canonicalManifest),
    normalizedDefinition,
    canonicalDefinition,
    packagePayloadHash: sha256(canonicalDefinition),
  };
}

export function sameContentHash(left: Common.ContentHash, right: Common.ContentHash): boolean {
  return left.digest === right.digest;
}
