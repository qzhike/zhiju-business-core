import { createConnection, createServer, type Server } from 'node:net';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { flockSync } from 'fs-ext';

/**
 * Per-attempt and per-instance mutual exclusion on the real local filesystem.
 *
 * A kernel flock on a stable file protects the whole ownership period,
 * including stale socket recovery. Never unlink that file: all contenders
 * must lock the same inode. The socket also rejects an existing legacy writer;
 * upgrades must stop the old instance before starting the new binary.
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
  socket.once('error', (error: NodeJS.ErrnoException) => {
    finish(error.code === 'ECONNREFUSED' || error.code === 'ENOENT' ? 'STALE' : 'LIVE');
  });
  return promise;
}

/** Returns `null` when a live writer already holds the lock. */
export async function acquireExclusiveLock(path: string): Promise<ExclusiveLock | null> {
  await mkdir(LOCK_DIRECTORY, { recursive: true, mode: 0o700 });
  const file = await open(
    `${path}.lock`,
    constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    0o600,
  );
  let held = false;
  try {
    if (!(await file.stat()).isFile()) throw new Error('MVP_LOCK_FILE_INVALID');
    try {
      // Nonblocking: a live owner must never stall the event loop or be evicted.
      flockSync(file.fd, 'exnb');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EAGAIN' || code === 'EWOULDBLOCK') return null;
      throw error;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const server = await listen(path);
      if (server !== 'IN_USE') {
        held = true;
        let releasing: Promise<void> | undefined;
        return {
          release() {
            releasing ??= (async () => {
              await new Promise<void>((resolve, reject) => {
                // close removes this socket before releasing the kernel lock.
                server.close((error) => {
                  if (error) reject(error);
                  else resolve();
                });
              });
              await file.close();
            })();
            return releasing;
          },
        };
      }
      if ((await probe(path)) === 'LIVE') return null;
      try {
        await unlink(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return null;
  } finally {
    if (!held) await file.close();
  }
}

/** Read-only writer probe used by reconciliation before claiming a lock. */
export async function writerAlive(path: string): Promise<boolean> {
  return (await probe(path)) === 'LIVE';
}
