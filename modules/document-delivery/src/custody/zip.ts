/* eslint-disable no-control-regex -- ZIP paths must reject forbidden ASCII control characters. */
import { inflateRawSync } from 'node:zlib';

import { MVP_INPUT_LIMITS } from '../domain/policy.js';
import { SCAN_LIMITS, type ScanMetric, type LimitViolation } from '../domain/limit-violation.js';

/**
 * Strict ordinary ZIP container parser for MVP01. It never touches the
 * filesystem and never trusts a central-directory locator: every offset is
 * checked against the actual bytes, entries must tile the archive exactly, and
 * the cumulative budget is shared with nested DOCX/XLSX packages.
 */
export type ZipFailure = 'ZIP_UNSAFE' | 'ZIP_CORRUPT' | 'ZIP_LIMIT_EXCEEDED';

export class ZipSafetyError extends Error {
  readonly code: ZipFailure;

  readonly limitViolation?: LimitViolation;

  constructor(code: 'ZIP_LIMIT_EXCEEDED', detail: LimitViolation);
  constructor(code: Exclude<ZipFailure, 'ZIP_LIMIT_EXCEEDED'>);
  constructor(code: ZipFailure, detail?: LimitViolation) {
    super(code);
    this.name = 'ZipSafetyError';
    this.code = code;
    if (detail !== undefined) this.limitViolation = detail;
  }
}

export interface ScanBudget {
  /** Optional stricter limits for a bounded consumer; admission limits cannot be raised. */
  limits?: Partial<Record<ScanMetric, number>>;
  outerEntries: number;
  officeEntries: number;
  documentPath?: string;
  expanded: number;
  retained: number;
  transientReserve: number;
  started: number;
}

export interface ZipEntry {
  readonly ordinal: number;
  readonly originalName: string;
  readonly normalizedPath: string;
  readonly directory: boolean;
  readonly bytes: Buffer;
}

export function createScanBudget(originalBytes: number): ScanBudget {
  checkScanLimit('ZIP_BYTES', originalBytes);
  return {
    outerEntries: 0,
    officeEntries: 0,
    expanded: 0,
    retained: originalBytes,
    transientReserve: 2 * Math.max(originalBytes, MVP_INPUT_LIMITS.entryBytes),
    started: Date.now(),
  };
}

function fail(code: Exclude<ZipFailure, 'ZIP_LIMIT_EXCEEDED'>): never {
  throw new ZipSafetyError(code);
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
function text(bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    return fail('ZIP_CORRUPT');
  }
}

export function checkScanLimit(metric: ScanMetric, actual: number, budget?: ScanBudget): void {
  const limit = Math.min(SCAN_LIMITS[metric], budget?.limits?.[metric] ?? SCAN_LIMITS[metric]);
  if (actual > limit)
    throw new ZipSafetyError('ZIP_LIMIT_EXCEEDED', {
      metric,
      actual,
      limit,
      ...(budget?.documentPath === undefined ? {} : { documentPath: budget.documentPath }),
    });
}

export function checkScanMemory(budget: ScanBudget, extra = 0): void {
  // Reserve 128 MiB for the scanner runtime plus two maximum-size buffers.
  checkScanLimit(
    'MEMORY_BYTES',
    budget.retained + 134217728 + budget.transientReserve + extra,
    budget,
  );
}

export function checkScanTime(budget: ScanBudget): void {
  checkScanLimit('PROCESSING_TIME_MS', Date.now() - budget.started, budget);
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

interface CentralEntry {
  readonly ordinal: number;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly compressed: number;
  readonly expanded: number;
  readonly nameBytes: Buffer;
  readonly name: string;
  readonly path: string;
  readonly local: number;
  readonly directory: boolean;
}

/** Parse one complete ZIP archive and return every ordinary file entry. */
export function parseZipContainer(
  bytes: Buffer,
  budget: ScanBudget,
  kind: 'OUTER' | 'OFFICE' = 'OUTER',
): ZipEntry[] {
  checkScanLimit('ZIP_BYTES', bytes.length, budget);
  if (bytes.length < 22) fail('ZIP_CORRUPT');
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (
      bytes.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + bytes.readUInt16LE(i + 20) === bytes.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) fail('ZIP_CORRUPT');
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryStart = bytes.readUInt32LE(end + 16);
  if (
    bytes.readUInt16LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 6) !== 0 ||
    bytes.readUInt16LE(end + 8) !== count ||
    count === 65535 ||
    directoryStart === 0xffffffff ||
    directoryStart + directorySize !== end
  )
    fail('ZIP_UNSAFE');
  if (kind === 'OUTER') {
    budget.outerEntries += count;
    checkScanLimit('OUTER_ENTRIES', budget.outerEntries, budget);
  } else {
    budget.officeEntries += count;
    checkScanLimit('OFFICE_DOCUMENT_ENTRIES', count, budget);
    checkScanLimit('OFFICE_ENTRIES', budget.officeEntries, budget);
  }

  let cursor = directoryStart;
  const paths = new Set<string>();
  const intervals: { start: number; end: number }[] = [];
  const central: CentralEntry[] = [];
  for (let ordinal = 0; ordinal < count; ordinal++) {
    checkScanTime(budget);
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) fail('ZIP_CORRUPT');
    const madeBy = bytes.readUInt16LE(cursor + 4);
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const expanded = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const disk = bytes.readUInt16LE(cursor + 34);
    const attrs = bytes.readUInt32LE(cursor + 38);
    const local = bytes.readUInt32LE(cursor + 42);
    if (
      cursor + 46 + nameLength + extraLength + commentLength > end ||
      disk !== 0 ||
      (flags & ~(method === 8 ? 0x080e : 0x0808)) !== 0 ||
      ![0, 8].includes(method) ||
      [compressed, expanded, local].includes(0xffffffff)
    )
      fail('ZIP_UNSAFE');
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const originalName = text(nameBytes);
    const normalizedPath = originalName.normalize('NFC');
    if (
      !originalName ||
      Buffer.byteLength(originalName) > MVP_INPUT_LIMITS.pathBytes ||
      Buffer.byteLength(normalizedPath) > MVP_INPUT_LIMITS.pathBytes ||
      /[\x00-\x1f\x7f\\]/u.test(originalName) ||
      /^[/~]|^[A-Za-z]:/u.test(originalName) ||
      normalizedPath.split('/').filter(Boolean).length > MVP_INPUT_LIMITS.pathDepth ||
      normalizedPath.split('/').some((part) => part === '.' || part === '..') ||
      paths.has(normalizedPath)
    )
      fail('ZIP_UNSAFE');
    paths.add(normalizedPath);

    const unixType = (attrs >>> 16) & 0xf000;
    const directory = originalName.endsWith('/');
    if (madeBy >>> 8 === 3 && unixType !== 0 && unixType !== (directory ? 0x4000 : 0x8000))
      fail('ZIP_UNSAFE');
    checkScanLimit('ENTRY_BYTES', expanded, budget);
    if (expanded > compressed * MVP_INPUT_LIMITS.expansionRatio) {
      throw new ZipSafetyError('ZIP_LIMIT_EXCEEDED', {
        metric: 'EXPANSION_RATIO',
        expandedBytes: expanded,
        compressedBytes: compressed,
        limit: 100,
        ...(budget.documentPath === undefined ? {} : { documentPath: budget.documentPath }),
      });
    }
    budget.expanded += expanded;
    budget.retained += expanded;
    checkScanMemory(budget);
    checkScanLimit('EXPANDED_BYTES', budget.expanded, budget);
    if (
      local + 30 > directoryStart ||
      bytes.readUInt32LE(local) !== 0x04034b50 ||
      bytes.readUInt16LE(local + 6) !== flags ||
      bytes.readUInt16LE(local + 8) !== method
    )
      fail('ZIP_CORRUPT');
    const localName = bytes.readUInt16LE(local + 26);
    const localExtra = bytes.readUInt16LE(local + 28);
    const start = local + 30 + localName + localExtra;
    const finish = start + compressed;
    if (
      finish > directoryStart ||
      !bytes.subarray(local + 30, local + 30 + localName).equals(nameBytes)
    )
      fail('ZIP_CORRUPT');
    for (const [extraStart, extraEnd] of [
      [cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength],
      [local + 30 + localName, local + 30 + localName + localExtra],
    ] as const) {
      if (
        extraStart > extraEnd ||
        (extraEnd > directoryStart && extraStart < directoryStart) ||
        extraEnd > end
      )
        fail('ZIP_CORRUPT');
      let field = extraStart;
      while (field < extraEnd) {
        if (field + 4 > extraEnd) fail('ZIP_CORRUPT');
        const kind = bytes.readUInt16LE(field);
        const size = bytes.readUInt16LE(field + 2);
        if (field + 4 + size > extraEnd) fail('ZIP_CORRUPT');
        if ([0x0001, 0x000d, 0x756e].includes(kind)) fail('ZIP_UNSAFE');
        field += 4 + size;
      }
    }
    if (
      (flags & 8) === 0 &&
      (bytes.readUInt32LE(local + 14) !== crc ||
        bytes.readUInt32LE(local + 18) !== compressed ||
        bytes.readUInt32LE(local + 22) !== expanded)
    )
      fail('ZIP_CORRUPT');
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
        fail('ZIP_CORRUPT');
      physicalEnd = descriptor + 12;
    }
    if (intervals.some((interval) => local < interval.end && physicalEnd > interval.start))
      fail('ZIP_UNSAFE');
    intervals.push({ start: local, end: physicalEnd });
    central.push({
      ordinal,
      flags,
      method,
      crc,
      compressed,
      expanded,
      nameBytes,
      name: originalName,
      path: normalizedPath,
      local,
      directory,
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) fail('ZIP_CORRUPT');
  intervals.sort((left, right) => left.start - right.start);
  let physical = 0;
  for (const interval of intervals) {
    if (interval.start !== physical) fail('ZIP_CORRUPT');
    physical = interval.end;
  }
  if (physical !== directoryStart) fail('ZIP_CORRUPT');

  const entries: ZipEntry[] = [];
  for (const entry of central) {
    checkScanTime(budget);
    const nameLength = entry.nameBytes.length;
    const localExtra = bytes.readUInt16LE(entry.local + 28);
    const start = entry.local + 30 + nameLength + localExtra;
    const finish = start + entry.compressed;
    let content: Buffer;
    try {
      if (entry.method === 0) content = Buffer.from(bytes.subarray(start, finish));
      else {
        const inflated = inflateRawSync(bytes.subarray(start, finish), {
          info: true,
          maxOutputLength: Math.min(MVP_INPUT_LIMITS.entryBytes, entry.expanded + 1),
        }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
        if (inflated.engine.bytesWritten !== entry.compressed) fail('ZIP_CORRUPT');
        content = inflated.buffer;
      }
    } catch {
      fail('ZIP_CORRUPT');
    }
    checkScanMemory(budget, content.length);
    if (
      content.length !== entry.expanded ||
      zipCrc32(content) !== entry.crc ||
      (entry.directory && content.length !== 0)
    )
      fail('ZIP_CORRUPT');
    entries.push({
      ordinal: entry.ordinal,
      originalName: entry.name,
      normalizedPath: entry.path,
      directory: entry.directory,
      bytes: content,
    });
  }
  return entries;
}
