import { lazy, Suspense, useEffect, useRef } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { WorkspaceData } from './model.js';
import { ContentBoundary, Missing } from './shell.js';
import { ExecutionNavigation } from './execution/Page.js';
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

const FixtureExecutionProvider = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/execution.js').then((module) => ({
      default: module.FixtureExecutionProvider,
    }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureExecution = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/execution.js').then((module) => ({
      default: module.FixtureExecution,
    }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureExecutionReview = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/execution.js').then((module) => ({
      default: module.FixtureExecutionReview,
    }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});

const FixtureReviewProvider = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/review.js').then((module) => ({
      default: module.ReviewFixtureProvider,
    }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureReviewWorkspace = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/review.js').then((module) => ({
      default: module.FixtureReviewWorkspace,
    }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});

const FixtureDeliveryProvider = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/delivery.js').then((module) => ({
      default: module.FixtureDeliveryProvider,
    }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureU1Provider = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/u1.js').then((module) => ({ default: module.FixtureU1Provider }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureU1Overview = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/u1.js').then((module) => ({ default: module.FixtureU1Overview }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureU2Provider = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/u2.js').then((module) => ({ default: module.FixtureU2Provider }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureU2Stage = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/u2.js').then((module) => ({ default: module.FixtureU2Stage }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureU3Provider = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/u3.js').then((module) => ({ default: module.FixtureU3Provider }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureResultsProvider = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/results.js').then((module) => ({
      default: module.FixtureResultsProvider,
    }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureResultsOverview = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/results.js').then((module) => ({
      default: module.FixtureResultsOverview,
    }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureResultsDetail = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/results.js').then((module) => ({
      default: module.FixtureResultsDetail,
    }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureU3Rework = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/u3.js').then((module) => ({ default: module.FixtureU3Rework }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureU3Recovery = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/u3.js').then((module) => ({ default: module.FixtureU3Recovery }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const FixtureMvpDeliveryRoute = lazy(() => {
  if (__DEV_FIXTURE__)
    return import('./fixtures/u3.js').then((module) => ({
      default: module.FixtureMvpDeliveryRoute,
    }));
  throw new Error('UI_DEVELOPMENT_MODE_REQUIRED');
});
const projectId = 'DEMO-PROJECT-01';

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
                        <ExecutionNavigation>
                          <FixtureExecutionProvider>
                            <FixtureReviewProvider>
                              <FixtureDeliveryProvider>
                                <FixtureU1Provider>
                                  <FixtureU2Provider>
                                    <FixtureU3Provider>
                                      <FixtureResultsProvider>
                                        <FixturePageFocus />
                                        <Routes>
                                          <Route
                                            path="/"
                                            element={<Navigate to="/workbench" replace />}
                                          />
                                          <Route path="/workbench" element={<FixtureWorkbench />} />
                                          <Route
                                            path="/projects/new"
                                            element={<FixtureNewProject />}
                                          />
                                          <Route
                                            path="/projects/:projectId/overview"
                                            element={<FixtureU1Overview />}
                                          />
                                          <Route
                                            path="/projects/:projectId/intake"
                                            element={<FixtureIntake />}
                                          />
                                          <Route
                                            path="/initial-analysis"
                                            element={<FixtureIntake />}
                                          />
                                          <Route
                                            path="/projects/:projectId/analysis/:reportId"
                                            element={<FixtureAnalysis />}
                                          />
                                          <Route
                                            path="/projects/:projectId/startup/:reportId"
                                            element={
                                              <FixtureAnalysisStartup
                                                data={query.data}
                                                key={location.pathname}
                                              />
                                            }
                                          />
                                          <Route
                                            path="/projects/:projectId/stages/:stageId"
                                            element={<FixtureU2Stage />}
                                          />
                                          <Route
                                            path="/projects/:projectId/executions/:requestId"
                                            element={<FixtureExecution data={query.data} />}
                                          />
                                          <Route
                                            path="/projects/:projectId/files/:fileId/revisions/:revisionId"
                                            element={
                                              <FixtureExecutionReview key={location.pathname} />
                                            }
                                          />
                                          <Route
                                            path="/projects/:projectId/rework"
                                            element={<FixtureU3Rework />}
                                          />
                                          <Route
                                            path="/projects/:projectId/recovery"
                                            element={<FixtureU3Recovery />}
                                          />
                                          <Route
                                            path="/projects/:projectId/results"
                                            element={<FixtureResultsOverview />}
                                          />
                                          <Route
                                            path="/projects/:projectId/results/:roundId/:fileId"
                                            element={<FixtureResultsDetail />}
                                          />
                                          <Route
                                            path="/projects/:projectId/delivery"
                                            element={<FixtureMvpDeliveryRoute />}
                                          />
                                          <Route
                                            path="/projects/:projectId/tasks/:taskId"
                                            element={
                                              <UnavailablePage
                                                title="任务详情"
                                                reason="任务详情页面尚未交付。"
                                              />
                                            }
                                          />
                                          <Route
                                            path="/review-workspace"
                                            element={<FixtureReviewWorkspace />}
                                          />
                                          <Route path="*" element={<Missing />} />
                                        </Routes>
                                      </FixtureResultsProvider>
                                    </FixtureU3Provider>
                                  </FixtureU2Provider>
                                </FixtureU1Provider>
                              </FixtureDeliveryProvider>
                            </FixtureReviewProvider>
                          </FixtureExecutionProvider>
                        </ExecutionNavigation>
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
