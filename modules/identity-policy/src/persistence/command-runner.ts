// IM-02 WI-06 (issue #34): the Command transaction runner for the
// IdentityPolicy vertical slice. One owning-module transaction:
// claim receipt → load expected version → execute → aggregate/fact +
// audit + outbox → finalize result → commit (PG §17.1).
//
// The runner is deliberately constrained to the identity_policy owning
// schema (the Kysely database type has no other tables), performs no
// network side effects and never touches projections. Everything it writes
// lives and dies in the single transaction; a crash or injected fault
// leaves no half-finished receipt, audit, reference or event (PG-U-012).

import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import {
  digestCanonicalPayload,
  withIdentityTransaction,
  type IdentityPolicyDb,
  type IdentityTransaction,
  type IdentityTransactionContext,
} from './identity-db.js';

export const IDEMPOTENCY_PAYLOAD_CONFLICT = 'IDEMPOTENCY_PAYLOAD_CONFLICT';
export const CONCURRENCY_CONFLICT = 'CONCURRENCY_CONFLICT';
export const COMMAND_IN_PROGRESS = 'COMMAND_IN_PROGRESS';
export const PAYLOAD_HASH_MISMATCH = 'PAYLOAD_HASH_MISMATCH';
export const COMMAND_CONTEXT_MISMATCH = 'COMMAND_CONTEXT_MISMATCH';
export const COMMAND_TARGET_MISMATCH = 'COMMAND_TARGET_MISMATCH';

/** Typed failure with a stable, safe code (never carries raw payloads). */
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
  commandId: string;
  commandType: string;
  commandVersion: string;
  /** Business-stable idempotency identity of the command. */
  idempotencyScope: string;
  idempotencyKey: string;
  requestPayload: CanonicalJsonObject;
  /** Platform commands use the platform_* technical tables (no scope mix). */
  platform: boolean;
  enterpriseId: string;
  projectId?: string;
  targetType: string;
  targetId: string;
  expectedAggregateVersion?: string;
  correlationId: string;
  causationId?: string;
  principalId: string;
  actorSnapshotId: string;
  authorizationDecisionId: string;
}

export interface OutboxEventInput {
  eventId: string;
  eventType: string;
  eventVersion: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: string;
  payload: CanonicalJsonObject;
  /** Optional integrity pin; must equal the canonical digest when given. */
  declaredHash?: Buffer;
  occurredAt: Date;
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

/** What the command body produced. */
export type CommandBodyResult =
  | { kind: 'COMMITTED'; resultPayload: CanonicalJsonObject }
  | {
      kind: 'REJECTED';
      errorCode: string;
      safeSummary: string;
      currentAggregateVersion?: string | undefined;
    };

export interface CommandExecution {
  readonly trx: IdentityTransaction;
  /**
   * Single-statement compare-and-set on the principal aggregate, scoped by
   * RLS through the transaction context. Returns NOT_FOUND when the row is
   * invisible (safe unified semantics) and CONFLICT on a version mismatch.
   */
  casPrincipalStatus(
    id: string,
    expectedVersion: string,
    patch: { status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'ARCHIVED'; lastCommandId?: string },
  ): Promise<'OK' | 'NOT_FOUND' | 'CONFLICT'>;
  appendOutbox(event: OutboxEventInput): Promise<void>;
  appendAudit(audit: CommandAuditInput): Promise<void>;
  /** Controlled fault injection (WI-06): aborts after the outbox write. */
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

/**
 * Executes one command atomically. The idempotency claim, aggregate change,
 * audit, outbox event(s) and the finalized receipt commit together or not
 * at all; replays read the saved result instead of re-executing.
 */
export async function executeIdentityCommand(
  db: Kysely<IdentityPolicyDb>,
  context: IdentityTransactionContext,
  envelope: CommandEnvelope,
  body: (execution: CommandExecution) => Promise<CommandBodyResult>,
): Promise<CommandResult> {
  validateEnvelopeContext(context, envelope);
  const requestDigest = digestCanonicalPayload(envelope.requestPayload);

  const outcome = await withIdentityTransaction(db, context, async (trx) => {
    // 1) Atomically claim through the database uniqueness constraint. A
    // concurrent loser waits for the winner, observes no inserted row and
    // adjudicates the now-committed receipt in this same transaction.
    const claimed = await claimReceipt(trx, envelope, requestDigest.hash);
    if (!claimed) {
      const existing = await readReceipt(trx, envelope);
      if (!existing) {
        throw new CommandExecutionError(
          COMMAND_IN_PROGRESS,
          'the command claim could not be resolved after a concurrent attempt',
        );
      }
      if (!existing.request_payload_hash.equals(requestDigest.hash)) {
        await insertAuditRow(trx, envelope, context, {
          outcome: 'DENIED',
          errorCode: IDEMPOTENCY_PAYLOAD_CONFLICT,
          targetType: envelope.targetType,
          targetId: envelope.targetId,
          targetAggregateVersion: existing.expected_aggregate_version ?? undefined,
          safeSummary: 'same idempotency key replayed with a different request hash',
          requestHash: requestDigest.hash,
        });
        return { kind: 'PAYLOAD_CONFLICT' } as const;
      }
      if (existing.outcome === 'PENDING') {
        return { kind: 'IN_PROGRESS' } as const;
      }
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

    // 2) Execute the command body with the constrained execution handle.
    // Any body failure (including injected faults) rolls the whole
    // transaction back — receipt included (PG-U-012).
    const bodyResult = await body(createExecution(trx, envelope, context));

    if (bodyResult.kind === 'REJECTED') {
      // 4a) Business rejection: the aggregate is untouched; the stable
      // receipt + audit still commit as the record of the denial.
      await finalizeReceipt(trx, envelope, {
        outcome: 'REJECTED',
        resultPayload: {
          errorCode: bodyResult.errorCode,
          safeSummary: bodyResult.safeSummary,
          currentAggregateVersion: bodyResult.currentAggregateVersion ?? null,
        },
        errorCode: bodyResult.errorCode,
      });
      await insertAuditRow(trx, envelope, context, {
        outcome: 'REJECTED',
        errorCode: bodyResult.errorCode,
        targetType: envelope.targetType,
        targetId: envelope.targetId,
        targetAggregateVersion: bodyResult.currentAggregateVersion,
        safeSummary: bodyResult.safeSummary,
        requestHash: requestDigest.hash,
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

    // 4b) Commit path: finalize the receipt with the stable result digest.
    const resultDigest = digestCanonicalPayload(bodyResult.resultPayload);
    await finalizeReceipt(trx, envelope, {
      outcome: 'COMMITTED',
      resultPayload: bodyResult.resultPayload,
    });
    await insertAuditRow(trx, envelope, context, {
      outcome: 'COMMITTED',
      targetType: envelope.targetType,
      targetId: envelope.targetId,
      requestHash: requestDigest.hash,
      resultHash: resultDigest.hash,
    });
    return {
      kind: 'RESULT',
      result: {
        status: 'COMMITTED',
        resultPayload: bodyResult.resultPayload,
        resultPayloadHash: resultDigest.hash,
      } satisfies CommandResult,
    } as const;
  });

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

interface ReceiptFacts {
  request_payload_hash: Buffer;
  outcome: 'PENDING' | 'COMMITTED' | 'REJECTED';
  result_payload: unknown;
  result_payload_hash: Buffer | null;
  expected_aggregate_version: string | null;
}

/**
 * Reads an existing receipt under a fresh RLS context. Returns undefined
 * when the idempotency key is unclaimed. The REJECTED error code lives in
 * the canonical result payload (no raw payloads are ever echoed).
 */
async function readReceipt(
  trx: IdentityTransaction,
  envelope: CommandEnvelope,
): Promise<ReceiptFacts | undefined> {
  if (envelope.platform) {
    return (await trx
      .selectFrom('identity_policy.platform_command_receipt')
      .selectAll()
      .where('idempotency_scope', '=', envelope.idempotencyScope)
      .where('idempotency_key', '=', envelope.idempotencyKey)
      .executeTakeFirst()) as ReceiptFacts | undefined;
  }
  return (await trx
    .selectFrom('identity_policy.command_receipt')
    .selectAll()
    .where('idempotency_scope', '=', envelope.idempotencyScope)
    .where('idempotency_key', '=', envelope.idempotencyKey)
    .executeTakeFirst()) as ReceiptFacts | undefined;
}

async function claimReceipt(
  trx: IdentityTransaction,
  envelope: CommandEnvelope,
  requestHash: Buffer,
): Promise<boolean> {
  if (envelope.platform) {
    const inserted = await trx
      .insertInto('identity_policy.platform_command_receipt')
      .values({
        command_id: envelope.commandId,
        command_type: envelope.commandType,
        command_version: envelope.commandVersion,
        idempotency_scope: envelope.idempotencyScope,
        idempotency_key: envelope.idempotencyKey,
        request_payload_hash: requestHash,
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
  const inserted = await trx
    .insertInto('identity_policy.command_receipt')
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

async function finalizeReceipt(
  trx: IdentityTransaction,
  envelope: CommandEnvelope,
  final: {
    outcome: 'COMMITTED' | 'REJECTED';
    resultPayload: CanonicalJsonObject;
    errorCode?: string;
  },
): Promise<void> {
  const resultDigest = digestCanonicalPayload(final.resultPayload);
  if (envelope.platform) {
    await trx
      .updateTable('identity_policy.platform_command_receipt')
      .set({
        outcome: final.outcome,
        completed_at: new Date(),
        result_payload: resultDigest.canonicalJson,
        result_payload_hash: resultDigest.hash,
      })
      .where('command_id', '=', envelope.commandId)
      .execute();
    return;
  }
  await trx
    .updateTable('identity_policy.command_receipt')
    .set({
      outcome: final.outcome,
      completed_at: new Date(),
      result_payload: resultDigest.canonicalJson,
      result_payload_hash: resultDigest.hash,
    })
    .where('command_id', '=', envelope.commandId)
    .execute();
}

function createExecution(
  trx: IdentityTransaction,
  envelope: CommandEnvelope,
  context: IdentityTransactionContext,
): CommandExecution {
  return {
    trx,
    async casPrincipalStatus(id, expectedVersion, patch) {
      if (id !== envelope.targetId || expectedVersion !== envelope.expectedAggregateVersion) {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'CAS target and expected version must match the command envelope',
        );
      }
      let nextVersion: string;
      try {
        const parsed = BigInt(expectedVersion);
        if (parsed < 1n) {
          throw new Error('aggregate version must be positive');
        }
        nextVersion = (parsed + 1n).toString();
      } catch {
        throw new CommandExecutionError(
          COMMAND_TARGET_MISMATCH,
          'expected aggregate version must be a positive bigint',
        );
      }
      const updated = await trx
        .updateTable('identity_policy.principal')
        .set({
          status: patch.status,
          aggregate_version: nextVersion,
          updated_at: new Date(),
          last_command_id: patch.lastCommandId ?? envelope.commandId,
        })
        .where('id', '=', id)
        .where('aggregate_version', '=', expectedVersion)
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) === 1) {
        return 'OK';
      }
      // Distinguish invisible (RLS/absent) from version conflict without
      // leaking existence: a scope-mismatched read returns zero rows.
      const visible = await trx
        .selectFrom('identity_policy.principal')
        .select(['aggregate_version'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!visible) {
        return 'NOT_FOUND';
      }
      return 'CONFLICT';
    },
    async appendOutbox(event) {
      // Promoted scope mirror: enterprise events must embed their scope
      // exactly; the database trigger re-checks the same invariant.
      if (!envelope.platform) {
        if (event.payload.enterpriseId !== envelope.enterpriseId) {
          throw new CommandExecutionError(
            PAYLOAD_HASH_MISMATCH,
            'event payload scope mirror does not match the command scope',
          );
        }
      }
      const digest = digestCanonicalPayload(event.payload);
      if (event.declaredHash && !event.declaredHash.equals(digest.hash)) {
        throw new CommandExecutionError(
          PAYLOAD_HASH_MISMATCH,
          'declared event hash does not match the canonical payload',
        );
      }
      if (envelope.platform) {
        await trx
          .insertInto('identity_policy.platform_outbox_event')
          .values({
            event_id: event.eventId,
            event_type: event.eventType,
            event_version: event.eventVersion,
            aggregate_type: event.aggregateType,
            aggregate_id: event.aggregateId,
            aggregate_version: event.aggregateVersion,
            correlation_id: envelope.correlationId,
            causation_id: envelope.causationId ?? null,
            payload: digest.canonicalJson,
            payload_hash: digest.hash,
            canonicalization_version: digest.canonicalizationVersion,
            occurred_at: event.occurredAt,
            created_by_principal_id: envelope.principalId,
            source_command_id: envelope.commandId,
          })
          .execute();
      } else {
        await trx
          .insertInto('identity_policy.outbox_event')
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
            causation_id: envelope.causationId ?? null,
            payload: digest.canonicalJson,
            payload_hash: digest.hash,
            canonicalization_version: digest.canonicalizationVersion,
            occurred_at: event.occurredAt,
            created_by_principal_id: envelope.principalId,
            source_command_id: envelope.commandId,
          })
          .execute();
      }
    },
    async appendAudit(audit) {
      await insertAuditRow(trx, envelope, context, audit);
    },
    failAfterOutbox(): never {
      throw new CommandExecutionError('INJECTED_FAULT', 'controlled fault after outbox write');
    },
  };
}

function validateEnvelopeContext(
  context: IdentityTransactionContext,
  envelope: CommandEnvelope,
): void {
  const projectAllowed =
    envelope.projectId === undefined || context.allowedProjectIds.includes(envelope.projectId);
  if (
    envelope.principalId !== context.principalId ||
    envelope.actorSnapshotId !== context.actorSnapshotId ||
    envelope.authorizationDecisionId !== context.authorizationDecisionId ||
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

async function insertAuditRow(
  trx: IdentityTransaction,
  envelope: CommandEnvelope,
  context: IdentityTransactionContext,
  audit: CommandAuditInput,
): Promise<void> {
  const auditId = newUuidV7();
  if (envelope.platform) {
    await trx
      .insertInto('identity_policy.platform_audit_record')
      .values({
        audit_id: auditId,
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
        correlation_id: envelope.correlationId,
        causation_id: envelope.causationId ?? null,
        safe_summary: audit.safeSummary ?? null,
        retention_class: 'REGULATED_AUDIT',
      })
      .execute();
    return;
  }
  await trx
    .insertInto('identity_policy.audit_record')
    .values({
      audit_id: auditId,
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

/** Stable error code of a rejected receipt (canonical result payload). */
function rejectionErrorCode(receipt: ReceiptFacts): string | null {
  const payload = receipt.result_payload as { errorCode?: unknown } | null;
  return typeof payload?.errorCode === 'string' ? payload.errorCode : null;
}
