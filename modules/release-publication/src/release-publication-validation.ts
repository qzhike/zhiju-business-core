// IM-05 WI-06 (issue #126): public-reference and authority-port validation.
// ReleasePublication consumes Artifact and Quality only through these narrow
// query ports; it never reads another module's repository or schema.

import type { Artifact, Common, QualityGovernance, ReleasePublication } from '@zhiju/contracts';
import { canonicalize, isUuidV7, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import { normalizePackageDefinition } from './package-hash.js';
import type {
  FormalAdapterAttemptQueryPort,
  RawExternalReceiptRepository,
} from './receipt-validator.js';
import type { ReleaseTransactionContext } from './persistence/release-publication-db.js';

export const RELEASE_SCOPE_INVALID = 'RELEASE_SCOPE_INVALID';
export const RELEASE_QUERY_NOT_FOUND = 'RELEASE_QUERY_NOT_FOUND';
export const RELEASE_IDENTITY_CONFLICT = 'RELEASE_IDENTITY_CONFLICT';
export const RELEASE_REVISION_NOT_APPROVED = 'RELEASE_REVISION_NOT_APPROVED';
export const RELEASE_APPROVAL_BUNDLE_INVALID = 'RELEASE_APPROVAL_BUNDLE_INVALID';
export const RELEASE_REPRESENTATION_INVALID = 'RELEASE_REPRESENTATION_INVALID';
export const RELEASE_DESTINATION_INVALID = 'RELEASE_DESTINATION_INVALID';
export const RELEASE_PACKAGE_EMPTY = 'RELEASE_PACKAGE_EMPTY';
export const RELEASE_PACKAGE_HASH_MISMATCH = 'RELEASE_PACKAGE_HASH_MISMATCH';
export const RELEASE_PACKAGE_FROZEN = 'RELEASE_PACKAGE_FROZEN';
export const RELEASE_MULTIPLE_PACKAGE_HASHES = 'RELEASE_MULTIPLE_PACKAGE_HASHES';
export const RELEASE_CANCEL_NOT_ALLOWED = 'RELEASE_CANCEL_NOT_ALLOWED';
export const RELEASE_REQUIRED_RECEIPT_MISSING = 'RELEASE_REQUIRED_RECEIPT_MISSING';
export const RELEASE_COMPLETION_CRITERIA_UNSATISFIED = 'RELEASE_COMPLETION_CRITERIA_UNSATISFIED';
export const RELEASE_NOT_AUTHORIZED = 'RELEASE_NOT_AUTHORIZED';
export const RELEASE_RECALL_NOT_AUTHORIZED = 'RELEASE_RECALL_NOT_AUTHORIZED';

export class ReleasePublicationBusinessError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReleasePublicationBusinessError';
  }
}

export interface ArtifactAuthorityQueryPort {
  validateRevisionRef(
    input: Artifact.ArtifactValidateRevisionRefPayload,
  ): Promise<Artifact.ArtifactValidateRevisionRefResult>;
  getRepresentation(
    input: Artifact.ArtifactGetRepresentationPayload,
  ): Promise<Artifact.ArtifactGetRepresentationResult>;
}

export interface QualityAuthorityQueryPort {
  getRevisionAcceptanceSnapshot(
    input: QualityGovernance.QualityGetRevisionAcceptanceSnapshotPayload,
  ): Promise<QualityGovernance.QualityGetRevisionAcceptanceSnapshotResult>;
  getApprovalBundleSnapshot(
    input: QualityGovernance.QualityGetApprovalBundleSnapshotPayload,
  ): Promise<QualityGovernance.QualityGetApprovalBundleSnapshotResult>;
  /** WI-07 exact and current Release Readiness Snapshot query; absent means fail-closed. */
  getReleaseReadinessSnapshot?(
    input: QualityGovernance.QualityGetReleaseReadinessSnapshotPayload,
  ): Promise<QualityGovernance.QualityGetReleaseReadinessSnapshotResult>;
}

export interface ReleaseActorSnapshotFact {
  readonly actorSnapshotRef: Common.SnapshotRef;
  readonly principalRef: Common.PrincipalRef;
  readonly actingForRef?: Common.PrincipalRef;
  readonly authenticationContextHash: Common.ContentHash;
  readonly revokedAt?: string;
}

export interface ReleaseAuthorizationDecisionFact {
  readonly authorizationDecisionRef: Common.ContentAddressedRef;
  readonly actorSnapshotRef: Common.SnapshotRef;
  readonly principalRef: Common.PrincipalRef;
  readonly commandType: string;
  readonly commandVersion: string;
  readonly scope: Common.ScopeRef;
  readonly purpose: string;
  readonly commandPayloadHash?: Common.ContentHash;
  readonly authenticationContextHash: Common.ContentHash;
  readonly outcome: 'ALLOW' | 'DENY';
  readonly expiresAt: string;
  readonly revokedAt?: string;
}

export interface ReleaseIdentityAuthorityQueryPort {
  getActorSnapshot(
    actorSnapshotRef: Common.SnapshotRef,
  ): Promise<ReleaseActorSnapshotFact | undefined>;
  getAuthorizationDecision(
    authorizationDecisionRef: Common.ContentAddressedRef,
  ): Promise<ReleaseAuthorizationDecisionFact | undefined>;
}

export interface ReleaseAuthorityQueryPorts {
  readonly artifact: ArtifactAuthorityQueryPort;
  readonly quality: QualityAuthorityQueryPort;
  /** Identity is optional in the legacy WI-06 port bundle, but required by WI-07. */
  readonly identity?: ReleaseIdentityAuthorityQueryPort;
  /** IntegrationGateway-owned RawExternalReceipt facts; absent means fail-closed. */
  readonly rawExternalReceipts?: RawExternalReceiptRepository;
  /** IntegrationGateway-owned exact formal Adapter Attempt authority; absent means fail-closed. */
  readonly adapterAttempts?: FormalAdapterAttemptQueryPort;
}

type DraftDefinition = ReleasePublication.ReleaseDraftDefinition;
type Selection = ReleasePublication.ReleaseRepresentationSelection;
type Destination = ReleasePublication.ReleaseDestinationDefinition;
type PackageDefinition = ReleasePublication.ReleasePackageDefinition;
type Scope = Common.ScopeRef;

interface ScopeFacts {
  readonly enterpriseId: string;
  readonly projectId?: string;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalize(left as CanonicalJsonValue) === canonicalize(right as CanonicalJsonValue);
  } catch {
    return false;
  }
}

function fail(code: string, message: string): never {
  throw new ReleasePublicationBusinessError(code, message);
}

function nonEmptyString(value: unknown, label: string, code: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(code, `${label} must be non-empty`);
  }
  return value;
}

function assertUuid(value: unknown, label: string, code: string): string {
  if (typeof value !== 'string' || !isUuidV7(value)) {
    fail(code, `${label} must be a UUIDv7`);
  }
  return value;
}

export function assertContentHash(
  value: unknown,
  label: string,
  code = RELEASE_SCOPE_INVALID,
): Common.ContentHash {
  const hash = record(value);
  if (
    hash.algorithm !== 'SHA-256' ||
    hash.canonicalizationVersion !== '1' ||
    typeof hash.digest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(hash.digest)
  ) {
    fail(code, `${label} must be a canonical SHA-256 hash`);
  }
  return {
    algorithm: 'SHA-256',
    digest: hash.digest,
    canonicalizationVersion: '1',
  };
}

function assertScope(
  value: unknown,
  context: ReleaseTransactionContext,
  label: string,
  expectedProjectId?: string,
): ScopeFacts {
  const scope = record(value);
  if (typeof scope.enterpriseId !== 'string' || !isUuidV7(scope.enterpriseId)) {
    fail(RELEASE_SCOPE_INVALID, `${label} must contain a UUIDv7 enterpriseId`);
  }
  if (scope.enterpriseId !== context.enterpriseId) {
    fail(RELEASE_SCOPE_INVALID, `${label} is outside the trusted Enterprise`);
  }
  if (
    scope.projectId !== undefined &&
    (typeof scope.projectId !== 'string' ||
      !isUuidV7(scope.projectId) ||
      !context.allowedProjectIds.includes(scope.projectId))
  ) {
    fail(RELEASE_SCOPE_INVALID, `${label} is outside the trusted Project scope`);
  }
  if (expectedProjectId !== undefined && scope.projectId !== undefined) {
    if (scope.projectId !== expectedProjectId) {
      fail(RELEASE_SCOPE_INVALID, `${label} has a different Project scope`);
    }
  }
  return {
    enterpriseId: context.enterpriseId,
    ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
  };
}

function assertObjectRef(
  value: unknown,
  context: ReleaseTransactionContext,
  label: string,
  expectedObjectType: string,
  expectedProjectId?: string,
): Common.ObjectRef {
  const ref = record(value);
  const scope = assertScope(ref.scope, context, `${label}.scope`, expectedProjectId);
  if (
    ref.kind !== 'OBJECT' ||
    ref.objectType !== expectedObjectType ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId)
  ) {
    fail(RELEASE_SCOPE_INVALID, `${label} is not the expected ObjectRef`);
  }
  return {
    kind: 'OBJECT',
    objectType: expectedObjectType,
    objectId: ref.objectId,
    scope,
  };
}

function assertContentAddressedRef(
  value: unknown,
  context: ReleaseTransactionContext,
  label: string,
  expectedObjectType: string,
  expectedProjectId?: string,
): Common.ContentAddressedRef {
  const ref = record(value);
  const scope = assertScope(ref.scope, context, `${label}.scope`, expectedProjectId);
  if (
    ref.kind !== 'CONTENT_ADDRESSED' ||
    ref.objectType !== expectedObjectType ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    (ref.immutableVersionId !== undefined &&
      (typeof ref.immutableVersionId !== 'string' || !isUuidV7(ref.immutableVersionId)))
  ) {
    fail(RELEASE_SCOPE_INVALID, `${label} is not the expected ContentAddressedRef`);
  }
  const contentHash = assertContentHash(ref.contentHash, `${label}.contentHash`);
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: expectedObjectType,
    objectId: ref.objectId,
    ...(ref.immutableVersionId === undefined ? {} : { immutableVersionId: ref.immutableVersionId }),
    scope,
    contentHash,
  };
}

function assertVersionedRef(
  value: unknown,
  context: ReleaseTransactionContext,
  label: string,
  expectedObjectType: string,
  expectedProjectId?: string,
): Common.VersionedRef {
  const ref = record(value);
  const scope = assertScope(ref.scope, context, `${label}.scope`, expectedProjectId);
  if (
    ref.kind !== 'VERSIONED' ||
    ref.objectType !== expectedObjectType ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    typeof ref.versionId !== 'string' ||
    !isUuidV7(ref.versionId)
  ) {
    fail(RELEASE_SCOPE_INVALID, `${label} is not the expected VersionedRef`);
  }
  return {
    kind: 'VERSIONED',
    objectType: expectedObjectType,
    objectId: ref.objectId,
    versionId: ref.versionId,
    scope,
  };
}

function assertSnapshotRef(
  value: unknown,
  context: ReleaseTransactionContext,
  label: string,
  expectedObjectType: string,
  expectedProjectId?: string,
): Common.SnapshotRef {
  const ref = record(value);
  const scope = assertScope(ref.scope, context, `${label}.scope`, expectedProjectId);
  if (
    ref.kind !== 'SNAPSHOT' ||
    ref.objectType !== expectedObjectType ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    typeof ref.snapshotId !== 'string' ||
    !isUuidV7(ref.snapshotId)
  ) {
    fail(RELEASE_SCOPE_INVALID, `${label} is not the expected SnapshotRef`);
  }
  return {
    kind: 'SNAPSHOT',
    objectType: expectedObjectType,
    objectId: ref.objectId,
    snapshotId: ref.snapshotId,
    scope,
    contentHash: assertContentHash(ref.contentHash, `${label}.contentHash`),
  };
}

function assertExternalRef(
  value: unknown,
  context: ReleaseTransactionContext,
  label: string,
): Common.ExternalRef {
  const ref = record(value);
  const system = nonEmptyString(ref.system, `${label}.system`, RELEASE_DESTINATION_INVALID);
  const resourceType = nonEmptyString(
    ref.resourceType,
    `${label}.resourceType`,
    RELEASE_DESTINATION_INVALID,
  );
  const externalId = nonEmptyString(
    ref.externalId,
    `${label}.externalId`,
    RELEASE_DESTINATION_INVALID,
  );
  const observedAt = nonEmptyString(
    ref.observedAt,
    `${label}.observedAt`,
    RELEASE_DESTINATION_INVALID,
  );
  if (Number.isNaN(Date.parse(observedAt))) {
    fail(RELEASE_DESTINATION_INVALID, `${label}.observedAt must be an ISO instant`);
  }
  const tenantOrAccountRef =
    ref.tenantOrAccountRef === undefined
      ? undefined
      : assertObjectRef(
          ref.tenantOrAccountRef,
          context,
          `${label}.tenantOrAccountRef`,
          record(ref.tenantOrAccountRef).objectType as string,
        );
  const payloadHash =
    ref.payloadHash === undefined
      ? undefined
      : assertContentHash(ref.payloadHash, `${label}.payloadHash`, RELEASE_DESTINATION_INVALID);
  const adapterVersion =
    ref.adapterVersion === undefined
      ? undefined
      : nonEmptyString(ref.adapterVersion, `${label}.adapterVersion`, RELEASE_DESTINATION_INVALID);
  return {
    system,
    ...(tenantOrAccountRef === undefined ? {} : { tenantOrAccountRef }),
    resourceType,
    externalId,
    observedAt,
    ...(payloadHash === undefined ? {} : { payloadHash }),
    ...(adapterVersion === undefined ? {} : { adapterVersion }),
  };
}

function assertRepresentationRef(
  value: unknown,
  context: ReleaseTransactionContext,
  label: string,
  expectedRevision: Common.ContentAddressedRef,
  expectedProjectId?: string,
): Common.RepresentationRef {
  const ref = record(value);
  const representationId = assertUuid(
    ref.representationId,
    `${label}.representationId`,
    RELEASE_REPRESENTATION_INVALID,
  );
  const revision = assertContentAddressedRef(
    ref.revision,
    context,
    `${label}.revision`,
    'artifact.artifact_revision',
    expectedProjectId,
  );
  if (!canonicalEqual(revision, expectedRevision)) {
    fail(RELEASE_REPRESENTATION_INVALID, `${label}.revision does not match the Release revision`);
  }
  const format = nonEmptyString(ref.format, `${label}.format`, RELEASE_REPRESENTATION_INVALID);
  const mediaType = nonEmptyString(
    ref.mediaType,
    `${label}.mediaType`,
    RELEASE_REPRESENTATION_INVALID,
  );
  const objectStorageRef = nonEmptyString(
    ref.objectStorageRef,
    `${label}.objectStorageRef`,
    RELEASE_REPRESENTATION_INVALID,
  );
  const rendererRecord = record(ref.renderer);
  const rendererId = nonEmptyString(
    rendererRecord.rendererId,
    `${label}.renderer.rendererId`,
    RELEASE_REPRESENTATION_INVALID,
  );
  const rendererVersion = nonEmptyString(
    rendererRecord.rendererVersion,
    `${label}.renderer.rendererVersion`,
    RELEASE_REPRESENTATION_INVALID,
  );
  const createdAt = nonEmptyString(
    ref.createdAt,
    `${label}.createdAt`,
    RELEASE_REPRESENTATION_INVALID,
  );
  if (Number.isNaN(Date.parse(createdAt))) {
    fail(RELEASE_REPRESENTATION_INVALID, `${label}.createdAt must be an ISO instant`);
  }
  return {
    representationId,
    revision,
    format,
    mediaType,
    objectStorageRef,
    checksum: assertContentHash(ref.checksum, `${label}.checksum`, RELEASE_REPRESENTATION_INVALID),
    renderer: { rendererId, rendererVersion },
    createdAt,
  };
}

function inferProjectId(
  context: ReleaseTransactionContext,
  envelopeProjectId: string | undefined,
  refs: readonly Scope[],
): string | undefined {
  const candidates = [
    envelopeProjectId,
    ...refs.flatMap((scope) => ('projectId' in scope ? [scope.projectId] : [])),
  ].filter((value): value is string => value !== undefined);
  const unique = [...new Set(candidates)];
  if (unique.length > 1)
    fail(RELEASE_SCOPE_INVALID, 'Release references disagree on Project scope');
  const projectId = unique[0];
  if (projectId !== undefined && !context.allowedProjectIds.includes(projectId)) {
    fail(RELEASE_SCOPE_INVALID, 'Release Project scope is not allowed by the trusted context');
  }
  return projectId;
}

export function releaseScope(
  context: ReleaseTransactionContext,
  projectId: string | undefined,
): Common.ScopeRef {
  return {
    enterpriseId: context.enterpriseId,
    ...(projectId === undefined ? {} : { projectId }),
  };
}

export function validateReleaseRef(
  value: unknown,
  context: ReleaseTransactionContext,
  label = 'releaseRef',
  expectedProjectId?: string,
): Common.ObjectRef {
  return assertObjectRef(value, context, label, 'release.release', expectedProjectId);
}

export function validateReleasePackageRef(
  value: unknown,
  context: ReleaseTransactionContext,
): Common.ReleasePackageRef {
  const packageRef = record(value);
  const releaseRef = validateReleaseRef(packageRef.releaseRef, context, 'packageRef.releaseRef');
  const packageSnapshotRef = assertSnapshotRef(
    packageRef.packageSnapshotRef,
    context,
    'packageRef.packageSnapshotRef',
    'release.release_package',
    'projectId' in releaseRef.scope ? releaseRef.scope.projectId : undefined,
  );
  const packageHash = assertContentHash(
    packageRef.packageHash,
    'packageRef.packageHash',
    RELEASE_PACKAGE_HASH_MISMATCH,
  );
  if (
    !canonicalEqual(packageSnapshotRef.scope, releaseRef.scope) ||
    !canonicalEqual(packageSnapshotRef.contentHash, packageHash)
  ) {
    fail(RELEASE_PACKAGE_HASH_MISMATCH, 'packageRef does not identify one exact frozen package');
  }
  return { releaseRef, packageSnapshotRef, packageHash };
}

export interface ValidatedDraftDefinition {
  readonly definition: DraftDefinition;
  readonly projectId?: string;
}

export function validateDraftDefinition(
  definition: DraftDefinition,
  context: ReleaseTransactionContext,
  envelopeProjectId?: string,
): ValidatedDraftDefinition {
  const artifactRef = assertObjectRef(
    definition.artifactRef,
    context,
    'definition.artifactRef',
    'artifact.artifact',
  );
  const revisionRef = assertContentAddressedRef(
    definition.revisionRef,
    context,
    'definition.revisionRef',
    'artifact.artifact_revision',
  );
  const qualityProfileRef = assertVersionedRef(
    definition.qualityProfileRef,
    context,
    'definition.qualityProfileRef',
    'quality.quality_profile',
  );
  const revisionAcceptanceSnapshotRef = assertSnapshotRef(
    definition.revisionAcceptanceSnapshotRef,
    context,
    'definition.revisionAcceptanceSnapshotRef',
    'quality.revision_acceptance_snapshot',
  );
  const approvalBundleSnapshotRef = assertSnapshotRef(
    definition.approvalBundleSnapshotRef,
    context,
    'definition.approvalBundleSnapshotRef',
    'quality.approval_bundle_snapshot',
  );
  const projectId = inferProjectId(context, envelopeProjectId, [
    artifactRef.scope,
    revisionRef.scope,
    qualityProfileRef.scope,
    revisionAcceptanceSnapshotRef.scope,
    approvalBundleSnapshotRef.scope,
  ]);
  for (const [label, ref] of [
    ['definition.artifactRef', artifactRef],
    ['definition.revisionRef', revisionRef],
    ['definition.qualityProfileRef', qualityProfileRef],
    ['definition.revisionAcceptanceSnapshotRef', revisionAcceptanceSnapshotRef],
    ['definition.approvalBundleSnapshotRef', approvalBundleSnapshotRef],
  ] as const) {
    assertScope(ref.scope, context, `${label}.scope`, projectId);
  }
  if (
    typeof definition.releaseNumber !== 'string' ||
    definition.releaseNumber.trim().length === 0
  ) {
    fail(RELEASE_SCOPE_INVALID, 'definition.releaseNumber must be non-empty');
  }
  if (
    ![
      'CUSTOMER_DELIVERY',
      'REGULATORY_SUBMISSION',
      'INTERNAL_EFFECTIVE_USE',
      'FEISHU_PUBLICATION',
      'CONTROLLED_EXPORT',
    ].includes(definition.purpose)
  ) {
    fail(RELEASE_SCOPE_INVALID, 'definition.purpose is not a supported ReleasePurpose');
  }
  if (
    definition.requestedEffectiveAt !== undefined &&
    Number.isNaN(Date.parse(definition.requestedEffectiveAt))
  ) {
    fail(RELEASE_SCOPE_INVALID, 'definition.requestedEffectiveAt must be an ISO instant');
  }
  if (definition.supersedesReleaseRef !== undefined) {
    assertObjectRef(
      definition.supersedesReleaseRef,
      context,
      'definition.supersedesReleaseRef',
      'release.release',
      projectId,
    );
  }
  return {
    definition: {
      ...definition,
      artifactRef,
      revisionRef,
      qualityProfileRef,
      revisionAcceptanceSnapshotRef,
      approvalBundleSnapshotRef,
    },
    ...(projectId === undefined ? {} : { projectId }),
  };
}

export async function validateDraftAuthorities(
  definition: DraftDefinition,
  context: ReleaseTransactionContext,
  ports: ReleaseAuthorityQueryPorts,
  projectId?: string,
): Promise<void> {
  const revisionValidation = await ports.artifact.validateRevisionRef({
    revisionRef: definition.revisionRef,
    expectedScopeRef: releaseScope(context, projectId),
    purpose: definition.purpose,
    allowedDispositions: ['ACTIVE'],
  });
  if (
    !revisionValidation.valid ||
    !revisionValidation.contentAvailable ||
    revisionValidation.disposition !== 'ACTIVE' ||
    !canonicalEqual(revisionValidation.exactRef, definition.revisionRef) ||
    !canonicalEqual(revisionValidation.authoritativeScopeRef, definition.revisionRef.scope)
  ) {
    fail(RELEASE_REVISION_NOT_APPROVED, 'Revision is not an exact approved and available Revision');
  }

  const acceptance = await ports.quality.getRevisionAcceptanceSnapshot({
    snapshotRef: definition.revisionAcceptanceSnapshotRef,
  });
  if (
    acceptance.snapshotId !== definition.revisionAcceptanceSnapshotRef.snapshotId ||
    !canonicalEqual(acceptance.header.scopeRef, definition.revisionAcceptanceSnapshotRef.scope) ||
    !canonicalEqual(acceptance.artifactRef, definition.artifactRef) ||
    !canonicalEqual(acceptance.revisionRef, definition.revisionRef) ||
    !canonicalEqual(acceptance.qualityProfileRef, definition.qualityProfileRef) ||
    acceptance.readiness.status !== 'READY'
  ) {
    fail(RELEASE_REVISION_NOT_APPROVED, 'Revision Acceptance Snapshot is stale or mismatched');
  }

  const approval = await ports.quality.getApprovalBundleSnapshot({
    snapshotRef: definition.approvalBundleSnapshotRef,
  });
  if (
    approval.snapshotId !== definition.approvalBundleSnapshotRef.snapshotId ||
    !canonicalEqual(approval.header.scopeRef, definition.approvalBundleSnapshotRef.scope) ||
    !canonicalEqual(approval.artifactRef, definition.artifactRef) ||
    !canonicalEqual(approval.revisionRef, definition.revisionRef) ||
    !canonicalEqual(approval.qualityProfileRef, definition.qualityProfileRef) ||
    !canonicalEqual(
      approval.revisionAcceptanceSnapshotRef,
      definition.revisionAcceptanceSnapshotRef,
    ) ||
    approval.completeness.status !== 'FULLY_APPROVED' ||
    approval.separationOfDutiesResult.outcome !== 'SATISFIED'
  ) {
    fail(RELEASE_APPROVAL_BUNDLE_INVALID, 'Approval Bundle is incomplete, stale or mismatched');
  }
}

export async function validateSelections(
  selections: readonly Selection[],
  revisionRef: Common.ContentAddressedRef,
  context: ReleaseTransactionContext,
  ports: ReleaseAuthorityQueryPorts,
  projectId?: string,
): Promise<readonly Selection[]> {
  if (selections.length === 0) fail(RELEASE_PACKAGE_EMPTY, 'Release must contain a Representation');
  const representationIds = new Set<string>();
  const ordinals = new Set<number>();
  const normalized: Selection[] = [];
  for (const [index, selection] of selections.entries()) {
    if (representationIds.has(selection.representationRef.representationId)) {
      fail(RELEASE_REPRESENTATION_INVALID, 'Representation cannot be selected twice');
    }
    if (ordinals.has(selection.ordinal)) {
      fail(RELEASE_REPRESENTATION_INVALID, 'Representation ordinals must be unique');
    }
    representationIds.add(selection.representationRef.representationId);
    ordinals.add(selection.ordinal);
    const representationRef = assertRepresentationRef(
      selection.representationRef,
      context,
      `selections[${index}].representationRef`,
      revisionRef,
      projectId,
    );
    const view = await ports.artifact.getRepresentation({ representationRef });
    if (
      view.status !== 'registered' ||
      !canonicalEqual(view.representationRef, representationRef)
    ) {
      fail(RELEASE_REPRESENTATION_INVALID, 'Representation is not registered or exact');
    }
    normalized.push({ ...selection, representationRef: view.representationRef });
  }
  return normalized.sort(
    (left, right) =>
      left.ordinal - right.ordinal ||
      Buffer.compare(
        Buffer.from(left.representationRef.representationId),
        Buffer.from(right.representationRef.representationId),
      ),
  );
}

export interface ValidatedDestinations {
  readonly destinations: readonly Destination[];
  readonly recipientScopeSnapshotRef: Common.SnapshotRef;
}

export function validateDestinations(
  destinations: readonly Destination[],
  recipientScopeSnapshotRef: Common.SnapshotRef,
  context: ReleaseTransactionContext,
  projectId?: string,
): ValidatedDestinations {
  if (destinations.length === 0) fail(RELEASE_PACKAGE_EMPTY, 'Release must contain a Destination');
  const recipient = assertSnapshotRef(
    recipientScopeSnapshotRef,
    context,
    'recipientScopeSnapshotRef',
    'release.recipient_scope_snapshot',
    projectId,
  );
  const ids = new Set<string>();
  const externalTargets = new Set<string>();
  const normalized: Destination[] = [];
  for (const [index, destination] of destinations.entries()) {
    const destinationId = assertUuid(
      destination.destinationId,
      `destinations[${index}].destinationId`,
      RELEASE_DESTINATION_INVALID,
    );
    if (ids.has(destinationId)) fail(RELEASE_DESTINATION_INVALID, 'Destination IDs must be unique');
    ids.add(destinationId);
    nonEmptyString(
      destination.destinationType,
      `destinations[${index}].destinationType`,
      RELEASE_DESTINATION_INVALID,
    );
    nonEmptyString(
      destination.purpose,
      `destinations[${index}].purpose`,
      RELEASE_DESTINATION_INVALID,
    );
    nonEmptyString(
      destination.requiredReceiptKind,
      `destinations[${index}].requiredReceiptKind`,
      RELEASE_DESTINATION_INVALID,
    );
    if (typeof destination.required !== 'boolean') {
      fail(RELEASE_DESTINATION_INVALID, `destinations[${index}].required must be boolean`);
    }
    const destinationRef = assertExternalRef(
      destination.destinationRef,
      context,
      `destinations[${index}].destinationRef`,
    );
    const targetKey = canonicalize(destinationRef as unknown as CanonicalJsonValue);
    if (externalTargets.has(targetKey)) {
      fail(RELEASE_DESTINATION_INVALID, 'The same external Destination cannot be repeated');
    }
    externalTargets.add(targetKey);
    const destinationRecipient = assertSnapshotRef(
      destination.recipientScopeRef,
      context,
      `destinations[${index}].recipientScopeRef`,
      'release.recipient_scope_snapshot',
      projectId,
    );
    if (!canonicalEqual(destinationRecipient, recipient)) {
      fail(RELEASE_DESTINATION_INVALID, 'Destination Recipient Scope must match the Release Scope');
    }
    const deliveryPolicyRef = assertVersionedRef(
      destination.deliveryPolicyRef,
      context,
      `destinations[${index}].deliveryPolicyRef`,
      'policy.delivery_policy',
      projectId,
    );
    normalized.push({
      ...destination,
      destinationId,
      destinationRef,
      recipientScopeRef: destinationRecipient,
      deliveryPolicyRef,
    });
  }
  normalized.sort((left, right) =>
    Buffer.compare(Buffer.from(left.destinationId), Buffer.from(right.destinationId)),
  );
  return { destinations: normalized, recipientScopeSnapshotRef: recipient };
}

export interface ValidatedPackage {
  readonly definition: PackageDefinition;
  readonly projectId?: string;
}

export function validatePackageDefinition(
  packageDefinition: PackageDefinition,
  context: ReleaseTransactionContext,
  envelopeProjectId?: string,
): ValidatedPackage {
  const releaseRef = validateReleaseRef(packageDefinition.releaseRef, context);
  const canonicalRevisionRef = assertContentAddressedRef(
    packageDefinition.canonicalRevisionRef,
    context,
    'package.canonicalRevisionRef',
    'artifact.artifact_revision',
  );
  const approvalBundleSnapshotRef = assertSnapshotRef(
    packageDefinition.approvalBundleSnapshotRef,
    context,
    'package.approvalBundleSnapshotRef',
    'quality.approval_bundle_snapshot',
  );
  const recipientScopeSnapshotRef = assertSnapshotRef(
    packageDefinition.recipientScopeSnapshotRef,
    context,
    'package.recipientScopeSnapshotRef',
    'release.recipient_scope_snapshot',
  );
  const projectId = inferProjectId(context, envelopeProjectId, [
    releaseRef.scope,
    canonicalRevisionRef.scope,
    approvalBundleSnapshotRef.scope,
    recipientScopeSnapshotRef.scope,
  ]);
  for (const [label, ref] of [
    ['package.releaseRef', releaseRef],
    ['package.canonicalRevisionRef', canonicalRevisionRef],
    ['package.approvalBundleSnapshotRef', approvalBundleSnapshotRef],
    ['package.recipientScopeSnapshotRef', recipientScopeSnapshotRef],
  ] as const) {
    assertScope(ref.scope, context, `${label}.scope`, projectId);
  }
  if (typeof packageDefinition.representations.length !== 'number') {
    fail(RELEASE_PACKAGE_EMPTY, 'package.representations must be an array');
  }
  if (typeof packageDefinition.destinations.length !== 'number') {
    fail(RELEASE_PACKAGE_EMPTY, 'package.destinations must be an array');
  }
  if (Number.isNaN(Date.parse(packageDefinition.preparedAt))) {
    fail(RELEASE_PACKAGE_FROZEN, 'package.preparedAt must be an ISO instant');
  }
  const packageHash = assertContentHash(
    packageDefinition.packageHash,
    'package.packageHash',
    RELEASE_PACKAGE_HASH_MISMATCH,
  );
  const representations = packageDefinition.representations.map((selection, index) => {
    if (!Number.isInteger(selection.ordinal) || selection.ordinal < 0) {
      fail(RELEASE_REPRESENTATION_INVALID, `package.representations[${index}].ordinal is invalid`);
    }
    if (typeof selection.required !== 'boolean') {
      fail(
        RELEASE_REPRESENTATION_INVALID,
        `package.representations[${index}].required must be boolean`,
      );
    }
    const representationRef = assertRepresentationRef(
      selection.representationRef,
      context,
      `package.representations[${index}].representationRef`,
      canonicalRevisionRef,
      projectId,
    );
    const displayName = nonEmptyString(
      selection.displayName,
      `package.representations[${index}].displayName`,
      RELEASE_REPRESENTATION_INVALID,
    );
    const releaseRole = nonEmptyString(
      selection.releaseRole,
      `package.representations[${index}].releaseRole`,
      RELEASE_REPRESENTATION_INVALID,
    );
    return { ...selection, representationRef, displayName, releaseRole };
  });
  const validatedDestinations = validateDestinations(
    packageDefinition.destinations,
    recipientScopeSnapshotRef,
    context,
    projectId,
  );
  return {
    definition: {
      ...packageDefinition,
      releaseRef,
      canonicalRevisionRef,
      approvalBundleSnapshotRef,
      recipientScopeSnapshotRef: validatedDestinations.recipientScopeSnapshotRef,
      representations,
      destinations: validatedDestinations.destinations,
      packageHash,
    },
    ...(projectId === undefined ? {} : { projectId }),
  };
}

export function validatePreparationValidationRef(
  value: unknown,
  context: ReleaseTransactionContext,
  projectId?: string,
): Common.ContentAddressedRef {
  return assertContentAddressedRef(
    value,
    context,
    'preparationValidationRef',
    'release.preparation_validation',
    projectId,
  );
}

export function validatePackageShape(
  packageDefinition: PackageDefinition,
  releaseRef: Common.ObjectRef,
  draft: DraftDefinition,
  storedSelections: readonly Selection[],
  storedDestinations: readonly Destination[],
  storedRecipientScopeSnapshotRef: Common.SnapshotRef,
  context: ReleaseTransactionContext,
  projectId?: string,
): PackageDefinition {
  const normalized = normalizePackageDefinition(packageDefinition);
  if (!canonicalEqual(normalized.releaseRef, releaseRef)) {
    fail(RELEASE_PACKAGE_FROZEN, 'Package releaseRef does not match the target Release');
  }
  if (!canonicalEqual(normalized.canonicalRevisionRef, draft.revisionRef)) {
    fail(RELEASE_PACKAGE_FROZEN, 'Package Revision is not the exact Release Revision');
  }
  if (!canonicalEqual(normalized.approvalBundleSnapshotRef, draft.approvalBundleSnapshotRef)) {
    fail(RELEASE_PACKAGE_FROZEN, 'Package Approval Bundle is not the exact Release Bundle');
  }
  if (!canonicalEqual(normalized.recipientScopeSnapshotRef, storedRecipientScopeSnapshotRef)) {
    fail(RELEASE_PACKAGE_FROZEN, 'Package Recipient Scope is not the frozen Release Scope');
  }
  const selections = validateStoredSelections(storedSelections, context, projectId);
  const destinations = validateStoredDestinations(storedDestinations, context, projectId);
  if (!canonicalEqual(normalized.representations, selections)) {
    fail(RELEASE_PACKAGE_FROZEN, 'Package Representations do not match the DRAFT selections');
  }
  if (!canonicalEqual(normalized.destinations, destinations)) {
    fail(RELEASE_PACKAGE_FROZEN, 'Package Destinations do not match the DRAFT destinations');
  }
  return normalized;
}

function validateStoredSelections(
  selections: readonly Selection[],
  context: ReleaseTransactionContext,
  projectId?: string,
): readonly Selection[] {
  if (selections.length === 0)
    fail(RELEASE_PACKAGE_EMPTY, 'DRAFT has no Representation selections');
  return selections.map((selection, index) => ({
    ...selection,
    representationRef: assertRepresentationRef(
      selection.representationRef,
      context,
      `storedSelections[${index}].representationRef`,
      selection.representationRef.revision,
      projectId,
    ),
  }));
}

function validateStoredDestinations(
  destinations: readonly Destination[],
  context: ReleaseTransactionContext,
  projectId?: string,
): readonly Destination[] {
  if (destinations.length === 0) fail(RELEASE_PACKAGE_EMPTY, 'DRAFT has no Destinations');
  const normalized: Destination[] = [];
  for (const [index, destination] of destinations.entries()) {
    const destinationRecipient = assertSnapshotRef(
      destination.recipientScopeRef,
      context,
      `storedDestinations[${index}].recipientScopeRef`,
      'release.recipient_scope_snapshot',
      projectId,
    );
    normalized.push({
      ...destination,
      destinationRef: assertExternalRef(
        destination.destinationRef,
        context,
        `storedDestinations[${index}].destinationRef`,
      ),
      recipientScopeRef: destinationRecipient,
      deliveryPolicyRef: assertVersionedRef(
        destination.deliveryPolicyRef,
        context,
        `storedDestinations[${index}].deliveryPolicyRef`,
        'policy.delivery_policy',
        projectId,
      ),
    });
  }
  return normalized;
}

export function snapshotRefForPackage(
  packageId: string,
  releaseRef: Common.ObjectRef,
  packageHash: Common.ContentHash,
): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType: 'release.release_package',
    objectId: packageId,
    snapshotId: packageId,
    scope: releaseRef.scope,
    contentHash: packageHash,
  };
}

export function contentHashBytes(hash: Common.ContentHash): Buffer {
  return Buffer.from(hash.digest, 'hex');
}

export function sameScope(left: Scope, right: Scope): boolean {
  return canonicalEqual(left, right);
}

export function aggregateVersionNumber(value: string | number, label: string): number {
  const parsed = BigInt(value);
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail(RELEASE_QUERY_NOT_FOUND, `${label} is outside the API safe integer range`);
  }
  return Number(parsed);
}

export function parseStoredJson(value: unknown, label: string): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      fail(RELEASE_QUERY_NOT_FOUND, `${label} is not valid stored JSON`);
    }
  }
  return value;
}
