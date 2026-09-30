// IM-04 WI-05 (issue #94): immutable Revision commands and exact historical
// queries. Canonical bodies remain in the frozen Content Object Manifest.

import type { Kysely } from 'kysely';
import {
  ContractRegistry,
  isExecutionDocumentSchema,
  operationPayloadSchemaRef,
  type Artifact,
  type Common,
} from '@zhiju/contracts';
import type { ObjectStoragePort } from '../storage/object-storage.js';
import {
  canonicalize,
  isUuidV7,
  newUuidV7,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import {
  digestCanonicalPayload,
  withArtifactTransaction,
  type ArtifactDb,
  type ArtifactTransaction,
  type ArtifactTransactionContext,
} from '../persistence/artifact-db.js';
import {
  ArtifactRepository,
  type ArtifactHeadMoveOutcome,
  type ArtifactRevisionCreateOutcome,
  type RevisionGovernanceOutcome,
  type RevisionGraph,
} from '../persistence/artifact-repository.js';
import {
  ArtifactBusinessError,
  ARTIFACT_BRANCH_HEAD_CONFLICT,
  ARTIFACT_CONTENT_HASH_MISMATCH,
  ARTIFACT_CONTENT_OWNER_INVALID,
  ARTIFACT_CONTENT_STATE_INVALID,
  ARTIFACT_CROSS_ARTIFACT_PARENT,
  ARTIFACT_EXPECTED_VERSION_REQUIRED,
  ARTIFACT_HUMAN_ONLY_DENIED,
  ARTIFACT_LINEAGE_CYCLE,
  ARTIFACT_MERGE_CONFLICT_UNRESOLVED,
  ARTIFACT_NOT_ACTIVE,
  ARTIFACT_PARENT_REQUIRED,
  ARTIFACT_QUERY_NOT_FOUND,
  ARTIFACT_QUERY_SCOPE_MISMATCH,
  ARTIFACT_REVISION_IMMUTABLE,
  ARTIFACT_SCOPE_INVALID,
  ARTIFACT_STRUCTURE_SCHEMA_INVALID,
} from './artifact-business-errors.js';
import {
  CommandExecutionError,
  executeArtifactCommand,
  type CommandBodyResult,
  type CommandEnvelope,
  type CommandResult,
} from '../persistence/command-runner.js';

const repo = new ArtifactRepository();
const ROOT_OBJECT_TYPES = new Set(['Artifact', 'artifact.artifact']);
const REVISION_OBJECT_TYPES = new Set(['ArtifactRevision', 'artifact.artifact_revision']);
const REVISION_OBJECT_TYPE = 'ArtifactRevision';
const REVISION_REF_OBJECT_TYPE = 'artifact.artifact_revision';
const ROOT_OBJECT_TYPE = 'Artifact';
const OBJECT_LOCATOR_PATTERN = /^[a-z0-9][a-z0-9._-]*(\/[A-Za-z0-9._-]+)+$/;

export type RevisionCommandEnvelope<TPayload> = CommandEnvelope & { payload: TPayload };
export type CreateAndSealRevisionPayload = Artifact.ArtifactCreateAndSealRevisionPayload;
export type CreateMergeRevisionPayload = Artifact.ArtifactCreateMergeRevisionPayload;
export type MoveWorkingHeadPayload = Artifact.ArtifactMoveWorkingHeadPayload;
export type WithdrawRevisionPayload = Artifact.ArtifactWithdrawRevisionPayload;
export type InvalidateRevisionPayload = Artifact.ArtifactInvalidateRevisionPayload;
export type GetRevisionSnapshotPayload = Artifact.ArtifactGetRevisionSnapshotPayload;
export type GetRevisionLineagePayload = Artifact.ArtifactGetRevisionLineagePayload;
export type GetRevisionDiffInputsPayload = Artifact.ArtifactGetRevisionDiffInputsPayload;
export type ValidateRevisionRefPayload = Artifact.ArtifactValidateRevisionRefPayload;

type RecordLike = Readonly<Record<string, unknown>>;
type ScopeProjectPolicy = 'OPTIONAL' | 'EXACT';

interface ScopeFacts {
  readonly enterpriseId?: string;
  readonly projectId?: string;
}

interface RevisionRefFacts {
  readonly revisionId: string;
  readonly projectId?: string;
  readonly hashBytes: Buffer;
  readonly ref: Common.ContentAddressedRef;
}

interface ArtifactRefFacts {
  readonly artifactId: string;
  readonly projectId?: string;
  readonly ref: Common.ObjectRef;
}

interface ValidatedRevisionContent {
  readonly artifactId: string;
  readonly projectId?: string;
  readonly branchId: string;
  readonly parentRefs: readonly Common.ContentAddressedRef[];
  readonly contentType: 'STRUCTURED_DOCUMENT' | 'WORKBOOK_SPEC';
  readonly contentLocator: string;
  readonly contentHash: Common.ContentHash;
  readonly contentHashBytes: Buffer;
  readonly structureSchemaRef: Common.VersionedRef;
  readonly semanticMetadata: CanonicalJsonValue;
  readonly changedUnits: readonly string[];
  readonly changeSummary: string;
  readonly provenance: Artifact.RevisionProvenance;
}

interface ValidatedMerge {
  readonly revision: ValidatedRevisionContent;
  readonly mergeStrategy: string;
  readonly conflictSet: readonly CanonicalJsonValue[];
  readonly conflictResolutionRefs: readonly Common.TypedReference[];
  readonly resolvedBy: Common.ObjectRef;
}

interface ValidatedHeadMove {
  readonly branchId: string;
  readonly expectedVersion: string;
  readonly expectedHeadRef?: Common.ContentAddressedRef;
  readonly newHeadRef: Common.ContentAddressedRef;
  readonly moveReason: CanonicalJsonObject;
}

interface RevisionFacts {
  readonly revision: NonNullable<Awaited<ReturnType<ArtifactRepository['getRevisionById']>>>;
  readonly root: NonNullable<Awaited<ReturnType<ArtifactRepository['getArtifactById']>>>;
}

function record(value: unknown): RecordLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordLike)
    : {};
}

function canonicalValue(value: unknown, code = ARTIFACT_SCOPE_INVALID): CanonicalJsonValue {
  try {
    const parsed: unknown = JSON.parse(JSON.stringify(value));
    return parsed as CanonicalJsonValue;
  } catch {
    throw new ArtifactBusinessError(code, 'value is not valid canonical JSON');
  }
}

function canonicalObject(value: unknown, label: string): CanonicalJsonObject {
  const parsed = canonicalValue(value);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label} must be a JSON object`);
  }
  return parsed as CanonicalJsonObject;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label} must be non-empty`);
  }
  return value;
}

function scopeFacts(value: unknown, label: string): ScopeFacts {
  const scope = record(value);
  const enterpriseId = scope.enterpriseId;
  const projectId = scope.projectId;
  if (enterpriseId !== undefined && (typeof enterpriseId !== 'string' || !isUuidV7(enterpriseId))) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label}.enterpriseId is invalid`);
  }
  if (projectId !== undefined && (typeof projectId !== 'string' || !isUuidV7(projectId))) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label}.projectId is invalid`);
  }
  if (projectId !== undefined && enterpriseId === undefined) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      `${label} cannot contain projectId alone`,
    );
  }
  return {
    ...(enterpriseId === undefined ? {} : { enterpriseId }),
    ...(projectId === undefined ? {} : { projectId }),
  };
}

function assertTrustedScope(
  value: unknown,
  context: ArtifactTransactionContext,
  expectedProjectId: string | undefined,
  label: string,
  projectPolicy: ScopeProjectPolicy,
): ScopeFacts & { readonly enterpriseId: string } {
  const scope = scopeFacts(value, `${label}.scope`);
  if (scope.enterpriseId !== context.enterpriseId) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      `${label} is outside the trusted Enterprise`,
    );
  }
  if (scope.projectId !== undefined && !context.allowedProjectIds.includes(scope.projectId)) {
    throw new ArtifactBusinessError(
      ARTIFACT_QUERY_NOT_FOUND,
      `${label} is outside the trusted Project scope`,
    );
  }
  if (projectPolicy === 'EXACT' && scope.projectId !== expectedProjectId) {
    throw new ArtifactBusinessError(
      ARTIFACT_QUERY_SCOPE_MISMATCH,
      `${label} Project scope does not match the authoritative Artifact scope`,
    );
  }
  return { ...scope, enterpriseId: context.enterpriseId };
}

function normalizedContentHash(value: unknown, label: string): Common.ContentHash {
  const hash = record(value);
  if (
    hash.algorithm !== 'SHA-256' ||
    hash.canonicalizationVersion !== '1' ||
    typeof hash.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(hash.digest)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_HASH_MISMATCH,
      `${label} must be a lowercase SHA-256 hash in canonicalization version 1`,
    );
  }
  return {
    algorithm: 'SHA-256',
    digest: hash.digest,
    canonicalizationVersion: '1',
  };
}

function hashBytes(value: Common.ContentHash): Buffer {
  return Buffer.from(value.digest, 'hex');
}

function assertObjectRef(
  value: unknown,
  context: ArtifactTransactionContext,
  expectedProjectId: string | undefined,
  label: string,
  expectedObjectTypes: readonly string[] = [],
  projectPolicy: ScopeProjectPolicy = 'EXACT',
): Common.ObjectRef {
  const ref = canonicalObject(value, label);
  const scope = assertTrustedScope(ref.scope, context, expectedProjectId, label, projectPolicy);
  if (
    ref.kind !== 'OBJECT' ||
    typeof ref.objectType !== 'string' ||
    ref.objectType.length === 0 ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    (expectedObjectTypes.length > 0 && !expectedObjectTypes.includes(ref.objectType))
  ) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label} is not an exact ObjectRef`);
  }
  return {
    kind: 'OBJECT',
    objectType: ref.objectType,
    objectId: ref.objectId,
    scope: {
      enterpriseId: scope.enterpriseId,
      ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
    },
  };
}

function assertArtifactRef(
  value: unknown,
  context: ArtifactTransactionContext,
  expectedProjectId?: string,
  projectPolicy: ScopeProjectPolicy = 'OPTIONAL',
): ArtifactRefFacts {
  const ref = assertObjectRef(
    value,
    context,
    expectedProjectId,
    'artifactRef',
    [...ROOT_OBJECT_TYPES],
    projectPolicy,
  );
  return {
    artifactId: ref.objectId,
    ...(ref.scope.projectId === undefined ? {} : { projectId: ref.scope.projectId }),
    ref: { ...ref, objectType: ROOT_OBJECT_TYPE },
  };
}

function assertVersionedRef(
  value: unknown,
  context: ArtifactTransactionContext,
  expectedProjectId: string | undefined,
  label: string,
  projectPolicy: ScopeProjectPolicy = 'EXACT',
): Common.VersionedRef {
  const ref = canonicalObject(value, label);
  const scope = assertTrustedScope(ref.scope, context, expectedProjectId, label, projectPolicy);
  if (
    ref.kind !== 'VERSIONED' ||
    typeof ref.objectType !== 'string' ||
    ref.objectType.length === 0 ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    typeof ref.versionId !== 'string' ||
    !isUuidV7(ref.versionId)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURE_SCHEMA_INVALID,
      `${label} is not an exact VersionedRef`,
    );
  }
  return {
    kind: 'VERSIONED',
    objectType: ref.objectType,
    objectId: ref.objectId,
    versionId: ref.versionId,
    scope: {
      enterpriseId: scope.enterpriseId,
      ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
    },
  };
}

function assertRevisionRef(
  value: unknown,
  context: ArtifactTransactionContext,
  expectedProjectId: string | undefined,
  label = 'revisionRef',
  projectPolicy: ScopeProjectPolicy = 'EXACT',
): RevisionRefFacts {
  const ref = canonicalObject(value, label);
  const scope = assertTrustedScope(ref.scope, context, expectedProjectId, label, projectPolicy);
  const normalizedHash = normalizedContentHash(ref.contentHash, `${label}.contentHash`);
  if (
    ref.kind !== 'CONTENT_ADDRESSED' ||
    typeof ref.objectType !== 'string' ||
    !REVISION_OBJECT_TYPES.has(ref.objectType) ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    (ref.immutableVersionId !== undefined &&
      (typeof ref.immutableVersionId !== 'string' || !isUuidV7(ref.immutableVersionId)))
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      `${label} is not an exact Artifact Revision Ref`,
    );
  }
  return {
    revisionId: ref.objectId,
    ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
    hashBytes: hashBytes(normalizedHash),
    ref: {
      kind: 'CONTENT_ADDRESSED',
      objectType: REVISION_REF_OBJECT_TYPE,
      objectId: ref.objectId,
      ...(ref.immutableVersionId === undefined
        ? {}
        : { immutableVersionId: ref.immutableVersionId }),
      scope: {
        enterpriseId: scope.enterpriseId,
        ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
      },
      contentHash: normalizedHash,
    },
  };
}

function assertTypedReference(
  value: unknown,
  context: ArtifactTransactionContext,
  expectedProjectId: string | undefined,
  label: string,
): Common.TypedReference {
  const ref = canonicalObject(value, label);
  if (ref.kind === 'EXTERNAL') {
    if (
      typeof ref.system !== 'string' ||
      ref.system.length === 0 ||
      typeof ref.resourceType !== 'string' ||
      ref.resourceType.length === 0 ||
      typeof ref.externalId !== 'string' ||
      ref.externalId.trim().length === 0 ||
      typeof ref.observedAt !== 'string' ||
      Number.isNaN(new Date(ref.observedAt).getTime())
    ) {
      throw new ArtifactBusinessError(
        ARTIFACT_SCOPE_INVALID,
        `${label} is not a valid ExternalRef`,
      );
    }
    if (ref.tenantOrAccountRef !== undefined) {
      assertObjectRef(
        ref.tenantOrAccountRef,
        context,
        expectedProjectId,
        `${label}.tenantOrAccountRef`,
      );
    }
    if (ref.payloadHash !== undefined)
      normalizedContentHash(ref.payloadHash, `${label}.payloadHash`);
    return ref as unknown as Common.ExternalRef;
  }
  if (ref.kind === 'OBJECT') {
    return assertObjectRef(value, context, expectedProjectId, label, [], 'OPTIONAL');
  }
  if (ref.kind === 'VERSIONED') {
    return assertVersionedRef(value, context, expectedProjectId, label, 'OPTIONAL');
  }
  if (ref.kind === 'CONTENT_ADDRESSED') {
    return assertGenericContentAddressedRef(value, context, expectedProjectId, label);
  }
  if (ref.kind === 'SNAPSHOT') {
    const scope = assertTrustedScope(ref.scope, context, expectedProjectId, label, 'OPTIONAL');
    const contentHash = normalizedContentHash(ref.contentHash, `${label}.contentHash`);
    if (
      typeof ref.objectType !== 'string' ||
      ref.objectType.length === 0 ||
      typeof ref.objectId !== 'string' ||
      !isUuidV7(ref.objectId) ||
      typeof ref.snapshotId !== 'string' ||
      !isUuidV7(ref.snapshotId)
    ) {
      throw new ArtifactBusinessError(
        ARTIFACT_SCOPE_INVALID,
        `${label} is not a valid SnapshotRef`,
      );
    }
    return {
      kind: 'SNAPSHOT',
      objectType: ref.objectType,
      objectId: ref.objectId,
      snapshotId: ref.snapshotId,
      scope: {
        enterpriseId: scope.enterpriseId,
        ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
      },
      contentHash,
    };
  }
  throw new ArtifactBusinessError(
    ARTIFACT_SCOPE_INVALID,
    `${label} has an unsupported reference kind`,
  );
}

function assertGenericContentAddressedRef(
  value: unknown,
  context: ArtifactTransactionContext,
  expectedProjectId: string | undefined,
  label: string,
): Common.ContentAddressedRef {
  const ref = canonicalObject(value, label);
  const scope = assertTrustedScope(ref.scope, context, expectedProjectId, label, 'OPTIONAL');
  const contentHash = normalizedContentHash(ref.contentHash, `${label}.contentHash`);
  if (
    typeof ref.objectType !== 'string' ||
    ref.objectType.length === 0 ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    (ref.immutableVersionId !== undefined &&
      (typeof ref.immutableVersionId !== 'string' || !isUuidV7(ref.immutableVersionId)))
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      `${label} is not a valid ContentAddressedRef`,
    );
  }
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: ref.objectType,
    objectId: ref.objectId,
    ...(ref.immutableVersionId === undefined ? {} : { immutableVersionId: ref.immutableVersionId }),
    scope: {
      enterpriseId: scope.enterpriseId,
      ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
    },
    contentHash,
  };
}

function assertObjectLocator(value: unknown, label: string): string {
  if (typeof value !== 'string' || !OBJECT_LOCATOR_PATTERN.test(value)) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURE_SCHEMA_INVALID,
      `${label} is not a safe object locator`,
    );
  }
  return value;
}

function validateJustification(value: unknown, label: string): CanonicalJsonObject {
  const justification = canonicalObject(value, label);
  if (
    typeof justification.reasonCode !== 'string' ||
    justification.reasonCode.trim().length === 0 ||
    typeof justification.summary !== 'string' ||
    justification.summary.trim().length === 0 ||
    !Array.isArray(justification.evidenceRefs)
  ) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label} is incomplete`);
  }
  return justification;
}

function requiredInvalidationFields(
  impactAssessmentRef: Common.ContentAddressedRef | undefined,
  invalidatedAt: { readonly date: Date; readonly value: string } | undefined,
): {
  readonly impactAssessmentRef: Common.ContentAddressedRef;
  readonly invalidatedAt: { readonly date: Date; readonly value: string };
} {
  if (impactAssessmentRef === undefined || invalidatedAt === undefined) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'invalidation requires impactAssessmentRef and invalidatedAt',
    );
  }
  return { impactAssessmentRef, invalidatedAt };
}

function validateProvenance(
  value: unknown,
  context: ArtifactTransactionContext,
  expectedProjectId: string | undefined,
): Artifact.RevisionProvenance {
  const provenance = canonicalObject(value, 'provenance');
  assertObjectRef(
    provenance.principal,
    context,
    expectedProjectId,
    'provenance.principal',
    ['identity.principal', 'Principal'],
    'OPTIONAL',
  );
  const principal = record(provenance.principal);
  if (principal.objectId !== context.principalId) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'provenance.principal must identify the trusted command principal',
    );
  }
  for (const [key, valueToValidate] of [
    ['actingForRef', provenance.actingForRef],
    ['taskRef', provenance.taskRef],
    ['workOrderRef', provenance.workOrderRef],
    ['runRef', provenance.runRef],
    ['agentResultRef', provenance.agentResultRef],
    ['contextSnapshotRef', provenance.contextSnapshotRef],
    ['templateBaselineRef', provenance.templateBaselineRef],
    ['regulatoryProfileRef', provenance.regulatoryProfileRef],
  ] as const) {
    if (valueToValidate !== undefined) {
      assertTypedReference(valueToValidate, context, expectedProjectId, `provenance.${key}`);
    }
  }
  if (!Array.isArray(provenance.sourceMaterialRefs)) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'provenance.sourceMaterialRefs must be an array',
    );
  }
  const sourceMaterialRefs = provenance.sourceMaterialRefs.map((ref, index) =>
    assertGenericContentAddressedRef(
      ref,
      context,
      expectedProjectId,
      `provenance.sourceMaterialRefs[${index}]`,
    ),
  );
  const sourceIdentities = new Set(
    sourceMaterialRefs.map((ref) => canonicalize(ref as unknown as CanonicalJsonValue)),
  );
  if (sourceIdentities.size !== sourceMaterialRefs.length) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, 'sourceMaterialRefs must be unique');
  }
  if (!Array.isArray(provenance.toolchainVersions)) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'provenance.toolchainVersions must be an array',
    );
  }
  return {
    ...provenance,
    principal: assertObjectRef(
      provenance.principal,
      context,
      expectedProjectId,
      'provenance.principal',
      ['identity.principal', 'Principal'],
      'OPTIONAL',
    ),
    ...(provenance.actingForRef === undefined
      ? {}
      : {
          actingForRef: assertObjectRef(
            provenance.actingForRef,
            context,
            expectedProjectId,
            'provenance.actingForRef',
            [],
            'OPTIONAL',
          ),
        }),
    ...(provenance.taskRef === undefined
      ? {}
      : {
          taskRef: assertObjectRef(
            provenance.taskRef,
            context,
            expectedProjectId,
            'provenance.taskRef',
            [],
            'OPTIONAL',
          ),
        }),
    ...(provenance.workOrderRef === undefined
      ? {}
      : {
          workOrderRef: assertObjectRef(
            provenance.workOrderRef,
            context,
            expectedProjectId,
            'provenance.workOrderRef',
            [],
            'OPTIONAL',
          ),
        }),
    ...(provenance.runRef === undefined
      ? {}
      : {
          runRef: assertObjectRef(
            provenance.runRef,
            context,
            expectedProjectId,
            'provenance.runRef',
            [],
            'OPTIONAL',
          ),
        }),
    ...(provenance.agentResultRef === undefined
      ? {}
      : {
          agentResultRef: assertGenericContentAddressedRef(
            provenance.agentResultRef,
            context,
            expectedProjectId,
            'provenance.agentResultRef',
          ),
        }),
    ...(provenance.contextSnapshotRef === undefined
      ? {}
      : {
          contextSnapshotRef: assertTypedReference(
            provenance.contextSnapshotRef,
            context,
            expectedProjectId,
            'provenance.contextSnapshotRef',
          ) as Common.SnapshotRef,
        }),
    ...(provenance.templateBaselineRef === undefined
      ? {}
      : {
          templateBaselineRef: assertVersionedRef(
            provenance.templateBaselineRef,
            context,
            expectedProjectId,
            'provenance.templateBaselineRef',
            'OPTIONAL',
          ),
        }),
    ...(provenance.regulatoryProfileRef === undefined
      ? {}
      : {
          regulatoryProfileRef: assertVersionedRef(
            provenance.regulatoryProfileRef,
            context,
            expectedProjectId,
            'provenance.regulatoryProfileRef',
            'OPTIONAL',
          ),
        }),
    sourceMaterialRefs,
    toolchainVersions: provenance.toolchainVersions.map((version) => canonicalValue(version)),
  };
}

function validateRevisionContent(
  value: unknown,
  context: ArtifactTransactionContext,
  expectedProjectId: string | undefined,
  merge: boolean,
): ValidatedRevisionContent {
  const revision = canonicalObject(value, 'revision');
  const artifactFacts = assertArtifactRef(
    revision.artifactRef,
    context,
    expectedProjectId,
    'EXACT',
  );
  if (typeof revision.branchId !== 'string' || !isUuidV7(revision.branchId)) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, 'revision.branchId must be a UUIDv7');
  }
  if (!Array.isArray(revision.parentRevisionRefs)) {
    throw new ArtifactBusinessError(
      ARTIFACT_PARENT_REQUIRED,
      'parentRevisionRefs must be an array',
    );
  }
  if (
    (!merge && revision.parentRevisionRefs.length > 1) ||
    (merge && revision.parentRevisionRefs.length < 2)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_PARENT_REQUIRED,
      merge
        ? 'merge Revision requires at least two parents'
        : 'ordinary Revision requires zero or one parent',
    );
  }
  const parentRefs = revision.parentRevisionRefs.map(
    (ref, index) =>
      assertRevisionRef(ref, context, expectedProjectId, `parentRevisionRefs[${index}]`, 'EXACT')
        .ref,
  );
  const parentIdentities = new Set(
    parentRefs.map((ref) => canonicalize(ref as unknown as CanonicalJsonValue)),
  );
  if (parentIdentities.size !== parentRefs.length) {
    throw new ArtifactBusinessError(
      ARTIFACT_PARENT_REQUIRED,
      'parentRevisionRefs must not contain duplicates',
    );
  }
  if (revision.contentType !== 'STRUCTURED_DOCUMENT' && revision.contentType !== 'WORKBOOK_SPEC') {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURE_SCHEMA_INVALID,
      'WI-05 Revision contentType must be backed by a Canonical Content Object Manifest',
    );
  }
  const contentLocator = assertObjectLocator(revision.contentRef, 'revision.contentRef');
  const contentHash = normalizedContentHash(revision.contentHash, 'revision.contentHash');
  const structureSchemaRef = assertVersionedRef(
    revision.structureSchemaRef,
    context,
    expectedProjectId,
    'structureSchemaRef',
    'OPTIONAL',
  );
  const semanticMetadata = canonicalValue(revision.semanticMetadata);
  if (!Array.isArray(revision.changedUnits) || revision.changedUnits.length === 0) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURE_SCHEMA_INVALID,
      'changedUnits must be non-empty',
    );
  }
  const changedUnits = revision.changedUnits.map((unit, index) =>
    nonEmptyString(unit, `changedUnits[${index}]`),
  );
  if (new Set(changedUnits).size !== changedUnits.length) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURE_SCHEMA_INVALID,
      'changedUnits must be unique',
    );
  }
  const changeSummary = nonEmptyString(revision.changeSummary, 'changeSummary');
  return {
    artifactId: artifactFacts.artifactId,
    ...(artifactFacts.projectId === undefined ? {} : { projectId: artifactFacts.projectId }),
    branchId: revision.branchId,
    parentRefs,
    contentType: revision.contentType,
    contentLocator,
    contentHash,
    contentHashBytes: hashBytes(contentHash),
    structureSchemaRef,
    semanticMetadata,
    changedUnits,
    changeSummary,
    provenance: validateProvenance(revision.provenance, context, expectedProjectId),
  };
}

function validateMerge(
  value: unknown,
  context: ArtifactTransactionContext,
  expectedProjectId: string | undefined,
): ValidatedMerge {
  const merge = canonicalObject(value, 'merge');
  const revision = validateRevisionContent(merge.revision, context, expectedProjectId, true);
  const mergeStrategy = nonEmptyString(merge.mergeStrategy, 'mergeStrategy');
  if (!Array.isArray(merge.conflictSet)) {
    throw new ArtifactBusinessError(
      ARTIFACT_MERGE_CONFLICT_UNRESOLVED,
      'conflictSet must be an array',
    );
  }
  const conflictSet = merge.conflictSet.map((item) => canonicalValue(item));
  if (!Array.isArray(merge.conflictResolutionRefs)) {
    throw new ArtifactBusinessError(
      ARTIFACT_MERGE_CONFLICT_UNRESOLVED,
      'conflictResolutionRefs must be an array',
    );
  }
  if (conflictSet.length > 0 && merge.conflictResolutionRefs.length === 0) {
    throw new ArtifactBusinessError(
      ARTIFACT_MERGE_CONFLICT_UNRESOLVED,
      'every non-empty conflict set requires explicit resolution references',
    );
  }
  const conflictResolutionRefs = merge.conflictResolutionRefs.map((ref, index) =>
    assertTypedReference(ref, context, expectedProjectId, `conflictResolutionRefs[${index}]`),
  );
  const resolvedBy = assertObjectRef(
    merge.resolvedBy,
    context,
    expectedProjectId,
    'resolvedBy',
    ['identity.principal', 'Principal'],
    'OPTIONAL',
  );
  if (context.principalKind !== 'HUMAN' || resolvedBy.objectId !== context.principalId) {
    throw new ArtifactBusinessError(
      ARTIFACT_HUMAN_ONLY_DENIED,
      'merge resolution requires the trusted HUMAN command principal',
    );
  }
  return { revision, mergeStrategy, conflictSet, conflictResolutionRefs, resolvedBy };
}

function validateHeadMove(
  value: unknown,
  context: ArtifactTransactionContext,
  expectedProjectId: string | undefined,
  expectedVersion: string,
): ValidatedHeadMove {
  const payload = canonicalObject(value, 'moveWorkingHead payload');
  if (payload.expectedAggregateVersion !== undefined) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'Branch head expected version must be supplied in the command envelope',
    );
  }
  if (typeof payload.branchId !== 'string' || !isUuidV7(payload.branchId)) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, 'branchId must be a UUIDv7');
  }
  const newHead = assertRevisionRef(
    payload.newHeadRef,
    context,
    expectedProjectId,
    'newHeadRef',
    'EXACT',
  );
  const expectedHead =
    payload.expectedHeadRef === undefined
      ? undefined
      : assertRevisionRef(
          payload.expectedHeadRef,
          context,
          expectedProjectId,
          'expectedHeadRef',
          'EXACT',
        );
  return {
    branchId: payload.branchId,
    expectedVersion,
    ...(expectedHead === undefined ? {} : { expectedHeadRef: expectedHead.ref }),
    newHeadRef: newHead.ref,
    moveReason: validateJustification(payload.moveReason, 'moveReason'),
  };
}

function parseInstant(
  value: unknown,
  label: string,
): { readonly date: Date; readonly value: string } {
  const instant = nonEmptyString(value, label);
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label} must be a valid UTC instant`);
  }
  return { date, value: instant };
}

function exactTargetType(value: string, allowed: ReadonlySet<string>, label: string): void {
  if (!allowed.has(value)) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      `${label} has an unsupported target type`,
    );
  }
}

function removeExpectedVersion(envelope: CommandEnvelope): CommandEnvelope {
  const withoutExpectedVersion = { ...envelope };
  delete withoutExpectedVersion.expectedAggregateVersion;
  return withoutExpectedVersion;
}

function rootScope(root: { enterprise_id: string; project_id: string | null }): Common.ScopeRef {
  return root.project_id === null
    ? { enterpriseId: root.enterprise_id }
    : { enterpriseId: root.enterprise_id, projectId: root.project_id };
}

function artifactRefForRoot(root: {
  artifact_id: string;
  enterprise_id: string;
  project_id: string | null;
}): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: ROOT_OBJECT_TYPE,
    objectId: root.artifact_id,
    scope: rootScope(root),
  };
}

function contentHashForBytes(value: Buffer): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: value.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function revisionRefForRow(
  row: {
    revision_id: string;
    content_hash: Buffer;
  },
  root: { enterprise_id: string; project_id: string | null },
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: REVISION_REF_OBJECT_TYPE,
    objectId: row.revision_id,
    scope: rootScope(root),
    contentHash: contentHashForBytes(row.content_hash),
  };
}

function jsonColumn(value: unknown, label: string): CanonicalJsonValue {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed as CanonicalJsonValue;
    } catch {
      throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, `${label} is invalid stored JSON`);
    }
  }
  return canonicalValue(value, ARTIFACT_QUERY_NOT_FOUND);
}

function safePositiveInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(String(value));
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, `${label} is outside the read model`);
  }
  return parsed;
}

function safeNonNegativeInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(String(value));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, `${label} is outside the read model`);
  }
  return parsed;
}

function int8String(value: unknown, label: string): string {
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'bigint' && value >= 0n) return value.toString();
  throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, `${label} is outside the read model`);
}

function eventScopePayload(
  enterpriseId: string,
  projectId: string | undefined,
): CanonicalJsonObject {
  return projectId === undefined ? { enterpriseId } : { enterpriseId, projectId };
}

function rejected(
  errorCode: string,
  safeSummary: string,
  currentAggregateVersion?: string,
): CommandBodyResult {
  return {
    kind: 'REJECTED',
    errorCode,
    safeSummary,
    ...(currentAggregateVersion === undefined ? {} : { currentAggregateVersion }),
  };
}

function revisionCreateRejection(
  outcome: ArtifactRevisionCreateOutcome,
  currentVersion: string,
): CommandBodyResult {
  switch (outcome) {
    case 'NOT_ACTIVE':
      return rejected(ARTIFACT_NOT_ACTIVE, 'Artifact or Branch is not active', currentVersion);
    case 'CONTENT_NOT_FROZEN':
      return rejected(
        ARTIFACT_CONTENT_STATE_INVALID,
        'Revision requires a FROZEN Content Object Manifest',
      );
    case 'CONTENT_HASH_MISMATCH':
      return rejected(
        ARTIFACT_CONTENT_HASH_MISMATCH,
        'Revision content identity does not match the FROZEN Manifest',
      );
    case 'CONTENT_LINK_CONFLICT':
      return rejected(
        ARTIFACT_CONTENT_OWNER_INVALID,
        'Content Object is already linked to another Revision owner',
      );
    case 'PARENT_REQUIRED':
    case 'PARENT_INVALID':
    case 'PARENT_DUPLICATE':
      return rejected(
        ARTIFACT_PARENT_REQUIRED,
        'Revision parent cardinality or exact parent reference is invalid',
      );
    case 'CROSS_ARTIFACT_PARENT':
      return rejected(
        ARTIFACT_CROSS_ARTIFACT_PARENT,
        'Revision parents must belong to the same Artifact and Scope',
      );
    case 'LINEAGE_CYCLE':
      return rejected(ARTIFACT_LINEAGE_CYCLE, 'Revision parents would create a lineage cycle');
    case 'CONFLICT_INVALID':
      return rejected(
        ARTIFACT_MERGE_CONFLICT_UNRESOLVED,
        'Merge conflict resolution facts are incomplete',
      );
    case 'NOT_FOUND':
      return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Artifact, Branch or Content Object was not found');
    case 'CONTEXT_REJECTED':
      return rejected(ARTIFACT_SCOPE_INVALID, 'trusted transaction context was rejected');
    case 'CONFLICT':
      return rejected(ARTIFACT_REVISION_IMMUTABLE, 'Revision identity is already occupied');
    case 'OK':
      return rejected(ARTIFACT_SCOPE_INVALID, 'unexpected Revision create outcome');
  }
}

function headMoveRejection(
  outcome: ArtifactHeadMoveOutcome,
  currentVersion: string,
): CommandBodyResult {
  switch (outcome) {
    case 'CONFLICT':
      return rejected(
        ARTIFACT_BRANCH_HEAD_CONFLICT,
        'Branch head expected version or ref is stale',
        currentVersion,
      );
    case 'NOT_ACTIVE':
      return rejected(ARTIFACT_NOT_ACTIVE, 'Artifact or Branch is not active', currentVersion);
    case 'INVALID_REF':
      return rejected(
        ARTIFACT_CONTENT_HASH_MISMATCH,
        'newHeadRef is not an exact Revision identity',
      );
    case 'NOT_FOUND':
      return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Artifact Branch was not found');
    case 'ALREADY':
      return rejected(
        ARTIFACT_BRANCH_HEAD_CONFLICT,
        'newHeadRef is already the current Branch head',
        currentVersion,
      );
    case 'OK':
      return rejected(ARTIFACT_SCOPE_INVALID, 'unexpected Branch head outcome');
  }
}

async function readArtifactFacts(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  artifactId: string,
  branchId?: string,
): Promise<{
  readonly root: NonNullable<Awaited<ReturnType<ArtifactRepository['getArtifactById']>>>;
  readonly branch?: Awaited<ReturnType<ArtifactRepository['getArtifactBranchById']>>;
}> {
  if (context.authorizationDecisionExpiresAt.getTime() <= Date.now()) {
    throw new CommandExecutionError('COMMAND_CONTEXT_EXPIRED', 'authorization decision is expired');
  }
  return withArtifactTransaction(db, context, async (trx) => {
    const root = await repo.getArtifactById(trx, artifactId);
    if (root === undefined) {
      throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Artifact was not found');
    }
    const branch =
      branchId === undefined ? undefined : await repo.getArtifactBranchById(trx, branchId);
    return { root, ...(branch === undefined ? {} : { branch }) };
  });
}

async function readRevisionFacts(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  revisionId: string,
): Promise<RevisionFacts> {
  if (context.authorizationDecisionExpiresAt.getTime() <= Date.now()) {
    throw new CommandExecutionError('COMMAND_CONTEXT_EXPIRED', 'authorization decision is expired');
  }
  return withArtifactTransaction(db, context, async (trx) => {
    const revision = await repo.getRevisionById(trx, revisionId);
    if (revision === undefined) {
      throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Revision was not found');
    }
    const root = await repo.getArtifactById(trx, revision.artifact_id);
    if (root === undefined) {
      throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Revision Artifact was not found');
    }
    return { revision, root };
  });
}

async function revisionSnapshotInTransaction(
  trx: ArtifactTransaction,
  row: NonNullable<Awaited<ReturnType<ArtifactRepository['getRevisionById']>>>,
  root: NonNullable<Awaited<ReturnType<ArtifactRepository['getArtifactById']>>>,
  parentRows?: readonly Awaited<ReturnType<ArtifactRepository['getRevisionParents']>>[number][],
): Promise<Artifact.RevisionSnapshot> {
  const parents = parentRows ?? (await repo.getRevisionParents(trx, row.revision_id));
  const parentRevisionRows = new Map<
    string,
    NonNullable<Awaited<ReturnType<ArtifactRepository['getRevisionById']>>>
  >();
  for (const parent of parents) {
    const parentRow = await repo.getRevisionById(trx, parent.parent_revision_id);
    if (parentRow === undefined) {
      throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Revision parent was not found');
    }
    parentRevisionRows.set(parent.parent_revision_id, parentRow);
  }
  const governance = await repo.getRevisionGovernance(trx, row.revision_id);
  const disposition: Artifact.RevisionDisposition =
    governance.invalidation !== undefined
      ? 'INVALIDATED'
      : governance.withdrawal !== undefined
        ? 'WITHDRAWN'
        : 'ACTIVE';
  const changedUnitsValue = jsonColumn(row.changed_units, 'changedUnits');
  if (!Array.isArray(changedUnitsValue)) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'stored changedUnits is invalid');
  }
  const changedUnits = changedUnitsValue.map((value, index) =>
    nonEmptyString(value, `stored changedUnits[${index}]`),
  );
  const parentRevisionRefs = parents.map((parent) => {
    const parentRow = parentRevisionRows.get(parent.parent_revision_id);
    if (parentRow === undefined) {
      throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Revision parent was not found');
    }
    return revisionRefForRow(parentRow, root);
  });
  return {
    revisionRef: revisionRefForRow(row, root),
    revisionNumber: safePositiveInteger(row.revision_no, 'revisionNumber'),
    disposition,
    contentType: row.content_type,
    contentRef: row.object_locator,
    parentRevisionRefs,
    changedUnits,
    semanticMetadata: jsonColumn(row.semantic_metadata, 'semanticMetadata'),
    provenance: jsonColumn(row.provenance, 'provenance') as unknown as Artifact.RevisionProvenance,
  };
}

async function appendTypedReferenceEdge(
  execution: Parameters<Parameters<typeof executeArtifactCommand>[3]>[0],
  owner: {
    readonly ownerObjectId: string;
    readonly ownerPayloadHash: Buffer;
    readonly ownerObjectType?: string;
  },
  referencePath: string,
  value: unknown,
  referencePurpose: string,
): Promise<void> {
  const ref = record(value);
  if (
    (ref.kind !== 'OBJECT' &&
      ref.kind !== 'VERSIONED' &&
      ref.kind !== 'CONTENT_ADDRESSED' &&
      ref.kind !== 'SNAPSHOT') ||
    typeof ref.objectType !== 'string' ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId)
  ) {
    return;
  }
  const targetVersionId =
    ref.kind === 'VERSIONED'
      ? typeof ref.versionId === 'string'
        ? ref.versionId
        : undefined
      : ref.kind === 'SNAPSHOT'
        ? typeof ref.snapshotId === 'string'
          ? ref.snapshotId
          : undefined
        : undefined;
  const targetHash =
    ref.kind === 'CONTENT_ADDRESSED' || ref.kind === 'SNAPSHOT'
      ? (() => {
          try {
            return hashBytes(
              normalizedContentHash(ref.contentHash, `${referencePath}.contentHash`),
            );
          } catch {
            return undefined;
          }
        })()
      : undefined;
  await execution.appendReferenceEdge({
    ownerObjectType: owner.ownerObjectType ?? REVISION_OBJECT_TYPE,
    ownerObjectId: owner.ownerObjectId,
    ownerVersionId: owner.ownerObjectId,
    ownerPayloadHash: owner.ownerPayloadHash,
    referencePath,
    targetModule:
      ref.objectType.startsWith('identity.') || ref.objectType.startsWith('zhiju.identity.')
        ? 'identity_policy'
        : ref.objectType.startsWith('project.') || ref.objectType.startsWith('enterprise.')
          ? 'enterprise_project'
          : ref.objectType.startsWith('task.') ||
              ref.objectType.startsWith('execution.') ||
              ref.objectType.startsWith('zhiju.execution.')
            ? 'task_execution'
            : ref.objectType.startsWith('artifact.')
              ? 'artifact'
              : 'artifact',
    targetObjectType: ref.objectType,
    targetObjectId: ref.objectId,
    ...(targetVersionId === undefined ? {} : { targetVersionId }),
    ...(targetHash === undefined ? {} : { targetPayloadHash: targetHash }),
    referencePurpose,
  });
}

async function appendRevisionEdges(
  execution: Parameters<Parameters<typeof executeArtifactCommand>[3]>[0],
  root: NonNullable<Awaited<ReturnType<ArtifactRepository['getArtifactById']>>>,
  row: NonNullable<Awaited<ReturnType<ArtifactRepository['getRevisionById']>>>,
  contentObjectId: string,
  structureSchemaRef: Common.VersionedRef,
  parentRefs: readonly Common.ContentAddressedRef[],
  provenance: Artifact.RevisionProvenance,
  resultHash: Buffer,
  ownerObjectType = REVISION_OBJECT_TYPE,
): Promise<void> {
  const owner = { ownerObjectId: row.revision_id, ownerPayloadHash: resultHash, ownerObjectType };
  await execution.appendReferenceEdge({
    ownerObjectType,
    ownerObjectId: row.revision_id,
    ownerVersionId: row.revision_id,
    ownerPayloadHash: resultHash,
    referencePath: '/revision/artifactRef',
    targetModule: 'artifact',
    targetObjectType: ROOT_OBJECT_TYPE,
    targetObjectId: root.artifact_id,
    referencePurpose: 'ARTIFACT_REVISION_ROOT',
  });
  await execution.appendReferenceEdge({
    ownerObjectType,
    ownerObjectId: row.revision_id,
    ownerVersionId: row.revision_id,
    ownerPayloadHash: resultHash,
    referencePath: '/revision/contentRef',
    targetModule: 'artifact',
    targetObjectType: 'CanonicalContentObject',
    targetObjectId: contentObjectId,
    targetPayloadHash: row.content_hash,
    referencePurpose: 'ARTIFACT_REVISION_CONTENT',
  });
  await appendTypedReferenceEdge(
    execution,
    owner,
    '/revision/structureSchemaRef',
    structureSchemaRef,
    'ARTIFACT_REVISION_SCHEMA',
  );
  for (const [index, parentRef] of parentRefs.entries()) {
    await appendTypedReferenceEdge(
      execution,
      owner,
      `/revision/parentRevisionRefs/${index}`,
      parentRef,
      'ARTIFACT_REVISION_PARENT',
    );
  }
  for (const [key, value] of [
    ['actingForRef', provenance.actingForRef],
    ['taskRef', provenance.taskRef],
    ['workOrderRef', provenance.workOrderRef],
    ['runRef', provenance.runRef],
    ['agentResultRef', provenance.agentResultRef],
    ['contextSnapshotRef', provenance.contextSnapshotRef],
    ['templateBaselineRef', provenance.templateBaselineRef],
    ['regulatoryProfileRef', provenance.regulatoryProfileRef],
  ] as const) {
    if (value !== undefined) {
      await appendTypedReferenceEdge(
        execution,
        owner,
        `/revision/provenance/${key}`,
        value,
        'ARTIFACT_REVISION_PROVENANCE',
      );
    }
  }
  for (const [index, sourceMaterialRef] of provenance.sourceMaterialRefs.entries()) {
    await appendTypedReferenceEdge(
      execution,
      owner,
      `/revision/provenance/sourceMaterialRefs/${index}`,
      sourceMaterialRef,
      'ARTIFACT_REVISION_SOURCE_MATERIAL',
    );
  }
}

async function createRevisionCommand(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: RevisionCommandEnvelope<CreateAndSealRevisionPayload | CreateMergeRevisionPayload>,
  merge: boolean,
): Promise<CommandResult> {
  const payloadRecord = record(envelope.payload);
  const rawRevision = merge
    ? record(record(payloadRecord.merge).revision)
    : record(payloadRecord.revision);
  const artifactFacts = assertArtifactRef(rawRevision.artifactRef, context);
  const facts = await readArtifactFacts(db, context, artifactFacts.artifactId);
  const expectedProjectId = facts.root.project_id ?? undefined;
  const validated = merge
    ? undefined
    : validateRevisionContent(rawRevision, context, expectedProjectId, false);
  const validatedMerge = merge
    ? validateMerge(payloadRecord.merge, context, expectedProjectId)
    : undefined;
  let revision: ValidatedRevisionContent;
  if (merge) {
    if (validatedMerge === undefined) {
      throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, 'Merge definition was not validated');
    }
    revision = validatedMerge.revision;
  } else {
    if (validated === undefined) {
      throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, 'Revision content was not validated');
    }
    revision = validated;
  }
  if (revision.artifactId !== facts.root.artifact_id) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Revision Artifact was not found');
  }
  const revisionId = (() => {
    exactTargetType(
      envelope.targetType,
      new Set([...ROOT_OBJECT_TYPES, ...REVISION_OBJECT_TYPES]),
      'Revision create command',
    );
    if (REVISION_OBJECT_TYPES.has(envelope.targetType)) {
      if (!isUuidV7(envelope.targetId)) {
        throw new CommandExecutionError(
          'COMMAND_TARGET_MISMATCH',
          'Revision target must be a UUIDv7',
        );
      }
      return envelope.targetId;
    }
    if (envelope.targetId !== facts.root.artifact_id) {
      throw new CommandExecutionError(
        'COMMAND_TARGET_MISMATCH',
        'Artifact-targeted Revision creation must identify the referenced Artifact',
      );
    }
    return newUuidV7();
  })();
  const normalizedEnvelope = {
    ...removeExpectedVersion(envelope),
    projectId: expectedProjectId,
    targetType: REVISION_OBJECT_TYPE,
    targetId: revisionId,
  } satisfies CommandEnvelope;
  return executeArtifactCommand(db, context, normalizedEnvelope, async (execution) => {
    const currentRoot = await repo.getArtifactById(execution.trx, facts.root.artifact_id);
    if (currentRoot === undefined)
      return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Artifact was not found');
    const currentVersion = int8String(currentRoot.aggregate_version, 'aggregateVersion');
    if (currentRoot.lifecycle_status !== 'ACTIVE') {
      return rejected(ARTIFACT_NOT_ACTIVE, 'Artifact is not active', currentVersion);
    }
    const branch = await repo.getArtifactBranchById(execution.trx, revision.branchId);
    if (branch === undefined) {
      return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Revision Branch was not found');
    }
    if (
      branch.artifact_id !== currentRoot.artifact_id ||
      branch.project_id !== currentRoot.project_id
    ) {
      return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Revision Branch was not found');
    }
    const contentObject = await repo.getFrozenContentObjectByIdentity(execution.trx, {
      enterpriseId: currentRoot.enterprise_id,
      projectId: currentRoot.project_id ?? undefined,
      contentType: revision.contentType,
      objectLocator: revision.contentLocator,
      contentHash: revision.contentHashBytes,
    });
    if (contentObject === undefined) {
      return rejected(
        ARTIFACT_CONTENT_STATE_INVALID,
        'Revision requires an exact FROZEN Content Object Manifest',
      );
    }
    const manifestSchemaRef = jsonColumn(contentObject.payload_schema_ref, 'payloadSchemaRef');
    if (
      canonicalize(manifestSchemaRef) !==
      canonicalize(revision.structureSchemaRef as unknown as CanonicalJsonValue)
    ) {
      return rejected(
        ARTIFACT_STRUCTURE_SCHEMA_INVALID,
        'Revision structureSchemaRef must match the FROZEN Manifest SchemaRef',
      );
    }
    const mergeFields =
      validatedMerge === undefined
        ? {
            mergeStrategy: undefined,
            conflictSet: [],
            conflictResolutionRefs: [],
            resolvedByRef: undefined,
            conflictId: undefined,
            conflictHash: undefined,
          }
        : (() => {
            const conflictPayload = {
              revisionId,
              mergeStrategy: validatedMerge.mergeStrategy,
              conflictSet: validatedMerge.conflictSet,
              conflictResolutionRefs: validatedMerge.conflictResolutionRefs,
              resolvedBy: validatedMerge.resolvedBy,
            } as unknown as CanonicalJsonObject;
            return {
              mergeStrategy: validatedMerge.mergeStrategy,
              conflictSet: validatedMerge.conflictSet,
              conflictResolutionRefs: validatedMerge.conflictResolutionRefs,
              resolvedByRef: validatedMerge.resolvedBy,
              conflictId: validatedMerge.conflictSet.length === 0 ? undefined : newUuidV7(),
              conflictHash:
                validatedMerge.conflictSet.length === 0
                  ? undefined
                  : digestCanonicalPayload(conflictPayload).hash,
            };
          })();
    const created = await repo.createArtifactRevision(execution.trx, {
      revisionId,
      artifactId: currentRoot.artifact_id,
      branchId: revision.branchId,
      enterpriseId: currentRoot.enterprise_id,
      projectId: currentRoot.project_id ?? undefined,
      revisionKind: merge ? 'MERGE' : revision.parentRefs.length === 0 ? 'INITIAL' : 'ORDINARY',
      contentObjectId: contentObject.content_object_id,
      contentType: revision.contentType,
      objectLocator: revision.contentLocator,
      contentHash: revision.contentHashBytes,
      structureSchemaRef: revision.structureSchemaRef,
      canonicalizationVersion: contentObject.canonicalization_version,
      byteSize: safeNonNegativeInteger(contentObject.byte_size, 'byteSize'),
      mediaType: contentObject.media_type,
      semanticMetadata: revision.semanticMetadata,
      changedUnits: revision.changedUnits,
      changeSummary: revision.changeSummary,
      provenance: revision.provenance,
      parentRefs: revision.parentRefs,
      ...mergeFields,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (created.outcome !== 'OK') return revisionCreateRejection(created.outcome, currentVersion);
    const createdRow = await repo.getRevisionById(execution.trx, revisionId);
    if (createdRow === undefined) throw new Error('Revision disappeared after create');
    const snapshot = await revisionSnapshotInTransaction(execution.trx, createdRow, currentRoot);
    const resultPayload = snapshot as unknown as CanonicalJsonObject;
    const resultDigest = digestCanonicalPayload(resultPayload);
    const eventPayload = merge
      ? (() => {
          if (validatedMerge === undefined) {
            throw new ArtifactBusinessError(
              ARTIFACT_SCOPE_INVALID,
              'Merge definition was not validated',
            );
          }
          return {
            ...eventScopePayload(currentRoot.enterprise_id, currentRoot.project_id ?? undefined),
            artifactRef: artifactRefForRoot(currentRoot),
            revisionRef: snapshot.revisionRef,
            parentRevisionRefs: snapshot.parentRevisionRefs,
            mergeStrategy: validatedMerge.mergeStrategy,
          } as unknown as CanonicalJsonObject;
        })()
      : ({
          ...eventScopePayload(currentRoot.enterprise_id, currentRoot.project_id ?? undefined),
          artifactRef: artifactRefForRoot(currentRoot),
          revisionRef: snapshot.revisionRef,
          branchId: revision.branchId,
          parentRevisionRefs: snapshot.parentRevisionRefs,
          changedUnits: snapshot.changedUnits,
        } as unknown as CanonicalJsonObject);
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: merge ? 'artifact.MergeRevisionCreated' : 'artifact.ArtifactRevisionSealed',
      eventVersion: '1.0',
      aggregateType: REVISION_OBJECT_TYPE,
      aggregateId: revisionId,
      aggregateVersion: '1',
      payload: eventPayload,
      occurredAt: new Date(),
    });
    await appendRevisionEdges(
      execution,
      currentRoot,
      createdRow,
      contentObject.content_object_id,
      revision.structureSchemaRef,
      revision.parentRefs,
      revision.provenance,
      resultDigest.hash,
    );
    if (!merge && record(payloadRecord).creationCommandRef !== undefined) {
      await appendTypedReferenceEdge(
        execution,
        { ownerObjectId: revisionId, ownerPayloadHash: resultDigest.hash },
        '/creationCommandRef',
        record(payloadRecord).creationCommandRef,
        'ARTIFACT_REVISION_CREATION_COMMAND',
      );
    }
    return { kind: 'COMMITTED', resultPayload };
  });
}

export function validateArtifactRevisionContent(
  value: unknown,
  context: ArtifactTransactionContext,
  expectedProjectId?: string,
): ValidatedRevisionContent {
  return validateRevisionContent(value, context, expectedProjectId, false);
}

export function validateArtifactMergeDefinition(
  value: unknown,
  context: ArtifactTransactionContext,
  expectedProjectId?: string,
): ValidatedMerge {
  return validateMerge(value, context, expectedProjectId);
}

export async function handleCreateAndSealRevision(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: RevisionCommandEnvelope<CreateAndSealRevisionPayload>,
): Promise<CommandResult> {
  return createRevisionCommand(db, context, envelope, false);
}

export async function handleCreateMergeRevision(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: RevisionCommandEnvelope<CreateMergeRevisionPayload>,
): Promise<CommandResult> {
  if (context.principalKind !== 'HUMAN') {
    throw new ArtifactBusinessError(
      ARTIFACT_HUMAN_ONLY_DENIED,
      'merge resolution requires a HUMAN principal',
    );
  }
  return createRevisionCommand(db, context, envelope, true);
}

export async function handleMoveWorkingHead(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: RevisionCommandEnvelope<MoveWorkingHeadPayload>,
): Promise<CommandResult> {
  exactTargetType(envelope.targetType, ROOT_OBJECT_TYPES, 'Branch head command');
  if (!isUuidV7(envelope.targetId)) {
    throw new CommandExecutionError('COMMAND_TARGET_MISMATCH', 'Artifact target must be a UUIDv7');
  }
  const payload = record(envelope.payload);
  const branchId = payload.branchId;
  if (typeof branchId !== 'string' || !isUuidV7(branchId)) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, 'branchId must be a UUIDv7');
  }
  const facts = await readArtifactFacts(db, context, envelope.targetId, branchId);
  if (facts.branch?.artifact_id !== facts.root.artifact_id) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Artifact Branch was not found');
  }
  const expectedVersion = envelope.expectedAggregateVersion;
  if (expectedVersion === undefined) {
    throw new CommandExecutionError(
      ARTIFACT_EXPECTED_VERSION_REQUIRED,
      'Branch head CAS requires expectedAggregateVersion',
    );
  }
  const validated = validateHeadMove(
    envelope.payload,
    context,
    facts.root.project_id ?? undefined,
    expectedVersion,
  );
  if (validated.expectedVersion !== expectedVersion) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'Branch head expected version must match the envelope',
    );
  }
  const normalizedEnvelope = {
    ...envelope,
    projectId: facts.root.project_id ?? undefined,
    targetType: ROOT_OBJECT_TYPE,
    targetId: facts.root.artifact_id,
    expectedAggregateVersion: expectedVersion,
  } satisfies CommandEnvelope;
  return executeArtifactCommand(db, context, normalizedEnvelope, async (execution) => {
    const root = await repo.getArtifactById(execution.trx, facts.root.artifact_id);
    const branch = await repo.getArtifactBranchById(execution.trx, validated.branchId);
    if (root === undefined || branch === undefined)
      return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Artifact Branch was not found');
    const currentVersion = int8String(branch.head_version, 'headVersion');
    const conflictPayload = {
      artifactRef: artifactRefForRoot(root),
      branchId: validated.branchId,
      expectedVersion,
      expectedHeadRef: validated.expectedHeadRef ?? null,
      candidateHeadRef: validated.newHeadRef,
      reasonCode: validated.moveReason.reasonCode,
    } as unknown as CanonicalJsonObject;
    const outcome = await repo.moveWorkingHead(execution.trx, {
      artifactId: root.artifact_id,
      branchId: validated.branchId,
      expectedVersion,
      expectedHeadRef: validated.expectedHeadRef,
      newHeadRef: validated.newHeadRef,
      enterpriseId: root.enterprise_id,
      projectId: root.project_id ?? undefined,
      conflictId: newUuidV7(),
      conflictPayload,
      conflictHash: digestCanonicalPayload(conflictPayload).hash,
      updatedByPrincipalId: envelope.principalId,
      updatedByActorSnapshotId: envelope.actorSnapshotId,
      lastAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (outcome !== 'OK') {
      const currentBranch = await repo.getArtifactBranchById(execution.trx, validated.branchId);
      const observedVersion =
        currentBranch === undefined
          ? currentVersion
          : int8String(currentBranch.head_version, 'headVersion');
      return headMoveRejection(outcome, observedVersion);
    }
    const updatedBranch = await repo.getArtifactBranchById(execution.trx, validated.branchId);
    if (updatedBranch === undefined) throw new Error('Branch disappeared after head CAS');
    const resultPayload = {
      artifactRef: artifactRefForRoot(root),
      branchId: updatedBranch.branch_id,
      workingHeadRef: validated.newHeadRef,
      headVersion: safeNonNegativeInteger(updatedBranch.head_version, 'headVersion'),
      moveReason: validated.moveReason,
    } as unknown as CanonicalJsonObject;
    const resultDigest = digestCanonicalPayload(resultPayload);
    const eventPayload = {
      ...eventScopePayload(root.enterprise_id, root.project_id ?? undefined),
      artifactRef: artifactRefForRoot(root),
      branchId: updatedBranch.branch_id,
      newHeadRef: validated.newHeadRef,
      headVersion: updatedBranch.head_version,
      moveReasonCode: validated.moveReason.reasonCode,
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'artifact.ArtifactBranchHeadMoved',
      eventVersion: '1.0',
      aggregateType: ROOT_OBJECT_TYPE,
      aggregateId: root.artifact_id,
      aggregateVersion: int8String(updatedBranch.head_version, 'headVersion'),
      payload: eventPayload,
      occurredAt: new Date(),
    });
    await execution.appendReferenceEdge({
      ownerObjectType: ROOT_OBJECT_TYPE,
      ownerObjectId: root.artifact_id,
      ownerVersionId: updatedBranch.branch_id,
      ownerPayloadHash: resultDigest.hash,
      referencePath: `/branches/${updatedBranch.branch_id}/workingHeadRef`,
      targetModule: 'artifact',
      targetObjectType: REVISION_OBJECT_TYPE,
      targetObjectId: validated.newHeadRef.objectId,
      targetPayloadHash: hashBytes(validated.newHeadRef.contentHash),
      referencePurpose: 'ARTIFACT_BRANCH_HEAD',
    });
    return { kind: 'COMMITTED', resultPayload };
  });
}

async function governRevision(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: RevisionCommandEnvelope<WithdrawRevisionPayload | InvalidateRevisionPayload>,
  invalidate: boolean,
): Promise<CommandResult> {
  exactTargetType(envelope.targetType, REVISION_OBJECT_TYPES, 'Revision governance command');
  if (!isUuidV7(envelope.targetId)) {
    throw new CommandExecutionError('COMMAND_TARGET_MISMATCH', 'Revision target must be a UUIDv7');
  }
  if (context.principalKind !== 'HUMAN') {
    throw new ArtifactBusinessError(
      ARTIFACT_HUMAN_ONLY_DENIED,
      'Revision governance requires a HUMAN principal',
    );
  }
  const facts = await readRevisionFacts(db, context, envelope.targetId);
  const expectedProjectId = facts.root.project_id ?? undefined;
  const payload = record(envelope.payload);
  const reason = validateJustification(
    invalidate ? payload.invalidationReason : payload.withdrawalReason,
    invalidate ? 'invalidationReason' : 'withdrawalReason',
  );
  const impactAssessmentRef =
    payload.impactAssessmentRef === undefined
      ? undefined
      : assertGenericContentAddressedRef(
          payload.impactAssessmentRef,
          context,
          expectedProjectId,
          'impactAssessmentRef',
        );
  if (invalidate && impactAssessmentRef === undefined) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'invalidation requires impactAssessmentRef',
    );
  }
  const invalidatedAt = invalidate
    ? parseInstant(payload.invalidatedAt, 'invalidatedAt')
    : undefined;
  const invalidationFields = invalidate
    ? requiredInvalidationFields(impactAssessmentRef, invalidatedAt)
    : undefined;
  const withdrawnAt = invalidate ? undefined : new Date();
  const normalizedEnvelope = {
    ...removeExpectedVersion(envelope),
    projectId: expectedProjectId,
    targetType: REVISION_OBJECT_TYPE,
    targetId: facts.revision.revision_id,
  } satisfies CommandEnvelope;
  return executeArtifactCommand(db, context, normalizedEnvelope, async (execution) => {
    const row = await repo.getRevisionById(execution.trx, facts.revision.revision_id);
    const root = await repo.getArtifactById(execution.trx, facts.root.artifact_id);
    if (row === undefined || root === undefined)
      return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Revision was not found');
    const revisionRef = revisionRefForRow(row, root);
    let governanceOutcome: RevisionGovernanceOutcome;
    if (invalidate) {
      if (invalidationFields === undefined) {
        throw new ArtifactBusinessError(
          ARTIFACT_SCOPE_INVALID,
          'invalidation fields were not validated',
        );
      }
      governanceOutcome = await repo.invalidateRevision(execution.trx, {
        factId: newUuidV7(),
        revisionId: row.revision_id,
        artifactId: root.artifact_id,
        enterpriseId: root.enterprise_id,
        projectId: root.project_id ?? undefined,
        revisionRef,
        revisionHash: row.content_hash,
        reason,
        impactAssessmentRef: invalidationFields.impactAssessmentRef,
        occurredAt: invalidationFields.invalidatedAt.date,
        recordedByPrincipalId: envelope.principalId,
        recordedByActorSnapshotId: envelope.actorSnapshotId,
        recordedAuthorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
    } else {
      governanceOutcome = await repo.withdrawRevision(execution.trx, {
        factId: newUuidV7(),
        revisionId: row.revision_id,
        artifactId: root.artifact_id,
        enterpriseId: root.enterprise_id,
        projectId: root.project_id ?? undefined,
        revisionRef,
        revisionHash: row.content_hash,
        reason,
        ...(impactAssessmentRef === undefined ? {} : { impactAssessmentRef }),
        occurredAt: withdrawnAt ?? new Date(),
        recordedByPrincipalId: envelope.principalId,
        recordedByActorSnapshotId: envelope.actorSnapshotId,
        recordedAuthorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
    }
    if (governanceOutcome === 'ALREADY') {
      return rejected(ARTIFACT_REVISION_IMMUTABLE, 'the requested governance fact already exists');
    }
    if (governanceOutcome !== 'OK')
      return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Revision was not found');
    const snapshot = await revisionSnapshotInTransaction(execution.trx, row, root);
    const resultPayload = snapshot as unknown as CanonicalJsonObject;
    const resultDigest = digestCanonicalPayload(resultPayload);
    let eventPayload: CanonicalJsonObject;
    let occurredAt: Date;
    if (invalidate) {
      if (invalidationFields === undefined) {
        throw new ArtifactBusinessError(
          ARTIFACT_SCOPE_INVALID,
          'invalidation fields were not validated',
        );
      }
      eventPayload = {
        ...eventScopePayload(root.enterprise_id, root.project_id ?? undefined),
        artifactRef: artifactRefForRoot(root),
        revisionRef,
        impactAssessmentRef: invalidationFields.impactAssessmentRef,
        reasonCode: reason.reasonCode,
        invalidatedAt: invalidationFields.invalidatedAt.value,
      } as unknown as CanonicalJsonObject;
      occurredAt = invalidationFields.invalidatedAt.date;
    } else {
      if (withdrawnAt === undefined) {
        throw new ArtifactBusinessError(
          ARTIFACT_SCOPE_INVALID,
          'withdrawal timestamp was not prepared',
        );
      }
      eventPayload = {
        ...eventScopePayload(root.enterprise_id, root.project_id ?? undefined),
        artifactRef: artifactRefForRoot(root),
        revisionRef,
        reasonCode: reason.reasonCode,
        withdrawnAt: withdrawnAt.toISOString(),
      } as unknown as CanonicalJsonObject;
      occurredAt = withdrawnAt;
    }
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: invalidate ? 'artifact.RevisionInvalidated' : 'artifact.ArtifactRevisionWithdrawn',
      eventVersion: '1.0',
      aggregateType: REVISION_OBJECT_TYPE,
      aggregateId: row.revision_id,
      aggregateVersion: '1',
      payload: eventPayload,
      occurredAt,
    });
    await execution.appendReferenceEdge({
      ownerObjectType: REVISION_OBJECT_TYPE,
      ownerObjectId: row.revision_id,
      ownerVersionId: row.revision_id,
      ownerPayloadHash: resultDigest.hash,
      referencePath: invalidate
        ? '/governance/invalidation/artifactRef'
        : '/governance/withdrawal/artifactRef',
      targetModule: 'artifact',
      targetObjectType: ROOT_OBJECT_TYPE,
      targetObjectId: root.artifact_id,
      referencePurpose: invalidate
        ? 'ARTIFACT_REVISION_INVALIDATION'
        : 'ARTIFACT_REVISION_WITHDRAWAL',
    });
    if (impactAssessmentRef !== undefined) {
      await appendTypedReferenceEdge(
        execution,
        { ownerObjectId: row.revision_id, ownerPayloadHash: resultDigest.hash },
        invalidate
          ? '/governance/invalidation/impactAssessmentRef'
          : '/governance/withdrawal/impactAssessmentRef',
        impactAssessmentRef,
        invalidate
          ? 'ARTIFACT_REVISION_INVALIDATION_IMPACT'
          : 'ARTIFACT_REVISION_WITHDRAWAL_IMPACT',
      );
    }
    return { kind: 'COMMITTED', resultPayload };
  });
}

export async function handleWithdrawRevision(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: RevisionCommandEnvelope<WithdrawRevisionPayload>,
): Promise<CommandResult> {
  return governRevision(db, context, envelope, false);
}

export async function handleInvalidateRevision(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: RevisionCommandEnvelope<InvalidateRevisionPayload>,
): Promise<CommandResult> {
  return governRevision(db, context, envelope, true);
}

async function revisionForQuery(
  trx: ArtifactTransaction,
  context: ArtifactTransactionContext,
  revisionRef: RevisionRefFacts,
): Promise<RevisionFacts & { readonly snapshot: Artifact.RevisionSnapshot }> {
  const row = await repo.getRevisionById(trx, revisionRef.revisionId);
  if (row === undefined) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Revision was not found');
  }
  const root = await repo.getArtifactById(trx, row.artifact_id);
  if (root === undefined) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Revision Artifact was not found');
  }
  if (
    root.enterprise_id !== context.enterpriseId ||
    (revisionRef.projectId ?? undefined) !== (root.project_id ?? undefined)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_QUERY_SCOPE_MISMATCH,
      'Revision Ref Scope is not authoritative for the row',
    );
  }
  if (!row.content_hash.equals(revisionRef.hashBytes)) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_HASH_MISMATCH,
      'Revision Ref contentHash does not match the immutable Revision snapshot',
    );
  }
  const snapshot = await revisionSnapshotInTransaction(trx, row, root);
  return { revision: row, root, snapshot };
}

export async function handleGetRevisionSnapshot(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  payload: GetRevisionSnapshotPayload,
): Promise<Artifact.RevisionSnapshot> {
  const ref = assertRevisionRef(payload.revisionRef, context, undefined, 'revisionRef', 'OPTIONAL');
  return withArtifactTransaction(db, context, async (trx) => {
    const result = await revisionForQuery(trx, context, ref);
    return result.snapshot;
  });
}

function graphParentsByChild(graph: RevisionGraph): Map<string, readonly string[]> {
  const result = new Map<string, string[]>();
  for (const parent of graph.parents) {
    const existing = result.get(parent.child_revision_id) ?? [];
    existing.push(parent.parent_revision_id);
    result.set(parent.child_revision_id, existing);
  }
  return result;
}

function commonAncestorId(
  graph: RevisionGraph,
  leftId: string,
  rightId: string,
): string | undefined {
  const rows = new Map(graph.revisions.map((row) => [row.revision_id, row]));
  const parentsByChild = graphParentsByChild(graph);
  function ancestors(start: string): Set<string> {
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) continue;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const parent of parentsByChild.get(current) ?? []) queue.push(parent);
    }
    return seen;
  }
  const leftAncestors = ancestors(leftId);
  const common = [...ancestors(rightId)].filter((id) => leftAncestors.has(id) && rows.has(id));
  common.sort((left, right) => {
    const leftRow = rows.get(left);
    const rightRow = rows.get(right);
    if (leftRow === undefined || rightRow === undefined) return 0;
    const leftNo = safePositiveInteger(leftRow.revision_no, 'revisionNumber');
    const rightNo = safePositiveInteger(rightRow.revision_no, 'revisionNumber');
    return rightNo - leftNo || left.localeCompare(right);
  });
  return common[0];
}

function lineageResult(
  root: NonNullable<Awaited<ReturnType<ArtifactRepository['getArtifactById']>>>,
  snapshots: readonly Artifact.RevisionSnapshot[],
  rootRefs: readonly Common.ContentAddressedRef[],
  edges: readonly CanonicalJsonValue[],
): Artifact.RevisionLineage {
  const artifactRef = artifactRefForRoot(root);
  const digestInput = canonicalValue({
    artifactRef,
    rootRefs,
    nodes: snapshots,
    edges,
  }) as CanonicalJsonObject;
  const digest = digestCanonicalPayload(digestInput);
  return {
    artifactRef,
    rootRefs,
    nodes: snapshots,
    edges,
    lineageHash: contentHashForBytes(digest.hash),
  };
}

export async function handleGetRevisionLineage(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  payload: GetRevisionLineagePayload,
): Promise<Artifact.RevisionLineage> {
  const artifactFacts = assertArtifactRef(payload.artifactRef, context);
  const facts = await readArtifactFacts(db, context, artifactFacts.artifactId);
  if ((artifactFacts.projectId ?? undefined) !== (facts.root.project_id ?? undefined)) {
    throw new ArtifactBusinessError(
      ARTIFACT_QUERY_SCOPE_MISMATCH,
      'Artifact Ref Project scope is not authoritative',
    );
  }
  const maxDepth = payload.maxDepth ?? 1000;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 10000) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'maxDepth must be a safe positive integer at most 10000',
    );
  }
  const head =
    payload.headRef === undefined
      ? undefined
      : assertRevisionRef(
          payload.headRef,
          context,
          facts.root.project_id ?? undefined,
          'headRef',
          'EXACT',
        );
  return withArtifactTransaction(db, context, async (trx) => {
    const graph = await repo.getRevisionGraph(
      trx,
      facts.root.artifact_id,
      head?.revisionId,
      maxDepth,
    );
    if (head !== undefined) {
      await revisionForQuery(trx, context, head);
    }
    const rows = new Map(graph.revisions.map((row) => [row.revision_id, row]));
    const snapshots: Artifact.RevisionSnapshot[] = [];
    for (const row of graph.revisions) {
      const parentRows = graph.parents.filter(
        (parent) => parent.child_revision_id === row.revision_id,
      );
      snapshots.push(await revisionSnapshotInTransaction(trx, row, facts.root, parentRows));
    }
    const nodeIds = new Set(graph.revisions.map((row) => row.revision_id));
    const rootRefs = snapshots
      .filter((snapshot) => snapshot.parentRevisionRefs.length === 0)
      .map((snapshot) => snapshot.revisionRef);
    const edges = graph.parents
      .filter(
        (parent) => nodeIds.has(parent.child_revision_id) && nodeIds.has(parent.parent_revision_id),
      )
      .map((parent) => {
        const child = rows.get(parent.child_revision_id);
        const parentRow = rows.get(parent.parent_revision_id);
        if (child === undefined || parentRow === undefined) {
          throw new ArtifactBusinessError(
            ARTIFACT_QUERY_NOT_FOUND,
            'Revision lineage edge is incomplete',
          );
        }
        return {
          childRevisionRef: revisionRefForRow(child, facts.root),
          parentRevisionRef: revisionRefForRow(parentRow, facts.root),
          parentOrder: parent.parent_order,
          relationKind: parent.relation_kind,
        } as unknown as CanonicalJsonValue;
      });
    return lineageResult(facts.root, snapshots, rootRefs, edges);
  });
}

export async function handleGetRevisionDiffInputs(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  payload: GetRevisionDiffInputsPayload,
): Promise<Artifact.RevisionDiffInputs> {
  const leftRef = assertRevisionRef(payload.leftRef, context, undefined, 'leftRef', 'OPTIONAL');
  const rightRef = assertRevisionRef(payload.rightRef, context, undefined, 'rightRef', 'OPTIONAL');
  return withArtifactTransaction(db, context, async (trx) => {
    const left = await revisionForQuery(trx, context, leftRef);
    const right = await revisionForQuery(trx, context, rightRef);
    if (left.root.artifact_id !== right.root.artifact_id) {
      throw new ArtifactBusinessError(
        ARTIFACT_CROSS_ARTIFACT_PARENT,
        'Diff Inputs must reference Revisions of the same Artifact',
      );
    }
    const graph = await repo.getRevisionGraph(trx, left.root.artifact_id, undefined, 10000);
    const ancestorId = commonAncestorId(
      graph,
      left.revision.revision_id,
      right.revision.revision_id,
    );
    const ancestorRow =
      ancestorId === undefined
        ? undefined
        : graph.revisions.find((row) => row.revision_id === ancestorId);
    const comparisonSchemaRef = jsonColumn(
      left.revision.structure_schema_ref,
      'comparisonSchemaRef',
    ) as unknown as Common.VersionedRef;
    return {
      left: left.snapshot,
      right: right.snapshot,
      ...(ancestorRow === undefined
        ? {}
        : { commonAncestorRef: revisionRefForRow(ancestorRow, left.root) }),
      comparisonSchemaRef,
    };
  });
}

export async function handleValidateRevisionRef(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  payload: ValidateRevisionRefPayload,
): Promise<Artifact.RevisionValidation> {
  const expectedScope = scopeFacts(payload.expectedScopeRef, 'expectedScopeRef');
  if (
    expectedScope.enterpriseId !== context.enterpriseId ||
    (expectedScope.projectId !== undefined &&
      !context.allowedProjectIds.includes(expectedScope.projectId))
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'expectedScopeRef is outside the trusted context',
    );
  }
  const ref = assertRevisionRef(payload.revisionRef, context, undefined, 'revisionRef', 'OPTIONAL');
  if (!Array.isArray(payload.allowedDispositions) || payload.allowedDispositions.length === 0) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'allowedDispositions must be non-empty',
    );
  }
  const allowedDispositions = new Set(payload.allowedDispositions);
  return withArtifactTransaction(db, context, async (trx) => {
    const row = await repo.getRevisionById(trx, ref.revisionId);
    if (row === undefined) {
      return {
        valid: false,
        exactRef: ref.ref,
        authoritativeScopeRef: expectedScope as Common.ScopeRef,
        contentAvailable: false,
        reasons: [ARTIFACT_QUERY_NOT_FOUND],
      };
    }
    const root = await repo.getArtifactById(trx, row.artifact_id);
    if (root === undefined) {
      return {
        valid: false,
        exactRef: ref.ref,
        authoritativeScopeRef: expectedScope as Common.ScopeRef,
        contentAvailable: false,
        reasons: [ARTIFACT_QUERY_NOT_FOUND],
      };
    }
    if (
      root.enterprise_id !== context.enterpriseId ||
      (expectedScope.projectId ?? undefined) !== (root.project_id ?? undefined) ||
      (ref.projectId ?? undefined) !== (root.project_id ?? undefined)
    ) {
      return {
        valid: false,
        exactRef: ref.ref,
        authoritativeScopeRef: expectedScope as Common.ScopeRef,
        contentAvailable: false,
        reasons: [ARTIFACT_QUERY_SCOPE_MISMATCH],
      };
    }
    const reasons: string[] = [];
    if (!row.content_hash.equals(ref.hashBytes)) reasons.push(ARTIFACT_CONTENT_HASH_MISMATCH);
    const governance = await repo.getRevisionGovernance(trx, row.revision_id);
    const disposition: Artifact.RevisionDisposition =
      governance.invalidation !== undefined
        ? 'INVALIDATED'
        : governance.withdrawal !== undefined
          ? 'WITHDRAWN'
          : 'ACTIVE';
    if (!allowedDispositions.has(disposition))
      reasons.push('ARTIFACT_REVISION_DISPOSITION_NOT_ALLOWED');
    const contentObject = await repo.getContentObjectById(trx, row.content_object_id);
    const contentAvailable =
      contentObject?.storage_state === 'FROZEN' &&
      contentObject.object_locator === row.object_locator &&
      contentObject.content_hash.equals(row.content_hash);
    if (!contentAvailable) reasons.push(ARTIFACT_CONTENT_STATE_INVALID);
    return {
      valid: reasons.length === 0,
      exactRef: revisionRefForRow(row, root),
      authoritativeScopeRef: rootScope(root),
      disposition,
      contentAvailable,
      reasons,
    };
  });
}

export interface ExecutionRevisionPorts {
  readonly revalidateBindingAuthorization: () => Promise<void>;
  readonly now: () => Date;
  readonly revalidateAuthorization: () => Promise<void>;
  readonly readOutputCreationBinding: (runRef: Common.ObjectRef) => Promise<CanonicalJsonObject>;
  readonly actorSnapshotRef: Common.SnapshotRef;
  readonly authorizationDecisionRef: Common.ContentAddressedRef;
  readonly storage: ObjectStoragePort;
  readonly failAt?: (point: string) => void;
}
const executionRegistry = new ContractRegistry();
function executionRequire(
  value: unknown,
  code = 'ARTIFACT_EXECUTION_BINDING_INVALID',
): asserts value {
  if (!value) throw new ArtifactBusinessError(code, 'Execution output is unavailable');
}
function executionSame(a: unknown, b: unknown) {
  return (
    a !== undefined &&
    b !== undefined &&
    canonicalize(a as CanonicalJsonValue) === canonicalize(b as CanonicalJsonValue)
  );
}
async function readExecutionContent(
  row: NonNullable<Awaited<ReturnType<ArtifactRepository['getContentObjectById']>>>,
  storage: ObjectStoragePort,
): Promise<CanonicalJsonObject> {
  const value = await storage.read({
    storageProvider: row.storage_provider,
    objectLocator: row.object_locator,
    objectVersionId: row.object_version_id,
  });
  const payload = canonicalObject(JSON.parse(value.bytes.toString('utf8')), 'canonicalContent');
  executionRequire(
    row.storage_state === 'FROZEN' &&
      value.storageProvider === row.storage_provider &&
      value.objectLocator === row.object_locator &&
      value.objectVersionId === row.object_version_id &&
      value.byteSize === value.bytes.length &&
      value.bytes.equals(Buffer.from(canonicalize(payload))) &&
      digestCanonicalPayload(payload).hash.equals(row.content_hash),
    ARTIFACT_CONTENT_HASH_MISMATCH,
  );
  executionRequire(
    executionRegistry.validateCanonicalContent(payload).valid &&
      isExecutionDocumentSchema(payload.schemaRef, row.enterprise_id) &&
      executionSame(payload.schemaRef, row.payload_schema_ref),
    ARTIFACT_STRUCTURE_SCHEMA_INVALID,
  );
  return payload;
}
/** Human creation owns the Revision and its Receipt; the Run is an observation. */
export async function handleCreateExecutionRevision(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: RevisionCommandEnvelope<Artifact.ArtifactCreateExecutionRevisionPayload>,
  ports: ExecutionRevisionPorts,
): Promise<CommandResult> {
  await ports.revalidateAuthorization();
  executionRequire(
    context.principalKind === 'HUMAN' && envelope.principalKind === 'HUMAN',
    ARTIFACT_HUMAN_ONLY_DENIED,
  );
  executionRequire(
    envelope.commandType === 'artifact.create_execution_revision' &&
      envelope.commandVersion === '1.0' &&
      envelope.targetType === 'artifact.artifact_revision' &&
      envelope.projectId !== undefined,
  );
  const operation = executionRegistry.getOperation('artifact.create_execution_revision', '1.0');
  executionRequire(operation, ARTIFACT_STRUCTURE_SCHEMA_INVALID);
  const payloadSchema = operationPayloadSchemaRef(operation);
  executionRequire(payloadSchema, ARTIFACT_STRUCTURE_SCHEMA_INVALID);
  executionRequire(
    executionRegistry.validateCoreContract(payloadSchema, envelope.requestPayload).valid,
    ARTIFACT_STRUCTURE_SCHEMA_INVALID,
  );
  return executeArtifactCommand(
    db,
    context,
    envelope,
    async (ex) => {
      await ports.revalidateAuthorization();
      const binding = await ports.readOutputCreationBinding(envelope.payload.runRef);
      const observedAt = ports.now();
      const bindingUntil = new Date(nonEmptyString(binding.validUntil, 'binding.validUntil'));
      executionRequire(
        executionRegistry.validateOperationResult(
          'execution.get_output_creation_binding',
          '1.0',
          binding,
        ).valid &&
          executionSame(binding.runRef, envelope.payload.runRef) &&
          observedAt < bindingUntil &&
          executionSame(record(binding.runRef).scope, {
            enterpriseId: envelope.enterpriseId,
            projectId: envelope.projectId,
          }),
      );
      const provenance = {
        principal: {
          kind: 'OBJECT',
          objectType: 'identity.principal',
          objectId: context.principalId,
          scope: { enterpriseId: context.enterpriseId },
        },
        taskRef: binding.taskRef,
        workOrderRef: binding.workOrderRef,
        runRef: binding.runRef,
        contextSnapshotRef: binding.contextSnapshotRef,
        sourceMaterialRefs: [],
        toolchainVersions: [],
      };
      const revision = validateRevisionContent(
        { ...envelope.payload.revision, provenance },
        context,
        envelope.projectId,
        false,
      );
      executionRequire(
        isExecutionDocumentSchema(revision.structureSchemaRef, envelope.enterpriseId) &&
          executionSame(record(binding.outputSpec).schemaRef, revision.structureSchemaRef),
        ARTIFACT_STRUCTURE_SCHEMA_INVALID,
      );
      const root = await repo.getArtifactById(ex.trx, revision.artifactId);
      executionRequire(
        root?.lifecycle_status === 'ACTIVE' &&
          root.project_id === envelope.projectId &&
          root.business_scope === 'PROJECT_DELIVERABLE' &&
          executionSame(root.origin_project_ref, {
            kind: 'OBJECT',
            objectType: 'Project',
            objectId: envelope.projectId,
            scope: { enterpriseId: envelope.enterpriseId, projectId: envelope.projectId },
          }),
        ARTIFACT_SCOPE_INVALID,
      );
      const manifest = await repo.getFrozenContentObjectByIdentity(ex.trx, {
        enterpriseId: envelope.enterpriseId,
        projectId: envelope.projectId,
        contentType: revision.contentType,
        objectLocator: revision.contentLocator,
        contentHash: revision.contentHashBytes,
      });
      executionRequire(manifest, ARTIFACT_CONTENT_OWNER_INVALID);
      const contentLink = await ex.trx
        .selectFrom('artifact.artifact_content_object_link')
        .selectAll()
        .where('content_object_id', '=', manifest.content_object_id)
        .executeTakeFirst();
      executionRequire(
        contentLink?.owner_object_type === 'ArtifactRevision' &&
          contentLink.owner_object_id === envelope.targetId &&
          contentLink.enterprise_id === envelope.enterpriseId &&
          contentLink.project_id === envelope.projectId,
        ARTIFACT_CONTENT_OWNER_INVALID,
      );
      await readExecutionContent(manifest, ports.storage);
      await ports.revalidateAuthorization();
      const createdAt = ports.now();
      executionRequire(
        createdAt < bindingUntil &&
          createdAt >= observedAt &&
          createdAt >= new Date(nonEmptyString(binding.startedAt, 'startedAt')),
      );
      const result = await repo.createArtifactRevision(ex.trx, {
        revisionId: envelope.targetId,
        artifactId: root.artifact_id,
        branchId: revision.branchId,
        enterpriseId: envelope.enterpriseId,
        projectId: envelope.projectId,
        revisionKind: 'INITIAL',
        contentObjectId: manifest.content_object_id,
        contentType: 'STRUCTURED_DOCUMENT',
        objectLocator: revision.contentLocator,
        contentHash: revision.contentHashBytes,
        structureSchemaRef: revision.structureSchemaRef,
        canonicalizationVersion: '1',
        byteSize: Number(manifest.byte_size),
        mediaType: manifest.media_type,
        semanticMetadata: {},
        changedUnits: revision.changedUnits,
        changeSummary: revision.changeSummary,
        provenance: revision.provenance,
        parentRefs: [],
        createdByPrincipalId: context.principalId,
        createdByActorSnapshotId: context.actorSnapshotId,
        createdAuthorizationDecisionId: context.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      if (result.outcome !== 'OK')
        return revisionCreateRejection(result.outcome, String(Number(root.aggregate_version)));
      ports.failAt?.('revision');
      const row = await repo.getRevisionById(ex.trx, envelope.targetId);
      executionRequire(row);
      const snapshot = await revisionSnapshotInTransaction(ex.trx, row, root);
      const scopeRef = { enterpriseId: envelope.enterpriseId, projectId: envelope.projectId };
      const receipt = {
        commandId: envelope.commandId,
        commandType: 'artifact.create_execution_revision',
        commandVersion: '1.0',
        targetRef: {
          kind: 'OBJECT',
          objectType: 'artifact.artifact_revision',
          objectId: envelope.targetId,
          scope: scopeRef,
        },
        scopeRef,
        requestPayloadHash: contentHashForBytes(
          digestCanonicalPayload(envelope.requestPayload).hash,
        ),
        outcome: 'COMMITTED',
        revisionRef: snapshot.revisionRef,
        actorRef: provenance.principal,
        actorSnapshotRef: ports.actorSnapshotRef,
        authorizationDecisionRef: ports.authorizationDecisionRef,
        committedAt: createdAt.toISOString(),
      } as unknown as CanonicalJsonObject;
      const receiptHash = digestCanonicalPayload(receipt).hash;
      const creationCommandRef: Common.ContentAddressedRef = {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.artifact.command_receipt',
        objectId: envelope.commandId,
        scope: scopeRef,
        contentHash: contentHashForBytes(receiptHash),
      };
      const creationBinding = {
        revisionRef: snapshot.revisionRef,
        creationCommandRef,
        taskRef: binding.taskRef,
        workOrderRef: binding.workOrderRef,
        runRef: binding.runRef,
        workOrderContractRef: binding.workOrderContractRef,
        contextSnapshotRef: binding.contextSnapshotRef,
        controlsPolicyRef: binding.controlsPolicyRef,
        observedRunVersion: binding.runAggregateVersion,
        startedAt: binding.startedAt,
        bindingObservedAt: observedAt.toISOString(),
        bindingValidUntil: binding.validUntil,
        bindingObservationHash: contentHashForBytes(digestCanonicalPayload(binding).hash),
        createdAt: createdAt.toISOString(),
      } as unknown as CanonicalJsonObject;
      const values = {
        revision_id: envelope.targetId,
        command_id: envelope.commandId,
        enterprise_id: envelope.enterpriseId,
        project_id: envelope.projectId,
      };
      await ex.trx
        .insertInto('artifact.execution_revision_command_receipt')
        .values({ ...values, canonical_payload: canonicalize(receipt), payload_hash: receiptHash })
        .execute();
      ports.failAt?.('receipt');
      await ex.trx
        .insertInto('artifact.execution_revision_creation_binding')
        .values({
          ...values,
          canonical_payload: canonicalize(creationBinding),
          payload_hash: digestCanonicalPayload(creationBinding).hash,
        })
        .execute();
      ports.failAt?.('binding');
      const eventPayload = {
        artifactRef: { ...artifactRefForRoot(root), objectType: 'artifact.artifact' },
        revisionRef: snapshot.revisionRef,
        branchId: revision.branchId,
        parentRevisionRefs: [],
        changedUnits: revision.changedUnits,
      };
      executionRequire(
        executionRegistry.validateCoreContract(
          'https://schemas.zhiju.local/modules/artifact/1.0#/$defs/artifact_ArtifactRevisionSealed_payload',
          eventPayload,
        ).valid,
        ARTIFACT_STRUCTURE_SCHEMA_INVALID,
      );
      await ex.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'artifact.ArtifactRevisionSealed',
        eventVersion: '1.0',
        aggregateType: 'ArtifactRevision',
        aggregateId: envelope.targetId,
        aggregateVersion: '1',
        payload: { ...eventPayload, ...scopeRef } as unknown as CanonicalJsonObject,
        occurredAt: createdAt,
      });
      ports.failAt?.('outbox');
      await appendRevisionEdges(
        ex,
        root,
        row,
        manifest.content_object_id,
        revision.structureSchemaRef,
        [],
        revision.provenance,
        receiptHash,
        envelope.targetType,
      );
      await appendTypedReferenceEdge(
        ex,
        {
          ownerObjectId: envelope.targetId,
          ownerPayloadHash: receiptHash,
          ownerObjectType: envelope.targetType,
        },
        '/creationCommandRef',
        creationCommandRef,
        'ARTIFACT_REVISION_CREATION_COMMAND',
      );
      ports.failAt?.('edges');
      await ports.revalidateBindingAuthorization();
      await ports.revalidateAuthorization();
      executionRequire(ports.now() < bindingUntil);
      return {
        kind: 'COMMITTED',
        resultPayload: {
          revisionRef: snapshot.revisionRef,
          creationCommandRef,
        } as unknown as CanonicalJsonObject,
      };
    },
    ports.revalidateAuthorization,
  );
}

export async function handleGetExecutionOutputFact(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  revisionRef: Common.ContentAddressedRef,
  ports: Pick<ExecutionRevisionPorts, 'now' | 'storage' | 'revalidateAuthorization'>,
): Promise<Artifact.ArtifactGetExecutionOutputFactResult> {
  await ports.revalidateAuthorization();
  executionRequire(
    revisionRef.objectType === 'artifact.artifact_revision',
    ARTIFACT_QUERY_NOT_FOUND,
  );
  return withArtifactTransaction(db, context, async (trx) => {
    const row = await repo.getRevisionById(trx, revisionRef.objectId);
    executionRequire(row, ARTIFACT_QUERY_NOT_FOUND);
    const root = await repo.getArtifactById(trx, row.artifact_id);
    executionRequire(
      root !== undefined && executionSame(revisionRef, revisionRefForRow(row, root)),
      ARTIFACT_QUERY_NOT_FOUND,
    );
    const binding = await trx
      .selectFrom('artifact.execution_revision_creation_binding')
      .selectAll()
      .where('revision_id', '=', row.revision_id)
      .executeTakeFirst();
    const receipt = await trx
      .selectFrom('artifact.execution_revision_command_receipt')
      .selectAll()
      .where('revision_id', '=', row.revision_id)
      .executeTakeFirst();
    executionRequire(
      binding?.command_id === receipt?.command_id &&
        binding !== undefined &&
        receipt !== undefined &&
        digestCanonicalPayload(canonicalObject(binding.canonical_payload, 'binding')).hash.equals(
          binding.payload_hash,
        ) &&
        digestCanonicalPayload(canonicalObject(receipt.canonical_payload, 'receipt')).hash.equals(
          receipt.payload_hash,
        ),
      ARTIFACT_QUERY_NOT_FOUND,
    );
    const manifest = await repo.getContentObjectById(trx, row.content_object_id);
    executionRequire(manifest, ARTIFACT_QUERY_NOT_FOUND);
    executionRequire(manifest.content_hash.equals(row.content_hash), ARTIFACT_QUERY_NOT_FOUND);
    const canonicalContent = await readExecutionContent(manifest, ports.storage);
    const revision = await revisionSnapshotInTransaction(trx, row, root);
    const revoked = ['WITHDRAWN', 'INVALIDATED'].includes(revision.disposition);
    const useStatus = revoked
      ? 'REVOKED'
      : root.lifecycle_status === 'ACTIVE' && revision.disposition === 'ACTIVE'
        ? 'USABLE'
        : 'STALE';
    const result = {
      revision,
      artifactRef: { ...artifactRefForRoot(root), objectType: 'artifact.artifact' },
      artifactAggregateVersion: Number(root.aggregate_version),
      artifactLifecycle: root.lifecycle_status,
      businessScope: root.business_scope,
      originProjectRef: {
        kind: 'OBJECT',
        objectType: 'zhiju.project.project',
        objectId: root.project_id,
        scope: { enterpriseId: root.enterprise_id, projectId: root.project_id },
      },
      contentState: 'FROZEN',
      canonicalContent,
      creationBinding: binding.canonical_payload,
      creationBindingHash: contentHashForBytes(binding.payload_hash),
      creationReceipt: receipt.canonical_payload,
      observedAt: ports.now().toISOString(),
      useStatus,
      reasonCodes: useStatus === 'USABLE' ? [] : [`ARTIFACT_EXECUTION_OUTPUT_${useStatus}`],
    };
    executionRequire(
      executionRegistry.validateOperationResult('artifact.get_execution_output_fact', '1.0', result)
        .valid,
      ARTIFACT_QUERY_NOT_FOUND,
    );
    await ports.revalidateAuthorization();
    return result as unknown as Artifact.ArtifactGetExecutionOutputFactResult;
  });
}
