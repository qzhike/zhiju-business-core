import { createHmac } from 'node:crypto';
import { newUuidV7 } from '@zhiju/shared-kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  claimOutboxEvents,
  confirmPublished,
  consumeEvent,
  DispatcherError,
  markDeliveryFailure,
  resumeDeadLetterEvent,
  createIdentityPolicyDatabase,
  IdentityPolicyRepository,
  withIdentityTransaction,
  type IdentityCryptoPorts,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';

// IM-02 WI-10 (issue #38): Outbox/Inbox replay, dispatcher and quarantine on
// real PostgreSQL: same consumer+event id + same hash replays the saved
// result without a second business fact; different hash / unknown major /
// missing extension / scope conflict go to quarantine and are never marked
// duplicate success; the whole target effect commits atomically and rolls
// back on injected faults; the dispatcher advances only delivery metadata
// under lease/fencing (PG-U-011 / PG-E-004).

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE_A = 'cccccccc-cccc-7ccc-8ccc-ccccccccccca';
const ENTERPRISE_B = 'dddddddd-dddd-7ddd-8ddd-ddddddddddb2';
const PROJECT_A1 = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee1';
const OPERATOR = 'ffffffff-ffff-7fff-8fff-fffffffffff1';
const OPERATOR_ACTOR = 'ffffffff-ffff-7fff-8fff-fffffffffff2';
const DECISION = 'ffffffff-ffff-7fff-8fff-fffffffffff3';
const DECISION_HASH = Buffer.alloc(32, 0xa1);
const CORRELATION = 'ffffffff-ffff-7fff-8fff-fffffffffff4';

const EVENT_1 = '10101010-1010-7101-8101-101010101001';
const EVENT_2 = '10101010-1010-7101-8101-101010101002';
const AGG_1 = '20202020-2020-7202-8202-202020202001';
const AGG_2 = '20202020-2020-7202-8202-202020202002';

const crypto: IdentityCryptoPorts = {
  lookupHash: {
    computeKeyedLookupHash(input: string) {
      return {
        hash: createHmac('sha256', Buffer.alloc(32, 0x9c)).update(input, 'utf8').digest(),
        algorithm: 'HMAC-SHA-256' as const,
        keyVersion: 1,
      };
    },
  },
  fieldEncryption: {
    encryptField() {
      throw new Error('not needed');
    },
    decryptField() {
      throw new Error('not needed');
    },
  },
};

function payloadFor(enterpriseId: string, note: string) {
  return { enterpriseId, note };
}

function hashOf(payload: unknown): Buffer {
  return createHmac('sha256', Buffer.alloc(32, 0x9c)).update(JSON.stringify(payload)).digest();
}

describe.skipIf(!gateEnabled)('outbox dispatcher and inbox consumer (real PostgreSQL)', () => {
  let admin: pg.Client;
  let appPool: pg.Pool;
  let dispatcherPool: pg.Pool;
  let db: ReturnType<typeof createIdentityPolicyDatabase>;
  let repo: IdentityPolicyRepository;
  let context: IdentityTransactionContext;
  let targetEffects: string[];

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE wi10_probe_ip LOGIN PASSWORD 'wi10-probe-ip' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(`GRANT identity_policy_app TO wi10_probe_ip`);
    await admin.query(
      `CREATE ROLE wi10_probe_disp LOGIN PASSWORD 'wi10-probe-disp' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(`GRANT identity_policy_dispatcher TO wi10_probe_disp`);

    const appUrl = new URL(databaseUrl ?? '');
    appUrl.username = 'wi10_probe_ip';
    appUrl.password = 'wi10-probe-ip';
    appPool = new pg.Pool({ connectionString: appUrl.toString(), max: 2 });
    db = createIdentityPolicyDatabase(appPool);
    repo = new IdentityPolicyRepository(crypto);
    context = {
      kind: 'REQUEST',
      principalId: OPERATOR,
      actorSnapshotId: OPERATOR_ACTOR,
      authorizationDecisionId: DECISION,
      authorizationDecisionHash: DECISION_HASH,
      authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      enterpriseId: ENTERPRISE_A,
      allowedProjectIds: [PROJECT_A1],
      correlationId: CORRELATION,
    };
    const dispatcherUrl = new URL(databaseUrl ?? '');
    dispatcherUrl.username = 'wi10_probe_disp';
    dispatcherUrl.password = 'wi10-probe-disp';
    dispatcherPool = new pg.Pool({ connectionString: dispatcherUrl.toString(), max: 2 });
    targetEffects = [];
  });

  afterAll(async () => {
    await appPool.end();
    await dispatcherPool.end();
    await admin.end();
  });

  const deps = () => ({ db, repo, crypto, context });

  async function seedOutboxEvent(
    eventId: string,
    aggregateId: string,
    version: number,
    payload: unknown,
  ) {
    await withIdentityTransaction(db, context, async (trx) => {
      await trx
        .insertInto('identity_policy.outbox_event')
        .values({
          event_id: eventId,
          event_type: 'wi10.SourceEvent',
          event_version: '1.0',
          aggregate_type: 'Demo',
          aggregate_id: aggregateId,
          aggregate_version: String(version),
          enterprise_id: ENTERPRISE_A,
          correlation_id: CORRELATION,
          payload: JSON.stringify(payload),
          payload_hash: hashOf(payload),
          canonicalization_version: '1',
          occurred_at: new Date(),
          created_by_principal_id: OPERATOR,
          source_command_id: newUuidV7(),
        })
        .execute();
    });
  }

  it('claims events in same-aggregate version order and enforces lease/fencing', async () => {
    await seedOutboxEvent(EVENT_1, AGG_1, 1, payloadFor(ENTERPRISE_A, 'first'));
    // v2 for the same aggregate must not be claimed before v1 publishes.
    await seedOutboxEvent(EVENT_2, AGG_1, 2, payloadFor(ENTERPRISE_A, 'second'));

    const claimed = await claimOutboxEvents(dispatcherPool, {
      owner: 'wi10-dispatcher-a',
      aggregateIds: [AGG_1],
    });
    const firstBatch = claimed.map((event) => [event.aggregateVersion, event.eventId]);
    expect(firstBatch).toEqual([['1', EVENT_1]]);

    // A stale fencing token cannot confirm the publish.
    await expect(
      confirmPublished(dispatcherPool, { eventId: EVENT_1, leaseToken: '999' }),
    ).rejects.toBeInstanceOf(DispatcherError);

    // Publish timeout: same event id stays in UNKNOWN for retry.
    const token = claimed[0]?.leaseToken ?? '1';
    const unknown = await markDeliveryFailure(dispatcherPool, {
      eventId: EVENT_1,
      leaseToken: token,
      errorCode: 'TIMEOUT',
      attempt: 1,
      backoffBaseSeconds: 0,
    });
    expect(unknown).toBe('UNKNOWN');
    const row = await admin.query<{ delivery_state: string; event_id: string }>(
      `SELECT delivery_state, event_id::text FROM identity_policy.outbox_event WHERE event_id = $1`,
      [EVENT_1],
    );
    expect(row.rows[0]).toEqual({ delivery_state: 'UNKNOWN', event_id: EVENT_1 });

    // Retry with the same id succeeds and unlocks v2.
    const retry = await claimOutboxEvents(dispatcherPool, {
      owner: 'wi10-dispatcher-a',
      aggregateIds: [AGG_1],
    });
    expect(retry.map((e) => e.eventId)).toEqual([EVENT_1]);
    await confirmPublished(dispatcherPool, {
      eventId: EVENT_1,
      leaseToken: retry[0]?.leaseToken ?? '',
    });
    const second = await claimOutboxEvents(dispatcherPool, {
      owner: 'wi10-dispatcher-a',
      aggregateIds: [AGG_1],
    });
    expect(second.map((e) => e.eventId)).toEqual([EVENT_2]);
    await confirmPublished(dispatcherPool, {
      eventId: EVENT_2,
      leaseToken: second[0]?.leaseToken ?? '',
    });
  });

  it('processes, replays and quarantines inbox events without double effects (PG-E-004 / PG-U-011)', async () => {
    const payload = payloadFor(ENTERPRISE_A, 'inbox fixture');
    const contract = {
      consumerName: 'wi10-consumer',
      supportedMajors: ['1'],
      requiredExtensionKeys: ['note'],
    };

    const first = await consumeEvent(
      deps(),
      contract,
      {
        eventId: '40404040-4040-7404-8404-404040404001',
        eventType: 'wi10.SourceEvent',
        eventVersion: '1.0',
        payloadHash: hashOf(payload),
        sourceModule: 'identity_policy',
        payload,
        occurredAt: new Date(),
      },
      async (execution) => {
        targetEffects.push('40404040-4040-7404-8404-404040404001');
        await execution.appendOutbox({
          eventId: '40404040-4040-7404-8404-404040404009',
          eventType: 'wi10.TargetEvent',
          eventVersion: '1.0',
          aggregateType: 'DemoTarget',
          aggregateId: '40404040-4040-7404-8404-4040404040ff',
          aggregateVersion: '1',
          payload: { enterpriseId: ENTERPRISE_A, note: 'target effect' },
          occurredAt: new Date(),
        });
        return { kind: 'COMMITTED', resultPayload: { processed: true } };
      },
    );
    expect(first).toMatchObject({ status: 'PROCESSED' });
    expect(targetEffects).toHaveLength(1);

    // ACK-loss replay: the same event id + hash returns the saved result and
    // executes nothing again (transport never saw the first ACK).
    const before = await effectCounts();
    const replay = await consumeEvent(
      deps(),
      contract,
      {
        eventId: '40404040-4040-7404-8404-404040404001',
        eventType: 'wi10.SourceEvent',
        eventVersion: '1.0',
        payloadHash: hashOf(payload),
        sourceModule: 'identity_policy',
        payload,
        occurredAt: new Date(),
      },
      () => {
        targetEffects.push('must-not-run');
        return Promise.resolve({ kind: 'COMMITTED', resultPayload: {} });
      },
    );
    expect(replay).toMatchObject({ status: 'DUPLICATE' });
    const after = await effectCounts();
    expect(after).toEqual(before);
    expect(targetEffects).toHaveLength(1);

    // Same event id, different payload hash: quarantine, no execution, no
    // duplicate-success marking.
    const conflicting = await consumeEvent(
      deps(),
      contract,
      {
        eventId: '40404040-4040-7404-8404-404040404001',
        eventType: 'wi10.SourceEvent',
        eventVersion: '1.0',
        payloadHash: hashOf(payloadFor(ENTERPRISE_A, 'tampered')),
        sourceModule: 'identity_policy',
        payload: payloadFor(ENTERPRISE_A, 'tampered'),
        occurredAt: new Date(),
      },
      () => {
        targetEffects.push('must-not-run-conflict');
        return Promise.resolve({ kind: 'COMMITTED', resultPayload: {} });
      },
    );
    expect(conflicting).toMatchObject({ status: 'QUARANTINED' });
    expect(await effectCounts()).toEqual(before);
    const violation = await admin.query<{ violation_kind: string }>(
      `SELECT violation_kind FROM identity_policy.contract_violation WHERE source_event_id = $1`,
      ['40404040-4040-7404-8404-404040404001'],
    );
    expect(violation.rows[0]?.violation_kind).toBe('INBOX_HASH_CONFLICT');
  });

  it('quarantines unknown major / missing extension and rejects scope conflicts', async () => {
    const contract = {
      consumerName: 'wi10-consumer-2',
      supportedMajors: ['1'],
      requiredExtensionKeys: ['note'],
    };
    const base = {
      eventType: 'wi10.SourceEvent',
      sourceModule: 'identity_policy',
      occurredAt: new Date(),
    };

    const unknownMajor = await consumeEvent(
      deps(),
      contract,
      {
        ...base,
        eventId: '50505050-5050-7505-8505-505050505001',
        eventVersion: '9.0',
        payloadHash: hashOf(payloadFor(ENTERPRISE_A, 'x')),
        payload: payloadFor(ENTERPRISE_A, 'x'),
      },
      neverRuns,
    );
    expect(unknownMajor).toMatchObject({
      status: 'QUARANTINED',
      reason: 'INBOX_QUARANTINE_UNKNOWN_MAJOR',
    });

    const missingExtension = await consumeEvent(
      deps(),
      contract,
      {
        ...base,
        eventId: '50505050-5050-7505-8505-505050505002',
        eventVersion: '1.0',
        payloadHash: hashOf({ enterpriseId: ENTERPRISE_A }),
        payload: { enterpriseId: ENTERPRISE_A },
      },
      neverRuns,
    );
    expect(missingExtension).toMatchObject({
      status: 'QUARANTINED',
      reason: 'INBOX_QUARANTINE_MISSING_EXTENSION',
    });

    const scopeConflict = await consumeEvent(
      deps(),
      contract,
      {
        ...base,
        eventId: '50505050-5050-7505-8505-505050505003',
        eventVersion: '1.0',
        payloadHash: hashOf(payloadFor(ENTERPRISE_B, 'foreign scope')),
        payload: payloadFor(ENTERPRISE_B, 'foreign scope'),
      },
      neverRuns,
    );
    expect(scopeConflict).toMatchObject({ status: 'SCOPE_CONFLICT' });

    // None of the quarantined cases produced target effects or duplicates.
    const inboxRows = await admin.query<{ status: string }>(
      `SELECT status FROM identity_policy.inbox_message WHERE consumer_name = 'wi10-consumer-2'`,
    );
    expect(inboxRows.rows.map((r) => r.status)).toEqual([
      'QUARANTINED',
      'QUARANTINED',
      'QUARANTINED',
    ]);
    expect(targetEffects).toHaveLength(1);
  });

  it('rolls back the whole consumption on an injected fault and replays safely', async () => {
    const contract = {
      consumerName: 'wi10-consumer-3',
      supportedMajors: ['1'],
      requiredExtensionKeys: ['note'],
    };
    const event = {
      eventId: '60606060-6060-7606-8606-606060606001',
      eventType: 'wi10.SourceEvent',
      eventVersion: '1.0',
      payloadHash: hashOf(payloadFor(ENTERPRISE_A, 'fault fixture')),
      sourceModule: 'identity_policy',
      payload: payloadFor(ENTERPRISE_A, 'fault fixture'),
      occurredAt: new Date(),
    };
    await expect(
      consumeEvent(
        deps(),
        contract,
        event,
        async (execution) => {
          targetEffects.push('60606060-6060-7606-8606-606060606001');
          await execution.appendOutbox({
            eventId: '60606060-6060-7606-8606-606060606009',
            eventType: 'wi10.TargetEvent',
            eventVersion: '1.0',
            aggregateType: 'DemoTarget',
            aggregateId: '60606060-6060-7606-8606-6060606060ff',
            aggregateVersion: '1',
            payload: { enterpriseId: ENTERPRISE_A, note: 'fault target' },
            occurredAt: new Date(),
          });
          return { kind: 'COMMITTED', resultPayload: { processed: true } };
        },
        { faultAfterTarget: true },
      ),
    ).rejects.toThrow('INJECTED_FAULT_AFTER_TARGET');

    // Nothing survived: no inbox claim, no receipt, no target outbox.
    const inbox = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.inbox_message WHERE event_id = $1`,
      [event.eventId],
    );
    expect(inbox.rows[0]?.count).toBe('0');
    const receipt = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.command_receipt WHERE idempotency_key = $1`,
      [event.eventId],
    );
    expect(receipt.rows[0]?.count).toBe('0');
    const targetOutbox = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.outbox_event WHERE event_id = '60606060-6060-7606-8606-606060606009'`,
    );
    expect(targetOutbox.rows[0]?.count).toBe('0');

    // Safe replay after the fault: one business fact, exactly once.
    const replay = await consumeEvent(deps(), contract, event, async (execution) => {
      targetEffects.push('60606060-6060-7606-8606-606060606001-replay');
      await execution.appendOutbox({
        eventId: '60606060-6060-7606-8606-606060606009',
        eventType: 'wi10.TargetEvent',
        eventVersion: '1.0',
        aggregateType: 'DemoTarget',
        aggregateId: '60606060-6060-7606-8606-6060606060ff',
        aggregateVersion: '1',
        payload: { enterpriseId: ENTERPRISE_A, note: 'fault target' },
        occurredAt: new Date(),
      });
      return { kind: 'COMMITTED', resultPayload: { processed: true } };
    });
    expect(replay).toMatchObject({ status: 'PROCESSED' });
    const finalTarget = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.outbox_event WHERE event_id = '60606060-6060-7606-8606-606060606009'`,
    );
    expect(finalTarget.rows[0]?.count).toBe('1');
    expect(targetEffects.filter((e) => e.startsWith('60606060'))).toHaveLength(2);
  });

  it('resumes dead-letter events with an immutable audit record', async () => {
    await seedOutboxEvent(
      '70707070-7070-7707-8707-707070707001',
      AGG_2,
      1,
      payloadFor(ENTERPRISE_A, 'dead'),
    );
    const claimed = await claimOutboxEvents(dispatcherPool, {
      owner: 'wi10-dispatcher-b',
      aggregateIds: [AGG_2],
    });
    expect(claimed.map((e) => e.eventId)).toEqual(['70707070-7070-7707-8707-707070707001']);
    const dead = await markDeliveryFailure(dispatcherPool, {
      eventId: '70707070-7070-7707-8707-707070707001',
      leaseToken: claimed[0]?.leaseToken ?? '1',
      errorCode: 'TIMEOUT',
      attempt: 5,
    });
    expect(dead).toBe('DEAD');

    await resumeDeadLetterEvent(dispatcherPool, deps(), {
      eventId: '70707070-7070-7707-8707-707070707001',
      reason: 'wi10 manual resume fixture',
    });
    const resumed = await admin.query<{ delivery_state: string }>(
      `SELECT delivery_state FROM identity_policy.outbox_event WHERE event_id = $1`,
      ['70707070-7070-7707-8707-707070707001'],
    );
    expect(resumed.rows[0]?.delivery_state).toBe('PENDING');
    const audit = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.audit_record
       WHERE command_type = 'identity.internal.resume_dead_letter'`,
    );
    expect(Number(audit.rows[0]?.count)).toBeGreaterThanOrEqual(1);
  });

  it('keeps the dispatcher away from business payloads', async () => {
    const client = await dispatcherPool.connect();
    try {
      await expect(
        client.query(
          `UPDATE identity_policy.outbox_event SET payload = '{"tampered":true}' WHERE event_id = $1`,
          [EVENT_1],
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query(`INSERT INTO identity_policy.command_receipt DEFAULT VALUES`),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      client.release();
    }
  });

  function neverRuns(): Promise<never> {
    return Promise.reject(new Error('target must not run for quarantined events'));
  }

  async function effectCounts() {
    const receipts = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.command_receipt WHERE idempotency_scope = 'inbox:wi10-consumer'`,
    );
    const targets = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.outbox_event WHERE event_type = 'wi10.TargetEvent'`,
    );
    const inboxes = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.inbox_message WHERE consumer_name = 'wi10-consumer'`,
    );
    return {
      receipts: receipts.rows[0]?.count,
      targets: targets.rows[0]?.count,
      inboxes: inboxes.rows[0]?.count,
    };
  }
});
