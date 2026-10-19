import { writeFile, chmod } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import pg from 'pg';

import { docker, configureDockerHostFromCurrentContext } from '../persistence/docker.mjs';
import { postgresImageReference, CONTROLLED_KEYCLOAK_IMAGE } from '../persistence/baseline.mjs';
import { runFlyway } from '../persistence/flyway.mjs';
import { buildRealm, databaseUrl, REALM } from './deployment.mjs';
import { deploymentFingerprint as configHash } from './config.mjs';

export const OWNER_LABEL = 'io.zhiju.environment-b';
const CONFIG_LABEL = 'io.zhiju.environment-b-config';
export const resourceNames = (config) => {
  const prefix = `zhiju-b-${config.instanceId}`;
  return {
    database: `${prefix}-db`,
    identity: `${prefix}-identity`,
    volume: `${prefix}-data`,
    network: `${prefix}-network`,
  };
};

export function assertOwned(config, value, kind) {
  const labels = kind === 'container' ? value.Config?.Labels : value.Labels;
  if (labels?.[OWNER_LABEL] !== config.instanceId || labels?.[CONFIG_LABEL] !== configHash(config))
    throw new Error('ENV_B_RESOURCE_OWNER_MISMATCH');
  return value;
}

export async function inspectOwned(config, kind, name) {
  let json;
  try {
    json = await docker([kind, 'inspect', name]);
  } catch (error) {
    if (
      /No such (object|container|volume|network)|network .* not found/i.test(String(error.stderr))
    )
      return null;
    throw new Error('ENV_B_DOCKER_INSPECT_FAILED', { cause: error });
  }
  return assertOwned(config, JSON.parse(json)[0], kind);
}

export async function assertPortAvailable(port) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error(`ENV_B_PORT_IN_USE:${port}`)));
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function privateEnvFile(config, name, values) {
  const filename = join(config.dataDir, name);
  await writeFile(
    filename,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    { mode: 0o600 },
  );
  await chmod(filename, 0o600);
  return filename;
}

export async function waitUntil(probe, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await delay(500);
  }
  throw new Error('ENV_B_READINESS_TIMEOUT');
}

async function ensureContainer(config, name, port, image, args) {
  const existing = await inspectOwned(config, 'container', name);
  if (existing && existing.Config.Image !== image) throw new Error('ENV_B_IMAGE_MISMATCH');
  if (existing?.State.Running) return;
  await assertPortAvailable(port);
  if (existing) {
    await docker(['start', name]);
    return;
  }
  await docker([
    'run',
    '-d',
    '--name',
    name,
    '--label',
    `${OWNER_LABEL}=${config.instanceId}`,
    '--label',
    `${CONFIG_LABEL}=${configHash(config)}`,
    ...args,
    image,
    ...(image === CONTROLLED_KEYCLOAK_IMAGE ? ['start-dev'] : []),
  ]);
}

/** Only generated identifiers and hex passwords enter SQL identifier/literal positions. */
async function initializeDatabases(config, secrets) {
  const admin = new pg.Client({
    connectionString: databaseUrl(config, secrets.postgresPassword, 'postgres'),
  });
  await admin.connect();
  try {
    for (const [name, password] of [
      ['env_b_identity', secrets.identityDatabasePassword],
      ['env_b_core', secrets.coreDatabasePassword],
      ['env_b_operator', secrets.operatorDatabasePassword],
    ]) {
      const existing = await admin.query(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
        [name],
      );
      if (!existing.rowCount)
        await admin.query(
          `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        );
      else if (existing.rows[0].rolsuper || existing.rows[0].rolbypassrls)
        throw new Error('ENV_B_DATABASE_ROLE_UNSAFE');
    }
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = 'keycloak'")).rowCount)
      await admin.query('CREATE DATABASE keycloak OWNER env_b_identity');
  } finally {
    await admin.end();
  }
}

async function provisionRealm(config, secrets) {
  const origin = `http://127.0.0.1:${config.ports.identity}`;
  const fetchJson = async (path, init) =>
    globalThis.fetch(`${origin}${path}`, {
      ...init,
      signal: globalThis.AbortSignal.timeout(10_000),
    });
  const tokenResponse = await fetchJson('/realms/master/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new globalThis.URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'env-b-admin',
      password: secrets.identityAdminPassword,
    }).toString(),
  });
  if (!tokenResponse.ok) throw new Error('ENV_B_IDENTITY_ADMIN_REJECTED');
  const { access_token: token } = await tokenResponse.json();
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const existing = await fetchJson(`/admin/realms/${REALM}`, { headers });
  if (existing.status === 404) {
    const response = await fetchJson('/admin/realms', {
      method: 'POST',
      headers,
      body: JSON.stringify(buildRealm(config, secrets)),
    });
    if (response.status !== 201) throw new Error('ENV_B_REALM_CREATE_FAILED');
  } else if (!existing.ok) throw new Error('ENV_B_REALM_READ_FAILED');
  // Read back the persistent external subject; never invent a successful login.
  const user = await fetchJson(`/admin/realms/${REALM}/users/${secrets.subjectId}`, { headers });
  if (!user.ok) throw new Error('ENV_B_IDENTITY_USER_MISMATCH');
  const userDocument = await user.json();
  if (userDocument.username !== secrets.username || userDocument.enabled !== true)
    throw new Error('ENV_B_IDENTITY_USER_MISMATCH');
  const clients = await fetchJson(`/admin/realms/${REALM}/clients?clientId=workspace-bff`, {
    headers,
  });
  if (!clients.ok) throw new Error('ENV_B_IDENTITY_CLIENT_MISMATCH');
  const client = (await clients.json())[0];
  if (
    !client ||
    client.redirectUris?.length !== 1 ||
    client.redirectUris[0] !== `http://127.0.0.1:${config.ports.web}/bff/auth/callback`
  )
    throw new Error('ENV_B_IDENTITY_CLIENT_MISMATCH');
  const secret = await fetchJson(`/admin/realms/${REALM}/clients/${client.id}/client-secret`, {
    headers,
  });
  if (!secret.ok || (await secret.json()).value !== secrets.clientSecret)
    throw new Error('ENV_B_IDENTITY_CLIENT_MISMATCH');
}

export async function startInfrastructure(config, secrets) {
  await configureDockerHostFromCurrentContext();
  const names = resourceNames(config);
  const labels = [
    '--label',
    `${OWNER_LABEL}=${config.instanceId}`,
    '--label',
    `${CONFIG_LABEL}=${configHash(config)}`,
  ];
  if (!(await inspectOwned(config, 'network', names.network)))
    await docker(['network', 'create', ...labels, names.network]);
  if (!(await inspectOwned(config, 'volume', names.volume)))
    await docker(['volume', 'create', ...labels, names.volume]);
  const pgEnv = await privateEnvFile(config, 'postgres.env', {
    POSTGRES_DB: 'zhiju',
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: secrets.postgresPassword,
  });
  await ensureContainer(config, names.database, config.ports.database, postgresImageReference(), [
    '--network',
    names.network,
    '-p',
    `127.0.0.1:${config.ports.database}:5432`,
    '--env-file',
    pgEnv,
    '--mount',
    `type=volume,source=${names.volume},target=/var/lib/postgresql`,
  ]);
  await waitUntil(async () => {
    try {
      await docker(['exec', names.database, 'pg_isready', '-U', 'postgres', '-d', 'zhiju']);
      return true;
    } catch {
      return false;
    }
  });
  await initializeDatabases(config, secrets);
  await runFlyway(names.database, {
    command: 'migrate',
    database: 'zhiju',
    username: 'postgres',
    password: secrets.postgresPassword,
  });
  const admin = new pg.Client({
    connectionString: databaseUrl(config, secrets.postgresPassword, 'postgres'),
  });
  await admin.connect();
  try {
    await admin.query(
      'GRANT platform_context_establisher,identity_policy_app,identity_workspace_discovery_reader,identity_policy_preparation_writer,identity_preparation_self_reader,enterprise_project_app,task_execution_app,integration_gateway_app TO env_b_core WITH INHERIT FALSE, SET TRUE, ADMIN FALSE',
    );
    await admin.query(
      'GRANT platform_context_establisher,identity_policy_app,identity_policy_preparation_writer,identity_preparation_self_reader,enterprise_project_app,enterprise_project_platform_reference_writer TO env_b_operator',
    );
  } finally {
    await admin.end();
  }
  const identityEnv = await privateEnvFile(config, 'identity.env', {
    KC_BOOTSTRAP_ADMIN_USERNAME: 'env-b-admin',
    KC_BOOTSTRAP_ADMIN_PASSWORD: secrets.identityAdminPassword,
    KC_DB: 'postgres',
    KC_DB_URL: `jdbc:postgresql://${names.database}:5432/keycloak`,
    KC_DB_USERNAME: 'env_b_identity',
    KC_DB_PASSWORD: secrets.identityDatabasePassword,
    KC_HOSTNAME: `http://127.0.0.1:${config.ports.identity}`,
  });
  await ensureContainer(config, names.identity, config.ports.identity, CONTROLLED_KEYCLOAK_IMAGE, [
    '--network',
    names.network,
    '-p',
    `127.0.0.1:${config.ports.identity}:8080`,
    '--env-file',
    identityEnv,
  ]);
  await waitUntil(async () => {
    try {
      return (
        await globalThis.fetch(
          `http://127.0.0.1:${config.ports.identity}/realms/master/.well-known/openid-configuration`,
          { signal: globalThis.AbortSignal.timeout(3000) },
        )
      ).ok;
    } catch {
      return false;
    }
  });
  await provisionRealm(config, secrets);
}

export async function infrastructureStatus(config) {
  await configureDockerHostFromCurrentContext();
  const names = resourceNames(config),
    result = {};
  for (const key of ['database', 'identity']) {
    const value = await inspectOwned(config, 'container', names[key]);
    result[key] = value?.State.Running ? 'RUNNING' : value ? 'STOPPED' : 'NOT_INITIALIZED';
  }
  return result;
}

export async function stopInfrastructure(config) {
  await configureDockerHostFromCurrentContext();
  const names = resourceNames(config);
  // Check both owners before stopping either resource.
  const containers = await Promise.all(
    ['identity', 'database'].map(async (key) => ({
      name: names[key],
      value: await inspectOwned(config, 'container', names[key]),
    })),
  );
  for (const { name, value } of containers)
    if (value?.State.Running) await docker(['stop', '--time', '30', name]);
}
