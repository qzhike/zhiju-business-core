// IM-04 WI-06 (issue #95): Structured Document canonicalization, scoped Human
// Edit orchestration and rebuildable internal Diff.

import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import { getContractRegistry, type Artifact, type Common } from '@zhiju/contracts';
import {
  canonicalize,
  canonicalizeCanonicalContentPayload,
  hashCanonicalContentPayload,
  isUuidV7,
  type CanonicalContentPayload as SharedCanonicalContentPayload,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import {
  withArtifactTransaction,
  type ArtifactDb,
  type ArtifactTransactionContext,
} from '../persistence/artifact-db.js';
import { ArtifactRepository } from '../persistence/artifact-repository.js';
import type {
  ArtifactContentObjectTable,
  ArtifactRevisionTable,
} from '../persistence/artifact-business-types.js';
import {
  ArtifactBusinessError,
  ARTIFACT_CONTENT_FINALIZATION_UNKNOWN,
  ARTIFACT_CONTENT_HASH_MISMATCH,
  ARTIFACT_CONTENT_READBACK_MISMATCH,
  ARTIFACT_CONTENT_STATE_INVALID,
  ARTIFACT_HUMAN_ONLY_DENIED,
  ARTIFACT_NOT_ACTIVE,
  ARTIFACT_QUERY_NOT_FOUND,
  ARTIFACT_QUERY_SCOPE_MISMATCH,
  ARTIFACT_SCOPE_INVALID,
  ARTIFACT_STRUCTURE_SCHEMA_INVALID,
  ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
  ARTIFACT_STRUCTURED_DOCUMENT_BASE_STALE,
  ARTIFACT_STRUCTURED_DOCUMENT_EDIT_SCOPE,
  ARTIFACT_STRUCTURED_DOCUMENT_ID_MISMATCH,
  ARTIFACT_STRUCTURED_DOCUMENT_NOOP,
} from './artifact-business-errors.js';
import {
  assertEnvelopeMatchesContext,
  type CommandEnvelope,
  type CommandResult,
} from '../persistence/command-runner.js';
import {
  freezeCanonicalContent,
  linkCanonicalContent,
  stageCanonicalContent,
  type CanonicalContentCommandEnvelope,
  type LinkCanonicalContentPayload,
  type StageCanonicalContentPayload,
} from './content-object-service.js';
import {
  handleCreateAndSealRevision,
  handleGetRevisionDiffInputs,
  handleGetRevisionSnapshot,
  type CreateAndSealRevisionPayload,
  type GetRevisionDiffInputsPayload,
  type RevisionCommandEnvelope,
} from './revision-service.js';
import type { ObjectStoragePort, ObjectStorageReadback } from '../storage/object-storage.js';

const repo = new ArtifactRepository();
const registry = getContractRegistry();
const ROOT_OBJECT_TYPES = new Set(['Artifact', 'artifact.artifact']);
const REVISION_OBJECT_TYPES = new Set(['ArtifactRevision', 'artifact.artifact_revision']);
const ROOT_OBJECT_TYPE = 'Artifact';
const REVISION_OBJECT_TYPE = 'ArtifactRevision';
const REVISION_REF_OBJECT_TYPE = 'artifact.artifact_revision';
const CANONICAL_OBJECT_TYPE = 'CanonicalContentObject';
const CANONICAL_MEDIA_TYPE = 'application/json';
const CANONICAL_SCHEMA_OBJECT_TYPE = 'artifact.canonical_document_schema';
const SYNTHETIC_SCHEMA_REF: Common.VersionedRef = {
  kind: 'VERSIONED',
  objectType: CANONICAL_SCHEMA_OBJECT_TYPE,
  objectId: '00000000-0000-7000-8000-000000000001',
  versionId: '00000000-0000-7000-8000-000000000002',
  scope: { enterpriseId: '00000000-0000-7000-8000-000000000003' },
};

type RecordLike = Readonly<Record<string, unknown>>;

export interface StructuredDocumentCanonicalization {
  readonly payload: Artifact.CanonicalDocumentContent;
  readonly canonicalBytes: Buffer;
  readonly contentHash: Common.ContentHash;
}

export type StructuredDocumentDiffKind = 'ADDED' | 'REMOVED' | 'CHANGED' | 'MOVED';

export interface StructuredDocumentUnitLocation {
  readonly parentUnitId?: string;
  readonly ordinal: number;
}

export interface StructuredDocumentDiffEntry {
  readonly kind: StructuredDocumentDiffKind;
  readonly unitId: string;
  readonly from?: StructuredDocumentUnitLocation;
  readonly to?: StructuredDocumentUnitLocation;
}

export interface StructuredDocumentDiff {
  readonly documentId: string;
  readonly documentChanged: boolean;
  readonly entries: readonly StructuredDocumentDiffEntry[];
}

export interface StructuredDocumentEditPayload {
  readonly baseRevisionRef: Common.ContentAddressedRef;
  readonly allowedUnitRefs: readonly string[];
  readonly document: Artifact.CanonicalDocument;
  readonly changeSummary: Common.NonEmptyString;
}

export type StructuredDocumentEditCommandEnvelope = CommandEnvelope & {
  readonly payload: StructuredDocumentEditPayload;
};

export interface StructuredDocumentEditResult {
  readonly baseRevisionRef: Common.ContentAddressedRef;
  readonly revision: Artifact.RevisionSnapshot;
  readonly contentObjectId: string;
  readonly contentRef: string;
  readonly canonicalBytes: string;
  readonly contentHash: Common.ContentHash;
  readonly diff: StructuredDocumentDiff;
}

export interface StructuredDocumentDiffResult {
  readonly inputs: Artifact.RevisionDiffInputs;
  readonly diff: StructuredDocumentDiff;
  readonly leftCanonicalBytes: string;
  readonly rightCanonicalBytes: string;
}

export interface ExactRevisionFacts {
  readonly ref: Common.ContentAddressedRef;
  readonly revision: ArtifactRevisionTable;
  readonly root: {
    readonly artifact_id: string;
    readonly enterprise_id: string;
    readonly project_id: string | null;
    readonly lifecycle_status: Artifact.ArtifactLifecycle;
  };
  readonly branch: {
    readonly artifact_id: string;
    readonly branch_id: string;
    readonly project_id: string | null;
    readonly working_head_ref: unknown;
  };
  readonly contentObject: ArtifactContentObjectTable;
  readonly schemaRef: Common.VersionedRef;
  readonly disposition: Artifact.RevisionDisposition;
}

interface StructuredDocumentRead {
  readonly document: Artifact.CanonicalDocument;
  readonly canonicalBytes: Buffer;
  readonly contentHash: Common.ContentHash;
}

function record(value: unknown): RecordLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordLike)
    : {};
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalJsonClone<T>(value: T, code = ARTIFACT_STRUCTURE_SCHEMA_INVALID): T {
  try {
    const canonicalJson = canonicalize(value as unknown as CanonicalJsonValue);
    const parsed: unknown = JSON.parse(canonicalJson);
    return parsed as T;
  } catch {
    throw new ArtifactBusinessError(code, 'value is not valid canonical JSON');
  }
}

function storedJson(value: unknown, label: string): CanonicalJsonValue {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, `${label} is invalid stored JSON`);
    }
  }
  try {
    const canonicalJson = canonicalize(parsed as CanonicalJsonValue);
    const normalized: unknown = JSON.parse(canonicalJson);
    return normalized as CanonicalJsonValue;
  } catch {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, `${label} is invalid stored JSON`);
  }
}

function normalizedContentHash(value: unknown, label: string): Common.ContentHash {
  const hash = record(value);
  if (
    hash.algorithm !== 'SHA-256' ||
    hash.canonicalizationVersion !== '1' ||
    typeof hash.digest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(hash.digest)
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

function normalizeSchemaRef(
  value: unknown,
  context?: ArtifactTransactionContext,
  expectedProjectId?: string,
): Common.VersionedRef {
  const ref = record(value);
  const scope = record(ref.scope);
  const enterpriseId = scope.enterpriseId;
  const projectId = scope.projectId;
  if (
    ref.kind !== 'VERSIONED' ||
    ref.objectType !== CANONICAL_SCHEMA_OBJECT_TYPE ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    typeof ref.versionId !== 'string' ||
    !isUuidV7(ref.versionId) ||
    typeof enterpriseId !== 'string' ||
    !isUuidV7(enterpriseId) ||
    (projectId !== undefined && (typeof projectId !== 'string' || !isUuidV7(projectId)))
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURE_SCHEMA_INVALID,
      'Structured Document schemaRef is not an exact canonical schema VersionedRef',
    );
  }
  if (context !== undefined) {
    if (enterpriseId !== context.enterpriseId) {
      throw new ArtifactBusinessError(
        ARTIFACT_SCOPE_INVALID,
        'Structured Document schemaRef is outside the trusted Enterprise',
      );
    }
    if (projectId !== undefined && !context.allowedProjectIds.includes(projectId)) {
      throw new ArtifactBusinessError(
        ARTIFACT_QUERY_NOT_FOUND,
        'Structured Document schemaRef is outside the trusted Project scope',
      );
    }
  }
  if (
    expectedProjectId !== undefined &&
    projectId !== undefined &&
    projectId !== expectedProjectId
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_QUERY_SCOPE_MISMATCH,
      'Structured Document schemaRef Project scope does not match the Artifact scope',
    );
  }
  return {
    kind: 'VERSIONED',
    objectType: CANONICAL_SCHEMA_OBJECT_TYPE,
    objectId: ref.objectId,
    versionId: ref.versionId,
    scope: projectId === undefined ? { enterpriseId } : { enterpriseId, projectId },
  };
}

function validateEvidenceRefs(
  units: readonly Artifact.CanonicalDocumentUnit[],
  context?: ArtifactTransactionContext,
  expectedProjectId?: string,
): void {
  for (const unit of units) {
    for (const evidence of unit.evidenceRefs ?? []) {
      const ref = record(evidence);
      const scope = record(ref.scope);
      const enterpriseId = scope.enterpriseId;
      const projectId = scope.projectId;
      normalizedContentHash(ref.contentHash, 'evidenceRefs.contentHash');
      if (
        ref.kind !== 'CONTENT_ADDRESSED' ||
        typeof ref.objectType !== 'string' ||
        ref.objectType.trim().length === 0 ||
        typeof ref.objectId !== 'string' ||
        !isUuidV7(ref.objectId) ||
        typeof enterpriseId !== 'string' ||
        !isUuidV7(enterpriseId) ||
        (projectId !== undefined && (typeof projectId !== 'string' || !isUuidV7(projectId)))
      ) {
        throw new ArtifactBusinessError(
          ARTIFACT_STRUCTURE_SCHEMA_INVALID,
          'Structured Document evidence reference is not exact',
        );
      }
      if (context !== undefined) {
        if (enterpriseId !== context.enterpriseId) {
          throw new ArtifactBusinessError(
            ARTIFACT_SCOPE_INVALID,
            'Structured Document evidence reference is outside the trusted Enterprise',
          );
        }
        if (projectId !== undefined && !context.allowedProjectIds.includes(projectId)) {
          throw new ArtifactBusinessError(
            ARTIFACT_QUERY_NOT_FOUND,
            'Structured Document evidence reference is outside the trusted Project scope',
          );
        }
      }
      if (
        expectedProjectId !== undefined &&
        projectId !== undefined &&
        projectId !== expectedProjectId
      ) {
        throw new ArtifactBusinessError(
          ARTIFACT_QUERY_SCOPE_MISMATCH,
          'Structured Document evidence reference Project scope does not match the Artifact scope',
        );
      }
    }
  }
}

function normalizedUnit(
  unit: Artifact.CanonicalDocumentUnit,
  unitsById: ReadonlyMap<string, Artifact.CanonicalDocumentUnit>,
): Artifact.CanonicalDocumentUnit {
  const childUnitIds = [...unit.childUnitIds].sort((leftId, rightId) => {
    const left = unitsById.get(leftId);
    const right = unitsById.get(rightId);
    if (left === undefined || right === undefined) return compareUtf8(leftId, rightId);
    return left.ordinal - right.ordinal || compareUtf8(left.unitId, right.unitId);
  });
  const evidenceRefs =
    unit.evidenceRefs === undefined
      ? undefined
      : [...unit.evidenceRefs].sort((left, right) => {
          return compareUtf8(
            canonicalize(left as unknown as CanonicalJsonValue),
            canonicalize(right as unknown as CanonicalJsonValue),
          );
        });
  return {
    ...unit,
    childUnitIds,
    ...(evidenceRefs === undefined ? {} : { evidenceRefs }),
  };
}

function normalizeDocument(
  document: Artifact.CanonicalDocument,
  schemaRef: Common.VersionedRef = SYNTHETIC_SCHEMA_REF,
  context?: ArtifactTransactionContext,
  expectedProjectId?: string,
): Artifact.CanonicalDocument {
  const cloned = canonicalJsonClone(document);
  if (!isUuidV7(cloned.documentId)) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURE_SCHEMA_INVALID,
      'Structured Document documentId must be a UUIDv7',
    );
  }
  const normalizedSchema = normalizeSchemaRef(schemaRef, context, expectedProjectId);
  const payload = {
    schemaRef: normalizedSchema,
    contentType: 'STRUCTURED_DOCUMENT' as const,
    canonicalizationVersion: '1' as const,
    body: cloned,
  } satisfies Artifact.CanonicalDocumentContent;
  const validation = registry.validateCanonicalContent(payload);
  if (!validation.valid) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURE_SCHEMA_INVALID,
      'Structured Document failed executable schema or hierarchy validation',
    );
  }
  validateEvidenceRefs(cloned.units, context, expectedProjectId);
  const unitsById = new Map(cloned.units.map((unit) => [unit.unitId, unit]));
  const roots = cloned.units
    .filter((unit) => unit.parentUnitId === undefined)
    .sort((left, right) => left.ordinal - right.ordinal || compareUtf8(left.unitId, right.unitId));
  const ordered: Artifact.CanonicalDocumentUnit[] = [];
  const visited = new Set<string>();
  const visit = (unitId: string): void => {
    if (visited.has(unitId)) return;
    const unit = unitsById.get(unitId);
    if (unit === undefined) {
      throw new ArtifactBusinessError(
        ARTIFACT_STRUCTURE_SCHEMA_INVALID,
        'Structured Document hierarchy references an unknown Unit',
      );
    }
    visited.add(unitId);
    ordered.push(normalizedUnit(unit, unitsById));
    const children = [...unit.childUnitIds].sort((leftId, rightId) => {
      const left = unitsById.get(leftId);
      const right = unitsById.get(rightId);
      if (left === undefined || right === undefined) return compareUtf8(leftId, rightId);
      return left.ordinal - right.ordinal || compareUtf8(left.unitId, right.unitId);
    });
    for (const childId of children) visit(childId);
  };
  for (const root of roots) visit(root.unitId);
  for (const unit of cloned.units) visit(unit.unitId);
  if (ordered.length !== cloned.units.length) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURE_SCHEMA_INVALID,
      'Structured Document hierarchy could not be deterministically ordered',
    );
  }
  return canonicalJsonClone({
    documentId: cloned.documentId,
    title: cloned.title,
    units: ordered,
    ...(cloned.metadata === undefined ? {} : { metadata: cloned.metadata }),
  } satisfies Artifact.CanonicalDocument);
}

export function validateStructuredDocument(
  document: Artifact.CanonicalDocument,
  context?: ArtifactTransactionContext,
  expectedProjectId?: string,
): Artifact.CanonicalDocument {
  const validationSchemaRef: Common.VersionedRef =
    context === undefined
      ? SYNTHETIC_SCHEMA_REF
      : {
          ...SYNTHETIC_SCHEMA_REF,
          scope:
            expectedProjectId === undefined
              ? { enterpriseId: context.enterpriseId }
              : { enterpriseId: context.enterpriseId, projectId: expectedProjectId },
        };
  return normalizeDocument(document, validationSchemaRef, context, expectedProjectId);
}

export function canonicalizeStructuredDocument(
  document: Artifact.CanonicalDocument,
  schemaRef: Common.VersionedRef,
  context?: ArtifactTransactionContext,
  expectedProjectId?: string,
): StructuredDocumentCanonicalization {
  const normalizedSchema = normalizeSchemaRef(schemaRef, context, expectedProjectId);
  const normalizedDocument = normalizeDocument(
    document,
    normalizedSchema,
    context,
    expectedProjectId,
  );
  const payload = {
    schemaRef: normalizedSchema,
    contentType: 'STRUCTURED_DOCUMENT' as const,
    canonicalizationVersion: '1' as const,
    body: normalizedDocument,
  } satisfies Artifact.CanonicalDocumentContent;
  const hashablePayload = payload as unknown as SharedCanonicalContentPayload;
  const canonicalJson = canonicalizeCanonicalContentPayload(hashablePayload);
  const canonicalBytes = Buffer.from(canonicalJson, 'utf8');
  return {
    payload,
    canonicalBytes,
    contentHash: hashCanonicalContentPayload(hashablePayload),
  };
}

function unitLocation(unit: Artifact.CanonicalDocumentUnit): StructuredDocumentUnitLocation {
  return {
    ...(unit.parentUnitId === undefined ? {} : { parentUnitId: unit.parentUnitId }),
    ordinal: unit.ordinal,
  };
}

function sameLocation(
  left: StructuredDocumentUnitLocation,
  right: StructuredDocumentUnitLocation,
): boolean {
  return left.ordinal === right.ordinal && left.parentUnitId === right.parentUnitId;
}

function unitContentFingerprint(unit: Artifact.CanonicalDocumentUnit): string {
  return canonicalize({
    unitType: unit.unitType,
    ...(unit.text === undefined ? {} : { text: unit.text }),
    ...(unit.semanticMetadata === undefined ? {} : { semanticMetadata: unit.semanticMetadata }),
    ...(unit.evidenceRefs === undefined ? {} : { evidenceRefs: unit.evidenceRefs }),
  } as unknown as CanonicalJsonValue);
}

function documentMetadataFingerprint(document: Artifact.CanonicalDocument): string {
  return canonicalize({
    title: document.title,
    ...(document.metadata === undefined ? {} : { metadata: document.metadata }),
  });
}

const DIFF_KIND_ORDER: Readonly<Record<StructuredDocumentDiffKind, number>> = {
  ADDED: 0,
  REMOVED: 1,
  CHANGED: 2,
  MOVED: 3,
};

export function diffStructuredDocuments(
  left: Artifact.CanonicalDocument,
  right: Artifact.CanonicalDocument,
): StructuredDocumentDiff {
  const normalizedLeft = normalizeDocument(left);
  const normalizedRight = normalizeDocument(right);
  if (normalizedLeft.documentId !== normalizedRight.documentId) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURED_DOCUMENT_ID_MISMATCH,
      'Structured Document Diff requires the same documentId',
    );
  }
  const leftById = new Map(normalizedLeft.units.map((unit) => [unit.unitId, unit]));
  const rightById = new Map(normalizedRight.units.map((unit) => [unit.unitId, unit]));
  const unitIds = [...new Set([...leftById.keys(), ...rightById.keys()])].sort(compareUtf8);
  const entries: StructuredDocumentDiffEntry[] = [];
  for (const unitId of unitIds) {
    const leftUnit = leftById.get(unitId);
    const rightUnit = rightById.get(unitId);
    if (leftUnit === undefined && rightUnit !== undefined) {
      entries.push({ kind: 'ADDED', unitId, to: unitLocation(rightUnit) });
      continue;
    }
    if (leftUnit !== undefined && rightUnit === undefined) {
      entries.push({ kind: 'REMOVED', unitId, from: unitLocation(leftUnit) });
      continue;
    }
    if (leftUnit === undefined || rightUnit === undefined) continue;
    if (unitContentFingerprint(leftUnit) !== unitContentFingerprint(rightUnit)) {
      entries.push({ kind: 'CHANGED', unitId });
    }
    if (!sameLocation(unitLocation(leftUnit), unitLocation(rightUnit))) {
      entries.push({
        kind: 'MOVED',
        unitId,
        from: unitLocation(leftUnit),
        to: unitLocation(rightUnit),
      });
    }
  }
  entries.sort(
    (leftEntry, rightEntry) =>
      compareUtf8(leftEntry.unitId, rightEntry.unitId) ||
      DIFF_KIND_ORDER[leftEntry.kind] - DIFF_KIND_ORDER[rightEntry.kind],
  );
  return {
    documentId: normalizedLeft.documentId,
    documentChanged:
      documentMetadataFingerprint(normalizedLeft) !== documentMetadataFingerprint(normalizedRight),
    entries,
  };
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

function exactRevisionRef(
  value: unknown,
  context: ArtifactTransactionContext,
): Common.ContentAddressedRef {
  const ref = record(value);
  const scope = record(ref.scope);
  const enterpriseId = scope.enterpriseId;
  const projectId = scope.projectId;
  const contentHash = normalizedContentHash(ref.contentHash, 'baseRevisionRef.contentHash');
  if (
    ref.kind !== 'CONTENT_ADDRESSED' ||
    typeof ref.objectType !== 'string' ||
    !REVISION_OBJECT_TYPES.has(ref.objectType) ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    typeof enterpriseId !== 'string' ||
    enterpriseId !== context.enterpriseId ||
    (projectId !== undefined &&
      (typeof projectId !== 'string' ||
        !isUuidV7(projectId) ||
        !context.allowedProjectIds.includes(projectId))) ||
    (projectId === undefined && 'projectId' in scope) ||
    (ref.immutableVersionId !== undefined &&
      (typeof ref.immutableVersionId !== 'string' || !isUuidV7(ref.immutableVersionId)))
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
      'baseRevisionRef must be an exact visible ArtifactRevision ContentAddressedRef',
    );
  }
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: REVISION_REF_OBJECT_TYPE,
    objectId: ref.objectId,
    ...(ref.immutableVersionId === undefined ? {} : { immutableVersionId: ref.immutableVersionId }),
    scope: projectId === undefined ? { enterpriseId } : { enterpriseId, projectId },
    contentHash,
  };
}

function revisionDisposition(
  governance: Awaited<ReturnType<ArtifactRepository['getRevisionGovernance']>>,
): Artifact.RevisionDisposition {
  return governance.invalidation !== undefined
    ? 'INVALIDATED'
    : governance.withdrawal !== undefined
      ? 'WITHDRAWN'
      : 'ACTIVE';
}

async function readExactRevisionFacts(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  value: unknown,
  requireCurrentHead: boolean,
  requireActiveArtifact = true,
): Promise<ExactRevisionFacts> {
  const ref = exactRevisionRef(value, context);
  return withArtifactTransaction(db, context, async (trx) => {
    const revision = await repo.getRevisionById(trx, ref.objectId);
    if (revision === undefined) {
      throw new ArtifactBusinessError(
        ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
        'exact base Revision is not visible',
      );
    }
    const root = await repo.getArtifactById(trx, revision.artifact_id);
    if (root === undefined) {
      throw new ArtifactBusinessError(
        ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
        'exact base Artifact is not visible',
      );
    }
    if (
      root.enterprise_id !== context.enterpriseId ||
      (ref.scope.projectId ?? undefined) !== (root.project_id ?? undefined)
    ) {
      throw new ArtifactBusinessError(
        ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
        'base Revision Scope does not match the authoritative Artifact Scope',
      );
    }
    if (!revision.content_hash.equals(Buffer.from(ref.contentHash.digest, 'hex'))) {
      throw new ArtifactBusinessError(
        ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
        'base Revision contentHash does not match the immutable Revision',
      );
    }
    if (requireActiveArtifact && root.lifecycle_status !== 'ACTIVE') {
      throw new ArtifactBusinessError(ARTIFACT_NOT_ACTIVE, 'base Artifact is not active');
    }
    if (revision.content_type !== 'STRUCTURED_DOCUMENT') {
      throw new ArtifactBusinessError(
        ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
        'base Revision is not a Structured Document',
      );
    }
    const branchResult: unknown = await repo.getArtifactBranchById(trx, revision.branch_id);
    if (branchResult === undefined || branchResult === null || typeof branchResult !== 'object') {
      throw new ArtifactBusinessError(
        ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
        'base Revision Branch is not authoritative',
      );
    }
    const branch = branchResult as ExactRevisionFacts['branch'];
    if (branch.artifact_id !== root.artifact_id || branch.project_id !== root.project_id) {
      throw new ArtifactBusinessError(
        ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
        'base Revision Branch is not authoritative',
      );
    }
    const workingHeadRef: unknown = branch.working_head_ref;
    if (requireCurrentHead && workingHeadRef != null) {
      const head = storedJson(workingHeadRef, 'workingHeadRef');
      if (canonicalize(head) !== canonicalize(ref as unknown as CanonicalJsonValue)) {
        throw new ArtifactBusinessError(
          ARTIFACT_STRUCTURED_DOCUMENT_BASE_STALE,
          'Human Edit base Revision is stale relative to the Branch head',
        );
      }
    }
    const contentObjectResult: unknown = await repo.getContentObjectById(
      trx,
      revision.content_object_id,
    );
    if (
      contentObjectResult === undefined ||
      contentObjectResult === null ||
      typeof contentObjectResult !== 'object'
    ) {
      throw new ArtifactBusinessError(
        ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
        'base Revision does not point to an exact FROZEN Structured Document object',
      );
    }
    const contentObject = contentObjectResult as ArtifactContentObjectTable;
    if (
      contentObject.storage_state !== 'FROZEN' ||
      contentObject.enterprise_id !== root.enterprise_id ||
      contentObject.project_id !== root.project_id ||
      contentObject.content_type !== 'STRUCTURED_DOCUMENT' ||
      contentObject.object_locator !== revision.object_locator ||
      !contentObject.content_hash.equals(revision.content_hash) ||
      contentObject.canonicalization_version !== '1' ||
      contentObject.media_type !== CANONICAL_MEDIA_TYPE
    ) {
      throw new ArtifactBusinessError(
        ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
        'base Revision does not point to an exact FROZEN Structured Document object',
      );
    }
    const schemaRef = normalizeSchemaRef(
      storedJson(revision.structure_schema_ref, 'structureSchemaRef'),
      context,
      root.project_id ?? undefined,
    );
    const manifestSchemaRef = normalizeSchemaRef(
      storedJson(contentObject.payload_schema_ref, 'payloadSchemaRef'),
      context,
      root.project_id ?? undefined,
    );
    if (
      canonicalize(schemaRef as unknown as CanonicalJsonValue) !==
      canonicalize(manifestSchemaRef as unknown as CanonicalJsonValue)
    ) {
      throw new ArtifactBusinessError(
        ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
        'base Revision SchemaRef does not match the FROZEN Content Object',
      );
    }
    const governance = await repo.getRevisionGovernance(trx, revision.revision_id);
    return {
      ref,
      revision,
      root,
      branch,
      contentObject,
      schemaRef,
      disposition: revisionDisposition(governance),
    };
  });
}

function storageReference(row: ArtifactContentObjectTable): {
  readonly storageProvider: string;
  readonly objectLocator: string;
  readonly objectVersionId: string;
} {
  return {
    storageProvider: row.storage_provider,
    objectLocator: row.object_locator,
    objectVersionId: row.object_version_id,
  };
}

function assertReadbackMetadata(readback: ObjectStorageReadback, facts: ExactRevisionFacts): void {
  if (
    readback.storageProvider !== facts.contentObject.storage_provider ||
    readback.objectLocator !== facts.contentObject.object_locator ||
    readback.objectVersionId !== facts.contentObject.object_version_id ||
    readback.mediaType !== facts.contentObject.media_type ||
    !Number.isSafeInteger(readback.byteSize) ||
    readback.byteSize < 0 ||
    readback.byteSize !== readback.bytes.byteLength
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'authoritative Structured Document readback metadata is not acceptable',
    );
  }
}

async function readStructuredDocument(
  storage: ObjectStoragePort,
  context: ArtifactTransactionContext,
  facts: ExactRevisionFacts,
): Promise<StructuredDocumentRead> {
  let readback: ObjectStorageReadback;
  try {
    readback = await storage.read(storageReference(facts.contentObject));
  } catch {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
      'authoritative Structured Document object is unavailable',
    );
  }
  assertReadbackMetadata(readback, facts);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readback.bytes.toString('utf8')) as unknown;
  } catch {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'authoritative Structured Document object is not valid JSON',
    );
  }
  const validation = registry.validateCanonicalContent(parsed);
  if (!validation.valid) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'authoritative Structured Document object failed executable validation',
    );
  }
  const payload = parsed as Artifact.CanonicalDocumentContent;
  const payloadSchemaRef = normalizeSchemaRef(
    payload.schemaRef,
    context,
    facts.root.project_id ?? undefined,
  );
  if (
    canonicalize(payloadSchemaRef as unknown as CanonicalJsonValue) !==
    canonicalize(facts.schemaRef as unknown as CanonicalJsonValue)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'authoritative Structured Document SchemaRef does not match the Revision',
    );
  }
  const hashablePayload = payload as unknown as SharedCanonicalContentPayload;
  const canonicalBytes = Buffer.from(canonicalizeCanonicalContentPayload(hashablePayload), 'utf8');
  const calculatedHash = hashCanonicalContentPayload(hashablePayload);
  if (
    !readback.bytes.equals(canonicalBytes) ||
    !facts.revision.content_hash.equals(Buffer.from(calculatedHash.digest, 'hex')) ||
    !facts.contentObject.content_hash.equals(Buffer.from(calculatedHash.digest, 'hex'))
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'authoritative Structured Document bytes do not match the immutable Revision Hash',
    );
  }
  const normalized = canonicalizeStructuredDocument(
    payload.body,
    facts.schemaRef,
    context,
    facts.root.project_id ?? undefined,
  );
  return {
    document: normalized.payload.body,
    canonicalBytes,
    contentHash: calculatedHash,
  };
}

/** Owning immutable read shared by the public Markdown review and renderer ports. */
export async function readFrozenStructuredRevision(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  storage: ObjectStoragePort,
  revisionRef: Common.ContentAddressedRef,
) {
  const facts = await readExactRevisionFacts(db, context, revisionRef, false, false);
  const content = await readStructuredDocument(storage, context, facts);
  if (
    content.canonicalBytes.byteLength !== Number(facts.contentObject.byte_size) ||
    content.canonicalBytes.byteLength !== Number(facts.revision.byte_size) ||
    facts.contentObject.finalization_state !== 'FINALIZED'
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'Frozen content integrity mismatch',
    );
  }
  return { facts, content };
}

async function readContentObject(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  contentObjectId: string,
): Promise<ArtifactContentObjectTable> {
  return withArtifactTransaction(db, context, async (trx) => {
    const row = await repo.getContentObjectById(trx, contentObjectId);
    if (row === undefined) {
      throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'content object is not visible');
    }
    return row;
  });
}

function derivedUuidV7(seed: string, label: string): string {
  const hex = createHash('sha256')
    .update(`${seed}:${label}`, 'utf8')
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '7';
  hex[16] = '8';
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function stepEnvelope<TPayload>(
  outer: StructuredDocumentEditCommandEnvelope,
  step: string,
  commandType: string,
  payload: TPayload,
  targetType: string,
  targetId: string,
  projectId: string | undefined,
): CommandEnvelope & { readonly payload: TPayload } {
  return {
    commandId: derivedUuidV7(outer.commandId, step),
    commandType,
    commandVersion: '1.0',
    idempotencyScope: outer.idempotencyScope,
    idempotencyKey: `${outer.idempotencyKey}:${step}`,
    requestPayload: payload as unknown as CanonicalJsonObject,
    enterpriseId: outer.enterpriseId,
    ...(projectId === undefined ? {} : { projectId }),
    targetType,
    targetId,
    correlationId: outer.correlationId,
    causationId: outer.commandId,
    principalId: outer.principalId,
    principalKind: outer.principalKind,
    actorSnapshotId: outer.actorSnapshotId,
    authorizationDecisionId: outer.authorizationDecisionId,
    policySnapshotId: outer.policySnapshotId,
    payload,
  };
}

function assertCommandCommitted(result: CommandResult, operation: string): CanonicalJsonObject {
  if (result.status === 'COMMITTED') return result.resultPayload;
  if (result.status === 'DUPLICATE' && result.originalOutcome === 'COMMITTED') {
    if (result.resultPayload === null) {
      throw new ArtifactBusinessError(
        ARTIFACT_CONTENT_STATE_INVALID,
        `${operation} replay did not contain a committed result`,
      );
    }
    return result.resultPayload;
  }
  if (result.status === 'REJECTED') {
    throw new ArtifactBusinessError(result.errorCode, result.safeSummary);
  }
  throw new ArtifactBusinessError(ARTIFACT_CONTENT_STATE_INVALID, `${operation} did not commit`);
}

function assertTargetArtifact(envelope: StructuredDocumentEditCommandEnvelope): void {
  if (!ROOT_OBJECT_TYPES.has(envelope.targetType) || !isUuidV7(envelope.targetId)) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'Structured Document Human Edit target must be an Artifact UUIDv7',
    );
  }
}

function validatedEditPayload(payload: unknown): StructuredDocumentEditPayload {
  const value = record(payload);
  const allowedKeys = new Set(['baseRevisionRef', 'allowedUnitRefs', 'document', 'changeSummary']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURED_DOCUMENT_EDIT_SCOPE,
      'Structured Document Human Edit payload contains an unsupported field',
    );
  }
  if (
    !Array.isArray(value.allowedUnitRefs) ||
    value.allowedUnitRefs.length === 0 ||
    value.allowedUnitRefs.some(
      (unitId) => typeof unitId !== 'string' || unitId.trim().length === 0,
    ) ||
    new Set(value.allowedUnitRefs).size !== value.allowedUnitRefs.length ||
    typeof value.changeSummary !== 'string' ||
    value.changeSummary.trim().length === 0 ||
    value.document === null ||
    typeof value.document !== 'object' ||
    Array.isArray(value.document)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURED_DOCUMENT_EDIT_SCOPE,
      'Structured Document Human Edit payload is incomplete',
    );
  }
  return {
    baseRevisionRef: value.baseRevisionRef as Common.ContentAddressedRef,
    allowedUnitRefs: value.allowedUnitRefs as readonly string[],
    document: value.document as Artifact.CanonicalDocument,
    changeSummary: value.changeSummary,
  };
}

function baseProvenanceForEdit(
  value: unknown,
  context: ArtifactTransactionContext,
): Artifact.RevisionProvenance {
  const stored = record(value);
  const sourceMaterialRefs = Array.isArray(stored.sourceMaterialRefs)
    ? stored.sourceMaterialRefs
    : [];
  const toolchainVersions = Array.isArray(stored.toolchainVersions) ? stored.toolchainVersions : [];
  const principal: Common.ObjectRef = {
    kind: 'OBJECT',
    objectType: 'identity.principal',
    objectId: context.principalId,
    scope: { enterpriseId: context.enterpriseId },
  };
  return canonicalJsonClone({
    ...stored,
    principal,
    sourceMaterialRefs,
    toolchainVersions,
  });
}

export async function handleHumanStructuredDocumentEdit(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: StructuredDocumentEditCommandEnvelope,
  storage: ObjectStoragePort,
): Promise<StructuredDocumentEditResult> {
  if (context.principalKind !== 'HUMAN' || envelope.principalKind !== 'HUMAN') {
    throw new ArtifactBusinessError(
      ARTIFACT_HUMAN_ONLY_DENIED,
      'Structured Document Human Edit requires a HUMAN principal',
    );
  }
  assertEnvelopeMatchesContext(context, envelope);
  assertTargetArtifact(envelope);
  const payload = validatedEditPayload(envelope.payload);
  const facts = await readExactRevisionFacts(db, context, payload.baseRevisionRef, true);
  if (facts.root.artifact_id !== envelope.targetId) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
      'Human Edit target Artifact does not match the exact base Revision',
    );
  }
  if (facts.disposition !== 'ACTIVE') {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID,
      'Human Edit base Revision is not active',
    );
  }
  const base = await readStructuredDocument(storage, context, facts);
  const candidate = canonicalizeStructuredDocument(
    payload.document,
    facts.schemaRef,
    context,
    facts.root.project_id ?? undefined,
  );
  if (candidate.payload.body.documentId !== base.document.documentId) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURED_DOCUMENT_ID_MISMATCH,
      'Human Edit cannot change the Structured Document documentId',
    );
  }
  if (
    documentMetadataFingerprint(candidate.payload.body) !==
    documentMetadataFingerprint(base.document)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURED_DOCUMENT_EDIT_SCOPE,
      'Human Edit cannot change Structured Document title or metadata',
    );
  }
  const diff = diffStructuredDocuments(base.document, candidate.payload.body);
  const candidateUnitIds = new Set(candidate.payload.body.units.map((unit) => unit.unitId));
  const baseUnitIds = new Set(base.document.units.map((unit) => unit.unitId));
  const knownUnitIds = new Set([...candidateUnitIds, ...baseUnitIds]);
  if (payload.allowedUnitRefs.some((unitId) => !knownUnitIds.has(unitId))) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURED_DOCUMENT_EDIT_SCOPE,
      'Human Edit allowedUnitRefs contains an unknown Unit',
    );
  }
  const allowedUnitIds = new Set(payload.allowedUnitRefs);
  if (diff.documentChanged || diff.entries.some((entry) => !allowedUnitIds.has(entry.unitId))) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURED_DOCUMENT_EDIT_SCOPE,
      'Human Edit contains a Unit change outside allowedUnitRefs',
    );
  }
  if (diff.entries.length === 0) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURED_DOCUMENT_NOOP,
      'Human Edit does not change the canonical Structured Document',
    );
  }

  const contentObjectId = derivedUuidV7(envelope.commandId, 'content-object');
  const revisionId = derivedUuidV7(envelope.commandId, 'revision');
  const projectId = facts.root.project_id ?? undefined;
  const stagePayload: StageCanonicalContentPayload = {
    content: candidate.payload,
    declaredContentHash: candidate.contentHash,
  };
  const stageEnvelope = stepEnvelope(
    envelope,
    'stage',
    'artifact.structured_document.human_edit.stage',
    stagePayload,
    CANONICAL_OBJECT_TYPE,
    contentObjectId,
    projectId,
  ) as CanonicalContentCommandEnvelope<StageCanonicalContentPayload>;
  assertCommandCommitted(
    await stageCanonicalContent(db, context, stageEnvelope, storage),
    'Structured Document stage',
  );

  const linkPayload: LinkCanonicalContentPayload = {
    ownerObjectType: REVISION_OBJECT_TYPE,
    ownerObjectId: revisionId,
    ownerVersionId: revisionId,
    ownerPayloadHash: candidate.contentHash,
  };
  const linkEnvelope = stepEnvelope(
    envelope,
    'link',
    'artifact.structured_document.human_edit.link',
    linkPayload,
    CANONICAL_OBJECT_TYPE,
    contentObjectId,
    projectId,
  ) as CanonicalContentCommandEnvelope<LinkCanonicalContentPayload>;
  const linked = await linkCanonicalContent(db, context, linkEnvelope, storage);
  assertCommandCommitted(linked.commandResult, 'Structured Document link');
  if (linked.finalizationState === 'UNKNOWN') {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_FINALIZATION_UNKNOWN,
      'Structured Document Content Object finalization is unknown and remains retryable',
    );
  }
  const linkedRow = await readContentObject(db, context, contentObjectId);
  if (linkedRow.storage_state === 'LINKED') {
    const freezeEnvelope = stepEnvelope(
      envelope,
      'freeze',
      'artifact.structured_document.human_edit.freeze',
      { contentObjectId },
      CANONICAL_OBJECT_TYPE,
      contentObjectId,
      projectId,
    );
    assertCommandCommitted(
      await freezeCanonicalContent(db, context, freezeEnvelope),
      'Structured Document freeze',
    );
  }
  const frozenRow = await readContentObject(db, context, contentObjectId);
  if (frozenRow.storage_state !== 'FROZEN') {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_STATE_INVALID,
      'Structured Document Content Object was not frozen before Revision creation',
    );
  }

  const changedUnits = [...new Set(diff.entries.map((entry) => entry.unitId))].sort(compareUtf8);
  const revision: Artifact.RevisionContent = {
    artifactRef: artifactRefForRoot(facts.root),
    branchId: facts.revision.branch_id,
    parentRevisionRefs: [facts.ref],
    contentType: 'STRUCTURED_DOCUMENT',
    contentRef: frozenRow.object_locator,
    contentHash: candidate.contentHash,
    structureSchemaRef: facts.schemaRef,
    semanticMetadata: storedJson(facts.revision.semantic_metadata, 'semanticMetadata'),
    changedUnits,
    changeSummary: payload.changeSummary,
    provenance: baseProvenanceForEdit(facts.revision.provenance, context),
  };
  const createPayload: CreateAndSealRevisionPayload = { revision };
  const createEnvelope = stepEnvelope(
    envelope,
    'revision',
    'artifact.structured_document.human_edit.create_revision',
    createPayload,
    REVISION_OBJECT_TYPE,
    revisionId,
    projectId,
  ) as RevisionCommandEnvelope<CreateAndSealRevisionPayload>;
  assertCommandCommitted(
    await handleCreateAndSealRevision(db, context, createEnvelope),
    'Structured Document Revision creation',
  );
  const newRevisionRef: Common.ContentAddressedRef = {
    kind: 'CONTENT_ADDRESSED',
    objectType: REVISION_REF_OBJECT_TYPE,
    objectId: revisionId,
    scope: rootScope(facts.root),
    contentHash: candidate.contentHash,
  };
  const snapshot = await handleGetRevisionSnapshot(db, context, { revisionRef: newRevisionRef });
  return {
    baseRevisionRef: facts.ref,
    revision: snapshot,
    contentObjectId,
    contentRef: frozenRow.object_locator,
    canonicalBytes: candidate.canonicalBytes.toString('utf8'),
    contentHash: candidate.contentHash,
    diff,
  };
}

export async function handleGetStructuredDocumentDiff(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  payload: GetRevisionDiffInputsPayload,
  storage: ObjectStoragePort,
): Promise<StructuredDocumentDiffResult> {
  const inputs = await handleGetRevisionDiffInputs(db, context, payload);
  if (
    inputs.left.contentType !== 'STRUCTURED_DOCUMENT' ||
    inputs.right.contentType !== 'STRUCTURED_DOCUMENT'
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURE_SCHEMA_INVALID,
      'Structured Document Diff requires two Structured Document Revisions',
    );
  }
  const leftFacts = await readExactRevisionFacts(
    db,
    context,
    inputs.left.revisionRef,
    false,
    false,
  );
  const rightFacts = await readExactRevisionFacts(
    db,
    context,
    inputs.right.revisionRef,
    false,
    false,
  );
  if (
    canonicalize(leftFacts.schemaRef as unknown as CanonicalJsonValue) !==
    canonicalize(rightFacts.schemaRef as unknown as CanonicalJsonValue)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_STRUCTURE_SCHEMA_INVALID,
      'Structured Document Diff requires matching structure SchemaRefs',
    );
  }
  const left = await readStructuredDocument(storage, context, leftFacts);
  const right = await readStructuredDocument(storage, context, rightFacts);
  return {
    inputs,
    diff: diffStructuredDocuments(left.document, right.document),
    leftCanonicalBytes: left.canonicalBytes.toString('utf8'),
    rightCanonicalBytes: right.canonicalBytes.toString('utf8'),
  };
}
