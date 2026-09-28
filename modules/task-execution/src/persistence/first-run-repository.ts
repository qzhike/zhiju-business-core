import { canonicalize, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { TaskExecutionTransaction } from './task-execution-db.js';
import { isRunnerBoundFacts, type CommandFacts } from './command-runner.js';
import { CommandExecutionError, COMMAND_TARGET_MISMATCH } from './command-runner.js';

export interface WorkOrderQueue {
  workOrderId: string;
  enterpriseId: string;
  projectId: string;
  expectedVersion: string;
  policyRef: CanonicalJsonObject;
  queuedAt: Date;
}

export interface FirstRunCreate {
  attemptNumber?: number;
  fencingToken?: string;
  runId: string;
  enterpriseId: string;
  projectId: string;
  workOrderId: string;
  workOrderRef: CanonicalJsonObject;
  workOrderContractRef: CanonicalJsonObject;
  contextSnapshotRef: CanonicalJsonObject;
  capabilityGrantRef: CanonicalJsonObject;
  runtimeBinding: CanonicalJsonObject;
  leasePolicyRef: CanonicalJsonObject;
  leaseId: string;
  leaseExpiresAt: Date;
  createdAt: Date;
  principalId: string;
}

export interface FirstRunClaim {
  attemptNumber?: number;
  fencingToken?: string;
  runId: string;
  workOrderId: string;
  enterpriseId: string;
  projectId: string;
}

export interface FirstRunStart {
  runId: string;
  enterpriseId: string;
  projectId: string;
  expectedVersion: string;
  leaseId: string;
  fencingToken: string;
  attemptRef: CanonicalJsonObject;
  runtimeAdapterIdentityRef: CanonicalJsonObject;
  startedAt: Date;
}

export interface WorkOrderReconcile {
  workOrderId: string;
  enterpriseId: string;
  projectId: string;
  expectedVersion: string;
}

function bound(
  facts: CommandFacts,
  type: string,
  targetId: string,
  enterpriseId: string,
  projectId: string,
) {
  if (
    !isRunnerBoundFacts(facts) ||
    facts.commandType !== type ||
    facts.targetId !== targetId ||
    facts.enterpriseId !== enterpriseId ||
    facts.projectId !== projectId
  ) {
    throw new CommandExecutionError(COMMAND_TARGET_MISMATCH, 'first Run write target mismatch');
  }
}

export class FirstRunRepository {
  async readWorkOrderForUpdate(trx: TaskExecutionTransaction, id: string) {
    return trx
      .selectFrom('task_execution.work_order')
      .selectAll()
      .where('work_order_id', '=', id)
      .forUpdate()
      .executeTakeFirst();
  }

  async readRunForUpdate(trx: TaskExecutionTransaction, id: string) {
    return trx
      .selectFrom('task_execution.run')
      .selectAll()
      .where('run_id', '=', id)
      .forUpdate()
      .executeTakeFirst();
  }

  async readRun(trx: TaskExecutionTransaction, id: string) {
    return trx
      .selectFrom('task_execution.run')
      .selectAll()
      .where('run_id', '=', id)
      .executeTakeFirst();
  }

  async readClaim(trx: TaskExecutionTransaction, id: string) {
    return trx
      .selectFrom('task_execution.work_order_run_claim')
      .selectAll()
      .where('run_id', '=', id)
      .executeTakeFirst();
  }

  async queueWorkOrder(trx: TaskExecutionTransaction, facts: CommandFacts, input: WorkOrderQueue) {
    bound(
      facts,
      'execution.queue_work_order',
      input.workOrderId,
      input.enterpriseId,
      input.projectId,
    );
    const nextVersion = (BigInt(input.expectedVersion) + 1n).toString();
    const result = await trx
      .updateTable('task_execution.work_order')
      .set({
        status: 'QUEUED',
        aggregate_version: nextVersion,
        queue_policy_ref: canonicalize(input.policyRef),
        queued_at: input.queuedAt,
        requested_runtime_class: 'te.human_operated.synthetic',
        last_transition_command_id: facts.commandId,
      })
      .where('work_order_id', '=', input.workOrderId)
      .where('enterprise_id', '=', input.enterpriseId)
      .where('project_id', '=', input.projectId)
      .where('status', '=', 'READY')
      .where('aggregate_version', '=', input.expectedVersion)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  async insertRun(trx: TaskExecutionTransaction, facts: CommandFacts, input: FirstRunCreate) {
    bound(facts, 'execution.create_run', input.runId, input.enterpriseId, input.projectId);
    const result = await trx
      .insertInto('task_execution.run')
      .values({
        run_id: input.runId,
        enterprise_id: input.enterpriseId,
        project_id: input.projectId,
        work_order_id: input.workOrderId,
        work_order_ref: canonicalize(input.workOrderRef),
        work_order_contract_ref: canonicalize(input.workOrderContractRef),
        context_snapshot_ref: canonicalize(input.contextSnapshotRef),
        capability_grant_ref: canonicalize(input.capabilityGrantRef),
        attempt_number: input.attemptNumber ?? 1,
        runtime_binding: canonicalize(input.runtimeBinding),
        lease_policy_ref: canonicalize(input.leasePolicyRef),
        lease_id: input.leaseId,
        fencing_token: input.fencingToken ?? '1',
        lease_expires_at: input.leaseExpiresAt,
        execution_deadline: input.leaseExpiresAt,
        status: 'CREATED',
        aggregate_version: '1',
        created_at: input.createdAt,
        started_at: null,
        start_attempt_ref: null,
        runtime_adapter_identity_ref: null,
        result_ref: null,
        acceptance_ref: null,
        ended_at: null,
        termination_reason: null,
        source_command_id: facts.commandId,
        last_command_id: null,
        created_by_principal_id: input.principalId,
      })
      .onConflict((oc) => oc.column('run_id').doNothing())
      .executeTakeFirst();
    return result.numInsertedOrUpdatedRows === 1n;
  }

  async insertClaim(trx: TaskExecutionTransaction, facts: CommandFacts, input: FirstRunClaim) {
    bound(facts, 'execution.create_run', input.runId, input.enterpriseId, input.projectId);
    await trx
      .insertInto('task_execution.work_order_run_claim')
      .values({
        work_order_id: input.workOrderId,
        run_id: input.runId,
        enterprise_id: input.enterpriseId,
        project_id: input.projectId,
        attempt_number: input.attemptNumber ?? 1,
        fencing_token: input.fencingToken ?? '1',
        status: 'ACTIVE',
        source_command_id: facts.commandId,
      })
      .execute();
  }

  async startRun(trx: TaskExecutionTransaction, facts: CommandFacts, input: FirstRunStart) {
    bound(facts, 'execution.start_run', input.runId, input.enterpriseId, input.projectId);
    const nextVersion = (BigInt(input.expectedVersion) + 1n).toString();
    const result = await trx
      .updateTable('task_execution.run')
      .set({
        status: 'RUNNING',
        aggregate_version: nextVersion,
        started_at: input.startedAt,
        start_attempt_ref: canonicalize(input.attemptRef),
        runtime_adapter_identity_ref: canonicalize(input.runtimeAdapterIdentityRef),
        last_command_id: facts.commandId,
      })
      .where('run_id', '=', input.runId)
      .where('enterprise_id', '=', input.enterpriseId)
      .where('project_id', '=', input.projectId)
      .where('aggregate_version', '=', input.expectedVersion)
      .where('status', '=', 'CREATED')
      .where('lease_id', '=', input.leaseId)
      .where('fencing_token', '=', input.fencingToken)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  async reconcileWorkOrder(
    trx: TaskExecutionTransaction,
    facts: CommandFacts,
    input: WorkOrderReconcile,
  ) {
    bound(
      facts,
      'execution.reconcile_work_order_execution',
      input.workOrderId,
      input.enterpriseId,
      input.projectId,
    );
    const nextVersion = (BigInt(input.expectedVersion) + 1n).toString();
    const result = await trx
      .updateTable('task_execution.work_order')
      .set({
        status: 'RUNNING',
        aggregate_version: nextVersion,
        last_transition_command_id: facts.commandId,
      })
      .where('work_order_id', '=', input.workOrderId)
      .where('enterprise_id', '=', input.enterpriseId)
      .where('project_id', '=', input.projectId)
      .where('aggregate_version', '=', input.expectedVersion)
      .where('status', '=', 'QUEUED')
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }
}
