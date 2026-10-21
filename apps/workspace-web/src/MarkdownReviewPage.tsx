import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type {
  Change,
  Changes,
  Document,
  InlineSpan,
  ReviewContent,
  Unit,
} from './trusted/markdown.js';
import {
  changeBinding,
  changeKindNotices,
  focusUnit,
  reviewDraftStateLabels,
  reviewFileStateLabels,
  submissionStatusCopy,
  type ReviewDownload,
  type ReviewFileState,
  type ReviewOpinionActions,
  type ReviewOpinionModel,
  type ReviewWorkspaceInput,
} from './review/model.js';

function inline(text: string, spans: InlineSpan[] = []): ReactNode[] {
  const points = Array.from(text);
  const output: ReactNode[] = [];
  let offset = 0;
  while (offset < points.length) {
    const found = spans.filter((span) => span.start === offset);
    if (!found.length) {
      output.push(points[offset]);
      offset++;
      continue;
    }
    const end = requiredValue(found[0]).end;
    if (end <= offset || end > points.length) {
      output.push(points[offset]);
      offset++;
      continue;
    }
    let content: ReactNode = points.slice(offset, end).join('');
    if (found.some((span) => span.kind === 'HARD_BREAK')) content = <br />;
    else {
      if (found.some((span) => span.kind === 'CODE')) content = <code>{content}</code>;
      if (found.some((span) => span.kind === 'EMPHASIS')) content = <em>{content}</em>;
      if (found.some((span) => span.kind === 'STRONG')) content = <strong>{content}</strong>;
    }
    output.push(<span key={offset}>{content}</span>);
    offset = end;
  }
  return output;
}

export function CanonicalDocument({
  document,
  focus,
}: {
  document: Document;
  focus?: string | undefined;
}) {
  const units = useMemo(
    () => new Map(document.units.map((unit) => [unit.unitId, unit])),
    [document],
  );
  function renderUnit(unit: Unit): ReactNode {
    const metadata = unit.semanticMetadata.markdown;
    const children = unit.childUnitIds
      .map((id) => units.get(id))
      .filter((child): child is Unit => child !== undefined);
    if (unit.unitType === 'TABLE')
      return (
        <div
          className="markdown-wide-table"
          key={unit.unitId}
          tabIndex={0}
          role="region"
          aria-label="完整表格，可横向滚动"
        >
          <table>
            <thead>
              {children
                .filter((row) => row.unitId === children[0]?.unitId)
                .map((row) => (
                  <tr key={row.unitId}>
                    {row.childUnitIds.map((id) => {
                      const cell = requiredValue(units.get(id));
                      return (
                        <th key={id} scope="col">
                          {inline(cell.text ?? '', cell.semanticMetadata.markdown.inlineSpans)}
                        </th>
                      );
                    })}
                  </tr>
                ))}
            </thead>
            <tbody>
              {children.slice(1).map((row) => (
                <tr key={row.unitId}>
                  {row.childUnitIds.map((id) => {
                    const cell = requiredValue(units.get(id));
                    return (
                      <td key={id}>
                        {inline(cell.text ?? '', cell.semanticMetadata.markdown.inlineSpans)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    if (unit.unitType === 'SECTION')
      return (
        <section key={unit.unitId} data-unit-id={unit.unitId}>
          <div
            className={`markdown-heading markdown-h${metadata.headingLevel ?? 1}`}
            role="heading"
            aria-level={Math.min(6, (metadata.headingLevel ?? 1) + 1)}
          >
            {inline(unit.text ?? '', metadata.inlineSpans)}
          </div>
          {children.map(renderUnit)}
        </section>
      );
    if (metadata.blockKind === 'THEMATIC_BREAK') return <hr key={unit.unitId} />;
    return (
      <div
        key={unit.unitId}
        className={metadata.blockKind === 'LIST_ITEM' ? 'markdown-list-item' : 'markdown-paragraph'}
        data-unit-id={unit.unitId}
      >
        <p>
          {metadata.blockKind === 'LIST_ITEM' && (
            <span className="markdown-marker">
              {metadata.listKind === 'ORDERED' ? metadata.orderedMarker : '•'}{' '}
            </span>
          )}
          {inline(unit.text ?? '', metadata.inlineSpans)}
        </p>
        {children.map(renderUnit)}
      </div>
    );
  }
  let roots = document.units.filter((unit) => unit.parentUnitId === undefined);
  if (focus) {
    let unit = units.get(focus);
    if (unit?.unitType === 'TABLE_CELL') unit = units.get(requiredValue(unit.parentUnitId));
    if (unit?.unitType === 'TABLE_ROW') unit = units.get(requiredValue(unit.parentUnitId));
    roots = unit ? [unit] : [];
  }
  return <div className="canonical-document">{roots.map(renderUnit)}</div>;
}

const kindCopy = { ADDED: '新增', REMOVED: '删除', CHANGED: '修改', MOVED: '移动' };
export interface MarkdownReviewData {
  content: ReviewContent;
  before?: ReviewContent;
  changes: Changes;
}

export interface MarkdownReviewPageProps {
  data: MarkdownReviewData;
  /** Exact-file download state, separate from reading, opinions and approval. */
  download: ReviewDownload;
  /** The single opinion and processing area. */
  opinion: ReviewOpinionModel;
  opinionActions?: ReviewOpinionActions;
  /** Work-file list, summary/evidence, candidate notices and switch notes. */
  workspace?: ReviewWorkspaceInput;
  /** Changes-directory continuation. */
  busy: boolean;
  directoryStatus: string;
  onMore: () => Promise<void>;
  /** Development adapter controls; rendered inside the opinion rail. */
  controls?: ReactNode;
}

/** Shared review surface for the live adapter (#279) and continued page work (#286). */
export function MarkdownReviewPage({
  data: visible,
  download,
  opinion,
  opinionActions,
  workspace,
  busy,
  directoryStatus,
  onMore,
  controls,
}: MarkdownReviewPageProps) {
  const [tab, setTab] = useState<'changes' | 'document' | 'summary'>('changes');
  const [index, setIndex] = useState(0);
  const [pane, setPane] = useState<'document' | 'opinion'>('document');
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [chapterState, setChapterState] = useState<Record<string, boolean>>({});
  const [narrow, setNarrow] = useState(false);
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const note = useRef<HTMLTextAreaElement>(null);
  const stepFocus = useRef(false);
  const revisionId = visible.content.revisionRef.objectId;
  const revisionLabel = `版本 ${revisionId.slice(-8)}`;
  const readIdentity = `${visible.content.authoritativeIdentityMap.artifactRef.objectId}:${revisionId}`;
  // An explicit file or version switch starts from the change-first view again;
  // a candidate that merely arrives keeps the current view untouched.
  useEffect(() => {
    setTab('changes');
    setIndex(0);
    setDirectoryOpen(false);
  }, [readIdentity]);
  // The bounded workspace fills whatever space is left below its own top edge,
  // so a page heading or notice above it never pushes the columns off screen.
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const update = () => {
      let top = 0;
      let current: HTMLElement | null = node;
      while (current) {
        top += current.offsetTop;
        current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null;
      }
      // Space that must stay free below the workspace inside its own containers.
      let bottom = 0;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        bottom +=
          parseFloat(style.paddingBottom || '0') + parseFloat(style.borderBottomWidth || '0');
      }
      const offset = `${Math.round(top)}px`;
      const inset = `${Math.round(bottom)}px`;
      if (node.style.getPropertyValue('--review-offset') !== offset)
        node.style.setProperty('--review-offset', offset);
      if (node.style.getPropertyValue('--review-bottom') !== inset)
        node.style.setProperty('--review-bottom', inset);
    };
    update();
    window.addEventListener('resize', update);
    const observer = new ResizeObserver(update);
    if (node.parentElement) observer.observe(node.parentElement);
    return () => {
      window.removeEventListener('resize', update);
      observer.disconnect();
    };
  }, []);
  const current = visible.changes.entries[Math.min(index, visible.changes.entries.length - 1)];
  const currentPosition = Math.min(index, Math.max(0, visible.changes.entries.length - 1));
  const lastLoaded = visible.changes.entries.length - 1;
  useEffect(() => {
    const unsaved =
      opinion.draft.text.trim().length > 0 &&
      ['UNAVAILABLE', 'SAVING', 'UNSAVED', 'UNKNOWN', 'CONFLICT', 'FAILED'].includes(
        opinion.draft.state,
      );
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const leave = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        anchor instanceof HTMLAnchorElement &&
        !anchor.download &&
        anchor.href !== window.location.href &&
        !window.confirm('本页意见尚未保存。确认已自行保留后离开？')
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', leave, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', leave, true);
    };
  }, [opinion.draft.state, opinion.draft.text]);
  useLayoutEffect(() => {
    if (!stepFocus.current) return;
    stepFocus.current = false;
    heading.current?.focus({ preventScroll: true });
    scroll.current?.scrollTo({ top: 0 });
  }, [index, tab]);
  // The approved viewport rule keeps approval on the desktop layout.
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const update = () => {
      setNarrow(media.matches);
    };
    update();
    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
    };
  }, []);
  const groups = visible.changes.chapterGroups;
  const query = directoryQuery.trim().toLocaleLowerCase();
  const matches = (change: Change) => {
    if (!query) return true;
    const chapter = groups.find((group) => change.chapterUnitIds.includes(group.unitId))?.title;
    return `${chapter ?? ''} ${changeTitle(change)} ${change.afterValue?.text ?? ''} ${
      change.beforeValue?.text ?? ''
    }`
      .toLocaleLowerCase()
      .includes(query);
  };
  const matchCount = visible.changes.entries.filter(matches).length;
  const step = (target: number) => {
    setTab('changes');
    setIndex(Math.max(0, Math.min(lastLoaded, target)));
    stepFocus.current = true;
  };
  const quote = (change: Change, position: number) => {
    const chapter =
      groups.find((group) => change.chapterUnitIds.includes(group.unitId))?.title ?? '未归入章节';
    const reference = `关于 ${visible.content.document.title} ${revisionLabel} · 第 ${
      position + 1
    } / ${visible.changes.totalChanges} 处 · ${chapter} / ${changeTitle(change)}（精确版本 ${revisionId.slice(
      -8,
    )}）：`;
    opinionActions?.onDraftChange?.(
      opinion.draft.text.includes(reference)
        ? opinion.draft.text
        : `${opinion.draft.text ? `${opinion.draft.text}\n\n` : ''}${reference}\n`,
    );
    setPane('opinion');
    requestAnimationFrame(() => {
      note.current?.focus();
    });
  };
  const chapterChanges = current
    ? visible.changes.entries
        .map((change, position) => ({ change, position }))
        .filter(
          (entry) =>
            current.chapterUnitIds.some((unitId) => entry.change.chapterUnitIds.includes(unitId)) ||
            (current.chapterUnitIds.length === 0 && entry.change.chapterUnitIds.length === 0),
        )
    : [];
  const currentChapterId = current?.chapterUnitIds[0] ?? 'ungrouped';
  const chapterOpen = chapterState[currentChapterId] ?? false;
  const suggestion = opinion.suggestion;
  const baseline = suggestion?.baseline.options.find(
    (option) => option.id === suggestion.baseline.selectedId,
  );
  const submission = opinion.submission;
  const frozen = Boolean(submission);
  const draftLabel = frozen ? '下轮意见草稿' : '意见草稿';
  // A newer candidate marks the viewed version STALE for an ordinary edit; only an
  // explicitly based Markdown suggestion stays submittable against an older revision.
  const stale = Boolean(workspace?.candidate) && !suggestion?.text.trim();
  const canSubmit =
    Boolean(opinionActions?.onSubmit) &&
    !submission &&
    !stale &&
    !opinion.submitBlocked &&
    (opinion.draft.text.trim().length > 0 || Boolean(suggestion?.text.trim())) &&
    (!suggestion?.text.trim() || Boolean(baseline));
  const submitBlocker =
    opinion.submitBlocked ??
    (!opinionActions?.onSubmit
      ? '提交能力尚未接入；本页输入保留。'
      : submission
        ? submission.status === 'UNKNOWN'
          ? '核验期间不能重复提交；仍可写下轮草稿。'
          : '等待本次处理返回，再核对新版本与下轮草稿。'
        : stale
          ? '当前阅读版本已被新候选替代，普通意见为待重新核对状态；请显式切换并核对引用后再提交。旧基准 Markdown 改稿可继续复核。'
          : suggestion?.text.trim() && !baseline
            ? '请先明确选择改稿的基准版本。'
            : '');
  const attachSuggestion = opinionActions?.onAttachSuggestion;
  const attach = async (file: File | undefined) => {
    if (!file || !attachSuggestion) return;
    const attachedTo = revisionId;
    if (!/\.(md|markdown)$/iu.test(file.name)) {
      attachSuggestion({ name: file.name, text: '' });
      return;
    }
    const text = await file.text().catch(() => null);
    if (text === null) {
      attachSuggestion({ name: file.name, text: '' });
      return;
    }
    // A file-picker result captured before asynchronous reading cannot attach
    // to another artifact after the page switched.
    if (attachedTo !== revisionId) return;
    if (text.length > 2_000_000) {
      attachSuggestion({ name: file.name, text: '' });
      return;
    }
    attachSuggestion({ name: file.name, text });
  };
  const approvalBlockedByDraft =
    opinion.draft.text.trim().length > 0 || Boolean(suggestion?.text.trim());
  const approvalNote = narrow
    ? '窄屏只支持查看与意见；批准请在桌面检查并完成。'
    : opinion.approval.available && workspace?.candidate
      ? '当前阅读版本已被新候选替代；请显式切换并核对后再批准。'
      : opinion.approval.available && approvalBlockedByDraft
        ? '还有未提交的意见或改稿；请先处理或提交后再批准。'
        : opinion.approval.note;
  const files = workspace?.files;
  return (
    <section className="markdown-review" data-pane={pane} ref={root}>
      <header className="markdown-review-header">
        <div className="markdown-identity">
          <h1>{visible.content.document.title}</h1>
          <p className="markdown-identity-line">
            {revisionLabel} ·{' '}
            {visible.content.currentUsability === 'USABLE'
              ? '可阅读'
              : '该版本当前不可用于后续业务'}{' '}
            · 阅读、下载与浏览都不表示批准
          </p>
        </div>
        <div className="markdown-download">
          <button
            onClick={() => void download.onDownload()}
            disabled={!download.hasRepresentation || visible.content.currentUsability !== 'USABLE'}
          >
            下载 Markdown
          </button>
          <p className="muted">
            {download.hasRepresentation ? '下载当前阅读版本 · 与阅读和批准分开记录' : download.note}
          </p>
          <p className="markdown-download-status" role="status">
            {download.status}
          </p>
        </div>
      </header>
      <div className="markdown-mobile-tabs">
        <button
          onClick={() => {
            setPane('document');
          }}
          aria-pressed={pane === 'document'}
        >
          查看文档
        </button>
        <button
          onClick={() => {
            setPane('opinion');
          }}
          aria-pressed={pane === 'opinion'}
        >
          意见与处理
        </button>
      </div>
      <div className="markdown-review-layout">
        <nav className="markdown-files" aria-label="本轮文件">
          <h2>本轮文件</h2>
          {files ? (
            <>
              <div className="markdown-files-summary">
                <span>
                  已加载 {files.list.entries.length} / 共 {files.list.totalCount} 份
                </span>
                {files.list.status && <small role="status">{files.list.status}</small>}
              </div>
              {files.actions.onQuery && (
                <label>
                  查找文件
                  <input
                    type="search"
                    value={files.list.query}
                    onChange={(event) => {
                      files.actions.onQuery?.(event.target.value);
                    }}
                    placeholder="文件名称或编号"
                  />
                </label>
              )}
              {files.actions.onStateFilter && (
                <label>
                  文件状态
                  <select
                    value={files.list.stateFilter}
                    onChange={(event) => {
                      files.actions.onStateFilter?.(event.target.value as 'ALL' | ReviewFileState);
                    }}
                  >
                    <option value="ALL">全部状态</option>
                    {Object.entries(reviewFileStateLabels).map(([state, label]) => (
                      <option key={state} value={state}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="markdown-file-list">
                {files.list.entries.map((entry) => (
                  <button
                    key={entry.fileId}
                    disabled={!files.actions.onSelect || !entry.openable}
                    aria-current={entry.fileId === files.list.currentFileId ? 'true' : undefined}
                    onClick={() => {
                      files.actions.onSelect?.(entry.fileId);
                    }}
                  >
                    <strong>{entry.title}</strong>
                    <small>
                      {entry.code} · {entry.detail}
                    </small>
                    <span className={`markdown-file-state is-${entry.state.toLocaleLowerCase()}`}>
                      {reviewFileStateLabels[entry.state]}
                    </span>
                  </button>
                ))}
                {files.list.entries.length === 0 && <p>没有符合条件的文件。</p>}
                {files.list.nextCursor && (
                  <button
                    disabled={files.list.loading}
                    onClick={() => {
                      files.actions.onMore?.();
                    }}
                  >
                    {files.list.loading ? '正在加载文件…' : '继续加载文件'}
                  </button>
                )}
              </div>
              <small>未加载页不计入分母；列表限定本轮工作范围。</small>
            </>
          ) : (
            <p className="markdown-files-note">
              {workspace?.directoryNote ?? '跨文件成果目录读取尚未接入；本页只显示此精确版本。'}
            </p>
          )}
        </nav>
        <section className="markdown-reader" aria-label="正文阅读">
          <div className="markdown-reader-toolbar">
            <div>
              <button
                aria-pressed={tab === 'changes'}
                onClick={() => {
                  setTab('changes');
                }}
              >
                变化详情 · {visible.changes.totalChanges}
              </button>
              <button
                aria-pressed={tab === 'document'}
                onClick={() => {
                  setTab('document');
                }}
              >
                完整文件
              </button>
              <button
                aria-pressed={tab === 'summary'}
                onClick={() => {
                  setTab('summary');
                }}
              >
                摘要与依据
              </button>
            </div>
            <span className="muted">逐处查看不代表检查完成</span>
          </div>
          {tab === 'changes' && (
            <nav className="markdown-change-toolbar" aria-label="本文件修改位置">
              <div className="markdown-change-total">
                <strong>本文件共 {visible.changes.totalChanges} 处修改</strong>
                <small>
                  已加载 {visible.changes.entries.length} / {visible.changes.totalChanges} 处
                </small>
                <button
                  aria-haspopup="dialog"
                  onClick={() => {
                    setDirectoryOpen(true);
                  }}
                >
                  查看全部位置 ▤
                </button>
              </div>
              {current ? (
                <div className="markdown-change-current">
                  <span>
                    <small>
                      当前 {currentPosition + 1} / {visible.changes.totalChanges}
                    </small>
                    <strong>{changeTitle(current)}</strong>
                  </span>
                  <div>
                    <button
                      aria-label="上一处变化"
                      disabled={currentPosition === 0}
                      onClick={() => {
                        step(currentPosition - 1);
                      }}
                    >
                      ↑ 上一处
                    </button>
                    <button
                      aria-label="下一处变化"
                      disabled={currentPosition >= lastLoaded}
                      onClick={() => {
                        step(currentPosition + 1);
                      }}
                    >
                      下一处 ↓
                    </button>
                  </div>
                </div>
              ) : (
                <p className="muted">正在加载变化目录…</p>
              )}
            </nav>
          )}
          <div className="markdown-reading-scroll" ref={scroll}>
            {workspace?.recheck && (
              <p className="notice" role="status">
                {workspace.recheck}
              </p>
            )}
            {workspace?.candidate && (
              <p className="notice" role="status">
                <strong>{workspace.candidate.label}</strong> {workspace.candidate.note}
                {workspace.candidate.onSwitch && (
                  <button
                    onClick={() => {
                      workspace.candidate?.onSwitch?.();
                    }}
                  >
                    显式切换并核对引用
                  </button>
                )}
              </p>
            )}
            {tab === 'document' ? (
              <CanonicalDocument document={visible.content.document} />
            ) : tab === 'summary' ? (
              workspace?.summary ? (
                <div className="markdown-summary">
                  <h2>摘要与依据</h2>
                  <h3>本轮摘要</h3>
                  <p>{workspace.summary.summary}</p>
                  <h3>保留的内容</h3>
                  <ul>
                    {workspace.summary.retained.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <h3>依据</h3>
                  <ul>
                    {workspace.summary.evidence.map((item) => (
                      <li key={`${item.label}:${item.detail}`}>
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                      </li>
                    ))}
                  </ul>
                  {workspace.summary.note && <p className="muted">{workspace.summary.note}</p>}
                </div>
              ) : (
                <p className="muted">本页未提供摘要与依据读取；摘要信息保持不可用。</p>
              )
            ) : current ? (
              <ChangeView
                change={current}
                position={currentPosition}
                visible={visible}
                heading={heading}
                chapterChanges={chapterChanges}
                chapterOpen={chapterOpen}
                onToggleChapter={(open) => {
                  setChapterState({ ...chapterState, [currentChapterId]: open });
                }}
                onSelect={step}
                onQuote={quote}
              />
            ) : (
              <p>两个精确版本之间没有变化。</p>
            )}
            {tab === 'changes' && visible.changes.nextCursor && (
              <p className="markdown-more-changes">
                <span>
                  还有未加载的变化：已显示 {visible.changes.entries.length} 处，共{' '}
                  {visible.changes.totalChanges} 处。
                </span>
                <button disabled={busy} onClick={() => void onMore()}>
                  {busy ? '正在加载变化…' : directoryStatus ? '重试加载变化' : '继续加载变化'}
                </button>
                {directoryStatus && <span role="status">{directoryStatus}</span>}
              </p>
            )}
          </div>
        </section>
        <aside className="markdown-opinion" aria-label="本文件意见与处理">
          {submission && (
            <div className="markdown-submission" role="status" aria-live="polite">
              <strong>
                {submission.status === 'UNKNOWN'
                  ? '提交结果待核验'
                  : submission.status === 'ACCEPTED'
                    ? '修改请求已接收，等待安排'
                    : '服务器确认正在修改'}
              </strong>
              <p>{submissionStatusCopy(submission.status, submission.queries)}</p>
              <p className="muted">原请求 {submission.requestLabel}</p>
              <p className="muted">{submission.note}</p>
              {submission.querying && <p className="muted">正在只读查询原提交…</p>}
              {submission.status === 'UNKNOWN' && submission.canQuery && (
                <button
                  disabled={submission.querying}
                  onClick={() => {
                    opinionActions?.onQuerySubmission?.();
                  }}
                >
                  重新查询
                </button>
              )}
            </div>
          )}
          <h2>{frozen ? '意见与处理' : '本文件意见'}</h2>
          {submission && (
            <details className="markdown-original">
              <summary>查看本次提交的意见与改稿</summary>
              <p className="muted">冻结快照 · 后续新草稿不会改写它</p>
              <pre>{submission.originalText || '未填写文字意见'}</pre>
              {submission.originalSuggestion ? (
                <p>
                  附件：{submission.originalSuggestion.name} · 基准{' '}
                  {submission.originalSuggestion.baselineLabel}
                </p>
              ) : (
                <p className="muted">未附改稿</p>
              )}
            </details>
          )}
          {suggestion && (
            <div className="markdown-suggestion">
              <h3>Markdown 改稿（随本次提交一起复核）</h3>
              {suggestion.text ? (
                <>
                  <p>
                    <strong>{suggestion.name}</strong>
                    {suggestion.byteLength !== undefined && ` · ${suggestion.byteLength} 字节`}
                  </p>
                  <label>
                    改稿基准版本（必须明确选择）
                    <select
                      value={suggestion.baseline.selectedId ?? ''}
                      disabled={frozen || !opinionActions?.onSelectBaseline}
                      onChange={(event) => {
                        opinionActions?.onSelectBaseline?.(event.target.value);
                      }}
                    >
                      <option value="">请选择改稿基准版本</option>
                      {suggestion.baseline.options.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                          {option.kind === 'OLDER' ? '（旧基准）' : '（最新版本）'}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="muted">
                    基准 {baseline ? baseline.label : '尚未选择'} · 提交时最新版本{' '}
                    {suggestion.latestLabel}
                  </p>
                  <details>
                    <summary>预览改稿文本（不执行其中内容）</summary>
                    <pre>{suggestion.text.slice(0, 4000)}</pre>
                  </details>
                  {!frozen && opinionActions?.onRemoveSuggestion && (
                    <button
                      onClick={() => {
                        opinionActions.onRemoveSuggestion?.();
                      }}
                    >
                      移除草稿改稿
                    </button>
                  )}
                </>
              ) : (
                <>
                  <label>
                    附上 Markdown 改稿（.md / .markdown）
                    <input
                      type="file"
                      accept=".md,.markdown,text/markdown"
                      disabled={frozen || !opinionActions?.onAttachSuggestion}
                      onChange={(event) => {
                        void attach(event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                  </label>
                  {!frozen && opinionActions?.onRemoveSuggestion && (
                    <button
                      onClick={() => {
                        opinionActions.onRemoveSuggestion?.();
                      }}
                    >
                      移除草稿改稿
                    </button>
                  )}
                </>
              )}
              {suggestion.error && <p role="alert">{suggestion.error}</p>}
              <p className="muted">
                {suggestion.note ??
                  '上传的改稿在本页作为建议复核，不会直接覆盖已批准的文件；文件名不能证明基准版本。'}
              </p>
            </div>
          )}
          {!suggestion && opinionActions?.onAttachSuggestion && !frozen && (
            <label className="markdown-attach">
              附上 Markdown 改稿
              <input
                type="file"
                accept=".md,.markdown,text/markdown"
                onChange={(event) => {
                  void attach(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
          )}
          <p className="markdown-opinion-context">针对：{opinion.context}</p>
          {opinion.scope && (
            <label className="markdown-opinion-scope">
              意见作用范围
              <select
                value={opinion.scope.selectedId}
                onChange={(event) => {
                  opinionActions?.onSelectScope?.(event.target.value);
                }}
              >
                {opinion.scope.options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>{opinion.scope.note}</small>
            </label>
          )}
          <label htmlFor="markdown-note">{draftLabel}</label>
          <textarea
            id="markdown-note"
            ref={note}
            value={opinion.draft.text}
            onChange={(event) => {
              opinionActions?.onDraftChange?.(event.target.value);
            }}
            placeholder={
              frozen
                ? '先记下补充想法；本轮执行不会读取这里的草稿…'
                : '说明需要调整的内容，也可以引用具体位置…'
            }
          />
          <p className="markdown-draft-state" role="status">
            {reviewDraftStateLabels[opinion.draft.state]}
            {opinion.draft.note && ` · ${opinion.draft.note}`}
          </p>
          {opinionActions?.onSaveDraft && (
            <button
              disabled={
                opinion.draft.state === 'SAVING' ||
                opinion.draft.state === 'UNKNOWN' ||
                (opinion.draft.text.trim().length === 0 && opinion.draft.state !== 'FAILED')
              }
              onClick={() => {
                opinionActions.onSaveDraft?.();
              }}
            >
              保存意见草稿（模拟）
            </button>
          )}
          <button
            className="primary"
            disabled={!canSubmit}
            onClick={() => {
              opinionActions?.onSubmit?.();
            }}
          >
            提交并修改
          </button>
          {submitBlocker && <p className="muted">{submitBlocker}</p>}
          {opinion.approval.visible !== false && (
            <>
              <button
                disabled={
                  !opinion.approval.available ||
                  submission?.status === 'UNKNOWN' ||
                  approvalBlockedByDraft ||
                  Boolean(workspace?.candidate) ||
                  narrow
                }
                onClick={() => {
                  opinionActions?.onApprove?.();
                }}
              >
                检查完成并批准
              </button>
              <p className="muted">{approvalNote}</p>
            </>
          )}
          {opinion.unavailable.length > 0 && (
            <details className="markdown-unavailable">
              <summary>尚未接入的操作</summary>
              <ul>
                {opinion.unavailable.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          )}
          {opinion.history && opinion.history.length > 0 && (
            <details className="markdown-history">
              <summary>意见与请求历史 · {opinion.history.length} 条</summary>
              <ol>
                {opinion.history.map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.scopeLabel}</strong>
                    <span className="status-tag">{entry.status}</span>
                    <p>{entry.text}</p>
                    <small>
                      原请求 {entry.requestLabel} · 原依据 {entry.basis}
                    </small>
                  </li>
                ))}
              </ol>
              <p className="muted">
                旧意见按原项目、阶段和文件版本保留；不会自动迁移到新版本或转为阶段定稿。
              </p>
            </details>
          )}
          {controls}
        </aside>
      </div>
      <Dialog.Root open={directoryOpen} onOpenChange={setDirectoryOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content markdown-directory-dialog">
            <Dialog.Title>全部修改位置 · {visible.changes.totalChanges} 处</Dialog.Title>
            <Dialog.Description>
              {visible.content.document.title} · {revisionLabel}
              ；按章节查找并跳转，不会标记检查完成。
            </Dialog.Description>
            <label className="markdown-directory-search">
              查找位置
              <input
                type="search"
                value={directoryQuery}
                onChange={(event) => {
                  setDirectoryQuery(event.target.value);
                }}
                placeholder="输入章节、字段或关键词"
              />
            </label>
            <p className="muted" role="status">
              已加载 {visible.changes.entries.length} / {visible.changes.totalChanges} 处
              {query && ` · 匹配 ${matchCount} 处`}
            </p>
            <div className="markdown-directory">
              {groups.map((group) => {
                const entries = visible.changes.entries
                  .map((change, position) => ({ change, position }))
                  .filter(
                    (entry) =>
                      entry.change.chapterUnitIds.includes(group.unitId) && matches(entry.change),
                  );
                if (entries.length === 0) return null;
                const dialogKey = `dialog:${group.unitId}`;
                return (
                  <details
                    key={group.unitId}
                    open={chapterState[dialogKey] ?? true}
                    onToggle={(event) => {
                      setChapterState({
                        ...chapterState,
                        [dialogKey]: event.currentTarget.open,
                      });
                    }}
                  >
                    <summary>
                      {group.title}
                      <span>{entries.length} 处</span>
                    </summary>
                    {entries.map((entry) => (
                      <button
                        key={entry.change.changeId.digest}
                        aria-current={entry.position === currentPosition ? 'step' : undefined}
                        onClick={() => {
                          setDirectoryOpen(false);
                          step(entry.position);
                        }}
                      >
                        <span>{entry.position + 1}</span>
                        <span>{changeTitle(entry.change)}</span>
                        <small>{kindCopy[entry.change.kind]}</small>
                        {!changeBinding(visible.content, entry.change).present && (
                          <small className="markdown-location-missing">位置待核对</small>
                        )}
                      </button>
                    ))}
                  </details>
                );
              })}
              {visible.changes.entries
                .map((change, position) => ({ change, position }))
                .filter(
                  (entry) => entry.change.chapterUnitIds.length === 0 && matches(entry.change),
                )
                .map((entry) => (
                  <button
                    key={entry.change.changeId.digest}
                    aria-current={entry.position === currentPosition ? 'step' : undefined}
                    onClick={() => {
                      setDirectoryOpen(false);
                      step(entry.position);
                    }}
                  >
                    <span>{entry.position + 1}</span>
                    <span>{changeTitle(entry.change)}</span>
                    <small>未归入章节</small>
                  </button>
                ))}
              {matchCount === 0 && <p>没有找到匹配位置。</p>}
            </div>
            {visible.changes.nextCursor && (
              <>
                <button disabled={busy} onClick={() => void onMore()}>
                  {busy ? '正在加载变化…' : directoryStatus ? '重试加载变化' : '继续加载变化'}
                </button>
                {directoryStatus && <p role="status">{directoryStatus}</p>}
              </>
            )}
            <Dialog.Close asChild>
              <button>返回阅读</button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

function ChangeView({
  change,
  position,
  visible,
  heading,
  chapterChanges,
  chapterOpen,
  onToggleChapter,
  onSelect,
  onQuote,
}: {
  change: Change;
  position: number;
  visible: MarkdownReviewData;
  heading: React.RefObject<HTMLHeadingElement | null>;
  chapterChanges: { change: Change; position: number }[];
  chapterOpen: boolean;
  onToggleChapter: (open: boolean) => void;
  onSelect: (position: number) => void;
  onQuote: (change: Change, position: number) => void;
}) {
  const binding = changeBinding(visible.content, change);
  const afterResolves =
    change.afterValue !== undefined &&
    focusUnit(visible.content.document, change.afterValue.unitId) !== undefined;
  const beforeResolves =
    change.beforeValue !== undefined &&
    visible.before !== undefined &&
    focusUnit(visible.before.document, change.beforeValue.unitId) !== undefined;
  return (
    <div className="markdown-change" key={change.changeId.digest}>
      <div className="markdown-change-heading">
        <p className="eyebrow">
          第 {position + 1} / {visible.changes.totalChanges} 处 · {kindCopy[change.kind]}
        </p>
        <button
          onClick={() => {
            onQuote(change, position);
          }}
        >
          对此处提意见
        </button>
      </div>
      <h2 ref={heading} tabIndex={-1}>
        {changeTitle(change)}
      </h2>
      {changeKindNotices[change.kind] && (
        <p className="markdown-location-note">{changeKindNotices[change.kind]}</p>
      )}
      {!binding.present && (
        <p className="markdown-location-note" role="status">
          此处变化的位置绑定（{binding.unitId}
          ）在当前精确版本中未找到；未自动改绑到相邻内容。请核对来源位置或重新读取此版本。
        </p>
      )}
      {change.beforeValue && visible.before && beforeResolves && (
        <section className="markdown-before">
          <h3>{change.kind === 'REMOVED' ? '已删除内容 · 原版本位置' : '原版本'}</h3>
          <CanonicalDocument document={visible.before.document} focus={change.beforeValue.unitId} />
        </section>
      )}
      {change.afterValue && afterResolves && (
        <section className="markdown-after">
          <h3>当前阅读版本</h3>
          <CanonicalDocument document={visible.content.document} focus={change.afterValue.unitId} />
        </section>
      )}
      {chapterChanges.length > 1 && (
        <details
          className="markdown-chapter-context"
          open={chapterOpen}
          onToggle={(event) => {
            onToggleChapter(event.currentTarget.open);
          }}
        >
          <summary>本章节修改位置 · {chapterChanges.length} 处</summary>
          {chapterChanges.map((entry) => (
            <button
              key={entry.change.changeId.digest}
              aria-current={entry.position === position ? 'step' : undefined}
              onClick={() => {
                onSelect(entry.position);
              }}
            >
              <span>{entry.position + 1}</span>
              <span>{changeTitle(entry.change)}</span>
            </button>
          ))}
          <p className="muted">同章节列表在跳转后保持展开；查看不代表该处检查完成。</p>
        </details>
      )}
    </div>
  );
}

function changeTitle(change: Change): string {
  return (
    change.afterValue?.text ??
    change.beforeValue?.text ??
    (change.afterValue?.unitType === 'TABLE' || change.beforeValue?.unitType === 'TABLE'
      ? '表格结构'
      : '内容与位置变化')
  );
}

function requiredValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Required Markdown binding is unavailable');
  return value;
}
