import { asRecord } from '../trusted/values.js';
import { CustodyFailure, request } from './client.js';
import { parseCheck, parseCheckPage, type CheckFilter } from './read-check-model.js';

const path = (projectId: string, batchId: string) =>
  `/bff/mvp/v1/projects/${encodeURIComponent(projectId)}/batches/${encodeURIComponent(batchId)}/read-checks`;
function invalid(): never {
  throw new CustodyFailure('UI_CLIENT_STATE_INVALID', 200, false);
}
export async function createReadCheck(
  projectId: string,
  batchId: string,
  manifestId: string,
  requestId: string,
  csrfToken: string,
) {
  const response = await request(path(projectId, batchId), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': requestId,
      'x-csrf-token': csrfToken,
    },
    body: JSON.stringify({ manifestId }),
  });
  return parseCheck(asRecord(response.data)?.check, projectId, batchId) ?? invalid();
}
export async function listReadChecks(
  projectId: string,
  batchId: string,
  cursor?: string,
  signal?: AbortSignal,
) {
  const response = await request(
    path(projectId, batchId) +
      (cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`),
    { method: 'GET', ...(signal === undefined ? {} : { signal }) },
  );
  const value = asRecord(response.data);
  if (
    value === null ||
    !Array.isArray(value.items) ||
    value.items.length > 50 ||
    (value.nextCursor !== undefined &&
      (typeof value.nextCursor !== 'string' || value.nextCursor.length > 4096))
  )
    return invalid();
  const items = value.items.map((v) => parseCheck(v, projectId, batchId));
  if (items.some((v) => v === null)) return invalid();
  return {
    items: items.filter((v) => v !== null),
    ...(typeof value.nextCursor === 'string' ? { next: value.nextCursor } : {}),
  };
}
export async function getReadCheck(
  projectId: string,
  batchId: string,
  checkId: string,
  signal?: AbortSignal,
) {
  const response = await request(`${path(projectId, batchId)}/${encodeURIComponent(checkId)}`, {
    method: 'GET',
    ...(signal === undefined ? {} : { signal }),
  });
  return parseCheck(asRecord(response.data)?.check, projectId, batchId, checkId) ?? invalid();
}
export async function getReadCheckEntries(
  projectId: string,
  batchId: string,
  checkId: string,
  filter: CheckFilter,
  limit: number,
  cursor?: string,
  resultVersion?: number,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ filter, limit: String(limit) });
  if (cursor !== undefined) query.set('cursor', cursor);
  if (resultVersion !== undefined) query.set('resultVersion', String(resultVersion));
  const response = await request(
    `${path(projectId, batchId)}/${encodeURIComponent(checkId)}/entries?${query}`,
    { method: 'GET', ...(signal === undefined ? {} : { signal }) },
  );
  return parseCheckPage(response.data, projectId, batchId, checkId, filter) ?? invalid();
}
