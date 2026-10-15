/* eslint-disable no-control-regex -- ZIP paths and XML must reject forbidden ASCII control characters. */
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

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

function validXml(value: string, expectedRoot: string): boolean {
  if (/<!DOCTYPE|<!ENTITY|[\x00-\x08\x0b\x0c\x0e-\x1f]/iu.test(value)) return false;
  if (/&(?!amp;|lt;|gt;|apos;|quot;|#\d+;|#x[0-9a-f]+;)/iu.test(value)) return false;
  const stack: string[] = [];
  let cursor = 0,
    roots = 0;
  const token =
    /<\?(?:[^?]|\?(?!>))*\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>/gu;
  for (const match of value.matchAll(token)) {
    const before = value.slice(cursor, match.index);
    if (before.includes('<') || (!stack.length && before.trim())) return false;
    const markup = match[0];
    cursor = match.index + markup.length;
    if (markup.startsWith('<?') || markup.startsWith('<!--') || markup.startsWith('<![')) continue;
    const name = /^<\/?([\w:.-]+)/u.exec(markup)?.[1];
    if (!name) return false;
    if (markup.startsWith('</')) {
      if (stack.pop() !== name) return false;
    } else {
      if (!stack.length) {
        roots++;
        if (name.split(':').at(-1) !== expectedRoot) return false;
      }
      if (!markup.endsWith('/>')) stack.push(name);
    }
  }
  return roots === 1 && stack.length === 0 && !value.slice(cursor).trim();
}

function rootNamespace(value: string, root: string, namespaces: readonly string[]): boolean {
  const match = new RegExp('<((?:[A-Za-z_][\\w.-]*:)?' + root + ')(?=[\\s>/])([^>]*)>', 'u').exec(
    value,
  );
  if (!match) return false;
  const name = match[1] ?? '',
    attributes = match[2] ?? '',
    prefix = name.includes(':') ? name.split(':')[0] : undefined;
  const declaration = new RegExp(
    '\\bxmlns' + (prefix ? ':' + prefix : '') + '\\s*=\\s*["\']([^"\']+)["\']',
    'u',
  ).exec(attributes)?.[1];
  return declaration !== undefined && namespaces.includes(declaration);
}

interface XmlElement {
  readonly depth: number;
  readonly localName: string;
  readonly namespace: string;
  readonly attributes: Readonly<Record<string, string>>;
}
function xmlElements(value: string): readonly XmlElement[] {
  const result: XmlElement[] = [],
    scopes: Readonly<Record<string, string>>[] = [];
  const tokens =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>/gu;
  const decode = (text: string) =>
    text.replace(/&(?:amp|lt|gt|apos|quot|#\d+|#x[0-9a-f]+);/giu, (entity) => {
      if (entity.startsWith('&#')) {
        const numeric = entity.startsWith('&#x')
          ? Number.parseInt(entity.slice(3, -1), 16)
          : Number.parseInt(entity.slice(2, -1), 10);
        if (
          (numeric < 32 && ![9, 10, 13].includes(numeric)) ||
          numeric > 0x10ffff ||
          (numeric >= 0xd800 && numeric <= 0xdfff)
        )
          fail('INTEGRATION_ZIP_CORRUPT');
        return String.fromCodePoint(numeric);
      }
      return (
        (
          { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&apos;': "'", '&quot;': '"' } as Record<
            string,
            string
          >
        )[entity] ?? entity
      );
    });
  for (const match of value.matchAll(tokens)) {
    const token = match[0];
    if (token.startsWith('<!') || token.startsWith('<?')) continue;
    if (token.startsWith('</')) {
      scopes.pop();
      continue;
    }
    const qualified = /^<([\w:.-]+)/u.exec(token)?.[1] ?? '',
      attributes: Record<string, string> = {},
      namespaces: Record<string, string> = { ...(scopes.at(-1) ?? {}) };
    for (const attribute of token.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(["'])(.*?)\2/gu)) {
      const name = attribute[1] ?? '';
      if (Object.hasOwn(attributes, name)) fail('INTEGRATION_ZIP_CORRUPT');
      const decoded = decode(attribute[3] ?? '');
      attributes[name] = decoded;
      if (name === 'xmlns') namespaces[''] = decoded;
      else if (name.startsWith('xmlns:')) namespaces[name.slice(6)] = decoded;
    }
    const colon = qualified.indexOf(':'),
      prefix = colon < 0 ? '' : qualified.slice(0, colon),
      localName = colon < 0 ? qualified : qualified.slice(colon + 1);
    result.push({
      localName,
      namespace: namespaces[prefix] ?? '',
      attributes,
      depth: scopes.length,
    });
    if (!token.endsWith('/>')) scopes.push(namespaces);
  }
  return result;
}
function hasMainDocumentOverride(value: string): boolean {
  const overrides = xmlElements(value).filter(
    (element) =>
      element.depth === 1 &&
      element.localName === 'Override' &&
      element.namespace === 'http://schemas.openxmlformats.org/package/2006/content-types' &&
      element.attributes.PartName === '/word/document.xml',
  );
  return (
    overrides.length === 1 &&
    overrides[0]?.attributes.ContentType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
  );
}
function hasInternalMainRelationship(value: string): boolean {
  const officeTypes = [
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
    'http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument',
  ];
  const main = xmlElements(value).filter(
    (element) =>
      element.depth === 1 &&
      element.localName === 'Relationship' &&
      element.namespace === 'http://schemas.openxmlformats.org/package/2006/relationships' &&
      officeTypes.includes(element.attributes.Type ?? ''),
  );
  const element = main[0];
  return (
    main.length === 1 &&
    element !== undefined &&
    (element.attributes.Target === 'word/document.xml' ||
      element.attributes.Target === '/word/document.xml') &&
    (element.attributes.TargetMode === undefined || element.attributes.TargetMode === 'Internal')
  );
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
          nested.some((e) => /vbaProject|\.bin$/iu.test(e.normalizedPath)) ||
          !hasMainDocumentOverride(text(types.bytes)) ||
          !validXml(text(types.bytes), 'Types') ||
          !validXml(text(doc.bytes), 'document') ||
          !rootNamespace(text(types.bytes), 'Types', [
            'http://schemas.openxmlformats.org/package/2006/content-types',
          ]) ||
          !rootNamespace(text(doc.bytes), 'document', [
            'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
            'http://purl.oclc.org/ooxml/wordprocessingml/main',
          ]) ||
          !validXml(text(relations.bytes), 'Relationships') ||
          !rootNamespace(text(relations.bytes), 'Relationships', [
            'http://schemas.openxmlformats.org/package/2006/relationships',
          ]) ||
          !hasInternalMainRelationship(text(relations.bytes))
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
