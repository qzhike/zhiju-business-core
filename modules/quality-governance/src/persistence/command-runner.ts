// IM-05 WI-01 (issue #121): QualityGovernance technical command transaction.
// Receipt, callback, Inbox/Process, Audit, Outbox, and Reference Edge writes
// share one PostgreSQL transaction and one trusted RLS context.

import type { Kysely } from 'kysely';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  digestCanonicalPayload,
  withQualityGovernanceTransaction,
  type QualityGovernanceDb,
  type QualityTransaction,
  type QualityTransactionContext,
} from './quality-db.js';

export const IDEMPOTENCY_PAYLOAD_CONFLICT = 'IDEMPOTENCY_PAYLOAD_CONFLICT';
export const INBOX_PAYLOAD_CONFLICT = 'INBOX_PAYLOAD_CONFLICT';
export const CONCURRENCY_CONFLICT = 'CONCURRENCY_CONFLICT';
export const COMMAND_IN_PROGRESS = 'COMMAND_IN_PROGRESS';
export const COMMAND_CONTEXT_MISMATCH = 'COMMAND_CONTEXT_MISMATCH';
export const COMMAND_CONTEXT_EXPIRED = 'COMMAND_CONTEXT_EXPIRED';
export const COMMAND_CONTEXT_REJECTED = 'COMMAND_CONTEXT_REJECTED';
export const COMMAND_TARGET_MISMATCH = 'COMMAND_TARGET_MISMATCH';
export const PAYLOAD_HASH_MISMATCH = 'PAYLOAD_HASH_MISMATCH';

export class CommandExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CommandExecutionError';
  }
}

export interface CommandEnvelope {
  readonly commandId: string;
  readonly commandType: string;
  readonly commandVersion: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly requestPayload: CanonicalJsonObject;
  readonly enterpriseId: string;
  readonly projectId?: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly expectedAggregateVersion?: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly principalId: string;
  readonly principalKind: QualityTransactionContext['principalKind'];
  readonly actorSnapshotId: string;
  readonly authorizationDecisionId: string;
  readonly policySnapshotId: string;
}

export interface InboxMessageInput {
  readonly consumerName: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: string;
  readonly payloadHash: Buffer;
  readonly sourceModule: string;
}

export interface ProcessStepInput {
  readonly processStepId: string;
  readonly processId: string;
  readonly stepNo: number;
  readonly inputEventId?: string;
  readonly inputEventType?: string;
  readonly outcome: 'STARTED' | 'COMPLETED' | 'FAILED' | 'AWAITING_HUMAN' | 'SKIPPED';
  readonly failureCode?: string;
}

export interface OutboxEventInput {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: string;
  readonly payload: CanonicalJsonObject;
  readonly declaredHash?: Buffer;
  readonly occurredAt: Date;
}

export interface ReferenceEdgeInput {
  readonly ownerObjectType: string;
  readonly ownerObjectId: string;
  readonly ownerVersionId?: string;
  readonly ownerPayloadHash?: Buffer;
  readonly referencePath: string;
  readonly targetModule: string;
  readonly targetObjectType: string;
  readonly targetObjectId: string;
  readonly targetVersionId?: string;
  readonly targetPayloadHash?: Buffer;
  readonly referencePurpose: string;
}

export interface CommandAuditInput {
  readonly outcome: 'ALLOWED' | 'DENIED' | 'COMMITTED' | 'REJECTED' | 'INFO';
  readonly errorCode?: string;
  readonly targetAggregateVersion?: string;
  readonly safeSummary?: string;
  readonly requestHash?: Buffer;
  readonly resultHash?: Buffer;
}

export type CommandBodyResult =
  | { readonly kind: 'COMMITTED'; readonly resultPayload: CanonicalJsonObject }
  | {
      readonly kind: 'REJECTED';
      readonly errorCode: string;
      readonly safeSummary: string;
      readonly currentAggregateVersion?: string;
    };

export interface CommandExecution {
  readonly trx: QualityTransaction;
  casProcessInstance(
    id: string,
    expectedVersion: string,
    patch?: { readonly state?: 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'SUSPENDED' },
  ): Promise<'OK' | 'NOT_FOUND' | 'CONFLICT'>;
  claimInbox(input: InboxMessageInput): Promise<'CLAIMED' | 'REPLAY'>;
  completeInbox(consumerName: string, eventId: string): Promise<void>;
  appendProcessStep(input: ProcessStepInput): Promise<void>;
  appendOutbox(input: OutboxEventInput): Promise<void>;
  appendReferenceEdge(input: ReferenceEdgeInput): Promise<void>;
  appendAudit(input: CommandAuditInput): Promise<void>;
  failAfterTechnicalWrites(): never;
}

export type CommandResult =
  | {
      readonly status: 'COMMITTED';
      readonly resultPayload: CanonicalJsonObject;
      readonly resultPayloadHash: Buffer;
    }
  | {
      readonly status: 'REJECTED';
      readonly errorCode: string;
      readonly safeSummary: string;
      readonly currentAggregateVersion: string | null;
    }
  | {
      readonly status: 'DUPLICATE';
      readonly originalOutcome: 'COMMITTED' | 'REJECTED';
      readonly resultPayload: CanonicalJsonObject | null;
      readonly resultPayloadHash: Buffer | null;
      readonly errorCode: string | null;
    };

function nextVersion(value: string, allowZero: boolean): string {
  try {
    const parsed = BigInt(value);
    if (parsed < (allowZero ? 0n : 1n)) throw new Error('out of range');
    return (parsed + 1n).toString();
  } catch {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      `expected aggregate version must be a ${allowZero ? 'non-negative' : 'positive'} bigint`,
    );
  }
}

export function assertEnvelopeMatchesContext(
  context: QualityTransactionContext,
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

export async function executeQualityGovernanceCommand(
  db: Kysely<QualityGovernanceDb>,
  context: QualityTransactionContext,
  envelope: CommandEnvelope,
  body: (execution: CommandExecution) => Promise<CommandBodyResult>,
): Promise<CommandResult> {
  assertEnvelopeMatchesContext(context, envelope);
  const requestHash = digestCanonicalPayload(envelope.requestPayload).hash;
  try {
    return await withQualityGovernanceTransaction(db, context, async (trx) => {
      const claimed = await claimReceipt(trx, envelope, requestHash);
      if (!claimed) return replayReceipt(trx, envelope, requestHash);

      const bodyResult = await body(createExecution(trx, context, envelope));
      if (bodyResult.kind === 'REJECTED') {
        const resultPayload = {
          errorCode: bodyResult.errorCode,
          safeSummary: bodyResult.safeSummary,
          currentAggregateVersion: bodyResult.currentAggregateVersion ?? null,
        };
        await finalizeReceipt(trx, envelope.commandId, 'REJECTED', resultPayload);
        await insertAudit(trx, envelope, {
          outcome: 'REJECTED',
          errorCode: bodyResult.errorCode,
          ...(bodyResult.currentAggregateVersion === undefined
            ? {}
            : { targetAggregateVersion: bodyResult.currentAggregateVersion }),
          safeSummary: bodyResult.safeSummary,
          requestHash,
        });
        return {
          status: 'REJECTED',
          errorCode: bodyResult.errorCode,
          safeSummary: bodyResult.safeSummary,
          currentAggregateVersion: bodyResult.currentAggregateVersion ?? null,
        };
      }

      const resultDigest = digestCanonicalPayload(bodyResult.resultPayload);
      await finalizeReceipt(trx, envelope.commandId, 'COMMITTED', bodyResult.resultPayload);
      await insertAudit(trx, envelope, {
        outcome: 'COMMITTED',
        requestHash,
        resultHash: resultDigest.hash,
      });
      return {
        status: 'COMMITTED',
        resultPayload: bodyResult.resultPayload,
        resultPayloadHash: resultDigest.hash,
      };
    });
  } catch (error) {
    mapTransactionError(error);
  }
}

async function claimReceipt(
  trx: QualityTransaction,
  envelope: CommandEnvelope,
  requestHash: Buffer,
): Promise<boolean> {
  const inserted = await trx
    .insertInto('quality_governance.command_receipt')
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
    .onConflict((conflict) =>
      conflict.columns(['idempotency_scope', 'idempotency_key']).doNothing(),
    )
    .returning('command_id')
    .executeTakeFirst();
  return inserted !== undefined;
}

async function replayReceipt(
  trx: QualityTransaction,
  envelope: CommandEnvelope,
  requestHash: Buffer,
): Promise<CommandResult> {
  const existing = await trx
    .selectFrom('quality_governance.command_receipt')
    .select([
      'request_payload_hash',
      'outcome',
      'result_payload',
      'result_payload_hash',
      'expected_aggregate_version',
    ])
    .where('idempotency_scope', '=', envelope.idempotencyScope)
    .where('idempotency_key', '=', envelope.idempotencyKey)
    .executeTakeFirst();
  if (!existing || existing.outcome === 'PENDING') {
    throw new CommandExecutionError(COMMAND_IN_PROGRESS, 'idempotent command is still in flight');
  }
  if (!existing.request_payload_hash.equals(requestHash)) {
    await insertAudit(trx, envelope, {
      outcome: 'DENIED',
      errorCode: IDEMPOTENCY_PAYLOAD_CONFLICT,
      ...(existing.expected_aggregate_version === null
        ? {}
        : { targetAggregateVersion: existing.expected_aggregate_version }),
      safeSummary: 'idempotency key reused with a different request hash',
      requestHash,
    });
    throw new CommandExecutionError(
      IDEMPOTENCY_PAYLOAD_CONFLICT,
      'the idempotency key belongs to a different request payload',
    );
  }
  const resultPayload = (existing.result_payload as CanonicalJsonObject | null) ?? null;
  const errorCode =
    resultPayload && typeof resultPayload.errorCode === 'string' ? resultPayload.errorCode : null;
  return {
    status: 'DUPLICATE',
    originalOutcome: existing.outcome === 'REJECTED' ? 'REJECTED' : 'COMMITTED',
    resultPayload,
    resultPayloadHash: existing.result_payload_hash,
    errorCode,
  };
}

async function finalizeReceipt(
  trx: QualityTransaction,
  commandId: string,
  outcome: 'COMMITTED' | 'REJECTED',
  resultPayload: CanonicalJsonObject,
): Promise<void> {
  const digest = digestCanonicalPayload(resultPayload);
  await trx
    .updateTable('quality_governance.command_receipt')
    .set({
      outcome,
      completed_at: new Date(),
      result_payload: digest.canonicalJson,
      result_payload_hash: digest.hash,
    })
    .where('command_id', '=', commandId)
    .execute();
}

function createExecution(
  trx: QualityTransaction,
  context: QualityTransactionContext,
  envelope: CommandEnvelope,
): CommandExecution {
  return {
    trx,
    async casProcessInstance(id, expectedVersion, patch = {}) {
      if (id !== envelope.targetId || expectedVersion !== envelope.expectedAggregateVersion) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'CAS target and expected version must match the command envelope',
        );
      }
      const updated = await trx
        .updateTable('quality_governance.process_instance')
        .set({
          aggregate_version: nextVersion(expectedVersion, false),
          updated_at: new Date(),
          ...(patch.state === undefined ? {} : { state: patch.state }),
        })
        .where('process_id', '=', id)
        .where('aggregate_version', '=', expectedVersion)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) === 1) return 'OK';
      const visible = await trx
        .selectFrom('quality_governance.process_instance')
        .select('aggregate_version')
        .where('process_id', '=', id)
        .executeTakeFirst();
      return visible ? 'CONFLICT' : 'NOT_FOUND';
    },
    async claimInbox(input) {
      if (
        context.kind !== 'EVENT_CONSUMER' ||
        context.sourceEventId !== input.eventId ||
        input.payloadHash.length !== 32
      ) {
        throw new CommandExecutionError(
          COMMAND_CONTEXT_MISMATCH,
          'inbox claim must match the trusted source event context',
        );
      }
      const inserted = await trx
        .insertInto('quality_governance.inbox_message')
        .values({
          consumer_name: input.consumerName,
          event_id: input.eventId,
          event_type: input.eventType,
          event_version: input.eventVersion,
          payload_hash: input.payloadHash,
          source_module: input.sourceModule,
          enterprise_id: envelope.enterpriseId,
          project_id: envelope.projectId ?? null,
          status: 'PENDING',
          correlation_id: envelope.correlationId,
          created_by_principal_id: envelope.principalId,
        })
        .onConflict((conflict) => conflict.columns(['consumer_name', 'event_id']).doNothing())
        .returning('event_id')
        .executeTakeFirst();
      if (inserted) return 'CLAIMED';
      const existing = await trx
        .selectFrom('quality_governance.inbox_message')
        .select(['payload_hash', 'event_type', 'event_version', 'source_module'])
        .where('consumer_name', '=', input.consumerName)
        .where('event_id', '=', input.eventId)
        .executeTakeFirst();
      if (
        !existing ||
        !existing.payload_hash.equals(input.payloadHash) ||
        existing.event_type !== input.eventType ||
        existing.event_version !== input.eventVersion ||
        existing.source_module !== input.sourceModule
      ) {
        throw new CommandExecutionError(
          INBOX_PAYLOAD_CONFLICT,
          'inbox event identity was replayed with different immutable facts',
        );
      }
      return 'REPLAY';
    },
    async completeInbox(consumerName, eventId) {
      if (context.kind !== 'EVENT_CONSUMER' || context.sourceEventId !== eventId) {
        throw new CommandExecutionError(
          COMMAND_CONTEXT_MISMATCH,
          'inbox completion must match the trusted source event context',
        );
      }
      const completed = await trx
        .updateTable('quality_governance.inbox_message')
        .set({
          status: 'PROCESSED',
          processed_at: new Date(),
          result_command_id: envelope.commandId,
        })
        .where('consumer_name', '=', consumerName)
        .where('event_id', '=', eventId)
        .where('status', '=', 'PENDING')
        .executeTakeFirst();
      if (Number(completed.numUpdatedRows) !== 1) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'inbox message is missing or is not pending',
        );
      }
    },
    async appendProcessStep(input) {
      if (input.processId !== envelope.targetId) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'process step must belong to the command target',
        );
      }
      await trx
        .insertInto('quality_governance.process_step')
        .values({
          process_step_id: input.processStepId,
          process_id: input.processId,
          step_no: input.stepNo,
          enterprise_id: envelope.enterpriseId,
          project_id: envelope.projectId ?? null,
          input_event_id: input.inputEventId ?? null,
          input_event_type: input.inputEventType ?? null,
          issued_command_id: envelope.commandId,
          issued_command_type: envelope.commandType,
          outcome: input.outcome,
          failure_code: input.failureCode ?? null,
          human_intervention: null,
          created_by_principal_id: envelope.principalId,
        })
        .execute();
    },
    async appendOutbox(input) {
      const expectedVersion =
        envelope.expectedAggregateVersion === undefined
          ? '1'
          : nextVersion(envelope.expectedAggregateVersion, true);
      if (
        input.aggregateType !== envelope.targetType ||
        input.aggregateId !== envelope.targetId ||
        input.aggregateVersion !== expectedVersion
      ) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'outbox aggregate identity and version must match the command target',
        );
      }
      if (
        input.payload.enterpriseId !== envelope.enterpriseId ||
        (input.payload.projectId ?? null) !== (envelope.projectId ?? null)
      ) {
        throw new CommandExecutionError(
          PAYLOAD_HASH_MISMATCH,
          'outbox payload scope mirror does not match the command scope',
        );
      }
      const digest = digestCanonicalPayload(input.payload);
      if (input.declaredHash && !input.declaredHash.equals(digest.hash)) {
        throw new CommandExecutionError(
          PAYLOAD_HASH_MISMATCH,
          'declared outbox hash does not match canonical payload',
        );
      }
      await trx
        .insertInto('quality_governance.outbox_event')
        .values({
          event_id: input.eventId,
          event_type: input.eventType,
          event_version: input.eventVersion,
          aggregate_type: input.aggregateType,
          aggregate_id: input.aggregateId,
          aggregate_version: input.aggregateVersion,
          enterprise_id: envelope.enterpriseId,
          project_id: envelope.projectId ?? null,
          correlation_id: envelope.correlationId,
          causation_id: envelope.causationId ?? null,
          payload: digest.canonicalJson,
          payload_hash: digest.hash,
          canonicalization_version: digest.canonicalizationVersion,
          occurred_at: input.occurredAt,
          created_by_principal_id: envelope.principalId,
          source_command_id: envelope.commandId,
        })
        .execute();
    },
    async appendReferenceEdge(input) {
      if (
        input.ownerObjectType !== envelope.targetType ||
        input.ownerObjectId !== envelope.targetId
      ) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'reference owner must match the command target',
        );
      }
      if (
        (input.ownerPayloadHash && input.ownerPayloadHash.length !== 32) ||
        (input.targetPayloadHash && input.targetPayloadHash.length !== 32)
      ) {
        throw new CommandExecutionError(PAYLOAD_HASH_MISMATCH, 'reference hash must be 32 bytes');
      }
      await trx
        .insertInto('quality_governance.reference_edge')
        .values({
          owner_object_type: input.ownerObjectType,
          owner_object_id: input.ownerObjectId,
          owner_version_id: input.ownerVersionId ?? null,
          owner_payload_hash: input.ownerPayloadHash ?? null,
          reference_path: input.referencePath,
          target_module: input.targetModule,
          target_object_type: input.targetObjectType,
          target_object_id: input.targetObjectId,
          target_version_id: input.targetVersionId ?? null,
          target_payload_hash: input.targetPayloadHash ?? null,
          reference_purpose: input.referencePurpose,
          enterprise_id: envelope.enterpriseId,
          project_id: envelope.projectId ?? null,
          source_command_id: envelope.commandId,
        })
        .execute();
    },
    async appendAudit(input) {
      await insertAudit(trx, envelope, input);
    },
    failAfterTechnicalWrites(): never {
      throw new CommandExecutionError('INJECTED_FAULT', 'controlled fault after technical writes');
    },
  };
}

async function insertAudit(
  trx: QualityTransaction,
  envelope: CommandEnvelope,
  input: CommandAuditInput,
): Promise<void> {
  await trx
    .insertInto('quality_governance.audit_record')
    .values({
      audit_id: newUuidV7(),
      enterprise_id: envelope.enterpriseId,
      project_id: envelope.projectId ?? null,
      principal_id: envelope.principalId,
      actor_snapshot_id: envelope.actorSnapshotId,
      authorization_decision_id: envelope.authorizationDecisionId,
      command_id: envelope.commandId,
      command_type: envelope.commandType,
      outcome: input.outcome,
      error_code: input.errorCode ?? null,
      request_payload_hash: input.requestHash ?? null,
      result_payload_hash: input.resultHash ?? null,
      target_type: envelope.targetType,
      target_id: envelope.targetId,
      target_aggregate_version: input.targetAggregateVersion ?? null,
      correlation_id: envelope.correlationId,
      causation_id: envelope.causationId ?? null,
      channel_ref: null,
      runtime_ref: null,
      break_glass_reason: null,
      approval_ref: null,
      safe_summary: input.safeSummary ?? null,
      retention_class: 'REGULATED_AUDIT',
    })
    .execute();
}

function mapTransactionError(error: unknown): never {
  if (error instanceof CommandExecutionError) throw error;
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
