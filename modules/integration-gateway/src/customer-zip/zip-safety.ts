/* eslint-disable no-control-regex -- ZIP paths and XML must reject forbidden ASCII control characters. */
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { SaxesParser } from 'saxes';

export class CustomerZipSafetyError extends Error {
  constructor(
    readonly code:
      | 'INTEGRATION_ZIP_UNSAFE'
      | 'INTEGRATION_ZIP_CORRUPT'
      | 'INTEGRATION_ZIP_LIMIT_EXCEEDED'
      | 'INTEGRATION_NO_ANALYZABLE_SOURCE',
  ) {
    super(code);
  }
}
export const ZIP_LIMITS = Object.freeze({
  zipBytes: 104857600,
  entries: 1000,
  totalExpandedBytes: 524288000,
  entryBytes: 52428800,
  expansionRatio: 100,
  pathBytes: 240,
  pathDepth: 16,
  wallClockMs: 120000,
  memoryBytes: 536870912,
});
export interface ScannedZipEntry {
  readonly ordinal: number;
  readonly originalName: string;
  readonly normalizedPath: string;
  readonly mediaType: string;
  readonly bytes: Buffer;
  readonly bytesSha256: string;
  readonly status: 'ANALYZABLE' | 'UNSUPPORTED' | 'CORRUPT' | 'READ_LIMITED';
  readonly reasonCodes: readonly string[];
}
function fail(code: CustomerZipSafetyError['code']): never {
  throw new CustomerZipSafetyError(code);
}
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function text(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    return fail('INTEGRATION_ZIP_CORRUPT');
  }
}
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
export function zipCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 255] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
interface Budget {
  entries: number;
  expanded: number;
  started: number;
  retained: number;
  transientReserve: number;
}
/** Strict ordinary ZIP parser. No filesystem paths or customer supplied locators are used. */
function unpack(bytes: Buffer, budget: Budget): ScannedZipEntry[] {
  if (bytes.length > ZIP_LIMITS.zipBytes) fail('INTEGRATION_ZIP_LIMIT_EXCEEDED');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  if (end < 0) fail('INTEGRATION_ZIP_CORRUPT');
  const count = bytes.readUInt16LE(end + 10),
    directorySize = bytes.readUInt32LE(end + 12),
    directoryStart = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0 ||
    bytes.readUInt16LE(end + 8) !== count ||
    count === 65535 ||
    directoryStart === 0xffffffff ||
    directoryStart + directorySize !== end
  )
    fail('INTEGRATION_ZIP_UNSAFE');
  budget.entries += count;
  if (budget.entries > ZIP_LIMITS.entries) fail('INTEGRATION_ZIP_LIMIT_EXCEEDED');
  let cursor = directoryStart;
  const paths = new Set<string>();
  const intervals: { start: number; end: number }[] = [];
  const result: ScannedZipEntry[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    if (Date.now() - budget.started > ZIP_LIMITS.wallClockMs)
      fail('INTEGRATION_ZIP_LIMIT_EXCEEDED');
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50)
      fail('INTEGRATION_ZIP_CORRUPT');
    const madeBy = bytes.readUInt16LE(cursor + 4),
      flags = bytes.readUInt16LE(cursor + 8),
      method = bytes.readUInt16LE(cursor + 10),
      crc = bytes.readUInt32LE(cursor + 16),
      compressed = bytes.readUInt32LE(cursor + 20),
      expanded = bytes.readUInt32LE(cursor + 24),
      nameLength = bytes.readUInt16LE(cursor + 28),
      extraLength = bytes.readUInt16LE(cursor + 30),
      commentLength = bytes.readUInt16LE(cursor + 32),
      disk = bytes.readUInt16LE(cursor + 34),
      attrs = bytes.readUInt32LE(cursor + 38),
      local = bytes.readUInt32LE(cursor + 42);
    if (
      cursor + 46 + nameLength + extraLength + commentLength > end ||
      disk !== 0 ||
      (flags & ~0x0808) !== 0 ||
      ![0, 8].includes(method) ||
      [compressed, expanded, local].includes(0xffffffff)
    )
      fail('INTEGRATION_ZIP_UNSAFE');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      originalName = text(nameBytes),
      normalizedPath = originalName.normalize('NFC');
    if (
      !originalName ||
      Buffer.byteLength(normalizedPath) > ZIP_LIMITS.pathBytes ||
      /[\x00-\x1f\x7f\\]/u.test(originalName) ||
      /^[/~]|^[A-Za-z]:/u.test(originalName) ||
      normalizedPath.split('/').filter(Boolean).length > ZIP_LIMITS.pathDepth ||
      normalizedPath.split('/').some((p) => p === '.' || p === '..') ||
      paths.has(normalizedPath)
    )
      fail('INTEGRATION_ZIP_UNSAFE');
    paths.add(normalizedPath);

    const unixType = (attrs >>> 16) & 0xf000,
      directory = originalName.endsWith('/');
    if (madeBy >>> 8 === 3 && unixType !== 0 && unixType !== (directory ? 0x4000 : 0x8000))
      fail('INTEGRATION_ZIP_UNSAFE');
    if (
      expanded > ZIP_LIMITS.entryBytes ||
      (compressed === 0 ? expanded !== 0 : expanded / compressed > ZIP_LIMITS.expansionRatio)
    )
      fail('INTEGRATION_ZIP_LIMIT_EXCEEDED');
    budget.expanded += expanded;
    budget.retained += expanded;
    // Reserve 128 MiB for the scanner runtime and two maximum-size entry buffers
    // for inflate/object-store readback before allocating any expanded bytes.
    // The larger original ZIP determines the reservation when needed.
    if (budget.retained + 134217728 + budget.transientReserve > ZIP_LIMITS.memoryBytes)
      fail('INTEGRATION_ZIP_LIMIT_EXCEEDED');
    if (budget.expanded > ZIP_LIMITS.totalExpandedBytes) fail('INTEGRATION_ZIP_LIMIT_EXCEEDED');
    if (
      local + 30 > directoryStart ||
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      bytes.readUInt16LE(local + 6) !== flags ||
      bytes.readUInt16LE(local + 8) !== method
    )
      fail('INTEGRATION_ZIP_CORRUPT');
    const localName = bytes.readUInt16LE(local + 26),
      localExtra = bytes.readUInt16LE(local + 28),
      start = local + 30 + localName + localExtra,
      finish = start + compressed;
    if (
      finish > directoryStart ||
      !bytes.subarray(local + 30, local + 30 + localName).equals(nameBytes)
    )
      fail('INTEGRATION_ZIP_CORRUPT');
    for (const [extraStart, extraEnd] of [
      [cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength],
      [
        local + 30 + bytes.readUInt16LE(local + 26),
        local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28),
      ],
    ] as const) {
      if (
        extraStart > extraEnd ||
        (extraEnd > directoryStart && extraStart < directoryStart) ||
        extraEnd > end
      )
        fail('INTEGRATION_ZIP_CORRUPT');
      let field = extraStart;
      while (field < extraEnd) {
        if (field + 4 > extraEnd) fail('INTEGRATION_ZIP_CORRUPT');
        const kind = bytes.readUInt16LE(field),
          size = bytes.readUInt16LE(field + 2);
        if (field + 4 + size > extraEnd) fail('INTEGRATION_ZIP_CORRUPT');
        if ([0x0001, 0x000d, 0x756e].includes(kind)) fail('INTEGRATION_ZIP_UNSAFE');
        field += 4 + size;
      }
    }
    if (
      (flags & 8) === 0 &&
      (bytes.readUInt32LE(local + 14) !== crc ||
        bytes.readUInt32LE(local + 18) !== compressed ||
        bytes.readUInt32LE(local + 22) !== expanded)
    )
      fail('INTEGRATION_ZIP_CORRUPT');
    let physicalEnd = finish;
    if (flags & 8) {
      let descriptor = finish;
      if (descriptor + 4 <= directoryStart && bytes.readUInt32LE(descriptor) === 0x08074b50)
        descriptor += 4;
      if (
        descriptor + 12 > directoryStart ||
        bytes.readUInt32LE(descriptor) !== crc ||
        bytes.readUInt32LE(descriptor + 4) !== compressed ||
        bytes.readUInt32LE(descriptor + 8) !== expanded
      )
        fail('INTEGRATION_ZIP_CORRUPT');
      physicalEnd = descriptor + 12;
    }
    if (intervals.some((i) => local < i.end && physicalEnd > i.start))
      fail('INTEGRATION_ZIP_UNSAFE');
    intervals.push({ start: local, end: physicalEnd });
    let content: Buffer;
    try {
      if (method === 0) content = Buffer.from(bytes.subarray(start, finish));
      else {
        // Node documents info=true as {buffer,engine}; its declaration still says Buffer.
        const inflated = inflateRawSync(bytes.subarray(start, finish), {
          info: true,
          maxOutputLength: Math.min(ZIP_LIMITS.entryBytes, expanded + 1),
        }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
        if (inflated.engine.bytesWritten !== compressed) fail('INTEGRATION_ZIP_CORRUPT');
        content = inflated.buffer;
      }
    } catch {
      fail('INTEGRATION_ZIP_CORRUPT');
    }
    if (
      content.length !== expanded ||
      zipCrc32(content) !== crc ||
      (directory && content.length !== 0)
    )
      fail('INTEGRATION_ZIP_CORRUPT');
    if (!directory)
      result.push({
        ordinal,
        originalName,
        normalizedPath,
        mediaType: 'application/octet-stream',
        bytes: content,
        bytesSha256: createHash('sha256').update(content).digest('hex'),
        status: 'UNSUPPORTED',
        reasonCodes: ['UNSUPPORTED_MEDIA_TYPE'],
      });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) fail('INTEGRATION_ZIP_CORRUPT');
  intervals.sort((a, b) => a.start - b.start);
  let physical = 0;
  for (const interval of intervals) {
    if (interval.start !== physical) fail('INTEGRATION_ZIP_CORRUPT');
    physical = interval.end;
  }
  if (physical !== directoryStart) fail('INTEGRATION_ZIP_CORRUPT');
  return result;
}

const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOCUMENT_TYPES = [
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
];
interface DocxXml {
  mainOverrides: number;
  mainDocumentType: boolean;
  mainRelationships: number;
  internalMainRelationship: boolean;
}

/** Validate the complete XML stream; only actual root/direct-child events are evidence. */
function parseDocxXml(
  bytes: Buffer,
  expectedRoot: string,
  namespaces: readonly string[],
  budget: Budget,
): DocxXml {
  // Reserve decoded UTF-16 plus parser token buffers before decoding any XML.
  const xmlBuffers = 4 * bytes.length;
  let metadata = 0;
  const frames: number[] = [];
  const checkMemory = () => {
    if (
      budget.retained + 134217728 + budget.transientReserve + xmlBuffers + metadata >
      ZIP_LIMITS.memoryBytes
    )
      fail('INTEGRATION_ZIP_LIMIT_EXCEEDED');
  };
  checkMemory();
  const value = text(bytes);
  const result: DocxXml = {
    mainOverrides: 0,
    mainDocumentType: false,
    mainRelationships: 0,
    internalMainRelationship: false,
  };
  const parser = new SaxesParser({ xmlns: true, defaultXMLVersion: '1.0', forceXMLVersion: true });
  let depth = 0;
  parser.on('doctype', () => fail('INTEGRATION_ZIP_CORRUPT'));
  parser.on('error', () => fail('INTEGRATION_ZIP_CORRUPT'));
  // Conservative live-frame/attribute reservations bound the SAX stack as well as bytes.
  parser.on('opentagstart', (tag) => {
    const size = 4096 + 8 * tag.name.length;
    frames.push(size);
    metadata += size;
    checkMemory();
  });
  parser.on('attribute', (attribute) => {
    // Saxes trims namespace bindings; an altered URI must not become an exact OOXML match.
    if (
      (attribute.name === 'xmlns' || attribute.prefix === 'xmlns') &&
      (/[\t\n\r ]/u.test(attribute.value) || attribute.value !== attribute.value.trim())
    )
      fail('INTEGRATION_ZIP_CORRUPT');
    const size = 1024 + 8 * (attribute.name.length + attribute.value.length);
    const current = frames.length - 1;
    frames[current] = (frames[current] ?? 0) + size;
    metadata += size;
    checkMemory();
  });
  parser.on('opentag', (tag) => {
    if (depth === 0 && (tag.local !== expectedRoot || !namespaces.includes(tag.uri)))
      fail('INTEGRATION_ZIP_CORRUPT');
    const attribute = (name: string) => {
      const item = tag.attributes[name];
      return item?.uri === '' ? item.value : undefined;
    };
    if (
      depth === 1 &&
      tag.uri === CONTENT_TYPES_NAMESPACE &&
      tag.local === 'Override' &&
      attribute('PartName') === '/word/document.xml'
    ) {
      result.mainOverrides++;
      result.mainDocumentType =
        attribute('ContentType') ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
    }
    if (
      depth === 1 &&
      tag.uri === RELATIONSHIPS_NAMESPACE &&
      tag.local === 'Relationship' &&
      OFFICE_DOCUMENT_TYPES.includes(attribute('Type') ?? '')
    ) {
      result.mainRelationships++;
      result.internalMainRelationship =
        ['word/document.xml', '/word/document.xml'].includes(attribute('Target') ?? '') &&
        (attribute('TargetMode') === undefined || attribute('TargetMode') === 'Internal');
    }
    depth++;
  });
  parser.on('closetag', () => {
    depth--;
    metadata -= frames.pop() ?? 0;
  });
  // Keep parsing incremental, retain no DOM/text nodes, and charge the same ZIP wall-clock budget.
  for (let cursor = 0; cursor < value.length; cursor += 16384) {
    if (Date.now() - budget.started > ZIP_LIMITS.wallClockMs)
      fail('INTEGRATION_ZIP_LIMIT_EXCEEDED');
    parser.write(value.slice(cursor, cursor + 16384));
  }
  parser.close();
  return result;
}

export function scanCustomerZip(bytes: Buffer): readonly ScannedZipEntry[] {
  const budget: Budget = {
    entries: 0,
    expanded: 0,
    started: Date.now(),
    retained: bytes.length,
    transientReserve: 2 * Math.max(bytes.length, ZIP_LIMITS.entryBytes),
  };
  const entries = unpack(bytes, budget).map((entry) => {
    if (/\.md$/iu.test(entry.originalName)) {
      try {
        text(entry.bytes);
        return {
          ...entry,
          mediaType: 'text/markdown',
          status: 'ANALYZABLE' as const,
          reasonCodes: [],
        };
      } catch {
        return { ...entry, status: 'CORRUPT' as const, reasonCodes: ['INVALID_UTF8'] };
      }
    }
    if (/\.docx$/iu.test(entry.originalName)) {
      try {
        const nested = unpack(entry.bytes, budget);
        const names = new Map(nested.map((e) => [e.normalizedPath, e]));
        const types = names.get('[Content_Types].xml'),
          doc = names.get('word/document.xml'),
          relations = names.get('_rels/.rels');
        if (
          !types ||
          !doc ||
          !relations ||
          nested.some((e) => /vbaProject|\.bin$/iu.test(e.normalizedPath))
        )
          return { ...entry, status: 'CORRUPT' as const, reasonCodes: ['INVALID_DOCX'] };
        const contentTypes = parseDocxXml(types.bytes, 'Types', [CONTENT_TYPES_NAMESPACE], budget);
        parseDocxXml(
          doc.bytes,
          'document',
          [
            'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
            'http://purl.oclc.org/ooxml/wordprocessingml/main',
          ],
          budget,
        );
        const relationships = parseDocxXml(
          relations.bytes,
          'Relationships',
          [RELATIONSHIPS_NAMESPACE],
          budget,
        );
        if (
          contentTypes.mainOverrides !== 1 ||
          !contentTypes.mainDocumentType ||
          relationships.mainRelationships !== 1 ||
          !relationships.internalMainRelationship
        )
          return { ...entry, status: 'CORRUPT' as const, reasonCodes: ['INVALID_DOCX'] };
        return {
          ...entry,
          mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          status: 'ANALYZABLE' as const,
          reasonCodes: [],
        };
      } catch (error) {
        if (error instanceof CustomerZipSafetyError && error.code !== 'INTEGRATION_ZIP_CORRUPT')
          throw error;
        return { ...entry, status: 'CORRUPT' as const, reasonCodes: ['INVALID_DOCX'] };
      }
    }
    return entry;
  });
  if (!entries.some((e) => e.status === 'ANALYZABLE')) fail('INTEGRATION_NO_ANALYZABLE_SOURCE');
  return entries;
}
