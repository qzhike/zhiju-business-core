// Explicit development-only review workspace (#286). Synthetic content only:
// it never reads customer documents, calls Core/Runner or claims success.
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { MarkdownReviewPage } from '../MarkdownReviewPage.js';
import type {
  ReviewBaselineOption,
  ReviewDraftState,
  ReviewFileDirectory,
  ReviewFileEntry,
  ReviewSubmission,
  ReviewSuggestion,
} from '../review/model.js';
import { manualCandidate, workspaceCandidate } from './review-data.js';

export const reviewFixtureMarker = 'REVIEW_DEVELOPMENT_WORKSPACE_ONLY';

export const reviewWorkspaceFiles: readonly ReviewFileEntry[] = [
  {
    fileId: 'DEMO-WS-PREV',
    code: 'QP23',
    title: '预防措施程序',
    state: 'READY',
    detail: '整理稿 · 36 处修改示例',
    openable: true,
  },
  ...Array.from({ length: 199 }, (_, position): ReviewFileEntry => {
    const index = position + 2;
    return {
      fileId: `DEMO-WS-${String(index).padStart(3, '0')}`,
      code: `QH-${String(index).padStart(3, '0')}`,
      title: `合成长清单文件 ${index}`,
      state: index % 7 === 0 ? 'FAILED' : index % 5 === 0 ? 'PROCESSING' : 'WAITING',
      detail: '本示例不提供合成候选',
      openable: false,
    };
  }),
  {
    fileId: 'DEMO-WS-MANUAL',
    code: 'QH-SC-01',
    title: '质量手册',
    state: 'READY',
    detail: '合成候选可直接检查',
    openable: true,
  },
];

const workspaceRevisions: Record<string, readonly string[]> = {
  'DEMO-WS-PREV': ['DEMO-WS-REV-01', 'DEMO-WS-REV-02'],
  'DEMO-WS-MANUAL': ['DEMO-WS-MANUAL-01'],
};

export type ReceiptOutcome = 'unknown' | 'accepted' | 'running' | 'mismatch';
export type ApprovalOutcome = 'hold' | 'accepted' | 'unknown' | 'mismatch';

interface Receipt {
  id: string;
  status: 'UNKNOWN' | 'ACCEPTED' | 'RUNNING';
  originalText: string;
  originalSuggestion?: { name: string; baselineLabel: string };
  automatic: number;
  budget: number;
  queries: number;
  submittedAt: number;
  querying: boolean;
  note: string;
}

interface ReviewMemory {
  drafts: Map<string, { text: string; state: ReviewDraftState; note: string }>;
  suggestions: Map<string, { name: string; text: string; baselineId?: string; error?: string }>;
  receipts: Map<string, Receipt>;
  approvals: Map<string, 'PENDING' | 'UNKNOWN' | 'MISMATCH'>;
  approved: Set<string>;
  recheck: Set<string>;
  candidates: Set<string>;
  revision: Map<string, string>;
  draftOutcome: ReviewDraftState;
  receiptOutcome: ReceiptOutcome;
  approvalOutcome: ApprovalOutcome;
  download: 'AVAILABLE' | 'UNAVAILABLE';
  downloadStatus: string;
  fileState: 'ALL' | ReviewFileEntry['state'];
  fileQuery: string;
  loadedFiles: number;
  currentFileId: string;
  fileStatus: string;
}

export interface ReviewFixtureApi {
  memory: ReviewMemory;
  notify: () => void;
  draft: (key: string) => { text: string; state: ReviewDraftState; note: string };
  changeDraft: (key: string, text: string) => void;
  applySaveReceipt: () => void;
  suggestion: (
    key: string,
    latest: string,
    options: readonly ReviewBaselineOption[],
  ) => ReviewSuggestion | undefined;
  submission: (key: string) => ReviewSubmission | undefined;
  submit: (key: string) => void;
  query: (key: string, automatic: boolean) => void;
  approve: (key: string) => void;
  applyApprovalReceipt: (key: string) => void;
  attachSuggestion: (key: string, file: { name: string; text: string }) => void;
  removeSuggestion: (key: string) => void;
  selectBaseline: (key: string, id: string) => void;
}

export interface ReviewFixture extends ReviewFixtureApi {
  /** Monotonic counter: a changed value re-renders every fixture consumer. */
  version: number;
}
const Context = createContext<ReviewFixture | null>(null);

export function ReviewFixtureProvider({ children }: { children: ReactNode }) {
  const [version, bump] = useState(0);
  const timers = useRef(new Map<string, number>());
  const [memory] = useState<ReviewMemory>(() => ({
    drafts: new Map(),
    suggestions: new Map(),
    receipts: new Map(),
    approvals: new Map(),
    approved: new Set(),
    recheck: new Set(),
    candidates: new Set(),
    revision: new Map(
      Object.entries(workspaceRevisions).map(([fileId, revisions]) => [
        fileId,
        requiredValue(revisions.at(0)),
      ]),
    ),
    draftOutcome: 'SAVED',
    receiptOutcome: 'unknown',
    approvalOutcome: 'hold',
    download: 'AVAILABLE',
    downloadStatus: '',
    fileState: 'ALL',
    fileQuery: '',
    loadedFiles: 40,
    currentFileId: 'DEMO-WS-PREV',
    fileStatus: '本轮共 201 份文件（合成目录）',
  }));
  const [api] = useState<ReviewFixtureApi>(() => {
    const notify = () => {
      bump((current) => current + 1);
    };
    const query = (key: string, automatic: boolean) => {
      const receipt = memory.receipts.get(key);
      if (receipt?.status !== 'UNKNOWN' || receipt.querying) return;
      receipt.querying = true;
      receipt.queries += 1;
      if (automatic) receipt.automatic += 1;
      notify();
      window.setTimeout(() => {
        const current = memory.receipts.get(key);
        if (current?.status !== 'UNKNOWN') return;
        current.querying = false;
        if (memory.receiptOutcome === 'accepted' || memory.receiptOutcome === 'running') {
          current.status = memory.receiptOutcome === 'running' ? 'RUNNING' : 'ACCEPTED';
          current.note = '演示回执与原提交上下文匹配。';
          // Only the unchanged submitted input retires into the frozen snapshot.
          const draft = memory.drafts.get(key);
          if (draft?.text === current.originalText)
            memory.drafts.set(key, {
              text: '',
              state: 'SAVED',
              note: '已提交的内容已冻结；这里是新的下轮草稿',
            });
        } else if (memory.receiptOutcome === 'mismatch') {
          current.note = '查询结果与本提交上下文不匹配；既不是失败也不是成功，原请求保持不变。';
        } else {
          current.note =
            current.automatic >= current.budget
              ? '自动核验已结束，暂未取得确认；可以按原请求重新查询（不会重发意见）。'
              : '未收到本次提交的回执，仍在按原请求自动核验。';
        }
        notify();
        schedule(key);
      }, 250);
    };
    const schedule = (key: string) => {
      const receipt = memory.receipts.get(key);
      if (receipt?.status !== 'UNKNOWN' || timers.current.has(key)) return;
      const withinBudget =
        receipt.automatic < receipt.budget && Date.now() < receipt.submittedAt + 10_000;
      if (!withinBudget) {
        notify();
        return;
      }
      timers.current.set(
        key,
        window.setTimeout(() => {
          timers.current.delete(key);
          query(key, true);
        }, 700),
      );
    };
    const advance = () => {
      memory.currentFileId = 'DEMO-WS-MANUAL';
      memory.fileStatus = '匹配批准成功（演示）；已进入下一份待检查文件。';
      notify();
    };
    const applyApproval = (key: string) => {
      if (!memory.approvals.has(key)) return;
      memory.approvals.delete(key);
      if (memory.approvalOutcome === 'accepted') {
        memory.approved.add(key);
        advance();
        return;
      }
      if (memory.approvalOutcome === 'hold') {
        notify();
        return;
      }
      memory.approvals.set(key, memory.approvalOutcome === 'mismatch' ? 'MISMATCH' : 'UNKNOWN');
      notify();
    };
    return {
      memory,
      notify,
      draft: (key) => memory.drafts.get(key) ?? { text: '', state: 'SAVED', note: '尚未输入意见' },
      changeDraft: (key, text) => {
        memory.drafts.set(key, {
          text,
          state: text ? 'SAVING' : 'SAVED',
          note: text ? '正在自动保存到服务器个人草稿（演示）' : '尚未输入意见',
        });
        notify();
      },
      applySaveReceipt: () => {
        for (const [key, entry] of memory.drafts) {
          if (entry.state !== 'SAVING') continue;
          memory.drafts.set(key, {
            ...entry,
            state: memory.draftOutcome,
            note:
              memory.draftOutcome === 'SAVED'
                ? '服务器已保存此个人草稿（演示）'
                : memory.draftOutcome === 'UNSAVED'
                  ? '保存失败；输入保留在本页，尚未保存到服务器。'
                  : memory.draftOutcome === 'CONFLICT'
                    ? '另一设备已保存不同内容；两个草稿都保留，需核对后显式选择。'
                    : '保存结果待核验；仍在按原保存请求查询。',
          });
        }
        notify();
      },
      suggestion: (key, latest, options) => {
        const entry = memory.suggestions.get(key);
        if (!entry) return undefined;
        return {
          name: entry.name,
          text: entry.text,
          byteLength: new TextEncoder().encode(entry.text).length,
          baseline: {
            options,
            ...(entry.baselineId ? { selectedId: entry.baselineId } : {}),
          },
          latestLabel: latest,
          ...(entry.error
            ? { error: entry.error }
            : entry.text
              ? {}
              : { error: '未能读取该文件；请确认它是 UTF-8 的 .md 或 .markdown 文件。' }),
          note: '上传只在本页作为建议复核；不会直接改写或覆盖已批准的文件。',
        };
      },
      removeSuggestion: (key) => {
        memory.suggestions.delete(key);
        notify();
      },
      selectBaseline: (key, id) => {
        const entry = memory.suggestions.get(key);
        if (entry)
          memory.suggestions.set(key, {
            ...entry,
            baselineId: id,
            ...(entry.error ? { error: entry.error } : {}),
          });
        notify();
      },
      attachSuggestion: (key, file) => {
        const previous = memory.suggestions.get(key);
        if (!file.text) {
          memory.suggestions.set(key, {
            name: file.name,
            text: previous?.text ?? '',
            ...(previous?.baselineId ? { baselineId: previous.baselineId } : {}),
            error:
              '未能读取该文件；请确认它是 UTF-8 的 .md 或 .markdown 文件。原附件与意见保持不变。',
          });
          notify();
          return;
        }
        memory.suggestions.set(key, {
          name: file.name,
          text: file.text,
          ...(previous?.baselineId ? { baselineId: previous.baselineId } : {}),
        });
        notify();
      },
      submission: (key) => {
        const receipt = memory.receipts.get(key);
        if (!receipt) return undefined;
        return {
          status: receipt.status,
          requestLabel: receipt.id,
          originalText: receipt.originalText,
          ...(receipt.originalSuggestion ? { originalSuggestion: receipt.originalSuggestion } : {}),
          queries: { automatic: receipt.automatic, budget: receipt.budget },
          querying: receipt.querying,
          canQuery:
            receipt.status === 'UNKNOWN' &&
            !receipt.querying &&
            (receipt.automatic >= receipt.budget || Date.now() >= receipt.submittedAt + 10_000),
          note: `${receipt.note} · 已查询 ${receipt.queries} 次（演示）`,
        };
      },
      submit: (key) => {
        const draft = memory.drafts.get(key) ?? { text: '', state: 'SAVED' as const, note: '' };
        const suggestion = memory.suggestions.get(key);
        const baseline = suggestion?.baselineId;
        const receipt: Receipt = {
          id: `DEMO-REQUEST-${memory.receipts.size + 1}`,
          status: 'UNKNOWN',
          originalText: draft.text,
          ...(suggestion && baseline
            ? {
                originalSuggestion: {
                  name: suggestion.name,
                  baselineLabel: `第 ${
                    (workspaceRevisions['DEMO-WS-PREV']?.indexOf(baseline) ?? 0) + 1
                  } 版`,
                },
              }
            : {}),
          automatic: 0,
          budget: 3,
          queries: 0,
          submittedAt: Date.now(),
          querying: false,
          note: '演示：提交后未收到回执；只查询这一次原提交。',
        };
        memory.receipts.set(key, receipt);
        memory.suggestions.delete(key);
        memory.drafts.set(key, {
          ...draft,
          state: 'SAVED',
          note: '本次提交已冻结；可继续写下轮草稿',
        });
        notify();
        schedule(key);
      },
      query,
      approve: (key) => {
        if (memory.approvals.has(key) || memory.approved.has(key)) return;
        memory.approvals.set(key, 'PENDING');
        notify();
        if (memory.approvalOutcome === 'hold') return;
        window.setTimeout(() => {
          applyApproval(key);
        }, 250);
      },
      applyApprovalReceipt: (key) => {
        applyApproval(key);
      },
    };
  });
  return <Context.Provider value={{ ...api, version }}>{children}</Context.Provider>;
}

export function useReviewFixture(): ReviewFixture {
  const fixture = useContext(Context);
  if (!fixture) throw new Error(reviewFixtureMarker);
  return fixture;
}

/** Owning directory for the synthetic 201-file work-file list. */
export function fixtureFileList(memory: ReviewMemory): ReviewFileDirectory {
  const query = memory.fileQuery.toLocaleLowerCase();
  const matched = reviewWorkspaceFiles.filter(
    (entry) =>
      (memory.fileState === 'ALL' || entry.state === memory.fileState) &&
      `${entry.title} ${entry.code}`.toLocaleLowerCase().includes(query),
  );
  const approved = (entry: ReviewFileEntry) =>
    [...memory.approved].some((key) => key.startsWith(`${entry.fileId}:`));
  return {
    totalCount: matched.length,
    entries: matched.slice(0, memory.loadedFiles).map((entry) => ({
      ...entry,
      ...(approved(entry) ? { state: 'APPROVED' as const, detail: '已批准（合成）' } : {}),
    })),
    currentFileId: memory.currentFileId,
    query: memory.fileQuery,
    stateFilter: memory.fileState,
    loading: false,
    ...(matched.length > memory.loadedFiles ? { nextCursor: `page-${memory.loadedFiles}` } : {}),
    status: memory.fileStatus,
  };
}

/** Development controls shared by both fixture review pages. */
export function FixtureReviewControls({
  fixture,
  contextKey,
  extra,
}: {
  fixture: ReviewFixtureApi;
  contextKey: string;
  extra?: ReactNode;
}) {
  const { memory, notify } = fixture;
  return (
    <details className="execution-controls review-controls">
      <summary>审查演示控制与边界</summary>
      <p className="muted">
        合成交互，不调用 Core 或 Runner，也不表示真实保存、提交、复核或批准 · {reviewFixtureMarker}
      </p>
      <div>
        <label>
          个人草稿保存回执
          <select
            value={memory.draftOutcome}
            onChange={(event) => {
              memory.draftOutcome = event.target.value as ReviewDraftState;
              notify();
            }}
          >
            <option value="SAVED">已保存</option>
            <option value="UNSAVED">保存失败</option>
            <option value="CONFLICT">草稿冲突（另一设备）</option>
            <option value="UNKNOWN">保存结果待核验</option>
            <option value="UNAVAILABLE">服务器草稿未接入</option>
          </select>
        </label>
        <button onClick={fixture.applySaveReceipt}>返回草稿保存回执</button>
        <label>
          原提交的查询结果
          <select
            value={memory.receiptOutcome}
            onChange={(event) => {
              memory.receiptOutcome = event.target.value as ReceiptOutcome;
              notify();
            }}
          >
            <option value="unknown">暂时仍查不到回执</option>
            <option value="accepted">已接收，等待安排</option>
            <option value="running">已确认正在修改</option>
            <option value="mismatch">回执上下文不匹配</option>
          </select>
        </label>
        <label>
          单文件批准回执
          <select
            value={memory.approvalOutcome}
            onChange={(event) => {
              memory.approvalOutcome = event.target.value as ApprovalOutcome;
              notify();
            }}
          >
            <option value="hold">等待回执</option>
            <option value="accepted">匹配批准成功并进入下一份</option>
            <option value="unknown">批准结果待核验</option>
            <option value="mismatch">错上下文回执</option>
          </select>
        </label>
        <label>
          下载状态
          <select
            value={memory.download}
            onChange={(event) => {
              memory.download = event.target.value as 'AVAILABLE' | 'UNAVAILABLE';
              notify();
            }}
          >
            <option value="AVAILABLE">已登记表示</option>
            <option value="UNAVAILABLE">未提供已登记表示</option>
          </select>
        </label>
        {extra}
        <p className="muted">
          当前上下文 {contextKey} · 已批准 {memory.approved.size} 份 ·
          自动核验预算按已批准策略（最多 3 次、累计 10 秒）
        </p>
      </div>
    </details>
  );
}

export function FixtureReviewWorkspace() {
  const fixture = useReviewFixture();
  const { memory, notify } = fixture;
  const fileId = memory.currentFileId;
  const revisions = workspaceRevisions[fileId] ?? ['DEMO-WS-REV-01'];
  const revisionId = memory.revision.get(fileId) ?? requiredValue(revisions.at(-1));
  const key = `${fileId}:${revisionId}`;
  const latestRevision = requiredValue(revisions.at(-1));
  const data = useMemo(() => {
    if (fileId === 'DEMO-WS-MANUAL') return manualCandidate(revisionId);
    const base = workspaceCandidate({ revisionId: requiredValue(revisions.at(0)) });
    return revisionId === latestRevision
      ? workspaceCandidate({
          revisionId,
          appendedNote: '本轮补充核对说明（合成）：核对整理稿的版本标识与交付说明。',
          before: base.content,
          onlyAppended: true,
        })
      : base;
  }, [fileId, revisionId, latestRevision, revisions]);
  const options: ReviewBaselineOption[] = revisions.map((candidate, index) => ({
    id: candidate,
    label: `第 ${index + 1} 版`,
    kind: candidate === latestRevision ? 'LATEST' : 'OLDER',
  }));
  const suggestion = fixture.suggestion(
    key,
    `第 ${revisions.length} 版（${revisionId === latestRevision ? '最新' : '最新候选已到达'}）`,
    options,
  );
  const submission = fixture.submission(key);
  const intent = memory.approvals.get(key);
  const approved = memory.approved.has(key);
  return (
    <>
      <section className="execution-heading">
        <div>
          <div className="execution-crumb">
            <Link to="/workbench">← 返回工作台</Link>
            <span>青禾制造 / 多处修改示例</span>
          </div>
          <h1>文件检查 · 多处修改示例</h1>
        </div>
        <p>开发合成场景 · 9 章 / 201 份目录（合成）</p>
      </section>
      <p className="notice">
        仅开发合成内容 · 无客户文件、无 Runner、无服务器草稿或批准；下载与批准状态均为演示。
      </p>
      <MarkdownReviewPage
        data={data}
        busy={false}
        directoryStatus=""
        onMore={() => Promise.resolve()}
        workspace={{
          files: {
            list: fixtureFileList(memory),
            actions: {
              onQuery: (query) => {
                memory.fileQuery = query;
                memory.loadedFiles = 40;
                notify();
              },
              onStateFilter: (state) => {
                memory.fileState = state;
                memory.loadedFiles = 40;
                notify();
              },
              onSelect: (selected) => {
                const entry = reviewWorkspaceFiles.find((item) => item.fileId === selected);
                if (!entry?.openable) return;
                memory.currentFileId = selected;
                memory.fileStatus = `已切换到「${entry.title}」的合成候选；本示例只为两份文件提供候选。`;
                memory.recheck.add(
                  `${selected}:${requiredValue(workspaceRevisions[selected]?.at(0))}`,
                );
                notify();
              },
              onMore: () => {
                memory.loadedFiles += 40;
                notify();
              },
            },
          },
          summary: {
            summary: `本轮共 ${data.changes.totalChanges} 处文本整理；恢复模板缺失内容并保留企业现行安排。`,
            retained: ['企业现行岗位与汇报关系', '原有记录编号与归档规定', '签批栏与日期空白'],
            evidence: [
              { label: '来源模板（合成）', detail: '模板版本 A/5 · 位置仅作展示，不是稳定身份' },
              { label: '修改范围（合成）', detail: '仅限本文件正文整理；不扩大范围' },
            ],
            note: '合成示例；不表示内容已理解、批准或执行。',
          },
          ...(memory.candidates.has(key) && revisionId !== latestRevision
            ? {
                candidate: {
                  label: '新候选已到达',
                  note: '当前阅读版本、引用草稿与滚动位置保持不变。',
                  onSwitch: () => {
                    memory.revision.set(fileId, latestRevision);
                    memory.recheck.add(`${fileId}:${latestRevision}`);
                    notify();
                  },
                },
              }
            : {}),
          ...(memory.recheck.has(key)
            ? {
                recheck:
                  '已显式切换到此精确版本；请重新核对引用位置与草稿后再提交。此前版本的草稿仍单独保留。',
              }
            : {}),
        }}
        download={{
          hasRepresentation: memory.download === 'AVAILABLE',
          status: memory.downloadStatus,
          note: '此候选未提供已登记表示，下载不可用；阅读与意见不受影响。',
          onDownload: () => {
            memory.downloadStatus = '下载响应已完整接收（演示）；请在浏览器中确认保存。';
            notify();
            return Promise.resolve();
          },
        }}
        opinion={{
          context: `${data.content.document.title} · 版本 ${revisionId.slice(-8)}`,
          draft: fixture.draft(key),
          ...(suggestion ? { suggestion } : {}),
          ...(submission ? { submission } : {}),
          approval: {
            available: !approved && !intent && !submission,
            note: approved
              ? '本精确版本已批准（演示）；批准不表示发布或交付。'
              : intent === 'PENDING'
                ? '批准结果待核验；不会按点击或未知结果切换文件。'
                : intent === 'MISMATCH'
                  ? '回执上下文不匹配，未批准、未切换。'
                  : intent === 'UNKNOWN'
                    ? '批准结果待核验；不会按未知结果切换。'
                    : submission
                      ? '核验期间不能批准；请先完成本次提交的核验。'
                      : '批准只在服务端返回匹配成功回执后生效并进入下一份；本示例由演示控制返回回执。',
          },
          unavailable: [
            '真实服务器个人草稿、提交并修改与批准尚未接入；本页只演示页面状态。',
            '真实 Runner 处理、内容复核与交付保持 NOT RUN。',
          ],
        }}
        opinionActions={{
          onDraftChange: (text) => {
            fixture.changeDraft(key, text);
          },
          onSubmit: () => {
            fixture.submit(key);
          },
          onQuerySubmission: () => {
            fixture.query(key, false);
          },
          onApprove: () => {
            fixture.approve(key);
          },
          onAttachSuggestion: (file) => {
            fixture.attachSuggestion(key, file);
          },
          onRemoveSuggestion: () => {
            fixture.removeSuggestion(key);
          },
          onSelectBaseline: (id) => {
            fixture.selectBaseline(key, id);
          },
        }}
        controls={
          <FixtureReviewControls
            fixture={fixture}
            contextKey={key}
            extra={
              <>
                <label>
                  查看本文件版本
                  <select
                    value={revisionId}
                    onChange={(event) => {
                      memory.revision.set(fileId, event.target.value);
                      notify();
                    }}
                  >
                    {revisions.map((candidate, index) => (
                      <option key={candidate} value={candidate}>
                        第 {index + 1} 版{candidate === latestRevision ? '（最新候选）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  onClick={() => {
                    memory.candidates.add(key);
                    memory.fileStatus = '新候选已到达（演示）；当前阅读版本保持。';
                    notify();
                  }}
                >
                  模拟本文件新候选到达
                </button>
                <button
                  onClick={() => {
                    fixture.applyApprovalReceipt(key);
                  }}
                >
                  返回批准的选定回执
                </button>
              </>
            }
          />
        }
      />
    </>
  );
}

function requiredValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('Missing review fixture binding');
  return value;
}
