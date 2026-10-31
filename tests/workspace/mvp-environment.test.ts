import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  deploymentFingerprint,
  initializeConfig,
  readConfig,
  readOrCreateSecrets,
  validateConfig,
  writePrivateJson,
} from '../../tools/mvp-environment/config.mjs';
import { assertOwned, assertPortAvailable } from '../../tools/mvp-environment/infrastructure.mjs';
import { applicationEnvironments } from '../../tools/mvp-environment/deployment.mjs';
import { loadBffTrustConfigFromEnv } from '../../apps/workspace-bff/src/trust-config.js';

const execFileAsync = promisify(execFile);
const temporary: string[] = [];

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'zhiju-mvp-config-')));
  temporary.push(root);
  await execFileAsync('git', ['init', '--quiet', root]);
  await writeFile(join(root, '.gitignore'), '.local/mvp/\nconfig/mvp.local.json\n');
  const file = join(root, 'config/mvp.local.json');
  const config = await initializeConfig(root, file);
  return { root, file, config };
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('isolated persistent MVP configuration', () => {
  it('preserves instance identity and private keys on repeat initialization', async () => {
    const { root, file, config } = await fixture();
    const secrets = await readOrCreateSecrets(config);
    expect(await initializeConfig(root, file)).toEqual(config);
    expect(await readOrCreateSecrets(config)).toEqual(secrets);
    expect((await stat(join(config.dataDir, 'secrets.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(config.dataDir)).mode & 0o777).toBe(0o700);
    expect(await readFile(file, 'utf8')).not.toContain(secrets.operatorPassword);
    const environments = applicationEnvironments(config, secrets, {
      storeRoot: join(config.dataDir, 'store'),
      storeId: secrets.storeId,
      storeIdentity: '00'.repeat(32),
    });
    expect(loadBffTrustConfigFromEnv(environments.bff).status).toBe('CONFIGURED');
  });

  it('rejects an incompatible service identity without silently rotating persisted secrets', async () => {
    const { config } = await fixture();
    const secrets = await readOrCreateSecrets(config);
    const filename = join(config.dataDir, 'secrets.json');
    await writePrivateJson(filename, {
      ...secrets,
      boardServiceId: 'e5f74152-d39b-4bb9-bbeb-2c2e3b55957c',
    });
    const before = await readFile(filename);
    await expect(readOrCreateSecrets(config)).rejects.toThrow('MVP_SECRETS_INVALID');
    expect(await readFile(filename)).toEqual(before);
  });

  it('rejects a foreign instance instead of rotating or adopting its secrets', async () => {
    const { file, config } = await fixture();
    const secrets = await readOrCreateSecrets(config);
    const before = await readFile(join(config.dataDir, 'secrets.json'));
    await writePrivateJson(file, { ...config, instanceId: '0000000000000000' });
    await expect(readOrCreateSecrets(await readConfig(file))).rejects.toThrow(
      'MVP_DATA_OWNER_MISMATCH',
    );
    expect(await readFile(join(config.dataDir, 'secrets.json'))).toEqual(before);
    expect(secrets.instanceId).toBe(config.instanceId);
  });

  it('rejects old application ports, duplicate ports and undeclared mode fields', async () => {
    const { config } = await fixture();
    for (const core of [3100, 3101, 3200, 3201, 3202, config.ports.bff])
      expect(() => validateConfig({ ...config, ports: { ...config.ports, core } })).toThrow(
        'MVP_PORTS_INVALID',
      );
    expect(() => validateConfig({ ...config, runner: {} })).toThrow('MVP_CONFIG_INVALID');
    expect(() => validateConfig({ ...config, fixture: true })).toThrow('MVP_CONFIG_INVALID');
  });

  it('refuses visible, tracked and symlink-aliased data before writing secrets', async () => {
    const { root, config } = await fixture();
    const visible = join(root, 'visible');
    await mkdir(visible);
    const alias = join(root, '.local/mvp');
    await mkdir(join(root, '.local'), { recursive: true });
    await symlink(visible, alias);
    await expect(readOrCreateSecrets(config)).rejects.toThrow('MVP_DATA_DIRECTORY_NOT_PRIVATE');
    await expect(stat(join(visible, 'secrets.json'))).rejects.toHaveProperty('code', 'ENOENT');
    await rm(alias);
    await mkdir(config.dataDir);
    await writeFile(join(config.dataDir, 'tracked.json'), '{}');
    await execFileAsync('git', ['-C', root, 'add', '-f', '.local/mvp/tracked.json']);
    await expect(readOrCreateSecrets(config)).rejects.toThrow('MVP_DATA_DIRECTORY_NOT_PRIVATE');
    await expect(stat(join(config.dataDir, 'secrets.json'))).rejects.toHaveProperty(
      'code',
      'ENOENT',
    );
  });

  it('does not claim an occupied port or a foreign Docker resource', async () => {
    const { config } = await fixture();
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('test listener missing');
      await expect(assertPortAvailable(address.port)).rejects.toThrow('MVP_PORT_IN_USE');
      expect(server.listening).toBe(true);
      const labels = {
        'io.zhiju.mvp-environment': config.instanceId,
        'io.zhiju.mvp-environment-config': deploymentFingerprint(config),
      };
      for (const kind of ['container', 'volume', 'network']) {
        const owned = kind === 'container' ? { Config: { Labels: labels } } : { Labels: labels };
        expect(assertOwned(config, owned, kind)).toBe(owned);
        expect(() => assertOwned(config, {}, kind)).toThrow('MVP_RESOURCE_OWNER_MISMATCH');
        expect(() =>
          assertOwned({ ...config, ports: { ...config.ports, core: 3399 } }, owned, kind),
        ).toThrow('MVP_RESOURCE_OWNER_MISMATCH');
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });
});
