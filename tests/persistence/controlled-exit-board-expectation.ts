import { canonicalize, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import { expect } from 'vitest';
import type { InitialContextSuite } from './initial-context-suite.js';

const sortedRefs = (refs: CanonicalJsonObject[]) =>
  refs.sort((left, right) =>
    Buffer.compare(Buffer.from(canonicalize(left)), Buffer.from(canonicalize(right))),
  );

/** Independent expected public row from the committed owning mirrors. */
export async function expectedBoardItem(
  suite: InitialContextSuite,
  taskId: string,
  blocked: boolean,
): Promise<CanonicalJsonObject> {
  const scope = suite.scope();
  const task = (
    await suite.admin.query<{
      status: string;
      aggregate_version: string;
      schema_version: string;
      canonical_payload: CanonicalJsonObject;
      current_completion_evaluation_id: string | null;
      evaluation_hash: string | null;
    }>(
      `SELECT t.status,t.aggregate_version,d.schema_version,d.canonical_payload,
        t.current_completion_evaluation_id,encode(t.current_completion_evaluation_hash,'hex') AS evaluation_hash
        FROM task_execution.task t JOIN task_execution.task_definition_snapshot d
        ON d.snapshot_id=t.current_definition_snapshot_id WHERE t.task_id=$1`,
      [taskId],
    )
  ).rows[0];
  if (task === undefined) throw new Error('missing owning Task');
  const ref = (objectType: string, objectId: string): CanonicalJsonObject => ({
    kind: 'OBJECT',
    objectType,
    objectId,
    scope,
  });
  const workOrders = (
    await suite.admin.query<{
      work_order_id: string;
      work_order_object_type: string;
      status: string;
    }>(
      'SELECT work_order_id,work_order_object_type,status FROM task_execution.work_order WHERE task_id=$1 ORDER BY work_order_id',
      [taskId],
    )
  ).rows;
  const requests = (
    await suite.admin.query<{ request_id: string }>(
      `SELECT q.request_id FROM task_execution.information_request q
        JOIN task_execution.work_order w USING(work_order_id) WHERE w.task_id=$1
        AND q.status<>'RESOLVED' AND q.definition->>'blocking'='true' ORDER BY q.request_id`,
      [taskId],
    )
  ).rows;
  const blockers = requests.map((row) => ref('execution.information_request', row.request_id));
  if (blocked) {
    expect(workOrders).toHaveLength(1);
    for (const row of workOrders) blockers.push(ref(row.work_order_object_type, row.work_order_id));
  }
  const title = (task.canonical_payload.definition as CanonicalJsonObject).title;
  if (typeof title !== 'string') throw new Error('missing owning Task title');
  return {
    taskRef: ref(task.schema_version === '1.0' ? 'execution.task' : 'zhiju.execution.task', taskId),
    aggregateVersion: Number(task.aggregate_version),
    title,
    status: task.status,
    activeWorkOrderRefs: sortedRefs(
      workOrders
        .filter((row) =>
          [
            'DRAFT',
            'READY',
            'QUEUED',
            'RUNNING',
            'WAITING_INPUT',
            'COMPLETION_PENDING',
            'RETRY_PENDING',
          ].includes(row.status),
        )
        .map((row) => ref(row.work_order_object_type, row.work_order_id)),
    ),
    blockerRefs: sortedRefs(blockers),
    ...(task.current_completion_evaluation_id === null
      ? {}
      : {
          completionEvaluationRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'zhiju.execution.completion_evaluation',
            objectId: task.current_completion_evaluation_id,
            scope,
            contentHash: {
              algorithm: 'SHA-256',
              canonicalizationVersion: '1',
              digest: task.evaluation_hash,
            },
          },
        }),
  };
}
