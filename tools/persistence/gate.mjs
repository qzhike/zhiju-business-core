import { performance } from 'node:perf_hooks';
// IM-02 WI-01 persistence gate: one version-locked command that starts the
// pinned PostgreSQL 18.6 container, verifies the image digest, runs Flyway
// migrations, executes the persistence tests, prints diagnostics and always
// tears the container down. Usage: `pnpm persistence:gate`.

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  assertServerVersion,
  DATABASE_NAME,
  DATABASE_USERNAME,
  FLYWAY_IMAGE_TAG,
  POSTGRES_IMAGE_DIGEST,
  POSTGRES_IMAGE_TAG,
  flywayImageReference,
  postgresImageReference,
} from './baseline.mjs';
import { flywayVersion, runFlyway } from './flyway.mjs';
import { configureDockerHostFromCurrentContext, docker, dockerInspectImage } from './docker.mjs';
import { historicalProviderResultSeedSql } from './provider-result-upgrade-fixture.mjs';

function log(message) {
  process.stdout.write(`[persistence-gate] ${message}\n`);
}

async function timed(label, operation) {
  const started = performance.now();
  log(`stage start: ${label}`);
  try {
    return await operation();
  } finally {
    log(`stage end: ${label}; elapsedMs=${Math.round(performance.now() - started)}`);
  }
}

async function query(containerId, sql) {
  return docker([
    'exec',
    containerId,
    'psql',
    '-U',
    DATABASE_USERNAME,
    '-d',
    DATABASE_NAME,
    '-t',
    '-A',
    '-c',
    sql,
  ]);
}

async function seedHistoricalProviderResultData(containerId) {
  await query(containerId, historicalProviderResultSeedSql());
  log('seeded synthetic V6002 historical Provider Result rows');
}

const filters = process.argv.slice(2).filter((arg) => arg !== '--diagnostics');
const fileArgument = filters.find((arg) => arg.startsWith('--test-file='));
const nameArgument = filters.find((arg) => arg.startsWith('--test-name-pattern='));
if (filters.some((arg) => arg !== fileArgument && arg !== nameArgument)) {
  throw new Error('unknown persistence diagnostic argument');
}
if (nameArgument && !fileArgument) throw new Error('test name filter requires an explicit file');
const testFile = fileArgument?.slice('--test-file='.length) ?? 'tests/persistence';
if (fileArgument && !/^tests\/persistence\/[a-z0-9-]+\.test\.ts$/.test(testFile)) {
  throw new Error('diagnostics must select one persistence test file');
}
if (fileArgument)
  log(`FOCUSED DIAGNOSTIC ONLY: ${testFile}; ${nameArgument ?? 'all tests in file'}`);

function runVitest(env) {
  return new Promise((resolve, reject) => {
    // Persistence fixtures share one disposable database. Some negative ACL
    // cases temporarily revoke a role privilege, so file-level parallelism
    // could make an unrelated transaction observe that deliberate failure.
    const child = spawn(
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        '--config=vitest.persistence.config.ts',
        testFile,
        '--no-file-parallelism',
        ...(nameArgument
          ? ['--testNamePattern', nameArgument.slice('--test-name-pattern='.length)]
          : []),
      ],
      {
        env: { ...process.env, ...env, ZJU_PERSISTENCE_FOCUSED: fileArgument ? '1' : '0' },
        stdio: 'inherit',
      },
    );
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`vitest exited with ${code}`)),
    );
    child.on('error', reject);
  });
}

async function pullWithRetry(reference, attempts = 3) {
  try {
    await dockerInspectImage(reference);
    log(`using locally cached image for ${reference}`);
    return;
  } catch {
    // A missing exact digest may be pulled below. Other image-inspection errors
    // are surfaced by the pull or the final inspection.
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await docker(['pull', reference]);
      return;
    } catch (error) {
      lastError = error;
      log(`pull attempt ${attempt} for ${reference} failed: ${error.message}`);
      if (/429|too many requests|credential|unauthorized|denied/i.test(error.message)) {
        break;
      }
      if (attempt < attempts) {
        await delay(1000 * 2 ** (attempt - 1));
      }
    }
  }
  // Digest-pinned references are content-addressed: if the exact image is
  // already cached locally, a transient registry outage must not fail the gate.
  try {
    await dockerInspectImage(reference);
    log(`using locally cached image for ${reference}`);
    return;
  } catch {
    throw lastError;
  }
}

async function main() {
  const dockerRuntime = await configureDockerHostFromCurrentContext();
  log(
    dockerRuntime.host
      ? `docker host:    ${dockerRuntime.host} (${dockerRuntime.source})`
      : `docker host:    ${dockerRuntime.source}`,
  );
  const postgresReference = postgresImageReference();
  const flywayReference = flywayImageReference();
  log(`postgres image: ${postgresReference}`);
  log(`flyway image:   ${flywayReference}`);

  await pullWithRetry(postgresReference);
  await pullWithRetry(flywayReference);

  // Import Testcontainers only after the active Docker context has been made
  // explicit through DOCKER_HOST.
  const { startPostgres, stopPostgres } = await import('./postgres.mjs');
  let pg;
  try {
    pg = await timed('PostgreSQL startup and image verification', () => startPostgres());
    log(`postgres container ${pg.containerId.slice(0, 12)} ready on ${pg.host}:${pg.port}`);

    const serverVersion = (await query(pg.containerId, 'SHOW server_version_num;')).trim();
    assertServerVersion(serverVersion);
    log(`server_version: ${serverVersion}`);

    const flywayVersionOutput = (await flywayVersion()).trim();
    const flywayVersionLine = flywayVersionOutput
      .split('\n')
      .find((line) => line.includes(FLYWAY_IMAGE_TAG));
    if (!flywayVersionLine) {
      throw new Error(`flyway reported unexpected version: ${flywayVersionOutput}`);
    }
    log(`flyway version: ${flywayVersionLine.trim()}`);

    await timed('migration through V6002', () =>
      runFlyway(pg.containerId, {
        command: 'migrate',
        database: pg.database,
        username: pg.username,
        password: pg.password,
        target: '6002',
      }),
    );
    log('flyway migrate (empty database through V6002) completed');

    await timed('historical Provider Result seed', () =>
      seedHistoricalProviderResultData(pg.containerId),
    );

    await timed('historical forward migration', () =>
      runFlyway(pg.containerId, {
        command: 'migrate',
        database: pg.database,
        username: pg.username,
        password: pg.password,
      }),
    );
    log('flyway migrate (V6003/V6004 historical Provider Result upgrade) completed');

    await timed('persistence tests', () =>
      runVitest({
        ZJU_PERSISTENCE_DATABASE_URL: `postgres://${pg.username}:${pg.password}@${pg.host}:${pg.port}/${pg.database}`,
        ZJU_PERSISTENCE_CONTAINER_ID: pg.containerId,
        ZJU_PERSISTENCE_IMAGE_TAG: POSTGRES_IMAGE_TAG,
        ZJU_PERSISTENCE_IMAGE_DIGEST: POSTGRES_IMAGE_DIGEST,
        ZJU_PERSISTENCE_FLYWAY_TAG: FLYWAY_IMAGE_TAG,
      }),
    );

    // Second migrate run: must be a no-op. The normalized no-pending line is
    // printed as manual-acceptance evidence (runbook), without credentials.
    const secondMigrate = await runFlyway(pg.containerId, {
      command: 'migrate',
      database: pg.database,
      username: pg.username,
      password: pg.password,
    });
    const noPendingLine = secondMigrate
      .split('\n')
      .map((line) => line.trim())
      .find((line) => /up to date|no pending migrations|No migration necessary/i.test(line));
    if (!noPendingLine) {
      throw new Error(`second flyway migrate was not a no-op:\n${secondMigrate}`);
    }
    log(`second migrate: ${noPendingLine}`);

    const info = await runFlyway(pg.containerId, {
      command: 'info',
      database: pg.database,
      username: pg.username,
      password: pg.password,
    });
    const applied = info
      .split('\n')
      .filter((line) => line.includes('|') && line.match(/\|\s*\d{4}\s*\|/))
      .map((line) => line.trim());
    log('applied migrations:');
    for (const line of applied) {
      log(`  ${line}`);
    }
    log(fileArgument ? 'focused diagnostic passed (not the full gate)' : 'gate passed');
  } catch (error) {
    if (pg) {
      try {
        const logs = await docker(['logs', '--tail', '40', pg.containerId]);
        process.stdout.write(`[persistence-gate] postgres container logs (tail):\n${logs}\n`);
      } catch {
        // diagnostics best effort; the original error matters more
      }
    }
    throw error;
  } finally {
    if (pg) {
      await timed('container cleanup', () => stopPostgres(pg.container));
      log('postgres container removed');
    }
  }
}

main().catch((error) => {
  process.stderr.write(`[persistence-gate] FAILED: ${error.message}\n`);
  process.exitCode = 1;
});
