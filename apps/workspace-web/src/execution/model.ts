// Experience presentation inputs, not public business wire contracts.
export const stateLabels = {
  WAITING: '等待安排',
  PROCESSING: '正在处理',
  READY: '待检查',
  FAILED: '处理失败',
  UNCERTAIN: '信息待核验',
} as const;
export type FileState = keyof typeof stateLabels;
export interface Candidate {
  projectId: string;
  requestId: string;
  fileId: string;
  revisionId: string;
}
export interface ProgressFile {
  id: string;
  code: string;
  title: string;
  state: FileState;
  update: string;
  updatedAt: string;
  failure?: string;
  failures: readonly string[];
  retryAllowed: boolean;
  candidate?: Candidate;
}
export interface ExecutionRound {
  projectId: string;
  requestId: string;
  label: string;
  reportId: string;
  reportVersion: number;
  confirmedFileIds: readonly string[];
  files: readonly ProgressFile[];
  summary: string;
  logs: readonly string[];
}
export interface RetryIntent {
  id: string;
  projectId: string;
  requestId: string;
  fileId: string;
}
export interface RetryReceipt extends RetryIntent {
  state: 'PENDING' | 'ACCEPTED' | 'UNKNOWN';
}
export interface RoundView {
  search: string;
  filter: 'ALL' | FileState;
  scroll: number;
  scopeOpen: boolean;
  summaryOpen: boolean;
  logsOpen: boolean;
  retries: Map<string, RetryReceipt>;
}
export const newRoundView = (): RoundView => ({
  search: '',
  filter: 'ALL',
  scroll: 0,
  scopeOpen: false,
  summaryOpen: false,
  logsOpen: false,
  retries: new Map(),
});
export function roundPath(round: Pick<ExecutionRound, 'projectId' | 'requestId'>) {
  return `/projects/${encodeURIComponent(round.projectId)}/executions/${encodeURIComponent(round.requestId)}`;
}
export function candidatePath(round: ExecutionRound, file: ProgressFile): string | null {
  const candidate = file.candidate;
  if (
    !candidate?.revisionId ||
    candidate.projectId !== round.projectId ||
    candidate.requestId !== round.requestId ||
    candidate.fileId !== file.id
  )
    return null;
  return `/projects/${encodeURIComponent(candidate.projectId)}/files/${encodeURIComponent(candidate.fileId)}/revisions/${encodeURIComponent(candidate.revisionId)}`;
}
export function scopedFiles(round: ExecutionRound) {
  const scope = new Set(round.confirmedFileIds);
  // Missing or duplicated observations remain uncertain rather than becoming a fabricated state.
  return [...scope].map((id): ProgressFile => {
    const matches = round.files.filter((file) => file.id === id);
    if (matches.length !== 1)
      return {
        id,
        title: id,
        code: '',
        state: 'UNCERTAIN',
        update: '缺少唯一文件进度，等待核验',
        updatedAt: '',
        failures: [],
        retryAllowed: false,
      };
    const file = matches[0];
    if (!file) throw new Error('Missing unique file observation');
    return file.state === 'READY' && candidatePath(round, file) === null
      ? {
          ...file,
          state: 'UNCERTAIN',
          update: '候选引用缺失或不匹配，等待核验',
          retryAllowed: false,
        }
      : file;
  });
}
export function matchingReceipt(intent: RetryIntent, receipt: RetryReceipt) {
  return (
    intent.id === receipt.id &&
    intent.projectId === receipt.projectId &&
    intent.requestId === receipt.requestId &&
    intent.fileId === receipt.fileId
  );
}
