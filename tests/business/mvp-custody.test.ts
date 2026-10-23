import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import {
  createScanBudget,
  parseZipContainer,
} from '../../modules/document-delivery/src/custody/zip.js';

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

const spreadsheetNamespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function relatedSpreadsheetPart(kind: string, path: string, root: string) {
  const fixture = xlsxBytes();
  return [
    ...parseZipContainer(fixture, createScanBudget(fixture.length)).map((entry) => ({
      name: entry.originalName,
      bytes:
        entry.originalName === '[Content_Types].xml'
          ? textBytes(
              entry.bytes
                .toString()
                .replace(
                  '</Types>',
                  `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${kind}+xml"/></Types>`,
                ),
            )
          : entry.originalName === 'xl/_rels/workbook.xml.rels'
            ? textBytes(
                entry.bytes
                  .toString()
                  .replace(
                    '</Relationships>',
                    `<Relationship Id="rOptional" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${path.slice(3)}"/></Relationships>`,
                  ),
              )
            : entry.bytes,
    })),
    { name: path, bytes: textBytes(`<${root} xmlns="${spreadsheetNamespace}"/>`) },
  ];
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

  it('rejects symlinks, encryption and a valid high-ratio deflate package', () => {
    const original = zipBytes([{ name: 'link.md', bytes: markdownBytes() }]);
    const central = original.readUInt32LE(original.length - 6);
    const link = Buffer.from(original);
    link.writeUInt16LE(0x0314, central + 4);
    link.writeUInt32LE(0xa1ff0000, central + 38);
    expect(codeOf(() => scanInputPackage(link))).toBe('ZIP_UNSAFE');
    const encrypted = Buffer.from(original);
    encrypted.writeUInt16LE(1, 6);
    encrypted.writeUInt16LE(1, central + 8);
    expect(codeOf(() => scanInputPackage(encrypted))).toBe('ZIP_UNSAFE');

    const bytes = Buffer.alloc(65_536, 65);
    const stored = zipBytes([{ name: 'bomb.md', bytes }]);
    const compressed = deflateRawSync(bytes);
    const start = 30 + stored.readUInt16LE(26);
    const centralStart = stored.readUInt32LE(stored.length - 6);
    const local = Buffer.from(stored.subarray(0, start));
    const directory = Buffer.from(stored.subarray(centralStart, stored.length - 22));
    const end = Buffer.from(stored.subarray(stored.length - 22));
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    directory.writeUInt16LE(8, 10);
    directory.writeUInt32LE(compressed.length, 20);
    end.writeUInt32LE(local.length + compressed.length, 16);
    expect(codeOf(() => scanInputPackage(Buffer.concat([local, compressed, directory, end])))).toBe(
      'ZIP_LIMIT_EXCEEDED',
    );
  });

  it('charges nested OOXML entries against the one outer-package budget', () => {
    const docx = docxBytes();
    expect(scanInputPackage(zipBytes([{ name: 'one.docx', bytes: docx }])).entries[0]?.status).toBe(
      'ACCEPTED',
    );
    const many = zipBytes(
      Array.from({ length: 334 }, (_, index) => ({ name: `${index}.docx`, bytes: docx })),
    );
    expect(codeOf(() => scanInputPackage(many))).toBe('ZIP_LIMIT_EXCEEDED');
  });

  it('preserves XLSX shared strings, inline strings, empty sheets, zero and formulas without evaluation', () => {
    const entries = relatedSpreadsheetPart('sharedStrings', 'xl/sharedStrings.xml', 'sst');
    const sheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    for (const cells of [
      '',
      '<row><c r="A1"><v>0</v></c><c r="B1" t="inlineStr"><is><t>inline</t></is></c><c r="C1" t="s"><v>0</v></c><c r="D1"><f>1+1</f><v>2</v></c></row>',
    ]) {
      const workbook = zipBytes([
        ...entries.map((entry) => ({
          name: entry.name,
          bytes:
            entry.name === 'xl/worksheets/sheet1.xml'
              ? textBytes(`<worksheet xmlns="${sheet}"><sheetData>${cells}</sheetData></worksheet>`)
              : entry.name === 'xl/sharedStrings.xml'
                ? textBytes(`<sst xmlns="${sheet}"><si><t>shared</t></si></sst>`)
                : entry.bytes,
        })),
      ]);
      const result = scanInputPackage(zipBytes([{ name: 'cells.xlsx', bytes: workbook }]))
        .entries[0];
      expect(result?.status).toBe('ACCEPTED');
      expect(result?.content).toEqual(workbook);
    }
  });

  it.each([
    ['sharedStrings', 'sst', 'xl/sharedStrings.xml'],
    ['sharedStrings', 'sst', 'xl/custom/strings.xml'],
    ['styles', 'styleSheet', 'xl/styles.xml'],
    ['styles', 'styleSheet', 'xl/custom/style.xml'],
  ])('validates related XLSX %s XML at %s / %s', (kind, root, path) => {
    const baseline = relatedSpreadsheetPart(kind, path, root);
    const bytes = zipBytes(baseline);
    const valid = scanInputPackage(zipBytes([{ name: 'valid.xlsx', bytes }])).entries[0];
    expect(valid?.status).toBe('ACCEPTED');
    expect(valid?.content).toEqual(bytes);
    const defaultType = baseline.map((entry) =>
      entry.name === '[Content_Types].xml'
        ? {
            ...entry,
            bytes: textBytes(
              entry.bytes
                .toString()
                .replace(`Override PartName="/${path}"`, 'Default Extension="xml"'),
            ),
          }
        : entry,
    );
    const defaultBytes = zipBytes(defaultType);
    expect(
      scanInputPackage(zipBytes([{ name: 'default.xlsx', bytes: defaultBytes }])).entries[0],
    ).toMatchObject({ status: 'ACCEPTED', content: defaultBytes });
    const external = baseline.map((entry) =>
      entry.name === 'xl/_rels/workbook.xml.rels'
        ? {
            ...entry,
            bytes: textBytes(
              entry.bytes
                .toString()
                .replace(
                  `Target="${path.slice(3)}"`,
                  'Target="https://example.invalid/never-fetch.xml" TargetMode="External"',
                ),
            ),
          }
        : entry,
    );
    const limited = scanInputPackage(
      zipBytes([{ name: 'external.xlsx', bytes: zipBytes(external) }]),
    ).entries[0];
    expect(limited).toMatchObject({
      status: 'READ_LIMITED',
      reasonCodes: ['EXTERNAL_REFERENCE_REQUIRES_REVIEW'],
    });
    expect(limited?.content).toBeUndefined();
    const variants = [
      baseline.filter((entry) => entry.name !== path),
      ...[
        `<!DOCTYPE ${root} [<!ENTITY marker "harmless">]><${root} xmlns="${spreadsheetNamespace}"/>`,
        `<${root} xmlns="urn:forged"/>`,
        `<wrongRoot xmlns="${spreadsheetNamespace}"/>`,
      ].map((xml) =>
        baseline.map((entry) =>
          entry.name === path ? { ...entry, bytes: textBytes(xml) } : entry,
        ),
      ),
      baseline.map((entry) =>
        entry.name === '[Content_Types].xml'
          ? {
              ...entry,
              bytes: textBytes(
                entry.bytes
                  .toString()
                  .replace(`spreadsheetml.${kind}+xml`, 'spreadsheetml.worksheet+xml'),
              ),
            }
          : entry,
      ),
      baseline.map((entry) =>
        entry.name === 'xl/_rels/workbook.xml.rels'
          ? {
              ...entry,
              bytes: textBytes(
                entry.bytes
                  .toString()
                  .replace(`Target="${path.slice(3)}"`, 'Target="../../escape.xml"'),
              ),
            }
          : entry,
      ),
      baseline.map((entry) =>
        entry.name === 'xl/_rels/workbook.xml.rels'
          ? {
              ...entry,
              bytes: textBytes(
                entry.bytes
                  .toString()
                  .replace(
                    '</Relationships>',
                    `<Relationship Id="rDuplicate" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${path.slice(3)}"/></Relationships>`,
                  ),
              ),
            }
          : entry,
      ),
    ];
    for (const entries of variants) {
      const result = scanInputPackage(
        zipBytes([{ name: 'invalid.xlsx', bytes: zipBytes(entries) }]),
      ).entries[0];
      expect(result).toMatchObject({ status: 'CORRUPT', reasonCodes: ['INVALID_XLSX'] });
      expect(result?.content).toBeUndefined();
    }
  });

  it('rejects XLSX missing parts, duplicate relationship IDs, forged namespaces and XXE declarations', () => {
    const fixture = xlsxBytes();
    const entries = parseZipContainer(fixture, createScanBudget(fixture.length)).map((entry) => ({
      name: entry.originalName,
      bytes: entry.bytes,
    }));
    const variants = [
      entries.filter((entry) => entry.name !== 'xl/workbook.xml'),
      entries.filter((entry) => entry.name !== 'xl/worksheets/sheet1.xml'),
      entries.map((entry) =>
        entry.name === 'xl/_rels/workbook.xml.rels'
          ? {
              ...entry,
              bytes: textBytes(
                entry.bytes
                  .toString()
                  .replace(
                    '</Relationships>',
                    `${/<Relationship Id=.*?\/>/u.exec(entry.bytes.toString())?.[0] ?? ''}</Relationships>`,
                  ),
              ),
            }
          : entry,
      ),
      entries.map((entry) =>
        entry.name === 'xl/workbook.xml'
          ? {
              ...entry,
              bytes: textBytes(
                entry.bytes
                  .toString()
                  .replace(
                    'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
                    'urn:forged',
                  ),
              ),
            }
          : entry,
      ),
      entries.map((entry) =>
        entry.name === 'xl/workbook.xml'
          ? {
              ...entry,
              bytes: textBytes(
                entry.bytes
                  .toString()
                  .replace(
                    '?>',
                    '?><!DOCTYPE workbook [<!ENTITY xxe SYSTEM "file:///must-not-read">]>',
                  ),
              ),
            }
          : entry,
      ),
    ];
    for (const entries of variants) {
      const result = scanInputPackage(
        zipBytes([{ name: 'invalid.xlsx', bytes: zipBytes(entries) }]),
      ).entries[0];
      expect(result).toMatchObject({ status: 'CORRUPT', reasonCodes: ['INVALID_XLSX'] });
      expect(result?.content).toBeUndefined();
    }
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
