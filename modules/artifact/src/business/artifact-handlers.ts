// IM-04 WI-03 (issue #92): Artifact Root, metadata and archive handlers.
// This slice owns long-lived Artifact identity and lifecycle only. Revision,
// Content Object, Representation and Binding behaviour remains out of scope.

import type { Kysely } from 'kysely';
import type { Artifact, Common } from '@zhiju/contracts';
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
  type ArtifactCasOutcome,
  type ArtifactInsert,
} from '../persistence/artifact-repository.js';
import {
  CommandExecutionError,
  CONCURRENCY_CONFLICT,
  executeArtifactCommand,
  type CommandEnvelope,
  type CommandResult,
} from '../persistence/command-runner.js';
import {
  ArtifactBusinessError,
  ARTIFACT_EXPECTED_VERSION_REQUIRED,
  ARTIFACT_HUMAN_ONLY_DENIED,
  ARTIFACT_IDENTITY_CONFLICT,
  ARTIFACT_METADATA_FIELD_FORBIDDEN,
  ARTIFACT_NOT_ACTIVE,
  ARTIFACT_QUERY_NOT_FOUND,
  ARTIFACT_SCOPE_INVALID,
} from './artifact-business-errors.js';

const repo = new ArtifactRepository();
const ARTIFACT_OBJECT_TYPE = 'Artifact';
const DELIVERY_ITEM_OBJECT_TYPE = 'DeliveryItem';
const POLICY_OBJECT_TYPE = 'Policy';

export type CreateArtifactPayload = Artifact.ArtifactCreateArtifactPayload;
export type UpdateArtifactMetadataPayload = Artifact.ArtifactUpdateArtifactMetadataPayload;
export type ArchiveArtifactPayload = Artifact.ArtifactArchiveArtifactPayload;
export type GetArtifactPayload = Artifact.ArtifactGetArtifactPayload;

export type ArtifactCommandEnvelope<TPayload> = CommandEnvelope & { payload: TPayload };

type RecordLike = Readonly<Record<string, unknown>>;

interface ScopeLike {
  readonly enterpriseId?: string;
  readonly projectId?: string;
}

interface ValidatedDefinition {
  readonly businessScope: Artifact.ArtifactScope;
  readonly projectId: string | undefined;
  readonly originProjectRef: Common.ObjectRef | undefined;
  readonly artifactType: string;
  readonly title: string;
  readonly classification: string;
  readonly deliveryItemRefs: readonly Common.VersionedRef[];
  readonly metadata: CanonicalJsonValue;
  readonly definition: CanonicalJsonObject;
  readonly identityHash: Buffer;
}

interface ArtifactScopeFacts {
  readonly artifactId: string;
  readonly projectId: string | undefined;
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
  const candidate = canonicalValue(value);
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label} must be a JSON object`);
  }
  return candidate as CanonicalJsonObject;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label} must be non-empty`);
  }
  return value;
}

function scopeRecord(value: unknown, label: string): ScopeLike {
  const scope = record(value);
  const enterpriseId = scope.enterpriseId;
  const projectId = scope.projectId;
  if (enterpriseId !== undefined && typeof enterpriseId !== 'string') {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label}.enterpriseId is invalid`);
  }
  if (projectId !== undefined && typeof projectId !== 'string') {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, `${label}.projectId is invalid`);
  }
  return {
    ...(enterpriseId === undefined ? {} : { enterpriseId }),
    ...(projectId === undefined ? {} : { projectId }),
  };
}

function assertEnterpriseRef(value: unknown, context: ArtifactTransactionContext): void {
  const ref = record(value);
  const scope = scopeRecord(ref.scope, 'enterpriseRef.scope');
  if (
    ref.kind !== 'OBJECT' ||
    ref.objectType !== 'Enterprise' ||
    ref.objectId !== context.enterpriseId ||
    !isUuidV7(context.enterpriseId) ||
    scope.enterpriseId !== context.enterpriseId ||
    scope.projectId !== undefined
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'enterpriseRef must identify the trusted Enterprise exactly',
    );
  }
}

function assertProjectRef(
  value: unknown,
  context: ArtifactTransactionContext,
  label: string,
): string {
  const ref = record(value);
  const scope = scopeRecord(ref.scope, `${label}.scope`);
  const projectId = ref.objectId;
  if (
    ref.kind !== 'OBJECT' ||
    ref.objectType !== 'Project' ||
    typeof projectId !== 'string' ||
    !isUuidV7(projectId) ||
    scope.enterpriseId !== context.enterpriseId ||
    scope.projectId !== projectId ||
    !context.allowedProjectIds.includes(projectId)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      `${label} must identify an allowed Project scope exactly`,
    );
  }
  return projectId;
}

function assertDeliveryItemRef(
  value: unknown,
  context: ArtifactTransactionContext,
  artifactProjectId: string | undefined,
  label: string,
): Common.VersionedRef {
  const ref = canonicalObject(value, label);
  const scope = scopeRecord(ref.scope, `${label}.scope`);
  const objectId = ref.objectId;
  const versionId = ref.versionId;
  const refProjectId = scope.projectId;
  if (
    ref.kind !== 'VERSIONED' ||
    ref.objectType !== DELIVERY_ITEM_OBJECT_TYPE ||
    typeof objectId !== 'string' ||
    !isUuidV7(objectId) ||
    typeof versionId !== 'string' ||
    !isUuidV7(versionId) ||
    scope.enterpriseId !== context.enterpriseId ||
    (refProjectId !== undefined &&
      (!isUuidV7(refProjectId) || !context.allowedProjectIds.includes(refProjectId))) ||
    (artifactProjectId !== undefined && refProjectId !== artifactProjectId)
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      `${label} must be an exact DeliveryItem version in the trusted scope`,
    );
  }
  return ref as unknown as Common.VersionedRef;
}

function validateDefinition(
  payload: CreateArtifactPayload,
  context: ArtifactTransactionContext,
): ValidatedDefinition {
  assertEnterpriseRef(payload.enterpriseRef, context);
  const definition = record(payload.definition);
  const businessScope = definition.businessScope;
  if (businessScope !== 'PROJECT_DELIVERABLE' && businessScope !== 'ENTERPRISE_CONTROLLED') {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, 'businessScope is not supported');
  }
  const artifactType = nonEmptyString(definition.artifactType, 'definition.artifactType');
  const title = nonEmptyString(definition.title, 'definition.title');
  const classification = nonEmptyString(definition.classification, 'definition.classification');
  const deliveryRefsValue = definition.deliveryItemRefs;
  if (!Array.isArray(deliveryRefsValue)) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'definition.deliveryItemRefs must be an array',
    );
  }

  let projectId: string | undefined;
  let originProjectRef: Common.ObjectRef | undefined;
  if (businessScope === 'PROJECT_DELIVERABLE') {
    if (definition.originProjectRef === undefined) {
      throw new ArtifactBusinessError(
        ARTIFACT_SCOPE_INVALID,
        'PROJECT_DELIVERABLE requires originProjectRef',
      );
    }
    originProjectRef = canonicalObject(
      definition.originProjectRef,
      'originProjectRef',
    ) as unknown as Common.ObjectRef;
    projectId = assertProjectRef(originProjectRef, context, 'originProjectRef');
  } else if (definition.originProjectRef !== undefined) {
    originProjectRef = canonicalObject(
      definition.originProjectRef,
      'originProjectRef',
    ) as unknown as Common.ObjectRef;
    assertProjectRef(originProjectRef, context, 'originProjectRef');
  }

  const deliveryItemRefs = deliveryRefsValue.map((value, index) =>
    assertDeliveryItemRef(value, context, projectId, `deliveryItemRefs[${index}]`),
  );
  const identities = new Set<string>();
  for (const ref of deliveryItemRefs) {
    const identity = canonicalize(ref as unknown as CanonicalJsonValue);
    if (identities.has(identity)) {
      throw new ArtifactBusinessError(
        ARTIFACT_SCOPE_INVALID,
        'deliveryItemRefs must contain unique exact references',
      );
    }
    identities.add(identity);
  }
  if (definition.metadata === undefined) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, 'definition.metadata is required');
  }
  const metadata = canonicalValue(definition.metadata);
  const canonicalDefinition: CanonicalJsonObject = {
    businessScope,
    ...(originProjectRef === undefined
      ? {}
      : { originProjectRef: originProjectRef as unknown as CanonicalJsonObject }),
    artifactType,
    title,
    classification,
    deliveryItemRefs: deliveryItemRefs as unknown as CanonicalJsonValue,
    metadata,
  };
  const identityDigest = digestCanonicalPayload({
    businessScope,
    enterpriseId: context.enterpriseId,
    projectId: projectId ?? null,
    artifactType,
    title,
  });
  return {
    businessScope,
    projectId,
    originProjectRef,
    artifactType,
    title,
    classification,
    deliveryItemRefs,
    metadata,
    definition: canonicalDefinition,
    identityHash: identityDigest.hash,
  };
}

export function validateArtifactCreatePayload(
  payload: CreateArtifactPayload,
  context: ArtifactTransactionContext,
): ValidatedDefinition {
  return validateDefinition(payload, context);
}

const FORBIDDEN_METADATA_KEYS = new Set([
  'artifactId',
  'enterpriseId',
  'projectId',
  'businessScope',
  'originProjectRef',
  'artifactType',
  'deliveryItemRefs',
  'approvedRevisionRefs',
  'effectiveBindingRefs',
  'lifecycleStatus',
  'aggregateVersion',
  'metadataVersion',
  'defaultBranchId',
  'createdAt',
  'createdBy',
]);

function validateMetadataPatch(value: unknown): CanonicalJsonValue | undefined {
  if (value === undefined) return undefined;
  const patch = canonicalValue(value, ARTIFACT_METADATA_FIELD_FORBIDDEN);
  if (patch !== null && typeof patch === 'object' && !Array.isArray(patch)) {
    for (const key of Object.keys(patch)) {
      if (FORBIDDEN_METADATA_KEYS.has(key)) {
        throw new ArtifactBusinessError(
          ARTIFACT_METADATA_FIELD_FORBIDDEN,
          'metadataPatch contains a protected Artifact field',
        );
      }
    }
  }
  return patch;
}

function mergeMetadataValues(
  current: CanonicalJsonValue,
  patch: CanonicalJsonValue,
): CanonicalJsonValue {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  let base: Record<string, CanonicalJsonValue> =
    current !== null && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, CanonicalJsonValue>) }
      : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      base = Object.fromEntries(
        Object.entries(base).filter(([existingKey]) => existingKey !== key),
      );
    } else {
      base[key] =
        typeof value === 'object' && !Array.isArray(value)
          ? mergeMetadataValues(base[key] ?? {}, value)
          : value;
    }
  }
  return base;
}

/** Applies the WI-03 JSON Merge Patch semantics used by metadata updates. */
export function applyArtifactMetadataPatch(
  current: CanonicalJsonValue,
  patch: CanonicalJsonValue,
): CanonicalJsonValue {
  return mergeMetadataValues(current, patch);
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

function validateMetadataPayload(value: UpdateArtifactMetadataPayload): {
  readonly title: string | undefined;
  readonly classification: string | undefined;
  readonly metadataPatch: CanonicalJsonValue | undefined;
  readonly changeReason: CanonicalJsonObject;
} {
  const title = value.title === undefined ? undefined : nonEmptyString(value.title, 'title');
  const classification =
    value.classification === undefined
      ? undefined
      : nonEmptyString(value.classification, 'classification');
  const metadataPatch = validateMetadataPatch(value.metadataPatch);
  const changeReason = validateJustification(value.changeReason, 'changeReason');
  if (title === undefined && classification === undefined && metadataPatch === undefined) {
    throw new ArtifactBusinessError(
      ARTIFACT_METADATA_FIELD_FORBIDDEN,
      'metadata update must change at least one mutable field',
    );
  }
  return { title, classification, metadataPatch, changeReason };
}

export function validateArtifactMetadataUpdatePayload(value: UpdateArtifactMetadataPayload) {
  return validateMetadataPayload(value);
}

function validateArchivePayload(
  value: ArchiveArtifactPayload,
  context: ArtifactTransactionContext,
): {
  readonly archivedAt: Date;
  readonly archivedAtValue: string;
  readonly archiveReason: CanonicalJsonObject;
  readonly retentionPolicyRef: Common.VersionedRef;
} {
  const archivedAtValue = nonEmptyString(value.archivedAt, 'archivedAt');
  const archivedAt = new Date(archivedAtValue);
  if (Number.isNaN(archivedAt.getTime())) {
    throw new ArtifactBusinessError(ARTIFACT_SCOPE_INVALID, 'archivedAt must be a valid instant');
  }
  const archiveReason = validateJustification(value.archiveReason, 'archiveReason');
  const retentionPolicyRef = canonicalObject(value.retentionPolicyRef, 'retentionPolicyRef');
  const scope = scopeRecord(retentionPolicyRef.scope, 'retentionPolicyRef.scope');
  if (
    retentionPolicyRef.kind !== 'VERSIONED' ||
    retentionPolicyRef.objectType !== POLICY_OBJECT_TYPE ||
    typeof retentionPolicyRef.objectId !== 'string' ||
    !isUuidV7(retentionPolicyRef.objectId) ||
    typeof retentionPolicyRef.versionId !== 'string' ||
    !isUuidV7(retentionPolicyRef.versionId) ||
    scope.enterpriseId !== context.enterpriseId ||
    (scope.projectId !== undefined &&
      (!isUuidV7(scope.projectId) || !context.allowedProjectIds.includes(scope.projectId)))
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'retentionPolicyRef must be an exact Policy version reference',
    );
  }
  return {
    archivedAt,
    archivedAtValue,
    archiveReason,
    retentionPolicyRef: retentionPolicyRef as unknown as Common.VersionedRef,
  };
}

function validateContext(context: ArtifactTransactionContext): void {
  if (context.authorizationDecisionExpiresAt.getTime() <= Date.now()) {
    throw new CommandExecutionError('COMMAND_CONTEXT_EXPIRED', 'authorization decision is expired');
  }
}

function requireExpectedVersion(envelope: CommandEnvelope): string {
  if (
    envelope.expectedAggregateVersion === undefined ||
    !/^[1-9][0-9]*$/.test(envelope.expectedAggregateVersion)
  ) {
    throw new CommandExecutionError(
      ARTIFACT_EXPECTED_VERSION_REQUIRED,
      'Artifact mutation requires a positive expected aggregate version',
    );
  }
  return envelope.expectedAggregateVersion;
}

function assertArtifactCommandTarget(envelope: CommandEnvelope): void {
  if (envelope.targetType !== ARTIFACT_OBJECT_TYPE || !isUuidV7(envelope.targetId)) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'Artifact command target must be an exact Artifact UUIDv7',
    );
  }
}

function exactArtifactRef(value: unknown, context: ArtifactTransactionContext): ArtifactScopeFacts {
  const ref = record(value);
  const scope = scopeRecord(ref.scope, 'artifactRef.scope');
  const artifactId = ref.objectId;
  if (
    ref.kind !== 'OBJECT' ||
    ref.objectType !== ARTIFACT_OBJECT_TYPE ||
    typeof artifactId !== 'string' ||
    !isUuidV7(artifactId) ||
    scope.enterpriseId !== context.enterpriseId
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'artifactRef must be an exact Artifact ObjectRef',
    );
  }
  const projectId = scope.projectId;
  if (
    projectId !== undefined &&
    (!isUuidV7(projectId) || !context.allowedProjectIds.includes(projectId))
  ) {
    throw new ArtifactBusinessError(
      ARTIFACT_QUERY_NOT_FOUND,
      'artifactRef is not visible in the trusted scope',
    );
  }
  return { artifactId, projectId };
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
    objectType: ARTIFACT_OBJECT_TYPE,
    objectId: root.artifact_id,
    scope: rootScope(root),
  };
}

function jsonColumn(value: unknown, label: string): CanonicalJsonValue {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as CanonicalJsonValue;
    } catch {
      throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, `${label} is invalid stored JSON`);
    }
  }
  return canonicalValue(value, ARTIFACT_QUERY_NOT_FOUND);
}

function safeInteger(value: unknown, label: string): number {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(String(value));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, `${label} is outside the read model`);
  }
  return parsed;
}

function artifactView(
  root: {
    artifact_id: string;
    enterprise_id: string;
    project_id: string | null;
    business_scope: Artifact.ArtifactScope;
    origin_project_ref: unknown;
    artifact_type: string;
    title: string;
    classification: string;
    delivery_item_refs: unknown;
    metadata: unknown;
    lifecycle_status: Artifact.ArtifactLifecycle;
    aggregate_version: unknown;
    approved_revision_refs: unknown;
    effective_binding_refs: unknown;
  },
  branches: readonly {
    branch_id: string;
    branch_name: string;
    working_head_ref: unknown;
    head_version: unknown;
    lifecycle_status: string;
  }[],
): Artifact.ArtifactView {
  const originProjectRef =
    root.origin_project_ref === null
      ? undefined
      : (jsonColumn(root.origin_project_ref, 'originProjectRef') as unknown as Common.ObjectRef);
  const deliveryItemRefs = jsonColumn(
    root.delivery_item_refs,
    'deliveryItemRefs',
  ) as unknown as readonly Common.VersionedRef[];
  const metadata = jsonColumn(root.metadata, 'metadata');
  const approvedRevisionRefs = jsonColumn(
    root.approved_revision_refs,
    'approvedRevisionRefs',
  ) as unknown as readonly Common.ContentAddressedRef[];
  const effectiveBindingRefs = jsonColumn(
    root.effective_binding_refs,
    'effectiveBindingRefs',
  ) as unknown as readonly Common.ObjectRef[];
  const workingHeads = branches.map((branch) => ({
    branchId: branch.branch_id,
    branchName: branch.branch_name,
    workingHeadRef:
      branch.working_head_ref === null
        ? null
        : jsonColumn(branch.working_head_ref, 'workingHeadRef'),
    headVersion: safeInteger(branch.head_version, 'headVersion'),
    lifecycleStatus: branch.lifecycle_status,
  })) as readonly CanonicalJsonValue[];
  const definition = {
    businessScope: root.business_scope,
    ...(originProjectRef === undefined ? {} : { originProjectRef }),
    artifactType: root.artifact_type,
    title: root.title,
    classification: root.classification,
    deliveryItemRefs,
    metadata,
  } as unknown as Artifact.ArtifactDefinition;
  return {
    artifactRef: artifactRefForRoot(root),
    aggregateVersion: safeInteger(root.aggregate_version, 'aggregateVersion'),
    definition,
    lifecycleStatus: root.lifecycle_status,
    workingHeads,
    approvedRevisionRefs,
    effectiveBindingRefs,
  };
}

async function readVisibleRoot(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  artifactId: string,
): Promise<{
  readonly root: Awaited<ReturnType<ArtifactRepository['getArtifactById']>>;
  readonly branches: Awaited<ReturnType<ArtifactRepository['getArtifactBranches']>>;
}> {
  validateContext(context);
  return withArtifactTransaction(db, context, async (trx) => {
    const root = await repo.getArtifactById(trx, artifactId);
    if (root === undefined) return { root, branches: [] };
    const branches = await repo.getArtifactBranches(trx, artifactId);
    return { root, branches };
  });
}

function assertEnvelopeProjectMatches(
  envelope: CommandEnvelope,
  projectId: string | undefined,
): void {
  if (envelope.projectId !== undefined && envelope.projectId !== projectId) {
    throw new ArtifactBusinessError(
      ARTIFACT_SCOPE_INVALID,
      'command Project scope does not match the Artifact Root',
    );
  }
}

function rejected(
  errorCode: string,
  safeSummary: string,
  currentAggregateVersion?: string,
): {
  readonly kind: 'REJECTED';
  readonly errorCode: string;
  readonly safeSummary: string;
  readonly currentAggregateVersion?: string;
} {
  return {
    kind: 'REJECTED',
    errorCode,
    safeSummary,
    ...(currentAggregateVersion === undefined ? {} : { currentAggregateVersion }),
  };
}

function aggregateVersion(value: unknown): string {
  return String(value);
}

function eventScopePayload(
  enterpriseId: string,
  projectId: string | undefined,
): CanonicalJsonObject {
  return projectId === undefined ? { enterpriseId } : { enterpriseId, projectId };
}

async function appendCreateReferenceEdges(
  execution: Parameters<Parameters<typeof executeArtifactCommand>[3]>[0],
  envelope: CommandEnvelope,
  validated: ValidatedDefinition,
  ownerPayloadHash: Buffer,
): Promise<void> {
  const owner = {
    ownerObjectType: ARTIFACT_OBJECT_TYPE,
    ownerObjectId: envelope.targetId,
    ownerPayloadHash,
  };
  await execution.appendReferenceEdge({
    ...owner,
    referencePath: '/definition/enterpriseRef',
    targetModule: 'enterprise_project',
    targetObjectType: 'Enterprise',
    targetObjectId: envelope.enterpriseId,
    referencePurpose: 'ARTIFACT_SCOPE',
  });
  if (validated.originProjectRef !== undefined) {
    await execution.appendReferenceEdge({
      ...owner,
      referencePath: '/definition/originProjectRef',
      targetModule: 'enterprise_project',
      targetObjectType: 'Project',
      targetObjectId: validated.originProjectRef.objectId,
      referencePurpose: 'ARTIFACT_ORIGIN_PROJECT',
    });
  }
  for (const [index, ref] of validated.deliveryItemRefs.entries()) {
    await execution.appendReferenceEdge({
      ...owner,
      referencePath: `/definition/deliveryItemRefs/${index}`,
      targetModule: 'enterprise_project',
      targetObjectType: DELIVERY_ITEM_OBJECT_TYPE,
      targetObjectId: ref.objectId,
      targetVersionId: ref.versionId,
      referencePurpose: 'ARTIFACT_DELIVERY_ITEM',
    });
  }
}

async function appendArchiveReferenceEdge(
  execution: Parameters<Parameters<typeof executeArtifactCommand>[3]>[0],
  envelope: CommandEnvelope,
  retentionPolicyRef: Common.VersionedRef,
  ownerPayloadHash: Buffer,
): Promise<void> {
  await execution.appendReferenceEdge({
    ownerObjectType: ARTIFACT_OBJECT_TYPE,
    ownerObjectId: envelope.targetId,
    ownerPayloadHash,
    referencePath: '/retentionPolicyRef',
    targetModule: 'identity_policy',
    targetObjectType: POLICY_OBJECT_TYPE,
    targetObjectId: retentionPolicyRef.objectId,
    targetVersionId: retentionPolicyRef.versionId,
    referencePurpose: 'ARTIFACT_RETENTION_POLICY',
  });
}

function defaultBranchRef(root: {
  artifact_id: string;
  enterprise_id: string;
  project_id: string | null;
  default_branch_id: string;
}): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'ArtifactBranch',
    objectId: root.default_branch_id,
    scope: rootScope(root),
  };
}

export async function handleCreateArtifact(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: ArtifactCommandEnvelope<CreateArtifactPayload>,
): Promise<CommandResult> {
  const validated = validateDefinition(envelope.payload, context);
  assertEnvelopeProjectMatches(envelope, validated.projectId);
  const artifactId = newUuidV7();
  const branchId = newUuidV7();
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId: validated.projectId,
    targetType: ARTIFACT_OBJECT_TYPE,
    targetId: artifactId,
  };
  return executeArtifactCommand(db, context, normalizedEnvelope, async (execution) => {
    const inserted = await repo.insertArtifact(execution.trx, {
      artifactId,
      defaultBranchId: branchId,
      enterpriseId: envelope.enterpriseId,
      projectId: validated.projectId,
      businessScope: validated.businessScope,
      originProjectRef: validated.originProjectRef,
      artifactType: validated.artifactType,
      title: validated.title,
      classification: validated.classification,
      identityHash: validated.identityHash,
      deliveryItemRefs: validated.deliveryItemRefs,
      metadata: validated.metadata,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    } satisfies ArtifactInsert);
    if (!inserted) {
      return rejected(
        ARTIFACT_IDENTITY_CONFLICT,
        'another Artifact in the trusted scope already uses this creation identity',
      );
    }
    const root = await repo.getArtifactById(execution.trx, artifactId);
    if (root === undefined) {
      throw new Error('Artifact Root disappeared after create');
    }
    const branches = await repo.getArtifactBranches(execution.trx, artifactId);
    const view = artifactView(root, branches);
    const rootPayload: CanonicalJsonObject = {
      artifactRef: view.artifactRef as unknown as CanonicalJsonObject,
      definition: validated.definition,
      lifecycleStatus: 'ACTIVE',
      aggregateVersion: 1,
      metadataVersion: 1,
      defaultBranchRef: defaultBranchRef(root) as unknown as CanonicalJsonObject,
    };
    const rootDigest = digestCanonicalPayload(rootPayload);
    const createdEventPayload = {
      ...eventScopePayload(envelope.enterpriseId, validated.projectId),
      artifactRef: view.artifactRef,
      businessScope: validated.businessScope,
      artifactType: validated.artifactType,
      ...(validated.originProjectRef === undefined
        ? {}
        : { originProjectRef: validated.originProjectRef }),
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'artifact.ArtifactCreated',
      eventVersion: '1.0',
      aggregateType: ARTIFACT_OBJECT_TYPE,
      aggregateId: artifactId,
      aggregateVersion: '1',
      payload: createdEventPayload,
      occurredAt: new Date(),
    });
    await appendCreateReferenceEdges(execution, normalizedEnvelope, validated, rootDigest.hash);
    return {
      kind: 'COMMITTED',
      resultPayload: {
        ...(view as unknown as CanonicalJsonObject),
        defaultBranchRef: defaultBranchRef(root) as unknown as CanonicalJsonObject,
        metadataVersion: 1,
      },
    };
  });
}

export async function handleUpdateArtifactMetadata(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: ArtifactCommandEnvelope<UpdateArtifactMetadataPayload>,
): Promise<CommandResult> {
  const expectedVersion = requireExpectedVersion(envelope);
  assertArtifactCommandTarget(envelope);
  const payload = validateMetadataPayload(envelope.payload);
  const visible = await readVisibleRoot(db, context, envelope.targetId);
  if (visible.root === undefined) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Artifact was not found');
  }
  assertEnvelopeProjectMatches(envelope, visible.root.project_id ?? undefined);
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId: visible.root.project_id ?? undefined,
    targetType: ARTIFACT_OBJECT_TYPE,
    targetId: envelope.targetId,
    expectedAggregateVersion: expectedVersion,
  };
  return executeArtifactCommand(db, context, normalizedEnvelope, async (execution) => {
    const root = await repo.getArtifactById(execution.trx, envelope.targetId);
    if (root === undefined) return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Artifact was not found');
    const currentVersion = aggregateVersion(root.aggregate_version);
    if (root.lifecycle_status !== 'ACTIVE') {
      return rejected(ARTIFACT_NOT_ACTIVE, 'Artifact is not active', currentVersion);
    }
    const currentMetadata = jsonColumn(root.metadata, 'metadata');
    const nextMetadata =
      payload.metadataPatch === undefined
        ? currentMetadata
        : applyArtifactMetadataPatch(currentMetadata, payload.metadataPatch);
    const outcome = await repo.casArtifactMetadata(execution.trx, {
      artifactId: envelope.targetId,
      expectedVersion,
      title: payload.title ?? root.title,
      classification: payload.classification ?? root.classification,
      metadata: nextMetadata,
      updatedByPrincipalId: envelope.principalId,
      updatedByActorSnapshotId: envelope.actorSnapshotId,
      lastAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (outcome !== 'OK') return casRejection(outcome, currentVersion, root.lifecycle_status);
    const updatedRoot = await repo.getArtifactById(execution.trx, envelope.targetId);
    if (updatedRoot === undefined) throw new Error('Artifact Root disappeared after metadata CAS');
    const branches = await repo.getArtifactBranches(execution.trx, envelope.targetId);
    const view = artifactView(updatedRoot, branches);
    const metadataVersion = safeInteger(updatedRoot.metadata_version, 'metadataVersion');
    const changedFields = [
      ...(payload.title === undefined ? [] : ['title']),
      ...(payload.classification === undefined ? [] : ['classification']),
      ...(payload.metadataPatch === undefined ? [] : ['metadata']),
    ];
    const eventPayload = {
      ...eventScopePayload(envelope.enterpriseId, normalizedEnvelope.projectId),
      artifactRef: view.artifactRef,
      aggregateVersion: aggregateVersion(updatedRoot.aggregate_version),
      metadataVersion,
      changedFields,
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'artifact.ArtifactMetadataUpdated',
      eventVersion: '1.0',
      aggregateType: ARTIFACT_OBJECT_TYPE,
      aggregateId: envelope.targetId,
      aggregateVersion: aggregateVersion(updatedRoot.aggregate_version),
      payload: eventPayload,
      occurredAt: new Date(),
    });
    return {
      kind: 'COMMITTED',
      resultPayload: {
        ...(view as unknown as CanonicalJsonObject),
        metadataVersion,
        changeReason: payload.changeReason,
      },
    };
  });
}

function casRejection(
  outcome: ArtifactCasOutcome,
  currentVersion: string,
  lifecycleStatus: Artifact.ArtifactLifecycle,
) {
  if (outcome === 'NOT_ACTIVE' || lifecycleStatus !== 'ACTIVE') {
    return rejected(ARTIFACT_NOT_ACTIVE, 'Artifact is not active', currentVersion);
  }
  if (outcome === 'CONFLICT') {
    return rejected(CONCURRENCY_CONFLICT, 'Artifact aggregate version is stale', currentVersion);
  }
  return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Artifact was not found');
}

export async function handleArchiveArtifact(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  envelope: ArtifactCommandEnvelope<ArchiveArtifactPayload>,
): Promise<CommandResult> {
  if (context.principalKind !== 'HUMAN' || envelope.principalKind !== 'HUMAN') {
    throw new ArtifactBusinessError(
      ARTIFACT_HUMAN_ONLY_DENIED,
      'Artifact archive requires a trusted HUMAN principal',
    );
  }
  const expectedVersion = requireExpectedVersion(envelope);
  assertArtifactCommandTarget(envelope);
  const payload = validateArchivePayload(envelope.payload, context);
  const visible = await readVisibleRoot(db, context, envelope.targetId);
  if (visible.root === undefined) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Artifact was not found');
  }
  assertEnvelopeProjectMatches(envelope, visible.root.project_id ?? undefined);
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId: visible.root.project_id ?? undefined,
    targetType: ARTIFACT_OBJECT_TYPE,
    targetId: envelope.targetId,
    expectedAggregateVersion: expectedVersion,
  };
  return executeArtifactCommand(db, context, normalizedEnvelope, async (execution) => {
    const root = await repo.getArtifactById(execution.trx, envelope.targetId);
    if (root === undefined) return rejected(ARTIFACT_QUERY_NOT_FOUND, 'Artifact was not found');
    const currentVersion = aggregateVersion(root.aggregate_version);
    if (root.lifecycle_status !== 'ACTIVE') {
      return rejected(ARTIFACT_NOT_ACTIVE, 'Artifact is not active', currentVersion);
    }
    const outcome = await repo.archiveArtifact(execution.trx, {
      artifactId: envelope.targetId,
      expectedVersion,
      archivedAt: payload.archivedAt,
      archiveReason: payload.archiveReason,
      retentionPolicyRef: payload.retentionPolicyRef,
      updatedByPrincipalId: envelope.principalId,
      updatedByActorSnapshotId: envelope.actorSnapshotId,
      lastAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (outcome !== 'OK') return casRejection(outcome, currentVersion, root.lifecycle_status);
    const archivedRoot = await repo.getArtifactById(execution.trx, envelope.targetId);
    if (archivedRoot === undefined) throw new Error('Artifact Root disappeared after archive');
    const branches = await repo.getArtifactBranches(execution.trx, envelope.targetId);
    const view = artifactView(archivedRoot, branches);
    const eventPayload = {
      ...eventScopePayload(envelope.enterpriseId, normalizedEnvelope.projectId),
      artifactRef: view.artifactRef,
      aggregateVersion: aggregateVersion(archivedRoot.aggregate_version),
      lifecycleStatus: 'ARCHIVED',
      archivedAt: payload.archivedAtValue,
      archiveReasonCode: payload.archiveReason.reasonCode,
      retentionPolicyRef: payload.retentionPolicyRef,
    } as unknown as CanonicalJsonObject;
    const eventDigest = digestCanonicalPayload(eventPayload);
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'artifact.ArtifactArchived',
      eventVersion: '1.0',
      aggregateType: ARTIFACT_OBJECT_TYPE,
      aggregateId: envelope.targetId,
      aggregateVersion: aggregateVersion(archivedRoot.aggregate_version),
      payload: eventPayload,
      occurredAt: payload.archivedAt,
    });
    await appendArchiveReferenceEdge(
      execution,
      normalizedEnvelope,
      payload.retentionPolicyRef,
      eventDigest.hash,
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        ...(view as unknown as CanonicalJsonObject),
        archivedAt: payload.archivedAtValue,
      },
    };
  });
}

export async function handleGetArtifact(
  db: Kysely<ArtifactDb>,
  context: ArtifactTransactionContext,
  payload: GetArtifactPayload,
): Promise<Artifact.ArtifactGetArtifactResult> {
  const scope = exactArtifactRef(payload.artifactRef, context);
  const visible = await readVisibleRoot(db, context, scope.artifactId);
  if (visible.root === undefined) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Artifact was not found');
  }
  if (
    visible.root.enterprise_id !== context.enterpriseId ||
    (visible.root.project_id ?? undefined) !== scope.projectId
  ) {
    throw new ArtifactBusinessError(ARTIFACT_QUERY_NOT_FOUND, 'Artifact was not found');
  }
  return artifactView(visible.root, visible.branches);
}
