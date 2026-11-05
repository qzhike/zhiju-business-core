import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createScanBudget,
  parseZipContainer,
  ZipSafetyError,
} from '../../modules/document-delivery/src/custody/zip.js';
import { scanInputPackage } from '../../modules/document-delivery/src/custody/scan.js';
import { scanXml } from '../../modules/document-delivery/src/custody/xml.js';
import { MVP_INPUT_LIMITS } from '../../modules/document-delivery/src/domain/policy.js';
import {
  parseLimitViolation,
  SCAN_LIMITS,
} from '../../modules/document-delivery/src/domain/limit-violation.js';
import { docxBytes, xlsxBytes, textBytes, zipBytes } from '../persistence/mvp-fixtures.js';

function violation(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ZipSafetyError);
    const failure = error as ZipSafetyError;
    expect(failure.code).toBe('ZIP_LIMIT_EXCEEDED');
    expect(parseLimitViolation(failure.limitViolation)).toEqual(failure.limitViolation);
    expect(failure.limitViolation).toBeDefined();
    return failure.limitViolation;
  }
  throw new Error('Expected a resource rejection');
}

function office(parts: number, format: 'docx' | 'xlsx' = 'docx', corrupt = false): Buffer {
  const original = format === 'docx' ? docxBytes() : xlsxBytes();
  const entries = parseZipContainer(original, createScanBudget(original.length)).map((entry) => ({
    name: entry.originalName,
    bytes:
      corrupt && entry.originalName === 'word/document.xml' ? textBytes('<broken>') : entry.bytes,
  }));
  return zipBytes([
    ...entries,
    ...Array.from({ length: parts - entries.length }, (_, i) => ({
      name: `extra/${i}.txt`,
      bytes: Buffer.alloc(0),
    })),
  ]);
}

afterEach(() => vi.restoreAllMocks());

describe('MVP @3 resource budgets', () => {
  it('accepts 1000 outer entries including directories and rejects 1001', () => {
    const entries = Array.from({ length: 1000 }, (_, i) => ({
      name: `folder${i}/`,
      bytes: Buffer.alloc(0),
    }));
    expect(scanInputPackage(zipBytes(entries)).entries).toEqual([]);
    expect(
      violation(() =>
        scanInputPackage(zipBytes([...entries, { name: 'last.md', bytes: textBytes('ok') }])),
      ),
    ).toEqual({ metric: 'OUTER_ENTRIES', actual: 1001, limit: 1000 });
  });

  it.each(['docx', 'xlsx'] as const)(
    'accepts 1000 parts in one %s and rejects 1001 with the verified outer path',
    (format) => {
      expect(
        scanInputPackage(zipBytes([{ name: `report.${format}`, bytes: office(1000, format) }]))
          .entries[0]?.status,
      ).toBe('ACCEPTED');
      expect(
        violation(() =>
          scanInputPackage(
            zipBytes([{ name: `资料/<report>.${format}`, bytes: office(1001, format) }]),
          ),
        ),
      ).toEqual({
        metric: 'OFFICE_DOCUMENT_ENTRIES',
        actual: 1001,
        limit: 1000,
        documentPath: `资料/<report>.${format}`,
      });
    },
  );

  it('shares 20000 Office parts across formats and rejects the next declared part', () => {
    const doc = office(1000);
    const sheet = office(1000, 'xlsx');
    const entries = Array.from({ length: 20 }, (_, i) => ({
      name: `${i}.${i % 2 ? 'docx' : 'xlsx'}`,
      bytes: i % 2 ? doc : sheet,
    }));
    expect(
      scanInputPackage(zipBytes(entries)).entries.every((entry) => entry.status === 'ACCEPTED'),
    ).toBe(true);
    expect(
      violation(() =>
        scanInputPackage(
          zipBytes([
            ...entries,
            {
              name: 'last.docx',
              bytes: zipBytes([{ name: 'part.txt', bytes: Buffer.alloc(0) }]),
            },
          ]),
        ),
      ),
    ).toEqual({ metric: 'OFFICE_ENTRIES', actual: 20001, limit: 20000, documentPath: 'last.docx' });
  });

  it('does not return consumed parts after corrupt or renamed Office files', () => {
    for (const doc of [
      office(1000, 'docx', true),
      zipBytes(
        Array.from({ length: 1000 }, (_, i) => ({ name: `${i}.txt`, bytes: Buffer.alloc(0) })),
      ),
    ]) {
      const entries = Array.from({ length: 21 }, (_, i) => ({ name: `${i}.docx`, bytes: doc }));
      expect(violation(() => scanInputPackage(zipBytes(entries)))).toMatchObject({
        metric: 'OFFICE_ENTRIES',
        actual: 21000,
        limit: 20000,
      });
    }
  });

  it('reports directory declarations without claiming verified entry counts or leaking unverified paths', () => {
    const bytes = zipBytes([{ name: 'unverified.md', bytes: textBytes('x') }]);
    bytes.writeUInt16LE(1001, bytes.length - 14);
    bytes.writeUInt16LE(1001, bytes.length - 12);
    expect(violation(() => scanInputPackage(bytes))).toEqual({
      metric: 'OUTER_ENTRIES',
      actual: 1001,
      limit: 1000,
    });
    const oversized = zipBytes([{ name: 'unverified.md', bytes: textBytes('x') }]);
    const central = oversized.readUInt32LE(oversized.length - 6);
    oversized.writeUInt32LE(MVP_INPUT_LIMITS.entryBytes + 1, central + 24);
    expect(violation(() => scanInputPackage(oversized))).toEqual({
      metric: 'ENTRY_BYTES',
      actual: 52428801,
      limit: 52428800,
    });
    for (const compressed of [0, 1]) {
      const ratio = zipBytes([{ name: 'unverified.md', bytes: textBytes('x') }]);
      const directory = ratio.readUInt32LE(ratio.length - 6);
      ratio.writeUInt32LE(compressed, directory + 20);
      ratio.writeUInt32LE(101, directory + 24);
      expect(violation(() => scanInputPackage(ratio))).toEqual({
        metric: 'EXPANSION_RATIO',
        expandedBytes: 101,
        compressedBytes: compressed,
        limit: 100,
      });
    }
  });

  it('retains input, accumulated expansion, memory and elapsed-time guards with details', () => {
    expect(violation(() => createScanBudget(104857601))).toEqual({
      metric: 'ZIP_BYTES',
      actual: 104857601,
      limit: 104857600,
    });
    const bytes = zipBytes([{ name: 'a.md', bytes: textBytes('x') }]);
    const expanded = createScanBudget(bytes.length);
    expanded.expanded = 524288000;
    expect(violation(() => parseZipContainer(bytes, expanded))).toEqual({
      metric: 'EXPANDED_BYTES',
      actual: 524288001,
      limit: 524288000,
    });
    const memory = createScanBudget(bytes.length);
    memory.retained = 536870912;
    expect(violation(() => parseZipContainer(bytes, memory))).toMatchObject({
      metric: 'MEMORY_BYTES',
      limit: 536870912,
    });
    const timed = createScanBudget(bytes.length);
    vi.spyOn(Date, 'now').mockReturnValue(timed.started + 120001);
    expect(violation(() => parseZipContainer(bytes, timed))).toEqual({
      metric: 'PROCESSING_TIME_MS',
      actual: 120001,
      limit: 120000,
    });
  });

  it('covers XML buffer, element/attribute metadata and time failures', () => {
    const expectation = { roots: [{ local: 'r', namespaces: [''] }] };
    for (const [xml, extra] of [
      ['<r/>', 0],
      ['<r/>', 4096],
      ['<r a="v"/>', 4104],
    ] as const) {
      const bytes = textBytes(xml);
      const budget = createScanBudget(bytes.length);
      budget.documentPath = '资料/document.docx';
      budget.retained =
        536870912 -
        134217728 -
        budget.transientReserve -
        4 * bytes.length -
        extra +
        (extra === 0 ? 1 : 0);
      expect(
        violation(() => {
          scanXml(bytes, budget, expectation, () => undefined);
        }),
      ).toMatchObject({
        metric: 'MEMORY_BYTES',
        documentPath: budget.documentPath,
      });
    }
    const bytes = textBytes('<r/>');
    const timed = createScanBudget(bytes.length);
    timed.documentPath = 'sheet.xlsx';
    vi.spyOn(Date, 'now').mockReturnValue(timed.started + 120001);
    expect(
      violation(() => {
        scanXml(bytes, timed, expectation, () => undefined);
      }),
    ).toEqual({
      metric: 'PROCESSING_TIME_MS',
      actual: 120001,
      limit: 120000,
      documentPath: 'sheet.xlsx',
    });
  });

  it('validates bounded closed details and fixed measurement limits', () => {
    const valid = [
      ...Object.entries(SCAN_LIMITS).map(([metric, limit]) => ({
        metric,
        actual: limit + 1,
        limit,
      })),
      { metric: 'EXPANSION_RATIO', expandedBytes: 101, compressedBytes: 1, limit: 100 },
      { metric: 'EXPANSION_RATIO', expandedBytes: 1, compressedBytes: 0, limit: 100 },
    ];
    for (const item of valid)
      for (const parse of [parseLimitViolation]) {
        expect(parse(item)).toEqual(item);
        for (const invalid of [
          { ...item, limit: 1 },
          { ...item, unknown: true },
          { ...item, documentPath: null },
          { ...item, documentPath: '../bad.docx' },
          { ...item, documentPath: 'x'.repeat(241) + '.docx' },
        ])
          expect(parse(invalid)).toBeUndefined();
      }
    for (const parse of [parseLimitViolation]) {
      for (const actual of [0, 1000, 1000.5, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
        expect(parse({ metric: 'OUTER_ENTRIES', actual, limit: 1000 })).toBeUndefined();
      expect(
        parse({
          metric: 'OFFICE_ENTRIES',
          actual: 20001,
          limit: 20000,
          documentPath: '资料/<b>.docx',
        }),
      ).toMatchObject({ documentPath: '资料/<b>.docx' });
      expect(
        parse({ metric: 'EXPANSION_RATIO', expandedBytes: 100, compressedBytes: 1, limit: 100 }),
      ).toBeUndefined();
      expect(
        parse({ metric: 'OUTER_ENTRIES', actual: 1001, limit: 1000, documentPath: 'x.docx' }),
      ).toBeUndefined();
    }
  });
});
