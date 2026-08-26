// IM-03 WI-05 (issue #61): SourceMaterial registration and acceptance.
// The handler owns only the Project-scoped custody boundary. It does not
// download external bytes, scan files, or promote a source into a business
// material. Those capabilities remain outside this vertical slice.

import type { Kysely } from 'kysely';
import type { Common, EnterpriseProject } from '@zhiju/contracts';
import {
  isUuidV7,
  newUuidV7,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import {
  digestCanonicalPayload,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransactionContext,
} from '../persistence/enterprise-db.js';
import {
  CommandExecutionError,
  CONCURRENCY_CONFLICT,
  executeEnterpriseProjectCommand,
  type CommandEnvelope,
  type CommandExecution,
  type CommandResult,
} from '../persistence/command-runner.js';
import { EnterpriseBusinessRepository } from '../persistence/enterprise-business-repository.js';
import type {
  SourceMaterialTable,
  SourceMaterialValidationTable,
} from '../persistence/enterprise-business-types.js';
import {
  EnterpriseBusinessError,
  PROJECT_MATERIAL_SOURCE_INVALID,
  PROJECT_SOURCE_ALREADY_ACCEPTED,
  PROJECT_SOURCE_CONTENT_IMMUTABLE,
  PROJECT_SOURCE_NOT_TRUSTED,
} from './enterprise-business-errors.js';

const repo = new EnterpriseBusinessRepository();
const VALIDATION_OBJECT_TYPE = 'ValidationResult';

type RegisterSourceMaterialPayload = EnterpriseProject.ProjectRegisterSourceMaterialPayload;
type AcceptSourceMaterialPayload = EnterpriseProject.ProjectAcceptSourceMaterialPayload;

interface ReferenceLike {
  readonly kind?: unknown;
  readonly objectType?: unknown;
  readonly objectId?: unknown;
  readonly scope?: unknown;
  readonly contentHash?: unknown;
  readonly algorithm?: unknown;
  readonly digest?: unknown;
  readonly canonicalizationVersion?: unknown;
  readonly system?: unknown;
  readonly resourceType?: unknown;
  readonly externalId?: unknown;
  readonly observedAt?: unknown;
  readonly tenantOrAccountRef?: unknown;
  readonly payloadHash?: unknown;
  readonly adapterVersion?: unknown;
}

interface ScopeLike {
  readonly enterpriseId?: unknown;
  readonly projectId?: unknown;
}

interface ValidationRefFacts {
  readonly validationId: string;
  readonly payloadHash: Buffer;
}

function asReferenceLike(value: unknown): ReferenceLike {
  return value !== null && typeof value === 'object' ? value : {};
}

function asScopeLike(value: unknown): ScopeLike | undefined {
  return value !== null && typeof value === 'object' ? value : undefined;
}

function asCanonicalJson(value: unknown): CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value)) as CanonicalJsonValue;
}

function asCanonicalObject(value: unknown): CanonicalJsonObject {
  const candidate = asCanonicalJson(value);
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      'source material metadata must be a canonical object',
    );
  }
  return candidate as CanonicalJsonObject;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label} must be non-empty`,
    );
  }
  return value;
}

function parseInstant(value: unknown, label: string): Date {
  const parsed = typeof value === 'string' ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(parsed.getTime())) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label} must be a valid UTC instant`,
    );
  }
  return parsed;
}

function parseContentHash(value: unknown, label: string): Buffer {
  const hash = asReferenceLike(value);
  if (
    hash.algorithm !== 'SHA-256' ||
    hash.canonicalizationVersion !== '1' ||
    typeof hash.digest !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(hash.digest)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label} must be a SHA-256 content hash with canonicalization version 1`,
    );
  }
  return Buffer.from(hash.digest.toLowerCase(), 'hex');
}

function contentHashValue(digest: string): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: digest.toLowerCase(),
    canonicalizationVersion: '1',
  };
}

function sourceMaterialRef(
  sourceMaterialId: string,
  enterpriseId: string,
  projectId: string,
  contentHash: Buffer,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'SourceMaterial',
    objectId: sourceMaterialId,
    scope: { enterpriseId, projectId },
    contentHash: contentHashValue(contentHash.toString('hex')),
  };
}

function projectRef(enterpriseId: string, projectId: string): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'Project',
    objectId: projectId,
    scope: { enterpriseId, projectId },
  };
}

function assertProjectRef(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
  label: string,
): string {
  const reference = asReferenceLike(value);
  const scope = asScopeLike(reference.scope);
  const projectId = reference.objectId;
  if (
    reference.kind !== 'OBJECT' ||
    reference.objectType !== 'Project' ||
    typeof projectId !== 'string' ||
    !isUuidV7(projectId) ||
    scope?.enterpriseId !== context.enterpriseId ||
    scope.projectId !== projectId ||
    envelope.enterpriseId !== context.enterpriseId ||
    (envelope.projectId !== undefined && envelope.projectId !== projectId) ||
    !context.allowedProjectIds.includes(projectId)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_SOURCE_NOT_TRUSTED,
      `${label} must identify an allowed Project scope exactly`,
    );
  }
  return projectId;
}

function assertSubmittedBy(value: unknown, enterpriseId: string, principalId: string): string {
  const reference = asReferenceLike(value);
  const scope = asScopeLike(reference.scope);
  if (
    reference.kind !== 'OBJECT' ||
    (reference.objectType !== 'Principal' && reference.objectType !== 'identity.principal') ||
    reference.objectId !== principalId ||
    scope?.enterpriseId !== enterpriseId ||
    scope.projectId !== undefined
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_SOURCE_NOT_TRUSTED,
      'submittedBy must identify the trusted command principal',
    );
  }
  return principalId;
}

function assertExternalOrigin(value: unknown, enterpriseId: string): CanonicalJsonObject {
  const origin = asReferenceLike(value);
  nonEmptyString(origin.system, 'originRef.system');
  nonEmptyString(origin.resourceType, 'originRef.resourceType');
  nonEmptyString(origin.externalId, 'originRef.externalId');
  parseInstant(origin.observedAt, 'originRef.observedAt');
  if (origin.tenantOrAccountRef !== undefined) {
    const tenant = asReferenceLike(origin.tenantOrAccountRef);
    const scope = asScopeLike(tenant.scope);
    if (
      tenant.kind !== 'OBJECT' ||
      typeof tenant.objectId !== 'string' ||
      !isUuidV7(tenant.objectId) ||
      scope?.enterpriseId !== enterpriseId ||
      scope.projectId !== undefined
    ) {
      throw new EnterpriseBusinessError(
        PROJECT_SOURCE_NOT_TRUSTED,
        'originRef tenantOrAccountRef must stay in the trusted Enterprise scope',
      );
    }
  }
  if (origin.payloadHash !== undefined)
    parseContentHash(origin.payloadHash, 'originRef.payloadHash');
  if (origin.adapterVersion !== undefined)
    nonEmptyString(origin.adapterVersion, 'originRef.adapterVersion');
  return asCanonicalObject(value);
}

function validateDescriptor(
  descriptor: EnterpriseProject.SourceMaterialDescriptor,
  enterpriseId: string,
  principalId: string,
): {
  receivedAt: Date;
  contentHash: Buffer;
  submittedByPrincipalId: string;
  originRef: CanonicalJsonObject;
} {
  const originRef = assertExternalOrigin(descriptor.originRef, enterpriseId);
  const submittedByPrincipalId = assertSubmittedBy(
    descriptor.submittedBy,
    enterpriseId,
    principalId,
  );
  const receivedAt = parseInstant(descriptor.receivedAt, 'receivedAt');
  nonEmptyString(descriptor.originalName, 'originalName');
  if (
    typeof descriptor.mediaType !== 'string' ||
    !/^[^/\s]+\/[^/\s]+$/.test(descriptor.mediaType)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      'mediaType must be a non-empty type/subtype value',
    );
  }
  if (!Number.isSafeInteger(descriptor.byteLength) || descriptor.byteLength < 0) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      'byteLength must be a non-negative safe integer',
    );
  }
  const contentHash = parseContentHash(descriptor.checksum, 'checksum');
  nonEmptyString(descriptor.stagedObjectRef, 'stagedObjectRef');
  nonEmptyString(descriptor.retentionClass, 'retentionClass');
  return { receivedAt, contentHash, submittedByPrincipalId, originRef };
}

function descriptorDigest(
  descriptor: EnterpriseProject.SourceMaterialDescriptor,
  enterpriseId: string,
  projectId: string,
): Buffer {
  return digestCanonicalPayload({
    enterpriseId,
    projectId,
    originRef: asCanonicalJson(descriptor.originRef),
    submittedBy: asCanonicalJson(descriptor.submittedBy),
    receivedAt: descriptor.receivedAt,
    originalName: descriptor.originalName,
    mediaType: descriptor.mediaType,
    byteLength: descriptor.byteLength,
    checksum: asCanonicalJson(descriptor.checksum),
    stagedObjectRef: descriptor.stagedObjectRef,
    retentionClass: descriptor.retentionClass,
  }).hash;
}

function assertExpectedVersion(value: string | undefined): string {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'SourceMaterial acceptance requires a positive expected aggregate version',
    );
  }
  return value;
}

function assertValidationRef(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): ValidationRefFacts {
  const reference = asReferenceLike(value);
  const scope = asScopeLike(reference.scope);
  const validationId = reference.objectId;
  if (
    reference.kind !== 'CONTENT_ADDRESSED' ||
    reference.objectType !== VALIDATION_OBJECT_TYPE ||
    typeof validationId !== 'string' ||
    !isUuidV7(validationId) ||
    scope?.enterpriseId !== enterpriseId ||
    scope.projectId !== projectId
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      `${label} must identify a Project-scoped ValidationResult`,
    );
  }
  return {
    validationId,
    payloadHash: parseContentHash(reference.contentHash, `${label}.contentHash`),
  };
}

function rejectSummary(reason: string): string {
  return `SourceMaterial acceptance rejected: ${reason}`;
}

function sourceScopeMatches(
  row: SourceMaterialTable,
  enterpriseId: string,
  projectId: string,
): boolean {
  return row.enterprise_id === enterpriseId && row.project_id === projectId;
}

function int8AsString(value: unknown): string {
  // PostgreSQL bigint values are returned as strings by the pg driver.
  return value as string;
}

function validationMatches(
  row: SourceMaterialValidationTable | undefined,
  facts: ValidationRefFacts,
  source: SourceMaterialTable,
  enterpriseId: string,
  projectId: string,
  kind: 'SECURITY' | 'INTEGRITY',
  acceptedObjectRef: string,
): boolean {
  if (row === undefined) return false;
  return (
    row.validation_id === facts.validationId &&
    row.source_material_id === source.source_material_id &&
    sourceScopeMatches(source, enterpriseId, projectId) &&
    row.enterprise_id === enterpriseId &&
    row.project_id === projectId &&
    row.validation_kind === kind &&
    row.outcome === 'PASSED' &&
    row.validated_object_ref === acceptedObjectRef &&
    row.validated_content_hash.equals(source.content_hash) &&
    int8AsString(row.validated_byte_length) === int8AsString(source.byte_length) &&
    row.payload_hash.equals(facts.payloadHash)
  );
}

async function appendSourceMaterialValidationEdges(
  execution: Pick<CommandExecution, 'appendReferenceEdge'>,
  sourceMaterialId: string,
  sourceMaterialPayloadHash: Buffer,
  securityRefs: readonly { validationId: string; payloadHash: Buffer }[],
  integrityRef: { validationId: string; payloadHash: Buffer },
): Promise<void> {
  for (const [index, reference] of securityRefs.entries()) {
    await execution.appendReferenceEdge({
      ownerObjectType: 'SourceMaterial',
      ownerObjectId: sourceMaterialId,
      ownerPayloadHash: sourceMaterialPayloadHash,
      referencePath: `/securityValidationRefs/${index}`,
      targetModule: 'EnterpriseProject',
      targetObjectType: VALIDATION_OBJECT_TYPE,
      targetObjectId: reference.validationId,
      targetPayloadHash: reference.payloadHash,
      referencePurpose: 'SOURCE_MATERIAL_VALIDATION',
    });
  }
  await execution.appendReferenceEdge({
    ownerObjectType: 'SourceMaterial',
    ownerObjectId: sourceMaterialId,
    ownerPayloadHash: sourceMaterialPayloadHash,
    referencePath: '/integrityValidationRef',
    targetModule: 'EnterpriseProject',
    targetObjectType: VALIDATION_OBJECT_TYPE,
    targetObjectId: integrityRef.validationId,
    targetPayloadHash: integrityRef.payloadHash,
    referencePurpose: 'SOURCE_MATERIAL_VALIDATION',
  });
}

// =====================================================================
// Public Contract: project.register_source_material
// =====================================================================

export type RegisterSourceMaterialCommandPayload = RegisterSourceMaterialPayload;

export async function handleRegisterSourceMaterial(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: RegisterSourceMaterialPayload },
): Promise<CommandResult> {
  const projectId = assertProjectRef(envelope.payload.projectRef, context, envelope, 'projectRef');
  const descriptorFacts = validateDescriptor(
    envelope.payload.descriptor,
    context.enterpriseId,
    envelope.principalId,
  );
  const descriptorHash = descriptorDigest(
    envelope.payload.descriptor,
    context.enterpriseId,
    projectId,
  );
  const sourceMaterialId = newUuidV7();
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId,
    targetType: 'SourceMaterial',
    targetId: sourceMaterialId,
  };

  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const project = await repo.getProjectById(execution.trx, projectId);
    if (project === undefined) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_SOURCE_NOT_TRUSTED,
        safeSummary: rejectSummary('Project scope is not active'),
      };
    }
    if (project.enterprise_id !== context.enterpriseId || project.status !== 'ACTIVE') {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_SOURCE_NOT_TRUSTED,
        safeSummary: rejectSummary('Project scope is not active'),
      };
    }
    const existing = await repo.findSourceMaterialsByHash(
      execution.trx,
      context.enterpriseId,
      projectId,
      descriptorFacts.contentHash,
    );
    const duplicateOfSourceMaterialId = existing[0]?.source_material_id;
    await repo.insertSourceMaterial(execution.trx, {
      sourceMaterialId,
      enterpriseId: context.enterpriseId,
      projectId,
      submittedByPrincipalId: descriptorFacts.submittedByPrincipalId,
      submittedByRef: envelope.payload.descriptor.submittedBy,
      receivedAt: descriptorFacts.receivedAt,
      originalName: envelope.payload.descriptor.originalName,
      mediaType: envelope.payload.descriptor.mediaType,
      byteLength: envelope.payload.descriptor.byteLength,
      contentHash: descriptorFacts.contentHash,
      stagedObjectRef: envelope.payload.descriptor.stagedObjectRef,
      descriptorPayloadHash: descriptorHash,
      ...(duplicateOfSourceMaterialId === undefined ? {} : { duplicateOfSourceMaterialId }),
      retentionClass: envelope.payload.descriptor.retentionClass,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      sourceCommandId: envelope.commandId,
    });
    const originId = newUuidV7();
    const originHash = digestCanonicalPayload(descriptorFacts.originRef).hash;
    await repo.insertSourceMaterialOrigin(execution.trx, {
      sourceMaterialOriginId: originId,
      sourceMaterialId,
      enterpriseId: context.enterpriseId,
      projectId,
      originRef: descriptorFacts.originRef,
      originRefHash: originHash,
      receivedAt: descriptorFacts.receivedAt,
      recordedByPrincipalId: envelope.principalId,
      recordedByActorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    const materialRef = sourceMaterialRef(
      sourceMaterialId,
      context.enterpriseId,
      projectId,
      descriptorFacts.contentHash,
    );
    const resultPayload = {
      sourceMaterialRef: materialRef,
      projectRef: projectRef(context.enterpriseId, projectId),
      custodyStatus: 'RECEIVED',
      aggregateVersion: '1',
      ...(duplicateOfSourceMaterialId === undefined
        ? {}
        : {
            duplicateOfSourceMaterialRef: sourceMaterialRef(
              duplicateOfSourceMaterialId,
              context.enterpriseId,
              projectId,
              descriptorFacts.contentHash,
            ),
          }),
    } as unknown as CanonicalJsonObject;
    await execution.appendReferenceEdge({
      ownerObjectType: 'SourceMaterial',
      ownerObjectId: sourceMaterialId,
      ownerPayloadHash: descriptorHash,
      referencePath: '/projectRef',
      targetModule: 'EnterpriseProject',
      targetObjectType: 'Project',
      targetObjectId: projectId,
      referencePurpose: 'SOURCE_MATERIAL_PROJECT_SCOPE',
    });
    return { kind: 'COMMITTED', resultPayload };
  });
}

// =====================================================================
// Public Contract: project.accept_source_material
// =====================================================================

export type AcceptSourceMaterialCommandPayload = AcceptSourceMaterialPayload;

export async function handleAcceptSourceMaterial(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: AcceptSourceMaterialPayload },
): Promise<CommandResult> {
  if (envelope.projectId === undefined || !context.allowedProjectIds.includes(envelope.projectId)) {
    throw new EnterpriseBusinessError(
      PROJECT_SOURCE_NOT_TRUSTED,
      'SourceMaterial acceptance requires an allowed Project envelope scope',
    );
  }
  if (!isUuidV7(envelope.targetId)) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'SourceMaterial acceptance target id is invalid',
    );
  }
  const expectedVersion = assertExpectedVersion(envelope.expectedAggregateVersion);
  const acceptedAt = parseInstant(envelope.payload.acceptedAt, 'acceptedAt');
  const acceptedObjectRef = nonEmptyString(envelope.payload.acceptedObjectRef, 'acceptedObjectRef');
  if (
    !Array.isArray(envelope.payload.securityValidationRefs) ||
    envelope.payload.securityValidationRefs.length === 0
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      'securityValidationRefs must be non-empty',
    );
  }
  const projectId = envelope.projectId;
  const securityRefs = envelope.payload.securityValidationRefs.map((reference, index) =>
    assertValidationRef(
      reference,
      context.enterpriseId,
      projectId,
      `securityValidationRefs[${index}]`,
    ),
  );
  const integrityRef = assertValidationRef(
    envelope.payload.integrityValidationRef,
    context.enterpriseId,
    projectId,
    'integrityValidationRef',
  );
  const allValidationIds = [
    ...securityRefs.map((reference) => reference.validationId),
    integrityRef.validationId,
  ];
  if (new Set(allValidationIds).size !== allValidationIds.length) {
    throw new EnterpriseBusinessError(
      PROJECT_MATERIAL_SOURCE_INVALID,
      'security and integrity validation refs must be distinct',
    );
  }

  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId,
    targetType: 'SourceMaterial',
    targetId: envelope.targetId,
    expectedAggregateVersion: expectedVersion,
  };
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const source = await repo.getSourceMaterialById(execution.trx, envelope.targetId);
    if (source === undefined) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_SOURCE_NOT_TRUSTED,
        safeSummary: rejectSummary('SourceMaterial is outside the trusted Project scope'),
      };
    }
    if (!sourceScopeMatches(source, context.enterpriseId, projectId)) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_SOURCE_NOT_TRUSTED,
        safeSummary: rejectSummary('SourceMaterial is outside the trusted Project scope'),
      };
    }
    if (source.custody_status === 'ACCEPTED' || source.custody_status === 'ARCHIVED') {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_SOURCE_ALREADY_ACCEPTED,
        safeSummary: rejectSummary('SourceMaterial has already been accepted'),
        currentAggregateVersion: int8AsString(source.aggregate_version),
      };
    }
    if (
      source.custody_status !== 'RECEIVED' ||
      acceptedAt.getTime() < source.received_at.getTime()
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_SOURCE_NOT_TRUSTED,
        safeSummary: rejectSummary('SourceMaterial is not in an acceptable custody state'),
        currentAggregateVersion: int8AsString(source.aggregate_version),
      };
    }
    const origin = await repo.getSourceMaterialOriginBySourceMaterialId(
      execution.trx,
      envelope.targetId,
    );
    if (origin === undefined) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_SOURCE_NOT_TRUSTED,
        safeSummary: rejectSummary('SourceMaterial origin history is incomplete or out of scope'),
        currentAggregateVersion: int8AsString(source.aggregate_version),
      };
    }
    if (origin.enterprise_id !== context.enterpriseId || origin.project_id !== projectId) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_SOURCE_NOT_TRUSTED,
        safeSummary: rejectSummary('SourceMaterial origin history is incomplete or out of scope'),
        currentAggregateVersion: int8AsString(source.aggregate_version),
      };
    }
    for (const reference of securityRefs) {
      const validation = await repo.getSourceMaterialValidationById(
        execution.trx,
        reference.validationId,
      );
      if (
        !validationMatches(
          validation,
          reference,
          source,
          context.enterpriseId,
          projectId,
          'SECURITY',
          acceptedObjectRef,
        )
      ) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_SOURCE_NOT_TRUSTED,
          safeSummary: rejectSummary('Security validation is missing, failed or mismatched'),
          currentAggregateVersion: int8AsString(source.aggregate_version),
        };
      }
    }
    const integrityValidation = await repo.getSourceMaterialValidationById(
      execution.trx,
      integrityRef.validationId,
    );
    if (
      !validationMatches(
        integrityValidation,
        integrityRef,
        source,
        context.enterpriseId,
        projectId,
        'INTEGRITY',
        acceptedObjectRef,
      )
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_SOURCE_NOT_TRUSTED,
        safeSummary: rejectSummary('Integrity validation is missing, failed or mismatched'),
        currentAggregateVersion: int8AsString(source.aggregate_version),
      };
    }
    const accepted = await repo.casSourceMaterialAccepted(
      execution.trx,
      envelope.targetId,
      expectedVersion,
      acceptedObjectRef,
      acceptedAt,
    );
    if (!accepted.ok) {
      throw new CommandExecutionError(
        CONCURRENCY_CONFLICT,
        `SourceMaterial aggregate version changed from ${expectedVersion} to ${accepted.current}`,
      );
    }
    const materialRef = sourceMaterialRef(
      source.source_material_id,
      context.enterpriseId,
      projectId,
      source.content_hash,
    );
    const eventPayload = {
      enterpriseId: context.enterpriseId,
      projectId,
      sourceMaterialRef: materialRef,
      projectRef: projectRef(context.enterpriseId, projectId),
      originRef: asCanonicalJson(origin.origin_ref),
      acceptedAt: acceptedAt.toISOString(),
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'project.SourceMaterialAccepted',
      eventVersion: '1.0',
      aggregateType: 'SourceMaterial',
      aggregateId: envelope.targetId,
      aggregateVersion: accepted.nextVersion,
      payload: eventPayload,
      declaredHash: digestCanonicalPayload(eventPayload).hash,
      occurredAt: acceptedAt,
    });
    await appendSourceMaterialValidationEdges(
      execution,
      envelope.targetId,
      source.descriptor_payload_hash,
      securityRefs,
      integrityRef,
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        sourceMaterialRef: materialRef,
        projectRef: projectRef(context.enterpriseId, projectId),
        custodyStatus: 'ACCEPTED',
        aggregateVersion: accepted.nextVersion,
        acceptedAt: acceptedAt.toISOString(),
      } as unknown as CanonicalJsonObject,
    };
  });
}

// Keep the content-immutability error in the public WI-05 surface even
// though this first slice enforces it through SQL grants/triggers.
export { PROJECT_SOURCE_CONTENT_IMMUTABLE };
