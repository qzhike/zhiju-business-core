// IM-05 WI-04 (issue #124): fail-closed validation for ReviewIssue
// remediation and Human Approval command payloads. Exact references are
// normalized before any business repository or owner function is called.

import { createHash } from 'node:crypto';
import type { Common, QualityGovernance } from '@zhiju/contracts';
import {
  canonicalize,
  isUuidV7,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import type { QualityTransactionContext } from '../persistence/quality-db.js';
import {
  QUALITY_APPROVAL_AGENT_FORBIDDEN,
  QUALITY_APPROVAL_INVALID,
  QUALITY_APPROVAL_REVISION_MISMATCH,
  QUALITY_ISSUE_VERIFICATION_REQUIRED,
  QUALITY_REVIEW_ISSUE_INVALID,
  QUALITY_SEPARATION_OF_DUTIES_VIOLATION,
  QualityBusinessError,
} from './quality-business-errors.js';

type RecordLike = Readonly<Record<string, unknown>>;

export interface ValidationScope {
  readonly enterpriseId: string;
  readonly projectId?: string;
}

export interface ValidatedReviewIssueDefinition {
  readonly definition: QualityGovernance.ReviewIssueDefinition;
  readonly scope: ValidationScope;
  readonly projectId?: string;
  readonly originRevisionHash: Buffer;
  readonly payloadHash: Buffer;
}

export interface ValidatedIssueResolution {
  readonly resolution: QualityGovernance.IssueResolution;
  readonly proposedBy: Common.PrincipalRef;
  readonly scope: ValidationScope;
  readonly projectId?: string;
  readonly targetRevisionHash: Buffer;
  readonly payloadHash: Buffer;
}

export interface ValidatedIssueVerification {
  readonly verification: QualityGovernance.IssueVerification;
  readonly scope: ValidationScope;
  readonly projectId?: string;
  readonly targetRevisionHash: Buffer;
  readonly payloadHash: Buffer;
}

export interface ValidatedApprovalRequestDefinition {
  readonly definition: QualityGovernance.ApprovalRequestDefinition;
  readonly scope: ValidationScope;
  readonly projectId?: string;
  readonly revisionContentHash: Buffer;
  readonly revisionAcceptanceSnapshotHash: Buffer;
  readonly requestNonceHash: Buffer;
  readonly payloadHash: Buffer;
}

export interface ValidatedApprovalSubmission {
  readonly submission: QualityGovernance.ApprovalSubmission;
  readonly scope: ValidationScope;
  readonly projectId?: string;
  readonly revisionContentHash: Buffer;
  readonly revisionAcceptanceSnapshotHash: Buffer;
  readonly payloadHash: Buffer;
}

export interface ValidatedApprovalRevocation {
  readonly revocationReason: Common.Justification;
  readonly impactAssessmentRef: Common.ContentAddressedRef;
  readonly revokedAt: Date;
  readonly revokedAtText: string;
  readonly payloadHash: Buffer;
}

const ARTIFACT_OBJECT_TYPE = 'artifact.artifact';
const REVISION_OBJECT_TYPE = 'artifact.artifact_revision';
const GATE_RESULT_OBJECT_TYPE = 'quality.gate_result';
const EVIDENCE_OBJECT_TYPE = 'quality.evidence';
const REVIEW_ISSUE_OBJECT_TYPE = 'quality.review_issue';
const APPROVAL_REQUEST_OBJECT_TYPE = 'quality.approval_request';
const APPROVAL_BUNDLE_OBJECT_TYPE = 'quality.approval_bundle_snapshot';
const QUALITY_PROFILE_OBJECT_TYPE = 'quality.quality_profile';
const RAS_OBJECT_TYPE = 'quality.revision_acceptance_snapshot';
const CLAIM_OBJECT_TYPE = 'artifact.claim';
const ROLE_SNAPSHOT_OBJECT_TYPE = 'identity.role_assignment';
const AUTHORIZATION_DECISION_OBJECT_TYPE = 'identity.authorization_decision';
const SEPARATION_CHECK_OBJECT_TYPE = 'quality.separation_check';
const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/;
const REASON_CODE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const PRINCIPAL_KINDS = new Set(['HUMAN', 'AGENT', 'SERVICE', 'RUNTIME', 'EXTERNAL_PARTY']);
const ISSUE_SEVERITIES = new Set(['CRITICAL', 'MAJOR', 'MINOR', 'INFO']);
const APPROVAL_DECISIONS = new Set(['APPROVED', 'CHANGES_REQUESTED', 'REJECTED']);

function record(value: unknown, label: string, code = QUALITY_REVIEW_ISSUE_INVALID): RecordLike {
  const parsed = canonicalValue(value, code);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new QualityBusinessError(code, `${label} must be a JSON object`);
  }
  return parsed as RecordLike;
}

function canonicalValue(value: unknown, code: string): CanonicalJsonValue {
  try {
    const parsed = JSON.parse(JSON.stringify(value)) as CanonicalJsonValue;
    return parsed;
  } catch {
    throw new QualityBusinessError(code, 'value is not valid canonical JSON');
  }
}

function nonEmptyString(value: unknown, label: string, code: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new QualityBusinessError(code, `${label} must be non-empty`);
  }
  return value;
}

function namespace(value: unknown, label: string, code: string): string {
  const result = nonEmptyString(value, label, code);
  if (!NAMESPACE_PATTERN.test(result)) {
    throw new QualityBusinessError(code, `${label} must be a namespace code`);
  }
  return result;
}

function reasonCode(value: unknown, label: string, code: string): string {
  const result = nonEmptyString(value, label, code);
  if (!REASON_CODE_PATTERN.test(result)) {
    throw new QualityBusinessError(code, `${label} must be a reason code`);
  }
  return result;
}

function uuid(value: unknown, label: string, code: string): string {
  if (typeof value !== 'string' || !isUuidV7(value)) {
    throw new QualityBusinessError(code, `${label} must be a UUIDv7`);
  }
  return value;
}

function instant(value: unknown, label: string, code: string): string {
  if (
    typeof value !== 'string' ||
    !UTC_INSTANT_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new QualityBusinessError(code, `${label} must be a UTC instant`);
  }
  return value;
}

function array(value: unknown, label: string, code: string): readonly CanonicalJsonValue[] {
  const parsed = canonicalValue(value, code);
  if (!Array.isArray(parsed)) {
    throw new QualityBusinessError(code, `${label} must be an array`);
  }
  return parsed as readonly CanonicalJsonValue[];
}

function hash(value: unknown, label: string, code: string): Common.ContentHash {
  const parsed = record(value, label, code);
  if (
    parsed.algorithm !== 'SHA-256' ||
    parsed.canonicalizationVersion !== '1' ||
    typeof parsed.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(parsed.digest)
  ) {
    throw new QualityBusinessError(code, `${label} must be a canonical SHA-256 hash`);
  }
  return {
    algorithm: 'SHA-256',
    digest: parsed.digest,
    canonicalizationVersion: '1',
  };
}

function hashBytes(value: Common.ContentHash): Buffer {
  return Buffer.from(value.digest, 'hex');
}

function trustedScope(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  code: string,
): ValidationScope {
  const parsed = record(value, `${label}.scope`, code);
  const projectId = parsed.projectId;
  if (
    parsed.enterpriseId !== context.enterpriseId ||
    (projectId !== undefined &&
      (typeof projectId !== 'string' ||
        !isUuidV7(projectId) ||
        !context.allowedProjectIds.includes(projectId)))
  ) {
    throw new QualityBusinessError(code, `${label}.scope is outside the trusted scope`);
  }
  return {
    enterpriseId: context.enterpriseId,
    ...(projectId === undefined ? {} : { projectId }),
  };
}

function scopeJson(scope: ValidationScope): Common.ScopeRef {
  return {
    enterpriseId: scope.enterpriseId,
    ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
  };
}

function sameScope(left: Common.ScopeRef, right: Common.ScopeRef): boolean {
  return (
    left.enterpriseId === right.enterpriseId &&
    (left.projectId ?? undefined) === (right.projectId ?? undefined)
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalize(left as CanonicalJsonValue) === canonicalize(right as CanonicalJsonValue);
}

function contentRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  objectTypes: ReadonlySet<string>,
  code: string,
): Common.ContentAddressedRef {
  const parsed = record(value, label, code);
  const objectType = namespace(parsed.objectType, `${label}.objectType`, code);
  if (parsed.kind !== 'CONTENT_ADDRESSED' || !objectTypes.has(objectType)) {
    throw new QualityBusinessError(
      code,
      `${label} must identify the expected exact ContentAddressedRef`,
    );
  }
  const scope = trustedScope(parsed.scope, context, label, code);
  const immutableVersionId =
    parsed.immutableVersionId === undefined
      ? undefined
      : uuid(parsed.immutableVersionId, `${label}.immutableVersionId`, code);
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId: uuid(parsed.objectId, `${label}.objectId`, code),
    ...(immutableVersionId === undefined ? {} : { immutableVersionId }),
    scope: scopeJson(scope),
    contentHash: hash(parsed.contentHash, `${label}.contentHash`, code),
  };
}

function objectRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  objectTypes: ReadonlySet<string>,
  code: string,
): Common.ObjectRef {
  const parsed = record(value, label, code);
  const objectType = namespace(parsed.objectType, `${label}.objectType`, code);
  if (parsed.kind !== 'OBJECT' || (objectTypes.size > 0 && !objectTypes.has(objectType))) {
    throw new QualityBusinessError(code, `${label} must identify the expected exact ObjectRef`);
  }
  return {
    kind: 'OBJECT',
    objectType,
    objectId: uuid(parsed.objectId, `${label}.objectId`, code),
    scope: scopeJson(trustedScope(parsed.scope, context, label, code)),
  };
}

function snapshotRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  objectTypes: ReadonlySet<string>,
  code: string,
): Common.SnapshotRef {
  const parsed = record(value, label, code);
  const objectType = namespace(parsed.objectType, `${label}.objectType`, code);
  if (parsed.kind !== 'SNAPSHOT' || !objectTypes.has(objectType)) {
    throw new QualityBusinessError(code, `${label} must identify the expected exact SnapshotRef`);
  }
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: uuid(parsed.objectId, `${label}.objectId`, code),
    snapshotId: uuid(parsed.snapshotId, `${label}.snapshotId`, code),
    scope: scopeJson(trustedScope(parsed.scope, context, label, code)),
    contentHash: hash(parsed.contentHash, `${label}.contentHash`, code),
  };
}

function principalRef(value: unknown, label: string, code: string): Common.PrincipalRef {
  const parsed = record(value, label, code);
  if (typeof parsed.principalKind !== 'string' || !PRINCIPAL_KINDS.has(parsed.principalKind)) {
    throw new QualityBusinessError(code, `${label}.principalKind is not closed`);
  }
  return {
    principalKind: parsed.principalKind as Common.PrincipalRef['principalKind'],
    principalId: uuid(parsed.principalId, `${label}.principalId`, code),
  };
}

function evidenceRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  code: string,
): Common.EvidenceRef {
  const parsed = record(value, label, code);
  const evidence = contentRef(
    parsed.evidence,
    context,
    `${label}.evidence`,
    new Set([EVIDENCE_OBJECT_TYPE]),
    code,
  );
  const relation = parsed.relation;
  if (relation !== 'SUPPORTS' && relation !== 'CONTRADICTS' && relation !== 'CONTEXT_ONLY') {
    throw new QualityBusinessError(code, `${label}.relation is not closed`);
  }
  const evidenceLinkRef =
    parsed.evidenceLinkRef === undefined
      ? undefined
      : objectRef(parsed.evidenceLinkRef, context, `${label}.evidenceLinkRef`, new Set(), code);
  let targetClaimRef: Common.EvidenceRef['targetClaimRef'];
  if (parsed.targetClaimRef !== undefined) {
    const target = record(parsed.targetClaimRef, `${label}.targetClaimRef`, code);
    targetClaimRef = {
      target: contentRef(
        target.target,
        context,
        `${label}.targetClaimRef.target`,
        new Set([CLAIM_OBJECT_TYPE]),
        code,
      ),
      claimLocator: nonEmptyString(
        target.claimLocator,
        `${label}.targetClaimRef.claimLocator`,
        code,
      ),
      claimHash: hash(target.claimHash, `${label}.targetClaimRef.claimHash`, code),
    };
  }
  const applicabilityScopeRef =
    parsed.applicabilityScopeRef === undefined
      ? undefined
      : scopeJson(
          trustedScope(
            parsed.applicabilityScopeRef,
            context,
            `${label}.applicabilityScopeRef`,
            code,
          ),
        );
  return {
    evidence,
    ...(evidenceLinkRef === undefined ? {} : { evidenceLinkRef }),
    relation,
    ...(targetClaimRef === undefined ? {} : { targetClaimRef }),
    ...(applicabilityScopeRef === undefined ? {} : { applicabilityScopeRef }),
  };
}

function requireCanonical(value: CanonicalJsonObject): string {
  return canonicalize(value);
}

function digestBytes(value: CanonicalJsonObject): Buffer {
  return createSha256(requireCanonical(value));
}

function createSha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function reviewDefinitionPayload(value: CanonicalJsonObject): Buffer {
  return digestBytes(value);
}

function validateReviewIssueDefinition(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedReviewIssueDefinition {
  const code = QUALITY_REVIEW_ISSUE_INVALID;
  const parsed = record(value, 'definition', code);
  const artifactRef = objectRef(
    parsed.artifactRef,
    context,
    'definition.artifactRef',
    new Set([ARTIFACT_OBJECT_TYPE]),
    code,
  );
  const originRevisionRef = contentRef(
    parsed.originRevisionRef,
    context,
    'definition.originRevisionRef',
    new Set([REVISION_OBJECT_TYPE]),
    code,
  );
  if (!sameScope(artifactRef.scope, originRevisionRef.scope)) {
    throw new QualityBusinessError(
      code,
      'artifactRef and originRevisionRef must share exact scope',
    );
  }
  const originGateResultRef =
    parsed.originGateResultRef === undefined
      ? undefined
      : contentRef(
          parsed.originGateResultRef,
          context,
          'definition.originGateResultRef',
          new Set([GATE_RESULT_OBJECT_TYPE]),
          code,
        );
  if (
    originGateResultRef !== undefined &&
    !sameScope(originRevisionRef.scope, originGateResultRef.scope)
  ) {
    throw new QualityBusinessError(
      code,
      'originGateResultRef must share exact scope with originRevisionRef',
    );
  }
  const issueType = namespace(parsed.issueType, 'definition.issueType', code);
  const severity = parsed.severity;
  if (typeof severity !== 'string' || !ISSUE_SEVERITIES.has(severity)) {
    throw new QualityBusinessError(code, 'definition.severity is not closed');
  }
  const blockingClassification = namespace(
    parsed.blockingClassification,
    'definition.blockingClassification',
    code,
  );
  const statement = nonEmptyString(parsed.statement, 'definition.statement', code);
  const locator = nonEmptyString(parsed.locator, 'definition.locator', code);
  const evidenceRefs = array(parsed.evidenceRefs, 'definition.evidenceRefs', code).map(
    (item, index) => evidenceRef(item, context, `definition.evidenceRefs[${index}]`, code),
  );
  for (const evidenceRefValue of evidenceRefs) {
    if (!sameScope(originRevisionRef.scope, evidenceRefValue.evidence.scope)) {
      throw new QualityBusinessError(
        code,
        'evidenceRefs must share exact scope with originRevisionRef',
      );
    }
    if (
      evidenceRefValue.targetClaimRef !== undefined &&
      !sameScope(originRevisionRef.scope, evidenceRefValue.targetClaimRef.target.scope)
    ) {
      throw new QualityBusinessError(
        code,
        'targetClaimRef must share exact scope with originRevisionRef',
      );
    }
  }
  const raisedAt = instant(parsed.raisedAt, 'definition.raisedAt', code);
  const definition = {
    artifactRef,
    originRevisionRef,
    ...(originGateResultRef === undefined ? {} : { originGateResultRef }),
    issueType,
    severity,
    blockingClassification,
    statement,
    locator,
    evidenceRefs,
    raisedAt,
  } as QualityGovernance.ReviewIssueDefinition;
  return {
    definition,
    scope: {
      enterpriseId: context.enterpriseId,
      ...(originRevisionRef.scope.projectId === undefined
        ? {}
        : { projectId: originRevisionRef.scope.projectId }),
    },
    ...(originRevisionRef.scope.projectId === undefined
      ? {}
      : { projectId: originRevisionRef.scope.projectId }),
    originRevisionHash: hashBytes(originRevisionRef.contentHash),
    payloadHash: reviewDefinitionPayload(definition as unknown as CanonicalJsonObject),
  };
}

export { validateReviewIssueDefinition };

export function validateIssueResolution(
  value: unknown,
  proposedByValue: unknown,
  context: QualityTransactionContext,
): ValidatedIssueResolution {
  const code = QUALITY_REVIEW_ISSUE_INVALID;
  const parsed = record(value, 'resolution', code);
  const targetRevisionRef = contentRef(
    parsed.targetRevisionRef,
    context,
    'resolution.targetRevisionRef',
    new Set([REVISION_OBJECT_TYPE]),
    code,
  );
  const changedClaimRefs = array(parsed.changedClaimRefs, 'resolution.changedClaimRefs', code).map(
    (item, index) =>
      contentRef(
        item,
        context,
        `resolution.changedClaimRefs[${index}]`,
        new Set([CLAIM_OBJECT_TYPE]),
        code,
      ),
  );
  for (const claimRef of changedClaimRefs) {
    if (!sameScope(targetRevisionRef.scope, claimRef.scope)) {
      throw new QualityBusinessError(
        code,
        'changedClaimRefs must share exact scope with targetRevisionRef',
      );
    }
  }
  const explanation = nonEmptyString(parsed.explanation, 'resolution.explanation', code);
  const proposedAt = instant(parsed.proposedAt, 'resolution.proposedAt', code);
  const proposedBy = principalRef(proposedByValue, 'proposedBy', code);
  const resolution = {
    targetRevisionRef,
    changedClaimRefs,
    explanation,
    proposedAt,
  } as QualityGovernance.IssueResolution;
  return {
    resolution,
    proposedBy,
    scope: {
      enterpriseId: context.enterpriseId,
      ...(targetRevisionRef.scope.projectId === undefined
        ? {}
        : { projectId: targetRevisionRef.scope.projectId }),
    },
    ...(targetRevisionRef.scope.projectId === undefined
      ? {}
      : { projectId: targetRevisionRef.scope.projectId }),
    targetRevisionHash: hashBytes(targetRevisionRef.contentHash),
    payloadHash: reviewDefinitionPayload(resolution as unknown as CanonicalJsonObject),
  };
}

export function validateIssueVerification(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedIssueVerification {
  const code = QUALITY_REVIEW_ISSUE_INVALID;
  const parsed = record(value, 'verification', code);
  const targetRevisionRef = contentRef(
    parsed.targetRevisionRef,
    context,
    'verification.targetRevisionRef',
    new Set([REVISION_OBJECT_TYPE]),
    code,
  );
  const verifier = principalRef(parsed.verifier, 'verification.verifier', code);
  const verificationMethod = namespace(
    parsed.verificationMethod,
    'verification.verificationMethod',
    code,
  );
  const supportingGateResultRefs = array(
    parsed.supportingGateResultRefs,
    'verification.supportingGateResultRefs',
    code,
  ).map((item, index) =>
    contentRef(
      item,
      context,
      `verification.supportingGateResultRefs[${index}]`,
      new Set([GATE_RESULT_OBJECT_TYPE]),
      code,
    ),
  );
  for (const gateResultRef of supportingGateResultRefs) {
    if (!sameScope(targetRevisionRef.scope, gateResultRef.scope)) {
      throw new QualityBusinessError(
        code,
        'supportingGateResultRefs must share exact scope with targetRevisionRef',
      );
    }
  }
  const outcome = parsed.outcome;
  if (outcome !== 'VERIFIED' && outcome !== 'REJECTED') {
    throw new QualityBusinessError(code, 'verification.outcome is not closed');
  }
  const verifiedAt = instant(parsed.verifiedAt, 'verification.verifiedAt', code);
  const verification = {
    targetRevisionRef,
    verifier,
    verificationMethod,
    supportingGateResultRefs,
    outcome,
    verifiedAt,
  } as QualityGovernance.IssueVerification;
  return {
    verification,
    scope: {
      enterpriseId: context.enterpriseId,
      ...(targetRevisionRef.scope.projectId === undefined
        ? {}
        : { projectId: targetRevisionRef.scope.projectId }),
    },
    ...(targetRevisionRef.scope.projectId === undefined
      ? {}
      : { projectId: targetRevisionRef.scope.projectId }),
    targetRevisionHash: hashBytes(targetRevisionRef.contentHash),
    payloadHash: reviewDefinitionPayload(verification as unknown as CanonicalJsonObject),
  };
}

export function validateApprovalRequestDefinition(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedApprovalRequestDefinition {
  const code = QUALITY_APPROVAL_INVALID;
  const parsed = record(value, 'definition', code);
  const artifactRef = objectRef(
    parsed.artifactRef,
    context,
    'definition.artifactRef',
    new Set([ARTIFACT_OBJECT_TYPE]),
    code,
  );
  const revisionRef = contentRef(
    parsed.revisionRef,
    context,
    'definition.revisionRef',
    new Set([REVISION_OBJECT_TYPE]),
    code,
  );
  if (!sameScope(artifactRef.scope, revisionRef.scope)) {
    throw new QualityBusinessError(
      QUALITY_APPROVAL_REVISION_MISMATCH,
      'artifactRef and revisionRef must share exact scope',
    );
  }
  const revisionAcceptanceSnapshotRef = snapshotRef(
    parsed.revisionAcceptanceSnapshotRef,
    context,
    'definition.revisionAcceptanceSnapshotRef',
    new Set([RAS_OBJECT_TYPE]),
    code,
  );
  if (!sameScope(revisionRef.scope, revisionAcceptanceSnapshotRef.scope)) {
    throw new QualityBusinessError(
      QUALITY_APPROVAL_REVISION_MISMATCH,
      'revisionRef and revisionAcceptanceSnapshotRef must share exact scope',
    );
  }
  const qualityProfileRef = versionedQualityProfileRef(
    parsed.qualityProfileRef,
    context,
    'definition.qualityProfileRef',
    code,
  );
  const approvalRequirementId = uuid(
    parsed.approvalRequirementId,
    'definition.approvalRequirementId',
    code,
  );
  const requestedApproverRole = namespace(
    parsed.requestedApproverRole,
    'definition.requestedApproverRole',
    code,
  );
  const expiresAt =
    parsed.expiresAt === undefined
      ? undefined
      : instant(parsed.expiresAt, 'definition.expiresAt', code);
  const requestNonceHash = hash(parsed.requestNonceHash, 'definition.requestNonceHash', code);
  const definition = {
    artifactRef,
    revisionRef,
    revisionAcceptanceSnapshotRef,
    qualityProfileRef,
    approvalRequirementId,
    requestedApproverRole,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    requestNonceHash,
  } as QualityGovernance.ApprovalRequestDefinition;
  const scope: ValidationScope = {
    enterpriseId: context.enterpriseId,
    ...(revisionRef.scope.projectId === undefined
      ? {}
      : { projectId: revisionRef.scope.projectId }),
  };
  return {
    definition,
    scope,
    ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
    revisionContentHash: hashBytes(revisionRef.contentHash),
    revisionAcceptanceSnapshotHash: hashBytes(revisionAcceptanceSnapshotRef.contentHash),
    requestNonceHash: hashBytes(requestNonceHash),
    payloadHash: reviewDefinitionPayload(definition as unknown as CanonicalJsonObject),
  };
}

function versionedQualityProfileRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  code: string,
): Common.VersionedRef {
  const parsed = record(value, label, code);
  const objectType = namespace(parsed.objectType, `${label}.objectType`, code);
  if (parsed.kind !== 'VERSIONED' || objectType !== QUALITY_PROFILE_OBJECT_TYPE) {
    throw new QualityBusinessError(code, `${label} must identify an exact QualityProfile version`);
  }
  const scope = trustedScope(parsed.scope, context, label, code);
  if (scope.projectId !== undefined) {
    throw new QualityBusinessError(code, `${label} must be Enterprise-scoped`);
  }
  return {
    kind: 'VERSIONED',
    objectType,
    objectId: uuid(parsed.objectId, `${label}.objectId`, code),
    versionId: uuid(parsed.versionId, `${label}.versionId`, code),
    scope: scopeJson(scope),
  };
}

export function validateApprovalSubmission(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedApprovalSubmission {
  const code = QUALITY_APPROVAL_INVALID;
  const parsed = record(value, 'submission', code);
  const requestRef = objectRef(
    parsed.requestRef,
    context,
    'submission.requestRef',
    new Set([APPROVAL_REQUEST_OBJECT_TYPE]),
    code,
  );
  const revisionRef = contentRef(
    parsed.revisionRef,
    context,
    'submission.revisionRef',
    new Set([REVISION_OBJECT_TYPE]),
    code,
  );
  const revisionAcceptanceSnapshotRef = snapshotRef(
    parsed.revisionAcceptanceSnapshotRef,
    context,
    'submission.revisionAcceptanceSnapshotRef',
    new Set([RAS_OBJECT_TYPE]),
    code,
  );
  if (
    !sameScope(requestRef.scope, revisionRef.scope) ||
    !sameScope(revisionRef.scope, revisionAcceptanceSnapshotRef.scope)
  ) {
    throw new QualityBusinessError(
      QUALITY_APPROVAL_REVISION_MISMATCH,
      'Approval request, Revision and RAS must use one exact scope',
    );
  }
  const approvalRequirementId = uuid(
    parsed.approvalRequirementId,
    'submission.approvalRequirementId',
    code,
  );
  const decision = parsed.decision;
  if (typeof decision !== 'string' || !APPROVAL_DECISIONS.has(decision)) {
    throw new QualityBusinessError(code, 'submission.decision is not closed');
  }
  const decisionComment = nonEmptyString(
    parsed.decisionComment,
    'submission.decisionComment',
    code,
  );
  const approverHumanPrincipalRef = principalRef(
    parsed.approverHumanPrincipalRef,
    'submission.approverHumanPrincipalRef',
    QUALITY_APPROVAL_AGENT_FORBIDDEN,
  );
  if (approverHumanPrincipalRef.principalKind !== 'HUMAN') {
    throw new QualityBusinessError(
      QUALITY_APPROVAL_AGENT_FORBIDDEN,
      'only a Human principal can submit an Approval decision',
    );
  }
  const approverRoleSnapshotRef = snapshotRef(
    parsed.approverRoleSnapshotRef,
    context,
    'submission.approverRoleSnapshotRef',
    new Set([ROLE_SNAPSHOT_OBJECT_TYPE]),
    code,
  );
  const authorizationDecisionRef = contentRef(
    parsed.authorizationDecisionRef,
    context,
    'submission.authorizationDecisionRef',
    new Set([AUTHORIZATION_DECISION_OBJECT_TYPE]),
    code,
  );
  const separationCheckRef = contentRef(
    parsed.separationCheckRef,
    context,
    'submission.separationCheckRef',
    new Set([SEPARATION_CHECK_OBJECT_TYPE]),
    QUALITY_SEPARATION_OF_DUTIES_VIOLATION,
  );
  const decidedAt = instant(parsed.decidedAt, 'submission.decidedAt', code);
  const submission = {
    requestRef,
    revisionRef,
    revisionAcceptanceSnapshotRef,
    approvalRequirementId,
    decision,
    decisionComment,
    approverHumanPrincipalRef,
    approverRoleSnapshotRef,
    authorizationDecisionRef,
    separationCheckRef,
    decidedAt,
  } as QualityGovernance.ApprovalSubmission;
  const scope: ValidationScope = {
    enterpriseId: context.enterpriseId,
    ...(revisionRef.scope.projectId === undefined
      ? {}
      : { projectId: revisionRef.scope.projectId }),
  };
  return {
    submission,
    scope,
    ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
    revisionContentHash: hashBytes(revisionRef.contentHash),
    revisionAcceptanceSnapshotHash: hashBytes(revisionAcceptanceSnapshotRef.contentHash),
    payloadHash: reviewDefinitionPayload(submission as unknown as CanonicalJsonObject),
  };
}

function validateJustification(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  code: string,
): Common.Justification {
  const parsed = record(value, label, code);
  const reasonCodeValue = reasonCode(parsed.reasonCode, `${label}.reasonCode`, code);
  const summary = nonEmptyString(parsed.summary, `${label}.summary`, code);
  const evidenceRefs = array(parsed.evidenceRefs, `${label}.evidenceRefs`, code).map(
    (item, index) => evidenceRef(item, context, `${label}.evidenceRefs[${index}]`, code),
  );
  return {
    reasonCode: reasonCodeValue,
    summary,
    evidenceRefs,
  };
}

export function validateIssueCloseReason(
  value: unknown,
  context: QualityTransactionContext,
): Common.Justification {
  return validateJustification(value, context, 'closeReason', QUALITY_ISSUE_VERIFICATION_REQUIRED);
}

export function validateApprovalRevocation(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedApprovalRevocation {
  const code = QUALITY_APPROVAL_INVALID;
  const parsed = record(value, 'revocation', code);
  const revocationReason = validateJustification(
    parsed.revocationReason,
    context,
    'revocation.revocationReason',
    code,
  );
  const impactAssessmentRef = contentRef(
    parsed.impactAssessmentRef,
    context,
    'revocation.impactAssessmentRef',
    new Set(['quality.impact_assessment']),
    code,
  );
  const revokedAtText = instant(parsed.revokedAt, 'revocation.revokedAt', code);
  const definition = {
    revocationReason,
    impactAssessmentRef,
    revokedAt: revokedAtText,
  } as unknown as CanonicalJsonObject;
  return {
    revocationReason,
    impactAssessmentRef,
    revokedAt: new Date(revokedAtText),
    revokedAtText,
    payloadHash: reviewDefinitionPayload(definition),
  };
}

export function isExactRef(left: unknown, right: unknown): boolean {
  return sameJson(left, right);
}

export function contentAddressedHash(ref: Pick<Common.ContentAddressedRef, 'contentHash'>): Buffer {
  return hashBytes(ref.contentHash);
}

export function objectRefForIssue(issueId: string, scope: Common.ScopeRef): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: REVIEW_ISSUE_OBJECT_TYPE,
    objectId: issueId,
    scope,
  };
}

export function snapshotRefForApprovalBundle(
  snapshotId: string,
  scope: Common.ScopeRef,
  payloadHash: Buffer,
): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType: APPROVAL_BUNDLE_OBJECT_TYPE,
    objectId: snapshotId,
    snapshotId,
    scope,
    contentHash: {
      algorithm: 'SHA-256',
      digest: payloadHash.toString('hex'),
      canonicalizationVersion: '1',
    },
  };
}
