import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { SafeMarkdown } from '../App.js';
import {
  contextFor,
  customerRequests,
  emptyDraft,
  requestText,
  type AnalysisReport,
  type AnalysisState,
  type Context,
  type Submission,
} from './model.js';
import './analysis.css';
const areas = {
  customer: '客户需补充',
  judgment: '顾问需判断',
  files: '拟交付文件',
  evidence: '报告依据',
} as const;
type Area = keyof typeof areas;
interface Props {
  report: AnalysisReport;
  state: AnalysisState;
  update: (change: (state: AnalysisState) => AnalysisState) => void;
  historical: boolean;
  submit?: (input: Submission) => void;
  records: ReactNode;
  controls?: ReactNode;
  updateNotice?: ReactNode;
  roundSummary?: string | undefined;
}
export function AnalysisPage({
  report,
  state,
  update,
  historical,
  submit,
  records,
  controls,
  updateNotice,
  roundSummary,
}: Props) {
  const [params, setParams] = useSearchParams();
  const [mobileView, setMobileView] = useState<'report' | 'composer'>('report');
  const area = params.get('view') as Area | null;
  const activeArea = area && area in areas ? area : null;
  const itemId = params.get('item');
  const reader = useRef<HTMLDivElement>(null);
  const listReader = useRef<HTMLDivElement>(null);
  const itemReader = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const focusComposer = useRef(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [manual, setManual] = useState(false);
  const copyField = useRef<HTMLTextAreaElement>(null);
  const copyTrigger = useRef<HTMLElement | null>(null);
  const requests = customerRequests(report);
  const judgments = report.attentionItems.filter((item) => item.audience === 'CONSULTANT');
  const viewKey = `${activeArea ?? 'overview'}:${itemId ?? ''}`;
  useLayoutEffect(() => {
    if (reader.current) reader.current.scrollTop = state.scroll[viewKey] ?? 0;
    if (listReader.current) listReader.current.scrollTop = state.scroll[`${activeArea}:list`] ?? 0;
    if (itemReader.current) itemReader.current.scrollTop = state.scroll[`${viewKey}:item`] ?? 0;
    if (focusComposer.current && composer.current) {
      composer.current.focus();
      focusComposer.current = false;
    } else if (!focusComposer.current) heading.current?.focus();
  }, [viewKey, report.reportId, state.context.key, mobileView]);
  const navigate = (view?: Area, item?: string) => {
    update((current) => ({
      ...current,
      scroll: { ...current.scroll, [viewKey]: reader.current?.scrollTop ?? 0 },
    }));
    setParams(view ? { view, ...(item ? { item } : {}) } : {});
  };
  const selectContext = (context: Context) => {
    focusComposer.current = true;
    setMobileView('composer');
    update((current) => ({ ...current, context }));
    navigate();
  };
  const draft = state.drafts[state.context.key] ?? emptyDraft;
  const setDraft = (change: Partial<typeof draft>) => {
    update((current) => ({
      ...current,
      drafts: {
        ...current.drafts,
        [current.context.key]: {
          ...(current.drafts[current.context.key] ?? emptyDraft),
          ...change,
        },
      },
    }));
  };
  const pending = state.receipts.some(
    (receipt) =>
      receipt.input.context.key === state.context.key &&
      ['PENDING', 'UNKNOWN', 'RECEIVED'].includes(receipt.state),
  );
  const stale =
    state.context.projectId !== report.projectId ||
    state.context.reportId !== report.reportId ||
    state.context.version !== report.version;
  const openCopy = (all: boolean) => {
    copyTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPreview(
      requestText(
        all ? requests : requests.filter((request) => state.selected.includes(request.key)),
      ),
    );
    setCopyStatus('');
    setManual(false);
  };
  const copy = async () => {
    try {
      if (!('clipboard' in navigator)) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(preview ?? '');
      setCopyStatus('已复制，请自行发送给客户；未发送或标记交付。');
    } catch {
      setManual(true);
      setCopyStatus('无法自动复制，请在预览中手动选择并复制。');
      requestAnimationFrame(() => {
        copyField.current?.focus();
        copyField.current?.select();
      });
    }
  };
  const showEvidence = (ids: string[]) => (
    <div className="analysis-evidence">
      {ids.map((id) => {
        const evidence = report.evidence.find((entry) => entry.id === id);
        return evidence ? (
          <details key={id}>
            <summary>
              {id} · {evidence.sourceId} · {evidence.locator.value}
            </summary>
            <p>{evidence.note}</p>
            <small>
              {evidence.representation === 'ORIGINAL'
                ? '原件定位'
                : '提取件定位，不能替代原件图形核验'}{' '}
              · {evidence.locator.kind}
            </small>
          </details>
        ) : (
          <p key={id}>{id} · 当前报告未提供此依据，请重新核对</p>
        );
      })}
    </div>
  );
  const cards: Record<
    Area,
    { count: number; summary: string; entries: { id: string; title: string }[] }
  > = {
    customer: {
      count: requests.length,
      summary: '先补缺失资料，再核对读取限制与企业事实。',
      entries: requests.map((request) => ({ id: request.key, title: request.title })),
    },
    judgment: {
      count: judgments.length,
      summary: '企业保护与专业判断须顾问处理，不能由模板或客户回信替代。',
      entries: judgments,
    },
    files: {
      count: report.plannedFiles.length,
      summary: '按整份文件核对计划；待补充事项不阻止查看本轮范围。',
      entries: report.plannedFiles,
    },
    evidence: {
      count: report.evidence.length,
      summary: '来源定位、读取限制和 Runner 声明检查；未执行的核验仍未执行。',
      entries: report.checks,
    },
  };
  const customerItem = requests.find((request) => request.key === itemId);
  const judgment = judgments.find((item) => item.id === itemId);
  const file = report.plannedFiles.find((item) => item.id === itemId);
  const list = activeArea
    ? cards[activeArea].entries.filter(
        (entry) =>
          `${entry.title} ${entry.id}`.includes(state.search) &&
          (activeArea !== 'customer' ||
            state.category === 'ALL' ||
            requests
              .find((request) => request.key === entry.id)
              ?.items.some((item) => item.kind === state.category)),
      )
    : [];
  return (
    <section className="analysis-page" data-mobile-view={activeArea ? 'report' : mobileView}>
      <div className="analysis-header">
        <div>
          <p className="eyebrow">
            精确报告第 {report.version} 版 · {report.reportId}
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {activeArea ? areas[activeArea] : '分析总览'}
          </h1>
          <p className="muted">{report.title}</p>
        </div>
        {historical ? (
          <strong className="waiting-tag">历史报告 · 只读</strong>
        ) : (
          <Link
            className="button primary"
            to={`/projects/${report.projectId}/startup/${report.reportId}`}
          >
            核对信息与文件范围 →
          </Link>
        )}
      </div>
      {!activeArea && (
        <nav className="analysis-mobile-switch" aria-label="分析阅读与意见视图">
          <button
            aria-pressed={mobileView === 'report'}
            onClick={() => {
              setMobileView('report');
            }}
          >
            查看报告
          </button>
          <button
            aria-pressed={mobileView === 'composer'}
            onClick={() => {
              focusComposer.current = true;
              setMobileView('composer');
            }}
          >
            意见与补充
          </button>
        </nav>
      )}
      {updateNotice}
      {roundSummary && !activeArea && (
        <div className="notice" role="status">
          本轮变化：{roundSummary} 建议已解决仍待核对，不代表正式关闭或文件批准。
        </div>
      )}
      {activeArea && (
        <nav className="analysis-tabs" aria-label="分析详情导航">
          <button
            onClick={() => {
              navigate();
            }}
          >
            返回分析总览
          </button>
          {(Object.keys(areas) as Area[]).map((key) => (
            <button
              key={key}
              aria-pressed={activeArea === key}
              onClick={() => {
                navigate(key);
              }}
            >
              {areas[key]}
            </button>
          ))}
        </nav>
      )}
      <div
        className="analysis-reading"
        ref={reader}
        onScroll={(event) => {
          const top = event.currentTarget.scrollTop;
          update((current) => ({ ...current, scroll: { ...current.scroll, [viewKey]: top } }));
        }}
      >
        {!activeArea ? (
          <div className="analysis-overview">
            {(Object.keys(areas) as Area[]).map((key, index) => (
              <section className="analysis-card" key={key}>
                <div className="analysis-card-title">
                  <small>0{index + 1}</small>
                  <h2>
                    <button
                      onClick={() => {
                        navigate(key);
                      }}
                    >
                      {areas[key]}
                    </button>
                  </h2>
                  <strong>{cards[key].count}</strong>
                </div>
                <p>{cards[key].summary}</p>
                <ul>
                  {cards[key].entries.slice(0, 1).map((entry) => (
                    <li key={entry.id}>
                      <button
                        onClick={() => {
                          navigate(key, entry.id);
                        }}
                      >
                        {entry.title} <span aria-hidden="true">↗</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {key === 'customer' && (
                  <button
                    disabled={!requests.length}
                    onClick={() => {
                      openCopy(true);
                    }}
                  >
                    复制全部索取清单
                  </button>
                )}
                {key === 'evidence' && <small>来源与检查仅按报告提供内容展示</small>}
              </section>
            ))}
          </div>
        ) : (
          <div className={`analysis-detail ${itemId ? 'has-item' : ''}`}>
            <div
              className="analysis-list"
              ref={listReader}
              onScroll={(event) => {
                const top = event.currentTarget.scrollTop;
                update((current) => ({
                  ...current,
                  scroll: { ...current.scroll, [`${activeArea}:list`]: top },
                }));
              }}
            >
              <label>
                查找{areas[activeArea]}
                <input
                  type="search"
                  value={state.search}
                  onChange={(event) => {
                    update((current) => ({ ...current, search: event.target.value }));
                  }}
                />
              </label>
              {activeArea === 'customer' && (
                <label>
                  事项类型
                  <select
                    value={state.category}
                    onChange={(event) => {
                      update((current) => ({ ...current, category: event.target.value }));
                    }}
                  >
                    <option value="ALL">全部</option>
                    <option value="MISSING_MATERIAL">本轮未提供</option>
                    <option value="UNREADABLE_MATERIAL">已提供但读取受限</option>
                    <option value="FACT_QUESTION">待确认事实</option>
                  </select>
                </label>
              )}
              {list.length === 0 && (
                <p role="status">没有符合条件的事项，原选择与未解决事项保留。</p>
              )}
              {list.map((entry) => (
                <div className="analysis-list-row" key={entry.id}>
                  {activeArea === 'customer' && (
                    <input
                      type="checkbox"
                      aria-label={`索取${entry.title}`}
                      checked={state.selected.includes(entry.id)}
                      onChange={() => {
                        update((current) => ({
                          ...current,
                          selected: current.selected.includes(entry.id)
                            ? current.selected.filter((key) => key !== entry.id)
                            : [...current.selected, entry.id],
                        }));
                      }}
                    />
                  )}
                  <button
                    aria-current={itemId === entry.id ? 'true' : undefined}
                    onClick={() => {
                      navigate(activeArea, entry.id);
                    }}
                  >
                    {entry.title}
                    <small>{entry.id}</small>
                  </button>
                </div>
              ))}
              {activeArea === 'customer' && (
                <div className="analysis-copy-bar">
                  <span>已选 {state.selected.length} 项</span>
                  <button
                    disabled={!state.selected.length}
                    onClick={() => {
                      openCopy(false);
                    }}
                  >
                    预览并复制所选
                  </button>
                </div>
              )}
            </div>
            <article
              className="analysis-item"
              ref={itemReader}
              onScroll={(event) => {
                const top = event.currentTarget.scrollTop;
                update((current) => ({
                  ...current,
                  scroll: { ...current.scroll, [`${viewKey}:item`]: top },
                }));
              }}
            >
              <button
                className="analysis-back-list"
                onClick={() => {
                  navigate(activeArea);
                }}
              >
                返回清单
              </button>
              {customerItem && activeArea === 'customer' ? (
                <>
                  <h2>{customerItem.title}</h2>
                  <p>{customerItem.text}</p>
                  {customerItem.items.map((item) => (
                    <section key={item.id}>
                      <h3>{item.title}</h3>
                      <p>
                        {item.kind === 'MISSING_MATERIAL'
                          ? '本轮未提供'
                          : item.kind === 'UNREADABLE_MATERIAL'
                            ? '已提供但读取受限'
                            : '待确认事实'}{' '}
                        · {item.id}
                      </p>
                      <p>{item.reason}</p>
                      <p>{item.question}</p>
                      {showEvidence(item.evidenceIds)}
                    </section>
                  ))}
                  <button
                    disabled={historical}
                    onClick={() => {
                      selectContext(contextFor(report, 'CUSTOMER'));
                    }}
                  >
                    补充客户资料
                  </button>
                </>
              ) : judgment && activeArea === 'judgment' ? (
                <>
                  <h2>{judgment.title}</h2>
                  <p>{judgment.reason}</p>
                  <p>{judgment.question}</p>
                  <p>
                    涉及文件：{judgment.affectedPlannedFileIds.join('、')} · 保护事实：
                    {judgment.protectedFactIds.join('、')}
                  </p>
                  {showEvidence(judgment.evidenceIds)}
                  <button
                    disabled={historical}
                    onClick={() => {
                      selectContext(contextFor(report, 'JUDGMENT', judgment.id));
                    }}
                  >
                    写意见并提交复核
                  </button>
                </>
              ) : file && activeArea === 'files' ? (
                <>
                  <h2>{file.title}</h2>
                  <p>
                    {file.customerCode ?? '拟新建'} · {file.origin} · 拟交付，未批准
                  </p>
                  {report.changes
                    .filter((change) => change.targetPlannedFileIds.includes(file.id))
                    .map((change) => (
                      <section key={change.id}>
                        <h3>{change.title}</h3>
                        <p>{change.description}</p>
                        {showEvidence(change.evidenceIds)}
                      </section>
                    ))}
                  <button
                    disabled={historical}
                    onClick={() => {
                      selectContext(contextFor(report, 'PLAN', file.id));
                    }}
                  >
                    对这项计划提意见
                  </button>
                </>
              ) : activeArea === 'evidence' ? (
                <>
                  <h2>读取与报告依据</h2>
                  {report.limitations.map((limitation) => (
                    <p key={limitation}>{limitation}</p>
                  ))}
                  {report.checks.map((check) => (
                    <section key={check.id}>
                      <h3>{check.title}</h3>
                      <p>
                        {check.result} ·{' '}
                        {check.authority === 'RUNNER_DECLARED' ? 'Runner 声明' : check.authority}
                      </p>
                      {check.limitations.map((limitation) => (
                        <p key={limitation}>{limitation}</p>
                      ))}
                    </section>
                  ))}
                  {showEvidence(report.evidence.map((evidence) => evidence.id))}
                  <details>
                    <summary>完整报告说明</summary>
                    <SafeMarkdown>{report.narrative}</SafeMarkdown>
                  </details>
                </>
              ) : (
                <p>选择左侧事项查看详情与来源依据。</p>
              )}
            </article>
          </div>
        )}
      </div>
      {!activeArea && (
        <section className="analysis-composer" aria-label="上下文意见与补充">
          <div>
            <h2>{state.context.title}</h2>
            <button
              disabled={historical}
              onClick={() => {
                selectContext(contextFor(report, 'CUSTOMER'));
              }}
            >
              切换客户补充
            </button>
            <p className="muted">未提交输入仅本次页面会话保留，未保存到服务器。</p>
          </div>
          {stale && (
            <div className="error" role="alert">
              上下文已过期，原草稿保留。请重新核对当前报告，再选择对应事项；旧草稿不会自动改绑。
              <details>
                <summary>查看旧草稿</summary>
                <p>{draft.text}</p>
                <p>{draft.attachments.join('、')}</p>
              </details>
            </div>
          )}
          {state.receipts
            .filter((receipt) => receipt.input.context.key === state.context.key)
            .map((receipt) => (
              <div className="analysis-receipt" role="status" key={receipt.input.id}>
                <strong>
                  {receipt.state === 'PENDING'
                    ? '已提交，等待复核 · 演示'
                    : receipt.state === 'UNKNOWN'
                      ? '提交结果待核验（UNKNOWN）'
                      : receipt.state === 'FAILED'
                        ? '复核失败'
                        : receipt.state === 'UNAVAILABLE'
                          ? '操作暂不可用'
                          : '已接收意见 · 演示'}
                </strong>
                <p>{receipt.message}</p>
                <details>
                  <summary>查看原提交快照</summary>
                  <p>
                    {receipt.input.context.reportId} · {receipt.input.context.title}
                  </p>
                  <pre>{receipt.input.draft.text}</pre>
                  <p>{receipt.input.draft.attachments.join('、')}</p>
                </details>
              </div>
            ))}
          <label>
            说明与意见
            <textarea
              ref={composer}
              disabled={historical || stale}
              value={draft.text}
              onChange={(event) => {
                setDraft({ text: event.target.value, fixedExample: false });
              }}
              rows={2}
            />
          </label>
          <div className="analysis-actions">
            <label>
              附上补充资料（DOCX / Markdown / ZIP）
              <input
                type="file"
                multiple
                accept=".docx,.md,.markdown,.zip"
                disabled={historical || stale}
                onChange={(event) => {
                  const names = [...(event.target.files ?? [])].map(
                    (attachment) => attachment.name,
                  );
                  setDraft({ attachments: names, fixedExample: false });
                  event.target.value = '';
                }}
              />
            </label>
            <p>{draft.attachments.join('、')}</p>
            <button
              className="primary"
              disabled={
                historical ||
                stale ||
                pending ||
                !submit ||
                (!draft.text.trim() && !draft.attachments.length)
              }
              onClick={() => {
                if (!pending && !historical && !stale)
                  submit?.({
                    id: crypto.randomUUID(),
                    projectId: report.projectId,
                    context: structuredClone(state.context),
                    draft: structuredClone(draft),
                  });
              }}
            >
              {state.context.kind === 'CUSTOMER' ? '提交补充' : '提交意见并复核'}
            </button>
          </div>
          <details>
            <summary>关联报告、事项与依据</summary>
            <p>
              {state.context.reportId} · 第 {state.context.version} 版 · {state.context.kind}
            </p>
            <p>
              事项：{state.context.itemIds.join('、') || '无'}；文件：
              {state.context.fileIds.join('、') || '无'}；保护事实：
              {state.context.protectedFactIds.join('、') || '无'}；计划：
              {state.context.changeIds.join('、') || '无'}
            </p>
            {showEvidence(state.context.evidenceIds)}
          </details>
          {!submit && <p role="status">上下文提交尚未接入公开操作，不能上传或请求执行。</p>}
          {historical && <p role="status">历史报告只读，请返回当前报告继续填写。</p>}
          {controls}
        </section>
      )}
      <details className="analysis-records">
        <summary>报告记录</summary>
        {records}
        {report.resolutionProposals.map((proposal) => (
          <p key={proposal.id}>
            {proposal.attentionItemIds.join('、')} · 建议已解决，待核对：{proposal.explanation}
          </p>
        ))}
      </details>
      <Dialog.Root
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="dialog-content analysis-copy-dialog"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              copyTrigger.current?.focus();
            }}
          >
            <Dialog.Title>客户索取清单预览</Dialog.Title>
            <Dialog.Description>
              可调整措辞后复制，自行发送给客户；复制不关闭事项。
            </Dialog.Description>
            <label>
              复制文本
              <textarea
                ref={copyField}
                rows={10}
                value={preview ?? ''}
                onChange={(event) => {
                  setPreview(event.target.value);
                  setCopyStatus('');
                }}
              />
            </label>
            <p role="status">{copyStatus}</p>
            <button
              onClick={() => {
                void copy();
              }}
            >
              复制文本
            </button>
            {manual && (
              <button
                onClick={() => {
                  copyField.current?.focus();
                  copyField.current?.select();
                }}
              >
                选择全部，手动复制
              </button>
            )}
            <Dialog.Close asChild>
              <button>返回报告</button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
