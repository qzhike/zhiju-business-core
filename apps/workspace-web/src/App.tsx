import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ReportView, WorkspaceData } from './model.js';
import { ContentBoundary, Missing } from './shell.js';
import { TrustedApp } from './TrustedApp.js';
import { WorkbenchNavigation, UnavailablePage } from './workbench/navigation.js';
const FixtureWorkbenchProvider = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/workbench.js').then((module) => ({
      default: module.FixtureWorkbenchProvider,
    }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureWorkbench = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/workbench.js').then((module) => ({
      default: module.FixtureWorkbench,
    }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});

const FixtureIntakeProvider = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/intake.js').then((module) => ({
      default: module.FixtureIntakeProvider,
    }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureNewProject = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/intake.js').then((module) => ({ default: module.FixtureNewProject }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureIntake = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/intake.js').then((module) => ({ default: module.FixtureIntake }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});

const projectId = 'DEMO-PROJECT-01';
const initialReportId = 'DEMO-STARTUP-REPORT-01';
const reportPath = (reportId = initialReportId) => `/projects/${projectId}/analysis/${reportId}`;

async function loadWorkspace(signal: AbortSignal): Promise<WorkspaceData> {
  if (__DEV_FIXTURE__) {
    const fixture = await import('./fixtures/adapter.js');
    signal.throwIfAborted();
    return fixture.loadFixture();
  }
  const response = await fetch('/bff/bootstrap', {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('UI_SERVICE_UNAVAILABLE');
  // Real authentication and public proxies are intentionally not registered by this shell.
  throw new Error('UI_SERVICE_NOT_CONFIGURED');
}

export function App() {
  return __DEV_FIXTURE__ ? <FixtureApp /> : <TrustedApp />;
}

function FixtureApp() {
  const location = useLocation();
  const heading = useRef<HTMLElement>(null);
  const query = useQuery({
    queryKey: [
      'workspace-shell',
      __DEV_FIXTURE__ ? 'development-fixture' : 'no-session',
      'anonymous-fixture',
      projectId,
      'v1',
    ],
    queryFn: ({ signal }) => loadWorkspace(signal),
    staleTime: Infinity,
  });
  useEffect(() => {
    heading.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [location.pathname, query.status]);
  const retry = () => {
    void query.refetch();
  };
  return (
    <>
      <a className="skip" href="#main">
        跳到主要内容
      </a>
      <header>
        <Link className="brand" to="/workbench">
          <b aria-hidden="true">制</b>
          <strong>制巨</strong>
          <span>质量体系工作空间</span>
        </Link>
        <span className="muted">{__DEV_FIXTURE__ ? '匿名演示 · 非登录身份' : '尚未登录'}</span>
      </header>
      {__DEV_FIXTURE__ && (
        <section aria-label="开发样例模式">
          <div className="demo" role="note">
            开发样例模式 · 合成报告、回执及进度；不上传或读取 ZIP 内容，不调用 Core 或 Runner。
          </div>
        </section>
      )}
      <div className="shell">
        <nav className="sidebar" aria-label="主要导航">
          <Link
            aria-current={location.pathname === '/workbench' ? 'page' : undefined}
            to="/workbench"
          >
            我的工作台
          </Link>
          <Link
            aria-current={location.pathname === '/projects/new' ? 'page' : undefined}
            to="/projects/new"
          >
            新建项目
          </Link>
          <div className="nav-note">
            企业资料与项目成果
            <br />
            由正式服务独立授权
          </div>
        </nav>
        <main id="main" ref={heading}>
          <ContentBoundary>
            {query.isPending ? (
              <section className="panel" role="status">
                <h1 tabIndex={-1}>正在加载工作空间</h1>
                <p>请稍候…</p>
              </section>
            ) : query.isError ? (
              <section className="panel error" role="alert">
                <h1 tabIndex={-1}>工作空间暂不可用</h1>
                <p>
                  {__DEV_FIXTURE__
                    ? '无法读取演示记录。请重试或清除本标签页的演示记录后恢复。'
                    : '登录与公开业务服务尚未接入，暂不能执行业务操作。请联系管理员确认配置。'}
                </p>
                <p className="muted">
                  {__DEV_FIXTURE__ ? 'UI_FIXTURE_UNAVAILABLE' : 'UI_SERVICE_NOT_CONFIGURED'}
                </p>
                <button onClick={retry}>重试加载</button>
                {__DEV_FIXTURE__ && (
                  <button
                    onClick={() => {
                      sessionStorage.removeItem('zhiju-workspace-development-fixture-v1');
                      retry();
                    }}
                  >
                    清除演示记录并重试
                  </button>
                )}
              </section>
            ) : (
              <Suspense
                fallback={
                  <section className="panel" role="status">
                    <h1 tabIndex={-1}>正在加载页面场景</h1>
                    <p>请稍候…</p>
                  </section>
                }
              >
                <WorkbenchNavigation>
                  <FixtureWorkbenchProvider>
                    <FixtureIntakeProvider>
                      <FixturePageFocus />
                      <Routes>
                        <Route path="/" element={<Navigate to="/workbench" replace />} />
                        <Route path="/workbench" element={<FixtureWorkbench />} />
                        <Route path="/projects/new" element={<FixtureNewProject />} />
                        <Route path="/projects/:projectId/intake" element={<FixtureIntake />} />
                        <Route path="/initial-analysis" element={<FixtureIntake />} />
                        <Route
                          path="/projects/:projectId/analysis/:reportId"
                          element={<ReportPage data={query.data} />}
                        />
                        <Route
                          path="/projects/:projectId/startup/:reportId"
                          element={<Startup data={query.data} key={location.pathname} />}
                        />
                        <Route
                          path="/projects/:projectId/executions/:requestId"
                          element={<Execution data={query.data} />}
                        />
                        <Route
                          path="/projects/:projectId/files/:fileId/revisions/:revisionId"
                          element={
                            <UnavailablePage
                              title="检查文件"
                              reason="精确文件检查页面尚未交付；此处保留候选版本入口。"
                            />
                          }
                        />
                        <Route
                          path="/projects/:projectId/delivery"
                          element={
                            <UnavailablePage
                              title="项目交付"
                              reason="项目交付页面尚未交付；此处未生成交付包。"
                            />
                          }
                        />
                        <Route
                          path="/projects/:projectId/tasks/:taskId"
                          element={
                            <UnavailablePage title="任务详情" reason="任务详情页面尚未交付。" />
                          }
                        />
                        <Route path="*" element={<Missing />} />
                      </Routes>
                    </FixtureIntakeProvider>
                  </FixtureWorkbenchProvider>
                </WorkbenchNavigation>
              </Suspense>
            )}
          </ContentBoundary>
        </main>
      </div>
    </>
  );
}

function FixturePageFocus() {
  const location = useLocation();
  useEffect(() => {
    document.querySelector<HTMLElement>('#main h1')?.focus();
  }, [location.pathname]);
  return null;
}

function getReport(data: WorkspaceData, params: { projectId?: string; reportId?: string }) {
  return data.reports.find(
    (r) => r.projectId === params.projectId && r.reportId === params.reportId,
  );
}

export function SafeMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => {
        if (url.startsWith('/') && !url.startsWith('//')) return url;
        try {
          const parsed = new URL(url);
          return ['https:', 'http:'].includes(parsed.protocol) &&
            !parsed.username &&
            !parsed.password
            ? url
            : '';
        } catch {
          return '';
        }
      }}
      components={{
        img: () => <span>（外部图片不加载）</span>,
        a: ({ href, children: text }) =>
          href ? (
            <a href={href} rel="noreferrer noopener">
              {text}
            </a>
          ) : (
            <span>{text}</span>
          ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

function ReportPage({ data }: { data: WorkspaceData }) {
  const params = useParams();
  const report = getReport(data, params);
  const [arrived, setArrived] = useState(false);
  if (!report) return <Missing />;
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">青禾制造 · 精确报告第 {report.version} 版 · 演示</p>
          <h1 tabIndex={-1}>分析总览</h1>
          <p className="muted">
            {report.reportId} · {report.title}
          </p>
        </div>
        <Link className="button primary" to={`/projects/${projectId}/startup/${report.reportId}`}>
          核对信息与文件范围 →
        </Link>
      </div>
      {arrived && (
        <div className="notice" role="status">
          有新演示报告到达，当前仍是第 {report.version} 版。
          <Link to={reportPath('DEMO-STARTUP-REPORT-02')}>查看第 2 版</Link>
        </div>
      )}
      <div className="report-grid">
        <div>
          <section className="panel">
            <div className="status-tag">部分读取 · 演示分析</div>
            <h2>{report.summary}</h2>
            <ul>
              {report.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section className="panel markdown">
            <h2>报告说明</h2>
            <SafeMarkdown>{report.narrative}</SafeMarkdown>
          </section>
        </div>
        <aside className="panel">
          <h2>需要处理的事项</h2>
          <p className="muted">客户补充与顾问判断分别保留</p>
          {report.attention.map((item) => (
            <details key={item.id}>
              <summary>{item.title}</summary>
              <p>{item.reason}</p>
              <small>
                {item.audience === 'CUSTOMER' ? '客户需补充' : '顾问需判断'} · {item.id}
              </small>
            </details>
          ))}
          <button
            onClick={() => {
              setArrived(true);
            }}
          >
            模拟新报告到达
          </button>
        </aside>
      </div>
    </>
  );
}

function Startup({ data }: { data: WorkspaceData }) {
  const params = useParams();
  const report = getReport(data, params);
  if (params.projectId === 'DEMO-PROJECT-02')
    return (
      <UnavailablePage
        title="核对信息与文件范围"
        reason="此项目尚无精确报告读取场景；未确认或启动。"
      />
    );
  return report ? <StartupScope data={data} report={report} /> : <Missing />;
}

function StartupScope({ data, report }: { data: WorkspaceData; report: ReportView }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState(() => data.selected(report.reportId));
  const [search, setSearch] = useState('');
  const [chapter, setChapter] = useState('全部文件');
  const [missing, setMissing] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [error, setError] = useState('');
  const intent = useRef(crypto.randomUUID());
  const [open, setOpen] = useState(false);
  const allowed = selected.length > 0 && !missing && !error;
  const visible = report.files.filter(
    (f) =>
      (chapter === '全部文件' || f.chapter === chapter) &&
      `${f.title} ${f.code}`.includes(search.trim()),
  );
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    try {
      data.saveSelection(report.reportId, next);
      setSelected(next);
      setError('');
    } catch {
      setError('无法保存演示选择，当前选择保留，请恢复浏览器存储后重试。');
    }
  };
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">
            青禾制造 · {report.reportId} · 第 {report.version} 版
          </p>
          <h1 tabIndex={-1}>核对信息，选择本轮文件</h1>
          <p className="muted">一次明确确认必要信息与所选文件的完整处理计划</p>
        </div>
        <Link to={reportPath(report.reportId)}>返回分析总览</Link>
      </div>
      {arrived && (
        <div className="notice" role="status">
          新演示结果已到达，当前页面、选择及第 {report.version} 版保持。
          <Link to={reportPath('DEMO-STARTUP-REPORT-02')}>查看新报告</Link>
        </div>
      )}
      <section className="panel scope">
        <div className="scope-top">
          <h2>开始前，核对这 3 类信息</h2>
          <span className="status-tag">项目仍在资料准备 · 演示</span>
        </div>
        <div className="information-grid">
          {report.information.map((item) => (
            <details key={item.id}>
              <summary>
                <small>{item.title}</small>
                <strong>
                  {missing && item.id === 'product' ? '缺少产品范围依据，需客户补充' : item.summary}
                </strong>
                <span>查看客户依据 ⌄</span>
              </summary>
              <p>
                <b>
                  {item.sourceTitle} · {item.locator}
                </b>
              </p>
              <p>{item.excerpt}</p>
              <small>{item.candidateRef}</small>
            </details>
          ))}
        </div>
        {missing && (
          <div className="error" role="alert">
            暂不能启动：缺少必要产品范围依据。文件选择已保留，请先补充资料。
          </div>
        )}
        <div className="scope-body">
          <nav className="chapter-nav" aria-label="文件章节">
            {['全部文件', ...new Set(report.files.map((f) => f.chapter))].map((item) => (
              <button
                key={item}
                aria-pressed={item === chapter}
                onClick={() => {
                  setChapter(item);
                }}
              >
                {item}
              </button>
            ))}
          </nav>
          <div className="file-list">
            <div className="toolbar">
              <label>
                查找文件
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                  }}
                  placeholder="文件名称或编号"
                />
              </label>
              <span className="muted">
                显示 {visible.length} / {report.files.length} 份 · 清单完整
              </span>
            </div>
            <p className="muted">未勾选的文件本轮不处理；每次选择整份完整计划。</p>
            {visible.length === 0 && (
              <p className="empty" role="status">
                没有符合条件的文件
              </p>
            )}
            {visible.map((file) => (
              <article className="file-plan" key={file.id}>
                <div className="file-plan-main">
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`选择${file.title}`}
                      disabled={!file.selectable}
                      checked={selected.includes(file.id)}
                      onChange={() => {
                        toggle(file.id);
                      }}
                    />
                    <div>
                      <small>
                        {file.code || '拟新建'} · {file.chapter}
                      </small>
                      <h3>{file.title}</h3>
                    </div>
                  </label>
                  <span className={file.selectable ? 'status-tag' : 'waiting-tag'}>
                    {file.selectable ? '本轮可处理' : '整份等待'}
                  </span>
                </div>
                <p>{file.reason}</p>
                <details>
                  <summary>查看本轮计划与依据</summary>
                  <p>{file.plan}</p>
                  <p>客户资料：{file.source}</p>
                </details>
              </article>
            ))}
          </div>
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
            <button
              onClick={() => {
                try {
                  data.saveSelection(report.reportId, selected);
                  setError('');
                } catch {
                  /* Safe state remains visible. */
                }
              }}
            >
              重试保存
            </button>
          </div>
        )}
        <footer className="scope-footer">
          <div>
            <strong>
              已选 {selected.length} / {report.files.filter((f) => f.selectable).length} 份
            </strong>
            <p className="muted">同时确认以上必要信息与完整文件范围</p>
          </div>
          <AlertDialog.Root open={open} onOpenChange={setOpen}>
            <AlertDialog.Trigger asChild>
              <button className="primary" disabled={!allowed}>
                确认信息与范围并开始
              </button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="dialog-overlay" />
              <AlertDialog.Content className="dialog-content">
                <AlertDialog.Title>确认本轮演示范围</AlertDialog.Title>
                <AlertDialog.Description>
                  你将确认报告第 {report.version} 版的必要信息与所选 {selected.length}{' '}
                  份完整计划。只生成演示回执，不创建项目、上传资料或调用 Runner。
                </AlertDialog.Description>
                <ul>
                  {report.files
                    .filter((f) => selected.includes(f.id))
                    .map((f) => (
                      <li key={f.id}>
                        {f.title} · {f.plan}
                      </li>
                    ))}
                </ul>
                <p className="muted">精确报告：{report.reportId}</p>
                <div className="dialog-actions">
                  <AlertDialog.Cancel asChild>
                    <button>返回核对</button>
                  </AlertDialog.Cancel>
                  <button
                    className="primary"
                    onClick={() => {
                      if (!allowed) return;
                      try {
                        const execution = data.confirm(report.reportId, selected, intent.current);
                        void navigate(`/projects/${projectId}/executions/${execution.requestId}`);
                      } catch {
                        setError('无法保存演示回执；未开始执行，请勿重复确认。');
                        setOpen(false);
                      }
                    }}
                  >
                    确认并查看演示进度
                  </button>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </footer>
      </section>
      <div className="fixture-options">
        <label>
          <input
            type="checkbox"
            checked={missing}
            onChange={(event) => {
              setMissing(event.target.checked);
            }}
          />
          演示必要信息缺失
        </label>
        <button
          onClick={() => {
            setArrived(true);
          }}
        >
          模拟新结果到达
        </button>
      </div>
    </>
  );
}

function Execution({ data }: { data: WorkspaceData }) {
  const params = useParams();
  const request = data.execution(params.requestId ?? '');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    }, 5000);
    const focus = () => {
      setNow(Date.now());
    };
    window.addEventListener('focus', focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, []);
  if (!request || request.projectId !== params.projectId) {
    if (
      (params.projectId === projectId || params.projectId === 'DEMO-PROJECT-02') &&
      params.requestId?.startsWith('WB-')
    )
      return (
        <UnavailablePage
          title="文件进度"
          reason="此精确请求的文件进度页面尚未交付；本入口未开始或重试任何工作。"
        />
      );
    return <Missing />;
  }
  const report = data.reports.find((r) => r.reportId === request.reportId);
  const ready = now - request.createdAt >= 5000;
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">青禾制造 · 报告第 {request.version} 版</p>
          <h1 tabIndex={-1}>本轮执行进度</h1>
          <p className="muted">{request.requestId}</p>
        </div>
        <Link to="/workbench">返回工作台</Link>
      </div>
      <section className="panel">
        <div className="notice" role="status">
          演示回执与进度 · 未调用 Core 或 Runner，不表示真实业务成功
        </div>
        <h2>{ready ? '演示候选已就绪，等待检查' : '演示范围已记录，等待安排'}</h2>
        <p>
          精确报告：{request.reportId} · 第 {request.version} 版
        </p>
        <p>本轮 {request.fileIds.length} 份文件 · 整份完整计划</p>
        <ul className="progress-list">
          {request.fileIds.map((id) => (
            <li key={id}>
              <strong>{report?.files.find((f) => f.id === id)?.title}</strong>
              <span>{ready ? '待检查（演示）' : '待安排（演示）'}</span>
            </li>
          ))}
        </ul>
        <p className="muted">
          旧报告和原请求保持，可离开页面后通过本链接回读演示状态。没有真实完成百分比或 Runner
          Receipt。
        </p>
        <Link to={reportPath(request.reportId)}>查看本轮精确报告</Link>
      </section>
    </>
  );
}
