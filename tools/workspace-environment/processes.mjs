import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { open } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { deploymentFingerprint, publicStatus } from './config.mjs';
import { applicationEnvironments } from './deployment.mjs';
import { assertPortAvailable, waitUntil } from './infrastructure.mjs';

export async function supervisorRequest(config, secrets, action = 'status') {
  let response;
  try {
    response = await globalThis.fetch(`http://127.0.0.1:${config.ports.control}/${action}`, {
      method: action === 'stop' ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${secrets.controlToken}` },
      signal: globalThis.AbortSignal.timeout(3000),
      redirect: 'error',
    });
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return null;
    throw new Error('ENV_B_SUPERVISOR_UNREACHABLE', { cause: error });
  }
  if (!response.ok) throw new Error('ENV_B_SUPERVISOR_OWNER_MISMATCH');
  const value = await response.json();
  if (value.instanceId !== config.instanceId) throw new Error('ENV_B_SUPERVISOR_OWNER_MISMATCH');
  if (value.configurationHash !== deploymentFingerprint(config))
    throw new Error('ENV_B_CONFIGURATION_CHANGED');
  return value;
}

async function childExited(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(timeout).then(() => false),
  ]);
}

/** Retains actual ChildProcess handles. A stale pid file never grants kill authority. */
export async function runSupervisor(root, config, secrets, identities) {
  const children = new Map(),
    logs = [];
  const { readPreparationDeployment } = await import('./preparation.mjs');
  const deployment = await readPreparationDeployment(config);
  const environment = applicationEnvironments(config, secrets, identities, deployment);
  let state = 'STARTING',
    closing;
  const status = () => ({
    ...publicStatus(
      config,
      Object.fromEntries(
        [...children].map(([key, child]) => [
          key,
          child.exitCode === null && child.signalCode === null ? 'RUNNING' : 'STOPPED',
        ]),
      ),
    ),
    state,
    runner: {
      projectRoot: config.runner.projectRoot,
      profileFile: config.runner.profileFile ?? join(config.dataDir, 'omp-profile.json'),
      state: deployment.localOmp ? 'CONFIGURED' : 'NOT_CONNECTED',
    },
  });
  const server = createServer((request, response) => {
    const actual = Buffer.from(request.headers.authorization ?? ''),
      expected = Buffer.from(`Bearer ${secrets.controlToken}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      response.writeHead(403).end();
      return;
    }
    if (request.method === 'GET' && request.url === '/status') {
      response
        .writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        .end(JSON.stringify(status()));
    } else if (request.method === 'POST' && request.url === '/stop') {
      state = 'STOPPING';
      response.writeHead(202, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          instanceId: config.instanceId,
          configurationHash: deploymentFingerprint(config),
        }),
      );
      void close();
    } else response.writeHead(404).end();
  });
  const close = () =>
    (closing ??= (async () => {
      state = 'STOPPING';
      for (const child of [...children.values()].reverse())
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      for (const child of children.values()) {
        if (!(await childExited(child, 5000))) {
          child.kill('SIGKILL');
          await childExited(child, 3000);
        }
      }
      await new Promise((resolve) => server.close(resolve));
      for (const log of logs) await log.close();
    })());
  process.once('SIGTERM', () => {
    void close();
  });
  process.once('SIGINT', () => {
    void close();
  });
  try {
    for (const key of ['web', 'bff', 'core', 'control'])
      await assertPortAvailable(config.ports[key]);
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.ports.control, '127.0.0.1', resolve);
    });
    for (const [key, script, path] of [
      ['core', 'apps/api/dist/main.js', '/health'],
      ['bff', 'apps/workspace-bff/dist/main.js', '/bff/health'],
      ['web', 'apps/workspace-web/tools/serve.mjs', '/workbench'],
    ]) {
      if (closing) throw new Error('ENV_B_START_CANCELLED');
      const log = await open(join(config.dataDir, `${key}.log`), 'a', 0o600);
      logs.push(log);
      const child = spawn(process.execPath, [join(root, script)], {
        cwd: root,
        env: environment[key],
        stdio: ['ignore', log.fd, log.fd],
      });
      children.set(key, child);
      child.once('error', () => {
        console.error(`ENV_B_${key.toUpperCase()}_START_FAILED`);
        void close();
      });
      child.once('exit', () => {
        if (!closing) {
          console.error(`ENV_B_${key.toUpperCase()}_EXITED`);
          void close();
        }
      });
      await waitUntil(async () => {
        if (closing) throw new Error('ENV_B_CHILD_EXITED');
        try {
          return (
            await globalThis.fetch(`http://127.0.0.1:${config.ports[key]}${path}`, {
              headers: { accept: key === 'web' ? 'text/html' : 'application/json' },
              signal: globalThis.AbortSignal.timeout(2000),
            })
          ).ok;
        } catch {
          return false;
        }
      }, 30_000);
    }
    state = 'RUNNING';
  } catch (error) {
    await close();
    throw error;
  }
}
