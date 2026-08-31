// IM-05 WI-06/WI-07 (issues #126/#127): Release and publication handlers.
// Cross-module facts are resolved only through Artifact and Quality authority
// query ports. Business mutations use the shared command transaction runner.

import type { Kysely } from 'kysely';
import type { Common, ReleasePublication } from '@zhiju/contracts';
import {
  canonicalize,
  isUuidV7,
  newUuidV7,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import {
  withReleasePublicationTransaction,
  digestCanonicalPayload,
  type ReleasePublicationDb,
  type ReleaseTransactionContext,
} from './persistence/release-publication-db.js';
import {
  ReleasePublicationBusinessRepository,
  type BusinessWriteOutcome,
} from './persistence/release-publication-business-repository.js';
import {
  COMMAND_TARGET_MISMATCH,
  CONCURRENCY_CONFLICT,
  CommandExecutionError,
  executeReleasePublicationCommand,
  type CommandBodyResult,
  type CommandEnvelope,
  type CommandExecution,
  type CommandResult,
} from './persistence/release-publication-command-runner.js';
import {
  RELEASE_CANCEL_NOT_ALLOWED,
  RELEASE_COMPLETION_CRITERIA_UNSATISFIED,
  RELEASE_DESTINATION_INVALID,
  RELEASE_IDENTITY_CONFLICT,
  RELEASE_MULTIPLE_PACKAGE_HASHES,
  RELEASE_PACKAGE_FROZEN,
  RELEASE_PACKAGE_HASH_MISMATCH,
  RELEASE_QUERY_NOT_FOUND,
  RELEASE_RECALL_NOT_AUTHORIZED,
  RELEASE_REQUIRED_RECEIPT_MISSING,
  RELEASE_REPRESENTATION_INVALID,
  RELEASE_SCOPE_INVALID,
  ReleasePublicationBusinessError,
  aggregateVersionNumber,
  contentHashBytes,
  parseStoredJson,
  sameScope,
  snapshotRefForPackage,
  validateDestinations,
  validateDraftAuthorities,
  validateDraftDefinition,
  validatePackageDefinition,
  validatePreparationValidationRef,
  validateReleasePackageRef,
  validateReleaseRef,
  validateSelections,
  validatePackageShape,
  type ReleaseAuthorityQueryPorts,
} from './release-publication-validation.js';
import {
  RELEASE_AUTHORIZATION_INVALID,
  RELEASE_READINESS_INVALID,
  revalidateReleaseForAuthorization,
  validateHumanAuthorizationChain,
  validateReleaseAuthorization,
} from './release-publication-authorization.js';
import {
  InMemoryReleaseReceiptLedger,
  recordFormalReceipt,
  registerPublicationAttempt,
  RELEASE_RECEIPT_TARGET_MISMATCH,
  sameObjectRef,
  samePackageRef,
  type RawExternalReceiptRepository,
} from './receipt-validator.js';
import { buildPackageHashMaterial, sameContentHash } from './package-hash.js';
import { sanitizeProviderResult } from './provider-result.js';
import type {
  PublicationAttemptTable,
  ReleaseRecordTable,
  ReleaseTransaction,
} from './persistence/release-publication-db.js';

const RELEASE_OBJECT_TYPE = 'release.release';

type DraftDefinition = ReleasePublication.ReleaseDraftDefinition;
type Selection = ReleasePublication.ReleaseRepresentationSelection;
type Destination = ReleasePublication.ReleaseDestinationDefinition;
type PackageDefinition = ReleasePublication.ReleasePackageDefinition;

export type ReleaseCommandEnvelope<TPayload> = CommandEnvelope & { readonly payload: TPayload };
export type CreateReleaseDraftPayload = ReleasePublication.ReleaseCreateReleaseDraftPayload;
export type SelectRepresentationsPayload = ReleasePublication.ReleaseSelectRepresentationsPayload;
export type SetDestinationsPayload = ReleasePublication.ReleaseSetDestinationsPayload;
export type PrepareReleasePayload = ReleasePublication.ReleasePrepareReleasePayload;
export type CancelReleasePayload = ReleasePublication.ReleaseCancelReleasePayload;
export type ValidateReleaseReadinessPayload =
  ReleasePublication.ReleaseValidateReleaseReadinessPayload;
export type AuthorizeReleasePayload = ReleasePublication.ReleaseAuthorizeReleasePayload;
export type StartPublicationAttemptPayload =
  ReleasePublication.ReleaseStartPublicationAttemptPayload;
export type RecordPublicationReceiptPayload =
  ReleasePublication.ReleaseRecordPublicationReceiptPayload;
export type RecordPublicationFailurePayload =
  ReleasePublication.ReleaseRecordPublicationFailurePayload;
export type CompleteReleasePayload = ReleasePublication.ReleaseCompleteReleasePayload;
export type RecallReleasePayload = ReleasePublication.ReleaseRecallReleasePayload;
export type GetReleasePayload = ReleasePublication.ReleaseGetReleasePayload;
export type GetFrozenPackagePayload = ReleasePublication.ReleaseGetFrozenPackagePayload;
export type GetPublicationAttemptsPayload = ReleasePublication.ReleaseGetPublicationAttemptsPayload;
export type GetReleaseReceiptsPayload = ReleasePublication.ReleaseGetReleaseReceiptsPayload;
export type GetReleaseImpactPayload = ReleasePublication.ReleaseGetReleaseImpactPayload;

const repo = new ReleasePublicationBusinessRepository();

function asCanonical(value: unknown): CanonicalJsonValue {
  return value as CanonicalJsonValue;
}

function asCanonicalObject(value: unknown): CanonicalJsonObject {
  return value as CanonicalJsonObject;
}

function hashFromBytes(value: Buffer, label: string): Common.ContentHash {
  if (value.length !== 32) {
    throw new ReleasePublicationBusinessError(
      RELEASE_QUERY_NOT_FOUND,
      `${label} is not a SHA-256 hash`,
    );
  }
  return {
    algorithm: 'SHA-256',
    digest: value.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function scopeForRow(row: {
  readonly enterprise_id: string;
  readonly project_id: string | null;
}): Common.ScopeRef {
  return {
    enterpriseId: row.enterprise_id,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
  };
}

function releaseRefForRow(row: ReleaseRecordTable): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: RELEASE_OBJECT_TYPE,
    objectId: row.release_id,
    scope: scopeForRow(row),
  };
}

function draftDefinitionForRow(row: ReleaseRecordTable): DraftDefinition {
  const definition: DraftDefinition = {
    artifactRef: parseStoredJson(row.artifact_ref, 'Release.artifactRef') as Common.ObjectRef,
    revisionRef: parseStoredJson(
      row.revision_ref,
      'Release.revisionRef',
    ) as Common.ContentAddressedRef,
    releaseNumber: row.release_number,
    purpose: row.purpose as ReleasePublication.ReleasePurpose,
    qualityProfileRef: parseStoredJson(
      row.quality_profile_ref,
      'Release.qualityProfileRef',
    ) as Common.VersionedRef,
    revisionAcceptanceSnapshotRef: parseStoredJson(
      row.revision_acceptance_snapshot_ref,
      'Release.revisionAcceptanceSnapshotRef',
    ) as Common.SnapshotRef,
    approvalBundleSnapshotRef: parseStoredJson(
      row.approval_bundle_snapshot_ref,
      'Release.approvalBundleSnapshotRef',
    ) as Common.SnapshotRef,
    ...(row.requested_effective_at === null
      ? {}
      : { requestedEffectiveAt: row.requested_effective_at.toISOString() }),
    ...(row.supersedes_release_ref === null
      ? {}
      : {
          supersedesReleaseRef: parseStoredJson(
            row.supersedes_release_ref,
            'Release.supersedesReleaseRef',
          ) as Common.ObjectRef,
        }),
  };
  return definition;
}

function selectionsForRow(row: ReleaseRecordTable): readonly Selection[] {
  return parseStoredJson(
    row.representation_selections,
    'Release.representationSelections',
  ) as readonly Selection[];
}

function destinationsForRow(row: ReleaseRecordTable): readonly Destination[] {
  return parseStoredJson(
    row.destination_definitions,
    'Release.destinationDefinitions',
  ) as readonly Destination[];
}

function packageRefForRow(row: ReleaseRecordTable): Common.ReleasePackageRef | undefined {
  if (row.package_id === null || row.package_hash === null) return undefined;
  return {
    releaseRef: releaseRefForRow(row),
    packageSnapshotRef: snapshotRefForPackage(
      row.package_id,
      releaseRefForRow(row),
      hashFromBytes(row.package_hash, 'Release.packageHash'),
    ),
    packageHash: hashFromBytes(row.package_hash, 'Release.packageHash'),
  };
}

function releaseViewForRow(row: ReleaseRecordTable): ReleasePublication.ReleaseView {
  const releaseRef = releaseRefForRow(row);
  const packageRef = packageRefForRow(row);
  const releaseReadinessSnapshotRef =
    row.release_readiness_snapshot_ref === null
      ? undefined
      : (parseStoredJson(
          row.release_readiness_snapshot_ref,
          'Release.releaseReadinessSnapshotRef',
        ) as Common.SnapshotRef);
  const authorizationRef =
    row.authorization_ref === null
      ? undefined
      : (parseStoredJson(
          row.authorization_ref,
          'Release.authorizationRef',
        ) as Common.ContentAddressedRef);
  const recallRef =
    row.recall_ref === null
      ? undefined
      : (parseStoredJson(row.recall_ref, 'Release.recallRef') as Common.ContentAddressedRef);
  return {
    releaseRef,
    aggregateVersion: aggregateVersionNumber(row.aggregate_version, 'Release.aggregateVersion'),
    definition: draftDefinitionForRow(row),
    status: row.status,
    ...(packageRef === undefined ? {} : { packageRef }),
    ...(releaseReadinessSnapshotRef === undefined ? {} : { releaseReadinessSnapshotRef }),
    ...(authorizationRef === undefined ? {} : { authorizationRef }),
    attemptRefs: [],
    receiptRefs: [],
    ...(recallRef === undefined ? {} : { recallRef }),
  };
}

function normalizeEnvelopeProject(
  envelope: CommandEnvelope,
  projectId: string | undefined,
): CommandEnvelope {
  if (envelope.projectId !== undefined && envelope.projectId !== projectId) {
    throw new ReleasePublicationBusinessError(
      RELEASE_SCOPE_INVALID,
      'command scope does not match the exact Release scope',
    );
  }
  return projectId === undefined ? envelope : { ...envelope, projectId };
}

function commandTarget(envelope: CommandEnvelope): void {
  if (envelope.targetType !== RELEASE_OBJECT_TYPE || !isUuidV7(envelope.targetId)) {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'command target must be the expected release.release UUIDv7',
    );
  }
}

function expectedVersion(envelope: CommandEnvelope): string {
  const value = envelope.expectedAggregateVersion;
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'Release mutation requires a positive expected aggregate version',
    );
  }
  return value;
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

function mapWriteOutcome(
  outcome: BusinessWriteOutcome,
  invalidCode: string,
  options: {
    readonly notFoundCode?: string;
    readonly frozenCode?: string;
    readonly multipleHashCode?: string;
    readonly notAllowedCode?: string;
    readonly aggregateVersion?: string | undefined;
  } = {},
): CommandBodyResult {
  switch (outcome) {
    case 'NOT_FOUND':
      return rejected(
        options.notFoundCode ?? RELEASE_QUERY_NOT_FOUND,
        'the exact Release was not found',
      );
    case 'CONFLICT':
      return rejected(
        CONCURRENCY_CONFLICT,
        'Release aggregate version does not match the expected version',
        options.aggregateVersion,
      );
    case 'FROZEN':
      return rejected(
        options.frozenCode ?? RELEASE_PACKAGE_FROZEN,
        'the Release or frozen Package is immutable',
        options.aggregateVersion,
      );
    case 'MULTIPLE_HASH':
      return rejected(
        options.multipleHashCode ?? RELEASE_MULTIPLE_PACKAGE_HASHES,
        'a different package hash is already associated with the Release',
        options.aggregateVersion,
      );
    case 'NOT_ALLOWED':
      return rejected(
        options.notAllowedCode ?? RELEASE_CANCEL_NOT_ALLOWED,
        'Release transition is not allowed',
      );
    case 'INVALID':
      return rejected(invalidCode, 'Release business facts were rejected');
    case 'DUPLICATE':
      return rejected(
        CONCURRENCY_CONFLICT,
        'the exact ReleasePublication fact has already been recorded',
        options.aggregateVersion,
      );
    case 'OK':
      throw new Error('OK must be handled by the caller');
  }
}

function businessRejection(error: unknown): CommandBodyResult {
  if (error instanceof ReleasePublicationBusinessError) {
    return rejected(error.code, error.message);
  }
  throw error;
}

async function exactReleaseRow(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  envelope: CommandEnvelope,
): Promise<ReleaseRecordTable> {
  return withReleasePublicationTransaction(db, context, async (trx) => {
    const row = await repo.getReleaseById(trx, envelope.targetId);
    if (row === undefined) {
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'the exact Release was not found',
      );
    }
    if (
      row.enterprise_id !== context.enterpriseId ||
      (row.project_id ?? undefined) !== (envelope.projectId ?? undefined)
    ) {
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'the exact Release was not found',
      );
    }
    return row;
  });
}

async function appendReferenceTarget(
  execution: CommandExecution,
  referencePath: string,
  target: Common.TypedReference,
  referencePurpose: string,
): Promise<void> {
  if (!('kind' in target)) return;
  const targetVersionId =
    target.kind === 'VERSIONED'
      ? target.versionId
      : target.kind === 'SNAPSHOT'
        ? target.snapshotId
        : target.kind === 'CONTENT_ADDRESSED'
          ? target.immutableVersionId
          : undefined;
  const targetPayloadHash =
    target.kind === 'CONTENT_ADDRESSED' || target.kind === 'SNAPSHOT'
      ? contentHashBytes(target.contentHash)
      : undefined;
  await execution.appendReferenceEdge({
    ownerObjectType: RELEASE_OBJECT_TYPE,
    ownerObjectId: executionTargetId(execution),
    referencePath,
    targetModule: target.objectType.includes('.')
      ? (target.objectType.split('.')[0] ?? 'release-publication')
      : 'release-publication',
    targetObjectType: target.objectType,
    targetObjectId: target.objectId,
    ...(targetVersionId === undefined ? {} : { targetVersionId }),
    ...(targetPayloadHash === undefined ? {} : { targetPayloadHash }),
    referencePurpose,
  });
}

// CommandExecution intentionally exposes the transaction but not envelope
// metadata. The target identity is passed through this local WeakMap so
// reference helpers cannot accidentally point at another aggregate.
const executionTargets = new WeakMap<object, string>();

function executionTargetId(execution: CommandExecution): string {
  const targetId = executionTargets.get(execution);
  if (targetId === undefined)
    throw new CommandExecutionError(COMMAND_TARGET_MISMATCH, 'missing command target');
  return targetId;
}

function withTarget<T extends CommandExecution>(execution: T, targetId: string): T {
  executionTargets.set(execution, targetId);
  return execution;
}

async function appendRepresentationReference(
  execution: CommandExecution,
  selection: Selection,
  index: number,
  referencePrefix: string,
): Promise<void> {
  await execution.appendReferenceEdge({
    ownerObjectType: RELEASE_OBJECT_TYPE,
    ownerObjectId: executionTargetId(execution),
    referencePath: `${referencePrefix}/${index}/representationRef`,
    targetModule: 'artifact',
    targetObjectType: 'artifact.representation',
    targetObjectId: selection.representationRef.representationId,
    targetPayloadHash: contentHashBytes(selection.representationRef.checksum),
    referencePurpose: 'RELEASE_REPRESENTATION_SELECTION',
  });
}

async function appendDraftReferences(
  execution: CommandExecution,
  definition: DraftDefinition,
): Promise<void> {
  await appendReferenceTarget(
    execution,
    '/artifactRef',
    definition.artifactRef,
    'RELEASE_ARTIFACT',
  );
  await appendReferenceTarget(
    execution,
    '/revisionRef',
    definition.revisionRef,
    'RELEASE_REVISION',
  );
  await appendReferenceTarget(
    execution,
    '/qualityProfileRef',
    definition.qualityProfileRef,
    'RELEASE_QUALITY_PROFILE',
  );
  await appendReferenceTarget(
    execution,
    '/revisionAcceptanceSnapshotRef',
    definition.revisionAcceptanceSnapshotRef,
    'RELEASE_REVISION_ACCEPTANCE',
  );
  await appendReferenceTarget(
    execution,
    '/approvalBundleSnapshotRef',
    definition.approvalBundleSnapshotRef,
    'RELEASE_APPROVAL_BUNDLE',
  );
  if (definition.supersedesReleaseRef !== undefined) {
    await appendReferenceTarget(
      execution,
      '/supersedesReleaseRef',
      definition.supersedesReleaseRef,
      'RELEASE_SUPERSEDES',
    );
  }
}

async function appendSelectionReferences(
  execution: CommandExecution,
  selections: readonly Selection[],
  selectionReason: Common.Justification,
  referencePrefix = '/representationSelections',
): Promise<void> {
  for (const [index, selection] of selections.entries()) {
    await appendRepresentationReference(execution, selection, index, referencePrefix);
  }
  for (const [index, evidenceRef] of (selectionReason.evidenceRefs ?? []).entries()) {
    await appendReferenceTarget(
      execution,
      `/representationSelectionReason/evidenceRefs/${index}/evidence`,
      evidenceRef.evidence,
      'RELEASE_SELECTION_REASON_EVIDENCE',
    );
  }
  if (selectionReason.policyRef !== undefined) {
    await appendReferenceTarget(
      execution,
      '/representationSelectionReason/policyRef',
      selectionReason.policyRef,
      'RELEASE_SELECTION_REASON_POLICY',
    );
  }
}

async function appendDestinationReferences(
  execution: CommandExecution,
  destinations: readonly Destination[],
  recipientScopeSnapshotRef: Common.SnapshotRef,
  referenceRoot = '',
  includeAggregateRecipientScope = true,
): Promise<void> {
  if (includeAggregateRecipientScope) {
    await appendReferenceTarget(
      execution,
      `${referenceRoot}/recipientScopeSnapshotRef`,
      recipientScopeSnapshotRef,
      'RELEASE_RECIPIENT_SCOPE',
    );
  }
  for (const [index, destination] of destinations.entries()) {
    await appendReferenceTarget(
      execution,
      `${referenceRoot}/destinations/${index}/recipientScopeRef`,
      destination.recipientScopeRef,
      'RELEASE_DESTINATION_RECIPIENT_SCOPE',
    );
    await appendReferenceTarget(
      execution,
      `${referenceRoot}/destinations/${index}/deliveryPolicyRef`,
      destination.deliveryPolicyRef,
      'RELEASE_DESTINATION_POLICY',
    );
  }
}

async function appendPackageReferences(
  execution: CommandExecution,
  packageDefinition: PackageDefinition,
  preparationValidationRef: Common.ContentAddressedRef,
): Promise<void> {
  await appendReferenceTarget(
    execution,
    '/package/releaseRef',
    packageDefinition.releaseRef,
    'RELEASE_PACKAGE_RELEASE',
  );
  await appendReferenceTarget(
    execution,
    '/package/canonicalRevisionRef',
    packageDefinition.canonicalRevisionRef,
    'RELEASE_PACKAGE_REVISION',
  );
  await appendReferenceTarget(
    execution,
    '/package/approvalBundleSnapshotRef',
    packageDefinition.approvalBundleSnapshotRef,
    'RELEASE_PACKAGE_APPROVAL_BUNDLE',
  );
  await appendReferenceTarget(
    execution,
    '/package/recipientScopeSnapshotRef',
    packageDefinition.recipientScopeSnapshotRef,
    'RELEASE_PACKAGE_RECIPIENT_SCOPE',
  );
  await appendReferenceTarget(
    execution,
    '/preparationValidationRef',
    preparationValidationRef,
    'RELEASE_PREPARATION_VALIDATION',
  );
  for (const [index, selection] of packageDefinition.representations.entries()) {
    await appendRepresentationReference(execution, selection, index, '/package/representations');
  }
  await appendDestinationReferences(
    execution,
    packageDefinition.destinations,
    packageDefinition.recipientScopeSnapshotRef,
    '/package',
    false,
  );
}

function draftResult(row: ReleaseRecordTable): CanonicalJsonObject {
  return asCanonicalObject(releaseViewForRow(row));
}

function preparedEventPayload(
  context: ReleaseTransactionContext,
  packageRef: Common.ReleasePackageRef,
  packageDefinition: PackageDefinition,
): CanonicalJsonObject {
  return asCanonicalObject({
    enterpriseId: context.enterpriseId,
    ...(packageRef.releaseRef.scope.projectId === undefined
      ? {}
      : { projectId: packageRef.releaseRef.scope.projectId }),
    releaseRef: asCanonical(packageRef.releaseRef),
    packageRef: asCanonical(packageRef),
    revisionRef: asCanonical(packageDefinition.canonicalRevisionRef),
    approvalBundleSnapshotRef: asCanonical(packageDefinition.approvalBundleSnapshotRef),
    destinationIds: packageDefinition.destinations.map((destination) => destination.destinationId),
  });
}

function attemptRefForRow(
  row: PublicationAttemptTable,
  releaseRef: Common.ObjectRef,
): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'release.publication_attempt',
    objectId: row.attempt_id,
    scope: releaseRef.scope,
  };
}

function publicationAttemptViewForRow(
  row: PublicationAttemptTable,
  releaseRef: Common.ObjectRef,
): ReleasePublication.PublicationAttemptView {
  const attemptRef = attemptRefForRow(row, releaseRef);
  return {
    attemptRef,
    definition: parseStoredJson(
      row.definition,
      'PublicationAttempt.definition',
    ) as ReleasePublication.PublicationAttemptDefinition,
    outcome: row.outcome,
    ...(row.raw_receipt_ref === null
      ? {}
      : {
          rawReceiptRef: parseStoredJson(
            row.raw_receipt_ref,
            'PublicationAttempt.rawReceiptRef',
          ) as Common.ContentAddressedRef,
        }),
    ...(row.formal_receipt_ref === null
      ? {}
      : {
          formalReceiptRef: parseStoredJson(
            row.formal_receipt_ref,
            'PublicationAttempt.formalReceiptRef',
          ) as Common.ContentAddressedRef,
        }),
    ...(row.failure_ref === null
      ? {}
      : {
          failureRef: parseStoredJson(
            row.failure_ref,
            'PublicationAttempt.failureRef',
          ) as Common.ContentAddressedRef,
        }),
  };
}

async function releaseViewWithFacts(
  trx: ReleaseTransaction,
  row: ReleaseRecordTable,
): Promise<ReleasePublication.ReleaseView> {
  const base = releaseViewForRow(row);
  const attempts = await repo.getPublicationAttempts(trx, row.release_id);
  const receipts = await repo.getPublicationReceipts(trx, row.release_id);
  return {
    ...base,
    attemptRefs: attempts.map((attempt) => attemptRefForRow(attempt, base.releaseRef)),
    receiptRefs: receipts.map(
      (receipt) =>
        parseStoredJson(
          receipt.formal_receipt_ref,
          'PublicationReceipt.formalReceiptRef',
        ) as Common.ContentAddressedRef,
    ),
  };
}

function scopedEventPayload(
  context: ReleaseTransactionContext,
  payload: CanonicalJsonObject,
  projectId?: string,
): CanonicalJsonObject {
  return {
    enterpriseId: context.enterpriseId,
    ...(projectId === undefined ? {} : { projectId }),
    ...payload,
  };
}

function packageRefForPersistenceRow(
  row: ReleaseRecordTable,
  context: ReleaseTransactionContext,
): Common.ReleasePackageRef {
  const packageRef = packageRefForRow(row);
  if (packageRef === undefined) {
    throw new ReleasePublicationBusinessError(
      RELEASE_READINESS_INVALID,
      'Release does not contain an exact frozen Package',
    );
  }
  if (
    row.enterprise_id !== context.enterpriseId ||
    (row.project_id !== null && !context.allowedProjectIds.includes(row.project_id))
  ) {
    // Scope is checked by the enclosing exact Release lookup. Keep this branch
    // explicit so a future caller cannot treat a foreign row as a package fact.
    throw new ReleasePublicationBusinessError(
      RELEASE_QUERY_NOT_FOUND,
      'the exact frozen Package was not found',
    );
  }
  return packageRef;
}

async function loadFrozenPackageForRelease(
  trx: ReleaseTransaction,
  row: ReleaseRecordTable,
  context: ReleaseTransactionContext,
): Promise<{
  readonly releaseRef: Common.ObjectRef;
  readonly packageRef: Common.ReleasePackageRef;
  readonly definition: PackageDefinition;
  readonly selections: readonly Selection[];
  readonly destinations: readonly Destination[];
  readonly recipientScopeSnapshotRef: Common.SnapshotRef;
}> {
  const releaseRef = releaseRefForRow(row);
  const packageRef = packageRefForPersistenceRow(row, context);
  const packageRow = await repo.getPackageById(trx, packageRef.packageSnapshotRef.objectId);
  if (packageRow === undefined) {
    throw new ReleasePublicationBusinessError(
      RELEASE_READINESS_INVALID,
      'the exact frozen Package row was not found',
    );
  }
  if (
    packageRow.release_id !== row.release_id ||
    !packageRow.package_hash.equals(contentHashBytes(packageRef.packageHash))
  ) {
    throw new ReleasePublicationBusinessError(
      RELEASE_READINESS_INVALID,
      'the exact frozen Package row was not found',
    );
  }
  const definition = validatePackageDefinition(
    parseStoredJson(
      packageRow.package_definition,
      'Package.packageDefinition',
    ) as PackageDefinition,
    context,
    row.project_id ?? undefined,
  ).definition;
  const selections = selectionsForRow(row);
  const destinations = destinationsForRow(row);
  if (row.recipient_scope_snapshot_ref === null) {
    throw new ReleasePublicationBusinessError(
      RELEASE_DESTINATION_INVALID,
      'Release has no exact frozen Recipient Scope',
    );
  }
  const recipientScopeSnapshotRef = parseStoredJson(
    row.recipient_scope_snapshot_ref,
    'Release.recipientScopeSnapshotRef',
  ) as Common.SnapshotRef;
  validatePackageShape(
    definition,
    releaseRef,
    draftDefinitionForRow(row),
    selections,
    destinations,
    recipientScopeSnapshotRef,
    context,
    row.project_id ?? undefined,
  );
  const material = buildPackageHashMaterial(definition);
  if (!sameContentHash(material.expectedPackageHash, packageRef.packageHash)) {
    throw new ReleasePublicationBusinessError(
      RELEASE_READINESS_INVALID,
      'the frozen Package hash is not the hash of its exact manifest',
    );
  }
  return {
    releaseRef,
    packageRef,
    definition,
    selections,
    destinations,
    recipientScopeSnapshotRef,
  };
}

function authorizationRefForCommand(
  envelope: CommandEnvelope,
  releaseRef: Common.ObjectRef,
  packageRef: Common.ReleasePackageRef,
  payload: AuthorizeReleasePayload,
): Common.ContentAddressedRef {
  const digest = digestCanonicalPayload(
    asCanonicalObject({
      releaseRef,
      packageRef,
      releaseReadinessSnapshotRef: payload.releaseReadinessSnapshotRef,
      authorizingHumanRef: payload.authorizingHumanRef,
      actorSnapshotRef: payload.actorSnapshotRef,
      authorizationDecisionRef: payload.authorizationDecisionRef,
      authorizedAt: payload.authorizedAt,
    }),
  );
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'release.release_authorization',
    objectId: envelope.commandId,
    scope: releaseRef.scope,
    contentHash: hashFromBytes(digest.hash, 'Release.authorizationRef'),
  };
}

function factRefForCommand(
  objectType: string,
  envelope: CommandEnvelope,
  payload: CanonicalJsonObject,
  scope: Common.ScopeRef,
): Common.ContentAddressedRef {
  const digest = digestCanonicalPayload(payload);
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId: envelope.commandId,
    scope,
    contentHash: hashFromBytes(digest.hash, `${objectType} ref`),
  };
}

function appendReleaseEvent(
  execution: CommandExecution,
  context: ReleaseTransactionContext,
  envelope: CommandEnvelope,
  eventType: string,
  aggregateVersion: string,
  payload: CanonicalJsonObject,
  occurredAt: Date,
): Promise<void> {
  return execution.appendOutbox({
    eventId: newUuidV7(),
    eventType,
    eventVersion: '1.0',
    aggregateType: RELEASE_OBJECT_TYPE,
    aggregateId: envelope.targetId,
    aggregateVersion,
    payload: scopedEventPayload(context, payload, envelope.projectId),
    occurredAt,
  });
}

function validatedAttemptDefinition(
  definition: ReleasePublication.PublicationAttemptDefinition,
  releaseRef: Common.ObjectRef,
  packageRef: Common.ReleasePackageRef,
  destinations: readonly Destination[],
  context: ReleaseTransactionContext,
): ReleasePublication.PublicationAttemptDefinition {
  validateReleasePackageRef(definition.packageRef, context);
  if (
    !samePackageRef(definition.packageRef, packageRef) ||
    !sameObjectRef(definition.packageRef.releaseRef, releaseRef) ||
    !destinations.some((destination) => destination.destinationId === definition.destinationId) ||
    !Number.isInteger(definition.attemptNumber) ||
    definition.attemptNumber < 1 ||
    typeof definition.stableIdempotencyKey !== 'string' ||
    definition.stableIdempotencyKey.trim().length === 0 ||
    Number.isNaN(Date.parse(definition.requestedAt))
  ) {
    throw new ReleasePublicationBusinessError(
      RELEASE_RECEIPT_TARGET_MISMATCH,
      'PublicationAttempt does not match the exact frozen Release Package',
    );
  }
  return definition;
}

function exactReleaseTarget(envelope: CommandEnvelope): void {
  if (envelope.targetType !== RELEASE_OBJECT_TYPE || !isUuidV7(envelope.targetId)) {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'WI-07 command target must be the expected release.release UUIDv7',
    );
  }
}

function writeRejection(
  outcome: BusinessWriteOutcome,
  invalidCode: string,
  aggregateVersion?: string,
): CommandBodyResult {
  return mapWriteOutcome(outcome, invalidCode, { aggregateVersion });
}

function businessFactError(error: unknown): ReleasePublicationBusinessError {
  if (error instanceof ReleasePublicationBusinessError) return error;
  throw error;
}

function parseOptionalContentAddressedRef(
  value: unknown,
  label: string,
): Common.ContentAddressedRef | undefined {
  if (value === null || value === undefined) return undefined;
  return parseStoredJson(value, label) as Common.ContentAddressedRef;
}

function timeoutForDestination(
  options: ReleasePublicationHandlerOptions | undefined,
  destinationId: string,
): number {
  const timeout = options?.deliveryTimeoutMsByDestination?.[destinationId];
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < 0) {
    throw new ReleasePublicationBusinessError(
      RELEASE_RECEIPT_TARGET_MISMATCH,
      'the authoritative delivery timeout is unavailable for this Destination',
    );
  }
  return timeout;
}

function affectedDestinationIdsForRecall(
  recallScope: CanonicalJsonValue,
  destinations: readonly Destination[],
): readonly string[] {
  if (recallScope !== null && typeof recallScope === 'object' && !Array.isArray(recallScope)) {
    const scoped = recallScope as { readonly affectedDestinationIds?: unknown };
    if ('affectedDestinationIds' in scoped) {
      if (
        !Array.isArray(scoped.affectedDestinationIds) ||
        scoped.affectedDestinationIds.length === 0
      ) {
        return [];
      }
      if (
        scoped.affectedDestinationIds.every((value): value is string => typeof value === 'string')
      ) {
        return [...new Set(scoped.affectedDestinationIds)];
      }
      return [];
    }
  }
  return destinations.map((destination) => destination.destinationId);
}

function exactAttemptRefForPayload(
  row: PublicationAttemptTable,
  releaseRef: Common.ObjectRef,
  payloadRef: Common.ObjectRef,
): void {
  if (!sameObjectRef(attemptRefForRow(row, releaseRef), payloadRef)) {
    throw new ReleasePublicationBusinessError(
      RELEASE_RECEIPT_TARGET_MISMATCH,
      'the submitted fact does not target the exact registered PublicationAttempt',
    );
  }
}

function rawReceiptRepository(ports: ReleaseAuthorityQueryPorts): RawExternalReceiptRepository {
  if (ports.rawExternalReceipts === undefined) {
    throw new ReleasePublicationBusinessError(
      RELEASE_RECEIPT_TARGET_MISMATCH,
      'RawExternalReceipt authority is unavailable; Formal Receipt promotion is fail-closed',
    );
  }
  return ports.rawExternalReceipts;
}

function normalizeReceiptWithRuntimeValidator(
  attempt: PublicationAttemptTable,
  releaseRef: Common.ObjectRef,
  submission: ReleasePublication.FormalReceiptSubmission,
  receiptRef: Common.ContentAddressedRef,
  ports: ReleaseAuthorityQueryPorts,
  deliveryTimeoutMs: number,
  correlationId: string,
): ReleasePublication.FormalReceiptSubmission {
  const ledger = new InMemoryReleaseReceiptLedger();
  const attemptRef = attemptRefForRow(attempt, releaseRef);
  const registered = registerPublicationAttempt(ledger, {
    attemptRef,
    definition: parseStoredJson(
      attempt.definition,
      'PublicationAttempt.definition',
    ) as ReleasePublication.PublicationAttemptDefinition,
    correlationId,
  });
  if (!registered.ok) {
    throw new ReleasePublicationBusinessError(registered.error.code, registered.error.safeMessage);
  }
  const validated = recordFormalReceipt(ledger, rawReceiptRepository(ports), {
    submission,
    receiptRef,
    deliveryTimeoutMs,
    correlationId,
  });
  if (!validated.ok) {
    throw new ReleasePublicationBusinessError(validated.error.code, validated.error.safeMessage);
  }
  return validated.record.submission;
}

export interface ReleasePublicationHandlerOptions {
  /** Policy-domain value injected until DeliveryPolicy exposes this field. */
  readonly deliveryTimeoutMsByDestination?: Readonly<Record<string, number>>;
}

export async function handleCreateReleaseDraft(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  envelope: ReleaseCommandEnvelope<CreateReleaseDraftPayload>,
  ports: ReleaseAuthorityQueryPorts,
): Promise<CommandResult> {
  commandTarget(envelope);
  const validated = validateDraftDefinition(
    envelope.payload.definition,
    context,
    envelope.projectId,
  );
  const normalizedEnvelope = normalizeEnvelopeProject(envelope, validated.projectId);
  return executeReleasePublicationCommand(
    db,
    context,
    normalizedEnvelope,
    async (rawExecution): Promise<CommandBodyResult> => {
      const execution = withTarget(rawExecution, normalizedEnvelope.targetId);
      try {
        await validateDraftAuthorities(validated.definition, context, ports, validated.projectId);
      } catch (error) {
        return businessRejection(error);
      }
      const outcome = await repo.insertReleaseDraft(execution.trx, {
        releaseId: normalizedEnvelope.targetId,
        enterpriseId: context.enterpriseId,
        ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
        artifactRef: validated.definition.artifactRef,
        revisionRef: validated.definition.revisionRef,
        revisionContentHash: contentHashBytes(validated.definition.revisionRef.contentHash),
        releaseNumber: validated.definition.releaseNumber,
        purpose: validated.definition.purpose,
        ...(validated.definition.requestedEffectiveAt === undefined
          ? {}
          : { requestedEffectiveAt: new Date(validated.definition.requestedEffectiveAt) }),
        qualityProfileRef: validated.definition.qualityProfileRef,
        revisionAcceptanceSnapshotRef: validated.definition.revisionAcceptanceSnapshotRef,
        approvalBundleSnapshotRef: validated.definition.approvalBundleSnapshotRef,
        ...(validated.definition.supersedesReleaseRef === undefined
          ? {}
          : { supersedesReleaseRef: validated.definition.supersedesReleaseRef }),
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        createdAuthorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      if (outcome.outcome !== 'OK') {
        return mapWriteOutcome(outcome.outcome, RELEASE_IDENTITY_CONFLICT);
      }
      const row = await repo.getReleaseById(execution.trx, normalizedEnvelope.targetId);
      if (row === undefined) throw new Error('Release disappeared after draft creation');
      await appendDraftReferences(execution, validated.definition);
      return { kind: 'COMMITTED', resultPayload: draftResult(row) };
    },
  );
}

export async function handleSelectRepresentations(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  envelope: ReleaseCommandEnvelope<SelectRepresentationsPayload>,
  ports: ReleaseAuthorityQueryPorts,
): Promise<CommandResult> {
  commandTarget(envelope);
  const version = expectedVersion(envelope);
  const target = await exactReleaseRow(db, context, envelope);
  const normalizedEnvelope = normalizeEnvelopeProject(envelope, target.project_id ?? undefined);
  return executeReleasePublicationCommand(
    db,
    context,
    normalizedEnvelope,
    async (rawExecution): Promise<CommandBodyResult> => {
      const execution = withTarget(rawExecution, normalizedEnvelope.targetId);
      const row = await repo.getReleaseById(execution.trx, normalizedEnvelope.targetId);
      if (row === undefined)
        return rejected(RELEASE_QUERY_NOT_FOUND, 'the exact Release was not found');
      const draft = draftDefinitionForRow(row);
      try {
        const validatedDraft = validateDraftDefinition(draft, context, row.project_id ?? undefined);
        await validateDraftAuthorities(
          validatedDraft.definition,
          context,
          ports,
          row.project_id ?? undefined,
        );
        const selections = await validateSelections(
          envelope.payload.selections,
          validatedDraft.definition.revisionRef,
          context,
          ports,
          row.project_id ?? undefined,
        );
        const outcome = await repo.replaceReleaseSelections(execution.trx, {
          releaseId: row.release_id,
          expectedVersion: version,
          selections,
          selectionReason: envelope.payload.selectionReason,
          updatedByPrincipalId: envelope.principalId,
          updatedByActorSnapshotId: envelope.actorSnapshotId,
          updatedAuthorizationDecisionId: envelope.authorizationDecisionId,
          sourceCommandId: envelope.commandId,
        });
        if (outcome.outcome !== 'OK') {
          return mapWriteOutcome(outcome.outcome, RELEASE_REPRESENTATION_INVALID, {
            frozenCode: RELEASE_PACKAGE_FROZEN,
            aggregateVersion: outcome.aggregateVersion,
          });
        }
        await appendSelectionReferences(execution, selections, envelope.payload.selectionReason);
        const updated = await repo.getReleaseById(execution.trx, row.release_id);
        if (updated === undefined) throw new Error('Release disappeared after selection update');
        return { kind: 'COMMITTED', resultPayload: draftResult(updated) };
      } catch (error) {
        return businessRejection(error);
      }
    },
  );
}

export async function handleSetDestinations(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  envelope: ReleaseCommandEnvelope<SetDestinationsPayload>,
): Promise<CommandResult> {
  commandTarget(envelope);
  const version = expectedVersion(envelope);
  const target = await exactReleaseRow(db, context, envelope);
  const normalizedEnvelope = normalizeEnvelopeProject(envelope, target.project_id ?? undefined);
  return executeReleasePublicationCommand(
    db,
    context,
    normalizedEnvelope,
    async (rawExecution): Promise<CommandBodyResult> => {
      const execution = withTarget(rawExecution, normalizedEnvelope.targetId);
      const row = await repo.getReleaseById(execution.trx, normalizedEnvelope.targetId);
      if (row === undefined)
        return rejected(RELEASE_QUERY_NOT_FOUND, 'the exact Release was not found');
      try {
        const validated = validateDestinations(
          envelope.payload.destinations,
          envelope.payload.recipientScopeSnapshotRef,
          context,
          row.project_id ?? undefined,
        );
        const outcome = await repo.replaceReleaseDestinations(execution.trx, {
          releaseId: row.release_id,
          expectedVersion: version,
          destinations: validated.destinations,
          recipientScopeSnapshotRef: validated.recipientScopeSnapshotRef,
          updatedByPrincipalId: envelope.principalId,
          updatedByActorSnapshotId: envelope.actorSnapshotId,
          updatedAuthorizationDecisionId: envelope.authorizationDecisionId,
          sourceCommandId: envelope.commandId,
        });
        if (outcome.outcome !== 'OK') {
          return mapWriteOutcome(outcome.outcome, RELEASE_DESTINATION_INVALID, {
            frozenCode: RELEASE_PACKAGE_FROZEN,
            aggregateVersion: outcome.aggregateVersion,
          });
        }
        await appendDestinationReferences(
          execution,
          validated.destinations,
          validated.recipientScopeSnapshotRef,
        );
        const updated = await repo.getReleaseById(execution.trx, row.release_id);
        if (updated === undefined) throw new Error('Release disappeared after destination update');
        return { kind: 'COMMITTED', resultPayload: draftResult(updated) };
      } catch (error) {
        return businessRejection(error);
      }
    },
  );
}

export async function handlePrepareRelease(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  envelope: ReleaseCommandEnvelope<PrepareReleasePayload>,
  ports: ReleaseAuthorityQueryPorts,
): Promise<CommandResult> {
  commandTarget(envelope);
  const version = expectedVersion(envelope);
  const target = await exactReleaseRow(db, context, envelope);
  const validatedPackage = validatePackageDefinition(
    envelope.payload.package,
    context,
    target.project_id ?? envelope.projectId,
  );
  const preparationValidationRef = validatePreparationValidationRef(
    envelope.payload.preparationValidationRef,
    context,
    target.project_id ?? validatedPackage.projectId,
  );
  const normalizedEnvelope = normalizeEnvelopeProject(envelope, target.project_id ?? undefined);
  return executeReleasePublicationCommand(
    db,
    context,
    normalizedEnvelope,
    async (rawExecution): Promise<CommandBodyResult> => {
      const execution = withTarget(rawExecution, normalizedEnvelope.targetId);
      const row = await repo.getReleaseById(execution.trx, normalizedEnvelope.targetId);
      if (row === undefined)
        return rejected(RELEASE_QUERY_NOT_FOUND, 'the exact Release was not found');
      try {
        const draft = validateDraftDefinition(
          draftDefinitionForRow(row),
          context,
          row.project_id ?? undefined,
        );
        const releaseRef = releaseRefForRow(row);
        await validateDraftAuthorities(
          draft.definition,
          context,
          ports,
          row.project_id ?? undefined,
        );
        const storedSelections = selectionsForRow(row);
        const storedDestinations = destinationsForRow(row);
        if (row.recipient_scope_snapshot_ref === null) {
          return rejected(RELEASE_DESTINATION_INVALID, 'Release has no frozen Recipient Scope');
        }
        const storedRecipient = parseStoredJson(
          row.recipient_scope_snapshot_ref,
          'Release.recipientScopeSnapshotRef',
        ) as Common.SnapshotRef;
        const packageShape = validatePackageShape(
          validatedPackage.definition,
          releaseRef,
          draft.definition,
          storedSelections,
          storedDestinations,
          storedRecipient,
          context,
          row.project_id ?? undefined,
        );
        const selections = await validateSelections(
          packageShape.representations,
          draft.definition.revisionRef,
          context,
          ports,
          row.project_id ?? undefined,
        );
        const destinations = validateDestinations(
          packageShape.destinations,
          packageShape.recipientScopeSnapshotRef,
          context,
          row.project_id ?? undefined,
        );
        const finalPackage: PackageDefinition = {
          ...packageShape,
          representations: selections,
          destinations: destinations.destinations,
          recipientScopeSnapshotRef: destinations.recipientScopeSnapshotRef,
        };
        const material = buildPackageHashMaterial(finalPackage);
        if (!sameContentHash(material.expectedPackageHash, finalPackage.packageHash)) {
          return rejected(
            RELEASE_PACKAGE_HASH_MISMATCH,
            'packageHash is not the hash of the exact manifest',
          );
        }
        const packageId = newUuidV7();
        const outcome = await repo.prepareRelease(execution.trx, {
          releaseId: row.release_id,
          expectedVersion: version,
          packageId,
          packageHash: contentHashBytes(material.expectedPackageHash),
          packagePayloadHash: contentHashBytes(material.packagePayloadHash),
          packageDefinition: material.normalizedDefinition,
          canonicalManifest: material.manifest,
          preparationValidationRef,
          preparedAt: new Date(finalPackage.preparedAt),
          createdByPrincipalId: envelope.principalId,
          createdByActorSnapshotId: envelope.actorSnapshotId,
          createdAuthorizationDecisionId: envelope.authorizationDecisionId,
          sourceCommandId: envelope.commandId,
        });
        if (outcome.outcome !== 'OK') {
          return mapWriteOutcome(outcome.outcome, RELEASE_PACKAGE_HASH_MISMATCH, {
            frozenCode: RELEASE_PACKAGE_FROZEN,
            multipleHashCode: RELEASE_MULTIPLE_PACKAGE_HASHES,
            aggregateVersion: outcome.aggregateVersion,
          });
        }
        const packageRef = {
          releaseRef,
          packageSnapshotRef: snapshotRefForPackage(
            packageId,
            releaseRef,
            material.expectedPackageHash,
          ),
          packageHash: material.expectedPackageHash,
        } satisfies Common.ReleasePackageRef;
        await appendPackageReferences(
          execution,
          material.normalizedDefinition,
          preparationValidationRef,
        );
        await execution.appendOutbox({
          eventId: newUuidV7(),
          eventType: 'release.ReleasePrepared',
          eventVersion: '1.0',
          aggregateType: RELEASE_OBJECT_TYPE,
          aggregateId: row.release_id,
          aggregateVersion: outcome.aggregateVersion ?? (BigInt(version) + 1n).toString(),
          payload: preparedEventPayload(context, packageRef, material.normalizedDefinition),
          occurredAt: new Date(finalPackage.preparedAt),
        });
        const updated = await repo.getReleaseById(execution.trx, row.release_id);
        if (updated === undefined) throw new Error('Release disappeared after package preparation');
        return { kind: 'COMMITTED', resultPayload: draftResult(updated) };
      } catch (error) {
        return businessRejection(error);
      }
    },
  );
}

export async function handleCancelRelease(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  envelope: ReleaseCommandEnvelope<CancelReleasePayload>,
): Promise<CommandResult> {
  commandTarget(envelope);
  const version = expectedVersion(envelope);
  const target = await exactReleaseRow(db, context, envelope);
  const normalizedEnvelope = normalizeEnvelopeProject(envelope, target.project_id ?? undefined);
  return executeReleasePublicationCommand(
    db,
    context,
    normalizedEnvelope,
    async (rawExecution): Promise<CommandBodyResult> => {
      const execution = withTarget(rawExecution, normalizedEnvelope.targetId);
      const outcome = await repo.cancelRelease(execution.trx, {
        releaseId: normalizedEnvelope.targetId,
        expectedVersion: version,
        cancelReason: envelope.payload.cancelReason,
        cancelledAt: new Date(envelope.payload.cancelledAt),
        updatedByPrincipalId: envelope.principalId,
        updatedByActorSnapshotId: envelope.actorSnapshotId,
        updatedAuthorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      if (outcome.outcome !== 'OK') {
        return mapWriteOutcome(outcome.outcome, RELEASE_CANCEL_NOT_ALLOWED, {
          notAllowedCode: RELEASE_CANCEL_NOT_ALLOWED,
          aggregateVersion: outcome.aggregateVersion,
        });
      }
      const updated = await repo.getReleaseById(execution.trx, normalizedEnvelope.targetId);
      if (updated === undefined) throw new Error('Release disappeared after cancellation');
      return { kind: 'COMMITTED', resultPayload: draftResult(updated) };
    },
  );
}

export async function handleGetRelease(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  payload: GetReleasePayload,
): Promise<ReleasePublication.ReleaseView> {
  const requested = validateReleaseRef(payload.releaseRef, context);
  return withReleasePublicationTransaction(db, context, async (trx) => {
    const row = await repo.getReleaseById(trx, requested.objectId);
    if (row === undefined) {
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'the exact Release was not found',
      );
    }
    if (
      row.enterprise_id !== context.enterpriseId ||
      !sameScope(scopeForRow(row), requested.scope)
    ) {
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'the exact Release was not found',
      );
    }
    try {
      const view = await releaseViewWithFacts(trx, row);
      if (
        view.releaseRef.objectId !== row.release_id ||
        view.releaseRef.objectType !== RELEASE_OBJECT_TYPE
      ) {
        throw new Error('Release query identity mismatch');
      }
      return view;
    } catch (error) {
      if (error instanceof ReleasePublicationBusinessError) throw error;
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'stored Release is invalid',
      );
    }
  });
}

export async function handleGetFrozenPackage(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  payload: GetFrozenPackagePayload,
): Promise<ReleasePublication.FrozenPackageView> {
  const requested = validateReleasePackageRef(payload.packageRef, context);
  return withReleasePublicationTransaction(db, context, async (trx) => {
    const row = await repo.getPackageById(trx, requested.packageSnapshotRef.objectId);
    if (row === undefined) {
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'the exact frozen Package was not found',
      );
    }
    if (
      row.package_id !== requested.packageSnapshotRef.objectId ||
      row.release_id !== requested.releaseRef.objectId ||
      row.enterprise_id !== context.enterpriseId ||
      !sameScope(scopeForRow(row), requested.releaseRef.scope) ||
      !row.package_hash.equals(contentHashBytes(requested.packageHash))
    ) {
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'the exact frozen Package was not found',
      );
    }
    try {
      const definition = parseStoredJson(
        row.package_definition,
        'Package.packageDefinition',
      ) as PackageDefinition;
      const validated = validatePackageDefinition(definition, context, row.project_id ?? undefined);
      const material = buildPackageHashMaterial(validated.definition);
      if (
        !row.package_hash.equals(contentHashBytes(material.expectedPackageHash)) ||
        !row.package_payload_hash.equals(contentHashBytes(material.packagePayloadHash)) ||
        canonicalize(
          parseStoredJson(
            row.canonical_manifest,
            'Package.canonicalManifest',
          ) as CanonicalJsonValue,
        ) !== material.canonicalManifest
      ) {
        throw new Error('frozen Package hash or manifest mismatch');
      }
      const packageRef = {
        releaseRef: requested.releaseRef,
        packageSnapshotRef: snapshotRefForPackage(
          row.package_id,
          requested.releaseRef,
          hashFromBytes(row.package_hash, 'Package.packageHash'),
        ),
        packageHash: hashFromBytes(row.package_hash, 'Package.packageHash'),
      } satisfies Common.ReleasePackageRef;
      return {
        packageRef,
        definition: validated.definition,
        packagePayloadHash: hashFromBytes(row.package_payload_hash, 'Package.packagePayloadHash'),
        frozenAt: row.frozen_at.toISOString(),
      };
    } catch (error) {
      if (error instanceof ReleasePublicationBusinessError) {
        throw new ReleasePublicationBusinessError(
          RELEASE_QUERY_NOT_FOUND,
          'stored frozen Package is invalid',
        );
      }
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'stored frozen Package is invalid',
      );
    }
  });
}

/** Revalidates the frozen Release against the authoritative Readiness Snapshot. */
export async function handleValidateReleaseReadiness(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  envelope: ReleaseCommandEnvelope<ValidateReleaseReadinessPayload>,
  ports: ReleaseAuthorityQueryPorts,
): Promise<CommandResult> {
  exactReleaseTarget(envelope);
  const version = expectedVersion(envelope);
  const target = await exactReleaseRow(db, context, envelope);
  const normalizedEnvelope = normalizeEnvelopeProject(envelope, target.project_id ?? undefined);
  return executeReleasePublicationCommand(
    db,
    context,
    normalizedEnvelope,
    async (rawExecution): Promise<CommandBodyResult> => {
      const execution = withTarget(rawExecution, normalizedEnvelope.targetId);
      try {
        const row = await repo.getReleaseById(execution.trx, normalizedEnvelope.targetId);
        if (row === undefined)
          return rejected(RELEASE_QUERY_NOT_FOUND, 'the exact Release was not found');
        const frozen = await loadFrozenPackageForRelease(execution.trx, row, context);
        const submittedPackage = validateReleasePackageRef(
          envelope.payload.validatedPackageRef,
          context,
        );
        if (
          !sameObjectRef(submittedPackage.releaseRef, frozen.releaseRef) ||
          !samePackageRef(submittedPackage, frozen.packageRef)
        ) {
          return rejected(
            RELEASE_READINESS_INVALID,
            'the readiness command does not target the exact frozen Package',
            row.aggregate_version,
          );
        }
        await revalidateReleaseForAuthorization({
          context,
          ports,
          releaseRef: frozen.releaseRef,
          draftDefinition: draftDefinitionForRow(row),
          packageRef: frozen.packageRef,
          packageDefinition: frozen.definition,
          frozenSelections: frozen.selections,
          frozenDestinations: frozen.destinations,
          frozenRecipientScopeSnapshotRef: frozen.recipientScopeSnapshotRef,
          releaseReadinessSnapshotRef: envelope.payload.releaseReadinessSnapshotRef,
          now: new Date(),
        });
        const outcome = await repo.validateReleaseReadiness(execution.trx, {
          releaseId: row.release_id,
          expectedVersion: version,
          releaseReadinessSnapshotRef: envelope.payload.releaseReadinessSnapshotRef,
          validatedPackageRef: frozen.packageRef,
          validatedAt: new Date(envelope.payload.validatedAt),
          updatedByPrincipalId: envelope.principalId,
          updatedByActorSnapshotId: envelope.actorSnapshotId,
          updatedAuthorizationDecisionId: envelope.authorizationDecisionId,
          sourceCommandId: envelope.commandId,
        });
        if (outcome.outcome !== 'OK') {
          return writeRejection(
            outcome.outcome,
            RELEASE_READINESS_INVALID,
            outcome.aggregateVersion,
          );
        }
        await appendReferenceTarget(
          execution,
          `/readiness/${envelope.commandId}/releaseReadinessSnapshotRef`,
          envelope.payload.releaseReadinessSnapshotRef,
          'RELEASE_READINESS_SNAPSHOT',
        );
        await appendReferenceTarget(
          execution,
          `/readiness/${envelope.commandId}/validatedPackageRef/packageSnapshotRef`,
          frozen.packageRef.packageSnapshotRef,
          'RELEASE_VALIDATED_PACKAGE',
        );
        const updated = await repo.getReleaseById(execution.trx, row.release_id);
        if (updated === undefined)
          throw new Error('Release disappeared after readiness validation');
        return { kind: 'COMMITTED', resultPayload: draftResult(updated) };
      } catch (error) {
        return businessRejection(businessFactError(error));
      }
    },
  );
}

/** Performs the final in-transaction Human authorization and emits its outbox fact. */
export async function handleAuthorizeRelease(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  envelope: ReleaseCommandEnvelope<AuthorizeReleasePayload>,
  ports: ReleaseAuthorityQueryPorts,
): Promise<CommandResult> {
  exactReleaseTarget(envelope);
  const version = expectedVersion(envelope);
  const target = await exactReleaseRow(db, context, envelope);
  const normalizedEnvelope = normalizeEnvelopeProject(envelope, target.project_id ?? undefined);
  return executeReleasePublicationCommand(
    db,
    context,
    normalizedEnvelope,
    async (rawExecution): Promise<CommandBodyResult> => {
      const execution = withTarget(rawExecution, normalizedEnvelope.targetId);
      try {
        const row = await repo.getReleaseById(execution.trx, normalizedEnvelope.targetId);
        if (row === undefined)
          return rejected(RELEASE_QUERY_NOT_FOUND, 'the exact Release was not found');
        const frozen = await loadFrozenPackageForRelease(execution.trx, row, context);
        const now = new Date();
        await validateReleaseAuthorization({
          context,
          ports,
          releaseRef: frozen.releaseRef,
          draftDefinition: draftDefinitionForRow(row),
          packageRef: frozen.packageRef,
          packageDefinition: frozen.definition,
          frozenSelections: frozen.selections,
          frozenDestinations: frozen.destinations,
          frozenRecipientScopeSnapshotRef: frozen.recipientScopeSnapshotRef,
          releaseReadinessSnapshotRef: envelope.payload.releaseReadinessSnapshotRef,
          authorizingHumanRef: envelope.payload.authorizingHumanRef,
          actorSnapshotRef: envelope.payload.actorSnapshotRef,
          authorizationDecisionRef: envelope.payload.authorizationDecisionRef,
          expectedCommandPayloadHash: hashFromBytes(
            digestCanonicalPayload(envelope.requestPayload).hash,
            'authorize command payload',
          ),
          expectedCommandType: envelope.commandType,
          expectedCommandVersion: envelope.commandVersion,
          expectedPurpose: 'release.publication.authorize_release',
          now,
        });
        const authorizationRef = authorizationRefForCommand(
          envelope,
          frozen.releaseRef,
          frozen.packageRef,
          envelope.payload,
        );
        const outcome = await repo.authorizeRelease(execution.trx, {
          releaseId: row.release_id,
          expectedVersion: version,
          releaseReadinessSnapshotRef: envelope.payload.releaseReadinessSnapshotRef,
          authorizingHumanRef: envelope.payload.authorizingHumanRef,
          actorSnapshotRef: envelope.payload.actorSnapshotRef,
          authorizationDecisionRef: envelope.payload.authorizationDecisionRef,
          authorizationRef,
          authorizedAt: new Date(envelope.payload.authorizedAt),
          updatedByPrincipalId: envelope.principalId,
          updatedByActorSnapshotId: envelope.actorSnapshotId,
          updatedAuthorizationDecisionId: envelope.authorizationDecisionId,
          sourceCommandId: envelope.commandId,
        });
        if (outcome.outcome !== 'OK') {
          return writeRejection(
            outcome.outcome,
            RELEASE_AUTHORIZATION_INVALID,
            outcome.aggregateVersion,
          );
        }
        await appendReferenceTarget(
          execution,
          `/authorization/${authorizationRef.objectId}/releaseReadinessSnapshotRef`,
          envelope.payload.releaseReadinessSnapshotRef,
          'RELEASE_READINESS_SNAPSHOT',
        );
        await appendReferenceTarget(
          execution,
          `/authorization/${authorizationRef.objectId}/actorSnapshotRef`,
          envelope.payload.actorSnapshotRef,
          'RELEASE_AUTHORIZATION_ACTOR_SNAPSHOT',
        );
        await appendReferenceTarget(
          execution,
          `/authorization/${authorizationRef.objectId}/authorizationDecisionRef`,
          envelope.payload.authorizationDecisionRef,
          'RELEASE_AUTHORIZATION_DECISION',
        );
        await appendReferenceTarget(
          execution,
          `/authorization/${authorizationRef.objectId}/authorizationRef`,
          authorizationRef,
          'RELEASE_AUTHORIZATION',
        );
        await appendReleaseEvent(
          execution,
          context,
          normalizedEnvelope,
          'release.ReleaseAuthorized',
          outcome.aggregateVersion ?? (BigInt(version) + 1n).toString(),
          {
            releaseRef: asCanonical(frozen.releaseRef),
            packageRef: asCanonical(frozen.packageRef),
            releaseReadinessSnapshotRef: asCanonical(envelope.payload.releaseReadinessSnapshotRef),
            authorizationRef: asCanonical(authorizationRef),
            authorizedAt: envelope.payload.authorizedAt,
          },
          new Date(envelope.payload.authorizedAt),
        );
        const updated = await repo.getReleaseById(execution.trx, row.release_id);
        if (updated === undefined) throw new Error('Release disappeared after authorization');
        return { kind: 'COMMITTED', resultPayload: draftResult(updated) };
      } catch (error) {
        return businessRejection(businessFactError(error));
      }
    },
  );
}

/** Registers one immutable publication Attempt before any external delivery call. */
export async function handleStartPublicationAttempt(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  envelope: ReleaseCommandEnvelope<StartPublicationAttemptPayload>,
): Promise<CommandResult> {
  exactReleaseTarget(envelope);
  const version = expectedVersion(envelope);
  const target = await exactReleaseRow(db, context, envelope);
  const normalizedEnvelope = normalizeEnvelopeProject(envelope, target.project_id ?? undefined);
  return executeReleasePublicationCommand(
    db,
    context,
    normalizedEnvelope,
    async (rawExecution): Promise<CommandBodyResult> => {
      const execution = withTarget(rawExecution, normalizedEnvelope.targetId);
      try {
        const row = await repo.getReleaseById(execution.trx, normalizedEnvelope.targetId);
        if (row === undefined)
          return rejected(RELEASE_QUERY_NOT_FOUND, 'the exact Release was not found');
        const frozen = await loadFrozenPackageForRelease(execution.trx, row, context);
        const attempt = validatedAttemptDefinition(
          envelope.payload.attempt,
          frozen.releaseRef,
          frozen.packageRef,
          frozen.destinations,
          context,
        );
        if (
          attempt.externalDeliveryRequestRef.objectType !==
            'integration.external_delivery_request' ||
          !sameScope(attempt.externalDeliveryRequestRef.scope, frozen.releaseRef.scope)
        ) {
          throw new ReleasePublicationBusinessError(
            RELEASE_RECEIPT_TARGET_MISMATCH,
            'ExternalDeliveryRequest must use the exact Release scope and object type',
          );
        }
        const attemptRef: Common.ObjectRef = {
          kind: 'OBJECT',
          objectType: 'release.publication_attempt',
          objectId: envelope.commandId,
          scope: frozen.releaseRef.scope,
        };
        const observationPayload = asCanonicalObject({
          attemptRef: { objectId: attemptRef.objectId },
          stableIdempotencyKey: attempt.stableIdempotencyKey,
        });
        const outcome = await repo.insertPublicationAttempt(execution.trx, {
          attemptId: attemptRef.objectId,
          releaseId: row.release_id,
          packageId: frozen.packageRef.packageSnapshotRef.objectId,
          destinationId: attempt.destinationId,
          attemptNumber: attempt.attemptNumber,
          stableIdempotencyKey: attempt.stableIdempotencyKey,
          definition: attempt,
          requestedAt: new Date(attempt.requestedAt),
          externalDeliveryRequestRef: attempt.externalDeliveryRequestRef,
          observationPayloadHash: digestCanonicalPayload(observationPayload).hash,
          createdByPrincipalId: envelope.principalId,
          createdByActorSnapshotId: envelope.actorSnapshotId,
          createdAuthorizationDecisionId: envelope.authorizationDecisionId,
          sourceCommandId: envelope.commandId,
        });
        if (outcome.outcome === 'DUPLICATE') {
          const current = await repo.getReleaseById(execution.trx, row.release_id);
          if (current === undefined) throw new Error('Release disappeared after duplicate Attempt');
          return {
            kind: 'COMMITTED',
            resultPayload: asCanonicalObject(await releaseViewWithFacts(execution.trx, current)),
          };
        }
        if (outcome.outcome !== 'OK') {
          return writeRejection(
            outcome.outcome,
            RELEASE_RECEIPT_TARGET_MISMATCH,
            outcome.aggregateVersion,
          );
        }
        await appendReferenceTarget(
          execution,
          `/attempts/${attemptRef.objectId}/packageSnapshotRef`,
          frozen.packageRef.packageSnapshotRef,
          'RELEASE_ATTEMPT_PACKAGE',
        );
        await appendReferenceTarget(
          execution,
          `/attempts/${attemptRef.objectId}/externalDeliveryRequestRef`,
          attempt.externalDeliveryRequestRef,
          'RELEASE_EXTERNAL_DELIVERY_REQUEST',
        );
        await appendReleaseEvent(
          execution,
          context,
          normalizedEnvelope,
          'release.PublicationAttemptRequested',
          outcome.aggregateVersion ?? (BigInt(version) + 1n).toString(),
          {
            releaseRef: asCanonical(frozen.releaseRef),
            packageRef: asCanonical(frozen.packageRef),
            attemptRef: asCanonical(attemptRef),
            destinationId: attempt.destinationId,
            externalDeliveryRequestRef: asCanonical(attempt.externalDeliveryRequestRef),
          },
          new Date(attempt.requestedAt),
        );
        const updated = await repo.getReleaseById(execution.trx, row.release_id);
        if (updated === undefined)
          throw new Error('Release disappeared after Attempt registration');
        return {
          kind: 'COMMITTED',
          resultPayload: asCanonicalObject(await releaseViewWithFacts(execution.trx, updated)),
        };
      } catch (error) {
        return businessRejection(businessFactError(error));
      }
    },
  );
}

/** Promotes one authoritative successful RawExternalReceipt into a Formal Receipt. */
export async function handleRecordPublicationReceipt(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  envelope: ReleaseCommandEnvelope<RecordPublicationReceiptPayload>,
  ports: ReleaseAuthorityQueryPorts,
  options: ReleasePublicationHandlerOptions = {},
): Promise<CommandResult> {
  exactReleaseTarget(envelope);
  const version = expectedVersion(envelope);
  const target = await exactReleaseRow(db, context, envelope);
  const normalizedEnvelope = normalizeEnvelopeProject(envelope, target.project_id ?? undefined);
  return executeReleasePublicationCommand(
    db,
    context,
    normalizedEnvelope,
    async (rawExecution): Promise<CommandBodyResult> => {
      const execution = withTarget(rawExecution, normalizedEnvelope.targetId);
      try {
        const row = await repo.getReleaseById(execution.trx, normalizedEnvelope.targetId);
        if (row === undefined)
          return rejected(RELEASE_QUERY_NOT_FOUND, 'the exact Release was not found');
        const frozen = await loadFrozenPackageForRelease(execution.trx, row, context);
        const submitted = envelope.payload.receipt;
        const submittedPackage = validateReleasePackageRef(submitted.packageRef, context);
        if (
          !sameObjectRef(submittedPackage.releaseRef, frozen.releaseRef) ||
          !samePackageRef(submittedPackage, frozen.packageRef)
        ) {
          throw new ReleasePublicationBusinessError(
            RELEASE_RECEIPT_TARGET_MISMATCH,
            'Formal Receipt does not target the exact frozen Package',
          );
        }
        const attempt = (await repo.getPublicationAttempts(execution.trx, row.release_id)).find(
          (candidate) => candidate.attempt_id === submitted.attemptRef.objectId,
        );
        if (attempt === undefined) {
          throw new ReleasePublicationBusinessError(
            RELEASE_RECEIPT_TARGET_MISMATCH,
            'Formal Receipt references an unregistered PublicationAttempt',
          );
        }
        exactAttemptRefForPayload(attempt, frozen.releaseRef, submitted.attemptRef);
        if (attempt.destination_id !== submitted.destinationId) {
          throw new ReleasePublicationBusinessError(
            RELEASE_RECEIPT_TARGET_MISMATCH,
            'Formal Receipt destination does not match the registered Attempt',
          );
        }
        const sanitized = sanitizeProviderResult(submitted.providerResult);
        const normalizedSubmission: ReleasePublication.FormalReceiptSubmission = {
          ...submitted,
          providerResult: sanitized.value,
        };
        const receiptRef = factRefForCommand(
          'release.publication_receipt',
          envelope,
          asCanonicalObject(normalizedSubmission),
          frozen.releaseRef.scope,
        );
        const validatedSubmission = normalizeReceiptWithRuntimeValidator(
          attempt,
          frozen.releaseRef,
          normalizedSubmission,
          receiptRef,
          ports,
          timeoutForDestination(options, submitted.destinationId),
          envelope.correlationId,
        );
        const observationPayload = asCanonicalObject({
          formalReceiptRef: receiptRef,
          providerResult: validatedSubmission.providerResult,
        });
        const outcome = await repo.recordPublicationReceipt(execution.trx, {
          receiptId: receiptRef.objectId,
          attemptId: attempt.attempt_id,
          releaseId: row.release_id,
          packageId: frozen.packageRef.packageSnapshotRef.objectId,
          destinationId: validatedSubmission.destinationId,
          rawReceiptRef: validatedSubmission.rawReceiptRef,
          formalReceiptRef: receiptRef,
          providerResult: validatedSubmission.providerResult,
          receiptPayloadHash: contentHashBytes(validatedSubmission.receiptPayloadHash),
          observationPayloadHash: digestCanonicalPayload(observationPayload).hash,
          occurredAt: new Date(validatedSubmission.occurredAt),
          createdByPrincipalId: envelope.principalId,
          createdByActorSnapshotId: envelope.actorSnapshotId,
          createdAuthorizationDecisionId: envelope.authorizationDecisionId,
          sourceCommandId: envelope.commandId,
        });
        if (outcome.outcome === 'DUPLICATE') {
          const current = await repo.getReleaseById(execution.trx, row.release_id);
          if (current === undefined) throw new Error('Release disappeared after duplicate Receipt');
          return {
            kind: 'COMMITTED',
            resultPayload: asCanonicalObject(await releaseViewWithFacts(execution.trx, current)),
          };
        }
        if (outcome.outcome !== 'OK') {
          return writeRejection(
            outcome.outcome,
            RELEASE_RECEIPT_TARGET_MISMATCH,
            outcome.aggregateVersion,
          );
        }
        await appendReferenceTarget(
          execution,
          `/receipts/${receiptRef.objectId}/attemptRef`,
          submitted.attemptRef,
          'RELEASE_RECEIPT_ATTEMPT',
        );
        await appendReferenceTarget(
          execution,
          `/receipts/${receiptRef.objectId}/packageSnapshotRef`,
          frozen.packageRef.packageSnapshotRef,
          'RELEASE_RECEIPT_PACKAGE',
        );
        await appendReferenceTarget(
          execution,
          `/receipts/${receiptRef.objectId}/rawReceiptRef`,
          validatedSubmission.rawReceiptRef,
          'RELEASE_RAW_EXTERNAL_RECEIPT',
        );
        await appendReferenceTarget(
          execution,
          `/receipts/${receiptRef.objectId}/formalReceiptRef`,
          receiptRef,
          'RELEASE_FORMAL_RECEIPT',
        );
        await appendReleaseEvent(
          execution,
          context,
          normalizedEnvelope,
          'release.PublicationSucceeded',
          outcome.aggregateVersion ?? (BigInt(version) + 1n).toString(),
          {
            releaseRef: asCanonical(frozen.releaseRef),
            packageRef: asCanonical(frozen.packageRef),
            attemptRef: asCanonical(submitted.attemptRef),
            destinationId: validatedSubmission.destinationId,
            receiptRef: asCanonical(receiptRef),
            occurredAt: validatedSubmission.occurredAt,
          },
          new Date(validatedSubmission.occurredAt),
        );
        const updated = await repo.getReleaseById(execution.trx, row.release_id);
        if (updated === undefined) throw new Error('Release disappeared after Receipt recording');
        return {
          kind: 'COMMITTED',
          resultPayload: asCanonicalObject(await releaseViewWithFacts(execution.trx, updated)),
        };
      } catch (error) {
        return businessRejection(businessFactError(error));
      }
    },
  );
}

/** Appends a FAILED/UNKNOWN provider outcome without deleting prior success history. */
export async function handleRecordPublicationFailure(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  envelope: ReleaseCommandEnvelope<RecordPublicationFailurePayload>,
): Promise<CommandResult> {
  exactReleaseTarget(envelope);
  const version = expectedVersion(envelope);
  const target = await exactReleaseRow(db, context, envelope);
  const normalizedEnvelope = normalizeEnvelopeProject(envelope, target.project_id ?? undefined);
  return executeReleasePublicationCommand(
    db,
    context,
    normalizedEnvelope,
    async (rawExecution): Promise<CommandBodyResult> => {
      const execution = withTarget(rawExecution, normalizedEnvelope.targetId);
      try {
        const row = await repo.getReleaseById(execution.trx, normalizedEnvelope.targetId);
        if (row === undefined)
          return rejected(RELEASE_QUERY_NOT_FOUND, 'the exact Release was not found');
        const frozen = await loadFrozenPackageForRelease(execution.trx, row, context);
        const submitted = envelope.payload.failure;
        const submittedPackage = validateReleasePackageRef(submitted.packageRef, context);
        if (
          !sameObjectRef(submittedPackage.releaseRef, frozen.releaseRef) ||
          !samePackageRef(submittedPackage, frozen.packageRef)
        ) {
          throw new ReleasePublicationBusinessError(
            RELEASE_RECEIPT_TARGET_MISMATCH,
            'Publication Failure does not target the exact frozen Package',
          );
        }
        const attempt = (await repo.getPublicationAttempts(execution.trx, row.release_id)).find(
          (candidate) => candidate.attempt_id === submitted.attemptRef.objectId,
        );
        if (attempt === undefined) {
          throw new ReleasePublicationBusinessError(
            RELEASE_RECEIPT_TARGET_MISMATCH,
            'Publication Failure references an unregistered PublicationAttempt',
          );
        }
        exactAttemptRefForPayload(attempt, frozen.releaseRef, submitted.attemptRef);
        if (attempt.destination_id !== submitted.destinationId) {
          throw new ReleasePublicationBusinessError(
            RELEASE_RECEIPT_TARGET_MISMATCH,
            'Publication Failure destination does not match the registered Attempt',
          );
        }
        const failureRef = factRefForCommand(
          'release.publication_failure',
          envelope,
          asCanonicalObject(submitted),
          frozen.releaseRef.scope,
        );
        const observationPayload = asCanonicalObject({
          failureRef,
          classification: submitted.classification,
        });
        const outcome = await repo.recordPublicationFailure(execution.trx, {
          failureId: failureRef.objectId,
          failureRef,
          attemptId: attempt.attempt_id,
          releaseId: row.release_id,
          packageId: frozen.packageRef.packageSnapshotRef.objectId,
          destinationId: submitted.destinationId,
          classification: submitted.classification,
          retryable: submitted.retryable,
          outcome: submitted.outcome,
          ...(submitted.providerRef === undefined ? {} : { providerRef: submitted.providerRef }),
          ...(submitted.diagnosticRef === undefined
            ? {}
            : { diagnosticRef: submitted.diagnosticRef }),
          observationPayloadHash: digestCanonicalPayload(observationPayload).hash,
          occurredAt: new Date(submitted.occurredAt),
          createdByPrincipalId: envelope.principalId,
          createdByActorSnapshotId: envelope.actorSnapshotId,
          createdAuthorizationDecisionId: envelope.authorizationDecisionId,
          sourceCommandId: envelope.commandId,
        });
        if (outcome.outcome === 'DUPLICATE') {
          const current = await repo.getReleaseById(execution.trx, row.release_id);
          if (current === undefined) throw new Error('Release disappeared after duplicate Failure');
          return {
            kind: 'COMMITTED',
            resultPayload: asCanonicalObject(await releaseViewWithFacts(execution.trx, current)),
          };
        }
        if (outcome.outcome !== 'OK') {
          return writeRejection(
            outcome.outcome,
            RELEASE_RECEIPT_TARGET_MISMATCH,
            outcome.aggregateVersion,
          );
        }
        await appendReferenceTarget(
          execution,
          `/failures/${failureRef.objectId}/attemptRef`,
          submitted.attemptRef,
          'RELEASE_FAILURE_ATTEMPT',
        );
        await appendReferenceTarget(
          execution,
          `/failures/${failureRef.objectId}/packageSnapshotRef`,
          frozen.packageRef.packageSnapshotRef,
          'RELEASE_FAILURE_PACKAGE',
        );
        await appendReferenceTarget(
          execution,
          `/failures/${failureRef.objectId}/failureRef`,
          failureRef,
          'RELEASE_PUBLICATION_FAILURE',
        );
        await appendReleaseEvent(
          execution,
          context,
          normalizedEnvelope,
          'release.PublicationFailed',
          outcome.aggregateVersion ?? (BigInt(version) + 1n).toString(),
          {
            releaseRef: asCanonical(frozen.releaseRef),
            packageRef: asCanonical(frozen.packageRef),
            attemptRef: asCanonical(submitted.attemptRef),
            destinationId: submitted.destinationId,
            outcome: submitted.outcome,
            failureRef: asCanonical(failureRef),
          },
          new Date(submitted.occurredAt),
        );
        const updated = await repo.getReleaseById(execution.trx, row.release_id);
        if (updated === undefined) throw new Error('Release disappeared after Failure recording');
        return {
          kind: 'COMMITTED',
          resultPayload: asCanonicalObject(await releaseViewWithFacts(execution.trx, updated)),
        };
      } catch (error) {
        return businessRejection(businessFactError(error));
      }
    },
  );
}

/** Evaluates destination outcomes from persisted facts and records the aggregate result. */
export async function handleCompleteRelease(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  envelope: ReleaseCommandEnvelope<CompleteReleasePayload>,
): Promise<CommandResult> {
  exactReleaseTarget(envelope);
  const version = expectedVersion(envelope);
  const target = await exactReleaseRow(db, context, envelope);
  const normalizedEnvelope = normalizeEnvelopeProject(envelope, target.project_id ?? undefined);
  return executeReleasePublicationCommand(
    db,
    context,
    normalizedEnvelope,
    async (rawExecution): Promise<CommandBodyResult> => {
      const execution = withTarget(rawExecution, normalizedEnvelope.targetId);
      try {
        const row = await repo.getReleaseById(execution.trx, normalizedEnvelope.targetId);
        if (row === undefined)
          return rejected(RELEASE_QUERY_NOT_FOUND, 'the exact Release was not found');
        const frozen = await loadFrozenPackageForRelease(execution.trx, row, context);
        const attempts = await repo.getPublicationAttempts(execution.trx, row.release_id);
        const latestByDestination = latestAttemptByDestination(attempts);
        const seenDestinations = new Set<string>();
        for (const outcomeRef of envelope.payload.destinationOutcomeRefs) {
          const matched = [...latestByDestination.values()].find((attempt) =>
            typedReferenceMatchesStoredOutcome(attempt, outcomeRef),
          );
          if (matched === undefined) {
            throw new ReleasePublicationBusinessError(
              RELEASE_REQUIRED_RECEIPT_MISSING,
              'completion evidence does not identify an exact current Receipt or Failure fact',
            );
          }
          if (seenDestinations.has(matched.destination_id)) {
            throw new ReleasePublicationBusinessError(
              RELEASE_COMPLETION_CRITERIA_UNSATISFIED,
              'completion evidence contains more than one outcome for a Destination',
            );
          }
          seenDestinations.add(matched.destination_id);
        }
        const outcome = await repo.completeRelease(execution.trx, {
          releaseId: row.release_id,
          expectedVersion: version,
          completionPolicyRef: envelope.payload.completionPolicyRef,
          destinationOutcomeRefs: envelope.payload.destinationOutcomeRefs,
          evaluatedAt: new Date(envelope.payload.evaluatedAt),
          updatedByPrincipalId: envelope.principalId,
          updatedByActorSnapshotId: envelope.actorSnapshotId,
          updatedAuthorizationDecisionId: envelope.authorizationDecisionId,
          sourceCommandId: envelope.commandId,
        });
        if (outcome.outcome !== 'OK') {
          return writeRejection(
            outcome.outcome,
            RELEASE_COMPLETION_CRITERIA_UNSATISFIED,
            outcome.aggregateVersion,
          );
        }
        await appendReferenceTarget(
          execution,
          `/completions/${envelope.commandId}/completionPolicyRef`,
          envelope.payload.completionPolicyRef,
          'RELEASE_COMPLETION_POLICY',
        );
        for (const [index, outcomeRef] of envelope.payload.destinationOutcomeRefs.entries()) {
          await appendReferenceTarget(
            execution,
            `/completions/${envelope.commandId}/destinationOutcomeRefs/${index}`,
            outcomeRef,
            'RELEASE_DESTINATION_OUTCOME',
          );
        }
        const receiptRows = await repo.getPublicationReceipts(execution.trx, row.release_id);
        const receiptRefs = receiptRows.map(
          (receipt) =>
            parseStoredJson(
              receipt.formal_receipt_ref,
              'PublicationReceipt.formalReceiptRef',
            ) as Common.ContentAddressedRef,
        );
        const succeededDestinationIds = [
          ...new Set(receiptRows.map((receipt) => receipt.destination_id)),
        ];
        const pendingOrFailedDestinationIds = frozen.destinations
          .map((destination) => destination.destinationId)
          .filter((destinationId) => !succeededDestinationIds.includes(destinationId));
        const aggregateVersion = outcome.aggregateVersion ?? (BigInt(version) + 1n).toString();
        if (outcome.status === 'RELEASED') {
          await appendReleaseEvent(
            execution,
            context,
            normalizedEnvelope,
            'release.ReleaseCompleted',
            aggregateVersion,
            {
              releaseRef: asCanonical(frozen.releaseRef),
              packageRef: asCanonical(frozen.packageRef),
              purpose: row.purpose,
              revisionRef: asCanonical(draftDefinitionForRow(row).revisionRef),
              receiptRefs: asCanonical(receiptRefs),
              completedAt: envelope.payload.evaluatedAt,
            },
            new Date(envelope.payload.evaluatedAt),
          );
        } else if (outcome.status === 'PARTIALLY_RELEASED') {
          await appendReleaseEvent(
            execution,
            context,
            normalizedEnvelope,
            'release.ReleasePartiallyCompleted',
            aggregateVersion,
            {
              releaseRef: asCanonical(frozen.releaseRef),
              packageRef: asCanonical(frozen.packageRef),
              succeededDestinationIds: asCanonical(succeededDestinationIds),
              pendingOrFailedDestinationIds: asCanonical(pendingOrFailedDestinationIds),
              evaluatedAt: envelope.payload.evaluatedAt,
            },
            new Date(envelope.payload.evaluatedAt),
          );
        }
        const updated = await repo.getReleaseById(execution.trx, row.release_id);
        if (updated === undefined)
          throw new Error('Release disappeared after completion evaluation');
        return {
          kind: 'COMMITTED',
          resultPayload: asCanonicalObject(await releaseViewWithFacts(execution.trx, updated)),
        };
      } catch (error) {
        return businessRejection(businessFactError(error));
      }
    },
  );
}

/** Records an append-only Recall and ImpactReview after rechecking Human authority. */
export async function handleRecallRelease(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  envelope: ReleaseCommandEnvelope<RecallReleasePayload>,
  ports: ReleaseAuthorityQueryPorts,
): Promise<CommandResult> {
  exactReleaseTarget(envelope);
  const version = expectedVersion(envelope);
  const target = await exactReleaseRow(db, context, envelope);
  const normalizedEnvelope = normalizeEnvelopeProject(envelope, target.project_id ?? undefined);
  return executeReleasePublicationCommand(
    db,
    context,
    normalizedEnvelope,
    async (rawExecution): Promise<CommandBodyResult> => {
      const execution = withTarget(rawExecution, normalizedEnvelope.targetId);
      try {
        const row = await repo.getReleaseById(execution.trx, normalizedEnvelope.targetId);
        if (row === undefined)
          return rejected(RELEASE_QUERY_NOT_FOUND, 'the exact Release was not found');
        const frozen = await loadFrozenPackageForRelease(execution.trx, row, context);
        const now = new Date();
        await validateHumanAuthorizationChain({
          context,
          ports,
          releaseRef: frozen.releaseRef,
          authorizingHumanRef: envelope.payload.authorizingHumanRef,
          // Recall binds to the current Decision's ActorSnapshot; the Release row is history only.
          authorizationDecisionRef: envelope.payload.authorizationDecisionRef,
          expectedCommandPayloadHash: hashFromBytes(
            digestCanonicalPayload(envelope.requestPayload).hash,
            'recall command payload',
          ),
          expectedCommandType: 'release.recall_release',
          expectedCommandVersion: envelope.commandVersion,
          expectedPurpose: 'release.publication.recall_release',
          now,
        });
        const affectedDestinationIds = affectedDestinationIdsForRecall(
          envelope.payload.recallScope,
          frozen.destinations,
        );
        if (
          affectedDestinationIds.length === 0 ||
          affectedDestinationIds.some(
            (destinationId) =>
              !isUuidV7(destinationId) ||
              !frozen.destinations.some(
                (destination) => destination.destinationId === destinationId,
              ),
          )
        ) {
          throw new ReleasePublicationBusinessError(
            RELEASE_RECALL_NOT_AUTHORIZED,
            'Recall affected destinations must belong to the exact frozen Release',
          );
        }
        const recallFactPayload = asCanonicalObject({
          recallScope: asCanonical(envelope.payload.recallScope),
          recallReason: asCanonical(envelope.payload.recallReason),
          authorizingHumanRef: asCanonical(envelope.payload.authorizingHumanRef),
          authorizationDecisionRef: asCanonical(envelope.payload.authorizationDecisionRef),
          notificationPolicyRef: asCanonical(envelope.payload.notificationPolicyRef),
          affectedDestinationIds: asCanonical(affectedDestinationIds),
          recalledAt: envelope.payload.recalledAt,
        });
        const recallRef = factRefForCommand(
          'release.recall',
          envelope,
          recallFactPayload,
          frozen.releaseRef.scope,
        );
        const outcome = await repo.recallRelease(execution.trx, {
          recallId: recallRef.objectId,
          recallRef,
          releaseId: row.release_id,
          packageId: frozen.packageRef.packageSnapshotRef.objectId,
          recallScope: envelope.payload.recallScope,
          recallReason: envelope.payload.recallReason,
          authorizingHumanRef: envelope.payload.authorizingHumanRef,
          authorizationDecisionRef: envelope.payload.authorizationDecisionRef,
          notificationPolicyRef: envelope.payload.notificationPolicyRef,
          affectedDestinations: affectedDestinationIds,
          recalledAt: new Date(envelope.payload.recalledAt),
          payloadHash: contentHashBytes(recallRef.contentHash),
          updatedByPrincipalId: envelope.principalId,
          updatedByActorSnapshotId: envelope.actorSnapshotId,
          updatedAuthorizationDecisionId: envelope.authorizationDecisionId,
          sourceCommandId: envelope.commandId,
        });
        if (outcome.outcome === 'DUPLICATE') {
          const current = await repo.getReleaseById(execution.trx, row.release_id);
          if (current === undefined) throw new Error('Release disappeared after duplicate Recall');
          return {
            kind: 'COMMITTED',
            resultPayload: asCanonicalObject(await releaseViewWithFacts(execution.trx, current)),
          };
        }
        if (outcome.outcome !== 'OK') {
          return writeRejection(
            outcome.outcome,
            RELEASE_RECALL_NOT_AUTHORIZED,
            outcome.aggregateVersion,
          );
        }
        await appendReferenceTarget(
          execution,
          `/recalls/${recallRef.objectId}/packageSnapshotRef`,
          frozen.packageRef.packageSnapshotRef,
          'RELEASE_RECALL_PACKAGE',
        );
        await appendReferenceTarget(
          execution,
          `/recalls/${recallRef.objectId}/authorizationDecisionRef`,
          envelope.payload.authorizationDecisionRef,
          'RELEASE_RECALL_AUTHORIZATION_DECISION',
        );
        await appendReferenceTarget(
          execution,
          `/recalls/${recallRef.objectId}/notificationPolicyRef`,
          envelope.payload.notificationPolicyRef,
          'RELEASE_RECALL_NOTIFICATION_POLICY',
        );
        await appendReferenceTarget(
          execution,
          `/recalls/${recallRef.objectId}/recallRef`,
          recallRef,
          'RELEASE_RECALL',
        );
        for (const [index, evidence] of envelope.payload.recallReason.evidenceRefs.entries()) {
          await appendReferenceTarget(
            execution,
            `/recalls/${recallRef.objectId}/recallReason/evidenceRefs/${index}/evidence`,
            evidence.evidence,
            'RELEASE_RECALL_EVIDENCE',
          );
        }
        if (envelope.payload.recallReason.policyRef !== undefined) {
          await appendReferenceTarget(
            execution,
            `/recalls/${recallRef.objectId}/recallReason/policyRef`,
            envelope.payload.recallReason.policyRef,
            'RELEASE_RECALL_REASON_POLICY',
          );
        }
        await appendReleaseEvent(
          execution,
          context,
          normalizedEnvelope,
          'release.ReleaseRecalled',
          outcome.aggregateVersion ?? (BigInt(version) + 1n).toString(),
          {
            releaseRef: asCanonical(frozen.releaseRef),
            packageRef: asCanonical(frozen.packageRef),
            recallRef: asCanonical(recallRef),
            affectedDestinationIds: asCanonical(affectedDestinationIds),
            recalledAt: envelope.payload.recalledAt,
          },
          new Date(envelope.payload.recalledAt),
        );
        const updated = await repo.getReleaseById(execution.trx, row.release_id);
        if (updated === undefined) throw new Error('Release disappeared after Recall');
        return {
          kind: 'COMMITTED',
          resultPayload: asCanonicalObject(await releaseViewWithFacts(execution.trx, updated)),
        };
      } catch (error) {
        return businessRejection(businessFactError(error));
      }
    },
  );
}

export async function handleGetPublicationAttempts(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  payload: GetPublicationAttemptsPayload,
): Promise<ReleasePublication.PublicationAttemptPage> {
  const releaseRef = validateReleaseRef(payload.releaseRef, context);
  const pageSize = checkedPageSize(payload.page.pageSize);
  const destinationIds = new Set(payload.destinationIds);
  const outcomes = new Set(payload.outcomes);
  return withReleasePublicationTransaction(db, context, async (trx) => {
    const row = await repo.getReleaseById(trx, releaseRef.objectId);
    if (row === undefined) {
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'the exact Release was not found',
      );
    }
    if (
      row.enterprise_id !== context.enterpriseId ||
      !sameScope(scopeForRow(row), releaseRef.scope)
    ) {
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'the exact Release was not found',
      );
    }
    const attempts = (await repo.getPublicationAttempts(trx, row.release_id)).filter(
      (attempt) =>
        (destinationIds.size === 0 || destinationIds.has(attempt.destination_id)) &&
        (outcomes.size === 0 || outcomes.has(attempt.outcome)),
    );
    const offset = decodeOffset(payload.page.cursor);
    const page = attempts.slice(offset, offset + pageSize);
    const nextOffset = offset + page.length;
    const snapshotAt = new Date().toISOString();
    const nextCursor = nextOffset < attempts.length ? encodeOffset(nextOffset) : undefined;
    return {
      items: page.map((attempt) => publicationAttemptViewForRow(attempt, releaseRef)),
      ...(nextCursor === undefined ? {} : { nextCursor }),
      snapshotAt,
      sourceWatermarks: [
        {
          sourceModule: 'release-publication',
          ...(releaseRef.scope.projectId === undefined
            ? {}
            : { partition: releaseRef.scope.projectId }),
          sequence: attempts.length,
          observedAt: snapshotAt,
        },
      ],
    };
  });
}

export async function handleGetReleaseReceipts(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  payload: GetReleaseReceiptsPayload,
): Promise<ReleasePublication.PublicationReceiptPage> {
  const releaseRef = validateReleaseRef(payload.releaseRef, context);
  const pageSize = checkedPageSize(payload.page.pageSize);
  const destinationIds = new Set(payload.destinationIds);
  return withReleasePublicationTransaction(db, context, async (trx) => {
    const row = await repo.getReleaseById(trx, releaseRef.objectId);
    if (row === undefined) {
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'the exact Release was not found',
      );
    }
    if (
      row.enterprise_id !== context.enterpriseId ||
      !sameScope(scopeForRow(row), releaseRef.scope)
    ) {
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'the exact Release was not found',
      );
    }
    const frozen = row.package_id === null ? undefined : packageRefForPersistenceRow(row, context);
    if (payload.packageRef !== undefined) {
      const requestedPackage = validateReleasePackageRef(payload.packageRef, context);
      if (
        frozen === undefined ||
        !sameObjectRef(requestedPackage.releaseRef, releaseRef) ||
        !samePackageRef(requestedPackage, frozen)
      ) {
        throw new ReleasePublicationBusinessError(
          RELEASE_QUERY_NOT_FOUND,
          'the exact frozen Package was not found',
        );
      }
    }
    const receipts = (await repo.getPublicationReceipts(trx, row.release_id)).filter(
      (receipt) => destinationIds.size === 0 || destinationIds.has(receipt.destination_id),
    );
    const offset = decodeOffset(payload.page.cursor);
    const page = receipts.slice(offset, offset + pageSize);
    const nextOffset = offset + page.length;
    const snapshotAt = new Date().toISOString();
    const nextCursor = nextOffset < receipts.length ? encodeOffset(nextOffset) : undefined;
    return {
      items: page.map(
        (receipt) =>
          parseStoredJson(
            receipt.formal_receipt_ref,
            'PublicationReceipt.formalReceiptRef',
          ) as Common.ContentAddressedRef,
      ),
      ...(nextCursor === undefined ? {} : { nextCursor }),
      snapshotAt,
      sourceWatermarks: [
        {
          sourceModule: 'release-publication',
          ...(releaseRef.scope.projectId === undefined
            ? {}
            : { partition: releaseRef.scope.projectId }),
          sequence: receipts.length,
          observedAt: snapshotAt,
        },
      ],
    };
  });
}

export async function handleGetReleaseImpact(
  db: Kysely<ReleasePublicationDb>,
  context: ReleaseTransactionContext,
  payload: GetReleaseImpactPayload,
): Promise<ReleasePublication.ReleaseImpactView> {
  const releaseRef = validateReleaseRef(payload.releaseRef, context);
  return withReleasePublicationTransaction(db, context, async (trx) => {
    const row = await repo.getReleaseById(trx, releaseRef.objectId);
    if (row === undefined) {
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'the exact Release was not found',
      );
    }
    if (
      row.enterprise_id !== context.enterpriseId ||
      !sameScope(scopeForRow(row), releaseRef.scope)
    ) {
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'the exact Release was not found',
      );
    }
    const impacts = await repo.getReleaseImpact(trx, row.release_id);
    const matching = impacts.find((impact) => {
      if (payload.triggeringRef === undefined) return true;
      const triggeringRefs = arrayForFact(impact.triggering_refs, 'ReleaseImpact.triggeringRefs');
      return triggeringRefs.some((ref) => canonicalReferencesEqual(ref, payload.triggeringRef));
    });
    if (matching === undefined) {
      throw new ReleasePublicationBusinessError(
        RELEASE_QUERY_NOT_FOUND,
        'the exact Release Impact fact was not found',
      );
    }
    const triggeringRefs = arrayForFact(
      matching.triggering_refs,
      'ReleaseImpact.triggeringRefs',
    ) as unknown as readonly Common.TypedReference[];
    const affectedDestinations = arrayForFact(
      matching.affected_destinations,
      'ReleaseImpact.affectedDestinations',
    ).filter((value): value is string => typeof value === 'string');
    const requiredActions = arrayForFact(
      matching.required_actions,
      'ReleaseImpact.requiredActions',
    ).filter((value): value is string => typeof value === 'string');
    return {
      releaseRef,
      triggeringRefs,
      affectedDestinations,
      riskClassification: matching.risk_classification,
      requiredActions,
      humanInterventionRequired: matching.human_intervention_required,
    };
  });
}

function checkedPageSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 200) {
    throw new ReleasePublicationBusinessError(
      RELEASE_SCOPE_INVALID,
      'page.pageSize must be between 1 and 200',
    );
  }
  return value;
}

function decodeOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      readonly offset?: unknown;
    };
    if (
      typeof parsed.offset !== 'number' ||
      !Number.isSafeInteger(parsed.offset) ||
      parsed.offset < 0
    ) {
      throw new Error('invalid offset');
    }
    return parsed.offset;
  } catch {
    throw new ReleasePublicationBusinessError(RELEASE_SCOPE_INVALID, 'page.cursor is invalid');
  }
}

function encodeOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function latestAttemptByDestination(
  attempts: readonly PublicationAttemptTable[],
): ReadonlyMap<string, PublicationAttemptTable> {
  const latest = new Map<string, PublicationAttemptTable>();
  for (const attempt of attempts) {
    const current = latest.get(attempt.destination_id);
    if (current === undefined || attempt.attempt_number > current.attempt_number) {
      latest.set(attempt.destination_id, attempt);
    }
  }
  return latest;
}

function typedReferenceMatchesStoredOutcome(
  attempt: PublicationAttemptTable,
  reference: Common.TypedReference,
): boolean {
  const formalReceiptRef = parseOptionalContentAddressedRef(
    attempt.formal_receipt_ref,
    'PublicationAttempt.formalReceiptRef',
  );
  const failureRef = parseOptionalContentAddressedRef(
    attempt.failure_ref,
    'PublicationAttempt.failureRef',
  );
  return (
    (formalReceiptRef !== undefined && canonicalReferencesEqual(formalReceiptRef, reference)) ||
    (failureRef !== undefined && canonicalReferencesEqual(failureRef, reference))
  );
}

function canonicalReferencesEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalize(asCanonical(left)) === canonicalize(asCanonical(right));
  } catch {
    return false;
  }
}

function arrayForFact(value: unknown, label: string): readonly CanonicalJsonValue[] {
  const parsed = parseStoredJson(value, label);
  if (!Array.isArray(parsed)) {
    throw new ReleasePublicationBusinessError(RELEASE_QUERY_NOT_FOUND, `${label} is not an array`);
  }
  return parsed as readonly CanonicalJsonValue[];
}
