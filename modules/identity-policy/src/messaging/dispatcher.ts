// IM-02 WI-10 (issue #38): the restricted Outbox dispatcher. At-least-once
// delivery with claim/lease/fencing, same-aggregate version ordering,
// UNKNOWN on publish timeout (same event id retained) and IM-02 default
// retry/dead-letter parameters. The dispatcher role can only advance
// delivery metadata — business payloads and hashes are untouchable.

import type { Pool } from 'pg';
import { newUuidV7 } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import type { IdentityPolicyDb, IdentityTransactionContext } from '../persistence/identity-db.js';
import { withIdentityTransaction } from '../persistence/identity-db.js';

/** IM-02 defaults (documented, adjustable by deployment policy). */
export const DISPATCH_DEFAULTS = Object.freeze({
  /** Maximum delivery attempts before an event becomes DEAD. */
  maxAttempts: 5,
  /** Base backoff seconds for UNKNOWN retries (doubles per attempt). */
  retryBackoffBaseSeconds: 2,
  /** Lease duration for one claim. */
  leaseSeconds: 60,
  /** Claim batch size per polling round. */
  claimBatchSize: 10,
});

export interface ClaimedOutboxEvent {
  eventId: string;
  eventType: string;
  eventVersion: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: string;
  payload: unknown;
  payloadHash: Buffer;
  leaseToken: string;
}

export class DispatcherError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DispatcherError';
  }
}

export const DISPATCHER_STALE_LEASE = 'DISPATCHER_STALE_LEASE';
export const DISPATCHER_EVENT_NOT_FOUND = 'DISPATCHER_EVENT_NOT_FOUND';

/**
 * Claims dispatchable events on the dispatcher connection: PENDING/UNKNOWN
 * events that are due, at most one per aggregate (the earliest unpublished
 * version blocks later versions), ordered for same-aggregate delivery.
 */
export async function claimOutboxEvents(
  dispatcherPool: Pool,
  options: {
    owner: string;
    limit?: number;
    leaseSeconds?: number;
    platform?: boolean;
    /** Optional shard filter: claim only these aggregates. */
    aggregateIds?: readonly string[];
  },
): Promise<ClaimedOutboxEvent[]> {
  const table = options.platform ? 'platform_outbox_event' : 'outbox_event';
  const leaseSeconds = options.leaseSeconds ?? DISPATCH_DEFAULTS.leaseSeconds;
  const limit = options.limit ?? DISPATCH_DEFAULTS.claimBatchSize;
  const shard = options.aggregateIds ? 'AND e.aggregate_id = ANY($2::uuid[])' : '';
  const client = await dispatcherPool.connect();
  try {
    await client.query('BEGIN');
    const claimed = await client.query<{
      event_id: string;
      event_type: string;
      event_version: string;
      aggregate_type: string;
      aggregate_id: string;
      aggregate_version: string;
      payload: unknown;
      payload_hash: Buffer;
    }>(
      `SELECT event_id, event_type, event_version, aggregate_type, aggregate_id,
              aggregate_version::text, payload, payload_hash
       FROM identity_policy.${table} e
       WHERE (
           (e.delivery_state IN ('PENDING', 'UNKNOWN') AND e.available_at <= now())
           OR (e.delivery_state = 'LEASED' AND e.lease_until < now())
       )
         ${shard}
         AND NOT EXISTS (
           SELECT 1 FROM identity_policy.${table} earlier
           WHERE earlier.aggregate_id = e.aggregate_id
             AND earlier.aggregate_version < e.aggregate_version
             AND earlier.delivery_state <> 'PUBLISHED')
       ORDER BY e.aggregate_id, e.aggregate_version, e.recorded_at
       LIMIT $1
       FOR UPDATE OF e SKIP LOCKED`,
      options.aggregateIds ? [limit, options.aggregateIds] : [limit],
    );
    const events: ClaimedOutboxEvent[] = [];
    for (const row of claimed.rows) {
      const token = await client.query<{ token: string }>(
        `UPDATE identity_policy.${table}
         SET delivery_state = 'LEASED', lease_owner = $2, lease_until = now() + make_interval(secs => $3),
             lease_token = attempt_count + 1, attempt_count = attempt_count + 1
         WHERE event_id = $1
           AND (
             (delivery_state IN ('PENDING', 'UNKNOWN') AND available_at <= now())
             OR (delivery_state = 'LEASED' AND lease_until < now())
           )
         RETURNING lease_token::text AS token`,
        [row.event_id, options.owner, leaseSeconds],
      );
      const leaseToken = token.rows[0]?.token;
      if (leaseToken !== undefined) {
        events.push({
          eventId: row.event_id,
          eventType: row.event_type,
          eventVersion: row.event_version,
          aggregateType: row.aggregate_type,
          aggregateId: row.aggregate_id,
          aggregateVersion: row.aggregate_version,
          payload: row.payload,
          payloadHash: row.payload_hash,
          leaseToken,
        });
      }
    }
    await client.query('COMMIT');
    return events;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Confirms a successful publish. Only the current lease/fencing owner may
 * advance the state — a stale owner's confirmation is rejected.
 */
export async function confirmPublished(
  dispatcherPool: Pool,
  input: { eventId: string; leaseToken: string; platform?: boolean },
): Promise<void> {
  const table = input.platform ? 'platform_outbox_event' : 'outbox_event';
  const client = await dispatcherPool.connect();
  try {
    const updated = await client.query(
      `UPDATE identity_policy.${table}
       SET delivery_state = 'PUBLISHED', published_at = now(), lease_owner = NULL, lease_until = NULL
       WHERE event_id = $1 AND lease_token = $2 AND delivery_state = 'LEASED'
         AND lease_until > now()`,
      [input.eventId, input.leaseToken],
    );
    if (updated.rowCount === 0) {
      throw new DispatcherError(
        DISPATCHER_STALE_LEASE,
        'event is not leased to this fencing token; confirmation rejected',
      );
    }
  } finally {
    client.release();
  }
}

/**
 * Records a failed/timeout delivery attempt: the SAME event id stays in
 * UNKNOWN with backoff — never a new event id to mask a retry.
 */
export async function markDeliveryFailure(
  dispatcherPool: Pool,
  input: {
    eventId: string;
    leaseToken: string;
    errorCode: string;
    platform?: boolean;
    backoffBaseSeconds?: number;
    maxAttempts?: number;
  },
): Promise<'UNKNOWN' | 'DEAD'> {
  const table = input.platform ? 'platform_outbox_event' : 'outbox_event';
  const base = input.backoffBaseSeconds ?? DISPATCH_DEFAULTS.retryBackoffBaseSeconds;
  const maxAttempts = input.maxAttempts ?? DISPATCH_DEFAULTS.maxAttempts;
  if (!Number.isFinite(base) || base < 0) {
    throw new TypeError('backoffBaseSeconds must be a non-negative finite number');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxAttempts must be a positive integer');
  }
  const client = await dispatcherPool.connect();
  try {
    const updated = await client.query<{ delivery_state: 'UNKNOWN' | 'DEAD' }>(
      `UPDATE identity_policy.${table}
       SET delivery_state = CASE WHEN attempt_count >= $3 THEN 'DEAD' ELSE 'UNKNOWN' END,
           last_error_code = $4,
           available_at = CASE
             WHEN attempt_count >= $3 THEN now()
             ELSE now() + make_interval(
               secs => $5 * power(2::double precision, GREATEST(0, attempt_count - 1)::double precision))
           END,
           lease_owner = NULL, lease_until = NULL
       WHERE event_id = $1 AND lease_token = $2 AND delivery_state = 'LEASED'
         AND lease_until > now()
       RETURNING delivery_state`,
      [input.eventId, input.leaseToken, maxAttempts, input.errorCode, base],
    );
    const state = updated.rows[0]?.delivery_state;
    if (state === undefined) {
      throw new DispatcherError(DISPATCHER_STALE_LEASE, 'stale lease token; failure mark rejected');
    }
    return state;
  } finally {
    client.release();
  }
}

/**
 * Manual replay/resume of a DEAD event (operator action): the event returns
 * to PENDING on the dispatcher connection and an immutable audit record is
 * written through the application transaction context. The business payload
 * is untouched.
 */
export async function resumeDeadLetterEvent(
  dispatcherPool: Pool,
  deps: { db: Kysely<IdentityPolicyDb>; context: IdentityTransactionContext },
  input: { eventId: string; reason: string; platform?: boolean },
): Promise<void> {
  const table = input.platform ? 'platform_outbox_event' : 'outbox_event';
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > 256) {
    throw new TypeError('resume reason must contain 1 to 256 characters');
  }

  // Record the operator action before changing the delivery state. This keeps
  // an audit failure from leaving an already-resumed event without evidence.
  await withIdentityTransaction(deps.db, deps.context, async (trx) => {
    const safeSummary = `resume dead-letter event ${input.eventId}; reason: ${reason}; payload untouched`;
    if (input.platform) {
      await trx
        .insertInto('identity_policy.platform_audit_record')
        .values({
          audit_id: newUuidV7(),
          principal_id: deps.context.principalId,
          actor_snapshot_id: deps.context.actorSnapshotId,
          authorization_decision_id: deps.context.authorizationDecisionId,
          command_type: 'identity.internal.resume_dead_letter',
          outcome: 'INFO',
          safe_summary: safeSummary,
          correlation_id: deps.context.correlationId,
          retention_class: 'OPERATIONAL',
        })
        .execute();
      return;
    }
    await trx
      .insertInto('identity_policy.audit_record')
      .values({
        audit_id: newUuidV7(),
        enterprise_id: deps.context.enterpriseId,
        principal_id: deps.context.principalId,
        actor_snapshot_id: deps.context.actorSnapshotId,
        authorization_decision_id: deps.context.authorizationDecisionId,
        command_type: 'identity.internal.resume_dead_letter',
        outcome: 'INFO',
        safe_summary: safeSummary,
        correlation_id: deps.context.correlationId,
        retention_class: 'OPERATIONAL',
      })
      .execute();
  });

  const client = await dispatcherPool.connect();
  try {
    const updated = await client.query(
      `UPDATE identity_policy.${table}
       SET delivery_state = 'PENDING', available_at = now(), last_error_code = NULL
       WHERE event_id = $1 AND delivery_state = 'DEAD'`,
      [input.eventId],
    );
    if (updated.rowCount === 0) {
      throw new DispatcherError(DISPATCHER_EVENT_NOT_FOUND, 'no DEAD event with this id');
    }
  } finally {
    client.release();
  }
}
