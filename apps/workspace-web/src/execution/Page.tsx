import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useWorkbenchMemory } from '../workbench/navigation.js';
import {
  candidatePath,
  matchingReceipt,
  newRoundView,
  roundPath,
  scopedFiles,
  stateLabels,
  type ExecutionRound,
  type RetryIntent,
  type RetryReceipt,
  type RoundView,
} from './model.js';
import './execution.css';

const Memory = createContext<Map<string, RoundView> | null>(null);
// Lives inside the existing identity boundary; no customer content in browser storage.
export function ExecutionNavigation({ children }: { children: ReactNode }) {
  const [views] = useState(() => new Map<string, RoundView>());
  return <Memory.Provider value={views}>{children}</Memory.Provider>;
}
export interface ExecutionPageProps {
  rounds: readonly ExecutionRound[];
  phase?: 'AVAILABLE' | 'LOADING' | 'ERROR' | 'EXPIRED' | 'UNAVAILABLE';
  reason?: string;
  retry?: (intent: RetryIntent) => Promise<RetryReceipt>;
  readRetry?: (intent: RetryIntent) => Promise<RetryReceipt>;
  reload?: () => void;
  controls?: ReactNode;
}
export function ExecutionPage(props: ExecutionPageProps) {
  const { projectId, requestId } = useParams();
  const views = useContext(Memory);
  if (!views) throw new Error('Execution navigation boundary is missing');
  const round = props.rounds.find(
    (item) => item.projectId === projectId && item.requestId === requestId,
  );
  const phase = props.phase ?? 'AVAILABLE';
  if (phase !== 'AVAILABLE' || !round)
    return (
      <section className="panel execution-gate">
        <h1 tabIndex={-1}>本轮执行进度</h1>
        <p role={phase === 'ERROR' || phase === 'EXPIRED' ? 'alert' : 'status'}>
          {phase === 'LOADING'
            ? '正在读取文件进度…'
            : phase === 'EXPIRED'
              ? '访问已失效，已停止显示文件进度。'
              : phase === 'ERROR'
                ? '文件进度读取失败，不能将缺失信息视为执行失败或完成。'
                : (props.reason ?? '无法读取此精确请求的文件进度；请求可能不存在或当前不可访问。')}
        </p>
        {(phase === 'ERROR' || phase === 'LOADING') && props.reload && (
          <button onClick={props.reload}>重新读取进度</button>
        )}
        <BackLink />
        {props.controls}
      </section>
    );
  const key = roundPath(round);
  let view = views.get(key);
  if (!view) {
    view = newRoundView();
    views.set(key, view);
  }
  return <RoundPage key={key} {...props} round={round} view={view} />;
}
function BackLink() {
  const memory = useWorkbenchMemory();
  // Workbench return targets are internal navigation context, never external return URLs.
  const target = /^\/workbench(?:\?|$)/u.test(memory.returnTo) ? memory.returnTo : '/workbench';
  return <Link to={target}>返回工作台</Link>;
}
function RoundPage({
  round,
  view,
  rounds,
  retry,
  readRetry,
  controls,
}: ExecutionPageProps & {
  round: ExecutionRound;
  view: RoundView;
}) {
  const navigate = useNavigate();
  const memory = useWorkbenchMemory();
  const [, render] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const live = useRef(true);
  const patch = (change: Partial<RoundView>) => {
    Object.assign(view, change);
    render((n) => n + 1);
  };
  useLayoutEffect(() => {
    live.current = true;
    if (list.current) list.current.scrollTop = view.scroll;
    return () => {
      live.current = false;
    };
  }, [view]);
  const files = scopedFiles(round);
  const visible = files.filter(
    (file) =>
      (view.filter === 'ALL' || file.state === view.filter) &&
      `${file.title} ${file.code}`
        .toLocaleLowerCase()
        .includes(view.search.trim().toLocaleLowerCase()),
  );
  const requestRetry = (
    intent: RetryIntent,
    action: (intent: RetryIntent) => Promise<RetryReceipt>,
  ) => {
    // Lock synchronously before awaiting: a second click cannot create another intent.
    view.retries.set(intent.fileId, { ...intent, state: 'PENDING' });
    render((n) => n + 1);
    void Promise.resolve()
      .then(() => action(intent))
      .then((receipt) => {
        view.retries.set(
          intent.fileId,
          matchingReceipt(intent, receipt) ? receipt : { ...intent, state: 'UNKNOWN' },
        );
      })
      .catch(() => {
        view.retries.set(intent.fileId, { ...intent, state: 'UNKNOWN' });
      })
      .finally(() => {
        if (live.current) render((n) => n + 1);
      });
  };
  return (
    <div className="execution-page">
      <div className="page-head">
        <div>
          <p className="eyebrow">文件工作 · {round.label}</p>
          <h1 tabIndex={-1}>本轮执行进度</h1>
          <p className="muted">已确认范围 · {round.requestId}</p>
        </div>
        <BackLink />
      </div>
      <section className="panel execution-panel">
        <div className="execution-heading">
          <label>
            查看轮次
            <select
              value={round.requestId}
              onChange={(event) => {
                const selected = rounds.find(
                  (item) =>
                    item.projectId === round.projectId && item.requestId === event.target.value,
                );
                if (selected) {
                  view.scroll = list.current?.scrollTop ?? view.scroll;
                  void navigate(roundPath(selected));
                }
              }}
            >
              {rounds
                .filter((item) => item.projectId === round.projectId)
                .map((item) => (
                  <option key={item.requestId} value={item.requestId}>
                    {item.label} · {item.requestId}
                  </option>
                ))}
            </select>
          </label>
          <p className="execution-counts" role="status">
            本轮 {files.length} 份 ·{' '}
            {Object.entries(stateLabels)
              .map(
                ([state, label]) =>
                  `${label} ${files.filter((file) => file.state === state).length}`,
              )
              .join(' · ')}
          </p>
        </div>
        <div className="execution-tools">
          <label>
            查找本轮文件
            <input
              type="search"
              placeholder="文件名称或编号"
              value={view.search}
              onChange={(event) => {
                patch({ search: event.target.value });
              }}
            />
          </label>
          <label>
            文件状态
            <select
              value={view.filter}
              onChange={(event) => {
                patch({ filter: event.target.value as RoundView['filter'] });
              }}
            >
              <option value="ALL">全部状态</option>
              {Object.entries(stateLabels).map(([state, label]) => (
                <option key={state} value={state}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <span className="muted">
            显示 {visible.length} / {files.length} 份 · 已确认范围完整
          </span>
        </div>
        <div
          className="execution-list"
          ref={list}
          onScroll={(event) => {
            view.scroll = event.currentTarget.scrollTop;
          }}
        >
          {visible.length === 0 && (
            <p className="empty" role="status">
              {files.length === 0 ? '本轮没有已确认文件。' : '没有符合条件的文件。'}
            </p>
          )}
          {visible.map((file) => {
            const href = candidatePath(round, file);
            const receipt = view.retries.get(file.id);
            return (
              <article className="execution-file" key={file.id} data-state={file.state}>
                <div className="execution-file-head">
                  <div>
                    <small>
                      {file.code || '文件引用'} · {file.id}
                    </small>
                    <h2>{file.title}</h2>
                  </div>
                  <strong
                    className={file.state === 'FAILED' ? 'execution-failure-label' : 'status-tag'}
                  >
                    {stateLabels[file.state]}
                  </strong>
                </div>
                <p>{file.update}</p>
                <p className="muted">最新更新：{file.updatedAt || '尚未取得可核验时间'}</p>
                {file.failure && (
                  <p className="error execution-failure">失败原因：{file.failure}</p>
                )}
                <div className="execution-actions">
                  {href && (
                    <Link
                      className="button"
                      to={href}
                      onClick={() => {
                        memory.returnTo = roundPath(round);
                      }}
                    >
                      检查文件 · {file.candidate?.revisionId}
                    </Link>
                  )}
                  {file.state === 'FAILED' && file.retryAllowed && retry && !receipt && (
                    <button
                      onClick={() => {
                        if (view.retries.has(file.id)) return;
                        requestRetry(
                          {
                            id: crypto.randomUUID(),
                            projectId: round.projectId,
                            requestId: round.requestId,
                            fileId: file.id,
                          },
                          retry,
                        );
                      }}
                    >
                      重新处理本文件
                    </button>
                  )}
                  {file.state === 'FAILED' && (!file.retryAllowed || !retry) && !receipt && (
                    <span className="muted">
                      {file.retryAllowed
                        ? '重试能力尚未接入，暂不能提交。'
                        : '当前未获服务端重试许可。'}
                    </span>
                  )}
                  {receipt && (
                    <div role="status">
                      <strong>
                        {receipt.state === 'UNKNOWN'
                          ? '重试结果待核验'
                          : receipt.state === 'ACCEPTED'
                            ? '重试请求已接收，等待安排'
                            : '重试请求等待回执'}
                      </strong>
                      <p className="muted">原意图 {receipt.id} · 接收回执不表示开始执行</p>
                      {receipt.state === 'UNKNOWN' && readRetry && (
                        <button
                          onClick={() => {
                            requestRetry(receipt, readRetry);
                          }}
                        >
                          查询原重试请求
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {file.failures.length > 0 && (
                  <details>
                    <summary>失败历史（{file.failures.length}）</summary>
                    {file.failures.map((failure, index) => (
                      <p key={index}>{failure}</p>
                    ))}
                  </details>
                )}
              </article>
            );
          })}
        </div>
        <div className="execution-secondary">
          <details
            open={view.scopeOpen}
            onToggle={(event) => {
              view.scopeOpen = event.currentTarget.open;
            }}
          >
            <summary>本轮范围与报告依据</summary>
            <p>
              {round.requestId} · {round.reportId} · 第 {round.reportVersion} 版
            </p>
            <p>确认文件：{round.confirmedFileIds.join('、') || '无'}</p>
            <Link
              to={`/projects/${encodeURIComponent(round.projectId)}/analysis/${encodeURIComponent(round.reportId)}`}
            >
              查看本轮精确报告
            </Link>
          </details>
          <details
            open={view.summaryOpen}
            onToggle={(event) => {
              view.summaryOpen = event.currentTarget.open;
            }}
          >
            <summary>运行摘要</summary>
            <p>{round.summary}</p>
          </details>
          <details
            open={view.logsOpen}
            onToggle={(event) => {
              view.logsOpen = event.currentTarget.open;
            }}
          >
            <summary>运行日志</summary>
            {round.logs.length ? (
              round.logs.map((log, index) => <p key={index}>{log}</p>)
            ) : (
              <p>尚无可读取日志。</p>
            )}
          </details>
        </div>
      </section>
      {controls}
    </div>
  );
}
