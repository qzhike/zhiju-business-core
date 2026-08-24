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
import { digestCanonicalPayload, withIdentityTransaction } from '../persistence/identity-db.js';
import {
  executeIdentityCommand,
  type CommandBodyResult,
  type CommandExecution,
} from '../persistence/command-runner.js';
import type { IdentityPolicyRepository } from '../persistence/identity-policy-repository.js';
import type { IdentityCryptoPorts } from '../persistence/ports.js';

export const INBOX_QUARANTINE_HASH_CONFLICT = 'INBOX_QUARANTINE_HASH_CONFLICT';
export const INBOX_QUARANTINE_HASH_MISMATCH = 'INBOX_QUARANTINE_HASH_MISMATCH';
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

interface InboxQuarantine {
  reason: string;
  violationKind:
    'HASH_MISMATCH' | 'UNKNOWN_MAJOR' | 'UNKNOWN_REQUIRED_EXTENSION' | 'SCOPE_CONFLICT';
}

function canonicalPayloadHash(payload: CanonicalJsonObject): Buffer | undefined {
  try {
    return digestCanonicalPayload(payload).hash;
  } catch {
    return undefined;
  }
}

function hasRequiredExtension(payload: CanonicalJsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function hasScopeConflict(event: ConsumedEvent, context: IdentityTransactionContext): boolean {
  const payload = event.payload as Record<string, unknown>;
  const payloadProjectId = payload.projectId ?? null;
  const eventProjectId = event.projectId ?? null;
  return (
    payload.enterpriseId !== context.enterpriseId ||
    payloadProjectId !== eventProjectId ||
    (eventProjectId !== null && !context.allowedProjectIds.includes(eventProjectId))
  );
}

async function readInbox(
  deps: ConsumeEventDeps,
  contract: InboxConsumerContract,
  event: ConsumedEvent,
) {
  return withIdentityTransaction(deps.db, deps.context, async (trx) =>
    trx
      .selectFrom('identity_policy.inbox_message')
      .selectAll()
      .where('consumer_name', '=', contract.consumerName)
      .where('event_id', '=', event.eventId)
      .executeTakeFirst(),
  );
}

async function recordViolation(
  deps: ConsumeEventDeps,
  contract: InboxConsumerContract,
  event: ConsumedEvent,
  violationKind:
    | 'HASH_MISMATCH'
    | 'INBOX_HASH_CONFLICT'
    | 'UNKNOWN_MAJOR'
    | 'UNKNOWN_REQUIRED_EXTENSION'
    | 'SCOPE_CONFLICT',
  safeSummary: string,
): Promise<void> {
  await withIdentityTransaction(deps.db, deps.context, async (trx) => {
    await trx
      .insertInto('identity_policy.contract_violation')
      .values({
        violation_id: newUuidV7(),
        violation_kind: violationKind,
        contract_type: event.eventType,
        contract_version: event.eventVersion,
        enterprise_id: deps.context.enterpriseId,
        project_id: event.projectId ?? null,
        observed_payload_hash: event.payloadHash,
        source_event_id: event.eventId,
        consumer_name: contract.consumerName,
        correlation_id: deps.context.correlationId,
        safe_summary: safeSummary,
        created_by_principal_id: deps.context.principalId,
      })
      .execute();
  });
}

async function adjudicateExistingInbox(
  deps: ConsumeEventDeps,
  contract: InboxConsumerContract,
  event: ConsumedEvent,
  existing: NonNullable<Awaited<ReturnType<typeof readInbox>>>,
  canonicalHash: Buffer | undefined,
  quarantine: InboxQuarantine | undefined,
): Promise<ConsumeEventOutcome> {
  const hashMismatch = canonicalHash?.equals(event.payloadHash) !== true;
  if (hashMismatch || !existing.payload_hash.equals(event.payloadHash)) {
    await recordViolation(
      deps,
      contract,
      event,
      hashMismatch ? 'HASH_MISMATCH' : 'INBOX_HASH_CONFLICT',
      hashMismatch
        ? 'event payload does not match the canonical payload hash'
        : 'same consumer and event id replayed with a different payload hash',
    );
    return {
      status: 'QUARANTINED',
      reason: hashMismatch ? INBOX_QUARANTINE_HASH_MISMATCH : INBOX_QUARANTINE_HASH_CONFLICT,
    };
  }
  if (existing.status === 'QUARANTINED') {
    if (existing.failure_code === INBOX_SCOPE_CONFLICT) {
      return { status: 'SCOPE_CONFLICT' };
    }
    return {
      status: 'QUARANTINED',
      reason: existing.failure_code ?? 'INBOX_QUARANTINED',
    };
  }
  if (quarantine !== undefined) {
    await recordViolation(
      deps,
      contract,
      event,
      quarantine.violationKind,
      'replayed event no longer satisfies the consumer contract',
    );
    if (quarantine.violationKind === 'SCOPE_CONFLICT') {
      return { status: 'SCOPE_CONFLICT' };
    }
    return { status: 'QUARANTINED', reason: quarantine.reason };
  }
  if (existing.status === 'FAILED') {
    return {
      status: 'QUARANTINED',
      reason: existing.failure_code ?? 'INBOX_TARGET_REJECTED',
    };
  }
  return { status: 'DUPLICATE', resultCommandId: existing.result_command_id ?? null };
}

function determineQuarantine(
  event: ConsumedEvent,
  contract: InboxConsumerContract,
  context: IdentityTransactionContext,
  canonicalHash: Buffer | undefined,
): InboxQuarantine | undefined {
  const major = event.eventVersion.split('.')[0] ?? '';
  if (canonicalHash?.equals(event.payloadHash) !== true) {
    return { reason: INBOX_QUARANTINE_HASH_MISMATCH, violationKind: 'HASH_MISMATCH' };
  }
  if (!contract.supportedMajors.includes(major)) {
    return { reason: INBOX_QUARANTINE_UNKNOWN_MAJOR, violationKind: 'UNKNOWN_MAJOR' };
  }
  if (contract.requiredExtensionKeys.some((key) => !hasRequiredExtension(event.payload, key))) {
    return {
      reason: INBOX_QUARANTINE_MISSING_EXTENSION,
      violationKind: 'UNKNOWN_REQUIRED_EXTENSION',
    };
  }
  if (hasScopeConflict(event, context)) {
    return { reason: INBOX_SCOPE_CONFLICT, violationKind: 'SCOPE_CONFLICT' };
  }
  return undefined;
}

function isCommandReceiptRace(error: unknown): boolean {
  const candidate = error as { code?: string; constraint?: string };
  return candidate.code === '23505' && candidate.constraint === 'command_receipt_idem_unique';
}

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
  const canonicalHash = canonicalPayloadHash(event.payload);
  const quarantine = determineQuarantine(event, contract, deps.context, canonicalHash);

  // Replay adjudication first: an existing claim for this consumer+event is
  // either the saved success (same hash) or a quarantine case (different
  // hash). Neither executes the target command again.
  const existing = await readInbox(deps, contract, event);

  if (existing) {
    return adjudicateExistingInbox(deps, contract, event, existing, canonicalHash, quarantine);
  }

  const commandId = newUuidV7();
  let result: Awaited<ReturnType<typeof executeIdentityCommand>>;
  try {
    result = await executeIdentityCommand(
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
        // is adjudicated after the command receipt unique-key race resolves.
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
              violation_kind: quarantine.violationKind,
              contract_type: event.eventType,
              contract_version: event.eventVersion,
              enterprise_id: deps.context.enterpriseId,
              project_id: event.projectId ?? null,
              observed_payload_hash: event.payloadHash,
              source_event_id: event.eventId,
              consumer_name: contract.consumerName,
              correlation_id: deps.context.correlationId,
              safe_summary: 'event quarantined; target command not executed',
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
            .set({
              status: 'FAILED',
              failure_code: targetResult.errorCode,
              safe_error_summary: targetResult.safeSummary,
            })
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
  } catch (error) {
    if (!isCommandReceiptRace(error)) {
      throw error;
    }
    const raced = await readInbox(deps, contract, event);
    if (!raced) {
      throw error;
    }
    return adjudicateExistingInbox(deps, contract, event, raced, canonicalHash, quarantine);
  }

  if (result.status === 'DUPLICATE') {
    const replayed = await readInbox(deps, contract, event);
    if (replayed) {
      return adjudicateExistingInbox(deps, contract, event, replayed, canonicalHash, quarantine);
    }
    return { status: 'DUPLICATE', resultCommandId: null };
  }
  if (result.status === 'REJECTED') {
    if (result.errorCode === INBOX_RACE_LOST) {
      const raced = await readInbox(deps, contract, event);
      if (raced) {
        return adjudicateExistingInbox(deps, contract, event, raced, canonicalHash, quarantine);
      }
    }
    if (result.errorCode === INBOX_SCOPE_CONFLICT) {
      return { status: 'SCOPE_CONFLICT' };
    }
    return { status: 'QUARANTINED', reason: result.errorCode };
  }
  return { status: 'PROCESSED', resultCommandId: commandId };
}
