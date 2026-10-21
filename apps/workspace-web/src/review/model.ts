// Experience presentation inputs for the bounded review workspace (#286).
// These types are page-local view state; they are not public business contracts.
import type { Change, Document, ReviewContent, Unit } from '../trusted/markdown.js';

export const reviewFileStateLabels = {
  WAITING: '等待安排',
  PROCESSING: '正在处理',
  READY: '待检查',
  FAILED: '处理失败',
  UNCERTAIN: '信息待核验',
  APPROVED: '已批准',
} as const;
export type ReviewFileState = keyof typeof reviewFileStateLabels;

export interface ReviewFileEntry {
  fileId: string;
  code: string;
  title: string;
  state: ReviewFileState;
  /** One compact line supplied by the owning directory result. */
  detail: string;
  /** Whether this exact file has a reviewable candidate to open. */
  openable: boolean;
}

/** Owning work-file directory: the loaded page is never used as the denominator. */
export interface ReviewFileDirectory {
  totalCount: number;
  entries: readonly ReviewFileEntry[];
  currentFileId: string;
  query: string;
  stateFilter: 'ALL' | ReviewFileState;
  loading: boolean;
  nextCursor?: string | undefined;
  status?: string | undefined;
}

export interface ReviewFileActions {
  onQuery?: ((query: string) => void) | undefined;
  onStateFilter?: ((state: 'ALL' | ReviewFileState) => void) | undefined;
  onSelect?: ((fileId: string) => void) | undefined;
  onMore?: (() => void) | undefined;
}

export type ReviewDraftState =
  'EMPTY' | 'UNAVAILABLE' | 'SAVING' | 'SAVED' | 'UNSAVED' | 'CONFLICT' | 'FAILED' | 'UNKNOWN';
export const reviewDraftStateLabels: Record<ReviewDraftState, string> = {
  EMPTY: '尚未输入意见',
  UNAVAILABLE: '未保存 · 服务器草稿能力尚未接入',
  SAVING: '正在保存个人草稿…',
  SAVED: '个人草稿已保存',
  UNSAVED: '个人草稿尚未保存',
  CONFLICT: '另一设备也保存了此草稿，请核对后显式选择',
  FAILED: '模拟保存失败，输入仍在本页',
  UNKNOWN: '保存结果待核验，仍在查询原保存请求',
};

export interface ReviewBaselineOption {
  id: string;
  label: string;
  kind: 'LATEST' | 'OLDER';
}

/** One Markdown suggestion draft, retaining the explicitly declared baseline. */
export interface ReviewSuggestion {
  name: string;
  text: string;
  /** Byte length of the attached UTF-8 file, when the owning read reported it. */
  byteLength?: number | undefined;
  baseline: {
    options: readonly ReviewBaselineOption[];
    selectedId?: string | undefined;
  };
  /** Label of the latest candidate version (the submission-time current). */
  latestLabel: string;
  error?: string | undefined;
  note?: string | undefined;
}

export interface ReviewSubmission {
  status: 'UNKNOWN' | 'ACCEPTED' | 'RUNNING';
  /** Stable identifier of the original request; queries only read this request. */
  requestLabel: string;
  originalText: string;
  originalSuggestion?: { name: string; baselineLabel: string } | undefined;
  queries: { automatic: number; budget: number };
  querying: boolean;
  canQuery: boolean;
  note: string;
}

export interface ReviewOpinionScopeOption {
  id: string;
  label: string;
  kind: 'PROJECT' | 'STAGE' | 'FILE_VERSION';
}

/** The single opinion area states which project, stage or file version it targets. */
export interface ReviewOpinionScope {
  options: readonly ReviewOpinionScopeOption[];
  selectedId: string;
  note: string;
}

export interface ReviewOpinionHistoryEntry {
  id: string;
  scopeLabel: string;
  status: string;
  text: string;
  requestLabel: string;
  basis: string;
}

export interface ReviewOpinionModel {
  /** Exact file/version context this area submits against. */
  context: string;
  draft: { text: string; state: ReviewDraftState; note: string };
  submission?: ReviewSubmission | undefined;
  suggestion?: ReviewSuggestion | undefined;
  approval: { available: boolean; note: string; visible?: boolean | undefined };
  scope?: ReviewOpinionScope | undefined;
  /** Append-only opinions that keep their original scope and basis. */
  history?: readonly ReviewOpinionHistoryEntry[] | undefined;
  /** A project-wide active batch that prevents starting another submission. */
  submitBlocked?: string | undefined;
  unavailable: readonly string[];
}

export interface ReviewOpinionActions {
  onDraftChange?: ((text: string) => void) | undefined;
  onSaveDraft?: (() => void) | undefined;
  onSubmit?: (() => void) | undefined;
  onQuerySubmission?: (() => void) | undefined;
  onApprove?: (() => void) | undefined;
  onSelectScope?: ((id: string) => void) | undefined;
  onAttachSuggestion?: ((file: { name: string; text: string }) => void) | undefined;
  onRemoveSuggestion?: (() => void) | undefined;
  onSelectBaseline?: ((id: string) => void) | undefined;
}

export interface ReviewSummary {
  summary: string;
  retained: readonly string[];
  evidence: readonly { label: string; detail: string }[];
  note?: string | undefined;
}

export interface ReviewCandidateNotice {
  label: string;
  note: string;
  onSwitch?: (() => void) | undefined;
}

export interface ReviewDownload {
  hasRepresentation: boolean;
  status: string;
  note: string;
  onDownload: () => Promise<void>;
}

export interface ReviewWorkspaceInput {
  files?: { list: ReviewFileDirectory; actions: ReviewFileActions } | undefined;
  directoryNote?: string | undefined;
  summary?: ReviewSummary | undefined;
  candidate?: ReviewCandidateNotice | undefined;
  recheck?: string | undefined;
}

export function submissionStatusCopy(
  status: ReviewSubmission['status'],
  queries: ReviewSubmission['queries'],
): string {
  if (status === 'UNKNOWN')
    return `未收到本次提交的回执，还不能判断服务器是否接收；查询只针对原提交，不会再次发送意见。已自动查询 ${queries.automatic} / ${queries.budget} 次。`;
  if (status === 'ACCEPTED')
    return '本次意见与改稿已记录；服务器开始处理前不会改写文件。新写的内容仅是下轮草稿。';
  return '本次请求已开始处理；当前阅读版本和引用位置保持不变。';
}

/** Supplied stable locations: added/removed/moved keep their own visible semantics. */
export const changeKindNotices: Record<Change['kind'], string> = {
  ADDED: '新增内容没有旧位置；不会为它推定历史位置。',
  REMOVED: '已删除内容只保留在原版本位置；不会自动移到当前版本的相近位置。',
  MOVED: '移动保留原位置与新位置；旧引用不会自动迁移。',
  CHANGED: '',
};

/**
 * Resolves the unit a change renders from, mirroring the canonical document
 * renderer: a table cell or row renders through its owning table.
 */
export function focusUnit(document: Document, unitId: string): Unit | undefined {
  let unit = document.units.find((candidate) => candidate.unitId === unitId);
  if (unit?.unitType === 'TABLE_CELL') {
    const parentUnitId = requiredValue(unit.parentUnitId);
    unit = document.units.find((candidate) => candidate.unitId === parentUnitId);
  }
  if (unit?.unitType === 'TABLE_ROW') {
    const parentUnitId = requiredValue(unit.parentUnitId);
    unit = document.units.find((candidate) => candidate.unitId === parentUnitId);
  }
  return unit;
}

/**
 * Primary stable binding of a change plus whether it still resolves in the
 * given exact version. A binding that no longer resolves stays visible instead
 * of silently rebinding to neighbouring content.
 */
export function changeBinding(
  content: ReviewContent,
  change: Change,
): { unitId: string; present: boolean } {
  const unitId = change.afterValue?.unitId ?? change.beforeValue?.unitId ?? change.unitId;
  return { unitId, present: focusUnit(content.document, unitId) !== undefined };
}

function requiredValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Required review binding is unavailable');
  return value;
}
