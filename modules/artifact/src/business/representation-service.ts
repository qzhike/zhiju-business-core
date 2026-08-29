// IM-04 WI-08 (issue #97): immutable Representation registration through the
// public IntegrationGateway RenderAttempt binding query only.

import type { Kysely } from 'kysely';
import {
  ContractRegistry,
  type Artifact,
  type Common,
  type IntegrationGateway,
} from '@zhiju/contracts';
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
  type ArtifactTransactionContext,
} from '../persistence/artifact-db.js';
import {
  ArtifactRepository,
  type ArtifactRepresentationCreateOutcome,
} from '../persistence/artifact-repository.js';
import {
  ArtifactBusinessError,
  ARTIFACT_CONTENT_HASH_MISMATCH,
  ARTIFACT_NOT_ACTIVE,
  ARTIFACT_QUERY_NOT_FOUND,
  ARTIFACT_REPRESENTATION_BINDING_INVALID,
  ARTIFACT_REPRESENTATION_BINDING_MISMATCH,
  ARTIFACT_REPRESENTATION_FORMAT_INVALID,
  ARTIFACT_REPRESENTATION_IDENTITY_CONFLICT,
  ARTIFACT_SCOPE_INVALID,
} from './artifact-business-errors.js';
import {
  CommandExecutionError,
  executeArtifactCommand,
  type CommandBodyResult,
  type CommandEnvelope,
  type CommandExecution,
  type CommandResult,
} from '../persistence/command-runner.js';

const registry = new ContractRegistry();
const repo = new ArtifactRepository();
const REPRESENTATION_OBJECT_TYPES = new Set(['Representation', 'artifact.representation']);
const REVISION_OBJECT_TYPES = new Set(['artifact.artifact_revision']);
const ATTEMPT_OBJECT_TYPES = new Set(['integration.render_attempt']);
const RAW_RECEIPT_OBJECT_TYPES = new Set(['integration.raw_external_receipt']);
const REPRESENTATION_OBJECT_TYPE = 'Representation';
const REVISION_OBJECT_TYPE = 'ArtifactRevision';
const ARTIFACT_OBJECT_TYPE = 'Artifact';
const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/;
const LOCATOR_PATTERN = /^[a-z0-9][a-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+$/;
const MEDIA_TYPE_BY_FORMAT_FAMILY = Object.freeze({
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

type RecordLike = Readonly<Record<string, unknown>>;

export type RegisterRepresentationPayload = Artifact.ArtifactRegisterRepresentationPayload;
export type RegisterRepresentationCommandEnvelope = CommandEnvelope & {
  readonly payload: RegisterRepresentationPayload;
};
export type GetRepresentationPayload = Artifact.ArtifactGetRepresentationPayload;

export interface RenderAttemptBindingQueryInput {
  readonly attemptRef: Common.ObjectRef;
  readonly enterpriseId: string;
  readonly projectId?: string;
}

export interface RenderAttemptBindingQueryPort {
  getRenderAttemptBinding(input: RenderAttemptBindingQueryInput): Promise<unknown>;
}

export interface RegisterRepresentationOptions {
  readonly failAfterOutbox?: boolean;
}

interface ScopeFacts {
  readonly enterpriseId: string;
  readonly projectId?: string;
}

interface NormalizedRegistration {
  readonly registration: Artifact.RepresentationRegistration;
  readonly revisionRef: Common.ContentAddressedRef;
  readonly renderAttemptRef: Common.ObjectRef;
  readonly format: string;
  readonly mediaType: string;
  readonly objectLocator: string;
  readonly checksum: Common.ContentHash;
  readonly checksumBytes: Buffer;
  readonly rendererId: string;
  readonly rendererVersion: string;
  readonly registeredAt: Date;
  readonly projectId?: string;
}

export interface ValidatedRepresentationBinding extends NormalizedRegistration {
  readonly binding: IntegrationGateway.RenderAttemptBindingView;
  readonly canonicalContentRef: string;
  readonly requestPayloadHash: Common.ContentHash;
  readonly requestPayloadHashBytes: Buffer;
  readonly inputHash: Common.ContentHash;
  readonly inputHashBytes: Buffer;
  readonly rawReceiptRef: Common.ContentAddressedRef;
}

function record(value: unknown): RecordLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordLike)
    : {};
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalize(left as CanonicalJsonValue) === canonicalize(right as CanonicalJsonValue);
  } catch {
    return false;
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label} must be non-empty`);
  }
  return value;
}

function assertNamespace(value: unknown, label: string): string {
  const parsed = nonEmptyString(value, label);
  if (!NAMESPACE_PATTERN.test(parsed)) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label} must be a NamespaceCode`);
  }
  return parsed;
}

function assertScope(
  value: unknown,
  context: ArtifactTransactionContext,
  label: string,
  expectedProjectId?: string,
): ScopeFacts {
  const scope = record(value);
  if (scope.enterpriseId !== context.enterpriseId) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, `${label} is outside the Enterprise`);
  }
  if (
    scope.projectId !== undefined &&
    (typeof scope.projectId !== 'string' ||
      !isUuidV7(scope.projectId) ||
      !context.allowedProjectIds.includes(scope.projectId))
  ) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, `${label} is outside the Project`);
  }
  if (expectedProjectId !== undefined && scope.projectId !== expectedProjectId) {
    throw new ArtifactBusinessError(
      ARTIFACT_REPRESENTATION_BINDING_MISMATCH,
      `${label} does not match the Representation Project`,
    );
  }
  return {
    enterpriseId: context.enterpriseId,
    ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
  };
}

function assertContentHash(value: unknown, label: string): Common.ContentHash {
  const hash = record(value);
  if (
    hash.algorithm !== 'SHA-256' ||
    hash.canonicalizationVersion !== '1' ||
    typeof hash.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(hash.digest)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_REPRESENTATION_BINDING_INVALID,
      `${label} must be a canonical SHA-256 value`,
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
  label: string,
  objectTypes: ReadonlySet<string>,
  expectedProjectId?: string,
): Common.ObjectRef {
  const ref = record(value);
  const scope = assertScope(ref.scope, context, `${label}.scope`, expectedProjectId);
  if (
    ref.kind !== 'OBJECT' ||
    typeof ref.objectType !== 'string' ||
    !objectTypes.has(ref.objectType) ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_REPRESENTATION_BINDING_INVALID,
      `${label} is not an exact ObjectRef`,
    );
  }
  return {
    kind: 'OBJECT',
    objectType: ref.objectType,
    objectId: ref.objectId,
    scope,
  };
}

function assertContentAddressedRef(
  value: unknown,
  context: ArtifactTransactionContext,
  label: string,
  objectTypes?: ReadonlySet<string>,
  expectedProjectId?: string,
): Common.ContentAddressedRef {
  const ref = record(value);
  const scope = assertScope(ref.scope, context, `${label}.scope`, expectedProjectId);
  if (
    ref.kind !== 'CONTENT_ADDRESSED' ||
    typeof ref.objectType !== 'string' ||
    !NAMESPACE_PATTERN.test(ref.objectType) ||
    (objectTypes !== undefined && !objectTypes.has(ref.objectType)) ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    (ref.immutableVersionId !== undefined &&
      (typeof ref.immutableVersionId !== 'string' || !isUuidV7(ref.immutableVersionId)))
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_REPRESENTATION_BINDING_INVALID,
      `${label} is not an exact ContentAddressedRef`,
    );
  }
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: ref.objectType,
    objectId: ref.objectId,
    ...(ref.immutableVersionId === undefined ? {} : { immutableVersionId: ref.immutableVersionId }),
    scope,
    contentHash: assertContentHash(ref.contentHash, `${label}.contentHash`),
  };
}

function assertLocator(value: unknown, label: string): string {
  if (typeof value !== 'string' || !LOCATOR_PATTERN.test(value)) {
    throw new ArtifactBusinessError(
      ARTIFACT_REPRESENTATION_BINDING_INVALID,
      `${label} must be an opaque object locator`,
    );
  }
  return value;
}

function assertInstant(value: unknown, label: string): Date {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
  ) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label} must be a UTC instant`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label} must be a UTC instant`);
  }
  return parsed;
}

function mediaTypeForFormat(format: string): string {
  const family = format.split(/[._]/).at(-1);
  const mediaType =
    family === undefined
      ? undefined
      : MEDIA_TYPE_BY_FORMAT_FAMILY[family as keyof typeof MEDIA_TYPE_BY_FORMAT_FAMILY];
  if (mediaType === undefined) {
    throw new ArtifactBusinessError(
      ARTIFACT_REPRESENTATION_FORMAT_INVALID,
      'Representation format is outside the closed WI-08 format families',
    );
  }
  return mediaType;
}

function normalizeRegistration(
  value: unknown,
  context: ArtifactTransactionContext,
): NormalizedRegistration {
  const registration = record(value);
  const revisionRef = assertContentAddressedRef(
    registration.revisionRef,
    context,
    'registration.revisionRef',
    REVISION_OBJECT_TYPES,
  );
  const projectId = revisionRef.scope.projectId;
  const renderAttemptRef = assertObjectRef(
    registration.renderAttemptRef,
    context,
    'registration.renderAttemptRef',
    ATTEMPT_OBJECT_TYPES,
    projectId,
  );
  const format = assertNamespace(registration.format, 'registration.format');
  const expectedMediaType = mediaTypeForFormat(format);
  const mediaType = nonEmptyString(registration.mediaType, 'registration.mediaType');
  if (mediaType !== expectedMediaType) {
    throw new ArtifactBusinessError(
      ARTIFACT_REPRESENTATION_FORMAT_INVALID,
      'Representation mediaType does not match its closed format family',
    );
  }
  const objectLocator = assertLocator(registration.objectRef, 'registration.objectRef');
  const checksum = assertContentHash(registration.checksum, 'registration.checksum');
  const rendererId = assertNamespace(registration.rendererId, 'registration.rendererId');
  const rendererVersion = nonEmptyString(
    registration.rendererVersion,
    'registration.rendererVersion',
  );
  const registeredAt = assertInstant(registration.createdAt, 'registration.createdAt');
  const normalized = {
    revisionRef,
    format,
    mediaType,
    objectRef: objectLocator,
    checksum,
    rendererId,
    rendererVersion,
    renderAttemptRef,
    createdAt: registeredAt.toISOString(),
  } satisfies Artifact.RepresentationRegistration;
  return {
    registration: normalized,
    revisionRef,
    renderAttemptRef,
    format,
    mediaType,
    objectLocator,
    checksum,
    checksumBytes: hashBytes(checksum),
    rendererId,
    rendererVersion,
    registeredAt,
    ...(projectId === undefined ? {} : { projectId }),
  };
}

function mismatch(condition: boolean, message: string): void {
  if (!condition) {
    throw new ArtifactBusinessError(ARTIFACT_REPRESENTATION_BINDING_MISMATCH, message);
  }
}

export function validateRepresentationBinding(
  registrationValue: unknown,
  bindingValue: unknown,
  context: ArtifactTransactionContext,
): ValidatedRepresentationBinding {
  const registration = normalizeRegistration(registrationValue, context);
  const contract = registry.validateOperationResult(
    'integration.get_render_attempt_binding',
    '1.0',
    bindingValue,
  );
  if (!contract.valid) {
    throw new ArtifactBusinessError(
      ARTIFACT_REPRESENTATION_BINDING_INVALID,
      'RenderAttempt Binding Query returned a contract-invalid result',
    );
  }
  const binding = bindingValue as IntegrationGateway.RenderAttemptBindingView;
  if (binding.status !== 'SUCCEEDED' || binding.succeededResult === undefined) {
    throw new ArtifactBusinessError(
      ARTIFACT_REPRESENTATION_BINDING_INVALID,
      'RenderAttempt is not an authoritative successful binding',
    );
  }
  if (binding.rawReceiptRef === undefined) {
    throw new ArtifactBusinessError(
      ARTIFACT_REPRESENTATION_BINDING_INVALID,
      'successful RenderAttempt Binding is missing its raw receipt',
    );
  }
  const bindingAttemptRef = assertObjectRef(
    binding.attemptRef,
    context,
    'binding.attemptRef',
    ATTEMPT_OBJECT_TYPES,
    registration.projectId,
  );
  const resultAttemptRef = assertObjectRef(
    binding.succeededResult.attemptRef,
    context,
    'binding.succeededResult.attemptRef',
    ATTEMPT_OBJECT_TYPES,
    registration.projectId,
  );
  const requestRevisionRef = assertContentAddressedRef(
    binding.request.revisionRef,
    context,
    'binding.request.revisionRef',
    REVISION_OBJECT_TYPES,
    registration.projectId,
  );
  const resultRevisionRef = assertContentAddressedRef(
    binding.succeededResult.revisionRef,
    context,
    'binding.succeededResult.revisionRef',
    REVISION_OBJECT_TYPES,
    registration.projectId,
  );
  assertScope(
    record(binding.request.renderPolicyRef).scope,
    context,
    'binding.request.renderPolicyRef.scope',
    registration.projectId,
  );
  const topReceiptRef = assertContentAddressedRef(
    binding.rawReceiptRef,
    context,
    'binding.rawReceiptRef',
    RAW_RECEIPT_OBJECT_TYPES,
    registration.projectId,
  );
  const resultReceiptRef = assertContentAddressedRef(
    binding.succeededResult.rawReceiptRef,
    context,
    'binding.succeededResult.rawReceiptRef',
    RAW_RECEIPT_OBJECT_TYPES,
    registration.projectId,
  );
  mismatch(
    canonicalEqual(bindingAttemptRef, registration.renderAttemptRef) &&
      canonicalEqual(resultAttemptRef, registration.renderAttemptRef),
    'RenderAttempt references do not match Registration',
  );
  mismatch(
    canonicalEqual(requestRevisionRef, registration.revisionRef) &&
      canonicalEqual(resultRevisionRef, registration.revisionRef),
    'Revision references do not match Registration',
  );
  mismatch(
    canonicalEqual(topReceiptRef, resultReceiptRef),
    'successful RenderAttempt raw receipt references do not match',
  );
  const canonicalContentRef = assertLocator(
    binding.request.canonicalContentRef,
    'binding.request.canonicalContentRef',
  );
  const inputHash = assertContentHash(binding.request.inputHash, 'binding.request.inputHash');
  const requestPayloadHash = assertContentHash(
    binding.requestPayloadHash,
    'binding.requestPayloadHash',
  );
  mismatch(
    canonicalEqual(inputHash, registration.revisionRef.contentHash),
    'Render input hash does not match the immutable Revision content hash',
  );
  mismatch(binding.request.outputFormat === registration.format, 'output format does not match');
  mismatch(
    binding.request.rendererId === registration.rendererId &&
      binding.succeededResult.rendererId === registration.rendererId,
    'renderer ID does not match',
  );
  mismatch(
    binding.request.rendererVersion === registration.rendererVersion &&
      binding.succeededResult.rendererVersion === registration.rendererVersion,
    'renderer version does not match',
  );
  mismatch(
    binding.succeededResult.outputObjectRef === registration.objectLocator,
    'output object locator does not match',
  );
  mismatch(
    canonicalEqual(binding.succeededResult.outputChecksum, registration.checksum),
    'output checksum does not match',
  );
  const requestedAt = assertInstant(binding.request.requestedAt, 'binding.request.requestedAt');
  mismatch(
    registration.registeredAt.getTime() >= requestedAt.getTime(),
    'Registration createdAt precedes the render request',
  );
  return {
    ...registration,
    binding,
    canonicalContentRef,
    requestPayloadHash,
    requestPayloadHashBytes: hashBytes(requestPayloadHash),
    inputHash,
    inputHashBytes: hashBytes(inputHash),
    rawReceiptRef: topReceiptRef,
  };
}

function rejected(errorCode: string, safeSummary: string): CommandBodyResult {
  return { kind: 'REJECTED', errorCode, safeSummary };
}

function createOutcomeRejection(outcome: ArtifactRepresentationCreateOutcome): CommandBodyResult {
  switch (outcome) {
    case 'NOT_ACTIVE':
    case 'REVISION_NOT_ACTIVE':
      return rejected(ARTIFACT_NOT_ACTIVE, 'Artifact or Revision is not active');
    case 'BINDING_MISMATCH':
      return rejected(
        ARTIFACT_REPRESENTATION_BINDING_MISMATCH,
        'authoritative Revision or Binding facts do not match',
      );
    case 'CONFLICT':
      return rejected(
        ARTIFACT_REPRESENTATION_IDENTITY_CONFLICT,
        'Representation or RenderAttempt identity is already occupied',
      );
    case 'NOT_FOUND':
      return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Artifact Revision was not found');
    case 'OK':
    case 'ALREADY':
      return rejected(ARTIFACT_SCOPE_INVALID, 'unexpected Representation create outcome');
  }
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
  return value as CanonicalJsonValue;
}

function contentHashForBytes(value: Buffer): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: value.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function scopeForRow(row: { enterprise_id: string; project_id: string | null }): Common.ScopeRef {
  return {
    enterpriseId: row.enterprise_id,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
  };
}

function representationRefForRow(
  row: NonNullable<Awaited<ReturnType<ArtifactRepository['getRepresentationById']>>>,
): Artifact.RepresentationRef {
  return {
    representationId: row.representation_id,
    revision: jsonColumn(row.revision_ref, 'revisionRef') as unknown as Common.ContentAddressedRef,
    format: row.format,
    mediaType: row.media_type,
    objectStorageRef: row.object_locator,
    checksum: contentHashForBytes(row.checksum),
    renderer: {
      rendererId: row.renderer_id,
      rendererVersion: row.renderer_version,
    },
    createdAt: row.registered_at.toISOString(),
  };
}

function registrationForRow(
  row: NonNullable<Awaited<ReturnType<ArtifactRepository['getRepresentationById']>>>,
): Artifact.RepresentationRegistration {
  return {
    revisionRef: jsonColumn(
      row.revision_ref,
      'revisionRef',
    ) as unknown as Common.ContentAddressedRef,
    format: row.format,
    mediaType: row.media_type,
    objectRef: row.object_locator,
    checksum: contentHashForBytes(row.checksum),
    rendererId: row.renderer_id,
    rendererVersion: row.renderer_version,
    renderAttemptRef: jsonColumn(
      row.render_attempt_ref,
      'renderAttemptRef',
    ) as unknown as Common.ObjectRef,
    createdAt: row.registered_at.toISOString(),
  };
}

function representationViewForRow(
  row: NonNullable<Awaited<ReturnType<ArtifactRepository['getRepresentationById']>>>,
): Artifact.RepresentationView {
  const registration = registrationForRow(row);
  return {
    representationRef: representationRefForRow(row),
    status: 'registered',
    registrationRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'artifact.representation_registration',
      objectId: row.representation_id,
      scope: scopeForRow(row),
      contentHash: contentHashForBytes(
        digestCanonicalPayload(registration as unknown as CanonicalJsonObject).hash,
      ),
    },
  };
}

async function appendRepresentationEdges(
  execution: CommandExecution,
  row: NonNullable<Awaited<ReturnType<ArtifactRepository['getRepresentationById']>>>,
  validated: ValidatedRepresentationBinding,
): Promise<void> {
  const common = {
    ownerObjectType: REPRESENTATION_OBJECT_TYPE,
    ownerObjectId: row.representation_id,
    ownerPayloadHash: row.checksum,
  } as const;
  await execution.appendReferenceEdge({
    ...common,
    referencePath: '/revisionRef',
    targetModule: 'artifact',
    targetObjectType: REVISION_OBJECT_TYPE,
    targetObjectId: validated.revisionRef.objectId,
    ...(validated.revisionRef.immutableVersionId === undefined
      ? {}
      : { targetVersionId: validated.revisionRef.immutableVersionId }),
    targetPayloadHash: hashBytes(validated.revisionRef.contentHash),
    referencePurpose: 'ARTIFACT_REPRESENTATION_REVISION',
  });
  await execution.appendReferenceEdge({
    ...common,
    referencePath: '/renderAttemptRef',
    targetModule: 'integration-gateway',
    targetObjectType: validated.renderAttemptRef.objectType,
    targetObjectId: validated.renderAttemptRef.objectId,
    referencePurpose: 'ARTIFACT_REPRESENTATION_RENDER_ATTEMPT',
  });
  await execution.appendReferenceEdge({
    ...common,
    referencePath: '/rawReceiptRef',
    targetModule: 'integration-gateway',
    targetObjectType: validated.rawReceiptRef.objectType,
    targetObjectId: validated.rawReceiptRef.objectId,
    ...(validated.rawReceiptRef.immutableVersionId === undefined
      ? {}
      : { targetVersionId: validated.rawReceiptRef.immutableVersionId }),
    targetPayloadHash: hashBytes(validated.rawReceiptRef.contentHash),
    referencePurpose: 'ARTIFACT_REPRESENTATION_RAW_RECEIPT',
  });
}

export async function handleRegisterRepresentation(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: RegisterRepresentationCommandEnvelope,
  bindingPort: RenderAttemptBindingQueryPort,
  options: RegisterRepresentationOptions = {},
): Promise<CommandResult> {
  if (!REPRESENTATION_OBJECT_TYPES.has(envelope.targetType) || !isUuidV7(envelope.targetId)) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'Representation command target must be a Representation UUIDv7',
    );
  }
  const normalizedRegistration = normalizeRegistration(envelope.payload.registration, context);
  let validated: ValidatedRepresentationBinding | undefined;
  let bindingError: ArtifactBusinessError | undefined;
  try {
    const binding = await bindingPort.getRenderAttemptBinding({
      attemptRef: normalizedRegistration.renderAttemptRef,
      enterpriseId: context.enterpriseId,
      ...(normalizedRegistration.projectId === undefined
        ? {}
        : { projectId: normalizedRegistration.projectId }),
    });
    validated = validateRepresentationBinding(envelope.payload.registration, binding, context);
  } catch (error) {
    bindingError =
      error instanceof ArtifactBusinessError
        ? error
        : new ArtifactBusinessError(
            ARTIFACT_REPRESENTATION_BINDING_INVALID,
            'RenderAttempt Binding Query was unavailable',
          );
  }
  const normalizedEnvelope = {
    ...envelope,
    ...(normalizedRegistration.projectId === undefined
      ? { projectId: undefined }
      : { projectId: normalizedRegistration.projectId }),
    targetType: REPRESENTATION_OBJECT_TYPE,
  } satisfies CommandEnvelope;
  return executeArtifactCommand(db, context, normalizedEnvelope, async (execution) => {
    if (validated === undefined) {
      return rejected(
        bindingError?.code ?? ARTIFACT_REPRESENTATION_BINDING_INVALID,
        bindingError?.message ?? 'RenderAttempt Binding Query was unavailable',
      );
    }
    const revision = await repo.getRevisionById(execution.trx, validated.revisionRef.objectId);
    if (revision === undefined) {
      return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Artifact Revision was not found');
    }
    const root = await repo.getArtifactById(execution.trx, revision.artifact_id);
    if (root === undefined) return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Artifact was not found');
    if (root.lifecycle_status !== 'ACTIVE') {
      return rejected(ARTIFACT_NOT_ACTIVE, 'Artifact is not active');
    }
    if (
      root.enterprise_id !== context.enterpriseId ||
      (root.project_id ?? undefined) !== validated.projectId ||
      revision.enterprise_id !== root.enterprise_id ||
      revision.project_id !== root.project_id
    ) {
      return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Artifact Revision was not found');
    }
    if (!revision.content_hash.equals(hashBytes(validated.revisionRef.contentHash))) {
      return rejected(
        ARTIFACT_CONTENT_HASH_MISMATCH,
        'Revision Ref does not match the immutable Revision content hash',
      );
    }
    if (
      revision.object_locator !== validated.canonicalContentRef ||
      !revision.content_hash.equals(validated.inputHashBytes)
    ) {
      return rejected(
        ARTIFACT_REPRESENTATION_BINDING_MISMATCH,
        'Render request does not match the immutable Revision content identity',
      );
    }
    const governance = await repo.getRevisionGovernance(execution.trx, revision.revision_id);
    if (governance.withdrawal !== undefined || governance.invalidation !== undefined) {
      return rejected(ARTIFACT_NOT_ACTIVE, 'Revision is not active');
    }
    const created = await repo.registerRepresentation(execution.trx, {
      representationId: envelope.targetId,
      artifactId: root.artifact_id,
      revisionId: revision.revision_id,
      revisionRef: validated.revisionRef,
      enterpriseId: root.enterprise_id,
      projectId: root.project_id ?? undefined,
      format: validated.format,
      mediaType: validated.mediaType,
      objectLocator: validated.objectLocator,
      checksum: validated.checksumBytes,
      rendererId: validated.rendererId,
      rendererVersion: validated.rendererVersion,
      renderAttemptRef: validated.renderAttemptRef,
      canonicalContentRef: validated.canonicalContentRef,
      requestPayloadHash: validated.requestPayloadHashBytes,
      inputHash: validated.inputHashBytes,
      rawReceiptRef: validated.rawReceiptRef,
      registeredAt: validated.registeredAt,
      validationId: newUuidV7(),
      validatorId: 'artifact.render_attempt_binding',
      validatorVersion: '1',
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (created.outcome !== 'OK' && created.outcome !== 'ALREADY') {
      return createOutcomeRejection(created.outcome);
    }
    const representationId = created.representationId ?? envelope.targetId;
    const row = await repo.getRepresentationById(execution.trx, representationId);
    if (row === undefined) throw new Error('Representation disappeared after registration');
    const resultPayload = representationViewForRow(row) as unknown as CanonicalJsonObject;
    if (created.outcome === 'ALREADY') return { kind: 'COMMITTED', resultPayload };
    const eventPayload = {
      enterpriseId: root.enterprise_id,
      ...(root.project_id === null ? {} : { projectId: root.project_id }),
      artifactRef: {
        kind: 'OBJECT',
        objectType: ARTIFACT_OBJECT_TYPE,
        objectId: root.artifact_id,
        scope: scopeForRow(root),
      },
      revisionRef: validated.revisionRef,
      representationRef: representationRefForRow(row),
      renderAttemptRef: validated.renderAttemptRef,
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'artifact.RepresentationRegistered',
      eventVersion: '1.0',
      aggregateType: REPRESENTATION_OBJECT_TYPE,
      aggregateId: row.representation_id,
      aggregateVersion: '1',
      payload: eventPayload,
      occurredAt: row.registered_at,
    });
    await appendRepresentationEdges(execution, row, validated);
    if (options.failAfterOutbox === true) execution.failAfterOutbox();
    return { kind: 'COMMITTED', resultPayload };
  });
}

export async function handleGetRepresentation(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  payload: GetRepresentationPayload,
): Promise<Artifact.RepresentationView> {
  const requested = record(payload.representationRef);
  const representationId = requested.representationId;
  if (typeof representationId !== 'string' || !isUuidV7(representationId)) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Representation was not found');
  }
  const revision = record(requested.revision);
  assertScope(revision.scope, context, 'representationRef.revision.scope');
  return withArtifactTransaction(db, context, async (trx) => {
    const row = await repo.getRepresentationById(trx, representationId);
    if (row === undefined) {
      throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Representation was not found');
    }
    const view = representationViewForRow(row);
    if (!canonicalEqual(view.representationRef, payload.representationRef)) {
      throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Representation was not found');
    }
    return view;
  });
}
