// D12 / Q11 (#272): deterministic project-delivery hash domains (REL §14.4).
//
// These domains are disjoint: the batch manifest, the manifest Markdown bytes,
// each packaged Markdown representation, the fixed ZIP bytes and the archive
// descriptor are hashed independently, so one domain cannot substitute for
// another. The legacy single-Revision `release-package-manifest/1.0` domain in
// `package-hash.ts` is untouched.
//
// Every hash input is rebuilt from the approved REL §14.2 field set instead of
// spreading the caller object, so an unmodelled member can never change a hash
// even when it reached this layer. The closed `release-publication` module
// schemas reject unknown members before that.

import { createHash } from 'node:crypto';
import type { Common, ReleasePublication } from '@zhiju/contracts';
import { canonicalize, type CanonicalJsonValue } from '@zhiju/shared-kernel';

export const PROJECT_DELIVERY_MANIFEST_VERSION = 'project-delivery-batch-manifest/1.0';
export const PROJECT_DELIVERY_ARCHIVE_DESCRIPTOR_VERSION = 'project-delivery-archive/1.0';
export const PROJECT_DELIVERY_ZIP_PROFILE_VERSION = 'project-delivery-zip/1.0';
export const PROJECT_DELIVERY_EXPORT_MEDIA_TYPE = 'application/zip';
export const PROJECT_DELIVERY_ARCHIVE_VALIDATION_OUTCOME = 'VERIFIED';

/** The declared manifest/archive materials contradict each other or a domain. */
export const PROJECT_DELIVERY_MANIFEST_INVALID = 'PROJECT_DELIVERY_MANIFEST_INVALID';
export const PROJECT_DELIVERY_ARCHIVE_INVALID = 'PROJECT_DELIVERY_ARCHIVE_INVALID';
export const PROJECT_DELIVERY_HASH_MISMATCH = 'PROJECT_DELIVERY_HASH_MISMATCH';

type Manifest = ReleasePublication.ProjectDeliveryManifest;
type Entry = ReleasePublication.ProjectDeliveryEntry;
type EntryChecksum = ReleasePublication.ProjectDeliveryEntryChecksum;
type ArchiveDescriptor = ReleasePublication.ProjectDeliveryArchiveDescriptor;
type ArchiveValidation = ReleasePublication.ProjectDeliveryArchiveValidation;

function compareText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function sha256(value: string | Uint8Array): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: createHash('sha256').update(value).digest('hex'),
    canonicalizationVersion: '1',
  };
}

/**
 * Raw-byte checksum domain shared by packaged Markdown representation bytes,
 * the derived manifest Markdown bytes and the fixed ZIP bytes. It never
 * replaces a canonical (cv1) content hash and vice versa.
 */
export function projectDeliveryBytesChecksum(bytes: string | Uint8Array): Common.ContentHash {
  return sha256(bytes);
}

/** Full canonical identity of a typed value, used for the stable UTF-8 ordering. */
function canonicalIdentity(value: unknown): string {
  return canonicalize(value as CanonicalJsonValue);
}

/**
 * Stable UTF-8 ordering by canonical identity with duplicate rejection: sorting
 * must never silently collapse two distinct declared identities.
 */
function orderedUniqueBy<T>(
  values: readonly T[],
  identity: (value: T) => string,
  code: string,
): readonly T[] {
  const seen = new Set<string>();
  const decorated = values.map((value) => {
    const key = identity(value);
    if (seen.has(key)) throw new Error(code);
    seen.add(key);
    return { key, value };
  });
  decorated.sort((left, right) => compareText(left.key, right.key));
  return decorated.map((item) => item.value);
}

function normalizedEntry(entry: Entry): Entry {
  return {
    artifactRef: entry.artifactRef,
    revisionRef: entry.revisionRef,
    representationRef: entry.representationRef,
    deliveryItemIds: orderedUniqueBy(
      entry.deliveryItemIds,
      (deliveryItemId) => deliveryItemId,
      PROJECT_DELIVERY_MANIFEST_INVALID,
    ),
    associationProofHash: entry.associationProofHash,
    chapterBindings: orderedUniqueBy(
      entry.chapterBindings,
      (binding) => canonicalIdentity(binding),
      PROJECT_DELIVERY_MANIFEST_INVALID,
    ),
    provenance: {
      revisionProvenance: entry.provenance.revisionProvenance,
      sourceReportRefs: orderedUniqueBy(
        entry.provenance.sourceReportRefs,
        (reportRef) => canonicalIdentity(reportRef),
        PROJECT_DELIVERY_MANIFEST_INVALID,
      ),
    },
    qualityProfileRef: entry.qualityProfileRef,
    revisionAcceptanceSnapshotRef: entry.revisionAcceptanceSnapshotRef,
    approvalBundleSnapshotRef: entry.approvalBundleSnapshotRef,
    releaseRef: entry.releaseRef,
    releasePackageRef: entry.releasePackageRef,
    releaseReadinessSnapshotRef: entry.releaseReadinessSnapshotRef,
    releaseAuthorizationRef: entry.releaseAuthorizationRef,
    archivePath: entry.archivePath,
  };
}

/**
 * Canonical form of the batch manifest: entries ordered by `archivePath`,
 * destinations by `destinationId`, and every identity set in stable UTF-8
 * semantic order. The manifest keeps its OBJECT `batchRef`; the returned
 * CONTENT_ADDRESSED batch identity and any confirmation/generation/download
 * fact stay outside this domain.
 */
export function normalizeProjectDeliveryManifest(manifest: Manifest): Manifest {
  return {
    manifestVersion: manifest.manifestVersion,
    batchRef: manifest.batchRef,
    projectRef: manifest.projectRef,
    deliveryPlanRef: manifest.deliveryPlanRef,
    recipientScopeSnapshotRef: manifest.recipientScopeSnapshotRef,
    destinations: orderedUniqueBy(
      manifest.destinations,
      (destination) => destination.destinationId,
      PROJECT_DELIVERY_MANIFEST_INVALID,
    ),
    exportPolicyRef: manifest.exportPolicyRef,
    dependencyProof: {
      ruleRefs: orderedUniqueBy(
        manifest.dependencyProof.ruleRefs,
        (ruleRef) => canonicalIdentity(ruleRef),
        PROJECT_DELIVERY_MANIFEST_INVALID,
      ),
      requiredItemIds: orderedUniqueBy(
        manifest.dependencyProof.requiredItemIds,
        (deliveryItemId) => deliveryItemId,
        PROJECT_DELIVERY_MANIFEST_INVALID,
      ),
      coveredItemIds: orderedUniqueBy(
        manifest.dependencyProof.coveredItemIds,
        (deliveryItemId) => deliveryItemId,
        PROJECT_DELIVERY_MANIFEST_INVALID,
      ),
      associationSetHash: manifest.dependencyProof.associationSetHash,
      requirementSetHash: manifest.dependencyProof.requirementSetHash,
    },
    entries: orderedUniqueBy(
      manifest.entries.map(normalizedEntry),
      (entry) => entry.archivePath,
      PROJECT_DELIVERY_MANIFEST_INVALID,
    ),
  };
}

/** Canonical entry-checksum set: one entry per archive path, no duplicates. */
export function normalizeProjectDeliveryEntryChecksums(
  entryChecksums: readonly EntryChecksum[],
): readonly EntryChecksum[] {
  return orderedUniqueBy(
    entryChecksums.map((item) => ({ archivePath: item.archivePath, checksum: item.checksum })),
    (item) => item.archivePath,
    PROJECT_DELIVERY_ARCHIVE_INVALID,
  );
}

export function normalizeProjectDeliveryArchiveValidation(
  validation: ArchiveValidation,
): ArchiveValidation {
  return {
    attemptRef: validation.attemptRef,
    batchRef: validation.batchRef,
    objectRef: validation.objectRef,
    storageVersion: validation.storageVersion,
    archiveProfileVersion: validation.archiveProfileVersion,
    entryChecksums: normalizeProjectDeliveryEntryChecksums(validation.entryChecksums),
    manifestMarkdownChecksum: validation.manifestMarkdownChecksum,
    zipChecksum: validation.zipChecksum,
    zipByteSize: validation.zipByteSize,
    outcome: validation.outcome,
    validatorVersion: validation.validatorVersion,
    validatedAt: validation.validatedAt,
  };
}

/**
 * Canonical descriptor form. `archiveRef` stays the OBJECT archive identity, so
 * the descriptor never embeds its own CONTENT_ADDRESSED identity or hash.
 */
export function normalizeProjectDeliveryArchiveDescriptor(
  descriptor: ArchiveDescriptor,
): ArchiveDescriptor {
  return {
    descriptorVersion: descriptor.descriptorVersion,
    archiveRef: descriptor.archiveRef,
    batchRef: descriptor.batchRef,
    batchManifestHash: descriptor.batchManifestHash,
    manifestMarkdownChecksum: descriptor.manifestMarkdownChecksum,
    zipChecksum: descriptor.zipChecksum,
    entryChecksums: normalizeProjectDeliveryEntryChecksums(descriptor.entryChecksums),
    zipByteSize: descriptor.zipByteSize,
    mediaType: descriptor.mediaType,
    objectRef: descriptor.objectRef,
    storageVersion: descriptor.storageVersion,
    archiveProfileVersion: descriptor.archiveProfileVersion,
    validationFactRef: descriptor.validationFactRef,
    linkedAt: descriptor.linkedAt,
    availableAt: descriptor.availableAt,
  };
}

/** `batchManifestHash`: SHA-256 of the cv1 canonical complete manifest. */
export function batchManifestHash(manifest: Manifest): Common.ContentHash {
  return sha256(canonicalIdentity(normalizeProjectDeliveryManifest(manifest)));
}

/**
 * Archive-validation identity domain. It covers the complete validation payload
 * and excludes both its own CONTENT_ADDRESSED identity and the final descriptor,
 * so the dependency graph stays Manifest → bytes → ZIP → Validation → Descriptor.
 */
export function archiveValidationHash(validation: ArchiveValidation): Common.ContentHash {
  return sha256(canonicalIdentity(normalizeProjectDeliveryArchiveValidation(validation)));
}

/** `archiveDescriptorHash`: SHA-256 of the cv1 canonical complete descriptor. */
export function archiveDescriptorHash(descriptor: ArchiveDescriptor): Common.ContentHash {
  return sha256(canonicalIdentity(normalizeProjectDeliveryArchiveDescriptor(descriptor)));
}

/**
 * Structural identity of any typed reference. `kind` stays part of the
 * comparison so an OBJECT target and a CONTENT_ADDRESSED identity of the same
 * object type can never be treated as the same reference.
 */
export interface ReferenceIdentity {
  readonly kind: string;
  readonly objectType: string;
  readonly objectId: string;
  readonly scope: Common.ScopeRef;
}

/**
 * Identity equality over objectType, objectId and every Scope member. The
 * OBJECT target and the CONTENT_ADDRESSED identity of one immutable fact share
 * exactly this identity; their `kind` is asserted separately by the caller.
 */
export function sameTypedIdentity(left: ReferenceIdentity, right: ReferenceIdentity): boolean {
  return (
    left.objectType === right.objectType &&
    left.objectId === right.objectId &&
    left.scope.enterpriseId === right.scope.enterpriseId &&
    left.scope.projectId === right.scope.projectId
  );
}

/** Full identity equality: kind, objectType, objectId and every Scope member. */
export function sameObjectIdentity(left: ReferenceIdentity, right: ReferenceIdentity): boolean {
  return left.kind === right.kind && sameTypedIdentity(left, right);
}
