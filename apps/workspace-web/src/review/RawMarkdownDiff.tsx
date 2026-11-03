import { useMemo } from 'react';
import { documentDiff } from './document-diff.js';
import { physicalLines, type PhysicalLine } from './physical-lines.js';
import './document-diff.css';

export function RawMarkdownDiff({ before, after }: { before: string; after: string }) {
  const diff = useMemo(() => {
    const left = physicalLines(before);
    const right = physicalLines(after);
    const comparable = (lines: PhysicalLine[]) =>
      lines.map((line) => ({
        number: line.number,
        text: line.raw,
        unitIds: [],
      }));
    return { ...documentDiff(comparable(left), comparable(right)), left, right };
  }, [before, after]);
  return (
    <div className="document-diff" data-layout="unified">
      <p>原始 Markdown 物理行对照 · 保留空行与换行差异 · 包含未修改正文</p>
      {diff.coarse && <p>差异范围较大，变化区按整段标记；两侧正文均完整保留。</p>}
      <div className="document-diff-table" role="table" aria-label="原始 Markdown 修订对照">
        <div className="document-diff-head" role="row">
          <div role="columnheader">原行 / 新行 · 正文</div>
        </div>
        <div role="rowgroup">
          {diff.lines.map((line, index) => {
            const left = line.before ? diff.left[line.before.number - 1] : undefined;
            const right = line.after ? diff.right[line.after.number - 1] : undefined;
            const value = right ?? left;
            return (
              <div
                className="document-diff-row"
                role="row"
                key={index}
                data-kind={line.kind}
                data-before-line={left?.number}
                data-after-line={right?.number}
              >
                <div role="cell" className={`diff-cell is-${line.kind}`}>
                  <span
                    className="diff-number"
                    aria-label={left ? `原行 ${left.number}` : undefined}
                  >
                    {left?.number}
                  </span>
                  <span
                    className="diff-number"
                    aria-label={right ? `新行 ${right.number}` : undefined}
                  >
                    {right?.number}
                  </span>
                  <span className="diff-sign" aria-hidden="true">
                    {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                  </span>
                  <code className="diff-text">
                    {value?.text}
                    <span className="raw-line-ending">
                      {value?.ending === 'NONE'
                        ? ' ⟪末尾无换行⟫'
                        : value?.ending === 'CRLF'
                          ? ' ⟪CRLF⟫'
                          : ' ⟪LF⟫'}
                    </span>
                  </code>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
