// DEVELOPMENT_ANALYSIS_ADAPTER_ONLY: fixed checked-in examples, no production import.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import initial from './analysis-report.json';
import followup from './analysis-report.followup.json';
import narrative from './analysis-report.md?raw';
import followupNarrative from './analysis-report.followup.md?raw';
import { AnalysisPage } from '../analysis/Page.js';
import {
  contextFor,
  emptyDraft,
  initialState,
  matchesReceipt,
  type AnalysisReport,
  type AnalysisState,
  type Receipt,
  type Submission,
} from '../analysis/model.js';
import { Missing } from '../shell.js';
import { UnavailablePage } from '../workbench/navigation.js';
import { Startup } from '../App.js';
import type { WorkspaceData } from '../model.js';
const firstReportId = 'DEMO-STARTUP-REPORT-01';
const secondReportId = 'DEMO-STARTUP-REPORT-02';
const reports: AnalysisReport[] = [initial, followup].map((report, index) => ({
  ...report,
  projectId: 'DEMO-PROJECT-01',
  reportId: `DEMO-STARTUP-REPORT-0${index + 1}`,
  version: index + 1,
  narrative: index ? followupNarrative : narrative,
  resolutionProposals: report.resolutionProposals.map((proposal, i) => ({
    id: String(i),
    attentionItemIds: [proposal.previousAttentionItemId],
    explanation: proposal.reason,
    evidenceIds: proposal.evidenceIds,
  })),
}));
function stateFor(states: Record<string, AnalysisState>, id: string): AnalysisState {
  const state = states[id];
  if (!state) throw new Error('DEVELOPMENT_REPORT_STATE_UNAVAILABLE');
  return state;
}
interface Adapter {
  states: Record<string, AnalysisState>;
  update: (reportId: string, change: (state: AnalysisState) => AnalysisState) => void;
  current: string;
  arrived: boolean;
  arrive: () => void;
  apply: () => void;
  submit: (input: Submission) => void;
  scenario: string;
  setScenario: (scenario: string) => void;
  blocked: (reportId: string) => string[];
}
const AdapterContext = createContext<Adapter | null>(null);
export function FixtureAnalysisProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, AnalysisState>>(() =>
    Object.fromEntries(reports.map((report) => [report.reportId, initialState(report)])),
  );
  const [current, setCurrent] = useState(firstReportId);
  const [arrived, setArrived] = useState(false);
  const [scenario, setScenario] = useState('received');
  const locks = useRef(new Set<string>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  const update: Adapter['update'] = (reportId, change) => {
    setStates((previous) => ({ ...previous, [reportId]: change(stateFor(previous, reportId)) }));
  };
  const apply = () => {
    if (current === secondReportId) return;
    setArrived(true);
    setCurrent(secondReportId);
    setStates((previous) => {
      const old = stateFor(previous, firstReportId);
      const next = stateFor(previous, secondReportId);
      const draft = old.drafts[old.context.key];
      return {
        ...previous,
        [secondReportId]:
          draft && (draft.text || draft.attachments.length)
            ? { ...next, context: old.context, drafts: { ...old.drafts, ...next.drafts } }
            : next,
      };
    });
  };
  const submit = (input: Submission) => {
    if (input.context.reportId !== current || locks.current.has(input.context.key)) return;
    locks.current.add(input.context.key);
    const outcome = scenario;
    update(input.context.reportId, (state) => ({
      ...state,
      receipts: [
        ...state.receipts,
        {
          input,
          state: 'PENDING',
          message: '合成请求，未调用 Core / Runner。可继续填写未提交的下一稿。',
        },
      ],
    }));
    timers.current.push(
      setTimeout(() => {
        const fixed = input.draft.fixedExample && input.context.kind === 'CUSTOMER';
        const receipt: Receipt = {
          input: outcome === 'mismatch' ? { ...input, projectId: 'other-project' } : input,
          state:
            outcome === 'failed'
              ? 'FAILED'
              : outcome === 'unavailable'
                ? 'UNAVAILABLE'
                : outcome === 'unknown'
                  ? 'UNKNOWN'
                  : 'RECEIVED',
          message:
            outcome === 'failed'
              ? '固定场景复核失败，原报告与原提交保留。可明确再次提交。'
              : outcome === 'unavailable'
                ? '固定场景操作暂不可用，未声称上传或执行。'
                : fixed
                  ? '固定补充示例已提供第 2 版，请主动查看；事项仅建议已解决，待核对。'
                  : input.context.kind === 'PLAN'
                    ? '仅此文件计划待复核；未改变报告或执行任何文件。'
                    : '仅记录合成意见；任意文本或附件未分析，不能生成 Runner 结论或关闭事项。',
        };
        const matching = matchesReceipt(input, receipt);
        update(input.context.reportId, (state) => ({
          ...state,
          receipts: state.receipts.map((item) =>
            item.input.id === input.id
              ? matching
                ? receipt
                : {
                    ...item,
                    state: 'UNKNOWN',
                    message: '回执上下文不匹配，提交结果待核验，保留原快照。',
                  }
              : item,
          ),
        }));
        if (matching && ['FAILED', 'UNAVAILABLE'].includes(receipt.state))
          locks.current.delete(input.context.key);
        if (fixed && matching && receipt.state === 'RECEIVED') setArrived(true);
      }, 450),
    );
  };
  const blocked = (reportId: string) => {
    stateFor(states, reportId);
    // No linked revised-plan response is supplied by this development adapter.
    return Object.values(states)
      .flatMap((state) => state.receipts)
      .filter(
        (receipt) =>
          receipt.input.context.kind === 'PLAN' &&
          ['PENDING', 'UNKNOWN', 'RECEIVED'].includes(receipt.state),
      )
      .flatMap((receipt) => receipt.input.context.fileIds);
  };
  return (
    <AdapterContext.Provider
      value={{
        states,
        update,
        current,
        arrived,
        arrive: () => {
          setArrived(true);
        },
        apply,
        submit,
        scenario,
        setScenario,
        blocked,
      }}
    >
      {children}
    </AdapterContext.Provider>
  );
}
function useAdapter() {
  const adapter = useContext(AdapterContext);
  if (!adapter) throw new Error('DEVELOPMENT_ANALYSIS_ADAPTER_ONLY');
  return adapter;
}
export function FixtureAnalysis() {
  const params = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const adapter = useAdapter();
  const report = reports.find(
    (item) => item.projectId === params.projectId && item.reportId === params.reportId,
  );
  useEffect(() => {
    if (report?.version === 2) adapter.apply();
  }, [report?.reportId]);
  if (!report) return <Missing />;
  const state = stateFor(adapter.states, report.reportId);
  const historical =
    report.version < (reports.find((item) => item.reportId === adapter.current)?.version ?? 1);
  const openCurrent = () => {
    adapter.apply();
    void navigate(`/projects/${report.projectId}/analysis/${secondReportId}`);
  };
  return (
    <AnalysisPage
      report={report}
      contextReport={reports.find(
        (item) =>
          item.projectId === state.context.projectId &&
          item.reportId === state.context.reportId &&
          item.version === state.context.version,
      )}
      state={state}
      update={(change) => {
        adapter.update(report.reportId, change);
      }}
      historical={historical}
      submit={adapter.submit}
      updateNotice={
        adapter.arrived && report.version === 1 ? (
          <div className="notice" role="status">
            有新演示报告到达，当前仍是第 1 版。
            <Link
              to={`/projects/${report.projectId}/analysis/${secondReportId}`}
              onClick={adapter.apply}
            >
              查看第 2 版
            </Link>
            {!search.get('view') && !historical && (
              <button onClick={openCurrent}>应用更新到当前总览</button>
            )}
          </div>
        ) : undefined
      }
      roundSummary={report.version === 2 ? report.summary : undefined}
      records={
        <>
          <Link to={`/projects/${report.projectId}/analysis/${firstReportId}`}>
            查看第 1 版{adapter.current === secondReportId ? '（历史只读）' : ''}
          </Link>
          {adapter.arrived && (
            <Link
              to={`/projects/${report.projectId}/analysis/${secondReportId}`}
              onClick={adapter.apply}
            >
              返回当前第 2 版
            </Link>
          )}
        </>
      }
      controls={
        <details className="fixture-options">
          <summary>分析演示控制</summary>
          <p>固定报告仅用于页面验证，不上传或分析文件；刷新清理本页内存。</p>
          <button onClick={adapter.arrive}>模拟新报告到达</button>
          <label>
            复核结果
            <select
              value={adapter.scenario}
              onChange={(event) => {
                adapter.setScenario(event.target.value);
              }}
            >
              <option value="received">收到合成意见</option>
              <option value="failed">失败</option>
              <option value="unavailable">不可用</option>
              <option value="unknown">UNKNOWN</option>
              <option value="mismatch">错上下文回执</option>
            </select>
          </label>
          <button
            disabled={
              historical ||
              state.context.kind !== 'CUSTOMER' ||
              state.context.reportId !== report.reportId
            }
            onClick={() => {
              adapter.update(report.reportId, (previous) => ({
                ...previous,
                drafts: {
                  ...previous.drafts,
                  [previous.context.key]: {
                    ...emptyDraft,
                    text: '固定演示：补充现行岗位职责文件。',
                    attachments: ['固定岗位职责示例.md'],
                    fixedExample: true,
                  },
                },
              }));
            }}
          >
            带入固定补充示例
          </button>
          <button
            disabled={historical}
            onClick={() => {
              adapter.update(report.reportId, (previous) => ({
                ...previous,
                context: contextFor(report, 'CUSTOMER'),
              }));
            }}
          >
            重新核对当前报告上下文
          </button>
        </details>
      }
    />
  );
}
export function FixtureAnalysisStartup({ data }: { data: WorkspaceData }) {
  const params = useParams();
  const adapter = useAdapter();
  const report = reports.find(
    (item) => item.projectId === params.projectId && item.reportId === params.reportId,
  );
  if (
    report &&
    report.version < (reports.find((item) => item.reportId === adapter.current)?.version ?? 1)
  )
    return (
      <UnavailablePage
        title="历史报告只读"
        reason="请返回当前分析报告核对本轮文件范围；历史报告不能确认新的执行范围。"
      />
    );
  const scopeFileIds: Record<string, string> = {
    'F-CORR': 'DEMO-CORR',
    'F-PREV': 'DEMO-PREV',
    'F-MANUAL': 'DEMO-MANUAL',
    'F-ROLE': 'DEMO-ROLE',
  };
  const blocked = report
    ? adapter.blocked(report.reportId).map((id) => scopeFileIds[id] ?? id)
    : [];
  const view: WorkspaceData = {
    ...data,
    reports: data.reports.map((item) => ({
      ...item,
      files: item.files.map((file) =>
        blocked.includes(file.id)
          ? {
              ...file,
              selectable: false,
              reason: '该文件已提交计划意见，等待关联修订计划；其他文件条件保持。',
            }
          : file,
      ),
    })),
    selected: (id) => data.selected(id).filter((fileId) => !blocked.includes(fileId)),
    confirm: (id, ids, intent) => {
      if (ids.some((fileId) => blocked.includes(fileId))) throw new Error('PLAN_RECHECK_REQUIRED');
      return data.confirm(id, ids, intent);
    },
  };
  return <Startup data={view} />;
}
