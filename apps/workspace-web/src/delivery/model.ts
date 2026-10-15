// Experience presentation inputs only; no public operations or release policy.
export interface DeliveryFile {
  id: string;
  title: string;
  code: string;
  chapter: string;
  chapterTitle: string;
  revisionId: string;
  version: string;
  provenance: { round: string; reportId: string; reportVersion: number };
  qualification: { key: string; eligible: boolean; reason: string };
}
export interface DeliveryData {
  projectId: string;
  projectTitle: string;
  contextKey: string;
  recipient: string;
  observedAt: string;
  completeness: 'COMPLETE' | 'PARTIAL' | 'STALE';
  files: readonly DeliveryFile[];
  packages: readonly DeliveryPackage[];
}
export interface Selection {
  projectId: string;
  contextKey: string;
  recipient: string;
  files: readonly DeliveryFile[];
}
export interface SelectionCheck {
  selection: Selection;
  token: string;
  blockers: readonly string[];
  requirements: readonly { title: string; detail: string }[];
}
export interface DeliveryIntent {
  id: string;
  selection: Selection;
  checkToken: string;
}
export type ReceiptState =
  'PENDING' | 'CONFIRMED' | 'GENERATING' | 'UNKNOWN' | 'REJECTED' | 'FAILED' | 'PACKAGE_READY';
export const receiptLabels: Record<ReceiptState, string> = {
  PENDING: '正在确认本批版本',
  CONFIRMED: '本批版本已确认，待生成交付包',
  GENERATING: '正在生成交付包',
  UNKNOWN: '生成结果待核实',
  REJECTED: '本批确认被拒绝',
  FAILED: '交付包未能生成',
  PACKAGE_READY: '交付包已可用',
};
export interface DeliveryReceipt {
  intent: DeliveryIntent;
  state: ReceiptState;
  reason?: string;
  package?: DeliveryPackage;
}
export interface DownloadFact {
  id: string;
  packageId: string;
  at: string;
  state: 'REQUESTED' | 'UNKNOWN' | 'RESPONSE_STARTED' | 'RESPONSE_SENT' | 'FAILED';
}
export const downloadLabels: Record<DownloadFact['state'], string> = {
  REQUESTED: '已请求下载，保存情况未知',
  UNKNOWN: '下载结果待核实',
  RESPONSE_STARTED: '服务端已开始下载响应',
  RESPONSE_SENT: '服务端已发送下载响应',
  FAILED: '下载响应失败或中断',
};
export interface DeliveryPackage {
  id: string;
  label: string;
  createdAt: string;
  selection: Selection;
  availability: 'AVAILABLE' | 'UNAVAILABLE' | 'EXPIRED' | 'FAILED';
  reason: string;
  synthetic: boolean;
  downloads: readonly DownloadFact[];
}
export interface DeliveryActions {
  check: (selection: Selection) => Promise<SelectionCheck>;
  confirm: (intent: DeliveryIntent) => Promise<DeliveryReceipt>;
  read: (intent: DeliveryIntent) => Promise<DeliveryReceipt>;
  download: (pkg: DeliveryPackage) => Promise<DownloadFact>;
}
export function selectionKey(selection: Selection) {
  return JSON.stringify([
    selection.projectId,
    selection.contextKey,
    selection.recipient,
    selection.files.map((file) => [
      file.id,
      file.revisionId,
      file.qualification.key,
      file.provenance,
    ]),
  ]);
}
export function selectionIssues(selection: Selection, data: DeliveryData) {
  const issues: string[] = [];
  if (
    selection.projectId !== data.projectId ||
    selection.contextKey !== data.contextKey ||
    selection.recipient !== data.recipient
  )
    issues.push('项目、计划或接收范围已变化，请重新核对');
  for (const selected of selection.files) {
    const matches = data.files.filter((file) => file.id === selected.id);
    const current = matches[0];
    if (
      matches.length !== 1 ||
      !current?.qualification.eligible ||
      !current.qualification.key ||
      selectionKey({ ...selection, files: [current] }) !==
        selectionKey({ ...selection, files: [selected] })
    )
      issues.push(`${selected.title}：版本或交付条件已变化，请重新核对`);
  }
  if (data.completeness !== 'COMPLETE') issues.push('当前读取范围部分或陈旧，暂不能确认');
  return issues;
}
export function matchingReceipt(intent: DeliveryIntent, receipt: DeliveryReceipt) {
  return (
    intent.id === receipt.intent.id &&
    intent.checkToken === receipt.intent.checkToken &&
    selectionKey(intent.selection) === selectionKey(receipt.intent.selection) &&
    (receipt.state !== 'PACKAGE_READY' ||
      (receipt.package !== undefined &&
        selectionKey(intent.selection) === selectionKey(receipt.package.selection)))
  );
}
