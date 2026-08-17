import { describe, expect, it } from 'vitest';

import { canonicalize, hashContractPayload } from './canonical-json.js';

describe('canonical JSON v1', () => {
  it('normalizes Unicode and orders keys by UTF-8 bytes', () => {
    expect(canonicalize({ z: 'e\u0301', a: true })).toBe('{"a":true,"z":"é"}');
  });

  it('rejects binary floating point values', () => {
    expect(() => canonicalize({ amount: 1.25 })).toThrow('decimals use strings');
  });

  it('rejects property collisions after NFC normalization', () => {
    expect(() => canonicalize({ é: 1, 'e\u0301': 2 })).toThrow('collide');
  });

  it('excludes only the current contract header payloadHash', () => {
    const withHash = {
      header: { payloadHash: 'old', contractType: 'zhiju.contract.example' },
      referencedHash: 'keep-me',
    } as const;
    const withoutHash = {
      header: { contractType: 'zhiju.contract.example' },
      referencedHash: 'keep-me',
    } as const;
    expect(hashContractPayload(withHash)).toBe(hashContractPayload(withoutHash));
  });
});
