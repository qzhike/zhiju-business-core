import { createConnection, createServer, type Server } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Per-attempt and per-instance mutual exclusion on the real local filesystem.
 *
 * A bound Unix domain socket is the lock: the kernel releases it when the
 * owning process exits, while a stale socket file from a crash refuses
 * connections and can be reclaimed. A connectable socket means a live writer,
 * so a lease timeout alone can never be mistaken for writer termination.
 */
export interface ExclusiveLock {
  release(): Promise<void>;
}

const CONNECT_TIMEOUT_MS = 500;
const LOCK_DIRECTORY = '/tmp/zhiju-mvp-locks';

/**
 * macOS caps Unix-domain socket paths at roughly 100 bytes, so the identity is
 * hashed into a short, stable name instead of embedding the store root.
 */
export function lockPathFor(identity: string): string {
  return join(
    LOCK_DIRECTORY,
    `${createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 40)}.sock`,
  );
}

async function listen(path: string): Promise<Server | 'IN_USE'> {
  const { promise, resolve, reject } = Promise.withResolvers<Server | 'IN_USE'>();
  const server = createServer((socket) => socket.destroy());
  server.once('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') resolve('IN_USE');
    else reject(error);
  });
  server.listen(path, () => {
    resolve(server);
  });
  return promise;
}

function probe(path: string): Promise<'LIVE' | 'STALE'> {
  const { promise, resolve } = Promise.withResolvers<'LIVE' | 'STALE'>();
  const socket = createConnection(path);
  let settled = false;
  const finish = (state: 'LIVE' | 'STALE'): void => {
    if (settled) return;
    settled = true;
    socket.removeAllListeners();
    socket.destroy();
    resolve(state);
  };
  socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
    finish('LIVE');
  });
  socket.once('connect', () => {
    finish('LIVE');
  });
  socket.once('error', () => {
    finish('STALE');
  });
  return promise;
}

/** Returns `null` when a live writer already holds the lock. */
export async function acquireExclusiveLock(path: string): Promise<ExclusiveLock | null> {
  await mkdir(LOCK_DIRECTORY, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    const server = await listen(path);
    if (server !== 'IN_USE')
      return {
        async release() {
          const { promise, resolve, reject } = Promise.withResolvers<undefined>();
          server.close((error) => {
            if (error) reject(error);
            else resolve(undefined);
          });
          await promise;
          await unlink(path).catch(() => undefined);
        },
      };
    if ((await probe(path)) === 'LIVE') return null;
    await unlink(path).catch(() => undefined);
  }
  return null;
}

/** Read-only writer probe used by reconciliation before claiming a lock. */
export async function writerAlive(path: string): Promise<boolean> {
  return (await probe(path)) === 'LIVE';
}
