// IM-03 WI-07 (issue #63): CustomerBaseline draft, activation and active-ref
// query handlers. Cross-field epistemic validation is repeated by the
// PostgreSQL CHECK constraints in V2008; exact CustomerMaterial version
// resolution remains an application responsibility because it crosses a
// JSON reference boundary.

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
import { EnterpriseBusinessRepository } from '../persistence/enterprise-business-repository.js';
import type {
  CustomerBaselineItemStatus,
  CustomerBaselineImpactStatus,
} from '../persistence/enterprise-business-types.js';
import {
  EnterpriseBusinessError,
  PROJECT_BASELINE_STATUS_INVALID,
  PROJECT_BASELINE_VERSION_IMMUTABLE,
  PROJECT_BASELINE_VERSION_NOT_FOUND,
  PROJECT_HUMAN_ONLY_DENIED,
  PROJECT_MISSING_CONFIRMATION_REQUIRED,
} from './enterprise-business-errors.js';

const repo = new EnterpriseBusinessRepository();
const IMPACT_OWNER_OBJECT_TYPES = new Set([
  'Context',
  'ProjectContext',
  'GapAnalysis',
  'Plan',
  'DeliveryPlan',
]);

type CreateDraftPayload = EnterpriseProject.ProjectCreateCustomerBaselineDraftPayload;
type ActivatePayload = EnterpriseProject.ProjectActivateCustomerBaselineVersionPayload;

interface ReferenceLike {
  readonly kind?: unknown;
  readonly objectType?: unknown;
  readonly objectId?: unknown;
  readonly versionId?: unknown;
  readonly snapshotId?: unknown;
  readonly scope?: unknown;
  readonly contentHash?: unknown;
  readonly algorithm?: unknown;
  readonly canonicalizationVersion?: unknown;
  readonly digest?: unknown;
  readonly reasonCode?: unknown;
  readonly summary?: unknown;
  readonly evidenceRefs?: unknown;
  readonly policyRef?: unknown;
}

interface ScopeLike {
  readonly enterpriseId?: unknown;
  readonly projectId?: unknown;
}

interface DraftExpectationShape {
  readonly expectationId: string;
  readonly expectedMaterialKey: string;
  readonly materialType: string;
  readonly expectedTitleOrRole: string;
  readonly status: CustomerBaselineItemStatus;
  readonly customerMaterialRefs: readonly unknown[];
  readonly decisionRef?: CanonicalJsonObject;
  readonly reason: CanonicalJsonObject;
}

interface ResolvedExpectation extends DraftExpectationShape {
  readonly customerMaterialRefs: readonly CanonicalJsonObject[];
  readonly decisionRef?: CanonicalJsonObject;
}

function asReferenceLike(value: unknown): ReferenceLike {
  return value !== null && typeof value === 'object' ? value : {};
}

function asScopeLike(value: unknown): ScopeLike | undefined {
  return value !== null && typeof value === 'object' ? value : undefined;
}

function asCanonicalJson(value: unknown): CanonicalJsonValue {
  return JSON.parse(JSON.stringify(value)) as CanonicalJsonValue;
}

function asCanonicalObject(value: unknown, label: string): CanonicalJsonObject {
  const canonical = asCanonicalJson(value);
  if (canonical === null || typeof canonical !== 'object' || Array.isArray(canonical)) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      `${label} must be a JSON object`,
    );
  }
  return canonical as CanonicalJsonObject;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      `${label} must be non-empty`,
    );
  }
  return value;
}

function assertUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isUuidV7(value)) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      `${label} must be an RFC 9562 UUIDv7`,
    );
  }
  return value;
}

function assertExactProjectRef(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
): string {
  const reference = asReferenceLike(value);
  const scope = asScopeLike(reference.scope);
  const projectId = assertUuid(reference.objectId, 'projectRef.objectId');
  if (
    reference.kind !== 'OBJECT' ||
    reference.objectType !== 'Project' ||
    scope?.enterpriseId !== context.enterpriseId ||
    scope.projectId !== projectId ||
    envelope.enterpriseId !== context.enterpriseId ||
    (envelope.projectId !== undefined && envelope.projectId !== projectId) ||
    !context.allowedProjectIds.includes(projectId)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      'projectRef must identify an allowed Project scope exactly',
    );
  }
  return projectId;
}

function validateVersionedRef(
  value: unknown,
  objectType: string,
  enterpriseId: string,
  projectId: string,
  label: string,
): CanonicalJsonObject {
  const reference = asReferenceLike(value);
  const scope = asScopeLike(reference.scope);
  if (
    reference.kind !== 'VERSIONED' ||
    reference.objectType !== objectType ||
    typeof reference.objectId !== 'string' ||
    !isUuidV7(reference.objectId) ||
    typeof reference.versionId !== 'string' ||
    !isUuidV7(reference.versionId) ||
    scope?.enterpriseId !== enterpriseId ||
    scope.projectId !== projectId
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      `${label} must be an exact Project-scoped ${objectType} VersionedRef`,
    );
  }
  return asCanonicalObject(value, label);
}

function assertProjectScopeFromReference(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
  label: string,
): string {
  const scope = asScopeLike(asReferenceLike(value).scope);
  const projectId = assertUuid(scope?.projectId, `${label}.scope.projectId`);
  if (
    scope?.enterpriseId !== context.enterpriseId ||
    (envelope.projectId !== undefined && envelope.projectId !== projectId) ||
    !context.allowedProjectIds.includes(projectId)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      `${label} must carry an allowed Project scope`,
    );
  }
  return projectId;
}

function validateSnapshotRef(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): CanonicalJsonObject {
  const reference = asReferenceLike(value);
  const scope = asScopeLike(reference.scope);
  if (
    reference.kind !== 'SNAPSHOT' ||
    reference.objectType !== 'BaselineReview' ||
    typeof reference.objectId !== 'string' ||
    !isUuidV7(reference.objectId) ||
    typeof reference.snapshotId !== 'string' ||
    !isUuidV7(reference.snapshotId) ||
    scope?.enterpriseId !== enterpriseId ||
    scope.projectId !== projectId
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      `${label} must be an exact Project-scoped BaselineReview SnapshotRef`,
    );
  }
  return asCanonicalObject(value, label);
}

function contentHashBuffer(value: unknown, label: string): Buffer {
  const hash = asReferenceLike(value);
  if (
    hash.algorithm !== 'SHA-256' ||
    hash.canonicalizationVersion !== '1' ||
    typeof hash.digest !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(hash.digest)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      `${label} must carry a SHA-256/1 content hash`,
    );
  }
  return Buffer.from(hash.digest.toLowerCase(), 'hex');
}

function validateDecisionRef(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): CanonicalJsonObject {
  const reference = asReferenceLike(value);
  const scope = asScopeLike(reference.scope);
  if (
    reference.kind !== 'CONTENT_ADDRESSED' ||
    reference.objectType !== 'BusinessDecision' ||
    typeof reference.objectId !== 'string' ||
    !isUuidV7(reference.objectId) ||
    scope?.enterpriseId !== enterpriseId ||
    scope.projectId !== projectId
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      `${label} must be an exact Project-scoped BusinessDecision ref`,
    );
  }
  contentHashBuffer(reference.contentHash, `${label}.contentHash`);
  return asCanonicalObject(value, label);
}

function validateJustification(
  value: unknown,
  enterpriseId: string,
  projectId: string,
  label: string,
): CanonicalJsonObject {
  const justification = asReferenceLike(value);
  if (
    typeof justification.reasonCode !== 'string' ||
    !/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(justification.reasonCode)
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      `${label}.reasonCode must be a registered reason code`,
    );
  }
  const summary = nonEmptyString(justification.summary, `${label}.summary`);
  if (!Array.isArray(justification.evidenceRefs)) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      `${label}.evidenceRefs must be an array`,
    );
  }
  const evidenceRefs = justification.evidenceRefs.map((reference, index) => {
    const candidate = asReferenceLike(reference);
    const scope = asScopeLike(candidate.scope);
    if (
      candidate.kind !== undefined &&
      (scope?.enterpriseId !== enterpriseId ||
        (scope.projectId !== undefined && scope.projectId !== projectId))
    ) {
      throw new EnterpriseBusinessError(
        PROJECT_BASELINE_STATUS_INVALID,
        `${label}.evidenceRefs[${index}] crosses the trusted Project scope`,
      );
    }
    return asCanonicalObject(reference, `${label}.evidenceRefs[${index}]`);
  });
  const policyRef =
    justification.policyRef === undefined
      ? undefined
      : validateVersionedRef(
          justification.policyRef,
          'Policy',
          enterpriseId,
          projectId,
          `${label}.policyRef`,
        );
  return {
    reasonCode: justification.reasonCode,
    summary,
    evidenceRefs,
    ...(policyRef === undefined ? {} : { policyRef }),
  };
}

function statusValue(value: unknown): CustomerBaselineItemStatus {
  if (
    value !== 'PRESENT' &&
    value !== 'PARTIAL' &&
    value !== 'MISSING_CONFIRMED' &&
    value !== 'NOT_PROVIDED' &&
    value !== 'UNKNOWN' &&
    value !== 'NOT_APPLICABLE'
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      'CustomerBaseline status is not a supported epistemic state',
    );
  }
  return value;
}

function validateExpectationShape(
  value: EnterpriseProject.BaselineExpectation,
  enterpriseId: string,
  projectId: string,
  index: number,
): DraftExpectationShape {
  const label = `expectations[${index}]`;
  const expectationId = assertUuid(value.expectationId, `${label}.expectationId`);
  const expectedMaterialKey = nonEmptyString(
    value.expectedMaterialKey,
    `${label}.expectedMaterialKey`,
  );
  const materialType = nonEmptyString(value.materialType, `${label}.materialType`);
  const expectedTitleOrRole = nonEmptyString(
    value.expectedTitleOrRole,
    `${label}.expectedTitleOrRole`,
  );
  const status = statusValue(value.status);
  if (!Array.isArray(value.customerMaterialRefs)) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      `${label}.customerMaterialRefs must be an array`,
    );
  }
  const reason = validateJustification(value.reason, enterpriseId, projectId, `${label}.reason`);
  const decisionRef =
    value.decisionRef === undefined
      ? undefined
      : validateDecisionRef(value.decisionRef, enterpriseId, projectId, `${label}.decisionRef`);
  if ((status === 'PRESENT' || status === 'PARTIAL') && value.customerMaterialRefs.length === 0) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      `${label} PRESENT/PARTIAL requires at least one CustomerMaterial ref`,
    );
  }
  if (
    (status === 'NOT_PROVIDED' || status === 'UNKNOWN') &&
    value.customerMaterialRefs.length > 0
  ) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      `${label} NOT_PROVIDED/UNKNOWN cannot carry CustomerMaterial refs`,
    );
  }
  if (status === 'MISSING_CONFIRMED' || status === 'NOT_APPLICABLE') {
    if (value.customerMaterialRefs.length > 0 || decisionRef === undefined) {
      throw new EnterpriseBusinessError(
        PROJECT_BASELINE_STATUS_INVALID,
        `${label} ${status} requires empty material refs and a Decision ref`,
      );
    }
  } else if (decisionRef !== undefined) {
    throw new EnterpriseBusinessError(
      PROJECT_BASELINE_STATUS_INVALID,
      `${label} ${status} cannot carry a Decision ref`,
    );
  }
  return {
    expectationId,
    expectedMaterialKey,
    materialType,
    expectedTitleOrRole,
    status,
    customerMaterialRefs: value.customerMaterialRefs,
    ...(decisionRef === undefined ? {} : { decisionRef }),
    reason,
  };
}

async function resolveExpectations(
  trx: EnterpriseProjectTransaction,
  context: EnterpriseProjectTransactionContext,
  projectId: string,
  shapes: readonly DraftExpectationShape[],
): Promise<ResolvedExpectation[]> {
  const keys = new Set<string>();
  const expectationIds = new Set<string>();
  const resolved: ResolvedExpectation[] = [];
  for (const shape of shapes) {
    if (keys.has(shape.expectedMaterialKey) || expectationIds.has(shape.expectationId)) {
      throw new EnterpriseBusinessError(
        PROJECT_BASELINE_STATUS_INVALID,
        'CustomerBaseline expectation keys and IDs must be unique',
      );
    }
    keys.add(shape.expectedMaterialKey);
    expectationIds.add(shape.expectationId);
    const materialRefs: CanonicalJsonObject[] = [];
    const referenceKeys = new Set<string>();
    for (const [index, value] of shape.customerMaterialRefs.entries()) {
      const reference = validateVersionedRef(
        value,
        'CustomerMaterial',
        context.enterpriseId,
        projectId,
        `CustomerMaterial ref ${shape.expectedMaterialKey}[${index}]`,
      );
      const referenceFacts = asReferenceLike(reference);
      const referenceObjectId = assertUuid(
        referenceFacts.objectId,
        `CustomerMaterial ref ${shape.expectedMaterialKey}[${index}].objectId`,
      );
      const referenceVersionId = assertUuid(
        referenceFacts.versionId,
        `CustomerMaterial ref ${shape.expectedMaterialKey}[${index}].versionId`,
      );
      const key = `${referenceObjectId}:${referenceVersionId}`;
      if (referenceKeys.has(key)) {
        throw new EnterpriseBusinessError(
          PROJECT_BASELINE_STATUS_INVALID,
          `CustomerMaterial refs for ${shape.expectedMaterialKey} must be unique`,
        );
      }
      referenceKeys.add(key);
      const materialVersion = await repo.getCustomerMaterialVersion(trx, referenceVersionId);
      const materialRoot = await repo.getCustomerMaterialById(trx, referenceObjectId);
      if (
        materialVersion === undefined ||
        materialRoot === undefined ||
        materialVersion.customer_material_id !== referenceObjectId ||
        materialVersion.enterprise_id !== context.enterpriseId ||
        materialVersion.project_id !== projectId ||
        materialVersion.version_status !== 'CONFIRMED' ||
        materialRoot.enterprise_id !== context.enterpriseId ||
        materialRoot.project_id !== projectId ||
        materialRoot.classification_status !== 'CONFIRMED'
      ) {
        throw new EnterpriseBusinessError(
          PROJECT_BASELINE_STATUS_INVALID,
          `CustomerMaterial ref ${shape.expectedMaterialKey}[${index}] is not a confirmed Project fact`,
        );
      }
      materialRefs.push(reference);
    }
    resolved.push({
      ...shape,
      customerMaterialRefs: materialRefs,
    });
  }
  return resolved;
}

function projectRef(enterpriseId: string, projectId: string): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'Project',
    objectId: projectId,
    scope: { enterpriseId, projectId },
  };
}

function baselineRef(
  enterpriseId: string,
  projectId: string,
  customerBaselineId: string,
  versionId: string,
): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'CustomerBaseline',
    objectId: customerBaselineId,
    versionId,
    scope: { enterpriseId, projectId },
  };
}

function targetPayloadHash(value: unknown): Buffer | undefined {
  const digest = asReferenceLike(asReferenceLike(value).contentHash).digest;
  return typeof digest === 'string' && /^[0-9a-f]{64}$/i.test(digest)
    ? Buffer.from(digest, 'hex')
    : undefined;
}

async function appendReferenceFromValue(
  execution: Pick<CommandExecution, 'appendReferenceEdge'>,
  ownerVersionId: string,
  ownerPayloadHash: Buffer,
  reference: unknown,
  referencePath: string,
  referencePurpose: string,
  customerBaselineId: string,
): Promise<void> {
  const facts = asReferenceLike(reference);
  if (typeof facts.objectType !== 'string' || typeof facts.objectId !== 'string') return;
  const targetVersionId =
    typeof facts.versionId === 'string'
      ? facts.versionId
      : typeof facts.snapshotId === 'string'
        ? facts.snapshotId
        : undefined;
  await execution.appendReferenceEdge({
    ownerObjectType: 'CustomerBaseline',
    ownerObjectId: customerBaselineId,
    ownerVersionId,
    ownerPayloadHash,
    referencePath,
    targetModule: 'EnterpriseProject',
    targetObjectType: facts.objectType,
    targetObjectId: facts.objectId,
    ...(targetVersionId === undefined ? {} : { targetVersionId }),
    ...(targetPayloadHash(reference) === undefined
      ? {}
      : { targetPayloadHash: targetPayloadHash(reference) }),
    referencePurpose,
  });
}

async function appendDraftReferenceEdges(
  execution: Pick<CommandExecution, 'appendReferenceEdge'>,
  customerBaselineId: string,
  versionId: string,
  payloadHash: Buffer,
  enterpriseId: string,
  projectId: string,
  policyRef: CanonicalJsonObject,
  previousVersionRef: CanonicalJsonObject | undefined,
  expectations: readonly ResolvedExpectation[],
): Promise<void> {
  await appendReferenceFromValue(
    execution,
    versionId,
    payloadHash,
    projectRef(enterpriseId, projectId),
    '/projectRef',
    'CUSTOMER_BASELINE_PROJECT_SCOPE',
    customerBaselineId,
  );
  await appendReferenceFromValue(
    execution,
    versionId,
    payloadHash,
    policyRef,
    '/baselinePolicyRef',
    'CUSTOMER_BASELINE_POLICY',
    customerBaselineId,
  );
  if (previousVersionRef !== undefined) {
    await appendReferenceFromValue(
      execution,
      versionId,
      payloadHash,
      previousVersionRef,
      '/previousVersionRef',
      'CUSTOMER_BASELINE_VERSION_PREVIOUS',
      customerBaselineId,
    );
  }
  for (const [expectationIndex, expectation] of expectations.entries()) {
    for (const [referenceIndex, reference] of expectation.customerMaterialRefs.entries()) {
      await appendReferenceFromValue(
        execution,
        versionId,
        payloadHash,
        reference,
        `/expectations/${expectationIndex}/customerMaterialRefs/${referenceIndex}`,
        'CUSTOMER_BASELINE_MATERIAL',
        customerBaselineId,
      );
    }
    if (expectation.decisionRef !== undefined) {
      await appendReferenceFromValue(
        execution,
        versionId,
        payloadHash,
        expectation.decisionRef,
        `/expectations/${expectationIndex}/decisionRef`,
        'CUSTOMER_BASELINE_DECISION',
        customerBaselineId,
      );
    }
  }
}

async function persistDraftVersion(
  execution: CommandExecution,
  envelope: CommandEnvelope,
  context: EnterpriseProjectTransactionContext,
  projectId: string,
  customerBaselineId: string,
  versionId: string,
  versionNo: number,
  previousVersionId: string | undefined,
  policyRef: CanonicalJsonObject,
  shapes: readonly DraftExpectationShape[],
): Promise<{ expectations: ResolvedExpectation[]; payloadHash: Buffer }> {
  const expectations = await resolveExpectations(execution.trx, context, projectId, shapes);
  const versionPayload = {
    enterpriseId: context.enterpriseId,
    projectId,
    customerBaselineId,
    versionId,
    versionNo,
    ...(previousVersionId === undefined ? {} : { previousVersionId }),
    baselinePolicyRef: policyRef,
    expectations,
  };
  const digest = digestCanonicalPayload(versionPayload as unknown as CanonicalJsonObject);
  await repo.insertCustomerBaselineVersion(execution.trx, {
    versionId,
    customerBaselineId,
    enterpriseId: context.enterpriseId,
    projectId,
    versionNo,
    ...(previousVersionId === undefined ? {} : { previousVersionId }),
    baselinePolicyRef: policyRef,
    expectationsPayload: expectations,
    payloadHash: digest.hash,
    proposedByPrincipalId: envelope.principalId,
    proposedByActorSnapshotId: envelope.actorSnapshotId,
    authorizationDecisionId: envelope.authorizationDecisionId,
    sourceCommandId: envelope.commandId,
  });
  for (const expectation of expectations) {
    const itemPayload = {
      enterpriseId: context.enterpriseId,
      projectId,
      customerBaselineId,
      versionId,
      expectation,
    };
    await repo.insertCustomerBaselineItem(execution.trx, {
      expectationId: expectation.expectationId,
      customerBaselineId,
      versionId,
      enterpriseId: context.enterpriseId,
      projectId,
      expectedMaterialKey: expectation.expectedMaterialKey,
      materialType: expectation.materialType,
      expectedTitleOrRole: expectation.expectedTitleOrRole,
      status: expectation.status,
      customerMaterialRefs: expectation.customerMaterialRefs,
      ...(expectation.decisionRef === undefined ? {} : { decisionRef: expectation.decisionRef }),
      reason: expectation.reason,
      payloadHash: digestCanonicalPayload(itemPayload as unknown as CanonicalJsonObject).hash,
      recordedByPrincipalId: envelope.principalId,
      recordedByActorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
  }
  await appendDraftReferenceEdges(
    execution,
    customerBaselineId,
    versionId,
    digest.hash,
    context.enterpriseId,
    projectId,
    policyRef,
    previousVersionId === undefined
      ? undefined
      : (baselineRef(
          context.enterpriseId,
          projectId,
          customerBaselineId,
          previousVersionId,
        ) as unknown as CanonicalJsonObject),
    expectations,
  );
  return { expectations, payloadHash: digest.hash };
}

function assertHumanOnly(
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
): void {
  if (context.principalKind !== 'HUMAN' || envelope.principalKind !== 'HUMAN') {
    throw new EnterpriseBusinessError(
      PROJECT_HUMAN_ONLY_DENIED,
      'CustomerBaseline activation is Human-only',
    );
  }
}

function aggregateVersion(value: unknown): string {
  return String(value);
}

function edgeSnapshot(edge: {
  owner_object_type: string;
  owner_object_id: string;
  owner_version_id?: string | null;
  reference_path: string;
  target_module: string;
  target_object_type: string;
  target_object_id: string;
  target_version_id?: string | null;
  reference_purpose: string;
}): CanonicalJsonObject {
  return {
    ownerObjectType: edge.owner_object_type,
    ownerObjectId: edge.owner_object_id,
    ...(edge.owner_version_id === undefined || edge.owner_version_id === null
      ? {}
      : { ownerVersionId: edge.owner_version_id }),
    referencePath: edge.reference_path,
    targetModule: edge.target_module,
    targetObjectType: edge.target_object_type,
    targetObjectId: edge.target_object_id,
    ...(edge.target_version_id === undefined || edge.target_version_id === null
      ? {}
      : { targetVersionId: edge.target_version_id }),
    referencePurpose: edge.reference_purpose,
  };
}

export type CreateCustomerBaselineDraftCommandPayload = CreateDraftPayload;

export async function handleCreateCustomerBaselineDraft(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: CreateDraftPayload },
): Promise<CommandResult> {
  const projectId = assertExactProjectRef(envelope.payload.projectRef, context, envelope);
  const policyRef = validateVersionedRef(
    envelope.payload.baselinePolicyRef,
    'Policy',
    context.enterpriseId,
    projectId,
    'baselinePolicyRef',
  );
  const shapes = envelope.payload.expectations.map((expectation, index) =>
    validateExpectationShape(expectation, context.enterpriseId, projectId, index),
  );
  const baselineWithProject = await withEnterpriseProjectTransaction(db, context, (trx) =>
    repo.getCustomerBaselineByProject(trx, context.enterpriseId, projectId),
  );
  const customerBaselineId = baselineWithProject?.customer_baseline_id ?? envelope.targetId;
  assertUuid(customerBaselineId, 'CustomerBaseline targetId');
  if (
    baselineWithProject !== undefined &&
    (envelope.targetId !== baselineWithProject.customer_baseline_id ||
      envelope.targetType === 'Project')
  ) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'CustomerBaseline target must identify the Project-owned baseline root',
    );
  }
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId,
    targetType: 'CustomerBaseline',
    targetId: customerBaselineId,
  };
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    if (
      context.principalKind === 'AGENT' &&
      shapes.some((expectation) => expectation.status === 'MISSING_CONFIRMED')
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_MISSING_CONFIRMATION_REQUIRED,
        safeSummary: 'Agent cannot confirm a missing CustomerBaseline material',
        currentAggregateVersion: undefined,
      };
    }
    const project = await repo.getProjectById(execution.trx, projectId);
    if (project?.enterprise_id !== context.enterpriseId) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_BASELINE_STATUS_INVALID,
        safeSummary: 'Project is not visible in the trusted Enterprise scope',
        currentAggregateVersion: undefined,
      };
    }
    if (project.status !== 'ACTIVE') {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_BASELINE_STATUS_INVALID,
        safeSummary: 'CustomerBaseline requires an active Project',
        currentAggregateVersion: aggregateVersion(project.aggregate_version),
      };
    }
    const root = await repo.getCustomerBaselineByProject(
      execution.trx,
      context.enterpriseId,
      projectId,
    );
    if (root === undefined) {
      if (
        envelope.payload.previousVersionRef !== undefined ||
        envelope.expectedAggregateVersion !== undefined
      ) {
        return {
          kind: 'REJECTED',
          errorCode: PROJECT_BASELINE_STATUS_INVALID,
          safeSummary:
            'the first CustomerBaseline draft cannot carry a previous ref or expected version',
          currentAggregateVersion: undefined,
        };
      }
      const versionId = newUuidV7();
      const persisted = await persistDraftVersion(
        execution,
        normalizedEnvelope,
        context,
        projectId,
        customerBaselineId,
        versionId,
        1,
        undefined,
        policyRef,
        shapes,
      );
      await repo.insertCustomerBaseline(execution.trx, {
        customerBaselineId,
        enterpriseId: context.enterpriseId,
        projectId,
        currentVersionId: versionId,
        createdByPrincipalId: envelope.principalId,
        createdByActorSnapshotId: envelope.actorSnapshotId,
        sourceCommandId: envelope.commandId,
      });
      return {
        kind: 'COMMITTED',
        resultPayload: {
          customerBaselineRef: baselineRef(
            context.enterpriseId,
            projectId,
            customerBaselineId,
            versionId,
          ),
          projectRef: projectRef(context.enterpriseId, projectId),
          status: 'DRAFT',
          versionNo: 1,
          aggregateVersion: '1',
          payloadHash: persisted.payloadHash.toString('hex'),
        } as unknown as CanonicalJsonObject,
      };
    }
    if (root.customer_baseline_id !== customerBaselineId) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_BASELINE_STATUS_INVALID,
        safeSummary: 'Project has more than one visible CustomerBaseline identity',
        currentAggregateVersion: aggregateVersion(root.aggregate_version),
      };
    }
    if (root.active_version_id === null || root.current_version_id !== root.active_version_id) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_BASELINE_STATUS_INVALID,
        safeSummary: 'a new CustomerBaseline draft requires the current active version',
        currentAggregateVersion: aggregateVersion(root.aggregate_version),
      };
    }
    if (
      envelope.expectedAggregateVersion === undefined ||
      envelope.expectedAggregateVersion !== aggregateVersion(root.aggregate_version)
    ) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'CustomerBaseline expected aggregate version is stale',
        currentAggregateVersion: aggregateVersion(root.aggregate_version),
      };
    }
    const previousVersionRef = envelope.payload.previousVersionRef;
    if (
      previousVersionRef?.objectId !== customerBaselineId ||
      previousVersionRef.versionId !== root.active_version_id
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_BASELINE_VERSION_IMMUTABLE,
        safeSummary: 'previousVersionRef must identify the exact active CustomerBaseline version',
        currentAggregateVersion: aggregateVersion(root.aggregate_version),
      };
    }
    const versions = await repo.getCustomerBaselineVersions(execution.trx, customerBaselineId);
    const versionNo =
      versions.reduce((maximum, version) => Math.max(maximum, version.version_no), 0) + 1;
    const versionId = newUuidV7();
    const cas = await repo.casCustomerBaselineDraft(
      execution.trx,
      customerBaselineId,
      envelope.expectedAggregateVersion,
      versionId,
      envelope.commandId,
    );
    if (!cas.ok) {
      throw new CommandExecutionError(
        CONCURRENCY_CONFLICT,
        `CustomerBaseline aggregate version changed from ${envelope.expectedAggregateVersion} to ${cas.current}`,
      );
    }
    const persisted = await persistDraftVersion(
      execution,
      normalizedEnvelope,
      context,
      projectId,
      customerBaselineId,
      versionId,
      versionNo,
      root.active_version_id,
      policyRef,
      shapes,
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        customerBaselineRef: baselineRef(
          context.enterpriseId,
          projectId,
          customerBaselineId,
          versionId,
        ),
        previousVersionRef: baselineRef(
          context.enterpriseId,
          projectId,
          customerBaselineId,
          root.active_version_id,
        ),
        projectRef: projectRef(context.enterpriseId, projectId),
        status: 'DRAFT',
        versionNo,
        aggregateVersion: cas.nextVersion,
        payloadHash: persisted.payloadHash.toString('hex'),
      } as unknown as CanonicalJsonObject,
    };
  });
}

export type ActivateCustomerBaselineVersionCommandPayload = ActivatePayload;

export async function handleActivateCustomerBaselineVersion(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: ActivatePayload },
): Promise<CommandResult> {
  assertHumanOnly(context, envelope);
  const projectId = assertProjectScopeFromReference(
    envelope.payload.baselineVersionRef,
    context,
    envelope,
    'baselineVersionRef',
  );
  const baselineVersionRef = validateVersionedRef(
    envelope.payload.baselineVersionRef,
    'CustomerBaseline',
    context.enterpriseId,
    projectId,
    'baselineVersionRef',
  );
  const baselineFacts = asReferenceLike(baselineVersionRef);
  const baselineObjectId = assertUuid(baselineFacts.objectId, 'baselineVersionRef.objectId');
  const baselineVersionId = assertUuid(baselineFacts.versionId, 'baselineVersionRef.versionId');
  const reviewSnapshotRef = validateSnapshotRef(
    envelope.payload.reviewSnapshotRef,
    context.enterpriseId,
    projectId,
    'reviewSnapshotRef',
  );
  const impactPolicyRef = validateVersionedRef(
    envelope.payload.impactPolicyRef,
    'Policy',
    context.enterpriseId,
    projectId,
    'impactPolicyRef',
  );
  const justification = validateJustification(
    envelope.payload.justification,
    context.enterpriseId,
    projectId,
    'justification',
  );
  if (envelope.targetId !== baselineObjectId) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'baselineVersionRef must identify the command CustomerBaseline target',
    );
  }
  if (envelope.expectedAggregateVersion === undefined) {
    throw new CommandExecutionError(
      'COMMAND_TARGET_MISMATCH',
      'CustomerBaseline activation requires an expected aggregate version',
    );
  }
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId,
    targetType: 'CustomerBaseline',
    targetId: baselineObjectId,
  };
  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const root = await repo.getCustomerBaselineById(execution.trx, baselineObjectId);
    if (root === undefined) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_BASELINE_VERSION_NOT_FOUND,
        safeSummary: 'CustomerBaseline root was not found in the trusted Project scope',
        currentAggregateVersion: undefined,
      };
    }
    if (root.enterprise_id !== context.enterpriseId || root.project_id !== projectId) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_BASELINE_STATUS_INVALID,
        safeSummary: 'CustomerBaseline root is outside the trusted Project scope',
        currentAggregateVersion: aggregateVersion(root.aggregate_version),
      };
    }
    if (aggregateVersion(root.aggregate_version) !== envelope.expectedAggregateVersion) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'CustomerBaseline activation expected aggregate version is stale',
        currentAggregateVersion: aggregateVersion(root.aggregate_version),
      };
    }
    const targetVersion = await repo.getCustomerBaselineVersion(execution.trx, baselineVersionId);
    if (
      targetVersion?.customer_baseline_id !== root.customer_baseline_id ||
      targetVersion.enterprise_id !== context.enterpriseId ||
      targetVersion.project_id !== projectId
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_BASELINE_VERSION_NOT_FOUND,
        safeSummary: 'baselineVersionRef does not identify the exact stored version',
        currentAggregateVersion: aggregateVersion(root.aggregate_version),
      };
    }
    if (
      targetVersion.version_status !== 'DRAFT' ||
      root.current_version_id !== targetVersion.version_id
    ) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_BASELINE_VERSION_IMMUTABLE,
        safeSummary: 'only the current DRAFT CustomerBaseline version can be activated',
        currentAggregateVersion: aggregateVersion(root.aggregate_version),
      };
    }
    const previousActiveVersionId = root.active_version_id;
    const previousActiveVersion =
      previousActiveVersionId === null
        ? undefined
        : await repo.getCustomerBaselineVersion(execution.trx, previousActiveVersionId);
    if (previousActiveVersionId !== null && previousActiveVersion === undefined) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_BASELINE_STATUS_INVALID,
        safeSummary: 'CustomerBaseline active pointer does not resolve to a stored version',
        currentAggregateVersion: aggregateVersion(root.aggregate_version),
      };
    }
    const affectedEdges =
      previousActiveVersionId === null
        ? []
        : (
            await repo.getReferenceEdgesToCustomerBaselineVersion(
              execution.trx,
              context.enterpriseId,
              projectId,
              root.customer_baseline_id,
              previousActiveVersionId,
            )
          ).filter((edge) => IMPACT_OWNER_OBJECT_TYPES.has(edge.owner_object_type));
    const affectedReferences = affectedEdges.map(edgeSnapshot);
    const impactStatus: CustomerBaselineImpactStatus =
      previousActiveVersionId === null ? 'NO_PRIOR_ACTIVE' : 'STALE';
    const impactPayload = {
      enterpriseId: context.enterpriseId,
      projectId,
      customerBaselineId: root.customer_baseline_id,
      newVersionId: targetVersion.version_id,
      ...(previousActiveVersionId === null ? {} : { previousActiveVersionId }),
      reviewSnapshotRef,
      impactPolicyRef,
      justification,
      affectedReferences,
      staleReferences: affectedReferences,
      impactStatus,
    };
    const impactDigest = digestCanonicalPayload(impactPayload);
    const cas = await repo.casCustomerBaselineActivation(
      execution.trx,
      root.customer_baseline_id,
      aggregateVersion(root.aggregate_version),
      targetVersion.version_id,
      envelope.commandId,
    );
    if (!cas.ok) {
      return {
        kind: 'REJECTED',
        errorCode: CONCURRENCY_CONFLICT,
        safeSummary: 'CustomerBaseline activation lost the Root CAS race',
        currentAggregateVersion: cas.current,
      };
    }
    const confirmed = await repo.confirmCustomerBaselineVersion(
      execution.trx,
      targetVersion.version_id,
      envelope.principalId,
      envelope.actorSnapshotId,
      new Date(),
    );
    if (!confirmed) {
      throw new CommandExecutionError(
        CONCURRENCY_CONFLICT,
        'CustomerBaseline version confirmation lost its DRAFT race',
      );
    }
    const impactReviewId = newUuidV7();
    await repo.insertCustomerBaselineImpactReview(execution.trx, {
      impactReviewId,
      customerBaselineId: root.customer_baseline_id,
      newVersionId: targetVersion.version_id,
      ...(previousActiveVersionId === null ? {} : { previousActiveVersionId }),
      enterpriseId: context.enterpriseId,
      projectId,
      reviewSnapshotRef,
      impactPolicyRef,
      justification,
      affectedReferences,
      staleReferences: affectedReferences,
      impactStatus,
      payloadHash: impactDigest.hash,
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    const activatedRef = baselineRef(
      context.enterpriseId,
      projectId,
      root.customer_baseline_id,
      targetVersion.version_id,
    );
    const previousActiveRef =
      previousActiveVersion === undefined
        ? undefined
        : baselineRef(
            context.enterpriseId,
            projectId,
            root.customer_baseline_id,
            previousActiveVersion.version_id,
          );
    const eventPayload = {
      enterpriseId: context.enterpriseId,
      projectId,
      customerBaselineRef: activatedRef,
      ...(previousActiveRef === undefined ? {} : { previousActiveRef }),
      projectRef: projectRef(context.enterpriseId, projectId),
      impactPolicyRef,
    } as unknown as CanonicalJsonObject;
    await execution.appendOutbox({
      eventId: newUuidV7(),
      eventType: 'project.CustomerBaselineVersionActivated',
      eventVersion: '1.0',
      aggregateType: 'CustomerBaseline',
      aggregateId: root.customer_baseline_id,
      aggregateVersion: cas.nextVersion,
      payload: eventPayload,
      declaredHash: digestCanonicalPayload(eventPayload).hash,
      occurredAt: new Date(),
    });
    await appendReferenceFromValue(
      execution,
      targetVersion.version_id,
      targetVersion.payload_hash,
      projectRef(context.enterpriseId, projectId),
      '/activation/projectRef',
      'CUSTOMER_BASELINE_ACTIVATION_PROJECT_SCOPE',
      root.customer_baseline_id,
    );
    await appendReferenceFromValue(
      execution,
      targetVersion.version_id,
      targetVersion.payload_hash,
      reviewSnapshotRef,
      '/activation/reviewSnapshotRef',
      'CUSTOMER_BASELINE_ACTIVATION_REVIEW_SNAPSHOT',
      root.customer_baseline_id,
    );
    await appendReferenceFromValue(
      execution,
      targetVersion.version_id,
      targetVersion.payload_hash,
      impactPolicyRef,
      '/activation/impactPolicyRef',
      'CUSTOMER_BASELINE_ACTIVATION_POLICY',
      root.customer_baseline_id,
    );
    if (previousActiveRef !== undefined) {
      await appendReferenceFromValue(
        execution,
        targetVersion.version_id,
        targetVersion.payload_hash,
        previousActiveRef,
        '/activation/previousActiveRef',
        'CUSTOMER_BASELINE_ACTIVATION_PREVIOUS',
        root.customer_baseline_id,
      );
    }
    await appendReferenceFromValue(
      execution,
      targetVersion.version_id,
      targetVersion.payload_hash,
      {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'CustomerBaselineImpactReview',
        objectId: impactReviewId,
        scope: { enterpriseId: context.enterpriseId, projectId },
        contentHash: {
          algorithm: 'SHA-256',
          digest: impactDigest.hash.toString('hex'),
          canonicalizationVersion: '1',
        },
      },
      '/activation/impactReview',
      'CUSTOMER_BASELINE_IMPACT_REVIEW',
      root.customer_baseline_id,
    );
    return {
      kind: 'COMMITTED',
      resultPayload: {
        customerBaselineRef: activatedRef,
        ...(previousActiveRef === undefined ? {} : { previousActiveRef }),
        projectRef: projectRef(context.enterpriseId, projectId),
        impactPolicyRef,
        impactReviewRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'CustomerBaselineImpactReview',
          objectId: impactReviewId,
          scope: { enterpriseId: context.enterpriseId, projectId },
          contentHash: {
            algorithm: 'SHA-256',
            digest: impactDigest.hash.toString('hex'),
            canonicalizationVersion: '1',
          },
        },
        status: 'CONFIRMED',
        impactStatus,
        affectedReferenceCount: affectedReferences.length,
        aggregateVersion: cas.nextVersion,
        versionNo: targetVersion.version_no,
        payloadHash: targetVersion.payload_hash.toString('hex'),
      } as unknown as CanonicalJsonObject,
    };
  });
}

export type GetActiveBaselineRefsCommandPayload =
  EnterpriseProject.ProjectGetActiveBaselineRefsPayload;

export async function handleGetActiveBaselineRefs(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  payload: GetActiveBaselineRefsCommandPayload,
): Promise<EnterpriseProject.ActiveBaselineRefsView> {
  const projectId = assertExactProjectRef(payload.projectRef, context, {
    ...({
      enterpriseId: context.enterpriseId,
      projectId: projectIdFromPayload(payload),
    } as unknown as CommandEnvelope),
  });
  return withEnterpriseProjectTransaction(db, context, async (trx) => {
    const root = await repo.getCustomerBaselineByProject(trx, context.enterpriseId, projectId);
    if (root?.active_version_id === null || root === undefined) {
      return { aggregateVersions: {} };
    }
    const active = await repo.getCustomerBaselineVersion(trx, root.active_version_id);
    if (active?.version_status !== 'CONFIRMED') {
      throw new EnterpriseBusinessError(
        PROJECT_BASELINE_STATUS_INVALID,
        'active CustomerBaseline pointer does not resolve to a confirmed version',
      );
    }
    return {
      customerBaselineRef: baselineRef(
        context.enterpriseId,
        projectId,
        root.customer_baseline_id,
        active.version_id,
      ),
      aggregateVersions: {
        customerBaseline: aggregateVersion(root.aggregate_version),
        customerBaselineVersion: String(active.version_no),
      },
    };
  });
}

function projectIdFromPayload(payload: GetActiveBaselineRefsCommandPayload): string {
  const reference = asReferenceLike(payload.projectRef);
  const scope = asScopeLike(reference.scope);
  if (typeof scope?.projectId === 'string') return scope.projectId;
  if (typeof reference.objectId === 'string') return reference.objectId;
  return '';
}
