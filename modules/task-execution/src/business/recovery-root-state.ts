import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { ContractRegistry } from '@zhiju/contracts';
import type { CanonicalJsonObject, CanonicalJsonValue } from '@zhiju/shared-kernel';
import {
  executeTaskExecutionCommand,
  type CommandEnvelope,
} from '../persistence/command-runner.js';
import {
  withTaskExecutionTransaction,
  type TaskExecutionDb,
  type TaskExecutionTransaction,
  type TaskExecutionTransactionContext,
} from '../persistence/task-execution-db.js';
import { object, requireThat, same, textValue } from './work-order-validation-plan.js';
import {
  canonicalSet,
  insertRecoveryCommandMaterial,
  readRecoveryBlockers,
  readRecoveryBudget,
  readRecoveryResolution,
  recoveryControls,
  recoveryGuard,
  recoveryRef,
  recoveryScope,
  type RecoveryPorts,
} from './blocked-input-recovery.js';

const registry = new ContractRegistry();
async function workOrderFacts(
  trx: TaskExecutionTransaction,
  id: string,
  scope: CanonicalJsonObject,
  ports: RecoveryPorts,
) {
  const root = await trx
    .selectFrom('task_execution.work_order')
    .selectAll()
    .where('work_order_id', '=', id)
    .executeTakeFirst();
  requireThat(
    root &&
      root.enterprise_id === scope.enterpriseId &&
      root.project_id === scope.projectId &&
      root.frozen_contract_id !== null,
    'NOT_FOUND',
  );
  await ports.authorizeLocalRead('source', recoveryRef('zhiju.execution.work_order', id, scope), {
    workOrderRef: recoveryRef('zhiju.execution.work_order', id, scope),
  });
  const runs = await trx
    .selectFrom('task_execution.run')
    .selectAll()
    .where('work_order_id', '=', id)
    .orderBy('attempt_number')
    .execute();
  const blockers = await readRecoveryBlockers(trx, id, scope);
  const active = runs.find((r) =>
    ['CREATED', 'STARTING', 'RUNNING', 'RESULT_RECORDED'].includes(r.status),
  );
  const intent = (
    await sql<{
      intent_id: string;
    }>`SELECT intent_id FROM task_execution.work_order_retry_intent WHERE work_order_id=${id}`.execute(
      trx,
    )
  ).rows[0];
  let retryEligibility = 'NOT_APPLICABLE';
  if (blockers.blockerRefs.length > 0) {
    retryEligibility = blockers.unresolved
      ? 'WAITING_INPUT'
      : intent
        ? runs.some((r) => r.attempt_number === 2)
          ? 'CONSUMED'
          : 'SCHEDULED'
        : 'READY_TO_SCHEDULE';
    if (!blockers.unresolved) {
      try {
        const deps = await recoveryControls(trx, id, ports);
        for (const resolution of blockers.resolutionRefs)
          await readRecoveryResolution(trx, resolution, ports);
        const total = Number(textValue(object(deps.contract.budget).wallClockLimit).slice(2, -1));
        const budget = await readRecoveryBudget(trx, id, total);
        if (budget.remainingSeconds <= 0 || runs.length >= 2)
          retryEligibility = runs.some((r) => r.attempt_number === 2) ? 'CONSUMED' : 'EXHAUSTED';
      } catch (error) {
        const code =
          error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
        if (
          typeof code !== 'string' ||
          ![
            'AUTHORIZATION_DECISION_INVALID',
            'POLICY_EXPIRED',
            'EXECUTION_RESOLUTION_RECEIPT_INVALID',
            'EXECUTION_CONTEXT_SOURCE_INVALID',
            'EXECUTION_CONTEXT_TARGET_INVALID',
            'EXECUTION_WORK_ORDER_EXPIRED',
          ].includes(code)
        )
          throw error;
        retryEligibility = 'STALE';
      }
    }
  }
  if (runs.some((r) => r.attempt_number === 2)) retryEligibility = 'CONSUMED';
  return { root, runs, blockers, active, retryEligibility };
}
async function assertTrigger(
  trx: TaskExecutionTransaction,
  trigger: CanonicalJsonObject,
  workOrderIds: readonly string[],
  scope: CanonicalJsonObject,
) {
  requireThat(same(trigger.scope, scope));
  if (trigger.objectType === 'execution.run') {
    const run = await trx
      .selectFrom('task_execution.run')
      .selectAll()
      .where('run_id', '=', textValue(trigger.objectId))
      .executeTakeFirst();
    requireThat(
      run &&
        workOrderIds.includes(run.work_order_id) &&
        same(trigger, recoveryRef('execution.run', run.run_id, scope)),
    );
    return;
  }
  if (trigger.objectType === 'execution.agent_result_acceptance') {
    const result = await trx
      .selectFrom('task_execution.agent_result_acceptance')
      .selectAll()
      .where('acceptance_id', '=', textValue(trigger.objectId))
      .executeTakeFirst();
    const run = result
      ? await trx
          .selectFrom('task_execution.run')
          .selectAll()
          .where('run_id', '=', result.run_id)
          .executeTakeFirst()
      : undefined;
    requireThat(
      result &&
        run &&
        workOrderIds.includes(run.work_order_id) &&
        same(
          trigger,
          recoveryRef(
            'execution.agent_result_acceptance',
            result.acceptance_id,
            scope,
            object(result.canonical_payload),
          ),
        ),
    );
    return;
  }
  if (trigger.objectType === 'execution.information_request_resolution') {
    const q = (
      await sql<{
        work_order_id: string;
        resolution_ref: CanonicalJsonObject;
      }>`SELECT work_order_id,resolution_ref FROM task_execution.information_request WHERE resolution_ref->>'objectId'=${trigger.objectId}`.execute(
        trx,
      )
    ).rows[0];
    requireThat(q && workOrderIds.includes(q.work_order_id) && same(q.resolution_ref, trigger));
    return;
  }
  requireThat(false, 'REFERENCE_INVALID');
}
export async function handleGetWorkOrderExecutionState(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  ref: CanonicalJsonObject,
  ports: RecoveryPorts,
) {
  await recoveryGuard(ports);
  const result = await withTaskExecutionTransaction(db, context, async (trx) => {
    const scope = object(ref.scope);
    requireThat(ref.kind === 'OBJECT' && ref.objectType === 'zhiju.execution.work_order');
    const facts = await workOrderFacts(trx, textValue(ref.objectId), scope, ports);
    const root = facts.root;
    const view = {
      workOrderRef: ref,
      aggregateVersion: Number(root.aggregate_version),
      status: root.status,
      workOrderContractRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.contract.work_order',
        objectId: definedValue(root.frozen_contract_id),
        scope,
        contentHash: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: definedValue(root.frozen_contract_hash).toString('hex'),
        },
      },
      runRefs: canonicalSet(facts.runs.map((r) => recoveryRef('execution.run', r.run_id, scope))),
      informationRequestRefs: canonicalSet(facts.blockers.requestRefs),
      blockerRefs: facts.blockers.blockerRefs,
      retryEligibility: facts.retryEligibility,
      checkedAt: ports.now().toISOString(),
      ...(facts.active
        ? { activeRunRef: recoveryRef('execution.run', facts.active.run_id, scope) }
        : {}),
    };
    requireThat(
      registry.validateOperationResult('execution.get_work_order_execution_state', '1.0', view)
        .valid,
      'API_VALUE_INVALID',
    );
    return view;
  });
  await recoveryGuard(ports);
  return result;
}
export async function handleGetTaskExecutionState(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  ref: CanonicalJsonObject,
  ports: RecoveryPorts,
) {
  await recoveryGuard(ports);
  const result = await withTaskExecutionTransaction(db, context, async (trx) => {
    const scope = object(ref.scope);
    requireThat(ref.kind === 'OBJECT' && ref.objectType === 'zhiju.execution.task');
    const root = await trx
      .selectFrom('task_execution.task')
      .selectAll()
      .where('task_id', '=', textValue(ref.objectId))
      .executeTakeFirst();
    requireThat(
      root && root.enterprise_id === scope.enterpriseId && root.project_id === scope.projectId,
      'NOT_FOUND',
    );
    const definition = await trx
      .selectFrom('task_execution.task_definition_snapshot')
      .selectAll()
      .where('snapshot_id', '=', root.current_definition_snapshot_id)
      .executeTakeFirst();
    requireThat(definition?.schema_version === '2.0', 'NOT_FOUND');
    const workOrders = await trx
      .selectFrom('task_execution.work_order')
      .selectAll()
      .where('task_id', '=', root.task_id)
      .execute();
    const blockerRefs: CanonicalJsonValue[] = [];
    for (const wo of workOrders) {
      const facts = await workOrderFacts(trx, wo.work_order_id, scope, ports);
      blockerRefs.push(...facts.blockers.blockerRefs);
    }
    const payload = object(definition.canonical_payload);
    const def = object(payload.definition);
    const view = {
      taskRef: ref,
      aggregateVersion: Number(root.aggregate_version),
      definitionRef: recoveryRef(
        'zhiju.execution.task_definition_snapshot',
        definition.snapshot_id,
        scope,
        payload,
      ),
      status: root.status,
      dependencyTaskRefs: canonicalSet(
        Array.isArray(def.dependencyTaskRefs)
          ? (def.dependencyTaskRefs as CanonicalJsonValue[])
          : [],
      ),
      workOrderRefs: canonicalSet(
        workOrders.map((wo) => recoveryRef('zhiju.execution.work_order', wo.work_order_id, scope)),
      ),
      blockerRefs: canonicalSet(blockerRefs),
      completionUseStatus: 'NOT_EVALUATED',
    };
    requireThat(
      registry.validateOperationResult('execution.get_task_state', '1.0', view).valid,
      'API_VALUE_INVALID',
    );
    return view;
  });
  await recoveryGuard(ports);
  return result;
}
export async function handleReconcileRecoveryRoot(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  env: CommandEnvelope,
  ports: RecoveryPorts,
) {
  const isTask = env.commandType === 'execution.reconcile_task_execution';
  requireThat(
    env.commandVersion === '1.0' &&
      env.principalKind === 'SERVICE' &&
      (isTask
        ? env.targetType === 'zhiju.execution.task'
        : env.commandType === 'execution.reconcile_work_order_execution' &&
          env.targetType === 'zhiju.execution.work_order'),
  );
  const scope = recoveryScope(env),
    trigger = object(env.requestPayload.triggerRef);
  await recoveryGuard(ports);
  return executeTaskExecutionCommand(
    db,
    context,
    env,
    async (ex) => {
      const task = isTask
        ? await ex.trx
            .selectFrom('task_execution.task')
            .selectAll()
            .where('task_id', '=', env.targetId)
            .forUpdate()
            .executeTakeFirst()
        : undefined;
      const wo = isTask
        ? undefined
        : await ex.trx
            .selectFrom('task_execution.work_order')
            .selectAll()
            .where('work_order_id', '=', env.targetId)
            .forUpdate()
            .executeTakeFirst();
      if (task) {
        const definition = await ex.trx
          .selectFrom('task_execution.task_definition_snapshot')
          .select('schema_version')
          .where('snapshot_id', '=', task.current_definition_snapshot_id)
          .executeTakeFirst();
        requireThat(definition?.schema_version === '2.0', 'AGGREGATE_STATE_NOT_ALLOWED');
      }
      const root = task ?? wo;
      requireThat(
        root && root.aggregate_version === env.expectedAggregateVersion,
        'CONCURRENCY_CONFLICT',
      );
      const workOrders = isTask
        ? await ex.trx
            .selectFrom('task_execution.work_order')
            .selectAll()
            .where('task_id', '=', env.targetId)
            .orderBy('work_order_id')
            .execute()
        : [definedValue(wo)];
      await ports.authorizeLocalRead('source', trigger, { triggerRef: trigger });
      await assertTrigger(
        ex.trx,
        trigger,
        workOrders.map((w) => w.work_order_id),
        scope,
      );
      let blocked = false,
        active = false,
        allSucceeded = workOrders.length > 0;
      for (const w of workOrders) {
        const facts = await workOrderFacts(ex.trx, w.work_order_id, scope, ports);
        blocked ||= facts.blockers.blockerRefs.length > 0 && !facts.active;
        active ||= facts.active !== undefined;
        allSucceeded &&=
          facts.runs.length > 0 &&
          !facts.active &&
          facts.blockers.blockerRefs.length === 0 &&
          facts.runs.every((r) => r.status === 'SUCCEEDED');
      }
      let status = root.status;
      if (blocked) status = 'WAITING_INPUT';
      else if (active) status = isTask ? 'IN_PROGRESS' : 'RUNNING';
      else if (allSucceeded) status = 'COMPLETION_PENDING';
      if (root.status === 'WAITING_INPUT' && !active && !allSucceeded) status = 'WAITING_INPUT';
      requireThat(
        !['DRAFT', 'COMPLETED', 'CANCELLED'].includes(root.status),
        'AGGREGATE_STATE_NOT_ALLOWED',
      );
      await recoveryGuard(ports);
      if (status !== root.status) {
        await insertRecoveryCommandMaterial(ex, env);
        if (isTask) {
          await sql`UPDATE task_execution.task SET status=${status},aggregate_version=aggregate_version+1,last_execution_command_id=${env.commandId} WHERE task_id=${env.targetId} AND aggregate_version=${root.aggregate_version}`.execute(
            ex.trx,
          );
        } else {
          await ex.trx
            .updateTable('task_execution.work_order')
            .set({
              status,
              aggregate_version: (BigInt(root.aggregate_version) + 1n).toString(),
              last_transition_command_id: env.commandId,
            })
            .where('work_order_id', '=', env.targetId)
            .where('aggregate_version', '=', root.aggregate_version)
            .execute();
        }
      }
      if (ports.failAfterOutbox) ex.failAfterOutbox();
      return {
        kind: 'COMMITTED' as const,
        resultPayload: isTask
          ? { taskRef: recoveryRef('zhiju.execution.task', env.targetId, scope), status }
          : {
              workOrderRef: recoveryRef('zhiju.execution.work_order', env.targetId, scope),
              status,
            },
      };
    },
    () => recoveryGuard(ports),
  );
}

function definedValue<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) throw new Error('REFERENCE_INVALID');
  return value;
}
