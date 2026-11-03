import { useProjectPaths, useProjectTemplates } from './project-session.js';
import { Alert } from '../components/ui/alert.js';
import { Card } from '../components/ui/card.js';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '../components/ui/dialog.js';
import { Badge } from '../components/ui/badge.js';
import { Label } from '../components/ui/label.js';
import { NativeSelect } from '../components/ui/native-select.js';
import { Button, buttonVariants } from '../components/ui/button.js';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '../components/ui/table.js';
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
import { useU1 } from './u1.js';
import { adoptLatestVersions } from './u3-data.js';
import { useMvpActivity } from './activity.js';
import {
  emptySession,
  planStageFiles,
  sessionKey,
  useU2,
  type RoundOpinionInput,
  type RoundOpinionResult,
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
  requestStatus?: 'PENDING' | 'UNKNOWN' | 'FAILED' | 'RECEIVED' | 'MISMATCH' | undefined;
  requestId?: string | undefined;
  blockers: readonly string[];
  next: { label: string; href: string; reason: string };
}

interface InventoryRow {
  id: string;
  fileId: string;
  versionId: string;
  title: string;
  source: string;
  kind: 'UPLOADED' | 'EXPECTED' | 'NEW' | 'RETAINED';
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
  setOpinion: (key: string, label: string, text: string) => void;
  clearReceipt: () => void;
  submitRound: (input: RoundOpinionInput) => RoundOpinionResult;
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
    clearReceipt: () => {
      setReceipt('');
    },
    setOpinion: (key, label, text) => {
      const trimmed = text.trim();
      setDrafts((current) => ({ ...current, [key]: text }));
      setSaved((current) => {
        if (trimmed) return { ...current, [key]: { text: trimmed, label } };
        return Object.fromEntries(Object.entries(current).filter(([entry]) => entry !== key));
      });
      setReceipt(trimmed ? '本轮意见已保留在本次会话内存（模拟）。' : '已清除此文件的会话内意见。');
    },
    submitRound: (input) => {
      if (activity.recovery) {
        const reason = `已有待处理恢复请求 ${activity.recovery.requestId}；请先核对原恢复请求。`;
        setReceipt(reason);
        return { ok: false, reason };
      }
      const result = u2.submitRoundOpinions(input);
      if (result.ok) {
        u2.addNextCandidate(input.stage);
        setReceipt(`已提交本轮意见并登记模拟修改请求 ${result.requestId}；新稿到达后需显式查看。`);
      } else {
        setReceipt(result.reason);
      }
      return result;
    },
  };
  return <ResultsContext.Provider value={value}>{children}</ResultsContext.Provider>;
}

export function useResults() {
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

function firstDefined(...values: (string | undefined)[]): string {
  for (const value of values) if (value !== undefined) return value;
  return '';
}

const requestStatusLabels: Record<
  'PENDING' | 'UNKNOWN' | 'FAILED' | 'RECEIVED' | 'MISMATCH',
  string
> = {
  PENDING: '生成请求待回执',
  UNKNOWN: '生成结果待核验',
  FAILED: '生成失败',
  RECEIVED: '生成回执已到达',
  MISMATCH: '生成回执不匹配',
};

const requestNextLabels: Record<
  'PENDING' | 'UNKNOWN' | 'FAILED' | 'RECEIVED' | 'MISMATCH',
  string
> = {
  PENDING: '查看待回执请求',
  UNKNOWN: '核对原生成请求',
  FAILED: '回到阶段审阅处理失败',
  RECEIVED: '查看本轮结果',
  MISMATCH: '核对不匹配回执',
};

function roundVersionSet(round: ResultRound): FileVersionRef[] {
  if (!round.session || !round.versionId || round.stage === 'ANALYSIS') return [];
  return planStageFiles(round.plan, round.stage).flatMap((file) => {
    const versions = round.session?.files[file.id]?.versions ?? [];
    return versions.includes(round.versionId ?? '')
      ? [{ fileId: file.id, versionId: round.versionId ?? '' }]
      : [];
  });
}

function detailHref(resultsPath: string, roundId: string, fileId: string): string {
  return `${resultsPath}/${encodeURIComponent(roundId)}/${encodeURIComponent(fileId)}`;
}

function useResultsData(requestedRoundId?: string) {
  const { projectId, resultsPath } = useProjectPaths();
  const { u1ReportOne, u1ReportTwo } = useProjectTemplates();
  const u1 = useU1();
  const u2 = useU2();
  const results = useResults();
  const plans = u1.plans.length > 0 ? u1.plans : [u2.plan];
  const analysisPlan = plans[0] ?? u2.plan;
  const analysisRounds: ResultRound[] = [
    {
      id: 'ANALYSIS-1',
      stage: 'ANALYSIS',
      label: roundLabel('ANALYSIS', '1'),
      summary: u1ReportOne.summary,
      plan: analysisPlan,
      reportId: u1ReportOne.reportId,
      blockers: u1ReportOne.attentionItems.slice(0, 3).map((item) => item.title),
      next: {
        label: '回到当前工作处理资料与分析',
        href: `/projects/${projectId}/work`,
        reason: '答复、补充资料与范围确认在当前工作连续完成。',
      },
    },
    ...(u1.reportTwoAvailable
      ? [
          {
            id: 'ANALYSIS-2',
            stage: 'ANALYSIS' as const,
            label: roundLabel('ANALYSIS', '2'),
            summary: u1ReportTwo.summary,
            plan: analysisPlan,
            reportId: u1ReportTwo.reportId,
            blockers: u1ReportTwo.attentionItems.slice(0, 3).map((item) => item.title),
            next: {
              label: '回到当前工作确认修改范围',
              href: `/projects/${projectId}/work`,
              reason: '分析已就绪；下一步在当前工作确认精确文件范围与输入依据。',
            },
          },
        ]
      : []),
  ];
  const stageRounds: ResultRound[] = plans.flatMap((plan) =>
    (['MANUAL', 'PROCEDURES', 'RULES'] as const).flatMap((stage): ResultRound[] => {
      const files = planStageFiles(plan, stage);
      const planKey = sessionKey(plan, stage);
      const session = sessionFor(plan, stage, u2.sessions);
      const versions = [
        ...new Set(files.flatMap((file) => session.files[file.id]?.versions ?? [])),
      ].sort();
      const isCurrentPlan = plan.planId === u2.plan.planId && plan.version === u2.plan.version;
      const requestStatuses = new Set(['FAILED', 'UNKNOWN', 'PENDING', 'MISMATCH', 'RECEIVED']);
      const requestRounds: ResultRound[] = session.generationAttempts
        .filter((attempt) => attempt.unresolvedHistory)
        .map((attempt) => ({
          id: `${stage}-REQ-${attempt.requestId}@${plan.planId}-v${plan.version}`,
          stage,
          label: `${mvpStageLabels[stage]} · ${requestStatusLabels[attempt.status]} · ${attempt.requestId} · ${plan.planId} 第 ${plan.version} 版`,
          summary: `${mvpStageLabels[stage]} · ${requestStatusLabels[attempt.status]}；计划 ${plan.planId} 第 ${plan.version} 版，请求 ${attempt.requestId}。`,
          plan,
          planKey,
          session,
          requestStatus: requestStatuses.has(attempt.status) ? attempt.status : 'FAILED',
          requestId: attempt.requestId,
          blockers: [
            attempt.message ||
              `${requestStatusLabels[attempt.status]}；请回到阶段审阅核对原请求，不重复提交。`,
          ],
          next: isCurrentPlan
            ? {
                label: `${requestNextLabels[attempt.status]}（当前工作）`,
                href: `/projects/${projectId}/work`,
                reason: '请在当前工作核对原生成请求、失败原因或待回执状态。',
              }
            : {
                label: '查看当前处理结果',
                href: resultsPath,
                reason: '该请求属于历史计划；查看不改变当前项目进度。',
              },
        }));
      return [
        ...requestRounds,
        ...versions.map((versionId) => {
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
                  label: finalization ? '回到当前工作查看定稿' : '回到当前工作核对定稿',
                  href: `/projects/${projectId}/work`,
                  reason: finalization
                    ? '本阶段已有模拟定稿；完整集合与历史在当前工作与历史记录中查看。'
                    : '在当前工作核对完整文件版本集合后确认。',
                }
              : {
                  label: '查看当前处理结果',
                  href: resultsPath,
                  reason: '该轮次属于历史计划或输入依据；查看不改变当前项目进度。',
                },
          } satisfies ResultRound;
        }),
      ];
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
      const kind = 'UPLOADED' as const;
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
        detailHref: detailHref(resultsPath, round.id, entry.id),
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
              : round.requestStatus === 'FAILED'
                ? '本轮失败'
                : round.requestStatus === 'UNKNOWN'
                  ? '本轮结果待核验'
                  : round.requestStatus === 'PENDING'
                    ? '本轮请求待回执'
                    : round.requestStatus === 'MISMATCH'
                      ? '本轮回执不匹配'
                      : round.requestStatus === 'RECEIVED'
                        ? '生成回执已到达'
                        : candidate
                          ? '已生成候选'
                          : '本轮未返回结果',
      ...(candidate ? { candidate: u2VersionLabel(candidate) } : {}),
      finalization: finalizedVersion ? u2VersionLabel(finalizedVersion) : '未定稿',
      issues,
      pending: !retained && (issues > 0 || (currentStageRound && !candidate)),
      involved: round.stage === 'ANALYSIS' || currentStageRound,
      detailHref: detailHref(resultsPath, round.id, file.id),
    } satisfies InventoryRow;
  });
  const rows = [...uploaded, ...planned];
  const filtered = rows.filter((row) => {
    if (results.filter === 'ALL') return true;
    if (results.filter === 'STAGE') return round.stage === 'ANALYSIS' || row.stage === round.stage;
    if (results.filter === 'ROUND') return row.involved;
    return row.pending;
  });
  const uploadedFiles = uploaded.filter((row) => row.kind === 'UPLOADED');
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
  const { projectId } = useProjectPaths();
  const { u1Project, u1ReportTwo } = useProjectTemplates();
  const params = useParams();
  const activity = useMvpActivity();
  const data = useResultsData(params.roundId);
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
  const planEligible = round.plan.state === 'CONFIRMED' && !round.plan.supersededBy;
  const planBlockedReason = round.plan.supersededBy
    ? `历史计划 ${round.plan.planId} 已被 ${round.plan.supersededBy} 替代；只能查看，不能提交下一轮。`
    : !planEligible
      ? `计划 ${round.plan.planId} 当前不是已确认状态；只能查看。`
      : undefined;
  const canSubmit =
    round.stage !== 'ANALYSIS' &&
    planEligible &&
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
    results.setRound(round.id);
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
      <Card asChild>
        <section className="panel results-controls" aria-label="结果类型与轮次">
          <Label>
            结果类型
            <NativeSelect
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
            </NativeSelect>
          </Label>
          <Label>
            轮次
            <NativeSelect
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
            </NativeSelect>
          </Label>
          <span className="muted">
            {round.stage === 'ANALYSIS'
              ? `分析报告 ${round.reportId}`
              : `阶段操作 ${mvpStageLabels[round.stage]}`}
          </span>
        </section>
      </Card>
      <Card asChild>
        <section className="panel results-summary" aria-label="本轮结果">
          <h2>本轮结果</h2>
          <p>{round.summary}</p>
          {data.stageRoundsForStage
            .slice(data.stageRoundsForStage.findIndex((entry) => entry.id === round.id) + 1)
            .map((entry) => (
              <Alert asChild variant="warning">
                <p className="notice" role="status" key={entry.id}>
                  有新轮次可查看：{entry.label}。当前阅读与筛选保持不变。
                  <Button
                    onClick={() => {
                      results.setRound(entry.id);
                    }}
                  >
                    查看 {entry.label}
                  </Button>
                </p>
              </Alert>
            ))}
          {round.blockers.length > 0 ? (
            <ul className="results-blockers">
              {round.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          ) : (
            <Alert asChild variant="warning">
              <p className="notice" role="status">
                本轮没有已知阻断；阅读、评论和确认仍是不同动作。
              </p>
            </Alert>
          )}
          <div className="results-actions">
            <Link className={buttonVariants({ variant: 'default' })} to={round.next.href}>
              {round.next.label}
            </Link>
            <Button disabled={!canSubmit} onClick={submitRound}>
              {data.roundSubmitted ? '本轮意见已提交' : '提交本轮意见并生成下一稿（模拟）'}
            </Button>
            <span className="muted" role="status">
              {firstDefined(
                planBlockedReason,
                results.receipt,
                data.roundSubmitted
                  ? '本轮意见已登记；返回阶段审阅可显式演练下一轮候选。'
                  : data.activeRequestId
                    ? `已有待处理修改请求 ${data.activeRequestId}；请先核对原请求。`
                    : `已保存 ${savedCount} 条文件意见`,
              )}
            </span>
          </div>
        </section>
      </Card>
      <Card asChild>
        <section className="panel results-inventory" aria-label="完整文件清单">
          <div className="results-inventory-head">
            <div>
              <h2>完整文件清单</h2>
              <p className="muted">
                项目上传文件 {counts.uploaded} · 预期/计划 {counts.expected} · 计划新增{' '}
                {counts.newFiles} · 保留 {counts.retained} · 本轮涉及 {counts.involved} · 待处理{' '}
                {counts.pending}
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
                <Button
                  key={id}
                  aria-pressed={results.filter === id}
                  onClick={() => {
                    results.setFilter(id);
                  }}
                >
                  {label}
                </Button>
              ))}
            </nav>
          </div>
          <div className="results-table" role="region" aria-label="文件清单" tabIndex={0}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">文件 / 来源</TableHead>
                  <TableHead scope="col">层级/阶段</TableHead>
                  <TableHead scope="col">读取</TableHead>
                  <TableHead scope="col">本轮结果</TableHead>
                  <TableHead scope="col">候选</TableHead>
                  <TableHead scope="col">人工定稿</TableHead>
                  <TableHead scope="col">问题</TableHead>
                  <TableHead scope="col">详情</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-kind={row.kind}
                    data-pending={row.pending ? 'true' : undefined}
                  >
                    <TableHead scope="row">
                      <span>{row.title}</span>
                      <small>{row.source}</small>
                    </TableHead>
                    <TableCell>{row.levelLabel}</TableCell>
                    <TableCell>{row.reading}</TableCell>
                    <TableCell>{row.outcome}</TableCell>
                    <TableCell>{row.candidate ?? '—'}</TableCell>
                    <TableCell>{row.finalization}</TableCell>
                    <TableCell>{row.issues > 0 ? `${row.issues} 项待核对` : '—'}</TableCell>
                    <TableCell>
                      <Link
                        to={row.detailHref}
                        onClick={() => {
                          results.setRound(round.id);
                          results.setScrollY(window.scrollY);
                        }}
                      >
                        查看
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.rows.length === 0 && <p role="status">当前筛选没有文件；完整清单与选择保留。</p>}
          </div>
        </section>
      </Card>
      <Card asChild>
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
      </Card>
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
  const { projectId, resultsPath } = useProjectPaths();
  const { u1Project, u1ReportOne, u1ReportTwo } = useProjectTemplates();
  const params = useParams();
  const [search] = useSearchParams();
  const [mode, setMode] = useState<'CUMULATIVE' | 'ROUND'>(
    search.get('mode') === 'ROUND' ? 'ROUND' : 'CUMULATIVE',
  );
  const [reviewingRound, setReviewingRound] = useState<string | null>(null);
  const reviewTrigger = useRef<HTMLButtonElement>(null);
  const reviewReceipt = useRef<HTMLParagraphElement>(null);
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
  const roundSaved = Object.entries(results.saved).filter(([savedKey]) =>
    savedKey.startsWith(`${round.id}:`),
  );
  const planEligible = round.plan.state === 'CONFIRMED' && !round.plan.supersededBy;
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
          { enterpriseId: u1Project.enterpriseId, projectId },
        )
      : undefined;
  const latestVersion = round.session?.files[row.fileId]?.versions.at(-1);
  const newerRound =
    latestVersion && latestVersion !== row.versionId
      ? data.rounds.find(
          (entry) =>
            entry.stage === round.stage &&
            entry.planKey === round.planKey &&
            entry.versionId === latestVersion,
        )
      : undefined;
  const finalized =
    round.session?.finalization?.files.some(
      (ref) => ref.fileId === row.fileId && ref.versionId === row.versionId,
    ) ?? false;
  const historicallyFinalized =
    round.session?.finalizationHistory.some((entry) =>
      entry.finalization.files.some(
        (ref) => ref.fileId === row.fileId && ref.versionId === row.versionId,
      ),
    ) ?? false;
  const versionStatus = dataForReview
    ? finalized
      ? '阶段定稿'
      : historicallyFinalized
        ? '历史定稿'
        : '候选稿 · 未定稿'
    : planFile
      ? '计划项 · 无本轮候选'
      : '来源文件';
  const opinion: ReviewOpinionModel = {
    context: `${row.title} · ${round.label} · ${row.versionId}`,
    draft: {
      text: draftText,
      state: saved ? 'SAVED' : draftText ? 'UNSAVED' : 'EMPTY',
      note: saved
        ? '已保留在本次会话内存；可在本页或当前工作核对提交。'
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
    submitBlocked: '在侧栏核对本轮全部意见后提交，生成下一稿。',
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
    <Card className="results-page results-detail-page">
      <header className="results-detail-head">
        <div className="results-detail-context">
          <Link to={back}>← 返回结果总览</Link>
          <span>{u1Project.title}</span>
        </div>
        <h1 tabIndex={-1}>{row.title}</h1>
        <p className="muted">{round.label}</p>
        <div className="results-detail-status" aria-label="当前阅读版本">
          <Badge variant={finalized ? 'default' : 'secondary'}>{versionStatus}</Badge>
          <span>
            {row.versionId} · {row.levelLabel}
          </span>
          {(Boolean(newerRound) || !planEligible) && dataForReview && (
            <Badge variant="outline">历史版本</Badge>
          )}
        </div>
      </header>
      <JourneyNav
        current="results"
        analysisReportId={u1ReportTwo.reportId}
        scopeEnabled
        reviewStages={u2.reviewStages}
      />
      {newerRound && dataForReview && (
        <div className="results-detail-new-version" role="status">
          <div>
            <strong>有新稿可查看 · {newerRound.versionId}</strong>
            <p>当前仍在阅读 {row.versionId}，此版本的意见保留在原轮次。</p>
          </div>
          <Link
            className={buttonVariants({ variant: 'outline' })}
            to={detailHref(resultsPath, newerRound.id, row.fileId)}
            onClick={() => {
              if (
                round.stage !== 'ANALYSIS' &&
                round.plan.planId === u2.plan.planId &&
                round.plan.version === u2.plan.version
              ) {
                u2.update(round.stage, (current) => adoptLatestVersions(current, [row.fileId]));
              }
            }}
          >
            查看新稿
          </Link>
        </div>
      )}
      {planFile ? (
        <section className="panel results-detail-basis" aria-label="文件依据与精确版本">
          {dataForReview && (
            <div className="results-detail-meta">
              <Label>
                比较方式
                <NativeSelect
                  aria-label="比较方式"
                  value={mode}
                  onChange={(event) => {
                    setMode(event.target.value as 'CUMULATIVE' | 'ROUND');
                  }}
                >
                  <option value="CUMULATIVE">累计变化 · 初始底稿 → 本轮</option>
                  <option value="ROUND">本轮变化 · 上一轮 → 本轮</option>
                </NativeSelect>
              </Label>
              <span>
                精确版本：
                {mode === 'ROUND'
                  ? (previousVersion(row.fileId, row.versionId) ?? '初始底稿')
                  : '初始底稿'}{' '}
                → {row.versionId}
              </span>
            </div>
          )}
          <details>
            <summary>查看来源、限制与精确引用</summary>
            <p>
              {planFile.action === 'CREATE'
                ? '无客户原件，按已确认计划形成候选。'
                : '原件为只读来源，候选为新版本。'}
            </p>
            <p>
              文件 {row.fileId} · 轮次 {round.id} · 版本 {row.versionId} · 本轮结果：{row.outcome}
            </p>
            <p>
              来源：{meta && meta.sourceIds.length > 0 ? meta.sourceIds.join('、') : '无'}；模板：
              {meta && meta.templateIds.length > 0 ? meta.templateIds.join('、') : '无'}。
            </p>
            <p>
              {meta && meta.limitations.length > 0 ? meta.limitations.join(' ') : '无额外说明。'}
            </p>
            <p>
              计划动作：{planActionLabels[planFile.action]}；层级：
              {planLevelLabels[planFile.level]}。
            </p>
            <p>当前为模拟阅读与意见；内容保留在本次会话内存，刷新重置。未登记真实下载表示。</p>
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
          <Link className={buttonVariants({ variant: 'outline' })} to={back}>
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
              : row.outcome === '本轮结果待核验'
                ? '原生成请求结果未知；请回阶段审阅核对原请求，不重复提交。'
                : row.outcome === '本轮请求待回执'
                  ? '原生成请求待回执；请回阶段审阅核对原请求，不重复提交。'
                  : row.outcome === '本轮回执不匹配'
                    ? '生成回执与当前请求不匹配；请回阶段审阅核对原请求。'
                    : row.outcome === '生成回执已到达'
                      ? '该历史请求的回执已到达；请查看对应候选轮次。'
                      : row.outcome === '本阶段未处理'
                        ? '该文件不属于所选阶段；本轮没有可比较的候选。'
                        : '该文件没有所选轮次的实际候选；请查看来源或阶段审阅中的候选状态。'}
          </p>
          <p>尚无候选内容；不根据其他轮次或文件补齐。</p>
          <Link className={buttonVariants({ variant: 'outline' })} to={back}>
            返回结果总览
          </Link>
        </section>
      )}
      {planFile && dataForReview && (
        <>
          <MarkdownReviewPage
            key={key}
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
                results.setOpinion(key, `${row.title} · ${round.label}`, text);
              },
              onSaveDraft: () => {
                results.saveDraft(key, `${row.title} · ${round.label}`);
              },
            }}
            opinionFooter={
              <section className="results-detail-next" aria-label="本轮意见核对入口">
                <p className="muted">
                  本轮 {roundSaved.length} 条意见 · {data.roundFiles.length} 份文件
                </p>
                <div className="results-actions">
                  <Button
                    ref={reviewTrigger}
                    variant="default"
                    disabled={
                      round.stage === 'ANALYSIS' ||
                      !planEligible ||
                      roundSaved.length === 0 ||
                      !data.roundComplete ||
                      data.roundSubmitted ||
                      Boolean(data.activeRequestId)
                    }
                    onClick={() => {
                      setReviewingRound(key);
                    }}
                  >
                    {data.roundSubmitted ? '本轮意见已提交' : '核对本轮意见'}
                  </Button>
                  <Link
                    className={buttonVariants({ variant: 'outline' })}
                    to={`/projects/${projectId}/work`}
                  >
                    返回当前工作核对定稿
                  </Link>
                </div>
                <p
                  className="muted results-round-status"
                  role="status"
                  tabIndex={-1}
                  ref={reviewReceipt}
                >
                  {results.receipt ||
                    (data.roundSubmitted
                      ? '本轮意见已登记；新稿到达后需显式查看。'
                      : '核对全部意见后提交；提交不会直接定稿。')}
                </p>
              </section>
            }
            workspace={workspace ?? {}}
          />
          <Dialog
            open={reviewingRound === key}
            onOpenChange={(open) => {
              if (!open) setReviewingRound(null);
            }}
          >
            <DialogContent
              className="results-round-review"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (reviewTrigger.current && !reviewTrigger.current.disabled) {
                  reviewTrigger.current.focus({ preventScroll: true });
                } else {
                  reviewReceipt.current?.focus({ preventScroll: true });
                  reviewReceipt.current?.scrollIntoView({ block: 'nearest' });
                }
              }}
            >
              <DialogTitle>核对本轮意见</DialogTitle>
              <DialogDescription>
                {round.label} · {roundSaved.length}{' '}
                条意见。确认后提交以下完整文件版本集合的本轮意见并生成下一稿；不会直接定稿。
              </DialogDescription>
              <h3>本轮文件与版本 · {data.roundFiles.length} 份</h3>
              <ul>
                {data.roundFiles.map((file) => (
                  <li key={file.fileId}>
                    {round.plan.files.find((item) => item.id === file.fileId)?.title ?? file.fileId}{' '}
                    · {file.versionId}
                  </li>
                ))}
              </ul>
              <h3>全部意见 · {roundSaved.length} 条</h3>
              <ul className="results-detail-opinions">
                {roundSaved.map(([savedKey, entry]) => (
                  <li key={savedKey}>
                    <strong>{entry.label}</strong>
                    <p>{entry.text}</p>
                  </li>
                ))}
              </ul>
              <div className="results-actions">
                <DialogClose asChild>
                  <Button>返回编辑</Button>
                </DialogClose>
                <Button
                  variant="default"
                  disabled={
                    round.stage === 'ANALYSIS' ||
                    !planEligible ||
                    roundSaved.length === 0 ||
                    !data.roundComplete ||
                    data.roundSubmitted ||
                    Boolean(data.activeRequestId)
                  }
                  onClick={() => {
                    if (round.stage === 'ANALYSIS' || !round.planKey) return;
                    const manualFinalizationId = sessionFor(round.plan, 'MANUAL', u2.sessions)
                      .finalization?.finalizationId;
                    const procedureFinalizationId = sessionFor(
                      round.plan,
                      'PROCEDURES',
                      u2.sessions,
                    ).finalization?.finalizationId;
                    const rulesFinalizationId = sessionFor(round.plan, 'RULES', u2.sessions)
                      .finalization?.finalizationId;
                    results.submitRound({
                      planKey: round.planKey,
                      planId: round.plan.planId,
                      planVersion: round.plan.version,
                      projectId,
                      stage: round.stage,
                      text: roundSaved
                        .map(([, entry]) => `${entry.label}：${entry.text}`)
                        .join('\n'),
                      files: data.roundFiles,
                      ...(manualFinalizationId ? { manualFinalizationId } : {}),
                      ...(procedureFinalizationId ? { procedureFinalizationId } : {}),
                      ...(round.stage === 'RULES' && rulesFinalizationId
                        ? { rulesFinalizationId }
                        : {}),
                    });
                    setReviewingRound(null);
                  }}
                >
                  {data.roundSubmitted ? '本轮意见已提交' : '核对并提交本轮意见并生成下一稿'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
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
          <Link className={buttonVariants({ variant: 'outline' })} to={back}>
            返回结果总览
          </Link>
        </section>
      )}
      {planFile && round.stage !== 'ANALYSIS' && !dataForReview && (
        <p className="muted">来源读取限制和候选失败原因保留在清单与执行恢复中。</p>
      )}
    </Card>
  );
}
