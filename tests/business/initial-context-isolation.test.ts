import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

it.each([
  'normal',
  'late-body',
  'body-reused',
  'body-fresh',
  'drain-hang',
  'drain-hook',
  'dispose-hang',
  'setup-late',
  'setup-hook',
  'setup-failure',
  'assertion',
])(
  'closes isolated resources and preserves failure boundaries: %s',
  async (mode) => {
    const temp = await mkdtemp(join(tmpdir(), 'zhiju-isolation-'));
    try {
      const output = join(temp, 'events.json');
      const config = join(temp, 'vitest.config.mjs');
      await writeFile(
        config,
        `export default ${JSON.stringify({
          test: {
            include: [join(root, 'tests/persistence/initial-context-isolation-probe.ts')],
            fileParallelism: false,
            maxWorkers: 1,
          },
        })};`,
      );
      const result = await new Promise<{ code: number; log: string }>((resolveRun, reject) => {
        execFile(
          process.execPath,
          [vitest, 'run', '--config', config],
          {
            cwd: root,
            timeout: 15_000,
            env: {
              ...process.env,
              ZJU_ISOLATION_PROBE_MODE: mode,
              ZJU_ISOLATION_PROBE_OUTPUT: output,
            },
          },
          (error, stdout, stderr) => {
            const exitCode = error?.code;
            if (error && (error.killed || typeof exitCode !== 'number')) {
              reject(new Error('lifecycle probe could not complete', { cause: error }));
              return;
            }
            resolveRun({ code: typeof exitCode === 'number' ? exitCode : 0, log: stdout + stderr });
          },
        );
      });
      expect(result.code, result.log).toBe(mode === 'normal' ? 0 : 1);
      const { events, openResources } = JSON.parse(await readFile(output, 'utf8')) as {
        events: string[];
        openResources: number[];
      };
      const started = events
        .filter((event) => event.startsWith('started:'))
        .map((event) => event.slice('started:'.length));
      expect(started.length).toBeGreaterThanOrEqual(2);
      for (const id of started)
        expect(
          events.filter((event) => event === `stopped:${id}`),
          result.log,
        ).toHaveLength(1);
      expect(
        openResources.every((count) => count === 0),
        result.log,
      ).toBe(true);
      if (mode.startsWith('setup-')) {
        expect(events.some((event) => event.startsWith('body:'))).toBe(false);
        if (mode === 'setup-late') {
          expect(started).toContain('3');
          expect(events).not.toContain('suite:3');
          expect(events).not.toContain('migrated:probe-3');
        } else expect(started).toHaveLength(2);
      } else {
        expect(events).toContain('body:healthy');
        if (['normal', 'body-fresh', 'dispose-hang'].includes(mode))
          expect(events).toContain('body:second');
        else expect(events).not.toContain('body:second');
      }
      if (mode === 'late-body')
        expect(events.indexOf('body:first settled')).toBeLessThan(events.indexOf('disposed:1'));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  },
  20_000,
);
