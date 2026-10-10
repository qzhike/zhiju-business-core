// Trusted Human workspace shell (production entry).
//
// Replaces the anonymous-fixture-only production path with the real journey:
// boot session probe -> authorized project directory -> explicit project
// selection -> per-project EP/TE boards. The explicit development fixture mode
// lives in `App.tsx` and is never reachable from this module.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { ContentBoundary, Missing } from './shell.js';
import {
  DIRECTORY_OPERATION,
  DIRECTORY_SCOPE_KEY,
  OPERATION_VERSION,
  PROJECT_BOARD_OPERATION,
  TASK_BOARD_OPERATION,
  buildDirectoryQueryInput,
  buildProjectBoardQueryInput,
  buildTaskBoardQueryInput,
  parseDirectoryPage,
  parseProjectBoardPage,
  parseTaskBoardPage,
  type BoardRow,
  type DirectoryCard,
  type DirectoryQueryArgs,
} from './trusted/protocol.js';
import { postLogout } from './trusted/client.js';
import { bindGuard, invalidateGuard, scopeGuard, type LiveGuard } from './trusted/guard.js';
import {
  publishInvalidation,
  useIdleRenewal,
  usePageChain,
  useTabInvalidation,
  useTrustedSession,
  type PageChain,
} from './trusted/hooks.js';
import { MAX_AUTO_PAGES } from './trusted/pagination.js';
import {
  hasCallbackFailure,
  signInHref,
  stripCallbackParams,
  type SessionProbe,
} from './trusted/session.js';

const cardKey = (card: DirectoryCard) => card.key;
const boardRowKey = (row: BoardRow) => row.key;

const ERROR_COPY: Record<string, string> = {
  UI_SERVICE_NOT_CONFIGURED: '尚未接入该公开服务，不能显示任何替代内容。',
  DEPENDENCY_UNAVAILABLE: '依赖服务暂不可用，未显示任何数据。',
  UI_SESSION_EXPIRED: '会话已过期。',
  UI_REAUTH_REQUIRED: '需要重新登录。',
  UI_PROJECTION_STALE: '数据当前不是最新，已停止显示。',
  UI_CLIENT_STATE_INVALID: '返回内容不符合约定，已停止显示。',
  ACCESS_DENIED: '当前身份无权读取。',
  AUTHORIZATION_REVOKED: '授权已撤销。',
  NOT_FOUND: '该精确对象对你当前权限不可见。',
  QUERY_CURSOR_INVALID: '读取位置已失效，已从第一页重新开始。',
  QUERY_CURSOR_SCOPE_MISMATCH: '授权集合已变化，已从第一页重新开始。',
  QUERY_CURSOR_EXPIRED: '读取位置已过期，已从第一页重新开始。',
  UI_PROJECTION_FAILED: '来源投影失败，已停止显示。',
};

const FRESHNESS_COPY: Record<string, string> = {
  FRESH: '当前观察',
  STALE: '滞后',
  PAUSED: '暂停',
  REBUILDING: '重建中',
  FAILED: '失败',
};

function errorCopy(code: string | null): string {
  return (code === null ? undefined : ERROR_COPY[code]) ?? '无法安全读取该数据，已停止显示。';
}

function observationText(
  snapshotAt: string | null,
  watermarks: readonly { sourceModule: string; sequence: number }[],
): string {
  const observed = snapshotAt ?? '未知观察时间';
  const levels = watermarks.map((item) => `${item.sourceModule}#${item.sequence}`);
  return `观察点 ${observed} · 水位 ${levels.length > 0 ? levels.join('、') : '无源水位'}`;
}

export function TrustedApp() {
  const location = useLocation();
  const heading = useRef<HTMLElement>(null);
  const session = useTrustedSession();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [callbackFailed] = useState(() => hasCallbackFailure(window.location.search));
  const guardRef = useRef<LiveGuard>({ generation: 0, principalId: null, scopes: [] });
  const boundSession = useRef<string | null>(null);

  const probe = session.probe;
  const live = session.phase === 'READY' && probe.state === 'ALLOWED' && probe.session !== null;
  const principalId = probe.session?.principal.principalId ?? null;
  const sessionGeneration = probe.session?.sessionGeneration ?? '';
  const csrfToken = probe.session?.csrfToken ?? '';

  // Derived during render so child effects always observe the current guard
  // (child effects run before parent effects). A new principal/session advances
  // the generation; a project selection only changes the live scope set.
  const guard = useMemo(() => {
    const scopes = [DIRECTORY_SCOPE_KEY, ...(selectedKey === null ? [] : [selectedKey])];
    if (!live || principalId === null) {
      boundSession.current = null;
      return invalidateGuard(guardRef.current);
    }
    if (boundSession.current === sessionGeneration) return scopeGuard(guardRef.current, scopes);
    boundSession.current = sessionGeneration;
    return bindGuard(guardRef.current, { principalId, scopes });
  }, [live, principalId, sessionGeneration, selectedKey]);
  guardRef.current = guard;

  const reload = session.reload;
  const onSessionFailure = useCallback(() => {
    setSelectedKey(null);
    reload();
  }, [reload]);

  useIdleRenewal(csrfToken, live);
  useTabInvalidation(onSessionFailure);

  useEffect(() => {
    if (!live) setSelectedKey(null);
  }, [live]);

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
        setSelectedKey(null);
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
    setSelectedKey(null);
    publishInvalidation();
    void postLogout(csrfToken)
      .catch(() => 0)
      .then(() => {
        reload();
      });
  }, [csrfToken, reload]);

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
        {principal === null ? (
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
            ) : live ? (
              <Routes>
                <Route path="/" element={<Navigate to="/workbench" replace />} />
                <Route
                  path="/workbench"
                  element={
                    <DirectoryWorkbench
                      sessionGeneration={sessionGeneration}
                      principalId={principalId ?? ''}
                      csrfToken={csrfToken}
                      generation={guard.generation}
                      guardRef={guardRef}
                      onSessionFailure={onSessionFailure}
                      selectedKey={selectedKey}
                      onSelect={setSelectedKey}
                    />
                  }
                />
                <Route
                  path="/projects/new"
                  element={
                    <UnavailableFeature
                      title="新建项目"
                      reason="资料准备（D14）公开操作尚未注册，不能创建企业或项目事实。"
                    />
                  }
                />
                <Route
                  path="/projects/:projectId/intake"
                  element={
                    <UnavailableFeature
                      title="准备首轮客户资料"
                      reason="ZIP 接收与分析报告接纳的公开操作尚未注册；本页不会读取或上传任何文件。"
                    />
                  }
                />
                <Route
                  path="/projects/:projectId/analysis/:reportId"
                  element={
                    <UnavailableFeature
                      title="分析总览"
                      reason="报告读取尚未接入公开操作，不能显示任何替代报告。"
                    />
                  }
                />
                <Route
                  path="/projects/:projectId/startup/:reportId"
                  element={
                    <UnavailableFeature
                      title="核对信息与文件范围"
                      reason="启动核对尚未接入公开操作；未注册字段不能成为私有入口。"
                    />
                  }
                />
                <Route
                  path="/projects/:projectId/executions/:requestId"
                  element={
                    <UnavailableFeature
                      title="本轮执行进度"
                      reason="Runner 执行进度尚未接入，不显示合成百分比或回执。"
                    />
                  }
                />
                <Route path="*" element={<Missing />} />
              </Routes>
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

function DirectoryWorkbench({
  sessionGeneration,
  principalId,
  csrfToken,
  generation,
  guardRef,
  onSessionFailure,
  selectedKey,
  onSelect,
}: {
  sessionGeneration: string;
  principalId: string;
  csrfToken: string;
  generation: number;
  guardRef: { readonly current: LiveGuard };
  onSessionFailure: () => void;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const directory = usePageChain<DirectoryCard>({
    sessionGeneration,
    principalId,
    operation: DIRECTORY_OPERATION,
    version: OPERATION_VERSION,
    scopeKey: DIRECTORY_SCOPE_KEY,
    generation,
    csrfToken,
    enabled: true,
    guardRef,
    buildBody: buildDirectoryQueryInput,
    parsePage: parseDirectoryPage,
    keyOf: cardKey,
    onSessionFailure,
  });
  const selected =
    selectedKey === null
      ? null
      : (directory.state.items.find((card) => card.key === selectedKey) ?? null);
  useEffect(() => {
    if (selectedKey !== null && selected === null && !directory.state.enumerating) onSelect(null);
  }, [directory.state.enumerating, onSelect, selected, selectedKey]);
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">工作空间</p>
          <h1 tabIndex={-1}>我的工作台</h1>
          <p className="muted">只显示当前授权范围内的项目；选中项目后按精确范围读取看板</p>
        </div>
      </div>
      <DirectoryPanel chain={directory} selectedKey={selectedKey} onSelect={onSelect} />
      {selected !== null && (
        <ProjectBoards
          key={selected.key}
          card={selected}
          sessionGeneration={sessionGeneration}
          principalId={principalId}
          csrfToken={csrfToken}
          generation={generation}
          guardRef={guardRef}
          onSessionFailure={onSessionFailure}
        />
      )}
      <UnavailableCapabilities />
    </>
  );
}

function DirectoryPanel({
  chain,
  selectedKey,
  onSelect,
}: {
  chain: PageChain<DirectoryCard>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}) {
  const { state } = chain;
  if (state.dataState === 'LOADING') {
    return (
      <section className="panel" role="status">
        <h2>正在读取授权项目目录</h2>
        <p>
          {state.enumerating
            ? '第一页没有匹配项目，目录仍在按绑定游标继续枚举…'
            : '正在读取第一页…'}
        </p>
        <p className="muted">不显示未授权项目或任何全局总数</p>
      </section>
    );
  }
  if (state.dataState === 'EMPTY') {
    return (
      <section className="panel empty" role="status">
        <h2>没有可访问的项目</h2>
        <p>目录已完整枚举，当前身份没有任何授权项目。</p>
        <p className="muted">不显示空占位数据或样例项目</p>
      </section>
    );
  }
  if (state.dataState === 'ERROR') {
    return (
      <section className="panel error" role="alert">
        <h2>无法读取项目目录</h2>
        <p>{errorCopy(chain.failureCode)}</p>
        <p className="muted">{chain.failureCode}</p>
        <button onClick={chain.reload}>重新读取目录</button>
        {state.items.length > 0 && (
          <p>已显示的 {state.items.length} 个项目保持不动，未被视为完整目录。</p>
        )}
      </section>
    );
  }
  return (
    <section className="panel">
      <div className="toolbar">
        <h2>授权项目</h2>
        <span className="muted">
          已显示 {state.items.length} 个项目
          {state.enumerating ? ' · 目录尚未枚举完' : ' · 本次枚举完整'}
        </span>
      </div>
      {state.enumerating && (
        <p className="notice" role="status">
          目录仍在继续读取，当前列表不是完整集合。
          {state.inFlight ? '正在读取下一页…' : ''}
          {!state.inFlight && <button onClick={chain.loadMore}>继续读取</button>}
        </p>
      )}
      <div className="report-grid">
        {state.items.map((card) => (
          <ProjectCard
            key={card.key}
            card={card}
            selected={card.key === selectedKey}
            onSelect={onSelect}
          />
        ))}
      </div>
      <p className="muted">
        每页最多 50 项、每次最多继续 {MAX_AUTO_PAGES} 页；本地显示数量不是全局总数。
      </p>
    </section>
  );
}

function ProjectCard({
  card,
  selected,
  onSelect,
}: {
  card: DirectoryCard;
  selected: boolean;
  onSelect: (key: string | null) => void;
}) {
  const active = card.status === 'ACTIVE';
  return (
    <article className="work-item">
      <div className={active ? 'status-tag' : 'waiting-tag'}>
        {active ? '进行中' : `非进行中 · ${card.status}`}
      </div>
      <h3>
        {card.enterpriseDisplayName} · {card.title}
      </h3>
      <p className="muted">
        {card.displayCode} · 聚合版本 {card.aggregateVersion} · {card.projectId}
      </p>
      <div className="work-footer">
        <span className="muted">{active ? '可读取项目看板' : '非进行中项目看板仅供参考'}</span>
        <button
          aria-pressed={selected}
          onClick={() => {
            onSelect(selected ? null : card.key);
          }}
        >
          {selected ? '收起看板' : '查看该项目看板'}
        </button>
      </div>
    </article>
  );
}

function ProjectBoards({
  card,
  sessionGeneration,
  principalId,
  csrfToken,
  generation,
  guardRef,
  onSessionFailure,
}: {
  card: DirectoryCard;
  sessionGeneration: string;
  principalId: string;
  csrfToken: string;
  generation: number;
  guardRef: { readonly current: LiveGuard };
  onSessionFailure: () => void;
}) {
  const shared = {
    sessionGeneration,
    principalId,
    scopeKey: card.key,
    generation,
    csrfToken,
    enabled: true,
    guardRef,
    keyOf: boardRowKey,
    onSessionFailure,
  };
  const buildDelivery = useMemo(
    () => (ids: DirectoryQueryArgs) => buildProjectBoardQueryInput({ ...ids, card }),
    [card],
  );
  const buildTasks = useMemo(
    () => (ids: DirectoryQueryArgs) => buildTaskBoardQueryInput({ ...ids, card }),
    [card],
  );
  const delivery = usePageChain<BoardRow>({
    ...shared,
    operation: PROJECT_BOARD_OPERATION,
    version: OPERATION_VERSION,
    buildBody: buildDelivery,
    parsePage: parseProjectBoardPage,
  });
  const tasks = usePageChain<BoardRow>({
    ...shared,
    operation: TASK_BOARD_OPERATION,
    version: OPERATION_VERSION,
    buildBody: buildTasks,
    parsePage: parseTaskBoardPage,
  });
  return (
    <section className="panel">
      <div className="scope-top">
        <h2>项目看板 · {card.title}</h2>
        <span className="status-tag">精确项目范围 · {card.displayCode}</span>
      </div>
      <p className="muted">
        交付项与任务由各自 owning 模块独立授权与读取，分别保留一致性、水位与完整分母。
      </p>
      <div className="report-grid">
        <BoardPanel
          title="交付项看板（EP）"
          chain={delivery}
          unavailableHint="该项目交付项看板当前不可用"
        />
        <BoardPanel
          title="任务看板（TE）"
          chain={tasks}
          unavailableHint="该项目任务看板当前不可用"
        />
      </div>
    </section>
  );
}

function BoardPanel({
  title,
  chain,
  unavailableHint,
}: {
  title: string;
  chain: PageChain<BoardRow>;
  unavailableHint: string;
}) {
  const { state } = chain;
  const unavailable =
    chain.failureKind === 'UNAVAILABLE' ||
    chain.failureKind === 'NOT_FOUND' ||
    chain.failureKind === 'DENIED';
  return (
    <div>
      <div className="toolbar">
        <h3>{title}</h3>
        <span className="muted">
          {state.dataState === 'READY' || state.dataState === 'EMPTY'
            ? `本次读取 ${state.items.length} 条`
            : '尚未读取'}
        </span>
      </div>
      {state.dataState === 'LOADING' && (
        <p role="status">
          {state.enumerating ? '第一页没有匹配项，仍在按绑定游标继续读取…' : '正在读取…'}
        </p>
      )}
      {state.dataState === 'EMPTY' && (
        <p role="status">该看板当前完整枚举为空（末页无游标且本次读取零条），不代表业务已完成。</p>
      )}
      {state.dataState === 'ERROR' && (
        <div className="error" role="alert">
          <strong>{unavailable ? unavailableHint : '无法读取该看板'}</strong>
          <p>{errorCopy(chain.failureCode)}</p>
          <p className="muted">{chain.failureCode}</p>
          <button onClick={chain.reload}>重新读取</button>
        </div>
      )}
      {(state.dataState === 'READY' || state.dataState === 'EMPTY') &&
        state.observation !== null && (
          <p className="muted">
            {observationText(state.observation.snapshotAt, state.observation.sourceWatermarks)} ·{' '}
            {FRESHNESS_COPY[state.observation.freshness] ?? state.observation.freshness}
          </p>
        )}
      {state.observation !== null && state.observation.freshness !== 'FRESH' && (
        <p className="notice" role="status">
          该看板为 {FRESHNESS_COPY[state.observation.freshness] ?? state.observation.freshness}
          ，显示的是已观察数据，不是当前最新。
        </p>
      )}
      {state.items.length > 0 && (
        <ul className="progress-list">
          {state.items.map((row) => (
            <li key={row.key}>
              <strong>{row.title}</strong>
              <span>
                {row.status}
                {row.version === null ? '' : ` · 版本 ${row.version}`}
                {row.secondary === null ? '' : ` · ${row.secondary}`}
                {row.blockers > 0 ? ` · 阻断 ${row.blockers}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {state.enumerating && (
        <p className="notice" role="status">
          本次读取 {state.items.length} 条，仍有绑定游标未读完
          {state.inFlight ? '，正在继续读取…' : ''}
          {!state.inFlight && <button onClick={chain.loadMore}>继续读取</button>}
        </p>
      )}
    </div>
  );
}

function UnavailableCapabilities() {
  return (
    <section className="panel">
      <h2>当前不可用的能力</h2>
      <p className="muted">下列能力保持不可用，不会用样例、缓存或合成结果代替。</p>
      <ul className="progress-list">
        <li>
          <strong>客户 ZIP 接收与报告分析</strong>
          <span>未接入公开操作 · 不可用</span>
        </li>
        <li>
          <strong>资料准备（D14）</strong>
          <span>公开操作未注册 · 不可用</span>
        </li>
        <li>
          <strong>Runner 执行进度与原件下载</strong>
          <span>无已注册的受权通道 · 不可用</span>
        </li>
      </ul>
    </section>
  );
}

function UnavailableFeature({ title, reason }: { title: string; reason: string }) {
  return (
    <section className="panel" role="status">
      <h1 tabIndex={-1}>{title}</h1>
      <p>该页面当前不可用。</p>
      <p className="muted">{reason}</p>
      <Link to="/workbench">返回我的工作台</Link>
    </section>
  );
}
