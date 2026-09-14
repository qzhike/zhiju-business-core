// IM-03 WI-11 (issue #67): authoritative Query and permission-trimmed
// Project Board read handlers. Query handlers validate the trusted context
// before opening a database transaction and never replace an exact reference
// with a latest/current lookup.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { EnterpriseProject } from '@zhiju/contracts';
import {
  digestCanonicalPayload,
  withEnterpriseProjectTransaction,
  withProjectionTransaction,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransactionContext,
} from '../persistence/enterprise-db.js';
import {
  PROJECT_BOARD_PROJECTION_CONSUMER,
  compareProjectBoardPosition,
  projectBoardItemFromRow,
  readProjectBoardProjection,
} from '../persistence/project-board-projection-repository.js';
import type { ProjectBoardTable } from '../persistence/projection-types.js';
import {
  assembleProjectContextSourceSlice,
  validateRequestedKinds,
  validateSourceSlicePurpose,
} from './source-slice-assembly.js';
import {
  EnterpriseBusinessError,
  PROJECT_QUERY_AUDIENCE_INVALID,
  PROJECT_QUERY_CONTEXT_EXPIRED,
  PROJECT_QUERY_CURSOR_INVALID,
  PROJECT_QUERY_REF_INVALID,
  PROJECT_QUERY_SCOPE_MISMATCH,
} from './enterprise-business-errors.js';
import { isUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

type ContextSourcePayload = EnterpriseProject.ProjectGetProjectContextSourcePayload;
type BoardPayload = EnterpriseProject.ProjectGetProjectBoardSlicePayload;

function parseInstant(value: string | undefined, label: string): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    queryError(PROJECT_QUERY_REF_INVALID, `${label} must be a valid UTC instant`);
  }
  return parsed;
}

const EXECUTION_STATUSES = new Set<EnterpriseProject.DeliveryExecutionStatus>([
  'NOT_READY',
  'READY',
  'IN_PROGRESS',
  'BLOCKED',
  'IN_REVIEW',
  'APPROVED_OUTPUT',
  'RELEASED',
  'COMPLETED',
]);

function queryError(code: string, message: string): never {
  throw new EnterpriseBusinessError(code, message);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function exactProjectRef(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
): { readonly enterpriseId: string; readonly projectId: string } {
  const ref = record(value);
  const scope = record(ref.scope);
  if (
    ref.kind !== 'OBJECT' ||
    ref.objectType !== 'Project' ||
    typeof ref.objectId !== 'string' ||
    !isUuidV7(ref.objectId) ||
    scope.enterpriseId !== context.enterpriseId ||
    scope.projectId !== ref.objectId
  ) {
    queryError(PROJECT_QUERY_REF_INVALID, 'projectRef must be an exact Project ObjectRef');
  }
  if (!context.allowedProjectIds.includes(ref.objectId)) {
    queryError(PROJECT_QUERY_SCOPE_MISMATCH, 'projectRef is outside the trusted Project scope');
  }
  return { enterpriseId: context.enterpriseId, projectId: ref.objectId };
}

function validateContext(context: EnterpriseProjectTransactionContext): void {
  if (context.authorizationDecisionExpiresAt.getTime() <= Date.now()) {
    queryError(PROJECT_QUERY_CONTEXT_EXPIRED, 'authorization context has expired');
  }
}

function validateAudience(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
  projectId: string,
): void {
  const audience = record(value);
  const scope = record(audience.scope);
  const audienceProjectId = scope.projectId;
  if (
    audience.kind !== 'OBJECT' ||
    (audience.objectType !== 'Principal' && audience.objectType !== 'identity.principal') ||
    typeof audience.objectId !== 'string' ||
    !isUuidV7(audience.objectId) ||
    scope.enterpriseId !== context.enterpriseId ||
    (audienceProjectId !== undefined && audienceProjectId !== projectId) ||
    audience.objectId !== context.principalId
  ) {
    queryError(
      PROJECT_QUERY_AUDIENCE_INVALID,
      'audience must identify the trusted Principal exactly',
    );
  }
}

export type GetProjectContextSourceQueryPayload = ContextSourcePayload;

export async function handleGetProjectContextSource(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  payload: ContextSourcePayload,
): Promise<EnterpriseProject.ProjectGetProjectContextSourceResult> {
  validateContext(context);
  const scope = exactProjectRef(payload.projectRef, context);
  validateAudience(payload.audience, context, scope.projectId);
  validateSourceSlicePurpose(payload.purpose);
  const requestedKinds = validateRequestedKinds(payload.requestedKinds);
  const asOf = parseInstant(payload.asOf, 'asOf');
  return withEnterpriseProjectTransaction(db, context, (trx) =>
    assembleProjectContextSourceSlice(trx, scope, {
      purpose: payload.purpose,
      requestedKinds,
      ...(asOf === undefined ? {} : { asOf }),
    }),
  );
}

interface BoardCursor {
  readonly version: 1;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly filterHash: string;
  readonly projectionVersionId: string;
  readonly itemKey: string;
  readonly deliveryItemId: string;
  readonly expiresAt: number;
}

function cursorSignature(body: string, context: EnterpriseProjectTransactionContext): string {
  return createHmac('sha256', context.authorizationDecisionHash)
    .update(body, 'utf8')
    .digest('base64url');
}

function encodeCursor(
  cursor: Omit<BoardCursor, 'version' | 'expiresAt'>,
  context: EnterpriseProjectTransactionContext,
): string {
  const payload: BoardCursor = {
    ...cursor,
    version: 1,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${cursorSignature(body, context)}`;
}

function decodeCursor(value: string, context: EnterpriseProjectTransactionContext): BoardCursor {
  const [body, signature, extra] = value.split('.');
  if (extra !== undefined || body === undefined || signature === undefined) {
    queryError(PROJECT_QUERY_CURSOR_INVALID, 'cursor encoding is invalid');
  }
  const expected = cursorSignature(body, context);
  const actualBytes = Buffer.from(signature, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    queryError(PROJECT_QUERY_CURSOR_INVALID, 'cursor signature is invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    queryError(PROJECT_QUERY_CURSOR_INVALID, 'cursor payload is invalid');
  }
  const cursor = record(parsed);
  if (
    cursor.version !== 1 ||
    typeof cursor.enterpriseId !== 'string' ||
    typeof cursor.projectId !== 'string' ||
    typeof cursor.filterHash !== 'string' ||
    typeof cursor.projectionVersionId !== 'string' ||
    typeof cursor.itemKey !== 'string' ||
    typeof cursor.deliveryItemId !== 'string' ||
    typeof cursor.expiresAt !== 'number' ||
    !Number.isSafeInteger(cursor.expiresAt) ||
    cursor.expiresAt <= Date.now()
  ) {
    queryError(PROJECT_QUERY_CURSOR_INVALID, 'cursor claims are invalid or expired');
  }
  return cursor as unknown as BoardCursor;
}

function filterHash(payload: BoardPayload): string {
  const statuses = [...payload.statuses].sort();
  const itemTypes = [...payload.itemTypes].sort();
  return digestCanonicalPayload({ statuses, itemTypes }).hash.toString('hex');
}

function boardItem(
  row: ProjectBoardTable,
  scope: { readonly enterpriseId: string; readonly projectId: string },
): EnterpriseProject.ProjectBoardSliceItem {
  const item = projectBoardItemFromRow(row, scope.enterpriseId, scope.projectId);
  return {
    deliveryItemId: item.deliveryItemId,
    itemKey: item.itemKey,
    title: item.title,
    commitmentStatus: item.commitmentStatus,
    executionStatus: item.executionStatus,
    ...(item.completionEvaluationRef === undefined
      ? {}
      : { completionEvaluationRef: item.completionEvaluationRef }),
    blockerRefs: item.blockerRefs,
  };
}

function projectionStatus(
  hasAlias: boolean,
  versionStatus: string | undefined,
  checkpointStatus: string | undefined,
  lag: number,
): 'READY' | 'STALE' | 'REBUILDING' | 'FAILED' {
  if (!hasAlias) return 'REBUILDING';
  if (versionStatus === 'FAILED') return 'FAILED';
  if (versionStatus === 'BUILDING') return 'REBUILDING';
  if (checkpointStatus === 'FAILED') return 'FAILED';
  if (checkpointStatus === 'REBUILDING') return 'REBUILDING';
  if (checkpointStatus === 'PAUSED' || lag > 0) return 'STALE';
  return 'READY';
}

export type GetProjectBoardSliceQueryPayload = BoardPayload;

export async function handleGetProjectBoardSlice(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  payload: BoardPayload,
): Promise<EnterpriseProject.ProjectGetProjectBoardSliceResult> {
  validateContext(context);
  const scope = exactProjectRef(payload.projectRef, context);
  if (
    !Number.isSafeInteger(payload.page.pageSize) ||
    payload.page.pageSize < 1 ||
    payload.page.pageSize > 200
  ) {
    queryError(PROJECT_QUERY_REF_INVALID, 'page.pageSize must be between 1 and 200');
  }
  for (const status of payload.statuses) {
    if (!EXECUTION_STATUSES.has(status)) {
      queryError(PROJECT_QUERY_REF_INVALID, 'statuses contains an unsupported execution status');
    }
  }
  for (const itemType of payload.itemTypes) {
    if (typeof itemType !== 'string' || itemType.trim().length === 0) {
      queryError(PROJECT_QUERY_REF_INVALID, 'itemTypes must contain non-empty values');
    }
  }
  const hash = filterHash(payload);
  return withProjectionTransaction(db, context, async (trx) => {
    const state = await readProjectBoardProjection(trx, scope.enterpriseId, scope.projectId);
    const cursor =
      payload.page.cursor === undefined ? undefined : decodeCursor(payload.page.cursor, context);
    if (cursor !== undefined) {
      if (
        cursor.enterpriseId !== scope.enterpriseId ||
        cursor.projectId !== scope.projectId ||
        cursor.filterHash !== hash ||
        state.version?.projection_version_id !== cursor.projectionVersionId
      ) {
        queryError(PROJECT_QUERY_CURSOR_INVALID, 'cursor scope or projection version mismatches');
      }
    }
    const statusFilter = new Set(payload.statuses);
    const itemTypeFilter = new Set(payload.itemTypes);
    const orderedRows = [...state.rows].sort((left, right) =>
      compareProjectBoardPosition(
        left.item_key,
        left.delivery_item_id,
        right.item_key,
        right.delivery_item_id,
      ),
    );
    const filtered = orderedRows.filter((row) => {
      if (statusFilter.size > 0 && !statusFilter.has(row.execution_status as never)) return false;
      if (itemTypeFilter.size > 0 && !itemTypeFilter.has(row.item_type)) return false;
      if (
        cursor !== undefined &&
        compareProjectBoardPosition(
          row.item_key,
          row.delivery_item_id,
          cursor.itemKey,
          cursor.deliveryItemId,
        ) <= 0
      ) {
        return false;
      }
      return true;
    });
    const pageRows = filtered.slice(0, payload.page.pageSize + 1);
    const visibleRows = pageRows.slice(0, payload.page.pageSize);
    const nextRow = pageRows.length > payload.page.pageSize ? visibleRows.at(-1) : undefined;
    const targetSequence = Math.max(
      state.sourceState === undefined ? 0 : Number(state.sourceState.latest_sequence),
      state.checkpoint === undefined ? 0 : Number(state.checkpoint.target_sequence),
    );
    const lastSequence =
      state.checkpoint === undefined ? 0 : Number(state.checkpoint.last_sequence);
    const lag = Math.max(targetSequence - lastSequence, 0);
    const snapshotAt = state.version?.source_recorded_at ?? new Date();
    const sourceObservedAt = state.sourceState?.observed_at ?? snapshotAt;
    const projectionObservedAt = state.checkpoint?.updated_at ?? snapshotAt;
    const status = projectionStatus(
      state.alias !== undefined,
      state.version?.status,
      state.checkpoint?.status,
      lag,
    );
    return {
      items: visibleRows.map((row) => boardItem(row, scope)),
      ...(nextRow === undefined
        ? {}
        : {
            nextCursor: encodeCursor(
              {
                enterpriseId: scope.enterpriseId,
                projectId: scope.projectId,
                filterHash: hash,
                projectionVersionId: state.version?.projection_version_id ?? '',
                itemKey: nextRow.item_key,
                deliveryItemId: nextRow.delivery_item_id,
              },
              context,
            ),
          }),
      snapshotAt: snapshotAt.toISOString(),
      sourceWatermarks: [
        {
          sourceModule: 'enterprise_project',
          partition: scope.projectId,
          sequence: targetSequence,
          observedAt: new Date(sourceObservedAt).toISOString(),
        },
        {
          sourceModule: 'projection',
          partition: `${PROJECT_BOARD_PROJECTION_CONSUMER}:${scope.projectId}`,
          sequence: lastSequence,
          observedAt: new Date(projectionObservedAt).toISOString(),
        },
      ],
      consistency: 'PROJECTION',
      ...(state.version?.source_event_id === null || state.version?.source_event_id === undefined
        ? {}
        : { asOfEventId: state.version.source_event_id }),
      asOfRecordedAt: new Date(snapshotAt).toISOString(),
      projectionLag: lag,
      projectionStatus: status,
    };
  });
}

export function queryFilterDigest(payload: BoardPayload): string {
  return filterHash(payload);
}

export function queryPayloadDigest(value: CanonicalJsonObject): string {
  return digestCanonicalPayload(value).hash.toString('hex');
}
