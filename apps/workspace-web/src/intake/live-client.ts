import { BffFailure } from '../trusted/protocol.js';
import { readApiFailure } from '../trusted/errors.js';
import { isUuidV7, uuidV7 } from '../trusted/identity.js';
import { asRecord, type JsonRecord } from '../trusted/values.js';

const encoder = new TextEncoder();
function compareUtf8(left: string, right: string): number {
  const a = encoder.encode(left),
    b = encoder.encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
}

/** Browser counterpart of cv1. It hashes a projection without rewriting it. */
export function canonicalPreparationJson(value: unknown): string {
  function normalize(input: unknown): unknown {
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'string') return input.normalize('NFC');
    if (typeof input === 'number') {
      if (!Number.isSafeInteger(input)) throw new Error('UI_CLIENT_STATE_INVALID');
      return Object.is(input, -0) ? 0 : input;
    }
    if (Array.isArray(input)) return input.map(normalize);
    const object = asRecord(input);
    if (!object) throw new Error('UI_CLIENT_STATE_INVALID');
    const entries = Object.entries(object).map(
      ([key, item]) => [key.normalize('NFC'), normalize(item)] as const,
    );
    if (new Set(entries.map(([key]) => key)).size !== entries.length)
      throw new Error('UI_CLIENT_STATE_INVALID');
    return Object.fromEntries(entries.sort(([a], [b]) => compareUtf8(a, b)));
  }
  return JSON.stringify(normalize(value));
}
export async function bytesSha256(bytes: BufferSource): Promise<JsonRecord> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return {
    algorithm: 'SHA-256',
    canonicalizationVersion: '1',
    digest: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    ),
  };
}
export const objectRef = (objectType: string, objectId: string, scope: JsonRecord): JsonRecord => ({
  kind: 'OBJECT',
  objectType,
  objectId,
  scope,
});

export async function preparationCommand(
  operation: string,
  targetRef: JsonRecord,
  payload: JsonRecord,
  version?: number,
): Promise<JsonRecord> {
  const scope = asRecord(targetRef.scope);
  if (!scope || !isUuidV7(String(targetRef.objectId))) throw new Error('UI_CLIENT_STATE_INVALID');
  return {
    commandId: uuidV7(),
    type: operation,
    version: '1.0',
    scopeRef: scope,
    targetRef,
    idempotencyKey: `${operation}:1.0:${String(targetRef.objectId)}${version === undefined ? '' : ':2'}`,
    correlationId: uuidV7(),
    requestedAt: new Date().toISOString(),
    payload,
    integrity: {
      canonicalizationVersion: '1',
      payloadHash: await bytesSha256(encoder.encode(canonicalPreparationJson(payload))),
    },
    ...(version === undefined ? {} : { expectedAggregateVersion: version }),
  };
}

export async function postPreparationCommand(
  command: JsonRecord,
  csrfToken: string,
  signal: AbortSignal,
): Promise<JsonRecord> {
  const response = await fetch(`/bff/commands/${String(command.type)}/1.0`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers: {
      'content-type': 'application/json',
      'x-csrf-token': csrfToken,
      accept: 'application/json',
    },
    body: JSON.stringify(command),
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  const body: unknown = await response.json();
  const record = asRecord(body);
  if (
    !response.ok ||
    !record ||
    !['COMMITTED', 'DUPLICATE'].includes(String(record.status)) ||
    record.commandId !== command.commandId
  )
    throw new BffFailure(readApiFailure(response.status, body));
  const data = asRecord(record.data);
  if (!data) throw new Error('UI_CLIENT_STATE_INVALID');
  return data;
}

export async function uploadPreparationZip(
  file: File,
  upload: JsonRecord,
  csrfToken: string,
  signal: AbortSignal,
): Promise<void> {
  const path = String(upload.path);
  const token = String(upload.token);
  if (
    !/^\/api\/customer-intakes\/[0-9a-f-]{36}\/zip$/.test(path) ||
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    upload.method !== 'PUT' ||
    upload.expectedByteLength !== file.size
  )
    throw new Error('UI_CLIENT_STATE_INVALID');
  const digest = await bytesSha256(await file.arrayBuffer());
  const expected = asRecord(upload.expectedZipBytesSha256);
  if (digest.digest !== (expected?.digest ?? upload.expectedZipBytesSha256))
    throw new Error('UI_ZIP_BYTES_MISMATCH');
  const response = await fetch(path.replace(/^\/api\//, '/bff/'), {
    method: 'PUT',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers: {
      'content-type': 'application/zip',
      'x-csrf-token': csrfToken,
      'x-intake-upload-token': token,
    },
    body: file,
    signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
  });
  if (!response.ok) throw new BffFailure(readApiFailure(response.status, await response.json()));
  await response.arrayBuffer();
}

export function preparationHref(requestId: string, scope: JsonRecord): string {
  if (
    !isUuidV7(requestId) ||
    !isUuidV7(String(scope.enterpriseId)) ||
    !isUuidV7(String(scope.projectId))
  )
    throw new Error('UI_CLIENT_STATE_INVALID');
  return `/preparations/${requestId}?enterprise=${String(scope.enterpriseId)}&project=${String(scope.projectId)}`;
}
