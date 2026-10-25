import { docker } from './docker.mjs';
import { flywayImageReference, MIGRATIONS_DIR } from './baseline.mjs';

const MIGRATION_LOCATIONS = [
  'bootstrap',
  'identity_policy',
  'enterprise_project',
  'task_execution',
  'artifact',
  'quality_governance',
  'release_publication',
  'integration_gateway',
]
  .map((dir) => `filesystem:/flyway/sql/${dir}`)
  .join(',');

/**
 * Run the pinned Flyway CLI image against the PostgreSQL container.
 * Uses `--network container:<id>` so the CLI reaches the server on its native
 * port without publishing anything to the host.
 */
export async function runFlyway(
  containerId,
  {
    command,
    database,
    username,
    password,
    target,
    migrationsDir = MIGRATIONS_DIR,
    locations = MIGRATION_LOCATIONS,
    schemas = 'public',
  },
) {
  const args = [
    'run',
    '--rm',
    '--network',
    `container:${containerId}`,
    '--volume',
    `${migrationsDir}:/flyway/sql:ro`,
    flywayImageReference(),
    '-url=jdbc:postgresql://127.0.0.1:5432/' + database,
    `-user=${username}`,
    `-password=${password}`,
    `-schemas=${schemas}`,
    `-locations=${locations}`,
    '-connectRetries=10',
    ...(target === undefined ? [] : [`-target=${target}`]),
    command,
  ];
  return docker(args);
}

export async function flywayVersion() {
  return docker(['run', '--rm', flywayImageReference(), '-v']);
}
