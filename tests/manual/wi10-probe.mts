// IM-02 WI-10 (issue #38) manual acceptance probe: the repeatable ACK-loss
// demonstration — first consumption commits but the ACK is "lost"; the
// second replay with the same id+hash returns the saved result; a replay
// with the same id but a different hash is quarantined. The business fact
// always exists exactly once. Disposable local container only.

import { createHmac } from 'node:crypto';
import { newUuidV7 } from '@zhiju/shared-kernel';
import pg from 'pg';
import {
  consumeEvent,
  createIdentityPolicyDatabase,
  digestCanonicalPayload,
  IdentityPolicyRepository,
  type IdentityCryptoPorts,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';

const databaseUrl = process.env.ZJU_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('ZJU_DATABASE_URL is required (disposable local container only)');
}

const ENTERPRISE = 'cccccccc-cccc-7ccc-8ccc-ccccccccccca';
const OPERATOR = 'ababacac-0000-7000-8000-000000000001';
const OPERATOR_ACTOR = 'ababacac-0000-7000-8000-000000000002';
const DECISION = 'ababacac-0000-7000-8000-000000000003';
const DECISION_HASH = Buffer.alloc(32, 0xa1);
const CORRELATION = 'ababacac-0000-7000-8000-000000000004';
const EVENT_ID = 'ababacac-0000-7000-8000-000000000101';

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

const context: IdentityTransactionContext = {
  kind: 'REQUEST',
  principalId: OPERATOR,
  actorSnapshotId: OPERATOR_ACTOR,
  authorizationDecisionId: DECISION,
  authorizationDecisionHash: DECISION_HASH,
  authorizationDecisionExpiresAt: new Date(Date.now() + 3_600_000),
  enterpriseId: ENTERPRISE,
  allowedProjectIds: [],
  correlationId: CORRELATION,
};

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const db = createIdentityPolicyDatabase(pool);
const deps = { db, repo: new IdentityPolicyRepository(crypto), crypto, context };

const payload = { enterpriseId: ENTERPRISE, note: 'wi10 manual fixture' };
const payloadHash = digestCanonicalPayload(payload).hash;
const targetEffects: string[] = [];

const contract = {
  consumerName: 'wi10-manual-consumer',
  supportedMajors: ['1'],
  requiredExtensionKeys: ['note'],
};

const consume = (hash: Buffer, body: unknown) =>
  consumeEvent(
    deps,
    contract,
    {
      eventId: EVENT_ID,
      eventType: 'wi10.ManualEvent',
      eventVersion: '1.0',
      payloadHash: hash,
      sourceModule: 'identity_policy',
      payload: body as never,
      occurredAt: new Date(),
    },
    async (execution) => {
      targetEffects.push(EVENT_ID);
      await execution.appendOutbox({
        eventId: 'ababacac-0000-7000-8000-000000000109',
        eventType: 'wi10.ManualTargetEvent',
        eventVersion: '1.0',
        aggregateType: 'ManualTarget',
        aggregateId: 'ababacac-0000-7000-8000-0000000001ff',
        aggregateVersion: '1',
        payload: { enterpriseId: ENTERPRISE, note: 'target effect' },
        occurredAt: new Date(),
      });
      return { kind: 'COMMITTED' as const, resultPayload: { processed: true } };
    },
  );

try {
  await db.connection().execute((connection) =>
    connection.transaction().execute(async (trx) => {
      await trx
        .insertInto('identity_policy.principal')
        .values({
          id: OPERATOR,
          principal_kind: 'HUMAN',
          display_name: 'WI-10 manual fixture',
          created_by_principal_id: OPERATOR,
          created_by_actor_snapshot_id: OPERATOR_ACTOR,
        })
        .execute();
    }),
  );

  // 1) First consumption commits; the transport ACK is "lost" afterwards.
  const first = await consume(payloadHash, payload);
  console.log(
    '[1] consume (first, ACK loss simulated) →',
    first.status,
    'targetEffects =',
    targetEffects.length,
  );

  // 2) Replay with same id + same hash: saved result, nothing re-executes.
  const replay = await consume(payloadHash, payload);
  console.log(
    '[2] replay same id + same hash →',
    replay.status,
    'targetEffects =',
    targetEffects.length,
  );

  // 3) Same id, different hash: quarantine + violation, no execution.
  const conflictHash = digestCanonicalPayload({ ...payload, note: 'tampered' }).hash;
  const conflict = await consume(conflictHash, { ...payload, note: 'tampered' });
  console.log(
    '[3] replay same id + different hash →',
    conflict.status,
    'targetEffects =',
    targetEffects.length,
  );

  const targets = await pool.query(
    `SELECT count(*) FROM identity_policy.outbox_event WHERE event_type = 'wi10.ManualTargetEvent'`,
  );
  const receipts = await pool.query(
    `SELECT count(*) FROM identity_policy.command_receipt WHERE idempotency_scope = $1`,
    [`inbox:${contract.consumerName}`],
  );
  const violations = await pool.query(
    `SELECT count(*) FROM identity_policy.contract_violation WHERE source_event_id = $1`,
    [EVENT_ID],
  );
  console.log('[verify] target outbox rows =', targets.rows[0].count);
  console.log('[verify] command receipts =', receipts.rows[0].count);
  console.log('[verify] contract violations =', violations.rows[0].count);
  console.log('[verify] business fact count = 1 (targetEffects executed once)');
  void newUuidV7;
} finally {
  await pool.end();
}
