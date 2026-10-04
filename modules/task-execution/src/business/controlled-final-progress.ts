import {
  canonicalize,
  newUuidV7,
  sha256CanonicalJson,
  type CanonicalJsonObject,
} from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';

import {
  executeTaskExecutionCommand,
  type CommandEnvelope,
  type CommandResult,
} from '../persistence/command-runner.js';
import {
  withTaskExecutionTransaction,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import { object, requireThat, same, textValue } from './work-order-validation-plan.js';
import { scanControlledFinalCandidates } from './controlled-final-result.js';

const PROCESS_TYPE = 'controlled-final@1';
const PROCESS_COMMAND = 'execution.process_final_progress';
const RUN = 'execution.run';
const steps = ['SUBMIT', 'RECORD', 'VALIDATE', 'ACCEPT', 'FINALIZE', 'DONE'] as const;

export type ControlledFinalStep = (typeof steps)[number];

export interface ControlledFinalProgress {
  readonly processId: string;
  readonly aggregateVersion: string;
  readonly runVersion: string;
  readonly runRef: CanonicalJsonObject;
  readonly attemptRef: CanonicalJsonObject;
  readonly sourceRef: CanonicalJsonObject;
  readonly policyRef: CanonicalJsonObject;
  readonly step: ControlledFinalStep;
  readonly resultRef?: CanonicalJsonObject;
  readonly bundleRef?: CanonicalJsonObject;
  readonly validationRefs?: readonly CanonicalJsonObject[];
  readonly acceptanceRef?: CanonicalJsonObject;
}

function project(context: TaskExecutionTransactionContext): string {
  requireThat(context.allowedProjectIds.length === 1, 'SCOPE_MISMATCH');
  const id = context.allowedProjectIds[0];
  requireThat(id !== undefined, 'SCOPE_MISMATCH');
  return id;
}

function runRef(context: TaskExecutionTransactionContext, runId: string): CanonicalJsonObject {
  return {
    kind: 'OBJECT',
    objectType: RUN,
    objectId: runId,
    scope: { enterpriseId: context.enterpriseId, projectId: project(context) },
  };
}

export function controlledFinalProcessId(runId: string): string {
  requireThat(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId));
  const digest = sha256CanonicalJson({ processType: PROCESS_TYPE, runId });
  const bytes = `${digest.slice(0, 12)}7${digest.slice(13, 16)}8${digest.slice(17, 20)}${digest.slice(20, 32)}`;
  return `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-${bytes.slice(12, 16)}-${bytes.slice(16, 20)}-${bytes.slice(20)}`;
}

function assertEnvelope(
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  processId: string,
): void {
  requireThat(
    envelope.commandType === PROCESS_COMMAND &&
      envelope.commandVersion === '1.0' &&
      envelope.targetType === 'ProcessInstance' &&
      envelope.targetId === processId &&
      envelope.enterpriseId === context.enterpriseId &&
      envelope.projectId === project(context),
    'COMMAND_TARGET_MISMATCH',
  );
}

function progressFromRow(
  context: TaskExecutionTransactionContext,
  row: {
    process_id: string;
    correlation_key: string;
    aggregate_version: string;
    controlled_final_run_version?: string | null | undefined;
    controlled_final_attempt_ref?: unknown;
    controlled_final_source_ref?: unknown;
    controlled_final_policy_ref?: unknown;
    controlled_final_step?: string | null | undefined;
    controlled_final_result_ref?: unknown;
    controlled_final_bundle_ref?: unknown;
    controlled_final_validation_refs?: unknown;
    controlled_final_acceptance_ref?: unknown;
  },
): ControlledFinalProgress {
  requireThat(
    row.process_id === controlledFinalProcessId(row.correlation_key) &&
      steps.includes(row.controlled_final_step as ControlledFinalStep),
    'EXECUTION_FINAL_CONFLICT',
  );
  const resultRef = row.controlled_final_result_ref;
  const bundleRef = row.controlled_final_bundle_ref;
  const validationRefs = row.controlled_final_validation_refs;
  const acceptanceRef = row.controlled_final_acceptance_ref;
  requireThat(
    validationRefs === null || validationRefs === undefined || Array.isArray(validationRefs),
    'EXECUTION_FINAL_CONFLICT',
  );
  return {
    processId: row.process_id,
    aggregateVersion: row.aggregate_version,
    runVersion: textValue(row.controlled_final_run_version),
    runRef: runRef(context, row.correlation_key),
    attemptRef: object(row.controlled_final_attempt_ref),
    sourceRef: object(row.controlled_final_source_ref),
    policyRef: object(row.controlled_final_policy_ref),
    step: row.controlled_final_step as ControlledFinalStep,
    ...(resultRef === null || resultRef === undefined ? {} : { resultRef: object(resultRef) }),
    ...(bundleRef === null || bundleRef === undefined ? {} : { bundleRef: object(bundleRef) }),
    ...(validationRefs === null || validationRefs === undefined
      ? {}
      : { validationRefs: validationRefs.map(object) }),
    ...(acceptanceRef === null || acceptanceRef === undefined
      ? {}
      : { acceptanceRef: object(acceptanceRef) }),
  };
}

/** Reads only the Process Manager's own active progress rows. */
export async function listControlledFinalProgress(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  revalidateProgress: () => Promise<void>,
): Promise<ControlledFinalProgress[]> {
  await revalidateProgress();
  const rows = await withTaskExecutionTransaction(db, context, (trx) =>
    trx
      .selectFrom('task_execution.process_instance')
      .selectAll()
      .where('enterprise_id', '=', context.enterpriseId)
      .where('project_id', '=', project(context))
      .where('process_type', '=', PROCESS_TYPE)
      .where('state', '=', 'ACTIVE')
      .orderBy('created_at')
      .execute(),
  );
  await revalidateProgress();
  return rows.map((row) => progressFromRow(context, row));
}

/** Persists the source before the first owning Result command is issued. */
export async function createControlledFinalProgress(
  db: Kysely<TaskExecutionDb>,
  progressContext: TaskExecutionTransactionContext,
  scanContext: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  now: () => Date,
  revalidateProgress: () => Promise<void>,
  revalidateScan: () => Promise<void>,
): Promise<CommandResult> {
  const input = envelope.requestPayload;
  const run = object(input.runRef);
  const attempt = object(input.attemptRef);
  const source = object(input.sourceRef);
  const policy = object(input.policyRef);
  const runVersion = textValue(input.runVersion);
  const processId = controlledFinalProcessId(textValue(run.objectId));
  assertEnvelope(progressContext, envelope, processId);
  requireThat(
    same(run.scope, {
      enterpriseId: progressContext.enterpriseId,
      projectId: project(progressContext),
    }) &&
      run.objectType === RUN &&
      same(attempt.scope, run.scope) &&
      same(source.scope, run.scope) &&
      same(policy.scope, run.scope) &&
      source.kind === 'CONTENT_ADDRESSED' &&
      source.objectType === 'zhiju.integration.runtime_final_observation' &&
      object(source.contentHash).digest !== undefined,
    'EXECUTION_FINAL_CONFLICT',
  );
  const candidates = await scanControlledFinalCandidates(db, scanContext, now, revalidateScan);
  requireThat(
    candidates.some(
      (candidate) => same(candidate.runRef, run) && same(candidate.attemptRef, attempt),
    ),
    'EXECUTION_JUDGMENT_STALE',
  );
  await revalidateProgress();
  return executeTaskExecutionCommand(
    db,
    progressContext,
    envelope,
    async (execution) => {
      await execution.insertProcessInstance({
        processId,
        processType: PROCESS_TYPE,
        processVersion: '1',
        correlationKey: textValue(run.objectId),
        enterpriseId: progressContext.enterpriseId,
        projectId: project(progressContext),
        createdByPrincipalId: progressContext.principalId,
        controlledFinalSourceRef: canonicalize(source),
        controlledFinalAttemptRef: canonicalize(attempt),
        controlledFinalPolicyRef: canonicalize(policy),
        controlledFinalRunVersion: runVersion,
        controlledFinalStep: 'SUBMIT',
      });
      await revalidateProgress();
      return { kind: 'COMMITTED', resultPayload: { processId } } as const;
    },
    revalidateProgress,
  );
}

export interface ControlledFinalProgressAdvance {
  readonly expectedStep: Exclude<ControlledFinalStep, 'DONE'>;
  readonly nextStep: ControlledFinalStep;
  readonly sourceFactRef: CanonicalJsonObject;
  readonly stableIdempotencyKey: string;
  readonly issuedCommandType: string;
  readonly resultRef?: CanonicalJsonObject;
  readonly bundleRef?: CanonicalJsonObject;
  readonly validationRefs?: readonly CanonicalJsonObject[];
  readonly acceptanceRef?: CanonicalJsonObject;
  readonly runVersion?: string;
}

/** CAS and immutable Step are committed separately from the owning command. */
export async function advanceControlledFinalProgress(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  transition: ControlledFinalProgressAdvance,
  revalidateProgress: () => Promise<void>,
): Promise<CommandResult> {
  assertEnvelope(context, envelope, envelope.targetId);
  requireThat(
    same(envelope.requestPayload, transition) && envelope.expectedAggregateVersion !== undefined,
    'COMMAND_TARGET_MISMATCH',
  );
  const expected = steps.indexOf(transition.expectedStep);
  requireThat(expected >= 0 && steps[expected + 1] === transition.nextStep);
  const commandTypes = [
    'execution.submit_agent_result',
    'execution.record_run_result',
    'execution.validate_agent_result',
    'execution.accept_agent_result',
    'execution.finalize_run_from_acceptance',
  ] as const;
  const source = object(transition.sourceFactRef);
  const sourceHash = textValue(object(source.contentHash).digest);
  requireThat(
    transition.issuedCommandType === commandTypes[expected] &&
      transition.stableIdempotencyKey ===
        `controlled-final:${textValue(source.objectId)}:${sourceHash}:${transition.expectedStep.toLowerCase()}`,
    'EXECUTION_FINAL_CONFLICT',
  );
  await revalidateProgress();
  return executeTaskExecutionCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const row = await execution.trx
        .selectFrom('task_execution.process_instance')
        .selectAll()
        .where('process_id', '=', envelope.targetId)
        .forUpdate()
        .executeTakeFirst();
      const priorSource =
        transition.expectedStep === 'SUBMIT'
          ? row?.controlled_final_source_ref
          : transition.expectedStep === 'RECORD' || transition.expectedStep === 'VALIDATE'
            ? row?.controlled_final_result_ref
            : transition.expectedStep === 'ACCEPT'
              ? row?.controlled_final_bundle_ref
              : row?.controlled_final_acceptance_ref;
      requireThat(
        row?.process_type === PROCESS_TYPE &&
          row.enterprise_id === context.enterpriseId &&
          row.project_id === project(context) &&
          row.controlled_final_step === transition.expectedStep &&
          row.aggregate_version === envelope.expectedAggregateVersion &&
          same(priorSource, transition.sourceFactRef),
        'CONCURRENCY_CONFLICT',
      );
      const changed = await execution.casProcessInstance(
        envelope.targetId,
        envelope.expectedAggregateVersion,
        {
          ...(transition.nextStep === 'DONE' ? { state: 'COMPLETED' as const } : {}),
          controlledFinalStep: transition.nextStep,
          ...(transition.resultRef === undefined
            ? {}
            : { controlledFinalResultRef: canonicalize(transition.resultRef) }),
          ...(transition.bundleRef === undefined
            ? {}
            : { controlledFinalBundleRef: canonicalize(transition.bundleRef) }),
          ...(transition.validationRefs === undefined
            ? {}
            : { controlledFinalValidationRefs: canonicalize([...transition.validationRefs]) }),
          ...(transition.acceptanceRef === undefined
            ? {}
            : { controlledFinalAcceptanceRef: canonicalize(transition.acceptanceRef) }),
          ...(transition.runVersion === undefined
            ? {}
            : { controlledFinalRunVersion: transition.runVersion }),
        },
      );
      requireThat(changed === 'OK', 'CONCURRENCY_CONFLICT');
      await execution.appendProcessStep({
        processStepId: newUuidV7(),
        processId: envelope.targetId,
        stepNo: expected + 1,
        issuedCommandType: transition.issuedCommandType,
        outcome: 'COMPLETED',
        sourceFactRef: canonicalize(transition.sourceFactRef),
        stableIdempotencyKey: transition.stableIdempotencyKey,
      });
      await revalidateProgress();
      return {
        kind: 'COMMITTED',
        resultPayload: { processId: envelope.targetId, step: transition.nextStep },
      } as const;
    },
    revalidateProgress,
  );
}

/** A terminal or cancelling Run leaves its unfinished technical Process for
 * inspection. `observedStatus` distinguishes the deadline terminal from the
 * cancelled/abandoned outcomes; the Process is only suspended, never rebuilt. */
const suspensionReasonByStatus: Record<'TIMED_OUT' | 'CANCELLING' | 'ABANDONED', string> = {
  TIMED_OUT: 'RUN_TIMED_OUT',
  CANCELLING: 'RUN_CANCELLING',
  ABANDONED: 'RUN_ABANDONED',
};

export async function suspendTimedOutControlledFinalProgress(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  progress: ControlledFinalProgress,
  readRunStatus: (runRef: CanonicalJsonObject) => Promise<string>,
  revalidateProgress: () => Promise<void>,
  observedStatus: 'TIMED_OUT' | 'CANCELLING' | 'ABANDONED' = 'TIMED_OUT',
): Promise<CommandResult> {
  assertEnvelope(context, envelope, progress.processId);
  requireThat(
    same(envelope.requestPayload, {
      runRef: progress.runRef,
      sourceRef: progress.sourceRef,
      step: progress.step,
      observedStatus,
    }) && envelope.expectedAggregateVersion === progress.aggregateVersion,
    'COMMAND_TARGET_MISMATCH',
  );
  await revalidateProgress();
  requireThat(
    (await readRunStatus(progress.runRef)) === observedStatus,
    'EXECUTION_JUDGMENT_STALE',
  );
  const reason = suspensionReasonByStatus[observedStatus];
  return executeTaskExecutionCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const row = await execution.trx
        .selectFrom('task_execution.process_instance')
        .selectAll()
        .where('process_id', '=', progress.processId)
        .forUpdate()
        .executeTakeFirst();
      requireThat(
        row?.process_type === PROCESS_TYPE &&
          row.state === 'ACTIVE' &&
          row.enterprise_id === context.enterpriseId &&
          row.project_id === project(context) &&
          row.aggregate_version === progress.aggregateVersion &&
          row.controlled_final_step === progress.step &&
          same(row.controlled_final_source_ref, progress.sourceRef),
        'CONCURRENCY_CONFLICT',
      );
      const changed = await execution.casProcessInstance(
        progress.processId,
        progress.aggregateVersion,
        { state: 'SUSPENDED', blockedReasonCode: reason },
      );
      requireThat(changed === 'OK', 'CONCURRENCY_CONFLICT');
      await execution.appendProcessStep({
        processStepId: newUuidV7(),
        processId: progress.processId,
        stepNo: steps.indexOf(progress.step) + 1,
        outcome: 'SKIPPED',
        failureCode: reason,
        sourceFactRef: canonicalize(progress.runRef),
      });
      await revalidateProgress();
      return {
        kind: 'COMMITTED',
        resultPayload: { processId: progress.processId, state: 'SUSPENDED' },
      } as const;
    },
    revalidateProgress,
  );
}
