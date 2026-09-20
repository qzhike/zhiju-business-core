// Read-only container-runtime preflight for the configured persistence gate.
// It never pulls images, starts containers or reads registry credentials.

import {
  assertTagMatchesDigest,
  FLYWAY_IMAGE_DIGEST,
  FLYWAY_IMAGE_TAG,
  FLYWAY_REPOSITORY,
  POSTGRES_IMAGE_DIGEST,
  POSTGRES_IMAGE_TAG,
  POSTGRES_REPOSITORY,
  flywayImageReference,
  postgresImageReference,
} from './baseline.mjs';
import {
  configureDockerHostFromCurrentContext,
  docker,
  dockerInspectImage,
  resolveTagDigest,
} from './docker.mjs';

async function imageBaseline({ reference, repository, tag, digest }) {
  let cacheStatus;
  try {
    await dockerInspectImage(reference);
    cacheStatus = 'CACHED';
  } catch {
    cacheStatus = 'MISSING';
  }

  try {
    const resolvedDigest = await resolveTagDigest(repository, tag, { timeout: 15_000 });
    assertTagMatchesDigest(tag, resolvedDigest, digest);
    return {
      reference,
      cacheStatus,
      registryStatus: 'PIN_MATCH',
      resolvedDigest,
    };
  } catch (error) {
    const resolvedDigest = error.message.match(/resolves to (sha256:[0-9a-f]{64})/)?.[1];
    return {
      reference,
      cacheStatus,
      registryStatus: resolvedDigest ? 'PIN_MISMATCH' : 'REGISTRY_UNAVAILABLE',
      ...(resolvedDigest ? { resolvedDigest } : {}),
      error: error.message,
    };
  }
}

async function main() {
  const runtime = await configureDockerHostFromCurrentContext();
  const serverVersion = (await docker(['version', '--format', '{{.Server.Version}}'])).trim();
  const images = await Promise.all([
    imageBaseline({
      reference: postgresImageReference(),
      repository: POSTGRES_REPOSITORY,
      tag: POSTGRES_IMAGE_TAG,
      digest: POSTGRES_IMAGE_DIGEST,
    }),
    imageBaseline({
      reference: flywayImageReference(),
      repository: FLYWAY_REPOSITORY,
      tag: FLYWAY_IMAGE_TAG,
      digest: FLYWAY_IMAGE_DIGEST,
    }),
  ]);
  const warnings = images
    .filter((image) => image.cacheStatus === 'MISSING')
    .map((image) => `image is not cached locally: ${image.reference}`);
  const failures = images
    .filter((image) => image.registryStatus !== 'PIN_MATCH')
    .map((image) => `${image.registryStatus}: ${image.reference}`);

  process.stdout.write(
    `${JSON.stringify(
      {
        status: failures.length === 0 ? 'PASS' : 'FAIL',
        docker: {
          host: runtime.host,
          hostSource: runtime.source,
          serverVersion,
        },
        images,
        warnings,
        failures,
        limits: [
          'read-only; no image pull or container start',
          'does not replace the full persistence gate',
          'checks current registry tag-to-digest binding without reading credentials',
        ],
      },
      null,
      2,
    )}\n`,
  );
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'FAIL', error: error.message }, null, 2)}\n`);
  process.exitCode = 1;
});
