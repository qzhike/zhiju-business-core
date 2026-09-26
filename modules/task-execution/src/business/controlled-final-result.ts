import { ContractRegistry, registeredEvaluatorProfileReference } from '@zhiju/contracts';
import {
  canonicalize,
  hashContractPayload,
  newUuidV7,
  sha256CanonicalJson,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import type { Kysely, Selectable } from 'kysely';

import {
  executeTaskExecutionCommand,
  CommandExecutionError,
  type CommandEnvelope,
  type CommandExecution,
} from '../persistence/command-runner.js';
import {
  withTaskExecutionTransaction,
  type RunTable,
  type TaskExecutionDb,
  type TaskExecutionTransaction,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import { hash, object, requireThat, same, textValue } from './work-order-validation-plan.js';
import type {
  ControlledFinalProgress,
  ControlledFinalProgressAdvance,
} from './controlled-final-progress.js';

const registry = new ContractRegistry();
const RUN = 'execution.run';
const RESULT = 'execution.agent_result';
const ACCEPTANCE = 'execution.agent_result_acceptance';
const BUNDLE = 'zhiju.execution.agent_result_validation_bundle';
const VALIDATION = 'zhiju.execution.validation_result';
const validationKinds = ['SCHEMA', 'IDENTITY', 'RUN_BINDING', 'SCOPE', 'BUSINESS_OUTPUT'] as const;
type RunRow = Selectable<RunTable>;

export interface ControlledFinalPorts {
  readonly now: () => Date;
  readonly authorizationValidUntil: () => Date;
  readonly revalidateAuthorization: () => Promise<void>;
  readonly readBinding: (attemptRef: CanonicalJsonObject) => Promise<CanonicalJsonObject>;
  readonly readFinal: (attemptRef: CanonicalJsonObject) => Promise<CanonicalJsonObject>;
  readonly readBundle: (
    bundleRef: CanonicalJsonObject,
    runRef: CanonicalJsonObject,
  ) => Promise<{ bundleRef: CanonicalJsonObject; payload: CanonicalJsonObject; useStatus: string }>;
  readonly resolveControls: (policyRef: CanonicalJsonObject) => Promise<{
    policyRef: CanonicalJsonObject;
    useStatus: string;
    contentHash: CanonicalJsonObject;
    effectiveFrom: string;
    supersededAt?: string;
  }>;
  readonly readSource: (sourceRef: CanonicalJsonObject) => Promise<void>;
  readonly inspectExpiredBundle: (
    bundleRef: CanonicalJsonObject,
    runRef: CanonicalJsonObject,
  ) => Promise<void>;
}

/** A rejected final transaction leaves no Receipt or business facts. Preserve
 * only a masked security record, under the same current command authority. */
async function executeFinalCommand(
  ...args: Parameters<typeof executeTaskExecutionCommand>
): ReturnType<typeof executeTaskExecutionCommand> {
  try {
    return await executeTaskExecutionCommand(...args);
  } catch (error) {
    if (
      !(error instanceof CommandExecutionError) ||
      ![
        'EXECUTION_FINAL_CONFLICT',
        'REFERENCE_INVALID',
        'EXECUTION_CRITERION_UNSUPPORTED',
        'EXECUTION_JUDGMENT_STALE',
        'API_VALUE_INVALID',
      ].includes(error.code)
    )
      throw error;
    const [db, context, envelope, , revalidate] = args;
    await revalidate?.();
    await withTaskExecutionTransaction(db, context, async (trx) => {
      await revalidate?.();
      await trx
        .insertInto('task_execution.audit_record')
        .values({
          audit_id: newUuidV7(),
          enterprise_id: envelope.enterpriseId,
          project_id: envelope.projectId ?? null,
          principal_id: envelope.principalId,
          actor_snapshot_id: envelope.actorSnapshotId,
          authorization_decision_id: envelope.authorizationDecisionId,
          command_id: envelope.commandId,
          command_type: envelope.commandType,
          outcome: 'DENIED',
          error_code: error.code,
          request_payload_hash: Buffer.from(sha256CanonicalJson(envelope.requestPayload), 'hex'),
          target_type: envelope.targetType,
          target_id: envelope.targetId,
          correlation_id: envelope.correlationId,
          causation_id: envelope.causationId ?? null,
          safe_summary: 'controlled final request rejected; business transaction rolled back',
          retention_class: 'REGULATED_AUDIT',
        })
        .execute();
      await revalidate?.();
    });
    throw error;
  }
}

function scope(envelope: CommandEnvelope): CanonicalJsonObject {
  requireThat(envelope.projectId !== undefined);
  return { enterpriseId: envelope.enterpriseId, projectId: envelope.projectId };
}
function ref(
  kind: string,
  objectType: string,
  objectId: string,
  subjectScope: CanonicalJsonObject,
  digest?: string,
): CanonicalJsonObject {
  return {
    kind,
    objectType,
    objectId,
    scope: subjectScope,
    ...(digest === undefined ? {} : { contentHash: hash(digest) }),
  };
}
function projectId(envelope: CommandEnvelope): string {
  requireThat(envelope.projectId !== undefined);
  return envelope.projectId;
}
function digest(value: CanonicalJsonValue): string {
  return sha256CanonicalJson(value);
}
function requireRun(row: RunRow | undefined, envelope: CommandEnvelope): RunRow {
  requireThat(
    row?.enterprise_id === envelope.enterpriseId && row.project_id === envelope.projectId,
    'NOT_FOUND',
  );
  return row;
}
function live(run: RunRow, now: Date): void {
  requireThat(
    now.getTime() < run.lease_expires_at.getTime() &&
      now.getTime() < run.execution_deadline.getTime(),
    'EXECUTION_JUDGMENT_STALE',
  );
}
async function lockedRun(
  trx: TaskExecutionTransaction,
  runId: string,
  envelope: CommandEnvelope,
): Promise<RunRow> {
  return requireRun(
    await trx
      .selectFrom('task_execution.run')
      .selectAll()
      .where('run_id', '=', runId)
      .forUpdate()
      .executeTakeFirst(),
    envelope,
  );
}
async function activeClaim(trx: TaskExecutionTransaction, run: RunRow): Promise<void> {
  const claim = await trx
    .selectFrom('task_execution.work_order_run_claim')
    .selectAll()
    .where('run_id', '=', run.run_id)
    .executeTakeFirst();
  requireThat(
    claim?.status === 'ACTIVE' &&
      claim.work_order_id === run.work_order_id &&
      claim.fencing_token === run.fencing_token,
  );
}
async function evidence(
  trx: TaskExecutionTransaction,
  run: RunRow,
  envelope: CommandEnvelope,
  ports: ControlledFinalPorts,
  requireCurrent = true,
) {
  const subjectScope = scope(envelope);
  const runRef = ref('OBJECT', RUN, run.run_id, subjectScope);
  const attemptRef = object(run.start_attempt_ref);
  const adapterRef = object(run.runtime_adapter_identity_ref);
  requireThat(
    attemptRef.objectType === 'integration.runtime_attempt' &&
      same(attemptRef.scope, subjectScope) &&
      adapterRef.objectType === 'zhiju.runtime.runtime' &&
      same(adapterRef.scope, subjectScope),
  );
  const binding = await ports.readBinding(attemptRef);
  const final = await ports.readFinal(attemptRef);
  const invocation = object(binding.invocationBinding);
  const ack = object(binding.acknowledgement);
  const result = object(final.agentResultContract);
  const resultHash = hashContractPayload(result);
  const contractRow = await trx
    .selectFrom('task_execution.work_order_contract')
    .select(['contract_id', 'enterprise_id', 'project_id', 'canonical_payload', 'payload_hash'])
    .where('work_order_id', '=', run.work_order_id)
    .executeTakeFirst();
  requireThat(
    contractRow?.enterprise_id === envelope.enterpriseId &&
      contractRow.project_id === envelope.projectId &&
      contractRow.contract_id === object(run.work_order_contract_ref).objectId &&
      contractRow.payload_hash.toString('hex') ===
        object(object(run.work_order_contract_ref).contentHash).digest,
  );
  const frozenContract = object(contractRow.canonical_payload);
  requireThat(
    binding.status === 'SUCCEEDED' &&
      same(binding.attemptRef, attemptRef) &&
      same(invocation.runRef, runRef) &&
      same(invocation.workOrderContractRef, run.work_order_contract_ref) &&
      same(invocation.contextSnapshotRef, run.context_snapshot_ref) &&
      same(invocation.capabilityGrantRef, run.capability_grant_ref) &&
      same(invocation.runtimeBinding, run.runtime_binding) &&
      invocation.leaseId === run.lease_id &&
      typeof invocation.fencingToken === 'number' &&
      Number.isSafeInteger(invocation.fencingToken) &&
      invocation.fencingToken === Number(run.fencing_token) &&
      invocation.leaseExpiresAt === run.lease_expires_at.toISOString() &&
      ack.observationId === final.ackObservationId &&
      ack.source === 'SYNTHETIC_DRIVER' &&
      same(final.attemptRef, attemptRef) &&
      same(final.runRef, runRef) &&
      same(final.runtimeAdapterIdentityRef, adapterRef) &&
      same(final.bindingHash, binding.bindingHash) &&
      typeof final.runFencingToken === 'number' &&
      Number.isSafeInteger(final.runFencingToken) &&
      final.runFencingToken === Number(run.fencing_token) &&
      object(final.resultPayloadHash).digest === resultHash &&
      final.source === 'SYNTHETIC_DRIVER' &&
      same(result.runRef, runRef) &&
      same(result.workOrderRef, run.work_order_ref) &&
      same(result.taskRef, frozenContract.taskRef) &&
      same(result.projectRef, frozenContract.projectRef) &&
      same(result.submittedByRuntime, adapterRef) &&
      result.submissionKind === 'FINAL' &&
      result.executionOutcome === 'COMPLETED' &&
      Array.isArray(result.businessOutputs) &&
      result.businessOutputs.length === 0 &&
      Array.isArray(result.workspaceOutputs) &&
      result.workspaceOutputs.length === 0 &&
      Array.isArray(result.findings) &&
      result.findings.length === 0 &&
      Array.isArray(result.knowledgeProposals) &&
      result.knowledgeProposals.length === 0 &&
      Array.isArray(result.inputRequestProposals) &&
      result.inputRequestProposals.length === 0 &&
      Array.isArray(result.followUpProposals) &&
      result.followUpProposals.length === 0 &&
      result.runtimeUsageRef === undefined &&
      result.continuationProposal === undefined,
    'EXECUTION_CRITERION_UNSUPPORTED',
  );
  requireThat(
    registry.validateCoreContract('https://schemas.zhiju.local/core/agent-result/1.0', result)
      .valid,
    'API_VALUE_INVALID',
  );
  requireThat(
    same(object(object(result.header).payloadHash), hash(hashContractPayload(result))) &&
      same(object(result.header).scopeRef, subjectScope) &&
      object(result.header).contractType === 'zhiju.contract.agent_result',
  );
  const submittedAt = Date.parse(textValue(result.submittedAt));
  requireThat(
    Number.isFinite(submittedAt) &&
      run.started_at !== null &&
      run.started_at.getTime() <= submittedAt &&
      submittedAt <= Date.parse(textValue(final.observedAt)),
  );
  const provenance = object(result.provenance);
  requireThat(
    same(provenance.contextSnapshotRef, run.context_snapshot_ref) &&
      same(provenance.workOrderContractRef, run.work_order_contract_ref) &&
      same(provenance.capabilityGrantRef, run.capability_grant_ref) &&
      same(provenance.runtimeSessionExternalRef, ack.runtimeSessionRef) &&
      same(
        provenance.runtimeAdapterRef,
        object(frozenContract.versionPins).runtimeAdapterContractRef,
      ) &&
      same(object(provenance.harness), {
        harnessId: 'zhiju.runtime.synthetic',
        harnessVersion: '1.0',
      }) &&
      provenance.provider === 'synthetic' &&
      object(provenance.model).modelId === 'synthetic' &&
      same(object(provenance.model).modelConfigHash, object(run.runtime_binding).modelConfigHash),
  );
  const bundleRef = object(run.capability_grant_ref);
  let policyObservation: Awaited<ReturnType<ControlledFinalPorts['resolveControls']>> | undefined;
  let validUntil = Math.min(run.execution_deadline.getTime(), run.lease_expires_at.getTime());
  if (requireCurrent) {
    const bundle = await ports.readBundle(bundleRef, runRef);
    const controls = await ports.resolveControls(object(run.lease_policy_ref));
    policyObservation = controls;
    requireThat(
      bundle.useStatus === 'USABLE' &&
        same(bundle.bundleRef, bundleRef) &&
        controls.useStatus === 'USABLE' &&
        same(controls.policyRef, run.lease_policy_ref),
    );
    const bundleUntil = Date.parse(textValue(bundle.payload.validUntil));
    requireThat(Number.isFinite(bundleUntil));
    validUntil = Math.min(validUntil, bundleUntil, ports.authorizationValidUntil().getTime());
    if (controls.supersededAt !== undefined) {
      const policyUntil = Date.parse(controls.supersededAt);
      requireThat(Number.isFinite(policyUntil));
      validUntil = Math.min(validUntil, policyUntil);
    }
  }
  requireThat(Number.isFinite(validUntil));
  return {
    runRef,
    attemptRef,
    adapterRef,
    binding,
    final,
    result,
    resultHash,
    validUntil,
    policyObservation,
  };
}

function eventEnvelope(
  envelope: CommandEnvelope,
  type: string,
  aggregateId: string,
  aggregateType: string,
  aggregateVersion: string,
  payload: CanonicalJsonObject,
  occurredAt: Date,
) {
  const event = {
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
    integrity: { canonicalizationVersion: '1', payloadHash: hash(digest(payload)) },
  };
  requireThat(registry.validateOperation(type, '1.0', event).valid, 'API_VALUE_INVALID');
  return event;
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
    scopeMirror: scope(envelope) as { enterpriseId: string; projectId: string },
    causationId: event.causationId,
    occurredAt: new Date(event.occurredAt),
  });
}

async function appendFinalEdge(
  execution: CommandExecution,
  envelope: CommandEnvelope,
  path: string,
  target: CanonicalJsonObject,
  targetModule = 'task-execution',
  ownerPayloadHash?: string,
) {
  requireThat(same(target.scope, scope(envelope)));
  await execution.appendReferenceEdge({
    ownerObjectType: envelope.targetType,
    ownerObjectId: envelope.targetId,
    ...(ownerPayloadHash === undefined
      ? {}
      : { ownerPayloadHash: Buffer.from(ownerPayloadHash, 'hex') }),
    referencePath: path,
    targetModule,
    targetObjectType: textValue(target.objectType),
    targetObjectId: textValue(target.objectId),
    ...(target.versionId === undefined ? {} : { targetVersionId: textValue(target.versionId) }),
    ...(target.contentHash === undefined
      ? {}
      : { targetPayloadHash: Buffer.from(textValue(object(target.contentHash).digest), 'hex') }),
    referencePurpose: 'EXECUTION_BINDING',
  });
}

export async function scanControlledFinalCandidates(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  now: () => Date,
  revalidateAuthorization: () => Promise<void>,
) {
  await revalidateAuthorization();
  requireThat(context.allowedProjectIds.length === 1, 'SCOPE_MISMATCH');
  const projectId = context.allowedProjectIds[0];
  requireThat(projectId !== undefined, 'SCOPE_MISMATCH');
  return withTaskExecutionTransaction(db, context, async (trx) => {
    const rows = await trx
      .selectFrom('task_execution.run as run')
      .innerJoin('task_execution.work_order_run_claim as claim', 'claim.run_id', 'run.run_id')
      .leftJoin('task_execution.run_final_submission_claim as final', 'final.run_id', 'run.run_id')
      .select(['run.run_id', 'run.start_attempt_ref'])
      .where('run.enterprise_id', '=', context.enterpriseId)
      .where('run.project_id', '=', projectId)
      .where('run.status', '=', 'RUNNING')
      .where('claim.status', '=', 'ACTIVE')
      .where('final.run_id', 'is', null)
      .where('run.execution_deadline', '>', now())
      .where('run.lease_expires_at', '>', now())
      .execute();
    const candidates = rows.flatMap((row) =>
      row.start_attempt_ref === null
        ? []
        : [
            {
              runRef: ref('OBJECT', RUN, row.run_id, {
                enterpriseId: context.enterpriseId,
                projectId,
              }),
              attemptRef: object(row.start_attempt_ref),
            },
          ],
    );
    await revalidateAuthorization();
    return candidates;
  });
}

export interface ControlledFinalRecoveryCommand {
  readonly commandType:
    | 'execution.submit_agent_result'
    | 'execution.record_run_result'
    | 'execution.validate_agent_result'
    | 'execution.accept_agent_result'
    | 'execution.finalize_run_from_acceptance';
  readonly targetRef: CanonicalJsonObject;
  readonly payload: CanonicalJsonObject;
  readonly expectedAggregateVersion?: number;
  readonly idempotencyKey: string;
}

export interface ControlledFinalRecoveryPorts {
  readonly now: () => Date;
  readonly revalidateScan: () => Promise<void>;
  readonly readFinal: (attemptRef: CanonicalJsonObject) => Promise<CanonicalJsonObject | undefined>;
  readonly readRun: (runRef: CanonicalJsonObject) => Promise<{
    status: string;
    aggregateVersion: number;
    currentFencingToken: number;
    workOrderRef: CanonicalJsonObject;
  }>;
  readonly readPolicy: (workOrderRef: CanonicalJsonObject) => Promise<CanonicalJsonObject>;
  readonly listProgress: () => Promise<readonly ControlledFinalProgress[]>;
  readonly createProgress: (input: {
    runRef: CanonicalJsonObject;
    attemptRef: CanonicalJsonObject;
    sourceRef: CanonicalJsonObject;
    policyRef: CanonicalJsonObject;
    runVersion: string;
  }) => Promise<void>;
  readonly advanceProgress: (
    progress: ControlledFinalProgress,
    transition: ControlledFinalProgressAdvance,
  ) => Promise<void>;
  readonly suspendTimedOutProgress: (progress: ControlledFinalProgress) => Promise<void>;
  readonly execute: (command: ControlledFinalRecoveryCommand) => Promise<{
    status: string;
    originalOutcome?: string;
    resultPayload?: CanonicalJsonObject | null;
  }>;
}

function recoveryKey(sourceId: string, sourceHash: string, step: string): string {
  return `controlled-final:${sourceId}:${sourceHash}:${step}`;
}

function stableRecoveryTarget(key: string, sourceId: string): string {
  const source = sourceId.replaceAll('-', '').toLowerCase();
  requireThat(/^[0-9a-f]{32}$/.test(source), 'API_VALUE_INVALID');
  const random = digest(key);
  const bytes = `${source.slice(0, 12)}7${random.slice(0, 3)}8${random.slice(3, 6)}${random.slice(6, 18)}`;
  return `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-${bytes.slice(12, 16)}-${bytes.slice(16, 20)}-${bytes.slice(20)}`;
}

/** Recovers from authorized Process progress and owning command Receipts. */
export async function recoverControlledFinalRuns(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  ports: ControlledFinalRecoveryPorts,
  maxSteps = 5,
): Promise<number> {
  requireThat(Number.isSafeInteger(maxSteps) && maxSteps >= 0);
  requireThat(context.allowedProjectIds.length === 1, 'SCOPE_MISMATCH');
  const project = context.allowedProjectIds[0];
  requireThat(project !== undefined, 'SCOPE_MISMATCH');
  let advanced = 0;
  for (; advanced < maxSteps;) {
    let progressRows = await ports.listProgress();
    const active = new Set(progressRows.map((row) => textValue(row.runRef.objectId)));
    const candidates = await scanControlledFinalCandidates(
      db,
      context,
      ports.now,
      ports.revalidateScan,
    );
    for (const candidate of candidates) {
      if (active.has(textValue(candidate.runRef.objectId))) continue;
      const final = await ports.readFinal(candidate.attemptRef);
      if (final === undefined) continue;
      requireThat(same(final.attemptRef, candidate.attemptRef));
      const state = await ports.readRun(candidate.runRef);
      requireThat(state.status === 'RUNNING' && Number.isSafeInteger(state.aggregateVersion));
      const policyRef = await ports.readPolicy(state.workOrderRef);
      await ports.createProgress({
        runRef: candidate.runRef,
        attemptRef: candidate.attemptRef,
        sourceRef: object(final.observationRef),
        policyRef,
        runVersion: String(state.aggregateVersion),
      });
      active.add(textValue(candidate.runRef.objectId));
    }
    progressRows = await ports.listProgress();
    const progress = progressRows.find((row) => row.step !== 'DONE');
    if (progress === undefined) break;
    const state = await ports.readRun(progress.runRef);
    if (state.status === 'TIMED_OUT') {
      await ports.suspendTimedOutProgress(progress);
      continue;
    }
    const final = await ports.readFinal(progress.attemptRef);
    requireThat(
      final !== undefined &&
        same(final.observationRef, progress.sourceRef) &&
        same(final.attemptRef, progress.attemptRef) &&
        same(final.runRef, progress.runRef),
      'EXECUTION_FINAL_CONFLICT',
    );
    const subjectScope = { enterpriseId: context.enterpriseId, projectId: project };
    const resultRef = progress.resultRef;
    let command: ControlledFinalRecoveryCommand;
    let sourceFactRef: CanonicalJsonObject;
    let nextStep: ControlledFinalProgressAdvance['nextStep'];
    switch (progress.step) {
      case 'SUBMIT': {
        const resultBody = object(final.agentResultContract);
        sourceFactRef = progress.sourceRef;
        nextStep = 'RECORD';
        command = {
          commandType: 'execution.submit_agent_result',
          targetRef: ref('OBJECT', RESULT, textValue(resultBody.agentResultId), subjectScope),
          payload: {
            agentResultContract: resultBody,
            runFencingToken: state.currentFencingToken,
            runtimeSubmissionRef: object(final.runtimeSubmissionRef),
          },
          idempotencyKey: recoveryKey(
            textValue(sourceFactRef.objectId),
            textValue(object(sourceFactRef.contentHash).digest),
            'submit',
          ),
        };
        break;
      }
      case 'RECORD': {
        requireThat(resultRef !== undefined);
        sourceFactRef = resultRef;
        nextStep = 'VALIDATE';
        command = {
          commandType: 'execution.record_run_result',
          targetRef: progress.runRef,
          payload: { agentResultRef: resultRef },
          expectedAggregateVersion: Number(progress.runVersion),
          idempotencyKey: recoveryKey(
            textValue(resultRef.objectId),
            textValue(object(resultRef.contentHash).digest),
            'record',
          ),
        };
        break;
      }
      case 'VALIDATE': {
        requireThat(resultRef !== undefined);
        sourceFactRef = resultRef;
        nextStep = 'ACCEPT';
        const key = recoveryKey(
          textValue(resultRef.objectId),
          textValue(object(resultRef.contentHash).digest),
          'validate',
        );
        const evaluatorRef = registeredEvaluatorProfileReference(
          'im06-evaluator-static-v1',
          'te.agent_result_validation.evaluator@1.0',
        );
        requireThat(evaluatorRef !== undefined);
        command = {
          commandType: 'execution.validate_agent_result',
          targetRef: ref(
            'OBJECT',
            BUNDLE,
            stableRecoveryTarget(key, textValue(resultRef.objectId)),
            subjectScope,
          ),
          payload: {
            agentResultRef: resultRef,
            runRef: progress.runRef,
            runtimeAttemptRef: progress.attemptRef,
            policyRef: progress.policyRef,
            evaluatorRef: evaluatorRef as unknown as CanonicalJsonObject,
          },
          idempotencyKey: key,
        };
        break;
      }
      case 'ACCEPT': {
        requireThat(resultRef !== undefined && progress.bundleRef !== undefined);
        const refs = progress.validationRefs;
        requireThat(refs?.length === 5);
        sourceFactRef = progress.bundleRef;
        nextStep = 'FINALIZE';
        const key = recoveryKey(
          textValue(sourceFactRef.objectId),
          textValue(object(sourceFactRef.contentHash).digest),
          'accept',
        );
        command = {
          commandType: 'execution.accept_agent_result',
          targetRef: ref(
            'OBJECT',
            ACCEPTANCE,
            stableRecoveryTarget(key, textValue(sourceFactRef.objectId)),
            subjectScope,
          ),
          payload: {
            agentResultRef: resultRef,
            schemaValidationRef: object(refs[0]),
            identityValidationRef: object(refs[1]),
            runBindingValidationRef: object(refs[2]),
            scopeValidationRef: object(refs[3]),
            businessOutputValidationRef: object(refs[4]),
            disposition: 'ACCEPTED',
            reasons: [],
          },
          idempotencyKey: key,
        };
        break;
      }
      case 'FINALIZE': {
        requireThat(progress.acceptanceRef !== undefined);
        sourceFactRef = progress.acceptanceRef;
        nextStep = 'DONE';
        command = {
          commandType: 'execution.finalize_run_from_acceptance',
          targetRef: progress.runRef,
          payload: { acceptanceRecordRef: progress.acceptanceRef },
          expectedAggregateVersion: Number(progress.runVersion),
          idempotencyKey: recoveryKey(
            textValue(sourceFactRef.objectId),
            textValue(object(sourceFactRef.contentHash).digest),
            'finalize',
          ),
        };
        break;
      }
      default:
        throw new Error('completed process cannot issue another command');
    }
    const result = await ports.execute(command);
    requireThat(
      (result.status === 'COMMITTED' ||
        (result.status === 'DUPLICATE' && result.originalOutcome === 'COMMITTED')) &&
        result.resultPayload !== undefined &&
        result.resultPayload !== null,
    );
    const output = object(result.resultPayload);
    const transition: ControlledFinalProgressAdvance = {
      expectedStep: progress.step,
      nextStep,
      sourceFactRef,
      stableIdempotencyKey: command.idempotencyKey,
      issuedCommandType: command.commandType,
      ...(progress.step === 'SUBMIT' ? { resultRef: object(output.agentResultRef) } : {}),
      ...(progress.step === 'RECORD'
        ? { runVersion: String(BigInt(progress.runVersion) + 1n) }
        : {}),
      ...(progress.step === 'VALIDATE'
        ? {
            bundleRef: object(output.bundleRef),
            validationRefs: [
              object(output.schemaValidationRef),
              object(output.identityValidationRef),
              object(output.runBindingValidationRef),
              object(output.scopeValidationRef),
              object(output.businessOutputValidationRef),
            ],
          }
        : {}),
      ...(progress.step === 'ACCEPT' ? { acceptanceRef: object(output.acceptanceRecordRef) } : {}),
    };
    await ports.advanceProgress(progress, transition);
    advanced += 1;
  }
  return advanced;
}

export async function handleSubmitFinalResult(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: ControlledFinalPorts,
) {
  requireThat(
    envelope.commandType === 'execution.submit_agent_result' && envelope.targetType === RESULT,
  );
  const submitted = object(envelope.requestPayload.agentResultContract);
  const runRef = object(submitted.runRef);
  requireThat(
    runRef.objectType === RUN &&
      same(runRef.scope, scope(envelope)) &&
      submitted.agentResultId === envelope.targetId,
  );
  await ports.revalidateAuthorization();
  return executeFinalCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const run = await lockedRun(execution.trx, textValue(runRef.objectId), envelope);
      const existing = await execution.trx
        .selectFrom('task_execution.run_final_submission_claim')
        .selectAll()
        .where('run_id', '=', run.run_id)
        .executeTakeFirst();
      if (existing !== undefined) {
        const proof = await evidence(execution.trx, run, envelope, ports, false);
        requireThat(
          existing.result_id === envelope.targetId &&
            existing.result_payload_hash.toString('hex') === proof.resultHash &&
            same(existing.observation_ref, proof.final.observationRef) &&
            same(proof.result, submitted) &&
            same(proof.final.runtimeSubmissionRef, envelope.requestPayload.runtimeSubmissionRef) &&
            envelope.requestPayload.runFencingToken === Number(run.fencing_token),
          'EXECUTION_FINAL_CONFLICT',
        );
        await ports.revalidateAuthorization();
        return {
          kind: 'COMMITTED',
          resultPayload: {
            agentResultRef: ref(
              'CONTENT_ADDRESSED',
              RESULT,
              envelope.targetId,
              scope(envelope),
              proof.resultHash,
            ),
          },
        } as const;
      }
      live(run, ports.now());
      await activeClaim(execution.trx, run);
      const proof = await evidence(execution.trx, run, envelope, ports);
      requireThat(
        same(proof.result, submitted) &&
          same(proof.final.runtimeSubmissionRef, envelope.requestPayload.runtimeSubmissionRef) &&
          typeof envelope.requestPayload.runFencingToken === 'number' &&
          envelope.requestPayload.runFencingToken === Number(run.fencing_token),
      );
      const resultRef = ref(
        'CONTENT_ADDRESSED',
        RESULT,
        envelope.targetId,
        scope(envelope),
        proof.resultHash,
      );
      requireThat(run.status === 'RUNNING');
      await execution.trx
        .insertInto('task_execution.agent_result')
        .values({
          result_id: envelope.targetId,
          run_id: run.run_id,
          enterprise_id: envelope.enterpriseId,
          project_id: projectId(envelope),
          attempt_ref: canonicalize(proof.attemptRef),
          observation_ref: canonicalize(object(proof.final.observationRef)),
          adapter_identity_ref: canonicalize(proof.adapterRef),
          runtime_submission_ref: canonicalize(object(proof.final.runtimeSubmissionRef)),
          fencing_token: run.fencing_token,
          result_payload: canonicalize(proof.result),
          result_payload_hash: Buffer.from(proof.resultHash, 'hex'),
          source_command_id: envelope.commandId,
        })
        .execute();
      await execution.trx
        .insertInto('task_execution.run_final_submission_claim')
        .values({
          run_id: run.run_id,
          result_id: envelope.targetId,
          enterprise_id: envelope.enterpriseId,
          project_id: projectId(envelope),
          observation_ref: canonicalize(object(proof.final.observationRef)),
          result_payload_hash: Buffer.from(proof.resultHash, 'hex'),
          source_command_id: envelope.commandId,
        })
        .execute();
      await appendFinalEdge(
        execution,
        envelope,
        '/runRef',
        proof.runRef,
        'task-execution',
        proof.resultHash,
      );
      await appendFinalEdge(
        execution,
        envelope,
        '/attemptRef',
        proof.attemptRef,
        'integration-gateway',
        proof.resultHash,
      );
      await appendFinalEdge(
        execution,
        envelope,
        '/observationRef',
        object(proof.final.observationRef),
        'integration-gateway',
        proof.resultHash,
      );
      await appendFinalEdge(
        execution,
        envelope,
        '/runtimeAdapterIdentityRef',
        proof.adapterRef,
        'integration-gateway',
        proof.resultHash,
      );
      await ports.revalidateAuthorization();
      return { kind: 'COMMITTED', resultPayload: { agentResultRef: resultRef } } as const;
    },
    ports.revalidateAuthorization,
  );
}

export async function handleRecordRunResult(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: ControlledFinalPorts,
) {
  requireThat(
    envelope.commandType === 'execution.record_run_result' && envelope.targetType === RUN,
  );
  const resultRef = object(envelope.requestPayload.agentResultRef);
  await ports.revalidateAuthorization();
  await ports.readSource(resultRef);
  return executeFinalCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const run = await lockedRun(execution.trx, envelope.targetId, envelope);
      if (run.result_ref !== null && same(run.result_ref, resultRef)) {
        const historical = await execution.trx
          .selectFrom('task_execution.agent_result')
          .select(['result_id', 'result_payload_hash'])
          .where('run_id', '=', run.run_id)
          .executeTakeFirst();
        requireThat(
          historical !== undefined &&
            historical.result_id === resultRef.objectId &&
            historical.result_payload_hash.toString('hex') === object(resultRef.contentHash).digest,
        );
        await ports.revalidateAuthorization();
        return {
          kind: 'COMMITTED',
          resultPayload: {
            runRef: ref('OBJECT', RUN, run.run_id, scope(envelope)),
            status: 'RESULT_RECORDED',
            agentResultRef: resultRef,
          },
        } as const;
      }
      live(run, ports.now());
      await activeClaim(execution.trx, run);
      const proof = await evidence(execution.trx, run, envelope, ports);
      const result = await execution.trx
        .selectFrom('task_execution.agent_result')
        .selectAll()
        .where('run_id', '=', run.run_id)
        .executeTakeFirst();
      requireThat(
        result !== undefined &&
          result.result_id === resultRef.objectId &&
          result.result_payload_hash.toString('hex') === proof.resultHash &&
          same(
            resultRef,
            ref('CONTENT_ADDRESSED', RESULT, result.result_id, scope(envelope), proof.resultHash),
          ),
      );
      if (run.status === 'RESULT_RECORDED') {
        requireThat(same(run.result_ref, resultRef));
      } else {
        requireThat(
          run.status === 'RUNNING' && run.aggregate_version === envelope.expectedAggregateVersion,
        );
        const updated = await execution.trx
          .updateTable('task_execution.run')
          .set({
            status: 'RESULT_RECORDED',
            result_ref: canonicalize(resultRef),
            aggregate_version: (BigInt(run.aggregate_version) + 1n).toString(),
            last_command_id: envelope.commandId,
          })
          .where('run_id', '=', run.run_id)
          .where('status', '=', 'RUNNING')
          .executeTakeFirst();
        requireThat(Number(updated.numUpdatedRows) === 1, 'CONCURRENCY_CONFLICT');
      }
      await appendFinalEdge(execution, envelope, '/resultRef', resultRef);
      await ports.revalidateAuthorization();
      return {
        kind: 'COMMITTED',
        resultPayload: {
          runRef: proof.runRef,
          status: 'RESULT_RECORDED',
          agentResultRef: resultRef,
        },
      } as const;
    },
    ports.revalidateAuthorization,
  );
}

export async function handleValidateFinalResult(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: ControlledFinalPorts,
) {
  requireThat(
    envelope.commandType === 'execution.validate_agent_result' && envelope.targetType === BUNDLE,
  );
  const request = envelope.requestPayload;
  const runRef = object(request.runRef);
  const resultRef = object(request.agentResultRef);
  const evaluator = registeredEvaluatorProfileReference(
    'im06-evaluator-static-v1',
    'te.agent_result_validation.evaluator@1.0',
  );
  requireThat(
    evaluator !== undefined &&
      same(evaluator, request.evaluatorRef) &&
      runRef.objectType === RUN &&
      same(runRef.scope, scope(envelope)),
  );
  await ports.revalidateAuthorization();
  await ports.readSource(resultRef);
  return executeFinalCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const run = await lockedRun(execution.trx, textValue(runRef.objectId), envelope);
      const prior = await execution.trx
        .selectFrom('task_execution.result_validation_bundle')
        .selectAll()
        .where('result_id', '=', textValue(resultRef.objectId))
        .executeTakeFirst();
      if (prior !== undefined) {
        requireThat(
          prior.bundle_id === envelope.targetId &&
            prior.run_id === run.run_id &&
            same(run.result_ref, resultRef) &&
            same(prior.attempt_ref, request.runtimeAttemptRef) &&
            same(prior.policy_ref, request.policyRef) &&
            same(prior.evaluator_ref, request.evaluatorRef),
          'EXECUTION_FINAL_CONFLICT',
        );
        const refs = object(prior.canonical_payload).validationRefs;
        requireThat(Array.isArray(refs) && refs.length === 5);
        await ports.revalidateAuthorization();
        return {
          kind: 'COMMITTED',
          resultPayload: {
            bundleRef: ref(
              'CONTENT_ADDRESSED',
              BUNDLE,
              prior.bundle_id,
              scope(envelope),
              prior.payload_hash.toString('hex'),
            ),
            schemaValidationRef: object(refs[0]),
            identityValidationRef: object(refs[1]),
            runBindingValidationRef: object(refs[2]),
            scopeValidationRef: object(refs[3]),
            businessOutputValidationRef: object(refs[4]),
          },
        } as const;
      }
      live(run, ports.now());
      await activeClaim(execution.trx, run);
      requireThat(
        run.status === 'RESULT_RECORDED' &&
          same(run.result_ref, resultRef) &&
          same(run.lease_policy_ref, request.policyRef) &&
          same(run.start_attempt_ref, request.runtimeAttemptRef),
      );
      const proof = await evidence(execution.trx, run, envelope, ports);
      requireThat(proof.policyObservation !== undefined);
      const result = await execution.trx
        .selectFrom('task_execution.agent_result')
        .selectAll()
        .where('run_id', '=', run.run_id)
        .executeTakeFirst();
      requireThat(result !== undefined);
      requireThat(
        result.result_id === resultRef.objectId &&
          result.result_payload_hash.toString('hex') === proof.resultHash,
      );
      const existing = await execution.trx
        .selectFrom('task_execution.result_validation_bundle')
        .selectAll()
        .where('result_id', '=', result.result_id)
        .executeTakeFirst();
      if (existing !== undefined) {
        requireThat(existing.bundle_id === envelope.targetId, 'EXECUTION_FINAL_CONFLICT');
        const refs = object(existing.canonical_payload).validationRefs;
        requireThat(Array.isArray(refs) && refs.length === 5);
        return {
          kind: 'COMMITTED',
          resultPayload: {
            bundleRef: ref(
              'CONTENT_ADDRESSED',
              BUNDLE,
              existing.bundle_id,
              scope(envelope),
              existing.payload_hash.toString('hex'),
            ),
            schemaValidationRef: object(refs[0]),
            identityValidationRef: object(refs[1]),
            runBindingValidationRef: object(refs[2]),
            scopeValidationRef: object(refs[3]),
            businessOutputValidationRef: object(refs[4]),
          },
        } as const;
      }
      const now = ports.now();
      const validUntil = new Date(proof.validUntil).toISOString();
      requireThat(now.getTime() < proof.validUntil);
      const validationRefs: CanonicalJsonObject[] = [];
      const factRows: {
        id: string;
        kind: (typeof validationKinds)[number];
        payload: CanonicalJsonObject;
        payloadHash: string;
      }[] = [];
      for (const kind of validationKinds) {
        const id = newUuidV7();
        const payload: CanonicalJsonObject = {
          validationId: id,
          bundleId: envelope.targetId,
          kind,
          runRef: proof.runRef,
          agentResultRef: resultRef,
          attemptRef: proof.attemptRef,
          observationRef: object(proof.final.observationRef),
          policyRef: object(request.policyRef),
          evaluatorRef: object(request.evaluatorRef),
          status: 'SATISFIED',
          evaluatedAt: now.toISOString(),
          validUntil,
        };
        const payloadHash = digest(payload);
        factRows.push({ id, kind, payload, payloadHash });
        validationRefs.push(ref('CONTENT_ADDRESSED', VALIDATION, id, scope(envelope), payloadHash));
      }
      const bundlePayload: CanonicalJsonObject = {
        bundleId: envelope.targetId,
        judgmentKind: 'RESULT_VALIDATION_BUNDLE',
        scope: scope(envelope),
        runRef: proof.runRef,
        agentResultRef: resultRef,
        attemptRef: proof.attemptRef,
        observationRef: object(proof.final.observationRef),
        policyRef: object(request.policyRef),
        evaluatorRef: object(request.evaluatorRef),
        policyContentHash: textValue(object(proof.policyObservation.contentHash).digest),
        policyEffectiveFrom: proof.policyObservation.effectiveFrom,
        ...(proof.policyObservation.supersededAt === undefined
          ? {}
          : { policySupersededAt: proof.policyObservation.supersededAt }),
        validUntil,
        validationRefs,
      };
      const bundleRef = ref(
        'CONTENT_ADDRESSED',
        BUNDLE,
        envelope.targetId,
        scope(envelope),
        digest(bundlePayload),
      );
      const response: CanonicalJsonObject = {
        bundleRef,
        schemaValidationRef: object(validationRefs[0]),
        identityValidationRef: object(validationRefs[1]),
        runBindingValidationRef: object(validationRefs[2]),
        scopeValidationRef: object(validationRefs[3]),
        businessOutputValidationRef: object(validationRefs[4]),
      };
      await execution.trx
        .insertInto('task_execution.execution_judgment')
        .values({
          judgment_id: envelope.targetId,
          judgment_kind: 'RESULT_VALIDATION_BUNDLE',
          run_id: run.run_id,
          result_id: result.result_id,
          attempt_ref: canonicalize(proof.attemptRef),
          observation_ref: canonicalize(object(proof.final.observationRef)),
          enterprise_id: envelope.enterpriseId,
          project_id: projectId(envelope),
          task_id: null,
          task_definition_snapshot_id: null,
          task_definition_hash: null,
          policy_version_ref: canonicalize(object(request.policyRef)),
          policy_content_hash: Buffer.from(
            textValue(object(proof.policyObservation.contentHash).digest),
            'hex',
          ),
          policy_effective_from: new Date(proof.policyObservation.effectiveFrom),
          policy_superseded_at:
            proof.policyObservation.supersededAt === undefined
              ? null
              : new Date(proof.policyObservation.supersededAt),
          evaluator_ref: canonicalize(object(request.evaluatorRef)),
          input_hash: Buffer.from(proof.resultHash, 'hex'),
          evaluated_at: now,
          valid_until: new Date(validUntil),
          ready: null,
          work_order_id: null,
          draft_snapshot_id: null,
          draft_snapshot_hash: null,
          candidate_contract_hash: null,
          specification_hash: null,
          context_snapshot_id: null,
          context_snapshot_hash: null,
          validation_valid: null,
          validation_references_valid: null,
          validation_specification_hash_valid: null,
          validation_capability_valid: null,
          validation_executable: null,
          validation_budget_valid: null,
          validation_context_coverage_valid: null,
          canonical_payload: canonicalize(bundlePayload),
          payload_hash: Buffer.from(digest(bundlePayload), 'hex'),
          request_payload_hash: Buffer.from(digest(request), 'hex'),
          source_command_id: envelope.commandId,
          created_by_principal_id: envelope.principalId,
        })
        .execute();
      await execution.trx
        .insertInto('task_execution.result_validation_bundle')
        .values({
          bundle_id: envelope.targetId,
          run_id: run.run_id,
          result_id: result.result_id,
          enterprise_id: envelope.enterpriseId,
          project_id: projectId(envelope),
          attempt_ref: canonicalize(proof.attemptRef),
          observation_ref: canonicalize(object(proof.final.observationRef)),
          policy_ref: canonicalize(object(request.policyRef)),
          evaluator_ref: canonicalize(object(request.evaluatorRef)),
          valid_until: new Date(validUntil),
          canonical_payload: canonicalize(bundlePayload),
          payload_hash: Buffer.from(digest(bundlePayload), 'hex'),
          source_command_id: envelope.commandId,
        })
        .execute();
      for (const row of factRows) {
        await execution.trx
          .insertInto('task_execution.result_validation_fact')
          .values({
            validation_id: row.id,
            bundle_id: envelope.targetId,
            enterprise_id: envelope.enterpriseId,
            project_id: projectId(envelope),
            kind: row.kind,
            canonical_payload: canonicalize(row.payload),
            payload_hash: Buffer.from(row.payloadHash, 'hex'),
            source_command_id: envelope.commandId,
          })
          .execute();
      }
      await appendFinalEdge(
        execution,
        envelope,
        '/agentResultRef',
        resultRef,
        'task-execution',
        digest(bundlePayload),
      );
      await appendFinalEdge(
        execution,
        envelope,
        '/observationRef',
        object(proof.final.observationRef),
        'integration-gateway',
        digest(bundlePayload),
      );
      await ports.revalidateAuthorization();
      return { kind: 'COMMITTED', resultPayload: response } as const;
    },
    ports.revalidateAuthorization,
  );
}

export async function handleAcceptFinalResult(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: ControlledFinalPorts,
) {
  requireThat(
    envelope.commandType === 'execution.accept_agent_result' && envelope.targetType === ACCEPTANCE,
  );
  const request = envelope.requestPayload;
  const resultRef = object(request.agentResultRef);
  await ports.revalidateAuthorization();
  await ports.readSource(resultRef);
  return executeFinalCommand(
    db,
    context,
    envelope,
    async (execution) => {
      requireThat(
        request.disposition === 'ACCEPTED' &&
          Array.isArray(request.reasons) &&
          request.reasons.length === 0,
      );

      const result = await execution.trx
        .selectFrom('task_execution.agent_result')
        .selectAll()
        .where('result_id', '=', textValue(resultRef.objectId))
        .executeTakeFirst();
      requireThat(
        result?.enterprise_id === envelope.enterpriseId && result.project_id === envelope.projectId,
        'NOT_FOUND',
      );
      const run = await lockedRun(execution.trx, result.run_id, envelope);
      const prior = await execution.trx
        .selectFrom('task_execution.agent_result_acceptance')
        .selectAll()
        .where('result_id', '=', result.result_id)
        .executeTakeFirst();
      if (prior !== undefined) {
        const priorPayload = object(prior.canonical_payload);
        requireThat(
          prior.acceptance_id === envelope.targetId &&
            prior.run_id === run.run_id &&
            same(priorPayload.agentResultRef, resultRef) &&
            same(priorPayload.validationRefs, [
              request.schemaValidationRef,
              request.identityValidationRef,
              request.runBindingValidationRef,
              request.scopeValidationRef,
              request.businessOutputValidationRef,
            ]),
          'EXECUTION_FINAL_CONFLICT',
        );
        await ports.revalidateAuthorization();
        return {
          kind: 'COMMITTED',
          resultPayload: {
            acceptanceRecordRef: ref(
              'CONTENT_ADDRESSED',
              ACCEPTANCE,
              prior.acceptance_id,
              scope(envelope),
              prior.payload_hash.toString('hex'),
            ),
          },
        } as const;
      }
      live(run, ports.now());
      await activeClaim(execution.trx, run);
      requireThat(run.status === 'RESULT_RECORDED' && same(run.result_ref, resultRef));
      const proof = await evidence(execution.trx, run, envelope, ports);
      requireThat(result.result_payload_hash.toString('hex') === proof.resultHash);
      const bundle = await execution.trx
        .selectFrom('task_execution.result_validation_bundle')
        .selectAll()
        .where('result_id', '=', result.result_id)
        .executeTakeFirst();
      requireThat(
        bundle !== undefined &&
          bundle.valid_until.getTime() > ports.now().getTime() &&
          same(bundle.policy_ref, run.lease_policy_ref) &&
          same(bundle.observation_ref, proof.final.observationRef),
      );
      const child = await execution.trx
        .selectFrom('task_execution.result_validation_fact')
        .selectAll()
        .where('bundle_id', '=', bundle.bundle_id)
        .execute();
      requireThat(child.length === 5);
      const names = [
        'schemaValidationRef',
        'identityValidationRef',
        'runBindingValidationRef',
        'scopeValidationRef',
        'businessOutputValidationRef',
      ] as const;
      for (let i = 0; i < validationKinds.length; i++) {
        const fact = child.find((row) => row.kind === validationKinds[i]);
        requireThat(
          fact !== undefined &&
            object(fact.canonical_payload).status === 'SATISFIED' &&
            same(
              request[textValue(names[i])],
              ref(
                'CONTENT_ADDRESSED',
                VALIDATION,
                fact.validation_id,
                scope(envelope),
                fact.payload_hash.toString('hex'),
              ),
            ),
        );
      }
      const existing = await execution.trx
        .selectFrom('task_execution.agent_result_acceptance')
        .selectAll()
        .where('result_id', '=', result.result_id)
        .executeTakeFirst();
      if (existing !== undefined) {
        requireThat(existing.acceptance_id === envelope.targetId);
        const acceptanceRef = ref(
          'CONTENT_ADDRESSED',
          ACCEPTANCE,
          existing.acceptance_id,
          scope(envelope),
          existing.payload_hash.toString('hex'),
        );
        return {
          kind: 'COMMITTED',
          resultPayload: { acceptanceRecordRef: acceptanceRef },
        } as const;
      }
      const payload: CanonicalJsonObject = {
        acceptanceId: envelope.targetId,
        agentResultRef: resultRef,
        bundleRef: ref(
          'CONTENT_ADDRESSED',
          BUNDLE,
          bundle.bundle_id,
          scope(envelope),
          bundle.payload_hash.toString('hex'),
        ),
        validationRefs: names.map((name) => object(request[name])),
        disposition: 'ACCEPTED',
        reasons: [],
        acceptedAt: ports.now().toISOString(),
      };
      const committedRef = ref(
        'CONTENT_ADDRESSED',
        ACCEPTANCE,
        envelope.targetId,
        scope(envelope),
        digest(payload),
      );
      await execution.trx
        .insertInto('task_execution.agent_result_acceptance')
        .values({
          acceptance_id: envelope.targetId,
          result_id: result.result_id,
          bundle_id: bundle.bundle_id,
          run_id: run.run_id,
          enterprise_id: envelope.enterpriseId,
          project_id: projectId(envelope),
          canonical_payload: canonicalize(payload),
          payload_hash: Buffer.from(digest(payload), 'hex'),
          source_command_id: envelope.commandId,
        })
        .execute();
      await appendFinalEdge(
        execution,
        envelope,
        '/agentResultRef',
        resultRef,
        'task-execution',
        digest(payload),
      );
      await appendFinalEdge(
        execution,
        envelope,
        '/bundleRef',
        object(payload.bundleRef),
        'task-execution',
        digest(payload),
      );
      await appendEvent(
        execution,
        envelope,
        eventEnvelope(
          envelope,
          'execution.AgentResultAccepted',
          result.result_id,
          RESULT,
          '1',
          {
            agentResultRef: resultRef,
            acceptanceRecordRef: committedRef,
            runRef: proof.runRef,
            workOrderRef: object(run.work_order_ref),
            businessOutputRefs: [],
          },
          ports.now(),
        ),
      );
      await ports.revalidateAuthorization();
      return {
        kind: 'COMMITTED',
        resultPayload: {
          acceptanceRecordRef: committedRef,
        },
      } as const;
    },
    ports.revalidateAuthorization,
  );
}

export async function handleFinalizeFirstRun(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: ControlledFinalPorts,
) {
  requireThat(
    envelope.commandType === 'execution.finalize_run_from_acceptance' &&
      envelope.targetType === RUN,
  );
  const acceptanceRef = object(envelope.requestPayload.acceptanceRecordRef);
  await ports.revalidateAuthorization();
  await ports.readSource(acceptanceRef);
  return executeFinalCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const run = await lockedRun(execution.trx, envelope.targetId, envelope);
      if (run.status === 'SUCCEEDED') {
        requireThat(same(run.acceptance_ref, acceptanceRef), 'EXECUTION_FINAL_CONFLICT');
        const claim = await execution.trx
          .selectFrom('task_execution.work_order_run_claim')
          .select('status')
          .where('run_id', '=', run.run_id)
          .executeTakeFirst();
        requireThat(claim?.status === 'RELEASED');
        await ports.revalidateAuthorization();
        return {
          kind: 'COMMITTED',
          resultPayload: {
            runRef: ref('OBJECT', RUN, run.run_id, scope(envelope)),
            status: 'SUCCEEDED',
            acceptanceRecordRef: acceptanceRef,
          },
        } as const;
      }
      live(run, ports.now());
      await activeClaim(execution.trx, run);
      requireThat(
        run.status === 'RESULT_RECORDED' &&
          run.aggregate_version === envelope.expectedAggregateVersion,
      );
      const proof = await evidence(execution.trx, run, envelope, ports);
      const acceptance = await execution.trx
        .selectFrom('task_execution.agent_result_acceptance')
        .selectAll()
        .where('acceptance_id', '=', textValue(acceptanceRef.objectId))
        .executeTakeFirst();
      requireThat(
        acceptance?.run_id === run.run_id &&
          same(
            acceptanceRef,
            ref(
              'CONTENT_ADDRESSED',
              ACCEPTANCE,
              acceptance.acceptance_id,
              scope(envelope),
              acceptance.payload_hash.toString('hex'),
            ),
          ) &&
          object(acceptance.canonical_payload).disposition === 'ACCEPTED',
      );
      const result = await execution.trx
        .selectFrom('task_execution.agent_result')
        .selectAll()
        .where('result_id', '=', acceptance.result_id)
        .executeTakeFirst();
      requireThat(
        result?.run_id === run.run_id &&
          result.result_payload_hash.toString('hex') === proof.resultHash &&
          same(
            run.result_ref,
            ref('CONTENT_ADDRESSED', RESULT, result.result_id, scope(envelope), proof.resultHash),
          ),
      );
      const endedAt = ports.now();
      live(run, endedAt);
      const nextVersion = (BigInt(run.aggregate_version) + 1n).toString();
      const updated = await execution.trx
        .updateTable('task_execution.run')
        .set({
          status: 'SUCCEEDED',
          acceptance_ref: canonicalize(acceptanceRef),
          ended_at: endedAt,
          termination_reason: 'EXECUTION_RESULT_ACCEPTED',
          aggregate_version: nextVersion,
          last_command_id: envelope.commandId,
        })
        .where('run_id', '=', run.run_id)
        .where('status', '=', 'RESULT_RECORDED')
        .executeTakeFirst();
      requireThat(Number(updated.numUpdatedRows) === 1, 'CONCURRENCY_CONFLICT');
      const claimUpdate = await execution.trx
        .updateTable('task_execution.work_order_run_claim')
        .set({ status: 'RELEASED' })
        .where('run_id', '=', run.run_id)
        .where('status', '=', 'ACTIVE')
        .executeTakeFirst();
      requireThat(Number(claimUpdate.numUpdatedRows) === 1, 'CONCURRENCY_CONFLICT');
      await appendFinalEdge(execution, envelope, '/acceptanceRecordRef', acceptanceRef);
      await appendEvent(
        execution,
        envelope,
        eventEnvelope(
          envelope,
          'execution.RunTerminated',
          run.run_id,
          RUN,
          nextVersion,
          {
            runRef: proof.runRef,
            workOrderRef: object(run.work_order_ref),
            terminalStatus: 'SUCCEEDED',
            terminationReason: 'EXECUTION_RESULT_ACCEPTED',
            agentResultRef: object(run.result_ref),
            endedAt: endedAt.toISOString(),
          },
          endedAt,
        ),
      );
      await ports.revalidateAuthorization();
      return {
        kind: 'COMMITTED',
        resultPayload: {
          runRef: proof.runRef,
          status: 'SUCCEEDED',
          acceptanceRecordRef: acceptanceRef,
        },
      } as const;
    },
    ports.revalidateAuthorization,
  );
}

export async function handleExpireFirstRun(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  ports: ControlledFinalPorts,
) {
  requireThat(
    envelope.commandType === 'execution.expire_run' &&
      envelope.targetType === RUN &&
      envelope.requestPayload.reason === 'DEADLINE_EXCEEDED',
    'EXECUTION_CRITERION_UNSUPPORTED',
  );
  await ports.revalidateAuthorization();
  return executeFinalCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const run = await lockedRun(execution.trx, envelope.targetId, envelope);
      const runRef = ref('OBJECT', RUN, run.run_id, scope(envelope));
      await ports.inspectExpiredBundle(object(run.capability_grant_ref), runRef);
      requireThat(
        ports.now().getTime() >= run.execution_deadline.getTime(),
        'EXECUTION_JUDGMENT_STALE',
      );
      if (run.status === 'TIMED_OUT') {
        const claim = await execution.trx
          .selectFrom('task_execution.work_order_run_claim')
          .select('status')
          .where('run_id', '=', run.run_id)
          .executeTakeFirst();
        requireThat(claim?.status === 'EXPIRED' && run.ended_at !== null);
        await ports.revalidateAuthorization();
        return {
          kind: 'COMMITTED',
          resultPayload: {
            runRef,
            status: 'TIMED_OUT',
            endedAt: run.ended_at.toISOString(),
          },
        } as const;
      }
      await activeClaim(execution.trx, run);
      requireThat(
        ['CREATED', 'STARTING', 'RUNNING', 'RESULT_RECORDED'].includes(run.status) &&
          run.aggregate_version === envelope.expectedAggregateVersion,
      );
      const endedAt = ports.now();
      const nextVersion = (BigInt(run.aggregate_version) + 1n).toString();
      const updated = await execution.trx
        .updateTable('task_execution.run')
        .set({
          status: 'TIMED_OUT',
          ended_at: endedAt,
          termination_reason: 'EXECUTION_DEADLINE_EXCEEDED',
          aggregate_version: nextVersion,
          last_command_id: envelope.commandId,
        })
        .where('run_id', '=', run.run_id)
        .where('status', '=', run.status)
        .executeTakeFirst();
      requireThat(Number(updated.numUpdatedRows) === 1, 'CONCURRENCY_CONFLICT');
      const claimUpdate = await execution.trx
        .updateTable('task_execution.work_order_run_claim')
        .set({ status: 'EXPIRED' })
        .where('run_id', '=', run.run_id)
        .where('status', '=', 'ACTIVE')
        .executeTakeFirst();
      requireThat(Number(claimUpdate.numUpdatedRows) === 1, 'CONCURRENCY_CONFLICT');
      await appendEvent(
        execution,
        envelope,
        eventEnvelope(
          envelope,
          'execution.RunTerminated',
          run.run_id,
          RUN,
          nextVersion,
          {
            runRef,
            workOrderRef: object(run.work_order_ref),
            terminalStatus: 'TIMED_OUT',
            terminationReason: 'EXECUTION_DEADLINE_EXCEEDED',
            ...(run.result_ref === null ? {} : { agentResultRef: object(run.result_ref) }),
            endedAt: endedAt.toISOString(),
          },
          endedAt,
        ),
      );
      await ports.revalidateAuthorization();
      return {
        kind: 'COMMITTED',
        resultPayload: {
          runRef,
          status: 'TIMED_OUT',
          endedAt: endedAt.toISOString(),
        },
      } as const;
    },
    ports.revalidateAuthorization,
  );
}

export async function handleGetAcceptedAgentResult(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  resultRef: CanonicalJsonObject,
  revalidate: () => Promise<void>,
) {
  await revalidate();
  requireThat(resultRef.objectType === RESULT && resultRef.kind === 'CONTENT_ADDRESSED');
  return withTaskExecutionTransaction(db, context, async (trx) => {
    const result = await trx
      .selectFrom('task_execution.agent_result')
      .selectAll()
      .where('result_id', '=', textValue(resultRef.objectId))
      .executeTakeFirst();
    requireThat(
      result?.enterprise_id === context.enterpriseId &&
        result.project_id === context.allowedProjectIds[0] &&
        same(
          resultRef,
          ref(
            'CONTENT_ADDRESSED',
            RESULT,
            result.result_id,
            object(resultRef.scope),
            result.result_payload_hash.toString('hex'),
          ),
        ),
      'NOT_FOUND',
    );
    const acceptance = await trx
      .selectFrom('task_execution.agent_result_acceptance')
      .selectAll()
      .where('result_id', '=', result.result_id)
      .executeTakeFirst();
    requireThat(acceptance !== undefined, 'NOT_FOUND');
    const response = {
      agentResultRef: resultRef,
      agentResultContract: object(result.result_payload),
      acceptanceRecordRef: ref(
        'CONTENT_ADDRESSED',
        ACCEPTANCE,
        acceptance.acceptance_id,
        object(resultRef.scope),
        acceptance.payload_hash.toString('hex'),
      ),
    };
    requireThat(
      registry.validateOperationResult('execution.get_agent_result', '1.0', response).valid,
    );
    await revalidate();
    return response;
  });
}
