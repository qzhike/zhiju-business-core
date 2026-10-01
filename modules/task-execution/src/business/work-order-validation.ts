import type { Kysely } from 'kysely';
import { getContractRegistry } from '@zhiju/contracts';
import {
  canonicalize,
  hashContractPayload,
  newUuidV7,
  sha256CanonicalJson,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import {
  executeTaskExecutionCommand,
  type CommandEnvelope,
  type CommandExecution,
} from '../persistence/command-runner.js';
import {
  withTaskExecutionTransaction,
  type TaskExecutionDb,
  type TaskExecutionTransaction,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import { WorkOrderDraftRepository } from '../persistence/work-order-draft-repository.js';
import { ContextSnapshotRepository } from '../persistence/context-snapshot-repository.js';
import { TaskReadinessRepository } from '../persistence/task-readiness-repository.js';
import { WorkOrderValidationRepository } from '../persistence/work-order-validation-repository.js';
import {
  evaluateWorkOrderPlan,
  object,
  textValue,
  same,
  hash,
  digest,
  specificationHash,
  requireThat,
  type WorkOrderPolicyObservation,
} from './work-order-validation-plan.js';
import { isFormalContract, formalCriteria, validateFormalTaskDefinition } from './formal-output.js';
import { sql } from 'kysely';
import type { ContextSourceSliceReadPort } from './initial-context-build.js';

const registry = getContractRegistry();
const bytes = (value: string) => Buffer.from(value, 'hex');
const VALIDATION_TYPE = 'zhiju.execution.work_order_validation';
const WORK_ORDER_TYPE = 'zhiju.execution.work_order';
export interface WorkOrderValidationPorts {
  readonly authorizeTaskDefinition?: (ref: CanonicalJsonObject) => Promise<void>;
  readonly readQualityProfile?: (ref: CanonicalJsonObject) => Promise<CanonicalJsonObject>;
  readonly now: () => Date;
  readonly decisionIssuedAt: string;
  readonly actorSnapshotRef: CanonicalJsonObject;
  readonly authorizationDecisionRef: CanonicalJsonObject;
  readonly draftSnapshotRef: CanonicalJsonObject;
  readonly contextSnapshotRef: CanonicalJsonObject;
  readonly decisionExpiries: () => readonly string[];
  /** Revalidates the own and both exact dependency Decisions, without DRAFT eligibility. */
  readonly revalidateAuthorization: () => Promise<void>;
  readonly resolvePolicy: (ref: CanonicalJsonObject) => Promise<WorkOrderPolicyObservation>;
  readonly slices: ContextSourceSliceReadPort;
  readonly classifyCapabilities: (codes: readonly string[]) => Promise<boolean>;
  readonly failAfterOutbox?: boolean;
}
function scopeOf(envelope: CommandEnvelope) {
  requireThat(envelope.projectId);
  return { enterpriseId: envelope.enterpriseId, projectId: envelope.projectId };
}
function exactRef(
  ref: CanonicalJsonObject,
  kind: string,
  type: string,
  scope: CanonicalJsonObject,
) {
  requireThat(ref.kind === kind && ref.objectType === type && same(ref.scope, scope));
  requireThat(
    registry.validateCoreContract(
      `https://schemas.zhiju.local/common/1.0#/$defs/${kind === 'SNAPSHOT' ? 'snapshotRef' : 'contentAddressedRef'}`,
      ref,
    ).valid,
  );
  requireThat(ref.immutableVersionId === undefined);
}
function sorted(values: readonly CanonicalJsonValue[]) {
  return [...values].sort((a, b) =>
    Buffer.compare(Buffer.from(canonicalize(a)), Buffer.from(canonicalize(b))),
  );
}
export function workOrderValidationInputHash(value: CanonicalJsonObject): string {
  return sha256CanonicalJson({
    subjectRefs: value.subjectRefs,
    candidateContractHash: value.candidateContractHash,
    dependencyObservations: value.dependencyObservations,
    sourceWatermarks: value.sourceWatermarks,
  } as CanonicalJsonObject);
}

/** The only pre-Claim Freeze read, after revalidating its own Decision. */
export async function readExactWorkOrderValidation(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  ref: CanonicalJsonObject,
  workOrderRef: CanonicalJsonObject,
) {
  exactRef(ref, 'SNAPSHOT', VALIDATION_TYPE, object(workOrderRef.scope));
  requireThat(ref.objectId === ref.snapshotId);
  return withTaskExecutionTransaction(db, context, async (trx) =>
    readJudgment(trx, ref, workOrderRef),
  );
}
async function readJudgment(
  trx: TaskExecutionTransaction,
  ref: CanonicalJsonObject,
  workOrderRef: CanonicalJsonObject,
) {
  const row = await new TaskReadinessRepository().readExecutionJudgment(
    trx,
    textValue(ref.snapshotId),
  );
  requireThat(row?.judgment_kind === 'WORK_ORDER_VALIDATION');
  const payload = object(row.canonical_payload);
  requireThat(
    sha256CanonicalJson(payload) === digest(ref.contentHash) &&
      row.payload_hash.equals(bytes(digest(ref.contentHash))) &&
      same(payload.workOrderRef, workOrderRef) &&
      same(payload.scope, ref.scope),
  );
  requireThat(
    payload.judgmentId === ref.objectId &&
      payload.inputHash === workOrderValidationInputHash(payload),
  );
  return payload;
}
async function facts(
  execution: CommandExecution,
  envelope: CommandEnvelope,
  candidate: CanonicalJsonObject,
  ports: WorkOrderValidationPorts,
  freeze: boolean,
) {
  const scope = scopeOf(envelope),
    draftRef = ports.draftSnapshotRef,
    contextRef = ports.contextSnapshotRef;
  exactRef(draftRef, 'CONTENT_ADDRESSED', 'zhiju.execution.work_order_draft_snapshot', scope);
  exactRef(contextRef, 'SNAPSHOT', 'zhiju.execution.context_snapshot', scope);
  requireThat(same(candidate.contextSnapshotRef, contextRef));
  const repo = new WorkOrderDraftRepository();
  const draft = await repo.readWorkOrderDraftSnapshotByIdentity(
    execution.trx,
    textValue(draftRef.objectId),
    bytes(digest(draftRef.contentHash)),
  );
  requireThat(draft?.enterpriseId === scope.enterpriseId && draft.projectId === scope.projectId);
  const stored = object(draft.canonicalPayload);
  requireThat(sha256CanonicalJson(stored) === digest(draftRef.contentHash));
  const task = await repo.readBoundTaskForShare(
    execution.trx,
    textValue(object(stored.taskRef).objectId),
  );
  requireThat(
    task?.enterpriseId === scope.enterpriseId &&
      task.projectId === scope.projectId &&
      ['READY', 'IN_PROGRESS'].includes(task.status),
    'AGGREGATE_STATE_NOT_ALLOWED',
  );
  const root = await (freeze
    ? repo.readWorkOrderRootForUpdate(execution.trx, draft.workOrderId)
    : repo.readWorkOrderRootForShare(execution.trx, draft.workOrderId));
  requireThat(root?.enterpriseId === scope.enterpriseId && root.projectId === scope.projectId);
  requireThat(
    root.workOrderObjectType === WORK_ORDER_TYPE && root.draftSchemaVersion === '1.1',
    'EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH',
  );
  requireThat(root.status === 'DRAFT', 'AGGREGATE_STATE_NOT_ALLOWED');
  requireThat(
    root.currentDraftSnapshotId === draft.snapshotId &&
      root.currentDraftSnapshotHash.equals(draft.payloadHash),
    'EXECUTION_DRAFT_SNAPSHOT_STALE',
  );
  requireThat(
    root.taskId === task.taskId &&
      same(stored.workOrderRef, candidate.workOrderRef) &&
      same(stored.scopeRef, scope),
  );
  if (freeze)
    requireThat(
      root.workOrderId === envelope.targetId &&
        root.aggregateVersion === envelope.expectedAggregateVersion,
      'CONCURRENCY_CONFLICT',
    );
  requireThat(
    root.expiresAt === null || root.expiresAt.getTime() > ports.now().getTime(),
    'EXECUTION_JUDGMENT_STALE',
  );
  const contextRepo = new ContextSnapshotRepository();
  const contextRow = await contextRepo.readContextSnapshot(execution.trx, {
    objectId: textValue(contextRef.objectId),
    snapshotId: textValue(contextRef.snapshotId),
    payloadHash: bytes(digest(contextRef.contentHash)),
  });
  const build = await contextRepo.readContextSnapshotBuild(
    execution.trx,
    textValue(contextRef.snapshotId),
  );
  requireThat(contextRow !== undefined && build?.buildKind === 'INITIAL');
  const context = object(contextRow.canonicalPayload),
    metadata = object(build.canonicalPayload);
  requireThat(
    sha256CanonicalJson(context) === digest(contextRef.contentHash) &&
      sha256CanonicalJson(metadata) === build.payloadHash.toString('hex'),
  );
  requireThat(
    same(metadata.draftSnapshotRef, draftRef) &&
      same(metadata.scopeRef, scope) &&
      same(contextRow.enterpriseId, scope.enterpriseId) &&
      same(contextRow.projectId, scope.projectId),
  );
  requireThat(
    same(object(context.workContext).workOrderRef, candidate.workOrderRef) &&
      same(object(context.workContext).taskRef, candidate.taskRef),
  );
  requireThat(
    same(metadata.audience, { principalId: envelope.principalId, principalKind: 'SERVICE' }) &&
      object(context.projection).audience === envelope.principalId &&
      object(context.projection).purpose === metadata.purpose,
  );
  const sliceExpiries: string[] = [];
  requireThat(Array.isArray(metadata.sliceRefs) && metadata.sliceRefs.length > 0);
  for (const refValue of metadata.sliceRefs) {
    const ref = object(refValue),
      observation = await ports.slices.getContextSourceSlice({ sourceSliceRef: ref });
    requireThat(observation?.useStatus === 'USABLE', 'EXECUTION_JUDGMENT_STALE');
    const slice = observation.slice;
    requireThat(sha256CanonicalJson(slice) === digest(ref.contentHash));
    requireThat(
      Array.isArray(context.sourceWatermarks) &&
        context.sourceWatermarks.some((w) => same(w, object(slice.source).sourceWatermark)),
    );
    if (typeof slice.validUntil === 'string') sliceExpiries.push(slice.validUntil);
  }
  return { root, draft: stored, context, metadata, sliceExpiries };
}
async function evaluate(
  execution: CommandExecution,
  envelope: CommandEnvelope,
  candidate: CanonicalJsonObject,
  ports: WorkOrderValidationPorts,
  policyRef: CanonicalJsonObject,
  evaluatorRef: CanonicalJsonObject,
  freeze: boolean,
) {
  await ports.revalidateAuthorization();
  const observed = await facts(execution, envelope, candidate, ports, freeze);
  const pins = object(candidate.versionPins);
  const validationPolicy = await ports.resolvePolicy(policyRef),
    builderPolicy = await ports.resolvePolicy(object(pins.contextBuilderPolicyRef)),
    controlsPolicy = await ports.resolvePolicy(object(pins.capabilityPolicyRef));
  requireThat(same(validationPolicy.policyRef, policyRef));
  if (isFormalContract(candidate)) {
    requireThat(ports.authorizeTaskDefinition, 'DEPENDENCY_UNAVAILABLE');
    await ports.authorizeTaskDefinition(object(candidate.taskRef));
    const task = await execution.trx
      .selectFrom('task_execution.task')
      .selectAll()
      .where('task_id', '=', textValue(object(candidate.taskRef).objectId))
      .executeTakeFirst();
    requireThat(task?.current_definition_snapshot_id, 'NOT_FOUND');
    const definition = await execution.trx
      .selectFrom('task_execution.task_definition_snapshot')
      .selectAll()
      .where('snapshot_id', '=', task.current_definition_snapshot_id)
      .executeTakeFirst();
    requireThat(
      definition?.schema_version === '2.0' &&
        sha256CanonicalJson(object(definition.canonical_payload)) ===
          definition.payload_hash.toString('hex'),
      'EXECUTION_JUDGMENT_INVALID',
    );
    formalCriteria(candidate, object(object(definition.canonical_payload).definition));
    const taskPlan = validateFormalTaskDefinition(
      object(object(definition.canonical_payload).definition),
    );
    const profile = pins.qualityProfileRef;
    if (taskPlan.quality) {
      requireThat(
        profile &&
          same(profile, object(candidate.riskAndQuality).qualityProfileRef) &&
          ports.readQualityProfile,
        'EXECUTION_CRITERION_UNSUPPORTED',
      );
      const view = await ports.readQualityProfile(object(profile));
      requireThat(view.usable === true, 'EXECUTION_CRITERION_UNSUPPORTED');
      const siblings = (
        await sql<{
          canonical_payload: CanonicalJsonObject;
        }>`SELECT c.canonical_payload FROM task_execution.work_order w JOIN task_execution.work_order_contract c ON c.contract_id=w.frozen_contract_id WHERE w.task_id=${task.task_id}::uuid AND w.work_order_id<>${object(candidate.workOrderRef).objectId}::uuid`.execute(
          execution.trx,
        )
      ).rows;
      requireThat(
        siblings.every(
          (c) =>
            isFormalContract(c.canonical_payload) &&
            same(object(c.canonical_payload.versionPins).qualityProfileRef, profile) &&
            same(object(c.canonical_payload.riskAndQuality).qualityProfileRef, profile),
        ),
        'EXECUTION_CRITERION_UNSUPPORTED',
      );
    } else
      requireThat(
        profile === undefined && object(candidate.riskAndQuality).qualityProfileRef === undefined,
        'EXECUTION_CRITERION_UNSUPPORTED',
      );
  }
  const caps = [
    ...(candidate.allowedCapabilities as CanonicalJsonValue[]),
    ...(candidate.deniedCapabilities as CanonicalJsonValue[]),
  ].map((c) => textValue(object(c).capabilityType));
  const capabilitiesValid = await ports.classifyCapabilities(caps);
  const evaluatedAt = ports.now().toISOString();
  const plan = evaluateWorkOrderPlan({
    ...observed,
    candidate,
    validationPolicy,
    builderPolicy,
    controlsPolicy,
    evaluatorRef,
    serviceId: envelope.principalId,
    decisionIssuedAt: ports.decisionIssuedAt,
    evaluatedAt,
    decisionExpiries: ports.decisionExpiries(),
    capabilitiesValid,
  });
  return { ...observed, ...plan, validationPolicy, evaluatedAt };
}
async function edges(
  execution: CommandExecution,
  envelope: CommandEnvelope,
  ownerHash: string,
  refs: readonly CanonicalJsonObject[],
) {
  for (const [index, ref] of refs.entries())
    await execution.appendReferenceEdge({
      ownerObjectType: envelope.targetType,
      ownerObjectId: envelope.targetId,
      ownerPayloadHash: bytes(ownerHash),
      referencePath: `/dependencies/${index}`,
      targetModule: ref.objectType === 'zhiju.identity.policy' ? 'IdentityPolicy' : 'TaskExecution',
      targetObjectType: textValue(ref.objectType),
      targetObjectId: textValue(ref.objectId),
      ...(ref.versionId === undefined ? {} : { targetVersionId: textValue(ref.versionId) }),
      ...(ref.contentHash === undefined
        ? {}
        : { targetPayloadHash: bytes(digest(ref.contentHash)) }),
      referencePurpose: 'WORK_ORDER_VALIDATION',
    });
}
export async function handleValidateWorkOrderDraft(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: WorkOrderValidationPorts,
) {
  requireThat(
    envelope.commandType === 'execution.validate_work_order_draft' &&
      envelope.commandVersion === '1.0' &&
      envelope.targetType === VALIDATION_TYPE &&
      envelope.principalKind === 'SERVICE',
    'COMMAND_TARGET_MISMATCH',
  );
  const request = structuredClone(envelope.requestPayload),
    candidate = object(request.candidateContract);
  requireThat(same(request.draftSnapshotRef, ports.draftSnapshotRef));
  let deadline: string | undefined;
  const guard = async () => {
    await ports.revalidateAuthorization();
    if (deadline !== undefined)
      requireThat(ports.now().getTime() < Date.parse(deadline), 'EXECUTION_JUDGMENT_STALE');
  };
  return executeTaskExecutionCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const first = await evaluate(
        execution,
        envelope,
        candidate,
        ports,
        object(request.policyRef),
        object(request.evaluatorRef),
        false,
      );
      // Observe the dependencies again while holding Task/WorkOrder locks. A
      // changed policy or Slice cannot be committed as the first observation.
      const result = await evaluate(
        execution,
        envelope,
        candidate,
        ports,
        object(request.policyRef),
        object(request.evaluatorRef),
        false,
      );
      requireThat(
        same(first.dependencyObservations, result.dependencyObservations),
        'EXECUTION_JUDGMENT_STALE',
      );
      deadline = result.validUntil;
      const subjectRefs = [
        object(candidate.workOrderRef),
        ports.draftSnapshotRef,
        ports.contextSnapshotRef,
      ].sort((a, b) =>
        Buffer.compare(
          Buffer.from(`${textValue(a.kind)}:${textValue(a.objectType)}:${canonicalize(a)}`),
          Buffer.from(`${textValue(b.kind)}:${textValue(b.objectType)}:${canonicalize(b)}`),
        ),
      );
      const vp = result.validationPolicy;
      const base: CanonicalJsonObject = {
        judgmentId: envelope.targetId,
        judgmentKind: 'WORK_ORDER_VALIDATION',
        scope: scopeOf(envelope),
        workOrderRef: candidate.workOrderRef as CanonicalJsonValue,
        draftSnapshotRef: ports.draftSnapshotRef,
        candidateContractHash: hashContractPayload(candidate),
        specificationHash: specificationHash(candidate),
        contextSnapshotRef: ports.contextSnapshotRef,
        policyRef: vp.policyRef,
        policyVersionRef: vp.policyVersionRef,
        policyContentHash: digest(vp.contentHash),
        policyEffectiveFrom: vp.effectiveFrom,
        policySupersededAt: vp.supersededAt ?? null,
        evaluatorRef: object(request.evaluatorRef),
        subjectRefs,
        sourceWatermarks: sorted(result.context.sourceWatermarks as CanonicalJsonValue[]),
        producedBy: { principalId: envelope.principalId, principalKind: 'SERVICE' },
        actorSnapshotRef: ports.actorSnapshotRef,
        authorizationDecisionRef: ports.authorizationDecisionRef,
        evaluatedAt: result.evaluatedAt,
        validUntil: result.validUntil,
        validation: result.validation,
        checks: result.checks,
        dependencyObservations: result.dependencyObservations,
      };
      const payload = { ...base, inputHash: workOrderValidationInputHash(base) },
        payloadHash = sha256CanonicalJson(payload);
      const v = result.validation;
      const inserted = await execution.insertWorkOrderValidationJudgment({
        judgmentId: envelope.targetId,
        ...scopeOf(envelope),
        workOrderId: result.root.workOrderId,
        draftSnapshotId: textValue(ports.draftSnapshotRef.objectId),
        draftSnapshotHash: bytes(digest(ports.draftSnapshotRef.contentHash)),
        candidateContractHash: bytes(hashContractPayload(candidate)),
        specificationHash: bytes(specificationHash(candidate)),
        contextSnapshotId: textValue(ports.contextSnapshotRef.snapshotId),
        contextSnapshotHash: bytes(digest(ports.contextSnapshotRef.contentHash)),
        policyVersionRef: vp.policyVersionRef,
        policyContentHash: bytes(digest(vp.contentHash)),
        policyEffectiveFrom: new Date(vp.effectiveFrom),
        policySupersededAt: vp.supersededAt === undefined ? null : new Date(vp.supersededAt),
        evaluatorRef: object(request.evaluatorRef),
        inputHash: bytes(payload.inputHash),
        evaluatedAt: new Date(result.evaluatedAt),
        validUntil: new Date(result.validUntil),
        validationValid: v.valid,
        validationReferencesValid: v.referencesValid,
        validationSpecificationHashValid: v.specificationHashValid,
        validationCapabilityValid: v.capabilityValid,
        validationExecutable: v.executable,
        validationBudgetValid: v.budgetValid,
        validationContextCoverageValid: v.contextCoverageValid,
        canonicalPayload: payload,
        payloadHash: bytes(payloadHash),
        requestPayloadHash: bytes(sha256CanonicalJson(request)),
        sourceCommandId: envelope.commandId,
        createdByPrincipalId: envelope.principalId,
      });
      requireThat(inserted, 'CONCURRENCY_CONFLICT');
      await edges(execution, envelope, payloadHash, [...subjectRefs, vp.policyRef]);
      return {
        kind: 'COMMITTED',
        resultPayload: {
          targetRef: {
            kind: 'OBJECT',
            objectType: VALIDATION_TYPE,
            objectId: envelope.targetId,
            scope: scopeOf(envelope),
          },
          data: {
            validationSnapshotRef: {
              kind: 'SNAPSHOT',
              objectType: VALIDATION_TYPE,
              objectId: envelope.targetId,
              snapshotId: envelope.targetId,
              scope: scopeOf(envelope),
              contentHash: hash(payloadHash),
            },
          },
        },
      };
    },
    guard,
  );
}

export async function handleFreezeWorkOrder(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: WorkOrderValidationPorts,
) {
  requireThat(
    envelope.commandType === 'execution.freeze_work_order' &&
      envelope.commandVersion === '1.0' &&
      envelope.targetType === WORK_ORDER_TYPE &&
      envelope.principalKind === 'SERVICE',
    'COMMAND_TARGET_MISMATCH',
  );
  const request = structuredClone(envelope.requestPayload),
    candidate = object(request.workOrderContract),
    validationRef = object(request.validationSnapshotRef);
  let deadline: string | undefined;
  const guard = async () => {
    await ports.revalidateAuthorization();
    if (deadline !== undefined)
      requireThat(ports.now().getTime() < Date.parse(deadline), 'EXECUTION_JUDGMENT_STALE');
  };
  return executeTaskExecutionCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const judgment = await readJudgment(
        execution.trx,
        validationRef,
        object(candidate.workOrderRef),
      );
      requireThat(
        same(judgment.draftSnapshotRef, ports.draftSnapshotRef) &&
          same(judgment.contextSnapshotRef, ports.contextSnapshotRef),
      );
      requireThat(
        judgment.candidateContractHash === hashContractPayload(candidate) &&
          judgment.specificationHash === specificationHash(candidate) &&
          same(request.specificationHash, candidate.specificationHash),
      );
      const observed = await evaluate(
        execution,
        envelope,
        candidate,
        ports,
        object(judgment.policyRef),
        object(judgment.evaluatorRef),
        true,
      );
      requireThat(
        same(judgment.dependencyObservations, observed.dependencyObservations),
        'EXECUTION_JUDGMENT_STALE',
      );
      const old = object(judgment.validation);
      requireThat(
        [
          'valid',
          'referencesValid',
          'specificationHashValid',
          'capabilityValid',
          'executable',
          'budgetValid',
          'contextCoverageValid',
        ].every((k) => old[k] === true && object(observed.validation)[k] === true),
        'EXECUTION_JUDGMENT_INVALID',
      );
      requireThat(
        same(judgment.checks, observed.checks) &&
          same(old.violations, []) &&
          same(
            judgment.sourceWatermarks,
            sorted(observed.context.sourceWatermarks as CanonicalJsonValue[]),
          ),
        'EXECUTION_JUDGMENT_INVALID',
      );
      deadline = new Date(
        Math.min(Date.parse(textValue(judgment.validUntil)), Date.parse(observed.validUntil)),
      ).toISOString();
      await guard();
      const verified = await evaluate(
        execution,
        envelope,
        candidate,
        ports,
        object(judgment.policyRef),
        object(judgment.evaluatorRef),
        true,
      );
      requireThat(
        same(observed.dependencyObservations, verified.dependencyObservations) &&
          verified.validation.executable,
        'EXECUTION_JUDGMENT_STALE',
      );
      const root = observed.root,
        contractId = textValue(object(candidate.header).contractId),
        contractHash = hashContractPayload(candidate),
        scope = scopeOf(envelope);
      const contractRef = {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.contract.work_order',
        objectId: contractId,
        scope,
        contentHash: hash(contractHash),
      };
      const eventPayload: CanonicalJsonObject = {
        workOrderRef: candidate.workOrderRef as CanonicalJsonValue,
        taskRef: candidate.taskRef as CanonicalJsonValue,
        workOrderContractRef: contractRef,
        ...(candidate.expiresAt === undefined ? {} : { expiresAt: candidate.expiresAt }),
      };
      const eventId = newUuidV7(),
        occurredAt = ports.now(),
        causationId = envelope.causationId ?? envelope.commandId,
        newVersion = (BigInt(root.aggregateVersion) + 1n).toString();
      const event = {
        eventId,
        eventType: 'execution.WorkOrderBecameReady',
        eventVersion: '1.0',
        producerModule: 'task-execution',
        aggregateType: WORK_ORDER_TYPE,
        aggregateId: root.workOrderId,
        aggregateVersion: Number(newVersion),
        scopeRef: scope,
        correlationId: envelope.correlationId,
        causationId,
        commandId: envelope.commandId,
        actorRef: {
          kind: 'OBJECT',
          objectType: 'zhiju.identity.principal',
          objectId: envelope.principalId,
          scope: { enterpriseId: scope.enterpriseId },
        },
        occurredAt: occurredAt.toISOString(),
        dataClassification: 'INTERNAL',
        payload: eventPayload,
        integrity: {
          canonicalizationVersion: '1',
          payloadHash: hash(sha256CanonicalJson(eventPayload)),
        },
      };
      requireThat(
        registry.validateOperation('execution.WorkOrderBecameReady', '1.0', event).valid,
        'API_VALUE_INVALID',
      );
      requireThat(
        await execution.insertWorkOrderContract({
          contractId,
          workOrderId: root.workOrderId,
          ...scope,
          workOrderObjectType: root.workOrderObjectType,
          taskId: root.taskId,
          taskObjectType: root.taskObjectType,
          draftSnapshotId: textValue(ports.draftSnapshotRef.objectId),
          draftSnapshotHash: bytes(digest(ports.draftSnapshotRef.contentHash)),
          contextSnapshotId: textValue(ports.contextSnapshotRef.snapshotId),
          contextSnapshotHash: bytes(digest(ports.contextSnapshotRef.contentHash)),
          validationJudgmentId: textValue(validationRef.snapshotId),
          validationJudgmentHash: bytes(digest(validationRef.contentHash)),
          canonicalPayload: candidate,
          payloadHash: bytes(contractHash),
          specificationHash: bytes(specificationHash(candidate)),
          requestPayloadHash: bytes(sha256CanonicalJson(request)),
          sourceCommandId: envelope.commandId,
          createdByPrincipalId: envelope.principalId,
        }),
        'CONCURRENCY_CONFLICT',
      );
      const cas = await execution.casWorkOrderStatusToReady({
        workOrderId: root.workOrderId,
        ...scope,
        expectedAggregateVersion: root.aggregateVersion,
        currentDraftSnapshotId: root.currentDraftSnapshotId,
        currentDraftSnapshotHash: root.currentDraftSnapshotHash,
        frozenContractId: contractId,
        frozenContractHash: bytes(contractHash),
        updatedByPrincipalId: envelope.principalId,
      });
      requireThat(cas.updated, 'CONCURRENCY_CONFLICT');
      await edges(execution, envelope, contractHash, [
        ports.draftSnapshotRef,
        ports.contextSnapshotRef,
        validationRef,
        contractRef,
      ]);
      await execution.appendOutbox({
        eventId,
        eventType: 'execution.WorkOrderBecameReady',
        eventVersion: '1.0',
        aggregateType: WORK_ORDER_TYPE,
        aggregateId: root.workOrderId,
        aggregateVersion: newVersion,
        payload: eventPayload,
        scopeMirror: scope,
        causationId,
        occurredAt,
      });
      if (ports.failAfterOutbox) execution.failAfterOutbox();
      return {
        kind: 'COMMITTED',
        resultPayload: {
          workOrderRef: candidate.workOrderRef as CanonicalJsonValue,
          workOrderContractRef: contractRef,
          aggregateVersion: newVersion,
        },
      };
    },
    guard,
  );
}

export async function handleGetWorkOrderContract(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  workOrderRef: CanonicalJsonObject,
  revalidate: () => Promise<void>,
) {
  await revalidate();
  return withTaskExecutionTransaction(db, context, async (trx) => {
    const root = await new WorkOrderDraftRepository().readWorkOrderRoot(
      trx,
      textValue(workOrderRef.objectId),
    );
    requireThat(
      root !== undefined &&
        root.status !== 'DRAFT' &&
        root.frozenContractId !== null &&
        root.frozenContractHash !== null,
      'NOT_FOUND',
    );
    const scope = { enterpriseId: root.enterpriseId, projectId: root.projectId };
    requireThat(
      same(workOrderRef, {
        kind: 'OBJECT',
        objectType: WORK_ORDER_TYPE,
        objectId: root.workOrderId,
        scope,
      }),
    );
    const row = await new WorkOrderValidationRepository().readWorkOrderContract(trx, {
      workOrderId: root.workOrderId,
      contractId: root.frozenContractId,
      payloadHash: root.frozenContractHash,
    });
    requireThat(row !== undefined);
    const candidate = object(row.canonicalPayload),
      header = object(candidate.header);
    requireThat(
      registry.validateCoreContract('https://schemas.zhiju.local/core/work-order/1.0', candidate)
        .valid &&
        hashContractPayload(candidate) === row.payloadHash.toString('hex') &&
        digest(header.payloadHash) === row.payloadHash.toString('hex') &&
        specificationHash(candidate) === row.specificationHash.toString('hex') &&
        digest(candidate.specificationHash) === row.specificationHash.toString('hex') &&
        same(candidate.workOrderRef, workOrderRef) &&
        object(candidate.taskRef).objectId === root.taskId &&
        object(candidate.taskRef).objectType === root.taskObjectType &&
        same(object(candidate.taskRef).scope, scope) &&
        same(candidate.projectRef, {
          kind: 'OBJECT',
          objectType: 'zhiju.project.project',
          objectId: root.projectId,
          scope,
        }) &&
        header.contractId === root.frozenContractId,
    );
    const result = {
      workOrderRef,
      workOrderContract: candidate,
      contractRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.contract.work_order',
        objectId: root.frozenContractId,
        scope,
        contentHash: hash(row.payloadHash.toString('hex')),
      },
    };
    await revalidate();
    return result;
  });
}

/** Immutable dependency inventory for current authorization of historical replay.
 * It deliberately does not test DRAFT status or revive historical validity. */
export async function readWorkOrderValidationContextMetadata(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  draftRef: CanonicalJsonObject,
  contextRef: CanonicalJsonObject,
  revalidate: () => Promise<void>,
): Promise<CanonicalJsonObject> {
  await revalidate();
  return withTaskExecutionTransaction(db, context, async (trx) => {
    exactRef(
      draftRef,
      'CONTENT_ADDRESSED',
      'zhiju.execution.work_order_draft_snapshot',
      object(contextRef.scope),
    );
    exactRef(contextRef, 'SNAPSHOT', 'zhiju.execution.context_snapshot', object(draftRef.scope));
    const repo = new ContextSnapshotRepository();
    const row = await repo.readContextSnapshot(trx, {
      objectId: textValue(contextRef.objectId),
      snapshotId: textValue(contextRef.snapshotId),
      payloadHash: bytes(digest(contextRef.contentHash)),
    });
    const build = await repo.readContextSnapshotBuild(trx, textValue(contextRef.snapshotId));
    requireThat(row !== undefined && build?.buildKind === 'INITIAL');
    const metadata = object(build.canonicalPayload);
    requireThat(
      sha256CanonicalJson(object(row.canonicalPayload)) === digest(contextRef.contentHash) &&
        sha256CanonicalJson(metadata) === build.payloadHash.toString('hex') &&
        same(metadata.draftSnapshotRef, draftRef),
    );
    await revalidate();
    return metadata;
  });
}
