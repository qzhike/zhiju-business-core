import { execFile } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  lstat,
  link,
  open,
  mkdir,
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
  web: 3200,
  bff: 3201,
  core: 3202,
  identity: 3280,
  database: 55432,
  control: 3290,
});
export const CONFIG_FILENAME = 'config/workspace-e2e.local.json';
const exactKeys = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('ENV_B_CONFIG_INVALID');
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(','))
    throw new Error('ENV_B_CONFIG_INVALID');
};
export const within = (child, parent) => {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
};

/** Only operator-owned local configuration can select files or ports. */
export function validateConfig(value) {
  exactKeys(value, ['version', 'instanceId', 'dataDir', 'ports', 'runner']);
  if (
    value.version !== 1 ||
    typeof value.instanceId !== 'string' ||
    !/^[a-f0-9]{16}$/.test(value.instanceId)
  )
    throw new Error('ENV_B_CONFIG_INVALID');
  exactKeys(value.ports, Object.keys(DEFAULT_PORTS));
  const ports = Object.values(value.ports);
  if (
    ports.some(
      (port) =>
        !Number.isInteger(port) || port < 1024 || port > 65535 || [3100, 3101].includes(port),
    ) ||
    new Set(ports).size !== ports.length
  ) {
    throw new Error('ENV_B_PORTS_INVALID');
  }
  exactKeys(value.runner, ['projectRoot', 'profileFile']);
  for (const path of [value.dataDir, value.runner.projectRoot]) {
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || path.includes('\n'))
      throw new Error('ENV_B_PATH_INVALID');
  }
  if (
    value.runner.profileFile !== null &&
    (typeof value.runner.profileFile !== 'string' ||
      !isAbsolute(value.runner.profileFile) ||
      /[\0\r\n]/.test(value.runner.profileFile))
  )
    throw new Error('ENV_B_RUNNER_PROFILE_INVALID');
  if (
    within(resolve(value.dataDir), resolve(value.runner.projectRoot)) ||
    within(resolve(value.runner.projectRoot), resolve(value.dataDir))
  )
    throw new Error('ENV_B_PATHS_OVERLAP');
  return value;
}

export async function readConfig(filename, { checkRunner = true } = {}) {
  const config = validateConfig(JSON.parse(await readFile(filename, 'utf8')));
  // Status/stop remain available if the separately configured Runner was moved.
  if (!checkRunner) return config;
  const runner = await realpath(config.runner.projectRoot);
  const rule = join(runner, 'AGENTS.md');
  if (!(await lstat(rule)).isFile()) throw new Error('ENV_B_RUNNER_RULES_MISSING');
  await access(rule, constants.R_OK);
  return { ...config, runner: { ...config.runner, projectRoot: runner } };
}

/** Exclusive creation prevents replacing keys or identities during a retry. */
export async function writePrivateJson(filename, value, exclusive = false) {
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  const target = `${filename}.${randomUUID()}.tmp`;
  try {
    const file = await open(target, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify(value, null, 2) + '\n');
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

export async function initializeConfig(root, filename, runnerProjectRoot) {
  try {
    await access(filename);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!runnerProjectRoot) throw new Error('ENV_B_RUNNER_PROJECT_REQUIRED', { cause: error });
    const config = validateConfig({
      version: 1,
      instanceId: randomBytes(8).toString('hex'),
      dataDir: join(root, '.local/workspace-env-b'),
      ports: { ...DEFAULT_PORTS },
      runner: { projectRoot: await realpath(runnerProjectRoot), profileFile: null },
    });
    if (!(await lstat(join(config.runner.projectRoot, 'AGENTS.md'))).isFile())
      throw new Error('ENV_B_RUNNER_RULES_MISSING', { cause: error });
    await writePrivateJson(filename, config, true);
  }
  return readConfig(filename);
}

async function resolveDirectory(path) {
  try {
    const actual = await realpath(path);
    if (!(await stat(actual)).isDirectory()) throw new Error('ENV_B_DATA_DIRECTORY_INVALID');
    return { actual, existing: actual };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    const resolved = await resolveDirectory(parent);
    return { ...resolved, actual: join(resolved.actual, basename(path)) };
  }
}

/** Validate the destination before creating credentials, including custom/symlink paths. */
export async function assertPrivateDataDirectory(config) {
  const { actual, existing } = await resolveDirectory(resolve(config.dataDir));
  const runner = await realpath(config.runner.projectRoot);
  if (within(actual, runner) || within(runner, actual)) throw new Error('ENV_B_PATHS_OVERLAP');
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    LC_ALL: 'C',
  };
  const git = (args) => execFileAsync('git', ['-C', existing, ...args], { env });
  let repository;
  try {
    repository = (await git(['rev-parse', '--show-toplevel'])).stdout.trim();
  } catch (error) {
    if (error.code === 128 && /not a git repository/i.test(error.stderr)) return;
    throw new Error('ENV_B_DATA_DIRECTORY_CHECK_FAILED', { cause: error });
  }
  const path = relative(repository, actual);
  if (!path || !within(actual, repository)) throw new Error('ENV_B_DATA_DIRECTORY_NOT_PRIVATE');
  try {
    // Ignoring the whole directory prevents individual secret files from becoming candidates.
    await git(['check-ignore', '--quiet', '--no-index', `${actual}${sep}`]);
    if ((await git(['ls-files', '--cached', '-z', '--', actual])).stdout.length > 0)
      throw new Error('ENV_B_DATA_DIRECTORY_NOT_PRIVATE');
  } catch (error) {
    throw new Error('ENV_B_DATA_DIRECTORY_NOT_PRIVATE', { cause: error });
  }
}

export async function readOrCreateSecrets(config) {
  await assertPrivateDataDirectory(config);
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await chmod(config.dataDir, 0o700);
  const filename = join(config.dataDir, 'secrets.json');
  try {
    const secrets = JSON.parse(await readFile(filename, 'utf8'));
    validateSecrets(config, secrets);
    let upgraded = false;
    for (const key of ['preparationTicketKey', 'operatorDatabasePassword']) {
      if (secrets[key] === undefined) {
        secrets[key] = randomBytes(32).toString('hex');
        upgraded = true;
      }
    }
    if (upgraded) await writePrivateJson(filename, secrets);
    return secrets;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const token = () => randomBytes(32).toString('hex');
  const secrets = {
    instanceId: config.instanceId,
    createdAt: new Date().toISOString(),
    postgresPassword: token(),
    identityDatabasePassword: token(),
    coreDatabasePassword: token(),
    identityAdminPassword: token(),
    clientSecret: token(),
    username: 'consultant',
    password: token(),
    subjectId: randomUUID(),
    lookupKey: token(),
    fieldKey: token(),
    cursorKey: token(),
    controlToken: token(),
    preparationTicketKey: token(),
    operatorDatabasePassword: token(),
  };
  await writePrivateJson(filename, secrets, true);
  return secrets;
}

export function validateSecrets(config, secrets) {
  if (secrets.instanceId !== config.instanceId) throw new Error('ENV_B_DATA_OWNER_MISMATCH');
  for (const key of [
    'postgresPassword',
    'identityDatabasePassword',
    'coreDatabasePassword',
    'identityAdminPassword',
    'clientSecret',
    'password',
    'lookupKey',
    'fieldKey',
    'cursorKey',
    'controlToken',
  ]) {
    if (!/^[a-f0-9]{64}$/.test(secrets[key])) throw new Error('ENV_B_SECRETS_INVALID');
  }
  for (const key of ['preparationTicketKey', 'operatorDatabasePassword']) {
    if (secrets[key] !== undefined && !/^[a-f0-9]{64}$/.test(secrets[key]))
      throw new Error('ENV_B_SECRETS_INVALID');
  }
  if (
    secrets.username !== 'consultant' ||
    !/^[a-f0-9-]{36}$/.test(secrets.subjectId) ||
    !Number.isFinite(Date.parse(secrets.createdAt))
  )
    throw new Error('ENV_B_SECRETS_INVALID');
  return secrets;
}

export async function readSecrets(config) {
  return validateSecrets(
    config,
    JSON.parse(await readFile(join(config.dataDir, 'secrets.json'), 'utf8')),
  );
}

export function publicStatus(config, services = {}) {
  return {
    environment: 'B',
    instanceId: config.instanceId,
    configurationHash: deploymentFingerprint(config),
    url: `http://127.0.0.1:${config.ports.web}/workbench`,
    services,
    runner: {
      projectRoot: config.runner.projectRoot,
      profileFile: config.runner.profileFile,
      state: 'NOT_CONNECTED',
    },
    data: 'PERSISTENT',
  };
}

export function deploymentFingerprint(config) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        dataDir: config.dataDir,
        ports: Object.fromEntries(
          Object.keys(DEFAULT_PORTS).map((key) => [key, config.ports[key]]),
        ),
      }),
    )
    .digest('hex');
}
