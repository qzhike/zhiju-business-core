import { exactCompletionCriteria } from '@zhiju/contracts';
// IM-03 WI-10 (issue #66): DeliveryPlan/DeliveryItem draft, Human approval,
// activation and criteria query handlers. Recommendations remain proposals
// until an exact Human decision is persisted and consumed by activation.

import type { Kysely } from 'kysely';
import type { CanonicalJson, Common, EnterpriseProject } from '@zhiju/contracts';
import {
  isUuidV7,
  newUuidV7,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import {
  digestCanonicalPayload,
  withEnterpriseProjectTransaction,
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
import { DeliveryPlanRepository } from '../persistence/delivery-plan-repository.js';
import { DeliveryItemCompletionRepository } from '../persistence/delivery-item-completion-repository.js';
import type {
  DeliveryItemInsert,
  DeliveryPlanCasPatch,
} from '../persistence/delivery-plan-repository.js';
import {
  EnterpriseBusinessError,
  PROJECT_DELIVERY_APPROVAL_DECISION_INVALID,
  PROJECT_DELIVERY_DEPENDENCY_CYCLE,
  PROJECT_DELIVERY_GAP_NOT_ACCEPTED,
  PROJECT_DELIVERY_ITEM_INVALID,
  PROJECT_DELIVERY_ITEM_KEY_CONFLICT,
  PROJECT_DELIVERY_PLAN_HUMAN_APPROVAL_REQUIRED,
  PROJECT_DELIVERY_PLAN_IMMUTABLE,
  PROJECT_DELIVERY_REFERENCE_INVALID,
  PROJECT_DELIVERY_VERSION_NOT_FOUND,
} from './enterprise-business-errors.js';

type CreatePayload = EnterpriseProject.ProjectCreateDeliveryPlanDraftPayload;
type ApprovePayload = EnterpriseProject.ProjectApproveDeliveryPlanPayload;
type ActivatePayload = EnterpriseProject.ProjectActivateDeliveryPlanPayload;
type CriteriaPayload = EnterpriseProject.ProjectGetDeliveryItemCriteriaPayload;

export type CreateDeliveryPlanDraftCommandPayload = CreatePayload;
export type ApproveDeliveryPlanCommandPayload = ApprovePayload;
export type ActivateDeliveryPlanCommandPayload = ActivatePayload;
export type GetDeliveryItemCriteriaQueryPayload = CriteriaPayload;

type ReferenceLike = Record<string, unknown>;

interface ProjectVersionReference {
  readonly ref: CanonicalJsonObject;
  readonly objectType: string;
  readonly objectId: string;
  readonly versionId: string;
  readonly targetPayloadHash?: Buffer | undefined;
}

interface EnterpriseVersionReference extends ProjectVersionReference {
  readonly projectId?: undefined;
}

interface EnterpriseSnapshotReference {
  readonly ref: CanonicalJsonObject;
  readonly objectType: string;
  readonly objectId: string;
  readonly snapshotId: string;
  readonly targetPayloadHash: Buffer | undefined;
}

type BaselineReference = ProjectVersionReference | EnterpriseSnapshotReference;

interface NormalizedDeliveryItem {
  readonly value: CanonicalJsonObject;
  readonly itemId: string;
  readonly itemKey: string;
  readonly itemType: string;
  readonly title: string;
  readonly objective: string;
  readonly sourceGapItemRefs: readonly ProjectVersionReference[];
  readonly dependencyItemIds: readonly string[];
  readonly targetArtifactTypes: readonly string[];
  readonly qualityProfileRef: ProjectVersionReference;
  readonly completionCriteria: CanonicalJsonValue;
  readonly dueConstraint?: CanonicalJsonValue;
  readonly criteriaHash: Buffer;
}

function asReferenceLike(value: unknown): ReferenceLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ReferenceLike)
    : {};
}

function asCanonicalJson(value: unknown, label: string): CanonicalJsonValue {
  try {
    const serialized: unknown = JSON.stringify(value);
    if (typeof serialized !== 'string') throw new Error('undefined is not JSON');
    return JSON.parse(serialized) as CanonicalJsonValue;
  } catch {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_ITEM_INVALID,
      `${label} must be valid canonical JSON`,
    );
  }
}

function canonicalObject(value: unknown, label: string): CanonicalJsonObject {
  const canonical = asCanonicalJson(value, label);
  if (canonical === null || typeof canonical !== 'object' || Array.isArray(canonical)) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      `${label} must be a JSON object`,
    );
  }
  return canonical as CanonicalJsonObject;
}

function nonEmpty(value: unknown, label: string, code = PROJECT_DELIVERY_ITEM_INVALID): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EnterpriseBusinessError(code, `${label} must be non-empty`);
  }
  return value;
}

function uuid(value: unknown, label: string, code = PROJECT_DELIVERY_REFERENCE_INVALID): string {
  if (typeof value !== 'string' || !isUuidV7(value)) {
    throw new EnterpriseBusinessError(code, `${label} must be an RFC 9562 UUIDv7`);
  }
  return value;
}

function rejectLatest(value: unknown, label: string): void {
  const reference = asReferenceLike(value);
  if (
    reference.versionId === 'latest' ||
    reference.versionId === 'current' ||
    reference.snapshotId === 'latest' ||
    reference.snapshotId === 'current' ||
    reference.immutableVersionId === 'latest' ||
    reference.immutableVersionId === 'current'
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      `${label} must identify an exact version or snapshot`,
    );
  }
}

function referenceHash(value: unknown, label: string): Buffer {
  const hash = asReferenceLike(asReferenceLike(value).contentHash);
  if (
    hash.algorithm !== 'SHA-256' ||
    hash.canonicalizationVersion !== '1' ||
    typeof hash.digest !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(hash.digest)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      `${label} must carry a SHA-256/1 digest`,
    );
  }
  return Buffer.from(hash.digest.toLowerCase(), 'hex');
}

function optionalReferenceHash(value: unknown, label: string): Buffer | undefined {
  const reference = asReferenceLike(value);
  if (reference.contentHash === undefined) return undefined;
  return referenceHash(value, label);
}

function hashRef(hash: Buffer): Common.ContentHash & CanonicalJsonObject {
  return {
    algorithm: 'SHA-256',
    digest: hash.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function projectScope(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): void {
  const scope = asReferenceLike(asReferenceLike(value).scope);
  if (scope.enterpriseId !== enterpriseId || scope.projectId !== projectId) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      `${label} must carry the exact Project scope`,
    );
  }
}

function enterpriseScope(value: unknown, enterpriseId: string, label: string): void {
  const scope = asReferenceLike(asReferenceLike(value).scope);
  if (scope.enterpriseId !== enterpriseId || scope.projectId !== undefined) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      `${label} must carry the exact Enterprise scope`,
    );
  }
}

function projectIdFromReference(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
  label: string,
): string {
  const scope = asReferenceLike(asReferenceLike(value).scope);
  const projectId = uuid(scope.projectId, `${label}.scope.projectId`);
  if (
    scope.enterpriseId !== context.enterpriseId ||
    !context.allowedProjectIds.includes(projectId)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      `${label} must identify an allowed Project exactly`,
    );
  }
  return projectId;
}

function exactProjectRef(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
): string {
  const reference = asReferenceLike(value);
  const projectId = uuid(reference.objectId, 'projectRef.objectId');
  if (
    reference.kind !== 'OBJECT' ||
    reference.objectType !== 'Project' ||
    reference.scope === undefined ||
    envelope.enterpriseId !== context.enterpriseId ||
    (envelope.projectId !== undefined && envelope.projectId !== projectId) ||
    !context.allowedProjectIds.includes(projectId)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      'projectRef must identify an allowed Project exactly',
    );
  }
  projectScope(value, context.enterpriseId, projectId, 'projectRef');
  return projectId;
}

function exactProjectVersionRef(
  value: unknown,
  objectType: string,
  enterpriseId: string,
  projectId: string,
  label: string,
): ProjectVersionReference {
  rejectLatest(value, label);
  const reference = asReferenceLike(value);
  const objectId = uuid(reference.objectId, `${label}.objectId`);
  const versionId = uuid(reference.versionId, `${label}.versionId`);
  if (reference.kind !== 'VERSIONED' || reference.objectType !== objectType) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      `${label} must be an exact ${objectType} VersionedRef`,
    );
  }
  projectScope(value, enterpriseId, projectId, label);
  return {
    ref: canonicalObject(value, label),
    objectType,
    objectId,
    versionId,
    targetPayloadHash: optionalReferenceHash(value, `${label}.contentHash`),
  };
}

function exactEnterpriseVersionRef(
  value: unknown,
  objectType: string,
  enterpriseId: string,
  label: string,
): EnterpriseVersionReference {
  rejectLatest(value, label);
  const reference = asReferenceLike(value);
  const objectId = uuid(reference.objectId, `${label}.objectId`);
  const versionId = uuid(reference.versionId, `${label}.versionId`);
  if (reference.kind !== 'VERSIONED' || reference.objectType !== objectType) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      `${label} must be an exact ${objectType} VersionedRef`,
    );
  }
  enterpriseScope(value, enterpriseId, label);
  return {
    ref: canonicalObject(value, label),
    objectType,
    objectId,
    versionId,
    targetPayloadHash: optionalReferenceHash(value, `${label}.contentHash`),
  };
}

function exactEnterpriseSnapshotRef(
  value: unknown,
  objectType: string,
  enterpriseId: string,
  label: string,
): EnterpriseSnapshotReference {
  rejectLatest(value, label);
  const reference = asReferenceLike(value);
  const objectId = uuid(reference.objectId, `${label}.objectId`);
  const snapshotId = uuid(reference.snapshotId, `${label}.snapshotId`);
  if (reference.kind !== 'SNAPSHOT' || reference.objectType !== objectType) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      `${label} must be an exact ${objectType} SnapshotRef`,
    );
  }
  enterpriseScope(value, enterpriseId, label);
  return {
    ref: canonicalObject(value, label),
    objectType,
    objectId,
    snapshotId,
    targetPayloadHash: referenceHash(value, `${label}.contentHash`),
  };
}

function exactContentAddressedRef(
  value: unknown,
  objectType: string,
  enterpriseId: string,
  projectId: string,
  label: string,
): ProjectVersionReference {
  rejectLatest(value, label);
  const reference = asReferenceLike(value);
  const objectId = uuid(reference.objectId, `${label}.objectId`);
  if (reference.kind !== 'CONTENT_ADDRESSED' || reference.objectType !== objectType) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_APPROVAL_DECISION_INVALID,
      `${label} must be an exact ${objectType} ContentAddressedRef`,
    );
  }
  projectScope(value, enterpriseId, projectId, label);
  return {
    ref: canonicalObject(value, label),
    objectType,
    objectId,
    versionId: objectId,
    targetPayloadHash: referenceHash(value, `${label}.contentHash`),
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

function deliveryPlanRef(
  enterpriseId: string,
  projectId: string,
  deliveryPlanId: string,
  versionId: string,
): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'DeliveryPlan',
    objectId: deliveryPlanId,
    versionId,
    scope: { enterpriseId, projectId },
  };
}

function deliveryItemRef(
  enterpriseId: string,
  projectId: string,
  deliveryItemId: string,
  versionId: string,
): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'DeliveryItem',
    objectId: deliveryItemId,
    versionId,
    scope: { enterpriseId, projectId },
  };
}

function decisionRef(
  enterpriseId: string,
  projectId: string,
  decisionId: string,
  payloadHash: Buffer,
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'BusinessDecision',
    objectId: decisionId,
    scope: { enterpriseId, projectId },
    contentHash: hashRef(payloadHash),
  };
}

function validateJustification(
  value: unknown,
  enterpriseId: string,
  projectId: string,
): CanonicalJsonObject {
  const justification = asReferenceLike(value);
  const reasonCode = nonEmpty(
    justification.reasonCode,
    'justification.reasonCode',
    PROJECT_DELIVERY_REFERENCE_INVALID,
  );
  const summary = nonEmpty(
    justification.summary,
    'justification.summary',
    PROJECT_DELIVERY_REFERENCE_INVALID,
  );
  if (!Array.isArray(justification.evidenceRefs)) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      'justification.evidenceRefs must be an array',
    );
  }
  const evidenceRefs = justification.evidenceRefs.map((candidate, index) => {
    rejectLatest(candidate, `justification.evidenceRefs[${index}]`);
    const evidence = canonicalObject(candidate, `justification.evidenceRefs[${index}]`);
    const scope = asReferenceLike(asReferenceLike(candidate).scope);
    if (scope.enterpriseId !== undefined) {
      if (
        scope.enterpriseId !== enterpriseId ||
        (scope.projectId !== undefined && scope.projectId !== projectId)
      ) {
        throw new EnterpriseBusinessError(
          PROJECT_DELIVERY_REFERENCE_INVALID,
          `justification.evidenceRefs[${index}] crosses the trusted scope`,
        );
      }
    }
    return evidence;
  });
  return { reasonCode, summary, evidenceRefs };
}

function validateStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new EnterpriseBusinessError(PROJECT_DELIVERY_ITEM_INVALID, `${label} must be an array`);
  }
  return value.map((candidate, index) => nonEmpty(candidate, `${label}[${index}]`));
}

function validateItemDefinitions(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  acceptedGapVersionId: string,
): readonly NormalizedDeliveryItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_ITEM_INVALID,
      'items must be a non-empty array',
    );
  }
  const itemIds = new Set<string>();
  const itemKeys = new Set<string>();
  const items = value.map((candidate, index) => {
    const label = `items[${index}]`;
    const item = asReferenceLike(candidate);
    const itemId = uuid(item.itemId, `${label}.itemId`, PROJECT_DELIVERY_ITEM_INVALID);
    const itemKey = nonEmpty(item.itemKey, `${label}.itemKey`);
    if (itemIds.has(itemId) || itemKeys.has(itemKey)) {
      throw new EnterpriseBusinessError(
        PROJECT_DELIVERY_ITEM_KEY_CONFLICT,
        'itemId and itemKey must be unique within a Plan Version',
      );
    }
    itemIds.add(itemId);
    itemKeys.add(itemKey);
    const itemType = nonEmpty(item.itemType, `${label}.itemType`);
    const title = nonEmpty(item.title, `${label}.title`);
    const objective = nonEmpty(item.objective, `${label}.objective`);
    if (!Array.isArray(item.sourceGapItemRefs) || item.sourceGapItemRefs.length === 0) {
      throw new EnterpriseBusinessError(
        PROJECT_DELIVERY_ITEM_INVALID,
        `${label}.sourceGapItemRefs must be non-empty`,
      );
    }
    const sourceGapItemRefs = item.sourceGapItemRefs.map((candidate, sourceIndex) => {
      const reference = exactProjectVersionRef(
        candidate,
        'GapItem',
        enterpriseId,
        projectId,
        `${label}.sourceGapItemRefs[${sourceIndex}]`,
      );
      if (reference.versionId !== acceptedGapVersionId) {
        throw new EnterpriseBusinessError(
          PROJECT_DELIVERY_GAP_NOT_ACCEPTED,
          'sourceGapItemRefs must belong to the accepted GapAnalysis version',
        );
      }
      return reference;
    });
    const sourceKeys = new Set(
      sourceGapItemRefs.map((reference) => `${reference.objectId}:${reference.versionId}`),
    );
    if (sourceKeys.size !== sourceGapItemRefs.length) {
      throw new EnterpriseBusinessError(
        PROJECT_DELIVERY_ITEM_INVALID,
        `${label}.sourceGapItemRefs must be unique`,
      );
    }
    if (!Array.isArray(item.dependencyItemIds)) {
      throw new EnterpriseBusinessError(
        PROJECT_DELIVERY_ITEM_INVALID,
        `${label}.dependencyItemIds must be an array`,
      );
    }
    const dependencyItemIds = item.dependencyItemIds.map((candidate, dependencyIndex) =>
      uuid(
        candidate,
        `${label}.dependencyItemIds[${dependencyIndex}]`,
        PROJECT_DELIVERY_ITEM_INVALID,
      ),
    );
    if (new Set(dependencyItemIds).size !== dependencyItemIds.length) {
      throw new EnterpriseBusinessError(
        PROJECT_DELIVERY_ITEM_INVALID,
        `${label}.dependencyItemIds must be unique`,
      );
    }
    const targetArtifactTypes = validateStringArray(
      item.targetArtifactTypes,
      `${label}.targetArtifactTypes`,
    );
    if (new Set(targetArtifactTypes).size !== targetArtifactTypes.length) {
      throw new EnterpriseBusinessError(
        PROJECT_DELIVERY_ITEM_INVALID,
        `${label}.targetArtifactTypes must be unique`,
      );
    }
    const qualityProfileRef = exactProjectVersionRef(
      item.qualityProfileRef,
      'QualityProfile',
      enterpriseId,
      projectId,
      `${label}.qualityProfileRef`,
    );
    if (item.commitmentStatus !== 'PROPOSED') {
      throw new EnterpriseBusinessError(
        PROJECT_DELIVERY_ITEM_INVALID,
        `${label}.commitmentStatus must start as PROPOSED`,
      );
    }
    const completionCriteria = asCanonicalJson(
      item.completionCriteria,
      `${label}.completionCriteria`,
    );
    if (asReferenceLike(completionCriteria).profile !== undefined) {
      try {
        exactCompletionCriteria(completionCriteria, { enterpriseId, projectId });
      } catch {
        throw new EnterpriseBusinessError(
          PROJECT_DELIVERY_ITEM_INVALID,
          'Invalid exact completion criteria',
        );
      }
    }
    const dueConstraint =
      item.dueConstraint === undefined
        ? undefined
        : asCanonicalJson(item.dueConstraint, `${label}.dueConstraint`);
    const criteriaHash = digestCanonicalPayload({ criteria: completionCriteria }).hash;
    const normalizedValue = {
      itemId,
      itemKey,
      itemType,
      title,
      objective,
      sourceGapItemRefs: sourceGapItemRefs.map((reference) => reference.ref),
      dependencyItemIds,
      targetArtifactTypes,
      qualityProfileRef: qualityProfileRef.ref,
      completionCriteria,
      ...(dueConstraint === undefined ? {} : { dueConstraint }),
      commitmentStatus: 'PROPOSED',
    } as unknown as CanonicalJsonObject;
    return {
      value: normalizedValue,
      itemId,
      itemKey,
      itemType,
      title,
      objective,
      sourceGapItemRefs,
      dependencyItemIds,
      targetArtifactTypes,
      qualityProfileRef,
      completionCriteria,
      ...(dueConstraint === undefined ? {} : { dueConstraint }),
      criteriaHash,
    } satisfies NormalizedDeliveryItem;
  });

  const itemIdSet = new Set(items.map((item) => item.itemId));
  for (const item of items) {
    for (const dependencyId of item.dependencyItemIds) {
      if (!itemIdSet.has(dependencyId)) {
        throw new EnterpriseBusinessError(
          PROJECT_DELIVERY_ITEM_INVALID,
          'dependencyItemIds must reference items in the same Plan Version',
        );
      }
      if (dependencyId === item.itemId) {
        throw new EnterpriseBusinessError(
          PROJECT_DELIVERY_DEPENDENCY_CYCLE,
          'a DeliveryItem cannot depend on itself',
        );
      }
    }
  }
  const graph = new Map(items.map((item) => [item.itemId, item.dependencyItemIds]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (itemId: string): void => {
    if (visiting.has(itemId)) {
      throw new EnterpriseBusinessError(
        PROJECT_DELIVERY_DEPENDENCY_CYCLE,
        'DeliveryItem dependencies must form an acyclic graph',
      );
    }
    if (visited.has(itemId)) return;
    visiting.add(itemId);
    for (const dependencyId of graph.get(itemId) ?? []) visit(dependencyId);
    visiting.delete(itemId);
    visited.add(itemId);
  };
  for (const item of items) visit(item.itemId);
  return items;
}

function targetPayloadHash(value: unknown): Buffer | undefined {
  const hash = asReferenceLike(asReferenceLike(value).contentHash);
  return typeof hash.digest === 'string' && /^[0-9a-f]{64}$/i.test(hash.digest)
    ? Buffer.from(hash.digest.toLowerCase(), 'hex')
    : undefined;
}

function targetModule(objectType: string): string {
  return objectType === 'Policy' || objectType === 'QualityProfile'
    ? 'quality-governance'
    : 'enterprise-project';
}

async function appendReference(
  execution: Pick<CommandExecution, 'appendReferenceEdge'>,
  planId: string,
  versionId: string,
  ownerPayloadHash: Buffer,
  reference: unknown,
  referencePath: string,
  purpose: string,
): Promise<void> {
  const wrapper = asReferenceLike(reference);
  const target = wrapper.ref ?? reference;
  const facts = asReferenceLike(target);
  const objectType = typeof facts.objectType === 'string' ? facts.objectType : '';
  const objectId = typeof facts.objectId === 'string' ? facts.objectId : '';
  const versionIdTarget =
    typeof facts.versionId === 'string'
      ? facts.versionId
      : typeof facts.snapshotId === 'string'
        ? facts.snapshotId
        : undefined;
  await execution.appendReferenceEdge({
    ownerObjectType: 'DeliveryPlan',
    ownerObjectId: planId,
    ownerVersionId: versionId,
    ownerPayloadHash,
    referencePath,
    targetModule: targetModule(objectType),
    targetObjectType: objectType,
    targetObjectId: objectId,
    targetVersionId: versionIdTarget,
    targetPayloadHash: targetPayloadHash(target),
    referencePurpose: purpose,
  });
}

function safeRejection(error: EnterpriseBusinessError, currentAggregateVersion?: string) {
  return {
    kind: 'REJECTED' as const,
    errorCode: error.code,
    safeSummary: error.message,
    ...(currentAggregateVersion === undefined ? {} : { currentAggregateVersion }),
  };
}

function scalarString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  throw new Error('database value must be a scalar stringable value');
}

function aggregateVersion(value: unknown): string {
  return scalarString(value);
}

function containsActingFor(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsActingFor(item, seen));
  return Object.entries(value).some(
    ([key, child]) =>
      key === 'actingFor' || key === 'actingForRef' || containsActingFor(child, seen),
  );
}

function assertHumanApproval(
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
  payload: unknown,
): void {
  if (
    context.principalKind !== 'HUMAN' ||
    envelope.principalKind !== 'HUMAN' ||
    containsActingFor(envelope) ||
    containsActingFor(payload)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_PLAN_HUMAN_APPROVAL_REQUIRED,
      'DeliveryPlan approval is Human-only and cannot use actingFor',
    );
  }
}

function assertActivationAuthority(
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
  payload: unknown,
): void {
  const allowedPrincipal = context.principalKind === 'HUMAN' || context.principalKind === 'SERVICE';
  if (
    !allowedPrincipal ||
    envelope.principalKind !== context.principalKind ||
    containsActingFor(envelope) ||
    containsActingFor(payload)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_PLAN_HUMAN_APPROVAL_REQUIRED,
      'DeliveryPlan activation requires a trusted Human or exact Human approval execution',
    );
  }
}

function activationInstant(value: unknown): Date {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      'activatedAt must be a valid UTC instant',
    );
  }
  return new Date(value);
}

function assertStoredHash(
  reference: ProjectVersionReference | EnterpriseSnapshotReference,
  storedHash: Buffer,
  label: string,
): void {
  if (
    reference.targetPayloadHash !== undefined &&
    !reference.targetPayloadHash.equals(storedHash)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      `${label} content hash does not match the stored fact`,
    );
  }
}

async function resolveBaselineReferences(
  trx: EnterpriseProjectTransaction,
  context: EnterpriseProjectTransactionContext,
  projectId: string,
  value: unknown,
): Promise<readonly BaselineReference[]> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      'baselineRefs must be a non-empty array',
    );
  }
  const seen = new Set<string>();
  const resolved: BaselineReference[] = [];
  for (const [index, candidate] of value.entries()) {
    const facts = asReferenceLike(candidate);
    const objectType = facts.objectType;
    let reference: BaselineReference;
    if (
      objectType === 'CustomerBaseline' ||
      objectType === 'TemplateBaseline' ||
      objectType === 'RegulatoryProfile'
    ) {
      reference = exactProjectVersionRef(
        candidate,
        objectType,
        context.enterpriseId,
        projectId,
        `baselineRefs[${index}]`,
      );
    } else if (objectType === 'QMSConfiguration') {
      reference = exactEnterpriseVersionRef(
        candidate,
        'QMSConfiguration',
        context.enterpriseId,
        `baselineRefs[${index}]`,
      );
    } else if (objectType === 'ProductScopeSnapshot') {
      reference = exactEnterpriseSnapshotRef(
        candidate,
        'ProductScopeSnapshot',
        context.enterpriseId,
        `baselineRefs[${index}]`,
      );
    } else {
      throw new EnterpriseBusinessError(
        PROJECT_DELIVERY_REFERENCE_INVALID,
        'baselineRefs contains an unsupported reference type',
      );
    }
    const key = `${reference.objectType}:${reference.objectId}:${
      'versionId' in reference ? reference.versionId : reference.snapshotId
    }`;
    if (seen.has(key)) {
      throw new EnterpriseBusinessError(
        PROJECT_DELIVERY_REFERENCE_INVALID,
        'baselineRefs must contain unique exact references',
      );
    }
    seen.add(key);

    if (reference.objectType === 'CustomerBaseline') {
      if (!('versionId' in reference)) throw new Error('customer baseline ref shape');
      const root = await repo.getCustomerBaselineById(trx, reference.objectId);
      const version = await repo.getCustomerBaselineVersion(trx, reference.versionId);
      if (
        root?.enterprise_id !== context.enterpriseId ||
        root.project_id !== projectId ||
        root.current_version_id !== reference.versionId ||
        root.active_version_id !== reference.versionId ||
        version?.customer_baseline_id !== reference.objectId ||
        version.enterprise_id !== context.enterpriseId ||
        version.project_id !== projectId ||
        version.version_status !== 'CONFIRMED'
      ) {
        throw new EnterpriseBusinessError(
          PROJECT_DELIVERY_REFERENCE_INVALID,
          'CustomerBaseline ref must identify the exact active CONFIRMED version',
        );
      }
      assertStoredHash(reference, version.payload_hash, 'CustomerBaseline ref');
    } else if (reference.objectType === 'TemplateBaseline') {
      if (!('versionId' in reference)) throw new Error('template baseline ref shape');
      const root = await repo.getTemplateBaselineById(trx, reference.objectId);
      const version = await repo.getTemplateBaselineVersion(trx, reference.versionId);
      if (
        root?.enterprise_id !== context.enterpriseId ||
        root.project_id !== projectId ||
        root.current_version_id !== reference.versionId ||
        root.active_version_id !== reference.versionId ||
        version?.template_baseline_id !== reference.objectId ||
        version.enterprise_id !== context.enterpriseId ||
        version.project_id !== projectId ||
        scalarString(version.version_status) !== 'FROZEN'
      ) {
        throw new EnterpriseBusinessError(
          PROJECT_DELIVERY_REFERENCE_INVALID,
          'TemplateBaseline ref must identify the exact active FROZEN version',
        );
      }
      assertStoredHash(reference, version.payload_hash, 'TemplateBaseline ref');
    } else if (reference.objectType === 'RegulatoryProfile') {
      if (!('versionId' in reference)) throw new Error('regulatory profile ref shape');
      const root = await repo.getRegulatoryProfileById(trx, reference.objectId);
      const version = await repo.getRegulatoryProfileVersion(trx, reference.versionId);
      if (
        root?.enterprise_id !== context.enterpriseId ||
        root.project_id !== projectId ||
        root.current_version_id !== reference.versionId ||
        root.active_version_id !== reference.versionId ||
        version?.regulatory_profile_id !== reference.objectId ||
        version.enterprise_id !== context.enterpriseId ||
        version.project_id !== projectId ||
        scalarString(version.version_status) !== 'FROZEN'
      ) {
        throw new EnterpriseBusinessError(
          PROJECT_DELIVERY_REFERENCE_INVALID,
          'RegulatoryProfile ref must identify the exact active FROZEN version',
        );
      }
      assertStoredHash(reference, version.payload_hash, 'RegulatoryProfile ref');
    } else if (reference.objectType === 'QMSConfiguration') {
      if (!('versionId' in reference)) throw new Error('QMS ref shape');
      const root = await repo.getQmsConfigurationById(trx, reference.objectId);
      const revision = await repo.getQmsConfigurationRevision(trx, reference.versionId);
      if (
        root?.enterprise_id !== context.enterpriseId ||
        root.status !== 'ACTIVE' ||
        root.current_revision_id !== reference.versionId ||
        revision?.qms_configuration_id !== reference.objectId ||
        revision.enterprise_id !== context.enterpriseId ||
        revision.lifecycle !== 'CURRENT'
      ) {
        throw new EnterpriseBusinessError(
          PROJECT_DELIVERY_REFERENCE_INVALID,
          'QMSConfiguration ref must identify the exact current revision',
        );
      }
      assertStoredHash(reference, revision.payload_hash, 'QMSConfiguration ref');
    } else {
      if (!('snapshotId' in reference)) throw new Error('ProductScopeSnapshot ref shape');
      const product = await repo.getProductById(trx, reference.objectId);
      const snapshot = await repo.getProductScopeSnapshot(trx, reference.snapshotId);
      if (
        product?.enterprise_id !== context.enterpriseId ||
        product.status !== 'ACTIVE' ||
        snapshot?.product_id !== reference.objectId ||
        snapshot.enterprise_id !== context.enterpriseId
      ) {
        throw new EnterpriseBusinessError(
          PROJECT_DELIVERY_REFERENCE_INVALID,
          'ProductScopeSnapshot ref must identify an exact active product snapshot',
        );
      }
      assertStoredHash(reference, snapshot.payload_hash, 'ProductScopeSnapshot ref');
    }
    resolved.push(reference);
  }
  return resolved;
}

async function resolveAcceptedGap(
  trx: EnterpriseProjectTransaction,
  context: EnterpriseProjectTransactionContext,
  projectId: string,
  value: unknown,
): Promise<{
  reference: ProjectVersionReference;
  findings: ReadonlySet<string>;
  input: {
    customer_baseline_id: string;
    customer_baseline_version_id: string;
    template_baseline_id: string;
    template_baseline_version_id: string;
    regulatory_profile_id: string;
    regulatory_profile_version_id: string;
    qms_configuration_id: string;
    qms_configuration_revision_id: string;
    product_scope_snapshot_id: string;
    product_scope_snapshot_ref: unknown;
  };
}> {
  const reference = exactProjectVersionRef(
    value,
    'GapAnalysis',
    context.enterpriseId,
    projectId,
    'acceptedGapAnalysisRef',
  );
  const root = await repo.getGapAnalysisById(trx, reference.objectId);
  const version = await repo.getGapAnalysisVersion(trx, reference.versionId);
  const input = version
    ? await repo.getGapAnalysisInputSnapshot(trx, version.input_snapshot_id)
    : undefined;
  if (input === undefined) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_GAP_NOT_ACCEPTED,
      'acceptedGapAnalysisRef must identify the exact ACCEPTED GapAnalysis input snapshot',
    );
  }
  if (
    root?.enterprise_id !== context.enterpriseId ||
    root.project_id !== projectId ||
    root.current_version_id !== reference.versionId ||
    root.accepted_version_id !== reference.versionId ||
    root.status !== 'ACCEPTED' ||
    version?.gap_analysis_id !== reference.objectId ||
    version.enterprise_id !== context.enterpriseId ||
    version.project_id !== projectId ||
    version.version_status !== 'ACCEPTED' ||
    input.gap_analysis_id !== reference.objectId ||
    input.version_id !== reference.versionId ||
    input.enterprise_id !== context.enterpriseId ||
    input.project_id !== projectId
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_GAP_NOT_ACCEPTED,
      'acceptedGapAnalysisRef must identify the exact ACCEPTED GapAnalysis version',
    );
  }
  const findings = await repo.getGapFindings(trx, reference.versionId);
  return {
    reference,
    findings: new Set(findings.map((finding) => finding.finding_id)),
    input,
  };
}

function assertBaselineReferencesMatchAcceptedGap(
  references: readonly BaselineReference[],
  input: {
    customer_baseline_id: string;
    customer_baseline_version_id: string;
    template_baseline_id: string;
    template_baseline_version_id: string;
    regulatory_profile_id: string;
    regulatory_profile_version_id: string;
    qms_configuration_id: string;
    qms_configuration_revision_id: string;
    product_scope_snapshot_id: string;
    product_scope_snapshot_ref: unknown;
  },
): void {
  const expected = new Set([
    `CustomerBaseline:${input.customer_baseline_id}:${input.customer_baseline_version_id}`,
    `TemplateBaseline:${input.template_baseline_id}:${input.template_baseline_version_id}`,
    `RegulatoryProfile:${input.regulatory_profile_id}:${input.regulatory_profile_version_id}`,
    `QMSConfiguration:${input.qms_configuration_id}:${input.qms_configuration_revision_id}`,
    `ProductScopeSnapshot:${String(asReferenceLike(input.product_scope_snapshot_ref).objectId)}:${input.product_scope_snapshot_id}`,
  ]);
  if (references.length !== expected.size) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      'baselineRefs must include exactly the five accepted GapAnalysis baseline references',
    );
  }
  for (const reference of references) {
    const target = asReferenceLike(reference.ref);
    const targetVersion =
      typeof target.versionId === 'string'
        ? target.versionId
        : typeof target.snapshotId === 'string'
          ? target.snapshotId
          : '';
    const key = `${reference.objectType}:${reference.objectId}:${targetVersion}`;
    if (!expected.has(key)) {
      throw new EnterpriseBusinessError(
        PROJECT_DELIVERY_REFERENCE_INVALID,
        'baselineRefs must match the accepted GapAnalysis InputSnapshot exactly',
      );
    }
  }
}

async function appendDraftReferenceEdges(
  execution: Pick<CommandExecution, 'appendReferenceEdge'>,
  context: EnterpriseProjectTransactionContext,
  projectId: string,
  planId: string,
  versionId: string,
  planPayloadHash: Buffer,
  gapReference: ProjectVersionReference,
  baselineReferences: readonly BaselineReference[],
  policyReference: ProjectVersionReference,
  items: readonly NormalizedDeliveryItem[],
): Promise<void> {
  await appendReference(
    execution,
    planId,
    versionId,
    planPayloadHash,
    projectRef(context.enterpriseId, projectId),
    '/projectRef',
    'DELIVERY_PLAN_PROJECT',
  );
  await appendReference(
    execution,
    planId,
    versionId,
    planPayloadHash,
    gapReference,
    '/acceptedGapAnalysisRef',
    'DELIVERY_PLAN_ACCEPTED_GAP',
  );
  for (const [index, reference] of baselineReferences.entries()) {
    await appendReference(
      execution,
      planId,
      versionId,
      planPayloadHash,
      reference,
      `/baselineRefs/${index}`,
      'DELIVERY_PLAN_BASELINE',
    );
  }
  await appendReference(
    execution,
    planId,
    versionId,
    planPayloadHash,
    policyReference,
    '/planQualityPolicyRef',
    'DELIVERY_PLAN_QUALITY_POLICY',
  );
  for (const [itemIndex, item] of items.entries()) {
    await appendReference(
      execution,
      planId,
      versionId,
      planPayloadHash,
      item.qualityProfileRef,
      `/items/${itemIndex}/qualityProfileRef`,
      'DELIVERY_ITEM_QUALITY_PROFILE',
    );
    for (const [sourceIndex, reference] of item.sourceGapItemRefs.entries()) {
      await appendReference(
        execution,
        planId,
        versionId,
        planPayloadHash,
        reference,
        `/items/${itemIndex}/sourceGapItemRefs/${sourceIndex}`,
        'DELIVERY_ITEM_SOURCE_GAP',
      );
    }
  }
}

const repo = new DeliveryPlanRepository();
const completionRepo = new DeliveryItemCompletionRepository();

export async function handleCreateDeliveryPlanDraft(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: CreatePayload },
): Promise<CommandResult> {
  const projectId = exactProjectRef(envelope.payload.projectRef, context, envelope);
  const deliveryPlanId = uuid(envelope.targetId, 'DeliveryPlan targetId');
  if (envelope.targetType !== 'DeliveryPlan') {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'create_delivery_plan_draft target must be a DeliveryPlan root',
    );
  }
  if (envelope.expectedAggregateVersion !== undefined) {
    throw new CommandExecutionError(
      CONCURRENCY_CONFLICT,
      'a new DeliveryPlan root cannot carry an expected aggregate version',
    );
  }
  const gapReference = exactProjectVersionRef(
    envelope.payload.acceptedGapAnalysisRef,
    'GapAnalysis',
    context.enterpriseId,
    projectId,
    'acceptedGapAnalysisRef',
  );
  const planQualityPolicyRef = exactProjectVersionRef(
    envelope.payload.planQualityPolicyRef,
    'Policy',
    context.enterpriseId,
    projectId,
    'planQualityPolicyRef',
  );
  const items = validateItemDefinitions(
    envelope.payload.items,
    context.enterpriseId,
    projectId,
    gapReference.versionId,
  );
  const assumptions = validateStringArray(envelope.payload.assumptions, 'assumptions');
  const exclusions = validateStringArray(envelope.payload.exclusions, 'exclusions');
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId,
    targetType: 'DeliveryPlan',
    targetId: deliveryPlanId,
  };
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const project = await repo.getProjectById(execution.trx, projectId);
    if (project?.enterprise_id !== context.enterpriseId || project.status !== 'ACTIVE') {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_REFERENCE_INVALID,
          'DeliveryPlan requires an active Project in the trusted scope',
        ),
      );
    }
    if (await repo.getDeliveryPlanById(execution.trx, deliveryPlanId)) {
      return safeRejection(
        new EnterpriseBusinessError(CONCURRENCY_CONFLICT, 'DeliveryPlan target already exists'),
      );
    }
    let acceptedGap: Awaited<ReturnType<typeof resolveAcceptedGap>>;
    let baselineReferences: readonly BaselineReference[];
    try {
      acceptedGap = await resolveAcceptedGap(
        execution.trx,
        context,
        projectId,
        envelope.payload.acceptedGapAnalysisRef,
      );
      baselineReferences = await resolveBaselineReferences(
        execution.trx,
        context,
        projectId,
        envelope.payload.baselineRefs,
      );
      assertBaselineReferencesMatchAcceptedGap(baselineReferences, acceptedGap.input);
      for (const item of items) {
        for (const sourceReference of item.sourceGapItemRefs) {
          if (!acceptedGap.findings.has(sourceReference.objectId)) {
            throw new EnterpriseBusinessError(
              PROJECT_DELIVERY_ITEM_INVALID,
              'sourceGapItemRefs must resolve to an item in the accepted GapAnalysis',
            );
          }
        }
      }
    } catch (error) {
      if (error instanceof EnterpriseBusinessError) return safeRejection(error);
      throw error;
    }
    const versionId = newUuidV7();
    const versionPayload = {
      enterpriseId: context.enterpriseId,
      projectId,
      deliveryPlanId,
      versionId,
      versionNo: 1,
      acceptedGapAnalysisRef: gapReference.ref,
      baselineRefs: baselineReferences.map((reference) => reference.ref),
      items: items.map((item) => item.value),
      assumptions,
      exclusions,
      planQualityPolicyRef: planQualityPolicyRef.ref,
    } as unknown as CanonicalJsonObject;
    const versionDigest = digestCanonicalPayload(versionPayload);
    const insertedRoot = await repo.insertDeliveryPlan(execution.trx, {
      deliveryPlanId,
      enterpriseId: context.enterpriseId,
      projectId,
      currentVersionId: versionId,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      sourceCommandId: envelope.commandId,
    });
    if (!insertedRoot) {
      return safeRejection(
        new EnterpriseBusinessError(
          CONCURRENCY_CONFLICT,
          'another DeliveryPlan root was created for the target id',
        ),
      );
    }
    await repo.insertDeliveryPlanVersion(execution.trx, {
      versionId,
      deliveryPlanId,
      enterpriseId: context.enterpriseId,
      projectId,
      versionNo: 1,
      acceptedGapAnalysisRef: gapReference.ref,
      acceptedGapAnalysisId: gapReference.objectId,
      acceptedGapAnalysisVersionId: gapReference.versionId,
      baselineRefs: baselineReferences.map((reference) => reference.ref),
      assumptions,
      exclusions,
      planQualityPolicyRef: planQualityPolicyRef.ref,
      planQualityPolicyId: planQualityPolicyRef.objectId,
      planQualityPolicyVersionId: planQualityPolicyRef.versionId,
      payload: versionPayload,
      payloadHash: versionDigest.hash,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    for (const item of items) {
      const itemPayload = {
        enterpriseId: context.enterpriseId,
        projectId,
        deliveryPlanId,
        versionId,
        item: item.value,
      } as unknown as CanonicalJsonObject;
      const itemInsert: DeliveryItemInsert = {
        deliveryItemId: item.itemId,
        deliveryPlanId,
        versionId,
        enterpriseId: context.enterpriseId,
        projectId,
        itemKey: item.itemKey,
        itemType: item.itemType,
        title: item.title,
        objective: item.objective,
        sourceGapItemRefs: item.sourceGapItemRefs.map((reference) => reference.ref),
        dependencyItemIds: item.dependencyItemIds,
        targetArtifactTypes: item.targetArtifactTypes,
        qualityProfileRef: item.qualityProfileRef.ref,
        qualityProfileId: item.qualityProfileRef.objectId,
        qualityProfileVersionId: item.qualityProfileRef.versionId,
        completionCriteria: item.completionCriteria,
        ...(item.dueConstraint === undefined ? {} : { dueConstraint: item.dueConstraint }),
        commitmentStatus: 'PROPOSED',
        criteriaHash: item.criteriaHash,
        payload: itemPayload,
        payloadHash: digestCanonicalPayload(itemPayload).hash,
        recordedByPrincipalId: envelope.principalId,
        recordedByActorSnapshotId: envelope.actorSnapshotId,
        authorizationDecisionId: envelope.authorizationDecisionId,
        sourceCommandId: envelope.commandId,
      };
      await repo.insertDeliveryItem(execution.trx, itemInsert);
      for (const artifactType of item.targetArtifactTypes) {
        const acceptanceCriteria = { completionCriteria: item.completionCriteria };
        const releaseCriteria = {};
        const requirementPayload = {
          enterpriseId: context.enterpriseId,
          projectId,
          deliveryPlanId,
          versionId,
          deliveryItemId: item.itemId,
          artifactType,
          purpose: 'DELIVERY_COMPLETION',
          acceptanceCriteria,
          releaseCriteria,
        } as unknown as CanonicalJsonObject;
        await repo.insertDeliveryItemArtifactRequirement(execution.trx, {
          requirementId: newUuidV7(),
          deliveryPlanId,
          versionId,
          deliveryItemId: item.itemId,
          enterpriseId: context.enterpriseId,
          projectId,
          artifactType,
          purpose: 'DELIVERY_COMPLETION',
          acceptanceCriteria,
          releaseCriteria,
          payloadHash: digestCanonicalPayload(requirementPayload).hash,
          recordedByPrincipalId: envelope.principalId,
          recordedByActorSnapshotId: envelope.actorSnapshotId,
          authorizationDecisionId: envelope.authorizationDecisionId,
          sourceCommandId: envelope.commandId,
        });
      }
      for (const dependencyId of item.dependencyItemIds) {
        const dependencyPayload = {
          enterpriseId: context.enterpriseId,
          projectId,
          deliveryPlanId,
          versionId,
          fromItemId: item.itemId,
          toItemId: dependencyId,
          dependencyType: 'BLOCKS',
        } as unknown as CanonicalJsonObject;
        await repo.insertDeliveryItemDependency(execution.trx, {
          deliveryPlanId,
          versionId,
          fromItemId: item.itemId,
          toItemId: dependencyId,
          enterpriseId: context.enterpriseId,
          projectId,
          dependencyType: 'BLOCKS',
          payloadHash: digestCanonicalPayload(dependencyPayload).hash,
          recordedByPrincipalId: envelope.principalId,
          recordedByActorSnapshotId: envelope.actorSnapshotId,
          authorizationDecisionId: envelope.authorizationDecisionId,
          sourceCommandId: envelope.commandId,
        });
      }
    }
    await appendDraftReferenceEdges(
      execution,
      context,
      projectId,
      deliveryPlanId,
      versionId,
      versionDigest.hash,
      gapReference,
      baselineReferences,
      planQualityPolicyRef,
      items,
    );
    const planReference = deliveryPlanRef(
      context.enterpriseId,
      projectId,
      deliveryPlanId,
      versionId,
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        deliveryPlanRef: planReference,
        projectRef: projectRef(context.enterpriseId, projectId),
        itemRefs: items.map((item) =>
          deliveryItemRef(context.enterpriseId, projectId, item.itemId, versionId),
        ),
        status: 'DRAFT',
        versionNo: 1,
        aggregateVersion: '1',
        payloadHash: versionDigest.hash.toString('hex'),
      } as unknown as CanonicalJsonObject,
    };
  });
}

export async function handleApproveDeliveryPlan(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: ApprovePayload },
): Promise<CommandResult> {
  assertHumanApproval(context, envelope, envelope.payload);
  const projectId = projectIdFromReference(
    envelope.payload.deliveryPlanVersionRef,
    context,
    'deliveryPlanVersionRef',
  );
  const planReference = exactProjectVersionRef(
    envelope.payload.deliveryPlanVersionRef,
    'DeliveryPlan',
    context.enterpriseId,
    projectId,
    'deliveryPlanVersionRef',
  );
  if (envelope.targetType !== 'DeliveryPlan' || envelope.targetId !== planReference.objectId) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'deliveryPlanVersionRef must identify the command DeliveryPlan target',
    );
  }
  if (envelope.expectedAggregateVersion === undefined) {
    throw new CommandExecutionError(
      CONCURRENCY_CONFLICT,
      'DeliveryPlan approval requires an expected aggregate version',
    );
  }
  const reviewReference = exactProjectSnapshotRef(
    envelope.payload.reviewSnapshotRef,
    'DeliveryPlanReview',
    context.enterpriseId,
    projectId,
    'reviewSnapshotRef',
  );
  void reviewReference;
  const justification = validateJustification(
    envelope.payload.justification,
    context.enterpriseId,
    projectId,
  );
  if (!['APPROVE', 'CHANGES_REQUIRED', 'REJECT'].includes(envelope.payload.decision)) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_APPROVAL_DECISION_INVALID,
      'decision is not supported',
    );
  }
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId,
    targetType: 'DeliveryPlan',
    targetId: planReference.objectId,
  };
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const root = await repo.getDeliveryPlanByIdForUpdate(execution.trx, planReference.objectId);
    if (root?.enterprise_id !== context.enterpriseId || root.project_id !== projectId) {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_VERSION_NOT_FOUND,
          'DeliveryPlan root was not found in the trusted Project scope',
        ),
      );
    }
    const currentAggregateVersion = aggregateVersion(root.aggregate_version);
    if (currentAggregateVersion !== normalizedEnvelope.expectedAggregateVersion) {
      return safeRejection(
        new EnterpriseBusinessError(
          CONCURRENCY_CONFLICT,
          'DeliveryPlan approval expected aggregate version is stale',
        ),
        currentAggregateVersion,
      );
    }
    if (root.current_version_id !== planReference.versionId) {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_PLAN_IMMUTABLE,
          'only the current DeliveryPlan version can be approved',
        ),
        currentAggregateVersion,
      );
    }
    const version = await repo.getDeliveryPlanVersion(execution.trx, planReference.versionId);
    if (
      version?.delivery_plan_id !== planReference.objectId ||
      version.enterprise_id !== context.enterpriseId ||
      version.project_id !== projectId
    ) {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_VERSION_NOT_FOUND,
          'deliveryPlanVersionRef does not identify the exact stored version',
        ),
        currentAggregateVersion,
      );
    }
    if (version.version_status !== 'DRAFT') {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_PLAN_IMMUTABLE,
          'DeliveryPlan version is not available for a first Human decision',
        ),
        currentAggregateVersion,
      );
    }
    const decisionId = newUuidV7();
    const decisionPayload = {
      enterpriseId: context.enterpriseId,
      projectId,
      deliveryPlanId: planReference.objectId,
      versionId: planReference.versionId,
      reviewSnapshotRef: envelope.payload.reviewSnapshotRef,
      decision: envelope.payload.decision,
      justification,
    } as unknown as CanonicalJsonObject;
    const decisionDigest = digestCanonicalPayload(decisionPayload);
    await repo.insertDeliveryPlanDecision(execution.trx, {
      decisionId,
      deliveryPlanId: planReference.objectId,
      versionId: planReference.versionId,
      enterpriseId: context.enterpriseId,
      projectId,
      reviewSnapshotRef: envelope.payload.reviewSnapshotRef,
      decision: envelope.payload.decision,
      justification,
      payload: decisionPayload,
      payloadHash: decisionDigest.hash,
      decidedByPrincipalId: normalizedEnvelope.principalId,
      decidedByActorSnapshotId: normalizedEnvelope.actorSnapshotId,
      authorizationDecisionId: normalizedEnvelope.authorizationDecisionId,
      sourceCommandId: normalizedEnvelope.commandId,
    });
    const approved = envelope.payload.decision === 'APPROVE';
    const nextStatus = approved
      ? ('APPROVED' as const)
      : envelope.payload.decision === 'REJECT'
        ? ('REJECTED' as const)
        : ('CHANGES_REQUIRED' as const);
    const versionUpdated = await repo.transitionDeliveryPlanVersion(
      execution.trx,
      planReference.versionId,
      nextStatus,
      approved
        ? {
            approvalDecisionId: decisionId,
            approvedByPrincipalId: normalizedEnvelope.principalId,
            approvedByActorSnapshotId: normalizedEnvelope.actorSnapshotId,
            approvedAt: new Date(),
          }
        : {},
    );
    if (!versionUpdated) {
      throw new CommandExecutionError(
        CONCURRENCY_CONFLICT,
        'DeliveryPlan version decision lost its transition race',
      );
    }
    const casPatch: DeliveryPlanCasPatch = {
      status: nextStatus,
      approvedVersionId: approved ? planReference.versionId : null,
      activeVersionId: null,
      sourceCommandId: normalizedEnvelope.commandId,
    };
    const cas = await repo.casDeliveryPlan(
      execution.trx,
      planReference.objectId,
      normalizedEnvelope.expectedAggregateVersion,
      casPatch,
    );
    if (!cas.ok) {
      throw new CommandExecutionError(
        CONCURRENCY_CONFLICT,
        'DeliveryPlan approval lost the Root CAS race',
      );
    }
    await appendReference(
      execution,
      planReference.objectId,
      planReference.versionId,
      version.payload_hash,
      envelope.payload.reviewSnapshotRef,
      '/reviewSnapshotRef',
      'DELIVERY_PLAN_REVIEW',
    );
    await appendReference(
      execution,
      planReference.objectId,
      planReference.versionId,
      version.payload_hash,
      decisionRef(context.enterpriseId, projectId, decisionId, decisionDigest.hash),
      '/approvalDecision',
      'DELIVERY_PLAN_DECISION',
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        deliveryPlanRef: deliveryPlanRef(
          context.enterpriseId,
          projectId,
          planReference.objectId,
          planReference.versionId,
        ),
        approvalDecisionRef: decisionRef(
          context.enterpriseId,
          projectId,
          decisionId,
          decisionDigest.hash,
        ),
        decision: envelope.payload.decision,
        status: nextStatus,
        aggregateVersion: cas.nextVersion,
      } as unknown as CanonicalJsonObject,
    };
  });
}

function exactProjectSnapshotRef(
  value: unknown,
  objectType: string,
  enterpriseId: string,
  projectId: string,
  label: string,
): CanonicalJsonObject {
  rejectLatest(value, label);
  const reference = asReferenceLike(value);
  uuid(reference.objectId, `${label}.objectId`);
  uuid(reference.snapshotId, `${label}.snapshotId`);
  if (reference.kind !== 'SNAPSHOT' || reference.objectType !== objectType) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_REFERENCE_INVALID,
      `${label} must be an exact ${objectType} SnapshotRef`,
    );
  }
  projectScope(value, enterpriseId, projectId, label);
  referenceHash(value, `${label}.contentHash`);
  return canonicalObject(value, label);
}

export async function handleActivateDeliveryPlan(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: ActivatePayload },
): Promise<CommandResult> {
  assertActivationAuthority(context, envelope, envelope.payload);
  const projectId = projectIdFromReference(
    envelope.payload.deliveryPlanVersionRef,
    context,
    'deliveryPlanVersionRef',
  );
  const planReference = exactProjectVersionRef(
    envelope.payload.deliveryPlanVersionRef,
    'DeliveryPlan',
    context.enterpriseId,
    projectId,
    'deliveryPlanVersionRef',
  );
  if (envelope.targetType !== 'DeliveryPlan' || envelope.targetId !== planReference.objectId) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'deliveryPlanVersionRef must identify the command DeliveryPlan target',
    );
  }
  if (envelope.expectedAggregateVersion === undefined) {
    throw new CommandExecutionError(
      CONCURRENCY_CONFLICT,
      'DeliveryPlan activation requires an expected aggregate version',
    );
  }
  const approvalReference = exactContentAddressedRef(
    envelope.payload.approvalDecisionRef,
    'BusinessDecision',
    context.enterpriseId,
    projectId,
    'approvalDecisionRef',
  );
  const impactPolicyReference = exactProjectVersionRef(
    envelope.payload.impactPolicyRef,
    'Policy',
    context.enterpriseId,
    projectId,
    'impactPolicyRef',
  );
  const activatedAt = activationInstant(envelope.payload.activatedAt);
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId,
    targetType: 'DeliveryPlan',
    targetId: planReference.objectId,
  };
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const project = await repo.getProjectByIdForUpdate(execution.trx, projectId);
    if (project?.enterprise_id !== context.enterpriseId || project.status !== 'ACTIVE') {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_REFERENCE_INVALID,
          'DeliveryPlan activation requires an active Project in the trusted scope',
        ),
      );
    }
    const root = await repo.getDeliveryPlanByIdForUpdate(execution.trx, planReference.objectId);
    if (root?.enterprise_id !== context.enterpriseId || root.project_id !== projectId) {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_VERSION_NOT_FOUND,
          'DeliveryPlan root was not found in the trusted Project scope',
        ),
      );
    }
    const currentAggregateVersion = aggregateVersion(root.aggregate_version);
    if (currentAggregateVersion !== normalizedEnvelope.expectedAggregateVersion) {
      return safeRejection(
        new EnterpriseBusinessError(
          CONCURRENCY_CONFLICT,
          'DeliveryPlan activation expected aggregate version is stale',
        ),
        currentAggregateVersion,
      );
    }
    if (
      root.current_version_id !== planReference.versionId ||
      root.approved_version_id !== planReference.versionId ||
      root.status !== 'APPROVED'
    ) {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_PLAN_IMMUTABLE,
          'only the exact APPROVED DeliveryPlan version can be activated',
        ),
        currentAggregateVersion,
      );
    }
    const version = await repo.getDeliveryPlanVersion(execution.trx, planReference.versionId);
    if (
      version?.delivery_plan_id !== planReference.objectId ||
      version.enterprise_id !== context.enterpriseId ||
      version.project_id !== projectId ||
      version.version_status !== 'APPROVED' ||
      version.approval_decision_id !== approvalReference.objectId
    ) {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_APPROVAL_DECISION_INVALID,
          'approvalDecisionRef does not identify the exact approval for this Plan Version',
        ),
        currentAggregateVersion,
      );
    }
    const decision = await repo.getDeliveryPlanDecision(execution.trx, approvalReference.objectId);
    if (
      decision?.delivery_plan_id !== planReference.objectId ||
      decision.version_id !== planReference.versionId ||
      decision.enterprise_id !== context.enterpriseId ||
      decision.project_id !== projectId ||
      decision.decision !== 'APPROVE' ||
      scalarString(decision.decided_by_principal_kind) !== 'HUMAN' ||
      !decision.payload_hash.equals(approvalReference.targetPayloadHash ?? Buffer.alloc(0))
    ) {
      return safeRejection(
        new EnterpriseBusinessError(
          PROJECT_DELIVERY_APPROVAL_DECISION_INVALID,
          'approvalDecisionRef must match a persisted Human APPROVE decision exactly',
        ),
        currentAggregateVersion,
      );
    }
    const active = await repo.getActiveDeliveryPlanByProjectForUpdate(
      execution.trx,
      context.enterpriseId,
      projectId,
    );
    let previousActiveReference: Common.VersionedRef | undefined;
    if (active) {
      const activeVersionId = active.active_version_id;
      if (activeVersionId === null)
        throw new Error('active DeliveryPlan row has no active version');
      const activeVersion = await repo.getDeliveryPlanVersion(execution.trx, activeVersionId);
      if (
        active.status !== 'ACTIVE' ||
        activeVersion?.version_status !== 'ACTIVE' ||
        activeVersion.delivery_plan_id !== active.delivery_plan_id
      ) {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          'the existing active DeliveryPlan is inconsistent',
        );
      }
      previousActiveReference = deliveryPlanRef(
        context.enterpriseId,
        projectId,
        active.delivery_plan_id,
        activeVersionId,
      );
      const oldVersionUpdated = await repo.transitionDeliveryPlanVersion(
        execution.trx,
        activeVersionId,
        'SUPERSEDED',
      );
      if (!oldVersionUpdated) {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          'the existing active DeliveryPlan lost its status transition race',
        );
      }
      const oldRootCas = await repo.casDeliveryPlan(
        execution.trx,
        active.delivery_plan_id,
        aggregateVersion(active.aggregate_version),
        {
          status: 'SUPERSEDED',
          approvedVersionId: null,
          activeVersionId: null,
          sourceCommandId: normalizedEnvelope.commandId,
        },
      );
      if (!oldRootCas.ok) {
        throw new CommandExecutionError(
          CONCURRENCY_CONFLICT,
          'the existing active DeliveryPlan lost its Root CAS race',
        );
      }
    }
    const targetVersionUpdated = await repo.transitionDeliveryPlanVersion(
      execution.trx,
      planReference.versionId,
      'ACTIVE',
      { activatedAt },
    );
    if (!targetVersionUpdated) {
      throw new CommandExecutionError(
        CONCURRENCY_CONFLICT,
        'DeliveryPlan activation lost its version transition race',
      );
    }
    const targetCas = await repo.casDeliveryPlan(
      execution.trx,
      planReference.objectId,
      normalizedEnvelope.expectedAggregateVersion,
      {
        status: 'ACTIVE',
        approvedVersionId: planReference.versionId,
        activeVersionId: planReference.versionId,
        sourceCommandId: normalizedEnvelope.commandId,
      },
    );
    if (!targetCas.ok) {
      throw new CommandExecutionError(
        CONCURRENCY_CONFLICT,
        'DeliveryPlan activation lost its Root CAS race',
      );
    }
    const items = await repo.getDeliveryItems(execution.trx, planReference.versionId);
    const itemReferences = items.map((item) =>
      deliveryItemRef(
        context.enterpriseId,
        projectId,
        item.delivery_item_id,
        planReference.versionId,
      ),
    );
    await appendReference(
      execution,
      planReference.objectId,
      planReference.versionId,
      version.payload_hash,
      approvalReference,
      '/approvalDecisionRef',
      'DELIVERY_PLAN_APPROVAL_DECISION',
    );
    await appendReference(
      execution,
      planReference.objectId,
      planReference.versionId,
      version.payload_hash,
      impactPolicyReference,
      '/impactPolicyRef',
      'DELIVERY_PLAN_IMPACT_POLICY',
    );
    if (previousActiveReference !== undefined) {
      await appendReference(
        execution,
        planReference.objectId,
        planReference.versionId,
        version.payload_hash,
        previousActiveReference,
        '/previousActiveRef',
        'DELIVERY_PLAN_PREVIOUS_ACTIVE',
      );
    }
    const planEventPayload = {
      enterpriseId: context.enterpriseId,
      projectId,
      deliveryPlanRef: deliveryPlanRef(
        context.enterpriseId,
        projectId,
        planReference.objectId,
        planReference.versionId,
      ),
      projectRef: projectRef(context.enterpriseId, projectId),
      ...(previousActiveReference === undefined
        ? {}
        : { previousActiveRef: previousActiveReference }),
      itemRefs: itemReferences,
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'project.DeliveryPlanActivated',
      eventVersion: '1.0',
      aggregateType: 'DeliveryPlan',
      aggregateId: planReference.objectId,
      aggregateVersion: targetCas.nextVersion,
      payload: planEventPayload,
      declaredHash: digestCanonicalPayload(planEventPayload).hash,
      occurredAt: activatedAt,
    });
    for (const item of items) {
      const itemEventPayload = {
        enterpriseId: context.enterpriseId,
        projectId,
        deliveryPlanRef: deliveryPlanRef(
          context.enterpriseId,
          projectId,
          planReference.objectId,
          planReference.versionId,
        ),
        deliveryItemRef: deliveryItemRef(
          context.enterpriseId,
          projectId,
          item.delivery_item_id,
          planReference.versionId,
        ),
        criteriaHash: hashRef(item.criteria_hash),
        qualityProfileRef: item.quality_profile_ref as unknown as Common.VersionedRef,
      } as unknown as CanonicalJsonObject;
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'project.DeliveryItemActivated',
        eventVersion: '1.0',
        aggregateType: 'DeliveryPlan',
        aggregateId: planReference.objectId,
        aggregateVersion: targetCas.nextVersion,
        payload: itemEventPayload,
        declaredHash: digestCanonicalPayload(itemEventPayload).hash,
        occurredAt: activatedAt,
      });
    }
    return {
      kind: 'COMMITTED',
      resultPayload: {
        deliveryPlanRef: deliveryPlanRef(
          context.enterpriseId,
          projectId,
          planReference.objectId,
          planReference.versionId,
        ),
        itemRefs: itemReferences,
        ...(previousActiveReference === undefined
          ? {}
          : { previousActiveRef: previousActiveReference }),
        status: 'ACTIVE',
        aggregateVersion: targetCas.nextVersion,
      } as unknown as CanonicalJsonObject,
    };
  });
}

export async function handleGetDeliveryItemCriteria(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  payload: CriteriaPayload,
): Promise<EnterpriseProject.ProjectGetDeliveryItemCriteriaResult> {
  const projectId = projectIdFromReference(payload.deliveryPlanRef, context, 'deliveryPlanRef');
  const planReference = exactProjectVersionRef(
    payload.deliveryPlanRef,
    'DeliveryPlan',
    context.enterpriseId,
    projectId,
    'deliveryPlanRef',
  );
  const deliveryItemId = uuid(
    payload.deliveryItemId,
    'deliveryItemId',
    PROJECT_DELIVERY_ITEM_INVALID,
  );
  return withEnterpriseProjectTransaction(db, context, (trx) =>
    withCriteriaTransaction(trx, context, planReference, deliveryItemId, projectId),
  );
}

async function withCriteriaTransaction(
  trx: EnterpriseProjectTransaction,
  context: EnterpriseProjectTransactionContext,
  planReference: ProjectVersionReference,
  deliveryItemId: string,
  projectId: string,
): Promise<EnterpriseProject.ProjectGetDeliveryItemCriteriaResult> {
  const version = await repo.getDeliveryPlanVersion(trx, planReference.versionId);
  if (
    version?.delivery_plan_id !== planReference.objectId ||
    version.enterprise_id !== context.enterpriseId ||
    version.project_id !== projectId
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_VERSION_NOT_FOUND,
      'deliveryPlanRef does not identify the exact stored version',
    );
  }
  const item = await repo.getDeliveryItem(trx, planReference.versionId, deliveryItemId);
  if (
    item?.delivery_plan_id !== planReference.objectId ||
    item.enterprise_id !== context.enterpriseId ||
    item.project_id !== projectId
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_DELIVERY_VERSION_NOT_FOUND,
      'deliveryItemId does not identify an item in the exact Plan Version',
    );
  }
  const currentEvaluation =
    item.current_completion_evaluation_id === null
      ? undefined
      : await completionRepo.getCompletionEvaluationById(
          trx,
          item.current_completion_evaluation_id,
        );
  return {
    deliveryPlanRef: deliveryPlanRef(
      context.enterpriseId,
      projectId,
      planReference.objectId,
      planReference.versionId,
    ),
    deliveryItemId: item.delivery_item_id,
    definition: {
      itemId: item.delivery_item_id,
      itemKey: item.item_key,
      itemType: item.item_type,
      title: item.title,
      objective: item.objective,
      sourceGapItemRefs: item.source_gap_item_refs as unknown as readonly Common.VersionedRef[],
      dependencyItemIds: item.dependency_item_ids as unknown as readonly Common.UuidV7[],
      targetArtifactTypes: item.target_artifact_types as unknown as readonly Common.NamespaceCode[],
      qualityProfileRef: item.quality_profile_ref as unknown as Common.VersionedRef,
      completionCriteria:
        item.completion_criteria as unknown as EnterpriseProject.DeliveryItemDefinition['completionCriteria'],
      ...(item.due_constraint === null
        ? {}
        : { dueConstraint: item.due_constraint as unknown as CanonicalJson }),
      commitmentStatus: item.commitment_status,
    },
    criteriaHash: hashRef(item.criteria_hash),
    ...(currentEvaluation === undefined
      ? {}
      : {
          currentEvaluationRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'CompletionEvaluation',
            objectId: currentEvaluation.evaluation_id,
            immutableVersionId: currentEvaluation.evaluation_id,
            scope: {
              enterpriseId: context.enterpriseId,
              projectId,
            },
            contentHash: hashRef(currentEvaluation.payload_hash),
          } satisfies Common.ContentAddressedRef,
        }),
    executionStatus: item.execution_status,
  };
}
