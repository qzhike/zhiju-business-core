import { asRecord } from '../trusted/values.js';
import { parseEntry, type CustodyEntry } from './model.js';
import { previewId } from './preview-model.js';

export const checkStatusText = {
  QUEUED: '等待检查',
  RUNNING: '正在检查',
  COMPLETED: '检查结束',
  INTERRUPTED: '检查已中断',
  FAILED: '检查未完成',
  UNKNOWN: '执行状态待核对',
} as const;
export const checkFilters = {
  ALL: '全部条目',
  PROBLEMS: '仅看问题',
  AVAILABLE: '取得内容',
  LIMITED: '读取受限',
  UNSUPPORTED: '读取不支持',
  FAILED: '读取失败',
  NOT_ELIGIBLE: '未进入读取',
  PENDING: '尚未检查',
} as const;
export type CheckFilter = keyof typeof checkFilters;
export interface CheckView {
  readonly checkId: string;
  readonly projectId: string;
  readonly batchId: string;
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly profileId: string;
  readonly profileHash: string;
  readonly status: keyof typeof checkStatusText;
  readonly resultVersion: number;
  readonly totalEntries: number;
  readonly counts: {
    available: number;
    limited: number;
    unsupported: number;
    failed: number;
    notEligible: number;
    pending: number;
  };
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly reasonCodes: readonly string[];
}
export interface CheckResult {
  readonly entryId: string;
  readonly ordinal: number;
  readonly profileId: string;
  readonly checkedAt: string;
  readonly status: 'AVAILABLE' | 'LIMITED' | 'UNSUPPORTED' | 'FAILED' | 'NOT_ELIGIBLE';
  readonly limitations: readonly string[];
  readonly resultHash?: string;
  readonly counts?: {
    paragraphs: number;
    tables: number;
    comments: number;
    revisions: number;
    headersFooters: number;
    characters: number;
  };
}
export interface CheckPage {
  readonly check: CheckView;
  readonly filter: CheckFilter;
  readonly total: number;
  readonly entries: readonly { entry: CustodyEntry; result?: CheckResult }[];
  readonly next?: string;
}
const digest = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/u.test(v);
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 32 && v.every((x) => typeof x === 'string' && x.length <= 100);
const instant = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(v) &&
  Number.isFinite(Date.parse(v));
function closed(v: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(v).every((k) => keys.includes(k));
}

export function parseCheck(
  value: unknown,
  projectId: string,
  batchId: string,
  checkId?: string,
): CheckView | null {
  const v = asRecord(value),
    c = asRecord(v?.counts);
  if (
    v === null ||
    c === null ||
    !closed(v, [
      'checkId',
      'projectId',
      'batchId',
      'manifestId',
      'manifestHash',
      'profileId',
      'profileHash',
      'status',
      'resultVersion',
      'totalEntries',
      'counts',
      'createdAt',
      'startedAt',
      'endedAt',
      'reasonCodes',
    ]) ||
    typeof v.checkId !== 'string' ||
    !previewId(v.checkId) ||
    typeof v.manifestId !== 'string' ||
    !previewId(v.manifestId) ||
    v.projectId !== projectId ||
    v.batchId !== batchId ||
    (checkId !== undefined && v.checkId !== checkId) ||
    !digest(v.manifestHash) ||
    !digest(v.profileHash) ||
    v.profileId !== 'mvp.batch-read-check@1' ||
    typeof v.status !== 'string' ||
    !Object.hasOwn(checkStatusText, v.status) ||
    !integer(v.resultVersion) ||
    v.resultVersion < 1 ||
    !integer(v.totalEntries) ||
    !instant(v.createdAt) ||
    (v.startedAt !== undefined && !instant(v.startedAt)) ||
    (v.endedAt !== undefined && !instant(v.endedAt)) ||
    !strings(v.reasonCodes)
  )
    return null;
  const keys = ['available', 'limited', 'unsupported', 'failed', 'notEligible', 'pending'];
  if (
    !closed(c, keys) ||
    keys.some((k) => !integer(c[k])) ||
    keys.reduce((sum, k) => sum + Number(c[k]), 0) !== v.totalEntries ||
    ['COMPLETED', 'INTERRUPTED', 'FAILED'].includes(v.status) !== (v.endedAt !== undefined) ||
    (v.status === 'COMPLETED' && c.pending !== 0)
  )
    return null;
  return v as unknown as CheckView;
}

export function parseCheckPage(
  value: unknown,
  projectId: string,
  batchId: string,
  checkId: string,
  filter: CheckFilter,
): CheckPage | null {
  const v = asRecord(value);
  const check = parseCheck(v?.check, projectId, batchId, checkId);
  if (
    v === null ||
    check === null ||
    !closed(v, ['check', 'filter', 'total', 'entries', 'nextCursor']) ||
    v.filter !== filter ||
    !integer(v.total) ||
    v.total > check.totalEntries ||
    !Array.isArray(v.entries) ||
    v.entries.length > 100 ||
    (v.nextCursor !== undefined &&
      (typeof v.nextCursor !== 'string' || v.nextCursor.length === 0 || v.nextCursor.length > 4096))
  )
    return null;
  const entries: { entry: CustodyEntry; result?: CheckResult }[] = [];
  const ids = new Set<string>();
  let last = -1;
  for (const item of v.entries) {
    const row = asRecord(item),
      entry = parseEntry(row?.entry),
      raw = asRecord(row?.entry),
      source = asRecord(raw?.sourceRef);
    if (
      row === null ||
      !closed(row, ['entry', 'result']) ||
      entry === null ||
      !previewId(entry.entryId) ||
      !integer(entry.ordinal) ||
      entry.ordinal <= last ||
      ids.has(entry.entryId)
    )
      return null;
    if (
      (entry.status === 'ACCEPTED') !== (source !== null) ||
      (source !== null &&
        (source.projectId !== projectId ||
          source.batchId !== batchId ||
          source.kind !== 'ACCEPTED_ENTRY' ||
          source.sourceId !== entry.sourceId ||
          source.sha256 !== entry.sha256 ||
          source.byteLength !== entry.byteLength ||
          source.mediaType !== entry.mediaType))
    )
      return null;
    last = entry.ordinal;
    ids.add(entry.entryId);
    if (row.result === undefined) {
      entries.push({ entry });
      continue;
    }
    const result = asRecord(row.result),
      counts = asRecord(result?.counts);
    if (
      result === null ||
      !closed(result, [
        'entryId',
        'ordinal',
        'profileId',
        'checkedAt',
        'status',
        'limitations',
        'resultHash',
        'counts',
      ]) ||
      result.entryId !== entry.entryId ||
      result.ordinal !== entry.ordinal ||
      result.profileId !== check.profileId ||
      !instant(result.checkedAt) ||
      !strings(result.limitations) ||
      !['AVAILABLE', 'LIMITED', 'UNSUPPORTED', 'FAILED', 'NOT_ELIGIBLE'].includes(
        String(result.status),
      ) ||
      (entry.status !== 'ACCEPTED') !== (result.status === 'NOT_ELIGIBLE')
    )
      return null;
    const hasContent = result.status === 'AVAILABLE' || result.status === 'LIMITED';
    if (
      hasContent
        ? !digest(result.resultHash) || counts === null
        : result.resultHash !== undefined || result.counts !== undefined
    )
      return null;
    if (
      counts !== null &&
      (!closed(counts, [
        'paragraphs',
        'tables',
        'comments',
        'revisions',
        'headersFooters',
        'characters',
      ]) ||
        ['paragraphs', 'tables', 'comments', 'revisions', 'headersFooters', 'characters'].some(
          (k) => !integer(counts[k]),
        ))
    )
      return null;
    entries.push({ entry, result: result as unknown as CheckResult });
  }
  if (entries.length > v.total) return null;
  return {
    check,
    filter,
    total: v.total,
    entries,
    ...(typeof v.nextCursor === 'string' ? { next: v.nextCursor } : {}),
  };
}

export function checkReasonText(reason: string): string {
  return (
    (
      {
        AUTHORIZATION_CHANGED: '权限已变化，原检查已停止。',
        CHECK_INTERRUPTED: '检查已中断；已保存的结果保留，可在核对后重新检查。',
        CHECK_TIME_LIMIT: '本次检查达到运行时限，尚未检查的条目已保留。',
        DEPENDENCY_UNAVAILABLE: '读取依赖暂不可用，请恢复依赖后重新检查。',
        STORAGE_INTEGRITY_ERROR: '原件完整性校验失败，请核对存储。',
      } as Record<string, string>
    )[reason] ?? '请核对本次检查的限制与文件说明。'
  );
}
