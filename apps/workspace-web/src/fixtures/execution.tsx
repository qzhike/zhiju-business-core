// Explicit development events only. No timers, business requests or browser persistence.
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { MarkdownReviewPage, type MarkdownReviewData } from '../MarkdownReviewPage.js';
import { UnavailablePage } from '../workbench/navigation.js';
import { roundPath, candidatePath } from '../execution/model.js';
import { ExecutionPage, useExecutionMemory, type ExecutionPageProps } from '../execution/Page.js';
import type {
  ExecutionRound,
  ProgressFile,
  RetryIntent,
  RetryReceipt,
} from '../execution/model.js';
import type { WorkspaceData } from '../model.js';
const fixtureMarker = 'EXECUTION_DEVELOPMENT_EVENTS_ONLY';
const projectId = 'DEMO-PROJECT-01';
const requestId = 'WB-ROUND-01';
const file = (id: string, code: string, title: string): ProgressFile => ({
  id,
  code,
  title,
  state: 'WAITING',
  update: '范围已确认，等待安排',
  updatedAt: '2026-10-14 10:00（Asia/Shanghai）',
  failures: [],
  retryAllowed: false,
});
const initial: ExecutionRound = {
  projectId,
  requestId,
  label: '第 1 轮 · 程序文件',
  reportId: 'DEMO-STARTUP-REPORT-01',
  reportVersion: 1,
  confirmedFileIds: ['DEMO-CORR', 'DEMO-PREV'],
  files: [
    file('DEMO-CORR', 'QH-CX-08', '纠正措施程序'),
    file('DEMO-PREV', 'QH-CX-09', '预防措施程序'),
  ],
  summary: '合成范围已接收；未调用 Core 或 Runner。',
  logs: ['10:00 固定示例范围已接收'],
};
interface Adapter {
  rounds: readonly ExecutionRound[];
  add: (round: ExecutionRound) => void;
  update: (requestId: string, change: (round: ExecutionRound) => ExecutionRound) => void;
  intents: Map<string, RetryIntent>;
  pending: Map<string, () => void>;
  candidates: Map<string, { data: MarkdownReviewData; requestId: string }>;
}
const Context = createContext<Adapter | null>(null);
export function FixtureExecutionProvider({ children }: { children: ReactNode }) {
  const [rounds, setRounds] = useState<readonly ExecutionRound[]>([initial]);
  const [intents] = useState(() => new Map<string, RetryIntent>());
  const [pending] = useState(() => new Map<string, () => void>());
  const [candidates] = useState(
    () => new Map<string, { data: MarkdownReviewData; requestId: string }>(),
  );
  const remember = (round: ExecutionRound) => {
    for (const file of round.files) {
      const path = candidatePath(round, file);
      if (path && file.candidate && !candidates.has(path))
        candidates.set(path, { data: candidateExample(round, file), requestId: round.requestId });
    }
    return round;
  };
  return (
    <Context.Provider
      value={{
        rounds,
        intents,
        pending,
        candidates,
        add: (round) => {
          setRounds((previous) =>
            previous.some((item) => item.requestId === round.requestId)
              ? previous
              : [...previous, remember(round)],
          );
        },
        update: (id, change) => {
          setRounds((previous) =>
            previous.map((round) => (round.requestId === id ? remember(change(round)) : round)),
          );
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
function useAdapter() {
  const adapter = useContext(Context);
  if (!adapter) throw new Error(fixtureMarker);
  return adapter;
}
export function FixtureExecution({ data }: { data: WorkspaceData }) {
  const adapter = useAdapter();
  const params = useParams();
  const [phase, setPhase] = useState<NonNullable<ExecutionPageProps['phase']>>('AVAILABLE');
  const [outcome, setOutcome] = useState<'ACCEPTED' | 'UNKNOWN' | 'MISMATCH' | 'HOLD'>('UNKNOWN');
  const [queryOutcome, setQueryOutcome] = useState<'ACCEPTED' | 'UNKNOWN'>('UNKNOWN');
  const request = data.execution(params.requestId ?? '');
  // Existing confirmed shell requests enter the same page; elapsed time supplies no state.
  const stored: ExecutionRound | undefined =
    request && request.projectId === params.projectId
      ? {
          projectId: request.projectId,
          requestId: request.requestId,
          label: `已确认轮次 · 报告第 ${request.version} 版`,
          reportId: request.reportId,
          reportVersion: request.version,
          confirmedFileIds: request.fileIds,
          files: request.fileIds.map((id) => {
            const plan = data.reports
              .find((report) => report.reportId === request.reportId)
              ?.files.find((item) => item.id === id);
            return file(id, plan?.code ?? '', plan?.title ?? id);
          }),
          summary: '演示范围回执已记录，等待显式服务事件。',
          logs: ['已确认整份文件计划 · 演示'],
        }
      : undefined;
  const rounds =
    stored && !adapter.rounds.some((round) => round.requestId === stored.requestId)
      ? [...adapter.rounds, stored]
      : adapter.rounds;
  const current = rounds.find(
    (round) => round.projectId === params.projectId && round.requestId === params.requestId,
  );
  const change = (id: string, patch: Partial<ProgressFile>) => {
    if (!current) return;
    if (stored) adapter.add(stored);
    adapter.update(current.requestId, (round) => ({
      ...round,
      files: round.files.map((item) =>
        item.id === id
          ? { ...item, ...patch, updatedAt: '2026-10-14 10:05（Asia/Shanghai）' }
          : item,
      ),
      logs: [...round.logs, `10:05 ${id} 显式事件 ${patch.state ?? '更新'}`],
    }));
  };
  const receive = async (intent: RetryIntent): Promise<RetryReceipt> => {
    adapter.intents.set(intent.id, intent);
    if (outcome === 'HOLD')
      return new Promise((resolve) => {
        adapter.pending.set(intent.id, () => {
          resolve({ ...intent, state: 'UNKNOWN' });
          adapter.pending.delete(intent.id);
        });
      });
    return {
      ...intent,
      state: outcome === 'MISMATCH' ? 'ACCEPTED' : outcome,
      ...(outcome === 'MISMATCH' ? { fileId: 'WRONG-FILE' } : {}),
    };
  };
  const first = current?.confirmedFileIds[0];
  const second = current?.confirmedFileIds[1];
  return (
    <ExecutionPage
      rounds={rounds}
      phase={phase}
      reload={() => {
        setPhase('AVAILABLE');
      }}
      retry={receive}
      readRetry={(intent) =>
        Promise.resolve({
          ...intent,
          state: adapter.intents.has(intent.id) ? queryOutcome : 'UNKNOWN',
        })
      }
      controls={
        <details className="execution-controls">
          <summary>执行演示控制与边界</summary>
          <p className="muted">
            合成回执与进度，不表示真实业务成功 · {fixtureMarker} · 仅内存，不模拟自动成功
          </p>
          <div>
            <label>
              读取场景
              <select
                value={phase}
                onChange={(event) => {
                  setPhase(event.target.value as NonNullable<ExecutionPageProps['phase']>);
                }}
              >
                <option value="AVAILABLE">正常</option>
                <option value="ERROR">读取失败</option>
                <option value="EXPIRED">访问失效</option>
                <option value="LOADING">等待读取</option>
              </select>
            </label>
            <label>
              重试回执
              <select
                value={outcome}
                onChange={(event) => {
                  setOutcome(event.target.value as typeof outcome);
                }}
              >
                <option value="UNKNOWN">UNKNOWN</option>
                <option value="HOLD">等待回执</option>
                <option value="ACCEPTED">已接收</option>
                <option value="MISMATCH">错文件回执</option>
              </select>
            </label>
            <label>
              原请求查询结果
              <select
                value={queryOutcome}
                onChange={(event) => {
                  setQueryOutcome(event.target.value as typeof queryOutcome);
                }}
              >
                <option value="UNKNOWN">仍待核验</option>
                <option value="ACCEPTED">已接收等待安排</option>
              </select>
            </label>
            <button
              onClick={() => {
                for (const release of adapter.pending.values()) release();
              }}
            >
              返回待核验重试回执
            </button>
            <button
              onClick={() => {
                const files = Array.from({ length: 40 }, (_, index) =>
                  file(
                    `DEMO-LIST-${index + 1}`,
                    `LIST-${index + 1}`,
                    `合成长清单文件 ${index + 1}`,
                  ),
                );
                adapter.add({
                  ...initial,
                  requestId: 'WB-LONG-SCOPE',
                  label: '长清单范围示例',
                  confirmedFileIds: files.map((entry) => entry.id),
                  files,
                });
              }}
            >
              带入长清单示例
            </button>
            <button
              disabled={!current}
              onClick={() => {
                if (!current) return;
                if (stored) adapter.add(stored);
                adapter.update(current.requestId, (round) => ({
                  ...round,
                  files: round.files.map((item) => ({
                    ...item,
                    state: 'PROCESSING',
                    update: '显式服务事件：开始处理',
                  })),
                }));
              }}
            >
              模拟本轮实际处理
            </button>
            <button
              disabled={!first || !current}
              onClick={() => {
                if (first)
                  change(first, {
                    state: 'READY',
                    update: '精确候选已返回，可立即检查',
                    retryAllowed: false,
                    candidate: {
                      projectId: current.projectId,
                      requestId: current.requestId,
                      fileId: first,
                      revisionId: 'DEMO-REV-01',
                    },
                  });
              }}
            >
              模拟首份候选到达
            </button>
            <button
              disabled={!second}
              onClick={() => {
                if (second)
                  change(second, {
                    state: 'FAILED',
                    update: '本文件处理失败，其他结果保持',
                    failure: '源文件读取受限，处理未完成。',
                    failures: ['10:05 原运行：源文件读取受限'],
                    retryAllowed: true,
                  });
              }}
            >
              模拟第二份失败
            </button>
            <button
              disabled={!second}
              onClick={() => {
                if (second) change(second, { retryAllowed: false });
              }}
            >
              模拟撤回重试许可
            </button>
            <button
              disabled={!second}
              onClick={() => {
                if (second)
                  change(second, {
                    state: 'UNCERTAIN',
                    update: '进展信息已迟到，尚未核验当前状态',
                    retryAllowed: false,
                  });
              }}
            >
              模拟迟到信息
            </button>
            <button
              onClick={() => {
                adapter.add({
                  ...initial,
                  requestId: 'WB-SCOPE-02',
                  label: '第 2 轮 · 补充后的新增文件',
                  reportId: 'DEMO-STARTUP-REPORT-02',
                  reportVersion: 2,
                  confirmedFileIds: ['DEMO-MANUAL'],
                  files: [file('DEMO-MANUAL', 'QH-SC-01', '质量手册')],
                  summary: '固定示例：后轮已确认，等待安排；前轮状态保持。',
                  logs: ['10:03 固定后轮范围已确认'],
                });
              }}
            >
              带入已确认后轮示例
            </button>
            <button
              onClick={() => {
                adapter.update(requestId, (round) => ({
                  ...round,
                  files: round.files.map((item, index) =>
                    index === 0
                      ? {
                          ...item,
                          state: 'READY',
                          update: '前轮返回精确候选',
                          candidate: {
                            projectId,
                            requestId,
                            fileId: item.id,
                            revisionId: 'DEMO-REV-02',
                          },
                        }
                      : item,
                  ),
                }));
              }}
            >
              模拟前轮新候选到达
            </button>
            <button
              onClick={() => {
                adapter.add({
                  ...initial,
                  requestId: 'WB-EMPTY-SCOPE',
                  label: '空范围读取示例',
                  confirmedFileIds: [],
                  files: [],
                });
              }}
            >
              带入空范围示例
            </button>
          </div>
        </details>
      }
    />
  );
}

// Immutable anonymous candidate snapshots supplied only by explicit development events.
function candidateExample(round: ExecutionRound, file: ProgressFile): MarkdownReviewData {
  const candidate = file.candidate;
  if (!candidate) throw new Error('Missing fixed candidate');
  const hash = {
    algorithm: 'SHA-256' as const,
    digest: '0'.repeat(64),
    canonicalizationVersion: '1' as const,
  };
  const scope = { enterpriseId: 'DEMO-ENTERPRISE-01', projectId: round.projectId };
  const revisionRef = {
    kind: 'CONTENT_ADDRESSED' as const,
    objectType: 'artifact.artifact_revision' as const,
    objectId: candidate.revisionId,
    scope,
    contentHash: hash,
  };
  const paragraph = {
    unitId: 'example-paragraph',
    unitType: 'PARAGRAPH' as const,
    ordinal: 0,
    childUnitIds: [],
    text: `合成候选 ${candidate.revisionId}：用于验证逐份交回及阅读保护，不来自客户文件或 Runner。`,
    semanticMetadata: { markdown: {} },
  };
  return {
    content: {
      revisionRef,
      canonicalContentHash: hash,
      document: {
        documentId: 'fixed-document',
        title: `${file.title}（合成候选）`,
        units: [paragraph],
      },
      authoritativeIdentityMap: {
        artifactRef: {
          kind: 'OBJECT',
          objectType: 'artifact.artifact',
          objectId: file.id,
          scope,
        },
      },
      currentUsability: 'USABLE',
    },
    changes: {
      exactInputs: { toRevisionRef: revisionRef, baselineKind: 'EMPTY_INITIAL' },
      diffHash: hash,
      totalChanges: 1,
      changedUnitCount: 1,
      filteredChanges: 1,
      chapterGroups: [{ unitId: paragraph.unitId, title: '合成节选', changeCount: 1 }],
      entries: [
        {
          changeId: hash,
          unitId: paragraph.unitId,
          kind: 'ADDED',
          afterValue: paragraph,
          chapterUnitIds: [paragraph.unitId],
          contextUnitIds: [paragraph.unitId],
        },
      ],
    },
  };
}
export function FixtureExecutionReview() {
  const { projectId = '', fileId = '', revisionId = '' } = useParams();
  const adapter = useAdapter();
  const memory = useExecutionMemory();
  const path = `/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/revisions/${encodeURIComponent(revisionId)}`;
  const snapshot = adapter.candidates.get(path);
  const source = adapter.rounds.find(
    (round) => round.projectId === projectId && round.requestId === snapshot?.requestId,
  );
  if (!snapshot || !source)
    return (
      <UnavailablePage
        title="检查文件"
        reason="未取得此精确候选的固定样例，不能借用其他版本正文。"
      />
    );
  return (
    <>
      <p className="notice">
        仅开发合成候选 · 无真实正文接纳、保存、批准或交付；示例 Hash 不是业务证明。
      </p>
      <Link to={memory.candidateReturns.get(path) ?? roundPath(source)}>返回本轮文件进度</Link>
      <MarkdownReviewPage
        data={snapshot.data}
        hasRepresentation={false}
        busy={false}
        downloadStatus=""
        directoryStatus=""
        onDownload={() => Promise.resolve()}
        onMore={() => Promise.resolve()}
      />
      <details className="execution-controls">
        <summary>候选到达演示事件</summary>
        <button
          onClick={() => {
            adapter.update(source.requestId, (round) => ({
              ...round,
              files: round.files.map((file) =>
                file.id === fileId
                  ? {
                      ...file,
                      state: 'READY',
                      candidate: {
                        projectId,
                        requestId: source.requestId,
                        fileId,
                        revisionId: 'DEMO-REV-02',
                      },
                      update: '新的精确候选已到达，当前阅读版本保持',
                    }
                  : file,
              ),
            }));
          }}
        >
          模拟阅读期间新候选到达
        </button>
      </details>
    </>
  );
}
