// IM-06 (#208): repository for the Task Readiness judgment fact and the
// `DRAFT` → `READY` Task Root CAS. The judgment row and the transition commit
// inside the command transaction the runner already opened; this file exposes
// only the reads the producer/consumer decide on and the two writes that must
// stay bound to the runner-bound command target.
//
// The promoted columns of a judgment (Project scope, subject mirror, Policy
// observation mirror and content address) are re-derived inside the database
// from the stored canonical payload by the V3002 mirror guard, and the
// creation-identity guard additionally requires the row to be written by the
// in-flight `execution.build_task_readiness` command that claimed it, so a row
// that disagrees with its own payload or with its own receipt fails closed.
//
// The Task Root is read through its own composite definition pointer, so the
// definition shape used to interpret `dependencyTaskRefs` is always the one the
// Root currently commits to, never "the latest snapshot of this Task".

import { sql } from 'kysely';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { TaskExecutionTransaction } from './task-execution-db.js';
import { isRunnerBoundFacts, type CommandFacts } from './command-runner.js';
import { readTrustedContext } from './task-execution-repository.js';
import {
  TaskExecutionPersistenceError,
  TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH,
  TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
} from './write-guards.js';

/** The one judgment kind this slice can write (Spec 003 §17.7). */
export const TASK_READINESS_JUDGMENT_KIND = 'TASK_READINESS';

/** The registered target type of the readiness producer command. */
export const TASK_READINESS_TARGET_TYPE = 'zhiju.execution.task_readiness';

/**
 * A Task read through its current definition pointer. `definitionSchemaVersion`,
 * `definitionInputRefs` and `dependencyTaskRefs` are `null` when no definition
 * row satisfies the pointer: the owning Handler treats that as a
 * definition-integrity failure rather than as "a Task without a definition".
 */
export interface TaskGraphNodeRow {
  readonly taskId: string;
  readonly status: string;
  readonly aggregateVersion: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly currentDefinitionSnapshotId: string;
  readonly currentDefinitionHash: Buffer;
  readonly definitionSchemaVersion: string | null;
  readonly definitionInputRefs: unknown;
  readonly dependencyTaskRefs: unknown;
}

export interface ExecutionJudgmentInsert {
  judgmentId: string;
  judgmentKind: string;
  enterpriseId: string;
  projectId: string;
  taskId: string;
  taskDefinitionSnapshotId: string;
  taskDefinitionHash: Buffer;
  policyVersionRef: CanonicalJsonObject;
  policyContentHash: Buffer;
  policyEffectiveFrom: Date;
  policySupersededAt: Date | null;
  evaluatorRef: CanonicalJsonObject;
  inputHash: Buffer;
  evaluatedAt: Date;
  validUntil: Date;
  ready: boolean;
  canonicalPayload: CanonicalJsonObject;
  payloadHash: Buffer;
  requestPayloadHash: Buffer;
  sourceCommandId: string;
  createdByPrincipalId: string;
}

export interface ExecutionJudgmentRow {
  readonly judgment_id: string;
  readonly judgment_kind: string;
  readonly enterprise_id: string;
  readonly project_id: string;
  readonly task_id: string;
  readonly task_definition_snapshot_id: string;
  readonly task_definition_hash: Buffer;
  readonly policy_version_ref: unknown;
  readonly policy_content_hash: Buffer;
  readonly policy_effective_from: Date;
  readonly policy_superseded_at: Date | null;
  readonly evaluator_ref: unknown;
  readonly input_hash: Buffer;
  readonly evaluated_at: Date;
  readonly valid_until: Date;
  readonly ready: boolean;
  readonly canonical_payload: unknown;
  readonly payload_hash: Buffer;
  readonly request_payload_hash: Buffer;
  readonly source_command_id: string;
}

export interface TaskReadyCasInput {
  readonly taskId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly expectedAggregateVersion: string;
  readonly currentDefinitionSnapshotId: string;
  readonly currentDefinitionHash: Buffer;
  /** The trusted transaction principal the transition is attributed to. */
  readonly updatedByPrincipalId: string;
}

/**
 * The closed CAS outcome. On 0 updated rows the current visible Task is
 * returned so the owning Handler maps the refusal to the exact stable code
 * (`NOT_FOUND` / `EXECUTION_TASK_NOT_EXECUTABLE` / `CONCURRENCY_CONFLICT` /
 * `EXECUTION_JUDGMENT_STALE`) instead of a generic conflict.
 */
export type TaskReadyCasResult =
  | { readonly updated: true; readonly aggregateVersion: string }
  | { readonly updated: false; readonly current: TaskGraphNodeRow | undefined };

function assertRunnerBoundJudgmentFacts(
  facts: CommandFacts,
  row: { judgmentId: string; enterpriseId: string; projectId: string },
): void {
  if (!isRunnerBoundFacts(facts)) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'judgment insert must be bound to a runner-bound CommandFacts snapshot',
    );
  }
  if (facts.targetType !== TASK_READINESS_TARGET_TYPE) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'judgment target type must be the registered readiness target',
    );
  }
  if (facts.targetId !== row.judgmentId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'judgment id must equal the runner-bound command targetId',
    );
  }
  if (facts.enterpriseId !== row.enterpriseId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'judgment enterprise scope must equal the runner-bound command enterpriseId',
    );
  }
  if (facts.projectId === null || facts.projectId !== row.projectId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'judgment project scope must equal the runner-bound command projectId',
    );
  }
}

function assertRunnerBoundTaskTargetFacts(
  facts: CommandFacts,
  row: { taskId: string; enterpriseId: string; projectId: string },
): void {
  if (!isRunnerBoundFacts(facts)) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'task transition must be bound to a runner-bound CommandFacts snapshot',
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

/** The writer must be the trusted transaction principal inside an allowed Project. */
async function assertTrustedWriteContext(
  trx: TaskExecutionTransaction,
  row: { enterpriseId: string; projectId: string; principalId: string },
): Promise<void> {
  const trusted = await readTrustedContext(trx, row.enterpriseId, row.projectId);
  if (row.principalId !== trusted.principal_id) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH,
      'the writer must equal the trusted transaction principal',
    );
  }
  if (!trusted.allowsEnterprise || trusted.allowsProject !== true) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'the write scope is not allowed by the trusted transaction context',
    );
  }
}

function nextAggregateVersion(expectedVersion: string): string {
  try {
    const parsed = BigInt(expectedVersion);
    if (parsed < 1n) throw new Error('aggregate version must be positive');
    return (parsed + 1n).toString();
  } catch {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'expected aggregate version must be a positive bigint',
    );
  }
}

export class TaskReadinessRepository {
  /**
   * Reads the Tasks of `taskIds` through their current composite definition
   * pointer. RLS is the only Scope authority: a row outside the trusted
   * Enterprise/Project is not returned at all, so "invisible" and "missing" are
   * indistinguishable here, exactly as the design requires.
   */
  async readTaskGraphNodes(
    trx: TaskExecutionTransaction,
    taskIds: readonly string[],
  ): Promise<readonly TaskGraphNodeRow[]> {
    if (taskIds.length === 0) return [];
    const rows = await trx
      .selectFrom('task_execution.task as t')
      .leftJoin('task_execution.task_definition_snapshot as s', (join) =>
        join
          .onRef('s.task_id', '=', 't.task_id')
          .onRef('s.snapshot_id', '=', 't.current_definition_snapshot_id')
          .onRef('s.payload_hash', '=', 't.current_definition_hash'),
      )
      .select([
        't.task_id',
        't.status',
        't.aggregate_version',
        't.enterprise_id',
        't.project_id',
        't.current_definition_snapshot_id',
        't.current_definition_hash',
        's.schema_version as definition_schema_version',
      ])
      .select(sql`s.canonical_payload -> 'definition' -> 'inputRefs'`.as('definition_input_refs'))
      .select(
        sql`s.canonical_payload -> 'definition' -> 'dependencyTaskRefs'`.as('dependency_task_refs'),
      )
      .where('t.task_id', 'in', [...taskIds])
      .execute();
    return rows.map((row) => ({
      taskId: row.task_id,
      status: row.status,
      aggregateVersion: row.aggregate_version,
      enterpriseId: row.enterprise_id,
      projectId: row.project_id,
      currentDefinitionSnapshotId: row.current_definition_snapshot_id,
      currentDefinitionHash: row.current_definition_hash,
      definitionSchemaVersion: row.definition_schema_version,
      definitionInputRefs: row.definition_input_refs,
      dependencyTaskRefs: row.dependency_task_refs,
    }));
  }

  /** Reads one judgment by its exact identity, if it is visible in this Scope. */
  async readExecutionJudgment(
    trx: TaskExecutionTransaction,
    judgmentId: string,
  ): Promise<ExecutionJudgmentRow | undefined> {
    const row = await trx
      .selectFrom('task_execution.execution_judgment')
      .selectAll()
      .where('judgment_id', '=', judgmentId)
      .executeTakeFirst();
    return row;
  }

  /**
   * Inserts one immutable judgment. The row is accepted only when it belongs to
   * the runner-bound command target and its creator is the trusted transaction
   * principal; the database guards then re-derive the promoted mirrors and the
   * content address from `canonicalPayload` and require the in-flight
   * `execution.build_task_readiness` Receipt that claimed this judgment id.
   *
   * A duplicate judgement identity is reported back instead of raising, so the
   * loser records its stable business rejection in the same transaction.
   */
  async insertExecutionJudgment(
    trx: TaskExecutionTransaction,
    facts: CommandFacts,
    row: ExecutionJudgmentInsert,
  ): Promise<boolean> {
    assertRunnerBoundJudgmentFacts(facts, row);
    await assertTrustedWriteContext(trx, {
      enterpriseId: row.enterpriseId,
      projectId: row.projectId,
      principalId: row.createdByPrincipalId,
    });
    const inserted = await trx
      .insertInto('task_execution.execution_judgment')
      .values({
        judgment_id: row.judgmentId,
        judgment_kind: row.judgmentKind,
        enterprise_id: row.enterpriseId,
        project_id: row.projectId,
        task_id: row.taskId,
        task_definition_snapshot_id: row.taskDefinitionSnapshotId,
        task_definition_hash: row.taskDefinitionHash,
        policy_version_ref: JSON.stringify(row.policyVersionRef),
        policy_content_hash: row.policyContentHash,
        policy_effective_from: row.policyEffectiveFrom,
        policy_superseded_at: row.policySupersededAt,
        evaluator_ref: JSON.stringify(row.evaluatorRef),
        input_hash: row.inputHash,
        evaluated_at: row.evaluatedAt,
        valid_until: row.validUntil,
        ready: row.ready,
        canonical_payload: JSON.stringify(row.canonicalPayload),
        payload_hash: row.payloadHash,
        request_payload_hash: row.requestPayloadHash,
        source_command_id: row.sourceCommandId,
        created_by_principal_id: row.createdByPrincipalId,
      })
      .onConflict((conflict) => conflict.column('judgment_id').doNothing())
      .returning('judgment_id')
      .executeTakeFirst();
    return inserted !== undefined;
  }

  /**
   * The `DRAFT`-only CAS of Spec 003 §17.8 step 7. The `WHERE` clause carries
   * the whole committed identity — Task, Enterprise, Project, DRAFT status,
   * expected aggregate version and the definition pointer — so a Task that
   * moved since the judgment was built can never be converted by it.
   */
  async casTaskStatusToReady(
    trx: TaskExecutionTransaction,
    facts: CommandFacts,
    input: TaskReadyCasInput,
  ): Promise<TaskReadyCasResult> {
    assertRunnerBoundTaskTargetFacts(facts, input);
    await assertTrustedWriteContext(trx, {
      enterpriseId: input.enterpriseId,
      projectId: input.projectId,
      principalId: input.updatedByPrincipalId,
    });
    const nextVersion = nextAggregateVersion(input.expectedAggregateVersion);
    const updated = await trx
      .updateTable('task_execution.task')
      .set({ status: 'READY', aggregate_version: nextVersion })
      .where('task_id', '=', input.taskId)
      .where('enterprise_id', '=', input.enterpriseId)
      .where('project_id', '=', input.projectId)
      .where('status', '=', 'DRAFT')
      .where('aggregate_version', '=', input.expectedAggregateVersion)
      .where('current_definition_snapshot_id', '=', input.currentDefinitionSnapshotId)
      .where('current_definition_hash', '=', input.currentDefinitionHash)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      return { updated: true, aggregateVersion: nextVersion };
    }
    const current = await this.readTaskGraphNodes(trx, [input.taskId]);
    return { updated: false, current: current.at(0) };
  }
}
