import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { initializeCustomerZipFileStore } from '@zhiju/integration-gateway';
import { initializePreparationObjectStore } from '../../tools/workspace-environment/object-store.mjs';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';

import { afterEach, describe, expect, it } from 'vitest';

import {
  initializeConfig,
  readConfig,
  readOrCreateSecrets,
  readSecrets,
  validateConfig,
  writePrivateJson,
  deploymentFingerprint,
} from '../../tools/workspace-environment/config.mjs';
import {
  assertOwned,
  assertPortAvailable,
} from '../../tools/workspace-environment/infrastructure.mjs';
import { coreListenPort } from '../../apps/api/src/listen-port.js';
import { supervisorRequest } from '../../tools/workspace-environment/processes.mjs';
import {
  initializationComplete,
  invalidateInitialization,
  recordInitialization,
} from '../../tools/workspace-environment/initialization.mjs';

const execFileAsync = promisify(execFile);
const temporary: string[] = [];
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhiju-env-b-')));
  temporary.push(root);
  const project = join(root, 'runner');
  await mkdir(project);
  await writeFile(join(project, 'AGENTS.md'), 'Local test rules');
  const file = join(root, 'config/local.json');
  return { root, project, file, config: await initializeConfig(root, file, project) };
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('persistent Environment B operator configuration', () => {
  it('reuses keys and identity instead of replacing them on repeat initialization', async () => {
    const { root, file, project, config } = await fixture();
    const first = await readOrCreateSecrets(config);
    expect(await initializeConfig(root, file, project)).toEqual(config);
    expect(await readOrCreateSecrets(config)).toEqual(first);
    expect(await readSecrets(config)).toEqual(first);
    expect((await stat(join(config.dataDir, 'secrets.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(config.dataDir)).mode & 0o777).toBe(0o700);
    expect((await readFile(file, 'utf8')).includes(first.password ?? 'missing')).toBe(false);
  });

  it('resumes a completed store marker after interruption before publishing its external binding', async () => {
    const { config } = await fixture();
    const storeRoot = join(config.dataDir, 'objects');
    const intent = {
      version: 1,
      instanceId: config.instanceId,
      root: storeRoot,
      storeId: randomUUID(),
    };
    await writePrivateJson(join(config.dataDir, 'object-store-initialization.json'), intent, true);
    const original = await initializeCustomerZipFileStore({
      mode: 'MACOS_MANUAL_TEST',
      root: storeRoot,
      storeId: intent.storeId,
    });
    const marker = await readFile(join(storeRoot, '.store.json'));
    expect(await initializePreparationObjectStore(config)).toEqual(original);
    expect(await initializePreparationObjectStore(config)).toEqual(original);
    expect(await readFile(join(storeRoot, '.store.json'))).toEqual(marker);
    expect(
      JSON.parse(await readFile(join(config.dataDir, 'object-store-binding.json'), 'utf8')),
    ).toEqual(original);
  });

  it('does not adopt an unbound foreign store or reconstruct a missing prior store', async () => {
    const { config } = await fixture();
    await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
    const storeRoot = join(config.dataDir, 'objects');
    const original = await initializeCustomerZipFileStore({
      mode: 'MACOS_MANUAL_TEST',
      root: storeRoot,
    });
    await expect(initializePreparationObjectStore(config)).rejects.toThrow(
      'ENV_B_FILE_STORE_UNBOUND',
    );
    const intent = {
      version: 1,
      instanceId: config.instanceId,
      root: storeRoot,
      storeId: randomUUID(),
    };
    await writePrivateJson(join(config.dataDir, 'object-store-initialization.json'), intent, true);
    await expect(initializePreparationObjectStore(config)).rejects.toThrow(
      'ENV_B_FILE_STORE_INITIALIZATION_INCOMPLETE',
    );
    expect(JSON.parse(await readFile(join(storeRoot, '.store.json'), 'utf8')).storeId).toBe(
      original.identity.storeId,
    );
    await rm(storeRoot, { recursive: true });
    await expect(initializePreparationObjectStore(config)).rejects.toThrow(
      'ENV_B_FILE_STORE_INITIALIZATION_INCOMPLETE',
    );
    await expect(stat(storeRoot)).rejects.toHaveProperty('code', 'ENOENT');
  });

  it('adds missing preparation keys without rotating the existing login or database secrets', async () => {
    const { config } = await fixture();
    const original = await readOrCreateSecrets(config);
    const legacy = { ...original };
    delete legacy.preparationTicketKey;
    delete legacy.operatorDatabasePassword;
    await writePrivateJson(join(config.dataDir, 'secrets.json'), legacy);
    expect(await readSecrets(config)).toEqual(legacy);
    const upgraded = await readOrCreateSecrets(config);
    expect(upgraded).toMatchObject(legacy);
    expect(upgraded.preparationTicketKey).toMatch(/^[a-f0-9]{64}$/);
    expect(upgraded.operatorDatabasePassword).toMatch(/^[a-f0-9]{64}$/);
    expect(await readOrCreateSecrets(config)).toEqual(upgraded);
    const invalid = { ...upgraded, preparationTicketKey: 'invalid' };
    await writePrivateJson(join(config.dataDir, 'secrets.json'), invalid);
    await expect(readOrCreateSecrets(config)).rejects.toThrow('ENV_B_SECRETS_INVALID');
    expect(JSON.parse(await readFile(join(config.dataDir, 'secrets.json'), 'utf8'))).toEqual(
      invalid,
    );
  });

  it('does not replace an existing config when its Runner directory goes missing', async () => {
    const { root, file, project, config } = await fixture();
    const original = await readFile(file, 'utf8');
    await rm(project, { recursive: true });
    await expect(initializeConfig(root, file, root)).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(await readConfig(file, { checkRunner: false })).toEqual(config);
  });

  it('rejects A ports, duplicate ports, unknown fields and overlapping input/data roots', async () => {
    const { config } = await fixture();
    expect(() => validateConfig({ ...config, ports: { ...config.ports, core: 3100 } })).toThrow(
      'ENV_B_PORTS_INVALID',
    );
    expect(() =>
      validateConfig({ ...config, ports: { ...config.ports, core: config.ports.bff } }),
    ).toThrow('ENV_B_PORTS_INVALID');
    expect(() => validateConfig({ ...config, command: 'arbitrary shell' })).toThrow(
      'ENV_B_CONFIG_INVALID',
    );
    expect(() => validateConfig({ ...config, instanceId: [config.instanceId] })).toThrow(
      'ENV_B_CONFIG_INVALID',
    );
    expect(() =>
      validateConfig({ ...config, dataDir: join(config.runner.projectRoot, 'work') }),
    ).toThrow('ENV_B_PATHS_OVERLAP');
  });

  it('rejects realpath overlap through a data-directory symlink before writing secrets', async () => {
    const { root, file, project, config } = await fixture();
    const alias = join(root, 'data-alias');
    await symlink(project, alias);
    await writePrivateJson(file, { ...config, dataDir: alias });
    await expect(readOrCreateSecrets(await readConfig(file))).rejects.toThrow(
      'ENV_B_PATHS_OVERLAP',
    );
    await expect(stat(join(project, 'secrets.json'))).rejects.toThrow();
  });

  it('rejects credentials from another environment rather than silently rotating them', async () => {
    const { config } = await fixture();
    const secrets = await readOrCreateSecrets(config);
    await writePrivateJson(join(config.dataDir, 'secrets.json'), {
      ...secrets,
      instanceId: '0000000000000000',
    });
    await expect(readOrCreateSecrets(config)).rejects.toThrow('ENV_B_DATA_OWNER_MISMATCH');
  });

  it('requires a whole-directory Git exclusion before writing to custom or aliased paths', async () => {
    const { root, config } = await fixture();
    await execFileAsync('git', ['init', '--quiet', root]);
    await writeFile(join(root, '.gitignore'), '.local/workspace-env-b/\n.local/custom-private/\n');
    await readOrCreateSecrets(config);
    const safe = { ...config, dataDir: join(root, '.local/custom-private') };
    await readOrCreateSecrets(safe);
    const unsafe = { ...config, dataDir: join(root, '.local/custom-visible') };
    await expect(readOrCreateSecrets(unsafe)).rejects.toThrow('ENV_B_DATA_DIRECTORY_NOT_PRIVATE');
    await expect(stat(unsafe.dataDir)).rejects.toThrow();
    const alias = join(root, 'alias');
    await symlink(join(root, '.local'), alias);
    await expect(
      readOrCreateSecrets({ ...config, dataDir: join(alias, 'custom-visible') }),
    ).rejects.toThrow('ENV_B_DATA_DIRECTORY_NOT_PRIVATE');
    const { stdout } = await execFileAsync('git', [
      '-C',
      root,
      'ls-files',
      '--others',
      '--exclude-standard',
      '--',
      '.local',
    ]);
    expect(stdout).toBe('');
  });

  it('rejects tracked data even when the containing directory is now ignored', async () => {
    const { root, config } = await fixture();
    await execFileAsync('git', ['init', '--quiet', root]);
    await mkdir(config.dataDir, { recursive: true });
    await writeFile(join(config.dataDir, 'previous-file.json'), '{}');
    await execFileAsync('git', ['-C', root, 'add', '.local/workspace-env-b/previous-file.json']);
    await writeFile(join(root, '.gitignore'), '.local/workspace-env-b/\n');
    await expect(readOrCreateSecrets(config)).rejects.toThrow('ENV_B_DATA_DIRECTORY_NOT_PRIVATE');
    await expect(stat(join(config.dataDir, 'secrets.json'))).rejects.toThrow();
  });

  it('reports incomplete initialization despite running containers and recovers only after success', async () => {
    const { root, file, config } = await fixture();
    const listener = createServer();
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('test listener failed');
    config.ports.control = address.port;
    await new Promise<void>((resolve) => {
      listener.close(() => {
        resolve();
      });
    });
    await writePrivateJson(file, config);
    await readOrCreateSecrets(config);
    const bin = join(root, 'bin');
    await mkdir(bin);
    await writeFile(
      join(bin, 'docker'),
      `#!${process.execPath}\nif (process.argv[2] !== 'container' || process.argv[3] !== 'inspect') process.exit(1);\nconsole.log(${JSON.stringify(
        JSON.stringify([
          {
            Config: {
              Labels: {
                'io.zhiju.environment-b': config.instanceId,
                'io.zhiju.environment-b-config': deploymentFingerprint(config),
              },
            },
            State: { Running: true },
          },
        ]),
      )});\n`,
      { mode: 0o700 },
    );
    const status = async () => {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          fileURLToPath(new URL('../../tools/workspace-environment/main.mjs', import.meta.url)),
          'status',
          '--config',
          file,
        ],
        {
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            DOCKER_HOST: 'unix:///unused-environment-b-test.sock',
          },
        },
      );
      return JSON.parse(stdout) as { state: string; initialization: string };
    };
    expect(await status()).toMatchObject({ state: 'PARTIAL', initialization: 'INCOMPLETE' });
    const identities = join(config.dataDir, 'identities.json');
    await writePrivateJson(identities, { instanceId: config.instanceId, revision: 1 });
    expect((await status()).state).toBe('PARTIAL');
    await expect(recordInitialization(config)).rejects.toThrow();
    for (const file of [
      'preparation-deployment.json',
      'preparation-installation.json',
      'object-store-binding.json',
    ]) {
      await writePrivateJson(join(config.dataDir, file), {
        instanceId: config.instanceId,
        fixture: true,
      });
    }
    await recordInitialization(config);
    expect(await status()).toMatchObject({ state: 'INITIALIZED', initialization: 'COMPLETE' });
    await writePrivateJson(join(config.dataDir, 'preparation-deployment.json'), {
      instanceId: config.instanceId,
      fixture: 'changed',
    });
    expect((await status()).state).toBe('PARTIAL');
    await recordInitialization(config);
    await invalidateInitialization(config);
    expect((await status()).state).toBe('PARTIAL');
    await recordInitialization(config);
    expect((await status()).state).toBe('INITIALIZED');
    await writePrivateJson(identities, { instanceId: config.instanceId, revision: 2 });
    expect((await status()).state).toBe('PARTIAL');
    await recordInitialization(config);
    await expect(
      initializationComplete({ ...config, instanceId: '0000000000000000' }),
    ).resolves.toBe(false);
    await expect(
      initializationComplete({ ...config, ports: { ...config.ports, web: 3210 } }),
    ).resolves.toBe(false);
    await rm(identities);
    expect((await status()).state).toBe('PARTIAL');
  }, 20_000);

  it('does not claim an occupied port or an unowned Docker resource', async () => {
    const { config } = await fixture();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test listener failed');
      await expect(assertPortAvailable(address.port)).rejects.toThrow('ENV_B_PORT_IN_USE');
      expect(server.listening).toBe(true);
      expect(() => assertOwned(config, { Config: { Labels: {} } }, 'container')).toThrow(
        'ENV_B_RESOURCE_OWNER_MISMATCH',
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    }
  });

  it('keeps the original Core port default and rejects malformed overrides', () => {
    expect(coreListenPort({})).toBe(3000);
    expect(coreListenPort({ PORT: '3202' })).toBe(3202);
    for (const value of ['', '0', '-1', '3202.5', '65536', '3202suffix'])
      expect(() => coreListenPort({ PORT: value })).toThrow('WORKSPACE_LISTEN_PORT_INVALID');
  });

  it('binds management responses to the active instance configuration', async () => {
    const { config } = await fixture();
    const secrets = { controlToken: 'local-test-token' };
    const server = createHttpServer((request, response) => {
      expect(request.headers.authorization).toBe('Bearer local-test-token');
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          instanceId: config.instanceId,
          configurationHash: deploymentFingerprint(config),
          state: 'RUNNING',
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test listener failed');
      config.ports.control = address.port;
      await expect(supervisorRequest(config, secrets)).resolves.toMatchObject({ state: 'RUNNING' });
      await expect(
        supervisorRequest({ ...config, dataDir: config.dataDir + '-moved' }, secrets),
      ).rejects.toThrow('ENV_B_CONFIGURATION_CHANGED');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    }
  });

  it('keeps the deployment binding stable when only key order or Runner directory changes', async () => {
    const { config } = await fixture();
    const reordered = {
      ...config,
      ports: Object.fromEntries(Object.entries(config.ports).reverse()),
    };
    expect(deploymentFingerprint(validateConfig(reordered))).toBe(deploymentFingerprint(config));
    expect(
      deploymentFingerprint({
        ...config,
        runner: { ...config.runner, projectRoot: '/another/runner' },
      }),
    ).toBe(deploymentFingerprint(config));
  });
});
