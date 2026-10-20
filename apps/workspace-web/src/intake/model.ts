// Presentation types only; these are not registered public wire contracts.
export interface Customer {
  id: string;
  name: string;
  code: string;
}
export interface IntakeProject {
  id: string;
  customer: Customer;
  title: string;
}
export type CustomerIntent =
  { kind: 'EXISTING'; customer: Customer } | { kind: 'NEW'; name: string };
export interface CreationIntent {
  id: string;
  customer: CustomerIntent;
  title: string;
}
export interface CreationReceipt {
  recoveryHref?: string;
  intent: CreationIntent;
  project: IntakeProject;
}
export function matchesCreation(intent: CreationIntent, receipt: CreationReceipt): boolean {
  return (
    receipt.intent.id === intent.id &&
    receipt.intent.title === intent.title &&
    receipt.project.title === intent.title &&
    receipt.project.id.length > 0 &&
    (intent.customer.kind === 'EXISTING'
      ? receipt.intent.customer.kind === 'EXISTING' &&
        receipt.intent.customer.customer.id === intent.customer.customer.id &&
        receipt.project.customer.id === intent.customer.customer.id
      : receipt.intent.customer.kind === 'NEW' &&
        receipt.intent.customer.name === intent.customer.name &&
        receipt.project.customer.name === intent.customer.name)
  );
}
export type IntakeStage =
  | 'RECEIVING'
  | 'PREPARING'
  | 'WAITING'
  | 'ANALYZING'
  | 'VALIDATING'
  | 'READY'
  | 'PREPARATION_FAILED'
  | 'ANALYSIS_FAILED'
  | 'UNKNOWN';
export const stageLabels: Record<IntakeStage, string> = {
  RECEIVING: '正在接收资料',
  PREPARING: '正在准备资料',
  WAITING: '已接收，等待安排',
  ANALYZING: 'Runner 正在分析',
  VALIDATING: '正在核验分析报告',
  READY: '分析报告已就绪',
  PREPARATION_FAILED: '资料准备失败',
  ANALYSIS_FAILED: '分析失败',
  UNKNOWN: '提交结果待核验（UNKNOWN）',
};
export interface ZipSelection {
  name: string;
  file?: File;
  fixedScenario?: boolean;
}
export interface Submission {
  id: string;
  projectId: string;
  zip: ZipSelection;
  note: string;
}
export interface IntakeReceipt {
  input: Submission;
  stage: IntakeStage;
  failures: readonly string[];
  retryAllowed: boolean;
  reportId?: string;
}

// U1 presentation inputs. Receipt never proves reading or analysis.
export type InputFormat = 'DOCX' | 'MARKDOWN' | 'XLSX' | 'XLS' | 'PDF' | 'OTHER';
export type InputEntryState = 'RECEIVED' | 'LIMITED' | 'FAILED' | 'UNSUPPORTED';
export interface InputEntry {
  id: string;
  path: string;
  format: InputFormat;
  bytes: number;
  state: InputEntryState;
  note: string;
}
export type InputBatchState =
  'RECEIVING' | 'RECEIVED' | 'LIMITED' | 'WAITING' | 'FAILED' | 'UNKNOWN';
export interface InputBatch {
  id: string;
  label: string;
  zipName: string;
  submittedAt: string;
  state: InputBatchState;
  entries: readonly InputEntry[];
  answers: readonly string[];
  answerIds?: readonly string[];
  questions?: readonly { id: string; title: string; state: string }[];
  limitations: readonly string[];
  nextAction: string;
}
export interface InputFormatRule {
  format: string;
  disposition: 'SUPPORTED' | 'CONVERT' | 'UNSUPPORTED';
  note: string;
}
export const inputEntryLabels: Record<InputEntryState, string> = {
  RECEIVED: '已接收 · 待核验',
  LIMITED: '已接收 · 读取受限',
  FAILED: '接收或读取失败',
  UNSUPPORTED: '不支持',
};
export const inputBatchLabels: Record<InputBatchState, string> = {
  RECEIVING: '正在接收',
  RECEIVED: '已接收',
  LIMITED: '已接收 · 有限',
  WAITING: '已接收 · 等待分析',
  FAILED: '存在失败条目',
  UNKNOWN: '接收结果待核验',
};
