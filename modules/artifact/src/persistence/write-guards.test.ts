import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalize, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  assertHashMatches,
  ARTIFACT_PAYLOAD_HASH_MISMATCH,
  ARTIFACT_PROMOTED_MIRROR_MISMATCH,
  validatePromotedMirror,
} from './write-guards.js';
import { digestCanonicalPayload } from './artifact-db.js';

describe('Artifact promoted mirror validation', () => {
  const payload: CanonicalJsonObject = {
    enterpriseId: '12121212-1212-7121-8121-1212121212a1',
    projectId: '13131313-1313-7131-8131-1313131313b1',
    commandType: 'wi04.demo.command',
  };

  it('accepts promoted values that match the canonical payload', () => {
    expect(() => {
      validatePromotedMirror(payload, {
        enterpriseId: '12121212-1212-7121-8121-1212121212a1',
        projectId: '13131313-1313-7131-8131-1313131313b1',
        commandType: 'wi04.demo.command',
      });
    }).not.toThrow();
  });

  it('accepts a null promoted Project when the payload omits it', () => {
    expect(() => {
      validatePromotedMirror(
        { enterpriseId: '12121212-1212-7121-8121-1212121212a1' },
        { enterpriseId: '12121212-1212-7121-8121-1212121212a1', projectId: null },
      );
    }).not.toThrow();
  });

  it('rejects a missing or different promoted field with a stable code', () => {
    for (const promoted of [{ enterpriseId: 'other' }, { missing: 'value' }]) {
      try {
        validatePromotedMirror(payload, promoted);
        expect.unreachable('promoted mismatch must throw');
      } catch (error) {
        expect((error as { code?: string }).code).toBe(ARTIFACT_PROMOTED_MIRROR_MISMATCH);
      }
    }
  });
});

describe('Artifact canonical payload digest', () => {
  it('uses the shared-kernel canonical JSON and SHA-256 v1', () => {
    const payload: CanonicalJsonObject = { b: 1, a: 'x', nested: { y: true, x: null } };
    const digest = digestCanonicalPayload(payload);
    expect(digest.canonicalizationVersion).toBe('1');
    expect(digest.hashAlgorithm).toBe('SHA-256');
    expect(digest.canonicalJson).toBe(canonicalize({ a: 'x', b: 1, nested: { x: null, y: true } }));
    expect(digest.hash.equals(createHash('sha256').update(digest.canonicalJson).digest())).toBe(
      true,
    );
    expect(digest.sizeBytes).toBe(Buffer.byteLength(digest.canonicalJson, 'utf8'));
  });

  it('rejects a declared hash that differs from canonical bytes', () => {
    const digest = digestCanonicalPayload({ a: 'x' });
    expect(() => {
      assertHashMatches(digest, digest.hash);
    }).not.toThrow();
    expect(() => {
      assertHashMatches(digest);
    }).not.toThrow();
    try {
      assertHashMatches(digest, Buffer.alloc(32, 1));
      expect.unreachable('hash mismatch must throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(ARTIFACT_PAYLOAD_HASH_MISMATCH);
    }
  });
});
