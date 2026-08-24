import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalize } from '@zhiju/shared-kernel';
import {
  assertHashMatches,
  IDENTITY_PAYLOAD_HASH_MISMATCH,
  IDENTITY_PROMOTED_MIRROR_MISMATCH,
  validatePromotedMirror,
} from './identity-policy-repository.js';
import { digestCanonicalPayload } from './identity-db.js';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';

describe('promoted mirror validation', () => {
  const payload: CanonicalJsonObject = {
    outcome: 'ALLOW',
    enterpriseId: '12121212-1212-7121-8121-1212121212a1',
    commandType: 'wi05.demo.command',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  };

  it('accepts payload columns that match the promoted values', () => {
    expect(() => {
      validatePromotedMirror(payload, {
        outcome: 'ALLOW',
        enterpriseId: '12121212-1212-7121-8121-1212121212a1',
        commandType: 'wi05.demo.command',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      });
    }).not.toThrow();
  });

  it('rejects any promoted mismatch with a stable code', () => {
    try {
      validatePromotedMirror(payload, { outcome: 'DENY' });
      expect.unreachable('mirror mismatch must throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(IDENTITY_PROMOTED_MIRROR_MISMATCH);
    }
    try {
      validatePromotedMirror(payload, { enterpriseId: 'other' });
      expect.unreachable('mirror mismatch must throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(IDENTITY_PROMOTED_MIRROR_MISMATCH);
    }
    try {
      validatePromotedMirror(payload, { effectiveFrom: new Date('2027-01-01T00:00:00Z') });
      expect.unreachable('mirror mismatch must throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(IDENTITY_PROMOTED_MIRROR_MISMATCH);
    }
  });

  it('rejects a missing promoted field', () => {
    try {
      validatePromotedMirror(payload, { missing: 'value' });
      expect.unreachable('missing promoted field must throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(IDENTITY_PROMOTED_MIRROR_MISMATCH);
    }
  });
});

describe('canonical payload digest', () => {
  it('is SHA-256 over the shared-kernel canonical JSON (v1)', () => {
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

  it('rejects a declared hash that disagrees with the canonical bytes', () => {
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
      expect((error as { code?: string }).code).toBe(IDENTITY_PAYLOAD_HASH_MISMATCH);
    }
  });
});
