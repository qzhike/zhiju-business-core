import type { Kysely } from 'kysely';
import { ContractRegistry } from '@zhiju/contracts';
import {
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
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import { FirstRunRepository } from '../persistence/first-run-repository.js';
import { validateWorkOrderControlsPolicy } from './policy-profiles.js';
import {
  digest,
  hash,
  object,
  requireThat,
  same,
  textValue,
} from './work-order-validation-plan.js';

const registry = new ContractRegistry();
const WORK_ORDER = 'zhiju.execution.work_order';
const RUN = 'execution.run';
const RUNTIME = {
  adapterCode: 'te.human_operated.synthetic',
  adapterVersion: '1.0',
  harnessId: 'zhiju.runtime.synthetic',
  harnessVersion: '1.0',
  provider: 'synthetic',
  modelId: 'synthetic',
  modelConfigHash: hash(sha256CanonicalJson({})),
} as const;

export interface ControlledFirstRunPorts {
  readonly now: () => Date;
  readonly trustedStartedAt: string | undefined;
  readonly decisionExpiresAt: string;
  readonly revalidateAuthorization: () => Promise<void>;
  readonly readContract: (ref: CanonicalJsonObject) => Promise<{
    contractRef: CanonicalJsonObject;
    workOrderContract: CanonicalJsonObject;
  }>;
  readonly readContext: (ref: CanonicalJsonObject) => Promise<{
    contextSnapshotRef: CanonicalJsonObject;
    projectContextContract: CanonicalJsonObject;
  }>;
  readonly resolveControls: (ref: CanonicalJsonObject) => Promise<{
    policyRef: CanonicalJsonObject;
    policySchemaRefs: readonly unknown[];
    policyDocument: unknown;
    useStatus: string;
    effectiveFrom: string;
    supersededAt?: string;
  }>;
  readonly readBundle: (
    ref: CanonicalJsonObject,
    runRef: CanonicalJsonObject,
  ) => Promise<{
    bundleRef: CanonicalJsonObject;
    payload: CanonicalJsonObject;
    useStatus: string;
  }>;
  readonly readAttempt: (ref: CanonicalJsonObject) => Promise<CanonicalJsonObject>;
  readonly readRuntimeAdapterIdentity: (ref: CanonicalJsonObject) => Promise<{
    runtimeAdapterIdentityRef: CanonicalJsonObject;
    attemptRef: CanonicalJsonObject;
    runRef: CanonicalJsonObject;
    bindingHash: CanonicalJsonObject;
    runtimeBinding: CanonicalJsonObject;
    ackObservationId: string;
    source: string;
  }>;
  readonly readRunState: (ref: CanonicalJsonObject) => Promise<CanonicalJsonObject>;
  readonly additionalExpiries?: () => readonly string[];
  readonly failAfterOutbox?: boolean;
}

function scope(envelope: CommandEnvelope) {
  requireThat(envelope.projectId !== undefined);
  return { enterpriseId: envelope.enterpriseId, projectId: envelope.projectId };
}
function ref(kind: string, type: string, id: string, subjectScope: CanonicalJsonObject) {
  return { kind, objectType: type, objectId: id, scope: subjectScope };
}
function requireRef(
  value: CanonicalJsonObject,
  kind: string,
  type: string,
  subjectScope: CanonicalJsonObject,
) {
  requireThat(value.kind === kind && value.objectType === type && same(value.scope, subjectScope));
  requireThat(
    registry.validateCoreContract(
      `https://schemas.zhiju.local/common/1.0#/$defs/${kind === 'SNAPSHOT' ? 'snapshotRef' : kind === 'CONTENT_ADDRESSED' ? 'contentAddressedRef' : kind === 'VERSIONED' ? 'versionedRef' : 'objectRef'}`,
      value,
    ).valid,
  );
}
function deadline(now: Date, values: readonly (string | undefined | null)[]) {
  const parsed = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => Date.parse(value));
  requireThat(parsed.every(Number.isFinite));
  const minimum = Math.min(...parsed);
  requireThat(Number.isFinite(minimum) && minimum > now.getTime(), 'EXECUTION_JUDGMENT_STALE');
  return new Date(minimum);
}
function expiryOf(value: CanonicalJsonObject) {
  return typeof value.expiresAt === 'string' ? value.expiresAt : undefined;
}
async function dependencies(workOrderRef: CanonicalJsonObject, ports: ControlledFirstRunPorts) {
  const contractView = await ports.readContract(workOrderRef);
  const contract = contractView.workOrderContract;
  requireThat(
    same(contract.workOrderRef, workOrderRef) &&
      hashContractPayload(contract) === digest(object(contractView.contractRef.contentHash)) &&
      registry.validateCoreContract('https://schemas.zhiju.local/core/work-order/1.0', contract)
        .valid,
  );
  const contextRef = object(contract.contextSnapshotRef);
  requireRef(
    contextRef,
    'SNAPSHOT',
    'zhiju.execution.context_snapshot',
    object(workOrderRef.scope),
  );
  const contextView = await ports.readContext(contextRef);
  requireThat(same(contextView.contextSnapshotRef, contextRef));
  const controlsRef = object(object(contract.versionPins).capabilityPolicyRef);
  requireThat(same(object(object(contract.executionPolicy).leasePolicyRef), controlsRef));
  const controls = await ports.resolveControls(controlsRef);
  requireThat(controls.useStatus === 'USABLE' && same(controls.policyRef, controlsRef));
  const validated = validateWorkOrderControlsPolicy(controls);
  requireThat(validated.valid);
  const limits = object(validated.rules.controls.budget);
  const secondsText = limits.wallClockLimit;
  requireThat(typeof secondsText === 'string' && /^PT[1-9][0-9]*S$/u.test(secondsText));
  const seconds = BigInt(secondsText.slice(2, -1));
  requireThat(seconds <= BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000)));
  return {
    contract,
    contractRef: contractView.contractRef,
    contextRef,
    context: contextView.projectContextContract,
    controlsRef,
    controls,
    seconds,
  };
}
function eventEnvelope(
  envelope: CommandEnvelope,
  type: 'execution.WorkOrderQueued' | 'execution.RunStarted',
  aggregateId: string,
  aggregateType: string,
  aggregateVersion: string,
  payload: CanonicalJsonObject,
  occurredAt: Date,
) {
  const result = {
    eventId: newUuidV7(),
    eventType: type,
    eventVersion: '1.0',
    producerModule: 'task-execution',
    aggregateType,
    aggregateId,
    aggregateVersion: Number(aggregateVersion),
    scopeRef: scope(envelope),
    correlationId: envelope.correlationId,
    causationId: envelope.causationId ?? envelope.commandId,
    commandId: envelope.commandId,
    actorRef: ref('OBJECT', 'zhiju.identity.principal', envelope.principalId, {
      enterpriseId: envelope.enterpriseId,
    }),
    occurredAt: occurredAt.toISOString(),
    dataClassification: 'INTERNAL',
    payload,
    integrity: { canonicalizationVersion: '1', payloadHash: hash(sha256CanonicalJson(payload)) },
  };
  requireThat(registry.validateOperation(type, '1.0', result).valid, 'API_VALUE_INVALID');
  return result;
}
async function appendEvent(
  execution: CommandExecution,
  envelope: CommandEnvelope,
  event: ReturnType<typeof eventEnvelope>,
) {
  await execution.appendOutbox({
    eventId: event.eventId,
    eventType: event.eventType,
    eventVersion: '1.0',
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    aggregateVersion: String(event.aggregateVersion),
    payload: event.payload,
    scopeMirror: scope(envelope),
    causationId: event.causationId,
    occurredAt: new Date(event.occurredAt),
  });
}
async function appendEdge(
  execution: CommandExecution,
  envelope: CommandEnvelope,
  path: string,
  target: CanonicalJsonObject,
  ownerId: string,
  ownerType: string,
  targetModule: string,
) {
  await execution.appendReferenceEdge({
    ownerObjectType: ownerType,
    ownerObjectId: ownerId,
    referencePath: path,
    targetModule,
    targetObjectType: textValue(target.objectType),
    targetObjectId: textValue(target.objectId),
    ...(target.contentHash === undefined
      ? {}
      : {
          targetPayloadHash: Buffer.from(digest(target.contentHash), 'hex'),
        }),
    referencePurpose: 'EXECUTION_BINDING',
  });
}

export async function handleQueueWorkOrder(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: ControlledFirstRunPorts,
) {
  const request = envelope.requestPayload;
  requireThat(
    envelope.commandType === 'execution.queue_work_order' &&
      envelope.commandVersion === '1.0' &&
      envelope.targetType === WORK_ORDER &&
      request.notBefore === undefined &&
      (request.requestedRuntimeClass === undefined ||
        request.requestedRuntimeClass === RUNTIME.adapterCode),
    'AGGREGATE_STATE_NOT_ALLOWED',
  );
  const subjectScope = scope(envelope);
  const workOrderRef = ref('OBJECT', WORK_ORDER, envelope.targetId, subjectScope);
  const guard = async () => {
    await ports.revalidateAuthorization();
    deadline(ports.now(), [ports.decisionExpiresAt]);
  };
  await guard();
  return executeTaskExecutionCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const repo = new FirstRunRepository();
      const root = await repo.readWorkOrderForUpdate(execution.trx, envelope.targetId);
      requireThat(
        root?.enterprise_id === envelope.enterpriseId && root.project_id === subjectScope.projectId,
        'NOT_FOUND',
      );
      requireThat(
        root.status === 'READY' &&
          root.draft_schema_version === '1.1' &&
          root.work_order_object_type === WORK_ORDER &&
          root.aggregate_version === envelope.expectedAggregateVersion &&
          root.frozen_contract_id !== null &&
          root.frozen_contract_hash !== null,
        'AGGREGATE_STATE_NOT_ALLOWED',
      );
      const deps = await dependencies(workOrderRef, ports);
      requireThat(
        same(request.queuePolicyRef, deps.controlsRef) &&
          deps.contractRef.objectId === root.frozen_contract_id &&
          digest(object(deps.contractRef.contentHash)) ===
            root.frozen_contract_hash.toString('hex') &&
          same(deps.contextRef, deps.contract.contextSnapshotRef),
      );
      deadline(ports.now(), [
        root.expires_at?.toISOString(),
        expiryOf(deps.contract),
        expiryOf(deps.context),
        deps.controls.supersededAt,
        ports.decisionExpiresAt,
        ...(ports.additionalExpiries?.() ?? []),
      ]);
      await guard();
      const queuedAt = ports.now();
      requireThat(
        await execution.queueWorkOrder({
          workOrderId: root.work_order_id,
          ...subjectScope,
          expectedVersion: root.aggregate_version,
          policyRef: deps.controlsRef,
          queuedAt,
        }),
        'CONCURRENCY_CONFLICT',
      );
      const aggregateVersion = (BigInt(root.aggregate_version) + 1n).toString();
      const payload: CanonicalJsonObject = { workOrderRef, queuePolicyRef: deps.controlsRef };
      const event = eventEnvelope(
        envelope,
        'execution.WorkOrderQueued',
        root.work_order_id,
        WORK_ORDER,
        aggregateVersion,
        payload,
        queuedAt,
      );
      await appendEdge(
        execution,
        envelope,
        '/queuePolicyRef',
        deps.controlsRef,
        root.work_order_id,
        WORK_ORDER,
        'identity-policy',
      );
      await appendEvent(execution, envelope, event);
      if (ports.failAfterOutbox) execution.failAfterOutbox();
      return {
        kind: 'COMMITTED',
        resultPayload: { workOrderRef, status: 'QUEUED', aggregateVersion },
      };
    },
    guard,
  );
}

export async function handleCreateFirstRun(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: ControlledFirstRunPorts,
) {
  requireThat(
    envelope.commandType === 'execution.create_run' &&
      envelope.commandVersion === '1.0' &&
      envelope.targetType === RUN,
  );
  const subjectScope = scope(envelope),
    creation = object(envelope.requestPayload.creation);
  const workOrderRef = object(creation.workOrderRef);
  requireRef(workOrderRef, 'OBJECT', WORK_ORDER, subjectScope);
  const runRef = ref('OBJECT', RUN, envelope.targetId, subjectScope);
  const guard = async () => {
    await ports.revalidateAuthorization();
    deadline(ports.now(), [ports.decisionExpiresAt]);
  };
  await guard();
  return executeTaskExecutionCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const repo = new FirstRunRepository();
      const root = await repo.readWorkOrderForUpdate(
        execution.trx,
        textValue(workOrderRef.objectId),
      );
      requireThat(
        root?.enterprise_id === envelope.enterpriseId && root.project_id === subjectScope.projectId,
        'NOT_FOUND',
      );
      requireThat(
        root.status === 'QUEUED' &&
          root.frozen_contract_id !== null &&
          root.frozen_contract_hash !== null &&
          root.queue_policy_ref !== null,
        'AGGREGATE_STATE_NOT_ALLOWED',
      );
      const deps = await dependencies(workOrderRef, ports);
      requireThat(
        same(creation.workOrderContractRef, deps.contractRef) &&
          same(creation.contextSnapshotRef, deps.contextRef) &&
          same(creation.leasePolicyRef, deps.controlsRef) &&
          same(root.queue_policy_ref, deps.controlsRef) &&
          deps.contractRef.objectId === root.frozen_contract_id &&
          digest(object(deps.contractRef.contentHash)) ===
            root.frozen_contract_hash.toString('hex') &&
          same(creation.runtimeBinding, RUNTIME) &&
          creation.attemptNumber === 1 &&
          object(deps.contract.executionPolicy).maxAttempts === 1,
        'AGGREGATE_STATE_NOT_ALLOWED',
      );
      const bundleRef = object(creation.capabilityGrantRef);
      requireRef(
        bundleRef,
        'CONTENT_ADDRESSED',
        'zhiju.identity.execution_capability_bundle',
        subjectScope,
      );
      const bundle = await ports.readBundle(bundleRef, runRef);
      requireThat(
        bundle.useStatus === 'USABLE' &&
          same(bundle.bundleRef, bundleRef) &&
          sha256CanonicalJson(bundle.payload) === digest(bundleRef.contentHash) &&
          same(bundle.payload.runRef, runRef) &&
          same(bundle.payload.workOrderRef, workOrderRef) &&
          same(bundle.payload.workOrderContractRef, deps.contractRef) &&
          same(bundle.payload.contextSnapshotRef, deps.contextRef),
      );
      const createdAt = ports.now();
      const wallUntil = createdAt.getTime() + Number(deps.seconds) * 1000;
      requireThat(Number.isSafeInteger(wallUntil));
      const leaseExpiresAt = deadline(createdAt, [
        new Date(wallUntil).toISOString(),
        root.expires_at?.toISOString(),
        expiryOf(deps.contract),
        expiryOf(deps.context),
        textValue(bundle.payload.validUntil),
        deps.controls.supersededAt,
        ports.decisionExpiresAt,
        ...(ports.additionalExpiries?.() ?? []),
      ]);
      requireThat(creation.executionDeadline === leaseExpiresAt.toISOString());
      await guard();
      const leaseId = newUuidV7();
      requireThat(
        await execution.insertFirstRun({
          runId: envelope.targetId,
          ...subjectScope,
          workOrderId: root.work_order_id,
          workOrderRef,
          workOrderContractRef: deps.contractRef,
          contextSnapshotRef: deps.contextRef,
          capabilityGrantRef: bundleRef,
          runtimeBinding: RUNTIME,
          leasePolicyRef: deps.controlsRef,
          leaseId,
          leaseExpiresAt,
          createdAt,
          principalId: envelope.principalId,
        }),
        'CONCURRENCY_CONFLICT',
      );
      await execution.insertFirstRunClaim({
        runId: envelope.targetId,
        workOrderId: root.work_order_id,
        ...subjectScope,
      });
      for (const [path, value, module] of [
        ['/workOrderRef', workOrderRef, 'task-execution'],
        ['/workOrderContractRef', deps.contractRef, 'task-execution'],
        ['/contextSnapshotRef', deps.contextRef, 'task-execution'],
        ['/capabilityGrantRef', bundleRef, 'identity-policy'],
        ['/leasePolicyRef', deps.controlsRef, 'identity-policy'],
      ] as const)
        await appendEdge(execution, envelope, path, value, envelope.targetId, RUN, module);
      return {
        kind: 'COMMITTED',
        resultPayload: {
          runRef,
          status: 'CREATED',
          leaseId,
          fencingToken: 1,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
        },
      };
    },
    guard,
  );
}

export async function handleStartFirstRun(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: ControlledFirstRunPorts,
) {
  requireThat(
    envelope.commandType === 'execution.start_run' &&
      envelope.commandVersion === '1.0' &&
      envelope.targetType === RUN,
  );
  const subjectScope = scope(envelope),
    request = envelope.requestPayload;
  const runRef = ref('OBJECT', RUN, envelope.targetId, subjectScope);
  const attemptRef = object(request.runtimeAttemptRef);
  requireRef(attemptRef, 'OBJECT', 'integration.runtime_attempt', subjectScope);
  const guard = async () => {
    await ports.revalidateAuthorization();
    deadline(ports.now(), [ports.decisionExpiresAt]);
  };
  await guard();
  return executeTaskExecutionCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const repo = new FirstRunRepository();
      const run = await repo.readRunForUpdate(execution.trx, envelope.targetId);
      requireThat(
        run?.enterprise_id === envelope.enterpriseId && run.project_id === subjectScope.projectId,
        'NOT_FOUND',
      );
      requireThat(
        run.status === 'CREATED' &&
          run.aggregate_version === envelope.expectedAggregateVersion &&
          run.lease_id === request.leaseId &&
          typeof request.fencingToken === 'number' &&
          Number.isSafeInteger(request.fencingToken) &&
          run.fencing_token === String(request.fencingToken) &&
          ports.now().getTime() < run.lease_expires_at.getTime(),
        'AGGREGATE_STATE_NOT_ALLOWED',
      );
      const claim = await repo.readClaim(execution.trx, run.run_id);
      requireThat(
        claim?.status === 'ACTIVE' &&
          claim.work_order_id === run.work_order_id &&
          claim.fencing_token === run.fencing_token,
      );
      const workOrderRef = object(run.work_order_ref);
      const deps = await dependencies(workOrderRef, ports);
      requireThat(
        same(run.work_order_contract_ref, deps.contractRef) &&
          same(run.context_snapshot_ref, deps.contextRef) &&
          same(run.lease_policy_ref, deps.controlsRef),
      );
      const bundleRef = object(run.capability_grant_ref);
      const bundle = await ports.readBundle(bundleRef, runRef);
      requireThat(bundle.useStatus === 'USABLE' && same(bundle.bundleRef, bundleRef));
      const attempt = await ports.readAttempt(attemptRef);
      const runtimeIdentity = await ports.readRuntimeAdapterIdentity(attemptRef);
      const invocation = object(attempt.invocationBinding),
        ack = object(attempt.acknowledgement);
      requireThat(
        attempt.status === 'SUCCEEDED' &&
          same(attempt.attemptRef, attemptRef) &&
          same(invocation.runRef, runRef) &&
          same(invocation.workOrderContractRef, deps.contractRef) &&
          same(invocation.contextSnapshotRef, deps.contextRef) &&
          same(invocation.capabilityGrantRef, bundleRef) &&
          invocation.leaseId === run.lease_id &&
          typeof invocation.fencingToken === 'number' &&
          Number.isSafeInteger(invocation.fencingToken) &&
          String(invocation.fencingToken) === run.fencing_token &&
          invocation.leaseExpiresAt === run.lease_expires_at.toISOString() &&
          same(invocation.runtimeBinding, run.runtime_binding) &&
          sha256CanonicalJson(object(attempt.request)) === digest(attempt.requestPayloadHash) &&
          sha256CanonicalJson({
            attemptRef,
            request: attempt.request as CanonicalJsonValue,
            invocationBinding: invocation,
          }) === digest(attempt.bindingHash) &&
          ack.source === 'SYNTHETIC_DRIVER' &&
          object(ack.rawReceiptRef).objectType === 'integration.raw_external_receipt',
      );
      requireThat(
        same(runtimeIdentity.attemptRef, attemptRef) &&
          same(runtimeIdentity.runRef, runRef) &&
          same(runtimeIdentity.bindingHash, attempt.bindingHash) &&
          same(runtimeIdentity.runtimeBinding, run.runtime_binding) &&
          runtimeIdentity.ackObservationId === ack.observationId &&
          runtimeIdentity.source === 'SYNTHETIC_DRIVER',
      );
      requireRef(
        runtimeIdentity.runtimeAdapterIdentityRef,
        'OBJECT',
        'zhiju.runtime.runtime',
        subjectScope,
      );
      const requestedStart = Date.parse(textValue(request.startedAt));
      requireThat(
        Number.isFinite(requestedStart) &&
          ports.trustedStartedAt !== undefined &&
          request.startedAt === ports.trustedStartedAt &&
          requestedStart <= ports.now().getTime() &&
          ports.now().getTime() < run.lease_expires_at.getTime(),
      );
      await guard();
      const startedAt = new Date(requestedStart);
      requireThat(
        await execution.startFirstRun({
          runId: run.run_id,
          ...subjectScope,
          expectedVersion: run.aggregate_version,
          leaseId: run.lease_id,
          fencingToken: run.fencing_token,
          attemptRef,
          runtimeAdapterIdentityRef: runtimeIdentity.runtimeAdapterIdentityRef,
          startedAt,
        }),
        'CONCURRENCY_CONFLICT',
      );
      const aggregateVersion = (BigInt(run.aggregate_version) + 1n).toString();
      const payload: CanonicalJsonObject = {
        runRef,
        workOrderRef,
        attemptNumber: 1,
        runtimeBindingSummary: object(run.runtime_binding),
        contextSnapshotRef: deps.contextRef,
      };
      const event = eventEnvelope(
        envelope,
        'execution.RunStarted',
        run.run_id,
        RUN,
        aggregateVersion,
        payload,
        startedAt,
      );
      await appendEdge(
        execution,
        envelope,
        '/runtimeAttemptRef',
        attemptRef,
        run.run_id,
        RUN,
        'integration-gateway',
      );
      await appendEvent(execution, envelope, event);
      if (ports.failAfterOutbox) execution.failAfterOutbox();
      return { kind: 'COMMITTED', resultPayload: { runRef, status: 'RUNNING', aggregateVersion } };
    },
    guard,
  );
}

export async function handleReconcileFirstRun(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: ControlledFirstRunPorts,
) {
  requireThat(
    envelope.commandType === 'execution.reconcile_work_order_execution' &&
      envelope.commandVersion === '1.0' &&
      envelope.targetType === WORK_ORDER,
  );
  const subjectScope = scope(envelope),
    triggerRef = object(envelope.requestPayload.triggerRef);
  requireRef(triggerRef, 'OBJECT', RUN, subjectScope);
  const workOrderRef = ref('OBJECT', WORK_ORDER, envelope.targetId, subjectScope);
  await ports.revalidateAuthorization();
  const runState = await ports.readRunState(triggerRef);
  requireThat(runState.status === 'RUNNING' && same(runState.runRef, triggerRef));
  return executeTaskExecutionCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const repo = new FirstRunRepository();
      const root = await repo.readWorkOrderForUpdate(execution.trx, envelope.targetId);
      requireThat(
        root?.enterprise_id === envelope.enterpriseId && root.project_id === subjectScope.projectId,
        'NOT_FOUND',
      );
      const run = await repo.readRun(execution.trx, textValue(triggerRef.objectId));
      const claim = await repo.readClaim(execution.trx, textValue(triggerRef.objectId));
      requireThat(
        run?.status === 'RUNNING' &&
          run.work_order_id === root.work_order_id &&
          run.enterprise_id === envelope.enterpriseId &&
          run.project_id === subjectScope.projectId &&
          claim?.status === 'ACTIVE' &&
          claim.work_order_id === root.work_order_id,
      );
      requireThat(
        root.status === 'QUEUED' && root.aggregate_version === envelope.expectedAggregateVersion,
        'AGGREGATE_STATE_NOT_ALLOWED',
      );
      await ports.revalidateAuthorization();
      requireThat(
        await execution.reconcileWorkOrder({
          workOrderId: root.work_order_id,
          ...subjectScope,
          expectedVersion: root.aggregate_version,
        }),
        'CONCURRENCY_CONFLICT',
      );
      await appendEdge(
        execution,
        envelope,
        '/triggerRef',
        triggerRef,
        root.work_order_id,
        WORK_ORDER,
        'task-execution',
      );
      return { kind: 'COMMITTED', resultPayload: { workOrderRef, status: 'RUNNING' } };
    },
    ports.revalidateAuthorization,
  );
}

export async function handleGetRunDispatchBinding(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  runRef: CanonicalJsonObject,
  ports: ControlledFirstRunPorts,
) {
  await ports.revalidateAuthorization();
  const subjectScope = object(runRef.scope);
  requireRef(runRef, 'OBJECT', RUN, subjectScope);
  return withTaskExecutionTransaction(db, context, async (trx) => {
    const repo = new FirstRunRepository();
    const run = await repo.readRun(trx, textValue(runRef.objectId));
    const claim = await repo.readClaim(trx, textValue(runRef.objectId));
    requireThat(run !== undefined, 'NOT_FOUND');
    requireThat(
      run.enterprise_id === subjectScope.enterpriseId &&
        run.project_id === subjectScope.projectId &&
        (run.status === 'CREATED' || run.status === 'STARTING') &&
        claim?.status === 'ACTIVE' &&
        claim.work_order_id === run.work_order_id &&
        ports.now().getTime() < run.lease_expires_at.getTime(),
      'NOT_FOUND',
    );
    const bundleRef = object(run.capability_grant_ref);
    const deps = await dependencies(object(run.work_order_ref), ports);
    requireThat(
      same(deps.contractRef, run.work_order_contract_ref) &&
        same(deps.contextRef, run.context_snapshot_ref) &&
        same(deps.controlsRef, run.lease_policy_ref),
    );
    const bundle = await ports.readBundle(bundleRef, runRef);
    requireThat(bundle.useStatus === 'USABLE' && same(bundle.bundleRef, bundleRef));
    const result = {
      runRef,
      workOrderRef: object(run.work_order_ref),
      workOrderContractRef: object(run.work_order_contract_ref),
      contextSnapshotRef: object(run.context_snapshot_ref),
      capabilityGrantRef: bundleRef,
      runtimeBinding: object(run.runtime_binding),
      leaseId: run.lease_id,
      fencingToken: Number(run.fencing_token),
      leaseExpiresAt: run.lease_expires_at.toISOString(),
      executionDeadline: run.execution_deadline.toISOString(),
      status: run.status,
      aggregateVersion: Number(run.aggregate_version),
    };
    requireThat(
      registry.validateOperationResult('execution.get_run_dispatch_binding', '1.0', result).valid,
      'INTERNAL_CONTRACT_VIOLATION',
    );
    await ports.revalidateAuthorization();
    return result;
  });
}

export async function handleGetRunState(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  runRef: CanonicalJsonObject,
  revalidate: () => Promise<void>,
) {
  await revalidate();
  const subjectScope = object(runRef.scope);
  requireRef(runRef, 'OBJECT', RUN, subjectScope);
  return withTaskExecutionTransaction(db, context, async (trx) => {
    const repo = new FirstRunRepository();
    const run = await repo.readRun(trx, textValue(runRef.objectId));
    requireThat(run !== undefined, 'NOT_FOUND');
    requireThat(
      run.enterprise_id === subjectScope.enterpriseId && run.project_id === subjectScope.projectId,
      'NOT_FOUND',
    );
    const result = {
      runRef,
      status: run.status,
      attemptNumber: run.attempt_number,
      workOrderRef: object(run.work_order_ref),
      contextSnapshotRef: object(run.context_snapshot_ref),
      runtimeBinding: object(run.runtime_binding),
      currentFencingToken: Number(run.fencing_token),
      ...(run.result_ref === null ? {} : { resultRef: object(run.result_ref) }),
      ...(run.termination_reason === null ? {} : { terminationReason: run.termination_reason }),
      leaseExpiresAt: run.lease_expires_at.toISOString(),
      aggregateVersion: Number(run.aggregate_version),
    };
    requireThat(
      registry.validateOperationResult('execution.get_run_state', '1.0', result).valid,
      'INTERNAL_CONTRACT_VIOLATION',
    );
    await revalidate();
    return result;
  });
}
