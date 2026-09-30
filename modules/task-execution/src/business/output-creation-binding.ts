import { ContractRegistry } from '@zhiju/contracts';
import type { CanonicalJsonObject, CanonicalJsonValue } from '@zhiju/shared-kernel';
import { sql, type Kysely } from 'kysely';
import {
  withTaskExecutionTransaction,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import { object, requireThat, same, textValue } from './work-order-validation-plan.js';
import { formalCriteria } from './formal-output.js';
import { validateWorkOrderControlsPolicy } from './policy-profiles.js';
import type { ControlledFirstRunPorts } from './controlled-first-run.js';

const registry = new ContractRegistry();
export interface OutputCreationBindingPorts extends Pick<
  ControlledFirstRunPorts,
  | 'now'
  | 'revalidateAuthorization'
  | 'decisionExpiresAt'
  | 'additionalExpiries'
  | 'readContract'
  | 'readContext'
  | 'resolveControls'
  | 'readBundle'
  | 'readFrozenEligibility'
> {
  readonly authorizeSources: (runRef: CanonicalJsonObject) => Promise<void>;
}
function containsRef(value: CanonicalJsonValue, ref: CanonicalJsonObject): boolean {
  if (Array.isArray(value)) return (value as CanonicalJsonValue[]).some((v) => containsRef(v, ref));
  if (value && typeof value === 'object')
    return (
      same(value, ref) ||
      Object.values(value as CanonicalJsonObject).some((v) => containsRef(v, ref))
    );
  return false;
}
/** The bound observation grants no distributed reservation over the Run. */
export async function handleGetOutputCreationBinding(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  runRef: CanonicalJsonObject,
  ports: OutputCreationBindingPorts,
) {
  await ports.revalidateAuthorization();
  await ports.authorizeSources(runRef);
  requireThat(
    runRef.kind === 'OBJECT' &&
      runRef.objectType === 'execution.run' &&
      same(runRef.scope, {
        enterpriseId: context.enterpriseId,
        projectId: context.allowedProjectIds[0],
      }),
    'NOT_FOUND',
  );
  return withTaskExecutionTransaction(db, context, async (trx) => {
    const run = await trx
      .selectFrom('task_execution.run')
      .selectAll()
      .where('run_id', '=', textValue(runRef.objectId))
      .executeTakeFirst();
    requireThat(
      run?.status === 'RUNNING' && run.started_at && run.result_ref === null,
      'ARTIFACT_EXECUTION_BINDING_INVALID',
    );
    const claim = await trx
      .selectFrom('task_execution.work_order_run_claim')
      .selectAll()
      .where('run_id', '=', run.run_id)
      .executeTakeFirst();
    const reservation = (
      await sql<{
        run_id: string;
      }>`SELECT run_id FROM task_execution.run_final_submission_claim WHERE run_id=${run.run_id}::uuid`.execute(
        trx,
      )
    ).rows[0];
    requireThat(claim?.status === 'ACTIVE' && !reservation, 'ARTIFACT_EXECUTION_BINDING_INVALID');
    const contractView = await ports.readContract(object(run.work_order_ref)),
      contract = contractView.workOrderContract;
    requireThat(
      same(contractView.contractRef, run.work_order_contract_ref),
      'ARTIFACT_EXECUTION_BINDING_INVALID',
    );
    const output = formalCriteria(contract).output;
    const contextView = await ports.readContext(object(run.context_snapshot_ref));
    requireThat(
      same(contextView.contextSnapshotRef, run.context_snapshot_ref),
      'ARTIFACT_EXECUTION_BINDING_INVALID',
    );
    const contextExpiry = contextView.projectContextContract.expiresAt;
    const contextBounds = typeof contextExpiry === 'string' ? [Date.parse(contextExpiry)] : [];
    const unmatchedFinal = (
      await sql<{ blocked: boolean }>`SELECT EXISTS(
      SELECT 1 FROM task_execution.run r JOIN task_execution.agent_result a USING(run_id)
      JOIN task_execution.run_final_submission_claim f ON f.result_id=a.result_id
      WHERE r.work_order_id=${run.work_order_id}::uuid AND a.result_payload->>'executionOutcome'='BLOCKED_INPUT'
      AND NOT EXISTS(SELECT 1 FROM task_execution.information_request_origin o WHERE o.source_result_id=a.result_id)
    ) blocked`.execute(trx)
    ).rows[0]?.blocked;
    requireThat(unmatchedFinal === false, 'ARTIFACT_EXECUTION_BINDING_INVALID');
    const controls = await ports.resolveControls(object(run.lease_policy_ref)),
      validated = validateWorkOrderControlsPolicy(controls);
    requireThat(
      controls.useStatus === 'USABLE' && validated.valid && validated.rules.completionPolicyRef,
      'ARTIFACT_EXECUTION_BINDING_INVALID',
    );
    const bundle = await ports.readBundle(object(run.capability_grant_ref), runRef);
    requireThat(
      bundle.useStatus === 'USABLE' && same(bundle.bundleRef, run.capability_grant_ref),
      'ARTIFACT_EXECUTION_BINDING_INVALID',
    );
    const requests = (
      await sql<{
        status: string;
        resolution_ref: CanonicalJsonObject | null;
      }>`SELECT status,resolution_ref FROM task_execution.information_request WHERE work_order_id=${run.work_order_id}::uuid`.execute(
        trx,
      )
    ).rows;
    if (requests.length) {
      requireThat(
        run.attempt_number === 2 && ports.readFrozenEligibility,
        'ARTIFACT_EXECUTION_BINDING_INVALID',
      );
      const eligibility = await ports.readFrozenEligibility(
        object(run.context_snapshot_ref),
        object(run.work_order_contract_ref),
      );
      requireThat(eligibility.useStatus === 'USABLE', 'ARTIFACT_EXECUTION_BINDING_INVALID');
      requireThat(
        requests.every(
          (q) =>
            q.status === 'RESOLVED' &&
            q.resolution_ref &&
            containsRef(contextView.projectContextContract, q.resolution_ref),
        ),
        'ARTIFACT_EXECUTION_BINDING_INVALID',
      );
    }
    const now = ports.now(),
      until = Math.min(
        ...contextBounds,
        run.lease_expires_at.getTime(),
        run.execution_deadline.getTime(),
        Date.parse(textValue(bundle.payload.validUntil)),
        Date.parse(ports.decisionExpiresAt),
        controls.supersededAt ? Date.parse(controls.supersededAt) : Infinity,
        ...(ports.additionalExpiries?.() ?? []).map(Date.parse),
      );
    requireThat(
      Number.isFinite(until) && now.getTime() < until,
      'ARTIFACT_EXECUTION_BINDING_INVALID',
    );
    const result = {
      runRef,
      runAggregateVersion: Number(run.aggregate_version),
      taskRef: contract.taskRef,
      workOrderRef: contract.workOrderRef,
      workOrderContractRef: run.work_order_contract_ref,
      contextSnapshotRef: run.context_snapshot_ref,
      outputSpec: output,
      controlsPolicyRef: run.lease_policy_ref,
      capabilityGrantRef: run.capability_grant_ref,
      startedAt: run.started_at.toISOString(),
      validUntil: new Date(until).toISOString(),
    };
    requireThat(
      registry.validateOperationResult('execution.get_output_creation_binding', '1.0', result)
        .valid,
      'ARTIFACT_EXECUTION_BINDING_INVALID',
    );
    await ports.revalidateAuthorization();
    requireThat(ports.now().getTime() < until, 'ARTIFACT_EXECUTION_BINDING_INVALID');
    return result as unknown as CanonicalJsonObject;
  });
}
