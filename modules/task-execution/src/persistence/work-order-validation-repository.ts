// IM-06 (#219): repository for the WorkOrder Validation judgment branch, the
// frozen WorkOrder Contract fact and the `DRAFT` -> `READY` WorkOrder Root CAS
// (Spec 003 §21, PostgreSQL §36, V3005). The judgment row, the Contract row and
// the transition commit inside the command transaction the runner already
// opened; this file exposes only the reads the producer/consumer decide on and
// the three writes that must stay bound to the runner-bound command target.
//
// The promoted columns of both facts are re-derived inside the database from
// the stored canonical payload by the V3005 mirror guards, and the
// creation-identity guards additionally require each row to be written by the
// in-flight command that claimed it (`execution.validate_work_order_draft@1.0`
// on the validation target, `execution.freeze_work_order@1.0` on the WorkOrder
// Root), so a row that disagrees with its own payload or with its own receipt
// fails closed.

import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { TaskExecutionTransaction } from './task-execution-db.js';
import { isRunnerBoundFacts, type CommandFacts } from './command-runner.js';
import { readTrustedContext } from './task-execution-repository.js';
import {
  TaskExecutionPersistenceError,
  TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH,
  TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
} from './write-guards.js';

/** The judgment kind this slice writes (Spec 003 §21.2). */
export const WORK_ORDER_VALIDATION_JUDGMENT_KIND = 'WORK_ORDER_VALIDATION';

/** The registered target type of the validation producer command (§21.1). */
export const WORK_ORDER_VALIDATION_TARGET_TYPE = 'zhiju.execution.work_order_validation';

/** The one WorkOrder spelling the first Freeze slice accepts (§21.3). */
export const CANONICAL_WORK_ORDER_OBJECT_TYPE = 'zhiju.execution.work_order';

/**
 * A `WORK_ORDER_VALIDATION` judgment row, exactly as V3005 stores it: the four
 * Task-kind mirrors stay NULL (the branch CHECK closes that), and the seven
 * Core §4.14 booleans are promoted individually.
 */
export interface WorkOrderValidationJudgmentInsert {
  judgmentId: string;
  enterpriseId: string;
  projectId: string;
  workOrderId: string;
  draftSnapshotId: string;
  draftSnapshotHash: Buffer;
  candidateContractHash: Buffer;
  specificationHash: Buffer;
  contextSnapshotId: string;
  contextSnapshotHash: Buffer;
  policyVersionRef: CanonicalJsonObject;
  policyContentHash: Buffer;
  policyEffectiveFrom: Date;
  policySupersededAt: Date | null;
  evaluatorRef: CanonicalJsonObject;
  inputHash: Buffer;
  evaluatedAt: Date;
  validUntil: Date;
  validationValid: boolean;
  validationReferencesValid: boolean;
  validationSpecificationHashValid: boolean;
  validationCapabilityValid: boolean;
  validationExecutable: boolean;
  validationBudgetValid: boolean;
  validationContextCoverageValid: boolean;
  canonicalPayload: CanonicalJsonObject;
  payloadHash: Buffer;
  requestPayloadHash: Buffer;
  sourceCommandId: string;
  createdByPrincipalId: string;
}

/** The immutable frozen Contract row of one WorkOrder, exactly as V3005 stores it. */
export interface WorkOrderContractInsert {
  contractId: string;
  workOrderId: string;
  enterpriseId: string;
  projectId: string;
  workOrderObjectType: string;
  taskId: string;
  taskObjectType: string;
  draftSnapshotId: string;
  draftSnapshotHash: Buffer;
  contextSnapshotId: string;
  contextSnapshotHash: Buffer;
  validationJudgmentId: string;
  validationJudgmentHash: Buffer;
  canonicalPayload: CanonicalJsonObject;
  payloadHash: Buffer;
  specificationHash: Buffer;
  requestPayloadHash: Buffer;
  sourceCommandId: string;
  createdByPrincipalId: string;
}

/** The committed Contract facts the authoritative `get_work_order_contract` read returns. */
export interface WorkOrderContractRow {
  readonly contractId: string;
  readonly workOrderId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly workOrderObjectType: string;
  readonly taskId: string;
  readonly taskObjectType: string;
  readonly draftSnapshotId: string;
  readonly draftSnapshotHash: Buffer;
  readonly contextSnapshotId: string;
  readonly contextSnapshotHash: Buffer;
  readonly validationJudgmentId: string;
  readonly validationJudgmentHash: Buffer;
  readonly payloadHash: Buffer;
  readonly specificationHash: Buffer;
  readonly canonicalPayload: unknown;
}

export interface WorkOrderFreezeCasInput {
  readonly workOrderId: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly expectedAggregateVersion: string;
  readonly currentDraftSnapshotId: string;
  readonly currentDraftSnapshotHash: Buffer;
  readonly frozenContractId: string;
  readonly frozenContractHash: Buffer;
  /** The trusted transaction principal the transition is attributed to. */
  readonly updatedByPrincipalId: string;
}

/** The visible Root state a refused CAS reports back for exact error mapping. */
export interface WorkOrderFreezeCasCurrent {
  readonly status: string;
  readonly aggregateVersion: string;
  readonly currentDraftSnapshotId: string;
  readonly currentDraftSnapshotHash: Buffer;
  readonly frozenContractId: string | null;
  readonly frozenContractHash: Buffer | null;
  readonly expiresAt: Date | null;
}

/**
 * The closed CAS outcome. On 0 updated rows the current visible Root is
 * returned so the owning Handler maps the refusal to the exact stable code
 * (`NOT_FOUND` / `AGGREGATE_STATE_NOT_ALLOWED` / `CONCURRENCY_CONFLICT` /
 * `EXECUTION_JUDGMENT_STALE`) instead of a generic conflict.
 */
export type WorkOrderFreezeCasResult =
  | { readonly updated: true; readonly aggregateVersion: string }
  | { readonly updated: false; readonly current: WorkOrderFreezeCasCurrent | undefined };

function assertRunnerBoundValidationFacts(
  facts: CommandFacts,
  row: { judgmentId: string; enterpriseId: string; projectId: string },
): void {
  if (!isRunnerBoundFacts(facts)) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'validation judgment insert must be bound to a runner-bound CommandFacts snapshot',
    );
  }
  if (facts.targetType !== WORK_ORDER_VALIDATION_TARGET_TYPE) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'validation judgment target type must be the registered validation target',
    );
  }
  if (facts.targetId !== row.judgmentId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'validation judgment id must equal the runner-bound command targetId',
    );
  }
  if (facts.enterpriseId !== row.enterpriseId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'validation judgment enterprise scope must equal the runner-bound command enterpriseId',
    );
  }
  if (facts.projectId === null || facts.projectId !== row.projectId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'validation judgment project scope must equal the runner-bound command projectId',
    );
  }
}

function assertRunnerBoundFreezeFacts(
  facts: CommandFacts,
  row: { workOrderId: string; enterpriseId: string; projectId: string },
): void {
  if (!isRunnerBoundFacts(facts)) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'freeze write must be bound to a runner-bound CommandFacts snapshot',
    );
  }
  if (facts.targetType !== CANONICAL_WORK_ORDER_OBJECT_TYPE) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'freeze target type must be the canonical WorkOrder spelling',
    );
  }
  if (facts.targetId !== row.workOrderId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'freeze work order id must equal the runner-bound command targetId',
    );
  }
  if (facts.enterpriseId !== row.enterpriseId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'freeze enterprise scope must equal the runner-bound command enterpriseId',
    );
  }
  if (facts.projectId === null || facts.projectId !== row.projectId) {
    throw new TaskExecutionPersistenceError(
      TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
      'freeze project scope must equal the runner-bound command projectId',
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

export class WorkOrderValidationRepository {
  /**
   * Inserts one immutable `WORK_ORDER_VALIDATION` judgment. The row is accepted
   * only when it belongs to the runner-bound validation command target and its
   * creator is the trusted transaction principal; the database guards then
   * re-derive the promoted mirrors and the content address from
   * `canonicalPayload` and require the in-flight
   * `execution.validate_work_order_draft` Receipt that claimed this judgment id.
   *
   * A duplicate judgment identity is reported back instead of raising, so the
   * loser records its stable business rejection in the same transaction.
   */
  async insertWorkOrderValidationJudgment(
    trx: TaskExecutionTransaction,
    facts: CommandFacts,
    row: WorkOrderValidationJudgmentInsert,
  ): Promise<boolean> {
    assertRunnerBoundValidationFacts(facts, row);
    await assertTrustedWriteContext(trx, {
      enterpriseId: row.enterpriseId,
      projectId: row.projectId,
      principalId: row.createdByPrincipalId,
    });
    const inserted = await trx
      .insertInto('task_execution.execution_judgment')
      .values({
        judgment_id: row.judgmentId,
        judgment_kind: WORK_ORDER_VALIDATION_JUDGMENT_KIND,
        enterprise_id: row.enterpriseId,
        project_id: row.projectId,
        task_id: null,
        task_definition_snapshot_id: null,
        task_definition_hash: null,
        policy_version_ref: JSON.stringify(row.policyVersionRef),
        policy_content_hash: row.policyContentHash,
        policy_effective_from: row.policyEffectiveFrom,
        policy_superseded_at: row.policySupersededAt,
        evaluator_ref: JSON.stringify(row.evaluatorRef),
        input_hash: row.inputHash,
        evaluated_at: row.evaluatedAt,
        valid_until: row.validUntil,
        ready: null,
        work_order_id: row.workOrderId,
        draft_snapshot_id: row.draftSnapshotId,
        draft_snapshot_hash: row.draftSnapshotHash,
        candidate_contract_hash: row.candidateContractHash,
        specification_hash: row.specificationHash,
        context_snapshot_id: row.contextSnapshotId,
        context_snapshot_hash: row.contextSnapshotHash,
        validation_valid: row.validationValid,
        validation_references_valid: row.validationReferencesValid,
        validation_specification_hash_valid: row.validationSpecificationHashValid,
        validation_capability_valid: row.validationCapabilityValid,
        validation_executable: row.validationExecutable,
        validation_budget_valid: row.validationBudgetValid,
        validation_context_coverage_valid: row.validationContextCoverageValid,
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
   * Inserts the one immutable frozen Contract of a WorkOrder. The row is
   * accepted only when it belongs to the runner-bound Freeze command target and
   * its creator is the trusted transaction principal; the V3005 guards then
   * re-derive the mirrors and both content addresses and require the in-flight
   * `execution.freeze_work_order` Receipt of this very WorkOrder. A duplicate
   * Contract identity or a second frozen binding for the same WorkOrder inserts
   * nothing and is reported back, so the loser maps its stable business
   * rejection instead of leaking `23505`.
   */
  async insertWorkOrderContract(
    trx: TaskExecutionTransaction,
    facts: CommandFacts,
    row: WorkOrderContractInsert,
  ): Promise<boolean> {
    assertRunnerBoundFreezeFacts(facts, row);
    await assertTrustedWriteContext(trx, {
      enterpriseId: row.enterpriseId,
      projectId: row.projectId,
      principalId: row.createdByPrincipalId,
    });
    const inserted = await trx
      .insertInto('task_execution.work_order_contract')
      .values({
        contract_id: row.contractId,
        work_order_id: row.workOrderId,
        enterprise_id: row.enterpriseId,
        project_id: row.projectId,
        work_order_object_type: row.workOrderObjectType,
        task_id: row.taskId,
        task_object_type: row.taskObjectType,
        draft_snapshot_id: row.draftSnapshotId,
        draft_snapshot_hash: row.draftSnapshotHash,
        context_snapshot_id: row.contextSnapshotId,
        context_snapshot_hash: row.contextSnapshotHash,
        validation_judgment_id: row.validationJudgmentId,
        validation_judgment_hash: row.validationJudgmentHash,
        canonical_payload: JSON.stringify(row.canonicalPayload),
        payload_hash: row.payloadHash,
        specification_hash: row.specificationHash,
        request_payload_hash: row.requestPayloadHash,
        source_command_id: row.sourceCommandId,
        created_by_principal_id: row.createdByPrincipalId,
      })
      .onConflict((conflict) => conflict.doNothing())
      .returning('contract_id')
      .executeTakeFirst();
    return inserted !== undefined;
  }

  /**
   * Reads one frozen Contract through the Root's composite frozen pointer -
   * `(work_order_id, contract_id, payload_hash)` - so the hash is part of the
   * lookup: a stored payload whose bytes changed can never be returned as the
   * Contract the Root points at. RLS is the only Scope authority here, so
   * "invisible" and "missing" reach the caller as the same undefined result.
   */
  async readWorkOrderContract(
    trx: TaskExecutionTransaction,
    pointer: { workOrderId: string; contractId: string; payloadHash: Buffer },
  ): Promise<WorkOrderContractRow | undefined> {
    const row = await trx
      .selectFrom('task_execution.work_order_contract')
      .select([
        'contract_id',
        'work_order_id',
        'enterprise_id',
        'project_id',
        'work_order_object_type',
        'task_id',
        'task_object_type',
        'draft_snapshot_id',
        'draft_snapshot_hash',
        'context_snapshot_id',
        'context_snapshot_hash',
        'validation_judgment_id',
        'validation_judgment_hash',
        'payload_hash',
        'specification_hash',
        'canonical_payload',
      ])
      .where('work_order_id', '=', pointer.workOrderId)
      .where('contract_id', '=', pointer.contractId)
      .where('payload_hash', '=', pointer.payloadHash)
      .executeTakeFirst();
    return row === undefined
      ? undefined
      : {
          contractId: row.contract_id,
          workOrderId: row.work_order_id,
          enterpriseId: row.enterprise_id,
          projectId: row.project_id,
          workOrderObjectType: row.work_order_object_type,
          taskId: row.task_id,
          taskObjectType: row.task_object_type,
          draftSnapshotId: row.draft_snapshot_id,
          draftSnapshotHash: row.draft_snapshot_hash,
          contextSnapshotId: row.context_snapshot_id,
          contextSnapshotHash: row.context_snapshot_hash,
          validationJudgmentId: row.validation_judgment_id,
          validationJudgmentHash: row.validation_judgment_hash,
          payloadHash: row.payload_hash,
          specificationHash: row.specification_hash,
          canonicalPayload: row.canonical_payload,
        };
  }

  /**
   * The `DRAFT`-only Freeze CAS of Spec 003 §21.3 / PostgreSQL §36 item 3. The
   * `WHERE` clause carries the whole committed identity - WorkOrder,
   * Enterprise, Project, DRAFT status, expected aggregate version and the
   * current draft pointer - so a WorkOrder that moved since the judgment was
   * built can never be frozen by it, and two concurrent Freezes of the same
   * expected version produce exactly one winner.
   */
  async casWorkOrderStatusToReady(
    trx: TaskExecutionTransaction,
    facts: CommandFacts,
    input: WorkOrderFreezeCasInput,
  ): Promise<WorkOrderFreezeCasResult> {
    assertRunnerBoundFreezeFacts(facts, input);
    await assertTrustedWriteContext(trx, {
      enterpriseId: input.enterpriseId,
      projectId: input.projectId,
      principalId: input.updatedByPrincipalId,
    });
    const nextVersion = nextAggregateVersion(input.expectedAggregateVersion);
    const updated = await trx
      .updateTable('task_execution.work_order')
      .set({
        status: 'READY',
        aggregate_version: nextVersion,
        frozen_contract_id: input.frozenContractId,
        frozen_contract_hash: input.frozenContractHash,
      })
      .where('work_order_id', '=', input.workOrderId)
      .where('enterprise_id', '=', input.enterpriseId)
      .where('project_id', '=', input.projectId)
      .where('status', '=', 'DRAFT')
      .where('aggregate_version', '=', input.expectedAggregateVersion)
      .where('current_draft_snapshot_id', '=', input.currentDraftSnapshotId)
      .where('current_draft_snapshot_hash', '=', input.currentDraftSnapshotHash)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 1) {
      return { updated: true, aggregateVersion: nextVersion };
    }
    const current = await trx
      .selectFrom('task_execution.work_order')
      .select([
        'status',
        'aggregate_version',
        'current_draft_snapshot_id',
        'current_draft_snapshot_hash',
        'frozen_contract_id',
        'frozen_contract_hash',
        'expires_at',
      ])
      .where('work_order_id', '=', input.workOrderId)
      .executeTakeFirst();
    return {
      updated: false,
      current:
        current === undefined
          ? undefined
          : {
              status: current.status,
              aggregateVersion: current.aggregate_version,
              currentDraftSnapshotId: current.current_draft_snapshot_id,
              currentDraftSnapshotHash: current.current_draft_snapshot_hash,
              frozenContractId: current.frozen_contract_id,
              frozenContractHash: current.frozen_contract_hash,
              expiresAt: current.expires_at,
            },
    };
  }
}
