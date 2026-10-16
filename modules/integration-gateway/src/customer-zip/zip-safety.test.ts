import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { scanCustomerZip, zipCrc32 } from './zip-safety.js';
function zip(
  entries: readonly {
    name: string;
    bytes: Buffer;
    mode?: number;
    compressed?: boolean;
    compressedTail?: Buffer;
  }[],
): Buffer {
  const locals: Buffer[] = [],
    directories: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      data = Buffer.concat([
        entry.compressed ? deflateRawSync(entry.bytes) : entry.bytes,
        entry.compressedTail ?? Buffer.alloc(0),
      ]),
      crc = zipCrc32(entry.bytes),
      local = Buffer.alloc(30),
      directory = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(entry.compressed ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE((3 << 8) | 20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(entry.compressed ? 8 : 0, 10);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(entry.bytes.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(((entry.mode ?? 0x8000) << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    directories.push(directory, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(directories),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const md = { name: '材料.md', bytes: Buffer.from('# 客户材料\n<script>untrusted</script>\n') };
const docxXml = {
  document:
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Customer text</w:t></w:r></w:p></w:body></w:document>',
  types:
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  relationships:
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
};
type DocxPart = keyof typeof docxXml;
function docx(overrides: Partial<Record<DocxPart, string>> = {}): Buffer {
  const parts = { ...docxXml, ...overrides };
  // Both the inner OOXML package and outer upload use real ZIP headers and CRCs.
  return zip([
    { name: '[Content_Types].xml', bytes: Buffer.from(parts.types) },
    { name: '_rels/.rels', bytes: Buffer.from(parts.relationships) },
    { name: 'word/document.xml', bytes: Buffer.from(parts.document) },
  ]);
}
const malformedXmlCases = (Object.keys(docxXml) as DocxPart[]).flatMap((part) => {
  const original = docxXml[part];
  const opening = original.slice(0, original.indexOf('>') + 1);
  const rootName =
    part === 'document' ? 'w:document' : part === 'types' ? 'Types' : 'Relationships';
  return [
    {
      label: `${part}: comment impersonates a namespace-valid root`,
      part,
      xml:
        `<!-- ${opening.replace(/>$/u, '/>')} -->` +
        original.replace(
          /xmlns(?::w)?="[^"]+"/u,
          part === 'document' ? 'xmlns:w="urn:wrong"' : 'xmlns="urn:wrong"',
        ),
    },
    ...([' ', '&#32;'] as const).map((padding) => ({
      label: `${part}: namespace URI padded with ${padding === ' ' ? 'literal' : 'numeric'} spaces`,
      part,
      xml: original.replace(/(xmlns(?::w)?=")([^"]+)(")/u, `$1${padding}$2${padding}$3`),
    })),
    {
      label: `${part}: duplicate attributes`,
      part,
      xml: original.replace('>', ' a="one" a="two">'),
    },
    {
      label: `${part}: duplicate expanded-name attributes with different prefixes`,
      part,
      xml: original.replace('>', ' xmlns:a="urn:x" xmlns:b="urn:x" a:k="1" b:k="2">'),
    },
    {
      label: `${part}: forbidden numeric character reference in text`,
      part,
      xml: original.replace('>', '>&#0;'),
    },
    {
      label: `${part}: DTD declaration`,
      part,
      xml: `<!DOCTYPE ${rootName}>` + original,
    },
    {
      label: `${part}: external entity declaration and reference`,
      part,
      xml:
        `<!DOCTYPE ${rootName} [<!ENTITY external SYSTEM "https://external.example.test/source">]>` +
        original.replace('>', '>&external;'),
    },
  ];
});
describe('real ZIP safety boundary', () => {
  it('preserves exact original Markdown and unsupported bytes with ordinal identities', () => {
    const result = scanCustomerZip(
      zip([md, { name: 'photo.png', bytes: Buffer.from([1, 2, 3]) }, mdWithName('second.md')]),
    );
    expect(result.map((e) => e.status)).toEqual(['ANALYZABLE', 'UNSUPPORTED', 'ANALYZABLE']);
    expect(result[0]?.bytes).toEqual(md.bytes);
    expect(result.map((e) => e.ordinal)).toEqual([0, 1, 2]);
  });
  it.each([
    '../escape.md',
    '/absolute.md',
    'C:/drive.md',
    'a\\escape.md',
    'a/../escape.md',
    'a\0.md',
  ])('rejects unsafe path %s before source acceptance', (name) => {
    expect(() => scanCustomerZip(zip([{ ...md, name }]))).toThrow('INTEGRATION_ZIP_UNSAFE');
  });
  it('rejects normalized collisions and symbolic links', () => {
    expect(() => scanCustomerZip(zip([md, md]))).toThrow('INTEGRATION_ZIP_UNSAFE');
    expect(() => scanCustomerZip(zip([{ ...md, mode: 0xa000 }]))).toThrow('INTEGRATION_ZIP_UNSAFE');
  });
  it('checks actual CRC even when both directories agree', () => {
    const bytes = zip([md]);
    bytes[30 + Buffer.byteLength(md.name)] = (bytes[30 + Buffer.byteLength(md.name)] ?? 0) ^ 1;
    expect(() => scanCustomerZip(bytes)).toThrow('INTEGRATION_ZIP_CORRUPT');
  });
  it('rejects padding after the actual deflate stream even when CRC and header lengths agree', () => {
    expect(() =>
      scanCustomerZip(zip([{ ...md, compressed: true, compressedTail: Buffer.alloc(16) }])),
    ).toThrow('INTEGRATION_ZIP_CORRUPT');
  });
  it('rejects extreme compression before inflating', () => {
    expect(() =>
      scanCustomerZip(
        zip([{ name: 'bomb.md', bytes: Buffer.alloc(100000, 65), compressed: true }]),
      ),
    ).toThrow('INTEGRATION_ZIP_LIMIT_EXCEEDED');
  });
  it('returns corrupt UTF8 and corrupt DOCX limitations alongside an analyzable entry', () => {
    const result = scanCustomerZip(
      zip([
        md,
        { name: 'bad.md', bytes: Buffer.from([0xff]) },
        { name: 'bad.docx', bytes: Buffer.from('not zip') },
      ]),
    );
    expect(result.map((e) => e.status)).toEqual(['ANALYZABLE', 'CORRUPT', 'CORRUPT']);
  });
  it('rejects zero analyzable entries', () => {
    expect(() => scanCustomerZip(zip([{ name: 'note.txt', bytes: Buffer.from('note') }]))).toThrow(
      'INTEGRATION_NO_ANALYZABLE_SOURCE',
    );
  });
  it.each([
    'COMMENT_ONLY_OVERRIDE',
    'SPLIT_EXTERNAL_RELATIONSHIP',
    'WRONG_OVERRIDE_NAMESPACE',
  ] as const)('rejects structurally misleading DOCX %s', (kind) => {
    const declaration =
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>';
    const types =
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      (kind === 'COMMENT_ONLY_OVERRIDE'
        ? '<!-- ' + declaration + ' -->'
        : kind === 'WRONG_OVERRIDE_NAMESPACE'
          ? declaration.replace('<Override', '<Override xmlns="https://untrusted.example.test"')
          : declaration) +
      '</Types>';
    const relationship =
      kind === 'SPLIT_EXTERNAL_RELATIONSHIP'
        ? '<Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="https://external.example.test/document.xml" TargetMode="External"/><Relationship Id="r2" Type="https://unrelated.example.test" Target="word/document.xml"/>'
        : '<Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>';
    const packageBytes = zip([
      { name: '[Content_Types].xml', bytes: Buffer.from(types) },
      {
        name: '_rels/.rels',
        bytes: Buffer.from(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            relationship +
            '</Relationships>',
        ),
      },
      {
        name: 'word/document.xml',
        bytes: Buffer.from(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
        ),
      },
    ]);
    const result = scanCustomerZip(zip([md, { name: 'fake.docx', bytes: packageBytes }]));
    expect(result[1]?.status).toBe('CORRUPT');
    expect(result[1]?.reasonCodes).toEqual(['INVALID_DOCX']);
  });
  it('accepts a genuine CRC-valid DOCX control and preserves its original bytes', () => {
    const bytes = docx();
    const result = scanCustomerZip(zip([{ name: 'customer.docx', bytes }]));
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('ANALYZABLE');
    expect(result[0]?.reasonCodes).toEqual([]);
    expect(result[0]?.bytes).toEqual(bytes);
  });
  it('ignores legal comments, CDATA and processing instructions when identifying XML roots', () => {
    const bytes = docx({
      document:
        '<?xml version="1.0"?><!-- <w:document xmlns:w="urn:wrong"/> -->' +
        '<?customer <w:document xmlns:w="urn:wrong"/> ?>' +
        docxXml.document.replace(
          'Customer text',
          '<![CDATA[<w:document xmlns:w="urn:wrong"/>]]> &amp; &#65;',
        ),
      types: '<!-- <Types xmlns="urn:wrong"/> --><?customer ignored?>' + docxXml.types,
      relationships:
        '<!-- <Relationships xmlns="urn:wrong"/> --><?customer ignored?>' + docxXml.relationships,
    });
    expect(scanCustomerZip(zip([{ name: 'customer.docx', bytes }]))[0]?.status).toBe('ANALYZABLE');
  });
  it.each(malformedXmlCases)('rejects a DOCX-only upload with XML $label', ({ part, xml }) => {
    const bytes = docx({ [part]: xml });
    expect(() => scanCustomerZip(zip([{ name: 'invalid.docx', bytes }]))).toThrow(
      'INTEGRATION_NO_ANALYZABLE_SOURCE',
    );
  });
  it.each(malformedXmlCases)(
    'retains valid Markdown alongside DOCX XML $label',
    ({ part, xml }) => {
      const bytes = docx({ [part]: xml });
      const result = scanCustomerZip(zip([md, { name: 'invalid.docx', bytes }]));
      expect(result.map((entry) => entry.status)).toEqual(['ANALYZABLE', 'CORRUPT']);
      expect(result[0]?.bytes).toEqual(md.bytes);
      expect(result[0]?.reasonCodes).toEqual([]);
      expect(result[1]?.bytes).toEqual(bytes);
      expect(result[1]?.reasonCodes).toEqual(['INVALID_DOCX']);
    },
  );
  it('charges live XML parser frames against the existing cumulative memory budget', () => {
    const depth = 80_000;
    // Use default namespace declarations to avoid prefixed-declaration ancestor scans.
    const attributes = Array.from({ length: 8 }, (_, index) => ` a${index}="value"`).join('');
    const opening =
      '<p xmlns="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' + attributes + '>';
    const document =
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      opening.repeat(depth) +
      '</p>'.repeat(depth) +
      '</w:document>';
    const bytes = docx({ document });
    expect(() => scanCustomerZip(zip([{ name: 'deep.docx', bytes }]))).toThrow(
      'INTEGRATION_ZIP_LIMIT_EXCEEDED',
    );
  });
  it('validates OOXML package bytes and cumulative nested budgets', () => {
    const docx = zip([
      {
        name: '[Content_Types].xml',
        bytes: Buffer.from(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ),
      },
      {
        name: '_rels/.rels',
        bytes: Buffer.from(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        ),
      },
      {
        name: 'word/document.xml',
        bytes: Buffer.from(
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:document>',
        ),
      },
    ]);
    expect(scanCustomerZip(zip([{ name: 'customer.docx', bytes: docx }]))[0]?.status).toBe(
      'ANALYZABLE',
    );
    const unsafe = zip([{ name: '../escape', bytes: Buffer.from('unsafe') }]);
    expect(() => scanCustomerZip(zip([md, { name: 'evil.docx', bytes: unsafe }]))).toThrow(
      'INTEGRATION_ZIP_UNSAFE',
    );
  });
});
function mdWithName(name: string) {
  return { ...md, name };
}
