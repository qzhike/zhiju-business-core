import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  Change,
  Changes,
  Document,
  InlineSpan,
  ReviewContent,
  Unit,
} from './trusted/markdown.js';

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
  hasRepresentation: boolean;
  busy: boolean;
  downloadStatus: string;
  onDownload: () => Promise<void>;
  onMore: () => Promise<void>;
}

/** Shared review surface for the live adapter (#279) and continued page work (#286). */
export function MarkdownReviewPage({
  data: visible,
  hasRepresentation,
  busy,
  downloadStatus,
  onDownload,
  onMore,
}: MarkdownReviewPageProps) {
  const [index, setIndex] = useState(0);
  const [search, setSearch] = useState('');
  const [whole, setWhole] = useState(false);
  const [note, setNote] = useState('');
  const [pane, setPane] = useState<'document' | 'opinion'>('document');
  const revisionId = visible.content.revisionRef.objectId;
  useEffect(() => {
    if (!note) return;
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
  }, [note]);
  const current = visible.changes.entries[index];
  const groups = visible.changes.chapterGroups.filter((group) =>
    group.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <section className="markdown-review" data-pane={pane}>
      <header className="markdown-review-header">
        <div>
          <div className="eyebrow">文件检查 · 精确版本</div>
          <h1>{visible.content.document.title}</h1>
          <p>
            版本 {revisionId.slice(-8)} ·{' '}
            {visible.content.currentUsability === 'USABLE'
              ? '可阅读'
              : '该版本当前不可用于后续业务'}{' '}
            · 阅读与下载不表示批准
          </p>
        </div>
        <div>
          <button
            onClick={() => void onDownload()}
            disabled={!hasRepresentation || visible.content.currentUsability !== 'USABLE'}
          >
            下载 Markdown
          </button>
          <p className="muted">
            {hasRepresentation ? '下载当前阅读版本' : '此链接未提供已登记表示，下载不可用'}
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
          阅读文件
        </button>
        <button
          onClick={() => {
            setPane('opinion');
          }}
          aria-pressed={pane === 'opinion'}
        >
          本文件意见
        </button>
      </div>
      <div className="markdown-review-layout">
        <aside className="markdown-chapters" aria-label="变化目录">
          <div className="markdown-directory-summary">
            <strong>{visible.changes.totalChanges}</strong> 处变化{' '}
            <span>· {visible.changes.changedUnitCount} 个单元</span>
          </div>
          <label>
            搜索章节
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
              placeholder="章节名称或编号"
            />
          </label>
          <div className="markdown-chapter-list">
            {groups.map((group) => (
              <details key={group.unitId} open={search ? true : undefined}>
                <summary>
                  {group.title}
                  <span>{group.changeCount}</span>
                </summary>
                {visible.changes.entries.map((entry, position) =>
                  entry.chapterUnitIds.includes(group.unitId) ? (
                    <button
                      key={entry.changeId.digest}
                      aria-current={index === position && !whole ? 'step' : undefined}
                      onClick={() => {
                        setIndex(position);
                        setWhole(false);
                      }}
                    >
                      <span>{String(position + 1).padStart(2, '0')}</span>
                      <span>{changeTitle(entry)}</span>
                      <small>{kindCopy[entry.kind]}</small>
                    </button>
                  ) : null,
                )}
              </details>
            ))}
            {groups.length === 0 && <p>没有匹配的章节。</p>}
            {visible.changes.entries
              .filter((entry) => entry.chapterUnitIds.length === 0)
              .map((entry) => (
                <button
                  key={entry.changeId.digest}
                  onClick={() => {
                    setIndex(visible.changes.entries.indexOf(entry));
                    setWhole(false);
                  }}
                >
                  {changeTitle(entry)}
                </button>
              ))}
            {visible.changes.nextCursor && (
              <button disabled={busy} onClick={() => void onMore()}>
                继续加载变化
              </button>
            )}
          </div>
          <small>
            已加载 {visible.changes.entries.length} / {visible.changes.totalChanges}{' '}
            处，浏览不改变检查状态。
          </small>
        </aside>
        <section className="markdown-reader" aria-label="正文阅读">
          <div className="markdown-reader-toolbar">
            <div>
              <button
                aria-pressed={!whole}
                onClick={() => {
                  setWhole(false);
                }}
              >
                逐处变化
              </button>
              <button
                aria-pressed={whole}
                onClick={() => {
                  setWhole(true);
                }}
              >
                查看全文
              </button>
            </div>
            <div>
              <button
                aria-label="上一处变化"
                disabled={index === 0 || whole}
                onClick={() => {
                  setIndex(index - 1);
                }}
              >
                上一处
              </button>
              <button
                aria-label="下一处变化"
                disabled={index >= visible.changes.entries.length - 1 || whole}
                onClick={() => {
                  setIndex(index + 1);
                }}
              >
                下一处
              </button>
            </div>
          </div>
          <div className="markdown-reading-scroll">
            {whole ? (
              <CanonicalDocument document={visible.content.document} />
            ) : current ? (
              <div className="markdown-change" key={current.changeId.digest}>
                <p className="eyebrow">
                  第 {index + 1} / {visible.changes.totalChanges} 处 · {kindCopy[current.kind]}
                </p>
                <h2>{changeTitle(current)}</h2>
                {current.kind === 'MOVED' && (
                  <p className="markdown-location-note">保留原位置与新位置；不会自动迁移旧引用。</p>
                )}
                {current.beforeValue && visible.before && (
                  <section className="markdown-before">
                    <h3>{current.kind === 'REMOVED' ? '已删除内容 · 原版本位置' : '原版本'}</h3>
                    <CanonicalDocument document={visible.before.document} focus={current.unitId} />
                  </section>
                )}
                {current.afterValue && (
                  <section className="markdown-after">
                    <h3>当前阅读版本</h3>
                    <CanonicalDocument document={visible.content.document} focus={current.unitId} />
                  </section>
                )}
              </div>
            ) : (
              <p>两个精确版本之间没有变化。</p>
            )}
          </div>
        </section>
        <aside className="markdown-opinion" aria-label="本文件意见">
          <h2>本文件意见</h2>
          <p className="muted">
            反馈提交、草稿保存与审批尚未开放。可暂记本页意见，请在离开前自行保留。
          </p>
          <label htmlFor="markdown-note">意见草稿</label>
          <textarea
            id="markdown-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
            placeholder="记录需要进一步核对的内容…"
          />
          <p role="status">{note ? '仅在当前页面，尚未保存' : '尚未输入意见'}</p>
          <button disabled>提交并修改 · 暂不可用</button>
          <button disabled>批准 · 暂不可用</button>
        </aside>
      </div>
      <p className="markdown-download-status" role="status">
        {downloadStatus}
      </p>
    </section>
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
