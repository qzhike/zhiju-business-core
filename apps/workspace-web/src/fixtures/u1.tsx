// DEVELOPMENT_U1_ADAPTER_ONLY: isolated U1 rehearsal adapter; never imported by
// the production entry. Explicit events drive state; no timers or network calls.
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AnalysisPage } from '../analysis/Page.js';
import {
  contextFor,
  initialState,
  type AnalysisReport,
  type AnalysisState,
  type Receipt,
  type Submission,
} from '../analysis/model.js';
import { IntakePage } from '../intake/Pages.js';
import type { InputBatch, InputBatchState, IntakeProject, IntakeReceipt } from '../intake/model.js';
import { JourneyNav } from '../mvp/JourneyNav.js';
import { ProjectOverviewPage } from '../overview/Page.js';
import { PlanPage } from '../plan/Page.js';
import {
  planFileIds,
  planInputRefs,
  type PlanReceipt,
  type PlanView,
  type RevisionRequest,
} from '../plan/model.js';
import { Missing } from '../shell.js';
import {
  u1FormatRules,
  u1InitialBatch,
  u1PlanOne,
  u1Project,
  u1ReportOne,
  u1ReportTwo,
  u1SimulatedProblemEntries,
  u1SupplementBatch,
} from './u1-data.js';

const reports: Record<string, AnalysisReport> = {
  'U1-REPORT-01': u1ReportOne,
  'U1-REPORT-02': u1ReportTwo,
};
const projects: readonly IntakeProject[] = [
  {
    id: u1Project.id,
    title: u1Project.title,
    customer: { id: u1Project.enterpriseId, name: u1Project.customerLabel, code: u1Project.code },
  },
];
const analysisNotices: Record<string, string> = {
  received: '仅记录合成意见；未调用 Runner，未关闭事项或批准文件。',
  failed: '演示场景复核失败，原报告与原提交保留。',
};
const planFailures: Record<string, string> = {
  failed: '演示场景：确认失败，原计划与依据保留。',
  pending: '演示场景：确认请求保持待回执，不能重复提交。',
  unknown: '演示场景：结果未知，只能查询同一请求。',
  mismatch: '演示场景：回执上下文不匹配，按 UNKNOWN 处理。',
};
function withoutPlanOutcome(plan: PlanView): PlanView {
  return {
    planId: plan.planId,
    version: plan.version,
    projectId: plan.projectId,
    reportId: plan.reportId,
    reportVersion: plan.reportVersion,
    state: plan.state,
    inputBasis: plan.inputBasis,
    templateBasis: plan.templateBasis,
    currentSituation: plan.currentSituation,
    problem: plan.problem,
    proposal: plan.proposal,
    impact: plan.impact,
    files: plan.files,
    retained: plan.retained,
  };
}
interface IntentRecord {
  intentId: string;
  requestId: string;
  receipt?: PlanReceipt;
}
interface U1State {
  batches: InputBatch[];
  batchState: InputBatchState | null;
  setBatchState: (state: InputBatchState | null) => void;
  supplementSubmitted: boolean;
  problemEntries: boolean;
  showProblemEntries: () => void;
  submitSupplement: () => void;
  reportTwoAvailable: boolean;
  acknowledgedReportVersion: number;
  acknowledgeReportTwo: () => void;
  states: Record<string, AnalysisState>;
  update: (reportId: string, change: (state: AnalysisState) => AnalysisState) => void;
  submit: (input: Submission) => void;
  analysisScenario: string;
  setAnalysisScenario: (scenario: string) => void;
  plans: PlanView[];
  currentPlan: PlanView;
  selectPlan: (planId: string) => void;
  confirmPlan: (planId: string, intentId: string) => void;
  queryPlan: (planId: string) => void;
  simulatePlanReceipt: (planId: string) => void;
  expandPlan: (planId: string, switchCurrent?: boolean) => void;
  feedbackPlan: (planId: string, text: string) => void;
  revisions: Record<string, RevisionRequest>;
  generationState: 'NONE' | 'REQUESTED';
  requestGeneration: () => void;
  nextStagePlans: Record<string, boolean>;
  enterNextStage: (planId: string) => void;
  planScenario: string;
  setPlanScenario: (scenario: string) => void;
  planMessage: Record<string, string>;
}
const Context = createContext<U1State | null>(null);
export function FixtureU1Provider({ children }: { children: ReactNode }) {
  const [batches, setBatches] = useState([u1InitialBatch]);
  const [batchState, setBatchState] = useState<InputBatchState | null>(null);
  const [supplementSubmitted, setSupplementSubmitted] = useState(false);
  const [problemEntries, setProblemEntries] = useState(false);
  const [reportTwoAvailable, setReportTwoAvailable] = useState(false);
  const [acknowledgedReportVersion, setAcknowledgedReportVersion] = useState(1);
  const [states, setStates] = useState<Record<string, AnalysisState>>(() => ({
    'U1-REPORT-01': initialState(u1ReportOne),
    'U1-REPORT-02': initialState(u1ReportTwo),
  }));
  const [analysisScenario, setAnalysisScenario] = useState('received');
  const [plans, setPlans] = useState<PlanView[]>([u1PlanOne]);
  const [currentPlanId, setCurrentPlanId] = useState(u1PlanOne.planId);
  const [revisions, setRevisions] = useState<Record<string, RevisionRequest>>({});
  const [generationState, setGenerationState] = useState<'NONE' | 'REQUESTED'>('NONE');
  const [nextStagePlans, setNextStagePlans] = useState<Record<string, boolean>>({});
  const [planScenario, setPlanScenario] = useState('received');
  const [planMessage, setPlanMessage] = useState<Record<string, string>>({});
  const [intents] = useState(() => new Map<string, IntentRecord>());
  const currentPlan = plans.find((plan) => plan.planId === currentPlanId) ?? u1PlanOne;
  const update = (reportId: string, change: (state: AnalysisState) => AnalysisState) => {
    setStates((previous) => ({
      ...previous,
      [reportId]: change(previous[reportId] ?? initialState(reports[reportId] ?? u1ReportOne)),
    }));
  };
  const submit = (input: Submission) => {
    const fixed =
      input.draft.fixedExample &&
      input.context.kind === 'CUSTOMER' &&
      input.context.reportId === 'U1-REPORT-01';
    const state: Receipt['state'] = fixed ? 'RECEIVED' : (analysisScenario as Receipt['state']);
    const receipt: Receipt = {
      input,
      state,
      message: fixed
        ? '固定客户答复与补充说明已记录；第 2 版分析已到达，需主动查看。未调用 Runner。'
        : (analysisNotices[analysisScenario] ?? analysisNotices.received ?? ''),
    };
    update(input.context.reportId, (current) => ({
      ...current,
      receipts: [...current.receipts, receipt],
    }));
    if (fixed) {
      setReportTwoAvailable(true);
      if (!supplementSubmitted) {
        setSupplementSubmitted(true);
        setBatches((previous) =>
          previous.some((batch) => batch.id === u1SupplementBatch.id)
            ? previous
            : [...previous, u1SupplementBatch],
        );
      }
    }
  };
  const confirmPlan = (planId: string, intentId: string) => {
    const plan = plans.find((item) => item.planId === planId);
    if (!plan || plan.supersededBy || plan.state === 'PENDING' || plan.state === 'UNKNOWN') return;
    const requestId = `U1-REQUEST-${intentId}`;
    const record: IntentRecord = { intentId, requestId };
    intents.set(`${plan.planId}:${plan.version}`, record);
    const receipt: PlanReceipt = {
      classification: 'DEVELOPMENT_FIXTURE_ONLY',
      requestId,
      planId: plan.planId,
      planVersion: plan.version,
      reportId: plan.reportId,
      reportVersion: plan.reportVersion,
      fileIds: planFileIds(plan),
      inputRefs: planInputRefs(plan),
      confirmedAt: new Date().toISOString(),
    };
    setPlans((previous) =>
      previous.map((item) => {
        if (item.planId !== planId) return item;
        const base = withoutPlanOutcome(item);
        if (planScenario === 'received') return { ...base, state: 'CONFIRMED', receipt };
        if (planScenario === 'failed')
          return {
            ...base,
            state: 'FAILED',
            failure: planFailures.failed ?? '确认失败',
            unknownIntent: intentId,
          };
        return {
          ...base,
          state: planScenario === 'pending' ? 'PENDING' : 'UNKNOWN',
          unknownIntent: intentId,
        };
      }),
    );
    if (planScenario === 'received') {
      record.receipt = receipt;
      setGenerationState('NONE');
    }
  };
  const queryPlan = (planId: string) => {
    const plan = plans.find((item) => item.planId === planId);
    if (!plan) return;
    const record = intents.get(`${plan.planId}:${plan.version}`);
    if (!record) {
      setPlanMessage((previous) => ({
        ...previous,
        [planId]: '没有可查询的原模拟意图；未创建新请求。',
      }));
      return;
    }
    const receipt = record.receipt;
    if (!receipt) {
      setPlanMessage((previous) => ({
        ...previous,
        [planId]: '原模拟请求仍无可匹配回执；未再次提交或声称已启动。',
      }));
      return;
    }
    setPlans((previous) =>
      previous.map((item) =>
        item.planId === planId
          ? { ...withoutPlanOutcome(item), state: 'CONFIRMED' as const, receipt }
          : item,
      ),
    );
    setPlanMessage((previous) => ({
      ...previous,
      [planId]: '已查询到原请求回执；未创建第二个意图。',
    }));
  };
  const simulatePlanReceipt = (planId: string) => {
    const plan = plans.find((item) => item.planId === planId);
    if (!plan) return;
    const key = `${plan.planId}:${plan.version}`;
    const record = intents.get(key);
    if (!record) {
      setPlanMessage((previous) => ({ ...previous, [planId]: '没有待回收的原请求意图。' }));
      return;
    }
    record.receipt = {
      classification: 'DEVELOPMENT_FIXTURE_ONLY',
      requestId: record.requestId,
      planId: plan.planId,
      planVersion: plan.version,
      reportId: plan.reportId,
      reportVersion: plan.reportVersion,
      fileIds: planFileIds(plan),
      inputRefs: planInputRefs(plan),
      confirmedAt: new Date().toISOString(),
    };
    setPlanMessage((previous) => ({
      ...previous,
      [planId]: '原请求的回执已到达；请用“重新查询原请求”核对，不自动确认。',
    }));
  };
  const expandPlan = (planId: string, switchCurrent = true) => {
    const plan = plans.find((item) => item.planId === planId);
    if (!plan) return;
    if (plan.state !== 'CONFIRMED' || plan.supersededBy) return;
    const version = plan.version + 1;
    const expanded: PlanView = {
      ...withoutPlanOutcome(plan),
      planId: `U1-PLAN-${String(version).padStart(2, '0')}`,
      version,
      state: 'DRAFT',
      supersedes: plan.planId,
      files: [
        ...plan.files,
        {
          id: 'F-FORM-NOTICE',
          title: '变更通知单',
          level: 'RECORD',
          action: 'CREATE',
          current: '客户未提供独立变更通知单；T02 要求变更通知。',
          proposal: '按 T02 新增变更通知单，记录内部、外部和委托生产通知。',
          impact: '新增一份记录表单；不改变客户通知责任部门。',
          inputSourceIds: ['C02', 'A1'],
          templateSourceIds: ['T02'],
        },
      ],
    };
    setPlans((previous) => [
      ...previous.map((item) =>
        item.planId === plan.planId ? { ...item, supersededBy: expanded.planId } : item,
      ),
      expanded,
    ]);
    if (switchCurrent) {
      setCurrentPlanId(expanded.planId);
      setGenerationState('NONE');
    }
  };
  const feedbackPlan = (planId: string, text: string) => {
    const plan = plans.find((item) => item.planId === planId);
    if (!plan) return;
    if (plan.state !== 'CONFIRMED' || plan.supersededBy) return;
    setRevisions((previous) => ({
      ...previous,
      [plan.planId]: {
        id: `U1-REV-${crypto.randomUUID()}`,
        planId: plan.planId,
        planVersion: plan.version,
        text,
        state: 'RECEIVED',
        message:
          '范围内修订请求已登记（演示）；范围不变，不需要再次确认。未调用 Runner、未生成候选。',
      },
    }));
  };
  const value: U1State = {
    batches,
    batchState,
    setBatchState,
    supplementSubmitted,
    problemEntries,
    showProblemEntries: () => {
      setProblemEntries(true);
    },
    submitSupplement: () => {
      if (supplementSubmitted) return;
      setSupplementSubmitted(true);
      setBatches((previous) => [...previous, u1SupplementBatch]);
    },
    reportTwoAvailable,
    acknowledgedReportVersion,
    acknowledgeReportTwo: () => {
      if (reportTwoAvailable) setAcknowledgedReportVersion(2);
    },
    states,
    update,
    submit,
    analysisScenario,
    setAnalysisScenario,
    plans,
    currentPlan,
    selectPlan: (planId) => {
      setCurrentPlanId(planId);
      setGenerationState('NONE');
    },
    confirmPlan,
    queryPlan,
    simulatePlanReceipt,
    expandPlan,
    feedbackPlan,
    revisions,
    generationState,
    requestGeneration: () => {
      setGenerationState('REQUESTED');
    },
    nextStagePlans,
    enterNextStage: (planId) => {
      setNextStagePlans((previous) => ({ ...previous, [planId]: true }));
    },
    planScenario,
    setPlanScenario,
    planMessage,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
function useU1() {
  const state = useContext(Context);
  if (!state) throw new Error('DEVELOPMENT_U1_ADAPTER_ONLY');
  return state;
}
export function FixtureU1Overview() {
  const state = useU1();
  const params = useParams();
  if (params.projectId !== u1Project.id) return <Missing />;
  const acknowledged = state.acknowledgedReportVersion === 2;
  const planned = state.currentPlan.files.filter((file) => file.action !== 'RETAIN');
  const plannedAt = (level: PlanView['files'][number]['level']) =>
    planned.filter((file) => file.level === level);
  const recordTitles = plannedAt('RECORD')
    .map((file) => file.title)
    .join('、');
  return (
    <ProjectOverviewPage
      project={u1Project}
      reportId={acknowledged ? 'U1-REPORT-02' : 'U1-REPORT-01'}
      planVersion={
        state.plans.find((plan) => plan.planId === state.currentPlan.planId)?.version ?? 1
      }
      scopeEnabled={acknowledged}
      stages={[
        {
          id: 'manual',
          label: '质量手册',
          state: state.currentPlan.state === 'CONFIRMED' ? '待审阅（演示）' : '未开始',
          detail: '确认范围后可生成；U1 不实现候选生成或阶段定稿。',
        },
        {
          id: 'procedures',
          label: '控制程序与管理制度',
          state: '未开始',
          detail: '以质量手册定稿为依据；U1 仅展示名称，不表示已开始。',
        },
        {
          id: 'records',
          label: '记录表单与交付',
          state: '未开始',
          detail: '以前两阶段精确版本为依据；U1 不实现审阅或交付。',
        },
      ]}
      levels={[
        {
          id: 'manual',
          label: '质量手册',
          inputCount: 1,
          plannedCount: plannedAt('MANUAL').length,
          detail:
            plannedAt('MANUAL')
              .map((file) => file.title)
              .join('、') || '本轮无计划',
        },
        {
          id: 'procedure',
          label: '程序文件',
          inputCount: 1,
          plannedCount: plannedAt('PROCEDURE').length,
          detail:
            plannedAt('PROCEDURE')
              .map((file) => file.title)
              .join('、') || '本轮无计划',
        },
        {
          id: 'rule',
          label: '管理制度',
          inputCount: 0,
          plannedCount: plannedAt('RULE').length,
          detail:
            plannedAt('RULE')
              .map((file) => file.title)
              .join('、') || '客户未提供独立外来文件制度；本轮无新增。',
        },
        {
          id: 'record',
          label: '记录表单',
          inputCount: 5,
          plannedCount: plannedAt('RECORD').length,
          detail: `C03–C07；本轮生成 ${recordTitles || '无'}；C04/C05/C07 保留。`,
        },
      ]}
      next={
        acknowledged
          ? {
              label: '核对修改范围',
              href: `/projects/${u1Project.id}/startup/U1-REPORT-02`,
              reason: '第 2 版分析已核对；下一步确认精确文件范围与输入依据。',
            }
          : state.reportTwoAvailable
            ? {
                label: '查看第 2 版分析',
                href: `/projects/${u1Project.id}/analysis/U1-REPORT-02`,
                reason: '第 2 版分析已到达，需主动查看并核对本轮变化。',
              }
            : {
                label: '查看资料批次',
                href: `/projects/${u1Project.id}/intake`,
                reason: '先核对资料批次和读取限制，再进入分析与澄清。',
              }
      }
    />
  );
}
export function FixtureU1Intake() {
  const state = useU1();
  const params = useParams();
  if (params.projectId !== u1Project.id) return <Missing />;
  const receipts = new Map<string, readonly IntakeReceipt[]>();
  return (
    <div>
      <JourneyNav
        current="intake"
        analysisReportId={state.reportTwoAvailable ? 'U1-REPORT-02' : 'U1-REPORT-01'}
        scopeEnabled={state.acknowledgedReportVersion === 2}
      />
      <IntakePage
        projects={projects}
        selectedProjectId={u1Project.id}
        receipts={receipts}
        batches={state.batches.map((batch, index) =>
          index === 0
            ? {
                ...batch,
                ...(state.batchState ? { state: state.batchState } : {}),
                ...(state.problemEntries || state.batchState === 'FAILED'
                  ? { entries: [...batch.entries, ...u1SimulatedProblemEntries] }
                  : {}),
              }
            : batch,
        )}
        formatRules={u1FormatRules}
        unavailable="本页只展示已接收批次；补充资料由显式演示事件驱动，不通过真实上传。"
        controls={
          <details className="fixture-options" open>
            <summary>U1 资料演示控制</summary>
            <p>显式事件驱动批次和失败条目；不读取本地 ZIP，不用计时器推断分析完成。</p>
            <button disabled={state.supplementSubmitted} onClick={state.submitSupplement}>
              {state.supplementSubmitted ? '补充批次已提交' : '演示：提交补充批次'}
            </button>{' '}
            <button disabled={state.problemEntries} onClick={state.showProblemEntries}>
              {state.problemEntries ? '失败条目已展示' : '演示：加入失败与不支持条目'}
            </button>
            <label>
              批次状态
              <select
                value={state.batchState ?? ''}
                onChange={(event) => {
                  state.setBatchState((event.target.value || null) as InputBatchState | null);
                }}
              >
                <option value="">固定已接收 · 有限</option>
                <option value="RECEIVING">正在接收</option>
                <option value="LIMITED">已接收 · 有限</option>
                <option value="WAITING">已接收 · 等待分析</option>
                <option value="FAILED">存在失败条目</option>
                <option value="UNKNOWN">接收结果待核验</option>
              </select>
            </label>
            <p>
              <Link
                to={`/projects/${u1Project.id}/analysis/${
                  state.reportTwoAvailable ? 'U1-REPORT-02' : 'U1-REPORT-01'
                }`}
              >
                查看分析并记录客户答复
              </Link>
            </p>
          </details>
        }
      />
    </div>
  );
}
export function FixtureU1Analysis() {
  const state = useU1();
  const params = useParams();
  const navigate = useNavigate();
  const report = params.reportId ? reports[params.reportId] : undefined;
  if (!report) return <Missing />;
  if (report.projectId !== u1Project.id || params.projectId !== u1Project.id) return <Missing />;
  const acknowledged = state.acknowledgedReportVersion === 2;
  if (report.version === 2 && !state.reportTwoAvailable) {
    return (
      <div>
        <JourneyNav
          current="analysis"
          analysisReportId="U1-REPORT-01"
          scopeEnabled={acknowledged}
        />
        <section className="panel" role="status">
          <h1 tabIndex={-1}>第 2 版分析尚未到达</h1>
          <p>先在第 1 版记录客户答复或补充说明；页面不会用空状态生成第 2 版。</p>
          <Link to={`/projects/${u1Project.id}/analysis/U1-REPORT-01`}>返回第 1 版</Link>
        </section>
      </div>
    );
  }
  const analysisState = state.states[report.reportId];
  if (!analysisState) return <Missing />;
  const historical = report.version === 1 && acknowledged;
  const contextReport = reports[analysisState.context.reportId];
  const switchToTwo = () => {
    void navigate(`/projects/${u1Project.id}/analysis/U1-REPORT-02`);
  };
  return (
    <div>
      <JourneyNav
        current="analysis"
        analysisReportId={report.reportId}
        scopeEnabled={acknowledged}
      />
      <AnalysisPage
        report={report}
        contextReport={contextReport}
        state={analysisState}
        update={(change) => {
          state.update(report.reportId, change);
        }}
        historical={historical}
        submit={state.submit}
        scopeHref={
          report.version === 2 && acknowledged
            ? `/projects/${u1Project.id}/startup/U1-REPORT-02`
            : null
        }
        updateNotice={
          report.version === 1 && state.reportTwoAvailable && !acknowledged ? (
            <div className="notice" role="status">
              第 2 版分析已到达，当前仍是第 1 版；旧报告、意见和草稿保留。
              <Link to={`/projects/${u1Project.id}/analysis/U1-REPORT-02`} onClick={switchToTwo}>
                主动查看第 2 版
              </Link>
            </div>
          ) : report.version === 2 && !acknowledged ? (
            <div className="notice" role="status">
              第 2 版尚未核对。查看本轮变化后再进入修改范围，避免把未核对内容当作计划依据。
              <button onClick={state.acknowledgeReportTwo}>标记已核对第 2 版</button>
            </div>
          ) : undefined
        }
        roundSummary={report.version === 2 ? report.summary : undefined}
        records={
          <>
            <Link to={`/projects/${u1Project.id}/analysis/U1-REPORT-01`}>
              查看第 1 版{acknowledged ? '（历史只读）' : ''}
            </Link>
            {state.reportTwoAvailable && (
              <Link to={`/projects/${u1Project.id}/analysis/U1-REPORT-02`}>查看第 2 版</Link>
            )}
          </>
        }
        controls={
          <details className="fixture-options">
            <summary>U1 分析演示控制</summary>
            <p>固定合成答复；不上传或分析附件，不调用 Runner。刷新清理本页内存。</p>
            <select
              aria-label="分析回执场景"
              value={state.analysisScenario}
              onChange={(event) => {
                state.setAnalysisScenario(event.target.value);
              }}
            >
              <option value="received">收到合成意见</option>
              <option value="failed">失败</option>
            </select>
            <button
              disabled={historical || report.version !== 1}
              onClick={() => {
                const customerContext = contextFor(report, 'CUSTOMER');
                state.update(report.reportId, (previous) => ({
                  ...previous,
                  context: customerContext,
                  drafts: {
                    ...previous.drafts,
                    [customerContext.key]: {
                      text: '客户答复：同意四层结构与编号迁移；C04/C05/C07 继续作为内部表单保留；外来文件制度与变更实施记录请按正式模板补充；变更通知单是否新增待下一步确认。',
                      attachments: ['补充批次说明（无新增文件）'],
                      fixedExample: true,
                    },
                  },
                }));
              }}
            >
              带入客户答复与补充说明
            </button>
          </details>
        }
      />
    </div>
  );
}
export function FixtureU1Plan() {
  const state = useU1();
  const params = useParams();
  if (params.reportId !== 'U1-REPORT-02' || params.projectId !== u1Project.id) return <Missing />;
  const plan = state.currentPlan;
  const latestPlan = state.plans.at(-1);
  const confirmed = plan.state === 'CONFIRMED' && !plan.supersededBy;
  return (
    <>
      <JourneyNav
        current="scope"
        analysisReportId="U1-REPORT-02"
        scopeEnabled={state.acknowledgedReportVersion === 2}
      />
      <PlanPage
        key={plan.planId}
        plan={plan}
        plans={state.plans}
        revision={state.revisions[plan.planId] ?? null}
        notice={
          state.acknowledgedReportVersion !== 2 ? (
            <div className="notice" role="status">
              计划基于第 2 版分析，但尚未标记已核对。
              <Link to={`/projects/${u1Project.id}/analysis/U1-REPORT-02`}>
                返回核对第 2 版分析
              </Link>
            </div>
          ) : latestPlan !== undefined && plan.planId !== latestPlan.planId ? (
            <div className="notice" role="status">
              新计划已到达，当前仍是第 {plan.version} 版。
              <button
                onClick={() => {
                  state.selectPlan(latestPlan.planId);
                }}
              >
                查看第 {latestPlan.version} 版
              </button>
            </div>
          ) : undefined
        }
        generation={{
          enabled: confirmed,
          state: state.generationState,
          reason: confirmed
            ? '范围已确认，可以模拟生成；仍不调用 Runner。'
            : plan.supersededBy
              ? '旧计划已被替代，不能用于生成。'
              : '未确认的计划不能进入模拟生成。',
          onOpen: state.requestGeneration,
        }}
        nextStage={{
          entered: state.nextStagePlans[plan.planId] === true,
          onEnter: () => {
            state.enterNextStage(plan.planId);
          },
          disabledReason: confirmed ? undefined : '请先确认当前范围计划。',
        }}
        onConfirm={(intentId) => {
          state.confirmPlan(plan.planId, intentId);
        }}
        onFeedback={(text) => {
          state.feedbackPlan(plan.planId, text);
        }}
        onExpand={() => {
          state.expandPlan(plan.planId);
        }}
        onQuery={() => {
          state.queryPlan(plan.planId);
        }}
        onRetry={() => {
          state.confirmPlan(plan.planId, crypto.randomUUID());
        }}
        onSelectPlan={state.selectPlan}
        blockedReason={
          state.acknowledgedReportVersion === 2
            ? undefined
            : '请先核对第 2 版分析，再确认修改范围。'
        }
        statusMessage={state.planMessage[plan.planId]}
        development
        controls={
          <details className="fixture-options" open>
            <summary>U1 范围演示控制</summary>
            <p>确认回执由显式场景决定；不调用 Core，不用计时器推断执行完成。</p>
            <label>
              确认回执场景
              <select
                value={state.planScenario}
                onChange={(event) => {
                  state.setPlanScenario(event.target.value);
                }}
              >
                <option value="received">匹配回执</option>
                <option value="pending">待回执</option>
                <option value="failed">失败</option>
                <option value="unknown">UNKNOWN</option>
                <option value="mismatch">错上下文回执</option>
              </select>
            </label>
            <button
              disabled={plan.state !== 'PENDING' && plan.state !== 'UNKNOWN'}
              onClick={() => {
                state.simulatePlanReceipt(plan.planId);
              }}
            >
              模拟原请求回执到达
            </button>
            <button
              disabled={!confirmed || plan.supersededBy !== undefined}
              onClick={() => {
                state.expandPlan(plan.planId, false);
              }}
            >
              模拟新计划到达（不切换当前视图）
            </button>
          </details>
        }
      />
    </>
  );
}
