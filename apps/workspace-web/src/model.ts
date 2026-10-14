// Experience view models only; these are not registered business wire contracts.
export interface Information {
  id: string;
  title: string;
  summary: string;
  sourceTitle: string;
  locator: string;
  excerpt: string;
  candidateRef: string;
}

export interface FilePlan {
  id: string;
  title: string;
  code: string;
  category: string;
  chapter: string;
  selectable: boolean;
  reason: string;
  plan: string;
  source: string;
}

export interface ReportView {
  projectId: string;
  reportId: string;
  version: number;
  title: string;
  summary: string;
  narrative: string;
  limitations: string[];
  attention: { id: string; title: string; reason: string; audience: string }[];
  information: Information[];
  files: FilePlan[];
}

export interface FixtureExecution {
  classification: 'DEVELOPMENT_FIXTURE_ONLY';
  requestId: string;
  projectId: string;
  reportId: string;
  version: number;
  informationRefs: string[];
  fileIds: string[];
  createdAt: number;
}

export interface WorkspaceData {
  classification: 'DEVELOPMENT_FIXTURE_ONLY';
  reports: ReportView[];
  selected: (reportId: string) => string[];
  saveSelection: (reportId: string, ids: string[]) => void;
  confirm: (reportId: string, ids: string[], intentId: string) => FixtureExecution;
  execution: (requestId: string) => FixtureExecution | undefined;
  executions: () => FixtureExecution[];
}
