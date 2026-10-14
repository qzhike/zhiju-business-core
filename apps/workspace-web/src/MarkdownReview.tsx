import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownReviewPage, type MarkdownReviewData } from './MarkdownReviewPage.js';
import { useLocation, useParams } from 'react-router';
import { acceptsResponse, type LiveGuard, type ReadBoundary } from './trusted/guard.js';
import { failureFromUnknown, readExactQuery } from './trusted/client.js';
import {
  parseChanges,
  parseReviewContent,
  parseReviewLink,
  sameRevision,
  type Representation,
  type ReviewLink,
} from './trusted/markdown.js';
import type { JsonRecord } from './trusted/values.js';
import { BffFailure } from './trusted/protocol.js';
import { readApiFailure } from './trusted/errors.js';

interface Props {
  sessionGeneration: string;
  principalId: string;
  csrfToken: string;
  generation: number;
  guardRef: { current: LiveGuard };
  readBoundary: ReadBoundary;
  scopeKey: string;
  onSessionFailure: () => void;
}

export function MarkdownReview(props: Props) {
  const { projectId = '', artifactId = '', revisionId = '' } = useParams();
  const route = useLocation();
  const [loaded, setLoaded] = useState<MarkdownReviewData | null>(null);
  const [error, setError] = useState('');
  const [sessionRequired, setSessionRequired] = useState(false);
  const [readAttempt, setReadAttempt] = useState(0);
  const currentAttempt = useRef(readAttempt);
  currentAttempt.current = readAttempt;
  const [downloadStatus, setDownloadStatus] = useState('');
  const [directoryStatus, setDirectoryStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const controller = useRef<AbortController | null>(null);
  const objectUrls = useRef(new Set<string>());
  const tag = useMemo(
    () => ({
      generation: props.generation,
      principalId: props.principalId,
      scopeKey: props.scopeKey,
    }),
    [props.generation, props.principalId, props.scopeKey],
  );
  const link = useMemo(() => {
    try {
      return parseReviewLink(route.search, artifactId, revisionId, projectId);
    } catch {
      return null;
    }
  }, [route.search, artifactId, revisionId, projectId]);
  const accepts = () =>
    acceptsResponse(props.guardRef.current, tag) &&
    currentAttempt.current === readAttempt &&
    !controller.current?.signal.aborted;
  function fail(cause: unknown) {
    if (!accepts()) return;
    const failure = failureFromUnknown(cause, 'UI_CLIENT_STATE_INVALID');
    setLoaded(null);
    // Losing read permission clears the comparison page and this opinion area.
    setNote('');
    setSessionRequired(failure.httpStatus === 401);
    setError(
      failure.httpStatus === 401
        ? '当前会话无法读取此文件，请重新检查会话。'
        : '当前无法读取此精确版本或基线，请确认链接与当前权限。',
    );
    setDirectoryStatus('');
    setDownloadStatus('');
    setBusy(false);
    controller.current?.abort();
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
  }
  async function retainedReadPermission(): Promise<
    { state: 'ALLOWED' } | { state: 'DENIED'; cause: unknown } | { state: 'UNKNOWN' }
  > {
    const currentLink = link;
    const currentController = controller.current;
    if (!currentLink || !currentController || currentController.signal.aborted)
      return { state: 'UNKNOWN' };
    let unknown = false;
    const revisions = [
      currentLink.revisionRef,
      ...(currentLink.fromRevisionRef ? [currentLink.fromRevisionRef] : []),
    ];
    for (const revisionRef of revisions) {
      try {
        parseReviewContent(
          await readExactQuery(
            'artifact.get_file_review_content',
            revisionRef.scope,
            { revisionRef },
            props.csrfToken,
            currentController.signal,
          ),
          currentLink,
          revisionRef,
        );
      } catch (cause) {
        if (!accepts()) return { state: 'UNKNOWN' };
        const failure = failureFromUnknown(cause, 'UI_CLIENT_STATE_INVALID');
        if ([401, 403, 404].includes(failure.httpStatus)) return { state: 'DENIED', cause };
        unknown = true;
      }
      if (!accepts()) return { state: 'UNKNOWN' };
    }
    return unknown ? { state: 'UNKNOWN' } : { state: 'ALLOWED' };
  }
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const untrack = props.readBoundary.track(abort);
    setLoaded(null);
    setError('');
    setSessionRequired(false);
    setDirectoryStatus('');
    setDownloadStatus('');
    if (!link) {
      setError('文件链接不完整或版本绑定无效。');
      return () => {
        abort.abort();
        untrack();
      };
    }
    const currentLink = link;
    async function load() {
      const content = parseReviewContent(
        await readExactQuery(
          'artifact.get_file_review_content',
          currentLink.revisionRef.scope,
          { revisionRef: currentLink.revisionRef },
          props.csrfToken,
          abort.signal,
        ),
        currentLink,
      );
      const before = currentLink.fromRevisionRef
        ? parseReviewContent(
            await readExactQuery(
              'artifact.get_file_review_content',
              currentLink.fromRevisionRef.scope,
              { revisionRef: currentLink.fromRevisionRef },
              props.csrfToken,
              abort.signal,
            ),
            currentLink,
            currentLink.fromRevisionRef,
          )
        : undefined;
      const changes = parseChanges(
        await readExactQuery(
          'artifact.get_file_change_directory',
          currentLink.revisionRef.scope,
          changePayload(currentLink),
          props.csrfToken,
          abort.signal,
        ),
        currentLink,
      );
      if (!abort.signal.aborted && acceptsResponse(props.guardRef.current, tag))
        setLoaded({ content, ...(before ? { before } : {}), changes });
    }
    void load().catch((cause: unknown) => {
      if (!abort.signal.aborted) fail(cause);
    });
    const urls = objectUrls.current;
    return () => {
      abort.abort();
      untrack();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
    // The exact route/session key remounts this view; navigation never swaps its version in place.
  }, [
    link,
    props.sessionGeneration,
    props.principalId,
    props.generation,
    props.readBoundary,
    props.csrfToken,
    tag,
    readAttempt,
  ]);
  async function more() {
    if (!link || !loaded?.changes.nextCursor || !controller.current) return;
    setBusy(true);
    setDirectoryStatus('');
    try {
      const page = parseChanges(
        await readExactQuery(
          'artifact.get_file_change_directory',
          link.revisionRef.scope,
          changePayload(link, loaded.changes.nextCursor),
          props.csrfToken,
          controller.current.signal,
        ),
        link,
      );
      if (!accepts()) return;
      if (
        page.diffHash.digest !== loaded.changes.diffHash.digest ||
        page.totalChanges !== loaded.changes.totalChanges ||
        page.entries.some((entry) =>
          loaded.changes.entries.some((old) => old.changeId.digest === entry.changeId.digest),
        )
      )
        throw new Error('Directory changed');
      setLoaded({
        ...loaded,
        changes: { ...page, entries: [...loaded.changes.entries, ...page.entries] },
      });
    } catch (cause) {
      if (!accepts()) return;
      const failure = failureFromUnknown(cause, 'UI_CLIENT_STATE_INVALID');
      if ([401, 403, 404].includes(failure.httpStatus)) {
        const permission = await retainedReadPermission();
        if (!accepts()) return;
        if (permission.state === 'DENIED') {
          fail(permission.cause);
          return;
        }
        setDirectoryStatus(
          permission.state === 'ALLOWED'
            ? '更多变化暂不可用；当前文件和意见草稿已保留，请重试。'
            : '更多变化暂不可用；无法确认当前读取权限，已保留文件和意见草稿，请重试。',
        );
      } else {
        setDirectoryStatus('更多变化暂不可用；当前文件和意见草稿已保留，请重试。');
      }
    } finally {
      if (accepts()) setBusy(false);
    }
  }
  async function download() {
    if (!link?.representationRef || !controller.current) return;
    setDownloadStatus('正在核验下载权限与文件完整性…');
    try {
      const result = (await readExactQuery(
        'artifact.get_markdown_download',
        link.revisionRef.scope,
        { representationRef: link.representationRef },
        props.csrfToken,
        controller.current.signal,
      )) as {
        representationRef: Representation;
        revisionRef: ReviewLink['revisionRef'];
        downloadTicket: string;
        checksum: { digest: string };
        byteLength: number;
        safeFilename: string;
      };
      if (!accepts()) return;
      if (
        !sameRevision(result.revisionRef, link.revisionRef) ||
        result.representationRef.representationId !== link.representationRef.representationId ||
        result.checksum.digest !== link.representationRef.checksum.digest ||
        !/^[A-Za-z0-9_-]+\.md$/.test(result.safeFilename) ||
        !Number.isSafeInteger(result.byteLength) ||
        result.byteLength > 10_485_760 ||
        result.byteLength < 1
      )
        throw new Error('Download binding mismatch');
      const response = await fetch(
        `/api/markdown-representations/${result.representationRef.representationId}/content`,
        {
          headers: {
            'x-markdown-download-ticket': result.downloadTicket,
            'x-csrf-token': props.csrfToken,
          },
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: AbortSignal.any([controller.current.signal, AbortSignal.timeout(60_000)]),
        },
      );
      if (!response.ok) throw new BffFailure(readApiFailure(response.status, null));
      if (!response.body || response.headers.get('content-type') !== 'text/markdown; charset=utf-8')
        throw new Error('Download unavailable');
      const reader = response.body.getReader();
      const pieces: Uint8Array<ArrayBuffer>[] = [];
      let length = 0;
      try {
        for (;;) {
          const item = await reader.read();
          if (item.done) break;
          length += item.value.length;
          if (length > result.byteLength || !accepts()) throw new Error('Download interrupted');
          pieces.push(new Uint8Array(item.value));
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const blob = new Blob(pieces, { type: 'text/markdown; charset=utf-8' });
      const checksum = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
        (b) => b.toString(16).padStart(2, '0'),
      ).join('');
      if (!accepts()) return;
      if (length !== result.byteLength || checksum !== result.checksum.digest)
        throw new Error('Download integrity mismatch');
      const url = URL.createObjectURL(blob);
      objectUrls.current.add(url);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.safeFilename;
      anchor.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        objectUrls.current.delete(url);
      }, 1000);
      setDownloadStatus('下载响应已完整接收；请在浏览器中确认保存。');
    } catch (cause) {
      if (accepts()) {
        const failure = failureFromUnknown(cause, 'DOWNLOAD_UNAVAILABLE');
        if ([401, 403, 404].includes(failure.httpStatus)) {
          const permission = await retainedReadPermission();
          if (!accepts()) return;
          if (permission.state === 'DENIED') {
            fail(permission.cause);
            return;
          }
          setDownloadStatus(
            permission.state === 'ALLOWED'
              ? '下载暂不可用；当前正文和意见草稿已保留，精确版本仍可读取。请重试下载。'
              : '下载暂不可用；无法确认当前读取权限，已保留正文和意见草稿。请重试。',
          );
        } else {
          setDownloadStatus('下载暂不可用；当前正文和意见草稿已保留。请重试下载。');
        }
      }
    }
  }
  const visible = acceptsResponse(props.guardRef.current, tag) ? loaded : null;
  if (error)
    return (
      <section className="panel" role="alert">
        <h1>文件检查</h1>
        <p>{error}</p>
        {sessionRequired ? (
          <button onClick={props.onSessionFailure}>重新检查会话</button>
        ) : (
          <button
            onClick={() => {
              setReadAttempt((attempt) => attempt + 1);
            }}
          >
            重新读取文件
          </button>
        )}
      </section>
    );
  if (!visible || !link)
    return (
      <section className="panel" aria-busy="true">
        <h1>文件检查</h1>
        <p>正在读取已封存的精确版本…</p>
      </section>
    );
  return (
    <MarkdownReviewPage
      data={visible}
      busy={busy}
      directoryStatus={directoryStatus}
      onMore={more}
      workspace={{
        directoryNote: '跨文件成果目录读取尚未接入；本页只显示此精确版本。',
      }}
      download={{
        hasRepresentation: Boolean(link.representationRef),
        status: downloadStatus,
        note: '此链接未提供已登记表示，下载不可用',
        onDownload: download,
      }}
      opinion={{
        context: `${visible.content.document.title} · 版本 ${visible.content.revisionRef.objectId.slice(-8)}`,
        draft: {
          text: note,
          state: 'UNAVAILABLE',
          note: note ? '仅在当前页面，尚未保存' : '尚未输入意见',
        },
        approval: {
          available: false,
          note: '批准能力尚未接入；阅读与下载都不表示批准。',
        },
        unavailable: [
          '服务器个人草稿、提交并修改与回执查询尚未接入；本页意见请在离开前自行保留。',
          'Markdown 改稿复核与批准尚未接入。',
        ],
      }}
      opinionActions={{
        onDraftChange: (text) => {
          setNote(text);
        },
      }}
    />
  );
}

function changePayload(link: ReviewLink, cursor?: string): JsonRecord {
  return {
    toRevisionRef: link.revisionRef,
    baselineKind: link.baselineKind,
    ...(link.fromRevisionRef ? { fromRevisionRef: link.fromRevisionRef } : {}),
    filter: {},
    page: { limit: 10, ...(cursor ? { cursor } : {}) },
  };
}
