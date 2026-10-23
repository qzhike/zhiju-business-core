import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import {
  CustodyFailure,
  createBatch,
  createProject,
  downloadSource,
  getBatch,
  getEntries,
  getProject,
  getRequest,
  listBatches,
  listProjects,
  readSession,
  recover,
  saveBlob,
  uploadZip,
} from './client.js';
import {
  actionLabel,
  bytes,
  clearPendingIntent,
  digest,
  instanceMarkerMatches,
  newUuidV7,
  readPendingIntent,
  rememberIntentPayload,
  savePendingIntent,
  stableFingerprint,
  statusLabel,
  type CustodyBatch,
  type CustodyBatchDetail,
  type CustodyEntry,
  type CustodyEntryPage,
  type CustodyProject,
  type CustodySession,
  type PendingIntent,
  type RecoveryAction,
} from './model.js';
import './custody.css';

export interface CustodyPageProps {
  readonly csrfToken: string;
  readonly sessionGeneration: string;
  readonly principalId: string;
  readonly onSessionFailure: () => void;
}

function failureText(error: unknown): string {
  if (error instanceof CustodyFailure) {
    switch (error.code) {
      case 'AUTHENTICATION_REQUIRED':
      case 'UI_REAUTH_REQUIRED':
      case 'UI_SESSION_EXPIRED':
        return '会话已失效，请重新登录后继续。';
      case 'INSTANCE_ACCESS_DENIED':
        return '当前身份未获本实例准入。';
      case 'IDEMPOTENCY_CONFLICT':
        return '同一请求键已用于不同内容；请核对原请求后再试。';
      case 'TARGET_EXISTS':
        return '该目标已由其他请求占用。';
      case 'VERSION_CONFLICT':
        return '项目或批次状态已变化，请刷新后核对当前版本。';
      case 'PROJECT_BUSY':
        return '项目已有正在接收或提取的批次。';
      case 'UPLOAD_BUSY':
        return '原上传仍占用该批次，请先核对原尝试。';
      case 'BATCH_SEALED':
        return '批次已封存，请查询原结果。';
      case 'RECOVERY_NOT_ALLOWED':
        return '当前状态不允许该恢复动作。';
      case 'MANIFEST_NOT_READY':
        return '该批次尚无已封存清单。';
      case 'INPUT_REJECTED':
        return '资料包未通过安全检查或与声明身份不符。';
      case 'INPUT_LIMIT_EXCEEDED':
        return '资料包超出允许的大小或数量限制。';
      case 'STORAGE_INTEGRITY_ERROR':
        return '资料存储校验失败，未替换为其他对象。';
      case 'OUTCOME_UNKNOWN':
        return '原操作结果尚未确定，请查询原请求。';
      case 'UI_NETWORK_UNAVAILABLE':
        return '网络不可用，无法确认原操作是否已提交。';
      default:
        return `操作未完成（${error.code}）。`;
    }
  }
  return '操作未完成。';
}

function useSession(onSessionFailure: () => void): {
  session: CustodySession | null;
  error: string | null;
} {
  const [session, setSession] = useState<CustodySession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const failure = useRef(onSessionFailure);
  failure.current = onSessionFailure;
  useEffect(() => {
    let live = true;
    void readSession()
      .then((value) => {
        if (live) setSession(value);
      })
      .catch((reason: unknown) => {
        if (!live) return;
        if (reason instanceof CustodyFailure && reason.status === 401) failure.current();
        else setError(failureText(reason));
      });
    return () => {
      live = false;
    };
  }, []);
  return { session, error };
}

function IntentPanel({
  intent,
  session,
  onResolved,
}: {
  readonly intent: PendingIntent;
  readonly session: CustodySession;
  readonly onResolved: (requestId: string) => void;
}) {
  const [state, setState] = useState<'IDLE' | 'CHECKING' | 'FOUND' | 'ABSENT' | 'ERROR'>('IDLE');
  const [message, setMessage] = useState('');
  const compatible = instanceMarkerMatches(intent, session);
  const check = useCallback(async () => {
    setState('CHECKING');
    try {
      const found = await getRequest(intent.requestId);
      setState('FOUND');
      setMessage(`原请求已提交：${found.operation}；结果以原请求回执为准。`);
    } catch (error) {
      if (error instanceof CustodyFailure && error.code === 'RESOURCE_NOT_FOUND') {
        setState('ABSENT');
        setMessage(
          '未查到原请求；这不证明旧操作未执行。请按原键重新输入完全相同的内容，或继续查询。',
        );
      } else {
        setState('ERROR');
        setMessage(failureText(error));
      }
    }
  }, [intent.requestId]);
  if (!compatible) {
    return (
      <section className="panel error" role="alert">
        <h2>原请求属于其他实例或身份</h2>
        <p>本页已清除该恢复标记，不会把它提交到当前身份。</p>
        <button
          onClick={() => {
            onResolved(intent.requestId);
          }}
        >
          清除标记
        </button>
      </section>
    );
  }
  return (
    <section className="panel warning" aria-live="polite">
      <h2>存在未确认的原请求</h2>
      <p>
        {intent.operation} · {intent.requestId}
      </p>
      <p className="muted">
        刷新或响应丢失不会自动换用新键；先核对原请求，再决定是否用同一键重试。
      </p>
      <button onClick={() => void check()} disabled={state === 'CHECKING'}>
        核对原请求
      </button>
      {state === 'FOUND' && (
        <button
          onClick={() => {
            onResolved(intent.requestId);
          }}
        >
          收起
        </button>
      )}
      {message.length > 0 && <p>{message}</p>}
    </section>
  );
}

export function CustodyProjectsPage({ csrfToken, onSessionFailure }: CustodyPageProps) {
  const navigate = useNavigate();
  const { session, error: sessionError } = useSession(onSessionFailure);
  const [projects, setProjects] = useState<readonly CustodyProject[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [intent, setIntent] = useState<PendingIntent | null>(() => readPendingIntent());
  const markerRef = useRef<PendingIntent | null>(intent);

  const load = useCallback(async (cursor?: string) => {
    setLoading(true);
    try {
      const page = await listProjects(cursor);
      setProjects((current) => (cursor === undefined ? page.items : [...current, ...page.items]));
      setNextCursor(page.next);
      setError(null);
    } catch (reason) {
      setError(failureText(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session === null) return;
    void load();
  }, [load, session]);

  useEffect(() => {
    if (session === null || markerRef.current === null) return;
    if (!instanceMarkerMatches(markerRef.current, session)) {
      clearPendingIntent(markerRef.current.requestId);
      markerRef.current = null;
      setIntent(null);
    }
  }, [session]);

  const submit = useCallback(async () => {
    if (session === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const fingerprint = await stableFingerprint({ customerName, title });
      const existing = markerRef.current;
      if (existing !== null && existing.operation !== 'mvp.create_project') {
        setError('已有其他未确认的原请求；请先核对或清除该标记。');
        return;
      }
      if (existing !== null && existing.fingerprint !== fingerprint) {
        setError('输入内容与原请求不一致；请恢复原内容后使用同一请求键重试。');
        return;
      }
      const requestId = existing?.requestId ?? newUuidV7();
      const projectId = existing?.targetId ?? newUuidV7();
      if (existing === null) {
        const created: PendingIntent = {
          instanceId: session.instanceId,
          ownerId: session.ownerId,
          authEpoch: session.authEpoch,
          operation: 'mvp.create_project',
          projectId,
          requestId,
          targetId: projectId,
          fingerprint,
        };
        savePendingIntent(created);
        markerRef.current = created;
        setIntent(created);
      }
      rememberIntentPayload(requestId, { customerName, title });
      const project = await createProject({
        projectId,
        requestId,
        customerName,
        title,
        csrfToken,
      });
      clearPendingIntent(requestId);
      markerRef.current = null;
      setIntent(null);
      setProjects((current) => [
        project,
        ...current.filter((item) => item.projectId !== project.projectId),
      ]);
      setCustomerName('');
      setTitle('');
      void navigate(`/custody/projects/${project.projectId}`);
    } catch (reason) {
      if (reason instanceof CustodyFailure && reason.status === 401) onSessionFailure();
      setError(failureText(reason));
    } finally {
      setSubmitting(false);
    }
  }, [csrfToken, customerName, navigate, onSessionFailure, session, title]);

  return (
    <section className="custody">
      <header className="custody-head">
        <div>
          <h1 tabIndex={-1}>项目与资料托管</h1>
          <p className="muted">
            真实项目、原始资料包与条目清单。分析能力尚未接入；已接收不等于已读懂。
          </p>
        </div>
        {session !== null && (
          <dl className="custody-identity">
            <dt>员工</dt>
            <dd>{session.displayName}</dd>
            <dt>实例</dt>
            <dd>{session.instanceId}</dd>
            <dt>授权版本</dt>
            <dd>{session.authEpoch}</dd>
          </dl>
        )}
      </header>
      {sessionError !== null && <p className="error">{sessionError}</p>}
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {intent !== null && session !== null && (
        <IntentPanel
          intent={intent}
          session={session}
          onResolved={(requestId) => {
            clearPendingIntent(requestId);
            markerRef.current = null;
            setIntent(null);
          }}
        />
      )}
      <div className="custody-grid">
        <section className="panel" aria-labelledby="create-project-title">
          <h2 id="create-project-title">创建项目</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label>
              客户名称
              <input
                value={customerName}
                onChange={(event) => {
                  setCustomerName(event.target.value);
                }}
                maxLength={256}
                required
              />
            </label>
            <label>
              项目标题
              <input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
                maxLength={256}
                required
              />
            </label>
            <button className="button primary" type="submit" disabled={submitting}>
              {submitting ? '正在创建…' : '创建项目'}
            </button>
            <p className="muted">不需要旧模板、预设或七模块前置条件。</p>
          </form>
        </section>
        <section className="panel" aria-labelledby="projects-title">
          <h2 id="projects-title">我的项目</h2>
          {loading && projects.length === 0 ? (
            <p role="status">正在读取项目…</p>
          ) : projects.length === 0 ? (
            <p className="muted">尚无项目。</p>
          ) : (
            <ul className="custody-projects">
              {projects.map((project) => (
                <li key={project.projectId}>
                  <Link to={`/custody/projects/${project.projectId}`}>
                    <strong>{project.title}</strong>
                  </Link>
                  <span className="muted">
                    {project.customerName} · 批次 {project.lastBatchNo} · 版本 {project.version}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {nextCursor !== undefined && (
            <button onClick={() => void load(nextCursor)} disabled={loading}>
              加载更多
            </button>
          )}
        </section>
      </div>
    </section>
  );
}

function EntryRows({
  projectId,
  batchId,
  entries,
  onDownload,
}: {
  readonly projectId: string;
  readonly batchId: string;
  readonly entries: readonly CustodyEntry[];
  readonly onDownload: (path: string, name: string) => void;
}) {
  return (
    <table className="custody-entries">
      <thead>
        <tr>
          <th>#</th>
          <th>路径</th>
          <th>状态</th>
          <th>大小</th>
          <th>说明</th>
          <th>来源</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.entryId}>
            <td>{entry.ordinal}</td>
            <td>
              <span title={entry.normalizedPath}>{entry.normalizedPath}</span>
            </td>
            <td>{entry.status}</td>
            <td>{entry.byteLength === undefined ? '—' : bytes(entry.byteLength)}</td>
            <td>{entry.reasonCodes.length === 0 ? '—' : entry.reasonCodes.join('、')}</td>
            <td>
              {entry.sourceId === undefined ? (
                '无可用来源'
              ) : (
                <button
                  className="link"
                  onClick={() => {
                    onDownload(
                      `/bff/mvp/v1/projects/${projectId}/batches/${batchId}/sources/${entry.sourceId}/content`,
                      entry.originalName,
                    );
                  }}
                >
                  下载
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CustodyProjectPage({ csrfToken, onSessionFailure }: CustodyPageProps) {
  const { projectId = '' } = useParams();
  const { session, error: sessionError } = useSession(onSessionFailure);
  const [project, setProject] = useState<CustodyProject | null>(null);
  const [batches, setBatches] = useState<readonly CustodyBatch[]>([]);
  const [selected, setSelected] = useState<CustodyBatchDetail | null>(null);
  const [entriesPage, setEntriesPage] = useState<CustodyEntryPage | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileDigest, setFileDigest] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [intent, setIntent] = useState<PendingIntent | null>(() => readPendingIntent());
  const markerRef = useRef<PendingIntent | null>(intent);
  const recoveryKeys = useRef(new Map<string, string>());
  const uploadRef = useRef<AbortController | null>(null);

  const refreshBatches = useCallback(async () => {
    const [loadedProject, page] = await Promise.all([
      getProject(projectId),
      listBatches(projectId),
    ]);
    setProject(loadedProject);
    setBatches(page.items);
  }, [projectId]);

  const refreshDetail = useCallback(
    async (batchId: string) => {
      const detail = await getBatch(projectId, batchId);
      setSelected(detail);
      if (detail.manifest !== null) {
        const page = await getEntries(projectId, batchId, detail.manifest.manifestId);
        setEntriesPage(page);
      } else {
        setEntriesPage(null);
      }
      return detail;
    },
    [projectId],
  );

  useEffect(() => {
    if (session === null || projectId.length === 0) return;
    let live = true;
    setBusy('加载项目…');
    void Promise.all([getProject(projectId), listBatches(projectId)])
      .then(([loadedProject, page]) => {
        if (!live) return;
        setProject(loadedProject);
        setBatches(page.items);
      })
      .catch((reason: unknown) => {
        if (!live) return;
        if (reason instanceof CustodyFailure && reason.status === 401) onSessionFailure();
        setError(failureText(reason));
      })
      .finally(() => {
        if (live) setBusy('');
      });
    return () => {
      live = false;
    };
  }, [onSessionFailure, projectId, session]);

  useEffect(() => {
    if (session === null || markerRef.current === null) return;
    if (!instanceMarkerMatches(markerRef.current, session)) {
      clearPendingIntent(markerRef.current.requestId);
      markerRef.current = null;
      setIntent(null);
    }
  }, [session]);

  useEffect(() => {
    if (selected === null) return;
    if (!['RECEIVING', 'STAGED', 'EXTRACTING'].includes(selected.batch.status)) return;
    let live = true;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (attempts > 40) {
        window.clearInterval(timer);
        return;
      }
      void refreshDetail(selected.batch.batchId)
        .then(async (detail) => {
          if (!live) return;
          if (!['RECEIVING', 'STAGED', 'EXTRACTING'].includes(detail.batch.status)) {
            window.clearInterval(timer);
            await refreshBatches();
          }
        })
        .catch(() => {
          window.clearInterval(timer);
        });
    }, 1500);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [refreshBatches, refreshDetail, selected]);

  const chooseFile = useCallback(async (value: File | null) => {
    uploadRef.current?.abort();
    setFile(value);
    setFileDigest(null);
    if (value === null) return;
    setBusy('正在计算原包摘要…');
    try {
      setFileDigest(await digest(await value.arrayBuffer()));
    } catch {
      setError('无法读取所选文件。');
      setFile(null);
    } finally {
      setBusy('');
    }
  }, []);

  const submitBatch = useCallback(async () => {
    if (session === null || project === null || file === null || fileDigest === null) return;
    setBusy('正在登记批次…');
    setError(null);
    setNotice(null);
    try {
      const existing = markerRef.current;
      const expectedProjectVersion =
        existing?.expectedVersion ?? (await getProject(projectId)).version;
      const payload: Record<string, unknown> = {
        expectedProjectVersion,
        originalName: file.name,
        declaredBytes: file.size,
        zipSha256: fileDigest,
        ...(note.trim().length === 0 ? {} : { note }),
      };
      const fingerprint = await stableFingerprint(payload);
      if (existing !== null && existing.operation !== 'mvp.create_input_batch') {
        setError('已有其他未确认的原请求；请先核对或清除该标记。');
        return;
      }
      if (existing !== null && existing.fingerprint !== fingerprint) {
        setError('所选文件、大小、摘要或说明与原请求不一致；请恢复原内容后按原键重试。');
        return;
      }
      const requestId = existing?.requestId ?? newUuidV7();
      const batchId = existing?.targetId ?? newUuidV7();
      if (existing === null) {
        const created: PendingIntent = {
          instanceId: session.instanceId,
          ownerId: session.ownerId,
          authEpoch: session.authEpoch,
          operation: 'mvp.create_input_batch',
          projectId,
          requestId,
          targetId: batchId,
          fingerprint,
          expectedVersion: expectedProjectVersion,
        };
        savePendingIntent(created);
        markerRef.current = created;
        setIntent(created);
      }
      rememberIntentPayload(requestId, payload, file);
      const batch = await createBatch({
        projectId,
        batchId,
        requestId,
        expectedProjectVersion,
        originalName: file.name,
        declaredBytes: file.size,
        zipSha256: fileDigest,
        ...(note.trim().length === 0 ? {} : { note }),
        csrfToken,
      });
      clearPendingIntent(requestId);
      markerRef.current = null;
      setIntent(null);
      await refreshBatches();
      await refreshDetail(batch.batchId);
      const attempt = batch.currentAttempt;
      if (attempt?.kind === 'UPLOAD') {
        setBusy('正在上传原包…');
        const controller = new AbortController();
        uploadRef.current = controller;
        try {
          await uploadZip({
            projectId,
            batchId: batch.batchId,
            attemptId: attempt.attemptId,
            generation: attempt.generation,
            file,
            csrfToken,
            signal: controller.signal,
          });
          setNotice('上传流已校验，正在提取条目；提取结果以批次当前状态为准。');
          await refreshBatches();
          await refreshDetail(batch.batchId);
          await refreshBatches();
        } catch (reason) {
          if (reason instanceof CustodyFailure && reason.status === 401) onSessionFailure();
          setError(`${failureText(reason)} 批次已登记；刷新后可核对原尝试，不会自动换用新键。`);
          await refreshDetail(batch.batchId).catch(() => undefined);
        } finally {
          uploadRef.current = null;
        }
      }
      setFile(null);
      setFileDigest(null);
      setNote('');
    } catch (reason) {
      if (reason instanceof CustodyFailure && reason.status === 401) onSessionFailure();
      setError(failureText(reason));
    } finally {
      setBusy('');
    }
  }, [
    csrfToken,
    file,
    fileDigest,
    note,
    onSessionFailure,
    project,
    projectId,
    refreshBatches,
    refreshDetail,
    session,
  ]);

  const runRecovery = useCallback(
    async (batch: CustodyBatch, action: RecoveryAction) => {
      const key = `${batch.batchId}:${action}`;
      const requestId = recoveryKeys.current.get(key) ?? newUuidV7();
      recoveryKeys.current.set(key, requestId);
      setBusy(`正在${actionLabel(action)}…`);
      setError(null);
      setNotice(null);
      try {
        await recover({
          projectId,
          batchId: batch.batchId,
          requestId,
          expectedBatchVersion: batch.version,
          action,
          csrfToken,
        });
        recoveryKeys.current.delete(key);
        setNotice(`${actionLabel(action)}已提交；以批次当前状态为准。`);
        await refreshBatches();
        await refreshDetail(batch.batchId);
      } catch (reason) {
        if (reason instanceof CustodyFailure && reason.status === 401) onSessionFailure();
        setError(failureText(reason));
        await refreshDetail(batch.batchId).catch(() => undefined);
      } finally {
        setBusy('');
      }
    },
    [csrfToken, onSessionFailure, projectId, refreshBatches, refreshDetail],
  );

  const download = useCallback(async (path: string, name: string) => {
    setBusy('正在校验并下载…');
    setError(null);
    try {
      saveBlob(await downloadSource(path), name);
    } catch (reason) {
      setError(failureText(reason));
    } finally {
      setBusy('');
    }
  }, []);

  const manifest = selected?.manifest ?? null;
  const limited = useMemo(
    () =>
      entriesPage === null
        ? []
        : entriesPage.entries.filter((entry) => entry.status !== 'ACCEPTED'),
    [entriesPage],
  );

  return (
    <section className="custody">
      <header className="custody-head">
        <div>
          <p className="muted">
            <Link to="/custody">← 返回项目列表</Link>
          </p>
          <h1 tabIndex={-1}>{project?.title ?? '项目资料'}</h1>
          {project !== null && (
            <p className="muted">
              {project.customerName} · 版本 {project.version} · 批次 {project.lastBatchNo}
            </p>
          )}
        </div>
        <div className="panel analysis-note">
          <strong>分析未接入</strong>
          <span>资料已接收只证明托管，不表示文件已读懂或已分析。</span>
        </div>
      </header>
      {sessionError !== null && <p className="error">{sessionError}</p>}
      {busy.length > 0 && (
        <p role="status" className="muted">
          {busy}
        </p>
      )}
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice !== null && <p className="notice">{notice}</p>}
      {intent !== null && session !== null && (
        <IntentPanel
          intent={intent}
          session={session}
          onResolved={(requestId) => {
            clearPendingIntent(requestId);
            markerRef.current = null;
            setIntent(null);
          }}
        />
      )}
      <div className="custody-grid">
        <section className="panel" aria-labelledby="new-batch-title">
          <h2 id="new-batch-title">新增资料批次</h2>
          <p className="muted">
            首选 ZIP 可包含 DOCX、Markdown 与 XLSX。补充批次追加在旧清单旁，不覆盖此前批次。
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitBatch();
            }}
          >
            <label>
              选择 ZIP
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
              />
            </label>
            {file !== null && (
              <p className="muted">
                {file.name} · {bytes(file.size)}
                {fileDigest === null ? '' : ` · SHA-256 ${fileDigest.slice(0, 16)}…`}
              </p>
            )}
            <label>
              说明（可选）
              <textarea
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
                maxLength={4096}
                rows={3}
              />
            </label>
            <button
              className="button primary"
              type="submit"
              disabled={file === null || fileDigest === null || project === null || busy.length > 0}
            >
              登记并上传
            </button>
          </form>
        </section>
        <section className="panel" aria-labelledby="batches-title">
          <h2 id="batches-title">批次</h2>
          {batches.length === 0 ? (
            <p className="muted">尚无批次。</p>
          ) : (
            <ul className="custody-batches">
              {batches.map((batch) => (
                <li
                  key={batch.batchId}
                  className={selected?.batch.batchId === batch.batchId ? 'active' : ''}
                >
                  <button className="link" onClick={() => void refreshDetail(batch.batchId)}>
                    第 {batch.batchNo} 批 · {batch.originalName}
                  </button>
                  <span className="muted">
                    {statusLabel(batch.status)} · {bytes(batch.declaredBytes)} · v{batch.version}
                  </span>
                  {batch.reasonCodes.length > 0 && (
                    <span className="error small">{batch.reasonCodes.join('、')}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {selected !== null && (
        <section className="panel" aria-labelledby="batch-detail-title">
          <h2 id="batch-detail-title">
            批次 {selected.batch.batchNo} · {statusLabel(selected.batch.status)}
          </h2>
          <dl className="custody-facts">
            <dt>原请求</dt>
            <dd>{selected.batch.originalRequestId ?? '—'}</dd>
            <dt>原始包</dt>
            <dd>
              {selected.batch.originalName} · {bytes(selected.batch.declaredBytes)}
            </dd>
            <dt>SHA-256</dt>
            <dd className="mono">{selected.batch.zipSha256}</dd>
            <dt>当前尝试</dt>
            <dd>
              {selected.batch.currentAttempt === undefined
                ? '无'
                : `${selected.batch.currentAttempt.kind} #${selected.batch.currentAttempt.number} · generation ${selected.batch.currentAttempt.generation} · ${selected.batch.currentAttempt.status}`}
            </dd>
            {selected.batch.note !== undefined && (
              <>
                <dt>说明</dt>
                <dd>{selected.batch.note}</dd>
              </>
            )}
          </dl>
          {manifest !== null && (
            <>
              <p>
                已封存清单：共 {manifest.totalEntries} 项，可分析来源 {manifest.acceptedEntries}{' '}
                项， 受限/不支持 {manifest.limitedEntries} 项。
              </p>
              {manifest.acceptedEntries === 0 && (
                <p className="warning">该安全包没有任何可分析来源；不能显示为可分析资料。</p>
              )}
              <p className="mono small">{manifest.manifestHash}</p>
              <button
                className="link"
                onClick={() =>
                  void download(
                    `/bff/mvp/v1/projects/${projectId}/batches/${selected.batch.batchId}/sources/${manifest.originalZip.sourceId}/content`,
                    'original.zip',
                  )
                }
              >
                下载原包
              </button>
            </>
          )}
          {selected.permittedActions.length > 0 && (
            <div className="custody-actions">
              <h3>允许的恢复动作</h3>
              <p className="muted">
                动作来自服务器当前状态，提交时会重新校验原尝试与写者是否已结束。
              </p>
              {selected.permittedActions.map((action) => (
                <button
                  key={action}
                  className={action === 'ABANDON' ? 'button danger' : 'button'}
                  onClick={() => void runRecovery(selected.batch, action)}
                  disabled={busy.length > 0}
                >
                  {actionLabel(action)}
                </button>
              ))}
            </div>
          )}
          <h3>尝试历史</h3>
          <ol className="custody-attempts">
            {selected.attempts.map((attempt) => (
              <li key={attempt.attemptId}>
                {attempt.kind} #{attempt.number} · generation {attempt.generation} ·{' '}
                {attempt.status}
                {attempt.endedAt === undefined ? '' : ` · 结束于 ${attempt.endedAt}`}
              </li>
            ))}
          </ol>
          {entriesPage !== null && (
            <>
              <h3>条目清单</h3>
              {limited.length > 0 && (
                <p className="muted">
                  受限/不支持条目仍保留在清单中，原因：{' '}
                  {[...new Set(limited.flatMap((entry) => entry.reasonCodes))].join('、')}
                </p>
              )}
              <EntryRows
                projectId={projectId}
                batchId={selected.batch.batchId}
                entries={entriesPage.entries}
                onDownload={(path, name) => void download(path, name)}
              />
              {entriesPage.next !== undefined && (
                <button
                  onClick={() =>
                    void getEntries(
                      projectId,
                      selected.batch.batchId,
                      entriesPage.manifest.manifestId,
                      entriesPage.next,
                    ).then((page) => {
                      setEntriesPage({
                        ...page,
                        entries: [...entriesPage.entries, ...page.entries],
                      });
                    })
                  }
                >
                  加载更多条目
                </button>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}
