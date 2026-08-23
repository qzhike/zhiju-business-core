import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  assertRepoDigestMatches,
  DATABASE_NAME,
  DATABASE_USERNAME,
  POSTGRES_IMAGE_DIGEST,
  POSTGRES_IMAGE_TAG,
  POSTGRES_REPOSITORY,
  postgresImageReference,
} from './baseline.mjs';
import { dockerInspectImage } from './docker.mjs';

/**
 * Start the pinned PostgreSQL 18.6 container and prove the pulled image
 * matches the pinned manifest digest before handing the container out.
 */
export async function startPostgres() {
  const reference = postgresImageReference();
  const container = new PostgreSqlContainer(reference)
    .withDatabase(DATABASE_NAME)
    .withUsername(DATABASE_USERNAME)
    .withPassword('zhiju-gate-test')
    .withStartupTimeout(120_000);

  const started = await container.start();

  const inspect = await dockerInspectImage(reference);
  assertRepoDigestMatches(inspect, POSTGRES_REPOSITORY, POSTGRES_IMAGE_TAG, POSTGRES_IMAGE_DIGEST);

  return {
    container: started,
    containerId: started.getId(),
    // Host-side endpoint for the `pg` client used by persistence tests.
    host: started.getHost(),
    port: started.getMappedPort(5432),
    database: DATABASE_NAME,
    username: DATABASE_USERNAME,
    password: 'zhiju-gate-test',
  };
}

export async function stopPostgres(container) {
  await container.stop({ remove: true, timeout: 10_000 });
}
