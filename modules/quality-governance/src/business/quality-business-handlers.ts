// IM-05 WI-02 (issue #122): Evidence custody and QualityProfile lifecycle
// handlers. The handlers validate public references, call only the
// QualityGovernance repository, and keep business facts inside the technical
// command transaction.

import type { Kysely } from 'kysely';
import type { Common, QualityGovernance } from '@zhiju/contracts';
import {
  canonicalize,
  isUuidV7,
  newUuidV7,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import {
  digestCanonicalPayload,
  withQualityGovernanceTransaction,
  type QualityGovernanceDb,
  type QualityTransactionContext,
} from '../persistence/quality-db.js';
import {
  QualityBusinessRepository,
  type BusinessWriteOutcome,
} from '../persistence/quality-business-repository.js';
import type {
  EvidenceTable,
  EvidenceValidationTable,
  QualityProfileTable,
  QualityProfileVersionTable,
} from '../persistence/quality-business-types.js';
import {
  CONCURRENCY_CONFLICT,
  executeQualityGovernanceCommand,
  type CommandBodyResult,
  type CommandEnvelope,
  type CommandResult,
} from '../persistence/command-runner.js';
import {
  QUALITY_EVIDENCE_ALREADY_REVOKED,
  QUALITY_EVIDENCE_IDENTITY_CONFLICT,
  QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
  QUALITY_EVIDENCE_NOT_VERIFIED,
  QUALITY_EVIDENCE_QUERY_NOT_FOUND,
  QUALITY_EVIDENCE_SCOPE_INVALID,
  QUALITY_PROFILE_HUMAN_ONLY_DENIED,
  QUALITY_PROFILE_IDENTITY_CONFLICT,
  QUALITY_PROFILE_IMMUTABLE,
  QUALITY_PROFILE_QUERY_NOT_FOUND,
  QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
  QUALITY_PROFILE_SCOPE_INVALID,
  QualityBusinessError,
} from './quality-business-errors.js';
import {
  assertExpectedVersion,
  contentHashForRef,
  exactContentAddressedRef,
  exactQualityProfileRef,
  scopeForCandidate,
  validateEvidenceCandidate,
  validateEvidenceLink,
  validateEvidenceVerification,
  validateProfileActivation,
  validateQualityProfileDefinition,
  validateRevocation,
} from './quality-business-validation.js';

const repo = new QualityBusinessRepository();
const EVIDENCE_OBJECT_TYPE = 'quality.evidence';
const EVIDENCE_VERIFICATION_OBJECT_TYPE = 'quality.evidence_verification';
const EVIDENCE_LINK_OBJECT_TYPE = 'quality.evidence_link';
const QUALITY_PROFILE_OBJECT_TYPE = 'quality.quality_profile';
const IMPACT_ASSESSMENT_OBJECT_TYPE = 'quality.impact_assessment';

export type QualityCommandEnvelope<TPayload> = CommandEnvelope & { readonly payload: TPayload };
export type CaptureEvidenceCandidatePayload =
  QualityGovernance.QualityCaptureEvidenceCandidatePayload;
export type VerifyEvidencePayload = QualityGovernance.QualityVerifyEvidencePayload;
export type RevokeEvidencePayload = QualityGovernance.QualityRevokeEvidencePayload;
export type CreateEvidenceLinkPayload = QualityGovernance.QualityCreateEvidenceLinkPayload;
export type CreateQualityProfileDraftPayload =
  QualityGovernance.QualityCreateQualityProfileDraftPayload;
export type ActivateQualityProfilePayload = QualityGovernance.QualityActivateQualityProfilePayload;
export type GetEvidencePayload = QualityGovernance.QualityGetEvidencePayload;
export type GetQualityProfilePayload = QualityGovernance.QualityGetQualityProfilePayload;

type RecordLike = Readonly<Record<string, unknown>>;

interface Scope {
  readonly enterpriseId: string;
  readonly projectId?: string;
}

function record(value: unknown): RecordLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordLike)
    : {};
}

function jsonValue(value: unknown, label: string): CanonicalJsonValue {
  if (typeof value !== 'string') return value as CanonicalJsonValue;
  try {
    return JSON.parse(value) as CanonicalJsonValue;
  } catch {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_QUERY_NOT_FOUND,
      `${label} is not valid stored JSON`,
    );
  }
}

function jsonObject(value: unknown, label: string): CanonicalJsonObject {
  const parsed = jsonValue(value, label);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_QUERY_NOT_FOUND,
      `${label} is not a stored JSON object`,
    );
  }
  return parsed as CanonicalJsonObject;
}

function aggregateVersion(value: unknown, label: string): string {
  const result = String(value);
  if (!/^\d+$/.test(result) || BigInt(result) < 1n) {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_QUERY_NOT_FOUND,
      `${label} is not a valid aggregate version`,
    );
  }
  return result;
}

function contentHash(digest: Buffer): Common.ContentHash {
  if (digest.length !== 32) throw new Error('stored business hash is not 32 bytes');
  return {
    algorithm: 'SHA-256',
    digest: digest.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function scopeRef(enterpriseId: string, projectId: string | null): Common.ScopeRef {
  return {
    enterpriseId,
    ...(projectId === null ? {} : { projectId }),
  };
}

function evidenceRefForRow(row: EvidenceTable): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: EVIDENCE_OBJECT_TYPE,
    objectId: row.evidence_id,
    scope: scopeRef(row.enterprise_id, row.project_id),
    contentHash: contentHash(row.candidate_payload_hash),
  };
}

function verificationRef(row: EvidenceValidationTable): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: EVIDENCE_VERIFICATION_OBJECT_TYPE,
    objectId: row.validation_id,
    scope: scopeRef(row.enterprise_id, row.project_id),
    contentHash: contentHash(row.verification_payload_hash),
  };
}

function profileRefForRow(
  profile: QualityProfileTable,
  version: QualityProfileVersionTable,
): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: QUALITY_PROFILE_OBJECT_TYPE,
    objectId: profile.quality_profile_id,
    versionId: version.profile_version_id,
    scope: scopeRef(profile.enterprise_id, profile.project_id),
  };
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

function commandTarget(envelope: CommandEnvelope, expectedType: string, code: string): void {
  if (envelope.targetType !== expectedType || !isUuidV7(envelope.targetId)) {
    throw new QualityBusinessError(
      code,
      'command target does not identify the expected QualityGovernance object',
    );
  }
}

function assertProfileEnvelopeScope(envelope: CommandEnvelope): void {
  if (envelope.projectId !== undefined) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_SCOPE_INVALID,
      'QualityProfile is an Enterprise-scoped aggregate and cannot carry a Project command scope',
    );
  }
}

function assertEvidenceEnvelopeScope(envelope: CommandEnvelope, scope: Scope): void {
  if (envelope.enterpriseId !== scope.enterpriseId || envelope.projectId !== scope.projectId) {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_SCOPE_INVALID,
      'Evidence command scope does not match its authoritative source or Evidence row',
    );
  }
}

function mapWriteOutcome(
  outcome: BusinessWriteOutcome,
  options: {
    readonly notFoundCode: string;
    readonly invalidCode: string;
    readonly conflictCode?: string;
    readonly alreadyCode?: string;
    readonly currentAggregateVersion?: string;
  },
): CommandBodyResult {
  if (outcome === 'OK') {
    throw new Error('OK must be handled by the caller');
  }
  if (outcome === 'CONFLICT') {
    return rejected(
      options.conflictCode ?? CONCURRENCY_CONFLICT,
      'QualityGovernance aggregate version is stale or already claimed',
      options.currentAggregateVersion,
    );
  }
  if (outcome === 'ALREADY') {
    return rejected(
      options.alreadyCode ?? options.invalidCode,
      'the requested immutable QualityGovernance fact already exists',
      options.currentAggregateVersion,
    );
  }
  if (outcome === 'NOT_FOUND') {
    return rejected(options.notFoundCode, 'the exact QualityGovernance target was not found');
  }
  if (outcome === 'CONTEXT_REJECTED') {
    return rejected(
      QUALITY_EVIDENCE_SCOPE_INVALID,
      'trusted QualityGovernance context was rejected',
    );
  }
  return rejected(options.invalidCode, 'the QualityGovernance business fact was rejected');
}

function typedReferenceEdgeTarget(value: Common.TypedReference):
  | {
      readonly targetModule: string;
      readonly targetObjectType: string;
      readonly targetObjectId: string;
      readonly targetVersionId?: string;
      readonly targetPayloadHash?: Buffer;
    }
  | undefined {
  if (!('kind' in value)) return undefined;
  const targetModule = value.objectType.includes('.')
    ? (value.objectType.split('.')[0] ?? 'quality-governance')
    : 'quality-governance';
  if (value.kind === 'OBJECT') {
    return {
      targetModule,
      targetObjectType: value.objectType,
      targetObjectId: value.objectId,
    };
  }
  if (value.kind === 'VERSIONED') {
    return {
      targetModule,
      targetObjectType: value.objectType,
      targetObjectId: value.objectId,
      targetVersionId: value.versionId,
    };
  }
  if (value.kind === 'CONTENT_ADDRESSED') {
    return {
      targetModule,
      targetObjectType: value.objectType,
      targetObjectId: value.objectId,
      ...(value.immutableVersionId === undefined
        ? {}
        : { targetVersionId: value.immutableVersionId }),
      targetPayloadHash: contentHashForRef(value),
    };
  }
  return {
    targetModule,
    targetObjectType: value.objectType,
    targetObjectId: value.objectId,
    targetVersionId: value.snapshotId,
    targetPayloadHash: contentHashForRef(value),
  };
}

async function appendTypedReferenceEdge(
  execution: Parameters<Parameters<typeof executeQualityGovernanceCommand>[3]>[0],
  ownerObjectType: string,
  ownerObjectId: string,
  ownerPayloadHash: Buffer,
  referencePath: string,
  target: Common.TypedReference,
  referencePurpose: string,
): Promise<void> {
  const targetFacts = typedReferenceEdgeTarget(target);
  if (targetFacts === undefined) return;
  await execution.appendReferenceEdge({
    ownerObjectType,
    ownerObjectId,
    ownerPayloadHash,
    referencePath,
    ...targetFacts,
    referencePurpose,
  });
}

export async function handleCaptureEvidenceCandidate(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityCommandEnvelope<CaptureEvidenceCandidatePayload>,
): Promise<CommandResult> {
  commandTarget(envelope, EVIDENCE_OBJECT_TYPE, QUALITY_EVIDENCE_SCOPE_INVALID);
  const validated = validateEvidenceCandidate(envelope.payload.candidate, context);
  assertEvidenceEnvelopeScope(envelope, validated.scope);
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
    targetType: EVIDENCE_OBJECT_TYPE,
  };
  return executeQualityGovernanceCommand(db, context, normalizedEnvelope, async (execution) => {
    const outcome = await repo.insertEvidence(execution.trx, {
      evidenceId: normalizedEnvelope.targetId,
      enterpriseId: context.enterpriseId,
      ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
      candidate: validated.candidate,
      candidatePayloadHash: validated.payloadHash,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (outcome !== 'OK') {
      return mapWriteOutcome(outcome, {
        notFoundCode: QUALITY_EVIDENCE_QUERY_NOT_FOUND,
        invalidCode: QUALITY_EVIDENCE_IDENTITY_CONFLICT,
        alreadyCode: QUALITY_EVIDENCE_IDENTITY_CONFLICT,
      });
    }
    const evidenceRef = {
      kind: 'CONTENT_ADDRESSED',
      objectType: EVIDENCE_OBJECT_TYPE,
      objectId: normalizedEnvelope.targetId,
      scope: scopeForCandidate(validated),
      contentHash: contentHash(validated.payloadHash),
    } satisfies Common.ContentAddressedRef;
    await appendTypedReferenceEdge(
      execution,
      EVIDENCE_OBJECT_TYPE,
      normalizedEnvelope.targetId,
      validated.payloadHash,
      '/candidate/sourceObjectRef',
      validated.candidate.sourceObjectRef,
      'EVIDENCE_SOURCE_OBJECT',
    );
    await appendTypedReferenceEdge(
      execution,
      EVIDENCE_OBJECT_TYPE,
      normalizedEnvelope.targetId,
      validated.payloadHash,
      '/candidate/sourceSnapshotRef',
      validated.candidate.sourceSnapshotRef,
      'EVIDENCE_SOURCE_SNAPSHOT',
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        evidenceRef: evidenceRef as unknown as CanonicalJsonObject,
        status: 'CANDIDATE',
        aggregateVersion: '1',
      },
    };
  });
}

async function visibleEvidence(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  evidenceId: string,
): Promise<EvidenceTable> {
  return withQualityGovernanceTransaction(db, context, async (trx) => {
    const row = await repo.getEvidenceById(trx, evidenceId);
    if (row === undefined) {
      throw new QualityBusinessError(QUALITY_EVIDENCE_QUERY_NOT_FOUND, 'Evidence was not found');
    }
    return row;
  });
}

async function currentEvidenceVersion(
  trx: Parameters<Parameters<typeof executeQualityGovernanceCommand>[3]>[0]['trx'],
  evidenceId: string,
  fallback: string,
): Promise<string> {
  const row = await repo.getEvidenceById(trx, evidenceId);
  return row === undefined
    ? fallback
    : aggregateVersion(row.aggregate_version, 'Evidence.aggregateVersion');
}

export async function handleVerifyEvidence(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityCommandEnvelope<VerifyEvidencePayload>,
): Promise<CommandResult> {
  commandTarget(envelope, EVIDENCE_OBJECT_TYPE, QUALITY_EVIDENCE_SCOPE_INVALID);
  const expectedVersion = assertExpectedVersion(
    envelope.expectedAggregateVersion,
    'verify_evidence.expectedAggregateVersion',
  );
  const validated = validateEvidenceVerification(envelope.payload.verification, context);
  const existing = await visibleEvidence(db, context, envelope.targetId);
  assertEvidenceEnvelopeScope(envelope, {
    enterpriseId: existing.enterprise_id,
    ...(existing.project_id === null ? {} : { projectId: existing.project_id }),
  });
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    ...(existing.project_id === null ? {} : { projectId: existing.project_id }),
    targetType: EVIDENCE_OBJECT_TYPE,
    expectedAggregateVersion: expectedVersion,
  };
  return executeQualityGovernanceCommand(db, context, normalizedEnvelope, async (execution) => {
    const row = await repo.getEvidenceById(execution.trx, normalizedEnvelope.targetId);
    if (row === undefined)
      return rejected(QUALITY_EVIDENCE_QUERY_NOT_FOUND, 'Evidence was not found');
    const currentVersion = aggregateVersion(row.aggregate_version, 'Evidence.aggregateVersion');
    if (row.status === 'REVOKED') {
      return rejected(
        QUALITY_EVIDENCE_NOT_VERIFIED,
        'revoked Evidence cannot be verified',
        currentVersion,
      );
    }
    const validationId = newUuidV7();
    const outcome = await repo.appendEvidenceVerification(execution.trx, {
      validationId,
      evidenceId: row.evidence_id,
      evidencePayloadHash: row.candidate_payload_hash,
      expectedVersion,
      verification: validated.verification,
      verificationPayloadHash: validated.verificationHash,
      outcome: validated.verification.outcome,
      verifiedAt: new Date(validated.verification.verifiedAt),
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (outcome !== 'OK') {
      const conflictVersion =
        outcome === 'CONFLICT'
          ? await currentEvidenceVersion(execution.trx, row.evidence_id, currentVersion)
          : currentVersion;
      return mapWriteOutcome(outcome, {
        notFoundCode: QUALITY_EVIDENCE_QUERY_NOT_FOUND,
        invalidCode: QUALITY_EVIDENCE_NOT_VERIFIED,
        alreadyCode: QUALITY_EVIDENCE_NOT_VERIFIED,
        currentAggregateVersion: conflictVersion,
      });
    }
    const updated = await repo.getEvidenceById(execution.trx, row.evidence_id);
    const validation =
      updated === undefined
        ? undefined
        : (await repo.getEvidenceValidations(execution.trx, row.evidence_id)).find(
            (item) => item.validation_id === validationId,
          );
    if (updated === undefined || validation === undefined) {
      throw new Error('Evidence verification disappeared after append');
    }
    const evidenceRef = evidenceRefForRow(updated);
    const verificationReference = verificationRef(validation);
    const eventPayload = {
      enterpriseId: updated.enterprise_id,
      ...(updated.project_id === null ? {} : { projectId: updated.project_id }),
      evidenceRef,
      verificationRef: verificationReference,
      authority: record(jsonObject(updated.candidate, 'candidate')).authority as string,
      verifiedAt: validated.verification.verifiedAt,
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'quality.EvidenceVerified',
      eventVersion: '1.0',
      aggregateType: EVIDENCE_OBJECT_TYPE,
      aggregateId: updated.evidence_id,
      aggregateVersion: aggregateVersion(updated.aggregate_version, 'Evidence.aggregateVersion'),
      payload: eventPayload,
      occurredAt: new Date(validated.verification.verifiedAt),
    });
    await execution.appendReferenceEdge({
      ownerObjectType: EVIDENCE_OBJECT_TYPE,
      ownerObjectId: updated.evidence_id,
      ownerPayloadHash: updated.candidate_payload_hash,
      referencePath: '/verification',
      targetModule: 'quality-governance',
      targetObjectType: EVIDENCE_VERIFICATION_OBJECT_TYPE,
      targetObjectId: validation.validation_id,
      targetPayloadHash: validation.verification_payload_hash,
      referencePurpose: 'EVIDENCE_VERIFICATION',
    });
    return {
      kind: 'COMMITTED',
      resultPayload: {
        evidenceRef: evidenceRef as unknown as CanonicalJsonObject,
        verificationRef: verificationReference as unknown as CanonicalJsonObject,
        status: updated.status,
        aggregateVersion: aggregateVersion(updated.aggregate_version, 'Evidence.aggregateVersion'),
      },
    };
  });
}

export async function handleRevokeEvidence(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityCommandEnvelope<RevokeEvidencePayload>,
): Promise<CommandResult> {
  commandTarget(envelope, EVIDENCE_OBJECT_TYPE, QUALITY_EVIDENCE_SCOPE_INVALID);
  const expectedVersion = assertExpectedVersion(
    envelope.expectedAggregateVersion,
    'revoke_evidence.expectedAggregateVersion',
  );
  const validated = validateRevocation(envelope.payload, context);
  const existing = await visibleEvidence(db, context, envelope.targetId);
  assertEvidenceEnvelopeScope(envelope, {
    enterpriseId: existing.enterprise_id,
    ...(existing.project_id === null ? {} : { projectId: existing.project_id }),
  });
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    ...(existing.project_id === null ? {} : { projectId: existing.project_id }),
    targetType: EVIDENCE_OBJECT_TYPE,
    expectedAggregateVersion: expectedVersion,
  };
  return executeQualityGovernanceCommand(db, context, normalizedEnvelope, async (execution) => {
    const row = await repo.getEvidenceById(execution.trx, normalizedEnvelope.targetId);
    if (row === undefined)
      return rejected(QUALITY_EVIDENCE_QUERY_NOT_FOUND, 'Evidence was not found');
    const currentVersion = aggregateVersion(row.aggregate_version, 'Evidence.aggregateVersion');
    if (row.status === 'REVOKED') {
      return rejected(
        QUALITY_EVIDENCE_ALREADY_REVOKED,
        'Evidence is already revoked',
        currentVersion,
      );
    }
    const revocationId = newUuidV7();
    const outcome = await repo.appendEvidenceRevocation(execution.trx, {
      revocationId,
      evidenceId: row.evidence_id,
      evidencePayloadHash: row.candidate_payload_hash,
      expectedVersion,
      revocationReason: validated.revocationReason,
      impactAssessmentRef: validated.impactAssessmentRef,
      revokedAt: validated.revokedAt,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (outcome !== 'OK') {
      const conflictVersion =
        outcome === 'CONFLICT'
          ? await currentEvidenceVersion(execution.trx, row.evidence_id, currentVersion)
          : currentVersion;
      return mapWriteOutcome(outcome, {
        notFoundCode: QUALITY_EVIDENCE_QUERY_NOT_FOUND,
        invalidCode: QUALITY_EVIDENCE_ALREADY_REVOKED,
        alreadyCode: QUALITY_EVIDENCE_ALREADY_REVOKED,
        currentAggregateVersion: conflictVersion,
      });
    }
    const updated = await repo.getEvidenceById(execution.trx, row.evidence_id);
    if (updated === undefined) throw new Error('Evidence disappeared after revocation');
    const evidenceRef = evidenceRefForRow(updated);
    const eventPayload = {
      enterpriseId: updated.enterprise_id,
      ...(updated.project_id === null ? {} : { projectId: updated.project_id }),
      evidenceRef,
      impactAssessmentRef: validated.impactAssessmentRef,
      reasonCode: validated.revocationReason.reasonCode,
      revokedAt: validated.revokedAt.toISOString(),
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'quality.EvidenceRevoked',
      eventVersion: '1.0',
      aggregateType: EVIDENCE_OBJECT_TYPE,
      aggregateId: updated.evidence_id,
      aggregateVersion: aggregateVersion(updated.aggregate_version, 'Evidence.aggregateVersion'),
      payload: eventPayload,
      occurredAt: validated.revokedAt,
    });
    await execution.appendReferenceEdge({
      ownerObjectType: EVIDENCE_OBJECT_TYPE,
      ownerObjectId: updated.evidence_id,
      ownerPayloadHash: updated.candidate_payload_hash,
      referencePath: '/revocation/impactAssessmentRef',
      targetModule: 'quality-governance',
      targetObjectType: IMPACT_ASSESSMENT_OBJECT_TYPE,
      targetObjectId: validated.impactAssessmentRef.objectId,
      targetPayloadHash: contentHashForRef(validated.impactAssessmentRef),
      referencePurpose: 'EVIDENCE_REVOCATION_IMPACT',
    });
    return {
      kind: 'COMMITTED',
      resultPayload: {
        evidenceRef: evidenceRef as unknown as CanonicalJsonObject,
        impactAssessmentRef: validated.impactAssessmentRef as unknown as CanonicalJsonObject,
        status: 'REVOKED',
        aggregateVersion: aggregateVersion(updated.aggregate_version, 'Evidence.aggregateVersion'),
      },
    };
  });
}

export async function handleCreateEvidenceLink(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityCommandEnvelope<CreateEvidenceLinkPayload>,
): Promise<CommandResult> {
  commandTarget(envelope, EVIDENCE_LINK_OBJECT_TYPE, QUALITY_EVIDENCE_LINK_TARGET_MISMATCH);
  const validated = validateEvidenceLink(envelope.payload.definition, context);
  const evidence = await visibleEvidence(db, context, validated.definition.evidenceRef.objectId);
  if (
    !evidence.candidate_payload_hash.equals(contentHashForRef(validated.definition.evidenceRef))
  ) {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
      'Evidence ref hash is not authoritative',
    );
  }
  const evidenceScope: Scope = {
    enterpriseId: evidence.enterprise_id,
    ...(evidence.project_id === null ? {} : { projectId: evidence.project_id }),
  };
  if (evidenceScope.projectId !== undefined && validated.projectId !== evidenceScope.projectId) {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
      'EvidenceLink scope does not match Evidence',
    );
  }
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    enterpriseId: context.enterpriseId,
    ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
    targetType: EVIDENCE_LINK_OBJECT_TYPE,
  };
  return executeQualityGovernanceCommand(db, context, normalizedEnvelope, async (execution) => {
    const row = await repo.getEvidenceById(
      execution.trx,
      validated.definition.evidenceRef.objectId,
    );
    if (row === undefined)
      return rejected(QUALITY_EVIDENCE_LINK_TARGET_MISMATCH, 'EvidenceLink target is not exact');
    const currentEvidenceHash = row.candidate_payload_hash;
    if (!currentEvidenceHash.equals(contentHashForRef(validated.definition.evidenceRef))) {
      return rejected(
        QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
        'EvidenceLink target hash is not exact',
      );
    }
    if (validated.definition.relation === 'SUPPORTS' && row.status !== 'VERIFIED') {
      return rejected(
        QUALITY_EVIDENCE_NOT_VERIFIED,
        'only current VERIFIED Evidence may support a claim',
      );
    }
    if (row.status === 'REVOKED' && validated.definition.relation !== 'CONTEXT_ONLY') {
      return rejected(
        QUALITY_EVIDENCE_NOT_VERIFIED,
        'revoked Evidence cannot support or contradict a claim',
      );
    }
    const outcome = await repo.insertEvidenceLink(execution.trx, {
      evidenceLinkId: normalizedEnvelope.targetId,
      evidenceId: row.evidence_id,
      evidencePayloadHash: row.candidate_payload_hash,
      definition: validated.definition,
      claimHash: validated.claimHash,
      enterpriseId: context.enterpriseId,
      ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (outcome !== 'OK') {
      return mapWriteOutcome(outcome, {
        notFoundCode: QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
        invalidCode: QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
        alreadyCode: QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
      });
    }
    const linkRef: Common.ObjectRef = {
      kind: 'OBJECT',
      objectType: EVIDENCE_LINK_OBJECT_TYPE,
      objectId: normalizedEnvelope.targetId,
      scope: scopeRef(context.enterpriseId, validated.projectId ?? null),
    };
    const linkPayloadHash = digestCanonicalPayload(
      validated.definition as unknown as CanonicalJsonObject,
    ).hash;
    await execution.appendReferenceEdge({
      ownerObjectType: EVIDENCE_LINK_OBJECT_TYPE,
      ownerObjectId: normalizedEnvelope.targetId,
      ownerPayloadHash: linkPayloadHash,
      referencePath: '/evidenceRef',
      targetModule: 'quality-governance',
      targetObjectType: EVIDENCE_OBJECT_TYPE,
      targetObjectId: row.evidence_id,
      targetPayloadHash: row.candidate_payload_hash,
      referencePurpose: 'EVIDENCE_LINK_SOURCE',
    });
    await appendTypedReferenceEdge(
      execution,
      EVIDENCE_LINK_OBJECT_TYPE,
      normalizedEnvelope.targetId,
      linkPayloadHash,
      '/targetRef',
      validated.definition.targetRef,
      'EVIDENCE_LINK_TARGET',
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        evidenceLinkRef: linkRef as unknown as CanonicalJsonObject,
        evidenceRef: validated.definition.evidenceRef as unknown as CanonicalJsonObject,
        targetRef: validated.definition.targetRef as unknown as CanonicalJsonObject,
        relation: validated.definition.relation,
      },
    };
  });
}

export async function handleCreateQualityProfileDraft(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityCommandEnvelope<CreateQualityProfileDraftPayload>,
): Promise<CommandResult> {
  commandTarget(envelope, QUALITY_PROFILE_OBJECT_TYPE, QUALITY_PROFILE_SCOPE_INVALID);
  assertProfileEnvelopeScope(envelope);
  const validated = validateQualityProfileDefinition(envelope.payload.definition);
  const expectedVersion =
    envelope.expectedAggregateVersion === undefined
      ? undefined
      : assertExpectedVersion(
          envelope.expectedAggregateVersion,
          'create_quality_profile_draft.expectedAggregateVersion',
        );
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    targetType: QUALITY_PROFILE_OBJECT_TYPE,
    ...(expectedVersion === undefined ? {} : { expectedAggregateVersion: expectedVersion }),
  };
  const profileVersionId = newUuidV7();
  return executeQualityGovernanceCommand(db, context, normalizedEnvelope, async (execution) => {
    const result = await repo.insertQualityProfileDraft(execution.trx, {
      profileId: normalizedEnvelope.targetId,
      profileVersionId,
      enterpriseId: context.enterpriseId,
      definition: validated.definition,
      definitionHash: digestCanonicalPayload(validated.definition as unknown as CanonicalJsonObject)
        .hash,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (
      result.outcome !== 'OK' ||
      result.profileVersionId === undefined ||
      result.aggregateVersion === undefined
    ) {
      return mapWriteOutcome(result.outcome, {
        notFoundCode: QUALITY_PROFILE_QUERY_NOT_FOUND,
        invalidCode: QUALITY_PROFILE_IDENTITY_CONFLICT,
        alreadyCode: QUALITY_PROFILE_IDENTITY_CONFLICT,
        ...(result.aggregateVersion === undefined
          ? {}
          : { currentAggregateVersion: result.aggregateVersion }),
      });
    }
    const qualityProfileRef: Common.VersionedRef = {
      kind: 'VERSIONED',
      objectType: QUALITY_PROFILE_OBJECT_TYPE,
      objectId: normalizedEnvelope.targetId,
      versionId: result.profileVersionId,
      scope: { enterpriseId: context.enterpriseId },
    };
    return {
      kind: 'COMMITTED',
      resultPayload: {
        qualityProfileRef: qualityProfileRef as unknown as CanonicalJsonObject,
        status: 'DRAFT',
        payloadHash: contentHash(
          digestCanonicalPayload(validated.definition as unknown as CanonicalJsonObject).hash,
        ) as unknown as CanonicalJsonObject,
        aggregateVersion: result.aggregateVersion,
      },
    };
  });
}

export async function handleActivateQualityProfile(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityCommandEnvelope<ActivateQualityProfilePayload>,
): Promise<CommandResult> {
  commandTarget(envelope, QUALITY_PROFILE_OBJECT_TYPE, QUALITY_PROFILE_SCOPE_INVALID);
  assertProfileEnvelopeScope(envelope);
  const expectedVersion = assertExpectedVersion(
    envelope.expectedAggregateVersion,
    'activate_quality_profile.expectedAggregateVersion',
  );
  if (context.principalKind !== 'HUMAN') {
    throw new QualityBusinessError(
      QUALITY_PROFILE_HUMAN_ONLY_DENIED,
      'QualityProfile activation requires a trusted Human',
    );
  }
  const activation = validateProfileActivation(envelope.payload, context);
  if (activation.profileVersionRef.objectId !== envelope.targetId) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_SCOPE_INVALID,
      'profileVersionRef must target the command profile',
    );
  }
  const profile = await withQualityGovernanceTransaction(db, context, async (trx) =>
    repo.getQualityProfileById(trx, envelope.targetId),
  );
  if (profile === undefined) {
    throw new QualityBusinessError(QUALITY_PROFILE_QUERY_NOT_FOUND, 'QualityProfile was not found');
  }
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    targetType: QUALITY_PROFILE_OBJECT_TYPE,
    expectedAggregateVersion: expectedVersion,
  };
  return executeQualityGovernanceCommand(db, context, normalizedEnvelope, async (execution) => {
    const current = await repo.getQualityProfileById(execution.trx, normalizedEnvelope.targetId);
    if (current === undefined)
      return rejected(QUALITY_PROFILE_QUERY_NOT_FOUND, 'QualityProfile was not found');
    const currentVersion = aggregateVersion(
      current.aggregate_version,
      'QualityProfile.aggregateVersion',
    );
    const version = await repo.getQualityProfileVersionById(
      execution.trx,
      activation.profileVersionRef.versionId,
    );
    if (version === undefined) {
      return rejected(QUALITY_PROFILE_QUERY_NOT_FOUND, 'QualityProfile version was not found');
    }
    if (
      version.quality_profile_id !== current.quality_profile_id ||
      version.enterprise_id !== current.enterprise_id ||
      version.project_id !== null
    ) {
      return rejected(QUALITY_PROFILE_QUERY_NOT_FOUND, 'QualityProfile version was not found');
    }
    let validatedDefinition;
    try {
      validatedDefinition = validateQualityProfileDefinition(version.definition);
    } catch (error) {
      if (error instanceof QualityBusinessError) {
        return rejected(
          error.code,
          'stored QualityProfile definition is no longer activation-eligible',
          currentVersion,
        );
      }
      throw error;
    }
    const recomputedDefinitionHash = digestCanonicalPayload(
      validatedDefinition.definition as unknown as CanonicalJsonObject,
    ).hash;
    if (!recomputedDefinitionHash.equals(version.definition_hash)) {
      return rejected(
        QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
        'stored QualityProfile definition hash is not authoritative',
        currentVersion,
      );
    }
    const outcome = await repo.activateQualityProfile(execution.trx, {
      profileId: current.quality_profile_id,
      profileVersionId: version.profile_version_id,
      expectedVersion,
      reviewSnapshotRef: activation.reviewSnapshotRef,
      validationSnapshotRef: activation.validationSnapshotRef,
      activatedAt: activation.activatedAt,
      updatedByPrincipalId: envelope.principalId,
      updatedByActorSnapshotId: envelope.actorSnapshotId,
      updatedAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (outcome !== 'OK') {
      const conflictVersion =
        outcome === 'CONFLICT'
          ? await repo.getQualityProfileById(execution.trx, current.quality_profile_id)
          : undefined;
      return mapWriteOutcome(outcome, {
        notFoundCode: QUALITY_PROFILE_QUERY_NOT_FOUND,
        invalidCode: QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
        alreadyCode: QUALITY_PROFILE_IMMUTABLE,
        currentAggregateVersion:
          conflictVersion === undefined
            ? currentVersion
            : aggregateVersion(
                conflictVersion.aggregate_version,
                'QualityProfile.aggregateVersion',
              ),
      });
    }
    const updated = await repo.getQualityProfileById(execution.trx, current.quality_profile_id);
    const activeVersion = await repo.getQualityProfileVersionById(
      execution.trx,
      version.profile_version_id,
    );
    if (updated === undefined || activeVersion === undefined) {
      throw new Error('QualityProfile disappeared after activation');
    }
    const qualityProfileRef = profileRefForRow(updated, activeVersion);
    const eventPayload = {
      enterpriseId: updated.enterprise_id,
      qualityProfileRef,
      applicableArtifactTypes: record(jsonObject(activeVersion.definition, 'definition'))
        .applicableArtifactTypes,
      activatedAt: activation.activatedAt.toISOString(),
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'quality.QualityProfileActivated',
      eventVersion: '1.0',
      aggregateType: QUALITY_PROFILE_OBJECT_TYPE,
      aggregateId: updated.quality_profile_id,
      aggregateVersion: aggregateVersion(
        updated.aggregate_version,
        'QualityProfile.aggregateVersion',
      ),
      payload: eventPayload,
      occurredAt: activation.activatedAt,
    });
    await execution.appendReferenceEdge({
      ownerObjectType: QUALITY_PROFILE_OBJECT_TYPE,
      ownerObjectId: updated.quality_profile_id,
      ownerVersionId: activeVersion.profile_version_id,
      ownerPayloadHash: activeVersion.definition_hash,
      referencePath: '/reviewSnapshotRef',
      targetModule: 'quality-governance',
      targetObjectType: activation.reviewSnapshotRef.objectType,
      targetObjectId: activation.reviewSnapshotRef.objectId,
      targetVersionId: activation.reviewSnapshotRef.snapshotId,
      targetPayloadHash: contentHashForRef(activation.reviewSnapshotRef),
      referencePurpose: 'QUALITY_PROFILE_REVIEW_SNAPSHOT',
    });
    await execution.appendReferenceEdge({
      ownerObjectType: QUALITY_PROFILE_OBJECT_TYPE,
      ownerObjectId: updated.quality_profile_id,
      ownerVersionId: activeVersion.profile_version_id,
      ownerPayloadHash: activeVersion.definition_hash,
      referencePath: '/validationSnapshotRef',
      targetModule: 'quality-governance',
      targetObjectType: activation.validationSnapshotRef.objectType,
      targetObjectId: activation.validationSnapshotRef.objectId,
      targetVersionId: activation.validationSnapshotRef.snapshotId,
      targetPayloadHash: contentHashForRef(activation.validationSnapshotRef),
      referencePurpose: 'QUALITY_PROFILE_VALIDATION_SNAPSHOT',
    });
    return {
      kind: 'COMMITTED',
      resultPayload: {
        qualityProfileRef: qualityProfileRef as unknown as CanonicalJsonObject,
        status: 'ACTIVE',
        activatedAt: activation.activatedAt.toISOString(),
        aggregateVersion: aggregateVersion(
          updated.aggregate_version,
          'QualityProfile.aggregateVersion',
        ),
      },
    };
  });
}

export async function handleGetEvidence(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  payload: GetEvidencePayload,
): Promise<QualityGovernance.EvidenceView> {
  const requested = exactContentAddressedRef(
    payload.evidenceRef,
    context,
    'evidenceRef',
    new Set([EVIDENCE_OBJECT_TYPE]),
  );
  return withQualityGovernanceTransaction(db, context, async (trx) => {
    const row = await repo.getEvidenceById(trx, requested.objectId);
    if (row === undefined) {
      throw new QualityBusinessError(QUALITY_EVIDENCE_QUERY_NOT_FOUND, 'Evidence was not found');
    }
    if (
      row.enterprise_id !== context.enterpriseId ||
      (row.project_id ?? undefined) !== (requested.scope.projectId ?? undefined) ||
      !row.candidate_payload_hash.equals(contentHashForRef(requested)) ||
      (requested.immutableVersionId !== undefined &&
        requested.immutableVersionId !== row.evidence_id)
    ) {
      throw new QualityBusinessError(QUALITY_EVIDENCE_QUERY_NOT_FOUND, 'Evidence was not found');
    }
    const validations = await repo.getEvidenceValidations(trx, row.evidence_id);
    const latest = validations[0];
    return {
      evidenceRef: evidenceRefForRow(row),
      status: row.status,
      candidate: jsonObject(
        row.candidate,
        'Evidence.candidate',
      ) as unknown as QualityGovernance.EvidenceCandidate,
      ...(latest === undefined ? {} : { latestVerificationRef: verificationRef(latest) }),
      impactStatus: row.impact_status,
    };
  });
}

export async function handleGetQualityProfile(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  payload: GetQualityProfilePayload,
): Promise<QualityGovernance.QualityProfileView> {
  const requested = exactQualityProfileRef(payload.qualityProfileRef, context);
  return withQualityGovernanceTransaction(db, context, async (trx) => {
    const profile = await repo.getQualityProfileById(trx, requested.objectId);
    const version = await repo.getQualityProfileVersionById(trx, requested.versionId);
    if (profile === undefined || version === undefined) {
      throw new QualityBusinessError(
        QUALITY_PROFILE_QUERY_NOT_FOUND,
        'QualityProfile version was not found',
      );
    }
    if (
      profile.enterprise_id !== context.enterpriseId ||
      version.quality_profile_id !== profile.quality_profile_id ||
      profile.project_id !== null ||
      requested.scope.projectId !== undefined ||
      version.definition_hash.length !== 32
    ) {
      throw new QualityBusinessError(
        QUALITY_PROFILE_QUERY_NOT_FOUND,
        'QualityProfile version was not found',
      );
    }
    return {
      qualityProfileRef: profileRefForRow(profile, version),
      status: version.status,
      definition: jsonObject(
        version.definition,
        'QualityProfile.definition',
      ) as unknown as QualityGovernance.QualityProfileDefinition,
      payloadHash: contentHash(version.definition_hash),
    };
  });
}

export function canonicalDefinitionKey(value: unknown): string {
  return canonicalize(value as CanonicalJsonValue);
}
