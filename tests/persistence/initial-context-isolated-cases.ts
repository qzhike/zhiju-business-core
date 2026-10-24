import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { postgresImageReference } from '../../tools/persistence/baseline.mjs';
import { runFlyway } from '../../tools/persistence/flyway.mjs';
import { definedValue, OPERATOR, PROBE_ROLE } from './initial-context-fixtures.js';
import { createRunScenario, type RunScenario } from './initial-context-scenario.js';
import { createInitialContextSuite, type InitialContextSuite } from './initial-context-suite.js';

export interface IsolatedInitialContextCase {
  name: string;
  run: (suite: InitialContextSuite, runScenario: RunScenario) => Promise<void>;
  timeout: number;
}

interface Environment {
  label: string;
  container?: StartedPostgreSqlContainer;
  suite?: InitialContextSuite;
  runScenario?: RunScenario;
  body?: Promise<void>;
  setup?: Promise<void>;
  settlement?: Promise<void>;
  close?: Promise<void>;
  stop?: Promise<void>;
  available: boolean;
  closing: boolean;
  failed: boolean;
}

// Leave room inside the unchanged 120s hook budget for forced resource cleanup.
const SETTLE_TIMEOUT = 60_000;
const RESOURCE_TIMEOUT = 10_000;
const SETUP_TIMEOUT = 270_000;

async function bounded<T>(operation: Promise<T>, milliseconds: number, label: string): Promise<T> {
  const timer = new AbortController();
  try {
    return await Promise.race([
      operation,
      delay(milliseconds, undefined, { signal: timer.signal }).then(() => {
        throw new Error(`isolated initial Context ${label} timed out`);
      }),
    ]);
  } finally {
    timer.abort();
  }
}

async function verifyIsolation(environments: readonly Environment[]): Promise<void> {
  const suites = environments.map((environment) => definedValue(environment.suite));
  const identities = await Promise.all(
    suites.map(
      async (suite) =>
        definedValue(
          (
            await suite.admin.query<{ id: string }>(
              'SELECT system_identifier::text AS id FROM pg_control_system()',
            )
          ).rows[0],
        ).id,
    ),
  );
  expect(new Set(identities).size).toBe(environments.length);
  const left = definedValue(suites[0]);
  for (const right of suites.slice(1)) {
    expect(left).not.toBe(right);
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
    const failures: unknown[] = [];
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
      failures.push(error);
    } finally {
      const rollbacks = await Promise.allSettled([
        left.admin.query('ROLLBACK'),
        right.admin.query('ROLLBACK'),
      ]);
      failures.push(
        ...rollbacks.flatMap((result) =>
          result.status === 'rejected' ? [result.reason as unknown] : [],
        ),
      );
    }
    if (failures.length)
      throw new AggregateError(failures, 'isolated initial Context lock probe failed');
    await expect(left.admin.query('SELECT 1/0')).rejects.toThrow();
    expect((await right.admin.query<{ ok: number }>('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
  }
}

async function settleCase(environment: Environment): Promise<void> {
  // Keep the body outside suite.track: it can itself call drain in a finally.
  // Waiting for it here also covers continuations after a Vitest timeout.
  environment.settlement ??= (async () => {
    if (environment.body) await Promise.allSettled([environment.body]);
    await environment.suite?.drain();
  })();
  await bounded(environment.settlement, SETTLE_TIMEOUT, `settlement: ${environment.label}`);
}

async function releaseResources(environment: Environment): Promise<void> {
  const failures: unknown[] = [];
  for (const close of [
    () => environment.suite?.dispose(),
    async () => {
      const container = environment.container;
      if (!container) return;
      environment.stop ??= container.stop().then(() => {
        process.stdout.write(
          `[initial-context-isolation] stopped: ${environment.label}; container=${container.getId()}\n`,
        );
        delete environment.container;
      });
      await environment.stop;
    },
  ]) {
    try {
      await bounded(
        Promise.resolve().then(close),
        RESOURCE_TIMEOUT,
        `resource release: ${environment.label}`,
      );
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, `cleanup failed: ${environment.label}`);
}

function closeEnvironment(environment: Environment, settled = false): Promise<void> {
  environment.closing = true;
  environment.available = false;
  return (environment.close ??= (async () => {
    const failures: unknown[] = [];
    for (const close of [
      () => (settled ? undefined : settleCase(environment)),
      () => releaseResources(environment),
      // Setup may be between awaits while cleanup begins. It also owns a late
      // release path, so resources returned after this bounded join are closed.
      () =>
        bounded(
          Promise.allSettled(environment.setup ? [environment.setup] : []),
          RESOURCE_TIMEOUT,
          `setup exit: ${environment.label}`,
        ),
      () => releaseResources(environment),
    ]) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, `cleanup failed: ${environment.label}`);
  })());
}

// Only independent databases overlap. Each group remains serial, and a failed
// reusable environment is never lent to the next business case.
export function registerIsolatedInitialContextGroups(
  groups: readonly { label: string; cases: readonly IsolatedInitialContextCase[] }[],
  options: {
    databasePerCase?: boolean;
    deliveryOnly?: boolean;
    // Lifecycle probes scale hook budgets without mocking the test framework itself.
    hookTimeouts?: { setup: number; cleanup: number; afterCase: number };
  } = {},
): void {
  const lanes = groups.map((group) => {
    const environment = (): Environment => ({
      label: group.label,
      failed: false,
      available: false,
      closing: false,
    });
    const shared = environment();
    return group.cases.map((test, index) => ({
      test,
      environment: options.databasePerCase
        ? { ...environment(), label: `${group.label}-${index + 1}` }
        : shared,
    }));
  });
  const environments = [
    ...new Set(lanes.flatMap((lane) => lane.map(({ environment }) => environment))),
  ];

  let exiting = false;
  function beginExit(): void {
    exiting = true;
    for (const environment of environments) {
      environment.closing = true;
      environment.available = false;
    }
  }
  async function prepareEnvironment(environment: Environment): Promise<void> {
    const isClosing = () => environment.closing;
    try {
      environment.container = await new PostgreSqlContainer(postgresImageReference())
        .withDatabase('zhiju_core')
        .withUsername('postgres')
        .withPassword('zhiju-gate-test')
        .withStartupTimeout(120_000)
        .start();
      process.stdout.write(
        `[initial-context-isolation] started: ${environment.label}; container=${environment.container.getId()}\n`,
      );
      if (isClosing()) return;
      environment.suite = createInitialContextSuite({
        databaseUrl: environment.container.getConnectionUri(),
        registerHooks: false,
        diagnosticLabel: environment.label,
      });
      environment.runScenario = createRunScenario(environment.suite);
      await runFlyway(environment.container.getId(), {
        command: 'migrate',
        database: 'zhiju_core',
        username: 'postgres',
        password: 'zhiju-gate-test',
      });
      if (isClosing()) return;
      await environment.suite.prepareSuite(options.deliveryOnly);
    } finally {
      // No dependency on environment.close: that operation may be joining setup.
      if (environment.closing) await releaseResources(environment);
    }
  }
  async function prepareEnvironments(): Promise<void> {
    const failures: unknown[] = [];
    // Bound container/migration startup too; record resources before any next await.
    for (let index = 0; index < environments.length; index += 2) {
      if (exiting) return;
      const starts = await Promise.allSettled(
        environments.slice(index, index + 2).map((environment) => {
          environment.setup = prepareEnvironment(environment);
          return environment.setup;
        }),
      );
      failures.push(
        ...starts.flatMap((result) =>
          result.status === 'rejected' ? [result.reason as unknown] : [],
        ),
      );
      if (failures.length) break;
    }
    if (failures.length)
      throw new AggregateError(failures, 'isolated initial Context setup failed');
    if (!exiting) await verifyIsolation(environments);
  }
  beforeAll(async () => {
    try {
      await bounded(prepareEnvironments(), SETUP_TIMEOUT, 'setup');
      if (!exiting) for (const environment of environments) environment.available = true;
    } catch (error) {
      beginExit();
      throw error;
    }
  }, options.hookTimeouts?.setup ?? 300_000);

  afterAll(async () => {
    beginExit();
    const closes = await Promise.allSettled(
      environments.map((environment) => closeEnvironment(environment)),
    );
    const failures = closes.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    );
    if (failures.length)
      throw new AggregateError(failures, 'isolated initial Context cleanup failed');
  }, options.hookTimeouts?.cleanup ?? 120_000);

  lanes.forEach((lane, index) => {
    describe(definedValue(groups[index]).label, { concurrent: true }, () => {
      afterEach(async ({ task, signal }) => {
        const { environment } = definedValue(lane.find(({ test }) => test.name === task.name));
        environment.available = false;
        if (task.result?.state !== 'pass' || signal.aborted) environment.failed = true;
        try {
          if (options.databasePerCase || environment.failed) await closeEnvironment(environment);
          else await settleCase(environment);
          if (task.result?.state !== 'pass' || signal.aborted) environment.failed = true;
          environment.available = !environment.failed && !environment.closing;
        } catch (error) {
          environment.failed = true;
          try {
            await closeEnvironment(environment, true);
          } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'isolated case cleanup failed', {
              cause: cleanupError,
            });
          }
          throw error;
        }
      }, options.hookTimeouts?.afterCase ?? 120_000);
      for (const { test, environment } of lane) {
        it(test.name, { concurrent: false, timeout: test.timeout }, async () => {
          if (environment.failed || !environment.available || environment.closing)
            throw new Error('isolated database unavailable after an earlier failure');
          const suite = definedValue(environment.suite);
          const runScenario = definedValue(environment.runScenario);
          environment.available = false;
          delete environment.settlement;
          environment.body = suite.runIntegrationCase(test.name, () =>
            test.run(suite, runScenario),
          );
          try {
            await environment.body;
          } catch (error) {
            environment.failed = true;
            throw error;
          }
        });
      }
    });
  });
}
