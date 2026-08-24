// IM-02 WI-06 (issue #34) manual acceptance probe: one command, three
// probes — first commit, same key/hash replay, same key/different hash
// conflict — then exact row counts. Disposable local container only (see
// .vibe/im-02-workitem-issues/runbook-wi-06.md).

import { createHmac } from 'node:crypto';
import pg from 'pg';
import {
  CommandExecutionError,
  createIdentityPolicyDatabase,
  executeIdentityCommand,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  IdentityPolicyRepository,
  type IdentityCryptoPorts,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';

const databaseUrl = process.env.ZJU_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('ZJU_DATABASE_URL is required (disposable local container only)');
}

const ENTERPRISE = '17171717-1717-7171-8171-1717171717a1';
const OPERATOR = '4a4a4a4a-4a4a-74a4-84a4-4a4a4a4a4ae1';
const OPERATOR_ACTOR = '4b4b4b4b-4b4b-74b4-84b4-4b4b4b4b4bf1';
const DECISION = '4c4c4c4c-4c4c-74c4-84c4-4c4c4c4c4ca1';
const DECISION_HASH = Buffer.alloc(32, 0x31);
const CORRELATION = '4d4d4d4d-4d4d-74d4-84d4-4d4d4d4d4db1';
const PRINCIPAL = 'abababab-0000-7000-8000-000000000001';

const crypto: IdentityCryptoPorts = {
  lookupHash: {
    computeKeyedLookupHash(input: string) {
      return {
        hash: createHmac('sha256', Buffer.alloc(32, 0x64)).update(input, 'utf8').digest(),
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
const repo = new IdentityPolicyRepository(crypto);

const envelope = (commandId: string, payload: { op: string; displayName: string }) => ({
  commandId,
  commandType: 'wi06.manual.register',
  commandVersion: '1.0',
  idempotencyScope: 'wi06-manual',
  idempotencyKey: 'wi06-manual',
  requestPayload: payload,
  platform: true,
  enterpriseId: ENTERPRISE,
  targetType: 'Principal',
  targetId: PRINCIPAL,
  correlationId: CORRELATION,
  principalId: OPERATOR,
  actorSnapshotId: OPERATOR_ACTOR,
  authorizationDecisionId: DECISION,
});

const body = async (execution: Parameters<typeof executeIdentityCommand>[3]) => {
  await repo.insertPrincipal(execution.trx, {
    id: PRINCIPAL,
    principalKind: 'HUMAN',
    displayName: 'WI-06 Manual Fixture',
    createdByPrincipalId: OPERATOR,
    createdByActorSnapshotId: OPERATOR_ACTOR,
  });
  await execution.appendOutbox({
    eventId: 'abababab-0000-7000-8000-000000000002',
    eventType: 'wi06.PrincipalRegistered',
    eventVersion: '1.0',
    aggregateType: 'Principal',
    aggregateId: PRINCIPAL,
    aggregateVersion: '1',
    payload: { note: 'wi06 manual' },
    occurredAt: new Date(),
  });
  return { kind: 'COMMITTED' as const, resultPayload: { principalId: PRINCIPAL } };
};

try {
  const first = await executeIdentityCommand(
    db,
    context,
    envelope('abababab-0000-7000-8000-000000000010', {
      op: 'register',
      displayName: 'WI-06 Manual Fixture',
    }),
    body,
  );
  console.log('[1] first   →', first.status);

  const replay = await executeIdentityCommand(
    db,
    context,
    envelope('abababab-0000-7000-8000-000000000011', {
      op: 'register',
      displayName: 'WI-06 Manual Fixture',
    }),
    () => Promise.reject(new Error('must not re-execute')),
  );
  console.log(
    '[2] replay  →',
    replay.status,
    replay.status === 'DUPLICATE' ? `(originalOutcome=${replay.originalOutcome})` : '',
  );

  try {
    await executeIdentityCommand(
      db,
      context,
      envelope('abababab-0000-7000-8000-000000000012', {
        op: 'register',
        displayName: 'DIFFERENT PAYLOAD',
      }),
      body,
    );
    console.log('[3] conflict→ UNEXPECTED COMMIT');
  } catch (error) {
    const code = error instanceof CommandExecutionError ? error.code : 'UNKNOWN';
    console.log(
      '[3] conflict→',
      code,
      code === IDEMPOTENCY_PAYLOAD_CONFLICT ? '(no payload leak)' : '',
    );
  }

  const version = await pool.query<{ aggregate_version: string; status: string }>(
    `SELECT aggregate_version::text, status FROM identity_policy.principal WHERE id = $1`,
    [PRINCIPAL],
  );
  console.log('[verify] principal:', version.rows[0]);
  for (const [label, sql] of [
    [
      'receipt',
      `SELECT outcome, count(*) FROM identity_policy.platform_command_receipt WHERE idempotency_key = 'wi06-manual' GROUP BY outcome`,
    ],
    [
      'audit',
      `SELECT outcome, count(*) FROM identity_policy.platform_audit_record WHERE command_type = 'wi06.manual.register' GROUP BY outcome`,
    ],
    [
      'outbox',
      `SELECT count(*) FROM identity_policy.platform_outbox_event WHERE event_type = 'wi06.PrincipalRegistered'`,
    ],
  ] as const) {
    const result = await pool.query(sql);
    console.log(`[verify] ${label}:`, result.rows);
  }
} finally {
  await pool.end();
}
