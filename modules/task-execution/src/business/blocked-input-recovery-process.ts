import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import {
  canonicalize,
  sha256CanonicalJson,
  newUuidV7,
  type CanonicalJsonObject,
} from '@zhiju/shared-kernel';
import {
  executeTaskExecutionCommand,
  type CommandEnvelope,
} from '../persistence/command-runner.js';
import {
  withTaskExecutionTransaction,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import { insertRecoveryCommandMaterial } from './blocked-input-recovery.js';
import { requireThat, object, textValue, same } from './work-order-validation-plan.js';

export const BLOCKED_INPUT_RECOVERY_STEPS = [
  'REQUEST_OPEN',
  'WORK_ORDER_WAIT',
  'TASK_WAIT',
  'CONTEXT_BUILD',
  'WAIT_HUMAN_RETRY',
  'BUNDLE_ISSUE',
  'RUN_CREATE',
  'DISPATCH',
  'START',
  'WORK_ORDER_RUN',
  'TASK_RUN',
  'WORK_ORDER_FINAL',
  'TASK_FINAL',
] as const;
export interface RecoveryProcessProgress {
  readonly processId: string;
  readonly version: string;
  readonly step: number;
  readonly sourceRef: CanonicalJsonObject;
  readonly proposalId: string;
  readonly command?: CanonicalJsonObject;
}
export interface RecoveryProcessPorts {
  readonly revalidateScan: () => Promise<void>;
  readonly revalidateProgress: () => Promise<void>;
  /** This read has its own current rights; a progress grant grants no business access. */
  readonly prepareStep: (
    progress: RecoveryProcessProgress,
    stableKey: string,
  ) => Promise<CanonicalJsonObject | undefined>;
  readonly execute: (command: CanonicalJsonObject) => Promise<CanonicalJsonObject>;
  readonly progressEnvelope: (
    id: string,
    version: string | undefined,
    payload: CanonicalJsonObject,
  ) => Promise<CommandEnvelope>;
  readonly progressAuthority: (
    envelope: CommandEnvelope,
  ) => Promise<{ context: TaskExecutionTransactionContext; revalidate: () => Promise<void> }>;
  readonly afterTargetCommit?: () => Promise<void>;
}
export function blockedInputRecoveryProcessId(source: CanonicalJsonObject, proposalId: string) {
  const h = sha256CanonicalJson({ source, proposalId, processType: 'blocked-input-recovery@1' });
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function scope(context: TaskExecutionTransactionContext) {
  requireThat(context.allowedProjectIds.length === 1);
  return {
    enterpriseId: context.enterpriseId,
    projectId: definedValue(context.allowedProjectIds[0]),
  };
}
/** Scan only committed accepted terminal BLOCKED_INPUT sources in one Project. */
export async function scanBlockedInputRecoveryCandidates(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  guard: () => Promise<void>,
) {
  await guard();
  const refs = await withTaskExecutionTransaction(db, context, async (trx) => {
    const rows = (
      await sql<{
        result_id: string;
        result_payload_hash: Buffer;
        proposal_id: string;
      }>`SELECT a.result_id,a.result_payload_hash,a.result_payload->'inputRequestProposals'->0->>'proposalId' proposal_id FROM task_execution.agent_result a JOIN task_execution.run r ON r.run_id=a.run_id JOIN task_execution.agent_result_acceptance ac ON ac.result_id=a.result_id JOIN task_execution.run_final_submission_claim c ON c.result_id=a.result_id JOIN task_execution.work_order_contract wc ON wc.contract_id::text=r.work_order_contract_ref->>'objectId' WHERE wc.canonical_payload->'executionPolicy'->>'maxAttempts'='2' AND wc.canonical_payload->'executionPolicy'->'retryableOutcomes'='["BLOCKED_INPUT"]'::jsonb AND r.status='SUCCEEDED' AND ac.canonical_payload->>'disposition'='ACCEPTED' AND a.result_payload->>'executionOutcome'='BLOCKED_INPUT' AND jsonb_array_length(a.result_payload->'inputRequestProposals')=1 ORDER BY a.result_id`.execute(
        trx,
      )
    ).rows;
    return rows.map((r) => ({
      sourceRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'execution.agent_result',
        objectId: r.result_id,
        scope: scope(context),
        contentHash: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: r.result_payload_hash.toString('hex'),
        },
      },
      proposalId: r.proposal_id,
    }));
  });
  await guard();
  return refs;
}
async function progressRows(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  guard: () => Promise<void>,
) {
  await guard();
  const rows = await withTaskExecutionTransaction(
    db,
    context,
    async (trx) =>
      (
        await sql<{
          process_id: string;
          aggregate_version: string;
          recovery_step: number;
          recovery_source_ref: CanonicalJsonObject;
          recovery_proposal_id: string;
          command_bytes: CanonicalJsonObject | null;
        }>`SELECT p.*,m.command_bytes FROM task_execution.process_instance p LEFT JOIN task_execution.recovery_process_command m ON m.process_id=p.process_id AND m.step_no=p.recovery_step WHERE p.process_type='blocked-input-recovery@1' AND p.state='ACTIVE' ORDER BY p.process_id`.execute(
          trx,
        )
      ).rows,
  );
  await guard();
  return rows.map((r): RecoveryProcessProgress => ({
    processId: r.process_id,
    version: r.aggregate_version,
    step: r.recovery_step,
    sourceRef: r.recovery_source_ref,
    proposalId: r.recovery_proposal_id,
    ...(r.command_bytes === null ? {} : { command: r.command_bytes }),
  }));
}
const RECOVERY_SUSPENSION_CODES = new Set([
  'AUTHORIZATION_DECISION_INVALID',
  'AUTHORIZATION_REVOKED',
  'AUTHORIZATION_DECISION_EXPIRED',
  'POLICY_EXPIRED',
  'EXECUTION_WORK_ORDER_EXPIRED',
  'EXECUTION_WORK_ORDER_BUDGET_EXHAUSTED',
  'EXECUTION_CONTEXT_SOURCE_INVALID',
  'EXECUTION_CONTEXT_TARGET_INVALID',
]);

/** Current progress-read rights expose finite, sanitized coordination state. */
export async function readBlockedInputRecoveryProgress(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  guard: () => Promise<void>,
) {
  await guard();
  const result = await withTaskExecutionTransaction(
    db,
    context,
    async (trx) =>
      (
        await sql<{
          process_id: string;
          state: string;
          aggregate_version: string;
          recovery_step: number;
          blocked_reason_code: string | null;
        }>`SELECT process_id,state,aggregate_version,recovery_step,blocked_reason_code FROM task_execution.process_instance WHERE process_type='blocked-input-recovery@1' ORDER BY process_id`.execute(
          trx,
        )
      ).rows,
  );
  await guard();
  return result;
}

/** Each target transaction precedes an independent Process CAS. */
export async function recoverBlockedInput(
  db: Kysely<TaskExecutionDb>,
  scanContext: TaskExecutionTransactionContext,
  progressContext: TaskExecutionTransactionContext,
  ports: RecoveryProcessPorts,
  maxSteps: number = BLOCKED_INPUT_RECOVERY_STEPS.length,
) {
  requireThat(
    Number.isSafeInteger(maxSteps) &&
      maxSteps > 0 &&
      maxSteps <= BLOCKED_INPUT_RECOVERY_STEPS.length,
  );
  let completed = 0;
  const candidates = await scanBlockedInputRecoveryCandidates(
    db,
    scanContext,
    ports.revalidateScan,
  );
  const existingProcesses = new Set(
    (await readBlockedInputRecoveryProgress(db, progressContext, ports.revalidateProgress)).map(
      (progress) => progress.process_id,
    ),
  );
  for (const candidate of candidates) {
    const id = blockedInputRecoveryProcessId(candidate.sourceRef, candidate.proposalId);
    // Progress has its own current authority. Existing instances resume below;
    // they need no fresh creation command or no-op Receipt on every scan.
    if (existingProcesses.has(id)) continue;
    const env = await ports.progressEnvelope(id, undefined, candidate);
    const authority = await ports.progressAuthority(env);
    await authority.revalidate();
    await executeTaskExecutionCommand(
      db,
      authority.context,
      env,
      async (ex) => {
        const exists = await ex.trx
          .selectFrom('task_execution.process_instance')
          .select('process_id')
          .where('process_id', '=', id)
          .executeTakeFirst();
        if (!exists) {
          await insertRecoveryCommandMaterial(ex, env);
          await sql`INSERT INTO task_execution.process_instance(process_id,process_type,process_version,correlation_key,state,enterprise_id,project_id,created_by_principal_id,recovery_source_ref,recovery_proposal_id,recovery_step,last_recovery_command_id) VALUES(${id},'blocked-input-recovery@1','1',${candidate.sourceRef.objectId},'ACTIVE',${progressContext.enterpriseId},${scope(progressContext).projectId},${env.principalId},${canonicalize(candidate.sourceRef)}::jsonb,${candidate.proposalId}::uuid,0,${env.commandId})`.execute(
            ex.trx,
          );
        }
        return { kind: 'COMMITTED' as const, resultPayload: { processId: id } };
      },
      authority.revalidate,
    );
  }
  for (let i = 0; i < maxSteps; i++) {
    const rows = await progressRows(db, progressContext, ports.revalidateProgress);
    if (rows.length === 0) break;
    let advanced = false;
    for (const progress of rows) {
      try {
        const key = `blocked-input-recovery:${textValue(progress.sourceRef.objectId)}:${textValue(object(progress.sourceRef.contentHash).digest)}:${progress.proposalId}:${progress.step}`;
        let command = progress.command;
        if (!command) {
          command = await ports.prepareStep(progress, key);
          if (!command) continue;
          requireThat(
            (command.commandType === undefined
              ? command.queryType === 'execution.get_work_order_execution_state' &&
                progress.step === 4
              : command.idempotencyKey === key) && same(command.scopeRef, scope(progressContext)),
            'COMMAND_TARGET_MISMATCH',
          );
          const env = await ports.progressEnvelope(progress.processId, progress.version, {
            command,
          });
          const authority = await ports.progressAuthority(env);
          await authority.revalidate();
          await executeTaskExecutionCommand(
            db,
            authority.context,
            env,
            async (ex) => {
              const row = await ex.trx
                .selectFrom('task_execution.process_instance')
                .selectAll()
                .where('process_id', '=', progress.processId)
                .forUpdate()
                .executeTakeFirst();
              requireThat(row?.aggregate_version === progress.version, 'CONCURRENCY_CONFLICT');
              await insertRecoveryCommandMaterial(ex, env);
              await sql`INSERT INTO task_execution.recovery_process_command(process_id,step_no,enterprise_id,project_id,command_bytes,payload_hash,stable_idempotency_key,source_command_id) VALUES(${progress.processId},${progress.step},${progressContext.enterpriseId},${scope(progressContext).projectId},${canonicalize(definedValue(command))}::jsonb,${Buffer.from(sha256CanonicalJson(object(definedValue(command).payload)), 'hex')},${key},${env.commandId}) ON CONFLICT(process_id,step_no) DO NOTHING`.execute(
                ex.trx,
              );
              return {
                kind: 'COMMITTED' as const,
                resultPayload: { processId: progress.processId },
              };
            },
            authority.revalidate,
          );
        }
        // A concurrent preparer must execute the persisted winner's exact bytes.
        const saved = await withTaskExecutionTransaction(
          db,
          progressContext,
          async (trx) =>
            (
              await sql<{
                command_bytes: CanonicalJsonObject;
              }>`SELECT command_bytes FROM task_execution.recovery_process_command WHERE process_id=${progress.processId} AND step_no=${progress.step}`.execute(
                trx,
              )
            ).rows[0],
        );
        requireThat(saved, 'REFERENCE_INVALID');
        command = saved.command_bytes;
        const humanWait = BLOCKED_INPUT_RECOVERY_STEPS[progress.step] === 'WAIT_HUMAN_RETRY';
        if (humanWait) {
          requireThat(
            command.queryType === 'execution.get_work_order_execution_state' &&
              command.commandType === undefined,
            'COMMAND_TARGET_MISMATCH',
          );
        } else {
          requireThat(typeof command.commandType === 'string', 'COMMAND_TARGET_MISMATCH');
        }
        const result = await ports.execute(command);
        if (humanWait) {
          requireThat(
            result.retryEligibility !== 'EXHAUSTED',
            'EXECUTION_WORK_ORDER_BUDGET_EXHAUSTED',
          );
          requireThat(result.retryEligibility !== 'STALE', 'EXECUTION_CONTEXT_SOURCE_INVALID');
        }
        if (
          humanWait &&
          (result.status !== 'RETRY_PENDING' || result.retryEligibility !== 'SCHEDULED')
        )
          continue;
        requireThat(
          humanWait || ['COMMITTED', 'DUPLICATE'].includes(textValue(result.status)),
          'DEPENDENCY_UNAVAILABLE',
        );
        await ports.afterTargetCommit?.();
        const env = await ports.progressEnvelope(progress.processId, progress.version, {
          step: progress.step,
          stableIdempotencyKey: key,
        });
        const authority = await ports.progressAuthority(env);
        await authority.revalidate();
        await executeTaskExecutionCommand(
          db,
          authority.context,
          env,
          async (ex) => {
            await insertRecoveryCommandMaterial(ex, env);
            const changed = await ex.casProcessInstance(progress.processId, progress.version, {
              ...(progress.step === BLOCKED_INPUT_RECOVERY_STEPS.length - 1
                ? { state: 'COMPLETED' as const }
                : {}),
              recoveryStep: progress.step + 1,
              recoveryCommandId: env.commandId,
            });
            requireThat(changed === 'OK', 'CONCURRENCY_CONFLICT');
            await ex.appendProcessStep({
              processStepId: newUuidV7(),
              processId: progress.processId,
              stepNo: progress.step + 1,
              ...(humanWait ? {} : { issuedCommandId: textValue(command.commandId) }),
              issuedCommandType: textValue(command.commandType ?? command.queryType),
              outcome: 'COMPLETED',
              sourceFactRef: canonicalize(progress.sourceRef),
              stableIdempotencyKey: key,
            });
            return { kind: 'COMMITTED' as const, resultPayload: { processId: progress.processId } };
          },
          authority.revalidate,
        );
        completed++;
        advanced = true;
        if (completed >= maxSteps) return completed;
      } catch (error) {
        const code =
          error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
        if (code === 'CONCURRENCY_CONFLICT' || code === 'AGGREGATE_VERSION_CONFLICT') continue;
        if (typeof code !== 'string' || !RECOVERY_SUSPENSION_CODES.has(code)) throw error;
        const env = await ports.progressEnvelope(progress.processId, progress.version, {
          suspendReason: code,
        });
        const authority = await ports.progressAuthority(env);
        await authority.revalidate();
        await executeTaskExecutionCommand(
          db,
          authority.context,
          env,
          async (ex) => {
            await insertRecoveryCommandMaterial(ex, env);
            const changed = await ex.casProcessInstance(progress.processId, progress.version, {
              state: 'SUSPENDED',
              blockedReasonCode: code,
              recoveryCommandId: env.commandId,
            });
            requireThat(changed === 'OK', 'CONCURRENCY_CONFLICT');
            return {
              kind: 'COMMITTED' as const,
              resultPayload: {
                processId: progress.processId,
                state: 'SUSPENDED',
                blockedReasonCode: code,
              },
            };
          },
          authority.revalidate,
        );
      }
    }
    if (!advanced) break;
  }
  return completed;
}

function definedValue<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) throw new Error('REFERENCE_INVALID');
  return value;
}
