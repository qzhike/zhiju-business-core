import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { trackPoolShutdown } from '../../tools/persistence/pool-shutdown.mjs';

// Keep the locked pg-pool implementation real; control only the transport's
// asynchronous end event so teardown races do not depend on machine timing.
class DelayedClient extends EventEmitter {
  _queryable = true;
  _ending = false;
  private callbacks: (() => void)[] = [];

  connect(callback: () => void) {
    queueMicrotask(callback);
  }

  end(callback: () => void) {
    this._ending = true;
    this.callbacks.push(callback);
  }

  finish() {
    this.emit('end');
    for (const callback of this.callbacks.splice(0)) callback();
  }
}

function fixture() {
  const config = {
    Client: DelayedClient as unknown as typeof pg.Client,
    idleTimeoutMillis: 0,
  };
  const pool = new pg.Pool(config);
  const cleanup = trackPoolShutdown(pool);
  return { pool, cleanup };
}

describe('initial Context pool shutdown', () => {
  it.each(['idle', 'removed'] as const)(
    'waits for every %s connection to end before allowing container shutdown',
    async (state) => {
      const { pool, cleanup } = fixture();
      const clients = await Promise.all([pool.connect(), pool.connect()]);
      for (const client of clients) client.release(state === 'removed');
      let stopped = false;
      const closing = cleanup.end().then(() => {
        stopped = true;
      });
      try {
        await setImmediate();
        // pg-pool has already forgotten these clients. Its count/end promise
        // cannot establish that their transport shutdown has completed.
        expect(pool.totalCount).toBe(0);
        expect(stopped).toBe(false);
        (clients[0] as unknown as DelayedClient).finish();
        await setImmediate();
        expect(stopped).toBe(false);
      } finally {
        for (const client of clients) (client as unknown as DelayedClient).finish();
        await closing;
      }
      expect(stopped).toBe(true);
    },
  );

  it('retains fatal idle-connection errors during shutdown', async () => {
    const { pool, cleanup } = fixture();
    const client = await pool.connect();
    client.release();
    const closing = cleanup.end();
    const failure = Object.assign(
      new Error('terminating connection due to administrator command'),
      {
        code: '57P01',
      },
    );
    try {
      expect(() => client.emit('error', failure)).toThrow(failure);
    } finally {
      (client as unknown as DelayedClient).finish();
      await closing;
    }
  });

  it('propagates pool end failures', async () => {
    const { pool, cleanup } = fixture();
    const failure = new Error('pool cleanup failed');
    vi.spyOn(pool, 'end').mockRejectedValueOnce(failure);
    await expect(cleanup.end()).rejects.toBe(failure);
  });

  it('finishes when no connections were opened', async () => {
    const { cleanup } = fixture();
    await cleanup.end();
  });

  it('does not wait again for a connection that already ended', async () => {
    const { pool, cleanup } = fixture();
    const client = await pool.connect();
    client.release(true);
    (client as unknown as DelayedClient).finish();
    await cleanup.end();
  });
});
