import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  link,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_PORTS = Object.freeze({
  web: 3300,
  bff: 3301,
  core: 3302,
  identity: 3380,
  database: 55433,
});
export const CONFIG_FILENAME = 'config/mvp.local.json';

function invalid() {
  throw new Error('MVP_CONFIG_INVALID');
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) invalid();
}

export function within(child, parent) {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export function validateConfig(value) {
  exactKeys(value, ['version', 'instanceId', 'dataDir', 'ports', 'operatorDisplayName']);
  if (
    value.version !== 1 ||
    typeof value.instanceId !== 'string' ||
    !/^[a-f0-9]{16}$/u.test(value.instanceId)
  )
    invalid();
  exactKeys(value.ports, Object.keys(DEFAULT_PORTS));
  const ports = Object.values(value.ports);
  if (
    ports.some(
      (port) =>
        !Number.isInteger(port) ||
        port < 1024 ||
        port > 65535 ||
        [3100, 3101, 3200, 3201, 3202].includes(port),
    ) ||
    new Set(ports).size !== ports.length
  )
    throw new Error('MVP_PORTS_INVALID');
  if (
    typeof value.dataDir !== 'string' ||
    !isAbsolute(value.dataDir) ||
    value.dataDir.includes('\0') ||
    value.dataDir.includes('\n')
  )
    throw new Error('MVP_PATH_INVALID');
  if (
    typeof value.operatorDisplayName !== 'string' ||
    value.operatorDisplayName.length < 1 ||
    value.operatorDisplayName.length > 512 ||
    // eslint-disable-next-line no-control-regex -- operator labels must reject control characters.
    /[\x00-\x1f\x7f]/u.test(value.operatorDisplayName)
  )
    invalid();
  return value;
}

export async function writePrivateJson(filename, value, exclusive = false) {
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  const target = `${filename}.${randomUUID()}.tmp`;
  try {
    const file = await open(target, 'wx', 0o600);
    try {
      await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    if (exclusive) await link(target, filename);
    else await rename(target, filename);
  } finally {
    await rm(target, { force: true });
  }
  const directory = await open(dirname(filename), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function resolveDirectory(path) {
  try {
    const actual = await realpath(path);
    if (!(await stat(actual)).isDirectory()) throw new Error('MVP_DATA_DIRECTORY_INVALID');
    return { actual, existing: actual };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    const resolved = await resolveDirectory(parent);
    return { ...resolved, actual: join(resolved.actual, basename(path)) };
  }
}

/** Refuse a data directory that git could publish or that is a symlink walk. */
export async function assertPrivateDataDirectory(config) {
  const { actual, existing } = await resolveDirectory(resolve(config.dataDir));
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    LC_ALL: 'C',
  };
  const git = (args) => execFileAsync('git', ['-C', existing, ...args], { env });
  const repository = (await git(['rev-parse', '--show-toplevel'])).stdout.trim();
  if (!repository || !within(actual, repository) || relative(repository, actual) === '')
    throw new Error('MVP_DATA_DIRECTORY_NOT_PRIVATE');
  await git(['check-ignore', '--quiet', '--no-index', `${actual}${sep}`]).catch(() => {
    throw new Error('MVP_DATA_DIRECTORY_NOT_PRIVATE');
  });
  if ((await git(['ls-files', '--cached', '-z', '--', actual])).stdout.length > 0)
    throw new Error('MVP_DATA_DIRECTORY_NOT_PRIVATE');
}

export async function initializeConfig(root, filename) {
  try {
    await access(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const config = validateConfig({
      version: 1,
      instanceId: randomBytes(8).toString('hex'),
      dataDir: join(root, '.local/mvp'),
      ports: { ...DEFAULT_PORTS },
      operatorDisplayName: 'MVP 操作者',
    });
    await writePrivateJson(filename, config, true);
  }
  const config = validateConfig(JSON.parse(await readFile(filename, 'utf8')));
  await assertPrivateDataDirectory(config);
  return config;
}

export async function readConfig(filename) {
  const config = validateConfig(JSON.parse(await readFile(filename, 'utf8')));
  await assertPrivateDataDirectory(config);
  return config;
}

const SECRET_KEYS = [
  'postgresPassword',
  'runtimePassword',
  'keycloakDbPassword',
  'keycloakAdminPassword',
  'clientSecret',
  'operatorPassword',
  'cursorKey',
];
export async function readOrCreateSecrets(config) {
  await assertPrivateDataDirectory(config);
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await chmod(config.dataDir, 0o700);
  const filename = join(config.dataDir, 'secrets.json');
  try {
    return validateSecrets(config, JSON.parse(await readFile(filename, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const token = () => randomBytes(32).toString('hex');
  const secrets = {
    instanceId: config.instanceId,
    createdAt: new Date().toISOString(),
    postgresPassword: token(),
    runtimePassword: token(),
    keycloakDbPassword: token(),
    keycloakAdminPassword: token(),
    clientSecret: token(),
    operatorPassword: token(),
    cursorKey: token(),
    username: 'mvp-operator',
    subjectId: randomUUID(),
    boardServiceId: randomUUID(),
    storeId: randomUUID(),
  };
  await writePrivateJson(filename, secrets, true);
  return secrets;
}

export function validateSecrets(config, secrets) {
  if (secrets.instanceId !== config.instanceId) throw new Error('MVP_DATA_OWNER_MISMATCH');
  for (const key of SECRET_KEYS)
    if (!/^[a-f0-9]{64}$/u.test(secrets[key] ?? '')) throw new Error('MVP_SECRETS_INVALID');
  if (
    secrets.username !== 'mvp-operator' ||
    !/^[0-9a-f-]{36}$/u.test(secrets.subjectId ?? '') ||
    !/^[0-9a-f-]{36}$/u.test(secrets.storeId ?? '') ||
    !Number.isFinite(Date.parse(secrets.createdAt))
  )
    throw new Error('MVP_SECRETS_INVALID');
  return secrets;
}

export async function readSecrets(config) {
  return validateSecrets(
    config,
    JSON.parse(await readFile(join(config.dataDir, 'secrets.json'), 'utf8')),
  );
}

export function deploymentFingerprint(config) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        dataDir: config.dataDir,
        ports: Object.fromEntries(
          Object.keys(DEFAULT_PORTS).map((key) => [key, config.ports[key]]),
        ),
        operatorDisplayName: config.operatorDisplayName,
      }),
    )
    .digest('hex');
}

export function publicStatus(config) {
  return {
    environment: 'MVP',
    instanceId: config.instanceId,
    configurationHash: deploymentFingerprint(config),
    url: `http://127.0.0.1:${config.ports.web}/custody`,
    data: 'PERSISTENT',
    analysis: 'UNAVAILABLE',
  };
}

export async function readInstallation(config) {
  const value = JSON.parse(await readFile(join(config.dataDir, 'installation.json'), 'utf8'));
  if (
    value.instanceId !== config.instanceId ||
    !/^[0-9a-f-]{36}$/u.test(value.storeId ?? '') ||
    !/^[0-9a-f]{64}$/u.test(value.storeIdentity ?? '') ||
    !/^[0-9a-f-]{36}$/u.test(value.ownerId ?? '')
  )
    throw new Error('MVP_DATA_OWNER_MISMATCH');
  return value;
}

export async function recordInitialization(config, installation) {
  const installationHash = createHash('sha256').update(JSON.stringify(installation)).digest('hex');
  await writePrivateJson(join(config.dataDir, 'initialized.json'), {
    version: 1,
    instanceId: config.instanceId,
    configurationHash: deploymentFingerprint(config),
    installationHash,
  });
}

export async function initializationComplete(config) {
  try {
    const marker = JSON.parse(await readFile(join(config.dataDir, 'initialized.json'), 'utf8'));
    const installation = await readInstallation(config);
    const installationHash = createHash('sha256')
      .update(JSON.stringify(installation))
      .digest('hex');
    return (
      marker.version === 1 &&
      marker.instanceId === config.instanceId &&
      marker.configurationHash === deploymentFingerprint(config) &&
      marker.installationHash === installationHash
    );
  } catch {
    return false;
  }
}
