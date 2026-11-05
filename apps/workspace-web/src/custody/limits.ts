// Closed @3 wire model; kept independent of the server-owned implementation.
const PATH_BYTES = 240;
const PATH_DEPTH = 16;
export const SCAN_LIMITS = Object.freeze({
  ZIP_BYTES: 104857600,
  OUTER_ENTRIES: 1000,
  OFFICE_DOCUMENT_ENTRIES: 1000,
  OFFICE_ENTRIES: 20000,
  ENTRY_BYTES: 52428800,
  EXPANDED_BYTES: 524288000,
  MEMORY_BYTES: 536870912,
  PROCESSING_TIME_MS: 120000,
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
    new TextEncoder().encode(value).byteLength <= PATH_BYTES &&
    new TextEncoder().encode(value.normalize('NFC')).byteLength <= PATH_BYTES &&
    // eslint-disable-next-line no-control-regex -- Match the archive path safety rules.
    !/[\x00-\x1f\x7f\\]/u.test(value) &&
    !/^[/~]|^[A-Za-z]:/u.test(value) &&
    value.split('/').filter(Boolean).length <= PATH_DEPTH &&
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

const LABELS: Record<ScanMetric, string> = {
  ZIP_BYTES: '压缩文件大小',
  OUTER_ENTRIES: 'ZIP 目录声明条目数',
  OFFICE_DOCUMENT_ENTRIES: '此文档目录声明的内部部件数',
  OFFICE_ENTRIES: 'Office 目录声明的累计内部部件数',
  ENTRY_BYTES: '目录声明的单条目展开大小',
  EXPANDED_BYTES: '目录声明的累计展开大小',
  MEMORY_BYTES: '预计工作内存',
  PROCESSING_TIME_MS: '已用扫描时间',
};

export function limitViolationText(detail: LimitViolation): string {
  const number = (value: number) => value.toLocaleString('zh-CN');
  if (detail.metric === 'EXPANSION_RATIO') {
    return `目录声明的展开倍率超限：压缩大小 ${number(detail.compressedBytes)} 字节，展开大小 ${number(detail.expandedBytes)} 字节；允许上限 ${detail.limit} 倍。`;
  }
  const unit = detail.metric.endsWith('_ENTRIES')
    ? '条'
    : detail.metric === 'PROCESSING_TIME_MS'
      ? '毫秒'
      : '字节';
  return `${LABELS[detail.metric]}：${number(detail.actual)} ${unit}，允许上限 ${number(detail.limit)} ${unit}。`;
}
