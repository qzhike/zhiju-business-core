import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const persistenceConfig = join(root, 'vitest.persistence.config.ts');
const criticalFile = 'tests/persistence/controlled-exit.test.ts';

it.each([
  ['complete', 'critical inventory passed: files=5; tests=96'],
  ['missing-file', `missing file: ${criticalFile}`],
  ['missing-case', 'expected exactly one case, found 0:'],
  ['duplicate', 'expected exactly one case, found 2:'],
  ['renamed', 'unexpected case:'],
  ['extra', 'unexpected case:'],
  ['moved', `missing file: ${criticalFile}`],
  ['skipped', 'case did not pass (skipped):'],
  ['failed', 'case did not pass (failed):'],
  ['focused', 'critical inventory not checked: focused diagnostic only'],
])(
  'enforces actual Vitest critical case execution: %s',
  async (mode, expected) => {
    const temp = await mkdtemp(join(tmpdir(), 'zhiju-critical-cases-'));
    try {
      const inventory = JSON.parse(
        await readFile(join(root, 'tools/persistence/critical-cases.json'), 'utf8'),
      ) as Record<string, string[]>;
      const include: string[] = [];
      for (const [file, names] of Object.entries(inventory)) {
        // Exclude a file from collection without deleting its source.
        if (mode !== 'missing-file' || file !== criticalFile) include.push(file);
        let statements = names.map((name) => `it(${JSON.stringify(name)}, () => {});`);
        if (file === criticalFile) {
          if (mode === 'missing-case') statements = statements.slice(1);
          if (mode === 'duplicate') statements.push(statements[0] ?? '');
          if (mode === 'renamed') statements[0] = 'it("renamed critical case", () => {});';
          if (mode === 'extra') statements.push('it("unexpected critical case", () => {});');
          if (mode === 'skipped') statements[0] = statements[0]?.replace('it(', 'it.skip(') ?? '';
          if (mode === 'failed')
            statements[0] =
              statements[0]?.replace('() => {}', '() => { throw new Error("injected"); }') ?? '';
        }
        const target =
          mode === 'moved' && file === criticalFile
            ? 'tests/persistence/moved-controlled-exit.test.ts'
            : file;
        if (target !== file) include[include.indexOf(file)] = target;
        await mkdir(dirname(join(temp, target)), { recursive: true });
        // Absolute Vitest import keeps the fixture independent of temp-directory resolution.
        await writeFile(
          join(temp, target),
          `import { it } from ${JSON.stringify(join(dirname(vitest), 'dist/index.js'))};\n${statements.join('\n')}\n`,
        );
      }
      const config = join(temp, 'vitest.config.mjs');
      await writeFile(
        config,
        `import configured from ${JSON.stringify(persistenceConfig)};
export default {
  ...configured,
  root: ${JSON.stringify(temp)},
  test: {
    ...configured.test,
    include: ${JSON.stringify(mode === 'focused' ? [criticalFile] : include)},
    reporters: configured.test.reporters.map((reporter) =>
      typeof reporter === 'string' && reporter.startsWith('.')
        ? ${JSON.stringify(root)} + '/' + reporter
        : reporter),
    maxWorkers: 1,
  },
};`,
      );
      const result = await new Promise<{ code: number; log: string }>((resolveRun, reject) => {
        execFile(
          process.execPath,
          [vitest, 'run', '--config', config],
          {
            cwd: root,
            timeout: 15_000,
            env: { ...process.env, ZJU_PERSISTENCE_FOCUSED: mode === 'focused' ? '1' : '0' },
          },
          (error, stdout, stderr) => {
            const code = error?.code;
            if (error && (error.killed || typeof code !== 'number')) {
              reject(new Error('critical case probe could not complete', { cause: error }));
              return;
            }
            resolveRun({ code: typeof code === 'number' ? code : 0, log: stdout + stderr });
          },
        );
      });
      expect(result.code, result.log).toBe(['complete', 'focused'].includes(mode) ? 0 : 1);
      expect(result.log).toContain(expected);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  },
  20_000,
);
