import { describe, expect, it } from 'vitest';
import { parseLimitViolation, limitViolationText, SCAN_LIMITS } from './limits.js';

describe('custody limit details', () => {
  it('validates every fixed metric and refuses forged limits, fields and paths', () => {
    for (const [metric, limit] of Object.entries(SCAN_LIMITS)) {
      const detail = { metric, actual: limit + 1, limit };
      expect(parseLimitViolation(detail)).toEqual(detail);
      for (const invalid of [
        { ...detail, actual: limit },
        { ...detail, actual: Infinity },
        { ...detail, limit: limit + 1 },
        { ...detail, extra: true },
        { ...detail, documentPath: '../bad.docx' },
        { ...detail, documentPath: null },
      ])
        expect(parseLimitViolation(invalid)).toBeUndefined();
    }
    for (const compressedBytes of [0, 1]) {
      const detail = {
        metric: 'EXPANSION_RATIO' as const,
        expandedBytes: 101,
        compressedBytes,
        limit: 100 as const,
      };
      expect(parseLimitViolation(detail)).toEqual(detail);
      expect(limitViolationText(detail)).toContain('目录声明的展开倍率');
      expect(limitViolationText(detail)).toContain(`压缩大小 ${compressedBytes} 字节`);
    }
    expect(
      parseLimitViolation({
        metric: 'EXPANSION_RATIO',
        expandedBytes: 100,
        compressedBytes: 1,
        limit: 100,
      }),
    ).toBeUndefined();
    expect(
      parseLimitViolation({
        metric: 'OUTER_ENTRIES',
        actual: 1001,
        limit: 1000,
        documentPath: 'x.docx',
      }),
    ).toBeUndefined();
  });
});
