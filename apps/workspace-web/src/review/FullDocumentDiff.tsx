import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Alert } from '../components/ui/alert.js';
import type { MarkdownReviewData } from '../MarkdownReviewPage.js';
import type { Revision } from '../trusted/markdown.js';
import { documentDiff, documentLines, splitDiff, type DocumentLine } from './document-diff.js';
import './document-diff.css';

function sameInput(left: Revision, right: Revision | undefined): boolean {
  return (
    left.objectId === right?.objectId &&
    left.scope.projectId === right.scope.projectId &&
    left.scope.enterpriseId === right.scope.enterpriseId &&
    left.contentHash.digest === right.contentHash.digest
  );
}

export function FullDocumentDiff({
  data,
  narrow,
  activeIndex,
  navigationRequest,
}: {
  data: MarkdownReviewData;
  narrow: boolean;
  activeIndex: number;
  navigationRequest: number;
}) {
  const [layout, setLayout] = useState<'split' | 'unified'>('split');
  const root = useRef<HTMLDivElement>(null);
  const unified = narrow || layout === 'unified';
  const diff = useMemo(
    () =>
      documentDiff(
        data.before ? documentLines(data.before.document) : [],
        documentLines(data.content.document),
      ),
    [data.before, data.content],
  );
  const rows = useMemo(() => (unified ? diff.lines : splitDiff(diff.lines)), [diff.lines, unified]);
  const active = data.changes.entries[activeIndex];
  const bound = (line: DocumentLine | undefined, side: 'before' | 'after') => {
    const unit = side === 'before' ? active?.beforeValue : active?.afterValue;
    return Boolean(line && unit && line.unitIds.includes(unit.unitId));
  };
  useLayoutEffect(() => {
    if (navigationRequest === 0) return;
    const target = root.current?.querySelector<HTMLElement>('[data-active="true"]');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'center' });
  }, [activeIndex, navigationRequest]);
  const baselineMissing = data.changes.exactInputs.baselineKind !== 'EMPTY_INITIAL' && !data.before;
  const mismatch =
    !sameInput(data.content.revisionRef, data.changes.exactInputs.toRevisionRef) ||
    (data.before && !sameInput(data.before.revisionRef, data.changes.exactInputs.fromRevisionRef));
  if (baselineMissing || mismatch)
    return (
      <Alert variant="warning">
        {baselineMissing
          ? '比较基线正文尚不可用，无法展示全文修订对照。可切换“完整文件”阅读当前版本。'
          : '比较依据与当前正文的精确版本不一致，请重新核对版本；未拼接其他版本内容。'}
      </Alert>
    );
  const added = diff.lines.filter((line) => line.kind === 'added').length;
  const removed = diff.lines.filter((line) => line.kind === 'removed').length;
  return (
    <div className="document-diff" data-layout={unified ? 'unified' : 'split'} ref={root}>
      <div className="document-diff-controls">
        <div className="document-diff-stats" aria-label="正文行差异统计">
          <span className="diff-added-count">+{added} 新增行</span>
          <span className="diff-removed-count">−{removed} 删除行</span>
          <span>全文显示，包含未修改内容</span>
        </div>
        <div role="group" aria-label="对照布局">
          <Button
            aria-pressed={!unified}
            disabled={narrow}
            onClick={() => {
              setLayout('split');
            }}
          >
            并排对照
          </Button>
          <Button
            aria-pressed={unified}
            onClick={() => {
              setLayout('unified');
            }}
          >
            统一视图
          </Button>
        </div>
      </div>
      <p className="document-diff-note">
        行号对应规范化正文，不是原 Word 文件行号。格式与位置变化仍可从修改目录核对。
      </p>
      {data.changes.exactInputs.baselineKind === 'EMPTY_INITIAL' && (
        <p className="document-diff-note">无客户原版本：从空基线新增，不伪造原文。</p>
      )}
      {diff.coarse && (
        <p className="document-diff-note">连续差异较大，变化区按整段标记；两侧全文仍完整保留。</p>
      )}
      <div className="document-diff-table" role="table" aria-label="全文修订对照">
        <div className="document-diff-head" role="row">
          {unified ? (
            <div role="columnheader">原行号 / 新行号 · 正文</div>
          ) : (
            <>
              <div role="columnheader">原版本</div>
              <div role="columnheader">当前阅读版本</div>
            </>
          )}
        </div>
        <div role="rowgroup">
          {rows.map((line, index) => {
            const activeRow = bound(line.before, 'before') || bound(line.after, 'after');
            return (
              <div
                className="document-diff-row"
                role="row"
                key={index}
                tabIndex={-1}
                data-active={activeRow}
                data-kind={line.kind}
                data-before-line={line.before?.number}
                data-after-line={line.after?.number}
              >
                {unified ? (
                  <div role="cell" className={`diff-cell is-${line.kind}`}>
                    <span
                      className="diff-number"
                      aria-label={line.before ? `原行 ${line.before.number}` : undefined}
                    >
                      {line.before?.number}
                    </span>
                    <span
                      className="diff-number"
                      aria-label={line.after ? `新行 ${line.after.number}` : undefined}
                    >
                      {line.after?.number}
                    </span>
                    <span
                      className="diff-sign"
                      role="img"
                      aria-label={
                        line.kind === 'added' ? '新增' : line.kind === 'removed' ? '删除' : '未修改'
                      }
                    >
                      {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                    </span>
                    <code className="diff-text">{line.after?.text ?? line.before?.text ?? ''}</code>
                  </div>
                ) : (
                  <>
                    <DiffCell side="before" line={line.before} changed={line.kind !== 'context'} />
                    <DiffCell side="after" line={line.after} changed={line.kind !== 'context'} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DiffCell({
  side,
  line,
  changed,
}: {
  side: 'before' | 'after';
  line: DocumentLine | undefined;
  changed: boolean;
}) {
  const kind = !line ? 'empty' : !changed ? 'context' : side === 'before' ? 'removed' : 'added';
  return (
    <div role="cell" className={`diff-cell diff-${side} is-${kind}`}>
      <span
        className="diff-number"
        aria-label={line ? `${side === 'before' ? '原' : '新'}行 ${line.number}` : undefined}
      >
        {line?.number}
      </span>
      <span
        className="diff-sign"
        role="img"
        aria-label={
          kind === 'removed'
            ? '删除'
            : kind === 'added'
              ? '新增'
              : kind === 'empty'
                ? '无对应行'
                : '未修改'
        }
      >
        {kind === 'removed' ? '−' : kind === 'added' ? '+' : ' '}
      </span>
      <code className="diff-text">{line?.text ?? ''}</code>
    </div>
  );
}
