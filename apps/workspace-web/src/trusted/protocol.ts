// Frozen transport projection + result parsing for the three allowlisted
// reads of #258.
//
// `Session Delta §5` fixes the Browser/BFF body to the shared Envelope
// projection: `{queryId,type,version,scopeRef,consistencyRequirement,pagination,
// correlationId,requestedAt,payload,integrity}`. Core appends requester /
// authenticationContextRef / authorizationDecisionRef, so the browser never
// sends an actor, a decision, a role or an upstream URL. Parsing is equally
// strict: a page whose items or cursor do not satisfy the owning schema is a
// client-state error, never a partially rendered card.

import { readApiFailure, type ApiFailure } from './errors.js';
import { isUuidV7, isQueryOperation, isQueryVersion } from './identity.js';
import { PAGE_SIZE, type Freshness, type SourceWatermarkView } from './pagination.js';
import { asArray, asNonEmptyString, asNumber, asRecord, field, type JsonRecord } from './values.js';

export const OPERATION_VERSION = '1.0';
export const DIRECTORY_OPERATION = 'project.find_workspace_projects';
export const PROJECT_BOARD_OPERATION = 'project.get_project_board_slice';
export const TASK_BOARD_OPERATION = 'execution.get_task_board_slice';
export const DIRECTORY_SCOPE_KEY = 'self-discovery';

/**
 * No status filter: an empty `statuses`/`itemTypes` set means "no filter" for
 * the EP DeliveryItem board. `execution.get_task_board_slice` declares a
 * non-empty status set, so the complete owning enum is sent there instead.
 * Neither board's denominator is ever summed across projects.
 */
export const TASK_STATUSES = [
  'DRAFT',
  'BACKLOG',
  'READY',
  'IN_PROGRESS',
  'WAITING_INPUT',
  'BLOCKED',
  'IN_REVIEW',
  'CHANGES_REQUIRED',
  'COMPLETION_PENDING',
  'COMPLETED',
  'CANCELLED',
] as const;

export interface DirectoryCard {
  readonly key: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly enterpriseRef: JsonRecord;
  readonly projectRef: JsonRecord;
  readonly enterpriseDisplayName: string;
  readonly displayCode: string;
  readonly title: string;
  readonly status: string;
  readonly aggregateVersion: number;
}

export interface BoardRow {
  readonly key: string;
  readonly title: string;
  readonly status: string;
  readonly version: number | null;
  readonly secondary: string | null;
  readonly blockers: number;
}

export interface ParsedPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly snapshotAt: string | null;
  readonly sourceWatermarks: readonly SourceWatermarkView[];
}

export class BffFailure extends Error {
  readonly api: ApiFailure;

  constructor(api: ApiFailure) {
    super(api.code);
    this.name = 'BffFailure';
    this.api = api;
  }
}

function invalidState(httpStatus: number): BffFailure {
  return new BffFailure(readApiFailure(httpStatus, { code: 'UI_CLIENT_STATE_INVALID' }));
}

export function projectScopeKey(card: { enterpriseId: string; projectId: string }): string {
  return `project:${card.enterpriseId}/${card.projectId}`;
}

interface ProjectionArgs {
  readonly queryId: string;
  readonly correlationId: string;
  readonly requestedAt: string;
  readonly type: string;
  readonly scopeRef: JsonRecord;
  readonly consistencyRequirement: string;
  readonly cursor: string | null;
  readonly payload: JsonRecord;
}

function projection(args: ProjectionArgs): JsonRecord {
  if (!isQueryOperation(args.type) || !isQueryVersion(OPERATION_VERSION)) {
    throw new Error('UI_CLIENT_STATE_INVALID');
  }
  if (!isUuidV7(args.queryId) || !isUuidV7(args.correlationId)) {
    throw new Error('UI_CLIENT_STATE_INVALID');
  }
  const pagination: JsonRecord =
    args.cursor === null ? { pageSize: PAGE_SIZE } : { pageSize: PAGE_SIZE, cursor: args.cursor };
  return {
    queryId: args.queryId,
    type: args.type,
    version: OPERATION_VERSION,
    scopeRef: args.scopeRef,
    consistencyRequirement: args.consistencyRequirement,
    pagination,
    correlationId: args.correlationId,
    requestedAt: args.requestedAt,
    payload: args.payload,
    integrity: null,
  };
}

function pageRequest(cursor: string | null): JsonRecord {
  return cursor === null ? { pageSize: PAGE_SIZE } : { pageSize: PAGE_SIZE, cursor };
}

export interface DirectoryQueryArgs {
  readonly queryId: string;
  readonly correlationId: string;
  readonly requestedAt: string;
  readonly cursor: string | null;
}

/** Self-discovery directory read: the only declared empty-`scopeRef` entry. */
export function buildDirectoryQueryInput(args: DirectoryQueryArgs): JsonRecord {
  return projection({
    ...args,
    type: DIRECTORY_OPERATION,
    scopeRef: {},
    consistencyRequirement: 'AUTHORITATIVE',
    payload: { page: pageRequest(args.cursor) },
  });
}

function buildBoardQueryInput(
  operation: string,
  args: DirectoryQueryArgs & { readonly card: DirectoryCard },
): JsonRecord {
  const scope = asRecord(args.card.projectRef.scope);
  if (scope === null) throw new Error('UI_CLIENT_STATE_INVALID');
  const page = pageRequest(args.cursor);
  return projection({
    queryId: args.queryId,
    correlationId: args.correlationId,
    requestedAt: args.requestedAt,
    type: operation,
    scopeRef: scope,
    consistencyRequirement: 'PROJECTION_OK',
    cursor: args.cursor,
    payload:
      operation === PROJECT_BOARD_OPERATION
        ? { projectRef: args.card.projectRef, statuses: [], itemTypes: [], page }
        : { projectRef: args.card.projectRef, statuses: [...TASK_STATUSES], page },
  });
}

/**
 * One Project's DeliveryItem boards entry (EP). The ref is forwarded verbatim
 * so the owning module keeps its exact type/scope identity.
 */
export function buildProjectBoardQueryInput(
  args: DirectoryQueryArgs & { readonly card: DirectoryCard },
): JsonRecord {
  return buildBoardQueryInput(PROJECT_BOARD_OPERATION, args);
}

/** One Project's Task board (TE), read independently with its own authorization. */
export function buildTaskBoardQueryInput(
  args: DirectoryQueryArgs & { readonly card: DirectoryCard },
): JsonRecord {
  return buildBoardQueryInput(TASK_BOARD_OPERATION, args);
}

const FRESHNESS: Record<string, Freshness> = {
  FRESH: 'FRESH',
  STALE: 'STALE',
  PAUSED: 'PAUSED',
  REBUILDING: 'REBUILDING',
  FAILED: 'FAILED',
};

export interface QueryPageResult {
  readonly resultStatus: string;
  readonly freshness: Freshness;
  readonly data: unknown;
}

/**
 * Reads the shared QueryResult envelope. `ERROR` is an error (never an empty
 * page); `STALE` keeps its own freshness so the view cannot label old data as
 * current.
 */
export function readQueryResult(httpStatus: number, body: unknown): QueryPageResult {
  const record = asRecord(body);
  if (record === null) throw invalidState(httpStatus);
  const status = asNonEmptyString(record.status);
  if (status === null || status === 'ERROR') {
    const failure = readApiFailure(httpStatus, body);
    throw new BffFailure(
      failure.code === 'UI_CLIENT_STATE_INVALID'
        ? { ...failure, code: 'UI_PROJECTION_STALE' }
        : failure,
    );
  }
  if (status !== 'OK' && status !== 'STALE') throw invalidState(httpStatus);
  const staleness = asNonEmptyString(record.stalenessStatus);
  const freshness =
    (staleness === null ? undefined : FRESHNESS[staleness]) ??
    (status === 'STALE' ? 'STALE' : 'FRESH');
  return { resultStatus: status, freshness, data: field(record, 'data') };
}

export function parseSourceWatermarks(value: unknown): readonly SourceWatermarkView[] {
  const entries = asArray(value);
  if (entries === null) return [];
  const watermarks: SourceWatermarkView[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    if (record === null) continue;
    const sourceModule = asNonEmptyString(record.sourceModule);
    const sequence = asNumber(record.sequence);
    if (sourceModule === null || sequence === null) continue;
    watermarks.push({
      sourceModule,
      sequence,
      observedAt: asNonEmptyString(record.observedAt),
    });
  }
  return watermarks;
}

function readCursor(record: JsonRecord): string | null {
  const value = field(record, 'nextCursor');
  if (value === undefined) return null;
  const cursor = asNonEmptyString(value);
  if (cursor === null) throw invalidState(200);
  return cursor;
}

function readPageMeta(record: JsonRecord) {
  return {
    nextCursor: readCursor(record),
    snapshotAt: asNonEmptyString(record.snapshotAt),
    sourceWatermarks: parseSourceWatermarks(field(record, 'sourceWatermarks')),
  };
}

function readItems(record: JsonRecord): readonly unknown[] {
  const items = asArray(field(record, 'items'));
  if (items === null) throw invalidState(200);
  return items;
}

interface ValidatedRef {
  readonly ref: JsonRecord;
  readonly objectId: string;
}

function readObjectRef(value: unknown): ValidatedRef {
  const record = asRecord(value);
  const objectId = asNonEmptyString(record?.objectId);
  const objectType = asNonEmptyString(record?.objectType);
  if (record?.kind !== 'OBJECT' || objectType === null || objectId === null) {
    throw invalidState(200);
  }
  if (!isUuidV7(objectId)) throw invalidState(200);
  return { ref: record, objectId };
}

function readDirectoryCard(value: unknown): DirectoryCard {
  const record = asRecord(value);
  if (record === null) throw invalidState(200);
  const enterpriseRef = readObjectRef(record.enterpriseRef).ref;
  const project = readObjectRef(record.projectRef);
  const scope = asRecord(project.ref.scope);
  const enterpriseId = scope === null ? null : asNonEmptyString(scope.enterpriseId);
  const projectId = scope === null ? null : asNonEmptyString(scope.projectId);
  const enterpriseDisplayName = asNonEmptyString(record.enterpriseDisplayName);
  const displayCode = asNonEmptyString(record.displayCode);
  const title = asNonEmptyString(record.title);
  const status = asNonEmptyString(record.status);
  const aggregateVersion = asNumber(record.aggregateVersion);
  if (
    enterpriseId === null ||
    projectId === null ||
    !isUuidV7(enterpriseId) ||
    !isUuidV7(projectId) ||
    enterpriseDisplayName === null ||
    displayCode === null ||
    title === null ||
    status === null ||
    aggregateVersion === null
  ) {
    throw invalidState(200);
  }
  // The owning ProjectRef identity and its scope must agree; a mismatch would
  // otherwise render a card under another project's scope key.
  if (project.objectId !== projectId) throw invalidState(200);
  return {
    key: `project:${enterpriseId}/${projectId}`,
    enterpriseId,
    projectId,
    enterpriseRef,
    projectRef: project.ref,
    enterpriseDisplayName,
    displayCode,
    title,
    status,
    aggregateVersion,
  };
}

function blockerCount(value: unknown): number {
  const refs = asArray(value);
  return refs === null ? 0 : refs.length;
}

export function parseDirectoryPage(data: unknown): ParsedPage<DirectoryCard> {
  const record = asRecord(data);
  if (record === null) throw invalidState(200);
  return { items: readItems(record).map(readDirectoryCard), ...readPageMeta(record) };
}

function readProjectBoardRow(value: unknown): BoardRow {
  const record = asRecord(value);
  if (record === null) throw invalidState(200);
  const key = asNonEmptyString(record.deliveryItemId);
  const title = asNonEmptyString(record.title);
  const status = asNonEmptyString(record.executionStatus);
  if (key === null || !isUuidV7(key) || title === null || status === null) throw invalidState(200);
  return {
    key,
    title,
    status,
    version: null,
    secondary: asNonEmptyString(record.commitmentStatus),
    blockers: blockerCount(record.blockerRefs),
  };
}

function readTaskBoardRow(value: unknown): BoardRow {
  const record = asRecord(value);
  if (record === null) throw invalidState(200);
  const taskRef = readObjectRef(record.taskRef);
  const title = asNonEmptyString(record.title);
  const status = asNonEmptyString(record.status);
  const version = asNumber(record.aggregateVersion);
  if (title === null || status === null || version === null) throw invalidState(200);
  return {
    key: taskRef.objectId,
    title,
    status,
    version,
    secondary: null,
    blockers: blockerCount(record.blockerRefs),
  };
}

export function parseProjectBoardPage(data: unknown): ParsedPage<BoardRow> {
  const record = asRecord(data);
  if (record === null) throw invalidState(200);
  return { items: readItems(record).map(readProjectBoardRow), ...readPageMeta(record) };
}

export function parseTaskBoardPage(data: unknown): ParsedPage<BoardRow> {
  const record = asRecord(data);
  if (record === null) throw invalidState(200);
  return { items: readItems(record).map(readTaskBoardRow), ...readPageMeta(record) };
}
