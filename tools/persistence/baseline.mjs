// IM-02 WI-01 pinned physical baseline.
// Every consumer must reference images through tag@digest; tag-only or
// digest-only references are rejected so a drifted registry cannot pass the gate.

import { join } from 'node:path';

export const POSTGRES_IMAGE_TAG = '18.6';
export const POSTGRES_IMAGE_DIGEST =
  'sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722';
export const POSTGRES_REPOSITORY = 'docker.io/library/postgres';

export const FLYWAY_IMAGE_TAG = '11.20.3';
export const FLYWAY_IMAGE_DIGEST =
  'sha256:01605f443e1a891b3762f66e66d92403c33b6e0c29099ad550af94b6c1cbc3c1';
export const FLYWAY_REPOSITORY = 'docker.io/flyway/flyway';

export const POSTGRESQL_MAJOR = 18;
export const POSTGRESQL_MINOR = 6;

export const DATABASE_NAME = 'zhiju_core';
export const DATABASE_USERNAME = 'postgres';
export const MIGRATIONS_DIR = join(import.meta.dirname, '../../migrations/');

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const TAG_PATTERN = /^[0-9]+(\.[0-9]+)*$/;

/**
 * Build an immutable image reference from a tag and a manifest digest.
 * Throws when either component is malformed, so a partially pinned baseline
 * can never silently degrade into a mutable tag-only pull.
 */
export function imageReference(repository, tag, digest) {
  if (!TAG_PATTERN.test(tag)) {
    throw new Error(`invalid image tag in pinned baseline: ${tag}`);
  }
  if (!DIGEST_PATTERN.test(digest)) {
    throw new Error(`invalid image digest in pinned baseline: ${digest}`);
  }
  return `${repository}:${tag}@${digest}`;
}

export function postgresImageReference() {
  return imageReference(POSTGRES_REPOSITORY, POSTGRES_IMAGE_TAG, POSTGRES_IMAGE_DIGEST);
}

export function flywayImageReference() {
  return imageReference(FLYWAY_REPOSITORY, FLYWAY_IMAGE_TAG, FLYWAY_IMAGE_DIGEST);
}

/**
 * Verify that a `docker image inspect` result actually contains the pinned
 * digest in RepoDigests. A tag whose content no longer matches the pinned
 * digest fails the gate.
 */
export function assertRepoDigestMatches(inspectOutput, repository, tag, digest) {
  const repoDigests = Array.isArray(inspectOutput?.RepoDigests) ? inspectOutput.RepoDigests : [];
  // docker reports short repository names in RepoDigests (e.g. `postgres@sha256:...`),
  // so match on the digest-carrying suffix.
  const digestMatches = repoDigests.some((entry) => entry.endsWith(`@${digest}`));
  if (!digestMatches) {
    throw new Error(
      `image ${repository}:${tag} does not match pinned digest ${digest} (RepoDigests: ${repoDigests.join(', ') || 'none'})`,
    );
  }
  return true;
}

/**
 * Assert that a tag's currently resolved manifest digest equals the pinned
 * digest. This is the tag↔digest binding check: pulling `tag@digest` always
 * succeeds regardless of what the tag itself points to, so the tag must be
 * resolved independently and compared.
 */
export function assertTagMatchesDigest(tag, resolvedDigest, pinnedDigest) {
  if (resolvedDigest !== pinnedDigest) {
    throw new Error(
      `image tag ${tag} currently resolves to ${resolvedDigest} but the pinned digest is ${pinnedDigest}`,
    );
  }
  return true;
}

/** Expected `server_version_num` baseline, e.g. `180006` for 18.6 (MMmmpp scheme). */
export function expectedServerVersionNum() {
  return String(POSTGRESQL_MAJOR * 10000 + POSTGRESQL_MINOR);
}

/** Assert a `server_version_num` string (e.g. `180006`) against the pinned baseline. */
export function assertServerVersion(serverVersionNum) {
  if (serverVersionNum !== expectedServerVersionNum()) {
    throw new Error(
      `server_version_num ${JSON.stringify(serverVersionNum)} does not match pinned baseline ${POSTGRESQL_MAJOR}.${POSTGRESQL_MINOR} (${expectedServerVersionNum()})`,
    );
  }
  return true;
}
