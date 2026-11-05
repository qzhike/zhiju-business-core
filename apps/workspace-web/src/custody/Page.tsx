import { limitViolationText } from './limits.js';
import { entryReasonText, entryStatusLabel } from './entry-text.js';
import { Alert } from '../components/ui/alert.js';
import { Card } from '../components/ui/card.js';
import { Button } from '../components/ui/button.js';
import { Label } from '../components/ui/label.js';
import { Input } from '../components/ui/input.js';
import { NativeSelect } from '../components/ui/native-select.js';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '../components/ui/table.js';
import { Textarea } from '../components/ui/textarea.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { SourcePreview } from './SourcePreview.js';
import { ReadCheckLaunch } from './ReadCheckLaunch.js';
import { BatchReadCheckPage } from './BatchReadCheckPage.js';
import { EntryPagination } from './EntryPagination.js';
import { previewId } from './preview-model.js';

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
  type CustodyProjectSummary,
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
      <Card asChild>
        <Alert asChild variant="warning">
          <section className="panel error" role="alert">
            <h2>原请求属于其他实例或身份</h2>
            <p>本页已清除该恢复标记，不会把它提交到当前身份。</p>
            <Button
              onClick={() => {
                onResolved(intent.requestId);
              }}
            >
              清除标记
            </Button>
          </section>
        </Alert>
      </Card>
    );
  }
  return (
    <Card asChild>
      <section className="panel warning" aria-live="polite">
        <h2>存在未确认的原请求</h2>
        <p>
          {intent.operation} · {intent.requestId}
        </p>
        <p className="muted">
          刷新或响应丢失不会自动换用新键；先核对原请求，再决定是否用同一键重试。
        </p>
        <Button onClick={() => void check()} disabled={state === 'CHECKING'}>
          核对原请求
        </Button>
        {state === 'FOUND' && (
          <Button
            onClick={() => {
              onResolved(intent.requestId);
            }}
          >
            收起
          </Button>
        )}
        {message.length > 0 && <p>{message}</p>}
      </section>
    </Card>
  );
}

export function CustodyProjectsPage({ csrfToken, onSessionFailure }: CustodyPageProps) {
  const navigate = useNavigate();
  const { session, error: sessionError } = useSession(onSessionFailure);
  const [projects, setProjects] = useState<readonly CustodyProjectSummary[]>([]);
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
      {sessionError !== null && (
        <Alert asChild variant="warning">
          <p className="error">{sessionError}</p>
        </Alert>
      )}
      {error !== null && (
        <Alert asChild variant="warning">
          <p className="error" role="alert">
            {error}
          </p>
        </Alert>
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
        <Card asChild>
          <section className="panel" aria-labelledby="create-project-title">
            <h2 id="create-project-title">创建项目</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <Label>
                客户名称
                <Input
                  value={customerName}
                  onChange={(event) => {
                    setCustomerName(event.target.value);
                  }}
                  maxLength={256}
                  required
                />
              </Label>
              <Label>
                项目标题
                <Input
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                  }}
                  maxLength={256}
                  required
                />
              </Label>
              <Button variant="default" type="submit" disabled={submitting || session === null}>
                {submitting ? '正在创建…' : '创建项目'}
              </Button>
              <p className="muted">不需要旧模板、预设或七模块前置条件。</p>
            </form>
          </section>
        </Card>
        <Card asChild>
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
                      {project.customerName} · 版本 {project.version}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {nextCursor !== undefined && (
              <Button onClick={() => void load(nextCursor)} disabled={loading}>
                加载更多
              </Button>
            )}
          </section>
        </Card>
      </div>
    </section>
  );
}

function EntryRows({
  projectId,
  batchId,
  entries,
  onDownload,
  onPreview,
}: {
  readonly projectId: string;
  readonly batchId: string;
  readonly entries: readonly CustodyEntry[];
  readonly onDownload: (path: string, name: string) => void;
  readonly onPreview: (sourceId: string) => void;
}) {
  return (
    <Table className="custody-entries" aria-label="资料条目清单">
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>路径</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>大小</TableHead>
          <TableHead>说明</TableHead>
          <TableHead>操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.entryId}>
            <TableCell data-label="序号">{entry.ordinal}</TableCell>
            <TableCell data-label="路径">
              <span title={entry.normalizedPath}>{entry.normalizedPath}</span>
            </TableCell>
            <TableCell data-label="状态">{entryStatusLabel(entry.status)}</TableCell>
            <TableCell data-label="大小">
              {entry.byteLength === undefined ? '—' : bytes(entry.byteLength)}
            </TableCell>
            <TableCell data-label="说明">
              {entry.reasonCodes.length === 0 ? (
                '—'
              ) : (
                <ul className="custody-entry-reasons">
                  {entry.reasonCodes.map((code) => (
                    <li key={code}>
                      <span>{entryReasonText(code)}</span>
                      <small className="mono muted">{code}</small>
                    </li>
                  ))}
                </ul>
              )}
            </TableCell>
            <TableCell data-label="操作">
              {entry.sourceId === undefined ? (
                '无可用来源'
              ) : (
                <div className="custody-source-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    className="custody-preview-button"
                    onClick={() => {
                      if (entry.sourceId !== undefined) onPreview(entry.sourceId);
                    }}
                  >
                    查看内容
                  </Button>
                  <Button
                    className="link"
                    onClick={() => {
                      onDownload(
                        `/bff/mvp/v1/projects/${projectId}/batches/${batchId}/sources/${entry.sourceId}/content`,
                        entry.originalName,
                      );
                    }}
                  >
                    下载
                  </Button>
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function CustodyProjectPage({ csrfToken, onSessionFailure }: CustodyPageProps) {
  const { projectId = '' } = useParams();
  const [parameters, setParameters] = useSearchParams();
  const previewBatch = parameters.get('batch');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [entryPageSize, setEntryPageSize] = useState(20);
  const [entryPageIndex, setEntryPageIndex] = useState(0);
  const entryPages = useRef<readonly CustodyEntryPage[]>([]);
  const paging = useRef(false);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const [batchAttempt, setBatchAttempt] = useState(0);
  const detailGeneration = useRef(0);
  const currentBatch = useRef(previewBatch);
  currentBatch.current = previewBatch;
  const previewManifest = parameters.get('manifest');
  const previewSource = parameters.get('source');
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
      const generation = currentBatch.current === batchId ? ++detailGeneration.current : -1;
      const detail = await getBatch(projectId, batchId);
      const page =
        detail.manifest === null
          ? null
          : await getEntries(
              projectId,
              batchId,
              detail.manifest.manifestId,
              undefined,
              undefined,
              entryPageSize,
            );
      if (generation === detailGeneration.current && currentBatch.current === batchId) {
        setSelected(detail);
        setEntriesPage(page);
        entryPages.current = page === null ? [] : [page];
        setEntryPageIndex(0);
      }
      return detail;
    },
    [projectId, entryPageSize],
  );

  useEffect(() => {
    if (session === null || !previewId(previewBatch)) return;
    let live = true;
    setSelected(null);
    setEntriesPage(null);
    setError(null);
    setBatchLoading(true);
    setPageLoading(false);
    setPageError(null);
    entryPages.current = [];
    paging.current = false;
    setEntryPageIndex(0);
    void refreshDetail(previewBatch)
      .catch((reason: unknown) => {
        if (!live) return;
        if (reason instanceof CustodyFailure && (reason.status === 401 || reason.status === 403))
          onSessionFailure();
        setError(failureText(reason));
      })
      .finally(() => {
        if (live) setBatchLoading(false);
      });
    return () => {
      live = false;
      detailGeneration.current += 1;
    };
  }, [previewBatch, session, refreshDetail, onSessionFailure, batchAttempt]);

  useEffect(() => {
    if (session === null || projectId.length === 0) return;
    let live = true;
    setBusy('加载项目…');
    void Promise.all([getProject(projectId), listBatches(projectId)])
      .then(([loadedProject, page]) => {
        if (!live) return;
        setProject(loadedProject);
        setBatches(page.items);
        setUploadOpen(page.items.length === 0);
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
    if (parameters.has('batch')) return;
    const latest = [...batches].sort((a, b) => b.batchNo - a.batchNo)[0];
    if (latest !== undefined) setParameters({ batch: latest.batchId }, { replace: true });
  }, [batches, parameters, setParameters]);

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
      setParameters({ batch: batch.batchId });
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
    setParameters,
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

  const changeEntryPage = async (page: number) => {
    if (selected === null || entriesPage === null || paging.current) return;
    const count = Math.max(1, Math.ceil(entriesPage.manifest.totalEntries / entryPageSize));
    const index = page - 1;
    if (index < 0 || index >= count || index === entryPageIndex) return;
    const batchId = selected.batch.batchId;
    const manifestId = entriesPage.manifest.manifestId;
    const generation = detailGeneration.current;
    const current = () =>
      currentBatch.current === batchId && detailGeneration.current === generation;
    paging.current = true;
    setPageLoading(true);
    setPageError(null);
    try {
      const pages = [...entryPages.current];
      while (pages.length <= index) {
        const cursor = pages.at(-1)?.next;
        if (cursor === undefined) throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
        const next = await getEntries(
          projectId,
          batchId,
          manifestId,
          cursor,
          undefined,
          entryPageSize,
        );
        if (!current()) return;
        if (
          next.manifest.manifestId !== manifestId ||
          next.manifest.batchId !== batchId ||
          next.manifest.totalEntries !== entriesPage.manifest.totalEntries
        ) {
          throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
        }
        pages.push(next);
        entryPages.current = pages;
      }
      if (!current()) return;
      const next = pages[index];
      if (next === undefined) throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
      setEntriesPage(next);
      setEntryPageIndex(index);
      listHeading.current?.focus({ preventScroll: true });
      listHeading.current?.scrollIntoView({ block: 'start' });
    } catch (reason) {
      if (!current()) return;
      if (reason instanceof CustodyFailure && reason.status === 401) onSessionFailure();
      setPageError(`${failureText(reason)} 当前仍显示第 ${entryPageIndex + 1} 页，请重试翻页。`);
    } finally {
      if (current()) {
        paging.current = false;
        setPageLoading(false);
      }
    }
  };

  const manifest = selected?.manifest ?? null;
  const limited = useMemo(
    () =>
      entriesPage === null
        ? []
        : entriesPage.entries.filter((entry) => entry.status !== 'ACCEPTED'),
    [entriesPage],
  );

  const checkId = parameters.get('check');
  if (previewId(previewBatch) && previewId(checkId)) {
    return (
      <BatchReadCheckPage
        key={`${previewBatch}:${checkId}`}
        projectId={projectId}
        batchId={previewBatch}
        checkId={checkId}
        onSessionFailure={onSessionFailure}
        onDownload={(path, name) => void download(path, name)}
        downloadError={error}
      />
    );
  }
  if (previewId(previewBatch) && previewId(previewManifest) && previewId(previewSource)) {
    return (
      <SourcePreview
        key={`${previewBatch}:${previewManifest}:${previewSource}`}
        identity={{
          projectId,
          batchId: previewBatch,
          manifestId: previewManifest,
          sourceId: previewSource,
        }}
        {...(selected?.batch.batchId === previewBatch ? { batchNo: selected.batch.batchNo } : {})}
        onBack={() => {
          setParameters({ batch: previewBatch });
        }}
        onDownload={(path, name) => void download(path, name)}
        onSessionFailure={onSessionFailure}
        downloadError={error}
      />
    );
  }

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
        <div className="analysis-note custody-analysis-note">
          <strong>分析未接入</strong>
          <span>可核对已接收内容；业务分析尚未开始。</span>
        </div>
      </header>
      {sessionError !== null && (
        <Alert asChild variant="warning">
          <p className="error">{sessionError}</p>
        </Alert>
      )}
      {busy.length > 0 && (
        <p role="status" className="muted">
          {busy}
        </p>
      )}
      {error !== null && (
        <Alert asChild variant="warning">
          <p className="error" role="alert">
            {error}
          </p>
        </Alert>
      )}
      {notice !== null && (
        <Alert asChild variant="warning">
          <p className="notice">{notice}</p>
        </Alert>
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
      <div className="custody-toolbar">
        <div className="custody-batch-picker">
          <Label htmlFor="custody-batch">资料批次</Label>
          <NativeSelect
            id="custody-batch"
            value={previewBatch ?? ''}
            disabled={batches.length === 0}
            onChange={(event) => {
              setParameters({ batch: event.target.value });
            }}
          >
            {batches.length === 0 && <option value="">尚无批次</option>}
            {[...batches]
              .sort((a, b) => b.batchNo - a.batchNo)
              .map((batch) => (
                <option key={batch.batchId} value={batch.batchId}>
                  第 {batch.batchNo} 批 · {batch.originalName} · {statusLabel(batch.status)}
                </option>
              ))}
          </NativeSelect>
        </div>
        <Button
          variant={uploadOpen ? 'outline' : 'default'}
          aria-expanded={uploadOpen}
          aria-controls="custody-upload"
          onClick={() => {
            setUploadOpen(!uploadOpen);
          }}
        >
          {uploadOpen ? '收起上传' : '上传新批次'}
        </Button>
      </div>
      <section
        id="custody-upload"
        className="custody-upload"
        aria-labelledby="new-batch-title"
        hidden={!uploadOpen}
      >
        <h2 id="new-batch-title">新增资料批次</h2>
        <p className="muted">
          ZIP 可包含 DOCX、Markdown 与 XLSX，支持普通文件夹。请先解压并移除包内的 RAR、ZIP、7z
          等压缩文件；发现内层压缩文件时整批拒绝。 补充批次追加在旧清单旁，不覆盖此前批次。
        </p>
        <p className="muted small">
          ZIP 外层文件与目录最多 1000 条；每份 Office 内部最多 1000 条，全包 Office 内部累计最多
          20000 条。其他大小与安全检查仍适用。
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitBatch();
          }}
        >
          <Label>
            选择 ZIP
            <Input
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
            />
          </Label>
          {file !== null && (
            <p className="muted">
              {file.name} · {bytes(file.size)}
              {fileDigest === null ? '' : ` · SHA-256 ${fileDigest.slice(0, 16)}…`}
            </p>
          )}
          <Label>
            说明（可选）
            <Textarea
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              maxLength={4096}
              rows={3}
            />
          </Label>
          <Button
            variant="default"
            type="submit"
            disabled={file === null || fileDigest === null || project === null || busy.length > 0}
          >
            登记并上传
          </Button>
        </form>
      </section>
      {batchLoading && <p role="status">正在加载批次文件…</p>}
      {!batchLoading && selected === null && previewId(previewBatch) && error !== null && (
        <Button
          onClick={() => {
            setBatchAttempt((value) => value + 1);
          }}
        >
          重新加载批次
        </Button>
      )}
      {selected !== null && (
        <Card asChild>
          <section className="panel" aria-labelledby="batch-detail-title">
            <h2 id="batch-detail-title">
              批次 {selected.batch.batchNo} · {statusLabel(selected.batch.status)}
            </h2>
            <p className="custody-batch-name">
              {selected.batch.originalName} · {bytes(selected.batch.declaredBytes)}
            </p>
            {manifest === null &&
              selected.batch.reasonCodes.some(
                (code) => !['ZIP_LIMIT_EXCEEDED', 'NESTED_ARCHIVE_NOT_ALLOWED'].includes(code),
              ) && (
                <p className="warning">
                  本批次尚无可查看的文件清单。请核对下方允许的恢复动作和批次技术详情。
                </p>
              )}
            {selected.batch.reasonCodes.includes('ZIP_LIMIT_EXCEEDED') && (
              <Alert variant="warning" role="region" aria-label="资料包扫描限制">
                <h3>资料包超过扫描限制</h3>
                {selected.limitViolation === undefined ? (
                  <p>此历史批次未记录具体超限项。请以新批次重新上传，使用当前规则检查。</p>
                ) : (
                  <>
                    <p>{limitViolationText(selected.limitViolation)}</p>
                    {selected.limitViolation.documentPath !== undefined && (
                      <p className="mono">文件位置：{selected.limitViolation.documentPath}</p>
                    )}
                    <p>请整理文档或将资料拆分为较小的包，再通过“新增资料批次”重新上传。</p>
                  </>
                )}
                <p className="muted">错误代码：ZIP_LIMIT_EXCEEDED</p>
              </Alert>
            )}
            {selected.batch.reasonCodes.includes('NESTED_ARCHIVE_NOT_ALLOWED') && (
              <Alert variant="warning">
                <h3>请移除内层压缩文件后重新上传</h3>
                <p>
                  资料包包含嵌套压缩文件，已拒绝接纳。请解压需要保留的资料，将文档放入普通文件夹，移除内层压缩文件后重新打包上传。
                </p>
                {selected.rejectedArchivePaths !== undefined && (
                  <ul aria-label="需要移除的压缩文件">
                    {selected.rejectedArchivePaths.map((path) => (
                      <li key={path} style={{ overflowWrap: 'anywhere' }}>
                        {path}
                      </li>
                    ))}
                  </ul>
                )}
                <p>整理后的 ZIP 请通过“新增资料批次”上传，本次拒绝记录会保留。</p>
              </Alert>
            )}
            {['mvp.zip-input@1', 'mvp.zip-input@2', 'mvp.zip-input@3'].includes(
              selected.batch.policyVersion ?? '',
            ) &&
              selected.permittedActions.length > 0 && (
                <p className="warning">
                  此批次使用旧版资料检查规则，不能继续上传或提取。请按允许的动作核对原尝试是否结束，再放弃该批次，整理资料后重新上传。
                </p>
              )}
            {manifest !== null && (
              <>
                <p>
                  已封存清单：共 {manifest.totalEntries} 项，已接收来源 {manifest.acceptedEntries}{' '}
                  项， 受限/不支持 {manifest.limitedEntries} 项。
                </p>
                <p className="muted">条目数包含系统附属文件；已接收不代表全文已读取或分析完成。</p>
                {manifest.acceptedEntries === 0 && (
                  <p className="warning">该资料包没有已接收的文档来源，请先核对并处理受限条目。</p>
                )}
                <div className="read-check-actions">
                  <ReadCheckLaunch
                    key={selected.batch.batchId}
                    projectId={projectId}
                    batchId={selected.batch.batchId}
                    manifestId={manifest.manifestId}
                    csrfToken={csrfToken}
                    onSessionFailure={onSessionFailure}
                  />
                  <Button
                    className="link"
                    onClick={() =>
                      void download(
                        `/bff/mvp/v1/projects/${projectId}/batches/${selected.batch.batchId}/sources/${manifest.originalZip.sourceId}/content`,
                        'original.zip',
                      )
                    }
                  >
                    下载原包
                  </Button>
                </div>
              </>
            )}
            {selected.permittedActions.length > 0 && (
              <div className="custody-actions">
                <h3>允许的恢复动作</h3>
                <p className="muted">
                  动作来自服务器当前状态，提交时会重新校验原尝试与写者是否已结束。
                </p>
                {selected.permittedActions.map((action) => (
                  <Button
                    key={action}
                    className={action === 'ABANDON' ? 'button danger' : 'button'}
                    onClick={() => void runRecovery(selected.batch, action)}
                    disabled={busy.length > 0}
                  >
                    {actionLabel(action)}
                  </Button>
                ))}
              </div>
            )}
            {entriesPage !== null && (
              <>
                <div className="custody-list-heading">
                  <h3 ref={listHeading} tabIndex={-1}>
                    条目清单
                  </h3>
                  <span className="muted" role="status">
                    第 {entriesPage.entries.length === 0 ? 0 : entryPageIndex * entryPageSize + 1}–
                    {entryPageIndex * entryPageSize + entriesPage.entries.length} 项，共{' '}
                    {entriesPage.manifest.totalEntries} 项
                  </span>
                </div>
                <p className="muted">点击“查看内容”核对已接收文档，或下载原件对照。</p>
                {limited.length > 0 && (
                  <p className="muted">受限/不支持条目仍保留在清单中，请查看各条目的说明。</p>
                )}
                <EntryRows
                  projectId={projectId}
                  batchId={selected.batch.batchId}
                  entries={entriesPage.entries}
                  onDownload={(path, name) => void download(path, name)}
                  onPreview={(sourceId) => {
                    detailGeneration.current += 1;
                    paging.current = false;
                    setPageLoading(false);
                    setPageError(null);
                    setParameters({
                      batch: selected.batch.batchId,
                      manifest: entriesPage.manifest.manifestId,
                      source: sourceId,
                    });
                  }}
                />
                {pageError !== null && (
                  <Alert variant="warning">
                    <p role="alert">{pageError}</p>
                  </Alert>
                )}
                {pageLoading && (
                  <p role="status" className="muted">
                    正在加载分页…
                  </p>
                )}
                <EntryPagination
                  page={entryPageIndex + 1}
                  pageCount={Math.max(
                    1,
                    Math.ceil(entriesPage.manifest.totalEntries / entryPageSize),
                  )}
                  pageSize={entryPageSize}
                  loading={pageLoading}
                  onPage={(page) => {
                    void changeEntryPage(page);
                  }}
                  onPageSize={setEntryPageSize}
                />
              </>
            )}
            <details key={selected.batch.batchId} className="custody-technical">
              <summary>批次技术详情</summary>
              {selected.batch.reasonCodes.length > 0 && (
                <p className="mono">批次原因码：{selected.batch.reasonCodes.join('、')}</p>
              )}
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
              {manifest !== null && <p className="mono small">清单摘要：{manifest.manifestHash}</p>}
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
            </details>
          </section>
        </Card>
      )}
    </section>
  );
}
