// IM-06 (#204): repository for the Task DRAFT creation facts. The Task Root
// and its immutable TaskDefinitionSnapshot commit inside the command
// transaction the runner already opened; this file exposes only the inserts
// and the read-back the creation handler performs, and it re-verifies that
// every row identity and Project Scope equals the runner-bound command target.
//
// The mirror columns (Project scope, DeliveryItem mirrors, schema version,
// payload hash) are re-derived inside the database from the stored canonical
// payload by the V3001 guard, so a row that does not agree with its own
// payload is rejected before it can be committed.

import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { TaskExecutionTransaction } from './task-execution-db.js';
import { COMMAND_FACTS_RUNTIME_BRAND, type CommandFacts } from './command-runner.js';
import { readTrustedContext } from './task-execution-repository.js';
import {
  TaskExecutionPersistenceError,
  TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH,
  TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
} from './write-guards.js';

export interface TaskDefinitionSnapshotInsert {
  snapshotId: string;
  taskId: string;
  schemaVersion: string;
  enterpriseId: string;
  projectId: string;
  deliveryItemId?: string | undefined;
  deliveryItemVersionId?: string | undefined;
  canonicalPayload: CanonicalJsonObject;
  payloadHash: Buffer;
  createdByPrincipalId: string;
  sourceCommandId: string;
}

export interface TaskRootInsert {
  taskId: string;
  /** The version's own Task objectType; must equal the runner-bound target type. */
  targetObjectType: string;
  enterpriseId: string;
  projectId: string;
  currentDefinitionSnapshotId: string;
  currentDefinitionHash: Buffer;
  deliveryItemId?: string | undefined;
  deliveryItemVersionId?: string | undefined;
  createdByPrincipalId: string;
}

export interface TaskScopeRow {
  readonly status: string;
  readonly enterpriseId: string;
  readonly projectId: string;
}

function assertRunnerBoundTaskFacts(
  facts: CommandFacts,
  row: { taskId: string; enterpriseId: string; projectId: string; targetObjectType?: string },
): void {
  if (!(
    typeof facts === 'object' &&
    (facts as unknown as Record<symbol, unknown>)[COMMAND_FACTS_RUNTIME_BRAND] === true &&
    Object.isFrozen(facts)
  )) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'task insert must be bound to a runner-bound CommandFacts snapshot',
    );
  }
  if (row.targetObjectType !== undefined && facts.targetType !== row.targetObjectType) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'task target type must equal the runner-bound command target type',
    );
  }
  if (facts.targetId !== row.taskId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'task id must equal the runner-bound command targetId',
    );
  }
  if (facts.enterpriseId !== row.enterpriseId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'task enterprise scope must equal the runner-bound command enterpriseId',
    );
  }
  if (facts.projectId === null || facts.projectId !== row.projectId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'task project scope must equal the runner-bound command projectId',
    );
  }
}

async function assertTrustedCreationContext(
  trx: TaskExecutionTransaction,
  row: { enterpriseId: string; projectId: string; createdByPrincipalId: string },
): Promise<void> {
  const trusted = await readTrustedContext(trx, row.enterpriseId, row.projectId);
  if (row.createdByPrincipalId !== trusted.principal_id) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH,
      'task creator must equal the trusted transaction principal',
    );
  }
  if (!trusted.allowsEnterprise || trusted.allowsProject !== true) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'task scope is not allowed by the trusted transaction context',
    );
  }
}

export class TaskDraftRepository {
  /**
   * Inserts the immutable TaskDefinitionSnapshot of a fresh DRAFT. The row is
   * accepted only when it belongs to the runner-bound command target and its
   * creator matches the trusted transaction principal; the database mirror
   * guard then re-derives the promoted columns and the content address from
   * `canonicalPayload`.
   */
  async insertTaskDefinitionSnapshot(
    trx: TaskExecutionTransaction,
    facts: CommandFacts,
    row: TaskDefinitionSnapshotInsert,
  ): Promise<void> {
    assertRunnerBoundTaskFacts(facts, {
      taskId: row.taskId,
      enterpriseId: row.enterpriseId,
      projectId: row.projectId,
    });
    await assertTrustedCreationContext(trx, row);
    await trx
      .insertInto('task_execution.task_definition_snapshot')
      .values({
        snapshot_id: row.snapshotId,
        task_id: row.taskId,
        schema_version: row.schemaVersion,
        enterprise_id: row.enterpriseId,
        project_id: row.projectId,
        delivery_item_id: row.deliveryItemId ?? null,
        delivery_item_version_id: row.deliveryItemVersionId ?? null,
        canonical_payload: row.canonicalPayload as unknown as string,
        payload_hash: row.payloadHash,
        created_by_principal_id: row.createdByPrincipalId,
        source_command_id: row.sourceCommandId,
      })
      .execute();
  }

  /**
   * Inserts the Task Aggregate Root of a fresh DRAFT. The primary key is the
   * database-adjudicated single-winner boundary: a concurrent creation of the
   * same target inserts nothing and is reported back to the caller instead of
   * raising, so the loser can record its stable business rejection in the same
   * transaction. The composite definition pointer is checked at commit time.
   */
  async insertTaskRoot(
    trx: TaskExecutionTransaction,
    facts: CommandFacts,
    row: TaskRootInsert,
  ): Promise<boolean> {
    assertRunnerBoundTaskFacts(facts, row);
    await assertTrustedCreationContext(trx, row);
    const inserted = await trx
      .insertInto('task_execution.task')
      .values({
        task_id: row.taskId,
        enterprise_id: row.enterpriseId,
        project_id: row.projectId,
        status: 'DRAFT',
        aggregate_version: '1',
        current_definition_snapshot_id: row.currentDefinitionSnapshotId,
        current_definition_hash: row.currentDefinitionHash,
        delivery_item_id: row.deliveryItemId ?? null,
        delivery_item_version_id: row.deliveryItemVersionId ?? null,
        created_by_principal_id: row.createdByPrincipalId,
      })
      .onConflict((conflict) => conflict.column('task_id').doNothing())
      .returning('task_id')
      .executeTakeFirst();
    return inserted !== undefined;
  }

  /** Reads an existing Task in the current trusted Scope, if it is visible. */
  async readTaskScope(
    trx: TaskExecutionTransaction,
    taskId: string,
  ): Promise<TaskScopeRow | undefined> {
    const row = await trx
      .selectFrom('task_execution.task')
      .select(['status', 'enterprise_id', 'project_id'])
      .where('task_id', '=', taskId)
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : { status: row.status, enterpriseId: row.enterprise_id, projectId: row.project_id };
  }
}
