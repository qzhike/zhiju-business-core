import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { postgresImageReference } from '../../tools/persistence/baseline.mjs';
import { runFlyway } from '../../tools/persistence/flyway.mjs';
import { definedValue, gateEnabled, OPERATOR, PROBE_ROLE } from './initial-context-fixtures.js';
import { createRunScenario, type RunScenario } from './initial-context-scenario.js';
import { createInitialContextSuite, type InitialContextSuite } from './initial-context-suite.js';

const variants = [
  'RUNTIME_USAGE',
  'OUTCOME',
  'BUSINESS_OUTPUT',
  'ARTIFACT_ALIAS',
  'WORKSPACE_OUTPUT',
  'FINDING',
  'KNOWLEDGE_PROPOSAL',
  'INPUT_REQUEST_PROPOSAL',
  'FOLLOW_UP_PROPOSAL',
  'CONTINUATION',
  'HEADER',
  'PROVENANCE',
  'TIME',
] as const;

interface Environment {
  container?: StartedPostgreSqlContainer;
  suite?: InitialContextSuite;
  runScenario?: RunScenario;
  failed: boolean;
}

// Concurrency is confined to two independent PostgreSQL clusters. Every case
// inside a cluster remains serial, including its real expiry and operation drain.
describe.skipIf(!gateEnabled)('initial Context unsupported final (isolated PostgreSQL)', () => {
  const environments: Environment[] = [{ failed: false }, { failed: false }];

  async function verifyIsolation(): Promise<void> {
    const left = definedValue(definedValue(environments[0]).suite);
    const right = definedValue(definedValue(environments[1]).suite);
    const systemId = async (suite: InitialContextSuite) =>
      definedValue(
        (
          await suite.admin.query<{ id: string }>(
            'SELECT system_identifier::text AS id FROM pg_control_system()',
          )
        ).rows[0],
      ).id;
    expect(await systemId(left)).not.toBe(await systemId(right));
    const leftClock = left.clock;
    const rightClock = right.clock;
    try {
      left.clock += 500;
      expect(right.clock).toBe(rightClock);
    } finally {
      left.clock = leftClock;
    }
    try {
      await left.admin.query(`REVOKE task_execution_app FROM ${PROBE_ROLE}`);
      const membership = async (suite: InitialContextSuite) =>
        (
          await suite.admin.query<{ allowed: boolean }>(
            'SELECT pg_has_role($1, $2, $3) AS allowed',
            [PROBE_ROLE, 'task_execution_app', 'MEMBER'],
          )
        ).rows;
      expect(await membership(left)).toEqual([{ allowed: false }]);
      expect(await membership(right)).toEqual([{ allowed: true }]);
    } finally {
      await left.admin.query(`GRANT task_execution_app TO ${PROBE_ROLE}`);
    }
    const lockFailures: unknown[] = [];
    try {
      await left.admin.query('BEGIN');
      await left.admin.query('SELECT id FROM identity_policy.principal WHERE id=$1 FOR UPDATE', [
        OPERATOR,
      ]);
      await right.admin.query('BEGIN');
      await right.admin.query("SET LOCAL lock_timeout='250ms'");
      expect(
        (
          await right.admin.query(
            'SELECT id FROM identity_policy.principal WHERE id=$1 FOR UPDATE',
            [OPERATOR],
          )
        ).rowCount,
      ).toBe(1);
    } catch (error) {
      lockFailures.push(error);
    } finally {
      const rollbacks = await Promise.allSettled([
        left.admin.query('ROLLBACK'),
        right.admin.query('ROLLBACK'),
      ]);
      lockFailures.push(
        ...rollbacks.flatMap((result) =>
          result.status === 'rejected' ? [result.reason as unknown] : [],
        ),
      );
    }
    if (lockFailures.length)
      throw new AggregateError(lockFailures, 'isolated matrix lock probe failed');
    await expect(left.admin.query('SELECT 1/0')).rejects.toThrow();
    expect((await right.admin.query<{ ok: number }>('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
  }

  beforeAll(async () => {
    const starts = await Promise.allSettled(
      environments.map(async (environment, index) => {
        environment.container = await new PostgreSqlContainer(postgresImageReference())
          .withDatabase('zhiju_core')
          .withUsername('postgres')
          .withPassword('zhiju-gate-test')
          .withStartupTimeout(120_000)
          .start();
        // Record resources as soon as they exist so partial setup is cleaned too.
        environment.suite = createInitialContextSuite({
          databaseUrl: environment.container.getConnectionUri(),
          registerHooks: false,
          diagnosticLabel: `unsupported-final-${index + 1}`,
        });
        environment.runScenario = createRunScenario(environment.suite);
        await runFlyway(environment.container.getId(), {
          command: 'migrate',
          database: 'zhiju_core',
          username: 'postgres',
          password: 'zhiju-gate-test',
        });
        await environment.suite.prepareSuite();
      }),
    );
    const failures = starts.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    );
    if (failures.length) throw new AggregateError(failures, 'isolated matrix setup failed');
    await verifyIsolation();
  }, 300_000);

  afterAll(async () => {
    const closes = await Promise.allSettled(
      environments.map(async (environment) => {
        try {
          await environment.suite?.drain();
        } finally {
          try {
            await environment.suite?.dispose();
          } finally {
            await environment.container?.stop();
          }
        }
      }),
    );
    const failures = closes.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    );
    if (failures.length) throw new AggregateError(failures, 'isolated matrix cleanup failed');
  }, 120_000);

  environments.forEach((environment, lane) => {
    describe(`independent database ${lane + 1}`, { concurrent: true }, () => {
      afterEach(async ({ task, signal }) => {
        // A timed-out body may still have continuations. Never lend this database
        // to a later case after a failed test or failed drain.
        if (task.result?.state !== 'pass' || signal.aborted) environment.failed = true;
        try {
          await environment.suite?.drain();
        } catch (error) {
          environment.failed = true;
          throw error;
        }
      }, 120_000);

      for (const [index, variant] of variants.entries()) {
        if (index % environments.length !== lane) continue;
        const name = `rejects Core-valid unsupported final ${variant} without reserving a Result`;
        it(name, { concurrent: false, timeout: 180_000 }, async () => {
          if (environment.failed)
            throw new Error('isolated database unavailable after an earlier failure');
          const suite = definedValue(environment.suite);
          const runScenario = definedValue(environment.runScenario);
          await suite.runIntegrationCase(name, () => runScenario('UNSUPPORTED_FINAL', variant));
        });
      }
    });
  });
});
