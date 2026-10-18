import { spawn } from 'node:child_process';
import { access, open, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  CONFIG_FILENAME,
  assertPrivateDataDirectory,
  initializeConfig,
  publicStatus,
  readConfig,
  readOrCreateSecrets,
  readSecrets,
} from './config.mjs';
import { baseEnvironment } from './deployment.mjs';
import {
  assertPortAvailable,
  infrastructureStatus,
  startInfrastructure,
  stopInfrastructure,
  waitUntil,
} from './infrastructure.mjs';
import { runSupervisor, supervisorRequest } from './processes.mjs';
import {
  initializationComplete,
  invalidateInitialization,
  recordInitialization,
} from './initialization.mjs';

const root = resolve(import.meta.dirname, '../..');

function argumentsFor(argv) {
  const [action, ...args] = argv;
  if (!['init', 'start', 'status', 'stop', '_supervise'].includes(action))
    throw new Error('ENV_B_USAGE: init|start|status|stop [--config PATH] [--runner-project PATH]');
  let filename = join(root, CONFIG_FILENAME),
    runnerProject;
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index],
      value = args[index + 1];
    if (
      !value ||
      !['--config', '--runner-project'].includes(key) ||
      (key === '--runner-project' && action !== 'init')
    )
      throw new Error('ENV_B_ARGUMENT_INVALID');
    if (key === '--config') filename = resolve(value);
    else runnerProject = resolve(value);
  }
  return { action, filename, runnerProject };
}

async function assertBuild() {
  for (const path of [
    'apps/api/dist/main.js',
    'apps/workspace-bff/dist/main.js',
    'apps/workspace-web/dist/index.html',
  ]) {
    try {
      await access(join(root, path));
    } catch {
      throw new Error('ENV_B_BUILD_REQUIRED');
    }
  }
  try {
    await access(join(root, 'apps/workspace-web/dist/fixture-build.json'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('ENV_B_PRODUCTION_BUILD_REQUIRED');
}

async function withLock(config, task) {
  const path = join(config.dataDir, 'operation.lock');
  let lock;
  try {
    lock = await open(path, 'wx', 0o600);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Fail closed even after a crash: reclaiming a stale lock races another starter.
    throw new Error('ENV_B_OPERATION_LOCKED', { cause: error });
  }
  try {
    await lock.writeFile(JSON.stringify({ instanceId: config.instanceId, pid: process.pid }));
    return await task();
  } finally {
    await lock.close();
    await rm(path, { force: true });
  }
}

async function initialize(config, secrets) {
  await assertBuild();
  Object.assign(secrets, await readOrCreateSecrets(config));
  await invalidateInitialization(config);
  await startInfrastructure(config, secrets);
  // Load built owner packages only after the build preflight succeeds.
  const { bootstrapIdentities } = await import('./bootstrap.mjs');
  const identities = await bootstrapIdentities(config, secrets);
  const { initializePreparation } = await import('./preparation.mjs');
  await initializePreparation(config, secrets, identities);
  await writeFile(
    join(config.dataDir, 'login.txt'),
    `URL: http://127.0.0.1:${config.ports.web}/workbench\nUsername: ${secrets.username}\nPassword: ${secrets.password}\n`,
    { mode: 0o600 },
  );
  await recordInitialization(config);
  return identities;
}

async function main() {
  const { action, filename, runnerProject } = argumentsFor(process.argv.slice(2));
  const config =
    action === 'init'
      ? await initializeConfig(root, filename, runnerProject)
      : await readConfig(filename, { checkRunner: action === 'start' });
  const secrets = action === 'init' ? await readOrCreateSecrets(config) : await readSecrets(config);
  if (action === 'start') await assertPrivateDataDirectory(config);
  if (action === '_supervise') {
    const { readIdentities } = await import('./bootstrap.mjs');
    await runSupervisor(root, config, secrets, await readIdentities(config));
    return;
  }
  if (action === 'status') {
    const service = await supervisorRequest(config, secrets);
    const infrastructure = await infrastructureStatus(config);
    const allRunning = Object.values(infrastructure).every((value) => value === 'RUNNING');
    const anyRunning = Object.values(infrastructure).some((value) => value === 'RUNNING');
    const initialized = await initializationComplete(config);
    console.log(
      JSON.stringify(
        {
          ...(service ?? publicStatus(config)),
          state:
            service?.state === 'RUNNING' && !allRunning
              ? 'DEGRADED'
              : (service?.state ??
                (allRunning && initialized ? 'INITIALIZED' : anyRunning ? 'PARTIAL' : 'STOPPED')),
          initialization: initialized ? 'COMPLETE' : 'INCOMPLETE',
          infrastructure,
          configFile: filename,
        },
        null,
        2,
      ),
    );
    return;
  }
  await withLock(config, async () => {
    const existing = await supervisorRequest(config, secrets);
    if (action === 'stop') {
      if (existing) {
        await supervisorRequest(config, secrets, 'stop');
        await waitUntil(async () => (await supervisorRequest(config, secrets)) === null, 30_000);
      }
      await stopInfrastructure(config);
      console.log(
        JSON.stringify({ ...publicStatus(config), state: 'STOPPED', data: 'PRESERVED' }, null, 2),
      );
      return;
    }
    if (existing) {
      if (existing.state !== 'RUNNING') throw new Error('ENV_B_OPERATION_BUSY');
      const infrastructure = await infrastructureStatus(config);
      if (Object.values(infrastructure).some((value) => value !== 'RUNNING'))
        throw new Error('ENV_B_DEPENDENCY_STOPPED');
      console.log(JSON.stringify(existing, null, 2));
      return;
    }
    // Preflight all listeners before starting any service. Occupied ports are never reclaimed.
    for (const key of ['web', 'bff', 'core', 'control'])
      await assertPortAvailable(config.ports[key]);
    await initialize(config, secrets);
    if (action === 'init') {
      console.log(
        JSON.stringify(
          {
            ...publicStatus(config),
            state: 'INITIALIZED',
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
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    await log.close();
    await waitUntil(async () => {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error('ENV_B_SUPERVISOR_START_FAILED');
      return (await supervisorRequest(config, secrets))?.state === 'RUNNING';
    }, 100_000);
    console.log(JSON.stringify(await supervisorRequest(config, secrets), null, 2));
  });
}

try {
  await main();
} catch (error) {
  // CLI/database/identity errors can contain credentials; only allow fixed local codes.
  console.error(
    /^ENV_B_[A-Z_]+(?::[0-9]+)?$/.test(error.message) ? error.message : 'ENV_B_OPERATION_FAILED',
  );
  process.exitCode = 1;
}
