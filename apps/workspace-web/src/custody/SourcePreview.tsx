import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button.js';
import { Alert } from '../components/ui/alert.js';
import { ArtifactMarkdown } from '../review/ArtifactMarkdown.js';
import { CustodyFailure, getSourcePreview } from './client.js';
import { bytes } from './model.js';
import {
  previewReasonText,
  type PreviewIdentity,
  type SourcePreview as Preview,
} from './preview-model.js';

const statusText = {
  AVAILABLE: '提取内容可用',
  LIMITED: '提取内容 · 存在限制',
  UNSUPPORTED: '暂不支持此提取视图',
  UNAVAILABLE: '本次提取不可用',
};
const revisionText = { ins: '插入', del: '删除', moveFrom: '移出', moveTo: '移入' };

export function SourcePreview({
  identity,
  batchNo,
  onBack,
  onDownload,
  onSessionFailure,
  downloadError,
}: {
  readonly identity: PreviewIdentity;
  readonly batchNo?: number;
  readonly onBack: () => void;
  readonly onDownload: (path: string, name: string) => void;
  readonly onSessionFailure: () => void;
  readonly downloadError: string | null;
}) {
  const [value, setValue] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [paragraphLimit, setParagraphLimit] = useState(200);
  const cancel = useRef<AbortController | null>(null);
  const sessionFailure = useRef(onSessionFailure);
  sessionFailure.current = onSessionFailure;
  const { projectId, batchId, sourceId, manifestId } = identity;
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    cancel.current = controller;
    setValue(null);
    setError(null);
    setLoading(true);
    setParagraphLimit(200);
    void getSourcePreview({ projectId, batchId, sourceId, manifestId }, controller.signal)
      .then((result) => {
        if (live && !controller.signal.aborted) setValue(result);
      })
      .catch((reason: unknown) => {
        if (!live || controller.signal.aborted) return;
        if (reason instanceof CustodyFailure && (reason.status === 401 || reason.status === 403))
          sessionFailure.current();
        setError(
          reason instanceof CustodyFailure && reason.code === 'STORAGE_INTEGRITY_ERROR'
            ? '原件完整性校验失败，未展示内容。'
            : '无法读取这份资料，请核对当前会话与来源后重试。',
        );
      })
      .finally(() => {
        if (live && !controller.signal.aborted) setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
  }, [projectId, batchId, sourceId, manifestId, attempt]);
  const content = value?.sections;
  return (
    <section className="custody source-preview" aria-label="资料提取内容">
      <header className="source-preview-head">
        <Button variant="ghost" onClick={onBack}>
          ← 返回文件列表
        </Button>
        <p className="muted">
          {batchNo === undefined ? '已封存批次' : `批次 ${batchNo}`} · 原件内容核对
        </p>
        <h1 tabIndex={-1}>{value?.fileName ?? '读取资料内容'}</h1>
        {value !== null && (
          <div className="source-preview-meta">
            <span>
              {statusText[value.status]} · {bytes(value.sourceRef.byteLength)}
            </span>
            <Button
              variant="outline"
              onClick={() => {
                onDownload(
                  `/bff/mvp/v1/projects/${projectId}/batches/${batchId}/sources/${sourceId}/content`,
                  value.fileName,
                );
              }}
            >
              下载原件
            </Button>
          </div>
        )}
      </header>
      {loading && (
        <div role="status" className="source-preview-state">
          <p>正在安全读取这份资料…</p>
          <Button
            variant="outline"
            onClick={() => {
              cancel.current?.abort();
              setLoading(false);
              setError('已取消本次读取，可以重试或返回文件列表。');
            }}
          >
            取消读取
          </Button>
        </div>
      )}
      {error !== null && (
        <Alert variant="warning">
          <p role="alert">{error}</p>
        </Alert>
      )}
      {downloadError !== null && (
        <Alert variant="warning">
          <p role="alert">{downloadError}</p>
        </Alert>
      )}
      {value !== null && value.limitations.length > 0 && (
        <aside className="source-preview-notes" aria-label="读取限制">
          <strong>读取说明与限制</strong>
          <ul>
            {value.limitations.map((reason) => (
              <li key={reason}>{previewReasonText[reason]}</li>
            ))}
          </ul>
        </aside>
      )}
      {!loading && (error !== null || value?.status === 'UNAVAILABLE') && (
        <Button
          onClick={() => {
            setAttempt((current) => current + 1);
          }}
        >
          重新读取
        </Button>
      )}
      {content?.format === 'MARKDOWN' && (
        <div className="source-preview-body">
          <ArtifactMarkdown text={content.source} />
        </div>
      )}
      {content?.format === 'DOCX' && (
        <div className="source-preview-body">
          <nav className="source-preview-nav" aria-label="内容分类">
            <a href="#preview-paragraphs">段落</a>
            <a href="#preview-tables">表格</a>
            <a href="#preview-comments">批注与文本修订</a>
            <a href="#preview-auxiliary">页眉页脚与域</a>
          </nav>
          <section id="preview-paragraphs">
            <h2>
              段落提取 <small>{content.paragraphs.length} 段</small>
            </h2>
            <p className="muted">序号是提取定位，不是原件行号；表格内段落也包含在此处。</p>
            {content.paragraphs.slice(0, paragraphLimit).map((row) => (
              <div className="source-preview-paragraph" key={row.position}>
                <span aria-label={`提取段落 ${row.position}`}>{row.position}</span>
                <p>{row.text || '（空段落）'}</p>
              </div>
            ))}
            {paragraphLimit < content.paragraphs.length && (
              <Button
                variant="outline"
                onClick={() => {
                  setParagraphLimit((current) => current + 200);
                }}
              >
                继续显示段落（已显示 {paragraphLimit} / {content.paragraphs.length}）
              </Button>
            )}
          </section>
          <section id="preview-tables">
            <h2>
              表格 <small>{content.tables.length} 张</small>
            </h2>
            {content.tables.length === 0 && <p className="muted">未提取到表格。</p>}
            {content.tables.map((table) => (
              <div key={table.position} className="source-preview-table">
                <table tabIndex={0}>
                  <caption>提取表格 {table.position}</caption>
                  <tbody>
                    {table.rows.map((row, index) => (
                      <tr key={index}>
                        {row.cells.map((cell) => (
                          <td key={cell.column} colSpan={cell.colSpan} rowSpan={cell.rowSpan}>
                            {cell.text}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
          <section id="preview-comments">
            <h2>
              批注 <small>{content.comments.length} 条</small>
            </h2>
            {content.comments.map((row, index) => (
              <article key={index}>
                <h3>
                  批注 {row.id} · 提取段落 {row.paragraphs.join('、') || '未定位'}
                </h3>
                <p className="source-preview-text">{row.text}</p>
              </article>
            ))}
            <h2>
              已提取的文本修订 <small>{content.revisions.length} 条</small>
            </h2>
            <p className="muted">不包含格式修订和完整原位定位，0 条不代表原件没有修订。</p>
            {content.revisions.map((row, index) => (
              <article className="source-preview-revision" key={index}>
                <h3>
                  {revisionText[row.kind]} · {row.id || '无编号'}
                </h3>
                <p className="source-preview-text">{row.text}</p>
              </article>
            ))}
          </section>
          <section id="preview-auxiliary">
            <h2>页眉与页脚</h2>
            {content.headersFooters.map((row) => (
              <article key={row.part}>
                <h3>{row.part}</h3>
                <p className="source-preview-text">{row.text || '（未提取到文字）'}</p>
              </article>
            ))}
            <h2>域指令文本</h2>
            <p className="muted">仅展示提取到的文字，不执行域指令。</p>
            {content.fields.map((row, index) => (
              <article key={index}>
                <small>{row.part}</small>
                <pre>{row.text}</pre>
              </article>
            ))}
          </section>
        </div>
      )}
    </section>
  );
}
