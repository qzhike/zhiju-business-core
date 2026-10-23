import { describe, expect, it } from 'vitest';

import {
  ZipSafetyError,
  createCursorCodec,
  manifestHash,
  noteText,
  projectName,
  scanInputPackage,
  type InputManifest,
} from '../../modules/document-delivery/src/index.js';
import {
  docxBytes,
  macroDocxBytes,
  markdownBytes,
  textBytes,
  xlsxBytes,
  zipBytes,
} from '../persistence/mvp-fixtures.js';

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (error instanceof ZipSafetyError) return error.code;
    if (typeof error === 'object' && error !== null && 'code' in error)
      return typeof error.code === 'string' ? error.code : 'OTHER';
    return 'OTHER';
  }
}

describe('MVP01 custody safety', () => {
  it('admits DOCX, Markdown and XLSX and reports unsupported entries', () => {
    const packageBytes = zipBytes([
      { name: 'readme.md', bytes: markdownBytes() },
      { name: 'word.docx', bytes: docxBytes() },
      { name: 'sheet.xlsx', bytes: xlsxBytes() },
      { name: 'legacy.xls', bytes: textBytes('legacy') },
    ]);
    const scanned = scanInputPackage(packageBytes);
    expect(scanned.entries.map((entry) => [entry.originalName, entry.status])).toEqual([
      ['readme.md', 'ACCEPTED'],
      ['word.docx', 'ACCEPTED'],
      ['sheet.xlsx', 'ACCEPTED'],
      ['legacy.xls', 'UNSUPPORTED'],
    ]);
    for (const entry of scanned.entries.filter((item) => item.status === 'ACCEPTED'))
      expect(entry.content?.length).toBe(entry.byteLength);
  });

  it('marks invalid Markdown bytes as CORRUPT without hiding the entry', () => {
    const invalid = zipBytes([{ name: 'broken.md', bytes: Buffer.from([0xff, 0xfe, 0xfd]) }]);
    const scanned = scanInputPackage(invalid);
    expect(scanned.entries).toHaveLength(1);
    expect(scanned.entries[0]?.status).toBe('CORRUPT');
    expect(scanned.entries[0]?.reasonCodes).toEqual(['INVALID_UTF8']);
  });

  it('rejects macro/VBA content and malformed XLSX structure', () => {
    const vbaDocx = macroDocxBytes();
    expect(
      scanInputPackage(zipBytes([{ name: 'macro.docx', bytes: vbaDocx }])).entries[0],
    ).toMatchObject({ status: 'UNSUPPORTED', reasonCodes: ['ACTIVE_CONTENT_NOT_SUPPORTED'] });
    const brokenXlsx = zipBytes([
      { name: '[Content_Types].xml', bytes: textBytes('<Types/>') },
      { name: '_rels/.rels', bytes: textBytes('<Relationships/>') },
    ]);
    expect(
      scanInputPackage(zipBytes([{ name: 'bad.xlsx', bytes: brokenXlsx }])).entries[0],
    ).toMatchObject({ status: 'CORRUPT', reasonCodes: ['INVALID_XLSX'] });
  });

  it('marks external relationships READ_LIMITED and does not follow them', () => {
    const externalDocx = zipBytes([
      {
        name: '[Content_Types].xml',
        bytes: textBytes(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ),
      },
      {
        name: '_rels/.rels',
        bytes: textBytes(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        ),
      },
      {
        name: 'word/document.xml',
        bytes: textBytes(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
        ),
      },
      {
        name: 'word/_rels/document.xml.rels',
        bytes: textBytes(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/" TargetMode="External"/></Relationships>',
        ),
      },
    ]);
    expect(
      scanInputPackage(zipBytes([{ name: 'external.docx', bytes: externalDocx }])).entries[0],
    ).toMatchObject({
      status: 'READ_LIMITED',
      reasonCodes: ['EXTERNAL_REFERENCE_REQUIRES_REVIEW'],
    });
  });

  it('rejects traversal, absolute, duplicate-normalized and control paths', () => {
    const bad = [
      '../escape.md',
      '/absolute.md',
      'a\\\\b.md',
      'dir/./file.md',
      'dir/../file.md',
      'control\u0000.md',
    ];
    for (const name of bad) {
      expect(codeOf(() => scanInputPackage(zipBytes([{ name, bytes: markdownBytes() }])))).toBe(
        'ZIP_UNSAFE',
      );
    }
    const duplicate = zipBytes([
      { name: 'e\u0301.md', bytes: markdownBytes() },
      { name: '\u00e9.md', bytes: markdownBytes() },
    ]);
    expect(codeOf(() => scanInputPackage(duplicate))).toBe('ZIP_UNSAFE');
  });

  it('rejects a corrupt CRC and an unclosed archive', () => {
    const valid = zipBytes([{ name: 'crc.md', bytes: markdownBytes() }]);
    const corrupted = Buffer.from(valid);
    const index = corrupted.indexOf(Buffer.from('crc.md', 'utf8')) + 'crc.md'.length;
    corrupted[index] = (corrupted[index] ?? 0) ^ 0xff;
    expect(codeOf(() => scanInputPackage(corrupted))).toBe('ZIP_CORRUPT');
    expect(codeOf(() => scanInputPackage(valid.subarray(0, valid.length - 4)))).toBe('ZIP_CORRUPT');
  });
});

describe('MVP01 manifest and cursor domains', () => {
  it('hashes the manifest in its own domain, not the raw file domain', () => {
    const base = manifestBase();
    const hash = manifestHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(manifestHash({ ...base, note: 'changed' })).not.toBe(hash);
    expect(manifestHash({ ...base, manifestHash: hash })).toBe(hash);
  });

  it('rejects a cursor used for another owner or scope', () => {
    const codec = createCursorCodec(Buffer.alloc(32, 1));
    const scope = { endpoint: 'projects', ownerId: 'owner-a', authEpoch: 1 };
    const cursor = codec.encode({ ...scope, upper: 10, last: 4 });
    expect(codec.decode(cursor, scope)).toEqual({ upper: 10, last: 4 });
    expect(codeOf(() => codec.decode(cursor, { ...scope, ownerId: 'owner-b' }))).toBe(
      'CURSOR_INVALID',
    );
    expect(codeOf(() => codec.decode(cursor, { ...scope, authEpoch: 2 }))).toBe('CURSOR_INVALID');
    expect(codeOf(() => codec.decode(`${cursor}x`, scope))).toBe('CURSOR_INVALID');
  });

  it('applies visible name and note limits without trimming', () => {
    expect(projectName('  client  ')).toBe('  client  ');
    expect(codeOf(() => projectName(''))).toBe('INVALID_REQUEST');
    expect(codeOf(() => projectName('   '))).toBe('INVALID_REQUEST');
    expect(codeOf(() => projectName('a\u0000b'))).toBe('INVALID_REQUEST');
    expect(noteText('line\nnext')).toBe('line\nnext');
    expect(codeOf(() => noteText('bell\u0007'))).toBe('INVALID_REQUEST');
  });
});

function manifestBase(): Omit<InputManifest, 'manifestHash'> {
  return {
    manifestId: '00000000-0000-7000-8000-000000000001',
    schemaVersion: 'mvp.input_manifest@1',
    ownerId: '00000000-0000-7000-8000-000000000002',
    projectId: '00000000-0000-7000-8000-000000000003',
    batchId: '00000000-0000-7000-8000-000000000004',
    batchNo: 1,
    originalZip: {
      projectId: '00000000-0000-7000-8000-000000000003',
      batchId: '00000000-0000-7000-8000-000000000004',
      sourceId: '00000000-0000-7000-8000-000000000005',
      kind: 'ORIGINAL_ZIP',
      sha256: 'a'.repeat(64),
      byteLength: 10,
      mediaType: 'application/zip',
    },
    entries: [],
    policyVersion: 'mvp.zip-input@1',
    extractorVersion: 'mvp.input-extractor@1',
    createdAt: '2026-10-22T00:00:00.000Z',
  };
}
