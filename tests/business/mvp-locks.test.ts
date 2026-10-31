import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createServer } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireExclusiveLock,
  lockPathFor,
  type ExclusiveLock,
} from '../../modules/document-delivery/src/custody/locks.js';

const paths: string[] = [];
const holders: ExclusiveLock[] = [];
const children: ChildProcess[] = [];
function pathForTest(): string {
  const path = lockPathFor(`mvp-lock-test-${randomUUID()}`);
  paths.push(path);
  return path;
}
async function keep(path: string): Promise<ExclusiveLock | null> {
  const lock = await acquireExclusiveLock(path);
  if (lock !== null) holders.push(lock);
  return lock;
}
function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once('exit', () => {
      resolve();
    });
    child.once('error', reject);
  });
}
function message(child: ChildProcess): Promise<unknown> {
  return new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', reject);
  });
}
function processContender(path: string): ChildProcess {
  const moduleUrl = new URL(
    '../../modules/document-delivery/dist/custody/locks.js',
    import.meta.url,
  );
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { acquireExclusiveLock } from ${JSON.stringify(moduleUrl.href)};
    let lock;
    process.on('message', async () => {
      lock = await acquireExclusiveLock(${JSON.stringify(path)});
      process.send({ acquired: lock !== null });
    });
  `,
    ],
    { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] },
  );
  children.push(child);
  return child;
}
afterEach(async () => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  await Promise.all(
    children.splice(0).map(async (child) => {
      const done = exited(child);
      child.kill('SIGKILL');
      await done;
    }),
  );
  await Promise.all(holders.splice(0).map((lock) => lock.release()));
  for (const path of paths.splice(0)) {
    await fs.unlink(path).catch(() => undefined);
    await fs.unlink(`${path}.lock`).catch(() => undefined);
  }
});

describe('MVP local kernel locks', () => {
  it('excludes another fd and makes late repeated release harmless', async () => {
    const path = pathForTest();
    const first = await keep(path);
    expect(first).not.toBeNull();
    const inode = (await fs.stat(`${path}.lock`)).ino;
    expect(await keep(path)).toBeNull();
    await first?.release();
    const next = await keep(path);
    expect(next).not.toBeNull();
    await first?.release();
    expect(await keep(path)).toBeNull();
    expect((await fs.stat(`${path}.lock`)).ino).toBe(inode);
  });

  it('serializes stale socket recovery even with two delayed cleanup contenders', async () => {
    const path = pathForTest();
    const child = spawn(process.execPath, [
      '-e',
      'require("node:net").createServer().listen(process.argv[1], () => process.exit(0))',
      path,
    ]);
    children.push(child);
    await exited(child);
    expect((await fs.lstat(path)).isSocket()).toBe(true);
    const original = fs.unlink.bind(fs);
    const firstStale = Promise.withResolvers<undefined>();
    const secondStale = Promise.withResolvers<undefined>();
    const allowFirst = Promise.withResolvers<undefined>();
    const firstAcquired = Promise.withResolvers<undefined>();
    let unlinks = 0;
    vi.spyOn(fs, 'unlink').mockImplementation(async (target) => {
      if (target === path) {
        if (++unlinks === 1) {
          firstStale.resolve(undefined);
          await allowFirst.promise;
        } else {
          secondStale.resolve(undefined);
          await firstAcquired.promise;
        }
      }
      await original(target);
    });
    syncBuiltinESMExports();
    const first = keep(path);
    try {
      await firstStale.promise;
      const second = keep(path);
      // A fixed implementation rejects B before unlink; the old one reaches it.
      await Promise.race([second.then(() => undefined), secondStale.promise]);
      allowFirst.resolve(undefined);
      const a = await first;
      firstAcquired.resolve(undefined);
      const b = await second;
      expect([a, b].filter(Boolean)).toHaveLength(1);
    } finally {
      allowFirst.resolve(undefined);
      firstAcquired.resolve(undefined);
    }
  });

  it('releases on real SIGKILL and allows only one cross-process successor', async () => {
    const path = pathForTest();
    const owner = processContender(path);
    const owned = message(owner);
    owner.send('acquire');
    expect(await owned).toEqual({ acquired: true });
    expect(await keep(path)).toBeNull();
    const stopped = exited(owner);
    owner.kill('SIGKILL');
    await stopped;
    const contenders = [processContender(path), processContender(path), processContender(path)];
    const results = contenders.map((child) => message(child));
    for (const child of contenders) child.send('acquire');
    expect(
      (await Promise.all(results)).filter((result) => (result as { acquired: boolean }).acquired),
    ).toHaveLength(1);
    expect(await keep(path)).toBeNull();
  });

  it('refuses a live legacy socket without removing it', async () => {
    const path = pathForTest();
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => server.listen(path, resolve));
    try {
      const inode = (await fs.lstat(path)).ino;
      expect(await keep(path)).toBeNull();
      expect((await fs.lstat(path)).ino).toBe(inode);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    }
    expect(await keep(path)).not.toBeNull();
  });

  it('fails closed on a substituted lock file without touching the target', async () => {
    const path = pathForTest();
    const target = pathForTest();
    await fs.writeFile(target, 'preserve');
    await fs.symlink(target, `${path}.lock`);
    await expect(keep(path)).rejects.toMatchObject({ code: 'ELOOP' });
    expect(await fs.readFile(target, 'utf8')).toBe('preserve');
  });
});
