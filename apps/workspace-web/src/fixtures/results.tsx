// DEVELOPMENT_RESULTS_ADAPTER_ONLY: isolated M1 results workspace. It reads the
// same in-memory U1/U2 rehearsal state and never calls Core or Runner.
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownReviewPage } from '../MarkdownReviewPage.js';
import { activeSubmission, sameVersionSet, type FileVersionRef } from '../mvp/review-model.js';
import type {
  ReviewFileEntry,
  ReviewOpinionHistoryEntry,
  ReviewOpinionModel,
  ReviewWorkspaceInput,
} from '../review/model.js';
import { planActionLabels, planLevelLabels, type PlanFile, type PlanView } from '../plan/model.js';
import { inputEntryLabels } from '../intake/model.js';
import { mvpStageLabels, type MvpStageId } from '../mvp/review-model.js';
import { JourneyNav } from '../mvp/JourneyNav.js';
import { Missing } from '../shell.js';
import { u1Project, u1ReportOne, u1ReportTwo } from './u1-data.js';
import { useU1 } from './u1.js';
import { useMvpActivity } from './activity.js';
import {
  emptySession,
  planStageFiles,
  sessionKey,
  useU2,
  type RoundOpinionInput,
  type StageSession,
} from './u2.js';
import {
  u2CandidateComparison,
  u2FileMetas,
  u2Summary,
  u2VersionLabel,
  u2VersionsFor,
} from './u2-data.js';
import './results.css';

const projectId = u1Project.id;
const resultsPath = `/projects/${projectId}/results`;

type ResultStage = 'ANALYSIS' | MvpStageId;
type ResultFilter = 'ALL' | 'STAGE' | 'ROUND' | 'PENDING';

interface ResultRound {
  id: string;
  stage: ResultStage;
  label: string;
  summary: string;
  plan: PlanView;
  planKey?: string | undefined;
  session?: StageSession | undefined;
  versionId?: string | undefined;
  reportId?: string | undefined;
  blockers: readonly string[];
  next: { label: string; href: string; reason: string };
}

interface InventoryRow {
  id: string;
  fileId: string;
  versionId: string;
  title: string;
  source: string;
  depth: number;
  kind: 'UPLOADED' | 'CONTAINER' | 'MEMBER' | 'EXPECTED' | 'NEW' | 'RETAINED';
  levelLabel: string;
  stage?: MvpStageId | undefined;
  reading: string;
  outcome: string;
  candidate?: string | undefined;
  finalization: string;
  issues: number;
  pending: boolean;
  involved: boolean;
  detailHref: string;
}

interface ResultsContextValue {
  stage: ResultStage;
  roundId: string;
  filter: ResultFilter;
  pinned: boolean;
  drafts: Record<string, string>;
  saved: Record<string, { text: string; label: string }>;
  receipt: string;
  scrollY: number;
  setScrollY: (value: number) => void;
  setStage: (stage: ResultStage) => void;
  setRound: (roundId: string) => void;
  setFilter: (filter: ResultFilter) => void;
  changeDraft: (key: string, text: string) => void;
  saveDraft: (key: string, label: string) => void;
  submitRound: (input: RoundOpinionInput) => void;
}

const ResultsContext = createContext<ResultsContextValue | null>(null);

export function FixtureResultsProvider({ children }: { children: ReactNode }) {
  const u2 = useU2();
  const activity = useMvpActivity();
  const [stage, setStageState] = useState<ResultStage>('ANALYSIS');
  const [roundId, setRoundId] = useState('');
  const [filter, setFilter] = useState<ResultFilter>('ALL');
  const [pinned, setPinned] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, { text: string; label: string }>>({});
  const [receipt, setReceipt] = useState('');
  const [scrollY, setScrollY] = useState(0);
  const setStage = (next: ResultStage) => {
    setStageState(next);
    setRoundId('');
    setReceipt('');
    setPinned(true);
  };
  const value: ResultsContextValue = {
    stage,
    roundId,
    filter,
    pinned,
    drafts,
    saved,
    receipt,
    scrollY,
    setScrollY,
    setStage,
    setRound: (next) => {
      setStageState(
        next.startsWith('ANALYSIS-') ? 'ANALYSIS' : (next.split('-')[0] as ResultStage),
      );
      setRoundId(next);
      setReceipt('');
      setPinned(true);
    },
    setFilter,
    changeDraft: (key, text) => {
      setDrafts((current) => ({ ...current, [key]: text }));
      setReceipt('');
    },
    saveDraft: (key, label) => {
      const text = drafts[key]?.trim();
      if (!text) return;
      const roundPrefix = `${key.split(':')[0]}:`;
      const count =
        Object.keys(saved).filter((entry) => entry.startsWith(roundPrefix)).length +
        (saved[key] ? 0 : 1);
      setSaved((current) => ({ ...current, [key]: { text, label } }));
      setReceipt(`已保存 ${count} 条文件意见到本轮（模拟）。`);
    },
    submitRound: (input) => {
      if (activity.recovery) {
        setReceipt(`已有待处理恢复请求 ${activity.recovery.requestId}；请先核对原恢复请求。`);
        return;
      }
      const result = u2.submitRoundOpinions(input);
      setReceipt(
        result.ok
          ? `已登记模拟修改请求 ${result.requestId}；未调用 Runner，未生成候选。`
          : result.reason,
      );
    },
  };
  return <ResultsContext.Provider value={value}>{children}</ResultsContext.Provider>;
}

function useResults() {
  const value = useContext(ResultsContext);
  if (!value) throw new Error('DEVELOPMENT_RESULTS_ADAPTER_ONLY');
  return value;
}

function stageOfLevel(level: PlanFile['level']): MvpStageId {
  return level === 'MANUAL' ? 'MANUAL' : level === 'PROCEDURE' ? 'PROCEDURES' : 'RULES';
}

function stageOfPath(path: string): MvpStageId | undefined {
  if (path.includes('质量手册')) return 'MANUAL';
  if (path.includes('程序文件')) return 'PROCEDURES';
  if (path.includes('管理制度')) return 'RULES';
  if (path.includes('记录表单')) return 'RULES';
  if (path.includes('历史记录')) return 'RULES';
  if (path.includes('外来文件')) return 'RULES';
  return undefined;
}

function sessionFor(
  plan: PlanView,
  stage: MvpStageId,
  sessions: Record<string, StageSession>,
): StageSession {
  return sessions[sessionKey(plan, stage)] ?? emptySession(sessionKey(plan, stage), stage);
}

function roundLabel(stage: ResultStage, versionId?: string): string {
  if (stage === 'ANALYSIS') return versionId === '2' ? '整体分析 · 第 2 版' : '整体分析 · 第 1 版';
  return `${mvpStageLabels[stage]} · ${versionId ? u2VersionLabel(versionId) : '当前轮次'}`;
}

function stageRoundId(plan: PlanView, stage: MvpStageId, versionId: string): string {
  return `${stage}-${versionId}@${plan.planId}-v${plan.version}`;
}

function stageRoundLabel(plan: PlanView, stage: MvpStageId, versionId: string): string {
  return `${roundLabel(stage, versionId)} · ${plan.planId} 第 ${plan.version} 版`;
}

function roundVersionSet(round: ResultRound): FileVersionRef[] {
  if (!round.session || !round.versionId || round.stage === 'ANALYSIS') return [];
  return planStageFiles(round.plan, round.stage).flatMap((file) => {
    const versions = round.session?.files[file.id]?.versions ?? [];
    return versions.includes(round.versionId ?? '')
      ? [{ fileId: file.id, versionId: round.versionId ?? '' }]
      : [];
  });
}

function detailHref(roundId: string, fileId: string): string {
  return `${resultsPath}/${encodeURIComponent(roundId)}/${encodeURIComponent(fileId)}`;
}

function useResultsData(requestedRoundId?: string) {
  const u1 = useU1();
  const u2 = useU2();
  const results = useResults();
  const plans = u1.plans.length > 0 ? u1.plans : [u2.plan];
  const analysisRounds: ResultRound[] = [
    {
      id: 'ANALYSIS-1',
      stage: 'ANALYSIS',
      label: roundLabel('ANALYSIS', '1'),
      summary: u1ReportOne.summary,
      plan: u2.plan,
      reportId: u1ReportOne.reportId,
      blockers: u1ReportOne.attentionItems.slice(0, 3).map((item) => item.title),
      next: u1.reportTwoAvailable
        ? {
            label: '查看第 2 版分析',
            href: `/projects/${projectId}/analysis/${u1ReportTwo.reportId}`,
            reason: '第 2 版分析已到达，需主动查看并核对本轮变化。',
          }
        : {
            label: '答复与补充资料',
            href: `/projects/${projectId}/analysis/${u1ReportOne.reportId}`,
            reason: '先答复澄清问题或补充资料，再形成下一版分析。',
          },
    },
    ...(u1.reportTwoAvailable
      ? [
          {
            id: 'ANALYSIS-2',
            stage: 'ANALYSIS' as const,
            label: roundLabel('ANALYSIS', '2'),
            summary: u1ReportTwo.summary,
            plan: u2.plan,
            reportId: u1ReportTwo.reportId,
            blockers: u1ReportTwo.attentionItems.slice(0, 3).map((item) => item.title),
            next: {
              label: '核对信息与文件范围',
              href: `/projects/${projectId}/startup/U1-REPORT-02`,
              reason: '分析已核对；下一步确认精确文件范围与输入依据。',
            },
          },
        ]
      : []),
  ];
  const stageRounds: ResultRound[] = plans.flatMap((plan) =>
    (['MANUAL', 'PROCEDURES', 'RULES'] as const).flatMap((stage) => {
      const files = planStageFiles(plan, stage);
      const planKey = sessionKey(plan, stage);
      const session = sessionFor(plan, stage, u2.sessions);
      const versions = [
        ...new Set(files.flatMap((file) => session.files[file.id]?.versions ?? [])),
      ].sort();
      const review = u2.reviewStages.find((entry) => entry.id === stage);
      const isCurrentPlan = plan.planId === u2.plan.planId && plan.version === u2.plan.version;
      return versions.map((versionId) => {
        const missing = files.filter(
          (file) => !session.files[file.id]?.versions.includes(versionId),
        );
        const finalization = session.finalization;
        return {
          id: stageRoundId(plan, stage, versionId),
          stage,
          versionId,
          label: stageRoundLabel(plan, stage, versionId),
          summary: `${mvpStageLabels[stage]} · ${u2VersionLabel(versionId)}；计划 ${plan.planId} 第 ${plan.version} 版，本阶段 ${files.length} 份文件。`,
          plan,
          planKey,
          session,
          blockers: [
            ...(missing.length > 0
              ? [`本轮缺少文件：${missing.map((file) => file.title).join('、')}。`]
              : []),
            ...(finalization?.files.every((ref) => ref.versionId === versionId)
              ? []
              : ['本轮尚未成为阶段定稿。']),
          ],
          next: isCurrentPlan
            ? {
                label: finalization ? '查看阶段审阅' : '确认本阶段版本',
                href: review?.href ?? `/projects/${projectId}/stages/${stage.toLowerCase()}`,
                reason: finalization
                  ? '本阶段已有模拟定稿；可查看完整集合与历史。'
                  : '在阶段审阅中核对完整文件版本集合后确认。',
              }
            : {
                label: '查看当前处理结果',
                href: resultsPath,
                reason: '该轮次属于历史计划或输入依据；查看不改变当前项目进度。',
              },
        } satisfies ResultRound;
      });
    }),
  );
  const rounds = [...analysisRounds, ...stageRounds];
  const requestedRound = requestedRoundId
    ? rounds.find((entry) => entry.id === requestedRoundId)
    : undefined;
  const latestPlan = plans.at(-1) ?? u2.plan;
  const latestPlanRounds = stageRounds.filter(
    (round) => round.plan.planId === latestPlan.planId && round.plan.version === latestPlan.version,
  );
  const stageOrder: readonly MvpStageId[] = ['RULES', 'PROCEDURES', 'MANUAL'];
  const fallbackStage: ResultStage =
    stageOrder.find((stage) => latestPlanRounds.some((round) => round.stage === stage)) ??
    stageOrder.find((stage) => stageRounds.some((round) => round.stage === stage)) ??
    'ANALYSIS';
  const requestedStage = requestedRound
    ? requestedRound.stage
    : results.pinned
      ? results.stage
      : fallbackStage;
  const stage = requestedRound
    ? requestedRound.stage
    : rounds.some((round) => round.stage === requestedStage)
      ? requestedStage
      : fallbackStage;
  const stageOptions = [...new Set(rounds.map((round) => round.stage))];
  const stageRoundsForStage = rounds.filter((round) => round.stage === stage);
  const currentPlanRounds = stageRoundsForStage.filter(
    (entry) => entry.plan.planId === u2.plan.planId && entry.plan.version === u2.plan.version,
  );
  const round =
    requestedRound ??
    stageRoundsForStage.find((entry) => entry.id === results.roundId) ??
    currentPlanRounds.at(-1) ??
    stageRoundsForStage.at(-1) ??
    rounds[0];
  if (!round) return undefined;
  const selectedStage = round.stage === 'ANALYSIS' ? undefined : round.stage;
  const uploaded: InventoryRow[] = [];
  for (const batch of u1.batches) {
    for (const entry of batch.entries) {
      const kind: InventoryRow['kind'] =
        entry.format === 'RAR' ? 'CONTAINER' : entry.id.includes('-') ? 'MEMBER' : 'UPLOADED';
      const stage = stageOfPath(entry.path);
      const analysis = round.stage === 'ANALYSIS';
      const laterSupplement = round.id === 'ANALYSIS-1' && batch.id === 'U1-BATCH-02';
      const involved = analysis
        ? !laterSupplement && (entry.state === 'RECEIVED' || entry.state === 'LIMITED')
        : stage === selectedStage;
      uploaded.push({
        id: `${batch.id}:${entry.id}`,
        fileId: entry.id,
        versionId: 'SOURCE',
        title: entry.path,
        source: `${batch.label} · ${batch.zipName}`,
        depth: kind === 'MEMBER' ? 1 : 0,
        kind,
        levelLabel: stage ? mvpStageLabels[stage] : '补充资料',
        ...(stage ? { stage } : {}),
        reading: inputEntryLabels[entry.state],
        outcome: analysis
          ? laterSupplement
            ? '未纳入本轮（补充批次后到达）'
            : '作为分析依据'
          : '本阶段未处理',
        finalization: '—',
        issues: entry.state === 'LIMITED' || entry.state === 'FAILED' ? 1 : 0,
        pending:
          !laterSupplement &&
          (entry.state === 'LIMITED' || entry.state === 'FAILED' || entry.state === 'UNSUPPORTED'),
        involved,
        detailHref: detailHref(round.id, entry.id),
      });
    }
  }
  const planned: InventoryRow[] = round.plan.files.map((file) => {
    const stage = stageOfLevel(file.level);
    const retained = file.action === 'RETAIN';
    const versionId = !retained && round.stage === stage ? round.versionId : undefined;
    const stageSession = sessionFor(round.plan, stage, u2.sessions);
    const candidate =
      versionId && stageSession.files[file.id]?.versions.includes(versionId)
        ? versionId
        : undefined;
    const finalizedVersion = stageSession.finalization?.files.find(
      (ref) => ref.fileId === file.id,
    )?.versionId;
    const issues = (u1.reportTwoAvailable ? u1ReportTwo : u1ReportOne).attentionItems.filter(
      (item) => item.affectedPlannedFileIds.includes(file.id),
    ).length;
    const currentStageRound = round.stage === stage;
    return {
      id: `PLAN:${file.id}`,
      fileId: file.id,
      versionId: versionId ?? 'PLAN',
      title: file.title,
      source: '已确认修改范围',
      depth: 0,
      kind: retained ? 'RETAINED' : file.action === 'CREATE' ? 'NEW' : 'EXPECTED',
      levelLabel: planLevelLabels[file.level],
      stage,
      reading: file.action === 'CREATE' ? '无客户原件' : '客户原件已上传',
      outcome:
        round.stage === 'ANALYSIS'
          ? retained
            ? '沿用现有文件'
            : '拟议处理'
          : !currentStageRound
            ? '本阶段未处理'
            : retained
              ? '沿用以确认版本'
              : candidate
                ? '已生成候选'
                : stageSession.generationStatus === 'FAILED'
                  ? '本轮失败'
                  : '本轮未返回结果',
      ...(candidate ? { candidate: u2VersionLabel(candidate) } : {}),
      finalization: finalizedVersion ? u2VersionLabel(finalizedVersion) : '未定稿',
      issues,
      pending: !retained && (issues > 0 || (currentStageRound && !candidate)),
      involved: round.stage === 'ANALYSIS' || currentStageRound,
      detailHref: detailHref(round.id, file.id),
    } satisfies InventoryRow;
  });
  const rows = [...uploaded, ...planned];
  const filtered = rows.filter((row) => {
    if (results.filter === 'ALL') return true;
    if (results.filter === 'STAGE') return round.stage === 'ANALYSIS' || row.stage === round.stage;
    if (results.filter === 'ROUND') return row.involved;
    return row.pending;
  });
  const uploadedFiles = uploaded.filter((row) => row.kind === 'UPLOADED' || row.kind === 'MEMBER');
  const roundFiles = roundVersionSet(round);
  const roundFileCount =
    round.stage === 'ANALYSIS' ? 0 : planStageFiles(round.plan, round.stage).length;
  const roundComplete = roundFileCount > 0 && roundFiles.length === roundFileCount;
  const roundSubmitted = Boolean(
    round.session?.submissions.some(
      (submission) =>
        submission.status === 'RECEIVED' && sameVersionSet(submission.basis.files, roundFiles),
    ),
  );
  return {
    u2,
    results,
    rounds,
    stageOptions,
    round,
    stageRoundsForStage,
    rows: filtered,
    allRows: rows,
    counts: {
      uploaded: uploadedFiles.length,
      containers: uploaded.filter((row) => row.kind === 'CONTAINER').length,
      expected: planned.filter((row) => row.kind === 'EXPECTED').length,
      newFiles: planned.filter((row) => row.kind === 'NEW').length,
      retained: planned.filter((row) => row.kind === 'RETAINED').length,
      pending: rows.filter((row) => row.pending).length,
      involved: rows.filter((row) => row.involved).length,
    },
    roundFiles,
    roundComplete,
    roundSubmitted,
    activeRequestId: activeSubmission(
      Object.values(u2.sessions).flatMap((session) => session.submissions),
    )?.requestId,
    savedCount: Object.keys(results.saved).filter((key) => key.startsWith(`${round.id}:`)).length,
  };
}

export function FixtureResultsOverview() {
  const params = useParams();
  const activity = useMvpActivity();
  const data = useResultsData();
  const restored = useRef(false);
  useLayoutEffect(() => {
    if (!restored.current) {
      restored.current = true;
      if (data?.results.scrollY) window.scrollTo(0, data.results.scrollY);
    }
  }, [data?.results.scrollY]);
  if (params.projectId !== projectId) return <Missing />;
  if (!data) return <Missing />;
  const { results, round, stageOptions, counts, savedCount } = data;
  const roundSaved = Object.entries(results.saved).filter(([key]) =>
    key.startsWith(`${round.id}:`),
  );
  const canSubmit =
    round.stage !== 'ANALYSIS' &&
    savedCount > 0 &&
    data.roundComplete &&
    !data.roundSubmitted &&
    !data.activeRequestId &&
    !activity.recovery;
  const submitRound = () => {
    if (!canSubmit || round.stage === 'ANALYSIS' || !round.planKey) return;
    const manualFinalizationId = sessionFor(round.plan, 'MANUAL', data.u2.sessions).finalization
      ?.finalizationId;
    const procedureFinalizationId = sessionFor(round.plan, 'PROCEDURES', data.u2.sessions)
      .finalization?.finalizationId;
    const rulesFinalizationId = sessionFor(round.plan, 'RULES', data.u2.sessions).finalization
      ?.finalizationId;
    results.submitRound({
      planKey: round.planKey,
      planId: round.plan.planId,
      planVersion: round.plan.version,
      projectId,
      stage: round.stage,
      text: roundSaved.map(([, entry]) => `${entry.label}：${entry.text}`).join('\n'),
      files: data.roundFiles,
      ...(manualFinalizationId ? { manualFinalizationId } : {}),
      ...(procedureFinalizationId ? { procedureFinalizationId } : {}),
      ...(round.stage === 'RULES' && rulesFinalizationId ? { rulesFinalizationId } : {}),
    });
  };
  return (
    <div className="results-page">
      <JourneyNav
        current="results"
        analysisReportId={u1ReportTwo.reportId}
        scopeEnabled
        reviewStages={data.u2.reviewStages}
      />
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {u1Project.customerLabel} · {u1Project.code} · {projectId}
          </p>
          <h1 tabIndex={-1}>处理结果</h1>
          <p className="muted">按业务阶段、执行轮次与文件核对本轮结果；模拟数据，刷新重置。</p>
        </div>
      </div>
      <div className="demo" role="note">
        环境 A · 处理结果演练 · 本轮结论、文件清单、候选与意见均为合成页面状态；不调用 Core 或
        Runner。
      </div>
      <section className="panel results-controls" aria-label="结果类型与轮次">
        <label>
          结果类型
          <select
            aria-label="结果类型"
            value={round.stage}
            onChange={(event) => {
              results.setStage(event.target.value as ResultStage);
            }}
          >
            {stageOptions.map((stage) => (
              <option key={stage} value={stage}>
                {stage === 'ANALYSIS' ? '整体分析' : `阶段修订 · ${mvpStageLabels[stage]}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          轮次
          <select
            aria-label="轮次"
            value={round.id}
            onChange={(event) => {
              results.setRound(event.target.value);
            }}
          >
            {data.stageRoundsForStage.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <span className="muted">
          {round.stage === 'ANALYSIS'
            ? `分析报告 ${round.reportId}`
            : `阶段操作 ${mvpStageLabels[round.stage]}`}
        </span>
      </section>
      <section className="panel results-summary" aria-label="本轮结果">
        <h2>本轮结果</h2>
        <p>{round.summary}</p>
        {data.stageRoundsForStage
          .slice(data.stageRoundsForStage.findIndex((entry) => entry.id === round.id) + 1)
          .map((entry) => (
            <p className="notice" role="status" key={entry.id}>
              有新轮次可查看：{entry.label}。当前阅读与筛选保持不变。
              <button
                className="button"
                onClick={() => {
                  results.setRound(entry.id);
                }}
              >
                查看 {entry.label}
              </button>
            </p>
          ))}
        {round.blockers.length > 0 ? (
          <ul className="results-blockers">
            {round.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        ) : (
          <p className="notice" role="status">
            本轮没有已知阻断；阅读、评论和确认仍是不同动作。
          </p>
        )}
        <div className="results-actions">
          <Link className="button primary" to={round.next.href}>
            {round.next.label}
          </Link>
          <button className="button" disabled={!canSubmit} onClick={submitRound}>
            {data.roundSubmitted ? '本轮意见已提交' : '提交本轮意见并生成下一稿（模拟）'}
          </button>
          <span className="muted" role="status">
            {results.receipt ||
              (data.roundSubmitted
                ? '本轮意见已登记；返回阶段审阅可显式演练下一轮候选。'
                : data.activeRequestId
                  ? `已有待处理修改请求 ${data.activeRequestId}；请先核对原请求。`
                  : `已保存 ${savedCount} 条文件意见`)}
          </span>
        </div>
      </section>
      <section className="panel results-inventory" aria-label="完整文件清单">
        <div className="results-inventory-head">
          <div>
            <h2>完整文件清单</h2>
            <p className="muted">
              项目上传文件 {counts.uploaded} · 容器 {counts.containers} · 预期/计划{' '}
              {counts.expected} · 计划新增 {counts.newFiles} · 保留 {counts.retained} · 本轮涉及{' '}
              {counts.involved} · 待处理 {counts.pending}
            </p>
          </div>
          <nav className="results-filters" aria-label="文件筛选">
            {(
              [
                ['ALL', '全部文件'],
                ['STAGE', '本阶段'],
                ['ROUND', '本轮涉及'],
                ['PENDING', '待处理'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                aria-pressed={results.filter === id}
                onClick={() => {
                  results.setFilter(id);
                }}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
        <div className="results-table" role="region" aria-label="文件清单" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">文件 / 来源</th>
                <th scope="col">层级/阶段</th>
                <th scope="col">读取</th>
                <th scope="col">本轮结果</th>
                <th scope="col">候选</th>
                <th scope="col">人工定稿</th>
                <th scope="col">问题</th>
                <th scope="col">详情</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr
                  key={row.id}
                  data-kind={row.kind}
                  data-pending={row.pending ? 'true' : undefined}
                >
                  <th scope="row">
                    <span className={row.depth > 0 ? 'results-row-member' : undefined}>
                      {row.title}
                    </span>
                    <small>{row.source}</small>
                  </th>
                  <td>{row.levelLabel}</td>
                  <td>{row.reading}</td>
                  <td>{row.outcome}</td>
                  <td>{row.candidate ?? '—'}</td>
                  <td>{row.finalization}</td>
                  <td>{row.issues > 0 ? `${row.issues} 项待核对` : '—'}</td>
                  <td>
                    <Link
                      to={row.detailHref}
                      onClick={() => {
                        results.setRound(round.id);
                        results.setScrollY(window.scrollY);
                      }}
                    >
                      查看
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.rows.length === 0 && <p role="status">当前筛选没有文件；完整清单与选择保留。</p>}
        </div>
      </section>
      <section className="panel results-history" aria-label="本轮讨论与意见">
        <h2>本轮讨论与意见</h2>
        <p className="muted">
          文件意见在详情保存，回到本页汇总提交；项目/阶段意见在阶段审阅页分别记录。保存与提交都不等于阶段定稿或最终交付。
        </p>
        {savedCount === 0 ? (
          <p role="status">尚未保存文件意见。</p>
        ) : (
          <ul>
            {Object.entries(results.saved)
              .filter(([key]) => key.startsWith(`${round.id}:`))
              .map(([key, entry]) => (
                <li key={key}>
                  {entry.label} · {entry.text}
                </li>
              ))}
          </ul>
        )}
      </section>
      <p className="muted">
        当前查看 {round.label}；历史轮次不改变项目当前进度。文件详情返回会恢复本页轮次、筛选和位置。
      </p>
    </div>
  );
}

function previousVersion(fileId: string, versionId: string): string | null {
  const versions = [...u2VersionsFor(fileId)].sort();
  const index = versions.indexOf(versionId);
  return index > 0 ? (versions[index - 1] ?? null) : null;
}

function ReviewMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      components={{
        img: () => <span>（外部图片不加载）</span>,
        a: ({ children }) => <span>{children}</span>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export function FixtureResultsDetail() {
  const params = useParams();
  const [search] = useSearchParams();
  const [mode, setMode] = useState<'CUMULATIVE' | 'ROUND'>(
    search.get('mode') === 'ROUND' ? 'ROUND' : 'CUMULATIVE',
  );
  const data = useResultsData(params.roundId);
  if (params.projectId !== projectId || !params.roundId || !params.fileId) return <Missing />;
  if (data?.round.id !== params.roundId) return <Missing />;
  const { results, round, u2 } = data;
  const row = data.allRows.find((entry) => entry.fileId === params.fileId);
  if (!row) return <Missing />;
  const back = resultsPath;
  const key = `${round.id}:${row.fileId}:${row.versionId}`;
  const draftText = results.drafts[key] ?? '';
  const saved = results.saved[key];
  const meta = u2FileMetas[row.fileId];
  const planFile = round.plan.files.find((file) => file.id === row.fileId);
  const analysisReport =
    round.stage === 'ANALYSIS'
      ? round.reportId === u1ReportTwo.reportId
        ? u1ReportTwo
        : u1ReportOne
      : undefined;
  const dataForReview =
    planFile &&
    round.versionId &&
    round.stage !== 'ANALYSIS' &&
    round.stage === stageOfLevel(planFile.level) &&
    row.versionId === round.versionId &&
    row.candidate !== undefined
      ? u2CandidateComparison(
          row.fileId,
          mode === 'ROUND' ? previousVersion(row.fileId, round.versionId) : null,
          round.versionId,
        )
      : undefined;
  const opinion: ReviewOpinionModel = {
    context: `${row.title} · ${round.label} · ${row.versionId}`,
    draft: {
      text: draftText,
      state: saved ? 'SAVED' : draftText ? 'UNSAVED' : 'EMPTY',
      note: saved
        ? '模拟文件意见已保存；回到结果总览汇总提交。'
        : '只保留在当前页面内存；刷新重置。',
    },
    history: saved
      ? ([
          {
            id: `${key}-saved`,
            scopeLabel: '文件版本',
            status: '已保存（模拟）',
            text: saved.text,
            requestLabel: 'U2-SAVE-LOCAL',
            basis: `${round.label} · ${row.versionId}`,
          },
        ] satisfies ReviewOpinionHistoryEntry[])
      : [],
    approval: {
      available: false,
      note: '阶段定稿在完整集合中确认；文件详情不提供逐文件批准。',
      visible: false,
    },
    scope: {
      options: [{ id: key, label: `文件 ${row.title} · ${round.label}`, kind: 'FILE_VERSION' }],
      selectedId: key,
      note: '文件意见绑定当前文件、轮次和精确版本。',
    },
    submitBlocked: '在结果总览汇总提交；文件详情只保存意见。',
    unavailable: ['真实草稿、提交、Runner 候选与批准尚未接入；本页只保留当前会话内存。'],
  };
  const workspace: ReviewWorkspaceInput | undefined = dataForReview
    ? {
        files: {
          list: {
            totalCount: 1,
            entries: [
              {
                fileId: row.fileId,
                code: row.fileId,
                title: row.title,
                state: 'READY',
                detail: `${round.label} · ${row.versionId}`,
                openable: true,
              },
            ] satisfies ReviewFileEntry[],
            currentFileId: row.fileId,
            query: '',
            stateFilter: 'ALL',
            loading: false,
            status: '单个文件详情（模拟）',
          },
          actions: {},
        },
        summary: u2Summary(row.fileId)
          ? {
              summary: u2Summary(row.fileId)?.summary ?? '',
              retained: u2Summary(row.fileId)?.retained ?? [],
              evidence: [
                { label: '轮次', detail: round.label },
                { label: '精确版本', detail: row.versionId },
                { label: '比较方式', detail: mode === 'ROUND' ? '本轮变化' : '累计变化' },
                { label: '本轮结果', detail: row.outcome },
              ],
              note: u2Summary(row.fileId)?.note,
            }
          : undefined,
      }
    : undefined;
  return (
    <div className="results-page results-detail-page">
      <JourneyNav
        current="results"
        analysisReportId={u1ReportTwo.reportId}
        scopeEnabled
        reviewStages={u2.reviewStages}
      />
      <div className="results-detail-head">
        <Link to={back}>← 返回结果总览</Link>
        <p className="eyebrow">
          {round.label} · {row.levelLabel} · {row.versionId}
        </p>
        <h1 tabIndex={-1}>{row.title}</h1>
        <p className="muted">
          {planFile?.action === 'CREATE'
            ? '无客户原件，按已确认计划形成候选。'
            : '原件为只读来源，候选为新版本。'}
        </p>
      </div>
      <div className="demo" role="note">
        环境 A · 文件详情演练 · 差异、候选与意见为合成页面状态；刷新重置。
      </div>
      {planFile ? (
        <section className="panel results-detail-basis" aria-label="文件依据与精确版本">
          <div className="results-detail-meta">
            <label>
              比较方式
              <select
                aria-label="比较方式"
                value={mode}
                onChange={(event) => {
                  setMode(event.target.value as 'CUMULATIVE' | 'ROUND');
                }}
              >
                <option value="CUMULATIVE">累计变化 · 初始底稿 → 本轮</option>
                <option value="ROUND">本轮变化 · 上一轮 → 本轮</option>
              </select>
            </label>
            <span>
              精确版本：
              {mode === 'ROUND'
                ? (previousVersion(row.fileId, row.versionId) ?? '初始底稿')
                : '初始底稿'}{' '}
              → {row.versionId}
            </span>
            <span>本轮结果：{row.outcome}</span>
          </div>
          <details>
            <summary>查看来源、限制与精确引用</summary>
            <p>
              来源：{meta && meta.sourceIds.length > 0 ? meta.sourceIds.join('、') : '无'}；模板：
              {meta && meta.templateIds.length > 0 ? meta.templateIds.join('、') : '无'}。
            </p>
            <p>
              {meta && meta.limitations.length > 0 ? meta.limitations.join(' ') : '无额外说明。'}
            </p>
            <p>
              计划动作：{planActionLabels[planFile.action]}；层级：{planLevelLabels[planFile.level]}
              。
            </p>
          </details>
        </section>
      ) : (
        <section className="panel results-detail-basis" aria-label="来源文件详情">
          <h2>{row.title}</h2>
          <p>来源：{row.source}</p>
          <p>
            读取状态：{row.reading}；本轮结果：{row.outcome}。
          </p>
          <p className="muted">尚未生成候选的来源只显示读取状态与限制，不伪造正文或修订稿。</p>
          <ul>
            {analysisReport?.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
          <Link className="button" to={back}>
            返回结果总览
          </Link>
        </section>
      )}
      {planFile && !dataForReview && round.stage !== 'ANALYSIS' && (
        <section className="panel results-unavailable" role="status">
          <h2>本轮没有可比较的候选版本</h2>
          <p>
            {row.outcome === '本轮失败'
              ? '本轮候选生成失败；不用旧稿冒充本轮产物。'
              : row.outcome === '本阶段未处理'
                ? '该文件不属于所选阶段；本轮没有可比较的候选。'
                : '该文件没有所选轮次的实际候选；请查看来源或阶段审阅中的候选状态。'}
          </p>
          <p>尚无候选内容；不根据其他轮次或文件补齐。</p>
          <Link className="button" to={back}>
            返回结果总览
          </Link>
        </section>
      )}
      {planFile && dataForReview && (
        <>
          <details className="results-detail-rehearsal">
            <summary>演练与精确引用详情</summary>
            <p>
              文件 {row.fileId} · 轮次 {round.id} · 版本 {row.versionId} · 比较 {mode}
            </p>
          </details>
          <MarkdownReviewPage
            data={dataForReview}
            busy={false}
            directoryStatus=""
            onMore={() => Promise.resolve()}
            download={{
              hasRepresentation: false,
              status: '',
              note: '本演练未登记真实下载表示；阅读与意见不受影响。',
              onDownload: () => Promise.resolve(),
            }}
            opinion={opinion}
            focusReading
            opinionActions={{
              onDraftChange: (text) => {
                results.changeDraft(key, text);
              },
              onSaveDraft: () => {
                results.saveDraft(key, `${row.title} · ${round.label}`);
              },
            }}
            workspace={workspace ?? {}}
          />
          <section className="panel results-detail-next" aria-label="阶段确认">
            <p className="muted">
              文件意见只保存到当前文件/轮次/版本；阶段定稿仍按完整精确集合确认。
            </p>
            <Link
              className="button primary"
              to={u2.reviewStages.find((stage) => stage.id === round.stage)?.href ?? back}
            >
              前往阶段审阅确认完整集合
            </Link>
          </section>
        </>
      )}
      {planFile && round.stage === 'ANALYSIS' && analysisReport && (
        <section className="panel results-analysis-detail" aria-label="分析中的文件计划">
          <h2>分析计划与候选边界</h2>
          <p>当前是整体分析，尚未生成候选；以下为计划依据与待确认事项。</p>
          {analysisReport.changes
            .filter((change) => change.targetPlannedFileIds.includes(planFile.id))
            .map((change) => (
              <section key={change.id}>
                <h3>{change.title}</h3>
                <p>{change.description}</p>
              </section>
            ))}
          <details>
            <summary>查看报告说明</summary>
            <ReviewMarkdown text={analysisReport.narrative} />
          </details>
          <Link className="button" to={back}>
            返回结果总览
          </Link>
        </section>
      )}
      {planFile && round.stage !== 'ANALYSIS' && !dataForReview && (
        <p className="muted">来源读取限制和候选失败原因保留在清单与执行恢复中。</p>
      )}
    </div>
  );
}
