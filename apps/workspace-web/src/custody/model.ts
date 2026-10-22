import { asArray, asNonEmptyString, asNumber, asRecord } from '../trusted/values.js';

export type BatchStatus =
  | 'AWAITING_UPLOAD'
  | 'RECEIVING'
  | 'STAGED'
  | 'EXTRACTING'
  | 'RECEIVED'
  | 'PARTIAL'
  | 'FAILED'
  | 'REJECTED'
  | 'ABANDONED'
  | 'UNKNOWN';

export type EntryStatus = 'ACCEPTED' | 'UNSUPPORTED' | 'CORRUPT' | 'READ_LIMITED';
export type RecoveryAction = 'RECONCILE' | 'RETRY_UPLOAD' | 'CONTINUE_EXTRACTION' | 'ABANDON';
export type AttemptKind = 'UPLOAD' | 'EXTRACT';

export interface CustodySession {
  readonly ownerId: string;
  readonly displayName: string;
  readonly authEpoch: number;
  readonly instanceId: string;
}

export interface CustodyProject {
  readonly projectId: string;
  readonly customerName: string;
  readonly title: string;
  readonly createdAt: string;
  readonly version: number;
  readonly lastBatchNo: number;
  readonly activeBatchId: string | null;
}

export interface CustodyAttempt {
  readonly attemptId: string;
  readonly kind: AttemptKind;
  readonly number: number;
  readonly generation: number;
  readonly status: string;
  readonly startedAt: string;
  readonly endedAt?: string;
}

export interface CustodyBatch {
  readonly batchId: string;
  readonly projectId: string;
  readonly batchNo: number;
  readonly kind: 'INITIAL' | 'SUPPLEMENT';
  readonly originalName: string;
  readonly declaredBytes: number;
  readonly zipSha256: string;
  readonly status: BatchStatus;
  readonly generation?: number;
  readonly version: number;
  readonly createdAt: string;
  readonly manifestId: string | null;
  readonly reasonCodes: readonly string[];
  readonly originalRequestId?: string;
  readonly note?: string;
  readonly policyVersion?: string;
  readonly currentAttempt?: CustodyAttempt;
}

export interface CustodyEntry {
  readonly entryId: string;
  readonly ordinal: number;
  readonly originalName: string;
  readonly normalizedPath: string;
  readonly status: EntryStatus;
  readonly reasonCodes: readonly string[];
  readonly mediaType?: string;
  readonly byteLength?: number;
  readonly sha256?: string;
  readonly sourceId?: string;
}

export interface CustodyManifest {
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly batchId: string;
  readonly originalZip: {
    readonly sourceId: string;
    readonly sha256: string;
    readonly byteLength: number;
    readonly mediaType: string;
  };
  readonly totalEntries: number;
  readonly acceptedEntries: number;
  readonly limitedEntries: number;
  readonly createdAt: string;
}

export interface CustodyBatchDetail {
  readonly batch: CustodyBatch;
  readonly attempts: readonly CustodyAttempt[];
  readonly manifest: CustodyManifest | null;
  readonly permittedActions: readonly RecoveryAction[];
}

export interface CustodyPage<T> {
  readonly items: readonly T[];
  readonly next?: string;
}

export interface CustodyEntryPage {
  readonly manifest: CustodyManifest;
  readonly entries: readonly CustodyEntry[];
  readonly next?: string;
}

export interface CustodyRequestView {
  readonly requestId: string;
  readonly projectId: string;
  readonly operation: string;
  readonly targetId: string;
  readonly payloadHash: string;
  readonly receipt: Record<string, unknown>;
}

const BATCH_STATUSES: readonly BatchStatus[] = [
  'AWAITING_UPLOAD',
  'RECEIVING',
  'STAGED',
  'EXTRACTING',
  'RECEIVED',
  'PARTIAL',
  'FAILED',
  'REJECTED',
  'ABANDONED',
  'UNKNOWN',
];
const ENTRY_STATUSES: readonly EntryStatus[] = [
  'ACCEPTED',
  'UNSUPPORTED',
  'CORRUPT',
  'READ_LIMITED',
];
const ACTIONS: readonly RecoveryAction[] = [
  'RECONCILE',
  'RETRY_UPLOAD',
  'CONTINUE_EXTRACTION',
  'ABANDON',
];

function optionalString(item: Record<string, unknown>, key: string): string | undefined | null {
  if (!(key in item)) return undefined;
  const value = asNonEmptyString(item[key]);
  return value;
}

function stringArray(value: unknown): readonly string[] | null {
  const array = asArray(value);
  if (array === null) return null;
  return array.every((entry) => typeof entry === 'string') ? array : null;
}

export function parseSession(value: unknown): CustodySession | null {
  const item = asRecord(value);
  if (item === null) return null;
  const ownerId = asNonEmptyString(item.ownerId);
  const displayName = asNonEmptyString(item.displayName);
  const authEpoch = asNumber(item.authEpoch);
  const instanceId = asNonEmptyString(item.instanceId);
  if (ownerId === null || displayName === null || authEpoch === null || instanceId === null)
    return null;
  return { ownerId, displayName, authEpoch, instanceId };
}

export function parseProject(value: unknown): CustodyProject | null {
  const item = asRecord(value);
  if (item === null) return null;
  const projectId = asNonEmptyString(item.projectId);
  const customerName = asNonEmptyString(item.customerName);
  const title = asNonEmptyString(item.title);
  const createdAt = asNonEmptyString(item.createdAt);
  const version = asNumber(item.version);
  const lastBatchNo = asNumber(item.lastBatchNo);
  const activeBatchId = optionalString(item, 'activeBatchId');
  if (
    projectId === null ||
    customerName === null ||
    title === null ||
    createdAt === null ||
    version === null ||
    lastBatchNo === null ||
    activeBatchId === null
  )
    return null;
  return {
    projectId,
    customerName,
    title,
    createdAt,
    version,
    lastBatchNo,
    activeBatchId: activeBatchId ?? null,
  };
}

function parseAttempt(value: unknown): CustodyAttempt | null {
  const item = asRecord(value);
  if (item === null) return null;
  const attemptId = asNonEmptyString(item.attemptId);
  const kind = item.kind === 'UPLOAD' || item.kind === 'EXTRACT' ? item.kind : null;
  const number = asNumber(item.number);
  const generation = asNumber(item.generation);
  const status = asNonEmptyString(item.status);
  const startedAt = asNonEmptyString(item.startedAt);
  const endedAt = optionalString(item, 'endedAt');
  if (
    attemptId === null ||
    kind === null ||
    number === null ||
    generation === null ||
    status === null ||
    startedAt === null ||
    endedAt === null
  )
    return null;
  return {
    attemptId,
    kind,
    number,
    generation,
    status,
    startedAt,
    ...(endedAt === undefined ? {} : { endedAt }),
  };
}

export function parseBatch(value: unknown): CustodyBatch | null {
  const item = asRecord(value);
  if (item === null) return null;
  const batchId = asNonEmptyString(item.batchId);
  const projectId = asNonEmptyString(item.projectId);
  const batchNo = asNumber(item.batchNo);
  const kind = item.kind === 'INITIAL' || item.kind === 'SUPPLEMENT' ? item.kind : null;
  const originalName = asNonEmptyString(item.originalName);
  const declaredBytes = asNumber(item.declaredBytes);
  const zipSha256 = asNonEmptyString(item.zipSha256);
  const status = BATCH_STATUSES.find((candidate) => candidate === item.status) ?? null;
  const version = asNumber(item.version);
  const generation = item.generation === undefined ? undefined : asNumber(item.generation);
  const createdAt = asNonEmptyString(item.createdAt);
  const reasonCodes = stringArray(item.reasonCodes);
  const manifestId = optionalString(item, 'manifestId');
  const originalRequestId = optionalString(item, 'originalRequestId');
  const note = optionalString(item, 'note');
  const policyVersion = optionalString(item, 'policyVersion');
  const currentAttempt =
    item.currentAttempt === undefined ? undefined : parseAttempt(item.currentAttempt);
  if (
    batchId === null ||
    projectId === null ||
    batchNo === null ||
    kind === null ||
    originalName === null ||
    declaredBytes === null ||
    zipSha256 === null ||
    status === null ||
    version === null ||
    generation === null ||
    createdAt === null ||
    reasonCodes === null ||
    manifestId === null ||
    originalRequestId === null ||
    note === null ||
    policyVersion === null ||
    currentAttempt === null
  )
    return null;
  return {
    batchId,
    projectId,
    batchNo,
    kind,
    originalName,
    declaredBytes,
    zipSha256,
    status,
    version,
    createdAt,
    manifestId: manifestId ?? null,
    reasonCodes,
    ...(generation === undefined ? {} : { generation }),
    ...(originalRequestId === undefined ? {} : { originalRequestId }),
    ...(note === undefined ? {} : { note }),
    ...(policyVersion === undefined ? {} : { policyVersion }),
    ...(currentAttempt === undefined ? {} : { currentAttempt }),
  };
}

export function parseManifest(value: unknown): CustodyManifest | null {
  const item = asRecord(value);
  if (item === null) return null;
  const manifestId = asNonEmptyString(item.manifestId);
  const manifestHash = asNonEmptyString(item.manifestHash);
  const batchId = asNonEmptyString(item.batchId);
  const totalEntries = asNumber(item.totalEntries);
  const acceptedEntries = asNumber(item.acceptedEntries);
  const limitedEntries = asNumber(item.limitedEntries);
  const createdAt = asNonEmptyString(item.createdAt);
  const original = asRecord(item.originalZip);
  const sourceId = original === null ? null : asNonEmptyString(original.sourceId);
  const sha256 = original === null ? null : asNonEmptyString(original.sha256);
  const byteLength = original === null ? null : asNumber(original.byteLength);
  const mediaType = original === null ? null : asNonEmptyString(original.mediaType);
  if (
    manifestId === null ||
    manifestHash === null ||
    batchId === null ||
    totalEntries === null ||
    acceptedEntries === null ||
    limitedEntries === null ||
    createdAt === null ||
    sourceId === null ||
    sha256 === null ||
    byteLength === null ||
    mediaType === null
  )
    return null;
  return {
    manifestId,
    manifestHash,
    batchId,
    originalZip: { sourceId, sha256, byteLength, mediaType },
    totalEntries,
    acceptedEntries,
    limitedEntries,
    createdAt,
  };
}

export function parseEntry(value: unknown): CustodyEntry | null {
  const item = asRecord(value);
  if (item === null) return null;
  const entryId = asNonEmptyString(item.entryId);
  const ordinal = asNumber(item.ordinal);
  const originalName = asNonEmptyString(item.originalName);
  const normalizedPath = asNonEmptyString(item.normalizedPath);
  const status = ENTRY_STATUSES.find((candidate) => candidate === item.status) ?? null;
  const reasonCodes = stringArray(item.reasonCodes);
  const mediaType = optionalString(item, 'mediaType');
  const byteLength = item.byteLength === undefined ? undefined : asNumber(item.byteLength);
  const sha256 = optionalString(item, 'sha256');
  const source = asRecord(item.sourceRef);
  const sourceId = source === null ? undefined : (asNonEmptyString(source.sourceId) ?? null);
  if (
    entryId === null ||
    ordinal === null ||
    originalName === null ||
    normalizedPath === null ||
    status === null ||
    reasonCodes === null ||
    mediaType === null ||
    byteLength === null ||
    sha256 === null ||
    sourceId === null
  )
    return null;
  return {
    entryId,
    ordinal,
    originalName,
    normalizedPath,
    status,
    reasonCodes,
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(byteLength === undefined ? {} : { byteLength }),
    ...(sha256 === undefined ? {} : { sha256 }),
    ...(sourceId === undefined ? {} : { sourceId }),
  };
}

export function parseBatchDetail(value: unknown): CustodyBatchDetail | null {
  const item = asRecord(value);
  if (item === null) return null;
  const batch = parseBatch(item.batch);
  const attemptsArray = asArray(item.attempts);
  const manifest = item.manifest === undefined ? null : parseManifest(item.manifest);
  const actions = asArray(item.permittedActions);
  if (batch === null || attemptsArray === null || actions === null) return null;
  if (item.manifest !== undefined && manifest === null) return null;
  const attempts = attemptsArray.map(parseAttempt);
  if (attempts.some((attempt) => attempt === null)) return null;
  return {
    batch,
    attempts: attempts.filter((attempt) => attempt !== null),
    manifest,
    permittedActions: actions.filter((action): action is RecoveryAction =>
      ACTIONS.includes(action as RecoveryAction),
    ),
  };
}

export function parseProjectList(value: unknown): CustodyPage<CustodyProject> | null {
  const item = asRecord(value);
  const items = item === null ? null : asArray(item.items);
  const next = item === null ? null : optionalString(item, 'nextCursor');
  if (item === null || items === null || next === null) return null;
  const projects = items.map(parseProject);
  if (projects.some((project) => project === null)) return null;
  return {
    items: projects.filter((project) => project !== null),
    ...(next === undefined ? {} : { next }),
  };
}

export function parseBatchList(value: unknown): CustodyPage<CustodyBatch> | null {
  const item = asRecord(value);
  const items = item === null ? null : asArray(item.items);
  const next = item === null ? null : optionalString(item, 'nextCursor');
  if (item === null || items === null || next === null) return null;
  const batches = items.map(parseBatch);
  if (batches.some((batch) => batch === null)) return null;
  return {
    items: batches.filter((batch) => batch !== null),
    ...(next === undefined ? {} : { next }),
  };
}

export function parseEntryPage(value: unknown): CustodyEntryPage | null {
  const item = asRecord(value);
  const manifest = item === null ? null : parseManifest(item.manifest);
  const entriesArray = item === null ? null : asArray(item.entries);
  const next = item === null ? null : optionalString(item, 'nextCursor');
  if (manifest === null || entriesArray === null || next === null) return null;
  const entries = entriesArray.map(parseEntry);
  if (entries.some((entry) => entry === null)) return null;
  return {
    manifest,
    entries: entries.filter((entry) => entry !== null),
    ...(next === undefined ? {} : { next }),
  };
}

export function parseRequestView(value: unknown): CustodyRequestView | null {
  const item = asRecord(value);
  if (item === null) return null;
  const requestId = asNonEmptyString(item.requestId);
  const projectId = asNonEmptyString(item.projectId);
  const operation = asNonEmptyString(item.operation);
  const targetId = asNonEmptyString(item.targetId);
  const payloadHash = asNonEmptyString(item.payloadHash);
  const receipt = asRecord(item.receipt);
  if (
    requestId === null ||
    projectId === null ||
    operation === null ||
    targetId === null ||
    payloadHash === null ||
    receipt === null
  )
    return null;
  return { requestId, projectId, operation, targetId, payloadHash, receipt };
}

export function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

export function statusLabel(status: BatchStatus): string {
  switch (status) {
    case 'AWAITING_UPLOAD':
      return '等待上传';
    case 'RECEIVING':
      return '正在接收';
    case 'STAGED':
      return '原包已保存，等待提取';
    case 'EXTRACTING':
      return '正在提取';
    case 'RECEIVED':
      return '已接收';
    case 'PARTIAL':
      return '部分接收';
    case 'FAILED':
      return '已知失败';
    case 'REJECTED':
      return '安全检查拒绝';
    case 'ABANDONED':
      return '已放弃';
    case 'UNKNOWN':
      return '结果未确定';
  }
}

export function actionLabel(action: RecoveryAction): string {
  switch (action) {
    case 'RECONCILE':
      return '核对原尝试';
    case 'RETRY_UPLOAD':
      return '重传同一原包';
    case 'CONTINUE_EXTRACTION':
      return '继续提取';
    case 'ABANDON':
      return '明确放弃';
  }
}

export function newUuidV7(): string {
  const random = crypto.getRandomValues(new Uint8Array(10));
  const timestamp = BigInt(Date.now());
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 6; index++)
    bytes[index] = Number((timestamp >> BigInt(8 * (5 - index))) & 0xffn);
  bytes[6] = 0x70 | ((random.at(0) ?? 0) & 0x0f);
  bytes[7] = random.at(1) ?? 0;
  bytes[8] = 0x80 | ((random.at(2) ?? 0) & 0x3f);
  for (let index = 3; index < 10; index++) bytes[index + 6] = random.at(index) ?? 0;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function digest(bytesValue: BufferSource): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytesValue);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function stableFingerprint(value: unknown): Promise<string> {
  return digest(new TextEncoder().encode(stableJson(value)));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface PendingIntent {
  readonly instanceId: string;
  readonly ownerId: string;
  readonly authEpoch: number;
  readonly operation: string;
  readonly projectId: string;
  readonly requestId: string;
  readonly targetId: string;
  readonly fingerprint: string;
  readonly expectedVersion?: number;
}

const INTENT_KEY = 'zhiju.mvp.pending-intent@1';
const memoryIntents = new Map<string, { payload: Record<string, unknown>; file?: File }>();

export function savePendingIntent(intent: PendingIntent): void {
  localStorage.setItem(INTENT_KEY, JSON.stringify(intent));
}

export function readPendingIntent(): PendingIntent | null {
  try {
    const raw = localStorage.getItem(INTENT_KEY);
    const item = raw === null ? null : asRecord(JSON.parse(raw));
    if (item === null) return null;
    const instanceId = asNonEmptyString(item.instanceId);
    const ownerId = asNonEmptyString(item.ownerId);
    const authEpoch = asNumber(item.authEpoch);
    const operation = asNonEmptyString(item.operation);
    const projectId = asNonEmptyString(item.projectId);
    const requestId = asNonEmptyString(item.requestId);
    const targetId = asNonEmptyString(item.targetId);
    const fingerprint = asNonEmptyString(item.fingerprint);
    const expectedVersion =
      item.expectedVersion === undefined ? undefined : asNumber(item.expectedVersion);
    if (
      instanceId === null ||
      ownerId === null ||
      authEpoch === null ||
      operation === null ||
      projectId === null ||
      requestId === null ||
      targetId === null ||
      fingerprint === null ||
      expectedVersion === null
    )
      return null;
    return {
      instanceId,
      ownerId,
      authEpoch,
      operation,
      projectId,
      requestId,
      targetId,
      fingerprint,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    };
  } catch {
    return null;
  }
}

export function clearPendingIntent(requestId: string): void {
  const current = readPendingIntent();
  if (current?.requestId === requestId) localStorage.removeItem(INTENT_KEY);
  memoryIntents.delete(requestId);
}

export function rememberIntentPayload(
  requestId: string,
  payload: Record<string, unknown>,
  file?: File,
): void {
  memoryIntents.set(requestId, file === undefined ? { payload } : { payload, file });
}

export function recallIntentPayload(
  requestId: string,
): { payload: Record<string, unknown>; file?: File } | undefined {
  return memoryIntents.get(requestId);
}

export function instanceMarkerMatches(intent: PendingIntent, session: CustodySession): boolean {
  return (
    intent.instanceId === session.instanceId &&
    intent.ownerId === session.ownerId &&
    intent.authEpoch === session.authEpoch
  );
}
