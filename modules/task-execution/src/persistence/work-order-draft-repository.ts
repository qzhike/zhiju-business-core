// IM-06 (#212): repository for the WorkOrder DRAFT creation facts and the exact
// draft reads. The WorkOrder Root and its immutable WorkOrderDraftSnapshot
// commit inside the command transaction the runner already opened; this file
// exposes only the inserts, the read-back the creation handler performs and the
// committed reads the draft-read query performs. Every insert re-verifies that
// the row identity and Project Scope equal the runner-bound command target and
// that the writer is the trusted transaction principal.
//
// The promoted mirrors (WorkOrder and Task spellings, Project Scope, nullable
// expiry, payload hash) are re-derived inside the database from the stored
// canonical payload by the V3003 mirror guard, and the V3003 creation-identity
// guard closes the snapshot against the in-flight `execution.create_work_order`
// Receipt and the bound Task's own creation definition. A row that does not
// agree with its own payload, its command or its Task is therefore rejected
// before it can be committed, so these helpers do not restate those comparisons.
//
// The bound Task read is the §18.4 read-only dependency lock: `FOR SHARE` on
// this module's own Task row, held from the read until commit, so the status the
// creation handler validates is the status the transaction commits under.

import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { TaskExecutionTransaction } from './task-execution-db.js';
import { COMMAND_FACTS_RUNTIME_BRAND, type CommandFacts } from './command-runner.js';
import { readTrustedContext } from './task-execution-repository.js';
import {
  TaskExecutionPersistenceError,
  TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH,
  TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
} from './write-guards.js';

/** The Root row of one DRAFT creation, exactly as V3003 stores it. */
export interface WorkOrderRootInsert {
  workOrderId: string;
  /** The version's own WorkOrder spelling; must equal the runner-bound target type. */
  workOrderObjectType: string;
  /** The bound Task and the spelling its own creation definition derives. */
  taskId: string;
  taskObjectType: string;
  draftSchemaVersion: string;
  enterpriseId: string;
  projectId: string;
  currentDraftSnapshotId: string;
  currentDraftSnapshotHash: Buffer;
  /** Absent exactly when the create request declared no `expiresAt` member. */
  expiresAt?: string | undefined;
  createdByPrincipalId: string;
  requestedByPrincipalId: string;
}

/** The immutable `WorkOrderDraftSnapshot` row of one DRAFT creation. */
export interface WorkOrderDraftSnapshotInsert {
  snapshotId: string;
  workOrderId: string;
  draftSchemaVersion: string;
  workOrderObjectType: string;
  taskObjectType: string;
  enterpriseId: string;
  projectId: string;
  expiresAt?: string | undefined;
  canonicalPayload: CanonicalJsonObject;
  payloadHash: Buffer;
  requestPayloadHash: Buffer;
  createdByPrincipalId: string;
  sourceCommandId: string;
}

/**
 * The committed Root facts of one WorkOrder. `aggregateVersion` stays the
 * database's bigint text so a value the registered result cannot carry losslessly
 * is detected by the reader instead of being silently rounded.
 */
export interface WorkOrderRootRow {
  readonly workOrderId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly workOrderObjectType: string;
  readonly taskId: string;
  readonly taskObjectType: string;
  readonly status: string;
  readonly aggregateVersion: string;
  readonly currentDraftSnapshotId: string;
  readonly currentDraftSnapshotHash: Buffer;
  readonly draftSchemaVersion: string;
  readonly expiresAt: Date | null;
}

/** The committed snapshot facts the exact draft read compares against. */
export interface WorkOrderDraftSnapshotRow {
  readonly snapshotId: string;
  readonly workOrderId: string;
  readonly payloadHash: Buffer;
  readonly canonicalPayload: unknown;
}

/** The bound Task as the §18.4 read-only dependency lock observes it. */
export interface BoundTaskRow {
  readonly taskId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly status: string;
  /** The `schema_version` of the Task's current (creation) definition snapshot. */
  readonly creationDefinitionSchemaVersion: string | undefined;
}

function assertRunnerBoundWorkOrderFacts(
  facts: CommandFacts,
  row: {
    workOrderId: string;
    enterpriseId: string;
    projectId: string;
    targetObjectType?: string;
  },
): void {
  if (!(
    typeof facts === 'object' &&
    (facts as unknown as Record<symbol, unknown>)[COMMAND_FACTS_RUNTIME_BRAND] === true &&
    Object.isFrozen(facts)
  )) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'work order insert must be bound to a runner-bound CommandFacts snapshot',
    );
  }
  if (row.targetObjectType !== undefined && facts.targetType !== row.targetObjectType) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'work order target type must equal the runner-bound command target type',
    );
  }
  if (facts.targetId !== row.workOrderId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'work order id must equal the runner-bound command targetId',
    );
  }
  if (facts.enterpriseId !== row.enterpriseId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'work order enterprise scope must equal the runner-bound command enterpriseId',
    );
  }
  if (facts.projectId === null || facts.projectId !== row.projectId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'work order project scope must equal the runner-bound command projectId',
    );
  }
}

/**
 * The trusted anchor of a WorkOrder creation is the established transaction
 * context, not the Receipt's creator column: the creator and the requester must
 * be the trusted principal, and the Project scope must be allowed by that very
 * context. The database guards repeat the same closure against
 * `context_principal_id()`/`context_principal_kind()`; failing here keeps the
 * failure a stable module error instead of a raw guard violation.
 */
async function assertTrustedCreationContext(
  trx: TaskExecutionTransaction,
  row: { enterpriseId: string; projectId: string; createdByPrincipalId: string },
): Promise<void> {
  const trusted = await readTrustedContext(trx, row.enterpriseId, row.projectId);
  if (row.createdByPrincipalId !== trusted.principal_id) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH,
      'work order creator must equal the trusted transaction principal',
    );
  }
  if (!trusted.allowsEnterprise || trusted.allowsProject !== true) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'work order scope is not allowed by the trusted transaction context',
    );
  }
}

export class WorkOrderDraftRepository {
  /**
   * Inserts the WorkOrder Aggregate Root of a fresh DRAFT. The primary key and
   * the Project Scope uniqueness (both Project Scope, both the same CREATE
   * identity) are the database-adjudicated single-winner boundary: a concurrent
   * creation of the same target inserts nothing and is reported back to the
   * caller instead of raising, so the loser records its stable business
   * rejection in the same transaction. The composite draft pointer is enforced
   * at commit time by the deferrable FK.
   */
  async insertWorkOrderRoot(
    trx: TaskExecutionTransaction,
    facts: CommandFacts,
    row: WorkOrderRootInsert,
  ): Promise<boolean> {
    assertRunnerBoundWorkOrderFacts(facts, {
      workOrderId: row.workOrderId,
      enterpriseId: row.enterpriseId,
      projectId: row.projectId,
      targetObjectType: row.workOrderObjectType,
    });
    await assertTrustedCreationContext(trx, row);
    const inserted = await trx
      .insertInto('task_execution.work_order')
      .values({
        work_order_id: row.workOrderId,
        enterprise_id: row.enterpriseId,
        project_id: row.projectId,
        work_order_object_type: row.workOrderObjectType,
        task_id: row.taskId,
        task_object_type: row.taskObjectType,
        status: 'DRAFT',
        aggregate_version: '1',
        current_draft_snapshot_id: row.currentDraftSnapshotId,
        current_draft_snapshot_hash: row.currentDraftSnapshotHash,
        draft_schema_version: row.draftSchemaVersion,
        expires_at: row.expiresAt ?? null,
        created_by_principal_id: row.createdByPrincipalId,
        requested_by_principal_id: row.requestedByPrincipalId,
      })
      // Every unique constraint of this table is the same fact - this CREATE
      // identity already exists in this Project Scope - so the untargeted form
      // reports the single winner whichever constraint the duplicate hit.
      .onConflict((conflict) => conflict.doNothing())
      .returning('work_order_id')
      .executeTakeFirst();
    return inserted !== undefined;
  }

  /**
   * Inserts the immutable `WorkOrderDraftSnapshot` of a fresh DRAFT. The row is
   * accepted only when it belongs to the runner-bound command target and its
   * creator is the trusted transaction principal; the V3003 mirror and
   * creation-identity guards then re-derive the promoted columns and the
   * content address from `canonicalPayload` and require the in-flight
   * `execution.create_work_order` Receipt this command claimed.
   */
  async insertWorkOrderDraftSnapshot(
    trx: TaskExecutionTransaction,
    facts: CommandFacts,
    row: WorkOrderDraftSnapshotInsert,
  ): Promise<void> {
    assertRunnerBoundWorkOrderFacts(facts, {
      workOrderId: row.workOrderId,
      enterpriseId: row.enterpriseId,
      projectId: row.projectId,
    });
    await assertTrustedCreationContext(trx, row);
    await trx
      .insertInto('task_execution.work_order_draft_snapshot')
      .values({
        snapshot_id: row.snapshotId,
        work_order_id: row.workOrderId,
        draft_schema_version: row.draftSchemaVersion,
        work_order_object_type: row.workOrderObjectType,
        task_object_type: row.taskObjectType,
        enterprise_id: row.enterpriseId,
        project_id: row.projectId,
        expires_at: row.expiresAt ?? null,
        canonical_payload: JSON.stringify(row.canonicalPayload),
        payload_hash: row.payloadHash,
        request_payload_hash: row.requestPayloadHash,
        source_command_id: row.sourceCommandId,
        created_by_principal_id: row.createdByPrincipalId,
      })
      .execute();
  }

  /**
   * Reads one committed WorkOrder Root by identity, if the trusted Scope makes
   * it visible. RLS is the only Scope authority here, so "invisible" and
   * "missing" reach the caller as the same undefined result.
   */
  async readWorkOrderRoot(
    trx: TaskExecutionTransaction,
    workOrderId: string,
  ): Promise<WorkOrderRootRow | undefined> {
    const row = await trx
      .selectFrom('task_execution.work_order')
      .select([
        'work_order_id',
        'enterprise_id',
        'project_id',
        'work_order_object_type',
        'task_id',
        'task_object_type',
        'status',
        'aggregate_version',
        'current_draft_snapshot_id',
        'current_draft_snapshot_hash',
        'draft_schema_version',
        'expires_at',
      ])
      .where('work_order_id', '=', workOrderId)
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : {
          workOrderId: row.work_order_id,
          enterpriseId: row.enterprise_id,
          projectId: row.project_id,
          workOrderObjectType: row.work_order_object_type,
          taskId: row.task_id,
          taskObjectType: row.task_object_type,
          status: row.status,
          aggregateVersion: row.aggregate_version,
          currentDraftSnapshotId: row.current_draft_snapshot_id,
          currentDraftSnapshotHash: row.current_draft_snapshot_hash,
          draftSchemaVersion: row.draft_schema_version,
          expiresAt: row.expires_at,
        };
  }

  /**
   * Reads the snapshot the Root's composite pointer names. The pointer holds
   * `(work_order_id, snapshot_id, payload_hash)`, so the hash is part of the
   * lookup: a snapshot row whose stored bytes changed can never be returned as
   * this Root's draft.
   */
  async readWorkOrderDraftSnapshot(
    trx: TaskExecutionTransaction,
    workOrderId: string,
    snapshotId: string,
    payloadHash: Buffer,
  ): Promise<WorkOrderDraftSnapshotRow | undefined> {
    const row = await trx
      .selectFrom('task_execution.work_order_draft_snapshot')
      .select(['snapshot_id', 'work_order_id', 'payload_hash', 'canonical_payload'])
      .where('work_order_id', '=', workOrderId)
      .where('snapshot_id', '=', snapshotId)
      .where('payload_hash', '=', payloadHash)
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : {
          snapshotId: row.snapshot_id,
          workOrderId: row.work_order_id,
          payloadHash: row.payload_hash,
          canonicalPayload: row.canonical_payload,
        };
  }

  /**
   * §18.4: reads the bound Task and its creation definition spelling while
   * taking the read-only dependency lock (`FOR SHARE` on this module's Task
   * row). The lock is held until the command transaction ends, so the status
   * the handler validates cannot change under it, and a concurrent Task
   * transition that committed first is observed as the new status. The
   * definition snapshot is resolved through the Task's own composite pointer,
   * exactly as the database guard resolves it: a missing or inconsistent
   * pointer leaves the spelling undefined instead of guessing one.
   */
  async readBoundTaskForShare(
    trx: TaskExecutionTransaction,
    taskId: string,
  ): Promise<BoundTaskRow | undefined> {
    const row = await trx
      .selectFrom('task_execution.task as t')
      .leftJoin('task_execution.task_definition_snapshot as s', (join) =>
        join
          .onRef('s.task_id', '=', 't.task_id')
          .onRef('s.snapshot_id', '=', 't.current_definition_snapshot_id')
          .onRef('s.payload_hash', '=', 't.current_definition_hash'),
      )
      .select([
        't.task_id',
        't.enterprise_id',
        't.project_id',
        't.status',
        's.schema_version as creation_definition_schema_version',
      ])
      .where('t.task_id', '=', taskId)
      .forShare('t')
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : {
          taskId: row.task_id,
          enterpriseId: row.enterprise_id,
          projectId: row.project_id,
          status: row.status,
          creationDefinitionSchemaVersion: row.creation_definition_schema_version ?? undefined,
        };
  }
}
