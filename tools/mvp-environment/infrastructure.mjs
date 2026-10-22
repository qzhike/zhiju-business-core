import { randomUUID } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import pg from 'pg';

import { configureDockerHostFromCurrentContext, docker } from '../persistence/docker.mjs';
import { CONTROLLED_KEYCLOAK_IMAGE, postgresImageReference } from '../persistence/baseline.mjs';
import { runFlyway } from '../persistence/flyway.mjs';
import {
  applicationEnvironments,
  databaseUrl,
  issuerFor,
  REALM,
  buildRealm,
} from './deployment.mjs';
import { deploymentFingerprint, readInstallation, writePrivateJson } from './config.mjs';

export const OWNER_LABEL = 'io.zhiju.mvp-environment';
const CONFIG_LABEL = 'io.zhiju.mvp-environment-config';
const MODULE_MIGRATIONS = join(import.meta.dirname, '../../modules/document-delivery/migrations');

export const resourceNames = (config) => {
  const prefix = `zhiju-mvp-${config.instanceId}`;
  return {
    database: `${prefix}-db`,
    identity: `${prefix}-identity`,
    volume: `${prefix}-data`,
    network: `${prefix}-network`,
  };
};

export function assertOwned(config, value, kind) {
  const labels = kind === 'container' ? value.Config?.Labels : value.Labels;
  if (
    labels?.[OWNER_LABEL] !== config.instanceId ||
    labels?.[CONFIG_LABEL] !== deploymentFingerprint(config)
  )
    throw new Error('MVP_RESOURCE_OWNER_MISMATCH');
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
    throw new Error('MVP_DOCKER_INSPECT_FAILED', { cause: error });
  }
  return assertOwned(config, JSON.parse(json)[0], kind);
}

export async function assertPortAvailable(port) {
  const server = createServer();
  const started = Promise.withResolvers();
  server.once('error', () => started.reject(new Error(`MVP_PORT_IN_USE:${port}`)));
  server.listen(port, '127.0.0.1', () => started.resolve(undefined));
  await started.promise;
  const closed = Promise.withResolvers();
  server.close((error) => (error ? closed.reject(error) : closed.resolve(undefined)));
  await closed.promise;
}

export async function waitUntil(probe, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await delay(500);
  }
  throw new Error('MVP_READINESS_TIMEOUT');
}

async function privateEnvFile(config, name, values) {
  const filename = join(config.dataDir, name);
  await writeFile(
    filename,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
    { mode: 0o600 },
  );
  await chmod(filename, 0o600);
  return filename;
}

async function ensureContainer(config, name, port, image, args) {
  const existing = await inspectOwned(config, 'container', name);
  if (existing && existing.Config.Image !== image) throw new Error('MVP_IMAGE_MISMATCH');
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
    `${CONFIG_LABEL}=${deploymentFingerprint(config)}`,
    ...args,
    image,
    ...(image === CONTROLLED_KEYCLOAK_IMAGE ? ['start-dev'] : []),
  ]);
}

async function initializeDatabase(config, secrets) {
  const admin = new pg.Client({
    connectionString: databaseUrl(config, 'postgres', secrets.postgresPassword, 'postgres'),
  });
  await admin.connect();
  try {
    for (const [name, password] of [
      ['mvp_app_login', secrets.runtimePassword],
      ['mvp_keycloak', secrets.keycloakDbPassword],
    ]) {
      const existing = await admin.query(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1',
        [name],
      );
      if (existing.rowCount === 0)
        await admin.query(
          `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        );
      else if (existing.rows[0].rolsuper || existing.rows[0].rolbypassrls)
        throw new Error('MVP_DATABASE_ROLE_UNSAFE');
    }
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = 'zhiju_mvp'")).rowCount)
      await admin.query('CREATE DATABASE zhiju_mvp');
    if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = 'keycloak'")).rowCount)
      await admin.query('CREATE DATABASE keycloak OWNER mvp_keycloak');
  } finally {
    await admin.end();
  }
}

async function migrate(config, secrets) {
  const names = resourceNames(config);
  await runFlyway(names.database, {
    command: 'migrate',
    database: 'zhiju_mvp',
    username: 'postgres',
    password: secrets.postgresPassword,
    migrationsDir: MODULE_MIGRATIONS,
    locations: 'filesystem:/flyway/sql',
  });
  const admin = new pg.Client({
    connectionString: databaseUrl(config, 'postgres', secrets.postgresPassword, 'zhiju_mvp'),
  });
  await admin.connect();
  try {
    await admin.query('GRANT mvp_runtime TO mvp_app_login WITH INHERIT FALSE, SET TRUE');
  } finally {
    await admin.end();
  }
}

async function initializeFileStore(config, secrets) {
  const { initializeMvpFileStore } = await import('../../modules/document-delivery/dist/index.js');
  const storeRoot = join(config.dataDir, 'store');
  const identity = await initializeMvpFileStore({
    root: storeRoot,
    instanceId: config.instanceId,
    storeId: secrets.storeId,
  });
  return { storeRoot, storeId: secrets.storeId, storeIdentity: identity.storeIdentity };
}

async function provisionInstallation(config, secrets, store) {
  let previous;
  try {
    previous = await readInstallation(config);
  } catch {
    previous = undefined;
  }
  const ownerId = previous?.ownerId ?? randomUUID();
  const issuer = issuerFor(config);
  const admin = new pg.Client({
    connectionString: databaseUrl(config, 'postgres', secrets.postgresPassword, 'zhiju_mvp'),
  });
  await admin.connect();
  try {
    await admin.query('SET ROLE mvp_ddl');
    const installation = (
      await admin.query(
        'SELECT instance_id, schema_version, store_id::text, store_identity FROM document_delivery.installation WHERE singleton',
      )
    ).rows[0];
    if (installation === undefined) {
      await admin.query(
        `INSERT INTO document_delivery.installation
           (instance_id, schema_version, store_id, store_identity, created_at)
         VALUES ($1,'mvp.document_delivery@1',$2,$3,now())`,
        [config.instanceId, store.storeId, store.storeIdentity],
      );
    } else if (
      installation.instance_id !== config.instanceId ||
      installation.store_id !== store.storeId ||
      installation.store_identity !== store.storeIdentity
    ) {
      throw new Error('MVP_INSTALLATION_MISMATCH');
    }
    const binding = (
      await admin.query(
        'SELECT owner_id::text, display_name FROM document_delivery.operator_binding WHERE issuer = $1 AND subject = $2',
        [issuer, secrets.subjectId],
      )
    ).rows[0];
    if (binding === undefined) {
      await admin.query(
        `INSERT INTO document_delivery.operator_binding
           (owner_id, issuer, subject, display_name, enabled, auth_epoch, created_at, updated_at)
         VALUES ($1,$2,$3,$4,true,1,now(),now())`,
        [ownerId, issuer, secrets.subjectId, config.operatorDisplayName],
      );
    } else if (binding.owner_id !== ownerId) {
      throw new Error('MVP_BINDING_MISMATCH');
    }
    const others = await admin.query(
      'SELECT count(*)::int AS total FROM document_delivery.operator_binding',
    );
    if (others.rows[0]?.total !== 1) throw new Error('MVP_BINDING_MISMATCH');
  } finally {
    await admin.end();
  }
  const installation = {
    instanceId: config.instanceId,
    storeId: store.storeId,
    storeRoot: store.storeRoot,
    storeIdentity: store.storeIdentity,
    ownerId,
    issuer,
    subject: secrets.subjectId,
  };
  await writePrivateJson(join(config.dataDir, 'installation.json'), installation);
  return installation;
}

async function provisionRealm(config, secrets) {
  const origin = `http://127.0.0.1:${config.ports.identity}`;
  const request = (path, init) =>
    globalThis.fetch(`${origin}${path}`, {
      ...init,
      signal: globalThis.AbortSignal.timeout(10_000),
    });
  const tokenResponse = await request('/realms/master/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new globalThis.URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'mvp-admin',
      password: secrets.keycloakAdminPassword,
    }).toString(),
  });
  if (!tokenResponse.ok) throw new Error('MVP_IDENTITY_ADMIN_REJECTED');
  const { access_token: token } = await tokenResponse.json();
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const existing = await request(`/admin/realms/${REALM}`, { headers });
  if (existing.status === 404) {
    const created = await request('/admin/realms', {
      method: 'POST',
      headers,
      body: JSON.stringify(buildRealm(config, secrets)),
    });
    if (created.status !== 201) throw new Error('MVP_REALM_CREATE_FAILED');
  } else if (!existing.ok) {
    throw new Error('MVP_REALM_READ_FAILED');
  }
  const user = await request(`/admin/realms/${REALM}/users/${secrets.subjectId}`, { headers });
  if (!user.ok) throw new Error('MVP_IDENTITY_USER_MISMATCH');
  const userDocument = await user.json();
  if (userDocument.username !== secrets.username || userDocument.enabled !== true)
    throw new Error('MVP_IDENTITY_USER_MISMATCH');
  const clients = await request(`/admin/realms/${REALM}/clients?clientId=mvp-bff`, { headers });
  if (!clients.ok) throw new Error('MVP_IDENTITY_CLIENT_MISMATCH');
  const client = (await clients.json())[0];
  if (
    !client ||
    client.redirectUris?.length !== 1 ||
    client.redirectUris[0] !== `http://127.0.0.1:${config.ports.web}/bff/auth/callback`
  )
    throw new Error('MVP_IDENTITY_CLIENT_MISMATCH');
  const secret = await request(`/admin/realms/${REALM}/clients/${client.id}/client-secret`, {
    headers,
  });
  if (!secret.ok || (await secret.json()).value !== secrets.clientSecret)
    throw new Error('MVP_IDENTITY_CLIENT_MISMATCH');
}

export async function startInfrastructure(config, secrets) {
  await configureDockerHostFromCurrentContext();
  const names = resourceNames(config);
  const labels = [
    '--label',
    `${OWNER_LABEL}=${config.instanceId}`,
    '--label',
    `${CONFIG_LABEL}=${deploymentFingerprint(config)}`,
  ];
  if (!(await inspectOwned(config, 'network', names.network)))
    await docker(['network', 'create', ...labels, names.network]);
  if (!(await inspectOwned(config, 'volume', names.volume)))
    await docker(['volume', 'create', ...labels, names.volume]);
  const pgEnv = await privateEnvFile(config, 'postgres.env', {
    POSTGRES_DB: 'postgres',
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
      await docker(['exec', names.database, 'pg_isready', '-U', 'postgres', '-d', 'postgres']);
      return true;
    } catch {
      return false;
    }
  });
  await initializeDatabase(config, secrets);
  await migrate(config, secrets);
  const store = await initializeFileStore(config, secrets);
  const installation = await provisionInstallation(config, secrets, store);

  const identityEnv = await privateEnvFile(config, 'identity.env', {
    KC_BOOTSTRAP_ADMIN_USERNAME: 'mvp-admin',
    KC_BOOTSTRAP_ADMIN_PASSWORD: secrets.keycloakAdminPassword,
    KC_DB: 'postgres',
    KC_DB_URL: `jdbc:postgresql://${names.database}:5432/keycloak`,
    KC_DB_USERNAME: 'mvp_keycloak',
    KC_DB_PASSWORD: secrets.keycloakDbPassword,
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
  return installation;
}

export async function infrastructureStatus(config) {
  await configureDockerHostFromCurrentContext();
  const names = resourceNames(config);
  const result = {};
  for (const key of ['database', 'identity']) {
    const value = await inspectOwned(config, 'container', names[key]);
    result[key] = value?.State.Running ? 'RUNNING' : value ? 'STOPPED' : 'NOT_INITIALIZED';
  }
  return result;
}

export async function stopInfrastructure(config) {
  await configureDockerHostFromCurrentContext();
  const names = resourceNames(config);
  const containers = await Promise.all(
    ['identity', 'database'].map(async (key) => ({
      name: names[key],
      value: await inspectOwned(config, 'container', names[key]),
    })),
  );
  for (const { name, value } of containers)
    if (value?.State.Running) await docker(['stop', '--time', '30', name]);
}

export function serviceEnvironments(config, secrets, installation) {
  return applicationEnvironments(config, secrets, installation);
}
