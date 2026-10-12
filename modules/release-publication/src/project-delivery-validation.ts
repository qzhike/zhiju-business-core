// D12 / Q11 (#272): pure structural validation of the project-delivery contract.
//
// Scope boundary: this module proves only that a declared batch manifest and its
// archive materials are structurally valid and mutually consistent. It can never
// certify current approval, policy applicability, companion completeness,
// authorization or authoritative object existence; those facts belong to the
// owning readers/handlers that this slice does not build.
//
// Nothing here reads another module's Repository: every check uses the supplied
// exact materials and their declared identity / Scope / hash / checksum
// bindings. Where a binding can only be decided by resolving an owning fact
// (Policy version Scope legality, the RecipientScope snapshot object type, the
// still-unregistered D14 report snapshot type), the declaration keeps its
// owning-resolution boundary instead of being guessed here.

import type { Common, ReleasePublication } from '@zhiju/contracts';
import { canonicalize, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import { sameContentHash } from './package-hash.js';
import {
  archiveDescriptorHash,
  archiveValidationHash,
  batchManifestHash,
  PROJECT_DELIVERY_ARCHIVE_DESCRIPTOR_VERSION,
  PROJECT_DELIVERY_ARCHIVE_INVALID,
  PROJECT_DELIVERY_ARCHIVE_VALIDATION_OUTCOME,
  PROJECT_DELIVERY_EXPORT_MEDIA_TYPE,
  PROJECT_DELIVERY_HASH_MISMATCH,
  PROJECT_DELIVERY_MANIFEST_INVALID,
  PROJECT_DELIVERY_MANIFEST_VERSION,
  PROJECT_DELIVERY_REPRESENTATION_FORMAT,
  PROJECT_DELIVERY_REPRESENTATION_MEDIA_TYPE,
  PROJECT_DELIVERY_ZIP_PROFILE_VERSION,
  projectDeliveryBytesChecksum,
  sameContentAddressedIdentity,
  sameObjectIdentity,
  sameTypedIdentity,
  type ReferenceIdentity,
} from './project-delivery-hash.js';

type Manifest = ReleasePublication.ProjectDeliveryManifest;
type Entry = ReleasePublication.ProjectDeliveryEntry;
type ArchiveDescriptor = ReleasePublication.ProjectDeliveryArchiveDescriptor;
type ArchiveValidation = ReleasePublication.ProjectDeliveryArchiveValidation;
type ArchiveRef = ReleasePublication.ProjectDeliveryArchiveRef;

type ReferenceKind = 'OBJECT' | 'VERSIONED' | 'CONTENT_ADDRESSED' | 'SNAPSHOT';

/**
 * Legal Scope form for one reference. `PROJECT` requires both Scope members,
 * `ENTERPRISE_ONLY` rejects a fabricated `projectId` on an enterprise-scoped
 * aggregate and `ENTERPRISE` requires the real enterprise identity while
 * leaving `projectId` to the owning resolution.
 */
type ScopeExpectation = 'PROJECT' | 'ENTERPRISE_ONLY' | 'ENTERPRISE';

interface ReferenceExpectation {
  readonly kind: ReferenceKind;
  readonly objectType?: string;
  readonly scope: ScopeExpectation;
}

// Mirrors the closed `release-publication` module schemas (REL §14.2). Repeated
// here because this pure validator must also reject an object that carries the
// right TypeScript shape but the wrong declared identity or Scope.
const PROJECT: ReferenceExpectation = {
  kind: 'OBJECT',
  objectType: 'zhiju.project.project',
  scope: 'PROJECT',
};
const DELIVERY_PLAN: ReferenceExpectation = {
  kind: 'VERSIONED',
  objectType: 'zhiju.project.delivery_plan',
  scope: 'PROJECT',
};
const BATCH_OBJECT: ReferenceExpectation = {
  kind: 'OBJECT',
  objectType: 'release.project_delivery_batch',
  scope: 'PROJECT',
};
const BATCH_IDENTITY: ReferenceExpectation = {
  kind: 'CONTENT_ADDRESSED',
  objectType: 'release.project_delivery_batch',
  scope: 'PROJECT',
};
const POLICY: ReferenceExpectation = {
  kind: 'VERSIONED',
  objectType: 'zhiju.identity.policy',
  scope: 'ENTERPRISE',
};
const PROJECT_SCOPED_SNAPSHOT: ReferenceExpectation = { kind: 'SNAPSHOT', scope: 'PROJECT' };

const ARCHIVE_PATH_PATTERN = /^files\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.md$/u;
const OBJECT_LOCATOR_PATTERN = /^[a-z0-9][a-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+$/u;

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function scopeOf(reference: unknown): Common.ScopeRef {
  return record(record(reference).scope);
}

function assertReference(
  reference: unknown,
  expectation: ReferenceExpectation,
  code: string,
): void {
  const value = record(reference);
  if (value.kind !== expectation.kind) throw new Error(code);
  if (expectation.objectType !== undefined && value.objectType !== expectation.objectType) {
    throw new Error(code);
  }
  const scope = scopeOf(reference);
  const enterpriseId = text(scope.enterpriseId);
  const projectId = text(scope.projectId);
  if (projectId !== '' && enterpriseId === '') throw new Error(code);
  if (expectation.scope === 'PROJECT' && (enterpriseId === '' || projectId === '')) {
    throw new Error(code);
  }
  if (expectation.scope === 'ENTERPRISE_ONLY' && (enterpriseId === '' || projectId !== '')) {
    throw new Error(code);
  }
  if (expectation.scope === 'ENTERPRISE' && enterpriseId === '') throw new Error(code);
}

/** Full identity key used to reject duplicate Artifact and path identities. */
function projectIdentityKey(reference: Common.ObjectRef): string {
  const scope = scopeOf(reference);
  return [
    reference.objectType,
    reference.objectId,
    text(scope.enterpriseId),
    text(scope.projectId),
  ].join('|');
}

/**
 * A declared identity set must already be duplicate-free: stable ordering must
 * never silently collapse two distinct declared identities.
 */
function assertUniqueIdentities(values: readonly unknown[], code: string): void {
  const identities = values.map((value) => canonicalize(value as CanonicalJsonValue));
  if (new Set(identities).size !== identities.length) throw new Error(code);
}

/**
 * Compare one declared constant of a supplied object. The closed schema already
 * pins these values, but the pure validator must also reject an unmodelled
 * caller object that never passed a schema check.
 */
function assertDeclaredValue(value: unknown, expected: string, code: string): void {
  if (value !== expected) throw new Error(code);
}

function sameVersionedIdentity(left: Common.VersionedRef, right: Common.VersionedRef): boolean {
  return sameObjectIdentity(left, right) && left.versionId === right.versionId;
}

/** The first-version safe path is derived from identity, never from a filename. */
function expectedArchivePath(entry: Entry): string {
  return `files/${entry.artifactRef.objectId}/${entry.revisionRef.objectId}.md`;
}

function assertSafeArchivePath(archivePath: string, code: string): void {
  if (
    !ARCHIVE_PATH_PATTERN.test(archivePath) ||
    archivePath.includes('//') ||
    archivePath.includes('\\') ||
    archivePath.includes('..')
  ) {
    throw new Error(code);
  }
}

function assertSharedScope(
  references: readonly ReferenceIdentity[],
  projectScope: Common.ScopeRef,
  code: string,
): void {
  for (const reference of references) {
    const scope = scopeOf(reference);
    if (
      text(scope.enterpriseId) !== text(projectScope.enterpriseId) ||
      text(scope.projectId) !== text(projectScope.projectId)
    ) {
      throw new Error(code);
    }
  }
}

/**
 * Every *declared* Scope member of a reference must agree with the batch Scope.
 * Undeclared members are never fabricated: an Artifact-owned provenance member
 * may legitimately be enterprise- or platform-scoped, and ownership is not a
 * machine-registered fact in this contract family.
 */
function assertDeclaredScopeConsistency(
  reference: unknown,
  projectScope: Common.ScopeRef,
  code: string,
): void {
  const scope = scopeOf(reference);
  const enterpriseId = text(scope.enterpriseId);
  const projectId = text(scope.projectId);
  if (enterpriseId !== '' && enterpriseId !== text(projectScope.enterpriseId)) {
    throw new Error(code);
  }
  if (projectId !== '' && projectId !== text(projectScope.projectId)) throw new Error(code);
}

/**
 * Legal Scope form per registered owning object type for the Artifact-owned
 * `RevisionProvenance` members. `PROJECT` requires both Scope members and
 * equality with this batch, because the owning Domain defines those objects with
 * an Enterprise/Project Scope (Task, WorkOrder, Run, AgentResult, ContextSnapshot
 * and project source material); `DECLARED` keeps the declared-member rule for
 * Identity-owned principals and for Enterprise/Platform configuration such as a
 * template baseline or a regulatory profile. An object type that is not listed
 * here is not a machine-registered ownership fact, so only its declared members
 * are compared instead of fabricating a Scope it may legally omit.
 */
const PROVENANCE_SCOPE_BY_OBJECT_TYPE: Readonly<Record<string, 'PROJECT' | 'DECLARED'>> = {
  'zhiju.execution.task': 'PROJECT',
  'zhiju.execution.work_order': 'PROJECT',
  'zhiju.execution.run': 'PROJECT',
  'zhiju.execution.agent_result': 'PROJECT',
  'zhiju.execution.context_snapshot': 'PROJECT',
  'zhiju.project.source_material': 'PROJECT',
};

/**
 * The RevisionProvenance members an entry stores. Artifact owns this definition,
 * so the entry consumes them as open references; the D12 consumption boundary
 * still requires the Scope form of each member's owning object type.
 */
function entryProvenanceReferences(entry: Entry): readonly ReferenceIdentity[] {
  const provenance = entry.provenance.revisionProvenance;
  return [
    provenance.principal,
    provenance.actingForRef,
    provenance.taskRef,
    provenance.workOrderRef,
    provenance.runRef,
    provenance.agentResultRef,
    provenance.contextSnapshotRef,
    provenance.templateBaselineRef,
    provenance.regulatoryProfileRef,
    ...provenance.sourceMaterialRefs,
  ].filter((reference) => reference !== undefined);
}

function entryProjectReferences(entry: Entry): readonly ReferenceIdentity[] {
  return [
    entry.artifactRef,
    entry.revisionRef,
    entry.representationRef.revision,
    entry.revisionAcceptanceSnapshotRef,
    entry.approvalBundleSnapshotRef,
    entry.releaseRef,
    entry.releasePackageRef.releaseRef,
    entry.releasePackageRef.packageSnapshotRef,
    entry.releaseReadinessSnapshotRef,
    entry.releaseAuthorizationRef,
  ];
}

function assertEntryStructure(entry: Entry, projectScope: Common.ScopeRef): void {
  const code = PROJECT_DELIVERY_MANIFEST_INVALID;
  assertReference(
    entry.artifactRef,
    { kind: 'OBJECT', objectType: 'artifact.artifact', scope: 'PROJECT' },
    code,
  );
  assertReference(
    entry.revisionRef,
    { kind: 'CONTENT_ADDRESSED', objectType: 'artifact.artifact_revision', scope: 'PROJECT' },
    code,
  );
  assertReference(
    entry.representationRef.revision,
    { kind: 'CONTENT_ADDRESSED', scope: 'PROJECT' },
    code,
  );
  assertReference(
    entry.qualityProfileRef,
    { kind: 'VERSIONED', objectType: 'quality.quality_profile', scope: 'ENTERPRISE_ONLY' },
    code,
  );
  assertDeclaredScopeConsistency(entry.qualityProfileRef, projectScope, code);
  assertReference(
    entry.revisionAcceptanceSnapshotRef,
    { kind: 'SNAPSHOT', objectType: 'quality.revision_acceptance_snapshot', scope: 'PROJECT' },
    code,
  );
  assertReference(
    entry.approvalBundleSnapshotRef,
    { kind: 'SNAPSHOT', objectType: 'quality.approval_bundle_snapshot', scope: 'PROJECT' },
    code,
  );
  assertReference(
    entry.releaseRef,
    { kind: 'OBJECT', objectType: 'release.release', scope: 'PROJECT' },
    code,
  );
  assertReference(
    entry.releasePackageRef.packageSnapshotRef,
    { kind: 'SNAPSHOT', objectType: 'release.release_package', scope: 'PROJECT' },
    code,
  );
  assertReference(entry.releaseReadinessSnapshotRef, PROJECT_SCOPED_SNAPSHOT, code);
  assertReference(
    entry.releaseAuthorizationRef,
    { kind: 'CONTENT_ADDRESSED', objectType: 'release.release_authorization', scope: 'PROJECT' },
    code,
  );

  if (entry.deliveryItemIds.length === 0) throw new Error(code);
  assertUniqueIdentities(entry.deliveryItemIds, code);
  if (entry.chapterBindings.length === 0) throw new Error(code);
  assertUniqueIdentities(entry.chapterBindings, code);
  assertUniqueIdentities(entry.provenance.sourceReportRefs, code);

  // The packaged representation must be the entry's Markdown representation of
  // exactly the declared Revision: the first version packages one registered
  // Markdown file per Artifact and performs no DOCX/XLSX/PDF conversion.
  assertDeclaredValue(entry.representationRef.format, PROJECT_DELIVERY_REPRESENTATION_FORMAT, code);
  assertDeclaredValue(
    entry.representationRef.mediaType,
    PROJECT_DELIVERY_REPRESENTATION_MEDIA_TYPE,
    code,
  );
  if (!sameContentAddressedIdentity(entry.representationRef.revision, entry.revisionRef)) {
    throw new Error(code);
  }
  // The frozen Package must be the Package of the entry's own Release.
  if (!sameObjectIdentity(entry.releasePackageRef.releaseRef, entry.releaseRef)) {
    throw new Error(code);
  }

  assertSafeArchivePath(entry.archivePath, code);
  if (entry.archivePath !== expectedArchivePath(entry)) throw new Error(code);

  assertSharedScope(entryProjectReferences(entry), projectScope, code);
  // Provenance is read back from the Artifact-owned Revision and the
  // EnterpriseProject-owned accepted reports. A Project-owned execution source
  // must carry the full Project Scope of this batch; a member whose owning type
  // is Identity- or Enterprise/Platform-scoped only has to keep the Scope
  // members it declares consistent with this batch.
  for (const reference of entryProvenanceReferences(entry)) {
    if (PROVENANCE_SCOPE_BY_OBJECT_TYPE[reference.objectType] === 'PROJECT') {
      assertSharedScope([reference], projectScope, code);
    } else {
      assertDeclaredScopeConsistency(reference, projectScope, code);
    }
  }
  for (const reportRef of entry.provenance.sourceReportRefs) {
    assertReference(reportRef, PROJECT_SCOPED_SNAPSHOT, code);
    assertSharedScope([reportRef], projectScope, code);
  }
}

function assertDestinations(manifest: Manifest, projectScope: Common.ScopeRef): void {
  const code = PROJECT_DELIVERY_MANIFEST_INVALID;
  const destinationIds = new Set<string>();
  for (const destination of manifest.destinations) {
    if (destinationIds.has(destination.destinationId)) throw new Error(code);
    destinationIds.add(destination.destinationId);
    if (!sameVersionedIdentity(destination.deliveryPolicyRef, manifest.exportPolicyRef)) {
      throw new Error(code);
    }
    assertReference(destination.recipientScopeRef, PROJECT_SCOPED_SNAPSHOT, code);
    assertSharedScope([destination.recipientScopeRef], projectScope, code);
  }
}

function assertDependencyProof(manifest: Manifest, projectScope: Common.ScopeRef): void {
  const code = PROJECT_DELIVERY_MANIFEST_INVALID;
  const { dependencyProof } = manifest;
  if (dependencyProof.ruleRefs.length === 0) throw new Error(code);
  assertUniqueIdentities(dependencyProof.ruleRefs, code);
  assertUniqueIdentities(dependencyProof.requiredItemIds, code);
  assertUniqueIdentities(dependencyProof.coveredItemIds, code);
  for (const ruleRef of dependencyProof.ruleRefs) {
    assertReference(ruleRef, POLICY, code);
    assertDeclaredScopeConsistency(ruleRef, projectScope, code);
  }
  // The export Policy is one of the delivered-companion rules; a QualityProfile
  // disguised as a Policy rule is rejected by the Policy expectation above.
  if (
    !dependencyProof.ruleRefs.some((ruleRef) =>
      sameVersionedIdentity(ruleRef, manifest.exportPolicyRef),
    )
  ) {
    throw new Error(code);
  }

  const covered = new Set(dependencyProof.coveredItemIds);
  for (const requiredItemId of dependencyProof.requiredItemIds) {
    if (!covered.has(requiredItemId)) throw new Error(code);
  }
  for (const entry of manifest.entries) {
    for (const deliveryItemId of entry.deliveryItemIds) {
      if (!covered.has(deliveryItemId)) throw new Error(code);
    }
  }
}

/**
 * Structural validation of one declared batch manifest: one Project and exact
 * Plan, one entry per Artifact identity, merged shared-Item associations, unique
 * derived safe paths, and internally consistent declared ref sets.
 */
export function validateProjectDeliveryManifest(manifest: Manifest): void {
  const code = PROJECT_DELIVERY_MANIFEST_INVALID;
  assertDeclaredValue(manifest.manifestVersion, PROJECT_DELIVERY_MANIFEST_VERSION, code);

  assertReference(manifest.projectRef, PROJECT, code);
  assertReference(manifest.deliveryPlanRef, DELIVERY_PLAN, code);
  assertReference(manifest.batchRef, BATCH_OBJECT, code);
  assertReference(manifest.recipientScopeSnapshotRef, PROJECT_SCOPED_SNAPSHOT, code);
  assertReference(manifest.exportPolicyRef, POLICY, code);

  if (manifest.entries.length === 0 || manifest.destinations.length === 0) throw new Error(code);

  const projectScope = scopeOf(manifest.projectRef);
  assertDeclaredScopeConsistency(manifest.exportPolicyRef, projectScope, code);
  const artifactIdentities = new Set<string>();
  const archivePaths = new Set<string>();
  for (const entry of manifest.entries) {
    const artifactIdentity = projectIdentityKey(entry.artifactRef);
    if (artifactIdentities.has(artifactIdentity)) throw new Error(code);
    artifactIdentities.add(artifactIdentity);
    if (archivePaths.has(entry.archivePath)) throw new Error(code);
    archivePaths.add(entry.archivePath);
    assertEntryStructure(entry, projectScope);
  }

  assertSharedScope(
    [manifest.batchRef, manifest.deliveryPlanRef, manifest.recipientScopeSnapshotRef],
    projectScope,
    code,
  );
  assertDestinations(manifest, projectScope);
  assertDependencyProof(manifest, projectScope);
}

/**
 * Structural validation of one declared archive descriptor. The descriptor holds
 * the OBJECT archive identity, so it cannot embed its own CONTENT_ADDRESSED
 * identity or hash.
 */
export function validateProjectDeliveryArchiveDescriptor(descriptor: ArchiveDescriptor): void {
  const code = PROJECT_DELIVERY_ARCHIVE_INVALID;
  assertDeclaredValue(
    descriptor.descriptorVersion,
    PROJECT_DELIVERY_ARCHIVE_DESCRIPTOR_VERSION,
    code,
  );
  assertDeclaredValue(descriptor.mediaType, PROJECT_DELIVERY_EXPORT_MEDIA_TYPE, code);
  assertDeclaredValue(descriptor.archiveProfileVersion, PROJECT_DELIVERY_ZIP_PROFILE_VERSION, code);
  assertReference(
    descriptor.archiveRef,
    { kind: 'OBJECT', objectType: 'release.project_delivery_archive', scope: 'PROJECT' },
    code,
  );
  assertReference(descriptor.batchRef, BATCH_IDENTITY, code);
  assertReference(
    descriptor.validationFactRef,
    {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'release.project_delivery_archive_validation',
      scope: 'PROJECT',
    },
    code,
  );
  if (descriptor.entryChecksums.length === 0) throw new Error(code);
  if (!OBJECT_LOCATOR_PATTERN.test(descriptor.objectRef)) throw new Error(code);
  if (descriptor.storageVersion === '') throw new Error(code);

  const projectScope = scopeOf(descriptor.archiveRef);
  assertSharedScope([descriptor.batchRef, descriptor.validationFactRef], projectScope, code);
  assertArchivePaths(descriptor.entryChecksums, code);
}

/**
 * Structural validation of one archive-validation fact. The validation payload
 * excludes its own CONTENT_ADDRESSED identity and the final descriptor, so no
 * hash cycle can be declared here.
 */
export function validateProjectDeliveryArchiveValidation(validation: ArchiveValidation): void {
  const code = PROJECT_DELIVERY_ARCHIVE_INVALID;
  assertDeclaredValue(validation.outcome, PROJECT_DELIVERY_ARCHIVE_VALIDATION_OUTCOME, code);
  assertDeclaredValue(validation.archiveProfileVersion, PROJECT_DELIVERY_ZIP_PROFILE_VERSION, code);
  assertReference(
    validation.attemptRef,
    { kind: 'OBJECT', objectType: 'release.project_delivery_export_attempt', scope: 'PROJECT' },
    code,
  );
  assertReference(validation.batchRef, BATCH_IDENTITY, code);
  if (validation.entryChecksums.length === 0) throw new Error(code);
  if (!OBJECT_LOCATOR_PATTERN.test(validation.objectRef)) throw new Error(code);
  if (validation.storageVersion === '' || validation.validatorVersion === '') {
    throw new Error(code);
  }

  const projectScope = scopeOf(validation.attemptRef);
  assertSharedScope([validation.batchRef], projectScope, code);
  assertArchivePaths(validation.entryChecksums, code);
}

function assertArchivePaths(
  entryChecksums: readonly ReleasePublication.ProjectDeliveryEntryChecksum[],
  code: string,
): void {
  const paths = new Set<string>();
  for (const item of entryChecksums) {
    if (item.archivePath === 'manifest.md') throw new Error(code);
    assertSafeArchivePath(item.archivePath, code);
    if (paths.has(item.archivePath)) throw new Error(code);
    paths.add(item.archivePath);
  }
}

export interface ProjectDeliveryArchiveMaterials {
  readonly manifest: Manifest;
  readonly archiveRef: ArchiveRef;
  readonly descriptor: ArchiveDescriptor;
  readonly validation: ArchiveValidation;
  /** Supplied together with the descriptor, the derived manifest Markdown bytes. */
  readonly manifestMarkdownBytes?: string | Uint8Array;
  /** Supplied together with the descriptor, the exact fixed ZIP bytes. */
  readonly zipBytes?: string | Uint8Array;
}

/**
 * Check the exact identity/Scope/hash/checksum bindings of materials supplied
 * together: manifest, archive identity, descriptor and validation fact, plus the
 * manifest Markdown and ZIP bytes when the caller has them. No owning repository
 * is consulted.
 */
export function validateProjectDeliveryArchiveMaterials(
  materials: ProjectDeliveryArchiveMaterials,
): void {
  const { manifest, archiveRef, descriptor, validation } = materials;
  validateProjectDeliveryManifest(manifest);
  validateProjectDeliveryArchiveDescriptor(descriptor);
  validateProjectDeliveryArchiveValidation(validation);

  const mismatch = PROJECT_DELIVERY_HASH_MISMATCH;
  assertReference(
    archiveRef,
    {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'release.project_delivery_archive',
      scope: 'PROJECT',
    },
    PROJECT_DELIVERY_ARCHIVE_INVALID,
  );

  // OBJECT archive identity versus CONTENT_ADDRESSED archive identity: the two
  // share type/id/Scope by definition and their kinds are asserted above.
  if (!sameTypedIdentity(descriptor.archiveRef, archiveRef)) throw new Error(mismatch);
  if (
    text(scopeOf(archiveRef).enterpriseId) !== text(scopeOf(manifest.projectRef).enterpriseId) ||
    text(scopeOf(archiveRef).projectId) !== text(scopeOf(manifest.projectRef).projectId)
  ) {
    throw new Error(mismatch);
  }

  // Both declared Batch identities must bind this manifest: the same type/id/
  // Scope *and* the same batchManifestHash. A hash-free identity comparison
  // would accept one Batch identity carrying two different manifest hashes.
  const expectedBatchManifestHash = batchManifestHash(manifest);
  for (const batchRef of [descriptor.batchRef, validation.batchRef]) {
    if (!sameTypedIdentity(batchRef, manifest.batchRef)) throw new Error(mismatch);
    if (!sameContentHash(batchRef.contentHash, expectedBatchManifestHash)) {
      throw new Error(mismatch);
    }
  }
  if (!sameContentHash(descriptor.batchManifestHash, expectedBatchManifestHash)) {
    throw new Error(mismatch);
  }
  if (!sameContentHash(archiveRef.contentHash, archiveDescriptorHash(descriptor))) {
    throw new Error(mismatch);
  }
  if (
    !sameContentHash(descriptor.validationFactRef.contentHash, archiveValidationHash(validation))
  ) {
    throw new Error(mismatch);
  }

  // The validation fact and the descriptor must declare the same materials.
  if (descriptor.entryChecksums.length !== validation.entryChecksums.length)
    throw new Error(mismatch);
  const validationChecksums = new Map(
    validation.entryChecksums.map((item) => [item.archivePath, item.checksum] as const),
  );
  for (const item of descriptor.entryChecksums) {
    const other = validationChecksums.get(item.archivePath);
    if (other === undefined || !sameContentHash(other, item.checksum)) throw new Error(mismatch);
  }
  if (!sameContentHash(descriptor.manifestMarkdownChecksum, validation.manifestMarkdownChecksum)) {
    throw new Error(mismatch);
  }
  if (!sameContentHash(descriptor.zipChecksum, validation.zipChecksum)) throw new Error(mismatch);
  if (descriptor.zipByteSize !== validation.zipByteSize) throw new Error(mismatch);
  assertDeclaredValue(descriptor.archiveProfileVersion, validation.archiveProfileVersion, mismatch);
  if (descriptor.objectRef !== validation.objectRef) throw new Error(mismatch);
  if (descriptor.storageVersion !== validation.storageVersion) throw new Error(mismatch);

  // Every manifest entry must appear exactly once with its representation checksum.
  const entryChecksums = new Map(
    descriptor.entryChecksums.map((item) => [item.archivePath, item.checksum] as const),
  );
  if (entryChecksums.size !== manifest.entries.length) throw new Error(mismatch);
  for (const entry of manifest.entries) {
    const checksum = entryChecksums.get(entry.archivePath);
    if (checksum === undefined || !sameContentHash(checksum, entry.representationRef.checksum)) {
      throw new Error(mismatch);
    }
  }

  // The five domains stay distinct: a manifest hash, a manifest-Markdown
  // checksum, a representation checksum, a ZIP checksum or an archive hash may
  // never be substituted for one another.
  const domainHashes = [
    expectedBatchManifestHash,
    descriptor.manifestMarkdownChecksum,
    descriptor.zipChecksum,
  ];
  const digests = new Set(domainHashes.map((hash) => hash.digest));
  if (digests.size !== domainHashes.length) throw new Error(mismatch);

  if (materials.manifestMarkdownBytes !== undefined) {
    const derived = projectDeliveryBytesChecksum(materials.manifestMarkdownBytes);
    if (!sameContentHash(derived, descriptor.manifestMarkdownChecksum)) throw new Error(mismatch);
  }
  if (materials.zipBytes !== undefined) {
    const derived = projectDeliveryBytesChecksum(materials.zipBytes);
    if (!sameContentHash(derived, descriptor.zipChecksum)) throw new Error(mismatch);
    // The supplied bytes must also prove the exact declared size, not only the
    // checksum: a VERIFIED fact may not over- or under-declare its byte length.
    const byteSize =
      typeof materials.zipBytes === 'string'
        ? Buffer.byteLength(materials.zipBytes, 'utf8')
        : materials.zipBytes.byteLength;
    if (byteSize !== descriptor.zipByteSize || byteSize !== validation.zipByteSize) {
      throw new Error(mismatch);
    }
  }
}

/**
 * Compare the OBJECT batch target with the returned CONTENT_ADDRESSED batch
 * identity and its manifest hash.
 */
export function assertProjectDeliveryBatchIdentity(
  manifest: Manifest,
  batchRef: ReleasePublication.ProjectDeliveryBatchRef,
): void {
  assertReference(manifest.batchRef, BATCH_OBJECT, PROJECT_DELIVERY_MANIFEST_INVALID);
  assertReference(batchRef, BATCH_IDENTITY, PROJECT_DELIVERY_MANIFEST_INVALID);
  if (!sameTypedIdentity(manifest.batchRef, batchRef)) {
    throw new Error(PROJECT_DELIVERY_MANIFEST_INVALID);
  }
  if (!sameContentHash(batchRef.contentHash, batchManifestHash(manifest))) {
    throw new Error(PROJECT_DELIVERY_HASH_MISMATCH);
  }
}

/**
 * Compare the OBJECT archive descriptor target with the returned
 * CONTENT_ADDRESSED archive identity and its descriptor hash.
 */
export function assertProjectDeliveryArchiveIdentity(
  descriptor: ArchiveDescriptor,
  archiveRef: ArchiveRef,
): void {
  assertReference(
    descriptor.archiveRef,
    { kind: 'OBJECT', objectType: 'release.project_delivery_archive', scope: 'PROJECT' },
    PROJECT_DELIVERY_ARCHIVE_INVALID,
  );
  assertReference(
    archiveRef,
    { kind: 'CONTENT_ADDRESSED', objectType: 'release.project_delivery_archive', scope: 'PROJECT' },
    PROJECT_DELIVERY_ARCHIVE_INVALID,
  );
  if (!sameTypedIdentity(descriptor.archiveRef, archiveRef)) {
    throw new Error(PROJECT_DELIVERY_ARCHIVE_INVALID);
  }
  if (!sameContentHash(archiveRef.contentHash, archiveDescriptorHash(descriptor))) {
    throw new Error(PROJECT_DELIVERY_HASH_MISMATCH);
  }
}
