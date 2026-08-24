// IM-02 WI-01 persistence gate: one version-locked command that starts the
// pinned PostgreSQL 18.6 container, verifies the image digest, runs Flyway
// migrations, executes the persistence tests, prints diagnostics and always
// tears the container down. Usage: `pnpm persistence:gate`.

import { spawn } from 'node:child_process';
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
import { startPostgres, stopPostgres } from './postgres.mjs';
import { docker, dockerInspectImage } from './docker.mjs';

function log(message) {
  process.stdout.write(`[persistence-gate] ${message}\n`);
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

function runVitest(env) {
  return new Promise((resolve, reject) => {
    // Persistence fixtures share one disposable database. Some negative ACL
    // cases temporarily revoke a role privilege, so file-level parallelism
    // could make an unrelated transaction observe that deliberate failure.
    const child = spawn(
      'pnpm',
      ['exec', 'vitest', 'run', 'tests/persistence', '--no-file-parallelism'],
      {
        env: { ...process.env, ...env },
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
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await docker(['pull', reference]);
      return;
    } catch (error) {
      lastError = error;
      log(`pull attempt ${attempt} for ${reference} failed: ${error.message}`);
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
  const postgresReference = postgresImageReference();
  const flywayReference = flywayImageReference();
  log(`postgres image: ${postgresReference}`);
  log(`flyway image:   ${flywayReference}`);

  await pullWithRetry(postgresReference);
  await pullWithRetry(flywayReference);

  let pg;
  try {
    pg = await startPostgres();
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

    await runFlyway(pg.containerId, {
      command: 'migrate',
      database: pg.database,
      username: pg.username,
      password: pg.password,
    });
    log('flyway migrate (empty database) completed');

    await runVitest({
      ZJU_PERSISTENCE_DATABASE_URL: `postgres://${pg.username}:${pg.password}@${pg.host}:${pg.port}/${pg.database}`,
      ZJU_PERSISTENCE_CONTAINER_ID: pg.containerId,
      ZJU_PERSISTENCE_IMAGE_TAG: POSTGRES_IMAGE_TAG,
      ZJU_PERSISTENCE_IMAGE_DIGEST: POSTGRES_IMAGE_DIGEST,
      ZJU_PERSISTENCE_FLYWAY_TAG: FLYWAY_IMAGE_TAG,
    });

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
    log('gate passed');
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
      await stopPostgres(pg.container);
      log('postgres container removed');
    }
  }
}

main().catch((error) => {
  process.stderr.write(`[persistence-gate] FAILED: ${error.message}\n`);
  process.exitCode = 1;
});
