import { spawn } from 'node:child_process';
import { open, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';

import { serviceEnvironments } from './infrastructure.mjs';

const STATE_FILE = 'supervisor.json';

async function statePath(config) {
  return join(config.dataDir, STATE_FILE);
}

export async function readSupervisor(config) {
  try {
    const state = JSON.parse(await readFile(await statePath(config), 'utf8'));
    if (state.instanceId !== config.instanceId || !Number.isSafeInteger(state.pid)) return null;
    try {
      process.kill(state.pid, 0);
    } catch {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export async function runSupervisor(root, config, secrets, installation) {
  const log = await open(join(config.dataDir, 'supervisor.log'), 'a', 0o600);
  const environments = serviceEnvironments(config, secrets, installation);
  const children = [
    ['core', process.execPath, [join(root, 'apps/api/dist/mvp-main.js')], environments.core],
    ['bff', process.execPath, [join(root, 'apps/workspace-bff/dist/main.js')], environments.bff],
    ['web', process.execPath, [join(root, 'apps/workspace-web/tools/serve.mjs')], environments.web],
  ].map(([name, command, args, env]) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: ['ignore', log.fd, log.fd],
    });
    child.once('error', () => undefined);
    return { name, child };
  });
  await log.close();
  const state = {
    version: 1,
    instanceId: config.instanceId,
    pid: process.pid,
    state: 'RUNNING',
    startedAt: new Date().toISOString(),
    services: Object.fromEntries(children.map(({ name, child }) => [name, child.pid])),
  };
  const filename = await statePath(config);
  const handle = await open(filename, 'w', 0o600);
  await handle.writeFile(JSON.stringify(state, null, 2));
  await handle.sync();
  await handle.close();

  const shutdown = async () => {
    for (const { child } of children) if (child.exitCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => {
      for (const { child } of children) if (child.exitCode === null) child.kill('SIGKILL');
    }, 10_000);
    await Promise.all(
      children.map(
        ({ child }) =>
          new Promise((resolve) => {
            if (child.exitCode !== null) resolve(undefined);
            else child.once('exit', resolve);
          }),
      ),
    );
    clearTimeout(timer);
    await rm(filename, { force: true });
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  for (const { child } of children)
    child.once('exit', () => {
      void shutdown();
    });
  const { promise } = Promise.withResolvers();
  await promise;
}

export async function stopSupervisor(config) {
  const state = await readSupervisor(config);
  if (state === null) return false;
  process.kill(state.pid, 'SIGTERM');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      process.kill(state.pid, 0);
    } catch {
      return true;
    }
    const { promise, resolve } = Promise.withResolvers();
    setTimeout(resolve, 250);
    await promise;
  }
  throw new Error('MVP_SUPERVISOR_STOP_TIMEOUT');
}
