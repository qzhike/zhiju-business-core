// IM-06 WI-01 (issue #151): TaskExecution command transaction runner.
// One owning-module transaction: claim receipt -> execute -> technical
// aggregate/CAS + audit + outbox + reference edge -> finalize -> commit.
// Authorization is supplied as a trusted snapshot; this module never reads
// IdentityPolicy or another owning schema.

import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import {
  digestCanonicalPayload,
  withTaskExecutionTransaction,
  type TaskExecutionDb,
  type TaskExecutionTransaction,
  type TaskExecutionTransactionContext,
} from './task-execution-db.js';
import {
  TaskExecutionRepository,
  type ProcessInstanceInsert,
} from './task-execution-repository.js';
import {
  TaskDraftRepository,
  type TaskDefinitionSnapshotInsert,
  type TaskRootInsert,
} from './task-draft-repository.js';
import {
  TaskReadinessRepository,
  type ExecutionJudgmentInsert,
  type TaskReadyCasInput,
  type TaskReadyCasResult,
} from './task-readiness-repository.js';
import {
  WorkOrderDraftRepository,
  type WorkOrderDraftSnapshotInsert,
  type WorkOrderRootInsert,
} from './work-order-draft-repository.js';
import {
  ContextSnapshotRepository,
  type ContextSnapshotBuildInsert,
  type ContextSnapshotInsert,
} from './context-snapshot-repository.js';
import {
  WorkOrderValidationRepository,
  type WorkOrderContractInsert,
  type WorkOrderFreezeCasInput,
  type WorkOrderFreezeCasResult,
  type WorkOrderValidationJudgmentInsert,
} from './work-order-validation-repository.js';
import {
  FirstRunRepository,
  type FirstRunCreate,
  type FirstRunClaim,
  type FirstRunStart,
  type WorkOrderQueue,
  type WorkOrderReconcile,
} from './first-run-repository.js';

export const IDEMPOTENCY_PAYLOAD_CONFLICT = 'IDEMPOTENCY_PAYLOAD_CONFLICT';
export const CONCURRENCY_CONFLICT = 'CONCURRENCY_CONFLICT';
export const COMMAND_IN_PROGRESS = 'COMMAND_IN_PROGRESS';
export const PAYLOAD_HASH_MISMATCH = 'PAYLOAD_HASH_MISMATCH';
export const COMMAND_CONTEXT_MISMATCH = 'COMMAND_CONTEXT_MISMATCH';
export const COMMAND_CONTEXT_EXPIRED = 'COMMAND_CONTEXT_EXPIRED';
export const COMMAND_CONTEXT_REJECTED = 'COMMAND_CONTEXT_REJECTED';
export const COMMAND_TARGET_MISMATCH = 'COMMAND_TARGET_MISMATCH';

/** Typed failure with a stable, safe code and no raw payload echo. */
export class CommandExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommandExecutionError';
  }
}

function nextAggregateVersion(expectedVersion: string): string {
  try {
    const parsed = BigInt(expectedVersion);
    if (parsed < 1n) {
      throw new Error('aggregate version must be positive');
    }
    return (parsed + 1n).toString();
  } catch {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'expected aggregate version must be a positive bigint',
    );
  }
}

function nextEventAggregateVersion(expectedVersion: string): string {
  try {
    const parsed = BigInt(expectedVersion);
    if (parsed < 0n) {
      throw new Error('aggregate version must be non-negative');
    }
    return (parsed + 1n).toString();
  } catch {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'expected aggregate version must be a non-negative bigint',
    );
  }
}

export interface CommandEnvelope {
  commandId: string;
  commandType: string;
  commandVersion: string;
  idempotencyScope: string;
  idempotencyKey: string;
  requestPayload: CanonicalJsonObject;
  enterpriseId: string;
  projectId?: string | undefined;
  targetType: string;
  targetId: string;
  expectedAggregateVersion?: string | undefined;
  correlationId: string;
  causationId?: string | undefined;
  principalId: string;
  principalKind: TaskExecutionTransactionContext['principalKind'];
  actorSnapshotId: string;
  authorizationDecisionId: string;
  policySnapshotId: string;
}

export interface OutboxEventInput {
  eventId: string;
  eventType: string;
  eventVersion: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: string;
  payload: CanonicalJsonObject;
  /**
   * §20.3: present exactly when the registered event payload is closed to its
   * business members and carries no `enterpriseId`/`projectId` - the event
   * Scope lives only on the Event envelope `scopeRef`. The declared mirror
   * must equal the command envelope scope; the runner then stores the payload
   * with the trusted envelope scope mirrored in, so the V3000 outbox scope
   * guard and the payload hash still cover the scope, without the public
   * payload double-sourcing it.
   */
  scopeMirror?: { readonly enterpriseId: string; readonly projectId?: string | null } | undefined;
  /**
   * §20.3: the validated Event envelope's causation. When present it must
   * equal the command causation or, absent one, the command id (the envelope
   * fallback); the stored row then records this value instead of the bare
   * command-envelope causation.
   */
  causationId?: string | undefined;
  declaredHash?: Buffer;
  occurredAt: Date;
}

export interface ReferenceEdgeInput {
  ownerObjectType: string;
  ownerObjectId: string;
  ownerVersionId?: string | undefined;
  ownerPayloadHash?: Buffer | undefined;
  referencePath: string;
  targetModule: string;
  targetObjectType: string;
  targetObjectId: string;
  targetVersionId?: string | undefined;
  targetPayloadHash?: Buffer | undefined;
  referencePurpose: string;
}

export interface CommandAuditInput {
  outcome: 'ALLOWED' | 'DENIED' | 'COMMITTED' | 'REJECTED' | 'INFO';
  errorCode?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  targetAggregateVersion?: string | undefined;
  safeSummary?: string | undefined;
  requestHash?: Buffer | undefined;
  resultHash?: Buffer | undefined;
}

export interface ProcessStepInput {
  processStepId: string;
  processId: string;
  stepNo: number;
  inputEventId?: string | undefined;
  inputEventType?: string | undefined;
  issuedCommandId?: string | undefined;
  issuedCommandType?: string | undefined;
  outcome: 'STARTED' | 'COMPLETED' | 'FAILED' | 'AWAITING_HUMAN' | 'SKIPPED';
  failureCode?: string | undefined;
  humanIntervention?: string | undefined;
  sourceFactRef?: string | undefined;
  stableIdempotencyKey?: string | undefined;
}

export type CommandBodyResult =
  | {
      kind: 'COMMITTED';
      resultPayload: CanonicalJsonObject;
      /**
       * The owning handler's trusted commit instant, when the command's own
       * public facts must name the exact time this command committed (for
       * example an event whose `readyAt` the design fixes to the Receipt's
       * `completed_at`). The runner writes this value to the Receipt, so the
       * two can never drift; omitted, the runner samples its own clock exactly
       * as before for every other command.
       */
      committedAt?: Date | undefined;
    }
  | {
      kind: 'REJECTED';
      errorCode: string;
      safeSummary: string;
      currentAggregateVersion?: string | undefined;
    };

function freezeEnvelope(envelope: CommandEnvelope): CommandEnvelope {
  return Object.freeze({
    commandId: envelope.commandId,
    commandType: envelope.commandType,
    commandVersion: envelope.commandVersion,
    idempotencyScope: envelope.idempotencyScope,
    idempotencyKey: envelope.idempotencyKey,
    requestPayload: envelope.requestPayload,
    enterpriseId: envelope.enterpriseId,
    projectId: envelope.projectId,
    targetType: envelope.targetType,
    targetId: envelope.targetId,
    expectedAggregateVersion: envelope.expectedAggregateVersion,
    correlationId: envelope.correlationId,
    causationId: envelope.causationId,
    principalId: envelope.principalId,
    principalKind: envelope.principalKind,
    actorSnapshotId: envelope.actorSnapshotId,
    authorizationDecisionId: envelope.authorizationDecisionId,
    policySnapshotId: envelope.policySnapshotId,
  });
}

export interface CommandExecution {
  readonly trx: TaskExecutionTransaction;
  /**
   * Runner-bound process instance insert: the body supplies the row only;
   * the runner closes over the open transaction, the snapshot of the
   * envelope target, and the repository. Callers cannot substitute a
   * different `trx`, `commandFacts`, or repository from outside the
   * command transaction.
   */
  readonly insertProcessInstance: (row: ProcessInstanceInsert) => Promise<void>;
  /**
   * Runner-bound Task DRAFT inserts (IM-06 #204): the body supplies the row
   * data only, and the runner closes over the open transaction, the frozen
   * command target and the owning repository, exactly like
   * `insertProcessInstance`. A caller cannot write a Root or a definition
   * Snapshot for another Task, Scope or target type.
   */
  insertTaskDraftRoot(row: TaskRootInsert): Promise<boolean>;
  insertTaskDraftDefinition(row: TaskDefinitionSnapshotInsert): Promise<void>;
  /**
   * Runner-bound Task Readiness writes (IM-06 #208): the body supplies the row
   * data only, and the runner closes over the open transaction, the frozen
   * command target and the owning repository, so a caller cannot write a
   * judgment for another Scope or convert a Task other than the command target.
   * `false` means the judgment identity was already taken.
   */
  insertExecutionJudgment(row: ExecutionJudgmentInsert): Promise<boolean>;
  casTaskStatusToReady(input: TaskReadyCasInput): Promise<TaskReadyCasResult>;
  /**
   * Runner-bound WorkOrder DRAFT writes (IM-06 #212): the body supplies the row
   * data only, and the runner closes over the open transaction, the frozen
   * command target and the owning repository, exactly like the Task DRAFT
   * inserts. A caller cannot write a WorkOrder Root or a draft Snapshot for
   * another WorkOrder, Project Scope or target spelling. `false` means the
   * WorkOrder CREATE identity already exists.
   */
  insertWorkOrderDraftRoot(row: WorkOrderRootInsert): Promise<boolean>;
  insertWorkOrderDraftSnapshot(row: WorkOrderDraftSnapshotInsert): Promise<void>;
  /**
   * Runner-bound Context Snapshot writes (IM-06 #216): the body supplies the
   * row data only, and the runner closes over the open transaction, the frozen
   * command target and the owning repository, exactly like the WorkOrder DRAFT
   * inserts. A caller cannot write a Snapshot or its INITIAL build metadata for
   * another CREATE identity, Project Scope or target spelling. `false` means the
   * Scope-unique CREATE identity of the Snapshot was already taken.
   */
  insertContextSnapshot(row: ContextSnapshotInsert): Promise<boolean>;
  insertContextSnapshotBuild(row: ContextSnapshotBuildInsert): Promise<void>;
  /**
   * Runner-bound WorkOrder Validation/Freeze writes (IM-06 #219): the body
   * supplies the row data only, and the runner closes over the open
   * transaction, the frozen command target and the owning repository, so a
   * caller cannot write a validation judgment for another CREATE identity,
   * freeze a WorkOrder other than the command target, or bind a Contract under
   * a foreign Project Scope. `false` means the judgment identity was already
   * taken / a frozen binding already exists.
   */
  insertWorkOrderValidationJudgment(row: WorkOrderValidationJudgmentInsert): Promise<boolean>;
  insertWorkOrderContract(row: WorkOrderContractInsert): Promise<boolean>;
  casWorkOrderStatusToReady(input: WorkOrderFreezeCasInput): Promise<WorkOrderFreezeCasResult>;
  queueWorkOrder(input: WorkOrderQueue): Promise<boolean>;
  insertFirstRun(input: FirstRunCreate): Promise<boolean>;
  insertFirstRunClaim(input: FirstRunClaim): Promise<void>;
  startFirstRun(input: FirstRunStart): Promise<boolean>;
  reconcileWorkOrder(input: WorkOrderReconcile): Promise<boolean>;
  /** CAS on the technical process aggregate until business tables exist. */
  casProcessInstance(
    id: string,
    expectedVersion: string,
    patch?: {
      state?: 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'SUSPENDED';
      controlledFinalStep?: 'SUBMIT' | 'RECORD' | 'VALIDATE' | 'ACCEPT' | 'FINALIZE' | 'DONE';
      controlledFinalResultRef?: string;
      controlledFinalBundleRef?: string;
      controlledFinalValidationRefs?: string;
      controlledFinalAcceptanceRef?: string;
      controlledFinalRunVersion?: string;
      blockedReasonCode?: string;
      recoveryStep?: number;
      recoveryCommandId?: string;
    },
  ): Promise<'OK' | 'NOT_FOUND' | 'CONFLICT'>;
  appendOutbox(event: OutboxEventInput): Promise<void>;
  appendReferenceEdge(edge: ReferenceEdgeInput): Promise<void>;
  appendAudit(audit: CommandAuditInput): Promise<void>;
  appendProcessStep(step: ProcessStepInput): Promise<void>;
  failAfterOutbox(): never;
}

/**
 * Closed-shape command target facts the runner binds at command entry and
 * passes internally to the repository via the closure that powers
 * `CommandExecution.insertProcessInstance`. The brand key is a
 * process-local unique `Symbol` (not `Symbol.for`) so no caller can mint a
 * matching shape; the underlying object is also deeply frozen. The symbol
 * is exported solely so the repository can verify identity at the same
 * module instance.
 */
export interface CommandFacts {
  readonly [COMMAND_FACTS_BRAND]: true;
  readonly commandId: string;
  readonly commandType: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly enterpriseId: string;
  readonly projectId: string | null;
}

const COMMAND_FACTS_BRAND: unique symbol = Symbol('@zhiju/task-execution/CommandFacts');

function makeCommandFacts(envelope: CommandEnvelope): CommandFacts {
  return Object.freeze({
    [COMMAND_FACTS_BRAND]: true as const,
    commandId: envelope.commandId,
    commandType: envelope.commandType,
    targetType: envelope.targetType,
    targetId: envelope.targetId,
    enterpriseId: envelope.enterpriseId,
    projectId: envelope.projectId ?? null,
  });
}

export const COMMAND_FACTS_RUNTIME_BRAND = COMMAND_FACTS_BRAND;

export function isRunnerBoundFacts(value: unknown): value is CommandFacts {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[COMMAND_FACTS_BRAND] === true &&
    Object.isFrozen(value)
  );
}

export interface CommandExecution {
  readonly trx: TaskExecutionTransaction;
  /**
   * Runner-bound process instance insert: the body supplies the row only;
   * the runner closes over the open transaction, the snapshot of the
   * envelope target, and the repository. Callers cannot substitute a
   * different `trx`, `commandFacts`, or repository from outside the
   * command transaction.
   */
  readonly insertProcessInstance: (row: ProcessInstanceInsert) => Promise<void>;
  /** CAS on the technical process aggregate until business tables exist. */
  casProcessInstance(
    id: string,
    expectedVersion: string,
    patch?: {
      state?: 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'SUSPENDED';
      controlledFinalStep?: 'SUBMIT' | 'RECORD' | 'VALIDATE' | 'ACCEPT' | 'FINALIZE' | 'DONE';
      controlledFinalResultRef?: string;
      controlledFinalBundleRef?: string;
      controlledFinalValidationRefs?: string;
      controlledFinalAcceptanceRef?: string;
      controlledFinalRunVersion?: string;
      blockedReasonCode?: string;
      recoveryStep?: number;
      recoveryCommandId?: string;
    },
  ): Promise<'OK' | 'NOT_FOUND' | 'CONFLICT'>;
  appendOutbox(event: OutboxEventInput): Promise<void>;
  appendReferenceEdge(edge: ReferenceEdgeInput): Promise<void>;
  appendAudit(audit: CommandAuditInput): Promise<void>;
  appendProcessStep(step: ProcessStepInput): Promise<void>;
  failAfterOutbox(): never;
}

export type CommandResult =
  | { status: 'COMMITTED'; resultPayload: CanonicalJsonObject; resultPayloadHash: Buffer }
  | {
      status: 'REJECTED';
      errorCode: string;
      safeSummary: string;
      currentAggregateVersion: string | null;
    }
  | {
      status: 'DUPLICATE';
      originalOutcome: 'COMMITTED' | 'REJECTED';
      resultPayload: CanonicalJsonObject | null;
      resultPayloadHash: Buffer | null;
      errorCode: string | null;
    };

/** Binds envelope attribution and scope to the trusted transaction context. */
export function assertEnvelopeMatchesContext(
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
): void {
  const projectAllowed =
    envelope.projectId === undefined || context.allowedProjectIds.includes(envelope.projectId);
  if (
    envelope.principalId !== context.principalId ||
    envelope.principalKind !== context.principalKind ||
    envelope.actorSnapshotId !== context.actorSnapshotId ||
    envelope.authorizationDecisionId !== context.authorizationDecisionId ||
    envelope.policySnapshotId !== context.policySnapshotId ||
    envelope.enterpriseId !== context.enterpriseId ||
    envelope.correlationId !== context.correlationId ||
    !projectAllowed
  ) {
    throw new CommandExecutionError(
      COMMAND_CONTEXT_MISMATCH,
      'command envelope does not match the trusted transaction context',
    );
  }
}

/**
 * Executes one command atomically. Receipt, technical changes, audit,
 * outbox and reference edges commit together or roll back together.
 */
export async function executeTaskExecutionCommand(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  body: (execution: CommandExecution) => Promise<CommandBodyResult>,
  currentAuthorization?: () => Promise<void>,
): Promise<CommandResult> {
  assertEnvelopeMatchesContext(context, envelope);
  const requestDigest = digestCanonicalPayload(envelope.requestPayload);

  let outcome: Awaited<ReturnType<typeof runCommandTransaction>>;
  try {
    outcome = await runCommandTransaction(
      db,
      context,
      envelope,
      requestDigest.hash,
      body,
      currentAuthorization,
    );
  } catch (error) {
    mapTransactionError(error);
  }

  if (outcome.kind === 'PAYLOAD_CONFLICT') {
    throw new CommandExecutionError(
      IDEMPOTENCY_PAYLOAD_CONFLICT,
      'the same idempotency key was already used with a different request payload',
    );
  }
  if (outcome.kind === 'IN_PROGRESS') {
    throw new CommandExecutionError(
      COMMAND_IN_PROGRESS,
      'a command with the same idempotency key is still in flight',
    );
  }
  return outcome.result;
}

async function runCommandTransaction(
  db: Kysely<TaskExecutionDb>,
  context: TaskExecutionTransactionContext,
  envelope: CommandEnvelope,
  requestHash: Buffer,
  body: (execution: CommandExecution) => Promise<CommandBodyResult>,
  currentAuthorization?: () => Promise<void>,
) {
  const envelopeSnapshot = freezeEnvelope(envelope);
  return withTaskExecutionTransaction(db, context, async (trx) => {
    await currentAuthorization?.();
    const claimed = await claimReceipt(trx, envelopeSnapshot, requestHash);
    if (!claimed) {
      const existing = await readReceipt(trx, envelopeSnapshot);
      if (!existing) {
        throw new CommandExecutionError(
          COMMAND_IN_PROGRESS,
          'the command claim could not be resolved after a concurrent attempt',
        );
      }
      // A claimed idempotency key is owned by exactly one command identity.
      // The historical Receipt may only be returned to the same
      // `(commandType, commandVersion)` and the same target: the request hash
      // alone cannot distinguish the two `create_task` majors, because the v1
      // `projectRef` is a generic `objectRef`, so a byte-identical payload is
      // possible. A different identity or target is a payload conflict and is
      // audited instead of leaking the other version's Receipt.
      const identityMismatch =
        existing.command_type !== envelopeSnapshot.commandType ||
        existing.command_version !== envelopeSnapshot.commandVersion ||
        existing.target_type !== envelopeSnapshot.targetType ||
        existing.target_id !== envelopeSnapshot.targetId;
      if (!existing.request_payload_hash.equals(requestHash) || identityMismatch) {
        await insertAuditRow(trx, envelopeSnapshot, {
          outcome: 'DENIED',
          errorCode: IDEMPOTENCY_PAYLOAD_CONFLICT,
          targetType: envelopeSnapshot.targetType,
          targetId: envelopeSnapshot.targetId,
          targetAggregateVersion: existing.expected_aggregate_version ?? undefined,
          safeSummary: identityMismatch
            ? 'same idempotency key replayed by another command identity or target'
            : 'same idempotency key replayed with a different request hash',
          requestHash,
        });
        return { kind: 'PAYLOAD_CONFLICT' } as const;
      }
      if (existing.outcome === 'PENDING') {
        return { kind: 'IN_PROGRESS' } as const;
      }
      await currentAuthorization?.();
      return {
        kind: 'RESULT',
        result: {
          status: 'DUPLICATE',
          originalOutcome: existing.outcome,
          resultPayload: (existing.result_payload as CanonicalJsonObject | null) ?? null,
          resultPayloadHash: existing.result_payload_hash ?? null,
          errorCode: rejectionErrorCode(existing),
        } satisfies CommandResult,
      } as const;
    }

    const commandFacts = makeCommandFacts(envelopeSnapshot);
    const bodyResult = await body(createExecution(trx, envelopeSnapshot, commandFacts));
    await currentAuthorization?.();
    if (bodyResult.kind === 'REJECTED') {
      await finalizeReceipt(trx, envelopeSnapshot, {
        outcome: 'REJECTED',
        resultPayload: {
          errorCode: bodyResult.errorCode,
          safeSummary: bodyResult.safeSummary,
          currentAggregateVersion: bodyResult.currentAggregateVersion ?? null,
        },
      });
      await insertAuditRow(trx, envelopeSnapshot, {
        outcome: 'REJECTED',
        errorCode: bodyResult.errorCode,
        targetType: envelopeSnapshot.targetType,
        targetId: envelopeSnapshot.targetId,
        targetAggregateVersion: bodyResult.currentAggregateVersion,
        safeSummary: bodyResult.safeSummary,
        requestHash,
      });
      return {
        kind: 'RESULT',
        result: {
          status: 'REJECTED',
          errorCode: bodyResult.errorCode,
          safeSummary: bodyResult.safeSummary,
          currentAggregateVersion: bodyResult.currentAggregateVersion ?? null,
        } satisfies CommandResult,
      } as const;
    }

    const resultDigest = digestCanonicalPayload(bodyResult.resultPayload);
    await finalizeReceipt(trx, envelopeSnapshot, {
      outcome: 'COMMITTED',
      resultPayload: bodyResult.resultPayload,
      completedAt: bodyResult.committedAt,
    });
    await insertAuditRow(trx, envelopeSnapshot, {
      outcome: 'COMMITTED',
      targetType: envelopeSnapshot.targetType,
      targetId: envelopeSnapshot.targetId,
      requestHash,
      resultHash: resultDigest.hash,
    });
    await currentAuthorization?.();
    return {
      kind: 'RESULT',
      result: {
        status: 'COMMITTED',
        resultPayload: bodyResult.resultPayload,
        resultPayloadHash: resultDigest.hash,
      } satisfies CommandResult,
    } as const;
  });
}

interface ReceiptFacts {
  command_type: string;
  command_version: string;
  target_type: string;
  target_id: string;
  request_payload_hash: Buffer;
  outcome: 'PENDING' | 'COMMITTED' | 'REJECTED';
  result_payload: unknown;
  result_payload_hash: Buffer | null;
  expected_aggregate_version: string | null;
}

async function readReceipt(
  trx: TaskExecutionTransaction,
  envelope: CommandEnvelope,
): Promise<ReceiptFacts | undefined> {
  return (await trx
    .selectFrom('task_execution.command_receipt')
    .selectAll()
    .where('idempotency_scope', '=', envelope.idempotencyScope)
    .where('idempotency_key', '=', envelope.idempotencyKey)
    .executeTakeFirst()) as ReceiptFacts | undefined;
}

async function claimReceipt(
  trx: TaskExecutionTransaction,
  envelope: CommandEnvelope,
  requestHash: Buffer,
): Promise<boolean> {
  const inserted = await trx
    .insertInto('task_execution.command_receipt')
    .values({
      command_id: envelope.commandId,
      command_type: envelope.commandType,
      command_version: envelope.commandVersion,
      idempotency_scope: envelope.idempotencyScope,
      idempotency_key: envelope.idempotencyKey,
      request_payload_hash: requestHash,
      enterprise_id: envelope.enterpriseId,
      project_id: envelope.projectId ?? null,
      target_type: envelope.targetType,
      target_id: envelope.targetId,
      expected_aggregate_version: envelope.expectedAggregateVersion ?? null,
      outcome: 'PENDING',
      correlation_id: envelope.correlationId,
      causation_id: envelope.causationId ?? null,
      created_by_principal_id: envelope.principalId,
      actor_snapshot_id: envelope.actorSnapshotId,
      authorization_decision_id: envelope.authorizationDecisionId,
    })
    .onConflict((conflict) => conflict.doNothing())
    .returning('command_id')
    .executeTakeFirst();
  return inserted !== undefined;
}

async function finalizeReceipt(
  trx: TaskExecutionTransaction,
  envelope: CommandEnvelope,
  final: {
    outcome: 'COMMITTED' | 'REJECTED';
    resultPayload: CanonicalJsonObject;
    /** Completion instant; a body may name it so its own facts can reference it. */
    completedAt?: Date | undefined;
  },
): Promise<void> {
  const resultDigest = digestCanonicalPayload(final.resultPayload);
  await trx
    .updateTable('task_execution.command_receipt')
    .set({
      outcome: final.outcome,
      completed_at: final.completedAt ?? new Date(),
      result_payload: resultDigest.canonicalJson,
      result_payload_hash: resultDigest.hash,
    })
    .where('command_id', '=', envelope.commandId)
    .execute();
}

function createExecution(
  trx: TaskExecutionTransaction,
  envelope: CommandEnvelope,
  commandFacts: CommandFacts,
): CommandExecution {
  const taskExecutionRepo = new TaskExecutionRepository();
  const taskDraftRepo = new TaskDraftRepository();
  const taskReadinessRepo = new TaskReadinessRepository();
  const workOrderDraftRepo = new WorkOrderDraftRepository();
  const contextSnapshotRepo = new ContextSnapshotRepository();
  const workOrderValidationRepo = new WorkOrderValidationRepository();
  const firstRunRepo = new FirstRunRepository();
  return {
    trx,
    async insertProcessInstance(row) {
      await taskExecutionRepo.insertProcessInstance(trx, commandFacts, row);
    },
    async insertTaskDraftRoot(row) {
      return taskDraftRepo.insertTaskRoot(trx, commandFacts, row);
    },
    async insertTaskDraftDefinition(row) {
      await taskDraftRepo.insertTaskDefinitionSnapshot(trx, commandFacts, row);
    },
    async insertExecutionJudgment(row) {
      return taskReadinessRepo.insertExecutionJudgment(trx, commandFacts, row);
    },
    async casTaskStatusToReady(row) {
      return taskReadinessRepo.casTaskStatusToReady(trx, commandFacts, row);
    },
    async insertWorkOrderDraftRoot(row) {
      return workOrderDraftRepo.insertWorkOrderRoot(trx, commandFacts, row);
    },
    async insertWorkOrderDraftSnapshot(row) {
      await workOrderDraftRepo.insertWorkOrderDraftSnapshot(trx, commandFacts, row);
    },
    async insertContextSnapshot(row) {
      return contextSnapshotRepo.insertContextSnapshot(trx, commandFacts, row);
    },
    async insertContextSnapshotBuild(row) {
      await contextSnapshotRepo.insertContextSnapshotBuild(trx, commandFacts, row);
    },
    async insertWorkOrderValidationJudgment(row) {
      return workOrderValidationRepo.insertWorkOrderValidationJudgment(trx, commandFacts, row);
    },
    async insertWorkOrderContract(row) {
      return workOrderValidationRepo.insertWorkOrderContract(trx, commandFacts, row);
    },
    async casWorkOrderStatusToReady(input) {
      return workOrderValidationRepo.casWorkOrderStatusToReady(trx, commandFacts, input);
    },
    async queueWorkOrder(input) {
      return firstRunRepo.queueWorkOrder(trx, commandFacts, input);
    },
    async insertFirstRun(input) {
      return firstRunRepo.insertRun(trx, commandFacts, input);
    },
    async insertFirstRunClaim(input) {
      await firstRunRepo.insertClaim(trx, commandFacts, input);
    },
    async startFirstRun(input) {
      return firstRunRepo.startRun(trx, commandFacts, input);
    },
    async reconcileWorkOrder(input) {
      return firstRunRepo.reconcileWorkOrder(trx, commandFacts, input);
    },
    async casProcessInstance(id, expectedVersion, patch = {}) {
      if (id !== envelope.targetId || expectedVersion !== envelope.expectedAggregateVersion) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'CAS target and expected version must match the command envelope',
        );
      }
      if (envelope.targetType !== 'ProcessInstance') {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'CAS target type must be ProcessInstance for the technical aggregate',
        );
      }
      const requestedProjectId = envelope.projectId ?? null;
      const nextVersion = nextAggregateVersion(expectedVersion);
      let updateQuery = trx
        .updateTable('task_execution.process_instance')
        .set({
          aggregate_version: nextVersion,
          updated_at: new Date(),
          ...(patch.state === undefined ? {} : { state: patch.state }),
          ...(patch.controlledFinalStep === undefined
            ? {}
            : { controlled_final_step: patch.controlledFinalStep }),
          ...(patch.controlledFinalResultRef === undefined
            ? {}
            : { controlled_final_result_ref: patch.controlledFinalResultRef }),
          ...(patch.controlledFinalBundleRef === undefined
            ? {}
            : { controlled_final_bundle_ref: patch.controlledFinalBundleRef }),
          ...(patch.controlledFinalValidationRefs === undefined
            ? {}
            : { controlled_final_validation_refs: patch.controlledFinalValidationRefs }),
          ...(patch.controlledFinalAcceptanceRef === undefined
            ? {}
            : { controlled_final_acceptance_ref: patch.controlledFinalAcceptanceRef }),
          ...(patch.controlledFinalRunVersion === undefined
            ? {}
            : { controlled_final_run_version: patch.controlledFinalRunVersion }),
          ...(patch.recoveryStep === undefined ? {} : { recovery_step: patch.recoveryStep }),
          ...(patch.recoveryCommandId === undefined
            ? {}
            : { last_recovery_command_id: patch.recoveryCommandId }),
          ...(patch.blockedReasonCode === undefined
            ? {}
            : { blocked_reason_code: patch.blockedReasonCode }),
        })
        .where('process_id', '=', id)
        .where('aggregate_version', '=', expectedVersion)
        .where('enterprise_id', '=', envelope.enterpriseId);
      updateQuery =
        requestedProjectId === null
          ? updateQuery.where('project_id', 'is', null)
          : updateQuery.where('project_id', '=', requestedProjectId);
      const updated = await updateQuery.executeTakeFirst();
      if (Number(updated.numUpdatedRows) === 1) {
        return 'OK';
      }
      const visible = await trx
        .selectFrom('task_execution.process_instance')
        .select(['aggregate_version', 'enterprise_id', 'project_id'])
        .where('process_id', '=', id)
        .executeTakeFirst();
      if (!visible) {
        return 'NOT_FOUND';
      }
      if (
        visible.enterprise_id !== envelope.enterpriseId ||
        (visible.project_id ?? null) !== requestedProjectId
      ) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'CAS target row scope does not match the command envelope',
        );
      }
      return 'CONFLICT';
    },
    async appendOutbox(event) {
      const expectedEventVersion =
        envelope.expectedAggregateVersion === undefined
          ? '1'
          : nextEventAggregateVersion(envelope.expectedAggregateVersion);
      const acceptanceRef = event.payload.acceptanceRecordRef;
      const resultRef = event.payload.agentResultRef;
      const resultAcceptanceEvent =
        envelope.commandType === 'execution.accept_agent_result' &&
        event.eventType === 'execution.AgentResultAccepted' &&
        event.aggregateType === 'execution.agent_result' &&
        event.aggregateVersion === '1' &&
        typeof acceptanceRef === 'object' &&
        acceptanceRef !== null &&
        !Array.isArray(acceptanceRef) &&
        (acceptanceRef as CanonicalJsonObject).objectId === envelope.targetId &&
        typeof resultRef === 'object' &&
        resultRef !== null &&
        !Array.isArray(resultRef) &&
        (resultRef as CanonicalJsonObject).objectId === event.aggregateId;
      if (
        !resultAcceptanceEvent &&
        (event.aggregateType !== envelope.targetType ||
          event.aggregateId !== envelope.targetId ||
          event.aggregateVersion !== expectedEventVersion)
      ) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'event aggregate identity and version must match the command target',
        );
      }
      // §20.3: with `scopeMirror` declared, the public payload must stay
      // closed to its business members (a scope member here would double-source
      // the scope) and the declared mirror must equal the trusted envelope
      // scope; the stored payload then mirrors the envelope scope into the
      // closed payload, so the database scope guard and the payload hash keep
      // covering the scope. Without `scopeMirror` the historical posture
      // applies unchanged: the payload itself must carry the scope members.
      let storedPayload: CanonicalJsonObject;
      if (event.scopeMirror !== undefined) {
        if (
          event.scopeMirror.enterpriseId !== envelope.enterpriseId ||
          (event.scopeMirror.projectId ?? null) !== (envelope.projectId ?? null)
        ) {
          throw new CommandExecutionError(
            PAYLOAD_HASH_MISMATCH,
            'event scope mirror must equal the command envelope scope',
          );
        }
        if ('enterpriseId' in event.payload || 'projectId' in event.payload) {
          throw new CommandExecutionError(
            PAYLOAD_HASH_MISMATCH,
            'a scope-mirrored event payload must not carry scope members',
          );
        }
        storedPayload = {
          ...event.payload,
          enterpriseId: envelope.enterpriseId,
          ...(envelope.projectId === undefined ? {} : { projectId: envelope.projectId }),
        };
      } else {
        if (
          event.payload.enterpriseId !== envelope.enterpriseId ||
          (event.payload.projectId ?? null) !== (envelope.projectId ?? null)
        ) {
          throw new CommandExecutionError(
            PAYLOAD_HASH_MISMATCH,
            'event payload scope mirror does not match the command scope',
          );
        }
        storedPayload = event.payload;
      }
      // §20.3: the stored event causation is the command causation with the
      // command id as its fallback; a declared causation naming anything else
      // can never be the validated Event envelope's causation.
      const expectedCausationId = envelope.causationId ?? envelope.commandId;
      if (event.causationId !== undefined && event.causationId !== expectedCausationId) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'event causation must equal the command causation or its command-id fallback',
        );
      }
      const digest = digestCanonicalPayload(storedPayload);
      if (event.declaredHash && !event.declaredHash.equals(digest.hash)) {
        throw new CommandExecutionError(
          PAYLOAD_HASH_MISMATCH,
          'declared event hash does not match the canonical payload',
        );
      }
      await trx
        .insertInto('task_execution.outbox_event')
        .values({
          event_id: event.eventId,
          event_type: event.eventType,
          event_version: event.eventVersion,
          aggregate_type: event.aggregateType,
          aggregate_id: event.aggregateId,
          aggregate_version: event.aggregateVersion,
          enterprise_id: envelope.enterpriseId,
          project_id: envelope.projectId ?? null,
          correlation_id: envelope.correlationId,
          causation_id: event.causationId ?? envelope.causationId ?? null,
          payload: digest.canonicalJson,
          payload_hash: digest.hash,
          canonicalization_version: digest.canonicalizationVersion,
          occurred_at: event.occurredAt,
          created_by_principal_id: envelope.principalId,
          source_command_id: envelope.commandId,
        })
        .execute();
    },
    async appendReferenceEdge(edge) {
      if (
        edge.ownerObjectType !== envelope.targetType ||
        edge.ownerObjectId !== envelope.targetId
      ) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'reference edge owner must match the command target',
        );
      }
      if (edge.ownerPayloadHash !== undefined && edge.ownerPayloadHash.length !== 32) {
        throw new CommandExecutionError(
          PAYLOAD_HASH_MISMATCH,
          'owner payload hash must be 32 bytes',
        );
      }
      if (edge.targetPayloadHash !== undefined && edge.targetPayloadHash.length !== 32) {
        throw new CommandExecutionError(
          PAYLOAD_HASH_MISMATCH,
          'target payload hash must be 32 bytes',
        );
      }
      await trx
        .insertInto('task_execution.reference_edge')
        .values({
          owner_object_type: edge.ownerObjectType,
          owner_object_id: edge.ownerObjectId,
          owner_version_id: edge.ownerVersionId ?? null,
          owner_payload_hash: edge.ownerPayloadHash ?? null,
          reference_path: edge.referencePath,
          target_module: edge.targetModule,
          target_object_type: edge.targetObjectType,
          target_object_id: edge.targetObjectId,
          target_version_id: edge.targetVersionId ?? null,
          target_payload_hash: edge.targetPayloadHash ?? null,
          reference_purpose: edge.referencePurpose,
          enterprise_id: envelope.enterpriseId,
          project_id: envelope.projectId ?? null,
          source_command_id: envelope.commandId,
        })
        .execute();
    },
    async appendAudit(audit) {
      await insertAuditRow(trx, envelope, audit);
    },
    async appendProcessStep(step) {
      if (step.processId !== envelope.targetId) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'process step parent must match the command target',
        );
      }
      await trx
        .insertInto('task_execution.process_step')
        .values({
          process_step_id: step.processStepId,
          process_id: step.processId,
          step_no: step.stepNo,
          enterprise_id: envelope.enterpriseId,
          project_id: envelope.projectId ?? null,
          input_event_id: step.inputEventId ?? null,
          input_event_type: step.inputEventType ?? null,
          issued_command_id: step.issuedCommandId ?? null,
          issued_command_type: step.issuedCommandType ?? null,
          outcome: step.outcome,
          failure_code: step.failureCode ?? null,
          human_intervention: step.humanIntervention ?? null,
          source_fact_ref: step.sourceFactRef ?? null,
          stable_idempotency_key: step.stableIdempotencyKey ?? null,
          created_by_principal_id: envelope.principalId,
        })
        .execute();
    },
    failAfterOutbox(): never {
      throw new CommandExecutionError('INJECTED_FAULT', 'controlled fault after outbox write');
    },
  };
}

async function insertAuditRow(
  trx: TaskExecutionTransaction,
  envelope: CommandEnvelope,
  audit: CommandAuditInput,
): Promise<void> {
  await trx
    .insertInto('task_execution.audit_record')
    .values({
      audit_id: newUuidV7(),
      enterprise_id: envelope.enterpriseId,
      project_id: envelope.projectId ?? null,
      principal_id: envelope.principalId,
      actor_snapshot_id: envelope.actorSnapshotId,
      authorization_decision_id: envelope.authorizationDecisionId,
      command_id: envelope.commandId,
      command_type: envelope.commandType,
      outcome: audit.outcome,
      error_code: audit.errorCode ?? null,
      request_payload_hash: audit.requestHash ?? null,
      result_payload_hash: audit.resultHash ?? null,
      target_type: audit.targetType ?? null,
      target_id: audit.targetId ?? null,
      target_aggregate_version: audit.targetAggregateVersion ?? null,
      correlation_id: envelope.correlationId,
      causation_id: envelope.causationId ?? null,
      safe_summary: audit.safeSummary ?? null,
      retention_class: 'REGULATED_AUDIT',
    })
    .execute();
}

function rejectionErrorCode(receipt: ReceiptFacts): string | null {
  const payload = receipt.result_payload as { errorCode?: unknown } | null;
  return typeof payload?.errorCode === 'string' ? payload.errorCode : null;
}

function mapTransactionError(error: unknown): never {
  if (error instanceof CommandExecutionError) {
    throw error;
  }
  const message = error instanceof Error ? error.message : '';
  if (/authorization decision is expired/i.test(message)) {
    throw new CommandExecutionError(COMMAND_CONTEXT_EXPIRED, 'authorization decision is expired');
  }
  if (
    /invalid context kind|incomplete transaction context|missing authorization decision|hash must be 32 bytes|event consumer context|null project scope|request context must not carry/i.test(
      message,
    )
  ) {
    throw new CommandExecutionError(COMMAND_CONTEXT_REJECTED, 'transaction context was rejected');
  }
  throw error;
}
