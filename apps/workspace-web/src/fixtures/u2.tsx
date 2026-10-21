// DEVELOPMENT_U2_ADAPTER_ONLY: isolated U2 review adapter. It consumes the U1
// plan context, never reads customer files or calls Core/Runner, and keeps all
// requests, saves and finalizations in page memory.
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Missing } from '../shell.js';
import {
  matchesPlanReceipt,
  planActionLabels,
  planInputRefs,
  planLevelLabels,
  type PlanFile,
  type PlanView,
} from '../plan/model.js';
import {
  StageReviewPage,
  type StageReviewBasisItem,
  type StageReviewFileView,
  type StageGenerationStatus,
} from '../mvp/StageReviewPage.js';
import {
  activeSubmission,
  candidateVersion,
  draftAfterEdit,
  draftAfterSaveReceipt,
  draftBasisChanged,
  draftWhileSaving,
  emptyDraft,
  evaluateFinalizationReceipt,
  fileVersionScope,
  finalizationBlocker,
  finalizationFromReceipt,
  manualBasis,
  mvpDraftStateLabels,
  planReady,
  procedureBasis,
  projectScope,
  sameVersionSet,
  stageScope,
  viewedVersionSet,
  type FileVersionRef,
  type FinalizationIntent,
  type FinalizationReceipt,
  type MvpDraft,
  type MvpStageId,
  type MvpSubmission,
  type OpinionBasis,
  type OpinionScope,
  type PlanBinding,
  type RevisionIntent,
  type RevisionReceipt,
  type StageFinalization,
  type StageFileAvailability,
} from '../mvp/review-model.js';
import type { JourneyReviewStage } from '../mvp/JourneyNav.js';
import { u1Project } from './u1-data.js';
import { useU1 } from './u1.js';
import { MvpHandoffContext, type MvpHandoff } from './handoff.js';
import { u2Candidate, u2FileMetas, u2Summary, u2VersionLabel, u2VersionsFor } from './u2-data.js';
import type { ReviewOpinionScopeOption } from '../review/model.js';

const projectId = u1Project.id;
const manualPath = `/projects/${projectId}/stages/manual`;
const proceduresPath = `/projects/${projectId}/stages/procedures`;
const recordsPath = `/projects/${projectId}/stages/records`;
const scopePath = `/projects/${projectId}/startup/U1-REPORT-02`;

const stageByParam: Record<string, MvpStageId> = {
  manual: 'MANUAL',
  procedures: 'PROCEDURES',
  records: 'RECORDS',
};
function planStageFiles(plan: PlanView, stage: MvpStageId): PlanFile[] {
  return plan.files.filter(
    (file) =>
      file.action !== 'RETAIN' &&
      (stage === 'MANUAL'
        ? file.level === 'MANUAL'
        : stage === 'PROCEDURES'
          ? file.level === 'PROCEDURE' || file.level === 'RULE'
          : file.level === 'RECORD'),
  );
}

function planBinding(plan: PlanView): PlanBinding {
  return {
    planId: plan.planId,
    version: plan.version,
    state: plan.state,
    ...(plan.supersededBy !== undefined ? { supersededBy: plan.supersededBy } : {}),
    receiptMatches: plan.receipt ? matchesPlanReceipt(plan, plan.receipt) : false,
    inputRefs: planInputRefs(plan),
    templateIds: plan.templateBasis,
  };
}

interface SessionFileState {
  versions: string[];
  viewedVersionId?: string | undefined;
  recheckedVersionId?: string | undefined;
}

interface GenerationIntent {
  requestId: string;
  projectId: string;
  stage: MvpStageId;
  planId: string;
  planVersion: number;
  versions: FileVersionRef[];
}

interface GenerationReceipt {
  classification: 'DEVELOPMENT_FIXTURE_ONLY';
  requestId: string;
  projectId: string;
  stage: MvpStageId;
  planId: string;
  planVersion: number;
  versions: FileVersionRef[];
}

interface StageSession {
  planKey: string;
  stage: MvpStageId;
  generationStatus: StageGenerationStatus;
  generationScene: 'matched' | 'missing' | 'pending' | 'unknown' | 'failed' | 'mismatch';
  generationRequest?:
    { intent: GenerationIntent; receipt?: GenerationReceipt | undefined } | undefined;
  files: Record<string, SessionFileState>;
  removed: Record<string, string[]>;
  activeFileId?: string | undefined;
  scopeId?: string | undefined;
  drafts: Record<string, MvpDraft>;
  saveScene: 'SAVED' | 'FAILED' | 'UNKNOWN';
  revisionScene: 'RECEIVED' | 'PENDING' | 'UNKNOWN' | 'FAILED' | 'MISMATCH';
  revisionIntents: Record<string, RevisionIntent>;
  revisionReceipts: Record<string, RevisionReceipt>;
  submissions: MvpSubmission[];
  finalizationScene: 'matched' | 'pending' | 'unknown' | 'failed' | 'mismatch' | 'changed';
  finalizationStatus: 'NONE' | 'PENDING' | 'UNKNOWN' | 'FAILED' | 'MISMATCH' | 'DONE';
  finalizationRequest?:
    { intent: FinalizationIntent; receipt?: FinalizationReceipt | undefined } | undefined;
  finalization?: StageFinalization | undefined;
  candidateScene: 'matched' | 'mismatch';
  message?: string | undefined;
  simulatedAnswer?: boolean | undefined;
}

function sessionKey(plan: PlanView, stage: MvpStageId): string {
  return `${plan.planId}@${plan.version}:${stage}`;
}

function emptySession(key: string, stage: MvpStageId): StageSession {
  return {
    planKey: key,
    stage,
    generationStatus: 'NONE',
    generationScene: 'matched',
    files: {},
    removed: {},
    drafts: {},
    saveScene: 'SAVED',
    revisionScene: 'RECEIVED',
    revisionIntents: {},
    revisionReceipts: {},
    submissions: [],
    finalizationScene: 'matched',
    finalizationStatus: 'NONE',
    candidateScene: 'matched',
  };
}

function generationReceiptMatches(intent: GenerationIntent, receipt: GenerationReceipt): boolean {
  return (
    intent.requestId === receipt.requestId &&
    intent.projectId === receipt.projectId &&
    intent.stage === receipt.stage &&
    intent.planId === receipt.planId &&
    intent.planVersion === receipt.planVersion &&
    sameVersionSet(intent.versions, receipt.versions)
  );
}

function applyVersions(session: StageSession, versions: readonly FileVersionRef[]): StageSession {
  const files: Record<string, SessionFileState> = { ...session.files };
  let firstFileId: string | undefined;
  for (const ref of versions) {
    if (!u2Candidate(ref.fileId, ref.versionId)) continue;
    const current = files[ref.fileId] ?? { versions: [] };
    const nextVersions = current.versions.includes(ref.versionId)
      ? current.versions
      : [...current.versions, ref.versionId].sort();
    files[ref.fileId] = {
      ...current,
      versions: nextVersions,
      ...(current.viewedVersionId
        ? { viewedVersionId: current.viewedVersionId }
        : { viewedVersionId: ref.versionId }),
    };
    if (!firstFileId && files[ref.fileId]?.viewedVersionId) firstFileId = ref.fileId;
  }
  return {
    ...session,
    files,
    ...(session.activeFileId ? {} : firstFileId ? { activeFileId: firstFileId } : {}),
  };
}

function versionRef(file: PlanFile, versionId: string): FileVersionRef {
  return { fileId: file.id, versionId };
}

function fileAvailability(
  planFile: PlanFile,
  state: SessionFileState | undefined,
): StageFileAvailability {
  const versions = (state?.versions ?? []).filter(
    (versionId) => u2Candidate(planFile.id, versionId) !== undefined,
  );
  const viewed = state?.viewedVersionId;
  return {
    fileId: planFile.id,
    versionId: viewed ?? versions.at(-1) ?? '',
    versions,
    ...(viewed ? { viewedVersionId: viewed } : {}),
  };
}

function fileViews(
  plan: PlanView,
  stage: MvpStageId,
  session: StageSession,
): StageReviewFileView[] {
  return planStageFiles(plan, stage).map((file) => {
    const state = session.files[file.id];
    const versions = state?.versions ?? [];
    const viewed = state?.viewedVersionId;
    const latest = versions.at(-1);
    return {
      fileId: file.id,
      title: file.title,
      levelLabel: planLevelLabels[file.level],
      actionLabel: planActionLabels[file.action],
      versionLabel: viewed ? u2VersionLabel(viewed) : '缺失',
      latestVersionLabel: latest ? u2VersionLabel(latest) : '尚未生成',
      missing: versions.length === 0 || viewed === undefined,
    };
  });
}

function reportBasis(plan: PlanView): string {
  return `${plan.planId} 第 ${plan.version} 版`;
}

function basisText(basis: OpinionBasis): string {
  return [
    `${basis.planId} 第 ${basis.planVersion} 版`,
    basis.files.map((file) => `${file.fileId}@${file.versionId}`).join('、') || '无文件',
    basis.manualFinalizationId ? `手册定稿 ${basis.manualFinalizationId}` : '',
    basis.procedureFinalizationId ? `第二阶段定稿 ${basis.procedureFinalizationId}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const submissionLabels: Record<MvpSubmission['status'], string> = {
  RECEIVED: '已接收（模拟）',
  PENDING: '待回执',
  UNKNOWN: '结果待核验',
  FAILED: '失败（模拟）',
};

export interface U2Api {
  plan: PlanView;
  planCheck: { ready: boolean; reason?: string | undefined };
  reviewedReportId: string;
  reviewStages: readonly JourneyReviewStage[];
  sessions: Record<string, StageSession>;
  manualFinalization?: StageFinalization | undefined;
  procedureFinalization?: StageFinalization | undefined;
  update: (stage: MvpStageId, change: (session: StageSession) => StageSession) => void;
  updateAny: (change: (session: StageSession) => StageSession) => void;
}

const U2Context = createContext<U2Api | null>(null);

export function FixtureU2Provider({ children }: { children: ReactNode }) {
  const u1 = useU1();
  const plan = u1.currentPlan;
  const [sessions, setSessions] = useState<Record<string, StageSession>>({});
  const planCheck = planReady(planBinding(plan));
  const manualKey = sessionKey(plan, 'MANUAL');
  const procedureKey = sessionKey(plan, 'PROCEDURES');
  const manualSession = sessions[manualKey] ?? emptySession(manualKey, 'MANUAL');
  const procedureSession = sessions[procedureKey] ?? emptySession(procedureKey, 'PROCEDURES');
  const manualFinalization =
    manualSession.finalization?.stage === 'MANUAL' ? manualSession.finalization : undefined;
  const procedureFinalization =
    procedureSession.finalization?.stage === 'PROCEDURES'
      ? procedureSession.finalization
      : undefined;
  const manualReady = manualBasis(manualFinalization, {
    projectId,
    planId: plan.planId,
    planVersion: plan.version,
    inputRefs: planInputRefs(plan),
    templateIds: plan.templateBasis,
    manualFileIds: planStageFiles(plan, 'MANUAL').map((file) => file.id),
  });
  const procedureReady = procedureBasis(procedureFinalization, {
    projectId,
    planId: plan.planId,
    planVersion: plan.version,
    inputRefs: planInputRefs(plan),
    templateIds: plan.templateBasis,
    manualFinalizationId: manualFinalization?.finalizationId,
    procedureFileIds: planStageFiles(plan, 'PROCEDURES').map((file) => file.id),
  });
  const stageReady: Record<MvpStageId, { ready: boolean; reason?: string | undefined }> = {
    MANUAL: planCheck,
    PROCEDURES: planCheck.ready ? { ready: manualReady.ok, reason: manualReady.reason } : planCheck,
    RECORDS: !planCheck.ready
      ? planCheck
      : !manualReady.ok
        ? { ready: false, reason: manualReady.reason }
        : { ready: procedureReady.ok, reason: procedureReady.reason },
  };
  const reviewStages: JourneyReviewStage[] = [
    {
      id: 'MANUAL',
      label: '质量手册审阅',
      href: manualPath,
      ready: stageReady.MANUAL.ready,
      reason: stageReady.MANUAL.reason,
    },
    {
      id: 'PROCEDURES',
      label: '程序与制度审阅',
      href: proceduresPath,
      ready: stageReady.PROCEDURES.ready,
      reason: stageReady.PROCEDURES.reason,
    },
    {
      id: 'RECORDS',
      label: '记录表单审阅',
      href: recordsPath,
      ready: stageReady.RECORDS.ready,
      reason: stageReady.RECORDS.reason,
    },
  ];
  const manualDone = manualReady.ok;
  const procedureDone = procedureReady.ok;
  const handoff: MvpHandoff = {
    reviewStages,
    ...(planCheck.ready
      ? {
          stages: [
            {
              id: 'manual',
              label: '质量手册',
              state: manualDone ? '已定稿（模拟）' : '待审阅（演示）',
              detail: manualDone
                ? `模拟定稿 ${manualFinalization?.finalizationId ?? ''} 已绑定精确手册版本。`
                : '已确认计划可进入质量手册候选审阅与模拟定稿。',
            },
            {
              id: 'procedures',
              label: '控制程序与管理制度',
              state: procedureDone
                ? '已定稿（模拟）'
                : manualDone
                  ? '待审阅（演示）'
                  : '等待手册定稿',
              detail: procedureDone
                ? `模拟定稿 ${procedureFinalization?.finalizationId ?? ''} 已绑定完整版本集合。`
                : manualDone
                  ? '以已定稿质量手册为依据，两类文件同轮审阅并整体确认。'
                  : '第二阶段以质量手册的精确模拟定稿为依据。',
            },
            {
              id: 'records',
              label: '记录表单与交付',
              state: procedureDone ? '待审阅（演示）' : '等待第二阶段定稿',
              detail: procedureDone
                ? '以前两阶段精确版本为依据；最终交付确认与打包属于 U3。'
                : '前两阶段模拟定稿齐全后可进入 Markdown 记录表单审阅。',
            },
          ],
          next: !manualDone
            ? {
                label: '进入质量手册审阅',
                href: manualPath,
                reason: '范围已确认；下一步审阅质量手册候选并模拟定稿一个精确版本。',
              }
            : !procedureDone
              ? {
                  label: '进入程序与制度审阅',
                  href: proceduresPath,
                  reason: '质量手册已有模拟定稿；下一步联动审阅控制程序与管理制度。',
                }
              : {
                  label: '进入记录表单审阅',
                  href: recordsPath,
                  reason: '第二阶段完整集合已定稿；下一步核对记录表单依据。',
                },
        }
      : {}),
  };
  const update = (stage: MvpStageId, change: (session: StageSession) => StageSession) => {
    const key = sessionKey(plan, stage);
    setSessions((previous) => {
      const current = previous[key] ?? emptySession(key, stage);
      const next = change(current);
      return next === current ? previous : { ...previous, [key]: next };
    });
  };
  const updateAny = (change: (session: StageSession) => StageSession) => {
    setSessions((previous) => {
      let changed = false;
      const next: Record<string, StageSession> = {};
      for (const [key, session] of Object.entries(previous)) {
        const updated = change(session);
        next[key] = updated;
        if (updated !== session) changed = true;
      }
      return changed ? next : previous;
    });
  };
  const api: U2Api = {
    plan,
    planCheck,
    reviewedReportId: u1.viewedReportId,
    reviewStages,
    sessions,
    manualFinalization,
    procedureFinalization,
    update,
    updateAny,
  };
  return (
    <U2Context.Provider value={api}>
      <MvpHandoffContext.Provider value={handoff}>{children}</MvpHandoffContext.Provider>
    </U2Context.Provider>
  );
}

function useU2(): U2Api {
  const value = useContext(U2Context);
  if (!value) throw new Error('DEVELOPMENT_U2_ADAPTER_ONLY');
  return value;
}

export function FixtureU2Stage() {
  const params = useParams();
  const api = useU2();
  const stage = params.stageId ? stageByParam[params.stageId] : undefined;
  if (params.projectId !== projectId || !stage) return <Missing />;
  return <StageFixturePage stage={stage} api={api} />;
}

function StageFixturePage({ stage, api }: { stage: MvpStageId; api: U2Api }) {
  const { plan, planCheck, sessions, manualFinalization, procedureFinalization } = api;
  const key = sessionKey(plan, stage);
  const session = sessions[key] ?? emptySession(key, stage);
  const files = planStageFiles(plan, stage);
  const availabilities = files.map((file) => fileAvailability(file, session.files[file.id]));
  const currentSet = viewedVersionSet(availabilities);
  const active = activeSubmission(
    Object.values(sessions).flatMap((candidate) => candidate.submissions),
  );
  const allSubmissions = Object.values(sessions)
    .flatMap((candidate) => candidate.submissions)
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  const myActive =
    active && session.submissions.some((submission) => submission.requestId === active.requestId)
      ? active
      : undefined;
  const manualId = manualFinalization?.finalizationId;
  const procedureId = procedureFinalization?.finalizationId;
  const activeFileId =
    session.activeFileId && session.files[session.activeFileId]?.viewedVersionId
      ? session.activeFileId
      : (availabilities.find((file) => file.viewedVersionId)?.fileId ?? files[0]?.id);
  const activeFile = files.find((file) => file.id === activeFileId);
  const activeAvailability = availabilities.find((file) => file.fileId === activeFileId);
  const viewedVersion = activeAvailability?.viewedVersionId;
  const data = activeFile && viewedVersion ? u2Candidate(activeFile.id, viewedVersion) : undefined;
  const meta = activeFile ? u2FileMetas[activeFile.id] : undefined;
  const summary = activeFile ? u2Summary(activeFile.id) : undefined;
  const scopeCandidates: OpinionScope[] = [
    projectScope(projectId, stage),
    stageScope(stage),
    ...availabilities
      .filter((file) => file.viewedVersionId)
      .map((file) => {
        const planFile = files.find((entry) => entry.id === file.fileId);
        return fileVersionScope(stage, {
          fileId: file.fileId,
          title: planFile?.title ?? file.fileId,
          versionId: file.viewedVersionId ?? '',
          versionLabel: u2VersionLabel(file.viewedVersionId ?? ''),
        });
      }),
  ];
  const defaultScope =
    scopeCandidates.find(
      (scope) => scope.kind === 'FILE_VERSION' && scope.fileId === activeFileId,
    ) ??
    scopeCandidates.find((scope) => scope.kind === 'FILE_VERSION') ??
    scopeCandidates[1] ??
    stageScope(stage);
  const selectedScope =
    scopeCandidates.find((scope) => scope.id === session.scopeId) ?? defaultScope;
  const scopeOptions: ReviewOpinionScopeOption[] = scopeCandidates.map((scope) => ({
    id: scope.id,
    label: scope.label,
    kind: scope.kind,
  }));
  const draft = session.drafts[selectedScope.id] ?? emptyDraft;
  const currentBasis: OpinionBasis = {
    planId: plan.planId,
    planVersion: plan.version,
    ...(manualId ? { manualFinalizationId: manualId } : {}),
    ...(procedureId ? { procedureFinalizationId: procedureId } : {}),
    files: currentSet ?? [],
  };
  const stageEvidence: StageReviewBasisItem[] = [
    { label: '已确认计划', detail: reportBasis(plan) },
    { label: '输入依据', detail: planInputRefs(plan).join('、') || '无输入' },
    { label: '正式模板快照', detail: plan.templateBasis.join('、') || '无模板' },
    {
      label: '读取限制',
      detail:
        'C01–C07 正文提取；图形、批注、修订和版式未核验；T01–T06 为只读快照。记录编号映射（U1-Q3）待业务核对。',
    },
  ];
  const upstream: StageReviewBasisItem[] =
    stage === 'MANUAL'
      ? []
      : stage === 'PROCEDURES'
        ? manualFinalization
          ? [
              {
                label: '质量手册定稿',
                detail: `${manualFinalization.finalizationId} · ${manualFinalization.files
                  .map((file) => `${file.fileId}@${file.versionId}`)
                  .join('、')}`,
              },
            ]
          : []
        : [
            ...(manualFinalization
              ? [
                  {
                    label: '质量手册定稿',
                    detail: `${manualFinalization.finalizationId} · ${manualFinalization.files
                      .map((file) => `${file.fileId}@${file.versionId}`)
                      .join('、')}`,
                  },
                ]
              : []),
            ...(procedureFinalization
              ? [
                  {
                    label: '第二阶段完整集合',
                    detail: `${procedureFinalization.finalizationId} · ${procedureFinalization.files
                      .map((file) => `${file.fileId}@${file.versionId}`)
                      .join('、')}`,
                  },
                ]
              : []),
          ];
  const readiness =
    stage === 'MANUAL'
      ? {
          ready: planCheck.ready,
          reason: planCheck.reason,
          returnHref: scopePath,
          returnLabel: '返回修改范围',
        }
      : stage === 'PROCEDURES'
        ? planCheck.ready
          ? manualFinalization
            ? { ready: true }
            : {
                ready: false,
                reason: '第二阶段以质量手册的精确模拟定稿为依据；当前尚无与计划匹配的手册定稿。',
                returnHref: manualPath,
                returnLabel: '返回质量手册审阅',
              }
          : {
              ready: false,
              reason: planCheck.reason,
              returnHref: scopePath,
              returnLabel: '返回修改范围',
            }
        : planCheck.ready
          ? manualFinalization
            ? procedureFinalization
              ? { ready: true }
              : {
                  ready: false,
                  reason:
                    '记录表单以第二阶段完整版本集合为依据；当前尚无与手册定稿匹配的第二阶段定稿。',
                  returnHref: proceduresPath,
                  returnLabel: '返回程序与制度审阅',
                }
            : {
                ready: false,
                reason: '记录表单需要先有质量手册定稿，再接续第二阶段完整集合定稿。',
                returnHref: manualPath,
                returnLabel: '返回质量手册审阅',
              }
          : {
              ready: false,
              reason: planCheck.reason,
              returnHref: scopePath,
              returnLabel: '返回修改范围',
            };
  const receivedForCurrent = session.submissions.some(
    (submission) =>
      submission.status === 'RECEIVED' &&
      currentSet !== undefined &&
      sameVersionSet(submission.basis.files, currentSet),
  );
  const hasNextVersion = files.some((file) => {
    const state = session.files[file.id];
    return (u2VersionsFor(file.id).at(-1) ?? '') !== (state?.versions.at(-1) ?? '');
  });
  const blocker = finalizationBlocker({
    supported: stage !== 'RECORDS',
    plan: planCheck,
    upstream: { ok: true },
    files: availabilities,
    active: Boolean(active),
    finalized: Boolean(session.finalization),
  });
  const canFinalizeSet = readiness.ready && blocker === undefined;
  const canConfirm =
    canFinalizeSet &&
    session.finalizationStatus !== 'PENDING' &&
    session.finalizationStatus !== 'UNKNOWN' &&
    session.finalizationStatus !== 'FAILED' &&
    session.finalizationStatus !== 'MISMATCH';
  const generationEnabled =
    readiness.ready &&
    Object.keys(session.files).length === 0 &&
    session.generationStatus !== 'PENDING' &&
    session.generationStatus !== 'UNKNOWN';
  const generationReason = readiness.ready
    ? '已确认计划可以生成页面内候选；生成只登记模拟回执，不调用 Runner。'
    : (readiness.reason ?? '等待前置依据。');

  const update = (change: (current: StageSession) => StageSession) => {
    api.update(stage, change);
  };

  const requestGeneration = () => {
    update((current) => {
      if (!readiness.ready)
        return { ...current, message: readiness.reason ?? '当前不能生成候选。' };
      if (current.generationStatus === 'PENDING' || current.generationStatus === 'UNKNOWN')
        return { ...current, message: '原生成请求仍未决；只查询同一请求，不创建第二个意图。' };
      if (Object.keys(current.files).length > 0)
        return { ...current, message: '本阶段已有候选；不重复生成。' };
      const allVersions = files
        .map((file) => {
          const versionId = u2VersionsFor(file.id)[0];
          return versionId ? versionRef(file, versionId) : undefined;
        })
        .filter((ref): ref is FileVersionRef => ref !== undefined);
      const scene = current.generationScene;
      const versions = scene === 'missing' ? allVersions.slice(0, -1) : allVersions;
      const intent: GenerationIntent = {
        requestId: `U2-GEN-${crypto.randomUUID().slice(0, 8)}`,
        projectId,
        stage,
        planId: plan.planId,
        planVersion: plan.version,
        versions,
      };
      if (scene === 'failed')
        return {
          ...current,
          generationStatus: 'FAILED',
          generationRequest: { intent },
          message: '模拟生成失败；原计划与输入保留，可显式重新请求。',
        };
      if (scene === 'pending' || scene === 'unknown')
        return {
          ...current,
          generationStatus: scene === 'pending' ? 'PENDING' : 'UNKNOWN',
          generationRequest: { intent },
          message:
            scene === 'pending'
              ? '生成请求待回执；重复点击不会创建第二个意图。'
              : '生成结果未知；只能查询原请求。',
        };
      if (scene === 'mismatch') {
        const receipt: GenerationReceipt = {
          classification: 'DEVELOPMENT_FIXTURE_ONLY',
          requestId: intent.requestId,
          projectId,
          stage,
          planId: plan.planId,
          planVersion: plan.version + 1,
          versions,
        };
        return {
          ...current,
          generationStatus: 'PENDING',
          generationRequest: { intent, receipt },
          message: '模拟回执上下文不匹配；请重新查询原请求核对。',
        };
      }
      const withVersions = applyVersions(current, versions);
      return {
        ...withVersions,
        generationStatus: 'RECEIVED',
        generationRequest: { intent },
        ...(scene === 'missing'
          ? {
              message: '生成回执已到达，但模拟缺少一份文件；缺失项显示为不可定稿，需返回核对。',
            }
          : {}),
      };
    });
  };

  const receiveGeneration = () => {
    update((current) => {
      const request = current.generationRequest;
      if (!request) return { ...current, message: '没有待回收的原生成请求。' };
      if (request.receipt) return { ...current, message: '原生成回执已经在本地；请查询原请求。' };
      const receipt: GenerationReceipt = {
        classification: 'DEVELOPMENT_FIXTURE_ONLY',
        requestId: request.intent.requestId,
        projectId: request.intent.projectId,
        stage: request.intent.stage,
        planId: request.intent.planId,
        planVersion: request.intent.planVersion,
        versions: request.intent.versions,
      };
      return {
        ...current,
        generationRequest: { ...request, receipt },
        message: '原生成回执已到达；请显式查询原请求，不自动应用。',
      };
    });
  };

  const queryGeneration = () => {
    update((current) => {
      const request = current.generationRequest;
      if (!request) return { ...current, message: '没有可查询的原生成请求。' };
      if (!request.receipt)
        return { ...current, message: '原生成请求仍无可匹配回执；未重新提交。' };
      if (!generationReceiptMatches(request.intent, request.receipt)) {
        return {
          ...current,
          generationStatus: 'MISMATCH',
          message: '原生成回执与项目、阶段或版本不匹配，未应用任何候选。',
        };
      }
      const withVersions = applyVersions(current, request.receipt.versions);
      return {
        ...withVersions,
        generationStatus: 'RECEIVED',
        message: '已查询到原生成回执；未创建第二个意图。',
      };
    });
  };

  const changeDraft = (text: string) => {
    update((current) => {
      const latest = current.drafts[selectedScope.id] ?? emptyDraft;
      return {
        ...current,
        drafts: {
          ...current.drafts,
          [selectedScope.id]: draftAfterEdit(text, currentBasis),
        },
        message: latest.text === text ? current.message : undefined,
      };
    });
  };

  const saveDraft = () => {
    update((current) => {
      const latest = current.drafts[selectedScope.id] ?? emptyDraft;
      if (latest.text.trim().length === 0) return current;
      if (latest.state === 'SAVING' || latest.state === 'UNKNOWN')
        return {
          ...current,
          message:
            latest.requestLabel !== undefined
              ? `原保存请求 ${latest.requestLabel} 仍未决；只查询原请求，不创建新的保存意图。`
              : '原保存请求仍未决；只查询原请求，不创建新的保存意图。',
        };
      const requestLabel = `U2-SAVE-${crypto.randomUUID().slice(0, 8)}`;
      return {
        ...current,
        drafts: {
          ...current.drafts,
          [selectedScope.id]: draftWhileSaving(
            { ...latest, ...(latest.basis ? {} : { basis: currentBasis }) },
            requestLabel,
          ),
        },
        message: `已登记模拟保存请求 ${requestLabel}；请用演练控制返回回执。`,
      };
    });
  };

  const applySaveReceipt = () => {
    api.updateAny((current) => {
      const drafts: Record<string, MvpDraft> = { ...current.drafts };
      let changed = false;
      for (const [scopeId, entry] of Object.entries(drafts)) {
        if (
          (entry.state !== 'SAVING' && entry.state !== 'UNKNOWN') ||
          entry.requestLabel === undefined
        )
          continue;
        drafts[scopeId] = draftAfterSaveReceipt(entry, current.saveScene);
        changed = true;
      }
      return changed
        ? {
            ...current,
            drafts,
            message: '原保存请求已按当前场景返回回执；未创建新的保存意图。',
          }
        : current;
    });
  };

  const submitRevision = () => {
    const text = draft.text.trim();
    if (!text) return;
    if (draftBasisChanged(draft, currentBasis)) return;

    const projectActive = activeSubmission(
      Object.values(sessions).flatMap((candidate) => candidate.submissions),
    );
    if (projectActive) return;
    if (!currentSet) return;
    update((current) => {
      const requestId = `U2-REV-${crypto.randomUUID().slice(0, 8)}`;
      const intent: RevisionIntent = {
        requestId,
        projectId,
        stage,
        scope: selectedScope,
        text,
        basis: currentBasis,
      };
      const scene = current.revisionScene;
      const submission: MvpSubmission = {
        submissionId: `U2-SUB-${crypto.randomUUID().slice(0, 8)}`,
        requestId,
        scope: selectedScope,
        text,
        basis: currentBasis,
        status:
          scene === 'RECEIVED'
            ? 'RECEIVED'
            : scene === 'FAILED'
              ? 'FAILED'
              : scene === 'PENDING'
                ? 'PENDING'
                : 'UNKNOWN',
        note:
          scene === 'RECEIVED'
            ? '模拟意见已接收；未生成新候选，等待显式演练下一轮候选。'
            : scene === 'FAILED'
              ? '模拟提交失败；原意见保留在历史中，可显式重新提交。'
              : '只查询这一原请求；不自动轮询，也不按时间推断成功。',
        submittedAt: new Date().toISOString(),
      };
      const receipt: RevisionReceipt = {
        classification: 'DEVELOPMENT_FIXTURE_ONLY',
        requestId,
        projectId,
        stage,
        scope: selectedScope,
        basis: currentBasis,
      };
      return {
        ...current,
        revisionIntents: { ...current.revisionIntents, [requestId]: intent },
        ...(scene === 'RECEIVED' || scene === 'MISMATCH'
          ? {
              revisionReceipts: {
                ...current.revisionReceipts,
                [requestId]:
                  scene === 'MISMATCH'
                    ? {
                        ...receipt,
                        basis: { ...currentBasis, planVersion: currentBasis.planVersion + 1 },
                      }
                    : receipt,
              },
            }
          : {}),
        submissions: [...current.submissions, submission],
        drafts: {
          ...current.drafts,
          [selectedScope.id]:
            scene === 'FAILED'
              ? {
                  text,
                  state: 'FAILED',
                  note: '模拟提交失败；原文仍在本页，可显式重新提交。',
                }
              : {
                  text: '',
                  state: 'EMPTY',
                  note:
                    scene === 'RECEIVED'
                      ? '本次提交已冻结；这里是新的下轮草稿'
                      : '原意见已冻结在请求历史中；这里是新的下轮草稿',
                },
        },
        message:
          scene === 'RECEIVED' ? '模拟意见已接收；本次内容已冻结，可继续写下轮意见。' : undefined,
      };
    });
  };

  const rebindDraft = () => {
    update((current) => {
      const latest = current.drafts[selectedScope.id] ?? emptyDraft;
      if (!latest.text.trim() || !latest.basis) return current;
      return {
        ...current,
        drafts: {
          ...current.drafts,
          [selectedScope.id]: {
            ...latest,
            basis: currentBasis,
            state: 'UNSAVED',
            note: '已显式绑定到当前依据；未保存的文本不会自动迁移。',
          },
        },
        message: '当前草稿已显式绑定到当前依据；请核对后提交。',
      };
    });
  };

  const receiveRevision = () => {
    const activeNow = activeSubmission(
      Object.values(sessions).flatMap((candidate) => candidate.submissions),
    );
    if (!activeNow) return;
    api.updateAny((current) => {
      const intent = current.revisionIntents[activeNow.requestId];
      if (!intent) return current;
      if (current.revisionReceipts[activeNow.requestId]) return current;
      const matching: RevisionReceipt = {
        classification: 'DEVELOPMENT_FIXTURE_ONLY',
        requestId: intent.requestId,
        projectId: intent.projectId,
        stage: intent.stage,
        scope: intent.scope,
        basis: intent.basis,
      };
      const mismatch: RevisionReceipt = {
        ...matching,
        scope: stageScope(intent.stage),
        basis: { ...intent.basis, planVersion: intent.basis.planVersion + 1 },
      };
      return {
        ...current,
        revisionReceipts: {
          ...current.revisionReceipts,
          [intent.requestId]: current.revisionScene === 'MISMATCH' ? mismatch : matching,
        },
        message: '原修订回执已到达；请显式查询原请求，不自动应用。',
      };
    });
  };

  const queryRevision = () => {
    const activeNow = activeSubmission(
      Object.values(sessions).flatMap((candidate) => candidate.submissions),
    );
    if (!activeNow) return;
    api.updateAny((current) => {
      const intent = current.revisionIntents[activeNow.requestId];
      const receipt = current.revisionReceipts[activeNow.requestId];
      if (!intent) return current;
      if (!receipt)
        return {
          ...current,
          message: '原修订请求仍无可匹配回执；未再次发送意见。',
        };
      const matches =
        receipt.requestId === intent.requestId &&
        receipt.projectId === intent.projectId &&
        receipt.stage === intent.stage &&
        receipt.scope.id === intent.scope.id &&
        receipt.basis.planId === intent.basis.planId &&
        receipt.basis.planVersion === intent.basis.planVersion &&
        receipt.basis.manualFinalizationId === intent.basis.manualFinalizationId &&
        receipt.basis.procedureFinalizationId === intent.basis.procedureFinalizationId &&
        sameVersionSet(receipt.basis.files, intent.basis.files);
      return {
        ...current,
        submissions: current.submissions.map((submission) =>
          submission.requestId === intent.requestId
            ? {
                ...submission,
                status: matches ? 'RECEIVED' : 'UNKNOWN',
                note: matches
                  ? '模拟回执与原意见、范围和依据匹配；已接收。'
                  : '回执与本次提交不匹配；既不是失败也不是成功，原请求保持不变。',
              }
            : submission,
        ),
        message: matches
          ? '已查询到原修订回执；未创建第二个修改意图。'
          : '回执不匹配；原请求仍待核验。',
      };
    });
  };

  const switchVersion = (fileId: string, versionId: string) => {
    update((current) => {
      const file = current.files[fileId];
      if (!file?.versions.includes(versionId)) return current;
      const planFile = files.find((entry) => entry.id === fileId);
      const scope = fileVersionScope(stage, {
        fileId,
        title: planFile?.title ?? fileId,
        versionId,
        versionLabel: u2VersionLabel(versionId),
      });
      return {
        ...current,
        activeFileId: fileId,
        scopeId: scope.id,
        files: {
          ...current.files,
          [fileId]: { ...file, viewedVersionId: versionId, recheckedVersionId: versionId },
        },
        message: `已显式切换到 ${planFile?.title ?? fileId} 的 ${u2VersionLabel(
          versionId,
        )}；请重新核对差异、意见绑定与草稿后再提交或定稿。`,
      };
    });
  };

  const nextCandidate = () => {
    update((current) => {
      if (!receivedForCurrent || !hasNextVersion || active) {
        return {
          ...current,
          message: '新候选需要至少一次匹配的前一轮修改已接收，且当前没有待回执批次。',
        };
      }
      if (current.candidateScene === 'mismatch')
        return {
          ...current,
          message: '模拟候选回执与当前版本集合不匹配；未生成新候选，原阅读与草稿保留。',
        };
      const filesNext: Record<string, SessionFileState> = { ...current.files };
      const announced: string[] = [];
      for (const file of files) {
        const state = filesNext[file.id] ?? { versions: [] };
        const nextVersion = u2VersionsFor(file.id).find(
          (versionId) => !state.versions.includes(versionId),
        );
        if (!nextVersion) continue;
        filesNext[file.id] = { ...state, versions: [...state.versions, nextVersion].sort() };
        announced.push(`${file.title} ${u2VersionLabel(nextVersion)}`);
      }
      return {
        ...current,
        files: filesNext,
        message:
          announced.length > 0
            ? `新候选已到达（模拟）：${announced.join('、')}；当前阅读版本、位置与草稿保持不变。`
            : '没有可到达的新候选版本。',
      };
    });
  };

  const removeFileForRehearsal = () => {
    update((current) => {
      const target = files.at(-1);
      if (!target) return current;
      const state = current.files[target.id];
      if (!state || state.versions.length === 0)
        return { ...current, message: '没有可移除的候选版本。' };
      const removedVersions = [...state.versions];
      return {
        ...current,
        files: {
          ...current.files,
          [target.id]: { versions: [] },
        },
        removed: {
          ...current.removed,
          [target.id]: [...(current.removed[target.id] ?? []), ...removedVersions],
        },
        message: `模拟缺少文件：${target.title} 的全部候选已移除；完整集合不成立，不能定稿。`,
      };
    });
  };

  const restoreFileForRehearsal = () => {
    update((current) => {
      const entries = Object.entries(current.removed);
      if (entries.length === 0) return { ...current, message: '没有待恢复的缺失文件。' };
      const filesNext: Record<string, SessionFileState> = { ...current.files };
      for (const [fileId, versions] of entries) {
        const state = filesNext[fileId] ?? { versions: [] };
        const merged = [...new Set([...state.versions, ...versions])].sort();
        filesNext[fileId] = {
          ...state,
          versions: merged,
          viewedVersionId: merged.at(-1),
        };
      }
      return {
        ...current,
        files: filesNext,
        removed: {},
        message: '缺失文件已按演示恢复；请重新核对完整版本集合。',
      };
    });
  };

  const requestFinalization = () => {
    if (stage === 'RECORDS' || !currentSet || !canFinalizeSet) return;
    update((current) => {
      const scene = current.finalizationScene;
      const intent: FinalizationIntent = {
        requestId: `U2-FINAL-${crypto.randomUUID().slice(0, 8)}`,
        projectId,
        stage: stage === 'PROCEDURES' ? 'PROCEDURES' : 'MANUAL',
        planId: plan.planId,
        planVersion: plan.version,
        files: currentSet,
        inputRefs: planInputRefs(plan),
        templateIds: plan.templateBasis,
        ...(stage === 'PROCEDURES' && manualId ? { manualFinalizationId: manualId } : {}),
      };
      if (scene === 'failed')
        return {
          ...current,
          finalizationStatus: 'FAILED',
          finalizationRequest: { intent },
          message: '模拟定稿失败；原阅读、草稿与依据保留，可重新发起一次新请求。',
        };
      if (scene === 'pending' || scene === 'unknown')
        return {
          ...current,
          finalizationStatus: scene === 'pending' ? 'PENDING' : 'UNKNOWN',
          finalizationRequest: { intent },
          message:
            scene === 'pending'
              ? '定稿请求待回执；重复点击不会创建第二个意图。'
              : '定稿结果未知；只能查询原请求。',
        };
      const matching: FinalizationReceipt = {
        classification: 'DEVELOPMENT_FIXTURE_ONLY',
        ...intent,
        finalizationId: `U2-STAGE-${crypto.randomUUID().slice(0, 8)}`,
        confirmedAt: new Date().toISOString(),
      };
      if (scene === 'mismatch') {
        const wrong: FinalizationReceipt = {
          ...matching,
          files: currentSet.map((ref, index) =>
            index === 0 ? { ...ref, versionId: `${ref.versionId}-MISMATCH` } : ref,
          ),
        };
        return {
          ...current,
          finalizationStatus: 'PENDING',
          finalizationRequest: { intent, receipt: wrong },
          message: '模拟定稿回执与完整集合不匹配；请重新查询原请求核对。',
        };
      }
      if (scene === 'changed') {
        const target = files.at(-1);
        const state = target ? current.files[target.id] : undefined;
        const otherVersion = target
          ? (state?.versions.find((versionId) => versionId !== state.viewedVersionId) ??
            u2VersionsFor(target.id).find((versionId) => versionId !== state?.viewedVersionId))
          : undefined;
        if (!target || !state || !otherVersion)
          return {
            ...current,
            finalizationStatus: 'MISMATCH',
            finalizationRequest: { intent },
            message: '无法模拟确认期间版本变化：当前没有可切换的替代版本；未定稿，请重新核对。',
          };
        const versions = state.versions.includes(otherVersion)
          ? state.versions
          : [...state.versions, otherVersion].sort();
        return {
          ...current,
          finalizationStatus: 'PENDING',
          finalizationRequest: { intent, receipt: matching },
          files: {
            ...current.files,
            [target.id]: { ...state, versions, viewedVersionId: otherVersion },
          },
          message: '定稿请求待回执；确认期间模拟版本变化，原请求绑定旧集合。请重新查询核对。',
        };
      }
      const finalization = finalizationFromReceipt(matching);
      return {
        ...current,
        finalizationStatus: 'DONE',
        finalizationRequest: { intent, receipt: matching },
        finalization,
        message: '模拟阶段定稿已完成；回执绑定精确计划、输入与版本集合。',
      };
    });
  };

  const receiveFinalization = () => {
    update((current) => {
      const request = current.finalizationRequest;
      if (!request) return { ...current, message: '没有待回收的原定稿请求。' };
      if (request.receipt) return { ...current, message: '原定稿回执已存在；请查询原请求。' };
      const receipt: FinalizationReceipt = {
        classification: 'DEVELOPMENT_FIXTURE_ONLY',
        ...request.intent,
        finalizationId: `U2-STAGE-${crypto.randomUUID().slice(0, 8)}`,
        confirmedAt: new Date().toISOString(),
      };
      return {
        ...current,
        finalizationRequest: { ...request, receipt },
        message: '原定稿回执已到达；请显式查询原请求，不自动定稿。',
      };
    });
  };

  const queryFinalization = () => {
    update((current) => {
      const request = current.finalizationRequest;
      if (!request) return { ...current, message: '没有可查询的原定稿请求。' };
      const activeNow = activeSubmission(
        Object.values(sessions).flatMap((candidate) => candidate.submissions),
      );
      if (activeNow)
        return {
          ...current,
          message: `仍有待回执或待核验的修改请求 ${activeNow.requestId}；不能完成阶段定稿。请先查询或处理原修改请求。`,
        };
      if (!request.receipt)
        return { ...current, message: '原定稿请求仍无可匹配回执；未创建第二个意图。' };
      const filesNow = viewedVersionSet(
        planStageFiles(plan, stage).map((file) => fileAvailability(file, current.files[file.id])),
      );
      const evaluation = evaluateFinalizationReceipt({
        intent: request.intent,
        receipt: request.receipt,
        currentFiles: filesNow ?? [],
        ...(stage === 'PROCEDURES' && manualId ? { currentManualFinalizationId: manualId } : {}),
      });
      if (!evaluation.ok)
        return {
          ...current,
          finalizationStatus: 'MISMATCH',
          message: evaluation.reason ?? '回执不匹配，未定稿。',
        };
      return {
        ...current,
        finalizationStatus: 'DONE',
        finalization: finalizationFromReceipt(request.receipt),
        message: '已查询到原定稿回执；未创建第二个意图。',
      };
    });
  };

  const retryFinalization = () => {
    update((current) => ({ ...current, finalizationStatus: 'NONE' }));
    requestFinalization();
  };

  const resetFinalization = () => {
    update((current) => ({
      ...current,
      finalizationStatus: 'NONE',
      finalizationRequest: undefined,
      message: '已清除不匹配回执；请重新核对完整集合与上游依据后再次确认。',
    }));
  };

  const opinionScopeOptions = scopeOptions.map((option) => ({
    id: option.id,
    label: option.label,
    kind: option.kind,
  }));
  const opinionScope =
    opinionScopeOptions.length > 0
      ? {
          options: opinionScopeOptions,
          selectedId: selectedScope.id,
          note: '保存、提交修改与阶段定稿是不同动作；项目、阶段和文件版本意见各自保留原依据。',
        }
      : undefined;
  const submission =
    myActive?.scope.id === selectedScope.id
      ? {
          status: myActive.status === 'PENDING' ? ('RUNNING' as const) : ('UNKNOWN' as const),
          requestLabel: myActive.requestId,
          originalText: myActive.text,
          queries: { automatic: 0, budget: 0 },
          querying: false,
          canQuery: myActive.status === 'UNKNOWN',
          note: '本演练不自动轮询；请显式查询或模拟原请求回执到达。',
        }
      : undefined;
  const submitBlocked = !currentSet
    ? '当前阶段缺少文件或版本；请先恢复完整集合后再提交修改。'
    : draftBasisChanged(draft, currentBasis)
      ? '该草稿按上一版本依据保存；请显式重新绑定到当前依据后再提交。'
      : active && active.scope.id !== selectedScope.id
        ? '本项目已有待回执或待核验的修改请求；可以继续保存下轮草稿，但不能启动第二个批次。'
        : undefined;
  const history = allSubmissions.map((entry) => ({
    id: entry.submissionId,
    scopeLabel: entry.scope.label,
    status: submissionLabels[entry.status],
    text: entry.text,
    requestLabel: entry.requestId,
    basis: basisText(entry.basis),
  }));
  const review: Parameters<typeof StageReviewPage>[0]['review'] = data
    ? {
        data,
        busy: false,
        directoryStatus: '',
        onMore: () => Promise.resolve(),
        download: {
          hasRepresentation: false,
          status: '',
          note: '本演练未登记可下载表示；阅读与意见不受影响。',
          onDownload: () => Promise.resolve(),
        },
        workspace: {
          files: {
            list: {
              totalCount: files.length,
              entries: files.map((file) => {
                const availability = availabilities.find((entry) => entry.fileId === file.id);
                const viewed = availability?.viewedVersionId;
                const next = availability ? candidateVersion(availability) : undefined;
                const missing = !viewed;
                return {
                  fileId: file.id,
                  code: file.id,
                  title: file.title,
                  state: missing ? ('UNCERTAIN' as const) : ('READY' as const),
                  detail: missing
                    ? '缺少该文件候选'
                    : `${u2VersionLabel(viewed)}${next ? ` · ${u2VersionLabel(next)}已到达` : ''}`,
                  openable: Boolean(viewed),
                };
              }),
              currentFileId: activeFileId ?? '',
              query: '',
              stateFilter: 'ALL' as const,
              loading: false,
              status: `本阶段共 ${files.length} 份计划文件（演示）`,
            },
            actions: {
              onSelect: (fileId: string) => {
                const availability = availabilities.find((entry) => entry.fileId === fileId);
                if (!availability?.viewedVersionId) return;
                const planFile = files.find((file) => file.id === fileId);
                update((current) => ({
                  ...current,
                  activeFileId: fileId,
                  scopeId: fileVersionScope(stage, {
                    fileId,
                    title: planFile?.title ?? fileId,
                    versionId: availability.viewedVersionId ?? '',
                    versionLabel: u2VersionLabel(availability.viewedVersionId ?? ''),
                  }).id,
                }));
              },
            },
          },
          ...(summary
            ? {
                summary: {
                  summary: summary.summary,
                  retained: summary.retained,
                  evidence: [
                    { label: '计划', detail: reportBasis(plan) },
                    { label: '输入来源', detail: meta?.sourceIds.join('、') ?? '' },
                    { label: '正式模板快照', detail: meta?.templateIds.join('、') ?? '' },
                    {
                      label: '比较基线',
                      detail:
                        meta?.action === 'CREATE'
                          ? '无客户原版本（新增）'
                          : (meta?.baselineLabel ?? '上一候选版本'),
                    },
                  ],
                  note: summary.note,
                },
              }
            : {}),
          ...(activeAvailability && candidateVersion(activeAvailability)
            ? {
                candidate: {
                  label: '新候选已到达',
                  note: `当前仍查看 ${u2VersionLabel(
                    activeAvailability.viewedVersionId ?? '',
                  )}；阅读位置、滚动位置和意见草稿保持不变。`,
                  onSwitch: () => {
                    const next = candidateVersion(activeAvailability);
                    if (next) switchVersion(activeAvailability.fileId, next);
                  },
                },
              }
            : {}),
          ...(session.activeFileId &&
          session.files[session.activeFileId]?.recheckedVersionId ===
            session.files[session.activeFileId]?.viewedVersionId
            ? {
                recheck: '已显式切换到本精确版本；请重新核对差异、意见绑定与草稿后再提交或定稿。',
              }
            : {}),
        },
        opinion: {
          context: selectedScope.label,
          draft: {
            text: draft.text,
            state: draft.state,
            note: `${draft.note} · ${mvpDraftStateLabels[draft.state]}`,
          },
          ...(submission ? { submission } : {}),
          ...(opinionScope ? { scope: opinionScope } : {}),
          ...(submitBlocked ? { submitBlocked } : {}),
          history,
          approval: {
            available: false,
            note: '阶段定稿在完整集合中一次确认；本页不做逐文件批准。',
            visible: false,
          },
          unavailable: [
            '真实服务器草稿、意见提交与阶段定稿尚未接入；本页只保留内存状态。',
            '真实 Runner 候选生成、上游返工（U3）与最终交付包均未实现。',
            '扩大范围的修改需返回 U1 修改范围计划重新确认。',
          ],
        },
        opinionActions: {
          onDraftChange: changeDraft,
          onSaveDraft: saveDraft,
          onSubmit: submitRevision,
          onQuerySubmission: queryRevision,
          onSelectScope: (scopeId) => {
            update((current) => {
              const option = scopeOptions.find((entry) => entry.id === scopeId);
              return {
                ...current,
                scopeId,
                ...(option?.id.startsWith('file:')
                  ? { activeFileId: option.id.split(':')[1] }
                  : {}),
              };
            });
          },
        },
      }
    : undefined;

  const generation = {
    status: session.generationStatus,
    reason: generationReason,
    enabled: generationEnabled,
    onGenerate: requestGeneration,
    ...(session.generationStatus === 'PENDING' || session.generationStatus === 'UNKNOWN'
      ? { onReceipt: receiveGeneration }
      : {}),
    ...(session.generationStatus === 'PENDING' ||
    session.generationStatus === 'UNKNOWN' ||
    session.generationStatus === 'MISMATCH'
      ? { onQuery: queryGeneration }
      : {}),
  };

  const finalization = {
    supported: stage !== 'RECORDS',
    status: session.finalizationStatus,
    reason: blocker ?? '完整集合已就绪；一次确认精确文件/版本与上游依据，只生成页面内模拟回执。',
    canConfirm,
    ...(session.finalizationRequest
      ? { requestLabel: session.finalizationRequest.intent.requestId }
      : {}),
    exactSet: fileViews(plan, stage, session),
    ...(session.finalization
      ? {
          result: {
            finalizationId: session.finalization.finalizationId,
            planLabel: reportBasis(plan),
            ...(session.finalization.manualFinalizationId
              ? { manualLabel: session.finalization.manualFinalizationId }
              : {}),
            files: session.finalization.files.map((ref) => {
              const planFile = files.find((file) => file.id === ref.fileId);
              return {
                fileId: ref.fileId,
                title: planFile?.title ?? ref.fileId,
                versionLabel: u2VersionLabel(ref.versionId),
              };
            }),
          },
        }
      : {}),
    onConfirm: requestFinalization,
    ...(session.finalizationRequest ? { onReceipt: receiveFinalization } : {}),
    onQuery: queryFinalization,
    onRetry: retryFinalization,
    onReset: resetFinalization,
  };

  const next =
    stage === 'MANUAL' && session.finalization
      ? {
          label: '进入控制程序与管理制度审阅',
          href: proceduresPath,
          reason: `质量手册模拟定稿 ${session.finalization.finalizationId} 已作为第二阶段依据；进入下一阶段不重复范围确认。`,
        }
      : stage === 'PROCEDURES' && session.finalization
        ? {
            label: '进入记录表单审阅',
            href: recordsPath,
            reason: `第二阶段完整集合模拟定稿 ${session.finalization.finalizationId} 已作为记录表单依据；最终交付确认属于 U3。`,
          }
        : undefined;

  const controls = (
    <details className="fixture-options" open>
      <summary>U2 显式场景控制（演练）</summary>
      <fieldset>
        <legend>候选生成</legend>
        <label>
          生成回执场景
          <select
            value={session.generationScene}
            onChange={(event) => {
              const value = event.target.value as StageSession['generationScene'];
              update((current) => ({ ...current, generationScene: value }));
            }}
          >
            <option value="matched">匹配回执 · 完整集合</option>
            <option value="missing">匹配回执 · 缺少一份文件</option>
            <option value="pending">待回执</option>
            <option value="unknown">UNKNOWN</option>
            <option value="failed">失败</option>
            <option value="mismatch">错上下文回执</option>
          </select>
        </label>
        <button onClick={queryGeneration} disabled={!session.generationRequest}>
          重新查询原生成请求
        </button>
      </fieldset>
      <fieldset>
        <legend>意见草稿与修改</legend>
        <label>
          模拟保存回执
          <select
            value={session.saveScene}
            onChange={(event) => {
              const value = event.target.value as StageSession['saveScene'];
              update((current) => ({ ...current, saveScene: value }));
            }}
          >
            <option value="SAVED">已保存到本页内存</option>
            <option value="FAILED">保存失败</option>
            <option value="UNKNOWN">保存结果待核验</option>
          </select>
        </label>
        <button onClick={applySaveReceipt}>模拟原保存回执到达/查询</button>
        <button onClick={rebindDraft} disabled={!draftBasisChanged(draft, currentBasis)}>
          显式将当前草稿绑定到当前依据（模拟）
        </button>
        <label>
          修改回执场景
          <select
            value={session.revisionScene}
            onChange={(event) => {
              const value = event.target.value as StageSession['revisionScene'];
              update((current) => ({ ...current, revisionScene: value }));
            }}
          >
            <option value="RECEIVED">已接收</option>
            <option value="PENDING">待回执</option>
            <option value="UNKNOWN">UNKNOWN</option>
            <option value="FAILED">失败</option>
            <option value="MISMATCH">回执错绑</option>
          </select>
        </label>
        <button onClick={receiveRevision} disabled={!myActive}>
          模拟原修订回执到达
        </button>
        <button onClick={queryRevision} disabled={!myActive}>
          重新查询原修订请求
        </button>
      </fieldset>
      <fieldset>
        <legend>版本与候选</legend>
        {activeAvailability && activeAvailability.versions.length > 0 && (
          <label>
            查看当前文件版本
            <select
              value={activeAvailability.viewedVersionId ?? ''}
              onChange={(event) => {
                switchVersion(activeAvailability.fileId, event.target.value);
              }}
            >
              {activeAvailability.versions.map((versionId) => (
                <option key={versionId} value={versionId}>
                  {u2VersionLabel(versionId)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          候选回执场景
          <select
            value={session.candidateScene}
            onChange={(event) => {
              const value = event.target.value as StageSession['candidateScene'];
              update((current) => ({ ...current, candidateScene: value }));
            }}
          >
            <option value="matched">匹配当前版本集合</option>
            <option value="mismatch">错绑版本集合</option>
          </select>
        </label>
        <button
          onClick={nextCandidate}
          disabled={!receivedForCurrent || !hasNextVersion || Boolean(active)}
        >
          模拟下一轮候选到达
        </button>
        <button onClick={removeFileForRehearsal}>模拟缺少一份文件</button>
        <button
          onClick={restoreFileForRehearsal}
          disabled={Object.keys(session.removed).length === 0}
        >
          恢复缺失文件（演示）
        </button>
      </fieldset>
      {stage !== 'RECORDS' && (
        <fieldset>
          <legend>阶段定稿</legend>
          <label>
            定稿回执场景
            <select
              value={session.finalizationScene}
              onChange={(event) => {
                const value = event.target.value as StageSession['finalizationScene'];
                update((current) => ({ ...current, finalizationScene: value }));
              }}
            >
              <option value="matched">匹配回执</option>
              <option value="pending">待回执</option>
              <option value="unknown">UNKNOWN</option>
              <option value="failed">失败</option>
              <option value="mismatch">版本集合错绑</option>
              <option value="changed">确认期间版本变化</option>
            </select>
          </label>
        </fieldset>
      )}
      <button
        onClick={() => {
          update((current) => ({ ...current, simulatedAnswer: !current.simulatedAnswer }));
        }}
      >
        演练：模拟客户答复（编号按模板）
      </button>
      {session.simulatedAnswer && (
        <p className="notice" role="status">
          模拟客户答复（仅演示）：记录编号按模板占位；不是真实客户决定，未写入定稿依据。
        </p>
      )}
      <p>
        <Link to={manualPath}>演练：直接打开质量手册审阅</Link> ·{' '}
        <Link to={proceduresPath}>演练：直接打开程序与制度审阅</Link> ·{' '}
        <Link to={recordsPath}>演练：直接打开记录表单审阅</Link>
      </p>
      <p>
        <Link to={scopePath}>扩大范围？返回 U1 修改范围计划</Link>
      </p>
      <p className="muted">
        单项目一次修改批次 · 保存、提交与定稿分离 · 刷新会重置本页内存 · 没有自动轮询。
      </p>
    </details>
  );

  return (
    <StageReviewPage
      stage={stage}
      projectId={projectId}
      analysisReportId={api.reviewedReportId}
      statusMessage={session.message}
      plan={{
        planId: plan.planId,
        planVersion: plan.version,
        stateLabel: plan.state === 'CONFIRMED' ? '已确认 · 模拟回执' : plan.state,
      }}
      reviewStages={api.reviewStages}
      readiness={readiness}
      basis={stageEvidence}
      upstream={upstream}
      files={fileViews(plan, stage, session)}
      generation={generation}
      finalization={finalization}
      next={next}
      review={review}
      controls={controls}
    />
  );
}
