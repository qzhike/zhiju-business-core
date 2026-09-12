import { describe, expect, it } from 'vitest';

import { compareUtcInstants, parseUtcInstant } from './utc-instant.js';

describe('UtcInstant parsing', () => {
  it.each([
    ['2026-01-01T00:00:00Z', 1767225600000, ''],
    ['2026-02-28T23:59:59Z', 1772323199000, ''],
    ['2024-02-29T00:00:00Z', 1709164800000, ''],
    ['2000-02-29T00:00:00Z', 951782400000, ''],
    ['2026-09-20T00:00:00.000900Z', 1789862400000, '000900'],
    ['0050-01-01T00:00:00Z', -60589296000000, ''],
  ] as const)('accepts the existing instant %s', (value, milliseconds, fraction) => {
    expect(parseUtcInstant(value)).toEqual({ wholeSecondMilliseconds: milliseconds, fraction });
  });

  it.each([
    '2026-02-29T00:00:00Z',
    '1900-02-29T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-02-31T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-06-31T00:00:00Z',
    '2026-09-31T00:00:00Z',
    '2026-11-31T00:00:00Z',
    '2026-01-32T00:00:00Z',
    '2026-00-10T00:00:00Z',
    '2026-13-01T00:00:00Z',
    '2026-01-00T00:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T00:60:00Z',
    '2026-01-01T00:00:60Z',
    '2026-01-01T00:00:00+00:00',
    '2026-01-01T00:00:00',
    '2026-1-01T00:00:00Z',
    'not-an-instant',
  ])('rejects %s instead of normalizing it', (value) => {
    expect(parseUtcInstant(value)).toBeUndefined();
  });

  it('keeps sub-second precision when ordering instants', () => {
    expect(compareUtcInstants('2026-09-20T00:00:00.000900Z', '2026-09-20T00:00:00Z')).toBe(1);
    expect(compareUtcInstants('2026-09-20T00:00:00Z', '2026-09-20T00:00:00.000900Z')).toBe(-1);
    expect(compareUtcInstants('2026-09-20T00:00:00.000100Z', '2026-09-20T00:00:00.000100Z')).toBe(
      0,
    );
  });

  it('fails closed instead of ordering an invalid instant', () => {
    expect(compareUtcInstants('2026-02-30T00:00:00Z', '2026-03-01T00:00:00Z')).toBeUndefined();
    expect(compareUtcInstants('2026-03-01T00:00:00Z', '2026-02-30T00:00:00Z')).toBeUndefined();
  });
});
