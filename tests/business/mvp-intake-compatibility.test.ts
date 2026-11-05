import fs from 'node:fs';
import filePromises from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { scanInputPackage } from '../../modules/document-delivery/src/custody/scan.js';
import {
  createScanBudget,
  parseZipContainer,
} from '../../modules/document-delivery/src/custody/zip.js';
import {
  appleDoubleBytes,
  docxBytes,
  templateDocxEntries,
  xlsxBytes,
  zipBytes,
  type ZipFixtureEntry,
} from '../persistence/mvp-fixtures.js';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const packageRel = 'http://schemas.openxmlformats.org/package/2006/relationships';

function scanDocument(parts: readonly ZipFixtureEntry[]) {
  return scanInputPackage(zipBytes([{ name: 'document.docx', bytes: zipBytes(parts) }])).entries[0];
}

function changePart(
  parts: readonly ZipFixtureEntry[],
  path: string,
  change: (xml: string) => string,
) {
  return parts.map((part) =>
    part.name === path ? { ...part, bytes: Buffer.from(change(part.bytes.toString())) } : part,
  );
}

describe('MVP01 @4 intake compatibility', () => {
  for (const options of [0, 2, 4, 6]) {
    for (const additions of [0, 8, 0x800, 0x808]) {
      it(`accepts Deflate options ${options} with flags ${additions} in outer and Office containers`, () => {
        const entries = [docxBytes(), xlsxBytes()].map((bytes, index) => {
          const parts = parseZipContainer(bytes, createScanBudget(bytes.length));
          return {
            name: index === 0 ? 'manual.docx' : 'records.xlsx',
            bytes: zipBytes(
              parts.map((part) => ({
                name: part.originalName,
                bytes: part.bytes,
                method: 8,
                flags: options | additions,
                descriptorSignature: false,
              })),
            ),
            method: 8 as const,
            flags: options | additions,
          };
        });
        const bytes = zipBytes(entries);
        const before = hash(bytes);
        const result = scanInputPackage(bytes);
        expect(result.entries.map((entry) => entry.status)).toEqual(['ACCEPTED', 'ACCEPTED']);
        for (const [index, entry] of result.entries.entries())
          expect(entry.content).toEqual(entries[index]?.bytes);
        expect(hash(bytes)).toBe(before);
      });
    }
  }

  it.each([1, 0x10, 0x20, 0x40, 0x80, 0x100, 0x200, 0x400, 0x1000, 0x2000, 0x4000, 0x8000])(
    'rejects unapproved flag %i even with valid Deflate options',
    (flag) => {
      expect(() =>
        scanInputPackage(
          zipBytes([{ name: 'readme.md', bytes: Buffer.from('text'), method: 8, flags: flag | 6 }]),
        ),
      ).toThrow('ZIP_UNSAFE');
    },
  );

  it.each([2, 4, 6])('rejects Deflate-only options %i on stored entries', (flags) => {
    expect(() =>
      scanInputPackage(zipBytes([{ name: 'readme.md', bytes: Buffer.from('text'), flags }])),
    ).toThrow('ZIP_UNSAFE');
  });

  it('preserves method, header, CRC and unsafe path checks for newly supported flags', () => {
    const make = () =>
      zipBytes([
        { name: 'readme.md', bytes: Buffer.from('safety checks remain'), method: 8, flags: 6 },
      ]);
    const unknown = make();
    const central = unknown.readUInt32LE(unknown.length - 6);
    unknown.writeUInt16LE(9, 8);
    unknown.writeUInt16LE(9, central + 10);
    expect(() => scanInputPackage(unknown)).toThrow('ZIP_UNSAFE');
    const mismatch = make();
    mismatch.writeUInt16LE(2, 6);
    expect(() => scanInputPackage(mismatch)).toThrow('ZIP_CORRUPT');
    const methodMismatch = make();
    methodMismatch.writeUInt16LE(0, 8);
    expect(() => scanInputPackage(methodMismatch)).toThrow('ZIP_CORRUPT');
    const crc = make();
    crc.writeUInt32LE(123, 14);
    crc.writeUInt32LE(123, central + 16);
    expect(() => scanInputPackage(crc)).toThrow('ZIP_CORRUPT');
    expect(() =>
      scanInputPackage(
        zipBytes([{ name: '../readme.md', bytes: Buffer.from('unsafe'), method: 8, flags: 6 }]),
      ),
    ).toThrow('ZIP_UNSAFE');
    expect(() =>
      scanInputPackage(
        zipBytes([{ name: 'bomb.md', bytes: Buffer.alloc(100000, 65), method: 8, flags: 6 }]),
      ),
    ).toThrow('ZIP_LIMIT_EXCEEDED');
  });

  it('retains matched macOS metadata as unsupported entries with exact identities', () => {
    const metadata = appleDoubleBytes();
    const dsStore = Buffer.from('000000014275643100000000', 'hex');
    const bytes = zipBytes([
      { name: 'manual.docx', bytes: docxBytes() },
      { name: '__MACOSX/._manual.docx', bytes: metadata },
      { name: 'docs/._readme.md', bytes: metadata },
      { name: 'docs/.DS_Store', bytes: dsStore },
    ]);
    const result = scanInputPackage(bytes);
    expect(result.entries.map((entry) => entry.ordinal)).toEqual([0, 1, 2, 3]);
    for (const entry of result.entries.slice(1)) {
      expect(entry).toMatchObject({
        status: 'UNSUPPORTED',
        reasonCodes: ['SYSTEM_METADATA_NOT_DOCUMENT'],
      });
      expect(entry.content).toBeUndefined();
      expect(entry.sha256).toBe(
        hash(entry.originalName.endsWith('.DS_Store') ? dsStore : metadata),
      );
    }
    expect(result.entries[0]?.status).toBe('ACCEPTED');
  });

  it('does not infer metadata from hidden names, paths or signatures alone', () => {
    const wrongVersion = appleDoubleBytes();
    wrongVersion.writeUInt32BE(0x00010000, 4);
    const result = scanInputPackage(
      zipBytes([
        { name: '__MACOSX/manual.docx', bytes: docxBytes() },
        { name: '._manual.docx', bytes: docxBytes() },
        { name: '.hidden.md', bytes: Buffer.from('ordinary markdown') },
        { name: '._wrong.docx', bytes: wrongVersion },
        { name: 'actual.docx', bytes: appleDoubleBytes() },
        { name: '.DS_Store', bytes: Buffer.from('not a store') },
      ]),
    );
    expect(result.entries.map((entry) => entry.status)).toEqual([
      'ACCEPTED',
      'ACCEPTED',
      'ACCEPTED',
      'CORRUPT',
      'CORRUPT',
      'UNSUPPORTED',
    ]);
    expect(
      result.entries.every((entry) => !entry.reasonCodes.includes('SYSTEM_METADATA_NOT_DOCUMENT')),
    ).toBe(true);
    expect(() =>
      scanInputPackage(zipBytes([{ name: '__MACOSX/._backup.zip', bytes: appleDoubleBytes() }])),
    ).toThrow('NESTED_ARCHIVE_NOT_ALLOWED');
    expect(() =>
      scanInputPackage(
        zipBytes([
          {
            name: '._manual.docx',
            bytes: zipBytes([{ name: 'readme.md', bytes: Buffer.from('archive') }]),
          },
        ]),
      ),
    ).toThrow('NESTED_ARCHIVE_NOT_ALLOWED');
    expect(() =>
      scanInputPackage(
        zipBytes(
          Array.from({ length: 1001 }, (_, i) => ({
            name: `._${i}.md`,
            bytes: appleDoubleBytes(),
          })),
        ),
      ),
    ).toThrow('ZIP_LIMIT_EXCEEDED');
  });

  it.each([
    { strict: false, prefix: 'r' },
    { strict: true, prefix: 'link' },
    { strict: false, prefix: 'relationship' },
  ])('accepts a structurally exact static template with %j', (options) => {
    const parts = templateDocxEntries(options);
    const bytes = zipBytes(parts);
    const result = scanInputPackage(zipBytes([{ name: 'document.docx', bytes }])).entries[0];
    expect(result).toMatchObject({
      status: 'ACCEPTED',
      reasonCodes: ['EXTERNAL_TEMPLATE_NOT_LOADED'],
      sha256: hash(bytes),
      byteLength: bytes.length,
    });
    expect(result?.content).toEqual(bytes);
  });

  const invalidTemplates: readonly [
    string,
    (parts: readonly ZipFixtureEntry[]) => readonly ZipFixtureEntry[],
  ][] = [
    ['missing settings', (parts) => parts.filter((part) => part.name !== 'word/settings.xml')],
    [
      'missing settings relationships',
      (parts) => parts.filter((part) => part.name !== 'word/_rels/settings.xml.rels'),
    ],
    [
      'missing document relationships',
      (parts) => parts.filter((part) => part.name !== 'word/_rels/document.xml.rels'),
    ],
    [
      'wrong settings content type',
      (parts) =>
        changePart(parts, '[Content_Types].xml', (xml) =>
          xml.replace('wordprocessingml.settings+xml', 'wordprocessingml.fake+xml'),
        ),
    ],
    [
      'wrong settings relationship type',
      (parts) =>
        changePart(parts, 'word/_rels/document.xml.rels', (xml) =>
          xml.replace(`${rel}/settings`, 'https://wrong.invalid/settings'),
        ),
    ],
    [
      'wrong settings target',
      (parts) =>
        changePart(parts, 'word/_rels/document.xml.rels', (xml) =>
          xml.replace('Target="settings.xml"', 'Target="different.xml"'),
        ),
    ],
    [
      'external settings part',
      (parts) =>
        changePart(parts, 'word/_rels/document.xml.rels', (xml) =>
          xml.replace('Target="settings.xml"', 'Target="settings.xml" TargetMode="External"'),
        ),
    ],
    [
      'duplicate settings relationship',
      (parts) =>
        changePart(parts, 'word/_rels/document.xml.rels', (xml) =>
          xml.replace(
            '</Relationships>',
            `<Relationship Id="other" Type="${rel}/settings" Target="settings.xml"/></Relationships>`,
          ),
        ),
    ],
    [
      'wrong root namespace',
      (parts) => changePart(parts, 'word/settings.xml', (xml) => xml.replace(word, 'urn:wrong')),
    ],
    [
      'wrong child namespace',
      (parts) =>
        changePart(parts, 'word/settings.xml', (xml) =>
          xml.replace('<w:attachedTemplate', '<w:attachedTemplate xmlns:w="urn:wrong"'),
        ),
    ],
    [
      'nested reference',
      (parts) =>
        changePart(parts, 'word/settings.xml', (xml) =>
          xml.replace(
            '<w:attachedTemplate r:id="template"/>',
            '<w:wrapper><w:attachedTemplate r:id="template"/></w:wrapper>',
          ),
        ),
    ],
    [
      'duplicate reference',
      (parts) =>
        changePart(parts, 'word/settings.xml', (xml) =>
          xml.replace('</w:settings>', '<w:attachedTemplate r:id="template"/></w:settings>'),
        ),
    ],
    [
      'missing reference',
      (parts) =>
        changePart(parts, 'word/settings.xml', (xml) =>
          xml.replace('<w:attachedTemplate r:id="template"/>', ''),
        ),
    ],
    [
      'wrong id',
      (parts) =>
        changePart(parts, 'word/settings.xml', (xml) =>
          xml.replace('r:id="template"', 'r:id="missing"'),
        ),
    ],
    [
      'unqualified id',
      (parts) => changePart(parts, 'word/settings.xml', (xml) => xml.replace('r:id=', 'id=')),
    ],
    [
      'wrong id namespace',
      (parts) => changePart(parts, 'word/settings.xml', (xml) => xml.replace(rel, 'urn:wrong')),
    ],
    [
      'wrong relationship namespace',
      (parts) =>
        changePart(parts, 'word/_rels/settings.xml.rels', (xml) =>
          xml.replace('<Relationship Id=', '<Relationship xmlns="urn:wrong" Id='),
        ),
    ],
    [
      'duplicate relationship id',
      (parts) =>
        changePart(parts, 'word/_rels/settings.xml.rels', (xml) =>
          xml.replace(
            '</Relationships>',
            `<Relationship Id="template" Type="${rel}/attachedTemplate" Target="https://other.invalid" TargetMode="External"/></Relationships>`,
          ),
        ),
    ],
    [
      'wrong template type',
      (parts) =>
        changePart(parts, 'word/_rels/settings.xml.rels', (xml) =>
          xml.replace(`${rel}/attachedTemplate`, 'https://wrong.invalid/attachedTemplate'),
        ),
    ],
    [
      'wrong target mode',
      (parts) =>
        changePart(parts, 'word/_rels/settings.xml.rels', (xml) =>
          xml.replace('TargetMode="External"', 'TargetMode="external"'),
        ),
    ],
    [
      'DTD',
      (parts) =>
        changePart(
          parts,
          'word/settings.xml',
          (xml) => `<!DOCTYPE w:settings [<!ENTITY x SYSTEM "file:///never-read">]>${xml}`,
        ),
    ],
  ];
  it.each(invalidTemplates)('does not grant the template exception for %s', (_name, change) => {
    expect(scanDocument(change(templateDocxEntries()))).toMatchObject({
      status: 'CORRUPT',
      reasonCodes: ['INVALID_DOCX'],
    });
  });

  it.each(['rels', 'RELS', 'ReLs'])(
    'keeps external header references restricted with the .%s extension',
    (extension) => {
      let parts = changePart(templateDocxEntries(), '[Content_Types].xml', (xml) =>
        xml.replace(
          '</Types>',
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>',
        ),
      );
      parts = changePart(
        parts,
        'word/document.xml',
        () =>
          `<w:document xmlns:w="${word}" xmlns:r="${rel}"><w:body><w:p/><w:sectPr><w:headerReference w:type="default" r:id="header"/></w:sectPr></w:body></w:document>`,
      );
      parts = changePart(parts, 'word/_rels/document.xml.rels', (xml) =>
        xml.replace(
          '</Relationships>',
          `<Relationship Id="header" Type="${rel}/header" Target="header1.xml"/></Relationships>`,
        ),
      );
      const result = scanDocument([
        ...parts,
        {
          name: 'word/header1.xml',
          bytes: Buffer.from(
            `<w:hdr xmlns:w="${word}" xmlns:r="${rel}"><w:p><w:hyperlink r:id="external"><w:r><w:t>External link</w:t></w:r></w:hyperlink></w:p></w:hdr>`,
          ),
        },
        {
          name: `word/_rels/header1.xml.${extension}`,
          bytes: Buffer.from(
            `<Relationships xmlns="${packageRel}"><Relationship Id="external" Type="${rel}/hyperlink" Target="https://never-read.invalid" TargetMode="External"/></Relationships>`,
          ),
        },
      ]);
      expect(result).toMatchObject({
        status: 'READ_LIMITED',
        reasonCodes: ['EXTERNAL_REFERENCE_REQUIRES_REVIEW'],
      });
      expect(result?.content).toBeUndefined();
    },
  );

  it('keeps mixed external references, embedded objects, macros and XLSX restricted', () => {
    const parts = templateDocxEntries();
    for (const kind of ['hyperlink', 'image', 'dataSource', 'unknown']) {
      const mixed = changePart(parts, 'word/_rels/document.xml.rels', (xml) =>
        xml.replace(
          '</Relationships>',
          `<Relationship Id="other" Type="${rel}/${kind}" Target="https://never-read.invalid" TargetMode="External"/></Relationships>`,
        ),
      );
      expect(scanDocument(mixed)).toMatchObject({
        status: 'READ_LIMITED',
        reasonCodes: ['EXTERNAL_REFERENCE_REQUIRES_REVIEW'],
      });
    }
    for (const name of [
      'word/embeddings/object.bin',
      'word/vbaProject.bin',
      'word/activeX/control.xml',
    ]) {
      expect(
        scanDocument([...parts, { name, bytes: Buffer.from('never executed') }]),
      ).toMatchObject({ status: 'UNSUPPORTED', reasonCodes: ['ACTIVE_CONTENT_NOT_SUPPORTED'] });
    }
    const spreadsheet = xlsxBytes();
    const sheetParts = parseZipContainer(spreadsheet, createScanBudget(spreadsheet.length));
    const xlsx = zipBytes([
      ...sheetParts.map((part) => ({ name: part.originalName, bytes: part.bytes })),
      {
        name: 'xl/_rels/settings.xml.rels',
        bytes: Buffer.from(
          `<Relationships xmlns="${packageRel}"><Relationship Id="template" Type="${rel}/attachedTemplate" Target="https://never-read.invalid" TargetMode="External"/></Relationships>`,
        ),
      },
    ]);
    expect(
      scanInputPackage(zipBytes([{ name: 'records.xlsx', bytes: xlsx }])).entries[0],
    ).toMatchObject({ status: 'READ_LIMITED' });
  });

  it('does not read filesystem or network targets while accepting static template bytes', () => {
    const samples = ['file:///private/never-read.dotm', 'https://127.0.0.1:1/never-read.dotm'].map(
      (target) =>
        zipBytes([{ name: 'document.docx', bytes: zipBytes(templateDocxEntries({ target })) }]),
    );
    const spies = [
      vi.spyOn(fs, 'readFileSync'),
      vi.spyOn(fs, 'readFile'),
      vi.spyOn(filePromises, 'readFile'),
      vi.spyOn(http, 'request'),
      vi.spyOn(http, 'get'),
      vi.spyOn(https, 'request'),
      vi.spyOn(https, 'get'),
      vi.spyOn(net, 'connect'),
      vi.spyOn(net, 'createConnection'),
      vi.spyOn(globalThis, 'fetch'),
    ];
    for (const spy of spies)
      spy.mockImplementation(() => {
        throw new Error('Scanner must not access template targets');
      });
    let results;
    let calls;
    try {
      results = samples.map((sample) => scanInputPackage(sample));
      calls = spies.map((spy) => spy.mock.calls.length);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    expect(calls).toEqual(spies.map(() => 0));
    expect(results.map((result) => result.entries[0]?.status)).toEqual(['ACCEPTED', 'ACCEPTED']);
  });
});
