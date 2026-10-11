// Executed only by the lifecycle regression subprocess, never as a business case.
import { type afterAll, describe, vi } from 'vitest';
import type * as Vitest from 'vitest';
import type * as Timers from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

const state = vi.hoisted(() => ({
  mode: process.env.ZJU_ISOLATION_PROBE_MODE ?? 'normal',
  events: [] as string[],
  nextId: 0,
  openResources: new Map<string, number>(),
  realAfterAll: undefined as typeof afterAll | undefined,
}));

vi.mock('vitest', async (importOriginal) => {
  const actual = await importOriginal<typeof Vitest>();
  state.realAfterAll = actual.afterAll;
  return {
    ...actual,
    beforeAll: (fn: Parameters<typeof actual.beforeAll>[0], timeout: number) => {
      actual.beforeAll(fn, state.mode === 'setup-hook' ? 20 : timeout / 1000);
    },
    afterEach: (fn: Parameters<typeof actual.afterEach>[0], timeout: number) => {
      actual.afterEach(fn, state.mode === 'drain-hook' ? 10 : timeout / 1000);
    },
    afterAll: (fn: Parameters<typeof actual.afterAll>[0], timeout: number) => {
      actual.afterAll(fn, timeout / 1000);
    },
  };
});
vi.mock('node:timers/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof Timers>();
  return {
    ...actual,
    setTimeout: (ms: number, value: unknown, options: { signal: AbortSignal }) =>
      actual.setTimeout(ms / 1000, value, options),
  };
});
vi.mock('@testcontainers/postgresql', () => ({
  PostgreSqlContainer: class {
    id = ++state.nextId;
    withDatabase() {
      return this;
    }
    withUsername() {
      return this;
    }
    withPassword() {
      return this;
    }
    withStartupTimeout() {
      return this;
    }
    async start() {
      state.events.push(`starting:${this.id}`);
      if (state.mode === 'setup-late')
        await new Promise((resolve) => setTimeout(resolve, this.id <= 2 ? 30 : 100));
      state.events.push(`started:${this.id}`);
      return this;
    }
    getId() {
      return `probe-${this.id}`;
    }
    getConnectionUri() {
      return `probe-${this.id}`;
    }
    stop() {
      state.events.push(`stopped:${this.id}`);
      return Promise.resolve();
    }
  },
}));
vi.mock('../../tools/persistence/baseline.mjs', () => ({ postgresImageReference: () => 'probe' }));
vi.mock('../../tools/persistence/flyway.mjs', () => ({
  runFlyway: (id: string) => {
    state.events.push(`migrated:${id}`);
    return Promise.resolve();
  },
}));
vi.mock('./initial-context-fixtures.js', () => ({
  definedValue: (value: unknown) => {
    if (value === undefined) throw new Error('undefined probe value');
    return value;
  },
  OPERATOR: 'operator',
  PROBE_ROLE: 'probe',
}));
vi.mock('./initial-context-scenario.js', () => ({
  createRunScenario: () => () => Promise.resolve(),
}));
vi.mock('./initial-context-suite.js', () => ({
  createInitialContextSuite: ({ databaseUrl }: { databaseUrl: string }) => {
    const id = databaseUrl.slice('probe-'.length);
    state.events.push(`suite:${id}`);
    let allowed = true;
    return {
      clock: 0,
      admin: {
        query: (sql: string) => {
          if (sql.includes('system_identifier')) return Promise.resolve({ rows: [{ id }] });
          if (sql.startsWith('REVOKE')) allowed = false;
          if (sql.startsWith('GRANT')) allowed = true;
          if (sql.includes('pg_has_role')) return Promise.resolve({ rows: [{ allowed }] });
          if (sql.includes('1/0')) return Promise.reject(new Error('division by zero'));
          return Promise.resolve({ rowCount: 1, rows: [{ ok: 1 }] });
        },
      },
      prepareSuite: async () => {
        state.openResources.set(id, 1);
        if (state.mode === 'setup-failure' && id === '1') throw new Error('injected setup failure');
        if (['setup-late', 'setup-hook'].includes(state.mode) && Number(id) <= 2)
          await new Promise((resolve) => setTimeout(resolve, 180));
        state.openResources.set(id, (state.openResources.get(id) ?? 0) + 1);
        state.events.push(`prepared:${id}`);
      },
      runIntegrationCase: (_name: string, body: () => Promise<void>) => body(),
      drain: async () => {
        state.events.push(`drain:${id}`);
        if (['drain-hang', 'drain-hook'].includes(state.mode) && id === '1')
          await new Promise<void>(() => {
            /* Deliberately never settles. */
          });
      },
      dispose: async () => {
        state.events.push(`disposed:${id}`);
        state.openResources.set(id, 0);
        if (state.mode === 'dispose-hang' && id === '1')
          await new Promise<void>(() => {
            /* Deliberately never settles. */
          });
      },
    };
  },
}));

import { registerIsolatedInitialContextGroups } from './initial-context-isolated-cases.js';

describe('isolated environment lifecycle probe', () => {
  registerIsolatedInitialContextGroups(
    [
      {
        label: 'first lane',
        cases: [
          {
            name: 'first',
            timeout: state.mode.startsWith('body-') || state.mode === 'late-body' ? 20 : 500,
            run: async () => {
              state.events.push('body:first');
              if (state.mode.startsWith('body-'))
                await new Promise<void>(() => {
                  /* Deliberately never settles. */
                });
              if (state.mode === 'assertion') throw new Error('injected assertion failure');
              await new Promise((resolve) =>
                setTimeout(resolve, state.mode === 'late-body' ? 40 : 5),
              );
              state.events.push('body:first settled');
            },
          },
          {
            name: 'second',
            timeout: 500,
            run: () => {
              state.events.push('body:second');
              return Promise.resolve();
            },
          },
        ],
      },
      {
        label: 'healthy lane',
        cases: [
          {
            name: 'healthy',
            timeout: 500,
            run: async () => {
              state.events.push('body:healthy');
              await new Promise((resolve) => setTimeout(resolve, 5));
            },
          },
        ],
      },
    ],
    {
      databasePerCase: [
        'body-fresh',
        'dispose-hang',
        'setup-late',
        'setup-hook',
        'setup-failure',
      ].includes(state.mode),
    },
  );
});

if (!state.realAfterAll) throw new Error('missing probe observer');
state.realAfterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
  const output = process.env.ZJU_ISOLATION_PROBE_OUTPUT;
  if (!output) throw new Error('missing probe output');
  writeFileSync(
    output,
    JSON.stringify({ events: state.events, openResources: [...state.openResources.values()] }),
  );
}, 2000);
