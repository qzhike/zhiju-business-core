// IM-05 WI-03 (issue #123): GateResult, ChangeImpact reuse, and readiness
// handlers. Each command keeps its business fact, technical receipt, audit,
// outbox, and reference edges inside one trusted transaction.

import type { Kysely } from 'kysely';
import type { Common, Core, QualityGovernance } from '@zhiju/contracts';
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
  type QualityTransaction,
  type QualityTransactionContext,
} from '../persistence/quality-db.js';
import {
  QualityBusinessRepository,
  type BusinessWriteOutcome,
} from '../persistence/quality-business-repository.js';
import type {
  ChangeImpactTable,
  GateResultTable,
  QualityProfileTable,
  QualityProfileVersionTable,
} from '../persistence/quality-business-types.js';
import {
  executeQualityGovernanceCommand,
  type CommandBodyResult,
  type CommandEnvelope,
  type CommandExecution,
  type CommandResult,
} from '../persistence/command-runner.js';
import {
  QUALITY_CHANGE_IMPACT_QUERY_NOT_FOUND,
  QUALITY_EVIDENCE_NOT_VERIFIED,
  QUALITY_GATE_INPUT_MISMATCH,
  QUALITY_GATE_REUSE_NOT_ALLOWED,
  QUALITY_GATE_RESULT_IMMUTABLE,
  QUALITY_GATE_RESULT_INVALID,
  QUALITY_GATE_RESULT_QUERY_NOT_FOUND,
  QUALITY_GATE_STAGE_MISMATCH,
  QUALITY_INCREMENTAL_COVERAGE_INSUFFICIENT,
  QUALITY_PROFILE_QUERY_NOT_FOUND,
  QUALITY_READINESS_SNAPSHOT_QUERY_NOT_FOUND,
  QUALITY_RELEASE_PACKAGE_TARGET_MISMATCH,
  QUALITY_RELEASE_READINESS_NOT_READY,
  QUALITY_REVISION_ACCEPTANCE_NOT_READY,
  QualityBusinessError,
} from './quality-business-errors.js';
import {
  exactQualityProfileRef,
  validateQualityProfileDefinition,
} from './quality-business-validation.js';
import {
  contentRefHash,
  validateChangeImpactDefinition,
  validateContentAddressedRef,
  validateGateInvalidation,
  validateGateResultSubmission,
  validateGateReuseSubmission,
  validateSnapshotRef,
  validateGateTarget,
  validateReleaseReadinessInput,
  validateRevisionReadinessInput,
  snapshotRefHash,
} from './quality-gate-validation.js';

const repo = new QualityBusinessRepository();
const ARTIFACT_OBJECT_TYPE = 'artifact.artifact';
const QUALITY_PROFILE_OBJECT_TYPE = 'quality.quality_profile';
const GATE_RESULT_OBJECT_TYPE = 'quality.gate_result';
const CHANGE_IMPACT_OBJECT_TYPE = 'quality.change_impact';
const GATE_INVALIDATION_OBJECT_TYPE = 'quality.gate_invalidation';
const REVISION_SNAPSHOT_OBJECT_TYPE = 'quality.revision_acceptance_snapshot';
const RELEASE_SNAPSHOT_OBJECT_TYPE = 'quality.release_readiness_snapshot';
const GATE_SPEC_OBJECT_TYPE = 'quality.gate_spec';

export type QualityCommandEnvelope<TPayload> = CommandEnvelope & { readonly payload: TPayload };
export type RecordGateResultPayload = QualityGovernance.QualityRecordGateResultPayload;
export type RecordReusedGateResultPayload = QualityGovernance.QualityRecordReusedGateResultPayload;
export type InvalidateGateResultPayload = QualityGovernance.QualityInvalidateGateResultPayload;
export type EvaluateRevisionReadinessPayload =
  QualityGovernance.QualityEvaluateRevisionReadinessPayload;
export type EvaluateReleaseReadinessPayload =
  QualityGovernance.QualityEvaluateReleaseGateReadinessPayload;
export type GetGatePlanPayload = QualityGovernance.QualityGetGatePlanPayload;
export type GetGateResultsPayload = QualityGovernance.QualityGetGateResultsPayload;
export type GetRevisionAcceptanceSnapshotPayload =
  QualityGovernance.QualityGetRevisionAcceptanceSnapshotPayload;
export type GetReleaseReadinessSnapshotPayload =
  QualityGovernance.QualityGetReleaseReadinessSnapshotPayload;

type RecordLike = Readonly<Record<string, unknown>>;
type GateStage = 'REVISION_ACCEPTANCE' | 'RELEASE_READINESS';
type GateOutcome = QualityGovernance.GateOutcome;

interface ExactProfile {
  readonly profile: QualityProfileTable;
  readonly version: QualityProfileVersionTable;
  readonly ref: Common.VersionedRef;
  readonly definition: QualityGovernance.QualityProfileDefinition;
}

interface GateEvaluation {
  readonly rows: readonly GateResultTable[];
  readonly invalidatedIds: ReadonlySet<string>;
  readonly reasons: readonly string[];
}

function record(value: unknown, label: string): RecordLike {
  const parsed = typeof value === 'string' ? parseStored(value, label) : value;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new QualityBusinessError(
      QUALITY_GATE_RESULT_QUERY_NOT_FOUND,
      `${label} is not an object`,
    );
  }
  return parsed as RecordLike;
}

function parseStored(value: string, label: string): CanonicalJsonValue {
  try {
    return JSON.parse(value) as CanonicalJsonValue;
  } catch {
    throw new QualityBusinessError(
      QUALITY_GATE_RESULT_QUERY_NOT_FOUND,
      `${label} contains invalid stored JSON`,
    );
  }
}

function storedValue(value: unknown, label: string): CanonicalJsonValue {
  if (typeof value === 'string') return parseStored(value, label);
  if (value === undefined) {
    throw new QualityBusinessError(
      QUALITY_GATE_RESULT_QUERY_NOT_FOUND,
      `${label} is missing stored JSON`,
    );
  }
  return value as CanonicalJsonValue;
}

function storedObject(value: unknown, label: string): CanonicalJsonObject {
  const parsed = storedValue(value, label);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new QualityBusinessError(
      QUALITY_GATE_RESULT_QUERY_NOT_FOUND,
      `${label} is not a stored JSON object`,
    );
  }
  return parsed as CanonicalJsonObject;
}

function storedString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new QualityBusinessError(
      QUALITY_GATE_RESULT_QUERY_NOT_FOUND,
      `${label} is not a stored string`,
    );
  }
  return value;
}

function storedArray(value: unknown, label: string): readonly CanonicalJsonValue[] {
  const parsed = storedValue(value, label);
  if (!Array.isArray(parsed)) {
    throw new QualityBusinessError(
      QUALITY_GATE_RESULT_QUERY_NOT_FOUND,
      `${label} is not a stored JSON array`,
    );
  }
  return parsed as CanonicalJsonValue[];
}

function hashFromBytes(value: Buffer): Common.ContentHash {
  if (value.length !== 32) throw new Error('stored quality hash is not 32 bytes');
  return {
    algorithm: 'SHA-256',
    digest: value.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function scopeRef(enterpriseId: string, projectId: string | null): Common.ScopeRef {
  return {
    enterpriseId,
    ...(projectId === null ? {} : { projectId }),
  };
}

function contentRefForRow(
  objectType: string,
  objectId: string,
  enterpriseId: string,
  projectId: string | null,
  payloadHash: Buffer,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    scope: scopeRef(enterpriseId, projectId),
    contentHash: hashFromBytes(payloadHash),
  };
}

function gateResultRefForRow(row: GateResultTable): Common.ContentAddressedRef {
  return contentRefForRow(
    GATE_RESULT_OBJECT_TYPE,
    row.gate_result_id,
    row.enterprise_id,
    row.project_id,
    row.payload_hash,
  );
}

function snapshotRefForRow(
  objectType: string,
  snapshotId: string,
  enterpriseId: string,
  projectId: string | null,
  payloadHash: Buffer,
): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: snapshotId,
    snapshotId,
    scope: scopeRef(enterpriseId, projectId),
    contentHash: hashFromBytes(payloadHash),
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

function normalizeEnvelopeProject(
  envelope: CommandEnvelope,
  projectId: string | undefined,
  targetType: string,
  errorCode: string,
): CommandEnvelope {
  if (envelope.projectId !== undefined && envelope.projectId !== projectId) {
    throw new QualityBusinessError(
      errorCode,
      'command scope does not match the exact target scope',
    );
  }
  if (projectId === undefined) {
    return { ...envelope, targetType };
  }
  return { ...envelope, projectId, targetType };
}

function commandTarget(envelope: CommandEnvelope, expectedType: string, errorCode: string): void {
  if (envelope.targetType !== expectedType || !isUuidV7(envelope.targetId)) {
    throw new QualityBusinessError(errorCode, 'command target is not the expected Quality fact');
  }
}

function rejected(errorCode: string, safeSummary: string): CommandBodyResult {
  return { kind: 'REJECTED', errorCode, safeSummary };
}

function mapWriteOutcome(
  outcome: BusinessWriteOutcome,
  invalidCode: string,
  notFoundCode = invalidCode,
): CommandBodyResult {
  if (outcome === 'NOT_FOUND')
    return rejected(notFoundCode, 'the exact Quality fact was not found');
  if (outcome === 'CONFLICT' || outcome === 'ALREADY') {
    return rejected(invalidCode, 'the immutable Quality fact already exists');
  }
  if (outcome !== 'OK') return rejected(invalidCode, 'the Quality fact was rejected');
  throw new Error('OK must be handled by the caller');
}

function exactJsonEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalize(storedValue(left, 'left')) === canonicalize(right as CanonicalJsonValue);
  } catch {
    return false;
  }
}

function profileDefinition(
  profile: QualityProfileVersionTable,
): QualityGovernance.QualityProfileDefinition {
  return validateQualityProfileDefinition(
    storedObject(profile.definition, 'QualityProfile.definition'),
  ).definition;
}

async function exactProfile(
  trx: QualityTransaction,
  context: QualityTransactionContext,
  requested: Common.VersionedRef,
  requireActive: boolean,
): Promise<ExactProfile | undefined> {
  const profile = await repo.getQualityProfileById(trx, requested.objectId);
  const version = await repo.getQualityProfileVersionById(trx, requested.versionId);
  if (profile === undefined || version === undefined) return undefined;
  if (
    profile.enterprise_id !== context.enterpriseId ||
    profile.quality_profile_id !== version.quality_profile_id ||
    profile.project_id !== null ||
    requested.scope.enterpriseId !== profile.enterprise_id ||
    requested.scope.projectId !== undefined ||
    version.enterprise_id !== profile.enterprise_id ||
    version.project_id !== null ||
    (requireActive && version.status !== 'ACTIVE')
  ) {
    return undefined;
  }
  const ref = profileRefForRow(profile, version);
  if (!exactJsonEqual(ref, requested)) return undefined;
  return {
    profile,
    version,
    ref,
    definition: profileDefinition(version),
  };
}

function gateSpec(
  definition: QualityGovernance.QualityProfileDefinition,
  gateSpecId: string,
  gateVersion: string,
  stage: GateStage,
): CanonicalJsonObject | undefined {
  const match = definition.gateSpecs.find((item) => {
    const candidate = storedObject(item, 'QualityProfile.gateSpec');
    return (
      candidate.gateSpecId === gateSpecId &&
      candidate.gateVersion === gateVersion &&
      candidate.evaluationStage === stage
    );
  });
  return match === undefined ? undefined : storedObject(match, 'QualityProfile.gateSpec');
}

function stageForTarget(target: QualityGovernance.GateTarget): GateStage {
  return target.kind === 'REVISION' ? 'REVISION_ACCEPTANCE' : 'RELEASE_READINESS';
}

function targetForRow(
  row: GateResultTable,
  context: QualityTransactionContext,
): QualityGovernance.GateTarget {
  try {
    return validateGateTarget(row.gate_target, context);
  } catch {
    throw new QualityBusinessError(
      QUALITY_GATE_RESULT_QUERY_NOT_FOUND,
      'stored GateResult target is invalid',
    );
  }
}

function evidenceRefsForRow(row: GateResultTable): readonly Common.EvidenceRef[] {
  return storedArray(
    row.evidence_refs,
    'GateResult.evidenceRefs',
  ) as unknown as readonly Common.EvidenceRef[];
}

function reviewIssueRefsForRow(row: GateResultTable): readonly Common.ObjectRef[] {
  return storedArray(
    row.review_issue_refs,
    'GateResult.reviewIssueRefs',
  ) as unknown as readonly Common.ObjectRef[];
}

function gateResultView(
  row: GateResultTable,
  target: QualityGovernance.GateTarget,
  validityStatus: string,
): QualityGovernance.GateResultView {
  return {
    gateResultRef: gateResultRefForRow(row),
    target,
    evaluationStage: row.evaluation_stage,
    outcome: row.outcome,
    validityStatus,
    evidenceRefs: evidenceRefsForRow(row),
    reviewIssueRefs: reviewIssueRefsForRow(row),
  };
}

async function exactGateResult(
  trx: QualityTransaction,
  context: QualityTransactionContext,
  ref: Common.ContentAddressedRef,
): Promise<GateResultTable | undefined> {
  const row = await repo.getGateResultById(trx, ref.objectId);
  if (row === undefined) return undefined;
  if (
    row.enterprise_id !== context.enterpriseId ||
    (row.project_id ?? undefined) !== (ref.scope.projectId ?? undefined) ||
    !row.payload_hash.equals(contentRefHash(ref))
  ) {
    return undefined;
  }
  return row;
}

async function exactChangeImpact(
  trx: QualityTransaction,
  context: QualityTransactionContext,
  ref: Common.ContentAddressedRef,
): Promise<ChangeImpactTable | undefined> {
  const row = await repo.getChangeImpactById(trx, ref.objectId);
  if (row === undefined) return undefined;
  if (
    row.enterprise_id !== context.enterpriseId ||
    (row.project_id ?? undefined) !== (ref.scope.projectId ?? undefined) ||
    !row.payload_hash.equals(contentRefHash(ref))
  ) {
    return undefined;
  }
  return row;
}

function appendReferenceTarget(
  execution: CommandExecution,
  ownerObjectType: string,
  ownerObjectId: string,
  ownerPayloadHash: Buffer,
  referencePath: string,
  target: Common.TypedReference,
  referencePurpose: string,
): Promise<void> {
  if (!('kind' in target)) return Promise.resolve();
  const targetModule = target.objectType.includes('.')
    ? (target.objectType.split('.')[0] ?? 'quality-governance')
    : 'quality-governance';
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
      ? target.kind === 'CONTENT_ADDRESSED'
        ? contentRefHash(target)
        : snapshotRefHash(target)
      : undefined;
  return execution.appendReferenceEdge({
    ownerObjectType,
    ownerObjectId,
    ownerPayloadHash,
    referencePath,
    targetModule,
    targetObjectType: target.objectType,
    targetObjectId: target.objectId,
    ...(targetVersionId === undefined ? {} : { targetVersionId }),
    ...(targetPayloadHash === undefined ? {} : { targetPayloadHash }),
    referencePurpose,
  });
}

async function appendGateResultReferences(
  execution: CommandExecution,
  row: GateResultTable,
  target: QualityGovernance.GateTarget,
  profileRef: Common.VersionedRef,
  inputSnapshotRef: Common.SnapshotRef,
  evidenceRefs: readonly Common.EvidenceRef[],
): Promise<void> {
  await appendReferenceTarget(
    execution,
    GATE_RESULT_OBJECT_TYPE,
    row.gate_result_id,
    row.payload_hash,
    '/gateTarget/revisionRef',
    target.revisionRef,
    'GATE_RESULT_REVISION_TARGET',
  );
  await appendReferenceTarget(
    execution,
    GATE_RESULT_OBJECT_TYPE,
    row.gate_result_id,
    row.payload_hash,
    '/qualityProfileRef',
    profileRef,
    'GATE_RESULT_QUALITY_PROFILE',
  );
  await appendReferenceTarget(
    execution,
    GATE_RESULT_OBJECT_TYPE,
    row.gate_result_id,
    row.payload_hash,
    '/inputSnapshotRef',
    inputSnapshotRef,
    'GATE_RESULT_INPUT_SNAPSHOT',
  );
  for (const [index, evidenceRef] of evidenceRefs.entries()) {
    await appendReferenceTarget(
      execution,
      GATE_RESULT_OBJECT_TYPE,
      row.gate_result_id,
      row.payload_hash,
      `/evidenceRefs/${index}/evidence`,
      evidenceRef.evidence,
      'GATE_RESULT_EVIDENCE',
    );
    if (evidenceRef.evidenceLinkRef !== undefined) {
      await appendReferenceTarget(
        execution,
        GATE_RESULT_OBJECT_TYPE,
        row.gate_result_id,
        row.payload_hash,
        `/evidenceRefs/${index}/evidenceLinkRef`,
        evidenceRef.evidenceLinkRef,
        'GATE_RESULT_EVIDENCE_LINK',
      );
    }
  }
}

function gateResultEventPayload(
  context: QualityTransactionContext,
  row: GateResultTable,
  target: QualityGovernance.GateTarget,
): CanonicalJsonObject {
  return {
    enterpriseId: context.enterpriseId,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
    gateResultRef: gateResultRefForRow(row) as unknown as CanonicalJsonValue,
    target: target as unknown as CanonicalJsonValue,
    evaluationStage: row.evaluation_stage,
    gateSpecId: row.gate_spec_id,
    outcome: row.outcome,
    validityStatus: 'VALID',
  };
}

export async function handleRecordGateResult(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityCommandEnvelope<RecordGateResultPayload>,
): Promise<CommandResult> {
  commandTarget(envelope, GATE_RESULT_OBJECT_TYPE, QUALITY_GATE_INPUT_MISMATCH);
  const validated = validateGateResultSubmission(envelope.payload.submission, context);
  const normalizedEnvelope = normalizeEnvelopeProject(
    envelope,
    validated.projectId,
    GATE_RESULT_OBJECT_TYPE,
    QUALITY_GATE_INPUT_MISMATCH,
  );
  return executeQualityGovernanceCommand(
    db,
    context,
    normalizedEnvelope,
    async (execution): Promise<CommandBodyResult> => {
      const profile = await exactProfile(
        execution.trx,
        context,
        validated.submission.qualityProfileRef,
        true,
      );
      if (profile === undefined) {
        return rejected(
          QUALITY_PROFILE_QUERY_NOT_FOUND,
          'the exact active QualityProfile was not found',
        );
      }
      if (
        gateSpec(
          profile.definition,
          validated.submission.gateSpecId,
          validated.submission.gateVersion,
          validated.submission.evaluationStage,
        ) === undefined
      ) {
        return rejected(
          QUALITY_GATE_INPUT_MISMATCH,
          'GateSpec is not part of the exact QualityProfile version',
        );
      }
      const outcome = await repo.insertGateResult(execution.trx, {
        gateResultId: normalizedEnvelope.targetId,
        enterpriseId: context.enterpriseId,
        ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
        definition: validated.definition,
        revisionContentHash: validated.revisionContentHash,
        evaluationStage: validated.submission.evaluationStage,
        executionMode: 'EXECUTED',
        payloadHash: validated.payloadHash,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        createdByAuthorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      if (outcome !== 'OK') {
        return mapWriteOutcome(outcome, QUALITY_GATE_RESULT_IMMUTABLE);
      }
      const row = await repo.getGateResultById(execution.trx, normalizedEnvelope.targetId);
      if (row === undefined) throw new Error('GateResult disappeared after insert');
      await appendGateResultReferences(
        execution,
        row,
        validated.submission.gateTarget,
        validated.submission.qualityProfileRef,
        validated.submission.inputSnapshotRef,
        validated.submission.evidenceRefs,
      );
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'quality.GateResultRecorded',
        eventVersion: '1.0',
        aggregateType: GATE_RESULT_OBJECT_TYPE,
        aggregateId: row.gate_result_id,
        aggregateVersion: '1',
        payload: gateResultEventPayload(context, row, validated.submission.gateTarget),
        occurredAt: new Date(validated.submission.completedAt),
      });
      return {
        kind: 'COMMITTED',
        resultPayload: {
          gateResultRef: gateResultRefForRow(row) as unknown as CanonicalJsonValue,
          target: validated.submission.gateTarget as unknown as CanonicalJsonValue,
          evaluationStage: row.evaluation_stage,
          outcome: row.outcome,
          validityStatus: 'VALID',
          executionMode: 'EXECUTED',
        },
      };
    },
  );
}

function policyAllowsImpactReuse(
  definition: QualityGovernance.QualityProfileDefinition,
  gateSpecId: string,
  sourceOutcome: GateOutcome,
): boolean {
  const policy = record(definition.rerunPolicy, 'QualityProfile.rerunPolicy');
  if (policy.allowImpactReuse === false || policy.allowReuse === false) return false;
  const reuseMode = policy.reuseMode ?? policy.rerunOnChange;
  const explicitlyAllowed =
    policy.allowImpactReuse === true ||
    policy.allowReuse === true ||
    policy.reuseOnChange === true ||
    reuseMode === 'IMPACT_ANALYSIS' ||
    reuseMode === 'IMPACT';
  if (!explicitlyAllowed) return false;
  const allowedGateSpecIds = policy.reusableGateSpecIds ?? policy.allowedReuseGateSpecIds;
  if (
    Array.isArray(allowedGateSpecIds) &&
    !allowedGateSpecIds.some((item) => item === gateSpecId)
  ) {
    return false;
  }
  const reusableOutcomes = policy.reusableOutcomes;
  if (Array.isArray(reusableOutcomes)) {
    return reusableOutcomes.some((item) => item === sourceOutcome);
  }
  return sourceOutcome === 'PASS' || sourceOutcome === 'NOT_APPLICABLE';
}

function canonicalUnitKey(value: CanonicalJsonValue): string {
  return canonicalize(value);
}

function coverageSufficient(impact: ValidatedChangeImpactShape, gateSpecId: string): boolean {
  if (impact.affectedGateSpecIds.includes(gateSpecId)) return false;
  if (impact.toolchainChanges.length > 0 || impact.profileChanges.length > 0) return false;
  const coverage = impact.coverage;
  if (coverage.complete === false || coverage.status === 'INCOMPLETE') return false;
  const explicitCovered = Array.isArray(coverage.coveredUnits)
    ? coverage.coveredUnits
    : coverage.complete === true
      ? impact.unchangedUnits
      : undefined;
  if (explicitCovered === undefined) return false;
  const covered = new Set(
    (explicitCovered as CanonicalJsonValue[]).map((item) => canonicalUnitKey(item)),
  );
  return impact.unchangedUnits.every((item) => covered.has(canonicalUnitKey(item)));
}

interface ValidatedChangeImpactShape {
  readonly baseRevisionRef: Common.ContentAddressedRef;
  readonly targetRevisionRef: Common.ContentAddressedRef;
  readonly changedUnits: readonly CanonicalJsonValue[];
  readonly unchangedUnits: readonly CanonicalJsonValue[];
  readonly affectedGateSpecIds: readonly string[];
  readonly toolchainChanges: readonly CanonicalJsonValue[];
  readonly profileChanges: readonly CanonicalJsonValue[];
  readonly coverage: RecordLike;
}

function changeImpactShape(value: unknown): ValidatedChangeImpactShape {
  const definition = storedObject(value, 'ChangeImpact.definition');
  const changedUnits = storedArray(definition.changedUnits, 'ChangeImpact.changedUnits');
  const unchangedUnits = storedArray(definition.unchangedUnits, 'ChangeImpact.unchangedUnits');
  const affectedGateSpecIds = storedArray(
    definition.affectedGateSpecIds,
    'ChangeImpact.affectedGateSpecIds',
  ).filter((item): item is string => typeof item === 'string');
  const toolchainChanges = storedArray(
    definition.toolchainChanges,
    'ChangeImpact.toolchainChanges',
  );
  const profileChanges = storedArray(definition.profileChanges, 'ChangeImpact.profileChanges');
  return {
    baseRevisionRef: storedObject(
      definition.baseRevisionRef,
      'ChangeImpact.baseRevisionRef',
    ) as unknown as Common.ContentAddressedRef,
    targetRevisionRef: storedObject(
      definition.targetRevisionRef,
      'ChangeImpact.targetRevisionRef',
    ) as unknown as Common.ContentAddressedRef,
    changedUnits,
    unchangedUnits,
    affectedGateSpecIds,
    toolchainChanges,
    profileChanges,
    coverage: record(definition.coverage, 'ChangeImpact.coverage'),
  };
}

function publicGateDefinition(value: unknown): CanonicalJsonObject {
  const definition = storedObject(value, 'GateResult.definition');
  const internalKeys = new Set([
    'executionMode',
    'validityStatus',
    'reuseSourceGateResultRef',
    'changeImpactRef',
  ]);
  return Object.fromEntries(Object.entries(definition).filter(([key]) => !internalKeys.has(key)));
}

async function sourceEvidenceIsCurrent(
  trx: QualityTransaction,
  context: QualityTransactionContext,
  row: GateResultTable,
): Promise<boolean> {
  for (const evidenceRef of evidenceRefsForRow(row)) {
    const evidence = await repo.getEvidenceById(trx, evidenceRef.evidence.objectId);
    if (evidence === undefined) return false;
    if (
      evidence.enterprise_id !== context.enterpriseId ||
      (evidence.project_id ?? undefined) !== (row.project_id ?? undefined) ||
      !evidence.candidate_payload_hash.equals(contentRefHash(evidenceRef.evidence)) ||
      evidence.status !== 'VERIFIED'
    ) {
      return false;
    }
  }
  return true;
}

export async function handleRecordReusedGateResult(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityCommandEnvelope<RecordReusedGateResultPayload>,
): Promise<CommandResult> {
  commandTarget(envelope, GATE_RESULT_OBJECT_TYPE, QUALITY_GATE_INPUT_MISMATCH);
  const validated = validateGateReuseSubmission(envelope.payload.reuse, context);
  const normalizedEnvelope = normalizeEnvelopeProject(
    envelope,
    validated.projectId,
    GATE_RESULT_OBJECT_TYPE,
    QUALITY_GATE_INPUT_MISMATCH,
  );
  return executeQualityGovernanceCommand(
    db,
    context,
    normalizedEnvelope,
    async (execution): Promise<CommandBodyResult> => {
      const source = await exactGateResult(
        execution.trx,
        context,
        validated.reuse.sourceGateResultRef,
      );
      if (source === undefined) {
        return rejected(
          QUALITY_GATE_REUSE_NOT_ALLOWED,
          'the exact source GateResult was not found',
        );
      }
      if (
        (await repo.getGateInvalidationByGateResultId(execution.trx, source.gate_result_id)) !==
        undefined
      ) {
        return rejected(
          QUALITY_GATE_REUSE_NOT_ALLOWED,
          'an invalidated GateResult cannot be reused',
        );
      }
      const impact = await exactChangeImpact(
        execution.trx,
        context,
        validated.reuse.changeImpactRef,
      );
      if (impact?.impact_status !== 'LIVE') {
        return rejected(
          QUALITY_GATE_REUSE_NOT_ALLOWED,
          'the exact live ChangeImpact was not found',
        );
      }
      const profile = await exactProfile(
        execution.trx,
        context,
        validated.reuse.qualityProfileRef,
        true,
      );
      if (profile === undefined) {
        return rejected(
          QUALITY_PROFILE_QUERY_NOT_FOUND,
          'the exact active QualityProfile was not found',
        );
      }
      const sourceTarget = targetForRow(source, context);
      const targetStage = stageForTarget(validated.reuse.newTarget);
      if (
        source.evaluation_stage !== targetStage ||
        stageForTarget(sourceTarget) !== source.evaluation_stage ||
        source.gate_spec_id !== validated.reuse.gateSpecId ||
        !exactJsonEqual(source.quality_profile_ref, profile.ref)
      ) {
        if (
          source.evaluation_stage !== targetStage ||
          stageForTarget(sourceTarget) !== source.evaluation_stage
        ) {
          return rejected(
            QUALITY_GATE_STAGE_MISMATCH,
            'source and new GateTargets use different evaluation stages',
          );
        }
        return rejected(
          QUALITY_GATE_REUSE_NOT_ALLOWED,
          'source GateResult identity does not match the reuse request',
        );
      }
      const impactDefinition = validateStoredChangeImpact(impact, context);
      if (
        !exactJsonEqual(sourceTarget.revisionRef, impactDefinition.baseRevisionRef) ||
        !exactJsonEqual(validated.reuse.newTarget.revisionRef, impactDefinition.targetRevisionRef)
      ) {
        return rejected(
          QUALITY_GATE_INPUT_MISMATCH,
          'ChangeImpact base and target do not match the exact GateTargets',
        );
      }
      if (!policyAllowsImpactReuse(profile.definition, source.gate_spec_id, source.outcome)) {
        return rejected(
          QUALITY_GATE_REUSE_NOT_ALLOWED,
          'QualityProfile rerun policy does not permit impact reuse',
        );
      }
      const impactShape = changeImpactShape(impact.definition);
      if (!coverageSufficient(impactShape, source.gate_spec_id)) {
        return rejected(
          QUALITY_INCREMENTAL_COVERAGE_INSUFFICIENT,
          'ChangeImpact does not prove sufficient unchanged Gate coverage',
        );
      }
      if (validated.reuse.derivedOutcome !== source.outcome) {
        return rejected(
          QUALITY_GATE_REUSE_NOT_ALLOWED,
          'reused outcome must equal the source outcome',
        );
      }
      if (!(await sourceEvidenceIsCurrent(execution.trx, context, source))) {
        return rejected(QUALITY_EVIDENCE_NOT_VERIFIED, 'source Evidence is no longer verified');
      }
      const sourceDefinition = publicGateDefinition(source.definition);
      const evaluatedScope = {
        ...record(sourceDefinition.evaluatedScope, 'GateResult.evaluatedScope'),
        mode: 'INCREMENTAL',
        changeImpactRef: validated.reuse.changeImpactRef,
      } as unknown as CanonicalJsonValue;
      const definition = {
        ...sourceDefinition,
        gateTarget: validated.reuse.newTarget,
        evaluationStage: source.evaluation_stage,
        qualityProfileRef: profile.ref,
        gateSpecId: source.gate_spec_id,
        gateVersion: source.gate_version,
        evaluationAttempt: source.evaluation_attempt + 1,
        evaluatedScope,
        evaluator: {
          evaluatorId: 'quality.gate.reuse',
          evaluatorVersion: '1.0.0',
          sourceEvaluator: sourceDefinition.evaluator,
        },
        outcome: validated.reuse.derivedOutcome,
        startedAt: validated.reuse.evaluatedAt,
        completedAt: validated.reuse.evaluatedAt,
        reuseSourceGateResultRef: validated.reuse.sourceGateResultRef,
        changeImpactRef: validated.reuse.changeImpactRef,
      } as unknown as CanonicalJsonObject;
      const payloadHash = digestCanonicalPayload(definition).hash;
      const insertOutcome = await repo.insertGateResult(execution.trx, {
        gateResultId: normalizedEnvelope.targetId,
        enterpriseId: context.enterpriseId,
        ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
        definition,
        revisionContentHash: contentRefHash(validated.reuse.newTarget.revisionRef),
        evaluationStage: source.evaluation_stage,
        executionMode: 'REUSED_BY_IMPACT_ANALYSIS',
        payloadHash,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        createdByAuthorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      if (insertOutcome !== 'OK') {
        return mapWriteOutcome(insertOutcome, QUALITY_GATE_RESULT_IMMUTABLE);
      }
      const row = await repo.getGateResultById(execution.trx, normalizedEnvelope.targetId);
      if (row === undefined) throw new Error('reused GateResult disappeared after insert');
      const coverageProof = {
        baseRevisionRef: impactDefinition.baseRevisionRef,
        targetRevisionRef: impactDefinition.targetRevisionRef,
        coveredUnits: impactShape.unchangedUnits,
        affectedGateSpecIds: impactShape.affectedGateSpecIds,
        analysisMethod: impactDefinition.definition.analysisMethod,
      } as unknown as CanonicalJsonObject;
      const reuseOutcome = await repo.insertGateResultReuse(execution.trx, {
        reuseId: newUuidV7(),
        gateResultId: row.gate_result_id,
        enterpriseId: context.enterpriseId,
        ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
        sourceGateResultRef: validated.reuse.sourceGateResultRef,
        sourceGateResultHash: source.payload_hash,
        changeImpactRef: validated.reuse.changeImpactRef,
        changeImpactHash: impact.payload_hash,
        coverageProof,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        createdByAuthorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      if (reuseOutcome !== 'OK') {
        return mapWriteOutcome(reuseOutcome, QUALITY_GATE_REUSE_NOT_ALLOWED);
      }
      await appendGateResultReferences(
        execution,
        row,
        validated.reuse.newTarget,
        profile.ref,
        sourceDefinition.inputSnapshotRef as unknown as Common.SnapshotRef,
        evidenceRefsForRow(source),
      );
      await appendReferenceTarget(
        execution,
        GATE_RESULT_OBJECT_TYPE,
        row.gate_result_id,
        row.payload_hash,
        '/reuse/sourceGateResultRef',
        validated.reuse.sourceGateResultRef,
        'GATE_RESULT_REUSE_SOURCE',
      );
      await appendReferenceTarget(
        execution,
        GATE_RESULT_OBJECT_TYPE,
        row.gate_result_id,
        row.payload_hash,
        '/reuse/changeImpactRef',
        validated.reuse.changeImpactRef,
        'GATE_RESULT_REUSE_CHANGE_IMPACT',
      );
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'quality.GateResultRecorded',
        eventVersion: '1.0',
        aggregateType: GATE_RESULT_OBJECT_TYPE,
        aggregateId: row.gate_result_id,
        aggregateVersion: '1',
        payload: gateResultEventPayload(context, row, validated.reuse.newTarget),
        occurredAt: new Date(validated.reuse.evaluatedAt),
      });
      return {
        kind: 'COMMITTED',
        resultPayload: {
          gateResultRef: gateResultRefForRow(row) as unknown as CanonicalJsonValue,
          target: validated.reuse.newTarget as unknown as CanonicalJsonValue,
          evaluationStage: row.evaluation_stage,
          outcome: row.outcome,
          validityStatus: 'VALID',
          executionMode: 'REUSED_BY_IMPACT_ANALYSIS',
          sourceGateResultRef: validated.reuse.sourceGateResultRef as unknown as CanonicalJsonValue,
          changeImpactRef: validated.reuse.changeImpactRef as unknown as CanonicalJsonValue,
        },
      };
    },
  );
}

function validateStoredChangeImpact(
  row: ChangeImpactTable,
  context: QualityTransactionContext,
): ValidatedChangeImpactShape & { readonly definition: CanonicalJsonObject } {
  const validated = validateChangeImpactDefinition(row.definition, context);
  return {
    definition: validated.definition,
    baseRevisionRef: validated.baseRevisionRef,
    targetRevisionRef: validated.targetRevisionRef,
    changedUnits: storedArray(validated.definition.changedUnits, 'ChangeImpact.changedUnits'),
    unchangedUnits: storedArray(validated.definition.unchangedUnits, 'ChangeImpact.unchangedUnits'),
    affectedGateSpecIds: storedArray(
      validated.definition.affectedGateSpecIds,
      'ChangeImpact.affectedGateSpecIds',
    ).filter((item): item is string => typeof item === 'string'),
    toolchainChanges: storedArray(
      validated.definition.toolchainChanges,
      'ChangeImpact.toolchainChanges',
    ),
    profileChanges: storedArray(validated.definition.profileChanges, 'ChangeImpact.profileChanges'),
    coverage: record(validated.definition.coverage, 'ChangeImpact.coverage'),
  };
}

export async function handleInvalidateGateResult(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityCommandEnvelope<InvalidateGateResultPayload>,
): Promise<CommandResult> {
  commandTarget(envelope, GATE_RESULT_OBJECT_TYPE, QUALITY_GATE_INPUT_MISMATCH);
  const validated = validateGateInvalidation(envelope.payload, context);
  const visible = await withQualityGovernanceTransaction(db, context, async (trx) =>
    repo.getGateResultById(trx, envelope.targetId),
  );
  if (visible === undefined) {
    throw new QualityBusinessError(QUALITY_GATE_RESULT_QUERY_NOT_FOUND, 'GateResult was not found');
  }
  if (visible.enterprise_id !== context.enterpriseId) {
    throw new QualityBusinessError(QUALITY_GATE_RESULT_QUERY_NOT_FOUND, 'GateResult was not found');
  }
  const normalizedEnvelope = normalizeEnvelopeProject(
    envelope,
    visible.project_id ?? undefined,
    GATE_RESULT_OBJECT_TYPE,
    QUALITY_GATE_INPUT_MISMATCH,
  );
  return executeQualityGovernanceCommand(
    db,
    context,
    normalizedEnvelope,
    async (execution): Promise<CommandBodyResult> => {
      const row = await repo.getGateResultById(execution.trx, normalizedEnvelope.targetId);
      if (row === undefined) {
        return rejected(QUALITY_GATE_RESULT_QUERY_NOT_FOUND, 'GateResult was not found');
      }
      const gateResultRef = gateResultRefForRow(row);
      const invalidationId = newUuidV7();
      const outcome = await repo.insertGateInvalidation(execution.trx, {
        invalidationId,
        gateResultId: row.gate_result_id,
        enterpriseId: row.enterprise_id,
        ...(row.project_id === null ? {} : { projectId: row.project_id }),
        gateResultRef,
        gateResultHash: row.payload_hash,
        invalidationReason: validated.invalidationReason,
        impactAssessmentRef: validated.impactAssessmentRef,
        invalidatedAt: validated.invalidatedAt,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        createdByAuthorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      if (outcome !== 'OK') {
        return mapWriteOutcome(
          outcome,
          QUALITY_GATE_RESULT_INVALID,
          QUALITY_GATE_RESULT_QUERY_NOT_FOUND,
        );
      }
      const invalidationDefinition = {
        gateResultRef,
        invalidationReason: validated.invalidationReason,
        impactAssessmentRef: validated.impactAssessmentRef,
        invalidatedAt: validated.invalidatedAt.toISOString(),
      } as unknown as CanonicalJsonObject;
      await appendReferenceTarget(
        execution,
        GATE_RESULT_OBJECT_TYPE,
        row.gate_result_id,
        row.payload_hash,
        '/invalidation/impactAssessmentRef',
        validated.impactAssessmentRef,
        'GATE_RESULT_INVALIDATION_IMPACT',
      );
      for (const [index, evidenceRef] of (
        validated.invalidationReason.evidenceRefs ?? []
      ).entries()) {
        await appendReferenceTarget(
          execution,
          GATE_RESULT_OBJECT_TYPE,
          row.gate_result_id,
          row.payload_hash,
          `/invalidation/reason/evidenceRefs/${index}/evidence`,
          evidenceRef.evidence,
          'GATE_RESULT_INVALIDATION_EVIDENCE',
        );
      }
      return {
        kind: 'COMMITTED',
        resultPayload: {
          gateResultRef: gateResultRef as unknown as CanonicalJsonValue,
          invalidationRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: GATE_INVALIDATION_OBJECT_TYPE,
            objectId: invalidationId,
            scope: gateResultRef.scope,
            contentHash: hashFromCanonical(invalidationDefinition),
          } as unknown as CanonicalJsonValue,
          validityStatus: 'INVALIDATED',
          invalidatedAt: validated.invalidatedAt.toISOString(),
        },
      };
    },
  );
}

function hashFromCanonical(value: CanonicalJsonObject): Common.ContentHash {
  return hashFromBytes(digestCanonicalPayload(value).hash);
}

function contractHeader(
  contractType: string,
  evaluatedAt: string,
  context: QualityTransactionContext,
): Common.ContractHeader {
  const schemaObjectId = newUuidV7();
  return {
    contractId: newUuidV7(),
    contractType,
    contractVersion: '1.0',
    schemaRef: {
      kind: 'VERSIONED',
      objectType: 'zhiju.contract.schema',
      objectId: schemaObjectId,
      versionId: newUuidV7(),
      scope: { enterpriseId: context.enterpriseId },
    },
    scopeRef: { enterpriseId: context.enterpriseId },
    issuedAt: evaluatedAt,
    issuedBy: {
      principalKind: context.principalKind,
      principalId: context.principalId,
    },
    correlationId: context.correlationId,
    dataClassification: 'INTERNAL',
    canonicalizationVersion: '1',
    payloadHash: {
      algorithm: 'SHA-256',
      digest: '0'.repeat(64),
      canonicalizationVersion: '1',
    },
  };
}

function requiredGateSpecs(
  definition: QualityGovernance.QualityProfileDefinition,
  stage: GateStage,
  profileVersionId: string,
): readonly CanonicalJsonValue[] {
  return definition.gateSpecs
    .filter((item) => storedObject(item, 'QualityProfile.gateSpec').evaluationStage === stage)
    .map((item) => {
      const gate = storedObject(item, 'QualityProfile.gateSpec');
      return {
        objectType: GATE_SPEC_OBJECT_TYPE,
        gateSpecId: gate.gateSpecId as string,
        gateVersion: gate.gateVersion as string,
        qualityProfileVersionId: profileVersionId,
        evaluationStage: stage,
      };
    });
}

function evaluatorVersions(value: readonly CanonicalJsonValue[]): readonly CanonicalJsonValue[] {
  return value.map((item) => {
    const evaluator = record(item, 'readiness.evaluatorVersion');
    return {
      evaluatorId: evaluator.evaluatorId as string,
      evaluatorVersion: evaluator.evaluatorVersion as string,
    };
  });
}

async function inspectGateResultRefs(
  trx: QualityTransaction,
  context: QualityTransactionContext,
  refs: readonly Common.ContentAddressedRef[],
  expectedStage: GateStage,
  revisionRef?: Common.ContentAddressedRef,
  profileRef?: Common.VersionedRef,
): Promise<GateEvaluation> {
  const rows: GateResultTable[] = [];
  const invalidatedIds = new Set<string>();
  const reasons = new Set<string>();
  for (const ref of refs) {
    const row = await exactGateResult(trx, context, ref);
    if (row === undefined) {
      reasons.add(QUALITY_GATE_RESULT_QUERY_NOT_FOUND);
      continue;
    }
    rows.push(row);
    let target: QualityGovernance.GateTarget;
    try {
      target = targetForRow(row, context);
    } catch {
      reasons.add(QUALITY_GATE_RESULT_INVALID);
      continue;
    }
    if (
      row.evaluation_stage !== expectedStage ||
      stageForTarget(target) !== expectedStage ||
      (expectedStage === 'REVISION_ACCEPTANCE' && target.kind !== 'REVISION')
    ) {
      reasons.add(QUALITY_GATE_STAGE_MISMATCH);
    }
    if (
      revisionRef !== undefined &&
      (!row.revision_content_hash.equals(contentRefHash(revisionRef)) ||
        !exactJsonEqual(row.revision_ref, revisionRef))
    ) {
      reasons.add(QUALITY_GATE_INPUT_MISMATCH);
    }
    if (profileRef !== undefined && !exactJsonEqual(row.quality_profile_ref, profileRef)) {
      reasons.add(QUALITY_GATE_INPUT_MISMATCH);
    }
    if (await repo.getGateInvalidationByGateResultId(trx, row.gate_result_id)) {
      invalidatedIds.add(row.gate_result_id);
      reasons.add('STALE_GATE_RESULT');
    }
    if (row.outcome === 'FAIL' || row.outcome === 'ERROR') {
      reasons.add(QUALITY_GATE_RESULT_INVALID);
    }
  }
  return {
    rows,
    invalidatedIds,
    reasons: [...reasons],
  };
}

function artifactRefFromRowOrRevision(
  row: GateResultTable | undefined,
  revisionRef: Common.ContentAddressedRef,
): Common.ObjectRef {
  if (row !== undefined) {
    return storedObject(row.artifact_ref, 'GateResult.artifactRef') as unknown as Common.ObjectRef;
  }
  return {
    kind: 'OBJECT',
    objectType: ARTIFACT_OBJECT_TYPE,
    objectId: revisionRef.objectId,
    scope: revisionRef.scope,
  };
}

function riskProfileRef(profileRef: Common.VersionedRef): Common.VersionedRef {
  return { ...profileRef, objectType: 'quality.risk_profile' };
}

function readinessReasons(reasons: Iterable<string>): readonly string[] {
  const values = [...new Set(reasons)];
  return values.length === 0 ? ['all_mandatory_gates_passed'] : values;
}

async function buildRevisionAcceptanceSnapshot(
  trx: QualityTransaction,
  context: QualityTransactionContext,
  input: ReturnType<typeof validateRevisionReadinessInput>,
  snapshotId: string,
): Promise<{
  readonly snapshot: Core.RevisionAcceptanceSnapshot;
  readonly status: Common.ReadinessStatus;
  readonly projectId?: string;
  readonly revisionContentHash: Buffer;
}> {
  const profile = await exactProfile(trx, context, input.qualityProfileRef, true);
  if (profile === undefined) {
    throw new QualityBusinessError(
      QUALITY_REVISION_ACCEPTANCE_NOT_READY,
      'the exact active QualityProfile was not found',
    );
  }
  const inspection = await inspectGateResultRefs(
    trx,
    context,
    input.gateResultRefs,
    'REVISION_ACCEPTANCE',
    input.revisionRef,
    profile.ref,
  );
  const reasons = new Set<string>(inspection.reasons);
  const required = requiredGateSpecs(
    profile.definition,
    'REVISION_ACCEPTANCE',
    profile.version.profile_version_id,
  );
  if (required.length === 0) reasons.add(QUALITY_REVISION_ACCEPTANCE_NOT_READY);
  const requiredById = new Map(
    required.map((item) => {
      const candidate = item as RecordLike;
      return [candidate.gateSpecId as string, candidate];
    }),
  );
  for (const [gateSpecId, spec] of requiredById) {
    const matching = inspection.rows.filter(
      (row) =>
        row.gate_spec_id === gateSpecId &&
        row.gate_version === spec.gateVersion &&
        row.evaluation_stage === 'REVISION_ACCEPTANCE',
    );
    const row = matching[0];
    const mandatory = storedObject(
      profile.definition.gateSpecs.find(
        (item) => storedObject(item, 'QualityProfile.gateSpec').gateSpecId === gateSpecId,
      ),
      'QualityProfile.gateSpec',
    ).mandatory;
    if (mandatory === true && row?.outcome !== 'PASS') {
      reasons.add('QUALITY_MANDATORY_GATE_MISSING');
    }
    if (row !== undefined && inspection.invalidatedIds.has(row.gate_result_id)) {
      reasons.add('STALE_GATE_RESULT');
    }
  }
  for (const row of inspection.rows) {
    if (!(await sourceEvidenceIsCurrent(trx, context, row))) {
      reasons.add(QUALITY_EVIDENCE_NOT_VERIFIED);
    }
  }
  const firstRow = inspection.rows[0];
  const artifactRef = artifactRefFromRowOrRevision(firstRow, input.revisionRef);
  const status: Common.ReadinessStatus =
    inspection.invalidatedIds.size > 0 ? 'STALE' : reasons.size === 0 ? 'READY' : 'NOT_READY';
  const evaluatedAt = input.evaluatedAtText;
  const snapshot = {
    header: contractHeader('zhiju.contract.revision_acceptance', evaluatedAt, context),
    snapshotId,
    artifactRef,
    revisionRef: input.revisionRef,
    qualityProfileRef: profile.ref,
    riskProfileRef: riskProfileRef(profile.ref),
    evaluationStage: 'REVISION_ACCEPTANCE',
    requiredGateSpecs: required,
    gateResultRefs: input.gateResultRefs,
    evidenceStatusSnapshotRef: input.evidenceStatusSnapshotRef,
    reviewIssueSnapshot: {
      openBlockingIssueRefs: [],
      openNonBlockingIssueRefs: [],
      closedIssueRefs: [],
      dismissedIssueRefs: [],
    },
    evaluatorVersions: evaluatorVersions(input.evaluatorVersions),
    readiness: {
      status,
      reasons: readinessReasons(reasons),
    },
    evaluatedAt,
  } as unknown as Core.RevisionAcceptanceSnapshot;
  return {
    snapshot,
    status,
    ...(input.revisionRef.scope.projectId === undefined
      ? {}
      : { projectId: input.revisionRef.scope.projectId }),
    revisionContentHash: contentRefHash(input.revisionRef),
  };
}

function releasePackageEqual(left: Common.ReleasePackageRef, right: unknown): boolean {
  return exactJsonEqual(left, right);
}

async function buildReleaseReadinessSnapshot(
  trx: QualityTransaction,
  context: QualityTransactionContext,
  input: ReturnType<typeof validateReleaseReadinessInput>,
  snapshotId: string,
): Promise<{
  readonly snapshot: Core.ReleaseReadinessSnapshot;
  readonly status: Common.ReleaseReadinessStatus;
  readonly projectId?: string;
  readonly revisionContentHash: Buffer;
}> {
  const firstRequested = input.releaseGateResultRefs[0];
  const firstRow =
    firstRequested === undefined ? undefined : await exactGateResult(trx, context, firstRequested);
  if (firstRow === undefined) {
    throw new QualityBusinessError(
      QUALITY_RELEASE_READINESS_NOT_READY,
      'at least one exact release GateResult is required to bind artifact and revision facts',
    );
  }
  const firstTarget = targetForRow(firstRow, context);
  const storedProfileRef = storedObject(
    firstRow.quality_profile_ref,
    'GateResult.qualityProfileRef',
  ) as unknown as Common.VersionedRef;
  const profile = await exactProfile(trx, context, storedProfileRef, true);
  if (profile === undefined) {
    throw new QualityBusinessError(
      QUALITY_RELEASE_READINESS_NOT_READY,
      'the exact active QualityProfile for release Gates was not found',
    );
  }
  const inspection = await inspectGateResultRefs(
    trx,
    context,
    input.releaseGateResultRefs,
    'RELEASE_READINESS',
    firstTarget.revisionRef,
    profile.ref,
  );
  const reasons = new Set<string>(inspection.reasons);
  const required = requiredGateSpecs(
    profile.definition,
    'RELEASE_READINESS',
    profile.version.profile_version_id,
  );
  const requiredById = new Map(
    required.map((item) => {
      const candidate = item as RecordLike;
      return [candidate.gateSpecId as string, candidate];
    }),
  );
  for (const [gateSpecId, spec] of requiredById) {
    const row = inspection.rows.find(
      (candidate) =>
        candidate.gate_spec_id === gateSpecId &&
        candidate.gate_version === spec.gateVersion &&
        candidate.evaluation_stage === 'RELEASE_READINESS',
    );
    const profileSpec = storedObject(
      profile.definition.gateSpecs.find(
        (item) => storedObject(item, 'QualityProfile.gateSpec').gateSpecId === gateSpecId,
      ),
      'QualityProfile.gateSpec',
    );
    if (profileSpec.mandatory === true && row?.outcome !== 'PASS') {
      reasons.add('QUALITY_MANDATORY_RELEASE_GATE_MISSING');
    }
    if (row !== undefined && inspection.invalidatedIds.has(row.gate_result_id)) {
      reasons.add('STALE_GATE_RESULT');
    }
  }
  let hasPackageGate = false;
  let hasRepresentationGate = false;
  for (const row of inspection.rows) {
    const target = targetForRow(row, context);
    if (target.kind === 'RELEASE_PACKAGE') {
      hasPackageGate = true;
      if (!releasePackageEqual(input.releasePackageRef, target.releasePackageRef)) {
        reasons.add(QUALITY_RELEASE_PACKAGE_TARGET_MISMATCH);
      }
    }
    if (target.kind === 'REPRESENTATION') {
      hasRepresentationGate = true;
      if (!exactJsonEqual(target.revisionRef, firstTarget.revisionRef)) {
        reasons.add(QUALITY_GATE_INPUT_MISMATCH);
      }
    }
    if (!(await sourceEvidenceIsCurrent(trx, context, row))) {
      reasons.add(QUALITY_EVIDENCE_NOT_VERIFIED);
    }
  }
  if (!hasPackageGate) reasons.add(QUALITY_RELEASE_PACKAGE_TARGET_MISMATCH);
  if (!hasRepresentationGate) reasons.add('QUALITY_REPRESENTATION_BINDING_REQUIRED');
  if (!input.approvalBundleSnapshotRef.objectType.includes('approval_bundle_snapshot')) {
    reasons.add(QUALITY_RELEASE_READINESS_NOT_READY);
  }
  const releaseRequirements = profile.definition.releaseRequirements.map((value) => {
    const requirement = storedObject(value, 'QualityProfile.releaseRequirement');
    return {
      requirementId: newUuidV7(),
      requirementType: storedString(
        requirement.requirementType ?? requirement.purpose ?? 'profile_compliance',
        'QualityProfile.releaseRequirement.requirementType',
      ),
      profileRef: profile.ref,
      satisfied: reasons.size === 0,
    };
  });
  const purposeValue = storedObject(
    profile.definition.releaseRequirements[0],
    'QualityProfile.releaseRequirement',
  );
  const purpose = storedString(
    purposeValue.purpose ?? purposeValue.requirementType ?? 'RELEASE_READINESS',
    'QualityProfile.releaseRequirement.purpose',
  );
  const status: Common.ReleaseReadinessStatus =
    inspection.invalidatedIds.size > 0
      ? 'STALE'
      : reasons.size === 0
        ? 'READY_FOR_AUTHORIZATION'
        : 'NOT_READY';
  const revisionRef = firstTarget.revisionRef;
  const snapshot = {
    header: contractHeader('zhiju.contract.release_readiness', input.evaluatedAtText, context),
    snapshotId,
    releaseRef: input.releasePackageRef.releaseRef,
    artifactRef: artifactRefFromRowOrRevision(firstRow, revisionRef),
    revisionRef,
    approvalBundleSnapshotRef: input.approvalBundleSnapshotRef,
    releasePackageRef: input.releasePackageRef,
    purpose,
    recipientScopeSnapshotRef: input.recipientScopeSnapshotRef,
    destinationRefs: input.destinationRefs,
    releaseRequirements,
    requiredReleaseGateSpecs: required,
    releaseGateResultRefs: input.releaseGateResultRefs,
    readiness: {
      status,
      reasons: readinessReasons(reasons),
    },
    evaluatedAt: input.evaluatedAtText,
  } as unknown as Core.ReleaseReadinessSnapshot;
  return {
    snapshot,
    status,
    ...(revisionRef.scope.projectId === undefined
      ? {}
      : { projectId: revisionRef.scope.projectId }),
    revisionContentHash: contentRefHash(revisionRef),
  };
}

export async function handleEvaluateRevisionReadiness(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityCommandEnvelope<EvaluateRevisionReadinessPayload>,
): Promise<CommandResult> {
  commandTarget(envelope, REVISION_SNAPSHOT_OBJECT_TYPE, QUALITY_GATE_INPUT_MISMATCH);
  const validated = validateRevisionReadinessInput(envelope.payload, context);
  const normalizedEnvelope = normalizeEnvelopeProject(
    envelope,
    validated.revisionRef.scope.projectId,
    REVISION_SNAPSHOT_OBJECT_TYPE,
    QUALITY_GATE_INPUT_MISMATCH,
  );
  return executeQualityGovernanceCommand(
    db,
    context,
    normalizedEnvelope,
    async (execution): Promise<CommandBodyResult> => {
      const evaluated = await buildRevisionAcceptanceSnapshot(
        execution.trx,
        context,
        validated,
        normalizedEnvelope.targetId,
      );
      const payloadHash = digestCanonicalPayload(
        evaluated.snapshot as unknown as CanonicalJsonObject,
      ).hash;
      const outcome = await repo.insertRevisionAcceptanceSnapshot(execution.trx, {
        snapshotId: normalizedEnvelope.targetId,
        enterpriseId: context.enterpriseId,
        ...(evaluated.projectId === undefined ? {} : { projectId: evaluated.projectId }),
        snapshot: evaluated.snapshot,
        revisionContentHash: evaluated.revisionContentHash,
        payloadHash,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        createdByAuthorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      if (outcome !== 'OK') {
        return mapWriteOutcome(outcome, QUALITY_REVISION_ACCEPTANCE_NOT_READY);
      }
      const snapshotRef = snapshotRefForRow(
        REVISION_SNAPSHOT_OBJECT_TYPE,
        normalizedEnvelope.targetId,
        context.enterpriseId,
        evaluated.projectId ?? null,
        payloadHash,
      );
      const ownerHash = payloadHash;
      await appendReferenceTarget(
        execution,
        REVISION_SNAPSHOT_OBJECT_TYPE,
        normalizedEnvelope.targetId,
        ownerHash,
        '/revisionRef',
        evaluated.snapshot.revisionRef,
        'REVISION_ACCEPTANCE_REVISION',
      );
      await appendReferenceTarget(
        execution,
        REVISION_SNAPSHOT_OBJECT_TYPE,
        normalizedEnvelope.targetId,
        ownerHash,
        '/qualityProfileRef',
        evaluated.snapshot.qualityProfileRef,
        'REVISION_ACCEPTANCE_PROFILE',
      );
      await appendReferenceTarget(
        execution,
        REVISION_SNAPSHOT_OBJECT_TYPE,
        normalizedEnvelope.targetId,
        ownerHash,
        '/evidenceStatusSnapshotRef',
        evaluated.snapshot.evidenceStatusSnapshotRef,
        'REVISION_ACCEPTANCE_EVIDENCE_SNAPSHOT',
      );
      for (const [index, ref] of evaluated.snapshot.gateResultRefs.entries()) {
        await appendReferenceTarget(
          execution,
          REVISION_SNAPSHOT_OBJECT_TYPE,
          normalizedEnvelope.targetId,
          ownerHash,
          `/gateResultRefs/${index}`,
          ref,
          'REVISION_ACCEPTANCE_GATE_RESULT',
        );
      }
      if (evaluated.status === 'READY') {
        const eventPayload = {
          enterpriseId: context.enterpriseId,
          ...(evaluated.projectId === undefined ? {} : { projectId: evaluated.projectId }),
          artifactRef: evaluated.snapshot.artifactRef,
          revisionRef: evaluated.snapshot.revisionRef,
          revisionAcceptanceSnapshotRef: snapshotRef,
          qualityProfileRef: evaluated.snapshot.qualityProfileRef,
        } as unknown as CanonicalJsonObject;
        await execution.appendOutbox({
          eventId: newUuidV7(),
          eventType: 'quality.RevisionQualityReady',
          eventVersion: '1.0',
          aggregateType: REVISION_SNAPSHOT_OBJECT_TYPE,
          aggregateId: normalizedEnvelope.targetId,
          aggregateVersion: '1',
          payload: eventPayload,
          occurredAt: validated.evaluatedAt,
        });
      }
      return {
        kind: 'COMMITTED',
        resultPayload: {
          snapshotRef: snapshotRef as unknown as CanonicalJsonValue,
          readinessStatus: evaluated.status,
          snapshot: evaluated.snapshot as unknown as CanonicalJsonValue,
        },
      };
    },
  );
}

export async function handleEvaluateReleaseGateReadiness(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityCommandEnvelope<EvaluateReleaseReadinessPayload>,
): Promise<CommandResult> {
  commandTarget(envelope, RELEASE_SNAPSHOT_OBJECT_TYPE, QUALITY_GATE_INPUT_MISMATCH);
  const validated = validateReleaseReadinessInput(envelope.payload, context);
  const firstRef = validated.releaseGateResultRefs[0];
  const firstVisible =
    firstRef === undefined
      ? undefined
      : await withQualityGovernanceTransaction(db, context, (trx) =>
          exactGateResult(trx, context, firstRef),
        );
  const derivedProjectId =
    firstVisible?.project_id === null || firstVisible === undefined
      ? undefined
      : firstVisible.project_id;
  const normalizedEnvelope = normalizeEnvelopeProject(
    envelope,
    derivedProjectId,
    RELEASE_SNAPSHOT_OBJECT_TYPE,
    QUALITY_GATE_INPUT_MISMATCH,
  );
  return executeQualityGovernanceCommand(
    db,
    context,
    normalizedEnvelope,
    async (execution): Promise<CommandBodyResult> => {
      const evaluated = await buildReleaseReadinessSnapshot(
        execution.trx,
        context,
        validated,
        normalizedEnvelope.targetId,
      );
      const payloadHash = digestCanonicalPayload(
        evaluated.snapshot as unknown as CanonicalJsonObject,
      ).hash;
      const outcome = await repo.insertReleaseReadinessSnapshot(execution.trx, {
        snapshotId: normalizedEnvelope.targetId,
        enterpriseId: context.enterpriseId,
        ...(evaluated.projectId === undefined ? {} : { projectId: evaluated.projectId }),
        snapshot: evaluated.snapshot,
        revisionContentHash: evaluated.revisionContentHash,
        payloadHash,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        createdByAuthorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      if (outcome !== 'OK') {
        return mapWriteOutcome(outcome, QUALITY_RELEASE_READINESS_NOT_READY);
      }
      const snapshotRef = snapshotRefForRow(
        RELEASE_SNAPSHOT_OBJECT_TYPE,
        normalizedEnvelope.targetId,
        context.enterpriseId,
        evaluated.projectId ?? null,
        payloadHash,
      );
      await appendReferenceTarget(
        execution,
        RELEASE_SNAPSHOT_OBJECT_TYPE,
        normalizedEnvelope.targetId,
        payloadHash,
        '/releaseRef',
        evaluated.snapshot.releaseRef,
        'RELEASE_READINESS_RELEASE',
      );
      await appendReferenceTarget(
        execution,
        RELEASE_SNAPSHOT_OBJECT_TYPE,
        normalizedEnvelope.targetId,
        payloadHash,
        '/revisionRef',
        evaluated.snapshot.revisionRef,
        'RELEASE_READINESS_REVISION',
      );
      await appendReferenceTarget(
        execution,
        RELEASE_SNAPSHOT_OBJECT_TYPE,
        normalizedEnvelope.targetId,
        payloadHash,
        '/approvalBundleSnapshotRef',
        evaluated.snapshot.approvalBundleSnapshotRef,
        'RELEASE_READINESS_APPROVAL_SNAPSHOT',
      );
      await appendReferenceTarget(
        execution,
        RELEASE_SNAPSHOT_OBJECT_TYPE,
        normalizedEnvelope.targetId,
        payloadHash,
        '/releasePackageRef/packageSnapshotRef',
        evaluated.snapshot.releasePackageRef.packageSnapshotRef,
        'RELEASE_READINESS_PACKAGE_SNAPSHOT',
      );
      await appendReferenceTarget(
        execution,
        RELEASE_SNAPSHOT_OBJECT_TYPE,
        normalizedEnvelope.targetId,
        payloadHash,
        '/recipientScopeSnapshotRef',
        evaluated.snapshot.recipientScopeSnapshotRef,
        'RELEASE_READINESS_RECIPIENT_SCOPE',
      );
      for (const [index, ref] of evaluated.snapshot.releaseGateResultRefs.entries()) {
        await appendReferenceTarget(
          execution,
          RELEASE_SNAPSHOT_OBJECT_TYPE,
          normalizedEnvelope.targetId,
          payloadHash,
          `/releaseGateResultRefs/${index}`,
          ref,
          'RELEASE_READINESS_GATE_RESULT',
        );
      }
      if (evaluated.status === 'READY_FOR_AUTHORIZATION') {
        const eventPayload = {
          enterpriseId: context.enterpriseId,
          ...(evaluated.projectId === undefined ? {} : { projectId: evaluated.projectId }),
          releaseRef: evaluated.snapshot.releaseRef,
          releasePackageRef: evaluated.snapshot.releasePackageRef,
          releaseReadinessSnapshotRef: snapshotRef,
          readyAt: validated.evaluatedAtText,
        } as unknown as CanonicalJsonObject;
        await execution.appendOutbox({
          eventId: newUuidV7(),
          eventType: 'quality.ReleaseGateReady',
          eventVersion: '1.0',
          aggregateType: RELEASE_SNAPSHOT_OBJECT_TYPE,
          aggregateId: normalizedEnvelope.targetId,
          aggregateVersion: '1',
          payload: eventPayload,
          occurredAt: validated.evaluatedAt,
        });
      }
      return {
        kind: 'COMMITTED',
        resultPayload: {
          snapshotRef: snapshotRef as unknown as CanonicalJsonValue,
          readinessStatus: evaluated.status,
          snapshot: evaluated.snapshot as unknown as CanonicalJsonValue,
        },
      };
    },
  );
}

function dependencyOrder(specs: readonly CanonicalJsonValue[]): readonly string[] {
  const ids = specs.map((item) =>
    storedString(storedObject(item, 'QualityProfile.gateSpec').gateSpecId, 'gateSpecId'),
  );
  const idSet = new Set(ids);
  const prerequisites = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  for (const item of specs) {
    const gate = storedObject(item, 'QualityProfile.gateSpec');
    const dependencies = Array.isArray(gate.dependencyGateSpecIds)
      ? gate.dependencyGateSpecIds
      : [];
    for (const dependency of dependencies) {
      if (typeof dependency === 'string' && idSet.has(dependency)) {
        prerequisites.get(storedString(gate.gateSpecId, 'gateSpecId'))?.add(dependency);
      }
    }
  }
  const ordered: string[] = [];
  const remaining = new Set(ids);
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) => [...(prerequisites.get(id) ?? [])].every((item) => ordered.includes(item)))
      .sort();
    if (ready.length === 0) return ids;
    for (const id of ready) {
      remaining.delete(id);
      ordered.push(id);
    }
  }
  return ordered;
}

export async function handleGetGatePlan(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  payload: GetGatePlanPayload,
): Promise<QualityGovernance.GatePlan> {
  const target = validateGateTarget(payload.target, context);
  const qualityProfileRef = exactQualityProfileRef(payload.qualityProfileRef, context);
  const changeImpactRef =
    payload.changeImpactRef === undefined
      ? undefined
      : validateContentAddressedRef(
          payload.changeImpactRef,
          context,
          'get_gate_plan.changeImpactRef',
          new Set([CHANGE_IMPACT_OBJECT_TYPE]),
        );
  return withQualityGovernanceTransaction(db, context, async (trx) => {
    const profile = await exactProfile(trx, context, qualityProfileRef, false);
    if (profile === undefined) {
      throw new QualityBusinessError(
        QUALITY_PROFILE_QUERY_NOT_FOUND,
        'the exact QualityProfile version was not found',
      );
    }
    const stage = stageForTarget(target);
    const applicable = profile.definition.gateSpecs
      .filter((item) => storedObject(item, 'QualityProfile.gateSpec').evaluationStage === stage)
      .map((item) => storedValue(item, 'QualityProfile.gateSpec'));
    let impact: ChangeImpactTable | undefined;
    if (changeImpactRef !== undefined) {
      impact = await exactChangeImpact(trx, context, changeImpactRef);
      if (
        impact === undefined ||
        (impact.project_id ?? undefined) !== (target.revisionRef.scope.projectId ?? undefined)
      ) {
        throw new QualityBusinessError(
          QUALITY_CHANGE_IMPACT_QUERY_NOT_FOUND,
          'the exact ChangeImpact was not found',
        );
      }
    }
    const reuseDecisions = applicable.map((item) => {
      const spec = storedObject(item, 'QualityProfile.gateSpec');
      let decision = 'REEXECUTE_REQUIRED';
      let reason = 'CHANGE_IMPACT_REQUIRED';
      if (impact?.impact_status === 'LIVE') {
        try {
          const impactShape = changeImpactShape(impact.definition);
          const gateSpecId = storedString(spec.gateSpecId, 'gateSpecId');
          if (policyAllowsImpactReuse(profile.definition, gateSpecId, 'PASS')) {
            if (coverageSufficient(impactShape, gateSpecId)) {
              decision = 'REUSE_ALLOWED';
              reason = 'EXACT_IMPACT_COVERAGE_SUFFICIENT';
            } else {
              reason = QUALITY_INCREMENTAL_COVERAGE_INSUFFICIENT;
            }
          } else {
            reason = QUALITY_GATE_REUSE_NOT_ALLOWED;
          }
        } catch {
          reason = QUALITY_INCREMENTAL_COVERAGE_INSUFFICIENT;
        }
      }
      return {
        gateSpecId: storedString(spec.gateSpecId, 'gateSpecId'),
        decision,
        reason,
      };
    });
    const planWithoutHash = {
      target,
      qualityProfileRef: profile.ref,
      applicableGateSpecs: applicable,
      dependencyOrder: dependencyOrder(applicable),
      reuseDecisions,
    } as unknown as CanonicalJsonObject;
    return {
      ...planWithoutHash,
      planHash: hashFromCanonical(planWithoutHash),
    } as unknown as QualityGovernance.GatePlan;
  });
}

function cursorOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as RecordLike;
    return typeof decoded.offset === 'number' &&
      Number.isSafeInteger(decoded.offset) &&
      decoded.offset >= 0
      ? decoded.offset
      : 0;
  } catch {
    return 0;
  }
}

export async function handleGetGateResults(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  payload: GetGateResultsPayload,
): Promise<QualityGovernance.GateResultPage> {
  const target = validateGateTarget(payload.target, context);
  const qualityProfileRef =
    payload.qualityProfileRef === undefined
      ? undefined
      : exactQualityProfileRef(payload.qualityProfileRef, context);
  const gateSpecIds = Array.isArray(payload.gateSpecIds)
    ? new Set(payload.gateSpecIds)
    : new Set<string>();
  const outcomes = Array.isArray(payload.outcomes)
    ? new Set(payload.outcomes)
    : new Set<GateOutcome>();
  const pageSize = payload.page.pageSize;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new QualityBusinessError(QUALITY_GATE_INPUT_MISMATCH, 'page.pageSize must be positive');
  }
  return withQualityGovernanceTransaction(db, context, async (trx) => {
    const rows = await repo.getGateResults(trx);
    const filtered: {
      readonly row: GateResultTable;
      readonly target: QualityGovernance.GateTarget;
      readonly validity: string;
    }[] = [];
    for (const row of rows) {
      if (!exactJsonEqual(row.gate_target, target)) continue;
      if (
        qualityProfileRef !== undefined &&
        !exactJsonEqual(row.quality_profile_ref, qualityProfileRef)
      ) {
        continue;
      }
      if (gateSpecIds.size > 0 && !gateSpecIds.has(row.gate_spec_id)) continue;
      if (outcomes.size > 0 && !outcomes.has(row.outcome)) continue;
      const rowTarget = targetForRow(row, context);
      const invalidated = await repo.getGateInvalidationByGateResultId(trx, row.gate_result_id);
      if (payload.validOnly && invalidated !== undefined) continue;
      filtered.push({
        row,
        target: rowTarget,
        validity: invalidated === undefined ? 'VALID' : 'INVALIDATED',
      });
    }
    const offset = cursorOffset(payload.page.cursor);
    const page = filtered.slice(offset, offset + pageSize);
    const nextOffset = offset + page.length;
    const snapshotAt = new Date().toISOString();
    const nextCursor =
      nextOffset < filtered.length
        ? Buffer.from(JSON.stringify({ offset: nextOffset }), 'utf8').toString('base64url')
        : undefined;
    return {
      items: page.map(({ row, target: rowTarget, validity }) =>
        gateResultView(row, rowTarget, validity),
      ),
      ...(nextCursor === undefined ? {} : { nextCursor }),
      snapshotAt,
      sourceWatermarks: [
        {
          sourceModule: 'quality-governance',
          sequence: filtered.length,
          observedAt: snapshotAt,
        },
      ],
    };
  });
}

function exactSnapshotQueryRef(
  value: unknown,
  context: QualityTransactionContext,
  expectedObjectType: string,
): Common.SnapshotRef {
  const ref = validateSnapshotRef(value, context, 'snapshotRef');
  if (ref.objectType !== expectedObjectType) {
    throw new QualityBusinessError(
      QUALITY_READINESS_SNAPSHOT_QUERY_NOT_FOUND,
      'snapshotRef does not identify the expected readiness snapshot',
    );
  }
  return ref;
}

export async function handleGetRevisionAcceptanceSnapshot(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  payload: GetRevisionAcceptanceSnapshotPayload,
): Promise<Core.RevisionAcceptanceSnapshot> {
  const requested = exactSnapshotQueryRef(
    payload.snapshotRef,
    context,
    REVISION_SNAPSHOT_OBJECT_TYPE,
  );
  return withQualityGovernanceTransaction(db, context, async (trx) => {
    const row = await repo.getRevisionAcceptanceSnapshotById(trx, requested.snapshotId);
    if (row === undefined) {
      throw new QualityBusinessError(
        QUALITY_READINESS_SNAPSHOT_QUERY_NOT_FOUND,
        'RevisionAcceptanceSnapshot was not found',
      );
    }
    if (
      row.enterprise_id !== context.enterpriseId ||
      (row.project_id ?? undefined) !== (requested.scope.projectId ?? undefined) ||
      !row.payload_hash.equals(snapshotRefHash(requested))
    ) {
      throw new QualityBusinessError(
        QUALITY_READINESS_SNAPSHOT_QUERY_NOT_FOUND,
        'RevisionAcceptanceSnapshot was not found',
      );
    }
    const stored = storedObject(row.snapshot, 'RevisionAcceptanceSnapshot.snapshot');
    if (stored.snapshotId !== requested.snapshotId) {
      throw new QualityBusinessError(
        QUALITY_READINESS_SNAPSHOT_QUERY_NOT_FOUND,
        'RevisionAcceptanceSnapshot was not found',
      );
    }
    return stored as unknown as Core.RevisionAcceptanceSnapshot;
  });
}

export async function handleGetReleaseReadinessSnapshot(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  payload: GetReleaseReadinessSnapshotPayload,
): Promise<Core.ReleaseReadinessSnapshot> {
  const requested = exactSnapshotQueryRef(
    payload.snapshotRef,
    context,
    RELEASE_SNAPSHOT_OBJECT_TYPE,
  );
  return withQualityGovernanceTransaction(db, context, async (trx) => {
    const row = await repo.getReleaseReadinessSnapshotById(trx, requested.snapshotId);
    if (row === undefined) {
      throw new QualityBusinessError(
        QUALITY_READINESS_SNAPSHOT_QUERY_NOT_FOUND,
        'ReleaseReadinessSnapshot was not found',
      );
    }
    if (
      row.enterprise_id !== context.enterpriseId ||
      (row.project_id ?? undefined) !== (requested.scope.projectId ?? undefined) ||
      !row.payload_hash.equals(snapshotRefHash(requested))
    ) {
      throw new QualityBusinessError(
        QUALITY_READINESS_SNAPSHOT_QUERY_NOT_FOUND,
        'ReleaseReadinessSnapshot was not found',
      );
    }
    const stored = storedObject(row.snapshot, 'ReleaseReadinessSnapshot.snapshot');
    if (stored.snapshotId !== requested.snapshotId) {
      throw new QualityBusinessError(
        QUALITY_READINESS_SNAPSHOT_QUERY_NOT_FOUND,
        'ReleaseReadinessSnapshot was not found',
      );
    }
    return stored as unknown as Core.ReleaseReadinessSnapshot;
  });
}
