import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  CommandExecutionError,
  COMMAND_CONTEXT_EXPIRED,
  COMMAND_CONTEXT_MISMATCH,
  COMMAND_TARGET_MISMATCH,
  CONCURRENCY_CONFLICT,
  executeEnterpriseProjectCommand,
  EnterpriseProjectRepository,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  PAYLOAD_HASH_MISMATCH,
  createEnterpriseProjectDatabase,
  type CommandEnvelope,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';

// IM-03 WI-02 (issue #58): EnterpriseProject application/persistence
// foundation on real PostgreSQL. No business tables; CAS uses the
// process_instance technical aggregate. Authorization is a trusted
// snapshot binding — this suite never imports IdentityPolicy internals.

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

function contextFor(
  enterpriseId: string,
  allowedProjectIds: readonly string[] = [],
): EnterpriseProjectTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: OPERATOR,
    actorSnapshotId: OPERATOR_ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: DECISION_HASH,
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY,
    enterpriseId,
    allowedProjectIds,
    correlationId: CORRELATION,
  };
}

function envelope(overrides: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    commandId: 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f101',
    commandType: 'wi02.demo.command',
    commandVersion: '1.0',
    idempotencyScope: 'wi02',
    idempotencyKey: 'wi02-key-1',
    requestPayload: { op: 'register', note: 'WI-02 Fixture' },
    enterpriseId: ENTERPRISE_A,
    targetType: 'ProcessInstance',
    targetId: PROCESS_A,
    correlationId: CORRELATION,
    principalId: OPERATOR,
    actorSnapshotId: OPERATOR_ACTOR,
    authorizationDecisionId: DECISION,
    policySnapshotId: POLICY,
    ...overrides,
  };
}

function processInsert(processId: string, projectId?: string) {
  return {
    processId,
    processType: 'wi02.demo',
    processVersion: '1.0',
    correlationKey: `wi02:${processId}`,
    enterpriseId: ENTERPRISE_A,
    ...(projectId === undefined ? {} : { projectId }),
    createdByPrincipalId: OPERATOR,
  };
}

describe.skipIf(!gateEnabled)(
  'EnterpriseProject command transaction runner (real PostgreSQL)',
  () => {
    let admin: pg.Client;
    let pool: pg.Pool;
    let db: ReturnType<typeof createEnterpriseProjectDatabase>;
    let repo: EnterpriseProjectRepository;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(
        `CREATE ROLE im03_wi02_probe LOGIN PASSWORD 'im03-wi02-probe' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await admin.query(
        `GRANT platform_context_establisher, enterprise_project_app TO im03_wi02_probe`,
      );
      const url = new URL(databaseUrl ?? '');
      url.username = 'im03_wi02_probe';
      url.password = 'im03-wi02-probe';
      pool = new pg.Pool({ connectionString: url.toString(), max: 3 });
      db = createEnterpriseProjectDatabase(pool);
      repo = new EnterpriseProjectRepository();
    });

    afterAll(async () => {
      await pool.end();
      await admin.end();
    });

    async function count(table: string, where = '') {
      const result = await admin.query<{ count: string }>(
        `SELECT count(*) AS count FROM enterprise_project.${table} ${where}`,
      );
      return result.rows[0]?.count ?? '-1';
    }

    async function waitForBlockedProbeSession(): Promise<void> {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const blocked = await admin.query<{ count: string }>(
          `SELECT count(*) AS count
             FROM pg_stat_activity
            WHERE usename = 'im03_wi02_probe' AND wait_event_type = 'Lock'`,
        );
        if (Number(blocked.rows[0]?.count ?? '0') > 0) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('concurrent command did not reach the database claim lock');
    }

    it('commits receipt, process, audit, outbox and reference edge, then replays (PG-U-009)', async () => {
      const first = await executeEnterpriseProjectCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope(),
        async (execution) => {
          await repo.insertProcessInstance(execution.trx, processInsert(PROCESS_A));
          await execution.appendReferenceEdge({
            ownerObjectType: 'ProcessInstance',
            ownerObjectId: PROCESS_A,
            referencePath: '/fixtureRef',
            targetModule: 'EnterpriseProject',
            targetObjectType: 'ProcessInstance',
            targetObjectId: PROCESS_A,
            referencePurpose: 'WI02_COMMIT_PROBE',
          });
          await execution.appendOutbox({
            eventId: 'f2f2f2f2-f2f2-72f2-82f2-f2f2f2f2f201',
            eventType: 'wi02.ProcessRegistered',
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
      expect(first).toMatchObject({ status: 'COMMITTED' });
      expect(await count('command_receipt', "WHERE idempotency_key = 'wi02-key-1'")).toBe('1');
      expect(await count('outbox_event', "WHERE event_type = 'wi02.ProcessRegistered'")).toBe('1');
      expect(
        await count(
          'audit_record',
          "WHERE command_type = 'wi02.demo.command' AND outcome = 'COMMITTED'",
        ),
      ).toBe('1');
      expect(await count('reference_edge', "WHERE reference_purpose = 'WI02_COMMIT_PROBE'")).toBe(
        '1',
      );

      const replay = await executeEnterpriseProjectCommand(
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
        `SELECT aggregate_version::text FROM enterprise_project.process_instance WHERE process_id = $1`,
        [PROCESS_A],
      );
      expect(version.rows[0]?.aggregate_version).toBe('1');
      expect(await count('command_receipt', "WHERE idempotency_key = 'wi02-key-1'")).toBe('1');
      expect(await count('outbox_event', "WHERE event_type = 'wi02.ProcessRegistered'")).toBe('1');
    });

    it('rejects the same key with a different request hash and does not rewrite the first receipt', async () => {
      const before = Number(await count('audit_record', "WHERE outcome = 'DENIED'"));
      let thrown: unknown;
      try {
        await executeEnterpriseProjectCommand(
          db,
          contextFor(ENTERPRISE_A),
          envelope({
            commandId: 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f103',
            requestPayload: { op: 'register', note: 'TAMPERED DIFFERENT PAYLOAD' },
          }),
          () => Promise.resolve({ kind: 'COMMITTED', resultPayload: { never: true } }),
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CommandExecutionError);
      expect((thrown as CommandExecutionError).code).toBe(IDEMPOTENCY_PAYLOAD_CONFLICT);
      expect((thrown as CommandExecutionError).message).not.toContain('TAMPERED');
      expect(Number(await count('audit_record', "WHERE outcome = 'DENIED'"))).toBe(before + 1);
      expect(await count('command_receipt', "WHERE idempotency_key = 'wi02-key-1'")).toBe('1');
      const original = await admin.query<{ outcome: string }>(
        `SELECT outcome FROM enterprise_project.command_receipt WHERE idempotency_key = 'wi02-key-1'`,
      );
      expect(original.rows[0]?.outcome).toBe('COMMITTED');
    });

    it('returns the saved result for concurrent same-key/same-hash claims', async () => {
      let bodyExecutions = 0;
      let signalBodyStarted: (() => void) | undefined;
      let releaseBody: (() => void) | undefined;
      const bodyStarted = new Promise<void>((resolve) => {
        signalBodyStarted = resolve;
      });
      const bodyHold = new Promise<void>((resolve) => {
        releaseBody = resolve;
      });
      const first = executeEnterpriseProjectCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f111',
          idempotencyKey: 'wi02-concurrent-idempotency',
          commandType: 'wi02.concurrent-idempotency',
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
      const second = executeEnterpriseProjectCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'f1f1f1f1-f1f1-71f1-81f1-f1f1f1f1f112',
          idempotencyKey: 'wi02-concurrent-idempotency',
          commandType: 'wi02.concurrent-idempotency',
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
      expect(bodyExecutions).toBe(1);
      expect(
        await count('command_receipt', "WHERE idempotency_key = 'wi02-concurrent-idempotency'"),
      ).toBe('1');
    });

    it('rejects envelope attribution that differs from the trusted snapshots', async () => {
      const mismatches: Partial<CommandEnvelope>[] = [
        { principalId: '00000000-0000-7000-8000-000000000101' },
        { actorSnapshotId: '00000000-0000-7000-8000-000000000102' },
        { authorizationDecisionId: '00000000-0000-7000-8000-000000000103' },
        { policySnapshotId: '00000000-0000-7000-8000-000000000106' },
        { enterpriseId: ENTERPRISE_B },
        { projectId: PROJECT_A2 },
        { correlationId: '00000000-0000-7000-8000-000000000105' },
      ];
      for (const [index, mismatch] of mismatches.entries()) {
        await expect(
          executeEnterpriseProjectCommand(
            db,
            contextFor(ENTERPRISE_A, [PROJECT_A1]),
            envelope({
              commandId: `80808080-8080-7080-8080-80808080810${index}`,
              idempotencyKey: `wi02-context-mismatch-${index}`,
              commandType: 'wi02.context-mismatch',
              ...mismatch,
            }),
            () => Promise.resolve({ kind: 'COMMITTED', resultPayload: { invalid: true } }),
          ),
        ).rejects.toMatchObject({ code: COMMAND_CONTEXT_MISMATCH });
      }
      expect(await count('command_receipt', "WHERE command_type = 'wi02.context-mismatch'")).toBe(
        '0',
      );
    });

    it('adjudicates concurrent same-version CAS with one winner and a rolled-back loser', async () => {
      await executeEnterpriseProjectCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'a0a0a0a0-a0a0-70a0-80a0-a0a0a0a0a101',
          idempotencyKey: 'wi02-cas-setup',
          targetId: PROCESS_CONCURRENCY,
          requestPayload: { op: 'register', target: 'concurrency' },
        }),
        async (execution) => {
          await repo.insertProcessInstance(execution.trx, processInsert(PROCESS_CONCURRENCY));
          return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_CONCURRENCY } };
        },
      );

      const runAdvance = (key: string) =>
        executeEnterpriseProjectCommand(
          db,
          contextFor(ENTERPRISE_A),
          envelope({
            commandId: `a0a0a0a0-a0a0-70a0-80a0-a0a0a0a0a1${key === 'a' ? '02' : '03'}`,
            idempotencyKey: key,
            commandType: 'wi02.advance',
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
              eventType: 'wi02.ProcessAdvanced',
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
        `SELECT aggregate_version::text, state FROM enterprise_project.process_instance WHERE process_id = $1`,
        [PROCESS_CONCURRENCY],
      );
      expect(process.rows[0]).toEqual({ aggregate_version: '2', state: 'SUSPENDED' });
      expect(await count('command_receipt', "WHERE command_type = 'wi02.advance'")).toBe('1');
      expect(await count('outbox_event', "WHERE event_type = 'wi02.ProcessAdvanced'")).toBe('1');
    });

    it('binds CAS to the envelope and increments bigint versions without precision loss', async () => {
      await executeEnterpriseProjectCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'b0b0b0b0-b0b0-70b0-80b0-b0b0b0b0b101',
          idempotencyKey: 'wi02-bigint-setup',
          targetId: PROCESS_BIGINT,
          requestPayload: { op: 'bigint-setup' },
        }),
        async (execution) => {
          await repo.insertProcessInstance(execution.trx, processInsert(PROCESS_BIGINT));
          return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_BIGINT } };
        },
      );
      await admin.query(
        `UPDATE enterprise_project.process_instance SET aggregate_version = 9007199254740993 WHERE process_id = $1`,
        [PROCESS_BIGINT],
      );

      await expect(
        executeEnterpriseProjectCommand(
          db,
          contextFor(ENTERPRISE_A),
          envelope({
            commandId: 'b0b0b0b0-b0b0-70b0-80b0-b0b0b0b0b111',
            idempotencyKey: 'wi02-cas-envelope-mismatch',
            commandType: 'wi02.cas-envelope-mismatch',
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

      const committed = await executeEnterpriseProjectCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'b0b0b0b0-b0b0-70b0-80b0-b0b0b0b0b121',
          idempotencyKey: 'wi02-bigint-cas',
          commandType: 'wi02.bigint-cas',
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
        `SELECT aggregate_version::text FROM enterprise_project.process_instance WHERE process_id = $1`,
        [PROCESS_BIGINT],
      );
      expect(version.rows[0]?.aggregate_version).toBe('9007199254740994');
    });

    it('rolls back receipt, process, audit, outbox and reference edge after an injected fault', async () => {
      await expect(
        executeEnterpriseProjectCommand(
          db,
          contextFor(ENTERPRISE_A),
          envelope({
            commandId: 'c0c0c0c0-c0c0-70c0-80c0-c0c0c0c0c101',
            idempotencyKey: 'wi02-fault',
            targetId: PROCESS_FAULT,
            requestPayload: { op: 'register-fault' },
          }),
          async (execution) => {
            await repo.insertProcessInstance(execution.trx, processInsert(PROCESS_FAULT));
            await execution.appendReferenceEdge({
              ownerObjectType: 'ProcessInstance',
              ownerObjectId: PROCESS_FAULT,
              referencePath: '/faultRef',
              targetModule: 'EnterpriseProject',
              targetObjectType: 'ProcessInstance',
              targetObjectId: PROCESS_A,
              referencePurpose: 'WI02_FAULT_PROBE',
            });
            await execution.appendOutbox({
              eventId: 'c1c1c1c1-c1c1-71c1-81c1-c1c1c1c1c101',
              eventType: 'wi02.ProcessRegistered',
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

      expect(
        await admin
          .query<{ count: string }>(
            `SELECT count(*) AS count FROM enterprise_project.process_instance WHERE process_id = $1`,
            [PROCESS_FAULT],
          )
          .then((result) => result.rows[0]?.count),
      ).toBe('0');
      expect(await count('command_receipt', "WHERE idempotency_key = 'wi02-fault'")).toBe('0');
      expect(
        await count('audit_record', "WHERE command_id = 'c0c0c0c0-c0c0-70c0-80c0-c0c0c0c0c101'"),
      ).toBe('0');
      expect(await count('reference_edge', "WHERE reference_purpose = 'WI02_FAULT_PROBE'")).toBe(
        '0',
      );
      expect(
        await count('outbox_event', "WHERE event_id = 'c1c1c1c1-c1c1-71c1-81c1-c1c1c1c1c101'"),
      ).toBe('0');
    });

    it('persists a stable REJECTED receipt without touching the aggregate, and replays it', async () => {
      const rejected = await executeEnterpriseProjectCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'd0d0d0d0-d0d0-70d0-80d0-d0d0d0d0d101',
          idempotencyKey: 'wi02-reject',
          commandType: 'wi02.reject-demo',
          targetId: PROCESS_REJECT,
          requestPayload: { op: 'invalid-transition' },
        }),
        async (execution) => {
          const current = await repo.getProcessInstanceById(execution.trx, PROCESS_A);
          return {
            kind: 'REJECTED',
            errorCode: 'WI02_INVALID_TRANSITION',
            safeSummary: 'status transition not allowed',
            currentAggregateVersion: current?.aggregate_version,
          } as const;
        },
      );
      expect(rejected).toMatchObject({ status: 'REJECTED', errorCode: 'WI02_INVALID_TRANSITION' });
      const replay = await executeEnterpriseProjectCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: 'd0d0d0d0-d0d0-70d0-80d0-d0d0d0d0d102',
          idempotencyKey: 'wi02-reject',
          commandType: 'wi02.reject-demo',
          targetId: PROCESS_REJECT,
          requestPayload: { op: 'invalid-transition' },
        }),
        () => Promise.reject(new Error('rejected replay must not execute the body')),
      );
      expect(replay).toMatchObject({
        status: 'DUPLICATE',
        originalOutcome: 'REJECTED',
        errorCode: 'WI02_INVALID_TRANSITION',
      });
    });

    it('rejects canonical hash and promoted scope mismatches before writing', async () => {
      await expect(
        executeEnterpriseProjectCommand(
          db,
          contextFor(ENTERPRISE_A),
          envelope({
            commandId: 'e0e0e0e0-e0e0-70e0-80e0-e0e0e0e0e101',
            idempotencyKey: 'wi02-hash-mismatch',
            commandType: 'wi02.hash-mismatch',
            requestPayload: { op: 'hash-mismatch' },
          }),
          async (execution) => {
            await execution.appendOutbox({
              eventId: 'e1e1e1e1-e1e1-71e1-81e1-e1e1e1e1e101',
              eventType: 'wi02.BadEvent',
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
      expect(await count('outbox_event', "WHERE event_type = 'wi02.BadEvent'")).toBe('0');
      expect(await count('command_receipt', "WHERE idempotency_key = 'wi02-hash-mismatch'")).toBe(
        '0',
      );

      await expect(
        executeEnterpriseProjectCommand(
          db,
          contextFor(ENTERPRISE_A),
          envelope({
            commandId: 'e0e0e0e0-e0e0-70e0-80e0-e0e0e0e0e102',
            idempotencyKey: 'wi02-scope-mirror',
            commandType: 'wi02.scope-mirror',
            requestPayload: { op: 'scope-mirror' },
          }),
          async (execution) => {
            await execution.appendOutbox({
              eventId: 'e1e1e1e1-e1e1-71e1-81e1-e1e1e1e1e102',
              eventType: 'wi02.ScopeEvent',
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
      expect(await count('outbox_event', "WHERE event_type = 'wi02.ScopeEvent'")).toBe('0');
    });

    it('supports Enterprise and Project RLS fixtures and rejects cross-project writes', async () => {
      const enterprise = await executeEnterpriseProjectCommand(
        db,
        contextFor(ENTERPRISE_A),
        envelope({
          commandId: '90909090-9090-7090-8090-909090909001',
          idempotencyKey: 'wi02-enterprise-scope',
          commandType: 'wi02.enterprise-scope',
          requestPayload: { op: 'enterprise-scope' },
        }),
        async (execution) => {
          await execution.appendOutbox({
            eventId: '91919191-9191-7191-8191-919191919101',
            eventType: 'wi02.EnterpriseScoped',
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

      const project = await executeEnterpriseProjectCommand(
        db,
        contextFor(ENTERPRISE_A, [PROJECT_A1]),
        envelope({
          commandId: '90909090-9090-7090-8090-909090909002',
          idempotencyKey: 'wi02-project-scope',
          commandType: 'wi02.project-scope',
          projectId: PROJECT_A1,
          targetId: PROCESS_PROJECT,
          requestPayload: { op: 'project-scope' },
        }),
        async (execution) => {
          await repo.insertProcessInstance(
            execution.trx,
            processInsert(PROCESS_PROJECT, PROJECT_A1),
          );
          await execution.appendOutbox({
            eventId: '91919191-9191-7191-8191-919191919102',
            eventType: 'wi02.ProjectScoped',
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
        executeEnterpriseProjectCommand(
          db,
          contextFor(ENTERPRISE_A, [PROJECT_A1]),
          envelope({
            commandId: '90909090-9090-7090-8090-909090909003',
            idempotencyKey: 'wi02-cross-project',
            commandType: 'wi02.cross-project',
            projectId: PROJECT_A2,
            requestPayload: { op: 'cross-project' },
          }),
          () => Promise.resolve({ kind: 'COMMITTED', resultPayload: { invalid: true } }),
        ),
      ).rejects.toMatchObject({ code: COMMAND_CONTEXT_MISMATCH });

      await expect(
        executeEnterpriseProjectCommand(
          db,
          contextFor(ENTERPRISE_A, [PROJECT_A1]),
          envelope({
            commandId: '90909090-9090-7090-8090-909090909004',
            idempotencyKey: 'wi02-cross-project-write',
            commandType: 'wi02.cross-project-write',
            projectId: PROJECT_A1,
            requestPayload: { op: 'cross-project-write' },
          }),
          async (execution) => {
            await repo.insertProcessInstance(execution.trx, {
              processId: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeee1',
              processType: 'wi02.demo',
              processVersion: '1.0',
              correlationKey: 'wi02:cross-write',
              enterpriseId: ENTERPRISE_A,
              projectId: PROJECT_A2,
              createdByPrincipalId: OPERATOR,
            });
            return { kind: 'COMMITTED', resultPayload: { invalid: true } };
          },
        ),
      ).rejects.toThrow();
      expect(
        await count('command_receipt', "WHERE idempotency_key = 'wi02-cross-project-write'"),
      ).toBe('0');
    });

    it('rejects missing, forged and expired context and does not leak context across pool checkouts', async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE enterprise_project_app');
        await expect(
          client.query(
            `INSERT INTO enterprise_project.command_receipt (
               command_id, command_type, command_version, idempotency_scope, idempotency_key,
               request_payload_hash, enterprise_id, target_type, target_id, outcome,
               correlation_id, created_by_principal_id, actor_snapshot_id, authorization_decision_id)
             VALUES (
               'aaaaaaa1-aaaa-7aaa-8aaa-aaaaaaaaaa01', 'wi02.no-context', '1.0', 'wi02',
               'wi02-no-context', $1, $2, 'ProcessInstance', $3, 'PENDING', $4, $5, $6, $7)`,
            [
              Buffer.alloc(32, 1),
              ENTERPRISE_A,
              PROCESS_A,
              CORRELATION,
              OPERATOR,
              OPERATOR_ACTOR,
              DECISION,
            ],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await client.query('ROLLBACK');

        await client.query('BEGIN');
        await client.query(`SET LOCAL app.zju.principal_id = 'forged'`);
        await client.query('SET LOCAL ROLE enterprise_project_app');
        await expect(
          client.query(`SELECT count(*) FROM enterprise_project.command_receipt`),
        ).resolves.toMatchObject({ rows: [{ count: '0' }] });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }

      await expect(
        executeEnterpriseProjectCommand(
          db,
          {
            ...contextFor(ENTERPRISE_A),
            authorizationDecisionExpiresAt: new Date(Date.now() - 60_000),
          },
          envelope({
            commandId: 'aaaaaaa2-aaaa-7aaa-8aaa-aaaaaaaaaa02',
            idempotencyKey: 'wi02-expired',
            commandType: 'wi02.expired',
            requestPayload: { op: 'expired' },
          }),
          () => Promise.resolve({ kind: 'COMMITTED', resultPayload: { invalid: true } }),
        ),
      ).rejects.toMatchObject({ code: COMMAND_CONTEXT_EXPIRED });
      expect(await count('command_receipt', "WHERE idempotency_key = 'wi02-expired'")).toBe('0');

      await executeEnterpriseProjectCommand(
        db,
        contextFor(ENTERPRISE_B),
        envelope({
          commandId: 'aaaaaaa3-aaaa-7aaa-8aaa-aaaaaaaaaa03',
          idempotencyKey: 'wi02-enterprise-b',
          commandType: 'wi02.enterprise-b',
          enterpriseId: ENTERPRISE_B,
          targetId: PROCESS_B,
          requestPayload: { op: 'enterprise-b' },
        }),
        async (execution) => {
          const visibleA = await execution.trx
            .selectFrom('enterprise_project.command_receipt')
            .selectAll()
            .where('idempotency_key', '=', 'wi02-key-1')
            .executeTakeFirst();
          expect(visibleA).toBeUndefined();
          await repo.insertProcessInstance(execution.trx, {
            processId: PROCESS_B,
            processType: 'wi02.demo',
            processVersion: '1.0',
            correlationKey: `wi02:${PROCESS_B}`,
            enterpriseId: ENTERPRISE_B,
            createdByPrincipalId: OPERATOR,
          });
          return { kind: 'COMMITTED', resultPayload: { scope: 'B' } };
        },
      );

      const leakClient = await pool.connect();
      try {
        await leakClient.query('BEGIN');
        await leakClient.query('SET LOCAL ROLE enterprise_project_app');
        const leftover = await leakClient.query<{ count: string }>(
          `SELECT count(*) AS count FROM enterprise_project.command_receipt`,
        );
        expect(leftover.rows[0]?.count).toBe('0');
        await leakClient.query('ROLLBACK');
      } finally {
        leakClient.release();
      }
    });
  },
);
