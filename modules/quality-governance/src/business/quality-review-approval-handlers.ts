// IM-05 WI-04 (issue #124): ReviewIssue remediation and Human Approval
// handlers. Every mutation keeps its business fact, technical receipt, audit,
// outbox, and reference edges inside the trusted QualityGovernance transaction.

import type { Kysely } from 'kysely';
import type { Common, Core, QualityGovernance } from '@zhiju/contracts';
import { ContractRegistry } from '@zhiju/contracts';
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
  executeQualityGovernanceCommand,
  type CommandBodyResult,
  type CommandEnvelope,
  type CommandResult,
  type CommandExecution,
} from '../persistence/command-runner.js';
import {
  QualityBusinessRepository,
  type BusinessWriteOutcome,
} from '../persistence/quality-business-repository.js';
import type {
  ApprovalTable,
  ApprovalBundleSnapshotTable,
  ApprovalRequestTable,
  QualityProfileApprovalRequirementTable,
  QualityProfileTable,
  QualityProfileVersionTable,
  ReviewIssueTable,
  ResolutionProposalTable,
  RevisionAcceptanceSnapshotTable,
  VerificationRecordTable,
} from '../persistence/quality-business-types.js';
import {
  QUALITY_ABS_CONTRACT_INVALID,
  QUALITY_AGENT_DISMISSAL_FORBIDDEN,
  QUALITY_APPROVAL_AGENT_FORBIDDEN,
  QUALITY_APPROVAL_ALREADY_REVOKED,
  QUALITY_APPROVAL_BLOCKING_ISSUE_OPEN,
  QUALITY_APPROVAL_GATE_BUNDLE_INVALID,
  QUALITY_APPROVAL_IDENTITY_CONFLICT,
  QUALITY_APPROVAL_INVALID,
  QUALITY_APPROVAL_QUERY_NOT_FOUND,
  QUALITY_APPROVAL_REQUEST_EXPIRED,
  QUALITY_APPROVAL_REQUIREMENTS_INCOMPLETE,
  QUALITY_APPROVAL_REVISION_MISMATCH,
  QUALITY_ISSUE_VERIFICATION_REQUIRED,
  QUALITY_REVIEW_ISSUE_INVALID,
  QUALITY_REVIEW_ISSUE_QUERY_NOT_FOUND,
  QUALITY_SEPARATION_OF_DUTIES_VIOLATION,
  QUALITY_REVISION_ACCEPTANCE_NOT_READY,
  QualityBusinessError,
} from './quality-business-errors.js';
import {
  validateApprovalRequestDefinition,
  validateApprovalRevocation,
  validateApprovalSubmission,
  validateIssueCloseReason,
  validateIssueResolution,
  validateIssueVerification,
  validateReviewIssueDefinition,
  contentAddressedHash,
  objectRefForIssue,
  type ValidatedApprovalSubmission,
} from './quality-review-approval-validation.js';
import { validateContentAddressedRef, validateSnapshotRef } from './quality-gate-validation.js';

const repo = new QualityBusinessRepository();
const REVIEW_ISSUE_OBJECT_TYPE = 'quality.review_issue';
const ISSUE_RESOLUTION_OBJECT_TYPE = 'quality.issue_resolution';
const ISSUE_VERIFICATION_OBJECT_TYPE = 'quality.issue_verification';
const APPROVAL_REQUEST_OBJECT_TYPE = 'quality.approval_request';
const APPROVAL_OBJECT_TYPE = 'quality.approval';
const APPROVAL_DECISION_OBJECT_TYPE = 'quality.approval_decision';
const APPROVAL_REVOCATION_OBJECT_TYPE = 'quality.approval_revocation';
const APPROVAL_BUNDLE_OBJECT_TYPE = 'quality.approval_bundle_snapshot';
const REVISION_OBJECT_TYPE = 'artifact.artifact_revision';
const RAS_OBJECT_TYPE = 'quality.revision_acceptance_snapshot';
const QUALITY_PROFILE_OBJECT_TYPE = 'quality.quality_profile';
const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export type QualityReviewApprovalCommandEnvelope<TPayload> = CommandEnvelope & {
  readonly payload: TPayload;
};
export type RaiseReviewIssuePayload = QualityGovernance.QualityRaiseReviewIssuePayload;
export type ProposeIssueResolutionPayload = QualityGovernance.QualityProposeIssueResolutionPayload;
export type VerifyIssueResolutionPayload = QualityGovernance.QualityVerifyIssueResolutionPayload;
export type CloseReviewIssuePayload = QualityGovernance.QualityCloseReviewIssuePayload;
export type RequestApprovalPayload = QualityGovernance.QualityRequestApprovalPayload;
export type SubmitApprovalDecisionPayload = QualityGovernance.QualitySubmitApprovalDecisionPayload;
export type RevokeApprovalPayload = QualityGovernance.QualityRevokeApprovalPayload;
export type GetOpenBlockingIssuesPayload = QualityGovernance.QualityGetOpenBlockingIssuesPayload;
export type GetApprovalBundleSnapshotPayload =
  QualityGovernance.QualityGetApprovalBundleSnapshotPayload;

type RecordLike = Readonly<Record<string, unknown>>;
type IssueStatus = QualityGovernance.IssueStatus;

interface ExactProfile {
  readonly profile: QualityProfileTable;
  readonly version: QualityProfileVersionTable;
  readonly ref: Common.VersionedRef;
  readonly definition: QualityGovernance.QualityProfileDefinition;
  readonly requirements: readonly QualityProfileApprovalRequirementTable[];
}

function record(value: unknown, label: string, code: string): RecordLike {
  const parsed = typeof value === 'string' ? parseStored(value, label, code) : value;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new QualityBusinessError(code, `${label} is not a JSON object`);
  }
  return parsed as RecordLike;
}

function parseStored(value: string, label: string, code: string): CanonicalJsonValue {
  try {
    return JSON.parse(value) as CanonicalJsonValue;
  } catch {
    throw new QualityBusinessError(code, `${label} contains invalid stored JSON`);
  }
}

function storedObject(value: unknown, label: string, code: string): RecordLike {
  return record(value, label, code);
}

function storedArray(value: unknown, label: string, code: string): readonly CanonicalJsonValue[] {
  const parsed = typeof value === 'string' ? parseStored(value, label, code) : value;
  if (!Array.isArray(parsed)) {
    throw new QualityBusinessError(code, `${label} is not a stored JSON array`);
  }
  return parsed as readonly CanonicalJsonValue[];
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
    throw new QualityBusinessError(code, 'command target does not identify the expected object');
  }
}

function aggregateVersion(value: unknown, label: string, code: string): string {
  const result = String(value);
  if (!/^\d+$/.test(result) || BigInt(result) < 1n) {
    throw new QualityBusinessError(code, `${label} is not a valid aggregate version`);
  }
  return result;
}

function expectedVersion(value: string | undefined, label: string, code: string): string {
  if (value === undefined || !/^\d+$/.test(value) || BigInt(value) < 1n) {
    throw new QualityBusinessError(code, `${label} must be a positive aggregate version`);
  }
  return value;
}

function sameScope(left: Common.ScopeRef, right: Common.ScopeRef): boolean {
  return (
    left.enterpriseId === right.enterpriseId &&
    (left.projectId ?? undefined) === (right.projectId ?? undefined)
  );
}

function scopeOfIssue(row: ReviewIssueTable): Common.ScopeRef {
  return {
    enterpriseId: row.enterprise_id,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
  };
}

function scopeOfRequest(row: ApprovalRequestTable): Common.ScopeRef {
  return {
    enterpriseId: row.enterprise_id,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
  };
}

function scopeOfApproval(row: ApprovalTable): Common.ScopeRef {
  return {
    enterpriseId: row.enterprise_id,
    ...(row.project_id === null ? {} : { projectId: row.project_id }),
  };
}

function hashFromBytes(value: Buffer): Common.ContentHash {
  if (value.length !== 32) throw new Error('stored QualityGovernance hash is not 32 bytes');
  return {
    algorithm: 'SHA-256',
    digest: value.toString('hex'),
    canonicalizationVersion: '1',
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
    scope: {
      enterpriseId,
      ...(projectId === null ? {} : { projectId }),
    },
    contentHash: hashFromBytes(payloadHash),
  };
}

function issueRef(row: ReviewIssueTable): Common.ObjectRef {
  return objectRefForIssue(row.review_issue_id, scopeOfIssue(row));
}

function resolutionRef(row: ResolutionProposalTable): Common.ContentAddressedRef {
  return contentRefForRow(
    ISSUE_RESOLUTION_OBJECT_TYPE,
    row.resolution_id,
    row.enterprise_id,
    row.project_id,
    row.payload_hash,
  );
}

function verificationRef(row: VerificationRecordTable): Common.ContentAddressedRef {
  return contentRefForRow(
    ISSUE_VERIFICATION_OBJECT_TYPE,
    row.verification_id,
    row.enterprise_id,
    row.project_id,
    row.payload_hash,
  );
}

function approvalRef(row: ApprovalTable): Common.ContentAddressedRef {
  return contentRefForRow(
    APPROVAL_OBJECT_TYPE,
    row.approval_id,
    row.enterprise_id,
    row.project_id,
    row.payload_hash,
  );
}

function approvalDecisionRef(row: {
  readonly decision_id: string;
  readonly enterprise_id: string;
  readonly project_id: string | null;
  readonly payload_hash: Buffer;
}): Common.ContentAddressedRef {
  return contentRefForRow(
    APPROVAL_DECISION_OBJECT_TYPE,
    row.decision_id,
    row.enterprise_id,
    row.project_id,
    row.payload_hash,
  );
}

function revocationRef(row: {
  readonly revocation_id: string;
  readonly enterprise_id: string;
  readonly project_id: string | null;
  readonly payload_hash: Buffer;
}): Common.ContentAddressedRef {
  return contentRefForRow(
    APPROVAL_REVOCATION_OBJECT_TYPE,
    row.revocation_id,
    row.enterprise_id,
    row.project_id,
    row.payload_hash,
  );
}

function snapshotRef(row: ApprovalBundleSnapshotTable): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType: APPROVAL_BUNDLE_OBJECT_TYPE,
    objectId: row.snapshot_id,
    snapshotId: row.snapshot_id,
    scope: {
      enterpriseId: row.enterprise_id,
      ...(row.project_id === null ? {} : { projectId: row.project_id }),
    },
    contentHash: hashFromBytes(row.payload_hash),
  };
}

function storedValue(value: unknown, label: string, code: string): CanonicalJsonValue {
  return typeof value === 'string'
    ? parseStored(value, label, code)
    : (value as CanonicalJsonValue);
}

function exactStoredObject(value: unknown, label: string, code: string): RecordLike {
  return storedObject(storedValue(value, label, code), label, code);
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
    scope: { enterpriseId: profile.enterprise_id },
  };
}

function exactReferenceEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalize(left as CanonicalJsonValue) === canonicalize(right as CanonicalJsonValue);
  } catch {
    return false;
  }
}

function hashOfCanonical(value: CanonicalJsonObject): Buffer {
  return digestCanonicalPayload(value).hash;
}

function assertEnvelopeScope(
  envelope: CommandEnvelope,
  scope: Common.ScopeRef,
  code: string,
): void {
  if (
    envelope.enterpriseId !== scope.enterpriseId ||
    (envelope.projectId ?? undefined) !== (scope.projectId ?? undefined)
  ) {
    throw new QualityBusinessError(code, 'command scope does not match the exact business target');
  }
}

function normalizeEnvelope(
  envelope: CommandEnvelope,
  scope: Common.ScopeRef,
  targetType: string,
): CommandEnvelope {
  return {
    ...envelope,
    targetType,
    ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
  };
}

function issueStatusIsOpen(status: IssueStatus): boolean {
  return !new Set<IssueStatus>(['CLOSED', 'DISMISSED', 'DUPLICATE', 'SUPERSEDED']).has(status);
}

function issuePolicy(profile: ExactProfile): RecordLike {
  return exactStoredObject(
    profile.definition.issuePolicy,
    'QualityProfile.issuePolicy',
    QUALITY_APPROVAL_REQUIREMENTS_INCOMPLETE,
  );
}

function issueIsBlocking(row: ReviewIssueTable, profile: ExactProfile): boolean {
  const policy = issuePolicy(profile);
  const levels = Array.isArray(policy.blockingLevels)
    ? policy.blockingLevels.filter((item): item is string => typeof item === 'string')
    : [];
  return (
    levels.includes(row.severity) ||
    levels.includes(row.blocking_classification) ||
    /block|required|critical|major/i.test(row.blocking_classification) ||
    row.severity === 'CRITICAL' ||
    row.severity === 'MAJOR'
  );
}

function hasOpenBlockingIssue(
  issues: readonly ReviewIssueTable[],
  profile: ExactProfile,
  artifactRef: unknown,
): boolean {
  return issues.some(
    (row) =>
      issueStatusIsOpen(row.status) &&
      issueIsBlocking(row, profile) &&
      exactReferenceEqual(row.artifact_ref, artifactRef),
  );
}

function separationProhibitsSelfReview(profile: ExactProfile): boolean {
  const policy = exactStoredObject(
    profile.definition.separationOfDutiesPolicy,
    'QualityProfile.separationOfDutiesPolicy',
    QUALITY_SEPARATION_OF_DUTIES_VIOLATION,
  );
  return [policy.allowSelfReview, policy.selfReviewAllowed, policy.authorMayReviewOwnWork].some(
    (value) => value === false,
  );
}

function principalFromStored(value: unknown, label: string): Common.PrincipalRef | undefined {
  const parsed = exactStoredObject(value, label, QUALITY_REVIEW_ISSUE_QUERY_NOT_FOUND);
  if (typeof parsed.principalId !== 'string' || typeof parsed.principalKind !== 'string')
    return undefined;
  if (!isUuidV7(parsed.principalId)) return undefined;
  return {
    principalKind: parsed.principalKind as Common.PrincipalRef['principalKind'],
    principalId: parsed.principalId,
  };
}

function exactRasSnapshot(
  row: RevisionAcceptanceSnapshotTable,
  requested: Common.SnapshotRef,
  revisionRef: Common.ContentAddressedRef,
  artifactRef: Common.ObjectRef,
): boolean {
  return (
    row.enterprise_id === requested.scope.enterpriseId &&
    (row.project_id ?? undefined) === (requested.scope.projectId ?? undefined) &&
    row.snapshot_id === requested.snapshotId &&
    row.payload_hash.equals(contentAddressedHash(requested)) &&
    exactReferenceEqual(row.revision_ref, revisionRef) &&
    exactReferenceEqual(row.artifact_ref, artifactRef)
  );
}

async function exactProfile(
  trx: QualityTransaction,
  context: QualityTransactionContext,
  requested: Common.VersionedRef,
): Promise<ExactProfile | undefined> {
  const profile = await repo.getQualityProfileById(trx, requested.objectId);
  const version = await repo.getQualityProfileVersionById(trx, requested.versionId);
  if (
    profile === undefined ||
    version === undefined ||
    profile.enterprise_id !== context.enterpriseId ||
    profile.project_id !== null ||
    version.quality_profile_id !== profile.quality_profile_id ||
    requested.scope.projectId !== undefined ||
    version.enterprise_id !== context.enterpriseId
  ) {
    return undefined;
  }
  return {
    profile,
    version,
    ref: profileRefForRow(profile, version),
    definition: exactStoredObject(
      version.definition,
      'QualityProfile.definition',
      QUALITY_APPROVAL_REQUIREMENTS_INCOMPLETE,
    ) as unknown as QualityGovernance.QualityProfileDefinition,
    requirements: await repo.getQualityProfileApprovalRequirements(trx, version.profile_version_id),
  };
}

async function exactRevisionAcceptance(
  trx: QualityTransaction,
  context: QualityTransactionContext,
  requested: {
    readonly artifactRef: Common.ObjectRef;
    readonly revisionRef: Common.ContentAddressedRef;
    readonly revisionAcceptanceSnapshotRef: Common.SnapshotRef;
  },
): Promise<RevisionAcceptanceSnapshotTable | undefined> {
  const snapshotRefValue = requested.revisionAcceptanceSnapshotRef;
  const snapshotRef = snapshotRefValue;
  const revisionRef = requested.revisionRef;
  const artifactRef = requested.artifactRef;
  const row = await repo.getRevisionAcceptanceSnapshotById(trx, snapshotRef.snapshotId);
  if (row === undefined) return undefined;
  if (
    row.enterprise_id !== context.enterpriseId ||
    !exactRasSnapshot(row, snapshotRef, revisionRef, artifactRef) ||
    row.status !== 'READY'
  ) {
    return undefined;
  }
  return row;
}

function requirementAsContract(
  row: QualityProfileApprovalRequirementTable,
): Core.ApprovalBundleSnapshot['approvalRequirements'][number] {
  const definition = exactStoredObject(
    row.definition,
    'QualityProfile.approvalRequirement',
    QUALITY_APPROVAL_REQUIREMENTS_INCOMPLETE,
  );
  const ordering =
    typeof definition.ordering === 'string' && definition.ordering.trim().length > 0
      ? definition.ordering
      : 'any';
  const authorizationAssurance =
    typeof definition.authorizationAssurance === 'string' &&
    definition.authorizationAssurance.trim().length > 0
      ? definition.authorizationAssurance
      : 'workflow.approved';
  const separationRules =
    typeof definition.separationRules === 'string' && definition.separationRules.trim().length > 0
      ? definition.separationRules
      : 'must_not_contain_author_of_revision';
  const effectivePeriod =
    definition.effectivePeriod !== undefined &&
    definition.effectivePeriod !== null &&
    typeof definition.effectivePeriod === 'object' &&
    !Array.isArray(definition.effectivePeriod)
      ? exactStoredObject(
          definition.effectivePeriod,
          'QualityProfile.approvalRequirement.effectivePeriod',
          QUALITY_APPROVAL_REQUIREMENTS_INCOMPLETE,
        )
      : {};
  const hasEffectivePeriod =
    typeof effectivePeriod.validFrom === 'string' && typeof effectivePeriod.validTo === 'string';
  return {
    requirementId: row.approval_requirement_id,
    requiredRole: row.required_role,
    requiredCount: row.required_count,
    ordering,
    authorizationAssurance,
    separationRules,
    ...(hasEffectivePeriod
      ? {
          effectivePeriod: {
            validFrom: effectivePeriod.validFrom as string,
            validTo: effectivePeriod.validTo as string,
          },
        }
      : {}),
  };
}

function contractHeader(
  evaluatedAt: string,
  context: QualityTransactionContext,
): Common.ContractHeader {
  return {
    contractId: newUuidV7(),
    contractType: 'zhiju.contract.approval_bundle',
    contractVersion: '1.0',
    schemaRef: {
      kind: 'VERSIONED',
      objectType: 'zhiju.contract.schema',
      objectId: newUuidV7(),
      versionId: newUuidV7(),
      scope: { enterpriseId: context.enterpriseId },
    },
    scopeRef: { enterpriseId: context.enterpriseId },
    issuedAt: evaluatedAt,
    issuedBy: { principalKind: context.principalKind, principalId: context.principalId },
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

function ensureApprovalBundleContract(snapshot: Core.ApprovalBundleSnapshot): void {
  const validation = new ContractRegistry().validateCoreContract(
    'https://schemas.zhiju.local/core/approval-bundle/1.0',
    snapshot,
  );
  if (!validation.valid) {
    const first = validation.errors[0];
    const path =
      first?.instancePath === undefined || first.instancePath === '' ? '/' : first.instancePath;
    throw new QualityBusinessError(
      QUALITY_ABS_CONTRACT_INVALID,
      `ApprovalBundleSnapshot failed Core contract validation at ${path}`,
    );
  }
}

interface ApprovalBundleInput {
  readonly ras: RevisionAcceptanceSnapshotTable;
  readonly profile: ExactProfile;
  readonly approvals: readonly ApprovalTable[];
  readonly evaluatedAt: string;
  readonly snapshotId: string;
  readonly context: QualityTransactionContext;
  readonly staleReason?: string;
}

function buildApprovalBundleSnapshot(input: ApprovalBundleInput): {
  readonly snapshot: Core.ApprovalBundleSnapshot;
  readonly payloadHash: Buffer;
} {
  const rasSnapshot = exactStoredObject(
    input.ras.snapshot,
    'RevisionAcceptanceSnapshot.snapshot',
    QUALITY_APPROVAL_GATE_BUNDLE_INVALID,
  );
  const artifactRef = rasSnapshot.artifactRef as Common.ObjectRef;
  const revisionRef = rasSnapshot.revisionRef as Common.ContentAddressedRef;
  const revisionAcceptanceSnapshotRef = {
    kind: 'SNAPSHOT',
    objectType: RAS_OBJECT_TYPE,
    objectId: input.ras.snapshot_id,
    snapshotId: input.ras.snapshot_id,
    scope: {
      enterpriseId: input.ras.enterprise_id,
      ...(input.ras.project_id === null ? {} : { projectId: input.ras.project_id }),
    },
    contentHash: hashFromBytes(input.ras.payload_hash),
  } as Common.SnapshotRef;
  const requirements = input.profile.requirements.map(requirementAsContract);
  const activeApprovals = input.approvals.filter((row) => row.status === 'EFFECTIVE');
  const approvedApprovals = activeApprovals.filter((row) => row.decision === 'APPROVED');
  const approvalRefs = approvedApprovals.map(approvalRef);
  const counts = new Map<string, number>();
  for (const row of approvedApprovals) {
    counts.set(row.approval_requirement_id, (counts.get(row.approval_requirement_id) ?? 0) + 1);
  }
  const complete = requirements.every(
    (requirement) => (counts.get(requirement.requirementId) ?? 0) >= requirement.requiredCount,
  );
  const completenessStatus: Core.ApprovalBundleSnapshot['completeness']['status'] =
    input.staleReason !== undefined
      ? 'STALE'
      : complete
        ? 'FULLY_APPROVED'
        : approvedApprovals.length > 0
          ? 'PARTIALLY_APPROVED'
          : 'NOT_APPROVED';
  const reasons =
    input.staleReason === undefined
      ? complete
        ? []
        : ['APPROVAL_REQUIREMENT_INCOMPLETE']
      : [input.staleReason];
  const snapshot = {
    header: contractHeader(input.evaluatedAt, input.context),
    snapshotId: input.snapshotId,
    artifactRef,
    revisionRef,
    revisionAcceptanceSnapshotRef,
    qualityProfileRef: input.profile.ref,
    approvalRequirements: requirements,
    approvalRefs,
    separationOfDutiesResult: {
      outcome: input.staleReason === undefined ? 'SATISFIED' : 'INDETERMINATE',
      checkedAt: input.evaluatedAt,
    },
    authorizationSnapshotRefs: [] as Common.SnapshotRef[],
    completeness: {
      status: completenessStatus,
      reasons,
    },
    evaluatedAt: input.evaluatedAt,
  } as unknown as Core.ApprovalBundleSnapshot;
  ensureApprovalBundleContract(snapshot);
  return { snapshot, payloadHash: hashOfCanonical(snapshot as unknown as CanonicalJsonObject) };
}

function approvalDecisionSnapshotRefs(
  decisions: readonly RecordLike[],
): readonly Common.SnapshotRef[] {
  return decisions.flatMap((decision) => {
    const value = decision.approverRoleSnapshotRef;
    if (value === undefined) return [];
    return [value as unknown as Common.SnapshotRef];
  });
}

async function buildApprovalBundle(
  trx: QualityTransaction,
  context: QualityTransactionContext,
  ras: RevisionAcceptanceSnapshotTable,
  profile: ExactProfile,
  approvals: readonly ApprovalTable[],
  evaluatedAt: string,
  snapshotId: string,
  staleReason?: string,
): Promise<{ readonly snapshot: Core.ApprovalBundleSnapshot; readonly payloadHash: Buffer }> {
  const base = buildApprovalBundleSnapshot({
    ras,
    profile,
    approvals,
    evaluatedAt,
    snapshotId,
    context,
    ...(staleReason === undefined ? {} : { staleReason }),
  });
  const decisionRecords: RecordLike[] = [];
  for (const approval of approvals.filter((row) => row.status === 'EFFECTIVE')) {
    const decisions = await repo.getApprovalDecisions(trx, approval.approval_id);
    const latest = decisions[0];
    if (latest !== undefined) {
      decisionRecords.push(
        exactStoredObject(
          latest.definition,
          'ApprovalDecision.definition',
          QUALITY_APPROVAL_INVALID,
        ),
      );
    }
  }
  const withAuthorizationRefs = {
    ...base.snapshot,
    authorizationSnapshotRefs: approvalDecisionSnapshotRefs(decisionRecords),
  } as Core.ApprovalBundleSnapshot;
  ensureApprovalBundleContract(withAuthorizationRefs);
  return {
    snapshot: withAuthorizationRefs,
    payloadHash: hashOfCanonical(withAuthorizationRefs as unknown as CanonicalJsonObject),
  };
}

async function appendReferenceTarget(
  execution: CommandExecution,
  ownerObjectType: string,
  ownerObjectId: string,
  ownerPayloadHash: Buffer,
  referencePath: string,
  target: Common.TypedReference,
  referencePurpose: string,
): Promise<void> {
  const targetRecord = target as unknown as RecordLike;
  const targetObjectType = targetRecord.objectType;
  const targetObjectId = targetRecord.objectId;
  if (typeof targetObjectType !== 'string' || typeof targetObjectId !== 'string') return;
  const kind = targetRecord.kind;
  const contentHashValue = targetRecord.contentHash as RecordLike | undefined;
  const targetPayloadHash =
    contentHashValue && typeof contentHashValue.digest === 'string'
      ? Buffer.from(contentHashValue.digest, 'hex')
      : undefined;
  await execution.appendReferenceEdge({
    ownerObjectType,
    ownerObjectId,
    ownerPayloadHash,
    referencePath,
    targetModule: targetObjectType.split('.')[0] ?? 'quality-governance',
    targetObjectType,
    targetObjectId,
    ...(kind === 'VERSIONED' && typeof targetRecord.versionId === 'string'
      ? { targetVersionId: targetRecord.versionId }
      : {}),
    ...(kind === 'SNAPSHOT' && typeof targetRecord.snapshotId === 'string'
      ? { targetVersionId: targetRecord.snapshotId }
      : {}),
    ...(kind === 'CONTENT_ADDRESSED' && typeof targetRecord.immutableVersionId === 'string'
      ? { targetVersionId: targetRecord.immutableVersionId }
      : {}),
    ...(targetPayloadHash?.length === 32 ? { targetPayloadHash } : {}),
    referencePurpose,
  });
}

function mapWriteOutcome(
  outcome: BusinessWriteOutcome,
  invalidCode: string,
  notFoundCode: string,
  currentAggregateVersion?: string,
  conflictCode = 'CONCURRENCY_CONFLICT',
): CommandBodyResult {
  if (outcome === 'CONFLICT') {
    return rejected(
      conflictCode,
      conflictCode === QUALITY_APPROVAL_IDENTITY_CONFLICT
        ? 'the Human already has a decision for this Approval Request'
        : 'QualityGovernance aggregate version is stale',
      currentAggregateVersion,
    );
  }
  if (outcome === 'NOT_FOUND')
    return rejected(notFoundCode, 'the exact QualityGovernance target was not found');
  if (outcome === 'ALREADY')
    return rejected(QUALITY_APPROVAL_ALREADY_REVOKED, 'the immutable fact already exists');
  return rejected(
    invalidCode,
    'the QualityGovernance business fact was rejected',
    currentAggregateVersion,
  );
}

export async function handleRaiseReviewIssue(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityReviewApprovalCommandEnvelope<RaiseReviewIssuePayload>,
): Promise<CommandResult> {
  commandTarget(envelope, REVIEW_ISSUE_OBJECT_TYPE, QUALITY_REVIEW_ISSUE_INVALID);
  const validated = validateReviewIssueDefinition(envelope.payload.definition, context);
  assertEnvelopeScope(
    envelope,
    validated.definition.artifactRef.scope,
    QUALITY_REVIEW_ISSUE_INVALID,
  );
  const normalizedEnvelope = normalizeEnvelope(
    envelope,
    validated.definition.originRevisionRef.scope,
    REVIEW_ISSUE_OBJECT_TYPE,
  );
  return executeQualityGovernanceCommand(db, context, normalizedEnvelope, async (execution) => {
    const outcome = await repo.insertReviewIssue(execution.trx, {
      reviewIssueId: envelope.targetId,
      enterpriseId: context.enterpriseId,
      ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
      definition: validated.definition,
      raisedBy: { principalKind: context.principalKind, principalId: context.principalId },
      payloadHash: validated.payloadHash,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (outcome !== 'OK') {
      return mapWriteOutcome(
        outcome,
        QUALITY_REVIEW_ISSUE_INVALID,
        QUALITY_REVIEW_ISSUE_QUERY_NOT_FOUND,
      );
    }
    const row = await repo.getReviewIssueById(execution.trx, envelope.targetId);
    if (row === undefined) throw new Error('ReviewIssue disappeared after insert');
    await appendReferenceTarget(
      execution,
      REVIEW_ISSUE_OBJECT_TYPE,
      row.review_issue_id,
      row.payload_hash,
      '/artifactRef',
      validated.definition.artifactRef,
      'REVIEW_ISSUE_ARTIFACT',
    );
    await appendReferenceTarget(
      execution,
      REVIEW_ISSUE_OBJECT_TYPE,
      row.review_issue_id,
      row.payload_hash,
      '/originRevisionRef',
      validated.definition.originRevisionRef,
      'REVIEW_ISSUE_ORIGIN_REVISION',
    );
    if (validated.definition.originGateResultRef !== undefined) {
      await appendReferenceTarget(
        execution,
        REVIEW_ISSUE_OBJECT_TYPE,
        row.review_issue_id,
        row.payload_hash,
        '/originGateResultRef',
        validated.definition.originGateResultRef,
        'REVIEW_ISSUE_ORIGIN_GATE',
      );
    }
    for (const [index, evidence] of validated.definition.evidenceRefs.entries()) {
      await appendReferenceTarget(
        execution,
        REVIEW_ISSUE_OBJECT_TYPE,
        row.review_issue_id,
        row.payload_hash,
        `/evidenceRefs/${index}/evidence`,
        evidence.evidence,
        'REVIEW_ISSUE_EVIDENCE',
      );
    }
    if (
      /block|required|critical|major/i.test(row.blocking_classification) ||
      row.severity === 'CRITICAL' ||
      row.severity === 'MAJOR'
    ) {
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'quality.BlockingReviewIssueRaised',
        eventVersion: '1.0',
        aggregateType: REVIEW_ISSUE_OBJECT_TYPE,
        aggregateId: row.review_issue_id,
        aggregateVersion: '1',
        payload: {
          enterpriseId: row.enterprise_id,
          ...(row.project_id === null ? {} : { projectId: row.project_id }),
          reviewIssueRef: issueRef(row),
          artifactRef: validated.definition.artifactRef,
          originRevisionRef: validated.definition.originRevisionRef,
          blockingClassification: row.blocking_classification,
          severity: row.severity,
        } as unknown as CanonicalJsonObject,
        occurredAt: new Date(validated.definition.raisedAt),
      });
    }
    return {
      kind: 'COMMITTED',
      resultPayload: {
        reviewIssueRef: issueRef(row) as unknown as CanonicalJsonObject,
        status: row.status,
        aggregateVersion: aggregateVersion(
          row.aggregate_version,
          'ReviewIssue.aggregateVersion',
          QUALITY_REVIEW_ISSUE_INVALID,
        ),
      },
    };
  });
}

export async function handleProposeIssueResolution(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityReviewApprovalCommandEnvelope<ProposeIssueResolutionPayload>,
): Promise<CommandResult> {
  commandTarget(envelope, REVIEW_ISSUE_OBJECT_TYPE, QUALITY_REVIEW_ISSUE_INVALID);
  const expected = expectedVersion(
    envelope.expectedAggregateVersion,
    'proposeIssueResolution.expectedAggregateVersion',
    QUALITY_REVIEW_ISSUE_INVALID,
  );
  const validated = validateIssueResolution(
    envelope.payload.resolution,
    envelope.payload.proposedBy,
    context,
  );
  const existing = await withQualityGovernanceTransaction(db, context, async (trx) =>
    repo.getReviewIssueById(trx, envelope.targetId),
  );
  if (existing === undefined)
    throw new QualityBusinessError(
      QUALITY_REVIEW_ISSUE_QUERY_NOT_FOUND,
      'ReviewIssue was not found',
    );
  assertEnvelopeScope(envelope, scopeOfIssue(existing), QUALITY_REVIEW_ISSUE_INVALID);
  if (
    validated.proposedBy.principalId !== context.principalId ||
    validated.proposedBy.principalKind !== context.principalKind
  ) {
    throw new QualityBusinessError(
      QUALITY_SEPARATION_OF_DUTIES_VIOLATION,
      'proposedBy must match the trusted proposer',
    );
  }
  if (!sameScope(validated.resolution.targetRevisionRef.scope, scopeOfIssue(existing))) {
    throw new QualityBusinessError(
      QUALITY_REVIEW_ISSUE_INVALID,
      'resolution target Revision is outside the Issue scope',
    );
  }
  const normalizedEnvelope = normalizeEnvelope(
    { ...envelope, expectedAggregateVersion: expected },
    scopeOfIssue(existing),
    REVIEW_ISSUE_OBJECT_TYPE,
  );
  return executeQualityGovernanceCommand(db, context, normalizedEnvelope, async (execution) => {
    const row = await repo.getReviewIssueById(execution.trx, envelope.targetId);
    if (row === undefined)
      return rejected(QUALITY_REVIEW_ISSUE_QUERY_NOT_FOUND, 'ReviewIssue was not found');
    const current = aggregateVersion(
      row.aggregate_version,
      'ReviewIssue.aggregateVersion',
      QUALITY_REVIEW_ISSUE_INVALID,
    );
    const resolutionId = newUuidV7();
    const storedDefinition = {
      resolution: validated.resolution,
      proposedBy: validated.proposedBy,
    } as unknown as CanonicalJsonObject;
    const result = await repo.appendIssueResolution(execution.trx, {
      resolutionId,
      reviewIssueId: row.review_issue_id,
      expectedVersion: expected,
      definition: storedDefinition,
      payloadHash: hashOfCanonical(storedDefinition),
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (result.outcome !== 'OK')
      return mapWriteOutcome(
        result.outcome,
        QUALITY_REVIEW_ISSUE_INVALID,
        QUALITY_REVIEW_ISSUE_QUERY_NOT_FOUND,
        result.aggregateVersion ?? current,
      );
    const proposals = await repo.getResolutionProposals(execution.trx, row.review_issue_id);
    const proposal = proposals.find((item) => item.resolution_id === resolutionId);
    if (proposal === undefined) throw new Error('Resolution proposal disappeared after append');
    await appendReferenceTarget(
      execution,
      REVIEW_ISSUE_OBJECT_TYPE,
      row.review_issue_id,
      row.payload_hash,
      '/resolution/targetRevisionRef',
      validated.resolution.targetRevisionRef,
      'REVIEW_ISSUE_RESOLUTION_REVISION',
    );
    for (const [index, claimRef] of validated.resolution.changedClaimRefs.entries()) {
      await appendReferenceTarget(
        execution,
        REVIEW_ISSUE_OBJECT_TYPE,
        row.review_issue_id,
        row.payload_hash,
        `/resolution/changedClaimRefs/${index}`,
        claimRef,
        'REVIEW_ISSUE_RESOLUTION_CLAIM',
      );
    }
    return {
      kind: 'COMMITTED',
      resultPayload: {
        reviewIssueRef: issueRef(row) as unknown as CanonicalJsonObject,
        resolutionRef: resolutionRef(proposal) as unknown as CanonicalJsonObject,
        status: 'RESOLUTION_PROPOSED',
        aggregateVersion: result.aggregateVersion ?? '2',
      },
    };
  });
}

export async function handleVerifyIssueResolution(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityReviewApprovalCommandEnvelope<VerifyIssueResolutionPayload>,
): Promise<CommandResult> {
  commandTarget(envelope, REVIEW_ISSUE_OBJECT_TYPE, QUALITY_REVIEW_ISSUE_INVALID);
  const expected = expectedVersion(
    envelope.expectedAggregateVersion,
    'verifyIssueResolution.expectedAggregateVersion',
    QUALITY_REVIEW_ISSUE_INVALID,
  );
  const validated = validateIssueVerification(envelope.payload.verification, context);
  const existing = await withQualityGovernanceTransaction(db, context, async (trx) =>
    repo.getReviewIssueById(trx, envelope.targetId),
  );
  if (existing === undefined)
    throw new QualityBusinessError(
      QUALITY_REVIEW_ISSUE_QUERY_NOT_FOUND,
      'ReviewIssue was not found',
    );
  assertEnvelopeScope(envelope, scopeOfIssue(existing), QUALITY_REVIEW_ISSUE_INVALID);
  if (
    validated.verification.verifier.principalId !== context.principalId ||
    validated.verification.verifier.principalKind !== context.principalKind
  ) {
    throw new QualityBusinessError(
      QUALITY_SEPARATION_OF_DUTIES_VIOLATION,
      'verifier must match the trusted principal',
    );
  }
  if (context.principalKind === 'AGENT' || context.principalKind === 'RUNTIME') {
    throw new QualityBusinessError(
      QUALITY_SEPARATION_OF_DUTIES_VIOLATION,
      'Agent and Runtime principals cannot verify a remediation',
    );
  }
  const normalizedEnvelope = normalizeEnvelope(
    { ...envelope, expectedAggregateVersion: expected },
    scopeOfIssue(existing),
    REVIEW_ISSUE_OBJECT_TYPE,
  );
  return executeQualityGovernanceCommand(db, context, normalizedEnvelope, async (execution) => {
    const row = await repo.getReviewIssueById(execution.trx, envelope.targetId);
    if (row === undefined)
      return rejected(QUALITY_REVIEW_ISSUE_QUERY_NOT_FOUND, 'ReviewIssue was not found');
    const current = aggregateVersion(
      row.aggregate_version,
      'ReviewIssue.aggregateVersion',
      QUALITY_REVIEW_ISSUE_INVALID,
    );
    const proposals = await repo.getResolutionProposals(execution.trx, row.review_issue_id);
    const proposal = proposals[0];
    if (
      proposal === undefined ||
      !exactReferenceEqual(proposal.target_revision_ref, validated.verification.targetRevisionRef)
    ) {
      return rejected(
        QUALITY_ISSUE_VERIFICATION_REQUIRED,
        'verification must bind the latest exact Resolution Proposal',
        current,
      );
    }
    const proposer = principalFromStored(proposal.proposed_by, 'ResolutionProposal.proposedBy');
    if (proposer !== undefined && separationProhibitsSelfReviewFromStored(row, proposer, context)) {
      return rejected(
        QUALITY_SEPARATION_OF_DUTIES_VIOLATION,
        'the remediation proposer cannot verify their own remediation',
        current,
      );
    }
    const verificationId = newUuidV7();
    const storedDefinition = {
      verification: validated.verification,
      resolutionId: proposal.resolution_id,
    } as unknown as CanonicalJsonObject;
    const result = await repo.appendIssueVerification(execution.trx, {
      verificationId,
      reviewIssueId: row.review_issue_id,
      resolutionId: proposal.resolution_id,
      expectedVersion: expected,
      definition: storedDefinition,
      payloadHash: hashOfCanonical(storedDefinition),
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (result.outcome !== 'OK')
      return mapWriteOutcome(
        result.outcome,
        QUALITY_REVIEW_ISSUE_INVALID,
        QUALITY_REVIEW_ISSUE_QUERY_NOT_FOUND,
        result.aggregateVersion ?? current,
      );
    const records = await repo.getVerificationRecords(execution.trx, row.review_issue_id);
    const verification = records.find((item) => item.verification_id === verificationId);
    if (verification === undefined) throw new Error('Verification record disappeared after append');
    await appendReferenceTarget(
      execution,
      REVIEW_ISSUE_OBJECT_TYPE,
      row.review_issue_id,
      row.payload_hash,
      '/verification/targetRevisionRef',
      validated.verification.targetRevisionRef,
      'REVIEW_ISSUE_VERIFICATION_REVISION',
    );
    for (const [index, gateRef] of validated.verification.supportingGateResultRefs.entries()) {
      await appendReferenceTarget(
        execution,
        REVIEW_ISSUE_OBJECT_TYPE,
        row.review_issue_id,
        row.payload_hash,
        `/verification/supportingGateResultRefs/${index}`,
        gateRef,
        'REVIEW_ISSUE_VERIFICATION_GATE',
      );
    }
    return {
      kind: 'COMMITTED',
      resultPayload: {
        reviewIssueRef: issueRef(row) as unknown as CanonicalJsonObject,
        verificationRef: verificationRef(verification) as unknown as CanonicalJsonObject,
        outcome: verification.outcome,
        status: verification.outcome === 'VERIFIED' ? 'VERIFIED' : 'RESOLUTION_PROPOSED',
        aggregateVersion: result.aggregateVersion ?? '2',
      },
    };
  });
}

function separationProhibitsSelfReviewFromStored(
  row: ReviewIssueTable,
  proposer: Common.PrincipalRef,
  context: QualityTransactionContext,
): boolean {
  const raisedBy = principalFromStored(row.raised_by, 'ReviewIssue.raisedBy');
  return (
    proposer.principalId === context.principalId &&
    (raisedBy === undefined ||
      raisedBy.principalId === context.principalId ||
      proposer.principalId === context.principalId)
  );
}

export async function handleCloseReviewIssue(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityReviewApprovalCommandEnvelope<CloseReviewIssuePayload>,
): Promise<CommandResult> {
  commandTarget(envelope, REVIEW_ISSUE_OBJECT_TYPE, QUALITY_REVIEW_ISSUE_INVALID);
  const expected = expectedVersion(
    envelope.expectedAggregateVersion,
    'closeReviewIssue.expectedAggregateVersion',
    QUALITY_ISSUE_VERIFICATION_REQUIRED,
  );
  const verificationRefValue = validateContentAddressedRef(
    envelope.payload.verificationRef,
    context,
    'verificationRef',
    new Set([ISSUE_VERIFICATION_OBJECT_TYPE]),
  );
  const closeReason = validateIssueCloseReason(envelope.payload.closeReason, context);
  const closedAt = envelope.payload.closedAt;
  if (typeof closedAt !== 'string' || !UTC_INSTANT_PATTERN.test(closedAt))
    throw new QualityBusinessError(
      QUALITY_ISSUE_VERIFICATION_REQUIRED,
      'closedAt must be a UTC instant',
    );
  const existing = await withQualityGovernanceTransaction(db, context, async (trx) =>
    repo.getReviewIssueById(trx, envelope.targetId),
  );
  if (existing === undefined)
    throw new QualityBusinessError(
      QUALITY_REVIEW_ISSUE_QUERY_NOT_FOUND,
      'ReviewIssue was not found',
    );
  assertEnvelopeScope(envelope, scopeOfIssue(existing), QUALITY_REVIEW_ISSUE_INVALID);
  if (context.principalKind !== 'HUMAN' && context.principalKind !== 'SERVICE') {
    throw new QualityBusinessError(
      QUALITY_AGENT_DISMISSAL_FORBIDDEN,
      'only a Human or trusted Governance Service can close an Issue',
    );
  }
  const normalizedEnvelope = normalizeEnvelope(
    { ...envelope, expectedAggregateVersion: expected },
    scopeOfIssue(existing),
    REVIEW_ISSUE_OBJECT_TYPE,
  );
  return executeQualityGovernanceCommand(db, context, normalizedEnvelope, async (execution) => {
    const row = await repo.getReviewIssueById(execution.trx, envelope.targetId);
    if (row === undefined)
      return rejected(QUALITY_REVIEW_ISSUE_QUERY_NOT_FOUND, 'ReviewIssue was not found');
    const current = aggregateVersion(
      row.aggregate_version,
      'ReviewIssue.aggregateVersion',
      QUALITY_ISSUE_VERIFICATION_REQUIRED,
    );
    const result = await repo.closeReviewIssue(execution.trx, {
      reviewIssueId: row.review_issue_id,
      expectedVersion: expected,
      verificationRef: verificationRefValue,
      verificationHash: contentAddressedHash(verificationRefValue),
      closeReason,
      closedAt: new Date(closedAt),
      transitionId: newUuidV7(),
      payloadHash: hashOfCanonical({
        verificationRef: verificationRefValue,
        closeReason,
        closedAt,
      } as unknown as CanonicalJsonObject),
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (result.outcome !== 'OK')
      return mapWriteOutcome(
        result.outcome,
        QUALITY_ISSUE_VERIFICATION_REQUIRED,
        QUALITY_REVIEW_ISSUE_QUERY_NOT_FOUND,
        result.aggregateVersion ?? current,
      );
    const verification = await repo.getVerificationRecordById(
      execution.trx,
      verificationRefValue.objectId,
    );
    if (!verification?.payload_hash.equals(contentAddressedHash(verificationRefValue)))
      return rejected(
        QUALITY_ISSUE_VERIFICATION_REQUIRED,
        'the exact verified Resolution was not found',
        current,
      );
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'quality.ReviewIssueClosed',
      eventVersion: '1.0',
      aggregateType: REVIEW_ISSUE_OBJECT_TYPE,
      aggregateId: row.review_issue_id,
      aggregateVersion: result.aggregateVersion ?? '2',
      payload: {
        enterpriseId: row.enterprise_id,
        ...(row.project_id === null ? {} : { projectId: row.project_id }),
        reviewIssueRef: issueRef(row),
        verifiedRevisionRef: verification.target_revision_ref,
        verificationRef: verificationRefValue,
        closedAt,
      } as unknown as CanonicalJsonObject,
      occurredAt: new Date(closedAt),
    });
    return {
      kind: 'COMMITTED',
      resultPayload: {
        reviewIssueRef: issueRef(row) as unknown as CanonicalJsonObject,
        verificationRef: verificationRefValue as unknown as CanonicalJsonObject,
        status: 'CLOSED',
        aggregateVersion: result.aggregateVersion ?? '2',
        closedAt,
      },
    };
  });
}

export async function handleRequestApproval(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityReviewApprovalCommandEnvelope<RequestApprovalPayload>,
): Promise<CommandResult> {
  commandTarget(envelope, APPROVAL_REQUEST_OBJECT_TYPE, QUALITY_APPROVAL_INVALID);
  const validated = validateApprovalRequestDefinition(envelope.payload.definition, context);
  assertEnvelopeScope(
    envelope,
    validated.definition.revisionRef.scope,
    QUALITY_APPROVAL_REVISION_MISMATCH,
  );
  const normalizedEnvelope = normalizeEnvelope(
    envelope,
    validated.definition.revisionRef.scope,
    APPROVAL_REQUEST_OBJECT_TYPE,
  );
  return executeQualityGovernanceCommand(db, context, normalizedEnvelope, async (execution) => {
    const profile = await exactProfile(
      execution.trx,
      context,
      validated.definition.qualityProfileRef,
    );
    if (profile === undefined)
      return rejected(
        QUALITY_APPROVAL_REQUIREMENTS_INCOMPLETE,
        'the exact QualityProfile version was not found',
      );
    const requirement = profile.requirements.find(
      (item) => item.approval_requirement_id === validated.definition.approvalRequirementId,
    );
    if (
      requirement?.required_role !== validated.definition.requestedApproverRole ||
      requirement.approver_kind !== 'HUMAN'
    ) {
      return rejected(
        QUALITY_APPROVAL_REQUIREMENTS_INCOMPLETE,
        'the requested Approval Requirement is not exact and Human-only',
      );
    }
    const ras = await exactRevisionAcceptance(execution.trx, context, validated.definition);
    if (ras === undefined)
      return rejected(
        QUALITY_REVISION_ACCEPTANCE_NOT_READY,
        'the exact READY RevisionAcceptanceSnapshot was not found',
      );
    const issues = await repo.getReviewIssues(execution.trx);
    if (hasOpenBlockingIssue(issues, profile, validated.definition.artifactRef))
      return rejected(
        QUALITY_APPROVAL_BLOCKING_ISSUE_OPEN,
        'an Open Blocking ReviewIssue prevents Approval',
      );
    const outcome = await repo.insertApprovalRequest(execution.trx, {
      requestId: envelope.targetId,
      enterpriseId: context.enterpriseId,
      ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
      definition: validated.definition,
      payloadHash: validated.payloadHash,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (outcome !== 'OK')
      return mapWriteOutcome(outcome, QUALITY_APPROVAL_INVALID, QUALITY_APPROVAL_QUERY_NOT_FOUND);
    const row = await repo.getApprovalRequestById(execution.trx, envelope.targetId);
    if (row === undefined) throw new Error('ApprovalRequest disappeared after insert');
    await appendReferenceTarget(
      execution,
      APPROVAL_REQUEST_OBJECT_TYPE,
      row.request_id,
      row.payload_hash,
      '/revisionAcceptanceSnapshotRef',
      validated.definition.revisionAcceptanceSnapshotRef,
      'APPROVAL_REQUEST_RAS',
    );
    await appendReferenceTarget(
      execution,
      APPROVAL_REQUEST_OBJECT_TYPE,
      row.request_id,
      row.payload_hash,
      '/revisionRef',
      validated.definition.revisionRef,
      'APPROVAL_REQUEST_REVISION',
    );
    await appendReferenceTarget(
      execution,
      APPROVAL_REQUEST_OBJECT_TYPE,
      row.request_id,
      row.payload_hash,
      '/qualityProfileRef',
      validated.definition.qualityProfileRef,
      'APPROVAL_REQUEST_PROFILE',
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        requestRef: {
          kind: 'OBJECT',
          objectType: APPROVAL_REQUEST_OBJECT_TYPE,
          objectId: row.request_id,
          scope: scopeOfRequest(row),
        } as unknown as CanonicalJsonObject,
        status: row.status,
        aggregateVersion: '1',
      },
    };
  });
}

async function validateApprovalSubmissionFacts(
  trx: QualityTransaction,
  context: QualityTransactionContext,
  validated: ValidatedApprovalSubmission,
): Promise<
  | {
      readonly request: ApprovalRequestTable;
      readonly profile: ExactProfile;
      readonly ras: RevisionAcceptanceSnapshotTable;
    }
  | undefined
> {
  const request = await repo.getApprovalRequestById(trx, validated.submission.requestRef.objectId);
  if (request === undefined) return undefined;
  if (
    request.enterprise_id !== context.enterpriseId ||
    (request.project_id ?? undefined) !== (validated.projectId ?? undefined) ||
    !exactReferenceEqual(request.revision_ref, validated.submission.revisionRef) ||
    !exactReferenceEqual(
      request.revision_acceptance_snapshot_ref,
      validated.submission.revisionAcceptanceSnapshotRef,
    ) ||
    request.approval_requirement_id !== validated.submission.approvalRequirementId
  )
    return undefined;
  const profileRef = exactStoredObject(
    request.quality_profile_ref,
    'ApprovalRequest.qualityProfileRef',
    QUALITY_APPROVAL_INVALID,
  ) as unknown as Common.VersionedRef;
  const profile = await exactProfile(trx, context, profileRef);
  if (profile === undefined) return undefined;
  const requirement = profile.requirements.find(
    (item) => item.approval_requirement_id === request.approval_requirement_id,
  );
  if (
    requirement?.required_role !== request.requested_approver_role ||
    requirement.approver_kind !== 'HUMAN'
  )
    return undefined;
  const ras = await exactRevisionAcceptance(trx, context, {
    artifactRef: exactStoredObject(
      request.artifact_ref,
      'ApprovalRequest.artifactRef',
      QUALITY_APPROVAL_INVALID,
    ) as unknown as Common.ObjectRef,
    revisionRef: validated.submission.revisionRef,
    revisionAcceptanceSnapshotRef: validated.submission.revisionAcceptanceSnapshotRef,
  });
  if (ras === undefined) return undefined;
  return { request, profile, ras };
}

export async function handleSubmitApprovalDecision(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityReviewApprovalCommandEnvelope<SubmitApprovalDecisionPayload>,
): Promise<CommandResult> {
  commandTarget(envelope, APPROVAL_REQUEST_OBJECT_TYPE, QUALITY_APPROVAL_INVALID);
  const validated = validateApprovalSubmission(envelope.payload.submission, context);
  assertEnvelopeScope(
    envelope,
    validated.submission.revisionRef.scope,
    QUALITY_APPROVAL_REVISION_MISMATCH,
  );
  const normalizedEnvelope = normalizeEnvelope(
    envelope,
    validated.submission.revisionRef.scope,
    APPROVAL_REQUEST_OBJECT_TYPE,
  );
  return executeQualityGovernanceCommand(db, context, normalizedEnvelope, async (execution) => {
    if (context.principalKind !== 'HUMAN')
      return rejected(
        QUALITY_APPROVAL_AGENT_FORBIDDEN,
        'only a trusted Human context can submit an Approval decision',
      );
    if (validated.submission.approverHumanPrincipalRef.principalId !== context.principalId) {
      return rejected(
        QUALITY_APPROVAL_IDENTITY_CONFLICT,
        'the declared Human approver does not match the trusted Human context',
      );
    }
    const facts = await validateApprovalSubmissionFacts(execution.trx, context, validated);
    if (facts === undefined)
      return rejected(
        QUALITY_APPROVAL_REVISION_MISMATCH,
        'Approval request, Revision, RAS, Profile, or Requirement is not exact',
      );
    const { request, profile, ras } = facts;
    if (
      request.expires_at !== null &&
      request.expires_at.getTime() <= Date.parse(validated.submission.decidedAt)
    )
      return rejected(QUALITY_APPROVAL_REQUEST_EXPIRED, 'the Approval Request has expired');
    const issues = await repo.getReviewIssues(execution.trx);
    if (hasOpenBlockingIssue(issues, profile, request.artifact_ref))
      return rejected(
        QUALITY_APPROVAL_BLOCKING_ISSUE_OPEN,
        'an Open Blocking ReviewIssue prevents Approval',
      );
    if (separationProhibitsSelfReview(profile)) {
      const proposerConflict = issues.some((issue) => {
        if (
          !exactReferenceEqual(issue.artifact_ref, request.artifact_ref) ||
          !issueStatusIsOpen(issue.status)
        )
          return false;
        const raisedBy = principalFromStored(issue.raised_by, 'ReviewIssue.raisedBy');
        return raisedBy?.principalId === context.principalId;
      });
      if (proposerConflict)
        return rejected(
          QUALITY_SEPARATION_OF_DUTIES_VIOLATION,
          'the approver is not independent from the ReviewIssue author',
        );
    }
    const approvalId = newUuidV7();
    const storedDefinition = { submission: validated.submission } as unknown as CanonicalJsonObject;
    const outcome = await repo.insertApprovalDecision(execution.trx, {
      approvalId,
      requestId: request.request_id,
      definition: storedDefinition,
      payloadHash: hashOfCanonical(storedDefinition),
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (outcome !== 'OK')
      return mapWriteOutcome(
        outcome,
        QUALITY_APPROVAL_IDENTITY_CONFLICT,
        QUALITY_APPROVAL_QUERY_NOT_FOUND,
        undefined,
        QUALITY_APPROVAL_IDENTITY_CONFLICT,
      );
    const approval = await repo.getApprovalById(execution.trx, approvalId);
    if (approval === undefined) throw new Error('Approval disappeared after decision insert');
    const approvals = (await repo.getApprovals(execution.trx)).filter(
      (row) =>
        row.enterprise_id === approval.enterprise_id &&
        (row.project_id ?? undefined) === (approval.project_id ?? undefined) &&
        exactReferenceEqual(row.revision_ref, approval.revision_ref) &&
        exactReferenceEqual(row.quality_profile_ref, approval.quality_profile_ref),
    );
    const evaluatedAt = validated.submission.decidedAt;
    const bundle = await buildApprovalBundle(
      execution.trx,
      context,
      ras,
      profile,
      approvals,
      evaluatedAt,
      newUuidV7(),
    );
    const bundleWrite = await repo.insertApprovalBundleSnapshot(execution.trx, {
      snapshotId: bundle.snapshot.snapshotId,
      enterpriseId: context.enterpriseId,
      ...(validated.projectId === undefined ? {} : { projectId: validated.projectId }),
      snapshot: bundle.snapshot,
      revisionContentHash: validated.revisionContentHash,
      payloadHash: bundle.payloadHash,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (bundleWrite !== 'OK')
      return mapWriteOutcome(
        bundleWrite,
        QUALITY_APPROVAL_GATE_BUNDLE_INVALID,
        QUALITY_APPROVAL_QUERY_NOT_FOUND,
      );
    const storedBundle = await repo.getApprovalBundleSnapshotById(
      execution.trx,
      bundle.snapshot.snapshotId,
    );
    if (storedBundle === undefined)
      throw new Error('ApprovalBundleSnapshot disappeared after insert');
    const decisions = await repo.getApprovalDecisions(execution.trx, approval.approval_id);
    const decision = decisions[0];
    if (decision === undefined) throw new Error('Approval decision disappeared after insert');
    await appendReferenceTarget(
      execution,
      APPROVAL_REQUEST_OBJECT_TYPE,
      request.request_id,
      request.payload_hash,
      '/approval',
      approvalRef(approval),
      'APPROVAL_DECISION',
    );
    await appendReferenceTarget(
      execution,
      APPROVAL_REQUEST_OBJECT_TYPE,
      request.request_id,
      request.payload_hash,
      '/approvalBundleSnapshot',
      snapshotRef(storedBundle),
      'APPROVAL_BUNDLE_SNAPSHOT',
    );
    if (bundle.snapshot.completeness.status === 'FULLY_APPROVED') {
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'quality.RevisionFullyApproved',
        eventVersion: '1.0',
        aggregateType: APPROVAL_REQUEST_OBJECT_TYPE,
        aggregateId: request.request_id,
        aggregateVersion: '1',
        payload: {
          enterpriseId: request.enterprise_id,
          ...(request.project_id === null ? {} : { projectId: request.project_id }),
          artifactRef: request.artifact_ref,
          revisionRef: request.revision_ref,
          approvalBundleSnapshotRef: snapshotRef(storedBundle),
          approvalRefs: bundle.snapshot.approvalRefs,
        } as unknown as CanonicalJsonObject,
        occurredAt: new Date(evaluatedAt),
      });
    }
    return {
      kind: 'COMMITTED',
      resultPayload: {
        approvalRef: approvalRef(approval) as unknown as CanonicalJsonObject,
        approvalDecisionRef: approvalDecisionRef(decision) as unknown as CanonicalJsonObject,
        approvalBundleSnapshotRef: snapshotRef(storedBundle) as unknown as CanonicalJsonObject,
        completeness: bundle.snapshot.completeness,
        status: approval.status,
      },
    };
  });
}

export async function handleRevokeApproval(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: QualityReviewApprovalCommandEnvelope<RevokeApprovalPayload>,
): Promise<CommandResult> {
  commandTarget(envelope, APPROVAL_OBJECT_TYPE, QUALITY_APPROVAL_INVALID);
  const expected = expectedVersion(
    envelope.expectedAggregateVersion,
    'revokeApproval.expectedAggregateVersion',
    QUALITY_APPROVAL_INVALID,
  );
  const validated = validateApprovalRevocation({ ...envelope.payload }, context);
  if (context.principalKind !== 'HUMAN')
    throw new QualityBusinessError(
      QUALITY_APPROVAL_AGENT_FORBIDDEN,
      'Approval revocation requires a trusted Human',
    );
  const existing = await withQualityGovernanceTransaction(db, context, async (trx) =>
    repo.getApprovalById(trx, envelope.targetId),
  );
  if (existing === undefined)
    throw new QualityBusinessError(QUALITY_APPROVAL_QUERY_NOT_FOUND, 'Approval was not found');
  assertEnvelopeScope(envelope, scopeOfApproval(existing), QUALITY_APPROVAL_REVISION_MISMATCH);
  if (!sameScope(validated.impactAssessmentRef.scope, scopeOfApproval(existing))) {
    throw new QualityBusinessError(
      QUALITY_APPROVAL_REVISION_MISMATCH,
      'impactAssessmentRef must share the Approval scope',
    );
  }
  const normalizedEnvelope = normalizeEnvelope(
    { ...envelope, expectedAggregateVersion: expected },
    scopeOfApproval(existing),
    APPROVAL_OBJECT_TYPE,
  );
  return executeQualityGovernanceCommand(db, context, normalizedEnvelope, async (execution) => {
    const approval = await repo.getApprovalById(execution.trx, envelope.targetId);
    if (approval === undefined)
      return rejected(QUALITY_APPROVAL_QUERY_NOT_FOUND, 'Approval was not found');
    const current = aggregateVersion(
      approval.aggregate_version,
      'Approval.aggregateVersion',
      QUALITY_APPROVAL_INVALID,
    );
    const result = await repo.appendApprovalRevocation(execution.trx, {
      revocationId: newUuidV7(),
      approvalId: approval.approval_id,
      expectedVersion: expected,
      definition: {
        revocationReason: validated.revocationReason,
        impactAssessmentRef: validated.impactAssessmentRef,
        revokedAt: validated.revokedAtText,
      },
      payloadHash: validated.payloadHash,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      createdAuthorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (result.outcome !== 'OK')
      return mapWriteOutcome(
        result.outcome,
        QUALITY_APPROVAL_ALREADY_REVOKED,
        QUALITY_APPROVAL_QUERY_NOT_FOUND,
        result.aggregateVersion ?? current,
      );
    const revocations = await repo.getApprovalRevocations(execution.trx, approval.approval_id);
    const revocation = revocations[0];
    if (revocation === undefined) throw new Error('Approval revocation disappeared after append');
    const snapshots = await repo.getApprovalBundleSnapshots(execution.trx);
    const prior = snapshots.find(
      (row) =>
        exactReferenceEqual(row.revision_ref, approval.revision_ref) &&
        exactReferenceEqual(row.quality_profile_ref, approval.quality_profile_ref) &&
        storedArray(
          row.approval_refs,
          'ApprovalBundleSnapshot.approvalRefs',
          QUALITY_APPROVAL_QUERY_NOT_FOUND,
        ).some((item) => exactReferenceEqual(item, approvalRef(approval))),
    );
    let staleSnapshot: ApprovalBundleSnapshotTable | undefined;
    if (prior !== undefined) {
      const priorSnapshot = exactStoredObject(
        prior.snapshot,
        'ApprovalBundleSnapshot.snapshot',
        QUALITY_APPROVAL_QUERY_NOT_FOUND,
      ) as unknown as Core.ApprovalBundleSnapshot;
      const stale = {
        ...priorSnapshot,
        snapshotId: newUuidV7(),
        evaluatedAt: validated.revokedAtText,
        separationOfDutiesResult: {
          ...priorSnapshot.separationOfDutiesResult,
          checkedAt: validated.revokedAtText,
        },
        completeness: { status: 'STALE', reasons: ['QUALITY_APPROVAL_REVOKED'] },
      } as Core.ApprovalBundleSnapshot;
      ensureApprovalBundleContract(stale);
      const staleHash = hashOfCanonical(stale as unknown as CanonicalJsonObject);
      const staleWrite = await repo.insertApprovalBundleSnapshot(execution.trx, {
        snapshotId: stale.snapshotId,
        enterpriseId: approval.enterprise_id,
        ...(approval.project_id === null ? {} : { projectId: approval.project_id }),
        snapshot: stale,
        revisionContentHash: approval.revision_content_hash,
        payloadHash: staleHash,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        createdAuthorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
      if (staleWrite !== 'OK')
        return rejected(
          QUALITY_APPROVAL_GATE_BUNDLE_INVALID,
          'the stale ApprovalBundleSnapshot could not be appended',
          current,
        );
      staleSnapshot = await repo.getApprovalBundleSnapshotById(execution.trx, stale.snapshotId);
    }
    if (prior !== undefined && staleSnapshot !== undefined) {
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'quality.RevisionApprovalLost',
        eventVersion: '1.0',
        aggregateType: APPROVAL_OBJECT_TYPE,
        aggregateId: approval.approval_id,
        aggregateVersion: result.aggregateVersion ?? '2',
        payload: {
          enterpriseId: approval.enterprise_id,
          ...(approval.project_id === null ? {} : { projectId: approval.project_id }),
          artifactRef: approval.artifact_ref,
          revisionRef: approval.revision_ref,
          priorApprovalBundleSnapshotRef: snapshotRef(prior),
          triggeringRef: revocationRef(revocation),
          reasonCode: validated.revocationReason.reasonCode,
        } as unknown as CanonicalJsonObject,
        occurredAt: validated.revokedAt,
      });
    }
    return {
      kind: 'COMMITTED',
      resultPayload: {
        approvalRef: approvalRef(approval) as unknown as CanonicalJsonObject,
        revocationRef: revocationRef(revocation) as unknown as CanonicalJsonObject,
        status: 'REVOKED',
        aggregateVersion: result.aggregateVersion ?? '2',
        ...(prior === undefined ? {} : { priorApprovalBundleSnapshotRef: snapshotRef(prior) }),
        ...(staleSnapshot === undefined
          ? {}
          : { staleApprovalBundleSnapshotRef: snapshotRef(staleSnapshot) }),
      } as unknown as CanonicalJsonObject,
    };
  });
}

export async function handleGetOpenBlockingIssues(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  payload: GetOpenBlockingIssuesPayload,
): Promise<readonly QualityGovernance.BlockingIssueView[]> {
  const revisionRef = validateContentAddressedRef(
    payload.revisionRef,
    context,
    'revisionRef',
    new Set([REVISION_OBJECT_TYPE]),
  );
  const profileRef = validateProfileRef(payload.qualityProfileRef, context);
  return withQualityGovernanceTransaction(db, context, async (trx) => {
    const profile = await exactProfile(trx, context, profileRef);
    if (profile === undefined)
      throw new QualityBusinessError(
        QUALITY_APPROVAL_QUERY_NOT_FOUND,
        'QualityProfile was not found',
      );
    const issues = await repo.getReviewIssues(trx);
    return issues
      .filter(
        (row) =>
          issueStatusIsOpen(row.status) &&
          issueIsBlocking(row, profile) &&
          exactReferenceEqual(row.origin_revision_ref, revisionRef),
      )
      .map((row) => {
        const ownerRef = principalFromStored(row.raised_by, 'ReviewIssue.raisedBy');
        return {
          reviewIssueRef: issueRef(row),
          originRevisionRef: row.origin_revision_ref,
          severity: row.severity,
          blockingClassification: row.blocking_classification,
          status: row.status,
          ...(ownerRef === undefined ? {} : { ownerRef }),
        } as QualityGovernance.BlockingIssueView;
      });
  });
}

function validateProfileRef(
  value: unknown,
  context: QualityTransactionContext,
): Common.VersionedRef {
  const parsed = record(value, 'qualityProfileRef', QUALITY_APPROVAL_QUERY_NOT_FOUND);
  if (
    parsed.kind !== 'VERSIONED' ||
    parsed.objectType !== QUALITY_PROFILE_OBJECT_TYPE ||
    typeof parsed.objectId !== 'string' ||
    !isUuidV7(parsed.objectId) ||
    typeof parsed.versionId !== 'string' ||
    !isUuidV7(parsed.versionId)
  )
    throw new QualityBusinessError(
      QUALITY_APPROVAL_QUERY_NOT_FOUND,
      'qualityProfileRef is not exact',
    );
  if (
    parsed.scope === null ||
    typeof parsed.scope !== 'object' ||
    Array.isArray(parsed.scope) ||
    !sameScope(parsed.scope, { enterpriseId: context.enterpriseId })
  )
    throw new QualityBusinessError(
      QUALITY_APPROVAL_QUERY_NOT_FOUND,
      'qualityProfileRef is outside scope',
    );
  return parsed as unknown as Common.VersionedRef;
}

export async function handleGetApprovalBundleSnapshot(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  payload: GetApprovalBundleSnapshotPayload,
): Promise<Core.ApprovalBundleSnapshot> {
  const requested = validateSnapshotRef(payload.snapshotRef, context, 'snapshotRef');
  if (requested.objectType !== APPROVAL_BUNDLE_OBJECT_TYPE)
    throw new QualityBusinessError(
      QUALITY_APPROVAL_QUERY_NOT_FOUND,
      'snapshotRef is not an ApprovalBundleSnapshot',
    );
  return withQualityGovernanceTransaction(db, context, async (trx) => {
    const row = await repo.getApprovalBundleSnapshotById(trx, requested.snapshotId);
    if (row === undefined)
      throw new QualityBusinessError(
        QUALITY_APPROVAL_QUERY_NOT_FOUND,
        'ApprovalBundleSnapshot was not found',
      );
    if (
      row.enterprise_id !== context.enterpriseId ||
      (row.project_id ?? undefined) !== (requested.scope.projectId ?? undefined) ||
      !row.payload_hash.equals(contentAddressedHash(requested))
    )
      throw new QualityBusinessError(
        QUALITY_APPROVAL_QUERY_NOT_FOUND,
        'ApprovalBundleSnapshot was not found',
      );
    const snapshot = exactStoredObject(
      row.snapshot,
      'ApprovalBundleSnapshot.snapshot',
      QUALITY_APPROVAL_QUERY_NOT_FOUND,
    ) as unknown as Core.ApprovalBundleSnapshot;
    if (snapshot.snapshotId !== requested.snapshotId)
      throw new QualityBusinessError(
        QUALITY_APPROVAL_QUERY_NOT_FOUND,
        'ApprovalBundleSnapshot was not found',
      );
    ensureApprovalBundleContract(snapshot);
    return snapshot;
  });
}
