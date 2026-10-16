// Trusted Human workspace shell (production entry).
//
// Replaces the anonymous-fixture-only production path with the real journey:
// boot session probe -> authorized project directory -> explicit project
// selection -> per-project EP/TE boards. The explicit development fixture mode
// lives in `App.tsx` and is never reachable from this module.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { DeliveryPage } from './delivery/Page.js';
import { ExecutionNavigation, ExecutionPage } from './execution/Page.js';
import { ContentBoundary, Missing } from './shell.js';
import { MarkdownReview } from './MarkdownReview.js';
import { DIRECTORY_SCOPE_KEY } from './trusted/protocol.js';
import { LiveNewProject, LivePreparationRequest } from './intake/LivePreparation.js';
import { TrustedIntake } from './intake/TrustedIntake.js';
import { TrustedWorkbench } from './workbench/TrustedWorkbench.js';
import { WorkbenchNavigation, UnavailablePage } from './workbench/navigation.js';
import { selectedProjectKey } from './workbench/model.js';
import { postLogout } from './trusted/client.js';
import {
  bindGuard,
  createReadBoundary,
  invalidateGuard,
  scopeGuard,
  type LiveGuard,
} from './trusted/guard.js';
import { runLogout } from './trusted/logout.js';
import {
  publishInvalidation,
  useIdleRenewal,
  useTabInvalidation,
  useTrustedSession,
} from './trusted/hooks.js';
import {
  hasCallbackFailure,
  signInHref,
  stripCallbackParams,
  type SessionProbe,
} from './trusted/session.js';

export function TrustedApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const heading = useRef<HTMLElement>(null);
  const [readBoundary] = useState(createReadBoundary);
  const session = useTrustedSession(readBoundary);
  // URL identifiers are navigation only; directory and board reads still authorize independently.
  const selectedKey =
    location.pathname === '/workbench' ? selectedProjectKey(location.search) : null;
  const [retiredProbe, setRetiredProbe] = useState<SessionProbe | null>(null);
  const [callbackFailed] = useState(() => hasCallbackFailure(window.location.search));
  const guardRef = useRef<LiveGuard>({ generation: 0, principalId: null, scopes: [] });
  const boundSession = useRef<string | null>(null);

  const probe = session.probe;
  // True from the moment logout retires this tab until the re-probe replaces
  // the probe that was live when logout started.
  const logoutPending = retiredProbe !== null && probe === retiredProbe;
  const live =
    session.phase === 'READY' &&
    probe.state === 'ALLOWED' &&
    probe.session !== null &&
    !logoutPending;
  const principalId = probe.session?.principal.principalId ?? null;
  const sessionGeneration = probe.session?.sessionGeneration ?? '';
  const csrfToken = probe.session?.csrfToken ?? '';
  const reviewScopeKey = /\/artifacts\/[^/]+\/revisions\/[^/]+$/.test(location.pathname)
    ? `${location.pathname}${location.search}`
    : null;

  // Derived during render so child effects always observe the current guard
  // (child effects run before parent effects). A new principal/session advances
  // the generation; a project selection only changes the live scope set.
  const guard = useMemo(() => {
    const scopes = [
      DIRECTORY_SCOPE_KEY,
      ...(selectedKey === null ? [] : [selectedKey]),
      ...(reviewScopeKey === null ? [] : [reviewScopeKey]),
    ];
    if (!live || principalId === null) {
      boundSession.current = null;
      return invalidateGuard(guardRef.current);
    }
    if (boundSession.current === sessionGeneration) return scopeGuard(guardRef.current, scopes);
    boundSession.current = sessionGeneration;
    return bindGuard(guardRef.current, { principalId, scopes });
  }, [live, principalId, sessionGeneration, selectedKey, reviewScopeKey]);
  guardRef.current = guard;

  const reload = session.reload;
  const onSessionFailure = useCallback(() => {
    reload();
  }, [reload]);

  useIdleRenewal(csrfToken, live);
  useTabInvalidation(onSessionFailure);

  useEffect(() => {
    // The re-probe produced a new summary object: drop the retired one so the
    // tab never keeps a stale principal/csrf summary alive.
    if (retiredProbe !== null && probe !== retiredProbe) setRetiredProbe(null);
  }, [probe, retiredProbe]);

  useEffect(() => {
    if (!hasCallbackFailure(window.location.search)) return;
    const clean = stripCallbackParams(window.location.search);
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${clean.length > 0 ? `?${clean}` : ''}`,
    );
  }, []);

  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      // bfcache: clear sensitive view state before re-reading the session.
      if (event.persisted) {
        reload();
      }
    };
    window.addEventListener('pageshow', restore);
    return () => {
      window.removeEventListener('pageshow', restore);
    };
  }, [reload]);

  useEffect(() => {
    heading.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [location.pathname, session.phase, probe.state]);

  const logout = useCallback(() => {
    // Session Delta §6: advance the generation, cancel old reads and clear the
    // protected view *before* the awaited (best-effort IdP revocation) call.
    void runLogout({
      retireIdentity: () => {
        guardRef.current = invalidateGuard(guardRef.current);
        boundSession.current = null;
        setRetiredProbe(probe);
      },
      cancelReads: () => {
        readBoundary.abort();
      },
      clearView: () => {
        setRetiredProbe(probe);
      },
      notifyPeers: publishInvalidation,
      requestLogout: () => postLogout(csrfToken),
      reprobe: reload,
    });
  }, [csrfToken, probe, readBoundary, reload]);

  const principal = probe.session?.principal ?? null;
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
        {logoutPending ? (
          <span className="muted">正在退出登录…</span>
        ) : principal === null ? (
          <span className="muted">尚未登录</span>
        ) : (
          <span className="muted">
            {principal.displayName ?? principal.principalId} · 已登录
            <button onClick={logout}>退出登录</button>
          </span>
        )}
      </header>
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
            项目与看板
            <br />
            由公开服务独立授权
          </div>
        </nav>
        <main id="main" ref={heading}>
          <ContentBoundary>
            {session.phase === 'LOADING' ? (
              <LoadingPanel />
            ) : logoutPending ? (
              <LogoutPanel />
            ) : live ? (
              <WorkbenchNavigation key={`${sessionGeneration}:${principalId ?? ''}`}>
                <ExecutionNavigation>
                  <Routes>
                    <Route
                      path="/projects/:projectId/artifacts/:artifactId/revisions/:revisionId"
                      element={
                        <MarkdownReview
                          key={`${sessionGeneration}:${reviewScopeKey}`}
                          sessionGeneration={sessionGeneration}
                          principalId={principalId ?? ''}
                          csrfToken={csrfToken}
                          generation={guard.generation}
                          guardRef={guardRef}
                          readBoundary={readBoundary}
                          scopeKey={reviewScopeKey ?? ''}
                          onSessionFailure={onSessionFailure}
                        />
                      }
                    />
                    <Route path="/" element={<Navigate to="/workbench" replace />} />
                    <Route
                      path="/workbench"
                      element={
                        <TrustedWorkbench
                          sessionGeneration={sessionGeneration}
                          principalId={principalId ?? ''}
                          csrfToken={csrfToken}
                          generation={guard.generation}
                          guardRef={guardRef}
                          readBoundary={readBoundary}
                          onSessionFailure={onSessionFailure}
                          selectedKey={selectedKey}
                          onSelect={(key) => {
                            const match = /^project:([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/u.exec(
                              key ?? '',
                            );
                            void navigate(
                              match
                                ? `/workbench?enterprise=${match[1]}&project=${match[2]}`
                                : '/workbench',
                            );
                          }}
                        />
                      }
                    />
                    <Route
                      path="/projects/new"
                      element={
                        <LiveNewProject
                          sessionGeneration={sessionGeneration}
                          principalId={principalId ?? ''}
                          csrfToken={csrfToken}
                          generation={guard.generation}
                          guardRef={guardRef}
                          readBoundary={readBoundary}
                          onSessionFailure={onSessionFailure}
                        />
                      }
                    />
                    <Route
                      path="/preparations/:requestId"
                      element={
                        <LivePreparationRequest
                          key={`${sessionGeneration}:${location.pathname}${location.search}`}
                          sessionGeneration={sessionGeneration}
                          principalId={principalId ?? ''}
                          csrfToken={csrfToken}
                          generation={guard.generation}
                          guardRef={guardRef}
                          readBoundary={readBoundary}
                          onSessionFailure={onSessionFailure}
                        />
                      }
                    />
                    <Route
                      path="/projects/:projectId/intake"
                      element={
                        <TrustedIntake
                          sessionGeneration={sessionGeneration}
                          principalId={principalId ?? ''}
                          csrfToken={csrfToken}
                          generation={guard.generation}
                          guardRef={guardRef}
                          readBoundary={readBoundary}
                          onSessionFailure={onSessionFailure}
                        />
                      }
                    />
                    <Route
                      path="/initial-analysis"
                      element={
                        <TrustedIntake
                          sessionGeneration={sessionGeneration}
                          principalId={principalId ?? ''}
                          csrfToken={csrfToken}
                          generation={guard.generation}
                          guardRef={guardRef}
                          readBoundary={readBoundary}
                          onSessionFailure={onSessionFailure}
                        />
                      }
                    />
                    <Route
                      path="/projects/:projectId/analysis/:reportId"
                      element={
                        <UnavailablePage
                          title="分析总览"
                          reason="报告读取尚未接入公开操作，不能显示任何替代报告。"
                        />
                      }
                    />
                    <Route
                      path="/projects/:projectId/startup/:reportId"
                      element={
                        <UnavailablePage
                          title="核对信息与文件范围"
                          reason="启动核对尚未接入公开操作；未注册字段不能成为私有入口。"
                        />
                      }
                    />
                    <Route
                      path="/projects/:projectId/executions/:requestId"
                      element={
                        <ExecutionPage
                          rounds={[]}
                          phase="UNAVAILABLE"
                          reason="文件级进度读取与重试尚未接入已注册授权操作，不能显示替代进度或发起重试。"
                        />
                      }
                    />
                    <Route
                      path="/projects/:projectId/files/:fileId/revisions/:revisionId"
                      element={
                        <UnavailablePage
                          title="检查文件"
                          reason="精确候选读取与检查页面尚未接入，不能据此确认检查或批准。"
                        />
                      }
                    />
                    <Route
                      path="/projects/:projectId/delivery"
                      element={<DeliveryPage phase="UNAVAILABLE" />}
                    />
                    <Route
                      path="/projects/:projectId/tasks/:taskId"
                      element={
                        <UnavailablePage
                          title="任务详情"
                          reason="任务详情页面尚未接入；任务引用不等于执行请求或文件候选。"
                        />
                      }
                    />
                    <Route path="*" element={<Missing />} />
                  </Routes>
                </ExecutionNavigation>
              </WorkbenchNavigation>
            ) : (
              <AccessGate
                probe={probe}
                callbackFailed={callbackFailed}
                returnTo={`${location.pathname}${location.search}`}
                onRetry={reload}
              />
            )}
          </ContentBoundary>
        </main>
      </div>
    </>
  );
}

function LoadingPanel() {
  return (
    <section className="panel" role="status">
      <h1 tabIndex={-1}>正在加载工作空间</h1>
      <p>正在确认当前会话与授权范围…</p>
    </section>
  );
}

function LogoutPanel() {
  return (
    <section className="panel" role="status">
      <h1 tabIndex={-1}>正在退出登录</h1>
      <p>已清除本标签页的会话身份与受保护内容，正在等待服务端完成退出与撤销…</p>
      <p className="muted">退出完成前不会显示任何项目、看板或会话摘要</p>
    </section>
  );
}

function AccessGate({
  probe,
  callbackFailed,
  returnTo,
  onRetry,
}: {
  probe: SessionProbe;
  callbackFailed: boolean;
  returnTo: string;
  onRetry: () => void;
}) {
  if (probe.state === 'DENIED') {
    return (
      <section className="panel error" role="alert">
        <h1 tabIndex={-1}>没有可访问的工作空间</h1>
        <p>当前身份已认证但没有可用的企业关联，不能进入任何一个 Project。</p>
        <p className="muted">ACCESS_DENIED · 如需授权请联系管理员，本页不会重复尝试登录。</p>
      </section>
    );
  }
  if (probe.state === 'UNAVAILABLE') {
    return (
      <section className="panel error" role="alert">
        <h1 tabIndex={-1}>工作空间暂不可用</h1>
        <p>登录与公开业务服务尚未接入，暂不能执行业务操作。请联系管理员确认配置。</p>
        <p className="muted">{probe.code}</p>
        <button onClick={onRetry}>重试加载</button>
      </section>
    );
  }
  const expired = probe.state === 'SESSION_EXPIRED';
  return (
    <section className="panel error" role="alert">
      <h1 tabIndex={-1}>{callbackFailed ? '登录未完成' : expired ? '需要重新登录' : '需要登录'}</h1>
      <p>
        登录与公开业务服务尚未接入当前浏览器会话。
        {expired ? '会话已过期，请重新登录后继续。' : '请使用企业账号登录后继续。'}
      </p>
      {callbackFailed && <p>本次登录未完成，未建立任何会话；请重新发起登录。</p>}
      <p>
        <a className="button primary" href={signInHref(returnTo)}>
          使用企业账号登录
        </a>
      </p>
      <p className="muted">{expired ? 'UI_SESSION_EXPIRED' : 'UI_REAUTH_REQUIRED'}</p>
    </section>
  );
}
