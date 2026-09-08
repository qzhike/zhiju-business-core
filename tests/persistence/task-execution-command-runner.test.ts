import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  CommandExecutionError,
  COMMAND_CONTEXT_MISMATCH,
  COMMAND_TARGET_MISMATCH,
  CONCURRENCY_CONFLICT,
  createTaskExecutionDatabase,
  executeTaskExecutionCommand,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  PAYLOAD_HASH_MISMATCH,
  TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH,
  TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
  type CommandBodyResult,
  type CommandEnvelope,
  type CommandExecution,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';

type CommandBody = (execution: CommandExecution) => Promise<CommandBodyResult>;

// IM-06 WI-01 (issue #151): TaskExecution application/persistence foundation
// on real PostgreSQL. No Task/WorkOrder/Run business tables are touched; CAS
// uses the existing process_instance technical aggregate. Each scenario
// targets one of the issue's nine acceptance bullets.

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE_A = 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a1a1';
const ENTERPRISE_B = 'b2b2b2b2-b2b2-72b2-82b2-b2b2b2b2b2b2';
const PROJECT_A1 = 'c1c1c1c1-c1c1-71c1-81c1-c1c1c1c1c1c1';
const PROJECT_A2 = 'c2c2c2c2-c2c2-72c2-82c2-c2c2c2c2c2c2';
const OPERATOR = 'd1d1d1d1-d1d1-71d1-81d1-d1d1d1d1d1d1';
const OPERATOR_ACTOR = 'd2d2d2d2-d2d2-72d2-82d2-d2d2d2d2d2d2';
const DECISION = 'd3d3d3d3-d3d3-73d3-83d3-d3d3d3d3d3d3';
const POLICY = 'd4d4d4d4-d4d4-74d4-84d4-d4d4d4d4d4d4';
const DECISION_HASH = Buffer.alloc(32, 0x42);
const CORRELATION = 'd5d5d5d5-d5d5-75d5-85d5-d5d5d5d5d5d5';

const PROCESS_A = 'e1e1e1e1-e1e1-71e1-81e1-e1e1e1e1e1e1';
const PROCESS_REJECT = 'e2e2e2e2-e2e2-72e2-82e2-e2e2e2e2e2e2';
const PROCESS_FAULT = 'e3e3e3e3-e3e3-73e3-83e3-e3e3e3e3e3e3';
const PROCESS_CONCURRENCY = 'e4e4e4e4-e4e4-74e4-84e4-e4e4e4e4e4e4';
const PROCESS_BIGINT = 'e5e5e5e5-e5e5-75e5-85e5-e5e5e5e5e5e5';
const PROCESS_PROJECT = 'e6e6e6e6-e6e6-76e6-86e6-e6e6e6e6e6e6';
const PROCESS_CAS_SCOPE = 'eb0b0b0b-eb0b-7eb0-8eb0-eb0beb0beb0b';
const PROCESS_PRINCIPAL = 'ea0a0a0a-ea0a-7ea0-8ea0-ea0aea0aea0a';
const PROCESS_INSERT_PROJECT_A = 'ec0c0c0c-ec0c-7ec0-8ec0-ec0cec0cec0c';
const PROCESS_INSERT_PROJECT_B = 'ed0d0d0d-ed0d-7ed0-8ed0-ed0ded0ded0d';
const PROCESS_INSERT_PROCESS_ID = 'ee0e0e0e-ee0e-7ee0-8ee0-ee0eee0eee0e';
const PROCESS_INSERT_TARGET_TYPE = 'ef0f0f0f-ef0f-7ef0-8ef0-ef0fef0fef0f';
const PROCESS_INSERT_TAMPER = 'f0f0f0f1-f0f0-7ef0-8ef0-ef0fef0fef0f';

function contextFor(
  enterpriseId: string,
  allowedProjectIds: readonly string[] = [],
  overrides: Partial<TaskExecutionTransactionContext> = {},
): TaskExecutionTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: OPERATOR,
    principalKind: 'HUMAN',
    actorSnapshotId: OPERATOR_ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: DECISION_HASH,
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY,
    enterpriseId,
    allowedProjectIds,
    correlationId: CORRELATION,
    ...overrides,
  };
}

function envelope(overrides: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    commandId: 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f101',
    commandType: 'wi01.demo.command',
    commandVersion: '1.0',
    idempotencyScope: 'wi01',
    idempotencyKey: 'wi01-key-1',
    requestPayload: { op: 'register', note: 'IM-06 WI-01 Fixture' },
    enterpriseId: ENTERPRISE_A,
    targetType: 'ProcessInstance',
    targetId: PROCESS_A,
    correlationId: CORRELATION,
    principalId: OPERATOR,
    principalKind: 'HUMAN',
    actorSnapshotId: OPERATOR_ACTOR,
    authorizationDecisionId: DECISION,
    policySnapshotId: POLICY,
    ...overrides,
  };
}

function processInsert(
  processId: string,
  projectId?: string,
  enterpriseId = ENTERPRISE_A,
  createdByPrincipalId = OPERATOR,
) {
  return {
    processId,
    processType: 'wi01.demo',
    processVersion: '1.0',
    correlationKey: `wi01:${processId}`,
    enterpriseId,
    ...(projectId === undefined ? {} : { projectId }),
    createdByPrincipalId,
  };
}

describe.skipIf(!gateEnabled)('TaskExecution command transaction runner (real PostgreSQL)', () => {
  let admin: pg.Client;
  let probe: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createTaskExecutionDatabase>;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE im06_wi01_probe LOGIN PASSWORD 'im06-wi01-probe' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(`GRANT platform_context_establisher, task_execution_app TO im06_wi01_probe`);
    const url = new URL(databaseUrl ?? '');
    url.username = 'im06_wi01_probe';
    url.password = 'im06-wi01-probe';
    probe = new pg.Client({ connectionString: url.toString() });
    await probe.connect();
    pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
    db = createTaskExecutionDatabase(pool);
  });

  afterAll(async () => {
    await probe.end();
    await pool.end();
    await admin.end();
  });

  async function count(table: string, where = ''): Promise<string> {
    const result = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM task_execution.${table} ${where}`,
    );
    return result.rows[0]?.count ?? '-1';
  }

  async function waitForBlockedProbeSession(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const blocked = await admin.query<{ count: string }>(
        `SELECT count(*) AS count
           FROM pg_stat_activity
          WHERE usename = 'im06_wi01_probe' AND wait_event_type = 'Lock'`,
      );
      if (Number(blocked.rows[0]?.count ?? '0') > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('concurrent command did not reach the database claim lock');
  }

  async function openProbeClient(): Promise<pg.Client> {
    const url = new URL(databaseUrl ?? '');
    url.username = 'im06_wi01_probe';
    url.password = 'im06-wi01-probe';
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    return client;
  }

  async function closeProbeClient(client: pg.Client): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore: connection may have already ended the current transaction
    }
    try {
      await client.query('RESET ROLE');
    } catch {
      // ignore: role may already be the default
    }
    await client.end();
  }

  const processCountSql = `SELECT count(*)::text AS c FROM task_execution.process_instance WHERE process_id = $1`;

  async function scalarQuery(
    connection: pg.Client,
    text: string,
    values?: unknown[],
  ): Promise<string> {
    const result = await connection.query<{ c: string }>(text, values);
    return result.rows[0]?.c ?? '0';
  }

  async function establishDirectContext(
    connection: pg.Client,
    options: {
      enterpriseId?: string;
      allowedProjectIds?: readonly string[];
      expiresAt?: Date;
    } = {},
  ): Promise<void> {
    await connection.query('SET LOCAL ROLE platform_context_establisher');
    await connection.query(
      `SELECT platform_security.establish_transaction_context(
       'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
      [
        OPERATOR,
        OPERATOR_ACTOR,
        DECISION,
        DECISION_HASH,
        options.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
        options.enterpriseId ?? ENTERPRISE_A,
        [...(options.allowedProjectIds ?? [])],
        CORRELATION,
      ],
    );
    await connection.query('SET LOCAL ROLE task_execution_app');
  }

  it('commits technical rows atomically and replays the saved result', async () => {
    const first = await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope(),
      async (execution) => {
        await execution.insertProcessInstance(processInsert(PROCESS_A));
        await execution.appendReferenceEdge({
          ownerObjectType: 'ProcessInstance',
          ownerObjectId: PROCESS_A,
          referencePath: '/fixtureRef',
          targetModule: 'task_execution',
          targetObjectType: 'ProcessInstance',
          targetObjectId: PROCESS_A,
          referencePurpose: 'WI01_COMMIT_PROBE',
        });
        await execution.appendOutbox({
          eventId: 'f2f2f2f2-f2f2-72f2-82f2-f2f2f2f2f201',
          eventType: 'wi01.ProcessRegistered',
          eventVersion: '1.0',
          aggregateType: 'ProcessInstance',
          aggregateId: PROCESS_A,
          aggregateVersion: '1',
          payload: { enterpriseId: ENTERPRISE_A, note: 'committed' },
          occurredAt: new Date(),
        });
        return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_A, status: 'ACTIVE' } };
      },
    );
    expect(first).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { processId: PROCESS_A, status: 'ACTIVE' },
    });
    expect(await count('command_receipt', "WHERE idempotency_key = 'wi01-key-1'")).toBe('1');
    expect(await count('outbox_event', "WHERE event_type = 'wi01.ProcessRegistered'")).toBe('1');
    expect(
      await count(
        'audit_record',
        "WHERE command_type = 'wi01.demo.command' AND outcome = 'COMMITTED'",
      ),
    ).toBe('1');
    expect(await count('reference_edge', "WHERE reference_purpose = 'WI01_COMMIT_PROBE'")).toBe(
      '1',
    );

    const replay = await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({ commandId: 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f102' }),
      () => Promise.reject(new Error('replay must not execute the body')),
    );
    expect(replay).toMatchObject({
      status: 'DUPLICATE',
      originalOutcome: 'COMMITTED',
      resultPayload: { processId: PROCESS_A, status: 'ACTIVE' },
    });
    const version = await admin.query<{ aggregate_version: string }>(
      `SELECT aggregate_version::text FROM task_execution.process_instance WHERE process_id = $1`,
      [PROCESS_A],
    );
    expect(version.rows[0]?.aggregate_version).toBe('1');
  });

  it('returns a stable hash conflict and preserves the original receipt', async () => {
    const before = Number(await count('audit_record', "WHERE outcome = 'DENIED'"));
    await expect(
      executeTaskExecutionCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f103',
          requestPayload: { op: 'register', note: 'TAMPERED DIFFERENT PAYLOAD' },
        }),
        () => Promise.resolve({ kind: 'COMMITTED', resultPayload: { never: true } }),
      ),
    ).rejects.toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT });
    expect(Number(await count('audit_record', "WHERE outcome = 'DENIED'"))).toBe(before + 1);
    expect(await count('command_receipt', "WHERE idempotency_key = 'wi01-key-1'")).toBe('1');
    const original = await admin.query<{ outcome: string }>(
      `SELECT outcome FROM task_execution.command_receipt WHERE idempotency_key = 'wi01-key-1'`,
    );
    expect(original.rows[0]?.outcome).toBe('COMMITTED');
  });

  it('executes a concurrent same-key body once and returns the committed replay', async () => {
    let bodyExecutions = 0;
    let signalBodyStarted!: () => void;
    let releaseBody!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      signalBodyStarted = resolve;
    });
    const bodyHold = new Promise<void>((resolve) => {
      releaseBody = resolve;
    });
    const first = executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f111',
        idempotencyKey: 'wi01-concurrent-idempotency',
        commandType: 'wi01.concurrent-idempotency',
        requestPayload: { op: 'concurrent-idempotency' },
      }),
      async () => {
        bodyExecutions += 1;
        signalBodyStarted();
        await bodyHold;
        return { kind: 'COMMITTED', resultPayload: { winner: true } };
      },
    );
    await bodyStarted;
    const second = executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f112',
        idempotencyKey: 'wi01-concurrent-idempotency',
        commandType: 'wi01.concurrent-idempotency',
        requestPayload: { op: 'concurrent-idempotency' },
      }),
      () => Promise.resolve({ kind: 'COMMITTED', resultPayload: { winner: false } }),
    );
    try {
      await waitForBlockedProbeSession();
    } finally {
      releaseBody();
    }
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.status).sort()).toEqual(['COMMITTED', 'DUPLICATE']);
    expect(bodyExecutions).toBe(1);
    expect(
      await count('command_receipt', "WHERE idempotency_key = 'wi01-concurrent-idempotency'"),
    ).toBe('1');
  });

  it('rejects forged actor, scope and correlation attribution before claiming a receipt', async () => {
    const mismatches: Partial<CommandEnvelope>[] = [
      { principalId: '00000000-0000-7000-8000-000000000101' },
      { actorSnapshotId: '00000000-0000-7000-8000-000000000102' },
      { authorizationDecisionId: '00000000-0000-7000-8000-000000000103' },
      { policySnapshotId: '00000000-0000-7000-8000-000000000104' },
      { enterpriseId: ENTERPRISE_B },
      { projectId: PROJECT_A2 },
      { correlationId: '00000000-0000-7000-8000-000000000105' },
    ];
    for (const [index, mismatch] of mismatches.entries()) {
      await expect(
        executeTaskExecutionCommand(
          db,
          contextFor(ENTERPRISE_A, [PROJECT_A1]),
          envelope({
            commandId: `80808080-8080-7080-8080-80808080810${index}`,
            idempotencyKey: `wi01-context-mismatch-${index}`,
            commandType: 'wi01.context-mismatch',
            ...mismatch,
          }),
          () => Promise.resolve({ kind: 'COMMITTED', resultPayload: { invalid: true } }),
        ),
      ).rejects.toMatchObject({ code: COMMAND_CONTEXT_MISMATCH });
    }
    expect(await count('command_receipt', "WHERE command_type = 'wi01.context-mismatch'")).toBe(
      '0',
    );
  });

  it('allows one same-version CAS winner and rolls back the conflict loser', async () => {
    await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'a0a0a0a0-a0a0-70a0-80a0-a0a0a0a0a101',
        idempotencyKey: 'wi01-cas-setup',
        targetId: PROCESS_CONCURRENCY,
        requestPayload: { op: 'register', target: 'concurrency' },
      }),
      async (execution) => {
        await execution.insertProcessInstance(processInsert(PROCESS_CONCURRENCY));
        return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_CONCURRENCY } };
      },
    );

    const runAdvance = (key: 'a' | 'b') =>
      executeTaskExecutionCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: `a0a0a0a0-a0a0-70a0-80a0-a0a0a0a0a1${key === 'a' ? '02' : '03'}`,
          idempotencyKey: `wi01-cas-${key}`,
          commandType: 'wi01.advance',
          targetId: PROCESS_CONCURRENCY,
          expectedAggregateVersion: '1',
          requestPayload: { op: 'advance' },
        }),
        async (execution) => {
          const outcome = await execution.casProcessInstance(PROCESS_CONCURRENCY, '1', {
            state: 'SUSPENDED',
          });
          if (outcome === 'CONFLICT') {
            throw new CommandExecutionError(CONCURRENCY_CONFLICT, 'aggregate moved on');
          }
          if (outcome === 'NOT_FOUND') {
            throw new CommandExecutionError('NOT_FOUND', 'aggregate not visible');
          }
          await execution.appendOutbox({
            eventId: `a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a2${key === 'a' ? '01' : '02'}`,
            eventType: 'wi01.ProcessAdvanced',
            eventVersion: '1.0',
            aggregateType: 'ProcessInstance',
            aggregateId: PROCESS_CONCURRENCY,
            aggregateVersion: '2',
            payload: { enterpriseId: ENTERPRISE_A, note: key },
            occurredAt: new Date(),
          });
          return { kind: 'COMMITTED', resultPayload: { advanced: true, attempt: key } };
        },
      );

    const [a, b] = await Promise.allSettled([runAdvance('a'), runAdvance('b')]);
    const committed = [a, b].filter(
      (result) => result.status === 'fulfilled' && result.value.status === 'COMMITTED',
    );
    const conflicted = [a, b].filter(
      (result) =>
        result.status === 'rejected' &&
        (result.reason as CommandExecutionError).code === CONCURRENCY_CONFLICT,
    );
    expect(committed).toHaveLength(1);
    expect(conflicted).toHaveLength(1);
    const process = await admin.query<{ aggregate_version: string; state: string }>(
      `SELECT aggregate_version::text, state FROM task_execution.process_instance WHERE process_id = $1`,
      [PROCESS_CONCURRENCY],
    );
    expect(process.rows[0]).toEqual({ aggregate_version: '2', state: 'SUSPENDED' });
    expect(await count('command_receipt', "WHERE command_type = 'wi01.advance'")).toBe('1');
    expect(await count('outbox_event', "WHERE event_type = 'wi01.ProcessAdvanced'")).toBe('1');
  });

  it('binds CAS to the envelope and preserves PostgreSQL bigint precision', async () => {
    await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'b0b0b0b0-b0b0-70b0-80b0-b0b0b0b0b101',
        idempotencyKey: 'wi01-bigint-setup',
        targetId: PROCESS_BIGINT,
        requestPayload: { op: 'bigint-setup' },
      }),
      async (execution) => {
        await execution.insertProcessInstance(processInsert(PROCESS_BIGINT));
        return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_BIGINT } };
      },
    );
    await admin.query(
      `UPDATE task_execution.process_instance SET aggregate_version = 9007199254740993 WHERE process_id = $1`,
      [PROCESS_BIGINT],
    );

    await expect(
      executeTaskExecutionCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'b0b0b0b0-b0b0-70b0-80b0-b0b0b0b0b111',
          idempotencyKey: 'wi01-cas-envelope-mismatch',
          commandType: 'wi01.cas-envelope-mismatch',
          targetId: PROCESS_BIGINT,
          expectedAggregateVersion: '9007199254740993',
          requestPayload: { op: 'cas-envelope-mismatch' },
        }),
        async (execution) => {
          await execution.casProcessInstance(PROCESS_A, '1');
          return { kind: 'COMMITTED', resultPayload: { invalid: true } };
        },
      ),
    ).rejects.toMatchObject({ code: COMMAND_TARGET_MISMATCH });

    const committed = await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'b0b0b0b0-b0b0-70b0-80b0-b0b0b0b0b121',
        idempotencyKey: 'wi01-bigint-cas',
        commandType: 'wi01.bigint-cas',
        targetId: PROCESS_BIGINT,
        expectedAggregateVersion: '9007199254740993',
        requestPayload: { op: 'bigint-cas' },
      }),
      async (execution) => {
        const cas = await execution.casProcessInstance(PROCESS_BIGINT, '9007199254740993');
        return { kind: 'COMMITTED', resultPayload: { cas } };
      },
    );
    expect(committed).toMatchObject({ status: 'COMMITTED', resultPayload: { cas: 'OK' } });
    const version = await admin.query<{ aggregate_version: string }>(
      `SELECT aggregate_version::text FROM task_execution.process_instance WHERE process_id = $1`,
      [PROCESS_BIGINT],
    );
    expect(version.rows[0]?.aggregate_version).toBe('9007199254740994');
  });

  it('rolls back receipt, process, audit, outbox and reference edge after a fault', async () => {
    const faultEnvelope = envelope({
      commandId: 'c0c0c0c0-c0c0-70c0-80c0-c0c0c0c0c101',
      idempotencyKey: 'wi01-fault',
      targetId: PROCESS_FAULT,
      requestPayload: { op: 'register-fault' },
    });
    const successBody: CommandBody = async (execution) => {
      await execution.insertProcessInstance(processInsert(PROCESS_FAULT));
      await execution.appendReferenceEdge({
        ownerObjectType: 'ProcessInstance',
        ownerObjectId: PROCESS_FAULT,
        referencePath: '/faultRef',
        targetModule: 'task_execution',
        targetObjectType: 'ProcessInstance',
        targetObjectId: PROCESS_FAULT,
        referencePurpose: 'WI01_FAULT_PROBE',
      });
      await execution.appendOutbox({
        eventId: 'c1c1c1c1-c1c1-71c1-81c1-c1c1c1c1c101',
        eventType: 'wi01.ProcessFault',
        eventVersion: '1.0',
        aggregateType: 'ProcessInstance',
        aggregateId: PROCESS_FAULT,
        aggregateVersion: '1',
        payload: { enterpriseId: ENTERPRISE_A, note: 'fault-injected' },
        occurredAt: new Date(),
      });
      return {
        kind: 'COMMITTED',
        resultPayload: { processId: PROCESS_FAULT, status: 'ACTIVE' },
      };
    };
    const failingBody: CommandBody = async (execution) => {
      await successBody(execution);
      execution.failAfterOutbox();
      return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_FAULT, status: 'ACTIVE' } };
    };

    await expect(
      executeTaskExecutionCommand(db, contextFor(ENTERPRISE_A), faultEnvelope, failingBody),
    ).rejects.toMatchObject({ code: 'INJECTED_FAULT' });

    expect(await count('process_instance', `WHERE process_id = '${PROCESS_FAULT}'`)).toBe('0');
    expect(await count('reference_edge', "WHERE reference_purpose = 'WI01_FAULT_PROBE'")).toBe('0');
    expect(await count('outbox_event', "WHERE event_type = 'wi01.ProcessFault'")).toBe('0');
    expect(
      await count('audit_record', `WHERE command_id = 'c0c0c0c0-c0c0-70c0-80c0-c0c0c0c0c101'`),
    ).toBe('0');
    expect(await count('command_receipt', `WHERE idempotency_key = 'wi01-fault'`)).toBe('0');

    const recovered = await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A),
      faultEnvelope,
      successBody,
    );
    expect(recovered).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { processId: PROCESS_FAULT, status: 'ACTIVE' },
    });
    expect(await count('process_instance', `WHERE process_id = '${PROCESS_FAULT}'`)).toBe('1');
    expect(await count('reference_edge', "WHERE reference_purpose = 'WI01_FAULT_PROBE'")).toBe('1');
    expect(await count('outbox_event', "WHERE event_type = 'wi01.ProcessFault'")).toBe('1');
    expect(
      await count(
        'audit_record',
        `WHERE command_id = 'c0c0c0c0-c0c0-70c0-80c0-c0c0c0c0c101' AND outcome = 'COMMITTED'`,
      ),
    ).toBe('1');
    expect(
      await count(
        'command_receipt',
        `WHERE idempotency_key = 'wi01-fault' AND outcome = 'COMMITTED'`,
      ),
    ).toBe('1');

    const replayed = await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A),
      faultEnvelope,
      () => Promise.reject(new Error('replay must not execute the body')),
    );
    expect(replayed).toMatchObject({
      status: 'DUPLICATE',
      originalOutcome: 'COMMITTED',
      resultPayload: { processId: PROCESS_FAULT, status: 'ACTIVE' },
    });
    expect(await count('process_instance', `WHERE process_id = '${PROCESS_FAULT}'`)).toBe('1');
    expect(await count('reference_edge', "WHERE reference_purpose = 'WI01_FAULT_PROBE'")).toBe('1');
    expect(await count('outbox_event', "WHERE event_type = 'wi01.ProcessFault'")).toBe('1');
  });

  it('rejects a process whose creator disagrees with the trusted context principal', async () => {
    await expect(
      executeTaskExecutionCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'b1b1b1b1-b1b1-71b1-81b1-b1b1b1b1b101',
          idempotencyKey: 'wi01-creator-mismatch',
          commandType: 'wi01.creator-mismatch',
          targetId: PROCESS_PRINCIPAL,
          requestPayload: { op: 'creator-mismatch' },
        }),
        async (execution) => {
          await execution.insertProcessInstance(
            processInsert(
              PROCESS_PRINCIPAL,
              undefined,
              ENTERPRISE_A,
              '99999999-9999-7999-8999-999999999999',
            ),
          );
          return { kind: 'COMMITTED', resultPayload: { should: 'never reach' } };
        },
      ),
    ).rejects.toMatchObject({ code: TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH });
    expect(await count('process_instance', `WHERE process_id = '${PROCESS_PRINCIPAL}'`)).toBe('0');
    expect(await count('command_receipt', `WHERE idempotency_key = 'wi01-creator-mismatch'`)).toBe(
      '0',
    );
  });

  it('rejects CAS attempts against rows whose scope does not match the command envelope', async () => {
    await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A, [PROJECT_A1]),
      envelope({
        commandId: 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a901',
        idempotencyKey: 'wi01-cas-target-setup',
        commandType: 'wi01.cas-target-setup',
        targetId: PROCESS_CAS_SCOPE,
        projectId: PROJECT_A1,
        expectedAggregateVersion: '1',
        requestPayload: { op: 'cas-target-setup' },
      }),
      async (execution) => {
        await execution.insertProcessInstance(processInsert(PROCESS_CAS_SCOPE, PROJECT_A1));
        return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_CAS_SCOPE } };
      },
    );

    const positiveControl = await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A, [PROJECT_A1]),
      envelope({
        commandId: 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a902',
        idempotencyKey: 'wi01-cas-positive-control',
        commandType: 'wi01.cas-positive-control',
        targetId: PROCESS_CAS_SCOPE,
        projectId: PROJECT_A1,
        expectedAggregateVersion: '1',
        requestPayload: { op: 'cas-positive-control' },
      }),
      async (execution) => {
        const cas = await execution.casProcessInstance(PROCESS_CAS_SCOPE, '1', {
          state: 'SUSPENDED',
        });
        return { kind: 'COMMITTED', resultPayload: { cas } };
      },
    );
    expect(positiveControl).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { cas: 'OK' },
    });

    await expect(
      executeTaskExecutionCommand(
        db,
        contextFor(ENTERPRISE_B, [PROJECT_A1]),
        envelope({
          commandId: 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a911',
          idempotencyKey: 'wi01-cas-enterprise-mismatch',
          commandType: 'wi01.cas-enterprise-mismatch',
          enterpriseId: ENTERPRISE_B,
          targetId: PROCESS_CAS_SCOPE,
          projectId: PROJECT_A1,
          expectedAggregateVersion: '2',
          requestPayload: { op: 'cas-enterprise-mismatch' },
        }),
        async (execution) => {
          const outcome = await execution.casProcessInstance(PROCESS_CAS_SCOPE, '2');
          if (outcome === 'OK') {
            throw new CommandExecutionError('LEAKED', 'cross-enterprise CAS succeeded');
          }
          throw new CommandExecutionError(
            outcome === 'NOT_FOUND' ? 'CROSS_ENTERPRISE_HIDDEN' : 'CROSS_PROJECT_REJECTED',
            `CAS outcome=${outcome}`,
          );
        },
      ),
    ).rejects.toMatchObject({ code: 'CROSS_ENTERPRISE_HIDDEN' });
    expect(
      await count('command_receipt', `WHERE idempotency_key = 'wi01-cas-enterprise-mismatch'`),
    ).toBe('0');
    expect(await count('audit_record', `WHERE command_type = 'wi01.cas-enterprise-mismatch'`)).toBe(
      '0',
    );

    await expect(
      executeTaskExecutionCommand(
        db,
        contextFor(ENTERPRISE_A, [PROJECT_A1, PROJECT_A2]),
        envelope({
          commandId: 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a912',
          idempotencyKey: 'wi01-cas-project-mismatch',
          commandType: 'wi01.cas-project-mismatch',
          targetId: PROCESS_CAS_SCOPE,
          projectId: PROJECT_A2,
          expectedAggregateVersion: '2',
          requestPayload: { op: 'cas-project-mismatch' },
        }),
        async (execution) => {
          const outcome = await execution.casProcessInstance(PROCESS_CAS_SCOPE, '2');
          if (outcome === 'OK') {
            throw new CommandExecutionError('LEAKED', 'cross-project CAS succeeded');
          }
          if (outcome === 'CONFLICT') {
            throw new CommandExecutionError(CONCURRENCY_CONFLICT, 'precise scope guard bypassed');
          }
          throw new CommandExecutionError(
            COMMAND_TARGET_MISMATCH,
            `precise scope guard rejected CAS with outcome=${outcome}`,
          );
        },
      ),
    ).rejects.toMatchObject({ code: COMMAND_TARGET_MISMATCH });
    expect(
      await count('command_receipt', `WHERE idempotency_key = 'wi01-cas-project-mismatch'`),
    ).toBe('0');
    expect(await count('audit_record', `WHERE command_type = 'wi01.cas-project-mismatch'`)).toBe(
      '0',
    );

    await expect(
      executeTaskExecutionCommand(
        db,
        contextFor(ENTERPRISE_A, [PROJECT_A1]),
        envelope({
          commandId: 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a913',
          idempotencyKey: 'wi01-cas-wrong-target-type',
          commandType: 'wi01.cas-wrong-target-type',
          targetType: 'SomeOtherAggregate',
          targetId: PROCESS_CAS_SCOPE,
          projectId: PROJECT_A1,
          expectedAggregateVersion: '2',
          requestPayload: { op: 'cas-wrong-target-type' },
        }),
        async (execution) => {
          await execution.casProcessInstance(PROCESS_CAS_SCOPE, '2');
          return { kind: 'COMMITTED', resultPayload: { invalid: true } };
        },
      ),
    ).rejects.toMatchObject({ code: COMMAND_TARGET_MISMATCH });
    expect(
      await count('command_receipt', `WHERE idempotency_key = 'wi01-cas-wrong-target-type'`),
    ).toBe('0');
    expect(await count('audit_record', `WHERE command_type = 'wi01.cas-wrong-target-type'`)).toBe(
      '0',
    );

    expect(await count('process_instance', `WHERE process_id = '${PROCESS_CAS_SCOPE}'`)).toBe('1');
    const version = await admin.query<{ aggregate_version: string; state: string }>(
      `SELECT aggregate_version::text, state FROM task_execution.process_instance WHERE process_id = $1`,
      [PROCESS_CAS_SCOPE],
    );
    expect(version.rows[0]).toEqual({ aggregate_version: '2', state: 'SUSPENDED' });
  });

  it('rejects insertProcessInstance when the row identity or scope does not match the command envelope', async () => {
    const positiveInsert = await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A, [PROJECT_A1]),
      envelope({
        commandId: 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a921',
        idempotencyKey: 'wi01-insert-positive',
        commandType: 'wi01.insert-positive',
        targetId: PROCESS_INSERT_PROJECT_A,
        projectId: PROJECT_A1,
        requestPayload: { op: 'insert-positive' },
      }),
      async (execution) => {
        await execution.insertProcessInstance(processInsert(PROCESS_INSERT_PROJECT_A, PROJECT_A1));
        return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_INSERT_PROJECT_A } };
      },
    );
    expect(positiveInsert).toMatchObject({ status: 'COMMITTED' });
    expect(
      await count('process_instance', `WHERE process_id = '${PROCESS_INSERT_PROJECT_A}'`),
    ).toBe('1');

    await expect(
      executeTaskExecutionCommand(
        db,
        contextFor(ENTERPRISE_A, [PROJECT_A1, PROJECT_A2]),
        envelope({
          commandId: 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a922',
          idempotencyKey: 'wi01-insert-project-mismatch',
          commandType: 'wi01.insert-project-mismatch',
          targetId: PROCESS_INSERT_PROJECT_B,
          projectId: PROJECT_A1,
          requestPayload: { op: 'insert-project-mismatch' },
        }),
        async (execution) => {
          await execution.insertProcessInstance(
            processInsert(PROCESS_INSERT_PROJECT_B, PROJECT_A2),
          );
          return { kind: 'COMMITTED', resultPayload: { should: 'never reach' } };
        },
      ),
    ).rejects.toMatchObject({ code: TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH });
    expect(
      await count('process_instance', `WHERE process_id = '${PROCESS_INSERT_PROJECT_B}'`),
    ).toBe('0');
    expect(
      await count('command_receipt', `WHERE idempotency_key = 'wi01-insert-project-mismatch'`),
    ).toBe('0');
    expect(await count('audit_record', `WHERE command_type = 'wi01.insert-project-mismatch'`)).toBe(
      '0',
    );
    expect(
      await count(
        'outbox_event',
        `WHERE source_command_id = (SELECT command_id FROM task_execution.command_receipt WHERE idempotency_key = 'wi01-insert-project-mismatch')`,
      ),
    ).toBe('0');

    await expect(
      executeTaskExecutionCommand(
        db,
        contextFor(ENTERPRISE_A, [PROJECT_A1, PROJECT_A2]),
        envelope({
          commandId: 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a923',
          idempotencyKey: 'wi01-insert-processid-mismatch',
          commandType: 'wi01.insert-processid-mismatch',
          targetId: PROCESS_INSERT_PROCESS_ID,
          projectId: PROJECT_A1,
          requestPayload: { op: 'insert-processid-mismatch' },
        }),
        async (execution) => {
          await execution.insertProcessInstance(
            processInsert(PROCESS_INSERT_TARGET_TYPE, PROJECT_A1),
          );
          return { kind: 'COMMITTED', resultPayload: { should: 'never reach' } };
        },
      ),
    ).rejects.toMatchObject({ code: TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH });
    expect(
      await count('process_instance', `WHERE process_id = '${PROCESS_INSERT_TARGET_TYPE}'`),
    ).toBe('0');
    expect(
      await count('process_instance', `WHERE process_id = '${PROCESS_INSERT_PROCESS_ID}'`),
    ).toBe('0');
    expect(
      await count('command_receipt', `WHERE idempotency_key = 'wi01-insert-processid-mismatch'`),
    ).toBe('0');
    expect(
      await count('audit_record', `WHERE command_type = 'wi01.insert-processid-mismatch'`),
    ).toBe('0');

    await expect(
      executeTaskExecutionCommand(
        db,
        contextFor(ENTERPRISE_A, [PROJECT_A1, PROJECT_A2]),
        envelope({
          commandId: 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a924',
          idempotencyKey: 'wi01-insert-targettype-mismatch',
          commandType: 'wi01.insert-targettype-mismatch',
          targetType: 'SomeOtherAggregate',
          targetId: PROCESS_INSERT_TARGET_TYPE,
          projectId: PROJECT_A1,
          requestPayload: { op: 'insert-targettype-mismatch' },
        }),
        async (execution) => {
          await execution.insertProcessInstance(
            processInsert(PROCESS_INSERT_TARGET_TYPE, PROJECT_A1),
          );
          return { kind: 'COMMITTED', resultPayload: { should: 'never reach' } };
        },
      ),
    ).rejects.toMatchObject({ code: TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH });
    expect(
      await count('process_instance', `WHERE process_id = '${PROCESS_INSERT_TARGET_TYPE}'`),
    ).toBe('0');
    expect(
      await count('command_receipt', `WHERE idempotency_key = 'wi01-insert-targettype-mismatch'`),
    ).toBe('0');
    expect(
      await count('audit_record', `WHERE command_type = 'wi01.insert-targettype-mismatch'`),
    ).toBe('0');
  });

  it('binds the runner-bound insert path and ignores caller mutations of the input envelope', async () => {
    const inputEnvelope = envelope({
      commandId: 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f001',
      idempotencyKey: 'wi01-tamper-control',
      commandType: 'wi01.tamper-control',
      targetId: PROCESS_INSERT_TAMPER,
      projectId: PROJECT_A1,
      requestPayload: { op: 'tamper-control' },
    });
    await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A, [PROJECT_A1, PROJECT_A2]),
      inputEnvelope,
      async (execution) => {
        expect(typeof execution.insertProcessInstance).toBe('function');
        expect('commandFacts' in execution).toBe(false);
        try {
          inputEnvelope.targetId = '00000000-0000-7000-8000-000000000000';
          inputEnvelope.projectId = PROJECT_A2;
        } catch {
          // strict-mode rejection is fine
        }
        await execution.insertProcessInstance(processInsert(PROCESS_INSERT_TAMPER, PROJECT_A1));
        return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_INSERT_TAMPER } };
      },
    );
    expect(await count('process_instance', `WHERE process_id = '${PROCESS_INSERT_TAMPER}'`)).toBe(
      '1',
    );
    expect(
      await count('process_instance', `WHERE process_id = '00000000-0000-7000-8000-000000000000'`),
    ).toBe('0');
    const inserted = await admin.query<{ enterprise_id: string; project_id: string | null }>(
      `SELECT enterprise_id::text, project_id::text FROM task_execution.process_instance WHERE process_id = $1`,
      [PROCESS_INSERT_TAMPER],
    );
    expect(inserted.rows[0]).toEqual({ enterprise_id: ENTERPRISE_A, project_id: PROJECT_A1 });

    const spoofedEnvelope = envelope({
      commandId: 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f002',
      idempotencyKey: 'wi01-tamper-envelope-mutation',
      commandType: 'wi01.tamper-envelope-mutation',
      targetId: PROCESS_INSERT_TAMPER,
      projectId: PROJECT_A1,
      requestPayload: { op: 'tamper-envelope-mutation' },
    });
    await expect(
      executeTaskExecutionCommand(
        db,
        contextFor(ENTERPRISE_A, [PROJECT_A1, PROJECT_A2]),
        spoofedEnvelope,
        async (execution) => {
          spoofedEnvelope.targetId = '00000000-0000-7000-8000-000000000000';
          spoofedEnvelope.projectId = PROJECT_A2;
          await execution.casProcessInstance(spoofedEnvelope.targetId, '1');
          await execution.appendOutbox({
            eventId: 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f099',
            eventType: 'wi01.TamperOutbox',
            eventVersion: '1.0',
            aggregateType: spoofedEnvelope.targetType,
            aggregateId: spoofedEnvelope.targetId,
            aggregateVersion: '1',
            payload: {
              enterpriseId: spoofedEnvelope.enterpriseId,
              projectId: spoofedEnvelope.projectId,
              note: 'should-not-write',
            },
            occurredAt: new Date(),
          });
          await execution.appendReferenceEdge({
            ownerObjectType: spoofedEnvelope.targetType,
            ownerObjectId: spoofedEnvelope.targetId,
            referencePath: '/tamper',
            targetModule: 'task_execution',
            targetObjectType: 'ProcessInstance',
            targetObjectId: spoofedEnvelope.targetId,
            referencePurpose: 'WI01_TAMPER_REFERENCE',
          });
          return {
            kind: 'COMMITTED',
            resultPayload: { note: 'should-not-write' },
          };
        },
      ),
    ).rejects.toMatchObject({ code: COMMAND_TARGET_MISMATCH });
    expect(
      await count('command_receipt', `WHERE idempotency_key = 'wi01-tamper-envelope-mutation'`),
    ).toBe('0');
    expect(await count('outbox_event', `WHERE event_type = 'wi01.TamperOutbox'`)).toBe('0');
    expect(await count('reference_edge', `WHERE reference_purpose = 'WI01_TAMPER_REFERENCE'`)).toBe(
      '0',
    );
  });

  it('persists REJECTED receipt on business rejection without altering the aggregate', async () => {
    await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'd0d0d0d0-d0d0-70d0-80d0-d0d0d0d0d101',
        idempotencyKey: 'wi01-reject-setup',
        targetId: PROCESS_REJECT,
        requestPayload: { op: 'reject-setup' },
      }),
      async (execution) => {
        await execution.insertProcessInstance(processInsert(PROCESS_REJECT));
        return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_REJECT } };
      },
    );

    const denied = Number(await count('audit_record', `WHERE outcome = 'REJECTED'`));

    const result = await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'd0d0d0d0-d0d0-70d0-80d0-d0d0d0d0d102',
        idempotencyKey: 'wi01-reject',
        commandType: 'wi01.reject',
        targetId: PROCESS_REJECT,
        requestPayload: { op: 'reject' },
      }),
      () =>
        Promise.resolve({
          kind: 'REJECTED',
          errorCode: 'EXECUTION_BUSINESS_RULE',
          safeSummary: 'business rule rejected',
          currentAggregateVersion: '1',
        }),
    );
    expect(result).toMatchObject({ status: 'REJECTED', errorCode: 'EXECUTION_BUSINESS_RULE' });
    const version = await admin.query<{ aggregate_version: string }>(
      `SELECT aggregate_version::text FROM task_execution.process_instance WHERE process_id = $1`,
      [PROCESS_REJECT],
    );
    expect(version.rows[0]?.aggregate_version).toBe('1');
    expect(
      Number(await count('audit_record', `WHERE outcome = 'REJECTED'`)),
    ).toBeGreaterThanOrEqual(denied + 1);
    expect(
      await count('audit_record', `WHERE command_type = 'wi01.reject' AND outcome = 'COMMITTED'`),
    ).toBe('0');
    expect(
      await count(
        'command_receipt',
        "WHERE idempotency_key = 'wi01-reject' AND outcome = 'REJECTED'",
      ),
    ).toBe('1');

    const replay = await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'd0d0d0d0-d0d0-70d0-80d0-d0d0d0d0d103',
        idempotencyKey: 'wi01-reject',
        commandType: 'wi01.reject',
        targetId: PROCESS_REJECT,
        requestPayload: { op: 'reject' },
      }),
      () => Promise.reject(new Error('rejected replay must not run the body')),
    );
    expect(replay).toMatchObject({
      status: 'DUPLICATE',
      originalOutcome: 'REJECTED',
      errorCode: 'EXECUTION_BUSINESS_RULE',
    });
  });

  it('rejects events whose payload hash does not match canonical bytes', async () => {
    await expect(
      executeTaskExecutionCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'e0e0e0e0-e0e0-70e0-80e0-e0e0e0e0e101',
          idempotencyKey: 'wi01-hash-mismatch',
          commandType: 'wi01.hash-mismatch',
          requestPayload: { op: 'hash-mismatch' },
        }),
        async (execution) => {
          await execution.appendOutbox({
            eventId: 'e1e1e1e1-e1e1-71e1-81e1-e1e1e1e1e101',
            eventType: 'wi01.BadHash',
            eventVersion: '1.0',
            aggregateType: 'ProcessInstance',
            aggregateId: PROCESS_A,
            aggregateVersion: '1',
            payload: { enterpriseId: ENTERPRISE_A, note: 'mismatch' },
            declaredHash: Buffer.alloc(32, 0x77),
            occurredAt: new Date(),
          });
          return { kind: 'COMMITTED', resultPayload: { should: 'never reach' } };
        },
      ),
    ).rejects.toMatchObject({ code: PAYLOAD_HASH_MISMATCH });
    expect(await count('outbox_event', "WHERE event_type = 'wi01.BadHash'")).toBe('0');
    expect(await count('command_receipt', "WHERE idempotency_key = 'wi01-hash-mismatch'")).toBe(
      '0',
    );
  });

  it('forbids cross-enterprise and cross-project reads without a matching context', async () => {
    await executeTaskExecutionCommand(
      db,
      contextFor(ENTERPRISE_A, [PROJECT_A1]),
      envelope({
        commandId: 'f0f0f0f0-f0f0-70f0-80f0-f0f0f0f0f101',
        idempotencyKey: 'wi01-project-seed',
        targetId: PROCESS_PROJECT,
        projectId: PROJECT_A1,
        requestPayload: { op: 'project-seed' },
      }),
      async (execution) => {
        await execution.insertProcessInstance(processInsert(PROCESS_PROJECT, PROJECT_A1));
        return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_PROJECT } };
      },
    );

    const freshProbe = await openProbeClient();
    try {
      await freshProbe.query('BEGIN');
      await establishDirectContext(freshProbe, { enterpriseId: ENTERPRISE_B });
      expect(await scalarQuery(freshProbe, processCountSql, [PROCESS_PROJECT])).toBe('0');
      await freshProbe.query('ROLLBACK');

      await freshProbe.query('BEGIN');
      await establishDirectContext(freshProbe, {
        enterpriseId: ENTERPRISE_A,
        allowedProjectIds: [PROJECT_A2],
      });
      expect(await scalarQuery(freshProbe, processCountSql, [PROCESS_PROJECT])).toBe('0');
      await freshProbe.query('ROLLBACK');

      await freshProbe.query('BEGIN');
      await establishDirectContext(freshProbe, {
        enterpriseId: ENTERPRISE_A,
        allowedProjectIds: [PROJECT_A1],
      });
      expect(await scalarQuery(freshProbe, processCountSql, [PROCESS_PROJECT])).toBe('1');
      await freshProbe.query('ROLLBACK');
    } finally {
      await closeProbeClient(freshProbe);
    }
  });

  it('detects a Decision that expires inside a long-running transaction', async () => {
    const expiredAt = new Date(Date.now() + 200);
    const freshProbe = await openProbeClient();
    try {
      await freshProbe.query('BEGIN');
      await establishDirectContext(freshProbe, {
        enterpriseId: ENTERPRISE_A,
        allowedProjectIds: [],
        expiresAt: expiredAt,
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(
        await scalarQuery(freshProbe, `SELECT count(*)::text FROM task_execution.process_instance`),
      ).toBe('0');
      await freshProbe.query('ROLLBACK');
    } finally {
      await closeProbeClient(freshProbe);
    }
  });

  it('does not reuse the previous transaction context after commit or rollback', async () => {
    const freshProbe = await openProbeClient();
    try {
      await freshProbe.query('BEGIN');
      await establishDirectContext(freshProbe, {
        enterpriseId: ENTERPRISE_A,
        allowedProjectIds: [PROJECT_A1],
      });
      expect(await scalarQuery(freshProbe, processCountSql, [PROCESS_PROJECT])).toBe('1');
      await freshProbe.query('COMMIT');

      await freshProbe.query('BEGIN');
      expect(await scalarQuery(freshProbe, processCountSql, [PROCESS_PROJECT])).toBe('0');
      await freshProbe.query('COMMIT');

      await freshProbe.query('BEGIN');
      await establishDirectContext(freshProbe, {
        enterpriseId: ENTERPRISE_A,
        allowedProjectIds: [PROJECT_A1],
      });
      await freshProbe.query('ROLLBACK');

      await freshProbe.query('BEGIN');
      expect(await scalarQuery(freshProbe, processCountSql, [PROCESS_PROJECT])).toBe('0');
      await freshProbe.query('COMMIT');
    } finally {
      await closeProbeClient(freshProbe);
    }
  });
});
