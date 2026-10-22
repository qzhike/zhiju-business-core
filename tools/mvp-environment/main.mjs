import { spawn } from 'node:child_process';
import { access, open, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  CONFIG_FILENAME,
  initializeConfig,
  initializationComplete,
  publicStatus,
  readConfig,
  readInstallation,
  readOrCreateSecrets,
  readSecrets,
  recordInitialization,
} from './config.mjs';
import {
  assertPortAvailable,
  infrastructureStatus,
  startInfrastructure,
  stopInfrastructure,
  waitUntil,
} from './infrastructure.mjs';
import { readSupervisor, runSupervisor, stopSupervisor } from './processes.mjs';
import { baseEnvironment } from './deployment.mjs';

const root = resolve(import.meta.dirname, '../..');

function argumentsFor(argv) {
  const [action, ...args] = argv;
  if (!['init', 'start', 'status', 'stop', '_supervise'].includes(action))
    throw new Error('MVP_USAGE: init|start|status|stop [--config PATH]');
  let filename = join(root, CONFIG_FILENAME);
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] !== '--config' || !args[index + 1]) throw new Error('MVP_ARGUMENT_INVALID');
    filename = resolve(args[index + 1]);
  }
  return { action, filename };
}

async function assertBuild() {
  for (const path of [
    'apps/api/dist/mvp-main.js',
    'apps/workspace-bff/dist/main.js',
    'apps/workspace-web/dist/index.html',
    'modules/document-delivery/dist/index.js',
  ]) {
    try {
      await access(join(root, path));
    } catch {
      throw new Error('MVP_BUILD_REQUIRED');
    }
  }
  try {
    await access(join(root, 'apps/workspace-web/dist/fixture-build.json'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('MVP_PRODUCTION_BUILD_REQUIRED');
}

async function withLock(config, task) {
  const path = join(config.dataDir, 'operation.lock');
  let lock;
  try {
    lock = await open(path, 'wx', 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('MVP_OPERATION_LOCKED', { cause: error });
  }
  try {
    await lock.writeFile(JSON.stringify({ instanceId: config.instanceId, pid: process.pid }));
    return await task();
  } finally {
    await lock.close();
    await rm(path, { force: true });
  }
}

async function main() {
  const { action, filename } = argumentsFor(process.argv.slice(2));
  let config;
  if (action === 'init') {
    config = await initializeConfig(root, filename);
  } else {
    try {
      config = await readConfig(filename);
    } catch (error) {
      if (action !== 'status') throw error;
      console.log(
        JSON.stringify(
          { environment: 'MVP', state: 'NOT_INITIALIZED', configFile: filename },
          null,
          2,
        ),
      );
      return;
    }
  }
  if (action === 'status') {
    const service = await readSupervisor(config);
    const infrastructure = await infrastructureStatus(config);
    const initialized = await initializationComplete(config);
    const allRunning = Object.values(infrastructure).every((value) => value === 'RUNNING');
    console.log(
      JSON.stringify(
        {
          ...publicStatus(config),
          state:
            service?.state === 'RUNNING' && !allRunning
              ? 'DEGRADED'
              : (service?.state ?? (allRunning && initialized ? 'INITIALIZED' : 'STOPPED')),
          initialization: initialized ? 'COMPLETE' : 'INCOMPLETE',
          infrastructure,
          services: service?.services ?? {},
          configFile: filename,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (action === '_supervise') {
    const secrets = await readSecrets(config);
    await runSupervisor(root, config, secrets, await readInstallation(config));
    return;
  }
  const secrets = action === 'init' ? await readOrCreateSecrets(config) : await readSecrets(config);
  await withLock(config, async () => {
    const existing = await readSupervisor(config);
    if (action === 'stop') {
      if (existing) {
        await stopSupervisor(config);
        await waitUntil(async () => (await readSupervisor(config)) === null, 30_000);
      }
      await stopInfrastructure(config);
      console.log(
        JSON.stringify({ ...publicStatus(config), state: 'STOPPED', data: 'PRESERVED' }, null, 2),
      );
      return;
    }
    await assertBuild();
    if (existing) {
      if (existing.state !== 'RUNNING') throw new Error('MVP_OPERATION_BUSY');
      const infrastructure = await infrastructureStatus(config);
      if (Object.values(infrastructure).some((value) => value !== 'RUNNING'))
        throw new Error('MVP_DEPENDENCY_STOPPED');
      console.log(JSON.stringify(existing, null, 2));
      return;
    }
    for (const key of ['web', 'bff', 'core']) await assertPortAvailable(config.ports[key]);
    const installation = await startInfrastructure(config, secrets);
    await writeFile(
      join(config.dataDir, 'login.txt'),
      `URL: http://127.0.0.1:${config.ports.web}/custody\nUsername: ${secrets.username}\nPassword: ${secrets.operatorPassword}\n`,
      { mode: 0o600 },
    );
    await recordInitialization(config, installation);
    if (action === 'init') {
      console.log(
        JSON.stringify(
          {
            ...publicStatus(config),
            state: 'INITIALIZED',
            instanceId: installation.instanceId,
            configFile: filename,
            credentialsFile: join(config.dataDir, 'login.txt'),
          },
          null,
          2,
        ),
      );
      return;
    }
    const log = await open(join(config.dataDir, 'supervisor.log'), 'a', 0o600);
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, 'main.mjs'), '_supervise', '--config', filename],
      { cwd: root, env: baseEnvironment(), detached: true, stdio: ['ignore', log.fd, log.fd] },
    );
    const spawned = Promise.withResolvers();
    child.once('spawn', () => spawned.resolve(undefined));
    child.once('error', (error) => spawned.reject(error));
    await spawned.promise;
    child.unref();
    await log.close();
    await waitUntil(async () => {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error('MVP_SUPERVISOR_START_FAILED');
      return (await readSupervisor(config))?.state === 'RUNNING';
    }, 100_000);
    console.log(JSON.stringify(await readSupervisor(config), null, 2));
  });
}

try {
  await main();
} catch (error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  console.error(/^MVP_[A-Z_]+(?::[0-9]+)?$/u.test(message) ? message : 'MVP_OPERATION_FAILED');
  process.exitCode = 1;
}
