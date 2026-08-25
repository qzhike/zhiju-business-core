// IM-03 WI-02 (issue #58) manual acceptance probe: success, replay, hash
// conflict, CAS conflict and rollback. Disposable local container only
// (see .vibe/im-03-workitem-issues/runbook-wi-02.md).

import pg from 'pg';
import {
  CommandExecutionError,
  CONCURRENCY_CONFLICT,
  createEnterpriseProjectDatabase,
  executeEnterpriseProjectCommand,
  EnterpriseProjectRepository,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';

const databaseUrl = process.env.ZJU_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('ZJU_DATABASE_URL is required (disposable local container only)');
}

const ENTERPRISE = 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a1a1';
const OPERATOR = 'd1d1d1d1-d1d1-71d1-81d1-d1d1d1d1d1d1';
const OPERATOR_ACTOR = 'd2d2d2d2-d2d2-72d2-82d2-d2d2d2d2d2d2';
const DECISION = 'd3d3d3d3-d3d3-73d3-83d3-d3d3d3d3d3d3';
const POLICY = 'd4d4d4d4-d4d4-74d4-84d4-d4d4d4d4d4d4';
const DECISION_HASH = Buffer.alloc(32, 0x42);
const CORRELATION = 'd5d5d5d5-d5d5-75d5-85d5-d5d5d5d5d5d5';
const PROCESS = 'abababab-0000-7000-8000-0000000000e1';
const PROCESS_CAS = 'abababab-0000-7000-8000-0000000000e2';
const PROCESS_FAULT = 'abababab-0000-7000-8000-0000000000e3';

const context: EnterpriseProjectTransactionContext = {
  kind: 'REQUEST',
  principalId: OPERATOR,
  principalKind: 'HUMAN',
  actorSnapshotId: OPERATOR_ACTOR,
  authorizationDecisionId: DECISION,
  authorizationDecisionHash: DECISION_HASH,
  authorizationDecisionExpiresAt: new Date(Date.now() + 3_600_000),
  policySnapshotId: POLICY,
  enterpriseId: ENTERPRISE,
  allowedProjectIds: [],
  correlationId: CORRELATION,
};

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const db = createEnterpriseProjectDatabase(pool);
const repo = new EnterpriseProjectRepository();

const envelope = (
  commandId: string,
  idempotencyKey: string,
  payload: Record<string, string>,
  targetId: string,
) => ({
  commandId,
  commandType: 'wi02.manual.register',
  commandVersion: '1.0',
  idempotencyScope: 'wi02-manual',
  idempotencyKey,
  requestPayload: payload,
  enterpriseId: ENTERPRISE,
  targetType: 'ProcessInstance',
  targetId,
  correlationId: CORRELATION,
  principalId: OPERATOR,
  principalKind: 'HUMAN',
  actorSnapshotId: OPERATOR_ACTOR,
  authorizationDecisionId: DECISION,
  policySnapshotId: POLICY,
});

try {
  const first = await executeEnterpriseProjectCommand(
    db,
    context,
    envelope(
      'abababab-0000-7000-8000-000000000010',
      'wi02-manual',
      { op: 'register', note: 'WI-02 Manual Fixture' },
      PROCESS,
    ),
    async (execution) => {
      await repo.insertProcessInstance(execution.trx, {
        processId: PROCESS,
        processType: 'wi02.manual',
        processVersion: '1.0',
        correlationKey: 'wi02-manual',
        enterpriseId: ENTERPRISE,
        createdByPrincipalId: OPERATOR,
      });
      await execution.appendOutbox({
        eventId: 'abababab-0000-7000-8000-000000000002',
        eventType: 'wi02.ProcessRegistered',
        eventVersion: '1.0',
        aggregateType: 'ProcessInstance',
        aggregateId: PROCESS,
        aggregateVersion: '1',
        payload: { enterpriseId: ENTERPRISE, note: 'wi02 manual' },
        occurredAt: new Date(),
      });
      return { kind: 'COMMITTED' as const, resultPayload: { processId: PROCESS } };
    },
  );
  console.log('[1] success      →', first.status);

  const replay = await executeEnterpriseProjectCommand(
    db,
    context,
    envelope(
      'abababab-0000-7000-8000-000000000011',
      'wi02-manual',
      { op: 'register', note: 'WI-02 Manual Fixture' },
      PROCESS,
    ),
    () => Promise.reject(new Error('must not re-execute')),
  );
  console.log(
    '[2] replay       →',
    replay.status,
    replay.status === 'DUPLICATE' ? `(originalOutcome=${replay.originalOutcome})` : '',
  );

  try {
    await executeEnterpriseProjectCommand(
      db,
      context,
      envelope(
        'abababab-0000-7000-8000-000000000012',
        'wi02-manual',
        { op: 'register', note: 'DIFFERENT PAYLOAD' },
        PROCESS,
      ),
      () => Promise.resolve({ kind: 'COMMITTED' as const, resultPayload: { never: true } }),
    );
    console.log('[3] hash-conflict→ UNEXPECTED COMMIT');
  } catch (error) {
    const code = error instanceof CommandExecutionError ? error.code : 'UNKNOWN';
    console.log(
      '[3] hash-conflict→',
      code,
      code === IDEMPOTENCY_PAYLOAD_CONFLICT ? '(first receipt unchanged)' : '',
    );
  }

  await executeEnterpriseProjectCommand(
    db,
    context,
    envelope(
      'abababab-0000-7000-8000-000000000020',
      'wi02-manual-cas-setup',
      { op: 'cas-setup' },
      PROCESS_CAS,
    ),
    async (execution) => {
      await repo.insertProcessInstance(execution.trx, {
        processId: PROCESS_CAS,
        processType: 'wi02.manual',
        processVersion: '1.0',
        correlationKey: 'wi02-manual-cas',
        enterpriseId: ENTERPRISE,
        createdByPrincipalId: OPERATOR,
      });
      return { kind: 'COMMITTED' as const, resultPayload: { processId: PROCESS_CAS } };
    },
  );

  const casWinner = await executeEnterpriseProjectCommand(
    db,
    context,
    {
      ...envelope(
        'abababab-0000-7000-8000-000000000021',
        'wi02-manual-cas-win',
        { op: 'cas-win' },
        PROCESS_CAS,
      ),
      expectedAggregateVersion: '1',
    },
    async (execution) => {
      const cas = await execution.casProcessInstance(PROCESS_CAS, '1', { state: 'SUSPENDED' });
      await execution.appendOutbox({
        eventId: 'abababab-0000-7000-8000-000000000022',
        eventType: 'wi02.ProcessAdvanced',
        eventVersion: '1.0',
        aggregateType: 'ProcessInstance',
        aggregateId: PROCESS_CAS,
        aggregateVersion: '2',
        payload: { enterpriseId: ENTERPRISE, note: 'cas-win' },
        occurredAt: new Date(),
      });
      return { kind: 'COMMITTED' as const, resultPayload: { cas } };
    },
  );
  try {
    await executeEnterpriseProjectCommand(
      db,
      context,
      {
        ...envelope(
          'abababab-0000-7000-8000-000000000023',
          'wi02-manual-cas-lose',
          { op: 'cas-lose' },
          PROCESS_CAS,
        ),
        expectedAggregateVersion: '1',
      },
      async (execution) => {
        const cas = await execution.casProcessInstance(PROCESS_CAS, '1', { state: 'COMPLETED' });
        if (cas === 'CONFLICT') {
          throw new CommandExecutionError(CONCURRENCY_CONFLICT, 'aggregate moved on');
        }
        return { kind: 'COMMITTED' as const, resultPayload: { cas } };
      },
    );
    console.log('[4] cas-conflict → UNEXPECTED COMMIT after', casWinner.status);
  } catch (error) {
    const code = error instanceof CommandExecutionError ? error.code : 'UNKNOWN';
    console.log(
      '[4] cas-conflict →',
      code,
      code === CONCURRENCY_CONFLICT ? '(loser left no receipt/outbox)' : '',
    );
  }

  try {
    await executeEnterpriseProjectCommand(
      db,
      context,
      envelope(
        'abababab-0000-7000-8000-000000000030',
        'wi02-manual-fault',
        { op: 'fault' },
        PROCESS_FAULT,
      ),
      async (execution) => {
        await repo.insertProcessInstance(execution.trx, {
          processId: PROCESS_FAULT,
          processType: 'wi02.manual',
          processVersion: '1.0',
          correlationKey: 'wi02-manual-fault',
          enterpriseId: ENTERPRISE,
          createdByPrincipalId: OPERATOR,
        });
        await execution.appendOutbox({
          eventId: 'abababab-0000-7000-8000-000000000031',
          eventType: 'wi02.ProcessRegistered',
          eventVersion: '1.0',
          aggregateType: 'ProcessInstance',
          aggregateId: PROCESS_FAULT,
          aggregateVersion: '1',
          payload: { enterpriseId: ENTERPRISE, note: 'fault' },
          occurredAt: new Date(),
        });
        execution.failAfterOutbox();
        return { kind: 'COMMITTED' as const, resultPayload: {} };
      },
    );
    console.log('[5] rollback     → UNEXPECTED COMMIT');
  } catch (error) {
    const code = error instanceof CommandExecutionError ? error.code : 'UNKNOWN';
    console.log('[5] rollback     →', code, code === 'INJECTED_FAULT' ? '(no leftover rows)' : '');
  }

  const version = await pool.query<{ aggregate_version: string; state: string }>(
    `SELECT aggregate_version::text, state FROM enterprise_project.process_instance WHERE process_id = $1`,
    [PROCESS_CAS],
  );
  console.log('[verify] cas process:', version.rows[0]);
  for (const [label, sql] of [
    [
      'receipt',
      `SELECT outcome, count(*) FROM enterprise_project.command_receipt WHERE idempotency_key IN ('wi02-manual','wi02-manual-cas-lose','wi02-manual-fault') GROUP BY outcome`,
    ],
    [
      'audit',
      `SELECT outcome, count(*) FROM enterprise_project.audit_record WHERE command_type = 'wi02.manual.register' GROUP BY outcome`,
    ],
    [
      'outbox',
      `SELECT event_type, count(*) FROM enterprise_project.outbox_event WHERE event_type IN ('wi02.ProcessRegistered','wi02.ProcessAdvanced') GROUP BY event_type`,
    ],
    [
      'fault process',
      `SELECT count(*) FROM enterprise_project.process_instance WHERE process_id = 'abababab-0000-7000-8000-0000000000e3'`,
    ],
  ] as const) {
    const result = await pool.query(sql);
    console.log(`[verify] ${label}:`, result.rows);
  }
} finally {
  await pool.end();
}
