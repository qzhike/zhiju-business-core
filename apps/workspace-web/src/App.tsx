import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { WorkspaceData } from './model.js';
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

const FixtureAnalysisProvider = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/analysis.js').then((module) => ({
      default: module.FixtureAnalysisProvider,
    }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureAnalysis = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/analysis.js').then((module) => ({ default: module.FixtureAnalysis }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureAnalysisStartup = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/analysis.js').then((module) => ({
      default: module.FixtureAnalysisStartup,
    }));
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
                      <FixtureAnalysisProvider>
                        <FixturePageFocus />
                        <Routes>
                          <Route path="/" element={<Navigate to="/workbench" replace />} />
                          <Route path="/workbench" element={<FixtureWorkbench />} />
                          <Route path="/projects/new" element={<FixtureNewProject />} />
                          <Route path="/projects/:projectId/intake" element={<FixtureIntake />} />
                          <Route path="/initial-analysis" element={<FixtureIntake />} />
                          <Route
                            path="/projects/:projectId/analysis/:reportId"
                            element={<FixtureAnalysis />}
                          />
                          <Route
                            path="/projects/:projectId/startup/:reportId"
                            element={
                              <FixtureAnalysisStartup data={query.data} key={location.pathname} />
                            }
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
                      </FixtureAnalysisProvider>
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
