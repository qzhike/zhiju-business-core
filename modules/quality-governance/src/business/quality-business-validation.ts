// IM-05 WI-02 (issue #122): fail-closed validation for the public Evidence
// and QualityProfile command/query contracts. This file deliberately validates
// references without loading another module's tables.

import type { CanonicalJson, Common, QualityGovernance } from '@zhiju/contracts';
import {
  canonicalize,
  isUuidV7,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import {
  digestCanonicalPayload,
  type QualityTransactionContext,
} from '../persistence/quality-db.js';
import {
  QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
  QUALITY_EVIDENCE_EXPECTED_VERSION_REQUIRED,
  QUALITY_EVIDENCE_SCOPE_INVALID,
  QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
  QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
  QUALITY_PROFILE_DEPENDENCY_CYCLE,
  QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
  QUALITY_PROFILE_SCOPE_INVALID,
  QualityBusinessError,
} from './quality-business-errors.js';

type RecordLike = Readonly<Record<string, unknown>>;

interface Scope {
  readonly enterpriseId: string;
  readonly projectId?: string;
}

const EVIDENCE_OBJECT_TYPE = 'quality.evidence';
const QUALITY_PROFILE_OBJECT_TYPE = 'quality.quality_profile';
const IMPACT_ASSESSMENT_OBJECT_TYPE = 'quality.impact_assessment';
const SNAPSHOT_OBJECT_TYPES = new Set([
  'quality.quality_profile_review',
  'quality.quality_profile_validation',
]);
const OBJECT_LOCATOR_PATTERN = /^[a-z0-9][a-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+$/;
const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const EVALUATION_STAGES = new Set(['REVISION_ACCEPTANCE', 'RELEASE_READINESS']);

export interface ValidatedEvidenceCandidate {
  readonly candidate: QualityGovernance.EvidenceCandidate;
  readonly scope: Scope;
  readonly projectId?: string;
  readonly payloadHash: Buffer;
}

export interface ValidatedEvidenceVerification {
  readonly verification: QualityGovernance.EvidenceVerification;
  readonly verificationHash: Buffer;
}

export interface ValidatedRevocation {
  readonly revocationReason: QualityGovernance.Justification;
  readonly impactAssessmentRef: Common.ContentAddressedRef;
  readonly revokedAt: Date;
}

export interface ValidatedEvidenceLink {
  readonly definition: QualityGovernance.EvidenceLinkDefinition;
  readonly scope: Scope;
  readonly projectId?: string;
  readonly claimHash: Buffer;
}

export interface ValidatedQualityProfileDefinition {
  readonly definition: QualityGovernance.QualityProfileDefinition;
  readonly highRisk: boolean;
}

function record(value: unknown): RecordLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordLike)
    : {};
}

function canonicalValue(
  value: unknown,
  code = QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
): CanonicalJsonValue {
  try {
    const parsed: unknown = JSON.parse(JSON.stringify(value));
    if (
      parsed === null ||
      typeof parsed === 'string' ||
      typeof parsed === 'number' ||
      typeof parsed === 'boolean' ||
      Array.isArray(parsed) ||
      typeof parsed === 'object'
    ) {
      return parsed as CanonicalJsonValue;
    }
  } catch {
    // Fall through to the stable business error.
  }
  throw new QualityBusinessError(code, 'value is not valid canonical JSON');
}

function canonicalObject(
  value: unknown,
  label: string,
  code = QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
): RecordLike {
  const parsed = canonicalValue(value, code);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new QualityBusinessError(code, `${label} must be a JSON object`);
  }
  return parsed as RecordLike;
}

function nonEmptyString(
  value: unknown,
  label: string,
  code = QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new QualityBusinessError(code, `${label} must be non-empty`);
  }
  return value;
}

function uuid(
  value: unknown,
  label: string,
  code = QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
): string {
  if (typeof value !== 'string' || !isUuidV7(value)) {
    throw new QualityBusinessError(code, `${label} must be a UUIDv7`);
  }
  return value;
}

function instant(
  value: unknown,
  label: string,
  code = QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
): string {
  if (
    typeof value !== 'string' ||
    !UTC_INSTANT_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new QualityBusinessError(code, `${label} must be a UTC instant`);
  }
  return value;
}

function hash(
  value: unknown,
  label: string,
  code = QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
): Common.ContentHash {
  const parsed = record(value);
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

function scope(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  code = QUALITY_EVIDENCE_SCOPE_INVALID,
): Scope {
  const parsed = record(value);
  const enterpriseId = parsed.enterpriseId;
  const projectId = parsed.projectId;
  if (
    enterpriseId !== context.enterpriseId ||
    (projectId !== undefined &&
      (typeof projectId !== 'string' ||
        !isUuidV7(projectId) ||
        !context.allowedProjectIds.includes(projectId)))
  ) {
    throw new QualityBusinessError(code, `${label} is outside the trusted scope`);
  }
  return {
    enterpriseId: context.enterpriseId,
    ...(projectId === undefined ? {} : { projectId }),
  };
}

function sameScope(left: Scope, right: Scope): boolean {
  return left.enterpriseId === right.enterpriseId && left.projectId === right.projectId;
}

function scopeJson(value: Scope): Common.ScopeRef {
  return {
    enterpriseId: value.enterpriseId,
    ...(value.projectId === undefined ? {} : { projectId: value.projectId }),
  };
}

function contentAddressedRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  objectTypes?: ReadonlySet<string>,
  code = QUALITY_EVIDENCE_SCOPE_INVALID,
): Common.ContentAddressedRef {
  const parsed = canonicalObject(value, label, code);
  const refScope = scope(parsed.scope, context, `${label}.scope`, code);
  const objectType = nonEmptyString(parsed.objectType, `${label}.objectType`, code);
  if (
    parsed.kind !== 'CONTENT_ADDRESSED' ||
    (objectTypes !== undefined && !objectTypes.has(objectType))
  ) {
    throw new QualityBusinessError(code, `${label} must be an exact ContentAddressedRef`);
  }
  const objectId = uuid(parsed.objectId, `${label}.objectId`, code);
  const immutableVersionId =
    parsed.immutableVersionId === undefined
      ? undefined
      : uuid(parsed.immutableVersionId, `${label}.immutableVersionId`, code);
  const contentHash = hash(parsed.contentHash, `${label}.contentHash`, code);
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType,
    objectId,
    ...(immutableVersionId === undefined ? {} : { immutableVersionId }),
    scope: scopeJson(refScope),
    contentHash,
  };
}

function versionedRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  objectTypes?: ReadonlySet<string>,
  code = QUALITY_EVIDENCE_SCOPE_INVALID,
): Common.VersionedRef {
  const parsed = canonicalObject(value, label, code);
  const refScope = scope(parsed.scope, context, `${label}.scope`, code);
  const objectType = nonEmptyString(parsed.objectType, `${label}.objectType`, code);
  if (parsed.kind !== 'VERSIONED' || (objectTypes !== undefined && !objectTypes.has(objectType))) {
    throw new QualityBusinessError(code, `${label} must be an exact VersionedRef`);
  }
  return {
    kind: 'VERSIONED',
    objectType,
    objectId: uuid(parsed.objectId, `${label}.objectId`, code),
    versionId: uuid(parsed.versionId, `${label}.versionId`, code),
    scope: scopeJson(refScope),
  };
}

function snapshotRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  objectTypes: ReadonlySet<string> = SNAPSHOT_OBJECT_TYPES,
): Common.SnapshotRef {
  const parsed = canonicalObject(value, label, QUALITY_PROFILE_REQUIREMENT_INCOMPLETE);
  const refScope = scope(
    parsed.scope,
    context,
    `${label}.scope`,
    QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
  );
  const objectType = nonEmptyString(
    parsed.objectType,
    `${label}.objectType`,
    QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
  );
  if (parsed.kind !== 'SNAPSHOT' || !objectTypes.has(objectType)) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      `${label} must identify a QualityProfile review or validation snapshot`,
    );
  }
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId: uuid(parsed.objectId, `${label}.objectId`, QUALITY_PROFILE_REQUIREMENT_INCOMPLETE),
    snapshotId: uuid(
      parsed.snapshotId,
      `${label}.snapshotId`,
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
    ),
    scope: scopeJson(refScope),
    contentHash: hash(
      parsed.contentHash,
      `${label}.contentHash`,
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
    ),
  };
}

function typedReference(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
): Common.TypedReference {
  const parsed = canonicalObject(value, label, QUALITY_EVIDENCE_SOURCE_INCOMPLETE);
  if (parsed.kind === 'EXTERNAL') {
    nonEmptyString(parsed.system, `${label}.system`, QUALITY_EVIDENCE_SOURCE_INCOMPLETE);
    nonEmptyString(
      parsed.resourceType,
      `${label}.resourceType`,
      QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
    );
    nonEmptyString(parsed.externalId, `${label}.externalId`, QUALITY_EVIDENCE_SOURCE_INCOMPLETE);
    instant(parsed.observedAt, `${label}.observedAt`, QUALITY_EVIDENCE_SOURCE_INCOMPLETE);
    return canonicalValue(
      parsed,
      QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
    ) as unknown as Common.ExternalRef;
  }
  if (parsed.kind === 'OBJECT') {
    const refScope = scope(
      parsed.scope,
      context,
      `${label}.scope`,
      QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
    );
    return {
      kind: 'OBJECT',
      objectType: nonEmptyString(
        parsed.objectType,
        `${label}.objectType`,
        QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
      ),
      objectId: uuid(parsed.objectId, `${label}.objectId`, QUALITY_EVIDENCE_SOURCE_INCOMPLETE),
      scope: scopeJson(refScope),
    };
  }
  if (parsed.kind === 'VERSIONED') {
    return versionedRef(parsed, context, label, undefined, QUALITY_EVIDENCE_SOURCE_INCOMPLETE);
  }
  if (parsed.kind === 'CONTENT_ADDRESSED') {
    return contentAddressedRef(
      parsed,
      context,
      label,
      undefined,
      QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
    );
  }
  if (parsed.kind === 'SNAPSHOT') {
    const refScope = scope(
      parsed.scope,
      context,
      `${label}.scope`,
      QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
    );
    return {
      kind: 'SNAPSHOT',
      objectType: nonEmptyString(
        parsed.objectType,
        `${label}.objectType`,
        QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
      ),
      objectId: uuid(parsed.objectId, `${label}.objectId`, QUALITY_EVIDENCE_SOURCE_INCOMPLETE),
      snapshotId: uuid(
        parsed.snapshotId,
        `${label}.snapshotId`,
        QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
      ),
      scope: scopeJson(refScope),
      contentHash: hash(
        parsed.contentHash,
        `${label}.contentHash`,
        QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
      ),
    };
  }
  throw new QualityBusinessError(
    QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
    `${label} is not a supported TypedReference`,
  );
}

function refScope(
  value: Common.TypedReference,
  context: QualityTransactionContext,
  label: string,
): Scope | undefined {
  if (!('kind' in value)) return undefined;
  return scope(value.scope, context, `${label}.scope`, QUALITY_EVIDENCE_SOURCE_INCOMPLETE);
}

function refHash(value: Common.ContentAddressedRef | Common.SnapshotRef): Buffer {
  return hashBytes(value.contentHash);
}

export function validateEvidenceCandidate(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedEvidenceCandidate {
  const candidate = canonicalObject(value, 'candidate', QUALITY_EVIDENCE_SOURCE_INCOMPLETE);
  const sourceSnapshot = snapshotLike(
    candidate.sourceSnapshotRef,
    context,
    'candidate.sourceSnapshotRef',
  );
  const sourceObjectRef = typedReference(
    candidate.sourceObjectRef,
    context,
    'candidate.sourceObjectRef',
  );
  const sourceObjectScope = refScope(sourceObjectRef, context, 'candidate.sourceObjectRef');
  const sourceScope = scope(
    sourceSnapshot.scope,
    context,
    'candidate.sourceSnapshotRef.scope',
    QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
  );
  if (sourceObjectScope !== undefined && !sameScope(sourceObjectScope, sourceScope)) {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_SCOPE_INVALID,
      'sourceObjectRef and sourceSnapshotRef must use the same exact scope',
    );
  }
  const sourceVersion = nonEmptyString(
    candidate.sourceVersion,
    'candidate.sourceVersion',
    QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
  );
  const locator = nonEmptyString(
    candidate.locator,
    'candidate.locator',
    QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
  );
  const capturedContentRef = nonEmptyString(
    candidate.capturedContentRef,
    'candidate.capturedContentRef',
    QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
  );
  if (!OBJECT_LOCATOR_PATTERN.test(capturedContentRef)) {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
      'candidate.capturedContentRef must be an opaque object locator',
    );
  }
  const capturedContentHash = hash(
    candidate.capturedContentHash,
    'candidate.capturedContentHash',
    QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
  );
  const sourceType = nonEmptyString(
    candidate.sourceType,
    'candidate.sourceType',
    QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
  );
  const authority = nonEmptyString(
    candidate.authority,
    'candidate.authority',
    QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
  );
  const jurisdiction =
    candidate.jurisdiction === undefined
      ? undefined
      : nonEmptyString(
          candidate.jurisdiction,
          'candidate.jurisdiction',
          QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
        );
  const accessClassification = nonEmptyString(
    candidate.accessClassification,
    'candidate.accessClassification',
    QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
  );
  const capturedAt = instant(
    candidate.capturedAt,
    'candidate.capturedAt',
    QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
  );
  let validPeriod: QualityGovernance.EffectivePeriod | undefined;
  if (candidate.validPeriod !== undefined) {
    const period = canonicalObject(
      candidate.validPeriod,
      'candidate.validPeriod',
      QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
    );
    const validFrom =
      period.validFrom === undefined
        ? undefined
        : instant(
            period.validFrom,
            'candidate.validPeriod.validFrom',
            QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
          );
    const validTo =
      period.validTo === undefined
        ? undefined
        : instant(
            period.validTo,
            'candidate.validPeriod.validTo',
            QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
          );
    if (
      validFrom !== undefined &&
      validTo !== undefined &&
      Date.parse(validFrom) >= Date.parse(validTo)
    ) {
      throw new QualityBusinessError(
        QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
        'candidate.validPeriod must have validFrom before validTo',
      );
    }
    validPeriod = {
      ...(validFrom === undefined ? {} : { validFrom }),
      ...(validTo === undefined ? {} : { validTo }),
    };
  }
  const normalizedCandidate = {
    sourceType,
    sourceObjectRef,
    sourceSnapshotRef: sourceSnapshot,
    sourceVersion,
    locator,
    capturedContentRef,
    capturedContentHash,
    authority,
    ...(jurisdiction === undefined ? {} : { jurisdiction }),
    ...(validPeriod === undefined ? {} : { validPeriod }),
    accessClassification,
    capturedAt,
  } satisfies QualityGovernance.EvidenceCandidate;
  const payloadHash = digestCanonicalPayload(
    normalizedCandidate as unknown as CanonicalJsonObject,
  ).hash;
  return {
    candidate: normalizedCandidate,
    scope: sourceScope,
    ...(sourceScope.projectId === undefined ? {} : { projectId: sourceScope.projectId }),
    payloadHash,
  };
}

function snapshotLike(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
): Common.SnapshotRef {
  const parsed = canonicalObject(value, label, QUALITY_EVIDENCE_SOURCE_INCOMPLETE);
  const refScope = scope(
    parsed.scope,
    context,
    `${label}.scope`,
    QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
  );
  if (parsed.kind !== 'SNAPSHOT') {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
      `${label} must be a SnapshotRef`,
    );
  }
  return {
    kind: 'SNAPSHOT',
    objectType: nonEmptyString(
      parsed.objectType,
      `${label}.objectType`,
      QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
    ),
    objectId: uuid(parsed.objectId, `${label}.objectId`, QUALITY_EVIDENCE_SOURCE_INCOMPLETE),
    snapshotId: uuid(parsed.snapshotId, `${label}.snapshotId`, QUALITY_EVIDENCE_SOURCE_INCOMPLETE),
    scope: scopeJson(refScope),
    contentHash: hash(
      parsed.contentHash,
      `${label}.contentHash`,
      QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
    ),
  };
}

export function validateEvidenceVerification(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedEvidenceVerification {
  const verification = canonicalObject(
    value,
    'verification',
    QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
  );
  const verifier = canonicalObject(
    verification.verifier,
    'verification.verifier',
    QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
  );
  const verifierKind = nonEmptyString(
    verifier.principalKind,
    'verification.verifier.principalKind',
    QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
  );
  const verifierId = uuid(
    verifier.principalId,
    'verification.verifier.principalId',
    QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
  );
  const method = nonEmptyString(
    verification.method,
    'verification.method',
    QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
  );
  const deterministicService = verifierKind === 'SERVICE' && method.startsWith('deterministic.');
  const verifierAllowed =
    verifierKind === 'HUMAN' || (verifierKind === 'SERVICE' && deterministicService);
  if (
    verifierId !== context.principalId ||
    verifierKind !== context.principalKind ||
    !verifierAllowed
  ) {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
      'verifier does not match the trusted principal and verification policy',
    );
  }
  const verificationPolicyRef = versionedRef(
    verification.verificationPolicyRef,
    context,
    'verification.verificationPolicyRef',
    undefined,
    QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
  );
  if (verification.outcome !== 'VERIFIED' && verification.outcome !== 'DISPUTED') {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
      'verification outcome is closed',
    );
  }
  if (!Array.isArray(verification.evidenceRefs)) {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
      'verification.evidenceRefs must be an array',
    );
  }
  const evidenceRefs = verification.evidenceRefs.map((value, index) =>
    evidenceRef(value, context, `verification.evidenceRefs[${index}]`),
  );
  if (!Array.isArray(verification.reasons) || verification.reasons.length === 0) {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
      'verification.reasons must be non-empty',
    );
  }
  const reasons = verification.reasons.map((value, index) =>
    nonEmptyString(value, `verification.reasons[${index}]`, QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED),
  );
  const verifiedAt = instant(
    verification.verifiedAt,
    'verification.verifiedAt',
    QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
  );
  const normalized = {
    method,
    verifier: { principalKind: verifierKind, principalId: verifierId },
    verificationPolicyRef,
    outcome: verification.outcome,
    evidenceRefs,
    reasons,
    verifiedAt,
  } satisfies QualityGovernance.EvidenceVerification;
  return {
    verification: normalized,
    verificationHash: digestCanonicalPayload(normalized as unknown as CanonicalJsonObject).hash,
  };
}

function evidenceRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
): Common.EvidenceRef {
  const parsed = canonicalObject(value, label, QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED);
  const evidence = contentAddressedRef(
    parsed.evidence,
    context,
    `${label}.evidence`,
    new Set([EVIDENCE_OBJECT_TYPE]),
    QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
  );
  const relation = parsed.relation;
  if (relation !== 'SUPPORTS' && relation !== 'CONTRADICTS' && relation !== 'CONTEXT_ONLY') {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
      `${label}.relation is not closed`,
    );
  }
  let targetClaimRef: Common.EvidenceRef['targetClaimRef'];
  if (parsed.targetClaimRef !== undefined) {
    const target = canonicalObject(
      parsed.targetClaimRef,
      `${label}.targetClaimRef`,
      QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
    );
    const targetRef = contentAddressedRef(
      target.target,
      context,
      `${label}.targetClaimRef.target`,
      undefined,
      QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
    );
    const claimLocator = nonEmptyString(
      target.claimLocator,
      `${label}.targetClaimRef.claimLocator`,
      QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
    );
    const claimHash = hash(
      target.claimHash,
      `${label}.targetClaimRef.claimHash`,
      QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
    );
    targetClaimRef = { target: targetRef, claimLocator, claimHash };
  }
  return {
    evidence,
    relation,
    ...(targetClaimRef === undefined ? {} : { targetClaimRef }),
  };
}

export function validateRevocation(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedRevocation {
  if (context.principalKind !== 'HUMAN' && context.principalKind !== 'SERVICE') {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
      'evidence revocation requires Human or Service authority',
    );
  }
  const parsed = canonicalObject(value, 'revocation', QUALITY_EVIDENCE_SCOPE_INVALID);
  const reason = canonicalObject(
    parsed.revocationReason,
    'revocation.revocationReason',
    QUALITY_EVIDENCE_SCOPE_INVALID,
  );
  const revocationReason = {
    reasonCode: nonEmptyString(
      reason.reasonCode,
      'revocation.revocationReason.reasonCode',
      QUALITY_EVIDENCE_SCOPE_INVALID,
    ),
    summary: nonEmptyString(
      reason.summary,
      'revocation.revocationReason.summary',
      QUALITY_EVIDENCE_SCOPE_INVALID,
    ),
    evidenceRefs: Array.isArray(reason.evidenceRefs)
      ? reason.evidenceRefs.map((item, index) =>
          evidenceRef(item, context, `revocation.revocationReason.evidenceRefs[${index}]`),
        )
      : (() => {
          throw new QualityBusinessError(
            QUALITY_EVIDENCE_SCOPE_INVALID,
            'revocation.revocationReason.evidenceRefs must be an array',
          );
        })(),
    ...(reason.policyRef === undefined
      ? {}
      : {
          policyRef: versionedRef(
            reason.policyRef,
            context,
            'revocation.revocationReason.policyRef',
          ),
        }),
  } satisfies QualityGovernance.Justification;
  const impactAssessmentRef = contentAddressedRef(
    parsed.impactAssessmentRef,
    context,
    'revocation.impactAssessmentRef',
    new Set([IMPACT_ASSESSMENT_OBJECT_TYPE]),
    QUALITY_EVIDENCE_SCOPE_INVALID,
  );
  const revokedAt = instant(
    parsed.revokedAt,
    'revocation.revokedAt',
    QUALITY_EVIDENCE_SCOPE_INVALID,
  );
  return { revocationReason, impactAssessmentRef, revokedAt: new Date(revokedAt) };
}

export function validateEvidenceLink(
  value: unknown,
  context: QualityTransactionContext,
): ValidatedEvidenceLink {
  const parsed = canonicalObject(value, 'definition', QUALITY_EVIDENCE_LINK_TARGET_MISMATCH);
  const evidenceRef = contentAddressedRef(
    parsed.evidenceRef,
    context,
    'definition.evidenceRef',
    new Set([EVIDENCE_OBJECT_TYPE]),
    QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
  );
  const targetRef = contentAddressedRef(
    parsed.targetRef,
    context,
    'definition.targetRef',
    undefined,
    QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
  );
  const evidenceScope = scope(
    evidenceRef.scope,
    context,
    'definition.evidenceRef.scope',
    QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
  );
  const targetScope = scope(
    targetRef.scope,
    context,
    'definition.targetRef.scope',
    QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
  );
  if (
    evidenceScope.projectId !== undefined &&
    targetScope.projectId !== undefined &&
    evidenceScope.projectId !== targetScope.projectId
  ) {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
      'EvidenceLink target and evidence Project scopes differ',
    );
  }
  const effectiveScope = targetScope.projectId === undefined ? evidenceScope : targetScope;
  const claimLocator = nonEmptyString(
    parsed.claimLocator,
    'definition.claimLocator',
    QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
  );
  const claimHash = hash(
    parsed.claimHash,
    'definition.claimHash',
    QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
  );
  if (!['SUPPORTS', 'CONTRADICTS', 'CONTEXT_ONLY'].includes(String(parsed.relation))) {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
      'definition.relation is not closed',
    );
  }
  const relationValue = parsed.relation as 'SUPPORTS' | 'CONTRADICTS' | 'CONTEXT_ONLY';
  if (parsed.applicabilityScope === undefined) {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
      'definition.applicabilityScope is required',
    );
  }
  const applicabilityScope = canonicalValue(
    parsed.applicabilityScope,
    QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
  );
  const linkedAt = instant(
    parsed.linkedAt,
    'definition.linkedAt',
    QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
  );
  const definition = {
    evidenceRef,
    targetRef,
    claimLocator,
    claimHash,
    relation: relationValue,
    applicabilityScope,
    linkedAt,
  } satisfies QualityGovernance.EvidenceLinkDefinition;
  return {
    definition,
    scope: effectiveScope,
    ...(effectiveScope.projectId === undefined ? {} : { projectId: effectiveScope.projectId }),
    claimHash: hashBytes(claimHash),
  };
}

function requiredGateField(gate: RecordLike, field: string, label: string): CanonicalJsonValue {
  const value = gate[field];
  if (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim().length === 0)
  ) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      `${label}.${field} is required`,
    );
  }
  return canonicalValue(value, QUALITY_PROFILE_REQUIREMENT_INCOMPLETE);
}

function gateId(value: unknown, label: string): string {
  return uuid(value, label, QUALITY_PROFILE_REQUIREMENT_INCOMPLETE);
}

function riskIsHigh(value: CanonicalJsonValue): boolean {
  if (typeof value === 'string') return ['HIGH', 'CRITICAL'].includes(value.toUpperCase());
  if (Array.isArray(value)) {
    return (value as readonly CanonicalJsonValue[]).some((item) => riskIsHigh(item));
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, CanonicalJsonValue>).some((item) =>
      riskIsHigh(item),
    );
  }
  return false;
}

function dependenciesForGate(gate: RecordLike, label: string): string[] {
  const value = gate.dependencyGateSpecIds;
  if (!Array.isArray(value)) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      `${label}.dependencyGateSpecIds must be an array`,
    );
  }
  return value.map((item, index) => gateId(item, `${label}.dependencyGateSpecIds[${index}]`));
}

function addEdge(edges: Map<string, Set<string>>, prerequisite: string, dependent: string): void {
  const dependents = edges.get(prerequisite) ?? new Set<string>();
  dependents.add(dependent);
  edges.set(prerequisite, dependents);
}

function assertAcyclic(edges: Map<string, Set<string>>): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): void => {
    if (visiting.has(node)) {
      throw new QualityBusinessError(
        QUALITY_PROFILE_DEPENDENCY_CYCLE,
        'QualityProfile gate dependency graph contains a cycle',
      );
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dependent of edges.get(node) ?? []) visit(dependent);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of edges.keys()) visit(node);
}

function validateSeparation(value: CanonicalJsonValue): void {
  const policy = record(value);
  const explicitFalse = [
    policy.allowSelfReview,
    policy.selfReviewAllowed,
    policy.authorMayReviewOwnWork,
  ].some((item) => item === false);
  const textualProhibition = Object.values(policy).some(
    (item) => typeof item === 'string' && /must_not|prohibit|forbid|disallow/i.test(item),
  );
  if (!explicitFalse && !textualProhibition) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      'separationOfDutiesPolicy must explicitly prohibit self-review',
    );
  }
}

function validateApprovalRequirements(value: unknown, highRisk: boolean): CanonicalJson[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      'approvalRequirements must be non-empty',
    );
  }
  const normalized = value.map((item, index) => {
    const requirement = canonicalObject(
      item,
      `approvalRequirements[${index}]`,
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
    );
    const requiredRole = nonEmptyString(
      requirement.requiredRole,
      `approvalRequirements[${index}].requiredRole`,
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
    );
    const requiredCount = requirement.requiredCount;
    if (
      typeof requiredCount !== 'number' ||
      !Number.isSafeInteger(requiredCount) ||
      requiredCount < 1
    ) {
      throw new QualityBusinessError(
        QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
        `approvalRequirements[${index}].requiredCount must be a positive integer`,
      );
    }
    const rawApproverKind =
      requirement.approverKind ?? requirement.requiredPrincipalKind ?? 'HUMAN';
    if (typeof rawApproverKind !== 'string') {
      throw new QualityBusinessError(
        QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
        `approvalRequirements[${index}].approverKind must be a string`,
      );
    }
    const approverKind = rawApproverKind.toUpperCase();
    if (approverKind !== 'HUMAN' && approverKind !== 'AGENT') {
      throw new QualityBusinessError(
        QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
        `approvalRequirements[${index}].approverKind is not closed`,
      );
    }
    if (approverKind === 'AGENT') {
      throw new QualityBusinessError(
        QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
        'Agent cannot be configured as a Human approver',
      );
    }
    return canonicalValue(
      { ...requirement, requiredRole, requiredCount, approverKind },
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
    );
  });
  const hasHuman = normalized.some((item) => record(item).approverKind === 'HUMAN');
  if (highRisk && !hasHuman) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      'high-risk QualityProfile requires a Human approval requirement',
    );
  }
  return normalized;
}

function validateReleaseRequirement(value: unknown, index: number): CanonicalJsonValue {
  const requirement = canonicalObject(
    value,
    `releaseRequirements[${index}]`,
    QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
  );
  nonEmptyString(
    requirement.purpose,
    `releaseRequirements[${index}].purpose`,
    QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
  );
  const format = requirement.format ?? requirement.formats ?? requirement.representationFormats;
  if (
    format === undefined ||
    (Array.isArray(format) && format.length === 0) ||
    (typeof format === 'string' && format.trim().length === 0)
  ) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      `releaseRequirements[${index}] must define a representation format`,
    );
  }
  const recipient =
    requirement.recipientScope ?? requirement.recipientScopeRef ?? requirement.destinationScope;
  if (recipient === undefined) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      `releaseRequirements[${index}] must define recipient scope`,
    );
  }
  const validity = requirement.validity ?? requirement.validPeriod ?? requirement.validTime;
  if (validity === undefined) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      `releaseRequirements[${index}] must define validity`,
    );
  }
  const receipt = requirement.receiptRequired ?? requirement.receiptRequirement;
  if (receipt === undefined) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      `releaseRequirements[${index}] must define receipt requirement`,
    );
  }
  return canonicalValue(requirement, QUALITY_PROFILE_REQUIREMENT_INCOMPLETE);
}

export function validateQualityProfileDefinition(
  value: unknown,
): ValidatedQualityProfileDefinition {
  const definition = canonicalObject(value, 'definition', QUALITY_PROFILE_REQUIREMENT_INCOMPLETE);
  const name = nonEmptyString(definition.name, 'definition.name');
  const profileVersion = nonEmptyString(definition.profileVersion, 'definition.profileVersion');
  if (
    !Array.isArray(definition.applicableArtifactTypes) ||
    definition.applicableArtifactTypes.length === 0
  ) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      'definition.applicableArtifactTypes must be non-empty',
    );
  }
  const applicableArtifactTypes = definition.applicableArtifactTypes.map((item, index) =>
    nonEmptyString(item, `definition.applicableArtifactTypes[${index}]`),
  );
  if (new Set(applicableArtifactTypes).size !== applicableArtifactTypes.length) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      'definition.applicableArtifactTypes must be unique',
    );
  }
  const riskApplicability = canonicalValue(
    definition.riskApplicability,
    QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
  );
  const highRisk = riskIsHigh(riskApplicability);
  if (!Array.isArray(definition.gateSpecs) || definition.gateSpecs.length === 0) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      'definition.gateSpecs must be non-empty',
    );
  }
  const gateIds = new Set<string>();
  const edges = new Map<string, Set<string>>();
  const gateSpecs = definition.gateSpecs.map((value, index) => {
    const label = `definition.gateSpecs[${index}]`;
    const gate = canonicalObject(value, label, QUALITY_PROFILE_REQUIREMENT_INCOMPLETE);
    const id = gateId(gate.gateSpecId, `${label}.gateSpecId`);
    if (gateIds.has(id)) {
      throw new QualityBusinessError(
        QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
        'gateSpecId must be unique within a profile version',
      );
    }
    gateIds.add(id);
    const gateType = nonEmptyString(gate.gateType, `${label}.gateType`);
    const gateVersion = nonEmptyString(gate.gateVersion, `${label}.gateVersion`);
    const evaluationStage = nonEmptyString(gate.evaluationStage, `${label}.evaluationStage`);
    if (!EVALUATION_STAGES.has(evaluationStage)) {
      throw new QualityBusinessError(
        QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
        `${label}.evaluationStage is not closed`,
      );
    }
    const mandatory = gate.mandatory;
    if (typeof mandatory !== 'boolean') {
      throw new QualityBusinessError(
        QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
        `${label}.mandatory must be explicit`,
      );
    }
    const dependencyGateSpecIds = dependenciesForGate(gate, label);
    for (const prerequisite of dependencyGateSpecIds) addEdge(edges, prerequisite, id);
    const normalized = {
      ...gate,
      gateSpecId: id,
      gateType,
      gateVersion,
      evaluationStage,
      mandatory,
      dependencyGateSpecIds,
      applicabilityRule: requiredGateField(gate, 'applicabilityRule', label),
      inputContract: requiredGateField(gate, 'inputContract', label),
      evaluatorPolicy: requiredGateField(gate, 'evaluatorPolicy', label),
      passCriteria: requiredGateField(gate, 'passCriteria', label),
      failureSeverity: requiredGateField(gate, 'failureSeverity', label),
      blockingRule: requiredGateField(gate, 'blockingRule', label),
      rerunRule: requiredGateField(gate, 'rerunRule', label),
      resultRetentionRule: requiredGateField(gate, 'resultRetentionRule', label),
    };
    return canonicalValue(normalized, QUALITY_PROFILE_REQUIREMENT_INCOMPLETE);
  });
  const mandatoryCount = gateSpecs.filter((item) => record(item).mandatory === true).length;
  if (mandatoryCount === 0) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      'QualityProfile must define at least one mandatory gate',
    );
  }
  if (!Array.isArray(definition.gateDependencies)) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      'definition.gateDependencies must be an array',
    );
  }
  const gateDependencies = definition.gateDependencies.map((value, index) => {
    const dependency = canonicalObject(
      value,
      `definition.gateDependencies[${index}]`,
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
    );
    const prerequisite =
      dependency.fromGateSpecId ??
      dependency.prerequisiteGateSpecId ??
      dependency.dependsOnGateSpecId;
    const dependent =
      dependency.toGateSpecId ?? dependency.dependentGateSpecId ?? dependency.gateSpecId;
    const from = gateId(prerequisite, `definition.gateDependencies[${index}].fromGateSpecId`);
    const to = gateId(dependent, `definition.gateDependencies[${index}].toGateSpecId`);
    if (!gateIds.has(from) || !gateIds.has(to) || from === to) {
      throw new QualityBusinessError(
        QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
        'gateDependencies must stay inside the same profile version',
      );
    }
    addEdge(edges, from, to);
    return canonicalValue(
      { ...dependency, fromGateSpecId: from, toGateSpecId: to },
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
    );
  });
  for (const [prerequisite, dependents] of edges) {
    if (
      !gateIds.has(prerequisite) ||
      [...dependents].some((dependent) => !gateIds.has(dependent))
    ) {
      throw new QualityBusinessError(
        QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
        'gate dependency references an unknown GateSpec',
      );
    }
  }
  assertAcyclic(edges);
  const rerunPolicy = canonicalValue(
    definition.rerunPolicy,
    QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
  );
  const issuePolicy = canonicalValue(
    definition.issuePolicy,
    QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
  );
  const separationOfDutiesPolicy = canonicalValue(
    definition.separationOfDutiesPolicy,
    QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
  );
  validateSeparation(separationOfDutiesPolicy);
  const approvalRequirements = validateApprovalRequirements(
    definition.approvalRequirements,
    highRisk,
  );
  const releaseRequirements = !Array.isArray(definition.releaseRequirements)
    ? (() => {
        throw new QualityBusinessError(
          QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
          'definition.releaseRequirements must be an array',
        );
      })()
    : definition.releaseRequirements.map((item, index) => validateReleaseRequirement(item, index));
  if (releaseRequirements.length === 0) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      'definition.releaseRequirements must be non-empty',
    );
  }
  const normalized = {
    name,
    profileVersion,
    applicableArtifactTypes,
    riskApplicability,
    gateSpecs,
    gateDependencies,
    rerunPolicy,
    issuePolicy,
    separationOfDutiesPolicy,
    approvalRequirements,
    releaseRequirements,
  } satisfies QualityGovernance.QualityProfileDefinition;
  return { definition: normalized, highRisk };
}

export function validateProfileActivation(
  value: unknown,
  context: QualityTransactionContext,
): {
  readonly profileVersionRef: Common.VersionedRef;
  readonly reviewSnapshotRef: Common.SnapshotRef;
  readonly validationSnapshotRef: Common.SnapshotRef;
  readonly activatedAt: Date;
} {
  if (context.principalKind !== 'HUMAN') {
    throw new QualityBusinessError(
      QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
      'QualityProfile activation requires a trusted Human',
    );
  }
  const parsed = canonicalObject(value, 'activation', QUALITY_PROFILE_REQUIREMENT_INCOMPLETE);
  const profileVersionRef = versionedRef(
    parsed.profileVersionRef,
    context,
    'activation.profileVersionRef',
    new Set([QUALITY_PROFILE_OBJECT_TYPE]),
    QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
  );
  if (profileVersionRef.scope.projectId !== undefined) {
    throw new QualityBusinessError(
      QUALITY_PROFILE_SCOPE_INVALID,
      'activation.profileVersionRef must be Enterprise-scoped',
    );
  }
  const reviewSnapshotRef = snapshotRef(
    parsed.reviewSnapshotRef,
    context,
    'activation.reviewSnapshotRef',
    new Set(['quality.quality_profile_review']),
  );
  const validationSnapshotRef = snapshotRef(
    parsed.validationSnapshotRef,
    context,
    'activation.validationSnapshotRef',
    new Set(['quality.quality_profile_validation']),
  );
  const activatedAtValue = instant(
    parsed.activatedAt,
    'activation.activatedAt',
    QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
  );
  return {
    profileVersionRef,
    reviewSnapshotRef,
    validationSnapshotRef,
    activatedAt: new Date(activatedAtValue),
  };
}

export function assertExpectedVersion(value: string | undefined, label: string): string {
  if (value === undefined || !/^\d+$/.test(value) || BigInt(value) < 1n) {
    throw new QualityBusinessError(
      QUALITY_EVIDENCE_EXPECTED_VERSION_REQUIRED,
      `${label} must be a positive aggregate version`,
    );
  }
  return value;
}

export function nextVersion(value: string): string {
  return (BigInt(value) + 1n).toString();
}

export function contentHashForRef(value: Common.ContentAddressedRef | Common.SnapshotRef): Buffer {
  return refHash(value);
}

export function exactContentAddressedRef(
  value: unknown,
  context: QualityTransactionContext,
  label: string,
  objectTypes?: ReadonlySet<string>,
): Common.ContentAddressedRef {
  return contentAddressedRef(value, context, label, objectTypes, QUALITY_EVIDENCE_QUERY_NOT_FOUND);
}

export function exactQualityProfileRef(
  value: unknown,
  context: QualityTransactionContext,
): Common.VersionedRef {
  return versionedRef(
    value,
    context,
    'qualityProfileRef',
    new Set([QUALITY_PROFILE_OBJECT_TYPE]),
    QUALITY_PROFILE_QUERY_NOT_FOUND,
  );
}

// Keep query error codes local to this validation module so query callers do
// not have to duplicate the exact-reference checks.
const QUALITY_EVIDENCE_QUERY_NOT_FOUND = 'QUALITY_EVIDENCE_QUERY_NOT_FOUND';
const QUALITY_PROFILE_QUERY_NOT_FOUND = 'QUALITY_PROFILE_QUERY_NOT_FOUND';

export function canonicalKey(value: unknown): string {
  return canonicalize(canonicalValue(value));
}

export function scopeForCandidate(validated: ValidatedEvidenceCandidate): Common.ScopeRef {
  return scopeJson(validated.scope);
}
