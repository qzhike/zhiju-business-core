// IM-04 WI-04 (issue #93): Canonical Content Object lifecycle service.
// Revision, Representation and Renderer behaviour intentionally remain out of
// this service. The object-storage port is never treated as a database.

import type { Kysely } from 'kysely';
import {
  ContractRegistry,
  isExecutionDocumentSchema,
  type Artifact,
  type Common,
} from '@zhiju/contracts';
import {
  canonicalizeCanonicalContentPayload,
  contentHash,
  hashCanonicalContentPayload,
  isUuidV7,
  newUuidV7,
  type CanonicalContentPayload as SharedCanonicalContentPayload,
  type CanonicalJsonObject,
} from '@zhiju/shared-kernel';
import {
  digestCanonicalPayload,
  withArtifactTransaction,
  type ArtifactDb,
  type ArtifactTransactionContext,
} from '../persistence/artifact-db.js';
import {
  ArtifactRepository,
  type ContentObjectFinalizationOutcome,
  type ContentObjectLinkOutcome,
  type ContentObjectOrphanClaim,
  type ContentObjectOrphanCompletion,
  type ContentObjectStateOutcome,
} from '../persistence/artifact-repository.js';
import {
  executeArtifactCommand,
  type CommandBodyResult,
  type CommandEnvelope,
  type CommandResult,
} from '../persistence/command-runner.js';
import {
  ArtifactBusinessError,
  ARTIFACT_CONTENT_ALREADY_FROZEN,
  ARTIFACT_CONTENT_FINALIZATION_UNKNOWN,
  ARTIFACT_CONTENT_HASH_MISMATCH,
  ARTIFACT_CONTENT_NOT_FINALIZED,
  ARTIFACT_CONTENT_ORPHAN_RECORD_FAILED,
  ARTIFACT_CONTENT_OWNER_INVALID,
  ARTIFACT_CONTENT_READBACK_MISMATCH,
  ARTIFACT_CONTENT_SCHEMA_INVALID,
  ARTIFACT_CONTENT_STATE_INVALID,
  ARTIFACT_CONTENT_TARGET_INVALID,
  ARTIFACT_QUERY_NOT_FOUND,
} from './artifact-business-errors.js';
import type { ArtifactContentObjectTable } from '../persistence/artifact-business-types.js';
import type {
  ObjectStoragePort,
  ObjectStorageReadback,
  ObjectStorageReference,
} from '../storage/object-storage.js';

const repo = new ArtifactRepository();
const registry = new ContractRegistry();
const CANONICAL_OBJECT_TYPE = 'CanonicalContentObject';
const REVISION_OBJECT_TYPE = 'ArtifactRevision';
const CANONICAL_MEDIA_TYPE = 'application/json';
const STAGING_PREFIX = 'staging/canonical/';

export type CanonicalContentCommandEnvelope<TPayload> = CommandEnvelope & { payload: TPayload };

export interface StageCanonicalContentPayload {
  readonly content: unknown;
  readonly declaredContentHash?: unknown;
  readonly retentionClass?: string;
  readonly retentionUntil?: string;
  readonly legalHold?: boolean;
}

export interface LinkCanonicalContentPayload {
  readonly ownerObjectType: string;
  readonly ownerObjectId: string;
  readonly ownerVersionId: string;
  readonly ownerPayloadHash?: unknown;
}

export interface ContentObjectView {
  readonly contentObjectId: string;
  readonly payloadSchemaRef: Common.VersionedRef;
  readonly contentType: Artifact.CanonicalContentType;
  readonly canonicalizationVersion: '1';
  readonly contentHash: Common.ContentHash;
  readonly byteSize: number;
  readonly mediaType: string;
  readonly objectRef: string;
  readonly storageState: 'STAGING' | 'LINKED' | 'FROZEN' | 'QUARANTINED';
  readonly finalizationState: 'STAGED' | 'FINALIZED' | 'UNKNOWN';
  readonly aggregateVersion: number;
}

export interface LinkCanonicalContentResult {
  readonly commandResult: CommandResult;
  readonly finalizationState: 'FINALIZED' | 'UNKNOWN' | 'SKIPPED';
}

export interface OrphanCleanupReport {
  readonly orphanId: string;
  readonly attemptCount: number;
  readonly outcome: ContentObjectOrphanCompletion;
}

interface ValidatedCanonicalContent {
  readonly payload: Artifact.CanonicalContentPayload;
  readonly schemaRef: Common.VersionedRef;
  readonly projectId: string | undefined;
  readonly canonicalBytes: Buffer;
  readonly contentHash: Common.ContentHash;
  readonly hashBytes: Buffer;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};
}

function commandRejected(errorCode: string, safeSummary: string): CommandBodyResult {
  return { kind: 'REJECTED', errorCode, safeSummary };
}

function assertContentTarget(envelope: CommandEnvelope): void {
  if (envelope.targetType !== CANONICAL_OBJECT_TYPE || !isUuidV7(envelope.targetId)) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_TARGET_INVALID,
      'content object command target must be a CanonicalContentObject UUIDv7',
    );
  }
}

function parseRetentionUntil(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_SCHEMA_INVALID,
      'retentionUntil must be a valid UTC instant',
    );
  }
  return timestamp;
}

function retentionClass(value: string | undefined): string {
  const selected = value ?? 'CUSTOMER_RECORD';
  if (selected.trim().length === 0 || selected.length > 128) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_SCHEMA_INVALID,
      'retentionClass must be a bounded non-empty value',
    );
  }
  return selected;
}

function validatedSchemaRef(
  payload: Artifact.CanonicalContentPayload,
  context: ArtifactTransactionContext,
  envelope: CommandEnvelope,
): { schemaRef: Common.VersionedRef; projectId: string | undefined } {
  const schemaRef = record(payload.schemaRef);
  const scope = record(schemaRef.scope);
  const enterpriseId = scope.enterpriseId;
  const projectId =
    isExecutionDocumentSchema(payload.schemaRef, context.enterpriseId) &&
    envelope.projectId !== undefined &&
    context.allowedProjectIds.includes(envelope.projectId)
      ? envelope.projectId
      : scope.projectId;
  const expectedObjectType =
    payload.contentType === 'STRUCTURED_DOCUMENT'
      ? 'artifact.canonical_document_schema'
      : 'artifact.workbook_spec_schema';
  if (
    schemaRef.kind !== 'VERSIONED' ||
    schemaRef.objectType !== expectedObjectType ||
    typeof schemaRef.objectId !== 'string' ||
    !isUuidV7(schemaRef.objectId) ||
    typeof schemaRef.versionId !== 'string' ||
    !isUuidV7(schemaRef.versionId) ||
    enterpriseId !== context.enterpriseId ||
    (projectId !== undefined &&
      (typeof projectId !== 'string' ||
        !isUuidV7(projectId) ||
        !context.allowedProjectIds.includes(projectId))) ||
    (projectId === undefined && 'projectId' in scope) ||
    (envelope.projectId !== undefined && envelope.projectId !== projectId)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_SCHEMA_INVALID,
      'canonical schema reference is outside the trusted exact scope',
    );
  }
  return {
    schemaRef: schemaRef as unknown as Common.VersionedRef,
    projectId,
  };
}

function validateCanonicalContent(
  payload: unknown,
  context: ArtifactTransactionContext,
  envelope: CommandEnvelope,
  declaredContentHash: unknown,
): ValidatedCanonicalContent {
  const validation = registry.validateCanonicalContent(payload);
  if (!validation.valid) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_SCHEMA_INVALID,
      'canonical content failed the executable schema and invariant validation',
    );
  }
  const canonicalPayload = payload as Artifact.CanonicalContentPayload;
  const { schemaRef, projectId } = validatedSchemaRef(canonicalPayload, context, envelope);
  const hashablePayload = canonicalPayload as unknown as SharedCanonicalContentPayload;
  const canonicalJson = canonicalizeCanonicalContentPayload(hashablePayload);
  const canonicalBytes = Buffer.from(canonicalJson, 'utf8');
  const calculatedHash = hashCanonicalContentPayload(hashablePayload);
  const hashBytes = Buffer.from(calculatedHash.digest, 'hex');
  const declaredHash = record(declaredContentHash);
  if (
    declaredContentHash !== undefined &&
    (declaredHash.algorithm !== calculatedHash.algorithm ||
      declaredHash.canonicalizationVersion !== calculatedHash.canonicalizationVersion ||
      declaredHash.digest !== calculatedHash.digest)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_HASH_MISMATCH,
      'declared content hash does not match canonical content bytes',
    );
  }
  return {
    payload: canonicalPayload,
    schemaRef,
    projectId,
    canonicalBytes,
    contentHash: calculatedHash,
    hashBytes,
  };
}

function assertReadback(
  readback: ObjectStorageReadback,
  staged: ObjectStorageReference,
  validated: ValidatedCanonicalContent,
): void {
  if (
    readback.storageProvider !== staged.storageProvider ||
    readback.objectLocator !== staged.objectLocator ||
    readback.objectVersionId !== staged.objectVersionId ||
    readback.mediaType !== CANONICAL_MEDIA_TYPE ||
    !Number.isSafeInteger(readback.byteSize) ||
    readback.byteSize < 0 ||
    readback.byteSize !== readback.bytes.byteLength
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'authoritative object readback metadata is not acceptable',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readback.bytes.toString('utf8')) as unknown;
  } catch {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'authoritative object readback is not valid canonical JSON',
    );
  }
  const validation = registry.validateCanonicalContent(parsed);
  if (!validation.valid) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'authoritative object readback failed canonical schema validation',
    );
  }
  const readbackPayload = parsed as Artifact.CanonicalContentPayload;
  const hashableReadback = readbackPayload as unknown as SharedCanonicalContentPayload;
  const readbackBytes = Buffer.from(canonicalizeCanonicalContentPayload(hashableReadback), 'utf8');
  const readbackHash = hashCanonicalContentPayload(hashableReadback);
  if (
    !readback.bytes.equals(readbackBytes) ||
    readbackBytes.byteLength !== validated.canonicalBytes.byteLength ||
    !readbackBytes.equals(validated.canonicalBytes) ||
    readbackHash.digest !== validated.contentHash.digest
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_READBACK_MISMATCH,
      'authoritative object readback does not match the canonical payload digest',
    );
  }
}

function errorDetails(error: unknown): { code: string; safeSummary: string } {
  if (error instanceof ArtifactBusinessError) {
    return { code: error.code, safeSummary: error.message };
  }
  return { code: 'ARTIFACT_CONTENT_STAGE_FAILED', safeSummary: 'content object staging failed' };
}

function isValidationFailure(code: string): boolean {
  return (
    code === ARTIFACT_CONTENT_SCHEMA_INVALID ||
    code === ARTIFACT_CONTENT_HASH_MISMATCH ||
    code === ARTIFACT_CONTENT_READBACK_MISMATCH
  );
}

function manifestHash(value: unknown): Common.ContentHash {
  const bytes = Buffer.isBuffer(value)
    ? value
    : typeof value === 'string'
      ? Buffer.from(value, 'hex')
      : Buffer.alloc(0);
  return contentHash(bytes.toString('hex'));
}

function safeAggregateVersion(value: unknown): number {
  const text = typeof value === 'bigint' ? value.toString() : String(value);
  const parsed = BigInt(text);
  if (parsed < 1n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('content object aggregate version is outside the safe integer range');
  }
  return Number(parsed);
}

function safeNonnegativeInteger(value: unknown): number {
  const text = typeof value === 'bigint' ? value.toString() : String(value);
  const parsed = BigInt(text);
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('content object byte size is outside the safe integer range');
  }
  return Number(parsed);
}

function dbIntegerText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  throw new Error('database integer value is unavailable');
}

function manifestView(row: ArtifactContentObjectTable): ContentObjectView {
  const schemaRefValue =
    typeof row.payload_schema_ref === 'string'
      ? (JSON.parse(row.payload_schema_ref) as unknown)
      : row.payload_schema_ref;
  return {
    contentObjectId: row.content_object_id,
    payloadSchemaRef: schemaRefValue as Common.VersionedRef,
    contentType: row.content_type,
    canonicalizationVersion: '1',
    contentHash: manifestHash(row.content_hash),
    byteSize: safeNonnegativeInteger(row.byte_size),
    mediaType: row.media_type,
    objectRef: row.object_locator,
    storageState: row.storage_state,
    finalizationState: row.finalization_state,
    aggregateVersion: safeAggregateVersion(row.aggregate_version),
  };
}

function objectStorageReference(row: ArtifactContentObjectTable): ObjectStorageReference {
  return {
    storageProvider: row.storage_provider,
    objectLocator: row.object_locator,
    objectVersionId: row.object_version_id,
  };
}

function normalizeProjectEnvelope(
  envelope: CommandEnvelope,
  projectId: string | undefined,
  expectedVersion: string | undefined,
): CommandEnvelope {
  return {
    ...envelope,
    targetType: CANONICAL_OBJECT_TYPE,
    ...(projectId === undefined ? { projectId: undefined } : { projectId }),
    ...(expectedVersion === undefined ? {} : { expectedAggregateVersion: expectedVersion }),
  };
}

async function readContentObject(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  contentObjectId: string,
): Promise<ArtifactContentObjectTable> {
  const row = await withArtifactTransaction(db, context, (trx) =>
    repo.getContentObjectById(trx, contentObjectId),
  );
  if (row === undefined) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'content object is not visible');
  }
  return row;
}

async function recordOrphan(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: CommandEnvelope,
  validated: ValidatedCanonicalContent,
  staged: ObjectStorageReference,
  storageState: 'STAGING' | 'QUARANTINED',
  errorCode: string,
  retention: {
    readonly retentionClass: string;
    readonly retentionUntil?: Date;
    readonly legalHold: boolean;
  },
): Promise<void> {
  const sourceRequestHash = digestCanonicalPayload(envelope.requestPayload).hash;
  await withArtifactTransaction(db, context, async (trx) => {
    await repo.insertContentObjectOrphan(trx, {
      orphanId: newUuidV7(),
      contentObjectId: envelope.targetId,
      enterpriseId: envelope.enterpriseId,
      ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
      contentHash: validated.hashBytes,
      byteSize: validated.canonicalBytes.byteLength,
      mediaType: CANONICAL_MEDIA_TYPE,
      storageProvider: staged.storageProvider,
      objectLocator: staged.objectLocator,
      objectVersionId: staged.objectVersionId,
      storageState,
      retentionClass: retention.retentionClass,
      ...(retention.retentionUntil === undefined
        ? {}
        : { retentionUntil: retention.retentionUntil }),
      legalHold: retention.legalHold,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    await repo.insertContentAudit(trx, {
      auditId: newUuidV7(),
      enterpriseId: envelope.enterpriseId,
      ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
      principalId: envelope.principalId,
      actorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      commandId: envelope.commandId,
      commandType: envelope.commandType,
      outcome: 'INFO',
      errorCode,
      targetType: CANONICAL_OBJECT_TYPE,
      targetId: envelope.targetId,
      correlationId: envelope.correlationId,
      safeSummary: 'uploaded object was recorded for audited orphan handling',
      sourceRequestHash,
    });
  });
}

export async function stageCanonicalContent(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: CanonicalContentCommandEnvelope<StageCanonicalContentPayload>,
  storage: ObjectStoragePort,
): Promise<CommandResult> {
  let validated: ValidatedCanonicalContent;
  let retention: {
    readonly retentionClass: string;
    readonly retentionUntil?: Date;
    readonly legalHold: boolean;
  };
  try {
    assertContentTarget(envelope);
    validated = validateCanonicalContent(
      envelope.payload.content,
      context,
      envelope,
      envelope.payload.declaredContentHash,
    );
    const parsedRetentionUntil = parseRetentionUntil(envelope.payload.retentionUntil);
    retention = {
      retentionClass: retentionClass(envelope.payload.retentionClass),
      ...(parsedRetentionUntil === undefined ? {} : { retentionUntil: parsedRetentionUntil }),
      legalHold: envelope.payload.legalHold ?? false,
    };
  } catch (error) {
    if (!(error instanceof ArtifactBusinessError)) throw error;
    const details = errorDetails(error);
    const rejectionEnvelope = normalizeProjectEnvelope(envelope, envelope.projectId, undefined);
    return executeArtifactCommand(db, context, rejectionEnvelope, () =>
      Promise.resolve(commandRejected(details.code, details.safeSummary)),
    );
  }
  const normalizedEnvelope = normalizeProjectEnvelope(envelope, validated.projectId, undefined);
  let staged: ObjectStorageReference | undefined;
  let orphanState: 'STAGING' | 'QUARANTINED' = 'STAGING';
  let failureCode = 'ARTIFACT_CONTENT_STAGE_FAILED';
  let orphanAttempted = false;

  const recordUploadedOrphan = async (): Promise<void> => {
    if (staged === undefined || orphanAttempted) return;
    orphanAttempted = true;
    try {
      await recordOrphan(
        db,
        context,
        normalizedEnvelope,
        validated,
        staged,
        orphanState,
        failureCode,
        retention,
      );
    } catch {
      throw new ArtifactBusinessError(
        ARTIFACT_CONTENT_ORPHAN_RECORD_FAILED,
        'uploaded object could not be placed in the orphan audit boundary',
      );
    }
  };

  try {
    const result = await executeArtifactCommand(
      db,
      context,
      normalizedEnvelope,
      async (execution) => {
        try {
          staged = await storage.putStaging({
            objectLocator: `${STAGING_PREFIX}${envelope.targetId}`,
            bytes: validated.canonicalBytes,
            mediaType: CANONICAL_MEDIA_TYPE,
          });
          if (
            staged.objectLocator !== `${STAGING_PREFIX}${envelope.targetId}` ||
            staged.storageProvider.trim().length === 0 ||
            staged.objectVersionId.trim().length === 0
          ) {
            throw new ArtifactBusinessError(
              ARTIFACT_CONTENT_READBACK_MISMATCH,
              'storage returned a non-authoritative staging identity',
            );
          }
          const readback = await storage.read(staged);
          assertReadback(readback, staged, validated);
          const inserted = await repo.insertContentObject(execution.trx, {
            contentObjectId: envelope.targetId,
            enterpriseId: envelope.enterpriseId,
            ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
            payloadSchemaRef: validated.schemaRef,
            contentType: validated.payload.contentType,
            canonicalizationVersion: validated.payload.canonicalizationVersion,
            contentHash: validated.hashBytes,
            byteSize: validated.canonicalBytes.byteLength,
            mediaType: CANONICAL_MEDIA_TYPE,
            storageProvider: staged.storageProvider,
            objectLocator: staged.objectLocator,
            objectVersionId: staged.objectVersionId,
            verifiedAt: new Date(),
            retentionClass: retention.retentionClass,
            ...(retention.retentionUntil === undefined
              ? {}
              : { retentionUntil: retention.retentionUntil }),
            legalHold: retention.legalHold,
            createdByPrincipalId: envelope.principalId,
            createdByActorSnapshotId: envelope.actorSnapshotId,
            createdAuthorizationDecisionId: envelope.authorizationDecisionId,
            sourceCommandId: envelope.commandId,
          });
          if (!inserted) {
            failureCode = ARTIFACT_CONTENT_STATE_INVALID;
            return commandRejected(
              ARTIFACT_CONTENT_STATE_INVALID,
              'content object identity is already claimed',
            );
          }
          const row = await repo.getContentObjectById(execution.trx, envelope.targetId);
          if (row === undefined) throw new Error('content object disappeared after staging');
          const view = manifestView(row);
          await execution.appendOutbox({
            eventId: newUuidV7(),
            eventType: 'artifact.ContentObjectStaged',
            eventVersion: '1.0',
            aggregateType: CANONICAL_OBJECT_TYPE,
            aggregateId: envelope.targetId,
            aggregateVersion: '1',
            payload: {
              enterpriseId: envelope.enterpriseId,
              ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
              contentObjectId: envelope.targetId,
              contentType: validated.payload.contentType,
              contentHash: validated.contentHash,
              byteSize: validated.canonicalBytes.byteLength,
              mediaType: CANONICAL_MEDIA_TYPE,
              storageState: 'STAGING',
            } as unknown as CanonicalJsonObject,
            occurredAt: new Date(),
          });
          await execution.appendReferenceEdge({
            ownerObjectType: CANONICAL_OBJECT_TYPE,
            ownerObjectId: envelope.targetId,
            ownerPayloadHash: validated.hashBytes,
            referencePath: '/payloadSchemaRef',
            targetModule: 'artifact',
            targetObjectType: validated.schemaRef.objectType,
            targetObjectId: validated.schemaRef.objectId,
            targetVersionId: validated.schemaRef.versionId,
            referencePurpose: 'CANONICAL_CONTENT_SCHEMA',
          });
          return {
            kind: 'COMMITTED',
            resultPayload: view as unknown as CanonicalJsonObject,
          };
        } catch (error) {
          const details = errorDetails(error);
          failureCode = details.code;
          if (isValidationFailure(details.code)) orphanState = 'QUARANTINED';
          if (error instanceof ArtifactBusinessError) {
            return commandRejected(details.code, details.safeSummary);
          }
          throw error;
        }
      },
    );
    if (result.status === 'REJECTED') await recordUploadedOrphan();
    return result;
  } catch (error) {
    await recordUploadedOrphan();
    throw error;
  }
}

function ownerPayloadHashBytes(value: unknown): Buffer | undefined {
  if (value === undefined) return undefined;
  const hash = record(value);
  if (
    hash.algorithm !== 'SHA-256' ||
    hash.canonicalizationVersion !== '1' ||
    typeof hash.digest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(hash.digest)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_OWNER_INVALID,
      'owner payload hash must be a SHA-256 v1 digest',
    );
  }
  return Buffer.from(hash.digest, 'hex');
}

function quarantineReasonCode(value: unknown): string {
  if (typeof value !== 'string') return 'MANUAL_QUARANTINE';
  const selected = value.trim();
  return /^[A-Z][A-Z0-9_.-]{0,63}$/u.test(selected) ? selected : 'MANUAL_QUARANTINE';
}

function quarantineSafeSummary(value: unknown): string {
  if (typeof value !== 'string') return 'content object was quarantined by an owning command';
  const selected = value.trim();
  if (
    selected.length === 0 ||
    selected.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9 .,_:/-]*$/u.test(selected) ||
    /https?:\/\//iu.test(selected) ||
    /staging\/canonical\//iu.test(selected)
  ) {
    return 'content object was quarantined by an owning command';
  }
  return selected;
}

function validateLinkPayload(payload: LinkCanonicalContentPayload): Buffer | undefined {
  if (
    payload.ownerObjectType !== REVISION_OBJECT_TYPE ||
    !isUuidV7(payload.ownerObjectId) ||
    !isUuidV7(payload.ownerVersionId)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_OWNER_INVALID,
      'content object link must identify an exact ArtifactRevision version',
    );
  }
  return ownerPayloadHashBytes(payload.ownerPayloadHash);
}

function nextVersion(value: unknown): string {
  return (BigInt(String(value)) + 1n).toString();
}

function linkOutcomeResult(
  outcome: ContentObjectLinkOutcome,
  currentVersion: string,
): CommandBodyResult {
  switch (outcome) {
    case 'OK':
    case 'ALREADY_LINKED':
      return { kind: 'COMMITTED', resultPayload: {} };
    case 'CONFLICT':
      return {
        kind: 'REJECTED',
        errorCode: 'CONCURRENCY_CONFLICT',
        safeSummary: 'content object link lost an aggregate version race',
        currentAggregateVersion: currentVersion,
      };
    case 'OWNER_TYPE_INVALID':
      return commandRejected(
        ARTIFACT_CONTENT_OWNER_INVALID,
        'content object link owner type is not ArtifactRevision',
      );
    case 'INVALID_STATE':
      return commandRejected(
        ARTIFACT_CONTENT_STATE_INVALID,
        'content object is not in a linkable storage state',
      );
    case 'NOT_FOUND':
      return commandRejected(ARTIFACT_QUERY_NOT_FOUND, 'content object is not visible');
  }
}

export async function linkCanonicalContent(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: CanonicalContentCommandEnvelope<LinkCanonicalContentPayload>,
  storage: ObjectStoragePort,
): Promise<LinkCanonicalContentResult> {
  assertContentTarget(envelope);
  const ownerHash = validateLinkPayload(envelope.payload);
  const current = await readContentObject(db, context, envelope.targetId);
  if (
    envelope.projectId !== undefined &&
    envelope.projectId !== (current.project_id ?? undefined)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_SCHEMA_INVALID,
      'command Project scope does not match the Content Object',
    );
  }
  const normalizedEnvelope = normalizeProjectEnvelope(
    envelope,
    current.project_id ?? undefined,
    envelope.expectedAggregateVersion ?? safeAggregateVersion(current.aggregate_version).toString(),
  );
  const commandResult = await executeArtifactCommand(
    db,
    context,
    normalizedEnvelope,
    async (execution) => {
      const outcome = await repo.linkContentObject(execution.trx, {
        contentObjectId: envelope.targetId,
        expectedVersion:
          normalizedEnvelope.expectedAggregateVersion ?? dbIntegerText(current.aggregate_version),
        ownerObjectType: envelope.payload.ownerObjectType,
        ownerObjectId: envelope.payload.ownerObjectId,
        ownerVersionId: envelope.payload.ownerVersionId,
        ...(ownerHash === undefined ? {} : { ownerPayloadHash: ownerHash }),
        enterpriseId: current.enterprise_id,
        ...(current.project_id === null ? {} : { projectId: current.project_id }),
        updatedByPrincipalId: envelope.principalId,
        updatedByActorSnapshotId: envelope.actorSnapshotId,
        lastAuthorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      const conflictRow =
        outcome === 'CONFLICT'
          ? await repo.getContentObjectById(execution.trx, envelope.targetId)
          : undefined;
      const outcomeResult = linkOutcomeResult(
        outcome,
        conflictRow === undefined
          ? dbIntegerText(current.aggregate_version)
          : dbIntegerText(conflictRow.aggregate_version),
      );
      if (outcomeResult.kind !== 'COMMITTED') return outcomeResult;
      const row = await repo.getContentObjectById(execution.trx, envelope.targetId);
      if (row === undefined) throw new Error('content object disappeared after link');
      const view = manifestView(row);
      if (outcome === 'ALREADY_LINKED') {
        return { kind: 'COMMITTED', resultPayload: view as unknown as CanonicalJsonObject };
      }
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'artifact.ContentObjectLinked',
        eventVersion: '1.0',
        aggregateType: CANONICAL_OBJECT_TYPE,
        aggregateId: envelope.targetId,
        aggregateVersion: nextVersion(current.aggregate_version),
        payload: {
          enterpriseId: envelope.enterpriseId,
          ...(current.project_id === null ? {} : { projectId: current.project_id }),
          contentObjectId: envelope.targetId,
          ownerObjectType: REVISION_OBJECT_TYPE,
          ownerObjectId: envelope.payload.ownerObjectId,
          ownerVersionId: envelope.payload.ownerVersionId,
          contentHash: view.contentHash,
          storageState: 'LINKED',
        } as unknown as CanonicalJsonObject,
        occurredAt: new Date(),
      });
      await execution.appendReferenceEdge({
        ownerObjectType: CANONICAL_OBJECT_TYPE,
        ownerObjectId: envelope.targetId,
        targetModule: 'artifact',
        targetObjectType: REVISION_OBJECT_TYPE,
        targetObjectId: envelope.payload.ownerObjectId,
        targetVersionId: envelope.payload.ownerVersionId,
        ...(ownerHash === undefined ? {} : { targetPayloadHash: ownerHash }),
        referencePath: '/artifactRevisionRef',
        referencePurpose: 'CANONICAL_CONTENT_OWNER',
      });
      return { kind: 'COMMITTED', resultPayload: view as unknown as CanonicalJsonObject };
    },
  );
  if (commandResult.status !== 'COMMITTED' && commandResult.status !== 'DUPLICATE') {
    return { commandResult, finalizationState: 'SKIPPED' };
  }
  const afterLink = await readContentObject(db, context, envelope.targetId);
  if (afterLink.storage_state !== 'LINKED') {
    return { commandResult, finalizationState: 'SKIPPED' };
  }
  const finalization = await finalizeCanonicalContent(db, context, envelope, storage);
  return { commandResult, finalizationState: finalization };
}

async function persistFinalization(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  row: ArtifactContentObjectTable,
  envelope: CommandEnvelope,
  finalized: boolean,
  errorCode: string | undefined,
): Promise<ContentObjectFinalizationOutcome> {
  return withArtifactTransaction(db, context, async (trx) => {
    const outcome = await repo.markContentObjectFinalization(trx, {
      contentObjectId: row.content_object_id,
      finalized,
      ...(errorCode === undefined ? {} : { errorCode }),
      updatedByPrincipalId: envelope.principalId,
      updatedByActorSnapshotId: envelope.actorSnapshotId,
      lastAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    await repo.insertContentAudit(trx, {
      auditId: newUuidV7(),
      enterpriseId: row.enterprise_id,
      ...(row.project_id === null ? {} : { projectId: row.project_id }),
      principalId: envelope.principalId,
      actorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      commandId: envelope.commandId,
      commandType: 'artifact.content-object.finalize',
      outcome: 'INFO',
      ...(errorCode === undefined ? {} : { errorCode }),
      targetType: CANONICAL_OBJECT_TYPE,
      targetId: row.content_object_id,
      correlationId: envelope.correlationId,
      safeSummary: finalized
        ? 'object finalize was confirmed by the storage port'
        : 'object finalize outcome is unknown and remains retryable',
    });
    return outcome;
  });
}

export async function finalizeCanonicalContent(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: CommandEnvelope,
  storage: ObjectStoragePort,
): Promise<'FINALIZED' | 'UNKNOWN' | 'SKIPPED'> {
  assertContentTarget(envelope);
  const row = await readContentObject(db, context, envelope.targetId);
  if (row.storage_state === 'FROZEN' || row.storage_state === 'QUARANTINED') return 'SKIPPED';
  if (row.storage_state !== 'LINKED') return 'SKIPPED';
  try {
    await storage.finalize(objectStorageReference(row));
  } catch {
    const outcome = await persistFinalization(
      db,
      context,
      row,
      envelope,
      false,
      ARTIFACT_CONTENT_FINALIZATION_UNKNOWN,
    );
    return outcome === 'UNKNOWN' ? 'UNKNOWN' : 'SKIPPED';
  }
  const outcome = await persistFinalization(db, context, row, envelope, true, undefined);
  return outcome === 'FINALIZED' || outcome === 'ALREADY_FINALIZED' ? 'FINALIZED' : 'SKIPPED';
}

function stateOutcomeResult(
  outcome: ContentObjectStateOutcome,
  currentVersion: string,
  operation: 'freeze' | 'quarantine',
): CommandBodyResult {
  switch (outcome) {
    case 'OK':
      return { kind: 'COMMITTED', resultPayload: {} };
    case 'CONFLICT':
      return {
        kind: 'REJECTED',
        errorCode: 'CONCURRENCY_CONFLICT',
        safeSummary: `${operation} lost an aggregate version race`,
        currentAggregateVersion: currentVersion,
      };
    case 'NOT_FINALIZED':
      return commandRejected(
        ARTIFACT_CONTENT_NOT_FINALIZED,
        'content object cannot freeze before external finalize succeeds',
      );
    case 'ALREADY_FROZEN':
      return commandRejected(ARTIFACT_CONTENT_ALREADY_FROZEN, 'content object is already frozen');
    case 'QUARANTINED':
    case 'INVALID_STATE':
    case 'ALREADY_QUARANTINED':
      return commandRejected(
        ARTIFACT_CONTENT_STATE_INVALID,
        `${operation} is not valid for the current content object state`,
      );
    case 'NOT_FOUND':
      return commandRejected(ARTIFACT_QUERY_NOT_FOUND, 'content object is not visible');
  }
}

async function prepareStateEnvelope(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: CommandEnvelope,
): Promise<{ readonly row: ArtifactContentObjectTable; readonly envelope: CommandEnvelope }> {
  assertContentTarget(envelope);
  const row = await readContentObject(db, context, envelope.targetId);
  if (envelope.projectId !== undefined && envelope.projectId !== (row.project_id ?? undefined)) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_SCHEMA_INVALID,
      'command Project scope does not match the Content Object',
    );
  }
  return {
    row,
    envelope: normalizeProjectEnvelope(
      envelope,
      row.project_id ?? undefined,
      envelope.expectedAggregateVersion ?? safeAggregateVersion(row.aggregate_version).toString(),
    ),
  };
}

export async function freezeCanonicalContent(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: CommandEnvelope,
): Promise<CommandResult> {
  const prepared = await prepareStateEnvelope(db, context, envelope);
  const result = await executeArtifactCommand(db, context, prepared.envelope, async (execution) => {
    const outcome = await repo.freezeContentObject(execution.trx, {
      contentObjectId: prepared.row.content_object_id,
      expectedVersion:
        prepared.envelope.expectedAggregateVersion ?? dbIntegerText(prepared.row.aggregate_version),
      updatedByPrincipalId: envelope.principalId,
      updatedByActorSnapshotId: envelope.actorSnapshotId,
      lastAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    const outcomeResult = stateOutcomeResult(
      outcome,
      outcome === 'CONFLICT'
        ? dbIntegerText(
            (await repo.getContentObjectById(execution.trx, prepared.row.content_object_id))
              ?.aggregate_version ?? prepared.row.aggregate_version,
          )
        : dbIntegerText(prepared.row.aggregate_version),
      'freeze',
    );
    if (outcomeResult.kind !== 'COMMITTED') return outcomeResult;
    const row = await repo.getContentObjectById(execution.trx, prepared.row.content_object_id);
    if (row === undefined) throw new Error('content object disappeared after freeze');
    const view = manifestView(row);
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'artifact.ContentObjectFrozen',
      eventVersion: '1.0',
      aggregateType: CANONICAL_OBJECT_TYPE,
      aggregateId: row.content_object_id,
      aggregateVersion: nextVersion(prepared.row.aggregate_version),
      payload: {
        enterpriseId: row.enterprise_id,
        ...(row.project_id === null ? {} : { projectId: row.project_id }),
        contentObjectId: row.content_object_id,
        contentType: row.content_type,
        contentHash: view.contentHash,
        storageState: 'FROZEN',
      } as unknown as CanonicalJsonObject,
      occurredAt: new Date(),
    });
    return { kind: 'COMMITTED', resultPayload: view as unknown as CanonicalJsonObject };
  });
  return result;
}

export async function quarantineCanonicalContent(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: CommandEnvelope,
): Promise<CommandResult> {
  const payload = record(envelope.requestPayload);
  const reasonCode = quarantineReasonCode(payload.reasonCode);
  const safeSummary = quarantineSafeSummary(payload.safeSummary);
  const prepared = await prepareStateEnvelope(db, context, envelope);
  return executeArtifactCommand(db, context, prepared.envelope, async (execution) => {
    const outcome = await repo.quarantineContentObject(execution.trx, {
      contentObjectId: prepared.row.content_object_id,
      expectedVersion:
        prepared.envelope.expectedAggregateVersion ?? dbIntegerText(prepared.row.aggregate_version),
      reasonCode,
      safeSummary,
      updatedByPrincipalId: envelope.principalId,
      updatedByActorSnapshotId: envelope.actorSnapshotId,
      lastAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    const outcomeResult = stateOutcomeResult(
      outcome,
      outcome === 'CONFLICT'
        ? dbIntegerText(
            (await repo.getContentObjectById(execution.trx, prepared.row.content_object_id))
              ?.aggregate_version ?? prepared.row.aggregate_version,
          )
        : dbIntegerText(prepared.row.aggregate_version),
      'quarantine',
    );
    if (outcomeResult.kind !== 'COMMITTED') return outcomeResult;
    const row = await repo.getContentObjectById(execution.trx, prepared.row.content_object_id);
    if (row === undefined) throw new Error('content object disappeared after quarantine');
    const view = manifestView(row);
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'artifact.ContentObjectQuarantined',
      eventVersion: '1.0',
      aggregateType: CANONICAL_OBJECT_TYPE,
      aggregateId: row.content_object_id,
      aggregateVersion: nextVersion(prepared.row.aggregate_version),
      payload: {
        enterpriseId: row.enterprise_id,
        ...(row.project_id === null ? {} : { projectId: row.project_id }),
        contentObjectId: row.content_object_id,
        reasonCode,
        storageState: 'QUARANTINED',
      },
      occurredAt: new Date(),
    });
    return { kind: 'COMMITTED', resultPayload: view as unknown as CanonicalJsonObject };
  });
}

async function claimOrphan(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  worker: string,
  leaseToken: string,
): Promise<ContentObjectOrphanClaim | undefined> {
  return withArtifactTransaction(db, context, async (trx) => {
    const claim = await repo.claimContentObjectOrphan(trx, worker, leaseToken);
    if (claim === undefined) return undefined;
    await repo.insertContentAudit(trx, {
      auditId: newUuidV7(),
      enterpriseId: claim.enterprise_id,
      ...(claim.project_id === null ? {} : { projectId: claim.project_id }),
      principalId: context.principalId,
      actorSnapshotId: context.actorSnapshotId,
      authorizationDecisionId: context.authorizationDecisionId,
      commandId: claim.source_command_id ?? undefined,
      commandType: 'artifact.content-object.orphan-cleanup',
      outcome: 'INFO',
      targetType: 'CanonicalContentObjectOrphan',
      targetId: claim.orphan_id,
      correlationId: context.correlationId,
      safeSummary: 'orphan cleanup lease claimed',
    });
    return claim;
  });
}

async function completeOrphan(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  claim: ContentObjectOrphanClaim,
  worker: string,
  leaseToken: string,
  deleteOutcome: 'DELETED' | 'NOT_FOUND' | 'UNKNOWN',
  errorCode: string | undefined,
): Promise<ContentObjectOrphanCompletion> {
  return withArtifactTransaction(db, context, async (trx) => {
    const outcome = await repo.completeContentObjectOrphan(
      trx,
      claim.orphan_id,
      worker,
      leaseToken,
      deleteOutcome,
      errorCode,
    );
    await repo.insertContentAudit(trx, {
      auditId: newUuidV7(),
      enterpriseId: claim.enterprise_id,
      ...(claim.project_id === null ? {} : { projectId: claim.project_id }),
      principalId: context.principalId,
      actorSnapshotId: context.actorSnapshotId,
      authorizationDecisionId: context.authorizationDecisionId,
      commandId: claim.source_command_id ?? undefined,
      commandType: 'artifact.content-object.orphan-cleanup',
      outcome: 'INFO',
      errorCode,
      targetType: 'CanonicalContentObjectOrphan',
      targetId: claim.orphan_id,
      correlationId: context.correlationId,
      safeSummary: `orphan cleanup completed with ${outcome}`,
    });
    return outcome;
  });
}

export async function cleanupCanonicalContentOrphans(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  storage: ObjectStoragePort,
  worker: string,
  limit = 10,
): Promise<readonly OrphanCleanupReport[]> {
  if (worker.trim().length === 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ArtifactBusinessError(
      ARTIFACT_CONTENT_SCHEMA_INVALID,
      'orphan cleanup worker and limit are invalid',
    );
  }
  const reports: OrphanCleanupReport[] = [];
  for (let index = 0; index < limit; index += 1) {
    const leaseToken = newUuidV7();
    const claim = await claimOrphan(db, context, worker, leaseToken);
    if (claim === undefined) break;
    const retentionActive =
      claim.retention_until !== null && claim.retention_until.getTime() > Date.now();
    const protectedFromDelete =
      claim.legal_hold || claim.storage_state === 'QUARANTINED' || retentionActive;
    let deleteOutcome: 'DELETED' | 'NOT_FOUND' | 'UNKNOWN' = 'UNKNOWN';
    let errorCode: string | undefined;
    if (protectedFromDelete) {
      errorCode = claim.legal_hold
        ? 'LEGAL_HOLD'
        : claim.storage_state === 'QUARANTINED'
          ? 'QUARANTINED'
          : 'RETENTION_ACTIVE';
    } else {
      try {
        deleteOutcome = await storage.delete({
          storageProvider: claim.storage_provider,
          objectLocator: claim.object_locator,
          objectVersionId: claim.object_version_id,
        });
        errorCode = deleteOutcome === 'UNKNOWN' ? 'OBJECT_DELETE_UNKNOWN' : undefined;
      } catch {
        deleteOutcome = 'UNKNOWN';
        errorCode = 'OBJECT_DELETE_UNKNOWN';
      }
    }
    const outcome = await completeOrphan(
      db,
      context,
      claim,
      worker,
      leaseToken,
      deleteOutcome,
      errorCode,
    );
    reports.push({ orphanId: claim.orphan_id, attemptCount: claim.attempt_count, outcome });
  }
  return reports;
}
