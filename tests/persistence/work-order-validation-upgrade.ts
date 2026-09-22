import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { expect } from 'vitest';
import { postgresImageReference } from '../../tools/persistence/baseline.mjs';
import { runFlyway } from '../../tools/persistence/flyway.mjs';

/** Restore real owning-command facts as a historical V3004 backup. Trigger
 * suppression is confined to this disposable restore; it is never business
 * acceptance evidence. Original CHECK constraints remain active throughout. */
export async function verifyWorkOrderValidationUpgrade(source: pg.Client, enterpriseId: string) {
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
    await target.connect();
    await flyway('3004');
    const tables = await target.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.columns
       WHERE table_schema='task_execution' AND column_name='enterprise_id'
         AND table_name IN (SELECT table_name FROM information_schema.tables
           WHERE table_schema='task_execution' AND table_type='BASE TABLE')
       ORDER BY table_name`,
    );
    const history = new Map<string, { columns: string; rows: unknown[] }>();
    await target.query('SET session_replication_role=replica');
    for (const { table_name: table } of tables.rows) {
      const columns = (
        await target.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema='task_execution' AND table_name=$1 ORDER BY ordinal_position`,
          [table],
        )
      ).rows
        .map((row) => quote(row.column_name))
        .join(',');
      const qualified = `task_execution.${quote(table)}`;
      const rows = (
        await source.query<{ payload: unknown }>(
          `SELECT to_jsonb(h) AS payload FROM (SELECT ${columns} FROM ${qualified} WHERE enterprise_id=$1) h`,
          [enterpriseId],
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
    for (const table of [
      'execution_judgment',
      'work_order_draft_snapshot',
      'context_snapshot',
      'context_snapshot_build',
    ])
      expect(history.get(table)?.rows.length, `${table} historical fixture`).toBeGreaterThan(0);
    await flyway();
    for (const [table, { columns, rows }] of history) {
      const after = (
        await target.query<{ payload: unknown }>(
          `SELECT to_jsonb(h) AS payload FROM (SELECT ${columns} FROM task_execution.${quote(table)} WHERE enterprise_id=$1) h`,
          [enterpriseId],
        )
      ).rows
        .map((row) => JSON.stringify(row.payload))
        .sort();
      expect(after, `${table} V3005 preserves historical columns`).toEqual(
        rows.map((row) => JSON.stringify(row)).sort(),
      );
    }
    expect(await flyway()).toMatch(/up to date|no pending migrations|No migration necessary/i);
  } finally {
    await target.end();
    await container.stop({ remove: true, timeout: 10_000 });
  }
}
