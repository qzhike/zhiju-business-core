// IM-05 WI-03 (issue #123): fail-closed validation for GateResult,
// ChangeImpact, and readiness evaluator inputs. Cross-module facts are
// validated as exact typed references and are never resolved by fallback name.

import { createHash } from 'node:crypto';
import type { CanonicalJson, Common, QualityGovernance } from '@zhiju/contracts';
import {
  canonicalize,
  isUuidV7,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import type { QualityTransactionContext } from '../persistence/quality-db.js';
import {
  QUALITY_GATE_INPUT_MISMATCH,
  QUALITY_GATE_RESULT_INVALID,
  QUALITY_GATE_STAGE_MISMATCH,
  QUALITY_RELEASE_PACKAGE_TARGET_MISMATCH,
  QualityBusinessError,
} from './quality-business-errors.js';

type RecordLike = Readonly<Record<string, unknown>>;

interface Scope {
  readonly enterpriseId: string;
  readonly projectId?: string;
}

export interface ValidatedGateResultSubmission {
  readonly submission: QualityGovernance.GateResultSubmission;
  readonly definition: CanonicalJsonObject;
  readonly scope: Scope;
  readonly projectId?: string;
  readonly revisionContentHash: Buffer;
  readonly payloadHash: Buffer;
}

export interface ValidatedGateReuseSubmission {
  readonly reuse: QualityGovernance.GateReuseSubmission;
  readonly scope: Scope;
  readonly projectId?: string;
}

export interface ValidatedGateInvalidation {
  readonly invalidationReason: Common.Justification;
  readonly impactAssessmentRef: Common.ContentAddressedRef;
  readonly invalidatedAt: Date;
}

export interface ValidatedChangeImpact {
  readonly definition: CanonicalJsonObject;
  readonly scope: Scope;
  readonly projectId?: string;
  readonly baseRevisionRef: Common.ContentAddressedRef;
  readonly targetRevisionRef: Common.ContentAddressedRef;
  readonly payloadHash: Buffer;
}

export interface ValidatedRevisionReadinessInput {
  readonly revisionRef: Common.ContentAddressedRef;
  readonly qualityProfileRef: Common.VersionedRef;
  readonly gateResultRefs: readonly Common.ContentAddressedRef[];
  readonly evidenceStatusSnapshotRef: Common.SnapshotRef;
  readonly issueSnapshotRef: Common.SnapshotRef;
  readonly evaluatorVersions: readonly CanonicalJson[];
  readonly evaluatedAt: Date;
  readonly evaluatedAtText: string;
}

export interface ValidatedReleaseReadinessInput {
  readonly releasePackageRef: Common.ReleasePackageRef;
  readonly approvalBundleSnapshotRef: Common.SnapshotRef;
  readonly recipientScopeSnapshotRef: Common.SnapshotRef;
  readonly destinationRefs: readonly Common.ExternalRef[];
  readonly releaseGateResultRefs: readonly Common.ContentAddressedRef[];
  readonly evaluatedAt: Date;
  readonly evaluatedAtText: string;
}

const ARTIFACT_OBJECT_TYPE = 'artifact.artifact';
const ARTIFACT_REVISION_OBJECT_TYPE = 'artifact.artifact_revision';
const QUALITY_PROFILE_OBJECT_TYPE = 'quality.quality_profile';
const GATE_RESULT_OBJECT_TYPE = 'quality.gate_result';
const CHANGE_IMPACT_OBJECT_TYPE = 'quality.change_impact';
const IMPACT_ASSESSMENT_OBJECT_TYPE = 'quality.impact_assessment';
const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const PRINCIPAL_KINDS = new Set(['HUMAN', 'AGENT', 'SERVICE', 'RUNTIME', 'EXTERNAL_PARTY']);
const GATE_OUTCOMES = new Set(['PASS', 'FAIL', 'ERROR', 'SKIPPED', 'NOT_APPLICABLE']);

function record(value: unknown, label: string, code = QUALITY_GATE_INPUT_MISMATCH): RecordLike {
  const parsed = canonicalValue(value, code);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new QualityBusinessError(code, `${label} must be a JSON object`);
  }
  return parsed as RecordLike;
}

function canonicalValue(value: unknown, code = QUALITY_GATE_INPUT_MISMATCH): CanonicalJsonValue {
  try {
    const serialized = JSON.stringify(value);
    return JSON.parse(serialized) as CanonicalJsonValue;
  } catch {
    throw new QualityBusinessError(code, 'value is not valid canonical JSON');
  }
}

function array(
  value: unknown,
  label: string,
  code = QUALITY_GATE_INPUT_MISMATCH,
): CanonicalJsonValue[] {
  const parsed = canonicalValue(value, code);
  if (!Array.isArray(parsed)) {
    throw new QualityBusinessError(code, `${label} must be an array`);
  }
  return parsed as CanonicalJsonValue[];
}

function nonEmptyString(value: unknown, label: string, code = QUALITY_GATE_INPUT_MISMATCH): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new QualityBusinessError(code, `${label} must be non-empty`);
  }
  return value;
}

function uuid(value: unknown, label: string, code = QUALITY_GATE_INPUT_MISMATCH): string {
  if (typeof value !== 'string' || !isUuidV7(value)) {
    throw new QualityBusinessError(code, `${label} must be a UUIDv7`);
  }
  return value;
}

function instant(value: unknown, label: string, code = QUALITY_GATE_RESULT_INVALID): string {
  if (
    typeof value !== 'string' ||
    !UTC_INSTANT_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new QualityBusinessError(code, `${label} must be a UTC instant`);
  }
  return value;
}

function contentHash(
  value: unknown,
  label: string,
  code = QUALITY_GATE_INPUT_MISMATCH,
): Common.ContentHash {
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

function contentHashBytes(value: Common.ContentHash): Buffer {
  return Buffer.from(value.digest, 'hex');
}

function trustedScope(value: unknown, context: QualityTransactionContext, label: string): Scope {
  const parsed = record(value, label);
  const enterpriseId = parsed.enterpriseId;
  const projectId = parsed.projectId;
  if (enterpriseId !== context.enterpriseId) {
    throw new QualityBusinessError(
      QUALITY_GATE_INPUT_MISMATCH,
      `${label} is outside the trusted enterprise scope`,
    );
  }
  if (
    projectId !== undefined &&
    (typeof projectId !== 'string' ||
      !isUuidV7(projectId) ||
      !context.allowedProjectIds.includes(projectId))
  ) {
    throw new QualityBusinessError(
      QUALITY_GATE_INPUT_MISMATCH,
      `${label} is outside the trusted project scope`,
    );
  }
  return {
    enterpriseId: context.enterpriseId,
    ...(projectId === undefined ? {} : { projectId }),
  };
}

function scopeJson(scope: Scope): Common.ScopeRef {
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

function objectRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  objectTypes?: ReadonlySet<string>,
): Common.ObjectRef {
  const parsed = record(value, label);
  const objectType = nonEmptyString(parsed.objectType, `${label}.objectType`);
  if (parsed.kind !== 'OBJECT' || (objectTypes !== undefined && !objectTypes.has(objectType))) {
    throw new QualityBusinessError(
      QUALITY_GATE_INPUT_MISMATCH,
      `${label} must identify the expected ObjectRef`,
    );
  }
  const refScope = trustedScope(parsed.scope, context, `${label}.scope`);
  return {
    kind: 'OBJECT',
    objectType,
    objectId: uuid(parsed.objectId, `${label}.objectId`),
    scope: scopeJson(refScope),
  };
}

function contentRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  objectTypes?: ReadonlySet<string>,
): Common.ContentAddressedRef {
  const parsed = record(value, label);
  const objectType = nonEmptyString(parsed.objectType, `${label}.objectType`);
  if (
    parsed.kind !== 'CONTENT_ADDRESSED' ||
    (objectTypes !== undefined && !objectTypes.has(objectType))
  ) {
    throw new QualityBusinessError(
      QUALITY_GATE_INPUT_MISMATCH,
      `${label} must identify the expected ContentAddressedRef`,
    );
  }
  const refScope = trustedScope(parsed.scope, context, `${label}.scope`);
  const immutableVersionId =
    parsed.immutableVersionId === undefined
      ? undefined
      : uuid(parsed.immutableVersionId, `${label}.immutableVersionId`);
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId: uuid(parsed.objectId, `${label}.objectId`),
    ...(immutableVersionId === undefined ? {} : { immutableVersionId }),
    scope: scopeJson(refScope),
    contentHash: contentHash(parsed.contentHash, `${label}.contentHash`),
  };
}

function versionedRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  objectTypes?: ReadonlySet<string>,
): Common.VersionedRef {
  const parsed = record(value, label);
  const objectType = nonEmptyString(parsed.objectType, `${label}.objectType`);
  if (parsed.kind !== 'VERSIONED' || (objectTypes !== undefined && !objectTypes.has(objectType))) {
    throw new QualityBusinessError(
      QUALITY_GATE_INPUT_MISMATCH,
      `${label} must identify the expected VersionedRef`,
    );
  }
  const refScope = trustedScope(parsed.scope, context, `${label}.scope`);
  return {
    kind: 'VERSIONED',
    objectType,
    objectId: uuid(parsed.objectId, `${label}.objectId`),
    versionId: uuid(parsed.versionId, `${label}.versionId`),
    scope: scopeJson(refScope),
  };
}

function snapshotRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
): Common.SnapshotRef {
  const parsed = record(value, label);
  if (parsed.kind !== 'SNAPSHOT') {
    throw new QualityBusinessError(QUALITY_GATE_INPUT_MISMATCH, `${label} must be a SnapshotRef`);
  }
  const refScope = trustedScope(parsed.scope, context, `${label}.scope`);
  return {
    kind: 'SNAPSHOT',
    objectType: nonEmptyString(parsed.objectType, `${label}.objectType`),
    objectId: uuid(parsed.objectId, `${label}.objectId`),
    snapshotId: uuid(parsed.snapshotId, `${label}.snapshotId`),
    scope: scopeJson(refScope),
    contentHash: contentHash(parsed.contentHash, `${label}.contentHash`),
  };
}

function principal(value: unknown, label: string): Common.PrincipalRef {
  const parsed = record(value, label, QUALITY_GATE_RESULT_INVALID);
  if (typeof parsed.principalKind !== 'string' || !PRINCIPAL_KINDS.has(parsed.principalKind)) {
    throw new QualityBusinessError(
      QUALITY_GATE_RESULT_INVALID,
      `${label}.principalKind is not closed`,
    );
  }
  return {
    principalKind: parsed.principalKind as Common.PrincipalRef['principalKind'],
    principalId: uuid(parsed.principalId, `${label}.principalId`, QUALITY_GATE_RESULT_INVALID),
  };
}

function evidenceRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
): Common.EvidenceRef {
  const parsed = record(value, label, QUALITY_GATE_RESULT_INVALID);
  const evidence = contentRef(
    parsed.evidence,
    context,
    `${label}.evidence`,
    new Set(['quality.evidence']),
  );
  if (!['SUPPORTS', 'CONTRADICTS', 'CONTEXT_ONLY'].includes(String(parsed.relation))) {
    throw new QualityBusinessError(QUALITY_GATE_RESULT_INVALID, `${label}.relation is not closed`);
  }
  const evidenceLinkRef =
    parsed.evidenceLinkRef === undefined
      ? undefined
      : objectRef(parsed.evidenceLinkRef, context, `${label}.evidenceLinkRef`);
  let targetClaimRef: Common.EvidenceRef['targetClaimRef'];
  if (parsed.targetClaimRef !== undefined) {
    const target = record(
      parsed.targetClaimRef,
      `${label}.targetClaimRef`,
      QUALITY_GATE_RESULT_INVALID,
    );
    targetClaimRef = {
      target: contentRef(target.target, context, `${label}.targetClaimRef.target`),
      claimLocator: nonEmptyString(
        target.claimLocator,
        `${label}.targetClaimRef.claimLocator`,
        QUALITY_GATE_RESULT_INVALID,
      ),
      claimHash: contentHash(
        target.claimHash,
        `${label}.targetClaimRef.claimHash`,
        QUALITY_GATE_RESULT_INVALID,
      ),
    };
  }
  const applicabilityScopeRef =
    parsed.applicabilityScopeRef === undefined
      ? undefined
      : scopeJson(
          trustedScope(parsed.applicabilityScopeRef, context, `${label}.applicabilityScopeRef`),
        );
  return {
    evidence,
    ...(evidenceLinkRef === undefined ? {} : { evidenceLinkRef }),
    relation: parsed.relation as Common.EvidenceRef['relation'],
    ...(targetClaimRef === undefined ? {} : { targetClaimRef }),
    ...(applicabilityScopeRef === undefined ? {} : { applicabilityScopeRef }),
  };
}

function representationRef(
  value: unknown,
  context: QualityTransactionContext,
  revision: Common.ContentAddressedRef,
): Common.RepresentationRef {
  const parsed = record(value, 'gateTarget.representationRef', QUALITY_GATE_INPUT_MISMATCH);
  const representationRevision = contentRef(
    parsed.revision,
    context,
    'gateTarget.representationRef.revision',
    new Set([ARTIFACT_REVISION_OBJECT_TYPE]),
  );
  if (!sameContentRef(representationRevision, revision)) {
    throw new QualityBusinessError(
      QUALITY_GATE_INPUT_MISMATCH,
      'representationRef.revision must equal gateTarget.revisionRef',
    );
  }
  const renderer = record(parsed.renderer, 'gateTarget.representationRef.renderer');
  return {
    representationId: uuid(
      parsed.representationId,
      'gateTarget.representationRef.representationId',
    ),
    revision: representationRevision,
    format: nonEmptyString(parsed.format, 'gateTarget.representationRef.format'),
    mediaType: nonEmptyString(parsed.mediaType, 'gateTarget.representationRef.mediaType'),
    objectStorageRef: nonEmptyString(
      parsed.objectStorageRef,
      'gateTarget.representationRef.objectStorageRef',
    ),
    checksum: contentHash(parsed.checksum, 'gateTarget.representationRef.checksum'),
    renderer: {
      rendererId: nonEmptyString(
        renderer.rendererId,
        'gateTarget.representationRef.renderer.rendererId',
      ),
      rendererVersion: nonEmptyString(
        renderer.rendererVersion,
        'gateTarget.representationRef.renderer.rendererVersion',
      ),
    },
    createdAt: instant(parsed.createdAt, 'gateTarget.representationRef.createdAt'),
  };
}

function releasePackageRef(
  value: unknown,
  context: QualityTransactionContext,
): Common.ReleasePackageRef {
  const parsed = record(value, 'gateTarget.releasePackageRef');
  return {
    releaseRef: objectRef(parsed.releaseRef, context, 'gateTarget.releasePackageRef.releaseRef'),
    packageSnapshotRef: snapshotRef(
      parsed.packageSnapshotRef,
      context,
      'gateTarget.releasePackageRef.packageSnapshotRef',
    ),
    packageHash: contentHash(parsed.packageHash, 'gateTarget.releasePackageRef.packageHash'),
  };
}

function sameContentRef(
  left: Common.ContentAddressedRef,
  right: Common.ContentAddressedRef,
): boolean {
  return (
    left.objectType === right.objectType &&
    left.objectId === right.objectId &&
    (left.immutableVersionId ?? undefined) === (right.immutableVersionId ?? undefined) &&
    sameScope(left.scope, right.scope) &&
    left.contentHash.digest === right.contentHash.digest
  );
}

function gateTarget(
  value: unknown,
  context: QualityTransactionContext,
): QualityGovernance.GateTarget {
  const parsed = record(value, 'gateTarget', QUALITY_GATE_INPUT_MISMATCH);
  const kind = parsed.kind;
  const revisionRef = contentRef(
    parsed.revisionRef,
    context,
    'gateTarget.revisionRef',
    new Set([ARTIFACT_REVISION_OBJECT_TYPE]),
  );
  if (kind === 'REVISION') {
    return { kind, revisionRef };
  }
  if (kind === 'REPRESENTATION') {
    return {
      kind,
      revisionRef,
      representationRef: representationRef(parsed.representationRef, context, revisionRef),
    };
  }
  if (kind === 'RELEASE_PACKAGE') {
    return {
      kind,
      revisionRef,
      releasePackageRef: releasePackageRef(parsed.releasePackageRef, context),
    };
  }
  throw new QualityBusinessError(QUALITY_GATE_INPUT_MISMATCH, 'gateTarget.kind is not closed');
}

export function validateGateTarget(
  value: unknown,
  context: QualityTransactionContext,
): QualityGovernance.GateTarget {
  return gateTarget(value, context);
}

export function validateContentAddressedRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  objectTypes?: ReadonlySet<string>,
): Common.ContentAddressedRef {
  return contentRef(value, context, label, objectTypes);
}

export function validateSnapshotRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
): Common.SnapshotRef {
  return snapshotRef(value, context, label);
}

function validateEvaluatedScope(value: unknown): CanonicalJson {
  const parsed = canonicalValue(value, QUALITY_GATE_RESULT_INVALID);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new QualityBusinessError(
      QUALITY_GATE_RESULT_INVALID,
      'evaluatedScope must be a canonical JSON object',
    );
  }
  return parsed;
}

export function validateGateResultSubmission(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedGateResultSubmission {
  const parsed = record(value, 'submission', QUALITY_GATE_RESULT_INVALID);
  if (parsed.executionMode !== undefined) {
    throw new QualityBusinessError(
      QUALITY_GATE_RESULT_INVALID,
      'executionMode is not accepted on the executed GateResult submission path',
    );
  }
  const artifactRef = objectRef(
    parsed.artifactRef,
    context,
    'submission.artifactRef',
    new Set([ARTIFACT_OBJECT_TYPE]),
  );
  const target = gateTarget(parsed.gateTarget, context);
  const evaluationStage = parsed.evaluationStage;
  if (evaluationStage !== 'REVISION_ACCEPTANCE' && evaluationStage !== 'RELEASE_READINESS') {
    throw new QualityBusinessError(QUALITY_GATE_RESULT_INVALID, 'evaluationStage is not closed');
  }
  if (
    (evaluationStage === 'REVISION_ACCEPTANCE' && target.kind !== 'REVISION') ||
    (evaluationStage === 'RELEASE_READINESS' && target.kind === 'REVISION')
  ) {
    throw new QualityBusinessError(
      QUALITY_GATE_STAGE_MISMATCH,
      'evaluationStage does not permit the supplied GateTarget kind',
    );
  }
  if (parsed.qualityProfileRef === undefined) {
    throw new QualityBusinessError(QUALITY_GATE_INPUT_MISMATCH, 'qualityProfileRef is required');
  }
  const qualityProfileRef = versionedRef(
    parsed.qualityProfileRef,
    context,
    'submission.qualityProfileRef',
    new Set([QUALITY_PROFILE_OBJECT_TYPE]),
  );
  const gateSpecId = uuid(parsed.gateSpecId, 'submission.gateSpecId');
  const gateVersion = nonEmptyString(parsed.gateVersion, 'submission.gateVersion');
  const evaluationAttempt = parsed.evaluationAttempt;
  if (
    typeof evaluationAttempt !== 'number' ||
    !Number.isSafeInteger(evaluationAttempt) ||
    evaluationAttempt < 1
  ) {
    throw new QualityBusinessError(
      QUALITY_GATE_RESULT_INVALID,
      'evaluationAttempt must be a positive integer',
    );
  }
  const evaluatedScope = validateEvaluatedScope(parsed.evaluatedScope);
  const inputSnapshotRef = snapshotRef(
    parsed.inputSnapshotRef,
    context,
    'submission.inputSnapshotRef',
  );
  const evaluator = record(parsed.evaluator, 'submission.evaluator', QUALITY_GATE_RESULT_INVALID);
  const outcome = parsed.outcome;
  if (typeof outcome !== 'string' || !GATE_OUTCOMES.has(outcome)) {
    throw new QualityBusinessError(QUALITY_GATE_RESULT_INVALID, 'outcome is not closed');
  }
  const findings = array(parsed.findings, 'submission.findings', QUALITY_GATE_RESULT_INVALID);
  const evidenceRefs = array(
    parsed.evidenceRefs,
    'submission.evidenceRefs',
    QUALITY_GATE_RESULT_INVALID,
  ).map((item, index) => evidenceRef(item, context, `submission.evidenceRefs[${index}]`));
  const startedAt = instant(parsed.startedAt, 'submission.startedAt');
  const completedAt = instant(parsed.completedAt, 'submission.completedAt');
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new QualityBusinessError(
      QUALITY_GATE_RESULT_INVALID,
      'completedAt must not precede startedAt',
    );
  }
  const normalized = {
    artifactRef,
    gateTarget: target,
    evaluationStage,
    qualityProfileRef,
    gateSpecId,
    gateVersion,
    evaluationAttempt,
    evaluatedScope,
    inputSnapshotRef,
    evaluator: canonicalValue(evaluator, QUALITY_GATE_RESULT_INVALID),
    outcome,
    findings,
    evidenceRefs,
    startedAt,
    completedAt,
  } as QualityGovernance.GateResultSubmission;
  const definition = normalized as unknown as CanonicalJsonObject;
  const revisionContentHash = contentHashBytes(target.revisionRef.contentHash);
  const scope = trustedScope(
    target.revisionRef.scope,
    context,
    'submission.gateTarget.revisionRef.scope',
  );
  if (!sameScope(artifactRef.scope, target.revisionRef.scope)) {
    throw new QualityBusinessError(
      QUALITY_GATE_INPUT_MISMATCH,
      'artifactRef and gateTarget.revisionRef must use the same exact scope',
    );
  }
  return {
    submission: normalized,
    definition,
    scope,
    ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
    revisionContentHash,
    payloadHash: digestDefinition(definition),
  };
}

function digestDefinition(value: CanonicalJsonObject): Buffer {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest();
}

export function validateGateReuseSubmission(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedGateReuseSubmission {
  const parsed = record(value, 'reuse', QUALITY_GATE_REUSE_CODE);
  const target = gateTarget(parsed.newTarget, context);
  const qualityProfileRef = versionedRef(
    parsed.qualityProfileRef,
    context,
    'reuse.qualityProfileRef',
    new Set([QUALITY_PROFILE_OBJECT_TYPE]),
  );
  const gateSpecId = uuid(parsed.gateSpecId, 'reuse.gateSpecId');
  const sourceGateResultRef = contentRef(
    parsed.sourceGateResultRef,
    context,
    'reuse.sourceGateResultRef',
    new Set([GATE_RESULT_OBJECT_TYPE]),
  );
  const changeImpactRef = contentRef(
    parsed.changeImpactRef,
    context,
    'reuse.changeImpactRef',
    new Set([CHANGE_IMPACT_OBJECT_TYPE]),
  );
  const derivedOutcome = parsed.derivedOutcome;
  if (typeof derivedOutcome !== 'string' || !GATE_OUTCOMES.has(derivedOutcome)) {
    throw new QualityBusinessError(QUALITY_GATE_REUSE_CODE, 'derivedOutcome is not closed');
  }
  const evaluatedAtText = instant(parsed.evaluatedAt, 'reuse.evaluatedAt', QUALITY_GATE_REUSE_CODE);
  const scope = trustedScope(
    target.revisionRef.scope,
    context,
    'reuse.newTarget.revisionRef.scope',
  );
  return {
    reuse: {
      newTarget: target,
      sourceGateResultRef,
      changeImpactRef,
      qualityProfileRef,
      gateSpecId,
      derivedOutcome: derivedOutcome as QualityGovernance.GateOutcome,
      evaluatedAt: evaluatedAtText,
    },
    scope,
    ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
  };
}

const QUALITY_GATE_REUSE_CODE = 'QUALITY_GATE_REUSE_NOT_ALLOWED';

export function validateGateInvalidation(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedGateInvalidation {
  const parsed = record(value, 'invalidation', QUALITY_GATE_INPUT_MISMATCH);
  const reason = record(parsed.invalidationReason, 'invalidation.invalidationReason');
  const evidenceRefs = array(
    reason.evidenceRefs,
    'invalidation.invalidationReason.evidenceRefs',
    QUALITY_GATE_INPUT_MISMATCH,
  ).map((item, index) =>
    evidenceRef(item, context, `invalidation.invalidationReason.evidenceRefs[${index}]`),
  );
  const policyRef =
    reason.policyRef === undefined
      ? undefined
      : versionedRef(reason.policyRef, context, 'invalidation.invalidationReason.policyRef');
  const invalidationReason: Common.Justification = {
    reasonCode: nonEmptyString(reason.reasonCode, 'invalidation.invalidationReason.reasonCode'),
    summary: nonEmptyString(reason.summary, 'invalidation.invalidationReason.summary'),
    evidenceRefs,
    ...(policyRef === undefined ? {} : { policyRef }),
  };
  const impactAssessmentRef = contentRef(
    parsed.impactAssessmentRef,
    context,
    'invalidation.impactAssessmentRef',
    new Set([IMPACT_ASSESSMENT_OBJECT_TYPE]),
  );
  const invalidatedAtText = instant(parsed.invalidatedAt, 'invalidation.invalidatedAt');
  return {
    invalidationReason,
    impactAssessmentRef,
    invalidatedAt: new Date(invalidatedAtText),
  };
}

function typedReference(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
): Common.TypedReference {
  const parsed = record(value, label, QUALITY_GATE_INPUT_MISMATCH);
  if (parsed.kind === 'OBJECT') return objectRef(parsed, context, label);
  if (parsed.kind === 'VERSIONED') return versionedRef(parsed, context, label);
  if (parsed.kind === 'CONTENT_ADDRESSED') return contentRef(parsed, context, label);
  if (parsed.kind === 'SNAPSHOT') return snapshotRef(parsed, context, label);
  if (parsed.kind === 'EXTERNAL') {
    return externalRef(parsed, context, label);
  }
  throw new QualityBusinessError(QUALITY_GATE_INPUT_MISMATCH, `${label} is not a TypedReference`);
}

function externalRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
): Common.ExternalRef {
  const parsed = record(value, label, QUALITY_GATE_INPUT_MISMATCH);
  const tenantOrAccountRef =
    parsed.tenantOrAccountRef === undefined
      ? undefined
      : objectRef(parsed.tenantOrAccountRef, context, `${label}.tenantOrAccountRef`);
  const payloadHash =
    parsed.payloadHash === undefined
      ? undefined
      : contentHash(parsed.payloadHash, `${label}.payloadHash`);
  const adapterVersion =
    parsed.adapterVersion === undefined
      ? undefined
      : nonEmptyString(parsed.adapterVersion, `${label}.adapterVersion`);
  return {
    system: nonEmptyString(parsed.system, `${label}.system`),
    ...(tenantOrAccountRef === undefined ? {} : { tenantOrAccountRef }),
    resourceType: nonEmptyString(parsed.resourceType, `${label}.resourceType`),
    externalId: nonEmptyString(parsed.externalId, `${label}.externalId`),
    observedAt: instant(parsed.observedAt, `${label}.observedAt`),
    ...(payloadHash === undefined ? {} : { payloadHash }),
    ...(adapterVersion === undefined ? {} : { adapterVersion }),
  };
}

export function validateChangeImpactDefinition(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedChangeImpact {
  const parsed = record(value, 'changeImpact', QUALITY_GATE_INPUT_MISMATCH);
  const baseRevisionRef = contentRef(
    parsed.baseRevisionRef,
    context,
    'changeImpact.baseRevisionRef',
    new Set([ARTIFACT_REVISION_OBJECT_TYPE]),
  );
  const targetRevisionRef = contentRef(
    parsed.targetRevisionRef,
    context,
    'changeImpact.targetRevisionRef',
    new Set([ARTIFACT_REVISION_OBJECT_TYPE]),
  );
  if (sameContentRef(baseRevisionRef, targetRevisionRef)) {
    throw new QualityBusinessError(
      QUALITY_GATE_INPUT_MISMATCH,
      'ChangeImpact base and target revisions must be distinct content facts',
    );
  }
  if (!sameScope(baseRevisionRef.scope, targetRevisionRef.scope)) {
    throw new QualityBusinessError(
      QUALITY_GATE_INPUT_MISMATCH,
      'ChangeImpact base and target revisions must use the same exact scope',
    );
  }
  const changedUnits = array(parsed.changedUnits, 'changeImpact.changedUnits');
  const unchangedUnits = array(parsed.unchangedUnits, 'changeImpact.unchangedUnits');
  const affectedClaimRefs = array(parsed.affectedClaimRefs, 'changeImpact.affectedClaimRefs').map(
    (item, index) => contentRef(item, context, `changeImpact.affectedClaimRefs[${index}]`),
  );
  const affectedEvidenceLinkRefs = array(
    parsed.affectedEvidenceLinkRefs,
    'changeImpact.affectedEvidenceLinkRefs',
  ).map((item, index) =>
    typedReference(item, context, `changeImpact.affectedEvidenceLinkRefs[${index}]`),
  );
  const affectedGateSpecIds = array(
    parsed.affectedGateSpecIds,
    'changeImpact.affectedGateSpecIds',
  ).map((item, index) => uuid(item, `changeImpact.affectedGateSpecIds[${index}]`));
  const toolchainChanges = array(parsed.toolchainChanges, 'changeImpact.toolchainChanges');
  const profileChanges = array(parsed.profileChanges, 'changeImpact.profileChanges');
  const analysisMethod = nonEmptyString(parsed.analysisMethod, 'changeImpact.analysisMethod');
  const analysisVersion =
    parsed.analysisVersion === undefined
      ? '1.0'
      : nonEmptyString(parsed.analysisVersion, 'changeImpact.analysisVersion');
  const analyzedBy = principal(parsed.analyzedBy, 'changeImpact.analyzedBy');
  const analyzedAt = instant(parsed.analyzedAt, 'changeImpact.analyzedAt');
  const coverage = record(parsed.coverage, 'changeImpact.coverage');
  const definition = {
    baseRevisionRef,
    targetRevisionRef,
    changedUnits,
    unchangedUnits,
    affectedClaimRefs,
    affectedEvidenceLinkRefs,
    affectedGateSpecIds,
    toolchainChanges,
    profileChanges,
    analysisMethod,
    analysisVersion,
    analyzedBy,
    analyzedAt,
    coverage: canonicalValue(coverage),
  } as unknown as CanonicalJsonObject;
  const scope = trustedScope(baseRevisionRef.scope, context, 'changeImpact.baseRevisionRef.scope');
  return {
    definition,
    scope,
    ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
    baseRevisionRef,
    targetRevisionRef,
    payloadHash: createHash('sha256').update(canonicalize(definition), 'utf8').digest(),
  };
}

export function validateRevisionReadinessInput(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedRevisionReadinessInput {
  const parsed = record(value, 'readiness', QUALITY_GATE_INPUT_MISMATCH);
  const revisionRef = contentRef(
    parsed.revisionRef,
    context,
    'readiness.revisionRef',
    new Set([ARTIFACT_REVISION_OBJECT_TYPE]),
  );
  const qualityProfileRef = versionedRef(
    parsed.qualityProfileRef,
    context,
    'readiness.qualityProfileRef',
    new Set([QUALITY_PROFILE_OBJECT_TYPE]),
  );
  const gateResultRefs = array(parsed.gateResultRefs, 'readiness.gateResultRefs').map(
    (item, index) =>
      contentRef(
        item,
        context,
        `readiness.gateResultRefs[${index}]`,
        new Set([GATE_RESULT_OBJECT_TYPE]),
      ),
  );
  const evidenceStatusSnapshotRef = snapshotRef(
    parsed.evidenceStatusSnapshotRef,
    context,
    'readiness.evidenceStatusSnapshotRef',
  );
  const issueSnapshotRef = snapshotRef(
    parsed.issueSnapshotRef,
    context,
    'readiness.issueSnapshotRef',
  );
  const evaluatorVersions = array(parsed.evaluatorVersions, 'readiness.evaluatorVersions');
  evaluatorVersions.forEach((item, index) => {
    const evaluator = record(
      item,
      `readiness.evaluatorVersions[${index}]`,
      QUALITY_GATE_RESULT_INVALID,
    );
    nonEmptyString(
      evaluator.evaluatorId,
      `readiness.evaluatorVersions[${index}].evaluatorId`,
      QUALITY_GATE_RESULT_INVALID,
    );
    nonEmptyString(
      evaluator.evaluatorVersion,
      `readiness.evaluatorVersions[${index}].evaluatorVersion`,
      QUALITY_GATE_RESULT_INVALID,
    );
  });
  const evaluatedAtText = instant(parsed.evaluatedAt, 'readiness.evaluatedAt');
  return {
    revisionRef,
    qualityProfileRef,
    gateResultRefs,
    evidenceStatusSnapshotRef,
    issueSnapshotRef,
    evaluatorVersions,
    evaluatedAt: new Date(evaluatedAtText),
    evaluatedAtText,
  };
}

export function validateReleaseReadinessInput(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedReleaseReadinessInput {
  const parsed = record(value, 'readiness', QUALITY_RELEASE_PACKAGE_TARGET_MISMATCH);
  const releasePackageRef = releasePackageRefFromValue(
    parsed.releasePackageRef,
    context,
    'readiness.releasePackageRef',
  );
  const approvalBundleSnapshotRef = snapshotRef(
    parsed.approvalBundleSnapshotRef,
    context,
    'readiness.approvalBundleSnapshotRef',
  );
  const recipientScopeSnapshotRef = snapshotRef(
    parsed.recipientScopeSnapshotRef,
    context,
    'readiness.recipientScopeSnapshotRef',
  );
  const destinationRefs = array(parsed.destinationRefs, 'readiness.destinationRefs').map(
    (item, index) => externalRef(item, context, `readiness.destinationRefs[${index}]`),
  );
  if (destinationRefs.length === 0) {
    throw new QualityBusinessError(
      QUALITY_RELEASE_PACKAGE_TARGET_MISMATCH,
      'readiness.destinationRefs must be non-empty',
    );
  }
  const releaseGateResultRefs = array(
    parsed.releaseGateResultRefs,
    'readiness.releaseGateResultRefs',
  ).map((item, index) =>
    contentRef(
      item,
      context,
      `readiness.releaseGateResultRefs[${index}]`,
      new Set([GATE_RESULT_OBJECT_TYPE]),
    ),
  );
  const evaluatedAtText = instant(parsed.evaluatedAt, 'readiness.evaluatedAt');
  return {
    releasePackageRef,
    approvalBundleSnapshotRef,
    recipientScopeSnapshotRef,
    destinationRefs,
    releaseGateResultRefs,
    evaluatedAt: new Date(evaluatedAtText),
    evaluatedAtText,
  };
}

function releasePackageRefFromValue(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
): Common.ReleasePackageRef {
  const parsed = record(value, label, QUALITY_RELEASE_PACKAGE_TARGET_MISMATCH);
  const releaseRef = objectRef(parsed.releaseRef, context, `${label}.releaseRef`);
  const packageSnapshotRef = snapshotRef(
    parsed.packageSnapshotRef,
    context,
    `${label}.packageSnapshotRef`,
  );
  const packageHash = contentHash(parsed.packageHash, `${label}.packageHash`);
  if (!sameScope(releaseRef.scope, packageSnapshotRef.scope)) {
    throw new QualityBusinessError(
      QUALITY_RELEASE_PACKAGE_TARGET_MISMATCH,
      `${label} release and package snapshot scopes must match`,
    );
  }
  return { releaseRef, packageSnapshotRef, packageHash };
}

export function contentRefHash(value: Common.ContentAddressedRef): Buffer {
  return contentHashBytes(value.contentHash);
}

export function snapshotRefHash(value: Common.SnapshotRef): Buffer {
  return contentHashBytes(value.contentHash);
}

export function commonScope(value: Common.TypedReference): Scope {
  if (!('scope' in value))
    throw new QualityBusinessError(QUALITY_GATE_INPUT_MISMATCH, 'reference has no scope');
  return {
    enterpriseId: value.scope.enterpriseId ?? '',
    ...(value.scope.projectId === undefined ? {} : { projectId: value.scope.projectId }),
  };
}

export function exactRefJson(value: Common.TypedReference): CanonicalJsonObject {
  return value as unknown as CanonicalJsonObject;
}
