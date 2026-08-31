import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  ArtifactPersistenceError,
  ArtifactRepository,
  CommandExecutionError,
  COMMAND_CONTEXT_MISMATCH,
  COMMAND_TARGET_MISMATCH,
  CONCURRENCY_CONFLICT,
  createArtifactDatabase,
  executeArtifactCommand,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  PAYLOAD_HASH_MISMATCH,
  type ArtifactTransactionContext,
  type CommandEnvelope,
} from '@zhiju/artifact';

// IM-04 WI-02 (issue #91): Artifact application/persistence foundation on
// real PostgreSQL. No Artifact business tables are created; CAS uses the
// existing process_instance technical aggregate.

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
const PROCESS_B = 'e7e7e7e7-e7e7-77e7-87e7-e7e7e7e7e7e7';
const PROCESS_DIRECT = 'e8e8e8e8-e8e8-78e8-88e8-e8e8e8e8e8e8';
const PROCESS_PRINCIPAL = 'e9e9e9e9-e9e9-79e9-89e9-e9e9e9e9e9e9';

function contextFor(
  enterpriseId: string,
  allowedProjectIds: readonly string[] = [],
  overrides: Partial<ArtifactTransactionContext> = {},
): ArtifactTransactionContext {
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
    commandType: 'wi04.demo.command',
    commandVersion: '1.0',
    idempotencyScope: 'wi04',
    idempotencyKey: 'wi04-key-1',
    requestPayload: { op: 'register', note: 'IM-04 WI-02 Fixture' },
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
    processType: 'wi04.demo',
    processVersion: '1.0',
    correlationKey: `wi04:${processId}`,
    enterpriseId,
    ...(projectId === undefined ? {} : { projectId }),
    createdByPrincipalId,
  };
}

interface StatementOutcome {
  allowed: boolean;
  code?: string | undefined;
  message: string;
}

describe.skipIf(!gateEnabled)('Artifact command transaction runner (real PostgreSQL)', () => {
  let admin: pg.Client;
  let probe: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createArtifactDatabase>;
  let repo: ArtifactRepository;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE im04_wi02_probe LOGIN PASSWORD 'im04-wi02-probe' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(`GRANT platform_context_establisher, artifact_app TO im04_wi02_probe`);
    const url = new URL(databaseUrl ?? '');
    url.username = 'im04_wi02_probe';
    url.password = 'im04-wi02-probe';
    probe = new pg.Client({ connectionString: url.toString() });
    await probe.connect();
    pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
    db = createArtifactDatabase(pool);
    repo = new ArtifactRepository();
  });

  afterAll(async () => {
    await probe.end();
    await pool.end();
    await admin.end();
  });

  async function count(table: string, where = ''): Promise<string> {
    const result = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM artifact.${table} ${where}`,
    );
    return result.rows[0]?.count ?? '-1';
  }

  async function waitForBlockedProbeSession(): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const blocked = await admin.query<{ count: string }>(
        `SELECT count(*) AS count
           FROM pg_stat_activity
          WHERE usename = 'im04_wi02_probe' AND wait_event_type = 'Lock'`,
      );
      if (Number(blocked.rows[0]?.count ?? '0') > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('concurrent command did not reach the database claim lock');
  }

  async function tryQuery(
    connection: pg.Client,
    text: string,
    values?: unknown[],
  ): Promise<StatementOutcome> {
    try {
      await connection.query(text, values);
      return { allowed: true, message: 'ok' };
    } catch (error) {
      const pgError = error as pg.DatabaseError;
      return { allowed: false, code: pgError.code, message: pgError.message };
    }
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
    await connection.query('SET LOCAL ROLE artifact_app');
  }

  it('commits technical rows atomically and replays the saved result', async () => {
    const first = await executeArtifactCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope(),
      async (execution) => {
        await repo.insertProcessInstance(execution.trx, processInsert(PROCESS_A));
        await execution.appendReferenceEdge({
          ownerObjectType: 'ProcessInstance',
          ownerObjectId: PROCESS_A,
          referencePath: '/fixtureRef',
          targetModule: 'artifact',
          targetObjectType: 'ProcessInstance',
          targetObjectId: PROCESS_A,
          referencePurpose: 'WI04_COMMIT_PROBE',
        });
        await execution.appendOutbox({
          eventId: 'f2f2f2f2-f2f2-72f2-82f2-f2f2f2f2f201',
          eventType: 'wi04.ProcessRegistered',
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
    expect(await count('command_receipt', "WHERE idempotency_key = 'wi04-key-1'")).toBe('1');
    expect(await count('outbox_event', "WHERE event_type = 'wi04.ProcessRegistered'")).toBe('1');
    expect(
      await count(
        'audit_record',
        "WHERE command_type = 'wi04.demo.command' AND outcome = 'COMMITTED'",
      ),
    ).toBe('1');
    expect(await count('reference_edge', "WHERE reference_purpose = 'WI04_COMMIT_PROBE'")).toBe(
      '1',
    );

    const replay = await executeArtifactCommand(
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
      `SELECT aggregate_version::text FROM artifact.process_instance WHERE process_id = $1`,
      [PROCESS_A],
    );
    expect(version.rows[0]?.aggregate_version).toBe('1');
  });

  it('returns a stable hash conflict and preserves the original receipt', async () => {
    const before = Number(await count('audit_record', "WHERE outcome = 'DENIED'"));
    await expect(
      executeArtifactCommand(
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
    expect(await count('command_receipt', "WHERE idempotency_key = 'wi04-key-1'")).toBe('1');
    const original = await admin.query<{ outcome: string }>(
      `SELECT outcome FROM artifact.command_receipt WHERE idempotency_key = 'wi04-key-1'`,
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
    const first = executeArtifactCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f111',
        idempotencyKey: 'wi04-concurrent-idempotency',
        commandType: 'wi04.concurrent-idempotency',
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
    const second = executeArtifactCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f112',
        idempotencyKey: 'wi04-concurrent-idempotency',
        commandType: 'wi04.concurrent-idempotency',
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
      await count('command_receipt', "WHERE idempotency_key = 'wi04-concurrent-idempotency'"),
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
        executeArtifactCommand(
          db,
          contextFor(ENTERPRISE_A, [PROJECT_A1]),
          envelope({
            commandId: `80808080-8080-7080-8080-80808080810${index}`,
            idempotencyKey: `wi04-context-mismatch-${index}`,
            commandType: 'wi04.context-mismatch',
            ...mismatch,
          }),
          () => Promise.resolve({ kind: 'COMMITTED', resultPayload: { invalid: true } }),
        ),
      ).rejects.toMatchObject({ code: COMMAND_CONTEXT_MISMATCH });
    }
    expect(await count('command_receipt', "WHERE command_type = 'wi04.context-mismatch'")).toBe(
      '0',
    );
  });

  it('allows one same-version CAS winner and rolls back the conflict loser', async () => {
    await executeArtifactCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'a0a0a0a0-a0a0-70a0-80a0-a0a0a0a0a101',
        idempotencyKey: 'wi04-cas-setup',
        targetId: PROCESS_CONCURRENCY,
        requestPayload: { op: 'register', target: 'concurrency' },
      }),
      async (execution) => {
        await repo.insertProcessInstance(execution.trx, processInsert(PROCESS_CONCURRENCY));
        return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_CONCURRENCY } };
      },
    );

    const runAdvance = (key: 'a' | 'b') =>
      executeArtifactCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: `a0a0a0a0-a0a0-70a0-80a0-a0a0a0a0a1${key === 'a' ? '02' : '03'}`,
          idempotencyKey: `wi04-cas-${key}`,
          commandType: 'wi04.advance',
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
            eventType: 'wi04.ProcessAdvanced',
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
      `SELECT aggregate_version::text, state FROM artifact.process_instance WHERE process_id = $1`,
      [PROCESS_CONCURRENCY],
    );
    expect(process.rows[0]).toEqual({ aggregate_version: '2', state: 'SUSPENDED' });
    expect(await count('command_receipt', "WHERE command_type = 'wi04.advance'")).toBe('1');
    expect(await count('outbox_event', "WHERE event_type = 'wi04.ProcessAdvanced'")).toBe('1');
  });

  it('binds CAS to the envelope and preserves PostgreSQL bigint precision', async () => {
    await executeArtifactCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'b0b0b0b0-b0b0-70b0-80b0-b0b0b0b0b101',
        idempotencyKey: 'wi04-bigint-setup',
        targetId: PROCESS_BIGINT,
        requestPayload: { op: 'bigint-setup' },
      }),
      async (execution) => {
        await repo.insertProcessInstance(execution.trx, processInsert(PROCESS_BIGINT));
        return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_BIGINT } };
      },
    );
    await admin.query(
      `UPDATE artifact.process_instance SET aggregate_version = 9007199254740993 WHERE process_id = $1`,
      [PROCESS_BIGINT],
    );

    await expect(
      executeArtifactCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'b0b0b0b0-b0b0-70b0-80b0-b0b0b0b0b111',
          idempotencyKey: 'wi04-cas-envelope-mismatch',
          commandType: 'wi04.cas-envelope-mismatch',
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

    const committed = await executeArtifactCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'b0b0b0b0-b0b0-70b0-80b0-b0b0b0b0b121',
        idempotencyKey: 'wi04-bigint-cas',
        commandType: 'wi04.bigint-cas',
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
      `SELECT aggregate_version::text FROM artifact.process_instance WHERE process_id = $1`,
      [PROCESS_BIGINT],
    );
    expect(version.rows[0]?.aggregate_version).toBe('9007199254740994');
  });

  it('rolls back receipt, process, audit, outbox and reference edge after a fault', async () => {
    await expect(
      executeArtifactCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'c0c0c0c0-c0c0-70c0-80c0-c0c0c0c0c101',
          idempotencyKey: 'wi04-fault',
          targetId: PROCESS_FAULT,
          requestPayload: { op: 'register-fault' },
        }),
        async (execution) => {
          await repo.insertProcessInstance(execution.trx, processInsert(PROCESS_FAULT));
          await execution.appendReferenceEdge({
            ownerObjectType: 'ProcessInstance',
            ownerObjectId: PROCESS_FAULT,
            referencePath: '/faultRef',
            targetModule: 'artifact',
            targetObjectType: 'ProcessInstance',
            targetObjectId: PROCESS_A,
            referencePurpose: 'WI04_FAULT_PROBE',
          });
          await execution.appendOutbox({
            eventId: 'c1c1c1c1-c1c1-71c1-81c1-c1c1c1c1c101',
            eventType: 'wi04.ProcessRegistered',
            eventVersion: '1.0',
            aggregateType: 'ProcessInstance',
            aggregateId: PROCESS_FAULT,
            aggregateVersion: '1',
            payload: { enterpriseId: ENTERPRISE_A, note: 'fault' },
            occurredAt: new Date(),
          });
          execution.failAfterOutbox();
          return { kind: 'COMMITTED', resultPayload: {} };
        },
      ),
    ).rejects.toMatchObject({ code: 'INJECTED_FAULT' });

    expect(await count('process_instance', `WHERE process_id = '${PROCESS_FAULT}'`)).toBe('0');
    expect(await count('command_receipt', "WHERE idempotency_key = 'wi04-fault'")).toBe('0');
    expect(
      await count('audit_record', "WHERE command_id = 'c0c0c0c0-c0c0-70c0-80c0-c0c0c0c0c101'"),
    ).toBe('0');
    expect(await count('reference_edge', "WHERE reference_purpose = 'WI04_FAULT_PROBE'")).toBe('0');
    expect(
      await count('outbox_event', "WHERE event_id = 'c1c1c1c1-c1c1-71c1-81c1-c1c1c1c1c101'"),
    ).toBe('0');
  });

  it('stores and replays a stable rejected result without changing the aggregate', async () => {
    const rejected = await executeArtifactCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'd0d0d0d0-d0d0-70d0-80d0-d0d0d0d0d101',
        idempotencyKey: 'wi04-reject',
        commandType: 'wi04.reject-demo',
        targetId: PROCESS_REJECT,
        requestPayload: { op: 'invalid-transition' },
      }),
      async (execution) => {
        const current = await repo.getProcessInstanceById(execution.trx, PROCESS_A);
        return {
          kind: 'REJECTED',
          errorCode: 'WI04_INVALID_TRANSITION',
          safeSummary: 'status transition not allowed',
          currentAggregateVersion: current?.aggregate_version,
        } as const;
      },
    );
    expect(rejected).toMatchObject({ status: 'REJECTED', errorCode: 'WI04_INVALID_TRANSITION' });
    const replay = await executeArtifactCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: 'd0d0d0d0-d0d0-70d0-80d0-d0d0d0d0d102',
        idempotencyKey: 'wi04-reject',
        commandType: 'wi04.reject-demo',
        targetId: PROCESS_REJECT,
        requestPayload: { op: 'invalid-transition' },
      }),
      () => Promise.reject(new Error('rejected replay must not execute the body')),
    );
    expect(replay).toMatchObject({
      status: 'DUPLICATE',
      originalOutcome: 'REJECTED',
      errorCode: 'WI04_INVALID_TRANSITION',
    });
  });

  it('rejects hash, scope, target and owner mismatches before any receipt commits', async () => {
    await expect(
      executeArtifactCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'e0e0e0e0-e0e0-70e0-80e0-e0e0e0e0e101',
          idempotencyKey: 'wi04-hash-mismatch',
          commandType: 'wi04.hash-mismatch',
          requestPayload: { op: 'hash-mismatch' },
        }),
        async (execution) => {
          await execution.appendOutbox({
            eventId: 'e1e1e1e1-e1e1-71e1-81e1-e1e1e1e1e101',
            eventType: 'wi04.BadEvent',
            eventVersion: '1.0',
            aggregateType: 'ProcessInstance',
            aggregateId: PROCESS_A,
            aggregateVersion: '1',
            payload: { enterpriseId: ENTERPRISE_A, note: 'will-not-match' },
            declaredHash: Buffer.alloc(32, 0xff),
            occurredAt: new Date(),
          });
          return { kind: 'COMMITTED', resultPayload: {} };
        },
      ),
    ).rejects.toMatchObject({ code: PAYLOAD_HASH_MISMATCH });
    expect(await count('outbox_event', "WHERE event_type = 'wi04.BadEvent'")).toBe('0');
    expect(await count('command_receipt', "WHERE idempotency_key = 'wi04-hash-mismatch'")).toBe(
      '0',
    );

    await expect(
      executeArtifactCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'e0e0e0e0-e0e0-70e0-80e0-e0e0e0e0e102',
          idempotencyKey: 'wi04-scope-mirror',
          commandType: 'wi04.scope-mirror',
          requestPayload: { op: 'scope-mirror' },
        }),
        async (execution) => {
          await execution.appendOutbox({
            eventId: 'e1e1e1e1-e1e1-71e1-81e1-e1e1e1e1e102',
            eventType: 'wi04.ScopeEvent',
            eventVersion: '1.0',
            aggregateType: 'ProcessInstance',
            aggregateId: PROCESS_A,
            aggregateVersion: '1',
            payload: { note: 'missing scope mirror' },
            occurredAt: new Date(),
          });
          return { kind: 'COMMITTED', resultPayload: {} };
        },
      ),
    ).rejects.toMatchObject({ code: PAYLOAD_HASH_MISMATCH });
    expect(await count('outbox_event', "WHERE event_type = 'wi04.ScopeEvent'")).toBe('0');

    await expect(
      executeArtifactCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'e0e0e0e0-e0e0-70e0-80e0-e0e0e0e0e103',
          idempotencyKey: 'wi04-target-mismatch',
          commandType: 'wi04.target-mismatch',
          requestPayload: { op: 'target-mismatch' },
        }),
        async (execution) => {
          await execution.appendOutbox({
            eventId: 'e1e1e1e1-e1e1-71e1-81e1-e1e1e1e1e103',
            eventType: 'wi04.TargetEvent',
            eventVersion: '1.0',
            aggregateType: 'ProcessInstance',
            aggregateId: PROCESS_B,
            aggregateVersion: '1',
            payload: { enterpriseId: ENTERPRISE_A },
            occurredAt: new Date(),
          });
          return { kind: 'COMMITTED', resultPayload: {} };
        },
      ),
    ).rejects.toMatchObject({ code: COMMAND_TARGET_MISMATCH });
    expect(await count('command_receipt', "WHERE idempotency_key = 'wi04-target-mismatch'")).toBe(
      '0',
    );

    await expect(
      executeArtifactCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'e0e0e0e0-e0e0-70e0-80e0-e0e0e0e0e104',
          idempotencyKey: 'wi04-owner-mismatch',
          commandType: 'wi04.owner-mismatch',
          requestPayload: { op: 'owner-mismatch' },
        }),
        async (execution) => {
          await execution.appendReferenceEdge({
            ownerObjectType: 'ProcessInstance',
            ownerObjectId: PROCESS_B,
            referencePath: '/wrongOwner',
            targetModule: 'artifact',
            targetObjectType: 'ProcessInstance',
            targetObjectId: PROCESS_A,
            referencePurpose: 'WI04_OWNER_MISMATCH',
          });
          return { kind: 'COMMITTED', resultPayload: {} };
        },
      ),
    ).rejects.toMatchObject({ code: COMMAND_TARGET_MISMATCH });
    expect(await count('reference_edge', "WHERE reference_purpose = 'WI04_OWNER_MISMATCH'")).toBe(
      '0',
    );
  });

  it('supports Enterprise and Project RLS scopes and rejects a forged creator', async () => {
    const enterprise = await executeArtifactCommand(
      db,
      contextFor(ENTERPRISE_A),
      envelope({
        commandId: '90909090-9090-7090-8090-909090909001',
        idempotencyKey: 'wi04-enterprise-scope',
        commandType: 'wi04.enterprise-scope',
        requestPayload: { op: 'enterprise-scope' },
      }),
      async (execution) => {
        await execution.appendOutbox({
          eventId: '91919191-9191-7191-8191-919191919101',
          eventType: 'wi04.EnterpriseScoped',
          eventVersion: '1.0',
          aggregateType: 'ProcessInstance',
          aggregateId: PROCESS_A,
          aggregateVersion: '1',
          payload: { enterpriseId: ENTERPRISE_A, note: 'enterprise' },
          occurredAt: new Date(),
        });
        return { kind: 'COMMITTED', resultPayload: { scope: 'enterprise' } };
      },
    );
    expect(enterprise).toMatchObject({ status: 'COMMITTED' });

    const project = await executeArtifactCommand(
      db,
      contextFor(ENTERPRISE_A, [PROJECT_A1]),
      envelope({
        commandId: '90909090-9090-7090-8090-909090909002',
        idempotencyKey: 'wi04-project-scope',
        commandType: 'wi04.project-scope',
        projectId: PROJECT_A1,
        targetId: PROCESS_PROJECT,
        requestPayload: { op: 'project-scope' },
      }),
      async (execution) => {
        await repo.insertProcessInstance(execution.trx, processInsert(PROCESS_PROJECT, PROJECT_A1));
        await execution.appendOutbox({
          eventId: '91919191-9191-7191-8191-919191919102',
          eventType: 'wi04.ProjectScoped',
          eventVersion: '1.0',
          aggregateType: 'ProcessInstance',
          aggregateId: PROCESS_PROJECT,
          aggregateVersion: '1',
          payload: { enterpriseId: ENTERPRISE_A, projectId: PROJECT_A1, note: 'project' },
          occurredAt: new Date(),
        });
        return { kind: 'COMMITTED', resultPayload: { scope: 'project' } };
      },
    );
    expect(project).toMatchObject({ status: 'COMMITTED' });

    await expect(
      executeArtifactCommand(
        db,
        contextFor(ENTERPRISE_A, [PROJECT_A1]),
        envelope({
          commandId: '90909090-9090-7090-8090-909090909003',
          idempotencyKey: 'wi04-cross-project',
          commandType: 'wi04.cross-project',
          projectId: PROJECT_A2,
          requestPayload: { op: 'cross-project' },
        }),
        () => Promise.resolve({ kind: 'COMMITTED', resultPayload: { invalid: true } }),
      ),
    ).rejects.toMatchObject({ code: COMMAND_CONTEXT_MISMATCH });

    await expect(
      executeArtifactCommand(
        db,
        contextFor(ENTERPRISE_A, [PROJECT_A1]),
        envelope({
          commandId: '90909090-9090-7090-8090-909090909004',
          idempotencyKey: 'wi04-cross-project-write',
          commandType: 'wi04.cross-project-write',
          projectId: PROJECT_A1,
          targetId: PROCESS_DIRECT,
          requestPayload: { op: 'cross-project-write' },
        }),
        async (execution) => {
          await repo.insertProcessInstance(
            execution.trx,
            processInsert(PROCESS_DIRECT, PROJECT_A2),
          );
          return { kind: 'COMMITTED', resultPayload: { invalid: true } };
        },
      ),
    ).rejects.toMatchObject({ code: 'ARTIFACT_CONTEXT_SCOPE_MISMATCH' });

    await expect(
      executeArtifactCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'a9a9a9a9-a9a9-79a9-89a9-a9a9a9a9a901',
          idempotencyKey: 'wi04-principal-bind',
          commandType: 'wi04.principal-bind',
          targetId: PROCESS_PRINCIPAL,
          requestPayload: { op: 'principal-bind' },
        }),
        async (execution) => {
          await repo.insertProcessInstance(
            execution.trx,
            processInsert(
              PROCESS_PRINCIPAL,
              undefined,
              ENTERPRISE_A,
              '00000000-0000-7000-8000-000000000099',
            ),
          );
          return { kind: 'COMMITTED', resultPayload: { invalid: true } };
        },
      ),
    ).rejects.toBeInstanceOf(ArtifactPersistenceError);
    expect(await count('process_instance', `WHERE process_id = '${PROCESS_PRINCIPAL}'`)).toBe('0');
  });

  it('denies uncontextualized, forged, cross-schema and DDL App Role operations', async () => {
    await executeArtifactCommand(
      db,
      contextFor(ENTERPRISE_B),
      envelope({
        commandId: 'aaaaaaa3-aaaa-7aaa-8aaa-aaaaaaaaaa03',
        idempotencyKey: 'wi04-enterprise-b',
        commandType: 'wi04.enterprise-b',
        enterpriseId: ENTERPRISE_B,
        targetId: PROCESS_B,
        requestPayload: { op: 'enterprise-b' },
      }),
      async (execution) => {
        await repo.insertProcessInstance(
          execution.trx,
          processInsert(PROCESS_B, undefined, ENTERPRISE_B),
        );
        return { kind: 'COMMITTED', resultPayload: { scope: 'B' } };
      },
    );

    await probe.query('BEGIN');
    await probe.query('SET LOCAL ROLE artifact_app');
    const noContextRead = await probe.query<{ count: string }>(
      `SELECT count(*) AS count FROM artifact.command_receipt`,
    );
    expect(noContextRead.rows[0]?.count).toBe('0');
    const noContextInsert = await tryQuery(
      probe,
      `INSERT INTO artifact.command_receipt (
         command_id, command_type, command_version, idempotency_scope, idempotency_key,
         request_payload_hash, enterprise_id, target_type, target_id, outcome,
         correlation_id, created_by_principal_id, actor_snapshot_id, authorization_decision_id)
       VALUES ($1, 'wi04.no-context', '1.0', 'wi04', 'wi04-no-context', $2, $3,
               'ProcessInstance', $4, 'PENDING', $5, $6, $7, $8)`,
      [
        'aaaaaaa1-aaaa-7aaa-8aaa-aaaaaaaaaa01',
        Buffer.alloc(32, 1),
        ENTERPRISE_A,
        PROCESS_A,
        CORRELATION,
        OPERATOR,
        OPERATOR_ACTOR,
        DECISION,
      ],
    );
    expect(noContextInsert.code).toBe('42501');
    await probe.query('ROLLBACK');

    await probe.query('BEGIN');
    await probe.query(`SET LOCAL app.zju.principal_id = 'forged'`);
    await probe.query('SET LOCAL ROLE artifact_app');
    const forgedGuc = await probe.query<{ count: string }>(
      `SELECT count(*) AS count FROM artifact.command_receipt`,
    );
    expect(forgedGuc.rows[0]?.count).toBe('0');
    await probe.query('ROLLBACK');

    await probe.query('BEGIN');
    await establishDirectContext(probe, { allowedProjectIds: [PROJECT_A1] });
    const foreign = await probe.query<{ count: string }>(
      `SELECT count(*) AS count FROM artifact.process_instance WHERE enterprise_id = $1`,
      [ENTERPRISE_B],
    );
    expect(foreign.rows[0]?.count).toBe('0');
    const crossSchema = await tryQuery(
      probe,
      `SELECT count(*) FROM enterprise_project.command_receipt`,
    );
    expect(crossSchema.code).toBe('42501');
    await probe.query('ROLLBACK');

    await probe.query('BEGIN');
    await establishDirectContext(probe);
    const crossProject = await tryQuery(
      probe,
      `INSERT INTO artifact.process_instance (
         process_id, process_type, process_version, correlation_key,
         enterprise_id, project_id, state, created_by_principal_id)
       VALUES ($1, 'wi04.direct', '1.0', 'cross-project', $2, $3, 'ACTIVE', $4)`,
      [PROCESS_DIRECT, ENTERPRISE_A, PROJECT_A2, OPERATOR],
    );
    expect(crossProject.code).toBe('42501');
    await probe.query('ROLLBACK');

    await probe.query('BEGIN');
    const ddl = await tryQuery(probe, `CREATE TABLE artifact.im04_forbidden (id integer)`);
    expect(ddl.code).toBe('42501');
    await probe.query('ROLLBACK');

    await probe.query('BEGIN');
    const setOwner = await tryQuery(probe, `SET LOCAL ROLE artifact_owner`);
    expect(setOwner.code).toBe('42501');
    await probe.query('ROLLBACK');
  });

  it('expires direct Contexts, mirrors Process Step scope and preserves owner-version edge uniqueness', async () => {
    await probe.query('BEGIN');
    await establishDirectContext(probe, {
      allowedProjectIds: [PROJECT_A1],
      expiresAt: new Date(Date.now() + 500),
    });
    await probe.query(`SELECT pg_sleep(0.8)`);
    const expiredRead = await probe.query<{ count: string }>(
      `SELECT count(*) AS count FROM artifact.process_instance`,
    );
    expect(expiredRead.rows[0]?.count).toBe('0');
    await probe.query('ROLLBACK');

    await probe.query('BEGIN');
    await establishDirectContext(probe, { allowedProjectIds: [PROJECT_A1, PROJECT_A2] });
    await probe.query(
      `INSERT INTO artifact.process_instance (
         process_id, process_type, process_version, correlation_key,
         enterprise_id, project_id, state, created_by_principal_id)
       VALUES ($1, 'wi04.step', '1.0', 'scope-mirror', $2, $3, 'ACTIVE', $4)`,
      [PROCESS_DIRECT, ENTERPRISE_A, PROJECT_A1, OPERATOR],
    );
    const mismatchedStep = await tryQuery(
      probe,
      `INSERT INTO artifact.process_step (
         process_step_id, process_id, step_no, enterprise_id, project_id,
         outcome, created_by_principal_id)
       VALUES ('12345678-1234-7123-8123-444444444444', $1, 1, $2, $3, 'STARTED', $4)`,
      [PROCESS_DIRECT, ENTERPRISE_A, PROJECT_A2, OPERATOR],
    );
    expect(mismatchedStep.code).toBe('23514');
    expect(mismatchedStep.message).toMatch(/process step scope mismatch/);
    await probe.query('ROLLBACK');

    const edge = {
      ownerObjectType: 'Demo',
      ownerObjectId: '12345678-1234-7123-8123-444444444445',
      referencePath: '/target',
      targetModule: 'artifact',
      targetObjectType: 'ProcessInstance',
      targetObjectId: PROCESS_A,
      referencePurpose: 'WI04_OWNER_VERSION',
      enterpriseId: ENTERPRISE_A,
      sourceCommandId: '12345678-1234-7123-8123-444444444448',
    };
    const insertEdge = async (ownerVersionId: string): Promise<StatementOutcome> => {
      await probe.query('BEGIN');
      await establishDirectContext(probe);
      const result = await tryQuery(
        probe,
        `INSERT INTO artifact.reference_edge (
           owner_object_type, owner_object_id, owner_version_id, reference_path,
           target_module, target_object_type, target_object_id, reference_purpose,
           enterprise_id, source_command_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          edge.ownerObjectType,
          edge.ownerObjectId,
          ownerVersionId,
          edge.referencePath,
          edge.targetModule,
          edge.targetObjectType,
          edge.targetObjectId,
          edge.referencePurpose,
          edge.enterpriseId,
          edge.sourceCommandId,
        ],
      );
      if (result.allowed) await probe.query('COMMIT');
      else await probe.query('ROLLBACK');
      return result;
    };
    const versionA = '12345678-1234-7123-8123-444444444449';
    const versionB = '12345678-1234-7123-8123-444444444450';
    await expect(insertEdge(versionA)).resolves.toMatchObject({ allowed: true });
    await expect(insertEdge(versionB)).resolves.toMatchObject({ allowed: true });
    const duplicate = await insertEdge(versionA);
    expect(duplicate.code).toBe('23505');
  });
});
