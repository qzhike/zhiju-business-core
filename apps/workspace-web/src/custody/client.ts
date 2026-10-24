import {
  digest,
  parseBatch,
  parseBatchDetail,
  parseBatchList,
  parseEntryPage,
  parseProject,
  parseProjectList,
  parseRequestView,
  parseSession,
  type CustodyBatch,
  type CustodyBatchDetail,
  type CustodyEntryPage,
  type CustodyPage,
  type CustodyProject,
  type CustodyProjectSummary,
  type CustodyRequestView,
  type CustodySession,
  type RecoveryAction,
} from './model.js';
import { asNonEmptyString, asRecord } from '../trusted/values.js';

const BASE = '/bff/mvp/v1';

export class CustodyFailure extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(code: string, status: number, retryable: boolean) {
    super(code);
    this.name = 'CustodyFailure';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function pathFor(suffix: string): string {
  return `${BASE}${suffix}`;
}

async function readEnvelope(response: Response): Promise<{ data: unknown; receipt?: unknown }> {
  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch {
    throw new CustodyFailure('UI_CLIENT_STATE_INVALID', response.status, false);
  }
  const record = asRecord(body);
  if (record === null) throw new CustodyFailure('UI_CLIENT_STATE_INVALID', response.status, false);
  if (record.ok === true) {
    return {
      data: record.data,
      ...(record.receipt === undefined ? {} : { receipt: record.receipt }),
    };
  }
  const error = asRecord(record.error);
  const code = error === null ? null : asNonEmptyString(error.code);
  const retryable = error === null ? false : error.retryable === true;
  throw new CustodyFailure(code ?? 'UI_CLIENT_STATE_INVALID', response.status, retryable);
}

async function request(
  path: string,
  init: RequestInit,
): Promise<{ data: unknown; receipt?: unknown }> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
    });
  } catch {
    throw new CustodyFailure('UI_NETWORK_UNAVAILABLE', 0, true);
  }
  return readEnvelope(response);
}

export async function readSession(signal?: AbortSignal): Promise<CustodySession> {
  const result = await request(pathFor('/session'), {
    method: 'GET',
    ...(signal === undefined ? {} : { signal }),
  });
  const session = parseSession(result.data);
  if (session === null) throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
  return session;
}

export async function listProjects(
  cursor?: string,
  signal?: AbortSignal,
): Promise<CustodyPage<CustodyProjectSummary>> {
  const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
  const result = await request(pathFor(`/projects${query}`), {
    method: 'GET',
    ...(signal === undefined ? {} : { signal }),
  });
  const page = parseProjectList(result.data);
  if (page === null) throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
  return page;
}

export async function getProject(projectId: string, signal?: AbortSignal): Promise<CustodyProject> {
  const result = await request(pathFor(`/projects/${encodeURIComponent(projectId)}`), {
    method: 'GET',
    ...(signal === undefined ? {} : { signal }),
  });
  const project = parseProject(asRecord(result.data)?.project);
  if (project === null) throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
  return project;
}

export async function createProject(input: {
  projectId: string;
  requestId: string;
  customerName: string;
  title: string;
  csrfToken: string;
}): Promise<CustodyProject> {
  const result = await request(pathFor(`/projects/${encodeURIComponent(input.projectId)}`), {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': input.csrfToken,
      'idempotency-key': input.requestId,
    },
    body: JSON.stringify({ customerName: input.customerName, title: input.title }),
  });
  const project = parseProject(asRecord(result.data)?.project);
  if (project === null) throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
  return project;
}

export async function listBatches(
  projectId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<CustodyPage<CustodyBatch>> {
  const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`;
  const result = await request(
    pathFor(`/projects/${encodeURIComponent(projectId)}/batches${query}`),
    { method: 'GET', ...(signal === undefined ? {} : { signal }) },
  );
  const page = parseBatchList(result.data);
  if (page === null) throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
  return page;
}

export async function createBatch(input: {
  projectId: string;
  batchId: string;
  requestId: string;
  expectedProjectVersion: number;
  originalName: string;
  declaredBytes: number;
  zipSha256: string;
  note?: string;
  csrfToken: string;
}): Promise<CustodyBatch> {
  const result = await request(
    pathFor(
      `/projects/${encodeURIComponent(input.projectId)}/batches/${encodeURIComponent(input.batchId)}`,
    ),
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': input.csrfToken,
        'idempotency-key': input.requestId,
      },
      body: JSON.stringify({
        expectedProjectVersion: input.expectedProjectVersion,
        originalName: input.originalName,
        declaredBytes: input.declaredBytes,
        zipSha256: input.zipSha256,
        ...(input.note === undefined ? {} : { note: input.note }),
      }),
    },
  );
  const batch = parseBatch(asRecord(result.data)?.batch);
  if (batch === null) throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
  return batch;
}

export async function getBatch(
  projectId: string,
  batchId: string,
  signal?: AbortSignal,
): Promise<CustodyBatchDetail> {
  const result = await request(
    pathFor(`/projects/${encodeURIComponent(projectId)}/batches/${encodeURIComponent(batchId)}`),
    { method: 'GET', ...(signal === undefined ? {} : { signal }) },
  );
  const detail = parseBatchDetail(result.data);
  if (detail === null) throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
  return detail;
}

export async function getEntries(
  projectId: string,
  batchId: string,
  manifestId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<CustodyEntryPage> {
  const query = new URLSearchParams({ manifestId });
  if (cursor !== undefined) query.set('cursor', cursor);
  const result = await request(
    pathFor(
      `/projects/${encodeURIComponent(projectId)}/batches/${encodeURIComponent(batchId)}/entries?${query.toString()}`,
    ),
    { method: 'GET', ...(signal === undefined ? {} : { signal }) },
  );
  const page = parseEntryPage(result.data);
  if (page === null) throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
  return page;
}

export async function getRequest(
  requestId: string,
  signal?: AbortSignal,
): Promise<CustodyRequestView> {
  const result = await request(pathFor(`/requests/${encodeURIComponent(requestId)}`), {
    method: 'GET',
    ...(signal === undefined ? {} : { signal }),
  });
  const view = parseRequestView(result.data);
  if (view === null) throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
  return view;
}

export async function recover(input: {
  projectId: string;
  batchId: string;
  requestId: string;
  expectedBatchVersion: number;
  action: RecoveryAction;
  csrfToken: string;
}): Promise<CustodyBatch> {
  const result = await request(
    pathFor(
      `/projects/${encodeURIComponent(input.projectId)}/batches/${encodeURIComponent(input.batchId)}/recovery`,
    ),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': input.csrfToken,
        'idempotency-key': input.requestId,
      },
      body: JSON.stringify({
        expectedBatchVersion: input.expectedBatchVersion,
        action: input.action,
      }),
    },
  );
  const batch = parseBatch(asRecord(result.data)?.batch);
  if (batch === null) throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
  return batch;
}

export async function uploadZip(input: {
  projectId: string;
  batchId: string;
  attemptId: string;
  generation: number;
  file: File;
  csrfToken: string;
  signal?: AbortSignal;
}): Promise<CustodyBatch> {
  const result = await request(
    pathFor(
      `/projects/${encodeURIComponent(input.projectId)}/batches/${encodeURIComponent(input.batchId)}/zip`,
    ),
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/zip',
        'x-csrf-token': input.csrfToken,
        'x-mvp-upload-attempt': input.attemptId,
        'x-mvp-upload-generation': String(input.generation),
      },
      body: input.file,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    },
  );
  const batch = parseBatch(asRecord(result.data)?.batch);
  if (batch === null) throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
  return batch;
}

/** Reads one accepted source and verifies its declared length and SHA-256 before saving. */
export async function downloadSource(path: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/octet-stream' },
    });
  } catch {
    throw new CustodyFailure('UI_NETWORK_UNAVAILABLE', 0, true);
  }
  if (!response.ok) throw new CustodyFailure('UI_DOWNLOAD_FAILED', response.status, true);
  const length = response.headers.get('content-length');
  const checksum = response.headers.get('content-sha256');
  const blob = await response.blob();
  if (
    length === null ||
    !/^[0-9]+$/u.test(length) ||
    checksum === null ||
    !/^[0-9a-f]{64}$/u.test(checksum) ||
    blob.size !== Number(length) ||
    (await digest(await blob.arrayBuffer())) !== checksum
  )
    throw new CustodyFailure('STORAGE_INTEGRITY_ERROR', 200, true);
  return blob;
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
