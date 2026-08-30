// IM-05 WI-06 (issue #126): Release draft and frozen-package handlers.
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
  RELEASE_DESTINATION_INVALID,
  RELEASE_IDENTITY_CONFLICT,
  RELEASE_MULTIPLE_PACKAGE_HASHES,
  RELEASE_PACKAGE_FROZEN,
  RELEASE_PACKAGE_HASH_MISMATCH,
  RELEASE_QUERY_NOT_FOUND,
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
import { buildPackageHashMaterial, sameContentHash } from './package-hash.js';
import type { ReleaseRecordTable } from './persistence/release-publication-db.js';

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
export type GetReleasePayload = ReleasePublication.ReleaseGetReleasePayload;
export type GetFrozenPackagePayload = ReleasePublication.ReleaseGetFrozenPackagePayload;

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
  return {
    releaseRef,
    aggregateVersion: aggregateVersionNumber(row.aggregate_version, 'Release.aggregateVersion'),
    definition: draftDefinitionForRow(row),
    status: row.status,
    ...(packageRef === undefined ? {} : { packageRef }),
    attemptRefs: [],
    receiptRefs: [],
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
      const view = releaseViewForRow(row);
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
