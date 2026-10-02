import type { LocalSyntheticRuntimeDriver } from '@zhiju/integration-gateway';
import { expect } from 'vitest';
import { record } from './initial-context-fixtures.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface VerifyRecoveryRollbackContext {
  readonly recoverySqlCounterexamples: (
    envelope: Record<string, unknown>,
    execute: () => Promise<unknown>,
  ) => Promise<void>;
  admin: InitialContextSuite['admin'];
  fixture: InitialContextSuite['fixture'];
  readonly runtimeDriver: LocalSyntheticRuntimeDriver;
  readonly recoveryFaults: Set<string>;
}

export async function verifyRecoveryRollback(
  scenarioState: VerifyRecoveryRollbackContext,
  envelope: Record<string, unknown>,
  execute: () => Promise<unknown>,
): Promise<void> {
  const type = typeof envelope.commandType === 'string' ? envelope.commandType : '';
  const schema = type.startsWith('identity.')
    ? 'identity_policy'
    : type.startsWith('integration.')
      ? 'integration_gateway'
      : type.startsWith('project.')
        ? 'enterprise_project'
        : 'task_execution';
  const commandId = String(envelope.commandId);
  if (schema === 'task_execution')
    await scenarioState.recoverySqlCounterexamples(envelope, execute);
  const tables = (
    await scenarioState.admin.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns WHERE table_schema=$1 AND column_name='enterprise_id' AND table_name NOT IN ('command_receipt','audit_record','command_audit','authorization_decision','actor_snapshot','reference_edge') AND EXISTS (SELECT 1 FROM information_schema.columns p WHERE p.table_schema=$1 AND p.table_name=columns.table_name AND p.column_name='project_id') ORDER BY table_name`,
      [schema],
    )
  ).rows
    .map((r) => r.table_name)
    .filter((t) => schema !== 'identity_policy' || t.startsWith('execution_capability_bundle'));
  const snapshot = async () => {
    const value: Record<string, unknown> = {};
    for (const table of tables)
      value[table] = (
        await scenarioState.admin.query(
          `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) rows FROM ${schema}.${table} t WHERE enterprise_id=$1 AND project_id=$2`,
          [scenarioState.fixture.enterpriseId, scenarioState.fixture.projectId],
        )
      ).rows;
    return value;
  };
  const before = await snapshot();
  await scenarioState.admin.query(
    `CREATE FUNCTION ${schema}.wi231_receipt_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'WI231_RECEIPT_FAULT'; END $f$`,
  );
  await scenarioState.admin.query(
    `CREATE TRIGGER wi231_receipt_fault ${type === 'integration.request_runtime_dispatch' ? 'AFTER INSERT' : 'AFTER UPDATE'} ON ${schema}.command_receipt FOR EACH ROW WHEN (NEW.command_id='${commandId}'::uuid AND NEW.outcome='${type === 'integration.request_runtime_dispatch' ? 'PENDING' : 'COMMITTED'}') EXECUTE FUNCTION ${schema}.wi231_receipt_fault()`,
  );
  try {
    await expect(execute(), type).rejects.toThrow('WI231_RECEIPT_FAULT');
  } finally {
    await scenarioState.admin.query(
      `DROP TRIGGER wi231_receipt_fault ON ${schema}.command_receipt`,
    );
    await scenarioState.admin.query(`DROP FUNCTION ${schema}.wi231_receipt_fault()`);
  }
  expect(
    (
      await scenarioState.admin.query(
        `SELECT command_id FROM ${schema}.command_receipt WHERE command_id=$1`,
        [commandId],
      )
    ).rows,
    type,
  ).toEqual([]);
  expect(await snapshot(), `${type}: complete target rollback`).toEqual(before);
  if (type === 'integration.request_runtime_dispatch') {
    const beforeInvokes = scenarioState.runtimeDriver.invokedAttemptIds.length;
    await scenarioState.admin.query(
      `CREATE FUNCTION ${schema}.wi231_ack_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'WI231_ACK_FAULT'; END $f$`,
    );
    await scenarioState.admin.query(
      `CREATE TRIGGER wi231_ack_fault AFTER UPDATE ON ${schema}.command_receipt FOR EACH ROW WHEN (NEW.command_id='${commandId}'::uuid AND NEW.outcome='COMMITTED') EXECUTE FUNCTION ${schema}.wi231_ack_fault()`,
    );
    try {
      await expect(execute()).rejects.toThrow('WI231_ACK_FAULT');
    } finally {
      await scenarioState.admin.query(`DROP TRIGGER wi231_ack_fault ON ${schema}.command_receipt`);
      await scenarioState.admin.query(`DROP FUNCTION ${schema}.wi231_ack_fault()`);
    }
    expect(scenarioState.runtimeDriver.invokedAttemptIds.length).toBe(beforeInvokes + 1);
    expect(
      (
        await scenarioState.admin.query(
          `SELECT outcome FROM ${schema}.command_receipt WHERE command_id=$1`,
          [commandId],
        )
      ).rows,
    ).toEqual([{ outcome: 'PENDING' }]);
    expect(
      (
        await scenarioState.admin.query(
          `SELECT status FROM ${schema}.runtime_attempt WHERE source_command_id=$1`,
          [commandId],
        )
      ).rows,
    ).toEqual([{ status: 'CREATED' }]);
    for (const table of [
      'runtime_adapter_identity',
      'runtime_attempt_observation',
      'runtime_final_observation',
    ])
      expect(
        (
          await scenarioState.admin.query(
            `SELECT count(*)::int n FROM ${schema}.${table} WHERE attempt_id=$1`,
            [record(envelope.targetRef).objectId],
          )
        ).rows,
      ).toEqual([{ n: 0 }]);
  }
  scenarioState.recoveryFaults.add(commandId);
}
