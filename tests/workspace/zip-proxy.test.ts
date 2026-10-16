import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}
async function close(server: Server): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  server.closeIdleConnections();
  await closed;
}

it('forwards the complete ZIP response when owning processing outlasts a normal JSON request', async () => {
  const path = '/bff/customer-intakes/01920000-0000-7000-8000-000000000001/zip';
  const received: Buffer[] = [];
  const upstream = createServer((request, response) => {
    if (request.url !== path) {
      response.end('ready');
      return;
    }
    void (async () => {
      for await (const chunk of request) received.push(Buffer.from(chunk as Uint8Array));
      // Real owning validation and custody can finish after the ZIP body ends.
      await delay(16_000);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ disposition: 'STAGED' }));
    })();
  });
  const upstreamPort = await listen(upstream);
  const reservation = createServer();
  const webPort = await listen(reservation);
  await close(reservation);
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('../../apps/workspace-web/tools/serve.mjs', import.meta.url))],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(webPort),
        BFF_URL: `http://127.0.0.1:${upstreamPort}`,
      },
      stdio: 'ignore',
    },
  );
  const exited = once(child, 'exit');
  try {
    const origin = `http://127.0.0.1:${webPort}`;
    const deadline = Date.now() + 5_000;
    for (;;) {
      const ready = await fetch(origin + '/bff/health', {
        headers: { connection: 'close' },
      })
        .then(async (response) => {
          await response.text();
          return response.ok;
        })
        .catch(() => false);
      if (ready) break;
      if (child.exitCode !== null || Date.now() >= deadline) throw new Error('Proxy did not start');
      await delay(20);
    }
    const bytes = Buffer.from('controlled ZIP transport bytes');
    const response = await fetch(origin + path, {
      method: 'PUT',
      headers: { 'content-type': 'application/zip', connection: 'close' },
      body: bytes,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ disposition: 'STAGED' });
    expect(Buffer.concat(received)).toEqual(bytes);
  } finally {
    child.kill('SIGTERM');
    await exited;
    await close(upstream);
  }
}, 25_000);
