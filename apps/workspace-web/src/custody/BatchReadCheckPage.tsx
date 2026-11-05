import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../components/ui/button.js';
import { NativeSelect } from '../components/ui/native-select.js';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '../components/ui/table.js';
import { CustodyFailure } from './client.js';
import { EntryPagination } from './EntryPagination.js';
import { SourcePreview } from './SourcePreview.js';
import { entryReasonText } from './entry-text.js';
import { previewId, previewReasonText } from './preview-model.js';
import { getReadCheck, getReadCheckEntries } from './read-check-client.js';
import {
  checkFilters,
  checkReasonText,
  checkStatusText,
  type CheckFilter,
  type CheckPage,
  type CheckView,
} from './read-check-model.js';

const resultText = {
  AVAILABLE: '取得内容',
  LIMITED: '读取受限',
  UNSUPPORTED: '读取不支持',
  FAILED: '读取失败',
  NOT_ELIGIBLE: '未进入读取',
};

export function BatchReadCheckPage({
  projectId,
  batchId,
  checkId,
  onSessionFailure,
  onDownload,
  downloadError,
}: {
  readonly projectId: string;
  readonly batchId: string;
  readonly checkId: string;
  readonly onSessionFailure: () => void;
  readonly onDownload: (path: string, name: string) => void;
  readonly downloadError: string | null;
}) {
  const [params, setParams] = useSearchParams();
  const filterValue = params.get('filter') ?? 'ALL';
  const filter = (Object.hasOwn(checkFilters, filterValue) ? filterValue : 'ALL') as CheckFilter;
  const size = [20, 50, 100].includes(Number(params.get('size'))) ? Number(params.get('size')) : 20;
  const pageValue = Number(params.get('checkPage'));
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  const versionValue = Number(params.get('resultVersion'));
  const version = Number.isSafeInteger(versionValue) && versionValue > 0 ? versionValue : undefined;
  const source = params.get('source'),
    manifest = params.get('manifest');
  const previewing = previewId(source) && previewId(manifest);
  const [view, setView] = useState<CheckView | null>(null);
  const [report, setReport] = useState<CheckPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const latestParams = useRef(params);
  latestParams.current = params;
  const failure = useRef(onSessionFailure);
  failure.current = onSessionFailure;
  const handleFailure = (reason: unknown) => {
    if (reason instanceof CustodyFailure && [401, 403].includes(reason.status)) {
      setView(null);
      setReport(null);
      failure.current();
    }
  };
  const failRef = useRef(handleFailure);
  failRef.current = handleFailure;

  useEffect(() => {
    if (previewing) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setReport(null);
    void (async () => {
      let value = await getReadCheckEntries(
        projectId,
        batchId,
        checkId,
        filter,
        size,
        undefined,
        version,
        controller.signal,
      );
      const count = Math.max(1, Math.ceil(value.total / size));
      if (page > count) {
        const updated = new URLSearchParams(latestParams.current);
        updated.set('checkPage', '1');
        setParams(updated, { replace: true });
        return;
      }
      for (let index = 1; index < page; index++) {
        if (value.next === undefined) throw new Error('Invalid page boundary');
        value = await getReadCheckEntries(
          projectId,
          batchId,
          checkId,
          filter,
          size,
          value.next,
          value.check.resultVersion,
          controller.signal,
        );
      }
      if (controller.signal.aborted) return;
      setReport(value);
      setView((old) =>
        old !== null && old.resultVersion > value.check.resultVersion ? old : value.check,
      );
      if (version === undefined) {
        const updated = new URLSearchParams(latestParams.current);
        updated.set('resultVersion', String(value.check.resultVersion));
        setParams(updated, { replace: true });
      }
    })()
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        failRef.current(reason);
        if (reason instanceof CustodyFailure && reason.code === 'READ_CHECK_RESULTS_CHANGED') {
          setNotice('检查结果已更新，已回到第一页。');
          const updated = new URLSearchParams(latestParams.current);
          updated.delete('resultVersion');
          updated.set('checkPage', '1');
          setParams(updated, { replace: true });
        } else setError('无法取得检查结果，请核对当前会话后重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [projectId, batchId, checkId, filter, size, page, version, previewing, attempt, setParams]);

  useEffect(() => {
    if (previewing) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const isStopped = () => stopped;
    const poll = async () => {
      if (isStopped() || document.hidden) return;
      controller = new AbortController();
      const current = controller;
      try {
        const value = await getReadCheck(projectId, batchId, checkId, current.signal);
        if (isStopped() || current.signal.aborted) return;
        setView((old) => (old !== null && old.resultVersion > value.resultVersion ? old : value));
        if (['QUEUED', 'RUNNING'].includes(value.status))
          timer = setTimeout(() => void poll(), 2000);
      } catch (reason) {
        if (isStopped() || current.signal.aborted) return;
        failRef.current(reason);
        setError('暂时无法更新检查进度，已显示的结果可能不是最新版本。请重试。');
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      controller?.abort();
      if (!document.hidden) void poll();
    };
    document.addEventListener('visibilitychange', visibility);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [projectId, batchId, checkId, previewing, attempt]);

  const update = (changes: Record<string, string | undefined>) => {
    const updated = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) updated.delete(key);
      else updated.set(key, value);
    }
    setParams(updated);
  };
  if (previewing)
    return (
      <SourcePreview
        key={source}
        identity={{ projectId, batchId, manifestId: manifest, sourceId: source }}
        onBack={() => {
          update({ source: undefined, manifest: undefined });
        }}
        onDownload={onDownload}
        onSessionFailure={onSessionFailure}
        downloadError={downloadError}
      />
    );
  const observed = report?.check;
  const current = view ?? observed;
  return (
    <section className="custody read-check-report" aria-label="整批读取检查报告">
      <header className="custody-head">
        <div>
          <Button
            variant="ghost"
            onClick={() => {
              setParams({ batch: batchId });
            }}
          >
            ← 返回当前批次
          </Button>
          <h1 tabIndex={-1}>整批资料读取检查</h1>
          <p className="muted">
            核对受支持内容能否提取；检查结束不代表全部文件可读取，也不代表业务分析完成。
          </p>
        </div>
      </header>
      {current !== undefined && (
        <section className="read-check-summary" aria-label="检查进度">
          <div className="read-check-actions">
            <strong>{checkStatusText[current.status]}</strong>
            <span>
              {current.totalEntries - current.counts.pending} / {current.totalEntries} 项已有结果
            </span>
          </div>
          <progress
            aria-label="检查进度"
            max={Math.max(1, current.totalEntries)}
            value={current.totalEntries - current.counts.pending}
          />
          <dl className="read-check-counts">
            {(
              [
                ['取得内容', current.counts.available],
                ['读取受限', current.counts.limited],
                ['读取不支持', current.counts.unsupported],
                ['读取失败', current.counts.failed],
                ['未进入读取', current.counts.notEligible],
                ['尚未检查', current.counts.pending],
              ] as const
            ).map(([label, count]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <p className="muted">
            创建于 {new Date(current.createdAt).toLocaleString('zh-CN')}
            {current.endedAt !== undefined
              ? ` · 结束于 ${new Date(current.endedAt).toLocaleString('zh-CN')}`
              : ''}
          </p>
          {current.reasonCodes.map((code) => (
            <p key={code} className="warning">
              {checkReasonText(code)}
            </p>
          ))}
          {['INTERRUPTED', 'FAILED'].includes(current.status) && (
            <p>已保存的结果保留。返回当前批次后可重新检查，原记录不会被覆盖。</p>
          )}
          {current.status === 'UNKNOWN' && (
            <p className="warning">正在等待运维核对原执行，暂不能创建第二个检查；请保留本报告。</p>
          )}
          <details>
            <summary>检查标识与读取版本</summary>
            <p className="mono small">
              检查：{current.checkId}
              <br />
              批次：{batchId}
              <br />
              清单：{current.manifestId}
              <br />
              读取规则：{current.profileId}
              <br />
              规则摘要：{current.profileHash}
            </p>
          </details>
        </section>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="warning">
          {error}{' '}
          <Button
            variant="outline"
            onClick={() => {
              setAttempt((value) => value + 1);
            }}
          >
            重试
          </Button>
        </p>
      )}
      {observed !== undefined && view !== null && observed.resultVersion < view.resultVersion && (
        <p role="status" className="notice">
          已有新的检查结果。
          <Button
            variant="outline"
            onClick={() => {
              setNotice('检查结果已更新，已回到第一页。');
              update({ resultVersion: undefined, checkPage: '1' });
            }}
          >
            更新列表
          </Button>
        </p>
      )}
      <div className="read-check-actions">
        <label htmlFor="read-check-filter">结果筛选</label>
        <NativeSelect
          id="read-check-filter"
          value={filter}
          onChange={(event) => {
            update({ filter: event.target.value, checkPage: '1', resultVersion: undefined });
          }}
        >
          {Object.entries(checkFilters).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </NativeSelect>
        {report !== null && (
          <span className="muted">
            共 {report.total} 项 · 列表版本 {report.check.resultVersion}
          </span>
        )}
      </div>
      <p className="muted">
        “仅看问题”不包含系统附属文件；它们仍保留在全部条目中。报告保存检查元数据，查看内容时会重新读取原件。
      </p>
      {loading && <p role="status">正在载入检查结果…</p>}
      {report !== null && (
        <>
          <Table className="read-check-table">
            <TableHeader>
              <TableRow>
                <TableHead>文件</TableHead>
                <TableHead>检查结果与说明</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.entries.map(({ entry, result }) => (
                <TableRow key={entry.entryId}>
                  <TableCell>
                    <strong>{entry.normalizedPath}</strong>
                    <p className="muted">第 {entry.ordinal + 1} 项</p>
                  </TableCell>
                  <TableCell>
                    <strong>
                      {result === undefined
                        ? ['QUEUED', 'RUNNING'].includes(report.check.status)
                          ? '等待检查'
                          : '尚未检查'
                        : resultText[result.status]}
                    </strong>
                    {entry.reasonCodes.map((code) => (
                      <p className="muted" key={code}>
                        {entryReasonText(code)}
                      </p>
                    ))}
                    {result?.limitations.map((code) => (
                      <p className="muted" key={code}>
                        {Object.hasOwn(previewReasonText, code)
                          ? previewReasonText[code as keyof typeof previewReasonText]
                          : '存在读取限制，请核对原件。'}
                      </p>
                    ))}
                    {result?.counts !== undefined && (
                      <p className="muted">
                        {result.counts.characters} 字符 · {result.counts.paragraphs} 段 ·{' '}
                        {result.counts.tables} 表
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    {entry.sourceId !== undefined && (
                      <div className="read-check-actions">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            update({ source: entry.sourceId, manifest: report.check.manifestId });
                          }}
                        >
                          查看当前提取内容
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            onDownload(
                              `/bff/mvp/v1/projects/${projectId}/batches/${batchId}/sources/${entry.sourceId}/content`,
                              entry.normalizedPath.split('/').at(-1) ?? 'document',
                            );
                          }}
                        >
                          下载原件
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {report.entries.length === 0 && <p>该分类没有条目。</p>}
          <EntryPagination
            page={page}
            pageCount={Math.max(1, Math.ceil(report.total / size))}
            pageSize={size}
            loading={loading}
            onPage={(number) => {
              update({ checkPage: String(number) });
            }}
            onPageSize={(number) => {
              update({ size: String(number), checkPage: '1', resultVersion: undefined });
            }}
          />
        </>
      )}
      {downloadError !== null && (
        <p role="alert" className="warning">
          {downloadError}
        </p>
      )}
    </section>
  );
}
