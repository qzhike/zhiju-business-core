import { MVP_INPUT_LIMITS } from './policy.js';

export const SCAN_LIMITS = Object.freeze({
  ZIP_BYTES: MVP_INPUT_LIMITS.zipBytes,
  OUTER_ENTRIES: MVP_INPUT_LIMITS.entries,
  OFFICE_DOCUMENT_ENTRIES: MVP_INPUT_LIMITS.officeDocumentEntries,
  OFFICE_ENTRIES: MVP_INPUT_LIMITS.officeEntries,
  ENTRY_BYTES: MVP_INPUT_LIMITS.entryBytes,
  EXPANDED_BYTES: MVP_INPUT_LIMITS.totalExpandedBytes,
  MEMORY_BYTES: MVP_INPUT_LIMITS.memoryBytes,
  PROCESSING_TIME_MS: MVP_INPUT_LIMITS.wallClockMs,
});

export type ScanMetric = keyof typeof SCAN_LIMITS;
export type LimitViolation = (
  | { readonly metric: ScanMetric; readonly actual: number; readonly limit: number }
  | {
      readonly metric: 'EXPANSION_RATIO';
      readonly expandedBytes: number;
      readonly compressedBytes: number;
      readonly limit: 100;
    }
) & { readonly documentPath?: string };

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function safeOfficePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value) <= MVP_INPUT_LIMITS.pathBytes &&
    Buffer.byteLength(value.normalize('NFC')) <= MVP_INPUT_LIMITS.pathBytes &&
    // eslint-disable-next-line no-control-regex -- Match the archive path safety rules.
    !/[\x00-\x1f\x7f\\]/u.test(value) &&
    !/^[/~]|^[A-Za-z]:/u.test(value) &&
    value.split('/').filter(Boolean).length <= MVP_INPUT_LIMITS.pathDepth &&
    !value.split('/').some((part) => part === '.' || part === '..') &&
    /\.(?:docx|xlsx)$/iu.test(value)
  );
}

/** Validate the closed @3 read model, including the fixed measurement limits. */
export function parseLimitViolation(value: unknown): LimitViolation | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const path = item.documentPath;
  if (Object.hasOwn(item, 'documentPath') && !safeOfficePath(path)) return undefined;
  const keys = Object.keys(item)
    .filter((key) => key !== 'documentPath')
    .sort()
    .join(',');
  if (item.metric === 'EXPANSION_RATIO') {
    if (
      keys !== 'compressedBytes,expandedBytes,limit,metric' ||
      item.limit !== 100 ||
      !integer(item.expandedBytes) ||
      !integer(item.compressedBytes) ||
      item.expandedBytes <= item.compressedBytes * 100
    )
      return undefined;
    return {
      metric: 'EXPANSION_RATIO',
      expandedBytes: item.expandedBytes,
      compressedBytes: item.compressedBytes,
      limit: 100,
      ...(path === undefined ? {} : { documentPath: path as string }),
    };
  }
  if (
    keys !== 'actual,limit,metric' ||
    typeof item.metric !== 'string' ||
    !Object.hasOwn(SCAN_LIMITS, item.metric) ||
    !integer(item.actual)
  )
    return undefined;
  const metric = item.metric as ScanMetric;
  if (item.limit !== SCAN_LIMITS[metric] || item.actual <= SCAN_LIMITS[metric]) return undefined;
  if (metric === 'OUTER_ENTRIES' && path !== undefined) return undefined;
  return {
    metric,
    actual: item.actual,
    limit: SCAN_LIMITS[metric],
    ...(path === undefined ? {} : { documentPath: path as string }),
  };
}
