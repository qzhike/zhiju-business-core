import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  GROUPS,
  workbenchPath,
  type ProjectView,
  type WorkCard,
  type ReadNotice,
  type WorkGroup,
} from './model.js';
import { WorkLink, useWorkbenchMemory, type ReadingPosition } from './navigation.js';
import './workbench.css';

export interface WorkbenchProps {
  projects: readonly ProjectView[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  directory: ReadNotice;
  sources: readonly ReadNotice[];
  cards: readonly WorkCard[];
  coverage: string;
  controls?: ReactNode;
}

export function Workbench({
  projects,
  selectedKey,
  onSelect,
  directory,
  sources,
  cards,
  coverage,
  controls,
}: WorkbenchProps) {
  const memory = useWorkbenchMemory();
  const location = useLocation();
  const navigate = useNavigate();
  const viewKey = `${location.pathname}${location.search}`;
  const [view] = useState<ReadingPosition>(
    () =>
      memory.views.get(viewKey) ?? {
        search: '',
        group: 'attention',
        completed: false,
        more: false,
        focusId: null,
        scroll: {},
      },
  );
  memory.views.set(viewKey, view);
  const [search, setSearch] = useState(view.search);
  const [group, setGroup] = useState(view.group);
  const restored = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = projects.find((project) => project.key === selectedKey);
  const visibleProjects = projects.filter(
    (project) => selectedKey === null || project.key === selectedKey,
  );
  const allowedKeys = new Set(visibleProjects.map((project) => project.key));
  const scopedCards = cards.filter((card) => allowedKeys.has(card.projectKey));
  const filtered = scopedCards.filter((card) =>
    `${card.title} ${card.reason} ${card.context}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const recent = memory.recent.filter((entry) => allowedKeys.has(entry.projectKey));
  const loading =
    directory.state === 'LOADING' || sources.some((source) => source.state === 'LOADING');
  const failed = directory.state === 'ERROR' || sources.some((source) => source.state === 'ERROR');

  useEffect(() => {
    if (loading || restored.current) return;
    const frame = requestAnimationFrame(() => {
      restored.current = true;
      if (view.focusId !== null)
        document.getElementById(view.focusId)?.focus({ preventScroll: true });
      root.current?.querySelectorAll<HTMLElement>('[data-scroll-region]').forEach((element) => {
        element.scrollTop = view.scroll[element.dataset.scrollRegion ?? ''] ?? 0;
      });
      window.scrollTo(0, view.scroll.window ?? 0);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [loading, view]);

  useEffect(() => {
    const save = () => {
      view.scroll.window = window.scrollY;
    };
    window.addEventListener('scroll', save);
    return () => {
      window.removeEventListener('scroll', save);
    };
  }, [view]);

  function selectProject(key: string | null) {
    view.focusId = 'wb-project';
    const path = workbenchPath(projects.find((project) => project.key === key) ?? null);
    const next = memory.views.get(path) ?? {
      search: '',
      group: 'attention',
      completed: false,
      more: false,
      focusId: null,
      scroll: {},
    };
    next.focusId = 'wb-project';
    memory.views.set(path, next);
    onSelect(key);
  }

  function renderGroup(id: WorkGroup) {
    const items = filtered.filter((card) => card.group === id);
    const label = GROUPS.find((entry) => entry.id === id)?.label;
    return (
      <section
        className={`wb-column wb-${id}`}
        data-active={group === id}
        aria-label={label}
        key={id}
      >
        <h3>
          {label} <span aria-label={`${items.length} 张已显示卡片`}>{items.length}</span>
        </h3>
        <div
          className="wb-card-scroll"
          data-scroll-region={id}
          role="region"
          tabIndex={0}
          aria-label={`${label}工作列表`}
          onScroll={(event) => {
            view.scroll[id] = event.currentTarget.scrollTop;
          }}
        >
          <ul className="progress-list wb-cards">
            {items.map((card) => (
              <li key={card.id}>
                <WorkItem
                  card={card}
                  project={projects.find((project) => project.key === card.projectKey)}
                />
              </li>
            ))}
          </ul>
          {items.length === 0 && (
            <p className="wb-empty">
              {loading
                ? '正在读取…'
                : failed
                  ? '来源未完整读取，请查看提示'
                  : search
                    ? '没有匹配的工作'
                    : '当前已读取范围内暂无工作'}
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="workbench" ref={root}>
      <div className="page-head wb-head">
        <div>
          <h1 tabIndex={-1}>我的工作台</h1>
          <p className="muted">从“需要你”开始处理，其他工作继续推进。</p>
        </div>
        <div className="wb-actions">
          <WorkLink
            className="button"
            projectKey=""
            action={{ label: '新建项目', destination: { kind: 'new' } }}
          />
          {selected ? (
            <WorkLink
              className="button primary"
              projectKey={selected.key}
              action={{
                label: '提交客户资料',
                destination: { kind: 'intake', projectId: selected.projectId },
              }}
            />
          ) : (
            <button
              className="primary"
              onClick={() => {
                document.getElementById('wb-project')?.focus();
              }}
            >
              选择项目提交资料
            </button>
          )}
        </div>
      </div>
      <div className="wb-filters">
        <label>
          筛选项目
          <select
            id="wb-project"
            value={selectedKey ?? ''}
            onChange={(event) => {
              selectProject(event.target.value || null);
            }}
          >
            <option value="">全部授权项目</option>
            {projects.map((project) => (
              <option key={project.key} value={project.key}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label className="wb-search">
          查找工作
          <input
            type="search"
            value={search}
            placeholder="工作名称、原因或编号"
            onChange={(event) => {
              view.search = event.target.value;
              setSearch(view.search);
            }}
          />
        </label>
        {search && (
          <button
            onClick={() => {
              view.search = '';
              setSearch('');
            }}
          >
            清除搜索
          </button>
        )}
      </div>
      <section className="panel wb-projects" aria-label="项目进度">
        <div className="wb-section-head">
          <h2>授权项目</h2>
          <span className="muted">
            {directory.state === 'READY' ? directory.detail : '当前授权范围'}
          </span>
        </div>
        <SourceNotice notice={directory} compact />
        <div
          className="wb-project-scroll"
          data-scroll-region="projects"
          onScroll={(event) => {
            view.scroll.projects = event.currentTarget.scrollTop;
          }}
        >
          {visibleProjects.map((project) => (
            <article className="work-item wb-project" key={project.key}>
              <div>
                <h3>{project.name}</h3>
                <p className="muted">
                  {project.code} · {project.status}
                </p>
              </div>
              <p className="wb-progress">{project.progress}</p>
              <div className="wb-project-actions">
                <button
                  aria-pressed={selectedKey === project.key}
                  onClick={() => {
                    selectProject(selectedKey === project.key ? null : project.key);
                  }}
                >
                  {selectedKey === project.key ? '收起看板' : '查看该项目看板'}
                </button>
                <WorkLink
                  projectKey={project.key}
                  action={{
                    label: '准备项目交付',
                    destination: { kind: 'delivery', projectId: project.projectId },
                  }}
                />
                <details className="wb-project-ref">
                  <summary>项目引用</summary>
                  <p>
                    {project.projectId} · 聚合版本 {project.version}
                  </p>
                </details>
              </div>
            </article>
          ))}
        </div>
      </section>
      <div className="wb-context">
        <div className="wb-recent">
          <strong>最近访问</strong>
          {recent.length === 0 ? (
            <span className="muted">打开工作后显示 · 仅本次会话</span>
          ) : (
            recent.map((entry, index) => (
              <WorkLink
                key={index}
                projectKey={entry.projectKey}
                action={entry.action}
                displayLabel={`${projects.find((project) => project.key === entry.projectKey)?.code ?? ''} · ${entry.action.label}`}
              />
            ))
          )}
        </div>
        <details
          open={view.more}
          onToggle={(event) => {
            view.more = event.currentTarget.open;
          }}
        >
          <summary>更多</summary>
          <p>最近访问仅打开原页面，不发起或继续执行。</p>
          <button
            onClick={() => {
              void navigate(workbenchPath(null));
            }}
          >
            查看全部授权项目
          </button>
        </details>
      </div>
      <section className="panel wb-board-panel">
        <h2 className="wb-board-title">{selected ? `项目看板 · ${selected.title}` : '工作看板'}</h2>
        <p className="wb-coverage">{coverage}</p>
        <div className="wb-sources">
          {sources.map((source) => (
            <SourceNotice key={source.id} notice={source} />
          ))}
        </div>
        {selectedKey !== null && selected === undefined && !loading && (
          <p className="notice" role="status">
            该项目未在本次授权目录中找到。请选择当前可见项目或重新读取目录。
          </p>
        )}
        {directory.state === 'EMPTY' && <h3 className="wb-empty">暂无待处理工作</h3>}
        <nav className="wb-group-nav" aria-label="工作分组">
          {GROUPS.filter((item) => item.id !== 'done').map((item) => (
            <button
              key={item.id}
              aria-pressed={group === item.id}
              onClick={() => {
                view.group = item.id;
                setGroup(item.id);
              }}
            >
              {item.label} · {filtered.filter((card) => card.group === item.id).length}
            </button>
          ))}
        </nav>
        <div className="wb-board">
          {(['attention', 'running', 'waiting'] as const).map(renderGroup)}
        </div>
        <details
          className="wb-completed"
          open={view.completed}
          onToggle={(event) => {
            view.completed = event.currentTarget.open;
          }}
        >
          <summary>已完成 · {filtered.filter((card) => card.group === 'done').length}</summary>
          <p className="muted">仅对应卡片所述工作，不表示项目已完成、发布或交付。</p>
          {renderGroup('done')}
        </details>
      </section>
      {controls}
    </div>
  );
}

function WorkItem({ card, project }: { card: WorkCard; project: ProjectView | undefined }) {
  return (
    <article className="wb-card" aria-label={card.title}>
      <p className="wb-card-project">{project?.name}</p>
      <h3>{card.title}</h3>
      <span className={`wb-status wb-${card.group}`}>{card.status}</span>
      <p className="wb-reason">{card.reason}</p>
      {card.counts && (
        <p className="wb-counts" aria-live="polite">
          待检查 <strong>{card.counts.review}</strong> 份 <span>·</span> 处理中{' '}
          <strong>{card.counts.working}</strong> 份
        </p>
      )}
      <p className="wb-card-context">{card.context}</p>
      <div className="wb-card-actions">
        <WorkLink id={`work-${card.id}`} projectKey={card.projectKey} action={card.action} />
        {card.secondaryAction && (
          <WorkLink
            id={`work-${card.id}-secondary`}
            projectKey={card.projectKey}
            action={card.secondaryAction}
          />
        )}
      </div>
    </article>
  );
}

export function SourceNotice({
  notice,
  compact = false,
}: {
  notice: ReadNotice;
  compact?: boolean;
}) {
  if (compact && notice.state === 'READY' && !notice.warning && !notice.action) return null;
  return (
    <div
      className={`wb-source ${notice.state === 'ERROR' ? 'error' : ''}`}
      role={
        notice.state === 'ERROR'
          ? 'alert'
          : notice.state === 'LOADING' || notice.state === 'EMPTY'
            ? 'status'
            : undefined
      }
    >
      <h3>{notice.title}</h3>
      <p>{notice.detail}</p>
      {notice.observation && <p className="muted">{notice.observation}</p>}
      {notice.warning && <p className="wb-warning">{notice.warning}</p>}
      {notice.action && <button onClick={notice.action.run}>{notice.action.label}</button>}
    </div>
  );
}
