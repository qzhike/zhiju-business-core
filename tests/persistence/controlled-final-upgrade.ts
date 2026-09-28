import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { expect } from 'vitest';
import { postgresImageReference } from '../../tools/persistence/baseline.mjs';
import { runFlyway } from '../../tools/persistence/flyway.mjs';

/** Project actual owning-entry facts onto the historical schema as a backup.
 * Trigger suppression is limited to restoring this disposable database. This
 * proves migration preservation, never historical business authorization. */
export async function verifyControlledFinalUpgrade(
  source: pg.Client,
  input: {
    schema: 'task_execution' | 'integration_gateway';
    version: '3006' | '3010' | '7002' | '7004';
    enterpriseId: string;
    requiredTables: readonly string[];
    afterMigrate?: (target: pg.Client, connectionUri: string) => Promise<void>;
  },
) {
  const container = await new PostgreSqlContainer(postgresImageReference())
    .withDatabase('zhiju_core')
    .withUsername('postgres')
    .withPassword('zhiju-gate-test')
    .withStartupTimeout(120_000)
    .start();
  const target = new pg.Client({ connectionString: container.getConnectionUri() });
  const flyway = (version?: string) =>
    runFlyway(container.getId(), {
      command: 'migrate',
      database: 'zhiju_core',
      username: 'postgres',
      password: 'zhiju-gate-test',
      ...(version === undefined ? {} : { target: version }),
    });
  const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
  try {
    if (input.schema === 'task_execution' && input.version === '3006') {
      expect(
        (
          await source.query<{ count: string }>(
            `SELECT count(*)::text FROM task_execution.run WHERE enterprise_id=$1
         AND status NOT IN ('CREATED','STARTING','RUNNING')`,
            [input.enterpriseId],
          )
        ).rows,
        'V3006 backup contains only historical Run states',
      ).toEqual([{ count: '0' }]);
      expect(
        (
          await source.query<{ count: string }>(
            `SELECT count(*)::text FROM task_execution.execution_judgment WHERE enterprise_id=$1
         AND judgment_kind='RESULT_VALIDATION_BUNDLE'`,
            [input.enterpriseId],
          )
        ).rows,
        'V3006 backup precedes final validation facts',
      ).toEqual([{ count: '0' }]);
    }
    await target.connect();
    await flyway(input.version);
    const tables = await target.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema=$1 AND column_name='enterprise_id'
         AND table_name IN (SELECT table_name FROM information_schema.tables
           WHERE table_schema=$1 AND table_type='BASE TABLE') ORDER BY table_name`,
      [input.schema],
    );
    const history = new Map<string, { columns: string; rows: unknown[] }>();
    await target.query('SET session_replication_role=replica');
    for (const { table_name: table } of tables.rows) {
      const columns = (
        await target.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
         WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`,
          [input.schema, table],
        )
      ).rows
        .map((row) => quote(row.column_name))
        .join(',');
      const qualified = `${input.schema}.${quote(table)}`;
      const rows = (
        await source.query<{ payload: unknown }>(
          `SELECT to_jsonb(h) AS payload FROM (SELECT ${columns} FROM ${qualified} WHERE enterprise_id=$1) h`,
          [input.enterpriseId],
        )
      ).rows.map((row) => row.payload);
      for (const row of rows)
        await target.query(
          `INSERT INTO ${qualified} SELECT * FROM jsonb_populate_record(NULL::${qualified}, $1::jsonb)`,
          [JSON.stringify(row)],
        );
      history.set(table, { columns, rows });
    }
    await target.query('SET session_replication_role=origin');
    for (const table of input.requiredTables)
      expect(history.get(table)?.rows.length, `${table} actual historical fixture`).toBeGreaterThan(
        0,
      );
    await flyway();
    for (const [table, { columns, rows }] of history) {
      const after = (
        await target.query<{ payload: unknown }>(
          `SELECT to_jsonb(h) AS payload FROM (SELECT ${columns} FROM ${input.schema}.${quote(table)} WHERE enterprise_id=$1) h`,
          [input.enterpriseId],
        )
      ).rows
        .map((row) => JSON.stringify(row.payload))
        .sort();
      expect(after, `${table} preserves every historical column`).toEqual(
        rows.map((row) => JSON.stringify(row)).sort(),
      );
    }
    if (input.schema === 'task_execution' && input.version === '3006') {
      expect(
        (
          await target.query<{ count: string }>(
            `SELECT count(*)::text FROM task_execution.run
         WHERE enterprise_id=$1 AND runtime_adapter_identity_ref IS NOT NULL`,
            [input.enterpriseId],
          )
        ).rows,
      ).toEqual([{ count: '0' }]);
      for (const table of [
        'agent_result',
        'run_final_submission_claim',
        'result_validation_bundle',
        'result_validation_fact',
        'agent_result_acceptance',
      ])
        expect(
          (
            await target.query<{ count: string }>(
              `SELECT count(*)::text FROM task_execution.${quote(table)}`,
            )
          ).rows,
          `${table} receives no fabricated facts`,
        ).toEqual([{ count: '0' }]);
    } else if (input.version === '7002') {
      expect(
        (
          await target.query<{ count: string }>(
            `SELECT count(*)::text FROM integration_gateway.runtime_attempt
         WHERE enterprise_id=$1 AND planned_runtime_instance_id IS NOT NULL`,
            [input.enterpriseId],
          )
        ).rows,
      ).toEqual([{ count: '0' }]);
      for (const table of ['runtime_adapter_identity', 'runtime_final_observation'])
        expect(
          (
            await target.query<{ count: string }>(
              `SELECT count(*)::text FROM integration_gateway.${quote(table)}`,
            )
          ).rows,
          `${table} receives no fabricated facts`,
        ).toEqual([{ count: '0' }]);
    }
    if (input.version === '3010' || input.version === '7004')
      for (const table of [
        'information_request',
        'information_request_origin',
        'answer_submission',
        'answer_resolution',
        'work_order_retry_intent',
        'run_budget_reservation',
        'recovery_process_command',
      ])
        expect(
          (
            await target.query<{ count: string }>(
              `SELECT count(*)::text FROM task_execution.${quote(table)}`,
            )
          ).rows,
          `${table} has no fabricated recovery facts after upgrade`,
        ).toEqual([{ count: '0' }]);
    expect(
      (
        await target.query<{ count: string }>(
          `SELECT count(*)::text FROM task_execution.process_instance WHERE process_type='controlled-final@1'`,
        )
      ).rows,
    ).toEqual([{ count: '0' }]);
    expect(await flyway()).toMatch(/up to date|no pending migrations|No migration necessary/i);
    await input.afterMigrate?.(target, container.getConnectionUri());
  } finally {
    await target.end();
    await container.stop({ remove: true, timeout: 10_000 });
  }
}
