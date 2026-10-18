import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  initializeCustomerZipFileStore,
  type CustomerZipFileConfiguration,
  createCustomerZipFileObjectStore,
  createPreparationCompanyFileStore,
  createPreparationCompanyFileReader,
} from './file-object-store.js';
const key = 'customer-zip/0199e61a-7000-7000-8000-000000000001/1/original';
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
let base: string, root: string;
let binding: CustomerZipFileConfiguration;
const config = () => binding;
const physical = () => join(root, hash(key) + '.object');
beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), 'zhiju-file-custody-')));
  root = join(base, 'objects');
  binding = await initializeCustomerZipFileStore({ mode: 'MACOS_MANUAL_TEST', root });
});
afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});
describe('persistent local customer custody', () => {
  it('retains exact bytes and receipt after constructing a new adapter', async () => {
    const bytes = Buffer.from([0, 1, 254, 255, 13, 10]);
    const receipt = await createCustomerZipFileObjectStore(config()).put(key, bytes);
    const reopened = createCustomerZipFileObjectStore(config());
    expect(await reopened.read(key)).toEqual(bytes);
    expect(await reopened.inspect(key)).toEqual({ state: 'COMPLETE', receipt });
    expect(await reopened.put(key, bytes)).toEqual(receipt);
    expect((await lstat(root)).mode & 0o777).toBe(0o700);
    expect((await lstat(physical())).mode & 0o777).toBe(0o600);
    expect((await readdir(root)).sort()).toEqual(['.store.json', hash(key) + '.object']);
  });
  it('recovers only an explicitly pinned completed initialization without changing the store', async () => {
    const bytes = Buffer.from('original custody');
    await createCustomerZipFileObjectStore(binding).put(key, bytes);
    const originalMarker = await readFile(join(root, '.store.json'));
    expect(
      await initializeCustomerZipFileStore({
        mode: 'MACOS_MANUAL_TEST',
        root,
        storeId: binding.identity.storeId,
      }),
    ).toEqual(binding);
    expect(await createCustomerZipFileObjectStore(binding).read(key)).toEqual(bytes);
    await expect(
      initializeCustomerZipFileStore({ mode: 'MACOS_MANUAL_TEST', root }),
    ).rejects.toThrow();
    await expect(
      initializeCustomerZipFileStore({ mode: 'MACOS_MANUAL_TEST', root, storeId: randomUUID() }),
    ).rejects.toThrow();
    expect(await readFile(join(root, '.store.json'))).toEqual(originalMarker);
    await rm(join(root, '.store.json'));
    await expect(
      initializeCustomerZipFileStore({
        mode: 'MACOS_MANUAL_TEST',
        root,
        storeId: binding.identity.storeId,
      }),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual([hash(key) + '.object']);
  });
  it('does not overwrite an existing key with different bytes', async () => {
    const store = createCustomerZipFileObjectStore(config());
    await store.put(key, Buffer.from('first'));
    await expect(store.put(key, Buffer.from('second'))).rejects.toThrow(
      'INTEGRATION_OBJECT_IDENTITY_CONFLICT',
    );
    expect(await store.read(key)).toEqual(Buffer.from('first'));
  });
  it('uses create-if-absent publication for competing different writers', async () => {
    const values = [Buffer.from('first'), Buffer.from('second')];
    const results = await Promise.allSettled(
      values.map((bytes) => createCustomerZipFileObjectStore(config()).put(key, bytes)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const stored = await createCustomerZipFileObjectStore(config()).read(key);
    expect(values.some((v) => v.equals(stored))).toBe(true);
    expect((await readdir(root)).some((p) => p.startsWith('.pending-'))).toBe(false);
  });
  it('copies caller memory before asynchronous custody operations', async () => {
    const bytes = Buffer.from('first');
    const pending = createCustomerZipFileObjectStore(config()).put(key, bytes);
    bytes.fill(0);
    await pending;
    expect(await createCustomerZipFileObjectStore(config()).read(key)).toEqual(
      Buffer.from('first'),
    );
  });
  it('distinguishes a missing object from a missing infrastructure directory', async () => {
    const store = createCustomerZipFileObjectStore(config());
    expect(await store.inspect(key)).toEqual({ state: 'ABSENT' });
    await writeFile(join(root, '.pending-interrupted'), 'uncommitted bytes', { mode: 0o600 });
    expect(await store.inspect(key)).toEqual({ state: 'ABSENT' });
    await rm(root, { recursive: true });
    expect(await store.inspect(key)).toEqual({ state: 'UNKNOWN' });
  });
  it('does not treat corrupted or foreign-key objects as absent', async () => {
    const store = createCustomerZipFileObjectStore(config());
    await store.put(key, Buffer.from('first'));
    const intact = await readFile(physical());
    const damaged = Buffer.from(intact);
    damaged[damaged.length - 1] = 0;
    await writeFile(physical(), damaged);
    expect(await store.inspect(key)).toEqual({ state: 'UNKNOWN' });
    await expect(store.put(key, Buffer.from('first'))).rejects.toThrow();
    await writeFile(physical(), intact);
    const otherKey = key.replace('/1/', '/2/');
    await writeFile(join(root, hash(otherKey) + '.object'), intact, { mode: 0o600 });
    expect(await store.inspect(otherKey)).toEqual({ state: 'UNKNOWN' });
  });
  it('rejects untrusted keys before filesystem changes', async () => {
    const store = createCustomerZipFileObjectStore(config());
    for (const invalid of [
      '../escape',
      '/tmp/file',
      'customer-zip/../1/original',
      'company-source/' + 'ab'.repeat(32),
    ]) {
      await expect(store.put(invalid, Buffer.from('x'))).rejects.toThrow();
      expect(await store.inspect(invalid)).toEqual({ state: 'UNKNOWN' });
    }
    expect(await readdir(root)).toEqual(['.store.json']);
  });
  it('rejects symlink roots, aliases, objects and extra hard links', async () => {
    const store = createCustomerZipFileObjectStore(config());
    await store.put(key, Buffer.from('first'));
    await link(physical(), join(base, 'outside'));
    expect(await store.inspect(key)).toEqual({ state: 'UNKNOWN' });
    await rm(join(base, 'outside'));
    await rm(physical());
    await writeFile(join(base, 'outside'), 'private', { mode: 0o600 });
    await symlink(join(base, 'outside'), physical());
    expect(await store.inspect(key)).toEqual({ state: 'UNKNOWN' });
    await rm(root, { recursive: true });
    await symlink(base, root);
    await expect(store.put(key, Buffer.from('x'))).rejects.toThrow();
    await symlink(base, join(base, 'alias'));
    const aliased = createCustomerZipFileObjectStore({
      ...config(),
      root: join(base, 'alias', 'new'),
    });
    await expect(aliased.put(key, Buffer.from('x'))).rejects.toThrow();
  });
  it('rejects broad permissions instead of silently changing an existing deployment', async () => {
    const store = createCustomerZipFileObjectStore(config());
    await store.put(key, Buffer.from('first'));
    await chmod(physical(), 0o644);
    expect(await store.inspect(key)).toEqual({ state: 'UNKNOWN' });
    await chmod(physical(), 0o600);
    await chmod(root, 0o755);
    await expect(store.put(key, Buffer.from('first'))).rejects.toThrow();
    expect((await lstat(root)).mode & 0o777).toBe(0o755);
  });
  it('requires the explicit local mode and a canonical absolute directory', () => {
    expect(() =>
      createCustomerZipFileObjectStore({ ...config(), mode: 'PRODUCTION' as 'MACOS_MANUAL_TEST' }),
    ).toThrow();
    expect(() => createCustomerZipFileObjectStore({ ...config(), root: 'relative' })).toThrow();
    expect(() =>
      createCustomerZipFileObjectStore({ ...config(), root: root + '/../objects' }),
    ).toThrow();
  });
  it('publishes company bytes by actual hash and exposes only allowed immutable keys', async () => {
    const bytes = Buffer.from('company template'),
      sourceKey = 'company-source/' + hash(bytes);
    const publisher = createPreparationCompanyFileStore(config());
    await publisher.put(sourceKey, bytes);
    await expect(publisher.put('company-source/' + 'ab'.repeat(32), bytes)).rejects.toThrow();
    await expect(publisher.put(key, bytes)).rejects.toThrow();
    const reader = createPreparationCompanyFileReader(config(), [sourceKey]);
    expect(await reader.read(sourceKey)).toEqual(bytes);
    await expect(reader.read('company-source/' + 'ab'.repeat(32))).rejects.toThrow();
    expect(() => createPreparationCompanyFileReader(config(), ['../file'])).toThrow();
  });
});

it('never recreates a lost store and never treats a replacement empty root as original absence', async () => {
  const store = createCustomerZipFileObjectStore(config());
  await store.put(key, Buffer.from('first'));
  await rename(root, root + '-original');
  expect(await store.inspect(key)).toEqual({ state: 'UNKNOWN' });
  await expect(store.put(key.replace('/1/', '/2/'), Buffer.from('second'))).rejects.toThrow();
  await mkdir(root, { mode: 0o700 });
  await writeFile(
    join(root, '.store.json'),
    await readFile(join(root + '-original', '.store.json')),
    { mode: 0o600 },
  );
  expect(await createCustomerZipFileObjectStore(config()).inspect(key)).toEqual({
    state: 'UNKNOWN',
  });
  await expect(store.put(key.replace('/1/', '/2/'), Buffer.from('second'))).rejects.toThrow();
  await expect(
    initializeCustomerZipFileStore({ mode: 'MACOS_MANUAL_TEST', root }),
  ).rejects.toThrow();
  await rm(root, { recursive: true });
  await rename(root + '-original', root);
  expect(await store.read(key)).toEqual(Buffer.from('first'));
});
