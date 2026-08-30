import { describe, expect, it } from 'vitest';
import { digestCanonicalPayload } from './quality-db.js';
import {
  assertHashMatches,
  QUALITY_PAYLOAD_HASH_MISMATCH,
  QUALITY_PROMOTED_MIRROR_MISMATCH,
  validatePromotedMirror,
} from './write-guards.js';

describe('QualityGovernance persistence write guards', () => {
  it('uses canonical JSON for stable payload digests', () => {
    const first = digestCanonicalPayload({ projectId: 'project-a', enterpriseId: 'enterprise-a' });
    const second = digestCanonicalPayload({ enterpriseId: 'enterprise-a', projectId: 'project-a' });
    expect(first.hash.equals(second.hash)).toBe(true);
    expect(first.canonicalizationVersion).toBe('1');
    expect(first.hashAlgorithm).toBe('SHA-256');
  });

  it('accepts exact mirrors and rejects scope or hash mismatches', () => {
    const payload = { enterpriseId: 'enterprise-a', projectId: 'project-a' };
    const digest = digestCanonicalPayload(payload);
    expect(() => {
      validatePromotedMirror(payload, {
        enterpriseId: 'enterprise-a',
        projectId: 'project-a',
      });
    }).not.toThrow();
    expect(() => {
      validatePromotedMirror(payload, { projectId: 'project-b' });
    }).toThrow(expect.objectContaining({ code: QUALITY_PROMOTED_MIRROR_MISMATCH }));
    expect(() => {
      assertHashMatches(digest, Buffer.alloc(32, 0x11));
    }).toThrow(expect.objectContaining({ code: QUALITY_PAYLOAD_HASH_MISMATCH }));
  });
});
