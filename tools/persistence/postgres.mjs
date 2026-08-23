import { PostgreSqlContainer } from '@testcontainers/postgresql';
import {
  assertRepoDigestMatches,
  assertTagMatchesDigest,
  DATABASE_NAME,
  DATABASE_USERNAME,
  POSTGRES_IMAGE_DIGEST,
  POSTGRES_IMAGE_TAG,
  POSTGRES_REPOSITORY,
  postgresImageReference,
} from './baseline.mjs';
import { dockerInspectImage, resolveTagDigest } from './docker.mjs';

/**
 * Start the pinned PostgreSQL 18.6 container and prove the pulled image
 * matches the pinned manifest digest before handing the container out:
 * - the pulled image's RepoDigests must contain the pinned digest, and
 * - the tag must currently resolve (registry-side) to the pinned digest,
 *   so a `tag@digest` pull cannot mask a drifted tag.
 * Any post-start failure stops and removes the container before rethrowing;
 * the gate's own cleanup only sees a returned handle.
 */
export async function startPostgres() {
  const reference = postgresImageReference();
  const container = new PostgreSqlContainer(reference)
    .withDatabase(DATABASE_NAME)
    .withUsername(DATABASE_USERNAME)
    .withPassword('zhiju-gate-test')
    .withStartupTimeout(120_000);

  const started = await container.start();

  try {
    const inspect = await dockerInspectImage(reference);
    assertRepoDigestMatches(
      inspect,
      POSTGRES_REPOSITORY,
      POSTGRES_IMAGE_TAG,
      POSTGRES_IMAGE_DIGEST,
    );

    const tagDigest = await resolveTagDigest(POSTGRES_REPOSITORY, POSTGRES_IMAGE_TAG);
    assertTagMatchesDigest(POSTGRES_IMAGE_TAG, tagDigest, POSTGRES_IMAGE_DIGEST);
  } catch (error) {
    try {
      await stopPostgres(started);
    } catch (cleanupError) {
      error.message = `${error.message}; cleanup after failed image verification also failed: ${cleanupError.message}`;
    }
    throw error;
  }

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
