import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { destinationPath, type WorkAction, type WorkGroup } from './model.js';

export interface ReadingPosition {
  search: string;
  group: WorkGroup;
  completed: boolean;
  more: boolean;
  focusId: string | null;
  scroll: Record<string, number>;
}

interface RecentEntry {
  projectKey: string;
  action: WorkAction;
}

interface NavigationMemory {
  views: Map<string, ReadingPosition>;
  recent: RecentEntry[];
  returnTo: string;
}

const Memory = createContext<NavigationMemory | null>(null);

// Mounted only inside a live identity boundary. No browser storage/history payloads.
export function WorkbenchNavigation({ children }: { children: ReactNode }) {
  const [memory] = useState<NavigationMemory>(() => ({
    views: new Map(),
    recent: [],
    returnTo: '/workbench',
  }));
  return <Memory.Provider value={memory}>{children}</Memory.Provider>;
}

export function useWorkbenchMemory() {
  const memory = useContext(Memory);
  if (memory === null) throw new Error('Workbench navigation boundary is missing');
  return memory;
}

export function WorkLink({
  action,
  projectKey,
  id,
  className,
  displayLabel,
}: {
  action: WorkAction;
  projectKey: string;
  id?: string;
  className?: string;
  displayLabel?: string;
}) {
  const memory = useWorkbenchMemory();
  const location = useLocation();
  return (
    <Link
      id={id}
      className={className}
      to={destinationPath(action.destination)}
      onClick={() => {
        memory.returnTo = `${location.pathname}${location.search}`;
        const view = memory.views.get(memory.returnTo);
        if (view) view.focusId = id ?? null;
        // Keep exact navigation references, never a copy of report or candidate content.
        const path = destinationPath(action.destination);
        memory.recent = [
          { projectKey, action },
          ...memory.recent.filter((entry) => destinationPath(entry.action.destination) !== path),
        ].slice(0, 4);
      }}
    >
      {displayLabel ?? action.label} <span aria-hidden="true">→</span>
    </Link>
  );
}

export function UnavailablePage({
  title,
  reason,
  backLabel = '返回我的工作台',
}: {
  title: string;
  reason: string;
  backLabel?: string;
}) {
  const memory = useWorkbenchMemory();
  const params = useParams();
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const version = query.get('version');
  const item = query.get('item');
  return (
    <section className="panel" role="status">
      <p className="eyebrow">页面入口</p>
      <h1 tabIndex={-1}>{title}</h1>
      <p>该页面当前不可用。</p>
      <p>{reason}</p>
      <p className="muted">此入口未执行上传、保存、运行、批准或交付。</p>
      <dl className="wb-route-context">
        {Object.entries(params).map(([key, value]) => (
          <div key={key}>
            <dt>
              {(
                {
                  projectId: '项目',
                  reportId: '报告',
                  requestId: '原请求',
                  fileId: '文件',
                  revisionId: '精确候选',
                  taskId: '任务',
                } as Record<string, string>
              )[key] ?? '引用'}
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
        {version !== null && /^\d{1,10}$/u.test(version) && (
          <div>
            <dt>版本</dt>
            <dd>{version}</dd>
          </div>
        )}
        {item !== null && /^[A-Za-z0-9_-]{1,64}$/u.test(item) && (
          <div>
            <dt>交付项</dt>
            <dd>{item}</dd>
          </div>
        )}
      </dl>
      <p>
        <Link to={memory.returnTo}>{backLabel}</Link>
      </p>
    </section>
  );
}
