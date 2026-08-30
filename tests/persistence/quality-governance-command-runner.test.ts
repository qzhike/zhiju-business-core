import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  CommandExecutionError,
  COMMAND_CONTEXT_EXPIRED,
  COMMAND_CONTEXT_MISMATCH,
  CONCURRENCY_CONFLICT,
  createQualityGovernanceDatabase,
  executeQualityGovernanceCommand,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  QualityGovernanceRepository,
  QUALITY_CONTEXT_PRINCIPAL_MISMATCH,
  type CommandEnvelope,
  type QualityTransactionContext,
} from '@zhiju/quality-governance';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE_A = '10101010-1010-7010-8010-101010101010';
const ENTERPRISE_B = '20202020-2020-7020-8020-202020202020';
const PROJECT_A = '30303030-3030-7030-8030-303030303030';
const PROJECT_B = '40404040-4040-7040-8040-404040404040';
const PRINCIPAL = '50505050-5050-7050-8050-505050505050';
const ACTOR = '60606060-6060-7060-8060-606060606060';
const DECISION = '70707070-7070-7070-8070-707070707070';
const POLICY = '80808080-8080-7080-8080-808080808080';
const CORRELATION = '90909090-9090-7090-8090-909090909090';
const SOURCE_EVENT = 'a0a0a0a0-a0a0-70a0-80a0-a0a0a0a0a0a0';
const PROCESS_COMMIT = 'b0b0b0b0-b0b0-70b0-80b0-b0b0b0b0b0b0';
const PROCESS_CAS = 'c0c0c0c0-c0c0-70c0-80c0-c0c0c0c0c0c0';
const PROCESS_BIGINT = 'd0d0d0d0-d0d0-70d0-80d0-d0d0d0d0d0d0';
const PROCESS_ROLLBACK = 'e0e0e0e0-e0e0-70e0-80e0-e0e0e0e0e0e0';
const DECISION_HASH = Buffer.alloc(32, 0x42);

function context(overrides: Partial<QualityTransactionContext> = {}): QualityTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: DECISION_HASH,
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY,
    enterpriseId: ENTERPRISE_A,
    allowedProjectIds: [PROJECT_A],
    correlationId: CORRELATION,
    ...overrides,
  };
}

function envelope(overrides: Partial<CommandEnvelope> = {}): CommandEnvelope {
  return {
    commandId: '11111111-2222-7333-8444-555555555501',
    commandType: 'quality.foundation.probe',
    commandVersion: '1.0',
    idempotencyScope: 'im05-wi01',
    idempotencyKey: 'quality-commit',
    requestPayload: { action: 'compose', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A },
    enterpriseId: ENTERPRISE_A,
    projectId: PROJECT_A,
    targetType: 'QualityProcess',
    targetId: PROCESS_COMMIT,
    correlationId: CORRELATION,
    principalId: PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR,
    authorizationDecisionId: DECISION,
    policySnapshotId: POLICY,
    ...overrides,
  };
}

function processInsert(processId: string) {
  return {
    processId,
    processType: 'quality.foundation',
    processVersion: '1.0',
    correlationKey: `quality:${processId}`,
    enterpriseId: ENTERPRISE_A,
    projectId: PROJECT_A,
    createdByPrincipalId: PRINCIPAL,
  };
}

interface SqlOutcome {
  allowed: boolean;
  code?: string;
}

describe.skipIf(!gateEnabled)('QualityGovernance transaction foundation (real PostgreSQL)', () => {
  let admin: pg.Client;
  let probe: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createQualityGovernanceDatabase>;
  const repo = new QualityGovernanceRepository();

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    await admin.query(
      `CREATE ROLE im05_wi01_probe LOGIN PASSWORD 'im05-wi01-probe' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(
      `GRANT platform_context_establisher, quality_governance_app TO im05_wi01_probe`,
    );
    const url = new URL(databaseUrl ?? '');
    url.username = 'im05_wi01_probe';
    url.password = 'im05-wi01-probe';
    probe = new pg.Client({ connectionString: url.toString() });
    await probe.connect();
    pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
    db = createQualityGovernanceDatabase(pool);
  });

  afterAll(async () => {
    await probe.end();
    await pool.end();
    await admin.query('DROP ROLE im05_wi01_probe');
    await admin.end();
  });

  async function count(table: string, where = ''): Promise<number> {
    const result = await admin.query<{ count: string }>(
      `SELECT count(*) AS count FROM quality_governance.${table} ${where}`,
    );
    return Number(result.rows[0]?.count ?? '-1');
  }

  async function trySql(client: pg.Client, text: string, values?: unknown[]): Promise<SqlOutcome> {
    try {
      await client.query(text, values);
      return { allowed: true };
    } catch (error) {
      const code = (error as pg.DatabaseError).code;
      return { allowed: false, ...(code === undefined ? {} : { code }) };
    }
  }

  async function establish(
    client: pg.Client,
    enterpriseId = ENTERPRISE_A,
    projects: readonly string[] = [PROJECT_A],
  ): Promise<void> {
    await client.query('SET LOCAL ROLE platform_context_establisher');
    await client.query(
      `SELECT platform_security.establish_transaction_context(
        'REQUEST', $1, $2, $3, $4, $5, $6, $7, $8, NULL)`,
      [
        PRINCIPAL,
        ACTOR,
        DECISION,
        DECISION_HASH,
        new Date(Date.now() + 60 * 60 * 1000),
        enterpriseId,
        [...projects],
        CORRELATION,
      ],
    );
    await client.query('SET LOCAL ROLE quality_governance_app');
  }

  it('atomically commits Receipt, callback, Inbox, Process, Audit, Outbox, and Reference Edge', async () => {
    const eventContext = context({ kind: 'EVENT_CONSUMER', sourceEventId: SOURCE_EVENT });
    const first = await executeQualityGovernanceCommand(
      db,
      eventContext,
      envelope(),
      async (execution) => {
        expect(
          await execution.claimInbox({
            consumerName: 'quality-foundation',
            eventId: SOURCE_EVENT,
            eventType: 'artifact.RevisionSealed',
            eventVersion: '1.0',
            payloadHash: Buffer.alloc(32, 0x31),
            sourceModule: 'artifact',
          }),
        ).toBe('CLAIMED');
        await repo.insertProcessInstance(execution.trx, processInsert(PROCESS_COMMIT));
        await execution.appendProcessStep({
          processStepId: '12121212-1212-7212-8212-121212121212',
          processId: PROCESS_COMMIT,
          stepNo: 1,
          inputEventId: SOURCE_EVENT,
          inputEventType: 'artifact.RevisionSealed',
          outcome: 'COMPLETED',
        });
        await execution.appendReferenceEdge({
          ownerObjectType: 'QualityProcess',
          ownerObjectId: PROCESS_COMMIT,
          ownerVersionId: '13131313-1313-7313-8313-131313131313',
          referencePath: '/revisionRef',
          targetModule: 'artifact',
          targetObjectType: 'ArtifactRevision',
          targetObjectId: '14141414-1414-7414-8414-141414141414',
          targetVersionId: '15151515-1515-7515-8515-151515151515',
          targetPayloadHash: Buffer.alloc(32, 0x32),
          referencePurpose: 'QUALITY_INPUT',
        });
        await execution.appendOutbox({
          eventId: '16161616-1616-7616-8616-161616161616',
          eventType: 'quality.FoundationComposed',
          eventVersion: '1.0',
          aggregateType: 'QualityProcess',
          aggregateId: PROCESS_COMMIT,
          aggregateVersion: '1',
          payload: {
            enterpriseId: ENTERPRISE_A,
            projectId: PROJECT_A,
            status: 'COMMITTED',
          },
          occurredAt: new Date(),
        });
        await execution.completeInbox('quality-foundation', SOURCE_EVENT);
        return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_COMMIT, version: '1' } };
      },
    );
    expect(first).toMatchObject({
      status: 'COMMITTED',
      resultPayload: { processId: PROCESS_COMMIT, version: '1' },
    });
    expect(await count('command_receipt', "WHERE idempotency_key = 'quality-commit'")).toBe(1);
    expect(
      await count(
        'inbox_message',
        "WHERE consumer_name = 'quality-foundation' AND status = 'PROCESSED'",
      ),
    ).toBe(1);
    expect(await count('process_instance', `WHERE process_id = '${PROCESS_COMMIT}'`)).toBe(1);
    expect(await count('process_step', `WHERE process_id = '${PROCESS_COMMIT}'`)).toBe(1);
    expect(await count('outbox_event', "WHERE event_type = 'quality.FoundationComposed'")).toBe(1);
    expect(await count('reference_edge', "WHERE reference_purpose = 'QUALITY_INPUT'")).toBe(1);
    expect(await count('audit_record', "WHERE command_type = 'quality.foundation.probe'")).toBe(1);

    const replay = await executeQualityGovernanceCommand(
      db,
      eventContext,
      envelope({ commandId: '11111111-2222-7333-8444-555555555502' }),
      () => Promise.reject(new Error('replay must not execute callback')),
    );
    expect(replay).toMatchObject({
      status: 'DUPLICATE',
      originalOutcome: 'COMMITTED',
      resultPayload: { processId: PROCESS_COMMIT, version: '1' },
    });
  });

  it('returns a stable different-hash idempotency conflict without exposing unique_violation', async () => {
    await expect(
      executeQualityGovernanceCommand(
        db,
        context({ kind: 'EVENT_CONSUMER', sourceEventId: SOURCE_EVENT }),
        envelope({
          commandId: '11111111-2222-7333-8444-555555555503',
          requestPayload: { action: 'tampered', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A },
        }),
        () => Promise.resolve({ kind: 'COMMITTED', resultPayload: { invalid: true } }),
      ),
    ).rejects.toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT });
    expect(await count('command_receipt', "WHERE idempotency_key = 'quality-commit'")).toBe(1);
  });

  it('allows exactly one concurrent expected-version writer', async () => {
    await executeQualityGovernanceCommand(
      db,
      context(),
      envelope({
        commandId: '21212121-2121-7212-8212-212121212101',
        idempotencyKey: 'quality-cas-setup',
        targetId: PROCESS_CAS,
        requestPayload: { action: 'setup', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A },
      }),
      async (execution) => {
        await repo.insertProcessInstance(execution.trx, processInsert(PROCESS_CAS));
        return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_CAS } };
      },
    );

    const advance = (suffix: 'a' | 'b') =>
      executeQualityGovernanceCommand(
        db,
        context(),
        envelope({
          commandId:
            suffix === 'a'
              ? '21212121-2121-7212-8212-212121212102'
              : '21212121-2121-7212-8212-212121212103',
          commandType: 'quality.foundation.advance',
          idempotencyKey: `quality-cas-${suffix}`,
          targetId: PROCESS_CAS,
          expectedAggregateVersion: '1',
          requestPayload: { action: 'advance', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A },
        }),
        async (execution) => {
          const result = await execution.casProcessInstance(PROCESS_CAS, '1', {
            state: 'SUSPENDED',
          });
          if (result !== 'OK') {
            throw new CommandExecutionError(CONCURRENCY_CONFLICT, 'aggregate moved on');
          }
          await execution.appendOutbox({
            eventId:
              suffix === 'a'
                ? '22222222-2222-7222-8222-222222222201'
                : '22222222-2222-7222-8222-222222222202',
            eventType: 'quality.FoundationAdvanced',
            eventVersion: '1.0',
            aggregateType: 'QualityProcess',
            aggregateId: PROCESS_CAS,
            aggregateVersion: '2',
            payload: { enterpriseId: ENTERPRISE_A, projectId: PROJECT_A, attempt: suffix },
            occurredAt: new Date(),
          });
          return { kind: 'COMMITTED', resultPayload: { winner: suffix } };
        },
      );

    const outcomes = await Promise.allSettled([advance('a'), advance('b')]);
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(
      outcomes.filter(
        (item) =>
          item.status === 'rejected' &&
          (item.reason as CommandExecutionError).code === CONCURRENCY_CONFLICT,
      ),
    ).toHaveLength(1);
    const row = await admin.query<{ aggregate_version: string }>(
      `SELECT aggregate_version::text FROM quality_governance.process_instance WHERE process_id = $1`,
      [PROCESS_CAS],
    );
    expect(row.rows[0]?.aggregate_version).toBe('2');
    expect(await count('outbox_event', "WHERE event_type = 'quality.FoundationAdvanced'")).toBe(1);
  });

  it('preserves PostgreSQL bigint precision across CAS', async () => {
    await executeQualityGovernanceCommand(
      db,
      context(),
      envelope({
        commandId: '31313131-3131-7313-8313-313131313101',
        idempotencyKey: 'quality-bigint-setup',
        targetId: PROCESS_BIGINT,
        requestPayload: {
          action: 'setup-bigint',
          enterpriseId: ENTERPRISE_A,
          projectId: PROJECT_A,
        },
      }),
      async (execution) => {
        await repo.insertProcessInstance(execution.trx, processInsert(PROCESS_BIGINT));
        return { kind: 'COMMITTED', resultPayload: { processId: PROCESS_BIGINT } };
      },
    );
    await admin.query(
      `UPDATE quality_governance.process_instance SET aggregate_version = 9007199254740993 WHERE process_id = $1`,
      [PROCESS_BIGINT],
    );
    const result = await executeQualityGovernanceCommand(
      db,
      context(),
      envelope({
        commandId: '31313131-3131-7313-8313-313131313102',
        commandType: 'quality.foundation.bigint',
        idempotencyKey: 'quality-bigint-cas',
        targetId: PROCESS_BIGINT,
        expectedAggregateVersion: '9007199254740993',
        requestPayload: { action: 'bigint', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A },
      }),
      async (execution) => ({
        kind: 'COMMITTED',
        resultPayload: {
          cas: await execution.casProcessInstance(PROCESS_BIGINT, '9007199254740993'),
        },
      }),
    );
    expect(result).toMatchObject({ status: 'COMMITTED', resultPayload: { cas: 'OK' } });
    const row = await admin.query<{ aggregate_version: string }>(
      `SELECT aggregate_version::text FROM quality_governance.process_instance WHERE process_id = $1`,
      [PROCESS_BIGINT],
    );
    expect(row.rows[0]?.aggregate_version).toBe('9007199254740994');
  });

  it('rolls back every technical row after a post-write injected fault', async () => {
    const rollbackEvent = '41414141-4141-7414-8414-414141414141';
    await expect(
      executeQualityGovernanceCommand(
        db,
        context({ kind: 'EVENT_CONSUMER', sourceEventId: rollbackEvent }),
        envelope({
          commandId: '42424242-4242-7424-8424-424242424242',
          idempotencyKey: 'quality-rollback',
          targetId: PROCESS_ROLLBACK,
          requestPayload: { action: 'rollback', enterpriseId: ENTERPRISE_A, projectId: PROJECT_A },
        }),
        async (execution) => {
          await execution.claimInbox({
            consumerName: 'quality-rollback',
            eventId: rollbackEvent,
            eventType: 'artifact.RevisionSealed',
            eventVersion: '1.0',
            payloadHash: Buffer.alloc(32, 0x55),
            sourceModule: 'artifact',
          });
          await repo.insertProcessInstance(execution.trx, processInsert(PROCESS_ROLLBACK));
          await execution.appendProcessStep({
            processStepId: '43434343-4343-7434-8434-434343434343',
            processId: PROCESS_ROLLBACK,
            stepNo: 1,
            outcome: 'STARTED',
          });
          await execution.appendReferenceEdge({
            ownerObjectType: 'QualityProcess',
            ownerObjectId: PROCESS_ROLLBACK,
            referencePath: '/rollback',
            targetModule: 'artifact',
            targetObjectType: 'ArtifactRevision',
            targetObjectId: '44444444-4444-7444-8444-444444444444',
            referencePurpose: 'ROLLBACK_PROBE',
          });
          await execution.appendOutbox({
            eventId: '45454545-4545-7454-8454-454545454545',
            eventType: 'quality.RollbackProbe',
            eventVersion: '1.0',
            aggregateType: 'QualityProcess',
            aggregateId: PROCESS_ROLLBACK,
            aggregateVersion: '1',
            payload: { enterpriseId: ENTERPRISE_A, projectId: PROJECT_A },
            occurredAt: new Date(),
          });
          return execution.failAfterTechnicalWrites();
        },
      ),
    ).rejects.toMatchObject({ code: 'INJECTED_FAULT' });
    expect(await count('command_receipt', "WHERE idempotency_key = 'quality-rollback'")).toBe(0);
    expect(await count('inbox_message', "WHERE consumer_name = 'quality-rollback'")).toBe(0);
    expect(await count('process_instance', `WHERE process_id = '${PROCESS_ROLLBACK}'`)).toBe(0);
    expect(await count('process_step', `WHERE process_id = '${PROCESS_ROLLBACK}'`)).toBe(0);
    expect(await count('outbox_event', "WHERE event_type = 'quality.RollbackProbe'")).toBe(0);
    expect(await count('reference_edge', "WHERE reference_purpose = 'ROLLBACK_PROBE'")).toBe(0);
  });

  it('rejects forged attribution before receipt claim and expired database context', async () => {
    await expect(
      executeQualityGovernanceCommand(
        db,
        context(),
        envelope({
          commandId: '51515151-5151-7515-8515-515151515151',
          idempotencyKey: 'quality-forged',
          principalId: '52525252-5252-7525-8525-525252525252',
        }),
        () => Promise.resolve({ kind: 'COMMITTED', resultPayload: { invalid: true } }),
      ),
    ).rejects.toMatchObject({ code: COMMAND_CONTEXT_MISMATCH });
    expect(await count('command_receipt', "WHERE idempotency_key = 'quality-forged'")).toBe(0);

    await expect(
      executeQualityGovernanceCommand(
        db,
        context({ authorizationDecisionExpiresAt: new Date(Date.now() - 1000) }),
        envelope({
          commandId: '53535353-5353-7535-8535-535353535353',
          idempotencyKey: 'quality-expired',
        }),
        () => Promise.resolve({ kind: 'COMMITTED', resultPayload: { invalid: true } }),
      ),
    ).rejects.toMatchObject({ code: COMMAND_CONTEXT_EXPIRED });
  });

  it('rejects untrusted SQL, cross-scope/cross-schema access, DDL, guard calls, and owner escalation', async () => {
    await probe.query('BEGIN');
    await probe.query('SET LOCAL ROLE quality_governance_app');
    const missingContext = await trySql(
      probe,
      `INSERT INTO quality_governance.process_instance
       (process_id, process_type, process_version, correlation_key, enterprise_id, project_id,
        state, created_by_principal_id)
       VALUES ('61616161-6161-7616-8616-616161616161', 'probe', '1.0', 'missing-context',
               $1, $2, 'ACTIVE', $3)`,
      [ENTERPRISE_A, PROJECT_A, PRINCIPAL],
    );
    expect(missingContext).toMatchObject({ allowed: false, code: '42501' });
    await probe.query('ROLLBACK');

    await probe.query('BEGIN');
    await establish(probe);
    const crossProject = await trySql(
      probe,
      `INSERT INTO quality_governance.process_instance
       (process_id, process_type, process_version, correlation_key, enterprise_id, project_id,
        state, created_by_principal_id)
       VALUES ('62626262-6262-7626-8626-626262626262', 'probe', '1.0', 'cross-project',
               $1, $2, 'ACTIVE', $3)`,
      [ENTERPRISE_A, PROJECT_B, PRINCIPAL],
    );
    expect(crossProject).toMatchObject({ allowed: false, code: '42501' });
    await probe.query('ROLLBACK');

    const statements = [
      'CREATE TABLE quality_governance.forbidden_probe (id integer)',
      'SET ROLE quality_governance_owner',
      'SELECT count(*) FROM artifact.process_instance',
      'SELECT quality_governance.guard_process_step_scope()',
    ];
    for (const statement of statements) {
      await probe.query('BEGIN');
      await establish(probe);
      const outcome = await trySql(probe, statement);
      expect(outcome).toMatchObject({ allowed: false, code: '42501' });
      await probe.query('ROLLBACK');
    }

    await admin.query('BEGIN');
    await admin.query('SET LOCAL ROLE audit_reader');
    const masked = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'quality_governance' AND table_name = 'audit_record_masked'
        ORDER BY ordinal_position`,
    );
    const maskedColumns = masked.rows.map((row) => row.column_name);
    expect(maskedColumns).not.toContain('safe_summary');
    expect(maskedColumns).not.toContain('channel_ref');
    const fullAudit = await trySql(
      admin,
      'SELECT safe_summary FROM quality_governance.audit_record',
    );
    expect(fullAudit).toMatchObject({ allowed: false, code: '42501' });
    await admin.query('ROLLBACK');
  });

  it('rejects repository actor attribution that differs from trusted context', async () => {
    await expect(
      executeQualityGovernanceCommand(
        db,
        context(),
        envelope({
          commandId: '71717171-7171-7717-8717-717171717171',
          idempotencyKey: 'quality-principal-mismatch',
          targetId: '72727272-7272-7727-8727-727272727272',
          requestPayload: {
            action: 'principal-mismatch',
            enterpriseId: ENTERPRISE_A,
            projectId: PROJECT_A,
          },
        }),
        async (execution) => {
          await repo.insertProcessInstance(execution.trx, {
            ...processInsert('72727272-7272-7727-8727-727272727272'),
            createdByPrincipalId: '73737373-7373-7737-8737-737373737373',
          });
          return { kind: 'COMMITTED', resultPayload: { invalid: true } };
        },
      ),
    ).rejects.toMatchObject({ code: QUALITY_CONTEXT_PRINCIPAL_MISMATCH });
    expect(
      await count('command_receipt', "WHERE idempotency_key = 'quality-principal-mismatch'"),
    ).toBe(0);
  });

  it('keeps Enterprise RLS isolated even when the caller declares another enterprise', async () => {
    await probe.query('BEGIN');
    await establish(probe, ENTERPRISE_A, [PROJECT_A]);
    const crossEnterprise = await trySql(
      probe,
      `INSERT INTO quality_governance.process_instance
       (process_id, process_type, process_version, correlation_key, enterprise_id, project_id,
        state, created_by_principal_id)
       VALUES ('81818181-8181-7818-8818-818181818181', 'probe', '1.0', 'cross-enterprise',
               $1, NULL, 'ACTIVE', $2)`,
      [ENTERPRISE_B, PRINCIPAL],
    );
    expect(crossEnterprise).toMatchObject({ allowed: false, code: '42501' });
    await probe.query('ROLLBACK');
  });
});
