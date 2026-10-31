import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertPersistenceFileExecution,
  discoverPersistenceFiles,
  fixedPartitions,
  partitionFiles,
  persistenceRunEnvironment,
  selectPersistenceRun,
} from '../persistence/partitions.mjs';
import { verifyMigrationNoop } from '../persistence/migration-noop.mjs';

const root = resolve(import.meta.dirname, '../..');
const files = discoverPersistenceFiles(root);

describe('persistence partition coverage and mode boundaries', () => {
  it('assigns every discovered file exactly once and defaults new nested files to partition 3', () => {
    const expanded = [...files, 'tests/persistence/new/nested.test.ts'];
    const parts = ['1', '2', '3'].map((id) => partitionFiles(expanded, id));
    expect(parts.flat().sort()).toEqual([...expanded].sort());
    expect(new Set(parts.flat()).size).toBe(expanded.length);
    expect(parts[2]).toContain('tests/persistence/new/nested.test.ts');
    expect(parts.map((part) => part.length > 0)).toEqual([true, true, true]);
  });

  it.each(['', '0', '4', '1/3', '01', 'all'])('rejects invalid partition %j', (id) => {
    expect(() => partitionFiles(files, id)).toThrow('invalid persistence partition');
  });

  it('rejects deleted fixed files, duplicate assignment and empty partitions', () => {
    expect(() =>
      partitionFiles(
        files.filter((file) => !file.endsWith('/mvp-document-delivery.test.ts')),
        '3',
      ),
    ).toThrow('missing fixed');
    expect(() =>
      partitionFiles(files, '1', { '1': fixedPartitions['1'], '2': fixedPartitions['1'] }),
    ).toThrow('duplicate fixed');
    expect(() => partitionFiles(files, '1', { '1': [], '2': [] })).toThrow(
      'empty persistence partition',
    );
    expect(() => partitionFiles(files, '1', { ...fixedPartitions, '3': [] })).toThrow(
      'exactly two',
    );
    expect(() => partitionFiles([], '1')).toThrow('empty or duplicate');
    expect(() => partitionFiles([...files, ...files], '1')).toThrow('empty or duplicate');
  });

  it('keeps default full and explicit focused diagnostics distinct from partitions', () => {
    expect(selectPersistenceRun([], root)).toEqual({ kind: 'full', files });
    expect(selectPersistenceRun(['--diagnostics'], root)).toEqual({ kind: 'full', files });
    for (const partition of ['1', '2', '3'])
      expect(selectPersistenceRun([`--partition=${partition}`], root)).toEqual({
        kind: 'partition',
        partition,
        files: partitionFiles(files, partition),
      });
    const focused = selectPersistenceRun(
      [
        '--test-file=tests/persistence/mvp-document-delivery.test.ts',
        '--test-name-pattern=example',
      ],
      root,
    );
    expect(focused.kind).toBe('focused');
    expect(focused.pattern).toBe('example');
    expect(persistenceRunEnvironment(focused)).toEqual({
      ZJU_PERSISTENCE_FOCUSED: '1',
      ZJU_PERSISTENCE_PARTITION: '',
    });
    expect(persistenceRunEnvironment(selectPersistenceRun([], root))).toEqual({
      ZJU_PERSISTENCE_FOCUSED: '0',
      ZJU_PERSISTENCE_PARTITION: '',
    });
    expect(persistenceRunEnvironment(selectPersistenceRun(['--partition=1'], root))).toEqual({
      ZJU_PERSISTENCE_FOCUSED: '0',
      ZJU_PERSISTENCE_PARTITION: '1',
    });
  });

  it.each([
    ['--partition=1', '--test-file=tests/persistence/mvp-document-delivery.test.ts'],
    ['--partition=1', '--test-name-pattern=foo'],
    ['--partition=1', '--diagnostics'],
    ['--partition=1', '--partition=1'],
    ['--partition='],
    ['--partition'],
    ['--partition=4'],
    ['--unknown'],
    ['--test-name-pattern=foo'],
    ['--test-file=tests/persistence/missing.test.ts'],
    ['--diagnostics=1'],
    ['--test-file=../outside.test.ts'],
  ])('rejects malformed or mixed mode %#', (...args) => {
    expect(() => selectPersistenceRun(args, root)).toThrow();
  });

  it('checks exact collected files, not just count, including full runs', () => {
    const expected = partitionFiles(files, '2');
    const modules = expected.map((file) => ({ moduleId: join(root, file) }));
    expect(() => {
      assertPersistenceFileExecution(root, modules, expected);
    }).not.toThrow();
    expect(() => {
      assertPersistenceFileExecution(root, modules.slice(1), expected);
    }).toThrow('missing=');
    expect(() => {
      assertPersistenceFileExecution(root, [...modules, ...modules], expected);
    }).toThrow('duplicate=true');
    expect(() => {
      assertPersistenceFileExecution(
        root,
        [{ moduleId: join(root, 'tests/persistence/wrong.test.ts') }, ...modules.slice(1)],
        expected,
      );
    }).toThrow('unexpected=tests/persistence/wrong.test.ts');
    expect(() => {
      assertPersistenceFileExecution(root, [], expected);
    }).toThrow();
    expect(() => {
      assertPersistenceFileExecution(root, [], []);
    }).toThrow();
  });
});

describe('single gate migration no-op check', () => {
  const history = '[{"installed_rank":1,"version":"0001","checksum":123}]';

  it('requires unchanged complete history around a successful no-op', async () => {
    const calls: string[] = [];
    const line = await verifyMigrationNoop(
      () => {
        calls.push('history');
        return Promise.resolve(history);
      },
      () => {
        calls.push('migrate');
        return Promise.resolve('Schema is up to date. No migration necessary.');
      },
    );
    expect(calls).toEqual(['history', 'migrate', 'history']);
    expect(line).toContain('No migration necessary');
  });

  it('rejects drift even when Flyway claims no pending migrations', async () => {
    let reads = 0;
    await expect(
      verifyMigrationNoop(
        () => Promise.resolve(++reads === 1 ? history : history.replace('123', '456')),
        () => Promise.resolve('no pending migrations'),
      ),
    ).rejects.toThrow('history changed');
  });

  it.each(['command', 'first-read', 'second-read', 'migration-applied', 'empty-history'])(
    'rejects %s instead of reporting gate success',
    async (mode) => {
      let reads = 0;
      await expect(
        verifyMigrationNoop(
          () => {
            reads++;
            if ((mode === 'first-read' && reads === 1) || (mode === 'second-read' && reads === 2))
              return Promise.reject(new Error('history read failed'));
            return Promise.resolve(mode === 'empty-history' ? '[]' : history);
          },
          () => {
            if (mode === 'command') return Promise.reject(new Error('migrate failed'));
            return Promise.resolve(
              mode === 'migration-applied' ? 'Successfully applied 1 migration' : 'up to date',
            );
          },
        ),
      ).rejects.toThrow();
    },
  );
});
