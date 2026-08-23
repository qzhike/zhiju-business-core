import { describe, expect, it } from 'vitest';
import {
  assertRepoDigestMatches,
  assertServerVersion,
  assertTagMatchesDigest,
  imageReference,
  POSTGRES_IMAGE_TAG,
  postgresImageReference,
  flywayImageReference,
  FLYWAY_IMAGE_TAG,
} from '../../tools/persistence/baseline.mjs';

// The pinned baseline is the gate's integrity root: tag-only references,
// malformed digests or drifted repo digests must fail closed.

describe('pinned image baseline', () => {
  it('references postgres and flyway as tag@digest', () => {
    expect(postgresImageReference()).toMatch(
      /^docker\.io\/library\/postgres:18\.6@sha256:[0-9a-f]{64}$/,
    );
    expect(flywayImageReference()).toMatch(
      /^docker\.io\/flyway\/flyway:11\.[0-9.]+@sha256:[0-9a-f]{64}$/,
    );
  });

  it('rejects malformed tags and digests', () => {
    expect(() =>
      imageReference('docker.io/library/postgres', 'latest', 'sha256:' + 'a'.repeat(64)),
    ).toThrow(/invalid image tag/);
    expect(() => imageReference('docker.io/library/postgres', '18.6', 'sha256:short')).toThrow(
      /invalid image digest/,
    );
    expect(() => imageReference('docker.io/library/postgres', '18.6', 'not-a-digest')).toThrow(
      /invalid image digest/,
    );
  });

  it('fails when the pulled image no longer carries the pinned repo digest', () => {
    const inspect = { RepoDigests: ['docker.io/library/postgres@sha256:' + 'b'.repeat(64)] };
    expect(() =>
      assertRepoDigestMatches(
        inspect,
        'docker.io/library/postgres',
        POSTGRES_IMAGE_TAG,
        'sha256:' + 'a'.repeat(64),
      ),
    ).toThrow(/does not match pinned digest/);
    expect(
      assertRepoDigestMatches(
        { RepoDigests: ['docker.io/library/postgres@sha256:' + 'a'.repeat(64)] },
        'docker.io/library/postgres',
        POSTGRES_IMAGE_TAG,
        'sha256:' + 'a'.repeat(64),
      ),
    ).toBe(true);
  });

  it('fails when the tag resolves to a different manifest digest than pinned', () => {
    const pinned = 'sha256:' + 'a'.repeat(64);
    const drifted = 'sha256:' + 'b'.repeat(64);
    // Negative regression for the tag↔digest binding: a `tag@digest` pull
    // succeeds even when the tag itself drifted, so the resolved digest must
    // be compared independently (e.g. 18.5 tag still resolving to its own
    // manifest while 18.6 is pinned).
    expect(() => assertTagMatchesDigest('18.6', drifted, pinned)).toThrow(
      /currently resolves to .* but the pinned digest is/,
    );
    expect(assertTagMatchesDigest('18.6', pinned, pinned)).toBe(true);
  });

  it('fails server versions outside the pinned major.minor', () => {
    expect(() => assertServerVersion('170002')).toThrow(/does not match pinned baseline/);
    expect(() => assertServerVersion('180004')).toThrow(/does not match pinned baseline/);
    expect(assertServerVersion('180006')).toBe(true);
  });

  it('pinned flyway tag is a version tag, not a moving alias', () => {
    expect(FLYWAY_IMAGE_TAG).toMatch(/^\d+\.\d+\.\d+$/);
    expect(POSTGRES_IMAGE_TAG).toMatch(/^\d+\.\d+$/);
  });
});
