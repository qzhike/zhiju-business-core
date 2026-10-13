// Experience presentation inputs, not public wire contracts or business eligibility rules.
export interface Evidence {
  id: string;
  sourceId: string;
  representation: string;
  locator: { kind: string; value: string };
  note: string;
}
export interface Attention {
  id: string;
  title: string;
  kind: string;
  audience: string;
  reason: string;
  question: string;
  affectedPlannedFileIds: string[];
  protectedFactIds: string[];
  evidenceIds: string[];
  customerRequest: { key: string; title: string; text: string } | null;
}
export interface AnalysisReport {
  projectId: string;
  reportId: string;
  version: number;
  title: string;
  summary: string;
  limitations: string[];
  narrative: string;
  attentionItems: Attention[];
  evidence: Evidence[];
  plannedFiles: { id: string; title: string; customerCode: string | null; origin: string }[];
  changes: {
    id: string;
    title: string;
    description: string;
    targetPlannedFileIds: string[];
    evidenceIds: string[];
  }[];
  checks: { id: string; title: string; result: string; authority: string; limitations: string[] }[];
  resolutionProposals: {
    id: string;
    attentionItemIds: string[];
    explanation: string;
    evidenceIds: string[];
  }[];
}
export interface CustomerRequest {
  key: string;
  title: string;
  text: string;
  items: Attention[];
}
export function customerRequests(report: AnalysisReport): CustomerRequest[] {
  const requests = new Map<string, CustomerRequest>();
  for (const item of report.attentionItems) {
    if (item.audience !== 'CUSTOMER' || !item.customerRequest) continue;
    const request = item.customerRequest;
    const existing = requests.get(request.key);
    if (existing) existing.items.push(item);
    else requests.set(request.key, { ...request, items: [item] });
  }
  return [...requests.values()];
}
export function requestText(requests: readonly CustomerRequest[]): string {
  return requests
    .map((request, index) => `${index + 1}. ${request.title}\n${request.text}`)
    .join('\n\n');
}
export interface Context {
  key: string;
  projectId: string;
  kind: 'CUSTOMER' | 'JUDGMENT' | 'PLAN';
  title: string;
  reportId: string;
  version: number;
  itemIds: string[];
  fileIds: string[];
  evidenceIds: string[];
  protectedFactIds: string[];
  changeIds: string[];
}
export function contextFor(report: AnalysisReport, kind: Context['kind'], id?: string): Context {
  const items = report.attentionItems.filter((item) =>
    kind === 'CUSTOMER'
      ? item.audience === 'CUSTOMER'
      : kind === 'JUDGMENT'
        ? item.id === id
        : item.affectedPlannedFileIds.includes(id ?? ''),
  );
  const changes =
    kind === 'PLAN'
      ? report.changes.filter((change) => change.targetPlannedFileIds.includes(id ?? ''))
      : [];
  const unique = (values: string[]) => [...new Set(values)];
  return {
    key: `${report.projectId}:${report.reportId}:${kind}:${id ?? 'all'}`,
    kind,
    projectId: report.projectId,
    title:
      kind === 'CUSTOMER'
        ? '客户资料补充'
        : kind === 'JUDGMENT'
          ? (items[0]?.title ?? '顾问判断')
          : `文件计划意见 · ${report.plannedFiles.find((file) => file.id === id)?.title ?? id}`,
    reportId: report.reportId,
    version: report.version,
    itemIds: items.map((item) => item.id),
    fileIds:
      kind === 'PLAN' ? [id ?? ''] : unique(items.flatMap((item) => item.affectedPlannedFileIds)),
    evidenceIds: unique([
      ...items.flatMap((item) => item.evidenceIds),
      ...changes.flatMap((change) => change.evidenceIds),
    ]),
    protectedFactIds: unique(items.flatMap((item) => item.protectedFactIds)),
    changeIds: changes.map((change) => change.id),
  };
}
export interface Draft {
  text: string;
  attachments: string[];
  fixedExample: boolean;
}
export interface Submission {
  id: string;
  projectId: string;
  context: Context;
  draft: Draft;
}
export type ResultState = 'PENDING' | 'UNAVAILABLE' | 'FAILED' | 'UNKNOWN' | 'RECEIVED';
export interface Receipt {
  input: Submission;
  state: ResultState;
  message: string;
}
export interface AnalysisState {
  selected: string[];
  drafts: Record<string, Draft>;
  context: Context;
  receipts: Receipt[];
  search: string;
  category: string;
  scroll: Record<string, number>;
}
export function initialState(report: AnalysisReport): AnalysisState {
  return {
    selected: [],
    drafts: {},
    context: contextFor(report, 'CUSTOMER'),
    receipts: [],
    search: '',
    category: 'ALL',
    scroll: {},
  };
}
export function matchesReceipt(input: Submission, receipt: Receipt): boolean {
  return JSON.stringify(input) === JSON.stringify(receipt.input);
}
export const emptyDraft: Draft = { text: '', attachments: [], fixedExample: false };
