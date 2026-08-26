// IM-03 WI-08 (issue #64): controlled Platform Reference import/publish and
// Project TemplateBaseline/RegulatoryProfile freeze/activation handlers.
// Platform rows are deliberately kept outside the business Enterprise scope;
// Project handlers accept only exact published content-addressed references.

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
  PLATFORM_CONTROL_SCOPE_ID,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransaction,
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
import { TemplateRegulatoryRepository } from '../persistence/template-regulatory-repository.js';
import {
  EnterpriseBusinessError,
  PROJECT_HUMAN_ONLY_DENIED,
  PROJECT_PLATFORM_REFERENCE_HASH_MISMATCH,
  PROJECT_PLATFORM_REFERENCE_INVALID,
  PROJECT_PLATFORM_REFERENCE_ROLE_REQUIRED,
  PROJECT_PLATFORM_REFERENCE_UNPUBLISHED,
  PROJECT_PLATFORM_REGULATORY_SOURCE_REQUIRED,
  PROJECT_REGULATORY_APPLICABILITY_CONFLICT,
  PROJECT_REGULATORY_EVIDENCE_REQUIRED,
  PROJECT_REGULATORY_PROFILE_SCOPE_MISMATCH,
  PROJECT_REGULATORY_PROFILE_VERSION_NOT_FOUND,
  PROJECT_TEMPLATE_BASELINE_IMMUTABLE,
  PROJECT_TEMPLATE_LATEST_FORBIDDEN,
  PROJECT_TEMPLATE_VERSION_NOT_FOUND,
} from './enterprise-business-errors.js';

const repo = new TemplateRegulatoryRepository();
const TEMPLATE_TARGET_TYPE = 'ReferenceTemplate';
const REGULATORY_TARGET_TYPE = 'RegulatoryReference';
const TEMPLATE_REF_TYPE = 'TemplateVersion';
const REGULATORY_REF_TYPE = 'RegulatoryReferenceVersion';

interface ContentHashLike {
  readonly algorithm?: unknown;
  readonly digest?: unknown;
  readonly canonicalizationVersion?: unknown;
}

interface ReferenceLike {
  readonly kind?: unknown;
  readonly objectType?: unknown;
  readonly objectId?: unknown;
  readonly versionId?: unknown;
  readonly immutableVersionId?: unknown;
  readonly snapshotId?: unknown;
  readonly scope?: unknown;
  readonly contentHash?: unknown;
  readonly evidence?: unknown;
  readonly evidenceLinkRef?: unknown;
  readonly applicabilityScopeRef?: unknown;
  readonly relation?: unknown;
  readonly reasonCode?: unknown;
  readonly summary?: unknown;
  readonly evidenceRefs?: unknown;
  readonly policyRef?: unknown;
}

interface ScopeLike {
  readonly enterpriseId?: unknown;
  readonly projectId?: unknown;
}

export interface PlatformTemplateImportVersionPayload {
  readonly referenceTemplateId: string;
  readonly referenceCode: string;
  readonly templateType: string;
  readonly versionId: string;
  readonly versionLabel: string;
  readonly contentRef: unknown;
  readonly contentHash: unknown;
  readonly sourceRef: unknown;
  readonly applicability: unknown;
}

export interface PlatformTemplatePublishVersionPayload {
  readonly referenceTemplateId: string;
  readonly versionId: string;
  readonly releaseDecisionRef: unknown;
  readonly publishReason: unknown;
}

export interface PlatformRegulatoryImportVersionPayload {
  readonly regulatoryReferenceId: string;
  readonly authorityCode: string;
  readonly jurisdiction: string;
  readonly referenceCode: string;
  readonly versionId: string;
  readonly versionLabel: string;
  readonly citation: string;
  readonly effectivePeriod: unknown;
  readonly sourceRef: unknown;
  readonly contentRef: unknown;
  readonly contentHash: unknown;
  readonly verificationRefs: unknown;
}

export interface PlatformRegulatoryPublishVersionPayload {
  readonly regulatoryReferenceId: string;
  readonly versionId: string;
  readonly releaseDecisionRef: unknown;
  readonly publishReason: unknown;
}

type FreezePayload = EnterpriseProject.ProjectFreezeTemplateBaselinePayload;
type ActivatePayload = EnterpriseProject.ProjectActivateRegulatoryProfilePayload;

function asReferenceLike(value: unknown): ReferenceLike {
  return value !== null && typeof value === 'object' ? value : {};
}

function asScopeLike(value: unknown): ScopeLike | undefined {
  return value !== null && typeof value === 'object' ? value : undefined;
}

function isCanonicalJsonArray(value: CanonicalJsonValue): value is readonly CanonicalJsonValue[] {
  return Array.isArray(value);
}

function canonicalJson(value: unknown, label: string): CanonicalJsonValue {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new EnterpriseBusinessError(PROJECT_PLATFORM_REFERENCE_INVALID, `${label} is required`);
  }
  const serialized = JSON.stringify(value);
  try {
    return JSON.parse(serialized) as CanonicalJsonValue;
  } catch {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_INVALID,
      `${label} must be valid JSON`,
    );
  }
}

function canonicalObject(value: unknown, label: string): CanonicalJsonObject {
  const json = canonicalJson(value, label);
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_INVALID,
      `${label} must be a JSON object`,
    );
  }
  return json as CanonicalJsonObject;
}

function canonicalArray(value: unknown, label: string): readonly CanonicalJsonValue[] {
  const json = canonicalJson(value, label);
  if (!isCanonicalJsonArray(json)) {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_INVALID,
      `${label} must be a JSON array`,
    );
  }
  return json;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_INVALID,
      `${label} must be non-empty`,
    );
  }
  return value;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isUuidV7(value)) {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_INVALID,
      `${label} must be an RFC 9562 UUIDv7`,
    );
  }
  return value;
}

function asHash(value: unknown, label: string): Buffer {
  const hash = asReferenceLike(value) as ContentHashLike;
  if (
    hash.algorithm !== 'SHA-256' ||
    hash.canonicalizationVersion !== '1' ||
    typeof hash.digest !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(hash.digest)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_INVALID,
      `${label} must carry a SHA-256/1 digest`,
    );
  }
  return Buffer.from(hash.digest.toLowerCase(), 'hex');
}

function hashRef(hash: Buffer): Common.ContentHash & CanonicalJsonObject {
  return {
    algorithm: 'SHA-256',
    digest: hash.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function scopeIsEmpty(value: unknown): boolean {
  const scope = asScopeLike(value);
  return scope !== undefined && Object.keys(scope).length === 0;
}

function projectScopeMatches(value: unknown, enterpriseId: string, projectId: string): boolean {
  const scope = asScopeLike(value);
  return scope?.enterpriseId === enterpriseId && scope.projectId === projectId;
}

function enterpriseScopeMatches(value: unknown, enterpriseId: string): boolean {
  const scope = asScopeLike(value);
  return scope?.enterpriseId === enterpriseId && scope.projectId === undefined;
}

function rejectLatest(value: unknown, label: string): void {
  const reference = asReferenceLike(value);
  if (
    reference.versionId === 'latest' ||
    reference.versionId === 'current' ||
    reference.immutableVersionId === 'latest' ||
    reference.immutableVersionId === 'current' ||
    reference.snapshotId === 'latest' ||
    reference.snapshotId === 'current'
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_TEMPLATE_LATEST_FORBIDDEN,
      `${label} must identify an exact version; latest/current is forbidden`,
    );
  }
}

function exactProjectVersionRef(
  value: unknown,
  expectedObjectType: string,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
  label: string,
): { ref: CanonicalJsonObject; objectId: string; versionId: string; projectId: string } {
  rejectLatest(value, label);
  const reference = asReferenceLike(value);
  const scope = asScopeLike(reference.scope);
  const objectId = uuid(reference.objectId, `${label}.objectId`);
  const versionId = uuid(reference.versionId, `${label}.versionId`);
  const projectId = uuid(scope?.projectId, `${label}.scope.projectId`);
  if (
    reference.kind !== 'VERSIONED' ||
    reference.objectType !== expectedObjectType ||
    scope?.enterpriseId !== context.enterpriseId ||
    (envelope.projectId !== undefined && projectId !== envelope.projectId) ||
    !context.allowedProjectIds.includes(projectId)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_TEMPLATE_BASELINE_IMMUTABLE,
      `${label} must identify the exact allowed Project scope`,
    );
  }
  return {
    ref: canonicalObject(value, label),
    objectId,
    versionId,
    projectId,
  };
}

function exactPlatformVersionRef(
  value: unknown,
  expectedObjectType: string,
  label: string,
): { ref: CanonicalJsonObject; objectId: string; versionId: string; hash: Buffer } {
  rejectLatest(value, label);
  const reference = asReferenceLike(value);
  const objectId = uuid(reference.objectId, `${label}.objectId`);
  const versionId = uuid(reference.immutableVersionId, `${label}.immutableVersionId`);
  if (
    reference.kind !== 'CONTENT_ADDRESSED' ||
    reference.objectType !== expectedObjectType ||
    !scopeIsEmpty(reference.scope)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_INVALID,
      `${label} must be an unscoped exact Platform Reference`,
    );
  }
  return {
    ref: canonicalObject(value, label),
    objectId,
    versionId,
    hash: asHash(reference.contentHash, `${label}.contentHash`),
  };
}

function exactReviewSnapshotRef(
  value: unknown,
  objectType: 'TemplateReview' | 'RegulatoryReview',
  enterpriseId: string,
  projectId: string,
  label: string,
): CanonicalJsonObject {
  rejectLatest(value, label);
  const reference = asReferenceLike(value);
  uuid(reference.objectId, `${label}.objectId`);
  uuid(reference.snapshotId, `${label}.snapshotId`);
  if (
    reference.kind !== 'SNAPSHOT' ||
    reference.objectType !== objectType ||
    !projectScopeMatches(reference.scope, enterpriseId, projectId)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_TEMPLATE_BASELINE_IMMUTABLE,
      `${label} must be an exact Project-scoped ${objectType} SnapshotRef`,
    );
  }
  asHash(reference.contentHash, `${label}.contentHash`);
  return canonicalObject(value, label);
}

function exactProductScopeSnapshotShape(
  value: unknown,
  enterpriseId: string,
  label: string,
): { ref: CanonicalJsonObject; snapshotId: string; productId: string; hash: Buffer } {
  rejectLatest(value, label);
  const reference = asReferenceLike(value);
  const productId = uuid(reference.objectId, `${label}.objectId`);
  const snapshotId = uuid(reference.snapshotId, `${label}.snapshotId`);
  if (
    reference.kind !== 'SNAPSHOT' ||
    reference.objectType !== 'ProductScopeSnapshot' ||
    !enterpriseScopeMatches(reference.scope, enterpriseId)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_REGULATORY_PROFILE_SCOPE_MISMATCH,
      `${label} must be an Enterprise-scoped ProductScopeSnapshot`,
    );
  }
  return {
    ref: canonicalObject(value, label),
    snapshotId,
    productId,
    hash: asHash(reference.contentHash, `${label}.contentHash`),
  };
}

function exactVersionedScopeRef(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): CanonicalJsonObject {
  rejectLatest(value, label);
  const reference = asReferenceLike(value);
  uuid(reference.objectId, `${label}.objectId`);
  uuid(reference.versionId, `${label}.versionId`);
  if (
    reference.kind !== 'VERSIONED' ||
    !projectScopeMatches(reference.scope, enterpriseId, projectId)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_TEMPLATE_BASELINE_IMMUTABLE,
      `${label} must be an exact Project-scoped VersionedRef`,
    );
  }
  return canonicalObject(value, label);
}

function validateEvidenceRef(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): CanonicalJsonObject {
  const evidenceRef = canonicalObject(value, label);
  const evidence = asReferenceLike(evidenceRef.evidence);
  const evidenceType = evidence.objectType;
  if (
    evidence.kind !== 'CONTENT_ADDRESSED' ||
    typeof evidenceType !== 'string' ||
    evidenceType === TEMPLATE_REF_TYPE ||
    evidenceType === REGULATORY_REF_TYPE ||
    evidenceType === 'ReferenceTemplateVersion' ||
    evidenceType === 'Template' ||
    evidenceType === 'RegulatoryReference'
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_REGULATORY_EVIDENCE_REQUIRED,
      `${label}.evidence must be an independent Evidence reference`,
    );
  }
  uuid(evidence.objectId, `${label}.evidence.objectId`);
  if (!projectScopeMatches(evidence.scope, enterpriseId, projectId)) {
    throw new EnterpriseBusinessError(
      PROJECT_REGULATORY_PROFILE_SCOPE_MISMATCH,
      `${label}.evidence crosses the trusted Project scope`,
    );
  }
  asHash(evidence.contentHash, `${label}.evidence.contentHash`);
  if (
    evidenceRef.relation !== 'SUPPORTS' &&
    evidenceRef.relation !== 'CONTRADICTS' &&
    evidenceRef.relation !== 'CONTEXT_ONLY'
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_REGULATORY_EVIDENCE_REQUIRED,
      `${label}.relation is not supported`,
    );
  }
  if (evidenceRef.evidenceLinkRef !== undefined) {
    const link = asReferenceLike(evidenceRef.evidenceLinkRef);
    uuid(link.objectId, `${label}.evidenceLinkRef.objectId`);
    if (!projectScopeMatches(link.scope, enterpriseId, projectId)) {
      throw new EnterpriseBusinessError(
        PROJECT_REGULATORY_PROFILE_SCOPE_MISMATCH,
        `${label}.evidenceLinkRef crosses the trusted Project scope`,
      );
    }
  }
  return evidenceRef;
}

function validateJustification(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): CanonicalJsonObject {
  const justification = canonicalObject(value, label) as ReferenceLike & CanonicalJsonObject;
  if (
    typeof justification.reasonCode !== 'string' ||
    !/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(justification.reasonCode)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_TEMPLATE_BASELINE_IMMUTABLE,
      `${label}.reasonCode must be a registered reason code`,
    );
  }
  nonEmptyString(justification.summary, `${label}.summary`);
  if (!Array.isArray(justification.evidenceRefs)) {
    throw new EnterpriseBusinessError(
      PROJECT_TEMPLATE_BASELINE_IMMUTABLE,
      `${label}.evidenceRefs must be an array`,
    );
  }
  justification.evidenceRefs.forEach((evidenceRef, index) =>
    validateEvidenceRef(evidenceRef, enterpriseId, projectId, `${label}.evidenceRefs[${index}]`),
  );
  if (justification.policyRef !== undefined) {
    exactVersionedScopeRef(justification.policyRef, enterpriseId, projectId, `${label}.policyRef`);
  }
  return justification;
}

function assertHumanOnly(
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
  operation: string,
): void {
  if (context.principalKind !== 'HUMAN' || envelope.principalKind !== 'HUMAN') {
    throw new EnterpriseBusinessError(PROJECT_HUMAN_ONLY_DENIED, `${operation} is Human-only`);
  }
}

function requirePlatformCapability(
  context: EnterpriseProjectTransactionContext,
  capability: 'PLATFORM_REFERENCE_ADMIN' | 'PLATFORM_REFERENCE_PUBLISHER',
): void {
  if (
    context.enterpriseId !== PLATFORM_CONTROL_SCOPE_ID ||
    context.allowedProjectIds.length !== 0 ||
    !context.platformReferenceCapabilities?.includes(capability)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_ROLE_REQUIRED,
      `platform reference capability ${capability} is required`,
    );
  }
}

function platformEnvelope(
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
  targetType: string,
  targetId: string,
): CommandEnvelope {
  if (
    envelope.platform !== true ||
    envelope.enterpriseId !== PLATFORM_CONTROL_SCOPE_ID ||
    envelope.projectId !== undefined ||
    envelope.targetId !== targetId ||
    ![
      targetType,
      targetType === TEMPLATE_TARGET_TYPE ? 'PlatformTemplate' : 'PlatformRegulatoryReference',
    ].includes(envelope.targetType)
  ) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'platform command target must identify the exact unscoped reference root',
    );
  }
  return {
    ...envelope,
    platform: true,
    enterpriseId: context.enterpriseId,
    projectId: undefined,
    targetType,
    targetId,
  };
}

function projectEnvelope(
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
  targetType: string,
  targetId: string,
  projectId: string,
): CommandEnvelope {
  if (
    envelope.platform === true ||
    envelope.enterpriseId !== context.enterpriseId ||
    envelope.targetId !== targetId ||
    (envelope.projectId !== undefined && envelope.projectId !== projectId)
  ) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'Project command target must identify the exact Project-owned root',
    );
  }
  return {
    ...envelope,
    platform: false,
    projectId,
    targetType,
    targetId,
  };
}

function platformTemplateVersionRef(
  referenceTemplateId: string,
  versionId: string,
  contentHash: Buffer,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: TEMPLATE_REF_TYPE,
    objectId: referenceTemplateId,
    immutableVersionId: versionId,
    scope: {},
    contentHash: hashRef(contentHash),
  };
}

function platformRegulatoryVersionRef(
  regulatoryReferenceId: string,
  versionId: string,
  contentHash: Buffer,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: REGULATORY_REF_TYPE,
    objectId: regulatoryReferenceId,
    immutableVersionId: versionId,
    scope: {},
    contentHash: hashRef(contentHash),
  };
}

function projectVersionedRef(
  objectType: 'TemplateBaseline' | 'RegulatoryProfile',
  objectId: string,
  versionId: string,
  enterpriseId: string,
  projectId: string,
): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType,
    objectId,
    versionId,
    scope: { enterpriseId, projectId },
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

function targetHash(reference: unknown): Buffer | undefined {
  const hash = asReferenceLike(reference).contentHash;
  if (hash === undefined) return undefined;
  const digest = (hash as ContentHashLike).digest;
  return typeof digest === 'string' && /^[0-9a-f]{64}$/i.test(digest)
    ? Buffer.from(digest.toLowerCase(), 'hex')
    : undefined;
}

async function appendReferenceFromValue(
  execution: Pick<CommandExecution, 'appendReferenceEdge'>,
  ownerObjectType: string,
  ownerObjectId: string,
  ownerVersionId: string,
  ownerPayloadHash: Buffer,
  value: unknown,
  referencePath: string,
  referencePurpose: string,
  targetModule: string,
): Promise<void> {
  const reference = asReferenceLike(value);
  if (typeof reference.objectType !== 'string' || typeof reference.objectId !== 'string') return;
  if (!isUuidV7(reference.objectId)) return;
  const targetVersionId =
    typeof reference.immutableVersionId === 'string'
      ? reference.immutableVersionId
      : typeof reference.versionId === 'string'
        ? reference.versionId
        : typeof reference.snapshotId === 'string'
          ? reference.snapshotId
          : undefined;
  const targetPayloadHash = targetHash(value);
  await execution.appendReferenceEdge({
    ownerObjectType,
    ownerObjectId,
    ownerVersionId,
    ownerPayloadHash,
    referencePath,
    targetModule,
    targetObjectType: reference.objectType,
    targetObjectId: reference.objectId,
    ...(targetVersionId === undefined ? {} : { targetVersionId }),
    ...(targetPayloadHash === undefined ? {} : { targetPayloadHash }),
    referencePurpose,
  });
}

function platformEventPayload(
  referenceType: 'template' | 'regulatory',
  rootId: string,
  versionId: string,
  versionNo: number,
  lifecycle: 'DRAFT' | 'PUBLISHED',
  contentHash: Buffer,
): CanonicalJsonObject {
  return {
    enterpriseId: PLATFORM_CONTROL_SCOPE_ID,
    ...(referenceType === 'template'
      ? { referenceTemplateId: rootId }
      : { regulatoryReferenceId: rootId }),
    versionId,
    versionNo,
    lifecycle,
    contentHash: hashRef(contentHash),
  };
}

function importVersionNo(versions: readonly { readonly version_no: number }[]): number {
  return versions.length === 0 ? 1 : (versions[versions.length - 1]?.version_no ?? 0) + 1;
}

function aggregateVersionToString(value: unknown): string {
  return String(value);
}

async function readPublishedTemplateVersion(
  trx: EnterpriseProjectTransaction,
  value: unknown,
  label: string,
): Promise<{ ref: CanonicalJsonObject; rootId: string; versionId: string; hash: Buffer }> {
  const exact = exactPlatformVersionRef(value, TEMPLATE_REF_TYPE, label);
  const row = await repo.getReferenceTemplateVersion(trx, exact.versionId);
  if (row?.reference_template_id !== exact.objectId || row.lifecycle !== 'PUBLISHED') {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_UNPUBLISHED,
      `${label} is not an exact published Platform Template version`,
    );
  }
  if (!row.content_hash.equals(exact.hash)) {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_HASH_MISMATCH,
      `${label} content hash does not match the published version`,
    );
  }
  return { ref: exact.ref, rootId: exact.objectId, versionId: exact.versionId, hash: exact.hash };
}

async function readPublishedRegulatoryVersion(
  trx: EnterpriseProjectTransaction,
  value: unknown,
  label: string,
): Promise<{ ref: CanonicalJsonObject; rootId: string; versionId: string; hash: Buffer }> {
  const exact = exactPlatformVersionRef(value, REGULATORY_REF_TYPE, label);
  const row = await repo.getRegulatoryReferenceVersion(trx, exact.versionId);
  if (row?.regulatory_reference_id !== exact.objectId || row.lifecycle !== 'PUBLISHED') {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_UNPUBLISHED,
      `${label} is not an exact published Platform Regulatory version`,
    );
  }
  if (!row.content_hash.equals(exact.hash)) {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_HASH_MISMATCH,
      `${label} content hash does not match the published version`,
    );
  }
  return { ref: exact.ref, rootId: exact.objectId, versionId: exact.versionId, hash: exact.hash };
}

function validatePlatformContentInput(value: unknown, label: string): CanonicalJsonObject {
  const reference = asReferenceLike(value);
  if (reference.kind !== 'CONTENT_ADDRESSED' || !scopeIsEmpty(reference.scope)) {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_INVALID,
      `${label} must be an unscoped CONTENT_ADDRESSED ref`,
    );
  }
  uuid(reference.objectId, `${label}.objectId`);
  asHash(reference.contentHash, `${label}.contentHash`);
  return canonicalObject(value, label);
}

function validatePlatformSource(value: unknown, label: string): CanonicalJsonObject {
  const source = canonicalObject(value, label);
  if (Object.keys(source).length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_INVALID,
      `${label} must identify a non-empty source`,
    );
  }
  return source;
}

function validatePublishFact(value: unknown, label: string): CanonicalJsonObject {
  return canonicalObject(value, label);
}

// =====================================================================
// Controlled Platform Template Reference capabilities
// =====================================================================

export async function handlePlatformTemplateImportVersion(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: PlatformTemplateImportVersionPayload },
): Promise<CommandResult> {
  requirePlatformCapability(context, 'PLATFORM_REFERENCE_ADMIN');
  const payload = envelope.payload;
  const rootId = uuid(payload.referenceTemplateId, 'referenceTemplateId');
  const versionId = uuid(payload.versionId, 'versionId');
  const contentRef = validatePlatformContentInput(payload.contentRef, 'contentRef');
  const contentHash = asHash(payload.contentHash, 'contentHash');
  const contentRefHash = asHash(contentRef.contentHash, 'contentRef.contentHash');
  if (!contentRefHash.equals(contentHash)) {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_HASH_MISMATCH,
      'contentRef hash must match contentHash',
    );
  }
  const sourceRef = validatePlatformSource(payload.sourceRef, 'sourceRef');
  const applicability = canonicalJson(payload.applicability, 'applicability');
  const normalizedEnvelope = platformEnvelope(context, envelope, TEMPLATE_TARGET_TYPE, rootId);
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const root = await repo.getReferenceTemplateById(execution.trx, rootId);
    const versionPayload = {
      enterpriseId: PLATFORM_CONTROL_SCOPE_ID,
      referenceTemplateId: rootId,
      versionId,
      referenceCode: payload.referenceCode,
      templateType: payload.templateType,
      versionLabel: payload.versionLabel,
      contentRef,
      contentHash: hashRef(contentHash),
      sourceRef,
      applicability,
    };
    nonEmptyString(payload.referenceCode, 'referenceCode');
    nonEmptyString(payload.templateType, 'templateType');
    nonEmptyString(payload.versionLabel, 'versionLabel');
    if (root === undefined) {
      if (normalizedEnvelope.expectedAggregateVersion !== undefined) {
        return {
          kind: 'REJECTED',
          errorCode: CONCURRENCY_CONFLICT,
          safeSummary: 'a new Platform Template root cannot carry an expected version',
        };
      }
      const insertedRoot = await repo.insertReferenceTemplate(execution.trx, {
        referenceTemplateId: rootId,
        referenceCode: payload.referenceCode,
        templateType: payload.templateType,
        createdByPrincipalId: normalizedEnvelope.principalId,
        sourceCommandId: normalizedEnvelope.commandId,
      });
      if (!insertedRoot) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PLATFORM_REFERENCE_INVALID,
          safeSummary: 'referenceCode is already bound to another Platform Template root',
        };
      }
      await repo.insertReferenceTemplateVersion(execution.trx, {
        referenceTemplateVersionId: versionId,
        referenceTemplateId: rootId,
        versionNo: 1,
        versionLabel: payload.versionLabel,
        contentRef,
        contentHash,
        sourceRef,
        applicability,
        createdByPrincipalId: normalizedEnvelope.principalId,
        sourceCommandId: normalizedEnvelope.commandId,
      });
      const eventPayload = platformEventPayload(
        'template',
        rootId,
        versionId,
        1,
        'DRAFT',
        contentHash,
      );
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'Platform.ReferenceTemplateVersionImported',
        eventVersion: '1.0',
        aggregateType: TEMPLATE_TARGET_TYPE,
        aggregateId: rootId,
        aggregateVersion: '1',
        payload: eventPayload,
        declaredHash: digestCanonicalPayload(eventPayload).hash,
        occurredAt: new Date(),
      });
      await appendReferenceFromValue(
        execution,
        TEMPLATE_TARGET_TYPE,
        rootId,
        versionId,
        digestCanonicalPayload(versionPayload).hash,
        contentRef,
        '/contentRef',
        'PLATFORM_TEMPLATE_CONTENT',
        'PlatformReference',
      );
      await appendReferenceFromValue(
        execution,
        TEMPLATE_TARGET_TYPE,
        rootId,
        versionId,
        digestCanonicalPayload(versionPayload).hash,
        sourceRef,
        '/sourceRef',
        'PLATFORM_TEMPLATE_SOURCE',
        'ExternalSource',
      );
      return {
        kind: 'COMMITTED',
        resultPayload: {
          referenceTemplateVersionRef: platformTemplateVersionRef(rootId, versionId, contentHash),
          lifecycle: 'DRAFT',
          versionNo: 1,
          aggregateVersion: '1',
          payloadHash: digestCanonicalPayload(versionPayload).hash.toString('hex'),
        } as unknown as CanonicalJsonObject,
      };
    }
    if (
      root.reference_code !== payload.referenceCode ||
      root.template_type !== payload.templateType
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_PLATFORM_REFERENCE_INVALID,
        safeSummary: 'Platform Template identity does not match the stored root',
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    if (normalizedEnvelope.expectedAggregateVersion === undefined) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'an existing Platform Template import requires an expected aggregate version',
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    const cas = await repo.casReferenceTemplate(
      execution.trx,
      rootId,
      normalizedEnvelope.expectedAggregateVersion,
      root.current_version_id,
      normalizedEnvelope.commandId,
    );
    if (!cas.ok) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'Platform Template import lost the root CAS race',
        currentAggregateVersion: cas.current,
      };
    }
    const versionNo = importVersionNo(
      await repo.getReferenceTemplateVersions(execution.trx, rootId),
    );
    await repo.insertReferenceTemplateVersion(execution.trx, {
      referenceTemplateVersionId: versionId,
      referenceTemplateId: rootId,
      versionNo,
      versionLabel: payload.versionLabel,
      contentRef,
      contentHash,
      sourceRef,
      applicability,
      createdByPrincipalId: normalizedEnvelope.principalId,
      sourceCommandId: normalizedEnvelope.commandId,
    });
    const eventPayload = platformEventPayload(
      'template',
      rootId,
      versionId,
      versionNo,
      'DRAFT',
      contentHash,
    );
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'Platform.ReferenceTemplateVersionImported',
      eventVersion: '1.0',
      aggregateType: TEMPLATE_TARGET_TYPE,
      aggregateId: rootId,
      aggregateVersion: cas.nextVersion,
      payload: eventPayload,
      declaredHash: digestCanonicalPayload(eventPayload).hash,
      occurredAt: new Date(),
    });
    await appendReferenceFromValue(
      execution,
      TEMPLATE_TARGET_TYPE,
      rootId,
      versionId,
      digestCanonicalPayload(versionPayload).hash,
      contentRef,
      '/contentRef',
      'PLATFORM_TEMPLATE_CONTENT',
      'PlatformReference',
    );
    await appendReferenceFromValue(
      execution,
      TEMPLATE_TARGET_TYPE,
      rootId,
      versionId,
      digestCanonicalPayload(versionPayload).hash,
      sourceRef,
      '/sourceRef',
      'PLATFORM_TEMPLATE_SOURCE',
      'ExternalSource',
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        referenceTemplateVersionRef: platformTemplateVersionRef(rootId, versionId, contentHash),
        lifecycle: 'DRAFT',
        versionNo,
        aggregateVersion: cas.nextVersion,
        payloadHash: digestCanonicalPayload(versionPayload).hash.toString('hex'),
      } as unknown as CanonicalJsonObject,
    };
  });
}

export async function handlePlatformTemplatePublishVersion(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: PlatformTemplatePublishVersionPayload },
): Promise<CommandResult> {
  requirePlatformCapability(context, 'PLATFORM_REFERENCE_PUBLISHER');
  const payload = envelope.payload;
  const rootId = uuid(payload.referenceTemplateId, 'referenceTemplateId');
  const versionId = uuid(payload.versionId, 'versionId');
  const releaseDecisionRef = validatePublishFact(payload.releaseDecisionRef, 'releaseDecisionRef');
  const publishReason = validatePublishFact(payload.publishReason, 'publishReason');
  const normalizedEnvelope = platformEnvelope(context, envelope, TEMPLATE_TARGET_TYPE, rootId);
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const root = await repo.getReferenceTemplateById(execution.trx, rootId);
    const version = await repo.getReferenceTemplateVersion(execution.trx, versionId);
    if (root === undefined || version?.reference_template_id !== rootId) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_TEMPLATE_VERSION_NOT_FOUND,
        safeSummary: 'Platform Template version was not found',
      };
    }
    if (version.lifecycle !== 'DRAFT') {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_PLATFORM_REFERENCE_INVALID,
        safeSummary: 'only a DRAFT Platform Template version can be published',
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    if (normalizedEnvelope.expectedAggregateVersion === undefined) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'Platform Template publish requires an expected aggregate version',
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    const cas = await repo.casReferenceTemplate(
      execution.trx,
      rootId,
      normalizedEnvelope.expectedAggregateVersion,
      versionId,
      normalizedEnvelope.commandId,
    );
    if (!cas.ok) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'Platform Template publish lost the root CAS race',
        currentAggregateVersion: cas.current,
      };
    }
    const published = await repo.publishReferenceTemplateVersion(
      execution.trx,
      rootId,
      versionId,
      normalizedEnvelope.principalId,
      releaseDecisionRef,
      publishReason,
    );
    if (!published) throw new Error('Platform Template version publish unexpectedly failed');
    const eventPayload = platformEventPayload(
      'template',
      rootId,
      versionId,
      version.version_no,
      'PUBLISHED',
      version.content_hash,
    );
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'Platform.ReferenceTemplateVersionPublished',
      eventVersion: '1.0',
      aggregateType: TEMPLATE_TARGET_TYPE,
      aggregateId: rootId,
      aggregateVersion: cas.nextVersion,
      payload: eventPayload,
      declaredHash: digestCanonicalPayload(eventPayload).hash,
      occurredAt: new Date(),
    });
    await appendReferenceFromValue(
      execution,
      TEMPLATE_TARGET_TYPE,
      rootId,
      versionId,
      version.content_hash,
      releaseDecisionRef,
      '/releaseDecisionRef',
      'PLATFORM_TEMPLATE_RELEASE_DECISION',
      'EnterpriseProject',
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        referenceTemplateVersionRef: platformTemplateVersionRef(
          rootId,
          versionId,
          version.content_hash,
        ),
        lifecycle: 'PUBLISHED',
        versionNo: version.version_no,
        aggregateVersion: cas.nextVersion,
        payloadHash: version.content_hash.toString('hex'),
      } as unknown as CanonicalJsonObject,
    };
  });
}

// =====================================================================
// Controlled Platform Regulatory Reference capabilities
// =====================================================================

export async function handlePlatformRegulatoryImportVersion(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: PlatformRegulatoryImportVersionPayload },
): Promise<CommandResult> {
  requirePlatformCapability(context, 'PLATFORM_REFERENCE_ADMIN');
  const payload = envelope.payload;
  const rootId = uuid(payload.regulatoryReferenceId, 'regulatoryReferenceId');
  const versionId = uuid(payload.versionId, 'versionId');
  const contentRef = validatePlatformContentInput(payload.contentRef, 'contentRef');
  const contentHash = asHash(payload.contentHash, 'contentHash');
  const contentRefHash = asHash(contentRef.contentHash, 'contentRef.contentHash');
  if (!contentRefHash.equals(contentHash)) {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REFERENCE_HASH_MISMATCH,
      'contentRef hash must match contentHash',
    );
  }
  const sourceRef = validatePlatformSource(payload.sourceRef, 'sourceRef');
  const verificationRefs = canonicalArray(payload.verificationRefs, 'verificationRefs');
  if (verificationRefs.length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_PLATFORM_REGULATORY_SOURCE_REQUIRED,
      'verificationRefs must contain at least one verification reference',
    );
  }
  const effectivePeriod = canonicalObject(payload.effectivePeriod, 'effectivePeriod');
  const authorityCode = nonEmptyString(payload.authorityCode, 'authorityCode');
  const jurisdiction = nonEmptyString(payload.jurisdiction, 'jurisdiction');
  const referenceCode = nonEmptyString(payload.referenceCode, 'referenceCode');
  const versionLabel = nonEmptyString(payload.versionLabel, 'versionLabel');
  const citation = nonEmptyString(payload.citation, 'citation');
  const normalizedEnvelope = platformEnvelope(context, envelope, REGULATORY_TARGET_TYPE, rootId);
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const root = await repo.getRegulatoryReferenceById(execution.trx, rootId);
    const versionPayload = {
      enterpriseId: PLATFORM_CONTROL_SCOPE_ID,
      regulatoryReferenceId: rootId,
      versionId,
      authorityCode,
      jurisdiction,
      referenceCode,
      versionLabel,
      citation,
      effectivePeriod,
      sourceRef,
      contentRef,
      contentHash: hashRef(contentHash),
      verificationRefs,
    };
    if (root === undefined) {
      if (normalizedEnvelope.expectedAggregateVersion !== undefined) {
        return {
          kind: 'REJECTED',
          errorCode: CONCURRENCY_CONFLICT,
          safeSummary: 'a new Platform Regulatory root cannot carry an expected version',
        };
      }
      const insertedRoot = await repo.insertRegulatoryReference(execution.trx, {
        regulatoryReferenceId: rootId,
        authorityCode,
        jurisdiction,
        referenceCode,
        createdByPrincipalId: normalizedEnvelope.principalId,
        sourceCommandId: normalizedEnvelope.commandId,
      });
      if (!insertedRoot) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_PLATFORM_REFERENCE_INVALID,
          safeSummary: 'authority/jurisdiction/referenceCode is already bound to another root',
        };
      }
      await repo.insertRegulatoryReferenceVersion(execution.trx, {
        regulatoryReferenceVersionId: versionId,
        regulatoryReferenceId: rootId,
        versionNo: 1,
        versionLabel,
        citation,
        effectivePeriod,
        sourceRef,
        contentRef,
        contentHash,
        verificationRefs,
        createdByPrincipalId: normalizedEnvelope.principalId,
        sourceCommandId: normalizedEnvelope.commandId,
      });
      const eventPayload = platformEventPayload(
        'regulatory',
        rootId,
        versionId,
        1,
        'DRAFT',
        contentHash,
      );
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'Platform.RegulatoryReferenceVersionImported',
        eventVersion: '1.0',
        aggregateType: REGULATORY_TARGET_TYPE,
        aggregateId: rootId,
        aggregateVersion: '1',
        payload: eventPayload,
        declaredHash: digestCanonicalPayload(eventPayload).hash,
        occurredAt: new Date(),
      });
      await appendReferenceFromValue(
        execution,
        REGULATORY_TARGET_TYPE,
        rootId,
        versionId,
        digestCanonicalPayload(versionPayload).hash,
        contentRef,
        '/contentRef',
        'PLATFORM_REGULATORY_CONTENT',
        'PlatformReference',
      );
      await appendReferenceFromValue(
        execution,
        REGULATORY_TARGET_TYPE,
        rootId,
        versionId,
        digestCanonicalPayload(versionPayload).hash,
        sourceRef,
        '/sourceRef',
        'PLATFORM_REGULATORY_SOURCE',
        'ExternalSource',
      );
      return {
        kind: 'COMMITTED',
        resultPayload: {
          regulatoryReferenceVersionRef: platformRegulatoryVersionRef(
            rootId,
            versionId,
            contentHash,
          ),
          lifecycle: 'DRAFT',
          versionNo: 1,
          aggregateVersion: '1',
          payloadHash: digestCanonicalPayload(versionPayload).hash.toString('hex'),
        } as unknown as CanonicalJsonObject,
      };
    }
    if (
      root.authority_code !== authorityCode ||
      root.jurisdiction !== jurisdiction ||
      root.reference_code !== referenceCode
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_PLATFORM_REFERENCE_INVALID,
        safeSummary: 'Platform Regulatory identity does not match the stored root',
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    if (normalizedEnvelope.expectedAggregateVersion === undefined) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary:
          'an existing Platform Regulatory import requires an expected aggregate version',
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    const cas = await repo.casRegulatoryReference(
      execution.trx,
      rootId,
      normalizedEnvelope.expectedAggregateVersion,
      root.current_version_id,
      normalizedEnvelope.commandId,
    );
    if (!cas.ok) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'Platform Regulatory import lost the root CAS race',
        currentAggregateVersion: cas.current,
      };
    }
    const versionNo = importVersionNo(
      await repo.getRegulatoryReferenceVersions(execution.trx, rootId),
    );
    await repo.insertRegulatoryReferenceVersion(execution.trx, {
      regulatoryReferenceVersionId: versionId,
      regulatoryReferenceId: rootId,
      versionNo,
      versionLabel,
      citation,
      effectivePeriod,
      sourceRef,
      contentRef,
      contentHash,
      verificationRefs,
      createdByPrincipalId: normalizedEnvelope.principalId,
      sourceCommandId: normalizedEnvelope.commandId,
    });
    const eventPayload = platformEventPayload(
      'regulatory',
      rootId,
      versionId,
      versionNo,
      'DRAFT',
      contentHash,
    );
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'Platform.RegulatoryReferenceVersionImported',
      eventVersion: '1.0',
      aggregateType: REGULATORY_TARGET_TYPE,
      aggregateId: rootId,
      aggregateVersion: cas.nextVersion,
      payload: eventPayload,
      declaredHash: digestCanonicalPayload(eventPayload).hash,
      occurredAt: new Date(),
    });
    await appendReferenceFromValue(
      execution,
      REGULATORY_TARGET_TYPE,
      rootId,
      versionId,
      digestCanonicalPayload(versionPayload).hash,
      contentRef,
      '/contentRef',
      'PLATFORM_REGULATORY_CONTENT',
      'PlatformReference',
    );
    await appendReferenceFromValue(
      execution,
      REGULATORY_TARGET_TYPE,
      rootId,
      versionId,
      digestCanonicalPayload(versionPayload).hash,
      sourceRef,
      '/sourceRef',
      'PLATFORM_REGULATORY_SOURCE',
      'ExternalSource',
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        regulatoryReferenceVersionRef: platformRegulatoryVersionRef(rootId, versionId, contentHash),
        lifecycle: 'DRAFT',
        versionNo,
        aggregateVersion: cas.nextVersion,
        payloadHash: digestCanonicalPayload(versionPayload).hash.toString('hex'),
      } as unknown as CanonicalJsonObject,
    };
  });
}

export async function handlePlatformRegulatoryPublishVersion(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: PlatformRegulatoryPublishVersionPayload },
): Promise<CommandResult> {
  requirePlatformCapability(context, 'PLATFORM_REFERENCE_PUBLISHER');
  const payload = envelope.payload;
  const rootId = uuid(payload.regulatoryReferenceId, 'regulatoryReferenceId');
  const versionId = uuid(payload.versionId, 'versionId');
  const releaseDecisionRef = validatePublishFact(payload.releaseDecisionRef, 'releaseDecisionRef');
  const publishReason = validatePublishFact(payload.publishReason, 'publishReason');
  const normalizedEnvelope = platformEnvelope(context, envelope, REGULATORY_TARGET_TYPE, rootId);
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const root = await repo.getRegulatoryReferenceById(execution.trx, rootId);
    const version = await repo.getRegulatoryReferenceVersion(execution.trx, versionId);
    if (root === undefined || version?.regulatory_reference_id !== rootId) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_REGULATORY_PROFILE_VERSION_NOT_FOUND,
        safeSummary: 'Platform Regulatory version was not found',
      };
    }
    if (version.lifecycle !== 'DRAFT') {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_PLATFORM_REFERENCE_INVALID,
        safeSummary: 'only a DRAFT Platform Regulatory version can be published',
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    if (normalizedEnvelope.expectedAggregateVersion === undefined) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'Platform Regulatory publish requires an expected aggregate version',
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    const cas = await repo.casRegulatoryReference(
      execution.trx,
      rootId,
      normalizedEnvelope.expectedAggregateVersion,
      versionId,
      normalizedEnvelope.commandId,
    );
    if (!cas.ok) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'Platform Regulatory publish lost the root CAS race',
        currentAggregateVersion: cas.current,
      };
    }
    const published = await repo.publishRegulatoryReferenceVersion(
      execution.trx,
      rootId,
      versionId,
      normalizedEnvelope.principalId,
      releaseDecisionRef,
      publishReason,
    );
    if (!published) throw new Error('Platform Regulatory version publish unexpectedly failed');
    const eventPayload = platformEventPayload(
      'regulatory',
      rootId,
      versionId,
      version.version_no,
      'PUBLISHED',
      version.content_hash,
    );
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'Platform.RegulatoryReferenceVersionPublished',
      eventVersion: '1.0',
      aggregateType: REGULATORY_TARGET_TYPE,
      aggregateId: rootId,
      aggregateVersion: cas.nextVersion,
      payload: eventPayload,
      declaredHash: digestCanonicalPayload(eventPayload).hash,
      occurredAt: new Date(),
    });
    await appendReferenceFromValue(
      execution,
      REGULATORY_TARGET_TYPE,
      rootId,
      versionId,
      version.content_hash,
      releaseDecisionRef,
      '/releaseDecisionRef',
      'PLATFORM_REGULATORY_RELEASE_DECISION',
      'EnterpriseProject',
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        regulatoryReferenceVersionRef: platformRegulatoryVersionRef(
          rootId,
          versionId,
          version.content_hash,
        ),
        lifecycle: 'PUBLISHED',
        versionNo: version.version_no,
        aggregateVersion: cas.nextVersion,
        payloadHash: version.content_hash.toString('hex'),
      } as unknown as CanonicalJsonObject,
    };
  });
}

// =====================================================================
// Project TemplateBaseline freeze
// =====================================================================

interface ResolvedTemplateSelection {
  readonly value: CanonicalJsonObject;
  readonly deliveryCategory: string;
  readonly templateRef: CanonicalJsonObject;
  readonly templateId: string;
  readonly templateVersionId: string;
  readonly applicabilityScope: CanonicalJsonValue;
  readonly selectionReason: CanonicalJsonObject;
  readonly replacementFor?: CanonicalJsonObject;
}

async function resolveTemplateSelections(
  trx: EnterpriseProjectTransaction,
  context: EnterpriseProjectTransactionContext,
  projectId: string,
  selections: readonly EnterpriseProject.TemplateSelection[],
): Promise<ResolvedTemplateSelection[]> {
  const categories = new Set<string>();
  const resolved: ResolvedTemplateSelection[] = [];
  for (const [index, selection] of selections.entries()) {
    const label = `selections[${index}]`;
    const deliveryCategory = nonEmptyString(
      selection.deliveryCategory,
      `${label}.deliveryCategory`,
    );
    if (categories.has(deliveryCategory)) {
      throw new EnterpriseBusinessError(
        PROJECT_TEMPLATE_BASELINE_IMMUTABLE,
        'TemplateSelection delivery categories must be unique',
      );
    }
    categories.add(deliveryCategory);
    const template = await readPublishedTemplateVersion(
      trx,
      selection.templateRef,
      `${label}.templateRef`,
    );
    const applicabilityScope = canonicalJson(
      selection.applicabilityScope,
      `${label}.applicabilityScope`,
    );
    const selectionReason = validateJustification(
      selection.selectionReason,
      context.enterpriseId,
      projectId,
      `${label}.selectionReason`,
    );
    const replacementFor =
      selection.replacementFor === undefined
        ? undefined
        : (
            await readPublishedTemplateVersion(
              trx,
              selection.replacementFor,
              `${label}.replacementFor`,
            )
          ).ref;
    const value = canonicalObject(
      {
        deliveryCategory,
        templateRef: template.ref,
        applicabilityScope,
        selectionReason,
        ...(replacementFor === undefined ? {} : { replacementFor }),
      },
      label,
    );
    resolved.push({
      value,
      deliveryCategory,
      templateRef: template.ref,
      templateId: template.rootId,
      templateVersionId: template.versionId,
      applicabilityScope,
      selectionReason,
      ...(replacementFor === undefined ? {} : { replacementFor }),
    });
  }
  return resolved;
}

function freezePayloadDigest(
  enterpriseId: string,
  projectId: string,
  baselineId: string,
  versionId: string,
  versionNo: number,
  previousVersionId: string | undefined,
  selections: readonly ResolvedTemplateSelection[],
  reviewSnapshotRef: CanonicalJsonObject,
  selectionRationale: CanonicalJsonObject,
): { payload: CanonicalJsonObject; hash: Buffer } {
  const payload = {
    enterpriseId,
    projectId,
    templateBaselineId: baselineId,
    versionId,
    versionNo,
    ...(previousVersionId === undefined ? {} : { previousVersionId }),
    selections: selections.map((selection) => selection.value),
    reviewSnapshotRef,
    selectionRationale,
  };
  return {
    payload,
    hash: digestCanonicalPayload(payload).hash,
  };
}

export async function handleFreezeTemplateBaseline(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: FreezePayload },
): Promise<CommandResult> {
  assertHumanOnly(context, envelope, 'TemplateBaseline freeze');
  const payload = envelope.payload;
  const baseline = exactProjectVersionRef(
    payload.templateBaselineVersionRef,
    'TemplateBaseline',
    context,
    envelope,
    'templateBaselineVersionRef',
  );
  const projectId = baseline.projectId;
  const reviewSnapshotRef = exactReviewSnapshotRef(
    payload.reviewSnapshotRef,
    'TemplateReview',
    context.enterpriseId,
    projectId,
    'reviewSnapshotRef',
  );
  const selectionRationale = validateJustification(
    payload.selectionRationale,
    context.enterpriseId,
    projectId,
    'selectionRationale',
  );
  if (!Array.isArray(payload.selections) || payload.selections.length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_TEMPLATE_BASELINE_IMMUTABLE,
      'TemplateBaseline freeze requires a non-empty selection set',
    );
  }
  const normalizedEnvelope = projectEnvelope(
    context,
    envelope,
    'TemplateBaseline',
    baseline.objectId,
    projectId,
  );
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const project = await repo.getProjectById(execution.trx, projectId);
    if (project?.enterprise_id !== context.enterpriseId || project.status !== 'ACTIVE') {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_TEMPLATE_BASELINE_IMMUTABLE,
        safeSummary: 'TemplateBaseline requires an active Project in the trusted scope',
      };
    }
    const root = await repo.getTemplateBaselineByProject(
      execution.trx,
      context.enterpriseId,
      projectId,
    );
    if (
      root?.template_baseline_id !== undefined &&
      root.template_baseline_id !== baseline.objectId
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_TEMPLATE_BASELINE_IMMUTABLE,
        safeSummary: 'Project already has a different TemplateBaseline identity',
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    const resolved = await resolveTemplateSelections(
      execution.trx,
      context,
      projectId,
      payload.selections,
    );
    const existingVersions =
      root === undefined
        ? []
        : await repo.getTemplateBaselineVersions(execution.trx, root.template_baseline_id);
    const actualVersionNo = root === undefined ? 1 : (existingVersions.at(-1)?.version_no ?? 0) + 1;
    const digest = freezePayloadDigest(
      context.enterpriseId,
      projectId,
      baseline.objectId,
      baseline.versionId,
      actualVersionNo,
      root?.active_version_id ?? undefined,
      resolved,
      reviewSnapshotRef,
      selectionRationale,
    );
    if (root === undefined && normalizedEnvelope.expectedAggregateVersion !== undefined) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'a new TemplateBaseline root cannot carry an expected version',
      };
    }
    if (root !== undefined && normalizedEnvelope.expectedAggregateVersion === undefined) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'an existing TemplateBaseline requires an expected aggregate version',
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    if (root === undefined) {
      const insertedRoot = await repo.insertTemplateBaseline(execution.trx, {
        templateBaselineId: baseline.objectId,
        enterpriseId: context.enterpriseId,
        projectId,
        currentVersionId: baseline.versionId,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        sourceCommandId: envelope.commandId,
      });
      if (!insertedRoot) {
        return {
          kind: 'REJECTED',
          errorCode: CONCURRENCY_CONFLICT,
          safeSummary: 'another TemplateBaseline root was created for this Project',
        };
      }
    }
    let aggregateVersion = '1';
    if (root !== undefined) {
      const expectedAggregateVersion = normalizedEnvelope.expectedAggregateVersion;
      if (expectedAggregateVersion === undefined) {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          'TemplateBaseline expected aggregate version disappeared before CAS',
        );
      }
      const cas = await repo.casTemplateBaseline(
        execution.trx,
        root.template_baseline_id,
        expectedAggregateVersion,
        baseline.versionId,
        normalizedEnvelope.commandId,
      );
      if (!cas.ok) {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          `TemplateBaseline CAS conflict (current=${cas.current})`,
        );
      }
      aggregateVersion = cas.nextVersion;
    }
    await repo.insertTemplateBaselineVersion(execution.trx, {
      versionId: baseline.versionId,
      templateBaselineId: baseline.objectId,
      enterpriseId: context.enterpriseId,
      projectId,
      versionNo: actualVersionNo,
      ...(root?.active_version_id === undefined
        ? {}
        : { previousVersionId: root.active_version_id }),
      selectionsPayload: resolved.map((selection) => selection.value),
      reviewSnapshotRef,
      selectionRationale,
      payloadHash: digest.hash,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    for (const selection of resolved) {
      await repo.insertTemplateSelection(execution.trx, {
        selectionId: newUuidV7(),
        templateBaselineId: baseline.objectId,
        versionId: baseline.versionId,
        enterpriseId: context.enterpriseId,
        projectId,
        deliveryCategory: selection.deliveryCategory,
        templateRef: selection.templateRef,
        templateId: selection.templateId,
        templateVersionId: selection.templateVersionId,
        applicabilityScope: selection.applicabilityScope,
        selectionReason: selection.selectionReason,
        ...(selection.replacementFor === undefined
          ? {}
          : { replacementFor: selection.replacementFor }),
        payloadHash: digestCanonicalPayload(selection.value).hash,
        recordedByPrincipalId: envelope.principalId,
        recordedByActorSnapshotId: envelope.actorSnapshotId,
        authorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
    }
    await appendReferenceFromValue(
      execution,
      'TemplateBaseline',
      baseline.objectId,
      baseline.versionId,
      digest.hash,
      projectRef(context.enterpriseId, projectId),
      '/projectRef',
      'TEMPLATE_BASELINE_PROJECT_SCOPE',
      'EnterpriseProject',
    );
    await appendReferenceFromValue(
      execution,
      'TemplateBaseline',
      baseline.objectId,
      baseline.versionId,
      digest.hash,
      reviewSnapshotRef,
      '/reviewSnapshotRef',
      'TEMPLATE_BASELINE_REVIEW',
      'EnterpriseProject',
    );
    for (const [index, selection] of resolved.entries()) {
      await appendReferenceFromValue(
        execution,
        'TemplateBaseline',
        baseline.objectId,
        baseline.versionId,
        digest.hash,
        selection.templateRef,
        `/selections/${index}/templateRef`,
        'TEMPLATE_BASELINE_TEMPLATE',
        'PlatformReference',
      );
      for (const [evidenceIndex, evidence] of (
        selection.selectionReason.evidenceRefs as readonly unknown[]
      ).entries()) {
        await appendReferenceFromValue(
          execution,
          'TemplateBaseline',
          baseline.objectId,
          baseline.versionId,
          digest.hash,
          asReferenceLike(evidence).evidence,
          `/selections/${index}/selectionReason/evidenceRefs/${evidenceIndex}/evidence`,
          'TEMPLATE_BASELINE_SELECTION_EVIDENCE',
          'Evidence',
        );
      }
    }
    const eventPayload = {
      enterpriseId: context.enterpriseId,
      projectId,
      templateBaselineId: baseline.objectId,
      templateBaselineVersionRef: projectVersionedRef(
        'TemplateBaseline',
        baseline.objectId,
        baseline.versionId,
        context.enterpriseId,
        projectId,
      ),
      projectRef: projectRef(context.enterpriseId, projectId),
      selectionCount: resolved.length,
      payloadHash: hashRef(digest.hash),
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'Project.TemplateBaselineFrozen',
      eventVersion: '1.0',
      aggregateType: 'TemplateBaseline',
      aggregateId: baseline.objectId,
      aggregateVersion,
      payload: eventPayload,
      declaredHash: digestCanonicalPayload(eventPayload).hash,
      occurredAt: new Date(),
    });
    return {
      kind: 'COMMITTED',
      resultPayload: {
        templateBaselineRef: projectVersionedRef(
          'TemplateBaseline',
          baseline.objectId,
          baseline.versionId,
          context.enterpriseId,
          projectId,
        ),
        projectRef: projectRef(context.enterpriseId, projectId),
        status: 'FROZEN',
        versionNo: actualVersionNo,
        aggregateVersion,
        payloadHash: digest.hash.toString('hex'),
      } as unknown as CanonicalJsonObject,
    };
  });
}

// =====================================================================
// Project RegulatoryProfile activation
// =====================================================================

interface ResolvedRegulatoryItem {
  readonly value: CanonicalJsonObject;
  readonly itemId: string;
  readonly regulatoryReferenceRef: CanonicalJsonObject;
  readonly regulatoryReferenceId: string;
  readonly regulatoryReferenceVersionId: string;
  readonly contentHash: Buffer;
  readonly applicability: RegulatoryApplicabilityValue;
  readonly rationale: CanonicalJsonObject;
  readonly evidenceRefs: readonly CanonicalJsonObject[];
  readonly riskLevel: string;
}

type RegulatoryApplicabilityValue = 'APPLICABLE' | 'NOT_APPLICABLE' | 'PENDING_DETERMINATION';

function isRegulatoryApplicability(value: unknown): value is RegulatoryApplicabilityValue {
  return value === 'APPLICABLE' || value === 'NOT_APPLICABLE' || value === 'PENDING_DETERMINATION';
}

async function resolveRegulatoryItems(
  trx: EnterpriseProjectTransaction,
  context: EnterpriseProjectTransactionContext,
  projectId: string,
  items: readonly EnterpriseProject.RegulatoryApplicability[],
): Promise<ResolvedRegulatoryItem[]> {
  const references = new Set<string>();
  const resolved: ResolvedRegulatoryItem[] = [];
  for (const [index, item] of items.entries()) {
    const label = `applicabilityItems[${index}]`;
    const reference = await readPublishedRegulatoryVersion(
      trx,
      item.regulatoryReferenceRef,
      `${label}.regulatoryReferenceRef`,
    );
    const key = `${reference.rootId}:${reference.versionId}`;
    if (references.has(key)) {
      throw new EnterpriseBusinessError(
        PROJECT_REGULATORY_APPLICABILITY_CONFLICT,
        'a Regulatory Reference version may occur only once in a Profile',
      );
    }
    references.add(key);
    const applicability: unknown = item.applicability;
    if (!isRegulatoryApplicability(applicability)) {
      throw new EnterpriseBusinessError(
        PROJECT_REGULATORY_APPLICABILITY_CONFLICT,
        `${label}.applicability is not in the closed set`,
      );
    }
    const rationale = validateJustification(
      item.rationale,
      context.enterpriseId,
      projectId,
      `${label}.rationale`,
    );
    if (!Array.isArray(item.evidenceRefs)) {
      throw new EnterpriseBusinessError(
        PROJECT_REGULATORY_EVIDENCE_REQUIRED,
        `${label}.evidenceRefs must be an array`,
      );
    }
    const evidenceRefs = item.evidenceRefs.map((evidence, evidenceIndex) =>
      validateEvidenceRef(
        evidence,
        context.enterpriseId,
        projectId,
        `${label}.evidenceRefs[${evidenceIndex}]`,
      ),
    );
    const riskLevel = nonEmptyString(item.riskLevel, `${label}.riskLevel`);
    if (applicability !== 'PENDING_DETERMINATION' && evidenceRefs.length === 0) {
      throw new EnterpriseBusinessError(
        PROJECT_REGULATORY_EVIDENCE_REQUIRED,
        `${label} requires independent evidence for a determined applicability`,
      );
    }
    if (
      applicability === 'PENDING_DETERMINATION' &&
      (riskLevel === 'HIGH' || riskLevel === 'CRITICAL')
    ) {
      throw new EnterpriseBusinessError(
        PROJECT_REGULATORY_APPLICABILITY_CONFLICT,
        `${label} cannot activate a high-risk pending determination`,
      );
    }
    const itemId = newUuidV7();
    const value = canonicalObject(
      {
        itemId,
        regulatoryReferenceRef: reference.ref,
        applicability,
        rationale,
        evidenceRefs,
        riskLevel,
      },
      label,
    );
    resolved.push({
      value,
      itemId,
      regulatoryReferenceRef: reference.ref,
      regulatoryReferenceId: reference.rootId,
      regulatoryReferenceVersionId: reference.versionId,
      contentHash: reference.hash,
      applicability,
      rationale,
      evidenceRefs,
      riskLevel,
    });
  }
  return resolved;
}

function regulatoryPayloadDigest(
  enterpriseId: string,
  projectId: string,
  profileId: string,
  versionId: string,
  versionNo: number,
  previousVersionId: string | undefined,
  jurisdiction: string,
  productScopeSnapshotRef: CanonicalJsonObject,
  items: readonly ResolvedRegulatoryItem[],
  reviewSnapshotRef: CanonicalJsonObject,
): { payload: CanonicalJsonObject; hash: Buffer } {
  const payload = {
    enterpriseId,
    projectId,
    regulatoryProfileId: profileId,
    versionId,
    versionNo,
    ...(previousVersionId === undefined ? {} : { previousVersionId }),
    jurisdiction,
    productScopeSnapshotRef,
    applicabilityItems: items.map((item) => item.value),
    reviewSnapshotRef,
  };
  return {
    payload,
    hash: digestCanonicalPayload(payload).hash,
  };
}

export async function handleActivateRegulatoryProfile(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: ActivatePayload },
): Promise<CommandResult> {
  assertHumanOnly(context, envelope, 'RegulatoryProfile activation');
  const payload = envelope.payload;
  const profile = exactProjectVersionRef(
    payload.regulatoryProfileVersionRef,
    'RegulatoryProfile',
    context,
    envelope,
    'regulatoryProfileVersionRef',
  );
  const projectId = profile.projectId;
  const jurisdiction = nonEmptyString(payload.jurisdiction, 'jurisdiction');
  const reviewSnapshotRef = exactReviewSnapshotRef(
    payload.reviewSnapshotRef,
    'RegulatoryReview',
    context.enterpriseId,
    projectId,
    'reviewSnapshotRef',
  );
  if (!Array.isArray(payload.applicabilityItems) || payload.applicabilityItems.length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_REGULATORY_APPLICABILITY_CONFLICT,
      'RegulatoryProfile activation requires a non-empty applicability set',
    );
  }
  const productScope = exactProductScopeSnapshotShape(
    payload.productScopeSnapshotRef,
    context.enterpriseId,
    'productScopeSnapshotRef',
  );
  const normalizedEnvelope = projectEnvelope(
    context,
    envelope,
    'RegulatoryProfile',
    profile.objectId,
    projectId,
  );
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const project = await repo.getProjectById(execution.trx, projectId);
    if (project?.enterprise_id !== context.enterpriseId || project.status !== 'ACTIVE') {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_REGULATORY_PROFILE_SCOPE_MISMATCH,
        safeSummary: 'RegulatoryProfile requires an active Project in the trusted scope',
      };
    }
    const productScopeRow = await repo.getProductScopeSnapshot(
      execution.trx,
      productScope.snapshotId,
    );
    if (
      productScopeRow?.enterprise_id !== context.enterpriseId ||
      productScopeRow.product_id !== productScope.productId ||
      !productScopeRow.payload_hash.equals(productScope.hash)
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_REGULATORY_PROFILE_SCOPE_MISMATCH,
        safeSummary: 'ProductScopeSnapshot ref does not match the immutable stored snapshot',
      };
    }
    const root = await repo.getRegulatoryProfileByProject(
      execution.trx,
      context.enterpriseId,
      projectId,
    );
    if (
      root?.regulatory_profile_id !== undefined &&
      root.regulatory_profile_id !== profile.objectId
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_REGULATORY_PROFILE_SCOPE_MISMATCH,
        safeSummary: 'Project already has a different RegulatoryProfile identity',
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    const resolved = await resolveRegulatoryItems(
      execution.trx,
      context,
      projectId,
      payload.applicabilityItems,
    );
    const previousVersionId = root?.active_version_id ?? undefined;
    const existingVersions =
      root === undefined
        ? []
        : await repo.getRegulatoryProfileVersions(execution.trx, root.regulatory_profile_id);
    const versionNo = root === undefined ? 1 : (existingVersions.at(-1)?.version_no ?? 0) + 1;
    const digest = regulatoryPayloadDigest(
      context.enterpriseId,
      projectId,
      profile.objectId,
      profile.versionId,
      versionNo,
      previousVersionId,
      jurisdiction,
      productScope.ref,
      resolved,
      reviewSnapshotRef,
    );
    if (root === undefined && normalizedEnvelope.expectedAggregateVersion !== undefined) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'a new RegulatoryProfile root cannot carry an expected version',
      };
    }
    if (root !== undefined && normalizedEnvelope.expectedAggregateVersion === undefined) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'an existing RegulatoryProfile requires an expected aggregate version',
        currentAggregateVersion: aggregateVersionToString(root.aggregate_version),
      };
    }
    if (root === undefined) {
      const insertedRoot = await repo.insertRegulatoryProfile(execution.trx, {
        regulatoryProfileId: profile.objectId,
        enterpriseId: context.enterpriseId,
        projectId,
        currentVersionId: profile.versionId,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        sourceCommandId: envelope.commandId,
      });
      if (!insertedRoot) {
        return {
          kind: 'REJECTED',
          errorCode: CONCURRENCY_CONFLICT,
          safeSummary: 'another RegulatoryProfile root was created for this Project',
        };
      }
    }
    let aggregateVersion = '1';
    if (root !== undefined) {
      const expectedAggregateVersion = normalizedEnvelope.expectedAggregateVersion;
      if (expectedAggregateVersion === undefined) {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          'RegulatoryProfile expected aggregate version disappeared before CAS',
        );
      }
      const cas = await repo.casRegulatoryProfile(
        execution.trx,
        root.regulatory_profile_id,
        expectedAggregateVersion,
        profile.versionId,
        normalizedEnvelope.commandId,
      );
      if (!cas.ok) {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          `RegulatoryProfile CAS conflict (current=${cas.current})`,
        );
      }
      aggregateVersion = cas.nextVersion;
    }
    await repo.insertRegulatoryProfileVersion(execution.trx, {
      versionId: profile.versionId,
      regulatoryProfileId: profile.objectId,
      enterpriseId: context.enterpriseId,
      projectId,
      versionNo,
      jurisdiction,
      productScopeSnapshotRef: productScope.ref,
      productScopeSnapshotId: productScope.snapshotId,
      productScopePayloadHash: productScope.hash,
      applicabilityPayload: resolved.map((item) => item.value),
      reviewSnapshotRef,
      payloadHash: digest.hash,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    for (const item of resolved) {
      await repo.insertRegulatoryProfileItem(execution.trx, {
        itemId: item.itemId,
        regulatoryProfileId: profile.objectId,
        versionId: profile.versionId,
        enterpriseId: context.enterpriseId,
        projectId,
        regulatoryReferenceRef: item.regulatoryReferenceRef,
        regulatoryReferenceId: item.regulatoryReferenceId,
        regulatoryReferenceVersionId: item.regulatoryReferenceVersionId,
        contentHash: item.contentHash,
        applicability: item.applicability,
        rationale: item.rationale,
        evidenceRefs: item.evidenceRefs,
        riskLevel: item.riskLevel,
        payloadHash: digestCanonicalPayload(item.value).hash,
        recordedByPrincipalId: envelope.principalId,
        recordedByActorSnapshotId: envelope.actorSnapshotId,
        authorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      });
    }
    await appendReferenceFromValue(
      execution,
      'RegulatoryProfile',
      profile.objectId,
      profile.versionId,
      digest.hash,
      projectRef(context.enterpriseId, projectId),
      '/projectRef',
      'REGULATORY_PROFILE_PROJECT_SCOPE',
      'EnterpriseProject',
    );
    await appendReferenceFromValue(
      execution,
      'RegulatoryProfile',
      profile.objectId,
      profile.versionId,
      digest.hash,
      productScope.ref,
      '/productScopeSnapshotRef',
      'REGULATORY_PROFILE_PRODUCT_SCOPE',
      'EnterpriseProject',
    );
    await appendReferenceFromValue(
      execution,
      'RegulatoryProfile',
      profile.objectId,
      profile.versionId,
      digest.hash,
      reviewSnapshotRef,
      '/reviewSnapshotRef',
      'REGULATORY_PROFILE_REVIEW',
      'EnterpriseProject',
    );
    for (const [index, item] of resolved.entries()) {
      await appendReferenceFromValue(
        execution,
        'RegulatoryProfile',
        profile.objectId,
        profile.versionId,
        digest.hash,
        item.regulatoryReferenceRef,
        `/applicabilityItems/${index}/regulatoryReferenceRef`,
        'REGULATORY_PROFILE_AUTHORITY',
        'PlatformReference',
      );
      for (const [evidenceIndex, evidence] of item.evidenceRefs.entries()) {
        await appendReferenceFromValue(
          execution,
          'RegulatoryProfile',
          profile.objectId,
          profile.versionId,
          digest.hash,
          asReferenceLike(evidence).evidence,
          `/applicabilityItems/${index}/evidenceRefs/${evidenceIndex}/evidence`,
          'REGULATORY_PROFILE_EVIDENCE',
          'Evidence',
        );
      }
    }
    const eventPayload = {
      enterpriseId: context.enterpriseId,
      projectId,
      regulatoryProfileId: profile.objectId,
      regulatoryProfileVersionRef: projectVersionedRef(
        'RegulatoryProfile',
        profile.objectId,
        profile.versionId,
        context.enterpriseId,
        projectId,
      ),
      productScopeSnapshotRef: productScope.ref,
      projectRef: projectRef(context.enterpriseId, projectId),
      applicabilityCount: resolved.length,
      payloadHash: hashRef(digest.hash),
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'Project.RegulatoryProfileActivated',
      eventVersion: '1.0',
      aggregateType: 'RegulatoryProfile',
      aggregateId: profile.objectId,
      aggregateVersion,
      payload: eventPayload,
      declaredHash: digestCanonicalPayload(eventPayload).hash,
      occurredAt: new Date(),
    });
    return {
      kind: 'COMMITTED',
      resultPayload: {
        regulatoryProfileRef: projectVersionedRef(
          'RegulatoryProfile',
          profile.objectId,
          profile.versionId,
          context.enterpriseId,
          projectId,
        ),
        productScopeSnapshotRef: productScope.ref,
        projectRef: projectRef(context.enterpriseId, projectId),
        status: 'FROZEN',
        versionNo,
        aggregateVersion,
        payloadHash: digest.hash.toString('hex'),
      } as unknown as CanonicalJsonObject,
    };
  });
}
