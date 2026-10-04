import { describe, expect, it } from 'vitest';
import { handleGetTaskBoardSlice, type TaskBoardReadPorts } from './task-board-read.js';
import { taskBoardRowsHash, type TaskBoardSnapshotRow } from './task-board-types.js';
import type { TaskBoardProjectionState } from '../persistence/task-board-projection-repository.js';

const enterpriseId = '0199b600-0000-7000-8000-000000000301';
const projectId = '0199b600-0000-7000-8000-000000000302';
const projectRef = {
  kind: 'OBJECT',
  objectType: 'zhiju.project.project',
  objectId: projectId,
  scope: { enterpriseId, projectId },
};
const policyRef = {
  kind: 'VERSIONED',
  objectType: 'zhiju.identity.policy',
  objectId: '0199b600-0000-7000-8000-000000000303',
  versionId: '0199b600-0000-7000-8000-000000000304',
  scope: { enterpriseId, projectId },
};
const policyVersionRef = {
  kind: 'SNAPSHOT',
  objectType: 'zhiju.identity.policy_version',
  objectId: '0199b600-0000-7000-8000-000000000305',
  snapshotId: '0199b600-0000-7000-8000-000000000306',
  scope: { enterpriseId, projectId },
};
const taskIds = [
  '0199b600-0000-7000-8000-000000000001',
  '0199b600-0000-7000-8000-000000000002',
  '0199b600-0000-7000-8000-000000000003',
];
const deliveryItemRef = {
  kind: 'VERSIONED',
  objectType: 'zhiju.project.delivery_item',
  objectId: '0199b600-0000-7000-8000-000000000401',
  versionId: '0199b600-0000-7000-8000-000000000402',
  scope: { enterpriseId, projectId },
};

function row(index: number, status: string, bound = true): TaskBoardSnapshotRow {
  return {
    item: {
      taskRef: {
        kind: 'OBJECT',
        objectType: 'zhiju.execution.task',
        objectId: taskIds[index] ?? '0199b600-0000-7000-8000-000000000000',
        scope: { enterpriseId, projectId },
      },
      aggregateVersion: 1,
      title: `Task ${index}`,
      status,
      blockerRefs: [],
      activeWorkOrderRefs: [],
    },
    filterKeys: bound ? { deliveryItemRef } : {},
  };
}

const rows = [row(0, 'READY'), row(1, 'DRAFT'), row(2, 'READY')];
const snapshotAt = new Date('2026-10-05T00:00:00.000Z');

function projectionState(withRows = rows): TaskBoardProjectionState {
  return {
    alias: {
      generationId: '0199b600-0000-7000-8000-000000000501',
      publishSequence: 1,
      switchedAt: snapshotAt,
    },
    checkpoint: {
      lastGenerationId: '0199b600-0000-7000-8000-000000000501',
      lastPublishSequence: 1,
      lastExportId: '0199b600-0000-7000-8000-000000000502',
    },
    generation: {
      generationId: '0199b600-0000-7000-8000-000000000501',
      manifestHash: Buffer.alloc(32, 1),
      rowsHash: Buffer.from(taskBoardRowsHash(withRows), 'hex'),
      rowCount: withRows.length,
      publishSequence: 1,
      publishedAt: snapshotAt,
      retentionUntil: new Date(snapshotAt.getTime() + 3_600_000),
      policyObservation: {
        policyRef,
        policyVersionRef,
        contentHash: 'a'.repeat(64),
        effectiveFrom: '2026-10-04T00:00:00.000Z',
      },
      snapshotAt,
    },
    rows: withRows.map((value, index) => ({ taskId: taskIds[index] ?? String(index), row: value })),
  };
}

function ports(overrides: Partial<TaskBoardReadPorts> = {}): TaskBoardReadPorts {
  const base: TaskBoardReadPorts = {
    now: () => new Date('2026-10-05T00:10:00.000Z'),
    cursorKey: { keyId: 3, secret: Buffer.alloc(32, 3) },
    authorizationSourceHash: 'b'.repeat(64),
    resolveBoardPolicy: () =>
      Promise.resolve({
        policyRef,
        policyVersionRef,
        policyContentHash: 'a'.repeat(64),
        policyObservation: {
          policyRef,
          policyVersionRef,
          contentHash: 'a'.repeat(64),
          effectiveFrom: '2026-10-04T00:00:00.000Z',
        },
        rules: {
          maxPageSize: 100,
          maxSnapshotRows: 1000,
          maxSnapshotBytes: 4_194_304,
          freshnessMaxAgeSeconds: 3600,
          cursorTtlSeconds: 3600,
          refreshIntervalSeconds: 60,
          workerLeaseSeconds: 60,
        },
      }),
    readProjection: () => Promise.resolve(projectionState()),
    readGeneration: () => Promise.resolve(projectionState()),
    findGenerationBySnapshotAt: () => Promise.resolve(projectionState()),
    readLatestFailure: () => Promise.resolve(undefined),
    readSourceHealth: () =>
      Promise.resolve({ pendingDirtyCount: 0, leaseToken: 0, leaseUntil: null }),
    readAuthoritativeRows: () =>
      Promise.resolve({
        rows,
        sources: [],
        sourceFingerprint: 'c'.repeat(64),
        snapshotAt,
      }),
    revalidateAuthorization: () => Promise.resolve(undefined),
  };
  return { ...base, ...overrides };
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    queryId: '0199b600-0000-7000-8000-000000000601',
    consistency: 'PROJECTION_OK' as const,
    payload: {
      projectRef,
      statuses: ['READY', 'DRAFT'],
      page: { pageSize: 2 },
      ...overrides,
    },
  };
}

describe('Task Board handler', () => {
  it('reads a FRESH generation and pages without duplicates or omissions', async () => {
    const first = await handleGetTaskBoardSlice(query(), ports());
    expect(first.status).toBe('OK');
    expect(first.stalenessStatus).toBe('FRESH');
    const firstPage = first.data as Record<string, unknown>;
    expect((firstPage.items as unknown[]).length).toBe(2);
    const cursor = String(firstPage.nextCursor);

    const second = await handleGetTaskBoardSlice(query({ page: { pageSize: 2, cursor } }), ports());
    const secondPage = second.data as Record<string, unknown>;
    expect((secondPage.items as unknown[]).length).toBe(1);
    expect(secondPage.nextCursor).toBeUndefined();
    const seen = [
      ...(firstPage.items as Record<string, unknown>[]),
      ...(secondPage.items as Record<string, unknown>[]),
    ].map((item) => (item.taskRef as Record<string, unknown>).objectId);
    expect(new Set(seen).size).toBe(3);
  });

  it('filters by an exact DeliveryItem version before paging', async () => {
    const result = await handleGetTaskBoardSlice(
      query({ deliveryItemRef, page: { pageSize: 10 } }),
      ports(),
    );
    expect(((result.data as Record<string, unknown>).items as unknown[]).length).toBe(3);
    const other = { ...deliveryItemRef, versionId: '0199b600-0000-7000-8000-000000000499' };
    const empty = await handleGetTaskBoardSlice(
      query({ deliveryItemRef: other, page: { pageSize: 10 } }),
      ports(),
    );
    expect(((empty.data as Record<string, unknown>).items as unknown[]).length).toBe(0);
  });

  it('rejects the unsupported assignee filter instead of returning a fake empty page', async () => {
    await expect(
      handleGetTaskBoardSlice(
        query({
          assigneeRef: {
            kind: 'OBJECT',
            objectType: 'zhiju.identity.principal',
            objectId: enterpriseId,
            scope: { enterpriseId },
          },
        }),
        ports(),
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_CRITERION_UNSUPPORTED' });
  });

  it('reports pending dirty markers as STALE without hiding the retained data', async () => {
    const result = await handleGetTaskBoardSlice(
      query(),
      ports({
        readSourceHealth: () =>
          Promise.resolve({ pendingDirtyCount: 2, leaseToken: 0, leaseUntil: null }),
      }),
    );
    expect(result.status).toBe('STALE');
    expect(result.stalenessStatus).toBe('STALE');
    expect(result.data).toBeDefined();
  });

  it('reports an unavailable source health as FAILED and never as FRESH', async () => {
    const result = await handleGetTaskBoardSlice(
      query(),
      ports({ readSourceHealth: () => Promise.resolve(undefined) }),
    );
    expect(result.status).toBe('ERROR');
    expect(result.stalenessStatus).toBe('FAILED');
    expect(result.status).not.toBe('OK');
    expect(result.status).not.toBe('STALE');
  });

  it('never satisfies an unmet minimum watermark with an older page', async () => {
    const result = await handleGetTaskBoardSlice(
      { ...query(), consistency: 'SNAPSHOT_AT_LEAST', minimumWatermark: 5 },
      ports(),
    );
    expect(result.status).toBe('STALE');
    expect(result.stalenessStatus).toBe('STALE');
    expect(result.data).toBeUndefined();
  });

  it('continues AUTHORITATIVE paging from the cursor last task id', async () => {
    const first = await handleGetTaskBoardSlice(
      {
        queryId: '0199b600-0000-7000-8000-000000000601',
        consistency: 'AUTHORITATIVE',
        payload: query().payload,
      },
      ports(),
    );
    const firstPage = first.data as Record<string, unknown>;
    expect((firstPage.items as unknown[]).length).toBe(2);
    const cursor = String(firstPage.nextCursor);
    const second = await handleGetTaskBoardSlice(
      {
        queryId: '0199b600-0000-7000-8000-000000000601',
        consistency: 'AUTHORITATIVE',
        payload: { ...query().payload, page: { pageSize: 2, cursor } },
      },
      ports(),
    );
    const secondPage = second.data as Record<string, unknown>;
    expect((secondPage.items as unknown[]).length).toBe(1);
    expect(secondPage.nextCursor).toBeUndefined();
    const seen = [
      ...(firstPage.items as Record<string, unknown>[]),
      ...(secondPage.items as Record<string, unknown>[]),
    ].map((item) => (item.taskRef as Record<string, unknown>).objectId);
    expect(new Set(seen).size).toBe(3);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]{16,512}$/u);
  });

  it('reports a retained historical generation as at least STALE', async () => {
    const historicalSnapshotAt = new Date('2026-10-04T00:00:00.000Z');
    const result = await handleGetTaskBoardSlice(
      {
        queryId: '0199b600-0000-7000-8000-000000000601',
        consistency: 'PROJECTION_OK',
        asOf: historicalSnapshotAt.toISOString(),
        payload: query().payload,
      },
      ports({
        findGenerationBySnapshotAt: () => {
          const state = projectionState();
          const generation = state.generation;
          if (generation === undefined) return Promise.resolve(state);
          return Promise.resolve({
            ...state,
            generation: { ...generation, snapshotAt: historicalSnapshotAt },
          });
        },
      }),
    );
    expect(result.status).toBe('STALE');
    expect(result.stalenessStatus).toBe('STALE');
  });

  it('reports a recent export failure as FAILED until a newer generation publishes', async () => {
    const failed = await handleGetTaskBoardSlice(
      query(),
      ports({
        readLatestFailure: () =>
          Promise.resolve({
            failureCode: 'TASK_BOARD_EXPORT_BUDGET_EXCEEDED',
            recordedAt: new Date('2026-10-05T00:05:00.000Z'),
          }),
      }),
    );
    expect(failed.status).toBe('ERROR');
    expect(failed.stalenessStatus).toBe('FAILED');
    const cleared = await handleGetTaskBoardSlice(
      query(),
      ports({
        readLatestFailure: () =>
          Promise.resolve({
            failureCode: 'TASK_BOARD_EXPORT_BUDGET_EXCEEDED',
            recordedAt: new Date('2020-01-01T00:00:00.000Z'),
          }),
      }),
    );
    expect(cleared.status).toBe('OK');
    expect(cleared.stalenessStatus).toBe('FRESH');
  });

  it('reads the owning source for an AUTHORITATIVE request', async () => {
    const result = await handleGetTaskBoardSlice(
      {
        queryId: '0199b600-0000-7000-8000-000000000601',
        consistency: 'AUTHORITATIVE',
        payload: query().payload,
      },
      ports(),
    );
    expect(result.status).toBe('OK');
    expect(result.stalenessStatus).toBe('FRESH');
    expect(result.sourceWatermarks).toEqual([]);
    expect((result.data as Record<string, unknown>).snapshotAt).toBe(snapshotAt.toISOString());
  });
});
