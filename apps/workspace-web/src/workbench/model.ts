// Presentation inputs only. Grouping never changes an owning business status.
export type WorkGroup = 'attention' | 'running' | 'waiting' | 'done';
export const GROUPS: readonly { id: WorkGroup; label: string }[] = [
  { id: 'attention', label: '需要你' },
  { id: 'running', label: '推进中' },
  { id: 'waiting', label: '待开始' },
  { id: 'done', label: '已完成' },
];

export interface ProjectView {
  key: string;
  enterpriseId: string;
  projectId: string;
  name: string;
  title: string;
  code: string;
  status: string;
  version: number;
  progress: string;
}

export type Destination =
  | { kind: 'new' }
  | { kind: 'intake' | 'delivery'; projectId: string }
  | { kind: 'analysis' | 'startup'; projectId: string; reportId: string }
  | { kind: 'execution'; projectId: string; requestId: string }
  | { kind: 'file'; projectId: string; fileId: string; revisionId: string }
  | { kind: 'task'; projectId: string; taskId: string; version: number }
  | { kind: 'delivery-item'; projectId: string; itemId: string };

export interface WorkAction {
  label: string;
  destination: Destination;
}

export interface WorkCard {
  id: string;
  projectKey: string;
  title: string;
  group: WorkGroup;
  status: string;
  reason: string;
  context: string;
  counts?: { review: number; working: number };
  action: WorkAction;
  secondaryAction?: WorkAction;
}

export interface ReadNotice {
  id: string;
  title: string;
  state: 'LOADING' | 'READY' | 'EMPTY' | 'ERROR';
  detail: string;
  observation?: string;
  warning?: string;
  action?: { label: string; run: () => void };
}

export function destinationPath(destination: Destination): string {
  if (destination.kind === 'new') return '/projects/new';
  const base = `/projects/${encodeURIComponent(destination.projectId)}`;
  switch (destination.kind) {
    case 'intake':
    case 'delivery':
      return `${base}/${destination.kind}`;
    case 'analysis':
    case 'startup':
      return `${base}/${destination.kind}/${encodeURIComponent(destination.reportId)}`;
    case 'execution':
      return `${base}/executions/${encodeURIComponent(destination.requestId)}`;
    case 'file':
      return `${base}/files/${encodeURIComponent(destination.fileId)}/revisions/${encodeURIComponent(destination.revisionId)}`;
    case 'task':
      return `${base}/tasks/${encodeURIComponent(destination.taskId)}?version=${destination.version}`;
    case 'delivery-item':
      return `${base}/delivery?item=${encodeURIComponent(destination.itemId)}`;
  }
}

export function workbenchPath(project: Pick<ProjectView, 'enterpriseId' | 'projectId'> | null) {
  return project === null
    ? '/workbench'
    : `/workbench?enterprise=${encodeURIComponent(project.enterpriseId)}&project=${encodeURIComponent(project.projectId)}`;
}

export function selectedProjectKey(search: string): string | null {
  const params = new URLSearchParams(search);
  const enterprise = params.get('enterprise');
  const project = params.get('project');
  const safe = /^[A-Za-z0-9_-]{1,64}$/u;
  return enterprise !== null && project !== null && safe.test(enterprise) && safe.test(project)
    ? `project:${enterprise}/${project}`
    : null;
}
