import { describe, expect, it } from 'vitest';

import { isUuidV7, newUuidV7, parseUuidV7 } from './identifiers.js';

describe('UUIDv7', () => {
  it('generates and parses RFC 9562 UUID version 7 values', () => {
    const value = newUuidV7();
    expect(isUuidV7(value)).toBe(true);
    expect(parseUuidV7(value)).toBe(value);
  });

  it('rejects UUID version 4', () => {
    expect(() => parseUuidV7('5c60f693-bef5-4c3e-bf2a-a763cb67e781')).toThrow('version 7');
  });
});
