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
  const [downloadStatus, setDownloadStatus] = useState('');
  const [busy, setBusy] = useState(false);
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
    acceptsResponse(props.guardRef.current, tag) && !controller.current?.signal.aborted;
  function fail(cause: unknown) {
    if (!accepts()) return;
    const failure = failureFromUnknown(cause, 'UI_CLIENT_STATE_INVALID');
    setLoaded(null);
    setError('当前无法读取此精确版本，请确认链接与当前权限。');
    if ([401, 403, 404].includes(failure.httpStatus)) {
      props.onSessionFailure();
    }
  }
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const untrack = props.readBoundary.track(abort);
    setLoaded(null);
    setError('');
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
  ]);
  async function more() {
    if (!link || !loaded?.changes.nextCursor || !controller.current) return;
    setBusy(true);
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
      fail(cause);
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
        setDownloadStatus('当前无法下载；请重试以重新核验权限。');
        const failure = failureFromUnknown(cause, 'DOWNLOAD_UNAVAILABLE');
        if ([401, 403, 404].includes(failure.httpStatus)) fail(cause);
      }
    }
  }
  const visible = acceptsResponse(props.guardRef.current, tag) ? loaded : null;
  if (error)
    return (
      <section className="panel" role="alert">
        <h1>文件检查</h1>
        <p>{error}</p>
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
      hasRepresentation={Boolean(link.representationRef)}
      busy={busy}
      downloadStatus={downloadStatus}
      onDownload={download}
      onMore={more}
    />
  );
}

function changePayload(link: ReviewLink, cursor?: string): JsonRecord {
  return {
    toRevisionRef: link.revisionRef,
    baselineKind: link.baselineKind,
    ...(link.fromRevisionRef ? { fromRevisionRef: link.fromRevisionRef } : {}),
    filter: {},
    page: { limit: 100, ...(cursor ? { cursor } : {}) },
  };
}
