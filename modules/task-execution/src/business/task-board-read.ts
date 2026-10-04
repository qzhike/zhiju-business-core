// IM-06 TD-05 (#248): the Board query handler.
//
// The handler owns filtering, stable pagination, cursor binding and the real
// freshness observation, and it composes the complete shared QueryResult
// Envelope. It never writes: the PROJECTION_OK / SNAPSHOT_AT_LEAST branches
// read the immutable generation through the projection role, and the
// AUTHORITATIVE branch re-reads the owning snapshot. A stale, rebuilding or
// failed state is reported as it is; no branch can downgrade it to FRESH or
// hide it behind an empty OK page.

import {
  isUuidV7,
  sha256CanonicalJson,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import { fail, object, requireThat, textValue } from './work-order-validation-plan.js';
import {
  assertTaskBoardCursorBinding,
  decodeTaskBoardCursor,
  encodeTaskBoardCursor,
  type TaskBoardCursorClaims,
  type TaskBoardCursorKey,
  type TaskBoardDecodedCursor,
} from './task-board-cursor.js';
import {
  TASK_BOARD_PROJECT_OBJECT_TYPES,
  TASK_BOARD_SOURCE_MODULE,
  compareTaskBoardTaskId,
  taskBoardFilterHash,
  taskBoardSameVersionedRef,
  type TaskBoardConsistency,
  type TaskBoardPolicyObservation,
  type TaskBoardPolicyRules,
  type TaskBoardSnapshotRow,
  type TaskBoardStalenessStatus,
} from './task-board-types.js';
import type { TaskBoardSourceSnapshot } from './task-board-source.js';
import type { TaskBoardHealth } from '../persistence/task-board-dispatch-repository.js';
import type { TaskBoardProjectionState } from '../persistence/task-board-projection-repository.js';
import { CommandExecutionError } from '../persistence/command-runner.js';

function boardError(code: string, message: string): never {
  throw new CommandExecutionError(code, message);
}

export const GET_TASK_BOARD_SLICE_QUERY = 'execution.get_task_board_slice';
export const GET_TASK_BOARD_SLICE_VERSION = '1.0';
export const TASK_BOARD_QUERY_PURPOSE = 'task.execution.get_task_board_slice';

const PROJECT_OBJECT_TYPES: Readonly<Record<string, true>> = Object.fromEntries(
  TASK_BOARD_PROJECT_OBJECT_TYPES.map((objectType) => [objectType, true]),
);
const DELIVERY_ITEM_OBJECT_TYPES: Readonly<Record<string, true>> = {
  'project.delivery_item': true,
  'zhiju.project.delivery_item': true,
};

export interface TaskBoardProjectScope {
  readonly enterpriseId: string;
  readonly projectId: string;
}

export interface TaskBoardPolicyResolution {
  readonly policyRef: CanonicalJsonObject;
  readonly policyVersionRef: CanonicalJsonObject;
  readonly policyContentHash: string;
  readonly policyObservation: TaskBoardPolicyObservation;
  readonly rules: TaskBoardPolicyRules;
}

export interface TaskBoardReadPorts {
  readonly now: () => Date;
  readonly cursorKey: TaskBoardCursorKey;
  readonly authorizationSourceHash: string;
  readonly resolveBoardPolicy: (
    projectRef: CanonicalJsonObject,
  ) => Promise<TaskBoardPolicyResolution>;
  readonly readProjection: (project: TaskBoardProjectScope) => Promise<TaskBoardProjectionState>;
  readonly readGeneration: (
    project: TaskBoardProjectScope,
    generationId: string,
  ) => Promise<TaskBoardProjectionState>;
  readonly findGenerationBySnapshotAt: (
    project: TaskBoardProjectScope,
    snapshotAt: string,
  ) => Promise<TaskBoardProjectionState | undefined>;
  readonly readLatestFailure: (
    project: TaskBoardProjectScope,
  ) => Promise<{ readonly failureCode: string; readonly recordedAt: Date } | undefined>;
  readonly readSourceHealth: (
    project: TaskBoardProjectScope,
  ) => Promise<TaskBoardHealth | undefined>;
  readonly readAuthoritativeRows: (
    project: TaskBoardProjectScope,
    projectRef: CanonicalJsonObject,
  ) => Promise<TaskBoardSourceSnapshot & { readonly snapshotAt: Date }>;
  readonly revalidateAuthorization: () => Promise<void>;
}

export interface TaskBoardQueryInput {
  readonly queryId: string;
  readonly consistency: TaskBoardConsistency;
  readonly asOf?: string;
  readonly minimumWatermark?: number;
  readonly payload: CanonicalJsonObject;
}

interface BoardPage {
  readonly items: readonly CanonicalJsonObject[];
  readonly nextCursor?: string;
  readonly snapshotAt: string;
  readonly sourceWatermarks: readonly CanonicalJsonObject[];
}

function verifyProjectRef(payload: CanonicalJsonObject): {
  readonly projectRef: CanonicalJsonObject;
  readonly scope: TaskBoardProjectScope;
} {
  const projectRef = object(payload.projectRef);
  requireThat(
    projectRef.kind === 'OBJECT' &&
      typeof projectRef.objectType === 'string' &&
      PROJECT_OBJECT_TYPES[projectRef.objectType] === true &&
      typeof projectRef.objectId === 'string' &&
      isUuidV7(projectRef.objectId),
    'REFERENCE_INVALID',
  );
  const scope = object(projectRef.scope);
  const enterpriseId = textValue(scope.enterpriseId);
  const projectId = textValue(scope.projectId);
  requireThat(
    isUuidV7(enterpriseId) && isUuidV7(projectId) && projectId === projectRef.objectId,
    'REFERENCE_INVALID',
  );
  return { projectRef, scope: { enterpriseId, projectId } };
}

function verifyDeliveryItemRef(
  value: CanonicalJsonValue | undefined,
  scope: TaskBoardProjectScope,
): CanonicalJsonObject | undefined {
  if (value === undefined) return undefined;
  const ref = object(value);
  requireThat(
    ref.kind === 'VERSIONED' &&
      typeof ref.objectType === 'string' &&
      DELIVERY_ITEM_OBJECT_TYPES[ref.objectType] === true &&
      typeof ref.objectId === 'string' &&
      typeof ref.versionId === 'string',
    'REFERENCE_INVALID',
  );
  const refScope = object(ref.scope);
  requireThat(
    refScope.enterpriseId === scope.enterpriseId && refScope.projectId === scope.projectId,
    'REFERENCE_INVALID',
  );
  return ref;
}

function applyFilters(
  rows: readonly TaskBoardSnapshotRow[],
  statuses: readonly string[],
  deliveryItemRef: CanonicalJsonObject | undefined,
): readonly TaskBoardSnapshotRow[] {
  const statusFilter: Readonly<Record<string, true>> = Object.fromEntries(
    statuses.map((status) => [status, true]),
  );
  return rows.filter((row) => {
    if (statusFilter[textValue(row.item.status)] !== true) return false;
    if (deliveryItemRef === undefined) return true;
    return taskBoardSameVersionedRef(row.filterKeys.deliveryItemRef, deliveryItemRef);
  });
}

function pageRows(
  rows: readonly TaskBoardSnapshotRow[],
  pageSize: number,
  lastTaskId: string | undefined,
): { readonly page: readonly TaskBoardSnapshotRow[]; readonly hasMore: boolean } {
  const ordered = [...rows].sort((left, right) =>
    compareTaskBoardTaskId(
      textValue(object(left.item.taskRef).objectId),
      textValue(object(right.item.taskRef).objectId),
    ),
  );
  const start =
    lastTaskId === undefined
      ? 0
      : ordered.findIndex((row) => textValue(object(row.item.taskRef).objectId) === lastTaskId) + 1;
  if (lastTaskId !== undefined && start === 0) fail('QUERY_CURSOR_SCOPE_MISMATCH');
  const window = ordered.slice(start, start + pageSize + 1);
  return { page: window.slice(0, pageSize), hasMore: window.length > pageSize };
}

function resultHashOf(envelope: CanonicalJsonObject): CanonicalJsonObject {
  return {
    algorithm: 'SHA-256',
    canonicalizationVersion: '1',
    digest: sha256CanonicalJson(envelope),
  };
}

function buildResult(
  queryId: string,
  status: string,
  stalenessStatus: TaskBoardStalenessStatus,
  data: BoardPage | undefined,
  now: Date,
): CanonicalJsonObject {
  const envelope: CanonicalJsonObject = {
    queryId,
    status,
    ...(data === undefined ? {} : { data: data as unknown as CanonicalJsonValue }),
    snapshotAt: data === undefined ? now.toISOString() : data.snapshotAt,
    sourceWatermarks: data === undefined ? [] : data.sourceWatermarks,
    stalenessStatus,
    redactions: [],
    ...(data?.nextCursor === undefined ? {} : { nextCursor: data.nextCursor }),
  };
  return { ...envelope, resultHash: resultHashOf(envelope) };
}

function baseClaims(
  projectRef: CanonicalJsonObject,
  filterHash: string,
  pageSize: number,
  consistency: TaskBoardConsistency,
  policy: TaskBoardPolicyResolution,
  ports: TaskBoardReadPorts,
  extras: Partial<TaskBoardCursorClaims>,
): TaskBoardCursorClaims {
  return {
    queryType: GET_TASK_BOARD_SLICE_QUERY,
    queryVersion: GET_TASK_BOARD_SLICE_VERSION,
    projectRef,
    requesterPurposeHash: sha256CanonicalJson({ purpose: TASK_BOARD_QUERY_PURPOSE }),
    authorizationSourceHash: ports.authorizationSourceHash,
    normalizedFilterHash: filterHash,
    pageSize,
    consistency,
    policyRef: policy.policyRef,
    policyContentHash: policy.policyContentHash,
    policyVersionRef: policy.policyVersionRef,
    snapshotAt: extras.snapshotAt ?? '',
    watermarkSequence: extras.watermarkSequence ?? 0,
    lastTaskId: extras.lastTaskId ?? '',
    issuedAt: extras.issuedAt ?? '',
    expiresAt: extras.expiresAt ?? '',
    ...(extras.asOf === undefined ? {} : { asOf: extras.asOf }),
    ...(extras.minimumWatermark === undefined ? {} : { minimumWatermark: extras.minimumWatermark }),
    ...(extras.generationId === undefined ? {} : { generationId: extras.generationId }),
    ...(extras.manifestHash === undefined ? {} : { manifestHash: extras.manifestHash }),
    ...(extras.sourceFingerprint === undefined
      ? {}
      : { sourceFingerprint: extras.sourceFingerprint }),
  };
}

/**
 * Execute one Board query and return the complete shared QueryResult Envelope.
 */
export async function handleGetTaskBoardSlice(
  input: TaskBoardQueryInput,
  ports: TaskBoardReadPorts,
): Promise<CanonicalJsonObject> {
  const payload = input.payload;
  const { projectRef, scope } = verifyProjectRef(payload);
  if (payload.assigneeRef !== undefined)
    boardError(
      'EXECUTION_CRITERION_UNSUPPORTED',
      'the first Board version does not support assignee filtering',
    );
  const statusValues = Array.isArray(payload.statuses)
    ? payload.statuses
    : fail('API_VALUE_INVALID');
  requireThat(statusValues.length > 0, 'API_VALUE_INVALID');
  const statuses = statusValues.map((value) => textValue(value));
  requireThat(new Set(statuses).size === statuses.length, 'API_VALUE_INVALID');
  const deliveryItemRef = verifyDeliveryItemRef(payload.deliveryItemRef, scope);
  const page = object(payload.page);
  const pageSize = Number(page.pageSize);
  requireThat(Number.isSafeInteger(pageSize) && pageSize > 0, 'API_VALUE_INVALID');
  const cursorValue = page.cursor === undefined ? undefined : textValue(page.cursor);

  const policy = await ports.resolveBoardPolicy(projectRef);
  if (pageSize > policy.rules.maxPageSize)
    boardError('API_VALUE_INVALID', 'pageSize exceeds the bound Task Board policy');
  const filterHash = taskBoardFilterHash({ statuses, deliveryItemRef });

  if (input.consistency === 'AUTHORITATIVE')
    return authorityRead(input, ports, {
      projectRef,
      scope,
      statuses,
      deliveryItemRef,
      pageSize,
      cursorValue,
      filterHash,
      policy,
    });
  return projectionRead(input, ports, {
    projectRef,
    scope,
    statuses,
    deliveryItemRef,
    pageSize,
    cursorValue,
    filterHash,
    policy,
  });
}

interface ReadContext {
  readonly projectRef: CanonicalJsonObject;
  readonly scope: TaskBoardProjectScope;
  readonly statuses: readonly string[];
  readonly deliveryItemRef: CanonicalJsonObject | undefined;
  readonly pageSize: number;
  readonly cursorValue: string | undefined;
  readonly filterHash: string;
  readonly policy: TaskBoardPolicyResolution;
}

async function authorityRead(
  input: TaskBoardQueryInput,
  ports: TaskBoardReadPorts,
  context: ReadContext,
): Promise<CanonicalJsonObject> {
  if (input.minimumWatermark !== undefined)
    boardError('API_VALUE_INVALID', 'minimumWatermark does not apply to an AUTHORITATIVE read');
  await ports.revalidateAuthorization();
  const snapshot = await ports.readAuthoritativeRows(context.scope, context.projectRef);
  let snapshotAt = snapshot.snapshotAt;
  let decoded: TaskBoardDecodedCursor | undefined;
  if (context.cursorValue !== undefined) {
    decoded = decodeTaskBoardCursor(context.cursorValue, ports.cursorKey, ports.now());
    requireThat(decoded.mode === 'AUTHORITY', 'QUERY_CURSOR_SCOPE_MISMATCH');
    assertTaskBoardCursorBinding(
      decoded,
      baseClaims(
        context.projectRef,
        context.filterHash,
        context.pageSize,
        'AUTHORITATIVE',
        context.policy,
        ports,
        {
          snapshotAt: decoded.snapshotAt,
          watermarkSequence: decoded.watermarkSequence,
          lastTaskId: decoded.lastTaskId,
          issuedAt: decoded.issuedAt,
          expiresAt: decoded.expiresAt,
          sourceFingerprint: snapshot.sourceFingerprint,
          ...(input.asOf === undefined ? {} : { asOf: input.asOf }),
        },
      ),
      ports.cursorKey,
    );
    if (input.asOf !== undefined && Date.parse(input.asOf) !== Date.parse(decoded.snapshotAt))
      fail('QUERY_CURSOR_SCOPE_MISMATCH');
    snapshotAt = new Date(decoded.snapshotAt);
  } else if (input.asOf !== undefined) {
    boardError('API_VALUE_INVALID', 'asOf requires a fixed cursor snapshot');
  }
  const filtered = applyFilters(snapshot.rows, context.statuses, context.deliveryItemRef);
  const window = pageRows(filtered, context.pageSize, decoded?.lastTaskId);
  const lastRow = window.page.at(-1);
  const lastTaskId =
    window.hasMore && lastRow !== undefined
      ? textValue(object(lastRow.item.taskRef).objectId)
      : undefined;
  const issuedAt = ports.now();
  const expiresAt = new Date(issuedAt.getTime() + context.policy.rules.cursorTtlSeconds * 1000);
  const nextCursor =
    lastTaskId === undefined
      ? undefined
      : encodeTaskBoardCursor(
          baseClaims(
            context.projectRef,
            context.filterHash,
            context.pageSize,
            'AUTHORITATIVE',
            context.policy,
            ports,
            {
              snapshotAt: snapshotAt.toISOString(),
              watermarkSequence: 0,
              lastTaskId,
              issuedAt: issuedAt.toISOString(),
              expiresAt: expiresAt.toISOString(),
              sourceFingerprint: snapshot.sourceFingerprint,
              ...(input.asOf === undefined ? {} : { asOf: input.asOf }),
            },
          ),
          ports.cursorKey,
        );
  await ports.revalidateAuthorization();
  return buildResult(
    input.queryId,
    'OK',
    'FRESH',
    {
      items: window.page.map((row) => row.item),
      ...(nextCursor === undefined ? {} : { nextCursor }),
      snapshotAt: snapshotAt.toISOString(),
      sourceWatermarks: [],
    },
    ports.now(),
  );
}

async function projectionRead(
  input: TaskBoardQueryInput,
  ports: TaskBoardReadPorts,
  context: ReadContext,
): Promise<CanonicalJsonObject> {
  await ports.revalidateAuthorization();
  const p1 = await ports.readProjection(context.scope);
  const health = await ports.readSourceHealth(context.scope);
  const p2 = await ports.readProjection(context.scope);
  const failure = await ports.readLatestFailure(context.scope);
  const now = ports.now();

  let decoded: TaskBoardDecodedCursor | undefined;
  let target: TaskBoardProjectionState | undefined;
  if (context.cursorValue !== undefined) {
    decoded = decodeTaskBoardCursor(context.cursorValue, ports.cursorKey, ports.now());
    requireThat(decoded.mode === 'GENERATION', 'QUERY_CURSOR_SCOPE_MISMATCH');
    const generationId = textValue(decoded.generationId);
    const cursorTarget = await ports.readGeneration(context.scope, generationId);
    if (cursorTarget.generation === undefined) fail('QUERY_CURSOR_SCOPE_MISMATCH');
    assertTaskBoardCursorBinding(
      decoded,
      baseClaims(
        context.projectRef,
        context.filterHash,
        context.pageSize,
        input.consistency,
        context.policy,
        ports,
        {
          snapshotAt: decoded.snapshotAt,
          watermarkSequence: decoded.watermarkSequence,
          lastTaskId: decoded.lastTaskId,
          issuedAt: decoded.issuedAt,
          expiresAt: decoded.expiresAt,
          generationId,
          manifestHash: cursorTarget.generation.manifestHash.toString('hex'),
          ...(input.asOf === undefined ? {} : { asOf: input.asOf }),
          ...(input.minimumWatermark === undefined
            ? {}
            : { minimumWatermark: input.minimumWatermark }),
        },
      ),
      ports.cursorKey,
    );
    target = cursorTarget;
  } else {
    target =
      input.asOf === undefined
        ? p1
        : await ports.findGenerationBySnapshotAt(context.scope, input.asOf);
  }
  if (
    input.asOf !== undefined &&
    new Date(input.asOf).toISOString() !== target?.generation?.snapshotAt.toISOString()
  )
    fail('QUERY_CURSOR_SCOPE_MISMATCH');
  const generation = target?.generation;
  // The freshness of a page is decided against the generation actually read,
  // so a retained historical generation (cursor or `asOf`) is never the alias.
  const readsCurrentAlias =
    generation !== undefined && p1.alias?.generationId === generation.generationId;
  const aliasChanged =
    (p1.alias !== undefined && p2.alias?.generationId !== p1.alias.generationId) ||
    (generation !== undefined && !readsCurrentAlias) ||
    (decoded !== undefined && p2.alias?.generationId !== decoded.generationId);
  // A failure only describes the current state until a newer generation is
  // published; a later successful publication clears it.
  const failureActive =
    failure !== undefined &&
    (generation === undefined || failure.recordedAt.getTime() > generation.publishedAt.getTime());

  let staleness: TaskBoardStalenessStatus;
  if (health === undefined) staleness = 'FAILED';
  else if (
    failureActive &&
    failure.failureCode !== 'TASK_BOARD_REBUILD' &&
    failure.failureCode !== 'TASK_BOARD_PAUSED'
  )
    staleness = 'FAILED';
  else if (failureActive) staleness = 'REBUILDING';
  else if (generation === undefined) staleness = 'REBUILDING';
  else if (aliasChanged) staleness = 'STALE';
  else if (health.pendingDirtyCount > 0) staleness = 'STALE';
  else if (p2.checkpoint?.lastPublishSequence !== p1.checkpoint?.lastPublishSequence)
    staleness = 'STALE';
  else if (
    now.getTime() - generation.snapshotAt.getTime() >
    context.policy.rules.freshnessMaxAgeSeconds * 1000
  )
    staleness = 'STALE';
  else staleness = 'FRESH';

  const watermarkMet =
    input.consistency === 'PROJECTION_OK' ||
    (generation?.publishSequence ?? 0) >= (input.minimumWatermark ?? 0);
  if (input.consistency === 'SNAPSHOT_AT_LEAST' && !watermarkMet && staleness === 'FRESH')
    staleness = 'STALE';
  const attachData =
    generation !== undefined &&
    (staleness === 'FRESH' ||
      (input.consistency === 'PROJECTION_OK' && watermarkMet) ||
      (input.consistency === 'SNAPSHOT_AT_LEAST' &&
        watermarkMet &&
        staleness !== 'FAILED' &&
        staleness !== 'REBUILDING'));
  const status = staleness === 'FRESH' ? 'OK' : staleness === 'FAILED' ? 'ERROR' : 'STALE';
  if (!attachData) {
    await ports.revalidateAuthorization();
    return buildResult(input.queryId, status, staleness, undefined, now);
  }
  const targetRows = target === undefined ? [] : target.rows;
  const filtered = applyFilters(
    targetRows.map((record) => record.row),
    context.statuses,
    context.deliveryItemRef,
  );
  const window = pageRows(filtered, context.pageSize, decoded?.lastTaskId);
  const lastRow = window.page.at(-1);
  const lastTaskId =
    window.hasMore && lastRow !== undefined
      ? textValue(object(lastRow.item.taskRef).objectId)
      : undefined;
  const issuedAt = ports.now();
  const expiresAt = new Date(
    Math.min(
      issuedAt.getTime() + context.policy.rules.cursorTtlSeconds * 1000,
      generation.retentionUntil.getTime(),
    ),
  );
  const nextCursor =
    lastTaskId === undefined
      ? undefined
      : encodeTaskBoardCursor(
          baseClaims(
            context.projectRef,
            context.filterHash,
            context.pageSize,
            input.consistency,
            context.policy,
            ports,
            {
              snapshotAt: generation.snapshotAt.toISOString(),
              watermarkSequence: generation.publishSequence,
              lastTaskId,
              issuedAt: issuedAt.toISOString(),
              expiresAt: expiresAt.toISOString(),
              generationId: generation.generationId,
              manifestHash: generation.manifestHash.toString('hex'),
              ...(input.asOf === undefined ? {} : { asOf: input.asOf }),
              ...(input.minimumWatermark === undefined
                ? {}
                : { minimumWatermark: input.minimumWatermark }),
            },
          ),
          ports.cursorKey,
        );
  await ports.revalidateAuthorization();
  return buildResult(
    input.queryId,
    status,
    staleness,
    {
      items: window.page.map((row) => row.item),
      ...(nextCursor === undefined ? {} : { nextCursor }),
      snapshotAt: generation.snapshotAt.toISOString(),
      sourceWatermarks: [
        {
          sourceModule: TASK_BOARD_SOURCE_MODULE,
          partition: `task_board:${context.scope.projectId}`,
          sequence: generation.publishSequence,
          observedAt: generation.snapshotAt.toISOString(),
        },
      ],
    },
    now,
  );
}
