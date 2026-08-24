import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  CommandExecutionError,
  COMMAND_CONTEXT_MISMATCH,
  COMMAND_TARGET_MISMATCH,
  CONCURRENCY_CONFLICT,
  executeIdentityCommand,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  PAYLOAD_HASH_MISMATCH,
  createIdentityPolicyDatabase,
  IdentityPolicyRepository,
  type CommandEnvelope,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import { createHmac } from 'node:crypto';
import type { IdentityCryptoPorts } from '@zhiju/identity-policy';

// IM-02 WI-06 (issue #34): the IdentityPolicy command transaction runner is
// proven on real PostgreSQL through a runtime-role pool: atomic
// claim→execute→audit→outbox→finalize, idempotent replay, payload-hash
// conflict, single-statement CAS concurrency, business rejection persistence
// and outbox-write fault rollback (PG-U-004/006/009/010/012).

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE_A = '17171717-1717-7171-8171-1717171717a1';
const ENTERPRISE_B = '28282828-2828-7282-8282-2828282828b2';
const PROJECT_A1 = '39393939-3939-7393-8393-3939393939c1';
const OPERATOR = '4a4a4a4a-4a4a-74a4-84a4-4a4a4a4a4ae1';
const OPERATOR_ACTOR = '4b4b4b4b-4b4b-74b4-84b4-4b4b4b4b4bf1';
const DECISION = '4c4c4c4c-4c4c-74c4-84c4-4c4c4c4c4ca1';
const DECISION_HASH = Buffer.alloc(32, 0x31);
const CORRELATION = '4d4d4d4d-4d4d-74d4-84d4-4d4d4d4d4db1';

const PRINCIPAL_A = '5e5e5e5e-5e5e-75e5-85e5-5e5e5e5e5ec1';
const PRINCIPAL_REJECT = '5e5e5e5e-5e5e-75e5-85e5-5e5e5e5e5ec2';
const PRINCIPAL_FAULT = '5e5e5e5e-5e5e-75e5-85e5-5e5e5e5e5ec3';
const PRINCIPAL_CONCURRENCY = '5e5e5e5e-5e5e-75e5-85e5-5e5e5e5e5ec4';
const PRINCIPAL_BIGINT = '5e5e5e5e-5e5e-75e5-85e5-5e5e5e5e5ec5';

function testCrypto(): IdentityCryptoPorts {
  const key = Buffer.alloc(32, 0x64);
  return {
    lookupHash: {
      computeKeyedLookupHash(input: string) {
        return {
          hash: createHmac('sha256', key).update(input, 'utf8').digest(),
          algorithm: 'HMAC-SHA-256' as const,
          keyVersion: 1,
        };
      },
    },
    fieldEncryption: {
      encryptField() {
        throw new Error('not needed in WI-06 tests');
      },
      decryptField() {
        throw new Error('not needed in WI-06 tests');
      },
    },
  };
}

function contextFor(enterpriseId: string): IdentityTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: OPERATOR,
    actorSnapshotId: OPERATOR_ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: DECISION_HASH,
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    enterpriseId,
    allowedProjectIds: enterpriseId === ENTERPRISE_A ? [PROJECT_A1] : [],
    correlationId: CORRELATION,
  };
}

function envelope(overrides: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    commandId: '6f6f6f6f-6f6f-76f6-86f6-6f6f6f6f6f01',
    commandType: 'wi06.demo.command',
    commandVersion: '1.0',
    idempotencyScope: 'wi06',
    idempotencyKey: 'wi06-key-1',
    requestPayload: { op: 'register', displayName: 'WI-06 Fixture' },
    platform: true,
    enterpriseId: ENTERPRISE_A,
    targetType: 'Principal',
    targetId: PRINCIPAL_A,
    correlationId: CORRELATION,
    principalId: OPERATOR,
    actorSnapshotId: OPERATOR_ACTOR,
    authorizationDecisionId: DECISION,
    ...overrides,
  };
}

describe.skipIf(!gateEnabled)('command transaction runner (real PostgreSQL)', () => {
  let admin: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createIdentityPolicyDatabase>;
  let repo: IdentityPolicyRepository;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE wi06_probe_ip LOGIN PASSWORD 'wi06-probe-ip' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(`GRANT platform_context_establisher, identity_policy_app TO wi06_probe_ip`);
    const url = new URL(databaseUrl ?? '');
    url.username = 'wi06_probe_ip';
    url.password = 'wi06-probe-ip';
    pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
    db = createIdentityPolicyDatabase(pool);
    repo = new IdentityPolicyRepository(testCrypto());
  });

  afterAll(async () => {
    await pool.end();
    await admin.end();
  });

  async function platformCount(
    table: 'platform_command_receipt' | 'platform_outbox_event' | 'platform_audit_record',
    where = '',
  ) {
    const result = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.${table} ${where}`,
    );
    return result.rows[0]?.count ?? '-1';
  }

  async function waitForBlockedProbeSession(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const blocked = await admin.query<{ count: string }>(
        `SELECT count(*) AS count
           FROM pg_stat_activity
          WHERE usename = 'wi06_probe_ip' AND wait_event_type = 'Lock'`,
      );
      if (Number(blocked.rows[0]?.count ?? '0') > 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('concurrent command did not reach the database claim lock');
  }

  it('applies the WI-06 platform receipt expansion as forward-only V1002', async () => {
    const history = await admin.query<{ description: string; success: boolean }>(
      `SELECT description, success FROM public.flyway_schema_history WHERE version = '1002'`,
    );
    expect(history.rows[0]).toEqual({
      description: 'platform command receipt expected version',
      success: true,
    });
    const column = await admin.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'identity_policy'
          AND table_name = 'platform_command_receipt'
          AND column_name = 'expected_aggregate_version'`,
    );
    expect(column.rows[0]?.data_type).toBe('bigint');
  });

  it('commits receipt, aggregate, audit and outbox atomically, then replays idempotently (PG-U-009)', async () => {
    const first = await executeIdentityCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope(),
      async (execution) => {
        await repo.insertPrincipal(execution.trx, {
          id: PRINCIPAL_A,
          principalKind: 'HUMAN',
          displayName: 'WI-06 Fixture',
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR,
        });
        await execution.appendOutbox({
          eventId: '70707070-7070-7707-8707-707070707001',
          eventType: 'identity.PrincipalRegistered',
          eventVersion: '1.0',
          aggregateType: 'Principal',
          aggregateId: PRINCIPAL_A,
          aggregateVersion: '1',
          payload: {
            principalRef: { objectType: 'Principal', objectId: PRINCIPAL_A },
            principalKind: 'HUMAN',
            status: 'ACTIVE',
          },
          occurredAt: new Date(),
        });
        return { kind: 'COMMITTED', resultPayload: { principalId: PRINCIPAL_A, status: 'ACTIVE' } };
      },
    );
    expect(first).toMatchObject({ status: 'COMMITTED' });

    const receipt = await admin.query<{ outcome: string; command_type: string }>(
      `SELECT outcome, command_type FROM identity_policy.platform_command_receipt
       WHERE idempotency_scope = 'wi06' AND idempotency_key = 'wi06-key-1'`,
    );
    expect(receipt.rows[0]).toMatchObject({
      outcome: 'COMMITTED',
      command_type: 'wi06.demo.command',
    });
    expect(
      await platformCount(
        'platform_outbox_event',
        "WHERE event_type = 'identity.PrincipalRegistered' AND aggregate_id = '5e5e5e5e-5e5e-75e5-85e5-5e5e5e5e5ec1'",
      ),
    ).toBe('1');
    expect(
      await platformCount(
        'platform_audit_record',
        "WHERE command_type = 'wi06.demo.command' AND outcome = 'COMMITTED'",
      ),
    ).toBe('1');

    // Replay with the same business key and identical request hash: the
    // saved result comes back; nothing executes a second time.
    const replay = await executeIdentityCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({ commandId: '6f6f6f6f-6f6f-76f6-86f6-6f6f6f6f6f02' }),
      () => Promise.reject(new Error('replay must not execute the body')),
    );
    expect(replay).toMatchObject({
      status: 'DUPLICATE',
      originalOutcome: 'COMMITTED',
      resultPayload: { principalId: PRINCIPAL_A, status: 'ACTIVE' },
    });
    const version = await admin.query<{ aggregate_version: string }>(
      `SELECT aggregate_version::text FROM identity_policy.principal WHERE id = $1`,
      [PRINCIPAL_A],
    );
    expect(version.rows[0]?.aggregate_version).toBe('1');
    expect(
      await platformCount(
        'platform_outbox_event',
        "WHERE aggregate_id = '5e5e5e5e-5e5e-75e5-85e5-5e5e5e5e5ec1'",
      ),
    ).toBe('1');
    expect(
      await platformCount('platform_command_receipt', "WHERE idempotency_key = 'wi06-key-1'"),
    ).toBe('1');
  });

  it('rejects the same key with a different request hash and audits the denial (PG-U-010)', async () => {
    const before = Number(await platformCount('platform_audit_record', "WHERE outcome = 'DENIED'"));
    let thrown: unknown;
    try {
      await executeIdentityCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: '6f6f6f6f-6f6f-76f6-86f6-6f6f6f6f6f03',
          requestPayload: { op: 'register', displayName: 'TAMPERED DIFFERENT PAYLOAD' },
        }),
        () => Promise.resolve({ kind: 'COMMITTED', resultPayload: { never: true } }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CommandExecutionError);
    expect((thrown as CommandExecutionError).code).toBe(IDEMPOTENCY_PAYLOAD_CONFLICT);
    expect((thrown as CommandExecutionError).message).not.toContain('TAMPERED');

    const after = Number(await platformCount('platform_audit_record', "WHERE outcome = 'DENIED'"));
    expect(after).toBe(before + 1);
    const denial = await admin.query<{ error_code: string | null; command_id: string | null }>(
      `SELECT error_code, command_id::text FROM identity_policy.platform_audit_record
       WHERE outcome = 'DENIED' ORDER BY recorded_at DESC LIMIT 1`,
    );
    expect(denial.rows[0]?.error_code).toBe(IDEMPOTENCY_PAYLOAD_CONFLICT);
    // The denial audit refers to the conflicting attempt, not the original.
    expect(denial.rows[0]?.command_id).toBe('6f6f6f6f-6f6f-76f6-86f6-6f6f6f6f6f03');

    // The original receipt is untouched: still the one COMMITTED claim.
    expect(
      await platformCount('platform_command_receipt', "WHERE idempotency_key = 'wi06-key-1'"),
    ).toBe('1');
  });

  it('returns the saved result for concurrent same-key/same-hash claims (PG-U-009)', async () => {
    let bodyExecutions = 0;
    let signalBodyStarted: (() => void) | undefined;
    let releaseBody: (() => void) | undefined;
    const bodyStarted = new Promise<void>((resolve) => {
      signalBodyStarted = resolve;
    });
    const bodyHold = new Promise<void>((resolve) => {
      releaseBody = resolve;
    });
    const first = executeIdentityCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: '6f6f6f6f-6f6f-76f6-86f6-6f6f6f6f6f11',
        idempotencyKey: 'wi06-concurrent-idempotency',
        commandType: 'wi06.concurrent-idempotency',
        requestPayload: { op: 'concurrent-idempotency' },
      }),
      async () => {
        bodyExecutions += 1;
        signalBodyStarted?.();
        await bodyHold;
        return { kind: 'COMMITTED', resultPayload: { winner: true } };
      },
    );
    await bodyStarted;

    const second = executeIdentityCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: '6f6f6f6f-6f6f-76f6-86f6-6f6f6f6f6f12',
        idempotencyKey: 'wi06-concurrent-idempotency',
        commandType: 'wi06.concurrent-idempotency',
        requestPayload: { op: 'concurrent-idempotency' },
      }),
      () => {
        bodyExecutions += 1;
        return Promise.resolve({
          kind: 'COMMITTED' as const,
          resultPayload: { winner: false },
        });
      },
    );

    try {
      await waitForBlockedProbeSession();
    } finally {
      releaseBody?.();
    }
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.status).sort()).toEqual(['COMMITTED', 'DUPLICATE']);
    expect(results.find((result) => result.status === 'DUPLICATE')).toMatchObject({
      originalOutcome: 'COMMITTED',
      resultPayload: { winner: true },
    });
    expect(bodyExecutions).toBe(1);
    expect(
      await platformCount(
        'platform_command_receipt',
        "WHERE idempotency_key = 'wi06-concurrent-idempotency'",
      ),
    ).toBe('1');
  });

  it('rejects envelope attribution that differs from the trusted transaction context', async () => {
    const mismatches: Partial<CommandEnvelope>[] = [
      { principalId: '00000000-0000-7000-8000-000000000101' },
      { actorSnapshotId: '00000000-0000-7000-8000-000000000102' },
      { authorizationDecisionId: '00000000-0000-7000-8000-000000000103' },
      { enterpriseId: ENTERPRISE_B },
      { projectId: '00000000-0000-7000-8000-000000000104' },
      { correlationId: '00000000-0000-7000-8000-000000000105' },
    ];
    for (const [index, mismatch] of mismatches.entries()) {
      await expect(
        executeIdentityCommand(
          db,
          contextFor(ENTERPRISE_A),
          envelope({
            commandId: `80808080-8080-7080-8080-80808080810${index}`,
            idempotencyKey: `wi06-context-mismatch-${index}`,
            commandType: 'wi06.context-mismatch',
            ...mismatch,
          }),
          () => Promise.resolve({ kind: 'COMMITTED', resultPayload: { invalid: true } }),
        ),
      ).rejects.toMatchObject({ code: COMMAND_CONTEXT_MISMATCH });
    }
    expect(
      await platformCount(
        'platform_command_receipt',
        "WHERE command_type = 'wi06.context-mismatch'",
      ),
    ).toBe('0');
    expect(
      await platformCount('platform_audit_record', "WHERE command_type = 'wi06.context-mismatch'"),
    ).toBe('0');
  });

  it('adjudicates concurrent same-version CAS with one winner and a stable conflict (PG-U-004)', async () => {
    await executeIdentityCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: '71717171-7171-7717-8717-717171717101',
        idempotencyKey: 'wi06-cas-setup',
        targetId: PRINCIPAL_CONCURRENCY,
        requestPayload: { op: 'register', target: 'concurrency' },
      }),
      async (execution) => {
        await repo.insertPrincipal(execution.trx, {
          id: PRINCIPAL_CONCURRENCY,
          principalKind: 'SERVICE',
          displayName: 'WI-06 CAS Fixture',
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR,
        });
        return { kind: 'COMMITTED', resultPayload: { principalId: PRINCIPAL_CONCURRENCY } };
      },
    );

    const runSuspension = (key: string) =>
      executeIdentityCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: `71717171-7171-7717-8717-7171717171${key === 'a' ? '02' : '03'}`,
          idempotencyKey: key,
          commandType: 'wi06.suspend',
          targetId: PRINCIPAL_CONCURRENCY,
          expectedAggregateVersion: '1',
          requestPayload: { op: 'suspend' },
        }),
        async (execution) => {
          const outcome = await execution.casPrincipalStatus(PRINCIPAL_CONCURRENCY, '1', {
            status: 'SUSPENDED',
          });
          if (outcome === 'CONFLICT') {
            throw new CommandExecutionError(CONCURRENCY_CONFLICT, 'aggregate moved on');
          }
          if (outcome === 'NOT_FOUND') {
            throw new CommandExecutionError('NOT_FOUND', 'aggregate not visible');
          }
          await execution.appendOutbox({
            eventId: `72727272-7272-7727-8727-7272727271${key === 'a' ? '01' : '02'}`,
            eventType: 'wi06.PrincipalSuspended',
            eventVersion: '1.0',
            aggregateType: 'Principal',
            aggregateId: PRINCIPAL_CONCURRENCY,
            aggregateVersion: '2',
            payload: { note: key },
            occurredAt: new Date(),
          });
          return { kind: 'COMMITTED', resultPayload: { suspended: true, attempt: key } };
        },
      );

    const [a, b] = await Promise.allSettled([runSuspension('a'), runSuspension('b')]);
    const results = [a, b];
    const committed = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === 'COMMITTED',
    );
    const conflicted = results.filter(
      (r) =>
        r.status === 'rejected' &&
        (r.reason as CommandExecutionError).code === CONCURRENCY_CONFLICT,
    );
    expect(committed).toHaveLength(1);
    expect(conflicted).toHaveLength(1);

    const principal = await admin.query<{ aggregate_version: string; status: string }>(
      `SELECT aggregate_version::text, status FROM identity_policy.principal WHERE id = $1`,
      [PRINCIPAL_CONCURRENCY],
    );
    expect(principal.rows[0]).toEqual({ aggregate_version: '2', status: 'SUSPENDED' });
    // The loser leaves no half-finished receipt; only one suspension event.
    expect(
      await platformCount('platform_command_receipt', "WHERE command_type = 'wi06.suspend'"),
    ).toBe('1');
    expect(
      await platformCount('platform_outbox_event', "WHERE event_type = 'wi06.PrincipalSuspended'"),
    ).toBe('1');
  });

  it('binds CAS to the envelope and increments bigint versions without precision loss', async () => {
    await executeIdentityCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: '81818181-8181-7181-8181-818181818101',
        idempotencyKey: 'wi06-bigint-setup',
        targetId: PRINCIPAL_BIGINT,
        requestPayload: { op: 'bigint-setup' },
      }),
      async (execution) => {
        await repo.insertPrincipal(execution.trx, {
          id: PRINCIPAL_BIGINT,
          principalKind: 'SERVICE',
          displayName: 'WI-06 Bigint Fixture',
          createdByPrincipalId: OPERATOR,
          createdByActorSnapshotId: OPERATOR_ACTOR,
        });
        return { kind: 'COMMITTED', resultPayload: { principalId: PRINCIPAL_BIGINT } };
      },
    );
    await admin.query(
      `UPDATE identity_policy.principal SET aggregate_version = 9007199254740993 WHERE id = $1`,
      [PRINCIPAL_BIGINT],
    );

    const mismatchedCasArguments = [
      [PRINCIPAL_A, '9007199254740993'],
      [PRINCIPAL_BIGINT, '9007199254740992'],
    ] as const satisfies readonly (readonly [string, string])[];
    for (const [index, [targetId, expectedVersion]] of mismatchedCasArguments.entries()) {
      await expect(
        executeIdentityCommand(
          db,
          contextFor(ENTERPRISE_A),
          envelope({
            commandId: `81818181-8181-7181-8181-81818181811${index}`,
            idempotencyKey: `wi06-cas-envelope-mismatch-${index}`,
            commandType: 'wi06.cas-envelope-mismatch',
            targetId: PRINCIPAL_BIGINT,
            expectedAggregateVersion: '9007199254740993',
            requestPayload: { op: 'cas-envelope-mismatch', index },
          }),
          async (execution) => {
            await execution.casPrincipalStatus(targetId, expectedVersion, {
              status: 'SUSPENDED',
            });
            return { kind: 'COMMITTED', resultPayload: { invalid: true } };
          },
        ),
      ).rejects.toMatchObject({ code: COMMAND_TARGET_MISMATCH });
    }

    const committed = await executeIdentityCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: '81818181-8181-7181-8181-818181818121',
        idempotencyKey: 'wi06-bigint-cas',
        commandType: 'wi06.bigint-cas',
        targetId: PRINCIPAL_BIGINT,
        expectedAggregateVersion: '9007199254740993',
        requestPayload: { op: 'bigint-cas' },
      }),
      async (execution) => {
        const cas = await execution.casPrincipalStatus(PRINCIPAL_BIGINT, '9007199254740993', {
          status: 'SUSPENDED',
        });
        return { kind: 'COMMITTED', resultPayload: { cas } };
      },
    );
    expect(committed).toMatchObject({ status: 'COMMITTED', resultPayload: { cas: 'OK' } });
    const version = await admin.query<{ aggregate_version: string }>(
      `SELECT aggregate_version::text FROM identity_policy.principal WHERE id = $1`,
      [PRINCIPAL_BIGINT],
    );
    expect(version.rows[0]?.aggregate_version).toBe('9007199254740994');
  });

  it('rolls back receipt, aggregate, audit and outbox when a fault hits after the outbox write (PG-U-012)', async () => {
    await expect(
      executeIdentityCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: '73737373-7373-7737-8737-737373737301',
          idempotencyKey: 'wi06-fault',
          targetId: PRINCIPAL_FAULT,
          requestPayload: { op: 'register-fault' },
        }),
        async (execution) => {
          await repo.insertPrincipal(execution.trx, {
            id: PRINCIPAL_FAULT,
            principalKind: 'AGENT',
            displayName: 'WI-06 Fault Fixture',
            createdByPrincipalId: OPERATOR,
            createdByActorSnapshotId: OPERATOR_ACTOR,
          });
          await execution.trx
            .insertInto('identity_policy.reference_edge')
            .values({
              owner_object_type: 'Principal',
              owner_object_id: PRINCIPAL_FAULT,
              reference_path: '/fixtureRef',
              target_module: 'IdentityPolicy',
              target_object_type: 'Principal',
              target_object_id: PRINCIPAL_A,
              reference_purpose: 'WI06_FAULT_PROBE',
              enterprise_id: ENTERPRISE_A,
              project_id: null,
              source_command_id: '73737373-7373-7737-8737-737373737301',
            })
            .execute();
          await execution.appendOutbox({
            eventId: '74747474-7474-7747-8747-747474747401',
            eventType: 'identity.PrincipalRegistered',
            eventVersion: '1.0',
            aggregateType: 'Principal',
            aggregateId: PRINCIPAL_FAULT,
            aggregateVersion: '1',
            payload: { note: 'fault' },
            occurredAt: new Date(),
          });
          execution.failAfterOutbox();
          // unreachable: failAfterOutbox never returns
          return { kind: 'COMMITTED', resultPayload: {} };
        },
      ),
    ).rejects.toMatchObject({ code: 'INJECTED_FAULT' });

    const principal = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.principal WHERE id = $1`,
      [PRINCIPAL_FAULT],
    );
    expect(principal.rows[0]?.count).toBe('0');
    expect(
      await platformCount('platform_command_receipt', "WHERE idempotency_key = 'wi06-fault'"),
    ).toBe('0');
    expect(
      await platformCount(
        'platform_audit_record',
        "WHERE command_id = '73737373-7373-7737-8737-737373737301'",
      ),
    ).toBe('0');
    const references = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.reference_edge
        WHERE source_command_id = '73737373-7373-7737-8737-737373737301'`,
    );
    expect(references.rows[0]?.count).toBe('0');
    expect(
      await platformCount(
        'platform_outbox_event',
        "WHERE event_id = '74747474-7474-7747-8747-747474747401'",
      ),
    ).toBe('0');
  });

  it('persists a stable REJECTED receipt without touching the aggregate, and replays it', async () => {
    const rejected = await executeIdentityCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: '75757575-7575-7757-8757-757575757501',
        idempotencyKey: 'wi06-reject',
        commandType: 'wi06.reject-demo',
        targetId: PRINCIPAL_REJECT,
        requestPayload: { op: 'invalid-transition' },
      }),
      async (execution) => {
        const current = await repo.getPrincipalById(execution.trx, PRINCIPAL_A);
        return {
          kind: 'REJECTED',
          errorCode: 'WI06_INVALID_TRANSITION',
          safeSummary: 'status transition not allowed',
          currentAggregateVersion: current?.aggregate_version ?? undefined,
        } as const;
      },
    );
    expect(rejected).toMatchObject({ status: 'REJECTED', errorCode: 'WI06_INVALID_TRANSITION' });

    const receipt = await admin.query<{ outcome: string; result_payload: unknown }>(
      `SELECT outcome, result_payload FROM identity_policy.platform_command_receipt WHERE idempotency_key = 'wi06-reject'`,
    );
    expect(receipt.rows[0]?.outcome).toBe('REJECTED');
    expect(receipt.rows[0]?.result_payload).toMatchObject({
      errorCode: 'WI06_INVALID_TRANSITION',
      currentAggregateVersion: '1',
    });
    expect(rejected).toMatchObject({ currentAggregateVersion: '1' });
    const audits = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.platform_audit_record
       WHERE outcome = 'REJECTED' AND error_code = 'WI06_INVALID_TRANSITION'`,
    );
    expect(audits.rows[0]?.count).toBe('1');

    const replay = await executeIdentityCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: '75757575-7575-7757-8757-757575757502',
        idempotencyKey: 'wi06-reject',
        commandType: 'wi06.reject-demo',
        targetId: PRINCIPAL_REJECT,
        requestPayload: { op: 'invalid-transition' },
      }),
      () => Promise.reject(new Error('rejected replay must not execute the body')),
    );
    expect(replay).toMatchObject({
      status: 'DUPLICATE',
      originalOutcome: 'REJECTED',
      errorCode: 'WI06_INVALID_TRANSITION',
      resultPayload: { currentAggregateVersion: '1' },
    });
  });

  it('returns NOT_FOUND for invisible aggregates and rejects hash/scope mismatches before writing', async () => {
    // NOT_FOUND: safe unified semantics for an aggregate outside the context.
    const notFound = await executeIdentityCommand(
      db,
      contextFor(ENTERPRISE_B),
      envelope({
        commandId: '76767676-7676-7776-8776-767676767601',
        idempotencyKey: 'wi06-notfound',
        commandType: 'wi06.suspend-missing',
        enterpriseId: ENTERPRISE_B,
        targetId: '00000000-0000-7000-8000-00000000de01',
        expectedAggregateVersion: '1',
        requestPayload: { op: 'suspend-missing' },
      }),
      async (execution) => {
        const outcome = await execution.casPrincipalStatus(
          '00000000-0000-7000-8000-00000000de01',
          '1',
          { status: 'SUSPENDED' },
        );
        return {
          kind: 'REJECTED',
          errorCode: outcome === 'NOT_FOUND' ? 'NOT_FOUND' : 'UNEXPECTED',
          safeSummary: `cas outcome ${outcome}`,
        } as const;
      },
    );
    expect(notFound).toMatchObject({ status: 'REJECTED', errorCode: 'NOT_FOUND' });

    // Declared event hash disagrees with the canonical payload: the whole
    // transaction is refused (PG-U-006), nothing is written.
    await expect(
      executeIdentityCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: '76767676-7676-7776-8776-767676767602',
          idempotencyKey: 'wi06-hash-mismatch',
          commandType: 'wi06.hash-mismatch',
          requestPayload: { op: 'hash-mismatch' },
        }),
        async (execution) => {
          await execution.appendOutbox({
            eventId: '77777777-7777-7777-8777-777777777701',
            eventType: 'wi06.BadEvent',
            eventVersion: '1.0',
            aggregateType: 'Principal',
            aggregateId: PRINCIPAL_A,
            aggregateVersion: '1',
            payload: { note: 'will-not-match' },
            declaredHash: Buffer.alloc(32, 0xff),
            occurredAt: new Date(),
          });
          return { kind: 'COMMITTED', resultPayload: {} };
        },
      ),
    ).rejects.toMatchObject({ code: PAYLOAD_HASH_MISMATCH });
    expect(await platformCount('platform_outbox_event', "WHERE event_type = 'wi06.BadEvent'")).toBe(
      '0',
    );
    expect(
      await platformCount(
        'platform_command_receipt',
        "WHERE idempotency_key = 'wi06-hash-mismatch'",
      ),
    ).toBe('0');

    // Enterprise events must embed their promoted scope exactly.
    await expect(
      executeIdentityCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: '76767676-7676-7776-8776-767676767603',
          idempotencyKey: 'wi06-scope-mirror',
          commandType: 'wi06.scope-mirror',
          platform: false,
          requestPayload: { op: 'scope-mirror' },
        }),
        async (execution) => {
          await execution.appendOutbox({
            eventId: '77777777-7777-7777-8777-777777777702',
            eventType: 'wi06.ScopeEvent',
            eventVersion: '1.0',
            aggregateType: 'Demo',
            aggregateId: PRINCIPAL_A,
            aggregateVersion: '1',
            payload: { note: 'missing scope mirror' },
            occurredAt: new Date(),
          });
          return { kind: 'COMMITTED', resultPayload: {} };
        },
      ),
    ).rejects.toMatchObject({ code: PAYLOAD_HASH_MISMATCH });
    expect(
      await admin
        .query<{ count: string }>(
          `SELECT count(*) AS count FROM identity_policy.outbox_event WHERE event_type = 'wi06.ScopeEvent'`,
        )
        .then((r) => r.rows[0]?.count),
    ).toBe('0');
  });

  it('routes enterprise commands to the enterprise technical tables', async () => {
    const result = await executeIdentityCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: '78787878-7878-7878-8878-787878787801'.replace('78787878', '79797979'),
        idempotencyKey: 'wi06-enterprise',
        commandType: 'wi06.enterprise-demo',
        platform: false,
        requestPayload: { op: 'enterprise-demo' },
      }),
      async (execution) => {
        await execution.appendOutbox({
          eventId: '7a7a7a7a-7a7a-77a7-87a7-7a7a7a7a7a01',
          eventType: 'wi06.EnterpriseEvent',
          eventVersion: '1.0',
          aggregateType: 'Demo',
          aggregateId: PRINCIPAL_A,
          aggregateVersion: '1',
          payload: { enterpriseId: ENTERPRISE_A, note: 'enterprise routed' },
          occurredAt: new Date(),
        });
        return { kind: 'COMMITTED', resultPayload: { routed: 'enterprise' } };
      },
    );
    expect(result).toMatchObject({ status: 'COMMITTED' });

    const receipt = await admin.query<{ outcome: string }>(
      `SELECT outcome FROM identity_policy.command_receipt WHERE idempotency_key = 'wi06-enterprise'`,
    );
    expect(receipt.rows[0]?.outcome).toBe('COMMITTED');
    const audit = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM identity_policy.audit_record
       WHERE command_type = 'wi06.enterprise-demo' AND outcome = 'COMMITTED'`,
    );
    expect(audit.rows[0]?.count).toBe('1');
  });
});
