import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../components/ui/button.js';
import { CustodyFailure } from './client.js';
import { newUuidV7 } from './model.js';
import { previewId } from './preview-model.js';
import { createReadCheck, listReadChecks } from './read-check-client.js';
import { checkStatusText, type CheckView } from './read-check-model.js';

export function ReadCheckLaunch({
  projectId,
  batchId,
  manifestId,
  csrfToken,
  onSessionFailure,
}: {
  readonly projectId: string;
  readonly batchId: string;
  readonly manifestId: string;
  readonly csrfToken: string;
  readonly onSessionFailure: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const [checks, setChecks] = useState<readonly CheckView[]>([]);
  const [next, setNext] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  const failure = useRef(onSessionFailure);
  failure.current = onSessionFailure;
  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    void listReadChecks(projectId, batchId, undefined, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setChecks(result.items);
          setNext(result.next);
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof CustodyFailure && [401, 403].includes(reason.status))
          failure.current();
        setError('暂时无法取得检查记录，可以重试查看。');
      });
    return () => {
      live.current = false;
      controller.abort();
    };
  }, [projectId, batchId]);
  const open = (targetBatch: string, checkId: string) => {
    setParams({ batch: targetBatch, check: checkId });
  };
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const saved = params.get('readRequest');
    const key = previewId(saved) ? saved : newUuidV7();
    setParams({ batch: batchId, readRequest: key }, { replace: true });
    try {
      const check = await createReadCheck(projectId, batchId, manifestId, key, csrfToken);
      if (live.current) open(batchId, check.checkId);
    } catch (reason) {
      if (!live.current) return;
      if (reason instanceof CustodyFailure && [401, 403].includes(reason.status)) failure.current();
      if (
        reason instanceof CustodyFailure &&
        reason.code === 'READ_CHECK_ACTIVE' &&
        reason.details !== undefined
      ) {
        open(reason.details.batchId, reason.details.checkId);
      } else setError('未能确认提交结果。请重试；将沿用同一请求，不会重复创建检查。');
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const more = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await listReadChecks(projectId, batchId, next);
      if (live.current) {
        setChecks((old) => (next === undefined ? result.items : [...old, ...result.items]));
        setNext(result.next);
      }
    } catch (reason) {
      if (!live.current) return;
      if (reason instanceof CustodyFailure && [401, 403].includes(reason.status)) failure.current();
      setError('无法取得检查记录，请重试。');
    } finally {
      if (live.current) setBusy(false);
    }
  };
  const active = checks.find((check) => ['QUEUED', 'RUNNING', 'UNKNOWN'].includes(check.status));
  return (
    <section className="read-check-launch" aria-label="整批资料读取检查">
      <div className="read-check-actions">
        <Button
          disabled={busy}
          onClick={() => {
            if (active === undefined) void submit();
            else open(batchId, active.checkId);
          }}
        >
          {busy ? '正在处理…' : active === undefined ? '检查整批资料' : '返回检查结果'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="warning">
          {error}{' '}
          <Button variant="link" disabled={busy} onClick={() => void more()}>
            重试查看记录
          </Button>
        </p>
      )}
      {checks.length > 0 && (
        <details>
          <summary>检查记录 · {checks.length} 次</summary>
          <ul className="read-check-history">
            {checks.map((check) => (
              <li key={check.checkId}>
                <span>
                  {new Date(check.createdAt).toLocaleString('zh-CN')} ·{' '}
                  {checkStatusText[check.status]} · {check.totalEntries - check.counts.pending}/
                  {check.totalEntries} 项
                </span>
                <Button
                  variant="link"
                  onClick={() => {
                    open(batchId, check.checkId);
                  }}
                >
                  查看检查结果
                </Button>
              </li>
            ))}
          </ul>
          {next !== undefined && (
            <Button variant="outline" disabled={busy} onClick={() => void more()}>
              更早记录
            </Button>
          )}
        </details>
      )}
    </section>
  );
}
