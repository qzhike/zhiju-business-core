// IM-02 WI-10 (issue #38): the target-module Inbox consumer. One owning
// transaction: claim inbox → hash/major/required-extension/scope checks →
// idempotent target command → target state/outbox/audit + inbox PROCESSED
// commit atomically. Same consumer+event id + same hash replays read the
// saved result; a different hash (or major/extension/scope conflict) goes
// to quarantine/violation without executing the target command and is never
// reported as a duplicate success (PG-U-011 / PG-E-004).

import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import type { IdentityPolicyDb, IdentityTransactionContext } from '../persistence/identity-db.js';
import { withIdentityTransaction } from '../persistence/identity-db.js';
import {
  executeIdentityCommand,
  type CommandBodyResult,
  type CommandExecution,
} from '../persistence/command-runner.js';
import type { IdentityPolicyRepository } from '../persistence/identity-policy-repository.js';
import type { IdentityCryptoPorts } from '../persistence/ports.js';

export const INBOX_QUARANTINE_HASH_CONFLICT = 'INBOX_QUARANTINE_HASH_CONFLICT';
export const INBOX_QUARANTINE_UNKNOWN_MAJOR = 'INBOX_QUARANTINE_UNKNOWN_MAJOR';
export const INBOX_QUARANTINE_MISSING_EXTENSION = 'INBOX_QUARANTINE_MISSING_EXTENSION';
export const INBOX_SCOPE_CONFLICT = 'INBOX_SCOPE_CONFLICT';
export const INBOX_RACE_LOST = 'INBOX_RACE_LOST';

export interface ConsumedEvent {
  eventId: string;
  eventType: string;
  eventVersion: string;
  payloadHash: Buffer;
  sourceModule: string;
  payload: CanonicalJsonObject;
  occurredAt: Date;
  projectId?: string | undefined;
}

export interface InboxConsumerContract {
  consumerName: string;
  /** Supported event major versions (e.g. ['1']). */
  supportedMajors: string[];
  /** Required extension keys that must be present in the payload. */
  requiredExtensionKeys: string[];
}

export interface ConsumeEventDeps {
  readonly db: Kysely<IdentityPolicyDb>;
  readonly repo: IdentityPolicyRepository;
  readonly crypto: IdentityCryptoPorts;
  readonly context: IdentityTransactionContext;
}

export type ConsumeEventOutcome =
  | { status: 'PROCESSED'; resultCommandId: string | null }
  | { status: 'DUPLICATE'; resultCommandId: string | null }
  | { status: 'QUARANTINED'; reason: string }
  | { status: 'SCOPE_CONFLICT' };

/**
 * Consumes one event for one consumer. The whole effect — target state,
 * target outbox, audit and the inbox `PROCESSED` marker — commits in a
 * single owning-module transaction; a fault anywhere rolls everything back
 * and the event can be safely replayed.
 */
export async function consumeEvent(
  deps: ConsumeEventDeps,
  contract: InboxConsumerContract,
  event: ConsumedEvent,
  target: (execution: CommandExecution) => Promise<CommandBodyResult>,
  options: { faultAfterTarget?: boolean } = {},
): Promise<ConsumeEventOutcome> {
  // Replay adjudication first: an existing claim for this consumer+event is
  // either the saved success (same hash) or a quarantine case (different
  // hash). Neither executes the target command again.
  const existing = await withIdentityTransaction(deps.db, deps.context, async (trx) => {
    return trx
      .selectFrom('identity_policy.inbox_message')
      .selectAll()
      .where('consumer_name', '=', contract.consumerName)
      .where('event_id', '=', event.eventId)
      .executeTakeFirst();
  });

  if (existing) {
    if (!existing.payload_hash.equals(event.payloadHash)) {
      // Same event id, different payload hash: quarantine, keep the first
      // claim untouched, never a duplicate-success.
      await withIdentityTransaction(deps.db, deps.context, async (trx) => {
        await trx
          .insertInto('identity_policy.contract_violation')
          .values({
            violation_id: newUuidV7(),
            violation_kind: 'INBOX_HASH_CONFLICT',
            contract_type: event.eventType,
            contract_version: event.eventVersion,
            enterprise_id: deps.context.enterpriseId,
            observed_payload_hash: event.payloadHash,
            source_event_id: event.eventId,
            consumer_name: contract.consumerName,
            correlation_id: deps.context.correlationId,
            created_by_principal_id: deps.context.principalId,
          })
          .execute();
      });
      return { status: 'QUARANTINED', reason: INBOX_QUARANTINE_HASH_CONFLICT };
    }
    return { status: 'DUPLICATE', resultCommandId: existing.result_command_id ?? null };
  }

  const major = event.eventVersion.split('.')[0] ?? '';
  let quarantine:
    | { reason: string; kind: 'UNKNOWN_MAJOR' | 'UNKNOWN_REQUIRED_EXTENSION' }
    | { reason: string; kind: 'SCOPE_MISMATCH' }
    | undefined;
  if (!contract.supportedMajors.includes(major)) {
    quarantine = { reason: INBOX_QUARANTINE_UNKNOWN_MAJOR, kind: 'UNKNOWN_MAJOR' };
  } else if (contract.requiredExtensionKeys.some((key) => !(key in event.payload))) {
    quarantine = { reason: INBOX_QUARANTINE_MISSING_EXTENSION, kind: 'UNKNOWN_REQUIRED_EXTENSION' };
  } else if (event.payload.enterpriseId !== deps.context.enterpriseId) {
    quarantine = { reason: INBOX_SCOPE_CONFLICT, kind: 'SCOPE_MISMATCH' };
  }

  const commandId = newUuidV7();
  const result = await executeIdentityCommand(
    deps.db,
    deps.context,
    {
      commandId,
      commandType: `inbox.consume.${contract.consumerName}`,
      commandVersion: '1.0',
      idempotencyScope: `inbox:${contract.consumerName}`,
      idempotencyKey: event.eventId,
      requestPayload: {
        consumerName: contract.consumerName,
        eventId: event.eventId,
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        payloadHashDigest: event.payloadHash.toString('hex'),
      },
      platform: false,
      enterpriseId: deps.context.enterpriseId,
      projectId: event.projectId,
      targetType: 'InboxMessage',
      targetId: event.eventId,
      correlationId: deps.context.correlationId,
      principalId: deps.context.principalId,
      actorSnapshotId: deps.context.actorSnapshotId,
      authorizationDecisionId: deps.context.authorizationDecisionId,
    },
    async (execution) => {
      // Claim the inbox inside the owning transaction. A concurrent winner
      // shows up as a unique violation we translate to the race-lost path.
      try {
        await execution.trx
          .insertInto('identity_policy.inbox_message')
          .values({
            consumer_name: contract.consumerName,
            event_id: event.eventId,
            event_type: event.eventType,
            event_version: event.eventVersion,
            payload_hash: event.payloadHash,
            source_module: event.sourceModule,
            enterprise_id: deps.context.enterpriseId,
            project_id: event.projectId ?? null,
            status: 'PENDING',
            correlation_id: deps.context.correlationId,
            created_by_principal_id: deps.context.principalId,
          })
          .execute();
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          return {
            kind: 'REJECTED',
            errorCode: INBOX_RACE_LOST,
            safeSummary: 'another consumer transaction won the claim',
          };
        }
        throw error;
      }

      if (quarantine !== undefined) {
        // Quarantine/violation path: no target command, no duplicate
        // success; the stable receipt + violation + inbox marker commit.
        await execution.trx
          .updateTable('identity_policy.inbox_message')
          .set({ status: 'QUARANTINED', failure_code: quarantine.reason })
          .where('consumer_name', '=', contract.consumerName)
          .where('event_id', '=', event.eventId)
          .execute();
        await execution.trx
          .insertInto('identity_policy.contract_violation')
          .values({
            violation_id: newUuidV7(),
            violation_kind:
              quarantine.kind === 'SCOPE_MISMATCH' ? 'SCOPE_CONFLICT' : quarantine.kind,
            contract_type: event.eventType,
            contract_version: event.eventVersion,
            enterprise_id: deps.context.enterpriseId,
            observed_payload_hash: event.payloadHash,
            source_event_id: event.eventId,
            consumer_name: contract.consumerName,
            correlation_id: deps.context.correlationId,
            created_by_principal_id: deps.context.principalId,
          })
          .execute();
        return {
          kind: 'REJECTED',
          errorCode: quarantine.reason,
          safeSummary: 'event quarantined; target command not executed',
        };
      }

      const targetResult = await target(execution);
      if (targetResult.kind === 'REJECTED') {
        await execution.trx
          .updateTable('identity_policy.inbox_message')
          .set({ status: 'FAILED', failure_code: targetResult.errorCode })
          .where('consumer_name', '=', contract.consumerName)
          .where('event_id', '=', event.eventId)
          .execute();
        return targetResult;
      }
      if (options.faultAfterTarget === true) {
        // Controlled fault injection: everything rolls back together.
        throw new Error('INJECTED_FAULT_AFTER_TARGET');
      }
      await execution.trx
        .updateTable('identity_policy.inbox_message')
        .set({ status: 'PROCESSED', processed_at: new Date(), result_command_id: commandId })
        .where('consumer_name', '=', contract.consumerName)
        .where('event_id', '=', event.eventId)
        .execute();
      return targetResult;
    },
  );

  if (result.status === 'DUPLICATE') {
    return { status: 'DUPLICATE', resultCommandId: result.resultPayload ? commandId : null };
  }
  if (result.status === 'REJECTED') {
    if (result.errorCode === INBOX_SCOPE_CONFLICT) {
      return { status: 'SCOPE_CONFLICT' };
    }
    return { status: 'QUARANTINED', reason: result.errorCode };
  }
  return { status: 'PROCESSED', resultCommandId: commandId };
}
