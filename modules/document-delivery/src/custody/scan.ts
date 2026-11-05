import type { EntryStatus, ReasonCode } from '../domain/types.js';
import { classifyEntry, entryMetadata } from './formats.js';
import { isArchiveFile, NestedArchiveError } from './archives.js';
import { createScanBudget, parseZipContainer, ZipSafetyError } from './zip.js';

export interface ScannedEntry {
  readonly ordinal: number;
  readonly originalName: string;
  readonly normalizedPath: string;
  readonly status: EntryStatus;
  readonly reasonCodes: readonly ReasonCode[];
  readonly mediaType?: string;
  readonly byteLength: number;
  readonly sha256: string;
  /** Present only for ACCEPTED entries, which are admitted into custody. */
  readonly content?: Buffer;
}

export interface ScannedPackage {
  readonly entries: readonly ScannedEntry[];
}

/**
 * Scan one complete outer ZIP. Package safety/integrity/global-budget failures
 * reject the whole package and produce no manifest; a valid archive still
 * yields one result for every ordinary file, including unsupported, corrupt
 * and read-limited entries.
 */
export function scanInputPackage(bytes: Buffer): ScannedPackage {
  const budget = createScanBudget(bytes.length);
  const container = parseZipContainer(bytes, budget);
  const entries: ScannedEntry[] = [];
  const rejectedPaths: string[] = [];
  for (const entry of container) {
    if (entry.directory) continue;
    if (isArchiveFile(entry.originalName, entry.bytes)) {
      rejectedPaths.push(entry.originalName);
      continue;
    }
    const metadata = entryMetadata(entry.bytes);
    let classified;
    if (/\.(?:docx|xlsx)$/iu.test(entry.originalName)) budget.documentPath = entry.originalName;
    try {
      classified = classifyEntry(entry.originalName, entry.bytes, budget);
    } catch (error) {
      if (error instanceof ZipSafetyError) throw error;
      if (error instanceof NestedArchiveError) {
        rejectedPaths.push(entry.originalName);
        continue;
      }
      classified = {
        status: 'CORRUPT' as const,
        reasonCodes: ['EXTRACTION_FAILED'] as const satisfies readonly ReasonCode[],
      };
    } finally {
      delete budget.documentPath;
    }
    entries.push({
      ordinal: entry.ordinal,
      originalName: entry.originalName,
      normalizedPath: entry.normalizedPath,
      status: classified.status,
      reasonCodes: classified.reasonCodes,
      ...(classified.mediaType === undefined ? {} : { mediaType: classified.mediaType }),
      byteLength: metadata.byteLength,
      sha256: metadata.sha256,
      ...(classified.status === 'ACCEPTED' ? { content: entry.bytes } : {}),
    });
  }
  if (rejectedPaths.length > 0) throw new NestedArchiveError(rejectedPaths);
  return { entries };
}
