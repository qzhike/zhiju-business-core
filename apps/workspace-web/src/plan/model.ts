// Experience presentation inputs for the U1 scope-plan rehearsal. These are
// not public wire contracts, business eligibility rules or server receipts.
export type PlanFileLevel = 'MANUAL' | 'PROCEDURE' | 'RULE' | 'RECORD';
export type PlanAction = 'REVISE' | 'CREATE' | 'RETAIN';
export type PlanState = 'DRAFT' | 'CONFIRMED' | 'SUPERSEDED' | 'PENDING' | 'FAILED' | 'UNKNOWN';

export const planLevelLabels: Record<PlanFileLevel, string> = {
  MANUAL: '质量手册',
  PROCEDURE: '程序文件',
  RULE: '管理制度',
  RECORD: '记录表单',
};
export const planActionLabels: Record<PlanAction, string> = {
  REVISE: '修订',
  CREATE: '新增',
  RETAIN: '保留，不生成',
};
export const planStateLabels: Record<PlanState, string> = {
  DRAFT: '未确认',
  CONFIRMED: '已确认 · 演示回执',
  SUPERSEDED: '已被新计划替代',
  PENDING: '确认请求待回执',
  FAILED: '确认失败',
  UNKNOWN: '确认结果未知（UNKNOWN）',
};
export interface PlanBasis {
  batchId: string;
  label: string;
  sourceIds: string[];
}
export interface PlanFile {
  id: string;
  title: string;
  level: PlanFileLevel;
  action: PlanAction;
  current: string;
  proposal: string;
  impact: string;
  inputSourceIds: string[];
  templateSourceIds: string[];
}
export interface PlanReceipt {
  classification: 'DEVELOPMENT_FIXTURE_ONLY';
  requestId: string;
  planId: string;
  planVersion: number;
  reportId: string;
  reportVersion: number;
  fileIds: string[];
  inputRefs: string[];
  confirmedAt: string;
}
export interface PlanView {
  planId: string;
  version: number;
  projectId: string;
  reportId: string;
  reportVersion: number;
  state: PlanState;
  inputBasis: PlanBasis[];
  templateBasis: string[];
  currentSituation: string;
  problem: string;
  proposal: string;
  impact: string;
  files: PlanFile[];
  retained: { id: string; title: string; reason: string }[];
  receipt?: PlanReceipt;
  supersedes?: string;
  supersededBy?: string;
  failure?: string;
  unknownIntent?: string;
}
export interface RevisionRequest {
  id: string;
  planId: string;
  planVersion: number;
  text: string;
  state: 'PENDING' | 'RECEIVED' | 'FAILED' | 'UNKNOWN';
  message: string;
}
export function planInputRefs(plan: PlanView): string[] {
  return plan.inputBasis.flatMap((basis) => basis.sourceIds);
}
export function planFileIds(plan: PlanView): string[] {
  return plan.files.filter((file) => file.action !== 'RETAIN').map((file) => file.id);
}
export function matchesPlanReceipt(plan: PlanView, receipt: PlanReceipt): boolean {
  return (
    receipt.planId === plan.planId &&
    receipt.planVersion === plan.version &&
    receipt.reportId === plan.reportId &&
    receipt.reportVersion === plan.reportVersion &&
    JSON.stringify(receipt.fileIds) === JSON.stringify(planFileIds(plan)) &&
    JSON.stringify(receipt.inputRefs) === JSON.stringify(planInputRefs(plan))
  );
}
