import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import type { ReportView } from '../model.js';

export interface ScopeReceipt {
  requestId: string;
  reportId: string;
  version: number;
  fileIds: string[];
}

interface Props {
  report: ReportView;
  selected: string[];
  unavailable: Record<string, string>;
  startupBlocker?: string | undefined;
  prior: ScopeReceipt[];
  latestReportId: string;
  status?: 'READY' | 'PENDING' | 'UNKNOWN' | undefined;
  onSelectionChange: (ids: string[]) => void;
  onConfirm: (ids: string[], intentId: string) => void;
  onPlanOpinion: (fileId: string) => void;
  development?: boolean;
  controls?: ReactNode;
}

export function StartupPage({
  report,
  selected,
  unavailable,
  startupBlocker,
  prior,
  latestReportId,
  status = 'READY',
  onSelectionChange,
  onConfirm,
  onPlanOpinion,
  development = false,
  controls,
}: Props) {
  const [search, setSearch] = useState('');
  const [chapter, setChapter] = useState('全部文件');
  const [filter, setFilter] = useState('全部状态');
  const [open, setOpen] = useState(false);
  const intent = useRef(crypto.randomUUID());
  const priorByFile = new Map(
    prior.flatMap((receipt) => receipt.fileIds.map((id) => [id, receipt])),
  );
  const reason = (id: string) =>
    unavailable[id] ??
    (!report.files.find((file) => file.id === id)?.selectable
      ? (report.files.find((file) => file.id === id)?.reason ?? '当前计划不可选')
      : undefined);
  const current = report.reportId === latestReportId;
  const eligible = (id: string) => !reason(id) && !priorByFile.has(id);
  const validSelected = selected.length > 0 && selected.every((id) => eligible(id));
  const canConfirm = current && validSelected && !startupBlocker && status === 'READY';
  const visible = report.files.filter(
    (file) =>
      (chapter === '全部文件' || file.chapter === chapter) &&
      (filter === '全部状态' ||
        (filter === '本轮可处理' ? eligible(file.id) : !eligible(file.id))) &&
      `${file.title} ${file.code}`.includes(search.trim()),
  );
  useEffect(() => {
    if (!open) intent.current = crypto.randomUUID();
  }, [open]);
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
        <Link to={`/projects/${report.projectId}/analysis/${report.reportId}`}>返回分析总览</Link>
      </div>
      {!current && (
        <div className="notice" role="status">
          当前报告已更新，原选择保留供核对。请查看新报告后重新选择。{' '}
          <Link to={`/projects/${report.projectId}/startup/${latestReportId}`}>查看当前报告</Link>
        </div>
      )}
      {prior.length > 0 && (
        <div className="notice" role="status">
          已确认范围保持原记录；新增轮次只可选择尚未纳入的文件。
          {prior.map((receipt) => (
            <Link
              key={receipt.requestId}
              to={`/projects/${report.projectId}/executions/${receipt.requestId}`}
            >
              {' '}
              第 {receipt.version} 版已确认范围 {receipt.requestId}
            </Link>
          ))}
        </div>
      )}
      <section className="panel scope">
        <div className="scope-top">
          <h2>开始前，核对这 3 类信息</h2>
          <span className="status-tag">项目仍在资料准备{development ? ' · 演示' : ''}</span>
        </div>
        <div className="information-grid">
          {report.information.map((item) => (
            <details key={item.id}>
              <summary>
                <small>{item.title}</small>
                <strong>{item.summary}</strong>
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
        {startupBlocker && (
          <div className="error" role="alert">
            暂不能启动：{startupBlocker}。文件选择已保留，请先补充资料。
          </div>
        )}
        {status !== 'READY' && (
          <div className="notice" role="status">
            {status === 'PENDING'
              ? '原确认请求正在核验，请等待回执。'
              : '原确认结果未知，请查询同一请求；不能再次提交。'}
          </div>
        )}
        <div className="scope-body">
          <nav className="chapter-nav" aria-label="文件章节">
            {['全部文件', ...new Set(report.files.map((file) => file.chapter))].map((name) => (
              <button
                key={name}
                aria-pressed={chapter === name}
                onClick={() => {
                  setChapter(name);
                }}
              >
                {name}
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
              <label>
                处理状态
                <select
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                  }}
                >
                  <option>全部状态</option>
                  <option>本轮可处理</option>
                  <option>暂不能处理</option>
                </select>
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
            {visible.map((file) => {
              const blocked = reason(file.id);
              const included = priorByFile.get(file.id);
              const unavailableReason = included
                ? `已纳入第 ${included.version} 版范围（${included.requestId}），不能重复选择。`
                : blocked;
              return (
                <article className="file-plan" key={file.id}>
                  <div className="file-plan-main">
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`选择${file.title}`}
                        aria-describedby={unavailableReason ? `scope-reason-${file.id}` : undefined}
                        disabled={!eligible(file.id) || !current || status !== 'READY'}
                        checked={selected.includes(file.id)}
                        onChange={() => {
                          onSelectionChange(
                            selected.includes(file.id)
                              ? selected.filter((id) => id !== file.id)
                              : [...selected, file.id],
                          );
                        }}
                      />
                      <div>
                        <small>
                          {file.code || '拟新建'} · {file.chapter}
                        </small>
                        <h3>{file.title}</h3>
                      </div>
                    </label>
                    <span className={unavailableReason ? 'waiting-tag' : 'status-tag'}>
                      {unavailableReason ? '暂不能处理' : '本轮可处理'}
                    </span>
                  </div>
                  {unavailableReason ? (
                    <p className="scope-unavailable-reason" id={`scope-reason-${file.id}`}>
                      {unavailableReason}
                    </p>
                  ) : (
                    <p>{file.reason}</p>
                  )}
                  {unavailableReason && selected.includes(file.id) && (
                    <button
                      className="scope-remove-selection"
                      disabled={!current || status !== 'READY'}
                      onClick={() => {
                        onSelectionChange(selected.filter((id) => id !== file.id));
                      }}
                    >
                      从本轮选择中移除{file.title}
                    </button>
                  )}
                  <details>
                    <summary>查看本轮计划与依据</summary>
                    <p>{file.plan}</p>
                    <p>客户资料：{file.source}</p>
                  </details>
                  <button
                    className="scope-opinion"
                    onClick={() => {
                      onPlanOpinion(file.id);
                    }}
                  >
                    对这项计划提意见
                  </button>
                </article>
              );
            })}
          </div>
        </div>
        <footer className="scope-footer">
          <div>
            <strong>
              已选 {selected.length} 份 · 本轮可选{' '}
              {report.files.filter((file) => eligible(file.id)).length} 份
            </strong>
            <p className="muted">同时确认以上必要信息与完整文件范围</p>
          </div>
          <AlertDialog.Root open={open} onOpenChange={setOpen}>
            <AlertDialog.Trigger asChild>
              <button className="primary" disabled={!canConfirm}>
                确认信息与范围并开始
              </button>
            </AlertDialog.Trigger>
            <AlertDialog.Portal>
              <AlertDialog.Overlay className="dialog-overlay" />
              <AlertDialog.Content className="dialog-content">
                <AlertDialog.Title>确认本轮{development ? '演示' : ''}范围</AlertDialog.Title>
                <AlertDialog.Description>
                  你将确认报告第 {report.version} 版的必要信息与所选 {selected.length} 份完整计划。
                  {development
                    ? '只生成演示回执，不创建项目、上传资料或调用 Runner。'
                    : '提交结果以服务回执为准。'}
                </AlertDialog.Description>
                <ul>
                  {report.files
                    .filter((file) => selected.includes(file.id))
                    .map((file) => (
                      <li key={file.id}>
                        {file.title} · {file.plan}
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
                    disabled={!canConfirm}
                    onClick={() => {
                      if (canConfirm) onConfirm(selected, intent.current);
                    }}
                  >
                    确认并查看{development ? '演示' : '本轮'}进度
                  </button>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Portal>
          </AlertDialog.Root>
        </footer>
      </section>
      {controls}
    </>
  );
}
