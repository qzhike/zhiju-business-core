import { describe, expect, it, vi } from 'vitest';
import { boardCards, chainNotice } from './trusted-adapter.js';
import { destinationPath, selectedProjectKey, workbenchPath } from './model.js';
import { initialPageState } from '../trusted/pagination.js';
import type { PageChain } from '../trusted/hooks.js';
import type { BoardRow, DirectoryCard } from '../trusted/protocol.js';

const project: DirectoryCard = {
  key: 'project:e/p',
  enterpriseId: 'e',
  projectId: 'p',
  enterpriseRef: {},
  projectRef: {},
  enterpriseDisplayName: '客户',
  title: '项目',
  displayCode: 'P-1',
  aggregateVersion: 2,
  status: 'ACTIVE',
};
const chain = (statuses: string[]): PageChain<BoardRow> => ({
  state: {
    ...initialPageState<BoardRow>(),
    dataState: 'READY',
    terminal: true,
    items: statuses.map((status, index) => ({
      key: `task-${index}`,
      title: status,
      status,
      version: 7,
      secondary: null,
      blockers: 0,
    })),
  },
  failureCode: null,
  failureKind: null,
  retryable: false,
  reload: vi.fn(),
  loadMore: vi.fn(),
});

describe('workbench presentation boundaries', () => {
  it('preserves exact task identity and version without manufacturing candidates or requests', () => {
    const cards = boardCards(
      project,
      chain(['WAITING_INPUT', 'IN_REVIEW', 'COMPLETED', 'COMPLETION_PENDING', 'READY']),
      'task',
    );
    expect(cards.map((card) => card.group)).toEqual([
      'attention',
      'attention',
      'done',
      'running',
      'waiting',
    ]);
    const first = cards[0];
    if (!first) throw new Error('Missing first card');
    expect(destinationPath(first.action.destination)).toBe('/projects/p/tasks/task-0?version=7');
    expect(
      cards.every((card) => card.counts === undefined && card.secondaryAction === undefined),
    ).toBe(true);
    expect(cards[2]?.reason).toContain('不表示项目已发布或交付');
  });

  it('keeps approved and released outputs distinct from delivery completion and unknown states visible', () => {
    const cards = boardCards(
      project,
      chain(['APPROVED_OUTPUT', 'RELEASED', 'COMPLETED', 'FUTURE_STATUS']),
      'delivery-item',
    );
    expect(cards.map((card) => card.group)).toEqual(['running', 'running', 'done', 'attention']);
    expect(cards[3]?.status).toBe('状态待核实');
    const first = cards[0];
    if (!first) throw new Error('Missing first card');
    expect(destinationPath(first.action.destination)).toBe('/projects/p/delivery?item=task-0');
  });

  it('removes previously returned rows on denied reads instead of presenting an empty or offline result', () => {
    const denied = chain(['IN_PROGRESS']);
    const failure: PageChain<BoardRow> = {
      ...denied,
      state: { ...denied.state, dataState: 'ERROR' },
      failureKind: 'DENIED',
      failureCode: 'ACCESS_DENIED',
    };
    expect(boardCards(project, failure, 'task')).toEqual([]);
    expect(chainNotice('tasks', '任务看板', failure)).toMatchObject({
      state: 'ERROR',
      detail: expect.stringContaining('无权读取'),
    });
  });

  it('describes incomplete and stale observations without a global denominator', () => {
    const partial = chain(['IN_PROGRESS']);
    const notice = chainNotice('tasks', '任务看板', {
      ...partial,
      state: {
        ...partial.state,
        terminal: false,
        enumerating: true,
        observation: {
          resultStatus: 'STALE',
          freshness: 'STALE',
          snapshotAt: '2026-10-13T01:00:00Z',
          sourceWatermarks: [{ sourceModule: 'task-execution', sequence: 41, observedAt: null }],
        },
      },
    });
    expect(notice.detail).toContain('本次读取 1 条 · 仅部分结果');
    expect(notice.observation).toContain('滞后');
    expect(notice.observation).toContain('task-execution#41');
    expect(notice.action?.label).toBe('继续读取');
  });

  it('round trips project selection and exact revisions using navigation identifiers only', () => {
    expect(selectedProjectKey(workbenchPath(project).split('?')[1] ?? '')).toBe(project.key);
    expect(selectedProjectKey('?enterprise=e&project=../../secret')).toBeNull();
    expect(
      destinationPath({ kind: 'file', projectId: 'p', fileId: 'file-1', revisionId: 'revision-3' }),
    ).toBe('/projects/p/files/file-1/revisions/revision-3');
    expect(destinationPath({ kind: 'analysis', projectId: 'p', reportId: 'report-2' })).toBe(
      '/projects/p/analysis/report-2',
    );
  });
});
