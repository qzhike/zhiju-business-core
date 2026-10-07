// IM-06 TD-05 (#248): the single owning Board row algorithm.
//
// Both the AUTHORITATIVE query path and the export/dispatch path assemble the
// same internal `TaskBoardSnapshotRow[]` from one REPEATABLE READ TaskExecution
// snapshot. Nothing here writes: the assembler only reads the owning rows of
// the requested Project and revalidates their local mirrors before emitting a
// row, so a damaged mirror fails the whole read instead of dropping a row.

import type { CanonicalJsonObject, CanonicalJsonValue } from '@zhiju/shared-kernel';
import { getContractRegistry } from '@zhiju/contracts';
import { sql } from 'kysely';
import type { TaskExecutionTransaction } from '../persistence/task-execution-db.js';
import { digestCanonicalPayload } from '../persistence/task-execution-db.js';
import { canonicalSet, recoveryRef, REQUEST_OBJECT_TYPE } from './blocked-input-recovery.js';
import { hash, object, requireThat, same, textValue } from './work-order-validation-plan.js';
import {
  TASK_BOARD_ACTIVE_WORK_ORDER_STATUSES,
  taskBoardSourceFingerprint,
  taskBoardSameVersionedRef,
  type TaskBoardSnapshotRow,
  type TaskBoardSourceIdentity,
} from './task-board-types.js';

const registry = getContractRegistry();

const TASK_OBJECT_TYPE_BY_SCHEMA_VERSION: Readonly<Record<string, string>> = {
  '1.0': 'execution.task',
  '2.0': 'zhiju.execution.task',
};

const DELIVERY_ITEM_OBJECT_TYPES: Readonly<Record<string, true>> = {
  'project.delivery_item': true,
  'zhiju.project.delivery_item': true,
};

const ACTIVE_WORK_ORDER_STATUS: Readonly<Record<string, true>> = Object.fromEntries(
  TASK_BOARD_ACTIVE_WORK_ORDER_STATUSES.map((status) => [status, true]),
);

export interface TaskBoardSourceScope {
  readonly enterpriseId: string;
  readonly projectId: string;
}

export interface TaskBoardSourceSnapshot {
  readonly rows: readonly TaskBoardSnapshotRow[];
  readonly sources: readonly TaskBoardSourceIdentity[];
  readonly sourceFingerprint: string;
}

async function readCurrentCompletionEvaluation(
  trx: TaskExecutionTransaction,
  root: {
    readonly task_id: string;
    readonly enterprise_id: string;
    readonly project_id: string;
    readonly current_completion_evaluation_id: string | null;
    readonly current_completion_evaluation_hash: Buffer | null;
  },
  scope: CanonicalJsonObject,
): Promise<CanonicalJsonObject | undefined> {
  const id = root.current_completion_evaluation_id;
  const expected = root.current_completion_evaluation_hash;
  if (id === null || expected === null) return undefined;
  const evaluation = (
    await sql<{
      target_kind: string;
      target_id: string;
      enterprise_id: string;
      project_id: string;
      payload_hash: Buffer;
    }>`SELECT target_kind,target_id,enterprise_id,project_id,payload_hash FROM task_execution.completion_evaluation WHERE evaluation_id=${id}`.execute(
      trx,
    )
  ).rows[0];
  requireThat(evaluation !== undefined, 'INTERNAL_CONTRACT_VIOLATION');
  requireThat(
    evaluation.target_kind === 'TASK' &&
      evaluation.target_id === root.task_id &&
      evaluation.enterprise_id === root.enterprise_id &&
      evaluation.project_id === root.project_id &&
      evaluation.payload_hash.equals(expected),
    'INTERNAL_CONTRACT_VIOLATION',
  );
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'zhiju.execution.completion_evaluation',
    objectId: id,
    scope,
    contentHash: hash(expected.toString('hex')),
  };
}

/**
 * Assemble every published Board row of one Project from the current owning
 * snapshot. The caller supplies the transaction (REPEATABLE READ for the query
 * and export paths) and the trusted Project Scope.
 */
export async function assembleTaskBoardRows(
  trx: TaskExecutionTransaction,
  scope: TaskBoardSourceScope,
  projectRef: CanonicalJsonObject,
): Promise<TaskBoardSourceSnapshot> {
  requireThat(projectRef.kind === 'OBJECT', 'REFERENCE_INVALID');
  const canonicalScope: CanonicalJsonObject = {
    enterpriseId: scope.enterpriseId,
    projectId: scope.projectId,
  };
  const tasks = await trx
    .selectFrom('task_execution.task')
    .selectAll()
    .where('enterprise_id', '=', scope.enterpriseId)
    .where('project_id', '=', scope.projectId)
    .orderBy('task_id')
    .execute();

  const rows: TaskBoardSnapshotRow[] = [];
  const sources: TaskBoardSourceIdentity[] = [];
  for (const root of tasks) {
    const aggregateVersion = Number(root.aggregate_version);
    requireThat(Number.isSafeInteger(aggregateVersion) && aggregateVersion >= 0);
    const definition = await trx
      .selectFrom('task_execution.task_definition_snapshot')
      .selectAll()
      .where('snapshot_id', '=', root.current_definition_snapshot_id)
      .where('task_id', '=', root.task_id)
      .executeTakeFirst();
    requireThat(definition !== undefined, 'INTERNAL_CONTRACT_VIOLATION');
    const taskObjectType = TASK_OBJECT_TYPE_BY_SCHEMA_VERSION[definition.schema_version];
    requireThat(taskObjectType !== undefined, 'INTERNAL_CONTRACT_VIOLATION');
    requireThat(
      definition.enterprise_id === scope.enterpriseId && definition.project_id === scope.projectId,
      'INTERNAL_CONTRACT_VIOLATION',
    );
    const body = object(definition.canonical_payload);
    requireThat(
      definition.payload_hash.equals(digestCanonicalPayload(body).hash),
      'INTERNAL_CONTRACT_VIOLATION',
    );
    // The immutable snapshot stores the complete creation payload; the Task
    // definition (and therefore the title and the DeliveryItem binding) lives
    // in its `definition` member.
    const definitionBody = object(body.definition);
    const title = textValue(definitionBody.title);
    requireThat(title.length > 0, 'INTERNAL_CONTRACT_VIOLATION');

    let deliveryItemRef: CanonicalJsonObject | undefined;
    if (definitionBody.deliveryItemRef !== undefined) {
      const ref = object(definitionBody.deliveryItemRef);
      requireThat(
        ref.kind === 'VERSIONED' &&
          typeof ref.objectType === 'string' &&
          DELIVERY_ITEM_OBJECT_TYPES[ref.objectType] === true &&
          typeof ref.objectId === 'string' &&
          typeof ref.versionId === 'string' &&
          same(ref.scope, canonicalScope),
        'INTERNAL_CONTRACT_VIOLATION',
      );
      deliveryItemRef = ref;
    }

    const workOrders = await trx
      .selectFrom('task_execution.work_order')
      .selectAll()
      .where('task_id', '=', root.task_id)
      .where('enterprise_id', '=', scope.enterpriseId)
      .where('project_id', '=', scope.projectId)
      .orderBy('work_order_id')
      .execute();

    const activeWorkOrderRefs: CanonicalJsonValue[] = [];
    const blockerRefs: CanonicalJsonValue[] = [];
    for (const workOrder of workOrders) {
      const workOrderRef = recoveryRef(
        workOrder.work_order_object_type,
        workOrder.work_order_id,
        canonicalScope,
      );
      if (ACTIVE_WORK_ORDER_STATUS[workOrder.status] === true)
        activeWorkOrderRefs.push(workOrderRef);
      const blocked = await sql<{
        blocked: boolean;
      }>`SELECT task_execution.recovery_work_order_blocked(${workOrder.work_order_id}::uuid) AS blocked`.execute(
        trx,
      );
      if (blocked.rows[0]?.blocked === true) blockerRefs.push(workOrderRef);
      sources.push({
        sourceType: 'work_order',
        sourceId: workOrder.work_order_id,
        sourceVersion: Number(workOrder.aggregate_version),
      });
    }

    const unresolvedRequests = (
      await sql<{
        request_id: string;
      }>`SELECT request_id FROM task_execution.information_request q WHERE q.enterprise_id=${scope.enterpriseId} AND q.project_id=${scope.projectId} AND q.work_order_id IN (SELECT work_order_id FROM task_execution.work_order WHERE task_id=${root.task_id}) AND q.status<>'RESOLVED' AND q.definition->>'blocking'='true' ORDER BY request_id`.execute(
        trx,
      )
    ).rows;
    for (const request of unresolvedRequests) {
      blockerRefs.push(recoveryRef(REQUEST_OBJECT_TYPE, request.request_id, canonicalScope));
      sources.push({ sourceType: 'information_request', sourceId: request.request_id });
    }

    const completionEvaluationRef = await readCurrentCompletionEvaluation(
      trx,
      root,
      canonicalScope,
    );
    const item: CanonicalJsonObject = {
      taskRef: recoveryRef(taskObjectType, root.task_id, canonicalScope),
      aggregateVersion,
      title,
      status: root.status,
      blockerRefs: canonicalSet(blockerRefs),
      activeWorkOrderRefs: canonicalSet(activeWorkOrderRefs),
      ...(completionEvaluationRef === undefined ? {} : { completionEvaluationRef }),
    };
    rows.push(
      deliveryItemRef === undefined
        ? { item, filterKeys: {} }
        : { item, filterKeys: { deliveryItemRef } },
    );
    sources.push({ sourceType: 'task', sourceId: root.task_id, sourceVersion: aggregateVersion });
    sources.push({
      sourceType: 'task_definition_snapshot',
      sourceId: definition.snapshot_id,
      sourceHash: definition.payload_hash.toString('hex'),
    });
  }

  const ordered = [...rows].sort((left, right) =>
    Buffer.compare(
      Buffer.from(textValue(object(left.item.taskRef).objectId), 'utf8'),
      Buffer.from(textValue(object(right.item.taskRef).objectId), 'utf8'),
    ),
  );
  requireThat(
    registry.validateOperationResult('execution.get_task_board_slice', '1.0', {
      items: ordered.map((row) => row.item),
      snapshotAt: new Date().toISOString(),
      sourceWatermarks: [],
    }).valid,
    'INTERNAL_CONTRACT_VIOLATION',
  );
  return {
    rows: ordered,
    sources,
    sourceFingerprint: taskBoardSourceFingerprint(ordered, sources),
  };
}

/** Whether a row's bound DeliveryItem ref is exactly the requested filter. */
export function taskBoardRowMatchesDeliveryItem(
  row: TaskBoardSnapshotRow,
  requested: CanonicalJsonObject | undefined,
): boolean {
  if (requested === undefined) return true;
  return taskBoardSameVersionedRef(row.filterKeys.deliveryItemRef, requested);
}
