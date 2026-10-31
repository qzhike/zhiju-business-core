import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Keep custody, real Keycloak and transport/restart on independent runners.
// New files go to partition 3; every partition owns a separate disposable DB.
export const fixedPartitions = {
  1: ['tests/persistence/mvp-document-delivery.test.ts'],
  2: ['tests/persistence/mvp-controlled-keycloak.test.ts'],
};

export function discoverPersistenceFiles(root) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`unexpected persistence symlink: ${path}`);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(path);
    }
  }
  visit('tests/persistence');
  if (!files.length) throw new Error('empty persistence file inventory');
  return files.sort();
}

export function partitionFiles(files, id, fixed = fixedPartitions) {
  if (!['1', '2', '3'].includes(id)) throw new Error(`invalid persistence partition: ${id}`);
  if (!files.length || new Set(files).size !== files.length)
    throw new Error('empty or duplicate persistence file inventory');
  if (Object.keys(fixed).sort().join(',') !== '1,2')
    throw new Error('expected exactly two fixed persistence partitions');
  const assigned = Object.values(fixed).flat();
  if (new Set(assigned).size !== assigned.length)
    throw new Error('duplicate fixed persistence assignment');
  for (const file of assigned)
    if (!files.includes(file)) throw new Error(`missing fixed persistence file: ${file}`);
  const selected = files.filter((file) =>
    id === '3' ? !assigned.includes(file) : fixed[id].includes(file),
  );
  if (!selected.length) throw new Error(`empty persistence partition: ${id}`);
  return selected;
}

export function selectPersistenceRun(args, root) {
  const options = new Map();
  for (const arg of args) {
    const key = arg.split('=')[0];
    if (
      !['--diagnostics', '--partition', '--test-file', '--test-name-pattern'].includes(key) ||
      options.has(key) ||
      (key === '--diagnostics' ? arg !== key : !arg.startsWith(`${key}=`))
    )
      throw new Error('unknown or duplicate persistence argument');
    options.set(key, key === '--diagnostics' ? true : arg.slice(key.length + 1));
  }
  const partition = options.get('--partition');
  const testFile = options.get('--test-file');
  const pattern = options.get('--test-name-pattern');
  if (partition !== undefined && options.size !== 1)
    throw new Error('partition cannot be combined with diagnostic filters');
  if (pattern !== undefined && (!testFile || !pattern))
    throw new Error('test name filter requires an explicit file and nonempty pattern');
  const files = discoverPersistenceFiles(root);
  if (testFile !== undefined) {
    if (!/^tests\/persistence\/[a-z0-9-]+\.test\.ts$/.test(testFile) || !files.includes(testFile))
      throw new Error('diagnostics must select one existing persistence test file');
    return { kind: 'focused', files: [testFile], pattern };
  }
  if (partition !== undefined)
    return { kind: 'partition', partition, files: partitionFiles(files, partition) };
  return { kind: 'full', files };
}

export function persistenceRunEnvironment(run) {
  // Override inherited diagnostic/partition flags for every child invocation.
  return {
    ZJU_PERSISTENCE_FOCUSED: run.kind === 'focused' ? '1' : '0',
    ZJU_PERSISTENCE_PARTITION: run.kind === 'partition' ? run.partition : '',
  };
}

export function assertPersistenceFileExecution(root, modules, expected) {
  const actual = modules.map((module) => relative(root, module.moduleId).replaceAll('\\', '/'));
  const missing = expected.filter((file) => !actual.includes(file));
  const unexpected = actual.filter((file) => !expected.includes(file));
  if (
    !expected.length ||
    new Set(actual).size !== actual.length ||
    missing.length ||
    unexpected.length
  )
    throw new Error(
      `persistence file inventory failed: missing=${missing.join(',')}; unexpected=${unexpected.join(',')}; duplicate=${new Set(actual).size !== actual.length}`,
    );
  process.stdout.write(`[persistence-test] file inventory passed: files=${expected.length}\n`);
}
